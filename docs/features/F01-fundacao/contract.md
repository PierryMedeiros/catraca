# F01 — Fundação e contas: contrato de avaliação

> Para o agente avaliador (não é quem implementou). Leia `AGENTS.md`, `docs/prd.md` (seção 6, F01) e a `spec.md` desta pasta; não use o histórico do implementador.
> Cada item F01-Cnn tem passos exatos, resultado esperado observável e critério de aprovação. Um item só é APROVADO se **todas** as condições do critério forem observadas. Cole a evidência (saída real) no relatório.
> Critérios cobertos: F01-AC01 a F01-AC12. Nenhum critério cross-feature X-nn tem contrato em F01 (seção 7 do PRD: X-01 a X-17 pertencem a F02–F06); a tabela da seção 4 registra isso.

## 1. Pré-requisitos e preparação do ambiente

Requisitos no host: Docker com Compose v2, Git, `curl`, `bash`, `base64`, `xargs`. Não rode `npm install`. Todos os comandos abaixo são executados **em bash**, numa única sessão de shell (as variáveis passam de um item para o outro), e a partir da pasta do clone.

```bash
set +e
export COMMIT=<sha completo do commit avaliado>
export AVAL="$(mktemp -d)"
git clone --quiet <URL ou caminho do repositório> "$AVAL/catraca-aval"
cd "$AVAL/catraca-aval" && git checkout --quiet "$COMMIT" && git log -1 --format='%H %s'

export APP_PORT=3000        # se 3000 estiver ocupada, use outra porta livre (ex.: 3150) em TODOS os itens
export WEB="http://localhost:$APP_PORT"
export PROJ="catraca-aval"  # projeto Compose = nome da pasta do clone
export J="$AVAL/tmp"; mkdir -p "$J"
SEEDS="'org.a@catraca.local','org.b@catraca.local','participante@catraca.local'"

# req JAR MÉTODO CAMINHO [args extras do curl] -> imprime "STATUS LOCATION"
#   corpo em $J/body.html, cabeçalhos em $J/h.txt, cookies em $J/JAR.jar
req() { local jar="$J/$1.jar" m="$2" p="$3"; shift 3
  curl -s -o "$J/body.html" -D "$J/h.txt" -b "$jar" -c "$jar" -X "$m" "$WEB$p" "$@"
  printf '%s %s\n' "$(awk 'NR==1{print $2}' "$J/h.txt")" \
    "$(grep -i '^location:' "$J/h.txt" | tr -d '\r' | awk '{print $2}')"; }
# has TEXTO -> "TEM: ..." ou "NÃO TEM: ..." (busca literal no último corpo)
has()   { grep -qF -- "$1" "$J/body.html" && echo "TEM: $1" || echo "NÃO TEM: $1"; }
sql()   { docker compose exec -T db psql -U catraca -d catraca -tAc "$1"; }
login() { rm -f "$J/$1.jar"; req "$1" POST /login --data-urlencode "email=$2" --data-urlencode "password=${3:-catraca123}"; }
waitup(){ for i in $(seq 90); do curl -fs "$WEB/health" >/dev/null && return 0; sleep 1; done; return 1; }
```

- Subida: `./scripts/up.sh` (modo padrão; nenhuma variável de atraso do gateway é necessária em F01).
- Contas da seed: `org.a@catraca.local`, `org.b@catraca.local`, `participante@catraca.local`, senha `catraca123`.
- Chave de parceiro padrão (só conferida como configuração): `catraca-parceiro-2026`.
- Na saída de `req`, `LOCATION` vazio aparece como `200 ` (status seguido de espaço).
- Ao final da avaliação (fora dos itens): `docker compose down -v --remove-orphans; rm -rf "$AVAL"`.

## 2. Itens verificáveis

### F01-C01 — Subida em clone limpo

```bash
test ! -e .env && test ! -e node_modules && echo LIMPO
time ./scripts/up.sh; echo "exit=$?"
curl -s -o /dev/null -w '%{http_code}\n' "$WEB/health"
docker compose ps --format '{{.Service}} {{.State}}' | sort
docker compose exec -T app node --version
docker compose exec -T db postgres --version
```

Esperado: `LIMPO`; a última linha do `up.sh` é `Catraca no ar em http://localhost:<APP_PORT> (TZ=<fuso>)` e `exit=0`; o `curl` executado imediatamente depois imprime `200`; `app running` e `db running`; Node `v24.`…; `postgres (PostgreSQL) 17.`….
Aprovação: todas as condições; nenhum passo manual entre o clone e o `200`.

### F01-C02 — Endpoint de saúde

```bash
curl -s -i "$WEB/health" | tr -d '\r'
```

