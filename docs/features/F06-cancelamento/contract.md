# F06 — Cancelamento de evento: contrato de avaliação

> Para o agente avaliador (sessão diferente da do implementador). Leia `AGENTS.md`, `docs/prd.md` (F06-AC01..AC08, X-12..X-17) e `spec.md` desta pasta. Não leia o histórico do implementador.
> Todos os itens rodam no **modo padrão** do produto (atrasos do gateway 2 s / 65 s). Tempo total estimado: 10–12 min (os itens F06-C07 e F06-C14 esperam 80 s cada).

## 0. Pré-requisitos de ambiente

1. Docker, Git, Node.js LTS, `curl`, `bash` no host. Nenhum `npm install` no host.
2. Na raiz do clone, no commit avaliado:

   ```bash
   export APP_PORT=3000            # ou outra porta livre, ex.: 3106
   ./scripts/up.sh                 # só retorna com /health em 200
   curl -fs "http://localhost:$APP_PORT/health" && echo OK
   ```

3. Contas da seed (senha de todas: `catraca123`): organizador A `org.a@catraca.local`, organizador B `org.b@catraca.local`, participante `participante@catraca.local`. Chave de parceiro: `catraca-parceiro-2026`. Variáveis de atraso do gateway: **não definir** (modo padrão).
4. Salve o bloco abaixo em `/tmp/f06/helpers.sh` (ajuste `REPO`) e **comece todo comando com `source /tmp/f06/helpers.sh`** (o estado do shell pode não persistir entre chamadas; ids entre itens são guardados com `save` em `/tmp/f06/vars`). Para recomeçar do zero: `rm -rf /tmp/f06/vars /tmp/f06/run /tmp/f06/*.jar`.

```bash
# /tmp/f06/helpers.sh
REPO=/caminho/absoluto/do/clone                       # AJUSTE
W=/tmp/f06; mkdir -p "$W"; cd "$REPO" || return 1
APP_PORT=${APP_PORT:-3000}
WEB="http://localhost:$APP_PORT"; API="$WEB"; KEY="catraca-parceiro-2026"
[ -f "$W/run" ] || date +%H%M%S > "$W/run"; RUN=$(cat "$W/run")   # sufixo único dos nomes de evento
[ -f "$W/vars" ] && . "$W/vars"
save() { echo "$1='$2'" >> "$W/vars"; eval "$1='$2'"; }
FUT=$(date -d '+30 days' +%Y-%m-%dT20:00)
DB_SVC=$(docker compose config --services | grep -vx app | head -1)   # serviço do Postgres
sql() { docker compose exec -T "$DB_SVC" sh -c 'psql -U "$POSTGRES_USER" -d "${POSTGRES_DB:-$POSTGRES_USER}" -tA -v ON_ERROR_STOP=1' <<<"$1"; }
txt() { sed 's/<[^>]*>/ /g; s/&nbsp;/ /g; s/\xc2\xa0/ /g' | tr -s ' \t\r\n' ' '; }
row() { tr -d '\r\n' | sed 's#</tr>#\n#g; s#</li>#\n#g' | grep -F -- "$1" | txt; }   # linha de tabela/lista que contém $1
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s)[process.argv[1]])})' "$1"; }
login() { curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -c "$W/$1.jar" -X POST "$WEB/login" --data-urlencode "email=$2" --data-urlencode "password=catraca123"; }
page() { curl -s -b "$W/$1.jar" "$WEB$2"; }
new_event() { curl -s -o /dev/null -w "%{redirect_url}" -b "$W/$1.jar" -X POST "$WEB/org/events" \
  --data-urlencode "name=$2" --data-urlencode "startsAt=$FUT" --data-urlencode "venue=Porão F06" \
  --data-urlencode "capacity=$3" --data-urlencode "price=$4" | grep -o 'evt_[a-z0-9]\{10\}'; }
publish() { curl -s -o /dev/null -w "%{http_code}\n" -b "$W/$1.jar" -X POST "$WEB/org/events/$2/publish"; }
cancel() { curl -s -o "$W/cancel-$2.html" -w "%{http_code} %{redirect_url}\n" -b "$W/$1.jar" -X POST "$WEB/org/events/$2/cancel"; }
api_buy() { curl -s -X POST "$API/api/partner/events/$1/purchases" -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d "{\"buyerEmail\":\"$3\",\"cardNumber\":\"400000000000$2\"}"; }          # $2 = final de 4 dígitos
ticket() { curl -s -H "X-Api-Key: $KEY" "$API/api/partner/tickets/$1"; echo; }
wait_status() { for i in $(seq 15); do ticket "$1" | grep -q "\"status\": *\"$2\"" && break; sleep 1; done; ticket "$1"; }
web_buy() { curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -b "$W/$1.jar" -X POST "$WEB/events/$2/purchase" --data-urlencode "cardNumber=400000000000$3"; }
checkin() { curl -sL -b "$W/$1.jar" -c "$W/$1.jar" -X POST "$WEB/org/events/$2/checkin" --data-urlencode "code=$3" | txt \
  | grep -oE 'Entrada liberada|Ingresso já utilizado|Ingresso não confirmado|Ingresso inválido para este evento|Evento cancelado' | sort -u | tr '\n' ';'; echo; }
panel() { page "$1" "/org/events/$2" | txt | grep -oE 'Confirmados:? [0-9]+|Pendentes:? [0-9]+|Check-ins:? [0-9]+|Vagas disponíveis:? [0-9]+|Receita:? R\$ ?[0-9.]*[0-9],[0-9]{2}|Estornados:? [0-9]+' | tr '\n' ';'; echo; }
seats() { curl -s -H "X-Api-Key: $KEY" "$API/api/partner/events" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const e=JSON.parse(s).find(x=>x.id===process.argv[1]);console.log(e?e.availableSeats:"ausente")})' "$1"; }
evhash() { sql "SELECT md5(row(e.*)::text) FROM events e WHERE id='$1'"; }
tkhash() { sql "SELECT coalesce(md5(string_agg(row(t.*)::text, ',' ORDER BY t.id)),'vazio') FROM tickets t WHERE event_id='$1'"; }
bystatus() { sql "SELECT status||'='||count(*) FROM tickets WHERE event_id='$1' GROUP BY status ORDER BY 1" | tr '\n' ' '; echo; }
```

