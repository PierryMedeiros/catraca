# F02 — Gestão de eventos — contrato de avaliação

> Para o **avaliador** (agente diferente do implementador). Leia só este contrato, o `docs/prd.md`, o `AGENTS.md` e o código; não use o histórico do implementador.
> Cada item F02-Cnn tem passos exatos, resultado esperado observável e critério de aprovação objetivo. Um item só é APROVADO se **todas** as condições do critério valerem.
> Critérios cobertos: F02-AC01 a F02-AC11, X-01, X-02 (tabela na seção 4). Decisões de referência: `spec.md`.

## 1. Pré-requisitos de ambiente

Execute tudo em **bash** (não zsh), a partir da raiz do repositório, no commit avaliado. Precisa de Docker, Git e `curl` no host.

```bash
cd /caminho/para/catraca              # raiz do repositório (clone avaliado)
git rev-parse --short HEAD            # anote no relatório
export APP_PORT=${APP_PORT:-3000}     # use outra porta (ex.: 3102) se a 3000 estiver ocupada
./scripts/up.sh                       # build + banco + migrações + seed; retorna com o app saudável
curl -fsS "http://localhost:$APP_PORT/health" -o /dev/null -w '%{http_code}\n'   # esperado: 200
```

Contas da seed (PRD, seção 10), todas com senha `catraca123`:

| Papel | E-mail |
|---|---|
| Organizador A | `org.a@catraca.local` |
| Organizador B | `org.b@catraca.local` |
| Participante | `participante@catraca.local` |

F02 não usa a chave de parceiro nem as variáveis do gateway (`GATEWAY_FAST_DELAY_MS`, `GATEWAY_SLOW_DELAY_MS`): use o modo padrão, sem variáveis extras.

### 1.1 Funções auxiliares (cole no shell uma vez)

```bash
WEB="http://localhost:$APP_PORT"
T=$(mktemp -d); JA=$T/a.jar; JB=$T/b.jar; JP=$T/p.jar; JA2=$T/a2.jar
DB_SVC=$(docker compose ps --services | grep -vx app | head -n1)   # serviço do Postgres no Compose

# SQL no banco do app (saída sem cabeçalho, colunas separadas por |)
sql() { printf '%s\n' "$1" | docker compose exec -T "$DB_SVC" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -qtA'; }

# Data/hora local do CONTAINER do app, deslocada em minutos, no formato datetime-local com segundos
cdate() { docker compose exec -T app node -e 'const d=new Date(Date.now()+Number(process.argv[1])*60000);const p=n=>String(n).padStart(2,"0");process.stdout.write(`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`)' -- "$1"; }

# Login pelo formulário de F01; imprime "status destino"
login() { rm -f "$1"; curl -s -o /dev/null -c "$1" -b "$1" -w '%{http_code} %{redirect_url}\n' -X POST "$WEB/login" --data-urlencode "email=$2" --data-urlencode "password=catraca123"; }

# Requisição com cookie jar (vazio = visitante). Corpo em $T/body, cabeçalhos em $T/hdr. Imprime "status location"
req() {
  local jar=$1 method=$2 path=$3; shift 3
  local args=(-s -o "$T/body" -D "$T/hdr" -X "$method" -w '%{http_code}')
  [ -n "$jar" ] && args+=(-b "$jar" -c "$jar")
  if [ "$method" = POST ] && [ $# -eq 0 ]; then args+=(--data ''); fi
  for kv in "$@"; do args+=(--data-urlencode "$kv"); done
  local code; code=$(curl "${args[@]}" "$WEB$path")
  echo "$code $(tr -d '\r' < "$T/hdr" | awk 'tolower($1)=="location:"{print $2}')"
}

# Cria evento (rascunho, início em +30 dias) e imprime o id
new_event() { local s; s=$(cdate 43200); req "$1" POST /org/events "name=$2" "startsAt=$s" "venue=Sala F02" "capacity=$3" "price=$4" | grep -o 'evt_[a-z0-9]\{10\}$'; }

# Impressão digital da linha do evento (para provar "nada mudou")
rowmd5() { sql "SELECT md5(e::text) FROM events e WHERE id='$1'"; }
```

Se o formulário de `/login` de F01 usar nomes de campo diferentes de `email`/`password` (confira em `curl -s $WEB/login`), ajuste só a função `login` e registre isso no relatório.

### 1.2 Preparação comum

```bash
login "$JA" org.a@catraca.local          # esperado: 302 .../org/events
login "$JB" org.b@catraca.local          # esperado: 302 .../org/events
login "$JP" participante@catraca.local   # esperado: 302 (destino do participante, ex.: .../)
AID=$(sql "SELECT id FROM users WHERE email='org.a@catraca.local'")
BID=$(sql "SELECT id FROM users WHERE email='org.b@catraca.local'")
E0=$(new_event "$JA" "Evento Base F02" 2 100); echo "$E0"   # esperado: evt_ + 10 caracteres
```

Os itens podem ser executados na ordem abaixo; cada um cria os eventos de que precisa (não assuma banco vazio).

## 2. Itens verificáveis

### F02-C01 — Migração 002 e esquema de `events`

Passos:

```bash
sql "SELECT * FROM schema_migrations" | grep -c '002'
sql "SELECT column_name||':'||data_type FROM information_schema.columns WHERE table_name='events' ORDER BY column_name"
sql "SELECT data_type FROM information_schema.columns WHERE table_name='users' AND column_name='id'"
ins() { sql "BEGIN; INSERT INTO events (id, organizer_id, name, starts_at, venue, capacity, price_cents, status) VALUES ($1, '$AID', 'x', now() + interval '1 day', 'y', $2, $3, $4) RETURNING status; ROLLBACK;" 2>&1 | grep -o -m1 -E 'violates check constraint|^draft$'; }
ins "'evt_c01aaaaaaa'" 1 100 DEFAULT
ins "'evt_c01aaaaaaa'" 0 100 DEFAULT
ins "'evt_c01aaaaaaa'" 1 0   DEFAULT
ins "'evt_c01aaaaaaa'" 1 100 "'x'"
ins "'abc'"            1 100 DEFAULT
```

Esperado:
- 1ª linha: `1` ou mais (a migração 002 está registrada).
- Colunas exatamente: `cancelled_at:timestamp with time zone`, `capacity:integer`, `created_at:timestamp with time zone`, `id:text`, `name:text`, `organizer_id:<mesmo data_type de users.id>`, `price_cents:integer`, `starts_at:timestamp with time zone`, `status:text`, `updated_at:timestamp with time zone`, `venue:text`.
- `ins` válido imprime `draft` (status padrão); os outros quatro imprimem uma linha com `violates check constraint`.

Critério: todas as condições acima; nenhuma linha `evt_c01aaaaaaa` persiste (`sql "SELECT count(*) FROM events WHERE id='evt_c01aaaaaaa'"` = `0`).

### F02-C02 — Guardas de F01 nas rotas de F02 (X-01, R13)

Passos:

```bash
N0=$(sql "SELECT count(*) FROM events"); M0=$(rowmd5 "$E0"); S=$(cdate 43200)
# visitante
req "" GET  /org/events
req "" GET  /org/events/new
req "" GET  /org/events/$E0
req "" POST /org/events "name=Intruso" "startsAt=$S" "venue=X" "capacity=1" "price=10"
req "" POST /org/events/$E0/edit "name=Intruso" "startsAt=$S" "venue=X" "capacity=9" "price=10"
req "" POST /org/events/$E0/publish
# participante da seed
req "$JP" GET  /org/events
req "$JP" GET  /org/events/$E0; grep -c -F -e "$E0" -e "Evento Base F02" -e "Sala F02" "$T/body"
req "$JP" POST /org/events "name=Intruso" "startsAt=$S" "venue=X" "capacity=1" "price=10"
req "$JP" POST /org/events/$E0/edit "name=Intruso" "startsAt=$S" "venue=X" "capacity=9" "price=10"
req "$JP" POST /org/events/$E0/publish
echo "$N0 $(sql "SELECT count(*) FROM events")"; [ "$M0" = "$(rowmd5 "$E0")" ] && echo INTACTO
```

Esperado:
- As 6 requisições de visitante: `302` com `Location` casando `^(https?://[^/]+)?/login\?next=` (o `next` aponta para o caminho pedido, codificado ou não).
- As 5 do participante: `403`; o `grep -c` do corpo da gestão imprime `0`.
- Contagem de eventos igual antes/depois; `INTACTO`.

Critério: todas as condições acima.

### F02-C03 — Criação pelo organizador logado via `/login` (F02-AC01, X-02, R01, R02, R04)

Passos:

```bash
login "$JA" org.a@catraca.local
req "$JA" GET /org/events/new; grep -c -F 'action="/org/events"' "$T/body"
S=$(cdate 43200)
R=$(req "$JA" POST /org/events "name=Jazz no Porão" "startsAt=$S" "venue=Porão" "capacity=2" "price=100,00"); echo "$R"
E1=$(echo "$R" | grep -o 'evt_[a-z0-9]\{10\}$'); echo "$E1"
sql "SELECT id ~ '^evt_[a-z0-9]{10}$', status, organizer_id::text = '$AID', name, venue, capacity, price_cents, cancelled_at IS NULL FROM events WHERE id='$E1'"
```

Esperado:
- Login: `302` com destino terminando em `/org/events`.
- Formulário: `200` e `grep` = `1` ou mais.
- Criação: `302 /org/events/evt_xxxxxxxxxx` (Location relativa ou absoluta terminando em `/org/events/<id>`).
- SQL: `t|draft|t|Jazz no Porão|Porão|2|10000|t`.

Critério: todas as condições acima.

### F02-C04 — Logout encerra o acesso à gestão (X-02)

Passos:

```bash
req "$JA" POST /logout
req "$JA" GET /org/events/$E1; grep -c -F 'Jazz no Porão' "$T/body"
login "$JA" org.a@catraca.local    # reabre a sessão para os próximos itens
```

Esperado: logout com `302`; a gestão responde `302` com `Location` casando `^(https?://[^/]+)?/login\?next=` e o `grep` imprime `0`.

Critério: as duas condições.

### F02-C05 — Criação inválida é rejeitada sem criar linha (F02-AC02, F02-AC03, R01)

Passos:

```bash
S=$(cdate 43200); N0=$(sql "SELECT count(*) FROM events")
caso() { local r; r=$(req "$JA" POST /org/events "name=$3" "startsAt=$4" "venue=$5" "capacity=$6" "price=$7")
         echo "$1 => $r | msg=$(grep -c -F -- "$2" "$T/body") | topo=$(grep -c -F 'Não foi possível salvar. Corrija os campos indicados.' "$T/body")"; }
NOME='Informe o nome do evento.'; LOCAL='Informe o local do evento.'
LOT='A lotação deve ser um número inteiro maior ou igual a 1.'
PRECO='Informe um preço maior que zero, em reais, com até 2 casas decimais (ex.: 100,00).'
DINV='Informe uma data e hora de início válidas.'; DPAS='A data de início precisa estar no futuro.'
caso nome-vazio     "$NOME"  ""      "$S" "Sala" 2 100
caso nome-espacos   "$NOME"  "   "   "$S" "Sala" 2 100
caso local-vazio    "$LOCAL" "Show"  "$S" ""     2 100
caso lot-0          "$LOT"   "Show"  "$S" "Sala" 0 100
caso lot-neg        "$LOT"   "Show"  "$S" "Sala" -1 100
caso lot-frac       "$LOT"   "Show"  "$S" "Sala" 2.5 100
caso lot-texto      "$LOT"   "Show"  "$S" "Sala" abc 100
caso lot-vazia      "$LOT"   "Show"  "$S" "Sala" "" 100
caso lot-enorme     "$LOT"   "Show"  "$S" "Sala" 99999999999 100
caso preco-vazio    "$PRECO" "Show"  "$S" "Sala" 2 ""
caso preco-texto    "$PRECO" "Show"  "$S" "Sala" 2 abc
caso preco-zero     "$PRECO" "Show"  "$S" "Sala" 2 0
caso preco-neg      "$PRECO" "Show"  "$S" "Sala" 2 -5
caso preco-3casas   "$PRECO" "Show"  "$S" "Sala" 2 10,123
caso preco-milhar   "$PRECO" "Show"  "$S" "Sala" 2 1.234,56
caso preco-enorme   "$PRECO" "Show"  "$S" "Sala" 2 99999999999
caso data-vazia     "$DINV"  "Show"  ""   "Sala" 2 100
caso data-texto     "$DINV"  "Show"  "amanhã" "Sala" 2 100
caso data-inexist   "$DINV"  "Show"  "2099-02-30T10:00" "Sala" 2 100
caso data-ontem     "$DPAS"  "Show"  "$(cdate -1440)" "Sala" 2 100
caso data-menos1min "$DPAS"  "Show"  "$(cdate -1)"    "Sala" 2 100
# valores digitados são reexibidos
req "$JA" POST /org/events "name=Nome Mantido C05" "startsAt=$S" "venue=Local Mantido C05" "capacity=0" "price=100"
grep -c -F -e 'value="Nome Mantido C05"' -e 'value="Local Mantido C05"' "$T/body"
# corpo vazio: todos os campos com erro, sem erro 500
req "$JA" POST /org/events
for m in "$NOME" "$LOCAL" "$LOT" "$PRECO" "$DINV"; do grep -c -F -- "$m" "$T/body"; done
echo "$N0 $(sql "SELECT count(*) FROM events")"
```

Esperado:
- Cada `caso` imprime `=> 422` (sem Location), `msg=` ≥ 1 e `topo=` ≥ 1.
- Reexibição: `422` e o `grep -c` = `2` (as duas linhas com `value=…`; se ambas estiverem na mesma linha HTML, `1`, desde que `grep -F 'value="Nome Mantido C05"'` e `grep -F 'value="Local Mantido C05"'` casem cada um).
- Corpo vazio: `422`, e os 5 `grep -c` ≥ 1.
- As duas contagens finais iguais.

Critério: todas as condições acima (qualquer `302` ou `500` reprova).

### F02-C06 — Formatos de preço aceitos (F02-AC03, R01)

Passos:

```bash
S=$(cdate 43200)
for p in "100" "100,00" "100.00" "R\$ 100,00" "150,5"; do
  r=$(req "$JA" POST /org/events "name=Preço C06" "startsAt=$S" "venue=Sala" "capacity=1" "price=$p"); id=$(echo "$r" | grep -o 'evt_[a-z0-9]\{10\}$')
  echo "[$p] $r -> $(sql "SELECT price_cents FROM events WHERE id='$id'")"
done
```

Esperado: cinco linhas `302 …/org/events/evt_…` com `price_cents` `10000`, `10000`, `10000`, `10000`, `15050`, nessa ordem. (As rejeições de AC03 — `1.234,56`, `10,123`, `abc`, `-5`, `0` — estão em F02-C05.)

Critério: os cinco valores exatos.

### F02-C07 — Datas no fuso do container (F02-AC11, R01)

Passos:

```bash
docker compose exec -T app printenv TZ
r=$(req "$JA" POST /org/events "name=Data C07 +1" "startsAt=$(cdate 1)" "venue=Sala" "capacity=1" "price=10"); echo "+1min: $r"
r=$(req "$JA" POST /org/events "name=Data C07 -1" "startsAt=$(cdate -1)" "venue=Sala" "capacity=1" "price=10"); echo "-1min: $r"; grep -c -F 'A data de início precisa estar no futuro.' "$T/body"
S=$(cdate 43200 | cut -c1-16); echo "$S"                 # formato do datetime-local sem segundos
E7=$(req "$JA" POST /org/events "name=Data C07" "startsAt=$S" "venue=Sala" "capacity=1" "price=10" | grep -o 'evt_[a-z0-9]\{10\}$')
EXP=$(echo "$S" | sed -E 's#^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}:[0-9]{2})$#\3/\2/\1 \4#'); echo "$EXP"
req "$JA" GET /org/events/$E7; grep -c -F "$EXP" "$T/body"; grep -c -F "value=\"$S\"" "$T/body"
req "$JA" GET /org/events;     grep -c -F "$EXP" "$T/body"
echo "$(sql "SELECT extract(epoch FROM starts_at)::bigint FROM events WHERE id='$E7'") $(docker compose exec -T app node -e 'console.log(new Date(process.argv[1]).getTime()/1000)' -- "$S")"
```

