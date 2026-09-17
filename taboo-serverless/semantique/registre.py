#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TABOO — Registre de metriques : la couche semantique.

CE QUE CE FICHIER REMPLACE
--------------------------
C'est l'equivalent de LookML. La valeur de Looker n'est pas ses graphiques,
c'est le fait qu'une metrique y soit definie UNE FOIS et que la plateforme
garantisse qu'un ratio se calcule en SUM/SUM. Ce fichier tient ce role, et
il est la seule source de verite pour deux consommateurs :

  1. snapshot_builder  -> genere le SQL BigQuery depuis ce registre
  2. web/              -> recoit registre.json et calcule les ratios

Definir une metrique ailleurs qu'ici est le seul moyen de casser la
coherence du produit. Il n'y a pas de second endroit.

LA GARANTIE STRUCTURELLE
------------------------
Un jeu de donnees n'expose que des mesures ADDITIVES -- des sommes, au
grain le plus fin. Un ratio n'est JAMAIS stocke : il est declare comme un
couple (numerateur, denominateur) et calcule a l'affichage.

Pourquoi c'est non negociable : un taux de remise stocke au grain mensuel,
filtre sur dix jours, renvoie la moyenne des taux mensuels et non le taux
des dix jours. Le chiffre est faux, et il est credible -- c'est la pire
combinaison. Le type Ratio ci-dessous rend cette erreur inexprimable :
il n'existe aucun champ ou ranger un taux pre-calcule.

CONVENTION DE NOMMAGE COMPACT
-----------------------------
Chaque mesure et dimension porte un alias court (`cle`). L'instantane est
serialise avec ces alias : sur 3 586 lignes x 13 mesures, ecrire "ca_net"
plutot que "cn" coute environ 25 % du poids du fichier. Le registre etant
partage, le front sait toujours a quoi correspond chaque alias.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Literal

# Le projet et la region viennent de l'environnement. Le placeholder par
# defaut est volontaire : ce depot est public, et un identifiant de
# projet en dur le rendrait inutilisable pour un autre etablissement.
# Renseigner config.env (voir config.example.env).
PROJET = os.environ.get("BQ_PROJET", "VOTRE_PROJET_GCP")
REGION = os.environ.get("BQ_REGION", "europe-west1")
DATASET_REPORTING = "reporting"
DATASET_ANALYTICS = "analytics"

Format = Literal["fcfa", "entier", "pourcent", "decimal", "texte", "date"]


# =====================================================================
# TYPES DU REGISTRE
# =====================================================================

@dataclass(frozen=True)
class Dimension:
    """Axe d'analyse. Reprise telle quelle depuis la vue, jamais agregee."""
    cle: str                      # alias court dans l'instantane
    colonne: str                  # colonne BigQuery
    libelle: str
    format: Format = "texte"


@dataclass(frozen=True)
class Mesure:
    """Grandeur ADDITIVE. Toujours sommee, jamais moyennee ni ponderee.

    Il n'existe volontairement pas d'attribut `agregation` : autoriser
    AVG ou MAX ici ouvrirait la porte a des mesures non additives, qui
    cessent d'etre justes des qu'on change de granularite.
    """
    cle: str
    colonne: str
    libelle: str
    format: Format = "fcfa"
    description: str = ""


@dataclass(frozen=True)
class Ratio:
    """Rapport de deux mesures, calcule a l'affichage en SUM/SUM.

    `numerateur` et `denominateur` designent des cles de mesures du meme
    jeu de donnees. Aucune valeur n'est stockee : c'est la definition qui
    voyage, pas le resultat.
    """
    cle: str
    libelle: str
    numerateur: str
    denominateur: str
    jeu: str
    format: Format = "pourcent"
    commentaire: str = ""


