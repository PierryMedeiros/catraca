'use strict';

const express = require('express');
const messages = require('../../messages');
const { sendPage } = require('../../views/layout');
const { safeNext } = require('../../auth');
const { createParticipant, authenticate } = require('./service');
const views = require('./views');

const router = express.Router();

function field(form, name) {
  return form && typeof form[name] === 'string' ? form[name] : '';
}

router.get('/signup', (req, res) => {
  sendPage(req, res, { title: 'Criar conta', body: views.signupForm() });
});

router.post('/signup', async (req, res) => {
  const form = req.body || {};
  const result = await createParticipant(form);
  if (!result.ok) {
    const values = { name: field(form, 'name').trim(), email: field(form, 'email').trim() };
    return sendPage(req, res, {
      status: 422,
      title: 'Criar conta',
      body: views.signupForm({ values, errors: result.errors }),
    });
  }
  req.session.userId = result.user.id;
  return res.redirect(302, '/');
});

router.get('/login', (req, res) => {
  const next = typeof req.query.next === 'string' ? req.query.next : '';
  sendPage(req, res, { title: 'Entrar', body: views.loginForm({ next }) });
});

router.post('/login', async (req, res) => {
  const form = req.body || {};
  const next = field(form, 'next');
  const user = await authenticate(field(form, 'email'), field(form, 'password'));
  if (!user) {
    return sendPage(req, res, {
      status: 401,
      title: 'Entrar',
      body: views.loginForm({
        values: { email: field(form, 'email').trim() },
        errors: [messages.AUTH.LOGIN_INVALID],
        next,
      }),
    });
  }
  req.session.userId = user.id;
  return res.redirect(302, safeNext(next, user.role));
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.redirect(302, '/');
});

module.exports = router;