Esperado: linha de status `HTTP/1.1 200 OK`; cabeçalho `Content-Type: application/json; charset=utf-8`; corpo exatamente `{"status":"ok"}`; nenhum cabeçalho `Set-Cookie`.
Aprovação: as quatro condições.

### F01-C03 — Runner de migrações

```bash
ls db/migrations
sql "SELECT version FROM schema_migrations ORDER BY version"
C1=$(sql "SELECT count(*) FROM schema_migrations"); echo "antes=$C1"
docker compose restart app && waitup && echo VOLTOU
sql "SELECT count(*) FROM schema_migrations"
sql "SELECT count(*) FROM schema_migrations WHERE version='001_users.sql'"
```

Esperado: `db/migrations` contém `001_users.sql`; `schema_migrations` lista uma linha por arquivo de `db/migrations`, incluindo `001_users.sql`; depois do restart, `VOLTOU`, a contagem é igual a `antes` e `001_users.sql` aparece exatamente `1` vez.
Aprovação: todas as condições.

### F01-C04 — Tabela `users`: colunas e restrições (negativo no banco)

```bash
sql "SELECT column_name||':'||data_type||':'||is_nullable FROM information_schema.columns WHERE table_name='users' ORDER BY column_name"
N0=$(sql "SELECT count(*) FROM users"); echo "N0=$N0"
sql "INSERT INTO users(id,name,email,password_hash,role) VALUES ('usr_aaaaaaaaaa','X','Maiusc@x.com','h','participant')"; echo "exit=$?"
sql "INSERT INTO users(id,name,email,password_hash,role) VALUES ('usr_aaaaaaaaab','X','admin@x.com','h','admin')"; echo "exit=$?"
sql "INSERT INTO users(id,name,email,password_hash,role) VALUES ('usr_aaaaaaaaac','X','org.a@catraca.local','h','participant')"; echo "exit=$?"
sql "INSERT INTO users(id,name,email,password_hash,role) VALUES ('usr_aaaaaaaaad','   ','vazio@x.com','h','participant')"; echo "exit=$?"
sql "SELECT count(*) FROM users"
```

Esperado: exatamente estas 6 linhas:
```
created_at:timestamp with time zone:NO
email:text:NO
id:text:NO
name:text:NO
password_hash:text:NO
role:text:NO
```
Cada `INSERT` imprime `ERROR:` e `exit=` diferente de 0 (o 1º, 2º e 4º com `violates check constraint`; o 3º com `duplicate key value violates unique constraint`). A contagem final é igual a `N0`.
Aprovação: todas as condições.

### F01-C05 — Seed: três contas, papéis, hash e entrada

```bash
sql "SELECT email||':'||name||':'||role||':'||(left(password_hash,4) IN ('\$2a\$','\$2b\$','\$2y\$')) FROM users WHERE email IN ($SEEDS) ORDER BY email"
sql "SELECT count(*) FROM users WHERE email IN ($SEEDS) AND id ~ '^usr_[a-z0-9]{10}\$'"
for e in org.a@catraca.local org.b@catraca.local participante@catraca.local; do login s "$e"; done
```

Esperado:
```
org.a@catraca.local:Organizador A:organizer:true
org.b@catraca.local:Organizador B:organizer:true
participante@catraca.local:Participante Seed:participant:true
```
depois `3`, depois `302 /org/events`, `302 /org/events`, `302 /`.
Aprovação: saída idêntica.

### F01-C06 — Configuração do container e fuso (`TZ`)

```bash
for v in PARTNER_API_KEY SESSION_SECRET GATEWAY_FAST_DELAY_MS GATEWAY_SLOW_DELAY_MS GATEWAY_POLL_MS TZ; do printf '%s=' "$v"; docker compose exec -T app printenv "$v"; done
TZ=America/Recife ./scripts/up.sh | tail -1; echo "exit=${PIPESTATUS[0]}"
docker compose exec -T app printenv TZ
docker compose exec -T app node -e 'console.log(new Date("2026-12-05T12:00:00Z").getTimezoneOffset())'
env -u TZ ./scripts/up.sh | tail -1
docker compose exec -T app printenv TZ
timedatectl show -p Timezone --value 2>/dev/null || readlink -f /etc/localtime | sed 's#.*/zoneinfo/##'
```

Esperado: `PARTNER_API_KEY=catraca-parceiro-2026`; `SESSION_SECRET=` seguido de valor não vazio; `GATEWAY_FAST_DELAY_MS=2000`; `GATEWAY_SLOW_DELAY_MS=65000`; `GATEWAY_POLL_MS=500`; `TZ=` não vazio. Com `TZ=America/Recife`: linha `Catraca no ar em … (TZ=America/Recife)`, `exit=0`, `America/Recife` e `180`. Sem `TZ` no ambiente: linha `Catraca no ar em … (TZ=X)` com X não vazio, `printenv TZ` igual a X; se o último comando imprimir um fuso, X é igual a ele (sem fuso detectável, X = `America/Sao_Paulo`).
Aprovação: todas as condições.