Esperado:
- `TZ` não vazio (anote o valor).
- `+1min: 302 …/org/events/evt_…`; `-1min: 422` e o `grep` ≥ 1.
- Gestão de E7: `200`, `EXP` (formato `dd/mm/aaaa HH:mm`) aparece (≥ 1) e o campo de edição vem preenchido com `value="<S>"` (≥ 1); a lista "Meus eventos" também mostra `EXP` (≥ 1).
- Os dois números da última linha são iguais (o instante gravado é o horário local do container).

Critério: todas as condições acima.

### F02-C08 — "Meus eventos" mostra só os próprios eventos (F02-AC04, R13)

Passos:

```bash
EA=$(new_event "$JA" "Lista C08 do A" 3 30); EB=$(new_event "$JB" "Lista C08 do B" 3 30)
req "$JA" POST /org/events/$EA/publish
req "$JA" GET /org/events; cp "$T/body" "$T/lista_a"
req "$JB" GET /org/events; cp "$T/body" "$T/lista_b"
grep -c -F "href=\"/org/events/$EA\"" "$T/lista_a"; grep -c -F -e "$EB" -e "Lista C08 do B" "$T/lista_a"
grep -c -F "href=\"/org/events/$EB\"" "$T/lista_b"; grep -c -F -e "$EA" -e "Lista C08 do A" "$T/lista_b"
echo "A: $(grep -o 'href="/org/events/evt_[a-z0-9]\{10\}"' "$T/lista_a" | wc -l) = $(sql "SELECT count(*) FROM events WHERE organizer_id::text='$AID'")"
echo "B: $(grep -o 'href="/org/events/evt_[a-z0-9]\{10\}"' "$T/lista_b" | wc -l) = $(sql "SELECT count(*) FROM events WHERE organizer_id::text='$BID'")"
grep -c -F 'publicado' "$T/lista_a"; grep -c -F 'rascunho' "$T/lista_a"; grep -c -F 'rascunho' "$T/lista_b"
```

Esperado: as duas listas `200`; link próprio ≥ 1 e evento alheio `0` em cada lista; os dois lados de cada `=` iguais; `publicado` ≥ 1 na lista de A, `rascunho` ≥ 1 nas duas.

Critério: todas as condições acima.

### F02-C09 — Página de gestão com URL própria (F02-AC05, R04)

Passos:

```bash
req "$JA" GET /org/events/$E1
for s in "Jazz no Porão" "Porão" "R\$ 100,00" "Status: rascunho" "action=\"/org/events/$E1/publish\"" "action=\"/org/events/$E1/edit\"" "Publicar" "Salvar alterações" 'value="100,00"'; do
  echo "[$s] $(grep -c -F -- "$s" "$T/body")"; done
login "$JA2" org.a@catraca.local; req "$JA2" GET /org/events/$E1; grep -c -F 'Jazz no Porão' "$T/body"
```

Esperado: `200`; todas as strings com contagem ≥ 1; em sessão nova, a mesma URL aberta diretamente responde `200` com o nome (≥ 1).

Critério: todas as condições acima.

### F02-C10 — Publicar e republicar (F02-AC06, R02)

Passos:

```bash
U0=$(sql "SELECT updated_at FROM events WHERE id='$E1'")
req "$JA" POST /org/events/$E1/publish
U1=$(sql "SELECT updated_at FROM events WHERE id='$E1'"); sql "SELECT status FROM events WHERE id='$E1'"; [ "$U0" != "$U1" ] && echo MUDOU
req "$JA" GET /org/events/$E1; grep -c -F "action=\"/org/events/$E1/publish\"" "$T/body"; grep -c -F 'Status: publicado' "$T/body"
req "$JA" POST /org/events/$E1/publish
sql "SELECT status FROM events WHERE id='$E1'"; [ "$U1" = "$(sql "SELECT updated_at FROM events WHERE id='$E1'")" ] && echo IGUAL
```

Esperado: 1º publish `302 /org/events/$E1`, status `published`, `MUDOU`; gestão sem o formulário de publicar (`0`) e com `Status: publicado` (≥ 1); 2º publish `302 /org/events/$E1`, status `published`, `IGUAL`.

Critério: todas as condições acima.

### F02-C11 — Edição válida de publicado e de rascunho (F02-AC07, R01)

Passos:

```bash
S=$(cdate 50000 | cut -c1-16)
req "$JA" POST /org/events/$E1/edit "name=Jazz no Porão II" "startsAt=$S" "venue=Porão 2" "capacity=3" "price=150,00"
sql "SELECT status, name, venue, capacity, price_cents FROM events WHERE id='$E1'"
echo "$(sql "SELECT extract(epoch FROM starts_at)::bigint FROM events WHERE id='$E1'") $(docker compose exec -T app node -e 'console.log(new Date(process.argv[1]).getTime()/1000)' -- "$S")"
ED=$(new_event "$JA" "Rascunho C11" 2 20)
req "$JA" POST /org/events/$ED/edit "name=Rascunho C11 editado" "startsAt=$S" "venue=Sala nova" "capacity=4" "price=25,50"
sql "SELECT status, name, venue, capacity, price_cents FROM events WHERE id='$ED'"
```

Esperado: as duas edições `302` para a própria gestão; `published|Jazz no Porão II|Porão 2|3|15000`; os dois números iguais; `draft|Rascunho C11 editado|Sala nova|4|2550`.

Critério: todas as condições acima.

### F02-C12 — Edição inválida não altera a linha (F02-AC07, R01)

Passos:

```bash
M0=$(rowmd5 "$E1"); S=$(cdate 43200)
ed() { local r; r=$(req "$JA" POST /org/events/$E1/edit "name=$2" "startsAt=$3" "venue=$4" "capacity=$5" "price=$6")
       echo "$1 => $r | msg=$(grep -c -F -- "$7" "$T/body") | form=$(grep -c -F "action=\"/org/events/$E1/edit\"" "$T/body")"; }
ed nome-vazio  ""     "$S" "Sala" 3 100 'Informe o nome do evento.'
ed lot-0       "Show" "$S" "Sala" 0 100 'A lotação deve ser um número inteiro maior ou igual a 1.'
ed preco-texto "Show" "$S" "Sala" 3 abc 'Informe um preço maior que zero, em reais, com até 2 casas decimais (ex.: 100,00).'
ed data-ontem  "Show" "$(cdate -1440)" "Sala" 3 100 'A data de início precisa estar no futuro.'
ed data-menos1 "Show" "$(cdate -1)"    "Sala" 3 100 'A data de início precisa estar no futuro.'
ed data-vazia  "Show" ""               "Sala" 3 100 'Informe uma data e hora de início válidas.'
[ "$M0" = "$(rowmd5 "$E1")" ] && echo INTACTO
```

Esperado: cada linha `=> 422`, `msg=` ≥ 1, `form=` ≥ 1 (página de gestão reexibida com o formulário); `INTACTO`.

Critério: todas as condições acima.

### F02-C13 — Lotação × vagas ocupadas dentro da trava (F02-AC08, R03, R05)

Em F02 ainda não existe a tabela `tickets` (F03). O item exercita `getSeatStats` e `updateEvent` diretamente no container, com uma tabela `TEMP tickets` que só existe na transação do teste (spec, seção 8.1).

Passos:

```bash
E8=$(new_event "$JA" "Lotação C13" 5 100); M0=$(rowmd5 "$E8")
docker compose exec -T -e E="$E8" -e ORG="$AID" app node --input-type=module - <<'EOF'
import { pathToFileURL } from 'node:url';
const load = async (p) => { const m = await import(pathToFileURL(`${process.cwd()}/${p}`).href); return { ...(m.default ?? {}), ...m }; };
const { pool } = await load('src/db.js');
const repo = await load('src/features/events/repo.js');
const svc = await load('src/features/events/service.js');
const { E, ORG } = process.env;
const p = (n) => String(n).padStart(2, '0');
const d = new Date(Date.now() + 30 * 864e5);
const startsAt = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
const input = (capacity) => ({ name: 'Lotação C13', venue: 'Sala F02', price: '100,00', startsAt, capacity });
const out = { semVendas: await repo.getSeatStats(pool, E) };
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('CREATE TEMP TABLE tickets (event_id text, status text) ON COMMIT DROP');
  await client.query(`INSERT INTO tickets VALUES ($1,'pending'),($1,'confirmed'),($1,'declined'),($1,'cancelled'),($1,'refunded')`, [E]);
  out.comVendas = await repo.getSeatStats(client, E);
  const r1 = await svc.updateEvent(client, { eventId: E, organizerId: ORG, input: input('1') });
  out.lotacao1 = { ok: r1.ok, reason: r1.reason, erro: r1.errors?.capacity };
  const r2 = await svc.updateEvent(client, { eventId: E, organizerId: ORG, input: input('2') });
  out.lotacao2 = { ok: r2.ok, capacity: r2.event?.capacity };
  await client.query('ROLLBACK');
} finally { client.release(); await pool.end(); }
console.log(JSON.stringify(out));
EOF
[ "$M0" = "$(rowmd5 "$E8")" ] && echo INTACTO
grep -n "FOR UPDATE" src/features/events/repo.js
grep -n -E "lockEvent|getSeatStats|withTransaction" src/features/events/service.js src/features/events/routes.js
```

Esperado:
- JSON com: `semVendas` = `{capacity:5, occupied:0, available:5}`; `comVendas` = `{capacity:5, occupied:2, available:3}`; `lotacao1` = `{ok:false, reason:"invalid", erro:"A lotação não pode ser menor que as vagas ocupadas (2)"}`; `lotacao2` = `{ok:true, capacity:2}` (ordem das chaves irrelevante; números como números).
- `INTACTO` (o ROLLBACK desfez a edição de teste).
- `FOR UPDATE` presente em `lockEvent`; lendo `updateEvent` e `publishEvent` em `service.js`, a primeira consulta de cada uma é `lockEvent(client, …)` e `getSeatStats` só é chamada depois dela; as rotas `…/edit` e `…/publish` chamam essas funções dentro de `withTransaction`.

Critério: todas as condições acima.

### F02-C14 — Edição e publicação esperam a trava do evento (concorrência, F02-AC08, R03) — 3 rodadas

Uma sessão `psql` segura `SELECT … FOR UPDATE` na linha por 5 s; a edição e a publicação precisam esperar.

Passos:

```bash
for i in 1 2 3; do
  E=$(new_event "$JA" "Trava C14 $i" 2 10); S=$(cdate 43200)
  curl -s -o /dev/null -b "$JA" -w "r$i controle %{http_code} %{time_total}\n" -X POST "$WEB/org/events/$E/edit" \
    --data-urlencode "name=Trava C14 $i" --data-urlencode "startsAt=$S" --data-urlencode "venue=Sala" --data-urlencode "capacity=3" --data-urlencode "price=10"
  sql "BEGIN; SELECT id FROM events WHERE id='$E' FOR UPDATE; SELECT pg_sleep(5); COMMIT;" >/dev/null & sleep 1
  curl -s -o /dev/null -b "$JA" -w "r$i edit %{http_code} %{time_total}\n" -X POST "$WEB/org/events/$E/edit" \
    --data-urlencode "name=Trava C14 $i" --data-urlencode "startsAt=$S" --data-urlencode "venue=Sala" --data-urlencode "capacity=4" --data-urlencode "price=10"
  wait
  sql "BEGIN; SELECT id FROM events WHERE id='$E' FOR UPDATE; SELECT pg_sleep(5); COMMIT;" >/dev/null & sleep 1
  curl -s -o /dev/null -b "$JA" -w "r$i publish %{http_code} %{time_total}\n" -X POST "$WEB/org/events/$E/publish" --data ''
  wait
  echo "r$i final $(sql "SELECT capacity, status FROM events WHERE id='$E'")"
done
```

