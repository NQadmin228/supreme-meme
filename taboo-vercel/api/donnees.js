/* =====================================================================
   TABOO — Les jeux de donnees d'un etablissement
   ---------------------------------------------------------------------
     GET /donnees/<etablissement>/<jeu>.json
         reecrit par vercel.json en /api/donnees?etab=...&fichier=...

   POURQUOI UNE FONCTION ET PLUS DES FICHIERS STATIQUES
   ----------------------------------------------------
   Les fichiers montaient avec le site, televerses depuis un poste par
   `vercel --prod`. Le site se construit maintenant depuis le depot
   GitHub, qui est public : les donnees ne peuvent plus voyager avec le
   code. Elles sont publiees dans Neon (base/schema.sql, jeu_donnees) et
   servies ici.

   L'adresse n'a pas change. Le chargeur et le gabarit demandent
   toujours donnees/<code>/<jeu>.json ; seule la reecriture sait que la
   reponse vient d'une fonction.

   QUI A LE DROIT DE LIRE
   ----------------------
   Le middleware refusait deja les chemins /donnees/<code>/ a qui n'a
   pas ce code dans son cookie. Cette fonction refait le controle, et
   plus strictement : exigerSession relit le compte en base, et l'acces
   vient de la BASE, pas du cookie. Retirer un etablissement a quelqu'un
   lui coupe donc les chiffres a la requete suivante, la ou le cookie
   seul l'aurait laisse lire jusqu'a douze heures.

   LA TAILLE
   ---------
   Une fonction plafonne a 4,5 Mo de reponse. Le plus gros jeu en fait
   1,9 ; 60_publier_donnees.py refuse d'en publier un qui depasserait,
   plutot que de laisser la page echouer chez le lecteur.
   ===================================================================== */

import {lireJeu} from '../lib/base.js';
import {exigerSession, jsonRefus} from '../lib/garde.js';
import {estUnCode, accesEffectif} from '../lib/etablissements.js';

// La meme forme que la contrainte de la table : un nom qui ne la
// respecte pas ne peut correspondre a aucune ligne, inutile d'interroger.
const NOM = /^[a-z0-9_]{1,60}$/;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('allow', 'GET, HEAD');
    return jsonRefus(res, 405, 'Methode non autorisee.');
  }

  const sess = await exigerSession(req, res);
  if (!sess) return;

  const etab = String(req.query.etab || '');
  const fichier = String(req.query.fichier || '');
  const nom = fichier.endsWith('.json') ? fichier.slice(0, -5) : '';
  if (!estUnCode(etab) || !NOM.test(nom)) {
    return jsonRefus(res, 404, 'Jeu de donnees inconnu.');
  }
  if (!accesEffectif(sess.compte).includes(etab)) {
    return jsonRefus(res, 403, 'Acces refuse a cet etablissement.');
  }

  let jeu;
  try {
    jeu = await lireJeu(etab, nom);
  } catch (e) {
    console.error('lecture jeu_donnees :', e.message);
    return jsonRefus(res, 503, 'Donnees momentanement indisponibles.');
  }
  if (!jeu) return jsonRefus(res, 404, 'Jeu de donnees non publie.');

  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'private, no-store');
  // Ce qu'il faut pour diagnostiquer « je ne vois pas les derniers
  // chiffres » sans ouvrir la base : la date et l'empreinte publiees.
  res.setHeader('x-donnees-publiees', new Date(jeu.publie_le).toISOString());
  res.setHeader('x-donnees-empreinte', jeu.empreinte);
  res.status(200);
  if (req.method === 'HEAD') return res.end();
  return res.end(jeu.contenu);
}