### F01-C07 — Cadastro de participante válido

```bash
E="Nova.Pessoa.$(date +%s%N)@Example.com"; EL=$(printf '%s' "$E" | tr 'A-Z' 'a-z'); echo "EL=$EL"
rm -f "$J/n.jar"
req n GET /signup; has 'action="/signup"'; has 'name="name"'; has 'name="email"'; has 'name="password"'
req n POST /signup --data-urlencode "name=  Ana Teste  " --data-urlencode "email=  $E  " --data-urlencode "password=segredo1"
sql "SELECT name||'|'||email||'|'||role||'|'||(left(password_hash,4) IN ('\$2a\$','\$2b\$','\$2y\$'))||'|'||(password_hash NOT LIKE '%segredo1%') FROM users WHERE email='$EL'"
req n GET /; has 'user-name">Ana Teste<'; has '>Sair</button>'; has 'href="/signup"'
login n2 "$EL" segredo1
```

Esperado: `200 ` e 4× `TEM`; `302 /`; `Ana Teste|<EL>|participant|true|true`; `200 `, `TEM: user-name">Ana Teste<`, `TEM: >Sair</button>`, `NÃO TEM: href="/signup"`; `302 /`.
Aprovação: todas as condições. Anote `EL` (usado no C27).

### F01-C08 — Cadastro inválido (negativos)

```bash
N0=$(sql "SELECT count(*) FROM users"); echo "N0=$N0"; rm -f "$J/v.jar"
req v POST /signup --data-urlencode "name=   " --data-urlencode "email=ok.$(date +%s%N)@example.com" --data-urlencode password=segredo1; has 'Informe seu nome.'
for em in 'ana@' 'ana example.com' 'ana@exemplo' '@exemplo.com'; do req v POST /signup --data-urlencode "name=Ana" --data-urlencode "email=$em" --data-urlencode password=segredo1; has 'Informe um e-mail válido.'; done
req v POST /signup --data-urlencode "name=Ana" --data-urlencode "email=  PARTICIPANTE@Catraca.LOCAL " --data-urlencode password=segredo1; has 'Este e-mail já está cadastrado.'
req v POST /signup --data-urlencode "name=Ana Curta" --data-urlencode "email=curta.$(date +%s%N)@example.com" --data-urlencode password=zq9x1; has 'A senha deve ter pelo menos 6 caracteres.'; has 'value="Ana Curta"'; has 'zq9x1'
req v POST /signup; has 'Informe seu nome.'; has 'Informe um e-mail válido.'; has 'A senha deve ter pelo menos 6 caracteres.'
req v POST /signup -H 'Content-Type: application/json' --data '{"name":"Ana","email":"json.f01@example.com","password":"segredo1"}'; has 'action="/signup"'
sql "SELECT count(*) FROM users"
```

Esperado: todas as respostas `422 ` (9 respostas); cada `has` de mensagem e de `value="Ana Curta"`/`action="/signup"` imprime `TEM`; `NÃO TEM: zq9x1` (senha nunca reexibida); a contagem final é igual a `N0`.
Aprovação: todas as condições; qualquer `302`, `500` ou aumento da contagem reprova.

### F01-C09 — Concorrência: cadastros simultâneos com o mesmo e-mail (3 rodadas)

```bash
for r in 1 2 3; do
  E="corrida$r.$(date +%s%N)@example.com"; echo "rodada $r: $E"
  seq 10 | xargs -P 10 -I{} curl -s -o /dev/null -w '%{http_code}\n' -X POST "$WEB/signup" \
    --data-urlencode "name=Corrida {}" --data-urlencode "email=$E" --data-urlencode "password=segredo1" | sort | uniq -c
  sql "SELECT count(*) FROM users WHERE email='$E'"
done
```

Esperado em **cada** rodada: exatamente `1 302` e `9 422` (nenhum outro código) e contagem `1`.
Aprovação: as três rodadas com esse resultado.

### F01-C10 — Não existe cadastro de organizador

```bash
E="quer.ser.org.$(date +%s%N)@example.com"; rm -f "$J/r.jar" "$J/x.jar"
req r POST /signup --data-urlencode "name=Quer Ser Org" --data-urlencode "email=$E" --data-urlencode password=segredo1 --data-urlencode role=organizer
sql "SELECT role FROM users WHERE email='$E'"
req r GET /org/events
req x GET /signup; has 'name="role"'
grep -rl "INSERT INTO users" src/ | sort
grep -n -A4 "INSERT INTO users" src/features/accounts/service.js
grep -rnE "(body|form)\.role" src/ | wc -l
```

