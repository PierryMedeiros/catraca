'use strict';

// Páginas provisórias de F01, registradas DEPOIS das features em src/app.js.
// Só respondem se nenhuma feature tratou a rota antes: F02 (GET /org/events) e
// F03 (GET / e GET /me/tickets) registram as rotas reais e podem apagar o
// handler correspondente daqui.

const express = require('express');
const { sendPage } = require('../../views/layout');

const router = express.Router();

router.get('/', (req, res) => {
  sendPage(req, res, {
    title: 'Eventos à venda',
    body: '<h1>Eventos à venda</h1><p>Nenhum evento à venda no momento.</p>',
  });
});

router.get('/org/events', (req, res) => {
  sendPage(req, res, {
    title: 'Meus eventos',
    body: '<h1>Meus eventos</h1><p>Nenhum evento cadastrado.</p>',
  });
});

router.get('/me/tickets', (req, res) => {
  sendPage(req, res, {
    title: 'Meus ingressos',
    body: '<h1>Meus ingressos</h1><p>Você ainda não tem ingressos.</p>',
  });
});

module.exports = router;
