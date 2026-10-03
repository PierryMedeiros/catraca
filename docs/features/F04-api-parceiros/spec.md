# F04 — API de parceiros: spec

> Fonte da verdade: `docs/prd.md` (seção 4, linha F04; critérios F04-AC01–AC10; X-06, X-07, X-08; decisões das seções 10 e 11) e `docs/brief.md` ("API de parceiros (contrato fixo)", R02, R05–R09).
> Wave 4, em paralelo com F05. Branch própria, PR próprio (P-04).

## 1. Escopo

### Entra

- As três rotas do contrato fixo do brief, sob `/api/partner`:
  - `GET /api/partner/events`
  - `POST /api/partner/events/:eventId/purchases`
  - `GET /api/partner/tickets/:ticketId`
- Middleware `requireApiKey` (cabeçalho `X-Api-Key` contra `PARTNER_API_KEY`).
- Validação do corpo da compra (ordem 401 → 422 → 404 → 409) e mapeamento dos erros de `purchaseTicket` para status HTTP.
- Respostas JSON em todos os casos, inclusive corpo malformado, rota desconhecida sob `/api/partner` e erro interno.
- Seção "API de parceiros" no README (`$API`, `$KEY`, exemplos `curl`, tabela de erros).
- Testes automatizados em `test/` que rodam em `./scripts/gates.sh`.

### Não entra

- Regras de compra, trava de lotação, geração de código, gateway e worker: são de F03 (`purchaseTicket`, `startGatewayWorker`). F04 só chama.
- Cálculo de vagas: é de F02/F03 (`getSeatStats`). F04 não recalcula.
- Check-in, painel (F05) e cancelamento de evento (F06). F04 não toca `src/features/checkin/`, a view de gestão nem `src/features/events/views.js`.
- Migrações: F04 **não cria migração** (PRD seção 10, "Rotas e conflitos"). Todas as colunas necessárias existem desde F02/F03.
- Paginação, várias chaves de parceiro, limitação de taxa, CORS, vínculo de compra da API a conta de participante (PRD seção 11 e 12).
- Alterar `src/messages.js`: os códigos de erro já estão lá desde F01 (F01-AC11).

## 2. Modelo de dados

Nenhuma alteração de esquema. F04 lê e (via `purchaseTicket`) escreve nas tabelas existentes:

| Tabela | Colunas usadas por F04 | Origem |
|---|---|---|
| `events` | `id`, `name`, `starts_at` (timestamptz), `price_cents`, `capacity`, `status` | F02, `002_events.sql` |
| `tickets` | `id`, `code`, `event_id`, `status`, `checked_in`, `channel`, `buyer_email`, `user_id`, `card_last4`, `price_cents` | F03, `003_tickets.sql` |

Valores gravados por uma compra da API (feitos por `purchaseTicket`, verificados por F04): `channel='partner'`, `user_id IS NULL`, `buyer_email` = e-mail normalizado (trim + minúsculas), `card_last4` = 4 últimos dígitos, `status='pending'`, `price_cents` = `events.price_cents` vigente no momento da compra.

## 3. Rotas

Todas montadas em um único `express.Router` em `/api/partner`. Ordem dos middlewares no router:

1. `requireApiKey` (para **toda** requisição sob `/api/partner`, inclusive caminhos desconhecidos).
2. Parser JSON só na rota de compra: `express.json({ type: () => true, limit: '10kb' })` (aceita o corpo como JSON independentemente do `Content-Type`; corpo vazio deixa `req.body` indefinido).
3. Handlers das três rotas.
4. Fallback 404 JSON para caminho/método desconhecido.
5. Handler de erro de 4 argumentos do router (erros de parse → 422; demais → 500).

Todas as respostas: `Content-Type: application/json; charset=utf-8` (via `res.status(n).json(obj)`), `Cache-Control: no-store`. Corpos de erro são sempre exatamente `{"error":"<código>"}` (JSON compacto, sem espaços, sem outros campos).

### 3.1 Autenticação — todas as rotas

| Situação | Resposta |
|---|---|
| Cabeçalho `X-Api-Key` ausente | `401` `{"error":"unauthorized"}` |
| Cabeçalho presente com valor vazio, diferente da chave (inclusive só diferença de maiúsculas, prefixo/sufixo), ou `PARTNER_API_KEY` não configurada/vazia no servidor | `401` `{"error":"unauthorized"}` |
| Chave igual a `PARTNER_API_KEY` | segue para a rota |

