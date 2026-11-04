# Discovery · 01 · Modelo de datos

> **Estado: COMPLETO 2026-11-02** (solo código; no se consultó ninguna base). Método: `../../_framework/README.md` §2 (clases de evidencia) · hallazgo = plantilla T1.
> Pistas previas relacionadas: ver `00-leads.md`. No cuentan como hallazgos.

## Qué debe responder
- Todas las tablas, columnas, índices y restricciones que mencionan oficina, usuario-cuenta, rol, alcance o plan.
- Cuáles son nulables y por qué; cómo se llena `branch_id` hoy en créditos, pagos y rutas.
- Qué policies RLS existen, en qué tablas y qué alcance leen.
- Qué migraciones tocaron oficinas/alcance y qué hace cada script de `prisma/verify/`.
- Qué datos reales existen hoy (cuentas con y sin oficinas) — solo lectura. **No respondido: no se consultó la base (ver D-01).**

## Fuentes a leer (el código manda sobre los documentos)
- `packages/database/prisma/schema.prisma`, `migrations/`, `rls/`, `verify/`, `seed*.ts`
- `docs/producto/modelo-de-datos.md` (contraste)

## Lente de tenant (obligatoria en cada hallazgo)
¿Cómo se comporta esto hoy para: (a) tenant gratuito individual, (b) equipo/agencia pequeña, (c) tenant grande con varias oficinas?

## Hallazgos

Convención: `S` = `packages/database/prisma/schema.prisma`. Fecha de todas las lecturas: 2026-11-02.

### H-datos-01 · Branch es una lista plana por cuenta (resuelve L-01)
- Clase: VERIFICADO
- Evidencia: S:134-155 (`model Branch`: id, accountId, name, code?, city?, address?, managerUserId? sin FK, active, timestamps, deletedAt; índices `(account_id)` y `(account_id, active)`); `migrations/20261021110000_branch_code_unique` (único parcial `(account_id, code)` WHERE code NOT NULL AND deleted_at NULL); `migrations/20260616030000_add_partial_active_indexes` (índice parcial `(account_id)` WHERE deleted_at NULL); FK `branches.account_id` RESTRICT (`20260616022844_init_pillars_1_to_4/migration.sql:730`).
- Hecho: no existe `parent_id`, tipo/nivel, ruta ni profundidad; la única relación entre oficinas es pertenecer a la misma cuenta. Relaciones inversas solo con `UserAccount`, `Credit`, `RoutePlan`.
- Implica para la épica: el árbol exige columnas nuevas (padre, nivel/tipo configurable por R1) o tabla de cierre; `managerUserId` suave no sirve como pertenencia.
- Lente: (a) la cuenta FREE no tiene oficinas; (b) lista plana basta; (c) no hay forma de expresar Central › Regional › Agencia (R10).
- HUB: —

### H-datos-02 · Un usuario tiene UNA oficina por cuenta, nulable (resuelve L-02)
- Clase: VERIFICADO
- Evidencia: S:284-305 `UserAccount`: `branchId String?` (S:291), relación a `Branch?` (S:302), `@@unique([userId, accountId])` (S:304), índices `(accountId)` y `(accountId, roleId)`. FK `user_accounts_branch_id_fkey` ON DELETE SET NULL (`init…/migration.sql:760`). No hay índice sobre `branch_id`.
- Hecho: la membresía usuario-cuenta lleva un único rol (`roleId` NOT NULL) y una única oficina opcional; no existe tabla puente usuario↔oficina.
- Implica para la épica: R3 (N:M) y R8 (rol por asignación) requieren tabla nueva `usuario+oficina+rol`; `user_accounts.branch_id` y `role_id` quedan como legado a migrar o derivar. `@@unique([userId, accountId])` impide dos filas por cuenta.
- Lente: (a) el dueño tiene branch NULL y rol ACCOUNT_ADMIN; (b) NULL o una oficina; (c) imposible estar en dos.
- HUB: —

