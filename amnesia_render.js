/* =====================================================================
   AMNESIA — Fonctions de rendu
   ---------------------------------------------------------------------
   Une fonction par page, enregistree dans RENDER. Le chassis (gabarit
   partage avec TABOO) fournit tout le reste : formatage, graphiques,
   tableaux, filtres.

   CE QUI N'EST PAS ICI, ET NE PEUT PAS L'ETRE
   -------------------------------------------
   Aucune marge, aucun cout matiere, aucun resultat. Les exports Infogest
   ne portent pas de prix d'achat. On ne les estime pas : un coefficient
   invente produirait une marge d'apparence credible que personne ne
   pourrait contredire, et elle finirait dans une decision.

   LES TYPES D'ARTICLES
   --------------------
   BOISSON / PLAT / SMOKE chez AMNESIA, contre DRINK / EAT / SMOKE chez
   TABOO. Les couleurs de serie, elles, ne changent pas : elles designent
   une nature de produit, pas une marque. Une boisson doit avoir la meme
   couleur sur les deux tableaux de bord.
   ===================================================================== */

/* Correspondance vers les couleurs du chassis. C[...] est defini dans le
   gabarit avec ses contrastes verifies ; on n'invente pas de teinte
   ici. */
const TYPES = ['BOISSON', 'PLAT', 'SMOKE'];
const COULEUR_TYPE = {BOISSON: 'DRINK', PLAT: 'EAT', SMOKE: 'SMOKE'};
const cType = t => C[COULEUR_TYPE[t] || 'DRINK'];

/* Les jours d'AMNESIA portent brut / remise / net / offerts_valeur. */
const KEYS_JOUR = ['brut', 'remise', 'net', 'offerts_valeur', 'offerts_qte'];

function joursPeriode(){ return inRange(DATA.resultat_jour, state.start, state.end); }

/* Les jeux lourds ne sont pas dans le socle : cette fonction est celle
   du chassis, appelee par les pages qui en ont besoin. */
function detailPeriode(){
  return inRange(DATA.detail_jour || [], state.start, state.end);
}
function offertsPeriode(){
  return inRange(DATA.offerts_jour || [], state.start, state.end);
}

/* Le type d'une categorie. Le jeu des offerts ne porte que la
   categorie ; c'est le socle qui sait a quel type elle appartient. Sans
   cette table, la Synthese ne pourrait pas confronter la repartition du
   chiffre a celle des offerts -- et c'est cette confrontation, plus que
   chaque repartition prise seule, qui apprend quelque chose. */
let _typeDeCat = null;
function typeDeCategorie(cat){
  if(!_typeDeCat){
    _typeDeCat = new Map();
    for(const c of (DATA.ventes_categorie || [])) _typeDeCat.set(c.categorie, c.type);
  }
  return _typeDeCat.get(cat) || null;
}

/* Un encart de constat, dans le ton des « notes » de TABOO. Le libelle
   de gravite est ecrit, jamais porte par la seule couleur. */
function constat(niveau, titre, corps){
  const mot = {crit: 'CRITIQUE', warn: 'VIGILANCE', good: 'FAVORABLE'}[niveau] || '';
  return `<div class="note ${niveau}" style="margin-bottom:14px">
    <div class="note-title">${pill(mot, niveau)} ${titre}</div>${corps}</div>`;
}

/* =====================================================================
   PAGE 1 — SYNTHESE
   ===================================================================== */

RENDER['synthese'] = function(){
  const j = joursPeriode();
  const t = sums(j, KEYS_JOUR);
  const potentiel = t.net + t.offerts_valeur;
  const paniers = DATA.totaux.paniers;

  document.getElementById('sy-kpi').innerHTML = [
    /* Les trois premieres tuiles portent leur part du POTENTIEL -- le
       meme denominateur pour les trois, donc des barres qui se
       comparent entre elles. Le panier moyen n'en porte pas : il n'est
       la part de rien, et lui coller une barre inventerait un total. */
    tuile({k:"CHIFFRE D'AFFAIRES NET", v:Fc(t.net), u:'F', hero:true, cls:'accent',
           part:{v:t.net, total:potentiel, c:'var(--accent)'},
           d:F1(PCT(t.net, potentiel))+' % du potentiel · '+F(t.net)+' F sur '
             +F(j.length)+' nuits'}),
    tuile({k:'VALEUR OFFERTE', v:Fc(t.offerts_valeur), u:'F', cls:'crit',
           part:{v:t.offerts_valeur, total:potentiel, c:'var(--st-crit)'},
           d:F1(PCT(t.offerts_valeur, potentiel))+' % du potentiel · '
             +F1(PCT(t.offerts_valeur, t.net))+' % du CA net'}),
    tuile({k:'CHIFFRE POTENTIEL', v:Fc(potentiel), u:'F',
           part:{v:potentiel, total:potentiel, c:'var(--ink-faint)'},
           d:'la référence des deux barres ci-contre — si rien n\'avait été offert'}),
    tuile({k:'PANIER MOYEN', v:F(paniers ? DATA.totaux.ca_net/paniers : 0), u:'F',
           d:F(paniers)+' paniers sur la période complète'}),
  ].join('');

  /* Le constat d'ouverture. Ce n'est pas un commentaire decoratif : sur
     ce jeu de donnees, un article sur deux sort sans etre paye, et c'est
     le premier fait que la direction doit lire. */
  const partQte = PCT(DATA.totaux.offerts_qte, DATA.totaux.qte_totale);
  document.getElementById('sy-constat').innerHTML = constat('crit',
    'Quatre articles sur dix sortent sans être payés',
    `Sur la période complète, <b>${F(DATA.totaux.offerts_qte)} articles</b> ont été
     offerts sur ${F(DATA.totaux.qte_totale)} sortis, soit <b>${F1(partQte)} %</b>.
     En valeur de vente : <b>${F(DATA.totaux.offerts_valeur)} F</b> contre
     ${F(DATA.totaux.ca_net)} F encaissés, soit
     <b>${F1(PCT(DATA.totaux.offerts_valeur, DATA.totaux.ca_net))} %</b> du chiffre
     d'affaires net.
     <br><br>Un établissement de nuit offre — tournées, fidélisation, gestes
     commerciaux. La question n'est pas de savoir s'il faut offrir, mais si ce
     niveau-là est voulu et suivi. Voir « Articles offerts » pour le détail par
     article, par caissier et par ticket.`);

  /* --- ce qui est encaisse, ce qui est donne ---------------------------
     Douze barres, et non deux cent cinquante-quatre points.

     La version precedente superposait deux courbes remplies sur les
     cent vingt-sept nuits de la periode. Chaque nuit y montait et
     redescendait -- un etablissement qui ouvre trois soirs par semaine
     produit une dent de scie, pas une tendance -- et les deux
     remplissages se recouvraient. On y voyait de l'agitation, pas une
     evolution.

     La Synthese est la page la plus haute du tableau de bord : sa
     question est « le niveau d'offert bouge-t-il d'un mois sur
     l'autre », pas « qu'a fait la nuit du 12 fevrier ». Cette derniere
     est une ligne du tableau ci-dessous, et une barre de la page
     « Articles offerts », qui garde le grain de la nuit parce que c'est
     son sujet.

     Empilees, les deux series font le POTENTIEL du mois : la hauteur
     totale est ce qui aurait pu rentrer, le rouge ce qui n'est pas
     rentre, et le pourcentage au sommet se lit sans survol.

     Le grain s'adapte : sous sept semaines, decouper en mois donnerait
     une ou deux barres, et on retombe sur la nuit. */
  const GRAIN_MOIS = 49;
  const parGrain = (() => {
    if(j.length <= GRAIN_MOIS){
      return j.map(r => ({cle:r.d, libelle:dateLabel(r.d), n:1,
                          net:r.net, offert:r.offerts_valeur}));
    }
    const m = new Map();
    for(const r of j){
      const k = moisKey(r.d);
      if(!m.has(k)) m.set(k, {cle:k, libelle:moisLabel(r.d), n:0, net:0, offert:0});
      const e = m.get(k);
      e.n += 1; e.net += r.net; e.offert += r.offerts_valeur;
    }
    return [...m.values()].sort((a, b) => a.cle.localeCompare(b.cle));
  })();
  const auMois = parGrain.length !== j.length;

  setChart('c-sy-serie', {type:'bar',
    data:{labels:parGrain.map(g => g.libelle), datasets:[
      Object.assign({}, STACK, {label:'Encaissé', data:parGrain.map(g => g.net),
        backgroundColor:C.accentMark}),
      Object.assign({}, STACK, {label:'Offert', data:parGrain.map(g => g.offert),
        backgroundColor:C.crit}),
    ]},
    options:{interaction:{mode:'index', intersect:false},
      plugins:{legend:legendTop(true), tooltip:Object.assign({}, TOOLTIP, {callbacks:{
        label:c => {
          const g = parGrain[c.dataIndex];
          const pot = g.net + g.offert;
          return ' '+c.dataset.label+' : '+FCFA(c.parsed.y)
                 +'  ('+F1(PCT(c.parsed.y, pot))+' % du potentiel)';
        },
        footer:items => {
          const g = parGrain[items[0].dataIndex];
          return 'Potentiel : '+FCFA(g.net + g.offert)
                 + (auMois ? '  ·  '+nb(g.n, 'nuit', 'nuits') : '');
        }}})},
      scales:{y:Object.assign(axisY(), {stacked:true}),
              x:Object.assign(axisX(), {stacked:true})}},
    /* Une etiquette par barre, et seulement quand elles tiennent : au
       dela d'une quinzaine, les pourcentages se recouvrent et masquent
       ce qu'ils annotent. Le tableau, lui, les porte toutes. */
    plugins:parGrain.length <= 16
      ? [etiquetteSommet(
          parGrain.map(g => PCT(g.offert, g.net + g.offert)),
          /* Sans decimale : sur une page de synthese elle n'apporte
             rien, et chaque caractere gagne est une etiquette de plus
             qui tient sans recouvrir sa voisine. La valeur exacte est
             dans l'infobulle et dans le tableau. */
          v => F(v)+' %')]
      : []});

  /* Le tableau suit le grain du graphique : c'est son equivalent
     lisible, pas un second jeu de donnees. */
  document.getElementById('sy-serie-t').innerHTML = tableHTML(
    [{t:auMois ? 'Mois' : 'Nuit'}]
      .concat(auMois ? [{t:'Nuits', num:true}] : [])
      .concat([{t:'Encaissé', num:true}, {t:'Offert', num:true},
               {t:'Potentiel', num:true}, {t:'% offert', num:true}]),
    parGrain.map(g => [g.libelle]
      .concat(auMois ? [F(g.n)] : [])
      .concat([F(g.net), F(g.offert), F(g.net + g.offert),
               F1(PCT(g.offert, g.net + g.offert))+' %'])));

  /* --- ce qui se vend, et ce qui s'offre -------------------------------
     Deux compositions superposees, et non un anneau. Un anneau donnait
     la repartition du chiffre, et il fallait survoler chaque secteur
     pour en lire la part. Cette figure-ci ecrit la part dans le segment,
     et surtout elle repete la MEME repartition pour les offerts, a la
     meme echelle, juste en dessous.

     C'est la comparaison des deux lignes qui vaut le detour : un type
     plus large en bas qu'en haut est offert au-dela de ce qu'il vend.
     Aucune des deux lignes prise seule ne le dit. */
  const det = detailPeriode();
  const offSy = offertsPeriode();
  const parType = TYPES.map(ty => ({
    t: ty,
    net: sum(det.filter(r => r.type === ty), 'net'),
    offert: sum(offSy.filter(o => typeDeCategorie(o.categorie) === ty), 'valeur'),
  }));
  const totNet = parType.reduce((a, b) => a + b.net, 0);
  const totOff = parType.reduce((a, b) => a + b.offert, 0);

  /* Le type dont la part monte le plus d'une ligne a l'autre : c'est
     lui que la phrase doit nommer, et non le plus gros -- le plus gros
     est le plus gros des deux cotes, ce qui n'apprend rien. */
  let ecartType = null;
  for(const x of parType){
    const e = PCT(x.offert, totOff) - PCT(x.net, totNet);
    if(ecartType === null || e > ecartType.e) ecartType = {t: x.t, e};
  }

  document.getElementById('sy-type').innerHTML =
    `<div class="foot" style="margin-bottom:7px">Chiffre d'affaires net —
       ${FCFA(totNet)}</div>`
    + barreComposition(parType.map(x => ({l: x.t, v: x.net, c: cType(x.t)})))
    + `<div class="foot" style="margin:18px 0 7px">Valeur offerte —
       ${FCFA(totOff)}</div>`
    + barreComposition(parType.map(x => ({l: x.t, v: x.offert, c: cType(x.t)})))
    + (ecartType && ecartType.e >= 1
       ? `<div class="foot" style="margin-top:16px">Le décalage le plus net porte
          sur <b>${ecartType.t}</b> : ${F1(ecartType.e)} points de plus dans les
          offerts que dans les ventes.</div>`
       : '');

  /* --- dix premieres categories --- */
  const cats = [...DATA.ventes_categorie].slice(0, 10);
  barHorizontale('c-sy-cat', cats.map(c=>c.categorie), cats.map(c=>c.net),
                 C.accentMark, FCFA, 'CA net');

  /* --- ce que ce tableau de bord ne peut pas dire ---
     Le detail des recoupements a demenage sur la page « Ecarts &
     controles », qui rassemble ceux des trois sources. Ce qui reste ici
     est ce qui ne se recoupe pas mais se CONSTATE : une donnee absente
     des exports, et un renvoi chiffre vers le reste. Deux listes du
     meme sujet divergent des que l'une est modifiee. */
  const nbEcarts = anomalies().length;
  document.getElementById('sy-limites').innerHTML = `
    <div style="margin-bottom:16px">
      <b style="color:var(--st-crit)">Aucun prix d'achat par article.</b>
      ${DATA.meta.pourquoi_pas_de_couts}
    </div>
    <div style="margin-bottom:16px">
      <b>${nb(nbEcarts, 'écart entre les sources', 'écarts entre les sources')}.</b>
      Trois sources mesurent cet établissement — la caisse, le classeur tenu par
      l'exploitation, et le résumé que le logiciel s'annonce à lui-même — et elles
      ne concordent pas. Chacun de ces écarts est chiffré et expliqué sur la page
      <a href="#" onclick="go('ecarts');return false;"><b>Écarts &amp; contrôles</b></a>,
      à lire avant de citer un montant hors de ce tableau de bord.
    </div>
    <div class="foot">
      Période couverte : ${dateLabel(DATA.meta.periode_debut)} →
      ${dateLabel(DATA.meta.periode_fin)}, soit
      ${F(DATA.meta.jours_exploitation)} nuits d'ouverture.
      Source : ${DATA.meta.source}.</div>`;
};

/* =====================================================================
   PAGE 2 — ARTICLES OFFERTS
   ===================================================================== */

