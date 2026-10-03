'use strict';

// X-06 — a API roda no harness de F01: a chave do ambiente/README dá 200, os
// códigos de erro vêm de src/messages.js e nenhum literal deles é repetido em
// src/features/partner/. O router é montado por uma linha em src/app.js.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startApp, endPool } = require('./helpers');
const messages = require('../src/messages');
const h = require('./partner-api.helpers');

const ROOT = path.join(__dirname, '..');
const CODES = ['unauthorized', 'invalid_request', 'event_not_available', 'sold_out', 'ticket_not_found'];

let app;
before(async () => {
  app = await startApp();
});
after(async () => {
  await app.close();
  await endPool();
});

describe('partner-api-harness.test.js', () => {
  test('X-06 messages.js exporta os cinco códigos de erro do brief', () => {
    for (const code of CODES) assert.equal(messages.API_ERRORS[code], code);
  });

  test('X-06 nenhum código do brief aparece como literal em src/features/partner', () => {
    const dir = path.join(ROOT, 'src/features/partner');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
    assert.ok(files.length >= 5, 'arquivos da feature');
    const re = new RegExp(`['"\`](${CODES.join('|')})['"\`]`);
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.doesNotMatch(src, re, `literal de código de erro em ${f}`);
    }
  });

  test('X-06 o router é montado por uma linha em src/app.js', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');
    assert.equal(src.split('\n').filter((l) => l.includes('features/partner')).length, 1);
  });

  test('X-06 README documenta a chave e as três rotas', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    assert.ok(readme.includes('catraca-parceiro-2026'));
    for (const s of ['/api/partner/events', '/purchases', '/api/partner/tickets/', 'X-Api-Key', '$KEY', '$API']) {
      assert.ok(readme.includes(s), `README menciona ${s}`);
    }
  });

  test('X-06 chave do ambiente (PARTNER_API_KEY) -> 200 em GET /api/partner/events', async () => {
    assert.equal(h.KEY, 'catraca-parceiro-2026');
    const r = await h.api(app.baseUrl, '/api/partner/events');
    assert.equal(r.status, 200);
    h.assertJson(r);
    assert.ok(Array.isArray(r.body));
  });
});
