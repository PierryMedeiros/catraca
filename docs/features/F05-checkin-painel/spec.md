# F05 — Check-in e painel: spec

> Fonte da verdade: `docs/prd.md` (seção 4, linha F05; critérios F05-AC01..AC10; X-09, X-10, X-11; decisões das seções 10 e 11).
> Regras do brief cobertas: R04 (seções na página de gestão), R05 (vagas no painel), R10 (check-in), R12 (painel), R13 (acesso), R03 (receita pelo preço de cada ingresso).
> Wave W4, em paralelo com F04. F05 **não** depende de F04 e não toca `src/features/partner/`.

## 1. Escopo

### Entra

- Seção **Check-in** na página de gestão `/org/events/:id` (de F02): campo de código + botão; resultado exibido na própria página.
- Rota `POST /org/events/:id/checkin` (só o organizador dono do evento).
- Função `checkInTicket(client, {eventId, code})` que aplica a tabela de R10 na ordem 1→5 e grava o check-in com UPDATE condicional.
- Seção **Painel** na página de gestão com os seis números de R12, calculados por `getEventDashboard(client, eventId)`.
- Aviso `Evento cancelado` acima do campo de check-in quando `events.status = 'cancelled'` (o campo continua ativo, PRD seção 11).
- Testes automatizados em `test/` que rodam em `./scripts/gates.sh`.

### Não entra

- Migrações: nenhuma. `tickets.checked_in`, `tickets.checked_in_at`, `tickets.price_cents`, `tickets.code` já existem desde `003_tickets.sql` (F03).
- Cancelamento do evento, botão "Cancelar evento", bloqueio de edição (F06). F05 só reage a `status='cancelled'` já gravado.
- API de parceiros (F04). Compras `channel='partner'` entram no painel porque F05 conta por `event_id`/`status`, sem filtrar canal.
- Desfazer check-in, check-in por QR/câmera, atualização em tempo real (fora de escopo, PRD seção 12).
- Textos novos para as mensagens de R10: todos vêm de `src/messages.js` (F01).

## 2. Modelo de dados

Sem DDL. Colunas lidas/escritas (todas de F02/F03):

| Tabela.coluna | Uso em F05 |
|---|---|
| `events.id`, `events.status`, `events.capacity`, `events.organizer_id` | ownership (via `getEventForOrganizer`), linha 2 de R10, vagas |
| `tickets.event_id`, `tickets.code` | localizar o ingresso **do evento** (linha 1 de R10) |
| `tickets.status` | linhas 3 de R10; contagens do painel |
| `tickets.checked_in`, `tickets.checked_in_at` | linha 4 de R10; escrita do check-in; Check-ins no painel |
| `tickets.price_cents` | Receita (preço gravado no ingresso, não o preço atual do evento) |
| `tickets.updated_at` | atualizado junto com o check-in |

Índices: a busca usa `tickets.code` (UNIQUE, F03) e `tickets.event_id`. Nenhum índice novo.

## 3. Rotas e telas

Todas as respostas HTML usam `layout({title, user, body})` e `escapeHtml` (F01). `Content-Type: text/html; charset=utf-8`.

### 3.1 `GET /org/events/:id` (rota de F02, seções acrescentadas por F05)

F02 renderiza a página; F05 contribui duas seções, nesta ordem, depois das seções de F02:

```html
<section id="checkin">
  <h2>Check-in</h2>
  <!-- só quando events.status = 'cancelled': -->
  <p id="checkin-event-cancelled">Evento cancelado</p>
  <!-- só na resposta do POST de check-in: -->
  <p id="checkin-result" data-result="entry_allowed">Entrada liberada</p>
  <p id="checkin-code">Código informado: K7Q2M9XA</p>
  <form method="post" action="/org/events/evt_xxxxxxxxxx/checkin">
    <label for="checkin-code-input">Código do ingresso</label>
    <input id="checkin-code-input" name="code" type="text" autocomplete="off" autofocus>
    <button type="submit">Fazer check-in</button>
  </form>
</section>
<section id="painel">
  <h2>Painel</h2>
  <dl>
    <dt>Confirmados</dt><dd data-metric="confirmed">3</dd>
    <dt>Pendentes</dt><dd data-metric="pending">0</dd>
    <dt>Check-ins</dt><dd data-metric="checkins">0</dd>
    <dt>Vagas disponíveis</dt><dd data-metric="available">0</dd>
    <dt>Receita</dt><dd data-metric="revenue">R$ 350,00</dd>
    <dt>Estornados</dt><dd data-metric="refunded">0</dd>
  </dl>
</section>
```

Regras de marcação (fazem parte do contrato, o avaliador faz `grep` nelas):

- Os elementos `<p id="checkin-result" data-result="KEY">TEXTO</p>`, `<p id="checkin-code">Código informado: CÓDIGO</p>` e `<p id="checkin-event-cancelled">Evento cancelado</p>` são emitidos **numa única linha cada, exatamente nesse formato** (atributos nessa ordem, sem espaços extras, sem atributos adicionais).
- Cada par do painel é emitido numa única linha, sem espaço entre as tags: `<dt>RÓTULO</dt><dd data-metric="M">VALOR</dd>`, na ordem confirmed, pending, checkins, available, revenue, refunded.
- O formulário abre exatamente com `<form method="post" action="/org/events/ID/checkin">`; o campo tem `name="code"` e não tem `disabled` (nem em evento cancelado).
- `<p id="checkin-event-cancelled">Evento cancelado</p>` vem antes do `<form>` dentro de `section#checkin`.
- `#checkin-result` e `#checkin-code` só aparecem na resposta do POST; o GET puro não os contém.
- Valores numéricos sem separador de milhar (`12`, não `1.2`); Receita por `formatBRL(cents)` com espaço ASCII (U+0020) entre `R$` e o número: `R$ 0,00`, `R$ 350,00`, `R$ 1.234,56`.
- O código informado é exibido normalizado e sempre escapado (`escapeHtml`).

### 3.2 `POST /org/events/:id/checkin`

| Item | Definição |
|---|---|
| Quem acessa | `requireOrganizer` (F01). Visitante → `302` para `/login?next=…` (guarda de F01). Participante → `403` (guarda de F01), sem dados do evento. |
| Ownership | Dentro de `withTransaction`, `getEventForOrganizer(client, id, req.user.id)`. `null` (inexistente ou de outro organizador) → `404` com a **mesma** resposta "Evento não encontrado" de F02 (corpo idêntico ao de id inexistente; não ecoa id, nome nem código). Nenhuma escrita. |
| Entrada | `application/x-www-form-urlencoded`, campo `code`. Campo ausente = string vazia. |
| Normalização | `normalizeCode(raw)` = `String(raw ?? '').trim().toUpperCase()`. |
| Validação | Não há rejeição 4xx por conteúdo do código: vazio, maior que 64 caracteres ou com caracteres fora de `[A-Z0-9]` resultam em `invalid_ticket` (linha 1 de R10: "não existe") **sem consultar o banco**. |
| Processamento | `checkInTicket(client, {eventId, code})` na mesma transação do ownership; commit. |
| Resposta | `200` com a página de gestão completa (mesmo HTML do GET de F02) renderizada **depois do commit**, com `#checkin-result` e `#checkin-code` preenchidos e o painel já refletindo o check-in. Sem redirect (permite ao avaliador ler o resultado de cada POST, inclusive em submissões simultâneas). |
| Erro inesperado | `500` genérico de F01; a transação é desfeita (nenhum `checked_in` muda). |

Mapeamento resultado → texto (texto vem de `src/messages.js`, nunca literal no código de F05):

