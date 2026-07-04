# Kobrax — Plan de Construcción por Fases

> Documento vivo. Define el orden progresivo de construcción, los requerimientos
> que cubre cada fase, **qué agente ejecuta cada tarea**, los entregables y los
> criterios de aceptación (Definition of Done).
>
> **Cada fase se ejecuta como un epic detallado** en [`docs/epics/`](./epics/README.md)
> (alcance cerrado + checklist de seguridad fintech + DoD verificable). Este plan es
> el índice macro; el epic es la fuente de verdad operativa de la fase.

---

## 1. Modelo de operación con agentes

Cada agente es un archivo `CLAUDE.md` ubicado en su dominio. Al trabajar dentro de
ese directorio, el agente correspondiente gobierna las reglas. La orquestación la
lleva el **agente raíz** (`/CLAUDE.md`, Arquitecto General).

| Agente | Ubicación | Responsabilidad |
|--------|-----------|-----------------|
| **Root / Arquitecto** | `CLAUDE.md` | Orquesta fases, define stack y principios no negociables, integra paquetes. |
| **Database** | `packages/database/CLAUDE.md` | Schema Prisma, migraciones, seeds, RLS, índices, vistas materializadas. |
| **Shared** | `packages/shared/CLAUDE.md` | Tipos, DTOs, enums, constantes y utils compartidos (única fuente de verdad). |
| **API** | `apps/api/CLAUDE.md` | Módulos NestJS, controllers/services/repos, WebSocket, contrato `{data,meta,error}`. |
| **Security** | `apps/api/src/modules/auth/CLAUDE.md` | Auth (JWT/refresh/MFA), RBAC, multi-tenant/RLS, cifrado, auditoría, rate limiting. |
| **Web** | `apps/web/CLAUDE.md` | Panel Next.js (supervisores/gerencia), dashboards, realtime. |
| **Mobile** | `apps/mobile/CLAUDE.md` | App Expo del cobrador, offline-first, captura de evidencia. |
| **Testing** | `TESTING_CLAUDE.md` | Pirámide de tests, cobertura mínima, E2E de flujos críticos. |

### Cómo se asigna trabajo a un agente
1. **Orquestador (Root)** abre una fase y descompone tareas por dominio.
2. Cada tarea se ejecuta leyendo primero el `CLAUDE.md` del dominio + las
   `.agents/skills/` relevantes (Prisma, NestJS, Zod, Turborepo, Vitest…).
3. Tareas independientes de fases distintas pueden correr en **paralelo** como
   subagentes; dentro de una fase se respeta el orden de dependencias.
4. El **agente Testing** participa en TODAS las fases (no es una fase final).

### Skills de apoyo ya disponibles (`.agents/skills/`)
`prisma-cli`, `prisma-client-api`, `prisma-database-setup`, `prisma-postgres`,
`turborepo`, `typescript-advanced-types`, `zod`, `nodejs-backend-patterns`,
`nodejs-best-practices`, `vitest`. (Las de UI —Next/React/Tailwind/Playwright—
se incorporarán al llegar a las fases 9–10.)

---

## 2. Mapa de requerimientos → fases

| Req | Descripción | Fase principal |
|-----|-------------|----------------|
| RF-01 | Multi-tenant | F1, F2, F3 |
| RF-02 | Usuarios | F3 |
| RF-03 | Roles y permisos (RBAC) | F2, F3 |
| RF-04 | Clientes | F4 |
| RF-05 | Créditos / mora | F4 |
| RF-06 | Casos de cobranza | F5 |
| RF-07 | Rutas | F6 |
| RF-08 | Visitas en campo + evidencia | F6 |
| RF-09 | Pagos | F7 |
| RF-10 | Reportes y analítica | F11 |
| RNF-01 | Seguridad | F2, F12 |
| RNF-02 | Escalabilidad | F1, F12 |
| RNF-03 | Disponibilidad | F12 |
| RNF-04 | Rendimiento | F1, F11, F12 |
| RNF-05 | Usabilidad | F9, F10 |
| CU-01 | Autenticación | F2 |
| CU-02 | Gestión de clientes | F4 |
| CU-03 | Asignación de casos | F5 |
| CU-04 | Ejecución de ruta | F6, F10 |
| CU-05 | Registro de pago | F7 |

---

## FASE 0 — Fundación  ✅ COMPLETADA

**Objetivo:** monorepo operativo + base de datos de Pilares 1 y 2 + paquete shared.

