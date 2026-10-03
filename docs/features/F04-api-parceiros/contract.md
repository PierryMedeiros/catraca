# F04 — API de parceiros: contrato de avaliação

> Para o agente **avaliador** (outra sessão, sem acesso ao histórico do implementador). Leia `AGENTS.md`, `docs/prd.md` (F04-AC01–AC10, X-06–X-08) e este arquivo; o código está em `src/features/partner/` e `test/partner-api-*.test.js`.
> Cada item F04-Cnn é APROVADO só se **todas** as condições de "Aprovação" valem. Registre a saída real dos comandos como evidência.
> Use o **modo padrão** do gateway (sem `GATEWAY_*_DELAY_MS`), que é o do avaliador do brief. O contrato inteiro leva ~10 min; o item mais longo (F04-C13) espera ~80 s.

## 0. Pré-requisitos de ambiente

Ferramentas no host: `bash`, `docker` (com Compose v2), `git`, `curl`, `jq` (≥ 1.6), GNU `date`. Rode tudo na raiz do repositório, na mesma sessão de shell (as funções abaixo são reutilizadas).

### 0.1 Subir e variáveis

```bash
git rev-parse --short HEAD                 # anotar no relatório (commit avaliado)
unset GATEWAY_FAST_DELAY_MS GATEWAY_SLOW_DELAY_MS GATEWAY_POLL_MS
export APP_PORT=${APP_PORT:-3000}
./scripts/up.sh                            # deve terminar com sucesso (exit 0)
export WEB=http://localhost:$APP_PORT API=http://localhost:$APP_PORT KEY=catraca-parceiro-2026
export W=$(mktemp -d)                      # cookie jars e saídas
DBSVC=$(docker compose config --services | grep -xE 'db|postgres|database' | head -1)
APPSVC=$(docker compose config --services | grep -vx "$DBSVC" | head -1)
echo "db=$DBSVC app=$APPSVC"               # esperado: os dois não vazios
docker compose exec -T "$APPSVC" printenv GATEWAY_FAST_DELAY_MS GATEWAY_SLOW_DELAY_MS
# esperado: nada impresso, ou 2000 e 65000 (modo padrão). Outro valor => derrubar e subir sem as variáveis.
```

A chave de parceiro é a do README (`catraca-parceiro-2026`, PRD seção 10). Se o README documentar outra, use a do README em `KEY`.

### 0.2 Acesso ao banco

```bash
q() { docker compose exec -T "$DBSVC" sh -c 'psql -U "$POSTGRES_USER" -d "${POSTGRES_DB:-$POSTGRES_USER}" -tA -v ON_ERROR_STOP=1 -c "$1"' sh "$1"; }
q "SELECT count(*) FROM users WHERE email IN ('org.a@catraca.local','org.b@catraca.local','participante@catraca.local')"   # 3
```

### 0.3 Nomes dos campos dos formulários (definidos por F01/F02/F03)

```bash
curl -s "$WEB/login" | grep -oE 'name="[^"]+"' | sort -u
```

Defina as variáveis só se os nomes reais diferirem dos padrões entre parênteses: `F_EMAIL` (`email`), `F_PASS` (`password`). Depois do login (0.4), descubra os do evento e da compra na vitrine:

```bash
curl -s -b "$W/jarA" "$WEB/org/events/new" | grep -oE 'name="[^"]+"' | sort -u
```

`F_NAME` (`name`), `F_START` (`starts_at`), `F_VENUE` (`venue`), `F_CAP` (`capacity`), `F_PRICE` (`price`). O campo de cartão da vitrine (`F_CARD`, padrão `cardNumber`) é descoberto no item F04-C13. Se algum formulário tiver campo oculto obrigatório (ex.: token), acrescente-o às funções abaixo e registre no relatório.

### 0.4 Sessões e funções auxiliares

