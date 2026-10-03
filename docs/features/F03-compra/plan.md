# F03 — Vitrine, compra e gateway: plano de implementação

> Lê junto: `spec.md` (decisões), `contract.md` (o que o avaliador vai exercitar), `AGENTS.md`.
> Branch sugerida: `feat/f03-compra`. Pré-requisito: F01 e F02 em `main`.
> Regra de ouro: cada etapa termina com uma verificação objetiva; não avance com a anterior falhando.

## Etapa 0 — Ler o que F01 e F02 entregaram

- Ler `src/db.js`, `src/auth.js`, `src/views/layout.js`, `src/messages.js`, `src/format.js`, `src/ids.js`, `src/app.js`, `src/features/events/repo.js`, `scripts/gates.sh` e o `docker-compose.yml` (e override de gates, se houver).
- Anotar: sistema de módulos (CJS/ESM), tipo de `users.id`, nomes das exportações de rótulos em `messages.js`, retorno de `lockEvent`, valor de `getSeatStats` para evento inexistente, padrão de registro em `src/app.js`, se existe placeholder em `GET /`, nomes dos campos de `/login`, `/signup` e do formulário de evento de F02 (para os testes cross).
- Verificação: nenhuma; só leitura. Se algo contradiz `spec.md` §6, ajustar a spec (seção "Divergências") antes de codar.

## Etapa 1 — Variáveis do gateway nos gates

- Arquivos: o lugar onde F01 define o ambiente do app de teste (`scripts/gates.sh` e/ou o arquivo Compose usado por ele).
- Garantir que o app dos gates sobe com `GATEWAY_FAST_DELAY_MS=300`, `GATEWAY_SLOW_DELAY_MS=1500`, `GATEWAY_POLL_MS=100`, e que o processo dos testes enxerga os mesmos valores (para calcular esperas). O app de `./scripts/up.sh` **não** recebe essas variáveis (modo padrão).
- Verificação: `./scripts/gates.sh` continua passando (testes de F01/F02); `./scripts/up.sh` + `docker compose exec app printenv | grep GATEWAY_` sai vazio.

## Etapa 2 — Migração `003_tickets.sql`

- Arquivo: `db/migrations/003_tickets.sql` (DDL de `spec.md` §2, com o tipo real de `users.id`).
- Verificação: `./scripts/up.sh`; `SELECT version FROM schema_migrations` (ou coluna equivalente) lista a 003; `\d tickets` mostra as colunas, `tickets_code_key` e os três índices; um `INSERT` com `code` repetido falha com `23505`.

## Etapa 3 — Simulador do gateway

- Arquivo: `src/features/gateway/simulator.js` (`decideOutcome`).
- Teste: `test/f03-simulator.test.js` — apaga `GATEWAY_*` de `process.env` no próprio processo, confere a tabela de `spec.md` §4 com os padrões (2000/65000), inclusive final `9999` → `declined`/2000; define `GATEWAY_FAST_DELAY_MS=10`, `GATEWAY_SLOW_DELAY_MS=20` e confere; valores inválidos (`abc`, `-1`, `''`) caem no padrão; restaura o env ao final.
- Verificação: `./scripts/gates.sh` passa com o novo teste.

## Etapa 4 — `getSeatStats` real

- Arquivo: `src/features/events/repo.js` (só o corpo de `getSeatStats`; assinatura e retorno inalterados).
- Verificação: testes de F02 (inclusive F02-AC08) continuam passando nos gates.

## Etapa 5 — Serviço de compra

- Arquivo: `src/features/purchases/service.js` (`generateTicketCode`, `insertTicket`, `getTicketById`, `purchaseTicket`), conforme `spec.md` §4 e §5.
- Pontos de atenção: validação antes da transação; `lockEvent` como primeira instrução; `getSeatStats` depois da trava; `ON CONFLICT (code) DO NOTHING RETURNING *` com nova tentativa; nunca logar o número do cartão.
- Verificação rápida (com `./scripts/up.sh` rodando): o script de `contract.md` F03-C12 imprime `{"ok":5,"sold_out":25}`.

## Etapa 6 — Worker do gateway e registro

- Arquivos: `src/features/gateway/worker.js` (`startGatewayWorker`), `src/features/purchases/index.js` (`registerPurchases(app)` chamando o worker), `src/app.js` (uma linha).
- Verificação: compra via script (etapa 5) com cartão `...0001`; em ≤ 5 s `SELECT status FROM tickets WHERE id=…` = `confirmed` e `updated_at - created_at` ≈ 2 s.

## Etapa 7 — Rotas e views

- Arquivos: `src/features/purchases/routes.js`, `src/features/purchases/views.js`; remover placeholder de `GET /` de F01, se existir.
- Implementar exatamente os marcadores HTML, status e textos de `spec.md` §3 (linha única por evento e por ingresso).
- Verificação manual rápida: `curl -s $WEB/` lista evento publicado; `curl -s -o /dev/null -w '%{http_code}' $WEB/events/evt_inexistente` = 404; compra com cookie jar de participante → 303 para `/me/tickets` e `pendente` na página.

## Etapa 8 — Testes automatizados (`test/`)

O nome de cada teste começa com o ID do critério que ele cobre (ex.: `test('F03-AC08 30 compras simultâneas → 5 ok', …)`, `test('X-05 …')`), para que o avaliador rastreie por `grep` (contrato F03-C23). Todos com `node:test` + `fetch` contra o app real dos gates e consultas diretas ao banco de teste (via `pool` de `src/db.js` ou o mecanismo que F01 usa nos testes). Cada teste cria seus próprios eventos (SQL direto na tabela `events`, ou rotas de F02 nos testes cross) e contas (`POST /signup` com e-mail único), para não depender de ordem.

