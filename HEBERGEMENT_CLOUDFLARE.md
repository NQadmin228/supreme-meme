# Héberger le dashboard TABOO derrière Cloudflare Access

Objectif : le tableau de bord accessible par un lien, réservé aux personnes
autorisées, **et le patron gère son accès sans passer par toi**.

Le principe : il n'y a **aucun mot de passe propre au dashboard**. Le patron
saisit son adresse e-mail, reçoit un code à usage unique, et entre. Rien à
retenir, rien à changer, rien à réinitialiser — donc rien à te demander.

```
       le patron                Cloudflare Access              Cloudflare Pages
          │                            │                              │
          │  ouvre dashboard.____.tg   │                              │
          ├───────────────────────────►│                              │
          │                            │ e-mail autorisé ?            │
          │  ◄── code par e-mail ──────┤                              │
          │  ──── code saisi ─────────►│                              │
          │                            ├─── requête signée ──────────►│
          │  ◄──────────── le tableau de bord ─────────────────────────┤
```

Tout le trafic passe par Access. Le fichier n'est jamais joignable en direct —
c'est l'objet de l'étape C, la seule qui soit vraiment délicate.

---

## Ce qu'il te faut avant de commencer

- Un compte Cloudflare (gratuit).
- **Un nom de domaine dont les serveurs de noms pointent vers Cloudflare.**
  C'est le prérequis dur : Access ne protège que ce que Cloudflare sert.
  Un sous-domaine suffit — par exemple `dashboard.tondomaine.tg`.
- Le fichier `dashboard_v2.html` (5,19 Mo).
- L'adresse e-mail du patron.

Cloudflare Access est gratuit jusqu'à 50 utilisateurs. Pour deux ou trois
personnes, tu ne paieras rien.

---

## Étape A — Héberger le fichier sur Cloudflare Pages

1. Crée un dossier vide sur ton poste et copie `dashboard_v2.html` dedans,
   **renommé `index.html`** — Pages sert `index.html` à la racine.

   ```bash
   mkdir taboo-site
   cp dashboard_v2.html taboo-site/index.html
   ```

2. Dans le tableau de bord Cloudflare : **Workers & Pages** → **Create** →
   onglet **Pages** → **Upload assets** (et non « Connect to Git » : on ne
   veut surtout pas que ce fichier entre dans un dépôt).

3. Nomme le projet, par exemple `taboo-dashboard`. Glisse le dossier
   `taboo-site`. Déploie.

4. Cloudflare te donne une URL en `taboo-dashboard.pages.dev`.
   **À cet instant, elle est publique.** Ne la communique à personne : on la
   ferme à l'étape C.

> Pourquoi Pages et pas un bucket : c'est gratuit, il n'y a pas de serveur à
> maintenir, et le contenu est déjà servi par Cloudflare — donc Access peut
> s'appliquer sans configuration réseau supplémentaire.

---

## Étape B — Activer Access et déclarer l'application

1. Dans Cloudflare : **Zero Trust** (menu de gauche, parfois nommé
   « Cloudflare One »). Au premier accès, il demande de choisir un nom
   d'équipe — ce sera ton sous-domaine d'authentification, par exemple
   `saphir` donnant `saphir.cloudflareaccess.com`. Choisis-le une fois pour
   toutes, il se change mal.

2. Il demande aussi un plan : prends **Free**. Une carte bancaire peut être
   exigée pour la vérification ; le palier gratuit reste gratuit.

3. Rattache le domaine à Pages : dans ton projet Pages →
   **Custom domains** → **Set up a custom domain** →
   `dashboard.tondomaine.tg`. Cloudflare crée l'enregistrement DNS.

