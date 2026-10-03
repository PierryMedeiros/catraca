# F06 — Cancelamento de evento: spec

> Fonte da verdade: `docs/prd.md` (seção 4, linha F06; critérios F06-AC01..AC08; X-12..X-17; decisões das seções 10 e 11).
> Regras do brief cobertas: R11 (principal), R02, R04, R07, R09, R10, R12, R13.
> Wave W5: só começa com F01–F05 em `main`.

## 1. Escopo

### Entra

- Rota `POST /org/events/:id/cancel` (só o organizador dono, só evento `published`).
- Serviço `cancelEvent(client, {eventId, organizerId})`: numa única transação iniciada por `lockEvent`, muda o evento para `cancelled` (com `cancelled_at`) e transita **todos** os ingressos do evento: `confirmed` → `refunded`, `pending` → `cancelled`. O prazo de 10 s do R11 é cumprido por ser imediato (PRD seção 11).
- Seção "Cancelamento" na página de gestão (`/org/events/:id`, view de F02): botão "Cancelar evento" com confirmação em evento publicado; aviso de evento cancelado em evento cancelado; nada em rascunho.
- Irreversibilidade: em evento `cancelled`, a página de gestão não mostra formulário de edição, botão "Publicar" nem "Cancelar evento"; `POST /org/events/:id/edit`, `/publish` e `/cancel` respondem 409 sem alterar nada. Isso exige alterar os handlers de edição e publicação de F02 (permitido: F06 é a única feature da W5).
- Testes automatizados de F06 e dos critérios cross-feature cujo contrato é F06 (X-12..X-17).

### Não entra

- Cancelar rascunho (rejeitado com mensagem, F06-AC06), reverter cancelamento, excluir evento, reembolso parcial, cancelamento de ingresso pelo participante (PRD seção 12).
- Notificação/e-mail aos compradores.
- Mudanças em vitrine, API de parceiros, check-in e painel: o comportamento após o cancelamento (sumir da vitrine/API, `404 event_not_available`, `Evento cancelado` no check-in, Estornados no painel) **já vem** de F02–F05 porque todos filtram por `events.status`/`tickets.status`. F06 só verifica (X-13..X-16); se algo falhar ali, a correção é no arquivo da feature dona, registrada no PR de F06.
- Gateway: nenhuma mudança. A proteção contra resposta tardia é o UPDATE condicional `WHERE id=$1 AND status='pending'` do worker de F03 (AGENTS.md regra 6).

## 2. Modelo de dados

**Nenhuma migração nova.** Tudo que F06 precisa já existe:

| Objeto | Origem | Uso em F06 |
|---|---|---|
| `events.status` (`draft\|published\|cancelled`) | F02 `002_events.sql` | passa a `cancelled` |
| `events.cancelled_at` (timestamptz, nulo) | F02 `002_events.sql` | preenchido com `now()` |
| `events.updated_at` | F02 | `now()` |
| `tickets.status` (aceita `cancelled` e `refunded`) | F03 `003_tickets.sql` | transição em lote |
| `tickets.updated_at` | F03 | `now()` nas linhas transitadas |
| `tickets.checked_in` | F03 | **não é alterado** (estornado continua com o histórico de check-in) |

Pré-condição verificada na etapa 1 do plano: o CHECK de `tickets.status` de F03 aceita `cancelled` e `refunded`, e o de `events.status` aceita `cancelled`. Só se faltar, F06 cria `db/migrations/004_cancelamento_status.sql` (próximo número livre; F04/F05 não têm migração) com:

```sql
-- só se 003 não aceitar os valores
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('pending','confirmed','declined','cancelled','refunded'));
```

## 3. Rotas e telas

Todas as rotas abaixo ficam atrás de `requireOrganizer` (F01): visitante → `302` para `/login?next=…`; participante → `403` (página de F01, sem dados de evento). Ordem de verificação em qualquer rota de escrita sobre um evento: **guarda de papel → existência/dono (404) → estado do evento (409) → validação do corpo (422)**.

