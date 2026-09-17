-- =====================================================================
-- TABOO — Sources presentes dans le dashboard valide mais ABSENTES de BigQuery
-- A executer avant le premier generateur d'instantane.
-- =====================================================================
--
-- POURQUOI CE FICHIER
-- -------------------
-- Le tableau de bord valide par la direction s'appuie sur trois sources qui
-- n'ont jamais ete chargees dans BigQuery. Elles n'existaient que sous forme
-- de CSV locaux. Sans elles, la couche de service ne peut pas reproduire
-- trois pages :
--
--   couts_de_revient  -> page "Cout de revient" (la marge theorique, et
--                        l'ecart de l'ecart mesure sur EAT qui est le constat
--                        central presente a la direction)
--   inventaire        -> page "Stock & inventaire"
--   totaux_pos        -> nombre de paniers et panier moyen, SEULE source
--                        du ticket moyen : le journal de vente n'a aucun
--                        identifiant de ticket
--
-- A noter : reporting.v_cout_revient existe deja, mais lit
-- etats_famille.cout, renseigne sur 4 lignes sur 58 943. Elle porte
-- elle-meme l'avertissement "chantier 4 en cours". Ce fichier EST le
-- chantier 4. La vue est redefinie plus bas sur la vraie source.
--
-- MODE DE CHARGEMENT
-- ------------------
-- Meme parti que la couche RAW existante (03_ddl_raw.sql) : tables
-- EXTERNES BigLake sur le bucket, toutes colonnes en STRING, typage fait
-- au MERGE. Coherent avec le reste, et une table externe reflete l'etat
-- du bucket -- rien a purger, rien a dedupliquer.
--
-- Deposer les fichiers dans :
--   gs://VOTRE_BUCKET_SOURCES/referentiel/couts_de_revient.csv
--   gs://VOTRE_BUCKET_SOURCES/referentiel/inventaire.csv
--   gs://VOTRE_BUCKET_SOURCES/referentiel/ca_globale.csv
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. RAW — couts de revient
--    En-tete : type_source;categorie;produit;cout_revient;prix_vente;statut_cout
-- ---------------------------------------------------------------------
CREATE OR REPLACE EXTERNAL TABLE `VOTRE_PROJET_GCP.raw_data.raw_couts_revient` (
  type_source STRING, categorie STRING, produit STRING,
  cout_revient STRING, prix_vente STRING, statut_cout STRING
)
WITH CONNECTION `VOTRE_PROJET_GCP.europe-west1.taboo-gcs`
OPTIONS (
  format = 'CSV', field_delimiter = ';', skip_leading_rows = 1,
  encoding = 'UTF-8', allow_jagged_rows = TRUE, allow_quoted_newlines = TRUE,
  uris = ['gs://VOTRE_BUCKET_SOURCES/referentiel/couts_de_revient*.csv']
);

-- ---------------------------------------------------------------------
-- 2. RAW — inventaire
--    En-tete : Catégorie;Articles;Qté théorique;Stock Alerte;Qté physique;Ecart;Unité
-- ---------------------------------------------------------------------
CREATE OR REPLACE EXTERNAL TABLE `VOTRE_PROJET_GCP.raw_data.raw_inventaire` (
  categorie STRING, articles STRING, qte_theorique STRING,
  stock_alerte STRING, qte_physique STRING, ecart STRING, unite STRING
)
WITH CONNECTION `VOTRE_PROJET_GCP.europe-west1.taboo-gcs`
OPTIONS (
  format = 'CSV', field_delimiter = ';', skip_leading_rows = 1,
  encoding = 'UTF-8', allow_jagged_rows = TRUE, allow_quoted_newlines = TRUE,
  uris = ['gs://VOTRE_BUCKET_SOURCES/referentiel/inventaire*.csv']
);

-- ---------------------------------------------------------------------
-- 3. RAW — totaux POS de controle (format cle/valeur, 3 colonnes)
-- ---------------------------------------------------------------------
CREATE OR REPLACE EXTERNAL TABLE `VOTRE_PROJET_GCP.raw_data.raw_ca_globale` (
  libelle STRING, valeur STRING, complement STRING
)
WITH CONNECTION `VOTRE_PROJET_GCP.europe-west1.taboo-gcs`
OPTIONS (
  format = 'CSV', field_delimiter = ';', skip_leading_rows = 1,
  encoding = 'UTF-8', allow_jagged_rows = TRUE, allow_quoted_newlines = TRUE,
  uris = ['gs://VOTRE_BUCKET_SOURCES/referentiel/ca_globale*.csv']
);


-- =====================================================================
-- ANALYTICS — tables typees
-- =====================================================================
-- Ces trois referentiels sont petits (162, 105 et ~17 lignes) et n'ont pas
-- de dimension temporelle : ni partitionnement ni clustering. Les
-- surpartitionner couterait plus en metadonnees qu'il n'economiserait.