### H-datos-03 · Rol global; `level` sin uso jerárquico aparente (resuelve L-06)
- Clase: VERIFICADO (modelo) / INFERIDO (que `level` no se use en guards: solo se buscó en `apps/api/src`)
- Evidencia: S:215-227 `Role`: `name @unique` global, sin `accountId`, `level Int @default(0)`, `isSystem`. `seed.ts:114-121` fija niveles SUPER_ADMIN 100, ACCOUNT_ADMIN 90, MANAGER 70, SUPERVISOR 50, COLLECTOR 30, AUDITOR 20, VIEWER 10; `seed.ts:1855` los upserta por nombre. Usos de `level` hallados: serializar (`users.serializer.ts:46`) y ordenar roles móviles (`users.service.ts:429`). `Permission` tiene `scope PermissionScope` (enum GLOBAL/ACCOUNT/BRANCH/OWN, S:66-71, campo S:239); `RolePermission` PK `(roleId, permissionId)`; overrides por usuario en S:266-282 (`accountId?`, `granted`, `expiresAt`).
- Hecho: los 7 roles son filas compartidas por todas las cuentas; el rol de una persona vive en `user_accounts.role_id`. SUPER_ADMIN es un rol dentro de la cuenta con todos los permisos (`shared/constants/permissions.ts:16`), no un operador de plataforma.
- Implica para la épica: «solo el super admin crea oficinas» (R5) debe precisar si es el rol SUPER_ADMIN de la cuenta o el dueño (`isOwner`). `level` no se puede usar como jerarquía sin verificar.
- Lente: (a) un solo usuario ACCOUNT_ADMIN; (b) roles globales; (c) mismo rol = mismo poder en todas las oficinas.
- HUB: —

### H-datos-04 · `branch_id` en créditos, pagos y rutas: nulable, sin índice, lo escribe el creador o se hereda
- Clase: VERIFICADO
- Evidencia:
  - `credits.branch_id` TEXT NULL: S:808, relación S:856, FK SET NULL (`init…:799`). Se llena en alta manual con `dto.branchId` (`credits.service.ts:288`); en importación de cartera solo si el alcance del archivo es `branch:<id>` (`portfolio-credit.ts:109`); en seeds, la oficina del responsable (`seed.ts:725,1050`). No se halló derivación desde `assigned_manager_id`.
  - `payments.branch_id` TEXT NULL: S:1528, SIN relación Prisma ni FK en base (no figura entre las FK de `init…:760-826`). Se copia del crédito al insertar (`payments.service.ts:174-182`).
  - `route_plans.branch_id` TEXT NULL: S:1331, relación S:1350, FK SET NULL (`init…:826`). Se llena con `dto.branchId` en ambas altas (`routes.service.ts:307,375`); si el cliente no lo manda queda NULL.
  - `collection_cases.branch_id` existió en `init` y la tabla fue eliminada (`20261005000000_eliminar_caso`, referida en `verify/sin-caso-contraccion.sql:2`).
  - Ningún `@@index` del schema ni `CREATE INDEX` de migración incluye `branch_id`.
  - `client_import_runs.scope` (S:433) es texto libre `branch:<id>` / `official:<id>`; índice S:466.
- Hecho: la oficina de un crédito, pago o ruta es una denormalización opcional escrita por quien crea el registro; no hay trigger ni derivación desde el responsable.
- Implica para la épica: filtrar por subárbol exige índices nuevos y backfill; un crédito con `branch_id` NULL no entra en el alcance de oficina de nadie (ver H-datos-06).
- Lente: (a) siempre NULL; (b) NULL si nadie la mandó; (c) riesgo de cartera sin oficina.
- HUB: —

