/* =====================================================================
   TABOO — Controle d'acces au tableau de bord
   ---------------------------------------------------------------------
   Un formulaire demande un identifiant et un mot de passe. Tant qu'ils
   ne sont pas fournis et valides, le fichier de 5,3 Mo n'est JAMAIS
   envoye.

   POURQUOI ICI ET PAS DANS LA PAGE
   --------------------------------
   Un mot de passe ecrit dans le HTML ne protege rien : il se lit dans
   le code source, avec les donnees a cote. La verification doit donc se
   faire AVANT l'envoi, sur le reseau Vercel.

   POURQUOI PAS LA PROTECTION INTEGREE DE VERCEL
   ---------------------------------------------
   Vercel Authentication n'autorise que les membres de l'equipe, et
   l'offre gratuite est mono-utilisateur. Password Protection est
   reservee aux offres payantes.

   POURQUOI UN MIDDLEWARE ET PAS UNE FONCTION
   ------------------------------------------
   Une fonction Vercel plafonne a 4,5 Mo de reponse ; le tableau de bord
   en fait 5,18. Le fichier reste donc un actif statique servi par le
   CDN, et le middleware se contente de l'autoriser. Il ne transporte
   aucune donnee, ce qui le garde sous la limite de bundle de l'edge.

   CE QUI A CHANGE AVEC LA BASE DE COMPTES
   ---------------------------------------
   Avant : un mot de passe partage dans ACCES_MOTDEPASSE. On ne savait
   pas qui entrait, et revoquer une personne revoquait tout le monde.

   Maintenant : des comptes nominatifs dans Postgres (Neon). Mais ce
   fichier NE LIT PAS cette base -- il s'execute sur chaque requete, y
   compris celle des 5,3 Mo, et un aller-retour SQL par requete se
   paierait sur chaque chargement. Il verifie une signature, rien de
   plus. La base n'est lue qu'a la connexion et sur action
   d'administration, dans api/.

   Ce que ce choix coute est ecrit dans base/schema.sql : un compte
   desactive garde le droit de LIRE la page jusqu'a l'expiration de son
   cookie. D'ou DUREE_SESSION ramenee a 12 heures. Il perd en revanche
   le droit d'AGIR immediatement, parce que les fonctions, elles,
   consultent la base (lib/garde.js).
   ===================================================================== */

import {lire, cookieDepuisEntete} from './lib/session.js';
import {etablissementDuChemin, etablissementDeLaPage, estUnCode,
        cheminDe} from './lib/etablissements.js';

export const config = {
  // /api/ est exclu : c'est la fonction de connexion, qui doit etre
  // joignable SANS cookie -- sinon le formulaire ne pourrait jamais
  // etre soumis et personne ne pourrait entrer. Les fonctions sous
  // /api/ verifient elles-memes leur appelant.
  matcher: ['/((?!api/|_next/static|favicon.ico).*)'],
};

/* ---------- Page de connexion ---------- */

const MESSAGES = {
  1: 'Identifiant ou mot de passe incorrect.',
  2: 'Trop de tentatives. Reessayez dans un quart d\'heure.',
};

