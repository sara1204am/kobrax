# Discovery · 02 · Backend y API

> **Estado: COMPLETO 2026-11-02.** Método: `../../_framework/README.md` §2 (clases de evidencia) · hallazgo = plantilla T1.
> Pistas previas relacionadas: ver `00-leads.md` (resueltas aquí: L-09, L-10 parte API, L-13, L-16, L-19). Solo lectura de código; fecha de todas las verificaciones: 2026-11-02.
> Rutas relativas a `apps/api/src/` salvo que se indique otra cosa. Lo de seguridad/guards/JWT/RLS está en `05-seguridad-autorizacion.md`.

## Qué debe responder
- Cada endpoint y servicio que lee o escribe oficina, rol o alcance; permiso que exige cada uno.
- Dónde se calcula el alcance (¿una función o varias copias?) y si son idénticas.
- Qué rol/oficina se asigna al registrarse (tenant individual).
- Qué hace analítica hoy, con qué consultas y sobre qué tablas.
- Jobs y trabajos de sistema que recorren cartera.

## Fuentes leídas
`database/prisma.service.ts`, `modules/{branches,mora,agenda,assignments,imports,analytics,credits,clients,payments,routes,users,accounts,exports,field-ops}`, `packages/database/prisma/schema.prisma`, `rls/*.sql`.

## Lente de tenant (resumen)
(a) Individual: se registra como `ACCOUNT_ADMIN`, sin oficina (`branch_id` NULL), alcance `ALL`; nada del alcance por agencia le aplica. (b) Equipo pequeño: la agencia solo importa si hay un `SUPERVISOR`; el resto ve todo o lo suyo. (c) Grande con varias oficinas: la lista plana de `branches` + `user_accounts.branch_id` única es todo el modelo; el alcance por agencia existe solo para el supervisor en Mora/Agenda/Rutas(créditos)/Asignación.

## Hallazgos

### H-02-01 · Inventario de puntos que comparan `branchId` / calculan alcance (los que habrá que migrar)
- Clase: VERIFICADO
- Evidencia (todos `archivo:línea`, relativos a `apps/api/src/`):
  - **Cálculo del tipo de alcance (por permiso):**
    - `modules/mora/mora-query.ts:149-152` `moraScopeOf` (ALL / BRANCH / OWN según `DATA_SCOPE_ALL` / `DATA_SCOPE_BRANCH`)
    - `database/prisma.service.ts:93-97` (solo ACCOUNT u OWN para la base; BRANCH cae en OWN)
    - `modules/assignments/assignment.service.ts:159-166` `assignScope` (ALL o BRANCH con `user_accounts.branch_id` leída en el momento)
    - `modules/agenda/agenda.service.ts:175-182` `assignBranch` (copia casi idéntica de `assignScope`)
    - `modules/credits/credits.service.ts:639` (`DATA_SCOPE_ALL` + `CREDIT_WRITE` para castigar)
  - **Comparación de oficina en SQL (visibilidad de créditos):**
    - `modules/mora/mora-query.ts:127-143` `moraAccessConditions` (rama BRANCH: `cr.branch_id = (SELECT ua.branch_id FROM user_accounts …)` y exige `assigned_manager_id IS NOT NULL` y `branch_id IS NOT NULL`)
    - Consumidores de ese mismo helper: `modules/mora/mora-query.ts:169` (`visibleCredits`) y `:184` (`buildMoraWhere`); `modules/mora/mora.service.ts:191,222,237`; `modules/routes/routes.service.ts:483,875`; `modules/field-ops/field.service.ts:313`; `modules/agenda/agenda.service.ts:255,752,952`
  - **Comparación de oficina en código de aplicación (reparto/asignación):**
    - `modules/assignments/assignment-rules.ts:62-73` `agencyViolations` (`branchId === scope.branchId`)
    - `modules/assignments/assignment.service.ts:118` (filtra asignables por oficina), `:204-213` `assertAssigneesInAgency`, `:216-224` `assertAgency`
    - `modules/agenda/agenda.service.ts:202` (usa `agencyViolations`), `:221` (filtro `branchId` de asignables, con el literal `'__sin_agencia__'`)
  - **Comparación de oficina en importación (otro concepto de «scope»):**
    - `modules/imports/portfolio-import.service.ts:309-310` `inScope` (`kind` account/official/branch; con `branch` compara `c.branchId === scope.ref`)
    - `modules/imports/portfolio-credit.ts:109` (`branchId` del crédito nuevo = `scope.ref` solo si `scope.kind==='branch'`)
  - **Filtros por parámetro (no son alcance, son filtros de pantalla; aceptan cualquier `branchId` del tenant):**
    - `modules/mora/mora-query.ts:203`; `modules/credits/credits.service.ts:332`; `modules/clients/clients.service.ts:460-464` (EXISTS sobre créditos); `modules/analytics/analytics.service.ts:126,144,186,204,451`
  - **Escrituras de `branch_id` (no comparan, pero fijan la pertenencia):**
    - `modules/credits/credits.service.ts:288` (alta) y `:463` (edición, desde el DTO); `modules/routes/routes.service.ts:306,376` (desde DTO); `modules/payments/payments.service.ts:182` (copia el `branchId` del crédito al pago); `modules/users/users.service.ts:187-195` (PATCH miembro); `modules/branches/branches.service.ts:175` (asignación masiva)
  - **Solo lectura/exhibición:** `modules/exports/exports.service.ts:146`, `modules/mora/mora.service.ts:653`, `modules/mora/mora-export.ts:159`, `modules/mora/mora-export.service.ts:124,135`, serializers (`credits.serializer.ts:107`, `routes.serializer.ts:176`, `mora.serializer.ts:158`, `users.serializer.ts:25`).
