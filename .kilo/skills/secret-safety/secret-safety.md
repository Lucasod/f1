# Skill: Secret Safety

**Arquivo**: `.kilo/skills/secret-safety/secret-safety.md`
**Finalidade**: Guia de segurança de segredos para todos os agentes (Developer, Reviewer, Orchestrator). Este arquivo é auto-contido e reutilizável nas três agentes do projeto.

---

## 1. Identificação de dados sensíveis

Distinguir entre informações necessárias (nome de variável, existência de config, tipo esperado de credencial, presença de arquivo, validação estrutural, permissões) e informações que **NUNCA** devem ser lidas (valores reais de `AWS_SECRET_ACCESS_KEY`, `STRIPE_SECRET_KEY`, tokens JWT reais, senhas de usuários, chaves privadas, credenciais de BD, tokens de sessão, cookies de autenticação).

| Tipo | O que NÃO ler (exemplos fictícios) | O que é seguro ler |
|------|-----------------------------------|-------------------|
| AWS credentials | `AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` | `AWS_SECRET_ACCESS_KEY` existe/configurada? |
| Stripe keys | `sk_test_1234567890abcdef` | `STRIPE_SECRET_KEY` configurada? |
| JWT tokens | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` | Estrutura JWT (header/payload/assinatura) validada semanticamente? |
| Senhas de usuário | `password: "minhasenha123"` | `password` campo existe no schema? |
| Chaves privadas | `-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----` | Formato PEM válido? (sem ler conteúdo) |
| Credenciais BD | `postgres://user:pass@host:5432/db` | Driver/string de conexão configurada? |
| Tokens de sessão | `session_token=abc123def456ghi789jklmno` | Nome do cookie de sessão configurado? |
| Cookies de autenticação | `Authorization: Bearer eyJh...` | Cabeçalho `Authorization` presente? |

**Princípio**: Quando em dúvida, trate como secreto e **não leia o valor**. Verifique apenas a estrutura e a existência.

---

## 2. Leitura segura de configurações

Como verificar configurações **sem** expor valores. Use apenas indicadores de status: `CONFIGURED`, `MISSING`, `INVALID`.

### Padrões seguros

```bash
# ❌ UNSAFE - never do this
cat .env                                    # expõe todos os valores
printenv STRIPE_SECRET_KEY                   # imprime o valor real
echo $STRIPE_SECRET_KEY                      # expõe o valor

# ✅ SAFE - apenas verificação estrutural
if [ -z "${STRIPE_SECRET_KEY:-}" ]; then
  echo "MISSING: STRIPE_SECRET_KEY not set"
fi

if [ -n "${STRIPE_SECRET_KEY:-}" ] && [[ "${STRIPE_SECRET_KEY}" =~ ^sk_live_[A-Za-z0-9]{24}$ ]]; then
  echo "CONFIGURED: STRIPE_SECRET_KEY appears valid"
fi

# ✅ SAFE - verificação de existência apenas
if [ ! -f ".env" ]; then
  echo "MISSING: .env file not found"
fi

# ✅ SAFE - validação de padrão (regex) sem capturar valor
if printf '%s\n' "$STRIPE_SECRET_KEY" | grep -qE '^sk_(test|live)_[A-Za-z0-9]{16,}$'; then
  echo "INVALID format detected (structural check only)"
fi
```

### Indicadores de saída

| Indicador | Significado | Ação |
|-----------|-------------|------|
| `CONFIGURED` | Variável definida e passando validação de formato | Prosseguir |
| `MISSING` | Variável não definida ou arquivo ausente | Definir valor padrão ou falhar de forma controlada |
| `INVALID` | Variável definida mas não corresponde ao padrão esperado | Corrigir valor ou configurar corretamente |

---

## 3. Uso do scanner

O scanner compartilhado está em `.kilo/scripts/scan-secrets.sh`. Ele varre arquivos em busca de padrões de segredos e nunca imprime valores reais (apenas caminhos de arquivos, rótulos de padrão e categorias).

