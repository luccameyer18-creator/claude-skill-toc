# -*- coding: utf-8 -*-
"""Conferência de .docx: estrutura, formatação, resíduos de edição e, com o Word, as páginas como saem de verdade."""
import re, shutil, zipfile
from collections import Counter
from doc_base import *

A4_W, CARTA_W = 7560310, 7772400  # EMU


def _nivel(estilo):
    n = (estilo or '').strip()
    m = re.match(r'(?i)^(?:heading|t[íi]tulo)\s*(\d)$', n)
    if m: return int(m.group(1))
    return 0 if re.match(r'(?i)^(title|t[íi]tulo)$', n) else None


def _fonte(run, p):
    nome, tam, s = run.font.name, run.font.size, p.style
    while (nome is None or tam is None) and s is not None:
        if nome is None and s.font.name: nome = s.font.name
        if tam is None and s.font.size: tam = s.font.size
        s = s.base_style
    return nome, (tam.pt if tam else None)


def ler_docx(ctx, caminho):
    import docx
    from docx.oxml.ns import qn
    from docx.text.paragraph import Paragraph
    from docx.table import Table
    d = docx.Document(caminho)
    corpo = d.element.body
    fontes, tamanhos = Counter(), Counter()
    titulos, manuais = [], []
    n_par = n_tab = 0
    vazios, ult_nivel, grupo, anterior_lista = 0, 0, 0, False
    ctx.info['tipo'] = 'docx'

    tema = (None, None)
    try:
        with zipfile.ZipFile(caminho) as zt:
            nt = next((n for n in zt.namelist() if re.match(r'word/theme/theme\d*\.xml$', n)), None)
            if nt:
                tx = zt.read(nt).decode('utf8', 'replace')
                mj = re.search(r'<a:majorFont>\s*<a:latin typeface="([^"]+)"', tx); mn = re.search(r'<a:minorFont>\s*<a:latin typeface="([^"]+)"', tx)
                tema = (mj.group(1) if mj else None, mn.group(1) if mn else None)
    except Exception:
        pass
    filhos = list(corpo.iterchildren())
    for idx, filho in enumerate(filhos):
        if filho.tag == qn('w:tbl'):
            n_tab += 1
            t = Table(filho, d)
            if len(t.rows) >= 3:
                trpr = t.rows[0]._tr.trPr
                if trpr is None or not trpr.xpath('./w:tblHeader'):
                    ctx.A('tabela-sem-cabecalho', 'nota', f'tabela {n_tab}', 'a primeira linha não está marcada como cabeçalho (repetir em cada página, leitor de tela)')
            vistos, vazias, total = set(), 0, 0
            for ri, row in enumerate(t.rows):
                for ci, cell in enumerate(row.cells):
                    if id(cell._tc) in vistos: continue
                    vistos.add(id(cell._tc)); total += 1
                    tx = cell.text.strip()
                    if not tx: vazias += 1
                    else: ctx.B(f'tabela {n_tab}, linha {ri + 1}, col. {ci + 1}', 'corpo' if palavras(tx) >= 4 else 'rotulo', tx)
            if total >= 4 and vazias / total > 0.3:
                ctx.A('tabela-vazia', 'nota', f'tabela {n_tab}', f'{vazias} de {total} células vazias')
            larg = sum(int(x) for x in filho.xpath('./w:tblGrid/w:gridCol/@w:w') or [0]) * 635
            s0 = d.sections[0]
            util = s0.page_width - s0.left_margin - s0.right_margin
            if larg > util * 1.02:
                ctx.A('tabela-larga', 'corrigir', f'tabela {n_tab}', f'a tabela tem {larg / 360000:.1f} cm e a área útil da página {util / 360000:.1f} cm: ela sai da margem')
            anterior_lista = False
            continue
        if filho.tag != qn('w:p'): continue
        n_par += 1
        p = Paragraph(filho, d)
        texto = p.text
        estilo = p.style.name if p.style is not None else ''
        tem_obj = bool(filho.xpath('.//w:drawing|.//w:pict|.//w:br[@w:type="page"]|.//w:sectPr'))
        if not texto.strip() and not tem_obj:
            vazios += 1; continue
        if vazios >= 2:
            ctx.A('linhas-vazias', 'corrigir' if vazios >= 3 else 'nota', f'par. {n_par}', f'{vazios} parágrafos vazios seguidos servindo de espaçamento: use "espaço antes/depois" do parágrafo', busca=texto[:40])
        vazios = 0
        if not texto.strip(): continue
        nivel = _nivel(estilo)
        em_lista = (p._p.pPr is not None and p._p.pPr.numPr is not None) or bool(re.search(r'(?i)list|lista|marcador|bullet', estilo))
        onde = f'par. {n_par}'
        runs = [r for r in p.runs if r.text.strip()]
        for r in runs:
            nome, tam = _fonte(r, p)
            if nome: fontes[nome] += len(r.text)
            if tam: tamanhos[tam] += len(r.text)
        todas_neg = bool(runs) and all(bool(r.bold) or (r.bold is None and bool(p.style.font.bold)) for r in runs)
        neg = 0
        if runs and not todas_neg:
            ant = False
            for r in p.runs:
                b = bool(r.bold) and r.text.strip() != ''
                if b and not ant and palavras(r.text) <= 6: neg += 1
                ant = b if r.text.strip() else ant
        fic = None  # ficha tipográfica do bloco: fonte e tamanho que o Word vai usar (estilo herdado incluído)
        if runs:
            nm, tm = _fonte(runs[0], p)
            nm = nm or (tema[0] if nivel is not None else tema[1]) or 'fonte do tema'  # título usa a fonte "major" do tema, texto a "minor"
            fic = f'{nm}{f" {tm:g}pt" if tm else ""}{" negrito" if todas_neg else ""}'
        if nivel is not None and nivel >= 1:
            if ult_nivel and nivel > ult_nivel + 1:
                ctx.A('titulo-pulou-nivel', 'corrigir', onde, f'"{texto[:50]}" é título {nivel} logo depois de um título {ult_nivel}: não pule nível (quebra o sumário e a navegação)', busca=texto[:40])
            ult_nivel = nivel; titulos.append(texto.strip())
            ctx.B(onde, 'titulo', texto, nivel=nivel, fonte=fic)
        elif nivel == 0:
            titulos.append(texto.strip()); ctx.B(onde, 'titulo', texto, nivel=1, fonte=fic)
        else:
            proximo = next((filhos[j] for j in range(idx + 1, len(filhos)) if filhos[j].tag == qn('w:p') and ''.join(filhos[j].itertext()).strip()), None)
            tam_run = max((_fonte(r, p)[1] or 0) for r in runs) if runs else 0
            if (todas_neg or tam_run >= 14) and len(texto) <= 80 and not re.search(r'[.:;,]$', texto.strip()) and not em_lista and proximo is not None and palavras(texto) <= 10:
                ctx.A('titulo-falso', 'nota', onde, f'"{texto[:50]}" parece título (negrito/maior) mas está em estilo "{estilo}": use Título 1/2 para entrar no sumário e na navegação', busca=texto[:40])
            if re.match(r'^\s*(?:[-–—•·▪●○*]|\d{1,2}[.)]|[a-z][.)])\s+\S', texto) and not em_lista:
                manuais.append((onde, texto))
            if em_lista:
                if not anterior_lista: grupo += 1
                ctx.B(onde, 'lista', texto, grupo=grupo, fonte=fic)
            else:
                ctx.B(onde, 'corpo' if palavras(texto) >= 4 else 'rotulo', texto, negrito=neg, fonte=fic)
        anterior_lista = em_lista
        for h in filho.xpath('.//w:hyperlink'):
            tl = ''.join(h.itertext()).strip().lower()
            if re.fullmatch(r'(clique|click) (aqui|here)|aqui|here|link', tl): ctx.A('link-sem-sentido', 'nota', onde, f'o texto do link é "{tl}": diga para onde ele leva')
    if len(manuais) >= 2:
        ctx.A('lista-manual', 'corrigir', manuais[0][0], f'{len(manuais)} itens com marcador ou número digitado à mão (ex.: "{manuais[0][1][:40]}"): use lista do Word, senão o recuo e a numeração quebram ao editar', busca=manuais[0][1][:40])

    # fontes e tamanhos usados de verdade
    tot = sum(fontes.values()) or 1
    usadas = [(k, v) for k, v in fontes.items() if v / tot >= 0.02]
    if len(usadas) > 3:
        ctx.A('fontes-demais', 'corrigir', '', f'{len(usadas)} fontes diferentes no texto ({", ".join(k for k, _ in sorted(usadas, key=lambda x: -x[1]))}): use no máximo 2 ou 3')
    tt = sum(tamanhos.values()) or 1
    ts = [k for k, v in tamanhos.items() if v / tt >= 0.02]
    if len(ts) > 7:
        ctx.A('tamanhos-demais', 'nota', '', f'{len(ts)} tamanhos de letra diferentes ({", ".join(str(round(x, 1)) for x in sorted(ts))}pt): padronize numa escala curta')
    if not titulos and sum(palavras(b['texto']) for b in ctx.blocos) > 400:
        ctx.A('sem-titulos', 'nota', '', 'documento longo sem nenhum estilo de título: sem sumário nem navegação')
    ctx.info['titulos'] = titulos

    # arquivo por dentro
    z = zipfile.ZipFile(caminho)
    nomes = z.namelist()
    xml = z.read('word/document.xml').decode('utf8', 'replace')
    if re.search(r'<w:(?:ins|del) ', xml):
        ctx.A('revisao-pendente', 'bloqueia', '', 'há alterações controladas (revisão) não aceitas ou rejeitadas: o texto final pode ter trechos riscados ou sugeridos')
    if 'word/comments.xml' in nomes:
        n = len(re.findall(r'<w:comment ', z.read('word/comments.xml').decode('utf8', 'replace')))
        if n: ctx.A('comentarios-pendentes', 'corrigir', '', f'{n} comentário(s) esquecido(s) no documento')
    if re.search(r'<w:(?:ins|del) ', xml) is None and 'w:rPrChange' in xml:
        ctx.A('revisao-pendente', 'nota', '', 'há histórico de mudança de formatação guardado no arquivo')
    sem_alt = len(re.findall(r'<wp:docPr(?![^>]*\bdescr="[^"]+")[^>]*>', xml))
    n_img = len(re.findall(r'<wp:docPr ', xml)); ctx.info['imagens'] = n_img
    if sem_alt: ctx.A('imagem-sem-alt', 'corrigir', '', f'{sem_alt} imagem(ns) sem texto alternativo (acessibilidade): descreva o que mostra ou marque como decorativa')
    ctx.info['numeracao'] = any('PAGE' in z.read(n).decode('utf8', 'replace') for n in nomes if re.match(r'word/footer\d*\.xml$', n))
    estilos = z.read('word/styles.xml').decode('utf8', 'replace') if 'word/styles.xml' in nomes else ''
    m = re.search(r'<w:lang [^>]*w:val="([^"]+)"', estilos)
    if m and ctx.pt and m.group(1).lower().startswith('en'):
        ctx.A('idioma-do-arquivo', 'nota', '', f'o idioma de revisão padrão do arquivo é {m.group(1)}: o corretor do Word vai sublinhar o texto em português (selecione tudo e defina Português (Brasil))')
    for rel in d.part.rels.values():
        if rel.is_external and rel.reltype.endswith('/hyperlink'):
            alvo = rel.target_ref or ''
            if re.search(r'example\.(?:com|org)|localhost|127\.0\.0\.1|seudominio|xxx|^#?$|\.\.\.', alvo, re.I):
                ctx.A('link-de-exemplo', 'corrigir', '', f'link aponta para endereço de exemplo ou vazio: "{alvo[:60]}"')
    cp = d.core_properties
    for campo, v in (('autor', cp.author), ('última modificação por', cp.last_modified_by), ('título', cp.title), ('comentários', cp.comments), ('assunto', cp.subject)):
        if v and SUSPEITOS_META.search(v):
            ctx.A('metadados', 'corrigir', '', f'propriedade "{campo}" do arquivo diz "{v[:50]}": sobra de ferramenta; ajuste em Arquivo > Informações')
    if not (cp.title or '').strip():
        ctx.A('metadados', 'nota', '', 'o arquivo não tem título nas propriedades (aparece em branco no leitor de PDF e no Explorer)')
    s0 = d.sections[0]
    if ctx.pt and abs(s0.page_width - CARTA_W) < 30000 and ctx.opc.get('papel') != 'carta':
        ctx.A('papel-carta', 'corrigir', '', 'a página está em Carta (21,6 × 27,9 cm); no Brasil o padrão é A4 (21 × 29,7 cm). Mude em Layout > Tamanho, ou ponha "papel": "carta" no contrato se for de propósito')


def render_docx(ctx, caminho):
    """Abre uma cópia no Word, atualiza campos e exporta PDF; depois mede o PDF."""
    import shutil
    copia = ctx.saida / '_copia.docx'
    shutil.copyfile(caminho, copia)
    pdf = ctx.saida / 'documento.pdf'
    try:
        with word() as w:
            d = w.Documents.Open(str(copia.resolve()), ReadOnly=True, AddToRecentFiles=False, Visible=False, ConfirmConversions=False)
            try: d.Fields.Update()
            except Exception: pass
            d.ExportAsFixedFormat(str(pdf.resolve()), 17)
            d.Close(False)
    except Exception as e:
        ctx.aviso(f'páginas não renderizadas (Word indisponível): {type(e).__name__}: {str(e)[:120]}')
        return False
    finally:
        try: copia.unlink()
        except Exception: pass
    analisar_pdf(ctx, pdf, ctx.info.get('titulos', []))
    if ctx.info.get('paginas', 0) > 2 and not ctx.info.get('numeracao'):
        ctx.A('sem-numero-de-pagina', 'nota', '', f'documento de {ctx.info["paginas"]} páginas sem número de página no rodapé')
    return True
