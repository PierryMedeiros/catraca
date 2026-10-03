'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, createClient, loginAs, SEED, endPool } = require('./helpers');
const messages = require('../src/messages');

let app;
before(async () => {
  app = await startApp();
});
after(async () => {
  await app.close();
  await endPool();
});

test('F01-AC09: visitante em /org/* vai ao login com next (GET e POST)', async () => {
  const c = createClient(app.baseUrl);
  let res = await c.get('/org/events');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login?next=%2Forg%2Fevents');
  res = await c.get('/org/events/evt_qualquer123');
  assert.equal(res.headers.get('location'), '/login?next=%2Forg%2Fevents%2Fevt_qualquer123');
  res = await c.post('/org/events', { name: 'X' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login?next=%2Forg%2Fevents');
});

test('F01-AC09: participante em /org/* recebe 403 sem ecoar a URL', async () => {
  const c = createClient(app.baseUrl);
  await loginAs(c, SEED.participant);
  let res = await c.get('/org/events');
  let html = await res.text();
  assert.equal(res.status, 403);
  assert.ok(html.includes(messages.AUTH.FORBIDDEN));
  assert.ok(html.includes(messages.AUTH.ORGANIZERS_ONLY));
  assert.ok(html.includes('<nav'));
  res = await c.get('/org/events/evt_qualquer123');
  html = await res.text();
  assert.equal(res.status, 403);
  assert.ok(!html.includes('evt_qualquer123'));
  res = await c.post('/org/events/evt_qualquer123/edit', { name: 'X' });
  assert.equal(res.status, 403);
  assert.ok((await res.text()).includes(messages.AUTH.FORBIDDEN));
});

test('F01-AC09: organizador passa em /org/*; rota inexistente dá 404 com layout', async () => {
  const c = createClient(app.baseUrl);
  await loginAs(c, SEED.orgA);
  assert.equal((await c.get('/org/events')).status, 200);
  const res = await c.get('/org/rota-inexistente-f01');
  assert.equal(res.status, 404);
  const html = await res.text();
  assert.ok(html.includes(messages.PAGE_NOT_FOUND));
  assert.ok(html.includes('<nav'));
});

test('F01-AC09: /me/* — visitante vai ao login, organizador 403, participante 200', async () => {
  const v = await createClient(app.baseUrl).get('/me/tickets');
  assert.equal(v.status, 302);
  assert.equal(v.headers.get('location'), '/login?next=%2Fme%2Ftickets');

  const o = createClient(app.baseUrl);
  await loginAs(o, SEED.orgA);
  const or = await o.get('/me/tickets');
  const ohtml = await or.text();
  assert.equal(or.status, 403);
  assert.ok(ohtml.includes(messages.AUTH.FORBIDDEN));
  assert.ok(ohtml.includes(messages.AUTH.PARTICIPANTS_ONLY));

  const p = createClient(app.baseUrl);
  await loginAs(p, SEED.participant);
  const pr = await p.get('/me/tickets');
  assert.equal(pr.status, 200);
  assert.ok((await pr.text()).includes('Meus ingressos'));
});
