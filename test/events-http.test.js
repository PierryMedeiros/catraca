'use strict';

// F02 — rotas via fetch contra o app real (F02-AC01..AC07, AC09, AC11, X-01, X-02,
// guarda de evento cancelado, robustez e seções extensíveis da gestão).

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, createClient, loginAs, SEED, query, endPool } = require('./helpers');
const { EVENT_TEXTS } = require('../src/features/events/texts');
const { CANCEL_TEXTS } = require('../src/features/cancellation/texts');
const messages = require('../src/messages');
const { formatDateTime } = require('../src/format');
const views = require('../src/features/events/views');
const {
  localDateTime,
  loggedClient,
  eventFields,
  createEventHttp,
  publishEventHttp,
  userIdByEmail,
  eventRow,
  eventFingerprint,
  countEvents,
} = require('./support/events');

let app;
let orgA;
let orgB;
let A; // cliente logado como organizador A
let B; // cliente logado como organizador B
let P; // cliente logado como participante da seed

before(async () => {
  app = await startApp();
  orgA = await userIdByEmail(SEED.orgA);
  orgB = await userIdByEmail(SEED.orgB);
  A = await loggedClient(app.baseUrl, SEED.orgA);
  B = await loggedClient(app.baseUrl, SEED.orgB);
  P = await loggedClient(app.baseUrl, SEED.participant);
});
after(async () => {
  await app.close();
  await endPool();
});

const LOGIN_NEXT = /^\/login\?next=/;

async function newEvent(client, fields = {}) {
  const r = await createEventHttp(client, fields);
  assert.equal(r.status, 302, `criação deveria redirecionar (${r.status})`);
  assert.ok(r.id, `Location inesperada: ${r.location}`);
  return r.id;
}

