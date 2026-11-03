#!/usr/bin/env node
// Conferência mecânica do toc: abre a página como um visitante em cada tela do contrato,
// rola do topo ao fim, fotografa e mede o que dá para medir sem opinião.
// Uso: node conferir.mjs --contrato .claude/toc/contrato.json --saida <pasta> [--raiz .] [--fp x]
// Sai com 0 (passou), 1 (há pendências) ou 2 (não conseguiu conferir).
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {execSync, spawnSync} from 'node:child_process';
import {lintar, textoMd} from './slop.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const TIPOS = new Set(['existe', 'texto', 'semTexto', 'visivelSemRolar', 'css', 'contraste', 'js', 'revisor', 'contagem', 'celula', 'estrutura']);
export const ehPagina = c => !!c.url || /\.html?$/i.test(c.arquivo || '');
const python = (args, timeout = 420000) => spawnSync(process.env.TOC_PYTHON || 'python', ['-I', path.join(AQUI, 'doc.py'), ...args], {encoding: 'utf8', timeout, maxBuffer: 1 << 26});
const lerJSONseguro = arq => { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return null; } };
// dispensa vale por regra ("texto" cobre todas as texto-*), trecho do "onde" (seletor) e trecho do detalhe (contem)
const dispensa = (ds, a) => (ds || []).some(d => (d.regra === a.regra || (d.regra === 'texto' && a.regra.startsWith('texto-'))) &&
  (!d.seletor || (a.onde || '').includes(d.seletor)) && (!d.contem || (a.detalhe || '').includes(d.contem)));

// Texto visível da página em blocos, para o verificador de texto e o corretor.
const BLOCOS_WEB = () => {
  const out = [], vistos = new Set(), bloco = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,figcaption,td,th,dt,dd,button,label,summary';
  for (const el of document.querySelectorAll(bloco + ',a')) {
    if (el.closest('[aria-hidden="true"],[inert],script,style,noscript,template')) continue;
    if (el.checkVisibility && !el.checkVisibility({checkVisibilityCSS: true})) continue;
    if (el.parentElement && el.parentElement.closest(bloco)) continue;
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (!t || vistos.has(t)) continue;
    vistos.add(t);
    const tag = el.tagName.toLowerCase(), cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
    const papel = /^h\d$/.test(tag) ? 'titulo' : tag === 'li' ? 'lista' : (['a', 'button', 'label', 'summary', 'th'].includes(tag) || t.split(' ').length < 4) ? 'rotulo' : 'corpo';
    // ficha tipográfica: o que o navegador calculou de verdade (o revisor não precisa adivinhar fonte pela foto)
    const s = getComputedStyle(el), fam = s.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
    out.push({onde: tag + (el.id ? '#' + el.id : cls ? '.' + cls : ''), papel, texto: t, origem: 'web',
      fonte: `${fam} ${Math.round(parseFloat(s.fontSize))}px ${s.fontWeight}${s.fontStyle === 'italic' ? ' itálico' : ''}`,
      nivel: /^h\d$/.test(tag) ? +tag[1] : undefined, grupo: tag === 'li' ? [...document.querySelectorAll('ul,ol')].indexOf(el.parentElement) : undefined});
  }
  return out.slice(0, 600);
};

// Achados de texto (higiene, no-ai-slop) e de ortografia (corretor do Word, quando houver) sobre os blocos.
function conferirTexto(blocos, c, saida, rotulo) {
  const e = c.estilo || {}, out = [];
  out.push(...lintar(blocos, {slop: e.slop, travessaoMax: e.travessaoMax}).map(a => ({...a, tela: rotulo})));
  fs.writeFileSync(path.join(saida, 'texto.md'), textoMd(blocos));
  return out;
}
const PADRAO = {telas: ['1440x900', '768x1024', '390x844'], movimento: ['normal', 'reduzido'], esperaMs: 1200, passoMs: 700, notaMinima: 80};
const PESO = {bloqueia: 3, corrigir: 2, nota: 1};
let relogio = Date.now();
const marca = s => { if (process.env.TOC_DEBUG) { const t = Date.now(); process.stderr.write(`[${((t - relogio) / 1000).toFixed(1)}s] ${s}\n`); relogio = t; } };
const CHROME = [process.env.TOC_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));

export function lerContrato(arquivo) {
  const c = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const faltam = [];
  if (!c.pedido) faltam.push('pedido');
  if (!c.url && !c.arquivo) faltam.push('url ou arquivo');
  if (!Array.isArray(c.itens) || !c.itens.length) faltam.push('itens');
  if (faltam.length) throw new Error('contrato sem: ' + faltam.join(', '));
  const ids = new Set();
  for (const it of c.itens) {
    if (!it.id || !it.tipo) throw new Error('item sem id ou tipo: ' + JSON.stringify(it));
    if (ids.has(it.id)) throw new Error('id repetido no contrato: ' + it.id);
    if (!TIPOS.has(it.tipo)) throw new Error(`tipo desconhecido em ${it.id}: ${it.tipo} (use ${[...TIPOS].join(', ')})`);
    ids.add(it.id);
  }
  const r = {...PADRAO, ...c};
  // Página com tela de celular e de desktop: o revisor sempre julga se cada uma tem composição própria.
  const larguras = r.telas.map(t => +String(t).split('x')[0]);
  if (ehPagina(r) && larguras.some(w => w < 768) && larguras.some(w => w >= 1000) && r.mobileProprio !== false && !r.itens.some(i => i.id === 'CM'))
    r.itens = [...r.itens, {id: 'CM', tipo: 'revisor', origem: 'regra do toc',
      descricao: 'celular e desktop têm cada um a sua composição (ordem, tamanhos, o que aparece na primeira tela): o celular não é o desktop espremido e o desktop não é o celular esticado'}];
  return r;
}

export function carregarPlaywright(raiz, ...extras) {
  const bases = [raiz, ...extras, process.cwd(), path.dirname(fileURLToPath(import.meta.url))];
  const tentar = base => {
    for (const nome of ['playwright', 'playwright-core', '@playwright/test']) {
      try { const m = createRequire(path.join(base, 'noop.js'))(nome); if (m.chromium) return m; } catch {}
    }
  };
  for (const b of bases) { const m = tentar(b); if (m) return m; }
  try {
    const global = execSync('npm root -g', {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
    const m = tentar(path.dirname(global)); if (m) return m;
  } catch {}
  throw new Error('Playwright não encontrado. Instale no projeto: npm i -D playwright');
}

// Mede CLS desde o primeiro quadro.
const INICIO = () => {
  window.__tocCLS = 0;
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__tocCLS += e.value; })
      .observe({type: 'layout-shift', buffered: true});
  } catch {}
};

