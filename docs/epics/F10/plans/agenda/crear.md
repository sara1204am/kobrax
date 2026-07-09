# Agenda · S2 — Crear agendado (5 tipos)

> **ESTADO: ✅ CONSTRUIDO (2026-07-08).** Verde: shared 7 tests · API type-check + 192 tests · móvil
> type-check + 61 jest + `expo export` · **smoke real contra `:4010`**: los 5 tipos creados y visibles en
> el día, las 7 validaciones rechazando con su código, audit `CREATE` + `PII_REVEAL` registrados.
> **Pendiente: validación visual de la usuaria** contra los 5 PNGs.
> Fix de seed: el 2º crédito de Juan (`CRD-DEMO-2`) no tenía caso → el selector de crédito nunca
> aparecía; ahora se le siembra un caso abierto (`seed.ts`).
> Índice: [README.md](./README.md) · Modelo: [DOMAIN.md](./DOMAIN.md) · Depende de
> [00-fundacion.md](./00-fundacion.md) (tablas/enums/catálogos/seed) y [main.md](./main.md) (S1, el FAB).
> **Rama:** se continúa en `f10/agenda-fundacion` (00 y S1 aún no mergeados; el módulo se mergea junto).
> **Build:** 🟢 Expo Go — sin dependencias nuevas (`@react-native-community/datetimepicker` ya entró en S1).

## 1. Objetivo
Desde el FAB de la Agenda, el cobrador crea una gestión agendada de cualquiera de los **5 tipos**
(Llamada · Visita · WhatsApp · Recordar · Promesa de pago): elige el tipo, busca el cliente, completa
los campos propios del tipo, programa fecha + hora, y guarda. Al volver, el agendado aparece en la
sección "Pendientes" del día programado.

## 2. Pantallas Figma (node-ids confirmados)
Diseño "Kobrax movil" · fileKey `daLWsKQGC4Sd1NacU9fmrP`. **PNGs ya exportados** por la usuaria en
`docs/epics/F10/figma/` → se leen desde disco, **cero pulls MCP** durante la construcción.

| Tipo | node-id | PNG |
|---|---|---|
| Llamada | `65:724` | `crear-llamada.png` |
| Visita | `65:828` | `crear-visita.png` |
| WhatsApp | `65:938` | `crear_whatsapp.png` |
| Recordar | `65:1047` | `crear_ recordatorio.png` |
| Promesa de pago | `65:1150` | `crear_promes.png` |

### Shell común (idéntico en las 5)
Header navy (back · "Nueva gestión" · `…`) → **TIPO DE GESTIÓN** (grid 3+2 de chips ícono+label,
seleccionado en `purple`) → **CLIENTE** (buscador "Buscar por nombre o CI…" + tarjeta del elegido:
nombre, CI, ✕) → *bloque del tipo* → **NOTAS (OPCIONAL)** (multilínea) → **PROGRAMACIÓN** (fecha con
ícono calendario + toggle `Hora fija | Lapso (AM/PM)` + hora con ícono reloj) → footer **"Guardar gestión"**.

### Bloque por tipo (leído del Figma, no inventado)
| Tipo | Campos |
|---|---|
| Llamada | `TELÉFONO` (selector de los del cliente) |
| Visita | `DIRECCIÓN` (selector) + switch **"Usar otra dirección"** → dirección libre (+ zona, referencia) |
| WhatsApp | `TELÉFONO` (selector) + `MENSAJE INICIAL` (multilínea) |
| Recordar | `DESCRIPCIÓN (REQUERIDO)` (una línea) — **sin** título/prioridad/categoría |
| Promesa | `MONTO PROMETIDO *` · `EL CLIENTE PAGARÁ EL *` (fecha) · `MEDIO DE PAGO` (chips del catálogo) · `BANCO *` (selector, **solo si** `metadata.requiresBank`) · y su `PROGRAMACIÓN RECORDATORIO` = la programación común |

