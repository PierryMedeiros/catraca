'use strict';

// POST /org/events/:id/checkin (spec F05 §3.2). O guarda requireOrganizer de
// F01 já cobre o prefixo /org em src/app.js (visitante -> login, participante
// -> 403); é repetido aqui para o router continuar seguro se montado de outro
// jeito. Outro organizador ou id inexistente -> 404 idêntico ao de F02 (R13),
// sem nenhuma escrita.

const express = require('express');
const { withTransaction } = require('../../db');
const { requireOrganizer } = require('../../auth');
const { getEventForOrganizer } = require('../events/repo');
const { sendManagePage, sendEventNotFound } = require('../events/views');
const { checkInTicket, normalizeCode } = require('./service');

const checkinRouter = express.Router();

checkinRouter.post('/org/events/:id/checkin', requireOrganizer, async (req, res) => {
  const raw = req.body && typeof req.body.code === 'string' ? req.body.code : '';
  const code = normalizeCode(raw);

  const outcome = await withTransaction(async (client) => {
    const event = await getEventForOrganizer(client, req.params.id, req.user.id);
    if (!event) return null;
    const result = await checkInTicket(client, { eventId: event.id, code });
    return { event, result };
  });
  if (!outcome) return sendEventNotFound(req, res);

  // Página montada depois do commit: o painel já reflete o check-in.
  return sendManagePage(req, res, {
    event: outcome.event,
    status: 200,
    context: { checkin: { result: outcome.result, code } },
  });
});

// Destino do login quando um visitante tenta o POST (next = caminho do POST):
// o GET leva de volta à página de gestão (que aplica o ownership).
checkinRouter.get('/org/events/:id/checkin', requireOrganizer, (req, res) => {
  res.redirect(302, `/org/events/${encodeURIComponent(req.params.id)}`);
});

module.exports = { checkinRouter };
