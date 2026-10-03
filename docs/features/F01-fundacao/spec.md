# F01 — Fundação e contas: spec

> Fonte da verdade: `docs/prd.md` (linha F01 da seção 4, critérios F01-AC01 a F01-AC12, decisões das seções 10 e 11).
> Esta spec fixa as decisões técnicas da feature. Tudo o que está marcado como **interface provida** pode ser consumido pelas features F02–F06 com o nome e a semântica exatos daqui.
> Wave: W1. Consome: nada. Critérios cross-feature com contrato em F01: nenhum (X-01 a X-17 têm contrato em F02–F06); F01 apenas provê o que eles exercitam.

## 1. Escopo

### Entra

- Harness: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `docker-compose.gates.yml`, `scripts/up.sh`, `scripts/down.sh`, `scripts/gates.sh`, `scripts/gates-inner.sh`, `package.json` + `package-lock.json`.
- Processo do app (`src/server.js`): aplica migrações, roda a seed, sobe o HTTP; trata `SIGTERM`.
- Runner de migrações (`src/migrate.js`) e `db/migrations/001_users.sql`.
- Acesso a banco (`src/db.js`), seed (`src/seed.js`), sessão e guardas (`src/auth.js`), layout e páginas de erro (`src/views/layout.js`), IDs (`src/ids.js`), formatação (`src/format.js`), textos (`src/messages.js`).
- Rotas `GET /health`, `GET/POST /signup`, `GET/POST /login`, `POST /logout`.
- Guardas por prefixo: `/org` exige organizador, `/me` exige participante.
- Páginas provisórias (placeholders) para `GET /`, `GET /org/events` e `GET /me/tickets`, registradas **depois** das features, para que login/logout/guardas sejam verificáveis já em F01. F02 e F03 registram as rotas reais antes delas e passam a responder no lugar (ver 5.6).
- Ajudantes de teste (`test/helpers.js`) e testes de F01 (`test/f01-*.test.js`).
- `README.md`.

### Não entra

- Tabelas `events` e `tickets`, vitrine real, área de organizador real, compra, gateway, API de parceiros, check-in, painel, cancelamento (F02–F06).
- Cadastro de organizador (não existe, por decisão do brief).
- Recuperação de senha, edição de perfil, CSRF por token (mitigado por `SameSite=Lax`), invalidação de cookie no servidor (cookie-session é sem estado; o logout limpa o cookie do navegador, um cookie copiado antes do logout continua válido até expirar — limitação aceita).
- Parser JSON global: F01 registra só `express.urlencoded`. A F04 monta o parser JSON dela dentro de `src/features/partner/` (assim decide sozinha como responder `422 invalid_request` a corpo não-JSON).

## 2. Stack e convenções

- Node.js 24 (imagem `node:24-alpine` + `tzdata`), Express 5, `pg`, `cookie-session`, `bcryptjs`. Sem dependências de desenvolvimento.
- **Módulos CommonJS** (`require`/`module.exports`; `package.json` com `"type": "commonjs"`). Todas as features seguem esse padrão.
- HTML renderizado no servidor com template literals; todo valor dinâmico passa por `escapeHtml`.
- Express 5 propaga erros de handlers `async`; o handler de erro final (500) fica em `src/app.js`.

## 3. Configuração (variáveis de ambiente)

| Variável | Onde | Padrão | Uso |
|---|---|---|---|
| `APP_PORT` | host (`up.sh`, Compose) | `3000` | porta publicada: `${APP_PORT:-3000}:3000` |
| `PORT` | container | `3000` | porta em que o Express escuta |
| `DATABASE_URL` | container | `postgres://catraca:catraca@db:5432/catraca` | conexão do `pg.Pool` |
| `TZ` | host → container (app e db) | detectado por `up.sh`; fallback `America/Sao_Paulo` | fuso do processo Node (datas locais) |
| `SESSION_SECRET` | container | `${SESSION_SECRET:-catraca-sessao-local}` | chave do `cookie-session` |
| `PARTNER_API_KEY` | container | `${PARTNER_API_KEY:-catraca-parceiro-2026}` | chave da API de parceiros (consumida por F04) |
| `GATEWAY_FAST_DELAY_MS` | container | `${GATEWAY_FAST_DELAY_MS:-2000}` | consumida por F03 |
| `GATEWAY_SLOW_DELAY_MS` | container | `${GATEWAY_SLOW_DELAY_MS:-65000}` | consumida por F03 |
| `GATEWAY_POLL_MS` | container | `${GATEWAY_POLL_MS:-500}` | consumida por F03 |
| `GATES_PROJECT` | host (`gates.sh`) | ver 4.3 | nome do projeto Compose dos gates |

