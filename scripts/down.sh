#!/usr/bin/env bash
# Derruba tudo que ./scripts/up.sh iniciou (containers e rede do projeto).
# O volume do banco (pgdata) é mantido; a seed é idempotente.
set -euo pipefail

cd "$(dirname "$0")/.."

docker compose down --remove-orphans
