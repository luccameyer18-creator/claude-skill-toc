# -*- coding: utf-8 -*-
"""Conferência de .xlsx e .csv: erros de fórmula, número escrito como texto, soma que não pega tudo, colunas estreitas,
formatos inconsistentes. Fórmulas sem valor salvo (arquivo gerado por script) são calculadas numa cópia no Excel."""
import re, zipfile, csv, datetime, unicodedata, shutil
from collections import Counter, defaultdict
from doc_base import *

ERROS = {'#REF!', '#DIV/0!', '#N/A', '#VALUE!', '#NAME?', '#NULL!', '#NUM!'}
COD_ERRO = {-2146826281: '#DIV/0!', -2146826246: '#N/A', -2146826259: '#NAME?', -2146826288: '#NULL!', -2146826252: '#NUM!', -2146826265: '#REF!', -2146826273: '#VALUE!'}
ABA_PADRAO = re.compile(r'(?i)^(sheet|planilha|plan|folha|hoja)\s?\d+$')
SEM_NUM = re.compile(r'(?i)cpf|cnpj|cep|c[óo]digo|codigo|telefone|fone|\bid\b|ean|\brg\b|sku|matr[íi]cula|nota fiscal|\bnf\b|protocolo|contrato|ano')
NUM_TEXTO = re.compile(r'^\s*(?:R\$\s*)?[-+]?\d{1,3}(?:\.\d{3})*(?:,\d+)?\s*%?\s*$|^\s*[-+]?\d+(?:[.,]\d+)?\s*%?\s*$')
DATA_TEXTO = re.compile(r'^\s*(?:\d{1,2}/\d{1,2}/\d{2,4}|\d{4}-\d{2}-\d{2})\s*$')
SOMA = re.compile(r'^=\s*(?:SUM|SOMA|AVERAGE|M[ÉE]DIA|COUNT|MAX|MIN)\(\s*\$?([A-Z]{1,3})\$?(\d+)\s*:\s*\$?([A-Z]{1,3})\$?(\d+)\s*\)\s*$', re.I)
COMUNS = {'0', '1', '2', '12', '100', '1000', '7', '24', '60', '365', '30'}


def _num(v): return isinstance(v, (int, float)) and not isinstance(v, bool)


def _sem_acento(s): return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def _exibido(v, fmt):
    fmt = fmt or 'General'
    if isinstance(v, bool): return 'VERDADEIRO' if v else 'FALSO'
    if isinstance(v, (datetime.datetime, datetime.date)): return '31/12/2026'
    if _num(v):
        casas = 0
        m = re.search(r'0\.(0+)', fmt)
        pct = '%' in fmt
        x = v * 100 if pct else v
        if m: casas = len(m.group(1))
        elif fmt == 'General':
            s = ('%.10g' % x)
            return s.replace('.', ',')
        s = f'{x:,.{casas}f}' if ',' in fmt else f'{x:.{casas}f}'
        s = s.replace(',', '\0').replace('.', ',').replace('\0', '.')
        return ('R$ ' if 'R$' in fmt or '[$R$' in fmt else '') + s + ('%' if pct else '')
    return str(v)


def valores_excel(ctx, caminho):
    """Calcula numa cópia, com o Excel de verdade (instância própria), e devolve {(aba, linha, coluna): valor}."""
    import pythoncom, win32com.client
    pythoncom.CoInitialize()
    copia = ctx.saida / '_copia.xlsx'
    shutil.copyfile(caminho, copia)
    xl = win32com.client.DispatchEx('Excel.Application'); xl.Visible = False; xl.DisplayAlerts = False
    out = {}
    try:
        wb = xl.Workbooks.Open(str(copia.resolve()), UpdateLinks=0, ReadOnly=True)
        xl.CalculateFull()
        for ws in wb.Worksheets:
            ur = ws.UsedRange; v = ur.Value2; r0, c0 = ur.Row, ur.Column
            if not isinstance(v, tuple): v = ((v,),)
            for i, row in enumerate(v):
                for j, val in enumerate(row):
                    if isinstance(val, int) and val in COD_ERRO: out[(ws.Name, r0 + i, c0 + j)] = COD_ERRO[val]
                    elif val is not None: out[(ws.Name, r0 + i, c0 + j)] = val
        wb.Close(False)
    finally:
        try: xl.Quit()
        except Exception: pass
        try: copia.unlink()
        except Exception: pass
    return out