Esperado, em **cada uma** das 3 rodadas (eventos novos): `controle 302` com tempo < 1.0; `edit 302` com tempo ≥ 3.0; `publish 302` com tempo ≥ 3.0; `final 4|published`.

Critério: as 3 rodadas atendem todas as condições.

### F02-C15 — Publicações e edições simultâneas (concorrência, F02-AC06, F02-AC07) — 3 rodadas

Passos:

```bash
for i in 1 2 3; do
  E=$(new_event "$JA" "Concorrência C15 $i" 2 10); S=$(cdate 43200)
  echo "r$i publish:"; seq 20 | xargs -P 20 -I{} curl -s -o /dev/null -w "%{http_code}\n" -b "$JA" -X POST "$WEB/org/events/$E/publish" --data '' | sort | uniq -c
  echo "r$i edit:";    seq 3 12 | xargs -P 10 -I{} curl -s -o /dev/null -w "%{http_code}\n" -b "$JA" -X POST "$WEB/org/events/$E/edit" \
    --data-urlencode "name=Concorrência C15 $i" --data-urlencode "startsAt=$S" --data-urlencode "venue=Sala" --data-urlencode "capacity={}" --data-urlencode "price=10" | sort | uniq -c
  echo "r$i final $(sql "SELECT status, capacity BETWEEN 3 AND 12 FROM events WHERE id='$E'")"
done
```

Esperado, em cada rodada: `20 302` (nenhum outro código) na publicação; `10 302` na edição; `final published|t`.

Critério: as 3 rodadas atendem todas as condições (qualquer `500`, `409` ou `422` reprova).

### F02-C16 — Evento de outro organizador = 404 idêntico ao inexistente (F02-AC09, R13)

Passos:

```bash
EA9=$(new_event "$JA" "Segredo C16" 2 10); M0=$(rowmd5 "$EA9"); M1=$(rowmd5 "$E1"); S=$(cdate 43200)
req "$JB" GET /org/events/$EA9;                 cp "$T/body" "$T/b1"
req "$JB" GET /org/events/evt_zzzzzzzzzz;       cp "$T/body" "$T/b0"
req "$JB" GET "/org/events/abc";                cp "$T/body" "$T/b2"
req "$JB" GET "/org/events/evt_x'%20OR%20'1'%3D'1"; cp "$T/body" "$T/b3"
req "$JB" POST /org/events/$EA9/edit "name=Invasor" "startsAt=$S" "venue=X" "capacity=9" "price=1"; cp "$T/body" "$T/b4"
req "$JB" POST /org/events/$EA9/publish;        cp "$T/body" "$T/b5"
req "$JB" POST /org/events/$E1/publish;         cp "$T/body" "$T/b6"
for f in b1 b2 b3 b4 b5 b6; do cmp -s "$T/b0" "$T/$f" && echo "$f IDENTICO" || echo "$f DIFERENTE"; done
grep -c -F 'Evento não encontrado' "$T/b0"
cat "$T"/b1 "$T"/b4 "$T"/b5 "$T"/b6 | grep -c -F -e "$EA9" -e "$E1" -e "Segredo C16" -e "Sala F02" -e "Jazz no Porão" -e "Porão 2"
[ "$M0" = "$(rowmd5 "$EA9")" ] && [ "$M1" = "$(rowmd5 "$E1")" ] && echo INTACTOS; sql "SELECT status FROM events WHERE id='$EA9'"
req "$JA" GET /org/events/evt_zzzzzzzzzz; grep -c -F 'Evento não encontrado' "$T/body"
```

Esperado: as 7 requisições de B respondem `404`; `b1`…`b6` `IDENTICO` a `b0`; `Evento não encontrado` ≥ 1; o `grep` de dados de A imprime `0`; `INTACTOS`; status `draft`; A em id inexistente: `404` e ≥ 1.

Critério: todas as condições acima.

### F02-C17 — `listOnSaleEvents` e `getOnSaleEvent` (F02-AC10, R02)

Passos:

```bash
docker compose exec -T -e ORG="$AID" app node --input-type=module - <<'EOF'
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
const load = async (p) => { const m = await import(pathToFileURL(`${process.cwd()}/${p}`).href); return { ...(m.default ?? {}), ...m }; };
const { pool } = await load('src/db.js');
const repo = await load('src/features/events/repo.js');
const { ORG } = process.env;
const mk = async (status, days) => {
  const id = 'evt_' + randomBytes(5).toString('hex');
  await pool.query(`INSERT INTO events (id, organizer_id, name, starts_at, venue, capacity, price_cents, status, cancelled_at)
    VALUES ($1, $2, $3, now() + make_interval(days => $4::int), 'Sala C17', 5, 1000, $5::text, CASE WHEN $5::text = 'cancelled' THEN now() END)`,
    [id, ORG, `C17 ${status} ${days}`, days, status]);
  return id;
};
const ids = { draft: await mk('draft', 10), pubTarde: await mk('published', 20), pubCedo: await mk('published', 5), cancelled: await mk('cancelled', 1) };
try {
  const list = await repo.listOnSaleEvents(pool);
  const nossos = list.filter((e) => Object.values(ids).includes(e.id)).map((e) => e.id);
  console.log(JSON.stringify({
    nossosNaOrdem: nossos.join(',') === [ids.pubCedo, ids.pubTarde].join(','),
    todosPublicados: list.every((e) => e.status === 'published'),
    ordenadoPorInicio: list.every((e, k) => k === 0 || new Date(list[k - 1].starts_at) <= new Date(e.starts_at)),
    getOnSale: {
      publicado: (await repo.getOnSaleEvent(pool, ids.pubCedo))?.id === ids.pubCedo,
      rascunho: await repo.getOnSaleEvent(pool, ids.draft),
      cancelado: await repo.getOnSaleEvent(pool, ids.cancelled),
      inexistente: await repo.getOnSaleEvent(pool, 'evt_zzzzzzzzzz'),
    },
  }));
} finally {
  await pool.query('DELETE FROM events WHERE id = ANY($1)', [Object.values(ids)]);
  await pool.end();
}
EOF
```

