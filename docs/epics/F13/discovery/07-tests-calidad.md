# Discovery · 07 · Tests y calidad

> **Estado: COMPLETO 2026-11-02.** Método: `../../_framework/README.md` §2 · hallazgo = plantilla T1. Pistas: L-17 (confirmada, H-07-02).
> Lente de tenant: (a) gratuito individual · (b) equipo/agencia pequeña · (c) tenant grande con varias oficinas.
> Se ejecutaron type-check y tests unitarios (no tocan DB). NO se ejecutaron migraciones ni tests de integración.

## Línea base real (ejecutada 2026-11-02, rama `f13/p0-discovery`, commit `bfbfdf4`)
| Comando | Resultado real |
|---|---|
| `pnpm --filter @kobrax/api test` | PASS · `# tests 1732 · pass 1732 · fail 0` (142 s) |
| `pnpm --filter @kobrax/api type-check` | PASS · exit 0 |
| `pnpm --filter @kobrax/database type-check` | PASS · exit 0 |
| `pnpm --filter @kobrax/shared test` | PASS · `Test Files 35 passed · Tests 451 passed` |
| `pnpm --filter @kobrax/shared type-check` | PASS (sin errores) |
| `pnpm --filter @kobrax/web test` | **FAIL** · `Test Files 2 failed, 113 passed (115) · Tests 7 failed, 1177 passed (1184)` (reproducido 2 veces) |
| `pnpm --filter @kobrax/web type-check` | **FAIL** · exit 2, 8 errores TS2307, **todos** en `.next/types/**` (artefactos generados obsoletos, p. ej. `settings/perfil/seguridad/page`); 0 errores en `src/` |
| `pnpm --filter @kobrax/mobile test` | PASS · `Test Suites 82 passed · Tests 977 passed` |
| `pnpm --filter @kobrax/mobile type-check` | **FAIL** · 2 errores en `app/cuenta/datos.tsx(21,44)` (TS2740: `AccountForm` exige `logoUrl, phone, email, website` y 2 más) |
| `lint` (todos los paquetes con script) | placeholder: `echo "(lint placeholder)"` — no valida nada |

## Hallazgos

### H-07-01 · Suite de la API: 98 specs en disco, 97 en el script `test`
- Clase: VERIFICADO
- Evidencia: `find apps/api/src -name '*.spec.ts'` = 98; `grep -o 'src/…spec.ts' apps/api/package.json` = 97 únicos; diferencia: `src/modules/agenda/agenda-overdue.spec.ts` existe y **no está en el script** (2026-11-02)
- Hecho: un spec de la API nunca corre en `pnpm test` (B12 ya manifestada).
- Implica para la épica: todo spec nuevo de F13 debe agregarse a mano; hoy hay un huérfano preexistente (ajeno a F13, no tocar sin plan).
- Lente: sin efecto directo en (a)(b)(c); es riesgo de regresión silenciosa.
- HUB: —

### H-07-02 · El script `test` lista archivo por archivo (L-17)
- Clase: VERIFICADO
- Evidencia: `apps/api/package.json` script `test` = `node --import tsx --test <97 rutas>`; `test:integration` = `nest build && node --import tsx --test --test-concurrency=1` con 9 `.it.ts` listados
- Hecho: runner nativo de Node con `tsx`, sin glob; los scripts de integración también se listan a mano.
- Implica para la épica: confirma L-17 y B12.
- HUB: —

### H-07-03 · Specs de API que tocan oficina/alcance
- Clase: VERIFICADO (lectura de títulos y conteo de menciones; no se auditó cada aserción)
- Evidencia (menciones `branch`/`agencia`/`scope`, 2026-11-02):
  - `src/database/prisma-scope.spec.ts:55-119` — contexto RLS: parámetros ligados, 3 variables, `scope=account` solo con `data:scope:all`, `own` para cobrador, sin contexto → vacío (DENY), contrato de exactamente tres scopes. **Protege B2** (fail-closed) y el hecho de que RLS no tiene `branch`.
  - `src/modules/mora/mora-scope-presets.spec.ts:19-80` — presets: SUPERVISOR = branch, no all; gerente/admin = all; cobrador ninguno; migración `20261004010000_alcance_supervisor_agencia` leída como texto (SQL por regex), seed y script verify.
  - `src/modules/mora/mora-query.spec.ts` (12 menciones) — filtro de mora por alcance/branch.
  - `src/modules/assignments/assignment.coverage.spec.ts` (18) y `assignment.service.spec.ts`, `assignment.bulk.spec.ts` — D8: supervisor solo reparte en su agencia (`:274`).
  - `src/modules/branches/branches.service.spec.ts` (≈20 casos) — alta/edición/baja/asignar miembros, código único, no desactivar con miembros activos, DTOs.
  - `src/modules/users/users.service.spec.ts` (16), `agenda.service.spec.ts` (14), `payments.service.spec.ts` (4), `clients.service.spec.ts` (2), `analytics.service.spec.ts` (1), `auth.service.spec.ts` (1), `routes.service.spec.ts` (0 con `branch`).
  - `src/modules/imports/import-agency.spec.ts`, `portfolio-credit.spec.ts:77` (sin `branchId` fuera de alcance branch), `import-assignment.spec.ts`.
  - `src/modules/permission-gates.spec.ts` — puertas por permiso del cobrador (no de oficina).