def recalcular(caminho):
    """Abre no Excel, recalcula e salva no próprio arquivo (grava os valores das fórmulas). O Excel pode reformatar detalhes."""
    import pythoncom, win32com.client
    pythoncom.CoInitialize()
    xl = win32com.client.DispatchEx('Excel.Application'); xl.Visible = False; xl.DisplayAlerts = False
    try:
        wb = xl.Workbooks.Open(str(Path(caminho).resolve()), UpdateLinks=0)
        xl.CalculateFull(); wb.Save(); wb.Close(True)
    finally:
        xl.Quit()


def ler_xlsx(ctx, caminho):
    import openpyxl
    from openpyxl.formula.translate import Translator
    from openpyxl.utils import get_column_letter
    wb = openpyxl.load_workbook(caminho)
    wbv = openpyxl.load_workbook(caminho, data_only=True)
    ctx.info.update(tipo='xlsx', abas=len(wb.worksheets), titulos=[w.title for w in wb.worksheets])
    multi = len(wb.worksheets) > 1
    # fórmulas sem valor salvo?
    n_form = sem_cache = 0
    for ws in wb.worksheets:
        wv = wbv[ws.title]
        for row in ws.iter_rows(max_row=min(ws.max_row, 20000), max_col=min(ws.max_column, 100)):
            for c in row:
                if isinstance(c.value, str) and c.value.startswith('='):
                    n_form += 1
                    if wv.cell(c.row, c.column).value is None: sem_cache += 1
    calc = {}
    if n_form and sem_cache > 0:
        ctx.A('formulas-sem-valor', 'corrigir', '', f'{sem_cache} de {n_form} fórmulas sem valor salvo no arquivo (gerado por script): prévia do e-mail, celular, Drive e leitores mostram células vazias até alguém abrir no Excel. Conserto: python doc.py recalcular ARQUIVO (abre no Excel, calcula e salva)')
        try: calc = valores_excel(ctx, caminho)
        except Exception as e: ctx.aviso(f'fórmulas não calculadas no Excel (erros de fórmula não conferidos): {type(e).__name__}: {str(e)[:100]}')

    def valor(ws, wv, c):
        if isinstance(c.value, str) and c.value.startswith('='):
            v = wv.cell(c.row, c.column).value
            return v if v is not None else calc.get((ws.title, c.row, c.column))
        return c.value

    z = zipfile.ZipFile(caminho)
    nomes_z = z.namelist()
    grades = []
    for ws in wb.worksheets:
        wv = wbv[ws.title]
        nome = ws.title
        ctx.B(f'aba "{nome}"', 'rotulo', nome)
        if ABA_PADRAO.match(nome): ctx.A('aba-sem-nome', 'corrigir' if multi else 'nota', f'aba "{nome}"', 'aba com nome padrão do programa: diga o que ela contém')
        if ws.sheet_state != 'visible': ctx.A('aba-oculta', 'corrigir', f'aba "{nome}"', 'aba escondida na entrega: quem recebe não sabe que existe (mostre ou apague)')
        maxr, maxc = min(ws.max_row, 20000), min(ws.max_column, 100)
        grid = [list(r) for r in ws.iter_rows(min_row=1, max_row=maxr, max_col=maxc)]
        if not grid or all(c.value is None for r in grid for c in r): continue
        r0 = next((i for i, r in enumerate(grid) if sum(c.value is not None for c in r) >= 2), None)
        larg = {}
        for k, dim in ws.column_dimensions.items():
            ini = dim.min or openpyxl.utils.column_index_from_string(k); fim = dim.max or ini
            for ci in range(ini, min(fim, maxc) + 1): larg[ci] = (dim.width, dim.hidden)
        padrao_l = ws.sheet_format.defaultColWidth or 8.43

        for ci in range(1, maxc + 1):
            letra = get_column_letter(ci)
            cab = grid[r0][ci - 1].value if r0 is not None else None
            cab_txt = str(cab) if cab is not None else ''
            if cab_txt: ctx.B(f'{nome}!{letra}{r0 + 1}', 'rotulo', cab_txt)
            cel = [grid[i][ci - 1] for i in range((r0 + 1) if r0 is not None else 0, len(grid))]
            vals = [(c, valor(ws, wv, c)) for c in cel if c.value is not None]
            if not vals: continue
            numericos = [(c, v) for c, v in vals if _num(v)]
            textos = [(c, v) for c, v in vals if isinstance(v, str) and not (isinstance(c.value, str) and c.value.startswith('='))]
            for c, v in vals:
                if isinstance(v, str) and v.strip() in ERROS: ctx.A('erro-de-formula', 'bloqueia', f'{nome}!{c.coordinate}', f'a célula mostra {v.strip()} (fórmula: {str(c.value)[:60]})')
                if isinstance(c.value, str) and c.value.startswith('=') and '#REF!' in c.value: ctx.A('referencia-quebrada', 'bloqueia', f'{nome}!{c.coordinate}', f'a fórmula aponta para algo apagado: {c.value[:60]}')
                if isinstance(c.value, str) and c.value.startswith('=') and re.search(r"\[\d+\]|\.xls", c.value): ctx.A('vinculo-externo', 'corrigir', f'{nome}!{c.coordinate}', f'fórmula depende de outro arquivo (quebra em outro computador): {c.value[:60]}')
            if len(vals) >= 5 and not SEM_NUM.search(cab_txt):
                fracao = len(numericos) / len(vals)
                texto_numerico = [(c, v) for c, v in textos if NUM_TEXTO.match(v) and not re.match(r'^\s*0\d', v)]
                if texto_numerico and (fracao >= 0.5 or len(texto_numerico) / len(vals) >= 0.7):
                    c = texto_numerico[0][0]
                    ctx.A('numero-como-texto', 'corrigir', f'{nome}!{c.coordinate}', f'{len(texto_numerico)} valor(es) da coluna "{cab_txt or letra}" são números guardados como texto (ex.: "{str(texto_numerico[0][1])[:20]}"): somas e filtros ignoram; converta para número')
                if fracao >= 0.6:
                    ruins = [(c, v) for c, v in textos if v.strip() not in ('-', '—', 'n/d', 'N/D', 'n/a', 'N/A', '') and not NUM_TEXTO.match(v)]
                    if ruins: ctx.A('tipos-misturados', 'corrigir', f'{nome}!{ruins[0][0].coordinate}', f'a coluna "{cab_txt or letra}" tem {len(numericos)} números e {len(ruins)} texto(s) (ex.: "{str(ruins[0][1])[:25]}")')
            dt = [(c, v) for c, v in textos if DATA_TEXTO.match(v)]
            if len(dt) >= 3 and len(dt) / len(vals) >= 0.5:
                ctx.A('data-como-texto', 'corrigir', f'{nome}!{dt[0][0].coordinate}', f'{len(dt)} datas da coluna "{cab_txt or letra}" são texto (ex.: "{dt[0][1]}"): ordenar e filtrar por data não funciona')
            if len(numericos) >= 3:
                fmts = Counter(c.number_format for c, _ in numericos)
                if len(fmts) > 1: ctx.A('formato-inconsistente', 'corrigir', f'{nome}!{letra}', f'a coluna "{cab_txt or letra}" mistura formatos de número: {", ".join(f"{k} ({n}x)" for k, n in fmts.most_common(4))}')
                cru = [c for c, v in numericos if c.number_format == 'General' and abs(v * 100 - round(v * 100)) > 1e-7 and not float(v).is_integer()]
                if cru: ctx.A('numero-sem-formato', 'corrigir', f'{nome}!{cru[0].coordinate}', f'{len(cru)} número(s) com muitas casas e sem formato (ex.: {numericos[0][1] if not cru else valor(ws, wv, cru[0])}): defina as casas decimais')
                mp = re.search(r'(?i)%|taxa|percent|margem', cab_txt)
                if mp and all(0 <= v <= 1.5 for _, v in numericos) and not any('%' in c.number_format for c, _ in numericos):
                    ctx.A('percentual-sem-formato', 'nota', f'{nome}!{letra}', f'a coluna "{cab_txt}" parece percentual mas está formatada como número (0,15 em vez de 15%)')
                if re.search(r'(?i)R\$|valor|pre[çc]o|custo|receita|total|faturamento', cab_txt) and not any(('R$' in c.number_format or '0.00' in c.number_format or '#,##0' in c.number_format) for c, _ in numericos):
                    ctx.A('moeda-sem-formato', 'nota', f'{nome}!{letra}', f'a coluna "{cab_txt}" parece dinheiro mas não tem formato de moeda ou 2 casas')
            # largura
            wdt, oculta = larg.get(ci, (None, False))
            wdt = wdt or padrao_l
            if oculta: continue
            if wdt > 70: ctx.A('coluna-larguissima', 'nota', f'{nome}!{letra}', f'coluna com largura {round(wdt)}: ocupa a tela sozinha')
            for c, v in vals:
                s = _exibido(v, c.number_format)
                if _num(v) and len(s) + 1 > wdt:
                    ctx.A('coluna-estreita', 'corrigir', f'{nome}!{c.coordinate}', f'o número {s} não cabe na coluna (largura {round(wdt, 1)}): o Excel mostra ####'); break
                if isinstance(v, str) and len(s) > wdt * 1.15 and not (c.alignment and c.alignment.wrap_text):
                    viz = grid[c.row - 1][ci] if ci < maxc else None
                    if viz is not None and viz.value is not None:
                        ctx.A('texto-cortado', 'corrigir', f'{nome}!{c.coordinate}', f'texto de {len(s)} caracteres numa coluna de largura {round(wdt, 1)} com a célula ao lado preenchida: aparece cortado'); break
            # categorias parecidas
            if 2 <= len({v for _, v in textos}) <= 40 and len(textos) >= 6:
                grupos = defaultdict(set)
                for _, v in textos:
                    if palavras(v) <= 4: grupos[_sem_acento(re.sub(r'\s+', ' ', v.strip().lower()))].add(v)
                for k, vs in grupos.items():
                    if len(vs) > 1: ctx.A('categoria-inconsistente', 'corrigir', f'{nome}!{letra}', f'a coluna "{cab_txt or letra}" escreve a mesma categoria de jeitos diferentes: {", ".join(repr(x) for x in sorted(vs)[:4])}'); break
            for c, v in textos:
                if v != v.strip() and palavras(v) <= 6: ctx.A('espacos-nas-pontas', 'nota', f'{nome}!{c.coordinate}', f'espaço sobrando no começo ou no fim de "{v[:30]}" (atrapalha busca e filtro)'); break
        # fórmulas: soma incompleta, constantes, linha diferente das vizinhas
        formulas = [(c, c.value) for row in grid for c in row if isinstance(c.value, str) and c.value.startswith('=')]
        for c, f in formulas:
            m = SOMA.match(f)
            if m and m.group(1).upper() == m.group(3).upper():
                col = openpyxl.utils.column_index_from_string(m.group(1).upper())
                s, e = int(m.group(2)), int(m.group(4))
                abaixo = [r for r in range(e + 1, c.row) if col == c.column and _num(valor(ws, wv, ws.cell(r, col)))]
                acima = [r for r in range((r0 + 2) if r0 is not None else 2, s) if col == c.column and _num(valor(ws, wv, ws.cell(r, col)))]
                if abaixo: ctx.A('soma-incompleta', 'corrigir', f'{nome}!{c.coordinate}', f'{f} soma até a linha {e}, mas há valores até a linha {max(abaixo)} da mesma coluna')
                elif acima: ctx.A('soma-incompleta', 'corrigir', f'{nome}!{c.coordinate}', f'{f} começa na linha {s}, mas há valores acima (a partir da linha {min(acima)})')
            limpa = re.sub(r'"[^"]*"|\'[^\']*\'!|\$?[A-Z]{1,3}\$?\d+|[A-Za-z_.]+\(', ' ', f)
            consts = [x for x in re.findall(r'(?<![\w.])\d+(?:[.,]\d+)?(?![\w.])', limpa) if x not in COMUNS]
            if consts: ctx.A('constante-na-formula', 'nota', f'{nome}!{c.coordinate}', f'número fixo dentro da fórmula ({", ".join(consts[:3])}): {f[:60]}; ponha numa célula de premissa com rótulo')
        por_col = defaultdict(list)
        for c, f in formulas: por_col[c.column].append(c)
        for col, cs in por_col.items():
            cs.sort(key=lambda c: c.row)
            for a, b, d in zip(cs, cs[1:], cs[2:]):
                if b.row == a.row + 1 and d.row == b.row + 1 and not SOMA.match(a.value):
                    try:
                        esperado_d = Translator(a.value, origin=a.coordinate).translate_formula(d.coordinate)
                        esperado_b = Translator(a.value, origin=a.coordinate).translate_formula(b.coordinate)
                    except Exception: continue
                    if esperado_d == d.value and esperado_b != b.value:
                        ctx.A('formula-diferente', 'corrigir', f'{nome}!{b.coordinate}', f'a fórmula quebra o padrão da coluna: tem {b.value[:50]}, as vizinhas pedem {esperado_b[:50]}')
        # estrutura da planilha
        if r0 is not None and maxr > 25:
            if not ws.freeze_panes: ctx.A('sem-painel-congelado', 'nota', f'aba "{nome}"', f'{maxr} linhas sem congelar o cabeçalho: ao rolar, as colunas perdem o nome')
            if not ws.auto_filter.ref and not ws.tables: ctx.A('sem-filtro', 'nota', f'aba "{nome}"', 'tabela longa sem filtro')
        if r0 is not None:
            hc = [c for c in grid[r0] if c.value is not None]
            if hc and not any(c.font and c.font.b for c in hc) and not any(c.fill and c.fill.fgColor and c.fill.fill_type for c in hc):
                ctx.A('cabecalho-sem-destaque', 'nota', f'aba "{nome}"', 'a linha de cabeçalho não tem negrito nem cor')
        if r0 is not None:
            for mr in ws.merged_cells.ranges:
                if mr.min_row > r0 + 1 and maxr > 20: ctx.A('celulas-mescladas', 'nota', f'{nome}!{mr.coord}', 'células mescladas no meio dos dados: quebram ordenar, filtrar e colar'); break
            vazias = [i + 1 for i in range(r0 + 1, len(grid) - 1) if all(c.value is None for c in grid[i]) and any(c.value is not None for c in grid[i + 1]) and any(c.value is not None for c in grid[i - 1])]
            if vazias: ctx.A('linha-vazia-nos-dados', 'nota', f'{nome}!A{vazias[0]}', f'{len(vazias)} linha(s) em branco no meio dos dados (cortam a tabela na hora de filtrar, ordenar e criar tabela dinâmica)')
            vistas, dup = {}, 0
            for i in range(r0 + 1, len(grid)):
                k = tuple(c.value for c in grid[i])
                if sum(x is not None for x in k) >= 3:
                    if k in vistas: dup += 1
                    vistas[k] = i
            if dup: ctx.A('linhas-duplicadas', 'nota', f'aba "{nome}"', f'{dup} linha(s) idêntica(s) a outra (confira se é duplicata)')
        for row in grid:
            for c in row:
                if c.comment: ctx.B(f'{nome}!{c.coordinate} · comentário', 'corpo', c.comment.text); ctx.A('comentario-na-celula', 'nota', f'{nome}!{c.coordinate}', 'comentário esquecido na célula')
                if isinstance(c.value, str) and not c.value.startswith('=') and palavras(c.value) >= 4:
                    ctx.B(f'{nome}!{c.coordinate}', 'corpo', c.value)
        grades.append((ws, wv, nome, larg, padrao_l, grid, calc))
    for n in nomes_z:
        if re.match(r'xl/charts/chart\d+\.xml$', n):
            x = z.read(n).decode('utf8', 'replace')
            if '<c:title>' not in x and '<c:title ' not in x: ctx.A('grafico-sem-titulo', 'nota', n.split('/')[-1], 'gráfico sem título: diga o que ele mostra')
    try:
        for nm, dn in wb.defined_names.items():
            if '#REF!' in str(dn.attr_text): ctx.A('referencia-quebrada', 'bloqueia', f'nome "{nm}"', f'nome definido aponta para algo apagado: {dn.attr_text}')
    except Exception: pass
    res = []  # itens "celula" do contrato
    for it in ctx.opc.get('celulas', []):
        ref = it.get('ref', '')
        aba, _, coord = ref.rpartition('!'); aba = aba.strip("'") or wb.worksheets[0].title
        try:
            ws_, c = wb[aba], wb[aba][coord]
            v = valor(ws_, wbv[aba], c)
            eh_f = isinstance(c.value, str) and c.value.startswith('=')
            ok = not (isinstance(v, str) and v in ERROS) and not (it.get('formula') and not eh_f)
            if 'igual' in it: ok = ok and (v == it['igual'] or str(v).strip() == str(it['igual']).strip())
            if 'contem' in it: ok = ok and str(it['contem']).lower() in str(v).lower()
            if 'entre' in it: ok = ok and _num(v) and it['entre'][0] <= v <= it['entre'][1]
            res.append({'id': it['id'], 'ok': bool(ok), 'detalhe': f'{ref} = {v!r}' + (f' (fórmula {c.value})' if eh_f else '')})
        except Exception as e:
            res.append({'id': it['id'], 'ok': False, 'detalhe': f'{ref}: {type(e).__name__} {e}'})
    ctx.info['celulas'] = res
    p = wb.properties
    for campo, v in (('autor', p.creator), ('última modificação por', p.lastModifiedBy), ('título', p.title)):
        if v and SUSPEITOS_META.search(v): ctx.A('metadados', 'corrigir', '', f'propriedade "{campo}" do arquivo diz "{v[:50]}": sobra de ferramenta')
    return grades


