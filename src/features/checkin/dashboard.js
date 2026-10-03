'use strict';

// Painel do evento (R12; spec F05 §4). Conta ingressos de todos os canais
// (vitrine e API): nada filtra por channel.
//   confirmed    = status 'confirmed' (inclusive os que já passaram pelo check-in)
//   pending      = status 'pending'
//   checkIns     = status 'confirmed' com checked_in
//   available    = getSeatStats().available (R05: lotação - pendentes - confirmados)
//   revenueCents = soma de tickets.price_cents dos 'confirmed' (preço de cada compra, R03)
//   refunded     = status 'refunded'
// Leitura simples, sem trava: reflete o estado commitado no momento da consulta.

const { getSeatStats } = require('../events/repo');

/** -> { confirmed, pending, checkIns, available, revenueCents, refunded } (inteiros). */
async function getEventDashboard(client, eventId) {
  const id = String(eventId);
  const { rows } = await client.query(
    `SELECT count(*) FILTER (WHERE status = 'confirmed')::int                  AS confirmed,
            count(*) FILTER (WHERE status = 'pending')::int                    AS pending,
            count(*) FILTER (WHERE status = 'confirmed' AND checked_in)::int   AS check_ins,
            COALESCE(sum(price_cents) FILTER (WHERE status = 'confirmed'), 0)::bigint AS revenue_cents,
            count(*) FILTER (WHERE status = 'refunded')::int                   AS refunded
       FROM tickets
      WHERE event_id = $1`,
    [id]
  );
  const r = rows[0];
  const seats = await getSeatStats(client, id);
  return {
    confirmed: Number(r.confirmed),
    pending: Number(r.pending),
    checkIns: Number(r.check_ins),
    available: seats ? Number(seats.available) : 0,
    revenueCents: Number(r.revenue_cents),
    refunded: Number(r.refunded),
  };
}

module.exports = { getEventDashboard };