// Roda dentro da página. Autossuficiente: o Playwright serializa a função.
async function sonda(o) {
  const vw = innerWidth, vh = innerHeight, out = [];
  const estilos = new Map(), opacs = new Map();
  const cs = el => { let s = estilos.get(el); if (!s) estilos.set(el, s = getComputedStyle(el)); return s; };
  const caminho = el => {
    const p = [];
    for (let e = el, i = 0; e && e.nodeType === 1 && e !== document.body && e !== document.documentElement && i < 4; e = e.parentElement, i++) {
      let s = e.tagName.toLowerCase();
      if (e.id) { p.unshift(s + '#' + e.id); break; }
      const c = [...e.classList].filter(k => !k.startsWith('is-')).slice(0, 2).join('.');
      if (c) s += '.' + c;
      p.unshift(s);
    }
    return p.join(' > ');
  };
  const casa = (el, sel) => { try { return !!el.closest(sel); } catch { return false; } };
  const dispensado = (regra, el, det) => (o.dispensas || []).some(d => d.regra === regra &&
    (!d.seletor || (el && casa(el, d.seletor))) && (!d.contem || String(det).includes(d.contem)));
  const achar = (regra, gravidade, el, detalhe, valor) =>
    out.push({regra, gravidade, onde: el ? caminho(el) : '', detalhe, valor, dispensado: dispensado(regra, el, detalhe)});
  const opac = el => {
    if (opacs.has(el)) return opacs.get(el);
    let a = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const s = cs(e);
      if (s.display === 'none') { a = 0; break; }
      a *= +s.opacity;
    }
    opacs.set(el, a);
    return a;
  };
  const visivel = el => {
    const s = cs(el);
    if (s.visibility === 'hidden' || s.visibility === 'collapse' || s.display === 'none' || s.display === 'contents') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5 && opac(el) > 0.05;
  };
  const naTela = r => r.bottom > 0 && r.top < vh;
  const ocultoAT = el => !!el.closest('[aria-hidden="true"],[inert]');
  const PULA = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'OPTION', 'HEAD']);
  const proprio = el => { let t = ''; for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue; return t.replace(/\s+/g, ' ').trim(); };
  const todos = () => [...document.body.querySelectorAll('*')].filter(el => !PULA.has(el.tagName) && !(el instanceof SVGElement));
  const textos = () => todos().filter(el => proprio(el).length > 0 && visivel(el));
  const retTexto = el => {
    const rs = [];
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      for (const q of r.getClientRects()) if (q.width > 0.5 && q.height > 0.5) rs.push(q);
    }
    return rs;
  };
  const uniao = rs => rs.reduce((a, r) => ({left: Math.min(a.left, r.left), top: Math.min(a.top, r.top), right: Math.max(a.right, r.right), bottom: Math.max(a.bottom, r.bottom)}),
    {left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity});
  const identidade = t => t === 'none' || /^matrix\(1, 0, 0, 1, 0, 0\)$/.test(t);
  const fixo = el => { for (let e = el; e && e !== document.body; e = e.parentElement) if (/fixed|sticky/.test(cs(e).position)) return true; return false; };
  // Quebra do título: palavra sozinha na última linha, ou palavra de uma letra pendurada no fim de uma linha.
  // Conferido no passo em que o título está na tela, porque muitos títulos somem ao rolar.
  const conferirTitulo = h => {
    const ws = [], tw = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      for (let e = n.parentElement; e && e !== h.parentElement; e = e.parentElement) if (!identidade(cs(e).transform)) return; // entrando
      const re = /\S+/g; let m;
      while ((m = re.exec(n.nodeValue))) {
        const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
        const q = r.getClientRects()[0];
        if (!q || q.width <= 0) continue;
        const ant = ws[ws.length - 1];
        if (ant && !/[\p{L}\p{N}]/u.test(m[0]) && Math.abs(q.top - ant.top) < ant.h * 0.6) { ant.t += m[0]; ant.r = Math.max(ant.r, q.right); } // pontuação colada (".", "!") não é palavra
        else ws.push({t: m[0], top: q.top, h: q.height, l: q.left, r: q.right});
      }
    }
    const linhas = [];
    for (const w of ws) {
      const l = linhas[linhas.length - 1];
      if (!l || w.top > l.top + l.h * 0.6) linhas.push({top: w.top, h: w.h, ws: [w.t], l: w.l, r: w.r});
      else { l.ws.push(w.t); l.l = Math.min(l.l, w.l); l.r = Math.max(l.r, w.r); }
    }
    if (linhas.length < 2) return;
    const g = h.tagName === 'H3' ? 'nota' : 'corrigir', ultima = linhas[linhas.length - 1];
    const larg = l => l.r - l.l, maior = Math.max(...linhas.map(larg));
    // palavra longa sozinha ocupa a linha quase toda e não é viúva: só conta se a última linha for curta perto das outras
    if (ws.length >= 4 && ultima.ws.length === 1 && larg(ultima) < maior * 0.35) achar('viuva', g, h, `"${ultima.ws[0]}" sozinha na última linha do título (${linhas.length} linhas)`);
    const pendurada = linhas.slice(0, -1).map(l => l.ws[l.ws.length - 1]).find(p => p.replace(/[^\p{L}]/gu, '').length === 1);
    if (pendurada) achar('palavra-pendurada', g, h, `"${pendurada}" pendurada no fim da linha, separada da palavra seguinte`);
  };

  // cores: o canvas normaliza qualquer sintaxe CSS (rgb, oklch, color-mix) para sRGB
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', {willReadFrequently: true});
  const cores = new Map();
  const cor = s => {
    if (cores.has(s)) return cores.get(s);
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data, v = [d[0], d[1], d[2], d[3] / 255];
    cores.set(s, v); return v;
  };
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const razao = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const sobre = (t, b) => [0, 1, 2].map(i => t[i] * t[3] + b[i] * (1 - t[3]));
  const grande = s => { const f = parseFloat(s.fontSize), w = parseInt(s.fontWeight) || 400; return f >= 24 || (f >= 18.66 && w >= 700); };

  const pixels = async png => {
    const im = new Image(); im.src = 'data:image/png;base64,' + png; await im.decode();
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d', {willReadFrequently: true}); x.drawImage(im, 0, 0);
    return {w: c.width, h: c.height, d: x.getImageData(0, 0, c.width, c.height).data};
  };
  // Contraste medido na foto: separa pixels de letra (perto da cor do texto) e de fundo.
  const contrastePixel = (el, px) => {
    const s = cs(el), tc = cor(s.color);
    if (tc[3] < 0.05) return null;
    const am = [];
    for (const r of retTexto(el)) {
      const x0 = Math.max(0, Math.floor(r.left)), x1 = Math.min(px.w - 1, Math.ceil(r.right));
      const y0 = Math.max(0, Math.floor(r.top)), y1 = Math.min(px.h - 1, Math.ceil(r.bottom));
      for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) { const i = (y * px.w + x) * 4; am.push([px.d[i], px.d[i + 1], px.d[i + 2]]); }
      if (am.length > 6000) break;
    }
    if (am.length < 40) return null;
    const dist = p => Math.hypot(p[0] - tc[0], p[1] - tc[1], p[2] - tc[2]);
    const comD = am.map(p => [p, dist(p)]);
    const letra = comD.filter(([, d]) => d < 48).length;
    if (letra < am.length * 0.02) return null; // letra não aparece na foto (entrando, mistura, gradiente)
    const alfa = tc[3] * opac(el);
    const ef = b => sobre([tc[0], tc[1], tc[2], alfa], b);
    if (letra > am.length * 0.75) { // fundo da mesma cor da letra
      const m = am.map(p => p).sort((a, b) => lum(a) - lum(b))[am.length >> 1];
      const v = razao(ef(m), m); return {tip: v, pior: v};
    }
    const fundo = comD.filter(([, d]) => d >= 48).sort((a, b) => b[1] - a[1]);
    if (fundo.length < am.length * 0.2) return null;
    const nucleo = fundo.slice(0, Math.max(10, Math.floor(fundo.length * 0.6))).map(([p]) => p).sort((a, b) => lum(a) - lum(b));
    const med = nucleo[nucleo.length >> 1];
    const pior = lum(tc) > lum(med) ? nucleo[Math.floor(nucleo.length * 0.9)] : nucleo[Math.floor(nucleo.length * 0.1)];
    return {tip: razao(ef(med), med), pior: razao(ef(pior), pior), fundo: med, letra: tc};
  };
  // Contraste pelo CSS dos ancestrais, só quando não há foto nem mídia por trás.
  const contrasteCSS = el => {
    const camadas = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const s = cs(e);
      if (s.backgroundImage && s.backgroundImage !== 'none') return null;
      const c = cor(s.backgroundColor);
      if (c[3] > 0) { camadas.push(c); if (c[3] >= 0.99) break; }
    }
    let base = [255, 255, 255];
    for (let i = camadas.length - 1; i >= 0; i--) base = sobre(camadas[i], base);
    const tc = cor(cs(el).color);
    const v = razao(sobre([tc[0], tc[1], tc[2], tc[3] * opac(el)], base), base);
    return {tip: v, pior: v};
  };
  const midias = () => [...document.querySelectorAll('canvas,video,img,picture,iframe')].filter(visivel).map(m => [m, m.getBoundingClientRect()]);
  const sobreMidia = (el, r, ms) => ms.some(([m, q]) => !m.contains(el) && !el.contains(m) && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top);
  const avaliarContraste = (el, px, ms, regra, minimo) => {
    const s = cs(el);
    if (s.mixBlendMode !== 'normal' || /text/.test(s.backgroundClip + ' ' + (s.webkitBackgroundClip || ''))) return null;
    const u = uniao(retTexto(el));
    const m = px ? contrastePixel(el, px) : (sobreMidia(el, u, ms) ? null : contrasteCSS(el));
    if (!m) return null;
    if (m.fundo && m.letra) { // cinza sobre fundo colorido (Impeccable): texto secundário deve puxar o tom do fundo
      const sat = c => Math.max(...c.slice(0, 3)) - Math.min(...c.slice(0, 3));
      if (sat(m.letra) < 16 && sat(m.fundo) > 70 && m.letra[0] > 60 && m.letra[0] < 200)
        achar('cinza-sobre-cor', 'nota', el, `texto cinza sobre fundo colorido (rgb ${m.fundo.join(',')}): tinja o texto com o tom do fundo em vez de cinza`);
    }
    const precisa = minimo || (grande(s) ? 3 : 4.5);
    const fmt = v => v.toFixed(2).replace('.', ',');
    if (m.tip < precisa) achar(regra, 'corrigir', el, `contraste ${fmt(m.tip)}:1, precisa ${fmt(precisa)}:1 (${px ? 'medido na foto' : 'pelo CSS'})`, m.tip);
    else if (m.pior < precisa) achar(regra, 'nota', el, `parte do fundo derruba o contraste para ${fmt(m.pior)}:1 (precisa ${fmt(precisa)}:1)`, m.pior);
    return m;
  };

  if (o.modo === 'passo') {
    const px = o.png ? await pixels(o.png).catch(() => null) : null;
    const ms = midias();
    const lateral = document.documentElement.scrollWidth - vw;
    if (lateral > 1) achar('rolagem-lateral', 'bloqueia', null, `a página rola ${lateral}px para o lado`, lateral);
    const livres = [];
    for (const el of textos()) {
      if (ocultoAT(el)) continue;
      const rs = retTexto(el); if (!rs.length) continue;
      const u = uniao(rs);
      if (!naTela(u)) continue;
      if ((u.left < -1 && u.right > 0) || (u.right > vw + 1 && u.left < vw)) {
        let recortado = false;
        for (let e = el.parentElement; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
          const s = cs(e);
          if (/hidden|clip|auto|scroll/.test(s.overflowX)) { const q = e.getBoundingClientRect(); if (q.left >= -1 && q.right <= vw + 1) { recortado = true; break; } }
        }
        if (!recortado) achar('fora-da-tela', 'bloqueia', el, `texto passa da borda da tela (${Math.round(Math.max(-u.left, u.right - vw))}px)`);
      }
      const r0 = rs.find(r => r.top >= 0 && r.bottom <= vh && r.left >= 0 && r.right <= vw) || rs[0];
      const t = document.elementFromPoint(Math.min(vw - 1, Math.max(0, (r0.left + r0.right) / 2)), Math.min(vh - 1, Math.max(0, (r0.top + r0.bottom) / 2)));
      if (!t || !(t === el || el.contains(t) || t.contains(el))) continue; // coberto por outra coisa agora
      if (opac(el) < 0.6) continue; // entrando ou saindo
      livres.push([el, u]);
      const s = cs(el);
      if (/[\p{L}\p{N}]/u.test(proprio(el)) && parseFloat(s.fontSize) >= 9) avaliarContraste(el, px, ms, 'contraste');
    }
    for (let i = 0; i < livres.length; i++) for (let j = i + 1; j < livres.length; j++) {
      const [a, ra] = livres[i], [b, rb] = livres[j];
      if (a.contains(b) || b.contains(a)) continue;
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w <= 0 || h <= 0) continue;
      const menor = Math.min((ra.right - ra.left) * (ra.bottom - ra.top), (rb.right - rb.left) * (rb.bottom - rb.top));
      if (menor <= 100 || w * h <= menor * 0.25) continue;
      // conteúdo passando por baixo de cabeçalho fixo é coisa da rolagem: o revisor olha na foto
      if (fixo(a) !== fixo(b)) achar('sobreposicao', 'nota', a, `durante a rolagem, passa por cima de ${caminho(b)}; confira na foto se o fundo do fixo cobre`);
      else achar('sobreposicao', 'corrigir', a, `texto por cima de outro texto (${caminho(b)})`);
    }
    for (const el of todos()) { // texto cortado por overflow
      const s = cs(el);
      const corteX = /hidden|clip/.test(s.overflowX), corteY = /hidden|clip/.test(s.overflowY);
      if (!corteX && !corteY) continue;
      if (!visivel(el) || ocultoAT(el)) continue;
      const caixa = el.getBoundingClientRect();
      if (!naTela(caixa)) continue;
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n, k = 0, mexendo = false, sx = 0, sy = 0, fonte = 16;
      while ((n = tw.nextNode()) && k++ < 200) {
        if (!n.nodeValue.trim() || ocultoAT(n.parentElement)) continue; // texto decorativo não conta
        fonte = Math.max(fonte, parseFloat(cs(n.parentElement).fontSize) || 16);
        for (let e = n.parentElement; e && e !== el.parentElement; e = e.parentElement) if (!identidade(cs(e).transform) || +cs(e).opacity < 1) { mexendo = true; break; }
        if (mexendo) break;
        const r = document.createRange(); r.selectNodeContents(n);
        for (const q of r.getClientRects()) {
          sx = Math.max(sx, caixa.left - q.left, q.right - caixa.right);
          sy = Math.max(sy, caixa.top - q.top, q.bottom - caixa.bottom);
        }
      }
      if (mexendo) continue;
      if (corteX && sx > 2 && s.textOverflow !== 'ellipsis') achar('cortado', 'corrigir', el, `texto cortado na largura (${Math.round(sx)}px escondidos)`);
      // a caixa do texto inclui a folga da fonte acima e abaixo da letra: pouco além disso é nota, não corte
      if (corteY && sy > 2 && (s.webkitLineClamp === 'none' || !s.webkitLineClamp)) {
        if (sy > fonte * 0.2) achar('cortado', 'corrigir', el, `texto cortado na altura (${Math.round(sy)}px escondidos)`);
        else achar('cortado', 'nota', el, `a máscara encosta na letra (${Math.round(sy)}px); confira na foto se acento ou perna da letra some`);
      }
    }
    for (const h of document.querySelectorAll('h1,h2,h3')) {
      if (!visivel(h) || ocultoAT(h) || opac(h) < 0.6) continue;
      const r = h.getBoundingClientRect();
      if (r.top >= 0 && r.bottom <= vh) conferirTitulo(h);
    }
    const frases = new Map(); // a mesma frase duas vezes na mesma tela (menu de topo e rodapé repetem de propósito)
    for (const [el] of livres) {
      if (el.closest('nav,header,footer')) continue;
      const t = proprio(el).toLowerCase();
      if (t.split(' ').length < 4) continue;
      const outro = frases.get(t);
      if (outro && !outro.contains(el) && !el.contains(outro)) achar('repetido', 'nota', el, `"${proprio(el).slice(0, 60)}" aparece duas vezes na mesma tela (também em ${caminho(outro)})`);
      else frases.set(t, el);
    }
    // controle fixo pequeno (pausa, chat, voltar ao topo) por cima de outro clicável
    const clicaveis = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button]')]
      .filter(e => visivel(e) && !ocultoAT(e) && naTela(e.getBoundingClientRect()));
    for (const f of clicaveis) {
      if (!/fixed|sticky/.test(cs(f).position)) continue;
      const rf = f.getBoundingClientRect();
      if (rf.width > 80 || rf.height > 80) continue;
      for (const o of clicaveis) {
        if (o === f || o.contains(f) || f.contains(o) || fixo(o)) continue;
        const ro = o.getBoundingClientRect();
        const w = Math.min(rf.right, ro.right) - Math.max(rf.left, ro.left), h = Math.min(rf.bottom, ro.bottom) - Math.max(rf.top, ro.top);
        if (w > 0 && h > 0 && w * h > 0.15 * Math.min(rf.width * rf.height, ro.width * ro.height))
          achar('controle-fixo', 'corrigir', f, `fica por cima de ${caminho(o)} (${Math.round(w)}×${Math.round(h)}px)`);
      }
    }
    if (vw < 768) { // alvo de toque
      for (const el of document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[tabindex]:not([tabindex="-1"])')) {
        if (!visivel(el) || ocultoAT(el) || el.disabled) continue;
        const r = el.getBoundingClientRect();
        if (!naTela(r)) continue;
        const s = cs(el);
        if (el.tagName === 'A' && s.display === 'inline' && el.parentElement && proprio(el.parentElement).length > 0) continue; // link no meio do texto
        const m = Math.min(r.width, r.height), tam = `${Math.round(r.width)}×${Math.round(r.height)}px`;
        if (m < 24) achar('alvo-de-toque', 'corrigir', el, `área de toque ${tam} (mínimo 24, ideal 44)`, m);
        else if (m < 44) achar('alvo-de-toque', 'nota', el, `área de toque ${tam} (ideal 44)`, m);
      }
    }
    return {achados: out};
  }

  if (o.modo === 'global') {
    const corpo = document.body.innerText;
    // Fronteira que entende acento (o \b do JS acha "todo" dentro de "método") e grafia exata
    // (com /i, "todo dia" e "Nan" de nome próprio viravam texto provisório).
    const lixo = corpo.match(/[Ll]orem ipsum|(?<![\p{L}\p{N}_])(?:undefined|NaN|TODO|FIXME)(?![\p{L}\p{N}_])|\[object Object\]|\{\{[^}]{0,40}\}\}/u);
    if (lixo) { const i = lixo.index; achar('texto-provisorio', 'bloqueia', null, `aparece "${corpo.slice(Math.max(0, i - 30), i + 40).replace(/\s+/g, ' ')}"`); }
    for (const im of document.images) {
      if (!visivel(im) || ocultoAT(im)) continue;
      const src = (im.currentSrc || im.src || '').split('/').pop().slice(0, 60);
      if (!im.hasAttribute('alt')) achar('alt', 'corrigir', im, `imagem sem alt (${src}); decorativa leva alt=""`);
      if (im.complete && im.naturalWidth === 0 && !/\.svg(\?|$)/i.test(im.currentSrc || im.src)) { achar('imagem', 'bloqueia', im, `imagem quebrada: ${src}`); continue; }
      if (im.naturalWidth && im.offsetWidth > 16 && im.offsetHeight > 16 && cs(im).objectFit === 'fill') {
        const a = im.naturalWidth / im.naturalHeight, b = im.offsetWidth / im.offsetHeight;
        if (Math.abs(a / b - 1) > 0.02) achar('imagem', 'corrigir', im, `imagem esticada: proporção ${a.toFixed(2)} mostrada como ${b.toFixed(2)}`);
      }
    }
    for (const v of document.querySelectorAll('video')) {
      if (v.error || v.networkState === 3) achar('video', 'bloqueia', v, `vídeo não carregou: ${(v.currentSrc || v.querySelector('source')?.src || '?').split('/').pop()}`);
    }
    const faces = [...document.fonts], porFam = new Map();
    for (const f of faces) {
      const fam = f.family.replace(/^["']|["']$/g, '');
      if (!porFam.has(fam)) porFam.set(fam, []);
      porFam.get(fam).push(f);
      if (f.status === 'error') achar('fonte', 'bloqueia', null, `fonte "${fam}" ${f.weight} ${f.style} não carregou`);
    }
    const SISTEMA = /^(arial|helvetica|helvetica neue|times|times new roman|georgia|verdana|tahoma|trebuchet ms|segoe ui|courier new|system-ui|-apple-system|blinkmacsystemfont|sans-serif|serif|monospace|cursive|ui-sans-serif|ui-serif|ui-monospace|roboto|consolas|menlo|monaco)$/i;
    const ts = textos().filter(el => !ocultoAT(el));
    const vistos = new Set();
    for (const el of ts) {
      const s = cs(el), fam = s.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''), peso = parseInt(s.fontWeight) || 400;
      const chave = fam + '|' + peso + '|' + s.fontStyle;
      if (vistos.has(chave)) continue; vistos.add(chave);
      const fs_ = porFam.get(fam);
      if (!fs_) { if (!SISTEMA.test(fam)) achar('fonte', 'nota', el, `"${fam}" não tem @font-face; depende de estar instalada`); continue; }
      if (fs_.every(f => f.status !== 'loaded')) { achar('fonte', 'corrigir', el, `"${fam}" é usada mas nenhuma variação carregou (aparece a reserva)`); continue; }
      const cobre = fs_.some(f => { const [a, b = a] = String(f.weight).split(/\s+/).map(Number); return peso >= a - 1 && peso <= b + 1; });
      if (!cobre) achar('fonte', 'nota', el, `peso ${peso} de "${fam}" não foi declarado (negrito ou fino sintético)`);
    }
    for (const el of document.querySelectorAll('a[href],button,[role=button]')) {
      if (!visivel(el) || ocultoAT(el)) continue;
      const nome = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || [...el.querySelectorAll('img[alt]')].map(i => i.alt).join(' ') ||
        el.querySelector('svg title')?.textContent || (el.getAttribute('aria-labelledby') ? 'x' : '')).trim();
      if (!nome) achar('nome-acessivel', 'corrigir', el, 'link ou botão sem nome (o leitor de tela diz só "link")');
    }
    for (const pai of todos()) { // quase alinhado: 2 a 4px de diferença quase nunca é de propósito
      if (pai.children.length < 2 || pai.children.length > 40 || !visivel(pai)) continue;
      const fs2 = [...pai.children].filter(f => {
        if (PULA.has(f.tagName) || f instanceof SVGElement) return false;
        const s = cs(f);
        return s.display !== 'none' && s.display !== 'contents' && !s.display.startsWith('inline') && s.position !== 'absolute' && s.position !== 'fixed' && f.offsetWidth >= 24 && f.offsetHeight >= 12;
      }).map(f => ({f, l: f.offsetLeft, t: f.offsetTop, w: f.offsetWidth, h: f.offsetHeight, p: f.offsetParent}));
      for (let i = 0; i + 1 < fs2.length; i++) {
        const a = fs2[i], b = fs2[i + 1];
        if (a.p !== b.p) continue;
        const empilhados = b.t >= a.t + a.h - 1 || a.t >= b.t + b.h - 1;
        if (empilhados) {
          const d = Math.abs(a.l - b.l), centro = Math.abs((a.l + a.w / 2) - (b.l + b.w / 2)) <= 1, direita = Math.abs(a.l + a.w - b.l - b.w) <= 1;
          if (d > 1 && d <= 4 && !centro && !direita) achar('quase-alinhado', 'corrigir', b.f, `borda esquerda ${d}px fora da do vizinho de cima (${caminho(a.f)})`, d);
        } else {
          const d = Math.abs(a.t - b.t), meio = Math.abs((a.t + a.h / 2) - (b.t + b.h / 2)) <= 1, base = Math.abs(a.t + a.h - b.t - b.h) <= 1;
          if (d > 1 && d <= 4 && !meio && !base) achar('quase-alinhado', 'corrigir', b.f, `topo ${d}px fora do vizinho ao lado (${caminho(a.f)})`, d);
          else if (d <= 1 && a.f.className && a.f.className === b.f.className && Math.abs(a.h - b.h) > 1 && Math.abs(a.h - b.h) <= 8)
            achar('quase-alinhado', 'nota', b.f, `altura ${Math.abs(a.h - b.h)}px diferente do vizinho igual (${caminho(a.f)})`);
        }
      }
    }
    // notas de sistema: escala de espaço, cinzas quase iguais, sombras, caixa-alta
    const vis = todos().filter(visivel);
    const vals = new Map();
    for (const el of vis) {
      const s = cs(el);
      const lados = ['Top', 'Bottom'].flatMap(k => ['margin' + k, 'padding' + k]);
      if (s.marginLeft !== s.marginRight) lados.push('marginLeft', 'marginRight');
      lados.push('paddingLeft', 'paddingRight', 'rowGap', 'columnGap');
      for (const p of lados) { const v = parseFloat(s[p]); if (v > 0 && v < 400 && isFinite(v)) { const k = Math.round(v * 2) / 2; vals.set(k, (vals.get(k) || 0) + 1); } }
    }
    if (o.escalaEspaco?.length) {
      const fora = [...vals].filter(([v]) => !o.escalaEspaco.some(e => Math.abs(e - v) < 0.6)).sort((a, b) => b[1] - a[1]);
      if (fora.length) achar('escala', 'nota', null, 'espaços fora da escala: ' + fora.slice(0, 8).map(([v, n]) => `${v}px (${n}x)`).join(', '));
    } else {
      const soltos = [...vals].filter(([v, n]) => n <= 2 && v > 2 && v % 4 !== 0).sort((a, b) => a[0] - b[0]);
      if (soltos.length >= 3) achar('escala', 'nota', null, 'espaços usados 1 ou 2 vezes fora de múltiplos de 4: ' + soltos.slice(0, 8).map(([v]) => v + 'px').join(', '));
    }
    const neutros = new Map();
    for (const el of vis) {
      const s = cs(el);
      const lista = [s.color, s.backgroundColor];
      if (parseFloat(s.borderTopWidth) > 0) lista.push(s.borderTopColor);
      for (const k of lista) { const c = cor(k); if (c[3] > 0.5 && Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) <= 12) neutros.set(c.slice(0, 3).join(','), c); }
    }
    const ns = [...neutros.values()], pares = [];
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
      const d = Math.hypot(ns[i][0] - ns[j][0], ns[i][1] - ns[j][1], ns[i][2] - ns[j][2]);
      if (d >= 2 && d < 9) pares.push(`rgb(${ns[i].slice(0, 3)}) e rgb(${ns[j].slice(0, 3)})`);
    }
    if (pares.length) achar('cinzas', 'nota', null, `cinzas quase iguais (parecem o mesmo, não são): ${pares.slice(0, 4).join('; ')}`);
    // Sinais de interface gerada e acabamento: ideias do Impeccable (detectores) e do Taste Skill (registro de sinais). Ver CREDITOS.
    const hs = [...document.querySelectorAll('h1,h2,h3')].filter(h => visivel(h) && !ocultoAT(h));
    const porPapel = {};
    for (const el of ts) {
      const tag = el.closest('h1,h2,h3,p')?.tagName.toLowerCase();
      if (tag) (porPapel[tag] ||= []).push([parseFloat(cs(el).fontSize), parseInt(cs(el).fontWeight) || 400]);
    }
    const mediana = (a, i) => a.map(x => x[i]).sort((x, y) => x - y)[a.length >> 1];
    const papeis = ['h1', 'h2', 'h3', 'p'].filter(t => porPapel[t]?.length);
    for (let i = 0; i + 1 < papeis.length; i++) {
      const a = porPapel[papeis[i]], b = porPapel[papeis[i + 1]];
      const razaoT = mediana(a, 0) / mediana(b, 0);
      if (razaoT >= 0.95 && razaoT < 1.2 && Math.abs(mediana(a, 1) - mediana(b, 1)) < 200)
        achar('hierarquia-achatada', 'nota', null, `${papeis[i]} (${mediana(a, 0)}px) e ${papeis[i + 1]} (${mediana(b, 0)}px) quase do mesmo tamanho e peso: dê um passo de 1,25x ou mais, ou 200 de peso`);
    }
    const tamanhos = new Set(ts.map(el => Math.round(parseFloat(cs(el).fontSize))));
    if (tamanhos.size > 9) achar('tamanhos-demais', 'nota', null, `${tamanhos.size} tamanhos de letra (${[...tamanhos].sort((a, b) => a - b).join(', ')}px): uns 5, bem separados, leem melhor`);
    const blocosTxt = ts.filter(el => /^(P|H1|H2|H3|LI)$/.test(el.tagName));
    const centr = blocosTxt.filter(el => cs(el).textAlign === 'center').length;
    if (blocosTxt.length >= 8 && centr / blocosTxt.length > 0.72) achar('tudo-centralizado', 'nota', null, `${Math.round(centr / blocosTxt.length * 100)}% dos textos centralizados: ancore à esquerda e guarde o centro para um momento`);
    if (vw >= 1000) for (const h of document.querySelectorAll('h1')) {
      if (!visivel(h)) continue;
      const lh = parseFloat(cs(h).lineHeight) || parseFloat(cs(h).fontSize) * 1.2, n = Math.round(h.getBoundingClientRect().height / lh);
      if (n >= 4) achar('titulo-longo', 'nota', h, `título principal em ${n} linhas no desktop: umas 5 palavras no título, o resto no texto de apoio`);
    }
    for (const h of hs) {
      const p = h.previousElementSibling;
      if (p && visivel(p)) {
        const s = cs(p), t = (p.innerText || '').trim();
        if (t && t.split(/\s+/).length <= 5 && parseFloat(s.fontSize) <= 14 && (s.textTransform === 'uppercase' || parseFloat(s.letterSpacing) > 0.5))
          achar('rotulo-acima-do-titulo', 'nota', p, /^\(?\d{1,3}\)?$/.test(t)
            ? `numeração "${t}" acima do título (01, 02, 03): só use se a ordem informa algo ao leitor`
            : `"${t.slice(0, 30)}" em letra miúda espaçada acima do título: diga isso no título ou no texto de apoio`);
      }
      const n = h.nextElementSibling;
      if (h.tagName !== 'H1' && p && n && visivel(p) && visivel(n)) {
        const r = h.getBoundingClientRect(), acima = r.top - p.getBoundingClientRect().bottom, abaixo = n.getBoundingClientRect().top - r.bottom;
        if (acima >= 0 && abaixo - acima > 8) achar('espaco-do-titulo', 'nota', h, `${Math.round(acima)}px acima e ${Math.round(abaixo)}px abaixo: o título fica mais perto do texto dele do que do bloco anterior`);
      }
    }
    for (const p of document.querySelectorAll('p')) {
      if (!visivel(p) || ocultoAT(p) || (p.innerText || '').length < 200) continue;
      const ch = p.getBoundingClientRect().width / (parseFloat(cs(p).fontSize) * 0.5);
      if (ch > 95) { achar('linha-longa', 'nota', p, `linhas de ~${Math.round(ch)} caracteres: o confortável é 65 a 75 (max-width perto de 70ch)`); break; }
    }
    for (const el of vis) {
      const s = cs(el);
      if (/text/.test(s.backgroundClip + ' ' + (s.webkitBackgroundClip || '')) && /gradient/.test(s.backgroundImage)) achar('texto-gradiente', 'nota', el, 'texto com gradiente: ênfase vem de peso ou tamanho');
      const bl = parseFloat(s.borderLeftWidth);
      if (bl > 1 && bl < 12 && s.borderLeftStyle !== 'none' && parseFloat(s.borderTopWidth) === 0 && el.offsetHeight > 30) {
        const c = cor(s.borderLeftColor);
        if (c[3] > 0.5 && Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) > 40) achar('faixa-lateral', 'nota', el, `faixa colorida de ${bl}px só na lateral: sinal comum de interface gerada`);
      }
      for (const f of `${s.transitionTimingFunction},${s.animationTimingFunction}`.split(/,(?![^(]*\))/)) {
        const m = f.match(/cubic-bezier\(([^)]+)\)/);
        if (m) { const v = m[1].split(',').map(Number); if (v[1] > 1.05 || v[3] > 1.05 || v[1] < -0.05 || v[3] < -0.05) { achar('animacao-elastica', 'nota', el, `easing que passa do ponto (${f.trim()}): ease-out exponencial assenta melhor`); break; } }
      }
    }
    const td = [...document.querySelectorAll('td')].find(t => visivel(t) && /^\s*[\d.,%R$ -]+\s*$/.test(t.innerText || '') && !/tabular-nums/.test(cs(t).fontVariantNumeric));
    if (td) achar('numeros-tabulares', 'nota', td, 'números em tabela sem font-variant-numeric: tabular-nums (os dígitos não alinham na coluna)');
    try {
      const sel = getComputedStyle(document.body, '::selection').backgroundColor;
      if (!sel || sel === 'rgba(0, 0, 0, 0)') achar('superficies-do-navegador', 'nota', null, 'seleção de texto na cor padrão do navegador: defina ::selection (e o anel de foco) com a cor da marca');
    } catch {}
    const xs = new Set();
    for (const el of vis) { const m = cs(el).boxShadow.match(/(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px/); if (m && +m[1] !== 0) xs.add(Math.sign(+m[1])); }
    if (xs.size > 1) achar('sombra', 'nota', null, 'sombras apontam para lados diferentes (luz vindo de dois lados)');
    let caixa = 0;
    for (const el of ts) {
      const s = cs(el), t = proprio(el);
      const alta = s.textTransform === 'uppercase' || (t.length >= 4 && /\p{Lu}{4,}/u.test(t) && t === t.toUpperCase());
      if (alta && (s.letterSpacing === 'normal' || parseFloat(s.letterSpacing) === 0) && parseFloat(s.fontSize) < 20 && caixa++ < 3)
        achar('caixa-alta', 'nota', el, 'caixa-alta pequena sem espaçamento entre letras (+0,05 a 0,1em)');
    }
    // Sinais para comparar desktop e celular no Node: versão própria de cada um ou desktop espremido?
    let mediaLayout = 0, folhasFechadas = 0;
    const MUDA_LAYOUT = /\b(display|grid-template|grid-area|flex-direction|flex-wrap|order|position|visibility|columns|float)\s*:/;
    const varrer = regras => {
      for (const r of regras) {
        try {
          if ((r instanceof CSSMediaRule && /width|orientation|pointer|hover/.test(r.media.mediaText)) || (typeof CSSContainerRule !== 'undefined' && r instanceof CSSContainerRule))
            for (const s of r.cssRules) { if (MUDA_LAYOUT.test(s.cssText || '')) mediaLayout++; else if (s.cssRules) varrer(s.cssRules); }
          else if (r.cssRules) varrer(r.cssRules); // @supports, @layer
        } catch {}
      }
    };
    for (const sh of document.styleSheets) { try { varrer(sh.cssRules); } catch { folhasFechadas++; } }
    if (document.querySelector('picture source[media]')) mediaLayout++; // imagem própria para cada tela também conta
    const espremidas = [];
    if (vw < 768) for (const pai of todos()) {
      if (!visivel(pai) || pai.scrollWidth > pai.clientWidth + 4) continue; // carrossel que rola de lado é de propósito
      const fs3 = [...pai.children].filter(f => visivel(f) && (f.innerText || '').trim().length > 20 && !/absolute|fixed/.test(cs(f).position));
      if (fs3.length < 2) continue;
      const rs = fs3.map(f => f.getBoundingClientRect());
      const lado = rs.filter((r, i) => rs.some((q, j) => j !== i && Math.abs(q.top - r.top) < 8 && (q.left >= r.right - 2 || r.left >= q.right - 2)));
      if (lado.filter(r => r.width < 150).length >= 2) { espremidas.push({onde: caminho(pai), larg: Math.round(Math.min(...lado.map(r => r.width)))}); if (espremidas.length >= 5) break; }
    }
    const ps = [...document.querySelectorAll('p')].filter(p => visivel(p) && (p.innerText || '').trim().length > 40).map(p => parseFloat(cs(p).fontSize)).sort((a, b) => a - b);
    const h1 = [...document.querySelectorAll('h1')].find(visivel);
    return {achados: out, sinais: {mediaLayout, folhasFechadas, espremidas, corpoPx: ps.length ? ps[ps.length >> 1] : null, h1Px: h1 ? parseFloat(cs(h1).fontSize) : null}};
  }

  if (o.modo === 'itens') {
    const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
    const q = sel => { const el = document.querySelector(sel); if (!el) throw new Error(`não achei ${sel}`); return el; };
    const avaliar = async it => {
      switch (it.tipo) {
        case 'existe': { const el = document.querySelector(it.seletor); if (!el) return {ok: false, detalhe: `não achei ${it.seletor}`}; return cs(el).display === 'none' ? {ok: false, detalhe: 'existe, mas está com display:none'} : {ok: true, detalhe: 'achado'}; }
        case 'texto': {
          const t = norm(q(it.seletor).innerText || q(it.seletor).textContent);
          let ok = true;
          if (it.igual != null) ok = ok && t === norm(it.igual);
          if (it.contem != null) ok = ok && t.includes(norm(it.contem));
          if (it.regex) ok = ok && new RegExp(it.regex, it.flags || '').test(t);
          return {ok, detalhe: ok ? 'confere' : `está "${t.slice(0, 160)}"`};
        }
        case 'semTexto': {
          const t = document.body.innerText, m = t.match(new RegExp(it.padrao, it.flags || ''));
          return m ? {ok: false, detalhe: `aparece em "${t.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ')}"`} : {ok: true, detalhe: 'não aparece'};
        }
        case 'visivelSemRolar': {
          const el = q(it.seletor), r = el.getBoundingClientRect();
          if (!visivel(el) || opac(el) < 0.5) return {ok: false, detalhe: 'não está visível no topo'};
          const dentro = r.top >= -1 && r.left >= -1 && r.bottom <= vh + 1 && r.right <= vw + 1;
          return dentro ? {ok: true, detalhe: 'aparece sem rolar'} : {ok: false, detalhe: `fica em x ${Math.round(r.left)}–${Math.round(r.right)}, y ${Math.round(r.top)}–${Math.round(r.bottom)} numa tela ${vw}×${vh}`};
        }
        case 'css': {
          const s = cs(q(it.seletor)), v = s.getPropertyValue(it.prop) || s[it.prop] || '';
          if (it.entre) { const n = parseFloat(v); const ok = n >= it.entre[0] && n <= it.entre[1]; return {ok, detalhe: `${it.prop} = ${v}`}; }
          const ok = norm(v) === norm(it.valor);
          return {ok, detalhe: `${it.prop} = ${v}`};
        }
        case 'js': {
          const r = await (0, eval)(it.expr); // aceita Promise: rolar, esperar e medir
          return r && typeof r === 'object' ? {ok: !!r.ok, detalhe: String(r.detalhe ?? '')} : {ok: !!r, detalhe: String(r)};
        }
        default: return {ok: true, detalhe: 'fora do script'};
      }
    };
    // um item por vez: item js pode rolar a página, e o seguinte precisa achá-la como estava
    const itens = [];
    for (const it of o.itens) { try { itens.push({id: it.id, ...(await avaliar(it))}); } catch (e) { itens.push({id: it.id, ok: false, detalhe: e.message}); } }
    return {itens};
  }

  if (o.modo === 'contrasteItem') {
    const el = document.querySelector(o.seletor);
    if (!el) return {ok: false, detalhe: `não achei ${o.seletor}`};
    const px = await pixels(o.png).catch(() => null);
    const m = avaliarContraste(el, px, midias(), 'contraste', o.minimo);
    if (!m) return {ok: false, detalhe: 'não deu para medir (letra não aparece na foto); confira na foto'};
    return {ok: m.tip >= o.minimo, detalhe: `contraste ${m.tip.toFixed(2)}:1, mínimo ${o.minimo}:1`};
  }

  if (o.modo === 'foco') {
    for (const v of o.vistos) {
      const el = document.querySelector(`[data-toc-foco="${v.i}"]`);
      if (!el) continue;
      const s = getComputedStyle(el);
      const antes = [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.backgroundColor, s.color, s.borderColor, s.textDecorationLine].join('|');
      if (antes === v.estilo) achar('foco', 'corrigir', el, 'nada muda quando recebe foco pelo Tab (foco invisível)');
      el.removeAttribute('data-toc-foco');
    }
    return {achados: out};
  }
  return {achados: out};
}