5. Sessões e nomes de campo (F06-C00, não pontuado):

```bash
source /tmp/f06/helpers.sh
login A org.a@catraca.local; login B org.b@catraca.local; login P participante@catraca.local
page A /org/events/new | grep -oE 'name="[^"]+"' | sort -u
```

Esperado: `302 http://localhost:$APP_PORT/org/events` para A e B, `302 http://localhost:$APP_PORT/` para P. Os helpers assumem os campos `email`/`password` (login), `name`/`startsAt`/`venue`/`capacity`/`price` (evento), `cardNumber` (compra na vitrine) e `code` (check-in). Se a saída do `grep` (ou o HTML de `/events/:id` e da página de gestão) mostrar outros nomes, ajuste o helper e registre no relatório; isso não é falha de F06. Se `new_event` não imprimir um id, rode o `curl` sem `-o /dev/null` para ver o erro.

## 1. Itens verificáveis

### F06-C01 — Botão "Cancelar evento" só em evento publicado, com confirmação

```bash
source /tmp/f06/helpers.sh
save E01 "$(new_event A "F06 C01 $RUN" 5 100)"; echo "$E01"
page A /org/events/$E01 | grep -c "action=\"/org/events/$E01/cancel\""      # rascunho
publish A $E01
page A /org/events/$E01 > $W/c01.html
grep -c "action=\"/org/events/$E01/cancel\"" $W/c01.html
grep -o '<form[^>]*/cancel"[^>]*>' $W/c01.html
grep -c 'Cancelar evento' $W/c01.html
```

Esperado: rascunho → `0`; `publish` → `302`; publicado → `1`; a tag `<form>` contém `method="post"` e `onsubmit="return confirm(`; `Cancelar evento` ≥ 1.
Aprovação: todos os valores acima exatamente como descritos.

### F06-C02 — Cancelamento pelo dono

```bash
source /tmp/f06/helpers.sh
cancel A $E01
sql "SELECT status||'|'||(cancelled_at IS NOT NULL) FROM events WHERE id='$E01'"
page A /org/events/$E01 | txt | grep -oE 'Evento cancelado em [0-9]{2}/[0-9]{2}/[0-9]{4} [0-9]{2}:[0-9]{2}'
```

