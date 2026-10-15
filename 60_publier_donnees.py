#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Publie les jeux de donnees du tableau de bord dans Neon.

  python 60_publier_donnees.py                 -> tous les etablissements
  python 60_publier_donnees.py taboo           -> un seul
  python 60_publier_donnees.py --essai         -> verifie sans rien ecrire

OU CE SCRIPT SE PLACE
---------------------
    exports de caisse
      -> 20_extraction_v2.py / 30_extraction_amnesia.py ...   (data_*.json)
      -> 22_decouper.py / 31_decouper_amnesia.py   (taboo-vercel/donnees/)
      -> 60_publier_donnees.py                     (table jeu_donnees)

Le site, lui, se construit tout seul depuis GitHub a chaque push : il ne
transporte plus aucun chiffre. Remettre les chiffres a jour, c'est
relancer cette chaine -- depuis n'importe quel poste qui a les exports
et la chaine de connexion, et non plus depuis un seul.

CE QUE LE SCRIPT GARANTIT
-------------------------
  - Tous les jeux d'un etablissement partent dans UNE transaction : un
    lecteur voit l'ancienne publication ou la nouvelle, jamais un
    melange. Un jeu qui n'existe plus localement est retire dans la meme
    transaction.
  - Rien ne part qui ne soit du JSON valide, qui n'ait de socle, ou qui
    depasse ce qu'une fonction Vercel peut renvoyer.
  - Apres ecriture, il relit la base et compare les empreintes.

