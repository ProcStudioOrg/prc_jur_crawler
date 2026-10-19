/**
 * Reporter de issues embutido — o menu flutuante que abre card no Linear sem
 * sair do sistema.
 *
 * JurCrawler: copia do widget compartilhado (prc_wao/app/javascript/lib/
 * issue_reporter_widget.js, por sua vez copia de fullFuckerDashboard/ai-dashboard/
 * issue-reporter/widget.js). Mantido identico de proposito; as duas adaptacoes
 * locais estao marcadas com "JurCrawler:". Rotas: servidor/rotas/feedback.js.
 *
 * Sem dependencia e sem framework, de proposito: o mesmo arquivo roda no
 * FullFucker Dashboard (Next/React), no WhatsOrganizer (Rails/Turbo) e no
 * ProcStudio (React + API Rails). O que muda entre eles e a rota do servidor,
 * nao a tela.
 *
 * Todo o DOM vive dentro de um Shadow Root. Isso nao e preciosismo: o host
 * pode ter Tailwind v3, v4, Bootstrap ou CSS proprio, e um widget que herda
 * estilo do host quebra em algum deles. Dentro do shadow, nada entra e nada
 * sai.
 *
 *   import { mountIssueReporter } from "./widget.js";
 *   mountIssueReporter({ base: "/api/issues" });
 *
 * A captura de console e de requisicoes com erro comeca no `mount`, nao na
 * abertura do painel — quando a pessoa decide reportar, o erro ja aconteceu.
 */

const DEFAULTS = {
  /** Base das rotas: GET `${base}/meta` e POST `${base}`. */
  base: "/api/issues",
  /** "alt+i" — combinacao que nenhum browser reserva. Vazio desliga. */
  hotkey: "alt+i",
  /** Quantos erros de console e requisicoes falhas guardar. */
  bufferSize: 20,
  captureConsole: true,
  captureNetwork: true,
  /** "auto" segue o prefers-color-scheme do sistema. */
  theme: "auto",
  /** Funcao que devolve campos extras do app (tenant, plano, usuario...). */
  extra: () => ({}),
  /**
   * Headers extras em toda chamada. Existe para SPA com token: o FFD e o
   * WhatsOrganizer autenticam por cookie e nao precisam disso, mas o
   * ProcStudio manda JWT no Authorization, e sem esse gancho as duas rotas
   * voltariam 401 para todo mundo logado.
   */
  headers: () => ({}),
  /** Distancia do topo, em porcentagem da altura da janela. */
  anchor: "45%",
  /** Texto na aba lateral. */
  label: "Reportar",
  /** Titulo do painel. Num app publico nao se menciona o Linear: para quem
   *  esta do outro lado, a ferramenta interna de quem recebe nao e assunto. */
  panelTitle: "Reportar para o Linear",
  /** Linha de apoio sob o titulo. Vazio usa time + rota. */
  panelSubtitle: "",
};

// JurCrawler: chave propria, para nao misturar com o historico de outro app na mesma origem.
const STORE_KEY = "jur.feedback.recent";
const MAX_RECENT = 5;

/** @typedef {{level:"error"|"warn",message:string,at:string}} ConsoleEntry */
/** @typedef {{method:string,url:string,status:number,at:string}} NetworkEntry */

// ─── Buffers ────────────────────────────────────────────────────────────────

/** Anel de tamanho fixo. Guardar tudo e vazar memoria numa aba aberta o dia todo. */
function ring(size) {
  const items = [];
  return {
    push(item) {
      items.push(item);
      if (items.length > size) items.shift();
    },
    all: () => items.slice(),
    clear: () => items.splice(0, items.length),
  };
}