Esperado: `302 /`; `participant`; `403 `; `200 ` e `NÃO TEM: name="role"`; o `grep -rl` lista exatamente `src/features/accounts/service.js` e `src/seed.js`; o trecho de `service.js` contém o literal `'participant'`; a última contagem é `0`.
Aprovação: todas as condições.

### F01-C11 — Login das contas e cookie de sessão

```bash
login a org.a@catraca.local; grep -i '^set-cookie: catraca_session=' "$J/h.txt" | tr -d '\r'
req a GET /org/events; has 'user-name">Organizador A<'; has 'href="/org/events">Meus eventos</a>'
login b org.b@catraca.local
login p participante@catraca.local; req p GET /; has 'user-name">Participante Seed<'
login a2 '  ORG.A@Catraca.Local '
```

Esperado: `302 /org/events`; uma linha `Set-Cookie: catraca_session=…` contendo (sem diferenciar maiúsculas) `httponly` e `samesite=lax`; `200 ` com 2× `TEM`; `302 /org/events`; `302 /`, `200 `, `TEM`; `302 /org/events`.
Aprovação: todas as condições.

### F01-C12 — Destino pós-login (`next`) seguro

```bash
for n in '/events/evt_abc' '//evil.example' 'https://evil.example/x' '/\evil.example' '/org/events'; do
  rm -f "$J/q.jar"; req q POST /login --data-urlencode email=participante@catraca.local --data-urlencode password=catraca123 --data-urlencode "next=$n"; done
for n in '/org/events/evt_x' '/events/evt_x' '//evil.example'; do
  rm -f "$J/q.jar"; req q POST /login --data-urlencode email=org.a@catraca.local --data-urlencode password=catraca123 --data-urlencode "next=$n"; done
rm -f "$J/x.jar"; req x GET '/login?next=/events/evt_abc'; has 'name="next" value="/events/evt_abc"'
req x GET '/login?next=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E'; has '&quot;&gt;&lt;script&gt;'; has '"><script>'
```

Esperado, na ordem: `302 /events/evt_abc`, `302 /`, `302 /`, `302 /`, `302 /`; `302 /org/events/evt_x`, `302 /org/events`, `302 /org/events`; `200 ` e `TEM`; `200 `, `TEM: &quot;&gt;&lt;script&gt;`, `NÃO TEM: "><script>`.
Aprovação: saída idêntica (nenhum `Location` absoluto para outro host).

### F01-C13 — Login inválido (negativos)

```bash
rm -f "$J/f.jar"
req f POST /login --data-urlencode email=org.a@catraca.local --data-urlencode password=errada123; has 'E-mail ou senha inválidos'; has 'value="org.a@catraca.local"'; has 'errada123'; grep -ci '^set-cookie: catraca_session=' "$J/h.txt"
req f POST /login --data-urlencode email=ninguem.f01@example.com --data-urlencode password=catraca123; has 'E-mail ou senha inválidos'
req f POST /login; has 'E-mail ou senha inválidos'
req f GET /me/tickets
req f GET /org/events
```

Esperado: `401 `, `TEM`, `TEM`, `NÃO TEM: errada123`, `0`; `401 `, `TEM`; `401 `, `TEM`; `302 /login?next=%2Fme%2Ftickets`; `302 /login?next=%2Forg%2Fevents`.
Aprovação: todas as condições.

### F01-C14 — Logout

```bash
login a org.a@catraca.local
req a POST /logout
req a GET /org/events
req a GET /; has '<a href="/login">Entrar</a>'; has 'user-name'
req a GET /logout
rm -f "$J/x.jar"; req x POST /logout
```

Esperado: `302 /org/events`; `302 /`; `302 /login?next=%2Forg%2Fevents`; `200 `, `TEM`, `NÃO TEM: user-name`; `404 `; `302 /`.
Aprovação: saída idêntica.

### F01-C15 — Guarda da área de organizador (`/org/*`) (R13)

```bash
rm -f "$J/x.jar"
req x GET /org/events
req x GET /org/events/evt_qualquer123
req x POST /org/events
login p participante@catraca.local
req p GET /org/events; has 'Acesso negado'; has 'Esta área é restrita a organizadores.'; has '<nav'
req p GET /org/events/evt_qualquer123; has 'evt_qualquer123'
req p POST /org/events/evt_qualquer123/edit; has 'Acesso negado'
login a org.a@catraca.local
req a GET /org/events
req a GET /org/rota-inexistente-f01; has 'Página não encontrada'
```