async function conferirFoco(page, dispensas) {
  await page.evaluate(() => { scrollTo(0, 0); document.activeElement?.blur?.(); });
  const vistos = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(250);
    const info = await page.evaluate(i => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      if (el.dataset.tocFoco) return {repetido: true};
      el.dataset.tocFoco = String(i);
      const s = getComputedStyle(el);
      return {i, estilo: [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.backgroundColor, s.color, s.borderColor, s.textDecorationLine].join('|')};
    }, i);
    if (!info || info.repetido) break;
    vistos.push(info);
  }
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(250);
  return (await page.evaluate(sonda, {modo: 'foco', vistos, dispensas})).achados;
}

function juntar(achados) {
  const m = new Map();
  for (const a of achados) {
    const k = `${a.regra}|${a.onde}|${a.onde && !a.porDetalhe ? '' : a.detalhe}`;
    const tela = a.tela + (a.movimento === 'reduzido' ? ' reduzido' : '');
    const v = m.get(k);
    if (!v) { m.set(k, {regra: a.regra, gravidade: a.gravidade, onde: a.onde, detalhe: a.detalhe, valor: a.valor, dispensado: !!a.dispensado, telas: [tela], passos: a.passo != null ? [a.passo] : []}); continue; }
    if (!v.telas.includes(tela)) v.telas.push(tela);
    if (a.passo != null && !v.passos.includes(a.passo)) v.passos.push(a.passo);
    if (a.valor != null && (v.valor == null || a.valor < v.valor)) { v.valor = a.valor; v.detalhe = a.detalhe; }
    if (PESO[a.gravidade] > PESO[v.gravidade]) { v.gravidade = a.gravidade; v.detalhe = a.detalhe; }
    v.dispensado = v.dispensado && !!a.dispensado;
  }
  return [...m.values()].sort((a, b) => PESO[b.gravidade] - PESO[a.gravidade] || a.regra.localeCompare(b.regra));
}

