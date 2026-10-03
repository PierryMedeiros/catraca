'use strict';

// POST /org/events/:id/cancel (spec F06 §3.1). O guarda requireOrganizer de
// F01 já cobre o prefixo /org em src/app.js (visitante -> login, participante
// -> 403); é repetido aqui para o router continuar seguro se montado de outro
// jeito. Ordem: papel -> existência/dono (404) -> estado (409).

const express = require('express');
const { withTransaction } = require('../../db');
const { requireOrganizer } = require('../../auth');
const { sendEventNotFound } = require('../events/views');
const { cancelEvent } = require('./service');
const { renderCancelError } = require('./views');
const { CANCEL_TEXTS } = require('./texts');

const cancellationRouter = express.Router();

const ERROR_MESSAGES = Object.freeze({
  not_published: CANCEL_TEXTS.onlyPublished,
  already_cancelled: CANCEL_TEXTS.cancelledReadOnly,
});

cancellationRouter.post('/org/events/:id/cancel', requireOrganizer, async (req, res) => {
  const eventId = req.params.id;
  const result = await withTransaction((client) => cancelEvent(client, { eventId, organizerId: req.user.id }));
  if (result.ok) return res.redirect(302, `/org/events/${encodeURIComponent(result.eventId)}`);
  if (result.error === 'not_found') return sendEventNotFound(req, res);
  return renderCancelError(res, { user: req.user, eventId, message: ERROR_MESSAGES[result.error] });
});

module.exports = { cancellationRouter };
