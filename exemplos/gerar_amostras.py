# Gera arquivos de amostra: cada um "sujo" (erros plantados, marcados com # PLANTADO) e "limpo" (nada a apontar).
import sys, io
from pathlib import Path
from docx import Document
from docx.shared import Pt, Cm
from pptx import Presentation
from pptx.util import Inches, Pt as PPt
from pptx.dml.color import RGBColor
import openpyxl
from openpyxl.styles import Font, PatternFill

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)

# ---------------- DOCX sujo ----------------
d = Document()                                   # PLANTADO: papel Carta, autor "python-docx"
d.add_heading('Proposta comercial', 1)
d.add_heading('Contexto', 3)                      # PLANTADO: título 1 -> título 3
d.add_paragraph('Em um mundo cada vez mais digital, a Acme potencializa a operação das PMEs, não é apenas software, mas uma solução holística.')  # PLANTADO: slop
d.add_paragraph('A informaçao chegou com recebimeto atrasado e o orcamento foi aprovado.')   # PLANTADO: ortografia
p = d.add_paragraph(); r = p.add_run('Escopo do trabalho'); r.bold = True   # PLANTADO: título falso
d.add_paragraph('- primeiro item digitado a mão')   # PLANTADO: lista manual
d.add_paragraph('- segundo item digitado a mão')
d.add_paragraph('')                                # PLANTADO: 3 vazios
d.add_paragraph('')
d.add_paragraph('')
for fam in ('Arial', 'Georgia', 'Verdana', 'Courier New'):   # PLANTADO: 4 fontes
    q = d.add_paragraph(); rr = q.add_run(f'Texto em {fam} com um tamanho próprio para testar a contagem de fontes. ' * 3); rr.font.name = fam
d.add_paragraph('O valor fica em [inserir valor] e o prazo é de 10 dias.')   # PLANTADO: placeholder
t = d.add_table(rows=3, cols=2)
t.rows[0].cells[0].text = 'Item'; t.rows[0].cells[1].text = 'Valor'
t.rows[1].cells[0].text = 'Consultoria'; t.rows[1].cells[1].text = 'R$ 1.200,00'
cp = d.core_properties; cp.author = 'python-docx'; cp.title = ''
d.save(out / 'sujo.docx')

# ---------------- DOCX limpo ----------------
d = Document()
for s in d.sections: s.page_width, s.page_height = Cm(21), Cm(29.7)
d.add_heading('Proposta comercial', 1)
d.add_heading('Contexto', 2)
d.add_paragraph('A Acme mapeia o processo de pedidos do cliente em duas semanas. Na primeira conversa, anotamos onde o trabalho trava: cadastro duplicado, planilha sem dono e aprovação por WhatsApp.')
d.add_heading('Escopo', 2)
d.add_paragraph('Montamos uma prévia funcionando com os dados do cliente, que vê o resultado antes de decidir.')
d.add_paragraph('Cadastro unificado', style='List Bullet')
d.add_paragraph('Fila de aprovação', style='List Bullet')
d.add_paragraph('Relatório semanal', style='List Bullet')
cp = d.core_properties; cp.author = 'Acme'; cp.title = 'Proposta comercial'; cp.comments = ''
d.save(out / 'limpo.docx')

# ---------------- PPTX sujo ----------------
prs = Presentation()                              # 4:3 padrão do python-pptx
lay = prs.slide_layouts[5]                        # título apenas
s = prs.slides.add_slide(lay); s.shapes.title.text = 'Proposta Acme'
tb = s.shapes.add_textbox(Inches(0.5), Inches(1.6), Inches(4), Inches(0.8))   # PLANTADO: texto grande demais para a caixa
tf = tb.text_frame; tf.word_wrap = True
tf.text = 'A Acme mapeia processos, monta software sob medida e automatiza tarefas repetitivas para pequenas e médias empresas de todo o Brasil com acompanhamento mensal.'
for r in tf.paragraphs[0].runs: r.font.size = PPt(24)
tb2 = s.shapes.add_textbox(Inches(0.52), Inches(5.0), Inches(4), Inches(0.5)); tb2.text_frame.text = 'Primeira etapa por conta da Acme'   # PLANTADO: quase alinhado (0.02in)
tb3 = s.shapes.add_textbox(Inches(0.5), Inches(4.2), Inches(4), Inches(0.5)); tb3.text_frame.text = 'Prévia antes de decidir'
for tbx in (tb2, tb3):
    for r in tbx.text_frame.paragraphs[0].runs: r.font.size = PPt(18)
