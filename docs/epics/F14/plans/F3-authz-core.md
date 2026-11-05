> ESTADO: BORRADOR (2026-11-05) — pendiente `validar` (G4) y aprobación de D-1…D-5

# Plan F3 · Arquitectura central de autorización

> Fase 3 del plan maestro (`ROLES-PERMISOS-PLAN.md` §E). Por el orden aprobado **F1 → F3 → F2**, esta fase va antes de «Modelo organizacional» (F2): las políticas de F2 (`client.create`, `credit.assign`, `member.invite`…) se escriben sobre lo que construye F3. La usuaria lo confirmó el 2026-11-05.

## 1. Objetivo
Que **cada** endpoint declare su contrato de acceso en un solo lugar y que la API **niegue por defecto** lo que no lo declara, con una prueba que lo verifique y un snapshot aprobado de todas las puertas; y que las decisiones contextuales (para quién, sobre qué fila) pasen por un único servicio de autorización en vez de `tenant.can` repartido por 13 archivos. Sin cambiar quién puede qué: es un cambio de estructura, no de permisos (salvo las 5 puertas «sólo en el servicio» de R-05).

## 2. Rama
`f14/p3-authz-core`, desde `f14/p1-sesiones-aislamiento` (F1 aún no está en `main`; no hay push/PR hasta que la usuaria lo pida).

## 3. Estado inicial con evidencia (releído 2026-11-05)

| # | Hallazgo | Evidencia | Clase |
|---|---|---|---|
| E1 | Los guards globales son sólo `RateLimitGuard` y `AppVersionGuard`. **No hay `AuthzGuard` ni deny-by-default**: la autenticación y los permisos se ponen **por controlador** con `@UseGuards`. | `apps/api/src/app.module.ts:76-77` (único `APP_GUARD`) | VERIFICADO |
| E2 | Dos formas de proteger: 30 controladores con `JwtAuthGuard + TenantGuard + RolesGuard` y 11 sólo con `JwtAuthGuard`. Ninguno usa un metadato propio de «público». | `grep @UseGuards` en `modules/**/*.controller.ts` (30 + 11) | VERIFICADO |
| E3 | `RolesGuard` **deja pasar** a todo handler sin `@Roles` (devuelve `true` si no hay metadatos). Un endpoint nuevo olvidado queda abierto a cualquier sesión del tenant. | `auth/guards/roles.guard.ts:26-27` | VERIFICADO |
| E4 | Aproximadamente **199 decoradores HTTP** en `modules/` (+ `health/health.controller.ts`); el plan maestro decía 202. De ellos, 154 `@Roles/@RolesAny` y unos 17 handlers autenticados **sin** permiso (perfil propio, MFA, sesiones, notificaciones, `GET /uploads/:name`) y los públicos de `auth`/`accounts`. El conteo exacto lo fija la prueba de cobertura (tarea 1), no este documento. | script de conteo de la sesión + `auth.controller.ts`, `notifications.controller.ts`, `users.controller.ts`, `uploads.controller.ts` | INFERIDO (aproximado) |
| E5 | Cinco puertas viven **sólo en el servicio**, con una puerta mínima `route:read` en el controlador: `POST /routes`, `/routes/generate`, `/routes/plan-preview`, `/routes/leg`; la decisión real está en `collectorFor` (`routes.service.ts:186-187`) y `:1101/:1118`. Lo mismo con `agenda:assign` (`agenda.service.ts:189,250,401`), `credit:write` + alcance amplio para castigar (`credits.service.ts:745-746`) y `dashboard:write` (`dashboards.service.ts:54,70` usa `account:write`). | archivos citados | VERIFICADO |
| E6 | **34 usos de `tenant.can(...)`** en 13 archivos fuera de `auth` (agenda, assignments, clients, credits, dashboards, field-ops, imports, mora, routes, users, office-scope). Sin punto único de decisión. | `grep tenant.can` | VERIFICADO |
| E7 | `permission-gates.spec.ts` (299 líneas) prueba **a mano** 14 controladores del camino del cobrador; no enumera el resto ni detecta un handler sin metadato. | `modules/permission-gates.spec.ts:1-30` | VERIFICADO |
| E8 | `auth/CLAUDE.md` describe un RBAC que ya no es el real (N-09): documenta `@UseGuards(JwtAuthGuard, RolesGuard)`, scopes `global` y un checklist de guards por controlador. | `auth/CLAUDE.md:40-93,187` | VERIFICADO (a corregir) |
| E9 | **Orden de guards:** los `APP_GUARD` globales corren **antes** que los de controlador. Un `AuthzGuard` global necesita `req.user`, que hoy pone el `JwtAuthGuard` de controlador ⇒ para que funcione hay que subir **también `JwtAuthGuard` y `TenantGuard`** a globales (con `@Public` para las rutas sin sesión). | semántica de Nest + E1/E2 | INFERIDO (se prueba en la tarea 4) |
| E10 | F1 dejó dos interinos que F3 reemplaza: `@RolesAny` (`roles.decorator.ts:14-22`, `roles.guard.ts`) y las comprobaciones propias de `UploadAccessService`. | `auth/decorators/roles.decorator.ts`, `uploads/upload-access.service.ts` | VERIFICADO |

