#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AMNESIA — Decoupe les donnees en un socle + des morceaux a la demande.

  python 30_extraction_amnesia.py   ->  data_amnesia.json
  python 31_decouper_amnesia.py     ->  taboo-vercel/donnees/amnesia/*.json

MEME PRINCIPE QUE TABOO, MEME RAISON
------------------------------------
Envoyer l'ensemble a chaque visite ferait payer a la page d'accueil le
detail ligne a ligne de 4 611 ventes et 4 791 offerts, que le lecteur
n'ouvrira peut-etre jamais. Le socle porte ce que la synthese affiche ;
le reste arrive quand une page en a besoin.

L'ecart est moins spectaculaire que chez TABOO -- ce jeu est dix fois
plus petit -- mais la mecanique de chargement est deja ecrite et
partagee. Ne pas s'en servir demanderait plus de travail que s'en
servir.

POURQUOI UN FICHIER SEPARE DE 22_decouper.py
--------------------------------------------
Les deux etablissements n'ont pas le meme modele : TABOO a des couts et
une cascade jusqu'au resultat, AMNESIA n'a que du chiffre d'affaires.
Un decoupeur unique parametre devrait porter les deux formes et
choisirait par des `if etablissement ==`, ce qui est la forme deguisee
de deux fichiers -- avec en prime le risque qu'une correction sur l'un
casse l'autre.
"""

import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
SOURCE = BASE / "data_amnesia.json"
CIBLE = BASE / "taboo-vercel" / "donnees" / "amnesia"

# Jeux sortis du socle : volumineux, et chacun ne sert qu'une ou deux
# pages. Les cles absentes de cette liste restent dans le socle.
MORCEAUX = [
    "offerts_jour",     # 4 791 lignes : la page « Articles offerts »
    "detail_jour",      # 4 611 lignes : l'exploration categorie -> produit
]

if not SOURCE.exists():
    raise SystemExit(f"{SOURCE.name} absent. Lancer d'abord :\n"
                     f"  python 30_extraction_amnesia.py")

donnees = json.loads(SOURCE.read_text(encoding="utf-8"))

# --- Le suivi mensuel, s'il a ete extrait ----------------------------
# Deux sources, deux scripts, un seul socle : le POS dit ce que la
# caisse a enregistre, le classeur dit ce que l'exploitation a declare
# encaisse et depense. Les pages « Compte de resultat », « Depenses » et
# « Rapprochement » n'existent que si ce fichier est la.
#
# Il reste dans le socle plutot que de partir en morceau charge a la
# demande : 71 Ko face aux 1,5 Mo des deux jeux differes, et il sert
# trois pages sur dix. Le sortir ferait attendre un ecran de chargement
# pour moins que ce que coute la banniere qui l'annonce.
MENSUEL = BASE / "data_mensuel_amnesia.json"
if MENSUEL.exists():
    donnees["mensuel"] = json.loads(MENSUEL.read_text(encoding="utf-8"))
    print()
    print(f"  suivi mensuel joint au socle : "
          f"{len(donnees['mensuel']['mois'])} mois, "
          f"{len(donnees['mensuel']['controles'])} controles")
else:
    print()
    print(f"  ATTENTION : {MENSUEL.name} absent.")
    print("  Les pages Compte de resultat, Depenses et Rapprochement")
    print("  n'auront rien a afficher. Lancer d'abord :")
    print("      python 32_extraction_mensuel_amnesia.py")

CIBLE.mkdir(parents=True, exist_ok=True)
for ancien in CIBLE.glob("*.json"):
    ancien.unlink()

ecrits = []


def ecrire(nom, contenu):
    chemin = CIBLE / f"{nom}.json"
    chemin.write_text(json.dumps(contenu, ensure_ascii=False,
                                 separators=(",", ":")), encoding="utf-8")
    ecrits.append((nom, chemin.stat().st_size))


for nom in MORCEAUX:
    if nom in donnees:
        ecrire(nom, donnees.pop(nom))

# Ce qui reste EST le socle. On le construit par soustraction plutot que
# par enumeration : ajouter un champ a l'extraction le fait arriver dans
# le socle sans qu'on ait a y penser, et c'est le bon defaut -- un champ
# oublie s'y verra, alors qu'un champ jamais charge ne se verrait pas.
ecrire("socle", donnees)

socle = next(t for n, t in ecrits if n == "socle")
total = sum(t for _, t in ecrits)

print(f"\n  {CIBLE.relative_to(BASE)}\n")
for nom, taille in sorted(ecrits, key=lambda x: -x[1]):
    marque = "  <- charge au demarrage" if nom == "socle" else ""
    print(f"    {nom + '.json':<22} {taille/1024:>8.0f} Ko{marque}")

print(f"\n  premier affichage      {socle/1024:>8.0f} Ko")
print(f"  si tout etait charge   {total/1024:>8.0f} Ko"
      f"   soit {total/socle:.1f} fois plus\n")
