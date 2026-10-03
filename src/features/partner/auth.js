'use strict';

// requireApiKey (spec F04 §3.1): a chave só vale no cabeçalho X-Api-Key e é
// comparada em tempo constante com PARTNER_API_KEY (lida a cada requisição).
// Chave ausente, vazia, diferente ou servidor sem chave configurada -> 401.
// A chave nunca é escrita em log.

const crypto = require('node:crypto');
const { API_ERRORS } = require('../../messages');

const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest();

function isValidKey(received, expected) {
  if (typeof expected !== 'string' || expected === '') return false;
  if (typeof received !== 'string' || received === '') return false;
  return crypto.timingSafeEqual(sha256(received), sha256(expected));
}

function requireApiKey(req, res, next) {
  if (!isValidKey(req.get('x-api-key'), process.env.PARTNER_API_KEY)) {
    return res.status(401).json({ error: API_ERRORS.unauthorized });
  }
  return next();
}

module.exports = { requireApiKey, isValidKey };
