---
name: toc
description: TOC (Transtorno Obsessivo-Compulsivo) / OCD for your agent. Não deixa o Claude dizer "pronto" com erro bobo na entrega. Transforma o pedido num contrato, confere a coisa de verdade (página web em 3 telas, Word, PowerPoint, Excel, CSV, PDF, Markdown: contraste, texto cortado, fórmula com erro, soma que pula linha, ortografia, padrões de texto de IA, sobra de ferramenta) e um hook de Stop segura o Claude até contrato, scripts e um revisor de fora fecharem, com limite de rodadas. Use quando o usuário pedir "modo toc", "/toc", "não para até ficar perfeito", "revisa nos mínimos detalhes", "não deixa passar erro bobo", "OCD mode", "don't stop until it's perfect". Não use em toda tarefa: cada rodada custa de segundos a minutos.
---

# toc

**TOC** (Transtorno Obsessivo-Compulsivo) · **OCD** (Obsessive-Compulsive Disorder), para o agente.

Aquela coceira de voltar para conferir se trancou a porta, só que apontada para a entrega: enquanto houver
`[inserir valor]` na proposta, `#DIV/0!` no total ou botão cobrindo botão no celular, o Claude não para.

A obsessão é com **o que o usuário pediu**, não com o gosto do Claude. "Perfeito" é o contrato fechado,
conferido por script e por um revisor que não fez a entrega. Quem impede de parar é o hook, não a vontade.
E tem botão de desligar: limite de rodadas e relatório honesto do que ficou aberto.

`<skill>` abaixo é a pasta desta skill (onde está este arquivo). `toc` abrevia `node "<skill>/scripts/toc.mjs"`.

## Peças

| Peça | Onde | Papel |
|---|---|---|
| Contrato | `.claude/toc/contrato.json` no projeto | define o que "pronto" quer dizer. Formato: `referencias/contrato.md` |
| Conferência | `scripts/conferir.mjs` (página, Playwright) e `scripts/doc.py` (documentos) | olho mecânico. Lista em `referencias/minucias.md` |
| Texto | `scripts/slop.mjs` + corretor do Word | erros bobos e padrões de texto de IA. Conserto: `referencias/texto.md` |
| Revisor | subagente | olho de fora sobre fotos e texto. Roteiro: `referencias/revisor.md` |
| Trava | hook Stop → `toc hook` | ao tentar terminar, confere; se faltar algo, devolve a lista e o Claude continua |

## Fluxo

1. **Contrato primeiro.** Leia o pedido e as regras do projeto (CLAUDE.md, AGENTS.md, specs). Escreva `.claude/toc/contrato.json`:
   - cada item é algo que o usuário pediu (palavras dele em `descricao`) ou regra escrita do projeto (`origem: "regra do projeto"`);
   - prefira tipos que o script confere; o que só olho humano julga vira `revisor`;
   - nada que o usuário não pediu vira item. Ideias suas vão para o relatório final como sugestão;
   - `naoMexer`: decisões aprovadas e o que o usuário mandou preservar;
   - `url` ou `arquivo`; em página com intro ou carregamento pesado, `preparo` e `pronto`; em texto, `estilo.idioma` e `estilo.palavrasOk`.

   Mostre o contrato ao usuário em até 8 linhas e siga. Só pare para perguntar se um item essencial estiver ambíguo.
