#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Assemblage des coquilles, pour tous les etablissements.

  python assembleur.py            -> les deux
  python assembleur.py taboo      -> une seule

POURQUOI UN SEUL ASSEMBLEUR
---------------------------
TABOO et AMNESIA partagent le chassis : graphiques, tableaux filtrables,
tiroir de navigation, chargement paresseux. Ce qui leur
appartient en propre, ce sont leurs PAGES, leurs fonctions de rendu,
leur navigation, leur logo et leurs couleurs.

Le gabarit ne contient donc plus rien de TABOO. Il porte des marqueurs,
et ce fichier les remplit depuis la definition de chaque etablissement.
Un correctif sur le chassis profite aux deux ; il n'y a pas de seconde
copie a penser a corriger.

CE QUE CHAQUE ETABLISSEMENT FOURNIT
-----------------------------------
    pages       les sections HTML
    render      les fonctions RENDER[...]
    nav         NAV et META, la navigation et les titres
    logo        un fichier image, encode en data URI
    theme       une surcharge CSS, ou rien

LE THEME VIENT DE lib/etablissements.js
---------------------------------------
Il y est deja, avec ses contrastes mesures, parce que les fonctions
serveur en ont besoin pour /api/session. Le recopier ici en ferait une
seconde source de verite, et le jour ou l'une changerait seule personne
ne saurait laquelle fait foi. Ce fichier la LIT donc, et s'arrete net
s'il n'y arrive pas -- plutot que de produire une coquille aux couleurs
de l'autre etablissement.
"""

import base64
import json
import mimetypes
import re
import sys
from pathlib import Path

NL = chr(10)
BASE = Path(__file__).resolve().parent
GABARIT = BASE / "dashboard_v2_template.html"
SORTIE = BASE / "taboo-vercel"
DEFINITIONS = BASE / "taboo-vercel" / "lib" / "etablissements.js"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


ETABLISSEMENTS = {
    "taboo": {
        "fichier": "index.html",
        "pages": "dashboard_v2_pages.html",
        "render": "dashboard_v2_render.js",
        "nav": "taboo_nav.js",
        "logo": "TABOO.jpg",
        "donnees": "taboo-vercel/donnees/taboo",
        "nom": "TABOO",
    },
    "amnesia": {
        "fichier": "amnesia.html",
        "pages": "amnesia_pages.html",
        "render": "amnesia_render.js",
        "nav": "amnesia_nav.js",
        "logo": "AMNESIA.png",
        "donnees": "taboo-vercel/donnees/amnesia",
        "nom": "AMNESIA",
    },
}


def lire_surcharges():
    """Extrait les surcharges de couleur de lib/etablissements.js.

    On lit le fichier qui fait deja autorite plutot que d'en tenir une
    copie. L'extraction est volontairement stricte : si la forme du
    fichier change, on veut un echec bruyant ici, pas une coquille qui
    sort silencieusement aux mauvaises couleurs.
    """
    texte = DEFINITIONS.read_text(encoding="utf-8")
    surcharges = {}
    for code in ETABLISSEMENTS:
        m = re.search(r"code:\s*'" + code + r"'.*?surcharge:\s*(null|\{.*?\})",
                      texte, re.S)
        if not m:
            raise SystemExit(
                f"Impossible de lire la surcharge de « {code} » dans\n"
                f"  {DEFINITIONS}\n"
                f"La forme du fichier a change : corriger lire_surcharges().")
        brut = m.group(1)
        if brut == "null":
            surcharges[code] = {}
            continue
        # Les cles sont des chaines ('--bg'), les valeurs aussi. On ne
        # tolere que cette forme : tout le reste doit echouer.
        paires = re.findall(r"'(--[a-z0-9-]+)':\s*'(#[0-9A-Fa-f]{3,8})'", brut)
        if not paires:
            raise SystemExit(f"Surcharge de « {code} » illisible : {brut[:120]}")
        surcharges[code] = dict(paires)
    return surcharges


def css_du_theme(jetons):
    if not jetons:
        return "/* aucune surcharge : les jetons du gabarit font foi */"
    lignes = "\n".join(f"  {k}:{v};" for k, v in jetons.items())
    return ":root{\n" + lignes + "\n}"


def data_uri(chemin):
    type_mime = mimetypes.guess_type(chemin.name)[0] or "application/octet-stream"
    return (f"data:{type_mime};base64,"
            + base64.b64encode(chemin.read_bytes()).decode("ascii"))


def assembler(code, surcharges):
    cfg = ETABLISSEMENTS[code]
    manquants = [n for n in ("pages", "render", "nav", "logo")
                 if not (BASE / cfg[n]).exists()]
    if manquants:
        print(f"  {code:<8} IGNORE — absent : "
              + ", ".join(cfg[n] for n in manquants))
        return None

    html = GABARIT.read_text(encoding="utf-8")
    pages = (BASE / cfg["pages"]).read_text(encoding="utf-8")
    render = (BASE / cfg["render"]).read_text(encoding="utf-8")
    nav = (BASE / cfg["nav"]).read_text(encoding="utf-8")
    chargement = (BASE / "chargement.js").read_text(encoding="utf-8")

    # 1. Les pages dans le conteneur de contenu.
    ancre = '<div class="content" id="content"></div>'
    assert ancre in html, "conteneur de contenu introuvable"
    html = html.replace(ancre,
                        f'<div class="content" id="content">\n{pages}\n</div>')

    # 2. Navigation et titres, avant tout ce qui les utilise.
    assert "__NAV_META__" in html, "marqueur de navigation introuvable"
    html = html.replace("__NAV_META__", nav)

    # 3. La logique de rendu avant le bloc DEMARRAGE : demarrer() appelle
    #    go(), qui a besoin que RENDER soit deja rempli.
    ancre = """/* =====================================================================
   DEMARRAGE — appele par le chargeur une fois le socle recupere
   ====================================================================="""
    assert ancre in html, "ancre de demarrage introuvable"
    html = html.replace(ancre, render + "\n" + ancre)

    # 4. Identite visuelle.
    html = html.replace("__LOGO__", data_uri(BASE / cfg["logo"]))
    html = html.replace("__THEME__", css_du_theme(surcharges.get(code, {})))
    html = html.replace("__ETABLISSEMENT__", code)
    html = html.replace("__NOM__", cfg["nom"])

    # 5. Le chargeur en dernier : il appelle demarrer(), qui doit exister.
    assert "__TABOO_CHARGEMENT_JS__" in html, "marqueur du chargeur introuvable"
    html = html.replace("__TABOO_CHARGEMENT_JS__", chargement)

    restants = re.findall(r"__[A-Z_]+__", html)
    if restants:
        raise SystemExit(f"Marqueurs non remplis dans {code} : {set(restants)}")

    cible = SORTIE / cfg["fichier"]
    cible.parent.mkdir(parents=True, exist_ok=True)
    cible.write_text(html, encoding="utf-8")

    nb_pages = html.count('<section class="page"')
    print(f"  {cfg['fichier']:<16} {cible.stat().st_size/1024:>7.0f} Ko"
          f"   {nb_pages:>2} pages   (sans donnees)")

    dossier = BASE / cfg["donnees"]
    if dossier.is_dir():
        fichiers = sorted(dossier.glob("*.json"))
        socle = next((f for f in fichiers if f.name == "socle.json"), None)
        if socle:
            premier = (cible.stat().st_size + socle.stat().st_size) / 1024
            total = (cible.stat().st_size
                     + sum(f.stat().st_size for f in fichiers)) / 1024
            print(f"  {'':16} {premier:>7.0f} Ko   au premier affichage"
                  f"   ({total:.0f} Ko si tout etait charge)")
    else:
        print(f"  {'':16} ATTENTION : {cfg['donnees']} absent")
    return cible


def ecrire_marques():
    """Encode les logos dans taboo-vercel/lib/marques.js.

    La page de connexion vit dans le middleware, qui s'execute avant
    toute authentification : une balise <img src="/marque/..."> y
    declencherait une requete que ce meme middleware intercepterait pour
    renvoyer la page de connexion. Le logo s'afficherait casse sur la
    page dont il est le premier element. On les embarque donc, et ce
    fichier-ci est la seule copie encodee -- les coquilles, elles,
    prennent la leur par __LOGO__.
    """
    lignes = []
    for code, cfg in ETABLISSEMENTS.items():
        chemin = BASE / cfg["logo"]
        lignes.append((code, cfg["logo"], chemin.stat().st_size,
                       data_uri(chemin)))

    corps = NL.join(
        f"/* {fichier} — {taille/1024:.0f} Ko */" + NL
        + f"const {code.upper()} = '{uri}';" + NL
        for code, fichier, taille, uri in lignes)
    table = ("export const MARQUES = {" + NL
             + "".join(f"  {code}: {code.upper()}," + NL for code, *_ in lignes)
             + "};" + NL)

    cible = SORTIE / "lib" / "marques.js"
    ancien = cible.read_text(encoding="utf-8") if cible.exists() else ""
    # L'en-tete explicatif est ecrit une fois pour toutes dans le fichier
    # lui-meme ; on ne reecrit que les constantes, pour ne pas perdre a
    # chaque assemblage l'explication de leur presence.
    marque = "/* ---------- constantes generees ---------- */"
    tete = ancien.split(marque)[0] if marque in ancien else ""
    cible.write_text(tete + marque + NL + NL + corps + NL + table,
                     encoding="utf-8")
    print(f"  {'lib/marques.js':<16} {cible.stat().st_size/1024:>7.0f} Ko"
          f"   {len(lignes):>2} marques   (page de connexion)")


def principal():
    voulus = sys.argv[1:] or list(ETABLISSEMENTS)
    inconnus = [c for c in voulus if c not in ETABLISSEMENTS]
    if inconnus:
        raise SystemExit(f"Etablissement inconnu : {', '.join(inconnus)}\n"
                         f"Connus : {', '.join(ETABLISSEMENTS)}")
    surcharges = lire_surcharges()
    print()
    ecrire_marques()
    for code in voulus:
        assembler(code, surcharges)
    print()


if __name__ == "__main__":
    principal()
