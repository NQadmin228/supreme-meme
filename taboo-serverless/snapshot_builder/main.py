#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TABOO — Generateur d'instantane. Job Cloud Run, declenche apres le MERGE.

CE QU'IL FAIT
-------------
  1. lit le registre de metriques et genere le SQL de chaque jeu
  2. execute les requetes sur BigQuery, sous plafond d'octets factures
  3. applique les invariants bloquants
  4. compare au dernier instantane publie (informatif)
  5. ecrit instantanes/<version>.json.br sur GCS
  6. ne bascule manifest.json QU'APRES ecriture reussie

POURQUOI UN INSTANTANE PLUTOT QUE DES REQUETES A LA DEMANDE
-----------------------------------------------------------
Tout le jeu de reporting tient en quelques megaoctets : 3 586 lignes au
grain jour x activite, 274 articles, 30 381 lignes horaires. BigQuery est
un moteur de scan facture a l'octet, avec 200 ms a 2 s de latence. Le
faire repondre a chaque changement de filtre, c'est payer et attendre
pour rejouer indefiniment le meme calcul.

L'instantane inverse le rapport : une execution par jour, cout fixe et
negligeable, puis un fichier servi par le CDN que le navigateur filtre
localement en moins de 100 ms. Aucune donnee d'identification n'atteint
le client, et le tableau de bord continue de fonctionner si BigQuery est
indisponible.

BASCULE ATOMIQUE
----------------
L'instantane est ecrit sous un nom VERSIONNE, puis manifest.json est
mis a jour. Un lecteur voit donc soit l'ancienne version complete, soit
la nouvelle complete, jamais un fichier a moitie ecrit. Les versions
precedentes sont conservees : revenir en arriere consiste a reecrire le
manifeste, sans rejouer aucune requete.

EXECUTION LOCALE
----------------
  python main.py --dry-run    n'affiche que le SQL genere, sans BigQuery
  python main.py --sortie ./  ecrit l'instantane en local au lieu de GCS
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from semantique import registre as R           # noqa: E402
from invariants import (                        # noqa: E402
    controler, comparer_reference, InvariantViole)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S")
log = logging.getLogger("instantane")

# --- Configuration, par variables d'environnement en production --------
PROJET = os.environ.get("BQ_PROJET", R.PROJET)
REGION = os.environ.get("BQ_REGION", R.REGION)
BUCKET = os.environ.get("GCS_BUCKET_INSTANTANES", "VOTRE_BUCKET_INSTANTANES")

# Plafond d'octets FACTURES par requete. La requete qui derape est
# l'incident BigQuery numero un : sans plafond, une jointure mal ecrite
# scanne des teraoctets avant que quiconque le remarque. 2 Go est deja
# tres large pour ce jeu -- l'ensemble des tables analytics fait quelques
# dizaines de megaoctets. C'est un disjoncteur, pas un budget.
PLAFOND_OCTETS = int(os.environ.get("BQ_MAX_BYTES_BILLED", 2 * 1024 ** 3))
DELAI_MAX_MS = int(os.environ.get("BQ_TIMEOUT_MS", 120_000))


# =====================================================================
# BIGQUERY
# =====================================================================

def client_bq():
    from google.cloud import bigquery
    return bigquery.Client(project=PROJET, location=REGION)


def config_job():
    from google.cloud import bigquery
    return bigquery.QueryJobConfig(
        maximum_bytes_billed=PLAFOND_OCTETS,
        use_query_cache=True,        # gratuit, 24 h, sur requete identique
        priority=bigquery.QueryPriority.INTERACTIVE,
        labels={"app": "taboo-dashboard", "etape": "instantane"},
    )


def executer(bq, sql: str, nom: str) -> tuple[list[dict], int]:
    """Execute une requete et renvoie (lignes, octets factures)."""
    job = bq.query(sql, job_config=config_job(), job_id_prefix=f"taboo_{nom}_")
    lignes = [dict(r) for r in job.result(timeout=DELAI_MAX_MS / 1000)]
    octets = job.total_bytes_billed or 0
    cache = " (cache)" if job.cache_hit else ""
    log.info("  %-24s %6d lignes  %7.2f Mo factures%s",
             nom, len(lignes), octets / 1024 ** 2, cache)
    return lignes, octets


def normaliser(valeur):
    """Rend une valeur BigQuery serialisable en JSON strict.

    NUMERIC arrive en Decimal et DATE en datetime.date : ni l'un ni
    l'autre n'est serialisable par json. Les entiers sont ecrits comme
    entiers -- « 10500.0 » pese plus que « 10500 » sur 30 000 lignes, et
    se lit moins bien dans une infobulle.
    """
    import decimal
    import datetime as dt

    if valeur is None:
        return None
    if isinstance(valeur, bool):
        return valeur
    if isinstance(valeur, decimal.Decimal):
        f = float(valeur)
        return int(f) if f.is_integer() else f
    if isinstance(valeur, float):
        return int(valeur) if valeur.is_integer() else valeur
    if isinstance(valeur, (dt.date, dt.datetime)):
        return valeur.strftime("%Y-%m-%d")
    return valeur


