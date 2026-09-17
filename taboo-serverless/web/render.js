/* =====================================================================
   TABOO — logique de rendu des pages
   ---------------------------------------------------------------------
   Une fonction par page dans RENDER. Toutes recalculent leurs totaux a
   partir des lignes filtrees : aucun ratio n'est lu tel quel depuis les
   donnees, il est toujours recalcule en somme(a)/somme(b) sur la periode
   affichee. C'est ce qui garantit qu'un taux reste juste quel que soit
   le filtre.
   ===================================================================== */

/* ---------- fabriques de fragments reutilisables ---------- */
function tuile(o){
  return `<div class="stat ${o.cls||''}${o.hero?' hero':''}">
    <div class="k">${o.k}</div>
    <div class="v">${o.v}${o.u?`<span class="u">${o.u}</span>`:''}</div>
    ${o.d?`<div class="d">${o.d}</div>`:''}</div>`;
}
function pill(txt, cls){ return `<span class="pill ${cls||''}"><i></i>${txt}</span>`; }
function barCell(part, couleur){
  const w = Math.max(0, Math.min(100, part));
  return `<div class="bar"><i style="width:${w}%;background:${couleur}"></i></div>`;
}
/* Plage de reference (norme metier) dessinee en fond d'un graphique.
   Un rectangle discret vaut mieux qu'une legende a lire ailleurs. */
const bandePlugin = (min,max,label) => ({
  id:'bande'+min+max,
  beforeDatasetsDraw(ch){
    const {ctx, chartArea:a, scales} = ch;
    const sc = scales.y || scales.x;
    if(!sc) return;
    const y1 = sc.getPixelForValue(max), y2 = sc.getPixelForValue(min);
    ctx.save();
    ctx.fillStyle = 'rgba(242,237,225,.055)';
    ctx.fillRect(a.left, y1, a.right-a.left, y2-y1);
    ctx.strokeStyle = 'rgba(242,237,225,.16)';
    ctx.setLineDash([3,3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a.left,y1); ctx.lineTo(a.right,y1);
    ctx.moveTo(a.left,y2); ctx.lineTo(a.right,y2); ctx.stroke();
    ctx.setLineDash([]);
    if(label){
      ctx.fillStyle = 'rgba(242,237,225,.42)';
      ctx.font = "10.5px 'Inter',sans-serif"; ctx.textAlign = 'right';
      ctx.fillText(label, a.right-6, y1-4);
    }
    ctx.restore();
  }
});
/* Etiquettes de valeur directement sur les barres : evite d'obliger le
   lecteur a estimer une hauteur contre une graduation. Applique
   selectivement (jamais sur chaque point d'une courbe). */
const etiquettesPlugin = (fmt, axe, alterner) => ({
  id:'etiq'+Math.random().toString(36).slice(2,7),
  afterDatasetsDraw(ch){
    const ctx = ch.ctx; ctx.save();
    ctx.font = (alterner?"600 10px":"600 11px")+" 'Inter',sans-serif"; ctx.fillStyle = C.ink;
    ch.data.datasets.forEach((ds,di)=>{
      if(ds.hidden) return;
      const meta = ch.getDatasetMeta(di);
      if(meta.hidden) return;
      meta.data.forEach((el,i)=>{
        const raw = ds.data[i];
        const v = Array.isArray(raw) ? raw[1]-raw[0] : raw;
        if(v===null||v===undefined||v===0) return;
        if(axe==='y'){ ctx.textAlign='left'; ctx.textBaseline='middle';
          ctx.fillText(fmt(v), el.x+7, el.y);
        }else{ ctx.textAlign='center'; ctx.textBaseline='bottom';
          // decalage alterne : sur une cascade, les barres sont assez
          // proches pour que deux etiquettes voisines se chevauchent.
          const dy = alterner && (i % 2) ? -17 : -5;
          ctx.fillText(fmt(v), el.x, el.y+dy); }
      });
    });
    ctx.restore();
  }
});

/* ---------- agregats reutilises par plusieurs pages ---------- */
const KEYS_RES = ['cb','rm','cn','qv','qo','ae','op','cx','mb','re','rn'];
function resPeriode(){ return inRange(DATA.resultat_jour, state.start, state.end); }
function totauxRes(){ return sums(resPeriode(), KEYS_RES); }
function parMois(rows, keys){
  const m = groupBy(rows, r=>moisKey(r.d), keys);
  const ks = [...m.keys()].sort();
  return {ks, lab:ks.map(k=>{
    const d = k+'-01'; return MOIS[dOf(d).getMonth()]+' '+k.slice(2,4);
  }), get:k=>m.get(k)};
}
function libellePeriode(){
  return dateLabel(state.start)+' → '+dateLabel(state.end);
}

/* =====================================================================
   PAGE 1 — SYNTHESE
   ===================================================================== */
RENDER['synthese'] = function(){
  const rows = resPeriode(), t = totauxRes();
  const off = inRange(DATA.offerts_jour, state.start, state.end);
  const valOfferte = sum(off,'v');
  const nJours = new Set(rows.map(r=>r.d)).size;

  document.getElementById('sy-kpi').innerHTML = [
    tuile({k:"CHIFFRE D'AFFAIRES NET", v:Fc(t.cn), u:'F', hero:true, cls:'accent',
           d:`${F(t.cn)} F exactement<br>après ${F(t.rm)} F de remises · ${F(nJours)} nuits`}),
    tuile({k:'MARGE BRUTE', v:Fc(t.mb), u:'F', hero:true,
           d:`${F(t.mb)} F · <strong>${P1(t.mb,t.cn)}</strong> du CA net<br>après achats de marchandises`}),
    tuile({k:"RÉSULTAT D'EXPLOITATION", v:Fc(t.re), u:'F', hero:true,
           d:`${F(t.re)} F · <strong>${P1(t.re,t.cn)}</strong> du CA net<br>après charges d'exploitation`}),
    tuile({k:'RÉSULTAT NET', v:Fc(t.rn), u:'F', hero:true,
           cls:t.rn>0?'good':'crit',
           d:`${F(t.rn)} F · <strong>${P1(t.rn,t.cn)}</strong> du CA net<br>après investissements`}),
  ].join('');

  /* --- les trois constats qui doivent sauter aux yeux --- */
  const eat = sums(rows.filter(r=>r.a==='EAT'), ['cn','ae','mb']);
  const regl = DATA.reglements, totRegl = sum(regl,'montant');
  const especes = (regl.find(r=>r.libelle==='ESPECES')||{}).montant||0;
  const credit = (regl.find(r=>r.libelle==='Crédit')||{}).montant||0;
  const crAct = {}; for(const c of DATA.couts_articles){
    crAct[c.t] = crAct[c.t] || {cn:0,mt:0}; crAct[c.t].cn += c.cn; crAct[c.t].mt += c.mt;
  }
  const theoEat = crAct.EAT ? PCT(crAct.EAT.mt, crAct.EAT.cn) : null;
  const reelEat = PCT(eat.mb, eat.cn);

  let al = '<div class="grid g3" style="margin-bottom:20px;">';
  al += `<div class="note crit" style="margin:0;">
    <div class="note-title">${pill('CRITIQUE','crit')} Le coût matière de la cuisine</div>
    L'activité <strong>EAT</strong> dégage <strong>${F1(reelEat)} %</strong> de marge brute :
    ${F1(PCT(eat.ae,eat.cn))} % du CA part en achats, contre une norme de 25 à 35 % en
    restauration.${theoEat!==null?` Les coûts de recette, eux, impliquent
    <strong>${F1(theoEat)} %</strong> de marge — un écart de
    <strong>${F1(theoEat-reelEat)} points</strong> à expliquer.`:''}
    <span style="color:var(--ink-faint)">Voir « Coût de revient ».</span></div>`;
  al += `<div class="note warn" style="margin:0;">
    <div class="note-title">${pill('VIGILANCE','warn')} L'effort commercial</div>
    Remises <strong>${F(t.rm)} F</strong> et articles offerts <strong>${F(valOfferte)} F</strong>,
    soit <strong>${F1(PCT(t.rm+valOfferte, t.cb+valOfferte))} %</strong> du chiffre d'affaires
    potentiel. Les offerts pèsent à eux seuls
    ${F1(PCT(valOfferte, t.rm+valOfferte))} % de cet effort.
    <span style="color:var(--ink-faint)">Voir « Remises & offerts ».</span></div>`;
  al += `<div class="note warn" style="margin:0;">
    <div class="note-title">${pill('VIGILANCE','warn')} La dépendance aux espèces</div>
    <strong>${F1(PCT(especes,totRegl))} %</strong> des encaissements se font en espèces,
    contre ${F1(PCT(totRegl-especes-credit,totRegl))} % par les autres moyens.
    S'y ajoutent <strong>${F(credit)} F</strong> de ventes à crédit.
    <span style="color:var(--ink-faint)">Voir « Règlements & créances ».</span></div>`;
  al += '</div>';
  document.getElementById('sy-alertes').innerHTML = al;

  /* --- cascade en barres flottantes --- */
  const etapes = [
    ['CA brut',        0, t.cb,             'tot'],
    ['Remises',        t.cb-t.rm, t.cb,     'neg'],
    ['CA net',         0, t.cn,             'tot'],
    ['Achats',         t.cn-t.ae, t.cn,     'neg'],
    ['Marge brute',    0, t.mb,             'tot'],
    ['Charges',        t.mb-t.op, t.mb,     'neg'],
    ["Rés. exploit.",  0, t.re,             'tot'],
    ['Investis.',      t.re-t.cx, t.re,     'neg'],
    ['Résultat net',   0, t.rn,             'fin'],
  ];
  const COUL = {tot:'#2C8598', neg:C.serious, fin:C.compare};
  setChart('c-sy-casc', {
    type:'bar',
    data:{labels:etapes.map(e=>e[0]), datasets:[Object.assign({},BAR,{
      label:'Montant', data:etapes.map(e=>[e[1],e[2]]),
      backgroundColor:etapes.map(e=>COUL[e[3]]), maxBarThickness:52,
    })]},
    options:{
      plugins:{legend:{display:false}, tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>{const d=c.raw; return ' '+FCFA(Math.abs(d[1]-d[0]));}}})},
      scales:{y:axisY(), x:axisX({ticks:{color:C.dim, maxRotation:35, minRotation:0, font:{size:10.5}}})}},
    plugins:[etiquettesPlugin(v=>Fc(Math.abs(v)), 'x', true)]
  });
  document.getElementById('sy-casc-t').innerHTML = tableHTML(
    [{t:'Étape'},{t:'Montant (F)',num:true},{t:'% du CA net',num:true}],
    etapes.map(e=>[e[0], F(Math.abs(e[2]-e[1])), P1(Math.abs(e[2]-e[1]), t.cn)]));

  /* --- taux de marge par activite --- */
  const parAct = ACT.map(a=>{
    const s = sums(rows.filter(r=>r.a===a), ['cn','ae','mb']);
    return {a, taux:PCT(s.mb,s.cn), cout:PCT(s.ae,s.cn), cn:s.cn, mb:s.mb};
  });
  setChart('c-sy-marge', {type:'bar',
    data:{labels:ACT, datasets:[Object.assign({},BAR,{
      label:'Taux de marge brute', data:parAct.map(x=>x.taux),
      backgroundColor:ACT.map(a=>C[a]), maxBarThickness:64})]},
    options:{plugins:{legend:{display:false},
      tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>[' Marge brute : '+F1(c.parsed.y)+' %',
                  ' Coût matière : '+F1(parAct[c.dataIndex].cout)+' %',
                  ' Marge en francs : '+FCFA(parAct[c.dataIndex].mb)]}})},
      scales:{y:Object.assign(axisY(v=>F(v)+' %'),{min:0,max:100}), x:axisX({ticks:{color:C.dim}})}},
    plugins:[bandePlugin(65,75,'norme resto (EAT)'),
             etiquettesPlugin(v=>F1(v)+' %')]});

  /* --- evolution mensuelle : montant et taux SEPARES --- */
  lineParActivite('c-sy-evol', rows, 'cn');
  const pm = parMois(rows, ['cn','mb']);
  document.getElementById('sy-evol-t').innerHTML = tableHTML(
    [{t:'Mois'},{t:'DRINK',num:true},{t:'EAT',num:true},{t:'SMOKE',num:true},{t:'Total',num:true}],
    pm.ks.map(k=>{
      const l = rows.filter(r=>moisKey(r.d)===k);
      const g = a=>sum(l.filter(r=>r.a===a),'cn');
      return [MOIS[dOf(k+'-01').getMonth()]+' '+k.slice(0,4),
              F(g('DRINK')),F(g('EAT')),F(g('SMOKE')),F(sum(l,'cn'))];
    }));

  setChart('c-sy-taux', {type:'line',
    data:{labels:pm.lab, datasets:[Object.assign({},LINE,{
      label:'Taux de marge brute', data:pm.ks.map(k=>PCT(pm.get(k).mb, pm.get(k).cn)),
      borderColor:C.accentMark, backgroundColor:'rgba(15,163,191,.16)',
      pointBackgroundColor:C.accentMark, fill:true})]},
    options:{interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false},
        tooltip:Object.assign({},TOOLTIP,{callbacks:{label:c=>' '+F1(c.parsed.y)+' % de marge brute'}})},
      scales:{y:axisY(v=>F(v)+' %'), x:axisX()}}});

  /* --- parts et contributions --- */
  setChart('c-sy-part', {type:'doughnut',
    data:{labels:ACT, datasets:[{data:parAct.map(x=>x.cn),
      backgroundColor:ACT.map(a=>C[a]), borderWidth:2, borderColor:C.surface}]},
    options:{cutout:'56%', plugins:{
      legend:{position:'right', labels:{color:C.dim, boxWidth:9, boxHeight:9,
        usePointStyle:true, pointStyle:'rectRounded', padding:11}},
      tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>' '+c.label+' : '+FCFA(c.parsed)+' ('+F1(PCT(c.parsed,t.cn))+' %)'}})}}});

  barHorizontale('c-sy-contrib', ACT, parAct.map(x=>x.mb), ACT.map(a=>C[a]));

  const reglTri = [...DATA.reglements].filter(r=>r.montant>0).sort((a,b)=>b.montant-a.montant);
  barHorizontale('c-sy-regl', reglTri.map(r=>r.libelle), reglTri.map(r=>r.montant),
                 reglTri.map(r=>r.libelle==='Crédit'?C.serious:C.seq[4]));

  /* --- part de la nuit, recalculee sur la periode --- */
  const h = inRange(DATA.horaire_jour, state.start, state.end);
  const totH = sum(h,'cn');
  const nuit = sum(h.filter(r=>r.h>=22||r.h<6),'cn');
  document.getElementById('sy-part-nuit').textContent = F1(PCT(nuit,totH))+' %';
};

