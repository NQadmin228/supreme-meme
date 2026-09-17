/* =====================================================================
   TABOO — Le cookie de session
   ---------------------------------------------------------------------
   UN SEUL FICHIER POUR DEUX RUNTIMES
   ----------------------------------
   Ce module est importe par le middleware (edge) ET par les fonctions
   (Node). Il n'utilise donc que WebCrypto (crypto.subtle), present des
   deux cotes, et jamais node:crypto, absent de l'edge.

   Ce n'est pas un detail de portabilite, c'est la lecon du mecanisme
   precedent : il signait ses jetons avec node:crypto dans un outil en
   ligne de commande et les verifiait avec WebCrypto dans le
   middleware. Deux implementations du meme calcul, maintenues en
   parallele, avec un commentaire dans chacune pour rappeler que si
   l'une applique .trim() et pas l'autre, toutes les signatures
   divergent d'un coup. Une seule implementation rend cette classe de
   bogue impossible plutot que documentee.

   CE QUE LE COOKIE TRANSPORTE
   ---------------------------
     v2.<charge>.<signature>

   La charge est du JSON encode en base64url :
     i  identifiant du compte
     r  role  (admin | lecteur)
     a  etablissements accessibles, ex. ['taboo']
     e  epoque du compte
     x  expiration, en secondes epoch
     v  ACCES_VERSION au moment de l'emission

   Elle est LISIBLE par qui detient le cookie -- ce n'est pas du
   chiffrement. Elle est seulement INFALSIFIABLE : sans le secret, on ne
   peut pas produire de signature valide, donc pas se promouvoir admin
   en editant le r. On n'y met donc rien de confidentiel, et surtout
   jamais le mot de passe.

   POURQUOI Y METTRE LE ROLE
   -------------------------
   Pour que le middleware puisse refuser /admin.html a un lecteur sans
   consulter la base. C'est ce qui permet a la page d'administration
   d'etre un actif statique servi par le CDN, au lieu d'une fonction qui
   devrait relire Postgres a chaque chargement.

   POURQUOI L'EXPIRATION EST SIGNEE
   --------------------------------
   Le Max-Age d'un cookie est une consigne au navigateur, pas une
   contrainte. Qui recopie la valeur du cookie s'affranchit du Max-Age.
   L'expiration signee, elle, est verifiee par le serveur : c'est la
   seule des deux qui limite reellement la duree de vie.
   ===================================================================== */

import {accesEffectif} from './etablissements.js';

// 12 heures. Descendu depuis 7 jours en meme temps que les comptes sont
// passes en base : le middleware ne relisant pas la base, un mot de
// passe change ne coupe la session en cours qu'a cette echeance. La
// duree du cookie EST donc le delai de revocation.
export const DUREE_SESSION = 12 * 60 * 60;

export const NOM_COOKIE = 'taboo_session';

/* ---------- Encodage ---------- */

const encodeur = new TextEncoder();
const decodeur = new TextDecoder();

function versBase64url(octets) {
  let s = '';
  const v = new Uint8Array(octets);
  for (let i = 0; i < v.length; i++) s += String.fromCharCode(v[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function depuisBase64url(texte) {
  const s = String(texte).replace(/-/g, '+').replace(/_/g, '/');
  const brut = atob(s + '='.repeat((4 - s.length % 4) % 4));
  const v = new Uint8Array(brut.length);
  for (let i = 0; i < brut.length; i++) v[i] = brut.charCodeAt(i);
  return v;
}

/* ---------- Signature ---------- */

async function signer(message, secret) {
  const cle = await crypto.subtle.importKey(
    'raw', encodeur.encode(secret),
    {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return versBase64url(
    await crypto.subtle.sign('HMAC', cle, encodeur.encode(message)));
}

/* Comparaison a temps constant. Une comparaison ordinaire s'arrete au
   premier caractere different : le temps de reponse revele alors combien
   de caracteres sont corrects, ce qui permet de reconstruire une
   signature valide caractere par caractere. */
function egalConstant(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---------- Emission ---------- */

export async function emettre(compte, secret, version) {
  const charge = {
    i: compte.identifiant,
    r: compte.role,
    // Les etablissements accessibles voyagent dans le cookie pour la
    // meme raison que le role : le middleware doit pouvoir refuser
    // /donnees/amnesia/ a qui n'y a pas droit, sans ouvrir de connexion
    // a Postgres sur une requete de fichier statique.
    a: accesEffectif(compte),
    e: compte.epoque,
    x: Math.floor(Date.now() / 1000) + DUREE_SESSION,
    v: String(version).trim(),
  };
  const encodee = versBase64url(encodeur.encode(JSON.stringify(charge)));
  return `v2.${encodee}.${await signer(encodee, secret)}`;
}

/* ---------- Lecture ---------- */
/* Renvoie la charge si le jeton est authentique et non expire, sinon
   null. Aucune variante intermediaire : un appelant qui recoit un objet
   sait qu'il est valide, il ne peut pas oublier de verifier un drapeau. */

export async function lire(jeton, secret, version) {
  if (typeof jeton !== 'string') return null;

  const parts = jeton.split('.');
  if (parts.length !== 3 || parts[0] !== 'v2') return null;

  const [, encodee, signature] = parts;

  // La signature d'abord, le contenu ensuite. Analyser du JSON non
  // authentifie, c'est exposer l'analyseur a n'importe qui.
  if (!egalConstant(signature, await signer(encodee, secret))) return null;

  let charge;
  try {
    charge = JSON.parse(decodeur.decode(depuisBase64url(encodee)));
  } catch { return null; }

  if (!charge || typeof charge !== 'object') return null;

  // Coupure globale : incrementer ACCES_VERSION sur Vercel invalide
  // toutes les sessions en cours, sans toucher a la base.
  if (String(charge.v) !== String(version).trim()) return null;

  if (!Number.isFinite(charge.x) || charge.x <= Date.now() / 1000) return null;
  if (charge.r !== 'admin' && charge.r !== 'lecteur') return null;
  if (typeof charge.i !== 'string' || !charge.i) return null;

  /* Les droits d'etablissement sont normalises ici, une fois, plutot
     que verifies par chaque appelant. Un cookie emis avant l'ajout du
     champ n'en a pas : il vaut alors « aucun acces », jamais « tous ».
     Le reflexe inverse -- absent donc permissif -- est ce qui ouvre les
     portes en silence lors d'une montee de version. */
  charge.a = Array.isArray(charge.a)
    ? charge.a.filter(c => typeof c === 'string') : [];

  return charge;
}

/* ---------- En-tetes ---------- */

export function entetePose(jeton) {
  return `${NOM_COOKIE}=${jeton}; Path=/; Max-Age=${DUREE_SESSION}; `
       + `HttpOnly; Secure; SameSite=Lax`;
}

export function enteteEfface() {
  return `${NOM_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function cookieDepuisEntete(entete) {
  const trouve = String(entete || '').split(';').map(c => c.trim())
    .find(c => c.startsWith(`${NOM_COOKIE}=`));
  return trouve ? trouve.slice(NOM_COOKIE.length + 1) : null;
}
