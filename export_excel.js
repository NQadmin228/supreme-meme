/* =====================================================================
   TABOO — Export des tableaux vers Excel
   ---------------------------------------------------------------------
   Produit un vrai fichier .xlsx, sans aucune bibliotheque externe.

   POURQUOI PAS UN CSV
   -------------------
   Un CSV impose de deviner la locale du lecteur. L'Excel francais veut
   le point-virgule comme separateur, la virgule comme decimale, et un
   BOM UTF-8 sans lequel les accents deviennent illisibles. Les memes
   reglages cassent sur un Excel anglais ou dans Google Sheets. On ne
   sait pas quelle locale a le destinataire : le .xlsx, lui, porte ses
   types et ne se negocie pas.

   POURQUOI PAS UNE BIBLIOTHEQUE
   -----------------------------
   Un .xlsx est une archive ZIP contenant du XML. L'ecrire a la main
   coute une centaine de lignes ; charger SheetJS coute plusieurs
   centaines de kilo-octets depuis un CDN, et ajoute une dependance
   externe a un tableau de bord qu'on vient justement d'alleger.

   LES NOMBRES SONT DES NOMBRES
   ----------------------------
   Le point essentiel. Exporter « 1 234 567 890 » comme texte donne un
   classeur ou rien ne se somme ni ne se trie. Les cellules qui
   ressemblent a un nombre francais sont donc reconverties en valeur
   numerique, et les pourcentages en fraction avec un format de cellule
   -- 50,5 % devient 0,505 affiche « 50,5 % », donc utilisable dans une
   formule.
   ===================================================================== */

/* ---------- ZIP minimal, methode « stored » (sans compression) ----------
   Un tableau exporte pese quelques dizaines de kilo-octets : compresser
   n'apporterait rien et demanderait une implementation de deflate. */

