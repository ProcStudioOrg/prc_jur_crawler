# Verificação no STJ — o passo 1 do checklist NÃO se aplica

O STJ é o caso em que a checagem de número CNJ **atrapalha** em vez de ajudar.

## Por quê

A base de jurisprudência do STJ (SCON) **não indexa número CNJ**. Medido em
25/07/2026: buscar `0000538-97.2015.4.05.8500` no SCON devolve **0**, tanto no
campo livre quanto no campo de processo. O número CNJ que aparece num acórdão do
STJ é o do processo de **origem** — e o segmento (`.8.26.`, `.4.05.`…) é o do
tribunal de origem, não do STJ. Aplicar `cnj.pertenceA()` aqui produz um falso
alerta de alucinação num julgado perfeitamente real.

## Os dois números que valem

| formato | exemplo | onde vive |
|---|---|---|
| recurso por classe | `REsp 1809043`, `AREsp 520189`, `HC 870249` | é o que a citação usa |
| **registro do STJ** | `2019/0116080-0` (ou `201901160800`) | identificador estável; vai nas URLs |

```bash
./bin/jur stj -n "REsp 1809043"        # confirmação FORTE — o julgado, com ementa
./bin/jur stj -n "2019/0116080-0"      # idem, pelo registro
./bin/jur stj -n "0000538-97.2015.4.05.8500"   # cai no DataJud: confirmação FRACA
```

Com número CNJ o `STJChecker` desvia para o **DataJud** (`api_publica_stj`) e
devolve `fonte: "datajud"` com uma `ressalva` explícita: prova que o **processo**
existe no STJ, **não** que o julgado citado (aquela ementa, aquela tese) existe.
Repasse essa ressalva ao usuário — não a esconda.

## Ao ler a resposta

- Um mesmo número devolve **vários julgados**: o recurso principal e os
  incidentes que herdam o número (`EDcl no REsp 1809043`, `AgInt`, `PAFRESP`…).
  Confira o campo `identificacao` — se a citação é `REsp` e só voltou `EDcl`, o
  acórdão citado não é esse.
- O identificador do **documento** é o `registro`, não o número do processo. A
  auditoria (`--verificar N`) compara o registro, e é ele que fecha 5/5.
- `encontrado: false` no SCON não significa inexistente: pode ser **decisão
  monocrática**, que fica na base `DTXT` (`--base monocratica`) e não na de
  acórdãos.

## Ao citar

Se o julgado é **repetitivo ou IAC**, o resultado traz `precedenteQualificado`,
`tema` e `situacaoTema` — cite o tema (`Tema Repetitivo 1023`) e a situação
("Trânsito em Julgado" × "Em Julgamento"), porque tese ainda não transitada não
tem a mesma força. Detalhe do tema: `./bin/jur stj --temas -q "<assunto>"`.

⚠️ O comando abre uma **janela de Chromium**: o Cloudflare do SCON não libera
headless. É esperado, não é falha.