RENDER['offerts'] = function(){
  const j = joursPeriode();
  const off = offertsPeriode();
  const t = sums(j, KEYS_JOUR);
  const potentiel = t.net + t.offerts_valeur;

  const tickets = new Set(off.map(o=>o.ticket)).size;

  document.getElementById('of-kpi').innerHTML = [
    tuile({k:'VALEUR OFFERTE', v:Fc(t.offerts_valeur), u:'F', hero:true, cls:'crit',
           part:{v:t.offerts_valeur, total:potentiel, c:'var(--st-crit)'},
           d:F1(PCT(t.offerts_valeur, potentiel))+' % du potentiel de la période'}),
    tuile({k:'ARTICLES OFFERTS', v:F(t.offerts_qte),
           part:{v:DATA.totaux.offerts_qte, total:DATA.totaux.qte_totale,
                 c:'var(--st-crit)'},
           d:F1(PCT(DATA.totaux.offerts_qte, DATA.totaux.qte_totale))
             +' % des articles sortis'}),
    tuile({k:'TICKETS CONCERNÉS', v:F(tickets),
           part:{v:tickets, total:DATA.totaux.paniers, c:'var(--accent)'},
           d:F1(PCT(tickets, DATA.totaux.paniers))+' % des '
             +F(DATA.totaux.paniers)+' paniers'}),
    tuile({k:'OFFERT PAR TICKET CONCERNÉ', v:F(tickets ? t.offerts_valeur/tickets : 0), u:'F',
           d:'valeur moyenne donnée quand il y a un geste'}),
  ].join('');

  /* La meme chose en une ligne : sur le potentiel de la periode, ce qui
     est rentre et ce qui ne l'est pas. */
  document.getElementById('of-compo').innerHTML = barreComposition([
    {l:'Encaissé', v:t.net, c:C.accentMark},
    {l:'Offert', v:t.offerts_valeur, c:C.crit},
  ]);
  /* Le constat de cette page-ci porte sur CE QUI est offert. Celui des
     caissiers -- qui l'offre -- est parti avec eux sur « Qui offre » :
     il ecrasait celui-ci, et commentait des chiffres situes cinq blocs
     plus bas. */
  const parArt = [...groupBy(off, o=>o.article, ['valeur','qte']).entries()]
    .map(([k,v])=>({k, ...v})).sort((a,b)=>b.valeur-a.valeur);
  const tete = parArt.slice(0, 5).reduce((a,b)=>a+b.valeur, 0);
  const totOff = parArt.reduce((a,b)=>a+b.valeur, 0);

  document.getElementById('of-constat').innerHTML = parArt.length
    ? constat('crit',
        `Cinq articles font ${F1(PCT(tete, totOff))} % de ce qui est offert`,
        `Sur ${nb(parArt.length, 'article distinct', 'articles distincts')} offerts,
         les cinq premiers pèsent <b>${F(tete)} F</b> sur ${F(totOff)} F, soit
         <b>${F1(PCT(tete, totOff))} %</b>. En tête : <b>${parArt[0].k}</b>,
         ${F(parArt[0].valeur)} F pour ${F(parArt[0].qte)} unités — à lui seul
         <b>${F1(PCT(parArt[0].valeur, totOff))} %</b> du total offert.
         <br><br>Une générosité concentrée sur quelques références se pilote :
         c'est une décision de carte, pas un comportement diffus. Le graphique
         des articles donne le rang complet, et la page
         <a href="#" onclick="go('offerts-qui');return false;"><b>Qui offre</b></a>
         dit de quelles mains cela sort.
         ${(() => {
           /* La nuit extreme, nommee. Un maximum sans sa date n'est
              qu'un nombre ; avec elle, c'est une soiree dont quelqu'un
              se souvient et peut dire ce qui s'y est passe. */
           let p = -1;
           j.forEach((x, i) => { if(p < 0 || x.offerts_valeur > j[p].offerts_valeur) p = i; });
           if(p < 0 || !j[p].offerts_valeur) return '';
           const n = j[p];
           const part = PCT(n.offerts_valeur, n.net + n.offerts_valeur);
           return `<br><br>La nuit la plus lourde est le
             <b>${dateLabel(n.d)}</b> : ${F(n.offerts_valeur)} F sortis,
             ${F(n.net)} F encaissés — <b>${F1(part)} %</b> de la nuit.
             ${n.net === 0
               ? "Rien n'a été encaissé ce soir-là : c'est une soirée entière"
                 + ' passée en offert, pas une dérive de comptoir.'
               : ''}`;
         })()}`)
    : '';
  /* --- encaisse et offert, nuit par nuit -------------------------------
     Deux series EMPILEES, meme unite, un seul axe.

     La version precedente posait une ligne de pourcentage sur un second
     axe vertical. Deux echelles cote a cote n'ont aucun alignement
     naturel : l'endroit ou la ligne croise les barres ne vient d'aucune
     donnee, il vient du cadrage choisi -- et il se lit pourtant comme
     une correlation. Ici la hauteur totale est le potentiel de la nuit,
     la part rouge est ce qui n'est pas rentre, et le pourcentage
     s'ecrit au sommet sans second axe. */
  setChart('c-of-jour', {type:'bar',
    data:{labels:j.map(r=>r.d), datasets:[
      Object.assign({}, STACK, {label:'Encaissé', data:j.map(r=>r.net),
        backgroundColor:C.accentMark}),
      Object.assign({}, STACK, {label:'Offert', data:j.map(r=>r.offerts_valeur),
        backgroundColor:C.crit}),
    ]},
    options:{interaction:{mode:'index',intersect:false},
      plugins:{legend:legendTop(true), tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>{
          const r = j[c.dataIndex];
          const pot = r.net + r.offerts_valeur;
          return ' '+c.dataset.label+' : '+FCFA(c.parsed.y)
                 +'  ('+F1(PCT(c.parsed.y, pot))+' % de la nuit)';
        },
        footer:items=>{
          const r = j[items[0].dataIndex];
          return 'Potentiel de la nuit : '+FCFA(r.net + r.offerts_valeur);
        }}})},
      scales:{y:Object.assign(axisY(), {stacked:true}),
              x:Object.assign(axisX(), {stacked:true})}},
    /* UNE etiquette, pas cent vingt-sept.

       Ecrire la part au sommet de chaque nuit produisait un mur de
       pourcentages qui se recouvraient les uns les autres et masquaient
       les barres : le graphique disait moins que sans rien. La part de
       chaque nuit est dans l'infobulle et dans le tableau ; ce qui se
       dessine, c'est l'extreme -- la nuit ou il est sorti le plus de
       valeur sans contrepartie. */
    plugins:[etiquetteSommet(
      (() => {
        let pire = -1;
        j.forEach((r, i) => {
          if(pire < 0 || r.offerts_valeur > j[pire].offerts_valeur) pire = i;
        });
        return j.map((r, i) => i === pire
          ? PCT(r.offerts_valeur, r.net + r.offerts_valeur) : null);
      })(),
      v => F(v)+' % offert')]});

  document.getElementById('of-jour-t').innerHTML = tableHTML(
    [{t:'Nuit'},{t:'Offert',num:true},{t:'Articles',num:true},
     {t:'CA net',num:true},{t:'% du CA',num:true}],
    j.map(r=>[dateLabel(r.d), F(r.offerts_valeur), F(r.offerts_qte), F(r.net),
              F1(PCT(r.offerts_valeur, r.net))+' %']));

  /* --- articles et categories les plus offerts --- */
  const parArticle = [...groupBy(off, o=>o.article, ['valeur','qte']).entries()]
    .map(([k,v])=>({k, ...v})).sort((a,b)=>b.valeur-a.valeur).slice(0,15);
  barHorizontale('c-of-article', parArticle.map(a=>a.k),
                 parArticle.map(a=>a.valeur), C.crit, FCFA, 'Valeur offerte');

  const parCat = [...groupBy(off, o=>o.categorie, ['valeur','qte']).entries()]
    .map(([k,v])=>({k, ...v})).sort((a,b)=>b.valeur-a.valeur).slice(0,15);
  barHorizontale('c-of-categorie', parCat.map(a=>a.k),
                 parCat.map(a=>a.valeur), C.seq[4], FCFA, 'Valeur offerte');

};

/* =====================================================================
   PAGE — QUI OFFRE
   ---------------------------------------------------------------------
   Detachee de la precedente. « Qu'est-ce qui est offert » se decide en
   changeant une carte ; « qui l'offre » se traite en parlant a une
   equipe. Deux decisions, deux interlocuteurs, deux pages.
   ===================================================================== */

/* Le rapport offert/encaisse par caissier : c'est lui qui parle, pas le
   montant brut. Celui qui encaisse le plus offre mecaniquement le plus. */
function comparerCaissiers(){
  const caissiers = (DATA.caissiers || []).filter(c => c.net > 0);
  const offCais = new Map((DATA.offerts_caissier || []).map(o => [o.caissier, o]));
  return caissiers.map(c => {
    const o = offCais.get(c.nom) || {valeur:0, qte:0, tickets:0};
    return {nom:c.nom, net:c.net, tickets:c.tickets, offert:o.valeur,
            qte:o.qte, tkOff:o.tickets, ratio:c.net ? o.valeur/c.net : 0};
  }).sort((a, b) => b.ratio - a.ratio);
}

/* Comparer deux taux calcules sur des volumes incomparables ne veut
   rien dire. Sur ce jeu, un caissier realise 96,8 % du chiffre et un
   autre a vingt-et-un tickets : rapprocher leurs pourcentages produirait
   une phrase saisissante et fausse.

   On ne retient donc dans la comparaison que ceux qui pesent au moins
   5 % du chiffre -- et quand il n'en reste qu'un, on le dit au lieu de
   fabriquer un ecart. */
const SEUIL_COMPARAISON = 0.05;

function constatCaissiers(compares){
  const significatifs = compares.filter(
    c => c.net >= SEUIL_COMPARAISON * DATA.totaux.ca_net);
  const dominant = compares.find(c => c.net >= 0.8 * DATA.totaux.ca_net);

  if(significatifs.length >= 2){
    return constat('warn', "Le taux d'offert varie d'un caissier à l'autre",
      `${significatifs[0].nom} offre
       <b>${F1(significatifs[0].ratio*100)} %</b> de ce qu'il encaisse ;
       ${significatifs[significatifs.length-1].nom},
       <b>${F1(significatifs[significatifs.length-1].ratio*100)} %</b>.
       <br><br>Comparaison limitée aux caissiers réalisant au moins
       ${F(SEUIL_COMPARAISON*100)} % du chiffre : un taux calculé sur quelques
       tickets ne se compare pas à un taux calculé sur plusieurs milliers.
       Le tableau ci-dessous donne tous les postes, volumes en regard.`);
  }
  if(!dominant){
    return constat('warn', "L'activité est concentrée sur un seul poste",
      `Aucun caissier ne pèse assez pour qu'une comparaison de taux ait un sens
       sur cette période.`);
  }
  const suivant = compares.filter(c => c !== dominant)
    .reduce((a, b) => (b.net > (a ? a.net : -1) ? b : a), null);
  return constat('warn', "L'activité est concentrée sur un seul poste",
    `${dominant.nom} réalise
     <b>${F1(PCT(dominant.net, DATA.totaux.ca_net))} %</b> du chiffre et offre
     <b>${F1(dominant.ratio*100)} %</b> de ce qu'il encaisse.
     <br><br>Aucun autre caissier n'a un volume comparable — le suivant pèse
     ${F1(PCT(suivant ? suivant.net : 0, DATA.totaux.ca_net))} % du chiffre.
     Rapprocher leurs pourcentages produirait un écart spectaculaire et sans
     portée : un taux calculé sur vingt tickets ne se compare pas à un taux
     calculé sur cinq mille. Le tableau ci-dessous donne les volumes en regard ;
     la comparaison deviendra lisible quand plusieurs postes seront réellement
     actifs.`);
}

RENDER['offerts-qui'] = function(){
  const off = offertsPeriode();
  const compares = comparerCaissiers();
  const totNet = compares.reduce((a, b) => a + b.net, 0);
  const totOff = compares.reduce((a, b) => a + b.offert, 0);
  const tickets = new Set(off.map(o => o.ticket)).size;
  const tous = (DATA.caissiers || []).length;

  document.getElementById('oq-kpi').innerHTML = [
    tuile({k:'VALEUR OFFERTE', v:Fc(totOff), u:'F', hero:true, cls:'crit',
           part:{v:totOff, total:totNet + totOff, c:'var(--st-crit)'},
           d:F1(PCT(totOff, totNet))+' % de ce qui est encaissé, tous postes'}),
    tuile({k:'POSTES ACTIFS', v:F(compares.length),
           part:{v:compares.length, total:tous || 1, c:'var(--accent)'},
           d:'sur '+F(tous)+' comptes déclarés'}),
    tuile({k:'POSTE LE PLUS LOURD',
           v:compares.length ? compares.reduce(
               (a, b) => (b.net > a.net ? b : a)).nom : '—',
           d:compares.length
             ? F1(PCT(compares.reduce((a, b) => (b.net > a.net ? b : a)).net,
                      totNet))+' % du chiffre réalisé'
             : ''}),
    tuile({k:'TICKETS AVEC UN GESTE', v:F(tickets),
           part:{v:tickets, total:DATA.totaux.paniers, c:'var(--accent)'},
           d:F1(PCT(tickets, DATA.totaux.paniers))+' % des paniers'}),
  ].join('');

  document.getElementById('oq-constat').innerHTML = constatCaissiers(compares);

  /* Deux barres par poste, GROUPEES et non empilees : la question est
     « combien offre-t-il rapporte a ce qu'il encaisse », et deux
     longueurs qui partent de la meme ligne se comparent directement.
     Empilees, la seconde partirait d'une base differente pour chacun. */
  setChart('c-oq-caissier', {type:'bar',
    data:{labels:compares.map(c => c.nom), datasets:[
      Object.assign({}, BAR, {label:'Encaissé', data:compares.map(c => c.net),
        backgroundColor:C.accentMark}),
      Object.assign({}, BAR, {label:'Offert', data:compares.map(c => c.offert),
        backgroundColor:C.crit}),
    ]},
    options:{indexAxis:'y', layout:{padding:{right:64}},
      interaction:{mode:'index', intersect:false},
      plugins:{legend:legendTop(true), tooltip:Object.assign({}, TOOLTIP, {callbacks:{
        label:c => ' '+c.dataset.label+' : '+FCFA(c.parsed.x),
        footer:items => {
          const c = compares[items[0].dataIndex];
          return 'Offert / encaissé : '+F1(c.ratio*100)+' %';
        }}})},
      scales:{x:Object.assign(axisY(), {grid:{color:C.grid, drawTicks:false}}),
              y:{grid:{display:false}, border:{color:C.axis},
                 ticks:{color:C.dim, font:{size:11}, autoSkip:false}}}},
    /* Le taux au bout de la barre des offerts, et sur elle seule : un
       nombre a cote de chaque barre en ferait deux par poste, dont l'un
       repeterait ce que la longueur dit deja. */
    plugins:[etiquetteSerie(1, compares.map(c => c.ratio*100),
                            v => F1(v)+' %', 'y')]});

  const maxRatio = Math.max(...compares.map(c => c.ratio), 0.0001);
  document.getElementById('oq-caissier').innerHTML = tableHTML(
    [{t:'Caissier'},{t:'CA réalisé',num:true},{t:'% du chiffre',num:true},
     {t:'Tickets',num:true},{t:'Valeur offerte',num:true},
     {t:'Articles offerts',num:true},{t:'Offert / encaissé',num:true},{t:''}],
    compares.map(c => [
      c.nom, F(c.net), F1(PCT(c.net, totNet))+' %', F(c.tickets),
      F(c.offert), F(c.qte), F1(c.ratio*100)+' %',
      barCell(100*c.ratio/maxRatio, c.ratio > 0.2 ? C.crit : C.accentMark),
    ]));

  const lignes = [...off].sort((a, b) => b.valeur - a.valeur || a.d.localeCompare(b.d));
  document.getElementById('oq-detail').innerHTML = tableHTML(
    [{t:'Nuit'},{t:'Catégorie'},{t:'Article'},{t:'Caissier'},
     {t:'Ticket',num:true},{t:'Qté',num:true},{t:'Valeur',num:true}],
    lignes.map(o => [dateLabel(o.d), o.categorie, o.article, o.caissier,
                     o.ticket, F(o.qte), F(o.valeur)]));
  rendreFiltrable('oq-detail', 'Filtrer : un article, un caissier, une date…');
};

/* =====================================================================
   PAGE 3 — CHIFFRE D'AFFAIRES
   ===================================================================== */

