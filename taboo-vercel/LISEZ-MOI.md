# Tableau de bord TABOO — hébergement Vercel gratuit, comptes nominatifs

Site statique sur Vercel, offre Hobby (gratuite), protégé par une vérification
côté serveur. Les comptes vivent dans une base Postgres Neon (offre gratuite).
Aucun nom de domaine requis.

## Pourquoi ce montage et pas la protection intégrée de Vercel

Sur l'offre gratuite, **aucun réglage Vercel ne peut donner au patron un accès
authentifié** :

- **Vercel Authentication** n'autorise que les membres de l'équipe, et l'offre
  Hobby est mono-utilisateur : le patron ne peut pas y être ajouté.
- **Password Protection** est une option payante, réservée aux offres Pro et
  Enterprise.

L'authentification vit donc dans le code. Le fichier reste un actif statique
servi par le CDN parce qu'une fonction Vercel ne peut pas renvoyer plus de
4,5 Mo. Le middleware ne transporte rien, il autorise.

## Ce qui a remplacé le mot de passe partagé

Avant : une variable `ACCES_MOTDEPASSE` connue de tout le monde, et des liens
personnels signés hors ligne. On ne savait pas qui entrait, et révoquer une
personne révoquait tout le monde — l'outil qui fabriquait ces liens le
reconnaissait lui-même en commentaire. Il a été supprimé avec ce mécanisme.

Maintenant : des comptes nominatifs, chacun son mot de passe, deux rôles
(`admin`, `lecteur`), un journal de toutes les connexions et de toutes les
actions d'administration. L'administrateur crée, réinitialise, désactive et
supprime depuis `/admin`, sans redéployer et sans toucher au code.

### Qui lit la base, et qui ne la lit pas

| Composant | Runtime | Interroge Postgres ? |
|---|---|---|
| `middleware.js` | Edge | **non** — vérifie la signature du cookie |
| `api/connexion.js` | Node | oui, une fois à la connexion |
| `api/session.js` | Node | oui, sur action |
| `api/admin.js` | Node | oui, sur action |
| `index.html`, `admin.html` | CDN | non |

Le middleware s'exécute sur **chaque** requête. Un aller-retour SQL par requête
se paierait sur chaque image, chaque script, chaque rechargement. Il vérifie donc
une signature HMAC et rien d'autre.

**Ce que ce choix coûte, précisément** : un compte désactivé, ou dont le mot de
passe vient d'être changé, garde le droit de **lire** la page jusqu'à
l'expiration de son cookie. D'où la durée de session ramenée de 7 jours à
**12 heures**. Il perd en revanche le droit d'**agir** immédiatement, parce que
les fonctions, elles, consultent la base (`lib/garde.js`). Pour couper tout le
monde sur-le-champ, il reste `ACCES_VERSION`.

---

## Installation

### 1. La base Neon

