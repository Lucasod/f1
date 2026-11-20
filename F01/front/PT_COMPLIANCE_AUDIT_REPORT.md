# FS-01 Marketplace — English-Only Compliance Audit Report

**Audit Scope:** `F01/front/src` directory (excluding `node_modules`)
**CD-054 Reference:** "Currency and Localization — English Interface, BRL Currency"
**Decision:** The interface language is **English**. The transaction currency for the MVP is BRL (Brazilian Real). User-facing text must be in English.

---

## Executive Summary

A comprehensive audit of the frontend codebase found ** numerous Portuguese user-facing strings ** across component files, test files, layout components, error messages, form labels, buttons, and navigation. All findings are documented below with priority grouping, file paths, line numbers, and whether each should be translated to English per the CD-054 English-interface requirement.

---

## Critical Priority (buttons, navigation, forms, auth)

| # | Exact Text | File Path | Line | User-Facing? | Should Be English |
|---|-----------|-----------|------|-------------|-------------------|
| 1 | `Você precisa estar logado para acessar o checkout.` | `CheckoutPage.tsx` | 343 | Yes | Yes — "You need to be logged in to access the checkout." |
| 2 | `Acesso negado` | `CheckoutPage.tsx` | 344 | Yes | Yes — "Access denied" |
| 3 | `Selecione um endereço de entrega` | `CheckoutPage.tsx` | 250 | Yes | Yes — "Select delivery address" |
| 4 | `Começar a comprar` | `OrderHistoryPage.tsx` | 132 | Yes | Yes — "Start shopping" |
| 5 | `Próxima` | `OrderHistoryPage.tsx` | 208 | Yes | Yes — "Next" (pagination button) |
| 6 | `Próxima` | `VendorOrderPage.tsx` | 360 | Yes | Yes — "Next" (pagination button) |
| 7 | `Você ainda não tem nenhum grupo de pedidos associado.` | `VendorOrderPage.tsx` | 279 | Yes | Yes — "You don't have any order groups associated." |
| 8 | `Página {currentPage} de {totalPages}` | `OrderHistoryPage.tsx` | 200 | Yes | Yes — "Page {currentPage} of {totalPages}" |
| 9 | `Página {currentPage} de {totalPages}` | `VendorOrderPage.tsx` | 352 | Yes | Yes — "Page {currentPage} of {totalPages}" |
| 10 | `Ir para o Checkout` (aria-label context) — actually "Ir para o Checkout" was not found; the cart button says "Ir para o Checkout" in Portuguese. Re-evaluating: `CartPage.tsx` line 477 has `Ir para o Checkout` as button text. | `CartPage.tsx` | 477 | Yes | Yes — "Go to Checkout" |
| 11 | `aria-label={`Remover ${product?.name || 'item'} do carrinho`}` | `CartPage.tsx` | 418 | Yes (ARIA) | Yes — `aria-label={`Remove ${product?.name || 'item'} from cart`}` |
| 12 | `Não foi possível carregar os detalhes do pedido. Tente novamente.` | `OrderDetailPage.tsx` | 418 | Yes | Yes — "Could not load order details. Try again." |
| 13 | `Tem certeza que deseja remover "${itemName}" do carrinho?` | `CartPage.tsx` | 498 | Yes | Yes — `Tem certeza que deseja remover "${itemName}" from cart?` |

---

## High Priority (error messages, empty states, status descriptions)

| # | Exact Text | File Path | Line | User-Facing? | Should Be English |
|---|-----------|-----------|------|-------------|-------------------|
| 1 | `Não foi possível carregar os endereços` | `CheckoutPage.tsx` | 203 | Yes | Yes — "Could not load addresses" |
| 2 | `Cupom inválido` | `CheckoutPage.tsx` | 234 | Yes | Yes — "Invalid coupon" |
| 3 | `Não foi possível carregar o resumo do pedido` | `CheckoutPage.tsx` | 438 | Yes | Yes — "Could not load order summary" |
| 4 | `Erro ao carregar endereços` | `CheckoutPage.tsx` | 467 | Yes | Yes — "Error loading addresses" |
| 5 | `Este é um ambiente de demonstração. Nenhuma cobrança real será realizada.` | `CheckoutPage.tsx` | 659-660 | Yes | Yes — "This is a demonstration environment. No real charges will be made." |
| 6 | `Não foi possível carregar os detalhes do pedido. Tente novamente.` | `OrderDetailPage.tsx` | 418 | Yes | Yes — "Could not load order details. Try again." |
| 7 | `Endereço de Entrega` | `OrderDetailPage.tsx` | 245 | Yes | Yes — "Delivery Address" |
| 8 | `Comissão ({vendorGroup.commissionPct}%)` | `OrderDetailPage.tsx` | 175 | Yes | Yes — `Commission ({vendorGroup.commissionPct}%)` |
| 9 | `Comissão ({vendorGroup.commissionPct}%)` | `VendorOrderPage.tsx` | 151 | Yes | Yes — `Commission ({vendorGroup.commissionPct}%)` |
| 10 | `Nenhum pedido encontrado` (EmptyState title) | `OrderHistoryPage.tsx` | 127 | Yes | Yes — "No orders found" |
| 11 | `Erro ao carregar pedidos` | `OrderHistoryPage.tsx` | 107 | Yes | Yes — "Error loading orders" |
| 12 | ` no carrinho` (appears in `CartPage.tsx` line 306: `{itemsWithProducts.length} item{itemsWithProducts.length !== 1 ? 's' : ''} no carrinho`) | `CartPage.tsx` | 306 | Yes | Yes — `in cart` (rewrite as `{itemsWithProducts.length} item{itemsWithProducts.length !== 1 ? 's' : ''} in cart`) |
| 13 | `Tem certeza que deseja remover "${itemName}" do carrinho?` | `CartPage.tsx` | 498 | Yes | Yes — `Tem certeza que deseja remover "${itemName}" from cart?` |
| 14 | `Comentário do Pedido` | `OrderCommentSection.tsx` | 111 | Yes | Yes — "Order Comment" |
| 15 | `Comentário` (label) | `OrderCommentSection.tsx` | 146 | Yes | Yes — `Comment` |

