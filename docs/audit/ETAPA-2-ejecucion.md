# Auditoría Web + API — Etapa 2 (ejecución)

Fecha: 2026-11-17 · Rama `audit/blindaje-api-y-estandarizacion-web` · Continúa `ETAPA-1-auditoria.md` (bloques 0–8 de la sección F).

## Línea base (antes de tocar nada)
API: tsc limpio, 2154 pruebas unitarias OK. Web: tsc limpio, 1536 pruebas OK. (Hubo que compilar `@kobrax/shared` y `@kobrax/database` y generar Prisma: es del entorno del worktree, no del código.)

## Hecho

| Bloque | Qué se hizo | Verificación |
|---|---|---|
| B-1 librerías | `pnpm.overrides` (mismo major) para `proxy-addr`, `multer`, `socket.io-parser`, `engine.io`, `body-parser`, `qs`, `pdfjs-dist`, `lodash`, `brace-expansion`, `file-type`, `maplibre-gl`, `postcss` | tsc, pruebas, build API y Web |
| B-2 rate limit | Contador atómico en Lua; techo adicional por IP (ya no se esquiva inventando `Authorization`); Bearer sin forma de JWT = no autenticado; exención solo de `GET /api/health` y `/api/health/live` exactos; `@RateLimit` en `select-account` y `mfa/setup/*` | `rate-limit.guard.spec` (6) |
| S-2 pagos | `register`, `createRequest` y `confirmRequest` validan que el crédito esté en el alcance de quien escribe (404 si no) | 5 pruebas nuevas |
| S-1 visitas | `field.service` (`list`, `findOne`, `addEvidence`) acota por oficina con la misma regla de Mora | 3 pruebas nuevas |
| S-4 entorno | En producción se rechazan secretos de ejemplo, repetidos entre sí, y se exigen `APP_ENCRYPTION_KEY`/`APP_BLIND_INDEX_KEY` | `env.validation.spec` (6) |
| Contrato ids foráneos | `authz-dto-foreign-ids.spec`: todo módulo con ids foráneos en DTOs debe aplicar alcance en su servicio | 2 pruebas |
| S-5 inmutabilidad | Migración `20261117000000_evidence_immutability` + `rls/005c`: `audit_logs`, `field_evidences` y `payments` no admiten UPDATE/DELETE desde `kobrax_app`/`kobrax_scoped` (en `payments` solo las columnas de alcance y del comprobante) | Probado a mano en una base desechable (privilegio denegado + trigger) |
| S-6 hash | El hash declarado de una evidencia debe coincidir con el SHA-256 del archivo subido (el nombre lo calcula el servidor) | prueba nueva |
| S-7 backup | `fullBackup` exige `client:pii:read` y `client:contact:read` | prueba actualizada + nueva |
| S-8 CSV | `toCsv` neutraliza fórmulas en todo texto (idempotente con `csvSafeText`) | 2 pruebas |
| S-9 MFA | Máximo 5 fallos por usuario en 15 min (Redis) además del límite por IP | 2 pruebas |
| S-10 Web | X-Frame-Options, HSTS, nosniff, Referrer-Policy, Permissions-Policy y CSP base (`frame-ancestors`, `base-uri`, `object-src`, `form-action`) | build |
| S-12 uploads | Comprobación de magic bytes (jpeg/png/webp/pdf/xlsx/xls) | pruebas nuevas |
| S-14 rutas | Las escrituras de `routes` exigen `ROUTE_EXECUTE\|WRITE\|ASSIGN` (antes `ROUTE_READ`); **snapshot `authz-snapshot.json` regenerado: revisar el diff** | `authz-coverage.spec` |
| Herramientas | `test` de la API por glob (ya no hay lista manual); paso de CI `pnpm audit` (informativo) y ratchet de UI | CI |
| P2-A | `Button` con `size`/`fullWidth`/variantes `secondary` y `link` (sin cambiar el aspecto de los 228 usos); `IconButton`; `Tabs` accesible, `Checkbox`, `ConfirmDialog`, `FormSection`, `FormActions` (`form-kit.tsx`) | 11 pruebas |
| P2-C / P3 | `pnpm --filter @kobrax/web lint` = ratchet de `<button>`/`<select>`/`<textarea>` crudos (baseline 227/30/11: solo puede bajar) | CI |
| P3 limpieza | Eliminado `Hint` (sin usos); `branches.dto.ts` movido a `dto/branch-view.dto.ts`; `apps/web/CLAUDE.md` actualizado | tsc |

Resultado final: API tsc limpio y 2182 pruebas OK; Web tsc limpio y 1544 pruebas OK; builds de API y Web OK.

## NO hecho (a propósito) — necesita decisión o es otra épica

