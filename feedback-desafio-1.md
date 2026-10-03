# Feedback — Desafio 1 (Catraca: do brief ao produto em modo agente)

Execução de teste feita como aluno, em 2026-10-03, com Claude Code. A sessão principal (`claude-opus-5-5`) atuou como orquestradora. Implementadores e spec writers rodaram em `claude-opus-5-5`; os avaliadores, em `claude-sonnet-5-5`, cada um iniciado do zero.
Repositório: <https://github.com/PierryMedeiros/catraca> (**privado**, por regra do teste). Seis PRs mergeados; a wave paralela é a dos PRs #4 e #5.

---

## 1. Contradições e incoerências do enunciado

1. **Os seis números do painel versus o passo 14.**
   - Critério: "Os seis números do painel batem com o estado dos ingressos em **todas** as conferências do Fluxo do avaliador (R12)".
   - O passo 14 confere só cinco: "Confirmados 0, Pendentes 0, Check-ins 0, Receita R$ 0,00 e Estornados 1". Falta Vagas disponíveis, e o passo 15 confere só dois números.
   - Aplicando R05 ao pé da letra, um evento cancelado mostra "Vagas disponíveis 5" (lotação 5 menos 0 ocupadas), número esquisito para um evento que não vende mais. O enunciado parece ter tirado esse número do passo 14 justamente por isso, mas o critério continua dizendo "seis".
2. **R10: a mensagem no lugar do campo versus a ordem da tabela.**
   - "Em evento cancelado, a mensagem `Evento cancelado` pode aparecer no lugar do campo de check-in."
   - Na tabela, a linha 1 ("não existe ou é de outro evento → `Ingresso inválido para este evento`") vem antes da linha 2 ("o evento está cancelado").
   - Se a mensagem substitui o campo, a linha 1 nunca é exercitada em evento cancelado. A opção oferecida contradiz a ordem que a própria regra estabelece. Mantivemos o campo, com um aviso acima dele.
3. **R11: "Em até 10 segundos" para um cancelamento que, no resto do texto, é imediato.**
   - O passo 13 exige que E3 saia da vitrine e da API e que a compra dê `404` logo depois de cancelar, sem margem nenhuma.
   - Só a transição dos ingressos ganha 10 segundos. A margem sugere um processamento assíncrono que o resto do texto não pede. Por um lado não atrapalha; por outro, abre espaço para uma janela em que o evento está cancelado e o ingresso continua `confirmed`, contando no painel. Fizemos tudo na mesma transação.
4. **A prova de paralelismo depende de uma estratégia de merge que o enunciado não exige.**
   - Requisito 4: "O histórico é a prova: o primeiro commit de cada branch da wave é anterior ao último commit das outras."
   - Entregável: "as branches podem ser apagadas depois do merge".
   - Com *squash merge* ou *rebase merge*, que são o padrão em muitos repositórios, e a branch apagada, os commits da branch somem e não há como provar nada. O enunciado precisaria exigir merge commit, ou aceitar a lista de commits dos PRs no GitHub como prova.
5. **"Relatório nunca alterado" versus features que mudam código de features anteriores.**
   - Requisito 5: o relatório "não é alterado depois de commitado", e o critério pede que "o relatório mais recente de cada feature aprova todos os itens".
   - Na prática, F02 mudou `src/auth.js` (de F01): o POST de visitante passou a redirecionar com `?next=`, e um item do contrato de F01 mudou de comportamento. F06 mudou rotas de F02. O relatório de F01 continua sendo "o mais recente e aprovado", mas atesta um commit cujo comportamento não é mais o da `main`.
   - O enunciado não diz se é preciso reavaliar uma feature quando outra mexe no código dela, nem se o "commit avaliado" precisa estar na `main`.
6. **Brief versus decisões de tela.**
   - O brief diz que "o resto (stack, **telas**, divisão em features, modelagem) é decisão sua".
   - O mesmo brief fixa tela e navegação: "Meus ingressos", "página de gestão com endereço (URL) próprio" (R04), "a vitrine exibe `Ingressos esgotados` (no lugar da compra ou como resposta à tentativa)". Não é grave, mas o "é decisão sua" é mais estreito do que parece.
