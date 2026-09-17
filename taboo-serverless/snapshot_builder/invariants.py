# -*- coding: utf-8 -*-
"""
TABOO — Invariants bloquants du generateur d'instantane.

PRINCIPE
--------
Un invariant est une regle vraie pour TOUT export, pas pour un export
donne. C'est la distinction qui manquait a la premiere chaine : ses
`assert` comparaient chaque total a la valeur exacte de l'export d'aout
2026. Ils validaient une extraction ponctuelle et echouaient tous au
premier nouvel export, alors que rien n'etait casse.

Si un invariant echoue, l'instantane N'EST PAS PUBLIE. L'ancien reste en
place et l'incident est remonte. Un tableau de bord perime est un
inconvenient ; un tableau de bord faux est un risque de decision.

En complement, `comparer_reference` signale les ecarts par rapport au
dernier instantane connu sans jamais bloquer : une variation est normale
des qu'il y a de nouvelles ventes. Seule une BAISSE d'un cumul historique
est suspecte, puisque l'historique ne fait que s'allonger.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class Resultat:
    cle: str
    libelle: str
    ok: bool
    detail: str
    pourquoi: str = ""


class InvariantViole(Exception):
    """Leve pour interrompre la publication. Le message est destine a
    l'alerte d'exploitation : il doit suffire a diagnostiquer sans
    ouvrir le code."""


def _somme(lignes: list[dict], cle: str) -> float:
    return sum((l.get(cle) or 0) for l in lignes)


def _valeurs_non_finies(obj, chemin="") -> list[str]:
    """Repere tout NaN / Infinity avant serialisation.

    json.dump ecrit NaN comme un token litteral : valide en Python,
    INVALIDE en JSON strict. JSON.parse le rejette cote navigateur et
    interrompt l'execution de TOUT le script -- page blanche, sans
    message. C'est arrive deux fois sur ce projet, d'abord sur les
    depenses puis sur le panier moyen d'un caissier.
    """
    trouves: list[str] = []
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            trouves.append(chemin or "(racine)")
    elif isinstance(obj, dict):
        for k, v in obj.items():
            trouves += _valeurs_non_finies(v, f"{chemin}.{k}" if chemin else str(k))
    elif isinstance(obj, list):
        # On borne : signaler les 5 premieres suffit a diagnostiquer, et
        # parcourir 30 000 lignes en profondeur pour les lister toutes
        # allongerait le job sans rien apporter.
        for i, v in enumerate(obj):
            if len(trouves) >= 5:
                break
            trouves += _valeurs_non_finies(v, f"{chemin}[{i}]")
    return trouves


def controler(jeux: dict[str, list[dict]], contexte: dict) -> list[Resultat]:
    """Applique les invariants. Leve InvariantViole au premier echec.

    `contexte` porte les grandeurs mesurees hors instantane, notamment le
    total des achats lu directement dans analytics.depenses : c'est la
    seule facon de detecter qu'une jointure en a perdu.
    """
    res: list[Resultat] = []

    def ajouter(cle, libelle, ok, detail, pourquoi=""):
        r = Resultat(cle, libelle, ok, detail, pourquoi)
        res.append(r)
        if not ok:
            raise InvariantViole(
                f"\n  INVARIANT VIOLE : {libelle}\n"
                f"  {detail}\n"
                f"  Pourquoi c'est bloquant : {pourquoi}\n"
                f"  L'instantane n'est PAS publie ; le precedent reste en place.\n")

    rj = jeux.get("resultat_jour", [])

    # ---- 1. La periode contient quelque chose -------------------------
    cn = _somme(rj, "cn")
    ajouter("periode_non_vide", "La periode contient des ventes",
            len(rj) > 0 and cn > 0,
            f"{len(rj)} lignes, CA net {cn:,.0f} F",
            "Publier un instantane vide ecraserait un instantane valide.")

    # ---- 2. Coherence interne de la source de verite ------------------
    cb, rm = _somme(rj, "cb"), _somme(rj, "rm")
    ajouter("coherence_brut_remise_net", "CA brut - remises = CA net",
            abs((cb - rm) - cn) < 1,
            f"{cb:,.0f} - {rm:,.0f} = {cb - rm:,.0f}, or CA net = {cn:,.0f}",
            "Cette egalite definit la remise. Un ecart invaliderait la source de verite.")

    # ---- 3. Marge coherente avec sa propre definition -----------------
    ae, mb = _somme(rj, "ae"), _somme(rj, "mb")
    ajouter("marge_coherente", "Marge brute = CA net - achats externes",
            abs(mb - (cn - ae)) < 1,
            f"marge {mb:,.0f} vs {cn:,.0f} - {ae:,.0f} = {cn - ae:,.0f}",
            "Detecte une derive de la vue par rapport a sa definition.")

    # ---- 4. Aucun achat perdu dans la jointure ------------------------
    # C'est l'invariant le plus important de la chaine. reporting.v_resultat_jour
    # a reellement porte ce defaut : un LEFT JOIN depuis les seules ventes
    # perdait les achats de 7 jours de fermeture avec reapprovisionnement,
    # environ 0,12 % de la marge brute. Corrige par
    # 12_fix_v_resultat_jour.sql ; cet invariant garantit que la
    # correction ne regresse pas.
    achats_source = contexte.get("total_achats_source")
    if achats_source is not None:
        ajouter("achats_non_perdus", "Aucun achat perdu dans la jointure",
                abs(ae - achats_source) < 1,
                f"{achats_source:,.0f} F en entree contre {ae:,.0f} F dans la vue "
                f"(ecart {ae - achats_source:,.0f} F)",
                "Signale un retour a un LEFT JOIN depuis les ventes dans "
                "v_resultat_jour. Les achats des jours de fermeture "
                "disparaitraient et la marge serait surevaluee.")

    # ---- 5. Aucune valeur non serialisable ----------------------------
    non_finies = _valeurs_non_finies(jeux)
    ajouter("pas_de_nan", "Aucune valeur non finie",
            not non_finies,
            f"valeurs non finies : {non_finies}" if non_finies else "aucune",
            "JSON.parse rejette le token NaN et interrompt tout le script "
            "du navigateur : page blanche sans message d'erreur.")

    # ---- 6. Chaque jeu declare est present ----------------------------
    manquants = [c for c, l in jeux.items() if l is None]
    ajouter("jeux_presents", "Tous les jeux du registre sont presents",
            not manquants,
            f"jeux absents : {manquants}" if manquants else f"{len(jeux)} jeux",
            "Un jeu absent laisse une page entiere vide dans l'interface.")

    return res


def comparer_reference(jeux: dict[str, list[dict]],
                       reference: dict | None) -> list[str]:
    """Compare au dernier instantane publie. Ne bloque JAMAIS.

    Une variation est normale des qu'il y a de nouvelles ventes. En
    revanche un cumul historique qui BAISSE signale un export tronque ou
    un filtre trop agressif : l'historique, lui, ne fait que s'allonger.
    """
    if not reference:
        return []
    alertes: list[str] = []
    rj_new = jeux.get("resultat_jour", [])
    rj_ref = reference.get("resultat_jour", [])
    if not rj_ref:
        return []

    for cle, libelle in (("cn", "CA net"), ("ae", "achats externes"),
                         ("mb", "marge brute"), ("rm", "remises")):
        neuf, vieux = _somme(rj_new, cle), _somme(rj_ref, cle)
        if vieux and neuf < vieux - 1:
            pct = 100 * (neuf - vieux) / vieux
            alertes.append(
                f"{libelle} en BAISSE de {abs(pct):.2f} % "
                f"({vieux:,.0f} -> {neuf:,.0f} F). Un cumul historique ne "
                f"devrait pas diminuer : export tronque ?")

    if len(rj_new) < len(rj_ref):
        alertes.append(
            f"resultat_jour perd {len(rj_ref) - len(rj_new)} lignes "
            f"({len(rj_ref)} -> {len(rj_new)}).")
    return alertes
