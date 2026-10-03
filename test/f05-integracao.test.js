'use strict';

// F05 — integração com F03 (X-11): vitrine + worker do gateway + purchaseTicket
// no canal partner -> check-in e painel. Inclui os passos 9, 10, 11 e 14 do
// fluxo do avaliador (o cancelamento do passo 14 é simulado por SQL: F06 ainda
// não existe nesta wave). Os atrasos do gateway são os reduzidos dos gates.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, SEED, endPool, pool, query } = require('./helpers');
const messages = require('../src/messages');
const { eventFields, createEventHttp, publishEventHttp } = require('./support/events');
const { CARDS, DELAYS, sleep, signupParticipant, buy, buyPartner, lastTicket, waitForStatus, ticketById } = require('./f03-helpers');
const { createEvent, login, postCheckin, getPanel, panelOf } = require('./helpers/f05-fixtures');

let app;
let A;
let B;

before(async () => {
  app = await startApp();
  A = await login(app.baseUrl, SEED.orgA);
  B = await login(app.baseUrl, SEED.orgB);
});
after(async () => {
  await app.close();
  await endPool();
});

/** Compra na vitrine (303 -> /me/tickets) e devolve a linha do ingresso criado. */
async function webBuy(client, eventId, card) {
  const r = await buy(client, eventId, card);
  assert.equal(r.status, 303, `compra na vitrine deveria redirecionar (${r.status})`);
  assert.equal(r.location, '/me/tickets');
  return lastTicket(eventId);
}

/** Compra pelo serviço no canal partner (como a API de F04 fará) -> ingresso. */
async function partnerBuy(eventId, card, email) {
  const r = await buyPartner(eventId, card, email);
  assert.equal(r.ok, true, `purchaseTicket partner falhou: ${r.error}`);
  assert.equal(r.ticket.channel, 'partner');
  return r.ticket;
}

