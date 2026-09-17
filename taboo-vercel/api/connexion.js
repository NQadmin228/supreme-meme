/* =====================================================================
   TABOO — Connexion
   ---------------------------------------------------------------------
   Le formulaire de connexion poste ici. Cette fonction verifie le
   couple identifiant / mot de passe contre la base des comptes, pose le
   cookie de session et renvoie vers le tableau de bord.

   POURQUOI UNE FONCTION ET PAS LE MIDDLEWARE
   ------------------------------------------
   Deux raisons, et la premiere seule suffirait.

   1. Mesure sur ce runtime : dans le middleware, `requete.formData()`
      renvoie un objet vide pour un corps `application/x-www-form-
      urlencoded` -- ce qu'envoie un formulaire HTML par defaut -- et
      `requete.text()` renvoie une chaine vide. Le corps de la requete
      n'y est tout simplement pas disponible.

   2. scrypt vit dans node:crypto, absent de l'edge. La verification du
      mot de passe ne PEUT pas s'executer dans le middleware.

   La repartition est donc :

     api/connexion.js  verifie le compte, pose le cookie     (ici)
     middleware.js     verifie la signature, autorise le fichier

   Le middleware laisse passer /api/ sans cookie, sinon le formulaire ne
   pourrait jamais etre soumis.
   ===================================================================== */

import {trouverCompte, noterConnexion, journaliser,
        debitDepasse, noterEchec, remettreDebit} from '../lib/base.js';
import {verifier, empreinter} from '../lib/motdepasse.js';
import {emettre, entetePose} from '../lib/session.js';
import {estUnCode, accesEffectif, cheminDe} from '../lib/etablissements.js';

/* Une empreinte fabriquee au demarrage, sur un mot de passe que
   personne ne connait. Elle sert d'epouvantail : quand l'identifiant
   n'existe pas, on verifie quand meme le mot de passe contre elle.

   Sans cela, un compte inconnu repond en 1 ms et un compte connu en
   40 ms : la difference se mesure depuis l'exterieur et donne la liste
   des identifiants valides, ce qui divise par deux le travail d'une
   attaque. */
const EPOUVANTAIL = empreinter(
  'compte inexistant — ' + Math.random().toString(36));

function adresse(req) {
  // x-forwarded-for est une liste « client, proxy1, proxy2 ». Sur
  // Vercel, la premiere entree est l'adresse reelle du client ; les
  // suivantes sont le reseau Vercel. Prendre la derniere limiterait
  // tout le monde ensemble.
  const brut = req.headers['x-forwarded-for'] || '';
  return String(brut).split(',')[0].trim() || null;
}

function versConnexion(res, code, etab) {
  /* `etab` n'est repris que s'il est un code connu : le filtrage a lieu
     chez l'appelant, avec estUnCode(). Une valeur venue du corps de la
     requete qui repartirait telle quelle dans un en-tete Location
     serait une redirection ouverte. */
  // Le chemin de l'etablissement, jamais une valeur venue de la
  // requete : cheminDe() ne rend une adresse que pour un code connu.
  const suite = (etab && cheminDe(etab)) || '/';
  res.setHeader('location', code ? `/?e=${code}` : suite);
  res.setHeader('cache-control', 'no-store');
  // 303 : le navigateur repasse en GET, donc un rafraichissement ne
  // resoumet pas le formulaire.
  res.status(303).end();
}

export default async function handler(req, res) {
  const secret = (process.env.ACCES_SECRET || '').trim();
  const version = (process.env.ACCES_VERSION || '1').trim();

  // Configuration incomplete : on refuse. Un reglage manquant doit
  // fermer l'acces, jamais l'ouvrir.
  if (!secret || !(process.env.DATABASE_URL || '').trim()) {
    res.status(503).send('Configuration incomplete : ACCES_SECRET ou '
      + 'DATABASE_URL est absente.');
    return;
  }

  if (req.method !== 'POST') { versConnexion(res); return; }

  /* req.body est deja analyse par Vercel pour les corps urlencoded et
     JSON. On retombe sur une lecture manuelle sinon, plutot que
     d'echouer sans explication. */
  let corps = req.body;
  if (typeof corps === 'string') corps = Object.fromEntries(new URLSearchParams(corps));
  if (!corps || typeof corps !== 'object') corps = {};

  const identifiant = String(corps.identifiant || '').trim().toLowerCase();
  const fourni = String(corps.mdp || '');
  const ip = adresse(req);

  // L'etablissement que le formulaire transportait, s'il en portait un.
  const voulu = estUnCode(String(corps.etab || '')) ? String(corps.etab) : null;

  /* 1. Le debit avant tout le reste. Repondre « trop de tentatives »
        sans toucher a la base ni a scrypt est precisement ce qui rend
        la limitation utile : une attaque ne doit pas nous couter de
        travail. */
  if (await debitDepasse(ip)) {
    await journaliser({evenement: 'connexion_bloquee', sujet: identifiant || null,
                       ip, detail: 'trop de tentatives'});
    versConnexion(res, 2);
    return;
  }

  /* 2. Le compte */
  const compte = identifiant ? await trouverCompte(identifiant) : null;

  // Le mot de passe est verifie meme quand le compte n'existe pas ou
  // qu'il est desactive : meme travail, donc meme temps de reponse.
  const bon = await verifier(fourni, compte?.empreinte ?? await EPOUVANTAIL);

  if (!compte || !compte.actif || !bon) {
    await noterEchec(ip);
    await journaliser({
      evenement: 'connexion_echec', sujet: identifiant || null, ip,
      // Le detail est pour le journal, pas pour le visiteur : lui recoit
      // toujours le meme message. Distinguer « compte inconnu » de « mot
      // de passe faux » a l'ecran, c'est confirmer les identifiants un
      // par un a qui les essaie.
      detail: !compte ? 'identifiant inconnu'
            : !compte.actif ? 'compte desactive' : 'mot de passe incorrect',
    });
    versConnexion(res, 1);
    return;
  }

  /* 3. Session ouverte */
  await remettreDebit(ip);
  await noterConnexion(compte.identifiant);
  await journaliser({evenement: 'connexion_ok', sujet: compte.identifiant,
                     ip, detail: `role ${compte.role}`});

  res.setHeader('set-cookie', entetePose(await emettre(compte, secret, version)));
  // On ne renvoie vers l'etablissement demande que si ce compte y a
  // droit : sinon la page s'ouvrirait sur un 403 en guise d'accueil.
  versConnexion(res, null,
    accesEffectif(compte).includes(voulu) ? voulu : null);
}
