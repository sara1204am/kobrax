> ESTADO: BORRADOR (2026-11-05) — D-1…D-6 APROBADAS por la usuaria; falta el gate G4 (`validar`)

# Plan F2 · Modelo organizacional, responsabilidad del crédito y alcance

> Fase 2 del plan maestro (`ROLES-PERMISOS-PLAN.md` §E y §C.8). Va después de F3 (cerrada 2026-11-05): las políticas se escriben sobre `AuthorizationService`/`PolicyService`/`FactsLoader`.

## 1. Objetivo
Que la **responsabilidad viva en el crédito** y el cliente no tenga dueño (H-7): el cliente guarda sólo su oficina de registro y su creador; su visibilidad se deriva de los créditos que el actor ve. Y que las decisiones «para quién / sobre qué fila» de crear cliente, crear crédito, asignar crédito e invitar o cambiar de rol a una persona pasen por **políticas** con la jerarquía organizacional real (oficinas y `tier`), no por el nombre del rol. Sin pantalla nueva para el gratuito individual.

## 2. Rama
`f14/p2-responsabilidad-alcance`, desde `f14/p3-authz-core` (F1 y F3 aún no están en `main`; sin push/PR hasta que la usuaria lo pida).

## 3. Estado inicial con evidencia (releído 2026-11-05)

| # | Hallazgo | Evidencia | Clase |
|---|---|---|---|
| E1 | `clients.created_by` **ya existe** (F1, N-12 interino). Falta `registered_branch_id`. | `packages/database/prisma/schema.prisma:722`; `clients.service.ts:160-205` (`create` escribe `createdBy`, no oficina) | VERIFICADO |
| E2 | La visibilidad del cliente es un `UNION`: créditos visibles ∪ clientes **sin crédito vivo** (ALL/SUBTREE todos; el resto sólo si `created_by = yo`). No considera la oficina de registro ni el `ACTIVE` del crédito para el cobrador. | `modules/mora/mora-query.ts:173-190` | VERIFICADO |
| E3 | `visibleClientIdsSql` lo consumen clientes, exportes, uploads y mora. | `grep visibleClientIdsSql`: `clients.service.ts`, `exports.service.ts`, `uploads/upload-access.service.ts`, `mora-query.ts`, `client-visibility.spec.ts` | VERIFICADO |
| E4 | `POST /clients` exige `client:write`; **no existe** `client:create`, `credit:create` ni `client:delete`. `DELETE /clients/:id` exige `client:write` y **ya es borrado lógico** (`deletedAt`) bloqueado si hay créditos `ACTIVE`, auditado `DELETE`. | `clients.controller.ts:43-44, 96-102`; `clients.service.ts:797-807`; `packages/shared/src/constants/permissions.ts` (sin esos permisos) | VERIFICADO |
| E5 | Crear crédito: elegir a otra persona exige `assignment:write` (`assignment.authorize()`); sin elegir, quien no puede asignar queda como responsable. La oficina del crédito la resuelve el servidor (`resolveCreditBranch`). **Esto ya cumple «responsable = actor salvo `assignment:write`»**. | `credits.service.ts:256-262, 281, 293`; `office-scope.service.ts:133-148` | VERIFICADO |
| E6 | Quién puede ser destino de un crédito se decide **por nombre de rol** (`ASSIGNABLE_ROLES = COLLECTOR, SUPERVISOR`) o uno mismo; el límite de oficina lo da `assertAgency` (subárbol). **No hay jerarquía de tier** ni regla del par (H-8, R-13). | `assignments/assignment-rules.ts:34, 41-43`; `assignment.service.ts:175-193` | VERIFICADO |
| E7 | `invite` valida sólo que el rol sea de los móviles (**incluye ACCOUNT_ADMIN**) y, si hay oficina, que exista y esté activa. **No compara tier ni que la oficina caiga en el subárbol del actor.** `updateMember` protege al último admin pero tampoco compara tier. | `users.service.ts:205, 323-345`; `shared/constants/roles.ts:11` | VERIFICADO |
| E8 | Hoy invita quien tenga `user:invite` (ACCOUNT_ADMIN); el gerente no. `Role.level` existe (90/70/50…) pero ninguna decisión lo usa. | `users.controller.ts:97-98`; `seed.ts:119-123` | VERIFICADO |
| E9 | RLS de alcance intra-tenant: **sólo helpers** (`app_current_scope`, `app_scope_sees_all`); ninguna policy los usa. `prisma.service.ts` colapsa SUBTREE y ALL en `account`; `own` para el resto. | `rls/002_scope.sql:38-51`; `database/prisma.service.ts:95-98` | VERIFICADO |
| E10 | `GET /users` ya se recorta por oficina (F1, R-02). | `office-scope.service.ts:71-78` | VERIFICADO |

