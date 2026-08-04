# Agenda · S5 + S6 — Editar · Reagendar · Cancelar · Eliminar

> **ESTADO: ✅ PASS de `/f10-validar-plan` (2026-08-04, ronda 2).** Habilitado para construir.
> La ronda 1 falló por dos bloqueantes, ya corregidos: la gestión cancelada desaparecía de la pantalla del
> día (→ **D6**) y `assertTimeMode` estaba citado en un archivo inexistente (→ es EXTENDER, `agenda.service.ts:536`).
> Índice: [README.md](./README.md) · Modelo: [DOMAIN.md](./DOMAIN.md) · Depende de
> [crear.md](./crear.md) (S2, el formulario que se reusa), [ver.md](./ver.md) (S3, el menú `…` que quedó
> oculto) y [registrar-accion.md](./registrar-accion.md) (S4, `posponer`, con el que no hay que confundirse).
> **Rama:** `f10/agenda-s5-s6`.
> **Build:** 🟢 Expo Go — **sin dependencias nuevas**. `Alert` es core de React Native y
> `@react-native-community/datetimepicker` ya está instalada (S1).

## 1. Objetivo
Cerrar el ciclo de vida de una gestión agendada: **corregirla** (se eligió mal el teléfono, cambió el
monto prometido), **moverla de día** dejando rastro, **cancelarla** con un motivo, o **borrarla** si se
cargó por error. Hoy un agendado sólo se puede completar o posponer: si está mal, no hay salida.

## 2. Pantallas Figma
**Ninguna nueva.** S5 reusa `app/agenda/crear.tsx` (nodos `65:724` y hermanos, S2) en modo edición; S6
vive en el menú `…` de `app/agenda/[id].tsx` (nodo `64:425`, S3), que ese plan dejó **oculto a propósito**
esperando esta etapa (`ver.md` §3 y §8.3). Reagendar y cancelar son hojas (`BottomSheet`), no pantallas.
**Cero pulls de Figma en toda la etapa.**

## 3. Alcance
**SÍ:** `PATCH /api/agenda/:id` · `POST /api/agenda/:id/cancel` · `POST /api/agenda/:id/reschedule` ·
`DELETE /api/agenda/:id` · migración de 2 columnas · modo edición en `crear.tsx` · menú `…` con las 4
acciones en `[id].tsx` · **los dos estados nuevos visibles en la pantalla del día (D6)** · el historial del
caso muestra la cadena de reprogramaciones.
**NO:** editar un agendado ya ejecutado o cancelado (`AGENDA_008`, error que ya existe) · cambiar de
deudor (D1) · ABM visual de los catálogos de motivos · cola offline de estas escrituras (P6) ·
deshacer una cancelación · borrado duro.

## 4. Decisiones (cerradas con la usuaria, 2026-08-04)

### D1. Se edita todo **menos el deudor**
Tipo, campos propios del tipo (teléfono, dirección, monto, mensaje, descripción), observaciones y la
**hora**. `clientId`/`caseId`/`creditId` son el ancla del agendado (`caseId` es NOT NULL desde S2 D1) y
**no se tocan**: para agendarle a otro deudor se elimina y se crea de nuevo. Consecuencia buena: el modo
edición no necesita el buscador de clientes ni revalidar el caso.

### D2. El menú ofrece **Cancelar** y **Eliminar** — son cosas distintas
- **Cancelar** → `status: CANCELLED`. La gestión existió y no se hizo: queda en el día y en el historial
  del caso. Es dato de gestión.
- **Eliminar** → soft-delete (`deletedAt`). La gestión **no debió existir** (se cargó al cliente
  equivocado). Desaparece de todas las vistas; el audit conserva el rastro.

