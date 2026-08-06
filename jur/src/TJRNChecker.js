// src/TJRNChecker.js
const https = require('node:https');
const cnj = require('./cnj');

/**
 * Checker for TJRN: confirms that a process number really exists.
 *
 * POR QUE ESTE TRIBUNAL SÓ TEM CHECKER
 * ------------------------------------
 * Medido em 06/08/2026: **todo o domínio público do TJRN responde HTTP 403**
 * ("Access Denied" do Akamai, com referência `errors.edgesuite.net`) — não só o
 * portal de jurisprudência, mas também o site institucional e o `/robots.txt`.
 * O bloqueio é uma ACL no edge, não um captcha ou um desafio: chega instantâneo,
 * sem `Set-Cookie`, sem JavaScript, sem nada para resolver. Chromium real (com
 * UA de Chrome, `navigator.webdriver` mascarado, locale pt-BR) recebe exatamente
 * a mesma resposta que o `curl`. Detalhes e receita de reteste em CLAUDE-TJRN.md.
 *
 * A porta que continua aberta é a **API Pública do DataJud (CNJ)**, oficial e
 * documentada, que não passa pelo Akamai do tribunal. Confirmado ao vivo em
 * 06/08/2026: o índice `api_publica_tjrn` tem **2.651.445 processos**
 * (G1 1.244.248 · JE 914.799 · G2 302.661 · TR 189.737) e está **corrente**
 * (atualização mais recente em 03/08/2026).
 *
 * LIMITE — leia antes de confiar nisto:
 *   O DataJud carrega **só metadados**. Não tem ementa, não tem inteiro teor,
 *   não tem relator. Ele responde "este processo existe no TJRN?" — que é
 *   exatamente a invariante anti-alucinação deste repo — mas **não** prova que
 *   um *julgado* (aquela ementa, aquela tese) existe. Citação do TJRN pode ser
 *   confirmada como *processo*, nunca como *decisão*, enquanto o 403 durar.
 *   Diga isso ao citar.
 *
 * Docs: https://datajud-wiki.cnj.jus.br/api-publica/
 * A chave pública é publicada pelo CNJ e pode rotacionar — sobrescreva com a
 * variável de ambiente DATAJUD_API_KEY quando isso acontecer.
 *
 * CLI: node src/TJRNChecker.js <numero-processo-CNJ>
 */

const DATAJUD_URL = 'https://api-publica.datajud.cnj.jus.br/api_publica_tjrn/_search';
const DATAJUD_KEY_PADRAO = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

/** TJRN na numeração CNJ: Justiça Estadual (J=8), tribunal 20. */
const TJRN_JUSTICA = 8;
const TJRN_TRIBUNAL = 20;

/** Hosts do TJRN medidos em 403 em 06/08/2026 — usados pelo diagnóstico. */
const HOSTS_BLOQUEADOS = [
  'https://esaj.tjrn.jus.br/cjsg/consultaCompleta.do',
  'https://jurisprudencia.tjrn.jus.br/',
  'https://www.tjrn.jus.br/',
];