@dataclass(frozen=True)
class Jeu:
    """Un jeu de donnees de l'instantane, adosse a une vue BigQuery."""
    cle: str
    source: str                   # vue ou table BigQuery, sans le projet
    grain: str
    libelle: str
    dimensions: tuple[Dimension, ...]
    mesures: tuple[Mesure, ...]
    filtrable_par_date: bool = True
    colonne_date: str = "jour_exploitation"
    tri: tuple[str, ...] = ()
    limite: int | None = None
    avertissement: str = ""

    # -- generation SQL -------------------------------------------------
    def sql(self) -> str:
        """SELECT dimensions, SUM(mesures) GROUP BY dimensions.

        Le SQL est genere, pas ecrit a la main : ajouter une mesure au
        registre suffit pour qu'elle traverse toute la chaine.
        """
        dims = [f"  {d.colonne} AS {d.cle}" for d in self.dimensions]
        mes = [f"  SUM({m.colonne}) AS {m.cle}" for m in self.mesures]
        select = ",\n".join(dims + mes)
        group = ", ".join(str(i + 1) for i in range(len(self.dimensions)))
        sql = f"SELECT\n{select}\nFROM `{PROJET}.{self.source}`"
        if self.dimensions:
            sql += f"\nGROUP BY {group}"
        if self.tri:
            sql += "\nORDER BY " + ", ".join(self.tri)
        if self.limite:
            sql += f"\nLIMIT {self.limite}"
        return sql


@dataclass(frozen=True)
class JeuBrut(Jeu):
    """Jeu servi sans agregation : referentiels et cumuls sans date.

    Agreger une table de 105 articles d'inventaire ou 7 moyens de
    paiement n'apporte rien et interdirait de lire une ligne telle
    qu'elle a ete saisie.
    """
    def sql(self) -> str:
        cols = [f"  {d.colonne} AS {d.cle}" for d in self.dimensions]
        cols += [f"  {m.colonne} AS {m.cle}" for m in self.mesures]
        sql = "SELECT\n" + ",\n".join(cols) + f"\nFROM `{PROJET}.{self.source}`"
        if self.tri:
            sql += "\nORDER BY " + ", ".join(self.tri)
        if self.limite:
            sql += f"\nLIMIT {self.limite}"
        return sql


# =====================================================================
# JEUX DE DONNEES
# =====================================================================
# Les dimensions de calendrier (annee, mois, semaine...) ne sont PAS
# embarquees : elles se derivent de la date cote client en trois lignes de
# JavaScript. Les transporter multiplierait le poids de l'instantane pour
# une information qui est deja dans la date.