```bash
login() { curl -s -c "$W/$1" -b "$W/$1" -o /dev/null -w '%{http_code} %{redirect_url}\n' -X POST "$WEB/login" \
  --data-urlencode "${F_EMAIL:-email}=$2" --data-urlencode "${F_PASS:-password}=catraca123"; }
login jarA org.a@catraca.local            # esperado: 302 .../org/events
login jarP participante@catraca.local     # esperado: 302 ...

START=$(date -d '+30 days' +%Y-%m-%d)T21:00
# cria rascunho como organizador A; $1 lotação, $2 preço (ex. 100,00); imprime o id
evento() { curl -s -b "$W/jarA" -c "$W/jarA" -o /dev/null -w '%{redirect_url}' -X POST "$WEB/org/events" \
  --data-urlencode "${F_NAME:-name}=F04 $(date +%s%N)" --data-urlencode "${F_START:-starts_at}=$START" \
  --data-urlencode "${F_VENUE:-venue}=Porão" --data-urlencode "${F_CAP:-capacity}=$1" \
  --data-urlencode "${F_PRICE:-price}=$2" | grep -oE 'evt_[a-z0-9]{10}'; }
publicar() { curl -s -b "$W/jarA" -o /dev/null -w '%{http_code}\n' -X POST "$WEB/org/events/$1/publish"; }
# edita como A; $1 id, $2 lotação, $3 preço
editar() { curl -s -b "$W/jarA" -o /dev/null -w '%{http_code}\n' -X POST "$WEB/org/events/$1/edit" \
  --data-urlencode "${F_NAME:-name}=F04 editado" --data-urlencode "${F_START:-starts_at}=$START" \
  --data-urlencode "${F_VENUE:-venue}=Porão" --data-urlencode "${F_CAP:-capacity}=$2" \
  --data-urlencode "${F_PRICE:-price}=$3"; }
evento_pub() { local id; id=$(evento "$1" "$2"); publicar "$id" >/dev/null; echo "$id"; }

lista()    { curl -s -H "X-Api-Key: $KEY" "$API/api/partner/events"; }
no_lista() { lista | jq -c --arg id "$1" '.[] | select(.id==$id)'; }          # item ou vazio
ingresso() { curl -s -H "X-Api-Key: $KEY" "$API/api/partner/tickets/$1"; }
# compra pela API; define BODY e CODE e imprime "CODE BODY" (chamar sem $(...))
comprar()  { local r; r=$(curl -s -w '\n%{http_code}' -X POST "$API/api/partner/events/$1/purchases" \
  -H "X-Api-Key: $KEY" -H 'Content-Type: application/json' -d "{\"buyerEmail\":\"$2\",\"cardNumber\":\"$3\"}");
  BODY=$(sed '$d' <<<"$r"); CODE=$(tail -n1 <<<"$r"); echo "$CODE $BODY"; }

E=$(evento 1 1,00); echo "$E"             # sanidade: imprime evt_xxxxxxxxxx (rascunho, não usado depois)
```

Se `evento` imprimir vazio, os nomes de campo estão errados (volte a 0.3) — isso não reprova F04, mas o avaliador precisa corrigir antes de seguir.

### 0.5 Dados base (usados em C02 e C03)

```bash
EVB=$(evento_pub 50 100,00); comprar "$EVB" base@example.com 4000000000000001; TB=$(jq -r .ticketId <<<"$BODY")
echo "$EVB $TB"                           # evt_… tkt_…
```

---

## 1. Itens verificáveis

### F04-C01 — A API roda no harness de F01 com a chave do README (X-06)

```bash
curl -s -o /dev/null -w '%{http_code}\n' "$WEB/health"
curl -s -D "$W/h01" -o "$W/c01.json" -w '%{http_code}\n' -H "X-Api-Key: $KEY" "$API/api/partner/events"
grep -i '^content-type' "$W/h01"
jq -e 'type=="array"' "$W/c01.json"
docker compose exec -T "$APPSVC" printenv PARTNER_API_KEY
grep -c 'catraca-parceiro-2026' README.md
```

Esperado: `200`; `200`; `Content-Type: application/json…`; `true`; `catraca-parceiro-2026`; contagem ≥ 1.
Aprovação: as seis saídas exatamente como esperado.

### F04-C02 — 401 sem cabeçalho nas três rotas (F04-AC01)

```bash
CNT0=$(q "SELECT count(*) FROM tickets")
curl -s -w ' %{http_code} %{content_type}\n' "$API/api/partner/events"
curl -s -w ' %{http_code} %{content_type}\n' -X POST "$API/api/partner/events/$EVB/purchases" \
  -H 'Content-Type: application/json' -d '{"buyerEmail":"x@example.com","cardNumber":"4000000000000001"}'
curl -s -w ' %{http_code} %{content_type}\n' "$API/api/partner/tickets/$TB"
q "SELECT count(*) FROM tickets" ; echo "antes=$CNT0"
```

Esperado: as três linhas começam exatamente com `{"error":"unauthorized"} 401 application/json`; contagem de `tickets` igual a `CNT0`.
Aprovação: corpo byte a byte `{"error":"unauthorized"}`, status 401, `application/json` nas três; nenhum ingresso criado.

### F04-C03 — 401 com chave errada, vazia ou fora do cabeçalho, antes de qualquer outra validação (F04-AC01)