Esperado, na ordem: `302 /login?next=%2Forg%2Fevents`; `302 /login?next=%2Forg%2Fevents%2Fevt_qualquer123`; `302 /login`; `302 /`; `403 ` + 3× `TEM`; `403 ` + `NÃO TEM: evt_qualquer123`; `403 ` + `TEM`; `302 /org/events`; `200 `; `404 ` + `TEM`.
Aprovação: saída idêntica.

### F01-C16 — Guarda da área de participante (`/me/*`)

```bash
rm -f "$J/x.jar"; req x GET /me/tickets
login a org.a@catraca.local; req a GET /me/tickets; has 'Acesso negado'; has 'Esta área é restrita a participantes.'
login p participante@catraca.local; req p GET /me/tickets; has 'Meus ingressos'
```

Esperado: `302 /login?next=%2Fme%2Ftickets`; `302 /org/events`, `403 `, 2× `TEM`; `302 /`, `200 `, `TEM`.
Aprovação: saída idêntica.

### F01-C17 — Cookie de sessão forjado é ignorado (negativo)

```bash
IDA=$(sql "SELECT id FROM users WHERE email='org.a@catraca.local'"); echo "IDA=$IDA"
FAKE=$(printf '{"userId":"%s"}' "$IDA" | base64 | tr -d '\n')
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -b "catraca_session=$FAKE" "$WEB/org/events"
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -b "catraca_session=$FAKE; catraca_session.sig=assinaturafalsa" "$WEB/org/events"
login p participante@catraca.local; SIGP=$(awk '$6=="catraca_session.sig"{print $7}' "$J/p.jar")
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -b "catraca_session=$FAKE; catraca_session.sig=$SIGP" "$WEB/org/events"
```

Esperado: as três requisições `curl` imprimem `302 http://localhost:<APP_PORT>/login?next=%2Forg%2Fevents` (o `login p` intermediário imprime `302 /`).
Aprovação: as três; qualquer `200` reprova.

### F01-C18 — Layout e navegação em todas as páginas

```bash
rm -f "$J/x.jar"
for p in / /login /signup /nao-existe-f01; do
  req x GET "$p"; head -c 15 "$J/body.html"; echo
  has '<nav'; has '<a href="/login">Entrar</a>'; has '<a href="/signup">Criar conta</a>'
  grep -i '^content-type' "$J/h.txt" | tr -d '\r'
done
has 'Página não encontrada'
login p participante@catraca.local; req p GET /
has '<a href="/me/tickets">Meus ingressos</a>'; has '<span class="user-name">Participante Seed</span>'
has '<form method="post" action="/logout"><button type="submit">Sair</button></form>'; has '<a href="/login">Entrar</a>'
login a org.a@catraca.local; req a GET /
has '<a href="/org/events">Meus eventos</a>'; has '<span class="user-name">Organizador A</span>'; has '<a href="/me/tickets">'
```

Esperado: status `200`, `200`, `200`, `404` (os `login` imprimem `302 /` e `302 /org/events`; os `req … GET /` logados, `200 `); cada corpo começa com `<!doctype html>` (sem diferenciar maiúsculas); em cada página 3× `TEM` e `Content-Type: text/html; charset=utf-8`; `TEM: Página não encontrada`. Participante: 3× `TEM` e `NÃO TEM: <a href="/login">Entrar</a>`. Organizador: 2× `TEM` e `NÃO TEM: <a href="/me/tickets">`.
Aprovação: todas as condições.

### F01-C19 — Escape de HTML (negativo de injeção)

```bash
E="xss.$(date +%s%N)@example.com"; rm -f "$J/s.jar"
req s POST /signup --data-urlencode 'name=<script>x</script>' --data-urlencode "email=$E" --data-urlencode password=segredo1
req s GET /; has '&lt;script&gt;x&lt;/script&gt;'; has '<script>x</script>'
sql "SELECT name FROM users WHERE email='$E'"
E2="aspas.$(date +%s%N)@example.com"; rm -f "$J/s2.jar"
req s2 POST /signup --data-urlencode 'name=Ana "A" & B' --data-urlencode "email=$E2" --data-urlencode password=segredo1
req s2 GET /; has 'Ana &quot;A&quot; &amp; B'
rm -f "$J/s3.jar"; req s3 POST /signup --data-urlencode 'name=Teste' --data-urlencode 'email="><img src=x onerror=alert(1)>' --data-urlencode password=segredo1
has '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'; has '"><img'
```

Esperado: `302 /`; `200 `, `TEM`, `NÃO TEM: <script>x</script>`; `<script>x</script>` (o banco guarda o texto cru); `302 /`; `200 `, `TEM`; `422 `, `TEM`, `NÃO TEM: "><img`.
Aprovação: todas as condições.