Não existe `.env` versionado; o Compose resolve todos os padrões acima. Postgres: usuário `catraca`, senha `catraca`, banco `catraca` (gates: banco `catraca_test`). O serviço `db` **não** publica porta no host (evita conflito entre worktrees); acesso manual: `docker compose exec -T db psql -U catraca -d catraca`.

## 4. Harness

### 4.1 `docker-compose.yml` (projeto = nome da pasta; sem chave `name:`)

- `db`: `postgres:17`, env `POSTGRES_USER/PASSWORD/DB=catraca`, `TZ=${TZ:-America/Sao_Paulo}`, volume nomeado `pgdata:/var/lib/postgresql/data`, healthcheck `pg_isready -U catraca -d catraca` (intervalo 2 s).
- `app`: `build: .`, `depends_on: db (condition: service_healthy)`, `ports: "${APP_PORT:-3000}:3000"`, variáveis da seção 3, healthcheck `wget -qO- http://localhost:3000/health`.
- `volumes: pgdata: {}`.

### 4.2 `scripts/up.sh` (bash, `set -euo pipefail`, executável)

1. Verifica `docker` e `curl`; aborta com mensagem se faltar.
2. Fuso: se `TZ` já está no ambiente, usa; senão `timedatectl show -p Timezone --value`; senão o alvo de `readlink -f /etc/localtime` depois de `zoneinfo/`; senão o conteúdo de `/etc/timezone`; senão `America/Sao_Paulo`. Exporta `TZ`.
3. `docker compose up -d --build --remove-orphans`.
4. Faz polling de `curl -fs http://localhost:${APP_PORT:-3000}/health` a cada 1 s por até 180 s. Sucesso: imprime `Catraca no ar em http://localhost:<porta> (TZ=<fuso>)` e sai 0. Timeout: imprime `docker compose logs --tail=100 app` e sai 1.
5. Não deixa processo em segundo plano.

### 4.3 `scripts/down.sh` e `scripts/gates.sh`

- `down.sh`: `docker compose down --remove-orphans` (sem `-v`: o volume `pgdata` é mantido).
- `gates.sh` (bash, executável):
  - Projeto: `GATES_PROJECT` se definido; senão `catraca-gates` quando a pasta do repositório se chama `catraca`; senão `catraca-gates-<slug da pasta>` (minúsculas, `[a-z0-9-]`). Assim worktrees paralelas não derrubam os gates umas das outras. Imprime `gates: projeto <nome>` na primeira linha.
  - `trap` em `EXIT INT TERM` executa `docker compose -p <proj> -f docker-compose.gates.yml down -v --remove-orphans`.
  - `docker compose -p <proj> -f docker-compose.gates.yml build tests`, depois `... run --rm tests`; sai com o código do `run`.
- `docker-compose.gates.yml`: `db` (`postgres:17`, banco `catraca_test`, dados em `tmpfs` — nenhum volume) e `tests` (`build: .`, `depends_on: db healthy`, sem `ports`, `command: sh scripts/gates-inner.sh`, env `DATABASE_URL=postgres://catraca:catraca@db:5432/catraca_test`, `TZ=America/Sao_Paulo`, `SESSION_SECRET=gates`, `PARTNER_API_KEY=catraca-parceiro-2026`, `GATEWAY_FAST_DELAY_MS=200`, `GATEWAY_SLOW_DELAY_MS=1500`, `GATEWAY_POLL_MS=50`).
- `scripts/gates-inner.sh` (roda no container): `set -e`; `find src test -name '*.js' -print0 | xargs -0 -n1 node --check`; depois `node --test --test-concurrency=1 --test-reporter=tap 'test/**/*.test.js'`. Saída TAP termina com `# tests N`, `# pass N`, `# fail 0` quando tudo passa.

### 4.4 `Dockerfile`

