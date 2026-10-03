'use strict';

// Todos os textos exatos do brief (docs/brief.md) e os textos fixados pelo PRD.
// Nenhum outro arquivo de src/ repete estes literais (AGENTS.md, regra 8):
// importe daqui e selecione pela chave.

function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) deepFreeze(value);
  }
  return Object.freeze(obj);
}

module.exports = deepFreeze({
  // R07: vitrine sem vaga disponível (F03)
  SOLD_OUT: 'Ingressos esgotados',

  // R10: mensagens do check-in, chaves retornadas por checkInTicket (F05/F06)
  CHECKIN: {
    invalid_ticket: 'Ingresso inválido para este evento',
    event_cancelled: 'Evento cancelado',
    not_confirmed: 'Ingresso não confirmado',
    already_used: 'Ingresso já utilizado',
    entry_allowed: 'Entrada liberada',
  },

  // API de parceiros: valores de {"error": ...} (F04) e de purchaseTicket (F03)
  API_ERRORS: {
    unauthorized: 'unauthorized',
    invalid_request: 'invalid_request',
    event_not_available: 'event_not_available',
    sold_out: 'sold_out',
    ticket_not_found: 'ticket_not_found',
  },

  // Rótulos de status do ingresso na interface (valor da API -> rótulo)
  TICKET_STATUS_LABELS: {
    pending: 'pendente',
    confirmed: 'confirmado',
    declined: 'recusado',
    cancelled: 'cancelado',
    refunded: 'estornado',
  },

  // Rótulos de status do evento na interface
  EVENT_STATUS_LABELS: {
    draft: 'rascunho',
    published: 'publicado',
    cancelled: 'cancelado',
  },

  // Contas, sessão e guardas (F01)
  AUTH: {
    LOGIN_INVALID: 'E-mail ou senha inválidos',
    NAME_REQUIRED: 'Informe seu nome.',
    EMAIL_INVALID: 'Informe um e-mail válido.',
    EMAIL_TAKEN: 'Este e-mail já está cadastrado.',
    PASSWORD_TOO_SHORT: 'A senha deve ter pelo menos 6 caracteres.',
    FORBIDDEN: 'Acesso negado',
    ORGANIZERS_ONLY: 'Esta área é restrita a organizadores.',
    PARTICIPANTS_ONLY: 'Esta área é restrita a participantes.',
  },

  // Páginas de erro genéricas
  PAGE_NOT_FOUND: 'Página não encontrada',
  INTERNAL_ERROR: 'Erro interno',
  BAD_REQUEST: 'Requisição inválida',

  // Textos fixados pelo PRD para outras features
  EVENT_NOT_FOUND: 'Evento não encontrado', // F02-AC09
  ONLY_PUBLISHED_CAN_CANCEL: 'Só eventos publicados podem ser cancelados', // F06-AC06
  capacityBelowOccupied: (n) => `A lotação não pode ser menor que as vagas ocupadas (${n})`, // F02-AC08
});
