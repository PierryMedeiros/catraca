'use strict';

// Seções "Check-in" e "Painel" da página de gestão (spec F05 §3.1). A marcação
// faz parte do contrato de avaliação: cada <p id="checkin-..."> e cada par
// <dt>/<dd data-metric> sai numa única linha, exatamente neste formato.

const { escapeHtml } = require('../../views/layout');
const { formatBRL } = require('../../format');
const { getEventDashboard } = require('./dashboard');
const { CHECKIN_RESULTS, checkinMessage } = require('./service');

// Rótulos do painel (tabela de R12). Não são mensagens de messages.js.
const DASHBOARD_ROWS = Object.freeze([
  { label: 'Confirmados', metric: 'confirmed', value: (d) => String(d.confirmed) },
  { label: 'Pendentes', metric: 'pending', value: (d) => String(d.pending) },
  { label: 'Check-ins', metric: 'checkins', value: (d) => String(d.checkIns) },
  { label: 'Vagas disponíveis', metric: 'available', value: (d) => String(d.available) },
  { label: 'Receita', metric: 'revenue', value: (d) => formatBRL(d.revenueCents) },
  { label: 'Estornados', metric: 'refunded', value: (d) => String(d.refunded) },
]);

/** Código para exibição: já normalizado; quebras de linha viram espaço (linha única). */
function displayCode(code) {
  return String(code ?? '').replace(/[\r\n\t\f\v]+/g, ' ');
}

/**
 * HTML de section#checkin. ctx.checkin = { result, code } só na resposta do
 * POST de check-in. Em evento cancelado, o aviso vem antes do formulário e o
 * campo continua ativo (PRD §11).
 */
function renderCheckinSection(event, ctx = {}) {
  const id = escapeHtml(event.id);
  const lines = ['<section id="checkin">', '  <h2>Check-in</h2>'];
  if (event.status === 'cancelled') {
    lines.push(`  <p id="checkin-event-cancelled">${escapeHtml(checkinMessage(CHECKIN_RESULTS.EVENT_CANCELLED))}</p>`);
  }
  const checkin = ctx && ctx.checkin;
  if (checkin && checkin.result) {
    lines.push(
      `  <p id="checkin-result" data-result="${escapeHtml(checkin.result)}">${escapeHtml(checkinMessage(checkin.result))}</p>`,
      `  <p id="checkin-code">Código informado: ${escapeHtml(displayCode(checkin.code))}</p>`
    );
  }
  lines.push(
    `  <form method="post" action="/org/events/${id}/checkin">`,
    '    <label for="checkin-code-input">Código do ingresso</label>',
    '    <input id="checkin-code-input" name="code" type="text" autocomplete="off" autofocus>',
    '    <button type="submit">Fazer check-in</button>',
    '  </form>',
    '</section>'
  );
  return lines.join('\n');
}

/** HTML de section#painel com os seis números de R12. */
function renderDashboardSection(dashboard) {
  const rows = DASHBOARD_ROWS.map(
    (r) => `    <dt>${escapeHtml(r.label)}</dt><dd data-metric="${r.metric}">${escapeHtml(r.value(dashboard))}</dd>`
  );
  return ['<section id="painel">', '  <h2>Painel</h2>', '  <dl>', ...rows, '  </dl>', '</section>'].join('\n');
}

/** Carrega o painel e devolve as duas seções (Check-in, depois Painel). */
async function renderManageSections(client, event, ctx = {}) {
  const dashboard = await getEventDashboard(client, event.id);
  return `${renderCheckinSection(event, ctx)}\n${renderDashboardSection(dashboard)}`;
}

module.exports = {
  DASHBOARD_ROWS,
  renderCheckinSection,
  renderDashboardSection,
  renderManageSections,
};