Esperado: `302 http://localhost:$APP_PORT/org/events/$E01`; `cancelled|t`; uma linha `Evento cancelado em dd/mm/aaaa HH:mm`.
Aprovação: as três saídas conferem.

### F06-C03 — Transição imediata dos ingressos (mesma transação)

```bash
source /tmp/f06/helpers.sh
save E03 "$(new_event A "F06 C03 $RUN" 10 100)"; publish A $E03
save TC3 "$(api_buy $E03 0001 c03a@example.com | jget ticketId)"   # vai a confirmed
save TP3 "$(api_buy $E03 0003 c03b@example.com | jget ticketId)"   # fica pending 60–75 s
save TD3 "$(api_buy $E03 0002 c03c@example.com | jget ticketId)"   # vai a declined
wait_status $TC3 confirmed; wait_status $TD3 declined; ticket $TP3
bystatus $E03
cancel A $E03; T1=$(date +%s)
bystatus $E03
sql "SELECT count(*) FROM tickets WHERE event_id='$E03' AND status IN ('pending','confirmed')"
ticket $TC3; ticket $TP3; ticket $TD3; echo "consultado $(( $(date +%s) - T1 )) s após o cancelamento"
```

Esperado antes: `confirmed=1 declined=1 pending=1`. Cancelamento `302`. Depois (consultado logo em seguida): `cancelled=1 declined=1 refunded=1`; contagem de ativos `0`; API: `TC3` com `"status":"refunded"`, `TP3` com `"status":"cancelled"`, `TD3` com `"status":"declined"`, todos com `"checkedIn":false`, em menos de 10 s.
Aprovação: todas as saídas conferem.

### F06-C04 — Irreversível: sem formulários e escritas recusadas

```bash
source /tmp/f06/helpers.sh
H0=$(evhash $E03); K0=$(tkhash $E03)
page A /org/events/$E03 > $W/c04.html
for r in edit publish cancel; do printf "%s form: " $r; grep -c "action=\"/org/events/$E03/$r\"" $W/c04.html; done
for r in edit publish cancel; do
  printf "%s: " $r; curl -s -o $W/c04-$r.html -w "%{http_code} " -b $W/A.jar -X POST "$WEB/org/events/$E03/$r" \
    --data-urlencode "name=Hack" --data-urlencode "startsAt=$FUT" --data-urlencode "venue=X" \
    --data-urlencode "capacity=50" --data-urlencode "price=1"; grep -c 'Evento cancelado não pode ser alterado' $W/c04-$r.html; done
printf "edit inválido: "; curl -s -o /dev/null -w "%{http_code}\n" -b $W/A.jar -X POST "$WEB/org/events/$E03/edit" --data-urlencode "capacity=0"
[ "$H0" = "$(evhash $E03)" ] && echo EVENTO_IGUAL || echo EVENTO_MUDOU
[ "$K0" = "$(tkhash $E03)" ] && echo INGRESSOS_IGUAIS || echo INGRESSOS_MUDARAM
sql "SELECT status FROM events WHERE id='$E03'"
```

Esperado: `edit form: 0`, `publish form: 0`, `cancel form: 0`; `edit: 409 1`, `publish: 409 1`, `cancel: 409 1`; `edit inválido: 409`; `EVENTO_IGUAL`; `INGRESSOS_IGUAIS`; `cancelled`.
Aprovação: todas as saídas conferem.

### F06-C05 — Fora da vitrine, da API e da compra; lista do dono mostra "cancelado"

```bash
source /tmp/f06/helpers.sh
curl -s "$WEB/" | grep -c "F06 C03 $RUN"
curl -s -o /dev/null -w "%{http_code}\n" "$WEB/events/$E03"
N0=$(sql "SELECT count(*) FROM tickets WHERE event_id='$E03'")
web_buy P $E03 0001
curl -s -H "X-Api-Key: $KEY" "$API/api/partner/events" | grep -c "\"$E03\""
curl -s -w " %{http_code}\n" -X POST "$API/api/partner/events/$E03/purchases" -H "X-Api-Key: $KEY" \
  -H "Content-Type: application/json" -d '{"buyerEmail":"c05@example.com","cardNumber":"4000000000000001"}'
echo "antes=$N0 depois=$(sql "SELECT count(*) FROM tickets WHERE event_id='$E03'")"
page A /org/events | row "F06 C03 $RUN"
```

