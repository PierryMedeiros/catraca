'use strict';

// F06 — Cancelamento de evento (R11): F06-AC01..AC07 e os critérios
// cross-feature X-12..X-16 cujo contrato é F06. Tudo pelo HTTP do app real
// (vitrine, gestão, API de parceiros, check-in e painel). Atrasos do gateway
// reduzidos pelos gates (GATEWAY_FAST/SLOW_DELAY_MS, GATEWAY_POLL_MS).

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, createClient, SEED, endPool, query, pool } = require('./helpers');
const messages = require('../src/messages');
const { CANCEL_TEXTS } = require('../src/features/cancellation/texts');
const { getEventDashboard } = require('../src/features/checkin/dashboard');
const { listOnSaleEvents } = require('../src/features/events/repo');
const { eventFields, createEventHttp, publishEventHttp, eventFingerprint } = require('./support/events');
const { CARDS, DELAYS, sleep, signupParticipant, buy, ticketById, waitForStatus } = require('./f03-helpers');
const { login, postCheckin, getPanel, panelOf } = require('./helpers/f05-fixtures');
const h = require('./partner-api.helpers');

let app;
let A;
let B;
let P;

before(async () => {
  app = await startApp();
  A = await login(app.baseUrl, SEED.orgA);
  B = await login(app.baseUrl, SEED.orgB);
  P = await login(app.baseUrl, SEED.participant);
});
after(async () => {
  await app.close();
  await endPool();
});

/** Cria evento por A (HTTP) e publica (padrão) -> { id, name }. */
async function newEvent(org, { capacity = 5, price = '100,00', publish = true } = {}) {
  const name = `F06 ${Date.now()} ${Math.random().toString(36).slice(2, 7)}`;
  const created = await createEventHttp(org, { name, capacity: String(capacity), price });
  assert.equal(created.status, 302, 'criação do evento');
  if (publish) assert.equal((await publishEventHttp(org, created.id)).status, 302, 'publicação');
  return { id: created.id, name };
}

/** POST /org/events/:id/cancel -> { status, location, html }. */
async function cancel(client, eventId) {
  const res = await client.post(`/org/events/${eventId}/cancel`, {});
  return { status: res.status, location: res.headers.get('location'), html: await res.text() };
}

/** Compra pela API (HTTP) -> { ticketId, code, status }. */
async function apiBuy(eventId, card, email = 'f06@example.com') {
  const r = await h.partnerBuy(app.baseUrl, eventId, { card, email });
  assert.equal(r.status, 202, `compra pela API deveria ser aceita (${r.status} ${r.text})`);
  return r.body;
}