Esperado, exatamente: `{"nossosNaOrdem":true,"todosPublicados":true,"ordenadoPorInicio":true,"getOnSale":{"publicado":true,"rascunho":null,"cancelado":null,"inexistente":null}}`.

Critério: saída idêntica à esperada.

### F02-C18 — Evento cancelado não é editável nem republicável (guarda defensiva; base para F06-AC03 e X-13)

Passos:

```bash
EC=$(new_event "$JA" "Cancelado C18" 2 10); req "$JA" POST /org/events/$EC/publish
sql "UPDATE events SET status='cancelled', cancelled_at=now() WHERE id='$EC'"; M0=$(rowmd5 "$EC"); S=$(cdate 43200)
req "$JA" GET /org/events/$EC
for s in 'Status: cancelado' 'Este evento foi cancelado e não pode ser alterado.' "action=\"/org/events/$EC/edit\"" "action=\"/org/events/$EC/publish\""; do echo "[$s] $(grep -c -F -- "$s" "$T/body")"; done
req "$JA" POST /org/events/$EC/edit "name=Volta" "startsAt=$S" "venue=X" "capacity=9" "price=1"; grep -c -F 'Este evento foi cancelado e não pode ser alterado.' "$T/body"
req "$JA" POST /org/events/$EC/publish; grep -c -F 'Este evento foi cancelado e não pode ser alterado.' "$T/body"
[ "$M0" = "$(rowmd5 "$EC")" ] && echo INTACTO
req "$JA" GET /org/events; grep -c -F 'cancelado' "$T/body"
```

Esperado: gestão `200` com `Status: cancelado` ≥ 1, aviso ≥ 1, `action=…/edit` = `0`, `action=…/publish` = `0`; `POST …/edit` e `POST …/publish` respondem `409` com o aviso (≥ 1); `INTACTO`; lista com `cancelado` ≥ 1.

Critério: todas as condições acima.

### F02-C19 — Robustez: escape de HTML e campos forjados

Passos:

```bash
S=$(cdate 43200)
EX=$(req "$JA" POST /org/events "name=<script>alert(1)</script>" "startsAt=$S" "venue=<b>Sala</b>" "capacity=1" "price=10" | grep -o 'evt_[a-z0-9]\{10\}$')
req "$JA" GET /org/events/$EX; grep -c -F '&lt;script&gt;alert(1)&lt;/script&gt;' "$T/body"; grep -c -F -e '<script>alert(1)' -e '<b>Sala</b>' "$T/body"
req "$JA" GET /org/events;     grep -c -F '&lt;script&gt;alert(1)&lt;/script&gt;' "$T/body"; grep -c -F '<script>alert(1)' "$T/body"
# campos extras na criação são ignorados
EF=$(req "$JA" POST /org/events "name=Forjado C19" "startsAt=$S" "venue=Sala" "capacity=1" "price=10" "status=published" "organizer_id=$BID" "id=evt_aaaaaaaaaa" | grep -o 'evt_[a-z0-9]\{10\}$')
sql "SELECT id <> 'evt_aaaaaaaaaa', status, organizer_id::text = '$AID' FROM events WHERE id='$EF'"
# campos extras na edição de um publicado são ignorados
req "$JA" POST /org/events/$EF/publish
req "$JA" POST /org/events/$EF/edit "name=Forjado C19" "startsAt=$S" "venue=Sala" "capacity=1" "price=10" "status=draft" "organizer_id=$BID"
sql "SELECT status, organizer_id::text = '$AID' FROM events WHERE id='$EF'"
```

Esperado: `&lt;script&gt;…` ≥ 1 na gestão e na lista; tags cruas `0` nas duas; `t|draft|t`; edição `302`; `published|t`.

Critério: todas as condições acima.

### F02-C20 — Gates passam com os testes de F02

Passos:

```bash
ls test/events-*.test.js
./scripts/gates.sh 2>&1 | tee "$T/gates.log"; echo "exit=${PIPESTATUS[0]}"
grep -E '^# (tests|pass|fail)' "$T/gates.log"
grep -c -E 'events-(validation|repo|http)' "$T/gates.log"
```

Esperado: os três arquivos `test/events-validation.test.js`, `test/events-repo.test.js`, `test/events-http.test.js` existem; `exit=0`; `# fail 0`; os testes de F02 aparecem na saída (≥ 1; se o reporter não imprimir nomes de arquivo, confira que `# tests` é maior que o total da linha de base de F01 e que os três arquivos contêm testes para F02-AC01 a AC11, X-01 e X-02, conforme `plan.md`, etapa 6).

