# F02 — Gestão de eventos — spec

> Feature F02 do `docs/prd.md` (wave W2, consome F01). Regras do brief cobertas: R01, R02, R03 (parte da lotação), R04, R05 (cálculo de vagas), R13 (parte de eventos).
> Critérios: F02-AC01 a F02-AC11, X-01, X-02. Contrato: `contract.md`. Plano: `plan.md`.

## 1. Escopo

### Entra

- Migração `db/migrations/002_events.sql` com a tabela `events`.
- Área do organizador em `/org/events`: listar os próprios eventos, criar, abrir a página de gestão (`/org/events/:id`), editar e publicar.
- Ownership (R13): cada organizador só vê e opera os próprios eventos; evento de outro organizador responde exatamente como evento inexistente (404 `Evento não encontrado`).
- Validação de entrada de evento (R01), com os formatos de preço e data decididos no PRD (seção 11).
- Funções de repositório consumidas por F03, F04, F05 e F06: `lockEvent`, `getSeatStats`, `getEventForOrganizer`, `listOnSaleEvents`, `getOnSaleEvent`, mais `validateEventInput`.
- Regra de lotação × vagas ocupadas (R03) na edição, dentro de transação travada pelo evento (decisão de concorrência do PRD, seção 10).
- Página de gestão com **seções extensíveis** (registro de seções), para F05 (Check-in, Painel) e F06 (Cancelar evento) acrescentarem conteúdo sem editar arquivos de F02.
- Guarda defensiva para evento `cancelled` (estado que só F06 produz, ou SQL nos testes): sem formulário de edição nem botão Publicar, e `POST …/edit` / `POST …/publish` recusados sem alterar a linha. F06 verifica isso de novo em F06-AC03 depois do cancelamento real.

### Não entra (fica para outras features)

- Vitrine pública, compra, tabela `tickets`, gateway (F03). Em F02 não existe ingresso; `getSeatStats` já sabe contar ingressos quando a tabela existir (seção 6.2).
- API de parceiros (F04).
- Check-in e painel (F05): F02 só oferece o ponto de extensão na página de gestão.
- Cancelamento (F06): rota `POST /org/events/:id/cancel`, botão e transições de ingressos.
- Exclusão de evento, despublicar, reverter cancelamento, paginação (fora de escopo pelo PRD, seção 12).

## 2. Modelo de dados — `db/migrations/002_events.sql`

```sql
CREATE TABLE events (
  id           text        PRIMARY KEY CHECK (id ~ '^evt_[a-z0-9]{10}$'),
  organizer_id text        NOT NULL REFERENCES users(id),
  name         text        NOT NULL CHECK (btrim(name) <> ''),
  starts_at    timestamptz NOT NULL,
  venue        text        NOT NULL CHECK (btrim(venue) <> ''),
  capacity     integer     NOT NULL CHECK (capacity >= 1),
  price_cents  integer     NOT NULL CHECK (price_cents > 0),
  status       text        NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'published', 'cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz
);

CREATE INDEX events_organizer_starts_idx ON events (organizer_id, starts_at);
CREATE INDEX events_status_starts_idx    ON events (status, starts_at);
```

- `organizer_id` **usa o mesmo tipo de `users.id` definido em `001_users.sql` (F01)**. O DDL acima assume `text` (ids gerados por `newId`). Se F01 tiver escolhido outro tipo (ex.: `bigint`), a migração usa esse tipo; a FK é obrigatória.
- `starts_at` é `timestamptz`: o instante absoluto é gravado; a interpretação do `datetime-local` usa o `TZ` do container (seção 5.3).
- `cancelled_at` fica nulo em F02; F06 preenche. Não há CHECK amarrando `status` a `cancelled_at`, para que testes possam pôr `status='cancelled'` via SQL.
- O runner de F01 aplica o arquivo na subida e o registra em `schema_migrations`.

## 3. Rotas

Todas ficam em `src/features/events/routes.js` (um `express.Router()`), registradas em `src/app.js` com **uma linha**. Todas passam antes por `requireOrganizer` (F01):

- visitante → `302` para `/login?next=<caminho>` (comportamento de F01);
- participante → `403` (página de F01, sem dados de evento);
- organizador → segue.

O guarda roda **antes** de qualquer leitura de evento e antes da validação do corpo. `/org/events/new` é declarada antes de `/org/events/:id`. Corpo dos POSTs: `application/x-www-form-urlencoded` (se F01 não registrar `express.urlencoded({ extended: false })` globalmente, o router registra). Campos extras no corpo (ex.: `status`, `organizer_id`, `id`) são **ignorados**.