- Hecho: la cobertura de alcance por oficina es **unitaria con mocks**; no hay un spec que ejercite jerarquía, N:M usuario↔oficina ni alcance de subárbol (no existen en el modelo actual).
- Implica para la épica: los specs de `mora-query`, `assignment.coverage`, `users`, `agenda` y `branches` son la red de seguridad actual de la igualdad plana `branchId === scope.branchId`; un cambio de alcance los romperá a propósito y deben actualizarse con intención (A4/B14).
- Lente: (a) cubierto por specs de cobrador/`own`; (b) supervisor-agencia cubierto; (c) nada cubre varias oficinas anidadas.
- HUB: relacionar con HUB-009…016 (B14).

### H-07-04 · Aislamiento entre tenants: SQL y integración, no unitario
- Clase: VERIFICADO (existencia) / NO VERIFICADO (contenido de `verify_isolation.sql`)
- Evidencia: `packages/database/prisma/rls/verify_isolation.sql`; `packages/database/prisma/verify/{alcance-supervisor-agencia,arrear_episodes,seed-sin-caso,sin-caso-contraccion}.sql`; en `packages/database/package.json:26-27` solo `db:verify:seed` y `db:verify:contraccion` están cableados a script; `alcance-supervisor-agencia.sql` y `arrear_episodes.sql` se corren a mano con `psql -f` (cabecera del archivo)
- Hecho: la verificación de datos/RLS requiere DB viva y no está en `turbo test`.
- Implica para la épica: toda migración de F13 necesita su verify en `prisma/verify/` (B8) y su ejecución queda en `execution/VERIFICATIONS.md`.
- HUB: —

### H-07-05 · Integración API: 9 archivos `.it.ts`, requieren Postgres/Redis y API compilada
- Clase: VERIFICADO (leído `harness.ts:1-25`; **no ejecutado**)
- Evidencia: `apps/api/test/integration/*.it.ts` (import-assignment, arrear-episodes, agenda-route, route-lifecycle, push-devices, catalogs-signup, client-collection-profile, client-income-profile, activity-context); `harness.ts` crea la base `kobrax_it` de cero con migraciones+RLS+seed y levanta `node dist/main.js`
- Hecho: ninguno de los 9 trata oficinas ni aislamiento multi-tenant explícito (`catalogs-signup.it.ts` menciona `scope`; `import-assignment.it.ts` cubre import con reparto).
- Implica para la épica: no existe prueba de integración de alcance por oficina; la regresión end-to-end de G5 debe crearse. Correrlas toca una DB `kobrax_it` (no la de desarrollo) — aun así, queda fuera de Discovery.
- Lente: (a) signup/catálogos cubierto en parte; (b)(c) sin cobertura.
- HUB: —

### H-07-06 · Web: 115 archivos de test (vitest); 7 fallan hoy
- Clase: VERIFICADO
- Evidencia: `pnpm --filter @kobrax/web test` 2026-11-02 (arriba). Fallan `src/app/(panel)/mora/arrears-table.test.tsx` (6 casos: `Found multiple elements with the role "button" and name /Filtros/i`) y `src/app/(panel)/rutas/today-board.test.tsx` (1 caso: `expected [Array(3)] to have a length of 2 but got 3`). Pasan los 43 archivos de `cuenta` y `lib` (563 tests).
- Hecho: la suite web no está en verde en el commit base. Causa probable: el commit `a13d88c` («los filtros de las tablas arrancan abiertos por defecto») dejó dos tests obsoletos (hay dos botones «Filtros»/«Cerrar filtros»). Esto último es INFERIDO (coincidencia temporal y mensaje); no se confirmó la causa del caso de `today-board`.
- Implica para la épica: la línea base de regresión web tiene 7 fallos **preexistentes**; G5 debe compararse contra esta lista, no contra «0 fallos». Toda fase que toque web debe decidir quién repara esos tests.
- Tests web que mencionan oficina/alcance: `cuenta/agencias/branches-manager.test.tsx`, `lib/cuenta-tabs.test.ts`, `lib/mora.test.ts`, `lib/dashboard.test.ts`, `lib/import.test.ts`, `mora/bulk-actions.test.tsx`, `mora/export-buttons.test.tsx`, `mora/[creditId]/{ficha-summary,responsibles-section}.test.tsx`, `import/ajustes/import-setup.test.tsx`, `agenda/new-task-modal.test.tsx`, `cuenta/actividad/activity-feed.test.tsx`, `cuenta/catalogos/catalog-editor.test.tsx`. `equipo/members-table.test.tsx` y `components/dashboard/dashboard-filters.test.tsx` existen pero **no** mencionan oficina (consistente con L-10).
- Lente: (a)(b)(c) igual.
- HUB: —

