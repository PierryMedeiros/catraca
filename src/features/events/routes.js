'use strict';

// Rotas da área do organizador (spec, seção 3). O guarda requireOrganizer de
// F01 já protege todo o prefixo /org em src/app.js; aqui ele é repetido por
// rota para que o router continue seguro se for montado de outro jeito.

const express = require('express');
const { pool, withTransaction } = require('../../db');
const { requireOrganizer } = require('../../auth');
const { sendPage } = require('../../views/layout');
const repo = require('./repo');
const service = require('./service');
const views = require('./views');
const { renderCancelError } = require('../cancellation/views');
const { CANCEL_TEXTS } = require('../cancellation/texts');

const router = express.Router();

router.get('/org/events', requireOrganizer, async (req, res) => {
  const events = await repo.listEventsForOrganizer(pool, req.user.id);
  sendPage(req, res, { title: 'Meus eventos', body: views.renderEventsList({ user: req.user, events }) });
});

router.get('/org/events/new', requireOrganizer, (req, res) => {
  sendPage(req, res, { title: 'Novo evento', body: views.renderNewEventForm({ user: req.user }) });
});

router.post('/org/events', requireOrganizer, async (req, res) => {
  const result = await withTransaction((client) =>
    service.createEvent(client, { organizerId: req.user.id, input: req.body || {} })
  );
  if (!result.ok) {
    return sendPage(req, res, {
      status: 422,
      title: 'Novo evento',
      body: views.renderNewEventForm({ user: req.user, values: result.values, errors: result.errors }),
    });
  }
  return res.redirect(302, `/org/events/${result.event.id}`);
});

router.get('/org/events/:id', requireOrganizer, async (req, res) => {
  const event = await repo.getEventForOrganizer(pool, req.params.id, req.user.id);
  if (!event) return views.sendEventNotFound(req, res);
  return views.sendManagePage(req, res, { event });
});

// Destino do login quando um visitante tenta um POST de ação (next = caminho
// do POST): o GET correspondente leva de volta à página de gestão.
for (const action of ['edit', 'publish']) {
  router.get(`/org/events/:id/${action}`, requireOrganizer, (req, res) => {
    res.redirect(302, `/org/events/${encodeURIComponent(req.params.id)}`);
  });
}

/** Responde a falhas de edição/publicação; a página é montada fora da transação. */
async function sendFailure(req, res, result) {
  if (result.reason === 'not_found') return views.sendEventNotFound(req, res);
  // F06: evento cancelado é irreversível -> 409 sem alterar nada (spec F06 §3.2).
  if (result.reason === 'cancelled') {
    return renderCancelError(res, { user: req.user, eventId: req.params.id, message: CANCEL_TEXTS.cancelledReadOnly });
  }
  const event = await repo.getEventForOrganizer(pool, req.params.id, req.user.id);
  if (!event) return views.sendEventNotFound(req, res);
  return views.sendManagePage(req, res, {
    event,
    status: 422,
    editErrors: result.errors,
    editValues: result.values,
  });
}

router.post('/org/events/:id/edit', requireOrganizer, async (req, res) => {
  const result = await withTransaction((client) =>
    service.updateEvent(client, { eventId: req.params.id, organizerId: req.user.id, input: req.body || {} })
  );
  if (!result.ok) return sendFailure(req, res, result);
  return res.redirect(302, `/org/events/${result.event.id}`);
});

router.post('/org/events/:id/publish', requireOrganizer, async (req, res) => {
  const result = await withTransaction((client) =>
    service.publishEvent(client, { eventId: req.params.id, organizerId: req.user.id })
  );
  if (!result.ok) return sendFailure(req, res, result);
  return res.redirect(302, `/org/events/${encodeURIComponent(req.params.id)}`);
});

module.exports = router;
