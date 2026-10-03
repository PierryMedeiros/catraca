# F03 — Vitrine, compra e gateway: contrato de avaliação

> Para o agente avaliador (outra sessão, sem acesso ao implementador). Leia `AGENTS.md`, `docs/prd.md` (F03-AC01..AC13, X-03, X-04, X-05) e `docs/features/F03-compra/spec.md`. Não leia o histórico do implementador.
> Cada item tem passos exatos, resultado esperado observável e critério de aprovação objetivo. Um item só é APROVADO se **todos** os seus critérios forem atendidos. Item que não puder ser executado como descrito é REPROVADO, com a explicação.
> Duração estimada: ~15 min (os itens C09, C13 e C14 esperam o atraso lento do gateway, 65 s).

## 0. Pré-requisitos de ambiente

Host com Docker (Compose v2), Git, `curl`, `bash`, GNU `date`. Todos os comandos rodam **em `bash`, na raiz do clone**, numa única sessão de terminal (as funções abaixo precisam existir na sessão). Modo padrão do gateway (o do avaliador): **não** defina `GATEWAY_FAST_DELAY_MS`, `GATEWAY_SLOW_DELAY_MS` nem `GATEWAY_POLL_MS`.

```bash
git rev-parse HEAD                      # commit avaliado (vai no relatório)
export APP_PORT=${APP_PORT:-3000}       # use outra porta se 3000 estiver ocupada, ex.: APP_PORT=3103
WEB="http://localhost:$APP_PORT"
./scripts/up.sh                         # build + banco + migrações + seed; só retorna com /health = 200
curl -s -o /dev/null -w '%{http_code}\n' "$WEB/health"          # 200
docker compose exec -T app printenv | grep -c '^GATEWAY_'        # 0 (modo padrão)

RUN=$(date +%s)                         # sufixo único desta rodada de avaliação
J=$(mktemp -d)                          # cookie jars e páginas salvas

# Serviço do Postgres no Compose (o do app chama-se "app"; confira com: docker compose ps --services)
DB_SVC=$(docker compose ps --services | grep -vx app | head -n1); echo "DB_SVC=$DB_SVC"
sql() { docker compose exec -T "$DB_SVC" sh -c 'psql -v ON_ERROR_STOP=1 -qAt -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-${POSTGRES_USER:-postgres}}"'; }
echo "SELECT count(*) FROM schema_migrations;" | sql            # um número >= 3

# Cria evento direto na tabela events (colunas fixadas pelo PRD) e imprime o id.
# uso: mkevent <email_organizador> <nome sem aspas> <lotacao> <preco_cents> <draft|published|cancelled>
mkevent() { sql <<SQL
WITH n AS (
  INSERT INTO events (id, organizer_id, name, starts_at, venue, capacity, price_cents, status, created_at, updated_at, cancelled_at)
  SELECT 'evt_' || substr(md5(random()::text), 1, 10), u.id, '$2', now() + interval '30 days',
         'Teatro F03', $3, $4, '$5', now(), now(), CASE WHEN '$5' = 'cancelled' THEN now() END
  FROM users u WHERE u.email = '$1'
  RETURNING id)
SELECT id FROM n;
SQL
}
login()  { rm -f "$1"; curl -s -c "$1" -b "$1" -o /dev/null -w '%{http_code} %{redirect_url}\n' \
             --data-urlencode "email=$2" --data-urlencode "password=$3" "$WEB/login"; }
signup() { rm -f "$1"; curl -s -c "$1" -b "$1" -o /dev/null -w '%{http_code} %{redirect_url}\n' \
             --data-urlencode "name=$2" --data-urlencode "email=$3" --data-urlencode "password=segredo123" "$WEB/signup"; }
# Compra na vitrine. uso: buy <jar ou /dev/null> <evento> <cartao>  -> "status destino tempo_s"
buy()    { curl -s -b "$1" -o /dev/null -w '%{http_code} %{redirect_url} %{time_total}\n' \
             --data-urlencode "cardNumber=$3" "$WEB/events/$2/purchase"; }
page()   { curl -s -b "$1" -o "$J/$3" -w '%{http_code}\n' "$WEB$2"; }   # uso: page <jar> <caminho> <arquivo>
has()    { grep -cF -- "$1" "$J/$2"; }                                  # conta linhas com o trecho literal
lastt()  { echo "SELECT id FROM tickets WHERE event_id='$1' ORDER BY created_at DESC LIMIT 1;" | sql; }
# Roda um script Node dentro do container do app (lido do stdin). Variáveis passam com -e NOME.
nodeapp() { docker compose exec -T "$@" app node -; }

# Contas da seed (PRD §10) e participantes novos desta rodada
login  "$J/a"  org.a@catraca.local        catraca123     # 302|303 ... /org/events
login  "$J/b"  org.b@catraca.local        catraca123     # 302|303 ... /org/events
login  "$J/p"  participante@catraca.local catraca123     # 302|303 ... /
signup "$J/p1" "Ana F03"  "f03-$RUN-ana@example.com"     # 302|303 ... /
signup "$J/p2" "Bia F03"  "f03-$RUN-bia@example.com"     # 302|303 ... /
```

Se qualquer linha acima não produzir o comentado, registre no relatório e reprove os itens que dependem dela. Os nomes de campos `email`, `password`, `name` (F01) e `cardNumber` (F03) são os da spec; se a spec de F01 fixar nomes diferentes para login/cadastro, use os de lá (isso não é motivo de reprovação de F03).

Prelúdio dos scripts Node (usado em C12, C15, C16, C18). Ele carrega módulos do projeto em CommonJS ou ESM; se `docker compose exec app pwd` não for a raiz do projeto (pasta com `src/`), ajuste `path.resolve`:

```js
const path = require('node:path'); const { pathToFileURL } = require('node:url');
const imp = async (p) => { const m = await import(pathToFileURL(path.resolve(p)).href); return Object.assign({}, m.default, m); };
```

---

## 1. Itens verificáveis

### F03-C01 — Vitrine lista só eventos à venda, com dados e escape (F03-AC01)

```bash
EP=$(mkevent org.a@catraca.local "F03 Pub $RUN"  2 10000 published)
ED=$(mkevent org.a@catraca.local "F03 Rasc $RUN" 2 10000 draft)
EX=$(mkevent org.a@catraca.local "F03 Canc $RUN" 2 10000 cancelled)
EH=$(mkevent org.a@catraca.local "<script>alert(1)</script> F03 $RUN" 2 10000 published)
for jar in /dev/null "$J/p" "$J/a"; do
  echo "== $jar"; page "$jar" / home.html
  grep -F "data-event-id=\"$EP\"" "$J/home.html"
  has "$ED" home.html; has "$EX" home.html; has "F03 Rasc $RUN" home.html; has "F03 Canc $RUN" home.html
  has "<script>alert(1)</script>" home.html; has "&lt;script&gt;alert(1)" home.html
done
```

Esperado, para cada um dos três (visitante, participante, organizador A):
- status `200`;
- uma linha `<li class="event" data-event-id="$EP">` contendo `href="/events/$EP"`, `F03 Pub $RUN`, `Teatro F03`, `R$ 100,00` e uma data no formato `dd/mm/aaaa HH:mm`;
- os quatro `has` de rascunho/cancelado imprimem `0`;
- `<script>alert(1)</script>` → `0`; `&lt;script&gt;alert(1)` → `1` ou mais.

Aprovação: todas as condições acima nas três sessões.

### F03-C02 — Evento esgotado continua na vitrine com `Ingressos esgotados` (F03-AC01, F03-AC05)

```bash
EF=$(mkevent org.a@catraca.local "F03 Lotado $RUN" 1 10000 published)
buy "$J/p1" "$EF" 4000000000000003        # cartão lento: fica pendente ~65 s ocupando a vaga
page /dev/null / home.html
grep -F "data-event-id=\"$EF\"" "$J/home.html"
grep -F "data-event-id=\"$EP\"" "$J/home.html" | grep -cF 'Ingressos esgotados'
```

Esperado: compra `303 …/me/tickets`; a linha de `$EF` existe e contém `Ingressos esgotados` (dentro de `<span class="sold-out">`); a linha de `$EP` (com vagas) dá `0`.
Aprovação: as três condições, executadas em menos de 60 s após a compra.

### F03-C03 — Página do evento por papel (F03-AC02)

```bash
page /dev/null "/events/$EP" ev_v.html
has "href=\"/login?next=/events/$EP\"" ev_v.html; has 'Entrar para comprar' ev_v.html; has 'name="cardNumber"' ev_v.html
has "F03 Pub $RUN" ev_v.html; has 'Teatro F03' ev_v.html; has 'R$ 100,00' ev_v.html; grep -o 'Vagas disponíveis: [0-9]*' "$J/ev_v.html"
page "$J/p" "/events/$EP" ev_p.html
has "action=\"/events/$EP/purchase\"" ev_p.html; has 'name="cardNumber"' ev_p.html
page "$J/a" "/events/$EP" ev_a.html
has 'name="cardNumber"' ev_a.html; has 'Somente participantes compram ingressos.' ev_a.html
```

Esperado: visitante `200`, `1`, `1`, `0`, `1`, `1`, `1`, `Vagas disponíveis: 2`; participante `200`, `1`, `1`; organizador `200`, `0`, `1`.
Aprovação: todos os valores iguais aos esperados.

### F03-C04 — Rascunho, cancelado, inexistente e id malformado dão 404 (F03-AC02, robustez)

```bash
for id in "$ED" "$EX" evt_naoexiste0 "evt_%27%3B%20DROP%20TABLE%20tickets%3B--" "$(printf 'x%.0s' $(seq 3000))"; do
  page "$J/p" "/events/$id" nf.html; has 'Evento não encontrado' nf.html
done
page "$J/p" "/events/$ED" nf_d.html; has "F03 Rasc $RUN" nf_d.html
buy "$J/p" "$ED" 4000000000000001
buy "$J/p" "$EX" 4000000000000001
echo "SELECT count(*) FROM tickets WHERE event_id IN ('$ED','$EX');" | sql
echo "SELECT to_regclass('public.tickets') IS NOT NULL;" | sql
```

Esperado: cada GET imprime `404` e `1`; o 404 do rascunho imprime `404` e, para `F03 Rasc $RUN` no corpo, `0`; as duas compras → `404` (sem `Location`); contagem `0`; tabela `tickets` existe (`t`).
Aprovação: todos os valores iguais; nenhuma resposta `500`.

### F03-C05 — Compra na vitrine cria ingresso pendente sem esperar o gateway (F03-AC03)

Execute o bloco inteiro de uma vez (as duas primeiras linhas precisam rodar em menos de 2 s):

```bash
E5=$(mkevent org.a@catraca.local "F03 Compra $RUN" 3 10000 published)
buy "$J/p1" "$E5" 4000000000000001; page "$J/p1" /me/tickets mt5.html
T5=$(lastt "$E5"); echo "$T5"
grep -F "data-ticket-id=\"$T5\"" "$J/mt5.html"
echo "SELECT status, channel, user_id = (SELECT id FROM users WHERE email='f03-$RUN-ana@example.com'), buyer_email, price_cents,
      code ~ '^[A-Z0-9]{8}\$', card_last4, gateway_outcome, round(extract(epoch FROM gateway_due_at - created_at)::numeric, 1), checked_in
      FROM tickets WHERE event_id='$E5';" | sql
echo "SELECT code FROM tickets WHERE id='$T5';" | sql
echo "SELECT count(*) FROM tickets t WHERE row_to_json(t)::text LIKE '%4000000000000001%';" | sql
```