JEUX: tuple[Jeu, ...] = (

    # ---- Vue maitresse. Alimente Synthese, Compte de resultat, Marge ----
    Jeu(
        cle="resultat_jour",
        source=f"{DATASET_REPORTING}.v_resultat_jour",
        grain="jour d'exploitation x activite",
        libelle="Compte de resultat quotidien",
        dimensions=(
            Dimension("d", "jour_exploitation", "Jour d'exploitation", "date"),
            Dimension("a", "activite", "Activite"),
        ),
        mesures=(
            Mesure("cb", "ca_brut", "CA brut", "fcfa", "Avant remise. Champ TTC du POS, qui ne signifie pas 'toutes taxes comprises'."),
            Mesure("rm", "remise", "Remises", "fcfa", "Source de verite : balance par categorie. Le Journal CAF est ecarte."),
            Mesure("cn", "ca_net", "CA net", "fcfa", "Apres remise."),
            Mesure("qv", "quantite_vendue", "Quantite vendue", "entier"),
            Mesure("qo", "quantite_offerte", "Quantite offerte", "entier"),
            Mesure("ae", "achats_externes", "Achats externes", "fcfa", "Rattaches directement a l'activite, sans cle de repartition."),
            Mesure("op", "opex", "Charges d'exploitation", "fcfa", "Ventilees au prorata du CA net du jour, donc additives."),
            Mesure("cx", "capex", "Investissements", "fcfa", "Traites en charge de l'exercice, a la demande de l'etablissement."),
            Mesure("mb", "marge_brute", "Marge brute", "fcfa"),
            Mesure("re", "resultat_exploitation", "Resultat d'exploitation", "fcfa"),
            Mesure("rn", "resultat_net", "Resultat net", "fcfa", "Avant charges de personnel : aucune donnee RH dans les sources."),
        ),
        tri=("d",),
    ),

    # ---- Ventes au grain categorie ----
    Jeu(
        cle="ventes_categorie_jour",
        source=f"{DATASET_REPORTING}.v_ventes_jour",
        grain="jour x activite x categorie",
        libelle="Ventes par categorie",
        dimensions=(
            Dimension("d", "jour_exploitation", "Jour d'exploitation", "date"),
            Dimension("t", "type", "Activite"),
            Dimension("c", "categorie", "Categorie"),
        ),
        mesures=(
            Mesure("q", "quantite", "Quantite", "entier"),
            Mesure("cn", "ca_net", "CA net"),
            Mesure("cb", "ca_brut", "CA brut"),
            Mesure("rm", "remise", "Remises"),
        ),
        tri=("d",),
    ),

    # ---- Catalogue articles, cumul periode complete ----
    Jeu(
        cle="articles",
        source=f"{DATASET_REPORTING}.v_ventes_jour",
        grain="article (cumul sur toute la periode)",
        libelle="Catalogue des articles",
        dimensions=(
            Dimension("t", "type", "Activite"),
            Dimension("c", "categorie", "Categorie"),
            Dimension("a", "article", "Article"),
        ),
        mesures=(
            Mesure("q", "quantite", "Quantite vendue", "entier"),
            Mesure("cn", "ca_net", "CA net"),
            Mesure("cb", "ca_brut", "CA brut"),
            Mesure("rm", "remise", "Remises"),
            Mesure("nl", "nb_lignes", "Lignes de vente", "entier"),
        ),
        filtrable_par_date=False,
        tri=("cn DESC",),
        avertissement="Cumul sur toute la periode : le classement ne reagit pas au filtre de dates.",
    ),

    # ---- Profil horaire ----
    Jeu(
        cle="horaire_jour",
        source=f"{DATASET_REPORTING}.v_horaire_jour",
        grain="jour x heure x activite",
        libelle="Activite par tranche horaire",
        dimensions=(
            Dimension("d", "jour_exploitation", "Jour d'exploitation", "date"),
            Dimension("h", "heure_num", "Heure", "entier"),
            Dimension("on", "ordre_nuit", "Ordre dans la nuit", "entier"),
            Dimension("t", "type", "Activite"),
        ),
        mesures=(
            Mesure("q", "quantite", "Quantite", "entier"),
            Mesure("cn", "ca_net", "CA net"),
        ),
        tri=("d", "on"),
        avertissement="Trier les axes horaires sur ordre_nuit, jamais sur l'heure : sinon minuit, qui est le pic, se retrouve a l'extreme gauche et la soiree parait coupee en deux.",
    ),

    # ---- Depenses ----
    Jeu(
        cle="depenses_jour",
        source=f"{DATASET_REPORTING}.v_depenses_jour",
        grain="jour x nature x poste",
        libelle="Depenses par poste",
        dimensions=(
            Dimension("d", "jour_exploitation", "Jour d'exploitation", "date"),
            Dimension("n", "nature", "Nature"),
            Dimension("p", "poste", "Poste"),
        ),
        mesures=(
            Mesure("m", "montant", "Montant"),
        ),
        tri=("d",),
    ),

    # ---- Articles offerts, par caissier ----
    Jeu(
        cle="offerts_jour",
        source=f"{DATASET_REPORTING}.v_offerts_jour",
        grain="jour x caissier x categorie",
        libelle="Articles offerts par caissier",
        dimensions=(
            Dimension("d", "jour_exploitation", "Jour d'exploitation", "date"),
            Dimension("c", "caissier", "Caissier"),
            Dimension("cat", "categorie", "Categorie"),
        ),
        mesures=(
            Mesure("q", "quantite_offerte", "Quantite offerte", "entier"),
            Mesure("v", "valeur_offerte", "Valeur offerte"),
        ),
        tri=("d",),
    ),

    # ---- Articles offerts, par article ----
    Jeu(
        cle="offerts_article",
        source=f"{DATASET_REPORTING}.v_offerts_jour",
        grain="categorie x article (cumul)",
        libelle="Articles les plus offerts",
        dimensions=(
            Dimension("cat", "categorie", "Categorie"),
            Dimension("a", "article", "Article"),
        ),
        mesures=(
            Mesure("q", "quantite_offerte", "Quantite offerte", "entier"),
            Mesure("v", "valeur_offerte", "Valeur offerte"),
        ),
        filtrable_par_date=False,
        tri=("v DESC",),
        limite=150,
    ),

    # ---- Cout de revient : le chantier 4 ----
    JeuBrut(
        cle="couts_articles",
        source=f"{DATASET_REPORTING}.v_cout_revient",
        grain="produit (cumul)",
        libelle="Cout de revient par produit",
        dimensions=(
            Dimension("t", "activite", "Activite"),
            Dimension("c", "categorie", "Categorie"),
            Dimension("a", "article", "Produit"),
            Dimension("src", "type_source", "Atelier"),
            Dimension("st", "statut_cout", "Fiabilite du cout"),
        ),
        mesures=(
            Mesure("cr", "cout_revient", "Cout de recette unitaire", "decimal"),
            Mesure("pv", "prix_vente", "Prix de vente de reference"),
            Mesure("q", "quantite", "Quantite vendue", "entier"),
            Mesure("cn", "ca_net", "CA net"),
            Mesure("cb", "ca_brut", "CA brut"),
            Mesure("rm", "remise", "Remises"),
            Mesure("ct", "cout_total", "Cout de recette cumule"),
            Mesure("mt", "marge_theorique", "Marge theorique"),
        ),
        filtrable_par_date=False,
        tri=("cn DESC",),
        avertissement="Un cout marque 'Partiel' est SOUS-EVALUE, donc sa marge est surevaluee. Le statut doit rester visible dans l'interface.",
    ),

    # ---- Inventaire ----
    JeuBrut(
        cle="inventaire",
        source=f"{DATASET_REPORTING}.v_inventaire",
        grain="article",
        libelle="Inventaire",
        dimensions=(
            Dimension("cat", "categorie", "Categorie"),
            Dimension("a", "article", "Article"),
            Dimension("al", "sous_alerte", "Sous seuil d'alerte", "texte"),
            Dimension("seuil_param", "seuil_parametre", "Seuil parametre", "texte"),
        ),
        mesures=(
            Mesure("qt", "qte_theorique", "Stock theorique", "entier"),
            Mesure("sa", "stock_alerte", "Seuil d'alerte", "entier"),
            Mesure("qp", "qte_physique", "Comptage physique", "entier"),
            Mesure("ec", "ecart", "Ecart", "entier"),
            Mesure("vs", "valeur_stock", "Stock valorise", "fcfa",
                   "Au cout de revient. NULL si le cout du produit est inconnu : "
                   "valoriser a zero sous-estimerait le stock sans que cela se voie."),
        ),
        filtrable_par_date=False,
        tri=("qt DESC",),
        avertissement="Tant que le comptage physique est nul, l'ecart n'est PAS une demarque : il vaut mecaniquement l'oppose du stock theorique.",
    ),

    # ---- Moyens de paiement ----
    JeuBrut(
        cle="reglements",
        source=f"{DATASET_REPORTING}.v_moyens_paiement",
        grain="moyen de paiement (cumul sans date)",
        libelle="Moyens de paiement",
        dimensions=(
            Dimension("libelle", "moyen_paiement", "Moyen de paiement"),
        ),
        mesures=(
            Mesure("nombre", "nombre", "Nombre d'operations", "entier"),
            Mesure("montant", "montant", "Montant"),
        ),
        filtrable_par_date=False,
        tri=("montant DESC",),
        avertissement="La source POS n'exporte AUCUNE date : desactiver le filtre de periode sur cette page.",
    ),

    # ---- Panier moyen horaire ----
    JeuBrut(
        cle="panier_horaire",
        source=f"{DATASET_REPORTING}.v_panier_horaire",
        grain="tranche horaire (cumul sans date)",
        libelle="Panier moyen par tranche horaire",
        dimensions=(
            Dimension("heure", "tranche_horaire", "Tranche horaire"),
            Dimension("heure_debut", "heure_debut", "Heure de debut", "entier"),
            Dimension("ordre_nuit", "ordre_nuit", "Ordre dans la nuit", "entier"),
        ),
        mesures=(
            Mesure("ca", "ca", "CA"),
            Mesure("ventes", "nb_ventes", "Nombre de ventes", "entier"),
            Mesure("vendeurs", "nb_vendeurs", "Nombre de vendeurs", "entier"),
            Mesure("panier_moyen", "panier_moyen", "Panier moyen"),
        ),
        filtrable_par_date=False,
        tri=("ordre_nuit",),
    ),

    # ---- Performance caisse ----
    JeuBrut(
        cle="caissiers",
        source=f"{DATASET_REPORTING}.v_caisse",
        grain="caissier (cumul sans date)",
        libelle="Performance par caissier",
        dimensions=(
            Dimension("utilisateur", "caissier", "Caissier"),
        ),
        mesures=(
            Mesure("produits", "nb_produits", "Produits", "entier"),
            Mesure("tickets", "nb_tickets", "Tickets", "entier"),
            Mesure("paniers", "nb_paniers", "Paniers", "entier"),
            Mesure("panier_moyen", "panier_moyen", "Panier moyen"),
            Mesure("net", "total_net", "CA net"),
            Mesure("reglement", "total_reglement", "Total regle"),
        ),
        filtrable_par_date=False,
        tri=("net DESC",),
        avertissement="Export partiel : 61 % du CA, 2 caissiers absents. Sert a comparer les caissiers entre eux, pas a mesurer l'activite. nb_tickets et nb_paniers sont le meme indicateur dans le POS.",
    ),

    # ---- Totaux de controle du POS ----
    JeuBrut(
        cle="totaux_pos",
        source=f"{DATASET_ANALYTICS}.totaux_pos",
        grain="periode complete (une ligne)",
        libelle="Totaux de controle du POS",
        dimensions=(),
        mesures=(
            Mesure("nb_panier", "nb_panier", "Nombre de paniers", "entier"),
            Mesure("panier_moyen", "panier_moyen", "Panier moyen"),
            Mesure("nombre_vendu", "nombre_vendu", "Articles vendus", "entier"),
            Mesure("remise_pos", "remise_pos", "Remise selon le CA global"),
            Mesure("total_offert", "total_offert", "Articles offerts", "entier"),
            Mesure("ca_ht_hors_offert", "ca_ht_hors_offert", "CA hors offert"),
            Mesure("ca_offert", "ca_offert", "CA offert"),
        ),
        filtrable_par_date=False,
        avertissement="SEULE source du ticket moyen : le journal de vente n'a aucun identifiant de ticket. Ecart structurel connu avec la balance par categorie : perimetres d'articles differents.",
    ),

    # ---- Journal de reconciliation ----
    JeuBrut(
        cle="reconciliation",
        source=f"{DATASET_ANALYTICS}.journal_reconciliation",
        grain="controle (dernier passage)",
        libelle="Controles de reconciliation",
        dimensions=(
            Dimension("controle", "controle", "Controle"),
            Dimension("statut", "statut", "Statut"),
            Dimension("explication", "commentaire", "Lecture"),
        ),
        mesures=(
            Mesure("attendu", "valeur_attendue", "Attendu"),
            Mesure("obtenu", "valeur_obtenue", "Obtenu"),
            Mesure("ecart", "ecart", "Ecart"),
        ),
        filtrable_par_date=False,
    ),
)


