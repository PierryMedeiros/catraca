# F05 — Check-in e painel: contrato de avaliação

> Para o agente avaliador (sessão diferente da do implementador). Leia apenas este contrato, `docs/prd.md`, `spec.md`/`plan.md` desta pasta e o código. Critérios cobertos: F05-AC01..F05-AC10, X-09, X-10, X-11 (tabela de mapeamento na seção 4).
> Avalie o commit `HEAD` da branch de F05 (antes ou depois do merge). O contrato **não depende de F04** (wave paralela): compras de parceiro são criadas chamando `purchaseTicket` (F03) com `channel:'partner'` dentro do container do app.
> Todos os comandos são **bash**, executados na raiz do repositório. Nenhum item exige atraso de gateway alterado: tudo roda no modo padrão (aprovação/recusa rápida ≈ 2 s). Tempo total estimado: ~5 min + gates.

## 1. Pré-requisitos de ambiente

### 1.1 Subir

```bash
cd <raiz do repositório>
git rev-parse --short HEAD            # anote: commit avaliado
export APP_PORT=${APP_PORT:-3000}     # use outra porta (ex. 3105) se a 3000 estiver ocupada
./scripts/up.sh                       # só retorna com /health 200
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:$APP_PORT/health"   # esperado: 200
```

Se `up.sh` falhar ou `/health` não der 200, **todos** os itens ficam REPROVADO.

### 1.2 Variáveis e funções auxiliares (cole numa sessão bash e reutilize em todos os itens)

```bash
set -u
WEB="http://localhost:$APP_PORT"
TMP=$(mktemp -d)
JAR_A=$TMP/a.jar; JAR_B=$TMP/b.jar; JAR_P=$TMP/p.jar
# Contas da seed (PRD seção 10), senha de todas: catraca123
ORG_A=org.a@catraca.local; ORG_B=org.b@catraca.local; PART=participante@catraca.local

# psql no serviço Postgres do Compose (o serviço que não é "app"); usuário/banco vêm do env do container
DB_SVC=$(docker compose ps --services | grep -vx app | head -n1)
psqlc() { docker compose exec -T "$DB_SVC" sh -c 'psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-${POSTGRES_USER:-postgres}}" -v ON_ERROR_STOP=1 -qAt'; }

rid() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-"$1"; }   # [0-9a-f]{n}
newcode() { echo "Q$(rid 7 | tr a-f A-F)"; }                                     # 8 chars [A-Z0-9], com letra

# Nomes de campos de formulário (F01/F03). Confirme na etapa 1.3; ajuste se diferentes.
LOGIN_EMAIL_FIELD=email; LOGIN_PASS_FIELD=password; CARD_FIELD=cardNumber

login() {  # $1 jar  $2 email
  rm -f "$1"
  curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -c "$1" -b "$1" \
    --data-urlencode "$LOGIN_EMAIL_FIELD=$2" --data-urlencode "$LOGIN_PASS_FIELD=catraca123" "$WEB/login"
}

mk_event() {  # $1 id  $2 email do dono  $3 lotação  $4 price_cents  $5 status (draft|published|cancelled)
psqlc <<SQL
INSERT INTO events (id, organizer_id, name, starts_at, venue, capacity, price_cents, status, created_at, updated_at, cancelled_at)
VALUES ('$1', (SELECT id FROM users WHERE email = '$2'), 'F05 $1', now() + interval '30 days', 'Local F05',
        $3, $4, '$5', now(), now(), CASE WHEN '$5' = 'cancelled' THEN now() END);
SQL
}

mk_ticket() {  # $1 id  $2 event_id  $3 code  $4 status  $5 price_cents  $6 checked_in (true|false)
psqlc <<SQL
INSERT INTO tickets (id, event_id, user_id, buyer_email, code, status, price_cents, channel, card_last4,
                     gateway_outcome, gateway_due_at, checked_in, checked_in_at, created_at, updated_at)
VALUES ('$1', '$2', NULL, '$1@f05.example.com', '$3', '$4', $5, 'partner', '0001',
        CASE WHEN '$4' = 'declined' THEN 'declined' ELSE 'approved' END,
        CASE WHEN '$4' = 'pending' THEN now() + interval '1 day' ELSE now() - interval '1 minute' END,
        $6, CASE WHEN $6 THEN now() END, now(), now());
SQL
}
# (ingressos "pending" inseridos assim vencem só em 1 dia: o worker não os toca durante a avaliação)

checkin() {  # $1 jar  $2 event_id  $3 código -> imprime status HTTP e a linha de resultado; corpo em $TMP/last.html
  curl -s -o "$TMP/last.html" -w '%{http_code}\n' -b "$1" --data-urlencode "code=$3" "$WEB/org/events/$2/checkin"
  grep -o '<p id="checkin-result" data-result="[a-z_]*">[^<]*</p>' "$TMP/last.html"
}

metrics() {  # $1 arquivo HTML -> "confirmed=.. pending=.. checkins=.. available=.. revenue=.. refunded=.."
  grep -o '<dd data-metric="[a-z]*">[^<]*</dd>' "$1" | sed -E 's#<dd data-metric="([a-z]+)">([^<]*)</dd>#\1=\2#' | paste -sd' ' -
}
panel() {  # $1 jar  $2 event_id
  curl -s -o "$TMP/panel.html" -b "$1" "$WEB/org/events/$2"; metrics "$TMP/panel.html"
}

web_buy() {  # $1 jar do participante  $2 event_id  $3 cartão  (vitrine, F03)
  curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -b "$1" -c "$1" \
    --data-urlencode "$CARD_FIELD=$3" "$WEB/events/$2/purchase"
}

partner_buy() {  # $1 event_id  $2 buyerEmail  $3 cartão  (purchaseTicket de F03, canal partner)
  docker compose exec -T app node --input-type=module -e "
    const { pathToFileURL } = await import('node:url');
    const m = await import(pathToFileURL(process.cwd() + '/src/features/purchases/service.js').href);
    const purchaseTicket = m.purchaseTicket ?? m.default?.purchaseTicket;
    const r = await purchaseTicket({ eventId: '$1', buyer: { email: '$2' }, cardNumber: '$3', channel: 'partner' });
    console.log(JSON.stringify({ ok: r.ok, error: r.error ?? null }));
    process.exit(0);"
}
```

