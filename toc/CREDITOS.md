# Créditos

O toc foi escrito do zero em Node e português. Nenhum arquivo foi copiado; as ideias abaixo foram lidas e adaptadas
em 03/11/2026. Licenças dos originais:

| Fonte | Licença | O que veio de lá |
|---|---|---|
| Ralph Loop, Anthropic (`anthropics/claude-plugins-official`, `plugins/ralph-loop`) | Apache-2.0 | trava pelo hook Stop com `{"decision": "block", "reason": …}`; arquivo de estado no projeto; isolamento por sessão; limite de rodadas; aviso de "não minta para sair" |
| visual-verdict, Yeachan-Heo (`oh-my-claudecode`) | MIT | veredito em JSON estrito com nota de 0 a 100 e limiar para continuar; diferenças com sugestão concreta |
| design-review, OneRedOak / Patrick Ellis (`claude-code-workflows`) | MIT | revisor separado em `sonnet` olhando a página viva; fases (fluxo, telas 1440/768/375, acabamento, acessibilidade, robustez, console); triagem por gravidade |
| design-review e visual-polish, jezweb (`claude-skills`) | MIT | tabelas do que checar (espaço, tipografia, cor, hierarquia, consistência, estados, responsivo); catálogo de sinais de interface gerada por máquina (centragem óptica, raio aninhado, escala de espaço, cinzas soltos, espessura de borda, direção da sombra, tempos, hover, caixa-alta); "escolha 3 e vá fundo" |
| design-review-loop, propiter / gentleman-programming (`landing-craft`) | Apache-2.0 | ciclo foto, crítica, correção com teto de rodadas; três larguras; "sempre olhe a foto antes de dizer que está bom" |
| no-ai-slop (skill comunitária de edição de texto) | — | lista de padrões de texto de IA e princípios de edição (edição mínima, manter a voz, não inventar, teste da portabilidade); resumidos e adaptados para português em `referencias/texto.md` e `scripts/slop.mjs`. A lista em português é adaptação do toc |

Segunda leva (03/11/2026), também só ideias, reescritas:

| Fonte | Licença | O que veio de lá |
|---|---|---|
| Taste Skill, Leonxlnx (`Leonxlnx/taste-skill`) | MIT | registro datado de sinais de página gerada: título de 4+ linhas, tudo centralizado, mais de 9 tamanhos de letra, etiqueta miúda e numeração 01/02 acima do título, "Saiba mais"/"Get started" como rótulo, vocabulário de marketing (seamless, effortless, all-in-one), emoji como ícone |
| Impeccable, Paul Bakaus (`pbakaus/impeccable`) | Apache-2.0 | detectores determinísticos de antipadrão: cinza sobre cor, hierarquia de tipo achatada (passo menor que 1,25x), easing elástico, faixa colorida lateral, texto com gradiente; "craft floor": superfícies do navegador (seleção, foco, algarismos tabulares), mais espaço acima do título que abaixo, linha de 65 a 75 caracteres |
| pixelmatch (Mapbox, ISC) e odiff (MIT) | — | diff de imagem com tolerância a serrilhado, aplicado entre rodadas em `scripts/visao.py` (Pillow, sem copiar código) |
| OmniParser (Microsoft) | CC-BY-4.0 | lido e não usado: exige modelos e GPU. Fica a ideia de ler a tela como imagem; o toc usa visão leve (diff e olhar apertado) |

O que é novo aqui: contrato tirado do pedido com trava de escopo (`naoMexer`), conferência mecânica que o hook roda
sozinho (contraste medido na foto sobre vídeo e WebGL, cortes, quase-alinhado, viúvas, foco), impressão digital dos
arquivos para só reconferir o que mudou, e veredito do revisor amarrado a essa impressão.