### H-07-07 · Móvil: 82 suites jest en verde; type-check roto por deriva con `shared`
- Clase: VERIFICADO
- Evidencia: `pnpm --filter @kobrax/mobile test` → 82 suites / 977 tests PASS; `type-check` → `app/cuenta/datos.tsx(21,7)` y `(44,13)` TS2740: `EMPTY: AccountForm` no tiene `logoUrl, phone, email, website, +2`; `AccountForm` está en `packages/shared/src/types/account.types.ts:127`
- Hecho: el móvil no compila contra el `AccountForm` actual de `shared` (facturación obligatoria, commit `5c54c84`). Solo un test móvil menciona oficina (`import.service.test.ts`).
- Implica para la épica: confirma el desfase móvil↔web (L-14, D1); cualquier cambio de `shared` en F13 rompe más el type-check móvil. El móvil no tiene red de pruebas de alcance por oficina.
- Lente: (a) el cobrador individual usa el móvil → su type-check ya está en rojo.
- HUB: —

### H-07-08 · Paquete `shared`: 35 specs, ninguno sobre oficina/alcance
- Clase: VERIFICADO
- Evidencia: `packages/shared/src/**/*.spec.ts` (35); grep `branch|agencia|DATA_SCOPE` en specs de shared: sin resultados; `plans.spec.ts` y `account-billing.spec.ts` existen
- Hecho: `permissions.ts` (presets por rol) no tiene spec propio en shared; los presets se verifican desde `apps/api/src/modules/mora/mora-scope-presets.spec.ts`.
- Implica para la épica: si F13/F14 mueven la definición de permisos/alcance a `shared`, hay que crear su spec ahí (B10).
- HUB: —

### H-07-09 · CI: solo despliegue y espejo, sin job de test/lint/type-check
- Clase: VERIFICADO
- Evidencia: `.github/workflows/deploy.yml` (push a `main` → ssh `bash /opt/kobrax/deploy.sh`), `.github/workflows/mirror-backup.yml` (copia a `saraacha21/kobrax`); no hay otros workflows
- Hecho: ninguna verificación automática antes de mergear; `deploy.sh` hace `pnpm install --frozen-lockfile`, `db:generate`, `build`, respaldo `pg_dump`, `db:deploy` (líneas 44-77). Con web type-check en rojo hoy, el deploy no depende de él.
- Implica para la épica: las verificaciones de G5 son manuales (A5); un merge a `main` despliega y migra producción sin red de pruebas. Riesgo mayor para migraciones de F13.
- Lente: (a) el gratuito sufre cualquier regresión sin detección previa.
- HUB: —

### H-07-10 · Cobertura de regresión del perfil gratuito individual (C4)
- Clase: INFERIDO (de los títulos de specs; no auditado caso por caso)
- Evidencia: `plan-limits.service.spec.ts`, `plans.spec.ts` (topes FREE 1/20/20), `auth.service.spec.ts`, `catalogs-signup.it.ts` (signup), `credits.service.spec.ts`, `payments.service.spec.ts`, `field.service.spec.ts`, `agenda.service.spec.ts`, `mora.*.spec.ts`, `import-assignment.spec.ts` (el cobrador que importa queda con `official=yo`), `mobile sync/queue.test.ts`
- Hecho: los flujos del gratuito individual (registro, alta de crédito, gestión, pago, importar la propia cartera, mora) tienen specs unitarios; no hay un escenario e2e «cuenta FREE de un usuario» que los una.
- Implica para la épica: la regresión C4 puede apoyarse en la suite unitaria actual (API 1732 + shared 451 + móvil 977 en verde) más una prueba nueva de integración «tenant sin oficinas»; la lista de flujos la define G2 (`target/09`).
- HUB: —

## Cómo correr la suite (sin tocar la DB)
- Todo: `pnpm test` (turbo; cada tarea depende de `^build`). Por paquete: `pnpm --filter @kobrax/<api|web|mobile|shared> test`.
- Type-check: `pnpm --filter @kobrax/<pkg> type-check`. El de web falla por `.next/types` obsoleto; borrar `.next` y reconstruir probablemente lo resuelva (NO VERIFICADO, no se borró nada).
- Un solo spec de API: `cd apps/api && node --import tsx --test src/modules/branches/branches.service.spec.ts`.
- Web con carga alta mostró ruido de `jsdom navigation` y MSW sin handler: son avisos, no fallos.

## Contradicciones y desconocidos
- **CONTRADICTORIO C-07-1:** `.claude`/CLAUDE.md pide `strict` y calidad, pero `lint` es placeholder en api/web/mobile/shared (`"(lint placeholder)"`) y el type-check de web y móvil está en rojo en el commit base.
- **DESCONOCIDO D-07-1:** contenido real de `rls/verify_isolation.sql` (existe, no se leyó): ¿prueba aislamiento entre cuentas? Responde `01`/`05` o la fase de seguridad.
- **DESCONOCIDO D-07-2:** si el fallo de `today-board.test.tsx` también viene de `a13d88c` (ver H-07-06).
- **DESCONOCIDO D-07-3:** `apps/web/CLAUDE.md` pide reiniciar `dev` y reconstruir `shared` al tocarlo (B13); no se verificó si `packages/shared/dist` (con fecha 29-oct) está al día respecto a `src` — afecta el diagnóstico del type-check móvil.