| Método e caminho | Entradas | Sucesso | Falhas |
|---|---|---|---|
| `GET /org/events` | — | `200`, página "Meus eventos" (6.1) | — |
| `GET /org/events/new` | — | `200`, formulário "Novo evento" | — |
| `POST /org/events` | `name`, `startsAt`, `venue`, `capacity`, `price` | `302` `Location: /org/events/<id>`; linha nova `status='draft'`, `organizer_id = req.user.id` | `422`, formulário reexibido com os valores digitados e os erros (seção 5); nenhuma linha criada |
| `GET /org/events/:id` | — | `200`, página de gestão (6.2) | `404` `Evento não encontrado` se não existe ou não é do logado |
| `POST /org/events/:id/edit` | mesmos campos da criação | `302` `Location: /org/events/<id>`; linha atualizada, `updated_at = now()` | `404` (não existe/não é dono); `409` se `cancelled`; `422` com a página de gestão reexibida (formulário com os valores digitados e erros), linha intacta |
| `POST /org/events/:id/publish` | — | `302` `Location: /org/events/<id>`; `draft` → `published` (`updated_at = now()`); se já `published`, `302` sem alterar nada (nem `updated_at`) | `404` (não existe/não é dono); `409` se `cancelled`, linha intacta |

Detalhes:

- **404 de ownership (R13, F02-AC09).** Resposta `404` com o layout de F01 e o corpo principal `<h1>Evento não encontrado</h1>`. O corpo **não** repete o id da URL, nem nome/local do evento. Para o mesmo usuário logado, o HTML de "não é seu" e de "não existe" é byte a byte idêntico. Ids em formato inválido (ex.: `abc`, `evt_x' OR '1'='1`) dão o mesmo 404 (consulta parametrizada).
- **409 de evento cancelado.** Página de gestão com status `409` e o aviso `Este evento foi cancelado e não pode ser alterado.`; nenhuma coluna muda.
- **Redirecionamentos** usam `res.redirect(302, '/org/events/<id>')` (Location relativa).
- **Concorrência.** `POST …/edit` e `POST …/publish` rodam em `withTransaction`; a **primeira** consulta da transação é `lockEvent(client, id)`. Quem decide alguma coisa sobre vagas o faz depois dessa trava (seção 7).

## 4. Textos

Os textos do brief (`Ingressos esgotados`, mensagens de check-in, códigos da API) estão em `src/messages.js` (F01) e **não são usados nem reescritos** por F02, que não exibe nenhum deles. Os textos próprios de F02 ficam em `src/features/events/texts.js` (para não editar `src/messages.js`, arquivo de F01) e são exibidos exatamente assim:

| Chave | Texto exato |
|---|---|
| `NOT_FOUND` | `Evento não encontrado` |
| `CANCELLED_LOCKED` | `Este evento foi cancelado e não pode ser alterado.` |
| `FORM_INVALID` | `Não foi possível salvar. Corrija os campos indicados.` |
| `NAME_REQUIRED` | `Informe o nome do evento.` |
| `VENUE_REQUIRED` | `Informe o local do evento.` |
| `STARTS_AT_INVALID` | `Informe uma data e hora de início válidas.` |
| `STARTS_AT_PAST` | `A data de início precisa estar no futuro.` |
| `CAPACITY_INVALID` | `A lotação deve ser um número inteiro maior ou igual a 1.` |
| `PRICE_INVALID` | `Informe um preço maior que zero, em reais, com até 2 casas decimais (ex.: 100,00).` |
| `capacityBelowOccupied(n)` | `A lotação não pode ser menor que as vagas ocupadas (N)` — N é o número de vagas ocupadas; texto do PRD (F02-AC08), sem ponto final |
| `STATUS_LABELS` | `draft` → `rascunho`, `published` → `publicado`, `cancelled` → `cancelado` |
| `EMPTY_LIST` | `Você ainda não criou eventos.` |

Nenhum desses textos contém `"`, `'`, `<`, `>` ou `&`, então aparecem idênticos no HTML depois de `escapeHtml`.

## 5. Validação — `validateEventInput(form, { now = new Date() } = {})`

