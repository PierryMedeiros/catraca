'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, createClient, loginAs, SEED, uniqueEmail, query, endPool } = require('./helpers');
const { escapeHtml, layout } = require('../src/views/layout');

let app;
before(async () => {
  app = await startApp();
});
after(async () => {
  await app.close();
  await endPool();
});

const VISITOR_LINKS = ['<a href="/login">Entrar</a>', '<a href="/signup">Criar conta</a>'];
const LOGOUT_FORM = '<form method="post" action="/logout"><button type="submit">Sair</button></form>';

test('F01-AC10: visitante vê layout completo e nav de visitante em todas as páginas', async () => {
  const expected = { '/': 200, '/login': 200, '/signup': 200, '/nao-existe-f01': 404 };
  for (const [path, status] of Object.entries(expected)) {
    const res = await createClient(app.baseUrl).get(path);
    const html = await res.text();
    assert.equal(res.status, status, path);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(html, /^<!doctype html>/i);
    assert.ok(html.includes('<html lang="pt-BR">'));
    assert.ok(html.includes('<nav'));
    for (const l of VISITOR_LINKS) assert.ok(html.includes(l), `${path} ${l}`);
    assert.ok(!html.includes('user-name'));
  }
});

test('F01-AC10: nav de participante e de organizador', async () => {
  const p = createClient(app.baseUrl);
  await loginAs(p, SEED.participant);
  for (const path of ['/', '/login', '/signup', '/nao-existe-f01']) {
    const html = await (await p.get(path)).text();
    assert.ok(html.includes('<a href="/me/tickets">Meus ingressos</a>'), path);
    assert.ok(html.includes('<span class="user-name">Participante Seed</span>'), path);
    assert.ok(html.includes(LOGOUT_FORM), path);
    assert.ok(!html.includes('<a href="/login">Entrar</a>'), path);
    assert.ok(!html.includes('<a href="/org/events">'), path);
  }
  const o = createClient(app.baseUrl);
  await loginAs(o, SEED.orgA);
  for (const path of ['/', '/login', '/signup', '/nao-existe-f01']) {
    const html = await (await o.get(path)).text();
    assert.ok(html.includes('<a href="/org/events">Meus eventos</a>'), path);
    assert.ok(html.includes('<span class="user-name">Organizador A</span>'), path);
    assert.ok(html.includes(LOGOUT_FORM), path);
    assert.ok(!html.includes('<a href="/me/tickets">'), path);
  }
});

test('F01-AC10: nomes e e-mails dinâmicos aparecem escapados', async () => {
  const s = createClient(app.baseUrl);
  const email = uniqueEmail('xss');
  assert.equal((await s.post('/signup', { name: '<script>x</script>', email, password: 'segredo1' })).status, 302);
  const html = await (await s.get('/')).text();
  assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;'));
  assert.ok(!html.includes('<script>x</script>'));
  const { rows } = await query('SELECT name FROM users WHERE email = $1', [email]);
  assert.equal(rows[0].name, '<script>x</script>');

  const s2 = createClient(app.baseUrl);
  await s2.post('/signup', { name: 'Ana "A" & B', email: uniqueEmail('aspas'), password: 'segredo1' });
  assert.ok((await (await s2.get('/')).text()).includes('Ana &quot;A&quot; &amp; B'));

  const res = await createClient(app.baseUrl).post('/signup', {
    name: 'Teste',
    email: '"><img src=x onerror=alert(1)>',
    password: 'segredo1',
  });
  const body = await res.text();
  assert.equal(res.status, 422);
  assert.ok(body.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!body.includes('"><img'));
});

test('F01-AC10: escapeHtml e layout', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(42), '42');
  const html = layout({ title: '<T>', user: null, body: '<p>ok</p>' });
  assert.ok(html.includes('<title>&lt;T&gt; · Catraca</title>'));
  assert.ok(html.includes('<main>\n<p>ok</p>'));
});