# =====================================================================
# RATIOS — les seuls calculs derives, tous en SUM/SUM
# =====================================================================
RATIOS: tuple[Ratio, ...] = (
    Ratio("taux_remise", "Taux de remise", "rm", "cb", "resultat_jour",
          commentaire="Remises sur CA brut."),
    Ratio("taux_marge_brute", "Taux de marge brute", "mb", "cn", "resultat_jour"),
    Ratio("taux_cout_matiere", "Coût matière", "ae", "cn", "resultat_jour",
          commentaire="Norme en restauration : 25 a 35 %. Reference pour EAT uniquement -- les boissons et la chicha supportent structurellement un cout plus faible."),
    Ratio("taux_rentabilite", "Taux de rentabilite d'exploitation", "re", "cn", "resultat_jour"),
    Ratio("taux_resultat_net", "Taux de resultat net", "rn", "cn", "resultat_jour",
          commentaire="Avant charges de personnel."),
    Ratio("prix_moyen_net", "Prix moyen net", "cn", "qv", "resultat_jour", "fcfa"),
    Ratio("taux_offre_gratuite", "Taux d'offre gratuite", "qo", "qv", "resultat_jour",
          commentaire="Quantite offerte rapportee a la quantite vendue."),
    Ratio("contribution_ca", "Contribution au CA", "cn", "cn", "articles",
          commentaire="Part d'un article dans le CA total : le denominateur est la somme non filtree."),
    Ratio("prix_moyen_article", "Prix moyen par article", "cn", "q", "articles", "fcfa"),
    Ratio("marge_theorique_pct", "Marge theorique", "mt", "cn", "couts_articles",
          commentaire="A confronter au taux_marge_brute REEL de la meme activite. L'ecart est le constat central du dossier."),
)


