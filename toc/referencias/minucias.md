# Minúcias

Duas listas: o que o script mede sozinho (sim ou não, sem opinião) e o que fica para o olho do revisor.

## Medido pelo script (`conferir.mjs`)

Rodado em cada tela e modo de movimento do contrato, rolando a página do topo ao fim como um visitante.

| Regra | Gravidade | O que mede |
|---|---|---|
| `abrir`, `erro-js` | bloqueia | página não abre; exceção JS não tratada |
| `rede` | bloqueia (mesma origem) / corrigir (terceiros) | arquivo que falha ou responde 4xx/5xx |
| `console` | corrigir | erro no console |
| `rolagem-lateral` | bloqueia | a página rola para o lado |
| `fora-da-tela` | bloqueia | texto passando da borda sem ninguém recortar |
| `texto-provisorio` | bloqueia | lorem ipsum, undefined, NaN, [object Object], TODO, {{variável}} |
| `imagem`, `video` | bloqueia (quebrada) / corrigir (esticada) | mídia que não carrega; imagem com proporção trocada |
| `fonte` | bloqueia / corrigir / nota | fonte que falhou; família usada sem nenhuma variação carregada; peso não declarado (negrito sintético) |
| `contraste` | corrigir / nota | **medido na foto**: separa pixels da letra e do fundo, inclusive sobre vídeo, canvas e WebGL. Corrigir se o fundo típico não atinge 4,5:1 (3:1 em texto grande); nota se só parte do fundo derruba |
| `cortado` | corrigir / nota | texto escondido por overflow sem reticências; máscara encostando na letra vira nota |
| `sobreposicao` | corrigir / nota | texto por cima de texto; passar por baixo de cabeçalho fixo é nota |
| `alvo-de-toque` | corrigir (< 24px) / nota (< 44px) | no celular, área de toque de link e botão (link no meio do texto não conta) |
| `viuva` | corrigir (h1, h2) / nota (h3) | uma palavra sozinha na última linha do título |
| `quase-alinhado` | corrigir | vizinhos com bordas a 2 a 4px uma da outra (mais que isso é intenção; menos é arredondamento) |
| `foco` | corrigir | nada muda quando o elemento recebe foco pelo Tab |
| `nome-acessivel`, `alt` | corrigir | link ou botão sem nome; imagem sem alt |
| `salto-de-layout` | corrigir | CLS acima de 0,1 no carregamento |
| `escala`, `cinzas`, `sombra`, `caixa-alta` | nota | espaços fora da escala; cinzas quase iguais; sombras com luz de dois lados; caixa-alta pequena sem espaçamento |

| `palavra-pendurada`, `controle-fixo` | corrigir | palavra de uma letra no fim da linha do título; botão fixo (pausa, chat) por cima de outro clicável |
| `repetido` | nota | a mesma frase duas vezes na mesma tela (menu e rodapé não contam) |
| `cinza-sobre-cor`, `hierarquia-achatada`, `tamanhos-demais`, `tudo-centralizado`, `titulo-longo`, `rotulo-acima-do-titulo`, `espaco-do-titulo`, `linha-longa`, `texto-gradiente`, `faixa-lateral`, `animacao-elastica`, `numeros-tabulares`, `superficies-do-navegador` | nota | sinais de interface gerada e de acabamento (ideias do Impeccable e do Taste Skill): texto cinza em fundo colorido, títulos e texto quase do mesmo tamanho, mais de 9 tamanhos, mais de 72% centralizado, título de 4+ linhas, etiqueta miúda ou 01/02 acima do título, título mais longe do próprio texto, linha com mais de 95 caracteres, gradiente no texto, faixa colorida na lateral de cartão, easing elástico, números de tabela sem algarismos tabulares, seleção de texto sem a cor da marca |
| `mudanca-visual` | nota | diff com a rodada anterior (tolerante a serrilhado; canvas, vídeo e animação em loop ficam de fora): mostra onde a imagem mudou, para pegar "corrigiu A e quebrou B" (`folha-mudancas`) |
| `olhar-apertado` | nota | teste do olhar apertado: borra a primeira tela e acha onde o olho cai; avisa quando não é no título nem na ação principal |

Texto com `aria-hidden` (visual decorativo) fica fora das medições de texto.
O que o script não mede: estado de hover, gosto, hierarquia, se a peça cumpre o pedido. Isso é do revisor.

## Para o olho (revisor)

Escolha as 3 categorias que mais rendem na página e vá fundo. As outras não entram no veredito.

