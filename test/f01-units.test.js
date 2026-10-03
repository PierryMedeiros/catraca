'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const messages = require('../src/messages');
const f = require('../src/format');
const { newId, randomString, CODE_ALPHABET } = require('../src/ids');

test('F01-AC11: messages.js tem os textos exatos do brief e do PRD', () => {
  assert.equal(messages.SOLD_OUT, 'Ingressos esgotados');
  assert.deepEqual(
    { ...messages.CHECKIN },
    {
      invalid_ticket: 'Ingresso inválido para este evento',
      event_cancelled: 'Evento cancelado',
      not_confirmed: 'Ingresso não confirmado',
      already_used: 'Ingresso já utilizado',
      entry_allowed: 'Entrada liberada',
    }
  );
  assert.deepEqual(
    { ...messages.API_ERRORS },
    {
      unauthorized: 'unauthorized',
      invalid_request: 'invalid_request',
      event_not_available: 'event_not_available',
      sold_out: 'sold_out',
      ticket_not_found: 'ticket_not_found',
    }
  );
  assert.deepEqual(
    { ...messages.TICKET_STATUS_LABELS },
    { pending: 'pendente', confirmed: 'confirmado', declined: 'recusado', cancelled: 'cancelado', refunded: 'estornado' }
  );
  assert.deepEqual(
    { ...messages.EVENT_STATUS_LABELS },
    { draft: 'rascunho', published: 'publicado', cancelled: 'cancelado' }
  );
  assert.equal(messages.AUTH.LOGIN_INVALID, 'E-mail ou senha inválidos');
  assert.equal(messages.EVENT_NOT_FOUND, 'Evento não encontrado');
  assert.equal(messages.ONLY_PUBLISHED_CAN_CANCEL, 'Só eventos publicados podem ser cancelados');
  assert.equal(messages.capacityBelowOccupied(2), 'A lotação não pode ser menor que as vagas ocupadas (2)');
  for (const obj of [messages, messages.CHECKIN, messages.API_ERRORS, messages.TICKET_STATUS_LABELS, messages.AUTH]) {
    assert.ok(Object.isFrozen(obj));
  }
});

test('F01-AC11: nenhum outro arquivo de src/ repete os textos do brief', () => {
  const literals = [
    'Ingressos esgotados',
    'Ingresso inválido para este evento',
    'Ingresso não confirmado',
    'Ingresso já utilizado',
    'Entrada liberada',
    'E-mail ou senha inválidos',
  ];
  const root = path.join(__dirname, '..', 'src');
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
    });
  for (const file of walk(root)) {
    if (file === path.join(root, 'messages.js')) continue;
    const content = fs.readFileSync(file, 'utf8');
    for (const lit of literals) assert.ok(!content.includes(lit), `${lit} repetido em ${file}`);
  }
});

test('formatBRL', () => {
  assert.equal(f.formatBRL(35000), 'R$ 350,00');
  assert.equal(f.formatBRL(0), 'R$ 0,00');
  assert.equal(f.formatBRL(123456), 'R$ 1.234,56');
  assert.equal(f.formatBRL(15050), 'R$ 150,50');
  assert.equal(f.formatBRL(5), 'R$ 0,05');
  assert.equal(f.formatBRL(100000000), 'R$ 1.000.000,00');
  assert.equal(f.formatBRL(-12345), '-R$ 123,45');
  assert.ok(!f.formatBRL(100).includes(' '));
});

test('parseBRL', () => {
  const ok = [
    ['100', 10000],
    ['100,00', 10000],
    ['100.00', 10000],
    ['R$ 100,00', 10000],
    ['r$100', 10000],
    ['150,5', 15050],
    ['R$150', 15000],
    [' 20 ', 2000],
    ['0,01', 1],
    ['9999999,99', 999999999],
  ];
  for (const [s, v] of ok) assert.equal(f.parseBRL(s), v, s);
  const bad = ['1.234,56', '10,123', 'abc', '-5', '0', '0,00', '', '12345678,00', '1,', ',5', null, undefined, 100];
  for (const s of bad) assert.equal(f.parseBRL(s), null, String(s));
});

test('datas: formatDateTime, toIsoWithOffset, parseDateTimeLocal, toDateTimeLocalValue (TZ=America/Sao_Paulo)', () => {
  assert.equal(process.env.TZ, 'America/Sao_Paulo', 'o compose dos gates fixa o fuso');
  const d = new Date('2026-12-06T00:00:00Z');
  assert.equal(f.formatDateTime(d), '05/12/2026 21:00');
  assert.equal(f.toIsoWithOffset(d), '2026-12-05T21:00:00-03:00');
  assert.equal(f.toIsoWithOffset(new Date('2026-12-06T00:00:00.789Z')), '2026-12-05T21:00:00-03:00');
  assert.equal(f.parseDateTimeLocal('2026-12-05T21:00').getTime(), d.getTime());
  assert.equal(f.parseDateTimeLocal('2026-12-05T21:00:30').getTime(), d.getTime() + 30000);
  for (const s of ['2026-13-40T99:00', 'ontem', '', '2026-02-30T10:00', '2026-12-05 21:00', null, undefined]) {
    assert.equal(f.parseDateTimeLocal(s), null, String(s));
  }
  assert.equal(f.toDateTimeLocalValue(d), '2026-12-05T21:00');
  assert.equal(f.formatDateTime(new Date(2026, 0, 2, 3, 4)), '02/01/2026 03:04');
});

test('toIsoWithOffset usa +00:00 em UTC (processo filho)', () => {
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(
    process.execPath,
    ['-e', 'console.log(require("./src/format").toIsoWithOffset(new Date("2026-12-06T00:00:00Z")))'],
    { cwd: path.join(__dirname, '..'), env: { ...process.env, TZ: 'UTC' } }
  )
    .toString()
    .trim();
  assert.equal(out, '2026-12-06T00:00:00+00:00');
});

test('ids: newId e randomString', () => {
  const ids = new Set();
  for (let i = 0; i < 10000; i++) ids.add(newId('evt'));
  assert.equal(ids.size, 10000);
  for (const id of ids) assert.match(id, /^evt_[a-z0-9]{10}$/);
  assert.match(newId('tkt_'), /^tkt_[a-z0-9]{10}$/);
  assert.match(newId('usr'), /^usr_[a-z0-9]{10}$/);
  assert.match(randomString(8, CODE_ALPHABET), /^[A-Z0-9]{8}$/);
});