/* =====================================================================
   PAGE 2 — COMPTE DE RESULTAT
   ===================================================================== */
RENDER['resultat'] = function(){
  const rows = resPeriode(), t = totauxRes();

  document.getElementById('re-kpi').innerHTML = [
    tuile({k:'CA NET', v:Fc(t.cn), u:'F', d:F(t.cn)+' F exactement'}),
    tuile({k:'MARGE BRUTE', v:P1(t.mb,t.cn), d:F(t.mb)+' F'}),
    tuile({k:"TAUX DE RENTABILITÉ D'EXPLOITATION", v:P1(t.re,t.cn), d:F(t.re)+' F'}),
    tuile({k:'RÉSULTAT NET', v:P1(t.rn,t.cn), cls:'accent', d:F(t.rn)+' F'}),
  ].join('');

  const lignes = [
    ["Chiffre d'affaires brut", t.cb, 'tot'],
    ['Remises accordées', -t.rm, 'neg'],
    ["Chiffre d'affaires net", t.cn, 'tot'],
    ['Achats externes de marchandises', -t.ae, 'neg'],
    ['Marge brute', t.mb, 'tot'],
    ["Charges d'exploitation", -t.op, 'neg'],
    ["Résultat d'exploitation", t.re, 'tot'],
    ['Investissements traités en charge', -t.cx, 'neg'],
    ['Résultat net', t.rn, 'fin'],
  ];
  document.getElementById('re-casc').innerHTML = lignes.map(([l,v,k])=>
    `<div class="r ${k==='neg'?'neg':''} ${k==='tot'||k==='fin'?'tot':''}">
      <div class="lbl">${l}</div>
      <div class="amt">${v<0?'−':''}${F(Math.abs(v))}</div>
      <div class="pc">${F1(PCT(Math.abs(v),t.cn))} %</div></div>`).join('');
  document.getElementById('re-casc-foot').innerHTML =
    `Période : ${libellePeriode()}. Montants en francs CFA.
     Les investissements sont traités en charge de l'exercice, comme convenu avec
     l'établissement : le résultat net affiché est donc un résultat après investissement,
     plus prudent qu'un résultat comptable classique.`;

  /* --- structure du CA net --- */
  const parts = [
    ['Achats de marchandises', t.ae, C.serious],
    ["Charges d'exploitation", t.op, C.warn],
    ['Investissements', t.cx, C.seq[6]],
    ['Résultat net', t.rn, C.good],
  ].filter(p=>p[1]>0);
  setChart('c-re-struct', {type:'doughnut',
    data:{labels:parts.map(p=>p[0]), datasets:[{data:parts.map(p=>p[1]),
      backgroundColor:parts.map(p=>p[2]), borderWidth:2, borderColor:C.surface}]},
    options:{cutout:'52%', plugins:{
      legend:{position:'bottom', labels:{color:C.dim, boxWidth:9, boxHeight:9,
        usePointStyle:true, pointStyle:'rectRounded', padding:10, font:{size:11}}},
      tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>' '+c.label+' : '+FCFA(c.parsed)+' ('+F1(PCT(c.parsed,t.cn))+' % du CA net)'}})}}});

  /* --- composition mensuelle empilee --- */
  const pm = parMois(rows, ['cn','ae','op','cx','rn']);
  setChart('c-re-mens', {type:'bar',
    data:{labels:pm.lab, datasets:[
      {...STACK, label:'Achats de marchandises', data:pm.ks.map(k=>pm.get(k).ae), backgroundColor:C.serious},
      {...STACK, label:"Charges d'exploitation", data:pm.ks.map(k=>pm.get(k).op), backgroundColor:C.warn},
      {...STACK, label:'Investissements', data:pm.ks.map(k=>pm.get(k).cx), backgroundColor:C.seq[6]},
      {...STACK, label:'Résultat net', data:pm.ks.map(k=>pm.get(k).rn), backgroundColor:C.good},
    ]},
    options:{interaction:{mode:'index',intersect:false},
      plugins:{legend:legendTop(true), tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>' '+c.dataset.label+' : '+FCFA(c.parsed.y),
        footer:items=>{const k=pm.ks[items[0].dataIndex];
          return 'CA net du mois : '+FCFA(pm.get(k).cn);}}})},
      scales:{x:Object.assign(axisX(),{stacked:true}),
              y:Object.assign(axisY(),{stacked:true})}}});
  document.getElementById('re-mens-t').innerHTML = tableHTML(
    [{t:'Mois'},{t:'CA net',num:true},{t:'Achats',num:true},{t:'Charges',num:true},
     {t:'Investis.',num:true},{t:'Résultat net',num:true},{t:'% du CA',num:true}],
    pm.ks.map(k=>{const g=pm.get(k);
      return [MOIS[dOf(k+'-01').getMonth()]+' '+k.slice(0,4), F(g.cn), F(g.ae),
              F(g.op), F(g.cx), F(g.rn), P1(g.rn,g.cn)];}));

  setChart('c-re-rn', {type:'bar',
    data:{labels:pm.lab, datasets:[Object.assign({},BAR,{
      label:'Résultat net', data:pm.ks.map(k=>pm.get(k).rn),
      backgroundColor:pm.ks.map(k=>pm.get(k).rn>=0?C.good:C.crit)})]},
    options:{plugins:{legend:{display:false},
      tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>{const k=pm.ks[c.dataIndex];
          return [' Résultat net : '+FCFA(c.parsed.y),
                  ' soit '+P1(pm.get(k).rn, pm.get(k).cn)+' du CA net'];}}})},
      scales:{y:axisY(), x:axisX()}}});

  /* --- par activite --- */
  const lignesAct = ACT.map(a=>{
    const s = sums(rows.filter(r=>r.a===a), KEYS_RES);
    return [pill(a, a.toLowerCase()), F(s.cn), F(s.ae), F(s.mb), P1(s.mb,s.cn),
            F(s.op), F(s.re), F(s.rn), P1(s.rn,s.cn)];
  });
  document.getElementById('re-act').innerHTML = tableHTML(
    [{t:'Activité'},{t:'CA net',num:true},{t:'Achats',num:true},{t:'Marge brute',num:true},
     {t:'Taux',num:true},{t:'Charges',num:true},{t:'Rés. expl.',num:true},
     {t:'Rés. net',num:true},{t:'Taux net',num:true}],
    lignesAct.concat([['<strong>Total</strong>', '<strong>'+F(t.cn)+'</strong>', F(t.ae),
      '<strong>'+F(t.mb)+'</strong>', '<strong>'+P1(t.mb,t.cn)+'</strong>', F(t.op),
      F(t.re), '<strong>'+F(t.rn)+'</strong>', '<strong>'+P1(t.rn,t.cn)+'</strong>']]));
};

/* =====================================================================
   PAGE 3 — VENTES & LOCOMOTIVES
   ===================================================================== */
