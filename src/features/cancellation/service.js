'use strict';

// Cancelamento de evento (R11; spec F06 §4 e §6).
//
// cancelEvent(client, { eventId, organizerId })
//   -> { ok: true, eventId, refunded, cancelled }
//   -> { ok: false, error: 'not_found' }          inexistente ou de outro organizador
//   -> { ok: false, error: 'not_published' }      rascunho
//   -> { ok: false, error: 'already_cancelled' }  já cancelado (irreversível)
//
// Precisa rodar dentro de withTransaction (não abre transação própria). A
// primeira instrução é lockEvent (SELECT ... FOR UPDATE, AGENTS.md regra 5):
// compras, edições, publicações e outros cancelamentos do mesmo evento ficam
// serializados com este. Evento e ingressos mudam na mesma transação, então,
// quando ela termina, nenhum ingresso do evento está pending/confirmed (o prazo
// de 10 s do R11 é cumprido por ser imediato). Uma compra que esperava a trava
// relê o evento já 'cancelled' e devolve event_not_available. O worker do
// gateway só altera ingressos 'pending' (UPDATE condicional), então resposta
// tardia não muda os ingressos cancelados/estornados aqui.

const { lockEvent, getEventForOrganizer } = require('../events/repo');

async function cancelEvent(client, { eventId, organizerId }) {
  await lockEvent(client, eventId);
  const event = await getEventForOrganizer(client, eventId, organizerId);
  if (!event) return { ok: false, error: 'not_found' };
  if (event.status === 'draft') return { ok: false, error: 'not_published' };
  if (event.status === 'cancelled') return { ok: false, error: 'already_cancelled' };

  const updated = await client.query(
    `UPDATE events
        SET status = 'cancelled', cancelled_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'published'`,
    [event.id]
  );
  if (updated.rowCount !== 1) return { ok: false, error: 'already_cancelled' };

  // Um único UPDATE: confirmed -> refunded, pending -> cancelled. Em READ
  // COMMITTED, se o worker do gateway gravou a linha antes, o Postgres reavalia
  // o WHERE e o CASE sobre a versão nova (confirmed vira refunded; declined sai).
  const { rows } = await client.query(
    `UPDATE tickets
        SET status = CASE status WHEN 'confirmed' THEN 'refunded' ELSE 'cancelled' END,
            updated_at = now()
      WHERE event_id = $1 AND status IN ('pending', 'confirmed')
      RETURNING status`,
    [event.id]
  );
  const refunded = rows.filter((r) => r.status === 'refunded').length;
  return { ok: true, eventId: event.id, refunded, cancelled: rows.length - refunded };
}

module.exports = { cancelEvent };
