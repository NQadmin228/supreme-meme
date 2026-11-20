#!/usr/bin/env node
/* =====================================================================
   Publie les jeux de donnees du tableau de bord dans Neon -- sans Python.

     node base/publier.mjs                 -> tous les etablissements
     node base/publier.mjs taboo           -> un seul
     node base/publier.mjs --essai         -> verifie sans rien ecrire

   (depuis taboo-vercel/, apres « npm ci »)

   POURQUOI UN DOUBLE DE 60_publier_donnees.py
   -------------------------------------------
   Le poste du controle de gestion bloque les bibliotheques compilees :
   la DLL de psycopg y est refusee par la politique de controle des
   applications, comme numpy. 60_publier_donnees.py s'arrete alors a
   l'import, avant toute connexion. Node, lui, tourne, et le pilote
   Neon du site est du JavaScript pur.

   Ce fichier fait EXACTEMENT ce que fait 60_publier_donnees.py, avec les
   memes garanties ; le modifier, c'est modifier l'autre :
     - les memes verifications avant tout envoi : JSON valide, nom borne,
       socle present, aucun jeu au-dela de ce qu'une fonction Vercel peut
       renvoyer ;
     - tous les jeux d'un etablissement dans UNE transaction, un jeu
       absent du dossier local retire dans la meme ;
     - apres ecriture, relecture de la base et comparaison des empreintes.

   La transaction passe par une connexion WebSocket (Pool) et non par
   les requetes HTTP de base/init.mjs : un etablissement pese plusieurs
   megaoctets, et une transaction interactive n'a pas a tenir dans le
   corps d'une seule requete.
   ===================================================================== */

import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {userInfo} from 'node:os';
import {Pool} from '@neondatabase/serverless';

const ETABLISSEMENTS = ['taboo', 'amnesia'];
const NOM = /^[a-z0-9_]{1,60}$/;
// Meme plafond que 60_publier_donnees.py : 4,5 Mo par reponse Vercel,
// moins une marge pour le premier mois plus charge.
const PLAFOND = 4_000_000;
const DONNEES = new URL('../donnees/', import.meta.url);

function chargerEnv(fichier = '.env.local') {
  let texte;
  try { texte = readFileSync(new URL(`../${fichier}`, import.meta.url), 'utf8'); }
  catch { return; }
  for (const ligne of texte.split('\n')) {
    const m = ligne.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const valeur = m[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[m[1]]) process.env[m[1]] = valeur;
  }
}

/* Le meme decoupage naif que base/init.mjs (voir ses limites la-bas). */
function decouperSQL(texte) {
  return texte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
    .split(';').map(s => s.trim()).filter(Boolean);
}

function arreter(message) {
  console.error('\n' + message + '\n');
  process.exit(1);
}

function preparer(etab) {
  const dossier = new URL(`${etab}/`, DONNEES);
  if (!existsSync(dossier)) arreter(`${etab} : dossier absent. Lancer d'abord le decoupage.`);
  const jeux = [];
  for (const fichier of readdirSync(dossier).filter(f => f.endsWith('.json')).sort()) {
    const nom = fichier.slice(0, -5);
    if (!NOM.test(nom)) arreter(`${etab}/${fichier} : nom refuse (attendu ${NOM.source})`);
    const brut = readFileSync(new URL(fichier, dossier));
    const contenu = brut.toString('utf8');
    try { JSON.parse(contenu); }
    catch (e) { arreter(`${etab}/${fichier} : JSON invalide (${e.message})`); }
    if (brut.length > PLAFOND) {
      arreter(`${etab}/${fichier} : ${(brut.length / 1e6).toFixed(1)} Mo, au-dela de `
              + `${(PLAFOND / 1e6).toFixed(1)} Mo -- une fonction Vercel ne le renverrait `
              + 'pas. Le decouper davantage.');
    }
    jeux.push({nom, contenu, octets: brut.length,
               empreinte: createHash('sha256').update(brut).digest('hex')});
  }
  if (!jeux.some(j => j.nom === 'socle')) {
    arreter(`${etab} : socle.json absent -- la page ne chargerait rien.`);
  }
  return jeux;
}

async function publier(client, etab, jeux, auteur) {
  await client.query('begin');
  try {
    for (const j of jeux) {
      await client.query(
        `insert into jeu_donnees
           (etablissement, nom, contenu, octets, empreinte, publie_le, publie_par)
         values ($1, $2, $3, $4, $5, now(), $6)
         on conflict (etablissement, nom) do update set
           contenu = excluded.contenu, octets = excluded.octets,
           empreinte = excluded.empreinte, publie_le = now(),
           publie_par = excluded.publie_par`,
        [etab, j.nom, j.contenu, j.octets, j.empreinte, auteur]);
    }
    const r = await client.query(
      'delete from jeu_donnees where etablissement = $1 and not (nom = any($2))',
      [etab, jeux.map(j => j.nom)]);
    await client.query('commit');
    if (r.rowCount) console.log(`    ${r.rowCount} jeu(x) retire(s) : absents de la nouvelle publication`);
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  }
}

async function verifier(client, etab, jeux) {
  const r = await client.query(
    'select nom, octets, empreinte from jeu_donnees where etablissement = $1', [etab]);
  const enBase = Object.fromEntries(r.rows.map(x => [x.nom, `${x.octets}:${x.empreinte}`]));
  const attendu = Object.fromEntries(jeux.map(j => [j.nom, `${j.octets}:${j.empreinte}`]));
  const cles = [...new Set([...Object.keys(enBase), ...Object.keys(attendu)])];
  if (cles.some(k => enBase[k] !== attendu[k])) {
    arreter(`${etab} : la base ne contient pas ce qui a ete publie.\n`
            + `  attendu ${Object.keys(attendu).sort()}\n  en base ${Object.keys(enBase).sort()}`);
  }
}

async function principal() {
  const args = process.argv.slice(2);
  const essai = args.includes('--essai');
  const voulus = args.filter(a => !a.startsWith('--'));
  const cibles = voulus.length ? voulus : ETABLISSEMENTS;
  const inconnus = cibles.filter(e => !ETABLISSEMENTS.includes(e));
  if (inconnus.length) arreter('etablissement inconnu : ' + inconnus.join(', '));

  const lots = {};
  for (const etab of cibles) {
    lots[etab] = preparer(etab);
    const total = lots[etab].reduce((s, j) => s + j.octets, 0);
    console.log(`  ${etab.padEnd(8)} ${lots[etab].length} jeux   ${String(Math.round(total / 1024)).padStart(7)} Ko`);
    for (const j of lots[etab]) {
      console.log(`           ${j.nom.padEnd(24)}${String(Math.round(j.octets / 1024)).padStart(7)} Ko   ${j.empreinte.slice(0, 12)}`);
    }
  }
  if (essai) { console.log("\n  essai : rien n'a ete ecrit."); return; }

  chargerEnv();
  const url = (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '').trim();
  if (!url) arreter('Aucune chaine de connexion : renseigner DATABASE_URL_UNPOOLED dans .env.local.');

  const pool = new Pool({connectionString: url});
  const client = await pool.connect();
  try {
    // Le schema est idempotent : c'est lui qui cree la table la premiere fois.
    const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
    for (const instruction of decouperSQL(schema)) await client.query(instruction);
    const auteur = userInfo().username;
    for (const [etab, jeux] of Object.entries(lots)) {
      await publier(client, etab, jeux, auteur);
      await verifier(client, etab, jeux);
      console.log(`  ${etab.padEnd(8)} publie et verifie`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

principal().catch(e => arreter('ECHEC : ' + e.message));
