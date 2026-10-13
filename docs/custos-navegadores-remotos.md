# Custos dos navegadores remotos (para repassar ao usuário final)

Registro aberto em 13/10/2026. Os navegadores remotos têm custo por uso, e esse custo
**vai ser repassado aos usuários finais**. Cada nova medição entra na tabela de
lançamentos abaixo.

## Quem paga o quê

| Tribunais | Fornecedor | Cobrança |
|---|---|---|
| TRF3, TST, TRT1–24, CSJT | Kernel (principal) | US$0,06/h de navegador, por segundo. US$5/mês de crédito no plano Developer |
| os mesmos, quando a Kernel falha | Steel (reserva) | US$0,10/h de navegador, por minuto iniciado |
| STJ | Steel com resolvedor de captcha | minutos de navegador + **cada captcha resolvido** |
| demais tribunais | servidor próprio (H2) | sem custo variável |

O desenho está em [navegadores](navegadores.md#navegadores-remotos-kernel-e-steel) e
em [`CLAUDE-STJ.md`](../jur/CLAUDE-STJ.md).

## Lançamentos medidos

Valores do painel da Steel, que **arredonda para o centavo**. O consumo real é a queda do saldo.

| Data/hora | Uso | Minutos | Captchas | Total no painel | O que foi |
|---|---|---|---|---|---|
| 13/10/2026 13h | Steel | 2 min · US$0,00 | 1 · US$0,00 | US$0,01 | sonda do STJ (1 sessão) |
| 13/10/2026 14h | Steel | 3 min · US$0,01 | 4 · US$0,01 | US$0,02 | 4 buscas reais no STJ (2 locais, 1 na imagem nova, 1 em produção) |

Saldo da Steel: **US$35,70 → US$35,68** depois dessas 5 sessões de STJ (US$0,02 de queda).

Os consumos de TRF3 e Falcão da mesma data, tanto na Kernel quanto na Steel, ainda não
foram lidos nos painéis. Ler os dois e lançar aqui.

## Estimativa por busca (revisar com mais dados)

- **STJ**: 5 sessões custaram cerca de US$0,02 a US$0,03. Isso dá cerca de **US$0,005
  por busca** (1 minuto de navegador + 1 captcha). Como os valores vêm arredondados, ainda
  não dá para separar o preço exato do captcha. Medir de novo depois de ~50 buscas.
- **TRF3 pela Kernel**: cerca de 100 s por busca, uns **US$0,0017**.
- **Falcão pela Kernel**: 10 a 20 s por busca, menos de **US$0,0004**.
- Quando a busca cai na reserva Steel, o custo sobe: no mínimo 1 minuto cobrado, US$0,0017.

## Como apurar por usuário

Cada conta tem seu banco, e a tabela `job` já guarda os dados de cada busca:

- `comando`;
- `navegador` (Kernel, Steel, Steel (reserva) ou Servidor ProcStudio);
- `iniciado_em` e `terminado_em`, em milissegundos.

Para o custo por conta, some `terminado_em - iniciado_em` dos jobs com `navegador`
remoto. Multiplique pela tarifa do fornecedor e acrescente um captcha por job do STJ. A
sessão remota abre logo antes do crawler e fecha logo depois, então essa duração é uma
boa aproximação do que é cobrado.

Ainda falta, quando a cobrança for implementada:
- relatório de uso por conta e período;
- regra de repasse (preço por busca ou custo + margem);
- aviso ao usuário de que STJ, TRF3 e Justiça do Trabalho têm custo.