function pageConnexion(erreur, etab) {
  return new Response(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TABOO — Accès au tableau de bord</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;
    justify-content:center;background:#001A20;color:#fff;padding:24px;
    font:15px/1.6 'Inter',system-ui,-apple-system,sans-serif}
  .carte{width:100%;max-width:370px;text-align:center}
  .logo{width:112px;height:112px;margin:0 auto 22px;display:block;
    background:#004F5E;border-radius:4px}
  h1{font-size:15px;font-weight:600;letter-spacing:1.4px;margin:0 0 6px;
    text-transform:uppercase}
  .sub{color:#9EC4CC;font-size:13px;margin:0 0 26px}
  form{display:flex;flex-direction:column;gap:11px}
  input{background:#002A33;border:1px solid #2C8598;color:#fff;
    padding:12px 14px;border-radius:4px;font-size:15px;font-family:inherit;
    text-align:center;letter-spacing:.6px;width:100%}
  input:focus{outline:none;border-color:#7FD9E8}
  button{background:#004F5E;border:1px solid #2C8598;color:#fff;
    padding:12px 14px;border-radius:4px;font-size:14px;font-weight:600;
    font-family:inherit;cursor:pointer;letter-spacing:.4px}
  button:hover{background:#0a6072}
  .err{background:rgba(208,59,59,.14);border:1px solid #d03b3b;
    color:#f0a0a0;padding:9px 12px;border-radius:4px;font-size:13px;
    margin-bottom:14px}
  .pied{color:#6E939B;font-size:11.5px;margin-top:24px;line-height:1.6}
</style></head><body>
<div class="carte">
  <svg class="logo" viewBox="0 0 112 112" role="img" aria-label="TABOO">
    <rect width="112" height="112" rx="4" fill="#004F5E"/>
    <text x="56" y="56" text-anchor="middle" fill="#fff"
      font-family="Inter,sans-serif" font-size="21" font-weight="500"
      letter-spacing="3.5">TABOO</text>
    <text x="56" y="72" text-anchor="middle" fill="#B8DCE3"
      font-family="Inter,sans-serif" font-size="6.5" letter-spacing="1.6">RESTAURANT · LOUNGE BAR</text>
  </svg>
  <h1>Tableau de bord de direction</h1>
  <div class="sub">Accès réservé</div>
  ${erreur ? `<div class="err">${erreur}</div>` : ''}
  <form method="POST" action="/api/connexion">
    ${etab ? `<input type="hidden" name="etab" value="${etab}">` : ''}
    <input type="text" name="identifiant" placeholder="Identifiant"
           autocomplete="username" autocapitalize="none" autocorrect="off"
           spellcheck="false" autofocus required>
    <input type="password" name="mdp" placeholder="Mot de passe"
           autocomplete="current-password" required>
    <button type="submit">Entrer</button>
  </form>
  <div class="pied">Ces données sont confidentielles.<br>
    Chaque connexion est enregistrée.</div>
</div></body></html>`, {
    // 401 et non 200 : un moteur ou un outil de supervision doit
    // comprendre que la page n'est pas le contenu demande.
    status: 401,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow, noarchive',
    },
  });
}

/* ---------- Refus d'acces a l'administration ---------- */

function pageInterdite() {
  return new Response(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TABOO — Accès refusé</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;
    justify-content:center;background:#001A20;color:#9EC4CC;padding:24px;
    font:15px/1.7 system-ui,-apple-system,sans-serif;text-align:center}
  a{color:#7FD9E8}
</style></head><body><div>
  <p>Cette page est réservée à l'administration.</p>
  <p><a href="/">Retour au tableau de bord</a></p>
</div></body></html>`, {
    status: 403,
    headers: {'content-type': 'text/html; charset=utf-8',
              'cache-control': 'no-store'},
  });
}

/* ---------- Middleware ---------- */

export default async function middleware(requete) {
  /* .trim() : une variable d'environnement arrive souvent avec un
     retour a la ligne parasite, et un secret termine par « \n » ferait
     diverger toutes les signatures sans rien dire de la cause. */
  const secret = (process.env.ACCES_SECRET || '').trim();
  const version = (process.env.ACCES_VERSION || '1').trim();

  /* Configuration incomplete : on REFUSE. Le reflexe inverse -- laisser
     passer quand il manque un reglage -- est la cause classique des
     fuites : un deploiement oublie la variable et le site s'ouvre en
     silence. Ici, l'oubli ferme. */
  if (!secret) {
    return new Response(
      'Configuration incomplete : ACCES_SECRET est absente. Aucun contenu '
      + 'ne sera servi tant que cette variable ne sera pas definie.',
      {status: 503, headers: {'cache-control': 'no-store'}});
  }

  const url = new URL(requete.url);
  const session = await lire(
    cookieDepuisEntete(requete.headers.get('cookie')), secret, version);

  /* 1. Pas de session valide : on demande l'identifiant. */
  if (!session) {
    /* L'etablissement demande traverse le formulaire.

       Sans cela, un lien « /?etab=amnesia » envoye a quelqu'un le
       ramenait sur TABOO : la connexion redirige vers « / » et le
       parametre etait perdu en route. Le lien ne tenait donc pas sa
       promesse, sans que personne comprenne pourquoi.

       On ne recopie que des codes CONNUS. Reinjecter une valeur
       arbitraire d'URL dans une redirection est la recette d'une
       redirection ouverte. */
    const voulu = url.searchParams.get('etab');
    return pageConnexion(MESSAGES[url.searchParams.get('e')] || null,
                         estUnCode(voulu) ? voulu : null);
  }

  /* 2. La page d'administration est refusee aux lecteurs ICI, avant
        d'etre servie. L'API refait le controle de son cote : celui-ci
        evite d'envoyer la page, celui-la evite d'executer l'action.
        Aucun des deux ne suffit seul. */
  if (url.pathname.startsWith('/admin') && session.r !== 'admin') {
    return pageInterdite();
  }

  /* 3. Les donnees d'un etablissement ne partent qu'a qui y a droit.

        C'est LA porte qui compte pour le cloisonnement entre TABOO et
        AMNESIA. La coquille est commune et ne contient aucun chiffre ;
        tout ce qui se lit arrive par /donnees/<code>/, servi par le CDN.
        Refuser ici, c'est refuser la seule chose qui vaille.

        Le middleware n'ouvre pas de connexion : la liste autorisee est
        dans le cookie signe, mise a jour a chaque emission. Consequence
        assumee, la meme que pour la desactivation d'un compte : retirer
        l'acces a un etablissement ne ferme les sessions deja ouvertes
        qu'a leur expiration -- au plus douze heures. Pour couper tout de
        suite, ACCES_VERSION. */
  /* La COQUILLE d'un etablissement se refuse aussi. Servir une page
     vide a quelqu'un qui n'y a pas droit -- elle se chargerait puis
     echouerait en 403 sur ses donnees -- serait une facon penible de
     dire non. Ce controle-ci est du confort ; celui des donnees,
     juste en dessous, est la vraie porte. */
  const page = etablissementDeLaPage(url.pathname);
  if (page && !session.a.includes(page)) return pageInterdite();

  const etab = etablissementDuChemin(url.pathname);
  if (etab && !session.a.includes(etab)) {
    return new Response('Acces refuse a cet etablissement.', {
      status: 403,
      headers: {'cache-control': 'no-store', 'content-type': 'text/plain'},
    });
  }

  /* 3. Session valide : le CDN sert l'actif statique. */
  return undefined;
}
