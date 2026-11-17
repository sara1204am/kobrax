# Auditoría Web + API — Etapa 1 (solo lectura)

Fecha: 2026-11-16 · Rama de trabajo al momento de auditar: `f15/version-terminos-footer` (con cambios sin commitear del trabajo legal, **no tocados**).
Alcance: `apps/web`, `apps/api`. Sin mobile ni ai-gateway. Ningún archivo de código fue modificado.

Convención de confianza: **[V]** verificado por mí leyendo el código · **[A]** reportado por un auditor, sin verificación propia · **[?]** evidencia insuficiente.

---

## 0. Correcciones al enunciado

- `apps/web/src/server/http/errors.ts` **no existe** (ni la carpeta `src/server`) [V]. Los errores centralizados reales son: Web → `lib/api-error.ts`, `lib/proxy.ts`, `lib/auth-flow.ts`; API → `common/filters/global-exception.filter.ts`. El plan debe apoyarse en estos.
- `apps/web/CLAUDE.md` está desactualizado (matcher, "solo núcleo de identidad", i18n "solo auth") [A].
- `lint` es `echo "(lint placeholder)"` en Web y API [V]: **no hay ESLint/Biome**. Hoy ninguna regla estática protege la limpieza.

## A. Estado inicial (cifras)

| | Web | API |
|---|---|---|
| Archivos versionados | 630 | 459 |
| Páginas / route handlers | 62 / 110 (BFF) | — |
| Componentes | 80 en `components/` + 143 locales en `app/` | — |
| Controllers / Services / Módulos | — | 28–29 / 68 / 23 de dominio (+14 transversales) |
| Endpoints HTTP | — | 225 (19 públicos) |
| Tests | 142 archivos | 128 specs + 31 integración |
| `any` / `@ts-ignore` | 0 / 0 | 0 / 0 |
| `console.*` | 0 | 10 (solo CLIs) |
| TODO/FIXME reales | 0 | 0 |

Dependencias: no se encontró ninguna sin uso en los `package.json` [V] (`pdfjs-dist` se usa por import dinámico ESM).

## B. Mapa de arquitectura

**Web → API:** Server Component → `apiCall()` (`lib/bff.ts`, Bearer desde cookie httpOnly) → API Nest. Cliente: `postJson/sendJson` (`lib/client.ts`) → route handler mismo origen → API. Los 110 `route.ts` son proxies delgados (38 `proxyMutation`, ~64 `apiCall`, 12 `fetch` directo por streams/binarios) [A].
**API:** Controller (delgado, máx. 276 líneas) → Service → `PrismaService` directo (53 services; **no hay repositories**) → PostgreSQL con RLS. Guards globales: RateLimit, AppVersion, JwtAuth, Tenant, Authz (deny-by-default). Interceptores: TenantContext (ALS), Audit, Transform (`{data,meta,error}`). Errores: `GlobalExceptionFilter`.
**Alternativos reales:** WebSocket `/events` (Socket.io), 8 `setInterval` como jobs (sin cron/colas), EventBus en memoria, CLIs (backup, plan, arrears). **No hay webhooks entrantes.**

## C. Seguridad (prioridad más alta)

