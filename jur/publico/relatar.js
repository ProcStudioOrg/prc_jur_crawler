// jur/publico/relatar.js
// Monta o botão "Relatar" (widget do issue-reporter do FFD, copiado sem alteração) só para
// quem está logado: as rotas exigem sessão, e um botão que responde 401 só confunde.
import { mountIssueReporter } from "/issue-reporter/widget.js";

let reporter = null;

// Só os ids do que está na tela: o servidor confere que busca e conversa são desta conta e
// tira delas os fatos (tribunal, filtros, erro, mensagens). O resto do `extra` é alegação.
function naTela() {
  const extra = {};
  const busca = window.jurBuscaVisivel;
  if (busca && busca.jobId) {
    extra.jobId = busca.jobId;
    extra.tribunal = busca.tribunal;
  }
  const conversaId = window.jurConversa && window.jurConversa.id;
  if (conversaId) extra.conversaId = conversaId;
  return extra;
}

function montar() {
  if (reporter || !(window.jurSessao && window.jurSessao.principal)) return;
  reporter = mountIssueReporter({
    base: "/api/v1/relatos",
    hotkey: "alt+i",
    theme: "auto",
    label: "Relatar",
    panelTitle: "Relatar um problema",
    // Quem relata não tem conta no Linear do time; o link do card não lhe serve.
    showIssueLink: false,
    extra: naTela,
  });
}

document.addEventListener("jur:sessao", montar);
document.addEventListener("jur:sair", () => {
  if (reporter) reporter.destroy();
  reporter = null;
});
// Módulo roda adiado: a sessão pode já ter chegado antes deste arquivo.
montar();
