/* =====================================================================
   TABOO — Garde des fonctions d'API
   ---------------------------------------------------------------------
   Le middleware refuse deja /admin.html a qui n'est pas administrateur.
   Ce fichier refait le meme controle sur les fonctions /api/admin.

   POURQUOI DEUX FOIS
   ------------------
   Parce que ce ne sont pas les memes portes. Le middleware protege la
   PAGE ; il ne protege pas l'appel `fetch('/api/admin')` qu'on peut
   emettre depuis n'importe quel onglet, sans jamais charger la page.

   Un controle qui n'existe que dans l'interface -- bouton cache, route
   non affichee -- ne protege rien du tout : il rend l'action moins
   visible, pas moins possible. La regle tient en une phrase : chaque
   fonction verifie elle-meme qui l'appelle, sans supposer par ou
   l'appel est passe.
   ===================================================================== */

import {lire, cookieDepuisEntete, enteteEfface} from './session.js';
import {trouverCompte} from './base.js';

export function adresse(req) {
  const brut = req.headers['x-forwarded-for'] || '';
  return String(brut).split(',')[0].trim() || null;
}

export function jsonRefus(res, code, message) {
  res.status(code)
     .setHeader('cache-control', 'no-store');
  res.json({erreur: message});
  return null;
}

/* Refus AVEC effacement du cookie.

   A reserver aux sessions dont la signature est bonne mais qui ne valent
   plus rien : compte desactive, epoque perimee. Le navigateur les garde
   sinon jusqu'a leur expiration, et le middleware -- qui ne consulte pas
   la base -- continue de les accepter pour servir la page.

   Sans cet effacement, une page qui recharge apres un 401 recharge pour
   toujours : le middleware sert la page, la page rappelle l'API, l'API
   repond 401, la page recharge. C'est exactement ce qui arrivait a un
   administrateur qui se reinitialisait son propre mot de passe. Le
   cookie efface, le rechargement suivant tombe sur le formulaire de
   connexion, qui est ce qu'il faut montrer a quelqu'un dont la session
   vient d'etre revoquee. */
export function jsonPerime(res, code, message) {
  res.setHeader('set-cookie', enteteEfface());
  return jsonRefus(res, code, message);
}

/* Renvoie la charge de session, ou null APRES avoir deja repondu.
   L'appelant n'a qu'a ecrire :

     const sess = await exigerSession(req, res, {admin: true});
     if (!sess) return;

   Il ne peut donc pas oublier de renvoyer une reponse, ni continuer
   avec une session absente. */
export async function exigerSession(req, res, {admin = false} = {}) {
  const secret = (process.env.ACCES_SECRET || '').trim();
  const version = (process.env.ACCES_VERSION || '1').trim();

  if (!secret || !(process.env.DATABASE_URL || '').trim()) {
    return jsonRefus(res, 503, 'Configuration incomplete cote serveur.');
  }

  const jeton = cookieDepuisEntete(req.headers.cookie);
  const sess = await lire(jeton, secret, version);

  if (!sess) return jsonRefus(res, 401, 'Session absente ou expiree.');

  /* Confrontation a la base.

     Le middleware ne peut pas faire cette verification -- il s'execute
     sur chaque requete et ne doit pas ouvrir de connexion -- donc un
     cookie emis avant une desactivation continue d'ouvrir index.html
     jusqu'a son expiration. C'est le compromis assume, et il est borne
     par les 12 heures de DUREE_SESSION.

     Mais une FONCTION, elle, parle deja a Postgres : refuser ici ne
     coute rien de plus. Sans ces lignes, l'epoque et le drapeau `actif`
     ne seraient enregistres nulle part qui les relise, et « couper les
     sessions » serait un bouton qui ne fait rien. Un compte desactive
     perd donc immediatement le droit d'AGIR ; il garde au pire douze
     heures le droit de LIRE la page deja autorisee. */
  const compte = await trouverCompte(sess.i);
  if (!compte || !compte.actif) {
    return jsonPerime(res, 401, 'Compte desactive.');
  }
  if (compte.epoque !== sess.e) {
    return jsonPerime(res, 401, 'Session revoquee. Reconnectez-vous.');
  }

  // Le role vient de la BASE, pas du cookie. Une personne retrogradee
  // pendant sa session ne garde pas ses droits jusqu'a l'expiration du
  // cookie qui la dit encore admin.
  if (admin && compte.role !== 'admin') {
    return jsonRefus(res, 403, 'Reserve a l\'administration.');
  }

  return {...sess, r: compte.role, compte};
}

/* Vercel analyse deja les corps JSON et urlencoded. Cette fonction
   couvre le cas ou il ne l'a pas fait, plutot que de lever une erreur
   illisible sur `corps.action` d'un undefined. */
export function corpsDe(req) {
  let corps = req.body;
  if (typeof corps === 'string') {
    try { corps = JSON.parse(corps); }
    catch { corps = Object.fromEntries(new URLSearchParams(corps)); }
  }
  return (corps && typeof corps === 'object') ? corps : {};
}
