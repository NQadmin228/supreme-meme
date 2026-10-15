/* =====================================================================
   TABOO — Schema d'authentification (Neon / Lakebase Postgres)
   ---------------------------------------------------------------------
   CE QUE CETTE BASE CONTIENT, ET CE QU'ELLE NE CONTIENT PAS
   ---------------------------------------------------------
   Elle contient les COMPTES, le JOURNAL, et la COPIE PUBLIEE des jeux
   de donnees que le tableau de bord affiche (table jeu_donnees, en fin
   de fichier).

   Cette copie n'est pas une source : elle ne se calcule pas ici, ne se
   corrige pas ici, et aucune metrique n'y est definie. Les chiffres
   naissent dans les scripts d'extraction, a partir des exports de
   caisse ; 60_publier_donnees.py les depose ici tels quels, comme on
   deposerait un fichier sur un serveur. Cette base ne sait toujours pas
   ce qu'est un couvert -- elle stocke un texte JSON et le rend a qui y
   a droit.

   POURQUOI LE MIDDLEWARE NE LIT JAMAIS CETTE BASE
   -----------------------------------------------
   Le middleware s'execute sur CHAQUE requete, y compris celle qui sert
   les 5,3 Mo d'index.html. Un aller-retour SQL par requete ajouterait
   sa latence a chaque image, chaque script, chaque rechargement.

   La base n'est donc lue qu'a deux moments : a la connexion, et sur une
   action d'administration. Entre les deux, le cookie signe suffit --
   il porte le role et l'epoque, le middleware verifie la signature et
   c'est tout.

   CE QUE CE DECOUPAGE COUTE
   -------------------------
   Un mot de passe change ne coupe pas la session en cours : le cookie
   deja emis reste valide jusqu'a son expiration, puisque personne ne
   relit la base pour le contredire. D'ou la duree de session ramenee de
   7 jours a 12 heures. C'est le prix du middleware sans base, et il est
   paye en connaissance de cause.

   Pour couper TOUT LE MONDE immediatement, il reste ACCES_VERSION :
   l'incrementer sur Vercel invalide toutes les signatures d'un coup.
   ===================================================================== */

/* ---------- Les comptes ---------- */