Critério: `exit=0` e `# fail 0`, com os três arquivos de teste presentes e cobrindo os critérios.

### F02-C21 — Escopo da entrega e registro em `src/app.js`

Passos:

```bash
BASE=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main)
git diff --name-only "$BASE"..HEAD
git diff "$BASE"..HEAD -- src/app.js | grep -E '^[+-][^+-]'
```

Esperado: arquivos alterados contidos em: `db/migrations/002_events.sql`, `src/features/events/*`, `src/app.js`, `test/events-*.test.js`, `test/support/events.js`, `docs/features/F02-eventos/*`, `state.json` (e, se necessário, ajuste pontual em README documentando F02). Em `src/app.js`, exatamente **uma** linha adicionada relacionada a eventos (import + uso na mesma linha, ou uma linha de registro conforme o padrão de F01; se o padrão de F01 exigir import separado, no máximo 2 linhas) e nenhuma removida.

Critério: nenhum arquivo de outra feature alterado (`src/features/<outra área>/`, migrações 001/003+, `src/messages.js`); `src/app.js` conforme acima.

### Encerramento

```bash
./scripts/down.sh; rm -rf "$T"
```

## 3. Resumo dos itens

| Item | Tema | Tipo |
|---|---|---|
| F02-C01 | migração e esquema | positivo + negativo |
| F02-C02 | guardas de visitante/participante | negativo (acesso indevido) |
| F02-C03 | criação | positivo |
| F02-C04 | logout | negativo |
| F02-C05 | criação inválida | negativo (entradas inválidas) |
| F02-C06 | formatos de preço | positivo |
| F02-C07 | datas e fuso | positivo + negativo |
| F02-C08 | lista só com os próprios eventos | negativo (acesso indevido) |
| F02-C09 | página de gestão | positivo |
| F02-C10 | publicar/republicar | positivo |
| F02-C11 | edição válida | positivo |
| F02-C12 | edição inválida | negativo |
| F02-C13 | lotação × ocupadas | negativo + inspeção |
| F02-C14 | trava do evento (3 rodadas) | concorrência |
| F02-C15 | publicações/edições simultâneas (3 rodadas) | concorrência |
| F02-C16 | ownership 404 | negativo (acesso indevido) |
| F02-C17 | funções de venda | positivo + negativo |
| F02-C18 | evento cancelado | negativo |
| F02-C19 | escape e campos forjados | negativo (robustez) |
| F02-C20 | gates | automatizado |
| F02-C21 | escopo do diff | processo |

## 4. Mapeamento critério → itens

| Critério do PRD | Itens que o verificam |
|---|---|
| F02-AC01 | F02-C03 (também F02-C01, F02-C20) |
| F02-AC02 | F02-C05 (também F02-C20) |
| F02-AC03 | F02-C06, F02-C05 (também F02-C20) |
| F02-AC04 | F02-C08 (também F02-C20) |
| F02-AC05 | F02-C09 (também F02-C20) |
| F02-AC06 | F02-C10, F02-C15 (também F02-C20) |
| F02-AC07 | F02-C11, F02-C12, F02-C15 (também F02-C20) |
| F02-AC08 | F02-C13, F02-C14 (também F02-C20) |
| F02-AC09 | F02-C16 (também F02-C20) |
| F02-AC10 | F02-C17 (também F02-C20) |
| F02-AC11 | F02-C07, F02-C05 (casos de data) (também F02-C20) |
| X-01 (F01 → F02) | F02-C02 (também F02-C20) |
| X-02 (F01 → F02) | F02-C03, F02-C04 (também F02-C20) |

Itens adicionais (decisões da spec, sem critério próprio no PRD): F02-C18 (base de F06-AC03/X-13), F02-C19 (robustez), F02-C21 (paralelismo/entrega). Regras do brief exercitadas: R01, R02, R03, R04, R05, R13. Critérios de outras features que dependem de F02 (X-04, X-05, X-07, X-10, X-13) ficam nos contratos de F03–F06.

## 5. Relatório do avaliador

Crie um arquivo **novo** (nunca edite um relatório existente; reavaliação = arquivo novo):

`docs/features/F02-eventos/reports/AAAA-MM-DD-HHMM-avaliacao.md` (data/hora local do início da avaliação)

Conteúdo obrigatório:

```markdown
# Avaliação F02 — Gestão de eventos — AAAA-MM-DD HH:MM

- Data e hora: AAAA-MM-DD HH:MM (fuso)
- Commit avaliado: <hash curto> (<branch>)
- Ferramenta e modelo do avaliador: <ferramenta> / <modelo>
- Ambiente: APP_PORT=<porta>, TZ do container=<valor>, versões de `docker --version` e `docker compose version`
- Ajustes feitos no roteiro (ex.: nomes de campo do login), se houver: <...>

## Resultados

| Item | Veredito | Evidência resumida |
|---|---|---|
| F02-C01 | APROVADO/REPROVADO | ... |
| ... (todos os 21 itens) | | |

## Evidências

### F02-C01
<comandos executados e saída literal relevante (status HTTP, linhas de SQL, JSON, contagens)>
... (uma subseção por item)

## Critérios do PRD

| Critério | Itens | Veredito |
|---|---|---|
| F02-AC01 … F02-AC11, X-01, X-02 | (conforme seção 4 do contrato) | APROVADO/REPROVADO |

## Veredito final

APROVADO (todos os itens aprovados) ou REPROVADO (listar os itens reprovados e o comportamento observado × esperado).
```

Depois de commitar o relatório (um único commit para ele), atualize `state.json`: F02 `status` → `done` se aprovado ou `needs_fix` se reprovado, e `latestReport` → caminho do relatório.