Resuelve: **R-03 (redefinido), R-12/R-13 (H-3, H-8), N-01 (barrera RLS; ver D-2), N-12 definitivo, H-12 (permiso).**

## 4. Alcance / fuera de alcance

**Dentro**
- Migración aditiva `f14_04_client_registration` (el plan maestro la llamaba `f14_02_client_registration`; ese número ya lo usó F1 para el permiso de MANAGER, por eso F2 usa `f14_04`): `clients.registered_branch_id` (FK `branches`, nullable) + índice; backfill idempotente (oficina del único crédito vivo o de sus créditos si todos coinciden; si no, NULL) y `verify/f14-cliente-registro.sql` que lista los NULL.
- Visibilidad del cliente derivada de créditos (reemplaza el `UNION` de `mora-query.ts:173-190`): cobrador = créditos vigentes a su cargo (responsable, temporal o apoyo) ∪ sin crédito vivo que él creó; supervisor/gerente = algún crédito visible ∪ registrado en su subárbol; ALL = todos. Sin accesos residuales (nada se guarda en el cliente).
- `GET /clients/:id` devuelve `otherCredits { count, totalOutstanding, responsibles[] }`: sólo agregados (D-6).
- Políticas: `client.create`, `credit.create`, `credit.assign`, `member.invite`, `member.assignRole` (registradas en `policies/`; `FactsLoader` gana los hechos de oficina/tier).
- Permisos nuevos `client:create`, `credit:create`, `client:delete` en el catálogo y las plantillas (D-3) con migración que sube `policy_version`.
- `client:delete` pasa a exigir su propio permiso (el borrado lógico ya existe).
- Función `tierOf(rol)` única; hoy sale de `roles.level` (D-1).
- Snapshot de puertas de F3 actualizado y aprobado.

**Fuera**
- Barrera RLS de alcance (policies `scope_*`, `app.scope` de 4 valores): **D-2** propone una fase propia (F2b) por su riesgo.
- Roles por tenant y `account_roles.tier` (F5), PII (F4), editor de roles (F7), pantallas de web/móvil más allá del aviso `otherCredits` y de ocultar acciones sin permiso (F6, F8).
- Asignar o retirar `ACCOUNT_ADMIN` (H-13: operación de plataforma). F2 sólo **deja de permitirlo** por invitación o cambio de rol.
- Anonimización de clientes (fuera de F14).

## 5. Dependencias
- F1 y F3 cerradas (G7 PASS 2026-11-05).
- Decisiones aprobadas que sustenta: **H-3, H-7, H-8, H-12, H-13** (`ROLES-PERMISOS-PLAN.md` §H). Las propias de la fase (D-1…D-6, §9) fueron **APROBADAS por la usuaria el 2026-11-05**, con la recomendación de cada fila (D-2: la barrera RLS pasa a una fase propia **F2b**).
- Gates: G0–G3 PASS; F1 y F3 cerradas.

## 6. Archivos afectados (HUB consultado; entradas H14-025…H14-031 creadas en `hub/HUB.md` en estado PLANEADO)

