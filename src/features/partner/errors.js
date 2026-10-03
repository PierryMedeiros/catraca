'use strict';

// Códigos de erro da API de parceiros que não estão no brief (spec F04 §4).
// Os cinco códigos do brief vêm de src/messages.js (API_ERRORS) e não se repetem aqui.

const PARTNER_EXTRA_ERRORS = Object.freeze({
  notFound: 'not_found',
  internal: 'internal_error',
});

module.exports = { PARTNER_EXTRA_ERRORS };
