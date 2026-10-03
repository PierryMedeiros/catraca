'use strict';

// Telas da área do organizador (spec, seção 6) e ponto de extensão da página
// de gestão (seção 6.4): F05 (check-in, painel) e F06 (cancelar) registram
// seções com registerManageSection, sem editar este arquivo.

const { pool } = require('../../db');
const { escapeHtml, sendPage, sendError } = require('../../views/layout');
const { formatBRL, formatDateTime } = require('../../format');
const { EVENT_TEXTS, EVENT_STATUS_LABELS } = require('./texts');
const { eventToFormValues } = require('./validation');

// ---------------------------------------------------------------------------
// Seções extensíveis da página de gestão
// ---------------------------------------------------------------------------

const manageSections = new Map();

/**
 * Registra (ou substitui, pela key) uma seção da página de gestão.
 * order: F02 usa < 100; sugestão F05 check-in 200, painel 300; F06 cancelar 400.
 * render: async ({ client, event, user, context }) => HTML já escapado ('' oculta).
 */
function registerManageSection({ key, order, render }) {
  if (typeof key !== 'string' || !key) throw new TypeError('registerManageSection: key obrigatória');
  if (typeof render !== 'function') throw new TypeError('registerManageSection: render obrigatório');
  manageSections.set(key, { key, order: Number(order) || 0, render });
}

/** Remove uma seção registrada (útil em testes). */
function unregisterManageSection(key) {
  manageSections.delete(key);
}

function listManageSections() {
  return [...manageSections.values()].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

async function renderManageSections({ client, event, user, context }) {
  const parts = [];
  for (const section of listManageSections()) {
    const html = await section.render({ client, event, user, context });
    if (html) parts.push(html);
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Pedaços de formulário
// ---------------------------------------------------------------------------

function fieldError(errors, key) {
  return errors && errors[key] ? `<p class="errors">${escapeHtml(errors[key])}</p>` : '';
}

function formTop(errors) {
  return errors && Object.keys(errors).length > 0 ? `<p class="errors">${escapeHtml(EVENT_TEXTS.FORM_INVALID)}</p>` : '';
}

function eventFields(values = {}, errors = {}) {
  const v = (k) => escapeHtml(values[k] ?? '');
  return `  <label>Nome <input type="text" name="name" value="${v('name')}" required></label>
  ${fieldError(errors, 'name')}
  <label>Início <input type="datetime-local" name="startsAt" value="${v('startsAt')}" required></label>
  ${fieldError(errors, 'startsAt')}
  <label>Local <input type="text" name="venue" value="${v('venue')}" required></label>
  ${fieldError(errors, 'venue')}
  <label>Lotação <input type="number" name="capacity" min="1" step="1" value="${v('capacity')}" required></label>
  ${fieldError(errors, 'capacity')}
  <label>Preço (R$) <input type="text" name="price" placeholder="100,00" value="${v('price')}" required></label>
  ${fieldError(errors, 'price')}`;
}

function statusLabel(status) {
  return EVENT_STATUS_LABELS[status] || status;
}

// ---------------------------------------------------------------------------
// Páginas
// ---------------------------------------------------------------------------

/** "Meus eventos": só os eventos recebidos (o chamador filtra pelo dono). */
function renderEventsList({ events }) {
  const rows = events
    .map(
      (e) => `    <tr>
      <td><a href="/org/events/${escapeHtml(e.id)}">${escapeHtml(e.name)}</a></td>
      <td>${escapeHtml(formatDateTime(e.starts_at))}</td>
      <td>${escapeHtml(statusLabel(e.status))}</td>
    </tr>`
    )
    .join('\n');
  const table = events.length
    ? `<table>
  <thead><tr><th>Nome</th><th>Início</th><th>Status</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>`
    : `<p>${escapeHtml(EVENT_TEXTS.EMPTY_LIST)}</p>`;
  return `<h1>Meus eventos</h1>
<p><a href="/org/events/new">Novo evento</a></p>
${table}`;
}

function renderNewEventForm({ values = {}, errors = {} } = {}) {
  return `<h1>Novo evento</h1>
${formTop(errors)}
<form method="post" action="/org/events">
${eventFields(values, errors)}
  <button type="submit">Criar evento</button>
</form>
<p><a href="/org/events">Voltar para meus eventos</a></p>`;
}

/** Corpo da página de gestão (spec 6.3), sem as seções extensíveis. */
function renderManageHead({ event, editErrors, editValues, notice }) {
  const id = escapeHtml(event.id);
  const parts = [
    `<h1>${escapeHtml(event.name)}</h1>
<p class="status">Status: ${escapeHtml(statusLabel(event.status))}</p>`,
  ];
  if (notice) parts.push(`<p class="notice">${escapeHtml(notice)}</p>`);
  parts.push(`<section data-section="dados">
  <h2>Dados</h2>
  <dl>
    <dt>Início</dt><dd>${escapeHtml(formatDateTime(event.starts_at))}</dd>
    <dt>Local</dt><dd>${escapeHtml(event.venue)}</dd>
    <dt>Lotação</dt><dd>${escapeHtml(event.capacity)}</dd>
    <dt>Preço</dt><dd>${escapeHtml(formatBRL(event.price_cents))}</dd>
  </dl>
</section>`);

  if (event.status === 'cancelled') {
    if (notice !== EVENT_TEXTS.CANCELLED_LOCKED) {
      parts.push(`<p class="notice">${escapeHtml(EVENT_TEXTS.CANCELLED_LOCKED)}</p>`);
    }
    return parts.join('\n');
  }

  if (event.status === 'draft') {
    parts.push(`<section data-section="publicar">
  <form method="post" action="/org/events/${id}/publish">
    <button type="submit">Publicar</button>
  </form>
</section>`);
  }

  const values = editValues || eventToFormValues(event);
  parts.push(`<section data-section="editar">
  <h2>Editar evento</h2>
  ${formTop(editErrors)}
  <form method="post" action="/org/events/${id}/edit">
${eventFields(values, editErrors || {})}
    <button type="submit">Salvar alterações</button>
  </form>
</section>`);
  return parts.join('\n');
}

/**
 * Envia a página de gestão completa com as seções registradas.
 * Usada por GET /org/events/:id, pelos 422/409 de F02 e por F05/F06.
 */
async function sendManagePage(req, res, { event, status = 200, context = {}, editErrors, editValues, notice } = {}) {
  const head = renderManageHead({ event, editErrors, editValues, notice });
  const sections = await renderManageSections({ client: pool, event, user: req.user || null, context });
  const body = `${head}
${sections}
<p><a href="/org/events">Voltar para meus eventos</a></p>`;
  return sendPage(req, res, { status, title: event.name, body });
}

/** 404 padrão de evento: idêntico para inexistente e de outro organizador (R13). */
function sendEventNotFound(req, res) {
  return sendError(req, res, 404, EVENT_TEXTS.NOT_FOUND);
}

module.exports = {
  registerManageSection,
  unregisterManageSection,
  listManageSections,
  sendManagePage,
  sendEventNotFound,
  renderEventsList,
  renderNewEventForm,
  renderManageHead,
};
