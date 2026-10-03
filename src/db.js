'use strict';

const pg = require('pg');

// bigint (count(*), sum(integer)) chega como number; timestamptz chega como Date.
pg.types.setTypeParser(20, (v) => parseInt(v, 10));

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://catraca:catraca@localhost:5432/catraca',
});

pool.on('error', (err) => {
  console.error('pg pool error:', err.message);
});

function query(text, params) {
  return pool.query(text, params);
}

/**
 * Executa fn(client) dentro de BEGIN/COMMIT. Em exceção faz ROLLBACK e relança.
 * Não aplica trava nenhuma: quem altera vagas chama lockEvent(client, id) como
 * primeiro comando dentro de fn (AGENTS.md, regra 5).
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('rollback failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
