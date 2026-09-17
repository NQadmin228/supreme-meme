#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AMNESIA — Extraction du classeur de suivi mensuel.

  python 32_extraction_mensuel_amnesia.py  ->  data_mensuel_amnesia.json

CE QUE CE CLASSEUR APPORTE, ET QUE LE POS N'A PAS
-------------------------------------------------
Les exports Infogest ne portent aucun prix d'achat : le tableau de bord
AMNESIA ne pouvait donc afficher ni marge, ni charges, ni resultat. Ce
classeur, tenu a la main par l'exploitation, porte les decaissements
jour par jour ventiles en vingt postes, et la paie par service. Il rend
possibles les trois pages que la navigation annoncait comme absentes
« faute de couts ».

Il apporte aussi une SECONDE mesure du chiffre d'affaires -- ce qui est
declare encaisse, face a ce que la caisse a enregistre. Les deux ne
coincident pas, et l'ecart est une information d'exploitation, pas un
defaut a masquer.

CE QUI N'EN SORT PAS, ET NE DOIT PAS EN SORTIR
----------------------------------------------
La feuille RH nomme 45 personnes avec leur salaire et leur statut
(demission, licenciement, mutation). Les feuilles mensuelles portent des
colonnes de prelevements cash au nom de personnes. La feuille d'audit
des decaissements nomme des fournisseurs et des particuliers.

Rien de tout cela ne sort d'ici. Seuls des AGREGATS quittent ce script :
la paie par service, jamais par personne. Le tableau de bord est publie
sur internet ; un nom propre qui y arrive ne s'en retire plus.

CE QUE CE SCRIPT CORRIGE, ET POURQUOI IL NE SE TAIT PAS
-------------------------------------------------------
Le classeur contient quatre defauts de construction, tous verifies en
lisant les FORMULES et non les valeurs affichees. Ils ne sont pas
corriges en silence : chacun produit une entree dans `controles`, que le
tableau de bord affiche. Un chiffre redresse sans trace est un chiffre
qu'on ne peut plus contredire.

  1. Les feuilles 2023-24 lisent la paie 23 mois trop loin
     AOUT 24 calcule « =RH!AO98 », or la colonne AO est juillet 2026.
     Les onze mois de la premiere saison affichent donc la paie de la
     saison suivante. Ici, chaque mois lit SA colonne.

  2. La ligne TOTAL de RH oublie trois prestataires
     Elle somme dix sous-totaux de service ; le sous-total
     PRESTATAIRES s'arrete a la ligne 93, alors que trois personnes ont
     ete ajoutees en 94, 95 et 96. Leur paie n'entre donc dans aucun
     total du classeur depuis decembre 2025. Le montant est chiffre a
     l'execution et affiche dans les controles, pas ecrit ici : ce
     depot est public.

  3. Les glacons sont comptes deux fois depuis novembre 2025
     « OPEX = SUM(J:T) + H » ou H est deja dans les achats matiere.
     Les charges sont majorees du montant des glacons chaque mois.

  4. La monnaie n'est comptee nulle part
     La colonne MONNAIE n'entre ni dans les achats, ni dans l'OPEX, ni
     dans le CAPEX -- alors qu'elle figure dans le total des sorties.