### F01-C20 — Textos exatos em `src/messages.js`

```bash
docker compose exec -T app node -e '
const a = require("node:assert/strict"); const m = require("./src/messages");
a.equal(m.SOLD_OUT, "Ingressos esgotados");
a.deepEqual({ ...m.CHECKIN }, { invalid_ticket: "Ingresso inválido para este evento", event_cancelled: "Evento cancelado", not_confirmed: "Ingresso não confirmado", already_used: "Ingresso já utilizado", entry_allowed: "Entrada liberada" });
a.deepEqual({ ...m.API_ERRORS }, { unauthorized: "unauthorized", invalid_request: "invalid_request", event_not_available: "event_not_available", sold_out: "sold_out", ticket_not_found: "ticket_not_found" });
a.deepEqual({ ...m.TICKET_STATUS_LABELS }, { pending: "pendente", confirmed: "confirmado", declined: "recusado", cancelled: "cancelado", refunded: "estornado" });
a.deepEqual({ ...m.EVENT_STATUS_LABELS }, { draft: "rascunho", published: "publicado", cancelled: "cancelado" });
a.equal(m.AUTH.LOGIN_INVALID, "E-mail ou senha inválidos");
a.equal(m.EVENT_NOT_FOUND, "Evento não encontrado");
a.equal(m.ONLY_PUBLISHED_CAN_CANCEL, "Só eventos publicados podem ser cancelados");
a.equal(m.capacityBelowOccupied(2), "A lotação não pode ser menor que as vagas ocupadas (2)");
a.ok(Object.isFrozen(m) && Object.isFrozen(m.CHECKIN) && Object.isFrozen(m.API_ERRORS) && Object.isFrozen(m.TICKET_STATUS_LABELS));
console.log("MESSAGES OK");'; echo "exit=$?"
grep -rnF -e 'Ingressos esgotados' -e 'Ingresso inválido para este evento' -e 'Ingresso não confirmado' -e 'Ingresso já utilizado' -e 'Entrada liberada' -e 'E-mail ou senha inválidos' src/ | grep -v '^src/messages.js:' | wc -l
```

Esperado: `MESSAGES OK`, `exit=0`; contagem `0` (nenhum outro arquivo de `src/` repete os literais).
Aprovação: as três condições.

### F01-C21 — Utilitários `format.js` e `ids.js`

```bash
docker compose exec -T -e TZ=America/Sao_Paulo app node -e '
const a = require("node:assert/strict"); const f = require("./src/format"); const { newId } = require("./src/ids");
a.equal(f.formatBRL(35000), "R$ 350,00"); a.equal(f.formatBRL(0), "R$ 0,00"); a.equal(f.formatBRL(123456), "R$ 1.234,56");
a.equal(f.formatBRL(15050), "R$ 150,50"); a.equal(f.formatBRL(100000000), "R$ 1.000.000,00");
for (const [s, v] of [["100",10000],["100,00",10000],["100.00",10000],["R$ 100,00",10000],["150,5",15050],["R$150",15000],[" 20 ",2000]]) a.equal(f.parseBRL(s), v, s);
for (const s of ["1.234,56","10,123","abc","-5","0","0,00","","12345678,00",null,undefined,100]) a.equal(f.parseBRL(s), null, String(s));
const d = new Date("2026-12-06T00:00:00Z");
a.equal(f.formatDateTime(d), "05/12/2026 21:00"); a.equal(f.toIsoWithOffset(d), "2026-12-05T21:00:00-03:00");
a.equal(f.parseDateTimeLocal("2026-12-05T21:00").getTime(), d.getTime());
a.equal(f.parseDateTimeLocal("2026-13-40T99:00"), null); a.equal(f.parseDateTimeLocal("ontem"), null);
a.equal(f.toDateTimeLocalValue(d), "2026-12-05T21:00");
const ids = new Set(); for (let i = 0; i < 10000; i++) ids.add(newId("evt")); a.equal(ids.size, 10000);
for (const id of ids) a.match(id, /^evt_[a-z0-9]{10}$/);
a.match(newId("tkt_"), /^tkt_[a-z0-9]{10}$/); a.match(newId("usr"), /^usr_[a-z0-9]{10}$/);
console.log("FORMAT IDS OK");'; echo "exit=$?"
docker compose exec -T -e TZ=UTC app node -e 'console.log(require("./src/format").toIsoWithOffset(new Date("2026-12-06T00:00:00Z")))'
```

Esperado: `FORMAT IDS OK`, `exit=0`; `2026-12-06T00:00:00+00:00`.
Aprovação: as três condições.

### F01-C22 — README