`FROM node:24-alpine`; `apk add --no-cache tzdata`; `WORKDIR /app`; copia `package.json` e `package-lock.json`; `npm ci --omit=dev`; `COPY . .`; `ENV NODE_ENV=production PORT=3000`; `CMD ["node","src/server.js"]`. `.dockerignore`: `node_modules`, `.git`, `.env`, `*.log`, `docs`.

O `package-lock.json` é gerado sem `npm install` no host: `docker run --rm -v "$PWD":/app -w /app node:24-alpine npm install --package-lock-only`.

## 5. Modelo de dados e processo

### 5.1 Runner de migrações — `src/migrate.js` (interface provida)

`runMigrations(pool)`:
1. `SELECT pg_advisory_lock(727001)` numa conexão dedicada (evita corrida entre processos de teste).
2. `CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`.
3. Lista `db/migrations/*.sql` que casam com `^\d{3}_[a-z0-9_]+\.sql$`, em ordem lexicográfica.
4. Para cada arquivo cujo nome não está em `schema_migrations.version`: `BEGIN`; executa o conteúdo; `INSERT INTO schema_migrations(version) VALUES ('<nome do arquivo>')`; `COMMIT`. Erro → `ROLLBACK` e o processo sai ≠ 0 (o app não sobe, `up.sh` falha com logs).
5. `pg_advisory_unlock(727001)`.

`version` guarda o nome completo do arquivo (ex.: `001_users.sql`). Migrações já aplicadas nunca são reexecutadas nem editadas; mudança de schema = arquivo novo com o próximo número.

### 5.2 `db/migrations/001_users.sql`

```sql
CREATE TABLE users (
  id            text PRIMARY KEY CHECK (id ~ '^usr_[a-z0-9]{10}$'),
  name          text NOT NULL CHECK (length(btrim(name)) > 0),
  email         text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('participant', 'organizer')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

**Interface provida:** `users.id` é `text` no formato `usr_` + 10 caracteres `[a-z0-9]` (gerado por `newId('usr')`). Colunas que referenciam usuário (`events.organizer_id`, `tickets.user_id`) devem ser `text REFERENCES users(id)`.

### 5.3 `src/db.js` (interface provida)

- `pool`: `new pg.Pool({ connectionString: process.env.DATABASE_URL })`.
- `query(text, params)`: atalho para `pool.query`.
- `withTransaction(fn)`: obtém um client, `BEGIN`, `const r = await fn(client)`, `COMMIT`, retorna `r`; em exceção faz `ROLLBACK` e relança; sempre `client.release()`. Não aplica trava nenhuma: quem precisa (F02, F03, F06) chama `lockEvent(client, id)` como primeiro comando dentro de `fn` (AGENTS.md regra 5).
- Configura `pg.types.setTypeParser(20, v => parseInt(v, 10))`: `bigint` (ex.: `count(*)`, `sum(integer)`) chega como `number`. `timestamptz` chega como `Date`.

### 5.4 `src/seed.js` (interface provida)

`runSeed(pool)`; também executável com `node src/seed.js`. Para cada conta, `INSERT ... ON CONFLICT (email) DO NOTHING` (não altera conta existente). Hash bcrypt (custo 10) gerado na hora.

| Conta | `email` | `name` | `role` | senha |
|---|---|---|---|---|
| Organizador A | `org.a@catraca.local` | `Organizador A` | `organizer` | `catraca123` |
| Organizador B | `org.b@catraca.local` | `Organizador B` | `organizer` | `catraca123` |
| Participante | `participante@catraca.local` | `Participante Seed` | `participant` | `catraca123` |

### 5.5 `src/server.js`

`main()`: `await runMigrations(pool)` → `await runSeed(pool)` → `createApp().listen(PORT)` → log `listening on <PORT>`. Ponto de extensão comentado `// F03: startGatewayWorker()` logo após o `listen` (F03 troca o comentário pela chamada). Em `SIGTERM`/`SIGINT`: `server.close()`, `pool.end()`, `process.exit(0)` (o `docker compose down` não espera os 10 s de timeout). Como `/health` só responde depois do `listen`, `200` em `/health` implica migrações e seed concluídas.

### 5.6 `src/app.js` (interface provida)

`createApp()` monta, nesta ordem:

```js
app.disable('x-powered-by');
app.get('/health', health);                       // antes da sessão: não toca cookie
app.use(express.urlencoded({ extended: false }));
app.use(sessionMiddleware);                       // de src/auth.js
app.use(loadUser);
app.use('/org', requireOrganizer);                // guarda por prefixo (R13)
app.use('/me', requireParticipant);
// --- features: uma linha por feature, nesta ordem ---
app.use(require('./features/accounts/routes'));   // F01
// F02, F03, F04, F05, F06 acrescentam a sua linha aqui
// --- fim das features ---
app.use(require('./features/accounts/placeholders')); // F01: provisórias, sempre por último
app.use(notFound);                                // 404 com layout
app.use(errorHandler);                            // 500 com layout, loga o erro
module.exports = { createApp };
```

`health`: `SELECT 1` no pool → `200` `application/json` `{"status":"ok"}`; falha → `503` `{"status":"error"}`.

Placeholders (`src/features/accounts/placeholders.js`), só alcançados se nenhuma feature respondeu antes:

| Rota | Corpo (dentro do layout) |
|---|---|
| `GET /` | `<h1>Eventos à venda</h1><p>Nenhum evento à venda no momento.</p>` |
| `GET /org/events` | `<h1>Meus eventos</h1><p>Nenhum evento cadastrado.</p>` |
| `GET /me/tickets` | `<h1>Meus ingressos</h1><p>Você ainda não tem ingressos.</p>` |

F02/F03 podem apagar o handler correspondente quando implementarem a rota real; se não apagarem, ele nunca é alcançado.

## 6. Sessão e guardas — `src/auth.js` (interface provida)

- `sessionMiddleware`: `cookieSession({ name: 'catraca_session', keys: [process.env.SESSION_SECRET], httpOnly: true, sameSite: 'lax', secure: false, maxAge: 7 dias })`. Cookie assinado (`catraca_session` + `catraca_session.sig`); cookie sem assinatura válida é ignorado (visitante).
- Sessão guarda só `req.session.userId`.
- `loadUser(req, res, next)`: se há `userId`, `SELECT id, name, email, role FROM users WHERE id=$1`; define `req.user` e `res.locals.user` como `{ id, name, email, role }` ou `null`. Usuário inexistente → `req.session = null` e `req.user = null`.
- `requireOrganizer` / `requireParticipant` (middlewares):

| Situação | Resposta |
|---|---|
| sem `req.user`, método `GET`/`HEAD` | `302` `Location: /login?next=<encodeURIComponent(req.originalUrl)>` |
| sem `req.user`, outro método | `302` `Location: /login` |
| papel errado | `403`, página de erro com título `Acesso negado` e texto `Esta área é restrita a organizadores.` (ou `... a participantes.`); nunca ecoa a URL nem dados de recurso |
| papel certo | `next()` |