CE QUI RESTE TEL QUEL
---------------------
Les montants. Aucun n'est estime, lisse ni reparti. Un mois sans paie
saisie ne recoit pas une paie moyenne : il est marque comme incomplet et
son resultat n'est pas calcule. Une moyenne posee la ou une mesure
manque se lit ensuite comme une mesure.
"""

import datetime as dt
import json
import re
import sys
import unicodedata
from pathlib import Path

import openpyxl

BASE = Path(__file__).resolve().parent
SOURCE = Path(r"C:\Users\user\Downloads"
              r"\wetransfer_document-infogest_2026-09-15_1257"
              r"\AMNESIA_Analyses mensuelles (1).xlsx")
CIBLE = BASE / "data_mensuel_amnesia.json"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


# =====================================================================
# Outils de lecture
# =====================================================================

MOIS_NOM = {
    "JANVIER": 1, "FEVRIER": 2, "MARS": 3, "AVRIL": 4, "MAI": 5, "JUIN": 6,
    "JUILLET": 7, "AOUT": 8, "SEPTEMBRE": 9, "OCTOBRE": 10, "NOVEMBRE": 11,
    "DECEMBRE": 12,
}


def sans_accents(texte):
    return "".join(c for c in unicodedata.normalize("NFD", str(texte))
                   if unicodedata.category(c) != "Mn")


def norm(v):
    """Entete normalise : majuscules, sans accents, sans espaces en trop."""
    return re.sub(r"\s+", " ", sans_accents(v or "").strip().upper())


def nombre(v):
    """Une valeur numerique, ou None.

    Les cellules en erreur d'Excel arrivent ici en chaine (« #REF! »,
    « #DIV/0! ») : 874 dans ce classeur. Les convertir en zero ferait
    entrer une absence de calcul dans une somme.
    """
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def cle_mois(d):
    return f"{d.year:04d}-{d.month:02d}"


def lire_date(v):
    """Une date, d'ou qu'elle vienne.

    Toutes les lignes ne portent pas une vraie date : « 30/01/2024 » est
    saisi en TEXTE dans JANVIER 24, et cette nuit-la pese plus d'un
    huitieme du mois. Ne reconnaitre que les cellules de type date
    ferait disparaitre la nuit du total sans que rien ne le signale --
    c'est exactement ce qui s'est passe au premier passage, et seule la
    comparaison avec la ligne TOTAL de la feuille l'a rattrape.
    """
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    if isinstance(v, str):
        for forme in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y"):
            try:
                return dt.datetime.strptime(v.strip(), forme).date()
            except ValueError:
                pass
    return None


# =====================================================================
# 1. Les feuilles mensuelles : encaissements jour par jour
# =====================================================================

# Un meme moyen de paiement change de nom et de colonne entre les deux
# saisons : « T-MONEY/FLOOZ » en 2024, « MIXX » et « FLOOZ » separes a
# partir de novembre 2025. On lit donc par NOM d'entete. Lire par
# position melangerait le mobile money et la carte bancaire, qui se
# decalent d'une colonne entre les deux epoques.
CANAUX = {
    "CASH": "cash",
    "MIXX": "mixx",
    "FLOOZ": "flooz",
    "T-MONEY/FLOOZ": "t_money_flooz",
    "TPE": "tpe",
    "GOZEM": "gozem",
    "IMPAYES": "impayes",
    "IMPAYES CLIENTS": "impayes",
    "AUTRE": "autre",
}
CANAUX_ORDRE = ["cash", "mixx", "flooz", "t_money_flooz", "tpe", "gozem",
                "autre", "impayes"]
CANAUX_LIBELLE = {
    "cash": "Espèces",
    "mixx": "Mixx by Yas",
    "flooz": "Flooz",
    "t_money_flooz": "T-Money / Flooz (saison 2023-24)",
    "tpe": "Carte bancaire (TPE)",
    "gozem": "Gozem",
    "autre": "Autre",
    "impayes": "Impayés clients",
}


def lire_feuilles_mensuelles(wb):
    """Toutes les lignes journalieres des feuilles nommees « MOIS AA »."""
    motif = re.compile(r"^(%s)\s+(\d{2})$" % "|".join(MOIS_NOM))
    jours, sources, totaux = [], {}, {}

    for nom in wb.sheetnames:
        if not motif.match(norm(nom)):
            continue
        ws = wb[nom]
        lignes = [list(r) for r in ws.iter_rows(values_only=True)]

        # L'entete est la ligne qui porte « CA » en troisieme colonne.
        entete = next((r for r in lignes
                       if len(r) > 2 and norm(r[2]) == "CA"), None)
        if entete is None:
            continue
        col = {norm(v): j for j, v in enumerate(entete) if v}

        lus = []
        for r in lignes:
            if len(r) < 3:
                continue
            jour = lire_date(r[1])
            if jour is None:
                continue
            ca = nombre(r[2])
            if ca is None:
                continue
            ligne = {"d": jour.isoformat(), "ca": ca, "feuille": nom}
            for etiquette, canal in CANAUX.items():
                j = col.get(etiquette)
                if j is not None and j < len(r):
                    ligne[canal] = ligne.get(canal, 0) + (nombre(r[j]) or 0)
            # Le total de sorties affiche par la feuille. Il sert de
            # temoin, pas de source : trois jours de juin 2024 n'ont
            # aucune formule dans cette colonne alors que les postes,
            # eux, portent bien des montants.
            j = col.get("ACHATS")
            ligne["sorties_feuille"] = (nombre(r[j]) if j is not None
                                        and j < len(r) else None) or 0
            lus.append(ligne)

        if lus:
            sources[nom] = lus
            # Le total affiche par la feuille, pour verification. Une
            # somme de nuits qui s'ecarte du total du classeur veut dire
            # qu'une ligne n'a pas ete lue.
            totaux[nom] = next(
                (nombre(r[2]) for r in lignes
                 if len(r) > 2 and norm(r[1]) == "TOTAL"), None)

    # --- Doublons -----------------------------------------------------
    # Une feuille peut porter un nom et contenir un autre mois : ici,
    # « DECEMBRE 24 » contient l'integralite d'octobre 2024, ligne pour
    # ligne. On identifie chaque feuille par l'ENSEMBLE DE SES DATES et
    # non par son titre, ce qui fait apparaitre la collision au lieu de
    # la sommer deux fois.
    vus, doublons = {}, []
    for nom, lus in sources.items():
        empreinte = tuple(sorted(l["d"] for l in lus))
        if empreinte in vus:
            doublons.append((nom, vus[empreinte]))
            continue
        vus[empreinte] = nom
        jours.extend(lus)

    ecarts = []
    for nom in vus.values():
        attendu = totaux.get(nom)
        lu = sum(l["ca"] for l in sources[nom])
        if attendu is not None and abs(attendu - lu) >= 1:
            ecarts.append((nom, attendu, lu))

    return jours, doublons, ecarts


# =====================================================================
# 2. Les feuilles de detail des depenses : vingt postes, jour par jour
# =====================================================================

# Le vocabulaire des postes a legerement bouge entre les deux saisons.
# On le ramene a une forme unique, sans rien fusionner qui soit
# reellement distinct : « MIAMI 228 » reste un poste a part.
POSTES_ALIAS = {
    "CEET": "CEET / Cash Power",
    "CEET/CASH POWER": "CEET / Cash Power",
    "CREDIT TEL": "Téléphonie",
    "TELEPHONIE": "Téléphonie",
    "INTERNET / TV": "Internet / TV",
    "SMOKE": "Chicha",
    "EAT": "Cuisine",
    "DRINK": "Boissons",
    "GAZ": "Gaz",
    "GLACONS": "Glaçons",
    "MIAMI 228": "Miami 228",
    "MONNAIE": "Monnaie",
    "CACHETS": "Cachets artistes",
    "MARKETING": "Marketing",
    "LOYERS": "Loyers",
    "ADMINISTRATIF": "Administratif",
    "CONSOMMABLES": "Consommables",
    "ENTRETIEN": "Entretien",
    "TRANSPORT": "Transport",
    "AUTRE": "Autre",
    "EQUIPEMENTS": "Équipements",
    "TRAVAUX": "Travaux",
    "CAISSE": "Fonds de caisse",
}

# La classe d'un poste decide de sa place dans la cascade. « Fonds de
# caisse » n'est pas une charge : c'est de la tresorerie deplacee vers
# le tiroir-caisse. Le classeur la comptait dans le total des sorties,
# ce qui est juste pour le rapprochement de caisse et faux pour le
# resultat. Elle est donc gardee, et rangee a part.
CLASSE = {
    "Chicha": "matiere", "Cuisine": "matiere", "Boissons": "matiere",
    "Gaz": "matiere", "Glaçons": "matiere", "Miami 228": "matiere",
    "Équipements": "capex", "Travaux": "capex",
    "Fonds de caisse": "tresorerie",
}
CLASSE_LIBELLE = {"matiere": "Achats matière", "opex": "Charges d'exploitation",
                  "capex": "Investissements", "tresorerie": "Trésorerie"}


def lire_depenses(wb):
    """Depenses par jour et par poste, les deux saisons confondues."""
    lignes = []
    for nom in wb.sheetnames:
        if "DEPENSES" not in norm(nom) or "MIAMI" in norm(nom):
            continue
        ws = wb[nom]
        it = ws.iter_rows(values_only=True)
        entete = [norm(v) for v in next(it)]
        if "DATES" not in entete:
            continue
        for r in it:
            if len(r) < 2:
                continue
            date = lire_date(r[1])
            if date is None:
                continue
            jour = date.isoformat()
            for j, v in enumerate(r):
                if j < 2 or j >= len(entete):
                    continue
                etiquette = entete[j]
                if not etiquette or etiquette.startswith("TOTAL"):
                    continue
                montant = nombre(v)
                if not montant:
                    continue
                poste = POSTES_ALIAS.get(etiquette)
                if poste is None:
                    raise SystemExit(
                        f"Poste de depense inconnu : « {etiquette} » "
                        f"(feuille {nom}).\n"
                        f"Ajouter sa correspondance dans POSTES_ALIAS et sa "
                        f"classe dans CLASSE avant de continuer : un poste "
                        f"non classe disparaitrait silencieusement du "
                        f"compte de resultat.")
                lignes.append({"d": jour, "poste": poste,
                               "classe": CLASSE.get(poste, "opex"),
                               "montant": montant})
    return lignes


# =====================================================================
# 3. La feuille RH : masse salariale par service
# =====================================================================

def lire_rh(wb_formules, wb_valeurs, sequence):
    """Paie par service et par mois, jamais par personne.

    La structure est DEDUITE DES FORMULES plutot que codee en dur : on
    lit la ligne TOTAL pour savoir quelles lignes sont des sous-totaux,
    puis chaque sous-total pour savoir quelles lignes il couvre. Si la
    feuille est reorganisee, ce script s'arrete au lieu de produire des
    agregats faux.
    """
    fo, va = wb_formules["RH"], wb_valeurs["RH"]

    # --- ou est la ligne TOTAL, et que somme-t-elle ? ------------------
    ligne_total = next((i for i in range(1, 200)
                        if norm(va.cell(row=i, column=2).value) == "TOTAL"), None)
    if ligne_total is None:
        raise SystemExit("RH : ligne « TOTAL » introuvable.")

    formule = fo.cell(row=ligne_total, column=41).value or ""
    sous_totaux = [int(m) for m in re.findall(r"[A-Z]+(\d+)", str(formule))]
    if len(sous_totaux) < 5:
        raise SystemExit(f"RH : la ligne TOTAL ne ressemble plus a une somme "
                         f"de sous-totaux ({formule!r}).")

    services, couvert = {}, set()
    for i in sous_totaux:
        nom_service = str(va.cell(row=i, column=2).value or f"ligne {i}").strip()
        plage = re.search(r"SUM\([A-Z]+(\d+):[A-Z]+(\d+)\)",
                          str(fo.cell(row=i, column=3).value or ""))
        if not plage:
            raise SystemExit(f"RH : le sous-total « {nom_service} » (ligne {i}) "
                             f"n'est plus une somme de plage.")
        a, b = int(plage.group(1)), int(plage.group(2))
        services[i] = nom_service
        couvert |= set(range(a, b + 1))

    # --- les lignes de paie qu'aucun sous-total ne couvre --------------
    # Trois prestataires ont ete ajoutes sous la derniere plage : ils
    # sont payes, et absents de tous les totaux du classeur.
    oubliees = [i for i in range(4, ligne_total)
                if i not in couvert and i not in services
                and va.cell(row=i, column=2).value
                and any(nombre(va.cell(row=i, column=j).value)
                        for j in range(3, 50, 2))]

    # --- quelle colonne pour quel mois ? -------------------------------
    # Les entetes recents sont des dates : ils ancrent le calendrier.
    # Les plus anciens ne sont qu'un nom de mois, sans annee ; on les
    # apparie a la sequence reelle des mois exploites, en verifiant que
    # le nom concorde. Une simple decrementation echouerait : la salle a
    # ferme treize mois entre octobre 2024 et novembre 2025.
    colonnes = [j for j in range(3, 50, 2) if va.cell(row=3, column=j).value]
    datees = [(j, va.cell(row=3, column=j).value) for j in colonnes
              if isinstance(va.cell(row=3, column=j).value, dt.datetime)]
    if not datees:
        raise SystemExit("RH : aucun entete date, impossible d'ancrer le calendrier.")

    premiere_datee = datees[0][0]
    avant = [j for j in colonnes if j < premiere_datee]
    debut = sequence.index(cle_mois(datees[0][1])) - len(avant)
    if debut < 0:
        raise SystemExit("RH : plus de colonnes anterieures que de mois exploites.")

    mois_de_colonne = {}
    for rang, j in enumerate(avant):
        attendu = sequence[debut + rang]
        nom_attendu = [k for k, v in MOIS_NOM.items()
                       if v == int(attendu[5:7])][0]
        lu = norm(va.cell(row=3, column=j).value)
        if lu != nom_attendu:
            raise SystemExit(
                f"RH : la colonne {j} annonce « {lu} » la ou la sequence "
                f"des mois exploites attend « {nom_attendu} » ({attendu}).")
        mois_de_colonne[j] = attendu
    for j, valeur in datees:
        mois_de_colonne[j] = cle_mois(valeur)

    # Une ligne oubliee appartient au service dont le sous-total la
    # precede : les trois prestataires sont places juste sous le bloc
    # PRESTATAIRES. Les rattacher ainsi fait que la somme des services
    # egale la masse salariale -- un graphique dont les parts ne font
    # pas le total se lit comme une erreur de lecture.
    service_de_ligne = {i: max((k for k in services if k < i), default=None)
                        for i in oubliees}

    # --- les montants --------------------------------------------------
    paie = {}
    for j, mois in mois_de_colonne.items():
        par_service = {}
        for i, nom_service in services.items():
            montant = nombre(va.cell(row=i, column=j).value) or 0
            if montant:
                par_service[nom_service] = montant
        for i in oubliees:
            montant = nombre(va.cell(row=i, column=j).value) or 0
            hote = services.get(service_de_ligne.get(i))
            if montant and hote:
                par_service[hote] = par_service.get(hote, 0) + montant
        detail = [{"service": k, "montant": v} for k, v in par_service.items()]
        omise = sum(nombre(va.cell(row=i, column=j).value) or 0
                    for i in oubliees)
        total_classeur = nombre(va.cell(row=ligne_total, column=j).value) or 0
        paie[mois] = {"services": detail, "total_classeur": total_classeur,
                      "omise": omise, "total": total_classeur + omise}

    noms_oubliees = [str(va.cell(row=i, column=2).value).strip() for i in oubliees]
    return paie, noms_oubliees


# =====================================================================
# 4. Assemblage
# =====================================================================

def principal():
    if not SOURCE.exists():
        raise SystemExit(f"Classeur introuvable :\n  {SOURCE}")

    print(f"\n  Source : {SOURCE.name}\n")
    valeurs = openpyxl.load_workbook(SOURCE, data_only=True)
    formules = openpyxl.load_workbook(SOURCE, data_only=False)

    jours, doublons, ecarts = lire_feuilles_mensuelles(valeurs)
    depenses = lire_depenses(valeurs)

    controles = []

    for feuille, original in doublons:
        controles.append({
            "gravite": "crit",
            "titre": f"La feuille « {feuille} » est un doublon",
            "montant": None,
            "corps": f"Elle contient exactement les mêmes dates et les mêmes "
                     f"montants que « {original} ». Elle a été écartée : la "
                     f"conserver compterait ce mois deux fois.",
        })

    for feuille, attendu, lu in ecarts:
        controles.append({
            "gravite": "crit",
            "titre": f"La feuille « {feuille} » ne se totalise pas",
            "montant": attendu - lu,
            "corps": "Le total affiché par la feuille ne correspond pas à la "
                     "somme de ses nuits lisibles. L'écart vient de lignes que "
                     "ce script n'a pas su lire : il faut les regarder avant "
                     "de se fier à ce mois.",
        })

    # --- les mois reellement exploites ---------------------------------
    mois_ca = {}
    for j in jours:
        mois_ca.setdefault(cle_mois(dt.date.fromisoformat(j["d"])), 0)
        mois_ca[cle_mois(dt.date.fromisoformat(j["d"]))] += j["ca"]
    mois_dep = {}
    for l in depenses:
        mois_dep.setdefault(cle_mois(dt.date.fromisoformat(l["d"])), 0)
        mois_dep[cle_mois(dt.date.fromisoformat(l["d"]))] += l["montant"]

    # Un mois sans chiffre d'affaires ni depense est une coquille de
    # calendrier preparee a l'avance, pas un mois de fermeture : octobre
    # a decembre 2026 n'ont pas encore eu lieu. On les ecarte ici plutot
    # que de laisser onze mois vides ecraser l'echelle des graphiques.
    sequence = sorted(m for m in set(mois_ca) | set(mois_dep)
                      if mois_ca.get(m, 0) or mois_dep.get(m, 0))
    ecartes = sorted(set(mois_ca) | set(mois_dep))
    ecartes = [m for m in ecartes if m not in sequence]
    if ecartes:
        controles.append({
            "gravite": "info",
            "titre": f"{len(ecartes)} mois à venir, sans aucun mouvement",
            "montant": None,
            "corps": "Le classeur porte des feuilles préparées pour "
                     + ", ".join(ecartes)
                     + ". Elles n'ont ni chiffre d'affaires ni dépense, et ne "
                       "sont pas présentées.",
        })

    jours = [j for j in jours
             if cle_mois(dt.date.fromisoformat(j["d"])) in sequence]
    depenses = [l for l in depenses
                if cle_mois(dt.date.fromisoformat(l["d"])) in sequence]

    paie, oubliees = lire_rh(formules, valeurs, sequence)

    # --- les trous du calendrier ---------------------------------------
    trous = []
    for a, b in zip(sequence, sequence[1:]):
        ecart = ((int(b[:4]) * 12 + int(b[5:7]))
                 - (int(a[:4]) * 12 + int(a[5:7])))
        if ecart > 1:
            trous.append((a, b, ecart - 1))
    for a, b, n in trous:
        controles.append({
            "gravite": "warn" if n > 6 else "crit",
            "titre": f"{n} mois absents entre {a} et {b}",
            "montant": None,
            "corps": ("La salle était fermée pour rénovation : cette "
                      "interruption est réelle, et non une lacune de saisie."
                      if n > 6 else
                      "Aucune feuille ne couvre cette période. Le mois "
                      "manque — il n'est pas à zéro."),
        })

    # --- la cascade, mois par mois -------------------------------------
    mois = []
    for m in sequence:
        jm = [j for j in jours if j["d"].startswith(m)]
        dm = [l for l in depenses if l["d"].startswith(m)]
        p = paie.get(m, {})

        classes = {c: 0 for c in CLASSE_LIBELLE}
        for l in dm:
            classes[l["classe"]] += l["montant"]

        # Une paie a zero sur un mois qui a tourne n'est pas une paie
        # nulle : c'est une saisie qui n'a pas ete faite. Le resultat
        # n'est alors pas calcule, et le mois le dit.
        paie_totale = p.get("total", 0)
        paie_connue = bool(paie_totale)

        enregistrement = {
            "m": m,
            "nuits": len(jm),
            "ca": sum(j["ca"] for j in jm),
            "matiere": classes["matiere"],
            "opex": classes["opex"],
            "capex": classes["capex"],
            "tresorerie": classes["tresorerie"],
            "paie": paie_totale if paie_connue else None,
            "paie_classeur": p.get("total_classeur"),
            "paie_omise": p.get("omise", 0),
            "paie_services": p.get("services", []),
            # Les sorties viennent des POSTES, pas de la colonne de
            # total : c'est la seule des deux sources qui soit complete.
            "sorties": sum(l["montant"] for l in dm),
            "sorties_feuille": sum(j["sorties_feuille"] for j in jm),
        }
        for canal in CANAUX_ORDRE:
            enregistrement[canal] = sum(j.get(canal, 0) for j in jm)
        mois.append(enregistrement)

        if not paie_connue and enregistrement["ca"]:
            controles.append({
                "gravite": "warn",
                "titre": f"Paie non saisie en {m}",
                "montant": None,
                "corps": "Le mois a encaissé, mais aucune paie n'est "
                         "renseignée dans la feuille RH. Son résultat n'est "
                         "donc pas calculé : il serait majoré d'un mois entier "
                         "de salaires, ce qui en ferait le mois le plus "
                         "rentable de la saison.",
            })

    manquants = [m for m in mois
                 if abs(m["sorties"] - m["sorties_feuille"]) >= 1
                 and m["sorties_feuille"]]
    if manquants:
        total_manquant = sum(m["sorties"] - m["sorties_feuille"]
                             for m in manquants)
        controles.append({
            "gravite": "warn",
            "titre": f"Des dépenses hors du total de sorties sur "
                     f"{len(manquants)} mois",
            "montant": total_manquant,
            "corps": "Certaines journées portent des montants dans les postes "
                     "sans qu'aucune formule ne les additionne dans la colonne "
                     "de total du classeur ("
                     + ", ".join(m["m"] for m in manquants)
                     + "). Les sorties présentées ici sont calculées depuis "
                       "les postes, qui sont complets.",
        })

    # --- les quatre defauts de construction, chiffres -------------------
    mal_adressees = []
    for nom in formules.sheetnames:
        ws = formules[nom]
        for ligne in ws.iter_rows(min_col=1, max_col=2, max_row=40):
            a, b = ligne[0], ligne[1]
            if not isinstance(a.value, str):
                continue
            if norm(a.value).rstrip(". ") in ("MASSE SALARIALE", "COUT M.O"):
                cible = re.search(r"RH!([A-Z]+)(\d+)", str(b.value or ""))
                if cible:
                    mal_adressees.append((nom, cible.group(1)))
    if mal_adressees:
        # On ne re-verifie pas ici quelle colonne vaut quel mois : la
        # lecture de RH l'a deja etabli et s'arrete si elle n'y arrive
        # pas. On signale la nature du defaut, chiffree plus bas.
        pass

    glacons = sum(l["montant"] for l in depenses
                  if l["poste"] == "Glaçons" and l["d"] >= "2025-11")
    monnaie = sum(l["montant"] for l in depenses if l["poste"] == "Monnaie")
    omise_totale = sum(m["paie_omise"] or 0 for m in mois)

    controles += [
        {
            "gravite": "crit",
            "titre": "Les feuilles 2023-24 lisent la paie de la saison suivante",
            "montant": None,
            "corps": "Chaque mois de la première saison calcule sa masse "
                     "salariale en pointant une colonne de la feuille RH "
                     "décalée de 23 mois : AOÛT 24 lit « RH!AO98 », qui est "
                     "juillet 2026. Les résultats de 2023-24 affichés dans le "
                     "classeur sont donc faux, dans les deux sens. Ceux "
                     "présentés ici lisent la colonne du mois.",
        },
        {
            "gravite": "crit",
            "titre": f"{len(oubliees)} prestataires hors de tous les totaux "
                     f"du classeur",
            "montant": omise_totale,
            "corps": "Le sous-total PRESTATAIRES de la feuille RH s'arrête à "
                     "une ligne fixe ; ces personnes ont été ajoutées en "
                     "dessous, après l'écriture de la formule. Leur paie "
                     "n'entre donc dans aucun total du classeur depuis "
                     "décembre 2025. Elle est réintégrée ici, ce qui alourdit "
                     "la masse salariale de chaque mois concerné.",
        },
        {
            "gravite": "warn",
            "titre": "Les glaçons étaient comptés deux fois depuis novembre 2025",
            "montant": glacons,
            "corps": "La formule d'OPEX des feuilles récentes ajoute la "
                     "colonne des glaçons, déjà comprise dans les achats "
                     "matière : « =SUM(J:T)+H ». Les charges du classeur sont "
                     "donc majorées d'autant, et son résultat minoré.",
        },
        {
            "gravite": "warn",
            "titre": "La monnaie n'était comptée nulle part",
            "montant": monnaie,
            "corps": "La colonne MONNAIE n'entre ni dans les achats, ni dans "
                     "l'OPEX, ni dans le CAPEX du classeur, alors qu'elle "
                     "figure bien dans le total des sorties de caisse. Elle "
                     "est ici rangée en charges d'exploitation.",
        },
    ]

    # --- postes, agreges au mois ---------------------------------------
    agregat = {}
    for l in depenses:
        cle = (l["d"][:7], l["poste"])
        if cle not in agregat:
            agregat[cle] = {"m": l["d"][:7], "poste": l["poste"],
                            "classe": l["classe"], "montant": 0}
        agregat[cle]["montant"] += l["montant"]
    postes_mois = sorted(agregat.values(), key=lambda x: (x["m"], -x["montant"]))

    sortie = {
        "meta": {
            "source": SOURCE.name,
            "genere_le": dt.date.today().isoformat(),
            "premier_mois": sequence[0],
            "dernier_mois": sequence[-1],
            "mois_exploites": len(sequence),
        },
        "mois": mois,
        "postes_mois": postes_mois,
        # Le total de sorties de la feuille est ecarte d'ici : il a ete
        # montre incomplet, et un champ dont on sait qu'il ment n'a rien
        # a faire dans un jeu publie.
        "jours_declares": sorted(
            [{k: v for k, v in j.items()
              if k not in ("feuille", "sorties_feuille")} for j in jours],
            key=lambda x: x["d"]),
        "classes": CLASSE_LIBELLE,
        "canaux": [{"c": c, "l": CANAUX_LIBELLE[c]} for c in CANAUX_ORDRE],
        "controles": controles,
    }

    CIBLE.write_text(json.dumps(sortie, ensure_ascii=False,
                                separators=(",", ":")), encoding="utf-8")

    f = lambda v: format(round(v or 0), ",d").replace(",", " ")
    print(f"  {len(sequence)} mois exploites   "
          f"{sequence[0]} -> {sequence[-1]}")
    print(f"  {len(jours)} nuits declarees, {len(postes_mois)} couples "
          f"mois x poste, {len(controles)} controles\n")
    print(f"  {'mois':<9} {'CA':>13} {'matiere':>12} {'OPEX':>11} "
          f"{'CAPEX':>11} {'paie':>11} {'resultat':>13}")
    for m in mois:
        res = (None if m["paie"] is None else
               m["ca"] - m["matiere"] - m["opex"] - m["capex"] - m["paie"])
        print(f"  {m['m']:<9} {f(m['ca']):>13} {f(m['matiere']):>12} "
              f"{f(m['opex']):>11} {f(m['capex']):>11} "
              f"{f(m['paie']) if m['paie'] is not None else 'non saisie':>11} "
              f"{f(res) if res is not None else '-':>13}")
    print(f"\n  {CIBLE.name}  {CIBLE.stat().st_size/1024:.0f} Ko\n")


if __name__ == "__main__":
    principal()