# =====================================================================
# CONTROLES BLOQUANTS — invariants structurels
# =====================================================================
# Vrais pour TOUT export, contrairement a une valeur figee. Le generateur
# refuse de publier un instantane si l'un d'eux echoue.
#
# La distinction est celle qui manquait a la v1 : ses `assert` comparaient
# chaque total a la valeur exacte de l'export d'aout 2026. Ils validaient
# une extraction ponctuelle, et echouaient tous au premier nouvel export
# alors que rien n'etait casse.
INVARIANTS: tuple[dict, ...] = (
    {
        "cle": "coherence_brut_remise_net",
        "libelle": "CA brut - remises = CA net",
        "jeu": "resultat_jour",
        "expression": "abs((cb - rm) - cn) < 1",
        "pourquoi": "Coherence interne de la source de verite. Tout ecart invaliderait la remise.",
    },
    {
        "cle": "achats_non_perdus",
        "libelle": "Aucun achat perdu dans la jointure",
        "jeu": "resultat_jour",
        "expression": "abs(ae - total_achats_source) < 1",
        "pourquoi": "Detecte la regression du FULL OUTER JOIN vers un LEFT JOIN depuis les seules ventes. Ce defaut a reellement existe dans reporting.v_resultat_jour : des achats perdus sur 7 jours de fermeture avec reapprovisionnement, soit environ 0,12 % de la marge brute.",
    },
    {
        "cle": "marge_coherente",
        "libelle": "Marge brute = CA net - achats externes",
        "jeu": "resultat_jour",
        "expression": "abs(mb - (cn - ae)) < 1",
        "pourquoi": "Verifie que la vue n'a pas derive par rapport a sa propre definition.",
    },
    {
        "cle": "periode_non_vide",
        "libelle": "La periode contient des ventes",
        "jeu": "resultat_jour",
        "expression": "cn > 0 and nb_lignes > 0",
        "pourquoi": "Un instantane vide publie ecraserait un instantane valide.",
    },
    {
        "cle": "pas_de_nan",
        "libelle": "Aucune valeur non finie dans l'instantane",
        "jeu": "*",
        "expression": "aucun NaN ni Infinity",
        "pourquoi": "json.dump ecrit NaN comme un token litteral : valide en Python, INVALIDE en JSON strict. JSON.parse le rejette et interrompt tout le script du navigateur. Deja survenu deux fois sur ce projet.",
    },
)