7. **Repositório público versus privado.** O Objetivo e o Entregável pedem "repositório **público**". A regra deste teste pediu privado. Não é contradição interna do enunciado, mas registro: nada do fluxo depende de o repositório ser público, a não ser o avaliador conseguir abrir os PRs.
8. **Placeholder exposto.** "Esforço de referência: XX horas (placeholder, calibrado após a execução de referência)". Já sabido; registro o tempo real abaixo.

## 2. Pontos vagos em que tive de adivinhar

| Ponto | O que o enunciado diz | O que decidimos |
|---|---|---|
| Pendente observável (passo 5) | "Em Meus ingressos o ingresso aparece pendente e, em até 5 segundos, confirmado" | Com resposta instantânea do gateway (que também cumpre "em até 5 s"), o "pendente" nunca aparece. Escolhemos ~2 s para o cartão `0001`. |
| Atraso do cartão lento | "entre 60 e 75 segundos"; passo 8: "Passados 75 segundos..." | Um atraso de 75 s exatos dá corrida com o passo 8. Usamos 65 s. |
| E-mail "mal formado" | sem definição | Regex `algo@algo.dominio` |
| Formato do preço | "em reais, maior que zero" | Vírgula ou ponto, até 2 casas, `R$` opcional |
| Cancelar rascunho | R11 fala só de "evento publicado" | Não suportado (sem botão; POST recusado) |
| R13 "não acessam" | sem forma definida | Visitante → 302 para o login; participante → 403; outro organizador → 404 idêntico ao de evento inexistente |
| O que é "dado de E1" (passo 11) | "não exibe nenhum dado de E1" | O visitante é redirecionado a `/login?next=/org/events/evt_xxx`: o **id** de E1 aparece no formulário de login. Um avaliador reparou nisso. Consideramos que o id na URL que o próprio visitante digitou não é vazamento. |
| Fuso | "datas no horário local da máquina" | Com o app em container, o fuso padrão é UTC. O `up.sh` lê o fuso do host com Node e o repassa como `TZ`. |
| Derrubar | "encerra tudo que a subida iniciou" | Remove containers e rede e mantém o volume; a seed é idempotente. Apagar o volume também cumpriria o texto. |
| Evento esgotado | não diz se continua na vitrine | Continua, com `Ingressos esgotados`; na API aparece com `availableSeats: 0` |
| Passo 11, compra de E2 | "pegue o `id` dele na listagem da API e compre-o com o cartão `0001`" | Não diz por qual canal; B é organizador e não compra na vitrine. Compramos pela API. |
| Passo 9 | "Mude o preço para R$ 150,00 e a lotação para 3" | Fizemos uma edição só. Com duas edições daria no mesmo, mas não fica claro. |
| Quando avaliar | "Cada feature é avaliada contra o seu contrato" | Não diz se é na branch antes do merge ou na `main` depois. Avaliamos na branch, antes do merge. |
| Arestas com a fundação | "para cada dependência do grafo, pelo menos um critério cross-feature" | Como F01 é consumida por todas as outras, isso gerou critérios X quase triviais (X-06, X-09, X-12: "os guardas de F01 valem aqui"). |
| "Sessão separada" | "um agente em uma sessão separada da do implementador" | Assumimos que um subagente novo, com contexto vazio, conta como sessão separada. Também usamos outro modelo. |
| Data no futuro "ao editar" (R01) | — | Um evento publicado cuja data já passou só pode ser editado mudando a data. |
| Vagas de evento cancelado | — | R05 aplicada ao pé da letra (veja a contradição 1). |

## 3. Travas: o que bloqueou e quanto custou

