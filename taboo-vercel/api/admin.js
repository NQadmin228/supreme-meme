/* =====================================================================
   TABOO — Administration des comptes
   ---------------------------------------------------------------------
   Reserve au role admin, verifie ici CONTRE LA BASE a chaque appel (cf.
   lib/garde.js). Le middleware refuse deja /admin.html a un lecteur,
   mais rien n'empeche un lecteur d'appeler cette fonction directement :
   la porte de l'interface et la porte de l'API sont deux portes.

     GET                          comptes + journal
     POST action=creer            nouveau compte, mot de passe tire au sort
     POST action=reinitialiser    nouveau mot de passe tire au sort
     POST action=definir_mdp      mot de passe choisi par l'administrateur
     POST action=modifier         nom, role, actif
     POST action=definir_acces    quels etablissements ce compte voit
     POST action=couper_sessions  revoque les sessions du compte
     POST action=supprimer        efface le compte

   LE MOT DE PASSE N'EST AFFICHE QU'UNE FOIS
   -----------------------------------------
   Les actions qui en produisent un le renvoient dans leur reponse, et
   nulle part ailleurs : la base n'en garde que l'empreinte scrypt. Un
   administrateur qui ferme la fenetre trop vite reinitialise, il ne
   « retrouve » pas -- il n'y a rien a retrouver, et c'est voulu.
   ===================================================================== */

import {listerComptes, creerCompte, changerEmpreinte, modifierCompte,
        supprimerCompte, couperSessions, compterAdmins, trouverCompte,
        definirAcces,
        journaliser, lireJournal, normaliserIdentifiant} from '../lib/base.js';
import {empreinter, motdepasseAcceptable,
        motdepasseTireAuSort} from '../lib/motdepasse.js';
import {exigerSession, corpsDe, adresse} from '../lib/garde.js';
import {emettre, entetePose} from '../lib/session.js';
import {CODES, ETABLISSEMENTS} from '../lib/etablissements.js';

const FORME_IDENTIFIANT = /^[a-z0-9._-]{2,32}$/;

/* Un administrateur a le droit d'agir sur son propre compte : se tirer un
   mot de passe neuf, couper ses sessions ouvertes ailleurs. Ces actions
   incrementent l'epoque -- c'est leur raison d'etre -- et revoquent donc
   AUSSI la session depuis laquelle il vient de cliquer.

   Sans la reemission ci-dessous, la page rappelait l'API une seconde
   plus tard, recevait 401, rechargeait, et recommencait sans fin ; le
   mot de passe fraichement tire n'etait meme jamais affiche, l'exception
   coupant le fil avant. Un bouton qui enferme dehors celui qui l'actionne
   et lui cache le moyen de rentrer.

   api/session.js fait exactement la meme chose apres un changement de
   mot de passe. Les sessions ouvertes AILLEURS tombent bien : c'est le
   comportement voulu. Seule celle qui agit survit. */
async function reemettrePourSoi(res, compte, acteur, epoque) {
  if (compte.identifiant !== acteur) return;
  res.setHeader('set-cookie', entetePose(await emettre(
    {...compte, epoque},
    (process.env.ACCES_SECRET || '').trim(),
    (process.env.ACCES_VERSION || '1').trim())));
}

/* Garde-fou : ne jamais laisser le systeme sans administrateur actif.
   Retrograder, desactiver ou supprimer le dernier admin ferme
   l'administration a tout le monde, et il faudrait la rouvrir par
   base/init.mjs depuis un poste ayant la chaine de connexion. Mieux
   vaut refuser le clic que d'avoir a expliquer la procedure de secours. */
async function retireraitLeDernierAdmin(cible) {
  if (!cible || cible.role !== 'admin' || !cible.actif) return false;
  return (await compterAdmins()) <= 1;
}

