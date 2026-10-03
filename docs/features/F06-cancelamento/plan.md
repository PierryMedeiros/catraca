# F06 — Cancelamento de evento: plano de implementação

> Pré-requisito: F01–F05 em `main` (W5). Branch `feat/f06-cancelamento`. Ler `spec.md` e `contract.md` desta pasta antes de começar.
> Cada etapa termina com o app compilando (`node --check`) e, quando indicado, com uma verificação objetiva.

## Etapa 0 — Preparação

- `git switch main && git pull && git switch -c feat/f06-cancelamento`.
- `state.json`: F06 → `"status": "in_progress"`, `"branch": "feat/f06-cancelamento"`.
- Verificar: `./scripts/gates.sh` passa em `main` antes de qualquer mudança (linha de base).

## Etapa 1 — Conferir as interfaces consumidas

Arquivos lidos (sem alterar): `db/migrations/002_events.sql`, `db/migrations/003_tickets.sql`, `src/features/events/*`, `src/features/purchases/service.js`, `src/features/gateway/worker.js`, `src/features/checkin/*`.

Verificar e anotar no PR:
- `grep -n "cancelled" db/migrations/002_events.sql db/migrations/003_tickets.sql` mostra `cancelled` aceito em `events.status` e `cancelled`/`refunded` aceitos em `tickets.status`. Se faltar, criar `db/migrations/004_cancelamento_status.sql` (spec seção 2) e conferir com `\d tickets` no banco.
- `events.cancelled_at` existe.
- O worker usa `WHERE id=$1 AND status='pending'` (AGENTS.md regra 6).
- `purchaseTicket` decide a disponibilidade **depois** de `lockEvent` (relê o status do evento dentro da trava).
- Nome do arquivo de rotas de F02 e o ponto da view de gestão onde entram seções.

## Etapa 2 — Textos de F06

- Criar `src/features/cancellation/texts.js` com `CANCEL_TEXTS` (spec seção 4).
- Verificar: `node --check src/features/cancellation/texts.js`.

## Etapa 3 — Serviço `cancelEvent`

- Criar `src/features/cancellation/service.js` com `cancelEvent(client, {eventId, organizerId})` exatamente na ordem da spec seção 4: `lockEvent` → `getEventForOrganizer` → checagem de status → UPDATE de `events` → UPDATE único de `tickets` com `CASE` → retorno com contagens.
- Nenhum `BEGIN`/`COMMIT` dentro do serviço; nenhum cálculo fora do `client` recebido.
- Verificar: `node --check`; leitura do diff confirma que a primeira chamada com `client` é `lockEvent(client, eventId)`.

## Etapa 4 — Views

- Criar `src/features/cancellation/views.js` com `renderCancelSection(event)` (HTML exato da spec 3.3, `escapeHtml` no id, `formatDateTime(cancelled_at)`) e `renderCancelError(res, {user, eventId, message})` (409 + `layout`).
- Verificar: `node --check`.

## Etapa 5 — Rota de cancelamento

- Criar `src/features/cancellation/routes.js`: `POST /org/events/:id/cancel` com `requireOrganizer`, `withTransaction` + `cancelEvent`, mapeamento de resultados da spec 3.1 (404 reaproveitando a resposta de "não encontrado" de F02).
- `src/app.js`: uma linha registrando o router.
- Verificar com o app no ar (`./scripts/up.sh`): como organizador A, publicar um evento e `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -b A.jar -X POST $WEB/org/events/$E/cancel` → `302 …/org/events/$E`; `SELECT status, cancelled_at FROM events WHERE id='$E'` → `cancelled` e data preenchida.

## Etapa 6 — Página de gestão (view de F02)

- `src/features/events/views.js`: em `cancelled`, não renderizar o formulário de edição nem "Publicar"; em todos os estados, inserir `renderCancelSection(event)` na página de gestão.
- Verificar: `curl -s -b A.jar $WEB/org/events/$E | grep -c 'action="/org/events/'$E'/'` → 0 para `edit`, `publish` e `cancel` num evento cancelado; num publicado, há 1 `…/cancel`; num rascunho, 0 `…/cancel`.

## Etapa 7 — Bloqueio de edição e publicação

- Handler de `POST /org/events/:id/edit` (F02): após `lockEvent` + `getEventForOrganizer`, se `cancelled` → `renderCancelError(… CANCEL_TEXTS.cancelledReadOnly)` antes de validar o corpo.
- Handler de `POST /org/events/:id/publish` (F02): passar a rodar em `withTransaction` com `lockEvent` (se ainda não roda) e aplicar a mesma checagem.
- Verificar: os dois POSTs num evento cancelado → `409` com `Evento cancelado não pode ser alterado`; `md5(row(e.*)::text)` do evento igual antes/depois; os testes de F02 continuam passando (`./scripts/gates.sh`).

## Etapa 8 — Testes automatizados em `test/`

