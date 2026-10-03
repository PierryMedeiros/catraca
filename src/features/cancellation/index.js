'use strict';

// F06: registra a rota de cancelamento e a seção "Cancelamento" (order 400) na
// página de gestão de F02.

const { registerManageSection } = require('../events/views');
const { cancellationRouter } = require('./routes');
const { renderCancelSection } = require('./views');

function registerCancellationFeature(app) {
  app.use(cancellationRouter);
  registerManageSection({ key: 'cancelamento', order: 400, render: async ({ event }) => renderCancelSection(event) });
  return app;
}

module.exports = { registerCancellationFeature };