```bash
test -f README.md && echo README
for s in ./scripts/up.sh ./scripts/down.sh ./scripts/gates.sh http://localhost:3000 '$WEB' '$API' APP_PORT \
  org.a@catraca.local org.b@catraca.local participante@catraca.local catraca123 catraca-parceiro-2026 \
  AGENTS.md docs/prd.md docs/features/ state.json src/seed.js; do grep -qF -- "$s" README.md || echo "FALTA $s"; done; echo FIM
```

Esperado: `README` e em seguida apenas `FIM` (nenhuma linha `FALTA`). Leia também o README e confirme que ele diz que `$WEB` e `$API` valem `http://localhost:3000`.
Aprovação: nenhuma linha `FALTA` e a afirmação sobre `$WEB`/`$API` presente.

### F01-C23 — Gates passam, isolados do app

Com o app ainda no ar (itens anteriores):

```bash
ls test/f01-*.test.js
./scripts/gates.sh > "$J/gates.log" 2>&1; echo "exit=$?"
head -1 "$J/gates.log"; GP=$(head -1 "$J/gates.log" | awk '{print $3}'); echo "GP=$GP"
grep -E '^# (tests|pass|fail|cancelled) ' "$J/gates.log"
docker ps -aq --filter "label=com.docker.compose.project=$GP" | wc -l
docker volume ls -q --filter "label=com.docker.compose.project=$GP" | wc -l
docker network ls -q --filter "label=com.docker.compose.project=$GP" | wc -l
curl -s -o /dev/null -w '%{http_code}\n' "$WEB/health"
sql "SELECT count(*) FROM users WHERE email LIKE '%@test.local'"
```

Esperado: os 6 arquivos `test/f01-*.test.js` listados na seção 11 da spec; `exit=0`; primeira linha `gates: projeto catraca-gates-catraca-aval`; `# tests N` com N ≥ 20, `# pass N` (mesmo N), `# fail 0`, `# cancelled 0`; três contagens `0`; `200` (o app continuou no ar); `0` (os testes não escreveram no banco do app).
Aprovação: todas as condições.

### F01-C24 — Gates falham quando um teste falha, e limpam

```bash
cat > test/zz-falha-proposital.test.js <<'EOF'
const test = require('node:test'); const assert = require('node:assert/strict');
test('falha proposital', () => { assert.equal(1, 2); });
EOF
./scripts/gates.sh > "$J/gates-falha.log" 2>&1; echo "exit=$?"
grep -c 'not ok' "$J/gates-falha.log"; grep -c 'falha proposital' "$J/gates-falha.log"
GP=$(head -1 "$J/gates-falha.log" | awk '{print $3}')
docker ps -aq --filter "label=com.docker.compose.project=$GP" | wc -l
docker volume ls -q --filter "label=com.docker.compose.project=$GP" | wc -l
rm test/zz-falha-proposital.test.js; git status --porcelain | wc -l
```

Esperado: `exit=` diferente de 0; as duas contagens ≥ 1; `0`; `0`; `0` (árvore limpa de novo).
Aprovação: todas as condições.

### F01-C25 — Gates falham com erro de sintaxe em `src/`

```bash
printf 'const = ;\n' > src/zz-sintaxe.js
./scripts/gates.sh > "$J/gates-sintaxe.log" 2>&1; echo "exit=$?"
grep -c 'SyntaxError' "$J/gates-sintaxe.log"
GP=$(head -1 "$J/gates-sintaxe.log" | awk '{print $3}')
docker ps -aq --filter "label=com.docker.compose.project=$GP" | wc -l
docker volume ls -q --filter "label=com.docker.compose.project=$GP" | wc -l
rm src/zz-sintaxe.js; git status --porcelain | wc -l
```

Esperado: `exit=` diferente de 0; contagem ≥ 1; `0`; `0`; `0`.
Aprovação: todas as condições.

### F01-C26 — Derrubada

```bash
NU=$(sql "SELECT count(*) FROM users"); echo "NU=$NU"
./scripts/down.sh; echo "exit=$?"
curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 "$WEB/health"; echo "curl_exit=$?"
docker compose ps -aq | wc -l
docker ps -aq --filter "label=com.docker.compose.project=$PROJ" | wc -l
docker volume ls -q --filter "label=com.docker.compose.project=$PROJ"
pgrep -f 'scripts/up.sh' | wc -l
```

Esperado: `exit=0`; `000` e `curl_exit=` diferente de 0; `0`; `0`; `catraca-aval_pgdata` (volume mantido); `0`.
Aprovação: todas as condições.

### F01-C27 — Nova subida: seed idempotente e dados mantidos