Arquivo `src/features/events/validation.js` (reexportada por `repo.js`, que é onde o PRD a lista). Entrada: objeto com strings `name`, `startsAt`, `venue`, `capacity`, `price` (ausente = string vazia). Todos os campos passam por `trim()` antes das regras. Todos os erros são coletados (não para no primeiro).

Retorno:

- `{ ok: true, value: { name, venue, startsAt: Date, capacity: number, priceCents: number } }`
- `{ ok: false, errors: { <campo>: <texto da seção 4> }, values: { name, startsAt, venue, capacity, price } }` (`values` = strings após trim, para reexibir o formulário).

### 5.1 Nome e local

Vazios após trim → `NAME_REQUIRED` / `VENUE_REQUIRED`. Gravados já com trim.

### 5.2 Lotação (`capacity`)

Aceita só `^\d+$` com valor inteiro entre 1 e 2147483647 (limite de `integer`). Rejeita (`CAPACITY_INVALID`): vazio, `0`, `-1`, `2.5`, `2,5`, `abc`, `1e3`, `99999999999`.

### 5.3 Início (`startsAt`) — R01, F02-AC11

- Formato do `<input type="datetime-local">`: `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$` (segundos opcionais). Fora disso, ou data inexistente (ex.: `2026-02-30T10:00`, que `new Date` "rolaria" para 2 de março), → `STARTS_AT_INVALID`. A checagem de data inexistente compara ano/mês/dia/hora/minuto do `Date` construído com os da string.
- Interpretação: `new Date('YYYY-MM-DDTHH:mm[:ss]')` sem offset, ou seja, horário local do processo Node, que roda com o `TZ` do container (F01 repassa o fuso do host; fallback `America/Sao_Paulo`).
- Regra: `startsAt.getTime() > now.getTime()` (estritamente no futuro, no momento de salvar, ao criar **e** ao editar). Senão → `STARTS_AT_PAST`. Hora atual + 1 min é aceita; hora atual − 1 min e ontem são rejeitadas; "igual a agora" é rejeitado.
- Exibição: `formatDateTime(date)` de F01 → `dd/mm/aaaa HH:mm` no `TZ` do container.
- Pré-preenchimento do formulário de edição: `toDatetimeLocalValue(date)` (F02, em `validation.js`) → `YYYY-MM-DDTHH:mm` no horário local.

### 5.4 Preço (`price`) — R01, F02-AC03

1. Depois do trim, precisa casar `^(R\$\s*)?\d+([.,]\d{1,2})?$` (R$ e espaços opcionais, vírgula **ou** ponto decimal, até 2 casas, sem separador de milhar, sem sinal).
2. Se casar, `priceCents = parseBRL(str)` (F01). O resultado precisa ser inteiro, `> 0` e `≤ 2147483647`; se `parseBRL` lançar exceção ou devolver algo diferente disso → `PRICE_INVALID`.

| Entrada | Resultado |
|---|---|
| `100`, `100,00`, `100.00`, `R$ 100,00` | 10000 |
| `150,5` | 15050 |
| `1.234,56`, `10,123`, `abc`, `-5`, `0`, `0,00`, `` (vazio), `100,`, `,50`, `99999999999` | `PRICE_INVALID` |

- Exibição: `formatBRL(cents)` de F01 (ex.: `R$ 100,00`, com espaço comum U+0020 entre `R$` e o número).
- Pré-preenchimento do formulário de edição: `centsToInput(cents)` (F02, em `validation.js`) → `1234,56` (sem `R$` e sem separador de milhar, para que reenviar o formulário sem mudar nada continue válido; `formatBRL` daria `R$ 1.234,56`, que a regra 1 rejeita).

## 6. Telas (HTML renderizado no servidor, sempre via `layout` de F01, valores dinâmicos via `escapeHtml`)

### 6.1 `GET /org/events` — "Meus eventos"

- `<h1>Meus eventos</h1>`, link `<a href="/org/events/new">Novo evento</a>`.
- Tabela com **somente** eventos `organizer_id = req.user.id`, ordenados por `starts_at` ascendente e depois `created_at`. Colunas: Nome (link `<a href="/org/events/<id>">nome</a>`), Início (`dd/mm/aaaa HH:mm`), Status (rótulo `rascunho`/`publicado`/`cancelado`). Cada evento gera exatamente um `href="/org/events/evt_…"`.
- Sem eventos: `Você ainda não criou eventos.`

### 6.2 `GET /org/events/new` — "Novo evento"

