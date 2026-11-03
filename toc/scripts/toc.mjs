#!/usr/bin/env node
// toc: liga, desliga e confere o laço que não deixa o Claude parar antes de o contrato fechar.
// Uso: node toc.mjs iniciar [--contrato .claude/toc/contrato.json] [--max 8]
//      node toc.mjs conferir | status | pausar | retomar | parar | impressao
//      node toc.mjs esperar [--max-s 600]   (marca o revisor como em andamento e espera o veredito)
//      node toc.mjs hook        (hook Stop do Claude Code; lê o JSON do stdin)
// Estado em <projeto>/.claude/toc/estado.json, achado subindo a partir da pasta atual.
// Sem esse arquivo (ou com ativo=false) o hook não faz nada.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {lerContrato, resumo, login} from './conferir.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.dirname(AQUI);
const PASTA = path.join('.claude', 'toc');
const PULAR = new Set(['node_modules', '.git', '.claude', '.next', '.cache', '__pycache__', '.venv', 'venv']);

const lerJSON = (arq, padrao) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; } };
const gravarJSON = (arq, obj) => { fs.mkdirSync(path.dirname(arq), {recursive: true}); const t = `${arq}.${process.pid}.tmp`; fs.writeFileSync(t, JSON.stringify(obj, null, 2)); fs.renameSync(t, arq); };
const arqEstado = raiz => path.join(raiz, PASTA, 'estado.json');
// O Claude Code passa a pasta atual da sessão, que muda quando um comando entra numa subpasta.
// Subir até achar o laço evita que ele "desligue" sozinho por causa de um cd.
const acharRaiz = inicio => {
  for (let d = path.resolve(inicio); ; d = path.dirname(d)) {
    if (fs.existsSync(arqEstado(d))) return d;
    if (path.dirname(d) === d) return path.resolve(inicio);
  }
};
const REVISOR_MS = 20 * 60 * 1000; // revisor marcado há mais que isso conta como abandonado
const rel = (raiz, p) => path.relative(raiz, p).split(path.sep).join('/');

// Impressão digital do que está sendo construído: caminho, tamanho e data de cada arquivo observado
// (sem ler conteúdo) mais o contrato. Mudou um arquivo, muda a impressão e vale conferir de novo.
export function impressao(raiz, contrato, contratoArq) {
  const h = crypto.createHash('sha1');
  let n = 0;
  const andar = d => {
    let ents; try { ents = fs.readdirSync(d, {withFileTypes: true}); } catch { return; }
    ents.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of ents) {
      if (n > 30000 || e.isSymbolicLink() || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!PULAR.has(e.name)) andar(p); continue; }
      try { const s = fs.statSync(p); h.update(`${rel(raiz, p)}|${s.size}|${Math.round(s.mtimeMs)}\n`); n++; } catch {}
    }
  };
  const alvos = contrato.observar?.length ? contrato.observar : (contrato.arquivo && !/\.html?$/i.test(contrato.arquivo) ? [contrato.arquivo] : ['.']);
  for (const o of alvos) {
    const p = path.resolve(raiz, o);
    let s; try { s = fs.statSync(p); } catch { continue; }
    if (s.isDirectory()) andar(p); else h.update(`${rel(raiz, p)}|${s.size}|${Math.round(s.mtimeMs)}\n`);
  }
  h.update(fs.readFileSync(contratoArq));
  return h.digest('hex').slice(0, 12);
}

// Contrato com "antes": roda o comando (ex.: build) e espera terminar; se falhar, a conferência nem começa.
function rodarAntes(raiz, contrato) {
  if (!contrato.antes) return '';
  const r = spawnSync(contrato.antes, {cwd: raiz, shell: true, encoding: 'utf8', timeout: contrato.antesTimeoutMs ?? 600000});
  if (r.status === 0) return '';
  return `o comando "antes" (${contrato.antes}) falhou:\n` + (r.error?.message || r.stderr || r.stdout || 'sem saída').trim().split('\n').slice(-8).join('\n');
}

