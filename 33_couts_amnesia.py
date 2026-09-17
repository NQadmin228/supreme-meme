#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AMNESIA — Couts de revient importes du referentiel de TABOO.

  python 33_couts_amnesia.py  ->  data_couts_amnesia.json

D'OU VIENNENT CES COUTS
-----------------------
Les exports Infogest d'AMNESIA ne portent aucun prix d'achat, et le
classeur de suivi mensuel ne donne les achats qu'au MOIS et au POSTE :
il dit combien de boissons ont ete achetees en juillet, jamais ce que
coute une bouteille.

La direction indique que les deux etablissements achetent les memes
produits aux memes conditions. Ce script applique donc les couts
unitaires du referentiel de TABOO aux articles qu'AMNESIA vend sous le
meme nom.

POURQUOI LE FICHIER SOURCE ET NON data_v2.json
----------------------------------------------
La premiere version lisait `couts_articles` de data_v2.json : 78
articles, et une couverture de 46 % du chiffre d'affaires d'AMNESIA.

Or ces 78 ne sont pas le referentiel : ce sont les produits costes que
TABOO VEND LUI-MEME. Le referentiel en compte 158, et les gros absents
d'AMNESIA y figuraient depuis le debut -- Moet, Martell, Chivas,
Glenfiddich, Laurent-Perrier, et jusqu'a la chicha LOVE 69 qui pese a
elle seule plus de huit millions. Lire la source plutot que le produit
fini fait passer la couverture de 46 % a 73 %, sans aucune regle
supplementaire.

LES TROIS REGLES D'APPARIEMENT, ET CE QUE CHACUNE RAPPORTE
----------------------------------------------------------
    exact                95 articles    73,5 % du CA
    variante par defaut   3 articles    88,4 %  (+15 points)
    prefixe unique        4 articles    89,0 %

« Variante par defaut » ne rapproche que trois produits, et rapporte
quinze points : un champagne nomme sans qualificatif est son brut.
« MOET & CHANDON » chez AMNESIA, « MOET & CHANDON BRUT » au referentiel.
C'est une convention du metier, pas une ressemblance de chaines, et la
regle ne s'applique que si UN SEUL candidat porte le qualificatif par
defaut.

« Prefixe unique » rapproche un nom au seul produit coste qui le
prolonge : MOUTON CADET vers MOUTON CADET (BORDEAUX), CHICKEN WINGS vers
CHICKEN WINGS X6. S'il y a deux prolongements, la regle se tait.

LE GARDE-FOU QUI A RATTRAPE UNE FAUTE
-------------------------------------
Un appariement se VERIFIE : si le prix pratique par AMNESIA s'ecarte
trop de celui que TABOO affiche pour le meme produit, ce n'est pas le
meme produit.

Ce controle a rattrape une faute qui allait etre publiee. La
normalisation retirait le suffixe « BTL », le prenant pour du bruit. Or
c'est l'unite de vente : AMNESIA vend « HENNESSY VS BTL » a 56 548 F et
« HENNESSY VS » a 5 000 F -- une bouteille et un verre. Les deux
recevaient le cout de la bouteille, 31 700 F, et le verre affichait une
marge de moins 26 700 F l'unite.

Sept appariements de cette sorte sont ecartes, pour 775 000 F de chiffre
d'affaires. Ils rejoignent les articles sans cout plutot que d'en
recevoir un faux : une marge absente se voit, une marge fausse non.

