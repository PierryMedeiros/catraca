#!/usr/bin/env bash
# Gates: checagem de sintaxe + testes automatizados, num projeto Compose
# separado do app (banco de teste próprio em tmpfs). Remove tudo ao final
# e sai com o código dos testes.
set -uo pipefail

cd "$(dirname "$0")/.."

if [ -n "${GATES_PROJECT:-}" ]; then
  PROJ="$GATES_PROJECT"
else
  dir="$(basename "$PWD")"
  if [ "$dir" = "catraca" ]; then
    PROJ="catraca-gates"
  else
    slug="$(printf '%s' "$dir" | tr 'A-Z' 'a-z' | sed -e 's/[^a-z0-9-]/-/g' -e 's/--*/-/g' -e 's/^-//' -e 's/-$//')"
    PROJ="catraca-gates-${slug:-x}"
  fi
fi

echo "gates: projeto $PROJ"

COMPOSE=(docker compose -p "$PROJ" -f docker-compose.gates.yml)

cleanup() {
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if ! "${COMPOSE[@]}" build tests; then
  echo "gates: falha no build da imagem de testes" >&2
  exit 1
fi

"${COMPOSE[@]}" run --rm -T tests
code=$?
echo "gates: código de saída $code"
exit "$code"
