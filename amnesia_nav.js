/* =====================================================================
   AMNESIA — Navigation et titres de pages
   ---------------------------------------------------------------------
   Quinze pages. La difference avec TABOO n'est pas un choix de
   presentation : elle vient de ce que les donnees portent.

   POURQUOI QUINZE ET PAS DOUZE
   ----------------------------
   Trois pages en ont donne six. A chaque fois, un ecran repondait a
   DEUX questions posees par deux personnes differentes, et la seconde
   arrivait apres cinq blocs -- c'est-a-dire jamais.

     Articles offerts    | Qui offre
       ce qui sort       |   qui le fait sortir
     Compte de resultat  | Structure des charges
       combien reste-t-il|   ou part l'argent
     Cout de revient     | Couverture des couts
       ce que ca rapporte|   sur quelle part du chiffre, et d'ou

   Scinder ne retire rien : aucun bloc n'a disparu, ils ont change de
   page. Ce qui change est qu'on atteint le second sujet par la
   navigation au lieu de la molette.

   D'OU VIENT CHAQUE PAGE
   ----------------------
   Deux sources, et elles ne mesurent pas la meme chose.

   Le POS (exports Infogest) donne ce que la caisse a enregistre :
   ventes, offerts, caissiers, tranches horaires. Il ne porte AUCUN prix
   d'achat -- la colonne Cout de la balance et la colonne Val Achat des
   offerts valent zero sur toutes les lignes.

   Le classeur de suivi mensuel, tenu a la main par l'exploitation,
   donne les decaissements ventiles en vingt postes et la paie par
   service. C'est lui, et lui seul, qui rend possibles le compte de
   resultat, les depenses et le rapprochement.

   Il reste donc une chose qu'aucune des deux ne permet : le cout de
   revient PAR PRODUIT. Les achats ne sont connus qu'au mois et au
   poste, jamais a l'article. Une marge par produit demanderait
   d'inventer une repartition, et un chiffre invente ne se distingue
   plus d'un chiffre mesure une fois affiche.

   LE DRAPEAU f
   ------------
   f:true  -> la page reagit au filtre de periode
   f:false -> source cumulee sans date ; le filtre est masque et la
              page le dit elle-meme, plutot que de laisser croire qu'un
              reglage sans effet a ete pris en compte.
   ===================================================================== */

const NAV = [
  {g:'Direction', p:[
    {id:'synthese', l:'Synthèse', f:true},
    {id:'resultat', l:'Compte de résultat', f:false},
    {id:'structure', l:'Structure des charges', f:false},
    // Marque, et place en vue : la question « peut-on se fier a ce
    // chiffre ? » se pose AVANT de lire le premier tableau.
    {id:'ecarts', l:'Écarts & contrôles', f:false, dot:'crit'},
  ]},
  {g:'Le sujet', p:[
    // En tete de sa propre section, et marque : la valeur offerte pese
    // deux cinquiemes de ce qui est encaisse. Ce n'est pas une ligne de
    // detail. Le montant se lit sur la page, il ne s'ecrit pas ici.
    {id:'offerts', l:'Articles offerts', f:true, dot:'crit'},
    {id:'offerts-qui', l:'Qui offre', f:true},
  ]},
  {g:'Recettes', p:[
    {id:'ventes', l:'Chiffre d\'affaires', f:true},
    {id:'explorer', l:'Catégories & produits', f:true},
    {id:'horaires', l:'Tranches horaires', f:false},
  ]},
  {g:'Rentabilité', p:[
    // Les couts ne viennent pas des exports d'AMNESIA mais du catalogue
    // de TABOO. La page le dit des sa premiere ligne, et sa couverture
    // est une tuile et non une note de bas de page.
    {id:'couts', l:'Coût de revient & marge', f:false, dot:'warn'},
    {id:'couverture', l:'Couverture des coûts', f:false},
  ]},
  {g:'Exploitation', p:[
    {id:'depenses', l:'Dépenses', f:false},
    {id:'caissiers', l:'Caissiers', f:false},
    {id:'reglements', l:'Règlements', f:false, dot:'warn'},
    // Marque : les deux sources divergent, et c'est la page qui le dit.
    {id:'rapprochement', l:'Rapprochement caisse', f:false, dot:'warn'},
  ]},
];

const META = {
  'synthese':['Synthèse',"Ce que la période a encaissé, et ce qu'elle a donné"],
  'offerts':['Articles offerts',
    () => `${F(DATA.totaux.offerts_valeur)} F sortis sans contrepartie — par article, par caissier, par ticket`],
  'ventes':['Chiffre d\'affaires',"Série journalière, saisonnalité et jours d'exploitation"],
  'explorer':['Catégories & produits',"Exploration : type d'article → catégorie → produit"],
  'horaires':['Tranches horaires',"Profil de la nuit — source cumulée, non filtrable par période"],
  'caissiers':['Caissiers',"Tickets, panier moyen et part des offerts de chacun"],
  'reglements':['Règlements',"Moyens d'encaissement et ventes à crédit"],
  'resultat':['Compte de résultat',"Du chiffre d'affaires au résultat, mois par mois — source : classeur d'exploitation"],
  'structure':['Structure des charges',"Où part le chiffre d'affaires : quatre natures de charge, et la paie par service"],
  'offerts-qui':['Qui offre',"Ce que chaque caissier encaisse, et ce qu'il laisse sortir"],
  'couverture':['Couverture des coûts',"Sur quelle part du chiffre la marge est calculée, d'où viennent les prix, lesquels manquent"],
  'depenses':['Dépenses',"Vingt postes de décaissement, du plus lourd au plus léger"],
  'rapprochement':['Rapprochement caisse',"Ce que l'exploitation déclare, face à ce que la caisse enregistre"],
  'ecarts':['Écarts & contrôles',"Tout ce qui ne concorde pas entre les trois sources, chiffré"],
  'couts':['Coût de revient & marge',"Marge par produit — coûts relevés chez TABOO, appliqués aux articles de même nom"],
};

/* Jeux lourds a charger selon la page ouverte.

   Les deux jeux -- 4 611 lignes de detail, 4 791 offerts -- pesent
   1,5 Mo a eux deux contre 124 Ko pour le socle. Ils n'arrivent que
   pour les pages qui les exploitent.

   Le suivi mensuel, lui, EST dans le socle : 71 Ko pour trois pages,
   moins que le cout de la banniere de chargement qui l'annoncerait.

   La Synthese en demande un : sa repartition par type et par categorie
   se calcule sur le detail. Elle pourrait etre pre-agregee dans le
   socle, comme chez TABOO, et ce sera l'optimisation a faire si le
   premier affichage devient long. A 812 Ko, il ne l'est pas encore. */
const BESOINS = {
  // La Synthese compare desormais deux repartitions : celle du chiffre
  // et celle des offerts. La seconde demande le jeu des offerts, qui
  // n'etait charge que par sa propre page.
  'synthese':    ['detail_jour', 'offerts_jour'],
  'offerts':     ['offerts_jour'],
  'offerts-qui': ['offerts_jour'],
  'explorer':    ['detail_jour'],
};