function rodarConferencia(raiz, est, fp) {
  const erroAntes = rodarAntes(raiz, lerContrato(path.resolve(raiz, est.contrato)));
  if (erroAntes) return {passou: false, erro: erroAntes, pasta: ''};
  const n = (est.conferencias || 0) + 1;
  const saida = path.join(raiz, PASTA, `rodada-${String(n).padStart(2, '0')}`);
  fs.rmSync(saida, {recursive: true, force: true});
  const anterior = est.cache?.pasta && fs.existsSync(path.join(raiz, est.cache.pasta)) ? path.join(raiz, est.cache.pasta) : '';
  const r = spawnSync(process.execPath, [path.join(AQUI, 'conferir.mjs'), '--contrato', path.resolve(raiz, est.contrato), '--saida', saida, '--raiz', raiz, '--fp', fp, '--anterior', anterior],
    {cwd: raiz, encoding: 'utf8', timeout: 480000});
  est.conferencias = n;
  const relatorio = lerJSON(path.join(saida, 'relatorio.json'), null);
  // guarda só as 4 últimas rodadas (fotos ocupam espaço)
  const pastas = fs.readdirSync(path.join(raiz, PASTA)).filter(d => /^rodada-\d+$/.test(d)).sort();
  for (const d of pastas.slice(0, -4)) fs.rmSync(path.join(raiz, PASTA, d), {recursive: true, force: true});
  if (!relatorio) {
    const erro = (r.error?.message || r.stderr || r.stdout || 'sem saída').trim().split('\n').slice(-6).join('\n');
    return {passou: false, erro, pasta: rel(raiz, saida)};
  }
  est.cache = {fp, pasta: rel(raiz, saida), passou: relatorio.passou};
  return {...relatorio, pasta: rel(raiz, saida)};
}

function linhasFalhas(r, max = 25) {
  const l = [];
  for (const i of r.itens || []) if (i.conferido && !i.ok) l.push(`- [contrato ${i.id}] ${i.descricao}: ${i.falhas.join(' | ')}`);
  for (const a of r.achados || []) if (!a.dispensado && a.gravidade !== 'nota')
    l.push(`- [${a.gravidade}] ${a.regra}${a.onde ? ' · ' + a.onde : ''} · ${a.telas.join(', ')}${a.passos?.length ? ' · passo ' + a.passos.slice(0, 3).join(',') : ''}: ${a.detalhe}`);
  return l.length > max ? [...l.slice(0, max), `- … e mais ${l.length - max} em ${r.pasta}/resumo.md`] : l;
}

// Pendências de um veredito, cada uma com a área que o revisor marcou (para a reconferência recortar).
// Veredito completo: itens do contrato reprovados, achados bloqueia/corrigir no escopo e nota abaixo do mínimo.
// Reconferência: itens não resolvidos, achados novos e dúvidas. A nota da reconferência não existe: quem
// fecha é cada item confirmado, não um número (a nota mínima vale só para a revisão completa).
function pendenciasDe(ver, contrato, est) {
  const l = [];
  if (ver.tipo === 'reconferencia') {
    const env = est?.reconf?.itens || [];
    env.forEach((p, i) => {
      const j = (ver.itens || []).find(x => x.ref === i + 1);
      if (!j || !j.resolvido) l.push({...p, texto: `${p.texto}${j ? ` (ainda: ${j.evidencia || 'não resolvido'})` : ' (o reconferente não julgou)'}`});
    });
    for (const a of ver.novos || []) if ((a.gravidade === 'bloqueia' || a.gravidade === 'corrigir') && a.dentroDoEscopo !== false)
      l.push({texto: `- [${a.gravidade}] ${a.onde || ''}: ${a.problema}${a.correcao ? ' → ' + a.correcao : ''}`, area: a.area});
    for (const d of ver.duvidas || []) l.push({texto: `- [dúvida do reconferente] ${d}`, duvida: true});
    return l;
  }
  for (const it of contrato.itens.filter(i => i.tipo === 'revisor')) {
    const j = (ver.itensContrato || []).find(x => x.id === it.id);
    if (!j) l.push({texto: `- [contrato ${it.id}] o revisor não julgou: ${it.descricao || ''}`, semArea: true});
    else if (!j.ok) l.push({texto: `- [contrato ${it.id}] ${it.descricao || ''}: ${j.evidencia || 'não cumprido'}`, area: j.area});
  }
  for (const a of ver.achados || []) if ((a.gravidade === 'bloqueia' || a.gravidade === 'corrigir') && a.dentroDoEscopo !== false)
    l.push({texto: `- [${a.gravidade}] ${a.onde || ''}: ${a.problema}${a.correcao ? ' → ' + a.correcao : ''}`, area: a.area});
  const minima = contrato.notaMinima ?? 80;
  if (typeof ver.nota === 'number' && ver.nota < minima)
    l.push({texto: `- nota do revisor ${ver.nota} abaixo de ${minima}${l.length ? ' (fecha quando as pendências acima forem confirmadas)' : ' sem achado acionável: peça a ele os 3 pontos que mais tiram nota, com valor concreto e área'}`, nota: true, semAcao: !l.length});
  return l;
}
const falhasVeredito = (ver, contrato, est) => pendenciasDe(ver, contrato, est).map(p => p.texto);
const hashArq = arq => { try { return crypto.createHash('sha1').update(fs.readFileSync(arq)).digest('hex').slice(0, 12); } catch { return ''; } };