def grade_png(ctx, grades, max_abas=4):
    """Imagem aproximada da planilha como o Excel mostra (larguras, #### e texto cortado incluídos). Não é o Excel."""
    from PIL import Image, ImageDraw
    from openpyxl.utils import get_column_letter
    pasta = ctx.saida / 'abas'; pasta.mkdir(exist_ok=True)
    pngs, rot = [], []
    for ws, wv, nome, larg, padrao_l, grid, calc in grades[:max_abas]:
        linhas, cols = min(len(grid), 40), min(len(grid[0]) if grid else 0, 14)
        px = lambda ci: int((larg.get(ci, (None, False))[0] or padrao_l) * 7 + 5) if not larg.get(ci, (None, False))[1] else 0
        rh = 21; gut = 38
        W = gut + sum(px(c + 1) for c in range(cols)); Hh = 22 + linhas * rh
        im = Image.new('RGB', (max(W, 300), Hh), (255, 255, 255)); d = ImageDraw.Draw(im)
        f, fb = fonte('Calibri', 15), fonte('Calibri', 15, True)
        x = gut
        d.rectangle([0, 0, W, 21], fill=(230, 230, 230))
        for c in range(cols):
            d.text((x + 4, 3), get_column_letter(c + 1), fill=(90, 90, 90), font=f); x += px(c + 1)
        for r in range(linhas):
            y = 22 + r * rh
            d.rectangle([0, y, gut, y + rh], fill=(230, 230, 230)); d.text((6, y + 2), str(r + 1), fill=(90, 90, 90), font=f)
            x = gut
            for c in range(cols):
                w_ = px(c + 1)
                cell = grid[r][c]
                fill = None
                try:
                    if cell.fill and cell.fill.fill_type == 'solid' and isinstance(cell.fill.fgColor.rgb, str): fill = tuple(int(cell.fill.fgColor.rgb[-6:][i:i + 2], 16) for i in (0, 2, 4))
                except Exception: pass
                if fill: d.rectangle([x, y, x + w_, y + rh], fill=fill)
                d.rectangle([x, y, x + w_, y + rh], outline=(215, 215, 215))
                v = cell.value
                if isinstance(v, str) and v.startswith('='):
                    v = wv.cell(cell.row, cell.column).value
                    if v is None: v = calc.get((ws.title, cell.row, cell.column))
                    if v is None: v = '(sem valor)'
                if v is not None:
                    s = _exibido(v, cell.number_format) if not isinstance(v, str) else v
                    ft = fb if (cell.font and cell.font.b) else f
                    viz = grid[r][c + 1] if c + 1 < len(grid[r]) else None
                    if _num(v) and ft.getlength(s) + 6 > w_: s = '#' * max(3, int(w_ / 9))
                    cor = (180, 40, 40) if isinstance(v, str) and v in ERROS or s.startswith('#') else (30, 30, 30)
                    clip = Image.new('RGBA', (w_ if (viz is not None and viz.value is not None) or _num(v) else min(int(ft.getlength(s)) + 10, W - x), rh), (0, 0, 0, 0))
                    ImageDraw.Draw(clip).text((4 if not _num(v) else max(2, w_ - ft.getlength(s) - 5), 2), s, fill=cor, font=ft)
                    im.paste(clip, (x, y), clip)
                x += w_
        p = pasta / f'{len(pngs) + 1:02d}-{re.sub(r"[^A-Za-z0-9]+", "_", nome)[:20]}.png'
        im.save(p); pngs.append(str(p)); rot.append(f'aba {nome}')
    if pngs: folha(ctx, pngs, 'folha-planilha', rot, thumb=700, cols=2, por_folha=4)
    return pngs


