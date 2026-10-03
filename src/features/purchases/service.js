'use strict';

// Serviço de compra de ingressos (spec F03 §4 e §5), único caminho de compra
// para a vitrine (channel 'web') e para a API de parceiros (channel 'partner', F04).
//
// purchaseTicket({ eventId, buyer: { userId?, email }, cardNumber, channel })
//   -> { ok: true, ticket }                      ticket = linha de tickets (snake_case), status 'pending'
//   -> { ok: false, error: 'invalid_request' }     dados inválidos (verificado ANTES de olhar o evento)
//   -> { ok: false, error: 'event_not_available' } evento inexistente, rascunho ou cancelado
//   -> { ok: false, error: 'sold_out' }            sem vaga disponível (R05, R07)
// Ordem: invalid_request -> event_not_available -> sold_out (a mesma da API: 422 -> 404 -> 409).
// Erros inesperados (banco fora etc.) rejeitam a Promise.
//
// Concorrência (R07, AGENTS.md regra 5): a decisão roda numa transação que
// começa com lockEvent (SELECT ... FROM events WHERE id = $1 FOR UPDATE); as
// vagas são contadas por getSeatStats depois da trava, então compras do mesmo
// evento são serializadas e as ocupadas nunca passam da lotação. A compra não
// espera o gateway: só grava gateway_outcome e gateway_due_at (o worker resolve).

const { withTransaction } = require('../../db');
const { newId, randomString, CODE_ALPHABET } = require('../../ids');
const { API_ERRORS } = require('../../messages');
const { lockEvent, getSeatStats } = require('../events/repo');
const { decideOutcome } = require('../gateway/simulator');

const CARD_RE = /^\d{16}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EVENT_ID_RE = /^evt_[a-z0-9]{10}$/;
const TICKET_ID_RE = /^tkt_[a-z0-9]{10}$/;
const CHANNELS = new Set(['web', 'partner']);
const MAX_CODE_ATTEMPTS = 10;

const fail = (error) => ({ ok: false, error });

/** Código do ingresso: 8 caracteres de [A-Z0-9], sorteados com crypto.randomInt. */
function generateTicketCode() {
  return randomString(8, CODE_ALPHABET);
}

/** Cartão válido para o serviço: string de exatamente 16 dígitos (sem remover espaços). */
function isValidCardNumber(cardNumber) {
  return typeof cardNumber === 'string' && CARD_RE.test(cardNumber);
}

/** E-mail válido (PRD §11): string que, após trim, casa o regex do projeto. */
function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
}

/**
 * Insere um ingresso pending. Não verifica vagas: só chame dentro da trava do
 * evento (exceto em testes). Código e id novos a cada tentativa; colisão de
 * código (UNIQUE tickets_code_key) não aborta a transação (ON CONFLICT DO
 * NOTHING) e gera nova tentativa, até 10. -> linha inserida (snake_case).
 */
async function insertTicket(
  client,
  { eventId, userId, buyerEmail, priceCents, channel, cardLast4, gatewayOutcome, delayMs },
  generateCode = generateTicketCode
) {
  for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
    const { rows } = await client.query(
      `INSERT INTO tickets (id, event_id, user_id, buyer_email, code, status, price_cents, channel,
                            card_last4, gateway_outcome, gateway_due_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9,
               now() + make_interval(secs => $10::double precision / 1000))
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        newId('tkt'),
        eventId,
        userId || null,
        buyerEmail,
        generateCode(),
        priceCents,
        channel,
        cardLast4,
        gatewayOutcome,
        Number(delayMs) || 0,
      ]
    );
    if (rows[0]) return rows[0];
  }
  throw new Error(`insertTicket: nenhum código livre em ${MAX_CODE_ATTEMPTS} tentativas`);
}

/**
 * Compra um ingresso (um por compra, R06). Ver o contrato no topo do arquivo.
 * O número do cartão nunca é persistido nem logado: só os 4 últimos dígitos.
 */
async function purchaseTicket({ eventId, buyer, cardNumber, channel } = {}) {
  // 1. Validação, fora da transação: invalid_request vem antes de tudo.
  if (!CHANNELS.has(channel)) return fail(API_ERRORS.invalid_request);
  if (!isValidCardNumber(cardNumber)) return fail(API_ERRORS.invalid_request);
  if (!buyer || typeof buyer !== 'object' || !isValidEmail(buyer.email)) return fail(API_ERRORS.invalid_request);
  if (channel === 'web' && !buyer.userId) return fail(API_ERRORS.invalid_request);

  // Id fora do formato não existe: mesmo resultado de evento inexistente, sem consulta.
  if (typeof eventId !== 'string' || !EVENT_ID_RE.test(eventId)) return fail(API_ERRORS.event_not_available);

  const buyerEmail = buyer.email.trim().toLowerCase();
  const userId = channel === 'web' ? String(buyer.userId) : null;

  // 2. Decisão dentro da trava do evento.
  return withTransaction(async (client) => {
    const event = await lockEvent(client, eventId); // primeira instrução da transação
    if (!event || event.status !== 'published') return fail(API_ERRORS.event_not_available);

    const { available } = await getSeatStats(client, event.id);
    if (available <= 0) return fail(API_ERRORS.sold_out);

    const { outcome, delayMs } = decideOutcome(cardNumber);
    const ticket = await insertTicket(client, {
      eventId: event.id,
      userId,
      buyerEmail,
      priceCents: event.price_cents, // preço vigente, lido sob a trava (R03)
      channel,
      cardLast4: cardNumber.slice(-4),
      gatewayOutcome: outcome,
      delayMs,
    });
    return { ok: true, ticket };
  });
}

/** Ingresso por id (qualquer canal) ou null. Id fora de ^tkt_[a-z0-9]{10}$ -> null sem consultar. */
async function getTicketById(client, id) {
  if (typeof id !== 'string' || !TICKET_ID_RE.test(id)) return null;
  const { rows } = await client.query('SELECT * FROM tickets WHERE id = $1', [id]);
  return rows[0] || null;
}

/** Ingressos de um participante ("Meus ingressos"), mais recentes primeiro, com o evento. */
async function listTicketsForUser(client, userId) {
  const { rows } = await client.query(
    `SELECT t.*, e.name AS event_name, e.starts_at
       FROM tickets t
       JOIN events e ON e.id = t.event_id
      WHERE t.user_id = $1
      ORDER BY t.created_at DESC, t.id`,
    [String(userId)]
  );
  return rows;
}

module.exports = {
  purchaseTicket,
  insertTicket,
  generateTicketCode,
  getTicketById,
  listTicketsForUser,
  isValidCardNumber,
  isValidEmail,
  CARD_RE,
  EMAIL_RE,
};
