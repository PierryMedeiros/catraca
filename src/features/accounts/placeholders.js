'use strict';

// Páginas provisórias de F01, registradas DEPOIS das features em src/app.js.
// Só respondem se nenhuma feature tratou a rota antes: F02 (GET /org/events) e
// F03 (GET / e GET /me/tickets) registram as rotas reais e podem apagar o
// handler correspondente daqui. F03 já removeu GET / e GET /me/tickets.

const express = require('express');
const { sendPage } = require('../../views/layout');

const router = express.Router();

router.get('/org/events', (req, res) => {
  sendPage(req, res, {
    title: 'Meus eventos',
    body: '<h1>Meus eventos</h1><p>Nenhum evento cadastrado.</p>',
  });
});

module.exports = router;