Esperado:
- compra: `303 http://localhost:$APP_PORT/me/tickets <tempo>` com `<tempo>` < `1.0`;
- `/me/tickets` `200`; a linha de `$T5` contém `F03 Compra $RUN`, `data-status="pending">pendente<` e o código impresso pela consulta de `code`;
- a consulta de colunas imprime exatamente uma linha `pending|web|t|f03-<RUN>-ana@example.com|10000|t|0001|approved|2.0|f` (o atraso 2.0 pode variar entre `1.9` e `2.1`);
- contagem de linhas contendo o número completo do cartão: `0`.

Aprovação: todas as condições.

### F03-C06 — Cartão inválido é rejeitado antes de criar ingresso; espaços são removidos (F03-AC04)

```bash
E6=$(mkevent org.a@catraca.local "F03 Cartao $RUN" 3 10000 published)
for c in 123 400000000000000 40000000000000011 400000000000000a ""; do
  curl -s -b "$J/p1" -o "$J/r6.html" -w '%{http_code} ' --data-urlencode "cardNumber=$c" "$WEB/events/$E6/purchase"
  has 'Número do cartão inválido: informe os 16 dígitos.' r6.html
done
has '400000000000000a' r6.html
curl -s -b "$J/p1" -o /dev/null -w '%{http_code}\n' -d 'cardNumber=4000000000000001&cardNumber=4000000000000001' "$WEB/events/$E6/purchase"
curl -s -b "$J/p1" -o /dev/null -w '%{http_code}\n' -d 'outro=1' "$WEB/events/$E6/purchase"
echo "SELECT count(*) FROM tickets WHERE event_id='$E6';" | sql
buy "$J/p1" "$E6" '4000 0000 0000 0001'
echo "SELECT count(*), max(card_last4) FROM tickets WHERE event_id='$E6';" | sql
```

Esperado: os cinco cartões imprimem `422 1`; o corpo não ecoa o número (`0`); campo repetido → `422`; campo ausente → `422`; contagem `0`; cartão com espaços → `303 …/me/tickets`; contagem final `1|0001`.
Aprovação: todos os valores iguais.

### F03-C07 — Sem vaga, a vitrine mostra `Ingressos esgotados` e o POST não cria ingresso (F03-AC05)

Execute em menos de 60 s:

```bash
E7=$(mkevent org.a@catraca.local "F03 Esgota $RUN" 1 10000 published)
buy "$J/p1" "$E7" 4000000000000003
page "$J/p" "/events/$E7" ev7.html
has '<p class="sold-out">Ingressos esgotados</p>' ev7.html; has 'name="cardNumber"' ev7.html; grep -o 'Vagas disponíveis: [0-9]*' "$J/ev7.html"
page /dev/null "/events/$E7" ev7v.html; has 'Ingressos esgotados' ev7v.html; has 'Entrar para comprar' ev7v.html
curl -s -b "$J/p" -o "$J/r7.html" -w '%{http_code}\n' --data-urlencode cardNumber=4000000000000001 "$WEB/events/$E7/purchase"
has 'Ingressos esgotados' r7.html
echo "SELECT count(*) FROM tickets WHERE event_id='$E7';" | sql
```

Esperado: compra `303`; participante da seed `200`, `1`, `0`, `Vagas disponíveis: 0`; visitante `200`, `1`, `0`; segunda compra `409` e `Ingressos esgotados` presente (≥ `1`); contagem `1`.
Aprovação: todos os valores iguais.

### F03-C08 — Gateway rápido no modo padrão: `0001` confirma, `0002` e outros recusam, em ≤ 5 s, com pendente visível antes (F03-AC06, F03-AC11)

Execute as quatro primeiras linhas de uma vez:

```bash
E8=$(mkevent org.a@catraca.local "F03 Rapido $RUN" 5 10000 published)
for c in 4000000000000001 4000000000000002 4000000000000009; do buy "$J/p2" "$E8" $c; done
page "$J/p2" /me/tickets mt8a.html; grep -F "F03 Rapido $RUN" "$J/mt8a.html" | grep -cF '>pendente<'
echo "SELECT card_last4, status FROM tickets WHERE event_id='$E8' ORDER BY card_last4;" | sql
sleep 6
echo "SELECT card_last4, status, round(extract(epoch FROM updated_at - created_at)::numeric, 1) FROM tickets WHERE event_id='$E8' ORDER BY card_last4;" | sql
page "$J/p2" /me/tickets mt8b.html; grep -F "F03 Rapido $RUN" "$J/mt8b.html" | grep -o 'data-status="[a-z]*">[a-z]*<'
```

Esperado:
- três compras `303`; logo depois, `3` linhas com `>pendente<` em "Meus ingressos" (evidência principal do pendente visível); a consulta SQL seguinte mostra as três `pending` (se o `docker compose exec` demorar mais de ~1,5 s e algum já tiver resolvido, vale a evidência do HTML e o atraso medido abaixo);
- após 6 s: `0001|confirmed|x`, `0002|declined|y`, `0009|declined|z` com cada x, y, z entre `1.5` e `5.0`;
- "Meus ingressos" (recarregado) mostra `data-status="confirmed">confirmado<` uma vez e `data-status="declined">recusado<` duas vezes para esse evento.

Aprovação: todas as condições.

