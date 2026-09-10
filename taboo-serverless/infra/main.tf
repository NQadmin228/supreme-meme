/* =====================================================================
   TABOO — Infrastructure de la couche de service
   ---------------------------------------------------------------------
   Tout en europe-west1, la region du jeu BigQuery existant. Colocaliser
   evite le trafic inter-region et, surtout, BigQuery refuse de requeter
   un jeu de donnees depuis une autre region.

   PRINCIPE DE MOINDRE PRIVILEGE
   -----------------------------
   Trois comptes de service distincts, un par role. Un compte unique
   serait plus court a ecrire et donnerait au service expose sur
   internet le droit d'ecrire l'instantane -- exactement ce qu'il ne doit
   pas pouvoir faire.

     sa_instantane  lit BigQuery, ecrit le bucket d'instantanes
     sa_api         lit BigQuery. AUCUN droit d'ecriture, nulle part.
     sa_declencheur declenche le job. Ne lit aucune donnee.
   ===================================================================== */

terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.projet
  region  = var.region
}

locals {
  services = [
    "run.googleapis.com",
    "bigquery.googleapis.com",
    "bigqueryreservation.googleapis.com", # BI Engine
    "storage.googleapis.com",
    "eventarc.googleapis.com",
    "cloudscheduler.googleapis.com",
    "artifactregistry.googleapis.com",
    "iap.googleapis.com",
    "certificatemanager.googleapis.com",
  ]
}

resource "google_project_service" "actifs" {
  for_each = toset(local.services)
  service  = each.value
  # Ne pas desactiver l'API si la ressource Terraform est detruite : une
  # desactivation d'API casse tout ce qui l'utilise ailleurs dans le projet.
  disable_on_destroy = false
}

/* =====================================================================
   COMPTES DE SERVICE
   ===================================================================== */

resource "google_service_account" "sa_instantane" {
  account_id   = "taboo-instantane"
  display_name = "TABOO — generateur d'instantane"
  description  = "Lit les vues de reporting et publie l'instantane sur GCS."
}

resource "google_service_account" "sa_api" {
  account_id   = "taboo-api-detail"
  display_name = "TABOO — API de detail"
  description  = "Lit analytics pour le drill-through. Aucun droit d'ecriture."
}

resource "google_service_account" "sa_declencheur" {
  account_id   = "taboo-declencheur"
  display_name = "TABOO — declencheur du job"
  description  = "Declenche le job d'instantane. N'accede a aucune donnee."
}

/* =====================================================================
   STOCKAGE DES INSTANTANES
   ===================================================================== */

resource "google_storage_bucket" "instantanes" {
  name                        = var.bucket_instantanes
  location                    = var.region
  uniform_bucket_level_access = true
  # Le contenu est public en lecture (voir plus bas) mais jamais
  # enumerable : personne ne doit pouvoir lister les versions.
  public_access_prevention = "inherited"

  versioning { enabled = true }

  lifecycle_rule {
    # Les instantanes s'accumulent a raison d'un par jour. En garder 90
    # laisse largement de quoi revenir en arriere ou comparer, sans payer
    # un stockage qui croit indefiniment.
    condition { age = 90 }
    action { type = "Delete" }
  }

  cors {
    origin          = var.origines_autorisees
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type", "Content-Encoding", "ETag"]
    max_age_seconds = 3600
  }
}

/* Lecture publique du bucket d'instantanes.

   A ARBITRER AVANT MISE EN PRODUCTION. Ces donnees sont le compte de
   resultat de l'etablissement. Deux options :

     a) bucket public + URL non devinable  -> le plus simple, mais quiconque
        obtient l'URL lit les donnees, et une URL finit toujours par
        circuler.
     b) bucket prive + service Cloud Run qui sert l'instantane derriere
        IAP -> les memes controles d'acces que l'API, au prix d'un
        composant de plus et de la perte du cache CDN public.

   L'option (b) est la bonne pour des donnees financieres. La ressource
   ci-dessous n'est donc creee que si var.instantane_public vaut true,
   et vaut false par defaut. */