| Linha R10 | `data-result` (chave) | Texto exibido |
|---|---|---|
| 1 | `invalid_ticket` | `Ingresso inválido para este evento` |
| 2 | `event_cancelled` | `Evento cancelado` |
| 3 | `not_confirmed` | `Ingresso não confirmado` |
| 4 | `already_used` | `Ingresso já utilizado` |
| 5 | `entry_allowed` | `Entrada liberada` |

O status HTTP é `200` para os cinco resultados (são resultados de negócio, não erros).

## 4. Funções providas (interfaces)

Arquivos em `src/features/checkin/` (sintaxe de módulo ilustrativa: segue o padrão de F01, ESM ou CommonJS; nomes e semântica são o contrato). Nomes marcados com (PRD) são fixados no PRD; os demais são **interfaces providas** escolhidas aqui, para consumo de F06 e do avaliador.

### `service.js`

```js
// (provida) chaves de resultado, na ordem de R10
export const CHECKIN_RESULTS = Object.freeze({
  INVALID: 'invalid_ticket',
  EVENT_CANCELLED: 'event_cancelled',
  NOT_CONFIRMED: 'not_confirmed',
  ALREADY_USED: 'already_used',
  ENTRY_ALLOWED: 'entry_allowed',
});

// (provida) chave → texto de src/messages.js
export function checkinMessage(resultKey) // → string exata do brief

// (provida)
export function normalizeCode(raw) // → string trim + maiúsculas

// (PRD) aplica R10; supõe que o chamador já validou o ownership do evento
export async function checkInTicket(client, { eventId, code }) // → uma das CHECKIN_RESULTS
```

Semântica de `checkInTicket` (o `client` está numa transação aberta pelo chamador):

1. `c = normalizeCode(code)`; se `c === ''`, `c.length > 64` ou `!/^[A-Z0-9]+$/.test(c)` → `invalid_ticket`.
2. `SELECT t.id, t.status, t.checked_in, e.status AS event_status FROM tickets t JOIN events e ON e.id = t.event_id WHERE t.code = $1 AND t.event_id = $2` (parametrizado).
3. Classificação na ordem da tabela de R10:
   - nenhuma linha → `invalid_ticket` (código inexistente **ou de outro evento**, inclusive de outro organizador; vale também com evento cancelado);
   - `event_status = 'cancelled'` → `event_cancelled` (qualquer status do ingresso);
   - `status <> 'confirmed'` → `not_confirmed` (`pending`, `declined`, `cancelled`, `refunded`);
   - `checked_in = true` → `already_used`;
   - senão, passo 4.
4. `UPDATE tickets SET checked_in = true, checked_in_at = now(), updated_at = now() WHERE id = $1 AND status = 'confirmed' AND checked_in = false RETURNING id`.
   - 1 linha → `entry_allowed`.
   - 0 linhas (outra transação fez o check-in ou o cancelamento de F06 mudou o status entre o SELECT e o UPDATE) → repete o SELECT do passo 2 (novo snapshot em READ COMMITTED) e reclassifica pelo passo 3; se a reclassificação ainda apontar para o passo 4, devolve `already_used`. **Nunca** devolve `entry_allowed` sem o UPDATE ter afetado 1 linha.

### `dashboard.js`

```js
// (PRD) números de R12; todos inteiros (Number, não string/bigint)
export async function getEventDashboard(client, eventId)
// → { confirmed, pending, checkIns, available, revenueCents, refunded }
```

- Uma consulta com `count(*) FILTER (...)` sobre `tickets WHERE event_id = $1`:
  - `confirmed` = `status = 'confirmed'` (inclui com check-in);
  - `pending` = `status = 'pending'`;
  - `checkIns` = `status = 'confirmed' AND checked_in`;
  - `revenueCents` = `COALESCE(sum(price_cents) FILTER (WHERE status = 'confirmed'), 0)`;
  - `refunded` = `status = 'refunded'`.
