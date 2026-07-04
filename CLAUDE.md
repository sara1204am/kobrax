# KOBRAX — Sistema de Gestión Inteligente de Cobranzas
# Agente: Arquitecto General del Sistema

## Identidad del Producto
Kobrax es una plataforma multi-tenant de gestión de cobranzas para Latinoamérica.
Permite operar desde cobradores independientes hasta bancos nacionales en un mismo ecosistema.

## Stack Tecnológico Oficial
- **Monorepo**: Turborepo
- **Backend**: NestJS + TypeScript + Prisma ORM
- **Base de datos**: PostgreSQL 15 + Redis 7
- **Web**: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Mobile**: React Native + Expo SDK 51 (offline-first)
- **Shared**: packages/shared (tipos, DTOs, constantes, utilidades)
- **Auth**: JWT + Refresh Tokens + RBAC por scope
- **Storage**: S3/Cloudflare R2 (evidencias fotográficas, firmas)
- **Realtime**: WebSockets via Socket.io (NestJS Gateway)

## Estructura del Monorepo
```
kobrax/
├── apps/
│   ├── api/              # NestJS backend
│   ├── web/              # Next.js panel admin/supervisores
│   └── mobile/           # Expo app cobrador en campo
├── packages/
│   ├── shared/           # Tipos, DTOs, enums, constantes compartidas
│   └── database/         # Prisma schema + migrations + seeds
├── CLAUDE.md             # Este archivo
└── turbo.json
```

## Principios de Arquitectura (NO NEGOCIABLES)
1. **Multi-tenant primero**: toda entidad operativa lleva `account_id`. Sin excepciones.
2. **Security-first**: RLS en PostgreSQL activo en todas las tablas operativas.
3. **Audit trail obligatorio**: toda mutación registra who/when/what/ip.
4. **Offline-capable**: el mobile funciona sin internet; sync cuando hay conexión.
5. **Evidencia inmutable**: foto, GPS y firma → SHA-256 hash guardado en DB al registrar.
6. **TypeScript estricto**: `strict: true` en todos los tsconfig. No `any`.
7. **Respuestas API estandarizadas**: siempre `{ data, meta, error }`.

## Nomenclatura Global
- Archivos: `kebab-case` (ej: `collection-case.service.ts`)
- Clases: `PascalCase`
- Variables/funciones: `camelCase`
- Constantes: `UPPER_SNAKE_CASE`
- Tablas DB: `snake_case` en plural (ej: `collection_cases`)
- Enums en DB: PostgreSQL nativo, no strings

## Módulos del Sistema (dominios)
| Módulo | Responsabilidad |
|--------|----------------|
| `auth` | JWT, refresh tokens, sesiones, 2FA |
| `tenants` | Multi-tenant, cuentas, suscripciones |
| `users` | Usuarios, perfiles, asignaciones |
| `roles` | RBAC: roles, permisos, scopes |
| `clients` | Deudores, segmentación, historial |
| `credits` | Obligaciones financieras, cronogramas, mora |
| `cases` | Casos de cobranza, estados, asignación |
| `routes` | Rutas de campo, optimización, visitas |
| `field-ops` | Gestiones en campo, evidencia digital |
| `payments` | Registro de pagos, conciliación |
| `analytics` | KPIs, reportes, métricas en tiempo real |
| `notifications` | Push, SMS, email, WebSocket |
| `audit` | Log completo de todas las acciones |

## Variables de Entorno (estructura base)
```
DATABASE_URL, REDIS_URL, JWT_SECRET, JWT_REFRESH_SECRET,
JWT_EXPIRES_IN, S3_BUCKET, S3_REGION, S3_ACCESS_KEY,
S3_SECRET_KEY, APP_URL, MOBILE_APP_SCHEME
```