function stringifyArg(arg) {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack || ""}`;
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function installCapture(state, options) {
  const undo = [];

  if (options.captureConsole) {
    for (const level of ["error", "warn"]) {
      const original = console[level];
      console[level] = function (...args) {
        state.console.push({
          level,
          message: args.map(stringifyArg).join(" ").slice(0, 400),
          at: new Date().toISOString(),
        });
        return original.apply(console, args);
      };
      undo.push(() => {
        console[level] = original;
      });
    }

    const onError = (e) => {
      state.console.push({
        level: "error",
        message: `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`.slice(0, 400),
        at: new Date().toISOString(),
      });
    };
    const onRejection = (e) => {
      state.console.push({
        level: "error",
        message: `Promise rejeitada: ${stringifyArg(e.reason)}`.slice(0, 400),
        at: new Date().toISOString(),
      });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    undo.push(() => window.removeEventListener("error", onError));
    undo.push(() => window.removeEventListener("unhandledrejection", onRejection));
  }

  if (options.captureNetwork && typeof window.fetch === "function") {
    const original = window.fetch;
    window.fetch = async function (input, init) {
      const method = (init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
      const url = typeof input === "string" ? input : input?.url || String(input);
      // As proprias chamadas do reporter nunca entram no relatorio: um POST
      // que falha viraria linha no contexto da tentativa seguinte, e o ruido
      // cresceria a cada retentativa.
      const isOwn = url.includes(options.base);
      try {
        const res = await original.apply(this, arguments);
        if (!isOwn && !res.ok) {
          state.network.push({ method, url: shortUrl(url), status: res.status, at: new Date().toISOString() });
        }
        return res;
      } catch (err) {
        if (!isOwn) {
          state.network.push({ method, url: shortUrl(url), status: 0, at: new Date().toISOString() });
        }
        throw err;
      }
    };
    undo.push(() => {
      window.fetch = original;
    });
  }

  return () => undo.forEach((fn) => fn());
}

/** Tira a query string: e onde token e e-mail costumam viajar. */
function shortUrl(url) {
  try {
    const u = new URL(url, window.location.origin);
    return `${u.origin === window.location.origin ? "" : u.origin}${u.pathname}`;
  } catch {
    return String(url).split("?")[0];
  }
}

// ─── Contexto ───────────────────────────────────────────────────────────────

function collectContext(state, options) {
  let extra = {};
  try {
    extra = options.extra() || {};
  } catch {
    extra = {};
  }

  return {
    url: window.location.href,
    path: window.location.pathname,
    screen: document.title || "",
    referrer: document.referrer || "",
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    userAgent: navigator.userAgent,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    at: new Date().toISOString(),
    console: state.console.all(),
    network: state.network.all(),
    extra: Object.fromEntries(
      Object.entries(extra).map(([k, v]) => [String(k), String(v ?? "")])
    ),
  };
}

// ─── Historico local ────────────────────────────────────────────────────────

function readRecent() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function pushRecent(entry) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([entry, ...readRecent()].slice(0, MAX_RECENT)));
  } catch {
    /* modo anonimo, cota cheia — o historico e conveniencia, nao dado */
  }
}

// ─── Estilo ─────────────────────────────────────────────────────────────────

const CSS = `
:host {
  --ir-bg: rgba(24, 24, 27, 0.82);
  --ir-panel: rgba(24, 24, 27, 0.93);
  --ir-border: rgba(113, 113, 122, 0.35);
  --ir-text: #fafafa;
  --ir-muted: #a1a1aa;
  --ir-field: rgba(63, 63, 70, 0.5);
  --ir-accent: #6366f1;
  --ir-accent-hover: #818cf8;
  --ir-danger: #f87171;
  --ir-ok: #4ade80;
  all: initial;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
:host([data-theme="light"]) {
  --ir-bg: rgba(255, 255, 255, 0.85);
  --ir-panel: rgba(255, 255, 255, 0.96);
  --ir-border: rgba(24, 24, 27, 0.15);
  --ir-text: #18181b;
  --ir-muted: #52525b;
  --ir-field: rgba(244, 244, 245, 0.9);
}
* { box-sizing: border-box; }

.launcher {
  position: fixed;
  right: 0;
  top: var(--ir-anchor, 45%);
  z-index: 2147483000;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 10px 10px 12px;
  border: 1px solid var(--ir-border);
  border-right: none;
  border-radius: 10px 0 0 10px;
  background: var(--ir-bg);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: var(--ir-text);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
  cursor: pointer;
  /* Semi-transparente parado, opaco no hover: o menu fica sempre disponivel
     sem competir com a tela por atencao. */
  opacity: 0.38;
  transform: translateX(2px);
  transition: opacity 140ms ease, transform 140ms ease, box-shadow 140ms ease;
}
.launcher:hover, .launcher:focus-visible {
  opacity: 1;
  transform: translateX(0);
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.35);
  outline: none;
}
.launcher .label {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  transform: rotate(180deg);
  white-space: nowrap;
}
.launcher .dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--ir-danger);
  box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.18);
}
.launcher[hidden] { display: none; }

.backdrop {
  position: fixed; inset: 0; z-index: 2147483001;
  background: rgba(0, 0, 0, 0.35);
  opacity: 0; pointer-events: none;
  transition: opacity 160ms ease;
}
.backdrop.open { opacity: 1; pointer-events: auto; }

