'use strict';

const bcrypt = require('bcryptjs');
const { query } = require('../../db');
const { newId } = require('../../ids');
const { hashPassword, verifyPassword } = require('../../auth');
const messages = require('../../messages');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;

// Hash fixo usado quando o e-mail não existe, para o login levar o mesmo tempo.
const DUMMY_HASH = bcrypt.hashSync('catraca-hash-de-referencia', 10);

function str(v) {
  return typeof v === 'string' ? v : '';
}

function normalizeEmail(email) {
  return str(email).trim().toLowerCase();
}

/** Normaliza e valida o formulário de cadastro. Só lê name, email e password. */
function validateSignup(form) {
  const input = form || {};
  const data = {
    name: str(input.name).trim(),
    email: normalizeEmail(input.email),
    password: str(input.password),
  };
  const errors = [];
  if (!data.name) errors.push(messages.AUTH.NAME_REQUIRED);
  if (!EMAIL_RE.test(data.email)) errors.push(messages.AUTH.EMAIL_INVALID);
  if (data.password.length < MIN_PASSWORD) errors.push(messages.AUTH.PASSWORD_TOO_SHORT);
  return { data, errors };
}

async function emailExists(email) {
  const { rows } = await query('SELECT 1 FROM users WHERE email = $1', [email]);
  return rows.length > 0;
}

/**
 * Cria uma conta de participante. Retorna {ok:true, user} ou {ok:false, errors}.
 * O papel é sempre participante: não existe cadastro de organizador.
 * A unicidade do e-mail é garantida pela restrição UNIQUE (23505 vira o mesmo erro).
 */
async function createParticipant(form) {
  const { data, errors } = validateSignup(form);
  if (EMAIL_RE.test(data.email) && (await emailExists(data.email))) {
    errors.push(messages.AUTH.EMAIL_TAKEN);
  }
  if (errors.length) return { ok: false, errors, data };

  const id = newId('usr');
  const passwordHash = await hashPassword(data.password);
  try {
    const { rows } = await query(
      `INSERT INTO users (id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'participant')
       RETURNING id, name, email, role`,
      [id, data.name, data.email, passwordHash]
    );
    return { ok: true, user: rows[0] };
  } catch (err) {
    if (err.code === '23505') {
      return { ok: false, errors: [messages.AUTH.EMAIL_TAKEN], data };
    }
    throw err;
  }
}

/** Retorna {id, name, email, role} se e-mail e senha conferem; senão null. */
async function authenticate(email, password) {
  const normalized = normalizeEmail(email);
  const pass = str(password);
  const { rows } = normalized
    ? await query('SELECT id, name, email, role, password_hash FROM users WHERE email = $1', [normalized])
    : { rows: [] };
  const row = rows[0];
  const ok = await verifyPassword(pass, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok || !pass) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

module.exports = { validateSignup, createParticipant, authenticate, normalizeEmail, EMAIL_RE };