async function folhas(browser, saida, fotos) {
  const res = [];
  for (const [tela, lista] of Object.entries(fotos)) {
    const w = +tela.split('x')[0], cols = w >= 1000 ? 3 : w >= 700 ? 4 : 5, larg = w >= 1000 ? 460 : w >= 700 ? 330 : 250;
    const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#1b1b1b;color:#ddd;font:12px system-ui;display:grid;grid-template-columns:repeat(${cols},${larg}px);gap:8px;padding:8px}figure{margin:0}img{width:100%;display:block}figcaption{padding:3px 0}</style>` +
      lista.map((f, i) => `<figure><img src="${f}"><figcaption>${tela} · passo ${i}</figcaption></figure>`).join('');
    const arq = path.join(saida, `folha-${tela}.html`);
    fs.writeFileSync(arq, html);
    const p = await browser.newPage({viewport: {width: cols * (larg + 8) + 8, height: 400}, deviceScaleFactor: 1});
    await p.goto(pathToFileURL(arq).href, {waitUntil: 'load'});
    await p.screenshot({path: path.join(saida, `folha-${tela}.jpg`), fullPage: true, type: 'jpeg', quality: 80});
    await p.close();
    fs.unlinkSync(arq);
    res.push(`folha-${tela}.jpg`);
  }
  return res;
}

