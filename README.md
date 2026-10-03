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

## API de parceiros

Contrato fixo do brief, em `$API` (mesmo endereço do produto). Toda rota exige o cabeçalho
`X-Api-Key: $KEY`; a chave em query string, cookie de sessão ou outro cabeçalho não autentica.
Todas as respostas são JSON (`application/json`), inclusive os erros (`{"error":"<código>"}`).

```bash
export API=http://localhost:3000 KEY=catraca-parceiro-2026   # com APP_PORT diferente, troque a porta

# Eventos à venda (publicados e não cancelados), por data de início
curl -s -H "X-Api-Key: $KEY" "$API/api/partner/events"
# 200 [{"id":"evt_8f2k3m9q1z","name":"Jazz no Porão","startsAt":"2026-12-05T21:00:00-03:00","priceCents":10000,"availableSeats":2}]

# Compra de um ingresso (responde sem esperar o gateway)
curl -s -X POST "$API/api/partner/events/$E1/purchases" \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"buyerEmail":"ana@example.com","cardNumber":"4000000000000001"}'
# 202 {"ticketId":"tkt_51xq0a9b2c","code":"K7Q2M9XA","status":"pending"}

# Consulta de um ingresso de qualquer canal (vitrine ou API)
curl -s -H "X-Api-Key: $KEY" "$API/api/partner/tickets/$T2"
# 200 {"ticketId":"tkt_51xq0a9b2c","code":"K7Q2M9XA","eventId":"evt_8f2k3m9q1z","status":"confirmed","checkedIn":false}
```

- `startsAt`: ISO 8601 no horário local do container com o offset do `TZ` (ex.: `-03:00`).
- `availableSeats`: lotação − (pendentes + confirmados). Evento esgotado continua listado com `0`.
- `priceCents`: preço vigente em centavos (inteiro). Mudança de preço vale só para compras seguintes.
- `status` do ingresso: `pending`, `confirmed`, `declined`, `cancelled` ou `refunded`; `checkedIn` é booleano.
- Compras pela API não ficam vinculadas a contas de participante (mesmo com e-mail igual), mas contam
  para lotação, painel, check-in e cancelamento como as da vitrine.

Erros, verificados nesta ordem na compra (401 → 422 → 404 → 409):

| Status | Corpo | Quando |
|---|---|---|
| `401` | `{"error":"unauthorized"}` | qualquer rota sem `X-Api-Key` ou com chave errada (vem antes de tudo) |
| `422` | `{"error":"invalid_request"}` | compra com corpo inválido: não-JSON ou não-objeto, `buyerEmail` ausente ou mal formado, `cardNumber` ausente ou sem exatamente 16 dígitos (ex.: `"123"`) |
| `404` | `{"error":"event_not_available"}` | compra em evento inexistente, em rascunho ou cancelado (mesmo sem vagas) |
| `409` | `{"error":"sold_out"}` | compra sem vaga disponível; nenhum ingresso é criado |
| `404` | `{"error":"ticket_not_found"}` | consulta de ingresso inexistente |
| `404` | `{"error":"not_found"}` | caminho ou método desconhecido sob `/api/partner` (com chave válida) |

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
| Porta de entrada dos agentes (regras, comandos, stack, mapa) | [`AGENTS.md`](AGENTS.md) (o [`CLAUDE.md`](CLAUDE.md) aponta para ele) |
| Brief da fundadora (cópia literal) | [`docs/brief.md`](docs/brief.md) |
| PRD (features, Provides/Consumes, grafo, waves, critérios, cross-feature, rastreabilidade R01–R13, fora de escopo) | [`docs/prd.md`](docs/prd.md) |
| Instruções do agente avaliador | [`docs/avaliador.md`](docs/avaliador.md) |
| Estado do projeto | [`state.json`](state.json) |
| Scripts do harness | [`scripts/up.sh`](scripts/up.sh), [`scripts/down.sh`](scripts/down.sh), [`scripts/gates.sh`](scripts/gates.sh) |
| Fluxo do avaliador automatizado (passos 2–16) | [`scripts/fluxo-avaliador.sh`](scripts/fluxo-avaliador.sh) |
| Seed | [`src/seed.js`](src/seed.js) |
| Migrações SQL | [`db/migrations/`](db/migrations/) |
| Código / testes | [`src/`](src/) (features em `src/features/<area>/`) / [`test/`](test/) |

