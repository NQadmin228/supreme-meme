# TABOO — Couche de service serverless sur BigQuery

Alternative propriétaire à Looker Studio pour le tableau de bord validé par
la direction. Mono-tenant, fraîcheur quotidienne, pages modélisées +
drill-through, tout en GCP `europe-west1`.

---

## Le parti architectural, en une page

BigQuery reste le système de référence et le moteur de transformation. Il ne
sert **pas** les interactions de l'interface.

```
GCS (exports POS)
  └─ tables externes BigLake ─── raw_data
       └─ requête planifiée "taboo-merge-analytics" ─── analytics
            └─ vues reporting  ← la couche sémantique
                 │
                 ├─[1] job Cloud Run "taboo-instantane"   1×/jour
                 │      registre → SQL → invariants → GCS
                 │        └─ manifest.json + instantanes/<version>.json.br
                 │             └─[4] front statique : filtre en local
                 │
                 └─[2] service Cloud Run "taboo-api-detail"  à la demande
                        liste blanche, plafonds de coût, détail ligne à ligne

  [3] IAP devant le front et l'API
```

**Pourquoi un instantané et non des requêtes à la demande.** Le jeu de
reporting entier pèse quelques mégaoctets : 3 586 lignes au grain
jour × activité, 274 articles, 30 381 lignes horaires. BigQuery est un
moteur de scan facturé à l'octet, avec 200 ms à 2 s de latence. Le faire
répondre à chaque changement de filtre revient à payer et attendre pour
rejouer indéfiniment le même calcul — c'est exactement ce qui rend Looker
Studio lent sur ce dataset.

L'instantané inverse le rapport : une exécution par jour, puis un fichier
servi par le CDN que le navigateur filtre en moins de 100 ms. Aucune donnée
d'identification n'atteint le client, et le tableau de bord continue de
fonctionner si BigQuery est indisponible.

Mesuré en local : coquille **130 Ko** (contre 5,2 Mo en version autonome),
instantané chargé en **89 à 121 ms**.

---

## À faire AVANT tout déploiement

### 1. Corriger `reporting.v_resultat_jour` — bloquant

La vue actuelle assemble en `LEFT JOIN` depuis les seules ventes. **Elle perd
l'ecart mesure F d'achats** sur 7 couples (jour, activité) : des jours de fermeture
où l'établissement s'est réapprovisionné sans ouvrir.

| | marge brute |
|---|---|
| `LEFT JOIN` (vue actuelle) | la marge erronee F |
| `FULL OUTER JOIN` (corrigé) | **la marge de reference F** ← validé par la direction |

Le bloc « CONTRÔLES APRÈS EXÉCUTION » de `11_views_reporting_v2.sql` annonce
déjà la marge de reference, c'est-à-dire la valeur **corrigée** : la vue n'a jamais été
confrontée à sa propre attente documentée. Sans ce correctif, la nouvelle
couche affichera un chiffre différent de celui présenté au chef.

```bash
bq query --use_legacy_sql=false --location=europe-west1 < sql/12_fix_v_resultat_jour.sql
```

Puis dérouler les trois contrôles en commentaire en fin de fichier. Le
troisième doit renvoyer exactement 7 lignes totalisant l'ecart mesure F.

### 2. Charger les trois sources absentes de BigQuery

Le dashboard validé s'appuie sur trois sources qui n'ont jamais été chargées.
Sans elles, trois pages restent vides — dont « Coût de revient », qui porte le
constat central de l'écart de l'ecart mesure sur EAT.

```bash
gsutil cp couts_de_revient.csv gs://VOTRE_BUCKET_SOURCES/referentiel/
gsutil cp INVENTAIRE*.csv       gs://VOTRE_BUCKET_SOURCES/referentiel/inventaire.csv
gsutil cp "Chiffre d'affaire globale"*.csv gs://VOTRE_BUCKET_SOURCES/referentiel/ca_globale.csv

bq query --use_legacy_sql=false --location=europe-west1 < sql/13_ddl_sources_manquantes.sql
```

Ce fichier crée aussi `reporting.v_inventaire` (stock valorisé, alertes) et
**redéfinit `reporting.v_cout_revient`** sur la vraie source : la version
existante lit `etats_famille.cout`, renseigné sur 4 lignes sur 58 943, et
porte elle-même la mention « chantier 4 en cours ». C'est ce chantier.