low = s.shapes.add_textbox(Inches(5), Inches(6.5), Inches(4), Inches(0.5)); low.text_frame.text = 'Fonte: levantamento interno'   # PLANTADO: 9pt
for r in low.text_frame.paragraphs[0].runs: r.font.size = PPt(9)
claro = s.shapes.add_textbox(Inches(5), Inches(2), Inches(4), Inches(0.6)); claro.text_frame.text = 'Texto cinza claro no branco'   # PLANTADO: contraste
for r in claro.text_frame.paragraphs[0].runs: r.font.size = PPt(18); r.font.color.rgb = RGBColor(0xC8, 0xC8, 0xC8)
s2 = prs.slides.add_slide(prs.slide_layouts[6])  # PLANTADO: slide sem título
b = s2.shapes.add_textbox(Inches(0.5), Inches(0.5), Inches(8), Inches(5)); b.text_frame.word_wrap = True
b.text_frame.text = ' '.join(['palavra'] * 130)  # PLANTADO: slide denso
prs.core_properties.author = 'Steve Canny'
prs.save(out / 'sujo.pptx')

# ---------------- PPTX limpo ----------------
prs = Presentation(); prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)
for i, (tit, corpo) in enumerate([('Proposta Acme', 'Processos melhores. Tecnologia certa.'), ('Como funciona', 'Mapeamos, montamos a prévia e acompanhamos o resultado com você.')]):
    s = prs.slides.add_slide(prs.slide_layouts[5]); s.shapes.title.text = tit
    s.shapes.title.left, s.shapes.title.top, s.shapes.title.width, s.shapes.title.height = Inches(0.8), Inches(0.5), Inches(11.7), Inches(1.2)
    tb = s.shapes.add_textbox(Inches(0.8), Inches(2.2), Inches(11.7), Inches(1.5)); tb.text_frame.word_wrap = True; tb.text_frame.text = corpo
    for r in tb.text_frame.paragraphs[0].runs: r.font.size = PPt(28)
prs.core_properties.author = 'Acme'; prs.core_properties.title = 'Proposta Acme'
prs.core_properties.last_modified_by = 'Acme'; prs.core_properties.comments = ''
prs.save(out / 'limpo.pptx')

# ---------------- XLSX sujo ----------------
wb = openpyxl.Workbook(); ws = wb.active          # PLANTADO: aba "Sheet", autor openpyxl
ws.append(['Cliente', 'Região', 'Valor', 'Quantidade'])
dados = [('Alfa', 'São Paulo', 1200.5, 3), ('Beta', 'sao paulo ', 980.25, 2), ('Gama', 'Rio', '1.500,00', 4), ('Delta', 'Rio', 700, 1),
         ('Épsilon', 'São Paulo', 0.3333333333, 2), ('Zeta', 'Rio', 450, 5), ('Eta', 'Sul', 'n/d texto', 2), ('Teta', 'Sul', 300, 1)]
for r in dados: ws.append(r)
ws['E1'] = 'Total'
ws['E2'] = '=C2*D2*1.15'                            # PLANTADO: constante
ws['E3'] = '=C3*D3*1.15'; ws['E4'] = '=C4*D4*1.15'; ws['E5'] = '=C5*D5'    # PLANTADO: fórmula diferente
ws['E6'] = '=C6*D6*1.15'; ws['E7'] = '=C7*D7*1.15'
ws['C11'] = '=SUM(C2:C8)'                            # PLANTADO: soma não pega a linha 9
ws['C12'] = '=1/0'                                   # PLANTADO: erro (só aparece calculando)
ws.column_dimensions['C'].width = 4                  # PLANTADO: coluna estreita
for c in ws[1]: c.font = Font(bold=False)
wb.properties.creator = 'openpyxl'
wb.save(out / 'sujo.xlsx')

# ---------------- XLSX limpo ----------------
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Pedidos'
ws.append(['Cliente', 'Região', 'Valor', 'Quantidade'])
for r in [('Alfa', 'São Paulo', 1200.5, 3), ('Beta', 'São Paulo', 980.25, 2), ('Gama', 'Rio', 1500, 4), ('Delta', 'Rio', 700, 1), ('Zeta', 'Rio', 450, 5)]: ws.append(r)
ws['C7'] = '=SUM(C2:C6)'; ws['D7'] = '=SUM(D2:D6)'
for row in ws.iter_rows(min_row=2, max_row=7, min_col=3, max_col=3):
    for c in row: c.number_format = '"R$" #,##0.00'
for c in ws[1]: c.font = Font(bold=True); c.fill = PatternFill('solid', fgColor='DDDDDD')
for col in 'ABCD': ws.column_dimensions[col].width = 16
wb.properties.creator = 'Acme'; wb.properties.title = 'Pedidos'
wb.save(out / 'limpo.xlsx')
print('ok', sorted(p.name for p in out.iterdir()))