> El Figma pinta **Medio de pago** como 2 chips (Depósito/Transferencia); el catálogo `PAYMENT_METHOD`
> trae 8 → se usan **chips en wrap** con los items activos del tenant (mismo look, escala).

## 3. Alcance
**SÍ:** `POST /api/agenda`, endpoint de contexto del cliente, buscador de cliente, los 5 formularios,
validación de `details` por tipo (shared + server), selectores de teléfono/dirección/medio/banco/crédito.
**NO (diferido, ver README §extras):** plantillas WhatsApp y variables `{{cliente}}`, evidencias de visita
(GPS/foto/firma → P8), modo `RANGE` de hora, campañas, canal, adjuntos, prioridad y resultado esperado
(las columnas quedan nullables), responsable ≠ cobrador actual, ABM visual de catálogos, "otro teléfono".

## 4. Contrato (endpoints reales, prefijo `/api`, envelope `{data,meta,error}`)

### 4.1 REUSAR — buscar cliente
`GET /api/clients?q=<texto>&status=ACTIVE&limit=20` (ya existe: `clients.controller.ts:45`, permiso
`CLIENT_READ`, `q` busca por nombre ILIKE o documento exacto vía blind index). La PII vuelve enmascarada
— alcanza para la tarjeta (nombre + CI enmascarado).

### 4.2 NUEVO — contexto del cliente para agendar
`GET /api/agenda/clients/:clientId/context` · `@Roles(Permission.AGENDA_WRITE)`

Un único round-trip que resuelve lo que el formulario necesita y **revela la PII con auditoría**
(decisión §8.2 — el cobrador no tiene `client:pii:read` y necesita el teléfono/dirección reales).

**No se escribe descifrado nuevo.** El endpoint llama a **`ClientsService.findOne(clientId, true)`**
(`clients.service.ts:114`), que ya devuelve `contacts`/`locations` en claro y ya registra
`audit.record({ entity: 'client', entityId, action: 'PII_REVEAL' })` (línea 125). Sólo agrega la query de
créditos+casos y recorta el payload. Requiere `exports: [ClientsService]` en `clients.module.ts` e importar
`ClientsModule` en `agenda.module.ts`.

```ts
{
  client: { id, displayName, nationalId },             // de serializeClient(reveal:true)
  credits: [{ creditId, caseId, code, outstandingBalance, currency, daysPastDue }],
  contacts: [{ id, contactType, value, isPrimary }],   // value en claro
  locations: [{ id, locationType, address, zone, latitude, longitude }] // address en claro
}
```
- `credits` = **solo créditos con un caso no-terminal y dentro del scope**: sin `AGENDA_ASSIGN` →
  `case.assigneeId = yo`. Si queda vacío → `404 AGENDA_002 "El cliente no tiene casos asignados a vos"`.
- `code` es `credits.code` (`String?`, `schema.prisma:596`) — no existe `credits.reference`.

### 4.3 NUEVO — crear
`POST /api/agenda` · `@Roles(Permission.AGENDA_WRITE)` → `201` con el mismo payload que
`serializeAgendaItem` (así el móvil puede insertar sin refetch).

```ts
{
  caseId: uuid, creditId: uuid,
  type: AgendaItemType,
  scheduledDate: 'YYYY-MM-DD',
  timeMode: 'FIXED' | 'LAPSE',
  scheduledTime?: 'HH:mm',                     // requerido si FIXED
  timeSlot?: 'MORNING'|'AFTERNOON'|'NIGHT',    // requerido si LAPSE
  observations?: string,
  details: <por tipo, ver 4.4>
}
```
El server **deriva** `clientId` del caso y `assigneeId = tenant.userId` (nunca del body).