- `available` = `(await getSeatStats(client, eventId)).available` (F02/F03; R05 literal, inclusive em evento cancelado — PRD seção 11).
- Canal (`web`/`partner`) não filtra nada.

### `views.js`

```js
// (provida) HTML de section#checkin; ctx.checkin = {result, code} só no POST
export function renderCheckinSection(event, ctx = {})
// (provida) HTML de section#painel
export function renderDashboardSection(dashboard)
// (provida) seção registrada no mecanismo de F02: carrega o painel e devolve as duas seções
export async function renderManageSections(client, event, ctx = {}) // → string HTML
```

### `routes.js` e `index.js`

```js
// routes.js (provida)
export const checkinRouter // express.Router com POST /org/events/:id/checkin
// index.js (provida) — importado pela linha única de F05 em src/app.js
export function registerCheckinFeature(app) // registra checkinRouter e renderManageSections no mecanismo de seções de F02
```

## 5. Interfaces consumidas

| De | Interface | Uso |
|---|---|---|
| F01 | `requireOrganizer`, `req.user` (`src/auth.js`) | guarda da rota (visitante 302, participante 403) |
| F01 | `withTransaction(fn)`, `pool` (`src/db.js`) | transação do check-in; leitura do painel |
| F01 | `layout`, `escapeHtml` (`src/views/layout.js`) | HTML |
| F01 | `formatBRL(cents)` (`src/format.js`) | Receita |
| F01 | `src/messages.js` (as 5 mensagens de R10) | textos exatos; F05 importa pelos nomes de export fixados na spec de F01 |
| F02 | página `GET /org/events/:id`, `getEventForOrganizer(client, eventId, organizerId)`, 404 "Evento não encontrado" | ownership e página |
| F02 | view da página de gestão com seções extensíveis (`src/features/events/views.js`) | ver nota abaixo |
| F02/F03 | `getSeatStats(client, eventId)` → `{capacity, occupied, available}` | Vagas disponíveis |
| F03 | tabela `tickets` (`code`, `status`, `price_cents`, `checked_in`, `checked_in_at`, `channel`) | check-in e painel |

**Nota sobre o mecanismo de seções de F02.** O PRD só fixa "view da página de gestão com seções extensíveis". F05 precisa de duas capacidades, e assume estes nomes salvo se a spec de F02 fixar outros (nesse caso valem os de F02, e as interfaces providas por F05 acima não mudam):

- `registerManageSection(renderFn)` — `renderFn(client, event, ctx) → Promise<string>`; F02 chama as seções registradas, em ordem de registro, ao montar `GET /org/events/:id` (somente para o dono; nunca no 404).
- `renderManagePage(client, {event, user, ctx}) → Promise<string>` — HTML completo da página de gestão, usado pela resposta do POST de check-in com `ctx.checkin = {result, code}`.
- Helper de 404 de F02 (ex.: `sendEventNotFound(res, user)`) para responder com corpo idêntico ao de id inexistente.

Se F02 não oferecer registro de seções, F05 acrescenta a chamada a `renderManageSections` em `src/features/events/views.js` numa única linha, e registra isso no PR.

## 6. Concorrência

- **Duplo check-in (F05-AC06):** garantido pelo UPDATE condicional `WHERE id=$1 AND status='confirmed' AND checked_in=false` (PRD seção 10). Em READ COMMITTED, o segundo UPDATE espera o primeiro commit, reavalia a condição e afeta 0 linhas → `already_used`. N submissões simultâneas do mesmo código produzem exatamente 1 `entry_allowed` e N−1 `already_used`.
- **Check-in × cancelamento (F06):** o cancelamento muda `confirmed→refunded` com o evento travado; o UPDATE de check-in exige `status='confirmed'`, então perde a corrida e a reclassificação devolve `event_cancelled`. F05 não trava `events` (não lê nem altera vagas; regra 5 do AGENTS.md não se aplica).
- **Painel:** leitura simples, sem trava; reflete o estado commitado no momento do GET (recarregar basta, R12 + fora de escopo "tempo real").