2. **Ligue:** `toc iniciar` (padrão 8 rodadas; `--max N` muda).
3. **Faça ou corrija.** Para ver o estado sem esperar o hook: `toc conferir`. Abra as folhas de fotos (`rodada-NN/folha-*.jpg`) e o `texto.md`: olhar é obrigatório.
4. **Tente terminar.** O hook confere (ou reaproveita, se nada mudou) e responde:
   - pendências mecânicas: corrija `bloqueia` antes de `corrigir`; texto se conserta com `referencias/texto.md`;
   - "falta o olho de fora": chame o revisor (Agent, `model: "sonnet"`) com `referencias/revisor.md` preenchido e, em seguida, rode `toc esperar`: ele marca o revisor como em andamento e espera o veredito (tentar terminar enquanto o revisor trabalha não gasta rodada). Peça ao revisor a `area` de cada pendência. Da 2ª vez em diante o hook monta a **reconferência barata**: um pacote com recortes "antes | agora" só das pendências e das mudanças fora delas; o prompt é "Você é o reconferente do toc. Leia e siga <pacote>", em Haiku. Ela fecha item a item, sem nota. Revisão completa de novo só quando o hook pedir. Não escreva o veredito você mesmo. Se o projeto exigir outro modelo para delegar, pause e pergunte;
   - pendências do revisor: corrija; conferência e revisor rodam de novo sobre o resultado novo;
   - nada: o laço fecha.
5. **Relatório final** (sua última mensagem quando achar que fechou; se o hook devolver, continue e reescreva no fim).

## Regras durante o laço

- **Escopo.** Corrija o que o contrato e as minúcias apontam. Não redesenhe, não troque nada de `naoMexer`, não "melhore" o que ninguém pediu.
- **Não engane a conferência.** Proibido: esconder elemento, pôr `aria-hidden` em texto real, apagar ou afrouxar item, editar o veredito, dispensar sem motivo. Dispensa só para decisão do usuário ou falso positivo comprovado, e entra no relatório.
- **Texto:** edição mínima, mantém voz e sentido, não inventa número, exemplo nem fonte. Afirmação sem fonte: pergunte.
- **Arquivo:** em docx, pptx e xlsx edite no trecho (run, caixa, célula); regravar do zero apaga a formatação.
- **Correção com valor** ("margin-top 22px → 24px"), não adjetivo.
- **Precisa do usuário?** `toc pausar`, pergunte, `toc retomar`. Usuário mandou parar: `toc parar`.
- **Página atrás de login ou senha** (loja fechada, painel): a conferência percebe que caiu na tela de login, para e marca os itens como não conferidos. Rode `toc login URL` em segundo plano e peça ao usuário para entrar na janela e fechá-la; a sessão fica em `.claude/toc/sessao.json` e as próximas conferências entram logadas. Você nunca digita senha ou código.
- **Fonte, tamanho, cor:** afirme pela ficha tipográfica do `texto.md` (valores calculados), não pela foto.
- **Tempo.** Documento: 10 a 30 s por conferência (Word e Excel abrem em instância própria). Página: 1 a 3 min. Se a página depende de servidor, deixe-o rodando.
- Aprovação é do usuário. O laço fechar quer dizer "o combinado foi conferido", não "ficou perfeito".

## Relatório final

- Contrato item a item: ok ou falha, com evidência (foto, página, número medido).
- O que mudou em cada rodada, em uma linha cada.
- Dispensas e o motivo de cada uma.
- Até 5 notas não perseguidas e as sugestões fora do pedido.
- Rodadas usadas, modelo do revisor e o que não foi conferido (aparece como `nao-conferido` no relatório: corretor, páginas, cálculo).

## Requisitos e instalação

- Node 18+. Página: Playwright alcançável a partir do projeto (`npm i -D playwright`) e Chrome instalado (ou caminho em `TOC_CHROME`).
- Documentos: Python 3 com `python-docx python-pptx openpyxl pymupdf pillow` (Python em `TOC_PYTHON` se não for `python`). No Windows com Office e `pywin32`: corretor do Word, páginas do docx em PDF e cálculo das fórmulas no Excel. Sem eles, essas partes viram aviso. O PowerPoint nunca é aberto.
- Hook Stop no `settings.json` do Claude Code (ver README do repositório). Ele só age em projeto com `.claude/toc/estado.json` ativo e na sessão que ligou o laço.

Créditos das ideias reaproveitadas: `CREDITOS.md`.
