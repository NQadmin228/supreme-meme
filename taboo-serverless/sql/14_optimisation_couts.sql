-- =====================================================================
-- TABOO — Vues materialisees et audit de cout
-- A executer apres 13_ddl_sources_manquantes.sql.
-- =====================================================================
--
-- CE QUE CE FICHIER FAIT, ET CE QU'IL NE FAIT PAS
-- -----------------------------------------------
-- Le partitionnement, le clustering, le cache et l'absence de SELECT *
-- sont DEJA en place :
--   * analytics.ventes           partitionnee jour_exploitation, clusterisee type/categorie/article
--   * analytics.etats_famille    partitionnee date_calendaire, clusterisee type/categorie/produit
--   * analytics.depenses         partitionnee jour_exploitation, clusterisee nature/poste
--   * analytics.articles_offerts partitionnee jour_exploitation, clusterisee caissier/categorie
--   * use_query_cache = TRUE dans le generateur et dans l'API
--   * les colonnes sont nommees une par une : le registre REFUSE un
--     SELECT * a la validation, avant qu'aucune requete ne parte
--
-- Ce fichier ajoute le quatrieme levier : la PRE-AGREGATION.
--
-- POURQUOI DES VUES MATERIALISEES ET NON DES TABLES
-- -------------------------------------------------
-- Une table pre-agregee doit etre rafraichie par une requete planifiee,
-- qui rescanne la source a chaque passage : on deplace le cout, on ne le
-- supprime pas. Une vue materialisee est maintenue INCREMENTALEMENT par
-- BigQuery -- seules les partitions modifiees sont relues -- et BigQuery
-- reecrit automatiquement les requetes eligibles pour la lire, meme
-- quand elles visent la table de base.
--
-- CONTRAINTE A CONNAITRE : une vue materialisee doit lire une TABLE, pas
-- une vue. Elles sont donc definies sur analytics.*, jamais sur
-- reporting.v_*. Ni ORDER BY, ni fonction de fenetre, ni SAFE_DIVIDE
-- n'y sont admis -- ce qui tombe bien : ces vues ne portent que des
-- sommes, et les ratios se calculent de toute facon a l'affichage.
--
-- ORDRE DE GRANDEUR REEL, POUR NE PAS SUR-OPTIMISER
-- -------------------------------------------------
-- analytics pese environ 60 Mo. Le generateur d'instantane scanne de
-- l'ordre de 200 Mo par execution, soit ~6 Go par mois : 0,6 % du
-- palier gratuit de 1 To. Le cout n'est donc PAS un probleme aujourd'hui.
-- Ces vues le divisent encore par dix, et surtout elles gardent la
-- facture plate quand l'historique doublera.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Ventes au grain jour x activite x categorie
--    Alimente le jeu ventes_categorie_jour (22 767 lignes en sortie,
--    contre 219 696 lignes scannees sans elle).
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS
  `VOTRE_PROJET_GCP.analytics.mv_ventes_jour_categorie`
PARTITION BY jour_exploitation
CLUSTER BY type, categorie
OPTIONS (
  -- 1440 minutes : un rafraichissement par jour suffit, la donnee
  -- n'arrive qu'apres le MERGE nocturne. Un intervalle court ferait
  -- travailler BigQuery pour rien.
  enable_refresh = TRUE,
  refresh_interval_minutes = 1440
)
AS
SELECT
  jour_exploitation, type, categorie,
  SUM(quantite) AS quantite,
  SUM(ca_net)   AS ca_net,
  SUM(remise)   AS remise,
  COUNT(*)      AS nb_lignes
FROM `VOTRE_PROJET_GCP.analytics.ventes`
GROUP BY jour_exploitation, type, categorie;


-- ---------------------------------------------------------------------
-- 2. Ventes au grain article, sans dimension temporelle
--    Alimente le catalogue (274 lignes). C'est la requete la plus
--    rentable a materialiser : elle agrege tout l'historique.
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS
  `VOTRE_PROJET_GCP.analytics.mv_ventes_article`
CLUSTER BY type, categorie
OPTIONS (enable_refresh = TRUE, refresh_interval_minutes = 1440)
AS
SELECT
  type, categorie, article,
  SUM(quantite) AS quantite,
  SUM(ca_net)   AS ca_net,
  SUM(remise)   AS remise,
  COUNT(*)      AS nb_lignes
FROM `VOTRE_PROJET_GCP.analytics.ventes`
GROUP BY type, categorie, article;


-- ---------------------------------------------------------------------
-- 3. Profil horaire au grain jour x heure x activite
--    Alimente horaire_jour, le plus gros jeu de l'instantane
--    (30 381 lignes).
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS
  `VOTRE_PROJET_GCP.analytics.mv_horaire_jour`
PARTITION BY jour_exploitation
CLUSTER BY type
OPTIONS (enable_refresh = TRUE, refresh_interval_minutes = 1440)
AS
SELECT
  jour_exploitation,
  EXTRACT(HOUR FROM heure) AS heure_num,
  type,
  SUM(quantite) AS quantite,
  SUM(ca_net)   AS ca_net,
  COUNT(*)      AS nb_lignes
FROM `VOTRE_PROJET_GCP.analytics.ventes`
GROUP BY jour_exploitation, heure_num, type;


-- ---------------------------------------------------------------------
-- 4. Compte de resultat au grain jour x activite
--    Le jeu le plus lu de tout le tableau de bord : il alimente la
--    Synthese, le Compte de resultat et la Marge par activite.
--    Materialise depuis etats_famille seule -- la partie achats vient de
--    depenses, et une vue materialisee n'admet pas de jointure externe.
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS
  `VOTRE_PROJET_GCP.analytics.mv_ca_jour_activite`