let veTri = {col:'cn', desc:true};
RENDER['ventes'] = function(){
  const rows = resPeriode(), t = totauxRes();
  const vc = inRange(DATA.ventes_categorie_jour, state.start, state.end);
  const arts = DATA.articles;
  const totArtCn = sum(arts,'cn');

  document.getElementById('ve-kpi').innerHTML = [
    tuile({k:'CA NET', v:Fc(t.cn), u:'F', d:F(t.cn)+' F'}),
    tuile({k:'ARTICLES VENDUS', v:F(t.qv), u:'unités',
           d:F(t.qo)+' offerts en plus'}),
    tuile({k:'PRIX MOYEN PAR ARTICLE', v:F(t.cn/(t.qv||1)), u:'F',
           d:'CA net ÷ quantité vendue'}),
    tuile({k:'CONCENTRATION', v:F(DATA.pareto.n_articles_80pct), u:'articles',
           cls:'warn',
           d:`font 80 % du CA, sur ${F(DATA.pareto.n_articles_total)} référencés`}),
  ].join('');

  /* --- courbe de concentration (Pareto sans double axe) --- */
  const tri = [...arts].sort((a,b)=>b.cn-a.cn);
  let cum = 0;
  const pts = tri.map((a,i)=>{ cum += a.cn; return {x:100*(i+1)/tri.length, y:100*cum/totArtCn}; });
  setChart('c-ve-pareto', {type:'line',
    data:{datasets:[
      Object.assign({},LINE,{label:'Part cumulée du CA', data:pts,
        borderColor:C.accentMark, backgroundColor:'rgba(15,163,191,.16)', fill:true}),
      Object.assign({},LINE,{label:'Répartition parfaitement égale',
        data:[{x:0,y:0},{x:100,y:100}], borderColor:C.faint, borderDash:[5,4],
        borderWidth:1.5, fill:false, pointRadius:0}),
    ]},
    options:{parsing:false, interaction:{mode:'nearest',axis:'x',intersect:false},
      plugins:{legend:legendTop(true), tooltip:Object.assign({},TOOLTIP,{callbacks:{
        title:items=>'Les '+Math.round(items[0].parsed.x*tri.length/100)+' premiers articles',
        label:c=>' '+F1(c.parsed.y)+' % du CA net'}})},
      scales:{x:{type:'linear', min:0, max:100, grid:{display:false},
                 border:{color:C.axis},
                 title:{display:true, text:'Part des articles', color:C.faint, font:{size:11}},
                 ticks:{color:C.faint, callback:v=>v+' %'}},
              y:Object.assign(axisY(v=>v+' %'),{min:0,max:100,
                 title:{display:true, text:'Part cumulée du CA net', color:C.faint, font:{size:11}}})}}});
  const n80 = DATA.pareto.n_articles_80pct, nT = DATA.pareto.n_articles_total;
  document.getElementById('ve-pareto-foot').innerHTML =
    `<strong>${n80} articles sur ${nT}</strong>, soit ${F1(100*n80/nT)} % du catalogue,
     réalisent 80 % du chiffre d'affaires. Plus la courbe s'écarte de la diagonale, plus
     le chiffre d'affaires dépend d'un petit nombre de références — donc plus une rupture
     de stock ou un changement de fournisseur sur ces références pèse lourd.`;

  /* --- top 15 articles --- */
  const top = tri.slice(0,15);
  setChart('c-ve-top', {type:'bar',
    data:{labels:top.map(a=>a.a), datasets:[Object.assign({},BAR,{
      label:'CA net', data:top.map(a=>a.cn),
      backgroundColor:top.map(a=>C[a.t]||C.seq[4]), maxBarThickness:16})]},
    options:{indexAxis:'y',
      plugins:{legend:{display:false}, tooltip:Object.assign({},TOOLTIP,{callbacks:{
        title:items=>tri[items[0].dataIndex].a,
        label:c=>{const a=top[c.dataIndex];
          return [' '+a.t+' · '+a.c, ' CA net : '+FCFA(a.cn),
                  ' '+F1(PCT(a.cn,totArtCn))+' % du CA total',
                  ' Quantité : '+F(a.q)+' · prix moyen '+F(a.cn/(a.q||1))+' F'];}}})},
      scales:{x:axisY(), y:{grid:{display:false}, border:{color:C.axis},
        ticks:{color:C.dim, font:{size:10.5}, autoSkip:false}}}}});

  /* --- categories --- */
  const cat = [...groupBy(vc, r=>r.c, ['cn','q','rm'])].map(([c,v])=>({c,...v}))
    .sort((a,b)=>b.cn-a.cn).slice(0,14);
  barHorizontale('c-ve-cat', cat.map(x=>x.c), cat.map(x=>x.cn), C.seq[4]);

  /* --- jour de la semaine --- */
  const sem = new Array(7).fill(0);
  for(const r of rows) sem[jourNum(r.d)] += r.cn;
  setChart('c-ve-sem', {type:'bar',
    data:{labels:JOURS, datasets:[Object.assign({},BAR,{label:'CA net', data:sem,
      backgroundColor:sem.map((v,i)=>v===Math.max(...sem)?C.accentMark:C.seq[4])})]},
    options:{plugins:{legend:{display:false},
      tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>[' '+FCFA(c.parsed.y), ' '+F1(PCT(c.parsed.y, sem.reduce((a,b)=>a+b,0)))+' du total']}})},
      scales:{y:axisY(), x:axisX({ticks:{color:C.dim, font:{size:10.5}}})}}});

  /* --- catalogue trie --- */
  document.getElementById('ve-nb-art').textContent = F(arts.length);
  dessinerCatalogue();
};

function dessinerCatalogue(){
  const arts = DATA.articles, tot = sum(arts,'cn');
  const cols = [
    {t:'#', k:null}, {t:'Article', k:'a'}, {t:'Activité', k:'t'}, {t:'Catégorie', k:'c'},
    {t:'CA net', k:'cn', num:true}, {t:'% du CA', k:'pc', num:true},
    {t:'Quantité', k:'q', num:true}, {t:'Prix moyen', k:'pm', num:true},
    {t:'Remises', k:'rm', num:true}, {t:'Taux remise', k:'tr', num:true},
  ];
  const enrichi = arts.map(a=>({...a, pc:PCT(a.cn,tot), pm:a.cn/(a.q||1),
                                tr:PCT(a.rm, a.cb||a.cn)}));
  const k = veTri.col;
  enrichi.sort((x,y)=>{
    const A=x[k], B=y[k];
    const c = (typeof A==='string') ? A.localeCompare(B,'fr') : (A-B);
    return veTri.desc ? -c : c;
  });
  let h = '<div class="tbl"><table><thead><tr>';
  cols.forEach(c=>{
    const act = c.k===veTri.col;
    h += `<th class="${c.num?'num':''}" ${c.k?`data-sort="${c.k}" style="cursor:pointer"`:''}>
      ${c.t}${act?(veTri.desc?' ▾':' ▴'):''}</th>`;
  });
  h += '</tr></thead><tbody>';
  enrichi.forEach((a,i)=>{
    h += `<tr><td class="rank">${i+1}</td>
      <td class="strong">${a.a}</td>
      <td>${pill(a.t, a.t.toLowerCase())}</td>
      <td>${a.c}</td>
      <td class="num">${F(a.cn)}</td>
      <td class="num">${F2(a.pc)} %</td>
      <td class="num">${F(a.q)}</td>
      <td class="num">${F(a.pm)}</td>
      <td class="num">${F(a.rm)}</td>
      <td class="num">${F1(a.tr)} %</td></tr>`;
  });
  h += '</tbody></table></div>';
  const host = document.getElementById('ve-table');
  host.innerHTML = h;
  host.querySelectorAll('th[data-sort]').forEach(th=>{
    th.addEventListener('click',()=>{
      const c = th.dataset.sort;
      if(veTri.col===c) veTri.desc = !veTri.desc;
      else { veTri.col = c; veTri.desc = true; }
      dessinerCatalogue();
    });
  });
}

/* =====================================================================
   PAGE 4 — PROFIL DE LA NUIT
   ===================================================================== */
RENDER['horaires'] = function(){
  const h = inRange(DATA.horaire_jour, state.start, state.end);
  const totH = sum(h,'cn');
  const nuit = sum(h.filter(r=>r.h>=22||r.h<6),'cn');
  const parH = groupBy(h, r=>r.h, ['cn','q']);
  let hMax = null, vMax = -1;
  parH.forEach((v,k)=>{ if(v.cn>vMax){ vMax=v.cn; hMax=k; } });

  document.getElementById('ho-kpi').innerHTML = [
    tuile({k:'PART DU CA ENTRE 22H ET 6H', v:F1(PCT(nuit,totH)), u:'%', cls:'accent',
           d:"l'établissement est un lieu de nuit, pas un restaurant de midi"}),
    tuile({k:'TRANCHE LA PLUS FORTE', v:hMax+'h – '+((hMax+1)%24)+'h',
           d:FCFA(vMax)+' sur la période'}),
    tuile({k:'PANIER MOYEN DE RÉFÉRENCE', v:F(DATA.totaux_pos.panier_moyen), u:'F',
           d:F(DATA.totaux_pos.nb_panier)+' paniers sur la période complète'}),
    tuile({k:'NUITS D’EXPLOITATION', v:F(new Set(h.map(r=>r.d)).size),
           d:'journées de 14h00 à 13h59'}),
  ].join('');

  /* --- CA par tranche, empile par activite, ordre_nuit --- */
  const labels = HEURES_NUIT.map(x=>x+'h');
  const dsets = ACT.map(a=>({...STACK, label:a,
    data:HEURES_NUIT.map(hh=>sum(h.filter(r=>r.h===hh && r.t===a),'cn')),
    backgroundColor:C[a]}));
  setChart('c-ho-heure', {type:'bar', data:{labels, datasets:dsets},
    options:{interaction:{mode:'index',intersect:false},
      plugins:{legend:legendTop(true), tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>' '+c.dataset.label+' : '+FCFA(c.parsed.y),
        footer:items=>{const i=items[0].dataIndex;
          const s=dsets.reduce((acc,d)=>acc+(d.data[i]||0),0);
          return 'Total : '+FCFA(s)+'  ·  '+F1(PCT(s,totH))+' du CA';}}})},
      scales:{x:Object.assign(axisX({ticks:{color:C.faint, font:{size:10}}}),{stacked:true}),
              y:Object.assign(axisY(),{stacked:true})}}});
  document.getElementById('ho-h-t').innerHTML = tableHTML(
    [{t:'Tranche'},{t:'DRINK',num:true},{t:'EAT',num:true},{t:'SMOKE',num:true},
     {t:'Total',num:true},{t:'% du CA',num:true}],
    HEURES_NUIT.map((hh,i)=>{
      const s = dsets.map(d=>d.data[i]||0);
      const tt = s.reduce((a,b)=>a+b,0);
      return [hh+'h – '+((hh+1)%24)+'h', F(s[0]), F(s[1]), F(s[2]), F(tt), F1(PCT(tt,totH))+' %'];
    }));

  /* --- panier moyen & nb ventes (profil POS de reference) --- */
  const ph = [...DATA.panier_horaire].sort((a,b)=>a.ordre_nuit-b.ordre_nuit);
  setChart('c-ho-panier', {type:'line',
    data:{labels:ph.map(p=>p.heure), datasets:[Object.assign({},LINE,{
      label:'Panier moyen', data:ph.map(p=>p.panier_moyen),
      borderColor:C.accentMark, backgroundColor:'rgba(15,163,191,.16)',
      pointBackgroundColor:C.accentMark, fill:true})]},
    options:{interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false}, tooltip:Object.assign({},TOOLTIP,{
        callbacks:{label:c=>' Panier moyen : '+FCFA(c.parsed.y)}})},
      scales:{y:axisY(), x:axisX({ticks:{color:C.faint, font:{size:9.5}, maxRotation:60, minRotation:60}})}}});

  setChart('c-ho-ventes', {type:'bar',
    data:{labels:ph.map(p=>p.heure), datasets:[Object.assign({},BAR,{
      label:'Nombre de ventes', data:ph.map(p=>p.ventes),
      backgroundColor:C.seq[4], maxBarThickness:20})]},
    options:{plugins:{legend:{display:false}, tooltip:Object.assign({},TOOLTIP,{
        callbacks:{label:c=>' '+F(c.parsed.y)+' ventes'}})},
      scales:{y:axisY(v=>F(v)), x:axisX({ticks:{color:C.faint, font:{size:9.5}, maxRotation:60, minRotation:60}})}}});

  /* --- carte de chaleur jour x heure, une seule teinte --- */
  const cell = new Map();
  let maxCell = 0;
  for(const r of h){
    const k = jourNum(r.d)+'|'+r.h;
    const v = (cell.get(k)||0)+r.cn;
    cell.set(k,v); if(v>maxCell) maxCell = v;
  }
  const RAMPE = C.seq;   // rampe sequentielle : une teinte, sombre -> clair
  let ht = `<div style="overflow-x:auto"><table style="min-width:940px">
    <thead><tr><th style="min-width:82px">Jour</th>`;
  for(const hh of HEURES_NUIT) ht += `<th class="num" style="padding:6px 3px;font-size:10px">${hh}h</th>`;
  ht += '</tr></thead><tbody>';
  for(let j=0;j<7;j++){
    ht += `<tr><td class="strong" style="white-space:nowrap">${JOURS[j]}</td>`;
    for(const hh of HEURES_NUIT){
      const v = cell.get(j+'|'+hh)||0;
      const r = maxCell ? v/maxCell : 0;
      const idx = v===0 ? -1 : Math.min(RAMPE.length-1, Math.floor(Math.pow(r,.55)*RAMPE.length));
      const bg = idx<0 ? 'transparent' : RAMPE[idx];
      const fg = idx>=5 ? '#0B1615' : (idx<0 ? 'var(--ink-faint)' : 'var(--ink)');
      ht += `<td class="num" title="${JOURS[j]} ${hh}h : ${F(v)} F"
        style="background:${bg};color:${fg};padding:6px 3px;font-size:10px;
        border:2px solid var(--surface);border-radius:3px">${v?Fc(v):'–'}</td>`;
    }
    ht += '</tr>';
  }
  ht += '</tbody></table></div>';
  ht += `<div class="foot">Chiffre d'affaires net en francs CFA, cumulé sur la période.
    Colonnes ordonnées de 14h à 13h : la nuit se lit de gauche à droite sans coupure.
    Le montant est écrit dans chaque case, la couleur ne fait que le renforcer.</div>`;
  document.getElementById('ho-heat').innerHTML = ht;
};

