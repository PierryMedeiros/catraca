# F04 — API de parceiros: plano de implementação

> Pré-requisito: W3 (F01, F02, F03) em `main`. Trabalhar na branch `feat/F04-api-parceiros` (worktree própria, `APP_PORT=3104` para não colidir com F05). PR próprio, independente do de F05 (P-04).
> Referências: `spec.md` (decisões), `contract.md` (o que o avaliador vai exercitar), `docs/prd.md` (F04-AC01–AC10, X-06–X-08).

Convenção de verificação rápida durante o desenvolvimento (app de pé com `APP_PORT=3104 ./scripts/up.sh`):

```bash
export API=http://localhost:3104 KEY=catraca-parceiro-2026
```

## Etapa 0 — Ler o que F01–F03 entregaram (sem alterar nada)

- Ler: `src/app.js` (padrão da linha por feature; se há `express.json()` global e onde), `src/messages.js` (nome do export dos códigos da API), `src/db.js`, `src/format.js` (`toIsoWithOffset`), `src/features/events/repo.js` (`listOnSaleEvents`, `getSeatStats`), `src/features/purchases/service.js` (`purchaseTicket`, `getTicketById`), `scripts/gates.sh` (variáveis passadas aos testes: URL do app, `DATABASE_URL`, atrasos do gateway), helpers existentes em `test/`, nomes dos campos dos formulários de `/login`, `/org/events/new`, `/org/events/:id/edit`, `/events/:id`.
- Anotar divergências de nome em relação ao PRD (para o PR).
- Verificar: `git diff --stat` vazio.

## Etapa 1 — Esqueleto do router e autenticação

- Arquivos: `src/features/partner/auth.js`, `src/features/partner/errors.js`, `src/features/partner/index.js`, `src/app.js` (+1 linha, antes de parser JSON global, ver spec seção 8).
- `requireApiKey` com `timingSafeEqual` sobre SHA-256; `PARTNER_API_KEY` vazia ⇒ sempre 401.
- `index.js`: `router.use(requireApiKey)`; fallback `404 {"error":"not_found"}`; handler de erro (parse → 422, resto → 500).
- Verificar:
  - `curl -s -w ' %{http_code}' $API/api/partner/events` → `{"error":"unauthorized"} 401`
  - `curl -s -w ' %{http_code}' -H "X-Api-Key: errada" $API/api/partner/events` → `{"error":"unauthorized"} 401`
  - `curl -s -w ' %{http_code}' -H "X-Api-Key: $KEY" $API/api/partner/foo` → `{"error":"not_found"} 404`

## Etapa 2 — Serializers e listagem

- Arquivos: `src/features/partner/serializers.js`, `src/features/partner/routes.js` (`listEvents`), `index.js` (rota `GET /events`).
- `listOnSaleEvents(pool)` + `getSeatStats(pool, id).available` por evento; `toPartnerEvent` com ordem fixa e `Number(price_cents)`.
- Verificar: criar e publicar um evento como organizador A pela UI; `curl -s -H "X-Api-Key: $KEY" $API/api/partner/events | jq '.[0] | keys_unsorted'` → `["id","name","startsAt","priceCents","availableSeats"]`; rascunho não aparece.

## Etapa 3 — Validação do corpo

- Arquivo: `src/features/partner/validate.js` (`validatePartnerPurchase`).
- Regex de e-mail do PRD seção 11 sobre `trim()`; `cardNumber` string `^\d{16}$`; corpo precisa ser objeto não nulo e não array.
- Verificar: `node -e` rápido no container ou, direto, os testes da etapa 7 (`partner-api-purchase.test.js` cobre a matriz).

## Etapa 4 — Compra

- Arquivos: `routes.js` (`createPurchase`), `index.js` (rota `POST /events/:eventId/purchases` com `express.json({ type: () => true, limit: '10kb' })` só nela).
- Ordem: validar (422) → `purchaseTicket({eventId, buyer:{email}, cardNumber, channel:'partner'})` → mapear `event_not_available`→404, `sold_out`→409, `invalid_request`→422, `ok`→202 `toPartnerPurchase`.
- Não abrir transação nem `pool.connect()` no handler (spec seção 6).
- Verificar:
  - compra válida → `202` com `pending`, `%{time_total}` < 1;
  - `-d '{"buyerEmail":"a@b.co","cardNumber":"123"}'` → `422`;
  - `-d '{"buyerEmail":'` → `422` com `Content-Type: application/json`;
  - evento inexistente com corpo válido → `404 event_not_available`;
  - lotação 1 + 2 compras → `202` e `409 sold_out`.

## Etapa 5 — Consulta de ingresso

- Arquivos: `routes.js` (`getTicket`), `index.js` (rota `GET /tickets/:ticketId`).
- `getTicketById(pool, id)`; `toPartnerTicket` com `checkedIn` booleano e `code.trim()`.
- Verificar: ingresso da etapa 4 → `200` com 5 chaves; após ~2 s, `status` `confirmed` (cartão final `0001`); `tkt_0000000000` → `404 ticket_not_found`.

## Etapa 6 — README

- Arquivo: `README.md` (só a nova seção "API de parceiros", spec seção 10).
- Verificar: os três `curl` copiados do README funcionam com o app de pé.