def normaliser_lignes(lignes: list[dict]) -> list[dict]:
    return [{k: normaliser(v) for k, v in l.items()} for l in lignes]


# =====================================================================
# CONTEXTE DES INVARIANTS
# =====================================================================

SQL_ACHATS_SOURCE = f"""
-- Total des achats lu DIRECTEMENT a la source, sans passer par
-- v_resultat_jour. C'est le seul temoin capable de reveler qu'une
-- jointure de la vue a perdu des lignes.
SELECT SUM(montant) AS total
FROM `{PROJET}.analytics.depenses`
WHERE nature = 'ACHATS EXTERNES' AND categorie_vente IS NOT NULL
"""


def contexte_controles(bq) -> tuple[dict, int]:
    lignes, octets = executer(bq, SQL_ACHATS_SOURCE, "temoin_achats")
    total = normaliser(lignes[0]["total"]) if lignes else None
    return {"total_achats_source": total}, octets


# =====================================================================
# GCS
# =====================================================================

def lire_reference(storage, bucket: str) -> dict | None:
    """Charge l'instantane actuellement publie, pour comparaison."""
    import brotli
    try:
        b = storage.bucket(bucket)
        blob_manifeste = b.blob("manifest.json")
        if not blob_manifeste.exists():
            return None
        manifeste = json.loads(blob_manifeste.download_as_bytes())
        blob = b.blob(manifeste["fichier"])
        if not blob.exists():
            return None
        return json.loads(brotli.decompress(blob.download_as_bytes()))
    except Exception as exc:                       # noqa: BLE001
        # Ne jamais faire echouer une publication parce que la
        # comparaison au precedent est indisponible : elle est
        # informative, pas bloquante.
        log.warning("Reference illisible, comparaison ignoree : %s", exc)
        return None


def publier(storage, bucket: str, instantane: dict, version: str) -> dict:
    """Ecrit l'instantane versionne puis bascule le manifeste."""
    import brotli
    b = storage.bucket(bucket)
    charge = json.dumps(instantane, ensure_ascii=False,
                        separators=(",", ":"), allow_nan=False).encode("utf-8")
    comprime = brotli.compress(charge, quality=10)
    empreinte = hashlib.sha256(charge).hexdigest()[:16]

    chemin = f"instantanes/{version}.json.br"
    blob = b.blob(chemin)
    blob.content_encoding = "br"
    blob.content_type = "application/json"
    # Nom versionne, donc contenu immuable : le CDN peut le garder un an.
    blob.cache_control = "public, max-age=31536000, immutable"
    blob.upload_from_string(comprime, content_type="application/json")
    log.info("Instantane ecrit : %s (%.0f Ko comprimes, %.0f Ko brut)",
             chemin, len(comprime) / 1024, len(charge) / 1024)

    manifeste = {
        "version": version,
        "fichier": chemin,
        "empreinte": empreinte,
        "octets_comprimes": len(comprime),
        "octets_bruts": len(charge),
        "publie_le": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "periode_debut": instantane["meta"]["periode_debut"],
        "periode_fin": instantane["meta"]["periode_fin"],
        "version_registre": instantane["meta"]["version_registre"],
    }
    bm = b.blob("manifest.json")
    bm.content_type = "application/json"
    # Le manifeste, lui, change a chaque publication : jamais de cache
    # long, sinon les navigateurs continueraient de servir l'ancienne
    # version pendant des heures.
    bm.cache_control = "public, max-age=60, must-revalidate"
    bm.upload_from_string(
        json.dumps(manifeste, ensure_ascii=False, indent=2),
        content_type="application/json")
    log.info("Manifeste bascule sur %s", version)
    return manifeste


# =====================================================================
# PROGRAMME PRINCIPAL
# =====================================================================

