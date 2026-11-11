> ESTADO: EN EJECUCIÓN (tarea 1 hecha; el inventario sumó D-6 y dos tareas: se vuelve a la usuaria antes de seguir). G4 PASS 2026-11-05 con D-1…D-5 aprobadas.

# Plan F2b · Barrera RLS de alcance (segunda barrera en PostgreSQL)

> Fase propia que F2 (D-2) dejó fuera por su riesgo. Resuelve **N-01** del plan maestro (`ROLES-PERMISOS-PLAN.md` §C.8 «RLS segunda barrera» y §E). Va después de F2 (cerrada 2026-11-05).

## 1. Objetivo
Que PostgreSQL, y no sólo cada consulta de la API, niegue las filas que el alcance de la persona no cubre (créditos, clientes, pagos, agenda, rutas), de modo que una consulta nueva que olvide `moraAccessConditions` no filtre datos entre oficinas o entre cobradores. Se despliega **primero sin efecto** (modo `off` y luego `log`) y se activa (`enforce`) sólo con evidencia de que no cambia ningún resultado legítimo ni degrada el rendimiento.

## 2. Rama
`f14/p2b-barrera-rls-alcance`, desde `f14/p2-responsabilidad-alcance` (F1, F3 y F2 aún no están en `main`; sin push/PR hasta que la usuaria lo pida).

## 3. Estado inicial con evidencia (releído 2026-11-05)

| # | Hallazgo | Evidencia | Clase |
|---|---|---|---|
| E1 | PostgreSQL sólo aísla por tenant: una policy `tenant_isolation` por tabla (`account_id = app_current_account()`, `FORCE ROW LEVEL SECURITY`). Ninguna policy mira el alcance. | `rls/001_enable_rls.sql:78-82`; `rls/002_scope.sql:7-10` («las policies llegan en F2»: no llegaron) | VERIFICADO |
| E2 | Existen los helpers `app_current_user()`, `app_current_scope()` y `app_scope_sees_all()` (ve todo si `account` o `system`); el comentario promete **tres** valores (`account`, `own`, `system`) y «no hay un cuarto». | `rls/002_scope.sql:18-51` | VERIFICADO |
| E3 | `PrismaService` fija `app.current_account_id`, `app.current_user_id` y `app.scope` por transacción con `set_config`. `withTenant` colapsa `ALL` **y** `SUBTREE` en `account` y todo lo demás (supervisor incluido) en `own`; `withSystemTenant` fija `system`; **sin contexto de request el alcance es vacío y sólo avisa con un `warn`**. | `database/prisma.service.ts:38, 78-117, 133` | VERIFICADO |
| E4 | La regla de visibilidad vive en SQL de la app y es **la fuente única**: `moraAccessConditions` (créditos: responsable, reemplazo/apoyo vigentes, y por oficina `officeVisibilitySql` para `SUBTREE`/`BRANCH`), `visibleCreditIdsSql`, `visibleClientIdsSql` (F2). | `mora/mora-query.ts:131, 164, 178`; `common/office-scope/office-scope.ts:42, 53, 66` | VERIFICADO |
| E5 | La regla se consume en clientes, créditos, mora, pagos, exportes, uploads, agenda, rutas, analítica y campo. Todos pasan por esos helpers o por `visibleCredits`. | `grep` de `moraAccessConditions`/`visibleCreditIdsSql`/`visibleClientIdsSql`/`visibleCredits` (18 llamadores en 10 servicios) | VERIFICADO |
| E6 | Los triggers de denormalización (totales del cliente, episodios de mora, fuente externa) son `SECURITY DEFINER` «a propósito» porque `clients` tiene RLS con `FORCE`. | `migrations/20260814210000_denormalize_portfolio_totals/migration.sql:37-45`; `20261003020000_episodios_de_mora/migration.sql:116-122` | VERIFICADO (la propiedad de la función en producción: DESCONOCIDO, ver riesgo R-2) |
| E7 | Hay 63 llamadas a `withTenant` y 2 a `withSystemTenant` fuera de specs. Cuántas corren sin contexto de request (trabajos, colas): **DESCONOCIDO**; es lo primero que inventaría la tarea 1. | `grep -rn "withTenant("` / `"withSystemTenant("` en `apps/api/src` | INFERIDO |
| E8 | La tabla `files` **no existe todavía** (`f14_03_files` es de F4): la policy `scope_files` del plan maestro queda fuera de esta fase. | `ROLES-PERMISOS-PLAN.md` §E (migraciones), `schema.prisma` | VERIFICADO |
| E9 | `verify_isolation.sql` prueba sólo el aislamiento **entre tenants** (superuser / `kobrax_app` con DEMO / con tenant B / sin contexto). | `rls/verify_isolation.sql:1-54` | VERIFICADO |
| E10 | Columnas que sostienen la regla: `credits.branch_id`, `credits.assigned_manager_id`, `credit_assignments`, `clients.registered_branch_id`/`created_by`, `payments.branch_id`, `route_plans.branch_id`/`collector_id`, `agenda_items.credit_id`. La regla exacta de **pagos, agenda y rutas** (cuáles filas ve cada alcance) se lee en la tarea 1; hoy sólo se sabe que usan los helpers de E4. | `schema.prisma:727, 913, 1437-1438, 1634, 1887` | VERIFICADO (columnas) / DESCONOCIDO (reglas por tabla) |