| ID | Sev. | Hallazgo | Conf. |
|---|---|---|---|
| S-1 | P1 | `field.service` (`list`/`findOne`/`addEvidence`): solo acota al cobrador a sus visitas; **ningún filtro por oficina** para el resto de roles. GPS/evidencias de otras oficinas visibles para quien tenga `ROUTE_READ`/`ASSIGN`. (Falta confirmar qué alcance efectivo tiene cada rol.) | [V] código |
| S-2 | P1 | `payments.register()` → `applyCore` busca el crédito solo por `id` y `deletedAt`, sin `visibleCreditIds`. Un cobrador con un UUID ajeno puede registrar un pago. `createRequest`/`confirmRequest` sin chequeo de alcance. Los listados sí filtran. | [V] register/applyCore · [A] request |
| S-3 | P1 | `SCOPE_RLS_MODE` default `off`; el alcance por oficina depende solo del código de servicios. Aun en `enforce` solo cubre 5 tablas (faltan `field_visits`, `field_evidences`, `credit_activities`, `credit_notes`, `payment_requests`, `files`, `route_stops`). Es la decisión F14 "enforce lo ordena ella" — **no se cambia sin su orden**. | [A] |
| S-4 | P1 | Validación de env acepta secretos de ejemplo (`min(16)`), sin exigir distintos ni rechazar placeholders en prod; `FILE_LINK_SECRET` deriva de `JWT_SECRET`. | [A] |
| S-5 | P2 | Evidencia/auditoría "inmutables" solo por convención: `kobrax_app` tiene UPDATE/DELETE en `audit_logs`, `field_evidences`, `field_visits`, `payments`. Patrón correcto ya existe en el WIP legal (REVOKE + trigger). | [A] |
| S-6 | P2 | Hash de evidencia lo declara el cliente si no manda `content`. | [A] |
| S-7 | P2 | `fullBackup` entrega PII descifrada sin mirar `client:pii:read`; quién tiene `REPORT_EXPORT`+ALL sin verificar. | [A] |
| S-8 | P2 | CSV de exports (clients/locations/agenda) sin `csvSafeText` (inyección de fórmulas); solo mora lo aplica. | [A] |
| S-9 | P2 | MFA: límite solo por IP, sin contador por usuario, pre-auth token reutilizable; sin `@RateLimit` en `select-account`, `mfa/setup/*`, `mfa/disable`. | [A] |
| S-10 | P2 | Web sin CSP / X-Frame-Options / HSTS. | [A] |
| S-11 | P2 | Auditoría best-effort post-commit (solo `recordInTx` es atómica); redacción no incluye email/lat/lng/notas. | [A] |
| S-12 | P2 | Subida valida solo MIME declarado (sin magic bytes). | [A] |
| S-13 | P2 | `x-forwarded-for` reenviado tal cual por el BFF: depende del despliegue. | [?] |
| S-14 | RISK | `routes.controller` usa puerta mínima `@Roles(ROUTE_READ)` en escrituras; la autorización real está en el service. | [A] |
| S-15 | P3 | `accountLocked` antes de comparar contraseña; `files/[id]/link` sin `sameOrigin`; matcher del middleware omite algunas rutas. | [A] |

**Verificado como correcto [A]:** RLS con `FORCE` + `kobrax_app` NOBYPASSRLS, `set_config` parametrizado, `$queryRaw` sin Unsafe, deny-by-default con spec de cobertura y snapshot, rotación de refresh con detección de reuso, política de escalamiento de privilegios, alcance por oficina correcto en clients/credits/agenda/payments(listados)/exports/lectura de archivos, cookies httpOnly+Strict, sin secretos en `NEXT_PUBLIC_*`.
**Limitación:** `authz-dto-ids.spec` solo cubre ids de sesión (`accountId`, `userId`…), no ids foráneos (`creditId`, `clientId`, `visitId`…): justo donde están S-1 y S-2.

## D. Web: duplicaciones y Design System

Design system **existe** (`ui.tsx`, `panel-ui.tsx`, `data-table.tsx`, `modal.tsx`, tokens `k-*` en `tailwind.config.ts` ← `packages/shared/src/design/tokens.ts`). No se crea otro; se completa y se hace cumplir.