def deriver(jeux: dict[str, list[dict]]) -> dict:
    """Grandeurs derivees des jeux, calculees ICI et non dans le navigateur.

    Ce sont des lectures metier, pas de la mise en forme : la concentration
    du CA, l'etat du comptage d'inventaire, les avertissements de qualite.
    Les calculer cote serveur les garde dans la couche semantique, donc
    identiques pour tout consommateur de l'instantane -- interface web,
    export, ou rapport a venir.
    """
    derive: dict = {}
    alertes: list[str] = []

    # -- Concentration du CA : combien d'articles font 80 % du chiffre ---
    arts = sorted(jeux.get("articles", []), key=lambda a: -(a.get("cn") or 0))
    total = sum((a.get("cn") or 0) for a in arts)
    n80, cumul = 0, 0.0
    for a in arts:
        cumul += a.get("cn") or 0
        n80 += 1
        if total and cumul / total >= 0.8:
            break
    derive["pareto"] = {"n_articles_80pct": n80, "n_articles_total": len(arts)}

    # -- Inventaire : le comptage physique a-t-il ete saisi ? ------------
    inv = jeux.get("inventaire", [])
    compte = sum(1 for i in inv if (i.get("qp") or 0) > 0)
    sous_alerte = [i for i in inv
                   if (i.get("sa") or 0) > 0 and (i.get("qt") or 0) <= i["sa"]]
    derive["inventaire_meta"] = {
        "comptage_saisi": compte > 0,
        "n_articles": len(inv),
        "n_comptes": compte,
        "n_sous_alerte": len(sous_alerte),
        "n_avec_seuil": sum(1 for i in inv if (i.get("sa") or 0) > 0),
    }
    if inv and compte == 0:
        alertes.append(
            f"Inventaire : la quantite physique est a 0 sur les {len(inv)} "
            "articles — le comptage n'a jamais ete saisi dans le POS. L'ecart "
            "affiche n'est donc PAS une demarque : il vaut mecaniquement "
            "l'oppose du stock theorique. Seuls le stock theorique et le "
            "seuil d'alerte sont exploitables.")

    # -- Couverture des couts de revient --------------------------------
    couts = jeux.get("couts_articles", [])
    cn_couvert = sum((c.get("cn") or 0) for c in couts)
    if total and cn_couvert / total < 0.5:
        alertes.append(
            f"Couts de revient : {100 * cn_couvert / total:.1f} % du CA "
            "seulement est couvert par une fiche technique. La marge "
            "theorique ne porte que sur ce perimetre.")
    partiels = sum(1 for c in couts if c.get("st") != "Complet")
    if partiels:
        alertes.append(
            f"Couts de revient : {partiels} fiches sur {len(couts)} ont un "
            "ingredient manquant. Leur cout est sous-evalue, donc leur marge "
            "theorique surevaluee.")

    derive["alertes_qualite"] = alertes
    return derive


def construire(bq) -> tuple[dict, int]:
    jeux: dict[str, list[dict]] = {}
    octets_total = 0

    log.info("Execution des requetes du registre :")
    for jeu in R.JEUX:
        lignes, octets = executer(bq, jeu.sql(), jeu.cle)
        jeux[jeu.cle] = normaliser_lignes(lignes)
        octets_total += octets

    contexte, octets_temoin = contexte_controles(bq)
    octets_total += octets_temoin

    log.info("Controle des invariants :")
    resultats = controler(jeux, contexte)
    for r in resultats:
        log.info("  [OK] %-42s %s", r.libelle, r.detail)

    rj = jeux["resultat_jour"]
    dates = sorted(l["d"] for l in rj if l.get("d"))
    instantane = {
        "meta": {
            "version_registre": R.registre_json()["version_registre"],
            "genere_le": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "periode_debut": dates[0] if dates else None,
            "periode_fin": dates[-1] if dates else None,
            "jours_exploitation": len({l["d"] for l in rj}),
            "source": f"BigQuery {PROJET}, region {REGION}",
        },
        "registre": R.registre_json(),
        **deriver(jeux),
        **jeux,
    }
    return instantane, octets_total


def main() -> int:
    ap = argparse.ArgumentParser(description="Genere l'instantane du dashboard TABOO.")
    ap.add_argument("--dry-run", action="store_true",
                    help="affiche le SQL genere et sort, sans toucher a BigQuery")
    ap.add_argument("--sortie", metavar="DOSSIER",
                    help="ecrit l'instantane en local au lieu de GCS")
    ap.add_argument("--bucket", default=BUCKET)
    args = ap.parse_args()

    erreurs = R.valider_registre()
    if erreurs:
        log.error("Registre invalide, aucune requete lancee :")
        for e in erreurs:
            log.error("  - %s", e)
        return 2

    if args.dry_run:
        for jeu in R.JEUX:
            print(f"\n-- {jeu.cle}  ({jeu.grain})\n{jeu.sql()};")
        print(f"\n-- temoin des invariants{SQL_ACHATS_SOURCE};")
        return 0

    version = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    try:
        bq = client_bq()
        instantane, octets = construire(bq)
    except InvariantViole as exc:
        # Sortie 1 : Cloud Run marque le job en echec, l'alerte part, et
        # l'instantane precedent reste servi.
        log.error("PUBLICATION REFUSEE%s", exc)
        return 1
    except Exception as exc:                       # noqa: BLE001
        log.exception("Echec de construction : %s", exc)
        return 1

    log.info("Total facture : %.2f Mo", octets / 1024 ** 2)

    if args.sortie:
        dossier = Path(args.sortie)
        dossier.mkdir(parents=True, exist_ok=True)
        cible = dossier / f"{version}.json"
        cible.write_text(
            json.dumps(instantane, ensure_ascii=False,
                       separators=(",", ":"), allow_nan=False),
            encoding="utf-8")
        (dossier / "manifest.json").write_text(
            json.dumps({"version": version, "fichier": cible.name},
                       ensure_ascii=False, indent=2), encoding="utf-8")
        log.info("Ecrit en local : %s (%.0f Ko)",
                 cible, cible.stat().st_size / 1024)
        return 0

    from google.cloud import storage as gcs
    storage = gcs.Client(project=PROJET)

    alertes = comparer_reference(instantane, lire_reference(storage, args.bucket))
    for a in alertes:
        log.warning("ECART vs instantane precedent : %s", a)

    publier(storage, args.bucket, instantane, version)
    log.info("Termine.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
