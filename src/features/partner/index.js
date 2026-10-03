'use strict';

// F04: router da API de parceiros, montado em /api/partner (spec F04 §3).
// Ordem: no-store -> requireApiKey -> rotas -> 404 JSON -> handler de erro JSON.
// Montado em src/app.js antes de qualquer parser global de corpo e da sessão:
// o corpo da compra só é lido aqui, como JSON (formulário, JSON malformado -> 422).

const express = require('express');
const { API_ERRORS } = require('../../messages');
const { PARTNER_EXTRA_ERRORS } = require('./errors');
const { requireApiKey } = require('./auth');
const { listEvents } = require('./routes');

const router = express.Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
router.use(requireApiKey);

router.get('/events', listEvents);

router.use((req, res) => {
  res.status(404).json({ error: PARTNER_EXTRA_ERRORS.notFound });
});

const BODY_PARSER_ERRORS = new Set([
  'entity.parse.failed',
  'entity.too.large',
  'entity.verify.failed',
  'encoding.unsupported',
  'charset.unsupported',
  'request.aborted',
  'request.size.invalid',
  'stream.encoding.set',
]);

function isBodyError(err) {
  const status = Number(err && (err.status || err.statusCode));
  return BODY_PARSER_ERRORS.has(err && err.type) || status === 400 || status === 413 || status === 415;
}

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (isBodyError(err)) return res.status(422).json({ error: API_ERRORS.invalid_request });
  console.error('api de parceiros:', err && err.stack ? err.stack : err);
  return res.status(500).json({ error: PARTNER_EXTRA_ERRORS.internal });
});

module.exports = { router, requireApiKey };
