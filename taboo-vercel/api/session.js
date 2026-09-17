/* =====================================================================
   TABOO — Ce que chacun peut faire sur son propre compte
   ---------------------------------------------------------------------
     GET                        qui suis-je
     POST action=deconnexion    fermer la session
     POST action=changer_mdp    changer SON mot de passe

   POURQUOI CE FICHIER EST SEPARE DE api/admin.js
   ----------------------------------------------
   Parce que la regle d'acces n'est pas la meme, et qu'une regle d'acces
   qui varie a l'interieur d'un meme fichier finit par etre oubliee sur
   une branche. Ici : toute session valide est admise, et personne n'agit
   sur un autre compte que le sien. Dans api/admin.js : role admin
   obligatoire, sur n'importe quel compte. Deux fichiers, deux phrases.

   L'identifiant traite est TOUJOURS `sess.i`, celui du cookie signe.
   Jamais un identifiant lu dans le corps de la requete -- sinon
   « changer mon mot de passe » deviendrait « changer celui de qui je
   veux », qui est le bogue d'autorisation le plus banal qui soit.
   ===================================================================== */

import {changerEmpreinte, journaliser} from '../lib/base.js';
import {verifier, empreinter, motdepasseAcceptable} from '../lib/motdepasse.js';
import {emettre, entetePose, enteteEfface} from '../lib/session.js';
import {exigerSession, corpsDe, adresse} from '../lib/garde.js';
import {ETABLISSEMENTS} from '../lib/etablissements.js';

export default async function handler(req, res) {
  const sess = await exigerSession(req, res);
  if (!sess) return;

  const compte = sess.compte;
  const ip = adresse(req);
  res.setHeader('cache-control', 'no-store');

  if (req.method === 'GET') {
    /* `acces` vient de la SESSION, pas de la base : c'est exactement la
       liste que le middleware appliquera aux fichiers de donnees. En
       renvoyer une autre ferait proposer au lecteur un etablissement
       dont le chargement echouerait ensuite en 403. */
    res.json({identifiant: compte.identifiant, nom: compte.nom,
              role: compte.role, acces: sess.a,
              etablissements: ETABLISSEMENTS.filter(e => sess.a.includes(e.code)),
              expire: sess.x});
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({erreur: 'Methode non autorisee.'});
    return;
  }

  const corps = corpsDe(req);

  /* ---------- Deconnexion ---------- */

  if (corps.action === 'deconnexion') {
    await journaliser({evenement: 'deconnexion', sujet: compte.identifiant, ip});
    res.setHeader('set-cookie', enteteEfface());
    res.json({ok: true});
    return;
  }

  /* ---------- Changer son mot de passe ---------- */

  if (corps.action === 'changer_mdp') {
    // L'ancien mot de passe est exige meme si la session est valide. Un
    // poste laisse ouvert deux minutes suffirait sinon a se substituer
    // definitivement a son proprietaire.
    if (!await verifier(String(corps.ancien || ''), compte.empreinte)) {
      await journaliser({evenement: 'mdp_refuse', sujet: compte.identifiant,
                         ip, detail: 'ancien mot de passe incorrect'});
      res.status(403).json({erreur: 'Mot de passe actuel incorrect.'});
      return;
    }

    const nouveau = String(corps.nouveau || '');
    const probleme = motdepasseAcceptable(nouveau);
    if (probleme) { res.status(400).json({erreur: probleme}); return; }

    if (await verifier(nouveau, compte.empreinte)) {
      res.status(400).json({erreur: 'Le nouveau mot de passe est identique '
                                  + 'a l\'ancien.'});
      return;
    }

    const maj = await changerEmpreinte(compte.identifiant, await empreinter(nouveau));
    await journaliser({evenement: 'mdp_change', sujet: compte.identifiant, ip});

    /* changerEmpreinte incremente l'epoque, ce qui revoque toutes les
       sessions du compte -- y compris CELLE-CI. On reemet donc un cookie
       a la nouvelle epoque, sinon changer son mot de passe se
       deconnecterait soi-meme immediatement apres. Les sessions du meme
       compte ouvertes AILLEURS, elles, tombent bien : c'est le
       comportement attendu apres un mot de passe compromis. */
    res.setHeader('set-cookie', entetePose(await emettre(
      {...compte, epoque: maj.epoque},
      (process.env.ACCES_SECRET || '').trim(),
      (process.env.ACCES_VERSION || '1').trim())));

    res.json({ok: true});
    return;
  }

  res.status(400).json({erreur: 'Action inconnue.'});
}