CREATE TABLE IF NOT EXISTS `VOTRE_PROJET_GCP.analytics.couts_revient` (
  cle_produit  STRING  NOT NULL OPTIONS(description="Libelle normalise : majuscules, sans accent, espaces reduits. Cle de rapprochement avec les ventes."),
  produit      STRING  NOT NULL OPTIONS(description="Libelle d'origine de la fiche technique."),
  type_source  STRING  OPTIONS(description="cuisine / bar / autre : atelier d'ou vient la fiche."),
  categorie    STRING,
  cout_revient NUMERIC OPTIONS(description="Cout matiere unitaire issu de la fiche technique."),
  prix_vente   NUMERIC OPTIONS(description="Prix de vente de reference de la fiche. Peut differer du prix pratique."),
  statut_cout  STRING  OPTIONS(description="'Complet' ou 'Partiel — ingredient manquant'. Un cout PARTIEL est SOUS-EVALUE, donc surevalue la marge : a exposer dans l'interface, jamais a masquer."),
  charge_le    TIMESTAMP
)
OPTIONS(description="Fiches techniques : cout matiere par produit. Alimente la marge THEORIQUE, a confronter a la marge REELLE de v_resultat_jour.");

CREATE TABLE IF NOT EXISTS `VOTRE_PROJET_GCP.analytics.inventaire` (
  cle_article   STRING  NOT NULL OPTIONS(description="Libelle normalise, pour rapprocher avec couts_revient."),
  article       STRING  NOT NULL,
  categorie     STRING,
  qte_theorique NUMERIC OPTIONS(description="Stock theorique tenu par le POS."),
  stock_alerte  NUMERIC OPTIONS(description="Seuil de reapprovisionnement. 0 = non parametre, donc AUCUNE alerte possible sur cet article."),
  qte_physique  NUMERIC OPTIONS(description="Comptage physique. A 0 sur les 105 articles au 26/08/2026 : jamais saisi."),
  ecart         NUMERIC OPTIONS(description="NE PAS LIRE COMME UNE DEMARQUE tant que qte_physique est nulle : l'ecart vaut alors mecaniquement l'oppose du stock theorique."),
  unite         STRING,
  charge_le     TIMESTAMP
)
OPTIONS(description="Inventaire ponctuel. Exploitable : stock theorique et seuils d'alerte. Non exploitable tant qu'il n'y a pas de comptage : demarque, rotation, valorisation certifiee.");

-- Table mono-ligne : les totaux de controle du POS pour la periode.
CREATE TABLE IF NOT EXISTS `VOTRE_PROJET_GCP.analytics.totaux_pos` (
  nb_panier         INT64   OPTIONS(description="Nombre de paniers sur la periode. SEULE source du ticket moyen : le journal de vente n'a pas d'identifiant de ticket."),
  panier_moyen      NUMERIC OPTIONS(description="Panier moyen selon le rapport CA global du POS."),
  nombre_vendu      INT64,
  remise_pos        NUMERIC OPTIONS(description="Remise selon le rapport CA global. Diverge de etats_famille : perimetres differents. Ne pas substituer a la source de verite."),
  total_offert      INT64   OPTIONS(description="Nombre d'articles offerts."),
  ca_ht_hors_offert NUMERIC OPTIONS(description="Ecart structurel connu avec etats_famille : les deux rapports POS ne couvrent pas le meme perimetre d'articles. Surveiller sa variation, pas son niveau."),
  ca_offert         NUMERIC,
  charge_le         TIMESTAMP
)
OPTIONS(description="Totaux de controle du POS. Servent au ticket moyen et a la reconciliation, jamais de base a un calcul de marge.");


-- =====================================================================
-- REDEFINITION — reporting.v_cout_revient sur la VRAIE source
-- =====================================================================
-- Remplace la version de 11_views_reporting_v2.sql, qui lisait
-- etats_famille.cout (4 lignes renseignees sur 58 943).
--
-- Grain : produit. Cumul sur toute la periode : une fiche technique n'a
-- pas de dimension temporelle, et rattacher un cout fige a un jour de
-- vente donnerait une fausse impression de suivi dans le temps.
--
-- Mesures additives uniquement : ca_net, cout_total, marge_theorique.
-- Le TAUX de marge theorique n'est PAS calcule ici -- il se calcule en
-- SUM(marge_theorique)/SUM(ca_net) dans l'interface, sinon un filtre par
-- categorie renverrait la moyenne des taux produit et non le taux de la
-- categorie.
CREATE OR REPLACE VIEW `VOTRE_PROJET_GCP.reporting.v_cout_revient` AS
WITH ventes_produit AS (
  SELECT
    type, categorie, article,
    -- Cle de rapprochement : les deux fichiers sont saisis a la main a des
    -- moments differents, donc accents, casse et espaces doubles divergent.
    -- Sans normalisation le rapprochement tombe a pres de zero.
    REGEXP_REPLACE(
      TRIM(UPPER(NORMALIZE_AND_CASEFOLD(article, NFKC))), r'\s+', ' '
    ) AS cle_article,
    SUM(quantite) AS quantite,
    SUM(ca_net)   AS ca_net,
    SUM(ca_brut)  AS ca_brut,
    SUM(remise)   AS remise
  FROM `VOTRE_PROJET_GCP.reporting.v_ventes_jour`
  GROUP BY 1, 2, 3, 4
)
SELECT
  'cumul_periode_complete' AS perimetre_temporel,
  v.type AS activite, v.categorie, v.article,
  c.type_source, c.statut_cout,
  c.cout_revient, c.prix_vente,
  v.quantite, v.ca_net, v.ca_brut, v.remise,
  -- Mesures additives
  ROUND(c.cout_revient * v.quantite)            AS cout_total,
  ROUND(v.ca_net - c.cout_revient * v.quantite) AS marge_theorique,
  c.statut_cout = 'Complet'                      AS cout_complet
