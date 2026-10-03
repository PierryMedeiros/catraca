'use strict';

// F05 — painel do evento (R12): F05-AC07 e F05-AC08.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, SEED, endPool, pool } = require('./helpers');
const { formatBRL } = require('../src/format');
const { getEventDashboard } = require('../src/features/checkin/dashboard');
const { renderDashboardSection } = require('../src/features/checkin/views');
const { createEvent, createTicket, login, postCheckin, getPanel, panelOf } = require('./helpers/f05-fixtures');

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

/** Consulta de referência independente da implementação (R12 + R05). */
async function referencePanel(eventId) {
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE t.status = 'confirmed')::int AS confirmed,
            count(*) FILTER (WHERE t.status = 'pending')::int AS pending,
            count(*) FILTER (WHERE t.status = 'confirmed' AND t.checked_in)::int AS checkins,
            (e.capacity - count(*) FILTER (WHERE t.status IN ('pending', 'confirmed')))::int AS available,
            COALESCE(sum(t.price_cents) FILTER (WHERE t.status = 'confirmed'), 0)::int AS revenue_cents,
            count(*) FILTER (WHERE t.status = 'refunded')::int AS refunded
       FROM events e LEFT JOIN tickets t ON t.event_id = e.id
      WHERE e.id = $1
      GROUP BY e.capacity`,
    [eventId]
  );
  const r = rows[0];
  return panelOf({ ...r, revenue: formatBRL(r.revenue_cents) });
}

describe('f05-painel.test.js — painel (R12)', () => {
  test('F05-AC07 painel com ingressos em todos os status confere com SQL e com getEventDashboard', async () => {
    const ev = await createEvent({ capacity: 10, priceCents: 10000 });
    await createTicket({ eventId: ev, status: 'confirmed', priceCents: 10000, checkedIn: true });
    const c2 = await createTicket({ eventId: ev, status: 'confirmed', priceCents: 10000 });
    await createTicket({ eventId: ev, status: 'confirmed', priceCents: 15000 });
    await createTicket({ eventId: ev, status: 'pending', priceCents: 15000 });
    await createTicket({ eventId: ev, status: 'pending', priceCents: 10000 });
    await createTicket({ eventId: ev, status: 'declined', priceCents: 10000 });
    await createTicket({ eventId: ev, status: 'cancelled', priceCents: 10000 });
    await createTicket({ eventId: ev, status: 'refunded', priceCents: 10000, checkedIn: true });
    await createTicket({ eventId: ev, status: 'refunded', priceCents: 15000 });
    // Outro evento do mesmo organizador: não pode entrar em nenhum número.
    const other = await createEvent({ capacity: 3, priceCents: 99900 });
    await createTicket({ eventId: other, status: 'confirmed', priceCents: 99900, checkedIn: true });

    const expected = panelOf({ confirmed: 3, pending: 2, checkins: 1, available: 5, revenue: 'R$ 350,00', refunded: 2 });
    assert.deepEqual(await referencePanel(ev), expected);
    assert.deepEqual(await getPanel(A, ev), expected);
    assert.deepEqual(await getEventDashboard(pool, ev), {
      confirmed: 3,
      pending: 2,
      checkIns: 1,
      available: 5,
      revenueCents: 35000,
      refunded: 2,
    });

    const r = await postCheckin(A, ev, c2.code);
    assert.equal(r.result, 'entry_allowed');
    const after1 = panelOf({ confirmed: 3, pending: 2, checkins: 2, available: 5, revenue: 'R$ 350,00', refunded: 2 });
    assert.deepEqual(r.metrics, after1, 'painel na resposta do POST');
    assert.deepEqual(await referencePanel(ev), after1);
    assert.deepEqual(await getPanel(A, ev), after1);

    // Marcação: seis pares dt/dd em linha única, na ordem fixada.
    const html = await (await A.get(`/org/events/${ev}`)).text();
    const lines = html.match(/<dt>[^<]*<\/dt><dd data-metric="[a-z]+">[^<]*<\/dd>/g);
    assert.deepEqual(lines, [
      '<dt>Confirmados</dt><dd data-metric="confirmed">3</dd>',
      '<dt>Pendentes</dt><dd data-metric="pending">2</dd>',
      '<dt>Check-ins</dt><dd data-metric="checkins">2</dd>',
      '<dt>Vagas disponíveis</dt><dd data-metric="available">5</dd>',
      '<dt>Receita</dt><dd data-metric="revenue">R$ 350,00</dd>',
      '<dt>Estornados</dt><dd data-metric="refunded">2</dd>',
    ]);
    assert.ok(html.indexOf('<section id="checkin">') < html.indexOf('<section id="painel">'));
  });

  test('F05-AC07 evento sem vendas: zeros e Vagas = lotação; números são inteiros', async () => {
    const ev = await createEvent({ capacity: 4 });
    assert.deepEqual(
      await getPanel(A, ev),
      panelOf({ confirmed: 0, pending: 0, checkins: 0, available: 4, revenue: 'R$ 0,00', refunded: 0 })
    );
    const d = await getEventDashboard(pool, ev);
    for (const v of Object.values(d)) assert.equal(typeof v, 'number');
    assert.deepEqual(Object.keys(d), ['confirmed', 'pending', 'checkIns', 'available', 'revenueCents', 'refunded']);
  });

  test('F05-AC08 Receita soma o preço de cada ingresso confirmado, formatada R$ com espaço comum', async () => {
    // 100 + 100 + 150 = R$ 350,00 mesmo com o preço atual do evento diferente.
    const ev = await createEvent({ capacity: 6, priceCents: 77700 });
    for (const cents of [10000, 10000, 15000]) await createTicket({ eventId: ev, status: 'confirmed', priceCents: cents });
    await createTicket({ eventId: ev, status: 'pending', priceCents: 50000 });
    await createTicket({ eventId: ev, status: 'declined', priceCents: 70000 });
    await createTicket({ eventId: ev, status: 'refunded', priceCents: 80000 });
    await createTicket({ eventId: ev, status: 'cancelled', priceCents: 60000 });
    const p = await getPanel(A, ev);
    assert.equal(p.revenue, 'R$ 350,00');
    assert.equal(Buffer.from(p.revenue)[2], 0x20, 'espaço ASCII entre R$ e o número');

    const evR = await createEvent({ capacity: 6, priceCents: 77700 });
    await createTicket({ eventId: evR, status: 'confirmed', priceCents: 100000 });
    await createTicket({ eventId: evR, status: 'confirmed', priceCents: 23456 });
    await createTicket({ eventId: evR, status: 'pending', priceCents: 50000 });
    await createTicket({ eventId: evR, status: 'declined', priceCents: 70000 });
    await createTicket({ eventId: evR, status: 'refunded', priceCents: 80000 });
    await createTicket({ eventId: evR, status: 'cancelled', priceCents: 60000 });
    assert.deepEqual(
      await getPanel(A, evR),
      panelOf({ confirmed: 2, pending: 1, checkins: 0, available: 3, revenue: 'R$ 1.234,56', refunded: 1 })
    );
    const html = await (await A.get(`/org/events/${evR}`)).text();
    assert.ok(html.includes('<dd data-metric="revenue">R$ 1.234,56</dd>'));

    // Mudar o preço do evento não altera a Receita (preço de cada compra, R03).
    await pool.query('UPDATE events SET price_cents = 1000 WHERE id = $1', [evR]);
    assert.equal((await getPanel(A, evR)).revenue, 'R$ 1.234,56');

    const ev0 = await createEvent({ capacity: 3, priceCents: 5000 });
    await createTicket({ eventId: ev0, status: 'refunded', priceCents: 5000 });
    await createTicket({ eventId: ev0, status: 'pending', priceCents: 5000 });
    assert.equal((await getPanel(A, ev0)).revenue, 'R$ 0,00');

    assert.ok(
      renderDashboardSection({ confirmed: 3, pending: 0, checkIns: 0, available: 0, revenueCents: 35000, refunded: 0 }).includes(
        '<dd data-metric="revenue">R$ 350,00</dd>'
      )
    );
  });
});