- Comparação em tempo constante: `crypto.timingSafeEqual(sha256(recebida), sha256(esperada))`.
- A chave só é aceita no cabeçalho `X-Api-Key` (nome do cabeçalho é case-insensitive pelo HTTP). Query string, cookie de sessão ou outro cabeçalho não autenticam: organizador logado sem `X-Api-Key` recebe 401.
- 401 vem **antes** de qualquer outra validação (F04-AC01): corpo inválido, evento inexistente ou ingresso inexistente sem chave → 401, e o banco não muda.
- A chave nunca é escrita em log.

### 3.2 `GET /api/partner/events`

- Quem acessa: parceiro com chave válida.
- Entrada: nenhuma (query string ignorada).
- Implementação: `listOnSaleEvents(pool)` (F02; só `status='published'`, ordenados por `starts_at`) e, para cada evento, `getSeatStats(pool, event.id).available` (F03; `capacity − (pending + confirmed)`). Leitura sem trava (informativa; nenhuma decisão de compra é tomada aqui).
- Resposta `200`, array (vazio `[]` se não houver eventos à venda). Cada item tem **exatamente** estas chaves, nesta ordem:

```json
{ "id": "evt_8f2k3m9q1z", "name": "Jazz no Porão", "startsAt": "2026-12-05T21:00:00-03:00", "priceCents": 10000, "availableSeats": 2 }
```

| Campo | Origem | Regra |
|---|---|---|
| `id` | `events.id` | string |
| `name` | `events.name` | string, sem escape HTML (JSON puro) |
| `startsAt` | `toIsoWithOffset(events.starts_at)` (F01) | `YYYY-MM-DDTHH:MM:SS±HH:MM`, offset do `TZ` do container |
| `priceCents` | `Number(events.price_cents)` | inteiro (garantir `Number` mesmo que o driver devolva string) |
| `availableSeats` | `getSeatStats(...).available` | inteiro; `0` quando esgotado — evento esgotado **continua listado** (PRD seção 11) |

- Rascunho e cancelado não aparecem (R02, R11).

### 3.3 `POST /api/partner/events/:eventId/purchases`

- Quem acessa: parceiro com chave válida.
- Entrada: corpo JSON `{"buyerEmail": string, "cardNumber": string}`; campos extras são ignorados.
- Ordem de verificação (brief; F04-AC04, AC05, AC06):

| Ordem | Condição | Resposta | Efeito no banco |
|---|---|---|---|
| 1 | chave ausente/errada | `401` `{"error":"unauthorized"}` | nenhum |
| 2 | corpo inválido (ver tabela abaixo) — avaliado **sem consultar o evento** | `422` `{"error":"invalid_request"}` | nenhum |
| 3 | `purchaseTicket` → `event_not_available` (inexistente, `draft` ou `cancelled`) | `404` `{"error":"event_not_available"}` | nenhum |
| 4 | `purchaseTicket` → `sold_out` | `409` `{"error":"sold_out"}` | nenhum |
| 5 | `purchaseTicket` → `ok` | `202` `{"ticketId":"tkt_…","code":"XXXXXXXX","status":"pending"}` | 1 linha em `tickets` |

Corpo inválido (→ 422) quando qualquer um vale:

| Caso | Exemplo |
|---|---|
| corpo ausente ou vazio | sem `-d` |
| JSON malformado (erro do parser), inclusive corpo de formulário (`buyerEmail=a@b.co&cardNumber=…`) | `{"buyerEmail":` |
| corpo maior que 10 kB | — |
| JSON válido que não é objeto | `[]`, `null`, `"x"`, `42` |
| `buyerEmail` ausente, não string, ou, após `trim()`, fora de `^[^\s@]+@[^\s@]+\.[^\s@]+$` | `"ana@"`, `"ana@example"`, `"ana example.com"`, `123` |
| `cardNumber` ausente, não string, ou fora de `^\d{16}$` (sem remover espaços na API) | `"123"`, `"40000000000000011"`, `"400000000000000a"`, `"4000 0000 0000 0001"`, `4000000000000001` (número) |

