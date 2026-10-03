'use strict';

// F03-AC06 (parte unitária): tabela do gateway com os atrasos padrão do brief.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decideOutcome, DEFAULT_FAST_DELAY_MS, DEFAULT_SLOW_DELAY_MS } = require('../src/features/gateway/simulator');

const KEYS = ['GATEWAY_FAST_DELAY_MS', 'GATEWAY_SLOW_DELAY_MS'];

function withEnv(values, fn) {
  const saved = {};
  for (const k of KEYS) saved[k] = process.env[k];
  try {
    for (const k of KEYS) {
      if (values[k] === undefined) delete process.env[k];
      else process.env[k] = values[k];
    }
    return fn();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('F03-AC06 decideOutcome no modo padrão (sem GATEWAY_*): tabela do brief', () => {
  assert.equal(DEFAULT_FAST_DELAY_MS, 2000);
  assert.equal(DEFAULT_SLOW_DELAY_MS, 65000);
  withEnv({}, () => {
    assert.deepEqual(decideOutcome('4000000000000001'), { outcome: 'approved', delayMs: 2000 });
    assert.deepEqual(decideOutcome('4000000000000002'), { outcome: 'declined', delayMs: 2000 });
    assert.deepEqual(decideOutcome('4000000000000003'), { outcome: 'approved', delayMs: 65000 });
    assert.deepEqual(decideOutcome('4000000000000004'), { outcome: 'declined', delayMs: 65000 });
    assert.deepEqual(decideOutcome('4000000000009999'), { outcome: 'declined', delayMs: 2000 });
    assert.deepEqual(decideOutcome('4000000000000000'), { outcome: 'declined', delayMs: 2000 });
    assert.deepEqual(decideOutcome('4000000000000010'), { outcome: 'declined', delayMs: 2000 });
  });
});

test('F03-AC06 janelas do brief: rápido <= 5 s, lento entre 60 e 75 s', () => {
  withEnv({}, () => {
    assert.ok(decideOutcome('4000000000000001').delayMs <= 5000);
    const slow = decideOutcome('4000000000000003').delayMs;
    assert.ok(slow >= 60000 && slow <= 75000);
  });
});

test('F03-AC06 atrasos vêm do ambiente a cada chamada (só testes os reduzem)', () => {
  withEnv({ GATEWAY_FAST_DELAY_MS: '10', GATEWAY_SLOW_DELAY_MS: '20' }, () => {
    assert.deepEqual(decideOutcome('4000000000000001'), { outcome: 'approved', delayMs: 10 });
    assert.deepEqual(decideOutcome('4000000000000002'), { outcome: 'declined', delayMs: 10 });
    assert.deepEqual(decideOutcome('4000000000000003'), { outcome: 'approved', delayMs: 20 });
    assert.deepEqual(decideOutcome('4000000000000004'), { outcome: 'declined', delayMs: 20 });
    assert.deepEqual(decideOutcome('4000000000000005'), { outcome: 'declined', delayMs: 10 });
  });
});

test('F03-AC06 valores inválidos de ambiente caem no padrão', () => {
  for (const bad of ['abc', '-1', '', '1.5', ' ']) {
    withEnv({ GATEWAY_FAST_DELAY_MS: bad, GATEWAY_SLOW_DELAY_MS: bad }, () => {
      assert.equal(decideOutcome('4000000000000001').delayMs, 2000, `fast=${JSON.stringify(bad)}`);
      assert.equal(decideOutcome('4000000000000004').delayMs, 65000, `slow=${JSON.stringify(bad)}`);
    });
  }
});