CE QUE CE SCRIPT NE FAIT PAS
----------------------------
Il n'extrapole rien. Le taux de marge des articles costes n'est jamais
applique aux autres. Il ne rapproche pas non plus par ressemblance :
faire entrer un cout de Martell dans la marge d'un Hennessy passerait
inapercu, et aucune regle ici ne le permet.
"""

import collections
import csv
import datetime as dt
import io
import json
import re
import sys
import unicodedata
from pathlib import Path

BASE = Path(__file__).resolve().parent
REFERENTIEL = Path(r"C:\Users\user\Downloads\couts_de_revient.csv")
SOURCE_AMNESIA = BASE / "data_amnesia.json"
CIBLE = BASE / "data_couts_amnesia.json"

# Le prix constate est NET de remise, donc toujours inferieur au tarif.
# On ne s'inquiete que des ecarts larges : en dessous de 0,45 on ne
# regarde plus le meme produit, au-dessus de 1,6 non plus.
PRIX_MIN, PRIX_MAX = 0.45, 1.6

# Le qualificatif qui designe la declinaison par defaut d'un produit.
QUALIFICATIF_DEFAUT = {"BRUT"}

# Nombre de verres tires d'une bouteille de spiritueux.
#
# Ce nombre est DONNE par la direction, il n'est releve nulle part : ni
# le referentiel ni le classeur ne le portent. Il n'est pas non plus
# devine -- le deduire du rapport des prix aurait produit une marge
# d'apparence credible sans qu'aucune mesure ne la soutienne.
#
# Mais il se VERIFIE. Si une maison tire douze verres d'une bouteille,
# elle vend le verre autour du douzieme du prix de la bouteille, et le
# controle de prix le constate tout seul : les sept articles concernes
# tombent entre 0,86 et 1,05 fois le douzieme du tarif bouteille. Le
# chiffre est donc corrobore par une donnee qui ne vient pas de lui.
#
# Le changer ici suffit : la page affiche la valeur employee et les
# marges se recalculent.
VERRES_PAR_BOUTEILLE = 12

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def sans_accents(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def base_nom(s):
    """Forme comparable d'un nom d'article.

    Le meme produit ne s'ecrit pas pareil dans les deux caisses :
    « JAGERMEISTER » contre « JÄGERMEISTER », « BAILEYS » contre
    « BAILEY'S », « MOET & CHANDON (ICE) » contre « MOËT & CHANDON ICE ».

    Le suffixe « BTL » est retire ici, mais il n'est PAS du bruit : il
    distingue une bouteille d'un verre. Le retirer ne sert qu'a proposer
    un candidat ; c'est le controle de prix qui tranche ensuite.
    """
    s = sans_accents(s).upper().replace("&", " ET ")
    s = s.replace("'", "").replace("\u2019", "").replace("-", " ")
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"\b(BTL|BOUTEILLE|BLLE|CL|ML)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def num(x):
    try:
        return float(str(x).replace("\u202f", "").replace("\xa0", "")
                     .replace(" ", "").replace(",", "."))
    except (TypeError, ValueError):
        return None


def principal():
    if not REFERENTIEL.exists():
        raise SystemExit(f"Referentiel de couts introuvable :\n  {REFERENTIEL}")
    if not SOURCE_AMNESIA.exists():
        raise SystemExit("data_amnesia.json absent. Lancer d'abord "
                         "30_extraction_amnesia.py")

    lignes = list(csv.DictReader(io.open(REFERENTIEL, encoding="utf-8"),
                                 delimiter=";"))
    couts = {}
    for x in lignes:
        cle = base_nom(x["produit"])
        if cle and cle not in couts and num(x.get("cout_revient")):
            couts[cle] = x

    amnesia = json.loads(SOURCE_AMNESIA.read_text(encoding="utf-8"))
    vendus = collections.defaultdict(
        lambda: {"q": 0, "qo": 0, "net": 0.0, "brut": 0.0, "remise": 0.0})
    for r in amnesia["detail_jour"]:
        e = vendus[(r["type"], r["categorie"], r["produit"])]
        e["q"] += r.get("qte_vendue", 0)
        e["qo"] += r.get("qte_offerte", 0)
        e["net"] += r.get("net", 0)
        e["brut"] += r.get("brut", 0)
        e["remise"] += r.get("remise", 0)
    ca_total = sum(v["net"] for v in vendus.values())

    def candidats(nom):
        """Les appariements possibles, du plus sur au moins sur."""
        k = base_nom(nom)
        if k in couts:
            yield couts[k], "nom identique"
        plus_longs = [c for c in couts if c.startswith(k + " ")]
        defaut = [c for c in plus_longs if c[len(k) + 1:] in QUALIFICATIF_DEFAUT]
        if len(defaut) == 1:
            yield couts[defaut[0]], "variante par défaut"
        elif len(plus_longs) == 1:
            yield couts[plus_longs[0]], "préfixe unique"

    articles, rejetes, absents = [], [], []
    for (t, c, a), v in vendus.items():
        retenu = rejet = None
        for cout, regle in candidats(a):
            pv = num(cout.get("prix_vente"))
            rapport = ((v["net"] / v["q"]) / pv) if (pv and v["q"]) else None
            if rapport is None or PRIX_MIN <= rapport <= PRIX_MAX:
                retenu = (cout, regle, rapport, 1)
                break

            # Le prix dit que ce n'est pas la meme unite de vente. Avant
            # d'ecarter, on essaie la seule autre unite que la maison
            # pratique : le verre. Si le prix constate colle alors au
            # douzieme du tarif bouteille, c'est bien un verre -- et le
            # cout se divise de la meme facon.
            rapport_verre = rapport * VERRES_PAR_BOUTEILLE
            if PRIX_MIN <= rapport_verre <= PRIX_MAX:
                retenu = (cout, "vendu au verre", rapport_verre,
                          VERRES_PAR_BOUTEILLE)
                break

            rejet = rejet or (cout, regle, rapport, pv)

        if retenu is None:
            base = {"t": t, "c": c, "a": a, "q": v["q"], "net": v["net"]}
            if rejet:
                cout, regle, rapport, pv = rejet
                base.update({"motif": "prix incohérent",
                             "correspondance": cout["produit"],
                             "pv_amnesia": v["net"] / v["q"] if v["q"] else 0,
                             "pv_taboo": pv})
                rejetes.append(base)
            else:
                base["motif"] = "aucun coût au référentiel"
                absents.append(base)
            continue

        cout, regle, rapport, parts = retenu
        cr = num(cout["cout_revient"]) / parts
        articles.append({
            "t": t, "c": c, "a": a,
            "q": v["q"], "qo": v["qo"],
            "net": v["net"], "brut": v["brut"], "remise": v["remise"],
            "cr": round(cr, 2),
            "ct": round(cr * v["q"], 2),        # cout des articles VENDUS
            "co": round(cr * v["qo"], 2),       # cout des articles OFFERTS
            "pv_taboo": num(cout.get("prix_vente")) / parts,
            "parts": parts,
            "src": cout.get("type_source", ""),
            "statut": cout.get("statut_cout", ""),
            "regle": regle,
            "correspondance": cout["produit"],
            "rapport_prix": round(rapport, 3) if rapport is not None else None,
        })

    articles.sort(key=lambda x: -x["net"])
    for liste in (rejetes, absents):
        liste.sort(key=lambda x: -x["net"])

    ca_couvert = sum(x["net"] for x in articles)

    # Combien de prix faut-il obtenir pour atteindre quelle couverture ?
    # C'est la seule question qui compte une fois le trou constate, et
    # elle se repond en additionnant les manquants du plus gros au plus
    # petit.
    seuils, cumul, restants = [], ca_couvert, list(absents)
    for cible in (0.92, 0.95, 0.97, 0.99):
        n, c = 0, cumul
        for x in restants:
            if c / ca_total >= cible:
                break
            c += x["net"]
            n += 1
        if c / ca_total >= cible:
            seuils.append({"cible": cible, "n": n})
    for i, x in enumerate(absents):
        cumul += x["net"]
        x["cumul"] = cumul / ca_total if ca_total else 0
    par_regle = collections.Counter(x["regle"] for x in articles)
    ca_regle = collections.defaultdict(float)
    for x in articles:
        ca_regle[x["regle"]] += x["net"]

    sortie = {
        "meta": {
            "genere_le": dt.date.today().isoformat(),
            "source_couts": "TABOO — référentiel de coûts de revient",
            "produits_referentiel": len(couts),
            "articles_amnesia": len(vendus),
            "apparies": len(articles),
            "ca_couvert": ca_couvert,
            "ca_total": ca_total,
            # Le seul taux stocke de toute la chaine, parce qu'il
            # conditionne la lecture de la page entiere et doit etre
            # lisible avant elle.
            "couverture": ca_couvert / ca_total if ca_total else 0,
            "cout_vendu": sum(x["ct"] for x in articles),
            "cout_offert": sum(x["co"] for x in articles),
            "regles": [{"regle": r, "n": par_regle[r], "ca": ca_regle[r]}
                       for r in ("nom identique", "variante par défaut",
                                 "préfixe unique", "vendu au verre")
                       if par_regle[r]],
            "verres_par_bouteille": VERRES_PAR_BOUTEILLE,
            "rejetes": len(rejetes),
            "ca_rejete": sum(x["net"] for x in rejetes),
            "sans_cout": len(absents),
            "ca_sans_cout": sum(x["net"] for x in absents),
        },
        "articles": articles,
        "rejetes": rejetes,
        # Tous les manquants, pas seulement les plus gros : la page en
        # fait une liste de demande, et une liste tronquee ferait croire
        # que le reste n'existe pas. Le cumul dit ou s'arreter.
        "non_apparies": absents,
        "seuils": seuils,
    }

    CIBLE.write_text(json.dumps(sortie, ensure_ascii=False,
                                separators=(",", ":")), encoding="utf-8")

    f = lambda v: format(round(v or 0), ",d").replace(",", " ")
    m = sortie["meta"]
    print()
    print(f"  referentiel de TABOO      {m['produits_referentiel']:>4} produits costes")
    print(f"  articles vendus AMNESIA   {m['articles_amnesia']:>4}")
    print()
    cumul = 0.0
    print(f"  {'regle':<22} {'articles':>9} {'CA apporte':>15} {'couverture':>12}")
    for r in m["regles"]:
        cumul += r["ca"]
        print(f"  {r['regle']:<22} {r['n']:>9} {f(r['ca']):>15} "
              f"{100 * cumul / ca_total:>11.1f} %")
    print()
    print(f"  ecartes par le controle de prix   {m['rejetes']:>4} articles, "
          f"{f(m['ca_rejete'])} F")
    print(f"  sans cout au referentiel          {m['sans_cout']:>4} articles, "
          f"{f(m['ca_sans_cout'])} F")
    print()
    marge = ca_couvert - m["cout_vendu"]
    print(f"  CA couvert     {f(ca_couvert):>14} F   soit {100 * m['couverture']:.1f} %")
    print(f"  marge          {f(marge):>14} F   soit {100 * marge / ca_couvert:.1f} %")
    print(f"  cout des OFFERTS {f(m['cout_offert']):>12} F")
    print()
    print(f"  {CIBLE.name}  {CIBLE.stat().st_size / 1024:.0f} Ko")
    print()


if __name__ == "__main__":
    principal()
