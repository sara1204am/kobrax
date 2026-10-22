# Refactor de Cuenta (web) — plan de implementación

> **Fecha:** 2026-10-21 · **Rama base:** `feat/cuenta-refactor` (desde `dev`)
> **Insumo:** [`cuenta-web.md`](./cuenta-web.md) (inventario y brechas B1–B13).
> **Estado:** F0–F8 implementadas en `feat/cuenta-refactor` (2026-10-21/22). Ver §0 para lo que cambió respecto del plan.
> **Convención:** ✅ ya existe · 🔶 por construir · ⚠️ a verificar en el código antes de empezar la fase.

---

## 0. Estado de la implementación

| Fase | Estado | Commit | Diferencias con el plan |
|---|---|---|---|
| F0 Pestañas | ✅ | `adeefb0` | — (el commit lleva el rótulo «docs» pero incluye el código de F0 y F1) |
| F1 Plan | ✅ | `adeefb0` | El «congelado» se calcula en la web (consumo > tope); no hay campo nuevo en la API salvo `trialEndsAt` |
| F2 Barra de guardado | ✅ | `0fc6384` | Las plantillas de WhatsApp quedan fuera: se guardan una a una desde su ventana |
| F3 Catálogos | ✅ | `df5a47b` | 13 catálogos editables. Quedan fuera los que la lógica usa por código (`INCOME_SOURCE`, `PRIORITY`, `EXPECTED_RESULT`, `CURRENCY`) y `CAMPAIGN`. El contenido adicional (`metadata`) no se edita |
| F4 Identidad y contacto | ✅ | `8b243eb` | `/auth/me` suma `account { name, phone, logoUrl }` (con `withSystemTenant`, porque ese endpoint no pasa por `TenantGuard`). **Falta que el móvil use `{{telefono_negocio}}`** |
| F5 Preferencias | 🟡 | `4d10121` | Se guardan, validan y sirven; **ningún módulo las consume todavía** (ver §9) |
| F6 Agencias | ✅ | `564c0ac` | Sin permisos nuevos: leer = `user:read`, escribir = `account:write`. No se desactiva ni se quita una agencia con miembros activos. No se agregó el selector en la ficha del miembro: se cambia desde Cuenta → Agencias |
| F7 Actividad, facturación, solicitudes | ✅ | `18a267b` | Facturación reducida a datos fiscales + historial (sin facturas ni pasarela). Las solicitudes se atienden por consola: `pnpm --filter @kobrax/api request:handle` |
| F8 Avanzado | 🟡 | _este commit_ | Respaldo, baja, transferencia de propiedad ✅. **D5 (retención de fotos): solo modo simulación**, no se elimina ni archiva nada |

Migraciones aplicadas: `20261021100000_account_branding`, `20261021110000_branch_code_unique`, `20261021120000_account_requests`.

## 1. Decisiones tomadas (2026-10-21)

| # | Pregunta | Decisión | Consecuencia en el plan |
|---|---|---|---|
| 1 | ¿Solo reorganizar o también datos nuevos? | **Todo**: reorganización + datos nuevos + catálogos + agencias + plan/control | Se implementan las secciones A, B, C y D del inventario |
| 2 | ¿`/settings/*` entra en Cuenta? | **No.** Se mantiene separado: es «Mi perfil» y datos del usuario | **Se descarta A2.** Cuenta = el negocio; Ajustes = la persona. Solo se agrega un enlace cruzado entre ambos |
| 3 | ¿Habrá cobro dentro del producto? | **No.** El plan lo sigue gestionando Kobrax | Sin pasarela, sin cobro automático, sin cambio de plan por el cliente. D1 es **solicitud**; D2 se reduce a **datos de facturación + historial** de lo que Kobrax registra |
| 4 | ¿Agencias en este refactor? | **Sí**, aquí | Fase propia (F6) con CRUD y asignación de miembros |

