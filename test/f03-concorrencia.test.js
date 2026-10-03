'use strict';

// F03-AC08 / R07 — a lotação vale sob compras simultâneas. Cada rodada usa um
// evento novo de lotação 5 e dispara 30 compras ao mesmo tempo: exatamente 5
// passam e as ocupadas nunca passam de 5.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, endPool, pool } = require('./helpers');
const { purchaseTicket, generateTicketCode } = require('../src/features/purchases/service');
const { newId } = require('../src/ids');
const { lockEvent } = require('../src/features/events/repo');
const { CARDS, sleep, signupParticipant, createEventSql, occupiedSeats, countTickets, waitForStatus, ticketsOfEvent } = require('./f03-helpers');

let app;
let buyer;

before(async () => {
  app = await startApp();
  buyer = await signupParticipant(app.baseUrl, 'Carga F03');
});
after(async () => {
  await app.close();
  await endPool();
});

function tally(results) {
  const c = {};
  for (const r of results) {
    const k = r.ok ? 'ok' : r.error;
    c[k] = (c[k] || 0) + 1;
  }
  return c;
}

describe('f03-concorrencia.test.js', () => {
  for (const round of [1, 2, 3]) {
    test(`F03-AC08 rodada ${round}: 30 purchaseTicket simultâneos em lotação 5 -> 5 ok e 25 sold_out`, async () => {
      const e = await createEventSql({ capacity: 5, priceCents: 1000 });
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          purchaseTicket({ eventId: e, buyer: { email: `carga${round}-${i}@example.com` }, cardNumber: CARDS.approveFast, channel: 'partner' })
        )
      );
      assert.deepEqual(tally(results), { ok: 5, sold_out: 25 });
      assert.equal(await occupiedSeats(e), 5);
      assert.equal(await countTickets(e), 5);
      const codes = new Set(results.filter((r) => r.ok).map((r) => r.ticket.code));
      assert.equal(codes.size, 5);
    });
  }

  test('F03-AC08 30 POSTs simultâneos na vitrine em lotação 5 -> 5x303 e 25x409; depois 5 confirmados', async () => {
    const e = await createEventSql({ capacity: 5, priceCents: 1000 });
    const responses = await Promise.all(
      Array.from({ length: 30 }, () => buyer.client.post(`/events/${e}/purchase`, { cardNumber: CARDS.approveFast }))
    );
    const statuses = {};
    for (const r of responses) {
      statuses[r.status] = (statuses[r.status] || 0) + 1;
      await r.arrayBuffer();
    }
    assert.deepEqual(statuses, { 303: 5, 409: 25 });
    assert.equal(await occupiedSeats(e), 5);
    for (const t of await ticketsOfEvent(e)) await waitForStatus(t.id, 'confirmed');
    assert.equal(await occupiedSeats(e), 5);
  });

  test('F03-AC08 vitrine e parceiro disputando o mesmo evento -> exatamente a lotação', async () => {
    const e = await createEventSql({ capacity: 5, priceCents: 1000 });
    const web = Array.from({ length: 15 }, () =>
      buyer.client.post(`/events/${e}/purchase`, { cardNumber: CARDS.approveFast }).then(async (r) => {
        await r.arrayBuffer();
        return r.status === 303 ? { ok: true } : { ok: false, error: r.status === 409 ? 'sold_out' : String(r.status) };
      })
    );
    const partner = Array.from({ length: 15 }, (_, i) =>
      purchaseTicket({ eventId: e, buyer: { email: `misto${i}@example.com` }, cardNumber: CARDS.approveFast, channel: 'partner' })
    );
    const results = await Promise.all([...web, ...partner]);
    assert.deepEqual(tally(results), { ok: 5, sold_out: 25 });
    assert.equal(await occupiedSeats(e), 5);
  });

  test('F03-AC08 a compra espera a trava do evento (SELECT ... FOR UPDATE) antes de contar vagas', async () => {
    const e = await createEventSql({ capacity: 1, priceCents: 1000 });
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      assert.ok(await lockEvent(holder, e));
      let settled = false;
      const p = purchaseTicket({ eventId: e, buyer: { email: 'trava@example.com' }, cardNumber: CARDS.approveFast, channel: 'partner' })
        .then((r) => { settled = true; return r; });
      await sleep(400);
      assert.equal(settled, false, 'a compra não pode decidir enquanto outra transação segura a trava');
      // Enquanto a trava está presa, outra transação ocupa a última vaga.
      await holder.query(
        `INSERT INTO tickets (id, event_id, buyer_email, code, price_cents, channel, card_last4, gateway_outcome, gateway_due_at)
         VALUES ($2, $1, 'x@example.com', $3, 1000, 'partner', '0003', 'approved', now() + interval '1 hour')`,
        [e, newId('tkt'), generateTicketCode()]
      );
      await holder.query('COMMIT');
      const r = await p;
      assert.deepEqual(r, { ok: false, error: 'sold_out' }, 'a compra vê o ingresso commitado por quem tinha a trava');
      assert.equal(await occupiedSeats(e), 1);
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      holder.release();
    }
  });
});