### D3. Cancelar **pide motivo del catálogo**
El catálogo `CANCEL_REASON` ya está seedeado (`seed.ts:456-457`: "Cliente no disponible", "Datos
incorrectos") y hoy no lo lee nadie. Se elige de un `PickerSheet` que ya existe. Requiere una columna
nueva (§5.1) porque `agenda_items` no tiene dónde guardarlo.

### D4. Reagendar **deja rastro**: el original queda `RESCHEDULED` y nace uno nuevo
Mover una gestión a **otro día** cierra la original como `RESCHEDULED` (con motivo del catálogo
`RESCHEDULE_REASON`, también seedeado) y **crea un agendado nuevo** con la fecha nueva, apuntando al
anterior. El historial del caso muestra la cadena completa.

### D5. La frontera entre editar, posponer y reagendar — **la marca el día**
Tres verbos que se solapan; la regla es una sola frase: **cambiar el día deja rastro, mover la hora no.**

| Acción | Qué cambia | Rastro | Dónde vive |
|---|---|---|---|
| **Posponer** (S4, ya construido) | +15 / +30 / +1 h sobre la hora agendada | mismo ítem, audit `POSTPONE` | hoja de registrar acción |
| **Editar** (S5) | tipo, `details`, observaciones, **hora** | mismo ítem, audit `UPDATE` | `crear.tsx?id=` |
| **Reagendar** (S6) | **el día** (y su hora) | ítem nuevo + el viejo a `RESCHEDULED` | hoja en `[id].tsx` |

Por eso **`scheduledDate` es inmutable en el `PATCH`**: si se pudiera mover el día editando, D4 se
saltearía por la puerta de atrás. En modo edición el campo Fecha se pinta **deshabilitado** con el hint
"Para moverla de día, usá Reagendar" (`SelectRow` ya soporta `disabled`, `ui.tsx:545`).

### D6. En la pantalla del día, **"Completadas" pasa a ser "todo lo que ya no está pendiente"**
🔴 **Hallazgo del gate:** hoy la Agenda arma sus secciones con `pending = SCHEDULED` y
`done = EXECUTED` (`app/(tabs)/agenda.tsx:125-126`). Un ítem `CANCELLED` o `RESCHEDULED` **no cae en
ninguna de las dos y desaparece de la pantalla** — lo que volvería a "Cancelar" indistinguible de
"Eliminar" y rompería D2. El backend ya acompaña: `listByDay` no filtra por status (`agenda.service.ts:123`)
y `listOverdue` sí excluye lo no-`SCHEDULED` (`:137`), que es exactamente lo que se quiere.

Corrección: `done` pasa a ser **todo lo que no está `SCHEDULED`**. Un filtro, cero secciones nuevas, cero
divergencia con el Figma `64:4`. La tarjeta ya las distingue sola: `AGENDA_STATUS_LABEL` (`ui.tsx:372`) pinta
"Completada" / "Cancelada" / "Reagendada" y `AGENDA_TYPE_META` les da su tono.

```
Vencidas (2) | Pendientes (5) | Completadas (4)
  ✓ Llamada a Ana Quispe     Completada
  ✕ Recordatorio Pedro L.    Cancelada
  ↻ Promesa Juan Pérez       Reagendada
```

## 5. Contrato (endpoints reales, prefijo `/api`, envelope `{data,meta,error}`)

Los cuatro son `@Roles(Permission.AGENDA_WRITE)`, resuelven el ítem con `assigneeScope()` (fuera de scope
o soft-deleted → `404 AGENDA_NOT_FOUND`, ya existe) y **exigen `status: SCHEDULED`** → si no,
`AGENDA_008` "La gestión ya no está pendiente" (`agenda.errors.ts:33`, ya existe). Los cuatro devuelven
`serializeAgendaItem` — **incluido `DELETE`, que responde 200 con el ítem, no 204**: `apiMutate` del móvil
trata el 204 como error (hallazgo de cartera S4 D3) y no vale la pena tocarlo por esto.

### 5.1 Migración — 2 columnas nullable en `agenda_items`
| Columna | Tipo | Para qué |
|---|---|---|
| `reason_code` | `String?` | motivo del **desenlace no ejecutado**: el `CANCEL_REASON` si quedó `CANCELLED`, el `RESCHEDULE_REASON` si quedó `RESCHEDULED` |
| `rescheduled_from_id` | `String?` | ref suave al ítem del que nació (sólo en el nuevo, escrito una vez) |

`ponytail:` **una columna de motivo, no dos.** Ambos motivos responden la misma pregunta —por qué esta
gestión no se ejecutó— y son excluyentes: un ítem termina cancelado **o** reagendado, nunca los dos. Qué
catálogo aplica lo dice el `status`. Techo: si algún día hay que reportar cancelaciones y
reprogramaciones con esquemas distintos, se parte en dos columnas; hoy sería una columna vacía.

El puntero va **hacia atrás** (en el hijo) y no hacia adelante: se escribe una sola vez, al crear, sin un
segundo `UPDATE` sobre el padre. El móvil arma la cadena en memoria — `history` ya devuelve todos los
ítems del caso (`ver.md` §4.3), así que enlazarlos es un `find`, no una query.

Sin cambios de RLS: la tabla ya tiene su política (fundación). **Aplicar con `migrate deploy`**
(`migrate dev` rompe en este repo: su shadow-db no tiene `app_current_account()`).
`serializeAgendaItem` **EXTENDIDO** con `reasonCode` y `rescheduledFromId` (dos líneas).

### 5.2 `PATCH /api/agenda/:id` — editar (S5)
```ts
{ type?, details?, observations?, timeMode?, scheduledTime?, timeSlot? }   // todos opcionales
```
- **`scheduledDate` no está en el DTO** (D5). Tampoco `caseId`/`creditId`/`clientId` (D1).
- Si viene `type` **o** `details`, se revalida el par completo con `validateAgendaDetails(type ?? item.type, details ?? item.details)` → `AGENDA_005`. Cambiar de tipo **exige** mandar `details` nuevo: un `contactId` no sirve para una visita.
- Cruces contra DB: **reusa `assertReferences()` tal cual** (`agenda.service.ts:479`), con el `clientId` y el `credit` del propio ítem. Teléfono ajeno, monto > saldo, medio de pago inactivo o banco faltante siguen dando `AGENDA_006` — sin escribir una regla nueva.
- Si viene cualquier campo de hora, se corre `assertTimeMode()` sobre la combinación resultante → `AGENDA_004`, y se normaliza igual que `create`/`postpone` (`FIXED` limpia `timeSlot`, `LAPSE` limpia `scheduledTime`).
- `updatedBy = tenant.userId`. Audit `UPDATE` **con `before` y `after`** (es el único endpoint del módulo donde el valor viejo importa para auditar).

### 5.3 `POST /api/agenda/:id/cancel` — cancelar (S6)
```ts
{ reasonCode: string }
```
`reasonCode` debe existir y estar activo en `CANCEL_REASON` → **reusa `activeCatalogItem()`**
(`agenda.service.ts:530`); si no, `AGENDA_006`. Escribe `status: CANCELLED` + `reasonCode`. Audit `CANCEL`.

### 5.4 `POST /api/agenda/:id/reschedule` — reagendar (S6)
```ts
{ scheduledDate: 'YYYY-MM-DD', timeMode, scheduledTime?, timeSlot?, reasonCode }
```
En **una transacción**: crea el ítem nuevo (copia `type`, `details`, `observations`, `caseId`,
`creditId`, `clientId`, `assigneeId` del original, con `rescheduledFromId` = el original) y marca el
original `status: RESCHEDULED` + `reasonCode`. Devuelve **el ítem nuevo**.
- `scheduledDate >= hoy` → `agendaPastDate()` (`AGENDA_003`, ya existe), mismo `startOfTodayUTC()` que `create`.
- `assertTimeMode()` → `AGENDA_004`. `reasonCode` activo en `RESCHEDULE_REASON` → `AGENDA_006`.
- **No se revalida `details`**: no cambian, y ya se validaron al crear. Reagendar no es editar.
- `assigneeId` se **copia del original** (no se recalcula desde el caso): si un supervisor reagenda, el ítem tiene que seguir siendo del cobrador que lo va a ejecutar. Es la misma lección de S2 (`crear.md` §12).
- Audit: `RESCHEDULE` sobre el original + `CREATE` sobre el nuevo (así el ítem nuevo tiene su propia alta en la bitácora, como cualquier otro).

### 5.5 `DELETE /api/agenda/:id` — eliminar (S6)
Soft-delete: `deletedAt: new Date()`, `updatedBy`. Audit `DELETE` con `before`. Responde **200** con el
ítem serializado (§5). Un ítem `EXECUTED` **no se borra** (`AGENDA_008`): tiene un `CaseActivity` colgando
en la bitácora del caso y borrarlo dejaría la actividad huérfana.

### 5.6 Tablas
Sólo `agenda_items` (2 columnas nuevas). Lee `catalog_items` para los motivos. Nada más.

## 6. Auditoría de reuso (Paso B)

### API
| Capacidad | Decisión | Path |
|---|---|---|
| Resolver ítem propio / 404 sin filtrar existencia | **REUSAR** | `assigneeScope()` + `agendaItemNotFound()` |
| "Ya no está pendiente" | **REUSAR** | `agendaNotSchedulable()` (`agenda.errors.ts:33`) — hoy lo usan `complete` y `postpone` |
| Validar `details` por tipo | **REUSAR** | `validateAgendaDetails` de `@kobrax/shared` — **cero reglas nuevas** |
| Cruces contra DB (contacto del cliente, monto ≤ saldo, medio+banco) | **REUSAR** | `AgendaService.assertReferences()` (`:479`) |
| Motivo activo del catálogo del tenant | **REUSAR** | `AgendaService.activeCatalogItem()` (`:530`) |
| Coherencia `timeMode` ↔ hora/franja | **EXTENDER** | `assertTimeMode()` vive en `agenda.service.ts:536` (función de módulo, no un archivo aparte) y hoy está tipada `(dto: CreateAgendaItemDto)`. Se **ensancha su firma** a un tipo estructural `{ timeMode; scheduledTime?; timeSlot? }` para que la usen también `update` y `reschedule`. No se copia la regla |
| Fecha pasada | **REUSAR** | `agendaPastDate()` + `startOfTodayUTC()` |
| Nombre del deudor por ref suave | **REUSAR** | `clientNames()` |
| Transacción con tenant + RLS | **REUSAR** | `AgendaService.tx()` / `PrismaService.withTenant` |
| Audit trail | **REUSAR** | `AuditService.record({entity,entityId,action,before?,after?})` |
| Envelope | **REUSAR** | `ResponseDto.ok` |
| Payload de salida | **EXTENDER** | `serializeAgendaItem` += `reasonCode`, `rescheduledFromId` (2 líneas, un solo serializer para todo el módulo) |
| `update` · `cancel` · `reschedule` · `remove` | **NUEVO** | `agenda.service.ts` + 4 rutas en `agenda.controller.ts` (**después** de `@Get(':id')`, ver §11) |
| DTOs de los 4 | **NUEVO** | `dto/agenda.dto.ts` (archivo único del módulo, donde ya viven `CreateAgendaItemDto:41` y `PostponeAgendaItemDto:73`) |

### Móvil
| Capacidad | Decisión | Path |
|---|---|---|
| **Todo el formulario** (5 tipos, selectores, pickers, alta de teléfono/dirección) | **EXTENDER (modo `?id=`)** | `app/agenda/crear.tsx` — 803 líneas que **no se copian ni se extraen**: el modo edición es hidratar el mismo reducer y cambiar título + submit (§7.2) |
| Reducer, `canSubmit`, `money`, fechas | **REUSAR** | `src/agenda-form.ts` |
| Hidratar el reducer desde el detalle · cuerpo del `PATCH` | **NUEVO, puro** | `src/agenda-form.ts` → `hydrateForm(detail)` + `buildPatch(state)`, al lado de `buildPayload`. Testeables sin red, como el resto del archivo |
| Contactos/direcciones del cliente para repintar los selectores | **REUSAR** | `clientContext(clientId)` (S2) — el modo edición lo llama con el `clientId` del ítem, sin buscador |
| Detalle del ítem a editar | **REUSAR** | `getItem(id)` (S3) |
| Menú `…` en la cabecera | **REUSAR** | `Header` ya acepta `right?: ReactNode` (`ui.tsx:18`) — **no se toca el componente** |
| Hoja de acciones · hoja de reagendar | **REUSAR** | `BottomSheet` (`ui.tsx:489`) |
| Elegir motivo | **REUSAR** | `PickerSheet` (`ui.tsx:565`) + `listCatalog(CatalogType.CANCEL_REASON \| RESCHEDULE_REASON)` (`catalogs.service.ts`, S2) |
| Picker de fecha/hora al reagendar | **REUSAR** | `@react-native-community/datetimepicker` + los helpers `toISO`/`toHHmm` que ya viven en `crear.tsx` |
| Confirmación destructiva de "Eliminar" | **REUSAR (nativo)** | `Alert.alert` de `react-native` — **no** se agrega una hoja de confirmación propia |
| Etiquetas de estado y tipo | **REUSAR** | `AGENDA_STATUS_LABEL` (ya cubre `CANCELLED` y `RESCHEDULED`, `ui.tsx:372`) y `AGENDA_TYPE_META` |
| Tokens | **REUSAR** | `src/theme.ts` — nada hardcodeado |
| `updateItem` · `cancelItem` · `rescheduleItem` · `deleteItem` | **NUEVO** | `src/agenda.service.ts`, thin sobre `apiMutate` (4 funciones de 3 líneas) |
| Escritura HTTP con los 3 verbos | **REUSAR (verificado)** | `apiMutate(path, method, body?, headers?)` ya acepta `'POST' \| 'PATCH' \| 'DELETE'` (`api-client.ts:109`) — nada que tocar |
| Secciones de la pantalla del día (D6) | **EXTENDER → MOVER** | El reparto vive hoy inline en `app/(tabs)/agenda.tsx:125-126`. Pasa a `partitionDay(items)` en `src/agenda-form.ts` (puro, 3 líneas) — **porque el gate encontró el bug justo ahí**: un filtro suelto en una screen no tiene dónde dejar su test de no-regresión |

## 7. Tareas (orden: shared/DB → backend → tests → móvil)
1. **DB**: migración `agenda_items` += `reason_code`, `rescheduled_from_id` (nullable). `migrate deploy`.
   `serializeAgendaItem` += los 2 campos.
2. **API**: `UpdateAgendaItemDto`, `CancelAgendaItemDto`, `RescheduleAgendaItemDto`; métodos
   `update` / `cancel` / `reschedule` / `remove` en `agenda.service.ts` reusando §6; 4 rutas en el
   controller **después** de `@Get(':id')`. Audit en las 4.
3. **API tests** (node:test): §10.
4. **Móvil**: `agenda.service.ts` += las 4 funciones; `agenda-form.ts` += `hydrateForm` / `buildPatch` + tests.
5. **Móvil**: modo edición en `crear.tsx` (`?id=`) — hidratar, título "Editar gestión", tarjeta del deudor
   sin buscador, fecha deshabilitada con hint, submit → `updateItem`.
6. **Móvil**: menú `…` en `[id].tsx` con las 4 acciones (sólo si `status === SCHEDULED`); hoja de
   reagendar (fecha + hora + motivo); `PickerSheet` de motivo al cancelar; `Alert` al eliminar.
   Tras cancelar/reagendar/eliminar → `router.back()`; la Agenda refetchea al recuperar el foco.
7. **Móvil (D6)**: mover el reparto de `(tabs)/agenda.tsx:125-126` a `partitionDay(items)` en
   `agenda-form.ts`, con `done = status !== SCHEDULED` — así la cancelada y la reagendada siguen visibles
   en el día con su etiqueta. Test de no-regresión incluido.
8. **Móvil**: el historial del detalle marca la cadena — un ítem `RESCHEDULED` muestra "Reagendada ·
   <motivo>", y el que tiene `rescheduledFromId` muestra "Reagendada desde el <fecha del padre>".
9. Verificar: API `type-check` + tests · móvil `type-check` + `jest` + `expo export` · smoke real contra `:4010`.
10. `/code-review` + `/ponytail-review` sobre el diff; aplicar findings y re-verificar.
11. Al cerrar: marcar S5/S6 ✅ en el [README](./README.md) con su commit y registrar `hydrateForm`/`buildPatch`
    en el [BASE-INVENTORY](../BASE-INVENTORY.md).

## 8. Reglas de la fase
Las 3 del epic §3.3 — **sol→contraste** (las acciones destructivas en `danger`, el resto en `navy`; los
motivos y fechas del historial en `muted`), **gama baja→perf** (el modo edición **no** re-renderiza por
tecla: mismo `useReducer` que el alta; una sola pasada de hidratación al montar), **animación con
propósito** (haptic al guardar y al cancelar, el slide del `BottomSheet`, nada más).
Además: multi-tenant **por capacidad** (nunca `tenantType`) · TS estricto sin `any` · `{data,meta,error}` ·
**audit en las 4 mutaciones** · enums y reglas de `details` **sólo** en `packages/shared`.

**Offline** (cola real = P6): las 4 acciones requieren red. Sin conexión, `ErrorBanner` "Sin conexión —
reintentá" y **el formulario/menú queda intacto**; no se pierde lo tipeado ni se bloquea el resto de la app.
Es la misma deuda declarada en `crear.md` §7, no una nueva.

## 9. Artefactos nuevos y dónde viven
| Artefacto | Dónde | Por qué ahí |
|---|---|---|
| `hydrateForm(detail)` · `buildPatch(state)` · `partitionDay(items)` | `apps/mobile/src/agenda-form.ts` | lógica pura del formulario y del día, ya es el hogar de `buildPayload`; testeable sin red |
| `updateItem` · `cancelItem` · `rescheduleItem` · `deleteItem` | `apps/mobile/src/agenda.service.ts` | un service por recurso, thin sobre `apiMutate` |
| `update` · `cancel` · `reschedule` · `remove` + sus DTOs | `apps/api/src/modules/agenda/` | el módulo de dominio que ya los alberga |
| Columnas `reason_code`, `rescheduled_from_id` | `packages/database` | § 5.1 |

**Nada nuevo en `ui.tsx`**: el menú, las hojas y la confirmación salen de componentes que ya existen.

## 10. Tests
- **API** (node:test):
  - `PATCH` sobre ítem ajeno (sin `AGENDA_ASSIGN`) → 404 · sobre `EXECUTED` → `AGENDA_008`.
  - `PATCH` que cambia el tipo sin mandar `details` → `AGENDA_005`.
  - `PATCH` con `contactId` de otro cliente → `AGENDA_006` (prueba que `assertReferences` se reusa).
  - `PATCH` con `scheduledDate` en el body → el campo se **ignora** (no está en el DTO) y la fecha no cambia.
  - `PATCH` `FIXED` sin hora → `AGENDA_004`; `LAPSE` limpia `scheduledTime`.
  - `cancel` con motivo inexistente/inactivo → `AGENDA_006`; con motivo válido → `CANCELLED` + `reasonCode` + audit.
  - `reschedule`: crea el nuevo con `rescheduledFromId`, deja el viejo `RESCHEDULED` con motivo, **copia el
    `assigneeId` del original** (no el de quien reagenda), fecha pasada → `AGENDA_003`.
  - `DELETE`: responde **200** con el ítem, `deletedAt` seteado, y el ítem desaparece de `GET /agenda?date=`
    y de `history`; `EXECUTED` → `AGENDA_008`.
  - RLS entre tenants en los 4.
- **móvil** (jest): `hydrateForm` reconstruye el estado de los 5 tipos desde el detalle (incluida la promesa
  con su monto y su medio de pago) · `buildPatch` **nunca** emite `scheduledDate`, `caseId` ni `clientId` ·
  cambiar el tipo en modo edición limpia `details` y deja `canSubmit` en `false` hasta completarlo ·
  **(D6)** el reparto en secciones del día manda `CANCELLED` y `RESCHEDULED` a "Completadas" y deja
  "Pendientes" sólo con `SCHEDULED` (test sobre el filtro, no sobre la pantalla).

## 11. Riesgos / decisiones abiertas
- 🔴 **Orden de rutas** (el error clásico de este controller, `ver.md` §11): `@Patch(':id')` y
  `@Delete(':id')` no chocan con `@Get('overdue')` porque el verbo difiere, pero **`@Post(':id/cancel')` y
  `@Post(':id/reschedule')` sí conviven con `@Post()` y con `@Post(':id/complete')`**. Van declaradas
  después de las existentes y con un test que sigue pegando a `/agenda/overdue` y a `/agenda/:id/complete`
  con todo montado.
- **Colisión de `caseId`** (heredada de S2 §12): un cliente con 2 casos abiertos sobre el mismo crédito. D1
  la **cierra por diseño en la edición** — el `caseId` no se toca, así que no hay selector que resolver mal.
- **Timezone** (heredado de todo el módulo): `scheduledDate` es medianoche UTC; el "hoy" de reagendar usa
  `startOfTodayUTC()`, el mismo que `create`. El refinamiento tenant-tz sigue pendiente para el módulo entero.
- **Un ítem reagendado dos veces** encadena `rescheduledFromId` en cascada. El historial (≤20 filas) lo
  pinta como filas independientes enlazadas; no se dibuja un árbol.
- `ponytail:` **el modo edición vive en `crear.tsx`, no en una pantalla nueva.** Techo conocido: ese archivo
  ya tiene 803 líneas y suma la rama de hidratación. Si S7+ le agrega otro modo, ahí sí se extrae la vista
  a `src/agenda-form-view.tsx` (lo que hizo cartera S5) — hoy sería refactorizar 800 líneas para no repetir
  ninguna.

## 12. DoD
- Los 4 endpoints con tests verdes y audit registrado en cada uno (`UPDATE`/`CANCEL`/`RESCHEDULE`/`DELETE`).
- Con la API real, desde el teléfono: **editar** una llamada cambiándole el teléfono y ver el nuevo en el
  detalle · **reagendar** una visita al día siguiente, que aparezca mañana en "Pendientes" y que la original
  quede hoy en **"Completadas" con la etiqueta "Reagendada"** y su motivo en el historial del caso ·
  **cancelar** un recordatorio con motivo y verlo **hoy en "Completadas" como "Cancelada"** (D6) ·
  **eliminar** una promesa cargada por error y que no vuelva a aparecer en ninguna vista.
- Editar un agendado ya completado no ofrece el menú; forzar el `PATCH` responde `AGENDA_008`.
- Verde: API `type-check` + tests · móvil `type-check` + `jest` + `expo export`.
- **Validación visual de la usuaria** (menú, hojas y modo edición calcan el lenguaje de S2/S3).

## ⏸️ Pendiente de confirmar
Ninguno. Las 4 bifurcaciones se cerraron en §4 (D1–D4) y D5 se deriva de D4.
