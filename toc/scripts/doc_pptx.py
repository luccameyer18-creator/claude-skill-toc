# -*- coding: utf-8 -*-
"""Conferência de .pptx pelo arquivo. Não abre o PowerPoint (pode haver apresentação do usuário aberta):
o transbordo de texto é estimado medindo as linhas com a fonte real, e o revisor recebe um esboço de cada slide."""
import io, re, zipfile
from collections import Counter, defaultdict
from doc_base import *

from lxml import etree
NS = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main', 'p': 'http://schemas.openxmlformats.org/presentationml/2006/main'}


def xp(el, expr):
    # elementos sem classe própria no python-pptx não conhecem os prefixos: passa os namespaces na mão
    return etree._Element.xpath(el, expr, namespaces=NS)


PX = 9525  # EMU por pixel a 96 dpi
ESQ = {'BACKGROUND_1': 'bg1', 'TEXT_1': 'tx1', 'BACKGROUND_2': 'bg2', 'TEXT_2': 'tx2', 'DARK_1': 'dk1', 'LIGHT_1': 'lt1',
       'DARK_2': 'dk2', 'LIGHT_2': 'lt2', 'HYPERLINK': 'hlink', 'FOLLOWED_HYPERLINK': 'folHlink'}


def _tema(caminho):
    z = zipfile.ZipFile(caminho)
    cores, fontes = {}, {'maior': None, 'menor': None}
    nomes = sorted(n for n in z.namelist() if re.match(r'ppt/theme/theme\d+\.xml$', n))
    if nomes:
        x = z.read(nomes[0]).decode('utf8', 'replace')
        for m in re.finditer(r'<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)>\s*<a:(?:srgbClr val|sysClr val="\w+" lastClr)="([0-9A-Fa-f]{6})"', x):
            cores[m.group(1)] = tuple(int(m.group(2)[i:i + 2], 16) for i in (0, 2, 4))
        m = re.search(r'<a:majorFont>\s*<a:latin typeface="([^"]*)"', x); fontes['maior'] = m.group(1) if m else None
        m = re.search(r'<a:minorFont>\s*<a:latin typeface="([^"]*)"', x); fontes['menor'] = m.group(1) if m else None
    z.close()
    return cores, fontes


def _cor(cf, cores, clrmap):
    from pptx.enum.dml import MSO_COLOR_TYPE
    try:
        t = cf.type
        if t == MSO_COLOR_TYPE.RGB: return tuple(cf.rgb)
        if t == MSO_COLOR_TYPE.SCHEME:
            if getattr(cf, 'brightness', 0): return None
            n = cf.theme_color.name
            chave = ESQ.get(n) or ('accent' + n[-1] if n.startswith('ACCENT_') else None)
            return cores.get(clrmap.get(chave, chave)) if chave else None
    except Exception:
        return None
    return None


def _cor_xml(slide, cores, clrmap):
    """Fundo do slide: o do slide, senão o do layout, senão o do master. Gradiente ou imagem: desconhecido (None)."""
    for el in (slide._element, slide.slide_layout._element, slide.slide_layout.slide_master._element):
        bg = xp(el, './/p:bg')
        if not bg: continue
        b = bg[0]
        if xp(b, './/a:gradFill|.//a:blipFill'): return None
        v = xp(b, './/a:srgbClr/@val')
        if v: return tuple(int(v[0][i:i + 2], 16) for i in (0, 2, 4))
        v = xp(b, './/a:schemeClr/@val')
        if v: return cores.get(clrmap.get(v[0], v[0]))
        return None
    return (255, 255, 255)


def _sz(el, nivel):
    r = xp(el, f'.//a:lvl{nivel + 1}pPr/a:defRPr/@sz')
    return int(r[0]) / 100 if r else None