**Validaciones del server** (`agenda.errors.ts`, códigos nuevos):
1. Caso existe, `deletedAt: null`, estado no terminal, en scope; `creditId === case.creditId`. → `404`.
2. `scheduledDate >= hoy` (medianoche UTC, igual que `listOverdue`). → `AGENDA_003`.
3. `timeMode` coherente con `scheduledTime`/`timeSlot`. → `AGENDA_004`.
4. `details` válido para el tipo (validador puro de shared, §4.4). → `AGENDA_005` con `details.errors`.
5. Cruces contra DB (no van en shared): `contactId`/`locationId` pertenecen al cliente del caso ·
   `amount <= credit.outstandingBalance` · `paymentMethodCode` existe y está activo en el catálogo ·
   `bankCode` presente sii `metadata.requiresBank` · `promiseDate >= hoy`. → `AGENDA_006`.
6. `audit.record({ entity: 'agenda_item', entityId, action: 'CREATE', after })` — misma firma que
   `routes.service.ts:46`.

### 4.4 NUEVO — validador de `details` en `packages/shared`
`src/validation/agenda-details.ts` — **función pura, cero deps** (regla del package):
`validateAgendaDetails(type, details): { ok: true; value: AgendaDetails } | { ok: false; errors: string[] }`
Lo consume la API **y** el móvil (mismo mensaje de error, sin duplicar reglas).

| Tipo | `details` |
|---|---|
| `CALL` | `{ contactId: uuid }` |
| `WHATSAPP` | `{ contactId: uuid, message: string (1..1000) }` |
| `VISIT` | `{ locationId: uuid }` **o** `{ customAddress: { address: string(1..200), zone?, reference? } }` |
| `REMINDER` | `{ description: string (1..500) }` |
| `PROMISE_TO_PAY` | `{ amount: number > 0, 2 decimales, promiseDate: 'YYYY-MM-DD', paymentMethodCode: string, bankCode?: string }` |

### 4.4-bis NUEVO — cargar un teléfono desde el formulario (agregado 2026-07-08, pedido de la usuaria)
`POST /api/agenda/clients/:clientId/contacts` · `@Roles(Permission.AGENDA_WRITE)`

Si el cliente no tiene cargado el número al que hay que llamar/escribir, se agrega **sin salir del
formulario**; al guardar queda **seleccionado** automáticamente.

```ts
{ contactType: 'PHONE' | 'WHATSAPP', value: string(1..30), notes?: string }  // → { id, contactType, value, isPrimary }
```
- **Por qué no `POST /clients/:id/contacts`** (que ya existe): exige `CLIENT_WRITE`, que el COLLECTOR
  no tiene. Un tenant chico puede otorgárselo, uno grande nunca → la pantalla andaría según el tenant.
  Cargar el teléfono del deudor propio **al agendarle una llamada** es parte de agendar, no ABM de clientes.
- **Reusa `ClientsService.addContact`**: cifrado en reposo + audit `client_contact/CREATE`. No se escribe cripto.
- **Mismo scope que el contexto** (`agendableCases`): cliente sin caso propio → `AGENDA_002`, sin escribir nada.
- `EMAIL` se rechaza (400): no sirve para llamar ni para WhatsApp.
- La respuesta devuelve el `value` **que mandó el cliente**, nunca el ciphertext de la fila.

### 4.4-ter NUEVO — cargar una dirección desde el formulario (agregado 2026-07-08)
`POST /api/agenda/clients/:clientId/locations` · `@Roles(Permission.AGENDA_WRITE)`

```ts
{ locationType: LocationType, address: string(1..200), zone?, referenceNotes?, latitude?, longitude? }
```
- Mismas razones, mismo scope y mismo reuso que el alta de teléfono (`ClientsService.addLocation`
  cifra `address` y audita `client_location/CREATE`). Devuelve el `address` en claro, nunca el ciphertext.
- **Coordenadas opcionales**: se puede cargar la dirección sin marcar el punto. `@IsLatitude`/`@IsLongitude`
  rechazan basura (400).
- **Mapa** (`react-native-maps`, dep nueva): tocar el mapa o arrastrar el pin fija el punto; el botón
  **"Usar mi ubicación actual"** (`expo-location`, dep nueva) lo pone donde está parado el cobrador —
  más exacto que arrastrar a ojo, que es el caso real (está en la puerta del deudor). Negar el permiso
  no bloquea: la dirección se guarda igual, sin coordenadas.