- **Database:** `schema.prisma` (Pilar 1+2, 19 modelos), `seed.ts`, RLS `001_enable_rls.sql`, cliente `withTenant()`.
- **Shared:** enums, DTOs `{data,meta,error}`, `CASE_TRANSITIONS`, `ROLE_PERMISSIONS`, utils (sha256, currency, fechas).
- **Root:** `package.json`, `turbo.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.env.example`.

**DoD:** `prisma validate` ✅ · estructura del monorepo en su sitio · agentes ubicados.

---

## FASE 1 — Núcleo de datos completo + Infra de desarrollo

**Cubre:** RF-01 (base), RF-06/07/08/09 (modelo), RNF-02/04 (índices/escala).

| Agente | Tarea |
|--------|-------|
| **Database** | Modelar **Pilar 3** (`collection_case`, `case_activity`, `route_plan`, `route_stop`, `field_visit`, `field_evidence`) y **Pilar 4** (`payment`, `payment_request`). Transversales: `notification`, `file_integrity`. Índices por `account_id`/`status`. |
| **Shared** | Enums/tipos de casos, rutas, evidencia y pagos; `RouteStatus`, `VisitOutcome`, `PaymentMethod`, `PaymentRequestStatus`. |
| **Root** | `docker-compose.yml` (PostgreSQL 15 + Redis 7), rol `kobrax_app` sin BYPASSRLS, `.env`. |
| **Database** | Primera migración real + aplicar RLS a las nuevas tablas + extender seed. |
| **Testing** | `rls.spec` (aislamiento entre tenants A/B con DB real vía testcontainers). |

**Entregables:** schema completo de 4 pilares migrado, RLS activa en todas las tablas operativas, infra local levantable con `docker compose up`.
**DoD:** `pnpm db:migrate && pnpm db:seed` corre en limpio · test de aislamiento multi-tenant en verde.

---

## FASE 2 — Bootstrap Backend + Autenticación y Multi-tenant (CU-01)

> **Dividida en dos epics:** [F2a](./epics/EPIC-F2a-nucleo-auth.md) (núcleo de auth — desbloquea F3)
> y [F2b](./epics/EPIC-F2b-gestion-cuenta.md) (reset, sesiones, MFA setup, biometría, offline).
> El detalle ejecutable vive en esos epics; esta sección queda como resumen macro.

**Cubre:** CU-01, RF-01, RF-03 (guards), RNF-01.

| Agente | Tarea |
|--------|-------|
| **API** | Esqueleto NestJS (`main.ts`, `ConfigModule`, `PrismaModule`, `common/` interceptors/filters/pipes), `TransformInterceptor` (contrato `{data,meta,error}`), `GlobalExceptionFilter`. |
| **Security** | `auth.module`: login (bcrypt wf 12), JWT access 15m + refresh 7d rotatorio, MFA opcional, `refresh_tokens`. `JwtAuthGuard`, `RolesGuard`, `@Roles()`, `@CurrentUser()`. |
| **Security** | `TenantMiddleware` (setea `app.current_account_id` para RLS) + `TenantGuard`. `AuditInterceptor` (append-only). `helmet`, `@nestjs/throttler` (Redis). |
| **Shared** | `JwtPayload`, `AuthUser`, DTOs de login/refresh. |
| **Testing** | `AuthService` specs (tokens, lockout tras 5 intentos, rotación, logout) + integración `/auth/login`. |

**Entregables:** API booteable, login funcional contra el tenant demo, stack de guards reutilizable.
**DoD:** `owner@kobrax.demo` obtiene tokens · request sin tenant rechazado · cobertura auth ≥ 90%.

---

## FASE 3 — Identidad y Organización (RF-01/02/03)

