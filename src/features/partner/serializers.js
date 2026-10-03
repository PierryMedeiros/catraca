'use strict';

// Formatos fixos do contrato da API de parceiros (brief; spec F04 §3.2–3.4).
// A ordem das chaves é a do brief.

const { toIsoWithOffset } = require('../../format');

/** Evento à venda -> { id, name, startsAt, priceCents, availableSeats }. */
function toPartnerEvent(event, available) {
  return {
    id: String(event.id),
    name: String(event.name),
    startsAt: toIsoWithOffset(event.starts_at),
    priceCents: Number(event.price_cents),
    availableSeats: Number(available),
  };
}

const ticketCode = (ticket) => String(ticket.code).trim();

/** Ingresso -> { ticketId, code, eventId, status, checkedIn }. */
function toPartnerTicket(ticket) {
  return {
    ticketId: String(ticket.id),
    code: ticketCode(ticket),
    eventId: String(ticket.event_id),
    status: String(ticket.status),
    checkedIn: ticket.checked_in === true,
  };
}

/** Ingresso recém-comprado -> { ticketId, code, status }. */
function toPartnerPurchase(ticket) {
  return {
    ticketId: String(ticket.id),
    code: ticketCode(ticket),
    status: String(ticket.status),
  };
}

module.exports = { toPartnerEvent, toPartnerTicket, toPartnerPurchase };