| Patrón | Estándar existente | Desviaciones |
|---|---|---|
| Tabla | `DataTable` (15 archivos) | 13 `<table>` artesanales; candidatos reales: `infinite-table`, `trash-list`, `collectors-table` (el resto son matrices/edición inline legítimas) |
| Modal | `Modal` (37) | 4 overlays propios: `notes-board`, `qr-viewer`, `photo-viewer`, `tour` (+ `onboarding-wizard`) |
| Select | `Select` (38) | `<select>` crudo en 20 archivos |
| Fechas | `day-picker` (1 uso) | `<input type=date…>` en 18 archivos; no hay date picker compartido |
| Pestañas | `Segmented` (6) | 10 implementaciones propias (`cuenta-tabs`, `profile-tabs`, `dashboard-tabs`, equipo, organización, rutas, seguridad/roles, `user-combobox`); solo 1 con `role="tab"` |
| Botón | `Button` (228 usos / 78 archivos) | `<button>` crudo 237 usos / 99 archivos; 32 archivos con primario pintado a mano. Causa: `Button` es `w-full h-12` fijo, sin tamaños; 22 usos lo pisan con `w-auto` |
| Input / Textarea / Label | `Input` 131, `Textarea` 1, `Field` 233 | `<input>` 62 (33 arch.), `<textarea>` 13, `<label>` 51 |
| Checkbox / Switch | `Switch` 6 | `type="checkbox"` crudo 19 (14 arch.) |
| Formularios | — (no hay componente) | 22 `<form>` sueltos |
| Confirmación | `ReasonDialog`, `ConfirmSensitiveDialog` | no hay `ConfirmDialog` genérico |
| Paginación | interna a `DataTable` | no hay `Pagination` independiente |
| Loading | `loading.tsx` único | casi todo el panel sin estado de carga por ruta; sin `not-found.tsx` |
| Moneda/fecha | `lib/format.ts` | 12 archivos con `'es-BO'` fijo |

**Tokens:** 1441 `text-[Npx]` (no hay escala tipográfica tokenizada; 13px=609, 14px=279, 12px=271, 11px=96); radios sin tokenizar (`rounded-xl` 272, `lg` 159…); 69 hex fuera de tokens, el único módulo claramente fuera del sistema es **Pagos** (paleta azul propia en `payment-summary.tsx`, `pagos/[id]/page.tsx`); 276 `bg-white` vs token `k-white`.
**Consistencia por módulo:** `requirePermission` solo en cartera, seguridad, cuenta, equipo, organizacion, actividad; ausente en mora, pagos, agenda, rutas, import, exportar. Agenda no usa `PageHeader`. Rutas sin toasts. `RetryState` irregular.

## E. Matriz de código muerto / duplicado (conservadora)

| Elemento | Estado | Evidencia |
|---|---|---|
| Web: 0 archivos huérfanos a nivel archivo | USED | script de importadores estáticos/dinámicos |
| `Hint` (`panel-ui.tsx:265`) | UNUSED (media-alta) | solo su definición; no se buscó uso dinámico |
| `legacy-redirects.mjs` | RISK | redirects 308 de URLs viejas |
| `settings/security*` vs `settings/perfil/seguridad` | UNKNOWN | posible solape |
| `POST /clients/imports` | UNKNOWN | 0 usos web/mobile; posible duplicado de `imports/portfolio` |
| `POST /credits/:id/recalculate-arrears`, `POST /users/:id/sessions/revoke` | UNKNOWN | 0 usos web/mobile |
| `/platform/*`, `notifications/devices`, `agenda/:id/postpone`, `agenda/clients/:id/contacts`, `/health*` | RISK | consumidores externos/mobile/infra |
| `FieldModule` importa `MailModule` sin referencias | UNKNOWN | verificar providers implícitos |
| Exports sin consumidor (`serialize*`, `*_INTERVAL_MS`, …) | UNKNOWN | pueden ser solo de tests |
| DTOs: `branches.dto.ts` vs `dto/branch.dto.ts` | DUPLICATED (convención) | dos estilos en la misma carpeta |
| Importadores `clients/import/*` vs `imports/*` | UNKNOWN | no se comparó el código |
| 3 jobs `setInterval + run()` idénticos | DUPLICATED | candidato a abstracción mínima |

**Conclusión honesta:** el código muerto confirmado es muy poco. El valor de esta limpieza está en seguridad, consistencia y herramientas, no en borrar archivos.

## F. Plan priorizado (para aprobar antes de la Etapa 2)

Cada bloque = una rama/PR pequeña, con tsc + tests antes y después. Regla: nada se borra con estado UNKNOWN/RISK.

**Orden de ejecución propuesto** (un PR por bloque, rama aparte desde `dev`; antes de empezar: línea base de tsc/tests/builds)

