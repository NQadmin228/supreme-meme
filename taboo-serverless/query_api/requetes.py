# -*- coding: utf-8 -*-
"""
TABOO — Catalogue des requetes autorisees pour l'API de detail.

POURQUOI UNE LISTE BLANCHE, ET JAMAIS DE SQL DEPUIS LE CLIENT
-------------------------------------------------------------
L'API detient le compte de service BigQuery. Accepter du SQL envoye par
le navigateur equivaudrait a donner a chaque lecteur un acces en lecture
sur tout le projet, et a laisser n'importe qui declencher un scan
arbitrairement couteux. Il n'existe donc aucun chemin permettant
d'executer une requete qui ne figure pas ici.

Chaque requete declare :
  - son SQL, fige, avec des parametres nommes BigQuery (@param). Les
    parametres nommes sont passes hors de la chaine SQL : l'injection est
    structurellement impossible, ce que ne garantit aucun echappement
    manuel.
  - ses parametres, avec leur type et leur caractere obligatoire.
  - une amplitude maximale en jours. C'est le garde-fou de cout : les
    tables sont partitionnees par jour, donc borner la periode borne
    directement les octets lus.
  - un plafond de lignes retournees.

CE QUE L'API NE SERT PAS
------------------------
Tout ce qui est deja dans l'instantane. Le detail ligne a ligne
(219 696 lignes) est le seul cas ou une requete est justifiee : trop
volumineux pour l'instantane, et consulte rarement.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

PROJET = "VOTRE_PROJET_GCP"

TypeParam = Literal["DATE", "STRING", "INT64"]


@dataclass(frozen=True)
class Param:
    nom: str
    type: TypeParam
    obligatoire: bool = True
    valeurs_permises: tuple[str, ...] = ()


@dataclass(frozen=True)
class RequeteAutorisee:
    cle: str
    libelle: str
    sql: str
    params: tuple[Param, ...]
    amplitude_max_jours: int = 92
    lignes_max: int = 5000
    # Plafond d'octets FACTURES. Disjoncteur, pas budget : sans lui, une
    # requete mal formee scanne des teraoctets avant qu'on s'en apercoive.
    octets_max: int = 512 * 1024 ** 2


CATALOGUE: dict[str, RequeteAutorisee] = {}


def _ajouter(r: RequeteAutorisee) -> None:
    CATALOGUE[r.cle] = r


# ---------------------------------------------------------------------
# Detail ligne a ligne des ventes. Le cas d'usage principal : depuis un
# point d'un graphique, voir les ventes qui le composent.
# ---------------------------------------------------------------------
_ajouter(RequeteAutorisee(
    cle="lignes_vente",
    libelle="Detail des lignes de vente",
    sql=f"""
SELECT
  jour_exploitation, heure, tranche_horaire,
  type, categorie, article,
  quantite, ca_net, remise
FROM `{PROJET}.analytics.ventes`
WHERE jour_exploitation BETWEEN @jour_debut AND @jour_fin
  AND (@type      IS NULL OR type      = @type)
  AND (@categorie IS NULL OR categorie = @categorie)
  AND (@article   IS NULL OR article   = @article)
ORDER BY jour_exploitation DESC, heure DESC
LIMIT @lignes_max
""",
    params=(
        Param("jour_debut", "DATE"),
        Param("jour_fin", "DATE"),
        # La liste des activites est fermee : la contraindre ici evite
        # qu'une valeur inattendue produise un scan complet inutile.
        Param("type", "STRING", False, ("DRINK", "EAT", "SMOKE")),
        Param("categorie", "STRING", False),
        Param("article", "STRING", False),
    ),
    amplitude_max_jours=92,
    lignes_max=5000,
))

# ---------------------------------------------------------------------
# Detail des mouvements de depense d'un poste.
# ---------------------------------------------------------------------
_ajouter(RequeteAutorisee(
    cle="depenses_detail",
    libelle="Detail des mouvements de depense",
    sql=f"""
SELECT
  jour_exploitation, nature, poste, categorie_vente, montant
FROM `{PROJET}.analytics.depenses`
WHERE jour_exploitation BETWEEN @jour_debut AND @jour_fin
  AND (@poste  IS NULL OR poste  = @poste)
  AND (@nature IS NULL OR nature = @nature)
ORDER BY jour_exploitation DESC, montant DESC
LIMIT @lignes_max
""",
    params=(
        Param("jour_debut", "DATE"),
        Param("jour_fin", "DATE"),
        Param("poste", "STRING", False),
        Param("nature", "STRING", False,
              ("ACHATS EXTERNES", "OPEX", "CAPEX")),
    ),
    amplitude_max_jours=366,
    lignes_max=5000,
))

# ---------------------------------------------------------------------
# Detail des articles offerts. Axe de controle interne : par caissier.
# ---------------------------------------------------------------------
_ajouter(RequeteAutorisee(
    cle="offerts_detail",
    libelle="Detail des articles offerts",
    sql=f"""
SELECT
  jour_exploitation, caissier, categorie, article,
  quantite, valeur_vente, ticket
FROM `{PROJET}.analytics.articles_offerts`
WHERE jour_exploitation BETWEEN @jour_debut AND @jour_fin
  AND (@caissier IS NULL OR caissier = @caissier)
ORDER BY jour_exploitation DESC, valeur_vente DESC
LIMIT @lignes_max
""",
    params=(
        Param("jour_debut", "DATE"),
        Param("jour_fin", "DATE"),
        Param("caissier", "STRING", False),
    ),
    amplitude_max_jours=366,
    lignes_max=5000,
))

# ---------------------------------------------------------------------
# Historique des controles de reconciliation. Sert a repondre a la
# question « depuis quand cet ecart existe-t-il ? », a laquelle
# l'instantane, qui ne porte que le dernier passage, ne repond pas.
# ---------------------------------------------------------------------
_ajouter(RequeteAutorisee(
    cle="reconciliation_historique",
    libelle="Historique des controles de reconciliation",
    sql=f"""
SELECT
  DATE(controle_le) AS jour, controle, valeur_attendue, valeur_obtenue,
  ecart, ecart_pct, statut
FROM `{PROJET}.analytics.journal_reconciliation`
WHERE DATE(controle_le) BETWEEN @jour_debut AND @jour_fin
ORDER BY controle_le DESC, controle
LIMIT @lignes_max
""",
    params=(
        Param("jour_debut", "DATE"),
        Param("jour_fin", "DATE"),
    ),
    amplitude_max_jours=366,
    lignes_max=2000,
    octets_max=64 * 1024 ** 2,
))


def catalogue_public() -> list[dict]:
    """Description du catalogue, pour que le front sache quoi demander
    sans qu'on duplique ces definitions cote client."""
    return [
        {
            "cle": r.cle,
            "libelle": r.libelle,
            "params": [
                {"nom": p.nom, "type": p.type, "obligatoire": p.obligatoire,
                 "valeurs_permises": list(p.valeurs_permises) or None}
                for p in r.params
            ],
            "amplitude_max_jours": r.amplitude_max_jours,
            "lignes_max": r.lignes_max,
        }
        for r in CATALOGUE.values()
    ]
