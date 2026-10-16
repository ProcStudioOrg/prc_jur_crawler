// Tela de entrada: lupa 3D por camadas e terminal que reproduz uma pesquisa real.
// Roda só enquanto #login-procstudio está visível; para quando a sessão abre.
// Tudo que o terminal mostra veio de jur/resultados/lc233-pr-pensao-invalido.md
// (pesquisa de 16/10/2026, julgados confirmados por número na base do TJPR).
(function () {
  const login = document.querySelector("#login-procstudio");
  const tty = document.querySelector("#entrada-tty");
  const estado = document.querySelector("#entrada-estado");
  const pilha = document.querySelector("#entrada-pilha");
  if (!login || !tty || !pilha) return;

  // 20 fatias do mesmo glifo deslocadas em Z: ganha espessura ao girar sem biblioteca 3D.
  const FATIAS = 20;
  for (let i = 0; i < FATIAS; i++) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = '<use href="#icone-jur"/>';
    s.style.transform = `translateZ(${(i - (FATIAS - 1) / 2) * 2.2}px)`;
    s.style.color = i === 0 || i === FATIAS - 1 ? "#bfe6ff" : `hsl(206 90% ${22 + i * 1.4}%)`;
    pilha.appendChild(s);
  }

  const reduzido = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ativo = () => !login.hidden && document.body.classList.contains("aguardando-sessao");
  const dormir = (ms) =>
    new Promise((r) => setTimeout(r, reduzido ? Math.min(ms, 40) : ms));
  async function esperarAtivo() {
    while (!ativo()) await new Promise((r) => setTimeout(r, 500));
  }
  const GL = "░▒▓█▚▞01§¶ΔΣ∴≡≠±";
  const rnd = (s) => s[Math.floor(Math.random() * s.length)];
  const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function linha(html, cls = "") {
    const d = document.createElement("div");
    d.className = "l " + cls;
    d.innerHTML = html;
    tty.appendChild(d);
    while (tty.children.length > 26) tty.removeChild(tty.firstChild);
    return d;
  }
  async function digitar(texto, cls = "cmd") {
    const d = linha("", cls + " cursor");
    if (reduzido) { d.textContent = texto; d.classList.remove("cursor"); return d; }
    for (const ch of texto) {
      await esperarAtivo();
      d.textContent += ch;
      await dormir(ch === " " ? 30 : 18 + Math.random() * 40);
    }
    d.classList.remove("cursor");
    return d;
  }
  async function decodificar(el, final, dur = 900) {
    if (reduzido) { el.textContent = final; el.classList.add("decod"); return; }
    const t0 = performance.now();
    for (;;) {
      await esperarAtivo();
      const p = Math.min(1, (performance.now() - t0) / dur);
      const fixo = Math.floor(final.length * p);
      let out = "";
      for (let i = 0; i < final.length; i++) out += i < fixo || final[i] === " " ? final[i] : rnd(GL);
      el.textContent = out;
      if (p >= 1) break;
      await dormir(28);
    }
    el.classList.add("decod");
  }
  async function buscando(rotulo, ms, total) {
    const d = linha(
      `<span class="rot">SEARCHING</span> <span class="barra"></span> <span class="dim">${esc(rotulo)}</span>`,
      "passo",
    );
    const rot = d.querySelector(".rot"), barra = d.querySelector(".barra");
    const palavras = ["SEARCHING", "LENDO·····", "INDEXANDO·", "ORDENANDO·"];
    const t0 = performance.now();
    let k = 0;
    while (!reduzido && performance.now() - t0 < ms) {
      await esperarAtivo();
      const p = (performance.now() - t0) / ms, n = Math.floor(p * 24);
      barra.textContent = "▓".repeat(n) + "░".repeat(24 - n) + " " + String(Math.floor(p * 100)).padStart(3) + "%";
      if (k++ % 6 === 0) rot.textContent = palavras[((k / 6) | 0) % palavras.length];
      if (Math.random() < 0.15) rot.textContent = rot.textContent.replace(/./, rnd("▚▞▓"));
      await dormir(45);
    }
    barra.textContent = "▓".repeat(24) + " 100%";
    rot.textContent = "CONCLUÍDO";
    rot.classList.add("ok");
    d.insertAdjacentHTML("beforeend", `  <span class="n">${esc(total)}</span>`);
    return d;
  }

  const EMENTA = [
    "APELAÇÃO CÍVEL. PENSÃO POR MORTE. RPPS. PARANAPREVIDÊNCIA.",
    "IRMÃO INTERDITADO. SÍNDROME DE DOWN. INVALIDEZ ANTERIOR AO ÓBITO.",
    "DEPENDÊNCIA ECONÔMICA E VÍNCULO FRATERNO COMPROVADOS (ART. 5º, § 6º, II, LC 233/2021).",
    "VALOR: 100% DA APOSENTADORIA — ART. 19, § 3º, I, DA LC ESTADUAL 233/2021.",
    "RECURSO DO ESTADO PARCIALMENTE PROVIDO SÓ PARA CONSTAR A BASE LEGAL NO DISPOSITIVO.",
  ];
  const CAMPOS = [
    ["tribunal", "TJPR · 6ª Câmara Cível"],
    ["processo", "0026912-68.2023.8.16.0014", "num"],
    ["relatora", "Des.ª Angela Maria Machado Costa"],
    ["julgado em", "30/07/2025"],
    ["decisão", "Pensão a irmão interditado. 100% pelo art. 19, § 3º, I, da LC 233/2021"],
    ["lado", "dependente ✓  (Estado só obteve a remissão ao § 3º, I)"],
  ];
  const CONCLUSAO =
    "Nenhum questionamento de constitucionalidade do art. 19, § 3º, da LC 233/2021 foi localizado no TJPR nem no STF. As vitórias do dependente vêm da prova da invalidez, não do afastamento do teto. Tese inédita; via possível: arguição incidental no Órgão Especial (art. 97 CF).";

  async function roteiro() {
    await esperarAtivo();
    tty.innerHTML = "";
    estado.textContent = "● online";
    linha("ProcStudio Jurisprudência · jur 1.0.0 · chromium travado · 3 navegadores", "dim");
    await dormir(600);
    await digitar("Pensão por morte, dependente inválido, RPPS do Paraná. A LC 233/2021 (art. 19, § 3º) já foi questionada por inconstitucionalidade?");
    await dormir(500);
    const r = linha("roteando tribunais  ", "passo");
    for (const [t, ok] of [["TJPR", "ok"], ["STF", "ok"], ["STJ", "err"]]) {
      await dormir(380);
      r.insertAdjacentHTML("beforeend", `<span class="${ok}">${t}${ok === "ok" ? " ✓" : " ✗"}</span>  `);
    }
    await dormir(300);
    r.insertAdjacentHTML("beforeend", '<span class="dim">STJ sem acesso (cloudflare) — excluído da resposta</span>');
    await dormir(700);
    linha('TJPR  <span class="q">"233/2021" pensão inválido</span>  --foro todos  -di 01/03/2021', "passo");
    await buscando("inteiro teor · 4 páginas", 2200, "57 acórdãos");
    linha('TJPR  <span class="q">"233/2021" "cota familiar"</span>', "passo");
    await buscando("inteiro teor", 1500, "44 acórdãos");
    linha('TJPR  <span class="q">"cota familiar" inconstituciona$</span>', "passo");
    await buscando("ementa", 1100, "0 — nada questiona o teto");
    linha('STF   <span class="q">ADI "233/2021"</span>', "passo");
    await buscando("pesquisa de jurisprudência", 1400, "ADI 6849 (art. 48) · ADI 7051 (art. 23, caput)");
    await dormir(600);
    estado.textContent = "● lendo inteiro teor";
    linha("lendo 30 inteiros teores · 0026912-68.2023.8.16.0014", "passo");
    for (const t of EMENTA) {
      const e = linha("", "leitura");
      await decodificar(e, t, 700 + Math.random() * 500);
      await dormir(120);
    }
    await dormir(500);
    estado.textContent = "● organizando";
    linha("organizando", "passo");
    const card = document.createElement("div");
    card.className = "card montando";
    tty.appendChild(card);
    for (const [k, v, extra] of CAMPOS) {
      await dormir(260);
      card.insertAdjacentHTML("beforeend", `<span class="k">${esc(k)}</span><span class="v ${extra || ""}">${esc(v)}</span>`);
    }
    await dormir(500);
    const selo = document.createElement("span");
    selo.className = "selo";
    selo.innerHTML = "<code>jur tjpr -n 0026912-68.2023.8.16.0014</code>  …";
    card.appendChild(selo);
    await dormir(900);
    selo.innerHTML = "✓ VERIFICADO na base oficial  <code>encontrado: true · portal.tjpr.jus.br/jurisprudencia/j/4100000033393371</code>";
    card.classList.remove("montando");
    await dormir(900);
    estado.textContent = "● respondendo";
    const c = linha("", "resumo cursor");
    if (reduzido) c.textContent = CONCLUSAO;
    else for (const ch of CONCLUSAO) { await esperarAtivo(); c.textContent += ch; await dormir(9); }
    c.classList.remove("cursor");
    await dormir(400);
    linha("37 consultas TJPR · 17 STF · 30 inteiros teores lidos · 8 julgados citados · 8 verificados · 0 de memória", "placar");
    estado.textContent = "● concluído";
    if (reduzido) return;
    await dormir(7000);
    roteiro();
  }
  roteiro();
})();
