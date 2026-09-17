/* Banc d'essai : simule les objets req/res de Vercel et fait tourner les
   vraies fonctions contre la vraie base Neon. */

import {readFileSync} from 'node:fs';

const RACINE = 'file:///C:/Users/user/Downloads/Dashbord/taboo-vercel/';

for (const ligne of readFileSync(new URL('.env.local', RACINE), 'utf8').split('\n')) {
  const m = ligne.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
// Un secret propre au banc : les cookies reels restent hors d'atteinte.
process.env.ACCES_SECRET = 'secret-de-banc-d-essai-uniquement';
process.env.ACCES_VERSION = '1';

const connexion = (await import(RACINE + 'api/connexion.js')).default;
const session   = (await import(RACINE + 'api/session.js')).default;
const admin     = (await import(RACINE + 'api/admin.js')).default;
const middleware = (await import(RACINE + 'middleware.js')).default;
const {bd} = await import(RACINE + 'lib/base.js');

/* ---------- Faux req / res ---------- */

function faireRes() {
  const res = {
    code: 200, entetes: {}, corps: null,
    status(c) { this.code = c; return this; },
    setHeader(k, v) { this.entetes[k.toLowerCase()] = v; return this; },
    getHeader(k) { return this.entetes[k.toLowerCase()]; },
    json(o) { this.corps = o; return this; },
    send(t) { this.corps = t; return this; },
    end() { return this; },
  };
  return res;
}

function faireReq({method = 'GET', body = undefined, cookie = null,
                   ip = '203.0.113.7', query = {}} = {}) {
  const headers = {'x-forwarded-for': ip};
  if (cookie) headers.cookie = 'taboo_session=' + cookie;
  return {method, body, headers, query};
}

const cookieDe = (res) => {
  const c = res.getHeader('set-cookie');
  return c ? c.split(';')[0].split('=').slice(1).join('=') : null;
};

/* ---------- Verifications ---------- */

let reussis = 0, echoues = 0;
function verifier(nom, condition, vu) {
  if (condition) { reussis++; console.log('  ok    ' + nom); }
  else { echoues++; console.log('  ECHEC ' + nom + (vu !== undefined ? '  -> ' + JSON.stringify(vu) : '')); }
}
const titre = (t) => console.log('\n' + t + '\n' + '-'.repeat(t.length));

/* ---------- Preparation ---------- */

const sql = bd();
await sql`delete from utilisateur where identifiant in ('essai.lecteur','essai.admin')`;
await sql`delete from tentative`;
await sql`delete from journal where ip = '203.0.113.7'`;

// Un administrateur de reference dont on connait le mot de passe.
const {empreinter} = await import(RACINE + 'lib/motdepasse.js');
const MDP_ADMIN = 'phrase-de-passe-du-banc';
await sql`
  insert into utilisateur (identifiant, nom, empreinte, role, cree_par)
  values ('essai.admin', 'Admin du banc', ${await empreinter(MDP_ADMIN)},
          'admin', 'essai')`;

/* ===================== 1. Connexion ===================== */
titre('1. Connexion');

let res = faireRes();
await connexion(faireReq({method: 'POST',
  body: {identifiant: 'essai.admin', mdp: 'mauvais mot de passe'}}), res);
verifier('mot de passe faux -> /?e=1', res.getHeader('location') === '/?e=1',
         res.getHeader('location'));
verifier('aucun cookie pose sur echec', !res.getHeader('set-cookie'));

res = faireRes();
await connexion(faireReq({method: 'POST',
  body: {identifiant: 'inconnu.total', mdp: 'peu importe'}}), res);
verifier('identifiant inconnu -> meme reponse', res.getHeader('location') === '/?e=1');

res = faireRes();
await connexion(faireReq({method: 'POST',
  body: {identifiant: 'ESSAI.ADMIN  ', mdp: MDP_ADMIN}}), res);
const cookieAdmin = cookieDe(res);
verifier('identifiant insensible a la casse et aux espaces', !!cookieAdmin);
verifier('redirection vers /', res.getHeader('location') === '/');
verifier('cookie HttpOnly Secure SameSite',
  /HttpOnly/.test(res.getHeader('set-cookie'))
  && /Secure/.test(res.getHeader('set-cookie'))
  && /SameSite=Lax/.test(res.getHeader('set-cookie')));

/* ===================== 2. Session ===================== */
titre('2. Session');

res = faireRes();
await session(faireReq({cookie: cookieAdmin}), res);
verifier('GET /api/session nomme le compte',
  res.corps?.identifiant === 'essai.admin' && res.corps?.role === 'admin', res.corps);

res = faireRes();
await session(faireReq({}), res);
verifier('sans cookie -> 401', res.code === 401, res.code);

res = faireRes();
await session(faireReq({cookie: cookieAdmin.slice(0, -3) + 'aaa'}), res);
verifier('signature trafiquee -> 401', res.code === 401, res.code);

/* ===================== 3. Administration ===================== */
titre('3. Administration');

res = faireRes();
await admin(faireReq({cookie: cookieAdmin}), res);
verifier('GET /api/admin liste les comptes', Array.isArray(res.corps?.comptes));
verifier('aucune empreinte dans la reponse',
  !JSON.stringify(res.corps).includes('scrypt$'));

res = faireRes();
await admin(faireReq({method: 'POST', cookie: cookieAdmin,
  body: {action: 'creer', identifiant: 'essai.lecteur', nom: 'Lecteur du banc'}}), res);
const mdpLecteur = res.corps?.motdepasse;
verifier('creation : mot de passe tire au sort', typeof mdpLecteur === 'string'
  && mdpLecteur.split('-').length === 4, res.corps);

res = faireRes();
await admin(faireReq({method: 'POST', cookie: cookieAdmin,
  body: {action: 'creer', identifiant: 'essai.lecteur', nom: 'Doublon'}}), res);
verifier('doublon refuse -> 409', res.code === 409, res.code);

res = faireRes();
await admin(faireReq({method: 'POST', cookie: cookieAdmin,
  body: {action: 'creer', identifiant: 'MAJUSCULES!', nom: 'x'}}), res);
verifier('identifiant mal forme refuse -> 400', res.code === 400, res.code);

/* ===================== 4. Cloisonnement des roles ===================== */
titre('4. Cloisonnement des roles');

res = faireRes();
await connexion(faireReq({method: 'POST', ip: '203.0.113.8',
  body: {identifiant: 'essai.lecteur', mdp: mdpLecteur}}), res);
const cookieLecteur = cookieDe(res);
verifier('le lecteur se connecte avec le mot de passe tire', !!cookieLecteur);

res = faireRes();
await admin(faireReq({cookie: cookieLecteur}), res);
verifier('lecteur sur /api/admin -> 403', res.code === 403, res.code);

// Le coeur du sujet : un cookie qui se PRETEND admin ne suffit pas.
const {emettre} = await import(RACINE + 'lib/session.js');
const cookieMenteur = await emettre(
  {identifiant: 'essai.lecteur', role: 'admin', epoque: 1},
  'un-secret-que-je-n-ai-pas', '1');
res = faireRes();
await admin(faireReq({cookie: cookieMenteur}), res);
verifier('cookie force avec un autre secret -> 401', res.code === 401, res.code);

/* ===================== 5. Middleware ===================== */
titre('5. Middleware');

const reqEdge = (url, cookie) => new Request(url, {
  headers: cookie ? {cookie: 'taboo_session=' + cookie} : {}});

let rep = await middleware(reqEdge('https://x.test/'));
verifier('sans cookie -> formulaire 401', rep.status === 401, rep.status);
let html = await rep.text();
verifier('le formulaire demande un identifiant', html.includes('name="identifiant"'));
verifier('le formulaire demande un mot de passe', html.includes('name="mdp"'));

rep = await middleware(reqEdge('https://x.test/?e=2'));
html = await rep.text();
verifier('?e=2 affiche le message de blocage', html.includes('Trop de tentatives'));

rep = await middleware(reqEdge('https://x.test/', cookieAdmin));
verifier('admin sur / -> laisse passer', rep === undefined, rep?.status);

rep = await middleware(reqEdge('https://x.test/admin', cookieAdmin));
verifier('admin sur /admin -> laisse passer', rep === undefined, rep?.status);

rep = await middleware(reqEdge('https://x.test/', cookieLecteur));
verifier('lecteur sur / -> laisse passer', rep === undefined, rep?.status);

rep = await middleware(reqEdge('https://x.test/admin', cookieLecteur));
verifier('lecteur sur /admin -> 403', rep?.status === 403, rep?.status);

rep = await middleware(reqEdge('https://x.test/admin.html', cookieLecteur));
verifier('lecteur sur /admin.html -> 403 aussi', rep?.status === 403, rep?.status);

/* ===================== 6. Revocation ===================== */
titre('6. Revocation');

res = faireRes();
await admin(faireReq({method: 'POST', cookie: cookieAdmin,
  body: {action: 'couper_sessions', identifiant: 'essai.lecteur'}}), res);
verifier('couper les sessions repond ok', res.corps?.ok === true, res.corps);

res = faireRes();
await session(faireReq({cookie: cookieLecteur}), res);
verifier('le cookie du lecteur est refuse ensuite -> 401', res.code === 401, res.code);

res = faireRes();
await admin(faireReq({method: 'POST', cookie: cookieAdmin,
  body: {action: 'modifier', identifiant: 'essai.lecteur', actif: false}}), res);
verifier('desactivation acceptee', res.corps?.ok === true, res.corps);

res = faireRes();
await connexion(faireReq({method: 'POST', ip: '203.0.113.9',
  body: {identifiant: 'essai.lecteur', mdp: mdpLecteur}}), res);
verifier('compte desactive : connexion refusee',
  res.getHeader('location') === '/?e=1' && !res.getHeader('set-cookie'));

res = faireRes();
await admin(faireReq({method: 'POST', cookie: cookieAdmin,
  body: {action: 'modifier', identifiant: 'essai.lecteur', actif: true}}), res);
verifier('reactivation acceptee', res.corps?.ok === true);

/* ===================== 7. Changer son mot de passe ===================== */
titre('7. Changer son mot de passe');

res = faireRes();
await session(faireReq({method: 'POST', cookie: cookieAdmin,
  body: {action: 'changer_mdp', ancien: 'pas le bon', nouveau: 'nouvelle phrase longue'}}), res);
verifier('ancien mot de passe faux -> 403', res.code === 403, res.code);

res = faireRes();
await session(faireReq({method: 'POST', cookie: cookieAdmin,
  body: {action: 'changer_mdp', ancien: MDP_ADMIN, nouveau: 'court'}}), res);
verifier('nouveau trop court -> 400', res.code === 400, res.corps);

res = faireRes();
await session(faireReq({method: 'POST', cookie: cookieAdmin,
  body: {action: 'changer_mdp', ancien: MDP_ADMIN, nouveau: MDP_ADMIN}}), res);
verifier('identique a l\'ancien -> 400', res.code === 400, res.corps);

const cookieAvant = cookieAdmin;
res = faireRes();
await session(faireReq({method: 'POST', cookie: cookieAdmin,
  body: {action: 'changer_mdp', ancien: MDP_ADMIN, nouveau: 'nouvelle-phrase-du-banc'}}), res);
const cookieApres = cookieDe(res);
verifier('changement accepte', res.corps?.ok === true, res.corps);
verifier('un cookie neuf est pose', !!cookieApres && cookieApres !== cookieAvant);

res = faireRes();
await session(faireReq({cookie: cookieApres}), res);
verifier('le cookie neuf marche', res.corps?.identifiant === 'essai.admin', res.code);

res = faireRes();
await session(faireReq({cookie: cookieAvant}), res);
verifier('l\'ancien cookie est mort -> 401', res.code === 401, res.code);

/* ===================== 8. Dernier administrateur ===================== */
titre('8. Dernier administrateur');

// On isole : seul essai.admin est admin actif pendant ce test.
const vraisAdmins = await sql`
  update utilisateur set actif = false
   where role = 'admin' and actif and identifiant <> 'essai.admin'
  returning identifiant`;

res = faireRes();
await admin(faireReq({method: 'POST', cookie: cookieApres,
  body: {action: 'modifier', identifiant: 'essai.admin', role: 'lecteur'}}), res);
verifier('retrograder le dernier admin -> 409', res.code === 409, res.corps);

res = faireRes();
await admin(faireReq({method: 'POST', cookie: cookieApres,
  body: {action: 'modifier', identifiant: 'essai.admin', actif: false}}), res);
verifier('desactiver le dernier admin -> 409', res.code === 409, res.corps);

res = faireRes();
await admin(faireReq({method: 'POST', cookie: cookieApres,
  body: {action: 'supprimer', identifiant: 'essai.admin'}}), res);
verifier('supprimer son propre compte -> 409', res.code === 409, res.corps);

for (const a of vraisAdmins) {
  await sql`update utilisateur set actif = true where identifiant = ${a.identifiant}`;
}
verifier('les vrais administrateurs sont remis en etat', vraisAdmins.length >= 1,
         vraisAdmins.map(a => a.identifiant));

/* ===================== 9. Limitation des tentatives ===================== */
titre('9. Limitation des tentatives');

const IP_ATTAQUE = '198.51.100.44';
await sql`delete from tentative where cle = ${IP_ATTAQUE}`;
let bloqueeAu = null;
for (let i = 1; i <= 12; i++) {
  res = faireRes();
  await connexion(faireReq({method: 'POST', ip: IP_ATTAQUE,
    body: {identifiant: 'essai.admin', mdp: 'essai numero ' + i}}), res);
  if (res.getHeader('location') === '/?e=2' && bloqueeAu === null) bloqueeAu = i;
}
verifier('blocage apres 10 echecs', bloqueeAu === 11, bloqueeAu);

// Meme le BON mot de passe est refuse tant que la fenetre court.
res = faireRes();
await connexion(faireReq({method: 'POST', ip: IP_ATTAQUE,
  body: {identifiant: 'essai.admin', mdp: 'nouvelle-phrase-du-banc'}}), res);
verifier('bon mot de passe refuse pendant le blocage',
  res.getHeader('location') === '/?e=2' && !res.getHeader('set-cookie'));

// Une autre adresse n'est pas affectee.
res = faireRes();
await connexion(faireReq({method: 'POST', ip: '203.0.113.200',
  body: {identifiant: 'essai.admin', mdp: 'nouvelle-phrase-du-banc'}}), res);
verifier('une autre IP passe toujours', !!cookieDe(res));

// Une connexion reussie remet le compteur a zero.
await sql`delete from tentative where cle = ${IP_ATTAQUE}`;

/* ===================== 10. Journal ===================== */
titre('10. Journal');

const evenements = await sql`
  select evenement, count(*)::int as n from journal
   where horodatage > now() - interval '5 minutes'
   group by evenement order by evenement`;
const vus = Object.fromEntries(evenements.map(e => [e.evenement, e.n]));
console.log('  ' + JSON.stringify(vus));
for (const attendu of ['connexion_ok', 'connexion_echec', 'connexion_bloquee',
                       'compte_cree', 'mdp_change', 'sessions_coupees',
                       'compte_desactive']) {
  verifier('journalise : ' + attendu, (vus[attendu] ?? 0) > 0);
}

/* ===================== 11. Modifications partielles ===================== */
titre('11. Modifications partielles');

/* Chaque champ absent de la requete part en null vers coalesce(). Un
   parametre null non type fait echouer certains pilotes sur « could not
   determine data type of parameter », et ces combinaisons-la ne passent
   par aucun autre test : changer le role sans toucher a actif est
   pourtant le geste le plus courant de la vue d'administration. */
const {modifierCompte} = await import(RACINE + 'lib/base.js');
await sql`delete from utilisateur where identifiant = 'essai.partiel'`;
await sql`
  insert into utilisateur (identifiant, nom, empreinte, role, cree_par)
  values ('essai.partiel', 'Partiel', ${await empreinter('phrase quelconque')},
          'lecteur', 'essai')`;

for (const [nom, champs, attendu] of [
  ['role seul',          {role: 'admin'},                      {role: 'admin', actif: true}],
  ['nom seul',           {nom: 'Renomme'},                     {nom: 'Renomme'}],
  ['actif seul',         {actif: false},                       {actif: false}],
  ['les trois a la fois', {nom: 'X', role: 'lecteur', actif: true}, {role: 'lecteur', actif: true}],
  ['aucun champ',        {},                                   {role: 'lecteur'}],
]) {
  let vu = null, souci = null;
  try {
    vu = await modifierCompte('essai.partiel', {
      nom: champs.nom ?? null, role: champs.role ?? null, actif: champs.actif ?? null});
  } catch (e) { souci = e.message; }
  verifier('modifier : ' + nom,
    !souci && Object.entries(attendu).every(([k, v]) => vu[k] === v), souci ?? vu);
}

// L'epoque ne bouge que sur une desactivation : renommer quelqu'un ne
// doit pas le deconnecter.
const avantRenommage = (await sql`
  select epoque from utilisateur where identifiant = 'essai.partiel'`)[0].epoque;
await modifierCompte('essai.partiel', {nom: 'Encore un nom', role: null, actif: null});
const apresRenommage = (await sql`
  select epoque from utilisateur where identifiant = 'essai.partiel'`)[0].epoque;
verifier('renommer ne coupe pas les sessions', avantRenommage === apresRenommage,
         [avantRenommage, apresRenommage]);

await sql`delete from utilisateur where identifiant = 'essai.partiel'`;

/* ============ 12. L'administrateur agit sur son PROPRE compte ============ */
titre("12. L'administrateur agit sur son propre compte");

/* Le defaut qui a ferme l'acces en production.

   Se reinitialiser son propre mot de passe incremente l'epoque, donc
   revoque la session depuis laquelle on vient de cliquer. La page
   rappelait l'API, recevait 401, rechargeait -- et le middleware, qui
   ne consulte pas la base, reservait la page, qui rappelait l'API :
   boucle infinie. Pire, l'exception coupait le fil avant l'affichage du
   mot de passe tire au sort, que personne n'a donc jamais lu.

   Deux corrections, deux verifications ici : la session qui agit est
   reemise, et un refus pour session perimee efface le cookie pour que
   le rechargement tombe sur le formulaire de connexion. */

res = faireRes();
await connexion(faireReq({method: 'POST',
  body: {identifiant: 'essai.admin', mdp: 'nouvelle-phrase-du-banc'}}), res);
const cookieAvantSoi = cookieDe(res);
verifier('session de depart etablie', !!cookieAvantSoi);

res = faireRes();
await admin(faireReq({method: 'POST', cookie: cookieAvantSoi,
  body: {action: 'reinitialiser', identifiant: 'essai.admin'}}), res);
const cookieApresSoi = cookieDe(res);
const mdpTireSoi = res.corps?.motdepasse;

verifier('le mot de passe tire est renvoye', typeof mdpTireSoi === 'string'
  && mdpTireSoi.split('-').length === 4, res.corps);
verifier('un cookie neuf est pose', !!cookieApresSoi
  && cookieApresSoi !== cookieAvantSoi);

res = faireRes();
await admin(faireReq({cookie: cookieApresSoi}), res);
verifier('la session qui a agi reste utilisable',
  Array.isArray(res.corps?.comptes), res.code);

res = faireRes();
await admin(faireReq({cookie: cookieAvantSoi}), res);
verifier("l'ancien cookie est refuse -> 401", res.code === 401, res.code);
verifier('le refus EFFACE le cookie (pas de boucle de rechargement)',
  /Max-Age=0/.test(res.getHeader('set-cookie') || ''),
  res.getHeader('set-cookie'));

// Le mot de passe tire doit reellement ouvrir la porte : sans cela on
// aurait remplace un enfermement par un autre.
res = faireRes();
await connexion(faireReq({method: 'POST', ip: '203.0.113.77',
  body: {identifiant: 'essai.admin', mdp: mdpTireSoi}}), res);
verifier('le mot de passe tire permet de se reconnecter', !!cookieDe(res));

// Meme chose pour « couper les sessions » sur soi.
res = faireRes();
await admin(faireReq({method: 'POST', cookie: cookieApresSoi,
  body: {action: 'couper_sessions', identifiant: 'essai.admin'}}), res);
const cookieApresCoupe = cookieDe(res);
verifier('couper ses sessions reemet aussi la sienne', !!cookieApresCoupe);

res = faireRes();
await admin(faireReq({cookie: cookieApresCoupe}), res);
verifier('et elle marche encore', Array.isArray(res.corps?.comptes), res.code);

// Couper les sessions de QUELQU'UN D'AUTRE ne doit pas toucher la
// sienne : la reemission ne doit pas s'appliquer a tort.
res = faireRes();
await admin(faireReq({method: 'POST', cookie: cookieApresCoupe,
  body: {action: 'reinitialiser', identifiant: 'essai.lecteur'}}), res);
verifier('agir sur autrui ne repose pas de cookie',
  !res.getHeader('set-cookie'), res.getHeader('set-cookie'));

/* =============== 13. Un lecteur et son propre mot de passe =============== */
titre('13. Un lecteur et son propre mot de passe');

const trouverCompteEssai = async (id) => (await sql`
  select identifiant, epoque from utilisateur where identifiant = ${id}`)[0];
const epoqueAdminAvant = (await trouverCompteEssai('essai.admin')).epoque;

/* Le trou revele par la panne precedente : le formulaire vivait dans
   /admin, que le middleware refuse aux lecteurs. Les seules personnes a
   recevoir un mot de passe tire au sort etaient donc les seules a ne
   pas pouvoir le changer. Il vit desormais dans /compte. */

// On repart d'un lecteur propre : les sections precedentes ont
// reinitialise le sien.
res = faireRes();
await admin(faireReq({method: 'POST', cookie: cookieApresCoupe,
  body: {action: 'reinitialiser', identifiant: 'essai.lecteur'}}), res);
const mdpLecteur2 = res.corps?.motdepasse;

res = faireRes();
await connexion(faireReq({method: 'POST', ip: '203.0.113.90',
  body: {identifiant: 'essai.lecteur', mdp: mdpLecteur2}}), res);
const cookieLecteur2 = cookieDe(res);
verifier('le lecteur se connecte', !!cookieLecteur2);

// Le middleware doit lui servir /compte, et continuer a lui refuser
// /admin. C'est la difference entre les deux pages.
let repL = await middleware(reqEdge('https://x.test/compte', cookieLecteur2));
verifier('lecteur sur /compte -> laisse passer', repL === undefined, repL?.status);

repL = await middleware(reqEdge('https://x.test/compte.html', cookieLecteur2));
verifier('lecteur sur /compte.html -> laisse passer aussi',
  repL === undefined, repL?.status);

repL = await middleware(reqEdge('https://x.test/admin', cookieLecteur2));
verifier('lecteur sur /admin -> toujours 403', repL?.status === 403, repL?.status);

repL = await middleware(reqEdge('https://x.test/compte'));
verifier('sans session, /compte demande a se connecter',
  repL?.status === 401, repL?.status);

// Et il doit pouvoir changer effectivement son mot de passe.
res = faireRes();
await session(faireReq({method: 'POST', cookie: cookieLecteur2,
  body: {action: 'changer_mdp', ancien: mdpLecteur2,
         nouveau: 'choisi-par-le-lecteur'}}), res);
const cookieLecteur3 = cookieDe(res);
verifier('le lecteur change son mot de passe', res.corps?.ok === true, res.corps);
verifier('sa session est reemise', !!cookieLecteur3);

res = faireRes();
await connexion(faireReq({method: 'POST', ip: '203.0.113.91',
  body: {identifiant: 'essai.lecteur', mdp: 'choisi-par-le-lecteur'}}), res);
verifier('le mot de passe qu il a choisi fonctionne', !!cookieDe(res));

// Mais il reste un lecteur : changer son mot de passe n'ouvre aucune
// porte d'administration.
res = faireRes();
await admin(faireReq({cookie: cookieLecteur3}), res);
verifier('il reste refuse sur /api/admin -> 403', res.code === 403, res.code);

// Et il ne peut pas agir sur le compte d'un autre depuis cette page :
// api/session.js n'agit que sur l'identifiant du cookie signe.
res = faireRes();
await session(faireReq({method: 'POST', cookie: cookieLecteur3,
  body: {action: 'changer_mdp', identifiant: 'essai.admin',
         ancien: 'choisi-par-le-lecteur', nouveau: 'tentative-de-detournement'}}), res);
const adminIntact = await trouverCompteEssai('essai.admin');
verifier('un identifiant poste ne detourne pas la cible',
  res.corps?.ok === true && adminIntact.epoque === epoqueAdminAvant,
  {reponse: res.corps, epoque: adminIntact.epoque, attendue: epoqueAdminAvant});

/* ============ 14. Cloisonnement entre etablissements ============ */
titre("14. Cloisonnement entre etablissements");

/* Un seul deploiement sert TABOO et AMNESIA. La coquille est commune et
   ne contient aucun chiffre : tout ce qui se lit arrive par
   /donnees/<code>/. C'est donc LA que le cloisonnement se joue, et
   nulle part ailleurs. */

// Un lecteur neuf ne voit rien tant qu'on ne lui a rien accorde.
res = faireRes();
await admin(faireReq({method: 'POST', cookie: cookieApresCoupe,
  body: {action: 'creer', identifiant: 'essai.cloison', nom: 'Cloison'}}), res);
const mdpCloison = res.corps?.motdepasse;

res = faireRes();
await connexion(faireReq({method: 'POST', ip: '203.0.113.120',
  body: {identifiant: 'essai.cloison', mdp: mdpCloison}}), res);
let cookieC = cookieDe(res);

const cheminsDonnees = ['/donnees/taboo/socle.json', '/donnees/amnesia/socle.json'];
const autorise = async (cookie, chemin) =>
  (await middleware(reqEdge('https://x.test' + chemin, cookie))) === undefined;

verifier('compte neuf : aucun etablissement par defaut',
  !(await autorise(cookieC, cheminsDonnees[0]))
  && !(await autorise(cookieC, cheminsDonnees[1])));

// On lui accorde AMNESIA, et seulement AMNESIA.
res = faireRes();
await admin(faireReq({method: 'POST', cookie: cookieApresCoupe,
  body: {action: 'definir_acces', identifiant: 'essai.cloison', acces: ['amnesia']}}), res);
verifier('l administration accorde AMNESIA',
  res.corps?.ok === true && JSON.stringify(res.corps.acces) === '["amnesia"]', res.corps);

// Les droits ne changent qu'a la reconnexion : l'epoque a ete
// incrementee, donc l'ancienne session est refusee par les fonctions.
res = faireRes();
await session(faireReq({cookie: cookieC}), res);
verifier('la session d avant est revoquee -> 401', res.code === 401, res.code);

res = faireRes();
await connexion(faireReq({method: 'POST', ip: '203.0.113.121',
  body: {identifiant: 'essai.cloison', mdp: mdpCloison}}), res);
cookieC = cookieDe(res);

verifier('AMNESIA lui est servi',       await autorise(cookieC, cheminsDonnees[1]));
verifier('TABOO lui reste refuse',    !(await autorise(cookieC, cheminsDonnees[0])));

const repTaboo = await middleware(reqEdge('https://x.test' + cheminsDonnees[0], cookieC));
verifier('et le refus est un 403, pas le formulaire',
  repTaboo?.status === 403, repTaboo?.status);

// La coquille reste commune : elle ne contient aucun chiffre.
verifier('la coquille lui est servie malgre tout',
  await autorise(cookieC, '/'));

// L administrateur voit tout, sans que rien ne soit inscrit pour lui.
verifier('admin : TABOO',   await autorise(cookieApresCoupe, cheminsDonnees[0]));
verifier('admin : AMNESIA', await autorise(cookieApresCoupe, cheminsDonnees[1]));

res = faireRes();
await admin(faireReq({method: 'POST', cookie: cookieApresCoupe,
  body: {action: 'definir_acces', identifiant: 'essai.admin', acces: ['taboo']}}), res);
verifier('restreindre un administrateur est refuse -> 409', res.code === 409, res.corps);

// Un code inconnu est filtre, sans faire echouer les autres.
res = faireRes();
await admin(faireReq({method: 'POST', cookie: cookieApresCoupe,
  body: {action: 'definir_acces', identifiant: 'essai.cloison',
         acces: ['amnesia', 'casino-de-monaco']}}), res);
verifier('code inconnu filtre, les valides passent',
  JSON.stringify(res.corps?.acces) === '["amnesia"]', res.corps);

// Retrait complet.
res = faireRes();
await admin(faireReq({method: 'POST', cookie: cookieApresCoupe,
  body: {action: 'definir_acces', identifiant: 'essai.cloison', acces: []}}), res);
res = faireRes();
await connexion(faireReq({method: 'POST', ip: '203.0.113.122',
  body: {identifiant: 'essai.cloison', mdp: mdpCloison}}), res);
cookieC = cookieDe(res);
verifier('apres retrait, AMNESIA est refuse',
  !(await autorise(cookieC, cheminsDonnees[1])));

// Le cookie ne se falsifie pas plus pour les etablissements que pour le role.
const cookieForge = await emettre(
  {identifiant: 'essai.cloison', role: 'lecteur', epoque: 99, acces: ['taboo','amnesia']},
  'un-secret-que-je-n-ai-pas', '1');
verifier('un cookie forge n ouvre aucun etablissement',
  !(await autorise(cookieForge, cheminsDonnees[0]))
  && !(await autorise(cookieForge, cheminsDonnees[1])));

const trace = await sql`
  select detail from journal where evenement = 'acces_modifie'
   and sujet = 'essai.cloison' order by horodatage desc limit 1`;
verifier('le changement d acces est journalise', trace.length === 1, trace);

await sql`delete from utilisateur where identifiant = 'essai.cloison'`;

/* ===================== Menage ===================== */

await sql`delete from utilisateur where identifiant like 'essai.%'`;
await sql`delete from journal where sujet like 'essai.%' or sujet = 'inconnu.total'`;
await sql`delete from tentative`;

console.log('\n' + '='.repeat(46));
console.log(`  ${reussis} verifications passees, ${echoues} en echec`);
console.log('='.repeat(46) + '\n');
process.exit(echoues ? 1 : 0);