RENDER['ventes'] = function(){
  const j = joursPeriode();
  const t = sums(j, KEYS_JOUR);
  const nuits = j.length;

  const meilleure = j.reduce((a,b)=>(b.net>(a?.net??-1)?b:a), null);

  const moyenne = nuits ? t.net/nuits : 0;

  document.getElementById('ve-kpi').innerHTML = [
    tuile({k:"CA NET DE LA PÉRIODE", v:Fc(t.net), u:'F', hero:true, cls:'accent',
           part:{v:t.net, total:t.brut, c:'var(--accent)'},
           d:F1(PCT(t.net, t.brut))+' % du brut · '+F(nuits)+' nuits'}),
    tuile({k:'MOYENNE PAR NUIT', v:F(moyenne), u:'F',
           d:"moyenne sur les nuits d'ouverture, pas sur le calendrier"}),
    tuile({k:'REMISES ACCORDÉES', v:Fc(t.remise), u:'F',
           part:{v:t.remise, total:t.brut, c:'var(--st-warn)'},
           d:F1(PCT(t.remise, t.brut))+' % du chiffre brut'}),
    /* Une meilleure nuit ne dit rien seule : 8 MF est un record ou une
       nuit ordinaire selon ce que vaut une nuit ordinaire. La tuile
       porte donc le rapport a la moyenne, pas la seule date. */
    tuile({k:'MEILLEURE NUIT', v:meilleure?Fc(meilleure.net):'—', u:'F',
           d:meilleure
             ? dateLabel(meilleure.d)+' — '
               +F1(moyenne ? meilleure.net/moyenne : 0)+' fois une nuit moyenne'
             : ''}),
  ].join('');

  /* Les jours REGULIERS de la semaine.

     Comparer une moyenne calculee sur une nuit a une moyenne calculee
     sur quarante ne veut rien dire -- c'est l'erreur deja corrigee sur
     les caissiers, et elle revient ici sous une autre forme :
     l'etablissement a ouvert trois lundis, un mardi, trois jeudis, et
     quarante-deux vendredis. Une premiere version de ce constat
     annoncait « une nuit de mardi vaut 0,0 nuits de lundi », ce qui
     est une division par zero habillee en analyse.

     Seuil : un dixieme des nuits de la periode. En dessous, le jour
     n'est pas un jour d'exploitation, c'est une ouverture
     exceptionnelle -- elle est dans le graphique et dans le tableau,
     elle n'est pas dans la phrase. */
  const SEUIL_JOUR = 0.10;
  const parJour = JOURS.map((nom, i) => {
    const lignes = j.filter(r => jourNum(r.d) === i);
    return {nom, moy: lignes.length ? sum(lignes, 'net')/lignes.length : 0,
            nuits: lignes.length};
  });
  const reguliers = parJour.filter(x => x.nuits >= SEUIL_JOUR * (nuits || 1))
                           .sort((a, b) => b.moy - a.moy);
  const exceptionnels = parJour.filter(
    x => x.nuits > 0 && x.nuits < SEUIL_JOUR * (nuits || 1));
  const haut = reguliers[0];
  const bas = reguliers[reguliers.length - 1];

  document.getElementById('ve-constat').innerHTML = (reguliers.length >= 2 && bas.moy > 0)
    ? constat('good',
        `Une nuit de ${haut.nom.toLowerCase()} vaut `
        + `${F1(haut.moy / bas.moy)} nuits de ${bas.nom.toLowerCase()}`,
        `En moyenne par nuit ouverte : <b>${F(haut.moy)} F</b> le
         ${haut.nom.toLowerCase()} (${nb(haut.nuits, 'nuit', 'nuits')}), contre
         <b>${F(bas.moy)} F</b> le ${bas.nom.toLowerCase()}
         (${nb(bas.nuits, 'nuit', 'nuits')}).
         ${exceptionnels.length
           ? `<br><br>La comparaison ne retient que les
              ${nb(reguliers.length, 'jour', 'jours')} réellement exploités —
              ceux qui pèsent au moins ${F(SEUIL_JOUR*100)} % des nuits de la
              période. ${exceptionnels.map(
                x => x.nom.toLowerCase() + ' (' + nb(x.nuits, 'nuit', 'nuits') + ')'
              ).join(', ')} sont des ouvertures exceptionnelles : une moyenne
              calculée sur une nuit ne se compare pas à une moyenne calculée sur
              quarante. Elles figurent dans le graphique et dans le tableau.`
           : ''}
         <br><br>Ce sont bien des <b>moyennes</b> et non des cumuls : sinon le
         jour le plus souvent ouvert gagnerait toujours, et le classement
         mesurerait le calendrier au lieu de l'activité. Les remises, elles,
         reprennent <b>${F1(PCT(t.remise, t.brut))} %</b> du chiffre brut sur
         la période.
         ${(() => {
           /* Le mois dont la NUIT vaut le plus. C'est la lecture que
              l'ancien graphique a deux axes rendait impossible : il
              fallait diviser de tete une barre par une courbe. */
           const ms = parMoisJours(j).filter(m => m.nuits >= 3);
           if(ms.length < 2 || !nuits) return '';
           const moy = t.net / nuits;
           let haut = ms[0];
           for(const m of ms) if(m.net / m.nuits > haut.net / haut.nuits) haut = m;
           const indice = 100 * (haut.net / haut.nuits) / moy;
           if(indice < 125) return '';
           return `<br><br>Un mois sort du lot une fois ramené à la nuit :
             <b>${haut.libelle}</b> vaut <b>${F(haut.net / haut.nuits)} F</b> par
             nuit, soit <b>${F(indice)}</b> contre 100 pour une nuit ordinaire —
             et il n'a ouvert que ${nb(haut.nuits, 'nuit', 'nuits')}. Au
             cumul il passe inaperçu ; c'est la division par les nuits qui le
             fait apparaître.`;
         })()}`)
    : '';

  setChart('c-ve-jour', {type:'bar',
    data:{labels:j.map(r=>r.d), datasets:[Object.assign({}, BAR, {
      label:'CA net', data:j.map(r=>r.net), backgroundColor:C.accentMark})]},
    options:{plugins:{legend:{display:false}, tooltip:Object.assign({},TOOLTIP,{
        callbacks:{label:c=>' CA net : '+FCFA(c.parsed.y)}})},
      scales:{y:axisY(), x:axisX()}}});

  document.getElementById('ve-jour-t').innerHTML = tableHTML(
    [{t:'Nuit'},{t:'Brut',num:true},{t:'Remises',num:true},{t:'Net',num:true}],
    j.map(r=>[dateLabel(r.d), F(r.brut), F(r.remise), F(r.net)]));

  /* --- par mois : deux graphiques, un seul axe chacun ------------------
     Il n'y en avait qu'un, portant le chiffre du mois en barres et le
     nombre de nuits en ligne sur un SECOND axe vertical. Deux unites
     sur un meme cadre n'ont aucun alignement naturel : l'endroit ou la
     ligne passe au-dessus ou en dessous des barres depend du cadrage,
     pas des donnees, et se lit pourtant comme une correlation.

     Separes, les deux graphiques repondent chacun a une question, et
     leur comparaison repond a la troisieme : un mois plus gros a gauche
     mais pas a droite ouvre plus ; un mois plus gros des deux cotes
     vend mieux. */
  const mois = parMoisJours(j);
  const totMois = sum(mois, 'net');

  setChart('c-ve-mois', {type:'bar',
    data:{labels:mois.map(m=>m.libelle), datasets:[
      Object.assign({}, BAR, {label:'CA net', data:mois.map(m=>m.net),
        backgroundColor:C.accentMark}),
    ]},
    options:{plugins:{legend:{display:false},
      tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>' CA net : '+FCFA(c.parsed.y),
        footer:items=>{
          const m = mois[items[0].dataIndex];
          return nb(m.nuits, "nuit d'ouverture", "nuits d'ouverture")
                 + ' — ' + F1(PCT(m.net, totMois)) + ' % de la période';
        }}})},
      scales:{y:axisY(), x:axisX()}},
    // Part du mois dans la periode affichee : la question posee a ce
    // graphique est « quel mois porte le chiffre », et elle se lit sans
    // survoler quoi que ce soit.
    plugins:[etiquetteSommet(mois.map(m => PCT(m.net, totMois)),
                             v => F1(v) + ' %')]});

  /* La meme serie divisee par les nuits ouvertes. Le nombre de nuits
     n'est plus une courbe posee sur une autre echelle : il est au
     DENOMINATEUR, la ou il a un sens. */
  const moyenneNuit = nuits ? t.net/nuits : 0;
  setChart('c-ve-mois-nuit', {type:'bar',
    data:{labels:mois.map(m=>m.libelle), datasets:[
      Object.assign({}, BAR, {label:'CA net par nuit',
        data:mois.map(m => m.nuits ? m.net/m.nuits : 0),
        backgroundColor:C.cat[0]}),
    ]},
    options:{plugins:{legend:{display:false},
      tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>' '+FCFA(c.parsed.y)+' par nuit',
        footer:items=>{
          const m = mois[items[0].dataIndex];
          return nb(m.nuits, 'nuit ouverte', 'nuits ouvertes')
                 + ' — ' + FCFA(m.net) + ' au total';
        }}})},
      scales:{y:axisY(), x:axisX()}},
    // L'ecart a la moyenne de la periode, en indice : « 118 » se lit
    // « 18 % au-dessus d'une nuit ordinaire », sans avoir a chercher la
    // moyenne ailleurs sur la page.
    plugins:[etiquetteSommet(
      mois.map(m => (m.nuits && moyenneNuit) ? 100*(m.net/m.nuits)/moyenneNuit : null),
      v => F(v))]});

  /* --- par jour de la semaine, en MOYENNE par nuit ouverte --- */
  const sem = JOURS.map((nom,i)=>{
    const lignes = j.filter(r=>jourNum(r.d)===i);
    const net = sum(lignes,'net');
    return {nom, net, nuits:lignes.length, moy: lignes.length ? net/lignes.length : 0};
  });
  /* L'etiquette etait la part de chaque barre dans le total affiche.
     Sur des MOYENNES, ce total est une somme de moyennes : une quantite
     qui ne correspond a rien, et dont on lisait pourtant des
     pourcentages. On ecrit donc le meme indice que sur les mois --
     100 = une nuit ordinaire de la periode -- et le nombre de nuits
     passe dans l'infobulle, ou il qualifie la moyenne qu'il a servi a
     calculer. */
  const moyPeriode = nuits ? t.net / nuits : 0;
  setChart('c-ve-semaine', {type:'bar',
    data:{labels:sem.map(s=>s.nom), datasets:[Object.assign({}, BAR, {
      label:'CA net moyen', data:sem.map(s=>s.moy), backgroundColor:C.cat[0]})]},
    options:{plugins:{legend:{display:false}, tooltip:Object.assign({},TOOLTIP,{
        callbacks:{label:c=>' '+FCFA(c.parsed.y)+' en moyenne',
          footer:items=>{const s=sem[items[0].dataIndex];
            return s.nuits+' nuit'+(s.nuits>1?'s':'')+' — '+FCFA(s.net)+' au total';}}})},
      scales:{y:axisY(), x:axisX()}},
    plugins:[etiquetteSommet(
      sem.map(s => (s.nuits && moyPeriode) ? 100*s.moy/moyPeriode : null),
      v => F(v))]});

  document.getElementById('ve-detail').innerHTML = tableHTML(
    [{t:'Nuit'},{t:'Brut',num:true},{t:'Remises',num:true},{t:'Net',num:true},
     {t:'Articles offerts',num:true},{t:'Valeur offerte',num:true}],
    j.map(r=>[dateLabel(r.d), F(r.brut), F(r.remise), F(r.net),
              F(r.offerts_qte), F(r.offerts_valeur)]));
  rendreFiltrable('ve-detail', 'Filtrer : une date, un montant…');
};

/* Regroupement mensuel propre a AMNESIA : on compte aussi les nuits,
   que parMois() du chassis ne connait pas. */
function parMoisJours(lignes){
  const m = new Map();
  for(const r of lignes){
    const k = moisKey(r.d);
    if(!m.has(k)) m.set(k, {cle:k, libelle:moisLabel(r.d), net:0, nuits:0});
    const e = m.get(k);
    e.net += r.net; e.nuits += 1;
  }
  return [...m.values()].sort((a,b)=>a.cle.localeCompare(b.cle));
}

/* =====================================================================
   PAGE 4 — CATEGORIES & PRODUITS
   ---------------------------------------------------------------------
   Meme principe que l'exploration de TABOO : type -> categorie ->
   produit. Trois niveaux, un fil d'Ariane, un clic pour descendre.
   ===================================================================== */

RENDER['explorer'] = function(){
  const det = detailPeriode();
  const e = state.explo;

  let lignes, titre, sousTitre, colonne;
  if(!e.t){
    lignes = TYPES.map(ty=>{
      const l = det.filter(r=>r.type===ty);
      return {cle:ty, net:sum(l,'net'), qte:sum(l,'qte_vendue'),
              offert:sum(l,'qte_offerte'), couleur:cType(ty)};
    }).filter(x=>x.net>0 || x.qte>0);
    titre = "Par type d'article";
    sousTitre = "Cliquer un type pour voir ses catégories.";
    colonne = "Type";
  } else if(!e.c){
    const l0 = det.filter(r=>r.type===e.t);
    const m = groupBy(l0, r=>r.categorie, ['net','qte_vendue','qte_offerte']);
    lignes = [...m.entries()].map(([k,v])=>({cle:k, net:v.net, qte:v.qte_vendue,
      offert:v.qte_offerte, couleur:cType(e.t)})).sort((a,b)=>b.net-a.net);
    titre = 'Catégories de ' + e.t;
    sousTitre = "Cliquer une catégorie pour voir ses produits.";
    colonne = 'Catégorie';
  } else {
    const l0 = det.filter(r=>r.type===e.t && r.categorie===e.c);
    const m = groupBy(l0, r=>r.produit, ['net','qte_vendue','qte_offerte']);
    lignes = [...m.entries()].map(([k,v])=>({cle:k, net:v.net, qte:v.qte_vendue,
      offert:v.qte_offerte, couleur:cType(e.t)})).sort((a,b)=>b.net-a.net);
    titre = 'Produits — ' + e.c;
    sousTitre = "Dernier niveau.";
    colonne = 'Produit';
  }

  const total = lignes.reduce((a,b)=>a+b.net, 0);
  document.getElementById('ex-titre').textContent = titre;
  document.getElementById('ex-sub').textContent = sousTitre;

  /* Fil d'Ariane : on doit toujours pouvoir remonter, et savoir ou l'on
     est. Une exploration sans retour est un piege. */
  const fil = ['<button class="mini" data-explo="racine">Tous les types</button>'];
  if(e.t) fil.push(`<button class="mini" data-explo="type">${e.t}</button>`);
  if(e.c) fil.push(`<span class="mini" style="opacity:.6">${e.c}</span>`);
  document.getElementById('ex-fil').innerHTML = fil.join(' › ');

  const top = lignes.slice(0, 18);
  setChart('c-ex', {type:'bar',
    data:{labels:top.map(l=>l.cle), datasets:[Object.assign({}, BAR, {
      label:'CA net', data:top.map(l=>l.net),
      backgroundColor:top.map(l=>l.couleur)})]},
    options:{indexAxis:'y',
      plugins:{legend:{display:false}, tooltip:Object.assign({},TOOLTIP,{
        callbacks:{label:c=>' '+FCFA(c.parsed.x)
                            +'  ('+F1(PCT(c.parsed.x,total))+' %)'}})},
      scales:{x:axisY(), y:axisX({ticks:{color:C.dim, font:{size:11}}})}}});

  document.getElementById('ex-table-titre').textContent = titre;
  const maxNet = Math.max(...lignes.map(l=>l.net), 1);
  document.getElementById('ex-table').innerHTML = tableHTML(
    [{t:colonne},{t:'CA net',num:true},{t:'% du niveau',num:true},
     {t:'Vendus',num:true},{t:'Offerts',num:true},{t:'% offerts',num:true},{t:''}],
    lignes.map(l=>{
      const qTot = l.qte + l.offert;
      const cible = !e.t ? `data-descendre="${l.cle}"` :
                    !e.c ? `data-descendre="${l.cle}"` : '';
      return [
        cible ? `<a ${cible} style="cursor:pointer;color:var(--accent)">${l.cle}</a>` : l.cle,
        F(l.net), F1(PCT(l.net,total))+' %', F(l.qte), F(l.offert),
        qTot ? F1(PCT(l.offert,qTot))+' %' : '—',
        barCell(100*l.net/maxNet, l.couleur),
      ];
    }));
  rendreFiltrable('ex-table', 'Filtrer…');
};

/* Navigation de l'exploration. Delegation posee une seule fois : la
   reposer a chaque rendu empilerait les gestionnaires, et un clic
   finirait par descendre de trois niveaux d'un coup. */
if(!window.__amnesiaExploCable){
  window.__amnesiaExploCable = true;
  document.addEventListener('click', ev=>{
    const b = ev.target.closest('[data-explo]');
    if(b){
      if(b.dataset.explo === 'racine') state.explo = {t:null, c:null};
      else if(b.dataset.explo === 'type') state.explo = {t:state.explo.t, c:null};
      RENDER['explorer'](); return;
    }
    const d = ev.target.closest('[data-descendre]');
    if(d && document.getElementById('page-explorer')?.classList.contains('active')){
      const v = d.dataset.descendre;
      if(!state.explo.t) state.explo = {t:v, c:null};
      else if(!state.explo.c) state.explo = {t:state.explo.t, c:v};
      RENDER['explorer']();
    }
  });
}

/* =====================================================================
   PAGE 5 — TRANCHES HORAIRES
   ---------------------------------------------------------------------
   Source cumulee sans date : le filtre de periode est masque pour cette
   page (f:false dans NAV) et la page le redit elle-meme.
   ===================================================================== */

