# supreme-meme — Tableau de bord TABOO

Tableau de bord de direction pour **TABOO** (restaurant · lounge · bar, Lomé),
et la couche de service serverless qui l'alimente depuis BigQuery.

Alternative propriétaire à Looker Studio : les métriques sont définies une seule
fois dans un registre déclaratif, et l'interface ne fait que lire un instantané
pré-calculé.

Le dépôt contient la mécanique, pas les résultats : ni montants, ni taux de
marge, ni identifiants d'infrastructure.

> **Vous reprenez le projet ?** Commencer par [GUIDE_DE_REPRISE.md](GUIDE_DE_REPRISE.md) :
> accès, préparation d'un poste, mise à jour mensuelle pas à pas, pannes fréquentes.

> **Ce dépôt ne contient aucune donnée d'exploitation.** Les instantanés, les
> exports POS et les tableaux de bord assemblés — qui embarquent le compte de
> résultat complet — sont exclus par `.gitignore`. Voir « Données » plus bas.

---

## Les deux versions

### 1. Version autonome (`dashboard_v2.html`)

Un fichier HTML unique, données embarquées, aucune dépendance locale. C'est la
version validée par la direction. Jeu de données figé : exports POS du
26/08/2026, période du 19/04/2023 au 23/08/2026 (1 206 nuits d'exploitation).

```bash
python 21_extraction_taboo.py # exports CSV -> data_v2.json
python assembleur.py          # -> taboo-vercel/index.html et amnesia.html
```

### 2. Couche serverless (`taboo-serverless/`)

Lit BigQuery, publie un instantané versionné sur GCS, servi par CDN. Voir
[taboo-serverless/DEPLOIEMENT.md](taboo-serverless/DEPLOIEMENT.md).

```
GCS (exports POS) → BigLake → analytics → vues reporting
                                   ├─ job Cloud Run 1×/jour → instantané GCS
                                   └─ service Cloud Run → détail ligne à ligne
```

**Pourquoi un instantané et non des requêtes à la demande.** Le jeu de reporting
entier pèse quelques mégaoctets : 3 586 lignes au grain jour × activité, 274
articles. BigQuery est un moteur de scan facturé à l'octet, avec 200 ms à 2 s de
latence — le faire répondre à chaque changement de filtre revient à payer et
attendre pour rejouer le même calcul. Mesuré : coquille de 150 Ko, instantané
chargé en 89–121 ms, coût BigQuery nul par utilisateur.

---

## Reprendre le projet

Le site ne dépend d'aucun poste. Le **code** est ici et Vercel le reconstruit à
chaque push sur `main`. Les **chiffres** sont publiés à part, dans la base Neon,
depuis n'importe quel poste qui dispose des exports de caisse.

```
exports de caisse (CSV)  ──>  extraction  ──>  découpage  ──>  60_publier_donnees.py  ──>  Neon
                                                                                             │
GitHub (main)  ──>  Vercel construit les coquilles  ──>  api/donnees.js lit Neon  <──────────┘
```

### Les accès à transmettre

| Service | Ce qu'il porte | Comment donner l'accès |
|---|---|---|
| GitHub `NQadmin228/supreme-meme` | le code | collaborateur du dépôt |
| Vercel, projet `taboo-vercel` | le site, ses variables | membre de l'équipe Vercel |
| Neon | comptes, journal, jeux de données | membre du projet Neon |

### Préparer un poste

```bash
pip install openpyxl "psycopg[binary]"
cp sources.example.env sources.env       # puis renseigner les chemins
```

Ni pandas ni numpy : l'extraction TABOO tourne en Python standard, y compris
sur un poste dont la stratégie de sécurité bloque les bibliothèques compilées.

Puis créer `taboo-vercel/.env.local` avec une ligne
`DATABASE_URL_UNPOOLED=…` : la chaîne de connexion **directe** de Neon, celle
sans `-pooler` (console Neon → *Connect*). Ni ce fichier ni `sources.env` ne
sont versionnés : `sources.env` dit où sont les exports **sur ce poste**. Les
exports de caisse sont retrouvés par la partie stable de leur nom : on peut
déposer un nouvel export sans toucher au code, à condition de retirer l'ancien
du dossier.

### Mettre les chiffres à jour

```bash
python 21_extraction_taboo.py && python 22_decouper.py                  # TABOO
python 41_controle_achats.py                                            # contrôle de gestion
python 30_extraction_amnesia.py && python 32_extraction_mensuel_amnesia.py
python 33_couts_amnesia.py && python 31_decouper_amnesia.py             # AMNESIA
python 60_publier_donnees.py --essai                                    # vérifier
python 60_publier_donnees.py                                            # publier
```

`41_controle_achats.py` passe **après** le découpage et **avant** la
publication : il lit `data_v2.json` et dépose `controle_achats.json`, le jeu du
bas de la page « Achats matière », dans le dossier que `60` publie.

**Un nouveau mois TABOO** : déposer le dossier du « Rapport mensuel » de la
caisse (journal de vente, journal CAF, états des dépenses, des règlements, par
famille) comme sous-dossier de `TABOO_RAPPORTS_MENSUELS`, mettre à jour
`TABOO_Analyses mensuelles.xlsx`, puis relancer la chaîne. L'extraction refuse
un mois qui recouvre des jours déjà chargés, et signale les jours manquants.

**L'analyse mensuelle fait foi.** Le livre de dépenses est lu dans son onglet
`Détail_Dépenses`, et chaque mois de caisse lui est rapproché : CA, vérificateur
de l'analyse (« Différentiel cash », qui doit valoir 0), sorties de caisse face au
livre. Les espèces ne se comparent pas jour par jour : l'analyse déduit le cash du
CA, la caisse date chaque paiement au jour où il est réglé. Les écarts figurent sur
la page « Qualité des données », en bas de la page « Achats matière » et, jour par
jour, dans l'onglet `Rapprochement_caisse` du classeur du contrôle de gestion.

`python 21_extraction_taboo.py --comme-v2` ignore rapports mensuels et classeur :
sur l'export du 26/08/2026, il redonne exactement la sortie de l'ancienne
extraction pandas (`20_extraction_v2.py`, conservée comme référence). C'est le
test de non-régression de la chaîne.

La publication est visible au rechargement suivant de la page : aucun
déploiement n'est nécessaire. Le branchement initial de Vercel sur le dépôt est
décrit dans [taboo-vercel/LISEZ-MOI.md](taboo-vercel/LISEZ-MOI.md), étape 5.

---

## Les 14 pages

| Page | Contenu |
|---|---|
| Synthèse | 4 chiffres clés, cascade du résultat, les 3 constats à retenir |
| Compte de résultat | Cascade détaillée, composition mensuelle, par activité |
| Explorer les ventes | Activité, puis famille, puis produit, au clic |
| Ventes & locomotives | Courbe de concentration, catalogue des 274 articles triable |
| Profil de la nuit | CA par tranche horaire, carte de chaleur jour × heure |
| Règlements & créances | Espèces / mobile / carte / crédit |
| Marge par activité | Marge réelle et coût matière face à la norme |
| Coût de revient | Marge théorique par recette contre marge réelle |
| Dépenses | Postes, natures, évolution mensuelle |
| Achats matière | Gaz, EAT, DRINK, glaçons, SMOKE : montant, rythme d'achat, proportion aux ventes |
| Remises & offerts | Coût total de l'effort commercial |
| Stock & inventaire | Stock théorique, seuils d'alerte, valorisation |
| Performance caisse | Comparaison entre caissiers |
| Qualité des données | Réconciliation et limites assumées |

---

## Principes de conception

**Aucun ratio n'est stocké.** Un taux figé au grain mensuel, filtré sur dix
jours, renvoie la moyenne des taux mensuels et non le taux des dix jours — un
chiffre faux mais crédible. Le type `Ratio` du registre ne comporte qu'un
numérateur et un dénominateur : il n'existe aucun champ où ranger un taux
pré-calculé. Tous les pourcentages sont recalculés en `somme ÷ somme`.

**Jamais deux échelles Y sur un même graphique.** Le CA et le taux de marge sont
deux graphiques distincts.

**Les couleurs de série sont validées, pas choisies.** DRINK `#199e70` · EAT
`#d95926` · SMOKE `#9085e9`, sur le fond de marque `#002A33`, en mode toutes
paires : CVD 9,4 · normal 24,6 · tritan 9,4. Le triplet initial échouait — 5,7
en séparation tritan, un daltonien tritan ne distinguait pas DRINK de EAT.

**Chaque graphique a une vue tableau.** L'identité d'une série ne repose jamais
sur la couleur seule.

**Les invariants bloquent la publication.** Six contrôles structurels, vrais
pour tout export et non pour un export donné. Si l'un échoue, rien n'est publié
et l'instantané précédent reste servi. Mieux vaut un tableau de bord périmé
qu'un tableau de bord faux.

**La journée d'exploitation va de 14h00 à 13h59.** L'essentiel du CA se réalise
entre 22h et 6h : découper aux minuits calendaires couperait chaque soirée en
deux et fausserait tous les totaux journaliers.

---

## Arborescence

```
21_extraction_taboo.py         exports + rapports mensuels -> data_v2.json (sans pandas)
20_extraction_v2.py            ancienne extraction pandas, gardée comme référence
assembleur.py                  assemblage des coquilles (TABOO + AMNESIA)
dashboard_v2_template.html     coquille, styles, socle JS
dashboard_v2_pages.html        balisage des 14 pages
dashboard_v2_render.js         logique de rendu
LISEZ-MOI_v2.md                notes de la version autonome
40_feuille_achats.py           nomenclature -> feuille de saisie des achats par article
41_controle_achats.py          caisse -> classeur du contrôle de gestion + rapprochement
60_publier_donnees.py          taboo-vercel/donnees/ -> table jeu_donnees (Neon)
serveur_local.py               le site sur ce poste, sans Vercel ni Neon (fausse session)
GUIDE_DE_REPRISE.md            par où commencer quand on reprend le projet
sources.py                     chemins des fichiers sources, lus dans sources.env
sources.example.env            modèle de sources.env, à copier sur chaque poste

taboo-serverless/
  config.example.env                à copier en config.env (non versionné)
  valeurs_controle.example.json     totaux attendus, pour vérification humaine
  sql/instancier.py                 résout les placeholders depuis config.env
  sql/12_fix_v_resultat_jour.sql    correctif du LEFT JOIN — bloquant
  sql/13_ddl_sources_manquantes.sql coûts, inventaire, totaux POS
  sql/14_optimisation_couts.sql     vues matérialisées et audit de coût
  semantique/registre.py            LA couche sémantique. Source unique.
  snapshot_builder/                 job : registre -> BigQuery -> GCS
  query_api/                        service de détail + garde-fous
  web/                              front, chargement de l'instantané
  infra/                            Terraform
  DEPLOIEMENT.md                    procédure complète
```

La première version de la chaîne (`13_extraction_donnees.py`, `14_assembler.py`
et ses trois fichiers de rendu) est conservée hors du dépôt : supersédée, et
elle portait des montants figés dans des `assert` ainsi qu'un prénom de caissier
dans un commentaire.

---

## Instanciation

Les fichiers SQL portent des placeholders (`VOTRE_PROJET_GCP`,
`VOTRE_BUCKET_SOURCES`) plutôt que des identifiants en dur. Ce n'est pas
seulement une précaution pour un dépôt public : c'est ce qui rend la chaîne
réutilisable pour un autre établissement.

```bash
cd taboo-serverless
cp config.example.env config.env      # puis renseigner
python sql/instancier.py              # -> sql/*.instancie.sql
```

Le registre lit `BQ_PROJET` et `BQ_REGION` dans l'environnement. Sans eux, le
SQL généré porte le placeholder — ce qui échoue franchement plutôt que de viser
un projet inattendu.

---

## Données

Rien de ce qui contient des chiffres réels n'est versionné. Pour reconstruire,
il faut disposer des exports POS et des référentiels :

| Fichier | Source |
|---|---|
| `Journal_Vente*.csv` | export POS, journal de vente détaillé |
| `Balance par catégorie*.csv` | export POS — source de vérité remise |
| `Articles offerts*.csv`, `Balance par règlement*.csv` | exports POS |
| `Balance par utilisateur*.csv`, `Panier moyen horaire*.csv` | exports POS |
| `Chiffre d'affaire globale*.csv`, `INVENTAIRE*.csv` | exports POS |
| `Depenses TABOO*.csv` | saisie manuelle de l'établissement |
| `couts_de_revient.csv` | fiches techniques |
| `Rapport mensuel … 9-2026.csv` | rapports mensuels de la caisse, un dossier par mois |
| `TABOO_Analyses mensuelles.xlsx` | classeur du contrôle de gestion — fait foi (livre de dépenses, CA et encaissements du mois) |
| `TABOO_Nomenclature_et_fiches_composition.xlsx` | catalogue des achats, lu par `40_feuille_achats.py` |

---

## Limites connues

À annoncer avant toute présentation — elles bornent ce que le tableau de bord
peut affirmer.

- **Aucune donnée RH.** Le résultat net calculé est **avant charges de
  personnel**. C'est la limite la plus importante.
- **Aucun identifiant de ticket** dans le journal de vente : pas de ticket moyen
  au jour, seulement le total POS de la période.
- **Le rapport des règlements n'a pas de date** : impossible de suivre la
  progression du mobile money.
- **Aucun comptage physique d'inventaire.** L'écart affiché par le POS n'est
  donc pas une démarque, c'est l'absence de comptage.
- **Le Journal CAF est écarté** : rupture de collecte côté POS depuis octobre
  2024, il sous-évalue la remise de 90 à 99 %.

Trois écarts entre rapports POS sont connus, expliqués et stables. Un écart
connu et stable n'est pas une erreur ; sa *variation* serait un signal. La page
« Qualité des données » les expose plutôt que de les taire.

---

## Développement

```bash
cd taboo-serverless
python semantique/registre.py                    # valide et émet le registre
python snapshot_builder/main.py --dry-run        # SQL généré, sans BigQuery
python sql/instancier.py --verifier              # placeholders restants
cd web && python build.py --demo ../../data_v2.json
python -m http.server 8770 --directory dist
```

La validation du registre refuse un `SELECT *` : BigQuery facture les colonnes
scannées, et la règle est trop facile à oublier pour reposer sur la relecture.
