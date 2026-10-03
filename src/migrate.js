'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');
const FILE_RE = /^\d{3}_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 727001;

function listMigrationFiles(dir = MIGRATIONS_DIR) {
  return fs
    .readdirSync(dir)
    .filter((f) => FILE_RE.test(f))
    .sort();
}

/**
 * Aplica, em ordem, os arquivos db/migrations/NNN_nome.sql ainda não registrados
 * em schema_migrations. Cada arquivo roda na sua própria transação. Um advisory
 * lock serializa processos concorrentes (ex.: arquivos de teste).
 */
async function runMigrations(pool, { dir = MIGRATIONS_DIR, log = () => {} } = {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           version    text PRIMARY KEY,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`
      );
      const { rows } = await client.query('SELECT version FROM schema_migrations');
      const applied = new Set(rows.map((r) => r.version));
      const pending = listMigrationFiles(dir).filter((f) => !applied.has(f));
      for (const file of pending) {
        const sql = fs.readFileSync(path.join(dir, file), 'utf8');
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
          await client.query('COMMIT');
          log(`migração aplicada: ${file}`);
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          err.message = `migração ${file} falhou: ${err.message}`;
          throw err;
        }
      }
      return pending;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    }
  } finally {
    client.release();
  }
}

module.exports = { runMigrations, listMigrationFiles, MIGRATIONS_DIR };
