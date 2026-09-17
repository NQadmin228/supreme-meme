#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AMNESIA — Extraction depuis les exports Infogest.

  python 30_extraction_amnesia.py [dossier_des_csv]
      -> data_amnesia.json

CE QUI DIFFERE DE TABOO
-----------------------
TABOO extrait de BigQuery, ou le modele est connu et stable. Ici la
source est un jeu de CSV produits par un logiciel de caisse, exportes a
la main, a des minutes differentes, et dont les en-tetes se contredisent
d'un fichier a l'autre. L'essentiel du travail de ce fichier n'est pas
l'agregation : c'est de decider QUELLE source fait foi, et de le dire.

IL N'Y A AUCUN COUT D'ACHAT
---------------------------
La colonne `Cout` vaut 0 sur les 4 611 lignes de la balance, et
`Val Achat` vaut 0 sur les 4 791 lignes des offerts. Aucune marge,
aucun cout matiere, aucun resultat n'est donc calculable -- c'est
pourtant la colonne vertebrale du tableau de bord de TABOO.

Ce fichier ne comble pas ce trou par une estimation. Un coefficient
invente produirait une marge d'apparence credible que personne ne
pourrait contredire, et elle finirait dans une decision. On produit
donc du chiffre d'affaires, et le champ `couts_disponibles` dit
explicitement non. Le jour ou un export d'achats existe, il se branche
ici et les pages de marge s'allument.

LES TROIS « REMISES » QUI NE CONCORDENT PAS
-------------------------------------------
Le Journal du CAF, la Balance par categorie et le Resume global
annoncent trois totaux de remise differents, dans un rapport de un a
dix. Ce ne sont pas les memes notions, et rien dans les exports ne dit
lesquelles.

On retient celle du Journal du CAF pour la serie journaliere, parce que
c'est la seule dont le total boucle au franc pres sur le resume global
du logiciel lui-meme : HT moins remise egale le TTC annonce.

Les trois montants sont calcules a l'execution et exposes dans
`controles`, jamais masques -- et jamais ecrits ici : ce depot est
public, le tableau de bord ne l'est pas.

LES DEUX CONVENTIONS HT/TTC OPPOSEES
------------------------------------
    Balance par categorie :  TTC - Remise = Total HT
    Journal du CAF        :  HT  - Remise = TTC