RENDER['horaires'] = function(){
  const h = [...DATA.horaire].sort((a,b)=>ordreNuit(a.heure)-ordreNuit(b.heure));
  const tot = sum(h, 'ca');
  const nuit = sum(h.filter(r=>r.heure>=22 || r.heure<6), 'ca');
  const forte = h.reduce((a,b)=>(b.ca>(a?.ca??-1)?b:a), null);
  const totVentes = sum(h, 'ventes');

  /* Chaque tuile se rapporte a quelque chose : le total du CA pour les
     deux premieres, le total des ventes pour la troisieme. Le panier
     moyen global n'est la part de rien -- il sert au contraire de
     REFERENCE aux paniers de chaque tranche, dans le tableau. */
  const panierGlobal = totVentes ? tot/totVentes : 0;
  document.getElementById('ho-kpi').innerHTML = [
    tuile({k:'PART DU CA ENTRE 22H ET 6H', v:F1(PCT(nuit,tot)), u:'%', cls:'accent',
           hero:true, part:{v:nuit, total:tot, c:'var(--accent)'},
           d:F(nuit)+' F sur '+F(tot)+' F — la nuit fait le chiffre, pas la soirée'}),
    tuile({k:'TRANCHE LA PLUS FORTE', v:forte?forte.libelle:'—',
           part:forte?{v:forte.ca, total:tot, c:'var(--accent-mark)'}:null,
           d:forte?F1(PCT(forte.ca, tot))+' % du chiffre à elle seule — '
                   +FCFA(forte.ca)+' cumulés':''}),
    tuile({k:'VENTES ENREGISTRÉES', v:F(totVentes),
           d:F(h.filter(r=>r.ventes>0).length)+' tranches actives sur '
             +F(h.length)+' — période complète'}),
    tuile({k:'PANIER MOYEN GLOBAL', v:F(panierGlobal), u:'F',
           d:'la référence : chaque tranche se lit par rapport à ce montant'}),
  ].join('');

  /* Le constat : les trois tranches qui portent le chiffre, et
     l'ecart de panier entre le creux et le pic. Un profil horaire sans
     phrase oblige a lire vingt-deux barres pour en tirer trois faits. */
  const tri = [...h].sort((a,b)=>b.ca-a.ca);
  const trois = tri.slice(0,3);
  const partTrois = trois.reduce((a,b)=>a+b.ca, 0);
  const actives = h.filter(r=>r.ventes >= 20);
  const meilleurPanier = actives.reduce((a,b)=>(b.panier_moyen>(a?a.panier_moyen:-1)?b:a), null);
  document.getElementById('ho-constat').innerHTML = trois.length === 3
    ? constat('good',
        `Trois heures font ${F1(PCT(partTrois, tot))} % de la nuit`,
        `<b>${trois.map(x=>x.libelle).join('</b>, <b>')}</b> pèsent ensemble
         <b>${F(partTrois)} F</b> sur ${F(tot)} F, soit
         <b>${F1(PCT(partTrois, tot))} %</b> du chiffre — sur
         ${nb(h.filter(r=>r.ca>0).length, 'tranche active', 'tranches actives')}.
         ${meilleurPanier ? `<br><br>Le panier ne suit pas le volume :
           la tranche <b>${meilleurPanier.libelle}</b> encaisse
           <b>${F(meilleurPanier.panier_moyen)} F</b> par vente, soit
           <b>${F1(panierGlobal ? 100*meilleurPanier.panier_moyen/panierGlobal : 0)}</b>
           contre 100 pour un panier ordinaire. Comparaison limitée aux tranches
           d'au moins vingt ventes : un panier calculé sur trois tickets ne se
           compare à rien.` : ''}`)
    : '';

  setChart('c-ho-ca', {type:'bar',
    data:{labels:h.map(r=>r.libelle), datasets:[Object.assign({}, BAR, {
      label:'CA', data:h.map(r=>r.ca), backgroundColor:C.accentMark})]},
    options:{plugins:{legend:{display:false}, tooltip:Object.assign({},TOOLTIP,{
        callbacks:{label:c=>' '+FCFA(c.parsed.y)
                            +'  ('+F1(PCT(c.parsed.y,tot))+' % du CA)'}})},
      scales:{y:axisY(), x:axisX({ticks:{color:C.faint, font:{size:9.5},
                                          maxRotation:60, minRotation:60}})}},
    plugins:[pctBarres('x')]});

  document.getElementById('ho-t').innerHTML = tableHTML(
    [{t:'Tranche'},{t:'CA',num:true},{t:'% du CA',num:true},{t:'Ventes',num:true},
     {t:'Vendeurs',num:true},{t:'Panier moyen',num:true}],
    h.map(r=>[r.libelle, F(r.ca), F1(PCT(r.ca,tot))+' %', F(r.ventes),
              F(r.vendeurs), F(r.panier_moyen)]));

  setChart('c-ho-panier', {type:'line',
    data:{labels:h.map(r=>r.libelle), datasets:[Object.assign({}, LINE, {
      label:'Panier moyen', data:h.map(r=>r.panier_moyen),
      borderColor:C.accent, backgroundColor:'rgba(234,206,101,.14)', fill:true})]},
    options:{plugins:{legend:{display:false}, tooltip:Object.assign({},TOOLTIP,{
        callbacks:{label:c=>' Panier moyen : '+FCFA(c.parsed.y)}})},
      scales:{y:axisY(), x:axisX({ticks:{color:C.faint, font:{size:9.5},
                                          maxRotation:60, minRotation:60}})}}});

  setChart('c-ho-ventes', {type:'bar',
    data:{labels:h.map(r=>r.libelle), datasets:[Object.assign({}, BAR, {
      label:'Ventes', data:h.map(r=>r.ventes),
      backgroundColor:C.cat[1], maxBarThickness:20})]},
    options:{plugins:{legend:{display:false}, tooltip:Object.assign({},TOOLTIP,{
        callbacks:{label:c=>' '+F(c.parsed.y)+' ventes'}})},
      scales:{y:axisY(v=>F(v)), x:axisX({ticks:{color:C.faint, font:{size:9.5},
                                                 maxRotation:60, minRotation:60}})}},
    plugins:[pctBarres('x')]});

  document.getElementById('ho-note').textContent =
    "Ce profil vient d'un export cumulé qui ne porte aucune date : il couvre "
    + "toute la période et ne réagit pas au filtre, qui est masqué sur cette page "
    + "plutôt que de laisser croire qu'il a été pris en compte.";
};

/* Ordre de la nuit : 14h en premier, 13h en dernier. Sans cela, minuit
   coupe la soiree en deux et le pic se lit aux deux bouts du graphique. */
function ordreNuit(h){ return (h + 10) % 24; }

/* =====================================================================
   PAGE 6 — CAISSIERS
   ===================================================================== */

RENDER['caissiers'] = function(){
  const actifs = (DATA.caissiers || []).filter(c=>c.tickets > 0)
    .sort((a,b)=>b.net-a.net);
  const totCA = actifs.reduce((a,b)=>a+b.net, 0);
  const totTk = actifs.reduce((a,b)=>a+b.tickets, 0);
  const offCais = new Map((DATA.offerts_caissier||[]).map(o=>[o.caissier, o]));

  const premier = actifs[0];
  const panierMoyen = totTk ? totCA/totTk : 0;
  document.getElementById('ca-kpi').innerHTML = [
    tuile({k:'LE PLUS ACTIF', v:premier?premier.nom:'—', hero:true, cls:'accent',
           part:premier?{v:premier.net, total:totCA, c:'var(--accent)'}:null,
           d:premier?F1(PCT(premier.net,totCA))+' % du chiffre · '
                     +F1(PCT(premier.tickets,totTk))+' % des tickets':''}),
    tuile({k:'CAISSIERS ACTIFS', v:F(actifs.length),
           part:{v:actifs.length, total:(DATA.caissiers||[]).length || 1,
                 c:'var(--accent-mark)'},
           d:'sur '+F((DATA.caissiers||[]).length)+' comptes déclarés'}),
    /* Une moyenne par caissier serait ici le plus trompeur des
       chiffres : un poste tient plus de neuf tickets sur dix, et
       diviser par cinq laisserait croire a une caisse partagee. On
       montre donc le reste, qui est la vraie grandeur. */
    tuile({k:'TICKETS ENREGISTRÉS', v:F(totTk),
           d:premier
             ? F(totTk - premier.tickets)+' hors du poste principal, soit '
               +F1(PCT(totTk - premier.tickets, totTk))+' %'
             : 'sur toute la période'}),
    tuile({k:'PANIER MOYEN', v:F(panierMoyen), u:'F',
           d:'la référence : chaque caissier se lit par rapport à ce montant'}),
  ].join('');

  /* Deux faits qu'on ne lit pas dans un tableau de cinq lignes sans le
     dire : la concentration, et le fait qu'un panier eleve ne signifie
     pas un poste actif. Le seuil de volume est le meme que partout
     ailleurs sur ce tableau de bord -- cinq pour cent du chiffre. */
  const significatifs = actifs.filter(c => c.net >= 0.05 * totCA);
  const gros = significatifs.length > 1
    ? significatifs.reduce((a,b)=>(b.panier_moyen>a.panier_moyen?b:a))
    : null;
  document.getElementById('ca-constat').innerHTML = premier
    ? constat(PCT(premier.net, totCA) > 80 ? 'warn' : 'good',
        `${premier.nom} enregistre ${F1(PCT(premier.net, totCA))} % du chiffre`,
        `<b>${F(premier.net)} F</b> sur ${F(totCA)} F, et
         <b>${F(premier.tickets)}</b> des ${F(totTk)} tickets.
         ${PCT(premier.net, totCA) > 80
           ? `<br><br>Une caisse tenue à ce point par un seul poste n'est pas un
              constat de performance mais un constat d'organisation : tout écart
              de caisse, toute remise, tout offert passe par la même main, et il
              n'existe aucun terme de comparaison interne. Les taux des autres
              postes, calculés sur quelques dizaines de tickets, ne se comparent
              pas au sien.`
           : ''}
         ${gros && gros !== premier
           ? `<br><br>Le panier le plus élevé n'est pas le sien :
              <b>${gros.nom}</b> encaisse <b>${F(gros.panier_moyen)} F</b> par
              ticket, soit ${F1(panierMoyen ? 100*gros.panier_moyen/panierMoyen : 0)}
              contre 100 pour un panier ordinaire.`
           : ''}`)
    : '';

  setChart('c-ca-ca', {type:'bar',
    data:{labels:actifs.map(c=>c.nom), datasets:[Object.assign({}, BAR, {
      label:'CA réalisé', data:actifs.map(c=>c.net), backgroundColor:C.accentMark})]},
    options:{plugins:{legend:{display:false}, tooltip:Object.assign({},TOOLTIP,{
        callbacks:{label:c=>' '+FCFA(c.parsed.y)
                            +'  ('+F1(PCT(c.parsed.y,totCA))+' %)'}})},
      scales:{y:axisY(), x:axisX()}},
    plugins:[pctBarres('x')]});

  const maxCA = Math.max(...actifs.map(c=>c.net), 1);
  document.getElementById('ca-table').innerHTML = tableHTML(
    [{t:'Caissier'},{t:'Tickets',num:true},{t:'Articles',num:true},
     {t:'CA réalisé',num:true},{t:'% du CA',num:true},{t:'Panier moyen',num:true},
     {t:'Valeur offerte',num:true},{t:'Offert / encaissé',num:true},{t:''}],
    actifs.map(c=>{
      const o = offCais.get(c.nom) || {valeur:0};
      return [c.nom, F(c.tickets), F(c.produits), F(c.net),
              F1(PCT(c.net,totCA))+' %', F(c.panier_moyen), F(o.valeur),
              c.net ? F1(100*o.valeur/c.net)+' %' : '—',
              barCell(100*c.net/maxCA, C.accentMark)];
    }));

  document.getElementById('ca-table').insertAdjacentHTML('beforeend',
    `<div class="foot">Source cumulée sans date : ces chiffres couvrent toute la
     période et ne réagissent pas au filtre. Le « panier moyen » est celui que
     le logiciel calcule lui-même.</div>`);
};

/* =====================================================================
   PAGE 7 — REGLEMENTS
   ===================================================================== */

RENDER['reglements'] = function(){
  const reg = [...(DATA.reglements || [])].sort((a,b)=>b.montant-a.montant);
  const tot = reg.reduce((a,b)=>a+b.montant, 0);
  const totNb = reg.reduce((a,b)=>a+b.nombre, 0);

  const trouver = n => reg.find(r=>_sansAccents(r.moyen).includes(n)) || {montant:0, nombre:0};
  const especes = trouver('espece');
  const credit = trouver('credit');

  document.getElementById('re-kpi').innerHTML = [
    tuile({k:'TOTAL ENCAISSÉ', v:Fc(tot), u:'F', hero:true,
           d:F(totNb)+' opérations · '+F(totNb ? tot/totNb : 0)+' F en moyenne'}),
    tuile({k:'PART DES ESPÈCES', v:F1(PCT(especes.montant,tot)), u:'%', cls:'warn',
           part:{v:especes.montant, total:tot, c:'var(--st-warn)'},
           d:F(especes.montant)+' F en numéraire sur '+F(tot)+' F'}),
    tuile({k:'VENTES À CRÉDIT', v:Fc(credit.montant), u:'F', cls:'crit',
           part:{v:credit.montant, total:tot, c:'var(--st-crit)'},
           d:F1(PCT(credit.montant, tot))+' % du total · '+F(credit.nombre)
             +" opérations non encaissées"}),
    tuile({k:'MOYENS UTILISÉS', v:F(reg.filter(r=>r.montant>0).length),
           d:'sur '+F(reg.length)+' déclarés — période complète'}),
  ].join('');

  document.getElementById('re-constat').innerHTML = constat('warn',
    'Une dépendance forte aux espèces, et des ventes à crédit',
    `<b>${F1(PCT(especes.montant,tot))} %</b> des encaissements se font en numéraire
     (${F(especes.montant)} F), et <b>${F(credit.montant)} F</b> de ventes sont
     enregistrées à crédit sur ${F(credit.nombre)} opérations.
     <br><br>Le numéraire ne laisse pas de trace bancaire : c'est le moyen de
     règlement le plus exposé aux écarts de caisse, et celui qui demande le plus
     de contrôle. Les ventes à crédit, elles, sont du chiffre comptabilisé qui
     n'est pas encore rentré — le suivi du recouvrement ne figure pas dans ces
     exports.`);

  /* Une ligne a l'echelle plutot qu'un anneau : cinq moyens de
     reglement se comparent en longueurs, pas en angles, et la part
     s'ecrit dans le segment au lieu d'attendre un survol. */
  document.getElementById('re-compo').innerHTML = barreComposition(
    reg.map((r, i) => ({l:r.moyen, v:r.montant, c:C.cat[i % C.cat.length]})));

  /* Les memes montants en barres : la composition dit la part de
     chacun dans le tout, celle-ci permet de les comparer deux a deux --
     « le credit vaut-il plus que la carte » ne se lit pas sur une barre
     empilee dont les segments ne partagent pas de base. */
  barHorizontale('c-re-montant', reg.map(r=>r.moyen), reg.map(r=>r.montant),
                 reg.map((_, i)=>C.cat[i % C.cat.length]), FCFA, 'Montant');

  setChart('c-re-nb', {type:'bar',
    data:{labels:reg.map(r=>r.moyen), datasets:[Object.assign({}, BAR, {
      label:'Opérations', data:reg.map(r=>r.nombre), backgroundColor:C.cat[1]})]},
    options:{plugins:{legend:{display:false}, tooltip:Object.assign({},TOOLTIP,{
        callbacks:{label:c=>' '+F(c.parsed.y)+' opérations',
          footer:items=>{const r=reg[items[0].dataIndex];
            return 'Montant moyen : '+FCFA(r.nombre ? r.montant/r.nombre : 0);}}})},
      scales:{y:axisY(v=>F(v)), x:axisX()}},
    plugins:[pctBarres('x')]});

  document.getElementById('re-table').innerHTML = tableHTML(
    [{t:'Moyen de règlement'},{t:'Opérations',num:true},{t:'Montant',num:true},
     {t:'% du total',num:true},{t:'Montant moyen',num:true}],
    reg.map(r=>[r.moyen, F(r.nombre), F(r.montant), F1(PCT(r.montant,tot))+' %',
                F(r.nombre ? r.montant/r.nombre : 0)]));
};

/* Comparaison insensible aux accents : l'export ecrit « ESPÈCES » et
   « Règlement à crédit », et chercher la sous-chaine « espece » sur la
   forme accentuee ne trouverait rien. */
function _sansAccents(s){
  return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
}

/* =====================================================================
   LE SUIVI MENSUEL
   ---------------------------------------------------------------------
   Trois pages -- compte de resultat, depenses, rapprochement -- qui ne
   viennent pas du POS mais du classeur tenu par l'exploitation. Elles
   comblent exactement ce que la navigation annoncait comme impossible :
   les exports Infogest ne portent aucun prix d'achat.

   POURQUOI CES PAGES NE SUIVENT PAS LE FILTRE DE PERIODE
   ------------------------------------------------------
   Le classeur couvre deux saisons separees par treize mois de fermeture
   pour renovation. Le filtre de periode est cale sur l'export de
   caisse, qui ne couvre que la seconde. Le lui appliquer ferait
   disparaitre onze mois d'exploitation sans que rien ne l'explique.
   Chaque page dit donc quelle periode elle couvre.

   AUCUN RATIO N'EST STOCKE
   ------------------------
   Taux de marge, rentabilite, part d'un poste : tout est recalcule
   somme / somme a l'affichage. Un taux mensuel moyenne entre douze mois
   ne vaut pas le taux de l'annee des que les mois pesent des montants
   differents -- et ils en pesent.
   ===================================================================== */