describe('events-http.test.js — F02 rotas', () => {
  test('F02-AC01 / X-02: A logado por /login cria rascunho; após logout a gestão não abre', async () => {
    const c = createClient(app.baseUrl);
    const login = await loginAs(c, SEED.orgA);
    assert.equal(login.status, 302);
    assert.equal(login.headers.get('location'), '/org/events');

    const form = await c.get('/org/events/new');
    assert.equal(form.status, 200);
    const formHtml = await form.text();
    assert.ok(formHtml.includes('<form method="post" action="/org/events">'));
    for (const name of ['name', 'startsAt', 'venue', 'capacity', 'price']) {
      assert.ok(formHtml.includes(`name="${name}"`), name);
    }
    assert.ok(formHtml.includes('type="datetime-local"'));

    const r = await createEventHttp(c, { name: 'Jazz no Porão', venue: 'Porão', capacity: '2', price: '100,00' });
    assert.equal(r.status, 302);
    assert.match(r.location, /^\/org\/events\/evt_[a-z0-9]{10}$/);
    const row = await eventRow(r.id);
    assert.equal(row.status, 'draft');
    assert.equal(row.organizer_id, orgA);
    assert.equal(row.name, 'Jazz no Porão');
    assert.equal(row.venue, 'Porão');
    assert.equal(row.capacity, 2);
    assert.equal(row.price_cents, 10000);
    assert.equal(row.cancelled_at, null);

    assert.equal((await c.get(`/org/events/${r.id}`)).status, 200);
    const out = await c.post('/logout', {});
    assert.equal(out.status, 302);
    const after1 = await c.get(`/org/events/${r.id}`);
    assert.equal(after1.status, 302);
    assert.match(after1.headers.get('location'), LOGIN_NEXT);
    assert.ok(!(await after1.text()).includes('Jazz no Porão'));
  });

  test('X-01: visitante vai ao login e participante recebe 403 sem dados do evento', async () => {
    const id = await newEvent(A, { name: 'Segredo X01', venue: 'Sala X01' });
    const n0 = await countEvents();
    const fp = await eventFingerprint(id);
    const s = localDateTime(43200, { seconds: false });
    const body = { name: 'Intruso', startsAt: s, venue: 'X', capacity: '9', price: '10' };

    const v = createClient(app.baseUrl);
    for (const [method, path, form] of [
      ['GET', '/org/events'],
      ['GET', '/org/events/new'],
      ['GET', `/org/events/${id}`],
      ['POST', '/org/events', body],
      ['POST', `/org/events/${id}/edit`, body],
      ['POST', `/org/events/${id}/publish`, {}],
    ]) {
      const res = method === 'GET' ? await v.get(path) : await v.post(path, form);
      assert.equal(res.status, 302, `${method} ${path}`);
      assert.equal(res.headers.get('location'), `/login?next=${encodeURIComponent(path)}`, `${method} ${path}`);
    }

    for (const [method, path, form] of [
      ['GET', '/org/events'],
      ['GET', '/org/events/new'],
      ['GET', `/org/events/${id}`],
      ['POST', '/org/events', body],
      ['POST', `/org/events/${id}/edit`, body],
      ['POST', `/org/events/${id}/publish`, {}],
    ]) {
      const res = method === 'GET' ? await P.get(path) : await P.post(path, form);
      const html = await res.text();
      assert.equal(res.status, 403, `${method} ${path}`);
      assert.ok(html.includes(messages.AUTH.FORBIDDEN));
      for (const secret of [id, 'Segredo X01', 'Sala X01']) assert.ok(!html.includes(secret), `${path} vaza ${secret}`);
    }
    assert.equal(await countEvents(), n0);
    assert.equal(await eventFingerprint(id), fp);
  });

  test('X-01: depois do login, o next de um POST de ação leva à página de gestão', async () => {
    const id = await newEvent(A);
    const c = createClient(app.baseUrl);
    const res = await c.post(`/org/events/${id}/edit`, eventFields());
    const next = decodeURIComponent(res.headers.get('location').replace('/login?next=', ''));
    const login = await loginAs(c, SEED.orgA, undefined, next);
    assert.equal(login.headers.get('location'), `/org/events/${id}/edit`);
    const back = await c.get(`/org/events/${id}/edit`);
    assert.equal(back.status, 302);
    assert.equal(back.headers.get('location'), `/org/events/${id}`);
    const back2 = await c.get(`/org/events/${id}/publish`);
    assert.equal(back2.headers.get('location'), `/org/events/${id}`);
  });

  test('F02-AC02: criação inválida -> 422, mensagem exata, nenhuma linha criada', async () => {
    const S = localDateTime(43200);
    const cases = [
      [{ name: '' }, EVENT_TEXTS.NAME_REQUIRED],
      [{ name: '   ' }, EVENT_TEXTS.NAME_REQUIRED],
      [{ venue: '' }, EVENT_TEXTS.VENUE_REQUIRED],
      [{ capacity: '0' }, EVENT_TEXTS.CAPACITY_INVALID],
      [{ capacity: '-1' }, EVENT_TEXTS.CAPACITY_INVALID],
      [{ capacity: '2.5' }, EVENT_TEXTS.CAPACITY_INVALID],
      [{ capacity: 'abc' }, EVENT_TEXTS.CAPACITY_INVALID],
      [{ capacity: '' }, EVENT_TEXTS.CAPACITY_INVALID],
      [{ capacity: '99999999999' }, EVENT_TEXTS.CAPACITY_INVALID],
      [{ price: '' }, EVENT_TEXTS.PRICE_INVALID],
      [{ price: 'abc' }, EVENT_TEXTS.PRICE_INVALID],
      [{ price: '0' }, EVENT_TEXTS.PRICE_INVALID],
      [{ price: '-5' }, EVENT_TEXTS.PRICE_INVALID],
      [{ price: '10,123' }, EVENT_TEXTS.PRICE_INVALID],
      [{ price: '1.234,56' }, EVENT_TEXTS.PRICE_INVALID],
      [{ price: '99999999999' }, EVENT_TEXTS.PRICE_INVALID],
      [{ startsAt: '' }, EVENT_TEXTS.STARTS_AT_INVALID],
      [{ startsAt: 'amanhã' }, EVENT_TEXTS.STARTS_AT_INVALID],
      [{ startsAt: '2099-02-30T10:00' }, EVENT_TEXTS.STARTS_AT_INVALID],
      [{ startsAt: localDateTime(-1440) }, EVENT_TEXTS.STARTS_AT_PAST],
      [{ startsAt: localDateTime(-1) }, EVENT_TEXTS.STARTS_AT_PAST],
    ];
    const n0 = await countEvents();
    for (const [over, msg] of cases) {
      const res = await A.post('/org/events', eventFields({ startsAt: S, ...over }));
      const html = await res.text();
      assert.equal(res.status, 422, JSON.stringify(over));
      assert.equal(res.headers.get('location'), null);
      assert.ok(html.includes(msg), `${JSON.stringify(over)} sem "${msg}"`);
      assert.ok(html.includes(EVENT_TEXTS.FORM_INVALID));
      assert.ok(html.includes('<form method="post" action="/org/events">'));
    }

    const kept = await A.post('/org/events', eventFields({ name: 'Nome Mantido', venue: 'Local Mantido', capacity: '0' }));
    const keptHtml = await kept.text();
    assert.equal(kept.status, 422);
    assert.ok(keptHtml.includes('value="Nome Mantido"'));
    assert.ok(keptHtml.includes('value="Local Mantido"'));

    const empty = await A.request('POST', '/org/events', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    const emptyHtml = await empty.text();
    assert.equal(empty.status, 422);
    for (const m of [
      EVENT_TEXTS.NAME_REQUIRED,
      EVENT_TEXTS.VENUE_REQUIRED,
      EVENT_TEXTS.CAPACITY_INVALID,
      EVENT_TEXTS.PRICE_INVALID,
      EVENT_TEXTS.STARTS_AT_INVALID,
    ]) {
      assert.ok(emptyHtml.includes(m), m);
    }
    assert.equal(await countEvents(), n0);
  });

  test('F02-AC03: formatos de preço aceitos gravam os centavos esperados', async () => {
    const expected = [
      ['100', 10000],
      ['100,00', 10000],
      ['100.00', 10000],
      ['R$ 100,00', 10000],
      ['150,5', 15050],
    ];
    for (const [price, cents] of expected) {
      const id = await newEvent(A, { price });
      assert.equal((await eventRow(id)).price_cents, cents, price);
    }
  });

  test('F02-AC04: "Meus eventos" lista só os eventos do organizador logado', async () => {
    const ea = await newEvent(A, { name: 'Lista do A' });
    const eb = await newEvent(B, { name: 'Lista do B' });
    assert.equal((await publishEventHttp(A, ea)).status, 302);

    const la = await (await A.get('/org/events')).text();
    const lb = await (await B.get('/org/events')).text();
    assert.ok(la.includes(`href="/org/events/${ea}"`));
    assert.ok(!la.includes(eb) && !la.includes('Lista do B'));
    assert.ok(lb.includes(`href="/org/events/${eb}"`));
    assert.ok(!lb.includes(ea) && !lb.includes('Lista do A'));

    const count = async (id) => (await query('SELECT count(*) AS n FROM events WHERE organizer_id = $1', [id])).rows[0].n;
    const links = (html) => (html.match(/href="\/org\/events\/evt_[a-z0-9]{10}"/g) || []).length;
    assert.equal(links(la), await count(orgA));
    assert.equal(links(lb), await count(orgB));
    assert.ok(la.includes('publicado'));
    assert.ok(lb.includes('rascunho'));
    assert.ok(la.includes(formatDateTime((await eventRow(ea)).starts_at)));
  });

  test('F02-AC04: organizador sem eventos vê a mensagem de lista vazia', () => {
    const html = views.renderEventsList({ events: [] });
    assert.ok(html.includes(EVENT_TEXTS.EMPTY_LIST));
    assert.ok(html.includes('href="/org/events/new"'));
  });

  test('F02-AC05: página de gestão do dono com dados, edição e Publicar; URL reabrível', async () => {
    const id = await newEvent(A, { name: 'Gestão AC05', venue: 'Porão AC05', price: '100,00', capacity: '2' });
    const res = await A.get(`/org/events/${id}`);
    const html = await res.text();
    assert.equal(res.status, 200);
    const row = await eventRow(id);
    for (const s of [
      'Gestão AC05',
      'Porão AC05',
      'R$ 100,00',
      'Status: rascunho',
      formatDateTime(row.starts_at),
      `action="/org/events/${id}/publish"`,
      `action="/org/events/${id}/edit"`,
      'Publicar',
      'Salvar alterações',
      'value="100,00"',
      'value="2"',
      'href="/org/events"',
    ]) {
      assert.ok(html.includes(s), `faltou ${s}`);
    }
    const fresh = await loggedClient(app.baseUrl, SEED.orgA);
    const again = await fresh.get(`/org/events/${id}`);
    assert.equal(again.status, 200);
    assert.ok((await again.text()).includes('Gestão AC05'));
  });

  test('F02-AC06: publicar muda draft -> published; repetir não altera nada', async () => {
    const id = await newEvent(A);
    const u0 = (await eventRow(id)).updated_at;
    const r1 = await publishEventHttp(A, id);
    assert.equal(r1.status, 302);
    assert.equal(r1.headers.get('location'), `/org/events/${id}`);
    const row1 = await eventRow(id);
    assert.equal(row1.status, 'published');
    assert.notEqual(row1.updated_at.getTime(), u0.getTime());

    const html = await (await A.get(`/org/events/${id}`)).text();
    assert.ok(!html.includes(`action="/org/events/${id}/publish"`));
    assert.ok(html.includes('Status: publicado'));
    assert.ok(html.includes(`action="/org/events/${id}/edit"`));

    const fp = await eventFingerprint(id);
    const r2 = await publishEventHttp(A, id);
    assert.equal(r2.status, 302);
    assert.equal(await eventFingerprint(id), fp);
  });

  test('F02-AC06: publicações simultâneas respondem todas 302', async () => {
    const id = await newEvent(A);
    const codes = await Promise.all(Array.from({ length: 10 }, () => publishEventHttp(A, id).then((r) => r.status)));
    assert.deepEqual(codes, Array(10).fill(302));
    assert.equal((await eventRow(id)).status, 'published');
  });

  test('F02-AC07: edição válida de rascunho e de publicado', async () => {
    const S = localDateTime(50000, { seconds: false });
    const draft = await newEvent(A, { name: 'Rascunho AC07', capacity: '2', price: '20' });
    const r1 = await A.post(`/org/events/${draft}/edit`, { name: 'Rascunho editado', startsAt: S, venue: 'Sala nova', capacity: '4', price: '25,50' });
    assert.equal(r1.status, 302);
    assert.equal(r1.headers.get('location'), `/org/events/${draft}`);
    let row = await eventRow(draft);
    assert.deepEqual([row.status, row.name, row.venue, row.capacity, row.price_cents], ['draft', 'Rascunho editado', 'Sala nova', 4, 2550]);
    const [y, mo, d, h, mi] = S.split(/[-T:]/).map(Number);
    assert.equal(row.starts_at.getTime(), new Date(y, mo - 1, d, h, mi).getTime());

    const pub = await newEvent(A, { name: 'Publicado AC07' });
    await publishEventHttp(A, pub);
    const r2 = await A.post(`/org/events/${pub}/edit`, { name: 'Publicado II', startsAt: S, venue: 'Porão 2', capacity: '3', price: '150,00' });
    assert.equal(r2.status, 302);
    row = await eventRow(pub);
    assert.deepEqual([row.status, row.name, row.venue, row.capacity, row.price_cents], ['published', 'Publicado II', 'Porão 2', 3, 15000]);
  });

  test('F02-AC07: edição inválida -> 422 com a gestão reexibida e linha intacta', async () => {
    const id = await newEvent(A, { capacity: '3' });
    await publishEventHttp(A, id);
    const fp = await eventFingerprint(id);
    const cases = [
      [{ name: '' }, EVENT_TEXTS.NAME_REQUIRED],
      [{ capacity: '0' }, EVENT_TEXTS.CAPACITY_INVALID],
      [{ price: 'abc' }, EVENT_TEXTS.PRICE_INVALID],
      [{ startsAt: localDateTime(-1440) }, EVENT_TEXTS.STARTS_AT_PAST],
      [{ startsAt: localDateTime(-1) }, EVENT_TEXTS.STARTS_AT_PAST],
      [{ startsAt: '' }, EVENT_TEXTS.STARTS_AT_INVALID],
    ];
    for (const [over, msg] of cases) {
      const res = await A.post(`/org/events/${id}/edit`, eventFields({ name: 'Editado', ...over }));
      const html = await res.text();
      assert.equal(res.status, 422, JSON.stringify(over));
      assert.ok(html.includes(msg), msg);
      assert.ok(html.includes(EVENT_TEXTS.FORM_INVALID));
      assert.ok(html.includes(`action="/org/events/${id}/edit"`));
    }
    const res = await A.post(`/org/events/${id}/edit`, eventFields({ name: 'Valor Digitado', capacity: '0' }));
    assert.ok((await res.text()).includes('value="Valor Digitado"'));
    assert.equal(await eventFingerprint(id), fp);
  });

  test('F02-AC09: B recebe 404 idêntico ao inexistente em GET, edit e publish de evento de A', async () => {
    const id = await newEvent(A, { name: 'Segredo AC09', venue: 'Sala Secreta AC09' });
    const fp = await eventFingerprint(id);
    const n0 = await countEvents();
    const body = async (res) => {
      assert.equal(res.status, 404);
      return res.text();
    };
    const base = await body(await B.get('/org/events/evt_zzzzzzzzzz'));
    assert.ok(base.includes(`<h1>${EVENT_TEXTS.NOT_FOUND}</h1>`));
    const bodies = [
      await body(await B.get(`/org/events/${id}`)),
      await body(await B.get('/org/events/abc')),
      await body(await B.get(`/org/events/${encodeURIComponent("evt_x' OR '1'='1")}`)),
      await body(await B.post(`/org/events/${id}/edit`, eventFields({ name: 'Invasor' }))),
      await body(await B.post(`/org/events/${id}/publish`, {})),
      await body(await B.post('/org/events/evt_zzzzzzzzzz/edit', eventFields())),
      await body(await B.post('/org/events/evt_zzzzzzzzzz/publish', {})),
    ];
    for (const b of bodies) {
      assert.equal(b, base);
      for (const secret of [id, 'Segredo AC09', 'Sala Secreta AC09']) assert.ok(!b.includes(secret));
    }
    assert.equal(await eventFingerprint(id), fp);
    assert.equal((await eventRow(id)).status, 'draft');
    assert.equal(await countEvents(), n0);
    const own = await A.get('/org/events/evt_zzzzzzzzzz');
    assert.equal(own.status, 404);
    assert.ok((await own.text()).includes(EVENT_TEXTS.NOT_FOUND));
  });

  test('F02-AC11: agora + 1 min aceito, agora − 1 min rejeitado; exibição dd/mm/aaaa HH:mm', async () => {
    const plus = await createEventHttp(A, { startsAt: localDateTime(1) });
    assert.equal(plus.status, 302);
    const minus = await createEventHttp(A, { startsAt: localDateTime(-1) });
    assert.equal(minus.status, 422);
    assert.ok((await minus.res.text()).includes(EVENT_TEXTS.STARTS_AT_PAST));

    const S = localDateTime(43200, { seconds: false });
    const id = await newEvent(A, { startsAt: S });
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(S);
    const shown = `${m[3]}/${m[2]}/${m[1]} ${m[4]}`;
    const page = await (await A.get(`/org/events/${id}`)).text();
    assert.ok(page.includes(shown));
    assert.ok(page.includes(`value="${S}"`));
    assert.ok((await (await A.get('/org/events')).text()).includes(shown));
    const [y, mo, d, h, mi] = S.split(/[-T:]/).map(Number);
    assert.equal((await eventRow(id)).starts_at.getTime(), new Date(y, mo - 1, d, h, mi).getTime());
  });

  test('Guarda de cancelado: sem formulários; edit/publish -> 409 e linha intacta', async () => {
    const id = await newEvent(A, { name: 'Cancelado F02' });
    await publishEventHttp(A, id);
    await query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [id]);
    const fp = await eventFingerprint(id);

    const page = await A.get(`/org/events/${id}`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.ok(html.includes('Status: cancelado'));
    assert.ok(html.includes(EVENT_TEXTS.CANCELLED_LOCKED));
    assert.ok(!html.includes(`action="/org/events/${id}/edit"`));
    assert.ok(!html.includes(`action="/org/events/${id}/publish"`));

    const ed = await A.post(`/org/events/${id}/edit`, eventFields({ name: 'Volta' }));
    assert.equal(ed.status, 409);
    // F06 (spec §3.2): o 409 de evento cancelado usa renderCancelError.
    assert.ok((await ed.text()).includes(CANCEL_TEXTS.cancelledReadOnly));
    const pb = await publishEventHttp(A, id);
    assert.equal(pb.status, 409);
    assert.ok((await pb.text()).includes(CANCEL_TEXTS.cancelledReadOnly));
    assert.equal(await eventFingerprint(id), fp);
    assert.ok((await (await A.get('/org/events')).text()).includes('cancelado'));
  });

  test('Robustez: HTML escapado e campos forjados ignorados', async () => {
    const x = await newEvent(A, { name: '<script>alert(1)</script>', venue: '<b>Sala</b>' });
    const page = await (await A.get(`/org/events/${x}`)).text();
    assert.ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!page.includes('<script>alert(1)') && !page.includes('<b>Sala</b>'));
    const list = await (await A.get('/org/events')).text();
    assert.ok(list.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!list.includes('<script>alert(1)'));

    const forged = await newEvent(A, { name: 'Forjado', status: 'published', organizer_id: orgB, id: 'evt_aaaaaaaaaa' });
    assert.notEqual(forged, 'evt_aaaaaaaaaa');
    let row = await eventRow(forged);
    assert.equal(row.status, 'draft');
    assert.equal(row.organizer_id, orgA);
    await publishEventHttp(A, forged);
    const ed = await A.post(`/org/events/${forged}/edit`, eventFields({ name: 'Forjado', status: 'draft', organizer_id: orgB }));
    assert.equal(ed.status, 302);
    row = await eventRow(forged);
    assert.equal(row.status, 'published');
    assert.equal(row.organizer_id, orgA);
  });

  test('Seções extensíveis: registerManageSection entra na gestão, em ordem, com o evento', async () => {
    const id = await newEvent(A, { name: 'Seções F02' });
    views.registerManageSection({
      key: 'teste-b',
      order: 300,
      render: async ({ event, client, user }) => {
        const { rows } = await client.query('SELECT 1 AS um');
        return `<section data-section="teste-b">B ${event.id} ${rows[0].um} ${user.email}</section>`;
      },
    });
    views.registerManageSection({ key: 'teste-a', order: 200, render: async ({ context }) => `<section data-section="teste-a">A ${context.msg || ''}</section>` });
    views.registerManageSection({ key: 'teste-vazia', order: 250, render: async () => '' });
    try {
      const html = await (await A.get(`/org/events/${id}`)).text();
      const ia = html.indexOf('data-section="teste-a"');
      const ib = html.indexOf(`B ${id} 1 ${SEED.orgA}`);
      assert.ok(ia > html.indexOf('data-section="dados"'));
      assert.ok(ia > 0 && ib > ia, 'seções em ordem crescente de order');
      assert.ok(ib < html.indexOf('Voltar para meus eventos'));
      assert.ok(!html.includes('teste-vazia'));
      // B (outro organizador) continua com 404 sem as seções
      const other = await (await B.get(`/org/events/${id}`)).text();
      assert.ok(!other.includes('data-section="teste-a"'));
    } finally {
      views.unregisterManageSection('teste-a');
      views.unregisterManageSection('teste-b');
      views.unregisterManageSection('teste-vazia');
    }
  });
});