function avaliarItemDoc(it, doc) {
  const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim(), info = doc.info || {};
  const alvo = it.em ? doc.blocos.filter(b => [].concat(it.em).includes(b.papel)) : doc.blocos;
  const todo = norm(alvo.map(b => b.texto).join('\n'));
  switch (it.tipo) {
    case 'existe': case 'texto': {
      let ok = true;
      if (it.igual != null) ok = alvo.some(b => norm(b.texto) === norm(it.igual));
      if (it.contem != null) ok = ok && todo.toLowerCase().includes(norm(it.contem).toLowerCase());
      if (it.regex) ok = ok && new RegExp(it.regex, it.flags || '').test(todo);
      return {ok, detalhe: ok ? 'confere' : 'não está no texto' + (it.em ? ` (procurado em: ${[].concat(it.em).join(', ')})` : '')};
    }
    case 'semTexto': {
      const m = todo.match(new RegExp(it.padrao, it.flags || ''));
      return m ? {ok: false, detalhe: `aparece em "${todo.slice(Math.max(0, m.index - 40), m.index + 40)}"`} : {ok: true, detalhe: 'não aparece'};
    }
    case 'contagem': {
      const v = it.o === 'titulos' ? (info.titulos || []).length : info[it.o];
      if (v == null) return {ok: false, detalhe: `não sei contar "${it.o}" num ${doc.tipo} (use paginas, slides, abas, palavras, imagens, titulos, linhas)`};
      const ok = (it.igual == null || v === it.igual) && (it.min == null || v >= it.min) && (it.max == null || v <= it.max);
      return {ok, detalhe: `${it.o} = ${v}`};
    }
    case 'estrutura': {
      const ts = (info.titulos || []).map(t => norm(t).toLowerCase()), faltam = [];
      let pos = -1;
      for (const x of it.lista || []) {
        const i = ts.findIndex((t, k) => t.includes(norm(x).toLowerCase()) && (it.modo !== 'ordem' || k > pos));
        if (i < 0) faltam.push(x); else pos = i;
      }
      return faltam.length ? {ok: false, detalhe: `faltam${it.modo === 'ordem' ? ' (ou fora de ordem)' : ''}: ${faltam.join(', ')}`} : {ok: true, detalhe: 'todos os títulos presentes'};
    }
    case 'celula': return (info.celulas || []).find(x => x.id === it.id) || {ok: false, detalhe: 'célula não conferida (só vale para planilha)'};
    default: return {ok: false, detalhe: `o tipo "${it.tipo}" só vale para página web`};
  }
}