### 3.1 `POST /org/events/:id/cancel` (nova, F06)

| Item | Valor |
|---|---|
| Quem | organizador dono do evento |
| Entrada | nenhum campo obrigatório; corpo ignorado |
| Execução | `withTransaction(client => cancelEvent(client, {eventId: req.params.id, organizerId: req.user.id}))` |

| Resultado de `cancelEvent` | Resposta HTTP |
|---|---|
| `{ok:true,…}` | `302`, `Location: /org/events/:id` |
| `{ok:false, error:'not_found'}` (inexistente ou de outro organizador) | `404`, mesma página de F02 com `Evento não encontrado`; o corpo não contém nome, local nem id do evento |
| `{ok:false, error:'not_published'}` (rascunho) | `409`, página com `Só eventos publicados podem ser cancelados` e link `Voltar para o evento` → `/org/events/:id` |
| `{ok:false, error:'already_cancelled'}` | `409`, página com `Evento cancelado não pode ser alterado` e o mesmo link |

`GET /org/events/:id/cancel` não existe (cai no 404 padrão do app).

### 3.2 `POST /org/events/:id/edit` e `POST /org/events/:id/publish` (de F02, alteradas por F06)

Dentro da transação de F02, logo depois de `lockEvent` + `getEventForOrganizer` e **antes** da validação do formulário: se `event.status === 'cancelled'`, responder `409` com `Evento cancelado não pode ser alterado` (via `renderCancelError`) e não alterar nada. A publicação passa a rodar em `withTransaction` com `lockEvent` (se F02 a fez como UPDATE condicional solto, F06 a envolve) para que publicar e cancelar se serializem. Comportamento para `draft`/`published` permanece o de F02 (publicar publicado continua idempotente, sem erro).

### 3.3 `GET /org/events/:id` (página de gestão de F02, alterada por F06)

| `events.status` | Formulário de edição | Botão "Publicar" | Seção "Cancelamento" (`renderCancelSection`) |
|---|---|---|---|
| `draft` | sim | sim | vazia (nenhum `action=".../cancel"`) |
| `published` | sim | não | formulário com botão "Cancelar evento" |
| `cancelled` | **não** | **não** | aviso de cancelado, sem formulário |

Check-in e painel (F05) continuam presentes em todos os estados; em `cancelled`, F05 já exibe `Evento cancelado` acima do campo.

HTML exato da seção em evento publicado (`:id` passa por `escapeHtml`):

```html
<section id="cancelamento">
  <h2>Cancelamento</h2>
  <p>Cancelar é irreversível: ingressos confirmados viram estornados e pendentes viram cancelados.</p>
  <form method="post" action="/org/events/{id}/cancel" onsubmit="return confirm('Cancelar este evento? Esta ação não pode ser desfeita.')">
    <button type="submit">Cancelar evento</button>
  </form>
</section>
```

Em evento cancelado:

```html
<section id="cancelamento">
  <h2>Cancelamento</h2>
  <p>Evento cancelado em {formatDateTime(cancelled_at)}. Este evento não pode mais ser editado, publicado nem cancelado.</p>
</section>
```

O texto da confirmação é fixo (sem dados do evento dentro do JavaScript, evitando injeção por nome de evento).

### 3.4 Lista `/org/events` (F02)

Sem alteração: o evento cancelado continua listado para o dono com o rótulo de status de F02 `cancelado` (X-13).

## 4. Funções e interfaces providas

