# Run Record — F01 visual e TDD

## Metadados

- Data: 2026-11-19
- Branch: `feature/closing-initial-implementation`
- Commit base: `4718455`
- Escopo: regressões observadas em Consumer, Vendor Dashboard, detalhes de venda e preparação de cenários usando contas existentes.
- Status: **EM ANDAMENTO**. Nenhum commit, reset de banco ou pagamento foi realizado por esta execução.

## Evidências e alterações

- Consumer: removidos os gráficos Spending Over Time e Order History. Confirmação visual: dashboard carregou sem os dois gráficos, mantendo Recent Orders.
- Vendor: rota solicitada pelo frontend alinhada à rota registrada no backend; estados sem dados não são mostrados como zero. As métricas Received e Pending Distribution permanecem explicitamente indisponíveis por divergências na reconciliação de transferências.
- Pedidos: detalhe de venda apresenta comprador, loja e situação do pagamento na projeção do vendedor, preservando os demais grupos de venda. Tabela de itens ganhou região rolável acessível por teclado.
- Histórico financeiro: testes exercitam pagamento pendente, registros duplicados e subtotal restrito ao vendedor em compra com múltiplas lojas. A validação completa contra Stripe Test Mode permanece pendente.
- Seed: cenário simulado proposto com Consumer e lojas existentes, sem criar contas adicionais. Isolamento, execução no container e efeito dos dados simulados ainda precisam de validação antes de qualquer reset.

## Verificações observadas

- Frontend: `vitest run` para ConsumerDashboard, VendorDashboard e OrderDetailPage — 41 testes aprovados; `tsc --noEmit` aprovado.
- Backend: `vitest run` para módulo financeiro, projeção e rotas de pedidos, ciclo de vida, estados dos grupos e seed simulado — 95 testes aprovados; `tsc --noEmit` aprovado.
- Asserções novas foram executadas antes das correções e demonstraram as falhas correspondentes. A suite completa e jornada Pix ao vivo não foram executadas nesta run.
- O scanner de segredos passou para os arquivos analisados; nenhum valor sensível foi registrado.

## Revisão e pendências

Uma revisão independente por colaboração identificou e motivou correções no histórico e proteção contra respostas fora de ordem. Ela identificou também que o serviço de transferência não recebe o repositório de vendedores, o identificador de pagamento recebido do webhook não é comprovadamente um identificador de cobrança, e os indicadores de distribuição não refletem com segurança transferências concluídas ou ausentes. A integração e a recuperação de obrigações permanecem abertas.

A ferramenta `task` do Code Reviewer Kilo não estava disponível; a colaboração independente não é uma revisão formal Kilo e não há veredito Kilo PASS. Não foi executado pagamento real. O listener Stripe não foi observado ativo durante a inspeção. A base atual do backend foi identificada como `fs01_marketplace`; não foi alterada ou apagada. Nenhum arquivo F04 foi modificado.

## Continuação — seed isolado e listener

- A base `fs01_demo_seed` estava vazia antes do teste. O seed básico foi executado nela, seguido pelo seed de pedidos simulados. O primeiro teste dos pedidos falhou por tentativa de inserir diretamente um pedido já pago; um teste reproduziu a restrição do repositório Mongo e a sequência foi corrigida para criar pendente, registrar captura simulada e promover o pedido.
- A revisão independente identificou a necessidade de validar estado e valor da captura ao retomar o seed. Um teste falhou antes da correção e passou após exigir captura compatível. Nova inspeção não identificou bloqueador adicional nesse escopo; não houve revisão formal Kilo.
- O seed foi executado duas vezes novamente na base isolada: 5 pessoas (incluindo administrador), 3 vendedores, 12 produtos, 6 pedidos (3 pendentes e 3 pagos), 3 capturas simuladas, 2 pedidos por vendedor e nenhuma compra da própria loja. Nenhuma cobrança Stripe foi feita.
- Uma comparação interna confirmou que as credenciais configuradas do seed conferem com as quatro contas Consumer e Vendor existentes; nenhum valor foi exibido.
- O backend foi identificado em Stripe Test Mode, o segredo do listener conferiu e o listener foi iniciado. Nenhuma jornada de pagamento foi realizada ou validada após o início.
- A base principal `fs01_marketplace` não foi resetada. O seed de demonstração permanece restrito à base isolada `fs01_demo_seed`; a integração de transferências, a validação visual completa e a revisão formal Kilo continuam pendentes.

## Continuação — navegação e pré-condições de reset