| # | Bloque | Prioridad | Riesgo |
|---|---|---|---|
| 0 | Línea base + rama nueva | — | nulo |
| 1 | **B-1** librerías: overrides de parches (proxy-addr, multer, socket.io-parser, engine.io, body-parser, qs, pdfjs-dist, lodash, brace-expansion, uuid, file-type, maplibre-gl, postcss) | P0 | bajo |
| 2 | **B-2** rate limit y rutas públicas (H3.1–H3.4) | P0 | bajo |
| 3 | S-2 pagos y S-1 visitas: alcance por crédito/oficina (con tests de aislamiento) | P0 | medio |
| 4 | S-4 secretos de producción + test de ids foráneos en DTOs | P0 | bajo |
| 5 | Defensa en profundidad: inmutabilidad en BD, hash servidor, PII en backup, CSV seguro, MFA por usuario, cabeceras Web, `routes` | P1 | medio |
| 6 | Herramientas: script `test` por glob, lint real informativo, `pnpm audit` en CI | P1/P3 | bajo |
| 7 | Design System P2-A → P2-B → P2-C | P2 | medio |
| 8 | Limpieza P3 y optimización P4 | P3/P4 | bajo |
| — | Aparte, con decisión tuya: Next 15 (+React 19), zod 4, @nestjs 11, nodemailer 10, `SCOPE_RLS_MODE` | — | alto |

**P0 — Seguridad (cada ítem con test que falle antes y pase después)**
1. **B-1 librerías (H1/H2):** `pnpm.overrides` a versiones corregidas del mismo major. Prioridad: `proxy-addr` (crítico; afecta `trust proxy`), `pdfjs-dist` (JS al abrir un PDF; se usa en importación), `multer`, `socket.io-parser`/`engine.io`, `body-parser`/`qs`, `maplibre-gl` (crítico), `postcss`. Validar con tsc + 128 specs + 31 integraciones + builds web/api.
2. **B-2 rate limit (H3):** no crear cubo por `Authorization` sin validar (usar IP para no autenticados); exención solo de `GET /health` y `/health/live` exactos; contador atómico (`SET key 1 EX n NX` + `INCR`, o Lua); `@RateLimit` en `select-account` y `mfa/setup/*`; tope de concurrencia/almacenamiento en disco para multer. **Antes:** verificar el orden real de guards con un test de integración.
3. **S-2:** validar alcance del crédito en `register`, `createRequest`, `confirmRequest`.
4. **S-1:** alcance por oficina en `field.service` (list/findOne/addEvidence); confirmar antes el alcance efectivo por rol.
5. **S-4:** rechazar placeholders y `JWT_SECRET == JWT_REFRESH_SECRET` en `NODE_ENV=production`; exigir `APP_ENCRYPTION_KEY`/`APP_BLIND_INDEX_KEY` al arrancar.
6. Test de contrato para ids foráneos en DTOs (`creditId`, `clientId`, `visitId`, `branchId`, `collectorId`…): cierra el hueco de `authz-dto-ids`.
*Decisión de la usuaria:* S-3 (`SCOPE_RLS_MODE` → `log` y ampliar `SCOPE_POLICY_TABLES`) **no** se toca sin su orden, según F14.

**P1 — Arquitectura / defensa en profundidad**
7. S-5/S-6: REVOKE UPDATE/DELETE + trigger en `audit_logs`, `field_evidences`, `payments` (migración nueva, patrón del módulo legal) y recalcular el hash en servidor.
8. S-7 PII en backup, S-8 `csvSafeText` en exports, S-9 contador MFA por usuario y token pre-auth de un solo uso, S-10 CSP/HSTS/X-Frame-Options en Web, S-11 auditoría atómica en mutaciones críticas, S-12 magic bytes en uploads, S-13 `x-forwarded-for` según despliegue.
9. Revisar `routes` (puerta mínima `ROUTE_READ`) con tests negativos.
10. Script `test` de la API: de lista manual a glob (`legal.it.ts` ya quedó fuera). `pnpm audit --audit-level=high` como paso de CI.

**P2 — Design System** (regla: primero se completan los componentes, después se migra; si no, la inconsistencia solo cambia de lugar)