FROM ventes_produit AS v
JOIN `VOTRE_PROJET_GCP.analytics.couts_revient` AS c
  ON c.cle_produit = v.cle_article
WHERE v.quantite > 0;


-- =====================================================================
-- reporting.v_inventaire — stock valorise et alertes
-- =====================================================================
-- La valorisation et le statut d'alerte appartiennent a la couche
-- semantique, pas a l'interface : les calculer dans le navigateur
-- signifierait les recalculer differemment dans chaque consommateur de
-- l'instantane (interface, export, rapport). Ils sont donc definis ici,
-- une fois.
--
-- Un seuil a 0 signifie « non parametre dans le POS » : ces articles ne
-- peuvent structurellement PAS declencher d'alerte, et les compter comme
-- « stock suffisant » serait trompeur. Le champ seuil_parametre permet a
-- l'interface de le dire.
CREATE OR REPLACE VIEW `VOTRE_PROJET_GCP.reporting.v_inventaire` AS
SELECT
  'cumul_periode_complete' AS perimetre_temporel,
  i.categorie, i.article,
  i.qte_theorique, i.stock_alerte, i.qte_physique, i.ecart, i.unite,
  -- Valorisation au cout de revient, la ou il est connu. NULL sinon :
  -- valoriser a zero un article sans fiche technique sous-estimerait le
  -- stock sans que cela se voie.
  CASE WHEN c.cout_revient IS NOT NULL
       THEN ROUND(i.qte_theorique * c.cout_revient)
  END AS valeur_stock,
  c.cout_revient,
  i.stock_alerte > 0                                     AS seuil_parametre,
  i.stock_alerte > 0 AND i.qte_theorique <= i.stock_alerte AS sous_alerte,
  i.qte_theorique <= 0                                   AS en_rupture
FROM `VOTRE_PROJET_GCP.analytics.inventaire` AS i
LEFT JOIN `VOTRE_PROJET_GCP.analytics.couts_revient` AS c
  ON c.cle_produit = i.cle_article;


-- =====================================================================
-- CONTROLES — valeurs attendues sur le jeu du 26/08/2026
-- =====================================================================
-- Rapprochement des couts. Attendu : 78 produits apparies, couvrant
-- la couverture des couts du CA total.
/*
SELECT COUNT(*) AS produits_apparies, SUM(ca_net) AS ca_couvert,
       ROUND(100 * SAFE_DIVIDE(SUM(marge_theorique), SUM(ca_net)), 1) AS marge_theo_pct
FROM `VOTRE_PROJET_GCP.reporting.v_cout_revient`;
*/
--
-- Marge theorique par activite. Attendu :
--   DRINK 40,9 % | EAT la marge theorique | SMOKE 70,5 %
-- A confronter aux marges REELLES de v_resultat_jour :
--   DRINK 46,5 % | EAT la marge reelle de EAT | SMOKE 85,4 %
-- L'ecart de l'ecart mesure sur EAT est le constat central du dossier.
/*
SELECT activite, SUM(ca_net) AS ca_couvert, SUM(cout_total) AS cout,
       ROUND(100 * SAFE_DIVIDE(SUM(marge_theorique), SUM(ca_net)), 1) AS marge_theo_pct
FROM `VOTRE_PROJET_GCP.reporting.v_cout_revient`
GROUP BY activite ORDER BY activite;
*/
--
-- Controle de robustesse : la marge theorique de EAT sur les seules
-- recettes COMPLETES. Attendu 73,3 % sur 19 recettes -- donc l'ecart avec
-- la marge reelle ne vient PAS de la qualite des fiches techniques.
/*
SELECT COUNT(*) AS recettes, SUM(ca_net) AS ca_couvert,
       ROUND(100 * SAFE_DIVIDE(SUM(marge_theorique), SUM(ca_net)), 1) AS marge_theo_pct
FROM `VOTRE_PROJET_GCP.reporting.v_cout_revient`
WHERE activite = 'EAT' AND cout_complet;
*/
-- =====================================================================