/* =====================================================================
   PAGE 5 — REGLEMENTS & CREANCES
   ===================================================================== */
RENDER['reglements'] = function(){
  const R = [...DATA.reglements];
  const tot = sum(R,'montant');
  const get = l => (R.find(r=>r.libelle===l)||{montant:0,nombre:0});
  const especes = get('ESPECES').montant;
  const credit = get('Crédit').montant;
  const mobile = get('FLOOZ').montant + get('TMONEY').montant + get('GOZEM').montant;
  const carte = get('CB').montant;
  const totRes = sums(DATA.resultat_jour, ['cn']);

  document.getElementById('rg-periode').textContent =
    dateLabel(DATA.meta.periode_debut)+' au '+dateLabel(DATA.meta.periode_fin);

  document.getElementById('rg-kpi').innerHTML = [
    tuile({k:'ESPÈCES', v:F1(PCT(especes,tot)), u:'%', cls:'warn', hero:true,
           d:F(especes)+' F sur '+F(get('ESPECES').nombre)+' opérations'}),
    tuile({k:'MOBILE MONEY', v:F1(PCT(mobile,tot)), u:'%',
           d:'FLOOZ, TMONEY, GOZEM — '+F(mobile)+' F'}),
    tuile({k:'CARTE BANCAIRE', v:F1(PCT(carte,tot)), u:'%',
           d:F(carte)+' F sur '+F(get('CB').nombre)+' opérations'}),
    tuile({k:'VENTES À CRÉDIT', v:F(credit), u:'F', cls:'crit',
           d:F1(PCT(credit,tot))+' des règlements · '+F(get('Crédit').nombre)+' tickets'}),
  ].join('');

  const tri = R.filter(r=>r.montant>0).sort((a,b)=>b.montant-a.montant);
  barHorizontale('c-rg-moyens', tri.map(r=>r.libelle), tri.map(r=>r.montant),
                 tri.map(r=>r.libelle==='Crédit'?C.serious:C.seq[4]));

  const triN = R.filter(r=>r.nombre>0).sort((a,b)=>b.nombre-a.nombre);
  barHorizontale('c-rg-nb', triN.map(r=>r.libelle), triN.map(r=>r.nombre),
                 triN.map(r=>r.libelle==='Crédit'?C.serious:C.seq[6]), v=>F(v)+' opérations');

  document.getElementById('rg-table').innerHTML = tableHTML(
    [{t:'Moyen'},{t:'Montant (F)',num:true},{t:'Part',num:true},
     {t:'Opérations',num:true},{t:'Montant moyen',num:true}],
    tri.map(r=>[
      r.libelle==='Crédit' ? pill('Crédit','serious') : r.libelle,
      F(r.montant), F1(PCT(r.montant,tot))+' %', F(r.nombre),
      F(r.montant/(r.nombre||1))
    ]).concat([['<strong>Total</strong>','<strong>'+F(tot)+'</strong>','100,0 %',
                F(sum(R,'nombre')), F(tot/(sum(R,'nombre')||1))]]));

  const ecart = totRes.cn - tot;
  document.getElementById('rg-lecture').innerHTML = `
    <div class="note warn" style="margin-bottom:12px">
      <div class="note-title">${pill('VIGILANCE','warn')} Une trésorerie très majoritairement en espèces</div>
      ${F1(PCT(especes,tot))} % des règlements passent par la caisse en liquide, contre
      ${F1(PCT(mobile,tot))} % en mobile money et ${F1(PCT(carte,tot))} % en carte.
      Cela concentre le risque de manipulation, de perte et de vol, et limite la
      traçabilité des recettes. C'est aussi un frein au rapprochement bancaire.
    </div>
    <div class="note crit" style="margin-bottom:12px">
      <div class="note-title">${pill('CRITIQUE','crit')} ${F(credit)} F de ventes à crédit</div>
      Réparties sur ${F(get('Crédit').nombre)} tickets, soit ${F(credit/(get('Crédit').nombre||1))} F
      en moyenne. Le rapport POS ne date pas ces créances : impossible de mesurer un
      âge de balance ni un taux de recouvrement. Une procédure formelle d'autorisation
      de crédit — accord préalable, plafond, délai — est le seul levier disponible.
    </div>
    <div class="note info" style="margin:0">
      <div class="note-title">Pourquoi le total ne fait pas le CA net</div>
      CA net ${F(totRes.cn)} F contre ${F(tot)} F de règlements, soit un écart de
      <strong>${F(Math.abs(ecart))} F</strong>. Il s'explique par les ventes à crédit
      (${F(credit)} F) et par les écarts d'encaissement. Cet écart est connu, documenté
      et stable ; c'est sa variation qui constituerait un signal.
    </div>`;
};

/* =====================================================================
   PAGE 6 — MARGE PAR ACTIVITE
   ===================================================================== */
