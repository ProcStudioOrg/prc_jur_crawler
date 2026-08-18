// src/TCEPEChecker.js
const TCEPENavigator = require('./TCEPENavigator');
const TCEPECrawler = require('./TCEPECrawler');
const https = require('https');
const http = require('http');

/**
 * TCEPEChecker — consulta por numero e auditoria da amostra.
 *
 * 🔴 NAO HA NUMERO CNJ E NAO HA DATAJUD, e as duas ausencias sao estruturais.
 * O processo do TCE-PE e `AAMMNNNN-D` (ano, mes, sequencial, digito), com sufixo
 * opcional de incidente — `26100740-3AR001` e o Agravo Regimental 001 do processo
 * `26100740-3`. `src/cnj.js` reprovaria todo processo valido, e o DataJud e do CNJ,
 * que cobre o Judiciario: contas nao tem alias `api_publica_*`. Nao ha plano B.
 *
 * ✅ `numeroProcesso.equals` e EXATO, nao substring (oposto do TCE-BA, onde `405`
 * arrastava `003405`). Medido: `26100740-3AR001` = 1 documento; `99999999-9` = 0.
 * Como o campo e exato, o numero SEM o sufixo de incidente NAO encontra a peca do
 * incidente — `26100740-3` e `26100740-3AR001` sao chaves diferentes.
 */
class TCEPEChecker {
  constructor({ log = console.log } = {}) {
    this.log = log;
    this.nav = new TCEPENavigator({ log });
    this.crawler = new TCEPECrawler({ log, nav: this.nav });
  }

  /** Aceita `26100740-3AR001`, `26100740-3` e `261007403` (sem hifen). */
  static normalizar(numero) {
    const s = String(numero || '').trim().toUpperCase().replace(/\s+/g, '');
    const m = s.match(/^(\d{8})-?(\d)([A-Z0-9]*)$/);
    if (m) return `${m[1]}-${m[2]}${m[3]}`;
    return s;
  }

  async consultarProcesso(numero) {
    const num = TCEPEChecker.normalizar(numero);
    const r = await this.crawler.buscar({ numeroProcesso: num, size: 50, maxPages: 1 });
    const ressalvas = [
      'O TCE-PE NAO usa numeracao CNJ e NAO tem DataJud: nao ha segunda base para confirmar. ' +
        'Negativa aqui NAO prova que o processo nao existe — prova que nao ha DELIBERACAO ' +
        'publicada com esse numero na base de jurisprudencia.',
    ];
    if (num !== String(numero).trim()) ressalvas.push(`Numero normalizado de "${numero}" para "${num}".`);
    if (r.total === 0 && /^\d{8}-\d$/.test(num)) {
      ressalvas.push(
        'O campo e EXATO: se o julgado for de um incidente (Agravo, Embargos), o numero ' +
          'carrega sufixo (ex.: 26100740-3AR001) e a raiz sozinha nao encontra.',
      );
    }
    return {
      tribunal: 'TCE-PE',
      numeroConsultado: num,
      encontrado: (r.total || 0) > 0,
      total: r.total,
      deliberacoes: r.resultados.map((x) => ({
        titulo: x.titulo,
        tipoDocumento: x.tipoDocumento,
        dataJulgamento: x.dataJulgamento,
        orgaoJulgador: x.orgaoJulgador,
        relator: x.relator,
        unidadeGestora: x.unidadeGestora,
        url: x.url,
      })),
      ressalvas,
    };
  }

  /** Confere que o permalink de cada documento da amostra responde 200 de verdade. */
  async verificar(resultados, amostra = 3) {
    // So os permalinks PUBLICOS podem ser auditados por link: metade do acervo expoe
    // `portalintranet.tce.pe` (NXDOMAIN) e para esses a auditoria e por reconsulta.
    const publicos = resultados.filter((r) => r.urlPublica);
    const intranet = resultados.filter((r) => r.url && !r.urlPublica);
    const alvos = publicos.slice(0, amostra);
    const out = [];
    for (const r of alvos) {
      const st = await TCEPEChecker._head(r.url);
      out.push({ titulo: r.titulo, url: r.url, status: st.status, ok: st.status === 200, bytes: st.bytes });
      this.log(`   ${st.status === 200 ? '✅' : '❌'} ${r.titulo} → HTTP ${st.status} (${st.bytes} B)`);
    }
    // Para os de intranet, audita por RECONSULTA: o processo tem de reaparecer na base.
    const porReconsulta = [];
    for (const r of intranet.slice(0, Math.max(0, amostra - out.length))) {
      const c = await this.consultarProcesso(r.processo);
      porReconsulta.push({ titulo: r.titulo, processo: r.processo, encontrado: c.encontrado, total: c.total });
      this.log(`   ${c.encontrado ? '✅' : '❌'} ${r.titulo} → reconsulta por ${r.processo}: ${c.total} doc(s)`);
    }
    return {
      amostra: out.length + porReconsulta.length,
      confirmados: out.filter((x) => x.ok).length + porReconsulta.filter((x) => x.encontrado).length,
      itens: out,
      porReconsulta,
      ressalva:
        'Onde ha permalink PUBLICO (etce.tce.pe.gov.br/epp/validaDoc.seam) a auditoria confere ' +
        'que ele responde 200. Metade do acervo (era SIGA) so expoe portalintranet.tce.pe, que e ' +
        'NXDOMAIN: esses sao auditados por RECONSULTA do numero do processo. Nao ha segunda ' +
        'base (sem CNJ, sem DataJud).',
    };
  }

  static _head(url) {
    return new Promise((resolve) => {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, (res) => {
        // validaDoc.seam responde 200 direto ou 30x de http -> https.
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return resolve(TCEPEChecker._head(new URL(res.headers.location, url).toString()));
        }
        let n = 0;
        res.on('data', (c) => (n += c.length));
        res.on('end', () => resolve({ status: res.statusCode, bytes: n }));
      });
      req.setTimeout(60000, () => req.destroy(new Error('timeout')));
      req.on('error', (e) => resolve({ status: 0, bytes: 0, erro: e.message }));
    });
  }
}

module.exports = TCEPEChecker;
