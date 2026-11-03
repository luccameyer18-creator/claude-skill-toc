#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""toc: lê e confere entregas que não são página web: docx, pptx, xlsx, csv, pdf, md, txt.

  python -I doc.py extrair ARQUIVO PASTA_SAIDA [--opcoes JSON]   grava PASTA_SAIDA/doc.json (blocos de texto, achados, folhas)
  python -I doc.py ortografia BLOCOS.json                        corretor do Word sobre {blocos, idioma, palavrasOk}; imprime JSON
  python -I doc.py recalcular ARQUIVO.xlsx                       abre no Excel, calcula e salva (grava o valor das fórmulas)

Exige Python 3 com python-docx, python-pptx, openpyxl, pymupdf e pillow; Word e Excel instalados para corretor, páginas e
cálculo (sem eles essas partes avisam e seguem). Não abre o PowerPoint."""
import sys, os, re, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from doc_base import *


def _limpa_md(t):
    t = re.sub(r'`[^`]*`', ' ', t)
    t = re.sub(r'!\[[^\]]*\]\([^)]*\)', ' ', t)
    t = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', t)
    return re.sub(r'\*\*|\*|~~', '', t).strip()


def ler_md(ctx, caminho):
    texto = Path(caminho).read_text(encoding='utf-8', errors='replace')
    ctx.info['tipo'] = 'md'
    linhas = texto.splitlines()
    ini = 0
    if linhas and linhas[0].strip() == '---':
        fim = next((i for i in range(1, len(linhas)) if linhas[i].strip() == '---'), None)
        ini = (fim + 1) if fim else 0
    base = Path(caminho).parent
    em_codigo, cerca, par, par_ini, grupo, ant_lista = False, None, [], 0, 0, False
    ult, n_h1, titulos, tabela = 0, 0, [], []

    def fechar_par():
        nonlocal par
        if par:
            bruto = ' '.join(x.strip() for x in par)
            ctx.B(f'linha {par_ini}', 'corpo' if palavras(_limpa_md(bruto)) >= 4 else 'rotulo', _limpa_md(bruto), negrito=len(re.findall(r'\*\*[^*\n]{1,60}\*\*', bruto)))
            par = []

    def fechar_tabela():
        nonlocal tabela
        if len(tabela) >= 2:
            n = [len([c for c in l.strip().strip('|').split('|')]) for l in tabela[1][1:2]] + [len(l.strip().strip('|').split('|')) for _, l in tabela[2:]]
            cab = len(tabela[0][1].strip().strip('|').split('|'))
            for (i, l), k in zip(tabela[1:], n):
                if k != cab: ctx.A('tabela-quebrada', 'corrigir', f'linha {i}', f'a linha da tabela tem {k} colunas e o cabeçalho {cab}'); break
        tabela = []

    for i, l in enumerate(linhas, 1):
        if i <= ini: continue
        if re.match(r'^\s*(```|~~~)', l):
            fechar_par(); fechar_tabela()
            if not em_codigo: em_codigo, cerca = True, (i, l.strip()[:3])
            elif l.strip().startswith(cerca[1]): em_codigo = False
            continue
        if em_codigo: continue
        for m in re.finditer(r'(!?)\[([^\]]*)\]\(([^)\s]*)[^)]*\)', l):
            url = m.group(3)
            if url in ('', '#') or re.fullmatch(r'(?i)url|link|todo|xxx', url): ctx.A('link-vazio', 'corrigir', f'linha {i}', f'link "{m.group(2)[:30]}" sem destino')
            elif not re.match(r'(?i)^(https?:|mailto:|tel:|#|data:)', url) and not (base / url.split('#')[0].split('?')[0]).exists():
                ctx.A('link-quebrado', 'corrigir', f'linha {i}', f'o arquivo "{url}" não existe ao lado deste')
            if not m.group(1) and re.fullmatch(r'(?i)aqui|clique aqui|here|link', m.group(2).strip()): ctx.A('link-sem-sentido', 'nota', f'linha {i}', f'o texto do link é "{m.group(2)}": diga para onde ele leva')
        if l.lstrip().startswith('|'):
            fechar_par(); tabela.append((i, l)); continue
        elif tabela: fechar_tabela()
        m = re.match(r'^(#{1,6})\s+(.*?)\s*#*\s*$', l)
        if m:
            fechar_par(); ant_lista = False
            nivel = len(m.group(1)); n_h1 += nivel == 1
            if ult and nivel > ult + 1: ctx.A('titulo-pulou-nivel', 'corrigir', f'linha {i}', f'título {nivel} logo depois de um título {ult}: não pule nível')
            ult = nivel; t = _limpa_md(m.group(2)); titulos.append(t)
            ctx.B(f'linha {i}', 'titulo', t, nivel=nivel)
            continue
        m = re.match(r'^\s*(?:[-*+]|\d+[.)])\s+(.*)$', l)
        if m:
            fechar_par()
            if not ant_lista: grupo += 1
            ant_lista = True
            ctx.B(f'linha {i}', 'lista', _limpa_md(m.group(1)), grupo=grupo)
            continue
        if not l.strip():
            fechar_par(); ant_lista = False; continue
        if not par: par_ini = i
        par.append(l); ant_lista = False
    fechar_par(); fechar_tabela()
    if em_codigo: ctx.A('bloco-de-codigo-aberto', 'bloqueia', f'linha {cerca[0]}', 'bloco de código aberto e nunca fechado: o resto do documento vira código')
    if n_h1 > 1: ctx.A('varios-h1', 'nota', '', f'{n_h1} títulos de nível 1 (o normal é um por documento)')
    ctx.info['titulos'] = titulos
    if sum(1 for l in linhas if l != l.rstrip() and l.strip()) > 10: ctx.A('espacos-no-fim', 'nota', '', 'mais de 10 linhas com espaço sobrando no fim')


def ler_txt(ctx, caminho):
    raw = Path(caminho).read_bytes()
    ctx.info['tipo'] = 'txt'
    try: t = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        t = raw.decode('cp1252', 'replace'); ctx.A('codificacao', 'corrigir', '', 'o arquivo não está em UTF-8: acentos quebram em outros programas')
    if re.search(r'Ã[£¡©§³ªº]', t): ctx.A('texto-corrompido', 'corrigir', '', 'acentos corrompidos (ex.: "Ã©" no lugar de "é")')
    for i, p in enumerate(re.split(r'\n\s*\n', t), 1):
        p = ' '.join(x.strip() for x in p.splitlines())
        ctx.B(f'bloco {i}', 'corpo' if palavras(p) >= 4 else 'rotulo', p)


def ler_pdf_arquivo(ctx, caminho):
    import pymupdf
    ctx.info['tipo'] = 'pdf'
    analisar_pdf(ctx, caminho, [], blocos=True)
    meta = pymupdf.open(str(caminho)).metadata or {}
    for k in ('title', 'author', 'creator', 'producer', 'subject'):
        v = meta.get(k) or ''
        if v and SUSPEITOS_META.search(v): ctx.A('metadados', 'corrigir', '', f'propriedade "{k}" do PDF diz "{v[:50]}": sobra de ferramenta')
    if not (meta.get('title') or '').strip(): ctx.A('metadados', 'nota', '', 'o PDF não tem título nas propriedades (aparece o nome do arquivo na aba do leitor)')


def extrair(arq, saida, opc):
    ctx = Ctx(opc, saida)
    ext = Path(arq).suffix.lower()
    render = opc.get('render', True)
    if ext == '.docx':
        from doc_docx import ler_docx, render_docx
        tentar(ctx, 'leitura do docx', ler_docx, ctx, arq)
        if render: tentar(ctx, 'páginas do docx', render_docx, ctx, arq)
    elif ext == '.pptx':
        from doc_pptx import ler_pptx, esboco_slides
        r = tentar(ctx, 'leitura do pptx', ler_pptx, ctx, arq)
        if r and render: tentar(ctx, 'esboço dos slides', esboco_slides, ctx, *r)
    elif ext in ('.xlsx', '.xlsm'):
        from doc_xlsx import ler_xlsx, grade_png
        g = tentar(ctx, 'leitura do xlsx', ler_xlsx, ctx, arq)
        if g and render: tentar(ctx, 'imagem das abas', grade_png, ctx, g)
    elif ext == '.csv':
        from doc_xlsx import ler_csv
        tentar(ctx, 'leitura do csv', ler_csv, ctx, arq)
    elif ext == '.pdf': tentar(ctx, 'leitura do pdf', ler_pdf_arquivo, ctx, arq)
    elif ext in ('.md', '.markdown'): tentar(ctx, 'leitura do md', ler_md, ctx, arq)
    elif ext == '.txt': tentar(ctx, 'leitura do txt', ler_txt, ctx, arq)
    else: ctx.aviso(f'tipo de arquivo não suportado: {ext}')
    tentar(ctx, 'ortografia', ortografia, ctx)
    if ctx.paginas_texto:  # põe a página no "onde" de cada bloco e achado
        for b in ctx.blocos:
            pg = pagina_de(ctx, b['texto'])
            if pg and not b['onde'].startswith('p. '): b['onde'] = f'p. {pg}, {b["onde"]}'
    for a in ctx.achados:
        busca = a.pop('_busca', None)
        if busca and not a['onde'].startswith('p. '):
            pg = pagina_de(ctx, busca)
            if pg: a['onde'] = f'p. {pg}, {a["onde"]}'
    ctx.info['palavras'] = sum(palavras(b['texto']) for b in ctx.blocos)
    ctx.fechar()
    out = {'tipo': ctx.info.get('tipo', ext.strip('.')), 'info': ctx.info, 'blocos': ctx.blocos, 'achados': ctx.achados, 'avisos': ctx.avisos, 'folhas': ctx.folhas}
    (ctx.saida / 'doc.json').write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str), encoding='utf-8')
    return out


def main():
    a = sys.argv[1:]
    if not a: print(__doc__); return 2
    if a[0] == 'extrair' and len(a) >= 3:
        opc = json.loads(a[a.index('--opcoes') + 1]) if '--opcoes' in a else {}
        out = extrair(a[1], a[2], opc)
        print(json.dumps({'ok': True, 'achados': len(out['achados']), 'avisos': out['avisos']}, ensure_ascii=False))
        return 0
    if a[0] == 'ortografia' and len(a) >= 2:
        d = json.loads(Path(a[1]).read_text(encoding='utf-8'))
        ctx = Ctx({'idioma': d.get('idioma', 'pt-BR'), 'palavrasOk': d.get('palavrasOk', [])}, Path(a[1]).parent / '_ort')
        ctx.blocos = d['blocos']
        ortografia(ctx); ctx.fechar()
        print(json.dumps({'achados': ctx.achados, 'avisos': ctx.avisos}, ensure_ascii=False))
        return 0
    if a[0] == 'recalcular' and len(a) >= 2:
        from doc_xlsx import recalcular
        recalcular(a[1]); print('calculado e salvo:', a[1]); return 0
    print(__doc__); return 2


if __name__ == '__main__':
    sys.exit(main())
