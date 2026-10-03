# F03 — Vitrine, compra e gateway: spec

> Fonte da verdade: `docs/prd.md` (linha F03 da seção 4, critérios F03-AC01..AC13, X-03, X-04, X-05, seções 10 e 11) e `docs/brief.md` (R02, R03, R05–R09, R11, gateway).
> Wave 3. Pré-requisito: F01 e F02 em `main`. Consumidores: F04 (API), F05 (check-in/painel), F06 (cancelamento).
> Pasta real desta feature: `docs/features/F03-compra/` (o PRD cita `F03-vitrine-compra-gateway`; ver "Divergências com o PRD" no fim).

## 1. Escopo

### Entra

- Migração `db/migrations/003_tickets.sql` (tabela `tickets`).
- Vitrine pública: `GET /` (lista de eventos à venda) e `GET /events/:id` (detalhe + compra).
- Compra pelo participante: `POST /events/:id/purchase`.
- "Meus ingressos": `GET /me/tickets`.
- Serviço de compra reutilizável por canal (`web` e `partner`): `purchaseTicket`, `getTicketById`, `generateTicketCode`, `insertTicket`.
- Gateway simulado: `decideOutcome` (resultado e atraso pelo final do cartão) e worker persistente que resolve ingressos `pending` vencidos com UPDATE condicional.
- Nova implementação de `getSeatStats` (em `src/features/events/repo.js`, arquivo de F02) contando `pending` + `confirmed`.
- Testes automatizados `test/f03-*.test.js`.

### Não entra (fica para outras features ou fora de escopo)

- Rotas `/api/partner/*` e o mapeamento JSON camelCase (F04). F03 só fornece `purchaseTicket(... channel:'partner')` e `getTicketById`.
- Check-in e painel (F05). F03 só cria as colunas `checked_in`/`checked_in_at` com padrão `false`/`NULL`.
- Cancelamento de evento e transições `refunded`/`cancelled` (F06). F03 garante apenas que o worker nunca sobrescreve ingresso que não esteja `pending`.
- Criação/edição/publicação de eventos (F02).
- Mais de um ingresso por compra, cancelamento pelo participante, atualização em tempo real (recarregar basta), paginação.

## 2. Modelo de dados

### `db/migrations/003_tickets.sql`

```sql
CREATE TABLE tickets (
  id              text        PRIMARY KEY CHECK (id ~ '^tkt_[a-z0-9]{10}$'),
  event_id        text        NOT NULL REFERENCES events(id),
  user_id         <tipo de users.id> NULL REFERENCES users(id),   -- mesmo tipo da PK de users (001_users.sql)
  buyer_email     text        NOT NULL,
  code            char(8)     NOT NULL CHECK (code ~ '^[A-Z0-9]{8}$'),
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','confirmed','declined','cancelled','refunded')),
  price_cents     integer     NOT NULL CHECK (price_cents > 0),
  channel         text        NOT NULL CHECK (channel IN ('web','partner')),
  card_last4      char(4)     NOT NULL CHECK (card_last4 ~ '^[0-9]{4}$'),
  gateway_outcome text        NOT NULL CHECK (gateway_outcome IN ('approved','declined')),
  gateway_due_at  timestamptz NOT NULL,
  checked_in      boolean     NOT NULL DEFAULT false,
  checked_in_at   timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tickets_code_key UNIQUE (code),
  CONSTRAINT tickets_channel_user_chk CHECK ((channel = 'web') = (user_id IS NOT NULL))
);

CREATE INDEX tickets_event_status_idx ON tickets (event_id, status);
CREATE INDEX tickets_pending_due_idx  ON tickets (gateway_due_at) WHERE status = 'pending';
CREATE INDEX tickets_user_created_idx ON tickets (user_id, created_at DESC);
```

Notas:

- `<tipo de users.id>` é substituído pelo tipo real da PK definida por F01 em `001_users.sql` (não é fixado pelo PRD).
- O número completo do cartão **nunca** é persistido nem logado; só `card_last4`.
- `buyer_email` é sempre gravado (no canal `web`, o e-mail da conta do participante; no `partner`, o `buyerEmail` normalizado: trim + minúsculas).
- `channel='web'` ⇔ `user_id` preenchido (restrição `tickets_channel_user_chk`). Compras `partner` nunca se vinculam a contas, mesmo com e-mail igual (PRD §11).
- `price_cents` é cópia de `events.price_cents` no momento da compra, lida dentro da trava do evento (R03).
- `status`, `checked_in`, `checked_in_at`, `updated_at` são as colunas que F05 e F06 alteram depois.

## 3. Rotas

Todas as páginas HTML usam `layout({title, user, body})` e `escapeHtml` de F01 em todo valor dinâmico. Para facilitar verificação por `grep`, cada evento da vitrine e cada linha de "Meus ingressos" é renderizada **numa única linha de HTML** com os marcadores abaixo (são interface estável desta feature).

O `id` de evento recebido na URL é validado contra `^evt_[a-z0-9]{10}$` antes de qualquer consulta; fora disso → 404 `Evento não encontrado` (mesmo comportamento de evento inexistente).

### `GET /` — vitrine

- Acesso: qualquer um (visitante, participante, organizador). Status 200.
- Dados: `listOnSaleEvents(pool)` (F02; só `status='published'`, ordenado por `starts_at`) + `getSeatStats(pool, id)` de cada evento (leitura sem trava, apenas exibição).
- Cada evento:
  `<li class="event" data-event-id="evt_…"><a href="/events/evt_…">NOME</a> · <span class="starts-at">dd/mm/aaaa HH:mm</span> · <span class="venue">LOCAL</span> · <span class="price">R$ 100,00</span>[ · <span class="sold-out">Ingressos esgotados</span>]</li>`
  - `<span class="sold-out">` só aparece quando `available <= 0`. Evento esgotado continua listado (PRD §11).
- Sem eventos: `<p class="empty">Nenhum evento à venda no momento.</p>`.
- Participante logado vê também `<a href="/me/tickets">Meus ingressos</a>` no topo da vitrine.
- Rascunho e cancelado nunca aparecem (nome e id ausentes do HTML).
- Se F01 tiver deixado um placeholder em `GET /`, F03 o substitui (remove o placeholder) — a vitrine é a única rota `GET /`.

### `GET /events/:id` — página pública do evento

- Acesso: qualquer um. Evento inexistente, rascunho ou cancelado (`getOnSaleEvent(pool, id)` retorna nulo) → **404** com `Evento não encontrado`, sem nome/local do evento no corpo.
- Corpo (200): nome (`<h1>`), `<p class="starts-at">dd/mm/aaaa HH:mm</p>`, `<p class="venue">LOCAL</p>`, `<p class="price">R$ 100,00</p>`, `<p class="seats">Vagas disponíveis: N</p>` (N = `getSeatStats(...).available`).
- Bloco de compra (exatamente um dos casos, na ordem):
  1. `available <= 0` (qualquer usuário): `<p class="sold-out">Ingressos esgotados</p>`, sem formulário nem link de login.
  2. Visitante: `<a class="login-to-buy" href="/login?next=/events/evt_…">Entrar para comprar</a>`.
  3. Participante: `<form method="post" action="/events/evt_…/purchase"><label>Número do cartão <input name="cardNumber" inputmode="numeric" autocomplete="cc-number" required></label><button type="submit">Comprar</button></form>`.
  4. Organizador: `<p class="buy-hint">Somente participantes compram ingressos.</p>` (sem formulário).

### `POST /events/:id/purchase` — compra na vitrine

- Corpo `application/x-www-form-urlencoded`, campo `cardNumber`.
- Ordem de verificação e respostas:

