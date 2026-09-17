#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AMNESIA — Couts de revient importes du catalogue de TABOO.

  python 33_couts_amnesia.py  ->  data_couts_amnesia.json

D'OU VIENNENT CES COUTS, ET POURQUOI C'EST LEGITIME
---------------------------------------------------
Les exports Infogest d'AMNESIA ne portent aucun prix d'achat. Le
classeur de suivi mensuel donne les achats matiere, mais au MOIS et au
POSTE : il dit combien de boissons ont ete achetees en juillet, jamais
combien coute une bouteille de Hennessy.

La direction indique que les deux etablissements achetent les memes
produits aux memes conditions. Ce script applique donc les couts
unitaires releves chez TABOO aux articles qu'AMNESIA vend sous le meme
nom. Ce n'est pas une estimation : c'est une mesure faite ailleurs,
transportee, et le tableau de bord le dit a chaque page.

CE QUE LA MESURE CONFIRME
-------------------------
Les listes de prix des deux maisons coincident. Sur les articles peu
remises -- sodas, bieres, chichas -- le prix moyen constate chez AMNESIA
vaut exactement celui affiche chez TABOO. L'ecart n'apparait que sur les
bouteilles, ou il mesure la remise accordee, pas un tarif different.
Si les prix de vente sont les memes, les couts d'achat le sont
vraisemblablement aussi.

LE PLAFOND, ET IL EST BAS
-------------------------
TABOO ne connait le cout que de 78 de ses 274 articles. Ce n'est pas un
probleme d'ecriture des noms : MOET, LAURENT-PERRIER, MARTELL, JACK
DANIEL'S, CHIVAS, GLENFIDDICH sont bien au catalogue de TABOO, sans
cout. Le recouvrement bute donc sur ce que TABOO sait de lui-meme, et
non sur l'appariement.

Resultat : la marge par produit d'AMNESIA se calcule sur un peu moins de
la moitie de son chiffre d'affaires. Ce taux est publie au meme endroit
que la marge, en tuile, et non en note de bas de page -- une marge
calculee sur 46 % du chiffre lue comme la marge de l'etablissement
serait pire que pas de marge du tout.