### 1.3 Conferências de ambiente (todas precisam passar antes dos itens)

```bash
echo 'SELECT 1' | psqlc                                                  # esperado: 1
curl -s "$WEB/login" | grep -o 'name="[^"]*"' | sort -u                  # esperado: contém name="email" e name="password"
docker compose exec -T app sh -c 'ls src/features/purchases/service.js src/features/checkin/service.js'   # ambos listados
login "$JAR_A" "$ORG_A"; login "$JAR_B" "$ORG_B"; login "$JAR_P" "$PART" # esperado: 302 ou 303 em cada linha
curl -s -o /dev/null -w '%{http_code}\n' -b "$JAR_A" "$WEB/org/events"   # esperado: 200
curl -s -o /dev/null -w '%{http_code}\n' -b "$JAR_B" "$WEB/org/events"   # esperado: 200
```

- Se os campos do login tiverem outros nomes, ajuste `LOGIN_EMAIL_FIELD`/`LOGIN_PASS_FIELD` e registre no relatório. Se houver campo oculto obrigatório (ex.: CSRF), inclua-o nas chamadas e registre.
- `CARD_FIELD`: confirme no item F05-C10 (passo 1) com `curl -s -b "$JAR_P" "$WEB/events/$EV" | grep -o '<input[^>]*>'`; ajuste se o campo do cartão não for `cardNumber`.

### 1.4 Convenção de marcação (spec, seção 3.1)

| Elemento | Formato exato |
|---|---|
| Resultado do check-in | `<p id="checkin-result" data-result="KEY">TEXTO</p>` |
| Aviso de evento cancelado | `<p id="checkin-event-cancelled">Evento cancelado</p>` |
| Eco do código | `<p id="checkin-code">Código informado: CÓDIGO</p>` |
| Formulário | `<form method="post" action="/org/events/ID/checkin">` com `<input ... name="code" ...>` |
| Painel | `<dt>RÓTULO</dt><dd data-metric="M">VALOR</dd>` (6 linhas) |

| KEY | TEXTO (idêntico ao brief) |
|---|---|
| `invalid_ticket` | `Ingresso inválido para este evento` |
| `event_cancelled` | `Evento cancelado` |
| `not_confirmed` | `Ingresso não confirmado` |
| `already_used` | `Ingresso já utilizado` |
| `entry_allowed` | `Entrada liberada` |

Abaixo, `RES(KEY)` abrevia a linha exata `<p id="checkin-result" data-result="KEY">TEXTO</p>` com o TEXTO da tabela.

## 2. Itens verificáveis

### F05-C01 — Seções "Check-in" e "Painel" na página de gestão (dono)

```bash
EV=evt_$(rid 10); mk_event "$EV" "$ORG_A" 4 10000 published
curl -s -o "$TMP/c01.html" -w '%{http_code}\n' -b "$JAR_A" "$WEB/org/events/$EV"
grep -c '<section id="checkin">' "$TMP/c01.html"
grep -c '<section id="painel">' "$TMP/c01.html"
grep -o "<form method=\"post\" action=\"/org/events/$EV/checkin\">" "$TMP/c01.html"
grep -o '<input[^>]*name="code"[^>]*>' "$TMP/c01.html" | grep -c disabled
grep -c -e 'id="checkin-result"' -e 'id="checkin-event-cancelled"' "$TMP/c01.html"
grep -o '<dt>[^<]*</dt><dd data-metric="[a-z]*">[^<]*</dd>' "$TMP/c01.html"
```