```bash
CNT0=$(q "SELECT count(*) FROM tickets")
for K in errada CATRACA-PARCEIRO-2026 catraca-parceiro-2026x catraca-parceiro-202 "$KEY $KEY"; do
  curl -s -w " %{http_code}\n" -H "X-Api-Key: $K" "$API/api/partner/events"
  curl -s -w " %{http_code}\n" -H "X-Api-Key: $K" -X POST "$API/api/partner/events/$EVB/purchases" \
    -H 'Content-Type: application/json' -d '{"buyerEmail":"x@example.com","cardNumber":"4000000000000001"}'
  curl -s -w " %{http_code}\n" -H "X-Api-Key: $K" "$API/api/partner/tickets/$TB"
done
# cabeçalho presente e vazio
curl -s -w " %{http_code}\n" -H 'X-Api-Key;' "$API/api/partner/events"
# chave fora do cabeçalho X-Api-Key
curl -s -w " %{http_code}\n" "$API/api/partner/events?key=$KEY"
curl -s -w " %{http_code}\n" "$API/api/partner/events?apiKey=$KEY"
curl -s -w " %{http_code}\n" -H "Authorization: Bearer $KEY" "$API/api/partner/events"
# sessões do produto não autenticam a API
curl -s -w " %{http_code}\n" -b "$W/jarA" "$API/api/partner/events"
curl -s -w " %{http_code}\n" -b "$W/jarP" "$API/api/partner/tickets/$TB"
# 401 vem antes de 422/404
curl -s -w " %{http_code}\n" -X POST "$API/api/partner/events/evt_naoexiste/purchases" -H 'Content-Type: application/json' -d '{"cardNumber":"123"}'
curl -s -w " %{http_code}\n" -X POST "$API/api/partner/events/$EVB/purchases" -H 'Content-Type: application/json' -d '{"buyerEmail":'
curl -s -w " %{http_code}\n" -H 'X-Api-Key: errada' "$API/api/partner/tickets/tkt_0000000000"
curl -s -w " %{http_code}\n" "$API/api/partner/rota-inexistente"
q "SELECT count(*) FROM tickets" ; echo "antes=$CNT0"
```

Esperado: todas as 25 linhas de resposta são exatamente `{"error":"unauthorized"} 401`; contagem igual a `CNT0`.
Aprovação: 25/25 linhas idênticas a `{"error":"unauthorized"} 401` e nenhum ingresso criado.

### F04-C04 — Formato da listagem (F04-AC02)

```bash
EF=$(evento_pub 3 123,45)
curl -s -o "$W/c04.json" -H "X-Api-Key: $KEY" "$API/api/partner/events"
jq -c --arg id "$EF" '.[] | select(.id==$id)' "$W/c04.json"
jq -e 'length>0 and all(.[];
   keys_unsorted==["id","name","startsAt","priceCents","availableSeats"]
   and (.id|type=="string") and (.name|type=="string")
   and (.priceCents|type=="number" and .==floor)
   and (.availableSeats|type=="number" and .==floor and .>=0)
   and (.startsAt|test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[+-][0-9]{2}:[0-9]{2}$")))' "$W/c04.json"
SA=$(jq -r --arg id "$EF" '.[] | select(.id==$id) | .startsAt' "$W/c04.json"); echo "$SA"
[ "${SA:0:19}" = "$START:00" ] && echo hora-local-ok
TZC=$(docker compose exec -T "$APPSVC" printenv TZ); [ "${SA:19}" = "$(TZ=${TZC:-America/Sao_Paulo} date -d "$START" +%:z)" ] && echo offset-ok
[ "$(date -d "$SA" +%s)" = "$(q "SELECT extract(epoch FROM starts_at)::bigint FROM events WHERE id='$EF'")" ] && echo epoch-ok
```

Esperado: item `{"id":"<EF>","name":"F04 …","startsAt":"<START>:00<offset>","priceCents":12345,"availableSeats":3}`; `true`; `hora-local-ok`; `offset-ok`; `epoch-ok`.
Aprovação: todas as linhas como esperado (chaves exatamente essas, nessa ordem, em **todos** os itens da listagem; tipos inteiros; `startsAt` com offset do `TZ` do container e mesmo instante do banco).

### F04-C05 — Rascunho, publicação e edição refletem na API (X-07, F04-AC02, F04-AC05)

```bash
E=$(evento 2 100,00)
no_lista "$E" | wc -l                                       # 0
comprar "$E" rascunho@example.com 4000000000000001          # 404 {"error":"event_not_available"}
q "SELECT count(*) FROM tickets WHERE event_id='$E'"        # 0
publicar "$E"
no_lista "$E"                                               # availableSeats 2, priceCents 10000
editar "$E" 3 150,00
q "SELECT capacity, price_cents FROM events WHERE id='$E'"  # 3|15000
no_lista "$E"                                               # availableSeats 3, priceCents 15000
comprar "$E" x7@example.com 4000000000000001                # 202
q "SELECT price_cents FROM tickets WHERE event_id='$E'"     # 15000
no_lista "$E"                                               # availableSeats 2
publicar "$E" >/dev/null; lista | jq --arg id "$E" '[.[]|select(.id==$id)]|length'   # 1
```