.panel {
  position: fixed;
  top: 0; right: 0; bottom: 0;
  z-index: 2147483002;
  width: min(420px, 100vw);
  display: flex; flex-direction: column;
  background: var(--ir-panel);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border-left: 1px solid var(--ir-border);
  color: var(--ir-text);
  transform: translateX(100%);
  transition: transform 200ms cubic-bezier(0.32, 0.72, 0, 1);
  box-shadow: -12px 0 48px rgba(0, 0, 0, 0.4);
}
.panel.open { transform: translateX(0); }

.head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid var(--ir-border);
}
.head h2 { margin: 0; font-size: 13px; font-weight: 600; }
.head .sub { margin: 2px 0 0; font-size: 11px; color: var(--ir-muted); }
.close {
  background: none; border: none; color: var(--ir-muted);
  font-size: 18px; line-height: 1; cursor: pointer; padding: 4px 6px;
}
.close:hover { color: var(--ir-text); }

form { padding: 14px 16px; overflow-y: auto; flex: 1; }
label { display: block; font-size: 11px; color: var(--ir-muted); margin-bottom: 4px; }
.field { margin-bottom: 12px; }
input, textarea, select {
  width: 100%; font: inherit; font-size: 13px;
  color: var(--ir-text); background: var(--ir-field);
  border: 1px solid var(--ir-border); border-radius: 8px;
  padding: 8px 10px;
}
input:focus, textarea:focus, select:focus {
  outline: none; border-color: var(--ir-accent);
}
textarea { min-height: 110px; resize: vertical; }
select option { background: #18181b; color: #fafafa; }
:host([data-theme="light"]) select option { background: #fff; color: #18181b; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

details.context {
  border: 1px solid var(--ir-border); border-radius: 8px;
  padding: 8px 10px; margin-bottom: 12px; font-size: 11px; color: var(--ir-muted);
}
details.context summary { cursor: pointer; user-select: none; }
details.context dl { margin: 8px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; }
details.context dt { color: var(--ir-muted); white-space: nowrap; }
details.context dd { margin: 0; color: var(--ir-text); word-break: break-all; }
.pill {
  display: inline-block; margin-left: 6px; padding: 1px 6px;
  border-radius: 999px; font-size: 10px;
  background: rgba(248, 113, 113, 0.18); color: var(--ir-danger);
}

.foot {
  padding: 12px 16px; border-top: 1px solid var(--ir-border);
  display: flex; align-items: center; gap: 10px;
}
button.send {
  background: var(--ir-accent); color: #fff; border: none;
  border-radius: 8px; padding: 9px 16px; font: inherit; font-size: 13px;
  font-weight: 500; cursor: pointer;
}
button.send:hover:not(:disabled) { background: var(--ir-accent-hover); }
button.send:disabled { opacity: 0.5; cursor: default; }
.msg { font-size: 11px; color: var(--ir-muted); flex: 1; }
.msg.error { color: var(--ir-danger); }
.msg.ok { color: var(--ir-ok); }

.recent { padding: 0 16px 12px; font-size: 11px; color: var(--ir-muted); }
.recent a { color: var(--ir-accent-hover); text-decoration: none; }
.recent a:hover { text-decoration: underline; }
.recent ul { margin: 6px 0 0; padding-left: 16px; }

@media (max-width: 520px) {
  .panel { width: 100vw; }
}
@media (prefers-reduced-motion: reduce) {
  .panel, .backdrop, .launcher { transition: none; }
}
`;

// ─── Montagem ───────────────────────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/**
 * Monta o reporter. Idempotente: chamar duas vezes nao cria dois botoes.
 * @returns {{ destroy: () => void, open: () => void }}
 */
export function mountIssueReporter(userOptions = {}) {
  const options = { ...DEFAULTS, ...userOptions };

  if (typeof window === "undefined" || typeof document === "undefined") {
    return { destroy() {}, open() {} };
  }
  if (window.__issueReporter) return window.__issueReporter;

  const state = {
    console: ring(options.bufferSize),
    network: ring(options.bufferSize),
    meta: null,
  };
  let pulse;

  const stopCapture = installCapture(state, options);

  const host = document.createElement("div");
  host.setAttribute("data-issue-reporter", "");
  if (options.theme !== "auto") host.setAttribute("data-theme", options.theme);
  else if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    host.setAttribute("data-theme", "light");
  }
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>${CSS}</style>`;
  document.body.appendChild(host);

  const launcher = document.createElement("button");
  launcher.className = "launcher";
  launcher.type = "button";
  launcher.hidden = true;
  launcher.style.setProperty("--ir-anchor", options.anchor);
  launcher.setAttribute("aria-label", "Reportar problema ou ideia");
  shadow.appendChild(launcher);

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  shadow.appendChild(backdrop);

  const panel = document.createElement("aside");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Reportar para o Linear");
  shadow.appendChild(panel);

  let open = false;

  function renderLauncher() {
    const pending = state.console.all().length + state.network.all().length;
    launcher.innerHTML = `
      ${pending ? '<span class="dot"></span>' : ""}
      <span class="label">${esc(options.label)}</span>
    `;
    launcher.title = pending
      ? `${options.label} — ${pending} erro(s) capturado(s) nesta tela`
      : "Reportar problema ou ideia";
  }

  function selectHtml(id, label, opts, selected) {
    if (!opts.length) return "";
    return `
      <div class="field">
        <label for="${id}">${esc(label)}</label>
        <select id="${id}">
          <option value="">—</option>
          ${opts
            .map(
              (o) =>
                `<option value="${esc(o.value)}"${String(o.value) === String(selected) ? " selected" : ""}>${esc(o.label)}</option>`
            )
            .join("")}
        </select>
      </div>`;
  }

  function renderPanel() {
    const meta = state.meta;
    const ctx = collectContext(state, options);
    const errors = ctx.console.length;
    const fails = ctx.network.length;
    const recent = meta.requireContact ? [] : readRecent();

    const preselectedModule =
      meta.moduleByPath[ctx.path] ??
      // Casa por prefixo tambem: /servers/nas herda o modulo de /servers.
      Object.entries(meta.moduleByPath)
        .filter(([p]) => p !== "/" && ctx.path.startsWith(p))
        .sort((a, b) => b[0].length - a[0].length)[0]?.[1] ??
      "";

    panel.innerHTML = `
      <div class="head">
        <div>
          <h2>${esc(options.panelTitle)}</h2>
          <p class="sub">
            ${
              options.panelSubtitle
                ? esc(options.panelSubtitle)
                : `${meta.team ? `${esc(meta.team.name)} · ${esc(meta.team.key)}` : "time não configurado"} · ${esc(ctx.path)}`
            }
          </p>
        </div>
        <button class="close" type="button" aria-label="Fechar">×</button>
      </div>

      <form>
        <div class="field">
          <label for="ir-title">O que aconteceu (título)</label>
          <input id="ir-title" maxlength="160" placeholder="Cache de labels não invalida ao trocar de time" />
        </div>

        <div class="field">
          <label for="ir-body">Detalhe — o que você esperava e o que veio</label>
          <textarea id="ir-body" maxlength="6000" placeholder="Passo a passo, o que deveria acontecer, o que aconteceu."></textarea>
        </div>

        <div class="row">
          ${selectHtml("ir-module", "Módulo", meta.modules, preselectedModule)}
          ${selectHtml("ir-type", "Tipo", meta.types, "")}
        </div>

        ${selectHtml("ir-priority", "Prioridade", meta.priorities.map((p) => ({ value: String(p.value), label: p.label })), "3")}

        ${
          meta.requireContact
            ? `<div class="row">
                 <div class="field">
                   <label for="ir-name">Seu nome</label>
                   <input id="ir-name" maxlength="80" />
                 </div>
                 <div class="field">
                   <label for="ir-email">Seu e-mail</label>
                   <input id="ir-email" type="email" maxlength="120" placeholder="para respondermos" />
                 </div>
               </div>`
            : ""
        }

        <details class="context">
          <summary>
            Contexto que vai junto
            ${errors ? `<span class="pill">${errors} erro(s)</span>` : ""}
            ${fails ? `<span class="pill">${fails} request(s)</span>` : ""}
          </summary>
          <dl>
            <dt>Origem</dt><dd>${esc(meta.app.name)} ${esc(meta.app.version ? `v${meta.app.version}` : "")} ${esc(meta.app.commit || "")}</dd>
            <dt>Tela</dt><dd>${esc(ctx.screen || ctx.path)}</dd>
            <dt>URL</dt><dd>${esc(ctx.url)}</dd>
            <dt>Janela</dt><dd>${esc(ctx.viewport)} · ${esc(ctx.language)} · ${esc(ctx.timezone)}</dd>
            <dt>Navegador</dt><dd>${esc(ctx.userAgent)}</dd>
            ${Object.entries(ctx.extra).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}
          </dl>
        </details>
      </form>

      ${
        recent.length
          ? `<div class="recent">
               Enviadas desta máquina:
               <ul>${recent.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.identifier)}</a> — ${esc(r.title)}</li>`).join("")}</ul>
             </div>`
          : ""
      }

      <div class="foot">
        <button class="send" type="button">Enviar</button>
        <span class="msg"></span>
      </div>
    `;

    panel.querySelector(".close").addEventListener("click", close);
    panel.querySelector(".send").addEventListener("click", submit);
    panel.querySelector("#ir-title")?.focus();
  }

  async function submit() {
    const msg = panel.querySelector(".msg");
    const button = panel.querySelector(".send");
    const get = (id) => panel.querySelector(id)?.value?.trim() ?? "";

    const title = get("#ir-title");
    const body = get("#ir-body");
    if (title.length < 4) {
      msg.className = "msg error";
      msg.textContent = "Título curto demais.";
      return;
    }
    if (!body) {
      msg.className = "msg error";
      msg.textContent = "Escreva o que aconteceu.";
      return;
    }

    button.disabled = true;
    msg.className = "msg";
    msg.textContent = "Enviando…";

    const priorityRaw = get("#ir-priority");
    const payload = {
      title,
      body,
      module: get("#ir-module") || null,
      type: get("#ir-type") || null,
      priority: priorityRaw ? Number(priorityRaw) : null,
      reporter: state.meta.requireContact
        ? { name: get("#ir-name"), email: get("#ir-email") }
        : null,
      // Recoletado agora: entre abrir o painel e clicar em Enviar a pessoa
      // pode ter reproduzido o bug, e sao esses erros que interessam.
      context: { ...collectContext(state, options), at: new Date().toISOString() },
    };

    try {
      const res = await fetch(options.base, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeader(), ...authHeaders() },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        msg.className = "msg error";
        // JurCrawler: a API responde `erro` (convencao do jur) alem de `error`.
        msg.textContent = data.error || data.erro || `Falhou (${res.status}).`;
        button.disabled = false;
        return;
      }

      msg.className = "msg ok";
      if (state.meta.requireContact) {
        // App publico: quem reportou nao tem conta no Linear, entao o link
        // nao serve para nada e o identificador nao diz nada. O que ele
        // precisa saber e que chegou.
        msg.textContent = "Recebido. Obrigado — vamos olhar.";
      } else {
        pushRecent({ identifier: data.identifier, url: data.url, title });
        msg.innerHTML = `Criada: <a href="${esc(data.url)}" target="_blank" rel="noreferrer">${esc(data.identifier)}</a>`;
      }
      // Os buffers zeram: o que foi reportado nao deve reaparecer na proxima
      // issue como se fosse novo.
      state.console.clear();
      state.network.clear();
      renderLauncher();
      setTimeout(() => {
        close();
        button.disabled = false;
      }, 1800);
    } catch (e) {
      msg.className = "msg error";
      msg.textContent = `Falhou: ${e.message}`;
      button.disabled = false;
    }
  }

  /** Rails exige o token de CSRF; nos outros a meta simplesmente nao existe. */
  function csrfHeader() {
    const token = document.querySelector('meta[name="csrf-token"]')?.content;
    return token ? { "X-CSRF-Token": token } : {};
  }

  function authHeaders() {
    try {
      return options.headers() || {};
    } catch {
      return {};
    }
  }

  function openPanel() {
    if (!state.meta?.enabled) return;
    open = true;
    renderPanel();
    panel.classList.add("open");
    backdrop.classList.add("open");
  }

  function close() {
    open = false;
    panel.classList.remove("open");
    backdrop.classList.remove("open");
    launcher.focus();
  }

  launcher.addEventListener("click", () => (open ? close() : openPanel()));
  backdrop.addEventListener("click", close);

  const onKey = (e) => {
    if (e.key === "Escape" && open) return close();
    if (!options.hotkey) return;
    const [mod, key] = options.hotkey.split("+");
    const modOk = mod === "alt" ? e.altKey : mod === "ctrl" ? e.ctrlKey : mod === "meta" ? e.metaKey : true;
    if (modOk && e.key.toLowerCase() === key) {
      e.preventDefault();
      open ? close() : openPanel();
    }
  };
  window.addEventListener("keydown", onKey);

  // O launcher so aparece depois do /meta: um botao que abre um painel vazio
  // porque o Linear nao esta configurado e pior do que nao ter botao.
  fetch(`${options.base}/meta`, { credentials: "same-origin", headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : null))
    .then((meta) => {
      if (!meta?.enabled) return;
      state.meta = meta;
      launcher.hidden = false;
      renderLauncher();
      // Erro novo depois de montado repinta o ponto vermelho no launcher.
      pulse = setInterval(renderLauncher, 5000);
    })
    .catch(() => {});

  const api = {
    open: openPanel,
    destroy() {
      stopCapture();
      clearInterval(pulse);
      window.removeEventListener("keydown", onKey);
      host.remove();
      delete window.__issueReporter;
    },
  };
  window.__issueReporter = api;
  return api;
}

export default mountIssueReporter;
