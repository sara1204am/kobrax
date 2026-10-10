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

## Arranque

```bash
pnpm install
cp .env.example .env       # completar valores
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

> Las políticas RLS viven en `packages/database/prisma/rls/` y se aplican con un
> script tras las migraciones (no forman parte de las migraciones de Prisma).

## Estado del producto (2026-10-09)

Kobrax es un **MVP funcional completo, desplegado en https://kobrax.ikigaisystems.lat con datos de prueba** (sin clientes reales todavía).

| Componente | Estado |
|------------|--------|
| API (`apps/api`) | 20 módulos: auth + 2FA, RBAC, mora, agenda, rutas (OSRM), pagos, importación de cartera, analytics, exportaciones, realtime |
| Web (`apps/web`) | Panel con dashboard, cartera, importación, mora, agenda, rutas, pagos, equipo, cuenta; es/en |
| Móvil (`apps/mobile`) | Offline-first (SQLite + cola de sync), 5 pestañas, evidencia con foto + GPS + hash |
| Datos (`packages/database`) | 48 modelos, 39 enums, 48 migraciones, RLS forzada en 41 tablas |

Detalle verificado contra el código, con lo implementado, parcial y planeado:
[`docs/postulacion-india-bolivia/02-dossier-tecnico.md`](docs/postulacion-india-bolivia/02-dossier-tecnico.md).

Pendiente conocido: almacenamiento S3/R2 (hoy disco local), SMS/email de
notificaciones (stubs), push remoto, firma digital, mapas offline, alcance de datos
por fila `own`. Plan de despliegue en `docs/business/PRICING-Y-DEPLOY.md`.

## Dominio (modelo de 4 pilares)

| Pilar | Tablas núcleo |
|-------|---------------|
| 1 · Multi-tenant / Acceso | account, branch, user, profile, role, permission, user_account, user_session |
| 2 · Clientes y Créditos   | client (+ contact/location/relation/attachment), credit, credit_installment, arrear |
| 3 · Mora, agenda y campo  | credit_arrear_episode, credit_activity, agenda_item, route_plan, route_stop, field_visit, field_evidence |
| 4 · Pagos                 | payment, payment_request |

> El «caso de cobranza» (`collection_case`) fue **eliminado** en F4/08: la gestión
> es por crédito (episodios de mora y actividades). Ver `docs/epics/F4/08-eliminar-caso.md`.