- Normalização antes de chamar o serviço: `email = buyerEmail.trim().toLowerCase()`; `cardNumber` sem alteração.
- Campos extras no corpo (`userId`, `channel`, `priceCents`, `status`…) são ignorados: nunca chegam a `purchaseTicket` nem alteram canal, dono, preço ou status do ingresso.
- Chamada: `purchaseTicket({ eventId: req.params.eventId, buyer: { email }, cardNumber, channel: 'partner' })` — sem `userId` (F04-AC10, PRD seção 11 "Compra pela API e contas").
- Se `purchaseTicket` devolver `invalid_request` (validação redundante do serviço), responder `422` `{"error":"invalid_request"}`. Qualquer outro `error` desconhecido → 500 `{"error":"internal_error"}`.
- Resposta `202` com exatamente as chaves `ticketId`, `code`, `status`, nesta ordem; `status` é sempre `"pending"`. Enviada logo após o commit da transação de `purchaseTicket` — não espera o gateway (R06); alvo < 1 s.
- `eventId` com formato estranho (ex.: `evt_%27`, 300 caracteres) só é usado como parâmetro de query (`$1`) por F02/F03 → `404 event_not_available`.

### 3.4 `GET /api/partner/tickets/:ticketId`

- Quem acessa: parceiro com chave válida. Ingresso de **qualquer canal** (`web` ou `partner`) e de evento em qualquer status.
- Implementação: `getTicketById(pool, ticketId)` (F03).
- Resposta `200` com exatamente as chaves, nesta ordem:

```json
{ "ticketId": "tkt_51xq0a9b2c", "code": "K7Q2M9XA", "eventId": "evt_8f2k3m9q1z", "status": "confirmed", "checkedIn": false }
```

| Campo | Origem | Regra |
|---|---|---|
| `ticketId` | `tickets.id` | string |
| `code` | `tickets.code` | string de 8 caracteres `[A-Z0-9]` (`.trim()` por ser `char(8)`) |
| `eventId` | `tickets.event_id` | string |
| `status` | `tickets.status` | um de `pending`, `confirmed`, `declined`, `cancelled`, `refunded` (valor, nunca rótulo) |
| `checkedIn` | `tickets.checked_in` | booleano JSON (`true`/`false`) |

- Inexistente (qualquer string, inclusive `tkt_0000000000`, `abc`, 300 caracteres, `'%20OR%201=1`) → `404` `{"error":"ticket_not_found"}`.

### 3.5 Caminho ou método desconhecido sob `/api/partner`

- Com chave válida: `404` `{"error":"not_found"}` (ex.: `GET /api/partner/foo`, `DELETE /api/partner/events`, `GET /api/partner/events/:id/purchases`).
- Sem chave: `401` (autenticação vem primeiro).

### 3.6 Erros

| Origem | Resposta |
|---|---|
| Erro do body-parser (`err.type` em `entity.parse.failed`, `entity.too.large`, `encoding.unsupported`, `charset.unsupported`, ou `err.status` 400/413/415) | `422` `{"error":"invalid_request"}` |
| Qualquer outra exceção (banco fora do ar etc.) | `500` `{"error":"internal_error"}`, com `console.error` do erro (sem a chave) |

Express 5 encaminha rejeições de handlers `async` ao handler de erro; não usar `try/catch` que engula erros.

## 4. Funções e módulos providos (interfaces providas)

O PRD fixa `requireApiKey` e as rotas; os nomes abaixo, não fixados pelo PRD, ficam registrados aqui para consumo por F06 e testes.

| Módulo | Export | Assinatura e semântica |
|---|---|---|
| `src/features/partner/index.js` | `router` | `express.Router` com as três rotas, fallback 404 e handler de erro. Montado em `src/app.js` por **uma linha**: `app.use('/api/partner', require('./features/partner').router);` (ou o equivalente ESM, conforme o padrão de F01). |
| `src/features/partner/index.js` | `requireApiKey` | reexport de `auth.js`. |
| `src/features/partner/auth.js` | `requireApiKey(req, res, next)` | Middleware Express. Lê `process.env.PARTNER_API_KEY` a cada requisição; responde 401 `{"error":"unauthorized"}` ou chama `next()`. |
| `src/features/partner/validate.js` | `validatePartnerPurchase(body)` | Pura. Retorna `{ ok: true, email, cardNumber }` (email já normalizado) ou `{ ok: false }`. Regras da tabela de 3.3. |
| `src/features/partner/serializers.js` | `toPartnerEvent(eventRow, available)` | Retorna `{id, name, startsAt, priceCents, availableSeats}` na ordem fixa. |
| `src/features/partner/serializers.js` | `toPartnerTicket(ticketRow)` | Retorna `{ticketId, code, eventId, status, checkedIn}` na ordem fixa. |
| `src/features/partner/serializers.js` | `toPartnerPurchase(ticketRow)` | Retorna `{ticketId, code, status}` na ordem fixa. |
| `src/features/partner/errors.js` | `PARTNER_EXTRA_ERRORS` | `{ notFound: 'not_found', internal: 'internal_error' }` — códigos fora do brief, usados só pela API (não vão para `messages.js`, que guarda só textos do brief). |
| `src/features/partner/routes.js` | handlers | `listEvents`, `createPurchase`, `getTicket` (`async (req, res)`), usados pelo `router`. |