- ⚠️ **Dev build**: en Expo Go el mapa usa la API key de Expo. Para un build propio de Android hay que
  cargar `android.config.googleMapsApiKey` en `app.json`. Anotado, no bloquea S2.

### 4.5 Tablas
Ninguna nueva. Escribe `agenda_items`; lee `collection_cases`, `credits`, `clients`,
`client_contacts`, `client_locations`, `catalog_items`. **Sin migración.**

## 5. Auditoría de reuso (Paso B)
| Capacidad | Decisión | Path |
|---|---|---|
| Buscar cliente por nombre/CI | **REUSAR** | `GET /api/clients?q=` (`clients.service.ts`) |
| Tenant + RLS + scope por capacidad | REUSAR | `PrismaService.withTenant`, `TenantContextService.can()` |
| Envelope + errores | REUSAR | `ResponseDto` de `@kobrax/shared`, patrón `agenda.errors.ts` |
| Audit trail | REUSAR | `AuditService.record({entity,entityId,action,after?})` |
| Guards Jwt+Tenant+Roles | REUSAR | `apps/api/src/modules/auth/guards` |
| **Cliente con PII en claro + audit `PII_REVEAL`** | **REUSAR** | `ClientsService.findOne(id, true)` (`clients.service.ts:114`) — no se toca `CryptoService` |
| Exponer `ClientsService` al módulo agenda | **EXTENDER** | `clients.module.ts` (`exports`) + `agenda.module.ts` (`imports`) |
| Serializer del agendado | REUSAR | `agenda.serializer.ts` (`serializeAgendaItem`) |
| Enums de dominio | REUSAR | `@kobrax/shared` `AgendaItemType/Status`, `ScheduleTimeMode`, `CatalogType` |
| Tokens de color/tipografía | REUSAR | `src/theme.ts` (nada hardcodeado) |
| `Button` / `Field` / `Card` / `ErrorBanner` | REUSAR | `src/components.tsx` |
| `Header` / `SegmentTabs` / `BottomSheet` / `EmptyState` / `SectionLabel` | REUSAR | `src/ui.tsx` |
| Picker de fecha y hora | REUSAR | `@react-native-community/datetimepicker` (instalada en S1) |
| Fetch + query-string | REUSAR | `src/api-client.ts` (`apiQuery`, `toQuery`) |
| Moneda | REUSAR | `formatCurrency` de `@kobrax/shared` |
| `POST /agenda` + contexto del cliente | **NUEVO** | `agenda.controller.ts` / `agenda.service.ts` |
| Validador de `details` | **NUEVO** | `packages/shared/src/validation/agenda-details.ts` (lo usan API y móvil) |
| POST autenticado + refresh | REUSAR | `authedFetch(path, {method, body})` (`api-client.ts:53`) |
| Mapeo de resultado de mutación (`apiMutate`) | **NUEVO** | `src/api-client.ts`, junto a `apiQuery` — no en la screen |
| `catalogs.service.ts`, `clients.service.ts` (móvil) | **NUEVO** | `src/` — thin sobre `apiQuery`, los reusan S3–S6 |
| `createItem`, `clientContext` | **NUEVO** | se agregan a `src/agenda.service.ts` |
| Chips de tipo, `PickerSheet` (cliente/tel/dirección/medio/banco/crédito) | **NUEVO, local a la screen** | `app/agenda/crear.tsx` — se usan solo acá; suben a `ui.tsx` cuando S3/S4 los pidan |

## 6. Tareas (orden: shared → backend → datos → UI)
1. `packages/shared`: `validation/agenda-details.ts` + tipos `AgendaDetails*` + export en `index.ts`. Tests.
2. API: exportar `ClientsService` (`clients.module.ts`) e importar `ClientsModule` en `agenda.module.ts`;
   `agenda.errors.ts` (`AGENDA_002..006`); DTO `CreateAgendaItemDto`; `AgendaService.clientContext()` (sobre
   `ClientsService.findOne(id,true)`) y `.create()`; rutas en `agenda.controller.ts`. Audit de la creación.