function fechar({c, contratoArq, raiz, saida, fp, url, achados, itensRes, fotos, folhas: fs_, combinacoes, tipo, avisos = []}) {
  for (const a of achados) if (!a.dispensado && dispensa(c.dispensas, a)) a.dispensado = true;
  const lista = juntar(achados);
  const abertos = lista.filter(a => !a.dispensado && (a.gravidade === 'bloqueia' || a.gravidade === 'corrigir'));
  const itensFalhos = itensRes.filter(i => i.conferido && !i.ok);
  const rel = {
    versao: 2, quando: new Date().toISOString(), fp, url, tipo, contrato: path.relative(raiz, contratoArq),
    passou: !abertos.length && !itensFalhos.length,
    contagem: {itensFalhos: itensFalhos.length, bloqueia: abertos.filter(a => a.gravidade === 'bloqueia').length,
      corrigir: abertos.filter(a => a.gravidade === 'corrigir').length, nota: lista.filter(a => a.gravidade === 'nota').length,
      dispensados: lista.filter(a => a.dispensado).length},
    revisorPendente: itensRes.filter(i => !i.conferido).map(i => i.id),
    itens: itensRes, achados: lista, fotos, folhas: fs_, combinacoes, avisos, texto: 'texto.md',
  };
  fs.writeFileSync(path.join(saida, 'relatorio.json'), JSON.stringify(rel, null, 2));
  fs.writeFileSync(path.join(saida, 'resumo.md'), resumo(rel));
  return rel;
}

async function conferirDocumento({c, contratoArq, raiz, saida, fp}) {
  const arq = path.resolve(raiz, c.arquivo);
  fs.mkdirSync(saida, {recursive: true});
  const e = c.estilo || {};
  const opc = {idioma: e.idioma || 'pt-BR', ortografia: e.ortografia, palavrasOk: e.palavrasOk || [], papel: e.papel, render: c.render !== false,
    celulas: c.itens.filter(i => i.tipo === 'celula')};
  const r = python(['extrair', arq, saida, '--opcoes', JSON.stringify(opc)]);
  const doc = lerJSONseguro(path.join(saida, 'doc.json'));
  if (!doc) throw new Error('o leitor de documentos (doc.py) não rodou: ' + String(r.error?.message || r.stderr || r.stdout || '').slice(-600));
  const achados = doc.achados.map(a => ({...a, tela: doc.tipo, movimento: 'normal'}));
  for (const av of doc.avisos) achados.push({regra: 'nao-conferido', gravidade: 'nota', onde: '', detalhe: av, porDetalhe: true, tela: doc.tipo});
  achados.push(...conferirTexto(doc.blocos, c, saida, doc.tipo));
  const itensRes = c.itens.map(it => ({id: it.id, descricao: it.descricao || '', tipo: it.tipo, origem: it.origem || 'pedido', conferido: it.tipo !== 'revisor', falhas: [],
    ...(it.tipo === 'revisor' ? {ok: true} : (() => { const v = avaliarItemDoc(it, doc); return {ok: v.ok, detalhe: v.detalhe, falhas: v.ok ? [] : [v.detalhe]}; })())}));
  return fechar({c, contratoArq, raiz, saida, fp, url: arq, achados, itensRes, fotos: {}, folhas: doc.folhas || [], combinacoes: [doc.tipo], tipo: doc.tipo, avisos: doc.avisos});
}

// Diff com a rodada anterior e olhar apertado (visao.py). Tudo vira nota: quem julga se a mudança era a pretendida é o revisor.
function visao(saida, anterior) {
  const r = spawnSync(process.env.TOC_PYTHON || 'python', ['-I', path.join(AQUI, 'visao.py'), saida, anterior || ''], {encoding: 'utf8', timeout: 180000});
  const v = lerJSONseguro(path.join(saida, 'visao.json'));
  if (!v) return {achados: [], folhas: [], avisos: [`visão não rodou: ${String(r.error?.message || r.stderr || '').slice(-200)}`]};
  const achados = [];
  for (const d of v.diffs || []) achados.push({regra: 'mudanca-visual', gravidade: 'nota', onde: d.imagem, porDetalhe: true, tela: 'visão',
    detalhe: d.nota || `${d.regioes.length} região(ões) mudaram desde a rodada anterior (${Math.round(d.mudou * 100)}% da imagem); confira em folha-mudancas se mudou só o que devia`});
  const s = v.squint;
  if (s && s.alvos.length && !s.dentro.length) achados.push({regra: 'olhar-apertado', gravidade: 'nota', onde: s.foto, porDetalhe: true, tela: 'visão',
    detalhe: `apertando os olhos, a primeira tela puxa o olhar para o ponto (${s.pico.join(', ')}), longe do ${s.alvos.join(' e da ')}; confira se é de propósito`});
  return {achados, folhas: v.folhas || [], avisos: []};
}

