'use strict';

// F04-AC01 — nas três rotas, sem X-Api-Key ou com chave errada: 401 e corpo
// exatamente {"error":"unauthorized"}, antes de qualquer outra validação, sem
// alterar o banco.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, endPool, SEED } = require('./helpers');
const { loggedClient } = require('./support/events');
const h = require('./partner-api.helpers');

let app;
let eventId;
let ticketId;

before(async () => {
  app = await startApp();
  const org = await h.orgClient(app.baseUrl);
  eventId = await h.createEvent(org, { capacity: 50 });
  const r = await h.partnerBuy(app.baseUrl, eventId);
  assert.equal(r.status, 202);
  ticketId = r.body.ticketId;
});
after(async () => {
  await app.close();
  await endPool();
});

function routes() {
  return [
    { name: 'listagem', path: '/api/partner/events' },
    {
      name: 'compra',
      path: `/api/partner/events/${eventId}/purchases`,
      json: { buyerEmail: 'x@example.com', cardNumber: '4000000000000001' },
    },
    { name: 'consulta', path: `/api/partner/tickets/${ticketId}` },
  ];
}

function assertUnauthorized(r, label) {
  assert.equal(r.status, 401, `${label}: status ${r.status} ${r.text}`);
  assert.equal(r.text, h.UNAUTHORIZED_BODY, `${label}: corpo`);
  h.assertJson(r);
}

describe('partner-api-auth.test.js', () => {
  test('F04-AC01 sem cabeçalho X-Api-Key -> 401 nas três rotas, sem criar ingresso', async () => {
    const before = await h.countAllTickets();
    for (const r of routes()) {
      assertUnauthorized(await h.api(app.baseUrl, r.path, { key: null, json: r.json }), r.name);
    }
    assert.equal(await h.countAllTickets(), before);
  });

  test('F04-AC01 chave errada, vazia, em maiúsculas, com prefixo/sufixo -> 401 nas três rotas', async () => {
    const before = await h.countAllTickets();
    const wrong = ['errada', '', h.KEY.toUpperCase(), `${h.KEY}x`, h.KEY.slice(0, -1), ` ${h.KEY}x`, `${h.KEY} ${h.KEY}`];
    for (const key of wrong) {
      for (const r of routes()) {
        assertUnauthorized(await h.api(app.baseUrl, r.path, { key, json: r.json }), `${r.name} chave=${JSON.stringify(key)}`);
      }
    }
    assert.equal(await h.countAllTickets(), before);
  });

  test('F04-AC01 chave fora do cabeçalho X-Api-Key não autentica', async () => {
    const base = app.baseUrl;
    assertUnauthorized(await h.api(base, `/api/partner/events?key=${h.KEY}`, { key: null }), 'query key');
    assertUnauthorized(await h.api(base, `/api/partner/events?apiKey=${h.KEY}`, { key: null }), 'query apiKey');
    assertUnauthorized(
      await h.api(base, '/api/partner/events', { key: null, headers: { authorization: `Bearer ${h.KEY}` } }),
      'Authorization'
    );
  });

  test('F04-AC01 sessão de organizador ou participante não autentica a API', async () => {
    for (const email of [SEED.orgA, SEED.participant]) {
      const client = await loggedClient(app.baseUrl, email, SEED.password);
      for (const r of routes()) {
        const res = r.json
          ? await client.postJson(r.path, r.json)
          : await client.get(r.path);
        const text = await res.text();
        assert.equal(res.status, 401, `${email} ${r.name}`);
        assert.equal(text, h.UNAUTHORIZED_BODY);
      }
    }
  });

  test('F04-AC01 401 vem antes de 422, 404 e de rota desconhecida', async () => {
    const before = await h.countAllTickets();
    const base = app.baseUrl;
    assertUnauthorized(
      await h.api(base, '/api/partner/events/evt_naoexiste/purchases', { key: null, json: { cardNumber: '123' } }),
      'corpo inválido em evento inexistente'
    );
    assertUnauthorized(
      await h.api(base, `/api/partner/events/${eventId}/purchases`, {
        key: null,
        rawBody: '{"buyerEmail":',
        headers: { 'content-type': 'application/json' },
      }),
      'JSON malformado'
    );
    assertUnauthorized(await h.api(base, '/api/partner/tickets/tkt_0000000000', { key: 'errada' }), 'ingresso inexistente');
    assertUnauthorized(await h.api(base, '/api/partner/rota-inexistente', { key: null }), 'rota desconhecida');
    assertUnauthorized(await h.api(base, '/api/partner/events', { key: null, method: 'DELETE' }), 'método desconhecido');
    assert.equal(await h.countAllTickets(), before);
  });

  test('F04-AC01 PARTNER_API_KEY vazia no servidor -> toda chave é recusada', async () => {
    const saved = process.env.PARTNER_API_KEY;
    try {
      process.env.PARTNER_API_KEY = '';
      assertUnauthorized(await h.api(app.baseUrl, '/api/partner/events', { key: '' }), 'chave vazia x servidor vazio');
      assertUnauthorized(await h.api(app.baseUrl, '/api/partner/events', { key: saved }), 'chave antiga');
    } finally {
      process.env.PARTNER_API_KEY = saved;
    }
    const ok = await h.api(app.baseUrl, '/api/partner/events');
    assert.equal(ok.status, 200);
  });

  test('chave correta -> 200 na listagem', async () => {
    const r = await h.api(app.baseUrl, '/api/partner/events');
    assert.equal(r.status, 200);
    h.assertJson(r);
    assert.equal(r.res.headers.get('cache-control'), 'no-store');
  });
});
