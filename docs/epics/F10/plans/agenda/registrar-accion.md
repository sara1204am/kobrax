# Agenda · S4 — Registrar acción (ejecutar la gestión)

> **ESTADO: ✅ CONSTRUIDO (2026-07-12).** Verde: shared **15 tests** (+7) · API type-check + **225 tests**
> (+10) · móvil type-check + **71 jest** (+1) + `expo export`. Migración `20260711000000_add_whatsapp_template_catalog`
> aplicada (`migrate deploy`) + cliente Prisma regenerado. **Smoke real: pendiente** (no se levantó la API).
> **Code-review high (workflow) OK — 6 defectos arreglados:** (1) `postpone` mezclaba el reloj UTC del
> server con la hora de pared naive → corría la hora por el offset del tenant en toda LatAm; reescrito como
> aritmética de minutos pura sobre `scheduledDate`+`scheduledTime` (con inicio de franja para los LAPSE);
> (2) el detalle descartaba el ítem que devolvía la mutación y dependía del refetch → si fallaba, quedaba
> "pendiente" y re-enviaba (409); ahora aplica `res.data` directo; (3) el sheet retenía el outcome al
> reabrir → reset al cerrar; (4) import muerto; (5) plantillas WhatsApp se refetcheaban en cada apertura →
> `listCatalogCached`. **Pendiente: validación visual de la usuaria** contra los 4 PNGs de acción + smoke.
> Índice: [README.md](./README.md) · Modelo: [DOMAIN.md](./DOMAIN.md) · Depende de
> [00-fundacion.md](./00-fundacion.md) (tablas/enums/catálogos), [crear.md](./crear.md) (S2, el `details`)
> y [ver.md](./ver.md) (S3, el detalle que trae el `target`/`labels` y monta el botón "Registrar gestión").
> **Rama:** se continúa en `f10/agenda-fundacion` (el módulo se mergea junto).
> **Build:** 🟡 **dev build** — sin dependencias nuevas de RN, pero **hay migración** (nuevo valor de
> enum `CatalogType.WHATSAPP_TEMPLATE`). `Linking`/`wa.me` ya se usan en S3.

## 1. Objetivo
El cobrador ejecuta una gestión agendada y **registra su resultado**: desde el detalle (S3) toca
"Registrar gestión", elige el desenlace propio del tipo (contactado/sin respuesta · confirmó/no pagó ·
realizado · mensaje enviado), agrega una nota, y guarda. El agendado pasa a **EXECUTED**, queda un
`CaseActivity` en el historial del caso, y la agenda del día lo mueve de Pendientes a Completados.
Sin salir del sheet puede **posponer** (+15/+30/+1h) o **enviar el WhatsApp** con una plantilla.

## 2. Pantallas Figma (node-ids confirmados)
Diseño "Kobrax movil" · fileKey `daLWsKQGC4Sd1NacU9fmrP`. **PNGs ya exportados** por la usuaria en
`docs/epics/F10/figma/` → se leen desde disco, **cero pulls MCP**.

| Acción del tipo | node-id | PNG |
|---|---|---|
| Llamada (bottom sheet) | `66:1763` | `Acción_ Llamada (Bottom Sheet).png` |
| WhatsApp (envío + plantillas) | `66:2195` | `Acción_ WhatsApp (Envío).png` |
| Promesa de pago (confirmó/no pagó) | `66:2440` | `Acción_ Promesa de pago (Full Screen).png` |
| Recordatorio (posponer + realizado) | `66:2531` | `Acción_ Recordatorio (Full Screen).png` |
| Visita | (reusa el patrón de Llamada) | — |

