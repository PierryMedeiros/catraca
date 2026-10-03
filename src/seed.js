'use strict';

const bcrypt = require('bcryptjs');
const { newId } = require('./ids');

// Contas da seed (PRD, seção 10). Senha de todas: catraca123.
const SEED_PASSWORD = 'catraca123';
const SEED_USERS = [
  { email: 'org.a@catraca.local', name: 'Organizador A', role: 'organizer' },
  { email: 'org.b@catraca.local', name: 'Organizador B', role: 'organizer' },
  { email: 'participante@catraca.local', name: 'Participante Seed', role: 'participant' },
];

/** Idempotente: ON CONFLICT (email) DO NOTHING não altera contas existentes. */
async function runSeed(pool, { log = () => {} } = {}) {
  let created = 0;
  for (const u of SEED_USERS) {
    const hash = await bcrypt.hash(SEED_PASSWORD, 10);
    const { rowCount } = await pool.query(
      `INSERT INTO users (id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING`,
      [newId('usr'), u.name, u.email, hash, u.role]
    );
    created += rowCount;
  }
  log(`seed: ${created} conta(s) criada(s), ${SEED_USERS.length - created} já existia(m)`);
  return created;
}

module.exports = { runSeed, SEED_USERS, SEED_PASSWORD };

if (require.main === module) {
  const { pool } = require('./db');
  const { runMigrations } = require('./migrate');
  runMigrations(pool, { log: console.log })
    .then(() => runSeed(pool, { log: console.log }))
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
