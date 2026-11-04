# Discovery · 08 · Dependencias e infraestructura

> **Estado: COMPLETO 2026-11-02.** Método: `../../_framework/README.md` §2 · hallazgo = plantilla T1. Pistas resueltas: L-11, L-12, L-18.
> Lente de tenant: (a) gratuito individual · (b) equipo/agencia pequeña · (c) tenant grande con varias oficinas.

## Hallazgos

### H-08-01 · Stack real (versiones de los `package.json`)
- Clase: VERIFICADO
- Evidencia: `package.json` raíz (`pnpm@9.12.0`, node >=20, turbo ^2.1.3, TS ^5.6.2, overrides react/react-dom 18.2.0); `apps/api/package.json` (NestJS ^10.4.4, `@prisma/client` ^5.20.0, socket.io ^4.8.1, ioredis ^5.4.1, zod ^3.23.8, exceljs, pdfjs-dist ^6.1.200, pdfkit, nodemailer, helmet, geoip-lite); web (next ^14.2.15, vitest ^2.1.x); mobile (expo ~51.0.28, react-native 0.74.5, jest ^29.7.0); `docker-compose.yml` (postgres:15-alpine, redis:7-alpine)
- Hecho: coincide con CLAUDE.md (NestJS, Next 14, Expo 51, PG15, Redis 7, Prisma 5). No hay driver S3/R2 aunque CLAUDE.md lo declara.
- Implica para la épica: Prisma 5.20 no expresa índices parciales ni RLS (ya se usan en SQL a mano); Postgres 15 soporta `ltree`/CTE recursivas, pero la única extensión creada es `pg_stat_statements`.
- Lente: igual para (a)(b)(c).
- HUB: —

### H-08-02 · PostgreSQL: solo `pg_stat_statements`; rol de aplicación sin BYPASSRLS
- Clase: VERIFICADO
- Evidencia: `infra/postgres/init/02-extensions.sql` (`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`); `infra/postgres/init/01-create-app-role.sql` (rol `kobrax_app`, NOSUPERUSER/NOBYPASSRLS según `docker-compose.yml`); producción: mismo `postgres:15-alpine`, puertos atados a `127.0.0.1` (`infra/production/docker-compose.prod.yml`)
- Hecho: no hay `ltree` ni otras extensiones instaladas; la creación de una extensión nueva requeriría un script de init y una migración.
- Implica para la épica: cualquier diseño de jerarquía con `ltree` exige habilitar una extensión (decisión de G2, no de esta fase); con CTE recursivas o ruta materializada no hace falta nada. No se afirma cuál conviene.
- Lente: (c) es el que necesitaría consultas de subárbol rápidas.
- HUB: —

### H-08-03 · Planes en código: sin tope de sucursales (L-12 confirmada)
- Clase: VERIFICADO
- Evidencia: `packages/shared/src/constants/plans.ts:1-14` (comentario «Sin `branches`: la función no existe en el producto»), interfaz `PlanLimits` (`users, credits, clients, photosPerMonth, photoRetentionMonths, actionsPerMonth` — sin `branches`); `apps/api/src/common/plan/plan-limits.service.ts:10` `CountedLimit = 'users' | 'credits' | 'clients'`; grep `branch|sucursal` en `apps/api/src/common/plan/*.ts` (sin specs): sin resultados
- Hecho: ningún plan limita el número de oficinas y el servidor solo hace cumplir usuarios, créditos y clientes. `BranchesService` no llama a `plan.assertRoom`.
- Implica para la épica: crear oficinas hoy es ilimitado en todos los planes, incluido FREE. Si se quiere honrar la grilla comercial hay que añadir `branches` a `PlanLimits` y a `CountedLimit` (decisión de producto).
- Lente: (a) FREE podría crear N agencias sin tope; (b)(c) idem.
- HUB: —

### H-08-04 · Grilla comercial de planes y topes (código vs documento)
- Clase: VERIFICADO (código) / INFERIDO (documento)
- Evidencia: `plans.ts` — FREE users 1, credits 20, clients 20, fotos/mes 100, retención 6 m, acciones/mes 100; PROFESSIONAL 25/1000/1000/5000/24/2500; BUSINESS 100/5000/5000/25000/60/12500; ENTERPRISE 500/50000/50000/250000/120/125000; precios 0 / $12 por asiento / $99+$10 / $800+$8. `docs/business/LIMITES-POR-PLAN.md:141-149` (misma grilla, fila «Sucursales» 1 / 3 / 10 / a medida, marcada ⚠️)
- Hecho: todos los números de código coinciden con la grilla; la **única fila ausente en código es «Sucursales»**.
- Implica para la épica: los topes por oficina del documento (1/3/10) son un requisito comercial sin implementación; el cálculo del plan por oficina también afectaría cómo se cuentan usuarios/créditos entre oficinas de una misma cuenta (el tope es por cuenta, `accounts.max_users`, `plans.ts:6-9`).
- Lente: (a) 1 usuario/20 créditos es el piso que no debe romperse (C2).
- HUB: —

