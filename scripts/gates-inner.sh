#!/bin/sh
# Roda dentro do container de testes (docker-compose.gates.yml).
set -e

echo "gates: checagem de sintaxe (node --check)"
find src test -name '*.js' -print0 | xargs -0 -n1 node --check
echo "gates: sintaxe ok"

node --test --test-concurrency=1 --test-reporter=tap 'test/**/*.test.js'