`<h1>Novo evento</h1>` e `<form method="post" action="/org/events">` com os campos `name` (texto), `startsAt` (`datetime-local`), `venue` (texto), `capacity` (`number`, `min="1"`, `step="1"`), `price` (texto, placeholder `100,00`) e o botão `Criar evento`. No `422`: `FORM_INVALID` no topo, cada erro junto do campo, valores digitados de volta nos campos (escapados).

### 6.3 `GET /org/events/:id` — página de gestão (R04)

URL estável `/org/events/<id>`, reabrível diretamente (sem estado de sessão além do login). Ordem do conteúdo:

1. `<h1>` com o nome do evento e `Status: <rótulo>`.
2. Seção "Dados" (`<section data-section="dados">`): Início `dd/mm/aaaa HH:mm`, Local, Lotação (número), Preço (`formatBRL`).
3. Se `status='draft'`: `<form method="post" action="/org/events/<id>/publish">` com o botão `Publicar`. Não aparece em `published` nem `cancelled`.
4. Se `status<>'cancelled'`: seção "Editar evento" com `<form method="post" action="/org/events/<id>/edit">`, os mesmos campos da criação pré-preenchidos (`toDatetimeLocalValue`, `centsToInput`) e o botão `Salvar alterações`. No `422`, os valores digitados e os erros (incluindo `capacityBelowOccupied(n)` no campo lotação).
5. Se `status='cancelled'`: o aviso `Este evento foi cancelado e não pode ser alterado.` no lugar dos itens 3 e 4.
6. Seções registradas por outras features (6.4), em ordem crescente de `order`.
7. Link `<a href="/org/events">Voltar para meus eventos</a>`.

Os atributos `action="/org/events/<id>/publish"` e `action="/org/events/<id>/edit"` aparecem literalmente assim no HTML (o avaliador procura por eles).

### 6.4 Seções extensíveis (interface provida) — `src/features/events/views.js`

```js
registerManageSection({ key, order, render })
// key: string única (ex.: 'checkin', 'dashboard', 'cancel'); registrar a mesma key de novo substitui.
// order: número; F02 reserva < 100 para si. Sugestão: F05 check-in 200, painel 300; F06 cancelar 400.
// render: async ({ client, event, user, context }) => string HTML já escapado ('' para não exibir).
//   event = linha de events (seção 8.1); context = objeto livre passado por quem renderiza.

sendManagePage(req, res, { event, status = 200, context = {}, editErrors, editValues, notice })
// Renderiza a página de gestão completa (6.3) com as seções registradas, usando um client do pool,
// e envia com o status dado. Usada por GET /org/events/:id, pelos 422/409 de F02 e por F05/F06
// (ex.: POST /org/events/:id/checkin responde com sendManagePage(req, res, { event, context: { checkinMessage } })).

sendEventNotFound(req, res)
// Envia o 404 padrão (seção 3). F05 e F06 usam para ownership, garantindo 404 idêntico.

renderEventsList({ user, events }), renderNewEventForm({ user, values, errors })
// Renderização pura; usadas só por F02.
```

Cada feature registra suas seções no próprio módulo de rotas (executado quando `src/app.js` o importa), sem editar arquivos de F02.

## 7. Concorrência

- Decisão transversal do PRD: operação que lê e altera vagas de um evento roda em `withTransaction` e começa com `lockEvent` (`SELECT * FROM events WHERE id = $1 FOR UPDATE`).
- Em F02 isso vale para `POST …/edit` (lotação × ocupadas, R03) e também para `POST …/publish` (serializa com o cancelamento de F06, que trava a mesma linha).
- Sequência de `updateEvent`: `lockEvent` → linha `null` ou de outro dono → `{reason:'not_found'}` → `status='cancelled'` → `{reason:'cancelled'}` → `validateEventInput` (erro → `{reason:'invalid'}`) → `getSeatStats(client, id)` **dentro da trava** → se `capacity < occupied` → erro `capacityBelowOccupied(occupied)` → `UPDATE events SET name, starts_at, venue, capacity, price_cents, updated_at = now() WHERE id = $1`.
- Como a compra de F03 também começa com `lockEvent`, uma redução de lotação e uma compra simultâneas são serializadas: ou a compra vê a lotação nova, ou a edição vê a vaga ocupada pela compra.
- Publish: `lockEvent` → checagens → `UPDATE events SET status='published', updated_at=now() WHERE id=$1 AND status='draft'` (repetir não muda nada).
- Mudança de preço vale para compras posteriores: F02 só altera `events.price_cents`; F03 copia o preço vigente para `tickets.price_cents` na compra (X-04, contrato de F03).

