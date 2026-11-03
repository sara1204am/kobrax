# F13 · RULES (guardrails)

> Se leen en cada sesión. **No inventan invariantes del producto**: cada regla cita su fuente.
> Las reglas de producto que Discovery descubra se agregan en §B con su evidencia. Lo que hoy es solo una idea va en §E (candidatos), no es regla.

## A · Reglas de proceso (de este arnés)
| ID | Regla |
|---|---|
| A1 | Orden estricto: arnés → discovery → arquitectura → roadmap → implementación. No se mezclan. Cada paso necesita su cierre y la autorización de la usuaria. |
| A2 | Una PROPUESTA de ADR no es una decisión. Solo la usuaria aprueba. |
| A3 | Todo hallazgo lleva clase de evidencia (`../_framework/README.md` §2). Un documento nunca da más que INFERIDO. |
| A4 | Antes de modificar algo transversal se consulta `hub/HUB.md` y se recorre `hub/IMPACT-MAP.md`. |
| A5 | Nada se marca exitoso sin salida comprobable en `execution/VERIFICATIONS.md`. |
| A6 | Si documento y código se contradicen: se registra CONTRADICTORIO y se resuelve antes de seguir. El código manda (`docs/producto/README.md`). |
| A7 | Planes de fase just-in-time, nunca por adelantado. Una fase = un plan = una rama `f13/<fase>-<nombre>`. |
| A8 | Si falta información, parar y preguntar. Las confirmaciones dentro de una fase siguen la regla de mínimo de preguntas de `.claude/rules/prompts-confirmation.md`; **las transiciones de gate son la excepción y siempre se confirman**. |

## B · Guardrails de producto (con fuente)
Clase de cada fila: V = VERIFICADO en sesión 2026-10-29 · D = declarado en documentación de reglas (CLAUDE.md), por tanto INFERIDO hasta contrastar con código en G1.

| ID | Área | Regla | Fuente | Clase |
|---|---|---|---|---|
| B1 | Multi-tenant | Toda entidad operativa lleva `account_id`; RLS activo en tablas operativas. | `CLAUDE.md` raíz, principios 1–2 | D |
| B2 | Multi-tenant | La ausencia de alcance en la base **niega** (fail-closed): no existe un valor «sin límite» por omisión. | `apps/api/src/database/prisma.service.ts:11-14,37`; `packages/database/prisma/rls/002_scope.sql:30-33` | V |
| B3 | Seguridad | Endpoints protegidos con `JwtAuthGuard` + `TenantGuard` + `RolesGuard` y permiso explícito. | `apps/api/CLAUDE.md` «Seguridad en cada endpoint» | D |
| B4 | Seguridad | El permiso se evalúa en servidor; la UI solo oculta. | `apps/web/src/lib/cuenta-tabs.ts:30-31` («Cosmética: la API valida siempre») y `alineacion-web/README.md` P-3 | V / D |
| B5 | Integridad | Toda mutación se audita (quién/cuándo/qué/ip). | `CLAUDE.md` raíz, principio 3; `branches.service.ts` llama a `audit.record` en create/update/remove/assign | D / V |
| B6 | Integridad | Evidencia de campo inmutable (hash SHA-256; sin `updatedAt`/`deletedAt`). | `CLAUDE.md` raíz, principio 5; `packages/database/CLAUDE.md` | D |
| B7 | Contratos API | Respuesta estándar `{ data, meta, error }`. | `CLAUDE.md` raíz, principio 7 | D |
| B8 | Migraciones | No se modifica una migración ya ejecutada; nombre descriptivo; cada tabla operativa nueva con su RLS; datos con script de verificación en `prisma/verify/`. | `packages/database/CLAUDE.md` «Reglas de Migraciones»; 4 scripts verify existen (listado 2026-10-29) | D / V |
| B9 | Sincronización | Móvil offline-first: toda mutación entra a cola con id fijado por el teléfono (idempotente); el servidor es la autoridad de permisos. | `alineacion-web/README.md` P-1, P-3; `CLAUDE.md` raíz principio 4 | D |
| B10 | Compatibilidad web/móvil | Una regla de dominio que web y móvil calculan vive en `packages/shared`. | `alineacion-web/README.md` P-4; `packages/shared/CLAUDE.md` | D |
| B11 | Calidad | TypeScript `strict`, sin `any`. | `CLAUDE.md` raíz, principio 6 | D |
| B12 | Calidad | **Un spec nuevo de la API no corre si no se agrega a mano al script `test`** de `apps/api/package.json` (lista archivo por archivo). Toda prueba nueva de F13 se registra ahí. | `apps/api/package.json` script `test` | V |
| B13 | Calidad | Si se toca `packages/shared`, reiniciar `dev` de la web y reconstruir `shared`. | `apps/web/CLAUDE.md` «Verificación» | D |
| B14 | Compatibilidad | Hoy el alcance por agencia (`data:scope:branch`) lo aplica el código de la aplicación (Mora, Agenda, Asignaciones); RLS solo distingue `account` y `own`. Un cambio de alcance debe revisar **todos** los consumidores (HUB-009…HUB-016). | `prisma.service.ts:93-97`; `mora-query.ts:127-152`; `002_scope.sql:45-50` | V |

