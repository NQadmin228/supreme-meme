/* =====================================================================
   TABOO — Empreintes de mots de passe (scrypt)
   ---------------------------------------------------------------------
   POURQUOI SCRYPT ET PAS SHA-256
   ------------------------------
   SHA-256 est concu pour etre RAPIDE. C'est exactement le defaut qu'on
   ne veut pas ici : une carte graphique en calcule des milliards par
   seconde, donc un mot de passe d'humain tombe en quelques heures si la
   table fuite.

   scrypt est concu pour etre LENT et pour exiger de la memoire. Avec
   N=16384 et r=8, chaque essai coute environ 16 Mo et quelques
   dizaines de millisecondes. Imperceptible pour la personne qui se
   connecte une fois ; ruineux pour qui veut essayer un dictionnaire.

   POURQUOI PAS BCRYPT OU ARGON2
   -----------------------------
   Les deux sont de bons choix, et les deux sont des dependances natives
   a compiler. scrypt est dans node:crypto depuis Node 10 : zero
   dependance, rien a construire au deploiement, rien qui casse a la
   prochaine version de Node. Sur un tableau de bord a cinq comptes, la
   difference de robustesse entre scrypt et argon2id ne se mesure pas ;
   la difference de fragilite au deploiement, si.

   POURQUOI UN SEL PAR COMPTE
   --------------------------
   Sans sel, deux personnes ayant le meme mot de passe ont la meme
   empreinte -- visible d'un coup d'oeil sur la table -- et une table
   pre-calculee les casse toutes les deux d'un coup. Le sel est aleatoire
   et stocke en clair a cote de l'empreinte : son role n'est pas d'etre
   secret, c'est de rendre chaque empreinte unique.

   CE FICHIER EST POUR LE RUNTIME NODE UNIQUEMENT.
   node:crypto n'existe pas sur l'edge. Le middleware ne verifie jamais
   de mot de passe -- seulement des signatures -- donc il n'en a pas
   besoin. Voir lib/session.js, qui lui tourne des deux cotes.
   ===================================================================== */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const N = 16384;   // cout CPU/memoire
const r = 8;       // taille de bloc
const p = 1;       // parallelisme
const LONGUEUR = 32;

// scrypt refuse de travailler si N*r*128 depasse maxmem (32 Mo par
// defaut). A N=16384 et r=8 il faut 16 Mo pour le calcul lui-meme, et
// l'implementation en demande davantage pour ses tampons. On donne 64 Mo
// explicitement, sinon l'appel echoue avec un « memory limit exceeded »
// qui ne dit pas d'ou il vient.
const MAXMEM = 64 * 1024 * 1024;

const b64 = (buf) => Buffer.from(buf).toString('base64');

/* ---------- Fabrication ---------- */

export async function empreinter(motdepasse) {
  const sel = randomBytes(16);
  const cle = await scryptAsync(
    normaliser(motdepasse), sel, LONGUEUR, {N, r, p, maxmem: MAXMEM});
  return `scrypt$${N}$${r}$${p}$${b64(sel)}$${b64(cle)}`;
}

/* ---------- Verification ---------- */
/* Les parametres sont relus DANS l'empreinte, jamais repris des
   constantes ci-dessus. Le jour ou on augmente N, les empreintes deja
   en base continuent de se verifier avec leur ancien cout : sans cela,
   changer une constante deconnecterait tout le monde definitivement. */

export async function verifier(motdepasse, empreinte) {
  if (typeof empreinte !== 'string') return false;

  const parts = empreinte.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, sN, sr, sp, sel64, attendu64] = parts;
  const pN = Number(sN), pr = Number(sr), pp = Number(sp);
  if (!Number.isInteger(pN) || !Number.isInteger(pr) || !Number.isInteger(pp)) {
    return false;
  }
  // Une empreinte falsifiee pourrait demander N=2^30 et bloquer le
  // serveur : on borne avant de calculer.
  if (pN > 1 << 20 || pr > 32 || pp > 16) return false;

  let attendu;
  try {
    attendu = Buffer.from(attendu64, 'base64');
  } catch { return false; }
  if (attendu.length === 0) return false;

  let calcule;
  try {
    calcule = await scryptAsync(
      normaliser(motdepasse), Buffer.from(sel64, 'base64'),
      attendu.length, {N: pN, r: pr, p: pp, maxmem: MAXMEM});
  } catch { return false; }

  // Comparaison a temps constant : une comparaison ordinaire s'arrete au
  // premier octet different et le temps de reponse revele alors combien
  // d'octets sont corrects.
  return timingSafeEqual(Buffer.from(calcule), attendu);
}

/* ---------- Normalisation ---------- */

function normaliser(motdepasse) {
  // NFKC : « é » saisi comme un seul caractere et « é » saisi comme e +
  // accent combinant sont visuellement identiques et donnent deux
  // empreintes differentes. Sans cette ligne, un mot de passe accentue
  // marche depuis un clavier et pas depuis un autre.
  // Pas de .trim() : un espace final est un caractere du mot de passe
  // comme un autre, et le rogner reduit silencieusement l'entropie.
  return String(motdepasse).normalize('NFKC');
}

/* ---------- Exigence minimale ---------- */

export function motdepasseAcceptable(motdepasse) {
  const m = String(motdepasse ?? '');
  if (m.length < 12) {
    return 'Le mot de passe doit faire au moins 12 caracteres.';
  }
  if (m.length > 200) {
    // Borne haute : scrypt accepte n'importe quelle longueur, mais un
    // corps de requete de 10 Mo ne doit pas devenir un calcul de 10 Mo.
    return 'Le mot de passe ne doit pas depasser 200 caracteres.';
  }
  // Longueur seulement, pas de « une majuscule et un chiffre » : cette
  // regle-la pousse a « Password1! », qui est plus court a casser qu'une
  // phrase de quatre mots. La longueur est ce qui compte.
  return null;
}

/* ---------- Mot de passe tire au sort ---------- */

/* Quatre mots plutot qu'une suite de symboles. « ardoise-bitume-clameur-
   dorure » se retient, se dicte au telephone sans epeler, et vaut ~24
   bits par mot avec ce dictionnaire, soit plus de 90 bits au total.
   « Kx7$pL2! » en vaut moins de 50 et finit recopie sur un post-it
   parce que personne ne le retient. */
const MOTS = ('ardoise bitume clameur dorure ecluse falaise girofle hameau '
  + 'ivoire jonquille kiosque lanterne marelle nacelle orgue pivoine '
  + 'quinconce rotonde sarment tilleul ustensile varech wagon xylophone '
  + 'yole zephyr abside brasier cimaise dune encrier fanal gabarit '
  + 'houle isthme jardin kermesse loupe menhir noria oasis pergola '
  + 'quiproquo ruisseau silex torrent ulve vergue welche zinnia').split(' ');

export function motdepasseTireAuSort(n = 4) {
  const choisis = [];
  // Rejet des valeurs qui debordent le dernier bloc complet de 256. Un
  // simple % biaiserait le tirage vers les premiers mots de la liste, et
  // un biais dans un generateur de mots de passe ne se voit jamais a
  // l'oeil : il se voit dans le temps que met une attaque.
  const limite = 256 - (256 % MOTS.length);
  for (let i = 0; i < n; i++) {
    let v;
    do { v = randomBytes(1)[0]; } while (v >= limite);
    choisis.push(MOTS[v % MOTS.length]);
  }
  return choisis.join('-');
}