## Etapa 7 — Testes automatizados (rodam em `./scripts/gates.sh`)

Todos com `node:test` + `fetch` contra o app real do projeto `catraca-gates`; SQL de preparo/conferência via `pg` com `DATABASE_URL`. Esperas do gateway calculadas a partir de `process.env.GATEWAY_FAST_DELAY_MS`/`GATEWAY_SLOW_DELAY_MS` (+ margem de 3 s), com polling a cada 200 ms. Cada teste cria seus próprios eventos (nomes com sufixo aleatório) para não depender de ordem.

| Arquivo | Casos | Critérios |
|---|---|---|
| `test/partner-api.helpers.js` | `api(path, {key, method, body, rawBody})`, `loginAs(email)` → cookie, `createEvent({capacity, price, startsAt})`, `publish(id)`, `editEvent(id, fields)`, `sql(text, params)`, `waitFor(fn, ms)` | — |
| `test/partner-api-auth.test.js` | 3 rotas × {sem cabeçalho, chave errada, chave vazia, chave em maiúsculas, chave + sufixo, só cookie de organizador} → 401 e corpo `{"error":"unauthorized"}` byte a byte; sem chave + corpo inválido / evento inexistente / ingresso inexistente → 401; contagem de `tickets` igual antes e depois | F04-AC01 |
| `test/partner-api-events.test.js` | chaves exatas e tipos; `startsAt` casa `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$` e `Date.parse(startsAt)` = epoch de `starts_at` no banco; rascunho ausente; publicado com `availableSeats`=lotação e `priceCents`=preço; editar preço 100→150 e lotação 2→3 reflete; `cancelled` (via SQL) ausente; esgotado listado com 0 | F04-AC02, X-07 |
| `test/partner-api-purchase.test.js` | 202 com 3 chaves exatas, regex de `ticketId`/`code`, tempo < 1 s, linha com `channel='partner'`, `user_id` nulo, `buyer_email` normalizado, `card_last4`; matriz completa de 422 (spec 3.3) com contagem igual; 422 em evento inexistente; 404 para inexistente/rascunho/cancelado (via SQL) inclusive cancelado lotado; 409 sem criar ingresso; compra com e-mail do participante da seed não aparece em `/me/tickets` dele; `Content-Type` JSON em todas as respostas, inclusive JSON malformado e `not_found` | F04-AC03, AC04, AC05, AC06, AC10 |
| `test/partner-api-concurrency.test.js` | 30 `fetch` simultâneos (`Promise.all`) em evento de lotação 5 → 5×202 + 25×409, `count(*) WHERE status IN ('pending','confirmed')` = 5, 5 códigos distintos; repetido em 2 eventos novos; lotação 1 → 1×202 + 29×409 | F04-AC07 |
| `test/partner-api-tickets.test.js` | 5 chaves exatas; `checkedIn` `false` e, após `UPDATE tickets SET checked_in=true` via SQL, `true`; ingresso comprado na vitrine (participante da seed, `POST /events/:id/purchase`) é lido pela API com `eventId` e `code` iguais ao banco; ids inexistentes variados → 404 `ticket_not_found` | F04-AC08, X-08 |
| `test/partner-api-gateway.test.js` | `0001` → `confirmed` dentro do atraso rápido; `0002` e final `5555` → `declined`; `0004` continua `pending` até perto do atraso lento e vira `declined`, e `availableSeats` sobe 1; API esgota evento de lotação 1 → `GET /events/:id` (participante) contém `Ingressos esgotados` | F04-AC09, X-08 |
| `test/partner-api-harness.test.js` | lê `src/features/partner/*.js` e falha se algum dos 5 códigos do brief aparecer como literal entre aspas; confere que `messages.js` exporta os 5 códigos; `GET /api/partner/events` com a chave do ambiente → 200 | X-06 |

- Verificar: `./scripts/gates.sh` sai 0 e a saída lista os testes `partner-api-*`; quebrar de propósito uma asserção (localmente, sem commitar) faz o gate sair ≠ 0.

## Etapa 8 — Verificação manual com o app de pé

```bash
APP_PORT=3104 ./scripts/up.sh
```

- Executar, do `contract.md`, os itens F04-C02, F04-C07, F04-C08, F04-C10 (uma rodada) e F04-C13 (roteiro com espera de 75 s, modo padrão do gateway).
- Conferir no log (`docker compose logs app`) que a chave não aparece.
- `./scripts/down.sh` ao final.

## Etapa 9 — Fechamento

- `./scripts/gates.sh` passa (de novo, depois de qualquer ajuste).
- `state.json`: F04 `status: "implemented"`, `branch: "feat/F04-api-parceiros"`, `pr` preenchido após abrir o PR.
- Commits atômicos em Conventional Commits, em português, `git add` por caminho. Sugestão:
  - `feat(api-parceiros): autenticação por chave e router da API`
  - `feat(api-parceiros): listagem de eventos à venda`
  - `feat(api-parceiros): compra e consulta de ingresso`
  - `test(api-parceiros): testes de contrato, concorrência e gateway`
  - `docs(readme): seção da API de parceiros`
  - `chore(estado): F04 implementada`
- Abrir o PR de F04 (independente do de F05), descrevendo divergências de nomes encontradas na etapa 0.