Esperado: `200`; `1`; `1`; a linha do `<form ...>` com o id do evento; `0` (campo sem `disabled`); `0` (GET sem resultado nem aviso); e exatamente estas 6 linhas, nesta ordem:

```
<dt>Confirmados</dt><dd data-metric="confirmed">0</dd>
<dt>Pendentes</dt><dd data-metric="pending">0</dd>
<dt>Check-ins</dt><dd data-metric="checkins">0</dd>
<dt>Vagas disponíveis</dt><dd data-metric="available">4</dd>
<dt>Receita</dt><dd data-metric="revenue">R$ 0,00</dd>
<dt>Estornados</dt><dd data-metric="refunded">0</dd>
```

Aprovado se todas as saídas forem idênticas às esperadas.

### F05-C02 — Normalização do código, gravação do check-in e painel na resposta

```bash
EV=evt_$(rid 10); K=$(newcode); T=tkt_$(rid 10)
mk_event "$EV" "$ORG_A" 5 10000 published
mk_ticket "$T" "$EV" "$K" confirmed 10000 false
checkin "$JAR_A" "$EV" "   $(echo "$K" | tr A-Z a-z)   "
grep -o '<p id="checkin-code">[^<]*</p>' "$TMP/last.html"
metrics "$TMP/last.html"
echo "SELECT checked_in, checked_in_at IS NOT NULL, status FROM tickets WHERE id = '$T'" | psqlc
```

Esperado: `200`; `RES(entry_allowed)`; `<p id="checkin-code">Código informado: $K</p>` (com o valor de `$K` em maiúsculas, sem espaços); `confirmed=1 pending=0 checkins=1 available=4 revenue=R$ 100,00 refunded=0`; `t|t|confirmed`.

Aprovado se todas as saídas forem idênticas às esperadas.

### F05-C03 — Código inexistente, de outro evento ou malformado → `Ingresso inválido para este evento` (negativo)

```bash
EV=evt_$(rid 10);  K=$(newcode);  mk_event "$EV"  "$ORG_A" 5 10000 published; mk_ticket tkt_$(rid 10) "$EV"  "$K"  confirmed 10000 false
EVO=evt_$(rid 10); KO=$(newcode); mk_event "$EVO" "$ORG_A" 5 10000 published; mk_ticket tkt_$(rid 10) "$EVO" "$KO" confirmed 10000 false
EVB=evt_$(rid 10); KB=$(newcode); mk_event "$EVB" "$ORG_B" 5 10000 published; mk_ticket tkt_$(rid 10) "$EVB" "$KB" confirmed 10000 false
for c in ZZZZZZZZ "" "$KO" "$KB" "X' OR '1'='1" "%" "$(printf 'A%.0s' $(seq 65))" "${K:0:7}" "<b>x</b>"; do
  checkin "$JAR_A" "$EV" "$c"
done | sort | uniq -c
grep -c '&lt;B&gt;X&lt;/B&gt;' "$TMP/last.html"; grep -c '<B>X</B>' "$TMP/last.html"
curl -s -o "$TMP/c03b.html" -w '%{http_code}\n' -b "$JAR_A" -d 'foo=bar' "$WEB/org/events/$EV/checkin"
grep -o '<p id="checkin-result" data-result="[a-z_]*">[^<]*</p>' "$TMP/c03b.html"
echo "SELECT count(*) FROM tickets WHERE checked_in AND event_id IN ('$EV','$EVO','$EVB')" | psqlc
```

Esperado:
- saída do laço = exatamente duas linhas: `9 200` e `9 RES(invalid_ticket)` (9 entradas: inexistente, vazio, outro evento de A, evento de B, injeção SQL, `%`, 65 caracteres, prefixo de 7 caracteres de um código válido, HTML);
- `1` (ou mais) e `0` (eco escapado, nunca HTML cru);
- campo `code` ausente: `200` e `RES(invalid_ticket)`;
- contagem final `0` (nenhum check-in gravado).

Aprovado se todas as condições valerem. Qualquer `500` reprova.

### F05-C04 — Evento cancelado: ordem das linhas 1 e 2 de R10 e aviso acima do campo

