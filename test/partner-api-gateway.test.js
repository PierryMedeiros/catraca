'use strict';

// F04-AC09 e X-08 — o worker do gateway (F03) resolve ingressos da API como os
// da vitrine: 0001 confirma no atraso rápido; 0002 e outros finais recusam;
// 0004 fica pending durante o atraso lento, vira declined e libera a vaga; a
// API esgotando o evento faz a vitrine mostrar "Ingressos esgotados".
// Atrasos vêm do ambiente (gates: 200 / 1500 ms); no modo padrão, 2000 / 65000.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, endPool, query, SEED } = require('./helpers');
const { loggedClient } = require('./support/events');
const messages = require('../src/messages');
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

describe('partner-api-gateway.test.js', () => {
  test('X-08 finais rápidos: 0001 -> confirmed, 0002 e 5555 -> declined; recusados liberam a vaga', async () => {
    const id = await h.createEvent(org, { capacity: 10 });
    const cards = ['4000000000000001', '4000000000000002', '4000000000005555'];
    const ids = [];
    for (const card of cards) {
      const r = await h.partnerBuy(app.baseUrl, id, { email: `g${card}@example.com`, card });
      assert.equal(r.status, 202);
      ids.push(r.body.ticketId);
    }
    assert.equal((await h.listedEvent(app.baseUrl, id)).availableSeats, 7);
    const limit = h.DELAYS.fast + 3000;
    await h.waitApiStatus(app.baseUrl, ids[0], 'confirmed', { timeoutMs: limit });
    await h.waitApiStatus(app.baseUrl, ids[1], 'declined', { timeoutMs: limit });
    await h.waitApiStatus(app.baseUrl, ids[2], 'declined', { timeoutMs: limit });
    assert.equal((await h.listedEvent(app.baseUrl, id)).availableSeats, 9);
    const { rows } = await query(
      'SELECT extract(epoch FROM updated_at - created_at) * 1000 AS ms FROM tickets WHERE id = ANY($1)',
      [ids]
    );
    for (const row of rows) assert.ok(Number(row.ms) <= 5000, `resolvido em ${row.ms} ms`);
  });

  test('F04-AC09 0004 fica pending durante o atraso lento, vira declined e a vaga volta (passos 6-8)', async () => {
    const id = await h.createEvent(org, { capacity: 2, price: '100,00' });
    const participant = await loggedClient(app.baseUrl, SEED.participant, SEED.password);
    const web = await participant.post(`/events/${id}/purchase`, { cardNumber: h.CARDS.approveFast });
    assert.ok([302, 303].includes(web.status));

    const t0 = Date.now();
    const t2 = await h.partnerBuy(app.baseUrl, id, { email: 't2@example.com', card: h.CARDS.declineSlow });
    assert.equal(t2.status, 202);
    assert.equal(t2.body.status, 'pending');
    assert.equal((await h.listedEvent(app.baseUrl, id)).availableSeats, 0);

    // Passo 7: antes do atraso lento, sold_out na API e esgotado na vitrine; T2 continua pending.
    const sold = await h.partnerBuy(app.baseUrl, id, { email: 't3a@example.com' });
    assert.equal(sold.status, 409);
    assert.equal(sold.text, h.SOLD_OUT_BODY);
    const page = await (await participant.get(`/events/${id}`)).text();
    assert.ok(page.includes(messages.SOLD_OUT), 'vitrine mostra Ingressos esgotados');
    if (Date.now() - t0 < h.DELAYS.slow - 200) assert.equal(await h.apiTicketStatus(app.baseUrl, t2.body.ticketId), 'pending');

    // Passo 8: vira declined depois do atraso lento e availableSeats sobe 1.
    const elapsed = await h.waitApiStatus(app.baseUrl, t2.body.ticketId, 'declined', {
      t0,
      timeoutMs: h.DELAYS.slow + 5000,
    });
    assert.ok(elapsed >= h.DELAYS.slow - 100, `recusa chegou cedo demais (${elapsed} ms)`);
    const { rows } = await query('SELECT extract(epoch FROM updated_at - created_at) * 1000 AS ms FROM tickets WHERE id = $1', [
      t2.body.ticketId,
    ]);
    assert.ok(Number(rows[0].ms) >= h.DELAYS.slow, `pending por ${rows[0].ms} ms`);
    assert.equal((await h.listedEvent(app.baseUrl, id)).availableSeats, 1);

    const t3 = await h.partnerBuy(app.baseUrl, id, { email: 't3@example.com' });
    assert.equal(t3.status, 202);
    await h.waitApiStatus(app.baseUrl, t3.body.ticketId, 'confirmed', { timeoutMs: h.DELAYS.fast + 3000 });
  });

  test('X-08 0003 fica pending durante o atraso lento e vira confirmed', async () => {
    const id = await h.createEvent(org, { capacity: 5 });
    const t0 = Date.now();
    const r = await h.partnerBuy(app.baseUrl, id, { card: h.CARDS.approveSlow });
    assert.equal(r.status, 202);
    assert.equal(await h.apiTicketStatus(app.baseUrl, r.body.ticketId), 'pending');
    const elapsed = await h.waitApiStatus(app.baseUrl, r.body.ticketId, 'confirmed', { t0, timeoutMs: h.DELAYS.slow + 5000 });
    assert.ok(elapsed >= h.DELAYS.slow - 100);
  });

  test('X-08 API esgota o evento -> vitrine mostra Ingressos esgotados e não vende', async () => {
    const id = await h.createEvent(org, { capacity: 1, price: '30,00' });
    assert.equal((await h.partnerBuy(app.baseUrl, id, { card: h.CARDS.approveSlow })).status, 202);
    const participant = await loggedClient(app.baseUrl, SEED.participant, SEED.password);
    const page = await (await participant.get(`/events/${id}`)).text();
    assert.ok(page.includes(messages.SOLD_OUT));
    const res = await participant.post(`/events/${id}/purchase`, { cardNumber: h.CARDS.approveFast });
    const body = await res.text();
    assert.equal(res.status, 409);
    assert.ok(body.includes(messages.SOLD_OUT));
    const { rows } = await query('SELECT count(*) AS n FROM tickets WHERE event_id = $1', [id]);
    assert.equal(Number(rows[0].n), 1);
  });
});
