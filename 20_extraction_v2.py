#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TABOO — Extraction v2 : couche de donnees complete du dashboard direction.

CE QUE CE SCRIPT AJOUTE PAR RAPPORT A 13_extraction_donnees.py
  Le v1 alimentait 10 pages a partir de 8 exports POS. Il laissait de cote
  trois sources presentes sur le disque, et tronquait les articles a 100 :

  1. couts_de_revient.csv  — le "chantier 4" que la couche BigQuery declarait
     en attente (11_views_reporting_v2.sql : "classeur non encore charge").
     Permet la marge THEORIQUE par produit, a confronter a la marge REELLE.
  2. INVENTAIRE*.csv       — stock theorique, seuil d'alerte, ecart.
  3. Chiffre d'affaire globale*.csv — totaux POS de controle : nombre de
     paniers et panier moyen, seule source du ticket moyen. Le journal
     de vente n'a AUCUN identifiant de ticket.

  Et il expose les 3 ecarts de reconciliation documentes dans
  06_reconciliation.sql, au lieu de les taire.

REGLES METIER — reprises telles quelles du v1 et de la couche BigQuery.
  Elles ne sont pas rediscutees ici, seulement appliquees.
    - Journee d'exploitation 14h00 -> 13h59.
    - Remise : source de verite = Balance par categorie. Journal CAF exclu
      (rupture de collecte depuis octobre 2024, sous-evaluation 90-99 %).
    - Achats DRINK = DRINK+MIAMI 228+PICASSO+GLACONS / EAT = EAT+GAZ /
      SMOKE = SMOKE. OPEX 12 postes. CAPEX = EQUIPEMENTS+TRAVAUX.
      CAISSE exclu (fonds de caisse).
    - Marge brute sur UNE UNION jours de vente + jours d'achat.

PRINCIPE DE SORTIE — mesures additives au grain le plus fin.
  Aucun ratio n'est pre-calcule dans le JSON au grain jour : un taux moyenne
  ne survit pas a un filtre de periode. Le JSON ne contient que des SOMMES ;
  les taux sont calcules dans le navigateur en somme(a)/somme(b).
  (Meme regle que la couche BigQuery, cf. son "PRINCIPE DIRECTEUR".)
"""

import json
import unicodedata
from datetime import datetime
from pathlib import Path

import pandas as pd
import numpy as np

BASE = Path(__file__).resolve().parent
BQ = Path(r"C:\Users\user\Downloads\BIG QUERRY\BIG QUERRY")
DL = Path(r"C:\Users\user\Downloads")

F_VENTES    = BQ / "Journal_Vente2482026174540.csv"
F_FAMILLE   = BQ / "Balance par catégorie 175024 82026.csv"
F_OFFERTS   = BQ / "Articles offerts 175124 82026.csv"
F_PANIER    = BQ / "Panier moyen horaire et journalier 175224 82026.csv"
F_REGL      = BQ / "% Balance par règlement 175124 82026.csv"
F_UTIL      = BQ / "Balance par utilisateur 175124 82026.csv"
F_CAGLOBAL  = BQ / "Chiffre d'affaire globale 174924 82026.csv"
F_INVENT    = BQ / "INVENTAIRE248202618038.csv"
F_DEPENSES  = DL / "Depenses TABOO - Détail_Dépenses .csv"
F_COUTS     = DL / "couts_de_revient.csv"


def num(s):
    """Nettoyage numerique commun : espaces fines, virgules decimales, #REF!."""
    if pd.isna(s):
        return np.nan
    s = str(s).replace('\u202f', '').replace('\u00a0', '').replace(' ', '').replace(',', '.')
    s = s.replace('CFA', '').replace('%', '')
    if '#REF' in s or s in ('', '-'):
        return np.nan
    try:
        return float(s)
    except ValueError:
        return np.nan


def cle(s):
    """Normalise un libelle produit pour le rapprochement ventes <-> couts.

    Les deux fichiers sont saisis a la main a des moments differents :
    accents, casse et espaces doubles divergent. Sans normalisation le
    rapprochement tombe a ~0 % et la page marge theorique serait vide.
    """
    if pd.isna(s):
        return ''
    s = str(s).upper().strip()
    s = ''.join(c for c in unicodedata.normalize('NFD', s)
                if unicodedata.category(c) != 'Mn')
    return ' '.join(s.split())