RENDER['marge'] = function(){
  const rows = resPeriode();
  const parAct = ACT.map(a=>{
    const s = sums(rows.filter(r=>r.a===a), KEYS_RES);
    return {a, ...s, taux:PCT(s.mb,s.cn), cout:PCT(s.ae,s.cn)};
  });
  const eat = parAct.find(x=>x.a==='EAT');

  document.getElementById('marge-alerte').innerHTML = `
    <div class="note crit">
      <div class="note-title">${pill('CRITIQUE','crit')} Le coût matière de la cuisine est hors norme</div>
      L'activité <strong>EAT</strong> consomme <strong>${F1(eat.cout)} %</strong> de son
      chiffre d'affaires en achats, là où la restauration se situe entre 25 et 35 %.
      Il en reste <strong>${F1(eat.taux)} %</strong> de marge brute, contre
      ${F1(parAct.find(x=>x.a==='DRINK').taux)} % pour DRINK et
      ${F1(parAct.find(x=>x.a==='SMOKE').taux)} % pour SMOKE.
      Sur la période, EAT pèse ${F1(PCT(eat.cn, sum(rows,'cn')))} % du CA net mais seulement
      ${F1(PCT(eat.mb, sum(rows,'mb')))} % de la marge brute.
      <br><br><strong>Avant de conclure à une dérive de la cuisine</strong>, trois
      explications techniques doivent être écartées : le poste d'achat EAT agrège
      <code>EAT</code> et <code>GAZ</code>, or le gaz sert à tout l'établissement ;
      les achats d'une journée peuvent constituer du stock vendu les jours suivants,
      ce qui décale la marge sans la détruire ; et la page « Coût de revient » montre
      que les recettes, elles, impliquent une marge bien supérieure.
    </div>`;

  document.getElementById('ma-kpi').innerHTML = parAct.map(x=>tuile({
    k:x.a, v:F1(x.taux)+' %', hero:true,
    cls:x.taux<35?'crit':(x.taux<50?'warn':'good'),
    d:`marge brute · CA net ${Fc(x.cn)} F · achats ${Fc(x.ae)} F<br>
       coût matière ${F1(x.cout)} %`
  })).join('');

  /* --- composition CA net = achats + marge --- */
  setChart('c-ma-comp', {type:'bar',
    data:{labels:ACT, datasets:[
      {...STACK, label:'Achats externes', data:parAct.map(x=>x.ae), backgroundColor:C.serious},
      {...STACK, label:'Marge brute', data:parAct.map(x=>x.mb), backgroundColor:C.good},
    ]},
    options:{indexAxis:'y', interaction:{mode:'index',intersect:false},
      plugins:{legend:legendTop(true), tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>' '+c.dataset.label+' : '+FCFA(c.parsed.x),
        footer:items=>{const x=parAct[items[0].dataIndex];
          return 'CA net : '+FCFA(x.cn)+'  ·  marge '+F1(x.taux)+' %';}}})},
      scales:{x:Object.assign(axisY(),{stacked:true}),
              y:Object.assign({stacked:true, grid:{display:false},
                border:{color:C.axis}, ticks:{color:C.dim}})}}});
  document.getElementById('ma-comp-t').innerHTML = tableHTML(
    [{t:'Activité'},{t:'CA net',num:true},{t:'Achats',num:true},{t:'Marge brute',num:true},
     {t:'Taux de marge',num:true},{t:'Coût matière',num:true}],
    parAct.map(x=>[x.a, F(x.cn), F(x.ae), F(x.mb), F1(x.taux)+' %', F1(x.cout)+' %']));

  /* --- cout matiere contre la norme --- */
  setChart('c-ma-cout', {type:'bar',
    data:{labels:ACT, datasets:[Object.assign({},BAR,{
      label:'Coût matière', data:parAct.map(x=>x.cout),
      backgroundColor:parAct.map(x=>x.cout>50?C.crit:(x.cout>35?C.warn:C.good)),
      maxBarThickness:64})]},
    options:{plugins:{legend:{display:false},
      tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>{const x=parAct[c.dataIndex];
          return [' Coût matière : '+F1(c.parsed.y)+' %',
                  ' Achats : '+FCFA(x.ae), ' CA net : '+FCFA(x.cn),
                  x.cout>35?' → au-dessus de la norme de 25-35 %':' → dans la norme'];}}})},
      scales:{y:Object.assign(axisY(v=>F(v)+' %'),{min:0,max:100}), x:axisX({ticks:{color:C.dim}})}},
    plugins:[bandePlugin(25,35,'norme resto (EAT)'),
             etiquettesPlugin(v=>F1(v)+' %')]});

  /* --- taux de marge mensuel par activite, une seule echelle --- */
  const m = new Map();
  for(const r of rows){
    const k = moisKey(r.d);
    if(!m.has(k)) m.set(k,{DRINK:{cn:0,mb:0},EAT:{cn:0,mb:0},SMOKE:{cn:0,mb:0},lab:moisLabel(r.d)});
    const g = m.get(k)[r.a]; g.cn += r.cn; g.mb += r.mb;
  }
  const ks = [...m.keys()].sort();
  setChart('c-ma-mens', {type:'line',
    data:{labels:ks.map(k=>m.get(k).lab), datasets:ACT.map(a=>Object.assign({},LINE,{
      label:a, data:ks.map(k=>{const g=m.get(k)[a]; return g.cn? PCT(g.mb,g.cn) : null;}),
      borderColor:C[a], backgroundColor:C[a], pointBackgroundColor:C[a], spanGaps:true}))},
    options:{interaction:{mode:'index',intersect:false},
      plugins:{legend:legendTop(true), tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>c.parsed.y===null?null:' '+c.dataset.label+' : '+F1(c.parsed.y)+' % de marge'}})},
      scales:{y:axisY(v=>F(v)+' %'), x:axisX()}},
    plugins:[bandePlugin(65,75,'norme resto (EAT)')]});

  document.getElementById('ma-table').innerHTML = tableHTML(
    [{t:'Activité'},{t:'CA brut',num:true},{t:'Remises',num:true},{t:'CA net',num:true},
     {t:'Achats',num:true},{t:'Marge brute',num:true},{t:'Taux',num:true},
     {t:'Coût matière',num:true},{t:'Part du CA',num:true},{t:'Part de la marge',num:true}],
    parAct.map(x=>[pill(x.a, x.a.toLowerCase()), F(x.cb), F(x.rm), F(x.cn), F(x.ae),
      F(x.mb), F1(x.taux)+' %', F1(x.cout)+' %',
      F1(PCT(x.cn, sum(rows,'cn')))+' %', F1(PCT(x.mb, sum(rows,'mb')))+' %']));
};

/* =====================================================================
   PAGE 7 — COUT DE REVIENT
   ===================================================================== */
RENDER['cout-revient'] = function(){
  const CR = DATA.couts_articles;
  const totCn = sum(DATA.articles,'cn');
  const cnCouvert = sum(CR,'cn');
  document.getElementById('cr-nb-ref').textContent = F(152);
  document.getElementById('cr-nb-app').textContent = F(CR.length);
  document.getElementById('cr-couv').textContent = F1(PCT(cnCouvert,totCn))+' %';

  const coutTot = sum(CR,'ct'), margeTheo = sum(CR,'mt');
  const complets = CR.filter(c=>c.st==='Complet').length;
  const eatAll = CR.filter(c=>c.t==='EAT');
  const eatComplets = eatAll.filter(c=>c.st==='Complet');
  const nEat = eatAll.length, completsEat = eatComplets.length;

  document.getElementById('cr-kpi').innerHTML = [
    tuile({k:'CA COUVERT PAR UN COÛT DE RECETTE', v:Fc(cnCouvert), u:'F',
           d:F1(PCT(cnCouvert,totCn))+' % du CA total'}),
    tuile({k:'COÛT DE RECETTE CUMULÉ', v:Fc(coutTot), u:'F',
           d:F1(PCT(coutTot,cnCouvert))+' % du CA couvert'}),
    tuile({k:'MARGE THÉORIQUE', v:F1(PCT(margeTheo,cnCouvert)), u:'%', cls:'accent', hero:true,
           d:F(margeTheo)+' F sur le périmètre couvert'}),
    tuile({k:'RECETTES COMPLÈTES', v:F(complets)+' / '+F(CR.length),
           cls:complets<CR.length?'warn':'good',
           d:`une recette incomplète sous-évalue son coût, donc surévalue sa marge.
              ${F(completsEat)} des ${F(nEat)} recettes de cuisine sont complètes`}),
  ].join('');

  /* --- theorique contre reel, par activite --- */
  const parT = {};
  for(const c of CR){
    parT[c.t] = parT[c.t] || {cn:0, ct:0, mt:0};
    parT[c.t].cn += c.cn; parT[c.t].ct += c.ct; parT[c.t].mt += c.mt;
  }
  const reelAll = sums(DATA.resultat_jour, ['cn','mb']);
  const cmp = ACT.filter(a=>parT[a]).map(a=>{
    const reel = sums(DATA.resultat_jour.filter(r=>r.a===a), ['cn','mb']);
    return {a, theo:PCT(parT[a].mt, parT[a].cn), reel:PCT(reel.mb, reel.cn),
            cnCouv:parT[a].cn, ct:parT[a].ct};
  });
  setChart('c-cr-compare', {type:'bar',
    data:{labels:cmp.map(x=>x.a), datasets:[
      Object.assign({},BAR,{label:'Marge théorique (coûts de recette)',
        data:cmp.map(x=>x.theo), backgroundColor:C.seq[4], maxBarThickness:44}),
      Object.assign({},BAR,{label:'Marge réelle (achats payés)',
        data:cmp.map(x=>x.reel), backgroundColor:C.compare, maxBarThickness:44}),
    ]},
    options:{plugins:{legend:legendTop(true),
      tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>' '+c.dataset.label+' : '+F1(c.parsed.y)+' %',
        footer:items=>{const x=cmp[items[0].dataIndex];
          return 'Écart : '+F1(x.theo-x.reel)+' points';}}})},
      scales:{y:Object.assign(axisY(v=>F(v)+' %'),{min:0}), x:axisX({ticks:{color:C.dim}})}},
    plugins:[etiquettesPlugin(v=>F1(v)+' %')]});
  document.getElementById('cr-cmp-t').innerHTML = tableHTML(
    [{t:'Activité'},{t:'CA couvert',num:true},{t:'Coût de recette',num:true},
     {t:'Marge théorique',num:true},{t:'Marge réelle',num:true},{t:'Écart',num:true}],
    cmp.map(x=>[x.a, F(x.cnCouv), F(x.ct), F1(x.theo)+' %', F1(x.reel)+' %',
                (x.theo-x.reel>0?'+':'')+F1(x.theo-x.reel)+' pts']));

  /* --- diagnostic de l'ecart --- */
  const eatCmp = cmp.find(x=>x.a==='EAT');
  const cnEatTotal = sums(DATA.resultat_jour.filter(r=>r.a==='EAT'), ['cn']).cn;
  const cnComplets = sum(eatComplets,'cn');
  const theoComplets = PCT(sum(eatComplets,'mt'), cnComplets);
  const theoTous = PCT(sum(eatAll,'mt'), sum(eatAll,'cn'));
  let diag = '';
  if(eatCmp && eatCmp.theo - eatCmp.reel > 20){
    diag = `<div class="note crit">
      <div class="note-title">${pill('À INSTRUIRE','crit')} EAT : ${F1(eatCmp.theo-eatCmp.reel)} points d'écart entre théorie et réalité</div>
      Les recettes de cuisine impliquent une marge de <strong>${F1(eatCmp.theo)} %</strong>.
      Les achats effectivement payés n'en laissent que <strong>${F1(eatCmp.reel)} %</strong>.
      Autrement dit, l'établissement achète environ
      <strong>${F1((100-eatCmp.reel)/(100-eatCmp.theo))} fois</strong>
      ce que les fiches techniques prévoient pour le chiffre d'affaires réalisé.
      <br><br>Quatre pistes, à écarter dans cet ordre parce qu'elles vont de la plus
      probable à la plus grave :
      <br>• <strong>Périmètre du poste d'achat.</strong> La ligne EAT agrège
      <code>EAT</code> et <code>GAZ</code>. Le gaz alimente tout l'établissement, pas
      seulement la cuisine : une partie de ce coût n'appartient pas à EAT.
      <br>• <strong>Décalage stock.</strong> Un achat de denrées non périssables
      alimente plusieurs jours de vente. Sur une période longue l'effet s'annule, mais
      il fausse toute lecture mensuelle.
      <br>• <strong>Couverture partielle.</strong> Les coûts de recette ne couvrent que
      ${F1(PCT(eatCmp.cnCouv, sums(DATA.resultat_jour.filter(r=>r.a==='EAT'),['cn']).cn))} %
      du CA de EAT. Les plats non chiffrés sont peut-être les moins margés.
      <br>• <strong>Pertes réelles</strong> — casse, gaspillage, consommation non
      enregistrée. C'est la seule piste qui appelle une action disciplinaire, et c'est
      pour cela qu'elle vient en dernier : les trois précédentes doivent être écartées
      d'abord, chiffres en main.
    </div>
    <div class="note info">
      <div class="note-title">Contrôle de robustesse : l'écart ne vient pas des recettes incomplètes</div>
      L'objection immédiate est que ${F(nEat-completsEat)} des ${F(nEat)} recettes de cuisine
      ont un ingrédient manquant : leur coût est sous-évalué, donc leur marge théorique
      surévaluée. Le calcul a donc été refait sur les
      <strong>${F(completsEat)} recettes complètes uniquement</strong>, qui couvrent
      ${F1(PCT(cnComplets, cnEatTotal))} % du chiffre d'affaires de EAT :
      la marge théorique y est de <strong>${F1(theoComplets)} %</strong>, contre
      ${F1(theoTous)} % sur l'ensemble des recettes appariées.
      Elle est donc <strong>${theoComplets>=theoTous?'légèrement supérieure':'inférieure'}</strong>,
      pas inférieure : l'écart avec la marge réelle de ${F1(eatCmp.reel)} % tient,
      et ne s'explique pas par la qualité des fiches techniques.
    </div>
    <div class="note warn">
      <div class="note-title">Une réserve en sens inverse, sur les boissons</div>
      Aucune des ${F(CR.filter(c=>c.t==='DRINK').length)} lignes de coût de DRINK n'est
      marquée complète. La marge théorique de ${F1(cmp.find(x=>x.a==='DRINK')?
      cmp.find(x=>x.a==='DRINK').theo : 0)} % affichée pour les boissons est donc
      un plancher, et c'est cohérent avec une marge réelle mesurée plus haute
      (${F1(cmp.find(x=>x.a==='DRINK')?cmp.find(x=>x.a==='DRINK').reel:0)} %).
      Pour DRINK, l'écart théorie / réalité ne constitue pas une alerte.
    </div>`;
  }
  document.getElementById('cr-diagnostic').innerHTML = diag;

  /* --- meilleures et pires marges theoriques --- */
  const avecTaux = CR.map(c=>({...c, taux:PCT(c.mt,c.cn)})).filter(c=>c.q>=5);
  const best = [...avecTaux].sort((a,b)=>b.taux-a.taux).slice(0,15);
  const worst = [...avecTaux].sort((a,b)=>a.taux-b.taux).slice(0,15);
  const barTaux = (id,arr) => setChart(id,{type:'bar',
    data:{labels:arr.map(c=>c.a), datasets:[Object.assign({},BAR,{
      label:'Marge théorique', data:arr.map(c=>c.taux),
      backgroundColor:arr.map(c=>c.taux<0?C.crit:(c.taux<30?C.warn:C[c.t]||C.seq[4])),
      maxBarThickness:16})]},
    options:{indexAxis:'y',
      plugins:{legend:{display:false}, tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>{const x=arr[c.dataIndex];
          return [' Marge théorique : '+F1(x.taux)+' %',
                  ' Coût de recette : '+F(x.cr)+' F', ' Prix de vente : '+F(x.pv)+' F',
                  ' Vendu : '+F(x.q)+' fois · CA '+FCFA(x.cn), ' Statut : '+x.st];}}})},
      scales:{x:axisY(v=>F(v)+' %'), y:{grid:{display:false}, border:{color:C.axis},
        ticks:{color:C.dim, font:{size:10}, autoSkip:false}}}}});
  barTaux('c-cr-best', best);
  barTaux('c-cr-worst', worst);

  /* --- tableau complet --- */
  const tri = [...CR].map(c=>({...c, taux:PCT(c.mt,c.cn)})).sort((a,b)=>b.cn-a.cn);
  document.getElementById('cr-table').innerHTML = tableHTML(
    [{t:'#'},{t:'Produit'},{t:'Activité'},{t:'Catégorie'},{t:'Coût recette',num:true},
     {t:'Prix vente',num:true},{t:'Marge unitaire',num:true},{t:'Marge %',num:true},
     {t:'Quantité',num:true},{t:'CA net',num:true},{t:'Fiabilité'}],
    tri.map((c,i)=>[String(i+1), `<span class="strong">${c.a}</span>`,
      pill(c.t, c.t.toLowerCase()), c.c, F2(c.cr), c.pv?F(c.pv):'—',
      c.pv?F(c.pv-c.cr):'—', F1(c.taux)+' %', F(c.q), F(c.cn),
      c.st==='Complet' ? pill('complet','good') : pill('partiel','warn')]));
};

