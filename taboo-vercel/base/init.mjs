#!/usr/bin/env node
/* =====================================================================
   TABOO — Installation de la base des comptes
   ---------------------------------------------------------------------
     node base/init.mjs --schema
         Applique base/schema.sql. Reexecutable sans dommage : toutes
         les instructions sont en « if not exists ».

     node base/init.mjs --admin <identifiant> --nom "<Nom complet>"
         Cree un administrateur et IMPRIME son mot de passe, une fois.

     node base/init.mjs --secret
         Genere une valeur pour ACCES_SECRET.

   POURQUOI LE MOT DE PASSE N'EST PAS UN ARGUMENT
   ----------------------------------------------
   Un mot de passe passe en argument se retrouve dans l'historique du
   terminal et dans la liste des processus, ou n'importe quel programme
   de la machine peut le lire. Ce script le TIRE AU SORT, l'affiche une
   fois, et n'en garde que l'empreinte. Le porteur le changera a sa
   premiere connexion s'il le souhaite.

   CONNEXION DIRECTE, PAS POOLEE
   -----------------------------
   Le DDL passe par DATABASE_URL_UNPOOLED. PgBouncer en mode transaction
   ne tient pas l'etat de session dont une migration a besoin, et
   l'echec ne mentionne jamais le pooling : on lit « relation does not
   exist » sur une table qu'on vient de creer.
   ===================================================================== */

import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {empreinter, motdepasseTireAuSort} from '../lib/motdepasse.js';

/* ---------- Environnement ---------- */

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

/* ---------- Arguments ---------- */

function arg(nom) {
  const i = process.argv.indexOf(`--${nom}`);
  return i === -1 ? null : (process.argv[i + 1] ?? true);
}

/* ---------- Application du schema ---------- */

/* Decoupage volontairement naif : « ; » separe les instructions.

   IL NE COMPREND PAS LES GUILLEMETS DOLLAR. Un bloc « do $$ ... $$ »
   sera coupe en plein milieu et Postgres repondra « unterminated
   dollar-quoted string », ce qui ne designe pas la cause. Ecrire les
   migrations en instructions simples et idempotentes plutot que
   d'apprendre a ce fichier a analyser du SQL : le schema de ce projet
   tient en cinq tables, il n'a pas besoin d'un analyseur. */
function decouperSQL(texte) {
  // On retire les commentaires AVANT de decouper : un « ; » dans une
  // phrase de commentaire couperait une instruction en deux.
  const propre = texte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '');
  return propre.split(';').map(s => s.trim()).filter(Boolean);
}

async function appliquerSchema(sql) {
  const texte = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  const instructions = decouperSQL(texte);
  for (const instruction of instructions) {
    await sql.query(instruction);
    console.log('  ok  ' + instruction.split('\n')[0].slice(0, 66));
  }
  console.log(`\n${instructions.length} instructions appliquees.`);
}

/* ---------- Programme ---------- */

async function principal() {
  if (arg('secret')) {
    console.log('\nACCES_SECRET=' + randomBytes(32).toString('base64url'));
    console.log('\nA coller dans les variables d\'environnement Vercel.');
    console.log('Le changer deconnecte tout le monde immediatement.\n');
    return;
  }

  chargerEnv();
  const url = (process.env.DATABASE_URL_UNPOOLED
            || process.env.DATABASE_URL || '').trim();
  if (!url) {
    console.error('DATABASE_URL absente. Renseigner .env.local.');
    process.exit(1);
  }
  const sql = neon(url);

  if (arg('schema')) {
    console.log('\nApplication de base/schema.sql\n');
    await appliquerSchema(sql);
  }

  const identifiant = arg('admin');
  if (identifiant) {
    const nom = arg('nom') || identifiant;
    const id = String(identifiant).trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,32}$/.test(id)) {
      console.error(`Identifiant invalide : « ${id} ».`);
      console.error('Minuscules, chiffres, point, tiret, souligne. 2 a 32.');
      process.exit(1);
    }

    const motdepasse = motdepasseTireAuSort();
    const empreinte = await empreinter(motdepasse);

    // Reexecutable : si le compte existe, on lui remet un mot de passe
    // neuf et on le repasse admin actif. C'est la porte de secours du
    // jour ou plus personne ne peut entrer.
    await sql`
      insert into utilisateur (identifiant, nom, empreinte, role, cree_par)
      values (${id}, ${nom}, ${empreinte}, 'admin', 'base/init.mjs')
      on conflict (identifiant) do update set
        empreinte = excluded.empreinte,
        role      = 'admin',
        actif     = true,
        epoque    = utilisateur.epoque + 1`;

    await sql`
      insert into journal (evenement, sujet, acteur, detail)
      values ('mdp_reinitialise', ${id}, 'base/init.mjs',
              'administrateur installe depuis la ligne de commande')`;

    console.log('\n  Administrateur : ' + id);
    console.log('  Mot de passe   : ' + motdepasse);
    console.log('\nCe mot de passe ne sera plus jamais affiche : seule son');
    console.log('empreinte est en base. Le transmettre par un canal qui');
    console.log('n\'est pas celui du lien du tableau de bord.\n');
  }

  if (!arg('schema') && !identifiant) {
    console.log('\nRien a faire. Voir l\'en-tete du fichier pour les options.\n');
  }
}

principal().catch(e => { console.error('\nECHEC : ' + e.message + '\n'); process.exit(1); });
