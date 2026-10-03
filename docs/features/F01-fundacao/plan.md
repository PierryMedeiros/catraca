# F01 — Fundação e contas: plano de implementação

> Implementa `spec.md` desta pasta. Branch sugerida: `feat/f01-fundacao`. Cada etapa termina com uma verificação objetiva; não avance com a anterior quebrada.
> Não é preciso `npm install` no host: tudo roda em containers. Comandos a partir da raiz do repositório.

## Etapa 1 — Esqueleto Node e imagem

Arquivos: `package.json`, `package-lock.json`, `Dockerfile`, `.dockerignore`.

1. `package.json` com `"name": "catraca"`, `"private": true`, `"type": "commonjs"`, `"engines": {"node": ">=24"}`, dependências `express@^5`, `pg@^8`, `cookie-session@^2`, `bcryptjs@^3` e os scripts da spec (seção 11).
2. Gerar o lock sem tocar o host: `docker run --rm -v "$PWD":/app -w /app node:24-alpine npm install --package-lock-only`.
3. `Dockerfile` e `.dockerignore` conforme spec 4.4.

Verificar: `docker build -t catraca-f01-check . && docker run --rm catraca-f01-check node -e "require('express');require('pg');require('cookie-session');require('bcryptjs');console.log('ok')"` imprime `ok`.

## Etapa 2 — Banco, servidor mínimo e /health

Arquivos: `docker-compose.yml`, `src/db.js`, `src/app.js` (só `/health`, 404 e 500 por enquanto), `src/server.js`.

1. Compose conforme spec 4.1 (sem `name:`, `db` sem porta publicada, variáveis da seção 3 com os padrões).
2. `src/db.js`: `pool`, `query`, `withTransaction`, parser de `bigint`.
3. `src/server.js`: `createApp().listen(PORT)` e tratamento de `SIGTERM`/`SIGINT`.

Verificar: `docker compose up -d --build` e, após alguns segundos, `curl -s localhost:3000/health` → `{"status":"ok"}`; `docker compose down` termina em menos de 5 s.

## Etapa 3 — Scripts up/down

Arquivos: `scripts/up.sh`, `scripts/down.sh` (`chmod +x`; o bit executável precisa ir para o Git: `git update-index --chmod=+x` se necessário).

Verificar: `./scripts/up.sh; echo $?` → imprime `Catraca no ar em http://localhost:3000 (TZ=...)` e `0`; `TZ=America/Recife ./scripts/up.sh && docker compose exec -T app printenv TZ` → `America/Recife`; `./scripts/down.sh && docker compose ps -aq | wc -l` → `0`; `docker volume ls -q | grep _pgdata` ainda lista o volume. `APP_PORT=3101 ./scripts/up.sh` responde em `localhost:3101/health`.

## Etapa 4 — Runner de migrações e tabela users

Arquivos: `src/migrate.js`, `db/migrations/001_users.sql`, `src/server.js` (chama `runMigrations` antes do `listen`).

Verificar: `./scripts/up.sh && docker compose exec -T db psql -U catraca -d catraca -tAc "SELECT version FROM schema_migrations"` → `001_users.sql`; `docker compose restart app`, esperar `/health`, a contagem de `schema_migrations` continua `1`; `\d users` mostra as 6 colunas e as restrições da spec 5.2.

## Etapa 5 — Utilitários: messages, ids, format

Arquivos: `src/messages.js`, `src/ids.js`, `src/format.js`.

1. `messages.js` exatamente como a spec 9.3 (copiar os literais do brief, conferir acentos), com congelamento recursivo.
2. `ids.js` e `format.js` conforme spec 9.1 e 9.2. `formatBRL` sem `Intl` (o `Intl` usa NBSP após `R$`).

Verificar: `docker compose exec -T app node -e "const f=require('./src/format');console.log(f.formatBRL(123456), f.parseBRL('150,5'), require('./src/ids').newId('evt'))"` (após rebuild) → `R$ 1.234,56 15050 evt_xxxxxxxxxx`.

## Etapa 6 — Layout e páginas de erro