### F03-C09 — Gateway lento no modo padrão: `0003` confirma e `0004` recusa entre 60 e 75 s; recusa libera a vaga (F03-AC06, F03-AC07)

Pode rodar em paralelo com C13 (outro terminal, repetindo o bloco da seção 0 sem `./scripts/up.sh`).

```bash
E9=$(mkevent org.a@catraca.local "F03 Lento $RUN" 5 10000 published)
buy "$J/p1" "$E9" 4000000000000003; buy "$J/p1" "$E9" 4000000000000004
sleep 55
echo "SELECT card_last4, status FROM tickets WHERE event_id='$E9' ORDER BY card_last4;" | sql
page /dev/null "/events/$E9" ev9a.html; grep -o 'Vagas disponíveis: [0-9]*' "$J/ev9a.html"
sleep 21
echo "SELECT card_last4, status, round(extract(epoch FROM updated_at - created_at)::numeric, 1) FROM tickets WHERE event_id='$E9' ORDER BY card_last4;" | sql
page /dev/null "/events/$E9" ev9b.html; grep -o 'Vagas disponíveis: [0-9]*' "$J/ev9b.html"
```

Esperado: aos 55 s, `0003|pending`, `0004|pending` e `Vagas disponíveis: 3`; aos 76 s, `0003|confirmed|x` e `0004|declined|y` com 60.0 ≤ x, y ≤ 75.0, e `Vagas disponíveis: 4`.
Aprovação: todas as condições.

### F03-C10 — Vagas contam só `pending` + `confirmed` (F03-AC07)

```bash
E10=$(mkevent org.a@catraca.local "F03 Libera $RUN" 1 10000 published)
buy "$J/p1" "$E10" 4000000000000002
page /dev/null "/events/$E10" e10a.html; grep -o 'Vagas disponíveis: [0-9]*\|Ingressos esgotados' "$J/e10a.html" | sort -u
sleep 6
echo "SELECT status FROM tickets WHERE event_id='$E10';" | sql
page /dev/null "/events/$E10" e10b.html; grep -o 'Vagas disponíveis: [0-9]*' "$J/e10b.html"; has 'Ingressos esgotados' e10b.html
buy "$J/p1" "$E10" 4000000000000001

E10B=$(mkevent org.a@catraca.local "F03 Status $RUN" 2 10000 published)
buy "$J/p1" "$E10B" 4000000000000003; buy "$J/p1" "$E10B" 4000000000000003
page /dev/null "/events/$E10B" e10c.html; grep -o 'Vagas disponíveis: [0-9]*' "$J/e10c.html"
echo "UPDATE tickets SET status='cancelled' WHERE id=(SELECT id FROM tickets WHERE event_id='$E10B' ORDER BY created_at LIMIT 1);
      UPDATE tickets SET status='refunded' WHERE event_id='$E10B' AND status='pending';" | sql
page /dev/null "/events/$E10B" e10d.html; grep -o 'Vagas disponíveis: [0-9]*' "$J/e10d.html"
```

Esperado: primeira página `Ingressos esgotados` e `Vagas disponíveis: 0`; após 6 s, `declined`, `Vagas disponíveis: 1`, `0`; nova compra `303`. Em `$E10B`: `Vagas disponíveis: 0` com dois pendentes e `Vagas disponíveis: 2` depois de um virar `cancelled` e outro `refunded`.
Aprovação: todos os valores iguais.

### F03-C11 — Lotação garantida sob 30 compras simultâneas na vitrine, 3 rodadas (F03-AC08, R07)

```bash
for r in 1 2 3; do
  E=$(mkevent org.a@catraca.local "F03 Carga $RUN-$r" 5 1000 published); echo "rodada $r $E"
  seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -b "$J/p1" \
    --data-urlencode "cardNumber=4000000000000001" "$WEB/events/$E/purchase" | sort | uniq -c
  echo "SELECT count(*) FILTER (WHERE status IN ('pending','confirmed')), count(*) FROM tickets WHERE event_id='$E';" | sql
  sleep 6
  echo "SELECT status, count(*) FROM tickets WHERE event_id='$E' GROUP BY status;" | sql
done
```

Esperado em **cada** rodada (eventos novos): exatamente `5 303` e `25 409` (nenhum outro código); `5|5`; após 6 s, `confirmed|5`.
Aprovação: as 3 rodadas com o resultado exato. Uma rodada diferente reprova o item.

### F03-C12 — Lotação garantida sob 30 chamadas simultâneas de `purchaseTicket`, 3 rodadas (F03-AC08, R07)

```bash
for r in 1 2 3; do
  E=$(mkevent org.a@catraca.local "F03 Servico $RUN-$r" 5 1000 published); echo "rodada $r $E"
  nodeapp -e EVT="$E" <<'EOF'
const path = require('node:path'); const { pathToFileURL } = require('node:url');
const imp = async (p) => { const m = await import(pathToFileURL(path.resolve(p)).href); return Object.assign({}, m.default, m); };
(async () => {
  const svc = await imp('src/features/purchases/service.js');
  const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => svc.purchaseTicket({
    eventId: process.env.EVT, buyer: { email: `svc${i}@example.com` }, cardNumber: '4000000000000001', channel: 'partner' })));
  const c = {}; for (const r of rs) { const k = r.ok ? 'ok' : r.error; c[k] = (c[k] || 0) + 1; }
  console.log(JSON.stringify(c)); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
EOF
  echo "SELECT count(*) FILTER (WHERE status IN ('pending','confirmed')), count(*), count(*) FILTER (WHERE channel='partner' AND user_id IS NULL) FROM tickets WHERE event_id='$E';" | sql
done
```

Esperado em cada rodada: `{"ok":5,"sold_out":25}` e `5|5|5`.
Aprovação: as 3 rodadas com o resultado exato.