// Monta o pacote da reconferência na pasta da rodada: recortes "antes | agora" e o roteiro autocontido.
function pacoteReconferencia(raiz, r, ult, fp) {
  const pend = ult.pendentes.filter(p => !p.nota);
  const dest = path.join(raiz, r.pasta, 'reconferencia');
  fs.mkdirSync(dest, {recursive: true});
  const itensArq = path.join(dest, 'itens.json');
  fs.writeFileSync(itensArq, JSON.stringify(pend.map((p, i) => ({ref: i + 1, area: p.area || null}))));
  const py = spawnSync(process.env.TOC_PYTHON || 'python', ['-I', path.join(AQUI, 'visao.py'), 'recortes', path.join(raiz, r.pasta), path.join(raiz, ult.pasta), itensArq, dest], {encoding: 'utf8', timeout: 180000});
  const rec = lerJSON(path.join(dest, 'recortes.json'), null);
  if (!rec) return {erro: String(py.error?.message || py.stderr || 'visao.py não rodou').slice(-300)};
  const folha = (r.folhas || []).filter(f => !/mudancas/.test(f)).map(f => path.join(raiz, r.pasta, f));
  const linhas = [
    `# Reconferência toc (impressão ${fp})`,
    '',
    `Você confere se cada pendência abaixo foi resolvida. Não é uma revisão nova: não procure problema fora desta lista,`,
    `a não ser nas "mudanças fora das áreas" do fim, que é onde um conserto pode ter quebrado outra coisa.`,
    `Cada imagem mostra a MESMA região "antes" (rodada revisada) e "agora". Abra só as imagens listadas.`,
    `Não edite nada. Sua única escrita é ${path.join(raiz, PASTA, 'veredito.json')}.`,
    '',
    '## Pendências',
  ];
  pend.forEach((p, i) => {
    const im = rec.itens.find(x => x.ref === i + 1)?.imagem;
    linhas.push(`${i + 1}. ${p.texto.replace(/^- /, '')}`, `   imagem: ${im || `sem recorte (o revisor não marcou área): olhe ${folha[0] || 'a folha principal da rodada'}`}`);
  });
  linhas.push('', '## Mudanças fora das áreas');
  if (rec.fora.length) for (const f of rec.fora) linhas.push(`- ${f.recorte} (${f.imagem}): mudou sem ser pendência. Piorou algo? Vira item em "novos".`);
  else linhas.push('- nenhuma');
  linhas.push('', '## Grave exatamente este JSON (UTF-8) e responda só com o caminho e uma linha',
    '```json',
    JSON.stringify({tipo: 'reconferencia', fp, itens: pend.map((_, i) => ({ref: i + 1, resolvido: true, evidencia: 'o que você viu no "agora"'})),
      novos: [], duvidas: [], resumo: '1 frase'}, null, 1),
    '```',
    '- `resolvido`: true só se o "agora" mostra a correção pedida. Sem certeza: false e explique em `evidencia`, ou ponha em `duvidas`.',
    '- `novos`: só problemas vistos nas mudanças fora das áreas ({"gravidade","onde","problema","correcao","dentroDoEscopo"}).',
    '- Fonte, tamanho, peso ou cor: não afirme pela foto. Se precisar, confira a ficha tipográfica em ' + path.join(raiz, r.pasta, 'texto.md') + '.');
  const md = path.join(dest, 'reconferencia.md');
  fs.writeFileSync(md, linhas.join('\n') + '\n');
  return {md, fora: rec.foraFracao, n: pend.length};
}

