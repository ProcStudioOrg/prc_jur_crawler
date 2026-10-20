// Porta de issue-reporter/contract.ts do FFD — manter em sincronia; sem build TS no JurCrawler.
// Só o valor em tempo de execução: as interfaces do contrato (ReporterMeta, IssueSubmission...)
// são tipos e não existem em JS. A API key do Linear nunca atravessa este contrato.

const PRIORITIES = [
  { value: 1, label: 'Urgente — produção quebrada ou você travado' },
  { value: 2, label: 'Alta — atinge usuário, mas tem contorno' },
  { value: 3, label: 'Média — o padrão' },
  { value: 4, label: 'Baixa — melhoria sem prazo' },
];

module.exports = { PRIORITIES };
