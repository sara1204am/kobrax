# Discovery · 06 · Sincronización e importación

> **Estado: COMPLETO 2026-11-02.** Método: `../../_framework/README.md` §2 · hallazgo = plantilla T1. Pistas previas: `00-leads.md` (L-15 resuelta aquí).
> Lente de tenant: (a) gratuito individual · (b) equipo/agencia pequeña · (c) tenant grande con varias oficinas. Solo lectura; no se ejecutó nada contra la DB.

## Resumen
La cartera entra **solo por archivo** (`POST /imports/portfolio`). La oficina del crédito importado sale **únicamente del «alcance» configurado** (`scope.kind === 'branch'`); el archivo puede traer una columna «Agencia» pero se descarta. El móvil sincroniza por cola con id fijado por el teléfono; no hay ingesta por API ni jobs en cola (solo `setInterval` en proceso y CLI).

## Hallazgos

### H-06-01 · Un único canal de entrada de cartera: archivo
- Clase: VERIFICADO
- Evidencia: `apps/api/src/modules/imports/portfolio-import.controller.ts:55-57` (`@Controller('imports/portfolio')`, guards JWT+Tenant+Roles); MIME aceptados PDF/XLSX/XLS/CSV/TXT (`:44-50`); grep de `ApiKey|x-api-key|webhook` en `apps/api/src` sin resultados de ingesta (2026-11-02)
- Hecho: la única ingesta masiva de cartera es el archivo; no hay endpoint de máquina, clave de API ni webhook de entrada. `CreditDataOrigin.API` está en el enum (`schema.prisma:562-567`) pero ningún código lo escribe (`portfolio-credit.ts:~99` fija `IMPORT`; `credits.service.ts:~287` solo `MANUAL`/`QUICK_BATCH`).
- Implica para la épica: una oficina que alimente cartera desde un sistema externo hoy solo puede hacerlo por archivo; `API` es un valor reservado, no una capacidad (confirma L-15).
- Lente: (a) alta manual o archivo propio · (b) archivo por asesor · (c) igual, sin canal de máquina.
- HUB: —

### H-06-02 · La oficina del crédito importado = alcance de la configuración, no del archivo
- Clase: VERIFICADO
- Evidencia: `portfolio-credit.ts:109` `branchId: scope.kind === 'branch' ? scope.ref : undefined`; `import-config.ts:23` `ScopeKind = 'official' | 'branch' | 'account'`; `portfolio-import.service.ts:1336` exige `scope.ref` si el alcance no es `account`; `portfolio-credit.spec.ts:77` afirma que no hay `branchId` fuera de alcance branch
- Hecho: un crédito nuevo nace con `branch_id` solo si la corrida fue configurada con alcance `branch`; con alcance `account` u `official` nace con `branch_id` NULL. La rama de actualización (`creditUpdateData`) no escribe `branchId` (búsqueda en el archivo, 2026-11-02).
- Implica para la épica: hoy un crédito importado por un cobrador (alcance forzado `official`) o por un administrador con alcance cuenta **queda sin oficina**; el alcance por oficina no lo verá si se filtra por `branch_id`. Confirma L-09 (origen: DTO/alcance, no responsable).
- Lente: (a) siempre `official`/me → `branch_id` NULL · (b) NULL salvo que el admin elija una agencia · (c) cada archivo debe elegir oficina a mano; no hay mapeo fila→oficina.
- HUB: —

### H-06-03 · La columna «Agencia» del archivo se parsea pero no se usa
- Clase: VERIFICADO
- Evidencia: `field-catalog.ts:44,70,122` (`branchLabel`, etiqueta «Agencia»); grep `branchLabel` en `apps/api/src`, `apps/web/src`, `apps/mobile/src`, `packages/shared/src`: solo esos 3 sitios (2026-11-02)
- Hecho: existe el campo `branchLabel` en el catálogo de campos del importador, sin ningún consumidor: no resuelve contra `branches` ni se guarda.
- Implica para la épica: hay un gancho natural «agencia por fila» ya parseado, pero sin lógica de resolución (nombre→oficina, ambigüedad con nombres repetidos como Central›Chuquisaca›Central, R10).
- Lente: irrelevante en (a); potencialmente clave en (c).
- HUB: —