def jstr(d):
    return pd.Timestamp(d).strftime('%Y-%m-%d')


_alertes = []


def invariant(ok, message):
    if not ok:
        raise SystemExit(f"\nINCOHERENCE : {message}\n  Arret : mieux vaut "
                         f"pas de dashboard qu'un dashboard faux.\n")


print("=" * 70)
print("TABOO — extraction v2")
print("=" * 70)

# =====================================================================
# 1. VENTES DETAILLEES — grain article, journee d'exploitation 14h
# =====================================================================
print("\n[1/9] Journal de vente detaille...")
v = pd.read_csv(F_VENTES, sep=';', encoding='utf-8-sig', low_memory=False)
v = v[v.Type != 'TOTAL'].copy()
for c in ['Pu', 'Qté', 'Remise', 'CAF']:
    v[c] = v[c].map(num)
v['date_saisie'] = pd.to_datetime(v['Date'], format='%d/%m/%Y %H:%M:%S', errors='coerce')
v['heure_dt'] = pd.to_datetime(v['Heure'].astype(str).str.slice(0, 8),
                               format='%H:%M:%S', errors='coerce')
v = v.dropna(subset=['date_saisie', 'heure_dt'])
v['h'] = v['heure_dt'].dt.hour

# Coupure a 14h : aucune soiree scindee.
v['jour_exploitation'] = pd.to_datetime(np.where(
    v['h'] >= 14, v['date_saisie'].dt.date,
    (v['date_saisie'] - pd.Timedelta(days=1)).dt.date))
v['ordre_nuit'] = np.where(v['h'] >= 14, v['h'] - 14, v['h'] + 10)
# CAF est le CA NET (apres remise). Le brut se reconstitue net + remise.
v['ca_brut_ligne'] = v['CAF'] + v['Remise'].fillna(0)

ca_net_ventes = v['CAF'].sum()
invariant(len(v) > 0, "journal de vente vide")
invariant(ca_net_ventes > 0, f"CA net nul : {ca_net_ventes:,.0f}")
print(f"      {len(v):,} lignes · CA net {ca_net_ventes:,.0f} F")
print(f"      periode {v.jour_exploitation.min():%Y-%m-%d} -> {v.jour_exploitation.max():%Y-%m-%d}")

# =====================================================================
# 2. BALANCE PAR CATEGORIE — source de verite brut / remise / net
# =====================================================================
print("\n[2/9] Balance par categorie (source de verite remise)...")
e = pd.read_csv(F_FAMILLE, sep=';', encoding='utf-8-sig', low_memory=False)
e['date_calendaire'] = pd.to_datetime(e['Date'], format='%d/%m/%Y %H:%M:%S', errors='coerce')
for c in ['Qté', 'offert', 'Total Qté', 'TTC', 'Cout', 'Total Remise', 'Total HT']:
    e[c] = e[c].map(num)
e = e.dropna(subset=['date_calendaire'])
e = e[e.Type.isin(['DRINK', 'EAT', 'SMOKE'])].copy()

brut, remise_t, net = e['TTC'].sum(), e['Total Remise'].sum(), e['Total HT'].sum()
invariant(abs((brut - remise_t) - net) < 1,
          f"brut - remise != net ({brut:,.0f} - {remise_t:,.0f} != {net:,.0f})")
invariant(abs(net - ca_net_ventes) < 1,
          f"les deux exports POS divergent sur le CA net : "
          f"journal {ca_net_ventes:,.0f} vs balance {net:,.0f}")
print(f"      brut {brut:,.0f} · remise {remise_t:,.0f} · net {net:,.0f} F")

