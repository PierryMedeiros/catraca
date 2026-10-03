'use strict';

// Formatação de dinheiro e datas. Datas usam o fuso do processo (TZ).

const pad2 = (n) => String(n).padStart(2, '0');

/** Centavos inteiros -> 'R$ 1.234,56' (espaço ASCII após R$, sem Intl). */
function formatBRL(cents) {
  const n = Math.round(Number(cents) || 0);
  const negative = n < 0;
  const abs = Math.abs(n);
  const reais = Math.floor(abs / 100);
  const centavos = abs % 100;
  const milhar = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}R$ ${milhar},${pad2(centavos)}`;
}

const BRL_RE = /^(\d{1,7})(?:[.,](\d{1,2}))?$/;

/**
 * Texto digitado em reais -> centavos inteiros > 0, ou null.
 * Aceita 'R$' opcional, espaços, vírgula ou ponto decimal, até 2 casas,
 * sem separador de milhar.
 */
function parseBRL(str) {
  if (typeof str !== 'string') return null;
  const s = str.replace(/r\$/gi, '').replace(/\s+/g, '');
  const m = BRL_RE.exec(s);
  if (!m) return null;
  const reais = parseInt(m[1], 10);
  const frac = m[2] ? (m[2].length === 1 ? `${m[2]}0` : m[2]) : '00';
  const cents = reais * 100 + parseInt(frac, 10);
  return cents > 0 ? cents : null;
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

/** 'dd/mm/aaaa HH:mm' no fuso local. */
function formatDateTime(date) {
  const d = toDate(date);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** ISO 8601 local com offset ±HH:MM, sem milissegundos (UTC -> +00:00). */
function toIsoWithOffset(date) {
  const d = toDate(date);
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const offset = `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${offset}`
  );
}

const DTL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Valor de <input type="datetime-local"> -> Date no fuso local, ou null. */
function parseDateTimeLocal(str) {
  if (typeof str !== 'string') return null;
  const m = DTL_RE.exec(str.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map((v) => (v === undefined ? 0 : parseInt(v, 10)));
  const date = new Date(y, mo - 1, d, h, mi, s, 0);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d ||
    date.getHours() !== h ||
    date.getMinutes() !== mi ||
    date.getSeconds() !== s
  ) {
    return null;
  }
  return date;
}

/** Date -> 'AAAA-MM-DDTHH:mm' local (para preencher formulários). */
function toDateTimeLocalValue(date) {
  const d = toDate(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

module.exports = {
  formatBRL,
  parseBRL,
  formatDateTime,
  toIsoWithOffset,
  parseDateTimeLocal,
  toDateTimeLocalValue,
};