| Ordem | Situação | Resposta |
|---|---|---|
| 1 | sem sessão (visitante) | **302** `Location: /login?next=/events/:id` (sem criar ingresso) |
| 2 | sessão de organizador | **403** (via `requireParticipant` de F01), página sem formulário de compra |
| 3 | `id` fora do formato | **404** `Evento não encontrado` |
| 4 | corpo ausente (no Express 5 `req.body` pode ser `undefined`), `cardNumber` ausente, não-string (ex.: campo repetido) ou, após remover espaços (`/\s+/g`), fora de `^\d{16}$` | **422**, página do evento reexibida com `<p class="error" role="alert">Número do cartão inválido: informe os 16 dígitos.</p>`; o campo volta vazio (o número nunca é ecoado) |
| 5 | `purchaseTicket` → `event_not_available` | **404** `Evento não encontrado` |
| 6 | `purchaseTicket` → `sold_out` | **409**, página do evento reexibida com `<p class="error" role="alert">Ingressos esgotados</p>` (texto de `messages.js`) e o bloco de compra calculado de novo |
| 7 | `purchaseTicket` → `ok` | **303** `Location: /me/tickets` |

- `buyer = { userId: req.user.id, email: req.user.email }`, `channel = 'web'`.
- A resposta não espera o gateway (o serviço só grava o vencimento; ver §5). Meta: < 1 s.
- Nenhuma resposta desta rota é 500 para entradas malformadas.

### `GET /me/tickets` — Meus ingressos

- Acesso: `requireParticipant` (visitante → 302 `/login?next=/me/tickets`; organizador → 403).
- Consulta: `SELECT t.*, e.name AS event_name, e.starts_at FROM tickets t JOIN events e ON e.id = t.event_id WHERE t.user_id = $1 ORDER BY t.created_at DESC` — só ingressos do usuário logado; compras `partner` (sem `user_id`) nunca aparecem.
- Cada ingresso, numa única linha:
  `<tr class="ticket" data-ticket-id="tkt_…"><td class="ticket-event">NOME DO EVENTO</td><td class="ticket-starts-at">dd/mm/aaaa HH:mm</td><td class="ticket-status" data-status="pending">pendente</td><td class="ticket-code">K7Q2M9XA</td><td class="ticket-price">R$ 100,00</td></tr>`
  - `data-status` = valor do banco; o texto da célula = rótulo de `src/messages.js` (pendente/confirmado/recusado/cancelado/estornado).
- Sem ingressos: `<p class="empty">Você ainda não comprou ingressos.</p>`.
- Recarregar mostra o status atual (sem cache: `Cache-Control: no-store`).

## 4. Funções providas (interfaces para F04, F05, F06)

Todas em `src/features/purchases/service.js`, exceto onde indicado. Seguem o sistema de módulos que F01 adotou (CommonJS ou ESM); os nomes exportados são estes.

### `purchaseTicket({ eventId, buyer: { userId?, email }, cardNumber, channel })`

Retorno: `Promise<{ ok: true, ticket } | { ok: false, error: 'invalid_request' | 'event_not_available' | 'sold_out' }>`.

1. **Validação (fora de transação)** → `invalid_request` se:
   - `channel` não é `'web'` nem `'partner'`;
   - `cardNumber` não é string ou não casa `^\d{16}$` (o serviço **não** remove espaços; a vitrine remove antes de chamar, a API não remove);
   - `buyer.email` não é string ou, após trim, não casa `^[^\s@]+@[^\s@]+\.[^\s@]+$`;
   - `channel='web'` sem `buyer.userId`.
   Assim, `invalid_request` vem antes de `event_not_available` (ordem exigida por F04-AC04).
2. **Transação** `withTransaction(async client => …)`:
   1. `const event = await lockEvent(client, eventId)` — primeira instrução (AGENTS regra 5).
   2. Se `!event` ou `event.status !== 'published'` → `event_not_available` (vem antes de `sold_out`, F04-AC05).
   3. `const { available } = await getSeatStats(client, eventId)`; se `available <= 0` → `sold_out`.
   4. `const { outcome, delayMs } = decideOutcome(cardNumber)`.
   5. `insertTicket(client, { eventId, userId: channel === 'web' ? buyer.userId : null, buyerEmail: email.trim().toLowerCase(), priceCents: event.price_cents, channel, cardLast4: cardNumber.slice(-4), gatewayOutcome: outcome, delayMs })`.
3. `ticket` retornado é a linha de `tickets` como vem do `RETURNING *` (colunas em snake_case: `id`, `code`, `status` = `'pending'`, `event_id`, `price_cents`, `checked_in`, …). F04 mapeia para camelCase.

Erros inesperados (banco fora etc.) são lançados (rejeição da Promise), não convertidos em códigos.