| HUB | Archivo | Cambio | Dependientes (IMPACT-MAP) |
|---|---|---|---|
| H14-025 | `packages/database/prisma/schema.prisma` (Client), migración `f14_04`, `verify/f14-cliente-registro.sql` | `registered_branch_id` + backfill + verify | seed, importación, RLS (`001`), exportes |
| H14-026 | `modules/mora/mora-query.ts:173-190` `visibleClientIdsSql` | Visibilidad derivada de créditos + oficina de registro | clientes, exportes, uploads, mora, pagos (F13 HUB-011/019), `client-visibility.spec.ts` |
| H14-027 | `modules/clients/clients.service.ts` (`create`, `getById`, `remove`), `clients.controller.ts` | `client.create`, `otherCredits`, `client:create`/`client:delete` | importación (`portfolio-import*`), móvil (alta de cliente offline), web fichas |
| H14-028 | `modules/credits/credits.service.ts`, `assignments/assignment-rules.ts`, `assignment.service.ts` | `credit.create`, `credit.assign` (tier + par en oficina hija) | importación (`IMPORT_OWN`), reparto masivo, agenda, rutas, F13 HUB-013/017 |
| H14-029 | `modules/users/users.service.ts` (`invite`, `updateMember`), `users.controller.ts`, `common/office-scope/*` | `member.invite`/`member.assignRole` por tier y subárbol; `ACCOUNT_ADMIN` no se asigna por estas vías | Equipo web, invitaciones, F1 H14-009/012 |
| H14-030 | `common/authz/policies/*`, `facts-loader.ts`, `authz-snapshot.json` | 5 políticas nuevas; `tierOf`; puertas nuevas | todos los servicios que llaman `assertPolicy` |
| H14-027b | web: `cartera/new-client-button.tsx:52`, `cartera/[id]/client-card.tsx:87, 256`, `credito/[cid]/credit-card.tsx:63`, `cartera/[id]/link-review.tsx:32` | Los controles que hoy usan `client:write`/`credit:write` pasan a `client:create`, `credit:create` y `client:delete` donde corresponda (editar sigue con `*:write`); aviso `otherCredits` | usuarios sin esos permisos (AUDITOR/VIEWER no cambian) | Medio | F2 | pruebas web del botón y la ficha | PLANEADO (bajo H14-027) |
| H14-031 | `packages/shared/src/constants/permissions.ts`, seed, migración de catálogo (`policy_version`) | `client:create`, `credit:create`, `client:delete` y plantillas | JWT de todas las sesiones (un `AUTHZ_STALE` único), web `permissions`, móvil |

## 7. Invariantes que aplican
RULES F13 §A–§D (heredadas); F14-A: H-3, H-7, H-12, H-13. Multi-tenant (`account_id` en todo, RLS ya activa), auditoría de toda mutación, migración **aditiva**, nuevos specs registrados en el `test` de `apps/api/package.json` (B12), sin `any`. **N-13:** los ids del actor salen de la sesión, nunca de un DTO (`branchId` pedido se valida contra el alcance del actor). Nada de «dueño del cliente» ni «reasignar cliente» en API, web o móvil.

## 8. Perfiles de tenant afectados y cómo se protege el individual/gratuito
- **Gratuito individual** (un solo `ACCOUNT_ADMIN`, sin oficinas, `soleLeafOffice` = la raíz): `client.create` registra el cliente en la única oficina hoja sin pedir nada; `credit.create` y `credit.assign` lo dejan crearse y asignarse a sí mismo (el actor siempre es destino válido); `member.invite` no aplica (no invita) y, si invitara, el tier del destino es inferior. Visibilidad: ALL, ve todo. **Regresión obligatoria:** `authz-coverage.it.ts` ampliado con crear cliente → crear crédito → registrar pago → ver ficha en una cuenta FREE individual, sin 403/404 de más.
- **Multi-oficina:** cobrador sólo ve clientes de su cartera y los que creó; supervisor, los de su agencia; gerente regional, los de su subárbol; gerente en la raíz de una cuenta multi-oficina **no puede crear cliente** sin elegir oficina (`CLIENT_CREATE_AT_ROOT`).
- **Cambia de comportamiento (avisar):** (a) un cobrador deja de ver a un cliente cuando pierde su último crédito vigente; (b) sólo ACCOUNT_ADMIN borra clientes (D-3); (c) nadie invita o promueve a `ACCOUNT_ADMIN` (H-13); (d) un gerente invita (primera vez) a roles de tier inferior dentro de su subárbol.

