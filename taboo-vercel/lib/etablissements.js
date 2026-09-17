/* =====================================================================
   TABOO — Les etablissements servis par ce deploiement
   ---------------------------------------------------------------------
   Un seul code, une seule adresse, plusieurs etablissements. Ce fichier
   en est la liste, et il est importe par les deux runtimes : le
   middleware (edge) pour autoriser les fichiers de donnees, les
   fonctions (Node) pour valider ce que l'administration accorde.

   POURQUOI UNE CONSTANTE ET PAS UNE TABLE
   ---------------------------------------
   Parce que ce n'est pas une donnee qui varie. Ajouter un
   etablissement, c'est ecrire sa chaine d'extraction et produire ses
   fichiers de donnees : un changement de code, pas une ligne saisie
   dans une interface. Une table donnerait l'illusion qu'on peut en
   ajouter un depuis /admin, et le nouvel etablissement n'aurait rien a
   montrer.

   Ce qui varie, en revanche, c'est QUI voit QUOI. Cela vit en base,
   dans utilisateur.acces, et s'edite depuis /admin.

   AJOUTER UN ETABLISSEMENT
   ------------------------
   Trois endroits, et la contrainte SQL vous rappellera le troisieme si
   vous l'oubliez :
     1. ici
     2. la contrainte utilisateur_acces_connus, dans base/schema.sql
     3. la chaine d'extraction qui remplit donnees/<code>/
   ===================================================================== */

/* LES COULEURS
   ------------
   Echantillonnees sur les logos, jamais choisies de memoire. Le petrole
   de TABOO (#004F5E) et l'or d'AMNESIA (#EACE65, la mediane des pixels
   dores du logo) viennent des fichiers eux-memes.

   TABOO n'a pas de `surcharge` : ses jetons SONT ceux de la feuille de
   style du gabarit. Les recopier ici les dedoublerait, et le jour ou
   l'un des deux changerait seul, personne ne saurait lequel fait foi.
   Seul AMNESIA surcharge, et seulement ce qui differe.

   Ce qui NE change pas d'un etablissement a l'autre, et pourquoi :

     les series categorielles (--s-drink / --s-eat / --s-smoke)
       Elles designent des types de produits, pas une marque. Les
       recolorer par etablissement ferait que « boisson » ne serait pas
       la meme couleur sur deux pages voisines. Verifiees distinctes sur
       le nouveau fond : DE76 de 97 a 104 entre chaque paire.

     la rampe sequentielle, restee bleue
       Une rampe doree se confondrait avec --s-eat (orange) et avec
       --st-warn (ambre). Le bleu sur un noir chaud reste lisible et ne
       revendique rien.

     les statuts (--st-good / --st-warn / --st-crit)
       Un code d'alerte qui change de couleur selon l'etablissement
       n'est plus un code.

   La paire la plus serree est l'or de marque contre l'ambre d'alerte :
   DE76 de 29, distincte, et leurs roles ne se croisent jamais -- l'un
   est un accent d'interface, l'autre une pastille d'etat. */
