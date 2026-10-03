'use strict';

// F04-AC07 / R07 — 30 compras HTTP simultâneas pela API num evento de lotação 5
// -> exatamente 5x202 e 25x409, em várias rodadas (cada uma num evento novo);
// as vagas ocupadas nunca passam da lotação.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, endPool, query } = require('./helpers');
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

async function burst(eventId, n, tag) {
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) => h.partnerBuy(app.baseUrl, eventId, { email: `carga${i + 1}.${tag}@example.com` }))
  );
  const tally = {};
  for (const r of results) tally[r.status] = (tally[r.status] || 0) + 1;
  return { results, tally };
}

async function seats(eventId) {
  const { rows } = await query(
    `SELECT count(*) FILTER (WHERE status IN ('pending', 'confirmed')) AS occupied,
            count(*) AS total, count(DISTINCT code) AS codes
       FROM tickets WHERE event_id = $1`,
    [eventId]
  );
  return { occupied: Number(rows[0].occupied), total: Number(rows[0].total), codes: Number(rows[0].codes) };
}

describe('partner-api-concurrency.test.js', () => {
  for (const round of [1, 2, 3, 4]) {
    test(`F04-AC07 rodada ${round}: 30 POSTs simultâneos em lotação 5 -> 5x202 e 25x409`, async () => {
      const id = await h.createEvent(org, { capacity: 5, price: '10,00' });
      const { results, tally } = await burst(id, 30, `r${round}`);
      assert.deepEqual(tally, { 202: 5, 409: 25 });
      for (const r of results) {
        h.assertJson(r);
        if (r.status === 409) assert.equal(r.text, h.SOLD_OUT_BODY);
      }
      const accepted = results.filter((r) => r.status === 202);
      assert.equal(new Set(accepted.map((r) => r.body.code)).size, 5, 'códigos distintos');
      assert.deepEqual(await seats(id), { occupied: 5, total: 5, codes: 5 });
      assert.equal((await h.listedEvent(app.baseUrl, id)).availableSeats, 0);
      // O worker confirma os 5 (final 0001) e a lotação continua respeitada.
      for (const r of accepted) await h.waitApiStatus(app.baseUrl, r.body.ticketId, 'confirmed', { timeoutMs: h.DELAYS.fast + 5000 });
      assert.deepEqual(await seats(id), { occupied: 5, total: 5, codes: 5 });
    });
  }

  test('F04-AC07 lotação 1: 30 simultâneos -> 1x202 e 29x409', async () => {
    const id = await h.createEvent(org, { capacity: 1, price: '10,00' });
    const { tally } = await burst(id, 30, 'cap1');
    assert.deepEqual(tally, { 202: 1, 409: 29 });
    assert.deepEqual(await seats(id), { occupied: 1, total: 1, codes: 1 });
  });

  test('F04-AC07 dois eventos disputados ao mesmo tempo não se misturam', async () => {
    const a = await h.createEvent(org, { capacity: 5, price: '10,00' });
    const b = await h.createEvent(org, { capacity: 3, price: '10,00' });
    const [ra, rb] = await Promise.all([burst(a, 30, 'ma'), burst(b, 30, 'mb')]);
    assert.deepEqual(ra.tally, { 202: 5, 409: 25 });
    assert.deepEqual(rb.tally, { 202: 3, 409: 27 });
    assert.equal((await seats(a)).occupied, 5);
    assert.equal((await seats(b)).occupied, 3);
  });
});