#### Uso por F04 (API de parceiros) — interface final implementada

```js
const { purchaseTicket, getTicketById } = require('../purchases/service'); // src/features/purchases/service.js (CommonJS)

const r = await purchaseTicket({
  eventId: req.params.eventId,                 // string; fora de ^evt_[a-z0-9]{10}$ -> event_not_available
  buyer: { email: body.buyerEmail },           // partner: sem userId; o e-mail é gravado com trim + minúsculas
  cardNumber: body.cardNumber,                 // string de exatamente 16 dígitos (o serviço NÃO remove espaços)
  channel: 'partner',
});
// r.ok === true  -> r.ticket = linha de tickets em snake_case: { id, code, status: 'pending', event_id, checked_in, ... }
// r.ok === false -> r.error é exatamente um destes valores (iguais a messages.API_ERRORS):
```

| `r.error` | Quando | HTTP da API (brief) |
|---|---|---|
| `invalid_request` | `channel` inválido; `cardNumber` não-string ou fora de `^\d{16}$`; `buyer` ausente; `buyer.email` não-string ou fora de `^[^\s@]+@[^\s@]+\.[^\s@]+$` após trim; `channel='web'` sem `buyer.userId`. Verificado **antes** de olhar o evento. | `422 {"error":"invalid_request"}` |
| `event_not_available` | id fora do formato, evento inexistente, `draft` ou `cancelled` (mesmo sem vaga). Lido sob a trava. | `404 {"error":"event_not_available"}` |
| `sold_out` | `getSeatStats(...).available <= 0` dentro da trava. Nenhum ingresso é criado. | `409 {"error":"sold_out"}` |

Corpo JSON não-objeto, campos ausentes ou de tipo errado: F04 pode repassar o que recebeu (`buyer: { email: body && body.buyerEmail }`, `cardNumber: body && body.cardNumber`) — o serviço devolve `invalid_request`. A resposta `202` da API é `{ ticketId: r.ticket.id, code: r.ticket.code, status: r.ticket.status }`. `getTicketById(pool, id)` devolve a linha (snake_case: `id`, `code`, `event_id`, `status`, `checked_in`) ou `null` (inclusive para id malformado) → `404 ticket_not_found`.

### `insertTicket(client, { eventId, userId, buyerEmail, priceCents, channel, cardLast4, gatewayOutcome, delayMs }, generateCode = generateTicketCode)`

Interface provida (nome escolhido aqui; usada por `purchaseTicket` e pelos testes de colisão). Executa
`INSERT INTO tickets (id, event_id, user_id, buyer_email, code, status, price_cents, channel, card_last4, gateway_outcome, gateway_due_at) VALUES ($1,…,'pending',…, now() + make_interval(secs => $n / 1000.0)) ON CONFLICT (code) DO NOTHING RETURNING *`,
com `id = newId('tkt')` e `code = generateCode()` **a cada tentativa** (a primeira inclusive). Se nenhuma linha voltar (colisão de código), tenta de novo com novo `generateCode()` e novo id, até 10 tentativas; depois disso lança erro. Retorna a linha inserida (snake_case). `ON CONFLICT DO NOTHING` evita abortar a transação em colisão. Não verifica vagas — só deve ser chamada dentro da trava (exceto em testes).

### `generateTicketCode()`

Retorna string de 8 caracteres de `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`, cada um sorteado com `crypto.randomInt`. Casa `^[A-Z0-9]{8}$`.

### `getTicketById(client, id)`

`SELECT * FROM tickets WHERE id = $1` → linha (snake_case) ou `null`. `client` pode ser `pool` ou cliente de transação. Id fora de `^tkt_[a-z0-9]{10}$` → `null` sem consultar.

### `getSeatStats(client, eventId)` (nova implementação, arquivo `src/features/events/repo.js` de F02)

Mesma assinatura e mesmo retorno `{ capacity, occupied, available }` (e o mesmo valor para evento inexistente que F02 definiu). Nova consulta:

```sql
SELECT e.capacity,
       count(t.id) FILTER (WHERE t.status IN ('pending','confirmed'))::int AS occupied
FROM events e LEFT JOIN tickets t ON t.event_id = e.id
WHERE e.id = $1
GROUP BY e.capacity;
```