## 3b. Resultado del inventario (tarea 1, 2026-11-05) — ESTADO: EN EJECUCIÓN

El inventario de sólo lectura encontró cuatro cosas. Las dos primeras cambian el alcance y se suman al plan.

| # | Hallazgo | Evidencia | Clase |
|---|---|---|---|
| I-1 | **Seis trabajos de fondo** abren transacciones con `withTenant` **sin contexto de request** (hoy quedan con alcance vacío, sin efecto porque no hay policies de alcance): `plan-lifecycle`, `agenda-overdue`, `installment-reminders`, `arrears-job`, `promise-due` y el barrido de vencimientos de `AssignmentService`. Con `enforce` verían cero filas. Todos descubren las cuentas con la función `promise_due_account_ids()`. | `common/plan/plan-lifecycle.service.ts:93`; `agenda/agenda-overdue.service.ts:84`; `agenda/installment-reminders.service.ts:90`; `arrears/arrears-job.service.ts:130,135`; `notifications/promise-due.service.ts:90`; `assignments/assignment.service.ts:554`. `withSystemTenant` hoy sólo lo usan `auth.service.ts:387` y `account-requests.service.ts:139` | VERIFICADO |
| I-2 | **Hay lecturas de la API que necesitan ver TODA la cuenta aunque quien pide tenga un alcance menor**, sobre tablas protegidas: (a) los **topes del plan** cuentan `credit` y `client` (`plan-limits.service.ts:77,82`): con `enforce` un cobrador contaría sólo lo suyo y **podría superar el tope**; (b) la **detección de duplicados** busca por `nationalIdHash` en `clients` sin alcance (`clients.service.ts:187, 317, 380, 817`) y existe `@@unique([accountId, nationalIdHash])` (`schema.prisma:745`): con `enforce` un usuario de otra oficina no vería el duplicado y el alta fallaría con un error de unicidad en vez de `CLIENT_DUP`; (c) la importación de clientes y la de cartera emparejan contra todos los clientes (`client-import.service.ts:86`, `imports/client-match.ts:53`). | archivos citados | VERIFICADO (lecturas) / INFERIDO (efecto bajo `enforce`) |
| I-3 | **Rutas:** la API **no acota por oficina** a quien asigna rutas: con `ROUTE_ASSIGN` (supervisor, gerente) lista **todas** las rutas de la cuenta; sólo el ejecutor de campo ve las suyas (`collector_id`). Una policy por oficina sería **más estricta que la API** y cambiaría resultados. La policy de `route_plans` replica la regla real: sólo `own` queda acotado a sus rutas (`collector_id` o `created_by`). Que un supervisor vea las rutas de otras oficinas es un hallazgo aparte (no se corrige aquí). | `routes/routes.service.ts:530-540` | VERIFICADO |
| I-4 | **Reglas por tabla:** `payments` = visible si lo es su crédito (`payments.service.ts:63-74`; no usa `payments.branch_id`); `agenda_items` = `assignee_id` es yo si no tengo `AGENDA_ASSIGN`, o su crédito es visible (`agenda.service.ts:243-254`); `credits` y `clients` = `moraAccessConditions` y `visibleClientIdsSql`. **Principio de diseño:** la regla en SQL debe ser un **superconjunto** de la de la API (nunca más estricta), porque su trabajo es atrapar el olvido de un filtro, no cambiar resultados legítimos. | archivos citados | VERIFICADO |
| I-5 | **Dueño de las funciones `SECURITY DEFINER`** (`portfolio_totals_recalc`, `credits_track_arrear_episode`, etc.) en la DB de desarrollo: `postgres`, superusuario con `bypassrls`; `kobrax_app` es `NOBYPASSRLS`. Los agregados del cliente no se corrompen. En otros entornos hay que verificarlo al desplegar. | consulta a `pg_proc`/`pg_roles` en `kobrax` | VERIFICADO (dev) / DESCONOCIDO (otros entornos) |