3. API tests (node:test): scope, PII+audit, las 6 validaciones, `details` por tipo.
4. Móvil: `apiMutate` en `api-client.ts`; `clients.service.ts`; `catalogs.service.ts`;
   `agenda.service.ts` += `clientContext` / `createItem`.
5. Móvil: `app/agenda/crear.tsx` — shell + chips de tipo + buscador/tarjeta de cliente + bloque por tipo
   + programación + guardar. Cablear el FAB de `(tabs)/agenda.tsx` (hoy muestra el aviso "S2").
6. Verificar: API `type-check` + tests · móvil `type-check` + `jest` + `expo export` · smoke real contra `:4010`.
7. `/code-review` + `/ponytail-review` sobre el diff.

## 7. Reglas de la fase
Las 3 del epic §3.3 — **sol→contraste** (monto, nombre y hora en `navy`/`text`; labels de sección en
`muted`), **gama baja→perf** (nada de re-render por tecla: el form es un `useReducer` local; el buscador
va con debounce 300 ms), **animación con propósito** (haptic al guardar, transición del BottomSheet, nada más).
Además: multi-tenant **por capacidad** (nunca `tenantType`) · TS estricto sin `any` · `{data,meta,error}` ·
audit en la creación y en la revelación de PII · enums y reglas de `details` **solo** en `packages/shared`.

**Offline** (cola real de escritura = P6): al perder conexión el botón "Guardar gestión" muestra
`ErrorBanner` "Sin conexión — reintentá" y **conserva el formulario intacto** para reintentar. No se
bloquea ninguna otra acción de la app ni se pierde lo tipeado.

## 8. Decisiones (cerradas con la usuaria, 2026-07-08)
1. **Cliente = buscador sobre todos los clientes del tenant** (`GET /clients?q=`), no la lista de casos.
   Tras elegirlo, `…/context` trae sus créditos agendables. **Selector de CRÉDITO** solo se muestra si el
   cliente tiene ≥ 2 (con 1, se elige solo). Si tiene 0 → mensaje "sin casos asignados a vos" y no se guarda
   (decisión cerrada: **un agendado siempre está atado a un caso** → `caseId` es NOT NULL).
2. **PII: endpoint dedicado** `GET /agenda/clients/:id/context` que revela teléfonos y direcciones **solo**
   en el contexto de agendar, con `AGENDA_WRITE` + audit. No se le da `client:pii:read` al COLLECTOR ni se
   afloja la máscara del resto de la app.
3. **Campos = exactamente los del Figma.** Sin prioridad, resultado esperado, campaña, canal, adjuntos ni
   responsable; `priorityCode`/`expectedResultCode` quedan `null`. `timeMode` soporta `FIXED` y `LAPSE`
   (los dos del toggle); `RANGE` queda para los extras.
4. `POST /api/agenda` devuelve el ítem serializado completo → el móvil hace insert optimista sin refetch.

## 9. Tests
- **shared** (node:test): `validateAgendaDetails` acepta/rechaza los 5 tipos (falta `contactId`, mensaje
  vacío, `amount <= 0`, 3 decimales, `VISIT` sin `locationId` ni `customAddress`).
- **API** (node:test): crear sobre caso ajeno → 404 · caso terminal → 404 · `creditId` que no es del caso →
  404 · fecha pasada → `AGENDA_003` · `FIXED` sin hora → `AGENDA_004` · `contactId` de otro cliente →
  `AGENDA_006` · `amount > outstandingBalance` → `AGENDA_006` · medio `requiresBank` sin banco →
  `AGENDA_006` · `context` excluye créditos sin caso abierto y registra audit · RLS entre tenants.
- **móvil** (jest): el reducer del form habilita "Guardar" sólo con el mínimo por tipo; cambiar de tipo
  limpia `details` pero conserva cliente/fecha/hora.

