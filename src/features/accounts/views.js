'use strict';

const { escapeHtml } = require('../../views/layout');

function errorList(errors) {
  if (!errors || errors.length === 0) return '';
  return `<ul class="errors">${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
}

/** Formulário de cadastro de participante (não há campo de papel). */
function signupForm({ values = {}, errors = [] } = {}) {
  return `<h1>Criar conta</h1>
${errorList(errors)}
<form method="post" action="/signup">
  <label>Nome <input type="text" name="name" value="${escapeHtml(values.name)}" required></label>
  <label>E-mail <input type="email" name="email" value="${escapeHtml(values.email)}" required></label>
  <label>Senha (mínimo 6 caracteres) <input type="password" name="password" minlength="6" required></label>
  <button type="submit">Criar conta</button>
</form>
<p>Já tem conta? <a href="/login">Entre por aqui</a>.</p>`;
}

/** Formulário de login único para participante e organizador. */
function loginForm({ values = {}, errors = [], next = '' } = {}) {
  return `<h1>Entrar</h1>
${errorList(errors)}
<form method="post" action="/login">
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <label>E-mail <input type="email" name="email" value="${escapeHtml(values.email)}" required></label>
  <label>Senha <input type="password" name="password" required></label>
  <button type="submit">Entrar</button>
</form>
<p>Ainda não tem conta? <a href="/signup">Cadastre-se</a>.</p>`;
}

module.exports = { signupForm, loginForm };
