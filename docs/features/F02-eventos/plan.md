# F02 — Gestão de eventos — plano de implementação

> Pré-requisito: F01 em `main` (W1). Trabalhe numa branch própria (ex.: `feat/f02-eventos`). Decisões técnicas em `spec.md`; o avaliador usa `contract.md`.
> Cada etapa termina com uma verificação. Não avance com verificação falhando.

## Etapa 0 — Preparação

- Ler `AGENTS.md`, `docs/prd.md` (F02, X-01, X-02, seções 10–11), `spec.md` e `contract.md`.
- Conferir no código de F01 os pontos assumidos na spec (seção 9): tipo de `users.id` em `db/migrations/001_users.sql`; sistema de módulos (ESM/CJS) e forma de registro em `src/app.js`; nomes dos campos do formulário de `/login`; se `express.urlencoded` já está global; como `./scripts/gates.sh` passa a URL base e o banco aos testes; se `test/` já tem helpers de login.
- Atualizar `state.json`: F02 → `in_progress`, `branch` preenchido.
- **Verificar:** `./scripts/gates.sh` passa em `main` antes de qualquer mudança (linha de base).

## Etapa 1 — Migração

- Arquivo: `db/migrations/002_events.sql` (DDL da spec, seção 2, com o tipo de `organizer_id` igual ao de `users.id`).
- **Verificar:** `./scripts/up.sh`; depois, no banco: `SELECT * FROM schema_migrations` lista a 002; `\d events` mostra as colunas e CHECKs; `INSERT` com `capacity=0`, `price_cents=0` ou `status='x'` falha (rodar em `BEGIN … ROLLBACK`).

## Etapa 2 — Textos e validação

- Arquivos: `src/features/events/texts.js`, `src/features/events/validation.js`, `test/events-validation.test.js`.
- Implementar `validateEventInput(form, { now })`, `toDatetimeLocalValue(date)`, `centsToInput(cents)` (spec, seção 5) e as constantes da seção 4.
- Testes de unidade (com `now` fixo):
  - cada campo vazio/inválido gera a mensagem exata da spec; múltiplos erros juntos;
  - tabela de preços da 5.4 (aceitos com centavos esperados; rejeitados);
  - lotação: `1` aceito; `0`, `-1`, `2.5`, `abc`, `99999999999` rejeitados;
  - data: `now + 1 min` aceito, `now − 1 min`, `now` exato e ontem rejeitados com `A data de início precisa estar no futuro.`; `2026-02-30T10:00`, `amanhã`, vazio rejeitados com `Informe uma data e hora de início válidas.`; com e sem segundos;
  - `centsToInput(123456)` = `1234,56` e o resultado passa de novo em `validateEventInput`; `toDatetimeLocalValue` faz ida e volta.
- **Verificar:** `./scripts/gates.sh` passa com os testes novos.

## Etapa 3 — Repositório

- Arquivo: `src/features/events/repo.js` (spec, seção 8.1).
- `getSeatStats` com o desvio `to_regclass('tickets')` (sem tabela → `occupied = 0`; com tabela → conta `pending`+`confirmed`, nome não qualificado).
- **Verificar:** etapa 6 cobre por teste; aqui, `node --check` nos arquivos (roda dentro dos gates).

## Etapa 4 — Serviço

- Arquivo: `src/features/events/service.js` (`createEvent`, `updateEvent`, `publishEvent`, spec 8.2 e seção 7).
- Garantir que a primeira consulta de `updateEvent` e `publishEvent` é `lockEvent` e que `getSeatStats` só é chamada depois dela.
- **Verificar:** coberto pelos testes da etapa 6.

## Etapa 5 — Views e rotas

- Arquivos: `src/features/events/views.js`, `src/features/events/routes.js`, `src/app.js` (**uma** linha registrando o router).
- Views: "Meus eventos", "Novo evento", página de gestão (ordem da spec 6.3), registro de seções (`registerManageSection`, `sendManagePage`, `sendEventNotFound`), 404 sem eco do id.
- Rotas: guarda `requireOrganizer` em tudo; `/org/events/new` antes de `/:id`; POSTs em `withTransaction`; 302/404/409/422 exatamente como a tabela da spec, seção 3.
- **Verificar (manual rápido):** `./scripts/up.sh`, login como org A com `curl -c`, `POST /org/events` → `302` com `Location: /org/events/evt_…`; `GET` dessa URL → `200` com `rascunho` e `action="/org/events/<id>/publish"`; como org B a mesma URL → `404` `Evento não encontrado`.

## Etapa 6 — Testes automatizados (rodam em `./scripts/gates.sh`)