## 8. Interfaces providas

### 8.1 `src/features/events/repo.js`

`client` = qualquer objeto com `.query` do `pg` (`pool` ou `PoolClient`); `lockEvent` exige `PoolClient` dentro de transação. As funções devolvem a linha crua de `events` com as colunas em snake_case: `{ id, organizer_id, name, starts_at (Date), venue, capacity (number), price_cents (number), status, created_at, updated_at, cancelled_at }`.

| Função | Semântica |
|---|---|
| `lockEvent(client, eventId)` | `SELECT * FROM events WHERE id = $1 FOR UPDATE`; devolve a linha ou `null`. Não filtra status nem dono. |
| `getSeatStats(client, eventId)` | `{ capacity, occupied, available }` (números, nessa ordem de chaves), com `occupied` = ingressos `pending` + `confirmed` do evento e `available = capacity − occupied` (R05 literal); `null` se o evento não existe. Implementação de F02: consulta `SELECT to_regclass('tickets') IS NOT NULL`; se a tabela não existe (antes de F03), `occupied = 0`; se existe, `SELECT count(*) FROM tickets WHERE event_id = $1 AND status IN ('pending','confirmed')` (nome **não qualificado** `tickets`). F03 pode substituir o corpo por consulta direta, mantendo assinatura, retorno e o nome não qualificado (o teste de F02-AC08 cria uma tabela `TEMP tickets` que sombreia a real). |
| `getEventForOrganizer(client, eventId, organizerId)` | `SELECT * FROM events WHERE id = $1 AND organizer_id = $2`; linha ou `null` (não existe **ou** não é do organizador; quem chama não distingue). Qualquer status. |
| `listEventsForOrganizer(client, organizerId)` | eventos do organizador, `ORDER BY starts_at, created_at` (usada por `GET /org/events`; nome escolhido por F02). |
| `listOnSaleEvents(client)` | `SELECT * FROM events WHERE status = 'published' ORDER BY starts_at, id`. Não calcula vagas (quem precisa chama `getSeatStats`). Evento esgotado continua listado. |
| `getOnSaleEvent(client, eventId)` | linha se `status = 'published'`, senão `null` (rascunho, cancelado, inexistente). Sem trava; para decidir compra, F03 usa `lockEvent` e confere o status na linha travada. |
| `validateEventInput` | reexportada de `validation.js` (seção 5). |

### 8.2 `src/features/events/service.js` (nomes escolhidos por F02)

Todas recebem um `PoolClient` **dentro de transação** (`withTransaction`).

| Função | Retorno |
|---|---|
| `createEvent(client, { organizerId, input, now })` | `{ ok: true, event }` ou `{ ok: false, reason: 'invalid', errors, values }`. Gera `id = newId('evt')` (F01) e insere com `status='draft'`. |
| `updateEvent(client, { eventId, organizerId, input, now })` | `{ ok: true, event }`, `{ ok: false, reason: 'not_found' }`, `{ ok: false, reason: 'cancelled' }` ou `{ ok: false, reason: 'invalid', errors, values }` (inclui `errors.capacity = capacityBelowOccupied(n)`). Primeira consulta: `lockEvent`. |
| `publishEvent(client, { eventId, organizerId })` | `{ ok: true, changed: boolean }`, `{ ok: false, reason: 'not_found' }` ou `{ ok: false, reason: 'cancelled' }`. Primeira consulta: `lockEvent`. |

`now` é opcional (padrão `new Date()`), para testes. A comparação de dono é `String(event.organizer_id) === String(organizerId)`.

### 8.3 `src/features/events/validation.js`

`validateEventInput`, `toDatetimeLocalValue(date)`, `centsToInput(cents)` (seção 5).

### 8.4 `src/features/events/texts.js`

Constantes da seção 4 (`EVENT_TEXTS`, `EVENT_STATUS_LABELS`, `capacityBelowOccupied(n)`), para F05/F06 exibirem rótulos e o 404 iguais.

### 8.5 `test/support/events.js` (apoio a testes, reutilizável por F03–F06)

`loginAs(email, password = 'catraca123')` → string do cookie de sessão; `createEventHttp(cookie, fields)` → `{ status, location, id }`; `publishEventHttp(cookie, id)`; `localDateTime(offsetMinutes, { seconds = true })` → string `datetime-local` no fuso do processo. Se F01 já fornecer helpers equivalentes em `test/`, este arquivo os reutiliza em vez de duplicar.

