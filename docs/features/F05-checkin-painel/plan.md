# F05 — Check-in e painel: plano de implementação

> Spec: `spec.md` (mesma pasta). Contrato: `contract.md`. Branch sugerida: `feat/f05-checkin-painel`, a partir de `main` com F01–F03 integradas. Wave W4 em paralelo com F04: não tocar `src/features/partner/`, não criar migração.

Cada etapa termina com a verificação indicada; não avance com a verificação falhando. Commits em Conventional Commits, em português, escopo `checkin` (ex.: `feat(checkin): ...`, `test(checkin): ...`).

## Etapa 0 — Conferir as interfaces consumidas

- Ler em `main`: `src/messages.js` (nomes dos exports das 5 mensagens de R10), `src/auth.js` (`requireOrganizer`), `src/db.js` (`withTransaction`, `pool`), `src/format.js` (`formatBRL`), `src/features/events/repo.js` (`getEventForOrganizer`, `getSeatStats`), `src/features/events/views.js` (mecanismo de seções, renderer da página, helper de 404), `db/migrations/003_tickets.sql` (colunas e NOT NULL), `scripts/gates.sh` e o helper de testes de F01 (URL base, acesso ao banco).
- Registrar no PR qualquer divergência de nome em relação à seção 5 da spec.
- Verificar: `node -e "import('./src/format.js').then(m=>console.log(JSON.stringify((m.formatBRL??m.default.formatBRL)(35000))))"` dentro do container (`docker compose exec -T app ...`) imprime `"R$ 350,00"` com espaço comum (byte 0x20). Se vier U+00A0, corrigir em `src/format.js` (seção 8 da spec) com teste.

## Etapa 1 — Serviço de check-in

- Arquivo: `src/features/checkin/service.js` (`CHECKIN_RESULTS`, `MAX_CODE_LENGTH = 64`, `normalizeCode`, `checkinMessage`, `checkInTicket`).
- `checkinMessage` mapeia as 5 chaves para os exports de `src/messages.js`; nenhuma string de R10 literal no arquivo.
- Implementar exatamente os passos 1–4 da spec (seção 4), com a reclassificação quando o UPDATE afeta 0 linhas.
- Verificar: `node --check src/features/checkin/service.js`; `grep -c 'Entrada liberada\|Ingresso' src/features/checkin/service.js` → `0`.

## Etapa 2 — Painel

- Arquivo: `src/features/checkin/dashboard.js` (`getEventDashboard`).
- Uma consulta com `count(*) FILTER` + `COALESCE(sum(price_cents) FILTER ...)`; converter para `Number`; `available` de `getSeatStats`.
- Verificar: `node --check`; com o app de pé, chamada ad hoc via `docker compose exec -T app node ...` num evento da seed de teste devolve objeto com 6 chaves inteiras.

## Etapa 3 — Views

- Arquivo: `src/features/checkin/views.js` (`renderCheckinSection`, `renderDashboardSection`, `renderManageSections`).
- Marcação exatamente como na seção 3.1 da spec (uma linha por `<p id="checkin-result" ...>` e por `<dd data-metric=...>`), tudo dinâmico passando por `escapeHtml`.
- Aviso `<p id="checkin-event-cancelled">` só com `event.status === 'cancelled'`, antes do `<form>`.
- Verificar: `node --check`; teste rápido em Node puro: `renderDashboardSection({confirmed:3,pending:0,checkIns:0,available:0,revenueCents:35000,refunded:0})` contém `<dd data-metric="revenue">R$ 350,00</dd>`.

## Etapa 4 — Rota e registro

- Arquivos: `src/features/checkin/routes.js` (`checkinRouter`), `src/features/checkin/index.js` (`registerCheckinFeature`), `src/app.js` (+1 linha).
- `POST /org/events/:id/checkin`: `requireOrganizer` → `withTransaction` { `getEventForOrganizer` → null ⇒ 404 de F02; `checkInTicket` } → após commit, `renderManagePage(..., ctx.checkin)` com status 200.
- Registrar `renderManageSections` no mecanismo de seções de F02 (ou, se não existir, a linha única em `src/features/events/views.js`, registrada no PR).
- Verificar com o app de pé (`./scripts/up.sh`): `GET /org/events/:id` como organizador A mostra `section#checkin` e `section#painel`; `POST .../checkin` com `code=ZZZZZZZZ` → 200 e `<p id="checkin-result" data-result="invalid_ticket">Ingresso inválido para este evento</p>`.

## Etapa 5 — Fixtures de teste

- Arquivo: `test/helpers/f05-fixtures.js` (sem efeitos colaterais ao importar, pois `node --test` pode executá-lo): `createEvent({owner, capacity, priceCents, status})`, `createTicket({eventId, status, priceCents, checkedIn, channel})` por SQL com ids `evt_`/`tkt_` + 10 `[a-z0-9]` e códigos de 8 `[A-Z0-9]` aleatórios; `login(email)` → cookie; `postCheckin(cookie, eventId, code)` → `{status, result, html}`; `getPanel(cookie, eventId)` → objeto com os 6 valores lidos de `data-metric`.
- Reutilizar o helper de F01 (URL base, pool) em vez de duplicar.
- Verificar: `node --check test/helpers/f05-fixtures.js`.