**Cambios al plan por el inventario**
- **Tarea nueva (API):** un ayudante explícito `elevado(tx, fn)` en `PrismaService` que sube a alcance `system` **sólo dentro de la transacción actual y sólo para una lectura nombrada**, y vuelve al alcance original. `grep` lista todos los usos. Se aplica a: topes del plan (conteos), detección de duplicados, y emparejamiento de las importaciones.
- **Tarea nueva (API):** los seis trabajos de fondo pasan a `withSystemTenant` (ya estaba como H14-035; ahora con la lista exacta).
- **D-6 (PROPUESTA):** qué ve quien da de alta cuando el documento ya existe **en una oficina que no ve**. Hoy la API le muestra los datos del cliente existente (nombre incluido). Opciones: (a) mantenerlo tal cual vía `elevado`; (b) sólo avisar «ese documento ya está registrado» sin datos si el cliente no es visible para quien pregunta. **Recomendación: (b)**, coherente con F2 (`otherCredits` sólo agregados); cambia el aviso para quien duplica entre oficinas.
- `route_plans` se acota como en I-3 (no por oficina).

## 4. Alcance / fuera de alcance

**Dentro**
- **Inventario previo** de los llamadores de `withTenant` sin contexto de request y de toda consulta cruda (`$queryRaw`) sobre las tablas de la ola 1; los trabajos de sistema pasan a `withSystemTenant` antes de activar nada.
- `app.scope` pasa a **cinco valores** (`account`, `subtree`, `branch`, `own`, `system`), calculados con `officeScopeKindOf` (la misma función que usa la API); se actualiza el comentario de `002_scope.sql`.
- Nueva variable de transacción `app.scope_mode` (`off` | `log` | `enforce`) fijada por `PrismaService` desde `SCOPE_RLS_MODE`.
- Migración/script `rls/005_scope_policies.sql` (aditivo, reaplicable con `db:rls`): funciones SQL que replican la regla de E4 por tabla y una policy `RESTRICTIVE FOR SELECT` por tabla de la **ola 1**: `credits`, `clients`, `payments`, `agenda_items`, `route_plans`.
- Modo `log`: la función registra (`RAISE LOG`) «habría negado» con tabla, id y persona, y deja pasar la fila.
- Pruebas: specs del cálculo del alcance, `verify/f2b-scope.sql` y `test/integration/f2b-rls-alcance.it.ts` (consultas **crudas** como `kobrax_app` sin pasar por los helpers de la app), más la **medición de rendimiento** (D-4).
- Ampliar `verify_isolation.sql` o un `verify_scope.sql` hermano con el aislamiento intra-tenant.

