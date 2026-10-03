'use strict';

// Utilitários dos testes de F05 (não declara testes nem tem efeitos ao
// importar). Reaproveita test/helpers.js (F01).

const assert = require('node:assert/strict');
const { createClient, loginAs, SEED, query } = require('../helpers');
const { newId, randomString, CODE_ALPHABET } = require('../../src/ids');

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Código de ingresso novo: 8 caracteres [A-Z0-9], começando por letra. */
function newCode() {
  return randomString(1, LETTERS) + randomString(7, CODE_ALPHABET);
}

let seq = 0;

/** Evento direto na tabela events -> id. */
async function createEvent({ owner = SEED.orgA, capacity = 5, priceCents = 10000, status = 'published', name } = {}) {
  seq += 1;
  const id = newId('evt');
  await query(
    `INSERT INTO events (id, organizer_id, name, starts_at, venue, capacity, price_cents, status, cancelled_at)
     SELECT $1, u.id, $2, now() + interval '30 days', 'Local F05', $3, $4, $5,
            CASE WHEN $5 = 'cancelled' THEN now() END
       FROM users u WHERE u.email = $6`,
    [id, name || `F05 ${id} ${seq}`, capacity, priceCents, status, owner]
  );
  return id;
}

/**
 * Ingresso direto na tabela tickets -> { id, code }. Pendentes vencem em 1 dia
 * (o worker do gateway não os toca durante o teste).
 */
async function createTicket({
  eventId,
  status = 'confirmed',
  priceCents = 10000,
  checkedIn = false,
  code = newCode(),
} = {}) {
  const id = newId('tkt');
  await query(
    `INSERT INTO tickets (id, event_id, user_id, buyer_email, code, status, price_cents, channel, card_last4,
                          gateway_outcome, gateway_due_at, checked_in, checked_in_at)
     VALUES ($1, $2, NULL, $1 || '@f05.example.com', $3, $4, $5, 'partner', '0001',
             CASE WHEN $4 = 'declined' THEN 'declined' ELSE 'approved' END,
             CASE WHEN $4 = 'pending' THEN now() + interval '1 day' ELSE now() - interval '1 minute' END,
             $6, CASE WHEN $6 THEN now() END)`,
    [id, eventId, code, status, priceCents, checkedIn]
  );
  return { id, code };
}

async function ticketRow(id) {
  const { rows } = await query('SELECT * FROM tickets WHERE id = $1', [id]);
  return rows[0] || null;
}

/** Cliente HTTP logado com uma conta da seed (ou outra). */
async function login(baseUrl, email, password = SEED.password) {
  const client = createClient(baseUrl);
  const res = await loginAs(client, email, password);
  assert.equal(res.status, 302, `login de ${email} falhou (${res.status})`);
  return client;
}

const RESULT_RE = /<p id="checkin-result" data-result="([a-z_]+)">([^<]*)<\/p>/;
const CODE_RE = /<p id="checkin-code">Código informado: ([^<]*)<\/p>/;
const METRIC_RE = /<dd data-metric="([a-z]+)">([^<]*)<\/dd>/g;

/** Valores do painel lidos dos <dd data-metric> do HTML, na ordem da página. */
function parseMetrics(html) {
  const out = {};
  for (const m of html.matchAll(METRIC_RE)) out[m[1]] = m[2];
  return out;
}

/**
 * POST /org/events/:id/checkin. code === undefined envia o formulário sem o campo.
 * -> { status, result, text, echo, metrics, html }
 */
async function postCheckin(client, eventId, code) {
  const form = code === undefined ? { foo: 'bar' } : { code };
  const res = await client.post(`/org/events/${eventId}/checkin`, form);
  const html = await res.text();
  const r = RESULT_RE.exec(html);
  const c = CODE_RE.exec(html);
  return {
    status: res.status,
    location: res.headers.get('location'),
    result: r ? r[1] : null,
    text: r ? r[2] : null,
    echo: c ? c[1] : null,
    metrics: parseMetrics(html),
    html,
  };
}

/** GET da página de gestão -> objeto com os 6 valores do painel (strings). */
async function getPanel(client, eventId) {
  const res = await client.get(`/org/events/${eventId}`);
  assert.equal(res.status, 200, `gestão de ${eventId} deveria abrir (${res.status})`);
  return parseMetrics(await res.text());
}

/** Painel esperado a partir de números (Receita formatada como R$ X,YY). */
function panelOf({ confirmed, pending, checkins, available, revenue, refunded }) {
  return {
    confirmed: String(confirmed),
    pending: String(pending),
    checkins: String(checkins),
    available: String(available),
    revenue,
    refunded: String(refunded),
  };
}

module.exports = {
  newCode,
  createEvent,
  createTicket,
  ticketRow,
  login,
  parseMetrics,
  postCheckin,
  getPanel,
  panelOf,
};