# =====================================================================
# 3. DEPENSES
# =====================================================================
print("\n[3/9] Depenses...")
d = pd.read_csv(F_DEPENSES, encoding='utf-8', dtype=str)
d = d[d.DATES.notna()].copy()
d['jour_exploitation'] = pd.to_datetime(d.DATES, format='%d/%m/%Y', errors='coerce')
d = d[d.JOURS.str.lower().isin(['lundi', 'mardi', 'mercredi', 'jeudi',
                                'vendredi', 'samedi', 'dimanche'])]
# Borne haute deduite des ventes : le fichier de depenses est tenu a la main
# et contient des lignes previsionnelles au-dela du dernier jour vendu.
LIMITE = v['jour_exploitation'].max()
d = d[d.jour_exploitation <= LIMITE]

MAPPING_ACHATS = {'DRINK': 'DRINK', 'MIAMI 228': 'DRINK', 'PICASSO': 'DRINK',
                  'GLACONS': 'DRINK', 'EAT': 'EAT', 'GAZ': 'EAT', 'SMOKE': 'SMOKE'}
POSTES_OPEX = ['MONNAIE', 'MARKETING', 'CACHETS', 'CEET/CASH POWER', 'TELEPHONIE',
               'INTERNET / TV', 'LOYERS', 'ADMINISTRATIF', 'CONSOMMABLES',
               'ENTRETIEN', 'TRANSPORT', 'AUTRE']
POSTES_CAPEX = ['EQUIPEMENTS', 'TRAVAUX']

rows = []
for _, r in d.iterrows():
    j = r['jour_exploitation']
    for poste, act in MAPPING_ACHATS.items():
        val = num(r.get(poste))
        if pd.notna(val) and val != 0:
            rows.append({'jour_exploitation': j, 'nature': 'ACHATS EXTERNES',
                         'activite': act, 'poste': poste, 'montant': val})
    for nature, postes in (('OPEX', POSTES_OPEX), ('CAPEX', POSTES_CAPEX)):
        for poste in postes:
            val = num(r.get(poste))
            if pd.notna(val) and val != 0:
                rows.append({'jour_exploitation': j, 'nature': nature,
                             'activite': None, 'poste': poste, 'montant': val})
dep = pd.DataFrame(rows)
invariant(len(dep) > 0, "aucune depense retenue : colonnes renommees ?")
print(f"      {len(dep):,} lignes · total {dep.montant.sum():,.0f} F")

# =====================================================================
# 4. RESULTAT JOUR x ACTIVITE — union ventes + achats
# =====================================================================
print("\n[4/9] Compte de resultat au grain jour x activite...")
ca_ja = e.groupby(['date_calendaire', 'Type'], as_index=False).agg(
    ca_brut=('TTC', 'sum'), remise=('Total Remise', 'sum'), ca_net=('Total HT', 'sum'),
    quantite_vendue=('Qté', 'sum'), quantite_offerte=('offert', 'sum')
).rename(columns={'date_calendaire': 'jour_exploitation', 'Type': 'activite'})

ach_ja = dep[dep.nature == 'ACHATS EXTERNES'].groupby(
    ['jour_exploitation', 'activite'], as_index=False)['montant'].sum(
).rename(columns={'montant': 'achats_externes'})

# FULL OUTER : un achat un jour sans vente ne doit pas disparaitre.
res = ca_ja.merge(ach_ja, on=['jour_exploitation', 'activite'], how='outer')
for c in ['ca_brut', 'remise', 'ca_net', 'quantite_vendue', 'quantite_offerte',
          'achats_externes']:
    res[c] = res[c].fillna(0)

# OPEX / CAPEX non rattachables a une activite : ventiles au prorata du CA
# net du jour. Le montant ventile redevient additif, donc filtrable.
opex_j = dep[dep.nature == 'OPEX'].groupby('jour_exploitation')['montant'].sum()
capex_j = dep[dep.nature == 'CAPEX'].groupby('jour_exploitation')['montant'].sum()
canet_j = res.groupby('jour_exploitation')['ca_net'].sum()
res['_opex_j'] = res.jour_exploitation.map(opex_j).fillna(0)
res['_capex_j'] = res.jour_exploitation.map(capex_j).fillna(0)
res['_canet_j'] = res.jour_exploitation.map(canet_j).fillna(0)
res['_cle'] = np.where(res._canet_j > 0, res.ca_net / res._canet_j, 0)
res['opex'] = (res._opex_j * res._cle).round()
res['capex'] = (res._capex_j * res._cle).round()
res['marge_brute'] = res.ca_net - res.achats_externes
res['resultat_exploitation'] = res.marge_brute - res.opex
res['resultat_net'] = res.resultat_exploitation - res.capex