### Como executar

```bash
# Modo staged (arquivos preparados para commit)
bash .kilo/scripts/scan-secrets.sh --staged

# Modo arquivo específico
bash .kilo/scripts/scan-secrets.sh caminho/para/arquivo.txt

# Com ajuda
bash .kilo/scripts/scan-secrets.sh --help
```

### Código de saída (exit codes)

| Código | Significado | Ação |
|--------|-------------|------|
| `0` | Limpo - nenhum segredo detectado | Commit pode prosseguir |
| `1` | Foi encontrado segredo(s) | Remover segredo, rotacionar se exposto, retry |
| `2` | Falha operacional (ferramenta ausente, arquivo binário, erro de git) | Corrigir ambiente e retry |

### Bandeiras e argumentos

| Bandeira | Descrição |
|----------|-----------|
| `--staged` | Escaneia arquivos `git add` (staged). Quando nenhum arquivo é passado, este é o modo padrão. |
| `file ...` | Escaneia os arquivos listados explicitamente. |

### Compreendendo os achados classificados

O scanner categoriza os achados em categorias:

- `Stripe keys` - chaves e segredos da Stripe
- `AWS access keys` - chaves de acesso da AWS
- `GitHub tokens` - tokens e PATs do GitHub
- `Slack tokens` - tokens do Slack
- `Private keys` - blocos de chave privada PEM
- `Certificates` - certificados PEM
- `Connection strings` - URIs com credenciais embutidas
- `Passwords` - assignaturas de senha
- `API keys/secrets/tokens` - assignaturas de API key, secret, token
- `Authorization headers` - cabeçalhos Authorization com Bearer/Basic
- `Session cookies` - cookies de sessão
- `Base64-encoded secrets` - valores base64 codificados

### Bloqueio por nome de arquivo sensível

O scanner bloqueia arquivos com nomes sensíveis, mesmo que estejam vazios:

```
.env, .env.*, *.pem, *.key, *.p12, *.pfx, id_rsa, id_dsa, id_ecdsa, id_ed25519, credentials.*, secrets.*, *.crt, *.cer
```

Exceto allowlist: `*.example` (arquivos com sufixo `.example` são permitidos).

### Bloqueio de arquivos binários

Arquivos binários (detectados via heurística de bytes nulos) são bloqueados e não são inspecionados.

---

## 4. Interpretação de códigos de saída

### Convenções de fail-closed

| Exit code | Significado | Significado técnico |
|-----------|-------------|---------------------|
| `0` | Clean | Nenhum segredo detectado nas varreduras realizadas |
| `1` | Findings | Pelo menos um padrão de segredo foi correspondido |
| `2` | Operational failure | Ferramenta obrigatória ausente (grep, sed), arquivo binário detectado, erro de git em modo staged |

### Comportamento fail-closed

- **Ferramenta ausente**: Se `grep` ou `sed` não estiverem disponíveis, o scanner sai com `exit 2` (bloqueia o commit).
- **Arquivos binários**: Se um arquivo for detectado como binário (contém bytes nulos), ele é bloqueado com a mensagem `BLOCKED: [Binary file] binary file not inspected` e o scanner continua para o próximo arquivo.
- **Nomes de arquivos sensíveis**: Se o nome do arquivo corresponder a um padrão sensível, o scanner bloqueia com `BLOCKED: [Sensitive file] sensitive file name: <caminho>`.
- **Enumeração de staged falha**: Se o git não estiver disponível no modo staged, o scanner sai com `exit 2`.

### Resumo de decisões

- `exit 0` ✅ = ambiente limpo, pode continuar
- `exit 1` ⚠️ = achados de segredos, necessita correção
- `exit 2` ❌ = falha operacional, corrigir ambiente antes de continuar

---

## 5. Sanitização de resultados