---

## Medium Priority (descriptive text, accessibility labels)

| # | Exact Text | File Path | Line | User-Facing? | Should Be English |
|---|-----------|-----------|------|-------------|-------------------|
| 1 | `Endereço` (CHECKOUT_STEPS title) | `CheckoutPage.tsx` | 143 | Yes | Yes — "Address" |
| 2 | `Selecione o endereço de entrega` (CHECKOUT_STEPS description) | `CheckoutPage.tsx` | 143 | Yes | Yes — "Select delivery address" |
| 3 | `Cupom` (CHECKOUT_STEPS title) | `CheckoutPage.tsx` | 144 | Yes | Yes — "Coupon" |
| 4 | `Aplique cupons de desconto` (CHECKOUT_STEPS description) | `CheckoutPage.tsx` | 144 | Yes | Yes — "Apply discount coupons" |
| 5 | `Selecione o endereço para onde o pedido será entregue` | `CheckoutPage.tsx` | 457 | Yes | Yes — "Select address where the order will be delivered" |
| 6 | `Página {currentPage} de {totalPages}` (appears in pagination span) | `OrderHistoryPage.tsx` | 200 | Yes | Yes — "Page {currentPage} of {totalPages}" |
| 7 | `encontrado` (appears in order history count: ` {totalOrders} pedido{totalOrders !== 1 ? 's' : ''} encontrado{totalOrders !== 1 ? 's' : ''}`) | `OrderHistoryPage.tsx` | 156 | Yes | Yes — "found" |
| 8 | `Todos os status` (Select label) | `OrderHistoryPage.tsx` | 55 | Yes | Yes — "All status" |
| 9 | `Filtrar por status` (Select label) | `OrderHistoryPage.tsx` | 166 | Yes | Yes — "Filter by status" |
| 10 | `Todos os status` (Select value label) | `VendorOrderPage.tsx` | 70 | Yes | Yes — "All status" |
| 11 | `Comentário do Pedido` (CardTitle) | `OrderCommentSection.tsx` | 111 | Yes | Yes — "Order Comment" |
| 12 | `Comentário` (label prop) | `OrderCommentSection.tsx` | 146 | Yes | Yes — `Comment` |
| 13 | `Produto ${item.productId.slice(0, 8)}...` (fallback product name) | `CartPage.tsx` | 368 | Mixed (fallback) | Yes — `Product ${item.productId.slice(0, 8)}...` |
| 14 | `São Paulo` (placeholder in ConsumerProfile) | `ConsumerProfile.tsx` | 706 | Yes (placeholder) | Context-dependent — "São Paulo" is a city name used as example; could remain as example or changed to "City" |
| 15 | `Nenhum grupo de pedidos encontrado` (VendorOrderPage empty state) | `VendorOrderPage.tsx` | 255 (title prop) | Yes | Yes — "No order groups found" |
| 16 | `Tente alterar o filtro de status para ver mais grupos de pedidos.` | `VendorOrderPage.tsx` | 278 | Yes | Yes — "Try changing the status filter to see more order groups" |
| 17 | ` {totalGroups} grupo{totalGroups !== 1 ? 's' : ''} de pedido{totalGroups !== 1 ? 's' : ''} encontrado{totalGroups !== 1 ? 's' : ''}` | `VendorOrderPage.tsx` | 304 | Yes | Yes — ` {totalGroups} order group{totalGroups !== 1 ? 's' : ''} found{totalGroups !== 1 ? 's' : ''}` |

---

## Low Priority (comments, internal diagnostics)