### H-08-05 · CONTRADICCIÓN sobre existencia de «sucursales» (L-11)
- Clase: CONTRADICTORIO
- Evidencia: **dice que no existe:** `plans.ts:12`; `docs/producto/README.md:57` («sin API de sucursales»); `docs/business/LIMITES-POR-PLAN.md:190-191,334-338` («no hay ninguna pantalla para crearlas»). **dice que existe:** `apps/api/src/modules/branches/` (controller, service, serializer, DTOs, spec; módulo registrado en `app.module.ts:9,50`), endpoints `Permission.USER_READ`/`ACCOUNT_WRITE` (`branches.controller.ts`), rutas BFF web `apps/web/src/app/api/branches/**`, pantalla `apps/web/src/app/(panel)/cuenta/agencias/` con `branches-manager.test.tsx`; migración `20261021110000_branch_code_unique`
- Hecho: la función existe con el nombre «agencias» en API y web; los tres documentos que la niegan son anteriores o no se actualizaron. El código manda (A6).
- Implica para la épica: actualizar `plans.ts:12` y la documentación al decidir cómo se cobra por oficinas; no basarse en esos documentos.
- Lente: (a) el tenant individual no usa la pantalla; (b)(c) sí.
- HUB: —

### H-08-06 · Despliegue: un solo servidor, sin réplica ni balanceador (L-18)
- Clase: VERIFICADO (archivos de infra) / INFERIDO (estado real del servidor)
- Evidencia: `infra/production/{01-harden,02-docker,03-datos,04-portainer,05-app,06-proxy}.sh`, `deploy.sh`, `docker-compose.prod.yml` (postgres + redis únicos); `.github/workflows/deploy.yml` (ssh a un `DEPLOY_HOST`); `docs/producto/demo-datos-y-despliegue.md:254` («Un solo servidor; sin balanceador ni segunda réplica»); `infra/production/README.md` (VPS Contabo 8 núcleos/24 GB)
- Hecho: todo corre en un VPS; la API arranca temporizadores internos (`setInterval`, ver 06 H-06-10) que se duplicarían con más de una instancia.
- Implica para la épica: no hay entorno de staging visible; el merge a `main` migra producción (`deploy.sh` → `pnpm db:deploy`, respaldo `pg_dump` previo en el mismo disco). Migraciones de F13 deben ser aditivas y reversibles por respaldo.
- Lente: (c) un tenant grande carga la misma máquina que el gratuito.
- HUB: —

### H-08-07 · Almacenamiento, respaldo y servicios externos
- Clase: VERIFICADO (código) / INFERIDO (docs)
- Evidencia: `apps/api/src/modules/uploads/uploads.service.ts` («driver de disco local, nada más», `UPLOADS_DIR`); variables S3 vacías en `05-app.sh` (según `demo-datos-y-despliegue.md` §4.4); `apps/api/src/common/backup/` + script `db:backup`; OSRM en `docker-compose.yml` (dev) y `osrm.service.spec.ts`, no desplegado en producción (README de infra); correo `nodemailer` (`common/mail`); push (`modules/notifications/push`); mapas en web (`visit-map-widget`, `route-planner/map-panel`)
- Hecho: fotos y evidencia en disco local del servidor; respaldos en el mismo disco; ruteo por calles depende de OSRM que en producción no está levantado.
- Implica para la épica: separar datos por oficina no cambia el almacenamiento (la ruta ya es `uploads/<accountId>/<sha256>`), pero cualquier subida de volumen por tenants grandes toca el disco único.
- Lente: (c).
- HUB: —

### H-08-08 · Redis tiene uso limitado
- Clase: VERIFICADO
- Evidencia: `rate-limit.guard.ts:5`, `health.controller.ts:2`, `config/env.validation.ts:10` (`REDIS_URL` obligatoria)
- Hecho: Redis se usa para limitar tasa y salud; no hay colas ni caché de alcance.
- Implica para la épica: si el alcance por jerarquía se cachea, no hay infraestructura de caché usada hoy.
- HUB: —

## Contradicciones y desconocidos
- **CONTRADICTORIO C-08-1:** existencia de sucursales (H-08-05) — resuelto a favor del código; los documentos deben actualizarse.
- **CONTRADICTORIO C-08-2:** `CLAUDE.md` raíz declara Storage S3/Cloudflare R2; el código solo tiene disco local (H-08-07).
- **DESCONOCIDO D-08-1:** si hay entorno de pruebas/staging separado de producción (no aparece en el repo). Responde la usuaria.
- **DESCONOCIDO D-08-2:** si el cron de `db:backup` existe en el servidor (el propio README de infra dice «no verificable desde el repo»).
- **DESCONOCIDO D-08-3:** la decisión comercial de la Pregunta 15 (`LIMITES-POR-PLAN.md:340`): ¿entra el tope de sucursales? Responde la usuaria.