Aprovação: rascunho ausente da listagem e compra nele `404 {"error":"event_not_available"}` sem ingresso; após publicar, `availableSeats` 2 e `priceCents` 10000; após editar, 3 e 15000; a compra seguinte grava `price_cents` 15000 e a listagem mostra 2; o evento aparece exatamente uma vez.

### F04-C06 — 404 `event_not_available`: inexistente, rascunho, cancelado; 404 antes de 409 (F04-AC05)

```bash
LONG=$(printf 'a%.0s' $(seq 300))
for X in evt_zzzzzzzzzz nao-existe "evt_%27%20OR%201%3D1" "$LONG"; do comprar "$X" a@example.com 4000000000000001; done
ED=$(evento 5 10,00); comprar "$ED" a@example.com 4000000000000001
EC=$(evento_pub 1 10,00); comprar "$EC" lota@example.com 4000000000000003     # 202 (ocupa a única vaga por ~65 s)
q "UPDATE events SET status='cancelled', cancelled_at=now() WHERE id='$EC'"
comprar "$EC" b@example.com 4000000000000001
no_lista "$EC" | wc -l                                                       # 0
q "SELECT count(*) FROM tickets WHERE event_id IN ('$ED','$EC')"             # 1
```

Esperado: as quatro primeiras compras, a do rascunho e a do cancelado lotado imprimem exatamente `404 {"error":"event_not_available"}` (6 linhas); a compra de lotação imprime `202 …`; `0`; `1`.
Aprovação: 6/6 respostas `404 {"error":"event_not_available"}` (o cancelado sem vaga dá 404, não 409); evento cancelado fora da listagem; nenhum ingresso criado além do de lotação.

### F04-C07 — Compra válida: 202 imediato, ingresso do canal partner (F04-AC03)

```bash
E=$(evento_pub 5 100,00)
curl -s -D "$W/h07" -o "$W/c07.json" -w '%{http_code} %{time_total}\n' -X POST "$API/api/partner/events/$E/purchases" \
  -H "X-Api-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"buyerEmail":"  Ana.Parceira@Example.COM ","cardNumber":"4000000000000001"}'
cat "$W/c07.json"; echo; grep -i '^content-type' "$W/h07"
jq -e 'keys_unsorted==["ticketId","code","status"] and (.ticketId|test("^tkt_[a-z0-9]{10}$")) and (.code|test("^[A-Z0-9]{8}$")) and .status=="pending"' "$W/c07.json"
T=$(jq -r .ticketId "$W/c07.json")
q "SELECT channel, user_id IS NULL, buyer_email, card_last4, status, price_cents FROM tickets WHERE id='$T'"
q "SELECT count(*) FROM tickets t WHERE t::text LIKE '%4000000000000001%'"
# campos extras são ignorados
UP=$(q "SELECT id FROM users WHERE email='participante@catraca.local'")
curl -s -w ' %{http_code}\n' -X POST "$API/api/partner/events/$E/purchases" -H "X-Api-Key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"buyerEmail\":\"extra@example.com\",\"cardNumber\":\"4000000000000001\",\"userId\":\"$UP\",\"channel\":\"web\",\"priceCents\":1,\"status\":\"confirmed\"}"
q "SELECT channel, user_id IS NULL, price_cents FROM tickets WHERE event_id='$E' AND buyer_email='extra@example.com'"
```

Esperado: `202 <t>` com `t` < 1.0; corpo com 3 chaves; `Content-Type: application/json…`; `true`; linha `partner|t|ana.parceira@example.com|0001|<pending ou confirmed>|10000`; `0`; a compra com extras responde `{"ticketId":…,"status":"pending"} 202` e grava `partner|t|10000`.
Aprovação: todas as condições acima (status 202, tempo < 1 s, formato exato, `channel='partner'`, `user_id` nulo, e-mail normalizado, só os 4 últimos dígitos guardados, campos extras sem efeito).

### F04-C08 — 422 `invalid_request` para corpo inválido, antes do 404 (F04-AC04)