- `hashPassword(plain)` → `bcrypt.hash(plain, 10)`; `verifyPassword(plain, hash)` → boolean.
- `safeNext(next, role)` → caminho de destino pós-login: `next` só é aceito se for string que começa com `/` e cujo segundo caractere não é `/` nem `\`. Organizador: `next` aceito só se começar com `/org/`, senão `/org/events`. Participante: `next` aceito se não começar com `/org`, senão `/`.

## 7. Rotas de contas — `src/features/accounts/`

Arquivos: `routes.js` (router Express), `service.js` (`createParticipant`, `authenticate`, `validateSignup`), `views.js` (formulários), `placeholders.js`.

Normalizações: `name` → `trim`; `email` → `trim` + `toLowerCase`. Regex de e-mail: `^[^\s@]+@[^\s@]+\.[^\s@]+$` (PRD seção 11). Senha: mínimo 6 caracteres, sem trim.

| Método e caminho | Quem | Entradas | Resposta |
|---|---|---|---|
| `GET /signup` | qualquer | — | `200`, formulário `<form method="post" action="/signup">` com `name="name"`, `name="email"`, `name="password"` (`type="password"`); sem campo `role` |
| `POST /signup` | qualquer | `name`, `email`, `password` (qualquer outro campo, inclusive `role`, é ignorado) | sucesso: insere `users` com `id=newId('usr')`, `role='participant'` (literal no SQL), `password_hash` bcrypt; `req.session.userId = id`; `302 Location: /`. Erro: `422`, formulário reexibido com `value` de nome e e-mail (escapados; senha nunca reexibida) e as mensagens abaixo; nada inserido |
| `GET /login` | qualquer | `?next=` | `200`, `<form method="post" action="/login">` com `email`, `password` e `<input type="hidden" name="next" value="<next escapado>">` |
| `POST /login` | qualquer | `email`, `password`, `next` | sucesso: `req.session.userId = id`; `302 Location: safeNext(next, role)` (sem `next`: organizador → `/org/events`, participante → `/`). Falha (e-mail inexistente, senha errada, campos vazios): `401`, formulário com `E-mail ou senha inválidos`, e-mail reexibido, sessão não tocada (nenhum `Set-Cookie: catraca_session=`) |
| `POST /logout` | qualquer | — | `req.session = null`; `302 Location: /` |

Erros de cadastro (todos os aplicáveis aparecem juntos):

| Condição | Mensagem (`messages.AUTH`) |
|---|---|
| nome vazio após trim | `Informe seu nome.` |
| e-mail fora do regex | `Informe um e-mail válido.` |
| e-mail já cadastrado (após normalizar) | `Este e-mail já está cadastrado.` |
| senha com menos de 6 caracteres | `A senha deve ter pelo menos 6 caracteres.` |

`authenticate(email, password)`: busca por e-mail normalizado; se não existe, ainda roda `bcrypt.compare` contra um hash fixo (tempo uniforme); retorna o usuário ou `null`.

**Concorrência:** a unicidade de e-mail é garantida pela restrição `UNIQUE` de `users.email`. `createParticipant` faz a checagem prévia (para a mensagem) e, se o `INSERT` falhar com código `23505`, devolve o mesmo erro `Este e-mail já está cadastrado.` (422). Cadastros simultâneos com o mesmo e-mail ⇒ exatamente um `302` e o resto `422`, nunca `500`. A seed usa `ON CONFLICT DO NOTHING`; o runner de migrações usa advisory lock.

Não existe rota de cadastro de organizador: o único `INSERT INTO users` com papel `organizer` está em `src/seed.js`.

## 8. Layout e páginas — `src/views/layout.js` (interface provida)

- `escapeHtml(value)`: `null`/`undefined` → `''`; demais valores via `String(value)` com `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`, `"`→`&quot;`, `'`→`&#39;`.
- `layout({ title, user, body })` → string HTML completa: `<!doctype html>`, `<html lang="pt-BR">`, `<meta charset="utf-8">`, `<title>{title escapado} · Catraca</title>`, `<nav>` e `<main>{body}</main>`. `body` é HTML já montado pelo chamador (que escapa os seus valores).
- Navegação exata:
  - sempre: `<a href="/">Catraca</a>`
  - visitante: `<a href="/login">Entrar</a>` e `<a href="/signup">Criar conta</a>`
  - participante: `<a href="/me/tickets">Meus ingressos</a>`
  - organizador: `<a href="/org/events">Meus eventos</a>`
  - logado: `<span class="user-name">{nome escapado}</span>` e `<form method="post" action="/logout"><button type="submit">Sair</button></form>`
- `sendPage(req, res, { status = 200, title, body })`: `res.status(status).type('html').send(layout({ title, user: req.user, body }))`.
- `sendError(req, res, status, title, message)`: `sendPage` com corpo `<h1>{title}</h1><p>{message}</p>` (ambos escapados; `message` opcional). Usado por 403 (`Acesso negado`), 404 (`Página não encontrada`), 500 (`Erro interno`) e pelas features (ex.: F02 → `sendError(req, res, 404, messages.EVENT_NOT_FOUND)`).

Toda resposta HTML do produto passa por `sendPage`/`layout` (`Content-Type: text/html; charset=utf-8`).

## 9. Utilitários (interfaces providas)

### 9.1 `src/ids.js`

- `randomString(length, alphabet)`: caracteres sorteados com `crypto.randomInt`.
- `newId(prefix)`: `prefix` sem `_` final ganha `_` (`newId('evt')` e `newId('evt_')` → `evt_` + `randomString(10, 'abcdefghijklmnopqrstuvwxyz0123456789')`). Formatos: `usr_…` (F01), `evt_…` (F02), `tkt_…` (F03).
- `CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'` (para `generateTicketCode` de F03).

### 9.2 `src/format.js`

Todas as funções de data usam o fuso do processo (`TZ`).