*P2-A · Completar los componentes base (sin cambiar la identidad visual; los valores salen de los que ya se usan)*
9. `Button`: hoy es `w-full h-12 text-[15px]` fijo, sin tamaños. Agregar `size` (`sm`/`md`/`lg`), ancho automático por defecto, variantes secundaria y enlace, y botón de icono. Es la causa de que haya 237 `<button>` crudos y de que 22 usos lo sobrescriban con `w-auto`. Cuidado: cambiar el ancho por defecto afecta a los usos actuales, así que se migran los `w-full` explícitos en el mismo PR.
10. `Tabs` único y accesible (`tablist`/`aria-selected`/teclado) que reemplace las 10 implementaciones (`cuenta-tabs`, `profile-tabs`, `dashboard-tabs`, equipo, organización, rutas, seguridad/roles, `user-combobox`).
11. `FormField`/`FormSection`/`FormActions` como composición sobre `Field`/`Input`/`Select`, para los 22 `<form>`.
12. Completar y adoptar `Textarea`, `Checkbox`, `Switch`; crear solo lo que falta (`ConfirmDialog`, date picker, `Pagination` independiente).
13. Tokenizar escala tipográfica y radios (mapear los valores existentes); Pagos a tokens `k-*`.

*P2-B · Migración por módulo (un PR por módulo: Pagos, Rutas, Agenda, Cuenta, Cartera, Mora, Equipo/Organización, Seguridad, Perfil, Dashboard)*
14. Cambiar lo hecho a mano por los componentes: 237 `<button>`, 62 `<input>`, 33 `<select>`, 13 `<textarea>`, 51 `<label>`, 19 checkbox, 3 tablas candidatas y 4–5 overlays. Los casos legítimos (celdas de calendario, filas clicables) se dejan y se anotan.
15. Estados de carga/vacío/error homogéneos; `requirePermission` en los módulos que faltan.

*P2-C · Que no vuelva a divergir:* con el lint de P3, prohibir `<button>`, `<select>` y `<textarea>` crudos fuera de `components/ui` (regla informativa primero, después bloqueante).

**P3 — Limpieza**
13. Instalar lint real (Biome o ESLint) en modo informativo primero.
14. Eliminar `Hint` tras reconfirmar; unificar DTOs de branches; actualizar `apps/web/CLAUDE.md`.

**P4 — Optimización:** abstracción de jobs, locks para escalar horizontal (los `setInterval` correrían duplicados con varias instancias [?]), medición de bundle.

## G. Pendientes de verificar (no asumir)

- Orden real de ejecución de los guards globales (`RateLimitGuard` vs `JwtAuthGuard`): decide si el bypass H3.1 es real.
- Alcance efectivo por rol en S-1 y qué roles tienen `REPORT_EXPORT`+ALL (S-7).
- Si `createRequest` permite UUIDs de otra cuenta (FK sin RLS) o hay trigger que lo frene.
- Explotabilidad real de los avisos de `next` (¿se usa `next/image`? ¿producción en Linux?) y de `pdfjs-dist` (configuración `isEvalSupported`).
- Si el fix de `nodemailer` exige salto a major 10 y si `zod` 4 es viable (1 archivo lo usa).
- Línea base de validaciones (tsc, tests, builds) **aún no ejecutada**: es el primer paso de la Etapa 2.

---

## H. Blindaje del backend y librerías (2026-11-16)

`pnpm audit --prod`: 202 avisos en total (7 critical, 109 high), **la mayoría en `apps/mobile` (fuera de alcance)**. Cifras exactas solo para API y Web abajo; la gravedad es la que declara el aviso, **la explotabilidad en Kobrax no está verificada** salvo donde se indica.

