-- =====================================================================
-- TABOO — CORRECTIF de reporting.v_resultat_jour
-- A executer APRES 11_views_reporting_v2.sql, qu'il remplace sur ce point.
-- =====================================================================
--
-- LE DEFAUT CORRIGE
-- -----------------
-- La version de 11_views_reporting_v2.sql assemblait ainsi :
--
--     FROM ca                                  -- issu de etats_famille : les VENTES
--     LEFT JOIN achats USING (jour_exploitation, activite)
--
-- Le cote gauche etant les ventes, tout achat engage un jour ou l'activite
-- n'a rien vendu DISPARAIT du perimetre. Ce n'est pas theorique : les jours
-- de fermeture ou l'etablissement se reapprovisionne sans ouvrir tombent
-- exactement dans ce cas.
--
-- Mesure sur le jeu de reference : 7 couples (jour, activite) concernes,
-- repartis sur 4 dates de fermeture. Les montants exacts sont dans
-- valeurs_controle.json, non versionne.
--
-- La requete de controle 3, en fin de fichier, les fait ressortir :
-- ce sont les seules lignes ou ca_net est nul et achats_externes non nul.
--
-- Effet sur la marge brute :
--   LEFT JOIN  (avant)  marge surevaluee
--   FULL OUTER (apres)  marge validee par la direction
-- L'ecart represente environ 0,12 % de la marge brute : invisible a
-- l'oeil, et faux. Les montants exacts sont dans valeurs_controle.json,
-- non versionne.
--
-- A noter : le bloc "CONTROLES APRES EXECUTION" de 11_views_reporting_v2.sql
-- annonce deja la valeur CORRIGEE. La vue n'avait donc jamais ete
-- confrontee a sa propre attente documentee. C'est le genre d'ecart
-- qu'un controle automatise attrape et qu'une relecture manque.
--
-- LA CORRECTION
-- -------------
-- Le perimetre devient l'UNION des jours de vente et des jours d'achat.
-- La jointure est ecrite en ON ... AND ... plutot qu'en USING : sur un
-- FULL OUTER, USING masque de quel cote vient la cle, et l'intention
-- (coalescer explicitement) doit rester lisible.
--
-- Les jours sans vente ont un ca_net nul, donc une cle de repartition
-- nulle : ils ne recoivent aucun OPEX ni CAPEX ventile. Leurs achats
-- pesent en revanche pleinement sur la marge, ce qui est le comportement
-- voulu -- un achat est un achat, meme un jour de fermeture.
-- =====================================================================

CREATE OR REPLACE VIEW `VOTRE_PROJET_GCP.reporting.v_resultat_jour` AS
WITH
-- Produits, au grain jour x activite. Source de verite du CA et de la remise.
ca AS (
  SELECT
    date_calendaire AS jour_exploitation,
    type            AS activite,
    SUM(ca_brut)          AS ca_brut,
    SUM(total_remise)     AS remise,
    SUM(ca_net)           AS ca_net,
    SUM(quantite_vendue)  AS quantite_vendue,
    SUM(quantite_offerte) AS quantite_offerte
  FROM `VOTRE_PROJET_GCP.analytics.etats_famille`
  WHERE type IN ('DRINK','EAT','SMOKE')
  GROUP BY 1, 2
),

-- Achats DIRECTS : chaque poste est rattache a une activite, donc aucune
-- cle de repartition n'intervient ici.
achats AS (
  SELECT
    jour_exploitation,
    categorie_vente AS activite,
    SUM(montant)    AS achats_externes
  FROM `VOTRE_PROJET_GCP.analytics.depenses`
  WHERE nature = 'ACHATS EXTERNES' AND categorie_vente IS NOT NULL
  GROUP BY 1, 2
),

-- ***** LE CORRECTIF : union des deux perimetres, pas seulement les ventes.
perimetre AS (
  SELECT
    COALESCE(ca.jour_exploitation, a.jour_exploitation) AS jour_exploitation,
    COALESCE(ca.activite,          a.activite)          AS activite,
    IFNULL(ca.ca_brut,          0) AS ca_brut,
    IFNULL(ca.remise,           0) AS remise,
    IFNULL(ca.ca_net,           0) AS ca_net,
    IFNULL(ca.quantite_vendue,  0) AS quantite_vendue,
    IFNULL(ca.quantite_offerte, 0) AS quantite_offerte,
    IFNULL(a.achats_externes,   0) AS achats_externes
  FROM ca
  FULL OUTER JOIN achats AS a
    ON  ca.jour_exploitation = a.jour_exploitation
    AND ca.activite          = a.activite
),