| Função | Semântica | Exemplos |
|---|---|---|
| `formatBRL(cents)` | inteiro de centavos → `R$ ` (espaço comum, não NBSP) + milhar com `.` + `,` + 2 casas; negativo prefixado com `-` | `35000`→`R$ 350,00`; `0`→`R$ 0,00`; `123456`→`R$ 1.234,56` |
| `parseBRL(str)` | remove `R$` (sem diferenciar maiúsculas) e todos os espaços; aceita `^\d{1,7}([.,]\d{1,2})?$`; retorna centavos inteiros **> 0**; qualquer outra coisa (inclusive `0`, sinal, separador de milhar, mais de 2 casas, não-string) → `null` | `100`,`100,00`,`100.00`,`R$ 100,00`→`10000`; `150,5`→`15050`; `1.234,56`,`10,123`,`abc`,`-5`,`0`→`null` |
| `formatDateTime(date)` | `dd/mm/aaaa HH:mm` (24 h) | `2026-12-06T00:00:00Z` com `TZ=America/Sao_Paulo` → `05/12/2026 21:00` |
| `toIsoWithOffset(date)` | ISO 8601 local com offset `±HH:MM`, sem milissegundos; UTC vira `+00:00` (nunca `Z`) | mesmo instante → `2026-12-05T21:00:00-03:00` |
| `parseDateTimeLocal(str)` | valor de `<input type="datetime-local">` (`AAAA-MM-DDTHH:mm` ou com `:ss`) → `Date` no fuso local; data inexistente ou formato inválido → `null` | `2026-12-05T21:00` → instante `2026-12-06T00:00:00Z` (em São Paulo) |
| `toDateTimeLocalValue(date)` | `Date` → `AAAA-MM-DDTHH:mm` local (para preencher formulário de edição) | |

### 9.3 `src/messages.js`

Objeto congelado (`Object.freeze` recursivo). Nenhum outro arquivo de `src/` contém esses literais (AGENTS.md regra 8).

```js
module.exports = {
  SOLD_OUT: 'Ingressos esgotados',
  CHECKIN: {                       // chaves retornadas por checkInTicket (F05)
    invalid_ticket: 'Ingresso inválido para este evento',
    event_cancelled: 'Evento cancelado',
    not_confirmed: 'Ingresso não confirmado',
    already_used: 'Ingresso já utilizado',
    entry_allowed: 'Entrada liberada',
  },
  API_ERRORS: {                    // valores de "error" na API (F04) e de purchaseTicket (F03)
    unauthorized: 'unauthorized',
    invalid_request: 'invalid_request',
    event_not_available: 'event_not_available',
    sold_out: 'sold_out',
    ticket_not_found: 'ticket_not_found',
  },
  TICKET_STATUS_LABELS: { pending: 'pendente', confirmed: 'confirmado', declined: 'recusado', cancelled: 'cancelado', refunded: 'estornado' },
  EVENT_STATUS_LABELS: { draft: 'rascunho', published: 'publicado', cancelled: 'cancelado' },
  AUTH: {
    LOGIN_INVALID: 'E-mail ou senha inválidos',
    NAME_REQUIRED: 'Informe seu nome.',
    EMAIL_INVALID: 'Informe um e-mail válido.',
    EMAIL_TAKEN: 'Este e-mail já está cadastrado.',
    PASSWORD_TOO_SHORT: 'A senha deve ter pelo menos 6 caracteres.',
    FORBIDDEN: 'Acesso negado',
    ORGANIZERS_ONLY: 'Esta área é restrita a organizadores.',
    PARTICIPANTS_ONLY: 'Esta área é restrita a participantes.',
  },
  PAGE_NOT_FOUND: 'Página não encontrada',
  INTERNAL_ERROR: 'Erro interno',
  EVENT_NOT_FOUND: 'Evento não encontrado',                                   // F02-AC09
  ONLY_PUBLISHED_CAN_CANCEL: 'Só eventos publicados podem ser cancelados',    // F06-AC06
  capacityBelowOccupied: (n) => `A lotação não pode ser menor que as vagas ocupadas (${n})`, // F02-AC08
};
```

