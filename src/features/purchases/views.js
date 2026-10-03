'use strict';

// Telas da vitrine, da página pública do evento e de "Meus ingressos" (spec F03 §3).
// Cada evento da vitrine e cada ingresso fica numa única linha de HTML, com os
// marcadores estáveis da spec (li.event[data-event-id], p.seats, .sold-out,
// tr.ticket[data-ticket-id], td.ticket-status[data-status], td.ticket-code).

const messages = require('../../messages');
const { escapeHtml, sendPage, sendError } = require('../../views/layout');
const { formatBRL, formatDateTime } = require('../../format');

const CARD_INVALID_MESSAGE = 'Número do cartão inválido: informe os 16 dígitos.';

const TEXTS = Object.freeze({
  STOREFRONT_TITLE: 'Eventos à venda',
  STOREFRONT_EMPTY: 'Nenhum evento à venda no momento.',
  LOGIN_TO_BUY: 'Entrar para comprar',
  ORGANIZER_HINT: 'Somente participantes compram ingressos.',
  MY_TICKETS_TITLE: 'Meus ingressos',
  MY_TICKETS_EMPTY: 'Você ainda não comprou ingressos.',
  EVENT_PAGE_TITLE: 'Evento',
  seats: (n) => `Vagas disponíveis: ${n}`,
});

function soldOut(stats) {
  return !stats || stats.available <= 0;
}

function storefrontItem(event, stats) {
  const id = escapeHtml(event.id);
  const sold = soldOut(stats) ? ` · <span class="sold-out">${escapeHtml(messages.SOLD_OUT)}</span>` : '';
  return (
    `<li class="event" data-event-id="${id}"><a href="/events/${id}">${escapeHtml(event.name)}</a>` +
    ` · <span class="starts-at">${escapeHtml(formatDateTime(event.starts_at))}</span>` +
    ` · <span class="venue">${escapeHtml(event.venue)}</span>` +
    ` · <span class="price">${escapeHtml(formatBRL(event.price_cents))}</span>${sold}</li>`
  );
}

/** Vitrine (GET /). items = [{ event, stats }]. */
function storefrontBody({ user, items }) {
  const parts = [`<h1>${escapeHtml(TEXTS.STOREFRONT_TITLE)}</h1>`];
  if (user && user.role === 'participant') {
    parts.push(`<p><a href="/me/tickets">${escapeHtml(TEXTS.MY_TICKETS_TITLE)}</a></p>`);
  }
  if (items.length === 0) {
    parts.push(`<p class="empty">${escapeHtml(TEXTS.STOREFRONT_EMPTY)}</p>`);
  } else {
    parts.push(`<ul class="events">\n${items.map(({ event, stats }) => storefrontItem(event, stats)).join('\n')}\n</ul>`);
  }
  return parts.join('\n');
}

/** Bloco de compra: exatamente um dos casos, nesta ordem (spec §3). */
function buyBlock({ event, stats, user }) {
  const id = escapeHtml(event.id);
  if (soldOut(stats)) return `<p class="sold-out">${escapeHtml(messages.SOLD_OUT)}</p>`;
  if (!user) {
    return `<p><a class="login-to-buy" href="/login?next=/events/${id}">${escapeHtml(TEXTS.LOGIN_TO_BUY)}</a></p>`;
  }
  if (user.role === 'participant') {
    return (
      `<form method="post" action="/events/${id}/purchase">` +
      '<label>Número do cartão <input name="cardNumber" inputmode="numeric" autocomplete="cc-number" required></label>' +
      '<button type="submit">Comprar</button></form>'
    );
  }
  return `<p class="buy-hint">${escapeHtml(TEXTS.ORGANIZER_HINT)}</p>`;
}