- Hecho: el alcance «agencia» está en al menos cuatro implementaciones distintas: la SQL de `mora-query.ts`, `assignScope` (assignments), `assignBranch` (agenda) y `agencyViolations` (reglas); más las comparaciones de importación y los filtros de pantalla. Dos de ellas (`assignScope` y `assignBranch`) son copias.
- Implica para la épica: la lista de arriba es el conjunto a migrar a un cálculo único de alcance (un solo «conjunto de oficinas visibles» por solicitud) para cumplir el candidato E «un solo punto de cálculo».
- HUB: HUB-009…HUB-016 (RULES B14) — cruzar con esta lista.

### H-02-02 · Las dos definiciones de BRANCH no son idénticas
- Clase: VERIFICADO
- Evidencia: `modules/mora/mora-query.ts:136-140` (visibilidad: crédito propio o crédito CON responsable y `branch_id` NO nulo igual a la oficina del usuario; el crédito sin responsable queda fuera) vs `modules/assignments/assignment-rules.ts:68` (reparto: `branchId !== null && branchId === scope.branchId`, sin exigir responsable).
- Hecho: «agencia» significa dos cosas: en visibilidad se pide además responsable asignado; en reparto no. Un crédito con `branch_id` NULL no lo ve el supervisor salvo que sea suyo.
- Implica para la épica: el cálculo único debe fijar si «sin responsable» es visible para el subárbol; hoy no lo es en lectura (decisión de producto a documentar en G2).
- HUB: —

### H-02-03 · Quién escribe `credits.branch_id` (L-09)
- Clase: VERIFICADO (origen) / INFERIDO (que nunca se derive del responsable)
- Evidencia: `modules/credits/credits.service.ts:288` (alta: `dto.branchId`), `:463` (edición: `dto.branchId`), `modules/imports/portfolio-credit.ts:109` (importación: solo si la configuración del import tiene `scope.kind==='branch'`; si es `account` u `official` queda `undefined` → NULL), `modules/credits/dto/credit.dto.ts:44,102,125` (campo opcional `@IsUUID`). Búsqueda de `branchId` en `modules/assignments` no muestra ninguna escritura sobre `credit`.
- Hecho: `credits.branch_id` es opcional y viene del cliente (alta/edición) o del alcance de la importación; reasignar el responsable (`AssignmentService`) no la toca. No se valida que la oficina exista ni que sea del tenant en el alta de crédito (solo la FK).
- Implica para la épica: hoy un crédito puede tener oficina NULL (invisible al supervisor) y puede quedar con oficina distinta a la de su responsable. «Cada crédito en una única oficina hoja» (RULES §E) no se cumple por construcción; requiere regla de derivación o validación y un backfill.
- HUB: —