Hallazgos del plan maestro que resuelve: **R-05, N-08 (API), N-09, N-13**.

## 4. Alcance / fuera de alcance

**Dentro**
- Metadato único de acceso por handler (público · autenticado · permisos «todos/alguno» · política · destructivo); `@Roles` y `@RolesAny` quedan como alias.
- `AuthzGuard` global con **negación por defecto**, tras subir `JwtAuthGuard` y `TenantGuard` a globales.
- `AuthorizationService` (una API: `can`, `canAny`, `assert`, alcance, política por nombre) + `PolicyService` + `FactsLoader` en `common/authz/`. Las políticas son funciones puras.
- Migrar los 34 `tenant.can` a `AuthorizationService` (mecánico; mismo comportamiento).
- Declarar en el guard las puertas de R-05 (rutas, agenda, castigo, dashboards) sin cambiar quién puede qué.
- Prueba de cobertura total + snapshot aprobado de las puertas; regla contra ids del actor en DTOs (N-13).
- Corregir `auth/CLAUDE.md` (N-09).
- Interruptor `AUTHZ_DENY_BY_DEFAULT` (`log` · `enforce`), para desplegar primero en modo registro.

**Fuera**
- Cualquier política concreta de negocio (`client.create`, `credit.assign`, `member.invite`, `role.editPermissions`): llegan en F2 y F7 sobre esta base. F3 sólo trae la **infraestructura** y una política de ejemplo ya existente (`credit.writeOff`) para probarla.
- Cambios de modelo de datos, RLS, roles por tenant (F5), PII (F4), web de navegación (F6), móvil (F8).
- Exigir confirmación a los endpoints destructivos (ver D-2): en F3 sólo se **marcan**.

## 5. Dependencias
- F1 cerrada (G7 PASS 2026-11-05): `av/pv`, `AUTHZ_STALE`, `@RolesAny`.
- Decisiones aprobadas que sustentan: **H-2** (permisos en el JWT), **H-3/H-13** (sólo contexto, no se implementan aquí), ADR-F14-03 (decoradores y deny-by-default, `ROLES-PERMISOS-PLAN.md` §C.2). Las decisiones **propias de esta fase** (D-1…D-5, §9) están en **PROPUESTA**: sin su aprobación el plan no pasa G4.
- Gates: G0–G3 PASS, G4 de F1 y G5–G7 de F1 PASS.

## 6. Archivos afectados (HUB consultado; entradas nuevas H14-019…H14-024 a crear en el HUB)

| Archivo / zona | HUB | Cambio |
|---|---|---|
| `app.module.ts:76-77` | nuevo H14-019 | Registrar `JwtAuthGuard`, `TenantGuard` y `AuthzGuard` como globales, en ese orden, tras `RateLimit` y `AppVersion` |
| `auth/guards/jwt-auth.guard.ts` | H14-005 | Respetar `@Public`; sin cambios de lógica de versiones |
| `auth/guards/roles.guard.ts`, `decorators/roles.decorator.ts` | H14-006 | `RolesGuard` se retira (lo reemplaza `AuthzGuard`); `@Roles`/`@RolesAny` pasan a alias del metadato nuevo |
| `auth/decorators/authz.decorator.ts` (nuevo), `auth/guards/authz.guard.ts` (nuevo) | nuevo H14-020 | Metadato y guard con modo `log`/`enforce` |
| `common/authz/*` (nuevo: servicio, políticas, cargador de hechos, módulo) | nuevo H14-021 | `AuthorizationService`, `PolicyService`, `FactsLoader` |
| 41 controladores en `modules/**` + `health/` | nuevo H14-022 | Quitar `@UseGuards` por controlador; añadir el metadato donde falte (≈17 autenticados, públicos de `auth`/`accounts`/`health`) |
| 13 archivos con `tenant.can` (E6) | H14-009/012/013 y entradas de F13 (agenda, rutas, créditos) | Sustituir por `AuthorizationService`, mismo comportamiento |
| `routes.controller.ts`, `agenda.controller.ts`, `credits.controller.ts`, `dashboards.controller.ts` | nuevo H14-023 | Declarar la puerta real (R-05) |
| `permission-gates.spec.ts`; nuevo `authz-coverage.spec.ts`; `docs/epics/F14/authz-snapshot.json` | nuevo H14-024 | Cobertura total y snapshot |
| `apps/api/package.json` (`test`), `config/env.validation.ts`, `app-config.service.ts` | H14-015 | Registrar specs nuevos; `AUTHZ_DENY_BY_DEFAULT` |
| `uploads/upload-access.service.ts` | H14-014 | Su comprobación de «puedo subir» pasa a `@Authz({ any })`; el resto no cambia |
| `auth/CLAUDE.md` | — | Reescribir la sección RBAC (N-09) |