### 8.1 Cruce con la alineación móvil↔web (RULES D1) — leído 2026-11-05
- **Estado de la alineación:** `F10/plans/alineacion-web/README.md` está **EN EJECUCIÓN, ronda 3/4**: pendientes 0.2, 0.4, 0.5, 0.7, 0.8 y las fases 1–6; bloqueados externamente push y mapas offline. F2 **no toca ninguno de esos ítems ni escribe código móvil** (D-6a).
- **Principios F10 que F2 respeta:** P-3 (el API es la autoridad de permisos; el móvil ofrece según `capabilities` y deja que el servidor valide), P-7 (el cobrador independiente sigue creando y administrando lo suyo) y «sin casos» (todo cuelga del crédito, coherente con H-7).
- **Dependencia de permisos:** el móvil no decide por `client:write`/`credit:write` (sólo aparecen en comentarios de `agenda.service.ts:291` y `cliente-queue.ts:20`). El COLLECTOR conserva ambos y recibe `client:create` y `credit:create` (D-3), así que el alta de cliente y de crédito (`client.create`, `credit.create` en `sync/queue.ts:137-138`) sigue igual. El móvil no tiene «eliminar cliente».
- **Efecto real (sin cambiar código móvil):** (a) la caché de clientes se reemplaza entera al sincronizar (`db.ts` `replaceAll`) y se purga por TTL (`purgeCache`): un cliente que el cobrador deja de ver **desaparece en la siguiente sincronización** sin lógica nueva; (b) acciones **ya encoladas** sobre ese cliente (`client.update`, `client.contact`, `credit.create`… en `sync/queue.ts`) recibirán 404 del servidor; el móvil trata un 404 como «ya no existe» sólo para borrados (`queue.ts:515, 708`), así que para el resto hay que **verificarlo** (tarea 9) y, si queda como error reintentable, registrarlo como pendiente de F8; (c) el nuevo campo `otherCredits` es aditivo en el JSON: el móvil lo ignora.
- **Prueba de este cruce (tarea 9):** correr la suite móvil completa y una prueba de contrato que confirme que `GET /clients/:id` con `otherCredits` no rompe el parseo del móvil; revisar el manejo de 404 de las acciones de cliente en cola y dejar el resultado en `VERIFICATIONS`. Si el 404 queda mal tratado, **no se arregla en F2**: se anota en el HUB para F8 y se avisa a la usuaria.

## 9. Riesgos y decisiones propias (D-1…D-6 APROBADAS 2026-11-05)

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| D-1 | Fuente del `tier` mientras no existan roles por tenant (F5) | (a) `roles.level` actual detrás de `tierOf()`; (b) esperar a F5 | **(a)**: una sola función, F5 sólo cambia su implementación |
| D-2 | La **barrera RLS de alcance** (policies `scope_*` en log-only y `app.scope` de 4 valores) | (a) dentro de F2; (b) fase propia **F2b** tras F2 | **(b)**: es la pieza de mayor riesgo (duplica `officeVisibilitySql` en SQL) y F2 funciona y se prueba sin ella; la app ya filtra |
| D-3 | Quién recibe los permisos nuevos | `client:create` = quienes hoy tienen `client:write`; `credit:create` = quienes hoy tienen `credit:write`; `client:delete` = **sólo ACCOUNT_ADMIN** (H-12) | **Tal cual** (sin cambio salvo el borrado, que dejan de hacer supervisor/cobrador/gerente) |
| D-4 | Gerente/supervisor en Personas (H-3) | MANAGER recibe `user:invite`; SUPERVISOR recibe `user:read` (su oficina); ambos con las políticas; **ningún** camino asigna `ACCOUNT_ADMIN` | **Sí** (aprobado en H-3/H-13) — confirmar que se activa en esta fase y no en F5 |
| D-5 | Clientes con backfill ambiguo (créditos en varias oficinas) | (a) `registered_branch_id` NULL listado para decidir; (b) la oficina del crédito más antiguo | **(a)**; los NULL los ven ALL/SUBTREE y su creador, como hoy |
| D-6 | `otherCredits` | (a) API + ficha web ahora, móvil en F8; (b) también móvil ahora | **(a)** (cruce RULES D1 con la alineación móvil en curso) |

Riesgos: backfill ambiguo (D-5); el cambio de visibilidad toca 4 consumidores del mismo SQL (exportes y uploads incluidos: las pruebas de propiedad de cada uno deben seguir verdes); sesiones vivas con permisos viejos (se resuelve con el `policy_version` de la migración de catálogo → `AUTHZ_STALE` único); `credit.assign` con tier cambia quién puede ser destino (un supervisor deja de asignarle a otro supervisor de su misma oficina).