resource "google_storage_bucket_iam_member" "lecture_publique" {
  count  = var.instantane_public ? 1 : 0
  bucket = google_storage_bucket.instantanes.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

resource "google_storage_bucket_iam_member" "instantane_ecrit" {
  bucket = google_storage_bucket.instantanes.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.sa_instantane.email}"
}

/* =====================================================================
   DROITS BIGQUERY
   ===================================================================== */

# Le generateur doit pouvoir LANCER un job dans le projet...
resource "google_project_iam_member" "instantane_job" {
  project = var.projet
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.sa_instantane.email}"
}

# ...et LIRE les jeux de donnees, mais au niveau du jeu et non du projet :
# un roles/bigquery.dataViewer sur le projet donnerait acces a tout ce qui
# y sera ajoute demain.
resource "google_bigquery_dataset_iam_member" "instantane_reporting" {
  dataset_id = "reporting"
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.sa_instantane.email}"
}

resource "google_bigquery_dataset_iam_member" "instantane_analytics" {
  dataset_id = "analytics"
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.sa_instantane.email}"
}

resource "google_project_iam_member" "api_job" {
  project = var.projet
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.sa_api.email}"
}

# L'API ne lit QUE analytics : elle ne sert que du detail ligne a ligne,
# et n'a aucune raison d'atteindre les vues de reporting.
resource "google_bigquery_dataset_iam_member" "api_analytics" {
  dataset_id = "analytics"
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.sa_api.email}"
}

/* =====================================================================
   PLAFOND DE COUT BIGQUERY
   =====================================================================
   Deuxieme ligne de defense apres maximum_bytes_billed. Ce dernier borne
   UNE requete ; ce quota borne le cumul quotidien. Sans lui, une boucle
   qui relance la meme requete acceptable mille fois passe inapercue.

   Ce quota se pose par la console ou gcloud, pas par Terraform :
     gcloud alpha services quota update \
       --service=bigquery.googleapis.com \
       --consumer=projects/PROJET \
       --metric=bigquery.googleapis.com/quota/query/usage \
       --unit=1/d/{project} --value=100  # 100 Gio scannes par jour
   La commande figure dans DEPLOIEMENT.md. */

/* =====================================================================
   BI ENGINE — acceleration en memoire
   =====================================================================
   Tout le jeu analytics tient dans 1 Gio, donc les requetes de detail
   repondent sous la seconde et ne scannent plus le stockage. C'est le
   meilleur rapport cout/latence disponible sur BigQuery, et cela rend
   l'API de detail assez rapide pour un usage interactif. */
resource "google_bigquery_bi_reservation" "bi_engine" {
  location   = var.region
  size       = var.bi_engine_octets
  depends_on = [google_project_service.actifs]

  preferred_tables {
    project_id = var.projet
    dataset_id = "analytics"
    table_id   = "ventes"
  }
  preferred_tables {
    project_id = var.projet
    dataset_id = "analytics"
    table_id   = "etats_famille"
  }
  preferred_tables {
    project_id = var.projet
    dataset_id = "analytics"
    table_id   = "depenses"
  }
}

/* =====================================================================
   JOB D'INSTANTANE
   ===================================================================== */

resource "google_cloud_run_v2_job" "instantane" {
  name     = "taboo-instantane"
  location = var.region

  template {
    task_count  = 1
    parallelism = 1
    template {
      service_account = google_service_account.sa_instantane.email
      # Un echec de requete BigQuery est presque toujours definitif
      # (vue absente, invariant viole). Reessayer trois fois ne ferait
      # que retarder l'alerte de trois executions.
      max_retries = 1
      timeout     = "900s"

      containers {
        image = var.image_instantane
        resources {
          limits = {
            cpu    = "1"
            memory = "2Gi" # l'instantane complet est manipule en memoire
          }
        }
        env {
          name  = "BQ_PROJET"
          value = var.projet
        }
        env {
          name  = "BQ_REGION"
          value = var.region
        }
        env {
          name  = "GCS_BUCKET_INSTANTANES"
          value = google_storage_bucket.instantanes.name
        }
        env {
          name  = "BQ_MAX_BYTES_BILLED"
          value = tostring(var.plafond_octets_requete)
        }
      }
    }
  }
}