**Fuera**
- `scope_files` (la tabla es de F4).
- Políticas de escritura (`INSERT`/`UPDATE` con `WITH CHECK`): ver D-3.
- Cambiar quién ve qué: **la regla no cambia**; la policy sólo la repite en SQL. Cualquier diferencia que aparezca es un bug de una de las dos copias.
- Poner `enforce` en un entorno real: es una decisión aparte de la usuaria con la evidencia de esta fase (D-5).
- Móvil (pendiente; no se toca).

## 5. Dependencias
- F1, F2 y F3 cerradas (G7 PASS 2026-11-05). F2 aporta `clients.registered_branch_id`, necesario para la regla de clientes.
- Decisiones del plan maestro que sustenta: **N-01** y §C.8 (RLS de segunda barrera con `log-only` → `ENFORCE`). Las propias de la fase (D-1…D-5, §9) fueron **APROBADAS por la usuaria el 2026-11-05** con la recomendación de cada fila.
- Gates: G0–G3 PASS; F2 cerrada.

## 6. Archivos afectados (HUB consultado; entradas H14-032…H14-036 creadas en `hub/HUB.md` en estado PLANEADO)

| HUB | Archivo | Cambio | Dependientes (IMPACT-MAP) |
|---|---|---|---|
| H14-032 | `database/prisma.service.ts` (`withTenant`, `runScoped`) | `app.scope` de 5 valores desde `officeScopeKindOf`; `app.scope_mode` desde `SCOPE_RLS_MODE`; el `warn` sin contexto sigue | las ~63 llamadas a `withTenant` (todo el API), trabajos de sistema |
| H14-033 | `rls/002_scope.sql`, nuevo `rls/005_scope_policies.sql`, `rls/apply-rls.ts` si lista archivos | funciones por tabla + policies `RESTRICTIVE FOR SELECT` en modo `off`/`log`/`enforce` | `db:rls` (cada despliegue), `verify_isolation.sql`, seed |
| H14-034 | `common/office-scope/office-scope.ts`, `mora/mora-query.ts` | **sin cambio de regla**; se añade un spec de paridad que compara la regla en TS con la función SQL | clientes, créditos, mora, pagos, exportes, uploads, agenda, rutas, analítica |
| H14-035 | llamadores de `withTenant` sin contexto (lista de la tarea 1: jobs, colas, CLI) | pasan a `withSystemTenant` | arrears, planes, ciclo de vida, notificaciones |
| H14-036 | `test/integration/f2b-rls-alcance.it.ts`, `rls/verify_scope.sql`, `apps/api/package.json` (`test:integration`) | consultas crudas por alcance, paridad app↔SQL, modo `log`, rendimiento | CI |

## 7. Invariantes que aplican
RULES F13 §A–§D (heredadas); F14-A: N-01, H-7. Multi-tenant (`account_id` + RLS ya activa; la policy de alcance es **adicional y restrictiva**, nunca reemplaza `tenant_isolation`), migración **aditiva** y reversible (`DROP POLICY`), nuevos specs registrados en el `test` de `apps/api/package.json` (B12), sin `any`. **Una sola fuente de la regla:** la copia en SQL se prueba contra la de TypeScript; ninguna se edita sin la otra.

