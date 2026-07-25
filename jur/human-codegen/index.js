#!/usr/bin/env node
/**
 * Gera `human-codegen/<TRIBUNAL>/INDEX.md` — o mapa seção ↔ print de cada tribunal.
 * É o contrato que o `fixer` usa para saber qual print corresponde a qual tela.
 *
 * Rode: node human-codegen/index.js
 *
 * Nomenclatura esperada (CLAUDE-CODEGEN.md §3):
 *   <MM>-<modulo>/<NN>-<slug>.txt      descrição da seção NN
 *   <MM>-<modulo>/<NN>.<PP>-<slug>.png print PP da seção NN
 */
const fs = require('fs');
const path = require('path');

const HC = __dirname;

const titulo = (s) =>
  s.replace(/^\d+(\.\d+)?[-.]?/, '').replace(/-/g, ' ').trim()
    .replace(/^./, (c) => c.toUpperCase());

function modulos(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))) {
    if (!e.isDirectory()) continue;
    const full = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    const arquivos = fs.readdirSync(full).filter((f) => fs.statSync(path.join(full, f)).isFile());
    if (arquivos.length) out.push({ modulo: r, arquivos: arquivos.sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })) });
    out.push(...modulos(full, r));
  }
  return out;
}

function gerar(trib) {
  const root = path.join(HC, trib);
  const mods = modulos(root);
  const soltos = fs.readdirSync(root).filter((f) => fs.statSync(path.join(root, f)).isFile() && f !== 'INDEX.md');

  const L = [`# ${trib} — índice do mapeamento`, ''];
  L.push('> Gerado por `node human-codegen/index.js`. Não editar à mão.');
  L.push('> Padrão de nomes: [`../../CLAUDE-CODEGEN.md`](../../CLAUDE-CODEGEN.md) §3.');
  L.push('');

  if (soltos.length) {
    L.push('## Arquivos na raiz');
    L.push('');
    for (const f of soltos.sort()) L.push(`- [\`${f}\`](${encodeURI(f)})`);
    L.push('');
  }

  for (const { modulo, arquivos } of mods) {
    L.push(`## \`${modulo}/\` — ${titulo(modulo.split('/').pop())}`);
    L.push('');
    const secoes = new Map();
    for (const f of arquivos) {
      const m = f.match(/^(\d+)(?:\.(\d+))?-(.*)\.(\w+)$/);
      const n = m ? m[1] : '—';
      if (!secoes.has(n)) secoes.set(n, { descricoes: [], prints: [], outros: [] });
      const bucket = secoes.get(n);
      if (!m) bucket.outros.push(f);
      else if (m[4] === 'txt' && !m[2]) bucket.descricoes.push(f);
      else if (/^(png|jpe?g)$/.test(m[4])) bucket.prints.push(f);
      else bucket.outros.push(f);
    }
    L.push('| # | Seção | Descrição | Prints |');
    L.push('|---|---|---|---|');
    for (const [n, b] of secoes) {
      const nome = titulo(b.descricoes[0] || b.prints[0] || b.outros[0] || '').replace(/\.\w+$/, '');
      const desc = b.descricoes.length
        ? b.descricoes.map((f) => `[\`${f}\`](${encodeURI(`${modulo}/${f}`)})`).join('<br>')
        : '⚠️ faltando';
      const prints = b.prints.length
        ? b.prints.map((f) => `[\`${f}\`](${encodeURI(`${modulo}/${f}`)})`).join('<br>')
        : '⚠️ faltando';
      L.push(`| ${n} | ${nome} | ${desc} | ${prints} |`);
    }
    L.push('');
    const semDesc = [...secoes.entries()].filter(([, b]) => !b.descricoes.length).map(([n]) => n);
    const semPrint = [...secoes.entries()].filter(([, b]) => !b.prints.length).map(([n]) => n);
    if (semDesc.length || semPrint.length) {
      L.push('Pendências deste módulo:');
      if (semDesc.length) L.push(`- seções sem descrição em texto: ${semDesc.join(', ')}`);
      if (semPrint.length) L.push(`- seções sem print: ${semPrint.join(', ')}`);
      L.push('');
    }
  }
  fs.writeFileSync(path.join(root, 'INDEX.md'), L.join('\n'));
  return mods.reduce((n, m) => n + m.arquivos.length, 0) + soltos.length;
}

const tribunais = fs.readdirSync(HC, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^[A-Z]/.test(e.name))
  .map((e) => e.name);

for (const t of tribunais) console.log(`${t}: ${gerar(t)} arquivos -> human-codegen/${t}/INDEX.md`);