```bash
E=$(evento_pub 5 100,00); CNT0=$(q "SELECT count(*) FROM tickets")
p() { curl -s -o "$W/b" -w '%{http_code} %{content_type} ' -X POST "$API/api/partner/events/$1/purchases" -H "X-Api-Key: $KEY" "${@:2}"; cat "$W/b"; echo; }
J=(-H 'Content-Type: application/json')
p "$E"                                                     # sem corpo
p "$E" "${J[@]}" -d '{"buyerEmail":'                       # JSON malformado
p "$E" -d 'buyerEmail=a%40example.com&cardNumber=4000000000000001'   # formulário
p "$E" "${J[@]}" -d '[]'
p "$E" "${J[@]}" -d 'null'
p "$E" "${J[@]}" -d '"x"'
p "$E" "${J[@]}" -d '42'
p "$E" "${J[@]}" -d '{}'
p "$E" "${J[@]}" -d '{"cardNumber":"4000000000000001"}'
p "$E" "${J[@]}" -d '{"buyerEmail":"a@example.com"}'
for M in '"ana@"' '"ana@example"' '"ana example.com"' '"@example.com"' '""' '123' 'null'; do
  p "$E" "${J[@]}" -d "{\"buyerEmail\":$M,\"cardNumber\":\"4000000000000001\"}"; done
for C in '"123"' '"40000000000000011"' '"400000000000001"' '"400000000000000a"' '"4000 0000 0000 0001"' '4000000000000001' '""' 'null'; do
  p "$E" "${J[@]}" -d "{\"buyerEmail\":\"a@example.com\",\"cardNumber\":$C}"; done
p "$E" "${J[@]}" -d "{\"buyerEmail\":\"a@example.com\",\"cardNumber\":\"4000000000000001\",\"x\":\"$(head -c 20000 /dev/zero | tr '\0' a)\"}"
p evt_naoexiste "${J[@]}" -d '{"buyerEmail":"t@example.com","cardNumber":"123"}'   # 422 antes de 404
q "SELECT count(*) FROM tickets"; echo "antes=$CNT0"
```

Esperado: 27 linhas, cada uma começando com `422 application/json` e terminando com exatamente `{"error":"invalid_request"}`; contagem igual a `CNT0`.
Aprovação: 27/27 linhas como esperado (inclui o caso do brief, `"cardNumber":"123"`, e o de evento inexistente) e nenhum ingresso criado.

### F04-C09 — 409 `sold_out` sem criar ingresso; esgotado continua listado (F04-AC06, F04-AC02)

```bash
E=$(evento_pub 1 50,00)
comprar "$E" s1@example.com 4000000000000003     # 202 (pendente por ~65 s, ocupa a vaga)
comprar "$E" s2@example.com 4000000000000001
comprar "$E" s3@example.com 4000000000000002
q "SELECT count(*) FROM tickets WHERE event_id='$E'"
no_lista "$E"
```

Esperado: `202 …`; `409 {"error":"sold_out"}` duas vezes; `1`; item com `"availableSeats":0`.
Aprovação: exatamente essas saídas.

### F04-C10 — Lotação sob 30 compras simultâneas, em várias rodadas (F04-AC07, R07)

Rodar o bloco abaixo **4 vezes**: 3 rodadas com `CAP=5` e 1 rodada com `CAP=1`, cada uma num evento novo.

```bash
CAP=5   # rodadas 1–3; rodada 4: CAP=1
E=$(evento_pub $CAP 10,00); echo "$E"
seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$API/api/partner/events/$E/purchases" \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"buyerEmail":"carga{}@example.com","cardNumber":"4000000000000001"}' | sort | uniq -c
q "SELECT count(*), count(DISTINCT code) FROM tickets WHERE event_id='$E'"
sleep 10
q "SELECT status, count(*) FROM tickets WHERE event_id='$E' GROUP BY status"
no_lista "$E"
```

Esperado por rodada com `CAP=5`: `uniq -c` imprime só `5 202` e `25 409`; `5|5`; `confirmed|5` (única linha); item com `"availableSeats":0`. Com `CAP=1`: `1 202` e `29 409`; `1|1`; `confirmed|1`; `"availableSeats":0`.
Aprovação: as 4 rodadas exatamente como esperado (nenhum outro status HTTP; nenhuma rodada com mais ingressos que a lotação).

### F04-C11 — Consulta de ingresso: formato exato e 404 (F04-AC08)

