'use strict';

// Handlers da API de parceiros (spec F04 §3). Nenhuma decisão de vaga é tomada
// aqui: a compra passa inteira por purchaseTicket (F03), que trava o evento.

const { pool } = require('../../db');
const { listOnSaleEvents, getSeatStats } = require('../events/repo');
const { toPartnerEvent } = require('./serializers');

/** GET /api/partner/events -> 200 [eventos à venda]. Leitura informativa, sem trava. */
async function listEvents(req, res) {
  const events = await listOnSaleEvents(pool);
  const items = [];
  for (const event of events) {
    const stats = await getSeatStats(pool, event.id);
    items.push(toPartnerEvent(event, stats ? stats.available : 0));
  }
  res.status(200).json(items);
}

module.exports = { listEvents };