### H-06-04 · Reparto y límite de agencia en la importación (`assertImportAgency`)
- Clase: VERIFICADO
- Evidencia: `import-agency.ts:15-33` (solo corre si `canAssign`; reasignaciones validadas con `assertAssignable`, nuevos con `assertAssigneesInAgency`; error `ASSIGNMENT_OUT_OF_AGENCY` 403, revierte la transacción); `import-assignment.ts:105-144` (`resolveImportOwnership`: quien no tiene `assignment:write` queda con alcance `official=yo`); `assignment.service.ts:160-165` (alcance ALL con `data:scope:all`, si no BRANCH con `user_accounts.branch_id` propio)
- Hecho: el único control de oficina en la importación es sobre **a quién se asigna** (el destinatario debe estar en la agencia del supervisor), no sobre la oficina del crédito creado. El límite usa la agencia única del usuario (`userAccount.branchId`, L-02).
- Implica para la épica: con usuario en N oficinas (R3) y asignación que cubre un subárbol (R4), `assertAssigneesInAgency`/`agencyViolations` (`assignment-rules.ts:58-71`, compara `branchId === scope.branchId`) debe rehacerse; es consumidor de HUB de alcance.
- Lente: (a) no corre (no reparte) · (b) supervisor limitado a su agencia · (c) lógica de igualdad simple, no jerárquica.
- HUB: pendiente de ubicar fila (consumidor de alcance por agencia; relacionar con HUB-009…016 según `02`/`05`).

### H-06-05 · Alcance de «ausentes» (PRESENT/ABSENT) usa `branch_id` o `assignedManagerId`
- Clase: VERIFICADO
- Evidencia: `portfolio-import.service.ts:309-310` (`inScope`: account→todos; official→`assignedManagerId===ref`; branch→`branchId===ref`); `:313-337` (si hay `externalAdvisorCode` guardado se reconoce por asesor); `schema.prisma:562-575` (`ExternalSyncStatus` PRESENT/ABSENT), `:885-912` (`CreditExternalSnapshot`, una fila por corrida y operación), `:941-960` (`ExternalAdvisorLink` código asesor→usuario)
- Hecho: qué créditos pasan a `ABSENT` (no venían en el último reporte de su alcance) depende de `branch_id` solo si la corrida es de alcance branch; igualdad exacta, sin jerarquía. Un reporte con código de asesor vinculado acota por asesor y ignora la oficina.
- Implica para la épica: créditos con `branch_id` NULL (H-06-02) nunca entran en un alcance `branch` y, por tanto, nunca se marcan ausentes por una corrida de oficina; mover créditos de oficina cambia qué corrida los «posee».
- Lente: (a) alcance `official` por asesor/yo · (b) idem o `account` · (c) alcance por oficina exige que `branch_id` esté poblado.
- HUB: —

### H-06-06 · Idempotencia del import y orden temporal por alcance
- Clase: VERIFICADO
- Evidencia: `portfolio-import.service.ts:231-250` (sha256 del archivo; `ClientImportRun` DONE con mismo `fileHash` → `idempotentSkip`; con asignaciones → 409 `ALREADY_APPLIED`); `:292-306` (`REPORT_OUTDATED` si la fecha de corte es anterior a la última DONE del **mismo `scope` texto**); identidad del crédito `(account_id, external_source, external_id)` índice único parcial (`schema.prisma:~836-842` comentario, migración `20260930000000_creditos_de_fuente_externa`)
- Hecho: el control de «reporte más viejo» y de re-aplicación usa el texto del alcance (`scopeLabel`), no el árbol de oficinas; la identidad externa del crédito es única en **toda la cuenta**, sin oficina.
- Implica para la épica: el mismo número de operación no puede existir en dos oficinas de la misma cuenta; dos oficinas con reportes del mismo sistema comparten espacio de identidad (importa para el caso Central/regionales/agencias R10).
- Lente: (a)(b) sin efecto · (c) posible colisión entre oficinas si el sistema origen repite números.
- HUB: —

### H-06-07 · Import de clientes (CSV) es aparte y sin oficina
- Clase: VERIFICADO
- Evidencia: `apps/api/src/modules/clients/import/` (16 archivos .ts en `modules/clients`, con `client-import.service.ts`); grep `branchId` en `modules/clients/import/*.ts`: sin resultados (2026-11-02); `clients.service.ts:460-463` filtra por `k.branch_id` en una subconsulta (tabla de la colección del cliente)
- Hecho: el import de clientes no asigna oficina; el cliente se relaciona con oficina solo vía créditos/colecciones.
- Implica para la épica: verificar en `01-modelo-datos` a qué tabla pertenece `k.branch_id`; el cliente no tiene oficina propia.
- Lente: (a) irrelevante · (b)(c) un cliente puede aparecer en varias oficinas a través de sus créditos.
- HUB: —