achats_src = dep[dep.nature == 'ACHATS EXTERNES']['montant'].sum()
invariant(abs(res.achats_externes.sum() - achats_src) < 1,
          f"achats perdus dans la jointure : {achats_src:,.0f} -> "
          f"{res.achats_externes.sum():,.0f} (regression du FULL OUTER JOIN)")
print(f"      marge brute {res.marge_brute.sum():,.0f} F "
      f"({100*res.marge_brute.sum()/res.ca_net.sum():.1f} %)")
print(f"      resultat net {res.resultat_net.sum():,.0f} F "
      f"({100*res.resultat_net.sum()/res.ca_net.sum():.1f} %)")

# =====================================================================
# 5. ARTICLES — catalogue COMPLET (le v1 s'arretait a 100)
# =====================================================================
print("\n[5/9] Catalogue articles complet...")
art = v.groupby(['Type', 'Categorie', 'Articles'], as_index=False).agg(
    q=('Qté', 'sum'), cn=('CAF', 'sum'), cb=('ca_brut_ligne', 'sum'),
    rm=('Remise', 'sum'), nl=('CAF', 'size'))
art = art.sort_values('cn', ascending=False).reset_index(drop=True)
art['cle'] = art.Articles.map(cle)
print(f"      {len(art):,} articles distincts")

# Pareto : combien d'articles font 80 % du CA ?
art['_cum'] = art.cn.cumsum() / art.cn.sum()
n80 = int((art._cum <= 0.8).sum()) + 1
print(f"      Pareto : {n80} articles ({100*n80/len(art):.1f} %) font 80 % du CA")

# =====================================================================
# 6. COUTS DE REVIENT — le "chantier 4", enfin raccorde
# =====================================================================
print("\n[6/9] Couts de revient...")
cr = pd.read_csv(F_COUTS, sep=';', encoding='utf-8')
cr['cout_revient'] = cr.cout_revient.map(num)
cr['prix_vente'] = cr.prix_vente.map(num)
cr['cle'] = cr.produit.map(cle)
cr = cr.dropna(subset=['cout_revient'])
cr = cr.drop_duplicates(subset=['cle'], keep='first')

# Rapprochement sur le libelle normalise.
j = art.merge(cr[['cle', 'type_source', 'cout_revient', 'prix_vente', 'statut_cout']],
              on='cle', how='left')
apparies = j.cout_revient.notna()
ca_couvert = j.loc[apparies, 'cn'].sum()
print(f"      {len(cr):,} produits references · {apparies.sum():,} apparies "
      f"aux ventes ({100*ca_couvert/j.cn.sum():.1f} % du CA couvert)")
if 100 * ca_couvert / j.cn.sum() < 20:
    _alertes.append(
        f"Couts de revient : seulement {100*ca_couvert/j.cn.sum():.1f} % du CA "
        f"est couvert. La marge theorique ne porte que sur ce perimetre.")

# Marge theorique la ou le cout est connu.
j['cout_total'] = (j.cout_revient * j.q).where(apparies)
j['marge_theorique'] = (j.cn - j.cout_total).where(apparies)

couts_articles = [
    {'t': r.Type, 'c': r.Categorie, 'a': r.Articles, 'src': r.type_source,
     'q': int(r.q), 'cn': round(r.cn), 'cb': round(r.cb), 'rm': round(r.rm),
     'cr': round(r.cout_revient, 2), 'pv': round(r.prix_vente) if pd.notna(r.prix_vente) else None,
     'ct': round(r.cout_total), 'mt': round(r.marge_theorique),
     'st': r.statut_cout}
    for r in j[apparies].itertuples() if r.q > 0
]

