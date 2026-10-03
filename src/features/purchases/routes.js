'use strict';

// Rotas da vitrine, da compra pelo participante e de "Meus ingressos" (spec F03 §3).

const express = require('express');
const { pool } = require('../../db');
const messages = require('../../messages');
const { requireParticipant } = require('../../auth');
const { getSeatStats, listOnSaleEvents, getOnSaleEvent } = require('../events/repo');
const { purchaseTicket, listTicketsForUser, isValidCardNumber } = require('./service');
const views = require('./views');

const router = express.Router();

const EVENT_ID_RE = /^evt_[a-z0-9]{10}$/;

/** Evento à venda + vagas (leitura sem trava: só exibição) ou null. */
async function loadOnSale(eventId) {
  if (typeof eventId !== 'string' || !EVENT_ID_RE.test(eventId)) return null;
  const event = await getOnSaleEvent(pool, eventId);
  if (!event) return null;
  const stats = await getSeatStats(pool, event.id);
  return { event, stats };
}

/** Cartão digitado na vitrine: espaços removidos; não-string (ex.: campo repetido) -> null. */
function normalizeCard(body) {
  const raw = body && typeof body === 'object' ? body.cardNumber : undefined;
  if (typeof raw !== 'string') return null;
  const card = raw.replace(/\s+/g, '');
  return isValidCardNumber(card) ? card : null;
}

router.get('/', async (req, res) => {
  const events = await listOnSaleEvents(pool);
  const items = [];
  for (const event of events) items.push({ event, stats: await getSeatStats(pool, event.id) });
  return views.sendStorefront(req, res, items);
});

router.get('/events/:id', async (req, res) => {
  const found = await loadOnSale(req.params.id);
  if (!found) return views.sendEventNotFound(req, res);
  return views.sendEventPage(req, res, found);
});

// Visitante vai ao login e volta à página do evento (não ao POST).
function visitorToLogin(req, res, next) {
  if (req.user) return next();
  return res.redirect(302, `/login?next=/events/${encodeURIComponent(req.params.id)}`);
}

router.post('/events/:id/purchase', visitorToLogin, requireParticipant, async (req, res) => {
  const eventId = req.params.id;
  if (!EVENT_ID_RE.test(eventId)) return views.sendEventNotFound(req, res);

  const cardNumber = normalizeCard(req.body);
  if (!cardNumber) {
    const found = await loadOnSale(eventId);
    if (!found) return views.sendCardInvalidWithoutEvent(req, res);
    return views.sendEventPage(req, res, { ...found, status: 422, error: views.CARD_INVALID_MESSAGE });
  }

  const result = await purchaseTicket({
    eventId,
    buyer: { userId: req.user.id, email: req.user.email },
    cardNumber,
    channel: 'web',
  });
  if (result.ok) return res.redirect(303, '/me/tickets');

  if (result.error === 'event_not_available') return views.sendEventNotFound(req, res);
  const found = await loadOnSale(eventId);
  if (!found) return views.sendEventNotFound(req, res);
  if (result.error === 'sold_out') {
    return views.sendEventPage(req, res, { ...found, status: 409, error: messages.SOLD_OUT });
  }
  // invalid_request (ex.: conta sem e-mail válido): mesmo 422 do cartão.
  return views.sendEventPage(req, res, { ...found, status: 422, error: views.CARD_INVALID_MESSAGE });
});

router.get('/me/tickets', requireParticipant, async (req, res) => {
  const tickets = await listTicketsForUser(pool, req.user.id);
  return views.sendMyTickets(req, res, tickets);
});

module.exports = router;
