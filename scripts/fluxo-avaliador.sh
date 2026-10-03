#!/usr/bin/env bash
# Fluxo do avaliador do enunciado (passos 2 a 16), automatizado com curl, contra um produto já no ar.
# Uso: ./scripts/up.sh && ./scripts/fluxo-avaliador.sh   (WEB, API e KEY podem ser sobrescritos por env)
# Leva ~3,5 min porque espera os atrasos reais do gateway (65 s). Não substitui os gates.
set -u
WEB=${WEB:-http://localhost:3000}; API=${API:-$WEB}; KEY=${KEY:-catraca-parceiro-2026}
T=$(mktemp -d); OK=0; FAIL=0
pass(){ echo "  PASS $*"; OK=$((OK+1)); }
fail(){ echo "  FAIL $*"; FAIL=$((FAIL+1)); }
check(){ local desc=$1; shift; if "$@"; then pass "$desc"; else fail "$desc"; fi; }
login(){ curl -s -c "$T/$1" -b "$T/$1" -o /dev/null -w '%{http_code}' -X POST "$WEB/login" --data-urlencode "email=$2" --data-urlencode "password=catraca123"; }
create(){ # jar name date cap price -> id
  curl -s -b "$T/$1" -c "$T/$1" -o /dev/null -w '%{redirect_url}' -X POST "$WEB/org/events" \
    --data-urlencode "name=$2" --data-urlencode "startsAt=$3" --data-urlencode "venue=Bar do Teste" \
    --data-urlencode "capacity=$4" --data-urlencode "price=$5" | sed -E 's#.*/org/events/##'; }
publish(){ curl -s -b "$T/$1" -o /dev/null -w '%{http_code}' -X POST "$WEB/org/events/$2/publish"; }
edit(){ # jar id name date cap price -> http code
  curl -s -b "$T/$1" -o /dev/null -w '%{http_code}' -X POST "$WEB/org/events/$2/edit" \
    --data-urlencode "name=$3" --data-urlencode "startsAt=$4" --data-urlencode "venue=Bar do Teste" \
    --data-urlencode "capacity=$5" --data-urlencode "price=$6"; }
apibuy(){ curl -s -w '\n%{http_code}' -X POST "$API/api/partner/events/$1/purchases" -H "X-Api-Key: $KEY" \
  -H "Content-Type: application/json" -d "{\"buyerEmail\":\"$2\",\"cardNumber\":\"$3\"}"; }
ticket(){ curl -s -H "X-Api-Key: $KEY" "$API/api/partner/tickets/$1"; }
tstatus(){ ticket "$1" | sed -E 's/.*"status":"([a-z]+)".*/\1/'; }
listing(){ curl -s -H "X-Api-Key: $KEY" "$API/api/partner/events"; }
seats(){ listing | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const e=JSON.parse(s).find(x=>x.id==='$1');console.log(e?e.availableSeats+' '+e.priceCents:'absent')})"; }
gest(){ curl -s -b "$T/$1" "$WEB/org/events/$2"; }
panel(){ gest "$1" "$2" | tr -d '\n' | grep -oE '<dt>[^<]+</dt>\s*<dd[^>]*>[^<]+</dd>' | sed -E 's#<dt>([^<]+)</dt>\s*<dd[^>]*>([^<]+)</dd>#\1=\2#' | paste -sd ';'; }
checkin(){ curl -s -b "$T/$1" -X POST "$WEB/org/events/$2/checkin" --data-urlencode "code=$3" | grep -oE 'id="checkin-result"[^>]*>[^<]+' | sed -E 's/.*>//'; }
NEXT=$(date -d '+1 month' +%Y-%m-%dT21:00); YEST=$(date -d 'yesterday' +%Y-%m-%dT%H:%M)

