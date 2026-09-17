/* =====================================================================
   TABOO — Acces a la base des comptes
   ---------------------------------------------------------------------
   Toutes les requetes SQL du projet sont ici. Une requete ecrite
   ailleurs est une requete dont personne ne relit le filtrage.

   POURQUOI LE PILOTE HTTP ET PAS UNE CONNEXION TCP
   ------------------------------------------------
   @neondatabase/serverless en mode `neon()` parle a Postgres en HTTP :
   une requete, un aller-retour, aucune connexion a garder ouverte. Sur
   des fonctions qui naissent et meurent a chaque appel, c'est le bon
   modele -- une connexion TCP classique passerait son temps a se
   rouvrir, et un pool ne survivrait pas au gel de l'instance.

   Contrepartie : chaque appel est sa propre transaction. Les rares
   endroits qui ont besoin d'atomicite l'obtiennent par une seule
   instruction SQL, pas par un BEGIN/COMMIT reparti sur plusieurs
   appels.

   INJECTION SQL
   -------------
   Le gabarit sql`...` de ce pilote parametre les interpolations : la
   valeur part separee du texte de la requete et n'est jamais recollee
   avant l'envoi. Ne JAMAIS construire une requete par concatenation de
   chaines ici -- cela contournerait exactement cette protection.
   ===================================================================== */

import { neon } from '@neondatabase/serverless';

let client = null;

export function bd() {
  if (client) return client;
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) throw new Error('DATABASE_URL absente.');
  client = neon(url);
  return client;
}

/* ---------- Comptes ---------- */

export function normaliserIdentifiant(brut) {
  return String(brut ?? '').trim().toLowerCase();
}

export async function trouverCompte(identifiant) {
  const sql = bd();
  const r = await sql`
    select id, identifiant, nom, empreinte, role, actif, epoque, acces
      from utilisateur
     where identifiant = ${normaliserIdentifiant(identifiant)}
     limit 1`;
  return r[0] ?? null;
}

export async function listerComptes() {
  const sql = bd();
  // Pas de colonne `empreinte` dans le select. Elle n'a aucune raison de
  // sortir de ce fichier : la vue d'administration ne l'affiche pas, et
  // ce qui ne quitte pas le serveur ne peut pas fuiter dans une reponse
  // JSON oubliee.
  return sql`
    select id, identifiant, nom, role, actif, epoque, acces,
           cree_le, cree_par, derniere_connexion
      from utilisateur
     order by actif desc, identifiant`;
}

export async function creerCompte({identifiant, nom, empreinte, role, acteur}) {
  const sql = bd();
  const r = await sql`
    insert into utilisateur (identifiant, nom, empreinte, role, cree_par)
    values (${normaliserIdentifiant(identifiant)}, ${String(nom).trim()},
            ${empreinte}, ${role}, ${acteur})
    returning id, identifiant, nom, role, actif`;
  return r[0];
}

/* Changer le mot de passe incremente l'epoque dans la MEME instruction.
   Les separer ouvrirait une fenetre ou le mot de passe est deja change
   mais les anciennes sessions courent encore -- et un echec entre les
   deux la rendrait permanente. */
export async function changerEmpreinte(identifiant, empreinte) {
  const sql = bd();
  const r = await sql`
    update utilisateur
       set empreinte = ${empreinte}, epoque = epoque + 1
     where identifiant = ${normaliserIdentifiant(identifiant)}
    returning id, identifiant, epoque`;
  return r[0] ?? null;
}

export async function modifierCompte(identifiant, {nom, role, actif}) {
  const sql = bd();
  // coalesce : un champ absent de la requete n'ecrase pas la valeur en
  // base. Sans cela, modifier le nom remettrait le role par defaut.
  const r = await sql`
    update utilisateur
       set nom   = coalesce(${nom ?? null}, nom),
           role  = coalesce(${role ?? null}, role),
           actif = coalesce(${actif ?? null}, actif),
           -- Desactiver doit couper l'acces, pas seulement l'empecher a
           -- la prochaine connexion : on incremente l'epoque.
           epoque = case when ${actif ?? null} is false
                         then epoque + 1 else epoque end
     where identifiant = ${normaliserIdentifiant(identifiant)}
    returning id, identifiant, nom, role, actif, epoque`;
  return r[0] ?? null;
}