`available = capacity - occupied` (R05 literal, sem `Math.max`). `declined`, `cancelled` e `refunded` não ocupam vaga.

### `src/features/gateway/simulator.js` — `decideOutcome(cardNumber)`

| Final | `outcome` | `delayMs` |
|---|---|---|
| `0001` | `approved` | `GATEWAY_FAST_DELAY_MS` (padrão 2000) |
| `0002` | `declined` | `GATEWAY_FAST_DELAY_MS` |
| `0003` | `approved` | `GATEWAY_SLOW_DELAY_MS` (padrão 65000) |
| `0004` | `declined` | `GATEWAY_SLOW_DELAY_MS` |
| outro | `declined` | `GATEWAY_FAST_DELAY_MS` |

As variáveis são lidas **a cada chamada** (permite teste unitário dos padrões apagando as variáveis no processo do teste). Valor ausente, vazio, não inteiro ou negativo → padrão. Função pura (sem I/O).

### `src/features/gateway/worker.js` — `startGatewayWorker()`

- Idempotente (guarda em módulo: a segunda chamada não cria outro timer). Retorna `{ stop() }`.
- Primeiro ciclo imediatamente ao iniciar (resolve vencidos acumulados enquanto o app estava parado), depois a cada `GATEWAY_POLL_MS` (padrão 500) com `setTimeout` encadeado (ciclos nunca se sobrepõem).
- Ciclo:
  1. `SELECT id, gateway_outcome FROM tickets WHERE status = 'pending' AND gateway_due_at <= now() ORDER BY gateway_due_at LIMIT 200`.
  2. Para cada linha: `UPDATE tickets SET status = $2, updated_at = now() WHERE id = $1 AND status = 'pending'` com `$2 = 'confirmed'` se `approved`, `'declined'` caso contrário (PRD §10, AGENTS regra 6). Ingresso que deixou de ser `pending` entre o SELECT e o UPDATE (ex.: cancelado por F06) não é tocado.
- Erros do ciclo são logados (`console.error`) e o próximo ciclo segue; o worker nunca derruba o processo.
- O vencimento vive no banco (`gateway_due_at`), não em memória: reiniciar o app não perde respostas (F03-AC10).
- Iniciado por `registerPurchases(app)` (abaixo), portanto uma vez por processo do app (PRD §12: uma instância).

### `src/features/purchases/index.js` — `registerPurchases(app)`

Interface provida (nome escolhido aqui). Monta as rotas de §3 e chama `startGatewayWorker()`. É a única linha de F03 em `src/app.js` (no padrão de registro que F01 definiu).

## 5. Concorrência

- Toda compra (web e partner) passa por `purchaseTicket`, que abre `withTransaction` e começa com `lockEvent` (`SELECT … FROM events WHERE id = $1 FOR UPDATE`). Compras do mesmo evento são serializadas nessa linha.
- `getSeatStats` roda **depois** de obter a trava, em instrução separada; em READ COMMITTED cada instrução vê o que as compras anteriores (já commitadas ao liberar a trava) gravaram. Portanto `occupied` nunca passa de `capacity` (R07).
- Nada fora da trava decide compra. A vitrine (`GET /`, `GET /events/:id`) usa `getSeatStats` sem trava apenas para exibir; a decisão é sempre refeita no POST.
- O worker não trava o evento: confirmar não muda `occupied`, recusar só diminui; o UPDATE condicional por linha garante que não sobrescreve `cancelled`/`refunded` de F06 (R11). Se F06 commitar antes, o UPDATE do worker reavalia `status = 'pending'` e afeta 0 linhas.
- Edição de lotação (F02) também trava o evento e usa o mesmo `getSeatStats`, então a lotação nunca fica abaixo das vagas ocupadas reais (X-05).

## 6. Interfaces consumidas