// "toc login": abre um Chrome visível na página, a pessoa entra (senha da loja, conta, 2FA) e fecha a janela.
// Cookies e localStorage ficam num arquivo que os visitantes headless reaproveitam. O Chrome da pessoa não é tocado.
export async function login({url, raiz = process.cwd(), arquivo, headless = false, fecharEmMs = 0}) { // headless e fecharEmMs: só para teste
  const destino = path.resolve(raiz, arquivo || path.join('.claude', 'toc', 'sessao.json'));
  fs.mkdirSync(path.dirname(destino), {recursive: true});
  const ign = path.join(path.dirname(destino), '.gitignore');
  const atual = fs.existsSync(ign) ? fs.readFileSync(ign, 'utf8') : '';
  if (!atual.split(/\r?\n/).includes(path.basename(destino))) fs.writeFileSync(ign, atual + (atual && !atual.endsWith('\n') ? '\n' : '') + path.basename(destino) + '\n');
  const pw = carregarPlaywright(raiz);
  const browser = await pw.chromium.launch({headless, ...(CHROME ? {executablePath: CHROME} : {})});
  const ctx = await browser.newContext({viewport: null, storageState: fs.existsSync(destino) ? destino : undefined});
  const page = await ctx.newPage();
  await page.goto(url).catch(() => {});
  if (fecharEmMs) setTimeout(() => page.close().catch(() => {}), fecharEmMs);
  let salvas = 0;
  const salvar = async () => { try { fs.writeFileSync(destino, JSON.stringify(await ctx.storageState(), null, 1)); salvas++; } catch {} };
  await new Promise(res => {
    const t = setInterval(salvar, 1500);
    const fim = () => { clearInterval(t); res(); };
    browser.on('disconnected', fim);
    ctx.on('close', fim);
    page.on('close', async () => { await salvar(); fim(); });
  });
  await browser.close().catch(() => {});
  return {destino, salvas};
}

export async function conferir({contratoArq, raiz = process.cwd(), saida, fp = '', anterior = ''}) {
  const c = lerContrato(contratoArq);
  if (!ehPagina(c)) {
    const rel = await conferirDocumento({c, contratoArq, raiz, saida, fp});
    if (!anterior) return rel;
    const vis = visao(saida, anterior);
    if (!vis.achados.length && !vis.folhas.length) return rel;
    rel.achados.push(...vis.achados.map(a => ({...a, telas: ['visão'], passos: [], dispensado: false})));
    rel.folhas.push(...vis.folhas); rel.contagem.nota += vis.achados.length;
    fs.writeFileSync(path.join(saida, 'relatorio.json'), JSON.stringify(rel, null, 2));
    fs.writeFileSync(path.join(saida, 'resumo.md'), resumo(rel));
    return rel;
  }
  let blocosWeb = [], squint = null;
  const mascaras = {}, sinais = {};
  const pw = carregarPlaywright(raiz, ...(c.arquivo ? [path.dirname(path.resolve(raiz, c.arquivo))] : []));
  const fotosDir = path.join(saida, 'fotos');
  fs.mkdirSync(fotosDir, {recursive: true});
  const url = c.url || pathToFileURL(path.resolve(raiz, c.arquivo)).href;
  const origem = new URL(url).origin;
  const telas = c.telas.map(t => { const [w, h] = String(t).split('x').map(Number); return {nome: `${w}x${h}`, width: w, height: h}; });
  const fotosEm = new Set(c.fotos || [telas[0].nome, telas[telas.length - 1].nome]);
  const dispensas = c.dispensas || [];
  const achados = [], itens = new Map(), fotos = {};
  for (const it of c.itens) itens.set(it.id, {id: it.id, descricao: it.descricao || '', tipo: it.tipo, origem: it.origem || 'pedido', ok: true, falhas: [], conferido: it.tipo !== 'revisor'});
  const avaliados = new Set();
  const marcar = (id, tela, r) => { avaliados.add(id); const v = itens.get(id); if (!r.ok) { v.ok = false; v.falhas.push(`${tela}: ${r.detalhe}`); } else v.detalhe = r.detalhe; };
  const encurta = u => u.length > 90 ? '…' + u.slice(-88) : u;
  const browser = await pw.chromium.launch({headless: true, ...(CHROME ? {executablePath: CHROME} : {})});
  // página atrás de login: a sessão salva por "toc login" entra em todos os visitantes
  const sessaoArq = path.resolve(raiz, c.navegador?.sessao || path.join('.claude', 'toc', 'sessao.json'));
  const sessao = fs.existsSync(sessaoArq) ? sessaoArq : undefined;
  // cada combinação tela × movimento é um visitante; rodam em paralelo (contrato.paralelo, padrão 3)
  const fila = c.movimento.flatMap((mov, mi) => telas.map((tela, ti) => ({mov, mi, tela, ti})));
  let barrado = false;
  const visitar = async ({mov, mi, tela, ti}) => {
      if (barrado) return; // já caiu em tela de login: não adianta abrir os outros visitantes
      const ctx = await browser.newContext({viewport: {width: tela.width, height: tela.height}, deviceScaleFactor: 1, storageState: sessao,
        reducedMotion: mov === 'reduzido' ? 'reduce' : 'no-preference', isMobile: tela.width < 768, hasTouch: tela.width < 768});
      await ctx.addInitScript(INICIO);
      if (c.preparo) await ctx.addInitScript({content: c.preparo});
      const page = await ctx.newPage();
      const add = lst => { for (const a of lst) achados.push({...a, tela: tela.nome, movimento: mov}); };
      const fora = a => ({...a, dispensado: dispensas.some(d => d.regra === a.regra && !d.seletor && (!d.contem || a.detalhe.includes(d.contem)))});
      page.on('pageerror', e => add([fora({regra: 'erro-js', gravidade: 'bloqueia', onde: '', detalhe: String(e.message).slice(0, 220)})]));
      page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) add([fora({regra: 'console', gravidade: 'corrigir', onde: '', detalhe: m.text().slice(0, 220)})]); });
      page.on('requestfailed', r => { const f = r.failure()?.errorText || ''; if (!/ERR_ABORTED/.test(f)) add([fora({regra: 'rede', gravidade: new URL(r.url()).origin === origem ? 'bloqueia' : 'corrigir', onde: '', detalhe: `falhou ${encurta(r.url())} (${f})`})]); });
      page.on('response', r => { if (r.status() >= 400) add([fora({regra: 'rede', gravidade: new URL(r.url()).origin === origem ? 'bloqueia' : 'corrigir', onde: '', detalhe: `${r.status()} em ${encurta(r.url())}`})]); });
      try { await page.goto(url, {waitUntil: 'load', timeout: 60000}); }
      catch (e) { add([fora({regra: 'abrir', gravidade: 'bloqueia', onde: '', detalhe: `não abriu ${url}: ${e.message.split('\n')[0]}`})]); await ctx.close(); return; }
      if (c.pronto) {
        try { await page.waitForFunction(c.pronto, null, {timeout: 90000}); }
        catch { add([fora({regra: 'pronto', gravidade: 'corrigir', onde: '', detalhe: 'a condição "pronto" do contrato não ficou verdadeira em 90 s'})]); }
      }
      await page.waitForTimeout(c.esperaMs);
      // Caiu numa tela de login ou senha (loja fechada, área logada)? Então não é a página pedida: para tudo e avisa.
      const porta = await page.evaluate(() => ({
        senha: [...document.querySelectorAll('input[type=password]')].some(i => { const r = i.getBoundingClientRect(); return r.width > 0 && r.height > 0; }),
        url: location.href}));
      const pedida = new URL(url), chegou = new URL(porta.url);
      const desviou = chegou.pathname !== pedida.pathname && /log-?in|sign-?in|entrar|password|senha|auth|account|conta/i.test(chegou.pathname + chegou.search);
      if (!c.paginaDeLogin && (porta.senha || desviou)) {
        barrado = true;
        add([{regra: 'pagina-de-login', gravidade: 'bloqueia', onde: porta.url,
          detalhe: `a conferência abriu uma tela de login ou senha (${porta.url}), não a página pedida${sessao ? '; a sessão salva expirou' : ''}. ` +
            `Rode "toc login ${url}": abre o Chrome, você entra uma vez e a sessão fica em ${path.relative(raiz, sessaoArq) || sessaoArq} (não versione esse arquivo). ` +
            `Se a página pedida é a própria tela de login, ponha "paginaDeLogin": true no contrato.`}]);
        await ctx.close(); return;
      }
      const cls = await page.evaluate(() => window.__tocCLS || 0);
      if (cls > 0.1) add([fora({regra: 'salto-de-layout', gravidade: 'corrigir', onde: '', detalhe: `CLS ${cls.toFixed(3)} no carregamento (limite 0,1)`, valor: cls})]);

      const aqui = c.itens.filter(it => it.tipo !== 'revisor' && it.tipo !== 'contraste' && (!it.telas || it.telas.includes(tela.nome)) && mov === (it.movimento || c.movimento[0]));
      if (aqui.length) for (const r of (await page.evaluate(sonda, {modo: 'itens', itens: aqui})).itens) marcar(r.id, tela.nome, r);
      for (const it of c.itens.filter(i => i.tipo === 'contraste' && (!i.telas || i.telas.includes(tela.nome)) && mov === (i.movimento || c.movimento[0]))) {
        const achou = await page.evaluate(sel => { const el = document.querySelector(sel); if (el) el.scrollIntoView({block: 'center', behavior: 'instant'}); return !!el; }, it.seletor);
        if (!achou) { marcar(it.id, tela.nome, {ok: false, detalhe: `não achei ${it.seletor}`}); continue; }
        await page.waitForTimeout(c.passoMs);
        const png = (await page.screenshot({type: 'png'})).toString('base64');
        marcar(it.id, tela.nome, await page.evaluate(sonda, {modo: 'contrasteItem', seletor: it.seletor, png, minimo: it.minimo || 4.5, dispensas: []}));
      }

      marca(`${tela.nome} ${mov}: abriu e conferiu itens`);
      const altura0 = await page.evaluate(() => document.scrollingElement.scrollHeight);
      const passo = Math.max(Math.round(tela.height * 0.85), Math.ceil(altura0 / 38));
      let y = 0, n = 0, antes = -1;
      for (;;) {
        await page.evaluate(y => window.scrollTo({top: y, left: 0, behavior: 'instant'}), y);
        await page.waitForTimeout(c.passoMs);
        const png = (await page.screenshot({type: 'png'})).toString('base64');
        if (mi === 0 && fotosEm.has(tela.nome)) {
          const nome = `${tela.nome}-${String(n).padStart(2, '0')}.jpg`;
          await page.screenshot({path: path.join(fotosDir, nome), type: 'jpeg', quality: 72});
          (fotos[tela.nome] ||= []).push(`fotos/${nome}`);
          // o que mexe sozinho (canvas, vídeo) fica de fora do diff entre rodadas
          mascaras[nome] = await page.evaluate(() => [...document.querySelectorAll('canvas,video,iframe'),
            ...document.getAnimations().filter(a => a.playState === 'running' && a.effect?.target instanceof Element && a.effect.getComputedTiming().iterations === Infinity).map(a => a.effect.target)]
            .map(e => e.getBoundingClientRect())
            .filter(r => r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight).map(r => [Math.max(0, r.left), Math.max(0, r.top), r.width, r.height].map(Math.round)));
          if (n === 0 && !squint) squint = {foto: `fotos/${nome}`, alvos: await page.evaluate(() => {
            const r = (el, nome) => { const q = el.getBoundingClientRect(); return {nome, x: q.left, y: q.top, w: q.width, h: q.height}; };
            const out = [], h1 = document.querySelector('h1');
            if (h1 && h1.getBoundingClientRect().top < innerHeight) out.push(r(h1, 'título'));
            // ação principal: o maior botão com fundo inteiro na primeira tela
            const cta = [...document.querySelectorAll('a,button')].filter(e => { const q = e.getBoundingClientRect(), s = getComputedStyle(e);
              return q.top >= 0 && q.bottom <= innerHeight && q.width > 60 && s.visibility !== 'hidden' &&
                (!/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor) || s.backgroundImage !== 'none'); })
              .sort((a, b) => { const p = e => { const q = e.getBoundingClientRect(); return q.width * q.height; }; return p(b) - p(a); })[0];
            if (cta) out.push(r(cta, 'ação principal'));
            return out;
          })};
        }
        marca(`  passo ${n}: foto`);
        add((await page.evaluate(sonda, {modo: 'passo', png, dispensas})).achados.map(a => ({...a, passo: n})));
        marca(`  passo ${n}: medido`);
        const {topo, altura} = await page.evaluate(() => ({topo: scrollY, altura: document.scrollingElement.scrollHeight}));
        n++;
        if (topo + tela.height >= altura - 2 || topo <= antes || n >= 40) break;
        antes = topo;
        y = topo + passo;
      }
      const glob = await page.evaluate(sonda, {modo: 'global', dispensas, escalaEspaco: c.escalaEspaco});
      add(glob.achados);
      if (mi === 0 && glob.sinais) sinais[tela.nome] = glob.sinais;
      marca(`${tela.nome} ${mov}: global`);
      if (mi === 0 && ti === 0) {
        add(await conferirFoco(page, dispensas)); marca(`${tela.nome} ${mov}: foco`);
        blocosWeb = await page.evaluate(BLOCOS_WEB).catch(() => []);
      }
      await ctx.close();
  };
  try {
    const trabalhadores = Array.from({length: Math.max(1, Math.min(c.paralelo ?? 3, fila.length))}, async () => {
      for (let job; (job = fila.shift());) await visitar(job);
    });
    await Promise.all(trabalhadores);
    // item que nenhum visitante chegou a avaliar (página não abriu, caiu em login) não passa por omissão
    for (const v of itens.values()) if (v.conferido && !avaliados.has(v.id)) {
      v.ok = false; v.falhas.push(barrado ? 'não conferido: a conferência caiu na tela de login' : 'não conferido: a página não chegou a ser avaliada');
    }
    var folhasFeitas = await folhas(browser, saida, fotos);
  } finally { await browser.close(); }

  achados.push(...conferirTexto(blocosWeb, c, saida, 'texto'));
  // Versão do celular e versão do desktop: cada uma com a sua composição, não uma adaptada da outra.
  const sDesk = telas.filter(t => t.width >= 1000).map(t => sinais[t.nome]).find(Boolean);
  const telaCel = telas.find(t => t.width < 768), sCel = telaCel && sinais[telaCel.nome];
  if (sDesk && sCel && c.mobileProprio !== false) {
    const ac = (regra, gravidade, onde, detalhe) => achados.push({regra, gravidade, onde, detalhe, tela: 'celular x desktop', movimento: 'normal', porDetalhe: true});
    if (!sCel.mediaLayout && !sCel.folhasFechadas)
      ac('mobile-sem-versao', 'corrigir', '', 'nenhuma regra @media muda o layout (grid, flex, ordem, o que aparece): o celular é o desktop encolhido. Desenhe a composição própria do celular: ordem, tamanhos e o que entra na primeira tela');
    for (const e of sCel.espremidas) ac('mobile-colunas-espremidas', 'corrigir', e.onde, `colunas de texto lado a lado com ${e.larg}px no celular (${telaCel.nome}): empilhe ou reorganize para o celular`);
    if (sCel.corpoPx && sCel.corpoPx < 14) ac('mobile-letra-pequena', 'corrigir', '', `texto corrido com ${sCel.corpoPx}px no celular: mínimo 14px, ideal 16px`);
    if (sDesk.h1Px >= 40 && sCel.h1Px && Math.abs(sDesk.h1Px - sCel.h1Px) / sDesk.h1Px < 0.05)
      ac('mobile-titulo-igual', 'nota', 'h1', `o título principal tem ${sCel.h1Px}px no celular e no desktop: o tamanho não foi pensado para cada tela`);
  }
  fs.writeFileSync(path.join(saida, 'mascaras.json'), JSON.stringify(mascaras));
  if (squint) fs.writeFileSync(path.join(saida, 'squint.json'), JSON.stringify(squint));
  const vis = visao(saida, anterior);
  achados.push(...vis.achados); folhasFeitas.push(...vis.folhas);
  const avisos = [...vis.avisos];
  if ((c.estilo || {}).ortografia !== false && blocosWeb.length) { // corretor do Word sobre o texto da página, quando houver Word
    const arq = path.join(saida, '_blocos.json');
    fs.writeFileSync(arq, JSON.stringify({blocos: blocosWeb, idioma: (c.estilo || {}).idioma || 'pt-BR', palavrasOk: (c.estilo || {}).palavrasOk || []}));
    const o = lerJSONseguro0(python(['ortografia', arq], 180000).stdout);
    if (o) { achados.push(...o.achados.map(a => ({...a, tela: 'texto'}))); avisos.push(...o.avisos); }
    fs.rmSync(arq, {force: true});
  }
  return fechar({c, contratoArq, raiz, saida, fp, url, achados, itensRes: [...itens.values()], fotos, folhas: folhasFeitas,
    combinacoes: c.movimento.flatMap(m => telas.map(t => `${t.nome} ${m}`)), tipo: 'pagina', avisos});
}
const lerJSONseguro0 = s => { try { return JSON.parse(s); } catch { return null; } };