```bash
EVC=evt_$(rid 10); mk_event "$EVC" "$ORG_A" 10 10000 cancelled
K1=$(newcode); mk_ticket tkt_$(rid 10) "$EVC" "$K1" confirmed 10000 false
K2=$(newcode); mk_ticket tkt_$(rid 10) "$EVC" "$K2" pending   10000 false
K3=$(newcode); mk_ticket tkt_$(rid 10) "$EVC" "$K3" refunded  10000 false
K4=$(newcode); mk_ticket tkt_$(rid 10) "$EVC" "$K4" confirmed 10000 true
K5=$(newcode); mk_ticket tkt_$(rid 10) "$EVC" "$K5" declined  10000 false
K6=$(newcode); mk_ticket tkt_$(rid 10) "$EVC" "$K6" cancelled 10000 false
EVP=evt_$(rid 10); mk_event "$EVP" "$ORG_A" 5 10000 published
KP=$(newcode); mk_ticket tkt_$(rid 10) "$EVP" "$KP" confirmed 10000 false
for c in "$K1" "$K2" "$K3" "$K4" "$K5" "$K6"; do checkin "$JAR_A" "$EVC" "$c"; done | sort | uniq -c
checkin "$JAR_A" "$EVC" "$KP"
checkin "$JAR_A" "$EVC" ZZZZZZZZ
echo "SELECT string_agg(code || '=' || checked_in, ',' ORDER BY code) FILTER (WHERE checked_in) FROM tickets WHERE event_id IN ('$EVC','$EVP')" | psqlc
curl -s -o "$TMP/c04.html" -w '%{http_code}\n' -b "$JAR_A" "$WEB/org/events/$EVC"
grep -c '<p id="checkin-event-cancelled">Evento cancelado</p>' "$TMP/c04.html"
A=$(grep -bo 'id="checkin-event-cancelled"' "$TMP/c04.html" | cut -d: -f1)
F=$(grep -bo "action=\"/org/events/$EVC/checkin\"" "$TMP/c04.html" | cut -d: -f1)
[ -n "$A" ] && [ -n "$F" ] && [ "$A" -lt "$F" ] && echo AVISO_ANTES_DO_FORM
grep -o '<input[^>]*name="code"[^>]*>' "$TMP/c04.html" | grep -c disabled
```

Esperado: laço → `6 200` e `6 RES(event_cancelled)`; `$KP` (outro evento) → `200` + `RES(invalid_ticket)`; `ZZZZZZZZ` → `200` + `RES(invalid_ticket)`; consulta → somente `$K4=true` (o único inserido com check-in; nada mudou); página → `200`, `1`, `AVISO_ANTES_DO_FORM`, `0`.

Aprovado se todas as saídas forem as esperadas.

### F05-C05 — Ingresso não confirmado em evento publicado

```bash
EV=evt_$(rid 10); mk_event "$EV" "$ORG_A" 10 10000 published
for s in pending declined cancelled refunded; do
  k=$(newcode); mk_ticket tkt_$(rid 10) "$EV" "$k" "$s" 10000 false; checkin "$JAR_A" "$EV" "$k"
done | sort | uniq -c
echo "SELECT count(*) FILTER (WHERE checked_in), count(*) FROM tickets WHERE event_id = '$EV'" | psqlc
```

Esperado: `4 200`, `4 RES(not_confirmed)`; consulta `0|4`. Aprovado se idêntico.

### F05-C06 — Ingresso já utilizado (inserido com check-in e após check-in real)

```bash
EV=evt_$(rid 10); mk_event "$EV" "$ORG_A" 10 10000 published
KU=$(newcode); mk_ticket tkt_$(rid 10) "$EV" "$KU" confirmed 10000 true
B1=$(echo "SELECT checked_in_at FROM tickets WHERE code = '$KU'" | psqlc)
checkin "$JAR_A" "$EV" "$KU"
[ "$B1" = "$(echo "SELECT checked_in_at FROM tickets WHERE code = '$KU'" | psqlc)" ] && echo KU_INALTERADO
KN=$(newcode); mk_ticket tkt_$(rid 10) "$EV" "$KN" confirmed 10000 false
checkin "$JAR_A" "$EV" "$KN"
B2=$(echo "SELECT checked_in_at FROM tickets WHERE code = '$KN'" | psqlc)
sleep 1
checkin "$JAR_A" "$EV" "$KN"
checkin "$JAR_A" "$EV" " $(echo "$KN" | tr A-Z a-z)"
[ -n "$B2" ] && [ "$B2" = "$(echo "SELECT checked_in_at FROM tickets WHERE code = '$KN'" | psqlc)" ] && echo KN_INALTERADO
metrics "$TMP/last.html"
```

Esperado, em ordem: `200` + `RES(already_used)`; `KU_INALTERADO`; `200` + `RES(entry_allowed)`; `200` + `RES(already_used)`; `200` + `RES(already_used)`; `KN_INALTERADO`; `confirmed=2 pending=0 checkins=2 available=8 revenue=R$ 200,00 refunded=0`.

Aprovado se idêntico.

### F05-C07 — Concorrência: submissões simultâneas do mesmo código (10 rodadas, eventos novos)