const lerStdin = () => new Promise(res => {
  if (process.stdin.isTTY) return res('');
  let d = ''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => (d += c)); process.stdin.on('end', () => res(d));
});

// Última mensagem que a PESSOA escreveu na sessão (não conta retorno de ferramenta, aviso de hook nem mensagem do sistema).
const NAO_E_PESSOA = /^(Stop hook feedback|<local-command|<command-name|<command-message|<system-reminder|<task-notification|\[Request interrupted|Caveat:)/;
export function ultimaMensagemDaPessoa(transcript) {
  let ultima = null;
  try {
    for (const l of fs.readFileSync(transcript, 'utf8').split('\n')) {
      if (!l.includes('"type":"user"') && !l.includes('queued_command')) continue;
      let d; try { d = JSON.parse(l); } catch { continue; }
      // mensagem mandada no meio de uma tarefa fica como anexo "queued_command" vindo de pessoa
      const fila = d.type === 'attachment' && d.attachment?.type === 'queued_command' && (d.attachment.humanTurn || d.attachment.origin?.kind === 'human');
      if (fila && !d.isSidechain && String(d.attachment.prompt || '').trim()) { ultima = d.uuid || d.attachment.source_uuid; continue; }
      if (d.type !== 'user' || d.isMeta || d.isSidechain) continue;
      const c = d.message?.content;
      const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x?.type === 'text').map(x => x.text).join(' ') : '';
      if (!t.trim() || NAO_E_PESSOA.test(t.trimStart())) continue;
      ultima = d.uuid || d.promptId || t.slice(0, 80);
    }
  } catch {}
  return ultima;
}
const HORAS_PARADO = 6; // laço sem atividade há mais que isso se desliga sozinho
const MAX_ESPERAS = 6;  // esperas pelo revisor que não gastam rodada; depois disso passam a gastar