## 10. Pruebas
**Existen y deben seguir verdes:** `client-visibility.spec.ts`, `assignment.service.spec.ts`/`assignment.bulk.spec.ts`/`assignment.coverage.spec.ts`, `users.service.spec.ts`, `office-scope*.spec.ts`, `office-scope.it.ts`, `authz-coverage.spec.ts`/`.it.ts`, `permission-gates.spec.ts`.
**Nuevas (todas registradas en el script `test`/`test:integration` de `apps/api/package.json`):** `authz/policies/client-create.spec.ts`, `credit-create.spec.ts`, `credit-assign.spec.ts`, `member-invite.spec.ts` (puras, tabla de decisiones: tier, par en misma oficina vs hija, raíz multi-oficina, oficina única, sin oficina); `mora/client-visibility.spec.ts` ampliado (cobrador pierde acceso al perder el último crédito; supervisor ve por oficina de registro; sin accesos residuales); `clients/other-credits.spec.ts` (sólo agregados, nunca detalle); `test/integration/f2-responsabilidad.it.ts` (extremo a extremo con otra oficina y otro tenant: IDOR en cada `:id`, invitar por gerente, asignar entre pares, cuenta FREE individual); verify SQL del backfill. Web: prueba del aviso `otherCredits` y de ocultar «Eliminar cliente» sin `client:delete`.

## 11. Rollback
Columna nullable inofensiva (no se borra). Migración de catálogo reversible (quitar permisos y re-subir `policy_version`). Las políticas se revierten por código; `AUTHZ_DENY_BY_DEFAULT=log` no aplica (ya no hay puertas nuevas sin contrato). Sin migración destructiva.

## 12. Tareas ordenadas (datos → API → web → móvil)
1. **Datos:** migración `f14_04` (columna + índice + backfill) + `verify/f14-cliente-registro.sql`; migración de catálogo y plantillas (`client:create`, `credit:create`, `client:delete`) con `policy_version`; `db:rls` si toca.
2. **API · base:** `tierOf`, hechos en `FactsLoader` (oficinas vigentes del actor, raíz, cuenta de una sola oficina, oficina del destino), registro de las 5 políticas.
3. **API · clientes:** `client.create` (oficina de registro resuelta por el servidor) y `created_by`; permisos en controlador (`client:create`, `client:delete`); `remove` ya es lógico.
4. **API · visibilidad:** nuevo `visibleClientIdsSql` + `otherCredits`; actualizar sus 4 consumidores y specs.
5. **API · créditos:** `credit.create` y `credit.assign` (tier + par en oficina hija); importación sigue con `IMPORT_OWN`.
6. **API · personas:** `member.invite`/`member.assignRole`; `ACCOUNT_ADMIN` fuera de ambos caminos; permisos de MANAGER/SUPERVISOR.
7. **Pruebas:** specs y la integración nueva; snapshot de puertas actualizado (lo aprueba la usuaria).
8. **Web:** aviso «tiene otros créditos» en la ficha; «Nuevo cliente» con `client:create`, «Nuevo crédito» con `credit:create`, «Eliminar» sólo con `client:delete` (editar y decidir vínculos siguen con `client:write`/`credit:write`: `new-client-button.tsx`, `client-card.tsx`, `credit-card.tsx`, `link-review.tsx`); Equipo muestra las acciones por permiso. Con `Button`/tokens/`DataTable`.
9. **Móvil:** sin cambios de código (D-6a). Cruce RULES D1 registrado en §8.1: correr la suite completa, la prueba de contrato de `otherCredits` y revisar el 404 de las acciones de cliente en cola; resultado en `VERIFICATIONS`.
10. **Docs:** HUB, VERIFICATIONS, STATUS, HANDOFF, `docs/producto/roles-permisos-planes.md`.

## 13. Criterios de cierre (evidencia exigida)
- **G5:** salida pegada de: unitarias de la API; specs de políticas y visibilidad; integración completa **sola** + `f2-responsabilidad.it.ts`; regresión de la cuenta FREE individual; web y móvil; `tsc` en api/web/database/mobile; migración y `verify` del backfill (NULL listados); snapshot de puertas aprobado.
- **G6:** `/code-review` + recorrido de IMPACT-MAP por H14-025…031.
- **G7:** HUB, STATUS, HANDOFF, VERIFICATIONS, docs de producto. **No** abrir F4/F2b sin orden.
