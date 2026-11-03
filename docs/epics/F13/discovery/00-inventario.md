# Discovery · 00 · Inventario general

> **Estado: COMPLETO 2026-11-02** (parte de este archivo: paquetes, módulos, tamaños, puntos de integración de oficinas). Método: `../../_framework/README.md` §2 · hallazgo = plantilla T1. Pistas: `00-leads.md`.
> Lente de tenant: (a) gratuito individual · (b) equipo/agencia pequeña · (c) tenant grande con varias oficinas.
> Tamaños = líneas de `.ts/.tsx` contadas con `wc -l` el 2026-11-02 (aproximadas; incluyen specs).

## Apps y paquetes
| Pieza | Ubicación | Archivos TS/TSX | Líneas ≈ | Notas |
|---|---|---|---|---|
| API (NestJS 10) | `apps/api/src` | 346 | 49.600 | 23 módulos + `common/` (audit, crypto, plan, guards, ws, mail, pdf, backup…) |
| Web (Next 14) | `apps/web/src` | 497 | 62.200 | App Router; páginas `(panel)`: agenda, cartera, cuenta, dashboard, equipo, exportar, import, mora, pagos, rutas, settings; BFF en `app/api/*` |
| Móvil (Expo 51 / RN 0.74) | `apps/mobile` | 245 | 36.400 | rutas `app/`: agenda, ajustes, cliente, cuenta, import, mora, prestamo, rutas, notificaciones, pendientes |
| `@kobrax/shared` | `packages/shared/src` | 120 | 12.800 | permisos, roles, planes, utilidades de dominio, tipos |
| `@kobrax/database` | `packages/database/prisma` | 8 | 3.000 (TS) | `schema.prisma` 1.924 líneas · 50 modelos · 44 enums · 59 migraciones (+`migration_lock.toml`) · `rls/` 6 SQL · `verify/` 4 SQL |
| Infra | `infra/{postgres,osrm,production}`, `docker-compose.yml`, `.github/workflows/` (2) | — | — | ver `08-dependencias.md` |

## Módulos de la API (`apps/api/src/modules`, archivos TS / líneas ≈)
accounts 22/2.280 · agenda 14/4.612 · analytics 5/1.149 · arrear-categories 6/331 · arrears 7/759 · assignments 10/1.962 · auth 39/3.234 · **branches 7/537** · catalogs 7/366 · clients 16/3.623 · credits 12/3.159 · dashboards 5/575 · exports 6/508 · field-ops 9/1.398 · imports 27/5.293 · mora 25/4.857 · notifications 18/2.203 · payments 11/1.680 · routes 16/4.280 · uploads 5/255 · users 11/1.813.
Más `permission-gates.spec.ts` suelto. No existen módulos `roles` ni `tenants` separados aunque CLAUDE.md los lista (los roles/permisos viven en `shared` + `auth` + `accounts`).

## Hallazgos

### H-00-01 · Stack y versiones reales
- Clase: VERIFICADO
- Evidencia: `package.json` raíz y `apps/*/package.json` (ver `08-dependencias.md` H-08-01); `turbo.json` (tareas build/dev/lint/type-check/test; `lint`, `type-check`, `test` dependen de `^build`)
- Hecho: pnpm 9.12 + Turborepo; NestJS ^10.4, Next ^14.2, Expo ~51, RN 0.74.5, Prisma ^5.20, vitest (web/shared), jest (móvil), `node:test`+`tsx` (API).
- Implica para la épica: tres runners de test distintos; el lint es placeholder en todos (07 H-07-01…).
- Lente: igual para (a)(b)(c).
- HUB: —

