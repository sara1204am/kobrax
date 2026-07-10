# Agenda · S3 — Ver agendado (detalle)

> **ESTADO: ✅ CONSTRUIDO (2026-07-10).** Verde: API type-check + **213 tests** (+21) · móvil type-check +
> **67 jest** (+6) + `expo export`. **Smoke real contra `:4010`**: detalle de los 5 tipos con el deudor, el
> saldo (`8900 BOB`) y el historial (16 filas); `target` = teléfono en `CALL`/`WHATSAPP`, dirección en
> `VISIT`, ausente en `REMINDER`/`PROMISE_TO_PAY`; `labels` resuelve `TRANSFER`→"Transferencia" y
> `BNB`→"Banco Nacional de Bolivia"; id inexistente → `404 AGENDA_NOT_FOUND`; `/agenda/overdue` sigue
> respondiendo (el orden de rutas aguanta); audit: **5 `agenda_item/PII_REVEAL`**, uno por detalle abierto,
> ninguno en el 404.
> **Pendiente: validación visual de la usuaria** contra `Detalle de Gestión.png`.
> Índice: [README.md](./README.md) · Modelo: [DOMAIN.md](./DOMAIN.md) · Depende de
> [00-fundacion.md](./00-fundacion.md) (tablas/enums/catálogos/seed), [main.md](./main.md) (S1, la tarjeta
> que se toca) y [crear.md](./crear.md) (S2, el `details` que este detalle lee).
> **Rama:** se continúa en `f10/agenda-fundacion` (el módulo se mergea junto).
> **Build:** 🟢 Expo Go — **sin dependencias nuevas**: `Linking` es core de React Native y `expo-haptics`
> ya está instalada (`package.json:22`).

## 1. Objetivo
El cobrador toca una tarjeta de la Agenda y ve **todo lo que necesita para ejecutar esa gestión**: qué es
y cuándo, sus observaciones, quién es el deudor y cuánto debe, y el historial de gestiones de ese caso.
Desde ahí puede **llamar** o **navegar** al domicilio con un toque, y arrancar el registro de la acción (S4).

## 2. Pantalla Figma (node-id confirmado)
Diseño "Kobrax movil" · fileKey `daLWsKQGC4Sd1NacU9fmrP` · nodo **`64:425`** ·
PNG ya exportado por la usuaria en `docs/epics/F10/figma/Detalle de Gestión.png` → **se lee desde disco,
cero pulls MCP** (el MCP de Figma está rate-limited en plan Starter).

### Anatomía (leída del PNG, no inventada)
| Bloque | Contenido |
|---|---|
| Header navy | back · "Detalle de gestión" · `…` (menú) |
| Pill de estado | `PENDIENTE DE VISITA` → `{estado} de {tipo}` en tono del tipo (rojo si vencida) |
| Tarjeta de la gestión | ícono del tipo · título (`Visita en ruta` = label del tipo) · `Hoy, 11:30 AM` · cita con las **observaciones** |
| Tarjeta del deudor | nombre · `CI: … · zona` · `DEUDA TOTAL` + monto · botones **Llamar** / **Navegar** |
| `HISTORIAL DE GESTIONES` | timeline: "Gestión Actual" (verde, arriba) + gestiones anteriores del caso (`21 Jun · Ejecutada`) |
| Footer | **`Registrar gestión ▶`** → S4 |

## 3. Alcance
**SÍ:** `GET /api/agenda/:id` (gestión + deudor + saldo + dato de contacto en claro + historial del caso),
la pantalla `app/agenda/[id].tsx`, cablear la tarjeta de S1, acciones **Llamar** (`tel:`) y **Navegar** (`geo:`/Maps).
**NO (fuera de S3):** el menú `…` (editar → S5, eliminar/cancelar/reagendar → S6) queda **oculto**, no
deshabilitado — no se pinta un affordance muerto. El botón **"Registrar gestión"** navega a un aviso "llega en S4"
(mismo patrón que el FAB en S1). Adjuntos, evidencias y plantillas siguen diferidos (README §extras).

## 4. Contrato (endpoint real, prefijo `/api`, envelope `{data,meta,error}`)

### 4.1 NUEVO — detalle
`GET /api/agenda/:id` · `@Roles(Permission.AGENDA_READ)`