## 8. Perfiles de tenant afectados y cómo se protege el individual/gratuito
- **Gratuito individual** (un solo `ACCOUNT_ADMIN`, alcance `account`): `app_scope_sees_all()` es verdadero y la policy no filtra nada; con `SCOPE_RLS_MODE=off` ni siquiera evalúa la regla. **Regresión obligatoria:** el recorrido `authz-coverage.it.ts` de la cuenta gratuita y `f2-responsabilidad.it.ts` (cuenta individual) con el modo en `enforce`.
- **Multi-oficina:** supervisor (`branch`), gerente regional (`subtree`) y cobrador (`own`) pasan a quedar acotados también en la base. Una consulta que hoy filtra bien no cambia de resultado; una que olvida el filtro empieza a devolver menos filas (eso es el objetivo, y en `log` se ve antes de que ocurra).
- **Cambia de comportamiento (avisar):** (a) en `enforce`, un `withTenant` sin contexto de request deja de ver filas de las tablas protegidas (hoy ya queda sin alcance, pero ninguna policy lo usaba); (b) las consultas de ALL/SUBTREE-raíz no cambian.

## 9. Riesgos y decisiones propias (D-1…D-5 APROBADAS 2026-11-05)

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| D-1 | Cómo se despliega y se activa | (a) tres modos por variable de entorno `SCOPE_RLS_MODE=off\|log\|enforce`, por defecto `off`; (b) activar `enforce` directo | **(a)**: se instala sin efecto, se observa en `log` y se activa con un cambio de configuración (que también es el rollback) |
| D-2 | Tablas de la primera ola | `credits`, `clients`, `payments`, `agenda_items`, `route_plans` (+ `files` cuando exista, en F4) | **Las cinco**, empezando la implementación por `credits` y `clients` |
| D-3 | Qué comandos restringe la policy | (a) `FOR SELECT` restrictiva (también acota los `UPDATE`/`DELETE` porque necesitan ver la fila, y no toca los `INSERT`); (b) `FOR ALL` con `WITH CHECK` | **(a)**: no rompe los flujos de alta (crear crédito para otra persona, importaciones) y la escritura ya la valida la API con políticas |
| D-4 | Presupuesto de rendimiento | (a) máximo +20 % en el p95 de los listados (mora, cartera, pagos) con un conjunto de ≥50 000 créditos; si se excede, no se activa; (b) sin presupuesto | **(a)**; además, las funciones se escriben en SQL inlineable para no perder índices |
| D-5 | Criterio para pasar de `log` a `enforce` | (a) suite de integración completa con **cero** «habría negado» inesperados + prueba de rendimiento dentro de D-4, y la usuaria ordena el cambio; (b) automático | **(a)**: la activación en un entorno real la ordena la usuaria |

**Riesgos**
- **R-1 Rendimiento.** Una policy con funciones no «leakproof» puede impedir usar índices en los filtros de la consulta y encarecer los listados. Mitigación: funciones `LANGUAGE sql STABLE` inlineables, `EXPLAIN` antes/después de cada tabla, presupuesto D-4, y poder volver a `off` sin migración.
- **R-2 Triggers `SECURITY DEFINER`.** Si el dueño de esas funciones en producción no ignora RLS, sus sumas (totales del cliente, episodios) verían sólo las filas del alcance de quien dispara y **corromperían los agregados**. Mitigación: la tarea 1 verifica el rol dueño en cada entorno y la integración prueba que los totales del cliente no cambian cuando un cobrador modifica un crédito.
- **R-3 Trabajos y colas sin contexto.** Hoy el alcance vacío «solo avisa»; con `enforce` dejarían de ver filas. Mitigación: inventario (E7), conversión a `withSystemTenant` y el modo `log` para confirmarlo.
- **R-4 Dos copias de la regla.** TypeScript y SQL pueden divergir. Mitigación: spec de paridad (misma batería de casos en ambas) y la regla en un solo archivo SQL.
- **R-5 Aislamiento intra-tenant en la base de pruebas.** `kobrax_app` es el rol que cumple RLS (sin `BYPASSRLS`); las pruebas crudas deben correr con ese rol, no con el superusuario.