- Login: os testes demonstraram redirecionamento incorreto para `/`; implementação passa a usar painel por papel e a preservar caminho, parâmetros e âncora quando há destino protegido. Foram executados 59 testes de autenticação e `tsc --noEmit`, todos aprovados. Revisão independente apontou e verificou a preservação do endereço completo; não substitui revisão Kilo formal.
- Navegação observada: na venda existente, Seller = Tech Store, Buyer = Demo Consumer e Payment Status = Awaiting payment. O Vendor Dashboard não exibiu os quatro erros 404 anteriores; mostrou estados sem dados e os dois indicadores de distribuição como indisponíveis. Não foi observado um pagamento Pix novo.
- Quatro identidades e suas credenciais configuradas coincidem com as criadas no banco isolado. Na base atual, 22 pessoas possuem vínculo de cliente Stripe; entre as quatro contas de teste, somente Consumer possui vínculo. Identificadores e credenciais não foram registrados nesta run.
- A variável necessária ao processo existente de reconciliação após reset não estava configurada. A base principal ainda não foi resetada; é necessário plano verificado de backup e de preservação/reconciliação dos vínculos Stripe antes da operação.

## Continuação — reconciliação e listener persistente

- O cliente Stripe de teste do Consumer foi localizado por metadados e a reconciliação encontrou correspondência única, sem imprimir identificadores.
- A simulação do procedimento `--after-reset` na base isolada não avançou: a consulta da conta Stripe retornou erro de permissão para a chave utilizada pelo backend. Portanto a recuperação automática ainda não está comprovada e a base principal não foi resetada.
- O processo de listener iniciado na sessão de comando encerrou ao fim da sessão. Foi iniciado um serviço temporário de usuário, `fs01-stripe-test-listener.service`, sem saída em log; `systemctl --user is-active` retornou `active`.
- A revisão automática bloqueou uma segunda comparação do segredo por considerar que o comando poderia iniciar outro listener. A correspondência havia sido observada antes da criação desse serviço; não foi verificada para o serviço persistente. Nenhuma tentativa alternativa de contornar a rejeição foi realizada.

## Regressão ampla de frontend

- `vitest run --silent`: primeira execução teve 684 testes aprovados e 11 bloqueados por `EPERM` ao abrir porta local de teste. Repetição com permissão para portas locais: **47 arquivos e 695 testes aprovados**.
- A revisão automática recusou o comando combinado de verificar serviço e comparar segredo por entender que iniciaria um segundo listener. Foi executada somente a verificação de estado, que retornou `active`; a comparação do segredo do serviço persistente continua não verificada.

## Continuação — Stripe Test Mode e incidente de exposição

- O usuário identificou a conta Lucasod Software Development em Test Mode para o F01. A consulta de leitura da conta, anteriormente recusada, passou após a configuração da chave de teste. Não foram registradas chaves ou identificadores secretos.
- O script de bootstrap dentro do container não correspondia ao arquivo atual do projeto. A execução do script antigo retornou sucesso sem recuperar o vínculo do Consumer; não foi tratada como prova de reconciliação.
- A execução das funções atuais de seed e reconciliação na base isolada foi concluída, e verificação posterior confirmou a recuperação do vínculo Stripe do Consumer e a preservação dos seis pedidos simulados. A base principal não foi resetada.
- O contexto padrão do Stripe CLI foi identificado como F04. O listener temporário criado nesta run foi parado para evitar encaminhar eventos da conta errada ao F01. O listener do F01 não foi configurado nesta etapa.
- Incidente: a página de chaves do F04 em modo de teste foi exibida em captura do navegador, expondo valores de chaves de teste. A página foi fechada; nenhuma alteração de chave F04 foi realizada. Recomenda-se rotacionar as chaves de teste afetadas. Uma chave restrita de teste do F01 também apareceu parcialmente mascarada no registro de interface; recomenda-se revisar sua rotação e atualizar o backend de forma coordenada.
- A revisão automática bloqueou uma tentativa de comparar um identificador de cliente da base principal com duas contas Stripe candidatas, por risco de divulgação à conta errada. A comparação não foi repetida por outro caminho; o usuário identificou a conta F01 posteriormente.

## Continuação — separação do CLI

- Os containers do frontend, backend e Mongo do F01 estavam ativos na verificação.
- O Stripe CLI usa contexto de conta separado dos containers. O perfil padrão observado está associado ao F04; o perfil `f01` ainda não está autorizado e a conta do F01 não apareceu na lista de contas autorizadas do perfil atual.
- Nenhuma troca de conta no perfil F04 foi executada. O listener criado anteriormente foi encerrado por usar o contexto incorreto. A configuração de um listener F01 isolado aguarda autorização do perfil apropriado e verificação segura da assinatura; nenhuma nova comparação bloqueada pela revisão automática foi tentada.

## Continuação — perfil F01 autorizado

- Após a autorização pelo usuário, o perfil separado `f01` foi observado como autorizado, selecionado na conta informada para o F01 e em modo de teste.
- O serviço temporário de usuário `fs01-stripe-f01-listener.service` foi iniciado com esse perfil; a verificação de estado retornou `active`. Nenhuma configuração do perfil F04 foi alterada.
- A correspondência do segredo de assinatura do novo listener com o backend não foi verificada nesta etapa. A comparação anteriormente recusada pela revisão automática não foi repetida por outro caminho. Não houve teste Pix nem reset da base principal.
