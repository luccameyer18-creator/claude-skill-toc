# toc: o Claude que não para até o combinado estar certo

Skill para o [Claude Code](https://claude.com/claude-code) que deixa o Claude perfeccionista com qualquer entrega: página web, documento Word, apresentação, planilha, CSV, PDF ou Markdown.

Ele transforma o seu pedido num **contrato verificável**, confere a entrega com script, chama um **revisor de fora** (subagente que não fez a entrega) e um **hook de Stop** não deixa o Claude encerrar enquanto algo do contrato estiver aberto. Tem limite de rodadas, então não vira loop infinito.

> *A skill is for Claude Code. It turns your request into a checkable contract, inspects the deliverable (web page, docx, pptx, xlsx, csv, pdf, md) with scripts, asks an independent reviewer subagent, and a Stop hook keeps Claude working until the contract passes or a round limit is hit. Docs are in Portuguese.*

## O que ele pega

**Página web** (Playwright, 3 telas, movimento normal e reduzido, rolando do topo ao fim):
contraste medido na foto (inclusive sobre vídeo e WebGL), texto cortado ou saindo da tela, texto por cima de texto, botão fixo cobrindo outro, quase alinhado (2 a 4px), palavra sozinha ou pendurada no título, área de toque, foco invisível, imagem esticada ou quebrada, fonte que não carregou, erro de console e rede, salto de layout.

Sinais de interface gerada e acabamento (ideias do [Impeccable](https://github.com/pbakaus/impeccable) e do [Taste Skill](https://github.com/Leonxlnx/taste-skill)): cinza sobre fundo colorido, hierarquia de tipo achatada, tamanhos de letra demais, tudo centralizado, etiqueta miúda ou 01/02 acima do título, easing elástico, faixa colorida na lateral, texto com gradiente, seleção de texto sem a cor da marca.

**Visão, leve (só Pillow):**
- **Diff entre rodadas.** Cada rodada é comparada com a anterior e o que mudou ganha um retângulo vermelho. Pega o "corrigiu A e quebrou B". O diff tolera serrilhado, como o pixelmatch e o odiff, e ignora canvas, vídeo e animação em loop.
- **Olhar apertado.** A primeira tela é borrada para achar onde o olho cai primeiro. Avisa quando não cai no título nem na ação principal.

**Documentos:**

| Tipo | Exemplos de erro pego |
|---|---|
| docx | título que pula nível, título falso, lista digitada à mão, linhas vazias, fontes demais, revisão e comentários esquecidos, papel Carta em texto em português, e com o Word: página em branco, título no pé da página, campo com "Erro!" |
| pptx | texto que não cabe na caixa (estimado com a fonte real), texto por cima de texto, fonte de 9pt, contraste, slide sem título ou com texto demais, título mudando de lugar entre slides |
| xlsx | `#DIV/0!` e `#REF!` (calculado no Excel), fórmula sem valor salvo, soma que não pega a última linha, fórmula fora do padrão da coluna, número guardado como texto, coluna estreita (####), "São Paulo" e "sao paulo " na mesma coluna |
| csv, pdf, md | codificação, colunas desiguais, link quebrado, bloco de código sem fechar, página em branco |

**Texto, em qualquer entrega:** erro bobo (texto de modelo esquecido, palavra repetida, vírgula colada, formatos misturados), ortografia pelo corretor do Word, sobra de ferramenta nos metadados ("python-docx", "openpyxl") e padrões de texto de IA em português e inglês ("não é só X, mas Y", "vale ressaltar", "estudos mostram", travessão demais, fecho com "em suma"). Ele nomeia o padrão e cita o trecho; não dá nota de "cara de IA".

## Como funciona

1. Você pede "modo toc" (ou "não para até ficar perfeito").
2. O Claude escreve `.claude/toc/contrato.json` com o que você pediu e o que não pode ser mexido, mostra e liga o laço.
3. Ao tentar terminar, o hook confere. Faltou algo: devolve a lista e o Claude continua.
4. Passou no script: o hook exige o revisor (subagente Sonnet), que olha fotos e texto e grava um veredito.
5. Fecha quando contrato, script e revisor não têm pendência, ou quando acabam as rodadas (padrão 8). O relatório final diz o que ficou aberto.

## Instalação

1. Copie a pasta `toc/` para `~/.claude/skills/toc/`.
2. Requisitos:
   - Node 18+.
   - Página web: Playwright no projeto (`npm i -D playwright`) e Chrome instalado (ou o caminho em `TOC_CHROME`).
   - Documentos: Python 3 com `pip install python-docx python-pptx openpyxl pymupdf pillow`.
   - Opcional, Windows com Office: `pip install pywin32` para corretor do Word, páginas do docx em PDF e cálculo das fórmulas no Excel (instâncias próprias, sem mexer nos arquivos abertos). O PowerPoint nunca é aberto.
3. Adicione o hook de Stop em `~/.claude/settings.json`. Ele só abre o Node se o projeto tiver um laço ligado:

   Windows (Git Bash):
   ```json
   {
     "hooks": {
       "Stop": [{"hooks": [{"type": "command", "timeout": 600,
         "command": "\"C:/Program Files/Git/bin/bash.exe\" -c \"test -f .claude/toc/estado.json || exit 0; exec node \\\"$HOME/.claude/skills/toc/scripts/toc.mjs\\\" hook\""}]}]
     }
   }
   ```

   macOS e Linux:
   ```json
   {
     "hooks": {
       "Stop": [{"hooks": [{"type": "command", "timeout": 600,
         "command": "test -f .claude/toc/estado.json || exit 0; exec node \"$HOME/.claude/skills/toc/scripts/toc.mjs\" hook"}]}]
     }
   }
   ```

   O hook vale em sessões abertas depois da instalação.

## Comandos

```bash
node ~/.claude/skills/toc/scripts/toc.mjs iniciar [--max 8]   # liga o laço no projeto
node ~/.claude/skills/toc/scripts/toc.mjs conferir            # confere agora e mostra o resumo
node ~/.claude/skills/toc/scripts/toc.mjs status | pausar | retomar | parar
python -I ~/.claude/skills/toc/scripts/doc.py extrair ARQUIVO PASTA   # só o leitor de documentos
python -I ~/.claude/skills/toc/scripts/doc.py recalcular planilha.xlsx # grava os valores das fórmulas
node ~/.claude/skills/toc/scripts/slop.mjs texto.md                   # só o verificador de texto
```

O formato do contrato está em [`toc/referencias/contrato.md`](toc/referencias/contrato.md).

## Testar

`exemplos/gerar_amostras.py` cria docx, pptx e xlsx "sujos" (erros plantados e marcados) e "limpos". Os sujos devem acusar os erros; os limpos, nada.

```bash
python exemplos/gerar_amostras.py amostras
python -I toc/scripts/doc.py extrair amostras/sujo.xlsx saida/xlsx
python exemplos/ver.py saida/xlsx
```

## Limites honestos

- O script mede; gosto é do revisor e, no fim, seu. O laço fechar quer dizer "o combinado foi conferido", não "ficou perfeito".
- Texto que não cabe em slide é estimativa (o PowerPoint não é aberto); o revisor recebe um esboço aproximado do slide.
- Sem Word ou Excel, corretor, páginas e cálculo viram aviso `nao-conferido` no relatório.
- Os padrões de texto de IA em português são adaptação própria e podem acusar falso positivo; existe `dispensas` no contrato para isso, e toda dispensa aparece no relatório.
- Cada rodada de página leva de 1 a 3 minutos; de documento, 10 a 30 segundos.

## Créditos

Ideias reaproveitadas (nenhum arquivo copiado) do Ralph Loop (Anthropic), visual-verdict (oh-my-claudecode), design-review (OneRedOak e jezweb), design-review-loop (landing-craft), Taste Skill, Impeccable, pixelmatch, odiff e da skill no-ai-slop. Detalhes em [`toc/CREDITOS.md`](toc/CREDITOS.md).

## Licença

MIT. Veja [LICENSE](LICENSE).