1. **Hierarquia.** Apertando os olhos, o mais importante aparece primeiro? Uma ação principal por tela, não três disputando.
2. **Ritmo de espaços.** Distâncias parecidas parecem iguais? Seções com respiro coerente; nada espremido ou solto.
3. **Grade e bordas.** As bordas esquerdas de título, texto e cartões caem na mesma linha entre seções?
4. **Tipografia.** Escala clara entre títulos e texto; linhas de 50 a 75 caracteres; entrelinha folgada no corpo e justa no título; quebras de linha que não separam palavras que andam juntas.
5. **Cor.** Mesma cor quer dizer a mesma coisa em toda a página; poucas cores; destaque usado com parcimônia.
6. **Consistência de peças.** Botões, cartões, campos e ícones da mesma família com o mesmo raio, borda, sombra e altura. Raio interno = raio externo − espaço interno.
7. **Centragem óptica.** Texto dentro de botão e pílula parece centrado (não só matematicamente); ícone alinhado à altura das maiúsculas.
8. **Estados.** Hover perceptível sem ser brusco; ativo e desabilitado distinguíveis.
9. **Celular.** Composição própria, não a do desktop espremida; nada importante escondido; títulos que não quebram em uma palavra por linha.
10. **Movimento.** Entradas suaves, nada piscando ou pulando; com movimento reduzido, a página continua completa e legível.
11. **Mídia.** Recortes de foto e vídeo que não cortam o assunto; nada pixelado ou esticado.
12. **Conteúdo.** Ortografia, acentos, pontuação; textos de exemplo esquecidos; números e nomes coerentes entre seções.

## Documentos, apresentações e planilhas (`doc.py`)

| Tipo | Medido pelo script |
|---|---|
| Todos | texto (`slop.mjs`: texto de modelo esquecido, palavra repetida, pontuação, formatos de número, data e moeda misturados, grafia do mesmo nome, listas inconsistentes, padrões de texto de IA, travessão); ortografia pelo corretor do Word; sobra de ferramenta nos metadados ("python-docx", "openpyxl", "Steve Canny") |
| docx | título que pula nível, título falso (negrito em estilo Normal), lista digitada à mão, parágrafos vazios como espaço, fontes demais, tabela sem cabeçalho ou mais larga que a página, imagem sem alt, revisão e comentários pendentes, link de exemplo, papel Carta em texto em português, idioma de revisão errado. Com o Word: páginas em PDF, página em branco, texto fora da margem, título no pé da página, última página quase vazia, campo com "Erro!", falta de número de página |
| pptx | slide sem título ou oculto, caixa vazia, texto que não cabe na caixa (estimado com a fonte real), texto por cima de texto, objeto fora do slide, quase alinhado, título mudando de lugar entre slides, fonte abaixo de 12pt, slide com texto demais, fontes demais, contraste (cores conhecidas), imagem esticada ou de baixa resolução, gráfico sem título. Não abre o PowerPoint: o revisor recebe um esboço aproximado |
| xlsx | erro de fórmula (calculado numa cópia no Excel quando o arquivo não tem valores salvos), fórmula sem valor salvo, referência quebrada, vínculo externo, número como texto, tipos misturados, data como texto, formato inconsistente, número sem formato, soma que não pega todas as linhas, fórmula fora do padrão da coluna, número fixo na fórmula, coluna estreita (####), texto cortado, categoria escrita de dois jeitos, aba com nome padrão ou oculta, cabeçalho sem destaque ou não congelado, linha vazia ou duplicada. O revisor recebe uma imagem aproximada das abas |
| csv | codificação, acento corrompido, colunas desiguais, cabeçalho repetido ou vazio, decimal misto |
| pdf | página em branco, texto na borda, fonte minúscula, imagem de baixa resolução, metadados |
| md | título que pula nível, bloco de código sem fechar, link vazio ou quebrado, tabela torta |

O que não foi possível conferir aparece no relatório como `nao-conferido` (nota): sem Word não há corretor nem páginas; sem Excel não há cálculo.

## Para o olho em documentos (revisor)

1. **Cumpre o pedido.** Todas as seções, números e nomes pedidos estão lá, nesta ordem, com este tom.
2. **Erro bobo.** Palavra trocada, concordância, número que não bate entre trechos, total que não fecha, nome do cliente diferente em dois lugares, data e dia da semana que não combinam.
3. **Hierarquia.** Títulos dizem o que vem embaixo; o leitor acha o que procura em 10 segundos.
4. **Densidade.** Slide com uma ideia; documento sem parágrafo de 15 linhas; planilha que dá para ler sem zoom.
5. **Consistência.** Mesmos termos, mesma pontuação nos itens de lista, mesma grafia de marcas e números, mesmo formato de data.
6. **Texto de IA.** Padrões de `texto.md` que o script não pegou: ritmo robótico, sinônimos girando, frase que serviria para qualquer empresa.

Fontes do catálogo: ver `CREDITOS.md`.