```bash
for N in 2 2 2 2 2 10 10 10 10 10; do
  EV=evt_$(rid 10); K=$(newcode)
  mk_event "$EV" "$ORG_A" 5 10000 published; mk_ticket tkt_$(rid 10) "$EV" "$K" confirmed 10000 false
  rm -f "$TMP"/cc_*.html
  S=$(seq "$N" | xargs -P "$N" -I{} curl -s -o "$TMP/cc_{}.html" -w '%{http_code}\n' -b "$JAR_A" \
        --data-urlencode "code=$K" "$WEB/org/events/$EV/checkin" | sort | uniq -c | tr -s ' ' | paste -sd' ' -)
  R=$(grep -ho 'data-result="[a-z_]*"' "$TMP"/cc_*.html | sort | uniq -c | tr -s ' ' | paste -sd' ' -)
  D=$(echo "SELECT count(*) FILTER (WHERE checked_in) FROM tickets WHERE event_id = '$EV'" | psqlc)
  echo "N=$N | $S | $R | db=$D"
done
```

Esperado: 10 linhas; as 5 primeiras exatamente `N=2 | 2 200 | 1 data-result="already_used" 1 data-result="entry_allowed" | db=1` e as 5 últimas exatamente `N=10 | 10 200 | 9 data-result="already_used" 1 data-result="entry_allowed" | db=1` (espaço inicial do `uniq -c` pode variar; compare os números).

Aprovado somente se **todas** as 10 rodadas tiverem exatamente 1 `entry_allowed`, o resto `already_used`, todos `200` e `db=1`. Uma rodada fora disso reprova.

### F05-C08 — Painel com ingressos em todos os status, conferido contra SQL

```bash
EV=evt_$(rid 10); mk_event "$EV" "$ORG_A" 10 10000 published
mk_ticket tkt_$(rid 10) "$EV" "$(newcode)" confirmed 10000 true
T2=tkt_$(rid 10); C2=$(newcode); mk_ticket "$T2" "$EV" "$C2" confirmed 10000 false
mk_ticket tkt_$(rid 10) "$EV" "$(newcode)" confirmed 15000 false
mk_ticket tkt_$(rid 10) "$EV" "$(newcode)" pending   15000 false
mk_ticket tkt_$(rid 10) "$EV" "$(newcode)" pending   10000 false
mk_ticket tkt_$(rid 10) "$EV" "$(newcode)" declined  10000 false
mk_ticket tkt_$(rid 10) "$EV" "$(newcode)" cancelled 10000 false
mk_ticket tkt_$(rid 10) "$EV" "$(newcode)" refunded  10000 true
mk_ticket tkt_$(rid 10) "$EV" "$(newcode)" refunded  15000 false
EVX=evt_$(rid 10); mk_event "$EVX" "$ORG_A" 3 99900 published; mk_ticket tkt_$(rid 10) "$EVX" "$(newcode)" confirmed 99900 true
REF="SELECT count(*) FILTER (WHERE t.status='confirmed') || ' ' || count(*) FILTER (WHERE t.status='pending') || ' ' ||
 count(*) FILTER (WHERE t.status='confirmed' AND t.checked_in) || ' ' ||
 (e.capacity - count(*) FILTER (WHERE t.status IN ('pending','confirmed'))) || ' ' ||
 COALESCE(sum(t.price_cents) FILTER (WHERE t.status='confirmed'),0) || ' ' || count(*) FILTER (WHERE t.status='refunded')
 FROM events e LEFT JOIN tickets t ON t.event_id = e.id WHERE e.id = '$EV' GROUP BY e.capacity"
echo "$REF" | psqlc
panel "$JAR_A" "$EV"
checkin "$JAR_A" "$EV" "$C2"
metrics "$TMP/last.html"
echo "$REF" | psqlc
panel "$JAR_A" "$EV"
```

Esperado:
1. SQL: `3 2 1 5 35000 2`
2. Painel: `confirmed=3 pending=2 checkins=1 available=5 revenue=R$ 350,00 refunded=2`
3. Check-in de `$C2`: `200` + `RES(entry_allowed)`; painel na resposta: `confirmed=3 pending=2 checkins=2 available=5 revenue=R$ 350,00 refunded=2`
4. SQL: `3 2 2 5 35000 2`
5. Painel (GET): `confirmed=3 pending=2 checkins=2 available=5 revenue=R$ 350,00 refunded=2`

Aprovado se cada número do painel for igual ao da consulta SQL correspondente (Receita = centavos da SQL formatados `R$ X,YY`) e às linhas acima. O ingresso de `$EVX` (outro evento) e o estornado com `checked_in=true` não podem entrar em nenhum número.

### F05-C09 — Receita: preço de cada ingresso, formato `R$`, só confirmados