Le brut s'appelle TTC dans l'un et HT dans l'autre. Ces noms sont donc
abandonnes des la lecture, au profit de `brut` et `net`, qui ne
mentent pas. Ne jamais reintroduire « HT » ou « TTC » dans le modele :
ce pays n'applique pas de TVA sur ces tickets, les deux colonnes sont
egales dans le resume, et le nom ne designe que le moment ou la remise
s'applique.
"""

import csv
import io
import json
import re
import sys
import unicodedata

# La console Windows parle cp1252, et l'un des fichiers exportes porte un
# caractere de remplacement dans son nom (« ? Balance par reglement »).
# Sans cette ligne, le script meurt en AFFICHANT le nom du fichier qu'il
# vient de lire correctement -- une panne a l'impression, pas a la
# lecture, et le message d'erreur ne le dit pas.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from collections import defaultdict
from datetime import datetime, date
from pathlib import Path

BASE = Path(__file__).resolve().parent
DEFAUT = Path(r"C:\Users\user\Downloads\wetransfer_document-infogest_2026-09-15_1257")
SORTIE = BASE / "data_amnesia.json"


# ---------------------------------------------------------------- lecture

def _sans_accents(s):
    """Les en-tetes portent des accents, et l'export les encode de deux
    facons selon le fichier. On compare sur une forme depouillee plutot
    que d'ecrire « Qté » et d'esperer."""
    s = unicodedata.normalize("NFKD", str(s or ""))
    return "".join(c for c in s if not unicodedata.combining(c)).strip().lower()


def lire(dossier, motif):
    """Retrouve un fichier par un fragment de son nom.

    Les noms portent l'heure d'export (« 131811 92026 »), qui change a
    chaque envoi. Les figer rendrait ce script inutilisable au prochain
    lot ; on cherche donc sur la partie stable du nom."""
    cible = _sans_accents(motif)
    trouves = [p for p in sorted(dossier.glob("*.csv"))
               if cible in _sans_accents(p.name)]
    if not trouves:
        raise SystemExit(f"Aucun CSV ne correspond a « {motif} » dans {dossier}")
    if len(trouves) > 1:
        # Deux exports du meme rapport : on prend le plus recent et on le
        # dit, plutot que d'en choisir un au hasard de l'ordre du disque.
        trouves.sort(key=lambda p: p.stat().st_mtime)
        print(f"  ATTENTION : {len(trouves)} fichiers pour « {motif} », "
              f"le plus recent retenu ({trouves[-1].name})")
    with io.open(trouves[-1], encoding="utf-8-sig", newline="") as f:
        lecteur = csv.DictReader(f, delimiter=";")
        entetes = list(lecteur.fieldnames or [])
        lignes = list(lecteur)

    return _normaliser_lignes(lignes, entetes, trouves[-1].name), trouves[-1].name


def _normaliser_lignes(lignes, entetes, nom_fichier):
    """Normalise les en-tetes -- en refusant de perdre une colonne.

    POURQUOI CE N'EST PAS UN SIMPLE dict-comprehension
    --------------------------------------------------
    La balance porte « Total Remise » ET « Total remisé ». Depouillees de
    leurs accents et mises en minuscules, les deux donnent « total
    remise » : la seconde ecrasait la premiere, et le total des remises
    du detail sortait sept fois trop haut -- un chiffre qui ne recoupait
    rien, mais qui s'affichait sans broncher.

    On garde donc la PREMIERE occurrence, on suffixe les suivantes, et on
    l'annonce. Perdre une colonne en silence est exactement ce qu'une
    couche de lecture ne doit jamais faire.

    (Dans cet export precis, « Total remisé » vaut « Total HT » a
    l'identique : la suffixer ne coute rien. Mais c'est une observation
    sur ce lot, pas une regle -- d'ou l'avertissement.)
    """
    correspondance, collisions, vus = {}, [], {}
    for brut in entetes:
        cle = _sans_accents(brut)
        if cle in vus:
            vus[cle] += 1
            collisions.append((brut, cle, f"{cle}#{vus[cle]}"))
            cle = f"{cle}#{vus[cle]}"
        else:
            vus[cle] = 1
        correspondance[brut] = cle

    if collisions:
        print(f"  ATTENTION : {nom_fichier} a des en-tetes qui se confondent "
              f"une fois les accents retires")
        for brut, cle, suffixe in collisions:
            print(f"      « {brut} » -> {suffixe}  (« {cle} » etait deja pris)")

    return [{correspondance.get(k, _sans_accents(k)): v for k, v in r.items()}
            for r in lignes]


def nombre(v):
    """« 1 234 567 CFA » -> 1234567.0

    L'export melange espaces fines insecables, espaces ordinaires,
    virgules decimales et suffixes monetaires selon la colonne."""
    s = str(v or "").replace("\xa0", "").replace("\u202f", "")
    s = s.replace("CFA", "").replace(" ", "").replace(",", ".")
    if not s or s.lower() == "nan":
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def jour(v):
    """« 14/11/2025 00:00:00 » -> date(2025, 11, 14)"""
    s = str(v or "").split(" ")[0]
    for forme in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, forme).date()
        except ValueError:
            continue
    return None


def cles_valeurs(lignes):
    """Les fichiers « resume » n'ont pas de colonnes : ce sont des
    paires libelle/valeur empilees, avec des lignes vides en guise de
    separateurs. On les rend exploitables sans deviner leur ordre."""
    out = []
    for r in lignes:
        vals = [str(v or "").strip() for v in r.values()]
        if not any(vals):
            continue
        out.append(vals)
    return out


# ---------------------------------------------------------------- extraction

def extraire(dossier):
    print(f"\nLecture de {dossier}\n")
    sources = {}

    caf, sources["journal"] = lire(dossier, "journal du caf")
    bal, sources["balance"] = lire(dossier, "balance par categorie")
    off, sources["offerts"] = lire(dossier, "articles offerts")
    hor, sources["horaire"] = lire(dossier, "panier moyen horaire")
    usr, sources["utilisateurs"] = lire(dossier, "balance par utilisateur")
    reg, sources["reglements"] = lire(dossier, "balance par reglement")
    glo, sources["global"] = lire(dossier, "chiffre d'affaire globale")
    for role, nom in sources.items():
        print(f"  {role:<14} {nom}")

    # ---- 1. La serie journaliere, source de verite du chiffre ----
    # Noms d'origine : HT = brut, TTC = net apres remise. Voir l'en-tete.
    jours = []
    for r in caf:
        d = jour(r.get("date"))
        if not d:
            continue
        jours.append({
            # « d » et non « jour » : inRange(), sums() et groupBy() du
            # chassis filtrent sur ce nom. S'en ecarter obligerait a
            # dupliquer ces trois fonctions pour un seul etablissement.
            "d": d.isoformat(),
            "brut": nombre(r.get("ht")),
            "remise": nombre(r.get("remise")),
            "net": nombre(r.get("ttc")),
            "offerts_qte": int(nombre(r.get("offert"))),
            "offerts_valeur": nombre(r.get("ca offert")),
        })
    jours.sort(key=lambda x: x["d"])

    # ---- 2. Le detail par categorie et produit ----
    # Ici « TTC » est le brut et « Total HT » le net : convention inverse
    # du fichier precedent. On ne garde que brut/net.
    detail = []
    for r in bal:
        d = jour(r.get("date"))
        if not d:
            continue
        detail.append({
            "d": d.isoformat(),
            "type": (r.get("type") or "").strip(),
            "categorie": (r.get("categorie") or "").strip(),
            "produit": (r.get("produits") or "").strip(),
            "qte_vendue": nombre(r.get("qte")),
            "qte_offerte": nombre(r.get("offert")),
            "qte_totale": nombre(r.get("total qte")),
            "brut": nombre(r.get("ttc")),
            "remise": nombre(r.get("total remise")),
            "net": nombre(r.get("total ht")),
        })

    # ---- 3. Les offerts, ligne a ligne ----
    offerts = []
    for r in off:
        d = jour(r.get("offert le"))
        if not d:
            continue
        offerts.append({
            "d": d.isoformat(),
            "categorie": (r.get("categorie") or "").strip(),
            "article": (r.get("article") or "").strip(),
            "client": (r.get("client") or "").strip(),
            "caissier": (r.get("caissier") or "").strip() or "(non renseigne)",
            "ticket": (r.get("ticket") or "").strip(),
            "qte": nombre(r.get("quantite")),
            "valeur": nombre(r.get("val vente")),
        })

    # ---- 4. Les tranches horaires ----
    horaire = []
    for r in hor:
        libelle = (r.get("heure") or "").strip()
        m = re.match(r"^(\d+)h", libelle)
        if not m:
            continue
        horaire.append({
            "heure": int(m.group(1)),
            "libelle": libelle,
            "ca": nombre(r.get("ca")),
            "ventes": int(nombre(r.get("ventes"))),
            "vendeurs": int(nombre(r.get("vendeurs"))),
            "panier_moyen": nombre(r.get("panier moyen")),
        })
    horaire.sort(key=lambda x: x["heure"])

    # ---- 5. Les caissiers ----
    # Fichier en paires libelle/valeur, un bloc par personne.
    caissiers, courant = [], None
    for vals in cles_valeurs(usr):
        libelle = _sans_accents(vals[0])
        valeur = vals[1] if len(vals) > 1 else ""
        if libelle == "utilisateur":
            courant = {"nom": valeur.strip()}
            caissiers.append(courant)
        elif courant is not None:
            cle = {
                "nbre produit": "produits", "nbre de ticket": "tickets",
                "nbre panier": "paniers", "panier moyen": "panier_moyen",
                "total ht": "brut", "total ttc": "net",
                "total reglement": "regle",
            }.get(libelle)
            if cle:
                courant[cle] = nombre(valeur)
    caissiers = [c for c in caissiers if c.get("tickets")]

    # ---- 6. Les moyens de reglement ----
    reglements, total_regle = [], 0.0
    for vals in cles_valeurs(reg):
        libelle = vals[0].strip()
        if not libelle or libelle.startswith(" "):
            continue
        depouille = _sans_accents(libelle)
        if depouille.startswith("dont ") or depouille == "column1":
            continue
        montant = nombre(vals[2] if len(vals) > 2 else 0)
        nb = int(nombre(vals[1] if len(vals) > 1 else 0))
        if depouille.startswith("total"):
            if depouille == "total":
                total_regle = montant
            continue
        reglements.append({"moyen": libelle, "nombre": nb, "montant": montant})

    # ---- 7. Le resume du logiciel, garde tel quel pour recouper ----
    resume = {}
    for vals in cles_valeurs(glo):
        libelle = _sans_accents(vals[0]).rstrip(":")
        valeur = vals[1] if len(vals) > 1 else ""
        if valeur:
            resume[libelle] = nombre(valeur)

    return {
        "jours": jours, "detail": detail, "offerts": offerts,
        "horaire": horaire, "caissiers": caissiers,
        "reglements": reglements, "total_regle": total_regle,
        "resume": resume, "sources": sources,
    }


# ---------------------------------------------------------------- controles

def controler(x):
    """Recoupe les sources entre elles et RENVOIE les ecarts.

    Ils ne sont pas corriges en silence : un tableau de bord qui lisse
    ses incoherences fait perdre la seule occasion de s'apercevoir que
    l'export est incomplet. Ils partent dans le JSON et s'affichent.
    """
    net_journal = sum(j["net"] for j in x["jours"])
    net_detail = sum(d["net"] for d in x["detail"])
    offerts_lignes = sum(o["valeur"] for o in x["offerts"])
    offerts_journal = sum(j["offerts_valeur"] for j in x["jours"])
    resume_ca = x["resume"].get("ca ttc hors offert", 0)
    resume_off = x["resume"].get("dont ca ht offert", 0)

    # Les trois notions de remise, nommees court parce que la phrase de
    # lecture plus bas les assemble.
    _j = sum(j["remise"] for j in x["jours"])
    _d = sum(d["remise"] for d in x["detail"])
    _r = x["resume"].get("remise", 0)

    def ecart(a, b):
        return {"a": a, "b": b, "ecart": a - b,
                "concorde": abs(a - b) < 1}

    return {
        "ca_net_journal_vs_resume": ecart(net_journal, resume_ca),
        "ca_net_journal_vs_detail": ecart(net_journal, net_detail),
        "offerts_lignes_vs_journal": ecart(offerts_lignes, offerts_journal),
        "offerts_lignes_vs_resume": ecart(offerts_lignes, resume_off),
        "remises": {
            "journal": _j,
            "detail": _d,
            "resume": _r,
            "note": "Trois notions differentes dans les exports. La serie "
                    "journaliere retient celle du Journal du CAF, seule a "
                    "tomber au franc pres sur le resume du logiciel.",
            # La phrase est CONSTRUITE a partir des trois totaux, elle
            # n'est pas ecrite. Ce fichier est versionne dans un depot
            # public ; les montants, eux, n'en sortent pas.
            "lecture_plausible": (
                f"Les deux premieres s'additionnent presque exactement a la "
                f"troisieme ({_j:,.0f} + {_d:,.0f} = {_j + _d:,.0f} contre "
                f"{_r:,.0f}, soit {abs(_r - _j - _d):,.0f} d'ecart) : il "
                f"s'agirait de deux remises complementaires -- l'une au "
                f"ticket, l'autre a la ligne -- que le resume cumule. C'est "
                f"une lecture, pas une certitude : rien dans les exports ne "
                f"la confirme, et le residu reste inexplique. A trancher "
                f"avec Infogest avant d'en tirer une conclusion."
            ).replace(",", " "),
        },
    }


# ---------------------------------------------------------------- assemblage

def construire(x):
    ctrl = controler(x)
    jours = x["jours"]
    net = sum(j["net"] for j in jours)
    brut = sum(j["brut"] for j in jours)
    remise = sum(j["remise"] for j in jours)
    offerts_val = sum(j["offerts_valeur"] for j in jours)
    offerts_qte = sum(j["offerts_qte"] for j in jours)
    qte_vendue = sum(d["qte_vendue"] for d in x["detail"])
    qte_totale = sum(d["qte_totale"] for d in x["detail"])
    paniers = int(x["resume"].get("nbre panier", 0))

    par_categorie = defaultdict(lambda: {"net": 0.0, "brut": 0.0, "remise": 0.0,
                                         "qte_vendue": 0.0, "qte_offerte": 0.0,
                                         "type": ""})
    for d in x["detail"]:
        c = par_categorie[d["categorie"]]
        c["type"] = d["type"]
        for k in ("net", "brut", "remise", "qte_vendue", "qte_offerte"):
            c[k] += d[k]

    par_produit = defaultdict(lambda: {"net": 0.0, "qte_vendue": 0.0,
                                       "qte_offerte": 0.0, "categorie": "",
                                       "type": ""})
    for d in x["detail"]:
        p = par_produit[d["produit"]]
        p["categorie"], p["type"] = d["categorie"], d["type"]
        for k in ("net", "qte_vendue", "qte_offerte"):
            p[k] += d[k]

    offerts_par_article = defaultdict(lambda: {"valeur": 0.0, "qte": 0.0,
                                               "categorie": ""})
    offerts_par_caissier = defaultdict(lambda: {"valeur": 0.0, "qte": 0.0,
                                                "tickets": set()})
    for o in x["offerts"]:
        a = offerts_par_article[o["article"]]
        a["categorie"] = o["categorie"]
        a["valeur"] += o["valeur"]
        a["qte"] += o["qte"]
        c = offerts_par_caissier[o["caissier"]]
        c["valeur"] += o["valeur"]
        c["qte"] += o["qte"]
        c["tickets"].add(o["ticket"])

    for c in offerts_par_caissier.values():
        c["tickets"] = len(c["tickets"])

    return {
        "meta": {
            "etablissement": "amnesia",
            "nom": "AMNESIA",
            "sous_titre": "Nightclub & Rooftop",
            "devise": "CFA",
            "periode_debut": jours[0]["d"] if jours else None,
            "periode_fin": jours[-1]["d"] if jours else None,
            "jours_exploitation": len(jours),
            "genere_le": datetime.now().strftime("%d/%m/%Y %H:%M"),
            "source": "Exports Infogest (CSV)",
            "sources_fichiers": x["sources"],

            # LE champ qui commande la moitie de l'interface. Les pages de
            # marge, de cout de revient et de resultat se lisent dessus
            # pour s'afficher ou expliquer leur absence -- jamais pour
            # montrer un zero, qui se lirait comme une marge nulle.
            "couts_disponibles": False,
            "pourquoi_pas_de_couts":
                "Les exports Infogest ne portent aucun prix d'achat : la "
                "colonne Cout de la balance et la colonne Val Achat des "
                "offerts valent zero sur toutes les lignes. Le cout de "
                "revient PAR PRODUIT reste donc hors d'atteinte, et avec "
                "lui la marge par article. Les charges et le resultat, "
                "eux, viennent du classeur de suivi mensuel : ils sont "
                "connus au mois et au poste, jamais a l'article.",
        },

        "totaux": {
            "ca_net": net,
            "ca_brut": brut,
            "remises": remise,
            "offerts_valeur": offerts_val,
            "offerts_qte": offerts_qte,
            "ca_potentiel": net + offerts_val,
            "qte_vendue": qte_vendue,
            "qte_totale": qte_totale,
            "paniers": paniers,
            "panier_moyen": (net / paniers) if paniers else 0,
            "part_offerts_sur_net": (offerts_val / net) if net else 0,
            "part_offerts_sur_potentiel":
                (offerts_val / (net + offerts_val)) if (net + offerts_val) else 0,
            "part_articles_offerts": (offerts_qte / qte_totale) if qte_totale else 0,
        },

        "resultat_jour": jours,
        "ventes_categorie": [
            {"categorie": k, **v} for k, v in
            sorted(par_categorie.items(), key=lambda kv: -kv[1]["net"])],
        "ventes_produit": [
            {"produit": k, **v} for k, v in
            sorted(par_produit.items(), key=lambda kv: -kv[1]["net"])],
        "horaire": x["horaire"],
        "caissiers": x["caissiers"],
        "reglements": x["reglements"],
        "offerts_article": [
            {"article": k, **v} for k, v in
            sorted(offerts_par_article.items(), key=lambda kv: -kv[1]["valeur"])],
        "offerts_caissier": [
            {"caissier": k, **v} for k, v in
            sorted(offerts_par_caissier.items(), key=lambda kv: -kv[1]["valeur"])],
        "offerts_jour": x["offerts"],
        "detail_jour": x["detail"],
        "controles": ctrl,
        "resume_logiciel": x["resume"],
    }


def principal():
    dossier = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAUT
    if not dossier.is_dir():
        raise SystemExit(f"Dossier introuvable : {dossier}")

    donnees = construire(extraire(dossier))
    SORTIE.write_text(json.dumps(donnees, ensure_ascii=False, indent=1),
                      encoding="utf-8")

    t = donnees["totaux"]
    m = donnees["meta"]
    F = lambda v: f"{v:,.0f}".replace(",", " ")

    print(f"\n  periode           {m['periode_debut']} -> {m['periode_fin']}"
          f"   ({m['jours_exploitation']} nuits)")
    print(f"  CA net            {F(t['ca_net']):>16} CFA")
    print(f"  remises           {F(t['remises']):>16} CFA")
    print(f"  offerts           {F(t['offerts_valeur']):>16} CFA"
          f"   soit {t['part_offerts_sur_net']*100:.1f} % du CA net")
    print(f"  articles offerts  {F(t['offerts_qte']):>16}"
          f"      soit {t['part_articles_offerts']*100:.1f} % des articles sortis")
    print(f"  panier moyen      {F(t['panier_moyen']):>16} CFA"
          f"   sur {F(t['paniers'])} paniers")
    print(f"  categories        {len(donnees['ventes_categorie']):>16}")
    print(f"  produits          {len(donnees['ventes_produit']):>16}")

    print("\n  RECOUPEMENTS")
    for nom, c in donnees["controles"].items():
        if nom == "remises":
            continue
        etat = "concorde" if c["concorde"] else f"ecart de {F(c['ecart'])}"
        print(f"    {nom:<28} {etat}")
    r = donnees["controles"]["remises"]
    print(f"    remises : journal {F(r['journal'])} · detail {F(r['detail'])}"
          f" · resume {F(r['resume'])}")

    print(f"\n  couts d'achat     ABSENTS — ni marge ni resultat")
    print(f"\n  {SORTIE.name}  {SORTIE.stat().st_size/1024:.0f} Ko\n")


if __name__ == "__main__":
    principal()