Códigos de erro HTTP providos para consumidores (F06 verifica `404 event_not_available` após cancelar; X-15): exatamente os do brief, mais `not_found` e `internal_error` acima.

## 5. Interfaces consumidas

| De | Interface | Uso em F04 |
|---|---|---|
| F01 | `docker-compose.yml` com `PARTNER_API_KEY` (padrão `catraca-parceiro-2026`) | chave esperada |
| F01 | `src/app.js` (uma linha por feature) | montagem do `router` |
| F01 | `src/db.js` → `pool` | cliente passado para `listOnSaleEvents`, `getSeatStats`, `getTicketById` (o `Pool` do `pg` expõe `query` como um client) |
| F01 | `src/messages.js` | códigos `unauthorized`, `invalid_request`, `event_not_available`, `sold_out`, `ticket_not_found` — F04 importa as constantes (nome do export definido por F01, ex. `apiErrors`) e **não** escreve esses literais em `src/features/partner/` |
| F01 | `src/format.js` → `toIsoWithOffset(date)` | `startsAt` |
| F01 | `scripts/up.sh`, `scripts/gates.sh` (com `GATEWAY_FAST_DELAY_MS`/`GATEWAY_SLOW_DELAY_MS` reduzidos e `DATABASE_URL` disponível para os testes) | execução e testes |
| F02 | `src/features/events/repo.js` → `listOnSaleEvents(client)`, `getSeatStats(client, eventId)` | listagem |
| F02 | `getOnSaleEvent(client, eventId)` | **não usado** por F04: a decisão de 404 é tomada por `purchaseTicket` dentro da trava; checar fora dela abriria janela entre checagem e compra (R11 concorrente, F06-AC08) |
| F02 | rotas `/org/events*` | só nos testes, para criar/publicar/editar eventos como organizador da seed |
| F03 | `src/features/purchases/service.js` → `purchaseTicket({eventId, buyer:{userId?, email}, cardNumber, channel})`, `getTicketById(client, id)` | compra e consulta |
| F03 | worker do gateway (`startGatewayWorker`, iniciado pelo app) | resolve ingressos `partner` como os `web` |
| F03 | rotas `GET /events/:id`, `POST /events/:id/purchase`, `GET /me/tickets` | só nos testes de integração (X-08, F04-AC10) |

Se, ao implementar, algum nome real de F01–F03 divergir do PRD, o implementador usa o nome real do código em `main` e registra a divergência no PR; o comportamento desta spec não muda.

## 6. Concorrência

- Toda decisão de vaga acontece dentro de `purchaseTicket` (F03): `withTransaction` + `lockEvent` (`SELECT … FROM events WHERE id=$1 FOR UPDATE`) + `getSeatStats` (AGENTS.md regra 5; PRD seção 10).
- F04 **não** pré-checa vagas nem status do evento fora dessa trava (nada de `getOnSaleEvent`/`getSeatStats` antes de `purchaseTicket` para decidir 404/409).
- O handler de compra **não** segura conexão do pool enquanto chama `purchaseTicket` (não abre transação própria, não faz `pool.connect()`): com 30 requisições simultâneas e pool menor que 30, segurar uma conexão e pedir outra causaria esgotamento/deadlock do pool.
- A listagem lê sem trava; `availableSeats` pode estar defasado por milissegundos sob carga, mas nunca é usado para decidir compra.
- Resultado esperado (F04-AC07, brief passo 15): 30 compras simultâneas num evento de lotação 5 → exatamente 5 × `202` e 25 × `409`; `pending + confirmed` do evento = 5.