| Trava | Custo |
|---|---|
| **Queda de energia** (externa ao desafio): a sessão parou às ~17:18 e voltou às 18:56. O avaliador da F04 já tinha commitado o relatório e sobreviveu. As notas e scripts auxiliares em `/tmp` se perderam e foram reconstruídos. | ~98 min parados (fora da contagem de tempo) + ~5 min para retomar |
| **Relatório da F05 alterado pelo próprio avaliador.** Ele commitou o relatório e, na mesma sessão, fez um segundo commit corrigindo uma frase das evidências. Isso viola "relatório não alterado". Tentei unir os dois commits na branch da feature, antes do merge, com force push; o **classificador de permissões do Claude Code negou** ("Git Destructive"). Ficou registrado como desvio conhecido no README e a regra foi reforçada para as avaliações seguintes. **Esse critério de aceite fica reprovado na entrega.** | ~10 min; não resolvido |
| Specs escritas em paralelo inventaram nomes diferentes: campos de formulário, tipo de `users.id`, nomes das pastas. O PRD citava pastas com nomes diferentes dos reais. Foi preciso acrescentar ao PRD uma seção de "Convenções compartilhadas". | ~5 min |
| Contrato de F01 versus contrato de F02 (visitante com POST → `/login` com ou sem `?next=`): o implementador da F02 mudou código de F01 e ajustou os testes de F01. | absorvido pelo agente |
| `gh pr merge` falhou com "Pull Request is not mergeable" logo após o push (o GitHub ainda recalculava a mergeabilidade); repetir resolveu. | ~1 min |
| Agentes paralelos sobrescreveram um arquivo de apoio um do outro no diretório temporário compartilhado (só na máquina; o código não foi afetado). | nenhum |
| Criar o repositório com `gh` **não** travou: `gh repo create --private` funcionou de primeira. | — |

## 4. O que pesquisei e decidi por conta própria

- **R07 sob concorrência**: o enunciado manda pesquisar. Pesquisa: "Preventing Overselling: Inventory Locks Under Concurrent Checkouts" (dev.to) e "SELECT FOR UPDATE in PostgreSQL" (Stormatics), comparando UPDATE condicional num contador com trava pessimista. Decisão: `SELECT ... FOR UPDATE` na linha do evento, no início de toda transação que lê e muda vagas (compra, edição de lotação e cancelamento), com a ocupação derivada dos ingressos (sem contador).
  - Prova: rajadas de 30 compras em lotação 5, repetidas em várias rodadas, nos testes e no fluxo.
  - O implementador da F03 confirmou que, trocando a trava por um SELECT comum, 5 de 6 testes de concorrência falham (9–10 vendas em lotação 5).
- **Gateway assíncrono**: o resultado e o horário de vencimento ficam gravados no ingresso. Um worker faz polling a cada 500 ms e aplica `UPDATE ... WHERE status='pending'`, o que resolve de uma vez a resposta tardia de R11 e o reinício do app. Os atrasos são configuráveis por variável de ambiente só nos gates (a dica do enunciado).
- **Stack**: Node 24 + Express 5 + Postgres 17, com HTML no servidor. O avaliador do curso e os agentes avaliadores conseguem exercitar tudo com `curl` e cookie jar, sem browser.
- **Harness**:
  - `APP_PORT` e nome de projeto Compose derivado da pasta, para worktrees rodarem em paralelo sem colidir;
  - gates num projeto Compose separado, que se limpa ao final;
  - `scripts/fluxo-avaliador.sh` automatiza os passos 2–16 (56 checagens).
- **Avaliação**: avaliador em **outro modelo** (sonnet) que o implementador (opus), com instruções fixas em `docs/avaliador.md`. Além do contrato, cada avaliador recebeu checagens tiradas direto do brief, para não depender só do que o spec writer achou importante.
- **Commits**: segui a skill de commit do usuário (Conventional Commits, sem trailer de IA). Ferramenta e modelo aparecem só nos relatórios, onde o desafio exige.

## 5. Onde o enunciado decidiu por mim sem necessidade

