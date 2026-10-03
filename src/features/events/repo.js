'use strict';

// Repositório de eventos (spec, seção 8.1). `client` = qualquer objeto com
// .query do pg (pool ou PoolClient). Todas devolvem a linha crua de events
// (snake_case) ou null.

const { validateEventInput } = require('./validation');

function firstOrNull(result) {
  return result.rows[0] || null;
}

/**
 * Trava a linha do evento até o fim da transação (SELECT ... FOR UPDATE).
 * Exige PoolClient dentro de transação. Não filtra status nem dono.
 */
async function lockEvent(client, eventId) {
  return firstOrNull(await client.query('SELECT * FROM events WHERE id = $1 FOR UPDATE', [String(eventId)]));
}

/**
 * Vagas do evento (R05): { capacity, occupied, available } ou null se o evento
 * não existe. occupied = ingressos pending + confirmed (declined, cancelled e
 * refunded não ocupam vaga); available = capacity - occupied, sem clamp.
 * Implementação de F03 (tabela tickets real, 003_tickets.sql). Para decidir uma
 * compra ou uma edição de lotação, chame depois de lockEvent na mesma
 * transação. O nome `tickets` não é qualificado: uma tabela TEMP de mesmo nome
 * (teste de F02-AC08) tem precedência.
 */
async function getSeatStats(client, eventId) {
  const { rows } = await client.query(
    `SELECT e.capacity,
            count(*) FILTER (WHERE t.status IN ('pending', 'confirmed'))::int AS occupied
       FROM events e
       LEFT JOIN tickets t ON t.event_id = e.id
      WHERE e.id = $1
      GROUP BY e.capacity`,
    [String(eventId)]
  );
  if (!rows[0]) return null;
  const capacity = Number(rows[0].capacity);
  const occupied = Number(rows[0].occupied);
  return { capacity, occupied, available: capacity - occupied };
}

/** Evento do organizador, em qualquer status; null se não existe ou é de outro. */
async function getEventForOrganizer(client, eventId, organizerId) {
  return firstOrNull(
    await client.query('SELECT * FROM events WHERE id = $1 AND organizer_id = $2', [
      String(eventId),
      String(organizerId),
    ])
  );
}

/** Eventos do organizador ("Meus eventos"), por início e criação. */
async function listEventsForOrganizer(client, organizerId) {
  const { rows } = await client.query(
    'SELECT * FROM events WHERE organizer_id = $1 ORDER BY starts_at, created_at, id',
    [String(organizerId)]
  );
  return rows;
}

/** Eventos à venda (R02): só status published, por início. Esgotados continuam. */
async function listOnSaleEvents(client) {
  const { rows } = await client.query("SELECT * FROM events WHERE status = 'published' ORDER BY starts_at, id");
  return rows;
}

/**
 * Evento à venda ou null (rascunho, cancelado, inexistente). Sem trava: para
 * decidir uma compra, use lockEvent e confira o status na linha travada.
 */
async function getOnSaleEvent(client, eventId) {
  return firstOrNull(
    await client.query("SELECT * FROM events WHERE id = $1 AND status = 'published'", [String(eventId)])
  );
}

module.exports = {
  lockEvent,
  getSeatStats,
  getEventForOrganizer,
  listEventsForOrganizer,
  listOnSaleEvents,
  getOnSaleEvent,
  validateEventInput,
};