```bash
E=$(evento_pub 5 100,00); comprar "$E" tk@example.com 4000000000000001
T=$(jq -r .ticketId <<<"$BODY"); C=$(jq -r .code <<<"$BODY"); sleep 6
curl -s -D "$W/h11" -o "$W/c11.json" -w '%{http_code}\n' -H "X-Api-Key: $KEY" "$API/api/partner/tickets/$T"
grep -i '^content-type' "$W/h11"
[ "$(cat "$W/c11.json")" = "{\"ticketId\":\"$T\",\"code\":\"$C\",\"eventId\":\"$E\",\"status\":\"confirmed\",\"checkedIn\":false}" ] && echo corpo-ok
q "UPDATE tickets SET checked_in=true, checked_in_at=now() WHERE id='$T'"
ingresso "$T" | jq -c '.checkedIn'
for X in tkt_0000000000 abc "$(printf 'a%.0s' $(seq 300))" "%27%20OR%201%3D1" "${T}x" "$(tr a-z A-Z <<<"$T")"; do
  curl -s -w ' %{http_code}\n' -H "X-Api-Key: $KEY" "$API/api/partner/tickets/$X"; done
```

Esperado: `200`; `Content-Type: application/json…`; `corpo-ok`; `true`; 6 linhas exatamente `{"error":"ticket_not_found"} 404`.
Aprovação: todas as saídas como esperado (corpo byte a byte com as 5 chaves na ordem, `checkedIn` booleano que acompanha o banco).

### F04-C12 — Worker do gateway resolve ingressos da API, finais rápidos (X-08, R08)

```bash
E=$(evento_pub 10 100,00); IDS=()
for c in 4000000000000001 4000000000000002 4000000000005555; do comprar "$E" "g$c@example.com" "$c"; IDS+=("$(jq -r .ticketId <<<"$BODY")"); done
for t in "${IDS[@]}"; do ingresso "$t" | jq -r .status; done          # logo após a compra
sleep 6
for t in "${IDS[@]}"; do ingresso "$t" | jq -r .status; done
q "SELECT card_last4, status, round(extract(epoch FROM updated_at-created_at)::numeric,1) FROM tickets WHERE id IN ('${IDS[0]}','${IDS[1]}','${IDS[2]}') ORDER BY card_last4"
no_lista "$E"
```

Esperado: primeira leitura `pending` ×3; segunda `confirmed`, `declined`, `declined`; SQL `0001|confirmed|≤5`, `0002|declined|≤5`, `5555|declined|≤5`; item com `"availableSeats":9`.
Aprovação: exatamente essas saídas (recusados liberam vaga: 10 − 1 confirmado = 9).

### F04-C13 — Roteiro do brief, passos 2 e 4–8, em modo padrão (F04-AC09, X-07, X-08)

```bash
E1=$(evento 2 100,00); no_lista "$E1" | wc -l                        # 0  (passo 2)
publicar "$E1"; no_lista "$E1"                                       # availableSeats 2, priceCents 10000 (passo 4)
# passo 5: participante da seed compra na vitrine com final 0001
curl -s -b "$W/jarP" "$WEB/events/$E1" | grep -oE 'name="[^"]+"' | sort -u   # define F_CARD se não for cardNumber
curl -s -b "$W/jarP" -c "$W/jarP" -o /dev/null -w '%{http_code} %{redirect_url}\n' -X POST "$WEB/events/$E1/purchase" \
  --data-urlencode "${F_CARD:-cardNumber}=4000000000000001"
sleep 5
# passo 6: API com final 0004; em paralelo, final 0003 em outro evento
E0=$(evento_pub 5 100,00)
comprar "$E1" t2@example.com 4000000000000004; T2=$(jq -r .ticketId <<<"$BODY"); T0=$(date +%s)
comprar "$E0" t3s@example.com 4000000000000003; T3S=$(jq -r .ticketId <<<"$BODY")
no_lista "$E1"                                                       # availableSeats 0
# passo 7 (antes de 60 s)
comprar "$E1" t3a@example.com 4000000000000001                       # 409 {"error":"sold_out"}
curl -s -b "$W/jarP" "$WEB/events/$E1" | grep -c 'Ingressos esgotados'
# passo 8: acompanhar T2 até sair de pending
while :; do S=$(ingresso "$T2" | jq -r .status); N=$(( $(date +%s) - T0 )); [ "$S" != pending ] || [ $N -gt 100 ] && break; sleep 1; done
echo "T2=$S apos ~${N}s"
q "SELECT card_last4, status, round(extract(epoch FROM updated_at-created_at)::numeric,1) FROM tickets WHERE id IN ('$T2','$T3S') ORDER BY card_last4"
no_lista "$E1"                                                       # availableSeats 1
comprar "$E1" t3@example.com 4000000000000001; T3=$(jq -r .ticketId <<<"$BODY")
for i in 1 2 3 4 5; do sleep 1; S3=$(ingresso "$T3" | jq -r .status); [ "$S3" = confirmed ] && break; done; echo "T3=$S3 em ${i}s"
```

