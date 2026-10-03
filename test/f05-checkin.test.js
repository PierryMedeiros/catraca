'use strict';

// F05 — check-in (R10): F05-AC01..AC06, F05-AC10 e X-09 (F01 -> F05).

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startApp, SEED, endPool, pool } = require('./helpers');
const messages = require('../src/messages');
const { checkInTicket, normalizeCode, checkinMessage, CHECKIN_RESULTS } = require('../src/features/checkin/service');
const { newCode, createEvent, createTicket, ticketRow, login, postCheckin } = require('./helpers/f05-fixtures');

let app;
let A;
let P;

before(async () => {
  app = await startApp();
  A = await login(app.baseUrl, SEED.orgA);
  P = await login(app.baseUrl, SEED.participant);
});
after(async () => {
  await app.close();
  await endPool();
});

const RESULT_LINE = (key) => `<p id="checkin-result" data-result="${key}">${messages.CHECKIN[key]}</p>`;

async function checkedInCount(eventIds) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM tickets WHERE checked_in AND event_id = ANY($1)', [
    eventIds,
  ]);
  return rows[0].n;
}

describe('f05-checkin.test.js — check-in (R10)', () => {
  test('F05-AC01 gestão tem a seção Check-in com campo code; código normalizado (trim + maiúsculas)', async () => {
    const ev = await createEvent({ capacity: 5 });
    const page = await (await A.get(`/org/events/${ev}`)).text();
    assert.equal(page.split('<section id="checkin">').length - 1, 1);
    assert.ok(page.includes(`<form method="post" action="/org/events/${ev}/checkin">`));
    const input = page.match(/<input[^>]*name="code"[^>]*>/);
    assert.ok(input, 'campo code presente');
    assert.ok(!input[0].includes('disabled'));
    assert.ok(!page.includes('id="checkin-result"'), 'GET puro não tem resultado');
    assert.ok(!page.includes('id="checkin-code"'), 'GET puro não ecoa código');
    assert.ok(!page.includes('id="checkin-event-cancelled"'));

    const t = await createTicket({ eventId: ev, status: 'confirmed', code: newCode() });
    const r = await postCheckin(A, ev, `   ${t.code.toLowerCase()}  `);
    assert.equal(r.status, 200);
    assert.equal(r.result, CHECKIN_RESULTS.ENTRY_ALLOWED);
    assert.equal(r.echo, t.code);
    assert.ok(r.html.includes(RESULT_LINE('entry_allowed')));
    assert.equal(normalizeCode('  ab12cd34 '), 'AB12CD34');
    assert.equal(normalizeCode(undefined), '');
  });

  test('F05-AC02 código inexistente, de outro evento ou malformado -> Ingresso inválido para este evento', async () => {
    const ev = await createEvent();
    const k = await createTicket({ eventId: ev });
    const evOther = await createEvent();
    const kOther = await createTicket({ eventId: evOther });
    const evB = await createEvent({ owner: SEED.orgB });
    const kB = await createTicket({ eventId: evB });
    const inputs = [
      'ZZZZZZZZ',
      '',
      '   ',
      kOther.code,
      kB.code,
      "X' OR '1'='1",
      '%',
      'A'.repeat(65),
      k.code.slice(0, 7),
      `${k.code}9`,
      '<b>x</b>',
    ];
    for (const c of inputs) {
      const r = await postCheckin(A, ev, c);
      assert.equal(r.status, 200, `status de ${JSON.stringify(c)}`);
      assert.equal(r.result, 'invalid_ticket', `resultado de ${JSON.stringify(c)}`);
      assert.ok(r.html.includes(RESULT_LINE('invalid_ticket')));
    }
    const missing = await postCheckin(A, ev, undefined);
    assert.equal(missing.status, 200);
    assert.equal(missing.result, 'invalid_ticket');
    assert.equal(await checkedInCount([ev, evOther, evB]), 0, 'nenhum check-in gravado');

    // Linha 1 antes da 2: evento cancelado não muda o resultado de código de outro evento.
    const evC = await createEvent({ status: 'cancelled' });
    await createTicket({ eventId: evC });
    for (const c of ['ZZZZZZZZ', kOther.code, kB.code, k.code, '']) {
      const r = await postCheckin(A, evC, c);
      assert.equal(r.status, 200);
      assert.equal(r.result, 'invalid_ticket', `evento cancelado + ${JSON.stringify(c)}`);
    }
    assert.equal(await checkedInCount([ev, evOther, evB, evC]), 0);
  });

  test('F05-AC03 evento cancelado + código do evento (qualquer status) -> Evento cancelado', async () => {
    const ev = await createEvent({ status: 'cancelled', capacity: 10 });
    const tickets = [];
    for (const [status, checkedIn] of [
      ['confirmed', false],
      ['pending', false],
      ['refunded', false],
      ['confirmed', true],
      ['declined', false],
      ['cancelled', false],
    ]) {
      tickets.push({ ...(await createTicket({ eventId: ev, status, checkedIn })), checkedIn });
    }
    for (const t of tickets) {
      const r = await postCheckin(A, ev, t.code);
      assert.equal(r.status, 200);
      assert.equal(r.result, 'event_cancelled');
      assert.ok(r.html.includes(RESULT_LINE('event_cancelled')));
    }
    for (const t of tickets) {
      assert.equal((await ticketRow(t.id)).checked_in, t.checkedIn, 'checked_in inalterado');
    }
  });

  test('F05-AC04 ingresso pending, declined, cancelled ou refunded de evento publicado -> Ingresso não confirmado', async () => {
    const ev = await createEvent({ capacity: 10 });
    for (const status of ['pending', 'declined', 'cancelled', 'refunded']) {
      const t = await createTicket({ eventId: ev, status });
      const r = await postCheckin(A, ev, t.code);
      assert.equal(r.status, 200);
      assert.equal(r.result, 'not_confirmed', status);
      assert.ok(r.html.includes(RESULT_LINE('not_confirmed')));
      const row = await ticketRow(t.id);
      assert.equal(row.checked_in, false);
      assert.equal(row.status, status);
    }
  });

  test('F05-AC05 ingresso confirmado já com check-in -> Ingresso já utilizado, sem regravar', async () => {
    const ev = await createEvent();
    const t = await createTicket({ eventId: ev, status: 'confirmed', checkedIn: true });
    const before1 = (await ticketRow(t.id)).checked_in_at;
    const r = await postCheckin(A, ev, t.code);
    assert.equal(r.status, 200);
    assert.equal(r.result, 'already_used');
    assert.ok(r.html.includes(RESULT_LINE('already_used')));
    assert.deepEqual((await ticketRow(t.id)).checked_in_at, before1);
  });

  test('F05-AC06 confirmado sem check-in -> Entrada liberada uma única vez; checked_in_at preenchido', async () => {
    const ev = await createEvent({ capacity: 10 });
    const t = await createTicket({ eventId: ev, status: 'confirmed' });
    const r1 = await postCheckin(A, ev, t.code);
    assert.equal(r1.status, 200);
    assert.equal(r1.result, 'entry_allowed');
    const row1 = await ticketRow(t.id);
    assert.equal(row1.checked_in, true);
    assert.ok(row1.checked_in_at instanceof Date);
    assert.equal(row1.status, 'confirmed');
    assert.equal(r1.metrics.checkins, '1', 'painel da resposta já reflete o check-in');

    const r2 = await postCheckin(A, ev, t.code);
    assert.equal(r2.result, 'already_used');
    const r3 = await postCheckin(A, ev, ` ${t.code.toLowerCase()}`);
    assert.equal(r3.result, 'already_used');
    assert.deepEqual((await ticketRow(t.id)).checked_in_at, row1.checked_in_at);
  });

  test('F05-AC06 submissões simultâneas do mesmo código: exatamente uma Entrada liberada (10 rodadas)', async () => {
    for (const n of [2, 2, 2, 2, 2, 10, 10, 10, 10, 10]) {
      const ev = await createEvent();
      const t = await createTicket({ eventId: ev, status: 'confirmed' });
      const results = await Promise.all(Array.from({ length: n }, () => postCheckin(A, ev, t.code)));
      assert.deepEqual(
        results.map((r) => r.status),
        Array(n).fill(200)
      );
      const allowed = results.filter((r) => r.result === 'entry_allowed').length;
      const used = results.filter((r) => r.result === 'already_used').length;
      assert.equal(allowed, 1, `n=${n}: uma única entrada liberada`);
      assert.equal(used, n - 1, `n=${n}: o resto já utilizado`);
      assert.equal(await checkedInCount([ev]), 1);
    }
  });

  test('F05-AC06 check-in concorrente com cancelamento: o UPDATE condicional perde e devolve Evento cancelado', async () => {
    const ev = await createEvent();
    const t = await createTicket({ eventId: ev, status: 'confirmed' });
    const canceller = await pool.connect();
    const checker = await pool.connect();
    try {
      await canceller.query('BEGIN');
      await canceller.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [ev]);
      await canceller.query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [ev]);
      await canceller.query("UPDATE tickets SET status = 'refunded', updated_at = now() WHERE id = $1", [t.id]);

      await checker.query('BEGIN');
      const pending = checkInTicket(checker, { eventId: ev, code: t.code }); // bloqueia no UPDATE
      await new Promise((resolve) => setTimeout(resolve, 150));
      await canceller.query('COMMIT');
      const result = await pending;
      await checker.query('COMMIT');
      assert.equal(result, CHECKIN_RESULTS.EVENT_CANCELLED);
      const row = await ticketRow(t.id);
      assert.equal(row.checked_in, false);
      assert.equal(row.status, 'refunded');
    } finally {
      canceller.release();
      checker.release();
    }
  });

  test('F05-AC10 evento cancelado: aviso Evento cancelado acima do campo, que continua ativo', async () => {
    const ev = await createEvent({ status: 'cancelled' });
    const res = await A.get(`/org/events/${ev}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    const notice = `<p id="checkin-event-cancelled">${messages.CHECKIN.event_cancelled}</p>`;
    assert.equal(html.split(notice).length - 1, 1);
    const section = html.slice(html.indexOf('<section id="checkin">'));
    const iNotice = section.indexOf(notice);
    const iForm = section.indexOf(`<form method="post" action="/org/events/${ev}/checkin">`);
    assert.ok(iNotice > 0 && iForm > iNotice, 'aviso antes do formulário, dentro da seção');
    const input = html.match(/<input[^>]*name="code"[^>]*>/);
    assert.ok(input && !input[0].includes('disabled'));
    assert.ok(html.includes('<section id="painel">'));

    // O campo segue a tabela de R10: código do evento -> Evento cancelado.
    const t = await createTicket({ eventId: ev, status: 'confirmed' });
    const r = await postCheckin(A, ev, t.code);
    assert.equal(r.result, 'event_cancelled');
    assert.ok(r.html.includes(notice));
  });

  test('X-09 mensagens do check-in são as de messages.js (literal); participante recebe 403', async () => {
    for (const key of Object.values(CHECKIN_RESULTS)) {
      assert.equal(checkinMessage(key), messages.CHECKIN[key]);
    }
    assert.deepEqual(messages.CHECKIN, {
      invalid_ticket: 'Ingresso inválido para este evento',
      event_cancelled: 'Evento cancelado',
      not_confirmed: 'Ingresso não confirmado',
      already_used: 'Ingresso já utilizado',
      entry_allowed: 'Entrada liberada',
    });

    // Cada resultado observado por HTTP traz o texto idêntico ao de messages.js.
    const ev = await createEvent({ capacity: 10 });
    const ok = await createTicket({ eventId: ev, status: 'confirmed' });
    const pend = await createTicket({ eventId: ev, status: 'pending' });
    const evC = await createEvent({ status: 'cancelled' });
    const canc = await createTicket({ eventId: evC, status: 'confirmed' });
    const seen = [
      await postCheckin(A, ev, 'ZZZZZZZZ'),
      await postCheckin(A, evC, canc.code),
      await postCheckin(A, ev, pend.code),
      await postCheckin(A, ev, ok.code),
      await postCheckin(A, ev, ok.code),
    ];
    assert.deepEqual(
      seen.map((r) => r.result),
      ['invalid_ticket', 'event_cancelled', 'not_confirmed', 'entry_allowed', 'already_used']
    );
    for (const r of seen) assert.equal(r.text, messages.CHECKIN[r.result]);

    // Eco do código sempre escapado.
    const xss = await postCheckin(A, ev, '<b>x</b>');
    assert.ok(xss.html.includes('<p id="checkin-code">Código informado: &lt;B&gt;X&lt;/B&gt;</p>'));
    assert.ok(!xss.html.includes('<B>X</B>'));

    // Nenhum arquivo de F05 tem os textos literais: são importados.
    const dir = path.join(__dirname, '..', 'src', 'features', 'checkin');
    for (const file of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const text of Object.values(messages.CHECKIN)) {
        assert.ok(!src.includes(text), `${file} não pode conter "${text}"`);
      }
    }

    // Participante não faz check-in (guarda de F01).
    const t = await createTicket({ eventId: ev, status: 'confirmed' });
    const res = await P.post(`/org/events/${ev}/checkin`, { code: t.code });
    assert.equal(res.status, 403);
    const body = await res.text();
    assert.ok(!body.includes('data-result') && !body.includes(ev));
    assert.equal((await ticketRow(t.id)).checked_in, false);
  });
});