def _tamanho_herdado(prs, slide, shape, nivel):
    from pptx.enum.shapes import PP_PLACEHOLDER as PH
    if shape.is_placeholder:
        ph = shape.placeholder_format
        try:
            lph = next(p for p in slide.slide_layout.placeholders if p.placeholder_format.idx == ph.idx)
            v = _sz(lph._element, nivel)
            if v: return v
        except StopIteration:
            pass
        estilo = 'titleStyle' if ph.type in (PH.TITLE, PH.CENTER_TITLE, PH.VERTICAL_TITLE) else 'bodyStyle'
        el = xp(slide.slide_layout.slide_master._element, f'.//p:txStyles/p:{estilo}')
        if el:
            v = _sz(el[0], nivel)
            if v: return v
    dts = xp(prs.part._element, './/p:defaultTextStyle')
    if dts:
        v = _sz(dts[0], nivel)
        if v: return v
    return 18.0


def _medir(prs, slide, shape, tfontes, ehtitulo):
    """Linhas do texto da caixa como o PowerPoint tende a quebrá-las (estimativa)."""
    from pptx.oxml.ns import qn
    tf = shape.text_frame
    bp = tf._txBody.find(qn('a:bodyPr'))
    def ins(n, pad): return int(bp.get(n)) if bp is not None and bp.get(n) is not None else pad
    L, R, T, Bi = ins('lIns', 91440), ins('rIns', 91440), ins('tIns', 45720), ins('bIns', 45720)
    escala, autofit = 1.0, None
    if bp is not None:
        na = bp.find(qn('a:normAutofit'))
        if na is not None:
            autofit = 'norm'
            if na.get('fontScale'): escala = int(na.get('fontScale')) / 100000
        elif bp.find(qn('a:spAutoFit')) is not None: autofit = 'forma'
    largura = (shape.width - L - R) / PX
    linhas, total = [], 0.0
    corpo = shape.is_placeholder and not ehtitulo
    for par in tf.paragraphs:
        runs = list(par.runs)
        texto = par.text
        if not texto.strip() and not runs:
            sz = (par.font.size.pt if par.font.size else _tamanho_herdado(prs, slide, shape, par.level)) * escala
            total += sz * 96 / 72 * 1.2
            continue
        tams = [r.font.size.pt for r in runs if r.font.size]
        sz = (max(tams) if tams else (par.font.size.pt if par.font.size else _tamanho_herdado(prs, slide, shape, par.level))) * escala
        nome = next((r.font.name for r in runs if r.font.name), None) or par.font.name
        if not nome or nome.startswith('+'): nome = (tfontes['maior'] if (ehtitulo or (nome or '').startswith('+mj')) else tfontes['menor']) or 'Calibri'
        negrito = any(bool(r.font.bold) for r in runs) or bool(par.font.bold) or ehtitulo
        pPr = par._p.pPr
        marL = int(pPr.get('marL')) if pPr is not None and pPr.get('marL') else (228600 + 457200 * par.level if corpo else 0)
        f = fonte(nome, sz * 96 / 72, negrito)
        qs = quebrar(texto, f, largura - marL / PX)
        asc, desc = f.getmetrics() if hasattr(f, 'getmetrics') else (sz, sz * 0.25)
        ls = par.line_spacing if isinstance(par.line_spacing, float) else 1.0
        lh = (asc + desc) * ls
        antes = par.space_before.pt * 96 / 72 if par.space_before is not None and hasattr(par.space_before, 'pt') else 0
        depois = par.space_after.pt * 96 / 72 if par.space_after is not None and hasattr(par.space_after, 'pt') else 0
        total += len(qs) * lh + antes + depois
        al = par.alignment
        linhas.append({'linhas': qs, 'f': f, 'lh': lh, 'marL': marL / PX, 'al': str(al) if al is not None else '', 'nome': nome, 'sz': sz})
    return {'paragrafos': linhas, 'altura': total + (T + Bi) / PX, 'caixa': shape.height / PX, 'L': L / PX, 'T': T / PX,
            'escala': escala, 'autofit': autofit, 'anchor': (bp.get('anchor') if bp is not None else None) or 't',
            'quebra': not (bp is not None and bp.get('wrap') == 'none')}