### H-06-08 · Sync móvil: cola con id del teléfono; el móvil no maneja oficina
- Clase: VERIFICADO
- Evidencia: `apps/mobile/src/sync/queue.ts:1-25` (todo lo encolable es idempotente/append-only; `id` generado UNA vez con `nuevoId()`; pagos usan `Idempotency-Key`; ediciones con valores fijos; visita compuesta re-encola sus partes fallidas como ítems independientes); `payments.controller.ts`/`payments.service.ts` aceptan `Idempotency-Key` (grep); `apps/mobile/src/routes.service.ts:51,63` envía `branchId?` opcional en `generateRoute`/`createRoute`; grep `branchId|branch_id` en `apps/mobile/src`: solo `routes.service.ts` (2026-11-02)
- Hecho: el móvil no lee, guarda ni filtra oficinas salvo el `branchId` opcional al crear rutas; la oficina de cada crédito/visita la fija el servidor. El servidor es la autoridad de permisos (B9).
- Implica para la épica: cambiar el modelo de oficinas **no exige migrar la cola** del móvil mientras el servidor derive la oficina; el riesgo está en pantallas del móvil sin filtro por permiso (L-14 → `04`) y en créditos creados offline con `dto.branchId` (`credits.service.ts:288`).
- Lente: (a) el cobrador individual opera 100% por cola · (b)(c) misma cola; sin contexto de oficina en el teléfono.
- HUB: —

### H-06-09 · Alta de crédito manual/móvil toma `branchId` del DTO
- Clase: VERIFICADO
- Evidencia: `credits.service.ts:281-289` (`...(dto.id ? { id: dto.id } : {})`, `branchId: dto.branchId`); `assertRoom('credits', tx, { soft: Boolean(dto.id) })` (`:276-277`) — el crédito con id del móvil nunca se rechaza por tope de plan
- Hecho: la oficina del crédito manual la decide el cliente (web/móvil) y el servidor no la valida contra el alcance del usuario (en este fragmento; validación de pertenencia: ver `02`/`05`).
- Implica para la épica: punto de enganche de «oficina del crédito» en alta; nace NULL si el cliente no la manda.
- Lente: (a) NULL siempre · (b) NULL o agencia · (c) obligatorio en el diseño futuro.
- HUB: —

### H-06-10 · Trabajos de fondo: `setInterval` en proceso y CLI, sin cola
- Clase: VERIFICADO
- Evidencia: `setInterval(() => void this.run(), …)` en `plan-lifecycle.service.ts:58`, `agenda-overdue.service.ts:38`, `installment-reminders.service.ts:58`, `arrears-job.service.ts:80`, `assignment.service.ts:96`, `promise-due.service.ts:39`; scripts `arrears:run`, `plan:lifecycle`, `db:backup`, `plan:set`, `account:suspend`, `request:handle` en `apps/api/package.json`; grep `@Cron|BullMQ|@nestjs/schedule`: sin resultados
- Hecho: los trabajos periódicos corren dentro del proceso de la API; con más de una instancia correrían duplicados (no hay lock distribuido visible). Redis solo se usa para rate-limit y health (`rate-limit.guard.ts:5`, `health.controller.ts:2`).
- Implica para la épica: ningún trabajo está particionado por oficina; el job de mora procesa por cuenta. Escalar a varias réplicas (08) exige revisar estos temporizadores.
- Lente: (c) el tenant grande es el que presiona la escala.
- HUB: —

## Contradicciones y desconocidos
- **RESUELTO D-06-1:** `creditUpdateData` (`portfolio-credit.ts:132`, función completa) no menciona `branch`, y en `portfolio-import.service.ts` `branchId` solo aparece en lecturas (`:309,310,319`). VERIFICADO 2026-11-02: la re-importación nunca cambia la oficina de un crédito existente; solo la fija en la creación.
- **DESCONOCIDO D-06-2:** dónde está la fila del HUB para el consumidor `assertAssigneesInAgency` (H-06-04); lo cierra quien consolide el HUB.
- **No contradictorio:** L-15 confirmada (solo archivo; `API` reservado; trabajos por CLI/intervalo). Corrección a L-15: tampoco hay `@Cron`; los trabajos son `setInterval` internos (H-06-10).