| Interface | Arquivo | Assinatura e semântica |
|---|---|---|
| `cancelEvent` (nome fixado no PRD) | `src/features/cancellation/service.js` | `async cancelEvent(client, {eventId, organizerId})`. Deve ser chamada dentro de `withTransaction` (não abre transação própria). Passos: 1) `await lockEvent(client, eventId)`; 2) `event = await getEventForOrganizer(client, eventId, organizerId)` → `null` ⇒ `{ok:false, error:'not_found'}`; 3) `status==='draft'` ⇒ `{ok:false, error:'not_published'}`; `status==='cancelled'` ⇒ `{ok:false, error:'already_cancelled'}`; 4) `UPDATE events SET status='cancelled', cancelled_at=now(), updated_at=now() WHERE id=$1 AND status='published'`; 5) `UPDATE tickets SET status = CASE status WHEN 'confirmed' THEN 'refunded' ELSE 'cancelled' END, updated_at=now() WHERE event_id=$1 AND status IN ('pending','confirmed') RETURNING status`; 6) retorna `{ok:true, eventId, refunded:<nº refunded>, cancelled:<nº cancelled>}`. |
| `renderCancelSection(event)` (interface provida, nome escolhido aqui) | `src/features/cancellation/views.js` | Recebe a linha do evento (`id`, `status`, `cancelled_at`) e devolve a string HTML da seção 3.3 (`''` para `draft`). Usada pela view de gestão de F02. |
| `renderCancelError(res, {user, eventId, message})` (interface provida) | `src/features/cancellation/views.js` | Envia `409` com `layout({title:'Operação não permitida', user, body})`, corpo `<p class="erro">{message}</p><p><a href="/org/events/{eventId}">Voltar para o evento</a></p>`. Usada pela rota de cancelamento e pelos handlers de edição/publicação de F02. |
| `CANCEL_TEXTS` (interface provida) | `src/features/cancellation/texts.js` | `{ onlyPublished: 'Só eventos publicados podem ser cancelados', cancelledReadOnly: 'Evento cancelado não pode ser alterado', button: 'Cancelar evento', confirm: 'Cancelar este evento? Esta ação não pode ser desfeita.' }`. Textos de F06, não do brief; por isso não vão para `src/messages.js` (evita conflito no arquivo de F01). |
| Router de cancelamento | `src/features/cancellation/routes.js` | Exporta o router com `POST /org/events/:id/cancel`; registrado com **uma linha** em `src/app.js`, no mesmo estilo de módulo (CJS/ESM) que F01 adotou. |

## 5. Interfaces consumidas

| De | Interface | Uso |
|---|---|---|
| F01 | `requireOrganizer`, `req.user` (`src/auth.js`) | guarda da rota (X-12) |
| F01 | `withTransaction(fn)` (`src/db.js`) | transação do cancelamento |
| F01 | `layout`, `escapeHtml` (`src/views/layout.js`), `formatDateTime` (`src/format.js`) | páginas de erro e aviso |
| F01 | `src/messages.js` | rótulos `estornado`/`cancelado` e `Evento cancelado` usados por F03/F05 (F06 não reescreve) |
| F02 | `lockEvent(client, eventId)`, `getEventForOrganizer(client, eventId, organizerId)` | trava e ownership |
| F02 | página de gestão (`src/features/events/views.js`), handlers de `/edit` e `/publish` em `src/features/events/` | bloqueio de edição/publicação e seção de cancelamento |
| F02 | `listOnSaleEvents`, `getOnSaleEvent` (só `published`) | evento cancelado some da vitrine e da API sem código novo |
| F03 | tabela `tickets`, worker com `UPDATE … WHERE id=$1 AND status='pending'` | resposta tardia não altera cancelados (F06-AC05) |
| F03 | `purchaseTicket` (checa o evento depois de `lockEvent`) | compra após o cancelamento ⇒ `event_not_available` |
| F04 | rotas da API | X-15 |
| F05 | `checkInTicket`, `getEventDashboard`, aviso `Evento cancelado` | X-16, X-17 |

## 6. Concorrência

Todas as operações abaixo usam isolamento padrão `READ COMMITTED` (não usar `REPEATABLE READ`/`SERIALIZABLE` em `withTransaction`).

