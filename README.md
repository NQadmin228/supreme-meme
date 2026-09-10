# supreme-meme — Tableau de bord TABOO

Tableau de bord de direction pour **TABOO** (restaurant · lounge · bar, Lomé),
et la couche de service serverless qui l'alimente depuis BigQuery.

Alternative propriétaire à Looker Studio : les métriques sont définies une seule
fois dans un registre déclaratif, et l'interface ne fait que lire un instantané
pré-calculé.

Le dépôt contient la mécanique, pas les résultats : ni montants, ni taux de
marge, ni identifiants d'infrastructure.

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
python 20_extraction_v2.py   # exports CSV -> data_v2.json
python 21_assembler_v2.py    # -> dashboard_v2.html
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

## Les 12 pages

| Page | Contenu |
|---|---|
| Synthèse | 4 chiffres clés, cascade du résultat, les 3 constats à retenir |
| Compte de résultat | Cascade détaillée, composition mensuelle, par activité |
| Ventes & locomotives | Courbe de concentration, catalogue des 274 articles triable |
| Profil de la nuit | CA par tranche horaire, carte de chaleur jour × heure |
| Règlements & créances | Espèces / mobile / carte / crédit |
| Marge par activité | Marge réelle et coût matière face à la norme |
| Coût de revient | Marge théorique par recette contre marge réelle |
| Dépenses | Postes, natures, évolution mensuelle |
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
20_extraction_v2.py            exports CSV -> data_v2.json
21_assembler_v2.py             assemblage de la version autonome
dashboard_v2_template.html     coquille, styles, socle JS
dashboard_v2_pages.html        balisage des 12 pages
dashboard_v2_render.js         logique de rendu
LISEZ-MOI_v2.md                notes de la version autonome

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
