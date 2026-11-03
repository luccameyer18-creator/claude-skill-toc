#!/usr/bin/env node
// Instala o toc: copia a skill para ~/.claude/skills/toc e põe o hook de Stop em ~/.claude/settings.json (com backup).
// Uso: node install.mjs        (TOC_HOME troca a pasta-base, para testar)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HOME = process.env.TOC_HOME || os.homedir();
const aqui = path.dirname(fileURLToPath(import.meta.url));
const barra = p => p.split(path.sep).join('/');
const destino = path.join(HOME, '.claude', 'skills', 'toc');

fs.mkdirSync(path.dirname(destino), {recursive: true});
fs.cpSync(path.join(aqui, 'toc'), destino, {recursive: true, filter: s => !s.includes('__pycache__')});
console.log(`✓ skill copiada para ${destino}`);

const cfgArq = path.join(HOME, '.claude', 'settings.json');
let cfg = {};
if (fs.existsSync(cfgArq)) {
  cfg = JSON.parse(fs.readFileSync(cfgArq, 'utf8'));
  fs.copyFileSync(cfgArq, cfgArq + '.bak-toc');
}
const script = barra(path.join(destino, 'scripts', 'toc.mjs'));
const guarda = barra(path.join(destino, 'scripts', 'hook.sh'));
const node = barra(process.execPath);
let comando;
if (process.platform === 'win32') {
  // Node demora para abrir no Windows: o Git Bash procura o laço (na pasta atual ou acima) antes de abri-lo
  const bash = ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files (x86)/Git/bin/bash.exe'].find(p => fs.existsSync(p));
  comando = bash ? `"${bash}" "${guarda}" "${node}"` : `"${node}" "${script}" hook`;
} else {
  comando = `bash "${guarda}" "${node}"`;
}
cfg.hooks ??= {};
cfg.hooks.Stop ??= [];
// troca o hook antigo (que só olhava a pasta atual) pelo novo; senão, acrescenta
let trocou = false;
for (const grupo of cfg.hooks.Stop) for (const h of grupo.hooks || [])
  if (typeof h.command === 'string' && h.command.includes('toc.mjs') || typeof h.command === 'string' && h.command.includes('/toc/scripts/hook.sh')) { h.command = comando; h.timeout = 600; trocou = true; }
if (!trocou) cfg.hooks.Stop.push({hooks: [{type: 'command', command: comando, timeout: 600}]});
fs.mkdirSync(path.dirname(cfgArq), {recursive: true});
fs.writeFileSync(cfgArq, JSON.stringify(cfg, null, 2) + '\n');
console.log(`✓ hook de Stop ${trocou ? 'atualizado' : 'adicionado'} em ${cfgArq} (backup em settings.json.bak-toc)`);

// o que falta para cada tipo de entrega
const py = process.env.TOC_PYTHON || 'python';
const mods = ['docx', 'pptx', 'openpyxl', 'pymupdf', 'PIL'];
const r = spawnSync(py, ['-c', `import importlib\nfor m in ${JSON.stringify(mods)}:\n  try: importlib.import_module(m)\n  except Exception: print(m)`], {encoding: 'utf8'});
if (r.error) console.log(`! Python não encontrado: documentos ficam de fora (instale Python 3 ou aponte TOC_PYTHON)`);
else if (r.stdout.trim()) console.log(`! para documentos: pip install python-docx python-pptx openpyxl pymupdf pillow`);
else console.log('✓ Python pronto para docx, pptx, xlsx, pdf');
console.log('! para páginas web: npm i -D playwright no projeto, com o Chrome instalado');
console.log('\nPronto. Abra uma sessão nova do Claude Code e peça: "modo toc: ..."');