async function hook() {
  const entrada = lerJSON0(await lerStdin());
  const raiz = acharRaiz(entrada.cwd || process.cwd());
  const arq = arqEstado(raiz);
  const est = lerJSON(arq, null);
  if (!est || !est.ativo) return;
  if (est.sessao && entrada.session_id && est.sessao !== entrada.session_id) return; // laço de outra sessão
  if (!est.sessao && entrada.session_id) est.sessao = entrada.session_id;
  // Não prender a sessão: o laço vale para o pedido que o ligou.
  const ultimoUso = Date.parse(est.ultimaAtividade || est.iniciado || 0);
  if (ultimoUso && Date.now() - ultimoUso > HORAS_PARADO * 3600e3) {
    est.ativo = false; est.fim = 'expirou'; est.terminou = new Date().toISOString(); gravarJSON(arq, est);
    process.stdout.write(JSON.stringify({systemMessage: `toc: laço desligado sozinho (${HORAS_PARADO} h sem atividade).`}));
    return;
  }
  const msg = entrada.transcript_path ? ultimaMensagemDaPessoa(entrada.transcript_path) : null;
  if (msg) {
    if (!est.turno) est.turno = msg; // 1ª volta depois de iniciar/retomar: adota o pedido atual
    else if (est.turno !== msg) {    // a pessoa mandou outra mensagem: pausa em vez de prender a conversa
      est.ativo = false; est.pausado = true; est.fim = 'nova mensagem'; gravarJSON(arq, est);
      process.stdout.write(JSON.stringify({systemMessage: 'toc pausado: chegou mensagem nova sua. Se ela continua a mesma entrega, o Claude roda "toc retomar"; senão o laço fica desligado.'}));
      return;
    }
  }
  est.ultimaAtividade = new Date().toISOString();
  const toc = `"${process.execPath}" "${path.join(AQUI, 'toc.mjs')}"`;
  const bloquear = (motivo, contar = true) => {
    if (!contar && (est.esperas || 0) >= MAX_ESPERAS) contar = true; // espera sem fim vira rodada: o limite sempre chega
    if (!contar) { // espera de revisor: segura o fim sem gastar rodada
      est.esperas = (est.esperas || 0) + 1;
      gravarJSON(arq, est);
      process.stdout.write(JSON.stringify({decision: 'block', reason: motivo, systemMessage: `toc: esperando o revisor (rodada ${est.rodada || 0}/${est.max})`}));
      return;
    }
    est.rodada = (est.rodada || 0) + 1;
    const ultima = est.rodada >= est.max;
    gravarJSON(arq, est);
    const cab = ultima
      ? `toc, ÚLTIMA rodada (${est.rodada}/${est.max}). Corrija o que der e termine com o relatório honesto: o que fechou, o que ficou aberto, as dispensas. Não diga que ficou perfeito.\n`
      : `toc, rodada ${est.rodada}/${est.max}.\n`;
    process.stdout.write(JSON.stringify({decision: 'block', reason: cab + motivo, systemMessage: `toc: rodada ${est.rodada}/${est.max}`}));
  };
  if (est.rodada >= est.max) {
    est.ativo = false; est.fim = 'limite'; est.terminou = new Date().toISOString();
    gravarJSON(arq, est);
    process.stdout.write(JSON.stringify({systemMessage: `toc: limite de ${est.max} rodadas. Pendências em ${est.cache?.pasta || PASTA}/resumo.md`}));
    return;
  }
  let contrato;
  const contratoArq = path.resolve(raiz, est.contrato);
  try { contrato = lerContrato(contratoArq); }
  catch (e) { return bloquear(`O contrato ${est.contrato} não abre: ${e.message}. Corrija o arquivo (formato em ${rel(raiz, path.join(SKILL, 'referencias', 'contrato.md'))}) antes de terminar.`); }

  const fp = impressao(raiz, contrato, contratoArq);
  let r = est.cache?.fp === fp ? lerJSON(path.join(raiz, est.cache.pasta, 'relatorio.json'), null) : null;
  if (r) r.pasta = est.cache.pasta;
  else r = rodarConferencia(raiz, est, fp);

  const naoMexer = contrato.naoMexer?.length ? `Não mexa em: ${contrato.naoMexer.join('; ')}.\n` : '';
  const porta = (r.achados || []).find(a => a.regra === 'pagina-de-login' && !a.dispensado);
  if (porta) return bloquear(`A conferência caiu numa tela de login ou senha (${porta.onde}), então não conferiu a página pedida.\n` +
    `Você não digita senha nem código pelo usuário. Rode em segundo plano: ${toc} login ${contrato.url || ''} — abre um Chrome para o USUÁRIO entrar; ` +
    `avise-o para entrar e fechar a janela. Com a sessão salva, rode ${toc} conferir. Sem o usuário por perto: ${toc} pausar e pergunte.`);
  if (r.erro) return bloquear(`A conferência não rodou:\n${r.erro}\nSe a página depende de servidor, suba-o (preview_start) e termine de novo. Precisa falar com o usuário? Rode ${toc} pausar antes.`);
  if (!r.passou) {
    const deTexto = (r.achados || []).some(a => !a.dispensado && a.gravidade !== 'nota' && /^texto-|^ortografia/.test(a.regra));
    return bloquear(`A conferência mecânica achou pendências (${r.pasta}/resumo.md, fotos em ${r.pasta}/${(r.folhas || [])[0] || 'fotos'}):\n` +
      linhasFalhas(r).join('\n') + '\n\n' +
      (deTexto ? `Texto: conserte seguindo ${path.join(SKILL, 'referencias', 'texto.md')} (edição mínima, mantenha a voz e o sentido, não invente número, exemplo nem fonte; afirmação sem fonte, pergunte ao usuário). Em docx, pptx e xlsx edite no trecho (run, célula); regravar o arquivo do zero apaga a formatação.\n` : '') +
      `Corrija primeiro bloqueia, depois corrigir. ${naoMexer}` +
      `Achado que é intencional e foi combinado com o usuário vai em "dispensas" do contrato, com motivo (aparece no relatório final). ` +
      `Para conferir antes de terminar: ${toc} conferir. Precisa perguntar algo ao usuário? Rode ${toc} pausar antes.`);
  }
  const ver = lerJSON(path.join(raiz, PASTA, 'veredito.json'), null);
  if (!ver || ver.fp !== fp) {
    const rev = est.revisor;
    if (rev?.fp === fp && Date.now() - Date.parse(rev.desde) < REVISOR_MS)
      return bloquear(`O revisor já está trabalhando nesta impressão (${fp}). Não chame outro e não termine ainda: rode ${toc} esperar e siga quando o veredito chegar. Esta espera não gasta rodada.`, false);
    // Já houve revisão com pendências e o Claude corrigiu: reconferência barata, se der.
    // Dá quando: há pendências com ação, o contrato não mudou, ainda não foram 2 reconferências seguidas
    // e as mudanças fora das áreas pendentes são pequenas (até 30% das imagens). Senão, revisão completa.
    const ult = est.ultimaRevisao;
    const acionaveis = (ult?.pendentes || []).filter(p => !p.nota);
    const motivoCompleta = !ult ? '' : !acionaveis.length ? 'não há pendência com ação para confirmar'
      : ult.contrato !== hashArq(contratoArq) ? 'o contrato mudou' : (est.reconferencias || 0) >= 2 ? 'já foram 2 reconferências seguidas'
      : !fs.existsSync(path.join(raiz, ult.pasta || '-')) ? 'a rodada revisada foi apagada' : '';
    if (ult && !motivoCompleta) {
      const pac = pacoteReconferencia(raiz, r, ult, fp);
      if (!pac.erro && pac.fora <= 0.3) {
        est.reconf = {fp, itens: acionaveis.map((p, i) => ({...p, texto: `${i + 1}. ${p.texto.replace(/^- /, '')}`}))};
        est.reconferencias = (est.reconferencias || 0) + 1;
        const escalar = (ult.pendentes || []).some(p => p.duvida);
        return bloquear(`A conferência mecânica passou (${r.pasta}, impressão ${fp}). Falta CONFIRMAR as ${pac.n} pendência(s) do revisor: reconferência barata, não revisão inteira.\n` +
          `Chame o Agent com subagent_type "toc-reconferente"${escalar ? ' e model "sonnet"' : ''} (agente enxuto: só ler e gravar; se não existir, use general-purpose com model "${escalar ? 'sonnet' : 'haiku'}") e este prompt: ` +
          `"Pacote: ${pac.md}" ` +
          `Ele só olha os recortes "antes | agora" de cada pendência e as mudanças fora delas. Não escreva o veredito você mesmo.` +
          (escalar ? ' (A reconferência anterior teve dúvida: por isso sonnet desta vez.)' : '') +
          `\nDepois de chamar, rode ${toc} esperar.`);
      }
      if (pac.erro) process.stderr.write(`toc: reconferência indisponível (${pac.erro}); pedindo revisão completa\n`);
    }
    const so = contrato.itens.filter(i => i.tipo === 'revisor').map(i => i.id);
    const folhas = (r.folhas || []).map(f => r.pasta + '/' + f);
    const mudancas = folhas.filter(f => /folha-mudancas/.test(f));
    // A 1ª revisão é completa; as seguintes confirmam as correções sobre o veredito anterior (custa bem menos).
    const confirmacao = ver ? `\nRodada de CONFIRMAÇÃO (já existe veredito, nota ${ver.nota ?? '?'}): use a seção "Rodada de confirmação" do roteiro. ` +
      `Passe ao revisor a lista do que você mudou e por quê, o veredito anterior (${PASTA.split(path.sep).join('/')}/veredito.json, ele lê antes de sobrescrever)` +
      (mudancas.length ? ` e as folhas de mudanças (${mudancas.join(', ')})` : '') + '; ele não refaz a revisão inteira.' : '';
    return bloquear(`A conferência mecânica passou (${r.pasta}, impressão ${fp}). Falta o olho de fora.\n` +
      `Chame o Agent com subagent_type "toc-revisor" (agente enxuto, Sonnet, só ler e gravar: corta o custo fixo de herdar todas as ferramentas). ` +
      `Prompt: "raiz ${raiz}; rodada ${r.pasta}; folhas ${folhas.join(', ')}; impressão ${fp}". ` +
      `Se o agente não existir, use general-purpose com model "sonnet" e o roteiro de ${path.join(SKILL, 'referencias', 'revisor.md')} preenchido com esses caminhos. ` +
      `Ele grava ${PASTA.split(path.sep).join('/')}/veredito.json. Não escreva o veredito você mesmo.` + confirmacao +
      `\nDepois de chamar o revisor, rode ${toc} esperar: marca o revisor como em andamento (terminar enquanto ele trabalha não gasta rodada) e espera o veredito.` +
      (so.length ? `\nItens que só o revisor julga: ${so.join(', ')}.` : ''));
  }
  if (est.revisor) delete est.revisor;
  const pend = pendenciasDe(ver, contrato, est);
  if (ver.tipo !== 'reconferencia') est.reconferencias = 0;
  est.ultimaRevisao = {fp, pasta: r.pasta, tipo: ver.tipo || 'completa', contrato: hashArq(contratoArq), pendentes: pend};
  gravarJSON(arq, est);
  const falhas = pend.map(p => p.texto);
  if (falhas.length) {
    const quem = ver.tipo === 'reconferencia' ? 'A reconferência' : `O revisor (nota ${ver.nota ?? '?'})`;
    return bloquear(`${quem} deixou pendências:\n${falhas.join('\n')}\n\n` +
      `Na próxima volta, a confirmação é barata (só os recortes destas pendências), desde que você mexa só nelas. ` +
      `Corrija e termine de novo; a conferência e o revisor rodam outra vez sobre o resultado novo. ${naoMexer}` +
      `Discorda de um achado? Explique no relatório final em vez de ignorar; não edite o veredito.`);
  }
  est.ativo = false; est.fim = 'concluido'; est.terminou = new Date().toISOString();
  gravarJSON(arq, est);
  process.stdout.write(JSON.stringify({systemMessage: `toc: contrato fechado em ${est.rodada} rodada(s), conferência e revisor sem pendências.`}));
}
const lerJSON0 = s => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