Esperado: `0`; `404`; compra na vitrine com status `404` (qualquer status ≥ 400 é aceito, nunca `302 …/me/tickets`); `0`; `{"error":"event_not_available"} 404`; `antes` = `depois`; a linha da lista de A contém `F06 C03 <RUN>` e `cancelado`.
Aprovação: todas as saídas conferem.

### F06-C06 — "Meus ingressos" mostra estornado e cancelado

```bash
source /tmp/f06/helpers.sh
save E06 "$(new_event A "F06 C06 $RUN" 5 30)"; publish A $E06
web_buy P $E06 0001; web_buy P $E06 0004; sleep 6
save CODE61 "$(sql "SELECT code FROM tickets WHERE event_id='$E06' AND card_last4='0001'")"
save CODE64 "$(sql "SELECT code FROM tickets WHERE event_id='$E06' AND card_last4='0004'")"
page P /me/tickets | row "$CODE61"; page P /me/tickets | row "$CODE64"
cancel A $E06
page P /me/tickets | row "$CODE61"; page P /me/tickets | row "$CODE64"
```

Esperado: as duas compras `302 …/me/tickets`. Antes: linha de `CODE61` com `F06 C06 <RUN>` e `confirmado`; linha de `CODE64` com `pendente`. Cancelamento `302`. Depois: linha de `CODE61` contém o nome do evento e `estornado` (e não `confirmado`); linha de `CODE64` contém `cancelado` (e não `pendente`).
Aprovação: as quatro linhas conferem.

### F06-C07 — Resposta tardia do gateway não muda nada (passos 12–14 do brief)

```bash
source /tmp/f06/helpers.sh
save E07 "$(new_event A "F06 C07 $RUN" 5 50)"; publish A $E07
T0=$(date +%s); save T0_07 $T0
save T5 "$(api_buy $E07 0003 c07-t5@example.com | jget ticketId)"
R6=$(api_buy $E07 0001 c07-t6@example.com); save T6 "$(echo "$R6" | jget ticketId)"; save C6 "$(echo "$R6" | jget code)"
save T7 "$(api_buy $E07 0004 c07-t7@example.com | jget ticketId)"
wait_status $T6 confirmed
cancel A $E07; echo "s desde T5: $(( $(date +%s) - T0 ))"
ticket $T5; ticket $T6; ticket $T7
S1=$(sql "SELECT id||'|'||status||'|'||updated_at FROM tickets WHERE event_id='$E07' ORDER BY id"); echo "$S1"
sleep $(( 80 - ($(date +%s) - T0) )); echo "s desde T5: $(( $(date +%s) - T0 ))"
ticket $T5; ticket $T6; ticket $T7
S2=$(sql "SELECT id||'|'||status||'|'||updated_at FROM tickets WHERE event_id='$E07' ORDER BY id")
[ "$S1" = "$S2" ] && echo SEM_ALTERACAO || { echo ALTERADO; echo "$S2"; }
```

Esperado: cancelamento `302` com menos de 60 s desde T5; logo após: `T5` `cancelled`, `T6` `refunded`, `T7` `cancelled`; após ≥ 75 s (a segunda contagem imprime ≥ 80): os mesmos três status e `SEM_ALTERACAO` (nem `status` nem `updated_at` mudaram).
Aprovação: todas as saídas conferem.

### F06-C08 — Check-in e painel após cancelamento real (X-16)

Parte A — evento do F06-C07 (passo 14 do brief):

```bash
source /tmp/f06/helpers.sh
checkin A $E07 $C6
checkin A $E07 ZZZZZZZZ
panel A $E07
```

Parte B — confirmados com e sem check-in antes do cancelamento:

```bash
source /tmp/f06/helpers.sh
save E08 "$(new_event A "F06 C08 $RUN" 5 10)"; publish A $E08
R=$(api_buy $E08 0001 c08a@example.com); save T81 "$(echo "$R" | jget ticketId)"; save C81 "$(echo "$R" | jget code)"
R=$(api_buy $E08 0001 c08b@example.com); save T82 "$(echo "$R" | jget ticketId)"; save C82 "$(echo "$R" | jget code)"
R=$(api_buy $E08 0003 c08c@example.com); save C83 "$(echo "$R" | jget code)"
wait_status $T81 confirmed; wait_status $T82 confirmed
checkin A $E08 $C81
panel A $E08
cancel A $E08
panel A $E08
checkin A $E08 $C81; checkin A $E08 $C82; checkin A $E08 $C83
sql "SELECT checked_in FROM tickets WHERE id='$T81'"
```

Esperado A: `Evento cancelado;` (somente essa mensagem) para `C6`; a saída de `ZZZZZZZZ` contém `Ingresso inválido para este evento`; painel `Confirmados 0;Pendentes 0;Check-ins 0;…;Receita R$ 0,00;Estornados 1;` (Vagas disponíveis 5, conforme R05 literal; a ordem dos números pode variar).
Esperado B: primeiro check-in `Entrada liberada;`; painel antes `Confirmados 2`, `Pendentes 1`, `Check-ins 1`, `Vagas disponíveis 2`, `Receita R$ 20,00`, `Estornados 0`; cancelamento `302`; painel depois `Confirmados 0`, `Pendentes 0`, `Check-ins 0`, `Vagas disponíveis 5`, `Receita R$ 0,00`, `Estornados 2`; os três check-ins finais `Evento cancelado;` (sem nenhuma outra mensagem); `checked_in` de `T81` = `t`.
Aprovação: todos os valores conferem (os seis números do painel por rótulo, não pela posição).

### F06-C09 — Rascunho não é cancelável

```bash
source /tmp/f06/helpers.sh
save E09 "$(new_event A "F06 C09 $RUN" 5 10)"
page A /org/events/$E09 | grep -c "/org/events/$E09/cancel"
H0=$(evhash $E09)
curl -s -o $W/c09.html -w "%{http_code}\n" -b $W/A.jar -X POST "$WEB/org/events/$E09/cancel"
grep -c 'Só eventos publicados podem ser cancelados' $W/c09.html
[ "$H0" = "$(evhash $E09)" ] && echo IGUAL || echo MUDOU
sql "SELECT status||'|'||(cancelled_at IS NULL) FROM events WHERE id='$E09'"
publish A $E09; sql "SELECT status FROM events WHERE id='$E09'"
```

Esperado: `0`; `409`; `1`; `IGUAL`; `draft|t`; `302`; `published`.
Aprovação: todas as saídas conferem.

### F06-C10 — Acesso indevido: outro organizador, participante, visitante (X-12)

```bash
source /tmp/f06/helpers.sh
save E10 "$(new_event A "F06 C10 $RUN" 5 10)"; publish A $E10
save T10 "$(api_buy $E10 0001 c10@example.com | jget ticketId)"; wait_status $T10 confirmed
H0=$(evhash $E10); K0=$(tkhash $E10)
curl -s -o $W/c10-b.html -w "B: %{http_code}\n" -b $W/B.jar -X POST "$WEB/org/events/$E10/cancel"
grep -c 'Evento não encontrado' $W/c10-b.html; grep -cE "$E10|F06 C10|Porão F06" $W/c10-b.html
curl -s -o $W/c10-b-x.html -w "B inexistente: %{http_code}\n" -b $W/B.jar -X POST "$WEB/org/events/evt_zzzzzzzzzz/cancel"
diff -q $W/c10-b.html $W/c10-b-x.html && echo CORPOS_IDENTICOS
curl -s -o $W/c10-p.html -w "P: %{http_code}\n" -b $W/P.jar -X POST "$WEB/org/events/$E10/cancel"
grep -cE "F06 C10|Porão F06" $W/c10-p.html
curl -s -o $W/c10-v.html -w "visitante: %{http_code} %{redirect_url}\n" -X POST "$WEB/org/events/$E10/cancel"
grep -cE "F06 C10|Porão F06" $W/c10-v.html
[ "$H0" = "$(evhash $E10)" ] && echo EVENTO_IGUAL; [ "$K0" = "$(tkhash $E10)" ] && echo INGRESSOS_IGUAIS
page A /org/events/$E10 | grep -c "action=\"/org/events/$E10/cancel\""
```