### F03-C13 — Worker só altera ingresso `pending` (F03-AC09, R11)

Execute as três primeiras linhas de uma vez (a atualização precisa pegar o `0001` ainda pendente):

```bash
E13=$(mkevent org.a@catraca.local "F03 Worker $RUN" 5 10000 published)
buy "$J/p1" "$E13" 4000000000000001; buy "$J/p1" "$E13" 4000000000000003; buy "$J/p1" "$E13" 4000000000000004
echo "UPDATE tickets SET status='cancelled', updated_at=now() WHERE event_id='$E13' AND card_last4 IN ('0001','0003') AND status='pending' RETURNING card_last4;
      UPDATE tickets SET status='refunded',  updated_at=now() WHERE event_id='$E13' AND card_last4='0004' AND status='pending' RETURNING card_last4;" | sql
sleep 80
echo "SELECT card_last4, status, gateway_due_at < now() FROM tickets WHERE event_id='$E13' ORDER BY card_last4;" | sql
```

Esperado: o UPDATE imprime `0001`, `0003` e `0004` (os três estavam pendentes; se `0001` não aparecer, repita o item com um evento novo — não é falha do produto); após 80 s: `0001|cancelled|t`, `0003|cancelled|t`, `0004|refunded|t`.
Aprovação: os três status inalterados com o vencimento já passado.

### F03-C14 — Resposta do gateway sobrevive a reinício (F03-AC10)

Rode sozinho (derruba o app); de preferência depois dos demais itens e antes de C23.

```bash
E14=$(mkevent org.a@catraca.local "F03 Reinicio $RUN" 5 10000 published)
buy "$J/p1" "$E14" 4000000000000003; T14=$(lastt "$E14")
echo "SELECT status, gateway_due_at > now() FROM tickets WHERE id='$T14';" | sql
./scripts/down.sh
curl -s -o /dev/null -w '%{http_code}\n' "$WEB/health"
sleep 70
./scripts/up.sh
sleep 5
echo "SELECT status, round(extract(epoch FROM updated_at - created_at)::numeric, 0) >= 70 FROM tickets WHERE id='$T14';" | sql
```

Esperado: antes do `down`, `pending|t`; durante, `000`; 5 s depois de `up.sh` retornar, `confirmed|t` (resolvido depois do reinício, porque ficou vencido com o app parado).
Aprovação: as três saídas. Após o item, refaça os `login`/`signup` da seção 0 se for continuar (as sessões podem expirar se o segredo mudar).

### F03-C15 — "Meus ingressos" mostra só os ingressos do participante, com evento, rótulo e código (F03-AC11)

```bash
E15A=$(mkevent org.a@catraca.local "F03 MeusA $RUN" 5 10000 published)
E15B=$(mkevent org.b@catraca.local "F03 MeusB $RUN" 5 2000 published)
signup "$J/p4" "Duda F03" "f03-$RUN-duda@example.com"
buy "$J/p4" "$E15A" 4000000000000001; buy "$J/p4" "$E15B" 4000000000000002; buy "$J/p" "$E15A" 4000000000000001
nodeapp -e EVT="$E15A" -e MAIL="f03-$RUN-duda@example.com" <<'EOF'
const path = require('node:path'); const { pathToFileURL } = require('node:url');
const imp = async (p) => { const m = await import(pathToFileURL(path.resolve(p)).href); return Object.assign({}, m.default, m); };
(async () => {
  const svc = await imp('src/features/purchases/service.js');
  const r = await svc.purchaseTicket({ eventId: process.env.EVT, buyer: { email: process.env.MAIL }, cardNumber: '4000000000000001', channel: 'partner' });
  console.log(r.ok, r.ticket && r.ticket.user_id); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
EOF
sleep 6
echo "SELECT t.id, t.code, t.status, coalesce(u.email,'(partner)') FROM tickets t LEFT JOIN users u ON u.id=t.user_id
      WHERE t.event_id IN ('$E15A','$E15B') ORDER BY t.created_at;" | sql
page "$J/p4" /me/tickets mt15.html; has 'class="ticket"' mt15.html
grep -F 'class="ticket"' "$J/mt15.html"
page /dev/null /me/tickets mt15v.html; curl -s -o /dev/null -w '%{redirect_url}\n' "$WEB/me/tickets"
page "$J/a" /me/tickets mt15a.html; has 'class="ticket"' mt15a.html
```

Esperado:
- script: `true null`;
- consulta: 4 linhas (2 da Duda, 1 do participante da seed, 1 `(partner)` com o e-mail da Duda);
- `/me/tickets` da Duda: `200` e exatamente `2` linhas `class="ticket"`: uma com `F03 MeusA $RUN`, `data-status="confirmed">confirmado<` e o código dela; outra com `F03 MeusB $RUN`, `data-status="declined">recusado<` e o código dela. Os códigos do ingresso do participante da seed e do ingresso `(partner)` **não** aparecem (`grep -cF <código> "$J/mt15.html"` = `0` para cada um);
- visitante: `302` e destino terminando em `/login?next=/me/tickets` (ou `next=%2Fme%2Ftickets`);
- organizador: `403` e `0`.

Aprovação: todas as condições.

### F03-C16 — Código único, formato de ids e nova tentativa em colisão (F03-AC12)