Rodam em `./scripts/gates.sh` (projeto Compose `catraca-gates`, atrasos reduzidos por env). Usar a URL do app e a conexão de banco que o harness de testes de F01 fornece (mesma convenção e helpers dos demais testes de `test/`). Login via `POST /login` com `redirect:'manual'` guardando o cookie; contas da seed. Cada `test()` tem o ID do critério no nome.

`test/cancellation.test.js`:
- `F06-AC01`: página do publicado tem `action="/org/events/<id>/cancel"`, `Cancelar evento` e `return confirm(`; POST do dono → 302 para `/org/events/<id>`; `status='cancelled'`, `cancelled_at` não nulo.
- `F06-AC02`: evento com ingresso `confirmed` (compra `0001`, polling até confirmar), `pending` (compra `0003`; logo após a compra o teste faz `UPDATE tickets SET gateway_due_at = now() + interval '1 hour'` para garantir que continua pendente) e `declined` (`0002`, polling) → após o 302, contagem por status = `refunded 1`, `cancelled 1`, `declined 1`, zero `pending`/`confirmed`.
- `F06-AC03` + `X-13`: página do cancelado sem `action` de edit/publish/cancel; os três POSTs → 409 com os textos de `CANCEL_TEXTS`; hash da linha igual; `GET /org/events` do dono mostra o evento com `cancelado`.
- `F06-AC04` + `X-14`: participante compra na vitrine (`0001` e `0004`), dono cancela; `GET /` não contém o nome; `GET /events/:id` → 404; `POST /events/:id/purchase` não cria ingresso; `/me/tickets` mostra os dois códigos com `estornado` e `cancelado` (rótulos importados de `src/messages.js`).
- `F06-AC05` + `X-14` + `X-15`: ingresso `0004` pendente, cancelamento, depois `UPDATE tickets SET gateway_due_at = now() - interval '1 second'` nele e espera `3 × GATEWAY_POLL_MS` (com um ingresso de controle pendente em outro evento, que **precisa** ser resolvido no mesmo intervalo, provando que o worker rodou) → continua `cancelled` e `updated_at` igual ao do cancelamento; `GET /api/partner/tickets/:id` → `cancelled`/`refunded`; API lista sem o evento e compra → `404 {"error":"event_not_available"}`.
- `F06-AC06`: rascunho sem `…/cancel` na página; POST → 409 `Só eventos publicados podem ser cancelados`; linha igual; publicar em seguida funciona.
- `F06-AC07` + `X-12`: B → 404 com `Evento não encontrado` e sem nome/local/id; participante → 403; visitante → 302 `/login…`; hash do evento e dos ingressos igual.
- `X-16`: evento com 2 confirmados (um com check-in feito por `POST /org/events/:id/checkin`) e 1 pendente → cancelar → check-in do código com check-in e do outro → `Evento cancelado`; painel: Confirmados 0, Pendentes 0, Check-ins 0, Receita `R$ 0,00`, Estornados 2 (comparado também com `getEventDashboard`).

`test/cancellation-concurrency.test.js`:
- `F06-AC08`: 5 rodadas, cada uma em evento novo de lotação 5: `Promise.all` de 30 `POST /api/partner/events/:id/purchases` (`0001`) + 1 `POST …/cancel` disparado junto (nas rodadas ímpares o cancelamento sai primeiro, nas pares depois de 20 ms). Por rodada: status ∈ {202, 409, 404}; nº de 202 ≤ 5; nº de ingressos no banco = nº de 202; zero `pending`/`confirmed`; 3 compras depois da resposta do cancelamento → 404 `event_not_available`. No total das rodadas, ≥ 1 resposta 404 dentro do lote.
- `F06-AC08` (cancelamento duplo): 3 rodadas com 2 `POST …/cancel` simultâneos → exatamente um 302 e um 409; ingressos transitam uma vez (contagens iguais às esperadas).
- `X-17`: 30 compras simultâneas `0001` em evento de lotação 5 → 5×202 e 25×409; em até 10 s o painel mostra Confirmados 5 e Vagas disponíveis 0; o código de um deles no check-in → `Entrada liberada`; repetido em 2 eventos.

Verificar: `./scripts/gates.sh` sai 0 e a saída lista os testes acima como `ok`.

## Etapa 9 — Verificação manual com o app no ar

- `./scripts/up.sh` (modo padrão, atrasos 2 s / 65 s).
- Executar o `contract.md` inteiro (F06-C01..C16), em especial o fluxo dos passos 12–14 do brief (F06-C07) com espera real de 75 s e o reinício (F06-C14).
- `./scripts/down.sh` ao final.

## Etapa 10 — Entrega

- `state.json`: F06 → `"status": "implemented"`, `pr` preenchido após abrir o PR.
- Commits atômicos em Conventional Commits, em português (ex.: `feat(cancelamento): serviço cancelEvent com trava do evento`, `feat(eventos): bloqueia edição e publicação de evento cancelado`, `test(cancelamento): critérios F06 e X-12..X-17`).
- PR para `main` descrevendo as alterações em arquivos de F02 (e de F03–F05, se alguma verificação cross-feature exigiu correção).
- A avaliação é feita por outro agente seguindo `contract.md`; o implementador não escreve relatório.