def ler_pptx(ctx, caminho):
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE, PP_PLACEHOLDER as PH
    from pptx.enum.dml import MSO_FILL
    prs = Presentation(caminho)
    cores, tfontes = _tema(caminho)
    W, H = prs.slide_width, prs.slide_height
    Wp, Hp = int(W / PX), int(H / PX)
    ctx.info.update(tipo='pptx', slides=len(prs.slides))
    try:
        clrmap = dict(xp(prs.slide_master._element, './p:clrMap')[0].attrib)
    except Exception:
        clrmap = {}
    fontes, titulos, desenhos, total_palavras = Counter(), [], [], 0
    pos_titulo = defaultdict(list)
    n_img = 0

    def achatar(shapes):
        for s in shapes:
            if s.shape_type == MSO_SHAPE_TYPE.GROUP: yield from achatar(s.shapes)
            else: yield s

    for si, slide in enumerate(prs.slides, 1):
        z = list(achatar(slide.shapes))
        titulo_shape = slide.shapes.title
        tid = titulo_shape.shape_id if titulo_shape is not None else None  # os objetos-forma são recriados a cada acesso: compara pelo id
        tt = titulo_shape.text_frame.text.strip() if titulo_shape is not None and titulo_shape.has_text_frame else ''
        titulos.append(tt or f'(slide {si} sem título)')
        if slide._element.get('show') == '0':
            ctx.A('slide-oculto', 'corrigir', f'slide {si}', 'slide escondido: não aparece na apresentação nem no PDF (apague ou mostre)')
        tem_texto_outro = any(s.has_text_frame and s.text_frame.text.strip() and s.shape_id != tid for s in z)
        if not tt:
            ctx.A('slide-sem-titulo', 'corrigir' if tem_texto_outro else 'nota', f'slide {si}', 'slide sem título (navegação, leitor de tela e ordem de leitura dependem dele)')
        elif titulo_shape is not None:
            pos_titulo[slide.slide_layout.name].append((si, titulo_shape.left or 0, titulo_shape.top or 0))
            ctx.B(f'slide {si} · título', 'titulo', tt)
        fundo = _cor_xml(slide, cores, clrmap)
        desenho, caixas_texto, palavras_slide, bullets = [], [], 0, 0
        for ordem, sh in enumerate(z):
            x, y = (sh.left or 0), (sh.top or 0)
            w, h = (sh.width or 0), (sh.height or 0)
            onde = f'slide {si} · {sh.name}'
            ehtitulo = sh.shape_id == tid
            if not ehtitulo and (x < -0.005 * W or y < -0.005 * H or x + w > W * 1.005 or y + h > H * 1.005) and w and h:
                folga = max(-x, -y, x + w - W, y + h - H) / PX
                txt = sh.has_text_frame and sh.text_frame.text.strip()
                ctx.A('fora-do-slide', 'corrigir' if txt else 'nota', onde, f'{"caixa de texto" if txt else "objeto"} passa {round(folga)}px da borda do slide' + ('' if txt else ' (sangria é comum em imagem de fundo; confira)'))
            # imagens
            pic = None
            try:
                if sh.shape_type == MSO_SHAPE_TYPE.PICTURE or (hasattr(sh, 'image') and sh.shape_type == MSO_SHAPE_TYPE.PLACEHOLDER): pic = sh
            except Exception: pass
            if pic is not None:
                n_img += 1
                try:
                    from PIL import Image
                    blob = pic.image.blob
                    im = Image.open(io.BytesIO(blob)); nw, nh = im.size
                    cw = nw * (1 - (pic.crop_left or 0) - (pic.crop_right or 0)); ch = nh * (1 - (pic.crop_top or 0) - (pic.crop_bottom or 0))
                    if w and h and ch and abs((cw / ch) / (w / h) - 1) > 0.03:
                        ctx.A('imagem-esticada', 'corrigir', onde, f'imagem com proporção {cw / ch:.2f} mostrada como {w / h:.2f} (esticada ou achatada); corte em vez de esticar')
                    dpi = nw / (w / 914400) if w else 999
                    if w > 914400 * 2 and dpi < 96: ctx.A('imagem-baixa-resolucao', 'nota', onde, f'imagem com {round(dpi)} dpi no tamanho em que aparece')
                    desenho.append({'k': 'img', 'x': x / PX, 'y': y / PX, 'w': w / PX, 'h': h / PX, 'im': im.convert('RGBA')})
                except Exception: pass
                if not xp(sh._element, './/p:cNvPr/@descr'):
                    ctx.A('imagem-sem-alt', 'nota', onde, 'imagem sem texto alternativo')
                continue
            if getattr(sh, 'has_chart', False) and sh.has_chart:
                ch = sh.chart
                try:
                    if ch.has_title: ctx.B(f'{onde} · título do gráfico', 'rotulo', ch.chart_title.text_frame.text)
                    else: ctx.A('grafico-sem-titulo', 'nota', onde, 'gráfico sem título: diga o que ele mostra')
                except Exception: pass
                desenho.append({'k': 'grafico', 'x': x / PX, 'y': y / PX, 'w': w / PX, 'h': h / PX})
                continue
            if getattr(sh, 'has_table', False) and sh.has_table:
                celulas = []
                for ri, row in enumerate(sh.table.rows):
                    for ci, cell in enumerate(row.cells):
                        tx = cell.text.strip(); celulas.append((ri, ci, tx))
                        if tx: ctx.B(f'{onde} · linha {ri + 1}, col. {ci + 1}', 'corpo' if palavras(tx) >= 4 else 'rotulo', tx); palavras_slide += palavras(tx)
                desenho.append({'k': 'tabela', 'x': x / PX, 'y': y / PX, 'w': w / PX, 'h': h / PX,
                                'linhas': len(sh.table.rows), 'cols': len(sh.table.columns), 'cel': celulas})
                continue
            fill = None
            try:
                if sh.fill.type == MSO_FILL.SOLID: fill = _cor(sh.fill.fore_color, cores, clrmap)
            except Exception: pass
            if not (sh.has_text_frame and sh.text_frame.text.strip()):
                if sh.is_placeholder and sh.has_text_frame and sh.placeholder_format.type not in (PH.DATE, PH.FOOTER, PH.SLIDE_NUMBER) and not ehtitulo:
                    ctx.A('caixa-vazia', 'nota', onde, 'caixa de texto vazia ("Clique para adicionar…" na edição): preencha ou apague')
                if w and h: desenho.append({'k': 'forma', 'x': x / PX, 'y': y / PX, 'w': w / PX, 'h': h / PX, 'fill': fill})
                continue
            # caixa com texto
            texto = sh.text_frame.text
            if sh.placeholder_format.type in (PH.DATE, PH.FOOTER, PH.SLIDE_NUMBER) if sh.is_placeholder else False:
                pass
            m = _medir(prs, slide, sh, tfontes, ehtitulo)
            nb = sum(palavras(p.text) for p in sh.text_frame.paragraphs)
            palavras_slide += nb
            if not ehtitulo:
                ps = [p for p in sh.text_frame.paragraphs if p.text.strip()]
                bullets = max(bullets, len(ps))
                grupo = sh.shape_id
                for p in ps:
                    papel = 'lista' if (p.level > 0 or len(ps) >= 3) else ('corpo' if palavras(p.text) >= 4 else 'rotulo')
                    ctx.B(f'{onde}', papel, p.text, grupo=grupo)
            for p in sh.text_frame.paragraphs:
                for r in p.runs:
                    n_ = r.font.name or ''
                    fontes[n_ if n_ and not n_.startswith('+') else '(tema)'] += len(r.text)
            # tamanho mínimo
            tams = [(r.font.size.pt if r.font.size else _tamanho_herdado(prs, slide, sh, p.level)) * m['escala'] for p in sh.text_frame.paragraphs for r in p.runs if r.text.strip()]
            if tams and not ehtitulo:
                mn = min(tams)
                if mn < 12: ctx.A('fonte-pequena', 'corrigir', onde, f'texto com {mn:.0f}pt: ilegível projetado (mínimo 12pt, ideal 18pt ou mais)')
                elif mn < 14: ctx.A('fonte-pequena', 'nota', onde, f'texto com {mn:.0f}pt: pequeno para projeção (ideal 18pt ou mais)')
            if m['escala'] < 0.9: ctx.A('texto-encolhido', 'nota', onde, f'o PowerPoint encolheu o texto para {round(m["escala"] * 100)}% para caber: texto demais para a caixa')
            sobra = m['altura'] - m['caixa']
            if m['quebra'] and abs(getattr(sh, 'rotation', 0) or 0) < 1 and m['autofit'] != 'forma' and sobra > 0:
                est = f'estimado: texto de ~{round(m["altura"])}px numa caixa de {round(m["caixa"])}px'
                if m['autofit'] == 'norm' and m['escala'] == 1.0: ctx.A('texto-transborda', 'nota', onde, f'{est}; depende do autoajuste do PowerPoint')
                elif sobra > 0.12 * m['caixa']: ctx.A('texto-transborda', 'corrigir', onde, f'o texto não cabe na caixa ({est}): corte texto, aumente a caixa ou divida o slide')
                elif sobra > 0.02 * m['caixa']: ctx.A('texto-transborda', 'nota', onde, f'o texto quase não cabe ({est})')
            if m['autofit'] == 'forma' and (y + max(m['altura'] * PX, h)) > H * 1.01:
                ctx.A('fora-do-slide', 'corrigir', onde, 'a caixa cresce com o texto e passa da borda de baixo do slide')
            # retângulo realmente ocupado pelo texto (para sobreposição)
            at = m['altura']; cy = y / PX
            if m['anchor'] == 'ctr': cy += (h / PX - at) / 2
            elif m['anchor'] == 'b': cy += h / PX - at
            if m['autofit'] == 'forma': at = max(at, h / PX)
            caixas_texto.append((sh, x / PX, cy, w / PX, min(at, max(at, 1)), onde))
            # contraste (só quando cor do texto e do fundo são conhecidas)
            fg = None
            for p in sh.text_frame.paragraphs:
                for r in p.runs:
                    if r.text.strip():
                        fg = _cor(r.font.color, cores, clrmap) or None
                        break
                if fg: break
            if fg is None: fg = cores.get(clrmap.get('tx1', 'tx1'), None) if not any(r.font.color.type is not None for p in sh.text_frame.paragraphs for r in p.runs) else None
            bg = fill
            if bg is None:
                cx, cy2 = x + w / 2, y + h / 2
                for baixo in reversed(z[:ordem]):
                    if (baixo.left or 0) <= cx <= (baixo.left or 0) + (baixo.width or 0) and (baixo.top or 0) <= cy2 <= (baixo.top or 0) + (baixo.height or 0):
                        try:
                            if baixo.shape_type == MSO_SHAPE_TYPE.PICTURE: bg = 'imagem'; break
                            if baixo.fill.type == MSO_FILL.SOLID: bg = _cor(baixo.fill.fore_color, cores, clrmap); break
                            if baixo.fill.type is not None: bg = 'imagem'; break
                        except Exception: pass
                else:
                    bg = fundo
            if fg and bg and bg != 'imagem':
                tam_max = max(tams) if tams else 18
                minimo = 3.0 if tam_max >= 24 else 4.5
                rz = razao(fg, bg)
                if rz < minimo: ctx.A('contraste', 'corrigir', onde, f'contraste {rz:.2f}:1 (texto rgb{fg} sobre rgb{bg}); precisa de {minimo:.1f}:1')
            desenho.append({'k': 'texto', 'x': x / PX, 'y': y / PX, 'w': w / PX, 'h': h / PX, 'm': m, 'fill': fill, 'fg': fg, 'bg': bg if bg != 'imagem' else None})
        # densidade
        total_palavras += palavras_slide
        if palavras_slide > 120: ctx.A('slide-denso', 'corrigir', f'slide {si}', f'{palavras_slide} palavras no slide: é documento, não slide (alvo: até ~60)')
        elif palavras_slide > 80: ctx.A('slide-denso', 'nota', f'slide {si}', f'{palavras_slide} palavras no slide (alvo: até ~60)')
        if bullets > 8: ctx.A('slide-denso', 'nota', f'slide {si}', f'{bullets} itens numa lista só')
        # texto por cima de texto
        for i in range(len(caixas_texto)):
            for j in range(i + 1, len(caixas_texto)):
                a, b = caixas_texto[i], caixas_texto[j]
                ox = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]); oy = min(a[2] + a[4], b[2] + b[4]) - max(a[2], b[2])
                if ox > 0 and oy > 0 and ox * oy > 0.15 * min(a[3] * a[4], b[3] * b[4]) and min(a[3] * a[4], b[3] * b[4]) > 400:
                    ctx.A('texto-sobreposto', 'corrigir', a[5], f'o texto ocupa a mesma área de "{b[5].split(" · ")[-1]}" ({round(ox)}×{round(oy)}px de cruzamento)')
        # quase alinhado: bordas esquerdas de caixas empilhadas e topos de caixas lado a lado
        for i in range(len(caixas_texto)):
            for j in range(i + 1, len(caixas_texto)):
                a, b = caixas_texto[i], caixas_texto[j]
                if a[0].shape_id == tid or b[0].shape_id == tid: continue
                empilhadas = a[2] + a[4] <= b[2] + 2 or b[2] + b[4] <= a[2] + 2
                if empilhadas:
                    d = abs(a[1] - b[1])
                    if 0.0015 * Wp < d < 0.015 * Wp: ctx.A('quase-alinhado', 'corrigir', b[5], f'borda esquerda {round(d)}px fora da de "{a[5].split(" · ")[-1]}" (parece o mesmo alinhamento, não é)')
                elif abs(a[4] - b[4]) < 0.1 * max(a[4], b[4]):
                    d = abs(a[2] - b[2])
                    if 0.0015 * Hp < d < 0.015 * Hp: ctx.A('quase-alinhado', 'corrigir', b[5], f'topo {round(d)}px fora do de "{a[5].split(" · ")[-1]}" ao lado')
        if slide.has_notes_slide:
            nt = slide.notes_slide.notes_text_frame.text.strip() if slide.notes_slide.notes_text_frame is not None else ''
            if nt: ctx.B(f'slide {si} · notas do orador', 'notas', nt)
        desenhos.append((si, fundo, desenho))
    # título na mesma posição em todos os slides de um mesmo layout
    for lay, lst in pos_titulo.items():
        if len(lst) < 3: continue
        mx, my = Counter(l for _, l, _ in lst).most_common(1)[0][0], Counter(t for _, _, t in lst).most_common(1)[0][0]
        for si, l, t in lst:
            dx, dy = abs(l - mx) / PX, abs(t - my) / PX
            if (dx > 0.003 * Wp or dy > 0.003 * Hp):
                ctx.A('titulo-muda-de-lugar', 'corrigir', f'slide {si}', f'o título está {round(dx)}px à direita/esquerda e {round(dy)}px acima/abaixo da posição que ele tem nos outros slides do layout "{lay}"')
    tf = sum(fontes.values()) or 1
    nomes_f = [k for k, v in fontes.items() if v / tf >= 0.03 and k != '(tema)']
    if len(nomes_f) > 2: ctx.A('fontes-demais', 'corrigir', '', f'{len(nomes_f)} fontes explícitas na apresentação ({", ".join(nomes_f)}): use as do tema (no máximo 2)')
    ctx.info.update(titulos=titulos, imagens=n_img, palavras_slides=total_palavras)
    # metadados
    cp = prs.core_properties
    for campo, v in (('autor', cp.author), ('última modificação por', cp.last_modified_by), ('título', cp.title), ('comentários', cp.comments)):
        if v and SUSPEITOS_META.search(v): ctx.A('metadados', 'corrigir', '', f'propriedade "{campo}" do arquivo diz "{v[:50]}": sobra de ferramenta')
    return Wp, Hp, desenhos


