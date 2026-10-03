'use strict';

// F05: registra a rota de check-in e as seções "Check-in" (order 200) e
// "Painel" (order 300) no mecanismo de seções da página de gestão de F02.

const { registerManageSection } = require('../events/views');
const { checkinRouter } = require('./routes');
const { getEventDashboard } = require('./dashboard');
const { renderCheckinSection, renderDashboardSection } = require('./views');

function registerCheckinFeature(app) {
  app.use(checkinRouter);
  registerManageSection({
    key: 'checkin',
    order: 200,
    render: async ({ event, context }) => renderCheckinSection(event, context),
  });
  registerManageSection({
    key: 'painel',
    order: 300,
    render: async ({ client, event }) => renderDashboardSection(await getEventDashboard(client, event.id)),
  });
  return app;
}

module.exports = { registerCheckinFeature };