Un round-trip: la pantalla no encadena llamadas. Fuera de scope (`assigneeScope`) o soft-deleted →
**`404 AGENDA_NOT_FOUND`** (ya existe en `agenda.errors.ts:3`; no filtra existencia).

```ts
{
  item: <serializeAgendaItem>,                        // el mismo payload que devuelven S1 y S2
  client: { id, displayName, nationalId, zone? },     // CI en claro; `zone` de la primera dirección (subtítulo)
  credit: { creditId, code?, outstandingBalance, currency, daysPastDue },
  target?: {                                          // el dato con el que se ejecuta la gestión, EN CLARO
    phone?: string,                                   // CALL · WHATSAPP  (details.contactId)
    address?: string, zone?, latitude?, longitude?,   // VISIT (details.locationId o details.customAddress)
  },
  labels?: Record<string, string>,                    // PROMISE_TO_PAY: code → label del catálogo (medio, banco)
  history: [{ id, type, status, scheduledDate, isOverdue }],  // otros agenda_items del caso, desc, máx 20
}
```
`client` y `target` salen **de la misma llamada** a `ClientsService.findOne(clientId, true)` — una query, un
serializer. `zone` es `locations[0].zone`, que el serializer devuelve **en claro aun sin `reveal`**
(`clients.serializer.ts:56`, no está cifrado); `nationalId` sí exige `reveal` (`clients.serializer.ts:107`).

### 4.2 PII — decisión (usuaria, 2026-07-10): **revelar siempre, auditar siempre**
El detalle llama a `ClientsService.findOne(clientId, true)` (`clients.service.ts:114`) en **los 5 tipos**, y
registra `PII_REVEAL` en los 5. Razón: quien ya puede abrir el detalle de un deudor propio no gana superficie
viendo su CI, y un solo camino de código evita que la misma pantalla pinte el CI distinto según el tipo.

- **No se escribe descifrado nuevo**: `findOne(_, true)` ya descifra y ya audita `client/PII_REVEAL`
  (`clients.service.ts:125`). Reuso idéntico al de `clientContext` de S2. No se toca `CryptoService`.
- **`target` sí es de mínima superficie**: de los contactos y direcciones que vuelven, se emite **sólo la fila
  referenciada por `details`** (`contactId` / `locationId`); el resto se descarta en el servicio, no viaja al
  móvil. Un "llamar a otro número" implicaría emitirlos todos → no entra en S3.
- **`VISIT` con `customAddress`**: la dirección la tipeó el cobrador, ya está en claro dentro de `details` →
  `target` se arma desde ahí, sin buscar en `client_locations`.
- **`REMINDER` / `PROMISE_TO_PAY`**: no tienen contacto ni dirección → `target` **ausente** (pero `client` sí
  trae el CI revelado).
- **Audit propio del módulo**, además del de `clients`:
  `audit.record({ entity: 'agenda_item', entityId: id, action: 'PII_REVEAL' })` — mismo criterio que
  `agenda_client_context` en S2 (poder distinguir esta puerta en una auditoría).
- Se lee con `AGENDA_READ` (no `AGENDA_WRITE` como el `clientContext` de S2): acá la superficie es **un** deudor
  que ya es del cobrador y **un** teléfono, no un listado.

### 4.3 Historial — decisión: **otros `agenda_items` del mismo caso**
`history` = `agenda_items` con el mismo `caseId`, `deletedAt: null`, `id != :id`, `orderBy scheduledDate desc`,
`take 20`. **No** `case_activities`: es append-only y hoy sólo tiene la fila `ASSIGNMENT` del seed, así que el
timeline se vería vacío hasta que S4 empiece a escribir actividades. El seed ya trae ~10 agendados repartidos.
Cuando S4 escriba `case_activities`, el ítem ejecutado ya se ve acá con `status: EXECUTED`.
> `history` **no** pasa por `assigneeScope`: son gestiones del mismo caso, y el caso ya se validó como propio
> al resolver el ítem. Un supervisor y el cobrador ven el mismo historial.

### 4.4 `labels` — códigos de catálogo del `PROMISE_TO_PAY`
`details.paymentMethodCode` y `details.bankCode` son `code`s de `catalog_items`. Sin resolver, la pantalla
mostraría `BANK_TRANSFER` en vez de "Transferencia bancaria". Una sola query
(`catalogItem.findMany({ where: { code: { in: [...] }, isActive: true } })`) → `{ code: label }`.
Para los otros 4 tipos, `labels` no se emite.