function principal() {
  const [cmd = 'status', ...resto] = process.argv.slice(2);
  const arg = (n, p) => { const i = resto.indexOf('--' + n); return i >= 0 ? resto[i + 1] : p; };
  const raiz = arg('raiz') ? path.resolve(arg('raiz')) : acharRaiz(process.cwd());
  const arq = arqEstado(raiz);
  const est = lerJSON(arq, null);
  const sair = (msg, cod = 0) => { process.stdout.write(msg + '\n'); process.exit(cod); };

  if (cmd === 'hook') return hook().catch(e => { process.stderr.write('toc hook: ' + e.message + '\n'); process.exit(0); });
  if (cmd === 'login') {
    const url = resto.find(x => /^https?:|^file:/.test(x));
    if (!url) sair('Uso: toc.mjs login URL [--sessao .claude/toc/sessao.json]', 1);
    process.stdout.write(`Abrindo o Chrome em ${url}. Entre (senha da loja, conta, código) e FECHE A JANELA quando a página certa aparecer.\n`);
    return login({url, raiz, arquivo: arg('sessao')}).then(({destino, salvas}) =>
      sair(salvas ? `toc: sessão salva em ${destino}. As próximas conferências entram logadas. Não versione esse arquivo (já está no .gitignore da pasta).` : 'toc: não consegui salvar a sessão (a janela fechou antes de carregar?).', salvas ? 0 : 1))
      .catch(e => sair('toc login: ' + e.message, 2));
  }
  if (cmd === 'iniciar') {
    const contratoRel = arg('contrato', path.join(PASTA, 'contrato.json'));
    const c = lerContrato(path.resolve(raiz, contratoRel));
    const ver = path.join(raiz, PASTA, 'veredito.json');
    if (fs.existsSync(ver)) fs.renameSync(ver, path.join(raiz, PASTA, 'veredito-anterior.json'));
    const novo = {ativo: true, sessao: process.env.CLAUDE_CODE_SESSION_ID || '', rodada: 0, max: Number(arg('max', 8)),
      contrato: contratoRel.split(path.sep).join('/'), iniciado: new Date().toISOString(), conferencias: est?.conferencias || 0, cache: est?.cache};
    gravarJSON(arq, novo);
    const porScript = c.itens.filter(i => i.tipo !== 'revisor').length;
    return sair(`toc ligado: até ${novo.max} rodadas. Contrato com ${c.itens.length} itens (${porScript} conferidos por script, ${c.itens.length - porScript} pelo revisor).\n` +
      `Ao tentar terminar, o hook confere a página e só deixa parar quando tudo fechar.`);
  }
  if (!est) sair('toc: nenhum laço neste projeto (falta .claude/toc/estado.json).', cmd === 'status' ? 0 : 1);
  if (cmd === 'conferir') {
    const contratoArq = path.resolve(raiz, est.contrato);
    const fp = impressao(raiz, lerContrato(contratoArq), contratoArq);
    const r = rodarConferencia(raiz, est, fp);
    gravarJSON(arq, est);
    if (r.erro) sair('toc: a conferência não rodou:\n' + r.erro, 2);
    sair(resumo(r, 30).trimEnd() + `\n\nPasta: ${r.pasta} · impressão ${fp}`, r.passou ? 0 : 1);
  }
  if (cmd === 'esperar') {
    // Marca o revisor desta impressão como em andamento e espera o veredito dela (o hook não gasta rodada enquanto isso).
    const contratoArq = path.resolve(raiz, est.contrato);
    const fp = impressao(raiz, lerContrato(contratoArq), contratoArq);
    est.revisor = {fp, desde: new Date().toISOString()};
    gravarJSON(arq, est);
    const limite = Date.now() + Number(arg('max-s', 600)) * 1000;
    const verArq = path.join(raiz, PASTA, 'veredito.json');
    const pausa = new Int32Array(new SharedArrayBuffer(4));
    while (Date.now() < limite) {
      const ver = lerJSON(verArq, null);
      if (ver?.fp === fp) {
        delete est.revisor; gravarJSON(arq, est); // revisor terminou: a próxima revisão não pode esperar por ele
        const pend = falhasVeredito(ver, lerContrato(contratoArq), est);
        sair(`toc: veredito chegou (nota ${ver.nota ?? '?'}). ` + (pend.length ? `Pendências:\n${pend.join('\n')}` : 'Sem pendências: pode terminar.'));
      }
      Atomics.wait(pausa, 0, 0, 3000);
    }
    sair(`toc: o veredito da impressão ${fp} não chegou a tempo. O revisor ainda roda? Rode esperar de novo; se ele morreu, chame outro.`, 1);
  }
  if (cmd === 'impressao') { const a = path.resolve(raiz, est.contrato); sair(impressao(raiz, lerContrato(a), a)); }
  if (cmd === 'pausar') { est.ativo = false; est.pausado = true; gravarJSON(arq, est); sair('toc pausado. Retome com: toc.mjs retomar'); }
  if (cmd === 'retomar') { est.ativo = true; delete est.pausado; delete est.fim; delete est.turno; est.esperas = 0; est.ultimaAtividade = new Date().toISOString(); gravarJSON(arq, est); sair(`toc retomado na rodada ${est.rodada}/${est.max}.`); }
  if (cmd === 'parar') { est.ativo = false; est.fim = 'parado'; est.terminou = new Date().toISOString(); gravarJSON(arq, est); sair('toc desligado neste projeto. Relatórios ficam em .claude/toc/.'); }
  if (cmd === 'status') {
    const r = est.cache ? lerJSON(path.join(raiz, est.cache.pasta, 'relatorio.json'), null) : null;
    sair(`toc ${est.ativo ? 'ligado' : 'desligado'}${est.fim ? ' (' + est.fim + ')' : ''}${est.pausado ? ' (pausado)' : ''} · rodada ${est.rodada}/${est.max} · contrato ${est.contrato}` +
      (r ? `\n\n${resumo(r, 20).trimEnd()}` : '\nAinda sem conferência.'));
  }
  sair(`toc: comando desconhecido "${cmd}". Use iniciar, conferir, esperar, status, pausar, retomar, parar ou hook.`, 1);
}
principal();