Esperado: `B: 404`; `≥1`; `0`; `B inexistente: 404`; `CORPOS_IDENTICOS`; `P: 403`; `0`; `visitante: 302 http://localhost:$APP_PORT/login…`; `0`; `EVENTO_IGUAL`; `INGRESSOS_IGUAIS`; `1` (A ainda pode cancelar).
Aprovação: todas as saídas conferem.

### F06-C11 — Cancelamento concorrente com 30 compras (5 rodadas)

```bash
source /tmp/f06/helpers.sh
TOTAL404=0
for r in 1 2 3 4 5; do
  E=$(new_event A "F06 C11 $RUN r$r" 5 10); publish A $E >/dev/null
  buy30() { seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/api/partner/events/$E/purchases" \
    -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d "{\"buyerEmail\":\"c11-$RUN-$r-{}@example.com\",\"cardNumber\":\"4000000000000001\"}"; }
  if [ $((r % 2)) -eq 1 ]; then ( cancel A $E > $W/c11-$r-cancel.txt ) & buy30 > $W/c11-$r.txt; wait
  else buy30 > $W/c11-$r.txt & sleep 0.02; cancel A $E > $W/c11-$r-cancel.txt; wait; fi
  POS=$(for i in 1 2 3; do curl -s -o /dev/null -w "%{http_code} " -X POST "$API/api/partner/events/$E/purchases" -H "X-Api-Key: $KEY" \
    -H "Content-Type: application/json" -d '{"buyerEmail":"c11-pos@example.com","cardNumber":"4000000000000001"}'; done)
  N202=$(grep -c '^202$' $W/c11-$r.txt); N409=$(grep -c '^409$' $W/c11-$r.txt); N404=$(grep -c '^404$' $W/c11-$r.txt)
  echo "rodada $r $E: 202=$N202 409=$N409 404=$N404 soma=$((N202+N409+N404)) | cancel=$(cut -d' ' -f1 $W/c11-$r-cancel.txt) | depois=[$POS] | banco=$(sql "SELECT count(*) FROM tickets WHERE event_id='$E'") ativos=$(sql "SELECT count(*) FROM tickets WHERE event_id='$E' AND status IN ('pending','confirmed')") evento=$(sql "SELECT status FROM events WHERE id='$E'") | $(bystatus $E)"
  TOTAL404=$((TOTAL404 + N404))
done; echo "404 dentro dos lotes: $TOTAL404"
```

Esperado por rodada: `soma=30`; `202` ≤ 5; `cancel=302`; `depois=[404 404 404 ]`; `banco` = nº de `202`; `ativos=0`; `evento=cancelled`; por status só `refunded`/`cancelled`. No total: `404 dentro dos lotes` ≥ 1.
Aprovação: as 5 rodadas cumprem todos os critérios por rodada e o total de 404 é ≥ 1. Se o total for 0 (cancelamento nunca concorreu de fato), repita o laço mais uma vez (5 rodadas novas); total ainda 0 ⇒ REPROVADO.

### F06-C12 — Compras da API no painel e no check-in, com concorrência (X-17)

```bash
source /tmp/f06/helpers.sh
for k in 1 2; do
  E=$(new_event A "F06 C12 $RUN e$k" 5 10); publish A $E >/dev/null
  seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/api/partner/events/$E/purchases" \
    -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d "{\"buyerEmail\":\"c12-$RUN-$k-{}@example.com\",\"cardNumber\":\"4000000000000001\"}" | sort | uniq -c
  sleep 10; echo "evento $E: $(panel A $E) availableSeats=$(seats $E)"
  CODE=$(sql "SELECT code FROM tickets WHERE event_id='$E' AND status='confirmed' ORDER BY id LIMIT 1")
  checkin A $E $CODE; panel A $E
done
```

Esperado em cada evento: exatamente `5 202` e `25 409`; painel com `Confirmados 5`, `Pendentes 0`, `Vagas disponíveis 0`, `Receita R$ 50,00`; `availableSeats=0`; check-in `Entrada liberada;`; painel seguinte com `Check-ins 1`.
Aprovação: os dois eventos conferem.

### F06-C13 — Robustez: cancelamento duplo, ids inválidos, método errado