def esboco_slides(ctx, Wp, Hp, desenhos):
    """Imagem aproximada de cada slide (caixas, texto medido, imagens). Não é a renderização do PowerPoint."""
    from PIL import Image, ImageDraw
    pasta = ctx.saida / 'slides'; pasta.mkdir(exist_ok=True)
    pngs = []
    for si, fundo, itens in desenhos[:40]:
        im = Image.new('RGB', (Wp, Hp), fundo or (255, 255, 255)); d = ImageDraw.Draw(im)
        for it in itens:
            x, y, w, h = int(it['x']), int(it['y']), int(it['w']), int(it['h'])
            k = it['k']
            if k == 'img':
                try:
                    r = it['im'].resize((max(1, w), max(1, h))); im.paste(r, (x, y), r)
                except Exception: pass
            elif k == 'forma':
                if it.get('fill'): d.rectangle([x, y, x + w, y + h], fill=it['fill'])
                else: d.rectangle([x, y, x + w, y + h], outline=(190, 190, 190))
            elif k == 'grafico':
                d.rectangle([x, y, x + w, y + h], outline=(120, 120, 180)); d.text((x + 8, y + 8), 'gráfico', fill=(120, 120, 180))
            elif k == 'tabela':
                d.rectangle([x, y, x + w, y + h], outline=(120, 120, 120))
                cw, rh = w / max(1, it['cols']), h / max(1, it['linhas'])
                for ri, ci, tx in it['cel']:
                    d.rectangle([x + ci * cw, y + ri * rh, x + (ci + 1) * cw, y + (ri + 1) * rh], outline=(200, 200, 200))
                    d.text((x + ci * cw + 4, y + ri * rh + 3), tx[:int(cw / 7)], fill=(60, 60, 60), font=fonte('Calibri', 11))
            elif k == 'texto':
                m = it['m']
                if it.get('fill'): d.rectangle([x, y, x + w, y + h], fill=it['fill'])
                fg = it.get('fg')
                if not fg:
                    base = it.get('bg') or it.get('fill') or fundo or (255, 255, 255)
                    fg = (20, 20, 20) if luminancia(base) > 0.4 else (240, 240, 240)
                at = m['altura']
                yy = y + m['T'] + (0 if m['anchor'] == 't' else ((h - at) / 2 if m['anchor'] == 'ctr' else h - at))
                estouro = False
                for p in m['paragrafos']:
                    for linha in p['linhas']:
                        tx = x + m['L'] + p['marL']
                        if 'CENTER' in p['al']: tx = x + (w - p['f'].getlength(linha)) / 2
                        elif 'RIGHT' in p['al']: tx = x + w - m['L'] - p['f'].getlength(linha)
                        fora = yy + p['lh'] > y + h + 2
                        estouro = estouro or fora
                        d.text((tx, yy), linha, font=p['f'], fill=(200, 30, 30) if fora else fg)
                        yy += p['lh']
                if estouro: d.rectangle([x, y, x + w, y + h], outline=(200, 30, 30))
        d.text((8, Hp - 16), f'slide {si} · esboço do toc (não é a imagem do PowerPoint); vermelho = texto fora da caixa', fill=(140, 140, 140))
        p = pasta / f's-{si:02d}.png'; im.save(p); pngs.append(str(p))
    if pngs: folha(ctx, pngs, 'folha-slides', [f'slide {s}' for s, _, _ in desenhos[:40]], thumb=420, cols=3, por_folha=9)
    return pngs