Uso dos textos exatos do brief: `SOLD_OUT` na vitrine (F03); `CHECKIN.*` no check-in (F05/F06), selecionado pela chave; `API_ERRORS.*` como valor de `{"error": ...}` (F04) e de `purchaseTicket` (F03); `TICKET_STATUS_LABELS` em "Meus ingressos" (F03/F06). Textos definidos pelo PRD para outras features já ficam aqui para que nenhuma wave precise editar este arquivo.

## 10. Ajudantes de teste — `test/helpers.js` (interface provida)

- `startApp()` → `{ baseUrl, close }`: `runMigrations` + `runSeed` no banco de `DATABASE_URL`, `createApp().listen(0)`. `close()` fecha o servidor. (F03 adiciona a opção de iniciar o worker.)
- `createClient(baseUrl)` → `{ get(path), post(path, form), postJson(path, body, headers), request(method, path, opts) }`: `fetch` com `redirect: 'manual'` e cookie jar (lê `headers.getSetCookie()`); `post` envia `application/x-www-form-urlencoded`.
- `loginAs(client, email, password = 'catraca123')` → `Response` (302).
- `SEED = { orgA: 'org.a@catraca.local', orgB: 'org.b@catraca.local', participant: 'participante@catraca.local', password: 'catraca123' }`.
- `uniqueEmail(prefix)` → `<prefix>.<timestamp><aleatório>@test.local`.
- `query(text, params)` e `endPool()` (reexportam `src/db.js`).

Arquivos de teste seguem `test/<feature>-<assunto>.test.js` (ex.: `test/f02-events.test.js`) e usam e-mails/eventos únicos, sem limpar tabelas (o banco de teste é compartilhado pelos arquivos, executados em série).

## 11. Estrutura de arquivos

```
Dockerfile  .dockerignore  docker-compose.yml  docker-compose.gates.yml
package.json  package-lock.json  README.md
scripts/up.sh  scripts/down.sh  scripts/gates.sh  scripts/gates-inner.sh
db/migrations/001_users.sql
src/server.js  src/app.js  src/db.js  src/migrate.js  src/seed.js  src/auth.js
src/ids.js  src/format.js  src/messages.js  src/views/layout.js
src/features/accounts/routes.js  service.js  views.js  placeholders.js
test/helpers.js
test/f01-harness.test.js     (health, schema_migrations, colunas/restrições de users, seed idempotente)
test/f01-signup.test.js      (cadastro válido, inválidos, role ignorado, concorrência de e-mail)
test/f01-login.test.js       (login, next seguro, login inválido, logout, cookie adulterado)
test/f01-guards.test.js      (guardas /org e /me, 403 sem eco, 404 com layout)
test/f01-layout.test.js      (nav por papel, escapeHtml)
test/f01-units.test.js       (messages literal, format, ids)
```

`package.json` scripts: `"start": "node src/server.js"`, `"up": "./scripts/up.sh"`, `"down": "./scripts/down.sh"`, `"gates": "./scripts/gates.sh"`; `"engines": { "node": ">=24" }`.

## 12. README

Seções: o que é; requisitos (Docker, Git, Node LTS opcional, `curl`); comandos (`./scripts/up.sh`, `./scripts/down.sh`, `./scripts/gates.sh`, `APP_PORT`); endereços (`$WEB` = `$API` = `http://localhost:3000`); contas da seed (3 e-mails e `catraca123`); chave de parceiro padrão `catraca-parceiro-2026` (`PARTNER_API_KEY`); fuso (`TZ`); mapa dos artefatos (`AGENTS.md`, `docs/prd.md`, `docs/brief.md`, `docs/features/<ID>-<slug>/`, `state.json`, `scripts/`, `src/seed.js`, `src/`, `test/`). A seção da API com exemplos `curl` é acrescentada pela F04.

## 13. Interfaces consumidas

Nenhuma.

## 14. Rastreabilidade

| Critério | Onde |
|---|---|
| F01-AC01 | 4.1, 4.2, 5.1, 5.4, 5.5 |
| F01-AC02 | 5.4, 4.3 (`down` sem `-v`) |
| F01-AC03 | 4.3 |
| F01-AC04 | 4.3 |
| F01-AC05, AC06, AC08 | 7 |
| F01-AC07 | 6, 7 |
| F01-AC09 | 5.6, 6 |
| F01-AC10 | 8 |
| F01-AC11 | 9.3 |
| F01-AC12 | 4.2, 12 |
