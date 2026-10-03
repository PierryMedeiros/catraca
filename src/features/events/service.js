'use strict';

// Casos de uso de eventos (spec, seções 7 e 8.2). Todas as funções recebem um
// PoolClient dentro de transação (withTransaction). Edição e publicação começam
// com lockEvent (AGENTS.md, regra 5).

const { newId } = require('../../ids');
const { lockEvent, getSeatStats } = require('./repo');
const { validateEventInput } = require('./validation');
const { capacityBelowOccupied } = require('./texts');

function isOwner(event, organizerId) {
  return String(event.organizer_id) === String(organizerId);
}

/** Cria um rascunho. -> { ok: true, event } | { ok: false, reason: 'invalid', errors, values } */
async function createEvent(client, { organizerId, input, now = new Date() }) {
  const v = validateEventInput(input, { now });
  if (!v.ok) return { ok: false, reason: 'invalid', errors: v.errors, values: v.values };
  const { name, venue, startsAt, capacity, priceCents } = v.value;
  const { rows } = await client.query(
    `INSERT INTO events (id, organizer_id, name, starts_at, venue, capacity, price_cents, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
     RETURNING *`,
    [newId('evt'), String(organizerId), name, startsAt, venue, capacity, priceCents]
  );
  return { ok: true, event: rows[0] };
}

/**
 * Edita um evento do organizador (rascunho ou publicado), com as mesmas
 * validações da criação. A lotação não pode ficar abaixo das vagas ocupadas,
 * calculadas dentro da trava (R03, R05).
 */
async function updateEvent(client, { eventId, organizerId, input, now = new Date() }) {
  const event = await lockEvent(client, eventId);
  if (!event || !isOwner(event, organizerId)) return { ok: false, reason: 'not_found' };
  if (event.status === 'cancelled') return { ok: false, reason: 'cancelled' };

  const v = validateEventInput(input, { now });
  if (!v.ok) return { ok: false, reason: 'invalid', errors: v.errors, values: v.values };

  const { name, venue, startsAt, capacity, priceCents } = v.value;
  const stats = await getSeatStats(client, event.id);
  if (capacity < stats.occupied) {
    return {
      ok: false,
      reason: 'invalid',
      errors: { capacity: capacityBelowOccupied(stats.occupied) },
      values: v.values,
    };
  }

  const { rows } = await client.query(
    `UPDATE events
        SET name = $2, starts_at = $3, venue = $4, capacity = $5, price_cents = $6, updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [event.id, name, startsAt, venue, capacity, priceCents]
  );
  return { ok: true, event: rows[0] };
}

/** Publica um rascunho (R02). Repetir não altera nada. -> { ok: true, changed } | { ok: false, reason } */
async function publishEvent(client, { eventId, organizerId }) {
  const event = await lockEvent(client, eventId);
  if (!event || !isOwner(event, organizerId)) return { ok: false, reason: 'not_found' };
  if (event.status === 'cancelled') return { ok: false, reason: 'cancelled' };
  const { rowCount } = await client.query(
    "UPDATE events SET status = 'published', updated_at = now() WHERE id = $1 AND status = 'draft'",
    [event.id]
  );
  return { ok: true, changed: rowCount === 1 };
}

module.exports = { createEvent, updateEvent, publishEvent };