Arquivos: `src/views/layout.js`, `src/app.js` (`notFound` e `errorHandler` usando `sendError`).

Verificar: `curl -s -i localhost:3000/nao-existe` → `404`, `Content-Type: text/html; charset=utf-8`, corpo com `<!doctype html>`, `<nav>`, `Página não encontrada`, links `Entrar` e `Criar conta`.

## Etapa 7 — Sessão, loadUser e guardas

Arquivos: `src/auth.js`, `src/app.js` (sessão, `loadUser`, guardas por prefixo, linha da feature `accounts`, placeholders por último), `src/features/accounts/placeholders.js`.

Verificar: `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' localhost:3000/org/events` → `302 http://localhost:3000/login?next=%2Forg%2Fevents`; o mesmo para `/me/tickets`; `curl -s localhost:3000/` mostra o placeholder `Eventos à venda`.

## Etapa 8 — Cadastro, login e logout

Arquivos: `src/features/accounts/service.js`, `views.js`, `routes.js`.

1. `validateSignup`, `createParticipant` (checagem prévia + captura de `23505`), `authenticate` (tempo uniforme).
2. Rotas da spec seção 7, com `safeNext` de `src/auth.js`.

Verificar com cookie jar: `curl -s -c /tmp/j -b /tmp/j -o /dev/null -w '%{http_code} %{redirect_url}\n' -X POST localhost:3000/signup --data-urlencode name=Ana --data-urlencode email=ana.$(date +%s)@example.com --data-urlencode password=segredo1` → `302 http://localhost:3000/`; `curl -s -b /tmp/j localhost:3000/ | grep -o 'user-name">Ana<'` encontra; cadastro com senha `123` → `422`.

## Etapa 9 — Seed

Arquivos: `src/seed.js`, `src/server.js` (chama `runSeed` depois das migrações).

Verificar: `./scripts/up.sh`, depois `SELECT email, role FROM users ORDER BY email` mostra as 3 contas; `./scripts/down.sh && ./scripts/up.sh` mantém exatamente 3 linhas para esses e-mails; login de `org.a@catraca.local`/`catraca123` → `302` para `/org/events`.

## Etapa 10 — Infra dos gates

Arquivos: `docker-compose.gates.yml`, `scripts/gates.sh`, `scripts/gates-inner.sh`, `test/helpers.js`.

1. Compose dos gates conforme spec 4.3 (`tmpfs` no Postgres, sem `ports`, sem volumes).
2. `gates.sh` com nome de projeto derivado, `trap` de limpeza e código de saída do `run`.
3. `test/helpers.js` conforme spec seção 10.

Verificar: com um teste trivial `test/f01-units.test.js` presente, `./scripts/gates.sh; echo $?` → saída TAP com `# fail 0` e `0`; depois, `docker ps -aq --filter label=com.docker.compose.project=catraca-gates | wc -l` → `0` e `docker volume ls -q --filter label=com.docker.compose.project=catraca-gates | wc -l` → `0` (use o nome impresso na primeira linha, se a pasta não se chamar `catraca`).

## Etapa 11 — Testes automatizados de F01 (rodam em `./scripts/gates.sh`)

Todos com `node:test` + `node:assert/strict`, app em processo via `startApp()`, e-mails únicos via `uniqueEmail()`.

