#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TABOO — Assemblage du dashboard de direction (v2) en un fichier autonome.

  python 20_extraction_v2.py   ->  data_v2.json
  python 21_assembler_v2.py    ->  dashboard_v2.html

Les fichiers _template / _pages / _render ne changent que si l'on modifie la
mise en page ou les calculs, jamais pour de nouvelles donnees.
"""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent

template = (BASE / 'dashboard_v2_template.html').read_text(encoding='utf-8')
pages = (BASE / 'dashboard_v2_pages.html').read_text(encoding='utf-8')
render_js = (BASE / 'dashboard_v2_render.js').read_text(encoding='utf-8')
data_json = (BASE / 'data_v2.json').read_text(encoding='utf-8')

# Le JSON doit etre valide AVANT d'etre embarque : un JSON casse ne se
# manifesterait qu'a l'ouverture, par une page entierement blanche.
donnees = json.loads(data_json)

# 1. Les pages dans le conteneur de contenu.
ancre_contenu = '<div class="content" id="content"></div>'
assert ancre_contenu in template, "conteneur de contenu introuvable dans le template"
html = template.replace(ancre_contenu,
                        f'<div class="content" id="content">\n{pages}\n</div>')

# 2. La logique de rendu juste avant l'initialisation, pour que RENDER soit
#    rempli quand go() est appele.
ancre_init = """/* =====================================================================
   INIT
   ===================================================================== */"""
assert ancre_init in html, "ancre INIT introuvable dans le template"
html = html.replace(ancre_init, render_js + "\n" + ancre_init)

# 3. Les donnees. On neutralise toute sequence "</script" qui, apparaissant
#    dans un nom d'article, fermerait la balise par surprise et casserait
#    la page entiere.
assert '__TABOO_DATA_JSON__' in html, "marqueur de donnees introuvable"
html = html.replace('__TABOO_DATA_JSON__', data_json.replace('</script', '<\\/script'))

sortie = BASE / 'dashboard_v2.html'
sortie.write_text(html, encoding='utf-8')

print(f"dashboard_v2.html : {sortie.stat().st_size/1024/1024:.2f} Mo")
print(f"  periode      : {donnees['meta']['periode_debut']} -> {donnees['meta']['periode_fin']}"
      f"  ({donnees['meta']['jours_exploitation']} nuits)")
print(f"  pages         : {html.count('<section class=\"page\"')}")
print(f"  jeux de donnees : {sum(1 for v in donnees.values() if isinstance(v, list))}")