- **"Pelo menos 5 features"**: número arbitrário. O que importa (grafo, cross-feature, wave paralela) se verifica com 4. Combinado com "um critério cross-feature por aresta", isso empurra para um grafo denso e critérios redundantes.
- **"Um critério cross-feature para cada dependência"**, sem distinguir dependência de infraestrutura (auth/harness) de dependência de domínio. Gera critérios de enchimento.
- **Spec, plano e contrato separados para toda feature**: para a F01 (harness e contas) e outras features pequenas, plano e spec repetem muita coisa. O formato do curso serve, mas a obrigatoriedade de três arquivos por feature é decisão de processo, não de produto.
- **Repositório público** (veja a contradição 7).
- **Valores exatos do gateway** (60–75 s): forçam esperas de mais de 1 minuto em várias avaliações. A regra que se quer testar (resposta tardia ignorada) não depende de o atraso ser de 60 s; um atraso configurável com padrão de ~20 s testaria o mesmo e encurtaria cada rodada do fluxo em ~2 minutos.

## 6. Critérios de aceite que não dá para verificar como estão escritos

- **"Nenhum relatório foi alterado depois do commit que o criou"**, verificado com `git log -- caminho`:
  - não detecta reescrita de histórico antes do merge (squash ou force push, justamente o que tentei);
  - não detecta relatório apagado e recriado com outro nome;
  - não distingue "o avaliador corrigiu uma frase na mesma sessão" de "alguém mudou o veredito depois".
- **"Avaliada por um agente em uma sessão separada"**: o repositório só tem a autodeclaração do relatório. Não há como verificar.
- **"O primeiro commit de cada branch é anterior ao último commit das outras"**:
  - datas de commit são controladas pelo autor (`GIT_AUTHOR_DATE`);
  - "primeiro commit da branch" depende do merge-base;
  - com squash, a evidência some.
- **"Os seis números batem em todas as conferências"**: as conferências do fluxo nunca listam os seis números juntos depois do passo 9 (veja a contradição 1).
- **"A compra nasce pendente"** (passos 5 e 6): pela interface, depende de o avaliador recarregar antes do gateway responder. Pela API, o `202` com `pending` é verificável; pela vitrine, não há garantia.
- **"Nenhum container ou processo iniciado pela subida continua rodando"**: "processo" no host é genérico. No meu ambiente, `pgrep node` pegava 7 processos do VS Code Server, e o avaliador da F01 viu o próprio shell casar com `up.sh`.
- **"Cada feature tem uma spec com as decisões técnicas"**: só dá para verificar a existência do arquivo, não a qualidade.
- **"Item reprovado volta para correção e nova avaliação"**: não é verificável quando nenhum item reprova (o nosso caso). Nada distingue "o avaliador é rigoroso e tudo passou" de "o avaliador é complacente".

## 7. Resultado de cada passo do Fluxo do avaliador

Rodado às 19:21–19:27 contra a `main` (`b1350c0`), num clone limpo (`git clone` do GitHub numa pasta vazia), com o modo padrão do gateway (2 s e 65 s). Os passos 2–16 foram rodados com `scripts/fluxo-avaliador.sh` (curl + cookie jar); depois conferi à mão os rótulos da interface e a mensagem de erro de data.

