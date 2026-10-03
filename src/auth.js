'use strict';

const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const { query } = require('./db');
const messages = require('./messages');
const { sendError } = require('./views/layout');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Cookie assinado (catraca_session + catraca_session.sig). Sem assinatura válida = visitante.
const sessionMiddleware = cookieSession({
  name: 'catraca_session',
  keys: [process.env.SESSION_SECRET || 'catraca-sessao-local'],
  httpOnly: true,
  sameSite: 'lax',
  secure: false,
  maxAge: SEVEN_DAYS_MS,
});

/** Define req.user / res.locals.user ({id, name, email, role}) ou null. */
async function loadUser(req, res, next) {
  req.user = null;
  const userId = req.session && req.session.userId;
  if (userId) {
    const { rows } = await query('SELECT id, name, email, role FROM users WHERE id = $1', [String(userId)]);
    if (rows[0]) {
      req.user = rows[0];
    } else {
      req.session = null;
    }
  }
  res.locals.user = req.user;
  next();
}

// Visitante vai ao login com next = caminho pedido, em qualquer método
// (PRD F01-AC09). Para POST de ação, a feature dona da rota oferece o GET
// correspondente (ex.: F02 redireciona GET /org/events/:id/edit à gestão).
function redirectToLogin(req, res) {
  return res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function requireRole(role, deniedMessage) {
  return function guard(req, res, next) {
    if (!req.user) return redirectToLogin(req, res);
    if (req.user.role !== role) {
      // Nunca ecoa a URL nem dados do recurso pedido (R13).
      return sendError(req, res, 403, messages.AUTH.FORBIDDEN, deniedMessage);
    }
    return next();
  };
}

const requireOrganizer = requireRole('organizer', messages.AUTH.ORGANIZERS_ONLY);
const requireParticipant = requireRole('participant', messages.AUTH.PARTICIPANTS_ONLY);

function hashPassword(plain) {
  return bcrypt.hash(String(plain), 10);
}

async function verifyPassword(plain, hash) {
  if (typeof plain !== 'string' || typeof hash !== 'string') return false;
  return bcrypt.compare(plain, hash);
}

/**
 * Destino seguro pós-login. `next` só vale se for caminho local ("/x", nunca
 * "//host" nem "/\host"). Organizador: só /org/...; participante: nada em /org.
 */
function safeNext(next, role) {
  const fallback = role === 'organizer' ? '/org/events' : '/';
  if (typeof next !== 'string' || next.length < 1 || next[0] !== '/') return fallback;
  if (next[1] === '/' || next[1] === '\\') return fallback;
  if (/[\r\n]/.test(next)) return fallback;
  if (role === 'organizer') return next.startsWith('/org/') ? next : fallback;
  return next.startsWith('/org') ? fallback : next;
}

module.exports = {
  sessionMiddleware,
  loadUser,
  requireOrganizer,
  requireParticipant,
  hashPassword,
  verifyPassword,
  safeNext,
};
