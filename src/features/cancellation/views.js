'use strict';

// Seção "Cancelamento" da página de gestão e página de erro 409 (spec F06 §3.3, §4).

const { escapeHtml, sendPage } = require('../../views/layout');
const { formatDateTime } = require('../../format');
const { CANCEL_TEXTS } = require('./texts');

/**
 * HTML da seção conforme o status do evento: publicado -> botão com
 * confirmação; cancelado -> aviso com a data; rascunho -> ''. O texto do
 * confirm() é fixo (nenhum dado do evento dentro do JavaScript).
 */
function renderCancelSection(event) {
  if (!event) return '';
  const id = escapeHtml(event.id);
  if (event.status === 'published') {
    return `<section id="cancelamento">
  <h2>${escapeHtml(CANCEL_TEXTS.sectionTitle)}</h2>
  <p>${escapeHtml(CANCEL_TEXTS.warning)}</p>
  <form method="post" action="/org/events/${id}/cancel" onsubmit="return confirm('${escapeHtml(CANCEL_TEXTS.confirm)}')">
    <button type="submit">${escapeHtml(CANCEL_TEXTS.button)}</button>
  </form>
</section>`;
  }
  if (event.status === 'cancelled') {
    const when = event.cancelled_at ? formatDateTime(event.cancelled_at) : '';
    return `<section id="cancelamento">
  <h2>${escapeHtml(CANCEL_TEXTS.sectionTitle)}</h2>
  <p>${escapeHtml(CANCEL_TEXTS.cancelledAt(when))}</p>
</section>`;
  }
  return '';
}

/** 409 com layout: mensagem + link de volta à gestão do evento. */
function renderCancelError(res, { user, eventId, message }) {
  const body = `<h1>${escapeHtml(CANCEL_TEXTS.errorTitle)}</h1>
<p class="erro errors">${escapeHtml(message)}</p>
<p><a href="/org/events/${escapeHtml(eventId)}">${escapeHtml(CANCEL_TEXTS.backToEvent)}</a></p>`;
  return sendPage({ user: user || null }, res, { status: 409, title: CANCEL_TEXTS.errorTitle, body });
}

module.exports = { renderCancelSection, renderCancelError };
