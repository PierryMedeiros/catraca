'use strict';

// F02 — validateEventInput e auxiliares (F02-AC02, F02-AC03, F02-AC11). Unidade, sem banco.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateEventInput,
  toDatetimeLocalValue,
  centsToInput,
  eventToFormValues,
} = require('../src/features/events/validation');
const { EVENT_TEXTS, EVENT_STATUS_LABELS, capacityBelowOccupied } = require('../src/features/events/texts');
const repo = require('../src/features/events/repo');

const pad2 = (n) => String(n).padStart(2, '0');
const dtl = (d, seconds = false) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}` +
  (seconds ? `:${pad2(d.getSeconds())}` : '');

// "agora" fixo, com segundos zerados, no fuso do processo
const NOW = new Date(2030, 5, 15, 14, 30, 0, 0);
const plus = (min) => new Date(NOW.getTime() + min * 60000);

const valid = (over = {}) => ({
  name: 'Jazz no Porão',
  startsAt: dtl(plus(60 * 24)),
  venue: 'Porão',
  capacity: '2',
  price: '100,00',
  ...over,
});
const check = (over) => validateEventInput(valid(over), { now: NOW });

describe('events-validation.test.js — F02 validação', () => {
  test('F02 textos: mensagens exatas da spec e reaproveitadas de messages.js', () => {
    assert.equal(EVENT_TEXTS.NOT_FOUND, 'Evento não encontrado');
    assert.equal(EVENT_TEXTS.CANCELLED_LOCKED, 'Este evento foi cancelado e não pode ser alterado.');
    assert.equal(EVENT_TEXTS.FORM_INVALID, 'Não foi possível salvar. Corrija os campos indicados.');
    assert.equal(EVENT_TEXTS.NAME_REQUIRED, 'Informe o nome do evento.');
    assert.equal(EVENT_TEXTS.VENUE_REQUIRED, 'Informe o local do evento.');
    assert.equal(EVENT_TEXTS.STARTS_AT_INVALID, 'Informe uma data e hora de início válidas.');
    assert.equal(EVENT_TEXTS.STARTS_AT_PAST, 'A data de início precisa estar no futuro.');
    assert.equal(EVENT_TEXTS.CAPACITY_INVALID, 'A lotação deve ser um número inteiro maior ou igual a 1.');
    assert.equal(
      EVENT_TEXTS.PRICE_INVALID,
      'Informe um preço maior que zero, em reais, com até 2 casas decimais (ex.: 100,00).'
    );
    assert.equal(EVENT_TEXTS.EMPTY_LIST, 'Você ainda não criou eventos.');
    assert.equal(capacityBelowOccupied(2), 'A lotação não pode ser menor que as vagas ocupadas (2)');
    assert.deepEqual({ ...EVENT_STATUS_LABELS }, { draft: 'rascunho', published: 'publicado', cancelled: 'cancelado' });
    assert.equal(repo.validateEventInput, validateEventInput, 'repo reexporta validateEventInput');
  });

  test('F02-AC01: entrada válida devolve valores normalizados', () => {
    const r = validateEventInput(valid({ name: '  Jazz  ', venue: ' Porão ' }), { now: NOW });
    assert.equal(r.ok, true);
    assert.equal(r.value.name, 'Jazz');
    assert.equal(r.value.venue, 'Porão');
    assert.equal(r.value.capacity, 2);
    assert.equal(r.value.priceCents, 10000);
    assert.ok(r.value.startsAt instanceof Date);
  });

  test('F02-AC02: nome e local vazios (inclusive só espaços)', () => {
    assert.deepEqual(check({ name: '' }).errors, { name: EVENT_TEXTS.NAME_REQUIRED });
    assert.deepEqual(check({ name: '   ' }).errors, { name: EVENT_TEXTS.NAME_REQUIRED });
    assert.deepEqual(check({ venue: '' }).errors, { venue: EVENT_TEXTS.VENUE_REQUIRED });
  });

  test('F02-AC02: lotação inteira >= 1', () => {
    assert.equal(check({ capacity: '1' }).ok, true);
    assert.equal(check({ capacity: '2147483647' }).ok, true);
    for (const c of ['', '0', '-1', '2.5', '2,5', 'abc', '1e3', '99999999999', '2147483648']) {
      const r = check({ capacity: c });
      assert.equal(r.ok, false, `lotação ${c}`);
      assert.deepEqual(r.errors, { capacity: EVENT_TEXTS.CAPACITY_INVALID }, `lotação ${c}`);
    }
  });

  test('F02-AC03: formatos de preço aceitos', () => {
    const cases = { '100': 10000, '100,00': 10000, '100.00': 10000, 'R$ 100,00': 10000, '150,5': 15050, 'R$100': 10000, '0,01': 1 };
    for (const [input, cents] of Object.entries(cases)) {
      const r = check({ price: input });
      assert.equal(r.ok, true, `preço ${input}`);
      assert.equal(r.value.priceCents, cents, `preço ${input}`);
    }
  });

  test('F02-AC03: formatos de preço rejeitados', () => {
    for (const p of ['1.234,56', '10,123', 'abc', '-5', '0', '0,00', '', '100,', ',50', '99999999999', '1 000']) {
      const r = check({ price: p });
      assert.equal(r.ok, false, `preço ${p}`);
      assert.deepEqual(r.errors, { price: EVENT_TEXTS.PRICE_INVALID }, `preço ${p}`);
    }
  });

  test('F02-AC11: início estritamente no futuro (agora ± 1 min, igual a agora, ontem)', () => {
    assert.equal(check({ startsAt: dtl(plus(1)) }).ok, true);
    assert.equal(check({ startsAt: dtl(plus(1), true) }).ok, true);
    for (const s of [dtl(plus(-1)), dtl(NOW), dtl(NOW, true), dtl(plus(-24 * 60))]) {
      assert.deepEqual(check({ startsAt: s }).errors, { startsAt: EVENT_TEXTS.STARTS_AT_PAST }, s);
    }
  });

  test('F02-AC02: início vazio ou mal formado', () => {
    for (const s of ['', 'amanhã', '2030-02-30T10:00', '2030-13-01T10:00', '2030-06-16 10:00', '2030-06-16T25:00', '2030-06-16']) {
      assert.deepEqual(check({ startsAt: s }).errors, { startsAt: EVENT_TEXTS.STARTS_AT_INVALID }, s);
    }
  });

  test('F02-AC11: datetime-local é interpretado no fuso do processo', () => {
    const r = check({ startsAt: '2031-12-05T21:00' });
    assert.equal(r.ok, true);
    assert.equal(r.value.startsAt.getTime(), new Date(2031, 11, 5, 21, 0, 0).getTime());
    assert.equal(toDatetimeLocalValue(r.value.startsAt), '2031-12-05T21:00');
  });

  test('F02-AC02: corpo vazio acumula todos os erros e devolve valores para reexibir', () => {
    const r = validateEventInput({}, { now: NOW });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, {
      name: EVENT_TEXTS.NAME_REQUIRED,
      venue: EVENT_TEXTS.VENUE_REQUIRED,
      startsAt: EVENT_TEXTS.STARTS_AT_INVALID,
      capacity: EVENT_TEXTS.CAPACITY_INVALID,
      price: EVENT_TEXTS.PRICE_INVALID,
    });
    assert.deepEqual(r.values, { name: '', startsAt: '', venue: '', capacity: '', price: '' });
    assert.equal(validateEventInput(undefined, { now: NOW }).ok, false);
    // valores não-string (ex.: campo repetido vira array) são tratados como vazios
    assert.equal(check({ name: ['a', 'b'] }).errors.name, EVENT_TEXTS.NAME_REQUIRED);
    const r2 = check({ name: ' Mantido ', capacity: '0' });
    assert.equal(r2.values.name, 'Mantido');
  });

  test('F02: centsToInput e eventToFormValues fazem ida e volta pela validação', () => {
    assert.equal(centsToInput(123456), '1234,56');
    assert.equal(centsToInput(10000), '100,00');
    assert.equal(centsToInput(15050), '150,50');
    assert.equal(centsToInput(5), '0,05');
    const startsAt = plus(60);
    const values = eventToFormValues({ name: 'X', venue: 'Y', starts_at: startsAt, capacity: 7, price_cents: 123456 });
    const r = validateEventInput(values, { now: NOW });
    assert.equal(r.ok, true);
    assert.equal(r.value.priceCents, 123456);
    assert.equal(r.value.capacity, 7);
    assert.equal(r.value.startsAt.getTime(), startsAt.getTime());
  });
});