### Features

| ID | Feature | Wave | Pasta (spec, plano, contrato) | Relatório mais recente | PR |
|---|---|---|---|---|---|
| F01 | Fundação e contas | W1 | [`docs/features/F01-fundacao/`](docs/features/F01-fundacao/) | [`2026-10-03-1620`](docs/features/F01-fundacao/reports/2026-10-03-1620-avaliacao.md) | [#1](https://github.com/PierryMedeiros/catraca/pull/1) |
| F02 | Gestão de eventos | W2 | [`docs/features/F02-eventos/`](docs/features/F02-eventos/) | [`2026-10-03-1638`](docs/features/F02-eventos/reports/2026-10-03-1638-avaliacao.md) | [#2](https://github.com/PierryMedeiros/catraca/pull/2) |
| F03 | Vitrine, compra e gateway | W3 | [`docs/features/F03-compra/`](docs/features/F03-compra/) | [`2026-10-03-1701`](docs/features/F03-compra/reports/2026-10-03-1701-avaliacao.md) | [#3](https://github.com/PierryMedeiros/catraca/pull/3) |
| F04 | API de parceiros | **W4 (paralela)** | [`docs/features/F04-api-parceiros/`](docs/features/F04-api-parceiros/) | [`2026-10-03-1717`](docs/features/F04-api-parceiros/reports/2026-10-03-1717-avaliacao.md) | [#4](https://github.com/PierryMedeiros/catraca/pull/4) |
| F05 | Check-in e painel | **W4 (paralela)** | [`docs/features/F05-checkin-painel/`](docs/features/F05-checkin-painel/) | [`2026-10-03-1716`](docs/features/F05-checkin-painel/reports/2026-10-03-1716-avaliacao.md) | [#5](https://github.com/PierryMedeiros/catraca/pull/5) |
| F06 | Cancelamento de evento | W5 | [`docs/features/F06-cancelamento/`](docs/features/F06-cancelamento/) | [`2026-10-03-1915`](docs/features/F06-cancelamento/reports/2026-10-03-1915-avaliacao.md) | [#6](https://github.com/PierryMedeiros/catraca/pull/6) |

### Wave paralela (W4): PRs #4 e #5

- **F04 — API de parceiros:** <https://github.com/PierryMedeiros/catraca/pull/4>, branch `feat/F04-api-parceiros`
- **F05 — Check-in e painel:** <https://github.com/PierryMedeiros/catraca/pull/5>, branch `feat/F05-checkin-painel`

As duas branches saíram da `main` no mesmo commit (`4b57d64`, após o merge da F03) e foram implementadas
ao mesmo tempo por dois agentes, cada um na sua git worktree (`.worktrees/F04` e `.worktrees/F05`).
Os PRs foram mergeados com merge commit (sem squash), então os commits das branches estão na `main`:

```
git log --format="%h %ad %s" --date=iso 4b57d64..2ee04db   # F04: 1º commit 17:03:25, último commit do implementador 17:12:00
git log --format="%h %ad %s" --date=iso 4b57d64..d74e084   # F05: 1º commit 17:03:48, último commit do implementador 17:14:12
```

O primeiro commit de cada branch é anterior ao último commit da outra. O conflito no merge
(`state.json`, editado pelas duas) foi resolvido na branch da F05 (`42f4cf0`), com os gates rodando
sobre o código integrado (163 testes) antes do merge do PR #5. A integração F04 + F05 (critério X-17:
compras pela API aparecem no painel e fazem check-in) é verificada no contrato da F06.

## Decisões

### Stack e por quê

Node.js 24 LTS + Express 5 com HTML renderizado no servidor, PostgreSQL 17, tudo em Docker Compose.
A máquina do avaliador só garante Docker, Git e Node: com app e banco em containers nada é instalado
no host. HTML no servidor (sem SPA, sem build de front) deixa cada tela verificável com `curl` e
cookie jar, o que facilita a vida dos agentes avaliadores. Postgres porque a garantia de R07 precisa
de travas de linha reais e transações; testes com `node:test` (sem dependências extras) contra o app
e um banco reais.

### Como R07 foi garantida sob concorrência

Compra, edição de lotação e cancelamento rodam numa transação que começa com
`SELECT ... FROM events WHERE id = $1 FOR UPDATE` (`lockEvent`). Só depois da trava a compra conta as
vagas ocupadas (`pending` + `confirmed`) e insere o ingresso. Compras simultâneas do mesmo evento
ficam em fila na linha do evento: a 6ª compra num evento de lotação 5 só lê a contagem depois que as
5 anteriores fizeram commit, e recebe `sold_out`. A mesma trava serializa a redução de lotação (R03)
e o cancelamento (R11) com as compras, então nenhum dos dois decide com números velhos.
Escolhemos a trava pessimista na linha do evento em vez de um `UPDATE ... WHERE ocupadas < lotação`
num contador porque a ocupação é derivada dos ingressos (não há contador para dessincronizar) e porque
três operações diferentes precisam do mesmo ponto de serialização.

Prova: testes automatizados com 30 compras simultâneas em lotação 5, repetidos em várias rodadas e
eventos novos, pelo serviço, pela vitrine e pela API (`test/f03-*`, `test/partner-api-*`,
`test/cancellation-concurrency.test.js`); trocar a trava por um `SELECT` comum faz esses testes
falharem (9–10 vendas em lotação 5). Os avaliadores repetiram a rajada literal do passo 15 em vários
eventos novos, e `scripts/fluxo-avaliador.sh` a repete em E4 e E5.

### Como a resposta assíncrona do gateway foi implementada

A compra grava o ingresso `pending` e, na mesma transação, o resultado que o gateway simulado vai dar
(pelo final do cartão) e o instante em que a resposta chega (`gateway_due_at` = agora + 2 s nos
finais rápidos ou 65 s em `0003`/`0004`); a resposta HTTP sai na hora (202 na API, redirect na vitrine).
Um worker dentro do processo do app faz polling a cada 500 ms das respostas vencidas e as aplica com
`UPDATE tickets SET status = ... WHERE id = $1 AND status = 'pending'`. Como o estado fica no banco,
respostas pendentes sobrevivem a reinício do app; como o UPDATE é condicional, uma resposta que chegue
depois do cancelamento (ingresso já `cancelled`/`refunded`) não muda nada (R11). Os atrasos são
configuráveis por variável de ambiente só nos gates; a subida normal usa a tabela do brief.

### Como a avaliação foi isolada do implementador

- Cada feature foi implementada por um agente (Claude Code, `claude-opus-5-5`) e avaliada por **outro
  agente, iniciado do zero**, sem acesso à conversa, ao raciocínio nem ao relato do implementador,
  rodando em **outro modelo** (`claude-sonnet-5-5`), para reduzir o viés de autoavaliação.
- O avaliador recebe só o contrato, o PRD, o AGENTS.md e o código ([`docs/avaliador.md`](docs/avaliador.md)),
  executa todos os itens com o app real no modo padrão e escreve um relatório novo, com commit avaliado,
  ferramenta, modelo e evidência por item. Ele não corrige código.
- Além do contrato, cada avaliador recebeu checagens extras derivadas diretamente do brief, para não
  depender só do que o implementador e o spec writer acharam importante.
- O orquestrador (sessão principal) só atualiza `state.json` e faz merge depois do veredito.

## Desvios conhecidos

- **Relatório da F05 com dois commits.** O avaliador da F05 commitou o relatório (`79f0f1c`) e, na
  mesma sessão, fez um segundo commit (`e226fc7`) reescrevendo uma frase das evidências da checagem
  extra (b), sem mudar nenhum veredito. Isso fere a regra "relatório não é alterado depois do commit".
  Unir os dois commits exigiria reescrever o histórico da branch (force push), o que não foi feito.
  `git log -- docs/features/F05-checkin-painel/reports/2026-10-03-1716-avaliacao.md` mostra os dois commits.
  A regra foi reforçada em `docs/avaliador.md` e no `AGENTS.md`, e a avaliação seguinte (F06) saiu
  num único commit.
- Algumas features posteriores ajustaram código de features anteriores (ex.: F02 passou a incluir
  `?next=` no redirect de POST do visitante em `src/auth.js`, de F01; F06 passou a recusar com 409 a
  edição de evento cancelado em `src/features/events/routes.js`). Os testes das features anteriores foram
  ajustados no mesmo PR, e os gates na `main` cobrem todas as features juntas.