- **S-3** `SCOPE_RLS_MODE` → no se tocó (decisión F14: lo ordena la usuaria).
- **B-3/B-4**: Next 15 (+React 19), zod 4, `@nestjs` 11, nodemailer 10. Cambios de versión mayor; `uuid` (majors 7/8) tampoco se forzó. Siguen en el `pnpm audit`.
- **P2-B** migración de pantallas: `Tabs`, `FormSection` y `Button` con tamaños **existen y están probados, pero ninguna pantalla se migró todavía** (237 `<button>`, 10 pestañas, 22 formularios…). Se hace un PR por módulo con regresión visual; el ratchet impide que crezca mientras tanto. Tokenizar tipografía/radios y llevar Pagos a `k-*` también queda para ese frente.
- **S-11** auditoría atómica en todas las mutaciones, **S-13** `x-forwarded-for` (depende del despliegue), tope de concurrencia de multer, P4 (jobs/locks, bundle).
- Tests de ids foráneos son de contrato estático: no reemplazan pruebas de aislamiento por endpoint con dos oficinas reales.

## ⚠️ Antes de desplegar
1. **S-4 puede impedir que la API arranque en producción** si hoy usa secretos de ejemplo, `JWT_SECRET == JWT_REFRESH_SECRET` o no tiene `APP_ENCRYPTION_KEY`/`APP_BLIND_INDEX_KEY`. Revisar el `.env` del servidor antes del deploy.
2. La migración `20261117000000_evidence_immutability` + correr `pnpm db:rls` (el script `005c`) en producción.
3. Revisar el diff de `docs/epics/F14/authz-snapshot.json` (puertas de `routes`).
4. Las cabeceras de seguridad de la Web: probar que cámara/ubicación siguen funcionando.

## P2-B — migración de pantallas (rama `feat/web-p2b-pagos`, sin subir)

Hecho: botones/selects/textareas crudos que coinciden con un patrón del sistema → `Button`/`TextButton`/`Select`/`Textarea` (ratchet 228/31/13 → 173/24/2); `LinkTabs` único para las pestañas de ruta de Cuenta y Mi perfil; 4 `Checkbox`; Pagos sin hex propios (tokens `k-*`); `requirePermission` en agenda, mora, import, exportar, pagos y rutas (el mismo permiso que el menú); escala tipográfica `text-k-*` (11 tamaños exactos, el lint impide nuevos `text-[Npx]`; quedan 27 atípicos fijados); borrar tablero con `ConfirmDialog`.

Decidido dejar tal cual (no es deuda): radios (ya usan los nombres de Tailwind); `<input type="date">` nativo (es el selector de fecha del sistema, `Input` lo envuelve); tarjetas/filas clicables, pastillas, celdas de calendario y menús (botones legítimos); `window.confirm` de «cambios sin guardar» al cambiar de pestaña (guarda síncrona); formularios de cuenta sin secciones (`FormSection` no aplica); estados de carga/error (ya hay `(panel)/loading.tsx` y `error.tsx`).

Pendiente, necesita ojo humano: revisión visual en navegador (modal de pago, diálogos de rutas/roles, agenda, equipo, Pagos con los tonos nuevos), `requirePermission` sin cubrir `pagos/solicitudes`, `settings` y Dashboard, y decidir si se sube como un PR o por módulo.

## P4 parcial y blindaje de subidas (misma rama, sin subir)

- **`startJob`** (`apps/api/src/common/jobs/start-job.ts`): los 7 `setInterval` de tareas de sistema (plan, vencidas de agenda, recordatorios de cuotas, mora, vencimiento de asignaciones, promesas, limpieza de archivos) comparten una abstracción con candado en Redis (`SET NX PX`): con varias réplicas corre UNA instancia por ciclo; no se solapa consigo mismo; si Redis falla corre igual (los jobs ya eran idempotentes). `AuthzVersionService` (sincroniza a Redis en cada instancia a propósito) se dejó con su propio intervalo. Redis es parámetro opcional del constructor: los specs no cambian.
- **Tope de subidas** (`UploadConcurrencyInterceptor`): máx. 12 subidas en vuelo por proceso (503 `UPLOAD_003`) antes de multer en `/uploads` e `/imports`, porque multer guarda hasta 15 MB por archivo en memoria.
- API: tsc limpio, 2212 pruebas OK.

**S-11 sigue sin hacerse a propósito:** hay 109 llamadas `audit.record(` post-commit y 2 `recordInTx`; volverlas atómicas toca ~25 servicios y cambia el contrato de errores (una auditoría caída pasaría a abortar la mutación). Necesita decidir cuáles son «críticas» antes de tocar. **S-13** depende del despliegue (proxy delante del BFF).

## S-11 (decidido: sólo las críticas) — auditoría dentro de la transacción
Pasaron a `recordInTx` (si la auditoría falla, la mutación no queda): registro de pagos y confirmación/alta de solicitudes de pago; traspaso de propiedad de la cuenta; cambio de rol/oficina/estado de una persona, invitación y baja de pendiente; asignación temporal, apoyo y revocación de créditos. Quedan post-commit a propósito: cierre de sesiones (Redis, fuera de la BD), reasignación masiva al desactivar, perfil propio, ajustes de la cuenta y el resto (~90 llamadas). Las pruebas de integración (necesitan BD) las corre el CI del PR; en local sólo se verificaron las unitarias (2212 OK).
