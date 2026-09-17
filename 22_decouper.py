#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TABOO — Decoupe les donnees en un socle + des morceaux charges a la demande.

LE PROBLEME
-----------
Le tableau de bord autonome fait 5,9 Mo parce que TOUT y est embarque,
y compris les donnees de pages que le lecteur n'ouvrira peut-etre
jamais. Mesure sur ce jeu :

    ventes_categorie_jour  1 853 Ko   page Ventes seule
    horaire_jour           1 817 Ko   page Profil de la nuit seule
    articles_mois            586 Ko   page Explorer seule
    offerts_jour             484 Ko   page Remises & offerts seule
    depenses_jour            443 Ko   page Depenses seule
    ----------------------------------------------------------------
    90 % du poids sert UNE page chacun.

LA SOLUTION
-----------
Un socle, charge au demarrage, et un fichier par jeu lourd, charge la
premiere fois qu'une page en a besoin. Le socle reste petit parce que
les deux chiffres dont la Synthese avait besoin dans les gros jeux --
la part de la nuit et la valeur des offerts -- y sont PRE-AGREGES au
grain jour. C'est exactement le principe de la couche semantique : on
agrege au grain que la page consomme, pas plus fin.

Resultat attendu : environ 850 Ko au premier affichage au lieu de 5,9 Mo.

Les fichiers produits sont servis derriere le meme controle d'acces que
le reste : le middleware couvre /donnees/ comme il couvre /index.html.
"""

import io
import json
import shutil
from pathlib import Path

BASE = Path(__file__).resolve().parent
SOURCE = BASE / "data_v2.json"
CIBLE = BASE / "taboo-vercel" / "donnees" / "taboo"

# Jeux sortis du socle : lourds, et chacun ne sert qu'une ou deux pages.
MORCEAUX = [
    "ventes_categorie_jour",
    "horaire_jour",
    "articles_mois",
    "offerts_jour",
    "depenses_jour",
]


def ecrire(chemin: Path, obj) -> int:
    charge = json.dumps(obj, ensure_ascii=False, separators=(",", ":"),
                        allow_nan=False)
    chemin.write_text(charge, encoding="utf-8")
    return len(charge.encode())


def main() -> int:
    D = json.loads(SOURCE.read_text(encoding="utf-8"))

    if CIBLE.exists():
        shutil.rmtree(CIBLE)
    CIBLE.mkdir(parents=True)

    # -----------------------------------------------------------------
    # Pre-agregats : ce que la Synthese lisait dans les gros jeux
    # -----------------------------------------------------------------
    # Part du CA realisee entre 22h et 6h, au grain jour. La Synthese
    # calculait ce taux en parcourant horaire_jour (1,8 Mo) ; deux
    # colonnes par jour suffisent, et le taux reste juste sous n'importe
    # quel filtre puisqu'on somme deux mesures additives.
    nuit = {}
    for r in D.get("horaire_jour", []):
        j = nuit.setdefault(r["d"], {"d": r["d"], "cnn": 0, "cnt": 0})
        cn = r.get("cn") or 0
        j["cnt"] += cn
        if r.get("h", 0) >= 22 or r.get("h", 0) < 6:
            j["cnn"] += cn
    nuit_jour = sorted(nuit.values(), key=lambda x: x["d"])

    # Valeur et quantite offertes, au grain jour. Meme raison :
    # offerts_jour pese 484 Ko pour un total que la Synthese affiche.
    off = {}
    for r in D.get("offerts_jour", []):
        j = off.setdefault(r["d"], {"d": r["d"], "q": 0, "v": 0})
        j["q"] += r.get("q") or 0
        j["v"] += r.get("v") or 0
    offerts_total_jour = sorted(off.values(), key=lambda x: x["d"])

    # Volumetrie : la page Qualite affichait le nombre de lignes de
    # chaque jeu, ce qui l'obligeait a les charger tous.
    volumetrie = {k: (len(v) if isinstance(v, list) else 1)
                  for k, v in D.items()}

    # -----------------------------------------------------------------
    # Socle
    # -----------------------------------------------------------------
    socle = {k: v for k, v in D.items() if k not in MORCEAUX}
    socle["nuit_jour"] = nuit_jour
    socle["offerts_total_jour"] = offerts_total_jour
    socle["volumetrie"] = volumetrie
    socle["morceaux"] = MORCEAUX

    poids_socle = ecrire(CIBLE / "socle.json", socle)

    print(f"  {'socle.json':<30}{poids_socle/1024:>8.0f} Ko")
    print(f"       dont nuit_jour          {len(nuit_jour):>6,} lignes")
    print(f"       dont offerts_total_jour {len(offerts_total_jour):>6,} lignes")
    print()

    total_morceaux = 0
    for m in MORCEAUX:
        p = ecrire(CIBLE / f"{m}.json", D.get(m, []))
        total_morceaux += p
        print(f"  {m + '.json':<30}{p/1024:>8.0f} Ko   "
              f"{len(D.get(m, [])):>7,} lignes")

    print()
    print(f"  premier affichage : {poids_socle/1024:.0f} Ko "
          f"au lieu de {(poids_socle + total_morceaux)/1024:.0f} Ko")
    print(f"  soit {(poids_socle + total_morceaux)/poids_socle:.1f} fois moins")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