4. **Zero Trust** → **Access** → **Applications** → **Add an application** →
   **Self-hosted**.

   - Nom : `Tableau de bord TABOO`
   - Session duration : **1 semaine**. Le patron ne se réauthentifie qu'une
     fois par semaine. Ne mets pas 24 h : la friction se transforme vite en
     « ça remarche plus, appelle-moi ».
   - Domaine de l'application : `dashboard.tondomaine.tg`, chemin vide
     (toute l'application).

5. Méthode de connexion : laisse **One-time PIN** activé. C'est le seul
   fournisseur d'identité qui ne demande aucune configuration — le code part
   par e-mail. Si tu veux en plus le bouton « se connecter avec Google »,
   c'est **Settings** → **Authentication** → **Add new** → Google, mais ce
   n'est pas nécessaire pour démarrer.

6. Règle d'autorisation :

   - Policy name : `Direction`
   - Action : **Allow**
   - Include → **Emails** → l'adresse du patron, la tienne, et celles des
     personnes concernées.

   **Astuce qui t'évitera d'être dérangé :** au lieu de lister les adresses
   une par une, utilise **Emails ending in** → `@saphircapital.com`. Toute
   personne de l'entreprise entre alors sans que tu aies à ajouter qui que ce
   soit. Ne fais ça que si tout le domaine a légitimement le droit de voir le
   compte de résultat.

7. Enregistre.

---

## Étape C — Fermer le contournement. **C'est l'étape critique.**

Access protège `dashboard.tondomaine.tg`. Mais l'URL
`taboo-dashboard.pages.dev` créée à l'étape A existe toujours, et si elle
répond, **toute la protection est inutile** : il suffit de connaître cette
adresse pour lire le compte de résultat sans authentification.

C'est l'erreur la plus fréquente sur ce montage, et elle est silencieuse —
rien ne signale que la porte de service est restée ouverte.

Deux choses à faire :

1. Dans **Access** → **Applications**, ajoute une **seconde application**
   self-hosted sur le domaine `taboo-dashboard.pages.dev`, avec la même
   règle d'autorisation. Le sous-domaine `pages.dev` est servi par
   Cloudflare, donc Access s'y applique.

2. Et surtout : **vérifie**. Ne suppose pas que c'est fermé.

```bash
# Le domaine officiel doit REDIRIGER vers l'authentification (302 vers
# cloudflareaccess.com), et jamais renvoyer le HTML.
curl -sI https://dashboard.tondomaine.tg | head -20

# La porte de service doit faire la MEME chose.
curl -sI https://taboo-dashboard.pages.dev | head -20
```

Ce que tu dois voir dans les deux cas : un code `302` et un en-tête
`location:` pointant vers `...cloudflareaccess.com`.

Ce qui doit t'alarmer : un `200 OK`. Cela signifie que le fichier est servi
sans authentification.

Contrôle décisif — le contenu ne doit jamais sortir :

```bash
# Doit renvoyer 0. Toute autre valeur = les données sont accessibles.
curl -s https://taboo-dashboard.pages.dev | grep -c "taboo-data"
curl -s https://dashboard.tondomaine.tg   | grep -c "taboo-data"
```

Si l'un des deux renvoie autre chose que `0`, arrête-toi et reprends
l'étape C avant de communiquer le lien.

> Si tu n'arrives pas à couvrir l'URL `pages.dev`, l'alternative sûre est de
> ne pas utiliser Pages : place le fichier sur un stockage privé et expose-le
> par un **Cloudflare Tunnel**. Plus lourd, mais l'origine n'a alors aucune
> adresse publique, donc aucun contournement possible par construction.

---

## Étape D — Tester en se mettant à la place du patron

Fais-le depuis une **fenêtre de navigation privée**, ou mieux depuis ton
téléphone en 4G : ta propre session Cloudflare masquerait le problème.

1. Ouvre `https://dashboard.tondomaine.tg`
2. Une page Cloudflare demande une adresse e-mail
3. Saisis l'adresse du patron → un code arrive par e-mail
4. Entre le code → le tableau de bord s'affiche
5. Vérifie que le refus fonctionne aussi : recommence avec une adresse
   **non autorisée** (un Gmail personnel). Tu dois être bloqué. Un accès qui
   laisse tout passer se remarque moins qu'un accès trop strict.

---

## Ce que le patron pourra faire seul

- **Se connecter** : son adresse, un code par e-mail. Aucun mot de passe.
- **Ne plus rien faire pendant une semaine** : la session dure 7 jours.
- **Ne jamais te demander de réinitialisation** : il n'y a rien à
  réinitialiser. Il reçoit un nouveau code à chaque fois.
- Si tu as ajouté le fournisseur Google, il utilisera son compte Google
  habituel — et c'est Google qui gère son mot de passe, pas toi.

Ce qu'il **ne** pourra pas faire seul : ajouter ou retirer une personne
autorisée, ce qui reste une modification dans Cloudflare. La règle
« Emails ending in @tondomaine » de l'étape B.6 supprime ce besoin dans la
plupart des cas.

---

## Ce que ça ne protège pas

À savoir, pour ne pas se croire couvert au-delà du réel.

- **Une fois la page ouverte, les données sont sur le poste du lecteur.** Le
  fichier contient tout le compte de résultat ; il peut l'enregistrer, le
  transférer, en faire une capture. Access contrôle *qui entre*, pas ce que
  la personne fait ensuite. C'est vrai de n'importe quel tableau de bord, y
  compris Looker.
- **Le lien du code à usage unique est un accès.** Si la boîte e-mail du
  patron est compromise, le dashboard l'est aussi. Le compte Google avec
  double authentification est meilleur sur ce point.
- Cloudflare journalise les accès : **Zero Trust** → **Logs** → **Access**.
  Utile pour savoir qui a consulté quoi et quand.

---

## Quand la version serverless arrivera

Ce montage reste valable : Access se placera devant le front, et l'API de
détail passera par la même politique d'autorisation. Le travail fait ici
n'est pas à refaire.

Une réserve toutefois : l'architecture serverless prévoit **Google Cloud IAP**,
qui joue le même rôle côté GCP. Mettre Access devant et IAP derrière
fonctionne, mais devient deux systèmes d'identité à maintenir pour un seul
utilisateur. Le moment venu, il faudra choisir l'un ou l'autre — et si le
front est hébergé sur Cloudflare, autant garder Access partout.