## 10. DoD
- `POST /api/agenda` y `GET /agenda/clients/:id/context` con tests verdes; audit registrado en ambos.
- Con la API real: crear un agendado de **cada uno de los 5 tipos** desde el teléfono y verlo aparecer en
  la sección "Pendientes" del día elegido. Elegir una fecha pasada se rechaza con mensaje claro.
- Cliente con 2 créditos muestra el selector de crédito; cliente sin caso propio muestra el aviso.
- Verde: API `type-check` + tests · móvil `type-check` + `jest` + `expo export`.
- **Validación visual de la usuaria** contra los 5 PNGs.

## 11. Riesgos / decisiones abiertas
- **Timezone** (heredado de S1): `scheduledDate` se ancla a medianoche **UTC**. El "hoy" del formulario se
  arma con las mismas helpers de fecha que S1 para que "no programar en el pasado" no rechace el día actual
  del cobrador. Refinamiento tenant-tz sigue pendiente para todo el módulo.
- **Escritura HTTP**: `authedFetch(path, { method, body })` **ya soporta POST** (`api-client.ts:53`, con
  refresh de token y retry). Falta sólo el mapeo de resultado análogo a `apiQuery` (201 + `AGENDA_00x` →
  mensaje de error) → `apiMutate` son ~10 líneas sobre `authedFetch`, no un cliente nuevo.
- **`clientContext` revela PII**: si más adelante se audita el módulo, este endpoint es el punto a mirar.
  Mitigado con permiso + audit; no expone listados, sólo el cliente que el cobrador ya eligió.

## 12. Hallazgos de `/code-review` (2026-07-08) — qué se arregló y qué quedó
**Arreglados en el mismo commit:**
- **Monto sin centavos** (crítico): el input re-stringificaba el número en cada tecla → `150.50` se
  volvía `15050`. Ahora el texto tipeado es la fuente de verdad; `details.amount` es el número derivado.
- **`canSubmit` habilitaba sin banco** cuando el medio de pago tiene `requiresBank` → fallaba recién
  contra el server (AGENDA_006). Ahora `canSubmit(state, requiresBank)`.
- **`formatCurrency` crasheaba** con una moneda fuera de las 6 soportadas → helper `money()` con fallback.
- **`unauthenticated` mudo** al elegir cliente → ahora avisa "Tu sesión venció".
- **Supervisor se autoasignaba**: `assigneeId` se tomaba del token; con `AGENDA_ASSIGN` se puede agendar
  sobre casos ajenos, y `assigneeScope` ocultaba el ítem al cobrador que debía ejecutarlo. Ahora
  `assigneeId = case.assigneeId ?? quien agenda`.
- **Franjas horarias duplicadas** en 3 archivos → `AgendaTimeSlot` en `packages/shared`.
- **PII**: decidido dejar el gate `AGENDA_WRITE` (es *más* restrictivo que dar `client:pii:read` al
  COLLECTOR, que le abriría `GET /clients/:id?reveal=true` sobre todo el tenant) + **audit propio**
  `agenda_client_context/PII_REVEAL` para poder distinguir esta puerta en una auditoría.

**Descartado:** `@ApiProperty` en el DTO — ningún DTO del repo los usa (0/20) y `@nestjs/swagger` no
está instalado; cumplir el `CLAUDE.md` acá implicaría una dep nueva y 20 archivos, sin consumidor.

**Deuda aceptada (no se arregla en S2):**
- **Offline**: "Guardar" no encola; sin señal se pierde lo tipeado al salir de la pantalla. La cola real
  de escritura es **P6** (decisión del plan, §7). Choca con el "offline-first" del CLAUDE.md → cerrarlo en P6.
- **Colisión de `caseId`**: si un cliente tuviera 2 casos abiertos **sobre el mismo crédito**, el selector
  keyea por `creditId` y resolvería el primero. No ocurre con los datos actuales; se cierra keyeando por
  `caseId` cuando S3/S5 toquen el selector.
