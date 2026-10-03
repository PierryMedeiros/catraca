'use strict';

// F06 — concorrência do cancelamento (F06-AC08, R07/R11) e integração da W4
// (X-17: compras HTTP da API de F04 no painel e no check-in de F05).

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, SEED, endPool, query } = require('./helpers');
const messages = require('../src/messages');
const { CANCEL_TEXTS } = require('../src/features/cancellation/texts');
const { createEventHttp, publishEventHttp } = require('./support/events');
const { CARDS, sleep, waitForStatus } = require('./f03-helpers');
const { login, postCheckin, getPanel, panelOf } = require('./helpers/f05-fixtures');
const h = require('./partner-api.helpers');

let app;
let A;

before(async () => {
  app = await startApp();
  A = await login(app.baseUrl, SEED.orgA);
});
after(async () => {
  await app.close();
  await endPool();
});

async function newPublishedEvent(capacity = 5, price = '10,00') {
  const created = await createEventHttp(A, { capacity: String(capacity), price });
  assert.equal(created.status, 302);
  assert.equal((await publishEventHttp(A, created.id)).status, 302);
  return created.id;
}

async function cancel(eventId) {
  const res = await A.post(`/org/events/${eventId}/cancel`, {});
  return { status: res.status, html: await res.text() };
}

function burst(eventId, n, tag) {
  return Promise.all(
    Array.from({ length: n }, (_, i) =>
      h.partnerBuy(app.baseUrl, eventId, { email: `c-${tag}-${i + 1}@example.com`, card: CARDS.approveFast })
    )
  );
}

function tally(results) {
  const out = {};
  for (const r of results) out[r.status] = (out[r.status] || 0) + 1;
  return out;
}

async function eventTickets(eventId) {
  const { rows } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status IN ('pending', 'confirmed'))::int AS active,
            array_agg(DISTINCT status) FILTER (WHERE status IS NOT NULL) AS statuses
       FROM tickets WHERE event_id = $1`,
    [eventId]
  );
  return rows[0];
}

describe('cancellation-concurrency.test.js — F06-AC08 e X-17', () => {
  let total404 = 0;

  for (const round of [1, 2, 3, 4, 5]) {
    test(`F06-AC08 rodada ${round}: cancelamento concorrente com 30 compras pela API -> nada pending/confirmed, perdedores 404`, async () => {
      const id = await newPublishedEvent(5);
      let cancelP;
      let buysP;
      if (round % 2 === 1) {
        cancelP = cancel(id);
        buysP = burst(id, 30, `r${round}`);
      } else {
        buysP = burst(id, 30, `r${round}`);
        await sleep(20);
        cancelP = cancel(id);
      }
      const [cancelled, results] = await Promise.all([cancelP, buysP]);
      assert.equal(cancelled.status, 302, 'o cancelamento do dono é aceito');

      const t = tally(results);
      for (const status of Object.keys(t)) assert.ok(['202', '404', '409'].includes(status), `status ${status}`);
      const n202 = t[202] || 0;
      assert.ok(n202 <= 5, `202 = ${n202} não passa da lotação`);
      for (const r of results) {
        if (r.status === 404) assert.equal(r.text, h.EVENT_NA_BODY);
        if (r.status === 409) assert.equal(r.text, h.SOLD_OUT_BODY);
      }
      total404 += t[404] || 0;

      const tk = await eventTickets(id);
      assert.equal(tk.total, n202, 'um ingresso por 202');
      assert.equal(tk.active, 0, 'nenhum pending/confirmed em evento cancelado');
      if (tk.total > 0) for (const s of tk.statuses) assert.ok(['cancelled', 'refunded'].includes(s), s);
      assert.equal((await query('SELECT status FROM events WHERE id = $1', [id])).rows[0].status, 'cancelled');

      for (let i = 0; i < 3; i++) {
        const r = await h.partnerBuy(app.baseUrl, id, { email: 'pos@example.com' });
        assert.equal(r.status, 404);
        assert.equal(r.text, h.EVENT_NA_BODY);
      }
      // Nada muda depois (o worker não reativa nada).
      await sleep(h.DELAYS.fast + 4 * h.DELAYS.poll);
      assert.equal((await eventTickets(id)).active, 0);
    });
  }

  test('F06-AC08 no total das rodadas, ao menos uma compra perdeu a corrida para o cancelamento (404 dentro do lote)', () => {
    assert.ok(total404 >= 1, `404 dentro dos lotes: ${total404}`);
  });

  for (const round of [1, 2, 3]) {
    test(`F06-AC08 cancelamento duplo simultâneo (rodada ${round}): um 302 e um 409; ingressos transitam uma vez`, async () => {
      const id = await newPublishedEvent(5);
      const tc = await h.partnerBuy(app.baseUrl, id, { card: CARDS.approveFast, email: 'dc@example.com' });
      const tp = await h.partnerBuy(app.baseUrl, id, { card: CARDS.approveSlow, email: 'dp@example.com' });
      await query("UPDATE tickets SET gateway_due_at = now() + interval '1 hour' WHERE id = $1", [tp.body.ticketId]);
      await waitForStatus(tc.body.ticketId, 'confirmed', 5000);

      const [r1, r2] = await Promise.all([cancel(id), cancel(id)]);
      assert.deepEqual([r1.status, r2.status].sort(), [302, 409]);
      const loser = r1.status === 409 ? r1 : r2;
      assert.ok(loser.html.includes(CANCEL_TEXTS.cancelledReadOnly));
      const { rows } = await query(
        'SELECT status, count(*)::int AS n FROM tickets WHERE event_id = $1 GROUP BY status ORDER BY status',
        [id]
      );
      assert.deepEqual(rows, [
        { status: 'cancelled', n: 1 },
        { status: 'refunded', n: 1 },
      ]);
    });
  }

  for (const k of [1, 2]) {
    test(`X-17 evento ${k}: 30 compras simultâneas pela API (lotação 5) -> painel Confirmados 5 e Vagas 0 em até 10 s; check-in Entrada liberada`, async () => {
      const id = await newPublishedEvent(5);
      const results = await burst(id, 30, `x17-${k}`);
      assert.deepEqual(tally(results), { 202: 5, 409: 25 });
      const accepted = results.filter((r) => r.status === 202).map((r) => r.body);

      const t0 = Date.now();
      let panel;
      while (Date.now() - t0 < 10000) {
        panel = await getPanel(A, id);
        if (panel.confirmed === '5') break;
        await sleep(100);
      }
      assert.deepEqual(panel, panelOf({ confirmed: 5, pending: 0, checkins: 0, available: 0, revenue: 'R$ 50,00', refunded: 0 }));
      assert.ok(Date.now() - t0 <= 10000, 'em até 10 s');
      assert.equal((await h.listedEvent(app.baseUrl, id)).availableSeats, 0);

      const r = await postCheckin(A, id, accepted[0].code);
      assert.equal(r.result, 'entry_allowed');
      assert.equal(r.text, messages.CHECKIN.entry_allowed);
      assert.equal((await getPanel(A, id)).checkins, '1');
      const api = await h.api(app.baseUrl, `/api/partner/tickets/${accepted[0].ticketId}`);
      assert.equal(api.body.checkedIn, true);
    });
  }
});
