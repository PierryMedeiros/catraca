#!/usr/bin/env bash
# Sobe app + Postgres (build, migrações e seed acontecem na inicialização do app)
# e só retorna quando GET /health responde 200.
set -euo pipefail

cd "$(dirname "$0")/.."

for bin in docker curl; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "up.sh: '$bin' não encontrado no PATH. Instale-o e tente de novo." >&2
    exit 1
  fi
done

detect_tz() {
  local tz=""
  if command -v node >/dev/null 2>&1; then
    tz="$(node -p "Intl.DateTimeFormat().resolvedOptions().timeZone" 2>/dev/null || true)"
  fi
  if [ -z "$tz" ] && command -v timedatectl >/dev/null 2>&1; then
    tz="$(timedatectl show -p Timezone --value 2>/dev/null || true)"
  fi
  if [ -z "$tz" ] && [ -L /etc/localtime ]; then
    tz="$(readlink -f /etc/localtime 2>/dev/null | sed -n 's#.*/zoneinfo/##p' || true)"
  fi
  if [ -z "$tz" ] && [ -r /etc/timezone ]; then
    tz="$(head -n1 /etc/timezone | tr -d '[:space:]' || true)"
  fi
  case "$tz" in
    ""|undefined) tz="America/Sao_Paulo" ;;
  esac
  printf '%s' "$tz"
}

if [ -z "${TZ:-}" ]; then
  TZ="$(detect_tz)"
fi
export TZ

PORT_HOST="${APP_PORT:-3000}"

docker compose up -d --build --remove-orphans

for _ in $(seq 1 180); do
  if curl -fs -o /dev/null "http://localhost:${PORT_HOST}/health"; then
    echo "Catraca no ar em http://localhost:${PORT_HOST} (TZ=${TZ})"
    exit 0
  fi
  sleep 1
done

echo "up.sh: o app não respondeu em http://localhost:${PORT_HOST}/health em 180 s." >&2
docker compose logs --tail=100 app >&2 || true
exit 1