Esperado: `0`; item com `"availableSeats":2,"priceCents":10000`; compra na vitrine `302 …/me/tickets`; `202 …pending…` (T2) e `202 …` (T3S); item com `"availableSeats":0`; `409 {"error":"sold_out"}`; contagem ≥ 1; `T2=declined apos ~N s` com 59 ≤ N ≤ 76 (tolerância de arredondamento de `date +%s`; a medida precisa é a do banco); SQL `0003|confirmed|x` e `0004|declined|y` com 60 ≤ x ≤ 75 e 60 ≤ y ≤ 75; item com `"availableSeats":1`; `T3=confirmed em ≤5s`.
Aprovação: todas as saídas como esperado; os tempos medidos no banco (`updated_at − created_at`) de `0003` e `0004` ficam em [60, 75] s, e `T2` foi lido como `pending` em todas as leituras antes de 60 s.

### F04-C14 — Integração vitrine ↔ API: mesma lotação e consulta de ingresso da vitrine (X-08, F04-AC08)

```bash
# API esgota → vitrine mostra esgotado e não vende
E=$(evento_pub 1 30,00); comprar "$E" esg@example.com 4000000000000003
curl -s -b "$W/jarP" "$WEB/events/$E" | grep -c 'Ingressos esgotados'
curl -s -b "$W/jarP" -L "$WEB/events/$E/purchase" --data-urlencode "${F_CARD:-cardNumber}=4000000000000001" | grep -c 'Ingressos esgotados'
q "SELECT count(*) FROM tickets WHERE event_id='$E'"
# vitrine vende → API vê a vaga ocupada e lê o ingresso da vitrine
E=$(evento_pub 3 30,00)
curl -s -b "$W/jarP" -o /dev/null -w '%{http_code}\n' -X POST "$WEB/events/$E/purchase" --data-urlencode "${F_CARD:-cardNumber}=4000000000000001"
no_lista "$E"
TW=$(q "SELECT id FROM tickets WHERE event_id='$E' AND channel='web'"); CW=$(q "SELECT code FROM tickets WHERE id='$TW'")
sleep 5
[ "$(ingresso "$TW")" = "{\"ticketId\":\"$TW\",\"code\":\"$CW\",\"eventId\":\"$E\",\"status\":\"confirmed\",\"checkedIn\":false}" ] && echo web-ok
```

Esperado: `≥1`; `≥1`; `1`; `302`; item com `"availableSeats":2`; `web-ok`.
Aprovação: todas as saídas como esperado.

### F04-C15 — Toda resposta é JSON; compra da API não vincula a participante (F04-AC10)

```bash
E=$(evento_pub 1 10,00)
ct() { curl -s -o "$W/b" -w '%{http_code} %{content_type} ' "$@"; jq -ce . "$W/b" >/dev/null && echo json-ok || echo NAO-JSON; }
ct -H "X-Api-Key: $KEY" "$API/api/partner/events"
ct -X POST -H "X-Api-Key: $KEY" -H 'Content-Type: application/json' -d '{"buyerEmail":"participante@catraca.local","cardNumber":"4000000000000001"}' "$API/api/partner/events/$E/purchases"
TP=$(jq -r .ticketId "$W/b"); CP=$(jq -r .code "$W/b")
ct -X POST -H "X-Api-Key: $KEY" -H 'Content-Type: application/json' -d '{"buyerEmail":"z@example.com","cardNumber":"4000000000000001"}' "$API/api/partner/events/$E/purchases"
ct -X POST -H "X-Api-Key: $KEY" -H 'Content-Type: application/json' -d '{"buyerEmail":"z@example.com","cardNumber":"4000000000000001"}' "$API/api/partner/events/evt_zzzzzzzzzz/purchases"
ct -X POST -H "X-Api-Key: $KEY" -H 'Content-Type: application/json' -d '{"buyerEmail":' "$API/api/partner/events/$E/purchases"
ct -H "X-Api-Key: $KEY" "$API/api/partner/tickets/$TP"
ct -H "X-Api-Key: $KEY" "$API/api/partner/tickets/tkt_0000000000"
ct "$API/api/partner/events"
ct -H "X-Api-Key: $KEY" "$API/api/partner/rota-inexistente"; cat "$W/b"; echo
ct -X DELETE -H "X-Api-Key: $KEY" "$API/api/partner/events"; cat "$W/b"; echo
ct -H "X-Api-Key: $KEY" "$API/api/partner/events/$E/purchases"; cat "$W/b"; echo
q "SELECT user_id IS NULL, channel FROM tickets WHERE id='$TP'"
curl -s -b "$W/jarP" "$WEB/me/tickets" | grep -c "$CP"
```