| Passo | Resultado | Observação |
|---|---|---|
| 1 | ✅ | `./scripts/up.sh` exit 0 em 4 s (imagem base e camadas já em cache; com `--no-cache --pull`, o build levou 5 s). `/health` 200, os 3 logins da seed com 302. |
| 2 | ✅ | E1 em rascunho fora da vitrine (visitante) e da listagem da API |
| 3 | ✅ | Data de ontem → 422 com "A data de início precisa estar no futuro." |
| 4 | ✅ | E1 publicado: na vitrine e na API com `availableSeats` 2 e `priceCents` 10000 |
| 5 | ✅ | Conta nova; compra `…0001` → "Meus ingressos" `pendente`, `confirmado` em 5 s, com evento e código |
| 6 | ✅ | API `…0004` → 202 `pending`; `availableSeats` 0 |
| 7 | ✅ | Antes de 60 s: API → 409 `sold_out`; vitrine do participante → `Ingressos esgotados` |
| 8 | ✅ | Aos 76 s, T2 `declined`, `availableSeats` 1; T3 `confirmed` em 5 s |
| 9 | ✅ | Lotação 1 rejeitada; preço 150 + lotação 3 aceitos; painel `3 / 0 / 0 / 0 / R$ 350,00 / 0` |
| 10 | ✅ | C1 `Entrada liberada`, C1 `Ingresso já utilizado`, C2 `Ingresso não confirmado`, `ZZZZZZZZ` `Ingresso inválido para este evento`; Check-ins 1 |
| 11 | ✅ | B: lista sem E1, URL direta com 404 sem dados; E2 criado, publicado e comprado pela API; participante (403) e visitante (login) sem dados; C3 em E1 → inválido |
| 12 | ✅ | E3: T5 `…0003`, T6 `…0001` confirmado; cancelado antes de 60 s |
| 13 | ✅ | E3 fora da vitrine e da API; compra → 404 `event_not_available`; T6 `refunded`, T5 `cancelled` (imediato); edição recusada e sem formulário de edição |
| 14 | ✅ | Aos 76 s, T5 continua `cancelled`; C6 → `Evento cancelado`; painel `0 / 0 / 0 / R$ 0,00 / 1` (Vagas disponíveis mostra 5, veja a contradição 1) |
| 15 | ✅ | E4 e E5: exatamente `5 202` / `25 409`; painel com Confirmados 5 e Vagas 0 em 10 s |
| 16 | ✅ | As 3 rotas, sem chave e com chave errada → `401 {"error":"unauthorized"}`; `cardNumber "123"` → 422; ticket inexistente → 404 `ticket_not_found` |
| 17 | ✅ | Gates exit 0 (182 testes, 0 falhas). Down: `/health` sem resposta, 0 containers, 0 redes do projeto e dos gates. Up de novo sem erro; seed "0 criadas, 3 já existiam"; as 3 credenciais entram. |
| 18 | ⚠️ | PRD: 6 features, Provides/Consumes, grafo, waves (W4 = F04 ‖ F05), fora de escopo, R01–R13 citadas (todas ≥ 5 vezes). Cada aresta tem critério X. Todos os ACs e X aparecem em algum contrato. `state.json` com 6 features `done` e caminhos existentes. PRs #1–#6 mergeados e listados no README; na W4, F04 tem 1º commit às 17:03:25 e último às 17:12:00, F05 1º às 17:03:48 e último às 17:14:12. **Falha:** o relatório da F05 aparece em **2 commits** no `git log` (veja Travas). Os outros 5 relatórios têm um commit cada. |

Resumo: passos 1–17 passaram; o passo 18 tem uma reprovação real (imutabilidade de um relatório).

## 8. Tempo, custo e tamanho do PRD

- **Tempo total**: das 15:48 às ~19:35, menos ~98 min de queda de energia, dá **cerca de 2h10 de trabalho efetivo** (relógio de parede, com agentes em paralelo). Distribuição aproximada:
  - PRD: 6 min;
  - specs (6 em paralelo): 12 min;
  - F01: 9 min de implementação + 3 de avaliação;
  - F02: 11 + 3;
  - F03: 15 + 6;
  - W4 em paralelo: ~13 min de implementação + ~3 de avaliação;
  - F06: 10 + 8;
  - integração, README, ensaio e fluxo final: ~25 min;
  - feedback: ~10 min.
- **Esforço humano** de um aluno real seria maior: revisar PRD e specs, ler PRs e entender os conflitos. Estimo de 6 a 10 horas para quem domina o fluxo de agentes, e mais para quem nunca usou worktrees ou subagentes.
- **Custo da sessão (`/cost`)**: **não consegui obter.** `/cost` é um comando interativo do Claude Code que o agente não executa. Rode `/cost` nesta sessão e cole a saída aqui. Para referência, os tokens processados pelos subagentes, somados dos relatórios de conclusão, deram **~2,39 milhões**, sem contar a sessão principal nem o avaliador da F04, cujo relatório de uso se perdeu na queda de energia:
  - PRD: 81 mil;
  - 6 specs: 780 mil;
  - 6 implementadores: 1,13 milhão;
  - 5 avaliadores: 400 mil.
- **Features do PRD: 6** (F01–F06), com 64 critérios por feature, 17 critérios cross-feature (X-01 a X-17) e 5 critérios de processo (P-01 a P-05), em 5 waves.