const MEN = () => DATA.mensuel || {mois: [], postes_mois: [], jours_declares: [],
                                   controles: [], canaux: [], classes: {}};

const moisLibelle = m => MOIS[parseInt(m.slice(5, 7), 10) - 1] + ' ' + m.slice(2, 4);

/* Accord en nombre. Une phrase construite par concatenation ecrit
   « 1 nuits font l'inverse » des que le compte tombe a un, et ce genre
   de faute fait douter du chiffre a cote. */
const nb = (n, singulier, pluriel) => F(n) + ' ' + (n > 1 ? pluriel : singulier);

const rangMois = m => parseInt(m.slice(0, 4), 10) * 12 + parseInt(m.slice(5, 7), 10);

/* Le resultat n'est calcule que si la paie est connue. Un mois dont la
   paie n'a pas ete saisie afficherait sinon un benefice majore d'un
   mois entier de salaires -- et rien a l'ecran ne dirait pourquoi. */
function resultatMois(m){
  if(m.paie === null || m.paie === undefined) return null;
  return m.ca - m.matiere - m.opex - m.capex - m.paie;
}

/* Les mois consecutifs forment une saison ; treize mois de fermeture en
   separent deux. On decoupe sur les trous plutot que sur une date
   ecrite en dur : une troisieme saison se rangerait toute seule. */
function saisons(){
  const out = [];
  for(const m of MEN().mois){
    const courante = out.length ? out[out.length - 1] : null;
    if(courante && rangMois(m.m) - rangMois(courante[courante.length - 1].m) === 1){
      courante.push(m);
    } else {
      out.push([m]);
    }
  }
  return out;
}

function saisonCourante(){
  const s = saisons();
  return s.length ? s[s.length - 1] : [];
}

/* Le libelle d'une saison, pour que chaque tuile dise sur quoi elle
   porte sans qu'on ait a le deviner. */
function libelleSaison(saison){
  if(!saison.length) return '';
  return saison.length === 1 ? moisLibelle(saison[0].m)
    : moisLibelle(saison[0].m) + ' → ' + moisLibelle(saison[saison.length - 1].m);
}

/* L'ordre est FIXE et la couleur attachee a la nature de la charge, pas
   a son rang : la masse salariale garde sa teinte d'un mois a l'autre
   meme quand elle passe devant les achats. */
const CHARGES = [
  {k: 'matiere', l: 'Achats matière'},
  {k: 'opex',    l: "Charges d'exploitation"},
  {k: 'paie',    l: 'Masse salariale'},
  {k: 'capex',   l: 'Investissements'},
];
/* Quatre NATURES, donc quatre teintes -- et non quatre echelons d'une
   meme rampe. La rampe encodait un ordre que ces charges n'ont pas :
   rien ne dit que la matiere vient « avant » la paie, elles sont
   seulement differentes. Et quatre bleus voisins ne se distinguaient
   pas : l'ecart minimal entre les deux plus GROS segments tombait a 7,1
   en vision deuteranope.

   Les teintes viennent de la famille categorielle du chassis, propre a
   chaque etablissement parce qu'une couleur lisible sur le bleu profond
   de TABOO ne l'est pas forcement sur le brun d'AMNESIA. Celles
   d'AMNESIA ont ete cherchees sous contrainte -- contraste borne haut
   ET bas, rouge et vert francs exclus parce qu'ils portent deja un
   etat, l'or de la marque dans la comparaison -- et tiennent un ecart
   minimal de 15,2 dans les quatre visions. Le detail du calcul est dans
   lib/etablissements.js, a cote des valeurs. */
const couleurCharge = () => ({matiere: C.cat[0], opex: C.cat[1],
                              paie: C.cat[2], capex: C.cat[3]});

/* =====================================================================
   PAGE — COMPTE DE RESULTAT
   ===================================================================== */

RENDER['resultat'] = function(){
  const tous = MEN().mois;
  const saison = saisonCourante();
  const complets = saison.filter(m => resultatMois(m) !== null);
  const CC = couleurCharge();

  const t = k => complets.reduce((s, m) => s + (m[k] || 0), 0);
  const ca = t('ca'), matiere = t('matiere'), opex = t('opex');
  const capex = t('capex'), paie = t('paie');
  const margeBrute = ca - matiere;
  const resultat = margeBrute - opex - capex - paie;
  const periode = libelleSaison(complets);

  /* Les trois dernieres tuiles se rapportent toutes au chiffre
     d'affaires : leurs barres sont donc a la meme echelle et se lisent
     les unes contre les autres -- la marge brute, ce que la paie en
     reprend, ce qu'il en reste. */
  document.getElementById('cr-kpi').innerHTML = [
    tuile({k: "CHIFFRE D'AFFAIRES", v: Fc(ca), u: 'F', hero: true, cls: 'accent',
           part: {v: ca, total: ca, c: 'var(--accent)'},
           d: F(ca) + ' F · ' + F(complets.length) + ' mois · ' + periode}),
    tuile({k: 'MARGE BRUTE', v: Fc(margeBrute), u: 'F',
           part: {v: margeBrute, total: ca, c: 'var(--accent)'},
           d: F1(PCT(margeBrute, ca)) + " % du chiffre d'affaires"}),
    tuile({k: 'MASSE SALARIALE', v: Fc(paie), u: 'F',
           part: {v: paie, total: ca, c: 'var(--st-warn)'},
           d: F1(PCT(paie, ca)) + " % du chiffre d'affaires"}),
    tuile({k: 'RÉSULTAT NET', v: Fc(resultat), u: 'F',
           cls: resultat >= 0 ? 'good' : 'crit',
           part: {v: Math.abs(resultat), total: ca,
                  c: resultat >= 0 ? 'var(--st-good)' : 'var(--st-crit)'},
           d: F1(PCT(resultat, ca)) + ' % de rentabilité · après investissements'}),
  ].join('');

  // --- le constat ----------------------------------------------------
  const incomplets = saison.filter(m => resultatMois(m) === null);
  let pire = null;
  for(const m of complets)
    if(pire === null || resultatMois(m) < resultatMois(pire)) pire = m;

  document.getElementById('cr-constat').innerHTML = constat(
    resultat >= 0 ? 'good' : 'crit',
    resultat >= 0 ? `La saison dégage ${F(resultat)} F de résultat`
                  : `La saison perd ${F(Math.abs(resultat))} F`,
    `Sur ${F(complets.length)} mois (${periode}), ${F(ca)} F encaissés pour
     ${F(matiere + opex + capex + paie)} F de charges. La marge brute tient à
     <b>${F1(PCT(margeBrute, ca))} %</b>, mais l'exploitation, la paie et les
     investissements en reprennent
     <b>${F1(PCT(opex + paie + capex, ca))} %</b> du chiffre d'affaires.
     ${pire && resultatMois(pire) < 0
       ? ` Le mois le plus lourd est ${moisLibelle(pire.m)}, à ${F(resultatMois(pire))} F.`
       : ''}
     ${incomplets.length
       ? `<br><br>${nb(incomplets.length, 'mois', 'mois')}
          (${incomplets.map(m => moisLibelle(m.m)).join(', ')})
          ${incomplets.length > 1
            ? "n'ont pas de paie saisie dans le classeur : ils sont écartés de ces"
              + ' totaux plutôt que comptés sans salaires, ce qui les ferait passer'
              + ' pour les plus rentables de la saison.'
            : "n'a pas de paie saisie dans le classeur : il est écarté de ces"
              + ' totaux plutôt que compté sans salaires, ce qui le ferait passer'
              + ' pour le plus rentable de la saison.'}`
       : ''}`);

  // --- la cascade mensuelle -------------------------------------------
  // Barres empilees pour les charges, ligne pour le chiffre d'affaires :
  // meme unite, donc un seul axe. Jamais deux echelles verticales, qui
  // laissent choisir au dessinateur l'endroit ou les courbes se croisent.
  const lab = tous.map(m => moisLibelle(m.m));
  setChart('c-cr-cascade', {
    data: {labels: lab, datasets: [
      ...CHARGES.map(ch => Object.assign({}, STACK, {
        type: 'bar', label: ch.l, stack: 'charges',
        data: tous.map(m => m[ch.k] || 0), backgroundColor: CC[ch.k]})),
      Object.assign({}, LINE, {
        type: 'line', label: "Chiffre d'affaires", data: tous.map(m => m.ca),
        borderColor: C.accentMark, backgroundColor: C.accentMark,
        pointBackgroundColor: C.accentMark}),
    ]},
    options: {interaction: {mode: 'index', intersect: false},
      plugins: {legend: legendTop(true), tooltip: Object.assign({}, TOOLTIP, {
        callbacks: {
          // La valeur relative, immediatement : chaque charge en part du
          // chiffre d'affaires DU MOIS, pas du total de la periode.
          label: c => {
            const m = tous[c.dataIndex];
            const part = (m.ca && c.dataset.type !== 'line')
              ? '  (' + F1(PCT(c.parsed.y, m.ca)) + ' % du CA)' : '';
            return ' ' + c.dataset.label + ' : ' + FCFA(c.parsed.y) + part;
          },
          footer: items => {
            const m = tous[items[0].dataIndex];
            const r = resultatMois(m);
            return r === null ? 'Résultat : paie non saisie'
              : 'Résultat : ' + FCFA(r) + '  (' + F1(PCT(r, m.ca)) + ' %)';
          }}})},
      scales: {y: axisY(), x: axisX()}},
    // Le total des charges en part du chiffre d'affaires DU MOIS : ce
    // qui reste au-dessus de 100 % est la perte, ce qui manque est le
    // resultat. La lecture se fait en diagonale, sans survol.
    plugins: [etiquetteSommet(
      tous.map(m => PCT(m.matiere + m.opex + m.capex + (m.paie || 0), m.ca)),
      v => F(v) + ' %')]});

  document.getElementById('cr-cascade-t').innerHTML = tableHTML(
    [{t: 'Mois'}, {t: "Chiffre d'affaires", num: true}, {t: 'Achats matière', num: true},
     {t: "Charges d'exploitation", num: true}, {t: 'Masse salariale', num: true},
     {t: 'Investissements', num: true}, {t: 'Résultat', num: true}],
    tous.map(m => {
      const r = resultatMois(m);
      return [moisLibelle(m.m), F(m.ca), F(m.matiere), F(m.opex),
              m.paie === null ? 'non saisie' : F(m.paie), F(m.capex),
              r === null ? '—' : F(r)];
    }));

  // La structure des charges et la paie par service sont parties sur la
  // page « Structure des charges » : elles repondent a « ou part
  // l'argent », quand celle-ci repond a « combien reste-t-il ».

  // --- les deux taux ----------------------------------------------------
  // Un ratio n'a de sens que si son denominateur en a un. Le dernier
  // mois avant la fermeture a encaisse deux ordres de grandeur de moins
  // qu'un mois ordinaire : sa rentabilite se compte en centaines de
  // pour cent negatifs, ce qui ecrase l'axe et rend les vingt et un
  // autres mois illisibles. Les montants sont calcules a l'affichage et
  // nommes dans le pied de carte -- ils ne sont pas ecrits ici, ce
  // fichier etant versionne.
  //
  // Le graphique se limite donc a la saison en cours, et le dit. Les
  // taux de la premiere saison ne sont pas perdus : ils sont dans le
  // tableau ci-dessous, ou une valeur aberrante n'empeche pas de lire
  // ses voisines. Borner l'axe en laissant le point sortir du cadre
  // aurait cache une mesure sans le signaler.
  const labSaison = saison.map(m => moisLibelle(m.m));
  setChart('c-cr-taux', {type: 'line',
    data: {labels: labSaison, datasets: [
      Object.assign({}, LINE, {label: 'Taux de marge brute',
        data: saison.map(m => PCT(m.ca - m.matiere, m.ca)),
        borderColor: C.accentMark, backgroundColor: C.accentMark,
        pointBackgroundColor: C.accentMark}),
      Object.assign({}, LINE, {label: 'Rentabilité nette',
        data: saison.map(m => {
          const r = resultatMois(m);
          return r === null ? null : PCT(r, m.ca);
        }),
        borderColor: C.compare, backgroundColor: C.compare,
        pointBackgroundColor: C.compare, spanGaps: false}),
    ]},
    options: {interaction: {mode: 'index', intersect: false},
      plugins: {legend: legendTop(true), tooltip: Object.assign({}, TOOLTIP, {
        callbacks: {label: c => ' ' + c.dataset.label + ' : '
          + (c.parsed.y === null ? '—' : F1(c.parsed.y) + ' %')}})},
      scales: {y: axisY(v => F1(v) + ' %'), x: axisX()}}});

  // Le mois cite est celui qui JUSTIFIE l'exclusion -- le plus faible
  // chiffre d'affaires des mois ecartes -- et non le dernier de la
  // liste : c'est lui qui rendait l'axe inutilisable.
  const horsTaux = tous.filter(m => !saison.includes(m));
  let creux = null;
  for(const m of horsTaux) if(creux === null || m.ca < creux.ca) creux = m;
  const noteTaux = document.getElementById('cr-taux-note');
  if(noteTaux) noteTaux.innerHTML = horsTaux.length
    ? `Saison en cours uniquement (${libelleSaison(saison)}).
       Les ${F(horsTaux.length)} mois de la saison précédente sont écartés de ce
       graphique : ${moisLibelle(creux.m)} n'a encaissé que ${F(creux.ca)} F, soit
       une rentabilité de ${F1(PCT(resultatMois(creux), creux.ca))} % qui écrase
       l'échelle sans rien apprendre des autres mois. Leurs taux figurent dans le
       tableau ci-dessous, où une valeur aberrante n'empêche pas de lire ses
       voisines.`
    : '';

  // Le tableau mensuel accompagne desormais la structure : c'est lui
  // qui donne poste par poste ce que la composition donne d'un coup.

  // --- le renvoi vers les ecarts --------------------------------------------
  // Le detail est sur sa propre page. Ce qui reste ici est le minimum
  // pour qu'on ne lise pas ce compte de resultat en croyant le classeur
  // intact -- avec le compte, qui dit s'il y a lieu d'aller voir.
  const redresses = MEN().controles.length;
  document.getElementById('cr-renvoi').innerHTML = redresses
    ? constat('warn', `${nb(redresses, 'écart relevé', 'écarts relevés')} dans le classeur d'origine`,
        `Ce compte de résultat n'est pas la recopie du classeur : les feuilles de
         la première saison lisent une colonne de paie décalée, trois prestataires
         échappent au total qui devrait les couvrir, et deux postes de charges sont
         mal comptés. Chaque redressement est détaillé et chiffré sur la page
         <a href="#" onclick="go('ecarts');return false;"><b>Écarts &amp;
         contrôles</b></a>.`)
    : '';
};

/* =====================================================================
   PAGE — DEPENSES
   ===================================================================== */

/* =====================================================================
   PAGE — STRUCTURE DES CHARGES
   ---------------------------------------------------------------------
   Detachee du compte de resultat. Celui-ci repond a « combien reste-
   t-il » ; celle-ci a « ou part l'argent ». Les deux tenaient sur un
   ecran de sept blocs, ou la structure arrivait apres une cascade et
   deux courbes de ratio -- c'est-a-dire jamais.

   Rien n'a ete retire : la cascade et les taux sont restes la-bas, la
   structure, la paie et le tableau mensuel sont ici.
   ===================================================================== */