echo "== 2"; check "login A" [ "$(login A org.a@catraca.local)" = 302 ]
E1=$(create A "E1 Fluxo $$" "$NEXT" 2 "100,00"); echo "  E1=$E1"
check "E1 fora da vitrine (visitante)" bash -c "! curl -s '$WEB/' | grep -q '$E1'"
check "E1 fora da API" bash -c "! curl -s -H 'X-Api-Key: $KEY' '$API/api/partner/events' | grep -q '$E1'"
echo "== 3"; BAD=$(create A "Ontem $$" "$YEST" 2 "100,00"); check "data de ontem rejeitada (sem redirect para evento)" [ -z "$BAD" ]
echo "== 4"; publish A "$E1" >/dev/null
check "E1 na vitrine" bash -c "curl -s '$WEB/' | grep -q '$E1'"
check "E1 na API seats=2 price=10000" [ "$(seats "$E1")" = "2 10000" ]
echo "== 5"; U="aluno$$@example.com"
curl -s -c "$T/P" -b "$T/P" -o /dev/null -X POST "$WEB/signup" --data-urlencode "name=Aluno Fluxo" --data-urlencode "email=$U" --data-urlencode "password=segredo123"
curl -s -b "$T/P" -o /dev/null -X POST "$WEB/events/$E1/purchase" --data-urlencode "cardNumber=4000000000000001"
mt(){ curl -s -b "$T/P" "$WEB/me/tickets" | tr -d '\n' | grep -oE "data-status=\"[a-z]+\"" | head -1 | cut -d'"' -f2; }
S0=$(mt); check "Meus ingressos: pendente logo após a compra ($S0)" [ "$S0" = pending ]
sleep 5; S1=$(mt); check "Meus ingressos: confirmado em 5 s ($S1)" [ "$S1" = confirmed ]
C1=$(curl -s -b "$T/P" "$WEB/me/tickets" | tr -d '\n' | grep -oE 'class="ticket-code"[^>]*>[A-Z0-9]{8}' | head -1 | grep -oE '[A-Z0-9]{8}$'); echo "  C1=$C1"
check "Meus ingressos mostra o nome do evento" bash -c "curl -s -b '$T/P' '$WEB/me/tickets' | grep -q 'E1 Fluxo $$'"
echo "== 6"; R=$(apibuy "$E1" t2@example.com 4000000000000004); T6S=$(date +%s)
check "compra API 202 pending" bash -c "echo '$R' | tail -1 | grep -q 202 && echo '$R' | grep -q '\"status\":\"pending\"'"
T2=$(echo "$R" | head -1 | sed -E 's/.*"ticketId":"([^"]+)".*/\1/'); C2=$(echo "$R" | head -1 | sed -E 's/.*"code":"([^"]+)".*/\1/'); echo "  T2=$T2 C2=$C2"
check "E1 availableSeats 0" [ "$(seats "$E1" | cut -d' ' -f1)" = 0 ]
echo "== 7"; R=$(apibuy "$E1" t7@example.com 4000000000000001)
check "409 sold_out" bash -c "echo '$R' | tail -1 | grep -q 409 && echo '$R' | grep -q sold_out"
check "vitrine Ingressos esgotados (participante)" bash -c "curl -s -b '$T/P' '$WEB/events/$E1' | grep -q 'Ingressos esgotados'"
check "passo 7 antes de 60 s" [ $(( $(date +%s) - T6S )) -lt 60 ]
echo "== 8"; while [ $(( $(date +%s) - T6S )) -lt 76 ]; do sleep 2; done
check "T2 declined" [ "$(tstatus "$T2")" = declined ]
check "E1 availableSeats 1" [ "$(seats "$E1" | cut -d' ' -f1)" = 1 ]
R=$(apibuy "$E1" t3@example.com 4000000000000001); T3=$(echo "$R" | head -1 | sed -E 's/.*"ticketId":"([^"]+)".*/\1/'); sleep 5
check "T3 confirmed em 5 s" [ "$(tstatus "$T3")" = confirmed ]
echo "== 9"; check "lotação 1 rejeitada" [ "$(edit A "$E1" "E1 Fluxo $$" "$NEXT" 1 "100,00")" != 302 ]
check "preço 150 e lotação 3 aceitos" [ "$(edit A "$E1" "E1 Fluxo $$" "$NEXT" 3 "150,00")" = 302 ]
R=$(apibuy "$E1" t4@example.com 4000000000000001); sleep 5
P=$(panel A "$E1"); echo "  painel: $P"
check "painel E1 3/0/0/0/R\$ 350,00/0" bash -c "echo '$P' | grep -q 'Confirmados=3;Pendentes=0;Check-ins=0;Vagas disponíveis=0;Receita=R\$ 350,00;Estornados=0'"
echo "== 10"
check "C1 Entrada liberada" [ "$(checkin A "$E1" "$C1")" = "Entrada liberada" ]
check "C1 Ingresso já utilizado" [ "$(checkin A "$E1" "$C1")" = "Ingresso já utilizado" ]
check "C2 Ingresso não confirmado" [ "$(checkin A "$E1" "$C2")" = "Ingresso não confirmado" ]
check "ZZZZZZZZ inválido" [ "$(checkin A "$E1" ZZZZZZZZ)" = "Ingresso inválido para este evento" ]
check "painel Check-ins 1" bash -c "echo '$(panel A "$E1")' | grep -q 'Check-ins=1'"
echo "== 11"; login B org.b@catraca.local >/dev/null
check "B: lista sem E1" bash -c "! curl -s -b '$T/B' '$WEB/org/events' | grep -q -e '$E1' -e 'E1 Fluxo $$'"
check "B: URL direta sem dados de E1" bash -c "! curl -s -b '$T/B' '$WEB/org/events/$E1' | grep -q -e 'E1 Fluxo $$' -e 'Confirmados'"
E2=$(create B "E2 Fluxo $$" "$NEXT" 1 "20,00"); publish B "$E2" >/dev/null
check "E2 na listagem da API" bash -c "curl -s -H 'X-Api-Key: $KEY' '$API/api/partner/events' | grep -q '$E2'"
R=$(apibuy "$E2" c3@example.com 4000000000000001); C3=$(echo "$R" | head -1 | sed -E 's/.*"code":"([^"]+)".*/\1/')
login S participante@catraca.local >/dev/null
check "participante seed: sem dados de E1" bash -c "! curl -s -b '$T/S' -L '$WEB/org/events/$E1' | grep -q -e 'E1 Fluxo $$' -e 'Confirmados'"
check "visitante: sem dados de E1" bash -c "! curl -s -L '$WEB/org/events/$E1' | grep -q -e 'E1 Fluxo $$' -e 'Confirmados'"
sleep 3; check "C3 no check-in de E1 inválido" [ "$(checkin A "$E1" "$C3")" = "Ingresso inválido para este evento" ]
echo "== 12"; E3=$(create A "E3 Fluxo $$" "$NEXT" 5 "50,00"); publish A "$E3" >/dev/null
R5=$(apibuy "$E3" t5@example.com 4000000000000003); T5S=$(date +%s); T5=$(echo "$R5" | head -1 | sed -E 's/.*"ticketId":"([^"]+)".*/\1/')
R6=$(apibuy "$E3" t6@example.com 4000000000000001); T6=$(echo "$R6" | head -1 | sed -E 's/.*"ticketId":"([^"]+)".*/\1/'); C6=$(echo "$R6" | head -1 | sed -E 's/.*"code":"([^"]+)".*/\1/')
for i in $(seq 10); do [ "$(tstatus "$T6")" = confirmed ] && break; sleep 1; done
check "T6 confirmed antes do cancelamento" [ "$(tstatus "$T6")" = confirmed ]
curl -s -b "$T/A" -o /dev/null -X POST "$WEB/org/events/$E3/cancel"; check "cancelado antes de 60 s de T5" [ $(( $(date +%s) - T5S )) -lt 60 ]
echo "== 13"
check "E3 fora da vitrine" bash -c "! curl -s '$WEB/' | grep -q '$E3'"
check "E3 fora da API" [ "$(seats "$E3")" = absent ]
R=$(apibuy "$E3" x@example.com 4000000000000001); check "compra E3 404 event_not_available" bash -c "echo '$R' | tail -1 | grep -q 404 && echo '$R' | grep -q event_not_available"
sleep 10; check "T6 refunded" [ "$(tstatus "$T6")" = refunded ]; check "T5 cancelled" [ "$(tstatus "$T5")" = cancelled ]
check "edição de E3 recusada" [ "$(edit A "$E3" "E3 mudado" "$NEXT" 9 "50,00")" != 302 ]
check "gestão de E1 (ativo) tem formulário de edição" bash -c "curl -s -b '$T/A' '$WEB/org/events/$E1' | grep -q 'action=\"/org/events/$E1/edit\"'"
check "gestão de E3 (cancelado) sem formulário de edição" bash -c "! curl -s -b '$T/A' '$WEB/org/events/$E3' | grep -q 'action=\"/org/events/$E3/edit\"'"
echo "== 14"; while [ $(( $(date +%s) - T5S )) -lt 76 ]; do sleep 2; done
check "T5 continua cancelled após 75 s" [ "$(tstatus "$T5")" = cancelled ]
check "C6 Evento cancelado" [ "$(checkin A "$E3" "$C6")" = "Evento cancelado" ]
P=$(panel A "$E3"); echo "  painel: $P"
check "painel E3 0/0/0/R\$ 0,00/1" bash -c "echo '$P' | grep -q 'Confirmados=0;Pendentes=0;Check-ins=0;.*Receita=R\$ 0,00;Estornados=1'"
echo "== 15"
for n in 4 5; do
  E=$(create A "E$n Fluxo $$" "$NEXT" 5 "10,00"); publish A "$E" >/dev/null
  OUT=$(seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/api/partner/events/$E/purchases" \
    -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d '{"buyerEmail":"carga{}@example.com","cardNumber":"4000000000000001"}' | sort | uniq -c | tr -s ' ' | paste -sd ',')
  echo "  E$n: $OUT"; check "E$n 5x202 25x409" [ "$OUT" = " 5 202, 25 409" ]
  sleep 10; P=$(panel A "$E"); check "E$n painel Confirmados 5 e Vagas 0" bash -c "echo '$P' | grep -q 'Confirmados=5;.*Vagas disponíveis=0'"
done
echo "== 16"
for r in "events" "events/$E1/purchases" "tickets/$T2"; do
  m=GET; [ "$r" = "events/$E1/purchases" ] && m=POST
  for h in "" "X-Api-Key: errada"; do
    R=$(curl -s -w ' %{http_code}' -X $m ${h:+-H "$h"} -H 'Content-Type: application/json' -d '{}' "$API/api/partner/$r" 2>/dev/null)
    [ $m = GET ] && R=$(curl -s -w ' %{http_code}' ${h:+-H "$h"} "$API/api/partner/$r")
    check "401 $m $r [${h:-sem chave}]" [ "$R" = '{"error":"unauthorized"} 401' ]
  done
done
R=$(apibuy "$E1" a@example.com 123 | paste -sd' '); check "cardNumber 123 → 422 invalid_request" [ "$R" = '{"error":"invalid_request"} 422' ]
R=$(curl -s -w ' %{http_code}' -H "X-Api-Key: $KEY" "$API/api/partner/tickets/tkt_naoexiste"); check "ticket inexistente 404" [ "$R" = '{"error":"ticket_not_found"} 404' ]
echo "== RESULTADO: $OK PASS, $FAIL FAIL"; rm -rf "$T"; [ $FAIL = 0 ]