### 4.5 Tablas
Ninguna nueva. Lee `agenda_items`, `collection_cases`, `credits`, `clients`, `client_contacts`,
`client_locations`, `catalog_items`. **Sin migración.**

## 5. Auditoría de reuso (Paso B)
| Capacidad | Decisión | Path |
|---|---|---|
| Serializer del agendado | **REUSAR** | `agenda.serializer.ts` (`serializeAgendaItem`) — sin tocar |
| 404 fuera de scope | **REUSAR** | `agendaItemNotFound()` (`agenda.errors.ts:3`, hoy sin usar) |
| Scope por capacidad | REUSAR | `AgendaService.assigneeScope()` |
| Nombre del deudor por ref suave | REUSAR | `AgendaService.clientNames()` |
| PII en claro + audit | **REUSAR** | `ClientsService.findOne(id, true)` — no se toca `CryptoService` |
| Audit trail | REUSAR | `AuditService.record({entity,entityId,action})` |
| Tenant + RLS | REUSAR | `PrismaService.withTenant` |
| Guards Jwt+Tenant+Roles | REUSAR | `apps/api/src/modules/auth/guards` |
| Envelope | REUSAR | `ResponseDto.ok` de `@kobrax/shared` |
| Enums de dominio | REUSAR | `@kobrax/shared` `AgendaItemType/Status`, `CatalogType` |
| Ícono/label/tono por tipo · label de estado | **REUSAR** | `AGENDA_TYPE_META`, `AGENDA_STATUS_LABEL` (`ui.tsx:234`) |
| Pill de estado | REUSAR | `StatusBadge` (`ui.tsx:53`) |
| `Header` / `EmptyState` / `SectionLabel` | REUSAR | `src/ui.tsx` |
| `Button` / `Card` / `ErrorBanner` | REUSAR | `src/components.tsx` |
| Tokens de color/tipografía | REUSAR | `src/theme.ts` (nada hardcodeado) |
| Fetch + envelope | REUSAR | `apiQuery` (`src/api-client.ts`) |
| Moneda | **EXTENDER** | `money()` vive hoy **dentro** de `app/agenda/crear.tsx:77`; S3 es su 2º consumidor → **se mueve a `src/agenda-form.ts`** (con test). No se reimplementa `formatCurrency`: `money()` es su wrapper con fallback para monedas fuera de las 6 soportadas |
| Formato de fecha/mes | REUSAR | `MONTHS` (`src/agenda-form.ts`) |
| Llamar / abrir mapa | **REUSAR (nativo)** | `Linking.openURL` de `react-native` — **no** se agrega `expo-linking` ni `react-native-maps` |
| `GET /agenda/:id` | **NUEVO** | `agenda.controller.ts` / `AgendaService.findOne()` |
| `getItem(id)` | **NUEVO** | se agrega a `src/agenda.service.ts` |
| Pantalla de detalle + timeline | **NUEVO, local a la screen** | `app/agenda/[id].tsx` — el timeline sube a `ui.tsx` si S4 lo pide |

## 6. Tareas (orden: backend → tests → UI)
1. API: `AgendaService.findOne(id)` — resuelve ítem (scope) → caso+crédito → `client`+`target` vía
   `ClientsService.findOne(clientId, true)` → `labels` → `history`. Ruta `@Get(':id')` en
   `agenda.controller.ts` **después** de `overdue` y `clients/...` (si no, `ParseUUIDPipe` de `:id` se come
   `/agenda/overdue`). Audit `agenda_item/PII_REVEAL` en los 5 tipos.
2. API tests (node:test): scope, `target` por tipo, CI revelado + audit, historial, `labels`, RLS.
3. Móvil: **mover `money()`** de `app/agenda/crear.tsx:77` a `src/agenda-form.ts` (+ test); `getItem(id)` y
   tipos en `src/agenda.service.ts`; helper puro `actionLinks(target)` → `{tel?, geo?}`.
4. Móvil: `app/agenda/[id].tsx` — header, pill, tarjeta de gestión, tarjeta del deudor con Llamar/Navegar,
   timeline, footer. Cablear `Row.onPress` de `(tabs)/agenda.tsx` → `router.push('/agenda/' + item.id)`.