### H-02-04 · `payments.branch_id` es una foto del crédito al momento del pago
- Clase: VERIFICADO
- Evidencia: `modules/payments/payments.service.ts:174-182` (`branchId: credit.branchId` al insertar); `modules/analytics/analytics.service.ts:186` filtra pagos por `p.branch_id`.
- Hecho: el pago guarda su propia copia de la oficina; si después se cambia `credits.branch_id` o la jerarquía, los pagos históricos y la analítica de pagos quedan con la oficina antigua, mientras que los saldos (créditos) usan la nueva.
- Implica para la épica: mover créditos de oficina, o reestructurar el árbol, descuadra recaudo vs saldo por oficina. Decidir si se reescribe/deriva (por join al crédito) o se acepta la foto.
- HUB: —

### H-02-05 · Endpoints del módulo `branches` (todos los de oficina)
- Clase: VERIFICADO
- Evidencia: `modules/branches/branches.controller.ts:16-46`:
  - `GET /branches` → `user:read` (`:17`), lista plana con conteos (`branches.service.ts:63-69`)
  - `POST /branches` → `account:write` (`:23`) (`branches.service.ts:101-119`)
  - `PATCH /branches/:id` → `account:write` (`:29`) (`:121-146`)
  - `DELETE /branches/:id` → `account:write` (`:35-36`), baja lógica; falla si hay miembros activos (`:87-90,149-157`)
  - `POST /branches/:id/members` → `account:write` (`:43`) asigna varias personas (`:163-188`)
  - Quitar de oficina: `PATCH /users/:id` con `branchId: null` (`modules/users/users.service.ts:193-195`, permiso `user:write`: `@Patch(':id')` en `users.controller.ts` ~línea 107; ver 05).
  - Auditoría: `audit.record` en create/update/remove/assignMembers (`branches.service.ts:117,144,156,179`) y en el cambio de oficina vía PATCH (`users.service.ts:211-217`).
  - Reglas: código único entre vivas (`:78-84`), responsable = miembro activo (`:72-75`), `managerUserId` es referencia suave sin efecto de permisos.
- Hecho: el módulo es una lista plana por cuenta, sin padre, sin tipo/nivel, sin tope por plan, sin validación de profundidad; `managerUserId` no otorga alcance.
- Implica para la épica: hay que añadir padre/nivel y reemplazar `branchId` único de `user_accounts` por pertenencia N:M (R3); `PATCH /users/:id` y `POST /branches/:id/members` son los dos puntos que mutan pertenencia.
- HUB: —

### H-02-06 · Analítica: filtra por `branchId` pero NO aplica alcance del solicitante (L-16)
- Clase: VERIFICADO
- Evidencia: `modules/analytics/analytics.controller.ts:17-19` (`@Roles(Permission.REPORT_READ)` en toda la clase); `modules/analytics/analytics.service.ts:83-84` (`withTenant`), `:124-150` (`creditWhere`/`episodeWhere`: sin ninguna condición de usuario/alcance, solo `branchId` opcional y `collectorId`), `:183-190,201-207` (pagos), `:451` (`route_plans`); no hay importación de `moraScopeOf` ni uso de `DATA_SCOPE_*` en el archivo (grep global de `DATA_SCOPE` no lista analytics).
- Hecho: la analítica corre SQL directo sobre `credits`, `credit_arrear_episodes`, `payments`, `agenda_items`, `route_plans` acotada solo por tenant (RLS) y por filtros opcionales del request. Quien tiene `report:read` (MANAGER, SUPERVISOR, AUDITOR, VIEWER) ve el tenant completo, incluido un SUPERVISOR de otra agencia, aunque su alcance de datos sea BRANCH. Existen dos escrituras espejo del filtro (SQL y Prisma, `:192-200`).
- Implica para la épica: es el consumidor más grande sin alcance. Con árbol de oficinas, habrá que inyectar el conjunto de oficinas visibles en 5 funciones SQL y en el filtro Prisma espejo; el `branchId` del query debe validarse contra ese conjunto, no solo existir. Hoy es una fuga entre agencias (preexistente).
- HUB: —