# =====================================================================
# 7. INVENTAIRE
# =====================================================================
print("\n[7/9] Inventaire...")
inv = pd.read_csv(F_INVENT, sep=';', encoding='utf-8-sig')
inv.columns = [c.strip() for c in inv.columns]
for c in ['Qté théorique', 'Stock Alerte', 'Qté physique', 'Ecart']:
    inv[c] = inv[c].map(num)
inv = inv.dropna(subset=['Articles'])
inv['cle'] = inv.Articles.map(cle)

# Le comptage physique n'a jamais ete saisi : la colonne est a 0 partout.
# Sans ce constat, "Ecart = -theorique" se lirait comme une demarque totale.
compte = int((inv['Qté physique'] > 0).sum())
inventaire_compte = compte > 0
if not inventaire_compte:
    _alertes.append(
        "Inventaire : la quantite physique est a 0 sur les "
        f"{len(inv)} articles — le comptage n'a jamais ete saisi dans le POS. "
        "L'ecart affiche n'est donc PAS une demarque : il vaut mecaniquement "
        "l'oppose du stock theorique. Seuls le stock theorique et le seuil "
        "d'alerte sont exploitables.")
print(f"      {len(inv):,} articles · comptage physique saisi sur {compte}")

# Valorisation du stock theorique au cout de revient quand il est connu.
inv = inv.merge(cr[['cle', 'cout_revient']], on='cle', how='left')
inv['valeur_stock'] = inv['Qté théorique'] * inv['cout_revient']
# Sous le seuil d'alerte = a reapprovisionner (seuil 0 = non parametre).
inv['sous_alerte'] = (inv['Stock Alerte'] > 0) & \
                     (inv['Qté théorique'] <= inv['Stock Alerte'])

def i0(x):
    """Entier tolerant aux cellules vides de l'export inventaire."""
    return 0 if pd.isna(x) else int(x)


inventaire = [
    {'cat': r['Catégorie'], 'a': r['Articles'],
     'qt': i0(r['Qté théorique']), 'sa': i0(r['Stock Alerte']),
     'qp': i0(r['Qté physique']), 'ec': i0(r['Ecart']),
     'vs': round(r['valeur_stock']) if pd.notna(r['valeur_stock']) else None,
     'al': bool(r['sous_alerte'])}
    for _, r in inv.iterrows()
]
n_alerte = int(inv.sous_alerte.sum())
val_stock = inv.valeur_stock.sum()
print(f"      {n_alerte} articles sous seuil d'alerte · stock valorise "
      f"{val_stock:,.0f} F (sur le perimetre a cout connu)")

# =====================================================================
# 8. AUTRES SOURCES POS
# =====================================================================
print("\n[8/9] Reglements, horaire, caissiers, offerts, totaux POS...")

# --- Reglements (cumul, aucune date dans la source)
rg = pd.read_csv(F_REGL, sep=';', encoding='utf-8-sig')
rg.columns = ['libelle', 'nombre', 'montant'][:len(rg.columns)]
rg['nombre'] = rg.nombre.map(num)
rg['montant'] = rg.montant.map(num)
MOYENS = ['CB', 'CHEQUES', 'ESPECES', 'FLOOZ', 'GOZEM', 'TMONEY']
regl = rg[rg.libelle.isin(MOYENS)][['libelle', 'nombre', 'montant']].copy()
cred = rg[rg.libelle.astype(str).str.contains('crédit|credit', case=False, na=False)]
credit_montant = float(cred.montant.iloc[0]) if len(cred) else 0.0
credit_nombre = float(cred.nombre.iloc[0]) if len(cred) else 0.0
regl = pd.concat([regl, pd.DataFrame([{'libelle': 'Crédit',
                                       'nombre': credit_nombre,
                                       'montant': credit_montant}])],
                 ignore_index=True)

# --- Profil horaire de reference (source dediee, sans date)
ph = pd.read_csv(F_PANIER, sep=';', encoding='utf-8-sig')
ph.columns = ['heure', 'ca', 'ventes', 'vendeurs', 'panier_moyen']
for c in ['ca', 'ventes', 'vendeurs', 'panier_moyen']:
    ph[c] = ph[c].map(num)