Esperado: 11 linhas `ct` com status `200`, `202`, `409`, `404`, `422`, `200`, `404`, `401`, `404`, `404`, `404`, todas com `application/json` e `json-ok`; as três últimas com corpo `{"error":"not_found"}`; SQL `t|partner`; `0`.
Aprovação: todas as respostas `application/json` com JSON válido; ingresso comprado com o e-mail do participante da seed tem `user_id` nulo e o código não aparece em "Meus ingressos" dele.

### F04-C16 — Códigos de erro vêm de `messages.js`; README documenta a API (X-06)

```bash
for c in unauthorized invalid_request event_not_available sold_out ticket_not_found; do printf '%s ' "$c"; grep -c "$c" src/messages.js; done
grep -nE "['\"\`](unauthorized|invalid_request|event_not_available|sold_out|ticket_not_found)['\"\`]" src/features/partner/*.js | wc -l
grep -c "features/partner" src/app.js
grep -nE 'api/partner/events|api/partner/tickets|X-Api-Key|\$KEY|\$API' README.md | head -20
ls test/partner-api-*.test.js
```

Esperado: cada código com contagem ≥ 1 em `messages.js`; `0` literais em `src/features/partner/`; `1` linha em `src/app.js`; README com as três rotas, `X-Api-Key`, `$KEY` e `$API`; ao menos 7 arquivos `test/partner-api-*.test.js`.
Aprovação: todas as condições acima.

### F04-C17 — Gates passam com os testes de F04 (X-06)

```bash
./scripts/gates.sh 2>&1 | tee "$W/gates.log"; echo "exit=${PIPESTATUS[0]}"
grep -c 'partner-api' "$W/gates.log"
docker compose -p catraca-gates ps -aq | wc -l
```

Esperado: `exit=0`; contagem ≥ 1 (os testes `partner-api-*` foram executados); `0` containers restantes do projeto de gates.
Aprovação: as três condições.

Ao final de todos os itens: `./scripts/down.sh`.

---

## 2. Mapeamento critério → itens

| Critério (PRD) | Itens |
|---|---|
| F04-AC01 | F04-C02, F04-C03 |
| F04-AC02 | F04-C04, F04-C05, F04-C06, F04-C09, F04-C10 |
| F04-AC03 | F04-C07 |
| F04-AC04 | F04-C08 |
| F04-AC05 | F04-C05, F04-C06 |
| F04-AC06 | F04-C09 |
| F04-AC07 | F04-C10 |
| F04-AC08 | F04-C11, F04-C14 |
| F04-AC09 | F04-C13 |
| F04-AC10 | F04-C15 |
| X-06 (F01 → F04) | F04-C01, F04-C16, F04-C17 |
| X-07 (F02 → F04) | F04-C05, F04-C13 |
| X-08 (F03 → F04) | F04-C12, F04-C13, F04-C14 |

X-17 (integração F04 ‖ F05) pertence ao contrato de F06 pelo PRD e não é item deste contrato.

## 3. Relatório do avaliador

Arquivo **novo** `docs/features/F04-api-parceiros/reports/AAAA-MM-DD-HHMM-avaliacao.md` (data e hora do início da avaliação; nunca editar um relatório já commitado — reavaliação = novo arquivo). Commit próprio, só com o relatório (e `state.json`).

```markdown
# Avaliação F04 — API de parceiros

- Data: AAAA-MM-DD HH:MM (fuso)
- Commit avaliado: <hash curto> (branch <nome>)
- Ferramenta e modelo: <ferramenta> / <modelo>
- Ambiente: APP_PORT=<porta>, modo padrão do gateway (GATEWAY_* não definidos), nomes de campos usados: <F_* que diferiram do padrão, ou "padrão">

## Resultado por item

| Item | Veredito | Evidência (resumo) |
|---|---|---|
| F04-C01 | APROVADO/REPROVADO | ... |
| ... | ... | ... |
| F04-C17 | APROVADO/REPROVADO | ... |

## Evidências

### F04-C01
<comandos executados e saída real, copiada do terminal>
...

## Critérios do PRD

| Critério | Itens | Veredito |
|---|---|---|
| F04-AC01 | C02, C03 | ... |
| ... | ... | ... |

## Veredito final

APROVADO (todos os 17 itens aprovados) | REPROVADO (lista dos itens reprovados e o que falhou, com a saída observada vs. esperada)
```

Regras: um item com qualquer condição não atendida é REPROVADO; o veredito final só é APROVADO se os 17 itens forem APROVADOS. Problemas de ambiente (ex.: nome de campo de formulário diferente do padrão) são resolvidos ajustando as variáveis da seção 0 e registrados, não contam como reprovação de F04. Após commitar o relatório, atualizar `state.json` (F04: `latestReport` com o caminho; `status` `done` se APROVADO, `needs_fix` se REPROVADO).