class TJRNChecker {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env.DATAJUD_API_KEY ?? DATAJUD_KEY_PADRAO;
    this.timeout = options.timeout ?? 60000;
    this.retries = options.retries ?? 2;
    this.log = options.log ?? (() => {});
  }

  /** POST JSON no DataJud (índice api_publica_tjrn). @private */
  _post(body, attempt = 0) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = https.request(DATAJUD_URL, {
        method: 'POST',
        headers: {
          Authorization: `APIKey ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode !== 200) {
            return reject(new Error(`DataJud HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
          }
          try { resolve(JSON.parse(text)); } catch (e) { reject(new Error(`DataJud JSON inválido: ${e.message}`)); }
        });
        res.on('error', reject);
      });
      req.setTimeout(this.timeout, () => req.destroy(new Error(`Timeout after ${this.timeout}ms (DataJud)`)));
      req.on('error', reject);
      req.write(payload);
      req.end();
    }).catch((err) => {
      if (attempt < this.retries) {
        const delay = 3000 * (attempt + 1);
        this.log(`Retry ${attempt + 1}/${this.retries} after ${delay}ms: ${err.message}`);
        return new Promise((r) => setTimeout(r, delay)).then(() => this._post(body, attempt + 1));
      }
      throw err;
    });
  }

  /** @see cnj.normalizar */
  normalizarNumeroCNJ(numero) { return cnj.normalizar(numero); }

  /** @see cnj.validar */
  validarNumeroCNJ(numero) { return cnj.validar(numero); }

  /** True quando o número pertence ao TJRN (J=8, TR=20). */
  ehProcessoTJRN(numero) { return cnj.pertenceA(numero, TJRN_JUSTICA, TJRN_TRIBUNAL); }

  /**
   * Consulta um processo pelo número CNJ na base do DataJud (índice do TJRN).
   *
   * @param {string} numero - com ou sem máscara
   * @returns {Object} {numero, numeroValido, tjrn, encontrado, fonte, processos:[...]}
   */
  async consultarProcesso(numero) {
    const fmt = this.normalizarNumeroCNJ(numero);
    if (!fmt) {
      return {
        numero: String(numero), numeroValido: false, tjrn: false,
        encontrado: false, fonte: 'datajud', processos: [],
      };
    }
    const digitos = fmt.replace(/\D/g, '');
    const res = await this._post({
      size: 10,
      query: { match: { numeroProcesso: digitos } },
    });
    const hits = res.hits?.hits ?? [];
    return {
      numero: fmt,
      numeroValido: this.validarNumeroCNJ(fmt),
      tjrn: this.ehProcessoTJRN(fmt),
      encontrado: hits.length > 0,
      fonte: 'datajud',
      // lembrete honesto: DataJud não tem ementa nem inteiro teor
      ressalva: 'DataJud confirma a EXISTÊNCIA do processo (metadados). '
        + 'Não confirma ementa, tese nem inteiro teor — o domínio público do '
        + 'TJRN responde 403 (Access Denied do Akamai) desde 06/08/2026.',
      processos: hits.map((h) => {
        const s = h._source ?? {};
        return {
          id: h._id,
          numeroProcesso: s.numeroProcesso ?? '',
          tribunal: s.tribunal ?? '',
          grau: s.grau ?? '',
          classe: s.classe?.nome ?? '',
          orgaoJulgador: s.orgaoJulgador?.nome ?? '',
          sistema: s.sistema?.nome ?? '',
          dataAjuizamento: s.dataAjuizamento ?? '',
          ultimaAtualizacao: s.dataHoraUltimaAtualizacao ?? '',
          movimentos: (s.movimentos ?? []).length,
        };
      }),
    };
  }

  /**
   * Checa ao vivo se o 403 do TJRN ainda existe. Não precisa de browser: o
   * bloqueio é servido pelo edge antes de qualquer JavaScript.
   *
   * @returns {Object} {bloqueado, medidoEm, hosts:[{url,status,servidor,setCookie}]}
   */
  async diagnosticar() {
    const hosts = [];
    for (const url of HOSTS_BLOQUEADOS) {
      const medida = await new Promise((resolve) => {
        const req = https.request(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
              + '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          },
        }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf-8');
            resolve({
              url,
              status: res.statusCode,
              accessDenied: /Access Denied/i.test(body),
              // o corpo do Akamai vem com os pontos escapados: `edgesuite&#46;net`
              edgesuite: /edgesuite(\.|&#46;)net/i.test(body),
              setCookie: !!res.headers['set-cookie'],
            });
          });
        });
        req.setTimeout(30000, () => req.destroy(new Error('timeout')));
        req.on('error', (e) => resolve({ url, status: 0, erro: e.message }));
        req.end();
      });
      this.log(`  ${medida.status} ${url}${medida.accessDenied ? ' (Access Denied / Akamai)' : ''}`);
      hosts.push(medida);
    }
    const bloqueado = hosts.every((h) => h.status === 403);
    return {
      tribunal: 'TJRN',
      bloqueado,
      medidoEm: new Date().toISOString(),
      diagnostico: bloqueado
        ? 'Bloqueio ativo: ACL no edge Akamai, 403 em todo o domínio público '
          + '(inclusive o site institucional). Não é captcha — não há o que resolver.'
        : 'ALGUM host respondeu diferente de 403 — o bloqueio pode ter caído. '
          + 'Reabra o mapeamento com a skill codegen (ver CLAUDE-TJRN.md).',
      hosts,
    };
  }

  /**
   * Audita uma lista de resultados: amostra N itens, reconsulta cada processo
   * e confirma que ele existe na base oficial (anti-alucinação).
   *
   * @param {Array<Object>} results - resultados mapeados (campo `processo` ou `numeroProcesso`)
   * @param {Object} options - {amostra: number = 5, log}
   * @returns {Object} {verificados, confirmados, divergentes, fonte, detalhes}
   */
  async verificarResultados(results, options = {}) {
    const amostra = Math.min(options.amostra ?? 5, results.length);
    const log = options.log ?? (() => {});
    const passo = Math.max(1, Math.floor(results.length / amostra));
    const detalhes = [];

    for (let i = 0; i < results.length && detalhes.length < amostra; i += passo) {
      const r = results[i];
      const numero = r.processo || r.numeroProcesso || r.numeroprocesso;
      const item = { indice: i, numeroProcesso: numero, confirmado: false, motivo: '' };
      try {
        if (!this.validarNumeroCNJ(numero)) {
          item.avisoDV = 'dígito verificador CNJ não confere';
        }
        if (!this.ehProcessoTJRN(numero)) {
          item.avisoTribunal = 'número não pertence ao TJRN (J=8, TR=20)';
        }
        const res = await this.consultarProcesso(numero);
        if (!res.encontrado) item.motivo = 'processo não encontrado no DataJud (índice api_publica_tjrn)';
        else { item.confirmado = true; item.grau = res.processos[0]?.grau ?? ''; }
      } catch (err) {
        item.motivo = `erro na consulta: ${err.message}`;
      }
      log(`  verificando ${numero}: ${item.confirmado ? 'OK' : item.motivo}`);
      detalhes.push(item);
    }

    const confirmados = detalhes.filter((d) => d.confirmado).length;
    return {
      verificados: detalhes.length,
      confirmados,
      divergentes: detalhes.length - confirmados,
      fonte: 'datajud',
      detalhes,
    };
  }
}

TJRNChecker.DATAJUD_URL = DATAJUD_URL;
TJRNChecker.TJRN_JUSTICA = TJRN_JUSTICA;
TJRNChecker.TJRN_TRIBUNAL = TJRN_TRIBUNAL;
TJRNChecker.HOSTS_BLOQUEADOS = HOSTS_BLOQUEADOS;

module.exports = TJRNChecker;

// CLI: node src/TJRNChecker.js <numero>
if (require.main === module) {
  const numero = process.argv[2];
  if (!numero) {
    console.error('Uso: node src/TJRNChecker.js <numero-processo-CNJ>');
    process.exit(2);
  }
  new TJRNChecker().consultarProcesso(numero)
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    })
    .catch((err) => {
      console.error('Erro:', err.message);
      process.exit(1);
    });
}