ph = ph.dropna(subset=['ca'])
ph['heure_debut'] = ph.heure.str.extract(r'^(\d+)').astype(float)
ph['ordre_nuit'] = np.where(ph.heure_debut >= 14, ph.heure_debut - 14,
                            ph.heure_debut + 10)
ph = ph.sort_values('ordre_nuit')

# --- Caissiers (export en blocs cle/valeur, sans date)
ur = pd.read_csv(F_UTIL, sep=';', encoding='utf-8-sig')
ur.columns = ['libelle', 'valeur', 'complement'][:len(ur.columns)]
blocs, cur = [], None
for _, r in ur.iterrows():
    lib = str(r['libelle']).strip()
    if lib == 'Utilisateur':
        if cur:
            blocs.append(cur)
        cur = {'utilisateur': str(r['valeur']).strip()}
    elif cur is not None and lib and lib != 'nan':
        cur[lib] = r['valeur']
if cur:
    blocs.append(cur)
cai = pd.DataFrame(blocs)
for c in ['Nbre produit', 'Nbre de ticket', 'Nbre panier', 'Panier Moyen',
          'Total HT', 'Total TTC', 'Total règlement']:
    if c in cai.columns:
        cai[c] = cai[c].map(num)

# --- Articles offerts
off = pd.read_csv(F_OFFERTS, sep=';', encoding='utf-8-sig', low_memory=False)
off['jour_exploitation'] = pd.to_datetime(off['Offert le'],
                                          format='%d/%m/%Y %H:%M:%S', errors='coerce')
for c in ['Quantité', 'Val Achat', 'Val vente']:
    off[c] = off[c].map(num)
off = off.dropna(subset=['jour_exploitation'])

# --- Totaux POS de controle (nombre de paniers, panier moyen)
cg = pd.read_csv(F_CAGLOBAL, sep=';', encoding='utf-8-sig', header=None,
                 names=['libelle', 'valeur', 'x'])
cg['libelle'] = cg.libelle.astype(str).str.strip().str.rstrip(':').str.strip()


def cg_val(motif):
    m = cg[cg.libelle.str.contains(motif, case=False, na=False, regex=True)]
    return num(m.valeur.iloc[0]) if len(m) else None


nb_panier = cg_val(r'^Nbre panier')
panier_moyen = cg_val(r'^Panier Moyen')
nombre_vendu = cg_val(r'^Nombre vendu')
remise_pos = cg_val(r'^Remise')
total_offert = cg_val(r'^Total Offert')
ca_ht_hors_offert = cg_val(r'CA H\.T Hors offert')
ca_offert = cg_val(r'dont CA HT offert')
print(f"      {nb_panier:,.0f} paniers · panier moyen {panier_moyen:,.0f} F")