Nunca incluir valores de segredos em relatórios, logs ou delegações. Filtrar antes da entrega ao modelo.

### Padrão de sanitização

```bash
# ❌ UNSAFE - vazamento de segredo na saída
printf 'Encontrei: %s\n' "$SECRET_VALUE"

# ✅ SAFE - apenas rótulo/categoria, sem valor
printf 'Encontrado padrão: [Stripe keys] Stripe secret key\n'

# ✅ SAFE - remoção de valores antes de reportar
redacted_output=$(printf '%s\n' "$output" | sed 's/sk_[A-Za-z0-9]*=[^"]*"[^"]*"/sk_=***REDACTED***/g')
# or simply: omit the value entirely
```

### Stripping de backtick em markdown (MP-32)

- *Espansos* (inline code spans delimitados por crases `` ` ``) são **removidos** antes do scanner rodar, apenas em arquivos markdown (`*.md`, `*.mdx`, `*.markdown`).
- Blocos de código com cercas triplas (```) **não** são removidos; somente spans inline.
- O stripping é aplicado linha por linha; um span que atravessa linhas não é removido.

Exemplo de safe documentation (backtick stripping applied):

```markdown
<!-- ✅ Safe: inline code with fake values will be stripped -->
`sk_test_fake1234567890abcdef`

<!-- ❌ Not safe: real-looking values in documentation -->
`sk_test_1234567890abcdef`  <!-- will be stripped, but may mask real secret -->
```

**Regra prática**: Em documentação, sempre usar valores fictícios óbvios ou blocos de código com cercas triplas (que são escaneados integralmente).

---

## 6. Tratamento de falsos positivos

O endurecimento MP-31G exige aspas de abertura, então identificadores não-quoted não acionam mais os padrões. Isso evita falsos positivos em padrões comuns de React e JavaScript.

### Casos que NÃO acionam o scanner (MP-31G hardening)

```javascript
// ✅ Estes NÃO acionam padrões (sem aspas ao redor do valor):
const session = event.data.object;          // "const session = ..."
handleChangePassword();                   // "const session = ..." prefixo
useState('');                              // "const [currentPassword, setCurrentPassword] = useState('')"
const [newPassword, setNewPassword] = useState('');  // state hook
value={currentPassword}                   // JSX attribute
const token = getToken();                 // chamada de função
const secret = getSecret();               // chamada de função

// ⚠️ Estes PODEM acionar padrões (com aspas ao redor do valor):
config.token = [REDACTED]              // assignment with quoted value
password = [REDACTED]                  // password assignment
api_key=[REDACTED]                           // API key assignment
```

### Por que isso funciona

O padrão MP-31G para senhas, chaves API, segredos genéricos e IDs de sessão **exige um caractere de aspas de abertura** (`"` ou `'`). Identificadores sem aspas (como `const session = ...`, variáveis de React state, funções) não correspondem porque não há um literal de string aspasado ao lado da palavra-chave.

**Exemplo prático**:

```javascript
// Safe - will NOT be flagged (MP-31G)
export const usePassword = (initialValue = '') => {
  const [password, setPassword] = useState(initialValue);
  return password;
};

// ⚠️ May be flagged if value is a quoted secret
config = { apiKey: [REDACTED] };  // quoted value triggers pattern
```

---

## 7. Resposta a incidentes

Se um segredo real potencialmente tiver sido exposto:

1. **Não reproduza o valor** - nunca copie ou digite o valor real em nenhum lugar.
2. **Para a operação** - interrompa o que está sendo feito imediatamente.
3. **Registre apenas o tipo/alcance/conhecido** - anote: "segredo da Stripe pode ter sido exposto no arquivo X durante varredura Y". Não inclua o valor.
4. **Informe que a credencial pode estar comprometida** - marque para rotação.
5. **Recomende rotação** - gire o segredo o mais breve possível.
6. **Verifique locais de registro** - verifique git history, logs, tickets, issues onde o valor pode ter sido digitado.
7. **Não imprima o segredo novamente** - nem mesmo para "verificar" ou "testar".
8. **Não auto-revoque** - siga o procedimento oficial do provedor (Stripe, AWS, etc.).