## 10. Pruebas
**Existen y deben seguir verdes:** `office-scope*.spec.ts`, `office-scope.it.ts`, `client-visibility.spec.ts`, `f2-responsabilidad.it.ts`, `authz-coverage.it.ts`, `verify_isolation.sql` (aislamiento entre tenants).
**Nuevas (registradas en `test` / `test:integration` de `apps/api/package.json`):**
- Specs puros: cálculo de los cinco valores de `app.scope` por permisos; paridad de la regla (la batería de casos de `office-scope.spec.ts` ejecutada contra la función SQL en la integración).
- `test/integration/f2b-rls-alcance.it.ts`: como `kobrax_app` y **sin pasar por los helpers de la app**, `SELECT` crudo sobre cada tabla de la ola 1 con cada alcance (ALL, SUBTREE regional y de raíz, BRANCH, OWN, sin asignaciones, system, sin contexto) y con otro tenant; en modo `enforce` devuelve exactamente lo que devuelve la API; en `log` devuelve todo y registra; en `off` no registra nada; los totales del cliente no cambian cuando un cobrador toca un crédito (R-2); `UPDATE`/`DELETE` sobre filas fuera del alcance afectan 0 filas.
- `rls/verify_scope.sql`: la versión reproducible del aislamiento intra-tenant.
- **Rendimiento:** conjunto de ≥50 000 créditos, `EXPLAIN (ANALYZE)` y p95 antes/después por listado, contra D-4. La salida se pega en `VERIFICATIONS`.

## 11. Rollback
`SCOPE_RLS_MODE=off` (o `log`) apaga el efecto al instante, sin migración ni despliegue de código. Las policies y funciones se quitan con `DROP POLICY`/`DROP FUNCTION` (el script es reaplicable). Sin migración destructiva; no hay cambios de datos.

## 12. Tareas ordenadas (datos → API → web → móvil)
1. **Inventario (sólo lectura):** llamadores de `withTenant` sin contexto de request y consultas crudas sobre las tablas de la ola 1; regla exacta de pagos, agenda y rutas por alcance; rol dueño de las funciones `SECURITY DEFINER` en cada entorno. Resultado a `VERIFICATIONS`. Si el inventario cambia el alcance de este plan, se vuelve a la usuaria antes de seguir.
2. **Datos:** `rls/002_scope.sql` (comentario de cinco valores) y `rls/005_scope_policies.sql` con las funciones y las policies `RESTRICTIVE FOR SELECT` de las cinco tablas, en `off`/`log`/`enforce` (se construye y prueba una tabla a la vez, empezando por `credits` y `clients`); `db:rls` las aplica.
3. **API:** `PrismaService` fija `app.scope` de cinco valores y `app.scope_mode`; los seis trabajos de fondo (I-1) pasan a `withSystemTenant`; ayudante `elevado(tx, fn)` aplicado a los topes del plan, a la detección de duplicados (según D-6) y al emparejamiento de las importaciones (I-2).
4. **Pruebas:** specs, integración cruda en los tres modos, paridad app↔SQL, `verify_scope.sql`, registro en los scripts de `package.json`.
5. **Rendimiento:** medición contra D-4 y ajuste de las funciones (puede volver a la tarea 2).
6. **Web y móvil:** sin cambios.
7. **Docs:** HUB, VERIFICATIONS, STATUS, HANDOFF, `docs/producto/roles-permisos-planes.md`.

## 13. Criterios de cierre (evidencia exigida)
- **G5:** salida pegada de: unitarias de la API; integración completa (por tandas si hace falta, ver V-024) + `f2b-rls-alcance.it.ts` en los **tres modos**; regresión de la cuenta gratuita individual en `enforce`; `verify_scope.sql`; medición de rendimiento dentro de D-4; `tsc` en api/web/database/mobile; el inventario de la tarea 1.
- **G6:** `/code-review` + recorrido de IMPACT-MAP por H14-032…036.
- **G7:** HUB, STATUS, HANDOFF, VERIFICATIONS, docs de producto. La fase se cierra con el código **instalado y probado**; el modo por defecto queda en `off` y activar `enforce` en un entorno es una orden aparte de la usuaria. **No** abrir F4 sin orden.
