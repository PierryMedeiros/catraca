# Brief da fundadora (cópia literal do enunciado do desafio)

## Comportamento esperado: o brief

Esta seção é o brief da fundadora. Tudo que o avaliador testa no produto está aqui; o resto (stack, telas, divisão em features, modelagem) é decisão sua. As regras têm identificador, de R01 a R13, para que o seu PRD e os seus contratos possam rastreá-las.

### Quem usa

- Visitante: sem login, vê a vitrine de eventos.
- Participante: cria a própria conta (nome, e-mail e senha), entra, sai, compra ingressos e vê os próprios ingressos.
- Organizador: não se cadastra pelo produto; as contas de organizador vêm da seed. Cria e opera os próprios eventos.
- Parceiro: sistema externo que vende ingressos pela API de parceiros, autenticado por uma chave.

### Status do ingresso

Na interface aparece o rótulo; na API, o valor.

| Rótulo | Valor na API | Quando |
|---|---|---|
| pendente | `pending` | compra criada, aguardando a resposta do gateway |
| confirmado | `confirmed` | o gateway aprovou |
| recusado | `declined` | o gateway recusou |
| cancelado | `cancelled` | estava pendente quando o evento foi cancelado |
| estornado | `refunded` | estava confirmado quando o evento foi cancelado |

Ter passado pelo check-in não é um status: é uma informação à parte (na API, o campo `checkedIn`).

### Regras

Eventos

- R01. Um evento tem nome, data e hora de início, local, lotação (inteiro, mínimo 1) e preço (em reais, maior que zero). A data de início precisa estar no futuro, ao criar e ao editar.
- R02. Todo evento nasce como rascunho. Só evento publicado e não cancelado aparece na vitrine e na listagem da API de parceiros e aceita compras.
- R03. A lotação nunca pode ficar menor que as vagas ocupadas (R05). Mudança de preço vale só para as compras feitas depois dela.
- R04. Cada evento tem uma página de gestão com endereço (URL) próprio, onde o organizador edita, publica, cancela, faz o check-in e vê o painel.

Vagas e compra

- R05. Vagas ocupadas são os ingressos pendentes mais os confirmados. Vagas disponíveis são a lotação menos as vagas ocupadas.
- R06. Cada compra é de um ingresso, feita pelo participante na vitrine ou pelo parceiro na API. A compra nasce pendente, já ocupa vaga e é respondida sem esperar o gateway.
- R07. Sem vaga disponível, a compra é recusada: a vitrine exibe `Ingressos esgotados` (no lugar da compra ou como resposta à tentativa) e a API responde `sold_out`. As vagas ocupadas nunca passam da lotação, nem com compras simultâneas.
- R08. Quando o gateway aprova, o ingresso fica confirmado. Quando recusa, fica recusado e a vaga é liberada.
- R09. Cada ingresso tem um código único, usado no check-in. Em "Meus ingressos", o participante vê o evento, o status e o código de cada ingresso que comprou.

Check-in

- R10. Na página de gestão do evento, o organizador informa o código de um ingresso. A primeira linha verdadeira da tabela abaixo define a mensagem exibida. Em evento cancelado, a mensagem `Evento cancelado` pode aparecer no lugar do campo de check-in.

| Ordem | Situação do código | Mensagem |
|---|---|---|
| 1 | não existe ou é de outro evento | `Ingresso inválido para este evento` |
| 2 | o evento está cancelado | `Evento cancelado` |
| 3 | o ingresso não está confirmado | `Ingresso não confirmado` |
| 4 | o ingresso já passou pelo check-in | `Ingresso já utilizado` |
| 5 | nenhuma das anteriores | `Entrada liberada` |

Cancelamento

- R11. O organizador pode cancelar um evento publicado, e o cancelamento é irreversível: o evento sai da vitrine e da API, não vende mais e não pode ser editado nem republicado. Em até 10 segundos, os ingressos confirmados passam a estornados e os pendentes a cancelados. Resposta do gateway que chegue depois não muda o status de nenhum deles.

Painel

- R12. A página de gestão mostra o painel do evento, contando as vendas da vitrine e da API com as definições abaixo.

| Número | Definição |
|---|---|
| Confirmados | ingressos confirmados, inclusive os que já passaram pelo check-in |
| Pendentes | ingressos pendentes |
| Check-ins | ingressos confirmados que já passaram pelo check-in |
| Vagas disponíveis | conforme R05 |
| Receita | soma do valor pago pelos ingressos confirmados, com o preço vigente no momento de cada compra |
| Estornados | ingressos estornados |

Acesso

- R13. Na área de organizador, cada organizador só vê e opera os próprios eventos, inclusive quando acessa diretamente o endereço da página de gestão de um evento de outro organizador. Participante e visitante não acessam a área de organizador.