- `test/f03-helpers.js`: `signupParticipant()`, `login(email, senha)` → cookie, `createEventSql({capacity, priceCents, status, organizerEmail})`, `buy(cookie, eventId, card)` → `{status, location, ms}`, `waitForStatus(ticketId, status, timeoutMs)`. (Arquivo dentro de `test/` é carregado pelo `node --test`; não declara testes, então não afeta o resultado.)
- `test/f03-vitrine.test.js`
  - AC01: publicado aparece em `GET /` para visitante, participante e organizador com `R$ 100,00` e data `dd/mm/aaaa HH:mm`; rascunho e cancelado (SQL) não aparecem; nome com `<script>` sai escapado; esgotado continua listado com `Ingressos esgotados`.
  - AC02: página do evento por papel (link `Entrar para comprar` com `next`, formulário `cardNumber`, aviso de organizador), `Vagas disponíveis: N`; 404 para rascunho, cancelado, inexistente e id malformado.
  - AC05 (GET): evento de lotação 1 com 1 pendente → `p.sold-out` e sem `name="cardNumber"`.
- `test/f03-compra.test.js`
  - AC03: compra → 303 `/me/tickets` em < 1000 ms; linha `pending`, `channel='web'`, `user_id`, `price_cents`, `code` no formato, `card_last4`; nenhuma coluna contém o número completo (`row_to_json(t)::text NOT LIKE '%<cartão>%'`); `/me/tickets` mostra `pendente`.
  - AC04: `123`, 15, 17 dígitos, letra, vazio, campo repetido → 422 com a mensagem e contagem igual; `4000 0000 0000 0001` → 303.
  - AC05 (POST): lotação 1 ocupada → 409 com `Ingressos esgotados`, contagem igual.
  - AC13: organizador → 403; visitante → 302 `/login?next=/events/:id`; contagem igual.
  - Ordem de erros do serviço: chamadas diretas a `purchaseTicket` cobrindo `invalid_request` (cartão inválido + evento inexistente, e-mail inválido, `cardNumber` numérico, canal inválido), `event_not_available` (inexistente, rascunho, cancelado mesmo sem vaga) e `sold_out`.
- `test/f03-gateway.test.js` (com os atrasos curtos da etapa 1)
  - AC06: `0001` → `pending` logo após a compra e `confirmed` depois; `0002` e `9999` → `declined`; `0003` ainda `pending` quando os rápidos já resolveram e `confirmed` depois; `0004` → `declined`; `gateway_due_at - created_at` = atraso configurado (± 200 ms).
  - AC07: lotação 1, compra `0002` → esgotado; após `declined`, `Vagas disponíveis: 1` e nova compra aceita; ingressos colocados (SQL) em `cancelled`/`refunded` não contam.
  - AC09: compra `0003`, SQL muda para `cancelled` antes do vencimento; depois do vencimento + 3 ciclos, continua `cancelled` (e o mesmo para `refunded`).
  - AC10: ingresso `pending` inserido por SQL com `gateway_due_at` no passado e `gateway_outcome='approved'` vira `confirmed` em ≤ 1 s (o vencimento vem do banco). O reinício real é verificado no contrato (F03-C14).
- `test/f03-concorrencia.test.js`
  - AC08: 3 rodadas, cada uma num evento novo de lotação 5: `Promise.all` de 30 `purchaseTicket` → 5 `ok` e 25 `sold_out`; `count(*) WHERE status IN ('pending','confirmed')` = 5. Mais 1 rodada por HTTP (30 `fetch` simultâneos na vitrine) → 5×303 e 25×409.
- `test/f03-meus-ingressos.test.js`
  - AC11: dois participantes; cada um vê só os próprios ingressos (nome, rótulo, código); compra `partner` com o e-mail de um deles não aparece; visitante → 302; organizador → 403; status muda após o worker.
  - AC12: `tickets_code_key` existe; `insertTicket` com gerador que devolve primeiro um código existente e depois um novo grava o novo (2 chamadas ao gerador); todos os ids/códigos nos formatos.
- `test/f03-cross.test.js`
  - X-03: `POST /signup` → compra → ingresso em `/me/tickets`; visitante segue `Entrar para comprar`, faz login com `next` e é redirecionado para `/events/:id`.
  - X-04: organizador cria evento pelas rotas de F02 (R$ 100,00); fora da vitrine até publicar; compra grava 10000; edição para R$ 150,00 mantém 10000 no ingresso antigo e a compra seguinte grava 15000.
  - X-05: lotação 2 com 2 ingressos (`0001` e `0003`), edição para 1 rejeitada com `A lotação não pode ser menor que as vagas ocupadas (2)` e banco intacto; para 3 aceita e libera exatamente mais uma compra.
- Verificação: `./scripts/gates.sh` sai 0; a saída lista os arquivos `f03-*` sem `# fail`.

## Etapa 9 — Verificação manual com o app no modo padrão

- `./scripts/down.sh && ./scripts/up.sh` (sem variáveis `GATEWAY_*`).
- Executar o contrato inteiro (`contract.md`, F03-C01 a F03-C23), incluindo os itens lentos (C09, C13, C14) e o reinício (C14).
- Conferir também o trecho do fluxo do avaliador que F03 já cobre sem API: passos 5 (conta nova, compra `0001`, pendente → confirmado em "Meus ingressos") e a parte de vitrine do passo 7 (`Ingressos esgotados` com lotação ocupada).
- Atualizar `state.json` (F03 → `implemented`, branch) e abrir o PR. Não escrever relatório de avaliação (quem implementa não avalia).