### H-02-07 · Cartera, clientes, créditos y pagos NO tienen alcance por fila (L-13)
- Clase: VERIFICADO (negativo por búsqueda exhaustiva en `modules/`) — corrige el lead, que era NO VERIFICADO
- Evidencia: ningún uso de `moraScopeOf`/`moraAccessConditions`/`visibleCredits`/`DATA_SCOPE_*` fuera de mora, agenda, rutas, field-ops y assignments (grep de `moraScopeOf|moraAccessConditions|visibleCredits|assignScope|ownOnly` en `apps/api/src`). `modules/credits/credits.service.ts:327-339` (lista: solo filtros de query), `modules/clients/clients.service.ts:460` (filtro por query), `modules/payments` (sin alcance).
- Hecho: Cartera (créditos), Clientes y Pagos muestran todo el tenant a cualquiera que tenga `credit:read` / `client:read` / `payment:read`; el cobrador (que tiene esos permisos) los ve completos. Rutas: el listado se separa por permisos de ruta (`modules/routes/routes.service.ts:508-523`: `ROUTE_ASSIGN` ve todas; ejecutor sin `ROUTE_ASSIGN` ve las suyas) y NO por oficina; solo los créditos que se pueden elegir en una ruta pasan por el alcance de mora (`:483`).
- Implica para la épica: el modelo de alcance nuevo no puede suponer que «todo está filtrado por oficina hoy»; extenderlo a Cartera/Clientes/Pagos cambia comportamiento visible (hay que decidir si F13 lo hace o lo deja a F14/R6). Riesgo de regresión para equipos pequeños que hoy ven todo.
- HUB: —

### H-02-08 · La base no impone el alcance por oficina; el alcance «own» tampoco tiene policy (L-03 parte API)
- Clase: VERIFICADO
- Evidencia: `database/prisma.service.ts:93-97` (solo `ACCOUNT`/`OWN`/vacío; BRANCH se degrada a OWN); `packages/database/prisma/rls/002_scope.sql:7-9,43-51` («F1 solo define los helpers. Las policies llegan en F2»; `app_scope_sees_all()` contempla un `'branch'` futuro); grep de `app_current_scope|app_scope_sees_all|app_current_user` en `packages/database` solo aparece en `rls/002_scope.sql`. Ver detalle en 05.
- Hecho: `withTenant` fija `app.scope`, pero ninguna policy lo lee: el aislamiento dentro del tenant es 100 % de la aplicación.
- Implica para la épica: no hay red de seguridad en DB para el subárbol; un olvido en cualquier consumidor de H-02-01 es una fuga. Un cálculo único en app es la primera línea; RLS por alcance es fase posterior (R9).
- HUB: —

### H-02-09 · Qué recibe quien se registra solo (L-19)
- Clase: VERIFICADO
- Evidencia: `modules/accounts/accounts.service.ts:62-115`: crea `Account` con `accountType: 'INDEPENDENT'` (`:89`), plan FREE por defecto o prueba de 30 días (`:70-74,92`), `User`+`Profile`, y `userAccount` con `roleId` = `ACCOUNT_ADMIN`, `isOwner: true`, `isDefault: true` y **sin `branchId`** (`:113-115`). No crea ninguna `Branch`. Siembra rangos de mora (`:117-119`) y catálogos (`:122-125`).
- Hecho: el tenant individual es un `ACCOUNT_ADMIN` dueño, sin oficina; tiene todos los permisos, incluido `data:scope:all` (`packages/shared/src/constants/permissions.ts:18`).
- Implica para la épica: con alcance `ALL` y sin oficina, el individual no necesita ninguna asignación: la asignación implícita de R8/ADR-0004 puede ser «sin nodo = ALL» (equivalencia con lo actual). Importante: no puede exigirse una oficina raíz al registrarse sin tocar este flujo. Cuidado: hoy `branch_id` NULL en un supervisor significa «ve solo lo suyo» (fail-closed), distinto de NULL en un admin.
- HUB: —