CE QUE CE SCRIPT NE FAIT PAS
----------------------------
Il n'extrapole rien. Le taux de marge des articles costes n'est jamais
applique aux autres : rien ne dit que les champagnes sans cout ont la
meme marge que les bieres avec. La marge reelle de l'etablissement
existe deja et se mesure autrement -- achats matiere du classeur contre
chiffre d'affaires, sur 100 % du perimetre. Le tableau de bord confronte
les deux.
"""

import collections
import datetime as dt
import json
import re
import sys
import unicodedata
from pathlib import Path

BASE = Path(__file__).resolve().parent
SOURCE_TABOO = BASE / "data_v2.json"
SOURCE_AMNESIA = BASE / "data_amnesia.json"
CIBLE = BASE / "data_couts_amnesia.json"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def sans_accents(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def base_nom(s):
    """Forme comparable d'un nom d'article.

    Le meme produit ne s'ecrit pas pareil dans les deux caisses :
    « HENNESSY VS » chez l'un, « HENNESSY VS BTL » chez l'autre ;
    « JAGERMEISTER » contre « JÄGERMEISTER ». On normalise donc les
    accents, les esperluettes et les apostrophes, et on retire les
    suffixes de CONDITIONNEMENT -- ils disent comment le produit est
    servi, pas quel produit c'est.

    Aucune regle ici ne rapproche deux produits differents : ce sont des
    variantes d'ecriture d'un meme nom, jamais des ressemblances. Un
    appariement approximatif ferait entrer un cout de Martell dans la
    marge d'un Hennessy sans que personne ne s'en apercoive.
    """
    s = sans_accents(s).upper()
    s = s.replace("&", " ET ").replace("'", " ").replace("-", " ")
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"\b(BTL|BOUTEILLE|BLLE|CL|ML)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def principal():
    for f in (SOURCE_TABOO, SOURCE_AMNESIA):
        if not f.exists():
            raise SystemExit(f"{f.name} absent. Lancer d'abord les extractions.")

    taboo = json.loads(SOURCE_TABOO.read_text(encoding="utf-8"))
    amnesia = json.loads(SOURCE_AMNESIA.read_text(encoding="utf-8"))

    # --- le catalogue coste de TABOO -----------------------------------
    couts = {}
    for c in taboo["couts_articles"]:
        cle = base_nom(c["a"])
        if cle and cle not in couts and c.get("cr"):
            couts[cle] = c

    # --- ce qu'AMNESIA vend --------------------------------------------
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

    articles, absents = [], []
    for (t, c, a), v in vendus.items():
        cout = couts.get(base_nom(a))
        if cout is None:
            absents.append({"t": t, "c": c, "a": a, "q": v["q"], "net": v["net"]})
            continue
        cr = cout["cr"]
        articles.append({
            "t": t, "c": c, "a": a,
            "q": v["q"], "qo": v["qo"],
            "net": v["net"], "brut": v["brut"], "remise": v["remise"],
            "cr": cr,                          # cout unitaire, releve chez TABOO
            "ct": cr * v["q"],                 # cout des articles VENDUS
            "co": cr * v["qo"],                # cout des articles OFFERTS
            "mg": v["net"] - cr * v["q"],      # marge sur les ventes
            "pv_taboo": cout.get("pv"),
            "src": cout.get("src", ""),
            "correspondance": cout["a"],       # le nom cote TABOO, pour verifier
        })

    articles.sort(key=lambda x: -x["net"])
    absents.sort(key=lambda x: -x["net"])

    ca_couvert = sum(x["net"] for x in articles)
    cout_vendu = sum(x["ct"] for x in articles)
    cout_offert = sum(x["co"] for x in articles)

    sortie = {
        "meta": {
            "genere_le": dt.date.today().isoformat(),
            "source_couts": "TABOO — catalogue de couts de revient",
            "articles_costes_taboo": len(couts),
            "articles_catalogue_taboo": len({a["a"] for a in taboo["articles"]}),
            "articles_amnesia": len(vendus),
            "apparies": len(articles),
            "ca_couvert": ca_couvert,
            "ca_total": ca_total,
            # Aucun taux stocke ailleurs dans la chaine ; celui-ci est le
            # seul, parce qu'il conditionne la lecture de toute la page et
            # doit etre lisible avant elle.
            "couverture": ca_couvert / ca_total if ca_total else 0,
            "cout_vendu": cout_vendu,
            "cout_offert": cout_offert,
        },
        "articles": articles,
        "non_apparies": absents[:60],
        "non_apparies_total": len(absents),
        "non_apparies_ca": sum(x["net"] for x in absents),
    }

    CIBLE.write_text(json.dumps(sortie, ensure_ascii=False,
                                separators=(",", ":")), encoding="utf-8")

    f = lambda v: format(round(v or 0), ",d").replace(",", " ")
    m = sortie["meta"]
    print()
    print(f"  couts disponibles chez TABOO   {m['articles_costes_taboo']:>4} "
          f"articles sur {m['articles_catalogue_taboo']} au catalogue")
    print(f"  articles vendus par AMNESIA    {m['articles_amnesia']:>4}")
    print(f"  apparies                       {m['apparies']:>4}")
    print()
    print(f"  CA couvert       {f(ca_couvert):>14} F")
    print(f"  CA total         {f(ca_total):>14} F")
    print(f"  couverture       {100 * m['couverture']:>13.1f} %")
    print()
    print(f"  cout des articles vendus   {f(cout_vendu):>14} F")
    print(f"  marge sur le perimetre     {f(ca_couvert - cout_vendu):>14} F"
          f"   soit {100 * (ca_couvert - cout_vendu) / ca_couvert:.1f} %")
    print(f"  cout des articles OFFERTS  {f(cout_offert):>14} F"
          f"   sorti sans contrepartie")
    print()
    print(f"  {CIBLE.name}  {CIBLE.stat().st_size / 1024:.0f} Ko")
    print()


if __name__ == "__main__":
    principal()
