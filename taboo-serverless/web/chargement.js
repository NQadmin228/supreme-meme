/* =====================================================================
   TABOO — Chargement de l'instantane
   ---------------------------------------------------------------------
   Le tableau de bord ne contient plus ses donnees : il les recupere
   depuis le CDN au demarrage.

   POURQUOI DEUX REQUETES
   ----------------------
   manifest.json (cache 60 s) designe l'instantane courant, dont le nom
   est versionne et le contenu immuable (cache un an). On obtient ainsi
   les deux proprietes a la fois : une nouvelle publication est visible
   en moins d'une minute, et l'instantane lui-meme n'est jamais
   retelecharge tant qu'il ne change pas.

   Servir directement un instantane a nom fixe imposerait de choisir
   entre les deux : cache court et retelechargement de plusieurs Mo a
   chaque visite, ou cache long et donnees perimees pendant des heures.

   AUCUNE DONNEE D'IDENTIFICATION ICI
   ----------------------------------
   Cette page ne parle jamais a BigQuery. Elle lit un fichier statique.
   Le compte de service reste dans le job de generation et dans l'API de
   detail, cote serveur.
   ===================================================================== */

const CONFIG = {
  // Origine du CDN. Vide = meme origine que la page, ce qui est le cas
  // en production comme en developpement local.
  base: (window.TABOO_BASE || ''),
  manifeste: 'manifest.json',
  // Une tentative peut echouer sur un reseau mobile instable ; trois
  // essais espaces suffisent, au-dela c'est une panne reelle et il faut
  // le dire plutot que de tourner en boucle.
  tentatives: 3,
  delaiEntreTentatives: 1200,
};

const attendre = ms => new Promise(r => setTimeout(r, ms));

/* Ecrit dans le calque d'etat et masque le conteneur de pages.
   Ne JAMAIS ecrire dans #content : il contient les sections de pages, et
   les remplacer par un message de chargement les supprime definitivement.
   C'est le defaut qu'avait la premiere version de ce chargeur. */
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
                  border-top-color:var(--gold);border-radius:50%;
                  animation:tourne .8s linear infinite"></div>
      <div style="color:var(--ink-dim);font-size:13.5px">${etape}</div>
    </div>
    <style>@keyframes tourne{to{transform:rotate(360deg)}}</style>`);
}

function ecranErreur(titre, detail, technique) {
  // Un ecran d'erreur doit dire ce qui ne marche pas ET ce que le
  // lecteur peut faire. « Une erreur est survenue » n'aide personne.
  ecran(`
    <div class="note crit" style="max-width:760px;margin:48px auto">
      <div class="note-title">${titre}</div>
      ${detail}
      <div style="margin-top:14px">
        <button class="btn primary" onclick="location.reload()">Réessayer</button>
      </div>
      ${technique ? `<div class="foot" style="margin-top:14px">
        Détail technique : <code>${technique}</code></div>` : ''}
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
        await attendre(CONFIG.delaiEntreTentatives * essai);
      }
    }
  }
  throw derniere;
}

async function charger() {
  const t0 = performance.now();
  try {
    ecranChargement('Recherche de la dernière publication…');
    const url = (CONFIG.base ? CONFIG.base.replace(/\/$/, '') + '/' : '') + CONFIG.manifeste;
    const manifeste = await recuperer(url, 'Lecture du manifeste');

    if (!manifeste || !manifeste.fichier) {
      throw new Error('manifeste sans champ « fichier »');
    }

    const poids = manifeste.octets_comprimes
      ? ` (${Math.round(manifeste.octets_comprimes / 1024)} Ko)` : '';
    ecranChargement(`Chargement des données${poids}…`);

    const cible = (CONFIG.base ? CONFIG.base.replace(/\/$/, '') + '/' : '') + manifeste.fichier;
    // Brotli est decompresse par le navigateur : GCS renvoie
    // Content-Encoding: br, rien a faire ici.
    const instantane = await recuperer(cible, 'Chargement des données');

    if (!instantane.meta || !instantane.resultat_jour) {
      throw new Error('instantané incomplet : meta ou resultat_jour absent');
    }

    DATA = instantane;
    DATA.manifeste = manifeste;
    masquerEcran();
    const filtres = document.getElementById('filters');
    if (filtres) filtres.classList.remove('off');

    const ms = Math.round(performance.now() - t0);
    console.info(`Instantané ${manifeste.version} chargé en ${ms} ms — `
      + `${DATA.resultat_jour.length} lignes de résultat, `
      + `période ${DATA.meta.periode_debut} → ${DATA.meta.periode_fin}`);

    demarrer();
  } catch (err) {
    console.error('Chargement impossible', err);
    ecranErreur(
      'Les données du tableau de bord ne sont pas accessibles',
      `Le tableau de bord n'a pas pu récupérer l'instantané publié après
       ${CONFIG.tentatives} tentatives. La mise en page fonctionne : c'est
       l'accès au fichier de données qui échoue.
       <br><br>Les causes les plus fréquentes, dans l'ordre : une coupure
       réseau de votre côté, une publication en cours côté serveur — dans ce
       cas réessayer dans une minute suffit —, ou un instantané jamais publié
       si le générateur n'a pas encore tourné.`,
      err && err.message ? err.message : String(err));
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', charger);
} else {
  charger();
}