export function resumo(rel, limite = 40) {
  const k = rel.contagem, l = [];
  l.push(`# Conferência toc ${rel.passou ? 'passou' : 'com pendências'} (${rel.quando.slice(0, 16).replace('T', ' ')})`);
  l.push(`${rel.url} · ${rel.combinacoes.join(', ')}`);
  l.push(`Contrato: ${k.itensFalhos} item(ns) falhando · minúcias: ${k.bloqueia} bloqueia, ${k.corrigir} corrigir, ${k.nota} nota, ${k.dispensados} dispensada(s)`);
  l.push('', '## Contrato');
  for (const i of rel.itens) l.push(`- [${!i.conferido ? 'revisor' : i.ok ? 'ok' : 'FALHA'}] ${i.id} ${i.descricao}${i.falhas.length ? ': ' + i.falhas.join(' | ') : ''}`);
  l.push('', '## Minúcias');
  let n = 0;
  for (const a of rel.achados) {
    if (n++ >= limite) { l.push(`- … e mais ${rel.achados.length - limite} no relatorio.json`); break; }
    l.push(`- [${a.dispensado ? 'dispensado' : a.gravidade}] ${a.regra}${a.onde ? ' · ' + a.onde : ''} · ${a.telas.join(', ')}${a.passos.length ? ' · passo ' + a.passos.slice(0, 4).join(',') : ''}: ${a.detalhe}`);
  }
  if (!rel.achados.length) l.push('- nada');
  l.push('', `Folhas de fotos: ${rel.folhas.join(', ') || 'nenhuma'}`);
  return l.join('\n') + '\n';
}

const args = process.argv.slice(2);
const arg = (n, p) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : p; };
const euMesmo = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (euMesmo) {
  const raiz = path.resolve(arg('raiz', process.cwd()));
  const contratoArq = path.resolve(raiz, arg('contrato', '.claude/toc/contrato.json'));
  const saida = path.resolve(raiz, arg('saida', '.claude/toc/manual'));
  conferir({contratoArq, raiz, saida, fp: arg('fp', ''), anterior: arg('anterior', '')})
    .then(rel => { process.stdout.write(resumo(rel)); process.exit(rel.passou ? 0 : 1); })
    .catch(e => { console.error('toc: não consegui conferir: ' + (e.stack || e.message)); process.exit(2); });
}
