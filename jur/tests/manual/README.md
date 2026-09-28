# Ensaio ProcStudio completo (manual, somente fixtures locais)

O script `procstudio-sso.js` não faz parte da suíte automática: depende dos três serviços
reais. Ele verifica login por redirecionamento, identidade, logout e troca concorrente do
mesmo código (um 200 e um 401).

Use **banco PostgreSQL de teste isolado**, nunca HML/produção. O Rails precisa estar
publicado em `127.0.0.1:3201`, com a migration da delegação aplicada e estas variáveis:

- `RAILS_ENV=test`
- `JURCRAWLER_CLIENT_ID=jur`
- `JURCRAWLER_CLIENT_SECRET=local-e2e-fixture` (somente fixture local)
- `JURCRAWLER_REDIRECT_URI=http://127.0.0.1:3203/auth/callback`
- `SERVICE_ACCESS_ISSUER=http://127.0.0.1:3201`

No mesmo Rails/test, crie um usuário FactoryBot com email `jur-e2e@example.invalid` e grave
`{id: user.id, token: user.jwt_token}` em JSON temporário com modo 0600. Não imprima o token.
O usuário e o servidor Rails devem usar o mesmo SECRET_KEY_BASE **de teste**.

No worktree ProcStudio/frontend:

```sh
API_URL=http://127.0.0.1:3201 JURCRAWLER_CLIENT_ID=jur JURCRAWLER_REDIRECT_URI=http://127.0.0.1:3203/auth/callback npm run dev -- --host 127.0.0.1 --port 3202
```

No crawler:

```sh
PROCSTUDIO_TEST_USER_FILE=/caminho/privado/fixture.json node jur/tests/manual/procstudio-sso.js
```

O script inicia/encerra o crawler em 3203, usa um diretório SQLite temporário e remove-o
após o ensaio. Ele não chama provedores pagos. Encerre os serviços locais e remova o JSON
após validar. Cookies em portas diferentes do mesmo host neste ensaio não provam regras
cross-domain/HTTPS de HML; essas precisam de QA no ambiente implantado.
