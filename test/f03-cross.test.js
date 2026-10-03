'use strict';

// F03 — critérios cross-feature X-03 (F01 -> F03), X-04 e X-05 (F02 -> F03).

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, createClient, loginAs, SEED, query, endPool } = require('./helpers');
const { eventFields, createEventHttp, publishEventHttp } = require('./support/events');
const messages = require('../src/messages');
const { CARDS, signupParticipant, loginClient, createEventSql, buy, ticketsOfEvent, occupiedSeats } = require('./f03-helpers');

let app;
let A;

before(async () => {
  app = await startApp();
  A = await loginClient(app.baseUrl, SEED.orgA);
});
after(async () => {
  await app.close();
  await endPool();
});

async function eventCapacity(id) {
  return (await query('SELECT capacity, price_cents FROM events WHERE id = $1', [id])).rows[0];
}

describe('f03-cross.test.js', () => {
  test('X-03 participante recém-cadastrado compra e vê o ingresso; visitante volta ao evento após login', async () => {
    const p = await signupParticipant(app.baseUrl, 'Caio X03');
    assert.equal((await query('SELECT role FROM users WHERE id = $1', [p.userId])).rows[0].role, 'participant');
    const tag = Date.now();
    const e = await createEventSql({ name: `X03 ${tag}`, capacity: 3 });
    const r = await buy(p.client, e, CARDS.approveFast);
    assert.equal(r.status, 303);
    assert.equal(r.location, '/me/tickets');
    const html = await (await p.client.get('/me/tickets')).text();
    const line = html.split('\n').find((l) => l.includes(`X03 ${tag}`));
    assert.match(line, /data-status="(pending|confirmed)">(pendente|confirmado)</);
    assert.match(line, /<td class="ticket-code">[A-Z0-9]{8}<\/td>/);

    const v = createClient(app.baseUrl);
    const page = await (await v.get(`/events/${e}`)).text();
    const href = `/login?next=/events/${e}`;
    assert.ok(page.includes(`href="${href}"`));
    const loginPage = await (await v.get(href)).text();
    assert.ok(loginPage.includes(`name="next" value="/events/${e}"`));
    const login = await loginAs(v, SEED.participant, SEED.password, `/events/${e}`);
    assert.equal(login.status, 302);
    assert.equal(login.headers.get('location'), `/events/${e}`);
    const after1 = await (await v.get(`/events/${e}`)).text();
    assert.ok(after1.includes('name="cardNumber"'));
  });

  test('X-04 evento de F02 só aparece após publicar; mudar o preço não altera ingressos já comprados', async () => {
    const p = await signupParticipant(app.baseUrl, 'Compra X04');
    const name = `X04 ${Date.now()}`;
    const created = await createEventHttp(A, { name, capacity: '3', price: '100,00' });
    assert.equal(created.status, 302);
    const id = created.id;
    assert.ok(!(await (await createClient(app.baseUrl).get('/')).text()).includes(id));
    assert.equal((await createClient(app.baseUrl).get(`/events/${id}`)).status, 404);
    assert.equal((await buy(p.client, id, CARDS.approveFast)).status, 404, 'rascunho não vende');

    assert.equal((await publishEventHttp(A, id)).status, 302);
    const home = await (await createClient(app.baseUrl).get('/')).text();
    const line = home.split('\n').find((l) => l.includes(`data-event-id="${id}"`));
    assert.ok(line.includes('R$ 100,00'), line);

    assert.equal((await buy(p.client, id, CARDS.approveFast)).status, 303);
    const edit = await A.post(`/org/events/${id}/edit`, eventFields({ name, capacity: '3', price: '150,00' }));
    assert.equal(edit.status, 302);
    assert.equal((await eventCapacity(id)).price_cents, 15000);
    assert.deepEqual((await ticketsOfEvent(id)).map((t) => t.price_cents), [10000]);

    assert.equal((await buy(p.client, id, CARDS.approveFast)).status, 303);
    assert.deepEqual((await ticketsOfEvent(id)).map((t) => t.price_cents), [10000, 15000]);
    const page = await (await createClient(app.baseUrl).get(`/events/${id}`)).text();
    assert.ok(page.includes('<p class="price">R$ 150,00</p>'));
  });

  test('X-05 com 2 ingressos reais, lotação 1 é rejeitada e 3 é aceita e libera mais uma compra', async () => {
    const p = await signupParticipant(app.baseUrl, 'Compra X05');
    const name = `X05 ${Date.now()}`;
    const { id } = await createEventHttp(A, { name, capacity: '2', price: '100,00' });
    assert.equal((await publishEventHttp(A, id)).status, 302);
    assert.equal((await buy(p.client, id, CARDS.approveFast)).status, 303);
    assert.equal((await buy(p.client, id, CARDS.approveSlow)).status, 303);
    assert.equal((await buy(p.client, id, CARDS.approveFast)).status, 409);

    const reject = await A.post(`/org/events/${id}/edit`, eventFields({ name, capacity: '1', price: '100,00' }));
    assert.equal(reject.status, 422);
    assert.ok((await reject.text()).includes(messages.capacityBelowOccupied(2)));
    assert.equal((await eventCapacity(id)).capacity, 2);

    const accept = await A.post(`/org/events/${id}/edit`, eventFields({ name, capacity: '3', price: '100,00' }));
    assert.equal(accept.status, 302);
    assert.equal((await eventCapacity(id)).capacity, 3);
    const page = await (await createClient(app.baseUrl).get(`/events/${id}`)).text();
    assert.ok(page.includes('<p class="seats">Vagas disponíveis: 1</p>'));

    assert.equal((await buy(p.client, id, CARDS.approveFast)).status, 303);
    assert.equal((await buy(p.client, id, CARDS.approveFast)).status, 409);
    assert.equal(await occupiedSeats(id), 3);
  });
});