## C · Requisito de tenants (viene de la usuaria, 2026-10-29)

> «Está bien ver cómo será para el tenant más grande, pero aun así el tenant gratuito individual debe poder trabajar tranquilo.»

| ID | Regla |
|---|---|
| C1 | **Perfiles de tenant** que toda fase debe considerar. Fuente de los topes: `docs/business/LIMITES-POR-PLAN.md:141-149` (grilla decidida 20/08/2026): FREE (1 usuario, 20 créditos, 1 sucursal), PROFESSIONAL, BUSINESS, ENTERPRISE. Fuente de los dos modos de uso: `alineacion-web/README.md` §1.1 («Independiente» y «De equipo»). La grilla es INFERIDA hasta contrastarla con `packages/shared/src/constants/plans.ts` en G1. |
| C2 | Un tenant gratuito/individual **no debe necesitar configurar nada nuevo**, no ve pantallas de jerarquía que no usa, no paga más por tenerlas y no cambia el comportamiento de lo que ya hace. |
| C3 | Cada plan de fase (T4 §8) declara qué perfiles afecta y cómo protege al gratuito individual. |
| C4 | G5 incluye una **regresión del perfil gratuito individual**. Su lista de flujos se define en G2 (`target/09`); hasta entonces no hay lista y G5 de cualquier fase queda BLOCKED. |
| C5 | La capacidad se decide por **permiso/capacidad**, no por tipo de tenant (`ramificar por tenantType` está marcado como deuda prohibida en `.claude/skills/f10-etapa/SKILL.md`, antipatrones). |

## D · Coordinación con trabajo en curso
| ID | Regla |
|---|---|
| D1 | Existe una **alineación móvil↔web en curso** (`../F10/plans/alineacion-web/README.md`, «ronda 3»). Antes de planear cualquier cambio de móvil en F13/F14: leer su estado y registrar el cruce en el plan. |
| D2 | La rama `feat/cuenta-refactor` trae cambios ajenos sin confirmar. El trabajo de F13 se confirma en ramas propias y nunca arrastra esos cambios. |
| D3 | El skill `epic-fase` no reemplaza a `f10-etapa`/`f10-validar-plan`: esos siguen siendo para el móvil F10. |

## E · Candidatos a invariante (NO son reglas hasta que Discovery/Arquitectura las confirmen y la usuaria las apruebe)
- Equivalencia con lo actual: lo que hoy hace `data:scope:all`, `data:scope:branch` y «sin alcance» debe seguir dando el mismo resultado en tenants sin jerarquía.
- Un solo punto de cálculo de alcance, en vez de comparaciones sueltas de `branch_id`.
- Migraciones solo aditivas dentro de F13.
- Cada crédito debe poder pertenecer a una única oficina hoja.

> Origen: propuesta de la IA en la conversación del 2026-10-29. Si se aprueban, pasan a §B con ID y evidencia.
