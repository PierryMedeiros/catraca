'use strict';

// Apoio aos testes de eventos (spec F02, seção 8.5), reutilizável por F03–F06.
// Reaproveita createClient/loginAs de test/helpers.js (F01).

const { createClient, loginAs, query } = require('../helpers');

const pad2 = (n) => String(n).padStart(2, '0');

/** Data/hora local do processo deslocada em minutos, no formato datetime-local. */
function localDateTime(offsetMinutes, { seconds = true } = {}) {
  const d = new Date(Date.now() + offsetMinutes * 60000);
  const base = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return seconds ? `${base}:${pad2(d.getSeconds())}` : base;
}

/** Cliente HTTP já logado com a conta dada. */
async function loggedClient(baseUrl, email, password) {
  const client = createClient(baseUrl);
  const res = await loginAs(client, email, password);
  if (res.status !== 302) throw new Error(`login de ${email} falhou: ${res.status}`);
  return client;
}

let seq = 0;
/** Campos válidos de evento (início em +30 dias), com sobrescritas. */
function eventFields(overrides = {}) {
  seq += 1;
  return {
    name: `Evento teste ${Date.now()}-${seq}`,
    startsAt: localDateTime(30 * 24 * 60, { seconds: false }),
    venue: 'Sala de testes',
    capacity: '2',
    price: '100,00',
    ...overrides,
  };
}

const ID_IN_LOCATION = /^\/org\/events\/(evt_[a-z0-9]{10})$/;

/** POST /org/events -> { status, location, id, res }. */
async function createEventHttp(client, fields = {}) {
  const res = await client.post('/org/events', eventFields(fields));
  const location = res.headers.get('location');
  const m = location ? ID_IN_LOCATION.exec(location) : null;
  return { status: res.status, location, id: m ? m[1] : null, res };
}

/** POST /org/events/:id/publish -> Response. */
function publishEventHttp(client, id) {
  return client.post(`/org/events/${id}/publish`, {});
}

async function userIdByEmail(email) {
  const { rows } = await query('SELECT id FROM users WHERE email = $1', [email]);
  return rows[0].id;
}

async function eventRow(id) {
  const { rows } = await query('SELECT * FROM events WHERE id = $1', [id]);
  return rows[0] || null;
}

/** Impressão digital da linha (prova de "nada mudou"). */
async function eventFingerprint(id) {
  const { rows } = await query('SELECT md5(e::text) AS h FROM events e WHERE id = $1', [id]);
  return rows[0] ? rows[0].h : null;
}

async function countEvents() {
  const { rows } = await query('SELECT count(*) AS n FROM events');
  return rows[0].n;
}

module.exports = {
  localDateTime,
  loggedClient,
  eventFields,
  createEventHttp,
  publishEventHttp,
  userIdByEmail,
  eventRow,
  eventFingerprint,
  countEvents,
};