## 9. Interfaces consumidas (F01)

| Interface | Uso em F02 | Semântica assumida |
|---|---|---|
| `requireOrganizer`, `req.user` (`src/auth.js`) | guarda de todas as rotas | visitante 302 `/login?next=…`, participante 403, organizador segue com `req.user.id` |
| `withTransaction(fn)`, `pool` (`src/db.js`) | edição, publicação, criação; leituras | `fn(client)` em BEGIN/COMMIT, ROLLBACK em exceção |
| `newId(prefix)` (`src/ids.js`) | `newId('evt')` → `evt_` + 10 de `[a-z0-9]` | |
| `parseBRL(str)` (`src/format.js`) | preço, depois do regex da 5.4 | devolve centavos inteiros |
| `formatBRL(cents)`, `formatDateTime(date)` (`src/format.js`) | exibição | `R$ 1.234,56` (espaço comum), `dd/mm/aaaa HH:mm` no `TZ` |
| `layout({ title, user, body })`, `escapeHtml` (`src/views/layout.js`) | todas as páginas | |
| runner de migrações, `schema_migrations` | aplica `002_events.sql` | |
| tabela `users` (`id`, `email`, `role`) | FK `organizer_id`; contas da seed | |
| `/login`, `/logout`, seed | testes e contrato | org A `org.a@catraca.local`, org B `org.b@catraca.local`, participante `participante@catraca.local`, senha `catraca123`; campos do formulário de login `email` e `password` |
| harness de testes (`./scripts/gates.sh`) | roda `test/events-*.test.js` | o processo de teste acessa o app por HTTP (URL base fornecida pelo harness) e o banco de teste pelo `src/db.js`; app e testes rodam com o mesmo `TZ` |

## 10. Configuração

F02 não cria variáveis de ambiente. Usa as de F01: `DATABASE_URL` (ou equivalente lido por `src/db.js`), `TZ` (interpretação e exibição de datas), `SESSION_SECRET`, `APP_PORT` (porta do host). Não depende das variáveis do gateway.

## 11. Estrutura de arquivos

```
db/migrations/002_events.sql
src/features/events/texts.js
src/features/events/validation.js     validateEventInput, toDatetimeLocalValue, centsToInput
src/features/events/repo.js           lockEvent, getSeatStats, getEventForOrganizer, listEventsForOrganizer,
                                      listOnSaleEvents, getOnSaleEvent (+ reexporta validateEventInput)
src/features/events/service.js        createEvent, updateEvent, publishEvent
src/features/events/views.js          layouts das telas, registerManageSection, sendManagePage, sendEventNotFound
src/features/events/routes.js         express.Router com as 6 rotas
src/app.js                            + 1 linha: registro do router de eventos
test/support/events.js                helpers de teste
test/events-validation.test.js        unidade: validateEventInput e helpers (AC02, AC03, AC11)
test/events-repo.test.js              funções de repo/service contra o banco (AC08, AC10, trava)
test/events-http.test.js              rotas via fetch (AC01, AC02, AC04–AC07, AC09, AC11, X-01, X-02, cancelado)
```

O módulo de rotas segue o sistema de módulos escolhido por F01 (ESM ou CommonJS) e exporta o router da mesma forma que as outras features registram em `src/app.js`.

## 12. Decisões registradas

| Ponto | Decisão |
|---|---|
| 404 × 403 para outro organizador | 404 idêntico ao inexistente (PRD 11); participante 403 vem do guarda de F01 |
| Segundos no `datetime-local` | aceitos (opcionais), para permitir testar "agora ± 1 min" sem ambiguidade de truncamento |
| Limites numéricos | lotação e centavos ≤ 2147483647 (tipo `integer`); acima disso, erro de validação (nunca 500) |
| Campos extras no POST | ignorados (não há como forçar `status`, `organizer_id` ou `id`) |
| Evento cancelado em F02 | guarda defensiva (409, sem formulários); F06 mantém e verifica |
| Publish trava o evento | sim, para serializar com o cancelamento de F06 |
| Textos próprios | `src/features/events/texts.js`, não `src/messages.js` (que é de F01 e só tem textos do brief) |
| Ordenação | "Meus eventos" e `listOnSaleEvents` por `starts_at` ascendente |