def ler_csv(ctx, caminho):
    raw = Path(caminho).read_bytes()
    ctx.info['tipo'] = 'csv'
    try: texto = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        texto = raw.decode('cp1252', 'replace')
        ctx.A('codificacao', 'corrigir', '', 'o arquivo não está em UTF-8 (provavelmente Windows-1252): acentos quebram em muitos programas; salve como UTF-8')
    if re.search(r'Ã[£¡©§³ªº]|Â[ °]', texto): ctx.A('texto-corrompido', 'corrigir', '', 'há acentos corrompidos (ex.: "Ã©" no lugar de "é"): o arquivo foi gravado com a codificação errada')
    amostra = texto[:4000]
    delim = max([',', ';', '\t', '|'], key=lambda d: amostra.count(d))
    linhas = list(csv.reader(texto.splitlines(), delimiter=delim))
    if not linhas: return
    cab = linhas[0]
    ctx.info.update(titulos=cab, linhas=len(linhas) - 1)
    if len(set(cab)) < len(cab): ctx.A('cabecalho-repetido', 'corrigir', '', f'colunas com o mesmo nome: {", ".join(k for k, n in Counter(cab).items() if n > 1)}')
    if any(not h.strip() for h in cab): ctx.A('cabecalho-vazio', 'corrigir', '', 'há coluna sem nome no cabeçalho')
    for h in cab:
        if h.strip(): ctx.B('cabeçalho', 'rotulo', h)
    for i, l in enumerate(linhas[1:], 2):
        if len(l) != len(cab): ctx.A('colunas-desiguais', 'corrigir', f'linha {i}', f'a linha tem {len(l)} campos e o cabeçalho {len(cab)} (vírgula ou aspas fora do lugar)')
    for ci, h in enumerate(cab):
        col = [l[ci].strip() for l in linhas[1:] if len(l) > ci]
        if col and not any(col): ctx.A('coluna-vazia', 'nota', f'coluna "{h}"', 'coluna sem nenhum valor')
        dec = Counter('virgula' if re.fullmatch(r'-?\d+,\d+', v) else 'ponto' for v in col if re.fullmatch(r'-?\d+[.,]\d+', v))
        if len(dec) > 1: ctx.A('decimal-misto', 'corrigir', f'coluna "{h}"', 'números com vírgula e com ponto como separador decimal na mesma coluna')