### H-02-10 · Quién está en una oficina y cómo se mueve gente
- Clase: VERIFICADO
- Evidencia: `packages/database/prisma/schema.prisma:291` (`UserAccount.branchId String?`), `:304` (`@@unique([userId, accountId])`); `modules/users/users.service.ts:186-195` valida que la oficina exista y esté activa antes de asignar; `modules/branches/branches.service.ts:169-175`. Rol: `users.service.ts:143-147` y `:235` exigen `isMobileRole` (solo ACCOUNT_ADMIN, SUPERVISOR, COLLECTOR; `packages/shared/src/constants/roles.ts:11`).
- Hecho: una persona tiene un rol y una oficina por cuenta; el rol se cambia solo entre tres valores desde la API.
- Implica para la épica: R3/R8 (N:M y rol por asignación) requieren tabla nueva de asignaciones; `isMobileRole` debe revisarse porque bloquea asignar MANAGER/AUDITOR/VIEWER por API (relacionado con F14).
- HUB: —

### H-02-11 · Quién consume las oficinas de sesión/JWT en el backend
- Clase: VERIFICADO
- Evidencia: `modules/auth/auth.service.ts:34-45` (`MembershipRow` incluye `branch_id`) pero `modules/auth/token.service.ts:8-14` (`AccessClaims`: `sub, accountId, roleId, permissions, sessionId`, sin oficina); el alcance BRANCH relee `user_accounts.branch_id` en cada request (`assignment.service.ts:161-165`, `agenda.service.ts:177-181`, `mora-query.ts:138`).
- Hecho: la oficina no viaja en el token; se consulta a la base en cada cálculo (hasta 2 subconsultas por request).
- Implica para la épica: con subárbol conviene calcularlo una vez por request (cache por solicitud) y no embeber el conjunto en el JWT (cambia sin refrescar token). Detalle en 05 (H-05-05).
- HUB: —

### H-02-12 · Trabajos de sistema que recorren cartera y no pasan por alcance
- Clase: VERIFICADO (módulos) / NO VERIFICADO (contenido de cada job)
- Evidencia: `withSystemTenant` se usa en `database/prisma.service.ts:111`, `modules/accounts/account-requests.service.ts`, `modules/auth/auth.service.ts`; los trabajos de mora y plan están referenciados en `common/plan/*.service.ts` (`plan-lifecycle.service.ts:138`, `plan-usage-alerts.service.ts:85` buscan `ACCOUNT_ADMIN` por rol) y en el comentario de `prisma.service.ts:72-76` (job diario de mora).
- Hecho: los jobs corren con scope `system` (ve todo el tenant) y localizan al administrador por nombre de rol (`role: { name: 'ACCOUNT_ADMIN' }`).
- Implica para la épica: los jobs no deben depender de oficinas; los avisos a «administrador» por nombre de rol serán ambiguos si el rol pasa a ser por asignación (R8). Contenido exacto de cada job: ver 06.
- HUB: —

## Contradicciones y desconocidos

- **CONTRADICTORIO (confirma L-11):** `packages/shared/src/constants/plans.ts:12` dice «Sin `branches`: la función no existe en el producto» y el módulo `branches` existe y está activo (`branches.controller.ts`). Va a `09-brechas.md`.
- **CONTRADICTORIO menor:** `rls/002_scope.sql:45-47` habla del módulo de sucursales como «sin construir»; el módulo existe (`branches.service.ts:20-26`).
- **CONTRADICTORIO (doc vs código):** `branches.service.ts:23-24` y `docs/producto` dicen que el alcance «ve su agencia» cubre el producto; en código solo cubre Mora/Agenda/Rutas(selección de créditos)/Asignación (H-02-07).
- **DESCONOCIDO:** Si hay quien dependa de que `credits.branch_id` sea NULL (créditos importados sin oficina): contar filas en una base real. Responde: la usuaria/equipo de datos con un script `prisma/verify/`.
- **DESCONOCIDO:** Contenido exacto de los jobs `arrears:run` / `plan:lifecycle` (qué tablas escriben y si usan `branch_id`). Se atiende en 06.
- **DESCONOCIDO:** Gateway de WebSockets/notificaciones: no se halló `branchId` en `modules/notifications` (grep), pero no se leyó cómo se eligen destinatarios (`realtime.helpers.ts` se cita en `permissions.ts:11`); falta saber si notificaciones deben respetar el subárbol. Responde: lectura de `modules/notifications`.
- **DESCONOCIDO:** `modules/dashboards` (tableros guardados) y `modules/exports`: no se leyó si filtran por oficina más allá de `exports.service.ts:146` (solo exhibe).