Il reste à écrire le MERGE qui alimente les tables typées depuis les tables
externes — voir « Ce qui n'est pas fait » plus bas.

### 3. Vérifier l'horaire réel du MERGE

`05_merge_analytics.sql` porte la mention « 02h00 est **A REVOIR** ». L'horaire
par défaut de la génération est 03h30 (Africa/Lome). Générer l'instantané
pendant le MERGE publierait des données à moitié transformées, **et les
invariants ne le détecteraient pas forcément** : une transformation partielle
peut rester cohérente avec elle-même. Confirmer l'horaire avant de figer
`horaire_instantane`.

---

## Déploiement

```bash
# Images
REG=europe-west1-docker.pkg.dev/VOTRE_PROJET_GCP/taboo
gcloud artifacts repositories create taboo --repository-format=docker --location=europe-west1

docker build -f snapshot_builder/Dockerfile -t $REG/instantane:1.0 .
docker build -f query_api/Dockerfile        -t $REG/api-detail:1.0 .
docker push $REG/instantane:1.0
docker push $REG/api-detail:1.0

# Infrastructure
cd infra
terraform init
terraform plan -var="image_instantane=$REG/instantane:1.0" \
               -var="image_api=$REG/api-detail:1.0" \
               -var='origines_autorisees=["https://dashboard.exemple.tg"]'
terraform apply   # mêmes variables
```

### Plafond de coût quotidien — à ne pas oublier

`maximum_bytes_billed` borne **une** requête ; ce quota borne le cumul
journalier. Sans lui, une boucle qui relance mille fois la même requête
acceptable passe inaperçue. Il ne se pose pas par Terraform :

```bash
gcloud alpha services quota update \
  --service=bigquery.googleapis.com \
  --consumer=projects/VOTRE_PROJET_GCP \
  --metric=bigquery.googleapis.com/quota/query/usage \
  --unit=1/d/{project} --value=100
```

100 Gio scannés par jour est très large pour ce jeu — c'est un disjoncteur.

### Première génération, à la main

```bash
gcloud run jobs execute taboo-instantane --region=europe-west1 --wait
```

Vérifier dans les journaux que **les six invariants passent**. Si l'un échoue,
rien n'est publié et le message dit quoi corriger.

### Front

```bash
cd web && python build.py
gsutil -m rsync -d dist/ gs://<bucket-front>/
```

---

## Exposition des données — à arbitrer avant la mise en production

Les instantanés contiennent le compte de résultat complet : chiffre
d'affaires, marges, performance par caissier. C'est la raison pour laquelle
rien de tout cela n'est versionné. `instantane_public` vaut
**false** par défaut, et c'est délibéré.

| | avantage | risque |
|---|---|---|
| Bucket public + URL non devinable | simple, cache CDN gratuit | une URL circule toujours ; ce n'est pas un contrôle d'accès |
| **Bucket privé + service derrière IAP** | mêmes contrôles que l'API, journalisation des accès | un composant de plus, pas de cache CDN public |

Pour des données financières, la seconde option est la bonne. Le service
Cloud Run qui sert l'instantané derrière IAP n'est pas encore écrit — voir
ci-dessous.

---

## Ce qui a été vérifié, et comment

| Vérifié | Méthode |
|---|---|
| SQL généré depuis le registre | `snapshot_builder/main.py --dry-run`, 14 jeux |
| Cohérence du registre | `semantique/registre.py` — 14 jeux, 62 mesures, 10 ratios, 0 erreur |
| Les 6 invariants sur données réelles | rejoués sur `data_v2.json` : tous au vert |
| L'invariant attrape la régression du LEFT JOIN | suppression simulée des 7 couples → **détecté, écart −l'ecart mesure F** |
| L'invariant attrape un NaN | injection d'un NaN → détecté avec son chemin exact |
| Détection d'un export tronqué | moitié des lignes → 5 alertes non bloquantes |
| Chargement distant du front | 12 pages, 36 graphiques, 0 erreur console, 89–121 ms |
| Écran d'erreur | manifeste absent → message, bouton, **12 pages préservées** |
| Injection SQL par un filtre | `DROP TABLE` en paramètre → jamais dans le SQL |
| Garde-fous de l'API | 8 cas de refus sur 11, dont période de 3 ans et forçage de `lignes_max` |
| Cohérence Terraform | 10 variables, 17 ressources, toutes références résolues |

