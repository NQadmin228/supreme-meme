# Tableau de bord TABOO — hébergement Vercel gratuit avec authentification

Site statique sur Vercel, offre Hobby (gratuite), protégé par une vérification
côté serveur. Aucun nom de domaine requis.

## Pourquoi ce montage et pas la protection intégrée de Vercel

Sur l'offre gratuite, **aucun réglage Vercel ne peut donner au patron un accès
authentifié** :

- **Vercel Authentication** n'autorise que les membres de l'équipe, et l'offre
  Hobby est mono-utilisateur : le patron ne peut pas y être ajouté.
- **Password Protection** est une option payante, réservée aux offres Pro et
  Enterprise.

L'authentification vit donc dans `middleware.js`, qui s'exécute sur le réseau
Vercel **avant** que la requête n'atteigne `index.html`. Sans jeton valide, le
fichier n'est jamais envoyé. Ce n'est pas une serrure dans la page — un mot de
passe écrit dans le HTML se lit en trois clics — c'est un refus d'envoi.

Le fichier reste un actif statique servi par le CDN parce qu'une fonction Vercel
ne peut pas renvoyer plus de 4,5 Mo, et le tableau de bord en fait 5,18. Le
middleware ne transporte rien, il autorise.

---

## Déploiement

### 1. Générer le secret

```bash
node genere_liens.mjs --nouveau-secret
```

Garde la valeur affichée sous les yeux. **Ne la mets dans aucun fichier** de ce
dossier : `index.html` et le secret ne doivent jamais voyager ensemble.

### 2. Déployer

```bash
cd taboo-vercel
vercel                 # première fois : crée le projet
```

Réponds « non » à « Want to modify these settings? ». Le projet n'a pas de build.

### 3. Configurer les variables

```bash
vercel env add ACCES_SECRET production     # colle le secret de l'étape 1
vercel env add ACCES_VERSION production    # saisis : 1
```

Ou dans l'interface : projet → **Settings** → **Environment Variables**.

### 4. Redéployer en production

```bash
vercel --prod
```

Les variables ne sont prises en compte qu'au déploiement suivant leur création.
C'est la cause n°1 de « ça renvoie 503 ».

### 5. Générer les liens personnels

```bash
node genere_liens.mjs \
  --secret "$(cat .acces_secret)" \
  --url "https://taboo-vercel.vercel.app" \
  --version 2 \
  lad@saphircapital.com kso@saphircapital.com
```

L'adresse e-mail sert d'identifiant : les journaux Vercel affichent
`acces autorise · lad@saphircapital.com`, et non un surnom à traduire.

`--version` doit correspondre à la variable `ACCES_VERSION` sur Vercel —
actuellement **2**. Un décalage entre les deux refuse tous les liens, sans
message explicite sur la cause.

Chacun reçoit **son** lien. Il le met en favori, et n'a plus rien à faire :
aucun mot de passe à retenir, aucun à changer.

---

## Vérification obligatoire, AVANT d'envoyer le moindre lien

Ne saute pas cette étape. Un tableau de bord de ce projet a déjà été mis en
ligne sans protection, et le compte de résultat complet était accessible à qui
avait l'adresse.

```bash
U="https://ton-projet.vercel.app"

# 1. Sans jeton : doit renvoyer 401
curl -s -o /dev/null -w "%{http_code}\n" "$U/"

# 2. Contrôle décisif : doit renvoyer 0
curl -s "$U/" | grep -c "taboo-data"

# 3. Jeton falsifié : doit renvoyer 401
curl -s -o /dev/null -w "%{http_code}\n" "$U/?k=patron.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

# 4. Avec un vrai lien : doit renvoyer 200 et 2
curl -s -L "$U/?k=<un vrai jeton>" | grep -c "taboo-data"
```

**Si le test 2 renvoie autre chose que `0`, n'envoie rien à personne** et
vérifie que `ACCES_SECRET` est bien définie *et* qu'un `vercel --prod` a suivi.

Ces quatre tests ont été passés en local contre le runtime Vercel : 401 sans
jeton, 200 avec, 401 avec un jeton falsifié, 503 si la variable manque.

---

## Révoquer

Il n'y a aucune liste à maintenir : la validité se recalcule à partir du secret
et de `ACCES_VERSION`.

**Tout révoquer** — un lien a fuité, quelqu'un part :

```bash
vercel env rm ACCES_VERSION production
vercel env add ACCES_VERSION production    # saisis : 2
vercel --prod
node genere_liens.mjs --secret "$(cat .acces_secret)" --url "$U" --version 3 lad@saphircapital.com kso@saphircapital.com
```

Les anciens liens cessent immédiatement de fonctionner.

**Révoquer une seule personne** : impossible sans toucher les autres. C'est la
limite assumée de ce mécanisme. En contrepartie, chaque lien porte un
identifiant, donc les journaux Vercel (**projet → Logs**) te disent qui a
consulté et quand.

---

## Ce que ça protège, et ce que ça ne protège pas

**Protégé** : le fichier n'est pas servi sans jeton valide. La signature est un
HMAC-SHA256 vérifié côté serveur, la comparaison est à temps constant, le jeton
est retiré de l'URL par redirection dès la première visite — il ne reste donc
ni dans la barre d'adresse, ni dans l'historique, ni dans le `Referer` envoyé au
CDN de Chart.js. Sans `ACCES_SECRET`, rien n'est servi.

**Non protégé** :

- **Un lien est un porteur de droit.** Transféré, il donne l'accès. C'est plus
  faible qu'une authentification par compte Google.
- **Une fois la page ouverte, les données sont sur le poste du lecteur.** Il
  peut l'enregistrer ou la transférer. Aucun tableau de bord n'échappe à ça,
  Looker compris.
- L'URL `*.vercel.app` reste publique en tant qu'adresse : c'est le middleware
  qui la rend inoffensive, pas son obscurité.

**L'alternative plus solide, également gratuite** : Cloudflare Access avec
connexion par compte Google — le patron utiliserait le compte
`@saphircapital.com` qu'il ouvre déjà chaque matin, et il n'y aurait aucun jeton
à transporter. Elle exige un nom de domaine dans un compte Cloudflare, ce qui a
fait écarter cette voie.

---

## Fichiers

    index.html          le tableau de bord (5,18 Mo) — EXCLU du dépôt
    middleware.js       la vérification d'accès, côté serveur
    genere_liens.mjs    génération du secret et des liens personnels
    vercel.json         en-têtes : noindex, no-store, DENY, no-referrer
    package.json        minimal, pour que Vercel prenne le middleware
    .gitignore          index.html et .vercel ne partent jamais