```bash
source /tmp/f06/helpers.sh
for r in 1 2 3; do
  E=$(new_event A "F06 C13 $RUN r$r" 5 10); publish A $E >/dev/null
  TC=$(api_buy $E 0001 c13a@example.com | jget ticketId); api_buy $E 0003 c13b@example.com >/dev/null; wait_status $TC confirmed >/dev/null
  ( cancel A $E > $W/c13-$r-a.txt ) & ( cancel A $E > $W/c13-$r-b.txt ) & wait
  echo "rodada $r: $(cut -d' ' -f1 $W/c13-$r-a.txt $W/c13-$r-b.txt | sort | tr '\n' ' ')| $(bystatus $E)"
done
N0=$(sql "SELECT count(*) FROM events WHERE status='cancelled'")
for id in evt_zzzzzzzzzz nao-existe "1%27%20OR%20%271%27%3D%271"; do curl -s -o /dev/null -w "%{http_code} " -b $W/A.jar -X POST "$WEB/org/events/$id/cancel"; done; echo
echo "cancelados antes=$N0 depois=$(sql "SELECT count(*) FROM events WHERE status='cancelled'")"
E=$(new_event A "F06 C13 GET $RUN" 5 10); publish A $E >/dev/null
curl -s -o /dev/null -w "GET: %{http_code}\n" -b $W/A.jar "$WEB/org/events/$E/cancel"; sql "SELECT status FROM events WHERE id='$E'"
curl -s -o $W/c13-b.html -w "B em cancelado de A: %{http_code}\n" -b $W/B.jar -X POST "$WEB/org/events/$E03/cancel"; grep -cE "F06 C03|$E03" $W/c13-b.html
```

Esperado: cada rodada `302 409 | cancelled=1 refunded=1`; ids inválidos `404 404 404`; `antes` = `depois`; `GET: 404` e `published`; `B em cancelado de A: 404` e `0`.
Aprovação: todas as saídas conferem.

### F06-C14 — Cancelamento sobrevive a reinício

```bash
source /tmp/f06/helpers.sh
save E14 "$(new_event A "F06 C14 $RUN" 5 10)"; publish A $E14
save T0_14 $(date +%s); save T14 "$(api_buy $E14 0004 c14@example.com | jget ticketId)"
cancel A $E14; ticket $T14
./scripts/down.sh && ./scripts/up.sh
```
```bash
source /tmp/f06/helpers.sh
sleep $(( 80 - ($(date +%s) - T0_14) )) 2>/dev/null; echo "s desde a compra: $(( $(date +%s) - T0_14 ))"
ticket $T14; sql "SELECT status FROM events WHERE id='$E14'"; seats $E14
login A org.a@catraca.local; page A /org/events/$E14 | grep -c "action=\"/org/events/$E14/\(edit\|publish\|cancel\)\""
```

Esperado: antes do reinício `"status":"cancelled"`; depois: ≥ 80 s, `T14` continua `"status":"cancelled"`, evento `cancelled`, `seats` → `ausente`, `0` formulários.
Aprovação: todas as saídas conferem.

### F06-C15 — Gates passam e cobrem os critérios

```bash
source /tmp/f06/helpers.sh
./scripts/gates.sh > $W/gates.log 2>&1; echo "exit=$?"
ls test/cancellation.test.js test/cancellation-concurrency.test.js
for id in F06-AC01 F06-AC02 F06-AC03 F06-AC04 F06-AC05 F06-AC06 F06-AC07 F06-AC08 X-12 X-13 X-14 X-15 X-16 X-17; do
  printf "%s %s\n" $id "$(cat test/cancellation*.test.js | grep -c -- "$id")"; done
grep -c 'F06-AC0' $W/gates.log
docker compose -p catraca-gates ps -aq | wc -l
```

Esperado: `exit=0`; os dois arquivos existem; cada ID com contagem ≥ 1; o log cita os testes de F06 (≥ 1); `0` containers restantes do projeto de gates.
Aprovação: todas as saídas conferem. Anexe ao relatório as últimas 30 linhas de `$W/gates.log`.

### F06-C16 — Inspeção do código (trava e transação)

```bash
source /tmp/f06/helpers.sh
grep -n "lockEvent\|getEventForOrganizer\|UPDATE events\|UPDATE tickets\|BEGIN\|COMMIT" src/features/cancellation/service.js
grep -n "withTransaction\|cancelEvent" src/features/cancellation/routes.js
grep -rn "cancelled" src/features/events/ | grep -v "^.*views.js" | head
ls db/migrations/
```