### H-datos-05 · RLS: solo aislamiento por cuenta; ninguna policy lee alcance (resuelve L-03 parte datos)
- Clase: VERIFICADO (archivos de `rls/` y migraciones leídos; grep en `packages/` y `apps/`)
- Evidencia:
  - `rls/001_enable_rls.sql`: crea `app_current_account()` y, en un bucle sobre ~50 tablas (entre ellas `branches`, `user_accounts`, `credits`, `payments`, `route_plans`, `credit_assignments`), hace `ENABLE`+`FORCE RLS` y una única policy `tenant_isolation USING/WITH CHECK (account_id = app_current_account())` más GRANT a `kobrax_app`. Además `accounts` (`tenant_self`: `id = app_current_account()`) y `user_permission_overrides` (`account_id IS NULL OR = app_current_account()`).
  - Tablas globales sin RLS: users, profiles, roles, permissions, role_permissions, mfa_backup_codes, password_reset_tokens (`001`, `003`).
  - `rls/002_scope.sql`: define `app_current_user()`, `app_current_scope()` (documenta solo `account|own|system`) y `app_scope_sees_all()` (`scope IN ('account','system')`); el archivo dice «F1 sólo define los helpers. Las policies llegan en F2» y anota que `'branch'` se tocará aquí cuando exista el módulo de sucursales.
  - `rls/002_auth_functions.sql`: `auth_memberships(user_id)` SECURITY DEFINER devuelve `branch_id` y `role_id` por membresía. `003`: `auth_user_sessions`. `004`: `promise_due_account_ids()`.
  - Migraciones con policies, todas `tenant_isolation` por `account_id`: client_import_runs, agenda_items, catalog_items, client_import_run_items, route_change_requests, device_push_tokens, client_income_profiles, account_requests.
  - `app_current_scope|app_scope_sees_all|app.scope` aparecen solo en `002_scope.sql`, `prisma.service.ts:140` y `prisma-scope.spec.ts`.
  - Runtime: `prisma.service.ts` fija `app.scope` en ACCOUNT si el JWT trae `data:scope:all`, si no OWN (`~:93-97`), o `system` con `withSystemTenant`. Nunca emite `branch`.
- Hecho: ninguna policy depende del alcance; el alcance por oficina se aplica solo en consultas de la API.
- Implica para la épica: agregar nodos no toca RLS (sigue por `account_id`); el alcance por subárbol puede ir en la API (R9 deja RLS por alcance para después). Toda tabla nueva debe sumarse a la lista de `001_enable_rls.sql` (se re-ejecuta) o llevar su policy en la migración.
- Lente: (a)(b)(c) idénticos: el aislamiento real es entre cuentas.
- HUB: —

### H-datos-06 · El alcance BRANCH se resuelve en la API por igualdad con `user_accounts.branch_id`
- Clase: VERIFICADO
- Evidencia: `mora-query.ts:127-143` (`moraAccessConditions`): BRANCH = lo mío OR (`assigned_manager_id IS NOT NULL AND cr.branch_id IS NOT NULL AND cr.branch_id = (SELECT ua.branch_id FROM user_accounts … LIMIT 1)`); un supervisor sin oficina ve solo lo suyo. `assignment.service.ts:160-165` y `agenda.service.ts:175-181` devuelven `{kind:'BRANCH', branchId: me.branchId}` y comparan con igualdad estricta (`assignment-rules.ts:68`). Migración `20261004010000_alcance_supervisor_agencia` quita `data:scope:all` y da `data:scope:branch` (enum BRANCH) a SUPERVISOR; `verify/alcance-supervisor-agencia.sql` lo comprueba.
- Hecho: «mi oficina» es igualdad con UNA `branch_id`; no existe subárbol y la subconsulta usa `LIMIT 1` (asume una sola membresía por cuenta).
- Implica para la épica: sitios a cambiar de igualdad a «en el conjunto de oficinas visibles»: `mora-query.ts:127-143,203`, `assignment.service.ts`, `agenda.service.ts`, `assignment-rules.ts`, y los filtros `branchId` de `credits.service.ts:332`, `clients.service.ts:460`, `analytics.service.ts:126,144,186,204,451`.
- Lente: (a) no aplica; (b) el supervisor ve su agencia; (c) no existe el supervisor regional.
- HUB: —

### H-datos-07 · Migraciones que tocan oficinas o alcance
- Clase: VERIFICADO
- Evidencia: `20260616022844_init_pillars_1_to_4` (crea `branches`, `PermissionScope`, `branch_id` en user_accounts, credits, collection_cases, route_plans, payments; FKs SET NULL salvo payments); `20260616030000_add_partial_active_indexes`; `20261004010000_alcance_supervisor_agencia` (solo datos: permisos); `20261021110000_branch_code_unique` (único parcial); `20260820000000_el_plan_manda_los_topes` (mueve `max_users` a `limits_override`; no menciona oficinas). Ninguna otra migración contiene `branch_id` ni `branches` (grep).
- Hecho: no hay migración que añada jerarquía, N:M ni tope de oficinas.
- Implica para la épica: la primera migración de F13 parte de un esquema sin precedentes de jerarquía; el único índice único es el del código.
- HUB: —