Créer un projet sur [neon.com](https://neon.com) (offre gratuite) et récupérer
la chaîne de connexion. Elle va dans `taboo-vercel/.env.local`, qui n'est jamais
versionné :

```
DATABASE_URL="postgresql://…-pooler.…neon.tech/neondb?sslmode=require"
DATABASE_URL_UNPOOLED="postgresql://…(sans -pooler)…/neondb?sslmode=require"
```

La version **sans** `-pooler` sert au DDL : PgBouncer en mode transaction ne
tient pas l'état de session d'une migration, et l'échec ne mentionne jamais le
pooling — on lit « relation does not exist » sur une table qu'on vient de créer.

### 2. Le schéma et le premier administrateur

```bash
cd taboo-vercel
npm install
node base/init.mjs --schema
node base/init.mjs --admin kso --nom "K. So"
```

La seconde commande **affiche un mot de passe une seule fois**. Il n'est pas
conservé : la base n'en garde qu'une empreinte scrypt. Le noter avant de fermer
le terminal.

`base/init.mjs` est réexécutable. Relancé sur un compte existant, il lui remet
un mot de passe neuf et le repasse administrateur actif : c'est la porte de
secours du jour où plus personne ne peut entrer.

### 3. Le secret de signature

```bash
node base/init.mjs --secret
```

Garder la valeur sous les yeux. **Ne la mettre dans aucun fichier** de ce
dossier.

### 4. Les variables Vercel

```bash
vercel env add DATABASE_URL production     # la chaîne poolée (avec -pooler)
vercel env add ACCES_SECRET production     # le secret de l'étape 3
vercel env add ACCES_VERSION production    # saisir : 1
```

`DATABASE_URL` est la chaîne **poolée**. Les fonctions naissent et meurent à
chaque appel : le pilote HTTP de Neon ouvre une requête, pas une connexion.

> **`ACCES_MOTDEPASSE` ne sert plus à rien.** La supprimer :
> `vercel env rm ACCES_MOTDEPASSE production`. Une variable oubliée qui contient
> un mot de passe encore valide ailleurs est un secret qui traîne.

### 5. Déployer

```bash
vercel --prod
```

Les variables ne sont prises en compte qu'au déploiement **suivant** leur
création. C'est la cause n°1 de « ça renvoie 503 ».

---

## Au quotidien

Le tableau de bord affiche en haut à droite le nom de la personne connectée, un
lien **Mon compte**, un bouton **Déconnexion**, et pour les administrateurs un
lien **Administration**.

### `/compte` — ouvert à tout le monde

Identité, échéance de la session, et le formulaire de changement de mot de
passe (l'ancien est exigé). **Aucune condition de rôle** : le middleware
protège la page comme le reste, mais ne regarde pas le rôle, puisqu'il n'y a
rien là qui concerne quelqu'un d'autre que soi.

C'est volontaire et c'est une correction : ce formulaire vivait dans `/admin`,
que le middleware refuse aux lecteurs. Les seules personnes à recevoir un mot
de passe tiré au sort étaient donc les seules à ne pas pouvoir le changer.

Le serveur n'agit que sur l'identifiant du cookie signé : poster un
`identifiant` depuis cette page ne détourne pas la cible.

### `/admin` — réservé aux administrateurs

- **Comptes** — créer, changer le rôle, désactiver, supprimer, attribuer un
  nouveau mot de passe. Chaque mot de passe attribué est **affiché une seule
  fois** : la base n'en garde qu'une empreinte, il n'y a rien à retrouver.
- **Journal** — les 200 derniers événements : connexions réussies, échecs,
  blocages, créations, changements de mot de passe. Avec l'adresse IP.

Un administrateur qui s'attribue un nouveau mot de passe à lui-même garde sa
session : le cookie est réémis. Ses sessions ouvertes ailleurs tombent.

Les mots de passe attribués sont tirés au sort sous forme de quatre mots
(`falaise-ustensile-kiosque-orgue`) : ça se dicte au téléphone sans épeler, ça
se retient, et ça vaut plus de 90 bits d'entropie. `Kx7$pL2!` en vaut moins de
50 et finit recopié sur un post-it.

### Garde-fous

- Impossible de retrograder, désactiver ou supprimer le **dernier
  administrateur actif** : la porte se refermerait sur tout le monde.
- Impossible de supprimer son propre compte.
- **10 tentatives ratées par adresse IP et par quart d'heure**, puis blocage —
  y compris avec le bon mot de passe. Passer d'un secret unique à une liste de
  comptes agrandit la surface d'attaque ; sans ce compteur, la migration
  rendrait l'accès moins sûr, pas plus.
- Le journal survit à la suppression d'un compte : effacer quelqu'un n'efface
  pas la trace de ce qu'il a fait.

### Couper l'accès à tout le monde, immédiatement

```bash
vercel env rm ACCES_VERSION production
printf '2' | vercel env add ACCES_VERSION production
vercel --prod
```

Toutes les signatures deviennent invalides d'un coup, sans toucher à la base.

---

## Vérification obligatoire, AVANT de communiquer l'adresse

Ne pas sauter cette étape. Un tableau de bord de ce projet a déjà été mis en
ligne sans protection, et le compte de résultat complet était accessible à qui
avait l'adresse.

```bash
U="https://ton-projet.vercel.app"

# 1. Sans session : doit renvoyer 401
curl -s -o /dev/null -w "%{http_code}\n" "$U/"

# 2. Contrôle décisif : doit renvoyer 0
curl -s "$U/" | grep -c "chiffre_affaires"

# 3. Accès direct au fichier : doit renvoyer 401
curl -s -o /dev/null -w "%{http_code}\n" "$U/index.html"

# 4. Mauvais mot de passe : doit renvoyer 0 donnée
curl -s -L -X POST -d "identifiant=kso&mdp=FAUX" "$U/api/connexion" \
  | grep -c "chiffre_affaires"

# 5. L'API d'administration sans session : doit renvoyer 401
curl -s -o /dev/null -w "%{http_code}\n" "$U/api/admin"

# 6. Bon mot de passe : doit charger la coquille
curl -s -L -c /tmp/ck -b /tmp/ck -X POST \
  -d "identifiant=kso&mdp=LE_MOT_DE_PASSE" "$U/api/connexion" \
  | grep -c "compteBarre"
```

**Si le test 2, 3 ou 5 renvoie autre chose qu'attendu, ne communiquer l'adresse
à personne** et vérifier que les trois variables sont définies *et* qu'un
`vercel --prod` a suivi leur création.

Un banc d'essai couvre par ailleurs 52 points sur le code lui-même : connexion,
cloisonnement des rôles, cookie forgé, révocation, dernier administrateur,
limitation du débit, journalisation.

---

## Ce que ça protège, et ce que ça ne protège pas

**Protégé**

- Le fichier n'est pas servi sans session valide. Si une variable manque, rien
  n'est servi : l'oubli ferme au lieu d'ouvrir.
- Les mots de passe sont stockés en **empreintes scrypt** salées, jamais en
  clair. Une copie de la base ne donne rien à qui la lit.
- Les comparaisons sont à temps constant — une comparaison ordinaire s'arrête au
  premier caractère différent, et son temps de réponse permettrait de deviner un
  secret caractère par caractère.
- Le temps de réponse est le même pour un identifiant inconnu et pour un mot de
  passe faux : la liste des identifiants valides ne se déduit pas du chronomètre.
- Le cookie ne contient pas le mot de passe. Il porte l'identifiant, le rôle,
  l'époque et l'expiration, le tout signé en HMAC-SHA256 : lisible, mais pas
  falsifiable. On ne se promeut pas administrateur en éditant son cookie.
- `/admin` est refusé deux fois : par le middleware avant d'envoyer la page, par
  `api/admin.js` avant d'exécuter l'action. Cacher un bouton n'a jamais rien
  protégé.
- Le rôle vérifié par les fonctions vient de la **base**, pas du cookie : une
  personne rétrogradée en cours de session ne garde pas ses droits.

**Non protégé**

- **Un compte désactivé garde jusqu'à 12 heures le droit de lire la page.** Le
  middleware ne consulte pas la base ; c'est le compromis décrit plus haut, et
  il est borné par la durée de session. Le droit d'agir, lui, tombe tout de
  suite.
- **Une fois la page ouverte, les données sont sur le poste du lecteur.** Il
  peut l'enregistrer ou la transférer. Aucun tableau de bord n'échappe à ça,
  Looker compris.
- L'URL `*.vercel.app` reste publique en tant qu'adresse : c'est le middleware
  qui la rend inoffensive, pas son obscurité.

---

## Fichiers

    index.html           le tableau de bord — généré, EXCLU du dépôt
    admin.html           la vue d'administration (quelques Ko)
    compte.html          mon compte — ouvert à toute session valide
    middleware.js        vérifie la signature, refuse /admin aux lecteurs
    api/connexion.js     vérifie le compte, pose le cookie
    api/session.js       qui suis-je, déconnexion, changer son mot de passe
    api/admin.js         comptes et journal — rôle admin obligatoire
    lib/session.js       le cookie signé — un seul code pour edge et Node
    lib/motdepasse.js    empreintes scrypt, tirage des mots de passe
    lib/base.js          toutes les requêtes SQL du projet
    lib/garde.js         le contrôle d'accès des fonctions
    base/schema.sql      utilisateur, journal, tentative
    base/init.mjs        installation du schéma, premier administrateur
    vercel.json          en-têtes + cleanUrls (voir ci-dessous)
    .gitignore           index.html, .vercel et .env* ne partent jamais

Trois variables d'environnement, toutes obligatoires :

    DATABASE_URL         la base Neon (chaîne poolée)
    ACCES_SECRET         clé de signature du cookie de session
    ACCES_VERSION        incrémenter pour invalider toutes les sessions

`ACCES_MOTDEPASSE` n'existe plus. Si elle est encore définie chez Vercel, la
supprimer : une variable oubliée qui contient un mot de passe encore valide
ailleurs est un secret qui traîne.

### Deux notes sur `vercel.json`

`cleanUrls` sert `admin.html` à l'adresse `/admin`. Le middleware filtre sur le
préfixe `/admin`, donc les deux formes sont couvertes de toute façon — mais
l'adresse courte est celle qu'on écrit dans un lien.

Le schéma de Vercel **refuse les propriétés qu'il ne connaît pas**, y compris
une clé `"//"` employée comme commentaire : le déploiement échoue sur
« Invalid vercel.json ». Les explications de ce fichier vivent donc ici, pas
dedans.