# =====================================================================
# EXPORT
# =====================================================================

def registre_json() -> dict:
    """Registre serialise, destine au front. Les alias courts y sont
    documentes, donc l'interface n'a aucune definition en dur."""
    return {
        "version_registre": 2,
        "projet": PROJET,
        "region": REGION,
        "jeux": [
            {
                "cle": j.cle,
                "libelle": j.libelle,
                "grain": j.grain,
                "source": j.source,
                "filtrable_par_date": j.filtrable_par_date,
                "colonne_date": j.colonne_date if j.filtrable_par_date else None,
                "avertissement": j.avertissement,
                "dimensions": [asdict(d) for d in j.dimensions],
                "mesures": [asdict(m) for m in j.mesures],
            }
            for j in JEUX
        ],
        "ratios": [asdict(r) for r in RATIOS],
        "invariants": list(INVARIANTS),
    }


def valider_registre() -> list[str]:
    """Verifie la coherence interne du registre AVANT toute requete.

    Une faute de frappe dans un ratio produirait sinon une division
    silencieuse par undefined cote navigateur -- un graphique vide, sans
    message d'erreur, tres long a diagnostiquer.
    """
    erreurs: list[str] = []
    cles_jeux = {j.cle for j in JEUX}
    if len(cles_jeux) != len(JEUX):
        erreurs.append("deux jeux de donnees portent la meme cle")

    par_jeu = {j.cle: j for j in JEUX}
    for j in JEUX:
        alias = [d.cle for d in j.dimensions] + [m.cle for m in j.mesures]
        doublons = {a for a in alias if alias.count(a) > 1}
        if doublons:
            erreurs.append(f"jeu '{j.cle}' : alias en doublon {sorted(doublons)}")

    # Interdiction structurelle du SELECT *. La regle est facile a
    # enoncer et facile a oublier : on la fait echouer a la validation
    # plutot que de compter sur la relecture. BigQuery facture les
    # colonnes SCANNEES : un SELECT * sur analytics.ventes lit douze
    # colonnes pour en utiliser quatre.
    for j in JEUX:
        sql = j.sql()
        if "*" in sql.split("FROM")[0]:
            erreurs.append(
                f"jeu '{j.cle}' : SELECT * interdit. Nommer les colonnes -- "
                f"BigQuery facture les colonnes scannees, pas les lignes.")
        if not j.dimensions and not j.mesures:
            erreurs.append(f"jeu '{j.cle}' : aucune colonne declaree")

    for r in RATIOS:
        if r.jeu not in cles_jeux:
            erreurs.append(f"ratio '{r.cle}' cible le jeu inconnu '{r.jeu}'")
            continue
        mesures = {m.cle for m in par_jeu[r.jeu].mesures}
        for role, cle in (("numerateur", r.numerateur), ("denominateur", r.denominateur)):
            if cle not in mesures:
                erreurs.append(
                    f"ratio '{r.cle}' : {role} '{cle}' n'est pas une mesure de '{r.jeu}'")
    return erreurs


if __name__ == "__main__":
    erreurs = valider_registre()
    if erreurs:
        print("REGISTRE INVALIDE :")
        for e in erreurs:
            print("  -", e)
        raise SystemExit(1)

    base = Path(__file__).resolve().parent
    cible = base / "registre.json"
    cible.write_text(
        json.dumps(registre_json(), ensure_ascii=False, indent=2),
        encoding="utf-8")

    print(f"Registre valide. {len(JEUX)} jeux, "
          f"{sum(len(j.mesures) for j in JEUX)} mesures, "
          f"{len(RATIOS)} ratios, {len(INVARIANTS)} invariants.")
    print(f"Ecrit : {cible.name} ({cible.stat().st_size/1024:.1f} Ko)\n")
    for j in JEUX:
        marque = "date" if j.filtrable_par_date else "cumul"
        print(f"  [{marque:<5}] {j.cle:<24} {j.grain}")