| De | Interface | Uso em F03 |
|---|---|---|
| F01 | `pool`, `withTransaction(fn)` (`src/db.js`) | consultas e transação da compra |
| F01 | `requireParticipant`, `req.user` (`id`, `email`, `name`, `role`) (`src/auth.js`) | `/me/tickets`, compra (organizador → 403) |
| F01 | `layout({title, user, body})`, `escapeHtml` (`src/views/layout.js`) | todas as páginas |
| F01 | `newId('tkt')` (`src/ids.js`) | id do ingresso (`tkt_` + 10 `[a-z0-9]`) |
| F01 | `formatBRL(cents)`, `formatDateTime(date)` (`src/format.js`) | preço e data |
| F01 | `src/messages.js`: `Ingressos esgotados` e rótulos de status | vitrine, compra, Meus ingressos |
| F01 | `/login?next=…` (redireciona de volta ao `next` após login de participante) | link "Entrar para comprar", X-03 |
| F01 | runner de migrações | aplica `003_tickets.sql` |
| F02 | tabela `events` (`id`, `organizer_id`, `name`, `starts_at`, `venue`, `capacity`, `price_cents`, `status`, …) | FK e leitura |
| F02 | `lockEvent(client, eventId)` → linha do evento (com `status`, `price_cents`, `capacity`) ou nulo | trava da compra (assume-se que retorna a linha; se F02 retornar só o id, F03 relê a linha com o mesmo `client` após a trava) |
| F02 | `getSeatStats(client, eventId)` | substituída por F03 (mesma assinatura) |
| F02 | `listOnSaleEvents(client)`, `getOnSaleEvent(client, eventId)` | vitrine e página do evento |

## 7. Configuração (variáveis de ambiente)

| Variável | Padrão | Uso |
|---|---|---|
| `GATEWAY_FAST_DELAY_MS` | `2000` | atraso de `0001`, `0002` e outros finais |
| `GATEWAY_SLOW_DELAY_MS` | `65000` | atraso de `0003`, `0004` |
| `GATEWAY_POLL_MS` | `500` | intervalo do worker |

O modo padrão (avaliador) não define nenhuma delas. Os gates definem valores menores para o app de teste (ex.: `300` / `1500` / `100`); ver plano, etapa 1.

## 8. Estrutura de arquivos

```
db/migrations/003_tickets.sql
src/features/events/repo.js            (alterado: só o corpo de getSeatStats)
src/features/purchases/index.js        registerPurchases(app)
src/features/purchases/service.js      purchaseTicket, insertTicket, generateTicketCode, getTicketById
src/features/purchases/routes.js       GET /, GET /events/:id, POST /events/:id/purchase, GET /me/tickets
src/features/purchases/views.js        storefrontPage, eventPage, myTicketsPage, notFoundPage; CARD_INVALID_MESSAGE
src/features/gateway/simulator.js      decideOutcome
src/features/gateway/worker.js         startGatewayWorker
src/app.js                             (alterado: uma linha registerPurchases(app))
test/f03-helpers.js                    utilitários de teste (sessões, criação de evento via SQL, espera de status)
test/f03-simulator.test.js             unitário de decideOutcome
test/f03-vitrine.test.js               AC01, AC02, AC05 (página)
test/f03-compra.test.js                AC03, AC04, AC05 (POST), AC13
test/f03-gateway.test.js               AC06, AC07, AC09, AC10
test/f03-concorrencia.test.js          AC08
test/f03-meus-ingressos.test.js        AC11, AC12
test/f03-cross.test.js                 X-03, X-04, X-05
```

## 9. Textos

| Texto | Origem | Onde aparece |
|---|---|---|
| `Ingressos esgotados` | `src/messages.js` (brief R07, literal) | vitrine (`span.sold-out`), página do evento (`p.sold-out`), resposta 409 (`p.error`) |
| `pendente`, `confirmado`, `recusado`, `cancelado`, `estornado` | `src/messages.js` (rótulos do brief) | `/me/tickets`, célula `td.ticket-status` |
| `Número do cartão inválido: informe os 16 dígitos.` | `views.js` (texto de F03, não é do brief) | resposta 422 |
| `Evento não encontrado` | mesmo texto de F02 (404) | 404 da vitrine e da compra |
| `Entrar para comprar`, `Somente participantes compram ingressos.`, `Nenhum evento à venda no momento.`, `Você ainda não comprou ingressos.`, `Vagas disponíveis: N` | `views.js` | vitrine / evento / Meus ingressos |

