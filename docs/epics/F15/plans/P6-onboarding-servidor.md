> ESTADO: EN EJECUCIÓN (2026-11-14) — G4 aprobado por la orden de la usuaria «continúa hasta terminar en P10» (incluye la migración y el cambio del snapshot de puertas, consecuencia de D-13 y D-17, ya aprobadas).

# Plan P6 · Estado del onboarding en el servidor

## 1. Objetivo
Guardar en el servidor (a) si el asistente de configuración de la organización está pendiente, hecho u omitido y (b) qué guías vio cada persona en cada organización. Sin pantallas.

## 2. Rama
`f15/p6-onboarding-servidor`, desde `f15/p5-catalogo-guias`.

## 3. Estado inicial con evidencia (releído hoy, 2026-11-14)
| # | Hecho | Evidencia |
|---|---|---|
| E-1 | La cuenta nace en `AccountsService.create` sin `configuration` explícito (H15-026). | `accounts.service.ts` creación de cuenta, `tx.account.create` |
| E-2 | `update()` ya bloquea la fila (`FOR UPDATE`) y mezcla `configuration` para preferencias, facturación y workspace; ahí entra `onboarding`. | `accounts.service.ts:193-226` |
| E-3 | `/accounts/me` serializa con una lista blanca; `/auth/me` entrega `account.{…, workspace}` en dos sitios. | `accounts.serializer.ts:65`; `auth.service.ts:447,502` |
| E-4 | Hay un precedente de tabla por persona: `dashboards.owner_user_id` (ref suave), con su RLS por cuenta en la lista operativa. | `schema.prisma` modelo `Dashboard`; `rls/001_enable_rls.sql` lista `operational` |
| E-5 | Las rutas sin permiso usan `@Authenticated()` (perfil propio); el snapshot de puertas los registra con `kind: authenticated`. | `users.controller.ts` `me/profile`; `authz-coverage.spec.ts` |
| E-6 | `user_guide_states` no existe (H15-027, H15-028). | `schema.prisma`; `modules/users/` |

## 4. Alcance
**Dentro:** `shared/utils/onboarding.ts` (estado, resolución «el primero gana», validación estricta del estado de guías); `configuration.onboarding` (`pending` al crear la cuenta; `PATCH /accounts/me` acepta `onboarding {status: done|skipped, preset?}`; quién y cuándo los pone el servidor); `onboarding` en `/accounts/me` (completo) y en `/auth/me` (solo `status`); tabla `user_guide_states` (migración aditiva + RLS + política por cuenta); `GET/PUT /users/me/guides` (`@Authenticated`, la fila sale de la sesión).
**Fuera:** pantallas (P7–P10); móvil; sugerencias (D-15).

## 5. Dependencias
D-13, D-14, D-17 aprobadas; P1 (contrato `workspace`) y P5 construidos.

## 6. Archivos afectados (HUB)
H15-026 (creación de cuenta), H15-027 (tabla + migración), H15-028 (endpoint), H15-008/H15-010/H15-011/H15-012 (merge, DTO, serializador, `me`), H15-014 (snapshot de puertas: **+2 handlers**), H15-002 (política RLS, lista `operational`), H15-003 (tipo `AuthMe`).

## 7. Invariantes
R2 (la API no consulta el workspace), R3, R4 (nada en el JWT), D-14 (solo `account:write`, el primero gana, una sola escritura con `rev`), F15-B (migración aditiva y reversible; el snapshot cambia solo por la tabla nueva; `common/authz/*` y el JWT no se tocan).

## 8. Perfiles de tenant
- **Gratuito individual:** una cuenta existente no tiene estado (`null` = sin asistente) y no cambia nada; solo las cuentas nuevas nacen `pending`. Regresión R-1 se corre con las pantallas, en P7.
- **Multi-organización:** el estado de guías es por persona **y** organización (clave única `account_id + user_id`).

## 9. Riesgos
1. Pisar `workspace` al guardar `onboarding` → misma fila bloqueada y misma transacción; si el workspace falla (rev viejo) tampoco se resuelve el asistente (probado).
2. Que una persona lea el estado de otra → la clave sale de `tenant.userId`, nunca del cuerpo; RLS por cuenta (probado con la API real y con el rol sin `BYPASSRLS`).
3. Cuerpo enorme en `PUT` → topes de forma y de bytes antes de recorrer.
4. Auditoría: el estado de guías **no** se audita (estado de interfaz; un paso por clic inundaría la bitácora). La resolución del asistente sí, solo su subárbol.

## 10. Pruebas
`onboarding.spec.ts` (18), `accounts.service.spec.ts` (+7), `guides.service.spec.ts` (11, registrado en el script `test` de la API, B12), `auth.service.spec.ts` (+1), snapshot de puertas, integración real `f15-p6-onboarding.it.ts` (15) y regresión `f15-workspace.it.ts` + `authz-coverage.it.ts`.

## 11. Rollback
`DROP TABLE "user_guide_states"` (reversible, solo contiene estado de interfaz). `configuration.onboarding` es una clave del jsonb existente: ignorarla equivale a «sin asistente».

## 12. Tareas
Datos (migración, RLS) → shared → API (create, update, serializador, `me`, guías) → pruebas → snapshot. Web y móvil: sin tareas.

## 13. Criterios de cierre
G5 con salidas en `VERIFICATIONS.md`; G6 `/code-review`; G7 documentos al día; snapshot de puertas con **solo** dos puertas nuevas, ambas `authenticated`.
