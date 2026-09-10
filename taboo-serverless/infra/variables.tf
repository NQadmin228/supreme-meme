variable "projet" {
  type        = string
  default     = "VOTRE_PROJET_GCP"
  description = "Projet GCP portant le jeu BigQuery existant."
}

variable "region" {
  type        = string
  default     = "europe-west1"
  description = <<-TXT
    Region du jeu BigQuery. Ne pas changer sans deplacer BigQuery :
    une requete ne peut pas atteindre un jeu de donnees situe dans une
    autre region.
  TXT
}

variable "bucket_instantanes" {
  type        = string
  default     = "VOTRE_BUCKET_INSTANTANES"
  description = "Bucket recevant les instantanes publies et le manifeste."
}

variable "image_instantane" {
  type        = string
  description = "Image du job de generation, dans Artifact Registry."
}

variable "image_api" {
  type        = string
  description = "Image du service d'API de detail."
}

variable "origines_autorisees" {
  type        = list(string)
  default     = []
  description = <<-TXT
    Origines autorisees a lire l'instantane et appeler l'API.
    Laisser vide interdit tout appel navigateur cross-origin : c'est le
    defaut voulu, on ouvre explicitement. Ne jamais mettre "*" : ce
    service repond avec le compte de resultat de l'etablissement.
  TXT
}

variable "instantane_public" {
  type        = bool
  default     = false
  description = <<-TXT
    Rend le bucket d'instantanes lisible par tous.

    Laisse a false volontairement. Les instantanes contiennent le compte
    de resultat complet : CA, marges, salaires implicites, performance
    par caissier. Un bucket public protege par une URL non devinable
    n'est pas un controle d'acces -- une URL circule toujours.

    Ne passer a true que pour un jeu de demonstration anonymise.
  TXT
}

variable "plafond_octets_requete" {
  type        = number
  default     = 2147483648 # 2 Gio
  description = <<-TXT
    maximum_bytes_billed applique a chaque requete du generateur.
    Disjoncteur et non budget : l'ensemble des tables analytics pese
    quelques dizaines de Mo, donc 2 Gio est deja tres large. Une requete
    qui l'atteint est anormale, et il vaut mieux qu'elle echoue.
  TXT
}

variable "bi_engine_octets" {
  type        = number
  default     = 1073741824 # 1 Gio
  description = <<-TXT
    Taille de la reservation BI Engine. 1 Gio suffit a contenir tout le
    jeu analytics, ce qui met les requetes de detail sous la seconde et
    supprime le scan de stockage.
  TXT
}

variable "horaire_instantane" {
  type        = string
  default     = "30 3 * * *"
  description = <<-TXT
    Horaire cron de la generation, en Africa/Lome.

    03h30 laisse une marge apres la requete planifiee taboo-merge-analytics.
    ATTENTION : 05_merge_analytics.sql porte la mention « 02h00 est A
    REVOIR ». Verifier l'horaire reel du MERGE avant de figer celui-ci :
    generer l'instantane pendant le MERGE publierait des donnees a moitie
    transformees, et les invariants ne le detecteraient pas forcement --
    une transformation partielle peut rester coherente avec elle-meme.

    A noter aussi que la journee d'exploitation se termine a 13h59. Un
    instantane genere a 03h30 ne contient donc pas la nuit en cours,
    ce qui est correct : elle n'est pas terminee.
  TXT
}
