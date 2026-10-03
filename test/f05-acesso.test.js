'use strict';

// F05 — acesso (R13): F05-AC09 e X-10 (F02 -> F05).

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, createClient, SEED, endPool } = require('./helpers');
const { createEvent, createTicket, ticketRow, login, postCheckin } = require('./helpers/f05-fixtures');

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

const LEAKS = (ev, code) => [ev, 'Local F05', code, 'id="painel"', 'data-metric', 'id="checkin', 'data-result'];

function assertNoLeak(body, ev, code) {
  for (const needle of LEAKS(ev, code)) assert.ok(!body.includes(needle), `corpo não pode conter ${needle}`);
}

describe('f05-acesso.test.js — acesso ao check-in e ao painel (R13)', () => {
  test('F05-AC09 organizador B: 404 idêntico ao de evento inexistente e nenhum check-in gravado', async () => {
    const ev = await createEvent({ owner: SEED.orgA });
    const t = await createTicket({ eventId: ev, status: 'confirmed' });

    const post = await B.post(`/org/events/${ev}/checkin`, { code: t.code });
    const postBody = await post.text();
    const none = await B.post('/org/events/evt_zzzzzzzzzz/checkin', { code: t.code });
    const noneBody = await none.text();
    const bad = await B.post(`/org/events/${encodeURIComponent("nao-existe' OR 1=1")}/checkin`, { code: t.code });
    assert.equal(post.status, 404);
    assert.equal(none.status, 404);
    assert.equal(bad.status, 404);
    assert.equal(postBody, noneBody, 'corpo idêntico ao de id inexistente');
    assert.ok(postBody.includes('Evento não encontrado'));
    assertNoLeak(postBody, ev, t.code);
    assert.equal((await ticketRow(t.id)).checked_in, false);

    // Controle: o dono consegue (o código era válido; só a autoria impediu).
    const own = await postCheckin(A, ev, t.code);
    assert.equal(own.status, 200);
    assert.equal(own.result, 'entry_allowed');
  });

  test('F05-AC09 participante recebe 403 e visitante vai ao login, sem dados e sem escrita', async () => {
    const ev = await createEvent();
    const t = await createTicket({ eventId: ev, status: 'confirmed' });

    const pGet = await P.get(`/org/events/${ev}`);
    const pPost = await P.post(`/org/events/${ev}/checkin`, { code: t.code });
    assert.equal(pGet.status, 403);
    assert.equal(pPost.status, 403);
    assertNoLeak((await pGet.text()) + (await pPost.text()), ev, t.code);

    const v = createClient(app.baseUrl);
    const vPost = await v.post(`/org/events/${ev}/checkin`, { code: t.code });
    assert.equal(vPost.status, 302);
    assert.equal(vPost.headers.get('location'), `/login?next=${encodeURIComponent(`/org/events/${ev}/checkin`)}`);
    const vGet = await v.get(`/org/events/${ev}`);
    assert.equal(vGet.status, 302);
    assert.match(vGet.headers.get('location'), /^\/login\?next=/);
    assert.equal((await ticketRow(t.id)).checked_in, false);

    // Depois do login, o next do POST leva de volta à gestão do evento.
    const back = await A.get(`/org/events/${ev}/checkin`);
    assert.equal(back.status, 302);
    assert.equal(back.headers.get('location'), `/org/events/${ev}`);
  });

  test('X-10 check-in e painel aparecem na gestão de F02 só para o dono; B não vê painel (404)', async () => {
    const ev = await createEvent({ owner: SEED.orgA });
    const t = await createTicket({ eventId: ev, status: 'confirmed' });

    const own = await A.get(`/org/events/${ev}`);
    assert.equal(own.status, 200);
    const html = await own.text();
    assert.ok(html.includes('<section data-section="dados">'), 'página de gestão de F02');
    const iDados = html.indexOf('data-section="dados"');
    const iCheckin = html.indexOf('<section id="checkin">');
    const iPainel = html.indexOf('<section id="painel">');
    assert.ok(iDados > 0 && iCheckin > iDados && iPainel > iCheckin, 'seções depois das de F02, nesta ordem');

    const other = await B.get(`/org/events/${ev}`);
    assert.equal(other.status, 404);
    assertNoLeak(await other.text(), ev, t.code);

    // Evento de B também é 404 para A (ownership nos dois sentidos).
    const evB = await createEvent({ owner: SEED.orgB });
    const tB = await createTicket({ eventId: evB, status: 'confirmed' });
    const aOnB = await A.post(`/org/events/${evB}/checkin`, { code: tB.code });
    assert.equal(aOnB.status, 404);
    assert.equal((await ticketRow(tB.id)).checked_in, false);
  });
});