describe('f05-integracao.test.js — X-11 (F03 -> F05)', () => {
  test('X-11 vitrine + worker + canal partner entram no painel e fazem check-in; Receita pelo preço de cada compra', async () => {
    const ev = await createEvent({ capacity: 5, priceCents: 10000 });
    const p = await signupParticipant(app.baseUrl, 'Participante F05');

    const w1 = await webBuy(p.client, ev, CARDS.approveFast); // R$ 100
    const p1 = await partnerBuy(ev, CARDS.approveFast, 'f05.p1@example.com'); // R$ 100
    await query('UPDATE events SET price_cents = 15000, updated_at = now() WHERE id = $1', [ev]);
    const w2 = await webBuy(p.client, ev, CARDS.approveFast); // R$ 150
    const p2 = await partnerBuy(ev, CARDS.declineFast, 'f05.p2@example.com'); // recusado
    await waitForStatus(w1.id, 'confirmed', 5000);
    await waitForStatus(p1.id, 'confirmed', 5000);
    await waitForStatus(w2.id, 'confirmed', 5000);
    await waitForStatus(p2.id, 'declined', 5000);
    assert.deepEqual(
      [w1, p1, w2, p2].map((t) => `${t.channel}|${t.card_last4}|${t.price_cents}`),
      ['web|0001|10000', 'partner|0001|10000', 'web|0001|15000', 'partner|0002|15000']
    );

    assert.deepEqual(
      await getPanel(A, ev),
      panelOf({ confirmed: 3, pending: 0, checkins: 0, available: 2, revenue: 'R$ 350,00', refunded: 0 })
    );
    assert.equal((await postCheckin(A, ev, w1.code)).result, 'entry_allowed');
    assert.equal((await postCheckin(A, ev, w1.code)).result, 'already_used');
    assert.equal((await postCheckin(A, ev, p1.code)).result, 'entry_allowed', 'ingresso do canal partner');
    assert.equal((await postCheckin(A, ev, p2.code)).result, 'not_confirmed', 'recusado');
    assert.equal((await postCheckin(A, ev, 'ZZZZZZZZ')).result, 'invalid_ticket');
    assert.deepEqual(
      await getPanel(A, ev),
      panelOf({ confirmed: 3, pending: 0, checkins: 2, available: 2, revenue: 'R$ 350,00', refunded: 0 })
    );

    // 0004: recusa lenta, fica pendente durante as verificações seguintes.
    const w3 = await webBuy(p.client, ev, CARDS.declineSlow);
    assert.deepEqual(
      await getPanel(A, ev),
      panelOf({ confirmed: 3, pending: 1, checkins: 2, available: 1, revenue: 'R$ 350,00', refunded: 0 })
    );
    const pendingCheck = await postCheckin(A, ev, w3.code);
    assert.equal(pendingCheck.result, 'not_confirmed');
    assert.equal(pendingCheck.text, messages.CHECKIN.not_confirmed);
    assert.equal((await ticketById(w3.id)).status, 'pending', 'o 0004 ainda estava pendente no check-in');

    // O worker recusa o 0004: a vaga volta e o check-in continua não confirmado.
    await waitForStatus(w3.id, 'declined', DELAYS.slow + 3000);
    assert.deepEqual(
      await getPanel(A, ev),
      panelOf({ confirmed: 3, pending: 0, checkins: 2, available: 2, revenue: 'R$ 350,00', refunded: 0 })
    );
    assert.equal((await postCheckin(A, ev, w3.code)).result, 'not_confirmed');
  });

  test('X-11 passos 9, 10 e 11 do brief: painel 3/0/0/0/R$ 350,00/0, mensagens do check-in e C3 inválido em E1', async () => {
    // Passos 2 e 4: E1 criado e publicado por A (lotação 2, R$ 100,00).
    const name = `E1 F05 ${Date.now()}`;
    const created = await createEventHttp(A, { name, capacity: '2', price: '100,00' });
    assert.equal(created.status, 302);
    const e1 = created.id;
    assert.equal((await publishEventHttp(A, e1)).status, 302);

    // Passo 5: participante novo compra na vitrine com 0001 (C1).
    const p = await signupParticipant(app.baseUrl, 'Participante passo 5');
    const t1 = await webBuy(p.client, e1, CARDS.approveFast);
    await waitForStatus(t1.id, 'confirmed', 5000);
    const C1 = t1.code;

    // Passos 6 a 8: T2 (0004) pendente esgota E1; depois é recusado; T3 (0001) confirma.
    const t2 = await partnerBuy(e1, CARDS.declineSlow, 't2@example.com');
    const C2 = t2.code;
    const soldOut = await buyPartner(e1, CARDS.approveFast, 'esgotado@example.com');
    assert.deepEqual(soldOut, { ok: false, error: 'sold_out' });
    await waitForStatus(t2.id, 'declined', DELAYS.slow + 3000);
    const t3 = await partnerBuy(e1, CARDS.approveFast, 't3@example.com');
    await waitForStatus(t3.id, 'confirmed', 5000);

    // Passo 9: lotação 1 rejeitada; preço R$ 150,00 e lotação 3 aceitos; T4 (0001).
    const reject = await A.post(`/org/events/${e1}/edit`, eventFields({ name, capacity: '1', price: '100,00' }));
    assert.equal(reject.status, 422);
    assert.ok((await reject.text()).includes(messages.capacityBelowOccupied(2)));
    const accept = await A.post(`/org/events/${e1}/edit`, eventFields({ name, capacity: '3', price: '150,00' }));
    assert.equal(accept.status, 302);
    const t4 = await partnerBuy(e1, CARDS.approveFast, 't4@example.com');
    assert.equal(t4.price_cents, 15000);
    await waitForStatus(t4.id, 'confirmed', 5000);

    assert.deepEqual(
      await getPanel(A, e1),
      panelOf({ confirmed: 3, pending: 0, checkins: 0, available: 0, revenue: 'R$ 350,00', refunded: 0 })
    );

    // Passo 10: C1, C1, C2, ZZZZZZZZ; o painel passa a mostrar Check-ins 1.
    const steps = [
      [C1, 'entry_allowed', 'Entrada liberada'],
      [C1, 'already_used', 'Ingresso já utilizado'],
      [C2, 'not_confirmed', 'Ingresso não confirmado'],
      ['ZZZZZZZZ', 'invalid_ticket', 'Ingresso inválido para este evento'],
    ];
    for (const [code, key, text] of steps) {
      const r = await postCheckin(A, e1, code);
      assert.equal(r.status, 200);
      assert.equal(r.result, key, code);
      assert.equal(r.text, text);
      assert.ok(r.html.includes(`<p id="checkin-result" data-result="${key}">${text}</p>`));
    }
    assert.deepEqual(
      await getPanel(A, e1),
      panelOf({ confirmed: 3, pending: 0, checkins: 1, available: 0, revenue: 'R$ 350,00', refunded: 0 })
    );

    // Passo 11: B não vê E1; E2 de B (lotação 1, R$ 20,00) com C3; C3 é inválido em E1.
    const bView = await B.get(`/org/events/${e1}`);
    assert.equal(bView.status, 404);
    const bBody = await bView.text();
    assert.ok(!bBody.includes(name) && !bBody.includes('id="painel"'));
    const e2 = (await createEventHttp(B, { capacity: '1', price: '20,00' })).id;
    assert.equal((await publishEventHttp(B, e2)).status, 302);
    const t5 = await partnerBuy(e2, CARDS.approveFast, 'c3@example.com');
    await waitForStatus(t5.id, 'confirmed', 5000);
    const c3 = await postCheckin(A, e1, t5.code);
    assert.equal(c3.result, 'invalid_ticket');
    assert.equal(c3.text, 'Ingresso inválido para este evento');
    assert.deepEqual(
      await getPanel(A, e1),
      panelOf({ confirmed: 3, pending: 0, checkins: 1, available: 0, revenue: 'R$ 350,00', refunded: 0 })
    );
  });

  test('F05-AC03 / F05-AC10 passo 14 do brief: evento cancelado (via SQL) -> Evento cancelado e painel 0/0/0/R$ 0,00/1', async () => {
    const e3 = await createEvent({ capacity: 5, priceCents: 5000 });
    // T6 (0001) confirma primeiro; T5 (0003, aprovação lenta) é comprado logo
    // antes do cancelamento, para continuar pendente até ele.
    const t6 = await partnerBuy(e3, CARDS.approveFast, 't6@example.com');
    await waitForStatus(t6.id, 'confirmed', 5000);
    const t5 = await partnerBuy(e3, CARDS.approveSlow, 't5@example.com');

    // Cancelamento simulado como F06 fará: trava o evento e muda tudo na mesma transação.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [e3]);
      const { rows } = await client.query('SELECT status FROM tickets WHERE id = $1', [t5.id]);
      assert.equal(rows[0].status, 'pending', 'T5 ainda pendente no momento do cancelamento');
      await client.query("UPDATE events SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1", [e3]);
      await client.query("UPDATE tickets SET status = 'refunded', updated_at = now() WHERE event_id = $1 AND status = 'confirmed'", [e3]);
      await client.query("UPDATE tickets SET status = 'cancelled', updated_at = now() WHERE event_id = $1 AND status = 'pending'", [e3]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const r = await postCheckin(A, e3, t6.code);
    assert.equal(r.status, 200);
    assert.equal(r.result, 'event_cancelled');
    assert.equal(r.text, messages.CHECKIN.event_cancelled);
    assert.ok(r.html.includes(`<p id="checkin-event-cancelled">${messages.CHECKIN.event_cancelled}</p>`));
    const expected = panelOf({ confirmed: 0, pending: 0, checkins: 0, available: 5, revenue: 'R$ 0,00', refunded: 1 });
    assert.deepEqual(await getPanel(A, e3), expected);

    // A resposta tardia do gateway (0003) não muda nada.
    await sleep(DELAYS.slow + 500);
    assert.equal((await ticketById(t5.id)).status, 'cancelled');
    assert.deepEqual(await getPanel(A, e3), expected);
    assert.equal((await postCheckin(A, e3, t5.code)).result, 'event_cancelled');
    assert.equal((await postCheckin(A, e3, 'ZZZZZZZZ')).result, 'invalid_ticket');
  });
});
