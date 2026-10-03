'use strict';

// Handlers da API de parceiros (spec F04 §3). Nenhuma decisão de vaga é tomada
// aqui: a compra passa inteira por purchaseTicket (F03), que trava o evento
// (SELECT ... FOR UPDATE) e conta as vagas dentro da trava. O handler não abre
// transação nem segura conexão do pool.

const { pool } = require('../../db');
const { API_ERRORS } = require('../../messages');
const { listOnSaleEvents, getSeatStats } = require('../events/repo');
const { purchaseTicket, getTicketById } = require('../purchases/service');
const { validatePartnerPurchase } = require('./validate');
const { toPartnerEvent, toPartnerTicket, toPartnerPurchase } = require('./serializers');

// Erro de purchaseTicket -> status HTTP (ordem do brief: 422 -> 404 -> 409).
const PURCHASE_ERROR_STATUS = Object.freeze({
  [API_ERRORS.invalid_request]: 422,
  [API_ERRORS.event_not_available]: 404,
  [API_ERRORS.sold_out]: 409,
});

/** GET /api/partner/events -> 200 [eventos à venda]. Leitura informativa, sem trava. */
async function listEvents(req, res) {
  const events = await listOnSaleEvents(pool);
  const items = [];
  for (const event of events) {
    const stats = await getSeatStats(pool, event.id);
    items.push(toPartnerEvent(event, stats ? stats.available : 0));
  }
  res.status(200).json(items);
}

/** POST /api/partner/events/:eventId/purchases -> 202 | 422 | 404 | 409. */
async function createPurchase(req, res) {
  const input = validatePartnerPurchase(req.body);
  if (!input.ok) return res.status(422).json({ error: API_ERRORS.invalid_request });

  const result = await purchaseTicket({
    eventId: req.params.eventId,
    buyer: { email: input.email },
    cardNumber: input.cardNumber,
    channel: 'partner',
  });

  if (result.ok) return res.status(202).json(toPartnerPurchase(result.ticket));

  const status = PURCHASE_ERROR_STATUS[result.error];
  if (!status) throw new Error(`purchaseTicket devolveu erro desconhecido: ${result.error}`);
  return res.status(status).json({ error: result.error });
}

/** GET /api/partner/tickets/:ticketId -> 200 | 404 (ingresso de qualquer canal). */
async function getTicket(req, res) {
  const ticket = await getTicketById(pool, req.params.ticketId);
  if (!ticket) return res.status(404).json({ error: API_ERRORS.ticket_not_found });
  return res.status(200).json(toPartnerTicket(ticket));
}

module.exports = { listEvents, createPurchase, getTicket };
