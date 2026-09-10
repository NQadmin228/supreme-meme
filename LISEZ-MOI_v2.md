# TABOO — Tableau de bord de direction (v2)

Jeu de données **figé** : exports POS du 26/08/2026, période du 19/04/2023 au
23/08/2026 (1 206 nuits d'exploitation).

## Le livrable

`dashboard_v2.html` — **5,2 Mo, un seul fichier, aucune dépendance locale.**
Données embarquées. À déposer tel quel sur l'hébergement ; aucune base, aucun
serveur applicatif, aucune configuration.

Chart.js et les polices sont chargés depuis un CDN : la page a besoin d'un accès
internet pour afficher les graphiques. C'est acceptable puisque le tableau de
bord est hébergé. **Si un jour il doit fonctionner hors ligne** (démo sans wifi,
clé USB), il faut embarquer Chart.js dans le fichier — sinon aucun graphique ne
s'affiche et le rendu de la page s'interrompt.

## Régénérer

```bash
python 20_extraction_v2.py   # sources CSV -> data_v2.json
python 21_assembler_v2.py    # -> dashboard_v2.html
```

Les fichiers `dashboard_v2_template.html`, `_pages.html` et `_render.js` ne
changent que pour modifier la mise en page ou les calculs.

L'extraction s'arrête d'elle-même si les données sont incohérentes — brut moins
remise différent du net, désaccord entre les deux rapports POS sur le CA net,
achats perdus dans la jointure. Mieux vaut pas de tableau de bord qu'un tableau
de bord faux.

## Les 12 pages

| Page | Contenu |
|---|---|
| Synthèse | Les 4 chiffres clés, la cascade du résultat, les 3 constats à retenir |
| Compte de résultat | Cascade détaillée, composition mensuelle, ventilation par activité |
| Ventes & locomotives | Courbe de concentration, top articles, catalogue des 274 articles triable |
| Profil de la nuit | CA par tranche horaire, panier moyen, carte de chaleur jour × heure |
| Règlements & créances | Espèces / mobile / carte / crédit |
| Marge par activité | Marge réelle et coût matière, confrontés à la norme |
| Coût de revient | **Nouveau** — marge théorique par recette contre marge réelle |
| Dépenses | Postes, natures, évolution mensuelle |
| Remises & offerts | Coût total de l'effort commercial |
| Stock & inventaire | **Nouveau** — stock théorique, seuils d'alerte, valorisation |
| Performance caisse | Comparaison entre caissiers |
| Qualité des données | **Nouveau** — réconciliation et limites assumées |

## Ce que la v2 ajoute

Trois sources présentes sur le disque n'étaient pas exploitées :

- `couts_de_revient.csv` — le « chantier 4 » que la couche BigQuery déclarait en
  attente. 78 produits appariés aux ventes, la couverture des couts du CA couvert. Débloque la
  marge théorique par recette.
- `INVENTAIRE*.csv` — stock théorique et seuils d'alerte.
- `Chiffre d'affaire globale*.csv` — nombre de paniers et panier moyen.
  Seule source du ticket moyen : le journal de vente n'a aucun identifiant de ticket.

Le catalogue d'articles passe de 100 à **274** (la v1 tronquait), et les trois
écarts de réconciliation documentés dans `06_reconciliation.sql` sont désormais
affichés au lieu d'être tacites.

## Les trois constats à porter devant la direction

**1. Le coût matière de la cuisine — le point dur.**
EAT dégage la marge reelle de EAT de marge brute : 79,3 % du CA part en achats, contre une norme
de 25 à 35 % en restauration. Les fiches techniques, elles, impliquent la marge theorique de
marge — **l'ecart mesure d'écart**.

Ce constat résiste à l'objection principale : recalculé sur les 19 recettes
*complètes* seulement (50,3 % du CA de EAT), la marge théorique est de **73,3 %**,
donc légèrement *supérieure*. L'écart ne vient pas de la qualité des fiches.

Quatre pistes, de la plus probable à la plus grave, dans cet ordre :
le poste d'achat EAT agrège `EAT` et `GAZ` (or le gaz sert à tout l'établissement) ·
décalage stock (un achat alimente plusieurs jours de vente) · les 39,7 % du CA de
EAT non chiffrés sont peut-être les moins margés · pertes réelles.
**La quatrième piste ne doit être avancée qu'après avoir écarté les trois autres,
chiffres en main.**

