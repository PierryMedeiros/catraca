'use strict';

// Textos próprios de F02 (spec, seção 4). Os que o PRD já fixou em
// src/messages.js (F01) são reaproveitados de lá, nunca reescritos.

const messages = require('../../messages');

const EVENT_TEXTS = Object.freeze({
  NOT_FOUND: messages.EVENT_NOT_FOUND,
  CANCELLED_LOCKED: 'Este evento foi cancelado e não pode ser alterado.',
  FORM_INVALID: 'Não foi possível salvar. Corrija os campos indicados.',
  NAME_REQUIRED: 'Informe o nome do evento.',
  VENUE_REQUIRED: 'Informe o local do evento.',
  STARTS_AT_INVALID: 'Informe uma data e hora de início válidas.',
  STARTS_AT_PAST: 'A data de início precisa estar no futuro.',
  CAPACITY_INVALID: 'A lotação deve ser um número inteiro maior ou igual a 1.',
  PRICE_INVALID: 'Informe um preço maior que zero, em reais, com até 2 casas decimais (ex.: 100,00).',
  EMPTY_LIST: 'Você ainda não criou eventos.',
});

/** draft -> rascunho, published -> publicado, cancelled -> cancelado. */
const EVENT_STATUS_LABELS = messages.EVENT_STATUS_LABELS;

/** 'A lotação não pode ser menor que as vagas ocupadas (N)' (F02-AC08). */
const capacityBelowOccupied = messages.capacityBelowOccupied;

module.exports = { EVENT_TEXTS, EVENT_STATUS_LABELS, capacityBelowOccupied };
