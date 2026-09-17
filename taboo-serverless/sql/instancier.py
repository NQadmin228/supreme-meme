#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Remplace les placeholders des fichiers SQL par les valeurs de config.env.

Les fichiers versionnes portent VOTRE_PROJET_GCP et VOTRE_BUCKET_*, pour
deux raisons : le depot est public, et un nom de projet en dur le rendrait
inutilisable pour un autre etablissement.

  python sql/instancier.py           -> sql/*.instancie.sql
  python sql/instancier.py --verifier -> signale seulement ce qui manque

Les fichiers produits sont exclus du depot.
"""
import argparse
import pathlib
import re
import sys

BASE = pathlib.Path(__file__).resolve().parent
RACINE = BASE.parent
CONFIG = RACINE / "config.env"

PLACEHOLDERS = {
    "VOTRE_PROJET_GCP": "BQ_PROJET",
    "VOTRE_BUCKET_SOURCES": "GCS_BUCKET_SOURCES",
    "VOTRE_BUCKET_INSTANTANES": "GCS_BUCKET_INSTANTANES",
}


def lire_config() -> dict:
    if not CONFIG.exists():
        raise SystemExit(
            f"\n{CONFIG.name} absent.\n"
            f"  cp config.example.env config.env  puis renseigner les valeurs.\n")
    conf = {}
    for ligne in CONFIG.read_text(encoding="utf-8").splitlines():
        ligne = ligne.strip()
        if not ligne or ligne.startswith("#") or "=" not in ligne:
            continue
        cle, _, val = ligne.partition("=")
        conf[cle.strip()] = val.strip()
    return conf


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verifier", action="store_true",
                    help="liste les placeholders sans rien ecrire")
    args = ap.parse_args()

    sources = sorted(p for p in BASE.glob("*.sql")
                     if not p.name.endswith(".instancie.sql"))
    if args.verifier:
        for p in sources:
            trouves = {ph for ph in PLACEHOLDERS if ph in p.read_text(encoding="utf-8")}
            print(f"  {p.name:<38} {sorted(trouves) or 'aucun placeholder'}")
        return 0

    conf = lire_config()
    manquants = [v for ph, v in PLACEHOLDERS.items() if not conf.get(v)]
    if manquants:
        raise SystemExit(f"\nvaleurs absentes de config.env : {manquants}\n")

    for p in sources:
        s = p.read_text(encoding="utf-8")
        for ph, cle in PLACEHOLDERS.items():
            s = s.replace(ph, conf[cle])
        # Un placeholder oublie produirait un nom de table invalide, donc
        # une erreur BigQuery obscure. Mieux vaut echouer ici.
        restants = re.findall(r"VOTRE_[A-Z_]+", s)
        if restants:
            raise SystemExit(
                f"\n{p.name} : placeholders non resolus {sorted(set(restants))}\n"
                f"  Ajouter la variable correspondante a config.env.\n")
        cible = p.with_suffix(".instancie.sql")
        cible.write_text(s, encoding="utf-8")
        print(f"  {p.name:<38} -> {cible.name}")

    print(f"\nA executer dans l'ordre numerique :")
    print(f"  bq query --use_legacy_sql=false --location={conf['BQ_REGION']} "
          f"< sql/12_fix_v_resultat_jour.instancie.sql")
    return 0


if __name__ == "__main__":
    sys.exit(main())