**2. L'effort commercial : l'effort commercial du CA potentiel.**
76,8 M F de remises et **174,2 M F d'articles offerts** (33 747 unités). Les
offerts pèsent 69,4 % de cet effort — c'est là qu'il faut regarder, pas sur les
remises. Cet effort représente 48 % de la marge brute. Ce qu'il rapporte en
fréquentation n'est pas mesurable : la donnée n'existe pas dans le POS.

**3. la part des especes des encaissements en espèces**, 6,1 % en mobile money, plus 50,3 M F
de ventes à crédit répartis sur 9 703 tickets. Risque de manipulation et faible
traçabilité. Les créances ne sont pas datées par le POS : ni âge de balance ni
taux de recouvrement calculables.

## Ce que le tableau de bord ne peut pas dire

À connaître **avant** la réunion — c'est là que les questions tombent.

- **Aucune donnée RH.** Le résultat net de 381,3 M F (le taux de resultat net) est **avant charges
  de personnel**. C'est la limite la plus importante à annoncer d'emblée.
- **Aucun identifiant de ticket** dans le journal de vente : pas de ticket moyen
  au jour, seulement le total POS de la période.
- **Le rapport des règlements n'a pas de date** : impossible de suivre si le
  mobile money progresse.
- **Aucun comptage physique d'inventaire** — la colonne est à zéro sur les 105
  articles. L'écart affiché par le POS n'est donc **pas une démarque**, c'est
  l'absence de comptage. Un premier inventaire saisi débloquerait démarque,
  rotation et valorisation d'un coup : c'est l'action à plus fort rendement.
- **Le Journal CAF est écarté** de la chaîne : rupture de collecte côté POS
  depuis octobre 2024, il sous-évalue la remise de 90 à 99 %. Anomalie de
  l'éditeur, à lui signaler.

Trois écarts entre rapports POS sont connus, expliqués et stables : CA global POS
contre balance par catégorie (15,5 M F, périmètres d'articles différents) ·
CA net contre règlements (34,7 M F, ventes à crédit et écarts d'encaissement) ·
remise Journal CAF contre balance (35,3 M F, la rupture de collecte). Un écart
connu et stable n'est pas une erreur ; sa *variation* serait un signal.

## Choix de conception

- **Aucun ratio n'est stocké dans les données.** Un taux figé au grain mensuel,
  filtré sur dix jours, renvoie la moyenne des taux mensuels et non le taux des
  dix jours — un chiffre faux mais crédible. Tous les pourcentages sont recalculés
  en somme ÷ somme sur la période affichée.
- **Jamais deux échelles Y sur un même graphique.** Le CA et le taux de marge
  sont deux graphiques distincts, jamais superposés.
- **Couleurs des activités validées, pas choisies à l'œil.**
  DRINK `#199e70` · EAT `#d95926` · SMOKE `#9085e9`, sur le fond `#12211F`.
  L'ancien triplet de la v1 échouait : séparation tritan de 5,7 seulement — un
  daltonien tritan ne distinguait pas DRINK de EAT. Le nouveau est à 9,4.
- **L'or de la marque reste un accent d'interface**, jamais une couleur de série.
- **Chaque graphique a une vue tableau** (« Voir les chiffres ») : l'identité
  d'une série ne repose jamais sur la couleur seule.
- **La journée d'exploitation va de 14h00 à 13h59.** la part de la nuit du CA se fait entre
  22h et 6h : découper aux minuits calendaires couperait chaque soirée en deux.

## Fichiers

    dashboard_v2.html            le livrable, autonome
    20_extraction_v2.py          sources CSV -> data_v2.json
    21_assembler_v2.py           assemblage du fichier final
    dashboard_v2_template.html   coquille, styles, socle JS
    dashboard_v2_pages.html      balisage des 12 pages
    dashboard_v2_render.js       logique de rendu
    data_v2.json                 données extraites (5,2 Mo)

Les fichiers `13_*`, `14_*`, `dashboard.html` et `dashboard_*` sans `v2` sont la
version 1, laissée intacte.
