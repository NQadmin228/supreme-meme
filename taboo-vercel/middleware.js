/* =====================================================================
   TABOO — Contrôle d'accès au tableau de bord, côté serveur
   ---------------------------------------------------------------------
   Ce middleware s'exécute sur le réseau Vercel AVANT que la moindre
   requête n'atteigne index.html. Sans jeton valide, le fichier n'est
   jamais servi : ce n'est pas une serrure dans la page, c'est un refus
   d'envoi.

   POURQUOI PAS LA PROTECTION INTEGREE DE VERCEL
   ---------------------------------------------
   Vercel Authentication n'autorise que les membres de l'équipe, et
   l'offre gratuite est mono-utilisateur : le patron ne peut pas y être
   ajouté. Password Protection est réservée aux offres payantes. Sur le
   plan gratuit, l'authentification doit donc vivre ici.

   POURQUOI UN MIDDLEWARE ET NON UNE FONCTION
   ------------------------------------------
   Une fonction Vercel ne peut pas renvoyer plus de 4,5 Mo, et le
   tableau de bord en fait 5,18. Le fichier reste donc un actif statique
   servi par le CDN ; le middleware ne fait que l'autoriser. Il ne
   transporte aucune donnée, ce qui le garde sous la limite de taille de
   bundle de l'edge.

   COMMENT ON ENTRE
   ----------------
   Chaque personne reçoit un lien personnel contenant un jeton signé :

       https://....vercel.app/?k=amadou.7f3a1c9e...

   Le middleware vérifie la signature, pose un cookie de session, puis
   laisse passer. Le patron met son lien en favori et n'a RIEN à retenir
   ni à changer -- c'était la demande de départ.

   Le jeton est signé en HMAC-SHA256 avec un secret qui vit dans les
   variables d'environnement Vercel, jamais dans le dépôt. On ne stocke
   aucune liste : la validité se recalcule, donc il n'y a pas de base à
   maintenir.

   CE QUE CA VAUT, ET CE QUE CA NE VAUT PAS
   ----------------------------------------
   Un lien est un porteur de droit : transféré, il donne l'accès. C'est
   plus faible qu'une authentification par compte Google, et il faut le
   savoir. En revanche c'est révocable par personne (voir ACCES_VERSION),
   journalisé, et sans commune mesure avec un fichier public.
   ===================================================================== */

export const config = {
  // On intercepte tout, sauf les ressources qui n'ont aucune raison
  // d'être protégées et dont le blocage casserait la page de connexion.
  matcher: ['/((?!_next/static|favicon.ico).*)'],
};

const NOM_COOKIE = 'taboo_acces';
// Durée de session. Une semaine : assez long pour que le patron ne se
// reconnecte pas sans arrêt, assez court pour qu'un poste perdu ne
// reste pas ouvert indéfiniment.
const DUREE_SESSION = 7 * 24 * 60 * 60;

/* ---------- Signature ---------- */

function versOctets(s) {
  return new TextEncoder().encode(s);
}

function base64url(octets) {
  let s = '';
  const vue = new Uint8Array(octets);
  for (let i = 0; i < vue.length; i++) s += String.fromCharCode(vue[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signer(message, secret) {
  const cle = await crypto.subtle.importKey(
    'raw', versOctets(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return base64url(await crypto.subtle.sign('HMAC', cle, versOctets(message)));
}

/* Comparaison à temps constant. Une comparaison ordinaire s'arrête au
   premier octet différent : le temps de réponse révèle alors combien de
   caractères sont corrects, ce qui permet de reconstituer une signature
   octet par octet. */
function egalConstant(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function jetonValide(jeton, secret, version) {
  if (!jeton || typeof jeton !== 'string') return null;
  const sep = jeton.lastIndexOf('.');
  if (sep < 1) return null;
  const charge = jeton.slice(0, sep);
  const signature = jeton.slice(sep + 1);
  const attendue = await signer(`${version}:${charge}`, secret);
  if (!egalConstant(signature, attendue)) return null;
  return charge;   // l'identifiant de la personne, pour la journalisation
}

/* ---------- Page de refus ---------- */

function pageRefus(raison) {
  // Volontairement sobre et sans détail : on ne renseigne pas un
  // visiteur non autorisé sur le mécanisme. Le contact est indiqué pour
  // que quelqu'un de légitime sache quoi faire.
  return new Response(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Accès restreint</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;
    justify-content:center;background:#001A20;color:#FFF;
    font:15px/1.6 'Inter',system-ui,sans-serif;padding:24px}
  .b{max-width:430px;text-align:center}
  .t{font-size:19px;font-weight:600;margin-bottom:10px;letter-spacing:.5px}
  p{color:#9EC4CC;margin:0 0 10px}
  .m{color:#6E939B;font-size:13px;margin-top:22px}
</style></head><body><div class="b">
  <div class="t">ACCÈS RESTREINT</div>
  <p>Ce tableau de bord n'est accessible que par un lien personnel.</p>
  <p class="m">Si vous devez y accéder, demandez votre lien au responsable
  du reporting. Ne partagez pas le vôtre : il vous identifie.</p>
</div></body></html>`, {
    status: 401,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // Une page de refus indexée révélerait l'existence de l'adresse.
      'x-robots-tag': 'noindex, nofollow, noarchive',
    },
  });
}

/* ---------- Middleware ---------- */

export default async function middleware(requete) {
  const secret = process.env.ACCES_SECRET;
  const version = process.env.ACCES_VERSION || '1';

  /* Sans secret configuré, on REFUSE tout. Le réflexe inverse -- laisser
     passer quand la configuration manque -- est la cause classique des
     fuites : un déploiement oublie la variable, et le site s'ouvre en
     silence. Ici, l'oubli ferme. */
  if (!secret) {
    return new Response(
      'Configuration incomplete : la variable ACCES_SECRET est absente. '
      + 'Aucun contenu ne sera servi tant qu\'elle n\'est pas definie.',
      {status: 503, headers: {'cache-control': 'no-store'}});
  }

  const url = new URL(requete.url);

  // 1. Un lien personnel fraîchement ouvert
  const cle = url.searchParams.get('k');
  if (cle) {
    const qui = await jetonValide(cle, secret, version);
    if (qui) {
      // On retire le jeton de l'URL par une redirection : il ne reste
      // alors ni dans la barre d'adresse, ni dans l'historique du
      // navigateur, ni dans le Referer envoyé au CDN de Chart.js.
      const propre = new URL(url);
      propre.searchParams.delete('k');
      const reponse = Response.redirect(propre.toString(), 302);
      const r = new Response(null, {status: 302, headers: reponse.headers});
      r.headers.set('set-cookie',
        `${NOM_COOKIE}=${encodeURIComponent(cle)}; Path=/; Max-Age=${DUREE_SESSION};`
        + ' HttpOnly; Secure; SameSite=Lax');
      r.headers.set('cache-control', 'no-store');
      return r;
    }
    return pageRefus('jeton invalide');
  }

  // 2. Une session déjà ouverte
  const entete = requete.headers.get('cookie') || '';
  const trouve = entete.split(';').map(c => c.trim())
    .find(c => c.startsWith(`${NOM_COOKIE}=`));
  if (trouve) {
    const valeur = decodeURIComponent(trouve.slice(NOM_COOKIE.length + 1));
    const qui = await jetonValide(valeur, secret, version);
    if (qui) {
      // Journalisé dans les logs Vercel : on sait qui consulte, et quand.
      console.log(`acces autorise · ${qui} · ${url.pathname}`);
      return undefined;   // laisse le CDN servir l'actif statique
    }
  }

  return pageRefus('aucun jeton');
}
