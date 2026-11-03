#!/usr/bin/env node
// toc: liga, desliga e confere o laço que não deixa o Claude parar antes de o contrato fechar.
// Uso: node toc.mjs iniciar [--contrato .claude/toc/contrato.json] [--max 8]
//      node toc.mjs conferir | status | pausar | retomar | parar | impressao
//      node toc.mjs hook        (hook Stop do Claude Code; lê o JSON do stdin)
// Estado em <projeto>/.claude/toc/estado.json. Sem esse arquivo (ou com ativo=false) o hook não faz nada.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {lerContrato, resumo} from './conferir.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.dirname(AQUI);
const PASTA = path.join('.claude', 'toc');
const PULAR = new Set(['node_modules', '.git', '.claude', '.next', '.cache', '__pycache__', '.venv', 'venv']);

const lerJSON = (arq, padrao) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; } };
const gravarJSON = (arq, obj) => { fs.mkdirSync(path.dirname(arq), {recursive: true}); const t = `${arq}.${process.pid}.tmp`; fs.writeFileSync(t, JSON.stringify(obj, null, 2)); fs.renameSync(t, arq); };
const arqEstado = raiz => path.join(raiz, PASTA, 'estado.json');
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

function rodarConferencia(raiz, est, fp) {
  const n = (est.conferencias || 0) + 1;
  const saida = path.join(raiz, PASTA, `rodada-${String(n).padStart(2, '0')}`);
  fs.rmSync(saida, {recursive: true, force: true});
  const r = spawnSync(process.execPath, [path.join(AQUI, 'conferir.mjs'), '--contrato', path.resolve(raiz, est.contrato), '--saida', saida, '--raiz', raiz, '--fp', fp],
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

function falhasVeredito(ver, contrato) {
  const l = [];
  for (const it of contrato.itens.filter(i => i.tipo === 'revisor')) {
    const j = (ver.itensContrato || []).find(x => x.id === it.id);
    if (!j) l.push(`- [contrato ${it.id}] o revisor não julgou: ${it.descricao || ''}`);
    else if (!j.ok) l.push(`- [contrato ${it.id}] ${it.descricao || ''}: ${j.evidencia || 'não cumprido'}`);
  }
  for (const a of ver.achados || []) if ((a.gravidade === 'bloqueia' || a.gravidade === 'corrigir') && a.dentroDoEscopo !== false)
    l.push(`- [${a.gravidade}] ${a.onde || ''}: ${a.problema}${a.correcao ? ' → ' + a.correcao : ''}`);
  const minima = contrato.notaMinima ?? 80;
  if (typeof ver.nota === 'number' && ver.nota < minima)
    l.push(`- nota do revisor ${ver.nota} abaixo de ${minima}${l.length ? '' : ' sem achado acionável: peça a ele os 3 pontos que mais tiram nota, com valor concreto'}`);
  return l;
}

const lerStdin = () => new Promise(res => {
  if (process.stdin.isTTY) return res('');
  let d = ''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => (d += c)); process.stdin.on('end', () => res(d));
});

async function hook() {
  const entrada = lerJSON0(await lerStdin());
  const raiz = entrada.cwd || process.cwd();
  const arq = arqEstado(raiz);
  const est = lerJSON(arq, null);
  if (!est || !est.ativo) return;
  if (est.sessao && entrada.session_id && est.sessao !== entrada.session_id) return; // laço de outra sessão
  if (!est.sessao && entrada.session_id) est.sessao = entrada.session_id;
  const toc = `"${process.execPath}" "${path.join(AQUI, 'toc.mjs')}"`;
  const bloquear = motivo => {
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
    const so = contrato.itens.filter(i => i.tipo === 'revisor').map(i => i.id);
    return bloquear(`A conferência mecânica passou (${r.pasta}, impressão ${fp}). Falta o olho de fora.\n` +
      `Chame um subagente revisor (Agent, model "sonnet", salvo regra do projeto) com o roteiro de ${path.join(SKILL, 'referencias', 'revisor.md')}, preenchendo: ` +
      `contrato ${est.contrato}, relatório ${r.pasta}/relatorio.json, texto extraído ${r.pasta}/texto.md, folhas ${(r.folhas || []).map(f => r.pasta + '/' + f).join(', ')}, impressão ${fp}. ` +
      `Ele grava ${PASTA.split(path.sep).join('/')}/veredito.json. Não escreva o veredito você mesmo.` +
      (so.length ? `\nItens que só o revisor julga: ${so.join(', ')}.` : ''));
  }
  const falhas = falhasVeredito(ver, contrato);
  if (falhas.length) {
    return bloquear(`O revisor (nota ${ver.nota ?? '?'}) deixou pendências:\n${falhas.join('\n')}\n\n` +
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
  const raiz = path.resolve(arg('raiz', process.cwd()));
  const arq = arqEstado(raiz);
  const est = lerJSON(arq, null);
  const sair = (msg, cod = 0) => { process.stdout.write(msg + '\n'); process.exit(cod); };

  if (cmd === 'hook') return hook().catch(e => { process.stderr.write('toc hook: ' + e.message + '\n'); process.exit(0); });
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
  if (cmd === 'impressao') { const a = path.resolve(raiz, est.contrato); sair(impressao(raiz, lerContrato(a), a)); }
  if (cmd === 'pausar') { est.ativo = false; est.pausado = true; gravarJSON(arq, est); sair('toc pausado. Retome com: toc.mjs retomar'); }
  if (cmd === 'retomar') { est.ativo = true; delete est.pausado; delete est.fim; gravarJSON(arq, est); sair(`toc retomado na rodada ${est.rodada}/${est.max}.`); }
  if (cmd === 'parar') { est.ativo = false; est.fim = 'parado'; est.terminou = new Date().toISOString(); gravarJSON(arq, est); sair('toc desligado neste projeto. Relatórios ficam em .claude/toc/.'); }
  if (cmd === 'status') {
    const r = est.cache ? lerJSON(path.join(raiz, est.cache.pasta, 'relatorio.json'), null) : null;
    sair(`toc ${est.ativo ? 'ligado' : 'desligado'}${est.fim ? ' (' + est.fim + ')' : ''}${est.pausado ? ' (pausado)' : ''} · rodada ${est.rodada}/${est.max} · contrato ${est.contrato}` +
      (r ? `\n\n${resumo(r, 20).trimEnd()}` : '\nAinda sem conferência.'));
  }
  sair(`toc: comando desconhecido "${cmd}". Use iniciar, conferir, status, pausar, retomar, parar ou hook.`, 1);
}
principal();
