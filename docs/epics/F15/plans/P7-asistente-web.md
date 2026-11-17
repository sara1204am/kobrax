> ESTADO: EN EJECUCIÓN (2026-11-14) — G4 aprobado por la orden de la usuaria «continúa hasta terminar en P10».

# Plan P7 · Asistente de configuración del administrador (web)

## 1. Objetivo
El asistente de 8 pasos (D-11) para quien administra una cuenta **nueva**, que escribe el espacio de trabajo y resuelve el asistente en **una sola llamada**, más el enlace «Revisar con el asistente» en Cuenta.

## 2. Rama
`f15/p7-asistente-web`, desde `f15/p6-onboarding-servidor`.

## 3. Estado inicial con evidencia (releído hoy, 2026-11-14)
| # | Hecho | Evidencia |
|---|---|---|
| E-1 | El layout del panel ya carga `/auth/me` y, si hay `ACCOUNT_WRITE`, la cuenta (`getAccount`). Ahí se monta el asistente. | `app/(panel)/layout.tsx:29-32,68` |
| E-2 | `me.account.onboarding.status` ya viaja desde P6 (`AccountBrand.onboarding`). | `packages/shared/src/types/user.types.ts:75` |
| E-3 | El editor de P4 guarda con `sendJson('/api/account/me', {workspace:{version,rev,…}}, 'PATCH')` y distingue el error por `error.code`. | `cuenta/espacio-de-trabajo/workspace-editor.tsx:164-198` |
| E-4 | El BFF `PATCH /api/account/me` reenvía el cuerpo tal cual; `AccountPatch` no declaraba `onboarding`. | `app/api/account/me/route.ts`; `account.types.ts:86` |
| E-5 | No hay modal a pantalla completa; el `Modal` existente es de 460/880 px. | `components/modal.tsx:143` |
| E-6 | El registro entra por login y `routeByStep` lleva a `/dashboard` tras MFA; el administrador pasa por MFA antes de ver el panel. | `lib/client.ts:99-117` |
| E-7 | `recommendSetup` y los presets existen en `shared` (P5, P4). | `utils/recommend-setup.ts`, `utils/workspace.ts` |

## 4. Alcance
**Dentro:** `lib/onboarding-wizard.ts` (lógica pura: borrador, salvaguardas, `saveBody`, `SKIP_BODY`); `components/onboarding-wizard.tsx` (8 pasos, pantalla completa, atajo permanente, Atrás, pasos 2–5 omitibles, X/Esc = «Hacerlo después»); montaje en el layout solo con `account && status === 'pending'`; `OnboardingLauncher` en Cuenta › Espacio de trabajo; textos es/en (`onboarding.*`); `onboarding` en `AccountPatch`.
**Fuera:** recorrido con spotlight y su oferta al terminar (P9); bienvenida de invitados y «primeros pasos» (P8); móvil.

## 5. Dependencias
D-11, D-12, D-14 aprobadas; P4 (presets), P5 (`recommendSetup`), P6 (estado en servidor).

## 6. Archivos afectados (HUB)
H15-029 (destino tras el alta; sin cambio de `routeByStep`: el asistente se monta en el panel, después de MFA), H15-016 (layout del panel), H15-018 (pestaña de Cuenta), H15-024 (mensajes es/en), H15-003 (`AccountPatch`).

## 7. Invariantes
R1/R2 (ocultar no es autorizar), D-14 (solo `account:write`, después de MFA, una vez, solo cuentas nuevas; las existentes no reciben nada obligatorio), «nada se escribe hasta el paso 7», nunca bloquea el acceso (la X siempre sale).

## 8. Perfiles de tenant
- **Gratuito individual:** recibe el asistente solo si la cuenta es nueva; la recomendación es «Independiente». Una cuenta existente no cambia. Regresión R-1 (12 flujos) con el workspace vacío y con el preset «Independiente»: ver el registro de verificación.
- **Invitado:** no tiene `account:write`, no lo ve.

## 9. Riesgos
1. Que el asistente tape a una cuenta que ya usa la app → solo `pending` (cuentas nuevas) y nunca sin estado.
2. Que oculte algo que el servidor rechaza → las salvaguardas se calculan con el uso real (`blockedModules`) y se deshabilitan; el error del servidor se explica sin avanzar.
3. Caché de webpack de la web con una copia vieja de `shared` → la verificación real reconstruye `.next` desde cero.

## 10. Pruebas
`onboarding-wizard.test.ts` (lógica), `onboarding-wizard.test.tsx` (20 casos del componente), paridad es/en (`i18n/messages.test.ts`), verificación real `p7-web-wizard.real.ts` (API + `next start`).

## 11. Rollback
Sin migración. Quitar el montaje del layout devuelve el panel a su estado anterior; el estado `pending` en la base es inocuo.

## 12. Tareas
shared (`AccountPatch`) → lógica pura → componente → textos → montaje → launcher → pruebas.

## 13. Criterios de cierre
G5 con salidas pegadas; R-1; G6 `/code-review`; G7 documentos.
