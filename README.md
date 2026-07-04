# Kobrax

Plataforma multi-tenant de gestión inteligente de cobranzas para Latinoamérica.
Escala desde cobradores independientes hasta instituciones bancarias nacionales.

## Stack

- **Monorepo**: Turborepo + pnpm
- **Backend**: NestJS + TypeScript + Prisma ORM
- **DB**: PostgreSQL 15 + Redis 7 (RLS multi-tenant activa)
- **Web**: Next.js 14 (App Router) + Tailwind + shadcn/ui
- **Mobile**: React Native + Expo SDK 51 (offline-first)

## Estructura

```
kobrax/
├── apps/
│   ├── api/        # NestJS backend (REST + WebSocket)
│   ├── web/        # Next.js panel admin/supervisores
│   └── mobile/     # Expo app cobrador en campo
├── packages/
│   ├── shared/     # Tipos, DTOs, enums, constantes, utils
│   └── database/   # Prisma schema + migraciones + seeds + RLS
├── CLAUDE.md           # Arquitecto general (agente raíz)
└── TESTING_CLAUDE.md   # Estrategia de testing
```

## Principios no negociables

1. Multi-tenant primero: toda entidad operativa lleva `account_id`.
2. Security-first: RLS en PostgreSQL en todas las tablas operativas.
3. Audit trail obligatorio en toda mutación.
4. Offline-capable en mobile.
5. Evidencia inmutable (SHA-256) para foto, GPS y firma.
6. TypeScript estricto (`strict: true`, sin `any`).
7. Respuestas API estandarizadas `{ data, meta, error }`.

## Arranque (cuando estén las apps)

```bash
pnpm install
cp .env.example .env       # completar valores
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Dominio (modelo de 4 pilares)

| Pilar | Tablas núcleo |
|-------|---------------|
| 1 · Multi-tenant / Acceso | account, branch, user, profile, role, permission, user_account, user_session |
| 2 · Clientes y Créditos   | client (+ contact/location/relation/attachment), credit, credit_installment, arrear |
| 3 · Casos y Rutas (campo) | collection_case, route_plan, route_stop, field_visit |
| 4 · Pagos                 | payment, payment_request |

> Estado: **4 pilares modelados** en `packages/database` (F0 + F1). Tablas transversales de seguridad → F12 (Hardening).
