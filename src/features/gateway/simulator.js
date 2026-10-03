'use strict';

// Gateway de pagamento simulado (brief, "Gateway de pagamento simulado"; spec F03 §4).
// Decide o resultado e o atraso da resposta pelo final do cartão. Função pura:
// quem grava o vencimento é a compra; quem aplica a resposta é o worker.

const DEFAULT_FAST_DELAY_MS = 2000; // 0001, 0002 e outros finais: "em até 5 segundos"
const DEFAULT_SLOW_DELAY_MS = 65000; // 0003, 0004: "entre 60 e 75 segundos"

/** Inteiro >= 0 de process.env[name]; ausente, vazio, não inteiro ou negativo -> padrão. */
function readDelayMs(name, fallback) {
  const raw = process.env[name];
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) ? n : fallback;
}

/**
 * decideOutcome('4000000000000001') -> { outcome: 'approved' | 'declined', delayMs }.
 * As variáveis GATEWAY_FAST_DELAY_MS / GATEWAY_SLOW_DELAY_MS são lidas a cada chamada.
 */
function decideOutcome(cardNumber) {
  const fast = readDelayMs('GATEWAY_FAST_DELAY_MS', DEFAULT_FAST_DELAY_MS);
  const slow = readDelayMs('GATEWAY_SLOW_DELAY_MS', DEFAULT_SLOW_DELAY_MS);
  switch (String(cardNumber).slice(-4)) {
    case '0001':
      return { outcome: 'approved', delayMs: fast };
    case '0002':
      return { outcome: 'declined', delayMs: fast };
    case '0003':
      return { outcome: 'approved', delayMs: slow };
    case '0004':
      return { outcome: 'declined', delayMs: slow };
    default:
      return { outcome: 'declined', delayMs: fast };
  }
}

module.exports = { decideOutcome, readDelayMs, DEFAULT_FAST_DELAY_MS, DEFAULT_SLOW_DELAY_MS };