export async function supprimerCompte(identifiant) {
  const sql = bd();
  const r = await sql`
    delete from utilisateur
     where identifiant = ${normaliserIdentifiant(identifiant)}
    returning identifiant`;
  return r[0] ?? null;
}

export async function couperSessions(identifiant) {
  const sql = bd();
  const r = await sql`
    update utilisateur set epoque = epoque + 1
     where identifiant = ${normaliserIdentifiant(identifiant)}
    returning identifiant, epoque`;
  return r[0] ?? null;
}

export async function compterAdmins() {
  const sql = bd();
  const r = await sql`
    select count(*)::int as n from utilisateur
     where role = 'admin' and actif`;
  return r[0].n;
}

/* Remplace la liste d'un coup, plutot que d'ajouter et retirer ligne a
   ligne : il n'y a pas d'etat intermediaire ou quelqu'un verrait un
   etablissement qu'on vient de lui retirer.

   L'epoque est incrementee dans la MEME instruction. Sans cela, les
   droits changeraient en base pendant que le cookie deja emis
   continuerait de porter les anciens -- et il les porterait jusqu'a son
   expiration, puisque le middleware ne relit pas la base. Incrementer
   force au moins les fonctions a refuser tout de suite, et la prochaine
   connexion a repartir des bons droits. */
export async function definirAcces(identifiant, codes) {
  const sql = bd();
  const r = await sql`
    update utilisateur
       set acces = ${codes}::text[], epoque = epoque + 1
     where identifiant = ${normaliserIdentifiant(identifiant)}
    returning identifiant, role, acces, epoque`;
  return r[0] ?? null;
}

export async function noterConnexion(identifiant) {
  const sql = bd();
  await sql`
    update utilisateur set derniere_connexion = now()
     where identifiant = ${normaliserIdentifiant(identifiant)}`;
}

/* ---------- Journal ---------- */

export async function journaliser({evenement, sujet, acteur, detail, ip}) {
  try {
    const sql = bd();
    await sql`
      insert into journal (evenement, sujet, acteur, detail, ip)
      values (${evenement}, ${sujet ?? null}, ${acteur ?? null},
              ${detail ?? null}, ${ip ?? null})`;
  } catch (e) {
    /* Le journal ne doit jamais empecher l'action journalisee. Si
       Postgres est injoignable, refuser la connexion de la direction
       parce qu'on n'a pas pu ECRIRE qu'elle se connectait serait une
       panne provoquee par la tracabilite elle-meme. On perd la ligne,
       on garde le service, et l'erreur part dans les journaux Vercel. */
    console.error('journal indisponible :', e.message);
  }
}

export async function lireJournal(limite = 200) {
  const sql = bd();
  const n = Math.min(Math.max(Number(limite) || 200, 1), 1000);
  return sql`
    select horodatage, evenement, sujet, acteur, detail, ip
      from journal
     order by horodatage desc
     limit ${n}`;
}

/* ---------- Limitation des tentatives ---------- */

const FENETRE_MINUTES = 15;
const ECHECS_MAX = 10;

export async function debitDepasse(ip) {
  if (!ip) return false;
  const sql = bd();
  const r = await sql`
    select echecs from tentative
     where cle = ${ip}
       and depuis > now() - make_interval(mins => ${FENETRE_MINUTES})`;
  return (r[0]?.echecs ?? 0) >= ECHECS_MAX;
}

export async function noterEchec(ip) {
  if (!ip) return;
  const sql = bd();
  // Tout en une instruction : la fenetre se reinitialise et le compteur
  // s'incremente dans le meme upsert. En deux requetes, deux tentatives
  // simultanees pourraient chacune lire 9 et ecrire 10.
  await sql`
    insert into tentative (cle, echecs, depuis) values (${ip}, 1, now())
    on conflict (cle) do update set
      echecs = case
        when tentative.depuis < now() - make_interval(mins => ${FENETRE_MINUTES})
        then 1 else tentative.echecs + 1 end,
      depuis = case
        when tentative.depuis < now() - make_interval(mins => ${FENETRE_MINUTES})
        then now() else tentative.depuis end`;
}

export async function remettreDebit(ip) {
  if (!ip) return;
  const sql = bd();
  await sql`delete from tentative where cle = ${ip}`;
}
