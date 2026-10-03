# AGENTS.md — porta de entrada dos agentes

Catraca: venda de ingressos para eventos pequenos (vitrine, compra com gateway simulado,
check-in, cancelamento, painel e API de parceiros). Este arquivo é o ponto de partida de
qualquer agente (implementador, avaliador ou corretor). Leia-o inteiro antes de agir.

## Comandos do harness

| O quê | Comando | Observação |
|---|---|---|
| Subir tudo (build + banco + seed) | `./scripts/up.sh` (ou `npm run up`) | Espera o app ficar saudável. Produto em http://localhost:3000 |
| Derrubar tudo que a subida iniciou | `./scripts/down.sh` (ou `npm run down`) | Mantém o volume do banco (a seed é idempotente) |
| Gates (sintaxe + testes automatizados) | `./scripts/gates.sh` (ou `npm run gates`) | Roda num projeto Docker Compose separado e limpa tudo ao final |
| Logs | `docker compose logs -f app` | |

Porta do host: `APP_PORT` (padrão 3000). Agentes rodando em paralelo (worktrees) usam portas diferentes, ex.: `APP_PORT=3101 ./scripts/up.sh`. O nome do projeto Compose vem da pasta, então worktrees não compartilham containers nem volumes.

Nenhum comando exige `npm install` no host: tudo roda em containers. O host só precisa de Docker, Git e Node.js LTS.

## Stack (decidida — não troque sem ADR no PRD)

- Node.js 24 LTS + Express 5, HTML renderizado no servidor (template literals com escape), sem SPA.
- PostgreSQL 17 (container). Driver `pg`. Migrações SQL em `db/migrations/NNN_nome.sql`, aplicadas na subida do app em ordem e registradas em `schema_migrations`.
- Sessão por cookie assinado (`cookie-session`), senhas com `bcryptjs`.
- Testes: `node:test` + `fetch` contra o app real, num banco Postgres de teste (ver `scripts/gates.sh`).

## Regras do projeto

1. **Fonte da verdade**: `docs/prd.md` (features, dependências, waves, critérios). Cada feature tem `docs/features/<ID>-<slug>/` com `spec.md`, `plan.md`, `contract.md` e `reports/`.
2. **Estado**: `state.json` na raiz diz o status de cada feature e o relatório de avaliação mais recente. Atualize ao terminar uma etapa.
3. **Quem implementa não avalia.** O avaliador é outro agente, em outra sessão, e só lê o contrato, o PRD e o código; nunca o histórico do implementador.
4. **Relatórios são imutáveis**: cada avaliação gera um arquivo novo `reports/AAAA-MM-DD-HHMM-avaliacao.md`. Nunca edite um relatório commitado — nem o próprio avaliador logo depois; revise antes de commitar. Reavaliação = arquivo novo. Instruções completas do avaliador: `docs/avaliador.md`.
5. **Concorrência (R07, R03, R11)**: toda operação que lê e altera vagas de um evento (compra, edição de lotação, cancelamento) roda numa transação que começa com `SELECT ... FROM events WHERE id = $1 FOR UPDATE`. Não calcule vagas fora dessa trava para decidir uma compra.
6. **Gateway**: transições vindas do gateway usam `UPDATE tickets SET status = ... WHERE id = $1 AND status = 'pending'` — resposta tardia nunca altera ingresso cancelado/estornado (R11).
7. **Modo padrão = avaliador**: atrasos do gateway seguem a tabela do brief. Atrasos menores só por variável de ambiente nos testes (`GATEWAY_FAST_DELAY_MS`, `GATEWAY_SLOW_DELAY_MS`).
8. **Textos exatos do brief** (`Ingressos esgotados`, mensagens de check-in, códigos de erro da API) vêm de `src/messages.js`; não reescreva.
9. Rotas de cada feature ficam em `src/features/<area>/`; registre-as em `src/app.js` com uma linha por feature (minimiza conflitos em waves paralelas). Migrações novas ganham o próximo número livre.
10. Antes de dizer "pronto": `./scripts/gates.sh` passa e você exercitou o fluxo afetado com o app rodando (`./scripts/up.sh`).
11. Commits em Conventional Commits, em português.

## Mapa dos artefatos

| Artefato | Caminho |
|---|---|
| PRD | `docs/prd.md` |
| Features (spec, plano, contrato, relatórios) | `docs/features/<ID>-<slug>/` |
| Estado do projeto | `state.json` |
| Scripts do harness | `scripts/` (`up.sh`, `down.sh`, `gates.sh`; `fluxo-avaliador.sh` roda os passos 2–16 do fluxo do avaliador contra o app no ar) |
| Instruções do avaliador | `docs/avaliador.md` |
| README (como rodar, credenciais, PRs, decisões) | `README.md` |
| Seed | `src/seed.js` (roda automaticamente na subida) |
| Código | `src/` |
| Testes | `test/` |

## Commits e PRs

Conventional Commits em português (`feat(eventos): ...`, `docs(prd): ...`), atômicos, `git add` por caminho.
Nenhum trailer de coautoria nem menção a geração automática em mensagens de commit ou descrições de PR
(ferramenta e modelo são registrados apenas nos relatórios de avaliação, onde o desafio exige).