### H-datos-08 · Scripts de `prisma/verify/`, `rls/verify_isolation.sql` y auditorías
- Clase: VERIFICADO (cabeceras y cuerpos leídos)
- Evidencia:
  - `verify/alcance-supervisor-agencia.sql`: solo lee; falla si SUPERVISOR no tiene `data:scope:branch` o conserva `all`, si MANAGER/ACCOUNT_ADMIN/SUPER_ADMIN no tienen `all`, o si COLLECTOR tiene alguno.
  - `verify/arrear_episodes.sql`: prueba el trigger de episodios de mora en una transacción con ROLLBACK (no usa oficinas).
  - `verify/sin-caso-contraccion.sql`: comprueba que `collection_cases` desapareció tras `20261005000000_eliminar_caso` (solo lee).
  - `verify/seed-sin-caso.sql`: valida el seed DEMO; exige ≥2 agencias con supervisor, 0 cobradores/supervisores sin `branch_id`, 0 créditos DEMO sin `branch_id`, responsables en ≥2 agencias (~líneas 180-215).
  - `rls/verify_isolation.sql`: crea Tenant B y comprueba aislamiento de `clients`, `credit_activities`, `arrear_categories` (DEMO / Tenant B / sin contexto); no prueba alcance.
  - `audit-assignments.ts` (responsable vs `assigned_manager_id`), `audit-psf.ts` (cartera PSF, `--apply`), `backfill-catalogs.ts`, `rebuild.ts` (esquema vacío → migraciones → `rls/*.sql` → seed), `pii.ts` (helper de cifrado). Ninguno audita `branch_id`.
- Hecho: las únicas verificaciones ligadas a oficinas son la del seed DEMO y la del reparto de permisos de alcance.
- Implica para la épica: hace falta un verify de integridad del árbol (sin ciclos, mismo `account_id`); `seed-sin-caso.sql` se rompería si el seed deja de tener agencias planas con esas condiciones.
- HUB: —

### H-datos-09 · Rol y oficina de quien se registra solo (resuelve L-19)
- Clase: VERIFICADO
- Evidencia: `accounts.service.ts:75` (`role.findUnique({name:'ACCOUNT_ADMIN'})`) y `:113-115` (`userAccount.create({userId, accountId, roleId, isOwner:true, isDefault:true})`), sin `branchId`. La invitación crea la fila con `isDefault:true` y sin oficina (`users.service.ts:264-267`). La cuenta nace `accountType:'INDEPENDENT'`, con plan elegido (FREE permanente), categorías de mora y catálogos por defecto, sin `Branch` (`accounts.service.ts:85-130`).
- Hecho: el autoregistro da ACCOUNT_ADMIN + `isOwner`, `branch_id` NULL y cero oficinas.
- Implica para la épica: un tenant gratuito debe seguir funcionando con CERO nodos y alcance implícito de cuenta. R5 (solo super admin crea oficinas) choca con que hoy las oficinas se crean con `account:write` (`branches.controller.ts:22-43`), que tiene ACCOUNT_ADMIN; y el dueño autoregistrado no es SUPER_ADMIN.
- Lente: (a) cero oficinas; (b) el admin crea agencias hoy; (c) idem.
- HUB: —

### H-datos-10 · Plan y oficinas: sin tope ni columna (cruza con L-11/L-12)
- Clase: VERIFICADO (código) / CONTRADICTORIO con documentos
- Evidencia: S:42 `enum PlanCode`; S:81 `planCode @default(FREE)`; S:84 `limitsOverride Json?` (forma validada fuera de la base); `shared/constants/plans.ts:12` («Sin `branches`: la función no existe en el producto») frente a `modules/branches` (alta, edición, baja, miembros; `branches.controller.ts:16-43`). `accounts.max_users` pasó a `limits_override` (`20260820…`).
- Hecho: ningún campo ni constraint limita la cantidad de oficinas por plan; `plans.ts` está desfasado respecto del código.
- Implica para la épica: un tope por plan iría en `limits_override` o el catálogo de plan, no en una columna nueva. La contradicción pasa a 09.
- Lente: (a) FREE sin tope declarado; (b)(c) sin tope aplicado.
- HUB: —

