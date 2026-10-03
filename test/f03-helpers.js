'use strict';

// Utilitários dos testes de F03 (não declara testes). Reaproveita test/helpers.js
// (F01) e test/support/events.js (F02).

const assert = require('node:assert/strict');
const { createClient, loginAs, SEED, uniqueEmail, query } = require('./helpers');
const { newId } = require('../src/ids');
const { readDelayMs } = require('../src/features/gateway/simulator');
const { purchaseTicket } = require('../src/features/purchases/service');

/** Atrasos efetivos do gateway neste processo (gates: 200 / 1500 / 50 ms). */
const DELAYS = Object.freeze({
  fast: readDelayMs('GATEWAY_FAST_DELAY_MS', 2000),
  slow: readDelayMs('GATEWAY_SLOW_DELAY_MS', 65000),
  poll: readDelayMs('GATEWAY_POLL_MS', 500),
});

const CARDS = Object.freeze({
  approveFast: '4000000000000001',
  declineFast: '4000000000000002',
  approveSlow: '4000000000000003',
  declineSlow: '4000000000000004',
  other: '4000000000000009',
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Participante novo via POST /signup (F01) -> { client, email, name, userId }. */
async function signupParticipant(baseUrl, name = 'Participante F03') {
  const client = createClient(baseUrl);
  const email = uniqueEmail('f03');
  const res = await client.post('/signup', { name, email, password: 'segredo123' });
  assert.equal(res.status, 302, `signup deveria redirecionar (${res.status})`);
  const { rows } = await query('SELECT id FROM users WHERE email = $1', [email]);
  return { client, email, name, userId: rows[0].id };
}

/** Cliente logado com uma conta existente. */
async function loginClient(baseUrl, email, password = SEED.password) {
  const client = createClient(baseUrl);
  const res = await loginAs(client, email, password);
  assert.equal(res.status, 302, `login de ${email} falhou (${res.status})`);
  return client;
}

let seq = 0;
/** Evento direto na tabela events -> id. */
async function createEventSql({
  capacity = 5,
  priceCents = 10000,
  status = 'published',
  organizerEmail = SEED.orgA,
  name,
  venue = 'Teatro F03',
} = {}) {
  seq += 1;
  const id = newId('evt');
  await query(
    `INSERT INTO events (id, organizer_id, name, starts_at, venue, capacity, price_cents, status, cancelled_at)
     SELECT $1, u.id, $2, now() + interval '30 days', $3, $4, $5, $6,
            CASE WHEN $6 = 'cancelled' THEN now() END
       FROM users u WHERE u.email = $7`,
    [id, name || `F03 evento ${Date.now()}-${seq}`, venue, capacity, priceCents, status, organizerEmail]
  );
  return id;
}

/** POST /events/:id/purchase -> { status, location, ms, html }. */
async function buy(client, eventId, cardNumber) {
  const t0 = performance.now();
  const res = await client.post(`/events/${eventId}/purchase`, cardNumber === undefined ? {} : { cardNumber });
  const ms = performance.now() - t0;
  const html = await res.text();
  return { status: res.status, location: res.headers.get('location'), ms, html };
}

/** Compra pelo serviço no canal partner (sem conta). */
function buyPartner(eventId, cardNumber = CARDS.approveFast, email = 'parceiro@example.com') {
  return purchaseTicket({ eventId, buyer: { email }, cardNumber, channel: 'partner' });
}

async function ticketById(id) {
  const { rows } = await query('SELECT * FROM tickets WHERE id = $1', [id]);
  return rows[0] || null;
}

async function ticketsOfEvent(eventId) {
  const { rows } = await query('SELECT * FROM tickets WHERE event_id = $1 ORDER BY created_at, id', [eventId]);
  return rows;
}

async function lastTicket(eventId) {
  const { rows } = await query('SELECT * FROM tickets WHERE event_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [
    eventId,
  ]);
  return rows[0] || null;
}

async function countTickets(eventId) {
  const sql = eventId ? 'SELECT count(*) AS n FROM tickets WHERE event_id = $1' : 'SELECT count(*) AS n FROM tickets';
  const { rows } = await query(sql, eventId ? [eventId] : []);
  return Number(rows[0].n);
}

async function occupiedSeats(eventId) {
  const { rows } = await query(
    "SELECT count(*) AS n FROM tickets WHERE event_id = $1 AND status IN ('pending', 'confirmed')",
    [eventId]
  );
  return Number(rows[0].n);
}

/** Espera o ingresso chegar ao status (polling no banco) e devolve a linha. */
async function waitForStatus(ticketId, status, timeoutMs = DELAYS.slow + 2000) {
  const deadline = Date.now() + timeoutMs;
  let row;
  while (Date.now() < deadline) {
    row = await ticketById(ticketId);
    if (row && row.status === status) return row;
    await sleep(25);
  }
  throw new Error(`ingresso ${ticketId} não chegou a ${status} em ${timeoutMs} ms (está ${row && row.status})`);
}

/** Linha única do HTML que contém o trecho (marcadores de linha única da spec). */
function lineWith(html, needle) {
  return html.split('\n').filter((l) => l.includes(needle));
}

function countOccurrences(html, needle) {
  return html.split(needle).length - 1;
}

module.exports = {
  DELAYS,
  CARDS,
  sleep,
  signupParticipant,
  loginClient,
  createEventSql,
  buy,
  buyPartner,
  ticketById,
  ticketsOfEvent,
  lastTicket,
  countTickets,
  occupiedSeats,
  waitForStatus,
  lineWith,
  countOccurrences,
};