```bash
EVR=evt_$(rid 10); mk_event "$EVR" "$ORG_A" 6 77700 published
mk_ticket tkt_$(rid 10) "$EVR" "$(newcode)" confirmed 100000 false
mk_ticket tkt_$(rid 10) "$EVR" "$(newcode)" confirmed 23456  false
mk_ticket tkt_$(rid 10) "$EVR" "$(newcode)" pending   50000  false
mk_ticket tkt_$(rid 10) "$EVR" "$(newcode)" declined  70000  false
mk_ticket tkt_$(rid 10) "$EVR" "$(newcode)" refunded  80000  false
mk_ticket tkt_$(rid 10) "$EVR" "$(newcode)" cancelled 60000  false
panel "$JAR_A" "$EVR"
grep -c '<dd data-metric="revenue">R\$ 1\.234,56</dd>' "$TMP/panel.html"
EV0=evt_$(rid 10); mk_event "$EV0" "$ORG_A" 3 5000 published
panel "$JAR_A" "$EV0"
```

Esperado: `confirmed=2 pending=1 checkins=0 available=3 revenue=R$ 1.234,56 refunded=1`; `1` (espaço comum U+0020 entre `R$` e o número; espaço não separável não casa); `confirmed=0 pending=0 checkins=0 available=3 revenue=R$ 0,00 refunded=0`.

Aprovado se idêntico. (O preço atual do evento, R$ 777,00, não pode influenciar a Receita.)

### F05-C10 — Integração com F03 (X-11): vitrine + worker + `purchaseTicket` partner → painel e check-in

Execute de uma vez, sem pausas além das indicadas (os passos 2–9 levam bem menos de 60 s, prazo em que o ingresso `0004` ainda está pendente).

```bash
EV=evt_$(rid 10); mk_event "$EV" "$ORG_A" 5 10000 published
login "$JAR_P" "$PART"
curl -s -b "$JAR_P" "$WEB/events/$EV" | grep -o '<input[^>]*>'          # 1. confirma CARD_FIELD
web_buy "$JAR_P" "$EV" 4000000000000001                                    # 2. W1 (R$ 100)
partner_buy "$EV" "f05p1-$(rid 6)@example.com" 4000000000000001           # 3. P1 (R$ 100)
echo "UPDATE events SET price_cents = 15000, updated_at = now() WHERE id = '$EV'" | psqlc   # 4. novo preço
web_buy "$JAR_P" "$EV" 4000000000000001                                    # 5. W2 (R$ 150)
web_buy "$JAR_P" "$EV" 4000000000000004                                    # 6. W3 (pendente ~65 s)
partner_buy "$EV" "f05p2-$(rid 6)@example.com" 4000000000000002           # 7. P2 (recusado)
sleep 6
echo "SELECT channel || '|' || card_last4 || '|' || price_cents || '|' || status FROM tickets WHERE event_id = '$EV' ORDER BY created_at" | psqlc   # 8.
panel "$JAR_A" "$EV"                                                       # 9.
CW1=$(echo "SELECT code FROM tickets WHERE event_id='$EV' AND channel='web' AND card_last4='0001' ORDER BY created_at LIMIT 1" | psqlc)
CW3=$(echo "SELECT code FROM tickets WHERE event_id='$EV' AND card_last4='0004'" | psqlc)
CP1=$(echo "SELECT code FROM tickets WHERE event_id='$EV' AND channel='partner' AND card_last4='0001'" | psqlc)
checkin "$JAR_A" "$EV" "$CW1"                                              # 10.
checkin "$JAR_A" "$EV" "$CW1"                                              # 11.
checkin "$JAR_A" "$EV" "$CW3"                                              # 12.
checkin "$JAR_A" "$EV" "$CP1"                                              # 13.
checkin "$JAR_A" "$EV" ZZZZZZZZ                                            # 14.
panel "$JAR_A" "$EV"                                                       # 15.
```

Esperado:
- 1: um `<input ...>` do cartão (se o `name` não for `cardNumber`, ajuste `CARD_FIELD` e recomece o item com evento novo);
- 2, 5, 6: `302` ou `303` com destino terminando em `/me/tickets`;
- 3 e 7: `{"ok":true,"error":null}`;
- 8: exatamente estas 5 linhas, nesta ordem:
  ```
  web|0001|10000|confirmed
  partner|0001|10000|confirmed
  web|0001|15000|confirmed
  web|0004|15000|pending
  partner|0002|15000|declined
  ```
- 9: `confirmed=3 pending=1 checkins=0 available=1 revenue=R$ 350,00 refunded=0`;
- 10: `200` + `RES(entry_allowed)`; 11: `200` + `RES(already_used)`; 12: `200` + `RES(not_confirmed)`; 13: `200` + `RES(entry_allowed)`; 14: `200` + `RES(invalid_ticket)`;
- 15: `confirmed=3 pending=1 checkins=2 available=1 revenue=R$ 350,00 refunded=0`.