LA CONNEXION
------------
DATABASE_URL_UNPOOLED (ou a defaut DATABASE_URL), lue dans
l'environnement puis dans taboo-vercel/.env.local -- le fichier que
base/init.mjs utilise deja. Le schema est reapplique a chaque fois : il
est idempotent, et c'est ce qui cree la table la premiere fois.
"""

import argparse
import getpass
import hashlib
import json
import os
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
SITE = BASE / "taboo-vercel"
DONNEES = SITE / "donnees"
SCHEMA = SITE / "base" / "schema.sql"
ENV_LOCAL = SITE / ".env.local"

ETABLISSEMENTS = ["taboo", "amnesia"]
NOM = re.compile(r"^[a-z0-9_]{1,60}$")
# Une fonction Vercel plafonne a 4,5 Mo de reponse. On garde une marge :
# un jeu publie au ras de la limite casserait au premier mois plus charge.
PLAFOND = 4_000_000

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def url_base() -> str:
    for cle in ("DATABASE_URL_UNPOOLED", "DATABASE_URL"):
        if os.environ.get(cle, "").strip():
            return os.environ[cle].strip()
    if ENV_LOCAL.exists():
        valeurs = {}
        for ligne in ENV_LOCAL.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$", ligne)
            if m:
                valeurs[m[1]] = m[2].strip().strip("'\"")
        for cle in ("DATABASE_URL_UNPOOLED", "DATABASE_URL"):
            if valeurs.get(cle):
                return valeurs[cle]
    raise SystemExit("Aucune chaine de connexion : definir DATABASE_URL_UNPOOLED "
                     f"ou la renseigner dans {ENV_LOCAL}")


def instructions_schema() -> list[str]:
    """Le meme decoupage naif que base/init.mjs : commentaires retires, puis « ; »."""
    texte = SCHEMA.read_text(encoding="utf-8")
    texte = re.sub(r"/\*[\s\S]*?\*/", "", texte)
    texte = re.sub(r"--[^\n]*", "", texte)
    return [s.strip() for s in texte.split(";") if s.strip()]


def preparer(etab: str) -> list[dict]:
    dossier = DONNEES / etab
    if not dossier.is_dir():
        raise SystemExit(f"{etab} : dossier absent ({dossier}). Lancer d'abord le decoupage.")
    jeux = []
    for f in sorted(dossier.glob("*.json")):
        nom = f.stem
        if not NOM.match(nom):
            raise SystemExit(f"{etab}/{f.name} : nom refuse (attendu {NOM.pattern})")
        brut = f.read_bytes()
        try:
            json.loads(brut)
        except ValueError as e:
            raise SystemExit(f"{etab}/{f.name} : JSON invalide ({e})")
        if len(brut) > PLAFOND:
            raise SystemExit(f"{etab}/{f.name} : {len(brut)/1e6:.1f} Mo, au-dela de "
                             f"{PLAFOND/1e6:.1f} Mo -- une fonction Vercel ne le "
                             "renverrait pas. Le decouper davantage.")
        jeux.append({"nom": nom, "contenu": brut.decode("utf-8"), "octets": len(brut),
                     "empreinte": hashlib.sha256(brut).hexdigest()})
    if not any(j["nom"] == "socle" for j in jeux):
        raise SystemExit(f"{etab} : socle.json absent -- la page ne chargerait rien.")
    return jeux


def publier(conn, etab: str, jeux: list[dict], auteur: str) -> None:
    with conn.transaction():
        with conn.cursor() as cur:
            for j in jeux:
                cur.execute(
                    """insert into jeu_donnees
                         (etablissement, nom, contenu, octets, empreinte, publie_le, publie_par)
                       values (%s, %s, %s, %s, %s, now(), %s)
                       on conflict (etablissement, nom) do update set
                         contenu = excluded.contenu, octets = excluded.octets,
                         empreinte = excluded.empreinte, publie_le = now(),
                         publie_par = excluded.publie_par""",
                    (etab, j["nom"], j["contenu"], j["octets"], j["empreinte"], auteur))
            cur.execute("delete from jeu_donnees where etablissement = %s "
                        "and not (nom = any(%s))", (etab, [j["nom"] for j in jeux]))
            retires = cur.rowcount
    if retires:
        print(f"    {retires} jeu(x) retire(s) : absents de la nouvelle publication")


def verifier(conn, etab: str, jeux: list[dict]) -> None:
    with conn.cursor() as cur:
        cur.execute("select nom, octets, empreinte from jeu_donnees "
                    "where etablissement = %s", (etab,))
        en_base = {n: (o, e) for n, o, e in cur.fetchall()}
    attendu = {j["nom"]: (j["octets"], j["empreinte"]) for j in jeux}
    if en_base != attendu:
        raise SystemExit(f"{etab} : la base ne contient pas ce qui a ete publie.\n"
                         f"  attendu {sorted(attendu)}\n  en base {sorted(en_base)}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Publie les jeux de donnees dans Neon.")
    ap.add_argument("etablissements", nargs="*", metavar="etablissement",
                    help="parmi : " + ", ".join(ETABLISSEMENTS) + " (defaut : tous)")
    ap.add_argument("--essai", action="store_true",
                    help="verifie les fichiers et s'arrete avant toute connexion")
    args = ap.parse_args()
    voulus = args.etablissements or ETABLISSEMENTS
    inconnus = [e for e in voulus if e not in ETABLISSEMENTS]
    if inconnus:
        ap.error("etablissement inconnu : " + ", ".join(inconnus))

    lots = {}
    for etab in voulus:
        lots[etab] = preparer(etab)
        total = sum(j["octets"] for j in lots[etab])
        print(f"  {etab:<8} {len(lots[etab])} jeux   {total/1024:>7.0f} Ko")
        for j in lots[etab]:
            print(f"           {j['nom']:<24}{j['octets']/1024:>7.0f} Ko   "
                  f"{j['empreinte'][:12]}")
    if args.essai:
        print("\n  essai : rien n'a ete ecrit.")
        return 0

    import psycopg  # importe ici : --essai doit tourner sans le pilote

    auteur = getpass.getuser()
    with psycopg.connect(url_base(), autocommit=True) as conn:
        for instruction in instructions_schema():
            conn.execute(instruction)
        for etab, jeux in lots.items():
            publier(conn, etab, jeux, auteur)
            verifier(conn, etab, jeux)
            print(f"  {etab:<8} publie et verifie")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
