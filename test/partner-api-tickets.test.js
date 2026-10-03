'use strict';

// F04-AC08 e X-08 — GET /api/partner/tickets/:id: exatamente ticketId, code,
// eventId, status, checkedIn (booleano), para ingresso de qualquer canal;
// inexistente -> 404 ticket_not_found.

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

describe('partner-api-tickets.test.js', () => {
  test('F04-AC08 ingresso da API: 5 chaves na ordem, corpo exato, checkedIn acompanha o banco', async () => {
    const id = await h.createEvent(org, { capacity: 5 });
    const buy = await h.partnerBuy(app.baseUrl, id);
    assert.equal(buy.status, 202);
    const { ticketId, code } = buy.body;

    let r = await h.api(app.baseUrl, `/api/partner/tickets/${ticketId}`);
    assert.equal(r.status, 200);
    h.assertJson(r);
    assert.deepEqual(Object.keys(r.body), ['ticketId', 'code', 'eventId', 'status', 'checkedIn']);
    assert.equal(r.body.status, 'pending');

    await h.waitApiStatus(app.baseUrl, ticketId, 'confirmed', { timeoutMs: h.DELAYS.fast + 5000 });
    r = await h.api(app.baseUrl, `/api/partner/tickets/${ticketId}`);
    assert.equal(r.text, JSON.stringify({ ticketId, code, eventId: id, status: 'confirmed', checkedIn: false }));

    await query('UPDATE tickets SET checked_in = true, checked_in_at = now() WHERE id = $1', [ticketId]);
    r = await h.api(app.baseUrl, `/api/partner/tickets/${ticketId}`);
    assert.strictEqual(r.body.checkedIn, true);
  });

  test('X-08 ingresso comprado na vitrine é lido pela API com eventId e code do banco', async () => {
    const id = await h.createEvent(org, { capacity: 3 });
    const participant = await loggedClient(app.baseUrl, SEED.participant, SEED.password);
    const res = await participant.post(`/events/${id}/purchase`, { cardNumber: h.CARDS.approveFast });
    assert.ok([302, 303].includes(res.status), `compra na vitrine ${res.status}`);
    const { rows } = await query("SELECT id, code FROM tickets WHERE event_id = $1 AND channel = 'web'", [id]);
    assert.equal(rows.length, 1);
    const tw = rows[0];
    assert.equal((await h.listedEvent(app.baseUrl, id)).availableSeats, 2, 'vaga da vitrine aparece na API');
    await h.waitApiStatus(app.baseUrl, tw.id, 'confirmed', { timeoutMs: h.DELAYS.fast + 5000 });
    const r = await h.api(app.baseUrl, `/api/partner/tickets/${tw.id}`);
    assert.equal(
      r.text,
      JSON.stringify({ ticketId: tw.id, code: tw.code.trim(), eventId: id, status: 'confirmed', checkedIn: false })
    );
  });

  test('F04-AC08 status saem como valores (cancelled, refunded) mesmo em evento cancelado', async () => {
    const id = await h.createEvent(org, { capacity: 5 });
    const a = (await h.partnerBuy(app.baseUrl, id, { card: h.CARDS.approveSlow })).body.ticketId;
    const b = (await h.partnerBuy(app.baseUrl, id, { card: h.CARDS.approveSlow })).body.ticketId;
    await query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [id]);
    await query("UPDATE tickets SET status = 'cancelled' WHERE id = $1", [a]);
    await query("UPDATE tickets SET status = 'refunded' WHERE id = $1", [b]);
    assert.equal(await h.apiTicketStatus(app.baseUrl, a), 'cancelled');
    assert.equal(await h.apiTicketStatus(app.baseUrl, b), 'refunded');
  });

  test('F04-AC08 id inexistente -> 404 ticket_not_found', async () => {
    const id = await h.createEvent(org, { capacity: 5 });
    const t = (await h.partnerBuy(app.baseUrl, id)).body.ticketId;
    const ids = ['tkt_0000000000', 'abc', 'a'.repeat(300), '%27%20OR%201%3D1', `${t}x`, t.toUpperCase(), id];
    for (const x of ids) {
      const r = await h.api(app.baseUrl, `/api/partner/tickets/${x}`);
      assert.equal(r.status, 404, x.slice(0, 30));
      assert.equal(r.text, h.TICKET_NF_BODY);
      h.assertJson(r);
    }
  });
});
