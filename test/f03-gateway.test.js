'use strict';

// F03 — gateway simulado e worker (F03-AC06, F03-AC07, F03-AC09, F03-AC10).
// Roda com os atrasos curtos dos gates (GATEWAY_FAST/SLOW/POLL_MS); os padrões
// do modo do avaliador são verificados em f03-simulator.test.js.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, createClient, query, endPool } = require('./helpers');
const { getSeatStats } = require('../src/features/events/repo');
const { insertTicket } = require('../src/features/purchases/service');
const { startGatewayWorker, resolveDueTickets } = require('../src/features/gateway/worker');
const { pool } = require('../src/db');
const messages = require('../src/messages');
const { DELAYS, CARDS, sleep, signupParticipant, createEventSql, buy, buyPartner, ticketById, lastTicket, waitForStatus } = require('./f03-helpers');

let app;
let buyer;

before(async () => {
  app = await startApp();
  buyer = await signupParticipant(app.baseUrl, 'Gateway F03');
});
after(async () => {
  await app.close();
  await endPool();
});

const elapsed = (t) => t.updated_at.getTime() - t.created_at.getTime();

describe('f03-gateway.test.js', () => {
  test('F03-AC06 finais 0001/0002/outro resolvem no atraso rápido; 0003/0004 no lento; pending antes do vencimento', async () => {
    const e = await createEventSql({ capacity: 10 });
    const bought = {};
    for (const [k, card] of Object.entries(CARDS)) {
      const r = await buyPartner(e, card);
      assert.equal(r.ok, true, k);
      assert.equal(r.ticket.status, 'pending', k);
      bought[k] = r.ticket;
    }
    const expectDelay = { approveFast: DELAYS.fast, declineFast: DELAYS.fast, other: DELAYS.fast, approveSlow: DELAYS.slow, declineSlow: DELAYS.slow };
    const expectOutcome = { approveFast: 'approved', declineFast: 'declined', other: 'declined', approveSlow: 'approved', declineSlow: 'declined' };
    for (const [k, t] of Object.entries(bought)) {
      const due = t.gateway_due_at.getTime() - t.created_at.getTime();
      assert.ok(Math.abs(due - expectDelay[k]) <= 5, `${k}: vencimento ${due} ms`);
      assert.equal(t.gateway_outcome, expectOutcome[k], k);
    }

    const c1 = await waitForStatus(bought.approveFast.id, 'confirmed', DELAYS.fast + 3000);
    const d2 = await waitForStatus(bought.declineFast.id, 'declined', DELAYS.fast + 3000);
    const d9 = await waitForStatus(bought.other.id, 'declined', DELAYS.fast + 3000);
    for (const t of [c1, d2, d9]) {
      assert.ok(elapsed(t) >= DELAYS.fast, `não resolve antes do vencimento (${elapsed(t)} ms)`);
      assert.ok(t.updated_at.getTime() >= t.gateway_due_at.getTime());
    }
    // Os lentos continuam pendentes depois que os rápidos resolveram.
    assert.equal((await ticketById(bought.approveSlow.id)).status, 'pending');
    assert.equal((await ticketById(bought.declineSlow.id)).status, 'pending');

    const c3 = await waitForStatus(bought.approveSlow.id, 'confirmed', DELAYS.slow + 3000);
    const d4 = await waitForStatus(bought.declineSlow.id, 'declined', DELAYS.slow + 3000);
    for (const t of [c3, d4]) {
      assert.ok(elapsed(t) >= DELAYS.slow, `lento resolveu em ${elapsed(t)} ms`);
      assert.ok(elapsed(t) <= DELAYS.slow + 2000, `lento demorou ${elapsed(t)} ms`);
    }
  });

  test('F03-AC06 F03-AC11 na vitrine: pendente visível em "Meus ingressos" e depois confirmado/recusado', async () => {
    const e = await createEventSql({ capacity: 5, name: `Gateway web ${Date.now()}` });
    assert.equal((await buy(buyer.client, e, CARDS.approveSlow)).status, 303);
    const t1 = await lastTicket(e);
    assert.equal((await buy(buyer.client, e, CARDS.declineSlow)).status, 303);
    const t2 = await lastTicket(e);
    let html = await (await buyer.client.get('/me/tickets')).text();
    assert.ok(html.includes(`data-ticket-id="${t1.id}"`));
    for (const t of [t1, t2]) {
      const line = html.split('\n').find((l) => l.includes(`data-ticket-id="${t.id}"`));
      assert.ok(line.includes('data-status="pending">pendente<'), line);
    }
    await waitForStatus(t1.id, 'confirmed');
    await waitForStatus(t2.id, 'declined');
    html = await (await buyer.client.get('/me/tickets')).text();
    assert.ok(html.split('\n').find((l) => l.includes(`data-ticket-id="${t1.id}"`)).includes('data-status="confirmed">confirmado<'));
    assert.ok(html.split('\n').find((l) => l.includes(`data-ticket-id="${t2.id}"`)).includes('data-status="declined">recusado<'));
  });

  test('F03-AC07 recusa libera a vaga; só pending + confirmed ocupam', async () => {
    const e = await createEventSql({ capacity: 1 });
    const r = await buy(buyer.client, e, CARDS.declineFast);
    assert.equal(r.status, 303);
    const t = await lastTicket(e);
    assert.deepEqual(await getSeatStats(pool, e), { capacity: 1, occupied: 1, available: 0 });
    const page0 = await (await createClient(app.baseUrl).get(`/events/${e}`)).text();
    assert.ok(page0.includes(messages.SOLD_OUT));
    assert.equal((await buyPartner(e)).error, 'sold_out');

    await waitForStatus(t.id, 'declined', DELAYS.fast + 3000);
    assert.deepEqual(await getSeatStats(pool, e), { capacity: 1, occupied: 0, available: 1 });
    const page1 = await (await createClient(app.baseUrl).get(`/events/${e}`)).text();
    assert.ok(page1.includes('<p class="seats">Vagas disponíveis: 1</p>'));
    assert.ok(!page1.includes(messages.SOLD_OUT));
    assert.equal((await buy(buyer.client, e, CARDS.approveFast)).status, 303);

    // Todos os status: só pending e confirmed contam.
    const e2 = await createEventSql({ capacity: 10 });
    const statuses = ['pending', 'confirmed', 'declined', 'cancelled', 'refunded', 'confirmed'];
    for (const s of statuses) {
      const row = await insertTicket(pool, {
        eventId: e2, userId: null, buyerEmail: 's@example.com', priceCents: 1000, channel: 'partner',
        cardLast4: '0003', gatewayOutcome: 'approved', delayMs: 600000,
      });
      await query('UPDATE tickets SET status = $2 WHERE id = $1', [row.id, s]);
    }
    assert.deepEqual(await getSeatStats(pool, e2), { capacity: 10, occupied: 3, available: 7 });
    assert.equal(await getSeatStats(pool, 'evt_zzzzzzzzzz'), null);
  });

  test('F03-AC09 o worker só altera ingresso pending: cancelled/refunded continuam após o vencimento', async () => {
    const e = await createEventSql({ capacity: 5 });
    const a = (await buyPartner(e, CARDS.approveSlow)).ticket;
    const d = (await buyPartner(e, CARDS.declineSlow)).ticket;
    const f = (await buyPartner(e, CARDS.approveSlow)).ticket;
    await query("UPDATE tickets SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'pending'", [a.id]);
    await query("UPDATE tickets SET status = 'refunded', updated_at = now() WHERE id = $1 AND status = 'pending'", [d.id]);
    await waitForStatus(f.id, 'confirmed', DELAYS.slow + 3000); // controle: o worker passou por aqui
    await sleep(3 * DELAYS.poll + 50);
    const a2 = await ticketById(a.id);
    const d2 = await ticketById(d.id);
    assert.ok(a2.gateway_due_at.getTime() < Date.now());
    assert.equal(a2.status, 'cancelled');
    assert.equal(d2.status, 'refunded');
    // Um ciclo manual também não toca neles.
    await resolveDueTickets(pool);
    assert.equal((await ticketById(a.id)).status, 'cancelled');
    assert.equal((await ticketById(d.id)).status, 'refunded');
  });

  test('F03-AC10 o vencimento vem do banco: pending vencido (ex.: app parado) é resolvido pelo worker', async () => {
    const e = await createEventSql({ capacity: 5 });
    const ids = [];
    for (const outcome of ['approved', 'declined']) {
      const t = await insertTicket(pool, {
        eventId: e, userId: null, buyerEmail: 'restart@example.com', priceCents: 1000, channel: 'partner',
        cardLast4: outcome === 'approved' ? '0003' : '0004', gatewayOutcome: outcome, delayMs: 0,
      });
      await query("UPDATE tickets SET gateway_due_at = now() - interval '10 seconds' WHERE id = $1", [t.id]);
      ids.push(t.id);
    }
    await waitForStatus(ids[0], 'confirmed', 1000);
    await waitForStatus(ids[1], 'declined', 1000);
  });

  test('F03-AC10 startGatewayWorker é idempotente (um worker por processo)', async () => {
    const h1 = startGatewayWorker();
    const h2 = startGatewayWorker();
    assert.equal(h1, h2);
    assert.equal(typeof h1.stop, 'function');
  });
});
