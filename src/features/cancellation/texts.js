'use strict';

// Textos próprios de F06 (spec F06 §4). Não são do brief; o único que o PRD
// fixou (F06-AC06) já vive em src/messages.js e é reaproveitado de lá.

const messages = require('../../messages');

const CANCEL_TEXTS = Object.freeze({
  onlyPublished: messages.ONLY_PUBLISHED_CAN_CANCEL, // 'Só eventos publicados podem ser cancelados'
  cancelledReadOnly: 'Evento cancelado não pode ser alterado',
  button: 'Cancelar evento',
  confirm: 'Cancelar este evento? Esta ação não pode ser desfeita.',
  errorTitle: 'Operação não permitida',
  backToEvent: 'Voltar para o evento',
  sectionTitle: 'Cancelamento',
  warning: 'Cancelar é irreversível: ingressos confirmados viram estornados e pendentes viram cancelados.',
  cancelledAt: (when) =>
    `Evento cancelado em ${when}. Este evento não pode mais ser editado, publicado nem cancelado.`,
});

module.exports = { CANCEL_TEXTS };
