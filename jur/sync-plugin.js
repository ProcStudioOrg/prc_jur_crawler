#!/usr/bin/env node
/**
 * Espelha `jur/skills/` em `plugins/jur-tribunais/skills/`.
 *
 *   node sync-plugin.js            # sincroniza
 *   node sync-plugin.js --check    # só verifica (exit 1 se dessincronizado) — para CI
 *
 * As skills vivem em `jur/skills/` (perto do código que documentam) e são copiadas para o
 * plugin no empacotamento. A cópia reescreve links markdown relativos ao repo em caminho
 * literal — dentro do plugin `../../CLAUDE-CODEGEN.md` não resolveria, e um link quebrado
 * é pior do que um caminho em texto que o agente sabe abrir.
 */
const fs = require('fs');
const path = require('path');

const JUR = __dirname;
const ORIGEM = path.join(JUR, 'skills');
const DESTINO = path.resolve(JUR, '..', 'plugins', 'jur-tribunais', 'skills');
const CHECK = process.argv.includes('--check');

const AVISO = `<!-- Gerado por \`jur/sync-plugin.js\`. Edite em \`jur/skills/\` e rode o sync. -->\n`;

/**
 * `[texto](../../CLAUDE-X.md)` -> `` `jur/CLAUDE-X.md` ``
 * Links internos à própria skill (sem `../`) são preservados.
 */
function reescreverLinks(md) {
  return md.replace(/\[([^\]]+)\]\(((?:\.\.\/)+[^)]+)\)/g, (_, texto, alvo) => {
    const limpo = alvo.replace(/^(\.\.\/)+/, '');
    const nu = texto.replace(/`/g, '').trim();
    // texto do link que já é o próprio caminho/arquivo não precisa ser repetido
    const redundante = nu === limpo || nu === path.basename(limpo) || limpo.endsWith(nu);
    return redundante ? `\`jur/${limpo}\`` : `\`jur/${limpo}\` (${texto})`;
  });
}

function arquivos(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...arquivos(path.join(dir, e.name), r));
    else if (/\.md$/.test(e.name)) out.push(r);
  }
  return out;
}

function conteudoEsperado(rel) {
  const md = fs.readFileSync(path.join(ORIGEM, rel), 'utf8');
  // frontmatter (se houver) fica no topo; o aviso entra depois dele
  const m = md.match(/^(---\n[\s\S]*?\n---\n)/);
  return m ? m[1] + AVISO + md.slice(m[1].length) : AVISO + md;
}

const lista = arquivos(ORIGEM).sort();
let divergentes = 0;

for (const rel of lista) {
  const esperado = reescreverLinks(conteudoEsperado(rel));
  const alvo = path.join(DESTINO, rel);
  const atual = fs.existsSync(alvo) ? fs.readFileSync(alvo, 'utf8') : null;
  if (atual === esperado) continue;
  divergentes++;
  if (CHECK) {
    console.log(`dessincronizado: skills/${rel}`);
  } else {
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, esperado);
    console.log(`sync: skills/${rel}`);
  }
}

// remove do plugin o que não existe mais na origem
if (fs.existsSync(DESTINO)) {
  for (const rel of arquivos(DESTINO)) {
    if (lista.includes(rel)) continue;
    divergentes++;
    if (CHECK) console.log(`sobrando no plugin: skills/${rel}`);
    else { fs.unlinkSync(path.join(DESTINO, rel)); console.log(`removido: skills/${rel}`); }
  }
}

if (CHECK && divergentes) {
  console.error(`\n${divergentes} arquivo(s) fora de sincronia — rode \`node sync-plugin.js\`.`);
  process.exit(1);
}
console.log(`\n${lista.length} skills · ${divergentes ? `${divergentes} atualizadas` : 'já sincronizado'}`);
