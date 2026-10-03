'use strict';

// F04-AC02 e X-07 — GET /api/partner/events: só eventos à venda, com exatamente
// id, name, startsAt (ISO 8601 com offset do TZ), priceCents e availableSeats
// (R05); rascunho e cancelado fora; publicar e editar refletem; esgotado
// continua listado com 0.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, endPool, query } = require('./helpers');
const h = require('./partner-api.helpers');

const FUTURE_START = `${new Date().getFullYear() + 1}-12-05T21:00`;
const ISO_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

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

describe('partner-api-events.test.js', () => {
  test('F04-AC02 formato: chaves exatas na ordem, tipos, startsAt com offset e mesmo instante do banco', async () => {
    const id = await h.createEvent(org, { capacity: 3, price: '123,45', startsAt: FUTURE_START });
    const r = await h.api(app.baseUrl, '/api/partner/events');
    assert.equal(r.status, 200);
    h.assertJson(r);
    assert.ok(Array.isArray(r.body) && r.body.length > 0);
    for (const item of r.body) {
      assert.deepEqual(Object.keys(item), ['id', 'name', 'startsAt', 'priceCents', 'availableSeats']);
      assert.equal(typeof item.id, 'string');
      assert.equal(typeof item.name, 'string');
      assert.ok(Number.isInteger(item.priceCents));
      assert.ok(Number.isInteger(item.availableSeats) && item.availableSeats >= 0);
      assert.match(item.startsAt, ISO_OFFSET_RE);
    }
    const item = r.body.find((e) => e.id === id);
    assert.ok(item, 'evento publicado listado');
    assert.equal(item.priceCents, 12345);
    assert.equal(item.availableSeats, 3);
    // Gates rodam com TZ=America/Sao_Paulo (sem horário de verão): -03:00.
    if (process.env.TZ === 'America/Sao_Paulo') assert.equal(item.startsAt, `${FUTURE_START}:00-03:00`);
    const { rows } = await query('SELECT starts_at, name FROM events WHERE id = $1', [id]);
    assert.equal(Date.parse(item.startsAt), rows[0].starts_at.getTime());
    assert.equal(item.name, rows[0].name);
  });

  test('X-07 rascunho fora da listagem; publicar mostra lotação e preço; editar reflete', async () => {
    const id = await h.createEvent(org, { capacity: 2, price: '100,00', publish: false });
    assert.equal(await h.listedEvent(app.baseUrl, id), undefined, 'rascunho não aparece');

    const pub = await org.post(`/org/events/${id}/publish`, {});
    assert.ok([302, 303].includes(pub.status));
    let item = await h.listedEvent(app.baseUrl, id);
    assert.equal(item.availableSeats, 2);
    assert.equal(item.priceCents, 10000);

    const edit = await org.post(`/org/events/${id}/edit`, {
      name: 'F04 editado',
      startsAt: FUTURE_START,
      venue: 'Porão',
      capacity: '3',
      price: '150,00',
    });
    assert.ok([302, 303].includes(edit.status), `edição ${edit.status}`);
    item = await h.listedEvent(app.baseUrl, id);
    assert.equal(item.availableSeats, 3);
    assert.equal(item.priceCents, 15000);
    assert.equal(item.name, 'F04 editado');

    const buy = await h.partnerBuy(app.baseUrl, id);
    assert.equal(buy.status, 202);
    item = await h.listedEvent(app.baseUrl, id);
    assert.equal(item.availableSeats, 2);
    const { rows } = await query('SELECT price_cents FROM tickets WHERE id = $1', [buy.body.ticketId]);
    assert.equal(Number(rows[0].price_cents), 15000);

    const list = await h.api(app.baseUrl, '/api/partner/events');
    assert.equal(list.body.filter((e) => e.id === id).length, 1, 'aparece uma vez');
  });

  test('F04-AC02 evento cancelado (via SQL) sai da listagem', async () => {
    const id = await h.createEvent(org, { capacity: 2 });
    assert.ok(await h.listedEvent(app.baseUrl, id));
    await query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [id]);
    assert.equal(await h.listedEvent(app.baseUrl, id), undefined);
  });

  test('F04-AC02 esgotado continua listado com availableSeats 0; recusados não ocupam vaga', async () => {
    const id = await h.createEvent(org, { capacity: 1, price: '50,00' });
    const r = await h.partnerBuy(app.baseUrl, id, { card: h.CARDS.approveSlow });
    assert.equal(r.status, 202);
    const item = await h.listedEvent(app.baseUrl, id);
    assert.ok(item, 'esgotado continua listado');
    assert.equal(item.availableSeats, 0);

    const id2 = await h.createEvent(org, { capacity: 4 });
    await query(
      `UPDATE tickets SET status = 'declined' WHERE id = $1`,
      [(await h.partnerBuy(app.baseUrl, id2, { card: h.CARDS.approveSlow })).body.ticketId]
    );
    await h.partnerBuy(app.baseUrl, id2, { card: h.CARDS.approveSlow });
    assert.equal((await h.listedEvent(app.baseUrl, id2)).availableSeats, 3);
  });

  test('F04-AC02 lista ordenada por início; query string ignorada', async () => {
    const r = await h.api(app.baseUrl, '/api/partner/events?status=draft&limit=1');
    assert.equal(r.status, 200);
    const times = r.body.map((e) => Date.parse(e.startsAt));
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
    const { rows } = await query("SELECT count(*) AS n FROM events WHERE status = 'published'");
    assert.equal(r.body.length, Number(rows[0].n));
  });
});
