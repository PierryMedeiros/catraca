# Catraca

Venda de ingressos para eventos pequenos: vitrine pública, compra com gateway de pagamento
simulado, check-in, cancelamento com estorno, painel do evento e API de parceiros.
O comportamento esperado está em [`docs/brief.md`](docs/brief.md) e a fonte da verdade do
projeto é o PRD em [`docs/prd.md`](docs/prd.md).

## Requisitos

- Docker com Compose v2
- Git
- `curl` (usado pelo script de subida para esperar o app ficar saudável)
- Node.js LTS (opcional: só para detectar o fuso do host; nada é instalado no host)

Não é preciso `npm install` no host: build, banco, migrações, seed e testes rodam em containers.

## Comandos

| O quê | Comando | Observação |
|---|---|---|
| Subir tudo | `./scripts/up.sh` (ou `npm run up`) | Builda a imagem, sobe app + PostgreSQL 17, aplica as migrações, roda a seed e só retorna quando `http://localhost:3000/health` responde 200 |
| Derrubar | `./scripts/down.sh` (ou `npm run down`) | Para e remove os containers e a rede da subida; mantém o volume do banco (a seed é idempotente) |
| Gates | `./scripts/gates.sh` (ou `npm run gates`) | `node --check` em `src/` e `test/` + testes `node:test`, num projeto Docker Compose separado com banco de teste próprio; remove tudo ao final e sai com o código dos testes |
| Logs | `docker compose logs -f app` | |
| Banco (psql) | `docker compose exec -T db psql -U catraca -d catraca` | O Postgres não publica porta no host |

Porta do host: variável `APP_PORT` (padrão `3000`), por exemplo `APP_PORT=3101 ./scripts/up.sh`.
O nome do projeto Compose vem do nome da pasta, então clones/worktrees diferentes não
compartilham containers nem volumes. O projeto dos gates é `catraca-gates` (pasta `catraca`)
ou `catraca-gates-<pasta>`; pode ser fixado com `GATES_PROJECT`.

## Endereços

- `$WEB` (produto) = `http://localhost:3000`
- `$API` (API de parceiros) = `http://localhost:3000` (mesmo endereço do produto)
- Saúde: `http://localhost:3000/health` → `{"status":"ok"}`

Com `APP_PORT` diferente, troque a porta nos dois endereços.

## Contas da seed

A seed roda automaticamente na subida e é idempotente (subir de novo não duplica contas).
Não existe cadastro de organizador pelo produto.

| Conta | E-mail | Senha |
|---|---|---|
| Organizador A | `org.a@catraca.local` | `catraca123` |
| Organizador B | `org.b@catraca.local` | `catraca123` |
| Participante | `participante@catraca.local` | `catraca123` |

Novos participantes se cadastram em `/signup`. Todos entram pela mesma tela, `/login`.

## Chave de parceiro

`$KEY` = `catraca-parceiro-2026` (variável `PARTNER_API_KEY` do container, com esse valor padrão
no `docker-compose.yml`). Enviada no cabeçalho `X-Api-Key`.

## Fuso horário

`./scripts/up.sh` repassa o fuso do host ao container como `TZ` (detectado com Node, `timedatectl`
ou `/etc/localtime`; sem detecção, `America/Sao_Paulo`). Para forçar outro fuso:
`TZ=America/Recife ./scripts/up.sh`. Datas são exibidas no horário local e a API usa ISO 8601
com o offset desse fuso.

## Configuração

Não há `.env` versionado; o Compose resolve os padrões: `APP_PORT` (3000), `TZ`, `SESSION_SECRET`,
`PARTNER_API_KEY` (`catraca-parceiro-2026`).

Gateway simulado: o app lê `GATEWAY_FAST_DELAY_MS` (padrão 2000), `GATEWAY_SLOW_DELAY_MS` (padrão 65000)
e `GATEWAY_POLL_MS` (padrão 500) do ambiente, mas o `docker-compose.yml` **não** as define: a subida
normal roda sempre no modo padrão (o do avaliador, tabela do brief). Só os gates
(`docker-compose.gates.yml`) usam atrasos menores (200 / 1500 / 50 ms).

## Mapa dos artefatos

| Artefato | Caminho |
|---|---|
| Porta de entrada dos agentes (regras, comandos, stack) | [`AGENTS.md`](AGENTS.md) |
| Brief da fundadora | [`docs/brief.md`](docs/brief.md) |
| PRD (features, grafo, waves, critérios) | [`docs/prd.md`](docs/prd.md) |
| Features: spec, plano, contrato e relatórios de avaliação | [`docs/features/`](docs/features/) (`<ID>-<slug>/spec.md`, `plan.md`, `contract.md`, `reports/`) |
| Estado do projeto | [`state.json`](state.json) |
| Scripts do harness (subir, derrubar, gates) | [`scripts/`](scripts/) |
| Seed | [`src/seed.js`](src/seed.js) |
| Migrações SQL | [`db/migrations/`](db/migrations/) |
| Código do app | [`src/`](src/) (features em `src/features/<area>/`, registradas em `src/app.js`) |
| Testes automatizados | [`test/`](test/) |
