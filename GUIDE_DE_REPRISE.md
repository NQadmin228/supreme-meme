# Guide de reprise — tableau de bord TABOO / AMNESIA

À lire en premier par toute personne qui reprend le projet. Ce guide dit **comment
le projet fonctionne aujourd'hui, comment le faire tourner chaque mois, et où
regarder quand quelque chose ne va pas**. Le détail de chaque mécanisme est dans
les documents et les scripts cités ; ce guide ne les recopie pas, il y mène.

> **Le dépôt GitHub est public.** Il ne contient aucun chiffre, aucun mot de
> passe, aucune chaîne de connexion — et ne doit jamais en contenir. Voir
> [Les règles du dépôt](#8-les-règles-du-dépôt).

---

## Sommaire

1. [Le projet en une page](#1-le-projet-en-une-page)
2. [Les accès à obtenir](#2-les-accès-à-obtenir)
3. [Préparer un poste](#3-préparer-un-poste)
4. [La chaîne de données](#4-la-chaîne-de-données)
5. [La mise à jour mensuelle, pas à pas](#5-la-mise-à-jour-mensuelle-pas-à-pas)
6. [Le classeur du contrôle de gestion](#6-le-classeur-du-contrôle-de-gestion)
7. [Le site : modifier, tester, déployer](#7-le-site--modifier-tester-déployer)
8. [Les règles du dépôt](#8-les-règles-du-dépôt)
9. [Les règles métier à connaître](#9-les-règles-métier-à-connaître)
10. [Pannes fréquentes](#10-pannes-fréquentes)
11. [Où trouver le détail](#11-où-trouver-le-détail)

---

## 1. Le projet en une page

Un **tableau de bord de direction** pour deux établissements de Lomé :

| | Nature | Source des ventes | Source des charges |
|---|---|---|---|
| **TABOO** | restaurant · lounge · bar | exports et rapports mensuels du logiciel de caisse | `TABOO_Analyses mensuelles.xlsx` (livre de dépenses) |
| **AMNESIA** | nightclub & rooftop | exports Infogest (CSV) | classeur de suivi mensuel d'AMNESIA |

Trois morceaux, trois endroits :

```
  CODE       GitHub  NQadmin228/supreme-meme (public)
               │  chaque push sur main
               ▼
  SITE       Vercel, projet taboo-vercel ──── construit les pages (assembleur.py)
               │  à chaque affichage
               ▼
  CHIFFRES   Neon (Postgres), table jeu_donnees ◄── 60_publier_donnees.py, depuis un poste
  COMPTES    Neon, tables des comptes et du journal de connexion
```

- **Le code** ne contient aucune donnée. Pousser sur `main` reconstruit le site.
- **Les chiffres** sont calculés sur un poste qui a les fichiers sources, puis
  publiés dans Neon. Publier ne demande **aucun déploiement** : c'est visible au
  rechargement de la page.
- **L'accès** se fait par comptes nominatifs (identifiant + mot de passe),
  gérés dans la page `/admin` du site. Chaque compte a accès à un ou deux
  établissements.

**Ce qui n'est pas en service.** Le dossier `taboo-serverless/` (BigQuery, GCS,
Cloud Run, Terraform) est une architecture étudiée et documentée, mais **le site
actuel ne l'utilise pas**. `20_extraction_v2.py` (pandas) n'est gardé que comme
référence de non-régression ; l'extraction en service est `21_extraction_taboo.py`.

---

## 2. Les accès à obtenir

| Service | Ce qu'il porte | Qui le donne |
|---|---|---|
| GitHub `NQadmin228/supreme-meme` | le code | un propriétaire du dépôt (collaborateur) |
| Vercel, projet `taboo-vercel` | le site, ses variables d'environnement | un membre de l'équipe Vercel |
| Neon | chiffres, comptes, journal | un membre du projet Neon |
| Compte sur le site | lire le tableau de bord, administrer | un administrateur, page `/admin` |
| Dossiers sources | exports de caisse, classeurs Excel | l'établissement / le contrôle de gestion |

L'adresse du site se communique à part : elle ne figure pas dans le dépôt.

**Les secrets ne vivent que dans trois endroits**, jamais dans un fichier versionné :

| Secret | Où |
|---|---|
| `DATABASE_URL`, `ACCES_SECRET`, `ACCES_VERSION` | variables d'environnement Vercel |
| `DATABASE_URL_UNPOOLED` (chaîne Neon **sans** `-pooler`) | `taboo-vercel/.env.local` sur le poste qui publie |
| Chemins des fichiers sources | `sources.env` à la racine, sur chaque poste |

---

## 3. Préparer un poste

Windows ou autre. Le poste du contrôle de gestion bloque les bibliothèques
compilées (numpy, donc pandas) : **toute la chaîne tourne sans pandas.**

```bash
pip install openpyxl "psycopg[binary]"
cp sources.example.env sources.env        # puis renseigner chaque chemin
```

1. **`sources.env`** : copier `sources.example.env` et remplir les chemins
   (absolus, ou relatifs au dossier du dépôt). Chaque variable y est commentée.
2. **`taboo-vercel/.env.local`** : une ligne
   `DATABASE_URL_UNPOOLED=postgresql://…` (console Neon → *Connect*, chaîne
   **directe**, sans `-pooler`). Nécessaire seulement pour publier.
3. **Node.js** : seulement pour administrer la base en ligne de commande
   (`taboo-vercel/base/init.mjs`). Pas nécessaire pour la routine mensuelle.
4. **Excel** : facultatif. Utile pour ouvrir les classeurs et vérifier qu'ils
   se recalculent sans erreur.

Pour vérifier que le poste est prêt, lancer la première étape de la chaîne :

```bash
python 21_extraction_taboo.py
```

S'il manque un chemin, le script s'arrête et dit lequel, et où le renseigner
(« Chemin non configure : … », « fichier introuvable »). Il n'écrit que
`data_v2.json`, sur le poste : rien ne part en ligne.

---

## 4. La chaîne de données

### TABOO

```
exports de caisse (CSV) ─┐
rapports mensuels (CSV) ─┼─► 21_extraction_taboo.py ──► data_v2.json
analyse mensuelle (xlsx) ┘                                   │
                                                             ▼
                                          22_decouper.py ──► taboo-vercel/donnees/taboo/
                                                             │    socle.json + 5 jeux lourds
                                                             ▼
classeur du contrôle de gestion ◄──────► 41_controle_achats.py ──► …/taboo/controle_achats.json
                                                             │
                                                             ▼
                                          60_publier_donnees.py ──► Neon (jeu_donnees)
```

### AMNESIA

```
exports Infogest (CSV) ──► 30_extraction_amnesia.py ──► data_amnesia.json
classeur mensuel (xlsx) ─► 32_extraction_mensuel_amnesia.py ──► data_mensuel_amnesia.json
coûts de revient (CSV) ──► 33_couts_amnesia.py ──► data_couts_amnesia.json
                           31_decouper_amnesia.py ──► taboo-vercel/donnees/amnesia/
                           60_publier_donnees.py ──► Neon
```

### Les scripts

| Script | Lit | Produit |
|---|---|---|
| `21_extraction_taboo.py` | `TABOO_EXPORTS_POS`, `TABOO_RAPPORTS_MENSUELS`, `TABOO_ANALYSE_MENSUELLE` (à défaut `TABOO_DEPENSES`), `COUTS_DE_REVIENT` | `data_v2.json` |
| `22_decouper.py` | `data_v2.json` | `taboo-vercel/donnees/taboo/*.json` (garde `controle_achats.json`) |
| `41_controle_achats.py` | rapports mensuels, analyse mensuelle, `data_v2.json`, `TABOO_CLASSEUR_MP` | le classeur du contrôle de gestion + `controle_achats.json` |
| `40_feuille_achats.py` | `TABOO_NOMENCLATURE` | `TABOO_Saisie_achats.xlsx` (par défaut à la racine du dépôt, `--sortie` pour ailleurs), feuille de saisie des achats par article |
| `30`, `32`, `33`, `31` | sources AMNESIA | `taboo-vercel/donnees/amnesia/*.json` |
| `60_publier_donnees.py` | `taboo-vercel/donnees/<établissement>/*.json` | table `jeu_donnees` de Neon |
| `assembleur.py` | gabarit, pages, rendu, logos | `taboo-vercel/index.html`, `amnesia.html` (lancé par Vercel) |
| `sources.py` | `sources.env` | les chemins, pour tous les scripts |

Chaque script commence par un long commentaire qui dit **pourquoi** il fait ce
qu'il fait. C'est la documentation de référence : le lire avant de modifier.

**Les fichiers produits ne sont jamais versionnés** (`data_*.json`,
`taboo-vercel/donnees/`, `index.html`, `amnesia.html`, tous les `.xlsx`).

---

## 5. La mise à jour mensuelle, pas à pas

### TABOO — un nouveau mois

1. **Déposer le rapport mensuel de caisse** (journal de vente, journal CAF,
   états des dépenses et des règlements, par famille) dans un **sous-dossier
   du mois** sous `TABOO_RAPPORTS_MENSUELS`.
2. **S'assurer que `TABOO_Analyses mensuelles.xlsx` est à jour** : onglet du
   mois (« OCTOBRE 26 »…) rempli, livre `Détail_Dépenses` saisi, et le
   vérificateur « Différentiel cash » à 0. **Fermer les classeurs dans Excel**
   avant de lancer les scripts.
3. **Lancer la chaîne, dans cet ordre** :

   ```bash
   python 21_extraction_taboo.py        # extraction
   python 22_decouper.py                # découpage pour le site
   python 41_controle_achats.py         # classeur du contrôle de gestion + jeu du contrôle
   python 60_publier_donnees.py --essai # vérifie, n'écrit rien
   python 60_publier_donnees.py taboo   # publie dans Neon
   ```

   **41 doit passer après 22 et avant 60** : il lit `data_v2.json` et dépose
   `controle_achats.json` dans le dossier que 60 publie.
4. **Lire ce que chaque script affiche.** Les scripts s'arrêtent d'eux-mêmes
   sur une incohérence (« INCOHERENCE : … Arret ») plutôt que de publier un
   chiffre faux. Un arrêt n'est pas un bug à contourner : c'est une donnée à
   corriger à la source.
5. **Vérifier en ligne** : recharger le site (Ctrl+F5), contrôler la période
   affichée en bas de page (« Période … → … · données extraites le … »), la
   page « Qualité des données » et le bas de la page « Achats matière ».

### AMNESIA

```bash
python 30_extraction_amnesia.py
python 32_extraction_mensuel_amnesia.py
python 33_couts_amnesia.py
python 31_decouper_amnesia.py
python 60_publier_donnees.py amnesia
```

### Ce que garantit la publication

`60_publier_donnees.py` publie **tous les jeux d'un établissement dans une
seule transaction** : un lecteur voit l'ancienne publication ou la nouvelle,
jamais un mélange. Un jeu absent du dossier local est **retiré** de la base. Il
refuse tout JSON invalide, l'absence de `socle.json`, et tout jeu de plus de
4 Mo (limite d'une fonction Vercel). Après écriture, il relit la base et compare
les empreintes.

---

## 6. Le classeur du contrôle de gestion

`TABOO_MP_prix_unitaires_et_recettes.xlsx` (variable `TABOO_CLASSEUR_MP`) est
tenu par le contrôle de gestion et **complété** par `41_controle_achats.py`.

| Onglet | Qui l'écrit | À savoir |
|---|---|---|
| Achats, Recettes, Fiches_cout, Parametres | le contrôle de gestion | nomenclature, prix de référence, fiches de coût ; le script n'y touche pas |
| **Correspondance_caisse** | le script, puis le contrôle de gestion | chaque compte de sortie de caisse → statut, article, poste. **Les colonnes bleues (D à G) se corrigent ici** ; le script relit ces choix à chaque passage et ne les écrase jamais |
| **Journal_achats** | le script ajoute, le contrôle de gestion complète | une ligne par sortie de caisse rattachée à un article. **Saisir la quantité (colonne D)** pour obtenir le prix unitaire payé. Rejouable : une sortie déjà présente n'est jamais ajoutée deux fois |
| Suivi_MP | le script | mois de départ, CA du mois par activité |
| Rapprochement_caisse | le script (recréé à chaque passage) | la caisse face à l'analyse mensuelle, jour par jour |

**Deux protections à connaître :**

- **Rien ne se perd à l'enregistrement.** Excel range dans des extensions
  « x14 » les validations et mises en forme qui pointent vers un autre onglet
  (listes d'articles, seuils de `Parametres`). openpyxl ne sait pas les relire.
  Le script les reporte, recompte tout, et **refuse de remplacer le classeur**
  s'il manquerait quelque chose (« Classeur non modifié : … »). Si une nouvelle
  sorte d'extension apparaît, il refuse aussi et dit laquelle.
- **Le classeur doit être fermé** dans Excel pendant le passage du script.

Ce que le site en montre (bas de la page « Achats matière ») vient de
`controle_achats.json`, construit à partir du classeur **après** corrections :
une quantité saisie ou un rattachement corrigé apparaît sur le site au passage
suivant de 41 puis de 60.

`40_feuille_achats.py` produit un autre fichier, `TABOO_Saisie_achats.xlsx` :
une feuille de saisie des achats article par article, y compris ceux qui ne
passent pas par le tiroir de caisse, avec un contrôle face au livre de dépenses.

---

## 7. Le site : modifier, tester, déployer

### Comment il est construit

| Fichier | Rôle |
|---|---|
| `dashboard_v2_template.html` | le châssis commun aux deux établissements : styles, graphiques, tableaux, filtres de période, chargement paresseux |
| `dashboard_v2_pages.html` / `amnesia_pages.html` | le balisage HTML des pages |
| `dashboard_v2_render.js` / `amnesia_render.js` | les fonctions `RENDER['<page>']` qui calculent et dessinent |
| `taboo_nav.js` / `amnesia_nav.js` | le menu, les titres, et `BESOINS` : quels jeux lourds charger pour quelle page |
| `chargement.js` | récupère le socle et démarre la page |
| `assembleur.py` | assemble tout en `index.html` et `amnesia.html` ; Vercel le lance à chaque construction |
| `taboo-vercel/api/`, `lib/`, `middleware.js` | connexion, sessions, droits par établissement, service des jeux depuis Neon |

Une page ne lit que des **jeux de données** : `socle.json` au démarrage, puis
les jeux lourds listés dans `BESOINS` quand on ouvre la page. Un jeu facultatif
(comme `controle_achats`) se charge à part, pour que son absence ne bloque pas
la page.

### Modifier une page

1. Le balisage dans `*_pages.html`, le calcul dans `*_render.js`.
2. **Aucun ratio stocké** : on additionne des montants, on divise à l'affichage
   (voir § 9).
3. Chaque graphique a sa vue tableau ; une série ne se distingue jamais par la
   couleur seule.

### Tester en local, sans Vercel ni Neon

```bash
python assembleur.py taboo                    # ou sans argument : les deux
python serveur_local.py                       # http://127.0.0.1:8111
```

`serveur_local.py` sert `taboo-vercel/` avec une **fausse session**
administrateur et les jeux du dossier local `taboo-vercel/donnees/`. Il n'écoute
que sur la machine elle-même. Il faut donc avoir lancé la chaîne (§ 5) au moins
une fois sur ce poste. Ouvrir la console du navigateur : aucune erreur ne doit
s'y afficher.

### Déployer

`git push` sur `main` : Vercel reconstruit le site en une à deux minutes. Les
chiffres, eux, ne bougent qu'avec `60_publier_donnees.py`.

La configuration initiale de Vercel et Neon (variables, branchement Git,
premier administrateur, coupure d'accès d'urgence) est dans
[taboo-vercel/LISEZ-MOI.md](taboo-vercel/LISEZ-MOI.md).

---

## 8. Les règles du dépôt

- **Aucune donnée, jamais.** Ni montant, ni taux, ni nom de personne, ni
  identifiant d'infrastructure, ni chaîne de connexion. `.gitignore` exclut
  déjà `*.xlsx`, `*.csv`, `data_*.json`, `taboo-vercel/donnees/`,
  `sources.env`, `.env*`. **Relire `git diff --cached` avant chaque commit** :
  un commentaire de code ou un `assert` peut suffire à faire fuiter un chiffre.
- **Committer seulement les fichiers qu'on a modifiés.** Ne pas committer les
  fichiers produits (`index.html`, `amnesia.html`, jeux JSON).
- **Messages de commit** : en français **sans accents**, un titre qui est une
  phrase (« Le rapprochement suit le verificateur de l'analyse… »), puis un
  corps qui raconte le problème, la décision et ce qui a été vérifié. Voir
  `git log` pour le ton.
- **Les commentaires disent pourquoi**, pas ce que fait la ligne suivante. Les
  en-têtes de scripts sont la documentation : les tenir à jour avec le code.

---

## 9. Les règles métier à connaître

| Règle | Pourquoi |
|---|---|
| **La journée d'exploitation va de 14h00 à 13h59** | l'essentiel du CA se fait entre 22h et 6h ; couper à minuit couperait chaque soirée en deux |
| **Trois activités : EAT, DRINK, SMOKE** | achats DRINK = DRINK + MIAMI 228 + PICASSO + GLACONS ; EAT = EAT + GAZ ; SMOKE = SMOKE. OPEX et CAPEX ventilés au prorata du CA net du jour |
| **L'analyse mensuelle fait foi** | le livre de dépenses est lu dans son onglet `Détail_Dépenses` ; la caisse peut avoir été corrigée après coup. Le rapprochement montre les écarts, il ne corrige rien |
| **Le contrôle du cash est celui de l'analyse** | dans l'analyse, le CASH est **déduit** du CA (CA moins les autres moyens et les impayés) ; la caisse date chaque paiement au jour où il est réglé. Les espèces ne se comparent donc pas jour par jour. Le vérificateur de l'analyse, la colonne « Différentiel cash », doit valoir 0 |
| **La caisse ne voit que le tiroir** | les achats payés par virement ou mobile money n'apparaissent pas dans les sorties de caisse |
| **Aucun ratio n'est stocké** | un taux figé au mois, filtré sur dix jours, donnerait un chiffre faux mais crédible ; tout taux est recalculé en somme ÷ somme |
| **Les invariants bloquent la publication** | mieux vaut un tableau de bord périmé qu'un tableau de bord faux |
| **La remise vient de la Balance par catégorie** | le journal CAF a une rupture de collecte depuis octobre 2024 |
| **Un mois qui recouvre des jours déjà chargés est refusé** | un jour compté deux fois fausse tout sans rien signaler |

Les limites connues (pas de données RH, pas d'identifiant de ticket, pas de
comptage d'inventaire…) sont listées dans le [README](README.md#limites-connues) :
les annoncer avant toute présentation.

---

## 10. Pannes fréquentes

| Symptôme | Cause probable | Remède |
|---|---|---|
| Le site répond 503 | variables Vercel absentes, ou créées après le dernier déploiement | vérifier les trois variables, puis redéployer |
| « Données de cette page indisponibles » | jeu non publié, ou session expirée | `60_publier_donnees.py --essai` pour voir les jeux ; se reconnecter |
| Les chiffres ne bougent pas après publication | cache du navigateur | Ctrl+F5 ; l'en-tête HTTP `x-donnees-publiees` d'un fichier `/donnees/…` donne la date de publication |
| Le push ne change rien sur le site | le push ne porte que du code | normal : les chiffres se publient avec `60_publier_donnees.py` |
| `INCOHERENCE : … Arret` | une source contredit une autre | lire le message, corriger la source ; ne pas affaiblir l'invariant |
| « deux candidats » pour un export | deux exports du même rapport dans le dossier | ne garder que le bon |
| « Classeur non modifié : … » (41) | une extension Excel serait perdue, ou le classeur est ouvert | lire le message ; fermer Excel ; ne jamais contourner |
| `ModuleNotFoundError: pandas` | ancien script lancé | utiliser `21_extraction_taboo.py`, pas `20_extraction_v2.py` |
| Jeu refusé, « au-delà de 4,0 Mo » | un jeu a trop grossi | le découper davantage dans `22_decouper.py` |
| Plus personne ne peut se connecter | dernier administrateur perdu | `node base/init.mjs --admin <identifiant> --nom "<Nom>"` depuis `taboo-vercel/` (voir son LISEZ-MOI) |

---

## 11. Où trouver le détail

| Document | Contenu |
|---|---|
| [README.md](README.md) | présentation, les pages, principes de conception, sources, limites connues |
| [taboo-vercel/LISEZ-MOI.md](taboo-vercel/LISEZ-MOI.md) | installation Vercel + Neon, comptes, sécurité, vérifications avant diffusion |
| [sources.example.env](sources.example.env) | chaque fichier source, commenté |
| En-tête de chaque script `NN_*.py` | les règles et les raisons, au plus près du code |
| [LISEZ-MOI_v2.md](LISEZ-MOI_v2.md) | l'ancienne version autonome (un seul fichier HTML), pour mémoire |
| [taboo-serverless/DEPLOIEMENT.md](taboo-serverless/DEPLOIEMENT.md) | l'architecture BigQuery étudiée, non utilisée par le site actuel |
| `git log` | l'historique raisonné : chaque commit dit pourquoi |