```bash
echo "SELECT count(*) FROM pg_constraint WHERE conrelid='tickets'::regclass AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (code)';" | sql
echo "SELECT count(*) FROM tickets WHERE id !~ '^tkt_[a-z0-9]{10}\$' OR code !~ '^[A-Z0-9]{8}\$';" | sql
echo "SELECT count(*) - count(DISTINCT code), count(*) FROM tickets;" | sql
echo "INSERT INTO tickets (id, event_id, user_id, buyer_email, code, status, price_cents, channel, card_last4, gateway_outcome, gateway_due_at)
      SELECT 'tkt_zzzzzzzzzz', event_id, user_id, buyer_email, code, 'declined', price_cents, channel, card_last4, gateway_outcome, gateway_due_at
      FROM tickets LIMIT 1;" | sql; echo "exit=$?"
E16=$(mkevent org.a@catraca.local "F03 Colisao $RUN" 5 1000 published)
nodeapp -e EVT="$E16" <<'EOF'
const path = require('node:path'); const { pathToFileURL } = require('node:url');
const imp = async (p) => { const m = await import(pathToFileURL(path.resolve(p)).href); return Object.assign({}, m.default, m); };
(async () => {
  const svc = await imp('src/features/purchases/service.js'); const { pool } = await imp('src/db.js');
  const existing = (await pool.query('SELECT code FROM tickets LIMIT 1')).rows[0].code;
  const fresh = svc.generateTicketCode(); let calls = 0;
  const t = await svc.insertTicket(pool, { eventId: process.env.EVT, userId: null, buyerEmail: 'colisao@example.com', priceCents: 1000,
    channel: 'partner', cardLast4: '0002', gatewayOutcome: 'declined', delayMs: 1000 }, () => (++calls === 1 ? existing : fresh));
  const sample = Array.from({ length: 2000 }, () => svc.generateTicketCode());
  console.log(JSON.stringify({ calls, codeIsFresh: t.code === fresh, idOk: /^tkt_[a-z0-9]{10}$/.test(t.id),
    sampleOk: sample.every((c) => /^[A-Z0-9]{8}$/.test(c)), distinct: new Set(sample).size }));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
EOF
```

Esperado: `1`; `0`; `0|N` (N = total de ingressos); o INSERT falha com `duplicate key value violates unique constraint "tickets_code_key"` e `exit=` diferente de 0; o script imprime `{"calls":2,"codeIsFresh":true,"idOk":true,"sampleOk":true,"distinct":2000}` (aceita `distinct` ≥ 1999).
Aprovação: todos os valores.

### F03-C17 — Só participante compra na vitrine (F03-AC13)

```bash
curl -s -b "$J/a" -o "$J/r17.html" -w '%{http_code}\n' --data-urlencode cardNumber=4000000000000001 "$WEB/events/$EP/purchase"
has 'name="cardNumber"' r17.html
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' --data-urlencode cardNumber=4000000000000001 "$WEB/events/$EP/purchase"
echo "SELECT count(*) FROM tickets WHERE event_id='$EP';" | sql
```

Esperado: organizador `403` e `0`; visitante `302 http://localhost:$APP_PORT/login?next=/events/$EP`; contagem `0` (`$EP` nunca recebeu compra neste contrato).
Aprovação: todos os valores.

### F03-C18 — Ordem e validação de erros do serviço de compra (F03-AC03, F03-AC04; base de F04-AC04/AC05)

```bash
ECF=$(mkevent org.a@catraca.local "F03 CancCheio $RUN" 1 10000 published)
buy "$J/p1" "$ECF" 4000000000000003; echo "UPDATE events SET status='cancelled', cancelled_at=now() WHERE id='$ECF';" | sql
EFULL=$(mkevent org.a@catraca.local "F03 Cheio $RUN" 1 10000 published); buy "$J/p1" "$EFULL" 4000000000000003
nodeapp -e EP="$EP" -e ED="$ED" -e EX="$EX" -e ECF="$ECF" -e EFULL="$EFULL" <<'EOF'
const path = require('node:path'); const { pathToFileURL } = require('node:url');
const imp = async (p) => { const m = await import(pathToFileURL(path.resolve(p)).href); return Object.assign({}, m.default, m); };
(async () => {
  const svc = await imp('src/features/purchases/service.js'); const E = process.env;
  const b = { email: 'ordem@example.com' }, card = '4000000000000001', ch = 'partner';
  const cases = {
    cartao_invalido_evento_inexistente: { eventId: 'evt_naoexiste0', buyer: b, cardNumber: '123', channel: ch },
    email_invalido: { eventId: E.EP, buyer: { email: 'x@y' }, cardNumber: card, channel: ch },
    cartao_numerico: { eventId: E.EP, buyer: b, cardNumber: 4000000000000001, channel: ch },
    cartao_com_espacos: { eventId: E.EP, buyer: b, cardNumber: '4000 0000 0000 0001', channel: ch },
    canal_invalido: { eventId: E.EP, buyer: b, cardNumber: card, channel: 'pix' },
    web_sem_usuario: { eventId: E.EP, buyer: b, cardNumber: card, channel: 'web' },
    inexistente: { eventId: 'evt_naoexiste0', buyer: b, cardNumber: card, channel: ch },
    rascunho: { eventId: E.ED, buyer: b, cardNumber: card, channel: ch },
    cancelado: { eventId: E.EX, buyer: b, cardNumber: card, channel: ch },
    cancelado_sem_vaga: { eventId: E.ECF, buyer: b, cardNumber: card, channel: ch },
    sem_vaga: { eventId: E.EFULL, buyer: b, cardNumber: card, channel: ch },
  };
  for (const [k, v] of Object.entries(cases)) { const r = await svc.purchaseTicket(v); console.log(k, r.ok ? 'ok' : r.error); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
EOF
echo "SELECT count(*) FROM tickets WHERE buyer_email='ordem@example.com';" | sql
```

Esperado (exatamente, em até 60 s após as compras `0003`):