/* =====================================================================
   PAGE 8 — DEPENSES
   ===================================================================== */
RENDER['depenses'] = function(){
  const dep = inRange(DATA.depenses_jour, state.start, state.end);
  const t = totauxRes();
  const tot = sum(dep,'m');
  const parNature = groupBy(dep, r=>r.n, ['m']);
  const nat = n => (parNature.get(n)||{m:0}).m;

  document.getElementById('de-kpi').innerHTML = [
    tuile({k:'DÉPENSES TOTALES', v:Fc(tot), u:'F', d:F(tot)+' F · '+F1(PCT(tot,t.cn))+' % du CA net'}),
    tuile({k:'ACHATS DE MARCHANDISES', v:Fc(nat('ACHATS EXTERNES')), u:'F',
           d:F1(PCT(nat('ACHATS EXTERNES'),t.cn))+' % du CA net'}),
    tuile({k:"CHARGES D'EXPLOITATION", v:Fc(nat('OPEX')), u:'F',
           d:F1(PCT(nat('OPEX'),t.cn))+' % du CA net'}),
    tuile({k:'INVESTISSEMENTS', v:Fc(nat('CAPEX')), u:'F',
           d:F1(PCT(nat('CAPEX'),t.cn))+" % du CA net · traités en charge de l'exercice"}),
  ].join('');

  const NATCOUL = {'ACHATS EXTERNES':C.serious, 'OPEX':C.warn, 'CAPEX':C.seq[6]};
  const postes = [...groupBy(dep, r=>r.p, ['m'])].map(([p,v])=>{
    const n = (dep.find(r=>r.p===p)||{}).n;
    return {p, m:v.m, n};
  }).sort((a,b)=>b.m-a.m);

  setChart('c-de-postes', {type:'bar',
    data:{labels:postes.map(x=>x.p), datasets:[Object.assign({},BAR,{
      label:'Montant', data:postes.map(x=>x.m),
      backgroundColor:postes.map(x=>NATCOUL[x.n]||C.seq[4]), maxBarThickness:15})]},
    options:{indexAxis:'y',
      plugins:{legend:{display:false}, tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>{const x=postes[c.dataIndex];
          return [' '+FCFA(x.m), ' '+x.n, ' '+F1(PCT(x.m,tot))+' des dépenses',
                  ' '+F1(PCT(x.m,t.cn))+' du CA net'];}}})},
      scales:{x:axisY(), y:{grid:{display:false}, border:{color:C.axis},
        ticks:{color:C.dim, font:{size:10}, autoSkip:false}}}}});
  document.getElementById('de-p-t').innerHTML = tableHTML(
    [{t:'Poste'},{t:'Nature'},{t:'Montant (F)',num:true},{t:'% des dépenses',num:true},
     {t:'% du CA net',num:true}],
    postes.map(x=>[x.p, x.n, F(x.m), F1(PCT(x.m,tot))+' %', F1(PCT(x.m,t.cn))+' %']));

  const natsOrd = ['ACHATS EXTERNES','OPEX','CAPEX'].filter(n=>nat(n)>0);
  setChart('c-de-nature', {type:'doughnut',
    data:{labels:natsOrd.map(n=>n==='OPEX'?"Charges d'exploitation":
      (n==='CAPEX'?'Investissements':'Achats de marchandises')),
      datasets:[{data:natsOrd.map(n=>nat(n)),
        backgroundColor:natsOrd.map(n=>NATCOUL[n]), borderWidth:2, borderColor:C.surface}]},
    options:{cutout:'54%', plugins:{
      legend:{position:'bottom', labels:{color:C.dim, boxWidth:9, boxHeight:9,
        usePointStyle:true, pointStyle:'rectRounded', padding:9, font:{size:10.5}}},
      tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>' '+FCFA(c.parsed)+' ('+F1(PCT(c.parsed,tot))+' %)'}})}}});

  const opex = postes.filter(x=>x.n==='OPEX').slice(0,10);
  barHorizontale('c-de-opex', opex.map(x=>x.p), opex.map(x=>x.m), C.warn);

  const pmDep = parMois(dep, ['m']);
  const serie = n => pmDep.ks.map(k=>sum(dep.filter(r=>moisKey(r.d)===k && r.n===n),'m'));
  setChart('c-de-mens', {type:'bar',
    data:{labels:pmDep.lab, datasets:natsOrd.map(n=>({...STACK,
      label:n==='OPEX'?"Charges d'exploitation":(n==='CAPEX'?'Investissements':'Achats de marchandises'),
      data:serie(n), backgroundColor:NATCOUL[n]}))},
    options:{interaction:{mode:'index',intersect:false},
      plugins:{legend:legendTop(true), tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>' '+c.dataset.label+' : '+FCFA(c.parsed.y)}})},
      scales:{x:Object.assign(axisX(),{stacked:true}), y:Object.assign(axisY(),{stacked:true})}}});

  document.getElementById('de-table').innerHTML = tableHTML(
    [{t:'Poste'},{t:'Nature'},{t:'Montant (F)',num:true},{t:'Part',num:true},{t:'',num:false}],
    postes.map(x=>[`<span class="strong">${x.p}</span>`, x.n, F(x.m),
      F1(PCT(x.m,tot))+' %', barCell(PCT(x.m,postes[0].m), NATCOUL[x.n]||C.seq[4])]));
};

/* =====================================================================
   PAGE 9 — REMISES & OFFERTS
   ===================================================================== */
