'use strict';

// F03: registra a vitrine, a compra e "Meus ingressos" e inicia o worker do
// gateway simulado (idempotente: um por processo do app).

const routes = require('./routes');
const { startGatewayWorker } = require('../gateway/worker');

function registerPurchases(app) {
  app.use(routes);
  startGatewayWorker();
  return app;
}

module.exports = { registerPurchases };