## 7. Configuração

| Variável | Quem define | Uso em F04 | Padrão |
|---|---|---|---|
| `PARTNER_API_KEY` | F01 (Compose) | chave aceita | `catraca-parceiro-2026` |
| `APP_PORT` | F01 (host) | porta publicada (`$API = http://localhost:$APP_PORT`) | `3000` |
| `TZ` | F01 (`up.sh`) | offset de `startsAt` | fuso do host, fallback `America/Sao_Paulo` |
| `GATEWAY_FAST_DELAY_MS`, `GATEWAY_SLOW_DELAY_MS`, `GATEWAY_POLL_MS` | F03 | não lidas por F04; os testes de F04 as leem de `process.env` para saber quanto esperar | 2000 / 65000 / 500 |

Nenhuma variável nova.

## 8. Estrutura de arquivos

```
src/features/partner/
  index.js         # router (requireApiKey → rotas → 404 JSON → handler de erro); exports router, requireApiKey
  auth.js          # requireApiKey
  validate.js      # validatePartnerPurchase
  serializers.js   # toPartnerEvent, toPartnerTicket, toPartnerPurchase
  errors.js        # PARTNER_EXTRA_ERRORS
  routes.js        # listEvents, createPurchase, getTicket
src/app.js         # +1 linha: app.use('/api/partner', ...router)
README.md          # +seção "API de parceiros"
test/
  partner-api.helpers.js            # fetch com chave, login com cookie, criar/publicar/editar evento, SQL (pg)
  partner-api-auth.test.js          # F04-AC01
  partner-api-events.test.js        # F04-AC02, X-07
  partner-api-purchase.test.js      # F04-AC03, AC04, AC05, AC06, AC10
  partner-api-concurrency.test.js   # F04-AC07
  partner-api-tickets.test.js       # F04-AC08, X-08 (ingresso da vitrine)
  partner-api-gateway.test.js       # F04-AC09, X-08 (worker em ingressos partner, esgotamento cruzado)
  partner-api-harness.test.js       # X-06 (códigos vêm de messages.js; nenhum literal em src/features/partner)
```

Se F01 já tiver helpers de teste (login com cookie, cliente `pg`), `partner-api.helpers.js` os reutiliza em vez de duplicar.

**Ordem em `src/app.js`:** a linha de F04 tem de ficar antes de qualquer body parser global (`app.use(express.json())`, `app.use(express.urlencoded())`). Um parser global anterior faria o JSON malformado virar erro fora do router (resposta não-JSON ou 400 em vez de 422) e faria um corpo `application/x-www-form-urlencoded` ser aceito como objeto (deve ser 422: "corpo não-JSON", F04-AC04). Se F01 tiver registrado parser global antes do bloco de features, a linha de F04 é posicionada antes dele; isso e a seção do README são as únicas alterações de F04 fora de `src/features/partner/` e `test/`.

## 9. Textos exatos do brief

F04 usa apenas os códigos de erro da API, todos importados de `src/messages.js` (F01-AC11) e emitidos como `{"error":"<código>"}`:

| Código (literal do brief) | Status | Rotas |
|---|---|---|
| `unauthorized` | 401 | todas |
| `invalid_request` | 422 | compra |
| `event_not_available` | 404 | compra |
| `sold_out` | 409 | compra |
| `ticket_not_found` | 404 | consulta de ingresso |

Valores de `status` (`pending`, `confirmed`, `declined`, `cancelled`, `refunded`) saem do banco tal como gravados por F03/F06 — F04 não traduz para rótulo. Os mapeamentos `purchaseTicket.error → status HTTP` usam as constantes de `messages.js` como chave. Um teste (X-06) garante que nenhum dos cinco literais aparece como string em `src/features/partner/*.js`.

## 10. README

Seção "API de parceiros" com:

- `$API` = `http://localhost:3000` (ou `http://localhost:$APP_PORT`), `$KEY` = `catraca-parceiro-2026` (configurável por `PARTNER_API_KEY`).
- Um `curl` por rota (os três do brief, com `-H "X-Api-Key: $KEY"`).
- Tabela de erros (401/422/404/409/404) e a ordem de verificação da compra.
- Formato de `startsAt` e significado de `availableSeats`.