Uma observação sobre R07: garantir a lotação sob compras simultâneas não é abordado no módulo. Pesquisar como garantir essa regra, e como provar que ela vale, faz parte do desafio.

### Gateway de pagamento simulado

O pagamento passa por um gateway externo. No modo padrão do produto, que é o que o avaliador usa, o gateway é simulado e responde conforme o final do número do cartão:

| Final do cartão | Resultado | Quando a resposta chega |
|---|---|---|
| `0001` | aprovado | em até 5 segundos |
| `0002` | recusado | em até 5 segundos |
| `0003` | aprovado | entre 60 e 75 segundos |
| `0004` | recusado | entre 60 e 75 segundos |
| qualquer outro | recusado | em até 5 segundos |

O número do cartão tem 16 dígitos (ex.: `4000000000000001`); fora disso, a compra é rejeitada antes de criar o ingresso.

### API de parceiros (contrato fixo)

A API de parceiros tem contrato fixo porque o avaliador conversa com ela pela linha de comando. Toda rota exige o cabeçalho `X-Api-Key` com a chave de parceiro documentada no README; sem ele, ou com chave inválida, a resposta é `401` com `{"error":"unauthorized"}`. Os IDs são strings, no formato que você escolher.

Eventos à venda (publicados e não cancelados), com `availableSeats` igual às vagas disponíveis de R05:

```
GET /api/partner/events

200
[
  {
    "id": "evt_8f2k",
    "name": "Jazz no Porão",
    "startsAt": "2026-12-05T21:00:00-03:00",
    "priceCents": 10000,
    "availableSeats": 2
  }
]
```

Compra de um ingresso:

```
POST /api/partner/events/{eventId}/purchases
Content-Type: application/json

{ "buyerEmail": "ana@example.com", "cardNumber": "4000000000000001" }

202
{ "ticketId": "tkt_51xq", "code": "K7Q2M9XA", "status": "pending" }
```

Depois da chave, os erros da compra são verificados nesta ordem: corpo inválido (campo faltando, e-mail mal formado ou cartão sem 16 dígitos) responde `422` com `{"error":"invalid_request"}`; evento inexistente, em rascunho ou cancelado responde `404` com `{"error":"event_not_available"}`; falta de vaga responde `409` com `{"error":"sold_out"}`.

Consulta de um ingresso, de qualquer canal de venda:

```
GET /api/partner/tickets/{ticketId}

200
{ "ticketId": "tkt_51xq", "code": "K7Q2M9XA", "eventId": "evt_8f2k", "status": "confirmed", "checkedIn": false }
```

Ingresso inexistente responde `404` com `{"error":"ticket_not_found"}`. Compras pela API não ficam vinculadas a contas de participante, mas valem para lotação, painel, check-in e cancelamento exatamente como as da vitrine.


---

# Fluxo do avaliador (cópia literal)


O fluxo é público. Nele, `$WEB` e `$API` são os endereços do produto e da API de parceiros informados no README, e `$KEY` é a chave de parceiro. As contas do organizador A, do organizador B e do participante vêm da seed.

**1.** Clone o repositório em uma pasta vazia e rode o comando de subida do README. O produto fica acessível em `$WEB`, com a seed carregada, sem nenhum outro passo.

**2.** Como organizador A, crie o evento E1 (lotação 2, R$ 100,00, data no mês seguinte) sem publicar. Deslogado, a vitrine não mostra E1, e a listagem da API também não:

```
curl -s -H "X-Api-Key: $KEY" "$API/api/partner/events"
```

**3.** Ainda como A, tente criar um evento com a data de ontem: a criação é rejeitada.

**4.** Publique E1. Ele aparece na vitrine e na listagem da API com `availableSeats` 2 e `priceCents` 10000. Guarde o `id` em `$E1`.

**5.** Crie uma conta de participante nova pela interface e, com ela, compre E1 na vitrine com o cartão `4000000000000001`. Em "Meus ingressos" o ingresso aparece pendente e, em até 5 segundos (recarregando a página), confirmado. Anote o código como C1.

**6.** Compre E1 pela API com o cartão `4000000000000004`:

```
curl -s -X POST "$API/api/partner/events/$E1/purchases" \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"buyerEmail":"t2@example.com","cardNumber":"4000000000000004"}'
```

A resposta é `202` com `pending`; guarde o `ticketId` em `$T2` e anote o `code` como C2. A listagem passa a mostrar E1 com `availableSeats` 0.

**7.** Antes de completar 60 segundos do passo 6, uma compra de E1 pela API com o cartão `4000000000000001` responde `409` com `sold_out`, e a vitrine exibe `Ingressos esgotados` para o participante do passo 5.

