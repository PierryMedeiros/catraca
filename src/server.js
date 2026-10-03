'use strict';

const { pool } = require('./db');
const { runMigrations } = require('./migrate');
const { runSeed } = require('./seed');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;

async function main() {
  // /health só responde depois do listen: 200 implica migrações e seed concluídas.
  await runMigrations(pool, { log: console.log });
  await runSeed(pool, { log: console.log });

  const server = createApp().listen(PORT, () => {
    console.log(`listening on ${PORT} (TZ=${process.env.TZ || 'padrão do sistema'})`);
  });
  // F03: startGatewayWorker()

  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} recebido, encerrando`);
    const force = setTimeout(() => process.exit(0), 3000);
    force.unref();
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    server.closeAllConnections?.();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('falha na inicialização:', err);
  process.exit(1);
});
