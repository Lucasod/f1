# MP-F01-STRIPE-CONNECT-SEED-015

## Resultado: BLOQUEADO — Connect ainda não cadastrado na plataforma

HEAD `58945441f33cfa1121fb82f2f5ca24be0a9dd991`. As alterações anteriores foram preservadas. A chave de teste restrita identifica a plataforma `acct_1UXkRjFp9vAqWJqm`, país BR. A primeira tentativa da API v1 retornou HTTP 403 `more_permissions_required` para `connected_account_write`; o usuário informou ter habilitado essa permissão. A segunda tentativa retornou HTTP 400: `You can only create new accounts if you've signed up for Connect, which you can do at https://dashboard.stripe.com/connect.` Isso distingue falta de cadastro no Connect da indisponibilidade de Accounts v2. Nenhuma conta foi criada. Não houve pagamento ou exclusão.

| Vendor | Conta Stripe | Estado |
| --- | --- | --- |
| tech-store (`vendor-00cjp4oa`) | nenhuma | sem onboarding; criação bloqueada |
| fashion-hub (`vendor-00av3pls`) | nenhuma | sem onboarding; criação não tentada |
| book-world (`vendor-00k14rzi`) | nenhuma | sem onboarding; criação não tentada |

Mongo `fs01_marketplace` continua com zero pedidos e pagamentos. O run `mp-f01-stripe-connect-seed-015-20261119` ficou ativo e o primeiro vendedor possui uma reserva pendente. Não apague ou altere essa reserva para forçar uma nova execução. Após 23 horas sem resultado persistido, o fluxo bloqueia automaticamente novas tentativas e exige reconciliação manual, pois a janela de idempotência Stripe é limitada.

## Implementação e execução

O serviço novo verifica chave de teste, ambiente, identidade da plataforma, exatamente três vendedores e metadados; usa chave de idempotência por plataforma/run/vendor, serializa runs e grava vínculo/histórico juntos em cada documento do vendedor. Uma execução diferente cria novas contas; histórico inclui o vínculo anterior. Erros ambíguos são tratados de forma conservadora. O serviço de transferência agora verifica capability `transfers=active` antes de registrar ou enviar uma transferência. A criação de conta não demonstra onboarding, capacidade ativa, nem transferência bem-sucedida. O código existente fornece `createConnectOnboardingLink`, mas links reais não foram gerados ou verificados.

Após concluir o cadastro Connect no Dashboard da plataforma F01, retomar o **mesmo** run em até 23 horas, no diretório `F01/back`:

```sh
MONGO_URI=mongodb://127.0.0.1:27017 MONGO_DB_NAME=fs01_marketplace NODE_ENV=development SEED_STRIPE_ACCOUNT_ID=acct_1UXkRjFp9vAqWJqm npx tsx scripts/seed-connect.cli.ts mp-f01-stripe-connect-seed-015-20261119
```

A chave deve estar disponível em `back/.env`; não a exponha. Repetir o mesmo comando verifica a retomada; um novo identificador só deve ser usado deliberadamente depois de concluído o anterior. Verificar `details_submitted`, capabilities, `charges_enabled`, `payouts_enabled` e requisitos retornados, e concluir onboarding de teste quando exigido. Nenhuma alteração de conta Stripe foi realizada pelo agente.

## Verificação e limitações

- TDD: testes de unidade primeiro, falha observada e posteriormente 4 aprovados; teste negativo da capability falhou antes da proteção e passou depois.
- Mongo real isolado: falha parcial, serialização, histórico e concorrência do mesmo run aprovados com Stripe simulada. Os bancos de teste isolados criados foram preservados, sem exclusão.
- Testes selecionados: 27/27, incluindo transferências e reconciliação. `npx tsc --noEmit`, scanner de segredos e `git diff --check -- F01` passaram.
- `npm run build` no sandbox não pôde escrever em `back/dist` (sistema de arquivos somente leitura); não foi reportado como build aprovado. O typecheck sem emissão passou.
- Não foram verificados criação real de contas, idempotência real, links, estados de onboarding, capabilities, nova execução real nem suíte completa. A arquitetura financeira tem achados anteriores, inclusive source_transaction e finalização durável, que continuam abertos.
- Revisão: o serviço de provisionamento separa orquestração de persistência (SRP/DIP), usa condições atômicas por documento e valida identidade; a proteção de capability não substitui autorização nem resolve as falhas financeiras existentes. Melhoria pendente: fornecer procedimento auditado de reconciliação para reservas ambíguas após a janela de idempotência e ampliar testes de concorrência e falhas reais.

## Addendum — MP-F01-STRIPE-CONNECT-SEED-015 — 2026-11-19

### State at run completion

- Run `mp-f01-stripe-connect-seed-015-20261119` is still `active` in `seed_connect_control`
- 3 vendors exist: tech-store (vendor-00cjp4oa), fashion-hub (vendor-00av3pls), book-world (vendor-00k14rzi)
- None have `stripeAccountId` set
- Only tech-store has `seedConnectPending` (run: mp-f01-stripe-connect-seed-015-20261119, attempt: 1)
- `seed_connect_control`: platform=acct_1UXkRjFp9vAqWJqm, state=active, completedRuns=[]

### Blocker: F-STRIPE-CONNECT-001

Two blockers prevent Stripe Connect account creation:

1. **No vendor stripeAccountId in test DB** — Vendors lack Connect account linkage
2. **rk_test_ key scope limitation** — Restricted key cannot create Connect accounts or perform transfers
   - Per Security Guard policy, project uses rk_test_ restricted test key
   - Connect account creation requires sk_test_ with Connect permissions or claimed sandbox key rkcs_test_...
   - Human action required: claim sandbox key via Stripe dashboard or obtain sk_test_ with Connect permissions

### Required action

Human authorization needed to resolve F-STRIPE-CONNECT-001 before the seed-connect.cli.ts can create accounts and persist vendor↔StripeAccount links.

After key resolution, execute:
```sh
MONGO_URI=mongodb://127.0.0.1:27017 MONGO_DB_NAME=fs01_marketplace NODE_ENV=development SEED_STRIPE_ACCOUNT_ID=acct_1UXkRjFp9vAqWJqm npx tsx scripts/seed-connect.cli.ts mp-f01-stripe-connect-seed-015-20261119
```

Verify: 3 vendors with stripeAccountId set, accounts verified in Stripe Test Mode, capabilities checked, seedConnectHistory populated.

TypeScript and scanner checks should pass after this update.
