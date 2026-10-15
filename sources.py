# -*- coding: utf-8 -*-
"""
Ou sont les fichiers sources -- une seule reponse pour tous les scripts.

POURQUOI CE MODULE
------------------
Les scripts d'extraction portaient chacun leurs chemins en dur, ecrits
sur le poste ou ils avaient ete developpes : C:\\Users\\user\\Downloads\\...
Sur tout autre poste, rien ne tournait, et la seule facon de le
decouvrir etait de lancer un script et de lire une trace Python. Une
personne qui reprend le projet devait donc modifier cinq fichiers
versionnes pour les faire pointer chez elle -- et les pousser, puisque
rien ne l'en empechait.

Les chemins vivent desormais dans sources.env, a la racine du depot,
jamais versionne. sources.example.env en donne la liste commentee : on
le copie, on le remplit, et tous les scripts suivent.

  ordre de lecture : variable d'environnement, puis sources.env
  chemin relatif   : resolu depuis le dossier du depot

LES NOMS DE FICHIERS HORODATES
------------------------------
Les exports de caisse portent l'heure de l'export dans leur nom
(« Journal_Vente2482026174540.csv »). Les figer, c'est condamner le
script au prochain export. trouver() cherche sur la partie STABLE du
nom, et sur les colonnes quand le nom ne suffit pas : le logiciel de
caisse sort quatre fichiers « Journal_Vente », et seul le detaille a
une colonne Date.

Deux candidats restent une ERREUR, pas un choix : prendre « le plus
recent » ferait tourner l'extraction sur le mauvais rapport le jour ou
quelqu'un recopie un ancien export dans le dossier, sans rien signaler.
"""

import os
import re
import unicodedata
from pathlib import Path

BASE = Path(__file__).resolve().parent
FICHIER = BASE / "sources.env"
EXEMPLE = BASE / "sources.example.env"

_lu = None


def _valeurs():
    global _lu
    if _lu is None:
        _lu = {}
        if FICHIER.exists():
            for ligne in FICHIER.read_text(encoding="utf-8").splitlines():
                m = re.match(r"^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$", ligne)
                if m and m[2]:
                    _lu[m[1]] = m[2].strip("'\"")
    return _lu


def source(cle, dossier=False):
    """Le chemin configure sous `cle`, verifie. S'arrete net s'il manque."""
    brut = os.environ.get(cle, "").strip() or _valeurs().get(cle, "")
    if not brut:
        raise SystemExit(
            f"Chemin non configure : {cle}\n"
            f"  Copier {EXEMPLE.name} en {FICHIER.name}, a la racine du depot,\n"
            f"  et y renseigner {cle}.")
    chemin = Path(brut)
    if not chemin.is_absolute():
        chemin = (BASE / chemin).resolve()
    if dossier and not chemin.is_dir():
        raise SystemExit(f"{cle} : dossier introuvable\n  {chemin}")
    if not dossier and not chemin.is_file():
        raise SystemExit(f"{cle} : fichier introuvable\n  {chemin}")
    return chemin


def _forme(s):
    s = unicodedata.normalize("NFKD", str(s))
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def _entete(chemin):
    with open(chemin, encoding="utf-8-sig", errors="replace") as f:
        return {_forme(c).strip() for c in f.readline().rstrip("\r\n").split(";")}


def trouver(dossier, fragment, colonnes=(), extension=".csv"):
    """Le seul fichier de `dossier` dont le nom contient `fragment` (sans
    tenir compte des accents ni de la casse) et dont la premiere ligne
    porte toutes les `colonnes`."""
    voulu = _forme(fragment)
    requises = {_forme(c) for c in colonnes}
    candidats = [p for p in sorted(Path(dossier).glob("*" + extension))
                 if voulu in _forme(p.name)
                 and (not requises or requises <= _entete(p))]
    if len(candidats) == 1:
        return candidats[0]
    precision = f" avec les colonnes {', '.join(colonnes)}" if colonnes else ""
    if not candidats:
        raise SystemExit(f"Aucun fichier « {fragment} »{precision} dans\n  {dossier}")
    raise SystemExit(
        f"{len(candidats)} fichiers « {fragment} »{precision} dans {dossier} :\n  "
        + "\n  ".join(p.name for p in candidats)
        + "\n  Retirer les anciens exports du dossier : le script ne choisit pas a votre place.")