const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(octets) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < octets.length; i++) {
    c = TABLE_CRC[(c ^ octets[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zip(fichiers) {
  const enc = new TextEncoder();
  const entrees = fichiers.map(f => ({
    nom: enc.encode(f.nom),
    donnees: enc.encode(f.contenu),
  }));

  const morceaux = [];
  const central = [];
  let decalage = 0;

  // Horodatage MS-DOS fige : la date de creation d'un export n'a aucune
  // valeur metier, et une valeur fixe rend le fichier reproductible.
  const heureDos = 0, dateDos = (2026 - 1980) << 9 | (1 << 5) | 1;

  for (const e of entrees) {
    const crc = crc32(e.donnees);
    const enTete = new DataView(new ArrayBuffer(30));
    enTete.setUint32(0, 0x04034b50, true);   // signature locale
    enTete.setUint16(4, 20, true);           // version minimale
    enTete.setUint16(6, 0, true);            // indicateurs
    enTete.setUint16(8, 0, true);            // methode : stored
    enTete.setUint16(10, heureDos, true);
    enTete.setUint16(12, dateDos, true);
    enTete.setUint32(14, crc, true);
    enTete.setUint32(18, e.donnees.length, true);
    enTete.setUint32(22, e.donnees.length, true);
    enTete.setUint16(26, e.nom.length, true);
    enTete.setUint16(28, 0, true);
    morceaux.push(new Uint8Array(enTete.buffer), e.nom, e.donnees);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);       // signature centrale
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, heureDos, true);
    cd.setUint16(14, dateDos, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, e.donnees.length, true);
    cd.setUint32(24, e.donnees.length, true);
    cd.setUint16(28, e.nom.length, true);
    cd.setUint32(42, decalage, true);
    central.push(new Uint8Array(cd.buffer), e.nom);

    decalage += 30 + e.nom.length + e.donnees.length;
  }

  const tailleCentral = central.reduce((a, b) => a + b.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, entrees.length, true);
  fin.setUint16(10, entrees.length, true);
  fin.setUint32(12, tailleCentral, true);
  fin.setUint32(16, decalage, true);

  const tout = [...morceaux, ...central, new Uint8Array(fin.buffer)];
  const total = tout.reduce((a, b) => a + b.length, 0);
  const sortie = new Uint8Array(total);
  let p = 0;
  for (const m of tout) { sortie.set(m, p); p += m.length; }
  return sortie;
}

/* ---------- Lecture d'une cellule affichee ---------- */

const ESPACES = /[\s   ]/g;

/* Reconnait un nombre ecrit a la francaise. Volontairement strict : un
   libelle comme « MIAMI 228 » ou « BARON D'ARIGNAC » ne doit jamais etre
   pris pour un nombre, sans quoi l'export deformerait des noms. */
function lireNombre(texte) {
  const brut = texte.replace(ESPACES, '');
  const pourcent = brut.endsWith('%');
  const net = brut.replace(/%$/, '').replace(/F$/, '');
  if (!/^-?\d+(,\d+)?$/.test(net)) return null;
  const valeur = parseFloat(net.replace(',', '.'));
  if (!isFinite(valeur)) return null;
  // Un pourcentage devient une fraction : Excel l'affiche « 50,5 % » via
  // le format, et il reste utilisable dans un calcul.
  return {valeur: pourcent ? valeur / 100 : valeur, pourcent};
}

const echapperXml = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function colonneExcel(i) {
  let n = i + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = ((n - r) / 26) | 0; }
  return s;
}

/* ---------- Construction du classeur ---------- */

function construireXlsx(entetes, lignes, titreFeuille) {
  const rangs = [];

  const cellules = (valeurs, rang, entete) => valeurs.map((v, i) => {
    const ref = colonneExcel(i) + rang;
    if (entete) {
      return `<c r="${ref}" s="1" t="inlineStr"><is><t>${echapperXml(v)}</t></is></c>`;
    }
    const n = lireNombre(v);
    if (n) {
      const style = n.pourcent ? 3 : 2;
      return `<c r="${ref}" s="${style}"><v>${n.valeur}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr"><is><t>${echapperXml(v)}</t></is></c>`;
  }).join('');

  rangs.push(`<row r="1">${cellules(entetes, 1, true)}</row>`);
  lignes.forEach((l, i) => {
    rangs.push(`<row r="${i + 2}">${cellules(l, i + 2, false)}</row>`);
  });

  // Largeurs : la premiere colonne porte les libelles, les suivantes des
  // nombres. Sans cela Excel affiche des colonnes de 8 caracteres et le
  // lecteur doit toutes les elargir a la main.
  const cols = entetes.map((_, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${i === 0 ? 34 : 16}" customWidth="1"/>`
  ).join('');

  const feuille = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols>${cols}</cols>
<sheetData>${rangs.join('')}</sheetData>
</worksheet>`;

  // Styles : 0 normal, 1 entete en gras sur fond de marque, 2 nombre
  // avec separateur de milliers, 3 pourcentage a une decimale.
  /* La couleur du bandeau d'en-tete suit l'etablissement.
     Elle etait figee sur le bleu de TABOO, ecrit dans ce fichier
     avant qu'AMNESIA existe : un export d'AMNESIA sortait donc aux
     couleurs de l'autre etablissement.

     L'encre, elle, n'est pas choisie mais CALCULEE. Le blanc convenait
     sur le bleu profond de TABOO ; sur l'or d'AMNESIA il donne 1,7:1,
     c'est-a-dire illisible. On garde donc celle des deux -- blanc ou
     noir -- qui contraste le plus avec le fond reel. */
  const marque = (CSSVAR('--brand') || '#004F5E').trim();
  const rvb = /^#([0-9a-f]{6})$/i.test(marque)
    ? marque.slice(1).toUpperCase() : '004F5E';
  const canal = i => {
    const v = parseInt(rvb.slice(i * 2, i * 2 + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
  const encre = (1.05 / (luminance + 0.05)) >= ((luminance + 0.05) / 0.05)
    ? 'FFFFFFFF' : 'FF000000';

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2">
<numFmt numFmtId="164" formatCode="#,##0"/>
<numFmt numFmtId="165" formatCode="0.0%"/>
</numFmts>
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="${encre}"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF${rvb}"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const nomFeuille = echapperXml(titreFeuille.slice(0, 31).replace(/[\\\/\?\*\[\]:]/g, ' '));

  return zip([
    {nom: '[Content_Types].xml', contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`},
    {nom: '_rels/.rels', contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`},
    {nom: 'xl/workbook.xml', contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${nomFeuille}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`},
    {nom: 'xl/_rels/workbook.xml.rels', contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`},
    {nom: 'xl/styles.xml', contenu: styles},
    {nom: 'xl/worksheets/sheet1.xml', contenu: feuille},
  ]);
}

/* ---------- Lecture du tableau affiche ---------- */

function lireTableau(table) {
  const entetes = [...table.querySelectorAll('thead th')]
    .map(th => th.textContent.replace(/[▾▴]/g, '').trim());
  // Seules les lignes VISIBLES sont exportees : si un filtre est actif,
  // le lecteur s'attend a retrouver ce qu'il a sous les yeux.
  const lignes = [...table.querySelectorAll('tbody tr')]
    .filter(tr => !tr.hidden)
    .map(tr => [...tr.cells].map(td => td.textContent.trim()));
  return {entetes, lignes};
}

function telecharger(octets, nomFichier) {
  const blob = new Blob([octets], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomFichier;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Liberer l'URL apres le clic : sinon le blob reste en memoire tant
  // que l'onglet est ouvert, et un export repete les accumule.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exporterTableau(table, titre) {
  const {entetes, lignes} = lireTableau(table);
  if (!lignes.length) return false;
  const horodatage = new Date().toISOString().slice(0, 10);
  const propre = t => t.replace(/[^\wÀ-ÿ -]/g, '').trim().replace(/\s+/g, '_');
  /* Le prefixe etait « TABOO_ », ecrit avant qu'AMNESIA existe : un
     export d'AMNESIA arrivait dans le dossier de telechargement sous le
     nom de l'autre etablissement, et deux fichiers de meme sujet
     devenaient impossibles a distinguer. */
  const maison = propre(window.TABOO_NOM || 'TABOO') || 'TABOO';
  telecharger(construireXlsx(entetes, lignes, titre),
              `${maison}_${propre(titre)}_${horodatage}.xlsx`);
  return true;
}

/* ---------- Pose des boutons ----------
   Applique apres chaque rendu a tout tableau d'au moins quatre lignes :
   en dessous, un bouton d'export est plus encombrant qu'utile. */
function ajouterExports(){
  const page = document.querySelector('.page.active');
  if (!page) return;
  /* Les boutons existants sont retires AVANT d'etre reposes. Sans cela
     ils s'accumulent : tableHTML() remplace le tableau -- le nouveau
     n'a plus la marque et recoit son bouton -- mais la carte qui porte
     l'ancien bouton, elle, n'est pas remplacee. */
  page.querySelectorAll('.export-xlsx').forEach(b => {
    const barre = b.closest('.barre-export');
    if (barre) barre.remove(); else b.remove();
  });

  page.querySelectorAll('table').forEach(table => {
    // Seuil bas et constant : un bouton qui apparait sur une page et pas
    // sur la suivante se cherche, donc se trouve mal.
    const corps = table.querySelectorAll('tbody tr').length;
    if (corps < 2) return;

    const carte = table.closest('.card') || table.parentElement;
    const titreEl = carte ? carte.querySelector('h3') : null;
    const titre = titreEl ? titreEl.textContent.trim() : 'Tableau';

    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'mini export-xlsx';
    bouton.textContent = 'Exporter vers Excel';
    bouton.title = `Télécharge « ${titre} » au format .xlsx`;
    bouton.addEventListener('click', () => {
      const ok = exporterTableau(table, titre);
      bouton.textContent = ok ? 'Fichier téléchargé' : 'Tableau vide';
      setTimeout(() => { bouton.textContent = 'Exporter vers Excel'; }, 2200);
    });

    // A cote du filtre quand il y en a un, sinon dans l'en-tete de la
    // carte, sinon juste au-dessus du tableau.
    const filtre = carte && carte.querySelector('.filtre-tbl');
    const enTete = carte && carte.querySelector('.card-head');
    if (filtre) filtre.appendChild(bouton);
    else if (enTete) enTete.appendChild(bouton);
    else {
      const barre = document.createElement('div');
      barre.className = 'barre-export';
      barre.appendChild(bouton);
      (table.closest('.tbl, .scroll-y') || table).before(barre);
    }
  });
}