# =====================================================================
# 9. RECONCILIATION — les 3 ecarts documentes, affiches et non caches
# =====================================================================
print("\n[9/9] Reconciliation...")
total_regl = regl.montant.sum()
reconciliation = [
    {'controle': 'Coherence interne de la source de verite',
     'attendu': round(brut - remise_t), 'obtenu': round(net),
     'regle': 'CA brut − remise = CA net',
     'statut': 'OK' if abs((brut - remise_t) - net) < 1 else 'ALERTE',
     'explication': "Verifie que la Balance par categorie est coherente avec "
                    "elle-meme. Tout ecart invaliderait la source de verite de la remise."},
    {'controle': 'CA net : journal de vente vs balance par categorie',
     'attendu': round(net), 'obtenu': round(ca_net_ventes),
     'regle': 'Deux rapports POS independants, meme CA net',
     'statut': 'OK' if abs(net - ca_net_ventes) < 1 else 'ALERTE',
     'explication': "Les deux exports concordent a l'unite pres. C'est le "
                    "controle le plus fort dont on dispose sur l'ingestion."},
    {'controle': 'CA global POS vs balance par categorie',
     'attendu': round(ca_ht_hors_offert), 'obtenu': round(net),
     'regle': 'Ecart structurel connu',
     'statut': 'ECART CONNU',
     'explication': "Ecart de {:,.0f} F. Les deux rapports POS ne couvrent pas "
                    "le meme perimetre d'articles. Documente dans "
                    "06_reconciliation.sql ; surveiller sa variation, pas son "
                    "niveau.".format(ca_ht_hors_offert - net).replace(',', ' ')},
    {'controle': 'CA net vs total des reglements encaisses',
     'attendu': round(net), 'obtenu': round(total_regl),
     'regle': 'Ecart structurel connu',
     'statut': 'ECART CONNU',
     'explication': "Ecart de {:,.0f} F, dont {:,.0f} F de ventes a credit. "
                    "Le solde correspond aux ecarts d'encaissement.".format(
                        net - total_regl, credit_montant).replace(',', ' ')},
    {'controle': 'Remise : Journal CAF vs balance par categorie',
     'attendu': round(remise_t), 'obtenu': None,
     'regle': 'Journal CAF ECARTE de la chaine',
     'statut': 'SOURCE ECARTEE',
     'explication': "Le Journal CAF sous-evalue la remise de 90 a 99 % depuis "
                    "octobre 2024 (rupture de collecte cote POS). C'est une "
                    "anomalie de l'editeur, pas un ecart metier : la chaine "
                    "n'utilise que la Balance par categorie."},
    {'controle': 'Inventaire : comptage physique saisi',
     'attendu': len(inv), 'obtenu': compte,
     'regle': 'Chaque article doit avoir un comptage',
     'statut': 'OK' if inventaire_compte else 'DONNEE MANQUANTE',
     'explication': "Aucun comptage physique n'a ete saisi. L'ecart "
                    "d'inventaire n'est donc pas exploitable ; le stock "
                    "theorique et les seuils d'alerte le sont."},
]
for r in reconciliation:
    print(f"      [{r['statut']:<16}] {r['controle']}")

# =====================================================================
# CONSTRUCTION DU JSON
# =====================================================================
print("\nConstruction du JSON...")

resultat_jour = [
    {'d': jstr(r.jour_exploitation), 'a': r.activite,
     'cb': round(r.ca_brut), 'rm': round(r.remise), 'cn': round(r.ca_net),
     'qv': round(r.quantite_vendue), 'qo': round(r.quantite_offerte),
     'ae': round(r.achats_externes), 'op': round(r.opex), 'cx': round(r.capex),
     'mb': round(r.marge_brute), 're': round(r.resultat_exploitation),
     'rn': round(r.resultat_net)}
    for r in res.sort_values('jour_exploitation').itertuples()
]

vc = v.groupby(['jour_exploitation', 'Type', 'Categorie'], as_index=False).agg(
    q=('Qté', 'sum'), cn=('CAF', 'sum'), cb=('ca_brut_ligne', 'sum'), rm=('Remise', 'sum'))
ventes_categorie_jour = [
    {'d': jstr(r.jour_exploitation), 't': r.Type, 'c': r.Categorie,
     'q': round(r.q), 'cn': round(r.cn), 'cb': round(r.cb), 'rm': round(r.rm)}
    for r in vc.itertuples()
]

articles = [
    {'t': r.Type, 'c': r.Categorie, 'a': r.Articles, 'q': round(r.q),
     'cn': round(r.cn), 'cb': round(r.cb), 'rm': round(r.rm), 'nl': int(r.nl)}
    for r in art.itertuples()
]

hh = v.groupby(['jour_exploitation', 'h', 'ordre_nuit', 'Type'], as_index=False).agg(
    q=('Qté', 'sum'), cn=('CAF', 'sum'))
horaire_jour = [
    {'d': jstr(r.jour_exploitation), 'h': int(r.h), 'on': int(r.ordre_nuit),
     't': r.Type, 'q': round(r.q), 'cn': round(r.cn)}
    for r in hh.itertuples()
]

dj = dep.groupby(['jour_exploitation', 'nature', 'poste'], as_index=False)['montant'].sum()
depenses_jour = [
    {'d': jstr(r.jour_exploitation), 'n': r.nature, 'p': r.poste,
     'm': round(r.montant)}
    for r in dj.itertuples()
]

