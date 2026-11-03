# Contrato do toc

Arquivo JSON em `.claude/toc/contrato.json`, na raiz do projeto. Caminhos relativos partem da raiz.
O contrato diz o que "pronto" quer dizer **para este pedido**. Nada que o usuário não pediu vira item.

## Campos comuns

| Campo | Obrigatório | O que é |
|---|---|---|
| `pedido` | sim | o pedido do usuário, com as palavras dele |
| `url` ou `arquivo` | um dos dois | página servida (`http://localhost:8123/`), HTML local, ou o arquivo entregue (`.docx`, `.pptx`, `.xlsx`, `.csv`, `.pdf`, `.md`, `.txt`) |
| `itens` | sim | o que precisa estar certo (tipos abaixo) |
| `naoMexer` | não | o que não pode ser alterado (aparece em toda devolução do hook) |
| `estilo` | não | `idioma` ("pt-BR"), `slop` (false desliga os padrões de texto de IA), `ortografia` (false desliga o corretor do Word), `travessaoMax`, `palavrasOk` (termos certos que o corretor não conhece), `papel` ("carta" se for de propósito) |
| `observar` | não | o que, mudando, pede nova conferência. Padrão: o próprio arquivo (documento) ou o projeto inteiro (página) |
| `notaMinima` | não | nota mínima do revisor (80) |
| `dispensas` | não | achados aceitos de propósito: `{"regra", "seletor"?, "contem"?, "motivo"}`. `"regra": "texto"` cobre todos os `texto-*` |

## Só para página web

| Campo | O que é |
|---|---|
| `telas` | padrão `["1440x900", "768x1024", "390x844"]` |
| `movimento` | padrão `["normal", "reduzido"]` (reduzido = `prefers-reduced-motion: reduce`) |
| `fotos` | telas fotografadas; padrão: a primeira e a última |
| `preparo` | JS que roda antes da página (ex.: pular intro gravando em sessionStorage) |
| `pronto` | expressão JS verdadeira quando a página terminou de montar |
| `esperaMs` / `passoMs` / `paralelo` | espera depois de pronto (1200), a cada passo de rolagem (700), visitantes ao mesmo tempo (3) |
| `escalaEspaco` | escala de espaçamento em px; valores fora viram nota |
| `navegador.sessao` | sessão salva por `toc login URL` (padrão `.claude/toc/sessao.json`): loja com senha, área logada. Não versione |
| `paginaDeLogin` | `true` quando a página pedida É a tela de login (senão a conferência acha que foi barrada e para) |
| `antes` | comando que roda (e termina) antes de cada conferência, a partir da raiz: build, cópia, geração. Falhou, a conferência não roda e o hook mostra o erro. Servidor que precisa reiniciar depois do build não cabe aqui: use o modo dev (recarrega sozinho) ou um servidor estático que releia a pasta |
| `antesTimeoutMs` | limite do `antes` (padrão 600000). O hook do Claude Code tem 600 s no total: build longo + conferência pode estourar |

Projeto fora da pasta da sessão: o contrato fica na raiz da sessão (é lá que o hook procura) e `observar` leva caminhos absolutos da pasta do projeto.

## Tipos de item

Todo item tem `id` (C1, C2…), `tipo`, `descricao` e `origem` (`pedido` ou `regra do projeto`).

**Página** (opcionais `telas` e `movimento`):

| tipo | campos | passa quando |
|---|---|---|
| `existe` | `seletor` | o elemento existe e não está `display:none` |
| `texto` | `seletor` + `igual` / `contem` / `regex` | o texto visível do elemento confere |
| `semTexto` | `padrao` (regex) | o padrão não aparece no texto visível |
| `visivelSemRolar` | `seletor` | o elemento aparece inteiro na primeira tela |
| `css` | `seletor`, `prop` + `valor` ou `entre: [min, max]` | o valor calculado confere |
| `contraste` | `seletor`, `minimo` (4.5) | contraste medido na foto atinge o mínimo |
| `js` | `expr` | a expressão devolve verdadeiro (ou `{ok, detalhe}`) |

**Documento, apresentação, planilha**:

| tipo | campos | passa quando |
|---|---|---|
| `texto` / `existe` | `igual` / `contem` / `regex`, `em` opcional (`titulo`, `corpo`, `lista`, `notas`, `rotulo`) | o texto aparece (no papel indicado) |
| `semTexto` | `padrao` | o padrão não aparece em lugar nenhum |
| `contagem` | `o` (`paginas`, `slides`, `abas`, `palavras`, `imagens`, `titulos`, `linhas`) + `igual` / `min` / `max` | a contagem bate |
| `estrutura` | `lista` de títulos, `modo` (`contem` ou `ordem`) | os títulos (seções, títulos de slide, nomes de aba) estão lá |
| `celula` | `ref` ("Aba!B7"), `igual` / `contem` / `entre`, `formula: true` | a célula tem o valor (calculado no Excel) e não está com erro |

**Qualquer entrega**: `revisor` — o revisor julga nas fotos e no texto e diz por quê. Use para o que não tem número ("tom direto", "o celular tem composição própria").

## Exemplos

Página:

```json
{
  "pedido": "hero com o título 'Seu estoque em ordem', botão de contato visível sem rolar no celular, sem travessão no texto",
  "url": "http://localhost:3000/",
  "observar": ["src"],
  "itens": [
    {"id": "C1", "tipo": "texto", "seletor": "h1", "igual": "Seu estoque em ordem", "descricao": "título do hero"},
    {"id": "C2", "tipo": "visivelSemRolar", "seletor": ".hero .cta", "telas": ["390x844"], "descricao": "botão de contato sem rolar no celular"},
    {"id": "C3", "tipo": "semTexto", "padrao": "—", "descricao": "sem travessão", "origem": "regra do projeto"},
    {"id": "C4", "tipo": "revisor", "descricao": "ilustração grande atrás do título"}
  ],
  "naoMexer": ["logo e paleta"],
  "estilo": {"palavrasOk": ["checkout"]}
}
```

Proposta em Word:

```json
{
  "pedido": "proposta de 2 páginas com Contexto, Escopo e Investimento; valor de R$ 4.500",
  "arquivo": "entregas/proposta.docx",
  "itens": [
    {"id": "C1", "tipo": "estrutura", "lista": ["Contexto", "Escopo", "Investimento"], "modo": "ordem", "descricao": "seções pedidas, nessa ordem"},
    {"id": "C2", "tipo": "contagem", "o": "paginas", "max": 2, "descricao": "até 2 páginas"},
    {"id": "C3", "tipo": "texto", "contem": "R$ 4.500", "descricao": "valor combinado"},
    {"id": "C4", "tipo": "revisor", "descricao": "tom direto, sem jargão"}
  ]
}
```

Planilha:

```json
{
  "pedido": "planilha de pedidos com total geral",
  "arquivo": "pedidos.xlsx",
  "itens": [
    {"id": "C1", "tipo": "celula", "ref": "Pedidos!C20", "formula": true, "descricao": "total geral calculado por fórmula"},
    {"id": "C2", "tipo": "estrutura", "lista": ["Pedidos", "Resumo"], "descricao": "abas Pedidos e Resumo"}
  ]
}
```