async function byStatus(eventId) {
  const { rows } = await query('SELECT status, count(*)::int AS n FROM tickets WHERE event_id = $1 GROUP BY status', [
    eventId,
  ]);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

async function ticketsFingerprint(eventId) {
  const { rows } = await query(
    "SELECT coalesce(md5(string_agg(t::text, ',' ORDER BY t.id)), 'vazio') AS h FROM tickets t WHERE event_id = $1",
    [eventId]
  );
  return rows[0].h;
}

/** Linha de tr.ticket do ingresso em "Meus ingressos". */
function ticketLine(html, code) {
  return html.split('\n').find((l) => l.includes(code)) || '';
}

describe('cancellation.test.js — F06', () => {
  test('F06-AC01 botão "Cancelar evento" com confirmação só em publicado; dono cancela -> cancelled + cancelled_at', async () => {
    const { id } = await newEvent(A, { publish: false });
    const draftPage = await (await A.get(`/org/events/${id}`)).text();
    assert.ok(!draftPage.includes(`action="/org/events/${id}/cancel"`), 'rascunho sem formulário de cancelar');

    assert.equal((await publishEventHttp(A, id)).status, 302);
    const page = await (await A.get(`/org/events/${id}`)).text();
    const forms = page.match(new RegExp(`<form[^>]*action="/org/events/${id}/cancel"[^>]*>`, 'g')) || [];
    assert.equal(forms.length, 1);
    assert.ok(forms[0].includes('method="post"'));
    assert.ok(forms[0].includes(`onsubmit="return confirm('${CANCEL_TEXTS.confirm}')"`));
    assert.ok(page.includes(CANCEL_TEXTS.button));

    const r = await cancel(A, id);
    assert.equal(r.status, 302);
    assert.equal(r.location, `/org/events/${id}`);
    const { rows } = await query('SELECT status, cancelled_at FROM events WHERE id = $1', [id]);
    assert.equal(rows[0].status, 'cancelled');
    assert.ok(rows[0].cancelled_at instanceof Date);

    const after = await (await A.get(`/org/events/${id}`)).text();
    assert.match(after, /Evento cancelado em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
  });

  test('F06-AC02 mesma transação: confirmed -> refunded, pending -> cancelled, declined intacto; nada pending/confirmed', async () => {
    const { id } = await newEvent(A, { capacity: 10 });
    const tc = await apiBuy(id, CARDS.approveFast, 'c@example.com');
    const tp = await apiBuy(id, CARDS.approveSlow, 'p@example.com');
    // Garante que o 0003 continua pendente até o cancelamento.
    await query("UPDATE tickets SET gateway_due_at = now() + interval '1 hour' WHERE id = $1", [tp.ticketId]);
    const td = await apiBuy(id, CARDS.declineFast, 'd@example.com');
    await waitForStatus(tc.ticketId, 'confirmed', 5000);
    await waitForStatus(td.ticketId, 'declined', 5000);
    assert.deepEqual(await byStatus(id), { confirmed: 1, pending: 1, declined: 1 });

    const r = await cancel(A, id);
    assert.equal(r.status, 302);
    assert.deepEqual(await byStatus(id), { refunded: 1, cancelled: 1, declined: 1 });
    const { rows } = await query(
      "SELECT count(*)::int AS n FROM tickets WHERE event_id = $1 AND status IN ('pending', 'confirmed')",
      [id]
    );
    assert.equal(rows[0].n, 0);
    // Os ingressos transitados ganham o mesmo updated_at da transação (now()).
    const t = await query(
      "SELECT DISTINCT t.updated_at = e.cancelled_at AS same FROM tickets t JOIN events e ON e.id = t.event_id WHERE t.event_id = $1 AND t.status IN ('refunded', 'cancelled')",
      [id]
    );
    assert.deepEqual(t.rows, [{ same: true }]);
  });

  test('F06-AC03 X-13 irreversível: sem formulários; edit/publish/cancel -> 409 sem alterar; fora de listOnSaleEvents; lista mostra cancelado', async () => {
    const { id, name } = await newEvent(A);
    await apiBuy(id, CARDS.approveFast);
    assert.equal((await cancel(A, id)).status, 302);
    const ev0 = await eventFingerprint(id);
    const tk0 = await ticketsFingerprint(id);

    const page = await (await A.get(`/org/events/${id}`)).text();
    for (const action of ['edit', 'publish', 'cancel']) {
      assert.ok(!page.includes(`action="/org/events/${id}/${action}"`), `sem formulário ${action}`);
    }

    const fields = eventFields({ name: 'Hack', capacity: '50', price: '1' });
    for (const action of ['edit', 'publish', 'cancel']) {
      const res = await A.post(`/org/events/${id}/${action}`, fields);
      assert.equal(res.status, 409, action);
      const html = await res.text();
      assert.ok(html.includes(CANCEL_TEXTS.cancelledReadOnly), `${action}: ${CANCEL_TEXTS.cancelledReadOnly}`);
      assert.ok(html.includes(`href="/org/events/${id}"`), 'link de volta');
    }
    const invalid = await A.post(`/org/events/${id}/edit`, { capacity: '0' });
    assert.equal(invalid.status, 409, 'estado (409) vem antes da validação (422)');

    assert.equal(await eventFingerprint(id), ev0);
    assert.equal(await ticketsFingerprint(id), tk0);
    assert.ok(!(await listOnSaleEvents(pool)).some((e) => e.id === id), 'fora de listOnSaleEvents');

    const list = await (await A.get('/org/events')).text();
    const line = list.split('</tr>').find((l) => l.includes(name)) || '';
    assert.ok(line.includes(messages.EVENT_STATUS_LABELS.cancelled), 'lista do dono mostra "cancelado"');
  });

  test('F06-AC04 X-14 some da vitrine (404), compra na vitrine rejeitada, "Meus ingressos" mostra estornado/cancelado', async () => {
    const { id, name } = await newEvent(A, { price: '30,00' });
    const p = await signupParticipant(app.baseUrl, 'Participante F06');
    assert.equal((await buy(p.client, id, CARDS.approveFast)).status, 303);
    assert.equal((await buy(p.client, id, CARDS.declineSlow)).status, 303);
    const { rows } = await query('SELECT id, code, card_last4 FROM tickets WHERE event_id = $1', [id]);
    const t1 = rows.find((r) => r.card_last4 === '0001');
    const t4 = rows.find((r) => r.card_last4 === '0004');
    await waitForStatus(t1.id, 'confirmed', 5000);
    assert.equal((await ticketById(t4.id)).status, 'pending');

    const before = await (await p.client.get('/me/tickets')).text();
    assert.ok(ticketLine(before, t1.code).includes(messages.TICKET_STATUS_LABELS.confirmed));
    assert.ok(ticketLine(before, t4.code).includes(messages.TICKET_STATUS_LABELS.pending));

    assert.equal((await cancel(A, id)).status, 302);

    assert.ok(!(await (await createClient(app.baseUrl).get('/')).text()).includes(name), 'fora da vitrine');
    assert.equal((await createClient(app.baseUrl).get(`/events/${id}`)).status, 404);
    assert.equal((await p.client.get(`/events/${id}`)).status, 404);
    const n0 = (await query('SELECT count(*)::int AS n FROM tickets WHERE event_id = $1', [id])).rows[0].n;
    const attempt = await buy(p.client, id, CARDS.approveFast);
    assert.ok(attempt.status >= 400, `compra rejeitada (${attempt.status})`);
    assert.equal((await query('SELECT count(*)::int AS n FROM tickets WHERE event_id = $1', [id])).rows[0].n, n0);

    const mine = await (await p.client.get('/me/tickets')).text();
    const l1 = ticketLine(mine, t1.code);
    const l4 = ticketLine(mine, t4.code);
    assert.ok(l1.includes(name) && l1.includes(messages.TICKET_STATUS_LABELS.refunded), l1);
    assert.ok(!l1.includes(`>${messages.TICKET_STATUS_LABELS.confirmed}<`), l1);
    assert.ok(l4.includes(messages.TICKET_STATUS_LABELS.cancelled), l4);
    assert.ok(!l4.includes(`>${messages.TICKET_STATUS_LABELS.pending}<`), l4);
  });

  test('F06-AC05 X-14 X-15 resposta tardia do gateway não muda cancelled; API: some da listagem, compra 404, consulta refunded/cancelled', async () => {
    const { id } = await newEvent(A, { price: '50,00' });
    const control = await newEvent(A, { price: '50,00' });
    const t0 = Date.now();
    const t5 = await apiBuy(id, CARDS.approveSlow, 't5@example.com'); // 0003: aprovação lenta
    const t7 = await apiBuy(id, CARDS.declineSlow, 't7@example.com'); // 0004: recusa lenta
    const ctl = await apiBuy(control.id, CARDS.approveSlow, 'ctl@example.com'); // controle, outro evento
    const t6 = await apiBuy(id, CARDS.approveFast, 't6@example.com');
    await waitForStatus(t6.ticketId, 'confirmed', 5000);
    assert.equal(await h.apiTicketStatus(app.baseUrl, t5.ticketId), 'pending');
    assert.ok(Date.now() - t0 < DELAYS.slow, 'cancelamento antes da resposta lenta do gateway');

    assert.equal((await cancel(A, id)).status, 302);
    const tCancel = Date.now();
    const statuses = async () => ({
      t5: await h.apiTicketStatus(app.baseUrl, t5.ticketId),
      t6: await h.apiTicketStatus(app.baseUrl, t6.ticketId),
      t7: await h.apiTicketStatus(app.baseUrl, t7.ticketId),
    });
    assert.deepEqual(await statuses(), { t5: 'cancelled', t6: 'refunded', t7: 'cancelled' });
    assert.ok(Date.now() - tCancel < 10000, 'X-15: em até 10 s');
    const snapshot = (await query('SELECT id, status, updated_at FROM tickets WHERE event_id = $1 ORDER BY id', [id])).rows;

    // X-15: some da listagem e compra -> 404 event_not_available.
    assert.equal(await h.listedEvent(app.baseUrl, id), undefined);
    const buyAfter = await h.partnerBuy(app.baseUrl, id, { card: CARDS.approveFast });
    assert.equal(buyAfter.status, 404);
    assert.equal(buyAfter.text, h.EVENT_NA_BODY);

    // Passa o vencimento do gateway: o controle (mesmo atraso, outro evento) é
    // resolvido, provando que o worker rodou; os cancelados não mudam.
    await waitForStatus(ctl.ticketId, 'confirmed', DELAYS.slow + 5000);
    await sleep(3 * DELAYS.poll + 100);
    // Força também o vencimento já passado nos cancelados e espera mais ciclos.
    await query("UPDATE tickets SET gateway_due_at = now() - interval '1 second' WHERE id IN ($1, $2)", [
      t5.ticketId,
      t7.ticketId,
    ]);
    await sleep(3 * DELAYS.poll + 100);
    const later = (await query('SELECT id, status, updated_at FROM tickets WHERE event_id = $1 ORDER BY id', [id])).rows;
    assert.deepEqual(later, snapshot, 'nem status nem updated_at mudaram');
    assert.deepEqual(await statuses(), { t5: 'cancelled', t6: 'refunded', t7: 'cancelled' });
    const api = await h.api(app.baseUrl, `/api/partner/tickets/${t5.ticketId}`);
    assert.deepEqual(api.body, { ticketId: t5.ticketId, code: t5.code, eventId: id, status: 'cancelled', checkedIn: false });
  });

  test('F06-AC06 rascunho não é cancelável: sem botão; POST -> 409 com a mensagem; linha intacta; publicar continua funcionando', async () => {
    const { id } = await newEvent(A, { publish: false });
    const page = await (await A.get(`/org/events/${id}`)).text();
    assert.ok(!page.includes(`/org/events/${id}/cancel`));
    const ev0 = await eventFingerprint(id);
    const r = await cancel(A, id);
    assert.equal(r.status, 409);
    assert.ok(r.html.includes(messages.ONLY_PUBLISHED_CAN_CANCEL));
    assert.equal(await eventFingerprint(id), ev0);
    const { rows } = await query('SELECT status, cancelled_at FROM events WHERE id = $1', [id]);
    assert.deepEqual(rows[0], { status: 'draft', cancelled_at: null });
    assert.equal((await publishEventHttp(A, id)).status, 302);
    assert.equal((await query('SELECT status FROM events WHERE id = $1', [id])).rows[0].status, 'published');
  });

  test('F06-AC07 X-12 B -> 404 idêntico a inexistente; participante -> 403; visitante -> login; nada muda', async () => {
    const { id, name } = await newEvent(A);
    const t = await apiBuy(id, CARDS.approveFast);
    await waitForStatus(t.ticketId, 'confirmed', 5000);
    const ev0 = await eventFingerprint(id);
    const tk0 = await ticketsFingerprint(id);

    const rb = await cancel(B, id);
    assert.equal(rb.status, 404);
    assert.ok(rb.html.includes(messages.EVENT_NOT_FOUND));
    for (const leak of [id, name, 'Sala de testes']) assert.ok(!rb.html.includes(leak), `B não vê ${leak}`);
    const rx = await cancel(B, 'evt_zzzzzzzzzz');
    assert.equal(rx.status, 404);
    assert.equal(rb.html, rx.html, 'corpo idêntico ao de evento inexistente');

    const rp = await cancel(P, id);
    assert.equal(rp.status, 403);
    assert.ok(!rp.html.includes(name));

    const rv = await cancel(createClient(app.baseUrl), id);
    assert.equal(rv.status, 302);
    assert.match(rv.location, /^\/login\?next=/);
    assert.ok(!rv.html.includes(name));

    assert.equal(await eventFingerprint(id), ev0);
    assert.equal(await ticketsFingerprint(id), tk0);
    const page = await (await A.get(`/org/events/${id}`)).text();
    assert.ok(page.includes(`action="/org/events/${id}/cancel"`), 'A ainda pode cancelar');

    // Ids inválidos e GET não cancelam nada.
    for (const bad of ['nao-existe', "1' OR '1'='1", 'evt_zzzzzzzzzz']) {
      assert.equal((await cancel(A, encodeURIComponent(bad))).status, 404, bad);
    }
    assert.equal((await A.get(`/org/events/${id}/cancel`)).status, 404);
    assert.equal(await eventFingerprint(id), ev0);
  });

  test('X-16 após cancelamento real: check-in -> Evento cancelado; painel 0/0/0/R$ 0,00 e Estornados = confirmados antes', async () => {
    const { id } = await newEvent(A, { price: '10,00' });
    const t81 = await apiBuy(id, CARDS.approveFast, 'c81@example.com');
    const t82 = await apiBuy(id, CARDS.approveFast, 'c82@example.com');
    const t83 = await apiBuy(id, CARDS.approveSlow, 'c83@example.com');
    await query("UPDATE tickets SET gateway_due_at = now() + interval '1 hour' WHERE id = $1", [t83.ticketId]);
    await waitForStatus(t81.ticketId, 'confirmed', 5000);
    await waitForStatus(t82.ticketId, 'confirmed', 5000);
    assert.equal((await postCheckin(A, id, t81.code)).result, 'entry_allowed');
    assert.deepEqual(
      await getPanel(A, id),
      panelOf({ confirmed: 2, pending: 1, checkins: 1, available: 2, revenue: 'R$ 20,00', refunded: 0 })
    );

    assert.equal((await cancel(A, id)).status, 302);
    const expected = panelOf({ confirmed: 0, pending: 0, checkins: 0, available: 5, revenue: 'R$ 0,00', refunded: 2 });
    assert.deepEqual(await getPanel(A, id), expected);
    assert.deepEqual(await getEventDashboard(pool, id), {
      confirmed: 0,
      pending: 0,
      checkIns: 0,
      available: 5,
      revenueCents: 0,
      refunded: 2,
    });

    for (const code of [t81.code, t82.code, t83.code]) {
      const r = await postCheckin(A, id, code);
      assert.equal(r.status, 200);
      assert.equal(r.result, 'event_cancelled', code);
      assert.equal(r.text, messages.CHECKIN.event_cancelled);
    }
    assert.equal((await postCheckin(A, id, 'ZZZZZZZZ')).result, 'invalid_ticket');
    assert.equal((await ticketById(t81.ticketId)).checked_in, true, 'histórico de check-in preservado');
    assert.deepEqual(await getPanel(A, id), expected);
  });
});