**Non vérifié :** `terraform validate` et `terraform plan` — Terraform n'est pas
installé sur ce poste. La cohérence interne a été contrôlée par analyse
statique, ce qui n'équivaut pas à une validation par l'outil. **À lancer avant
le premier `apply`.** Aucun composant n'a été exécuté contre le vrai BigQuery :
je n'ai pas d'identifiants sur le projet.

---

## Ce qui n'est pas fait

Par ordre de ce qui bloque une mise en production :

1. **Le MERGE des trois nouvelles sources.** `13_ddl_sources_manquantes.sql`
   crée les tables externes et les tables typées, mais pas la transformation
   qui remplit les secondes depuis les premières — dont la normalisation de
   `cle_produit` (majuscules, sans accent, espaces réduits), sans laquelle le
   rapprochement coûts ↔ ventes tombe à près de zéro.
2. **Le service qui sert l'instantané derrière IAP**, si l'option bucket privé
   est retenue — et elle devrait l'être.
3. **La configuration IAP elle-même** : load balancer, certificat, liste des
   utilisateurs autorisés.
4. **Le branchement du drill-through dans l'interface.** L'API est prête et
   testée ; aucun bouton ne l'appelle encore. Le catalogue est exposé sur
   `/catalogue` pour que le front n'ait pas à redéclarer ces définitions.
5. **Alertes d'exploitation** : notification sur échec du job, sur ligne
   `ALERTE` dans `journal_reconciliation`, et sur absence de publication
   depuis plus de 48 h.
6. **Multi-tenant.** Écarté à ce stade. Rien ne le bloque : le registre est
   déjà déclaratif, il faudrait un instantané par tenant et un claim
   d'identité pilotant les filtres de lignes.

---

## Ce que Looker fait encore mieux

Autant l'assumer devant le chef. La valeur de Looker n'est pas ses
graphiques, c'est LookML : les métriques définies une fois, avec la garantie
qu'un ratio se calcule en `SUM/SUM`. `semantique/registre.py` tient ce rôle,
et le type `Ratio` rend l'erreur inexprimable — il n'existe aucun champ où
ranger un taux pré-calculé.

Ce que cette couche n'a pas, et n'aura pas sans un chantier dédié :
l'exploration ad hoc en glisser-déposer, l'envoi programmé par mail, les
alertes configurables, un modèle de permissions fin, le SDK d'embarquement,
la bibliothèque de connecteurs.

Battre Looker **sur ce cas d'usage** est atteignable, et largement fait :
Looker est faible exactement là où ce projet est fort — règles métier
assumées, explication en clair des limites, page de réconciliation. Mais
reconstruire *Looker* est un chantier de plusieurs trimestres, et ce n'est pas
ce qui a été livré.

---

## Arborescence

```
sql/12_fix_v_resultat_jour.sql       correctif du LEFT JOIN — bloquant
sql/13_ddl_sources_manquantes.sql    coûts, inventaire, totaux POS + 2 vues

semantique/registre.py               LA couche sémantique. Source unique.
semantique/registre.json             émis, consommé par le front

snapshot_builder/main.py             job : registre → BigQuery → GCS
snapshot_builder/invariants.py       les 6 contrôles bloquants

query_api/main.py                    service de détail + garde-fous
query_api/requetes.py                catalogue en liste blanche

web/coquille.html  pages.html  render.js  chargement.js  build.py
infra/main.tf  variables.tf
```

## Développement local

```bash
python semantique/registre.py                    # valide et émet le registre
python snapshot_builder/main.py --dry-run        # SQL généré, sans BigQuery
cd web && python build.py --demo ../../data_v2.json
python -m http.server 8770 --directory dist      # toute la chaîne d'affichage
```

L'API tourne sans identité avec `AUTH_DESACTIVEE=true` — **jamais en
production** : le service détient le compte de service BigQuery.