IMPACT-MAP a ampliar: **cambiar quién registra los guards ⇒ todos los controladores, `common/health`, `main.ts` (versionado), webhooks/puntos públicos, pruebas de integración que levantan la app**.

## 7. Invariantes que aplican
RULES F14-A: **H-2** (el guard sigue verificando `av/pv` y revocación; no se toca), **H-11** (el SUPER_ADMIN de plataforma no se crea ni edita por ninguna ruta: el snapshot lo vigila). F14-B: rama por fase; spec nuevo registrado en el script `test` (B12); sin código de producto antes del PASS de G4. F13/RULES heredadas: multi-tenant primero (el contexto del tenant sigue siendo `TenantGuard`), auditoría de mutaciones (el cambio de guard no altera quién audita), sin `any`.

## 8. Perfiles de tenant afectados y cómo se protege el individual/gratuito
- **Cuenta gratuita individual** (un solo usuario, `ACCOUNT_ADMIN` con todos los permisos): no cambia nada visible. El riesgo propio de F3 es que **negar por defecto** deje sin acceso a un endpoint que el individual usa y que no se declaró. Protección: (1) la prueba de cobertura falla si algún handler no tiene metadato; (2) el modo `log` primero; (3) **regresión del gratuito individual**: la suite de integración `authz-versions.it.ts` + `office-scope.it.ts` R-1 (alta de cuenta individual, login, crear cliente/crédito, pagar) más una corrida nueva «recorrido del individual» que llama a una muestra de cada módulo y exige 2xx.
- **Tenants con oficinas (banco)**: sin cambio de permisos; los 34 `tenant.can` migrados conservan su resultado (se prueba con los specs de servicio existentes).
- **Soporte/SUPER_ADMIN**: sin cambio.

## 9. Riesgos y decisiones propias (todas en PROPUESTA hasta que la usuaria apruebe)

| ID | Riesgo / decisión | Propuesta |
|---|---|---|
| R1 | Un handler sin declarar queda en 403 en producción. | Prueba de cobertura obligatoria + modo `log` en el primer despliegue. |
| R2 | Orden de guards (E9): subir Jwt y Tenant a globales cambia cuándo corren respecto a `RateLimit`/`AppVersion` y a `@UseGuards` que sobrevivan. | Retirar **todos** los `@UseGuards` de controlador en la misma fase; probarlo con la integración completa. |
| R3 | Rutas públicas mal marcadas (`auth`, `accounts`, `health`, devices push). | Lista cerrada de públicos en el snapshot; revisión de la usuaria. |
| R4 | Migrar 34 `tenant.can` introduce un cambio de comportamiento sutil. | Mecánico, un commit por módulo, specs de servicio sin cambios de aserción. |
| R5 | El snapshot se desactualiza y la gente lo regenera sin mirar. | El snapshot se compara en CI; cambiar una puerta exige cambiar el archivo en el mismo commit. |
| **D-1** | Alcance del modo `log`: ¿se mantiene la bandera tras F3? | `AUTHZ_DENY_BY_DEFAULT=enforce` por defecto en el código; `log` sólo como válvula de rollback un release, luego se elimina. |
| **D-2** | `@Destructive()` ¿exige confirmación ya en F3? | **No**: sólo marca y sube el riesgo de la auditoría a ALTO. Exigir `x-confirm`/`{confirm:true}` cambiaría los contratos con web y móvil; se hace en F6/F8 junto con la UI. Marcados: castigo de crédito, reemplazo de importación, y los que F2 añada. |
| **D-3** | ¿`RolesGuard` se borra o queda como alias? | Se borra; `@Roles`/`@RolesAny` quedan como decoradores-alias (los 154 usos no se reescriben de golpe). |
| **D-4** | Dónde vive el snapshot. | `docs/epics/F14/authz-snapshot.json`, aprobado por la usuaria en G5. |
| **D-5** | ¿Se cambia el permiso de alguna puerta de R-05? | **No**: se declara la puerta que ya existe en el servicio (p. ej. `POST /routes`: «alguno de `route:execute`, `route:write`, `route:assign`»). La puerta mínima `route:read` actual se sustituye por esa; cualquier endurecimiento queda para F2/F6. |

