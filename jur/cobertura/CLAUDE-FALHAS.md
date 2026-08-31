# CLAUDE-FALHAS — exceções operacionais

> **Gerado por `node cobertura/build.js`. Não editar à mão.**
> Dentro do catálogo do `jur`, tudo o que não aparece aqui é operacional.
> Leia o guia do tribunal antes de montar qualquer comando.

| Tribunal | Estado | Comando | Motivo | Guia |
|---|---|---|---|---|
| STJ | sem-acesso | `jur stj` | Desafio interativo do Cloudflare; não automatizamos captcha. | [CLAUDE-STJ.md](../CLAUDE-STJ.md) |
| TRF1 | instavel | `jur trf1` | Crawler responde, mas a base está congelada desde 31/07/2025. | [CLAUDE-TRF1.md](../CLAUDE-TRF1.md) |
| TRF3 | instavel | `jur trf3` | Host oscila ou fica inacessível mesmo antes da interação. | [CLAUDE-TRF3.md](../CLAUDE-TRF3.md) |
| TJAC | instavel | `jur tjac` | Busca zerou termos amplos em medições repetidas; inteiro teor exige reCAPTCHA. | [CLAUDE-TJAC.md](../CLAUDE-TJAC.md) |
| TJAM | instavel | `jur tjam` | Crawler responde, mas a base estadual está congelada em 2025. | [CLAUDE-TJAM.md](../CLAUDE-TJAM.md) |
| TJMA | sem-acesso | `jur tjma` | Busca por termo bloqueada por captcha; `-n` usa apenas o DataJud. | [CLAUDE-TJMA.md](../CLAUDE-TJMA.md) |
| TJPB | instavel | `jur tjpb` | API pública respondeu HTTP 503 em medições consecutivas. | [CLAUDE-TJPB.md](../CLAUDE-TJPB.md) |
| TJRN | sem-acesso | `jur tjrn` | Domínio bloqueado por 403/Akamai; `-n` confirma somente o processo. | [CLAUDE-TJRN.md](../CLAUDE-TJRN.md) |
| TJSC | instavel | `jur tjsc` | Portal novo bloqueado pela verificação F5/Shape nesta rodada; o legado está congelado. | [CLAUDE-TJSC.md](../CLAUDE-TJSC.md) |
| TJSE | sem-acesso | — | Os dois módulos exigem captcha e não há comando de busca. | [CLAUDE-TJSE.md](../CLAUDE-TJSE.md) |
| TJSP | instavel | `jur tjsp` | Incerto: o reCAPTCHA invisível permite o fluxo em alguns dias e bloqueia em outros. | [CLAUDE-TJSP.md](../CLAUDE-TJSP.md) |
| CRPS | exige-sessao | `jur crps` | Exige sessão Gov.br em dispositivo validado; busca autônoma indisponível. | [CLAUDE-CRPS.md](../CLAUDE-CRPS.md) |

Tribunal ausente do catálogo não é falha operacional conhecida: é alvo ainda não implementado e deve constar em [`../../TODO.md`](../../TODO.md).
