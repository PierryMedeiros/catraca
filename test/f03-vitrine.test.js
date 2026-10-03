'use strict';

// F03 — vitrine e página pública do evento (F03-AC01, F03-AC02, F03-AC05 na página).

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, createClient, SEED, endPool } = require('./helpers');
const messages = require('../src/messages');
const { CARDS, loginClient, signupParticipant, createEventSql, buyPartner, lineWith, countOccurrences } = require('./f03-helpers');

let app;
let visitor;
let P; // participante
let A; // organizador A

before(async () => {
  app = await startApp();
  visitor = createClient(app.baseUrl);
  P = (await signupParticipant(app.baseUrl, 'Vitrine F03')).client;
  A = await loginClient(app.baseUrl, SEED.orgA);
});
after(async () => {
  await app.close();
  await endPool();
});

const DATE_RE = /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/;

describe('f03-vitrine.test.js', () => {
  test('F03-AC01 GET / lista só eventos à venda (nome, início, local, preço), para visitante, participante e organizador', async () => {
    const tag = `${Date.now()}`;
    const ep = await createEventSql({ name: `Vitrine Pub ${tag}`, capacity: 2, priceCents: 10000 });
    const ed = await createEventSql({ name: `Vitrine Rasc ${tag}`, status: 'draft' });
    const ex = await createEventSql({ name: `Vitrine Canc ${tag}`, status: 'cancelled' });
    const eh = await createEventSql({ name: `<script>alert(1)</script> ${tag}` });

    for (const [who, client] of [['visitante', visitor], ['participante', P], ['organizador', A]]) {
      const res = await client.get('/');
      assert.equal(res.status, 200, who);
      const html = await res.text();
      const lines = lineWith(html, `data-event-id="${ep}"`);
      assert.equal(lines.length, 1, `${who}: uma linha para o evento`);
      const line = lines[0];
      assert.ok(line.startsWith(`<li class="event" data-event-id="${ep}">`), line);
      assert.ok(line.includes(`<a href="/events/${ep}">Vitrine Pub ${tag}</a>`), line);
      assert.ok(line.includes('<span class="venue">Teatro F03</span>'), line);
      assert.ok(line.includes('<span class="price">R$ 100,00</span>'), line);
      assert.match(line, new RegExp(`<span class="starts-at">${DATE_RE.source}</span>`));
      assert.ok(!line.includes(messages.SOLD_OUT), `${who}: evento com vaga não aparece esgotado`);
      for (const hidden of [ed, ex, `Vitrine Rasc ${tag}`, `Vitrine Canc ${tag}`]) {
        assert.ok(!html.includes(hidden), `${who}: ${hidden} não pode aparecer`);
      }
      assert.ok(html.includes(`data-event-id="${eh}"`));
      assert.ok(!html.includes('<script>alert(1)</script>'), `${who}: nome sem escape`);
      assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    }
  });

  test('F03-AC01 F03-AC05 evento esgotado continua listado com "Ingressos esgotados"', async () => {
    const ef = await createEventSql({ capacity: 1 });
    const r = await buyPartner(ef, CARDS.approveSlow);
    assert.equal(r.ok, true);
    const html = await (await visitor.get('/')).text();
    const [line] = lineWith(html, `data-event-id="${ef}"`);
    assert.ok(line, 'esgotado continua na vitrine');
    assert.ok(line.includes(`<span class="sold-out">${messages.SOLD_OUT}</span>`), line);
  });

  test('F03-AC01 participante vê o atalho "Meus ingressos" na vitrine', async () => {
    const html = await (await P.get('/')).text();
    assert.ok(html.includes('<a href="/me/tickets">Meus ingressos</a>'));
  });

  test('F03-AC02 GET /events/:id por papel: visitante (link de login), participante (formulário), organizador (aviso)', async () => {
    const tag = `${Date.now()}`;
    const ep = await createEventSql({ name: `Pagina ${tag}`, capacity: 2, priceCents: 10000 });

    const v = await visitor.get(`/events/${ep}`);
    assert.equal(v.status, 200);
    const vh = await v.text();
    assert.equal(countOccurrences(vh, `Pagina ${tag}`), 1);
    assert.ok(vh.includes(`<h1>Pagina ${tag}</h1>`));
    assert.match(vh, new RegExp(`<p class="starts-at">${DATE_RE.source}</p>`));
    assert.ok(vh.includes('<p class="venue">Teatro F03</p>'));
    assert.ok(vh.includes('<p class="price">R$ 100,00</p>'));
    assert.ok(vh.includes('<p class="seats">Vagas disponíveis: 2</p>'));
    assert.ok(vh.includes(`<a class="login-to-buy" href="/login?next=/events/${ep}">Entrar para comprar</a>`));
    assert.ok(!vh.includes('name="cardNumber"'));

    const p = await P.get(`/events/${ep}`);
    assert.equal(p.status, 200);
    const ph = await p.text();
    assert.ok(ph.includes(`<form method="post" action="/events/${ep}/purchase">`));
    assert.ok(ph.includes('name="cardNumber"'));
    assert.ok(!ph.includes('Entrar para comprar'));

    const a = await A.get(`/events/${ep}`);
    assert.equal(a.status, 200);
    const ah = await a.text();
    assert.ok(!ah.includes('name="cardNumber"'));
    assert.ok(ah.includes('<p class="buy-hint">Somente participantes compram ingressos.</p>'));
  });

  test('F03-AC02 rascunho, cancelado, inexistente e id malformado dão 404 sem dados do evento', async () => {
    const tag = `${Date.now()}`;
    const ed = await createEventSql({ name: `Rasc404 ${tag}`, status: 'draft' });
    const ex = await createEventSql({ name: `Canc404 ${tag}`, status: 'cancelled' });
    const ids = [ed, ex, 'evt_naoexiste0', encodeURIComponent("evt_'; DROP TABLE tickets;--"), 'x'.repeat(3000)];
    for (const id of ids) {
      const res = await P.get(`/events/${id}`);
      assert.equal(res.status, 404, id.slice(0, 40));
      const html = await res.text();
      assert.equal(countOccurrences(html, messages.EVENT_NOT_FOUND), 1);
      assert.ok(!html.includes(`Rasc404 ${tag}`) && !html.includes(`Canc404 ${tag}`));
      assert.ok(!html.includes('Teatro F03'));
    }
  });

  test('F03-AC05 sem vaga, a página do evento mostra "Ingressos esgotados" no lugar do formulário', async () => {
    const e = await createEventSql({ capacity: 1 });
    assert.equal((await buyPartner(e, CARDS.approveSlow)).ok, true);
    for (const client of [P, visitor, A]) {
      const res = await client.get(`/events/${e}`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes(`<p class="sold-out">${messages.SOLD_OUT}</p>`));
      assert.ok(html.includes('<p class="seats">Vagas disponíveis: 0</p>'));
      assert.ok(!html.includes('name="cardNumber"'));
      assert.ok(!html.includes('Entrar para comprar'));
      assert.ok(!html.includes('buy-hint'));
    }
  });
});