```bash
./scripts/up.sh | tail -1; echo "exit=${PIPESTATUS[0]}"
sql "SELECT count(*) FROM users WHERE email IN ($SEEDS)"
sql "SELECT count(*) FROM users"
sql "SELECT count(*) FROM schema_migrations WHERE version='001_users.sql'"
for e in org.a@catraca.local org.b@catraca.local participante@catraca.local; do login s "$e"; done
login n3 "$EL" segredo1
```

Esperado: `Catraca no ar em …`, `exit=0`; `3`; igual a `NU` do C26; `1`; `302 /org/events`, `302 /org/events`, `302 /`; `302 /` (conta criada no C07 continua entrando; se a sessão de shell mudou, use o e-mail anotado no C07).
Aprovação: todas as condições.

## 3. Execução dos gates

O item **F01-C23** roda `./scripts/gates.sh` e exige saída 0 com `# fail 0`. Os itens C24 e C25 provam que os gates não aprovam código quebrado. Os três são obrigatórios.

## 4. Mapeamento de critérios

| Critério do PRD | Itens que o verificam |
|---|---|
| F01-AC01 (subida limpa, migrações, seed, retorna só com `/health` 200) | C01, C02, C03, C04, C05 |
| F01-AC02 (seed idempotente após `up`→`down`→`up`) | C05, C26, C27 |
| F01-AC03 (`down` para tudo, volume mantido) | C26 |
| F01-AC04 (gates: `node --check` + `node --test` em projeto separado, código de saída, limpeza) | C23, C24, C25 |
| F01-AC05 (cadastro válido, hash bcrypt, sessão, redireciona a `/`, nome e Sair) | C07 |
| F01-AC06 (cadastro rejeitado com 422 e nada criado) | C08, C09 |
| F01-AC07 (login por papel, `next`, login inválido, logout) | C11, C12, C13, C14 |
| F01-AC08 (sem cadastro de organizador) | C10 |
| F01-AC09 (guardas `/org/*` e rotas de participante) (R13) | C15, C16, C17 |
| F01-AC10 (layout em toda página e `escapeHtml`) | C18, C19 |
| F01-AC11 (`messages.js` com textos idênticos ao brief) | C20 |
| F01-AC12 (README e `TZ` repassado pelo `up.sh`) | C06, C22 |

| Critério cross-feature | Itens |
|---|---|
| X-01 a X-17 | Nenhum tem contrato em F01 (PRD seção 7: contratos em F02, F03, F04, F05 e F06). As interfaces que eles consomem de F01 (`requireOrganizer`, `requireParticipant`, `/login`, `messages.js`, `PARTNER_API_KEY`, harness) são verificadas aqui por C06, C11–C16 e C20–C23. |

Itens de apoio sem critério próprio: C21 (utilitários providos a F02–F04, base de F02-AC03/AC11 e F04-AC02).

## 5. Relatório esperado do avaliador

Arquivo **novo** `docs/features/F01-fundacao/reports/AAAA-MM-DD-HHMM-avaliacao.md` (data e hora de início da avaliação, no fuso local). Nunca edite um relatório já commitado: reavaliação = arquivo novo. Commite o relatório sozinho, em Conventional Commits (`docs(f01): relatório de avaliação AAAA-MM-DD-HHMM`).

Estrutura:

```markdown
# Avaliação F01 — Fundação e contas

- Data e hora: AAAA-MM-DD HH:MM (fuso)
- Commit avaliado: <sha completo> (branch/PR: ...)
- Ferramenta e modelo: <ferramenta do agente> / <modelo exato>
- Ambiente: <SO>, Docker <versão do servidor>, APP_PORT=<porta>, clone em <pasta>

## Resumo

| Item | Veredito |
|---|---|
| F01-C01 | APROVADO / REPROVADO |
| ... (C01 a C27, todos) | |

## Evidências

### F01-C01 — Subida em clone limpo — APROVADO|REPROVADO
Comandos executados (como no contrato, com divergências anotadas) e saída real relevante
(status HTTP, linhas impressas, contagens). Em REPROVADO: esperado × obtido e como reproduzir.

... (uma seção por item)

## Critérios do PRD

| Critério | Itens | Veredito |
|---|---|---|
| F01-AC01 | C01–C05 | APROVADO só se todos os itens mapeados forem APROVADOS |
| ... (AC01 a AC12) | | |

## Veredito final: APROVADO | REPROVADO
APROVADO apenas se todos os 27 itens forem APROVADOS. Liste os problemas encontrados,
em ordem de gravidade, com o item e o critério afetados.
```

Regras: a evidência é a saída real do comando (pode ser abreviada com `…`, sem alterar valores); item não executado conta como REPROVADO, com o motivo; o avaliador não corrige código.