/** Página pública do evento (GET /events/:id e respostas 409/422 da compra). */
function eventBody({ event, stats, user, error }) {
  const available = stats ? stats.available : 0;
  return [
    `<h1>${escapeHtml(event.name)}</h1>`,
    `<p class="starts-at">${escapeHtml(formatDateTime(event.starts_at))}</p>`,
    `<p class="venue">${escapeHtml(event.venue)}</p>`,
    `<p class="price">${escapeHtml(formatBRL(event.price_cents))}</p>`,
    `<p class="seats">${escapeHtml(TEXTS.seats(available))}</p>`,
    error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : '',
    buyBlock({ event, stats, user }),
    '<p><a href="/">Voltar para a vitrine</a></p>',
  ]
    .filter(Boolean)
    .join('\n');
}

function ticketRow(t) {
  const status = String(t.status);
  const label = messages.TICKET_STATUS_LABELS[status] || status;
  return (
    `<tr class="ticket" data-ticket-id="${escapeHtml(t.id)}">` +
    `<td class="ticket-event">${escapeHtml(t.event_name)}</td>` +
    `<td class="ticket-starts-at">${escapeHtml(formatDateTime(t.starts_at))}</td>` +
    `<td class="ticket-status" data-status="${escapeHtml(status)}">${escapeHtml(label)}</td>` +
    `<td class="ticket-code">${escapeHtml(String(t.code).trim())}</td>` +
    `<td class="ticket-price">${escapeHtml(formatBRL(t.price_cents))}</td></tr>`
  );
}

/** "Meus ingressos" (GET /me/tickets). */
function myTicketsBody({ tickets }) {
  const parts = [`<h1>${escapeHtml(TEXTS.MY_TICKETS_TITLE)}</h1>`];
  if (tickets.length === 0) {
    parts.push(`<p class="empty">${escapeHtml(TEXTS.MY_TICKETS_EMPTY)}</p>`);
  } else {
    parts.push(`<table class="tickets">
<thead><tr><th>Evento</th><th>Início</th><th>Status</th><th>Código</th><th>Valor</th></tr></thead>
<tbody>
${tickets.map(ticketRow).join('\n')}
</tbody>
</table>`);
  }
  parts.push('<p><a href="/">Ver eventos à venda</a></p>');
  return parts.join('\n');
}

function sendStorefront(req, res, items) {
  return sendPage(req, res, {
    title: TEXTS.STOREFRONT_TITLE,
    body: storefrontBody({ user: req.user || null, items }),
  });
}

// O <title> é genérico: o nome do evento aparece uma única vez na página (no <h1>).
function sendEventPage(req, res, { event, stats, status = 200, error }) {
  return sendPage(req, res, {
    status,
    title: TEXTS.EVENT_PAGE_TITLE,
    body: eventBody({ event, stats, user: req.user || null, error }),
  });
}

/** 422 de cartão inválido quando o evento não está à venda: só a mensagem. */
function sendCardInvalidWithoutEvent(req, res) {
  return sendError(req, res, 422, messages.BAD_REQUEST, CARD_INVALID_MESSAGE);
}

function sendMyTickets(req, res, tickets) {
  res.set('Cache-Control', 'no-store');
  return sendPage(req, res, { title: TEXTS.MY_TICKETS_TITLE, body: myTicketsBody({ tickets }) });
}

/**
 * 404 idêntico para evento inexistente, rascunho, cancelado e id malformado.
 * `Evento não encontrado` aparece uma única vez (no <h1>; o <title> é o genérico).
 */
function sendEventNotFound(req, res) {
  return sendPage(req, res, {
    status: 404,
    title: messages.PAGE_NOT_FOUND,
    body: `<h1>${escapeHtml(messages.EVENT_NOT_FOUND)}</h1>`,
  });
}

module.exports = {
  CARD_INVALID_MESSAGE,
  TEXTS,
  storefrontBody,
  eventBody,
  myTicketsBody,
  sendStorefront,
  sendEventPage,
  sendCardInvalidWithoutEvent,
  sendMyTickets,
  sendEventNotFound,
};
