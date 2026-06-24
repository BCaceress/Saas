# NoHub Market

ERP SaaS multi-tenant para mercados autônomos, conveniências e mercadinhos (foco
inicial: operador de bebidas). **Quem usa é o operador do mercado, não o consumidor
final.** Esta fase: fundação (landing, auth, onboarding, shell) + módulo de Produtos
(Fase 1: SIMPLES/INSUMO).

## Stack

- Next.js 16 (App Router, RSC + Server Actions) · TypeScript · React 19
- Tailwind CSS v4 · shadcn/ui
- Prisma 6 (client gerado em `src/generated/prisma`) · Neon (Postgres)
- Auth.js (NextAuth v5) — Google OAuth + Credentials
- Zod para validação de entrada

## Regra de ouro — multi-tenant (NÃO NEGOCIÁVEL)

Toda leitura/escrita de negócio passa pelo contexto de tenant.

- Use **`db`** (`src/lib/prisma.ts`) — client estendido que injeta `tenantId`
  automático a partir do `AsyncLocalStorage` (`src/lib/tenant-context.ts`, PRD §3.2).
- **Nunca** use o client cru (`basePrisma`) para tabelas de negócio. Ele existe só
  para Auth.js e para o provisionamento (criar User/Tenant/Membership/seed).
- **Nunca** crie registro de negócio sem `tenantId` (o extension já injeta — não
  passe à mão, não burle).
- **Jamais** cruze dados entre tenants.
- **Não use `findUnique`/`findUniqueOrThrow` em tabelas de negócio** — o WHERE de
  findUnique só aceita campos únicos e a injeção de `tenantId` quebra. Use
  **`findFirst`** (o extension adiciona o tenantId).
- Todo código de negócio roda dentro de `runWithTenant(tenantId, () => …)` —
  feito no middleware/handlers após resolver o subdomínio.
- RLS (Postgres, Camada 2) entra como hardening na Fase 2; agora só Camada 1.

## Padrões de código

- **Mutação** → Server Actions (`"use server"`), validando entrada com **Zod**.
- **Leitura** → RSC (Server Components) chamando `db` direto.
- **HTTP** (integrações externas, CSV, webhooks) → route handlers em `app/api/**`.
- Nomes de **domínio em português** (produto, fornecedor, estoque); código/infra em
  inglês onde fizer sentido.
- Tokens de API externos (Cosmos, LLM) **só no servidor** — nunca expostos ao browser.

## UI

- Toda tela segue a skill **frontend-design**. Tokens de design centralizados em
  `src/app/globals.css` (`@theme`) — **fonte única de verdade**. Não hardcode cor/raio;
  use os tokens (`bg-brand`, `text-ink`, `border-line`, `text-accent`, …).
- Idioma da interface: **pt-BR**. Voz ativa, sentence case, rótulos pelo que o operador
  controla ("Salvar produto", não "Submeter"). Estados vazios convidam à ação; erros
  explicam o quê e como resolver, sem pedir desculpas.
- Direção: **"vitrine refrigerada"** — cyan frio (produto) × âmbar (etiqueta de preço).
  Tipografia: Space Grotesk (display) · IBM Plex Sans (corpo) · IBM Plex Mono (dados/SKU).
  Elemento-assinatura: **medidor de saldo dois-saldos** + **SKU como etiqueta de prateleira**.
- Piso inegociável: responsivo até mobile, foco de teclado visível, `prefers-reduced-motion`.

## Estrutura de pastas

```
prisma/schema.prisma          schema único (row-level multi-tenant)
src/generated/prisma          client Prisma gerado (gitignored)
src/lib/                      prisma, tenant-context, auth, seed, sku, normalize, llm, cosmos
src/app/(marketing)/          landing (domínio raiz)
src/app/(auth)/               login, cadastro
src/app/(app)/                shell autenticado (sidebar+navbar) + módulos
src/app/api/                  route handlers (cnpj, enriquecer-ean, importar-csv)
src/components/               UI (ui/ = primitivos shadcn; domínio = StockGauge, SkuTag…)
```

## Comandos

- `npm run dev` — desenvolvimento (use subdomínios via `lvh.me:3000`)
- `npm run db:push` — sincroniza schema sem migration (protótipo)
- `npm run db:migrate` — cria/aplica migration (usa DIRECT_URL)
- `npm run db:studio` — Prisma Studio
- `npm run db:seed` — seed manual (o seed real roda no signup, por tenant)
- `npm run lint`

## Variáveis de ambiente

Ver `.env.example`. Resumo: `DATABASE_URL` (pooled) + `DIRECT_URL` (unpooled),
`APP_DOMAIN`, `AUTH_SECRET` + Google, `COSMOS_*`, `BRASILAPI_URL`, `LLM_PROVIDER`
(`anthropic`|`gemini`) + chaves.

## NÃO FAZER

- Query sem contexto de tenant; `findUnique` em tabela de negócio.
- Expor tokens de API ao browser.
- Aplicar perfil fiscal de seed como verdade — todo `FiscalProfile` de seed nasce com
  `precisaRevisao = true`; só vira verdade após revisão do contador.
- Implementar módulos fora de escopo (PDV, fiscal de emissão, rota, comodato, marketplace
  além do cadastro) — o schema/onboarding preveem via toggles, mas a implementação é posterior.

@AGENTS.md