### Anatomía por tipo (leída de los PNGs)
| Tipo | Sheet |
|---|---|
| **Llamada / Visita** | nombre + mora + deuda · botones **Llamar**/**Navegar** + **WhatsApp** (reusan S3) · footer **"Registrar gestión"** → elige desenlace (Contactado · Sin respuesta · Número equivocado) + nota |
| **WhatsApp** | teléfono · chips de **plantilla** (Cobro inicial · Recordatorio · Último aviso) · **contenido** editable con variables resueltas · **"Enviar por WhatsApp"** (abre `wa.me`) → al volver, registrar "mensaje enviado" |
| **Promesa** | monto prometido · banco · **"Confirmó pago"** (verde) / **"No pagó"** (rojo) |
| **Recordatorio** | descripción · **"Posponer para luego"** (+15 / +30 / +1h) · **"Realizado"** |

## 3. Alcance (decisiones de la usuaria, 2026-07-11)
**SÍ (todo lo del Figma):**
- **Ejecutar** los 5 tipos → `POST /api/agenda/:id/complete`: crea un `CaseActivity`, setea
  `agenda_items.resultActivityId`, status → **EXECUTED**. Desenlace + nota.
- **Posponer** (+15/+30/+1h) → `POST /api/agenda/:id/postpone`: corre `scheduledTime`/`scheduledDate`,
  status **sigue SCHEDULED**. Es un reagendado-exprés sin motivo; el reagendado con motivo/fecha libre es S6.
- **Plantillas de WhatsApp** configurables por tenant → **nuevo `CatalogType.WHATSAPP_TEMPLATE`**
  (`catalog_items`, `metadata: { body }`) + seed de 3 (Cobro inicial · Recordatorio · Último aviso).
  Variables `{{cliente}}` y `{{saldo}}` se resuelven **en el móvil** al pintar (datos que S3 ya trae).

**NO (fuera de S4):**
- **"Confirmó pago" NO crea un Payment** (decisión cerrada): solo marca el desenlace de la promesa
  (`PROMISE_KEPT` / `PROMISE_BROKEN`). Registrar el cobro real (monto/método/conciliación) es del módulo
  **Cobranza**; el botón puede navegar allá en una capa posterior. Ejecutar el agendado **no** transiciona
  el estado del **caso** (solo el del agendado); las transiciones de caso son de F5.
- **Reagendar con motivo/fecha libre** (catálogo `RESCHEDULE_REASON`) = **S6**. S4 solo pospone en pasos fijos.
- **Cancelar** la gestión (`CANCEL_REASON`) = **S6**.
- **Evidencia** de visita (GPS/foto/firma) = P8. **ABM visual** de plantillas = capa de extras.
- **Notificación push** "Gestión pendiente a las 11:30" (PNG `Notificación y Home`) = realtime, **F8**.

## 4. Contrato (endpoints reales, prefijo `/api`, envelope `{data,meta,error}`)

### 4.1 NUEVO — ejecutar
`POST /api/agenda/:id/complete` · `@Roles(Permission.AGENDA_WRITE)` → `200` con el ítem serializado
(status EXECUTED + `resultActivityId`) para que el móvil actualice sin refetch.

```ts
{ outcome: AgendaOutcome, notes?: string(0..1000) }
```
- **`outcome` = enum por tipo** (shared, estructural — el código ramifica el `CaseActivityType`), cada tipo
  con los desenlaces que le aplican:
  - `CALL` · `WHATSAPP`: `CONTACTED · NO_ANSWER · WRONG_NUMBER`
  - `VISIT`: `CONTACTED · NOT_FOUND · WRONG_ADDRESS` (una visita no tiene "número equivocado")
  - `PROMISE_TO_PAY`: `PROMISE_KEPT · PROMISE_BROKEN`
  - `REMINDER`: `DONE`
  Un `outcome` que no corresponde al tipo → `400 AGENDA_007`.
- **Validaciones**: ítem existe, `deletedAt:null`, en scope (`assigneeScope`), **status SCHEDULED**
  (ejecutar dos veces → `409 AGENDA_008`). → si no, 404/409.
- **Efecto** (una transacción): `caseActivity.create({ type: mapType(agendaType), result: outcome, notes })`
  + `agendaItem.update({ status: EXECUTED, resultActivityId, updatedBy })`. `mapType`: CALL→CALL,
  VISIT→VISIT, WHATSAPP→MESSAGE, PROMISE_TO_PAY→NOTE, REMINDER→NOTE.
- **Audit** `agenda_item/EXECUTE` (firma de `routes.service.ts:46`). Emite `CASE_UPDATED` (como `cases.addActivity`).

### 4.2 NUEVO — posponer
`POST /api/agenda/:id/postpone` · `@Roles(Permission.AGENDA_WRITE)` → `200` con el ítem actualizado.

```ts
{ minutes: 15 | 30 | 60 }   // los 3 pasos del Figma; @IsIn evita valores libres
```
- Solo sobre un ítem **SCHEDULED** en scope. Suma minutos a `scheduledDate`+`scheduledTime`; si cruza la
  medianoche, avanza el día. **timeMode pasa a FIXED** (posponer fija una hora concreta aunque fuera LAPSE).
- Audit `agenda_item/POSTPONE` con `before`/`after` de la hora.

### 4.3 NUEVO — `CatalogType.WHATSAPP_TEMPLATE`
Migración que **agrega el valor al enum** `CatalogType` (`ALTER TYPE ... ADD VALUE`) + seed de 3 plantillas
en el tenant demo. Se leen con el endpoint que **ya existe**: `GET /api/catalogs/WHATSAPP_TEMPLATE`
(`catalogs.controller.ts`). El cuerpo va en `metadata.body` con `{{cliente}}`/`{{saldo}}`.
> ⚠️ `ADD VALUE` no puede correr dentro de una transacción con otros cambios en algunos PG; la migración
> va **sola**. Se aplica con **`migrate deploy`** (no `dev`) — misma razón que la fundación (shadow DB + RLS).

### 4.4 Tablas
`agenda_items` (update), `case_activities` (insert), `catalog_items` (seed del nuevo tipo). **Migración:
solo el valor de enum** — sin tablas nuevas. RLS ya cubre las 3.

## 5. Auditoría de reuso (Paso B)
| Capacidad | Decisión | Path |
|---|---|---|
| Serializer del agendado | **REUSAR** | `agenda.serializer.ts` (`serializeAgendaItem`) |
| Scope + 404/409 | **REUSAR/EXTENDER** | `assigneeScope()` · `agendaItemNotFound()` + `AGENDA_007/008` nuevos en `agenda.errors.ts` |
| Crear CaseActivity + tocar `lastActionAt` + emitir `CASE_UPDATED` | **REUSAR patrón** | `cases.service.ts:228` (`addActivity`) |
| Audit trail | REUSAR | `AuditService.record({entity,entityId,action,before?,after?})` |
| Catálogos (leer plantillas) | **REUSAR** | `GET /api/catalogs/:catalog` (`catalogs.controller.ts`) — sin endpoint nuevo |
| Enum de dominio (outcome, mapType) | **NUEVO** | `packages/shared` `AgendaOutcome` + `AGENDA_OUTCOMES_BY_TYPE` (lo usan API y móvil) |
| Guards / envelope / enums existentes | REUSAR | auth guards · `ResponseDto` · `AgendaItemType/Status`, `CaseActivityType` |
| Llamar / WhatsApp / Navegar | **REUSAR** | `actionLinks` / `whatsappLink` (`agenda.service.ts`, S3) |
| Resolver `{{cliente}}`/`{{saldo}}` | **NUEVO, puro** | `packages/shared` `renderTemplate(body, vars)` — lo usan móvil (y server si algún día pre-renderiza) |
| `BottomSheet` / `Header` / `StatusBadge` / `SectionLabel` | REUSAR | `src/ui.tsx` |
| `Button` (primary/secondary/danger/success) / `Field` / `ErrorBanner` | REUSAR | `src/components.tsx` |
| Tokens · moneda (`money`) · `MONTHS`/franjas | REUSAR | `src/theme.ts` · `src/agenda-form.ts` |
| `apiMutate` (POST + envelope) | REUSAR | `src/api-client.ts` |
| `completeItem` / `postponeItem` / `listTemplates` | **NUEVO** | se agregan a `src/agenda.service.ts` |
| Sheet de resultado por tipo, chips de plantilla | **NUEVO, local a la screen** | dentro del detalle `app/agenda/[id].tsx` (o un `ActionSheet` hermano); sube a `ui.tsx` si S5/S6 lo piden |

## 6. Tareas (orden: shared → migración → backend → tests → UI)
1. `packages/shared`: `AgendaOutcome` + `AGENDA_OUTCOMES_BY_TYPE` + `renderTemplate` + tests; export en `index.ts`.
2. DB: migración `add_whatsapp_template_catalog` (`ALTER TYPE CatalogType ADD VALUE 'WHATSAPP_TEMPLATE'`) sola;
   seed de 3 plantillas; `schema.prisma` += el valor. Aplicar con `migrate deploy`.
3. API: `agenda.errors.ts` (`AGENDA_007/008`); `CompleteAgendaDto`/`PostponeAgendaDto`;
   `AgendaService.complete()` y `.postpone()`; rutas en `agenda.controller.ts` (**después** de `:id`,
   son `:id/complete` y `:id/postpone` — no chocan con el `@Get(':id')`). Audit + evento.
3b. API tests (node:test): outcome↔tipo, doble ejecución → 409, scope, mapType, posponer cruza medianoche, RLS.
4. Móvil: `completeItem`/`postponeItem`/`listTemplates` en `agenda.service.ts`; `renderTemplate` en el envío.
5. Móvil: sheet de resultado por tipo en el detalle (chips de plantilla en WhatsApp, confirmó/no pagó en
   promesa, posponer+realizado en recordatorio, contactado/sin respuesta en llamada/visita). Cablear el
   botón "Registrar gestión" (hoy = aviso). Al volver, refrescar el detalle y la agenda.
6. Verificar: API type-check + tests · móvil type-check + jest + `expo export` · smoke real contra `:4010`.
7. `/code-review` + `/ponytail-review` sobre el diff.

## 7. Reglas de la fase
Las 3 del epic §3.3 — **sol→contraste** (desenlace y monto en `navy`/`text`; labels en `muted`; verde/rojo
solo en los botones de resultado), **gama baja→perf** (el sheet es estado local, sin re-render por tecla),
**animación con propósito** (haptic al registrar y al enviar WhatsApp, transición del sheet, nada más).
Además: multi-tenant **por capacidad** · TS estricto sin `any` · `{data,meta,error}` · audit en ejecutar y
posponer · enums y `renderTemplate` **solo** en `packages/shared`.

**Offline** (cola real = P6): registrar/posponer sin señal → `ErrorBanner` "Sin conexión — reintentá" y
conserva la selección; no bloquea el resto de la app. Enviar el WhatsApp **sí** funciona offline (abre la app
nativa); registrar el "mensaje enviado" queda para cuando vuelva la red.

## 8. Tests
- **shared**: `AGENDA_OUTCOMES_BY_TYPE` cubre los 5 tipos; `renderTemplate` reemplaza `{{cliente}}`/`{{saldo}}`
  y deja intacto lo que no matchea.
- **API**: ejecutar CALL con outcome de promesa → `AGENDA_007`; ejecutar un EXECUTED → `AGENDA_008`; ejecutar
  ajeno → 404; `mapType` correcto por tipo; `complete` deja `resultActivityId` y status EXECUTED y audita;
  posponer +60 cruzando medianoche avanza el día; RLS entre tenants.
- **móvil**: el sheet habilita "Registrar" solo con un outcome elegido; cambiar de plantilla repinta el
  contenido con las variables resueltas.

## 9. DoD
- `complete` y `postpone` con tests verdes; audit en ambos; `CASE_UPDATED` emitido al ejecutar.
- Con la API real: ejecutar cada uno de los 5 tipos desde el teléfono → el agendado pasa a Completados y
  aparece en el historial del caso (visible en el detalle S3). Posponer +30 mueve la hora y lo mantiene en
  Pendientes. Enviar un WhatsApp abre la app con la plantilla y las variables resueltas.
- Verde: shared · API type-check + tests · móvil type-check + jest + `expo export`.
- **Validación visual de la usuaria** contra los 4 PNGs de acción.

## 10. Riesgos / decisiones abiertas
- **`ADD VALUE` de enum**: no corre en la misma tx que otros cambios en PG < 12 y no es reversible con un
  `DROP VALUE`. La migración va sola y se aplica con `migrate deploy`. Documentado como la de la fundación.
- **Doble ejecución / carrera**: dos toques rápidos a "Registrar" → el guard `status SCHEDULED` en la misma
  tx hace que el segundo caiga en `AGENDA_008`. El móvil además deshabilita el botón mientras envía.
- **Posponer sobre un vencido** (decisión cerrada): un agendado vencido (SCHEDULED < hoy) se puede posponer;
  el posponer se ancla a `max(ahora, scheduledDateTime)` para que +15/+30/+1h **siempre** caiga en el futuro
  (posponer "15 min" un ítem de ayer lo lleería como "15 min desde ahora", que es lo que el cobrador espera).
  No se rechaza: rechazar obligaría a reagendar (S6) para algo que el botón rápido debe resolver.
- **Timezone** (heredado): todo en UTC; el "+1h" es aritmética de minutos, inmune al huso. El refinamiento
  tenant-tz sigue pendiente para todo el módulo.
- **`renderTemplate` con datos que S3 no trae**: `{{saldo}}` usa `credit.outstandingBalance` (sí viene);
  variables futuras que pidan datos ausentes se dejan literales, no rompen el envío.
