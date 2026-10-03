'use strict';

// Utilitários dos testes de F04 (não declara testes). Reaproveita test/helpers.js
// (F01), test/support/events.js (F02) e test/f03-helpers.js (F03).

const assert = require('node:assert/strict');
const { query, SEED } = require('./helpers');
const { loggedClient, createEventHttp, publishEventHttp } = require('./support/events');
const { DELAYS, CARDS, sleep } = require('./f03-helpers');

const KEY = process.env.PARTNER_API_KEY || 'catraca-parceiro-2026';

/**
 * Requisição à API de parceiros.
 * opts: key (padrão KEY; null = sem cabeçalho), method, json (objeto -> corpo JSON),
 * rawBody (string enviada como está), headers.
 * -> { status, contentType, text, body (JSON ou undefined), res }
 */
async function api(baseUrl, path, { key = KEY, method, json, rawBody, headers = {} } = {}) {
  const h = { ...headers };
  if (key !== null) h['x-api-key'] = key;
  let body;
  if (json !== undefined) {
    body = JSON.stringify(json);
    if (!Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['content-type'] = 'application/json';
  } else if (rawBody !== undefined) {
    body = rawBody;
  }
  const res = await fetch(baseUrl + path, { method: method || (body !== undefined ? 'POST' : 'GET'), headers: h, body });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return { status: res.status, contentType: res.headers.get('content-type') || '', text, body: parsed, res };
}

/** Compra pela API -> resultado de api(). */
function partnerBuy(baseUrl, eventId, { email = 'parceiro@example.com', card = CARDS.approveFast, key } = {}) {
  return api(baseUrl, `/api/partner/events/${eventId}/purchases`, {
    key,
    json: { buyerEmail: email, cardNumber: card },
  });
}

/** Item da listagem da API para o evento, ou undefined. */
async function listedEvent(baseUrl, eventId) {
  const r = await api(baseUrl, '/api/partner/events');
  assert.equal(r.status, 200);
  return r.body.find((e) => e.id === eventId);
}

/** Organizador A logado (cliente HTTP com cookie). */
function orgClient(baseUrl, email = SEED.orgA) {
  return loggedClient(baseUrl, email, SEED.password);
}

/** Cria (e opcionalmente publica) evento pela interface de F02 -> id. */
async function createEvent(org, { capacity = 5, price = '100,00', publish = true, ...rest } = {}) {
  const created = await createEventHttp(org, { capacity: String(capacity), price, ...rest });
  assert.equal(created.status, 302, `criação de evento falhou (${created.status})`);
  assert.ok(created.id, 'id do evento no Location');
  if (publish) {
    const res = await publishEventHttp(org, created.id);
    assert.ok([302, 303].includes(res.status), `publicação falhou (${res.status})`);
  }
  return created.id;
}

/** Status do ingresso lido pela API. */
async function apiTicketStatus(baseUrl, ticketId) {
  const r = await api(baseUrl, `/api/partner/tickets/${ticketId}`);
  return r.body && r.body.status;
}

/** Espera (polling pela API) o ingresso chegar ao status; devolve o ms decorrido desde t0. */
async function waitApiStatus(baseUrl, ticketId, status, { timeoutMs = DELAYS.slow + 3000, t0 = Date.now() } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await apiTicketStatus(baseUrl, ticketId);
    if (last === status) return Date.now() - t0;
    await sleep(Math.max(20, DELAYS.poll));
  }
  throw new Error(`ingresso ${ticketId} não chegou a ${status} em ${timeoutMs} ms (está ${last})`);
}

async function countAllTickets() {
  const { rows } = await query('SELECT count(*) AS n FROM tickets');
  return Number(rows[0].n);
}

const UNAUTHORIZED_BODY = '{"error":"unauthorized"}';
const INVALID_BODY = '{"error":"invalid_request"}';
const EVENT_NA_BODY = '{"error":"event_not_available"}';
const SOLD_OUT_BODY = '{"error":"sold_out"}';
const TICKET_NF_BODY = '{"error":"ticket_not_found"}';
const NOT_FOUND_BODY = '{"error":"not_found"}';

function assertJson(r) {
  assert.match(r.contentType, /^application\/json/, `content-type ${r.contentType} para ${r.status} ${r.text}`);
}

module.exports = {
  KEY,
  DELAYS,
  CARDS,
  sleep,
  api,
  partnerBuy,
  listedEvent,
  orgClient,
  createEvent,
  apiTicketStatus,
  waitApiStatus,
  countAllTickets,
  assertJson,
  UNAUTHORIZED_BODY,
  INVALID_BODY,
  EVENT_NA_BODY,
  SOLD_OUT_BODY,
  TICKET_NF_BODY,
  NOT_FOUND_BODY,
};