### H-datos-11 · Baja de oficina y huérfanos
- Clase: VERIFICADO
- Evidencia: `branches.service.ts:87-90,148-156`: la baja es lógica (`deletedAt`, `active=false`) y solo exige 0 miembros activos (`assertEmpty`); no revisa créditos ni rutas; el comentario dice que créditos y rutas conservan su referencia. `assignMembers` mueve `user_accounts.branch_id` y audita el antes (`:171-184`).
- Hecho: créditos y rutas pueden apuntar a una oficina dada de baja.
- Implica para la épica: mover o dar de baja un nodo con hijos y datos requiere reglas nuevas (reasignar subárbol).
- Lente: (a) no aplica; (b) pocas oficinas; (c) riesgo mayor.
- HUB: —

### H-datos-12 · Seeds: oficinas planas, una oficina por usuario
- Clase: VERIFICADO
- Evidencia: `seed.ts:1901-1906` crea `CEN` y `ALT` (DEMO) y `NOR` (DEMO2) con `ensureBranch`; `seed.ts:1918-1943` crea membresías con un `branchId`; `seed.ts:226-241` asigna cada cobrador/supervisor a CEN o ALT; `maria` está en dos cuentas (DEMO y DEMO2), no en dos oficinas (`:231`); `seed-demo-rutas.ts:248-266` usa CEN; `managerUserId` se fija en `seed.ts:1939-1940`.
- Hecho: el seed no tiene jerarquía ni usuarios en varias oficinas; el caso R10 (Central › La Paz/Cochabamba/Chuquisaca › 6 agencias) no existe.
- Implica para la épica: el seed R10 reemplaza o extiende estos y debe dejar verde `verify/seed-sin-caso.sql`.
- Lente: (a) el seed no modela un tenant gratuito; (b) DEMO; (c) ninguno.
- HUB: —

### H-datos-13 · La oficina es del crédito, no del cliente ni de la gestión
- Clase: VERIFICADO (por ausencia: solo hay `branch_id` en S:291,808,1331,1528 y `managerUserId` en S:140)
- Evidencia: S:986 `CreditAssignment` (responsable por crédito); `agenda_items`, `field_visits`, `client_*`, `credit_activities` no tienen `branch_id`. `clients.service.ts:460-463` filtra clientes por oficina con `EXISTS` sobre `credits.branch_id`.
- Hecho: un cliente no tiene oficina propia; la deriva de sus créditos.
- Implica para la épica: R4 (cliente urgente de distintas agencias bajo una regional) es compatible con este modelo, porque la oficina es del crédito.
- Lente: (a) irrelevante; (b)(c) un cliente puede aparecer en dos oficinas si tiene créditos en ambas.
- HUB: —

## Contradicciones y desconocidos

**Contradicciones**
- C-01 (L-11): `plans.ts:12` dice que sucursales no existen como función; existe el módulo `branches` completo. Resuelta a favor del código.
- C-02: `rls/002_scope.sql` anuncia policies de alcance (F2) y un valor `'branch'` que el código nunca emite. Es un plan viejo sin ejecutar, no una funcionalidad.
- C-03: `types/auth.types.ts` define `AuthUser.branchId?` pero `JwtPayload` no lo trae; `auth_memberships` sí devuelve `branch_id`. No se verificó si se rellena `AuthUser.branchId` (pasa a 05).

**Desconocidos**
- D-01: datos reales (cuántas cuentas tienen oficinas; cuántos créditos y rutas con `branch_id` NULL). Requiere SQL de solo lectura que ejecute la usuaria; no se consultó.
- D-02: si `Role.level` se usa en algún guard fuera de `apps/api/src` (L-20, pasa a 05).
- D-03: si el JWT/sesión debe cargar la(s) oficina(s) activa(s) (R3/R9, pasa a 05).
- D-04: por qué `payments.branch_id` no tiene FK (¿omisión o ledger inmutable a propósito?).
- D-05: profundidad y tamaño esperados del árbol (R1) para elegir entre adyacencia, ruta materializada o tabla de cierre; decide la usuaria en G2.
- D-06: consumidores móviles de `branchId` en DTOs (pasa a 04).