### H1. Librerías API (versión instalada → corregida)
| Paquete | Aviso | Acción propuesta |
|---|---|---|
| `proxy-addr` 2.0.7 (vía express) — **critical** | spoofing de IP con subred IPv4-mapeada. Afecta `trust proxy 'loopback'`, que alimenta rate limit y el historial de conexiones | override `>=2.0.8` |
| `multer` 2.0.2 — high ×9 | DoS (campos anidados, índices, subidas abortadas, `fileFilter` asíncrono) en `/uploads` e `/imports` | override `>=2.5.0` |
| `pdfjs-dist` 6.1.200 — high | **ejecución de JS al abrir un PDF malicioso**; se usa al importar cartera PDF (`pdf-blocks.parser`) | `>=6.2.108` (mismo major) + revisar `isEvalSupported` |
| `socket.io-parser` 4.2.6, `engine.io` 6.6.9 — high | agotamiento de memoria / DoS en el WebSocket `/events` | `>=4.2.7` / `>=6.6.10` |
| `body-parser` 1.20.4, `qs` 6.14.2 — high/mod | DoS por cuerpo comprimido, `limit` inválido | `>=1.20.9` / `>=6.16.1` |
| `nodemailer` 9.0.3 — high ×14 | DoS en parser de direcciones, bypass de validación de dominio destino, cache DNS/TLS entre transports | actualizar (hay que ver si el fix exige major 10) |
| `lodash` 4.17.21, `brace-expansion`, `uuid` (vía `exceljs`/`@nestjs/config`) — high/mod | code injection en `_.template` (no se usa directo), DoS | override |
| `zod` 3.25.76 — high | memoria con colecciones enormes; el fix es **zod 4** (cambio mayor): solo se usa en 1 archivo → evaluar |
| `@nestjs/core` 10.4.22 — mod | inyección; fix en 11.x (**cambio mayor**, no es un parche) |
| `file-type` 20.4.1 — mod | bucles / zip bomb | actualizar |

### H2. Librerías Web
- `next` 14.2.35: **25 avisos, 3 critical** (RCE en Image Optimization con AVIF/SVG y en servidores Windows; SSRF en WebSocket upgrades y Server Actions; DoS; bypass de middleware con i18n en Pages Router). Corrección solo en **15.5.x**: es un salto de versión mayor y Next 15 App Router normalmente pide React 19 (hoy fijado en 18.2 por override). **Verificar** qué avisos aplican (¿se usa `next/image`/optimizer? ¿corre en Linux?) y planear la migración como épica aparte.
- `maplibre-gl` 6.3.0 — critical (bypass del sanitizador XSS): `>=6.4.1`, mismo major.
- `postcss` vía next — high: `>=8.5.23`.

### H3. Huecos de configuración (verificados en código)
1. **Rate limit global eludible** [orden de guards sin verificar]: `rate-limit.guard.ts:caller()` hashea cualquier `Authorization` sin validarlo → cubo nuevo por cada valor inventado.
2. `path.includes('/health')` exime del límite a cualquier ruta que contenga ese texto; `GET /api/health` consulta DB + Redis sin auth.
3. `INCR`+`EXPIRE` no atómicos: un corte entre ambos deja la clave sin TTL (bloqueo permanente de esa IP).
4. Rutas `@Public` sin `@RateLimit`: `select-account`, `mfa/setup/{start,verify,skip}`.
5. Multer en memoria (15 MB/petición) sin tope de concurrencia; sin timeouts de petición explícitos.
6. Sin CSP/HSTS/X-Frame-Options en Web; MFA sin contador por usuario (ver S-9/S-10).

### H4. Plan de blindaje (propuesto, sin ejecutar)
- **B-1 (primero, bajo riesgo):** `pnpm.overrides` para `proxy-addr`, `multer`, `socket.io-parser`, `engine.io`, `body-parser`, `qs`, `lodash`, `brace-expansion`, `uuid`, `file-type`, `maplibre-gl`, `pdfjs-dist` (parches/minor del mismo major). Correr tsc + 128 specs + 31 integraciones + builds. Un PR.
- **B-2:** arreglar H3.1–H3.4 con test de integración que demuestre el bypass antes del arreglo (Lua/`SET EX` atómico, validar token antes de crear cubo o usar solo IP para no autenticados, excluir solo `GET /health` exacto).
- **B-3:** `nodemailer`, `zod` 4 y `@nestjs/*` 11: evaluar costo/riesgo por separado (cambios mayores).
- **B-4:** `next` 15: épica aparte con decisión tuya (React 19, regresión visual).
- **B-5:** `pnpm audit --prod --audit-level=high` como paso de CI para que no vuelva a acumularse.
