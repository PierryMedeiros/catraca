'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, createClient, loginAs, SEED, query, endPool, pool } = require('./helpers');
const { runMigrations, listMigrationFiles } = require('../src/migrate');
const { runSeed } = require('../src/seed');

let app;
before(async () => {
  app = await startApp();
});
after(async () => {
  await app.close();
  await endPool();
});

const SEED_EMAILS = [SEED.orgA, SEED.orgB, SEED.participant];

test('F01-AC01: GET /health responde 200 {"status":"ok"} sem cookie', async () => {
  const res = await fetch(`${app.baseUrl}/health`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(await res.json(), { status: 'ok' });
  assert.equal(res.headers.get('set-cookie'), null);
});

test('F01-AC01: schema_migrations registra 001_users.sql e o runner é idempotente', async () => {
  const files = listMigrationFiles();
  assert.ok(files.includes('001_users.sql'));
  const before1 = await query('SELECT version FROM schema_migrations ORDER BY version');
  assert.deepEqual(before1.rows.map((r) => r.version), files);
  const applied = await runMigrations(pool);
  assert.deepEqual(applied, []);
  const after1 = await query('SELECT count(*) AS n FROM schema_migrations');
  assert.equal(after1.rows[0].n, files.length);
});

test('F01-AC01: colunas da tabela users', async () => {
  const { rows } = await query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_name = 'users' ORDER BY column_name`
  );
  assert.deepEqual(
    rows.map((r) => `${r.column_name}:${r.data_type}:${r.is_nullable}`),
    [
      'created_at:timestamp with time zone:NO',
      'email:text:NO',
      'id:text:NO',
      'name:text:NO',
      'password_hash:text:NO',
      'role:text:NO',
    ]
  );
});

test('F01-AC01: restrições de users rejeitam dados inválidos no banco', async () => {
  const ins = (id, name, email, role) =>
    query('INSERT INTO users (id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,$5)', [id, name, email, 'h', role]);
  const n0 = (await query('SELECT count(*) AS n FROM users')).rows[0].n;
  await assert.rejects(ins('usr_aaaaaaaaaa', 'X', 'Maiusc@x.com', 'participant'), { code: '23514' });
  await assert.rejects(ins('usr_aaaaaaaaab', 'X', 'admin@x.com', 'admin'), { code: '23514' });
  await assert.rejects(ins('usr_aaaaaaaaac', 'X', SEED.orgA, 'participant'), { code: '23505' });
  await assert.rejects(ins('usr_aaaaaaaaad', '   ', 'vazio@x.com', 'participant'), { code: '23514' });
  await assert.rejects(ins('id-invalido', 'X', 'idinv@x.com', 'participant'), { code: '23514' });
  const n1 = (await query('SELECT count(*) AS n FROM users')).rows[0].n;
  assert.equal(n1, n0);
});

test('F01-AC02: seed idempotente e as três contas entram', async () => {
  await runSeed(pool);
  await runSeed(pool);
  const { rows } = await query(
    'SELECT email, name, role, password_hash, id FROM users WHERE email = ANY($1) ORDER BY email',
    [SEED_EMAILS]
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => `${r.email}:${r.name}:${r.role}`),
    [
      'org.a@catraca.local:Organizador A:organizer',
      'org.b@catraca.local:Organizador B:organizer',
      'participante@catraca.local:Participante Seed:participant',
    ]
  );
  for (const r of rows) {
    assert.match(r.password_hash, /^\$2[aby]\$10\$/);
    assert.match(r.id, /^usr_[a-z0-9]{10}$/);
  }
  const expected = { [SEED.orgA]: '/org/events', [SEED.orgB]: '/org/events', [SEED.participant]: '/' };
  for (const email of SEED_EMAILS) {
    const res = await loginAs(createClient(app.baseUrl), email);
    assert.equal(res.status, 302, email);
    assert.equal(res.headers.get('location'), expected[email]);
  }
});
