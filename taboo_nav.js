/* =====================================================================
   TABOO — Navigation et titres de pages
   ---------------------------------------------------------------------
   Sortis du gabarit : celui-ci est desormais partage avec AMNESIA, qui
   n'a ni les memes pages ni les memes titres. Ce qui appartient a un
   etablissement vit dans un fichier a son nom ; le gabarit ne garde que
   le chassis -- graphiques, tableaux, export, tiroir de navigation.

   L'assembleur injecte ce fichier a la place du marqueur prevu dans
   le gabarit. Ne pas ecrire ce marqueur ici : il serait reintroduit
   par le remplacement lui-meme, et l'assemblage echouerait en
   signalant un marqueur non rempli -- ce qui est arrive.
   ===================================================================== */

const NAV = [
  {g:'Direction', p:[
    {id:'synthese', l:'Synthèse', f:true},
    {id:'resultat', l:'Compte de résultat', f:true},
  ]},
  {g:'Recettes', p:[
    {id:'explorer', l:'Explorer les ventes', f:true, dot:'new'},
    {id:'ventes', l:'Ventes & locomotives', f:true},
    {id:'horaires', l:'Profil de la nuit', f:true},
    {id:'reglements', l:'Règlements & créances', f:false},
  ]},
  {g:'Rentabilité', p:[
    {id:'marge', l:'Marge par activité', f:true, dot:'crit'},
    {id:'cout-revient', l:'Coût de revient', f:false, dot:'new'},
    {id:'depenses', l:'Dépenses', f:true},
  ]},
  {g:'Pilotage', p:[
    {id:'commercial', l:'Remises & offerts', f:true, dot:'warn'},
    {id:'stock', l:'Stock & inventaire', f:false, dot:'warn'},
    {id:'caisse', l:'Performance caisse', f:false},
    {id:'qualite', l:'Qualité des données', f:false, dot:'warn'},
  ]},
];

const META = {
  'synthese':['Synthèse',"Les chiffres que la direction doit retenir, sur la période choisie"],
  'resultat':['Compte de résultat',"Du chiffre d'affaires brut au résultat net, cascade complète"],
  'explorer':['Explorer les ventes',"Activité, puis famille, puis produit — cliquez pour descendre"],
  'ventes':['Ventes & locomotives',"Concentration du chiffre d'affaires par article et catégorie"],
  'horaires':['Profil de la nuit',"Répartition de l'activité sur la journée d'exploitation 14h → 13h59"],
  'reglements':['Règlements & créances',"Moyens de paiement encaissés et ventes à crédit — cumul non filtrable"],
  'marge':['Marge par activité',"Marge réelle calculée sur les achats effectivement engagés"],
  'cout-revient':['Coût de revient',"Marge théorique par recette, confrontée à la marge réelle"],
  'depenses':['Dépenses',"Achats externes, charges d'exploitation et investissements"],
  'commercial':['Remises & offerts',"Coût total de l'effort commercial consenti"],
  'stock':['Stock & inventaire',"Stock théorique, seuils d'alerte et valorisation"],
  'caisse':['Performance caisse',"Cumul par caissier — export POS sans date, non filtrable"],
  'qualite':['Qualité des données',"Contrôles de réconciliation et limites connues du jeu de données"],
};

/* Jeux lourds a charger selon la page ouverte. La Synthese n'y
   figure pas : ses chiffres sont pre-agreges dans le socle. */
const BESOINS = {
  'explorer':   ['articles_mois'],
  'ventes':     ['ventes_categorie_jour'],
  'horaires':   ['horaire_jour'],
  'depenses':   ['depenses_jour'],
  'commercial': ['offerts_jour'],
};