### Interpretaciones que conviene confirmar
- **D2 reducido:** «Facturación» muestra datos fiscales editables por el cliente + historial de cambios de plan (lectura). **No** incluye facturas descargables ni medios de pago. Si se quieren facturas, es una decisión adicional.
- **D5 (retención de fotos)** choca con el principio 5 de `CLAUDE.md` (evidencia inmutable). Queda **al final y con compuerta** (ver F8).

---

## 2. Estructura objetivo de `/cuenta`

Navegación por **rutas** (no por estado), con pestañas. Cada pestaña se oculta si el rol no la puede abrir.

| Ruta | Pestaña | Contenido | Permiso de lectura |
|---|---|---|---|
| `/cuenta` | — | Redirige a la primera pestaña visible | `account:read` |
| `/cuenta/general` | General | Logo, datos del negocio, contacto, zona horaria | `account:read` (edita `account:write`) |
| `/cuenta/plan` | Plan | Resumen, medidores, fin de prueba/congelado, solicitar cambio | `account:read` |
| `/cuenta/cobranza` | Cobranza | País y decimales, método de mora, categorías de mora, preferencias (horario, días hábiles) | `account:read` / `collection:read` |
| `/cuenta/mensajes` | Mensajes | Plantillas de WhatsApp con variables del negocio | `catalog:read` |
| `/cuenta/catalogos` | Catálogos | Editor de motivos de no pago, rubros, medios de pago, bancos, tipos de crédito | `catalog:read` (edita `catalog:write`) |
| `/cuenta/agencias` | Agencias | CRUD de sucursales y asignación de miembros | ⚠️ ver F6 |
| `/cuenta/facturacion` | Facturación | Datos fiscales + historial de plan | `account:read` |
| `/cuenta/actividad` | Actividad | Historial de cambios de la cuenta | ⚠️ ver F7 |
| `/cuenta/avanzado` | Avanzado | Respaldo, solicitar baja, transferir propiedad | `account:write` (propiedad: administrador dueño) |

⚠️ `apps/web/src/lib/nav.ts` tiene un comentario sobre «el día que existan `/cuenta` y `/cuenta/facturacion`, gana el que esté primero»: revisar esa regla de resaltado del menú antes de F0.

**Enlace cruzado con Ajustes:** en General, la línea «Tu perfil personal» → `/settings/perfil` (ya existe como `profileLink` en `business-form`); en Ajustes, un enlace de vuelta a Cuenta solo si el rol tiene `account:read`.

---

## 3. Fases