### Fluxo de incidente

```text
[Detecção de possível vazaamento]
       |
       v
[Não reproduzir valor] → [Registrar tipo/scope apenas] → [Comitar ao time] → [Rotação programada]
       |
       v
[Verificar locais de histórico/git] → [Comunicar ao provedor se necessário]
```

### Exemplo de registro de incidente (sem valores)

```
INCIDENTE: Stripe key potentially exposed
Arquivo: src/config/stripe.ts
Contexto: scanner detected pattern during pre-commit
Ação: Rotacionar sk_live_[REDACTED] no dashboard da Stripe
Verificar: git log --all --oneline -- src/config/stripe.ts
```

---

## 8. Verificação antes de relatórios e delegações

Antes de produzir qualquer saída (relatórios, delegações, comentários, issues), verifique se não há exposição de segredos.

### Checklist de verificação pré-saída

| Item | Verificação | O que fazer se falhar |
|------|-------------|----------------------|
| 1 | O código-fonte ou diff contém valores reais de `sk_`, `rk_`, `whsec_`, `AKIA[REDACTED]`, `ASIA`, `ghp_`, `xoxb-`? | Remover/redator valores antes de prosseguir |
| 2 | Os logs de teste contêm strings que parecem credenciais? | Redator logs ou ajustar teste para usar valores fictícios |
| 3 | O relatório final inclui `S_STRIPE`, `S_AWS`, `S_GH` fictícios? | Substituir por exemplos fictícios definidos neste documento |
| 4 | O output do scanner foi filtrado para remover valores? | Rodar `bash .kilo/scripts/scan-secrets.sh` e conferir output manualmente |
| 5 | Variáveis de ambiente `.env` foram lidas via `cat` ou `printenv`? | Substituir por verificações de existência `[ -z "${VAR:-}" ]` |
| 6 | O markdown contém spans inline `` `credential` `` que poderiam ser removidos? | Aplicar stripping de backtick ou usar cercas triplas ``` ``` |
| 7 | O report/delegation menciona algum valor `password`, `secret`, `token`, `key` como exemplo? | Substituir por `EXAMPLE_PASSWORD`, `FAKE_SECRET`, `FAKE_TOKEN` |
| 8 | Houve referência a arquivos `.env` reais ou caminhos de arquivo? | Verificar se o caminho está na lista de bloqueio de nomes sensíveis |

### Exemplo de saída sanitizada

```
✅ Varredura de segredos concluída
Arquivos analisados: 12
Padrões encontrados: 0
Status: CLEAN (exit 0)
```

### Exemplo de saída NÃO sanitizada (proibida)

```
❌ VARREDURA DE SEGREDOS - NUNCA ISSO
Arquivos analisados: 12
Stripe secret key: [REDACTED] found in config/stripe.js
AWS key: [REDACTED] found in .env
```

---

## Referências rápidas

- **Scanner**: `.kilo/scripts/scan-secrets.sh`
- **Testes de scanner**: `.kilo/scripts/test-scan-secrets.sh` (apenas credenciais fictícias)
- **Testes de segurança de env**: `.kilo/scripts/test-scan-env-safety.sh`
- **Instalação de hook**: `.kilo/scripts/install-hooks.sh`
- **Especificações de saída**: exit 0 = clean, exit 1 = findings, exit 2 = operational failure
- **Hardening MP-31G**: padrões exigem aspas de abertura; `const session = ...`, `handleChangePassword`, state React não acionam falsos positivos
- **Stripping MP-32**: backtick inline em markdown é removido antes do scan; blocos triplos ``` não são removidos

---

*Última atualização: 2026-11-09*
*Versão: 1.0.0*