PARTITION BY date_calendaire
CLUSTER BY type
OPTIONS (enable_refresh = TRUE, refresh_interval_minutes = 1440)
AS
SELECT
  date_calendaire, type,
  SUM(ca_brut)          AS ca_brut,
  SUM(total_remise)     AS total_remise,
  SUM(ca_net)           AS ca_net,
  SUM(quantite_vendue)  AS quantite_vendue,
  SUM(quantite_offerte) AS quantite_offerte
FROM `VOTRE_PROJET_GCP.analytics.etats_famille`
WHERE type IN ('DRINK','EAT','SMOKE')
GROUP BY date_calendaire, type;


-- =====================================================================
-- REECRITURE AUTOMATIQUE — a verifier, pas a supposer
-- =====================================================================
-- BigQuery redirige de lui-meme une requete vers une vue materialisee
-- quand elle est eligible. Rien ne le garantit : une clause non
-- supportee suffit a annuler la reecriture, silencieusement, et on
-- continue de payer le scan complet.
--
-- Verifier sur la requete generee pour ventes_categorie_jour. Le plan
-- doit mentionner mv_ventes_jour_categorie, et total_bytes_processed
-- doit chuter d'un ordre de grandeur.
/*
SELECT
  jour_exploitation, type AS t, categorie AS c,
  SUM(quantite) AS q, SUM(ca_net) AS cn, SUM(remise) AS rm
FROM `VOTRE_PROJET_GCP.analytics.ventes`
GROUP BY 1, 2, 3;
-- Puis, dans la console : onglet « Execution details » -> chercher le
-- nom de la vue materialisee. Ou en SQL :
SELECT job_id, total_bytes_processed, total_bytes_billed, cache_hit
FROM `VOTRE_PROJET_GCP.region-europe-west1`.INFORMATION_SCHEMA.JOBS_BY_PROJECT
WHERE creation_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
ORDER BY creation_time DESC LIMIT 5;
*/


-- =====================================================================
-- AUDIT DE COUT — a passer une fois par mois
-- =====================================================================
-- Ou part reellement le quota. A lancer avant toute optimisation
-- supplementaire : optimiser sans mesurer, c'est deviner.
/*
SELECT
  DATE(creation_time) AS jour,
  COALESCE(labels.value, 'sans etiquette') AS origine,
  COUNT(*) AS requetes,
  ROUND(SUM(total_bytes_billed) / POW(1024,3), 2) AS gio_factures,
  ROUND(SUM(IF(cache_hit, 1, 0)) * 100 / COUNT(*), 1) AS pct_cache,
  ROUND(SUM(total_bytes_billed) / POW(1024,4) * 6.25, 4) AS cout_usd_estime
FROM `VOTRE_PROJET_GCP.region-europe-west1`.INFORMATION_SCHEMA.JOBS_BY_PROJECT
LEFT JOIN UNNEST(labels) AS labels ON labels.key = 'etape'
WHERE creation_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  AND job_type = 'QUERY' AND state = 'DONE'
GROUP BY jour, origine
ORDER BY jour DESC, gio_factures DESC;
*/
-- Les etiquettes viennent du code : le generateur pose etape=instantane,
-- l'API pose etape=detail. Tout ce qui ressort « sans etiquette » a donc
-- ete lance a la main dans la console -- et c'est la, en pratique, que
-- part le quota d'un projet BigQuery.

-- Les dix requetes les plus couteuses du mois.
/*
SELECT
  user_email, job_id, DATE(creation_time) AS jour,
  ROUND(total_bytes_billed / POW(1024,3), 2) AS gio,
  cache_hit, SUBSTR(REGEXP_REPLACE(query, r'\s+', ' '), 1, 160) AS extrait
FROM `VOTRE_PROJET_GCP.region-europe-west1`.INFORMATION_SCHEMA.JOBS_BY_PROJECT
WHERE creation_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  AND job_type = 'QUERY' AND state = 'DONE' AND total_bytes_billed > 0
ORDER BY total_bytes_billed DESC LIMIT 10;
*/


-- =====================================================================
-- require_partition_filter — pourquoi ce n'est PAS active
-- =====================================================================
-- L'option interdit toute requete qui ne filtre pas sur la colonne de
-- partition : un scan complet accidentel devient impossible. C'est le
-- garde-fou le plus fort de BigQuery.
--
-- Elle n'est pas activee ici, et c'est un choix : l'instantane agrege
-- VOLONTAIREMENT tout l'historique, sans filtre de date. L'activer
-- casserait dix des quatorze requetes du registre.
--
-- Si le projet grossit au point que le cout compte, l'activer ET faire
-- declarer au registre une borne explicite :
--
--   ALTER TABLE `...analytics.ventes`
--   SET OPTIONS (require_partition_filter = TRUE);
--
--   -- puis dans chaque requete du registre :
--   WHERE jour_exploitation BETWEEN '2023-04-01' AND CURRENT_DATE('Africa/Lome')
--
-- Le filtre couvre tout l'historique : il ne reduit rien. Son interet
-- est d'obliger chaque requete a DIRE sa periode, si bien qu'une
-- omission echoue au lieu de scanner la table entiere en silence.
-- Aujourd'hui, maximum_bytes_billed joue ce role sans contrainte
-- d'ecriture.
-- =====================================================================