Aprovado se todas as saídas forem as esperadas. Se o passo 8 mostrar `0001` ainda `pending` após 6 s, é defeito de F03 (registre); repita `sleep 4` uma única vez antes de reprovar.

### F05-C11 — Outro organizador: 404 sem dados, nenhuma escrita (negativo, R13)

```bash
EV=evt_$(rid 10); K=$(newcode); mk_event "$EV" "$ORG_A" 5 10000 published; mk_ticket tkt_$(rid 10) "$EV" "$K" confirmed 10000 false
curl -s -o "$TMP/b_get.html"  -w '%{http_code}\n' -b "$JAR_B" "$WEB/org/events/$EV"
curl -s -o "$TMP/b_post.html" -w '%{http_code}\n' -b "$JAR_B" --data-urlencode "code=$K" "$WEB/org/events/$EV/checkin"
curl -s -o "$TMP/b_none.html" -w '%{http_code}\n' -b "$JAR_B" --data-urlencode "code=$K" "$WEB/org/events/evt_zzzzzzzzzz/checkin"
curl -s -o "$TMP/b_bad.html"  -w '%{http_code}\n' -b "$JAR_B" --data-urlencode "code=$K" "$WEB/org/events/nao-existe'%20OR%201=1/checkin"
cmp -s "$TMP/b_post.html" "$TMP/b_none.html" && echo CORPOS_IDENTICOS
grep -c 'Evento não encontrado' "$TMP/b_post.html"
cat "$TMP/b_get.html" "$TMP/b_post.html" | grep -c -e "$EV" -e 'Local F05' -e "$K" -e 'id="painel"' -e 'data-metric' -e 'id="checkin'
echo "SELECT checked_in FROM tickets WHERE code = '$K'" | psqlc
checkin "$JAR_A" "$EV" "$K"
```

Esperado: `404`, `404`, `404`, `404`; `CORPOS_IDENTICOS`; `1` (ou mais); `0`; `f`; e, como controle com o dono, `200` + `RES(entry_allowed)`.

Aprovado se todas as saídas forem as esperadas (o controle prova que o código era válido e que só a autoria impediu o check-in).

### F05-C12 — Participante e visitante não acessam (negativo, R13, X-09)

```bash
EV=evt_$(rid 10); K=$(newcode); mk_event "$EV" "$ORG_A" 5 10000 published; mk_ticket tkt_$(rid 10) "$EV" "$K" confirmed 10000 false
curl -s -o "$TMP/p_get.html"  -w '%{http_code}\n' -b "$JAR_P" "$WEB/org/events/$EV"
curl -s -o "$TMP/p_post.html" -w '%{http_code}\n' -b "$JAR_P" --data-urlencode "code=$K" "$WEB/org/events/$EV/checkin"
cat "$TMP/p_get.html" "$TMP/p_post.html" | grep -c -e "$EV" -e 'Local F05' -e 'id="painel"' -e 'data-metric' -e 'data-result'
curl -s -D - -o /dev/null --data-urlencode "code=$K" "$WEB/org/events/$EV/checkin" | grep -iE '^(HTTP/|location:)'
curl -s -D - -o /dev/null "$WEB/org/events/$EV" | grep -iE '^(HTTP/|location:)'
echo "SELECT checked_in FROM tickets WHERE code = '$K'" | psqlc
```

Esperado: `403`; `403`; `0`; visitante POST: linha `HTTP/1.1 302` (ou `303`) e `Location: /login?next=...` (prefixo `/login?next=`); visitante GET: idem; `f`.

Aprovado se todas as saídas forem as esperadas.

### F05-C13 — Textos de R10 vêm de `src/messages.js` (X-09)

```bash
for m in 'Ingresso inválido para este evento' 'Evento cancelado' 'Ingresso não confirmado' 'Ingresso já utilizado' 'Entrada liberada'; do
  printf '%s | messages.js=%s | checkin=%s\n' "$m" "$(grep -cF "$m" src/messages.js)" "$(grep -rlF "$m" src/features/checkin | wc -l)"
done
```

Esperado: 5 linhas, cada uma com `messages.js=` ≥ 1 e `checkin=0` (nenhum arquivo de F05 tem o texto literal; ele é importado).

Aprovado se as 5 linhas atenderem e se, nos itens C02–C12, cada `RES(KEY)` observado tiver o texto byte a byte igual ao da tabela da seção 1.4.

### F05-C14 — Escopo da entrega (wave paralela, sem migração)

```bash
BASE=$(git merge-base HEAD main)
git diff --name-only "$BASE" HEAD
git diff --name-only "$BASE" HEAD -- db/migrations src/features/partner src/messages.js | wc -l
git diff --numstat "$BASE" HEAD -- src/app.js
```

