'use strict';

// F03 — "Meus ingressos" (F03-AC11) e código único do ingresso (F03-AC12).

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, createClient, SEED, query, endPool, pool } = require('./helpers');
const messages = require('../src/messages');
const { insertTicket, generateTicketCode, getTicketById } = require('../src/features/purchases/service');
const { CARDS, signupParticipant, loginClient, createEventSql, buy, buyPartner, lastTicket, waitForStatus } = require('./f03-helpers');

let app;

before(async () => {
  app = await startApp();
});
after(async () => {
  await app.close();
  await endPool();
});

function ticketLines(html) {
  return html.split('\n').filter((l) => l.includes('<tr class="ticket"'));
}

describe('f03-meus-ingressos.test.js', () => {
  test('F03-AC11 cada participante vê só os próprios ingressos (evento, rótulo, código); compra partner não aparece', async () => {
    const tag = Date.now();
    const ea = await createEventSql({ name: `MeusA ${tag}`, priceCents: 10000 });
    const eb = await createEventSql({ name: `MeusB ${tag}`, priceCents: 2000, organizerEmail: SEED.orgB });
    const duda = await signupParticipant(app.baseUrl, 'Duda F03');
    const edu = await signupParticipant(app.baseUrl, 'Edu F03');

    const empty = await (await duda.client.get('/me/tickets')).text();
    assert.ok(empty.includes('<p class="empty">Você ainda não comprou ingressos.</p>'));

    assert.equal((await buy(duda.client, ea, CARDS.approveFast)).status, 303);
    const tA = await lastTicket(ea);
    assert.equal((await buy(duda.client, eb, CARDS.declineFast)).status, 303);
    const tB = await lastTicket(eb);
    assert.equal((await buy(edu.client, ea, CARDS.approveFast)).status, 303);
    const tEdu = await lastTicket(ea);
    const partner = await buyPartner(ea, CARDS.approveFast, duda.email);
    assert.equal(partner.ok, true);
    assert.equal(partner.ticket.user_id, null);

    await waitForStatus(tA.id, 'confirmed');
    await waitForStatus(tB.id, 'declined');

    const res = await duda.client.get('/me/tickets');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const html = await res.text();
    const lines = ticketLines(html);
    assert.equal(lines.length, 2);
    const la = lines.find((l) => l.includes(`data-ticket-id="${tA.id}"`));
    const lb = lines.find((l) => l.includes(`data-ticket-id="${tB.id}"`));
    assert.ok(la.includes(`<td class="ticket-event">MeusA ${tag}</td>`), la);
    assert.ok(la.includes('<td class="ticket-status" data-status="confirmed">confirmado</td>'), la);
    assert.ok(la.includes(`<td class="ticket-code">${tA.code}</td>`), la);
    assert.ok(lb.includes(`<td class="ticket-event">MeusB ${tag}</td>`), lb);
    assert.ok(lb.includes('<td class="ticket-status" data-status="declined">recusado</td>'), lb);
    assert.ok(lb.includes(`<td class="ticket-code">${tB.code}</td>`), lb);
    assert.ok(!html.includes(tEdu.code), 'ingresso de outro participante não aparece');
    assert.ok(!html.includes(partner.ticket.code), 'compra pela API não se vincula à conta');

    const eduHtml = await (await edu.client.get('/me/tickets')).text();
    assert.equal(ticketLines(eduHtml).length, 1);
    assert.ok(eduHtml.includes(tEdu.code));
    assert.ok(!eduHtml.includes(tA.code));
  });

  test('F03-AC11 rótulos pt-BR de todos os status vêm de messages.js', async () => {
    const p = await signupParticipant(app.baseUrl, 'Rotulos F03');
    const e = await createEventSql({ capacity: 10 });
    const ids = {};
    for (const s of Object.keys(messages.TICKET_STATUS_LABELS)) {
      const t = await insertTicket(pool, {
        eventId: e, userId: p.userId, buyerEmail: p.email, priceCents: 1000, channel: 'web',
        cardLast4: '0003', gatewayOutcome: 'approved', delayMs: 600000,
      });
      await query('UPDATE tickets SET status = $2 WHERE id = $1', [t.id, s]);
      ids[s] = t.id;
    }
    const html = await (await p.client.get('/me/tickets')).text();
    for (const [s, label] of Object.entries(messages.TICKET_STATUS_LABELS)) {
      const line = html.split('\n').find((l) => l.includes(`data-ticket-id="${ids[s]}"`));
      assert.ok(line.includes(`data-status="${s}">${label}<`), line);
    }
  });

  test('F03-AC11 visitante vai ao login; organizador recebe 403', async () => {
    const v = await createClient(app.baseUrl).get('/me/tickets');
    assert.equal(v.status, 302);
    assert.equal(v.headers.get('location'), '/login?next=%2Fme%2Ftickets');
    const a = await loginClient(app.baseUrl, SEED.orgA);
    const r = await a.get('/me/tickets');
    assert.equal(r.status, 403);
    assert.ok(!(await r.text()).includes('class="ticket"'));
  });

  test('F03-AC12 código UNIQUE (tickets_code_key), formatos de id/código e nova tentativa em colisão', async () => {
    const { rows } = await query(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'tickets'::regclass AND contype = 'u'`
    );
    assert.deepEqual(rows, [{ conname: 'tickets_code_key', def: 'UNIQUE (code)' }]);

    const e = await createEventSql({ capacity: 10 });
    const first = (await buyPartner(e, CARDS.approveSlow)).ticket;
    await assert.rejects(
      query(
        `INSERT INTO tickets (id, event_id, buyer_email, code, price_cents, channel, card_last4, gateway_outcome, gateway_due_at)
         VALUES ('tkt_zzzzzzzzzz', $1, 'x@example.com', $2, 1000, 'partner', '0003', 'approved', now())`,
        [e, first.code]
      ),
      { code: '23505', constraint: 'tickets_code_key' }
    );

    const fresh = generateTicketCode();
    let calls = 0;
    const t = await insertTicket(
      pool,
      { eventId: e, userId: null, buyerEmail: 'colisao@example.com', priceCents: 1000, channel: 'partner', cardLast4: '0002', gatewayOutcome: 'declined', delayMs: 1000 },
      () => (++calls === 1 ? first.code : fresh)
    );
    assert.equal(calls, 2);
    assert.equal(t.code, fresh);
    assert.match(t.id, /^tkt_[a-z0-9]{10}$/);

    await assert.rejects(
      insertTicket(
        pool,
        { eventId: e, userId: null, buyerEmail: 'colisao@example.com', priceCents: 1000, channel: 'partner', cardLast4: '0002', gatewayOutcome: 'declined', delayMs: 1000 },
        () => first.code
      ),
      /nenhum código livre/
    );

    const sample = Array.from({ length: 2000 }, () => generateTicketCode());
    assert.ok(sample.every((c) => /^[A-Z0-9]{8}$/.test(c)));
    assert.ok(new Set(sample).size >= 1999);

    const all = await query("SELECT count(*) AS n FROM tickets WHERE id !~ '^tkt_[a-z0-9]{10}$' OR code !~ '^[A-Z0-9]{8}$'");
    assert.equal(Number(all.rows[0].n), 0);
  });

  test('F03-AC12 getTicketById lê ingresso de qualquer canal e devolve null para id inexistente ou malformado', async () => {
    const e = await createEventSql({ capacity: 5 });
    const t = (await buyPartner(e, CARDS.approveSlow)).ticket;
    const got = await getTicketById(pool, t.id);
    assert.equal(got.id, t.id);
    assert.equal(got.code, t.code);
    assert.equal(got.event_id, e);
    assert.equal(got.checked_in, false);
    assert.equal(await getTicketById(pool, 'tkt_naoexiste0'), null);
    assert.equal(await getTicketById(pool, "x' OR 1=1"), null);
    assert.equal(await getTicketById(pool, undefined), null);
  });
});
