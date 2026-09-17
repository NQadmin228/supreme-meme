/* =====================================================================
   TABOO — Chargement du socle
   ---------------------------------------------------------------------
   La coquille ne contient aucune donnée. Ce script récupère le socle,
   puis appelle demarrer(). Les jeux lourds arrivent ensuite page par
   page, via assurerJeux() dans la coquille.

   POURQUOI UN SOCLE ET DES MORCEAUX
   ---------------------------------
   Mesure sur ce jeu de données : 90 % du poids sert une seule page
   chacun. Tout charger d'emblée, c'est faire attendre le lecteur pour
   des écrans qu'il n'ouvrira peut-être jamais. Le premier affichage
   passe de 5,8 Mo à environ 660 Ko.

   La page d'accueil ne déclenche aucun téléchargement supplémentaire :
   les deux chiffres qu'elle puisait dans les gros jeux — part de la
   nuit, valeur offerte — sont pré-agrégés au grain jour dans le socle.
   ===================================================================== */

const CONFIG = {
  // Dossier des données. Vide = relatif à la page.
  base: (window.TABOO_DONNEES || 'donnees').replace(/\/+$/, ''),
  // Trois essais espacés suffisent sur un réseau instable ; au-delà
  // c'est une panne réelle, et il faut le dire plutôt que de boucler.
  tentatives: 3,
  delai: 1200,
};

const attendre = ms => new Promise(r => setTimeout(r, ms));

/* Écrit dans le calque d'état, JAMAIS dans #content : celui-ci contient
   les sections de pages, et les remplacer par un message de chargement
   les supprimerait définitivement. */
function ecran(html) {
  const calque = document.getElementById('ecran-etat');
  const contenu = document.getElementById('content');
  if (calque) calque.innerHTML = html;
  if (contenu) contenu.style.visibility = 'hidden';
}

function masquerEcran() {
  const calque = document.getElementById('ecran-etat');
  const contenu = document.getElementById('content');
  if (calque) calque.innerHTML = '';
  if (contenu) contenu.style.visibility = '';
}

function ecranChargement(etape) {
  const filtres = document.getElementById('filters');
  if (filtres) filtres.classList.add('off');
  ecran(`
    <div style="display:flex;align-items:center;justify-content:center;
                min-height:60vh;flex-direction:column;gap:16px;text-align:center">
      <div style="width:34px;height:34px;border:2px solid var(--line);
                  border-top-color:var(--accent);border-radius:50%;
                  animation:tourne .8s linear infinite"></div>
      <div style="color:var(--ink-dim);font-size:13.5px">${etape}</div>
    </div>`);
}

function ecranErreur(detail, technique) {
  // Un écran d'erreur doit dire ce qui ne marche pas ET ce que le
  // lecteur peut faire. « Une erreur est survenue » n'aide personne.
  ecran(`
    <div class="note crit" style="max-width:760px;margin:48px auto">
      <div class="note-title">Les données du tableau de bord ne sont pas accessibles</div>
      ${detail}
      <div style="margin-top:14px">
        <button class="btn primary" onclick="location.reload()">Réessayer</button>
      </div>
      ${technique ? `<div class="foot" style="margin-top:14px">
        Détail technique : <code>${technique}</code></div>` : ''}
    </div>`);
}

/* Un écran d'INFORMATION, distinct de l'écran d'erreur.

   Une page en cours de construction n'est pas une panne : l'annoncer
   sous le titre « les données ne sont pas accessibles », avec un bouton
   « Réessayer » qui ne changera rien, c'est faire chercher un problème
   à quelqu'un qui n'en a pas. Le ton et les actions proposées doivent
   correspondre à ce qui se passe réellement. */
function ecranInfo(titre, detail, actions) {
  ecran(`
    <div class="note" style="max-width:760px;margin:48px auto">
      <div class="note-title">${titre}</div>
      ${detail}
      ${actions ? `<div style="margin-top:16px">${actions}</div>` : ''}
    </div>`);
}

async function recuperer(url, description) {
  let derniere;
  for (let essai = 1; essai <= CONFIG.tentatives; essai++) {
    try {
      const rep = await fetch(url, {cache: 'default'});
      if (!rep.ok) throw new Error(`HTTP ${rep.status} ${rep.statusText}`);
      return await rep.json();
    } catch (err) {
      derniere = err;
      if (essai < CONFIG.tentatives) {
        ecranChargement(`${description} — nouvelle tentative (${essai + 1}/${CONFIG.tentatives})…`);
        await attendre(CONFIG.delai * essai);
      }
    }
  }
  throw derniere;
}

