# Texto: como consertar sem estragar

O verificador (`scripts/slop.mjs`) nomeia o padrão e cita o trecho. Quem conserta é o Claude, com estas regras.
Elas resumem, em português, os princípios da skill comunitária no-ai-slop.

## Princípios

- **Edição mínima.** Conserte o padrão apontado e o erro; deixe em paz a frase boa. Um texto com voz própria tem que continuar soando como quem escreveu.
- **Não invente.** Nada de número, exemplo, fonte ou opinião que não estava lá. Afirmação sem fonte ("estudos mostram"): pergunte ao usuário (`toc pausar`) ou corte.
- **Concreto vence abstrato.** "Melhora a eficiência" vira "cortou o fechamento de 3 dias para 1", se o dado existir. Se não existir, corte a frase vazia.
- **Teste da portabilidade.** Se a frase serve para qualquer empresa ou produto, é enchimento: corte ou troque por algo específico deste assunto.
- **Mostre, não anuncie.** Corte o comentário que diz que o ponto é importante, surpreendente ou óbvio.
- **Verbo direto.** "Tomou a decisão" vira "decidiu"; "tem a capacidade de" vira "pode".
- **Mantenha estrutura e tom**, a não ser que estejam atrapalhando. Mudou a ordem? Diga por quê no relatório.

## Padrões (o que cada achado `texto-*` quer dizer)

| Achado | Conserto |
|---|---|
| `palavra-de-ia` | troque por palavra comum ou pelo fato ("potencializa" → o que exatamente melhora) |
| `abertura-vazia` | apague a abertura ("vale ressaltar que", "em um mundo cada vez mais…") e comece pelo ponto |
| `contraste-binario` | "não é só X, mas Y" vira "é Y" |
| `verdade-fingida` | tire "o que ninguém te conta"; a afirmação fica sozinha |
| `importancia-inflada` | troque "desempenha papel fundamental" pelo fato |
| `metadiscurso` | apague "em outras palavras", "o ponto-chave é" |
| `atribuicao-vaga` | cite a fonte ou corte; sem fonte, pergunte |
| `abertura-retorica` | tire a pergunta de efeito |
| `fecho-em-resumo` | termine no último ponto concreto ou na próxima ação |
| `fecho-de-efeito` | apague a frase de efeito final ("Simples assim.") |
| `gerundio-de-analise` | ", destacando o valor…" vira a consequência concreta ou sai |
| `travessao` | vírgula, ponto, dois-pontos ou parênteses; texto curto fica sem nenhum |
| `ritmo-uniforme` | varie o tamanho das frases onde o texto pedir; não force |
| `negrito-espalhado`, `titulo-demais`, `emoji-em-titulo` | a forma segue o conteúdo, não enfeita |
| `provisorio`, `palavra-repetida`, `pontuacao`, `formato-*`, `grafia-do-nome`, `lista-inconsistente` | erro bobo: conserte direto |

## Nos arquivos

- docx: edite o texto dentro do run (python-docx) e preserve estilos; não recrie o documento.
- pptx: edite `run.text` na caixa certa; texto que não cabe se resolve cortando texto, não diminuindo a fonte abaixo de 18pt.
- xlsx: edite a célula; número como texto vira número de verdade; fórmula sem valor salvo: `python -I scripts/doc.py recalcular arquivo.xlsx`.
- Depois de editar, rode `toc conferir` e confira de novo.