## 10. Pruebas
- **Existentes que deben seguir verdes:** las 1896 unitarias de la API, `permission-gates.spec.ts`, `jwt-auth.guard.spec.ts`, `uploads.access.spec.ts` (usa `RolesGuard` → se adapta), la integración completa (178), web 1244, móvil 979.
- **Nuevas:**
  1. `authz-coverage.spec.ts`: enumera con el descubrimiento de Nest todos los handlers del `AppModule`; afirma metadato único por handler y compara con el snapshot.
  2. `authz.guard.spec.ts`: sin metadato ⇒ 403 `AUTHZ_000` (modo `enforce`) o pasa registrando (modo `log`); `public`, `authenticated`, `all`, `any`, `all+any`.
  3. `authorization.service.spec.ts` y `policy.service.spec.ts`: `can/canAny/assert`, política allow/deny, `FactsLoader` acotado al tenant.
  4. Specs de equivalencia de los servicios migrados (los existentes, sin cambiar aserciones).
  5. Integración `authz-coverage.it.ts`: levanta la API real y verifica 401 sin token, 403 sin permiso y 2xx con permiso en una muestra de cada módulo + el «recorrido del individual».
  6. Lint/prueba N-13: ningún DTO de entrada acepta `accountId`/`userId` del actor (lista blanca explícita).
- **Registro (B12):** los cinco specs unitarios y el `.it.ts` se añaden al script `test` y a `test:integration` de `apps/api/package.json`.
- Una corrida de integración **sola** (no en paralelo con otras suites que usen la misma DB/Redis).

## 11. Rollback
- Sin migraciones ni cambios de datos: nada irreversible.
- Interruptor `AUTHZ_DENY_BY_DEFAULT=log` vuelve a «sin metadato = pasa, con aviso en el log» durante un release.
- Volver atrás en código: los alias `@Roles/@RolesAny` mantienen los 154 usos; revertir el commit restituye los `@UseGuards` por controlador.
- Cada módulo migrado de `tenant.can` va en su propio commit para revertirse por separado.

## 12. Tareas ordenadas (datos → API → web → móvil)
**Datos:** ninguna.

**API**
1. Prueba de descubrimiento (sólo lectura): enumerar los handlers, fijar el conteo real y la lista de públicos/autenticados; volcarla al primer borrador del snapshot.
2. Decoradores nuevos y alias de `@Roles`/`@RolesAny`; `AuthzGuard` con modo `log`/`enforce` y su spec; variable `AUTHZ_DENY_BY_DEFAULT`.
3. `common/authz/`: `AuthorizationService`, `PolicyService`, `FactsLoader`, módulo; specs.
4. Subir `JwtAuthGuard`, `TenantGuard` y `AuthzGuard` a globales (orden explícito) respetando `@Public`; **retirar todos los `@UseGuards` de controlador**; correr unitarias e integración.
5. Marcar públicos y autenticados; declarar las puertas de R-05 (D-5) y marcar los destructivos (D-2).
6. Migrar los `tenant.can` a `AuthorizationService`, un módulo por commit.
7. Regla N-13 (ids del actor en DTOs) y su prueba.
8. `authz-coverage.spec.ts` + snapshot; adaptar `permission-gates.spec.ts` y `uploads.access.spec.ts`; registrar specs en `package.json`.
9. Reescribir `auth/CLAUDE.md` (N-09) y crear las entradas H14-019…024 en el HUB y el IMPACT-MAP.

**Web:** sin cambios de código; correr la suite completa (los contratos 401/403 no cambian).
**Móvil:** sin cambios de código; correr la suite completa.

## 13. Criterios de cierre (evidencia exigida)
- **G5:** salida pegada en `execution/VERIFICATIONS.md` de: unitarias de la API; `authz-coverage.spec.ts` (100 % de handlers con contrato); snapshot generado y **aprobado por la usuaria**; integración completa **sola**; web y móvil; `tsc` en api/web/database/mobile; regresión del gratuito individual; `grep tenant.can` fuera de `common/authz` = sólo la lista blanca justificada.
- **G6:** `/code-review` del diff y recorrido del IMPACT-MAP por cada entrada HUB tocada.
- **G7:** HUB, STATUS, HANDOFF, VERIFICATIONS y los docs de producto (`docs/producto/roles-permisos-planes.md` §guards) actualizados; **no** se abre F2 sin orden de la usuaria.