## Etapa 6 — Testes de check-in (`test/f05-checkin.test.js`)

Um `test()` por critério, com o ID no nome (ex.: `'F05-AC02 código de outro evento é inválido mesmo com evento cancelado'`):

- AC01: GET tem form com `action="/org/events/<id>/checkin"` e `name="code"`; `'  abcd1234 '` (minúsculas, espaços) de ingresso `ABCD1234` confirmado → `entry_allowed`.
- AC02: `ZZZZZZZZ`, vazio, campo ausente, 65 caracteres, `X' OR '1'='1`, código de outro evento do mesmo organizador, código de evento do organizador B → `invalid_ticket`; o mesmo com o evento cancelado (via SQL); nenhum `checked_in` muda.
- AC03: evento `cancelled` (SQL) + códigos `confirmed`, `pending`, `refunded`, `confirmed` com check-in → `event_cancelled`; `checked_in` inalterado.
- AC04: `pending`, `declined`, `cancelled`, `refunded` em evento publicado → `not_confirmed`.
- AC05/AC06: confirmado → `entry_allowed`, `checked_in=true`, `checked_in_at` não nulo; segundo envio → `already_used`, `checked_in_at` inalterado.
- AC06 concorrência: 5 rodadas × 2 POSTs simultâneos e 5 rodadas × 10 POSTs simultâneos (`Promise.all`), cada rodada com evento e ingresso novos → exatamente 1 `entry_allowed`.
- AC10: evento cancelado: GET mostra `#checkin-event-cancelled` antes do `<form>` e o form continua presente.
- X-09: cada `data-result` vem com o texto igual (`===`) ao export correspondente de `src/messages.js`; eco de `<b>x</b>` aparece como `&lt;B&gt;X&lt;/B&gt;`.
- Verificar: `./scripts/gates.sh` passa.

## Etapa 7 — Testes do painel (`test/f05-painel.test.js`)

- AC07: evento com ingressos em todos os status (conjunto do item F05-C08 do contrato) → os 6 valores do HTML batem com a consulta SQL de referência e com `getEventDashboard`; ingressos de outro evento não entram.
- AC08: Receita com preços 10000+10000+15000 → `R$ 350,00`; 100000+23456 → `R$ 1.234,56`; preço atual do evento diferente não altera a Receita; evento sem confirmados → `R$ 0,00`; `pending`/`declined`/`refunded` não entram.
- Verificar: `./scripts/gates.sh` passa.

## Etapa 8 — Testes de acesso (`test/f05-acesso.test.js`)

- AC09/X-10: B em `GET /org/events/<id de A>` → 404 sem `id="painel"`, sem id/nome do evento; B em `POST .../checkin` com código confirmado de A → 404, corpo idêntico ao de `evt_zzzzzzzzzz`, `checked_in` inalterado; participante → 403 (GET e POST); visitante → 302 `Location` começando com `/login?next=`.
- Verificar: `./scripts/gates.sh` passa.

## Etapa 9 — Teste de integração com F03 (`test/f05-integracao.test.js`)

- X-11: evento publicado (preço 10000, lotação 5); compra na vitrine (`POST /events/:id/purchase`, `0001`) pelo participante da seed; `purchaseTicket` com `channel:'partner'` (`0001`); preço do evento para 15000; nova compra na vitrine `0001`; compra na vitrine `0004`; `purchaseTicket` partner `0002`. Esperar o worker (atrasos reduzidos dos gates). Painel: Confirmados 3, Pendentes 1, Check-ins 0, Vagas 1, Receita `R$ 350,00`, Estornados 0. Check-in: código web confirmado → `entry_allowed`; código `0004` → `not_confirmed`; código partner confirmado → `entry_allowed`; painel Check-ins 2.
- Verificar: `./scripts/gates.sh` passa.

## Etapa 10 — Gates

- `./scripts/gates.sh` → código de saída 0; a saída lista os testes `F05-AC01`..`F05-AC10`, `X-09`, `X-10`, `X-11` como `ok`.
- `node --check` limpo em `src/` e `test/` (parte dos gates).

## Etapa 11 — Verificação manual com o app rodando

1. `APP_PORT=3105 ./scripts/up.sh` (porta própria se houver outro worktree de pé).
2. Executar os itens F05-C01 a F05-C14 de `contract.md` com os comandos de lá (é o mesmo roteiro do avaliador).
3. Pela interface no navegador, como organizador A: abrir a página de gestão de um evento com vendas, fazer check-in de um código confirmado, ver `Entrada liberada` e Check-ins subir; repetir o código e ver `Ingresso já utilizado`.
4. `./scripts/down.sh`.

## Etapa 12 — Fechamento

- Conferir escopo: `git diff --name-only main...HEAD` só contém `src/features/checkin/**`, `src/app.js`, `test/f05-*.test.js`, `test/helpers/f05-fixtures.js`, `docs/features/F05-checkin-painel/**`, `state.json` e, se necessário, `src/format.js` ou a linha única em `src/features/events/views.js` (justificadas no PR).
- Atualizar `state.json`: F05 `status: "implemented"`, `branch`, `pr`.
- Abrir PR próprio de F05 (independente do PR de F04), com gates passando.
