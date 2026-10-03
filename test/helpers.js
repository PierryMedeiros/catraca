'use strict';

// Ajudantes compartilhados pelos testes de todas as features (node:test + fetch).

const { pool, query } = require('../src/db');
const { runMigrations } = require('../src/migrate');
const { runSeed } = require('../src/seed');
const { createApp } = require('../src/app');

const SEED = Object.freeze({
  orgA: 'org.a@catraca.local',
  orgB: 'org.b@catraca.local',
  participant: 'participante@catraca.local',
  password: 'catraca123',
});

/**
 * Aplica migrações e seed no banco de DATABASE_URL e sobe o app numa porta livre.
 * Retorna { baseUrl, server, close }.
 */
async function startApp() {
  await runMigrations(pool);
  await runSeed(pool);
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const close = () =>
    new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  return { baseUrl, server, close };
}

/** Cliente HTTP com cookie jar e redirect manual. */
function createClient(baseUrl) {
  const jar = new Map();

  function storeCookies(res) {
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const [pair, ...attrs] = sc.split(';');
      const idx = pair.indexOf('=');
      if (idx < 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      const expired = attrs.some((a) => {
        const [k, v] = a.trim().split('=');
        return k.toLowerCase() === 'expires' && new Date(v).getTime() <= Date.now();
      });
      if (expired || value === '') jar.delete(name);
      else jar.set(name, value);
    }
  }

  function cookieHeader() {
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async function request(method, path, { headers = {}, body } = {}) {
    const h = { ...headers };
    const cookie = cookieHeader();
    if (cookie) h.cookie = cookie;
    const res = await fetch(baseUrl + path, { method, headers: h, body, redirect: 'manual' });
    storeCookies(res);
    return res;
  }

  return {
    jar,
    request,
    get: (path, opts) => request('GET', path, opts),
    post: (path, form = {}, headers = {}) =>
      request('POST', path, {
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
        body: new URLSearchParams(form).toString(),
      }),
    postJson: (path, body, headers = {}) =>
      request('POST', path, {
        headers: { 'content-type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
  };
}

/** Faz login pelo formulário; retorna a Response (302 em caso de sucesso). */
function loginAs(client, email, password = SEED.password, next) {
  const form = { email, password };
  if (next !== undefined) form.next = next;
  return client.post('/login', form);
}

let counter = 0;
function uniqueEmail(prefix = 'u') {
  counter += 1;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}.${Date.now()}${counter}${rnd}@test.local`;
}

function endPool() {
  return pool.end();
}

module.exports = { startApp, createClient, loginAs, SEED, uniqueEmail, query, endPool, pool };