Esperado: em `cancelEvent`, `lockEvent(client, …)` aparece antes de `getEventForOrganizer` e dos dois `UPDATE`; o `UPDATE tickets` filtra `status IN ('pending','confirmed')` (ou dois UPDATEs equivalentes) e usa o mesmo `client`; não há `BEGIN`/`COMMIT` no serviço; a rota chama `cancelEvent` dentro de `withTransaction`; os handlers de edição/publicação de `src/features/events/` checam `cancelled`; `db/migrations/` tem só `001`–`003`, ou um `004_cancelamento_status.sql` justificado na spec.
Aprovação: todos os pontos conferem na leitura (cite as linhas no relatório).

Ao terminar: `./scripts/down.sh`.

## 2. Mapeamento de critérios

| Critério do PRD | Itens |
|---|---|
| F06-AC01 (botão com confirmação; `cancelled` + `cancelled_at`) | F06-C01, F06-C02 |
| F06-AC02 (mesma transação via `lockEvent`; nenhum `pending`/`confirmed` logo após) | F06-C03, F06-C16 |
| F06-AC03 (irreversível; edit/publish/cancel recusados) | F06-C04, F06-C14 |
| F06-AC04 (some da vitrine; compra rejeitada; "Meus ingressos" estornado/cancelado) | F06-C05, F06-C06 |
| F06-AC05 (resposta tardia não muda `cancelled`) | F06-C07, F06-C14 |
| F06-AC06 (rascunho não cancelável, mensagem exata) | F06-C01, F06-C09 |
| F06-AC07 (B → 404; participante → 403; visitante → login) | F06-C10, F06-C13 |
| F06-AC08 (cancelamento × 30 compras; 404 para quem perdeu; lotação respeitada) | F06-C11, F06-C13 |
| X-12 (F01 → F06: guardas) | F06-C10 |
| X-13 (F02 → F06: edição/publicação recusadas; fora de `listOnSaleEvents`; lista mostra "cancelado") | F06-C04, F06-C05 |
| X-14 (F03 → F06: transições; worker mantém `cancelled`; vitrine para; "Meus ingressos" estornado) | F06-C03, F06-C05, F06-C06, F06-C07 |
| X-15 (F04 → F06: some da API; 404 na compra; `refunded`/`cancelled` em ≤ 10 s; persiste 75 s) | F06-C03, F06-C05, F06-C07 |
| X-16 (F05 → F06: `Evento cancelado` no check-in; painel zerado com Estornados) | F06-C08 |
| X-17 (F04 ‖ F05: compras da API no painel e no check-in) | F06-C12 |
| Gates (AGENTS.md regra 10; P-01) | F06-C15 |

## 3. Relatório do avaliador

Criar um arquivo **novo** `docs/features/F06-cancelamento/reports/AAAA-MM-DD-HHMM-avaliacao.md` (data/hora local de início da avaliação), commitado sozinho e nunca editado depois (reavaliação = arquivo novo). Conteúdo:

```markdown
# Avaliação F06 — Cancelamento de evento

- Data: AAAA-MM-DD HH:MM (fuso)
- Commit avaliado: <hash completo de `git rev-parse HEAD`> (branch <nome>)
- Ferramenta e modelo: <ex.: Claude Code, modelo X>
- Ambiente: APP_PORT=<porta>, modo padrão do gateway, SO <…>
- Ajustes de helper (F06-C00): <nenhum | campos renomeados …>

| Item | Veredito | Evidência (resumo) |
|---|---|---|
| F06-C01 | APROVADO/REPROVADO | … |
| … | … | … |
| F06-C16 | … | … |

## Evidências
### F06-C01
<comandos executados e saída literal, recortada só no que for irrelevante>
…

## Critérios do PRD
<tabela critério → APROVADO/REPROVADO, derivada da seção 2: um critério só é APROVADO se todos os seus itens forem>

## Veredito final
APROVADO (todos os 16 itens aprovados) | REPROVADO (lista dos itens reprovados e o que falhou)
```

Depois de commitar o relatório, atualizar `state.json` (F06: `status` `done` se aprovado, `needs_fix` se reprovado; `latestReport` com o caminho do arquivo).