oj = off.groupby(['jour_exploitation', 'Caissier', 'Catégorie'], as_index=False).agg(
    q=('Quantité', 'sum'), val=('Val vente', 'sum'))
offerts_jour = [
    {'d': jstr(r['jour_exploitation']), 'c': r['Caissier'], 'cat': r['Catégorie'],
     'q': round(r['q']), 'v': round(r['val'])}
    for _, r in oj.iterrows()
]

oa = off.groupby(['Catégorie', 'Article'], as_index=False).agg(
    q=('Quantité', 'sum'), val=('Val vente', 'sum'))
offerts_article = [
    {'cat': r['Catégorie'], 'a': r['Article'], 'q': round(r['q']), 'v': round(r['val'])}
    for _, r in oa.sort_values('val', ascending=False).head(150).iterrows()
]

data = {
    'meta': {
        'genere_le': datetime.now().strftime('%Y-%m-%d %H:%M'),
        'periode_debut': jstr(v.jour_exploitation.min()),
        'periode_fin': jstr(v.jour_exploitation.max()),
        'jours_exploitation': int(v.jour_exploitation.nunique()),
        'donnees_figees': True,
        'source': "Exports POS TABOO du 26/08/2026 — jeu de donnees fige. "
                  "Regles metier : voir 20_extraction_v2.py.",
    },
    'totaux_pos': {
        'nb_panier': nb_panier, 'panier_moyen': panier_moyen,
        'nombre_vendu': nombre_vendu, 'remise_pos': remise_pos,
        'total_offert': total_offert, 'ca_ht_hors_offert': ca_ht_hors_offert,
        'ca_offert': ca_offert,
    },
    'pareto': {'n_articles_80pct': n80, 'n_articles_total': len(art)},
    'inventaire_meta': {'comptage_saisi': inventaire_compte,
                        'n_sous_alerte': n_alerte,
                        'valeur_stock': round(val_stock) if pd.notna(val_stock) else None},
    'resultat_jour': resultat_jour,
    'ventes_categorie_jour': ventes_categorie_jour,
    'articles': articles,
    'horaire_jour': horaire_jour,
    'depenses_jour': depenses_jour,
    'offerts_jour': offerts_jour,
    'offerts_article': offerts_article,
    'couts_articles': couts_articles,
    'inventaire': inventaire,
    'reglements': regl.to_dict('records'),
    'panier_horaire': ph[['heure', 'heure_debut', 'ordre_nuit', 'ca', 'ventes',
                          'vendeurs', 'panier_moyen']].to_dict('records'),
    'caissiers': cai.to_dict('records') if len(cai) else [],
    'reconciliation': reconciliation,
    'alertes_qualite': _alertes,
}


def nettoyer_nan(o):
    """Remplace NaN/Inf par None. json.dump ecrit NaN comme un token litteral,
    valide en Python mais INVALIDE en JSON strict : JSON.parse() le rejette et
    arrete tout le script du navigateur. Deja survenu deux fois sur ce projet."""
    if isinstance(o, float) and (o != o or o in (float('inf'), float('-inf'))):
        return None
    if isinstance(o, dict):
        return {k: nettoyer_nan(x) for k, x in o.items()}
    if isinstance(o, list):
        return [nettoyer_nan(x) for x in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return nettoyer_nan(float(o))
    if isinstance(o, (np.bool_,)):
        return bool(o)
    return o


data = nettoyer_nan(data)
out = BASE / 'data_v2.json'
with open(out, 'w', encoding='utf-8') as f:
    # allow_nan=False : echoue franchement plutot que d'ecrire un JSON invalide.
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'), allow_nan=False)

print(f"\n{'=' * 70}")
print(f"data_v2.json ecrit : {out.stat().st_size/1024:.0f} Ko")
for k, val in data.items():
    if isinstance(val, list):
        print(f"  {k:<24} {len(val):>7,} lignes")
if _alertes:
    print("\nALERTES QUALITE reportees dans le dashboard :")
    for a in _alertes:
        print(f"  - {a}")
print("=" * 70)