RENDER['commercial'] = function(){
  const rows = resPeriode(), t = totauxRes();
  const off = inRange(DATA.offerts_jour, state.start, state.end);
  const valOff = sum(off,'v'), qteOff = sum(off,'q');
  const potentiel = t.cb + valOff;
  const effort = t.rm + valOff;

  document.getElementById('co-alerte').innerHTML = `
    <div class="note warn">
      <div class="note-title">${pill('VIGILANCE','warn')} L'effort commercial représente ${F1(PCT(effort,potentiel))} % du chiffre d'affaires potentiel</div>
      Sur la période, l'établissement a renoncé à <strong>${F(effort)} F</strong> :
      ${F(t.rm)} F de remises accordées et <strong>${F(valOff)} F d'articles offerts</strong>
      (${F(qteOff)} unités). Les offerts pèsent ${F1(PCT(valOff,effort))} % de cet effort —
      c'est le poste à instruire en premier, pas les remises.
      <br>Rapporté à la marge brute de ${F(t.mb)} F, cet effort en représente
      <strong>${F1(PCT(effort,t.mb))} %</strong> : chaque franc offert est un franc de marge
      qui ne rentre pas. Reste à établir ce qu'il rapporte en fréquentation — la donnée
      n'existe pas dans le POS, elle demande un suivi dédié.
    </div>`;

  document.getElementById('co-kpi').innerHTML = [
    tuile({k:'REMISES ACCORDÉES', v:Fc(t.rm), u:'F',
           d:F1(PCT(t.rm,t.cb))+' % du CA brut'}),
    tuile({k:'VALEUR DES ARTICLES OFFERTS', v:Fc(valOff), u:'F', cls:'warn',
           d:F(qteOff)+' unités offertes'}),
    tuile({k:'EFFORT COMMERCIAL TOTAL', v:F1(PCT(effort,potentiel)), u:'%', cls:'warn', hero:true,
           d:F(effort)+' F sur un CA potentiel de '+Fc(potentiel)+' F'}),
    tuile({k:'PART DE LA MARGE BRUTE CONSOMMÉE', v:F1(PCT(effort,t.mb)), u:'%',
           d:'marge brute de la période : '+Fc(t.mb)+' F'}),
  ].join('');

  /* --- effort mensuel : remises + offerts --- */
  const pm = parMois(rows, ['cb','rm']);
  const offParMois = groupBy(off, r=>moisKey(r.d), ['v','q']);
  setChart('c-co-mens', {type:'bar',
    data:{labels:pm.lab, datasets:[
      {...STACK, label:'Remises accordées', data:pm.ks.map(k=>pm.get(k).rm), backgroundColor:C.seq[4]},
      {...STACK, label:'Valeur des articles offerts',
       data:pm.ks.map(k=>(offParMois.get(k)||{v:0}).v), backgroundColor:C.warn},
    ]},
    options:{interaction:{mode:'index',intersect:false},
      plugins:{legend:legendTop(true), tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>' '+c.dataset.label+' : '+FCFA(c.parsed.y),
        footer:items=>{const k=pm.ks[items[0].dataIndex];
          const e=pm.get(k).rm+((offParMois.get(k)||{v:0}).v);
          return 'Effort total : '+FCFA(e)+'  ·  '+F1(PCT(e, pm.get(k).cb))+' du CA brut';}}})},
      scales:{x:Object.assign(axisX(),{stacked:true}), y:Object.assign(axisY(),{stacked:true})}}});
  document.getElementById('co-m-t').innerHTML = tableHTML(
    [{t:'Mois'},{t:'CA brut',num:true},{t:'Remises',num:true},{t:'Offerts',num:true},
     {t:'Effort total',num:true},{t:'% du CA brut',num:true}],
    pm.ks.map(k=>{const g=pm.get(k), o=(offParMois.get(k)||{v:0}).v;
      return [MOIS[dOf(k+'-01').getMonth()]+' '+k.slice(0,4), F(g.cb), F(g.rm), F(o),
              F(g.rm+o), F1(PCT(g.rm+o, g.cb))+' %'];}));

  setChart('c-co-taux', {type:'line',
    data:{labels:pm.lab, datasets:[Object.assign({},LINE,{
      label:'Taux de remise', data:pm.ks.map(k=>PCT(pm.get(k).rm, pm.get(k).cb)),
      borderColor:C.seq[4], backgroundColor:'rgba(57,135,229,.13)',
      pointBackgroundColor:C.seq[4], fill:true})]},
    options:{interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false}, tooltip:Object.assign({},TOOLTIP,{
        callbacks:{label:c=>' Taux de remise : '+F1(c.parsed.y)+' %'}})},
      scales:{y:axisY(v=>F(v)+' %'), x:axisX()}}});

  /* --- remises par activite --- */
  document.getElementById('co-act').innerHTML = tableHTML(
    [{t:'Activité'},{t:'CA brut',num:true},{t:'Remises',num:true},{t:'Taux',num:true},
     {t:'Qté offerte',num:true},{t:'',num:false}],
    ACT.map(a=>{
      const s = sums(rows.filter(r=>r.a===a), ['cb','rm','qo']);
      return [pill(a, a.toLowerCase()), F(s.cb), F(s.rm), F1(PCT(s.rm,s.cb))+' %',
              F(s.qo), barCell(PCT(s.rm,s.cb)*4, C[a])];
    }));

  /* --- offerts par caissier --- */
  const parCais = [...groupBy(off, r=>r.c, ['v','q'])].map(([c,v])=>({c,...v}))
    .sort((a,b)=>b.v-a.v).slice(0,12);
  setChart('c-co-caissier', {type:'bar',
    data:{labels:parCais.map(x=>x.c), datasets:[Object.assign({},BAR,{
      label:'Valeur offerte', data:parCais.map(x=>x.v),
      backgroundColor:C.warn, maxBarThickness:18})]},
    options:{indexAxis:'y',
      plugins:{legend:{display:false}, tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>{const x=parCais[c.dataIndex];
          return [' '+FCFA(x.v), ' '+F(x.q)+' articles offerts',
                  ' '+F1(PCT(x.v,valOff))+' du total offert'];}}})},
      scales:{x:axisY(), y:{grid:{display:false}, border:{color:C.axis},
        ticks:{color:C.dim, font:{size:10.5}, autoSkip:false}}}}});

  const parCat = [...groupBy(off, r=>r.cat, ['v','q'])].map(([c,v])=>({c,...v}))
    .sort((a,b)=>b.v-a.v).slice(0,14);
  barHorizontale('c-co-cat', parCat.map(x=>x.c), parCat.map(x=>x.v), C.warn);

  const artOff = DATA.offerts_article.slice(0,60);
  const totArtOff = sum(DATA.offerts_article,'v');
  document.getElementById('co-art').innerHTML = tableHTML(
    [{t:'#'},{t:'Article'},{t:'Catégorie'},{t:'Quantité',num:true},
     {t:'Valeur (F)',num:true},{t:'Part',num:true}],
    artOff.map((a,i)=>[String(i+1), `<span class="strong">${a.a}</span>`, a.cat,
      F(a.q), F(a.v), F1(PCT(a.v,totArtOff))+' %']));
};

/* =====================================================================
   PAGE 10 — STOCK & INVENTAIRE
   ===================================================================== */
RENDER['stock'] = function(){
  const INV = DATA.inventaire, meta = DATA.inventaire_meta;
  const sousAlerte = INV.filter(i=>i.al);
  const valorises = INV.filter(i=>i.vs!==null);
  const valTot = sum(valorises,'vs');

  document.getElementById('st-alerte').innerHTML = meta.comptage_saisi ? '' : `
    <div class="note crit">
      <div class="note-title">${pill('DONNÉE MANQUANTE','crit')} Aucun comptage physique n'a été saisi</div>
      La colonne « quantité physique » de l'export d'inventaire est à <strong>zéro sur les
      ${F(INV.length)} articles</strong>. L'écart affiché par le POS vaut donc mécaniquement
      l'opposé du stock théorique : <strong>ce n'est pas une démarque</strong>, c'est
      l'absence de comptage. Toute lecture de cet écart comme une perte serait fausse.
      <br><br>Ce qui reste exploitable : le <strong>stock théorique</strong> tenu par le POS
      et les <strong>seuils d'alerte</strong> paramétrés. Ce qui ne l'est pas : la démarque,
      la rotation réelle et la valorisation certifiée du stock.
      <br>Un premier inventaire physique saisi dans le POS débloquerait ces trois indicateurs
      d'un coup — c'est l'action à plus fort rendement sur ce périmètre.
    </div>`;

  document.getElementById('st-kpi').innerHTML = [
    tuile({k:'ARTICLES SUIVIS EN STOCK', v:F(INV.length),
           d:F(valorises.length)+' avec un coût de revient connu'}),
    tuile({k:'STOCK THÉORIQUE VALORISÉ', v:Fc(valTot), u:'F',
           d:'au coût de revient · périmètre partiel'}),
    tuile({k:'ARTICLES SOUS SEUIL D’ALERTE', v:F(sousAlerte.length),
           cls:sousAlerte.length?'warn':'good',
           d:'stock théorique ≤ seuil paramétré'}),
    tuile({k:'COMPTAGE PHYSIQUE', v:meta.comptage_saisi?'Saisi':'Absent',
           cls:meta.comptage_saisi?'good':'crit',
           d:meta.comptage_saisi?'démarque exploitable':'démarque non mesurable'}),
  ].join('');

  const parCat = [...groupBy(valorises, r=>r.cat, ['vs'])].map(([c,v])=>({c,...v}))
    .sort((a,b)=>b.vs-a.vs).slice(0,16);
  barHorizontale('c-st-cat', parCat.map(x=>x.c), parCat.map(x=>x.vs), C.seq[4]);

  document.getElementById('st-alertes-liste').innerHTML = sousAlerte.length
    ? tableHTML([{t:'Article'},{t:'Catégorie'},{t:'Stock',num:true},{t:'Seuil',num:true},{t:'Statut'}],
        sousAlerte.sort((a,b)=>(a.qt-a.sa)-(b.qt-b.sa)).map(i=>[
          `<span class="strong">${i.a}</span>`, i.cat, F(i.qt), F(i.sa),
          i.qt===0 ? pill('rupture','crit') : pill('à réapprovisionner','warn')]))
    : `<div class="note good" style="margin:0">Aucun article sous son seuil d'alerte.
       Attention : seuls ${F(INV.filter(i=>i.sa>0).length)} articles sur ${F(INV.length)}
       ont un seuil paramétré dans le POS — les autres ne peuvent pas déclencher d'alerte.</div>`;

  const tri = [...INV].sort((a,b)=>(b.vs||0)-(a.vs||0));
  document.getElementById('st-table').innerHTML = tableHTML(
    [{t:'#'},{t:'Article'},{t:'Catégorie'},{t:'Stock théorique',num:true},
     {t:'Seuil d’alerte',num:true},{t:'Valorisation (F)',num:true},{t:'Statut'}],
    tri.map((i,n)=>[String(n+1), `<span class="strong">${i.a}</span>`, i.cat,
      F(i.qt), i.sa?F(i.sa):'—', i.vs!==null?F(i.vs):'—',
      i.al ? (i.qt===0?pill('rupture','crit'):pill('sous seuil','warn'))
           : (i.sa?pill('suffisant','good'):pill('sans seuil'))]));
};

/* =====================================================================
   PAGE 11 — PERFORMANCE CAISSE
   ===================================================================== */