export default async function handler(req, res) {
  const sess = await exigerSession(req, res, {admin: true});
  if (!sess) return;

  const acteur = sess.compte.identifiant;
  const ip = adresse(req);
  res.setHeader('cache-control', 'no-store');

  /* ---------- Lecture ---------- */

  if (req.method === 'GET') {
    const [comptes, journal] = await Promise.all([
      listerComptes(),
      lireJournal(Number(req.query?.journal) || 200),
    ]);
    // La liste des etablissements part avec les comptes : si la page en
    // gardait sa propre copie, elle divergerait le jour ou l'on en
    // ajoute un, et personne ne verrait la case a cocher manquante.
    res.json({comptes, journal, moi: acteur, etablissements: ETABLISSEMENTS});
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({erreur: 'Methode non autorisee.'});
    return;
  }

  const corps = corpsDe(req);
  const action = String(corps.action || '');
  const cible = normaliserIdentifiant(corps.identifiant);

  /* ---------- Creation ---------- */

  if (action === 'creer') {
    if (!FORME_IDENTIFIANT.test(cible)) {
      res.status(400).json({erreur: 'Identifiant invalide : minuscules, '
        + 'chiffres, point, tiret ou souligne, de 2 a 32 caracteres.'});
      return;
    }
    const nom = String(corps.nom || '').trim();
    if (!nom) {
      res.status(400).json({erreur: 'Le nom est obligatoire.'});
      return;
    }

    const role = corps.role === 'admin' ? 'admin' : 'lecteur';
    if (await trouverCompte(cible)) {
      res.status(409).json({erreur: 'Le compte « ' + cible + ' » existe deja.'});
      return;
    }

    const motdepasse = motdepasseTireAuSort();
    await creerCompte({identifiant: cible, nom, role, acteur,
                       empreinte: await empreinter(motdepasse)});
    await journaliser({evenement: 'compte_cree', sujet: cible, acteur, ip,
                       detail: 'role ' + role});
    res.json({ok: true, identifiant: cible, motdepasse});
    return;
  }

  /* Toutes les actions suivantes portent sur un compte existant. */
  const compte = cible ? await trouverCompte(cible) : null;
  if (!compte) {
    res.status(404).json({erreur: 'Compte introuvable.'});
    return;
  }

  /* ---------- Mots de passe ---------- */

  if (action === 'reinitialiser' || action === 'definir_mdp') {
    let motdepasse;
    if (action === 'definir_mdp') {
      motdepasse = String(corps.motdepasse || '');
      const probleme = motdepasseAcceptable(motdepasse);
      if (probleme) { res.status(400).json({erreur: probleme}); return; }
    } else {
      motdepasse = motdepasseTireAuSort();
    }

    const maj = await changerEmpreinte(compte.identifiant, await empreinter(motdepasse));
    await journaliser({evenement: 'mdp_reinitialise', sujet: compte.identifiant,
                       acteur, ip, detail: 'par l\'administration'});
    await reemettrePourSoi(res, compte, acteur, maj.epoque);

    // Renvoye seulement quand c'est NOUS qui l'avons tire : un mot de
    // passe choisi par l'administrateur, il l'a deja sous les yeux.
    res.json({ok: true,
              motdepasse: action === 'reinitialiser' ? motdepasse : undefined});
    return;
  }

  /* ---------- Modification ---------- */

  if (action === 'modifier') {
    const nom = corps.nom === undefined ? null : String(corps.nom).trim() || null;
    const role = corps.role === undefined ? null
               : (corps.role === 'admin' ? 'admin' : 'lecteur');
    const actif = corps.actif === undefined ? null : Boolean(corps.actif);

    const perdSonAdmin = (role === 'lecteur' && compte.role === 'admin')
                      || actif === false;
    if (perdSonAdmin && await retireraitLeDernierAdmin(compte)) {
      res.status(409).json({erreur: 'C\'est le dernier administrateur actif. '
        + 'Nommez-en un autre avant de retirer celui-ci.'});
      return;
    }

    const maj = await modifierCompte(compte.identifiant, {nom, role, actif});
    await journaliser({
      evenement: actif === false ? 'compte_desactive' : 'compte_modifie',
      sujet: compte.identifiant, acteur, ip,
      detail: [nom && ('nom=' + nom), role && ('role=' + role),
               actif !== null && ('actif=' + actif)].filter(Boolean).join(' '),
    });
    res.json({ok: true, compte: maj});
    return;
  }

  /* ---------- Etablissements visibles ---------- */

  if (action === 'definir_acces') {
    const demande = Array.isArray(corps.acces) ? corps.acces : [];

    // On filtre contre la liste connue au lieu de refuser : un code
    // inconnu poste par un client desynchronise ne doit pas empecher
    // d'enregistrer les autres. La contrainte SQL reste le dernier mot.
    const codes = CODES.filter(c => demande.includes(c));

    if (compte.role === 'admin') {
      res.status(409).json({erreur: 'Un administrateur voit tous les '
        + 'etablissements. Passez-le lecteur pour restreindre.'});
      return;
    }

    const maj = await definirAcces(compte.identifiant, codes);
    await journaliser({evenement: 'acces_modifie', sujet: compte.identifiant,
                       acteur, ip,
                       detail: codes.length ? codes.join(', ') : 'aucun etablissement'});
    res.json({ok: true, acces: maj.acces});
    return;
  }

  /* ---------- Revocation ---------- */

  if (action === 'couper_sessions') {
    const maj = await couperSessions(compte.identifiant);
    await journaliser({evenement: 'sessions_coupees', sujet: compte.identifiant,
                       acteur, ip});
    await reemettrePourSoi(res, compte, acteur, maj.epoque);
    res.json({ok: true, epoque: maj.epoque});
    return;
  }

  /* ---------- Suppression ---------- */

  if (action === 'supprimer') {
    if (compte.identifiant === acteur) {
      res.status(409).json({erreur: 'On ne supprime pas son propre compte.'});
      return;
    }
    if (await retireraitLeDernierAdmin(compte)) {
      res.status(409).json({erreur: 'C\'est le dernier administrateur actif.'});
      return;
    }
    await supprimerCompte(compte.identifiant);
    /* Journalise APRES coup, et le journal ne porte pas de cle etrangere
       vers utilisateur : il doit survivre a la suppression du compte,
       sinon effacer quelqu'un effacerait aussi la trace de ce qu'il a
       fait -- ce qui est exactement ce qu'on veut empecher. */
    await journaliser({evenement: 'compte_supprime', sujet: compte.identifiant,
                       acteur, ip, detail: 'role ' + compte.role});
    res.json({ok: true});
    return;
  }

  res.status(400).json({erreur: 'Action inconnue.'});
}
