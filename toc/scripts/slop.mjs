// Higiene e padrões de texto de IA em português e inglês, sobre blocos de texto.
// Padrões e limites vêm da skill no-ai-slop (local, em inglês); a lista em português é adaptação do toc.
// Regra herdada da skill: nomear o padrão, citar a linha e dar o conserto em poucas palavras.
// Nunca dar nota de "cara de IA" nem adivinhar quem escreveu.
//
// Entrada: blocos [{onde, papel, texto, nivel?, negrito?, grupo?}]
//   papel: titulo | corpo | lista | celula | notas | rotulo (botão, menu, cabeçalho de coluna)
// Saída: achados [{regra, gravidade, onde, detalhe, porDetalhe}]

const B0 = '(?<![\\p{L}\\p{N}])', B1 = '(?![\\p{L}\\p{N}])';
const P = (alts, f = 'giu') => new RegExp(B0 + '(?:' + alts + ')' + B1, f);
const R = (src, f = 'giu') => new RegExp(src, f);
const AP = `['’]`;

// Fraseados que a skill manda cortar. [regra, gravidade, regex, conserto]
const FRASES = [
  ['palavra-de-ia', 'corrigir', P(String.raw`delv(?:e|es|ed|ing)|foster(?:s|ed|ing)?|leverag(?:e|es|ed|ing)|utili[sz](?:e|es|ed|ing)|facilitat(?:e|es|ed|ing)|empower(?:s|ed|ing|ment)?|streamlin(?:e|es|ed|ing)|robust|cutting-edge|paradigm shift|game[- ]changer|tapestry|realm|beacon|multifaceted|meticulous(?:ly)?|intricate|paramount|transformative|elevat(?:e|es|ed|ing)|embark(?:s|ed|ing)?|supercharg(?:e|es|ed|ing)|harness(?:es|ed|ing)?|ever-evolving`),
    'palavra de IA da lista da skill; troque por fato, número ou palavra simples'],
  ['palavra-de-ia', 'corrigir', P(String.raw`potencializ(?:ar|a|am|ando|ou|e|em|ação)|sinergias?|holístic[oa]s?|robust[oa]s?|disruptiv[oa]s?|empoder(?:ar|a|ando|amento)|alavanc(?:ar|ando|e|ou)|desvendar|mudança de paradigma|quebra de paradigma|novo paradigma|em constante (?:evolução|transformação|mudança)|desbloque(?:ar|ie|ando) (?:o )?(?:seu )?potencial|liberar (?:o )?(?:seu )?potencial|novo patamar|próximo nível|rica tapeçaria|tapeçaria|mergulh(?:ar|e|emos|amos) (?:a )?fundo`),
    'equivalente em português de palavra de IA (adaptação do toc); troque por fato, número ou palavra simples'],
  ['abertura-vazia', 'corrigir', P(String.raw`vale (?:a pena )?(?:ressaltar|destacar|mencionar|lembrar|notar|salientar)(?: que)?|é (?:importante|fundamental|essencial|crucial) (?:ressaltar|destacar|notar|lembrar|mencionar|salientar|frisar)(?: que)?|cabe (?:ressaltar|destacar|mencionar|salientar)(?: que)?|deixe-me ser claro|a verdade é que|a realidade é que|no (?:final|fim) das contas|em última análise|aqui está o ponto|o fato é que|não é segredo que|como todos sabemos|em um mundo cada vez mais \p{L}+|no mundo (?:atual|de hoje|moderno)|no cenário (?:atual|competitivo|digital)|nos dias (?:atuais|de hoje)|na era (?:da|do|de)|it${AP}s (?:worth|important) (?:noting|to note)(?: that)?|here${AP}s the thing|let me be clear|i${AP}ll be honest|the uncomfortable truth(?: is)?|at the end of the day|in today${AP}s (?:world|landscape)|in the age of|let${AP}s dive in|when it comes to`),
    'corte a abertura e comece pelo ponto'],
  ['verdade-fingida', 'corrigir', P(String.raw`o que (?:a )?maioria das pessoas (?:erra|ignora|esquece|não (?:sabe|percebe|vê))|a parte que (?:todo mundo|ninguém|muita gente) (?:ignora|esquece|pula|perde)|o que ninguém (?:te )?(?:conta|diz|fala)|ninguém (?:te )?(?:conta|fala) isso|here${AP}s what nobody tells you|what most people get wrong|the part (?:everyone|most people) (?:misses|skips)|this is the part most people skip`),
    'não anuncie que sabe o que os outros não sabem; faça a afirmação valer sozinha'],
  ['importancia-inflada', 'corrigir', P(String.raw`marca(?:m)? um (?:momento|marco) (?:crucial|decisivo|marcante|histórico)|desempenha(?:m)? um papel (?:fundamental|crucial|vital|essencial|central|importante|chave)|é (?:um )?testemunho d[eao]|solidifica(?:m)? (?:sua|a) posição|(?:ressalta|sublinha)(?:m)? (?:a|sua) importância|pedra angular|divisor de águas|stands? as a testament|marks? a pivotal moment|plays? a (?:vital|crucial|pivotal|key) role|underscores? (?:its|the) significance|solidif(?:y|ies) its position`),
    'diga o fato e deixe o leitor julgar se importa'],
  ['metadiscurso', 'corrigir', P(String.raw`o ponto[- ](?:chave|principal|central|crucial) é|a (?:questão|chave) (?:central|principal) é|como (?:você|vocês|se) pode(?:m)? (?:ver|notar|perceber)|como (?:podemos|pode-se) ver|em outras palavras|isso importa mais do que parece|essa distinção (?:importa|é importante)|vale lembrar que|lembre-se de que|the key (?:point|takeaway) is|as you can see|in other words|that last part matters more than it sounds|this distinction matters`),
    'apague o comentário sobre o texto; se o ponto está claro, não precisa de aviso'],
  ['abertura-retorica', 'corrigir', P(String.raw`e se eu te dissesse|pense nisso:|pense bem:|imagine só|adivinha\?|plot twist|what if i told you|think about it:`),
    'tire a pergunta de efeito e afirme o ponto'],
  ['contraste-binario', 'corrigir', R(String.raw`n[ãa]o (?:é|são|foi|era) (?:apenas|só|somente|simplesmente) [^.;!?\n]{2,70}?,?\s*(?:mas|e sim)(?![\p{L}])`),
    'diga direto o que é, sem "não é só X, mas Y"'],
  ['contraste-binario', 'corrigir', R(String.raw`n[ãa]o se trata d[eoa]s? [^.;!?\n]{2,60}[,;]\s*mas (?:sim )?d[eoa]s?(?![\p{L}])`),
    'diga direto o que é, sem "não se trata de X, mas de Y"'],
  ['contraste-binario', 'corrigir', R(String.raw`(?:a|o) (?:pergunta|questão|dúvida|diferença|chave|verdade|falha|prioridade|lição|ideia|problema|desafio|segredo) (?:real )?n[ãa]o (?:é|são|está em) [^.;!?\n]{2,60}[.,;]\s*(?:é|são|está em)(?![\p{L}])`),
    'diga direto o que é, sem "o problema não é X, é Y"'],
  ['contraste-binario', 'nota', R(String.raw`n[ãa]o (?:é|são) (?:um |uma |o |a |os |as )?[^.,;!?\n]{2,50}(?:,|;|\.|\s[—–])\s*(?:é|são|e sim|mas sim)(?![\p{L}])`),
    'se for só retórica, diga direto o que é (se contrapõe duas opções reais, pode ficar)'],
  ['contraste-binario', 'corrigir', R(String.raw`(?:it|this|that|here)${AP}?s not (?:just |only |merely |about )?[^.,;!?\n]{2,60}[,.;]\s*(?:it|this|that)${AP}?s(?![\p{L}])|(?:isn|aren|wasn)${AP}t (?:just |only |about )?[^.,;!?\n]{2,60}[,.;]\s*(?:it|this|that|they)${AP}?s?(?![\p{L}])|not (?:just|only|merely) [^.,;!?\n]{2,50},? but (?:also )?`),
    'state the point directly instead of "not X, but Y"'],
  ['lista-negativa', 'corrigir', R(String.raw`(?:^|[.!?]\s)(?:Não é|Not) (?:um |uma |o |a |an? )?[^.]{2,30}\.\s*(?:Não é|Not) (?:um |uma |o |a |an? )?[^.]{2,30}\.`, 'gu'),
    'diga só o que é'],
  ['gerundio-de-analise', 'nota', R(String.raw`,\s+(?:destacando|ressaltando|evidenciando|sublinhando|reforçando|reafirmando|consolidando|solidificando|refletindo|demonstrando|mostrando|simbolizando|representando) (?:a|o|as|os|seu|sua|seus|suas|como|que|um|uma)\s|,\s+(?:highlighting|underscoring|reflecting|showcasing|demonstrating|emphasizing|reinforcing|solidifying|illustrating) (?:the|its|their|how|that|a|an)\s`),
    'cláusula que finge explicar o sentido: troque pelo fato ou pela consequência concreta'],
  ['fecho-de-efeito', 'nota', R(String.raw`(?:^|[.!?]\s)(?:isso é tudo|é isso( aí)?|simples assim|ponto final|fim de papo|that${AP}s it|that${AP}s the whole thing|full stop)\.`),
    'apague a frase de efeito e termine no último ponto concreto'],
];
const ATRIBUICAO = [P(String.raw`especialistas (?:concordam|afirmam|apontam|dizem|acreditam)|segundo especialistas|estudos (?:mostram|indicam|apontam|sugerem|comprovam|revelam)|pesquisas (?:mostram|indicam|apontam|sugerem|revelam)|muitos (?:argumentam|acreditam|dizem|defendem)|é amplamente (?:reconhecido|aceito|sabido)|dizem que|experts (?:agree|say|believe)|industry reports suggest|many argue|widely regarded as|studies show|research shows|it is widely (?:known|accepted)`)];
const CITACAO = /\(|\[\d|https?:|\b(?:19|20)\d\d\b|segundo [A-ZÁÉÍÓÚ]|conforme [A-ZÁÉÍÓÚ]|according to [A-Z]|fonte:|source:/;
const RECAPITULACAO = P(String.raw`em (?:conclusão|suma|resumo|síntese)|por fim|no geral|de modo geral|de forma geral|em última análise|resumindo|concluindo|ultimately|overall|in conclusion|in summary|to sum up|all in all`, 'iu');
const ADVERBIOS = P(String.raw`simplesmente|literalmente|honestamente|realmente|verdadeiramente|fundamentalmente|crucialmente|inerentemente|inevitavelmente|basicamente|essencialmente|efetivamente|genuinamente|just|literally|honestly|simply|actually|truly|fundamentally|importantly|crucially|inherently|inevitably`, 'giu');
const SUSPEITAS = P(String.raw`ecossistemas?|jornada|impulsionar|panorama|abrangente|soluções? inovadoras?|inovador[ae]s?|diferencial competitivo|valor agregado|sem precedentes|sem esforço|tudo em um|sem complicação|revolucion\p{L}+|landscape|journey|seamless(?:ly)?|cutting edge|effortless(?:ly)?|all-in-one|unlock(?:s|ed|ing)?`, 'giu');
// rótulos genéricos de botão (Taste Skill, "copy tells"): o botão diz a ação dele
const ROTULO_GENERICO = /^(saiba mais|comece agora|começar agora|clique aqui|leia mais|ver mais|get started|learn more|click here|read more)[.!]?$/i;

// Resto de modelo esquecido na entrega.
const PROVISORIO_I = R(String.raw`lorem ipsum|dolor sit amet|\[(?:inserir|insira|nome|empresa|cliente|data|descri[cç][aã]o|título|titulo|texto|xxx|preencher|completar|\.{3}|…)[^\]]{0,40}\]|<(?:nome|empresa|cliente|data|título|texto|inserir)[^>]{0,30}>|(?<![\p{L}])x{3,}(?![\p{L}])|\{\{[^}]{0,40}\}\}|\{%[^%]{0,40}%\}|erro! |error! |#REF!|#NAME\?|#N/A|#DIV/0!|#VALUE!|#NUM!|#NULL!|\[object Object\]|click to (?:add|edit)|clique para (?:adicionar|editar)|your (?:text|title|name) here|(?:seu|sua) (?:texto|título|nome) aqui|texto (?:de exemplo|aqui)|título aqui|insert (?:text|title|name)|sample text|nome d[oa] (?:cliente|empresa)|123\.456\.789-00|000\.000\.000-00|\(00\) ?0000-0000|email@exemplo|exemplo@exemplo|seu@email|dd/mm/(?:aaaa|yyyy)|00/00/0000`);
const PROVISORIO_S = R(String.raw`(?<![\p{L}])(?:NaN|undefined|TBD|TODO|FIXME)(?![\p{L}])`, 'gu');

const PALAVRA_REPETIDA = R(String.raw`(?<![\p{L}\p{N}])(\p{L}{2,})\s+\1(?![\p{L}\p{N}])`);
const REPETIDA_OK = new Set(['sim', 'não', 'nao', 'bem', 'bla', 'blá', 'tchau', 'tic', 'tac', 'ha', 'had', 'that', 'vai', 'passa']);
const SEM_LINK = /https?:\/\/\S+|\S+@\S+\.\S+|[\w.-]+\.(?:com|br|org|net|io|js|css|html|json|md|png|jpg|pdf|docx|xlsx|pptx)\b/gi;

const palavrasDe = t => (t.match(/\p{L}[\p{L}\p{N}'’-]*/gu) || []).length;
const frasesDe = t => t.split(/(?<=[.!?…])\s+(?=[\p{Lu}\p{N}“"(¿¡])/u).map(s => s.trim()).filter(s => s.split(/\s+/).length >= 2);

export function lintar(blocos, opc = {}) {
  const out = [], contagem = new Map(), excedente = new Map();
  const LIMITE = 6;
  const add = (regra, grav, bloco, detalhe) => {
    const n = (contagem.get(regra) || 0) + 1; contagem.set(regra, n);
    if (n > LIMITE) { excedente.set(regra, [(excedente.get(regra) || [grav])[0], (excedente.get(regra)?.[1] || 0) + 1]); return; }
    out.push({regra, gravidade: grav, onde: bloco?.onde || '', detalhe, porDetalhe: true});
  };
  const trecho = (t, i, n) => { const a = Math.max(0, i - 30), b = Math.min(t.length, i + n + 40); return (a ? '…' : '') + t.slice(a, b).replace(/\s+/g, ' ') + (b < t.length ? '…' : ''); };
  const todos = (blocos || []).filter(b => b && typeof b.texto === 'string' && b.texto.trim());
  const prosa = todos.filter(b => b.papel !== 'rotulo');
  const total = todos.reduce((n, b) => n + palavrasDe(b.texto), 0);
  const slop = opc.slop !== false;

  for (const b of todos) {
    const t = b.texto;
    for (const [re, forma] of [[PROVISORIO_I, 'i'], [PROVISORIO_S, 's']]) {
      re.lastIndex = 0;
      for (let m; (m = re.exec(t));) add('texto-provisorio', 'bloqueia', b, `texto de modelo ou erro esquecido: "${trecho(t, m.index, m[0].length)}"`);
    }
    PALAVRA_REPETIDA.lastIndex = 0;
    for (let m; (m = PALAVRA_REPETIDA.exec(t));) if (!REPETIDA_OK.has(m[1].toLowerCase())) add('texto-palavra-repetida', 'corrigir', b, `palavra repetida: "${trecho(t, m.index, m[0].length)}"`);
    const limpo = t.replace(SEM_LINK, m => ' '.repeat(m.length));
    for (let m, re = /[\p{Ll}][,;][\p{L}]/gu; (m = re.exec(limpo));) add('texto-pontuacao', 'corrigir', b, `falta espaço depois da vírgula ou ponto e vírgula: "${trecho(t, m.index, 3)}"`);
    for (let m, re = /(?<=[\p{L}\p{N}]) +[,;.!?](?=\s|$)/gu; (m = re.exec(limpo));) if (!/\.\.\.|…/.test(limpo.slice(m.index, m.index + 4))) add('texto-pontuacao', 'nota', b, `espaço antes da pontuação: "${trecho(t, m.index, 3)}"`);
    for (let m, re = /[\p{Ll}]{2,}\.[\p{Lu}][\p{Ll}]/gu; (m = re.exec(limpo));) add('texto-pontuacao', 'nota', b, `falta espaço depois do ponto: "${trecho(t, m.index, 5)}"`);
    if (opc.espacosDuplos !== false && b.origem !== 'web') for (let m, re = /\S {2,}\S/g; (m = re.exec(t));) add('texto-espacos', 'nota', b, `espaço duplo: "${trecho(t, m.index, 4)}"`);
    if (b.papel === 'titulo' && /\p{Extended_Pictographic}/u.test(t)) add('texto-emoji-em-titulo', 'corrigir', b, `emoji em título: "${t.slice(0, 60)}"`);
    if (b.papel === 'rotulo' && ROTULO_GENERICO.test(t.trim())) add('texto-rotulo-generico', 'nota', b, `botão ou link "${t.trim()}": diga a ação ("Agendar diagnóstico", "Baixar a planilha")`);
    if ((b.papel === 'lista' || b.papel === 'rotulo') && /^\p{Extended_Pictographic}/u.test(t.trim())) add('texto-emoji-como-icone', 'nota', b, `emoji fazendo papel de ícone: "${t.slice(0, 40)}"`);
  }

  if (slop) {
    for (const b of prosa) {
      const t = b.texto;
      const cobertos = []; // o mesmo trecho não vira duas queixas (a versão em nota cede à mais forte)
      for (const [regra, grav, re, dica] of FRASES) {
        re.lastIndex = 0;
        for (let m; (m = re.exec(t));) {
          const ini = m.index, fim = ini + m[0].length;
          if (m[0].length === 0) re.lastIndex++;
          if (regra === 'contraste-binario') {
            if (grav === 'nota' && cobertos.some(([a, z]) => ini < z && fim > a)) continue;
            cobertos.push([ini, fim]);
          }
          add('texto-' + regra, grav, b, `"${trecho(t, ini, m[0].length)}": ${dica}`);
        }
      }
      for (const re of ATRIBUICAO) {
        re.lastIndex = 0;
        for (let m; (m = re.exec(t));) {
          if (CITACAO.test(t.slice(m.index + m[0].length, m.index + m[0].length + 90))) continue;
          add('texto-atribuicao-vaga', 'corrigir', b, `"${trecho(t, m.index, m[0].length)}": cite a fonte ou corte a afirmação (sem fonte, pergunte ao usuário; não invente)`);
        }
      }
      const colon = t.match(/^((?:the|a|an|o|a|os|as|um|uma|esse|essa|este|esta)\s+(?:\p{L}+\s+){0,6}?(?:part|thing|detail|key|reason|catch|difference|truth|problem|secret|trick|parte|coisa|detalhe|chave|razão|motivo|diferença|verdade|problema|segredo|truque|pegadinha)\b[^:]{0,40}): [\p{Ll}][^.]{10,}/iu);
      if (colon && palavrasDe(t) >= 12) add('texto-revelacao-com-dois-pontos', 'nota', b, `"${t.slice(0, 80)}…": reescreva como frase simples; dois-pontos são para lista, rótulo e citação`);
      if (b.negrito >= 3) add('texto-negrito-espalhado', 'nota', b, `${b.negrito} trechos em negrito no mesmo parágrafo: negrito de enfeite`);
      if (b.papel === 'corpo') {
        const fs = frasesDe(t);
        if (fs.length >= 6) {
          const len = fs.map(f => f.split(/\s+/).length), media = len.reduce((a, c) => a + c, 0) / len.length;
          const dp = Math.sqrt(len.reduce((a, c) => a + (c - media) ** 2, 0) / len.length);
          if (dp / media < 0.22) add('texto-ritmo-uniforme', 'nota', b, `${fs.length} frases de tamanho quase igual (${Math.round(media)} palavras cada): varie o ritmo onde o texto pedir`);
        }
        for (let i = 0, seq = 1; i < fs.length; i++) {
          const w = (fs[i].match(/\p{L}+/u) || [''])[0].toLowerCase(), ant = i && (fs[i - 1].match(/\p{L}+/u) || [''])[0].toLowerCase();
          seq = i && w.length >= 3 && w === ant ? seq + 1 : 1;
          if (seq === 3) add('texto-ritmo-uniforme', 'nota', b, `3 frases seguidas começam com "${w}"`);
        }
      }
    }
    // fecho em resumo: no último parágrafo é falha, no meio do texto é nota
    const corpos = prosa.filter(b => b.papel === 'corpo' && palavrasDe(b.texto) >= 8);
    corpos.forEach((b, i) => {
      if (!RECAPITULACAO.test(b.texto.slice(0, 22)) || !/^[\s"“(]*\p{L}/u.test(b.texto)) return;
      const inicio = (b.texto.match(RECAPITULACAO) || [''])[0];
      if (b.texto.search(RECAPITULACAO) > 4) return;
      add('texto-fecho-em-resumo', i === corpos.length - 1 ? 'corrigir' : 'nota', b, `parágrafo começa com "${inicio}": termine no último ponto concreto ou na próxima ação, sem recapitular`);
    });
    // advérbios e palavras suspeitas: só avisa em quantidade (a skill manda manter quando carregam ênfase)
    const conta = (re) => { const c = new Map(); for (const b of prosa) { re.lastIndex = 0; for (let m; (m = re.exec(b.texto));) c.set(m[0].toLowerCase(), (c.get(m[0].toLowerCase()) || 0) + 1); } return c; };
    const adv = conta(ADVERBIOS), advTotal = [...adv.values()].reduce((a, c) => a + c, 0);
    if (advTotal >= 5 || [...adv.values()].some(v => v >= 3)) add('texto-adverbios-vazios', 'nota', null, `advérbios que costumam ser enchimento: ${[...adv].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} (${v}x)`).join(', ')}; corte os que não carregam ênfase`);
    const sus = conta(SUSPEITAS);
    if (sus.size) add('texto-palavras-suspeitas', 'nota', null, `palavras que costumam ser enchimento de marketing: ${[...sus].slice(0, 6).map(([k, v]) => `${k} (${v}x)`).join(', ')}; troque por o que a coisa faz`);
    // seção de título com quase nada embaixo (só em texto corrido, não em slide)
    let curtas = 0;
    for (let i = 0; i < todos.length && curtas < 3; i++) {
      const b = todos[i];
      if (b.papel !== 'titulo' || !(b.nivel >= 2) || b.origem === 'web') continue; // cartão com título curto é normal em site
      let n = 0, j = i + 1;
      for (; j < todos.length && todos[j].papel !== 'titulo'; j++) n += palavrasDe(todos[j].texto);
      if (j < todos.length && n > 0 && n <= 25) { curtas++; add('texto-titulo-demais', 'nota', b, `título "${b.texto.slice(0, 50)}" sobre uma seção de ${n} palavras: junte com a vizinha ou tire o título`); }
    }
  }

  // travessão: nenhum em texto curto, até 2 em texto longo (limite da skill)
  const maxTrav = opc.travessaoMax ?? (total < 300 ? 0 : 2);
  const trav = [];
  for (const b of prosa) for (let m, re = /—|(?<=\s)–(?=\s)/g; (m = re.exec(b.texto));) trav.push([b, m.index]);
  if (trav.length > maxTrav) trav.slice(maxTrav).forEach(([b, i], k) => add('texto-travessao', 'corrigir', b, `travessão ${maxTrav + k + 1} de ${trav.length} (limite ${maxTrav}): "${trecho(b.texto, i, 1)}"; troque por vírgula, ponto, dois-pontos ou parênteses`));

  // consistência do documento inteiro
  const conta2 = (re, tx) => (tx.match(re) || []).length;
  const alltxt = todos.map(b => b.texto).join('\n');
  const br = conta2(/\d{1,3}(?:\.\d{3})+,\d{2}(?!\d)/g, alltxt), us = conta2(/\d{1,3}(?:,\d{3})+\.\d{2}(?!\d)/g, alltxt);
  if (br && us) add('texto-formato-numero', 'corrigir', null, `números com separador de milhar e decimal nos dois formatos (${br} como 1.234,56 e ${us} como 1,234.56); use um só`);
  const datas = {'dd/mm/aaaa': /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, 'aaaa-mm-dd': /\b\d{4}-\d{2}-\d{2}\b/g, 'por extenso': /\b\d{1,2}(?:º)? de \p{L}+ de \d{4}\b/gu};
  const usadas = Object.entries(datas).filter(([, re]) => conta2(re, alltxt)).map(([k]) => k);
  if (usadas.length > 1) add('texto-formato-data', 'nota', null, `datas escritas em formatos diferentes: ${usadas.join(' e ')}`);
  const rs1 = conta2(/R\$ \d/g, alltxt), rs2 = conta2(/R\$\d/g, alltxt);
  if (rs1 && rs2) add('texto-formato-moeda', 'nota', null, `"R$ 100" e "R$100" misturados (${rs1} e ${rs2}); escolha um`);
  const pc1 = conta2(/\d %/g, alltxt), pc2 = conta2(/\d%/g, alltxt);
  if (pc1 && pc2) add('texto-formato-percentual', 'nota', null, `"10 %" e "10%" misturados (${pc1} e ${pc2}); escolha um`);
  const variantes = new Map();
  for (const b of prosa) for (const m of b.texto.matchAll(/(?<![\p{L}\p{N}])\p{L}{3,}(?![\p{L}\p{N}])/gu)) {
    const k = m[0].toLowerCase(), v = variantes.get(k) || new Map(); v.set(m[0], (v.get(m[0]) || 0) + 1); variantes.set(k, v);
  }
  for (const [k, v] of variantes) {
    const fortes = [...v].filter(([w, n]) => n >= 2 && (w === w.toUpperCase() || /\p{Ll}\p{Lu}/u.test(w)));
    if (v.size > 1 && fortes.length && [...v].filter(([, n]) => n >= 2).length >= 2) add('texto-grafia-do-nome', 'nota', null, `"${[...v].map(([w, n]) => `${w} (${n}x)`).join('", "')}": mesma palavra com maiúsculas diferentes; escolha uma grafia`);
  }
  // listas e títulos: pontuação e maiúscula do começo
  for (let i = 0; i < todos.length; i++) {
    if (todos[i].papel !== 'lista') continue;
    const g = [todos[i]];
    while (i + 1 < todos.length && todos[i + 1].papel === 'lista' && todos[i + 1].grupo === todos[i].grupo) g.push(todos[++i]);
    if (g.length < 3) continue;
    const ponto = g.filter(x => /[.;]$/.test(x.texto.trim())).length, cap = g.filter(x => /^\p{Lu}/u.test(x.texto.trim())).length;
    if (ponto && ponto < g.length) add('texto-lista-inconsistente', 'nota', g[0], `lista de ${g.length} itens: ${ponto} terminam com ponto e ${g.length - ponto} não`);
    if (cap && cap < g.length) add('texto-lista-inconsistente', 'nota', g[0], `lista de ${g.length} itens: ${cap} começam com maiúscula e ${g.length - cap} com minúscula`);
  }
  const tit = todos.filter(b => b.papel === 'titulo');
  const comPonto = tit.filter(b => /\.$/.test(b.texto.trim())).length;
  if (tit.length >= 4 && comPonto && comPonto < tit.length) add('texto-titulo-pontuacao', 'nota', null, `${comPonto} de ${tit.length} títulos terminam com ponto; padronize`);

  for (const [regra, [grav, n]] of excedente) out.push({regra, gravidade: grav === 'bloqueia' ? 'corrigir' : grav, onde: '', detalhe: `mais ${n} ocorrência(s) de ${regra} além das ${LIMITE} listadas`, porDetalhe: true});
  return out;
}

export function textoMd(blocos) {
  return (blocos || []).map(b => `[${b.onde}${b.papel ? ' · ' + b.papel : ''}] ${b.texto}`).join('\n\n') + '\n';
}

// uso rápido: node slop.mjs arquivo.txt [--curto]
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase() && process.argv[2]) {
  const t = fs.readFileSync(process.argv[2], 'utf8');
  const blocos = t.split(/\n\s*\n/).map((x, i) => ({onde: `bloco ${i + 1}`, papel: /^#/.test(x) ? 'titulo' : 'corpo', texto: x.replace(/^#+\s*/, '').trim(), nivel: 2}));
  for (const a of lintar(blocos)) console.log(`[${a.gravidade}] ${a.regra} · ${a.onde}: ${a.detalhe}`);
}
