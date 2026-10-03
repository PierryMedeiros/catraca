'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, createClient, uniqueEmail, query, endPool, SEED } = require('./helpers');
const messages = require('../src/messages');

let app;
before(async () => {
  app = await startApp();
});
after(async () => {
  await app.close();
  await endPool();
});

async function countUsers() {
  return (await query('SELECT count(*) AS n FROM users')).rows[0].n;
}

test('F01-AC05: cadastro válido cria participante com hash bcrypt, abre sessão e redireciona a /', async () => {
  const c = createClient(app.baseUrl);
  const email = uniqueEmail('Nova.Pessoa').replace('@test.local', '@Test.Local');
  const res = await c.post('/signup', { name: '  Ana Teste  ', email: `  ${email}  `, password: 'segredo1' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/');
  const { rows } = await query('SELECT name, email, role, password_hash FROM users WHERE email = $1', [
    email.toLowerCase(),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Ana Teste');
  assert.equal(rows[0].role, 'participant');
  assert.match(rows[0].password_hash, /^\$2[aby]\$10\$/);
  assert.ok(!rows[0].password_hash.includes('segredo1'));

  const home = await c.get('/');
  const html = await home.text();
  assert.equal(home.status, 200);
  assert.ok(html.includes('<span class="user-name">Ana Teste</span>'));
  assert.ok(html.includes('>Sair</button>'));
  assert.ok(!html.includes('href="/signup"'));
});

test('F01-AC06: cadastros inválidos respondem 422, reexibem o formulário e não criam usuário', async () => {
  const n0 = await countUsers();
  const cases = [
    [{ name: '   ', email: uniqueEmail('ok'), password: 'segredo1' }, [messages.AUTH.NAME_REQUIRED]],
    [{ name: 'Ana', email: 'ana@', password: 'segredo1' }, [messages.AUTH.EMAIL_INVALID]],
    [{ name: 'Ana', email: 'ana example.com', password: 'segredo1' }, [messages.AUTH.EMAIL_INVALID]],
    [{ name: 'Ana', email: 'ana@exemplo', password: 'segredo1' }, [messages.AUTH.EMAIL_INVALID]],
    [{ name: 'Ana', email: '@exemplo.com', password: 'segredo1' }, [messages.AUTH.EMAIL_INVALID]],
    [{ name: 'Ana', email: '  PARTICIPANTE@Catraca.LOCAL ', password: 'segredo1' }, [messages.AUTH.EMAIL_TAKEN]],
    [{ name: 'Ana Curta', email: uniqueEmail('curta'), password: 'zq9x1' }, [messages.AUTH.PASSWORD_TOO_SHORT]],
    [
      {},
      [messages.AUTH.NAME_REQUIRED, messages.AUTH.EMAIL_INVALID, messages.AUTH.PASSWORD_TOO_SHORT],
    ],
  ];
  for (const [form, expected] of cases) {
    const res = await createClient(app.baseUrl).post('/signup', form);
    const html = await res.text();
    assert.equal(res.status, 422, JSON.stringify(form));
    assert.ok(html.includes('action="/signup"'));
    for (const msg of expected) assert.ok(html.includes(msg), `${msg} em ${JSON.stringify(form)}`);
    if (form.password) assert.ok(!html.includes(form.password), 'senha nunca é reexibida');
    if (form.name === 'Ana Curta') assert.ok(html.includes('value="Ana Curta"'));
  }
  const json = await createClient(app.baseUrl).postJson('/signup', {
    name: 'Ana',
    email: uniqueEmail('json'),
    password: 'segredo1',
  });
  assert.equal(json.status, 422);
  assert.ok((await json.text()).includes('action="/signup"'));
  assert.equal(await countUsers(), n0);
});

test('F01-AC08: campo role=organizer é ignorado e não há campo de papel no formulário', async () => {
  const c = createClient(app.baseUrl);
  const email = uniqueEmail('quer.ser.org');
  const res = await c.post('/signup', { name: 'Quer Ser Org', email, password: 'segredo1', role: 'organizer' });
  assert.equal(res.status, 302);
  const { rows } = await query('SELECT role FROM users WHERE email = $1', [email]);
  assert.equal(rows[0].role, 'participant');
  assert.equal((await c.get('/org/events')).status, 403);
  const form = await (await createClient(app.baseUrl).get('/signup')).text();
  assert.ok(!form.includes('name="role"'));
  for (const p of ['/signup/organizer', '/org/signup', '/organizer/signup']) {
    const orgEmail = uniqueEmail('org');
    const r = await createClient(app.baseUrl).post(p, { name: 'X', email: orgEmail, password: 'segredo1' });
    assert.ok([302, 404].includes(r.status), `${p} -> ${r.status}`);
    if (r.status === 302) assert.equal(r.headers.get('location'), `/login?next=${encodeURIComponent(p)}`);
    const created = await query('SELECT count(*) AS n FROM users WHERE email = $1', [orgEmail]);
    assert.equal(created.rows[0].n, 0);
  }
});

test('F01-AC06: cadastros simultâneos com o mesmo e-mail -> exatamente um 302 e uma linha (3 rodadas)', async () => {
  for (let round = 1; round <= 3; round++) {
    const email = uniqueEmail(`corrida${round}`);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createClient(app.baseUrl).post('/signup', { name: `Corrida ${i}`, email, password: 'segredo1' })
      )
    );
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [302, 422, 422, 422, 422, 422, 422, 422, 422, 422], `rodada ${round}`);
    const { rows } = await query('SELECT count(*) AS n FROM users WHERE email = $1', [email]);
    assert.equal(rows[0].n, 1);
  }
});

test('F01-AC06: e-mail da seed com maiúsculas e espaços conta como já cadastrado', async () => {
  const res = await createClient(app.baseUrl).post('/signup', {
    name: 'Outra',
    email: `  ${SEED.orgA.toUpperCase()}  `,
    password: 'segredo1',
  });
  assert.equal(res.status, 422);
  assert.ok((await res.text()).includes(messages.AUTH.EMAIL_TAKEN));
});
