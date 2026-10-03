'use strict';

// F02 — repositório e serviço contra o banco de teste (F02-AC08, F02-AC10, trava).

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, SEED, query, pool, endPool } = require('./helpers');
const { withTransaction } = require('../src/db');
const repo = require('../src/features/events/repo');
const service = require('../src/features/events/service');
const { EVENT_TEXTS } = require('../src/features/events/texts');
const { userIdByEmail, eventFingerprint, localDateTime } = require('./support/events');

let app;
let orgA;
let orgB;
before(async () => {
  app = await startApp(); // migrações + seed
  orgA = await userIdByEmail(SEED.orgA);
  orgB = await userIdByEmail(SEED.orgB);
});
after(async () => {
  await app.close();
  await endPool();
});

const input = (over = {}) => ({
  name: 'Evento repo',
  startsAt: localDateTime(30 * 24 * 60, { seconds: false }),
  venue: 'Sala repo',
  capacity: '5',
  price: '100,00',
  ...over,
});

async function newEvent(over = {}, organizerId = orgA) {
  const r = await withTransaction((c) => service.createEvent(c, { organizerId, input: input(over) }));
  assert.equal(r.ok, true);
  return r.event;
}

describe('events-repo.test.js — F02 repositório e serviço', () => {
  test('F02-AC01: createEvent grava rascunho com id evt_ e organizer_id do dono', async () => {
    const e = await newEvent({ name: 'Criado no serviço' });
    assert.match(e.id, /^evt_[a-z0-9]{10}$/);
    assert.equal(e.status, 'draft');
    assert.equal(e.organizer_id, orgA);
    assert.equal(e.capacity, 5);
    assert.equal(e.price_cents, 10000);
    assert.equal(e.cancelled_at, null);
    const bad = await withTransaction((c) => service.createEvent(c, { organizerId: orgA, input: input({ capacity: '0' }) }));
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'invalid');
  });

  test('F02-AC01: esquema de events e restrições do banco', async () => {
    const { rows } = await query(
      `SELECT column_name || ':' || data_type AS c FROM information_schema.columns
        WHERE table_name = 'events' ORDER BY column_name`
    );
    assert.deepEqual(rows.map((r) => r.c), [
      'cancelled_at:timestamp with time zone',
      'capacity:integer',
      'created_at:timestamp with time zone',
      'id:text',
      'name:text',
      'organizer_id:text',
      'price_cents:integer',
      'starts_at:timestamp with time zone',
      'status:text',
      'updated_at:timestamp with time zone',
      'venue:text',
    ]);
    const { rows: mig } = await query("SELECT version FROM schema_migrations WHERE version = '002_events.sql'");
    assert.equal(mig.length, 1);
    const ins = (id, capacity, price, status) =>
      query(
        `INSERT INTO events (id, organizer_id, name, starts_at, venue, capacity, price_cents, status)
         VALUES ($1, $2, 'x', now() + interval '1 day', 'y', $3, $4, $5)`,
        [id, orgA, capacity, price, status]
      );
    await assert.rejects(ins('evt_c01aaaaaaa', 0, 100, 'draft'), { code: '23514' });
    await assert.rejects(ins('evt_c01aaaaaaa', 1, 0, 'draft'), { code: '23514' });
    await assert.rejects(ins('evt_c01aaaaaaa', 1, 100, 'x'), { code: '23514' });
    await assert.rejects(ins('abc', 1, 100, 'draft'), { code: '23514' });
    await assert.rejects(
      query(
        `INSERT INTO events (id, organizer_id, name, starts_at, venue, capacity, price_cents)
         VALUES ('evt_c01bbbbbbb', 'usr_naoexiste', 'x', now(), 'y', 1, 1)`
      ),
      { code: '23503' }
    );
  });

  test('F02-AC08: getSeatStats sem vendas e com tabela tickets (pending+confirmed)', async () => {
    const e = await newEvent({ capacity: '5' });
    assert.deepEqual(await repo.getSeatStats(pool, e.id), { capacity: 5, occupied: 0, available: 5 });
    assert.equal(await repo.getSeatStats(pool, 'evt_zzzzzzzzzz'), null);

    const before1 = await eventFingerprint(e.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE TEMP TABLE tickets (event_id text, status text) ON COMMIT DROP');
      await client.query(
        `INSERT INTO tickets VALUES ($1,'pending'),($1,'confirmed'),($1,'declined'),($1,'cancelled'),($1,'refunded'),
         ('evt_outroevent','confirmed')`,
        [e.id]
      );
      const stats = await repo.getSeatStats(client, e.id);
      assert.deepEqual(stats, { capacity: 5, occupied: 2, available: 3 });
      assert.deepEqual(Object.keys(stats), ['capacity', 'occupied', 'available']);

      const r1 = await service.updateEvent(client, { eventId: e.id, organizerId: orgA, input: input({ capacity: '1' }) });
      assert.equal(r1.ok, false);
      assert.equal(r1.reason, 'invalid');
      assert.equal(r1.errors.capacity, 'A lotação não pode ser menor que as vagas ocupadas (2)');
      assert.equal(r1.values.capacity, '1');
      assert.equal((await client.query('SELECT capacity FROM events WHERE id = $1', [e.id])).rows[0].capacity, 5);

      const r2 = await service.updateEvent(client, { eventId: e.id, organizerId: orgA, input: input({ capacity: '2' }) });
      assert.equal(r2.ok, true);
      assert.equal(r2.event.capacity, 2);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    assert.equal(await eventFingerprint(e.id), before1);
  });

  test('F02-AC07: updateEvent aplica validações, ownership e guarda de cancelado', async () => {
    const e = await newEvent();
    const fp = await eventFingerprint(e.id);
    const past = await withTransaction((c) =>
      service.updateEvent(c, { eventId: e.id, organizerId: orgA, input: input({ startsAt: localDateTime(-1) }) })
    );
    assert.equal(past.reason, 'invalid');
    assert.equal(past.errors.startsAt, EVENT_TEXTS.STARTS_AT_PAST);
    const notMine = await withTransaction((c) =>
      service.updateEvent(c, { eventId: e.id, organizerId: orgB, input: input() })
    );
    assert.deepEqual(notMine, { ok: false, reason: 'not_found' });
    const missing = await withTransaction((c) =>
      service.updateEvent(c, { eventId: 'evt_zzzzzzzzzz', organizerId: orgA, input: input() })
    );
    assert.deepEqual(missing, { ok: false, reason: 'not_found' });
    assert.equal(await eventFingerprint(e.id), fp);

    const ok = await withTransaction((c) =>
      service.updateEvent(c, { eventId: e.id, organizerId: orgA, input: input({ name: 'Renomeado', price: '150' }) })
    );
    assert.equal(ok.ok, true);
    assert.equal(ok.event.name, 'Renomeado');
    assert.equal(ok.event.price_cents, 15000);

    await query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [e.id]);
    const fp2 = await eventFingerprint(e.id);
    const upd = await withTransaction((c) => service.updateEvent(c, { eventId: e.id, organizerId: orgA, input: input() }));
    assert.deepEqual(upd, { ok: false, reason: 'cancelled' });
    const pub = await withTransaction((c) => service.publishEvent(c, { eventId: e.id, organizerId: orgA }));
    assert.deepEqual(pub, { ok: false, reason: 'cancelled' });
    assert.equal(await eventFingerprint(e.id), fp2);
  });

  test('F02-AC06: publishEvent muda draft -> published uma vez só', async () => {
    const e = await newEvent();
    const r1 = await withTransaction((c) => service.publishEvent(c, { eventId: e.id, organizerId: orgA }));
    assert.deepEqual(r1, { ok: true, changed: true });
    const fp = await eventFingerprint(e.id);
    const r2 = await withTransaction((c) => service.publishEvent(c, { eventId: e.id, organizerId: orgA }));
    assert.deepEqual(r2, { ok: true, changed: false });
    assert.equal(await eventFingerprint(e.id), fp);
    const r3 = await withTransaction((c) => service.publishEvent(c, { eventId: e.id, organizerId: orgB }));
    assert.deepEqual(r3, { ok: false, reason: 'not_found' });
  });

  async function expectWaitsForLock(fn) {
    const e = await newEvent({ capacity: '2' });
    const holder = await pool.connect();
    const waiter = await pool.connect();
    try {
      await holder.query('BEGIN');
      const locked = await repo.lockEvent(holder, e.id);
      assert.equal(locked.id, e.id);

      await waiter.query('BEGIN');
      await waiter.query("SET LOCAL lock_timeout = '300ms'");
      await assert.rejects(fn(waiter, e.id), { code: '55P03' });
      await waiter.query('ROLLBACK');

      await holder.query('COMMIT');
      await waiter.query('BEGIN');
      await waiter.query("SET LOCAL lock_timeout = '300ms'");
      const r = await fn(waiter, e.id);
      assert.equal(r.ok, true);
      await waiter.query('COMMIT');
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      await waiter.query('ROLLBACK').catch(() => {});
      holder.release();
      waiter.release();
    }
    return e.id;
  }

  test('F02-AC08: updateEvent começa pela trava do evento (espera FOR UPDATE)', async () => {
    const id = await expectWaitsForLock((c, eventId) =>
      service.updateEvent(c, { eventId, organizerId: orgA, input: input({ capacity: '4' }) })
    );
    assert.equal((await query('SELECT capacity FROM events WHERE id = $1', [id])).rows[0].capacity, 4);
  });

  test('F02-AC06: publishEvent também espera a trava do evento', async () => {
    const id = await expectWaitsForLock((c, eventId) => service.publishEvent(c, { eventId, organizerId: orgA }));
    assert.equal((await query('SELECT status FROM events WHERE id = $1', [id])).rows[0].status, 'published');
  });

  test('F02-AC10: listOnSaleEvents / getOnSaleEvent só retornam publicados, por início', async () => {
    const mk = async (status, days) => {
      const e = await newEvent({ name: `C17 ${status} ${days}`, startsAt: localDateTime(days * 24 * 60, { seconds: false }) });
      if (status !== 'draft') {
        await query(
          `UPDATE events SET status = $2::text, cancelled_at = CASE WHEN $2::text = 'cancelled' THEN now() END WHERE id = $1`,
          [e.id, status]
        );
      }
      return e.id;
    };
    const ids = {
      draft: await mk('draft', 10),
      pubTarde: await mk('published', 20),
      pubCedo: await mk('published', 5),
      cancelled: await mk('cancelled', 1),
    };
    const list = await repo.listOnSaleEvents(pool);
    const ours = list.filter((e) => Object.values(ids).includes(e.id)).map((e) => e.id);
    assert.deepEqual(ours, [ids.pubCedo, ids.pubTarde]);
    assert.ok(list.every((e) => e.status === 'published'));
    for (let k = 1; k < list.length; k++) {
      assert.ok(list[k - 1].starts_at.getTime() <= list[k].starts_at.getTime(), 'ordenado por starts_at');
    }
    assert.equal((await repo.getOnSaleEvent(pool, ids.pubCedo)).id, ids.pubCedo);
    assert.equal(await repo.getOnSaleEvent(pool, ids.draft), null);
    assert.equal(await repo.getOnSaleEvent(pool, ids.cancelled), null);
    assert.equal(await repo.getOnSaleEvent(pool, 'evt_zzzzzzzzzz'), null);
  });

  test('F02-AC04/AC09: getEventForOrganizer e listEventsForOrganizer respeitam o dono', async () => {
    const a = await newEvent({ name: 'Dono A' });
    const b = await newEvent({ name: 'Dono B' }, orgB);
    assert.equal((await repo.getEventForOrganizer(pool, a.id, orgA)).id, a.id);
    assert.equal(await repo.getEventForOrganizer(pool, a.id, orgB), null);
    assert.equal(await repo.getEventForOrganizer(pool, 'evt_zzzzzzzzzz', orgA), null);
    assert.equal(await repo.getEventForOrganizer(pool, "evt_x' OR '1'='1", orgA), null);
    const listA = await repo.listEventsForOrganizer(pool, orgA);
    assert.ok(listA.some((e) => e.id === a.id));
    assert.ok(listA.every((e) => e.organizer_id === orgA));
    assert.ok(!listA.some((e) => e.id === b.id));
    const locked = await withTransaction((c) => repo.lockEvent(c, a.id));
    assert.equal(locked.id, a.id);
    assert.equal(await withTransaction((c) => repo.lockEvent(c, 'evt_zzzzzzzzzz')), null);
  });
});
