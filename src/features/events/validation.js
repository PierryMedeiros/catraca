'use strict';

// Validação de entrada de evento (R01; spec, seção 5).

const { parseBRL, parseDateTimeLocal, toDateTimeLocalValue } = require('../../format');
const { EVENT_TEXTS } = require('./texts');

const INT_MAX = 2147483647; // limite do tipo integer do Postgres
const CAPACITY_RE = /^\d+$/;
const PRICE_RE = /^(R\$\s*)?\d+([.,]\d{1,2})?$/;
const FIELDS = ['name', 'startsAt', 'venue', 'capacity', 'price'];

/** Valor de formulário -> string com trim. Ausente, array ou objeto -> ''. */
function fieldValue(form, key) {
  const v = form ? form[key] : undefined;
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function parseCapacity(str) {
  if (!CAPACITY_RE.test(str)) return null;
  const n = Number(str);
  return Number.isSafeInteger(n) && n >= 1 && n <= INT_MAX ? n : null;
}

function parsePrice(str) {
  if (!PRICE_RE.test(str)) return null;
  let cents;
  try {
    cents = parseBRL(str);
  } catch {
    return null;
  }
  return Number.isSafeInteger(cents) && cents > 0 && cents <= INT_MAX ? cents : null;
}

/**
 * Valida o formulário de evento. Coleta todos os erros.
 * -> { ok: true, value: { name, venue, startsAt: Date, capacity, priceCents }, values }
 * -> { ok: false, errors: { campo: texto }, values: { name, startsAt, venue, capacity, price } }
 * O início precisa ser estritamente posterior a `now` (no fuso do processo, TZ).
 */
function validateEventInput(form, { now = new Date() } = {}) {
  const values = {};
  for (const key of FIELDS) values[key] = fieldValue(form, key);

  const errors = {};
  if (!values.name) errors.name = EVENT_TEXTS.NAME_REQUIRED;
  if (!values.venue) errors.venue = EVENT_TEXTS.VENUE_REQUIRED;

  const startsAt = parseDateTimeLocal(values.startsAt);
  if (!startsAt) errors.startsAt = EVENT_TEXTS.STARTS_AT_INVALID;
  else if (!(startsAt.getTime() > now.getTime())) errors.startsAt = EVENT_TEXTS.STARTS_AT_PAST;

  const capacity = parseCapacity(values.capacity);
  if (capacity === null) errors.capacity = EVENT_TEXTS.CAPACITY_INVALID;

  const priceCents = parsePrice(values.price);
  if (priceCents === null) errors.price = EVENT_TEXTS.PRICE_INVALID;

  if (Object.keys(errors).length > 0) return { ok: false, errors, values };
  return {
    ok: true,
    value: { name: values.name, venue: values.venue, startsAt, capacity, priceCents },
    values,
  };
}

/** Date -> 'AAAA-MM-DDTHH:mm' no fuso local (pré-preenche o datetime-local). */
function toDatetimeLocalValue(date) {
  return toDateTimeLocalValue(date);
}

/** Centavos -> '1234,56' (sem R$ nem milhar), aceito de volta por validateEventInput. */
function centsToInput(cents) {
  const n = Math.round(Number(cents) || 0);
  return `${Math.floor(n / 100)},${String(n % 100).padStart(2, '0')}`;
}

/** Linha de events -> valores do formulário de edição. */
function eventToFormValues(event) {
  return {
    name: event.name,
    startsAt: toDatetimeLocalValue(event.starts_at),
    venue: event.venue,
    capacity: String(event.capacity),
    price: centsToInput(event.price_cents),
  };
}

module.exports = { validateEventInput, toDatetimeLocalValue, centsToInput, eventToFormValues };
