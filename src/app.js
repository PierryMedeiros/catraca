'use strict';

const express = require('express');
const { pool } = require('./db');
const messages = require('./messages');
const { sessionMiddleware, loadUser, requireOrganizer, requireParticipant } = require('./auth');
const { sendError, notFound } = require('./views/layout');

async function health(req, res) {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'error' });
  }
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = Number(err.status || err.statusCode) || 500;
  if (status >= 400 && status < 500) {
    return sendError(req, res, status, messages.BAD_REQUEST);
  }
  console.error(err);
  return sendError(req, res, 500, messages.INTERNAL_ERROR);
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', health); // antes da sessão: não toca cookie

  app.use(express.urlencoded({ extended: false }));
  app.use(sessionMiddleware);
  app.use(loadUser);

  // Guardas por prefixo (R13): /org só organizador, /me só participante.
  app.use('/org', requireOrganizer);
  app.use('/me', requireParticipant);

  // --- features: uma linha por feature, nesta ordem ---
  app.use(require('./features/accounts/routes')); // F01
  app.use(require('./features/events/routes')); // F02
  require('./features/purchases').registerPurchases(app); // F03
  require('./features/checkin').registerCheckinFeature(app); // F05
  // F02, F03, F04, F05, F06 acrescentam a sua linha aqui
  // --- fim das features ---

  app.use(require('./features/accounts/placeholders')); // F01: provisórias, sempre por último
  app.use(notFound); // 404 com layout
  app.use(errorHandler); // 500 com layout, loga o erro

  return app;
}

module.exports = { createApp };