Esperado: a lista contém só caminhos em `src/features/checkin/`, `src/app.js`, `test/f05-*.test.js`, `test/helpers/f05-fixtures.js`, `docs/features/F05-checkin-painel/`, `state.json` e, no máximo, `src/format.js` e/ou `src/features/events/views.js` com justificativa no PR (spec, seções 5 e 8); `0`; `src/app.js` com até 2 linhas adicionadas e 0 removidas, todas referentes a `checkin`.

Aprovado se as três condições valerem. (Se avaliado depois do merge em `main`, use como `BASE` o pai do primeiro commit de F05 e como `HEAD` o último commit de F05 do PR.)

### F05-C15 — Gates passam e contêm os testes de F05

```bash
./scripts/gates.sh 2>&1 | tee "$TMP/gates.log"; echo "exit=${PIPESTATUS[0]}"
for id in F05-AC01 F05-AC02 F05-AC03 F05-AC04 F05-AC05 F05-AC06 F05-AC07 F05-AC08 F05-AC09 F05-AC10 X-09 X-10 X-11; do
  printf '%s=%s ' "$id" "$(grep -c "$id" "$TMP/gates.log")"; done; echo
grep -E '(#|ℹ) fail [0-9]+' "$TMP/gates.log"
ls test/f05-*.test.js
```

Esperado: `exit=0`; cada ID com contagem ≥ 1 (há pelo menos um teste nomeado com o ID); linha de resumo `# fail 0` ou `ℹ fail 0`; os arquivos `test/f05-checkin.test.js`, `test/f05-painel.test.js`, `test/f05-acesso.test.js`, `test/f05-integracao.test.js`.

Aprovado se as quatro condições valerem.

### Encerramento

```bash
./scripts/down.sh
```

## 3. Observações para o avaliador

- Itens independentes: cada um cria eventos e códigos novos (`rid`, `newcode`), podem ser rodados em qualquer ordem e repetidos.
- Itens que manipulam status via SQL (C03–C09, C11, C12) simulam estados que F03/F06 produzem; C10 usa o fluxo real de compra e o worker.
- X-17 (compras HTTP da API de F04 no painel) **não** é deste contrato: pertence a F06 e é reexecutado após o merge dos dois PRs da W4.
- Qualquer resposta `500` em qualquer item reprova o item.

## 4. Mapeamento critério → itens

| Critério (PRD) | Itens |
|---|---|
| F05-AC01 | F05-C01, F05-C02 |
| F05-AC02 | F05-C03, F05-C04 |
| F05-AC03 | F05-C04 |
| F05-AC04 | F05-C05, F05-C10 |
| F05-AC05 | F05-C06, F05-C10 |
| F05-AC06 | F05-C02, F05-C06, F05-C07 |
| F05-AC07 | F05-C01, F05-C08, F05-C10 |
| F05-AC08 | F05-C08, F05-C09, F05-C10 |
| F05-AC09 | F05-C11, F05-C12 |
| F05-AC10 | F05-C04 |
| X-09 (F01 → F05) | F05-C12, F05-C13 |
| X-10 (F02 → F05) | F05-C01, F05-C11 |
| X-11 (F03 → F05) | F05-C10 |
| Testes automatizados (todos acima) | F05-C15 |
| Escopo da wave paralela (PRD seção 5) | F05-C14 |

## 5. Formato do relatório do avaliador

Arquivo **novo** `docs/features/F05-checkin-painel/reports/AAAA-MM-DD-HHMM-avaliacao.md` (data/hora local do início da avaliação; nunca editar relatório existente — reavaliação gera outro arquivo), commitado sozinho, com:

```markdown
# Avaliação F05 — Check-in e painel

- Data: AAAA-MM-DD HH:MM (fuso)
- Commit avaliado: <hash curto> (branch <nome>)
- Avaliador: <ferramenta> / <modelo>
- Ambiente: APP_PORT=<porta>; ajustes de pré-requisito (nomes de campos, CSRF, etc.): <nenhum | lista>

## Itens

| Item | Veredito | Evidência resumida |
|---|---|---|
| F05-C01 | APROVADO / REPROVADO | ... |
| ... (C01 a C15, todos) | | |

## Evidências

### F05-C01
<comandos executados e saída literal relevante (status HTTP, linhas de HTML/SQL)>
... (uma subseção por item)

## Critérios do PRD

| Critério | Itens | Veredito |
|---|---|---|
| F05-AC01 | C01, C02 | APROVADO / REPROVADO |
| ... (todas as linhas da seção 4) | | |

## Veredito final

APROVADO (todos os 15 itens aprovados) ou REPROVADO (lista dos itens reprovados e defeitos encontrados, com arquivo/rota envolvidos).
```

Regras: um critério do PRD só é APROVADO se todos os seus itens forem APROVADO; o veredito final é APROVADO somente se os 15 itens forem APROVADO. Depois de commitar o relatório, atualize `latestReport` e `status` de F05 em `state.json` (`done` se aprovado, `needs_fix` se reprovado).