create table if not exists utilisateur (
  id                 bigint generated always as identity primary key,

  -- L'identifiant de connexion. Contraint en minuscules sans espace :
  -- sinon « Amadou » et « amadou » deviennent deux comptes, et la
  -- personne qui ne peut plus entrer ne comprend jamais pourquoi.
  identifiant        text        not null,

  nom                text        not null,

  -- JAMAIS le mot de passe. Une empreinte scrypt, au format
  -- scrypt$N$r$p$sel$empreinte. Neon est un service tiers : une copie
  -- de cette table ne doit rien donner a qui la lit.
  empreinte          text        not null,

  role               text        not null default 'lecteur',
  actif              boolean     not null default true,

  -- Incrementer l'epoque invalide les sessions de CETTE personne
  -- seulement (a l'expiration du cookie, cf. en-tete). C'est ce qui
  -- manquait au mecanisme a secret partage : on ne pouvait revoquer
  -- quelqu'un sans revoquer tout le monde.
  epoque             integer     not null default 1,

  cree_le            timestamptz not null default now(),
  cree_par           text,
  derniere_connexion timestamptz,

  constraint utilisateur_role_connu
    check (role in ('admin', 'lecteur')),

  -- La forme est verifiee ICI et pas seulement dans l'application :
  -- une regle d'integrite qui vit dans le code se contourne en
  -- oubliant d'appeler le code.
  constraint utilisateur_identifiant_forme
    check (identifiant ~ '^[a-z0-9._-]{2,32}$')
);

create unique index if not exists utilisateur_identifiant_unique
  on utilisateur (identifiant);

/* ---------- Le journal ---------- */
/* La vraie raison d'etre de cette base. Le mot de passe partage ne
   disait pas QUI s'etait connecte ; c'est la seule chose qu'on ne
   pouvait pas obtenir en restant sur une variable d'environnement. */

create table if not exists journal (
  id         bigint generated always as identity primary key,
  horodatage timestamptz not null default now(),

  -- connexion_ok | connexion_echec | connexion_bloquee | deconnexion
  -- compte_cree | compte_modifie | compte_desactive | compte_supprime
  -- mdp_change  | mdp_reinitialise | sessions_coupees
  evenement  text        not null,

  sujet      text,   -- le compte concerne
  acteur     text,   -- qui a agi (null si c'est le sujet lui-meme)
  detail     text,
  ip         text
);

create index if not exists journal_horodatage
  on journal (horodatage desc);

/* ---------- Limitation des tentatives ---------- */
/* Passer d'un secret unique a une liste de comptes agrandit la surface
   d'attaque : cinq mots de passe humains valent moins qu'un secret
   genere, et ils sont attaquables en boucle. Sans ce compteur, la
   migration rendrait l'acces MOINS sur, pas plus. */

create table if not exists tentative (
  cle    text        primary key,   -- adresse IP
  echecs integer     not null default 0,
  depuis timestamptz not null default now()
);

/* ---------- Les etablissements ---------- */
/* Ajout : un meme deploiement sert desormais plusieurs etablissements,
   et l'administration decide qui voit lequel.

   POURQUOI UNE COLONNE ET PAS UNE TABLE DE LIAISON
   ------------------------------------------------
   Une table `acces(utilisateur, etablissement)` serait la forme
   canonique. Mais la liste des etablissements n'est pas une donnee qui
   varie : en ajouter un exige d'ecrire sa chaine d'extraction et de
   produire ses fichiers de donnees. C'est un changement de code, pas
   une ligne saisie dans une interface.

   Une colonne tableau donne donc le meme resultat sans jointure, et la
   revocation devient une seule ecriture atomique -- on remplace le
   tableau, il n'y a pas de lignes a supprimer une par une.

   LA CONTRAINTE EST ICI, PAS SEULEMENT DANS LE CODE
   -------------------------------------------------
   Elle enumere les codes connus. Oui, ajouter un etablissement demande
   donc une migration : c'est voulu. Une valeur inconnue dans cette
   colonne serait un acces a rien du tout, decouvert le jour ou
   quelqu'un se plaint d'une page vide.

   LES ADMINISTRATEURS NE SONT PAS CONCERNES
   -----------------------------------------
   Le role admin vaut acces a tout, sans rien inscrire ici. Un
   administrateur qui gere les comptes d'un etablissement sans pouvoir
   consulter ses chiffres serait une distinction sans usage. Le
   filtrage existe pour les lecteurs. */

alter table utilisateur
  add column if not exists acces text[] not null default '{}';

/* Postgres n'a pas d'ADD CONSTRAINT IF NOT EXISTS. On retire puis on
   repose : deux instructions idempotentes, rejouables, et surtout sans
   bloc « do $$ » -- le decoupeur de base/init.mjs coupe sur « ; » et
   n'a aucune notion de guillemets dollar. */
alter table utilisateur drop constraint if exists utilisateur_acces_connus;

alter table utilisateur add constraint utilisateur_acces_connus
  check (acces <@ array['taboo', 'amnesia']::text[]);

/* ---------- Les jeux de donnees publies ---------- */
/* Ajout : les donnees ne montent plus avec le site.

   POURQUOI ELLES QUITTENT LE DEPLOIEMENT
   --------------------------------------
   Le site se construit desormais depuis le depot GitHub, qui est
   public. Les jeux de donnees -- le compte de resultat de chaque
   etablissement -- ne peuvent pas y entrer : un fichier pousse une fois
   reste dans l'historique pour toujours. Ils etaient jusqu'ici televerses
   depuis un poste avec `vercel --prod`, ce qui faisait de ce poste le
   seul endroit d'ou le site pouvait etre remis en ligne.

   Ici, ils sont servis par api/donnees.js, qui verifie la session ET
   relit les droits du compte dans `utilisateur` : retirer un
   etablissement a quelqu'un lui coupe les chiffres immediatement, et
   non plus a l'expiration de son cookie.

   POURQUOI DU TEXTE ET PAS DU JSONB
   ---------------------------------
   Personne n'interroge l'interieur de ces documents ; on les rend tels
   qu'on les a recus. jsonb les analyserait a l'ecriture et les
   reserialiserait a la lecture, pour rien -- et l'empreinte calculee a
   la publication ne correspondrait plus aux octets servis.

   UNE PUBLICATION REMPLACE TOUT D'UN COUP
   ---------------------------------------
   60_publier_donnees.py ecrit tous les jeux d'un etablissement dans une
   seule transaction. Un lecteur voit l'ancienne version ou la nouvelle,
   jamais un socle neuf avec des morceaux anciens. */

create table if not exists jeu_donnees (
  etablissement text        not null,
  nom           text        not null,
  contenu       text        not null,
  octets        integer     not null,
  -- sha256 du contenu, pour verifier qu'on sert ce qu'on a publie.
  empreinte     text        not null,
  publie_le     timestamptz not null default now(),
  publie_par    text,

  primary key (etablissement, nom),

  constraint jeu_donnees_etablissement_connu
    check (etablissement in ('taboo', 'amnesia')),
  -- Le nom finit dans une URL : on le borne ici plutot que de compter
  -- sur chaque appelant pour le filtrer.
  constraint jeu_donnees_nom_forme
    check (nom ~ '^[a-z0-9_]{1,60}$')
);
