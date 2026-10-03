'use strict';

// Worker persistente do gateway simulado (spec F03 §4; PRD §10; AGENTS.md regra 6).
// A compra grava gateway_outcome e gateway_due_at no ingresso; este worker, no
// processo do app, procura ingressos pending vencidos e aplica a resposta com
// UPDATE condicional (WHERE status = 'pending'): ingresso cancelado/estornado
// por F06 nunca é sobrescrito por resposta tardia (R11). Como o vencimento está
// no banco, reiniciar o app não perde respostas: o primeiro ciclo roda na
// subida e resolve o que venceu enquanto o app estava parado.

const { pool } = require('../../db');
const { readDelayMs } = require('./simulator');

const DEFAULT_POLL_MS = 500;
const BATCH_SIZE = 200;

const OUTCOME_TO_STATUS = Object.freeze({ approved: 'confirmed', declined: 'declined' });

/**
 * Um ciclo: resolve até BATCH_SIZE ingressos pending com gateway_due_at <= now().
 * Retorna quantos ingressos mudaram de status.
 */
async function resolveDueTickets(client = pool) {
  const { rows } = await client.query(
    `SELECT id, gateway_outcome FROM tickets
      WHERE status = 'pending' AND gateway_due_at <= now()
      ORDER BY gateway_due_at
      LIMIT ${BATCH_SIZE}`
  );
  let changed = 0;
  for (const row of rows) {
    const status = OUTCOME_TO_STATUS[row.gateway_outcome] || 'declined';
    const r = await client.query(
      "UPDATE tickets SET status = $2, updated_at = now() WHERE id = $1 AND status = 'pending'",
      [row.id, status]
    );
    changed += r.rowCount;
  }
  return changed;
}

function poolClosing() {
  return Boolean(pool.ending || pool.ended);
}

let current = null;

/**
 * Inicia o worker (idempotente: a segunda chamada devolve o mesmo controle).
 * Primeiro ciclo imediato; os seguintes a cada GATEWAY_POLL_MS (padrão 500 ms),
 * com setTimeout encadeado (ciclos nunca se sobrepõem). Timers com unref():
 * o worker não segura o processo vivo sozinho. Erros são logados e o próximo
 * ciclo segue. Para quando o pool é encerrado. -> { stop() }
 */
function startGatewayWorker() {
  if (current) return current;
  let timer = null;
  let stopped = false;

  const handle = {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (current === handle) current = null;
    },
  };

  async function cycle() {
    timer = null;
    if (stopped) return;
    if (poolClosing()) return handle.stop();
    try {
      await resolveDueTickets(pool);
    } catch (err) {
      if (poolClosing()) return handle.stop();
      console.error('gateway worker:', err.message);
    }
    if (stopped) return;
    timer = setTimeout(cycle, readDelayMs('GATEWAY_POLL_MS', DEFAULT_POLL_MS));
    timer.unref();
  }

  current = handle;
  cycle();
  return handle;
}

module.exports = { startGatewayWorker, resolveDueTickets, DEFAULT_POLL_MS };