Cada fase = **una PR a `dev`**, con rama `feat/cuenta-<fase>` salida de `dev` actualizado (patrón del repo: `feat/equipo-ficha-miembro` → PR #22). `feat/cuenta-refactor` lleva solo los documentos y F0.

Orden pensado para que **cada fase deje la app funcionando** y las migraciones lleguen tarde pero ordenadas.

```
F0 Estructura  →  F1 Plan  →  F2 Guardado + Cobranza  →  F3 Catálogos
      →  F4 Identidad y contacto  →  F5 Preferencias  →  F6 Agencias
      →  F7 Actividad + Facturación + Solicitudes  →  F8 Avanzado (+ retención)
```

### F0 — Estructura de pestañas (solo web)
**Objetivo:** partir la página larga en rutas sin cambiar datos.

- Layout `apps/web/src/app/(panel)/cuenta/layout.tsx` con `PageHeader` y barra de pestañas; helper `cuentaTabs(permisos)` en `apps/web/src/lib/` (patrón de `nav.ts`, con su `.test.ts`).
- Mover los bloques existentes: `PlanCard` → `plan/`, `BusinessForm` (parte negocio) → `general/`, `BusinessForm` (parte financiera) + `ArrearCategories` → `cobranza/`, `WhatsappTemplates` → `mensajes/`.
- Partir `business-form.tsx` (273 líneas) en dos componentes; hoy dibuja dos `Section` en uno.
- `/cuenta` redirige a la primera pestaña visible; el 403 de `account:read` mantiene el `EmptyState` actual.
- i18n es/en: claves `account.tabs.*`.

**Criterios de aceptación:** mismas funciones que hoy; un rol sin `catalog:read` no ve «Mensajes»; URL directa a una pestaña sin permiso muestra «sin acceso»; ningún cambio en API.
**Tests:** vitest de `cuentaTabs`; los `*.test.tsx` existentes siguen verdes tras mover archivos.
**Esfuerzo:** S–M.

### F1 — Plan rediseñado (A4)
**Objetivo:** que el plan se entienda de un vistazo.

- Tarjetas de resumen: plan, estado, personas usadas/tope, días de prueba restantes.
- `trialEndsAt` ya vive en `settings` (✅, lo usa `plan-lifecycle.service.ts`). 🔶 Exponerlo en `GET /accounts/me` (serializer + `AccountInfo` en `packages/shared`) como campo **aditivo** (`trialEndsAt: string | null`) para no romper al móvil.
- Estado «congelado» (excede el tope tras bajar a Free): mensaje explícito. ⚠️ confirmar cómo se calcula hoy en `plan-limits.service.ts`.
- Medidores existentes se conservan.

**Criterios:** una cuenta en prueba muestra «vence en N días»; una congelada explica qué puede y qué no.
**Tests:** `accounts.service.spec.ts` (campo nuevo), vitest del componente.
**Esfuerzo:** S.

### F2 — Barra de guardado única + Cobranza (A3)
**Objetivo:** un solo modelo de edición para toda la cuenta.

- Contexto `SettingsDirtyProvider` en `apps/web/src/components/`: cada formulario registra `dirty`, `save()` y `reset()`; barra fija inferior «Descartar / Guardar cambios» que aparece si hay cambios.
- Aviso al salir con cambios (`beforeunload` + intercepción de navegación entre pestañas).
- Adaptar `BusinessForm`, `ArrearCategories`, `WhatsappTemplates`: dejan de tener botón propio; mantienen el `diff` mínimo (`diffAccount`/`diffProfile` de `shared`).
- Guardado parcial: si una sección falla y otra no, la barra lista cuál falló y deja el resto guardado.

**Criterios:** editar en dos secciones y guardar una vez envía dos PATCH; navegar con cambios pide confirmación; los errores 400 de `forbidNonWhitelisted` se muestran por campo.
**Tests:** vitest del provider (dirty, descartar, falla parcial).
**Esfuerzo:** M. **Riesgo:** tocar tres formularios con tests existentes; migrarlos uno a uno.

### F3 — Editor de catálogos (C1)
**Objetivo:** dejar de depender de la API para motivos, rubros, medios de pago, bancos, etc.

- ✅ Endpoints `GET/POST/PATCH /catalogs/:catalog` ya existen (`catalogs.controller.ts`, `CatalogType` en shared).
- Pantalla: selector de catálogo (lista de `CatalogType` editables), tabla código / etiqueta / orden / activo, alta y edición, desactivar en vez de borrar.
- ⚠️ Verificar qué catálogos son de **sistema** (no editables) y cuáles llevan `metadata` obligatoria (las plantillas ya la usan: `metadata.body`).
- Las plantillas de WhatsApp siguen en su pestaña; se excluyen de este editor.
- Reordenar con flechas (sin drag-and-drop en esta fase).

**Criterios:** un administrador agrega un motivo de no pago y aparece en la gestión de mora/móvil; desactivarlo no rompe registros históricos.
**Tests:** vitest del editor; si hace falta endpoint de orden, `catalogs.service.spec.ts`.
**Esfuerzo:** M.

### F4 — Identidad y contacto del negocio (B-1, B-2, B-4)
**Objetivo:** logo y datos de contacto, usados en panel, recibos y mensajes.

**Migración M1** (`packages/database/prisma/migrations/<ts>_account_branding`):
- `accounts.logo_url TEXT NULL`, `accounts.phone TEXT NULL`, `accounts.email TEXT NULL`, `accounts.website TEXT NULL`, `accounts.address TEXT NULL`, `accounts.city TEXT NULL`.
- Columnas y no JSON: se consultan al armar recibos y no necesitan versionado de forma.
- Sin tabla nueva ⇒ RLS de `accounts` (`tenant_self`) ya cubre.

**API:**
- `UpdateAccountDto`: agregar los seis campos opcionales con `@Length`/`@IsEmail`/`@IsUrl`. `logoUrl` solo acepta URLs devueltas por `/uploads` de la propia cuenta (validar prefijo/host; hoy el perfil hace algo similar con `photoUrl` ⚠️ copiar el patrón).
- `AccountInfo` y `accounts.serializer.ts`: campos aditivos.
- Auditoría: ya cubierta por el interceptor de mutaciones ⚠️ confirmar que `PATCH /accounts/me` redacta/registra el diff.

**Web:** subida de logo reutilizando `POST /api/account/upload` (hoy lo usa el perfil) con previsualización; logo en el encabezado del panel (⚠️ ver `layout.tsx` del shell); formulario de contacto en General.
**B-4:** variables `{negocio}` y `{telefono_negocio}` en plantillas. 🔴 Son **contrato con el móvil** (`renderTemplate`): se agregan en `packages/shared` y se avisa que el móvil debe actualizarse; mientras tanto la variable desconocida debe quedar literal, no vacía ⚠️ verificar el comportamiento actual.

**Criterios:** logo visible en el encabezado tras guardar; correo/URL inválidos dan error por campo; el móvil sigue funcionando sin actualizar (campos aditivos).
**Tests:** `accounts.service.spec.ts`, DTO, vitest del formulario. **Agregar los specs nuevos a la lista del script `test` de `apps/api/package.json`** (los tests se enumeran a mano).
**Esfuerzo:** M–L (migración + upload + contrato móvil).

### F5 — Preferencias de la cuenta (B-3)
**Objetivo:** usar `configuration` (hoy sin uso) para preferencias operativas.

- Forma tipada en `packages/shared` (`AccountPreferences`): formato de fecha, primer día de la semana, días hábiles, horario laboral (inicio/fin), idioma por defecto.
- Validación en el DTO (patrón de `currencyDecimals`: viaja como string y el service lo normaliza).
- Pestaña Cobranza, sección «Preferencias».
- ⚠️ **Alcance real:** guardar la preferencia es barato; **que agenda, recordatorios y formatos la respeten** toca otros módulos (`agenda`, `notifications`, `TenantClockService`). Esta fase entrega: guardar + leer + aplicar en **formato de fecha del panel** y **horario laboral en el cálculo de "hoy/horario" de agenda solo si ya existe un punto único**. Lo demás queda registrado como deuda explícita.

**Esfuerzo:** M.

### F6 — Agencias (C2)
**Objetivo:** gestionar sucursales y asignar miembros desde la web.

**Punto de partida (✅):** modelo `Branch` completo (nombre, código, ciudad, dirección, `managerUserId`, `active`, `deletedAt`); `UserAccount.branchId`; `Credit.branchId`, `RoutePlan.branchId`, etc. ya la referencian; el seed crea 2 agencias (CEN, ALT) y varias reglas de alcance (supervisor ve «su agencia») ya la usan.
**Lo que falta (🔶):** módulo de API y pantalla.

**API — nuevo módulo `branches`** (patrón del resto: controller + service + serializer + dto + spec):
- `GET /branches`, `POST /branches`, `PATCH /branches/:id`, `DELETE /branches/:id` (baja lógica).
- `PATCH /users/:id` ya existe: ⚠️ comprobar si acepta `branchId`; si no, extender el DTO y la regla en `users.service`.
- Reglas: `code` único por cuenta (⚠️ hoy no hay índice único; agregar **migración M2** `@@unique([accountId, code])` parcial sobre no borrados, después de verificar duplicados en datos existentes); no se puede **desactivar/borrar** una agencia con miembros, créditos o rutas activos sin traspasarlos (mismo criterio que desactivar miembros, reusar el patrón de traspaso); `managerUserId` debe ser un miembro activo de la cuenta.
- Permisos: ⚠️ decidir entre reutilizar `account:write`/`user:read` (recomendado: sin tocar el seed de 36 permisos ni `roles-permisos-planes.md`) o crear `branch:*`. Si se crean, actualizar enum, `ROLE_PERMISSIONS`, seed y la doc.
- Auditoría en cada mutación; `account_id` y RLS: la tabla `branches` ✅ ya los tiene (⚠️ confirmar política en `rls/001`).
- Límite de plan: **no** hay tope de agencias en `PlanLimits`; no se inventa uno.

**Web:** pestaña Agencias: tabla (nombre, código, ciudad, responsable, miembros, estado), alta/edición en panel lateral, asignación masiva de miembros (selección múltiple + «mover a agencia»). En la ficha del miembro (`/equipo/[userId]`) mostrar y permitir cambiar la agencia.

**Criterios:** crear agencia y asignarle un supervisor cambia lo que ese supervisor ve en mora/agenda; intentar desactivar una agencia con créditos activos exige traspaso; aislamiento multi-tenant verificado.
**Tests:** `branches.service.spec.ts` (+ aislamiento), integración si toca alcance (`apps/api/test/integration`, también enumerado a mano en el script), vitest de la pantalla.
**Esfuerzo:** L. **Riesgo mayor del plan:** cambiar la agencia de un miembro altera su alcance de datos; probar con los usuarios del seed (`supervisor@`, `multi@`).

### F7 — Actividad, Facturación y Solicitudes (D3, D2 reducido, D1)

**D3 — Actividad de la cuenta**
- `GET /accounts/me/audit` paginado con filtros (usuario, acción, rango). Reutiliza el servicio de auditoría y el patrón de `GET /users/:id/audit` de la ficha del miembro.
- ⚠️ Permiso: el audit incluye IPs y cambios de seguridad; restringir a administrador (o `audit:read` si existe). Respetar `redact` (✅ `common/audit/redact`) para no exponer secretos.
- Pestaña «Actividad»: lista cronológica «quién · qué · cuándo · IP», con detalle expandible del diff.

**D2 reducido — Facturación**
- **Datos fiscales** (razón social de facturación, NIT, dirección fiscal, correo para facturas) en `configuration.billing`, tipado en shared, editables con `account:write`. Sin migración.
- **Historial de plan** (solo lectura): cambios de plan/estado registrados por Kobrax. ⚠️ Verificar que `plan:set` / `account:suspend` (CLI, ✅ auditados) dejan acción identificable en `audit_logs`; si sí, se lee de ahí filtrando por acción; si no, ajustar la CLI para registrar `PLAN_CHANGED` con plan anterior/nuevo.
- Texto fijo: «El plan lo gestiona el equipo de Kobrax» + contacto.

**D1 — Solicitar cambio de plan**
- **Migración M3:** tabla `account_requests` (`id`, `account_id`, `type` enum PG nativo `PLAN_CHANGE | CLOSURE`, `payload` jsonb, `status` enum `PENDING | HANDLED | REJECTED`, `requested_by`, `created_at`, `handled_at`, `handled_note`), con `account_id` + RLS (`tenant_isolation`) y índices `(account_id, status)`.
- `POST /accounts/me/requests` (`account:write`), `GET /accounts/me/requests`. Una sola `PENDING` por tipo y cuenta.
- Aviso al equipo de Kobrax: reutilizar el canal del aviso de ventas al 100 % (`plan-usage-alerts.service.ts`) ⚠️ ver cómo notifica hoy (log / correo / webhook) y usar el mismo.
- Gestión del lado Kobrax: por **CLI**, igual que `plan:set` (nuevo `request:handle`), coherente con la decisión 3. Sin backoffice en esta fase.
- Web: en Plan, botón «Solicitar cambio de plan» (modal con plan deseado y nota) y estado de la solicitud pendiente.

**Tests:** `accounts.service.spec.ts`/nuevo `account-requests.service.spec.ts`, aislamiento por tenant, vitest.
**Esfuerzo:** L (tres piezas; se pueden partir en 3 PR si crece).

### F8 — Avanzado (D4) y retención de fotos (D5)

**D4 — Zona avanzada** (`/cuenta/avanzado`)
- **Respaldo:** enlace/botón a la exportación completa existente (`GET /exports/backup`, ✅, auditada, solo con permiso de exportar); no se reimplementa.
- **Solicitar baja:** crea `account_requests` tipo `CLOSURE` (F7). Texto claro de consecuencias; confirmación escribiendo el nombre del negocio. No borra nada: Kobrax gestiona.
- **Transferir propiedad:** `POST /accounts/me/transfer-ownership` { `userId` }. Solo el dueño actual (`isOwner`); destino debe ser administrador activo de la cuenta; exige **contraseña actual y MFA reciente**; una sola transacción; auditoría; notifica a ambos. ⚠️ Confirmar cómo se modela `isOwner` (visto en el seed) y qué restricciones ya tiene el equipo («siempre queda un administrador»).
- Acciones destructivas: confirmación explícita (regla del repo `.claude/rules/prompts-confirmation.md`).

**D5 — Retención de fotos** — ⛔ **con compuerta**
- Hoy `photoRetentionMonths` solo se muestra; nada la aplica.
- 🔴 Conflicto con el principio «evidencia inmutable»: borrar el archivo no puede invalidar el hash SHA-256 guardado en base. Antes de escribir código hace falta decisión de producto/legal sobre: borrar vs mover a almacenamiento frío; si se conserva el hash y los metadatos; excepciones (casos en disputa, pagos relacionados).
- Si se aprueba, entregar en dos pasos: (1) **modo simulación** (job que solo reporta cuántas fotos vencerían, por cuenta) y (2) aplicación real tras revisión, con registro de auditoría por lote.
- Hasta tener esa decisión, la pantalla Plan **sigue rotulando** la retención como informativa.

**Esfuerzo:** D4 M–L; D5 L + decisión previa.

---

## 4. Resumen de migraciones y contratos

| ID | Fase | Cambio | Reversible | Nota |
|---|---|---|:-:|---|
| M1 | F4 | `accounts`: 6 columnas nullable (logo, contacto) | ✅ | Aditiva; el móvil no se rompe |
| M2 | F6 | Unicidad de `branches(account_id, code)` entre no borradas | ✅ | Revisar duplicados antes |
| M3 | F7 | Tabla `account_requests` + 2 enums PG + RLS | ✅ | Tabla operativa ⇒ `account_id` y RLS obligatorios |
| — | F1/F4/F5/F7 | `AccountInfo` y shared: campos nuevos **aditivos** | — | Móvil/web viejos siguen funcionando |

Aplicar RLS: las migraciones no incluyen las políticas de tablas nuevas si siguen el esquema del repo (`prisma/rls/`); ⚠️ confirmar si M3 las crea en la propia migración (como `client_import_runs`, que usa `app_current_account()`) o en `rls/001`, y verificar con `rls/verify_isolation.sql`.

## 5. Reglas del repo que se aplican en todas las fases

- Multi-tenant: tablas nuevas con `account_id` + RLS. Audit trail en toda mutación (who/when/what/ip).
- Respuestas `{ data, meta, error }`; DTOs con `forbidNonWhitelisted`; **sin `any`**.
- `planCode`, `limitsOverride`, `status`, `accountType` nunca por `PATCH /accounts/me`.
- Nombres: archivos `kebab-case`, tablas `snake_case` plural, enums PG nativos.
- Textos en `apps/web/src/messages/{es,en}.json`, ambos idiomas.
- Los specs de API **se agregan a mano** al script `test` (y los de integración a `test:integration`) en `apps/api/package.json`.
- Verificación por fase: `pnpm --filter @kobrax/api type-check && pnpm --filter @kobrax/api test`, `pnpm --filter @kobrax/web type-check && pnpm --filter @kobrax/web test`, y recorrido manual en el navegador con `owner@kobrax.demo` (administrador) y `manager@kobrax.demo` (solo lectura) para validar permisos.
- Entorno local: usar un solo `nest --watch` (dos procesos se pisan el `dist`).

## 6. Riesgos principales

| Riesgo | Fase | Mitigación |
|---|---|---|
| Cambiar agencia altera el alcance de datos de supervisores | F6 | Pruebas de integración con usuarios del seed; traspaso obligatorio al desactivar |
| Contrato de plantillas con el móvil | F4 | Variables nuevas aditivas; la desconocida queda literal; avisar a móvil |
| Conflicto con evidencia inmutable | F8/D5 | Compuerta de decisión + modo simulación primero |
| Migrar tres formularios a un guardado único | F2 | Un formulario por commit, tests existentes como red |
| Tests de API no corren si no se enumeran | Todas | Checklist en cada PR |
| Preferencias guardadas pero ignoradas por otros módulos | F5 | Declarar alcance y deuda explícitamente |

## 7. Fuera de alcance (decidido)

Pasarela de pago, cobro automático, cambio de plan por el cliente, facturas descargables, backoffice de Kobrax, roles personalizados, SSO, y cambios en la app móvil (solo se cuida que los contratos sean aditivos).

## 8. Siguiente paso

Aprobar este plan y arrancar **F0** en `feat/cuenta-refactor`. Antes de cada fase se resuelven los puntos marcados ⚠️ leyendo el código indicado.

---

## 9. Pendientes y deuda explícita

1. **Preferencias de trabajo (F5)** — días y horario laboral, inicio de semana e idioma por defecto se guardan pero ningún módulo las lee. Consumidores previstos: calendarios de agenda (inicio de semana: `weekOf` en `lib/agenda.ts` asume lunes), recordatorios (`notifications`) y el cálculo de «hoy/horario» de la agenda. El idioma por defecto debería aplicarse al abrir el panel de alguien sin cookie `k_locale`.
2. **Retención de fotos (D5)** — 🔴 **requiere decisión de producto/legal antes de escribir código de borrado.** Hoy solo se informa cuántas fotos pasaron el plazo (`GET /accounts/me/retention`). Decidir: ¿borrar o mover a almacenamiento frío?; ¿se conserva el hash SHA-256 y los metadatos (principio de evidencia inmutable)?; ¿qué pasa con fotos de gestiones en disputa o de pagos relacionados? Si se aprueba, entregar en dos pasos: job de simulación por cuenta y, tras revisión, aplicación por lotes con auditoría.
3. **Móvil** — sumar `{{telefono_negocio}}` a las variables de las plantillas (`agenda-register.tsx`); mientras no esté, queda literal (es seguro). Mostrar logo y contacto en «Datos de la cuenta» si se quiere.
4. **Ficha del miembro** — poder cambiar la agencia desde `/equipo/[userId]` (hoy se hace en Cuenta → Agencias; `PATCH /users/:id` ya acepta `branchId`).
5. **Alcance del supervisor tras mover de agencia** — la API aplica el cambio, pero no se verificó con una prueba de integración contra la base cuánto tarda en reflejarse en la sesión ya abierta del supervisor.
6. **Aviso de «withTenant sin contexto»** — `/auth/me` ya no lo dispara; el login sí sigue generando el aviso existente (no es de este refactor).
7. **Historial de commits** — `adeefb0` mezcla docs y código de F0/F1 por un `git add` previo; no se reescribió porque ya está en el remoto.
