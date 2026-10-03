'use strict';

// F04-AC03..AC06 e AC10 — POST /api/partner/events/:id/purchases: 202 imediato
// no canal partner; ordem 422 -> 404 -> 409; nenhum ingresso criado nos erros;
// toda resposta é JSON; compra da API não vincula a participante.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, endPool, query, SEED } = require('./helpers');
const { loggedClient } = require('./support/events');
const h = require('./partner-api.helpers');

let app;
let org;
before(async () => {
  app = await startApp();
  org = await h.orgClient(app.baseUrl);
});
after(async () => {
  await app.close();
  await endPool();
});

const purchasePath = (id) => `/api/partner/events/${id}/purchases`;

async function ticketsOf(eventId) {
  const { rows } = await query('SELECT * FROM tickets WHERE event_id = $1 ORDER BY created_at, id', [eventId]);
  return rows;
}

describe('partner-api-purchase.test.js', () => {
  test('F04-AC03 compra válida -> 202 imediato, 3 chaves, ingresso partner sem conta', async () => {
    const id = await h.createEvent(org, { capacity: 5, price: '100,00' });
    const t0 = performance.now();
    const r = await h.partnerBuy(app.baseUrl, id, { email: '  Ana.Parceira@Example.COM ', card: h.CARDS.approveSlow });
    const ms = performance.now() - t0;
    assert.equal(r.status, 202, r.text);
    h.assertJson(r);
    assert.ok(ms < 1000, `respondeu em ${ms} ms`);
    assert.deepEqual(Object.keys(r.body), ['ticketId', 'code', 'status']);
    assert.match(r.body.ticketId, /^tkt_[a-z0-9]{10}$/);
    assert.match(r.body.code, /^[A-Z0-9]{8}$/);
    assert.equal(r.body.status, 'pending');

    const [t] = await ticketsOf(id);
    assert.equal(t.id, r.body.ticketId);
    assert.equal(t.code.trim(), r.body.code);
    assert.equal(t.channel, 'partner');
    assert.equal(t.user_id, null);
    assert.equal(t.buyer_email, 'ana.parceira@example.com');
    assert.equal(t.card_last4, '0003');
    assert.equal(t.status, 'pending', 'não esperou o gateway (atraso lento)');
    assert.equal(Number(t.price_cents), 10000);
    const { rows } = await query("SELECT count(*) AS n FROM tickets t WHERE t::text LIKE '%4000000000000003%'");
    assert.equal(Number(rows[0].n), 0, 'número do cartão não é persistido');
  });

  test('F04-AC03 campos extras no corpo são ignorados', async () => {
    const id = await h.createEvent(org, { capacity: 5, price: '100,00' });
    const { rows: u } = await query('SELECT id FROM users WHERE email = $1', [SEED.participant]);
    const r = await h.api(app.baseUrl, purchasePath(id), {
      json: {
        buyerEmail: 'extra@example.com',
        cardNumber: '4000000000000001',
        userId: u[0].id,
        channel: 'web',
        priceCents: 1,
        status: 'confirmed',
        code: 'AAAAAAAA',
      },
    });
    assert.equal(r.status, 202);
    assert.equal(r.body.status, 'pending');
    const [t] = await ticketsOf(id);
    assert.equal(t.channel, 'partner');
    assert.equal(t.user_id, null);
    assert.equal(Number(t.price_cents), 10000);
    assert.notEqual(t.code.trim(), 'AAAAAAAA');
  });

  test('F04-AC04 corpo inválido -> 422 invalid_request, sem criar ingresso', async () => {
    const id = await h.createEvent(org, { capacity: 5 });
    const before = await h.countAllTickets();
    const json = { 'content-type': 'application/json' };
    const cases = [
      { label: 'sem corpo', opts: { method: 'POST' } },
      { label: 'sem corpo com content-type', opts: { method: 'POST', headers: json } },
      { label: 'JSON malformado', opts: { rawBody: '{"buyerEmail":', headers: json } },
      {
        label: 'formulário',
        opts: {
          rawBody: 'buyerEmail=a%40example.com&cardNumber=4000000000000001',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        },
      },
      { label: 'texto puro', opts: { rawBody: 'oi', headers: { 'content-type': 'text/plain' } } },
      ...['[]', 'null', '"x"', '42', 'true', '{}'].map((raw) => ({ label: raw, opts: { rawBody: raw, headers: json } })),
      { label: 'sem buyerEmail', opts: { json: { cardNumber: '4000000000000001' } } },
      { label: 'sem cardNumber', opts: { json: { buyerEmail: 'a@example.com' } } },
      ...['ana@', 'ana@example', 'ana example.com', '@example.com', '', '   ', 123, null, ['a@example.com']].map(
        (m) => ({ label: `email ${JSON.stringify(m)}`, opts: { json: { buyerEmail: m, cardNumber: '4000000000000001' } } })
      ),
      ...[
        '123',
        '40000000000000011',
        '400000000000001',
        '400000000000000a',
        '4000 0000 0000 0001',
        ' 4000000000000001',
        4000000000000001,
        '',
        null,
      ].map((c) => ({ label: `cartão ${JSON.stringify(c)}`, opts: { json: { buyerEmail: 'a@example.com', cardNumber: c } } })),
      {
        label: 'corpo > 10 kB',
        opts: { json: { buyerEmail: 'a@example.com', cardNumber: '4000000000000001', x: 'a'.repeat(20000) } },
      },
    ];
    for (const c of cases) {
      const r = await h.api(app.baseUrl, purchasePath(id), c.opts);
      assert.equal(r.status, 422, `${c.label}: ${r.status} ${r.text}`);
      assert.equal(r.text, h.INVALID_BODY, c.label);
      h.assertJson(r);
    }
    assert.equal(await h.countAllTickets(), before);
  });

  test('F04-AC04 422 vem antes de 404: corpo inválido em evento inexistente, rascunho e cancelado', async () => {
    const draft = await h.createEvent(org, { capacity: 5, publish: false });
    const cancelled = await h.createEvent(org, { capacity: 5 });
    await query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [cancelled]);
    for (const id of ['evt_naoexiste', 'evt_zzzzzzzzzz', draft, cancelled]) {
      const r = await h.api(app.baseUrl, purchasePath(id), { json: { buyerEmail: 't@example.com', cardNumber: '123' } });
      assert.equal(r.status, 422, id);
      assert.equal(r.text, h.INVALID_BODY);
    }
  });

  test('F04-AC05 evento inexistente, rascunho ou cancelado -> 404 event_not_available', async () => {
    const before = await h.countAllTickets();
    const draft = await h.createEvent(org, { capacity: 5, publish: false });
    const ids = ['evt_zzzzzzzzzz', 'nao-existe', "evt_%27%20OR%201%3D1", 'a'.repeat(300), draft];
    for (const id of ids) {
      const r = await h.partnerBuy(app.baseUrl, id);
      assert.equal(r.status, 404, `${id.slice(0, 30)}: ${r.status} ${r.text}`);
      assert.equal(r.text, h.EVENT_NA_BODY);
      h.assertJson(r);
    }
    assert.equal(await h.countAllTickets(), before);
  });

  test('F04-AC05 cancelado sem vaga -> 404 (404 vem antes de 409)', async () => {
    const id = await h.createEvent(org, { capacity: 1 });
    assert.equal((await h.partnerBuy(app.baseUrl, id, { card: h.CARDS.approveSlow })).status, 202);
    assert.equal((await h.partnerBuy(app.baseUrl, id)).status, 409, 'lotado antes de cancelar');
    await query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [id]);
    const r = await h.partnerBuy(app.baseUrl, id);
    assert.equal(r.status, 404);
    assert.equal(r.text, h.EVENT_NA_BODY);
    assert.equal((await ticketsOf(id)).length, 1);
  });

  test('F04-AC06 sem vaga -> 409 sold_out sem criar ingresso', async () => {
    const id = await h.createEvent(org, { capacity: 1, price: '50,00' });
    const first = await h.partnerBuy(app.baseUrl, id, { email: 's1@example.com', card: h.CARDS.approveSlow });
    assert.equal(first.status, 202);
    for (const card of [h.CARDS.approveFast, h.CARDS.declineFast]) {
      const r = await h.partnerBuy(app.baseUrl, id, { email: 's2@example.com', card });
      assert.equal(r.status, 409);
      assert.equal(r.text, h.SOLD_OUT_BODY);
      h.assertJson(r);
    }
    assert.equal((await ticketsOf(id)).length, 1);
    assert.equal((await h.listedEvent(app.baseUrl, id)).availableSeats, 0);
  });

  test('F04-AC10 toda resposta é JSON, inclusive not_found e método desconhecido', async () => {
    const id = await h.createEvent(org, { capacity: 1 });
    const base = app.baseUrl;
    const checks = [
      [200, await h.api(base, '/api/partner/events')],
      [202, await h.partnerBuy(base, id)],
      [409, await h.partnerBuy(base, id)],
      [404, await h.partnerBuy(base, 'evt_zzzzzzzzzz')],
      [422, await h.api(base, purchasePath(id), { rawBody: '{"buyerEmail":', headers: { 'content-type': 'application/json' } })],
      [404, await h.api(base, '/api/partner/tickets/tkt_0000000000')],
      [401, await h.api(base, '/api/partner/events', { key: null })],
      [404, await h.api(base, '/api/partner/rota-inexistente')],
      [404, await h.api(base, '/api/partner/events', { method: 'DELETE' })],
      [404, await h.api(base, purchasePath(id))],
      [404, await h.api(base, '/api/partner')],
    ];
    for (const [status, r] of checks) {
      assert.equal(r.status, status, r.text);
      h.assertJson(r);
      assert.notEqual(r.body, undefined, `JSON válido: ${r.text}`);
    }
    for (const r of checks.slice(-4).map((c) => c[1])) assert.equal(r.text, h.NOT_FOUND_BODY);
  });

  test('F04-AC10 compra com e-mail de participante não aparece em "Meus ingressos" dele', async () => {
    const id = await h.createEvent(org, { capacity: 3 });
    const r = await h.partnerBuy(app.baseUrl, id, { email: SEED.participant });
    assert.equal(r.status, 202);
    const { rows } = await query('SELECT user_id, channel FROM tickets WHERE id = $1', [r.body.ticketId]);
    assert.equal(rows[0].user_id, null);
    assert.equal(rows[0].channel, 'partner');
    const participant = await loggedClient(app.baseUrl, SEED.participant, SEED.password);
    const page = await participant.get('/me/tickets');
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(!html.includes(r.body.code), 'código não aparece em Meus ingressos');
    assert.ok(!html.includes(r.body.ticketId));
  });
});
