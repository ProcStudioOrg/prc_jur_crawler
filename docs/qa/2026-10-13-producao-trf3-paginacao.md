# Implantação em produção — correções do TRF3

Data: 2026-10-13 (noite). Commit `5605c57`, imagem `jur:5605c57` (`sha256:2a935bf4…`),
release `releases/20261013-213112-5605c57`. Anterior: `20261013-141939-9dbffd7`. Pacote SHA-256 `66fd6483…`
conferido nos dois lados.

## Por que

Um usuário relatou que o TRF3 não funcionou. Na conta dele, a busca das 22:20
("aposentadoria especial metalúrgico", 3 páginas) terminou como `concluido` com 0
resultados em 181s. A busca seguinte (00:13 UTC) trouxe 10. O deploy anterior estava correto.

Causas, vistas na página real pela Kernel:
- a seta "Próxima página" virou ícone com o nome só no `aria-label`, e a paginação parava na página 1;
- o crawler esperava `networkidle`, que o portal quase nunca atinge (~60s por página e timeout intermitente);
- a demora da lista era tratada como zero resultados.

## Validação

| Verificação | Resultado |
|---|---|
| Local via Kernel, 3 páginas | 30 processos distintos, todos com ementa, 142s |
| Local via Kernel, 1 página | 10 em 53s (antes ~100s) |
| Consulta sem resultado | "Nenhum Resultado Encontrado" reconhecido, 0 legítimo em 42s |
| `npm test` | 441/441 |
| Imagem nova, container temporário | 30 em 140s |
| Após a troca: saude · me · painel local · docs · login | 200 · 401 · 404 · 200 · 303 |
| TRF3 real no container no ar, 3 páginas | 30 em 136s |

Backup em `backups/20261013-213112-5605c57/` (SHA256SUMS conferido). `.previous-release` = `20261013-141939-9dbffd7`.