```
cartao_invalido_evento_inexistente invalid_request
email_invalido invalid_request
cartao_numerico invalid_request
cartao_com_espacos invalid_request
canal_invalido invalid_request
web_sem_usuario invalid_request
inexistente event_not_available
rascunho event_not_available
cancelado event_not_available
cancelado_sem_vaga event_not_available
sem_vaga sold_out
```

e contagem `0`.
Aprovação: as 11 linhas idênticas e contagem `0`.

### F03-C19 — Entradas malformadas na vitrine não derrubam o app (robustez)

```bash
curl -s -b "$J/p1" -o /dev/null -w '%{http_code}\n' -H 'Content-Type: application/json' -d '{nao e json' "$WEB/events/$EP/purchase"
curl -s -b "$J/p1" -o /dev/null -w '%{http_code}\n' --data-urlencode cardNumber=4000000000000001 "$WEB/events/evt_naoexiste0/purchase"
curl -s -b "$J/p1" -o /dev/null -w '%{http_code}\n' --data-urlencode cardNumber=4000000000000001 "$WEB/events/nao-e-id/purchase"
curl -s -b "$J/p1" -o /dev/null -w '%{http_code}\n' -X POST "$WEB/events/$EP/purchase"
curl -s -o /dev/null -w '%{http_code}\n' "$WEB/health"
docker compose logs app --since 5m 2>&1 | grep -ci 'unhandled\|uncaught' 
echo "SELECT count(*) FROM tickets WHERE event_id='$EP';" | sql
```

Esperado: JSON malformado → `400` ou `422`; `404`; `404`; POST sem corpo → `422`; `200`; `0`; `0`.
Aprovação: valores conforme o esperado; nenhuma resposta `500`; nenhum ingresso criado em `$EP`.

### F03-C20 — X-03: participante novo compra e vê o ingresso; visitante volta ao evento após login (X-03)

```bash
signup "$J/p3" "Caio F03" "f03-$RUN-caio@example.com"
echo "SELECT role FROM users WHERE email='f03-$RUN-caio@example.com';" | sql
E20=$(mkevent org.a@catraca.local "F03 X03 $RUN" 3 10000 published)
buy "$J/p3" "$E20" 4000000000000001
page "$J/p3" /me/tickets mt20.html; grep -F "F03 X03 $RUN" "$J/mt20.html" | grep -o 'data-status="[a-z]*">[a-z]*<\|ticket-code">[A-Z0-9]\{8\}<'
page /dev/null "/events/$E20" ev20.html; has "href=\"/login?next=/events/$E20\"" ev20.html
rm -f "$J/v"; curl -s -c "$J/v" -b "$J/v" -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  --data-urlencode "email=participante@catraca.local" --data-urlencode "password=catraca123" --data-urlencode "next=/events/$E20" \
  "$WEB/login?next=/events/$E20"
page "$J/v" "/events/$E20" ev20p.html; has 'name="cardNumber"' ev20p.html
```

Esperado: cadastro `302|303 …/`; `participant`; compra `303 …/me/tickets`; "Meus ingressos" `200` com a linha do evento mostrando `data-status="pending">pendente<` ou `data-status="confirmed">confirmado<` e `ticket-code">XXXXXXXX<`; página do evento para visitante `200` e `1`; login `302` ou `303` com destino terminando em `/events/$E20`; a página do evento com a nova sessão `200` e `1`.
Aprovação: todas as condições.

### F03-C21 — X-04: evento de F02 só aparece após publicar; mudança de preço vale só para compras seguintes (X-04)

Campos do formulário de F02: confira com `curl -s -b "$J/a" "$WEB/org/events/new" | grep -o 'name="[^"]*"' | sort -u`. Os comandos usam `name`, `startsAt`, `venue`, `capacity`, `price`; se a spec de F02 usar outros nomes, substitua-os (os valores não mudam).

```bash
START=$(date -d '+30 days' +%Y-%m-%dT%H:%M)
evform() { echo "--data-urlencode name=$1 --data-urlencode startsAt=$START --data-urlencode venue=Teatro-X --data-urlencode capacity=$2 --data-urlencode price=$3"; }
R=$(curl -s -b "$J/a" -o /dev/null -w '%{http_code} %{redirect_url}' $(evform "F03-X04-$RUN" 3 100,00) "$WEB/org/events"); echo "$R"; E21=${R##*/}; echo "$E21"
page /dev/null / h21a.html; has "$E21" h21a.html; page /dev/null "/events/$E21" e21a.html
curl -s -b "$J/a" -o /dev/null -w '%{http_code}\n' -d '' "$WEB/org/events/$E21/publish"
page /dev/null / h21b.html; grep -F "data-event-id=\"$E21\"" "$J/h21b.html" | grep -cF 'R$ 100,00'
buy "$J/p1" "$E21" 4000000000000001
curl -s -b "$J/a" -o /dev/null -w '%{http_code}\n' $(evform "F03-X04-$RUN" 3 150,00) "$WEB/org/events/$E21/edit"
echo "SELECT price_cents FROM events WHERE id='$E21';" | sql
echo "SELECT price_cents FROM tickets WHERE event_id='$E21' ORDER BY created_at;" | sql
buy "$J/p1" "$E21" 4000000000000001
echo "SELECT price_cents FROM tickets WHERE event_id='$E21' ORDER BY created_at;" | sql
page /dev/null "/events/$E21" e21b.html; has 'R$ 150,00' e21b.html
```

Esperado: criação `302|303 …/org/events/evt_…` e `$E21` no formato `evt_[a-z0-9]{10}`; antes de publicar, vitrine `200` com `0` e página do evento `404`; publicar `302|303`; vitrine com `R$ 100,00` na linha (`1`); primeira compra `303`; edição `302|303`; evento `15000`; ingressos `10000`; segunda compra `303`; ingressos `10000` e `15000` (nessa ordem); página `200` e `1`.
Aprovação: todas as condições.

