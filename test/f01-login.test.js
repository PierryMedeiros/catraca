'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, createClient, loginAs, SEED, query, endPool } = require('./helpers');
const messages = require('../src/messages');
const { safeNext } = require('../src/auth');

let app;
before(async () => {
  app = await startApp();
});
after(async () => {
  await app.close();
  await endPool();
});

function sessionCookies(res) {
  return res.headers.getSetCookie().filter((c) => c.startsWith('catraca_session='));
}

test('F01-AC07: login por papel, cookie httpOnly/SameSite=Lax e e-mail normalizado', async () => {
  const a = createClient(app.baseUrl);
  const resA = await loginAs(a, SEED.orgA);
  assert.equal(resA.status, 302);
  assert.equal(resA.headers.get('location'), '/org/events');
  const [cookie] = sessionCookies(resA);
  assert.ok(cookie, 'Set-Cookie catraca_session');
  assert.match(cookie, /httponly/i);
  assert.match(cookie, /samesite=lax/i);
  const page = await a.get('/org/events');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('user-name">Organizador A<'));
  assert.ok(html.includes('href="/org/events">Meus eventos</a>'));

  const p = await loginAs(createClient(app.baseUrl), SEED.participant);
  assert.equal(p.headers.get('location'), '/');
  const b = await loginAs(createClient(app.baseUrl), SEED.orgB);
  assert.equal(b.headers.get('location'), '/org/events');
  const upper = await loginAs(createClient(app.baseUrl), '  ORG.A@Catraca.Local ');
  assert.equal(upper.status, 302);
  assert.equal(upper.headers.get('location'), '/org/events');
});

test('F01-AC07: next seguro após login', async () => {
  const cases = [
    [SEED.participant, '/events/evt_abc', '/events/evt_abc'],
    [SEED.participant, '//evil.example', '/'],
    [SEED.participant, 'https://evil.example/x', '/'],
    [SEED.participant, '/\\evil.example', '/'],
    [SEED.participant, '/org/events', '/'],
    [SEED.orgA, '/org/events/evt_x', '/org/events/evt_x'],
    [SEED.orgA, '/events/evt_x', '/org/events'],
    [SEED.orgA, '//evil.example', '/org/events'],
  ];
  for (const [email, next, expected] of cases) {
    const res = await loginAs(createClient(app.baseUrl), email, SEED.password, next);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), expected, `${email} next=${next}`);
  }
  assert.equal(safeNext(undefined, 'participant'), '/');
  assert.equal(safeNext(42, 'organizer'), '/org/events');

  const form = await (await createClient(app.baseUrl).get('/login?next=/events/evt_abc')).text();
  assert.ok(form.includes('name="next" value="/events/evt_abc"'));
  const xss = await (
    await createClient(app.baseUrl).get('/login?next=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E')
  ).text();
  assert.ok(xss.includes('&quot;&gt;&lt;script&gt;'));
  assert.ok(!xss.includes('"><script>'));
});

test('F01-AC07: login inválido responde 401 com a mensagem e sem sessão', async () => {
  const cases = [
    { email: SEED.orgA, password: 'errada123' },
    { email: 'ninguem.f01@example.com', password: SEED.password },
    {},
    { email: SEED.orgA, password: '' },
  ];
  for (const form of cases) {
    const c = createClient(app.baseUrl);
    const res = await c.post('/login', form);
    const html = await res.text();
    assert.equal(res.status, 401, JSON.stringify(form));
    assert.ok(html.includes(messages.AUTH.LOGIN_INVALID));
    assert.equal(sessionCookies(res).length, 0);
    if (form.password) assert.ok(!html.includes(form.password));
    if (form.email === SEED.orgA) assert.ok(html.includes(`value="${SEED.orgA}"`));
    const guard = await c.get('/org/events');
    assert.equal(guard.status, 302);
    assert.equal(guard.headers.get('location'), '/login?next=%2Forg%2Fevents');
  }
});

test('F01-AC07: logout encerra a sessão', async () => {
  const c = createClient(app.baseUrl);
  await loginAs(c, SEED.orgA);
  assert.equal((await c.get('/org/events')).status, 200);
  const out = await c.post('/logout');
  assert.equal(out.status, 302);
  assert.equal(out.headers.get('location'), '/');
  const after1 = await c.get('/org/events');
  assert.equal(after1.status, 302);
  assert.equal(after1.headers.get('location'), '/login?next=%2Forg%2Fevents');
  const home = await (await c.get('/')).text();
  assert.ok(home.includes('<a href="/login">Entrar</a>'));
  assert.ok(!home.includes('user-name'));
  assert.equal((await c.get('/logout')).status, 404);
  const anon = await createClient(app.baseUrl).post('/logout');
  assert.equal(anon.status, 302);
  assert.equal(anon.headers.get('location'), '/');
});

test('F01-AC09: cookie de sessão forjado ou com assinatura errada é tratado como visitante', async () => {
  const { rows } = await query('SELECT id FROM users WHERE email = $1', [SEED.orgA]);
  const fake = Buffer.from(JSON.stringify({ userId: rows[0].id })).toString('base64');

  const p = createClient(app.baseUrl);
  await loginAs(p, SEED.participant);
  const realSig = p.jar.get('catraca_session.sig');
  assert.ok(realSig);

  for (const cookie of [
    `catraca_session=${fake}`,
    `catraca_session=${fake}; catraca_session.sig=assinaturafalsa`,
    `catraca_session=${fake}; catraca_session.sig=${realSig}`,
  ]) {
    const res = await fetch(`${app.baseUrl}/org/events`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(res.status, 302, cookie);
    assert.equal(res.headers.get('location'), '/login?next=%2Forg%2Fevents');
  }
});

test('F01-AC09: sessão de usuário que não existe mais vira visitante', async () => {
  const c = createClient(app.baseUrl);
  const email = `sumiu.${Date.now()}@test.local`;
  await c.post('/signup', { name: 'Sumiu', email, password: 'segredo1' });
  assert.equal((await c.get('/me/tickets')).status, 200);
  await query('DELETE FROM users WHERE email = $1', [email]);
  const res = await c.get('/me/tickets');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login?next=%2Fme%2Ftickets');
});
