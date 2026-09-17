#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TABOO — Assemblage du front.

  python build.py                 -> dist/index.html (charge l'instantane du CDN)
  python build.py --demo FICHIER  -> dist/ + un instantane local, pour tester
                                     toute la chaine d'affichage sans GCP

Le fichier produit ne contient AUCUNE donnee : quelques dizaines de Ko
mis en cache par le navigateur, contre 5 Mo a chaque visite dans la
version autonome. Les donnees arrivent separement, versionnees et
immuables, donc telechargees une seule fois.
"""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

BASE = Path(__file__).resolve().parent
DIST = BASE / "dist"


def assembler() -> str:
    coquille = (BASE / "coquille.html").read_text(encoding="utf-8")
    pages = (BASE / "pages.html").read_text(encoding="utf-8")
    render = (BASE / "render.js").read_text(encoding="utf-8")
    chargement = (BASE / "chargement.js").read_text(encoding="utf-8")

    ancre = '<div class="content" id="content"></div>'
    assert ancre in coquille, "conteneur de contenu introuvable"
    html = coquille.replace(ancre, f'<div class="content" id="content">\n{pages}\n</div>')

    # La logique de rendu doit etre definie avant demarrer(), donc avant
    # le bloc DEMARRAGE.
    ancre = """/* =====================================================================
   DEMARRAGE — appele par chargement.js une fois l'instantane recupere
   ====================================================================="""
    assert ancre in html, "ancre de demarrage introuvable"
    html = html.replace(ancre, render + "\n" + ancre)

    # Le chargeur vient en dernier : il appelle demarrer(), qui doit
    # exister au moment ou il s'execute.
    assert "__TABOO_CHARGEMENT_JS__" in html, "marqueur du chargeur introuvable"
    html = html.replace("__TABOO_CHARGEMENT_JS__", chargement)

    assert "__TABOO_DATA_JSON__" not in html, \
        "le marqueur de donnees embarquees subsiste : la coquille n'a pas ete convertie"
    return html


def instantane_depuis_v2(chemin: Path) -> dict:
    """Transforme le data_v2.json de la version autonome en instantane.

    Sert uniquement a tester l'affichage de bout en bout sans BigQuery.
    Les alias de colonnes sont deja ceux du registre -- c'est justement
    pour cela que le registre les a reprises : la conversion se limite a
    reagencer l'enveloppe.
    """
    import sys
    sys.path.insert(0, str(BASE.parent))
    from semantique import registre as R

    v2 = json.loads(chemin.read_text(encoding="utf-8"))
    jeux = {j.cle: v2.get(j.cle, []) for j in R.JEUX}

    # totaux_pos est un objet dans la v2, une table d'une ligne ici.
    if isinstance(v2.get("totaux_pos"), dict):
        jeux["totaux_pos"] = [v2["totaux_pos"]]

    return {
        "meta": {
            "version_registre": R.registre_json()["version_registre"],
            "genere_le": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "periode_debut": v2["meta"]["periode_debut"],
            "periode_fin": v2["meta"]["periode_fin"],
            "jours_exploitation": len({l["d"] for l in jeux["resultat_jour"]}),
            "source": "instantane de DEMONSTRATION, converti depuis data_v2.json",
        },
        "registre": R.registre_json(),
        "pareto": v2.get("pareto", {}),
        "inventaire_meta": v2.get("inventaire_meta", {}),
        "alertes_qualite": v2.get("alertes_qualite", []),
        **jeux,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", metavar="DATA_V2_JSON",
                    help="genere aussi un instantane local pour tester l'affichage")
    args = ap.parse_args()

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)

    html = assembler()
    (DIST / "index.html").write_text(html, encoding="utf-8")
    print(f"dist/index.html         {len(html)/1024:>7.0f} Ko  (sans donnees)")

    if args.demo:
        inst = instantane_depuis_v2(Path(args.demo))
        version = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        (DIST / "instantanes").mkdir()
        cible = DIST / "instantanes" / f"{version}.json"
        charge = json.dumps(inst, ensure_ascii=False,
                            separators=(",", ":"), allow_nan=False)
        cible.write_text(charge, encoding="utf-8")
        (DIST / "manifest.json").write_text(json.dumps({
            "version": version,
            "fichier": f"instantanes/{version}.json",
            "octets_bruts": len(charge.encode()),
            "octets_comprimes": len(charge.encode()),
            "publie_le": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "periode_debut": inst["meta"]["periode_debut"],
            "periode_fin": inst["meta"]["periode_fin"],
            "version_registre": inst["meta"]["version_registre"],
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"dist/{cible.relative_to(DIST).as_posix():<20} "
              f"{cible.stat().st_size/1024:>7.0f} Ko  (demonstration)")
        for cle in (j.cle for j in __import__("semantique.registre",
                                              fromlist=["JEUX"]).JEUX):
            n = len(inst.get(cle) or [])
            marque = " " if n else "  <- VIDE"
            print(f"    {cle:<24} {n:>6} lignes{marque}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