### F03-C22 — X-05: lotação de F02 respeita ingressos reais de F03 (X-05)

```bash
R=$(curl -s -b "$J/a" -o /dev/null -w '%{redirect_url}' $(evform "F03-X05-$RUN" 2 100,00) "$WEB/org/events"); E22=${R##*/}; echo "$E22"
curl -s -b "$J/a" -o /dev/null -w '%{http_code}\n' -d '' "$WEB/org/events/$E22/publish"
buy "$J/p1" "$E22" 4000000000000001; buy "$J/p1" "$E22" 4000000000000003
curl -s -b "$J/a" -o "$J/r22.html" -w '%{http_code}\n' $(evform "F03-X05-$RUN" 1 100,00) "$WEB/org/events/$E22/edit"
has 'A lotação não pode ser menor que as vagas ocupadas (2)' r22.html
echo "SELECT capacity FROM events WHERE id='$E22';" | sql
curl -s -b "$J/a" -o /dev/null -w '%{http_code}\n' $(evform "F03-X05-$RUN" 3 100,00) "$WEB/org/events/$E22/edit"
echo "SELECT capacity FROM events WHERE id='$E22';" | sql
page /dev/null "/events/$E22" e22.html; grep -o 'Vagas disponíveis: [0-9]*' "$J/e22.html"
buy "$J/p1" "$E22" 4000000000000001; buy "$J/p1" "$E22" 4000000000000001
echo "SELECT count(*) FILTER (WHERE status IN ('pending','confirmed')) FROM tickets WHERE event_id='$E22';" | sql
```

Esperado: publicar `302|303`; duas compras `303`; edição para 1 com status 4xx (F02 define; esperado `422`) e a mensagem presente (`1`); capacidade continua `2`; edição para 3 `302|303`; capacidade `3`; `Vagas disponíveis: 1`; terceira compra `303`, quarta `409`; ocupadas `3`.
Aprovação: todas as condições.

### F03-C23 — Gates passam e cobrem os critérios de F03

```bash
./scripts/gates.sh > "$J/gates.log" 2>&1; echo "exit=$?"
tail -n 30 "$J/gates.log"
ls test/f03-*.test.js
grep -ho 'F03-AC[0-9][0-9]\|X-0[345]' test/f03-*.test.js | sort -u | tr '\n' ' '; echo
```

Esperado: `exit=0`; o resumo final do `node --test` sem falhas (`fail 0`); os 7 arquivos de `spec.md` §8 existem; a lista de IDs contém os 16: `F03-AC01` … `F03-AC13`, `X-03`, `X-04`, `X-05`.
Aprovação: as quatro condições.

---

## 2. Mapeamento critérios → itens

| Critério (PRD) | Itens |
|---|---|
| F03-AC01 | C01, C02 |
| F03-AC02 | C03, C04 |
| F03-AC03 | C05, C18 |
| F03-AC04 | C06, C18, C19 |
| F03-AC05 | C02, C07 |
| F03-AC06 | C08, C09 |
| F03-AC07 | C09, C10 |
| F03-AC08 | C11, C12 |
| F03-AC09 | C13 |
| F03-AC10 | C14 |
| F03-AC11 | C15, C08 |
| F03-AC12 | C16 |
| F03-AC13 | C17 |
| X-03 (F01 → F03) | C20 |
| X-04 (F02 → F03) | C21 |
| X-05 (F02 → F03) | C22 |
| Todos (testes automatizados) | C23 |

Robustez negativa: C04 (404 e id malformado), C06 (cartões inválidos), C15 (visitante/organizador em Meus ingressos), C17 (organizador/visitante comprando), C18 (ordem de erros), C19 (corpo malformado). Concorrência com repetição: C11 e C12 (3 rodadas cada, eventos novos).

## 3. Relatório do avaliador

Arquivo **novo** `docs/features/F03-compra/reports/AAAA-MM-DD-HHMM-avaliacao.md` (data/hora local do início da avaliação; nunca edite um relatório existente — reavaliação gera outro arquivo). Commit só desse arquivo (e `state.json`, se o fluxo do projeto pedir), em Conventional Commits.

```markdown
# Avaliação F03 — Vitrine, compra e gateway

- Data: AAAA-MM-DD HH:MM (fuso)
- Commit avaliado: <saída de git rev-parse HEAD>
- Ferramenta e modelo: <ex.: Claude Code, <modelo>>
- Ambiente: APP_PORT=<porta>, modo padrão do gateway (sem GATEWAY_*), SO/Docker <versões>

## Resultado por item

| Item | Veredito | Evidência (resumo) |
|---|---|---|
| F03-C01 | APROVADO/REPROVADO | ... |
| ... | ... | ... |
| F03-C23 | APROVADO/REPROVADO | exit=0, fail 0 |

## Evidências

### F03-C01
<comandos executados e saída relevante, literal (status HTTP, linhas de HTML, saída do psql)>

... (uma seção por item, C01 a C23; para C11/C12, a saída das 3 rodadas)

## Critérios do PRD

| Critério | Itens | Veredito |
|---|---|---|
| F03-AC01 | C01, C02 | APROVADO se todos os itens aprovados |
| ... | ... | ... |

## Veredito final

APROVADO (todos os 23 itens aprovados) ou REPROVADO (lista dos itens reprovados e o motivo em uma linha cada).
```

Regras do veredito: o final só é APROVADO se os 23 itens forem APROVADOS. Divergência de nome de campo de formulário de F01/F02 resolvida pela spec dessas features não reprova item; divergência em qualquer marcador, status, texto ou rota definidos em `spec.md` de F03 reprova.