F03 não reescreve nem duplica nenhum texto do brief: importa de `messages.js`.

## 10. Divergências com o PRD e nomes escolhidos aqui

- O PRD (§4) cita a pasta `docs/features/F03-vitrine-compra-gateway`; a pasta existente é `docs/features/F03-compra` (o mesmo vale para as demais features). Usada a existente.
- Nomes escolhidos por F03 (o PRD não fixa) e providos às próximas features: `registerPurchases(app)`, `insertTicket(...)`, arquivos `routes.js`/`views.js`/`index.js` em `src/features/purchases/`, campo de formulário `cardNumber`, constraint `tickets_code_key`, marcadores HTML (`li.event[data-event-id]`, `p.seats`, `.sold-out`, `tr.ticket[data-ticket-id]`, `td.ticket-status[data-status]`, `td.ticket-code`), códigos HTTP da vitrine (303/404/409/422), `startGatewayWorker()` retorna `{stop()}`.
- O PRD não diz o que `lockEvent` retorna; F03 assume a linha do evento (§6).
- F03-AC08 e o passo 15 do brief usam a API, que só existe em F04 (wave 4). O contrato de F03 prova R07 por 30 POSTs simultâneos na vitrine e por 30 chamadas simultâneas de `purchaseTicket`.

## 11. Desvios da implementação (registrados no PR da F03)

- **`docker-compose.yml` sem `GATEWAY_*`.** A spec de F01 definia as três variáveis no serviço `app` com os valores padrão; o pré-requisito do contrato de F03 exige `docker compose exec -T app printenv | grep -c '^GATEWAY_'` = `0` e o plano (etapa 1) diz que o app de `up.sh` não recebe essas variáveis. Removidas do Compose padrão; o app usa os padrões do brief (2000 / 65000 / 500 ms) quando elas não existem. Os gates continuam definindo `200` / `1500` / `50` em `docker-compose.gates.yml` (valores de F01, em vez dos `300` / `1500` / `100` sugeridos no plano — mesmo efeito).
- **`getSeatStats`** usa `count(*) FILTER (WHERE t.status IN ('pending','confirmed'))` em vez de `count(t.id) FILTER (...)`: o teste de F02-AC08 cria uma tabela `TEMP tickets (event_id, status)` sem coluna `id`, que sombreia a real. Resultado idêntico com a tabela real.
- **`insertTicket`** usa `ON CONFLICT DO NOTHING` (sem alvo): cobre colisão de `code` e, por tabela, a (improvável) colisão de `id`; nos dois casos tenta de novo com id e código novos, até 10 vezes.
- **`purchaseTicket`** devolve `event_not_available` sem abrir transação quando o `eventId` não é string no formato `^evt_[a-z0-9]{10}$` (resultado igual ao de evento inexistente). Para ids no formato, a primeira instrução da transação continua sendo `lockEvent`.
- **`lockEvent`** de F02 devolve a linha inteira do evento (`SELECT * ... FOR UPDATE`), como §6 assumia.
- **Worker**: além de `registerPurchases(app)`, `src/server.js` chama `startGatewayWorker()` (idempotente, devolve o mesmo controle) para poder pará-lo no `SIGTERM`. Os timers usam `unref()` e o worker para sozinho quando o `pool` é encerrado (processos de teste terminam limpos). Exporta também `resolveDueTickets(client)` (um ciclo; usado nos testes).
- **`<title>` da página do evento é genérico (`Evento`)** e o 404 de evento usa o título `Página não encontrada` com `<h1>Evento não encontrado</h1>`: assim o nome do evento e o texto `Evento não encontrado` aparecem uma única vez no HTML, como contam os itens C03/C04 do contrato (`grep -c`).
- **422 de cartão inválido para evento que não está à venda**: sem página de evento para reexibir, responde 422 com a página de erro genérica e a mesma mensagem do cartão.
- `service.js` exporta também `listTicketsForUser(client, userId)` (consulta de "Meus ingressos"), `isValidCardNumber` e `isValidEmail`.
- Nenhum desvio em relação ao brief.