export const ETABLISSEMENTS = [
  {
    code: 'taboo',
    nom: 'TABOO',
    sous_titre: 'Restaurant · Lounge Bar',
    // Chaque etablissement a sa propre coquille : leurs pages et leurs
    // fonctions de rendu different, et une coquille unique porterait les
    // deux jeux pour n'en afficher qu'un. TABOO garde la racine, qui
    // etait deja son adresse.
    chemin: '/',
    surcharge: null,
  },
  {
    code: 'amnesia',
    nom: 'AMNESIA',
    sous_titre: 'Nightclub & Rooftop',
    chemin: '/amnesia',
    // Contrastes mesures sur --surface #14110B, pas estimes.
    surcharge: {
      '--brand':       '#EACE65',   // l'or du logo, a l'octet pres
      '--bg':          '#0A0806',
      '--surface':     '#14110B',
      '--surface2':    '#1D1810',
      '--surface3':    '#272016',
      '--line':        '#33291A',
      '--line-strong': '#806E33',   //  3,76:1 — le minimum de 3:1 tenu
      '--ink':         '#F7F2E4',   // 16,84:1
      '--ink-dim':     '#C9BC96',   //  9,97:1
      '--ink-faint':   '#8F846A',   //  5,09:1
      '--accent':      '#EACE65',   // 12,12:1
      '--accent-mark': '#C9A227',   //  7,79:1 — marque de serie unique
      '--compare':     '#5AA9DE',   //  7,32:1 — 2e serie, DE 91 face a l'or

      /* Series categorielles, cherchees et non choisies.
         Contraintes tenues simultanement sur le fond #14110B :
           - contraste entre 3,2:1 et 9:1 — la borne HAUTE compte
             autant : une teinte a 16:1 sur ce fond eblouit et vole
             l'attention a la donnee ;
           - rouge et vert franc exclus : ils portent deja un etat
             (critique, favorable) et, sur un compte de resultat, se
             lisent comme perte et benefice. Aucune de ces charges n'a
             de valence ;
           - l'or de la marque entre dans la comparaison : il porte la
             ligne du chiffre d'affaires et croise toutes les series.
         Ecart CIEDE2000 minimal entre TOUTES les paires, l'or compris :
           normal 15,4 · deuteranopie 15,2 · protanopie 16,7 ·
           tritanopie 15,3.
         La rampe bleue qu'elles remplacent tombait a 7,1. */
      '--cat-1':       '#24a4db',   //  6,65:1
      '--cat-2':       '#ca72b0',   //  5,87:1
      '--cat-3':       '#70a33e',   //  6,28:1
      '--cat-4':       '#3ea37a',   //  6,03:1
      '--cat-5':       '#9b81da',   //  5,87:1
    },
  },
];

export const etablissement = (code) =>
  ETABLISSEMENTS.find(e => e.code === code) ?? null;

export const CODES = ETABLISSEMENTS.map(e => e.code);

export const estUnCode = (c) => CODES.includes(c);

/* L'acces EFFECTIF d'un compte.

   Le role admin vaut acces a tout, sans que rien ne soit inscrit dans
   sa colonne. Un administrateur qui gere les comptes d'un etablissement
   sans pouvoir en consulter les chiffres serait une distinction sans
   usage -- et la premiere chose qu'on ferait serait de se l'accorder a
   soi-meme, ce qui ne prouve rien.

   Le filtrage existe pour les lecteurs. C'est la seule population pour
   laquelle « voir Amnesia mais pas TABOO » veut dire quelque chose. */
export function accesEffectif(compte) {
  /* Cette fonction ne regarde PAS `actif`. « Le compte est-il ouvert »
     et « que peut-il voir » sont deux questions, tranchees a deux
     endroits : la premiere par lib/garde.js et api/connexion.js, avant
     qu'on arrive ici. Les confondre ferait renvoyer une liste vide a un
     administrateur dont l'appelant a simplement omis le champ -- un
     acces refuse sans message, le plus penible des defauts. */
  if (!compte) return [];
  if (compte.role === 'admin') return [...CODES];
  const accorde = Array.isArray(compte.acces) ? compte.acces : [];
  // On filtre contre la liste connue : une valeur restee en base apres
  // le retrait d'un etablissement ne doit pas ouvrir un chemin.
  return CODES.filter(c => accorde.includes(c));
}

/* Le chemin de la coquille d'un etablissement, ou null s'il est
   inconnu. Sert au middleware pour refuser une page qu'on n'a pas le
   droit d'ouvrir, et a la redirection apres connexion. */
export function cheminDe(code) {
  return etablissement(code)?.chemin ?? null;
}

/* L'etablissement dont une requete vise la COQUILLE (et non les
   donnees). La racine sert TABOO ; les autres ont leur propre chemin. */
export function etablissementDeLaPage(chemin) {
  const c = String(chemin || '');
  for (const e of ETABLISSEMENTS) {
    if (e.chemin === '/') continue;                 // la racine attrape tout
    if (c === e.chemin || c === e.chemin + '.html'
        || c.startsWith(e.chemin + '/')) return e.code;
  }
  return null;
}

/* Le code d'etablissement porte par un chemin de DONNEES.

   Les fichiers sont servis sous /donnees/<code>/... . C'est la seule
   chose que le middleware a besoin de lire pour decider, et il n'y a
   qu'ici que cette convention est ecrite. */
export function etablissementDuChemin(chemin) {
  const m = String(chemin || '').match(/^\/donnees\/([a-z0-9_-]+)\//);
  return m ? m[1] : null;
}