RENDER['caisse'] = function(){
  const K = DATA.caissiers.filter(c=>c.utilisateur && c.utilisateur!=='nan');
  const val = (c,k) => (c[k]===null||c[k]===undefined) ? 0 : c[k];
  const totHT = K.reduce((a,c)=>a+val(c,'Total HT'),0);
  const totTickets = K.reduce((a,c)=>a+val(c,'Nbre de ticket'),0);
  const caTotal = sums(DATA.resultat_jour,['cn']).cn;

  document.getElementById('ca-couverture').innerHTML =
    ` Sur cet export, le cumul des caissiers représente <strong>${F(totHT)} F</strong>,
      soit ${F1(PCT(totHT,caTotal))} % du CA net de la période complète.`;

  const meilleur = [...K].sort((a,b)=>val(b,'Panier Moyen')-val(a,'Panier Moyen'))[0];
  document.getElementById('ca-kpi').innerHTML = [
    tuile({k:'CAISSIERS DANS L’EXPORT', v:F(K.length), d:'utilisateurs distincts'}),
    tuile({k:'CA CUMULÉ DE L’EXPORT', v:Fc(totHT), u:'F',
           d:F1(PCT(totHT,caTotal))+' % du CA net total'}),
    tuile({k:'TICKETS', v:F(totTickets), d:'sur le périmètre de l’export'}),
    tuile({k:'MEILLEUR PANIER MOYEN', v:meilleur?meilleur.utilisateur:'—',
           cls:'accent', d:meilleur?F(val(meilleur,'Panier Moyen'))+' F par ticket':''}),
  ].join('');

  const triCa = [...K].sort((a,b)=>val(b,'Total HT')-val(a,'Total HT'));
  barHorizontale('c-ca-ca', triCa.map(c=>c.utilisateur),
                 triCa.map(c=>val(c,'Total HT')), C.seq[4]);

  const triPm = [...K].filter(c=>val(c,'Panier Moyen')>0)
    .sort((a,b)=>val(b,'Panier Moyen')-val(a,'Panier Moyen'));
  setChart('c-ca-panier', {type:'bar',
    data:{labels:triPm.map(c=>c.utilisateur), datasets:[Object.assign({},BAR,{
      label:'Panier moyen', data:triPm.map(c=>val(c,'Panier Moyen')),
      backgroundColor:C.accentMark, maxBarThickness:22})]},
    options:{indexAxis:'y',
      plugins:{legend:{display:false}, tooltip:Object.assign({},TOOLTIP,{callbacks:{
        label:c=>{const k=triPm[c.dataIndex];
          return [' Panier moyen : '+FCFA(c.parsed.x),
                  ' '+F(val(k,'Nbre de ticket'))+' tickets',
                  ' CA : '+FCFA(val(k,'Total HT'))];}}})},
      scales:{x:axisY(), y:{grid:{display:false}, border:{color:C.axis},
        ticks:{color:C.dim, autoSkip:false}}}}});

  document.getElementById('ca-table').innerHTML = tableHTML(
    [{t:'Caissier'},{t:'CA (F)',num:true},{t:'Part',num:true},{t:'Tickets',num:true},
     {t:'Panier moyen',num:true},{t:'Produits',num:true},{t:'Produits / ticket',num:true}],
    triCa.map(c=>[`<span class="strong">${c.utilisateur}</span>`,
      F(val(c,'Total HT')), F1(PCT(val(c,'Total HT'),totHT))+' %',
      F(val(c,'Nbre de ticket')), F(val(c,'Panier Moyen')), F(val(c,'Nbre produit')),
      F1(val(c,'Nbre produit')/(val(c,'Nbre de ticket')||1))])
    .concat([['<strong>Total</strong>','<strong>'+F(totHT)+'</strong>','100,0 %',
      F(totTickets), F(totHT/(totTickets||1)),
      F(K.reduce((a,c)=>a+val(c,'Nbre produit'),0)), '']]));
};

/* =====================================================================
   PAGE 12 — QUALITE DES DONNEES
   ===================================================================== */
RENDER['qualite'] = function(){
  const R = DATA.reconciliation;
  const ok = R.filter(r=>r.statut==='OK').length;
  const connus = R.filter(r=>r.statut.includes('ECART')||r.statut.includes('ECARTEE')).length;
  const manquants = R.filter(r=>r.statut.includes('MANQUANTE')).length;

  document.getElementById('qa-kpi').innerHTML = [
    tuile({k:'CONTRÔLES AU VERT', v:F(ok)+' / '+F(R.length), cls:'good',
           d:'invariants structurels vérifiés à chaque extraction'}),
    tuile({k:'ÉCARTS CONNUS ET EXPLIQUÉS', v:F(connus), cls:'warn',
           d:'documentés, stables, non bloquants'}),
    tuile({k:'DONNÉES MANQUANTES', v:F(manquants), cls:manquants?'crit':'good',
           d:'limitent ce que le tableau de bord peut affirmer'}),
    tuile({k:'PÉRIODE COUVERTE',
           v:F(new Set(DATA.resultat_jour.map(r=>r.d)).size), u:'nuits',
           d:dateLabel(DATA.meta.periode_debut)+' → '+dateLabel(DATA.meta.periode_fin)}),
  ].join('');

  const cls = s => s==='OK' ? 'good'
    : (s.includes('MANQUANTE') ? 'crit' : (s.includes('ECARTEE') ? 'serious' : 'warn'));
  document.getElementById('qa-recon').innerHTML = tableHTML(
    [{t:'Contrôle'},{t:'Règle'},{t:'Attendu',num:true},{t:'Obtenu',num:true},
     {t:'Écart',num:true},{t:'Statut'},{t:'Lecture'}],
    R.map(r=>[
      `<span class="strong">${r.controle}</span>`, r.regle,
      r.attendu!==null?F(r.attendu):'—', r.obtenu!==null?F(r.obtenu):'—',
      (r.attendu!==null&&r.obtenu!==null)?F(r.obtenu-r.attendu):'—',
      pill(r.statut, cls(r.statut)),
      `<span style="color:var(--ink-faint);font-size:11.5px">${r.explication}</span>`]));

  const limites = [
    ["Aucun identifiant de ticket dans le journal de vente",
     "Le nombre de tickets et le ticket moyen ne peuvent pas être calculés au jour. Seul le total POS de la période est disponible : "+F(DATA.totaux_pos.nb_panier)+" paniers, panier moyen "+F(DATA.totaux_pos.panier_moyen)+" F.", 'crit'],
    ["Le rapport des règlements n'a pas de date",
     "La répartition espèces / mobile / crédit ne peut pas être suivie dans le temps. Impossible de mesurer si le mobile money progresse.", 'crit'],
    ["Aucun comptage physique d'inventaire",
     "Démarque, rotation et valorisation certifiée du stock sont hors de portée. Le stock théorique et les seuils d'alerte restent exploitables.", 'crit'],
    ["Les coûts de recette ne couvrent qu'une partie du catalogue",
     "La marge théorique ne porte que sur les produits chiffrés. Elle éclaire l'écart avec la marge réelle, elle ne le remplace pas.", 'warn'],
    ["Le rapport par utilisateur est partiel et sans date",
     "La performance des caissiers se compare entre caissiers, elle ne se rapproche pas du CA total.", 'warn'],
    ["Aucune donnée de ressources humaines",
     "Masse salariale, productivité horaire et coût par couvert ne peuvent pas être calculés. Le résultat net affiché est donc avant charges de personnel.", 'crit'],
    ["Le Journal CAF est écarté de la chaîne",
     "Rupture de collecte côté POS depuis octobre 2024 : il sous-évalue la remise de 90 à 99 %. C'est une anomalie de l'éditeur, à lui signaler.", 'serious'],
  ];
  document.getElementById('qa-limites').innerHTML = limites.map(([t,d,c])=>
    `<div style="padding:11px 0;border-bottom:1px solid var(--line-soft)">
      <div style="margin-bottom:4px">${pill(c==='crit'?'BLOQUANT':(c==='serious'?'À SIGNALER':'PARTIEL'), c)}</div>
      <div style="color:var(--ink);font-weight:500;font-size:12.5px">${t}</div>
      <div style="color:var(--ink-faint);font-size:11.5px;margin-top:3px;line-height:1.55">${d}</div>
    </div>`).join('') + (DATA.alertes_qualite.length ? `<div class="foot" style="margin-top:12px">
      <strong>Alertes remontées par la dernière extraction :</strong><br>
      ${DATA.alertes_qualite.map(a=>'• '+a).join('<br>')}</div>` : '');

  const regles = [
    ["Journée d'exploitation de 14h00 à 13h59",
     "Seul point de coupure qui ne scinde aucune soirée. Vérifié sur les 219 696 lignes du journal de vente : aucune ligne coupée."],
    ["Source de vérité de la remise : la Balance par catégorie",
     "Le Journal CAF est exclu. Les deux rapports POS divergeaient de l'ecart de remise F ; le Journal CAF est celui dont la collecte est rompue."],
    ["CA brut et CA net plutôt que TTC et HT",
     "Le sens de TTC et HT s'inverse d'un rapport POS à l'autre : TTC est le brut dans la Balance par catégorie, HT est le brut dans le Journal CAF. Les nommer brut et net supprime l'ambiguïté."],
    ["Achats rattachés directement à leur activité",
     "DRINK = DRINK + MIAMI 228 + PICASSO + GLACONS · EAT = EAT + GAZ · SMOKE = SMOKE. Aucune clé de répartition n'intervient sur les achats."],
    ["Charges et investissements ventilés au prorata du CA net du jour",
     "Ces postes ne sont pas rattachables à une activité. La ventilation quotidienne rend le montant additif, donc juste sous n'importe quel filtre de période."],
    ["Marge brute calculée sur l'union des jours de vente et des jours d'achat",
     "Une jointure partant des seules ventes perdait les achats des jours sans vente — environ 0,12 % de la marge brute. Bug réel, détecté et corrigé."],
    ["Le poste CAISSE est exclu, le poste MONNAIE est inclus",
     "Tous deux sont des fonds de caisse. MONNAIE est maintenu en charges à la demande de l'établissement ; son impact sur le résultat est de l'ordre de 0,1 %."],
    ["Aucun ratio n'est pré-calculé dans les données",
     "Un taux stocké au grain mensuel donne, une fois filtré sur dix jours, la moyenne des taux mensuels et non le taux des dix jours. Tous les pourcentages sont recalculés en somme ÷ somme."],
  ];
  document.getElementById('qa-regles').innerHTML = regles.map(([t,d])=>
    `<div style="padding:11px 0;border-bottom:1px solid var(--line-soft)">
      <div style="color:var(--ink);font-weight:500;font-size:12.5px">${t}</div>
      <div style="color:var(--ink-faint);font-size:11.5px;margin-top:3px;line-height:1.55">${d}</div>
    </div>`).join('');

  const vol = [
    ['Journal de vente détaillé', F(219696)+' lignes', 'grain article, horodaté',
     'CA net, quantités, remises, profil horaire'],
    ['Balance par catégorie', F(DATA.resultat_jour.length)+' lignes jour × activité',
     'grain jour × catégorie', 'source de vérité brut / remise / net'],
    ['Détail des dépenses', F(DATA.depenses_jour.length)+' lignes', 'saisie manuelle quotidienne',
     'achats, charges, investissements'],
    ['Articles offerts', F(DATA.offerts_jour.length)+' lignes', 'grain jour × caissier × catégorie',
     "valeur de l'effort commercial"],
    ['Coûts de revient', F(DATA.couts_articles.length)+' produits appariés', 'fiches techniques',
     'marge théorique par recette'],
    ['Inventaire', F(DATA.inventaire.length)+' articles', 'export ponctuel',
     "stock théorique et seuils d'alerte"],
    ['Balance par règlement', F(DATA.reglements.length)+' moyens', 'cumul sans date',
     'répartition des encaissements'],
    ['Panier moyen horaire', F(DATA.panier_horaire.length)+' tranches', 'cumul sans date',
     'profil de référence du panier'],
    ['Balance par utilisateur', F(DATA.caissiers.length)+' caissiers', 'cumul sans date, partiel',
     'comparaison entre caissiers'],
    ['CA global POS', '1 bloc de totaux', 'cumul sans date',
     'nombre de paniers et panier moyen'],
  ];
  document.getElementById('qa-sources').innerHTML = tableHTML(
    [{t:'Source POS'},{t:'Volumétrie'},{t:'Granularité'},{t:'Ce qu’elle alimente'}],
    vol.map(v=>[`<span class="strong">${v[0]}</span>`, v[1], v[2],
      `<span style="color:var(--ink-faint)">${v[3]}</span>`]));
};
