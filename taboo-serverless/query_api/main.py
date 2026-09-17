#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TABOO — API de detail. Service Cloud Run.

ROLE
----
Servir UNIQUEMENT ce que l'instantane ne peut pas porter : le detail
ligne a ligne. 99 % des interactions du tableau de bord n'appellent
jamais ce service -- elles filtrent l'instantane dans le navigateur.

C'est le seul composant qui detient le compte de service BigQuery, et le
seul qui execute une requete. Trois protections l'encadrent :

  1. LISTE BLANCHE. Aucun SQL ne vient du client. Le corps de la requete
     ne porte qu'une cle du catalogue et des parametres, passes en
     parametres nommes BigQuery -- donc hors de la chaine SQL, ce qui
     rend l'injection structurellement impossible.

  2. GARDE-FOUS DE COUT. maximum_bytes_billed par requete, amplitude de
     dates bornee, LIMIT plafonne, delai maximal. La requete qui derape
     est l'incident BigQuery numero un ; ces plafonds sont des
     disjoncteurs, pas des budgets.

  3. IDENTITE. Verification du jeton a chaque appel. En production,
     Cloud Run est place derriere IAP : l'en-tete signee par Google est
     verifiee ici, et le service refuse tout trafic direct.

CE QUI N'EST PAS ICI
--------------------
Aucun agregat, aucun ratio, aucune regle metier. Ils vivent dans la
couche semantique (semantique/registre.py) et dans les vues BigQuery.
Dupliquer une definition de metrique ici serait le premier pas vers deux
chiffres differents pour le meme indicateur.
"""

from __future__ import annotations

import logging
import os
from datetime import date, datetime, timedelta

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from requetes import CATALOGUE, catalogue_public

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)-7s %(message)s")
log = logging.getLogger("api-detail")

PROJET = os.environ.get("BQ_PROJET", "VOTRE_PROJET_GCP")
REGION = os.environ.get("BQ_REGION", "europe-west1")
# Origines autorisees a appeler l'API. Jamais "*" : ce service repond
# avec des donnees d'exploitation.
ORIGINES = [o for o in os.environ.get("ORIGINES_AUTORISEES", "").split(",") if o]
# En local uniquement : desactive la verification d'identite.
AUTH_DESACTIVEE = os.environ.get("AUTH_DESACTIVEE", "").lower() == "true"

app = FastAPI(title="TABOO — API de detail", version="1.0",
              docs_url=None, redoc_url=None, openapi_url=None)

if ORIGINES:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ORIGINES,
        allow_methods=["POST", "GET"],
        allow_headers=["authorization", "content-type"],
        max_age=3600,
    )

_bq = None


def bq():
    global _bq
    if _bq is None:
        from google.cloud import bigquery
        _bq = bigquery.Client(project=PROJET, location=REGION)
    return _bq


# =====================================================================
# IDENTITE
# =====================================================================

def identifier(request: Request) -> str:
    """Renvoie l'identifiant de l'appelant, ou leve 401.

    En production, IAP place devant Cloud Run injecte
    X-Goog-Authenticated-User-Email apres avoir valide l'identite. On la
    verifie tout de meme cote service : si quelqu'un atteignait
    directement l'URL Cloud Run en contournant IAP, l'en-tete serait
    absente et l'appel refuse. Ne jamais faire confiance a une en-tete
    sans verifier qu'elle a bien ete posee par le composant attendu.
    """
    if AUTH_DESACTIVEE:
        return "local"

    email = request.headers.get("x-goog-authenticated-user-email")
    if email:
        # IAP prefixe la valeur par "accounts.google.com:".
        return email.split(":")[-1]

    jeton = request.headers.get("authorization", "")
    if jeton.startswith("Bearer "):
        try:
            from google.auth.transport import requests as gr
            from google.oauth2 import id_token
            audience = os.environ.get("OIDC_AUDIENCE")
            infos = id_token.verify_oauth2_token(
                jeton[7:], gr.Request(), audience)
            return infos.get("email") or infos.get("sub") or "inconnu"
        except Exception as exc:                   # noqa: BLE001
            log.warning("Jeton refuse : %s", exc)
            raise HTTPException(401, "jeton invalide")

    raise HTTPException(401, "authentification requise")


# =====================================================================
# VALIDATION
# =====================================================================

class Demande(BaseModel):
    requete: str = Field(..., max_length=64)
    params: dict[str, str | int | None] = Field(default_factory=dict)


def valider(demande: Demande):
    """Verifie la demande contre le catalogue. Leve 400 avec un message
    exploitable -- un « requete invalide » sec obligerait a lire le code
    pour comprendre."""
    modele = CATALOGUE.get(demande.requete)
    if not modele:
        raise HTTPException(
            400, f"requete '{demande.requete}' inconnue. "
                 f"Disponibles : {sorted(CATALOGUE)}")

    fournis = {k: v for k, v in demande.params.items() if v not in (None, "")}
    attendus = {p.nom for p in modele.params}
    inconnus = set(fournis) - attendus
    if inconnus:
        raise HTTPException(400, f"parametres inconnus : {sorted(inconnus)}")

    valeurs: dict[str, object] = {}
    for p in modele.params:
        brut = fournis.get(p.nom)
        if brut is None:
            if p.obligatoire:
                raise HTTPException(400, f"parametre '{p.nom}' obligatoire")
            valeurs[p.nom] = None
            continue
        if p.valeurs_permises and str(brut) not in p.valeurs_permises:
            raise HTTPException(
                400, f"'{p.nom}' doit etre parmi {list(p.valeurs_permises)}")
        if p.type == "DATE":
            try:
                valeurs[p.nom] = date.fromisoformat(str(brut))
            except ValueError:
                raise HTTPException(
                    400, f"'{p.nom}' doit etre une date AAAA-MM-JJ, recu '{brut}'")
        elif p.type == "INT64":
            try:
                valeurs[p.nom] = int(brut)
            except (TypeError, ValueError):
                raise HTTPException(400, f"'{p.nom}' doit etre un entier")
        else:
            texte = str(brut)
            if len(texte) > 200:
                raise HTTPException(400, f"'{p.nom}' depasse 200 caracteres")
            valeurs[p.nom] = texte

    # -- garde-fou de cout : amplitude de dates bornee -------------------
    d1, d2 = valeurs.get("jour_debut"), valeurs.get("jour_fin")
    if isinstance(d1, date) and isinstance(d2, date):
        if d2 < d1:
            raise HTTPException(400, "jour_fin est anterieur a jour_debut")
        jours = (d2 - d1).days + 1
        if jours > modele.amplitude_max_jours:
            raise HTTPException(
                400,
                f"periode de {jours} jours demandee, maximum "
                f"{modele.amplitude_max_jours} pour '{modele.cle}'. "
                f"Les totaux sur longue periode sont dans l'instantane ; "
                f"cette API ne sert que le detail.")

    valeurs["lignes_max"] = modele.lignes_max
    return modele, valeurs


# =====================================================================
# POINTS D'ENTREE
# =====================================================================

@app.get("/sante")
def sante():
    """Sonde de disponibilite. Ne touche pas BigQuery : une sonde qui
    interroge la base facture a chaque appel du verificateur."""
    return {"etat": "ok", "projet": PROJET, "region": REGION,
            "requetes": sorted(CATALOGUE)}


@app.get("/catalogue")
def catalogue(request: Request):
    identifier(request)
    return {"requetes": catalogue_public()}


@app.post("/detail")
def detail(demande: Demande, request: Request):
    appelant = identifier(request)
    modele, valeurs = valider(demande)

    from google.cloud import bigquery

    types = {p.nom: p.type for p in modele.params}
    types["lignes_max"] = "INT64"
    parametres = [
        bigquery.ScalarQueryParameter(nom, types[nom], val)
        for nom, val in valeurs.items()
    ]

    config = bigquery.QueryJobConfig(
        query_parameters=parametres,
        maximum_bytes_billed=modele.octets_max,
        use_query_cache=True,
        priority=bigquery.QueryPriority.INTERACTIVE,
        labels={"app": "taboo-dashboard", "etape": "detail",
                "requete": modele.cle},
    )

    debut = datetime.now()
    try:
        job = bq().query(modele.sql, job_config=config)
        lignes = [dict(r) for r in job.result(timeout=30)]
    except Exception as exc:                       # noqa: BLE001
        message = str(exc)
        if "maximum_bytes_billed" in message or "bytes billed" in message:
            # Cas explicite : le disjoncteur a fonctionne. Le dire, plutot
            # que de renvoyer une erreur generique qu'on passera une heure
            # a diagnostiquer.
            log.warning("Plafond d'octets atteint sur '%s' (%s)", modele.cle, appelant)
            raise HTTPException(
                413, f"la requete depasse le plafond de "
                     f"{modele.octets_max // 1024 ** 2} Mo lus. Restreindre la periode.")
        log.exception("Echec de la requete '%s'", modele.cle)
        raise HTTPException(502, "la base de donnees n'a pas repondu")

    ms = int((datetime.now() - debut).total_seconds() * 1000)
    octets = job.total_bytes_billed or 0
    log.info("%s · %s · %d lignes · %.2f Mo · %d ms%s",
             appelant, modele.cle, len(lignes), octets / 1024 ** 2, ms,
             " (cache)" if job.cache_hit else "")

    def net(v):
        import decimal
        if isinstance(v, decimal.Decimal):
            f = float(v)
            return int(f) if f.is_integer() else f
        if isinstance(v, (date, datetime)):
            return v.isoformat()
        return v

    return {
        "requete": modele.cle,
        "lignes": [{k: net(v) for k, v in l.items()} for l in lignes],
        "nb_lignes": len(lignes),
        # Le front doit pouvoir dire « 5 000 premieres lignes sur davantage »
        # plutot que de laisser croire a un resultat complet.
        "tronque": len(lignes) >= modele.lignes_max,
        "lignes_max": modele.lignes_max,
        "duree_ms": ms,
        "octets_factures": octets,
        "depuis_cache": bool(job.cache_hit),
    }
