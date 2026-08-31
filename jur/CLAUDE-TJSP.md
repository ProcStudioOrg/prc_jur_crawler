# TJSP — Tribunal de Justiça de São Paulo

**Escopo:** SP · **Status:** 🟡 incerto/instável, dependente de navegador
**Crawler:** `src/TJSPCrawler.js` (Playwright + ESAJ)

O ESAJ carrega reCAPTCHA invisível (reCAPTCHA v3 +
`captchaControleAcesso.do`). O mesmo fluxo Playwright funciona em alguns dias e
é bloqueado em outros; portanto, **não prometa disponibilidade antes do teste da
rodada**. Não é bloqueio permanente nem acesso estável.

## Capacidades verificadas

| Capacidade | Resultado |
|---|---|
| Busca por termo | ✅ 20 registros na primeira página |
| Data de julgamento | ✅ intervalo `01/08/2026`–`31/08/2026` retornou 12.417 no servidor |
| Data de publicação | ✅ campo e filtro implementados; validar quantitativamente em reteste |
| Relator de acórdão | ✅ vem no resultado; filtro textual do formulário ainda não exposto na CLI |
| Órgão julgador, comarca, classe/assunto | ✅ vêm no resultado |
| 2º grau / Colégios Recursais | ✅ checkboxes separados |
| Acórdão / homologação / decisão monocrática | ✅ checkboxes no crawler |
| Ementa | ✅ íntegra no card, limitada a 10.000 caracteres pelo crawler |
| Paginação | ✅, com `-m/--max-pages` obrigatório para controlar custo |

Exemplos:

```bash
./bin/jur tjsp -q "dano moral" -m 1 --json
./bin/jur tjsp -q "dano moral" -di 01/08/2026 -df 31/08/2026 -m 1 --json
```

Ressalvas: o acesso exige browser e varia conforme o reCAPTCHA. Falha da rodada
é indisponibilidade externa, não ausência de jurisprudência. A CLI mantém
`--json` limpo, sem logs de diagnóstico misturados ao JSON.