/* Declenchement quotidien, apres la requete planifiee taboo-merge-analytics.

   Un horaire fixe plutot qu'un declencheur sur evenement : la requete
   planifiee BigQuery n'emet pas d'evenement Eventarc exploitable
   directement. Le decalage doit couvrir la duree du MERGE avec une marge
   -- si le MERGE passe a 02h00, generer l'instantane a 02h30 publierait
   des donnees a moitie transformees. */
resource "google_cloud_scheduler_job" "instantane_quotidien" {
  name        = "taboo-instantane-quotidien"
  description = "Genere l'instantane du dashboard apres le MERGE analytics."
  schedule    = var.horaire_instantane
  time_zone   = "Africa/Lome" # meme fuseau que la journee d'exploitation
  region      = var.region

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri = join("", [
      "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/",
      "namespaces/${var.projet}/jobs/${google_cloud_run_v2_job.instantane.name}:run"
    ])
    oauth_token {
      service_account_email = google_service_account.sa_declencheur.email
    }
  }
}

resource "google_cloud_run_v2_job_iam_member" "declencheur_execute" {
  name     = google_cloud_run_v2_job.instantane.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.sa_declencheur.email}"
}

/* =====================================================================
   API DE DETAIL
   ===================================================================== */

resource "google_cloud_run_v2_service" "api" {
  name     = "taboo-api-detail"
  location = var.region
  # Trafic entrant limite au load balancer : l'URL run.app directe n'est
  # pas joignable, donc IAP ne peut pas etre contourne.
  ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    service_account = google_service_account.sa_api.email
    # L'API attend sur le reseau plus qu'elle ne calcule : une instance
    # traite plusieurs requetes simultanement sans peine.
    max_instance_request_concurrency = 40

    scaling {
      # Zero instance au repos : l'API n'est appelee que pour du detail,
      # soit quelques fois par jour. Le demarrage a froid est acceptable
      # sur une action explicite de l'utilisateur.
      min_instance_count = 0
      max_instance_count = 4
    }

    containers {
      image = var.image_api
      ports { container_port = 8080 }
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
      env {
        name  = "BQ_PROJET"
        value = var.projet
      }
      env {
        name  = "BQ_REGION"
        value = var.region
      }
      env {
        name  = "ORIGINES_AUTORISEES"
        value = join(",", var.origines_autorisees)
      }
      startup_probe {
        http_get { path = "/sante" }
        initial_delay_seconds = 2
        period_seconds        = 3
        failure_threshold     = 5
      }
    }
  }
}

/* =====================================================================
   SORTIES
   ===================================================================== */

output "bucket_instantanes" {
  value = google_storage_bucket.instantanes.name
}

output "url_api" {
  value = google_cloud_run_v2_service.api.uri
}

output "job_instantane" {
  value = google_cloud_run_v2_job.instantane.name
}

output "comptes_de_service" {
  value = {
    instantane  = google_service_account.sa_instantane.email
    api         = google_service_account.sa_api.email
    declencheur = google_service_account.sa_declencheur.email
  }
}

output "rappel_instantane_public" {
  value = var.instantane_public ? join("", [
    "ATTENTION : le bucket d'instantanes est en lecture PUBLIQUE. ",
    "Le compte de resultat de l'etablissement est accessible a quiconque ",
    "connait l'URL. Voir la section « Exposition des donnees » de DEPLOIEMENT.md."
  ]) : "Bucket prive : servir l'instantane derriere IAP (voir DEPLOIEMENT.md)."
}