| Arquivo | Casos (critério) |
|---|---|
| `test/f01-harness.test.js` | `GET /health` → 200 `{"status":"ok"}` (AC01); `schema_migrations` contém `001_users.sql` e rodar `runMigrations` de novo não muda a contagem (AC01); colunas de `users` via `information_schema` e restrições: e-mail com maiúscula, `role='admin'` e e-mail duplicado são rejeitados pelo banco (AC01); `runSeed` chamado 2× mantém `count(*)=3` para os e-mails da seed e as 3 contas entram (AC02) |
| `test/f01-signup.test.js` | cadastro válido → 302 `/`, `role='participant'`, `password_hash` casa `^\$2[aby]\$10\$`, e-mail gravado em minúsculas, home mostra nome e `Sair` (AC05); nome vazio, 3 e-mails inválidos, e-mail duplicado com maiúsculas/espaços, senha de 5 caracteres, corpo vazio → 422 com a mensagem certa e contagem de `users` inalterada (AC06); `role=organizer` no corpo cria participante e `GET /signup` não tem `name="role"` (AC08); 10 cadastros simultâneos com o mesmo e-mail (`Promise.all`) → 1×302 e 9×422, 1 linha; repetido 3× com e-mails novos (AC06) |
| `test/f01-login.test.js` | organizador → 302 `/org/events`, participante → 302 `/`, e-mail com maiúsculas/espaços aceito (AC07); `next` válido e inválido (`//x`, `https://x`, `/\x`, participante com `/org/...`, organizador com `/events/...`) (AC07); senha errada, e-mail inexistente e campos vazios → 401 com `E-mail ou senha inválidos` e sem `Set-Cookie: catraca_session=` (AC07); logout → 302 `/` e em seguida `GET /org/events` → 302 `/login?next=%2Forg%2Fevents` (AC07); cookie `catraca_session` forjado sem assinatura → tratado como visitante (AC09) |
| `test/f01-guards.test.js` | visitante: `GET /org/events`, `GET /org/events/evt_qualquer123` → 302 com `next` codificado; `POST /org/events` → 302 `/login`; participante → 403 com `Acesso negado` e sem `evt_qualquer123` no corpo; organizador → 200 em `/org/events`; `/me/tickets`: visitante 302, organizador 403, participante 200 (AC09) |
| `test/f01-layout.test.js` | nav de visitante, participante e organizador (links e `user-name`) em `/`, `/login`, `/signup` e no 404 (AC10); nome `<script>x</script>` e `Ana "A" & B` aparecem escapados; e-mail `"><img src=x>` reexibido escapado no 422 (AC10); `escapeHtml(null)===''` |
| `test/f01-units.test.js` | `messages.js` comparado literalmente com os textos do brief e do PRD, e `Object.isFrozen` (AC11); `formatBRL`, `parseBRL` (todos os exemplos de F02-AC03), `formatDateTime`/`toIsoWithOffset`/`parseDateTimeLocal` com `TZ=America/Sao_Paulo` (o compose dos gates fixa esse fuso), `newId` (regex e 10 000 ids distintos) |

Verificar: `./scripts/gates.sh; echo $?` → `0`, `# fail 0`, `# pass` ≥ 25. Quebrar de propósito uma asserção → saída ≠ 0; desfazer.

## Etapa 12 — README

Arquivo: `README.md` conforme spec seção 12.

Verificar: `for s in ./scripts/up.sh ./scripts/down.sh ./scripts/gates.sh http://localhost:3000 '$WEB' '$API' APP_PORT org.a@catraca.local org.b@catraca.local participante@catraca.local catraca123 catraca-parceiro-2026 AGENTS.md docs/prd.md docs/features/ state.json src/seed.js; do grep -qF -- "$s" README.md || echo "FALTA $s"; done` não imprime nada.

## Etapa 13 — Verificação manual com o app rodando

1. `./scripts/down.sh; ./scripts/up.sh` (sai 0 e imprime a URL).
2. Num navegador ou com `curl` + cookie jar: criar conta em `/signup`, ver nome e `Sair` na home, sair, entrar como `org.a@catraca.local` e cair em `/org/events`, abrir `/me/tickets` como organizador (403), sair, abrir `/org/events` (vai ao login com `next`), entrar como `participante@catraca.local` com `next=/org/events` (vai a `/`).
3. `grep -rn "Ingressos esgotados\|Entrada liberada\|E-mail ou senha inválidos" src/ | grep -v src/messages.js` → vazio.
4. Percorrer os itens F01-C01 a F01-C27 de `contract.md` num clone limpo (é o que o avaliador fará).
5. `./scripts/gates.sh` passa; `./scripts/down.sh` deixa `docker compose ps -aq` vazio.
6. Atualizar `state.json` (F01 → `implemented`, `branch`), commitar por caminho em Conventional Commits e abrir o PR.
