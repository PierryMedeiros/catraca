'use strict';

// F03 — compra na vitrine e ordem de erros do serviço (F03-AC03, F03-AC04,
// F03-AC05 no POST, F03-AC13).

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, createClient, SEED, query, endPool } = require('./helpers');
const messages = require('../src/messages');
const { purchaseTicket } = require('../src/features/purchases/service');
const { CARD_INVALID_MESSAGE } = require('../src/features/purchases/views');
const {
  DELAYS,
  CARDS,
  loginClient,
  signupParticipant,
  createEventSql,
  buy,
  buyPartner,
  lastTicket,
  countTickets,
} = require('./f03-helpers');

let app;
let buyer; // { client, email, userId }
let A;

before(async () => {
  app = await startApp();
  buyer = await signupParticipant(app.baseUrl, 'Compra F03');
  A = await loginClient(app.baseUrl, SEED.orgA);
});
after(async () => {
  await app.close();
  await endPool();
});

describe('f03-compra.test.js', () => {
  test('F03-AC03 compra cria ingresso pending (web, user_id, preço vigente, código, só card_last4) sem esperar o gateway', async () => {
    const e = await createEventSql({ capacity: 3, priceCents: 12345 });
    const r = await buy(buyer.client, e, CARDS.approveSlow);
    assert.equal(r.status, 303);
    assert.equal(r.location, '/me/tickets');
    assert.ok(r.ms < 1000, `resposta em ${r.ms} ms`);
    assert.ok(r.ms < DELAYS.slow, 'não esperou o gateway');

    const t = await lastTicket(e);
    assert.equal(t.status, 'pending');
    assert.equal(t.channel, 'web');
    assert.equal(t.user_id, buyer.userId);
    assert.equal(t.buyer_email, buyer.email);
    assert.equal(t.price_cents, 12345);
    assert.match(t.code, /^[A-Z0-9]{8}$/);
    assert.match(t.id, /^tkt_[a-z0-9]{10}$/);
    assert.equal(t.card_last4, '0003');
    assert.equal(t.gateway_outcome, 'approved');
    assert.equal(t.checked_in, false);
    assert.equal(t.checked_in_at, null);
    const due = t.gateway_due_at.getTime() - t.created_at.getTime();
    assert.ok(Math.abs(due - DELAYS.slow) <= 5, `vencimento ${due} ms`);

    const { rows } = await query(
      'SELECT count(*) AS n FROM tickets t WHERE row_to_json(t)::text LIKE $1',
      [`%${CARDS.approveSlow}%`]
    );
    assert.equal(Number(rows[0].n), 0, 'número completo do cartão nunca é gravado');

    const page = await buyer.client.get('/me/tickets');
    const html = await page.text();
    const line = html.split('\n').find((l) => l.includes(`data-ticket-id="${t.id}"`));
    assert.ok(line.includes('data-status="pending">pendente<'), line);
    assert.ok(line.includes(`<td class="ticket-code">${t.code}</td>`), line);
  });

  test('F03-AC04 cartão fora de 16 dígitos é rejeitado (422) sem criar ingresso; espaços são removidos', async () => {
    const e = await createEventSql({ capacity: 3 });
    for (const card of ['123', '400000000000000', '40000000000000011', '400000000000000a', '']) {
      const r = await buy(buyer.client, e, card);
      assert.equal(r.status, 422, JSON.stringify(card));
      assert.ok(r.html.includes(`<p class="error" role="alert">${CARD_INVALID_MESSAGE}</p>`));
      assert.ok(r.html.includes('name="cardNumber"'), 'formulário reexibido');
      if (card) assert.ok(!r.html.includes(card), 'número não é ecoado');
    }
    const repeated = await buyer.client.request('POST', `/events/${e}/purchase`, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'cardNumber=4000000000000001&cardNumber=4000000000000001',
    });
    assert.equal(repeated.status, 422, 'campo repetido');
    assert.equal((await buy(buyer.client, e, undefined)).status, 422, 'campo ausente');
    const empty = await buyer.client.request('POST', `/events/${e}/purchase`);
    assert.equal(empty.status, 422, 'sem corpo');
    const json = await buyer.client.postJson(`/events/${e}/purchase`, '{nao e json');
    assert.ok([400, 422].includes(json.status), `JSON malformado: ${json.status}`);
    assert.equal(await countTickets(e), 0);

    const ok = await buy(buyer.client, e, '4000 0000 0000 0001');
    assert.equal(ok.status, 303);
    assert.equal(await countTickets(e), 1);
    assert.equal((await lastTicket(e)).card_last4, '0001');
  });

  test('F03-AC05 sem vaga, o POST responde 409 com "Ingressos esgotados" e não cria ingresso', async () => {
    const e = await createEventSql({ capacity: 1 });
    assert.equal((await buy(buyer.client, e, CARDS.approveSlow)).status, 303);
    const before1 = await countTickets(e);
    const r = await buy(buyer.client, e, CARDS.approveFast);
    assert.equal(r.status, 409);
    assert.ok(r.html.includes(`<p class="error" role="alert">${messages.SOLD_OUT}</p>`));
    assert.ok(!r.html.includes('name="cardNumber"'));
    assert.equal(await countTickets(e), before1);
  });

  test('F03-AC13 só participante compra: organizador 403, visitante vai ao login com next do evento', async () => {
    const e = await createEventSql({ capacity: 3 });
    const org = await buy(A, e, CARDS.approveFast);
    assert.equal(org.status, 403);
    assert.ok(!org.html.includes('name="cardNumber"'));
    const v = await buy(createClient(app.baseUrl), e, CARDS.approveFast);
    assert.equal(v.status, 302);
    assert.equal(v.location, `/login?next=/events/${e}`);
    assert.equal(await countTickets(e), 0);
  });

  test('F03-AC03 F03-AC04 POST em evento inexistente, rascunho, cancelado ou id malformado -> 404 sem ingresso', async () => {
    const ed = await createEventSql({ status: 'draft' });
    const ex = await createEventSql({ status: 'cancelled' });
    for (const id of [ed, ex, 'evt_naoexiste0', 'nao-e-id']) {
      const r = await buy(buyer.client, id, CARDS.approveFast);
      assert.equal(r.status, 404, id);
      assert.ok(r.html.includes(messages.EVENT_NOT_FOUND));
    }
    assert.equal(await countTickets(ed), 0);
    assert.equal(await countTickets(ex), 0);
  });

  test('F03-AC03 F03-AC04 ordem de erros de purchaseTicket: invalid_request -> event_not_available -> sold_out', async () => {
    const ep = await createEventSql({ capacity: 5 });
    const ed = await createEventSql({ status: 'draft' });
    const ex = await createEventSql({ status: 'cancelled' });
    const ecf = await createEventSql({ capacity: 1 });
    assert.equal((await buyPartner(ecf, CARDS.approveSlow)).ok, true);
    await query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [ecf]);
    const efull = await createEventSql({ capacity: 1 });
    assert.equal((await buyPartner(efull, CARDS.approveSlow)).ok, true);

    const b = { email: 'ordem@example.com' };
    const card = CARDS.approveFast;
    const ch = 'partner';
    const cases = [
      ['cartão inválido + evento inexistente', { eventId: 'evt_naoexiste0', buyer: b, cardNumber: '123', channel: ch }, 'invalid_request'],
      ['e-mail inválido', { eventId: ep, buyer: { email: 'x@y' }, cardNumber: card, channel: ch }, 'invalid_request'],
      ['e-mail ausente', { eventId: ep, buyer: {}, cardNumber: card, channel: ch }, 'invalid_request'],
      ['sem buyer', { eventId: ep, cardNumber: card, channel: ch }, 'invalid_request'],
      ['cartão numérico', { eventId: ep, buyer: b, cardNumber: 4000000000000001, channel: ch }, 'invalid_request'],
      ['cartão com espaços', { eventId: ep, buyer: b, cardNumber: '4000 0000 0000 0001', channel: ch }, 'invalid_request'],
      ['canal inválido', { eventId: ep, buyer: b, cardNumber: card, channel: 'pix' }, 'invalid_request'],
      ['web sem usuário', { eventId: ep, buyer: b, cardNumber: card, channel: 'web' }, 'invalid_request'],
      ['inexistente', { eventId: 'evt_naoexiste0', buyer: b, cardNumber: card, channel: ch }, 'event_not_available'],
      ['id malformado', { eventId: 'xyz', buyer: b, cardNumber: card, channel: ch }, 'event_not_available'],
      ['rascunho', { eventId: ed, buyer: b, cardNumber: card, channel: ch }, 'event_not_available'],
      ['cancelado', { eventId: ex, buyer: b, cardNumber: card, channel: ch }, 'event_not_available'],
      ['cancelado e sem vaga', { eventId: ecf, buyer: b, cardNumber: card, channel: ch }, 'event_not_available'],
      ['sem vaga', { eventId: efull, buyer: b, cardNumber: card, channel: ch }, 'sold_out'],
    ];
    for (const [label, input, expected] of cases) {
      const r = await purchaseTicket(input);
      assert.deepEqual(r, { ok: false, error: expected }, label);
      assert.equal(messages.API_ERRORS[expected], expected);
    }
    assert.equal(Number((await query("SELECT count(*) AS n FROM tickets WHERE buyer_email = 'ordem@example.com'")).rows[0].n), 0);

    const ok = await purchaseTicket({ eventId: ep, buyer: { email: '  Ana@Example.COM ' }, cardNumber: card, channel: ch });
    assert.equal(ok.ok, true);
    assert.equal(ok.ticket.status, 'pending');
    assert.equal(ok.ticket.channel, 'partner');
    assert.equal(ok.ticket.user_id, null);
    assert.equal(ok.ticket.buyer_email, 'ana@example.com');
  });
});
