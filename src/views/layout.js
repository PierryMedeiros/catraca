'use strict';

const messages = require('../messages');

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa um valor dinâmico para HTML (texto e atributos). null/undefined -> ''. */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function nav(user) {
  const links = ['<a href="/">Catraca</a>'];
  if (!user) {
    links.push('<a href="/login">Entrar</a>', '<a href="/signup">Criar conta</a>');
  } else {
    if (user.role === 'participant') links.push('<a href="/me/tickets">Meus ingressos</a>');
    if (user.role === 'organizer') links.push('<a href="/org/events">Meus eventos</a>');
    links.push(
      `<span class="user-name">${escapeHtml(user.name)}</span>`,
      '<form method="post" action="/logout"><button type="submit">Sair</button></form>'
    );
  }
  return `<nav>\n    ${links.join('\n    ')}\n  </nav>`;
}

const STYLE = `
  body { font-family: system-ui, sans-serif; margin: 0; color: #1d1d1f; background: #fafafa; }
  nav { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; padding: .75rem 1rem; background: #1d3557; }
  nav a, nav span { color: #fff; text-decoration: none; }
  nav a:first-child { font-weight: bold; margin-right: auto; }
  nav form { margin: 0; }
  main { max-width: 860px; margin: 0 auto; padding: 1rem; }
  label { display: block; margin: .5rem 0; }
  input { display: block; padding: .4rem; min-width: 260px; max-width: 100%; }
  .errors { color: #b00020; }
  .notice { padding: .5rem .75rem; background: #fff3cd; border: 1px solid #e0c36c; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: .3rem .6rem; text-align: left; }
`;

/**
 * Página HTML completa. `body` é HTML já montado pelo chamador, que escapa
 * os próprios valores dinâmicos com escapeHtml.
 */
function layout({ title, user, body }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Catraca</title>
  <style>${STYLE}</style>
</head>
<body>
  ${nav(user)}
  <main>
${body || ''}
  </main>
</body>
</html>
`;
}

function sendPage(req, res, { status = 200, title, body }) {
  return res
    .status(status)
    .type('html')
    .send(layout({ title, user: req.user || null, body }));
}

/** Página de erro com título e mensagem opcional (ambos escapados). */
function sendError(req, res, status, title, message) {
  const body = `<h1>${escapeHtml(title)}</h1>${message ? `<p>${escapeHtml(message)}</p>` : ''}`;
  return sendPage(req, res, { status, title, body });
}

function notFound(req, res) {
  return sendError(req, res, 404, messages.PAGE_NOT_FOUND);
}

module.exports = { escapeHtml, layout, sendPage, sendError, notFound };