- `test/support/events.js`: `loginAs`, `createEventHttp`, `publishEventHttp`, `localDateTime` (spec 8.5). Reutilizar helpers de F01, se existirem.
- `test/events-repo.test.js` (acesso direto ao banco de teste via `src/db.js`):
  - **AC08**: evento novo de lotação 5; sem vendas `getSeatStats` → `{capacity:5, occupied:0, available:5}`; dentro de `withTransaction`, `CREATE TEMP TABLE tickets (event_id text, status text) ON COMMIT DROP` com uma linha de cada status (`pending`, `confirmed`, `declined`, `cancelled`, `refunded`) → `{5, 2, 3}`; `updateEvent` com lotação 1 → `reason:'invalid'` e `errors.capacity === 'A lotação não pode ser menor que as vagas ocupadas (2)'`, linha intacta; com lotação 2 → `ok`.
  - **Trava**: cliente 1 faz `BEGIN` + `lockEvent`; cliente 2, com `SET LOCAL lock_timeout = '300ms'`, chama `updateEvent` e recebe erro de lock (`55P03`); após `COMMIT` do cliente 1, `updateEvent` do cliente 2 passa. Mesmo teste para `publishEvent`.
  - **AC10**: eventos de um organizador da seed em `draft`, `published` (dois, com `starts_at` diferentes) e `cancelled` (UPDATE via SQL): `listOnSaleEvents` contém só os publicados, todos os itens têm `status='published'` e a lista está ordenada por `starts_at`; `getOnSaleEvent` → linha para publicado, `null` para rascunho, cancelado e id inexistente.
- `test/events-http.test.js` (via `fetch` com cookie, `redirect: 'manual'`):
  - **AC01/X-02**: org A logado por `/login` cria → `302` para `/org/events/<id>`; linha `draft`, id `^evt_[a-z0-9]{10}$`, `organizer_id` = id de A; após `POST /logout`, `GET` da gestão → `302` para `/login?next=…`.
  - **AC02**: cada caso inválido → `422`, mensagem exata no HTML, contagem de `events` igual; valores digitados reexibidos.
  - **AC03**: os cinco formatos aceitos gravam 10000/10000/10000/10000/15050; os rejeitados dão `422`.
  - **AC04**: A e B criam eventos; a lista de cada um contém só os próprios links e o rótulo de status.
  - **AC05**: gestão do dono → `200` com nome, local, data `dd/mm/aaaa HH:mm`, `R$ 100,00`, `rascunho`, `action=…/publish` e `action=…/edit`; nova sessão abre a mesma URL.
  - **AC06**: publish → `302`, `published`; segundo publish → `302`, `updated_at` igual.
  - **AC07**: edição válida em rascunho e em publicado aplica; edição inválida (inclui data passada) → `422` e linha idêntica (`md5(row)` antes/depois).
  - **AC09**: B em `GET`, `POST …/edit`, `POST …/publish` do evento de A → `404`, corpo idêntico ao de `evt_zzzzzzzzzz`, sem nome/local/id; linha intacta.
  - **AC11**: criar com `localDateTime(+1)` aceito e `localDateTime(−1)` rejeitado; valor `YYYY-MM-DDTHH:mm` aparece como `DD/MM/YYYY HH:mm` na gestão.
  - **X-01**: visitante → `302 /login?next=…` em `GET /org/events/:id`; participante da seed → `403`, corpo sem nome/local/id; POSTs de visitante/participante não criam nem alteram linhas.
  - **Cancelado (guarda defensiva)**: `UPDATE events SET status='cancelled'` via SQL → gestão sem `action=…/edit` e sem `action=…/publish`, com `Este evento foi cancelado e não pode ser alterado.`; `POST …/edit` e `…/publish` → `409`, linha intacta.
  - **Robustez**: nome `<script>alert(1)</script>` aparece escapado na lista e na gestão; corpo vazio → `422`; campos extras `status=published&organizer_id=<B>` ignorados.
- Testes não assumem banco vazio: cada um cria seus eventos com nomes únicos e filtra por id.
- **Verificar:** `./scripts/gates.sh` sai 0; a saída lista os três arquivos `events-*.test.js` e `# fail 0`.

## Etapa 7 — Verificação manual com o app rodando

- `./scripts/up.sh` (ou `APP_PORT=3102 ./scripts/up.sh` se houver outro app na 3000).
- Executar, na ordem, todos os itens de `contract.md` (F02-C01 a F02-C20), como o avaliador faria, guardando as saídas.
- Conferir também pelo navegador: criar evento como A, ver na lista, abrir a gestão, publicar, editar; logar como B e abrir a URL copiada (404).
- `./scripts/down.sh` e `./scripts/up.sh` de novo: eventos criados continuam (volume mantido) e a migração 002 não é reaplicada (sem erro na subida).
- **Verificar:** todos os itens do contrato com o resultado esperado.

## Etapa 8 — Entrega

- Commits atômicos em Conventional Commits, em português (ex.: `feat(eventos): migração da tabela events`, `feat(eventos): rotas de gestão de eventos`, `test(eventos): testes de F02`), `git add` por caminho.
- Atualizar `state.json`: F02 → `implemented` (o avaliador, em outra sessão, muda para `evaluating`/`done`/`needs_fix` e preenche `latestReport`).
- Abrir o PR da branch para `main` com o resumo e o resultado de `./scripts/gates.sh`.