### H-00-02 · Puntos de integración de oficinas: dónde aparece `branchId` / `branch_id` hoy
- Clase: VERIFICADO (búsqueda de texto de `branchId|branch_id`, 2026-11-02; no se leyó cada uso)
- Evidencia:
  - **Esquema:** `packages/database/prisma/schema.prisma` — 7 menciones: `Branch` (`:134-155`), `UserAccount.branchId` (`:291`, `@@unique([userId, accountId])` `:304`), `Credit.branchId`; RLS lista `branches` en `rls/001_enable_rls.sql:27`; `rls/002_auth_functions.sql:16,28` devuelve `branch_id` de `user_accounts`; `rls/002_scope.sql:45-50` documenta que `branch` aún no se aplica en SQL.
  - **API (28 archivos no-spec):** `branches/{controller,service}`, `users/{service,serializer,dto}`, `auth/auth.service.ts`, `assignments/{assignment.service,assignment-rules}`, `mora/{mora-query,mora.service,mora.serializer,mora-export,mora-export.service,dto}`, `agenda/agenda.service`, `analytics/{service,dto}`, `clients/{service,dto}`, `credits/{service,serializer,dto}`, `payments/payments.service`, `routes/{service,serializer,dto}`, `exports/exports.service`, `imports/{portfolio-credit,portfolio-import.service}`.
  - **Web (9 archivos):** `cuenta/agencias/branches-manager.tsx`, `lib/branches.ts`, `lib/mora.ts`, `lib/dashboard.ts`, `lib/cartera-query.ts`, `cartera/portfolio-table.tsx`, `mora/arrears-table.tsx`, BFF `api/branches/[id]/members/route.ts` y `api/users/[id]/route.ts`.
  - **Móvil:** solo `src/routes.service.ts:51,63` (`branchId?` al crear ruta).
  - **Shared:** permisos `data:scope:all` / `data:scope:branch` en `constants/permissions.ts` (L-04/L-05).
  - **Alcance y reparto:** `assignment.service.ts:160-165` (ALL vs BRANCH con la oficina propia), `assignment-rules.ts:58-71` (`agencyViolations`, igualdad simple), `mora-query.ts:127-152`, `prisma.service.ts:93-97`.
- Hecho: la oficina es una referencia plana en usuarios y créditos, resuelta por igualdad en ~28 archivos de API; el móvil casi no la conoce; el SQL de RLS no la aplica.
- Implica para la épica: es la lista de consumidores a recorrer en `hub/IMPACT-MAP.md` antes de cambiar el modelo (A4, B14); crear un cálculo de alcance único (candidato E) toca estos archivos.
- Lente: (a) `branch_id` NULL o la única agencia; (b)(c) todos estos puntos aplican.
- HUB: HUB-009…016 (B14) y por completar con `analytics`, `exports`, `routes`, `payments`.

### H-00-03 · Funcionalidad de oficinas existente (resumen)
- Clase: VERIFICADO
- Evidencia: `apps/api/src/modules/branches/branches.controller.ts` (lectura `USER_READ`, escrituras `ACCOUNT_WRITE`); `branches.service.spec.ts` (alta, edición, baja lógica, asignar miembros, código único `20261021110000_branch_code_unique`); web `(panel)/cuenta/agencias/`
- Hecho: existe CRUD de «agencias» y asignación de miembros; no hay árbol, tipo ni nivel.
- Implica para la épica: ver `01` y `02` para el detalle; aquí solo ubica la pieza.
- HUB: —

### H-00-04 · Superficie para jobs y entradas de datos
- Clase: VERIFICADO
- Evidencia: seis `setInterval` en servicios (06 H-06-10); scripts CLI en `apps/api/package.json` (`arrears:run`, `plan:set`, `account:suspend`, `request:handle`, `plan:lifecycle`, `db:backup`); única ingesta masiva: `imports/portfolio` (06 H-06-01)
- Hecho: no hay colas ni API de máquina.
- HUB: —

### H-00-05 · Documentos de producto vigentes vs desactualizados
- Clase: INFERIDO (por contraste con código; no se auditó todo `docs/`)
- Evidencia: `docs/producto/README.md:57` y `plans.ts:12` niegan la existencia de sucursales (contradicho por `apps/api/src/modules/branches/`, ver `08` H-08-05); `docs/business/LIMITES-POR-PLAN.md:190-191,334-338` idem; `docs/producto/demo-datos-y-despliegue.md` §4.6 tiene una sección «Qué quedó desactualizado»
- Hecho: los documentos de negocio sobre sucursales y planes van por detrás del código.
- Implica para la épica: usar los documentos solo como INFERIDO (regla A3); el código manda.
- HUB: —

## Contradicciones y desconocidos
- **CONTRADICTORIO C-00-1:** CLAUDE.md lista módulos `tenants`, `roles`, `routes`, `field-ops` etc.; en el código no existen `tenants` ni `roles` como carpetas de módulo, y `mora`/`agenda`/`field-ops` sí (VERIFICADO por listado de `apps/api/src/modules`). Sin impacto directo en F13.
- **CONTRADICTORIO C-00-2:** existencia de sucursales (ver `08` H-08-05).
- **DESCONOCIDO D-00-1:** la fila exacta de HUB de `analytics`, `exports`, `routes` y `payments` para el consumidor de `branchId` (los vio la búsqueda de texto, no se leyeron sus usos). Lo cierran `02-backend-api.md` y el HUB.
- **DESCONOCIDO D-00-2:** `docs/HANDOFF.md` no se leyó en esta pasada; su vigencia queda sin evaluar.