5. Verificar: API `type-check` + tests · móvil `type-check` + `jest` + `expo export` · smoke real contra `:4010`.
6. `/code-review` + `/ponytail-review` sobre el diff.

## 7. Reglas de la fase
Las 3 del epic §3.3 — **sol→contraste** (monto de la deuda, nombre y hora en `navy`/`text`; labels de sección
y fechas del historial en `muted`), **gama baja→perf** (pantalla estática, un solo fetch, sin listas virtualizadas:
el historial son ≤20 filas), **animación con propósito** (haptic al tocar Llamar/Navegar, nada más).
Además: multi-tenant **por capacidad** (nunca `tenantType`) · TS estricto sin `any` · `{data,meta,error}` ·
audit en la revelación de PII · enums **solo** en `packages/shared`.

**Offline**: es una pantalla de lectura. Sin conexión → `EmptyState` "Sin conexión" con reintento; el botón
Llamar **no** depende de la red una vez cargada la pantalla (el `tel:` ya está en memoria).

## 8. Decisiones (cerradas con la usuaria, 2026-07-10)
1. **Historial = otros `agenda_items` del caso** (no `case_activities`, no la fusión de ambos). Ver §4.3.
2. **PII: se revela y se audita en los 5 tipos** (el CI del deudor está en el Figma y un recordatorio no lo
   hace menos suyo). El `target`, en cambio, emite **sólo** el contacto/dirección elegido al crear el
   agendado, no la agenda completa del deudor. Ver §4.2.
3. El menú `…` se **oculta** hasta S5/S6; "Registrar gestión" avisa que llega en S4.

## 9. Tests
- **API** (node:test):
  - detalle de un agendado ajeno (sin `AGENDA_ASSIGN`) → `404 AGENDA_NOT_FOUND`; con `AGENDA_ASSIGN` → 200.
  - soft-deleted → 404.
  - `CALL`: `target.phone` en claro, y **sólo** ese teléfono aunque el cliente tenga varios cargados.
  - `VISIT` con `customAddress`: `target.address` sale de `details`, no de `client_locations`.
  - `REMINDER`: `target` ausente, pero `client.nationalId` viene **en claro** (decisión §8.2).
  - Los 5 tipos registran audit `agenda_item/PII_REVEAL`.
  - `PROMISE_TO_PAY`: `labels` trae medio de pago y banco; sin `bankCode` → sólo el medio.
  - `history` excluye el ítem actual y los soft-deleted, ordena desc, corta en 20.
  - RLS entre tenants.
- **móvil** (jest): `actionLinks()` arma `tel:` sólo con teléfono y `geo:` sólo con coordenadas
  (dirección sin lat/lng → sin botón Navegar).

## 10. DoD
- `GET /api/agenda/:id` con tests verdes; audit `agenda_item/PII_REVEAL` registrado en los 5 tipos.
- Con la API real: tocar una tarjeta de cada uno de los 5 tipos abre el detalle correcto; **Llamar** abre el
  marcador con el número del deudor; **Navegar** abre el mapa en la dirección de la visita.
- Un caso con varias gestiones muestra el historial; el agendado abierto aparece como "Gestión Actual".
- Un agendado vencido pinta la pill en rojo.
- Verde: API `type-check` + tests · móvil `type-check` + `jest` + `expo export`.
- **Validación visual de la usuaria** contra `Detalle de Gestión.png`.

## 11. Riesgos / decisiones abiertas
- **Orden de rutas**: `@Get(':id')` debe declararse **después** de `@Get('overdue')` y `@Get('clients/...')`.
  Es el error clásico de este endpoint; cubierto por un test que pega a `/agenda/overdue` con el detalle ya montado.
- **Timezone** (heredado de S1/S2): `scheduledDate` es medianoche UTC; "Hoy, 11:30 AM" se arma con las
  mismas helpers UTC de S1. Refinamiento tenant-tz sigue pendiente para todo el módulo.
- **`Navegar` sin coordenadas**: una dirección cargada sin lat/lng (S2 las hace opcionales) no puede abrir
  el mapa por punto. Se abre por **texto de la dirección** (`geo:0,0?q=<address>`), que es lo que hace Maps.
- **Colisión de `caseId`** (heredada de S2): un cliente con 2 casos abiertos sobre el mismo crédito. El detalle
  keyea por `caseId` del ítem, así que **no** le afecta; el que hay que cerrar es el selector de S2/S5.
