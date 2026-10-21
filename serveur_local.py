#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sert le tableau de bord sur ce poste, sans Vercel ni Neon.

  python assembleur.py          -> taboo-vercel/index.html et amnesia.html
  python serveur_local.py       -> http://127.0.0.1:8111   (TABOO)
                                   http://127.0.0.1:8111/amnesia

POURQUOI
--------
En ligne, une page passe par trois etapes que ce poste n'a pas : le
middleware et /api/session verifient le compte, et /api/donnees lit les
jeux dans Neon. Pour voir une modification de page avant de la pousser,
il faudrait sinon publier des chiffres ou deployer une branche.

Ce serveur remplace les deux appels, et rien d'autre :
  /api/session            une fausse session administrateur, ouverte aux
                          deux etablissements ;
  /donnees/<etab>/<jeu>   les fichiers du dossier local
                          taboo-vercel/donnees/, tels que 22_decouper.py,
                          31_decouper_amnesia.py et 41_controle_achats.py
                          les ont produits.

Les pages /compte et /admin, qui ecrivent dans la base, n'y fonctionnent
pas. Le serveur n'ecoute que sur 127.0.0.1 : la fausse session n'est
joignable que depuis cette machine.
"""

import functools
import http.server
import json
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent / "taboo-vercel"
PORT = 8111

# La meme forme que la reponse de taboo-vercel/api/session.js.
SESSION = {
    "identifiant": "local", "nom": "Essai local", "role": "admin",
    "acces": ["taboo", "amnesia"],
    "etablissements": [{"code": "taboo", "nom": "TABOO", "chemin": "/"},
                       {"code": "amnesia", "nom": "AMNESIA", "chemin": "/amnesia"}],
    "expire": 9_999_999_999,
}


class Gestionnaire(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        chemin = self.path.split("?")[0]
        if chemin == "/api/session":
            corps = json.dumps(SESSION).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(corps)))
            self.end_headers()
            self.wfile.write(corps)
            return
        # vercel.json active cleanUrls : /amnesia sert amnesia.html.
        if chemin == "/amnesia":
            self.path = "/amnesia.html"
        super().do_GET()

    def end_headers(self):
        # Une page modifiee doit se voir au rechargement, sans vider le cache.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> int:
    manquants = [f for f in ("index.html", "donnees/taboo/socle.json") if not (RACINE / f).exists()]
    if manquants:
        print("Manquant dans taboo-vercel/ : " + ", ".join(manquants))
        print("  Lancer python assembleur.py, et la chaine de donnees (voir GUIDE_DE_REPRISE.md).")
        return 1
    serveur = http.server.ThreadingHTTPServer(
        ("127.0.0.1", PORT), functools.partial(Gestionnaire, directory=str(RACINE)))
    print(f"  http://127.0.0.1:{PORT}          TABOO")
    print(f"  http://127.0.0.1:{PORT}/amnesia  AMNESIA")
    print("  Ctrl+C pour arreter.")
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