/* Quel établissement affiche-t-on ?

   Plus de devinette : chaque coquille est assemblée POUR un
   établissement et le déclare dans window.TABOO_ETABLISSEMENT. TABOO et
   AMNESIA n'ont ni les mêmes pages ni les mêmes fonctions de rendu — une
   coquille unique porterait les deux jeux pour n'en afficher qu'un.

   Il reste à vérifier que la personne y a droit. La liste vient de
   /api/session, donc du cookie signé : exactement celle que le
   middleware appliquera aux fichiers de données. En déduire une autre
   ici ferait afficher une page qui échouerait ensuite en 403.

   Le middleware refuse déjà cette coquille à qui n'y a pas droit ; ce
   contrôle-ci sert au cas où elle arrive d'un cache, et surtout à
   proposer les établissements réellement ouverts plutôt qu'un refus sec.
*/
async function resoudreEtablissement() {
  const code = window.TABOO_ETABLISSEMENT;

  let moi = null;
  try {
    const r = await fetch('/api/session', {credentials: 'same-origin'});
    if (r.ok) moi = await r.json();
  } catch { /* hors ligne : on retombe sur le comportement par défaut */ }

  const ouverts = (moi && Array.isArray(moi.etablissements))
    ? moi.etablissements : [];

  if (!ouverts.some(e => e.code === code)) {
    const nom = (window.TABOO_NOM || code || 'cet établissement');
    ecranInfo(
      ouverts.length
        ? `Vous n'avez pas accès à ${nom}`
        : `Aucun établissement ne vous est ouvert`,
      ouverts.length
        ? `L'accès se donne établissement par établissement. Voici ceux
           qui vous sont ouverts :`
        : `L'accès se donne établissement par établissement :
           demandez-le à l'administration du tableau de bord.`,
      ouverts.map(e =>
        `<a href="${e.chemin || '/'}"><button class="btn primary"
           style="margin-right:8px">${e.nom}</button></a>`).join(''));
    return null;
  }

  CONFIG.base = `donnees/${code}`;
  window.TABOO_ETABLISSEMENTS = ouverts;

  /* Le chargement paresseux des jeux lourds, dans le gabarit, lit
     window.TABOO_DONNEES. On le pose ici plutot que de lui faire
     recalculer le dossier : une seule regle, un seul endroit. */
  window.TABOO_DONNEES = CONFIG.base;

  /* Le coin du compte, dans le gabarit, construit les onglets
     d'établissement en parallèle de ce chargement — les deux
     interrogent le réseau et rien ne dit lequel finit le premier. Cet
     événement lui dit lequel marquer, qu'il ait déjà fini ou non. */
  document.dispatchEvent(new CustomEvent('etablissement-choisi',
                                         {detail: {code}}));
  return code;
}

async function charger() {
  const t0 = performance.now();
  try {
    ecranChargement('Chargement du tableau de bord…');
    if (!await resoudreEtablissement()) return;
    const socle = await recuperer(`${CONFIG.base}/socle.json`, 'Chargement');

    if (!socle || !socle.meta || !socle.resultat_jour) {
      throw new Error('socle incomplet : meta ou resultat_jour absent');
    }

    DATA = socle;
    masquerEcran();
    const filtres = document.getElementById('filters');
    if (filtres) filtres.classList.remove('off');

    const ms = Math.round(performance.now() - t0);
    console.info(`Socle chargé en ${ms} ms — ${DATA.resultat_jour.length} lignes, `
      + `période ${DATA.meta.periode_debut} → ${DATA.meta.periode_fin}. `
      + `Jeux différés : ${(DATA.morceaux || []).join(', ')}`);

    demarrer();
    afficherProvenance();
  } catch (err) {
    console.error('Chargement impossible', err);
    ecranErreur(
      `Le tableau de bord n'a pas pu récupérer ses données après
       ${CONFIG.tentatives} tentatives. La mise en page fonctionne : c'est
       l'accès au fichier de données qui échoue.
       <br><br>Les causes les plus fréquentes, dans l'ordre : une coupure
       réseau de votre côté, ou une publication en cours côté serveur — dans
       ce cas réessayer dans une minute suffit.`,
      err && err.message ? err.message : String(err));
  }
}

/* Provenance et fraîcheur, à l'écran plutôt que dans un document annexe :
   « de quand datent ces chiffres ? » est la première question posée en
   réunion. */
function afficherProvenance() {
  const m = DATA.meta || {};
  document.getElementById('content').insertAdjacentHTML('beforeend', `
    <div class="foot" id="provenance" style="margin-top:36px;padding-top:16px;
         border-top:1px solid var(--line)">
      Période ${dateLabel(m.periode_debut)} → ${dateLabel(m.periode_fin)}
      (${F(m.jours_exploitation || 0)} nuits) · données extraites le
      ${m.genere_le || 'date inconnue'}
    </div>`);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', charger);
} else {
  charger();
}
