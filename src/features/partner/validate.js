'use strict';

// Validação do corpo da compra pela API (spec F04 §3.3), feita antes de olhar o
// evento: corpo inválido é 422 mesmo para evento inexistente.
// Regras: corpo objeto JSON (não array, não null); buyerEmail string que, após
// trim, casa o regex do PRD §11; cardNumber string com exatamente 16 dígitos
// (na API não se removem espaços). Campos extras são ignorados.

const { EMAIL_RE, CARD_RE } = require('../purchases/service');

/** -> { ok: true, email (trim + minúsculas), cardNumber } ou { ok: false }. */
function validatePartnerPurchase(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
  const { buyerEmail, cardNumber } = body;
  if (typeof buyerEmail !== 'string') return { ok: false };
  const email = buyerEmail.trim();
  if (!EMAIL_RE.test(email)) return { ok: false };
  if (typeof cardNumber !== 'string' || !CARD_RE.test(cardNumber)) return { ok: false };
  return { ok: true, email: email.toLowerCase(), cardNumber };
}

module.exports = { validatePartnerPurchase };