| # | Exact Text | File Path | Line | Notes |
|---|-----------|-----------|------|-------|
| 1 | `pt-BR` locale in `Intl.NumberFormat` | Multiple files (CheckoutPage.tsx:28, OrderDetailPage.tsx:24, OrderHistoryPage.tsx:16, CartPage.tsx:24, ConsumerDashboard.tsx:17, ConsumerProfile.tsx:706) | N/A | **KEEP** — This is a currency/formatting locale, not user-facing text. Required for correct BRL formatting per CD-054. |
| 2 | `BRL` currency code | Multiple files | N/A | **KEEP** — ISO currency code, not user-facing. |
| 3 | Code comments | Throughout | N/A | Mostly English already; no action needed. |
| 4 | `Nota: Este é um ambiente de demonstração.` | `CheckoutPage.tsx` | 659 | See Critical — user-facing demo notice. |
| 5 | `Nenhuma cobrança real será realizada.` | `CheckoutPage.tsx` | 660 | See Critical — user-facing demo notice. |

---

## Key Files Audited (as requested in the task)

### 1. `F01/front/src/features/checkout/CheckoutPage.tsx`
**Portuguese strings found:** 14 instances across lines 143, 203, 234, 250, 343, 344, 438, 457, 467, 659, 660.

Critical: auth messages ("Você precisa estar logado...", "Acesso negado"), form labels ("Selecione um endereço de entrega"), checkout steps ("Endereço", "Cupom"), error messages ("Não foi possível carregar os endereços", "Cupom inválido", "Não foi possível carregar o resumo do pedido"), demo notice.

### 2. `F01/front/src/features/order/OrderDetailPage.tsx`
**Portuguese strings found:** 3 instances across lines 175, 245, 418.

- "Comissão" in VendorGroupCard financial summary
- "Endereço de Entrega" section title
- Error message "Não foi possível carregar os detalhes do pedido. Tente novamente."

### 3. `F01/front/src/features/order/OrderHistoryPage.tsx`
**Portuguese strings found:** 8+ instances across lines 127, 132, 156, 166, 200, 208.

- Empty state title "Nenhum pedido encontrado"
- Button "Começar a comprar"
- Pagination text "Página {currentPage} de {totalPages}" and "Próxima"
- Status count text with "encontrado"
- Select labels "Todos os status", "Filtrar por status"

### 4. `F01/front/src/components/Navigation.tsx`
**Portuguese strings found:** **None**.

All navigation labels are in English: "Browse Products", "Cart", "Consumer Dashboard", "My Orders", "My Profile", "Become a Seller", "Vendor Dashboard", "Vendor Products", "Vendor Orders", "Admin Dashboard", "Logout", "Login", "Register".

---

## Recommendations

1. **High-impact fixes first**: Critical auth messages (lines 343, 344 of CheckoutPage.tsx) and form labels (line 250) should be translated immediately as they affect user flows.

2. **Pagination and empty states**: "Próxima", "Começar a comprar", "Página X de Y", and empty state titles are high-visibility strings that should be updated to English.

3. **Business terminology**: "Comissão" → "Commission" across OrderDetailPage.tsx and VendorOrderPage.tsx. This is a domain term that should be in English per CD-054.

4. **Cart page**: "no carrinho" and "do carrinho" should become "in cart" and "from cart" respectively.

5. **Demo notice**: The "Este é um ambiente de demonstração." notice should be translated to English per CD-054.

6. **Test files**: Test files also contain Portuguese strings (e.g., "Produto Teste", "Descrição do produto", "pedido não encontrado", "você ainda não", "próxima", "página 1 de 3"). These should be updated to English to match the English interface requirement. Test data/product names may use Portuguese as test fixtures, but UI-facing test expectations should match the English rendered output.

7. **ConsumerProfile.tsx placeholder**: `placeholder="São Paulo"` — "São Paulo" is a specific city name. As a placeholder/example, this is acceptable but could be changed to "City" for strict English-only compliance. Marked as medium/low priority depending on whether city examples need localization.

---

## Files with No Portuguese User-Facing Text

- `F01/front/src/components/Navigation.tsx` — All labels in English.
- `F01/front/src/features/catalog/` — No Portuguese user-facing strings found.
- `F01/front/src/app/` — No Portuguese user-facing strings found.

---

## Evidence and Limits

- **What this audit proves:** A comprehensive list of Portuguese user-facing strings across the FS-01 Marketplace frontend codebase, grouped by priority, with file paths and line numbers. All strings identified are flagged as needing translation to English per CD-054.
- **What this audit does not prove:** Runtime behavior of the application. The audit is a static code review; it does not test the application running or verify that translations actually render correctly in production.
- **Test file inclusion:** Test files were searched as part of the `F01/front/src` directory. Many Portuguese strings in test files are test data/product names rather than UI-facing text, but they were included in the audit since the task requested searching the entire `F01/front/src` directory.

---

## Git State

- No files were modified during this audit.
- All changes recommended are fixes/translations to bring the frontend into English-only compliance per CD-054.
- A follow-up task should be created to implement the English translations and update test expectations.