-- OPEX et CAPEX ne sont rattachables a aucune activite : ventiles par jour
-- au prorata du CA net du jour. Le montant ventile redevient additif, donc
-- juste sous n'importe quel filtre de periode.
charges AS (
  SELECT
    jour_exploitation,
    SUM(IF(nature = 'OPEX',  montant, 0)) AS opex_jour,
    SUM(IF(nature = 'CAPEX', montant, 0)) AS capex_jour
  FROM `VOTRE_PROJET_GCP.analytics.depenses`
  GROUP BY 1
),

assemble AS (
  SELECT
    p.jour_exploitation, p.activite,
    p.ca_brut, p.remise, p.ca_net, p.quantite_vendue, p.quantite_offerte,
    p.achats_externes,
    -- Un jour d'achat sans vente a un ca_net nul : SAFE_DIVIDE renvoie NULL,
    -- la cle vaut donc 0 et aucune charge ne lui est ventilee.
    SAFE_DIVIDE(p.ca_net, SUM(p.ca_net) OVER (PARTITION BY p.jour_exploitation)) AS cle_jour,
    IFNULL(ch.opex_jour,  0) AS opex_jour,
    IFNULL(ch.capex_jour, 0) AS capex_jour
  FROM perimetre AS p
  LEFT JOIN charges AS ch USING (jour_exploitation)
)

SELECT
  'filtrable' AS perimetre_temporel,
  c.annee, c.trimestre, c.mois_num, c.annee_mois, c.mois_nom, c.debut_mois,
  c.debut_semaine, c.semaine_num, c.jour_semaine, c.jour_semaine_num,
  s.jour_exploitation, s.activite,
  -- Produits
  s.ca_brut, s.remise, s.ca_net, s.quantite_vendue, s.quantite_offerte,
  -- Charges, toutes additives
  s.achats_externes,
  ROUND(s.opex_jour  * IFNULL(s.cle_jour, 0)) AS opex,
  ROUND(s.capex_jour * IFNULL(s.cle_jour, 0)) AS capex,
  -- Soldes intermediaires, additifs par construction
  s.ca_net - s.achats_externes AS marge_brute,
  s.ca_net - s.achats_externes
    - ROUND(s.opex_jour * IFNULL(s.cle_jour, 0)) AS resultat_exploitation,
  s.ca_net - s.achats_externes
    - ROUND(s.opex_jour  * IFNULL(s.cle_jour, 0))
    - ROUND(s.capex_jour * IFNULL(s.cle_jour, 0)) AS resultat_net
FROM assemble AS s
JOIN `VOTRE_PROJET_GCP.reporting.v_calendrier` AS c USING (jour_exploitation);


-- =====================================================================
-- CONTROLE — a executer juste apres, et a comparer aux valeurs attendues
-- =====================================================================
-- Le generateur d'instantane rejoue ces memes controles a chaque
-- execution et refuse de publier si l'un d'eux echoue (voir
-- snapshot_builder/invariants.py). Les lancer ici valide la vue elle-meme.
--
-- 1. Aucun achat ne doit avoir disparu du perimetre.
--    Attendu : ecart = 0. Le total des achats est dans valeurs_controle.json.
/*
WITH v AS (
  SELECT SUM(achats_externes) AS achats_vue
  FROM `VOTRE_PROJET_GCP.reporting.v_resultat_jour`
),
s AS (
  SELECT SUM(montant) AS achats_source
  FROM `VOTRE_PROJET_GCP.analytics.depenses`
  WHERE nature = 'ACHATS EXTERNES' AND categorie_vente IS NOT NULL
)
SELECT v.achats_vue, s.achats_source, v.achats_vue - s.achats_source AS ecart
FROM v CROSS JOIN s;
*/
--
-- 2. Compte de resultat complet. Les taux attendus, qui ne dependent pas
--    de l'echelle : marge brute 50,5 % du CA net, resultat d'exploitation
--    41,0 %, resultat net le taux de resultat net. Les montants sont dans
--    valeurs_controle.json.
/*
SELECT
  SUM(ca_net) AS ca_net, SUM(achats_externes) AS achats,
  SUM(marge_brute) AS marge,
  ROUND(100 * SAFE_DIVIDE(SUM(marge_brute), SUM(ca_net)), 1) AS taux_marge_pct,
  SUM(opex) AS opex, SUM(resultat_exploitation) AS res_expl,
  SUM(capex) AS capex, SUM(resultat_net) AS res_net
FROM `VOTRE_PROJET_GCP.reporting.v_resultat_jour`;
*/
--
-- 3. Les 7 couples qui etaient perdus doivent maintenant apparaitre,
--    avec un ca_net nul et un achat non nul. Attendu : 7 lignes.
/*
SELECT jour_exploitation, activite, ca_net, achats_externes, marge_brute
FROM `VOTRE_PROJET_GCP.reporting.v_resultat_jour`
WHERE ca_net = 0 AND achats_externes > 0
ORDER BY achats_externes DESC;
*/
-- =====================================================================