## 7. Configuração

Nenhuma variável de ambiente nova. Usa as de F01/F03: `APP_PORT`, `DATABASE_URL` (ou equivalente de F01), `SESSION_SECRET`, `TZ`, e nos testes `GATEWAY_FAST_DELAY_MS`/`GATEWAY_SLOW_DELAY_MS` (definidas por `scripts/gates.sh`). Constante interna: tamanho máximo do código = 64 (`MAX_CODE_LENGTH` em `service.js`).

## 8. Estrutura de arquivos

```
src/features/checkin/
  index.js        registerCheckinFeature(app)
  routes.js       POST /org/events/:id/checkin
  service.js      CHECKIN_RESULTS, normalizeCode, checkinMessage, checkInTicket
  dashboard.js    getEventDashboard
  views.js        renderCheckinSection, renderDashboardSection, renderManageSections
src/app.js        +1 linha: registro de F05
test/
  f05-checkin.test.js      F05-AC01..AC06, AC10, X-09 (ordem de R10, normalização, concorrência)
  f05-painel.test.js       F05-AC07, AC08 (todos os status, conferência contra SQL, Receita)
  f05-acesso.test.js       F05-AC09, X-10 (B → 404, participante → 403, visitante → login)
  f05-integracao.test.js   X-11 (vitrine + worker + purchaseTicket partner → check-in e painel)
  helpers/f05-fixtures.js  inserção de eventos/ingressos por SQL e login por fetch (sem efeitos ao importar)
```

Arquivos que F05 **não** toca: `db/migrations/*`, `src/features/partner/*` (F04), `src/features/events/*` (exceto a linha única descrita na nota da seção 5, se necessária), `src/messages.js` (só lê). Exceção documentada: se `formatBRL` emitir espaço não separável (U+00A0, típico de `Intl.NumberFormat`), a correção é feita em `src/format.js` (único lugar) e registrada no PR, porque o brief exige `R$ 350,00` com espaço comum.

## 9. Textos exatos do brief

| Texto | Onde aparece | Origem |
|---|---|---|
| `Ingresso inválido para este evento` | `#checkin-result` | `src/messages.js` |
| `Evento cancelado` | `#checkin-result` e `#checkin-event-cancelled` | `src/messages.js` |
| `Ingresso não confirmado` | `#checkin-result` | `src/messages.js` |
| `Ingresso já utilizado` | `#checkin-result` | `src/messages.js` |
| `Entrada liberada` | `#checkin-result` | `src/messages.js` |
| Rótulos do painel: `Confirmados`, `Pendentes`, `Check-ins`, `Vagas disponíveis`, `Receita`, `Estornados` | `<dt>` em `#painel` | tabela de R12; constantes em `views.js` (não são mensagens de `messages.js`) |

Nenhum arquivo em `src/features/checkin/` contém literalmente as cinco mensagens de R10 (verificado por `grep` no contrato).

## 10. Decisões tomadas aqui (não fixadas no PRD)

| Ponto | Decisão |
|---|---|
| Resposta do POST | `200` com a página completa, sem redirect; resultado em `#checkin-result[data-result]`. |
| Chaves de resultado | `invalid_ticket`, `event_cancelled`, `not_confirmed`, `already_used`, `entry_allowed`. |
| Código vazio/ausente/longo/caracteres inválidos | `invalid_ticket`, status 200, sem consulta ao banco. |
| Marcação do painel | `<dd data-metric="M">`, com M em `confirmed`, `pending`, `checkins`, `available`, `revenue`, `refunded`. |
| Ordem das seções | Check-in, depois Painel, após as seções de F02. |
| Eco do código | `#checkin-code` mostra o código normalizado, escapado; nunca no 404. |