> ⏭️ **Re-secuenciada (2026-06-18): DIFERIDA AL FINAL DEL PROYECTO.** Por decisión de producto se adelanta
> **F4 (Core Financiero)** y la administración de tenants/usuarios/**roles y permisos** se ejecuta al cierre.
> El *enforcement* RBAC ya está sembrado y operativo desde F2 (no bloquea a F4–F7). Epic: [F4](./epics/EPIC-F4-core-financiero.md).

**Cubre:** RF-01 (gestión de tenants), RF-02 (usuarios), RF-03 (RBAC completo).

| Agente | Tarea |
|--------|-------|
| **API** | Módulos `tenants` (accounts, planes, límites), `branches`, `users` (invitar/activar/bloquear), `roles`/`permissions`. |
| **Security** | Resolución de permisos efectivos = `ROLE_PERMISSIONS` + `user_permission_override` (con expiración). Cambio de tenant activo. |
| **Shared** | DTOs Create/Update/Response por entidad. |
| **Testing** | Casos: usuario en múltiples cuentas, override temporal, suspensión propaga a todas las cuentas. |

**Entregables:** administración completa de organización y accesos.
**DoD:** un Admin gestiona usuarios/roles de SU tenant y nunca de otro (verificado por test).

---

## FASE 4 — Core Financiero: Clientes y Créditos (RF-04/05, CU-02)

> ⏭️ **Adelantada: es el próximo epic a ejecutar.** Detalle ejecutable + conformidad con el doc de arquitectura
> (Pilar 2) y mejoras de privacidad en [EPIC-F4](./epics/EPIC-F4-core-financiero.md).

**Cubre:** RF-04, RF-05, CU-02.

| Agente | Tarea |
|--------|-------|
| **API** | Módulo `clients` (+ contactos, ubicaciones, red de relaciones, adjuntos), segmentación de riesgo, unicidad por `account_id`. |
| **API** | Módulo `credits` (obligaciones, `credit_installment` cronograma, `arrear` mora, `days_past_due`). |
| **Database** | Índices de búsqueda (documento, riesgo), validación de cronogramas. |
| **Security** | Cifrado a nivel app (AES-256-GCM) de `national_id`/`phone`; tokenización en respuestas. |
| **Testing** | Cliente duplicado bloqueado, recálculo de mora, no cruce entre tenants. |

**Entregables:** CRUD de clientes y créditos con datos sensibles protegidos.
**DoD:** CU-02 end-to-end · datos sensibles nunca expuestos en claro en la API.

---

## FASE 5 — Casos de Cobranza (RF-06, CU-03)

**Cubre:** RF-06, CU-03.

| Agente | Tarea |
|--------|-------|
| **API** | Módulo `cases`: generación automática desde créditos en mora, asignación (manual/auto por menor carga), `case_activity`, prioridad por monto/días/riesgo. |
| **Shared** | Máquina de estados con `CASE_TRANSITIONS` (rechaza saltos → `CASE_002`). |
| **API** | Eventos de dominio (`case.assigned`, `case.updated`) para auditoría/notificaciones. |
| **Testing** | No cerrar caso sin gestión, transiciones inválidas, emisión de eventos, auditoría del cambio. |

**Entregables:** ciclo de vida del caso completo y trazable.
**DoD:** CU-03 end-to-end · transiciones de estado validadas y auditadas.

---

## FASE 6 — Rutas y Operación en Campo + Evidencia (RF-07/08, CU-04 backend)

**Cubre:** RF-07, RF-08, CU-04 (lado servidor).

| Agente | Tarea |
|--------|-------|
| **API** | Módulos `routes` (`route_plan`, `route_stop`, orden por prioridad) y `field-ops` (`field_visit`). |
| **Security** | Verificación de **hash SHA-256** de evidencia al persistir (rechaza si no coincide → `EVIDENCE_001`); inmutabilidad (sin update/delete). |
| **Database** | `field_evidence` append-only, `file_integrity`, GPS con precisión decimal. |
| **Testing** | Visita requiere GPS válido, hash verificado, evidencia no editable. |

**Entregables:** backend de rutas y registro de visitas con evidencia inmutable.
**DoD:** evidencia sellada y verificable · visitas inalterables (solo anulación auditada).

---

## FASE 7 — Pagos (RF-09, CU-05)

**Cubre:** RF-09, CU-05.

| Agente | Tarea |
|--------|-------|
| **API** | Módulo `payments`: registro tipo **ledger inmutable**, aplicación a crédito/cuota, recálculo de saldo y mora, `payment_request` (QR/link). |
| **Security** | Inmutabilidad del pago, anti-doble-contabilización (hash/referencia), auditoría completa. |
| **Shared** | `PaymentMethod`, validaciones de monto (no excede saldo, no negativo → `PAYMENT_001`). |
| **Testing** | Pago parcial, excedente rechazado, duplicado detectado, sin deuda activa bloqueado. |

**Entregables:** recaudo registrado de forma íntegra y conciliable.
**DoD:** CU-05 end-to-end · pagos no editables · saldo/mora consistentes.

---

## FASE 8 — Realtime y Notificaciones

**Cubre:** soporte a RF-06/07/10, RNF-05.

| Agente | Tarea |
|--------|-------|
| **API** | `WebSocketGateway` (Socket.io), rooms `tenant:{accountId}` / `user:{userId}`, eventos `case.updated`, `payment.registered`, `collector.location`, `route.completed`. |
| **API** | Módulo `notifications` (persistencia + push/SMS/email stubs). |
| **Testing** | Aislamiento de rooms por tenant, reconexión con backoff. |

**Entregables:** canal de supervisión en tiempo real.
**DoD:** eventos llegan solo al tenant correcto.

---

## FASE 9 — Panel Web (RF-10, RNF-05)

**Cubre:** RF-10, RNF-05 (supervisores/gerencia).

| Agente | Tarea |
|--------|-------|
| **Web** | App Next.js 14: `(auth)/login`, layout dashboard, design system Kobrax (tokens `k-*`, Inter), shadcn/ui. |
| **Web** | Páginas: dashboard KPIs, casos (lista/detalle), `CollectorMap` realtime, rutas, pagos, analítica, settings (users/roles/account). |
| **Web** | `usePermissions` (RBAC en UI), `useRealtime`, `useTenant`, cliente API tipado desde `shared`. |
| **Testing** | Vitest (hooks/utils) + Playwright (login → dashboard, supervisión). |

**Entregables:** panel operativo para gerencia/supervisión.
**DoD:** dashboards en vivo · UI respeta permisos · E2E de login en verde.

---

## FASE 10 — App Mobile (CU-04 campo, offline-first, RNF-05)

**Cubre:** CU-04 (cobrador), RNF-05.

| Agente | Tarea |
|--------|-------|
| **Mobile** | Expo SDK 51 + NativeWind, navegación, `SecureStore` para tokens, biometría. |
| **Mobile** | **Offline-first**: WatermelonDB local, `SyncService` (cola FIFO, retry backoff, last-write-wins), `OfflineIndicator`. |
| **Mobile** | Captura de evidencia (foto≤800KB + SHA-256 del original + GPS + firma), ejecución de ruta, registro de pago en campo. |
| **Testing** | Jest/RNTL + Detox (registrar visita con foto+GPS offline → sync). |

**Entregables:** app del cobrador funcional sin conexión.
**DoD:** acción del cobrador nunca se bloquea por red · evidencia sincroniza y valida hash en servidor.

---

## FASE 11 — Analítica y Reportes (RF-10, RNF-04)

**Cubre:** RF-10, RNF-04.

| Agente | Tarea |
|--------|-------|
| **Database** | Vistas materializadas (`mv_daily_recovery`, productividad por usuario/sucursal), refresco por cron. |
| **API** | Endpoints de KPIs (recuperación, productividad, efectividad por sucursal, mora segmentada, tiempos de gestión), export. |
| **Web** | Reportes ejecutivos (Recharts), exportación. |
| **Testing** | Exactitud de KPIs vs datos seed conocidos. |

**Entregables:** analítica ejecutiva y reportes exportables.
**DoD:** KPIs consistentes y performantes (< 300ms en consultas críticas con índices/MV).

---

## FASE 12 — Hardening, Seguridad y Cumplimiento (RNF-01/02/03/04)

**Cubre:** RNF-01, RNF-02, RNF-03, RNF-04.

| Agente | Tarea |
|--------|-------|
| **Security** | Revisión de seguridad (checklist por endpoint), AES-256 reposo, TLS 1.3, MFA obligatorio en roles críticos, `tenant_encryption_key`/BYOK, `security_event`/`access_log`/`data_access_log`. |
| **Root** | CI/CD (lint → type-check → unit → integration → E2E), `docker-compose.prod`, backups cifrados, observabilidad, disaster recovery. |
| **Testing** | Suite E2E de los 5 flujos críticos completa + umbrales de cobertura globales. |

**Entregables:** plataforma endurecida y desplegable.
**DoD:** checklist de seguridad por endpoint al 100% · pipeline CI en verde · E2E de flujos críticos pasando.

---

## 3. Dependencias entre fases

```
F0 ✅ ─► F1 ─► F2 ─► F3 ─► F4 ─► F5 ─► F6 ─► F7 ─► F8
                                              │
                          F9 (web) ◄──────────┤  (consumen API + realtime)
                          F10 (mobile) ◄──────┘
                          F11 (analítica) ◄── requiere F4–F7
                          F12 (hardening) ◄── transversal, cierra el ciclo
```

- **Ruta crítica backend:** F1 → F2 → F3 → F4 → F5 → F6 → F7.
- **F9 y F10** pueden iniciar en paralelo apenas la API expone contratos estables (tras F5/F6), consumiendo `@kobrax/shared`.
- **Testing** y **auditoría** son transversales a todas las fases.

## 4. Principios que toda fase debe respetar (del agente raíz)
1. `account_id` en toda entidad operativa. 2. RLS activa. 3. Audit trail en cada
mutación. 4. Mobile offline-capable. 5. Evidencia inmutable (SHA-256). 6. TS
estricto, sin `any`. 7. Respuestas `{data, meta, error}`.
