'use strict';

// Check-in (R10; spec F05 §4). A primeira linha verdadeira da tabela de R10
// define o resultado, nesta ordem:
//   1. código inexistente ou de outro evento        -> invalid_ticket
//   2. evento cancelado                             -> event_cancelled
//   3. ingresso não confirmado                      -> not_confirmed
//   4. ingresso já passou pelo check-in             -> already_used
//   5. nenhuma das anteriores                       -> entry_allowed
// Os textos vêm de src/messages.js (CHECKIN), nunca literais aqui.
//
// Concorrência (PRD §10): o check-in é gravado com UPDATE condicional
// (WHERE status = 'confirmed' AND checked_in = false). Em READ COMMITTED, uma
// segunda transação com o mesmo código espera o commit da primeira, reavalia a
// condição e afeta 0 linhas; aí o ingresso é relido e reclassificado. Nunca se
// devolve entry_allowed sem o UPDATE ter afetado 1 linha.

const messages = require('../../messages');

const CHECKIN_RESULTS = Object.freeze({
  INVALID: 'invalid_ticket',
  EVENT_CANCELLED: 'event_cancelled',
  NOT_CONFIRMED: 'not_confirmed',
  ALREADY_USED: 'already_used',
  ENTRY_ALLOWED: 'entry_allowed',
});

const MAX_CODE_LENGTH = 64;
const CODE_RE = /^[A-Z0-9]+$/;

/** Código digitado -> trim + maiúsculas (PRD §11). Ausente -> ''. */
function normalizeCode(raw) {
  return String(raw ?? '').trim().toUpperCase();
}

/** Chave de resultado -> texto exato do brief (src/messages.js). */
function checkinMessage(resultKey) {
  const text = messages.CHECKIN[resultKey];
  if (text === undefined) throw new Error(`checkinMessage: resultado desconhecido ${resultKey}`);
  return text;
}

async function findTicketOfEvent(client, eventId, code) {
  const { rows } = await client.query(
    `SELECT t.id, t.status, t.checked_in, e.status AS event_status
       FROM tickets t
       JOIN events e ON e.id = t.event_id
      WHERE t.code = $1 AND t.event_id = $2`,
    [code, String(eventId)]
  );
  return rows[0] || null;
}

/** Linhas 1 a 4 de R10; null = linha 5 (pode liberar a entrada). */
function classify(row) {
  if (!row) return CHECKIN_RESULTS.INVALID;
  if (row.event_status === 'cancelled') return CHECKIN_RESULTS.EVENT_CANCELLED;
  if (row.status !== 'confirmed') return CHECKIN_RESULTS.NOT_CONFIRMED;
  if (row.checked_in) return CHECKIN_RESULTS.ALREADY_USED;
  return null;
}

/**
 * Aplica R10 ao código no evento e grava o check-in quando liberado.
 * `client` deve estar numa transação aberta pelo chamador, que já validou o
 * dono do evento. -> uma das CHECKIN_RESULTS.
 */
async function checkInTicket(client, { eventId, code }) {
  const c = normalizeCode(code);
  if (c === '' || c.length > MAX_CODE_LENGTH || !CODE_RE.test(c)) return CHECKIN_RESULTS.INVALID;

  const row = await findTicketOfEvent(client, eventId, c);
  const blocked = classify(row);
  if (blocked) return blocked;

  const updated = await client.query(
    `UPDATE tickets
        SET checked_in = true, checked_in_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'confirmed' AND checked_in = false
      RETURNING id`,
    [row.id]
  );
  if (updated.rowCount === 1) return CHECKIN_RESULTS.ENTRY_ALLOWED;

  // Outra transação mudou o ingresso entre o SELECT e o UPDATE (check-in
  // simultâneo ou cancelamento do evento): relê e reclassifica.
  const again = await findTicketOfEvent(client, eventId, c);
  return classify(again) || CHECKIN_RESULTS.ALREADY_USED;
}

module.exports = {
  CHECKIN_RESULTS,
  MAX_CODE_LENGTH,
  normalizeCode,
  checkinMessage,
  checkInTicket,
};