RENDER['structure'] = function(){
  const tous = MEN().mois;
  const saison = saisonCourante();
  const complets = saison.filter(m => resultatMois(m) !== null);
  const CC = couleurCharge();

  const t = k => complets.reduce((s, m) => s + (m[k] || 0), 0);
  const ca = t('ca');
  const charges = CHARGES.map(ch => ({k: ch.k, l: ch.l, v: t(ch.k), c: CC[ch.k]}));
  const totCharges = charges.reduce((s, x) => s + x.v, 0);
  const resultat = ca - totCharges;
  const periode = libelleSaison(complets);

  const lourde = charges.reduce((a, b) => (b.v > a.v ? b : a), charges[0]);

  document.getElementById('st-kpi').innerHTML = [
    tuile({k: 'TOTAL DES CHARGES', v: Fc(totCharges), u: 'F', hero: true,
           cls: 'warn', part: {v: totCharges, total: ca, c: 'var(--st-warn)'},
           d: F1(PCT(totCharges, ca)) + " % du chiffre d'affaires · " + periode}),
    tuile({k: 'LE POSTE LE PLUS LOURD', v: lourde ? lourde.l : '—',
           part: lourde ? {v: lourde.v, total: totCharges, c: lourde.c} : null,
           d: lourde ? F(lourde.v) + ' F — ' + F1(PCT(lourde.v, totCharges))
                       + ' % des charges, ' + F1(PCT(lourde.v, ca)) + ' % du CA'
                     : ''}),
    tuile({k: 'CE QUI RESTE', v: Fc(resultat), u: 'F',
           cls: resultat >= 0 ? 'good' : 'crit',
           part: {v: Math.abs(resultat), total: ca,
                  c: resultat >= 0 ? 'var(--st-good)' : 'var(--st-crit)'},
           d: F1(PCT(resultat, ca)) + " % du chiffre d'affaires"}),
    tuile({k: 'CHARGES PAR MOIS', v: Fc(complets.length ? totCharges/complets.length : 0),
           u: 'F',
           d: 'moyenne sur ' + nb(complets.length, 'mois complet', 'mois complets')}),
  ].join('');

  /* Nommer le poste, puis le rapporter a deux denominateurs qui ne
     disent pas la meme chose : sa part des CHARGES dit la structure,
     sa part du CHIFFRE dit ce qu'il coute reellement. Les confondre est
     la facon la plus courante de se tromper d'un facteur deux. */
  document.getElementById('st-constat').innerHTML = lourde
    ? constat(PCT(lourde.v, ca) > 35 ? 'crit' : 'warn',
        `${lourde.l} : ${F1(PCT(lourde.v, ca))} % du chiffre d'affaires`,
        `Sur ${periode}, ${lourde.l.toLowerCase()} pèse <b>${F(lourde.v)} F</b> —
         <b>${F1(PCT(lourde.v, totCharges))} %</b> de tout ce qui sort, et
         <b>${F1(PCT(lourde.v, ca))} %</b> de tout ce qui rentre.
         <br><br>Les deux pourcentages ne se remplacent pas : le premier dit la
         structure des dépenses, le second ce que ce poste coûte réellement à
         l'établissement. C'est le second qui se compare à une norme de métier,
         et c'est le premier qu'on cite en réunion.
         ${resultat < 0
           ? `<br><br>Les quatre postes réunis dépassent le chiffre d'affaires de
              <b>${F(Math.abs(resultat))} F</b>.`
           : `<br><br>Il reste <b>${F(resultat)} F</b> une fois les quatre postes
              payés, soit ${F1(PCT(resultat, ca))} % du chiffre d'affaires.`}`)
    : '';

  /* La composition inclut CE QUI RESTE : sans lui, les quatre charges
     feraient 100 % d'elles-memes, ce qui est vrai et sans interet. Avec
     lui, la ligne entiere vaut le chiffre d'affaires, et chaque segment
     se lit directement en part du chiffre. */
  document.getElementById('st-compo').innerHTML = barreComposition(
    charges.filter(x => x.v > 0).sort((a, b) => b.v - a.v)
      .map(x => ({l: x.l, v: x.v, c: x.c}))
      /* Le reste n'est pas une cinquieme charge : il porte donc une
         encre neutre et non une couleur de serie. Il portait le vert
         d'etat, qui tombait a cote du vert-bleu des investissements --
         deux verts voisins pour deux choses sans rapport, et le lecteur
         cherchait ce qui les rapprochait. */
      .concat(resultat > 0
        ? [{l: 'Résultat', v: resultat, c: C.faint}] : []));

  const structure = charges.filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  barHorizontale('c-cr-structure', structure.map(x => x.l),
                 structure.map(x => x.v), structure.map(x => x.c));

  const services = new Map();
  for(const m of complets)
    for(const sv of (m.paie_services || []))
      services.set(sv.service, (services.get(sv.service) || 0) + sv.montant);
  const parService = [...services.entries()].sort((a, b) => b[1] - a[1]);
  barHorizontale('c-cr-paie', parService.map(x => x[0]),
                 parService.map(x => x[1]), C.cat[2]);

  /* Le tableau mensuel, avec la part de chaque charge dans le chiffre
     DU MOIS -- et non dans le total de la periode. Un poste peut peser
     10 % de l'annee et 40 % d'un mois creux ; c'est ce mois-la qu'on
     cherche en ouvrant un tableau. */
  document.getElementById('cr-table').innerHTML = tableHTML(
    [{t: 'Mois'}, {t: 'Nuits', num: true}, {t: "Chiffre d'affaires", num: true},
     {t: 'Achats matière', num: true}, {t: 'Marge brute', num: true},
     {t: 'Taux de marge', num: true}, {t: "Charges d'exploit.", num: true},
     {t: 'Masse salariale', num: true}, {t: '% du CA', num: true},
     {t: 'Investissements', num: true},
     {t: 'Résultat', num: true}, {t: 'Rentabilité', num: true}],
    tous.map(m => {
      const r = resultatMois(m);
      return [m.m + ' · ' + moisLibelle(m.m), F(m.nuits), F(m.ca), F(m.matiere),
              F(m.ca - m.matiere), F1(PCT(m.ca - m.matiere, m.ca)) + ' %',
              F(m.opex), m.paie === null ? 'non saisie' : F(m.paie),
              m.paie === null ? '—' : F1(PCT(m.paie, m.ca)) + ' %', F(m.capex),
              r === null ? '—' : F(r),
              r === null ? '—' : F1(PCT(r, m.ca)) + ' %'];
    }));
  rendreFiltrable('cr-table', 'Filtrer : 2026, juin, 2026-07…');
};

RENDER['depenses'] = function(){
  const tous = MEN().mois;
  const saison = saisonCourante();
  const moisSaison = new Set(saison.map(m => m.m));
  const lignes = MEN().postes_mois.filter(l => moisSaison.has(l.m));
  const classes = MEN().classes || {};

  const parClasse = {};
  for(const l of lignes) parClasse[l.classe] = (parClasse[l.classe] || 0) + l.montant;
  const ca = saison.reduce((s, m) => s + m.ca, 0);
  const charges = (parClasse.matiere || 0) + (parClasse.opex || 0)
                + (parClasse.capex || 0);

  document.getElementById('dp-kpi').innerHTML = [
    tuile({k: 'TOTAL DES CHARGES', v: Fc(charges), u: 'F', hero: true, cls: 'accent',
           d: F1(PCT(charges, ca)) + " % du chiffre d'affaires · "
              + libelleSaison(saison)}),
    tuile({k: 'ACHATS MATIÈRE', v: Fc(parClasse.matiere || 0), u: 'F',
           d: F1(PCT(parClasse.matiere || 0, ca)) + " % du chiffre d'affaires"}),
    tuile({k: "CHARGES D'EXPLOITATION", v: Fc(parClasse.opex || 0), u: 'F',
           d: F1(PCT(parClasse.opex || 0, ca)) + " % du chiffre d'affaires"}),
    tuile({k: 'INVESTISSEMENTS', v: Fc(parClasse.capex || 0), u: 'F',
           d: F1(PCT(parClasse.capex || 0, ca)) + " % du chiffre d'affaires"}),
  ].join('');

  // Memes echelons que la cascade du compte de resultat : une charge
  // garde sa couleur d'une page a l'autre.
  const CC = couleurCharge();

  // --- les postes ---------------------------------------------------------
  const postes = new Map();
  for(const l of lignes){
    if(l.classe === 'tresorerie') continue;   // un mouvement, pas une charge
    const e = postes.get(l.poste) || {montant: 0, classe: l.classe};
    e.montant += l.montant;
    postes.set(l.poste, e);
  }
  const rangs = [...postes.entries()].sort((a, b) => b[1].montant - a[1].montant);
  // La couleur porte la NATURE du poste, pas son rang : deux postes de
  // meme nature se lisent ensemble sans consulter de legende.
  const parNature = {matiere: CC.matiere, opex: CC.opex, capex: CC.capex};

  barHorizontale('c-dp-postes', rangs.map(x => x[0]),
                 rangs.map(x => x[1].montant),
                 rangs.map(x => parNature[x[1].classe] || C.seq[3]));

  const totalPostes = rangs.reduce((s, x) => s + x[1].montant, 0);
  document.getElementById('dp-postes-t').innerHTML = tableHTML(
    [{t: 'Poste'}, {t: 'Nature'}, {t: 'Montant', num: true}, {t: 'Part', num: true}],
    rangs.map(x => [x[0], classes[x[1].classe] || x[1].classe, F(x[1].montant),
                    F1(PCT(x[1].montant, totalPostes)) + ' %']));

  // --- evolution mensuelle -------------------------------------------------
  const pile = [
    {k: 'matiere', l: 'Achats matière',         c: CC.matiere},
    {k: 'opex',    l: "Charges d'exploitation", c: CC.opex},
    {k: 'capex',   l: 'Investissements',        c: CC.capex},
  ];
  setChart('c-dp-mois', {type: 'bar',
    data: {labels: tous.map(m => moisLibelle(m.m)),
      datasets: pile.map(p => Object.assign({}, STACK, {
        label: p.l, data: tous.map(m => m[p.k] || 0), backgroundColor: p.c}))},
    options: {interaction: {mode: 'index', intersect: false},
      plugins: {legend: legendTop(true), tooltip: Object.assign({}, TOOLTIP, {
        callbacks: {
          label: c => {
            const m = tous[c.dataIndex];
            return ' ' + c.dataset.label + ' : ' + FCFA(c.parsed.y)
                   + (m.ca ? '  (' + F1(PCT(c.parsed.y, m.ca)) + ' % du CA)' : '');
          },
          footer: items => {
            const m = tous[items[0].dataIndex];
            const s = m.matiere + m.opex + m.capex;
            return 'Total : ' + FCFA(s)
                   + (m.ca ? '  (' + F1(PCT(s, m.ca)) + ' % du CA)' : '');
          }}})},
      scales: {x: Object.assign(axisX(), {stacked: true}),
               y: Object.assign(axisY(), {stacked: true})}},
    plugins: [etiquetteSommet(
      tous.map(m => PCT(m.matiere + m.opex + m.capex, m.ca)),
      v => F(v) + ' %')]});

  document.getElementById('dp-mois-t').innerHTML = tableHTML(
    [{t: 'Mois'}, {t: 'Achats matière', num: true}, {t: "Charges d'exploit.", num: true},
     {t: 'Investissements', num: true}, {t: 'Total', num: true},
     {t: '% du CA', num: true}],
    tous.map(m => [moisLibelle(m.m), F(m.matiere), F(m.opex), F(m.capex),
                   F(m.matiere + m.opex + m.capex),
                   F1(PCT(m.matiere + m.opex + m.capex, m.ca)) + ' %']));

  // --- le detail -------------------------------------------------------------
  const totalMois = {};
  for(const l of MEN().postes_mois)
    totalMois[l.m] = (totalMois[l.m] || 0) + l.montant;
  document.getElementById('dp-table').innerHTML = tableHTML(
    [{t: 'Mois'}, {t: 'Poste'}, {t: 'Nature'}, {t: 'Montant', num: true},
     {t: 'Part du mois', num: true}],
    MEN().postes_mois.map(l => [l.m + ' · ' + moisLibelle(l.m), l.poste,
      classes[l.classe] || l.classe, F(l.montant),
      F1(PCT(l.montant, totalMois[l.m])) + ' %']));
  rendreFiltrable('dp-table', 'Filtrer : LOYERS, 2026-07, matière…');
};

/* =====================================================================
   PAGE — RAPPROCHEMENT
   ---------------------------------------------------------------------
   Deux mesures du meme chiffre d'affaires. Elles ne se corrigent pas
   l'une l'autre : la caisse n'enregistre que ce qui est passe par le
   logiciel, le classeur note ce que l'exploitation declare avoir
   encaisse. Les confronter est le seul moyen de voir ce qui echappe a
   l'une ou a l'autre.
   ===================================================================== */

RENDER['rapprochement'] = function(){
  // Le calcul vit dans rapprochement(), partage avec la page « Ecarts &
  // controles ». Deux copies du meme rapprochement donneraient deux
  // reponses possibles le jour ou l'une serait corrigee.
  const {decl, pos, jours, communs, totalDecl, totalPos, concordantes,
         seulesDecl, seulesPos, montantSeulesDecl, montantSeulesPos}
    = rapprochement();
  const ecartPct = PCT(totalDecl - totalPos, totalPos);

  document.getElementById('rp-kpi').innerHTML = [
    tuile({k: "DÉCLARÉ PAR L'EXPLOITATION", v: Fc(totalDecl), u: 'F', hero: true,
           cls: 'accent', d: F(jours.length) + ' nuits sur '
                             + F(communs.length) + ' mois communs'}),
    tuile({k: 'ENREGISTRÉ EN CAISSE', v: Fc(totalPos), u: 'F',
           d: "chiffre d'affaires net du logiciel"}),
    tuile({k: 'ÉCART', v: Fc(totalDecl - totalPos), u: 'F',
           cls: Math.abs(ecartPct) > 5 ? 'crit' : 'warn',
           d: F1(ecartPct) + ' % du chiffre de caisse'}),
    tuile({k: 'NUITS CONCORDANTES', v: F(concordantes), u: '/ ' + F(jours.length),
           d: F1(PCT(concordantes, jours.length)) + ' % des nuits au franc près'}),
  ].join('');

  document.getElementById('rp-constat').innerHTML = constat(
    Math.abs(ecartPct) > 5 ? 'crit' : 'warn',
    `Deux sources, ${F1(Math.abs(ecartPct))} % d'écart`,
    `Le classeur d'exploitation déclare <b>${F(totalDecl)} F</b> là où la caisse
     enregistre <b>${F(totalPos)} F</b> sur les mêmes ${F(jours.length)} nuits.
     Seules <b>${F(concordantes)}</b> d'entre elles coïncident au franc près.
     ${seulesDecl.length
       ? `<br><br><b>${nb(seulesDecl.length, 'nuit est facturée', 'nuits sont facturées')}</b>
          dans le classeur sans exister en caisse, pour
          ${F(montantSeulesDecl)} F.` : ''}
     ${seulesPos.length
       ? ` <b>${nb(seulesPos.length, "nuit fait l'inverse", "nuits font l'inverse")}</b>,
          pour ${F(montantSeulesPos)} F.` : ''}
     <br><br>Aucune des deux ne corrige l'autre : la caisse ne voit que ce qui est
     passé par le logiciel, le classeur note ce que l'exploitation dit avoir
     encaissé. Le tableau du bas donne la nuit par nuit ; taper « écart » n'y
     laisse que les nuits où les deux divergent.`);

  // --- par mois -------------------------------------------------------------
  const parMois = communs.map(m => {
    const dm = jours.filter(d => d.startsWith(m));
    return {m,
      decl: dm.reduce((s, d) => s + (decl.get(d) || 0), 0),
      pos: dm.reduce((s, d) => s + (pos.get(d) || 0), 0)};
  });
  setChart('c-rp-mois', {type: 'bar',
    data: {labels: parMois.map(x => moisLibelle(x.m)), datasets: [
      Object.assign({}, BAR, {label: "Déclaré par l'exploitation",
        data: parMois.map(x => x.decl), backgroundColor: C.accentMark}),
      Object.assign({}, BAR, {label: 'Enregistré en caisse',
        data: parMois.map(x => x.pos), backgroundColor: C.compare}),
    ]},
    options: {interaction: {mode: 'index', intersect: false},
      plugins: {legend: legendTop(true), tooltip: Object.assign({}, TOOLTIP, {
        callbacks: {label: c => ' ' + c.dataset.label + ' : ' + FCFA(c.parsed.y),
          footer: items => {
            const x = parMois[items[0].dataIndex];
            return 'Écart : ' + FCFA(x.decl - x.pos)
                   + '  (' + F1(PCT(x.decl - x.pos, x.pos)) + ' %)';
          }}})},
      scales: {y: axisY(), x: axisX()}},
    // L'ecart en pourcentage, mois par mois : c'est la seule chose que
    // ce graphique a a dire, et elle etait cachee dans l'infobulle.
    plugins: [etiquetteSommet(
      parMois.map(x => PCT(x.decl - x.pos, x.pos)),
      v => (v > 0 ? '+' : '') + F1(v) + ' %')]});

  document.getElementById('rp-mois-t').innerHTML = tableHTML(
    [{t: 'Mois'}, {t: 'Déclaré', num: true}, {t: 'Caisse', num: true},
     {t: 'Écart', num: true}, {t: 'Écart %', num: true}],
    parMois.map(x => [moisLibelle(x.m), F(x.decl), F(x.pos), F(x.decl - x.pos),
                      F1(PCT(x.decl - x.pos, x.pos)) + ' %']));

  // --- canaux d'encaissement --------------------------------------------------
  const saison = saisonCourante();
  const canaux = (MEN().canaux || [])
    .map(c => ({l: c.l, v: saison.reduce((s, m) => s + (m[c.c] || 0), 0)}))
    .filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  barHorizontale('c-rp-canaux', canaux.map(x => x.l), canaux.map(x => x.v),
                 canaux.map((_, i) => C.cat[i % C.cat.length]));

  // --- nuit par nuit ------------------------------------------------------------
  // L'etat est ecrit en toutes lettres dans la ligne : le filtre du
  // tableau porte sur le texte, et « ecart » est la question qu'on pose
  // a ce tableau. Elle doit etre atteignable sans choisir de colonne.
  document.getElementById('rp-table').innerHTML = tableHTML(
    [{t: 'Nuit'}, {t: 'Déclaré', num: true}, {t: 'Caisse', num: true},
     {t: 'Différence', num: true}, {t: 'État'}],
    jours.map(d => {
      const a = decl.get(d), b = pos.get(d);
      const etat = a === undefined ? 'absente du classeur'
        : b === undefined ? 'absente de la caisse'
        : Math.abs(a - b) < 1 ? 'concordante' : 'écart';
      return [dateLabel(d), a === undefined ? '—' : F(a),
              b === undefined ? '—' : F(b),
              (a === undefined || b === undefined) ? '—' : F(a - b), etat];
    }));
  rendreFiltrable('rp-table', 'Filtrer : écart, concordante, une date…');
};

/* =====================================================================
   PAGE — ECARTS & CONTROLES
   ---------------------------------------------------------------------
   Trois sources mesurent le meme etablissement :

     la caisse       ce que le logiciel Infogest a enregistre
     le classeur     ce que l'exploitation declare encaisser et depenser
     le resume       le total que le logiciel s'annonce a lui-meme

   Elles ne tombent pas d'accord, et les faire coincider demanderait
   d'en choisir une comme vraie. On ne le fait pas : on montre l'ecart,
   on le chiffre, et on dit ce qu'il empeche de conclure.

   POURQUOI UNE PAGE ENTIERE
   -------------------------
   Ces ecarts etaient disperses : le recoupement des exports en bas de
   la synthese, les defauts du classeur en bas du compte de resultat, le
   rapprochement sur sa propre page. Trois endroits pour une seule
   question -- « peut-on se fier a ce chiffre ? » -- qui se pose avant
   de lire le premier tableau, pas apres le dernier.

   CETTE PAGE NE CALCULE RIEN DE NEUF
   ----------------------------------
   Elle LIT les memes controles que les autres pages. Refaire ici le
   calcul du rapprochement donnerait deux reponses possibles a la meme
   question le jour ou l'une des deux serait modifiee.
   ===================================================================== */

/* Le rapprochement declare / caisse, calcule une fois et reutilise par
   la page « Rapprochement » comme par celle-ci. */
function rapprochement(){
  const declares = MEN().jours_declares;
  const pos = new Map(DATA.resultat_jour.map(r => [r.d, r.net]));
  const decl = new Map(declares.map(r => [r.d, r.ca]));

  const moisPos = new Set(DATA.resultat_jour.map(r => r.d.slice(0, 7)));
  const moisDecl = new Set(declares.map(r => r.d.slice(0, 7)));
  const communs = [...moisPos].filter(m => moisDecl.has(m)).sort();
  const ensemble = new Set(communs);

  const jours = [...new Set([...decl.keys(), ...pos.keys()])]
                  .filter(d => ensemble.has(d.slice(0, 7))).sort();

  const totalDecl = jours.reduce((s, d) => s + (decl.get(d) || 0), 0);
  const totalPos = jours.reduce((s, d) => s + (pos.get(d) || 0), 0);
  const concordantes = jours.filter(d =>
    decl.has(d) && pos.has(d) && Math.abs(decl.get(d) - pos.get(d)) < 1).length;
  const seulesDecl = jours.filter(d => decl.has(d) && !pos.has(d) && decl.get(d));
  const seulesPos = jours.filter(d => pos.has(d) && !decl.has(d) && pos.get(d));

  return {decl, pos, jours, communs, totalDecl, totalPos, concordantes,
          seulesDecl, seulesPos,
          montantSeulesDecl: seulesDecl.reduce((s, d) => s + decl.get(d), 0),
          montantSeulesPos: seulesPos.reduce((s, d) => s + pos.get(d), 0)};
}

/* La liste unique des anomalies, quelle qu'en soit l'origine.

   Chaque entree porte un MONTANT quand il y en a un, et null quand il
   n'y en a pas. Mettre zero a la place de « pas de montant » ferait
   passer un defaut non chiffre pour un defaut sans consequence. */
function anomalies(){
  const out = [];
  const r = rapprochement();
  const c = DATA.controles || {};

  // --- entre les deux mesures du chiffre d'affaires -------------------
  out.push({
    origine: 'Deux sources', gravite: 'crit',
    titre: "Le classeur et la caisse ne trouvent pas le même chiffre d'affaires",
    montant: r.totalDecl - r.totalPos,
    effet: `Sur ${F(r.jours.length)} nuits communes, ${F(r.concordantes)} seulement
            coïncident au franc près. L'écart se resserre avec le temps, ce qui se
            lit comme une saisie qui se fiabilise plutôt que comme une source
            fausse — mais aucune des deux ne peut servir de référence à l'autre
            tant qu'il n'est pas expliqué.`,
  });
  if(r.seulesDecl.length) out.push({
    origine: 'Deux sources', gravite: 'crit',
    titre: nb(r.seulesDecl.length, 'nuit facturée', 'nuits facturées')
           + ' dans le classeur sans exister en caisse',
    montant: r.montantSeulesDecl,
    effet: `Ces nuits portent un chiffre d'affaires que le logiciel n'a jamais
            enregistré. Soit la caisse n'a pas été utilisée, soit la nuit n'a pas
            eu lieu : les deux se corrigent, mais pas de la même façon.`,
  });
  if(r.seulesPos.length) out.push({
    origine: 'Deux sources', gravite: 'warn',
    titre: nb(r.seulesPos.length, 'nuit enregistrée', 'nuits enregistrées')
           + ' en caisse et absente du classeur',
    montant: r.montantSeulesPos,
    effet: `L'inverse du cas précédent : la caisse a encaissé, le suivi manuel ne
            l'a pas repris. Ces montants manquent au suivi de trésorerie.`,
  });

  // --- a l'interieur des exports de caisse -----------------------------
  const LIBELLES = {
    ca_net_journal_vs_resume: ["Chiffre d'affaires : journal contre résumé du logiciel",
      'Les deux totaux du logiciel doivent tomber au franc près.'],
    ca_net_journal_vs_detail: ["Chiffre d'affaires : journal contre détail par article",
      `Le détail par article ne redonne pas le total du journal. La série
       journalière retient le journal, seul à boucler sur le résumé du logiciel ;
       les ventilations par produit portent donc cet écart.`],
    offerts_lignes_vs_journal: ['Articles offerts : lignes contre journal',
      'La somme des lignes offertes doit redonner le total journalier.'],
    offerts_lignes_vs_resume: ['Articles offerts : lignes contre résumé du logiciel',
      'La somme des lignes offertes doit redonner le total du résumé.'],
  };
  for(const [cle, [titre, effet]] of Object.entries(LIBELLES)){
    const t = c[cle];
    if(!t || t.concorde) continue;
    out.push({origine: 'Exports de caisse', gravite: 'warn',
              titre, montant: t.ecart, effet});
  }
  const rem = c.remises;
  if(rem && Math.abs((rem.journal || 0) - (rem.detail || 0)) >= 1){
    out.push({
      origine: 'Exports de caisse', gravite: 'warn',
      titre: 'Trois totaux de remise différents dans les mêmes exports',
      montant: (rem.resume || 0) - (rem.journal || 0),
      effet: (rem.note || '') + ' ' + (rem.lecture_plausible || ''),
    });
  }

  // --- dans le classeur d'exploitation ---------------------------------
  for(const ctrl of MEN().controles){
    out.push({origine: "Classeur d'exploitation",
              gravite: ctrl.gravite === 'info' ? 'good' : ctrl.gravite,
              titre: ctrl.titre,
              // Un defaut sans montant propre porte null, pas zero : un
              // zero se lirait comme un defaut sans consequence.
              montant: (ctrl.montant === undefined ? null : ctrl.montant),
              effet: ctrl.corps});
  }
  return out;
}

const RANG_GRAVITE = {crit: 0, warn: 1, good: 2};
const MOT_GRAVITE = {crit: 'CRITIQUE', warn: 'VIGILANCE', good: 'POUR MÉMOIRE'};

RENDER['ecarts'] = function(){
  const liste = anomalies()
    .sort((a, b) => (RANG_GRAVITE[a.gravite] - RANG_GRAVITE[b.gravite])
                    || (Math.abs(b.montant || 0) - Math.abs(a.montant || 0)));
  const r = rapprochement();
  const critiques = liste.filter(a => a.gravite === 'crit').length;
  const chiffres = liste.filter(a => a.montant !== null);

  document.getElementById('ec-kpi').innerHTML = [
    tuile({k: 'ÉCARTS RELEVÉS', v: F(liste.length), hero: true,
           cls: critiques ? 'crit' : 'accent',
           d: F(critiques) + ' à trancher avant d\'utiliser un chiffre · '
              + F(liste.length - critiques) + ' à surveiller'}),
    tuile({k: 'ENTRE LES DEUX SOURCES DE CA', v: Fc(r.totalDecl - r.totalPos), u: 'F',
           cls: 'crit',
           d: F1(PCT(r.totalDecl - r.totalPos, r.totalPos)) + ' % du chiffre de caisse'}),
    tuile({k: 'NUITS NON CONCORDANTES',
           v: F(r.jours.length - r.concordantes), u: '/ ' + F(r.jours.length),
           d: F1(PCT(r.jours.length - r.concordantes, r.jours.length))
              + ' % des nuits communes'}),
    tuile({k: 'ÉCARTS CHIFFRÉS', v: F(chiffres.length), u: '/ ' + F(liste.length),
           d: 'les autres sont des défauts de construction, sans montant propre'}),
  ].join('');

  document.getElementById('ec-constat').innerHTML = constat(
    critiques ? 'crit' : 'warn',
    `${nb(liste.length, 'écart relevé', 'écarts relevés')} sur trois sources`,
    `Ce tableau de bord croise la caisse Infogest, le classeur de suivi tenu par
     l'exploitation et le résumé que le logiciel s'annonce à lui-même. Les trois
     ne concordent pas, et cette page dit où.
     <br><br>Aucun de ces écarts n'est corrigé en silence. Là où ce tableau de
     bord retient une source plutôt qu'une autre, il l'écrit et donne le montant
     que ce choix déplace. Un chiffre redressé sans trace est un chiffre que
     plus personne ne peut contredire.
     <br><br><b>Ce qu'il faut en retenir avant de lire les autres pages :</b> les
     volumes, les classements et les tendances sont solides — ils reposent sur
     une source unique et cohérente avec elle-même. C'est le <b>niveau absolu du
     chiffre d'affaires</b> qui dépend de la source retenue, à
     ${F1(Math.abs(PCT(r.totalDecl - r.totalPos, r.totalPos)))} % près.`);

  // --- les trois sections ------------------------------------------------
  const carte = a => {
    const montant = a.montant === null ? ''
      : `<div style="margin:6px 0 8px"><b style="font-size:15px">${F(a.montant)} F</b></div>`;
    return `<div class="note ${a.gravite}" style="margin-bottom:12px">
      <div class="note-title">${pill(MOT_GRAVITE[a.gravite], a.gravite)} ${a.titre}</div>
      ${montant}${a.effet}</div>`;
  };
  const section = (id, origine) => {
    const lignes = liste.filter(a => a.origine === origine);
    document.getElementById(id).innerHTML = lignes.length
      ? lignes.map(carte).join('')
      : '<div class="foot">Aucun écart relevé sur cette source.</div>';
  };
  section('ec-sources', 'Deux sources');
  section('ec-pos', 'Exports de caisse');
  section('ec-classeur', "Classeur d'exploitation");

  // --- le recapitulatif ---------------------------------------------------
  // La gravite est ecrite en toutes lettres dans la ligne : le filtre du
  // tableau porte sur le texte, et « critique » est la premiere chose
  // qu'on lui demande.
  document.getElementById('ec-table').innerHTML = tableHTML(
    [{t: 'Gravité'}, {t: 'Origine'}, {t: 'Écart constaté'}, {t: 'Montant', num: true}],
    liste.map(a => [MOT_GRAVITE[a.gravite].toLowerCase(), a.origine, a.titre,
                    a.montant === null ? '—' : F(a.montant)]));
  rendreFiltrable('ec-table', 'Filtrer : critique, classeur, caisse…');
};


/* =====================================================================
   PAGE — COUT DE REVIENT & MARGE
   ---------------------------------------------------------------------
   Les couts viennent du catalogue de TABOO, transportes sur indication
   de la direction. Trois precautions tiennent cette page debout :

   1. La couverture est une TUILE, pas une note. Elle vaut 46 % du
      chiffre d'affaires. Une marge lue comme celle de l'etablissement
      alors qu'elle ne porte que sur la moitie de ses ventes serait pire
      qu'une absence de marge.

   2. Rien n'est extrapole. Le taux des articles costes n'est jamais
      applique aux autres : rien ne dit que les champagnes sans cout
      marginent comme les bieres avec.

   3. La marge theorique est confrontee a la marge CONSTATEE au
      classeur, qui porte sur 100 % du perimetre. Deux mesures
      independantes du meme phenomene valent mieux qu'une seule, et leur
      ecart est lui-meme une information.
   ===================================================================== */

const CTS = () => DATA.couts || {meta: {}, articles: [], non_apparies: []};

RENDER['couts'] = function(){
  const c = CTS();
  const m = c.meta || {};
  const arts = c.articles || [];

  const ca = arts.reduce((s, x) => s + x.net, 0);
  const cout = arts.reduce((s, x) => s + x.ct, 0);
  const marge = ca - cout;
  const offert = arts.reduce((s, x) => s + x.co, 0);

  /* La marge CONSTATEE : achats matiere du classeur contre chiffre
     d'affaires declare, sur la saison en cours et sur 100 % du
     perimetre. Elle ne vient pas des memes donnees et ne mesure pas
     tout a fait la meme chose -- un achat n'est pas une consommation,
     le stock bouge entre les deux -- mais elle est la seule mesure qui
     couvre l'etablissement entier. */
  const saison = (typeof saisonCourante === 'function') ? saisonCourante() : [];
  const caSaison = saison.reduce((s, x) => s + x.ca, 0);
  const matSaison = saison.reduce((s, x) => s + x.matiere, 0);
  const tauxConstate = caSaison ? PCT(caSaison - matSaison, caSaison) : null;

  /* Trois mesures de la meme chose, de plus en plus proches du reel :

       marge sur les ventes    ce que le vendu aurait du rapporter
       apres cout des offerts  ce qu'il a rapporte, gratuites deduites
       marge constatee         ce que les achats du classeur montrent

     La premiere ignore que l'etablissement achete aussi ce qu'il
     donne. La deuxieme le compte. La troisieme ne vient d'aucune des
     deux et couvre 100 % du perimetre. */
  const margeApresOfferts = ca - cout - offert;

  document.getElementById('ct-kpi').innerHTML = [
    tuile({k: 'MARGE SUR LES VENTES', v: Fc(marge), u: 'F', hero: true,
           cls: 'accent',
           d: F1(PCT(marge, ca)) + ' % de taux · ' + F(arts.length)
              + ' articles costés'}),
    tuile({k: 'PART DU CA COUVERTE', v: F1(100 * (m.couverture || 0)), u: '%',
           cls: (m.couverture || 0) < 0.6 ? 'warn' : '',
           d: F(m.ca_couvert) + ' F sur ' + F(m.ca_total) + ' F'}),
    tuile({k: 'COÛT DE CE QUI EST OFFERT', v: Fc(offert), u: 'F', cls: 'crit',
           d: F1(PCT(offert, ca)) + " % du chiffre couvert, acheté et donné"}),
    tuile({k: 'MARGE APRÈS LES OFFERTS', v: F1(PCT(margeApresOfferts, ca)), u: '%',
           d: tauxConstate === null ? 'classeur mensuel absent'
              : F1(tauxConstate) + ' % constatés au classeur, sur 100 % du périmètre'}),
  ].join('');

  const ecart = tauxConstate === null ? null
                : PCT(margeApresOfferts, ca) - tauxConstate;
  document.getElementById('ct-constat').innerHTML = constat(
    'warn', "Des coûts mesurés ailleurs, et ce qu'ils valent ici",
    `Les exports de caisse d'AMNESIA ne portent <b>aucun prix d'achat</b>. Les
     coûts affichés sur cette page sont ceux relevés chez <b>TABOO</b>, appliqués
     aux articles qu'AMNESIA vend sous le même nom, sur indication de la
     direction : les deux maisons achètent les mêmes produits aux mêmes
     conditions.
     <br><br><b>Ce qui va dans ce sens.</b> Les listes de prix coïncident. Sur les
     articles peu remisés — sodas, bières, chichas — le prix moyen constaté chez
     AMNESIA vaut exactement celui affiché chez TABOO. L'écart n'apparaît que sur
     les bouteilles, où il mesure la remise accordée et non un tarif différent.
     ${ecart === null ? '' : `<br><br><b>Et trois mesures se rejoignent.</b>
       Les articles vendus auraient dû rapporter <b>${F1(PCT(marge, ca))} %</b>.
       Mais l'établissement achète aussi ce qu'il donne : en déduisant le coût
       réel des articles offerts, il reste <b>${F1(PCT(margeApresOfferts, ca))} %</b>.
       Le classeur, lui, mesure <b>${F1(tauxConstate)} %</b> par les achats réels,
       sur 100 % du périmètre et sans partager une seule donnée avec les coûts
       importés. ${F1(Math.abs(ecart))} point${Math.abs(ecart) > 1 ? 's' : ''}
       séparent les deux dernières — un achat n'est pas une consommation, le stock
       bouge entre les deux, et les périodes ne se recouvrent pas tout à fait.
       <br><br>Ce rapprochement dit deux choses : les coûts empruntés à TABOO
       tiennent, et <b>les articles offerts expliquent l'essentiel de l'écart</b>
       entre ce que la carte promet et ce que la caisse encaisse.`}
     <br><br><b>Ce qui reste hors de portée.</b> Le référentiel de TABOO compte
     ${F(m.produits_referentiel)} produits costés, et
     ${F(m.sans_cout)} articles d'AMNESIA n'y figurent pas
     (${F(m.ca_sans_cout)} F) — Baron d'Arignac, Don Julio, Louis Eschenauer, les
     shooters. ${m.rejetes ? `${F(m.rejetes)} autres ont trouvé un nom correspondant
     mais ont été <b>écartés par le contrôle de prix</b> (${F(m.ca_rejete)} F).`
     : ''}
     <br><br><b>Les articles vendus au verre.</b> Un « Hennessy VS » au verre ne
     coûte pas le prix d'une bouteille. La direction indique qu'une bouteille
     donne <b>${F(m.verres_par_bouteille)} verres</b> ; le coût est divisé
     d'autant. Ce nombre n'est relevé nulle part — mais il se vérifie : les
     articles concernés se vendent entre 0,86 et 1,05 fois le douzième du tarif
     bouteille, ce que le contrôle de prix constate sans rien savoir du chiffre.
     La règle est écrite en face de chaque article dans le tableau.`);

  /* --- par famille ---------------------------------------------------- */
  const fam = new Map();
  for(const x of arts){
    const e = fam.get(x.c) || {net: 0, ct: 0};
    e.net += x.net; e.ct += x.ct;
    fam.set(x.c, e);
  }
  const familles = [...fam.entries()]
    .map(([k, v]) => ({k, marge: v.net - v.ct, net: v.net, taux: PCT(v.net - v.ct, v.net)}))
    .sort((a, b) => b.marge - a.marge);

  setChart('c-ct-cat', {type: 'bar',
    data: {labels: familles.map(x => x.k), datasets: [
      Object.assign({}, STACK, {label: 'Coût de revient',
        data: familles.map(x => fam.get(x.k).ct), backgroundColor: C.cat[1]}),
      Object.assign({}, STACK, {label: 'Marge',
        data: familles.map(x => x.marge), backgroundColor: C.cat[0]}),
    ]},
    options: {interaction: {mode: 'index', intersect: false},
      plugins: {legend: legendTop(true), tooltip: Object.assign({}, TOOLTIP, {
        callbacks: {label: c2 => ' ' + c2.dataset.label + ' : ' + FCFA(c2.parsed.y),
          footer: items => {
            const x = familles[items[0].dataIndex];
            return 'Taux de marge : ' + F1(x.taux) + ' %';
          }}})},
      // Empilees, marge et cout font le chiffre d'affaires : la hauteur
      // de la barre est ce que la famille a rapporte, et la couleur dit
      // ce qui en reste. L'etiquette de sommet porte le taux.
      // Une vingtaine de familles : a plat, Chart.js en masque une sur
      // deux pour les faire tenir, et on ne sait plus quelle barre porte
      // quel nom. Inclinees, elles tiennent toutes.
      scales: {y: Object.assign(axisY(), {stacked: true}),
               x: Object.assign(axisX({ticks: {color: C.faint, font: {size: 9.5},
                                               maxRotation: 60, minRotation: 60,
                                               autoSkip: false}}),
                                {stacked: true})}},
    plugins: [etiquetteSommet(familles.map(x => x.taux), v => F1(v) + ' %')]});

  document.getElementById('ct-cat-t').innerHTML = tableHTML(
    [{t: 'Famille'}, {t: "Chiffre d'affaires", num: true}, {t: 'Coût de revient', num: true},
     {t: 'Marge', num: true}, {t: 'Taux', num: true}],
    familles.map(x => [x.k, F(x.net), F(fam.get(x.k).ct), F(x.marge),
                       F1(x.taux) + ' %']));

  /* --- les dix qui rapportent ----------------------------------------- */
  const top = [...arts].sort((a, b) => (b.net - b.ct) - (a.net - a.ct)).slice(0, 10);
  barHorizontale('c-ct-top', top.map(x => x.a), top.map(x => x.net - x.ct),
                 C.cat[0]);

  /* --- taux des dix plus gros vendeurs --------------------------------
     Classes par CA et non par taux : un article a 90 % de marge qui pese
     trois ventes n'apprend rien, et se placerait en tete. */
  // barHorizontale ecrit d'office la part de chaque barre dans le total
  // affiche. Sur des TAUX, cette part serait la fraction d'une somme de
  // pourcentages, c'est-a-dire rien. On dessine donc a la main, et on
  // ecrit le taux lui-meme au bout de la barre.
  const gros = [...arts].slice(0, 10);
  setChart('c-ct-taux', {type: 'bar',
    data: {labels: gros.map(x => x.a), datasets: [Object.assign({}, BAR, {
      label: 'Taux de marge', data: gros.map(x => PCT(x.net - x.ct, x.net)),
      backgroundColor: C.cat[3], borderSkipped: 'start'})]},
    options: {indexAxis: 'y', layout: {padding: {right: 46}},
      plugins: {legend: {display: false}, tooltip: Object.assign({}, TOOLTIP, {
        callbacks: {label: c2 => ' ' + F1(c2.parsed.x) + ' % de marge',
          footer: items => {
            const x = gros[items[0].dataIndex];
            return FCFA(x.net) + ' de chiffre — ' + FCFA(x.net - x.ct) + ' de marge';
          }}})},
      scales: {x: Object.assign(axisY(v => F1(v) + ' %'),
                                {grid: {color: C.grid, drawTicks: false}}),
               y: {grid: {display: false}, border: {color: C.axis},
                   ticks: {color: C.dim, font: {size: 11}, autoSkip: false}}}},
    plugins: [etiquettesPlugin(v => F1(v) + ' %', 'y')]});

  /* --- le detail -------------------------------------------------------- */
  document.getElementById('ct-table').innerHTML = tableHTML(
    [{t: 'Article'}, {t: 'Famille'}, {t: 'Vendus', num: true},
     {t: "Chiffre d'affaires", num: true}, {t: 'Coût unitaire', num: true},
     {t: 'Coût total', num: true}, {t: 'Marge', num: true}, {t: 'Taux', num: true},
     {t: 'Offerts', num: true}, {t: 'Coût des offerts', num: true},
     {t: 'Coût repris de'}, {t: 'Règle'}],
    arts.map(x => [x.a, x.c, F(x.q), F(x.net), F(x.cr), F(x.ct), F(x.net - x.ct),
                   F1(PCT(x.net - x.ct, x.net)) + ' %', F(x.qo), F(x.co),
                   x.correspondance, x.regle]));
  rendreFiltrable('ct-table', 'Filtrer : CHAMPAGNES, HENNESSY, BIERES…');

};

/* =====================================================================
   PAGE — COUVERTURE DES COUTS
   ---------------------------------------------------------------------
   La methode, separee de son resultat. La page precedente donne des
   marges ; celle-ci dit sur quelle part du chiffre elles portent, d'ou
   viennent les prix, et lesquels manquent encore.

   Les deux se lisent par des gens differents : la marge interesse la
   direction, la couverture interesse celui qui va chercher les prix
   manquants. Les garder ensemble faisait finir la liste de courses en
   bas d'un ecran de sept blocs.
   ===================================================================== */

RENDER['couverture'] = function(){
  const c = CTS();
  const m = c.meta || {};
  const arts = c.articles || [];
  const couvert = m.ca_couvert || 0;
  const total = m.ca_total || 0;
  const manquant = Math.max(0, total - couvert);

  document.getElementById('cv-kpi').innerHTML = [
    tuile({k: 'PART DU CA COUVERTE', v: F1(100 * (m.couverture || 0)), u: '%',
           hero: true, cls: (m.couverture || 0) < 0.6 ? 'warn' : 'accent',
           part: {v: couvert, total: total || 1, c: 'var(--accent)'},
           d: F(couvert) + ' F sur ' + F(total) + ' F de chiffre'}),
    tuile({k: 'ARTICLES COSTÉS', v: F(arts.length),
           part: {v: arts.length, total: arts.length + (m.sans_cout || 0),
                  c: 'var(--accent)'},
           d: 'sur ' + F(arts.length + (m.sans_cout || 0)) + ' articles vendus'}),
    tuile({k: "PRIX D'ACHAT MANQUANTS", v: F(m.sans_cout || 0), cls: 'warn',
           part: {v: manquant, total: total || 1, c: 'var(--st-warn)'},
           d: F(m.ca_sans_cout || 0) + ' F, soit '
              + F1(PCT(m.ca_sans_cout || 0, total)) + ' % du chiffre'}),
    tuile({k: 'ÉCARTÉS PAR LE CONTRÔLE', v: F(m.rejetes || 0), cls: 'crit',
           d: (m.rejetes
               ? F(m.ca_rejete || 0) + ' F — un nom correspondait, le prix disait'
                 + ' le contraire'
               : 'aucun rapprochement écarté')}),
  ].join('');

  /* Le titre suit le chiffre. « Ne porte QUE sur 90,5 % » serait une
     alarme sur une couverture qui n'en est pas une ; « ne porte que sur
     46 % » en etait une. Le meme gabarit de phrase pour les deux ferait
     mentir l'un des deux cas. */
  const couv = 100 * (m.couverture || 0);
  document.getElementById('cv-constat').innerHTML = constat(
    couv < 60 ? 'crit' : (couv < 85 ? 'warn' : 'good'),
    couv < 85
      ? `La marge ne porte que sur ${F1(couv)} % du chiffre`
      : `La marge porte sur ${F1(couv)} % du chiffre — et pas sur le reste`,
    `Tout ce qui se lit sur la page
     <a href="#" onclick="go('couts');return false;"><b>Coût de revient &amp;
     marge</b></a> est calculé sur <b>${F(couvert)} F</b> de chiffre d'affaires,
     pas sur ${F(total)} F. Les ${F(m.sans_cout || 0)} articles restants ne sont
     pas à marge nulle : ils sont hors de portée, faute de prix d'achat.
     <br><br>Un taux de marge cité sans cette réserve se lirait comme celui de
     l'établissement entier. Il ne l'est pas — et la seule mesure qui couvre
     100 % du périmètre est celle du classeur d'exploitation, sur la page
     <a href="#" onclick="go('resultat');return false;"><b>Compte de
     résultat</b></a>.
     <br><br>La liste ci-dessous est classée du plus lourd au plus léger : elle
     dit lesquels réclamer d'abord, et où s'arrêter.`);

  document.getElementById('cv-compo').innerHTML = barreComposition([
    {l: 'Coût connu', v: couvert, c: C.cat[0]},
    {l: "Sans prix d'achat", v: m.ca_sans_cout || 0, c: C.warn},
    {l: 'Écarté par le contrôle de prix', v: m.ca_rejete || 0, c: C.crit},
  ]);

  /* --- comment chaque cout a ete rapproche -------------------------------
     La regle est ecrite a cote de chaque article dans le tableau de la
     page precedente ; ici on donne le compte, pour qu'on puisse juger du
     poids de chacune sans les compter a la main. */
  const regles = m.regles || [];
  document.getElementById('ct-regles').innerHTML =
    tableHTML([{t: 'Règle'}, {t: 'Articles', num: true},
               {t: "Chiffre d'affaires", num: true}, {t: 'Couverture atteinte', num: true}],
      (() => {
        let cumul = 0;
        return regles.map(r => {
          cumul += r.ca;
          return [r.regle, F(r.n), F(r.ca), F1(PCT(cumul, m.ca_total)) + ' %'];
        });
      })())
    + `<div class="foot" style="margin-top:12px">
        « Nom identique » compare les noms une fois les accents, les esperluettes
        et les suffixes de conditionnement normalisés. « Variante par défaut »
        rapproche un champagne nommé sans qualificatif de son brut, et seulement
        s'il n'existe qu'un seul candidat. « Préfixe unique » rapproche un nom au
        seul produit costé qui le prolonge ; s'il y en a deux, la règle se tait.
        « Nom entre parenthèses » rapproche un article de l'unique produit costé
        qui le contient comme mot entier — « OLMECA » dans « TEQUILA (OLMECA) ».
        « Famille au coût uniforme » n'intervient que là où le référentiel coste
        identiquement tous les produits d'une famille : les sept chichas de TABOO
        valent le même montant quelle que soit leur saveur, le coût ne dépend pas
        du parfum. La règle exige l'unanimité et au moins trois produits.
        « Vendu au verre » s'applique quand le prix révèle que l'unité de vente
        n'est pas la bouteille : le coût est alors divisé par
        ${F(m.verres_par_bouteille)}, nombre de verres par bouteille indiqué par
        la direction.
        <br><br>Chaque rapprochement est ensuite vérifié sur le prix : si le prix
        pratiqué par AMNESIA s'écarte de plus de moitié de celui affiché par
        TABOO — pour l'unité retenue — ce n'est pas le même produit et le coût
        n'est pas appliqué.
       </div>`;

  /* --- la liste de ce qu'il faut demander ---------------------------------
     Constater un trou ne sert a rien ; le combler, si. Cette carte n'est
     donc pas un inventaire des absents mais une liste de COURSES, du
     plus rentable au moins rentable, avec la couverture que chaque prix
     obtenu fait gagner. On sait ou s'arreter. */
  const abs = c.non_apparies || [];
  const rej = c.rejetes || [];
  const seuils = c.seuils || [];

  document.getElementById('ct-absents').innerHTML =
    `<div style="margin-bottom:14px">
       <b>${F(m.sans_cout)} articles</b> vendus par AMNESIA n'ont aucun prix
       d'achat, ni dans le référentiel de TABOO ni dans aucune autre source
       disponible — ${F(m.ca_sans_cout)} F de chiffre d'affaires, soit
       ${F1(PCT(m.ca_sans_cout, m.ca_total))} %. Ils ne s'obtiennent que d'une
       facture fournisseur.
     </div>`
    + (seuils.length ? `<div style="margin-bottom:14px">` + seuils.map(s =>
        `<span class="pill">${F(s.n)} prix → ${F1(100 * s.cible)} %</span> `
      ).join('') + `</div>
      <div class="foot" style="margin-bottom:14px">
        Les articles sont classés du plus lourd au plus léger : dix prix
        d'achat suffisent à passer de ${F1(100 * (m.couverture || 0))} % à 95 %
        de couverture. Les suivants rapportent de moins en moins.
      </div>` : '')
    + tableHTML(
      [{t: 'À demander'}, {t: 'Famille'}, {t: 'Vendus', num: true},
       {t: "Chiffre d'affaires", num: true}, {t: '% du CA', num: true},
       {t: 'Couverture atteinte', num: true}],
      abs.map(x => [x.a, x.c, F(x.q), F(x.net),
                    F1(PCT(x.net, m.ca_total)) + ' %',
                    F1(100 * (x.cumul || 0)) + ' %']))
    + (rej.length ? `<div style="margin-top:26px;margin-bottom:8px">
         <b>${F(rej.length)} articles écartés par le contrôle de prix</b></div>
       <div style="margin-bottom:12px">
         Un nom correspondait, le prix disait le contraire, et l'hypothèse du
         verre ne les rattrape pas non plus. ${F(m.ca_rejete)} F de chiffre
         d'affaires, sans coût plutôt qu'avec un faux.
       </div>`
       + tableHTML(
         [{t: 'Article vendu'}, {t: 'Correspondance écartée'},
          {t: 'Prix AMNESIA', num: true}, {t: 'Prix TABOO', num: true},
          {t: "Chiffre d'affaires", num: true}],
         rej.map(x => [x.a, x.correspondance, F(x.pv_amnesia), F(x.pv_taboo),
                       F(x.net)])) : '');
  rendreFiltrable('ct-absents', 'Filtrer : VINS, TEQUILA, SHOOTERS…');
};
