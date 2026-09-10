#!/usr/bin/env node
/* =====================================================================
   TABOO — Génère les liens personnels d'accès au tableau de bord.
   ---------------------------------------------------------------------
     node genere_liens.mjs --secret <SECRET> --url <URL> patron amadou kso
     node genere_liens.mjs --nouveau-secret        (en génère un solide)

   Le secret n'est jamais écrit sur le disque par ce script : tu le
   passes en argument et tu le colles dans les variables Vercel. Un
   secret dans un fichier finit toujours par se retrouver dans un dépôt.

   RÉVOQUER
   --------
   Il n'y a aucune liste à maintenir : la validité d'un jeton se
   recalcule à partir du secret et de ACCES_VERSION.
     - révoquer TOUT LE MONDE : incrémente ACCES_VERSION sur Vercel,
       puis régénère les liens. Les anciens cessent immédiatement.
     - révoquer UNE personne : il n'y a pas de moyen de le faire sans
       toucher les autres. C'est la limite assumée de ce mécanisme, et
       la raison pour laquelle chaque lien porte un identifiant : au
       moins tu sais lequel a fuité, et les journaux Vercel te disent
       qui a consulté quoi.
   ===================================================================== */

import {createHmac, randomBytes} from 'node:crypto';

function base64url(buf) {
  return buf.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signer(message, secret) {
  return base64url(createHmac('sha256', secret).update(message).digest());
}

export function fabriquerJeton(identifiant, secret, version = '1') {
  // Symetrique du .trim() du middleware : si l'un nettoie et l'autre non,
  // les signatures divergent et tous les liens sont refuses.
  secret = String(secret).trim();
  version = String(version).trim();
  // L'identifiant sert uniquement à savoir de qui vient un accès. Il est
  // dans le jeton en clair : ce n'est pas un secret, la signature l'est.
  // Le @ est autorisé pour qu'une adresse e-mail passe telle quelle : les
  // journaux Vercel affichent alors « acces autorise · lad@exemple.com »
  // au lieu d'un surnom qu'il faudrait traduire.
  const propre = identifiant.toLowerCase().replace(/[^a-z0-9._@-]/g, '');
  if (!propre) throw new Error(`identifiant vide ou invalide : "${identifiant}"`);
  return `${propre}.${signer(`${version}:${propre}`, secret)}`;
}

export function verifierJeton(jeton, secret, version = '1') {
  secret = String(secret).trim();
  version = String(version).trim();
  const sep = jeton.lastIndexOf('.');
  if (sep < 1) return null;
  const charge = jeton.slice(0, sep);
  const attendue = signer(`${version}:${charge}`, secret);
  return jeton.slice(sep + 1) === attendue ? charge : null;
}

/* ---------- ligne de commande ---------- */

function arg(nom) {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/* Le bloc ci-dessous ne s'exécute que si ce fichier est lancé
   directement. Le garde sur argv[1] est nécessaire : lors d'un import
   depuis un test, argv[1] est undefined et l'appel plantait. */
const lanceDirectement = Boolean(process.argv[1])
  && process.argv[1].replace(/\\/g, '/').endsWith('genere_liens.mjs');

if (lanceDirectement) {

  if (process.argv.includes('--nouveau-secret')) {
    console.log('\nSecret à coller dans la variable Vercel ACCES_SECRET :\n');
    console.log('  ' + base64url(randomBytes(32)));
    console.log('\n  32 octets d\'aléa. Ne le mets dans aucun fichier du dépôt.\n');
    process.exit(0);
  }

  const secret = arg('secret');
  const url = (arg('url') || 'https://TON-PROJET.vercel.app').replace(/\/+$/, '');
  const version = arg('version') || '1';
  const gens = process.argv.slice(2).filter(a => !a.startsWith('--')
    && a !== secret && a !== arg('url') && a !== version);

  if (!secret || gens.length === 0) {
    console.error(`
Usage :
  node genere_liens.mjs --secret <SECRET> --url <URL> patron amadou kso
  node genere_liens.mjs --nouveau-secret

Options :
  --secret   le contenu de ACCES_SECRET (obligatoire)
  --url      l'URL du déploiement Vercel
  --version  doit correspondre à ACCES_VERSION (défaut : 1)
`);
    process.exit(1);
  }

  console.log(`\nLiens personnels — version ${version}\n`);
  for (const g of gens) {
    const jeton = fabriquerJeton(g, secret, version);
    console.log(`  ${g}`);
    console.log(`  ${url}/?k=${jeton}\n`);
  }
  console.log('Envoie à chacun SON lien, et à personne d\'autre.');
  console.log('Chaque lien identifie son porteur dans les journaux Vercel.\n');
}