**8.** Passados 75 segundos do passo 6, `$T2` está `declined` e E1 volta a ter `availableSeats` 1:

```
curl -s -H "X-Api-Key: $KEY" "$API/api/partner/tickets/$T2"
```

Compre E1 pela API com o cartão `4000000000000001` (T3). Em até 5 segundos, T3 está `confirmed`.

**9.** Como A, tente reduzir a lotação de E1 para 1: é rejeitado. Mude o preço para R$ 150,00 e a lotação para 3: é aceito. Compre E1 pela API com o cartão `4000000000000001` (T4) e espere a confirmação. O painel de E1 mostra Confirmados 3, Pendentes 0, Check-ins 0, Vagas disponíveis 0, Receita R$ 350,00 e Estornados 0.

**10.** No check-in de E1: C1 resulta em `Entrada liberada`; C1 de novo, em `Ingresso já utilizado`; C2, em `Ingresso não confirmado`; `ZZZZZZZZ`, em `Ingresso inválido para este evento`. O painel passa a mostrar Check-ins 1. Copie o endereço da página de gestão de E1.

**11.** Como organizador B, a lista de eventos da área de organizador não mostra E1, e abrir o endereço copiado não exibe nenhum dado de E1. Ainda como B, crie e publique o evento E2 (lotação 1, R$ 20,00), pegue o `id` dele na listagem da API e compre-o com o cartão `4000000000000001`, anotando o código como C3. Como o participante da seed, e depois deslogado, o endereço copiado também não exibe dados de E1. De volta como A, C3 no check-in de E1 resulta em `Ingresso inválido para este evento`.

**12.** Como A, crie e publique o evento E3 (lotação 5, R$ 50,00), guarde o `id` em `$E3` e compre-o pela API com o cartão `4000000000000003` (`$T5`) e, logo depois, com o cartão `4000000000000001` (`$T6`, código C6). Espere T6 ficar `confirmed` e, antes de completar 60 segundos da compra de T5, cancele E3.

**13.** E3 sai da vitrine e da listagem da API, e uma compra de E3 pela API responde `404` com `event_not_available`. Em até 10 segundos, T6 está `refunded` e T5 está `cancelled`. A página de gestão de E3 não permite editar o evento.

**14.** Passados 75 segundos da compra de T5, T5 continua `cancelled`. No check-in de E3, C6 resulta em `Evento cancelado` (ou a mensagem aparece no lugar do campo). O painel de E3 mostra Confirmados 0, Pendentes 0, Check-ins 0, Receita R$ 0,00 e Estornados 1.

**15.** Como A, crie e publique o evento E4 (lotação 5, R$ 10,00), guarde o `id` em `$E4` e dispare 30 compras simultâneas:

```
seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$API/api/partner/events/$E4/purchases" \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"buyerEmail":"carga{}@example.com","cardNumber":"4000000000000001"}' | sort | uniq -c
```

A saída mostra exatamente 5 respostas `202` e 25 `409`. Em até 10 segundos, o painel de E4 mostra Confirmados 5 e Vagas disponíveis 0. Repita com um evento novo, E5, com o mesmo resultado.

**16.** Nas três rotas da API, sem o cabeçalho e com uma chave errada, a resposta é `401` com `unauthorized`. Uma compra com `"cardNumber":"123"` responde `422` com `invalid_request`, e a consulta de um `ticketId` inexistente responde `404` com `ticket_not_found`.

**17.** Rode o comando de gates: passa. Rode o de derrubar: o produto para de responder, e nenhum container ou processo iniciado pela subida continua rodando. Suba de novo: sobe sem erro, e as credenciais da seed continuam funcionando.

**18.** Pelo mapa do README, confira o PRD, a spec, o plano e o contrato de cada feature, os relatórios, o arquivo de estado, o `AGENTS.md` e os PRs da wave paralela contra os critérios de Especificação, Avaliação e estado e Paralelismo e entrega. Um relatório que nunca foi alterado aparece em um único commit:

```
git log --format="%h %ad" --date=iso -- caminho/do/relatorio.md
```

As regras do brief só valem se valerem quando as features se encontram. Se qualquer verificação dos passos 1 a 17 falhar, a entrega está incompleta, não importa o que digam os relatórios.


## Fora de escopo

- Deploy e qualquer ambiente além do local.
- Gateway de pagamento real, e-mail e notificações.
- App mobile e qualidade visual: nenhum critério avalia design.
- Cadastro de organizador pelo produto.
- Mais de um ingresso por compra, mapa de assentos, cancelamento ou transferência de ingresso pelo participante.
- Atualização em tempo real: recarregar a página para ver o status novo basta.
- Fuso horário: datas no horário local da máquina.