| Corrida | Por que é segura |
|---|---|
| Cancelamento × compra (vitrine/API) | Ambas começam com `lockEvent` (`SELECT … FOR UPDATE`). Compra que pegou a trava antes termina e o seu ingresso `pending` é visto pelo UPDATE de tickets do cancelamento (o snapshot do comando é tirado depois de obter a trava). Compra que espera a trava relê o evento já `cancelled` ⇒ `event_not_available` (404 na API). Nenhum ingresso novo nasce depois do cancelamento. |
| Cancelamento × worker do gateway | Disputa por linha de `tickets`. Se o worker grava antes (`pending`→`confirmed`/`declined`), o UPDATE do cancelamento reavalia o `WHERE status IN ('pending','confirmed')` e o `CASE` sobre a versão nova (confirmed ⇒ `refunded`; declined ⇒ fica fora). Se o cancelamento grava antes, o `WHERE status='pending'` do worker não casa e nada muda. Em ambos os casos, ao fim, nenhum ingresso do evento está `pending`/`confirmed`. |
| Cancelamento × cancelamento | O segundo espera a trava, relê `cancelled` ⇒ `409 Evento cancelado não pode ser alterado`; os ingressos transitam uma única vez. |
| Cancelamento × edição/publicação | Edição e publicação usam a mesma trava e checam `cancelled` depois dela (seção 3.2). |
| Cancelamento × check-in | Check-in que leu o evento antes do commit do cancelamento pode registrar `Entrada liberada` (ocorreu antes do cancelamento); `checked_in` não é zerado. Depois do commit, F05 responde `Evento cancelado`. |

## 7. Configuração

Nenhuma variável de ambiente nova. Usadas indiretamente: `GATEWAY_FAST_DELAY_MS`, `GATEWAY_SLOW_DELAY_MS`, `GATEWAY_POLL_MS` (F03) e `PARTNER_API_KEY` (F01) nos testes e no contrato. O contrato roda no modo padrão (atrasos 2 s / 65 s).

## 8. Estrutura de arquivos

| Arquivo | Ação |
|---|---|
| `src/features/cancellation/texts.js` | novo |
| `src/features/cancellation/service.js` | novo (`cancelEvent`) |
| `src/features/cancellation/views.js` | novo (`renderCancelSection`, `renderCancelError`) |
| `src/features/cancellation/routes.js` | novo (router) |
| `src/app.js` | +1 linha de registro |
| `src/features/events/views.js` | alterado: esconde edição/Publicar em `cancelled`; inclui `renderCancelSection(event)` |
| `src/features/events/` (arquivo de rotas de F02) | alterado: checagem `cancelled` em `/edit` e `/publish`; `/publish` em `withTransaction` + `lockEvent` |
| `db/migrations/004_cancelamento_status.sql` | só se a etapa 1 do plano mostrar CHECK incompatível |
| `test/cancellation.test.js` | novo: F06-AC01..AC07, X-12..X-16 |
| `test/cancellation-concurrency.test.js` | novo: F06-AC08, X-17, cancelamento duplo |

Cada `test(...)` leva no nome o ID do critério que cobre (ex.: `F06-AC02 cancela confirmados→refunded e pendentes→cancelled na mesma transação`), para o contrato verificar a cobertura por `grep`.

## 9. Textos exatos do brief

| Texto | Onde aparece no fluxo de F06 | Quem renderiza |
|---|---|---|
| `Evento cancelado` | check-in de evento cancelado (aviso e resposta) | F05, a partir de `src/messages.js` |
| `Ingresso inválido para este evento` | código de outro evento/inexistente em evento cancelado | F05 |
| rótulos `estornado` / `cancelado` | "Meus ingressos" | F03, a partir de `src/messages.js` |
| `refunded` / `cancelled` | `GET /api/partner/tickets/:id` | F04 |
| `{"error":"event_not_available"}` | compra pela API de evento cancelado | F04 |

F06 não duplica nem reescreve esses textos; seus testes os importam de `src/messages.js` para comparar literalmente. Os textos próprios de F06 (seção 4, `CANCEL_TEXTS`) e o `Evento não encontrado` de F02 não são do brief.
