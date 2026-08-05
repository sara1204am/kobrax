# F10 · Rutas · S5 — Registrar el resultado de la parada (RT-6)

> **ESTADO: BORRADOR ronda 1 (2026-08-05). NO construir hasta PASS de `/f10-validar-plan`.**

## 1. Objetivo
Cerrar la parada. S4 dejó al cobrador parado frente al deudor con un botón que avisa "llega en S5";
S5 es ese botón: **el sheet de resultado con sus 6 variantes**, que registra la visita, marca la
parada como visitada y —según el caso— cobra, promete o reporta.

Es el slice que convierte la ruta en trabajo registrado: sin él, la jornada se recorre pero no queda
nada escrito.

## 2. Rama
`f10/rutas-s5-resultado`, desde `main` **con S4 ya mergeado**.

## 3. Build
Dev build por cable (MapLibre + cámara + GPS no corren en Expo Go).
Verificación: `type-check` + `jest` + `expo export` + smoke real + validación visual.

## 4. Pantallas Figma
| Mockup | node-id | PNG |
|---|---|---|
| RT-6 Bottom sheet Registrar resultado (6 variantes) | `51:676` | `RT-6 Bottom sheet Registrar resultado (Variantes).png` |

Node-id del README del módulo, PNG ya exportado. **Cero llamadas al MCP.**

## 5. Contrato (verificado contra el código, 2026-08-05)

### 5.0 Lo que YA está (y es casi todo)
`POST /api/visits` (módulo **`field-ops`**, no `visits/`) ya hace, en una transacción:
crea el `FieldVisit` **append-only** con GPS obligatorio · **marca la parada `VISITED` + `visitedAt`** ·
crea un `CaseActivity` tipo `VISIT` con `result = outcome` · actualiza la última ubicación conocida del
cobrador · emite `collector.location`.

> ⚠ **El DTO usa `lat`/`lng`, no `latitude`/`longitude`** — el README del módulo dice lo segundo y está
> mal. `routeStopId` y `caseId` son ambos opcionales pero **al menos uno es obligatorio**.

También existen: `POST /api/visits/:id/evidence` (sella la foto con SHA-256), `POST /api/payments`
(+ `Idempotency-Key`), `POST /api/agenda` (la promesa vive acá, patrón cartera/agenda), `uploadImage`
y `choosePhoto` en el móvil.

### 5.1 Mapeo de las 6 variantes
| Variante | `VisitOutcome` | Qué escribe además |
|---|---|---|
| Cobrado | `PAID` / `PARTIAL_PAYMENT` (según cubra el saldo) | `POST /payments` |
| Promesa de pago | `PROMISE_TO_PAY` | 2 `agenda_items`: la promesa **y su recordatorio** (§5.3) |
| No contesta | `NO_CONTACT` | `details.channel` = `CALL` \| `DOOR` |
| Visita sin contacto | `NO_CONTACT` | `details.noticeLeft` = true + evidencia foto |
| Dirección incorrecta | **`WRONG_ADDRESS`** (nuevo) | GPS del momento (§5.4) |
| Gestión especial | **`SPECIAL`** (nuevo) | `details.categoryCode` del catálogo nuevo |

### 5.2 Delta A — dos migraciones (el orden importa)
`ALTER TYPE ... ADD VALUE` **no puede usarse en la misma transacción que lo agrega**, y Prisma corre
cada migración en una. Por eso van **separadas**, como ya hizo agenda con `WHATSAPP_TEMPLATE`
(`20260711000000`, migración sola con su `ALTER TYPE`):

1. **Sólo enums:** `VisitOutcome += WRONG_ADDRESS, SPECIAL` · `CatalogType += SPECIAL_CATEGORY`.
2. **Columna:** `field_visits += details jsonb NULL`.

> `field_visits` es **inmutable por diseño** (sin `updated_at` ni `deleted_at`): la columna nueva es
> nullable y **sólo se escribe en el INSERT**. No se toca esa propiedad.
>
> **`details` es el mismo patrón que `agenda_items.details`** (decisión 2 del módulo agenda): campos
> propios de cada variante en JSONB, validados por una función pura de `shared`, no una columna por
> qualifier ni una tabla por variante.

Aplicar con **`migrate deploy`** (la shadow DB falla por `app_current_account()`, ver memoria del módulo).

### 5.3 Delta B — la promesa crea su recordatorio (decisión D2)
El mockup promete *"se generará un recordatorio automático 24h antes de la fecha"*. Hoy eso no existe.
**Se cumple con la agenda que ya tenemos**, no con infra nueva: al registrar la promesa se crean
**dos** `agenda_items` — el `PROMISE_TO_PAY` en la fecha de compromiso y un `REMINDER` el día anterior.

- Si la promesa es **para mañana o antes**, el recordatorio caería hoy o en el pasado → **no se crea**.
  Un recordatorio en el pasado no le recuerda nada a nadie.
- Los dos quedan asignados al mismo cobrador, como el reagendado de agenda S6.

### 5.4 Delta C — GPS: **consolidar dos copias**, no escribir una tercera
`POST /visits` exige GPS válido (`isValidGps`). La capacidad **ya existe en el móvil, duplicada**:

| Copia | Path | Qué hace |
|---|---|---|
| 1 | `app/agenda/crear.tsx:260` (`useMyLocation`) | permiso + `getCurrentPositionAsync({accuracy: Balanced})` |
| 2 | `src/cliente-form-view.tsx:145` (`captureGps`) | **lo mismo, línea por línea** |

Ninguna de las dos devuelve `accuracy` (que `POST /visits` sí acepta) ni distingue *sin permiso* de
*sin señal* — con lo cual hoy un GPS que tarda se ve igual que uno denegado.

**`src/location.ts` es la consolidación** (el `location.service` que `apps/mobile/CLAUDE.md` ya
preveía): pide permiso, devuelve `{latitude, longitude, accuracy}` o un motivo (`denied` | `unavailable`).
**Los dos llamadores de arriba se migran en este slice** — si quedan, S5 deja tres copias.

- **Sin permiso o sin señal NO se bloquea el registro**: se usa la ubicación de la parada como
  respaldo y se marca `details.gpsFallback = true`. Un cobrador en un sótano tiene que poder cerrar
  su visita — es el no-negociable de offline-first. Que el dato quede marcado como estimado es
  justamente lo que evita que una auditoría lo lea como GPS real.
- Si no hay ni permiso ni coordenada de la parada, ahí sí se avisa y no se registra: `POST /visits`
  lo rechazaría igual.

### 5.5 Delta D — catálogo de gestión especial
`CatalogType.SPECIAL_CATEGORY` + seed con las categorías del mockup y sus vecinas obvias
(fallecimiento, enfermedad grave, viaje prolongado, conflicto legal, otro). ABM por el endpoint de
catálogos que ya existe; ABM visual sigue diferido.

## 6. Auditoría de reuso (Paso B)

| Necesito | ¿Existe? | Qué uso |
|---|---|---|
| Hoja inferior | ✅ | `BottomSheet` (`ui.tsx`) |
| Monto | ✅ | `AmountInput` (`ui.tsx`) |
| Selector de opciones en fila | ✅ | `Chips` (`ui.tsx`) |
| Fecha de compromiso | ✅ | `@react-native-community/datetimepicker` (ya es dep) |
| Foto + subida sellada | ✅ | `choosePhoto` (`@/photo`) + `uploadImage` (`uploads.service`) |
| Registrar pago | ✅ | `createPayment` (`payments.service`) con `Idempotency-Key` |
| Registrar la promesa | ✅ | `createAgendaItem` (`agenda.service`) |
| Validar la promesa | ✅ | `promiseReady` (`src/ficha.ts`) |
| Catálogos del tenant | ✅ | el servicio de catálogos del móvil (agenda S2) |
| Tarjeta de la parada | ✅ | **`StopCard`** (`ui.tsx`, S4 la dejó ahí para esto) |
| Estado de parada → etiqueta | ✅ | `STOP_STATUS_META` (`ui.tsx`) |
| **Hoja de cobro** | ⚠️ | **`PaySheet` vive dentro de `app/cliente/[id].tsx`** — ver §7 |
| Registrar la visita | ❌ | `createVisit`/`addEvidence` en un `field.service.ts` del móvil (**nuevo**) |
| Ubicación actual | ⚠️ **duplicada** | Existe inline **dos veces** (`agenda/crear.tsx:260`, `cliente-form-view.tsx:145`) → **consolidar** en `src/location.ts` y migrar ambas (§5.4) |
| Validar `details` por variante | ❌ | `validateVisitDetails` en `shared` (**nuevo**, espejo de `validateAgendaDetails`) |

### El near-duplicado que hay que consolidar, no copiar
La variante **Cobrado** es, campo por campo, el `PaySheet` que ya existe dentro de
`app/cliente/[id].tsx` (monto + método + comprobante + idempotencia). **Se promueve a `ui.tsx`** con un
campo opcional de número de recibo, y lo usan **la ficha y RT-6**. Copiarlo sería el segundo lugar
donde arreglar el mismo bug de centavos que ya se arregló una vez.

## 7. Artefactos nuevos

| Artefacto | Path | Por qué |
|---|---|---|
| `app/rutas/resultado.tsx` | móvil | el sheet de las 6 variantes (RT-6) |
| `PaySheet` **movido** | `src/ui.tsx` | consolidación, no artefacto nuevo (§6) |
| `src/field.service.ts` | móvil | `createVisit` + `addEvidence` — no hay servicio de visitas |
| `src/location.ts` | móvil | **consolidación**, no artefacto nuevo: unifica las 2 copias inline y suma `accuracy` + el motivo del fallo (§5.4) |
| `validateVisitDetails` | `packages/shared` | las reglas de `details` por variante, **puras y compartidas** API↔móvil (dos consumidores reales, como `validateAgendaDetails`) |
| 2 migraciones + seed | `packages/database` | §5.2 y §5.5 |

## 8. Tareas
1. **DB** — migración de enums (sola) + migración de `details` + seed del catálogo nuevo.
2. **Shared** — `validateVisitDetails` + spec (una variante por caso, campos de más se descartan).
3. **API** — `CreateVisitDto` acepta `details` validado; `field.service` lo persiste. Test.
4. **API** — la promesa crea su recordatorio (§5.3) + test del borde "promesa para mañana".
5. **Móvil** — `src/location.ts` (+ test del respaldo) y **migrar sus dos llamadores actuales**
   (`agenda/crear.tsx`, `cliente-form-view.tsx`) para no dejar tres copias; y `src/field.service.ts`.
6. **Móvil** — promover `PaySheet` a `ui.tsx` y que la ficha lo siga usando (sin cambio visible).
7. **Móvil** — `app/rutas/resultado.tsx` con las 6 variantes; el botón de S4 lo abre.
8. **Verificación** — type-check + jest + `expo export` + **smoke real de las 6** + visual.

## 9. Reglas de la fase
- **Offline-first, acá más que nunca:** el cobrador registra en la puerta, con señal mala. Ninguna
  variante bloquea por red; el GPS degrada (§5.4). *(La cola de reintento real sigue siendo P6.)*
- **Evidencia inmutable:** SHA-256 sobre el **buffer original**, antes de comprimir (CLAUDE.md raíz).
- CTA por variante con el color del mockup, **desde tokens** — nada hardcodeado.
- Enums de dominio SIEMPRE en `shared`/Prisma; `details` validado en `shared`, nunca sólo en la UI.
- Multi-tenant por capacidad (`ROUTE_EXECUTE`), no por `tenantType`. TS estricto, sin `any`.

## 10. DoD
- [ ] Las 6 variantes registran su visita y la parada queda `VISITED`.
- [ ] Cobrado crea el pago; Promesa crea promesa **y** recordatorio (salvo el borde de §5.3).
- [ ] La foto queda sellada con el hash del original.
- [ ] Sin permiso de GPS el registro **igual se completa**, marcado como estimado.
- [ ] `details` inválido lo rechaza el server, no sólo la pantalla.
- [ ] type-check + jest + `expo export` · smoke real de las 6 · validación visual.
- [ ] `/code-review` + `/ponytail-review` cerrados · BASE-INVENTORY actualizado.

## 11. Decisiones cerradas (con la usuaria, 2026-08-05)
| # | Decisión | Implicancia |
|---|---|---|
| **D1** | **Entran las 6 variantes**, no un núcleo reducido. | Se aceptan las dos migraciones (enums + `details`) y estrenar `expo-location`. |
| **D2** | **El recordatorio de la promesa se crea de verdad.** | Un `agenda_item` REMINDER el día anterior (§5.3). El cartel del mockup deja de ser una promesa vacía. |
| **D3** | *(heredada de S4)* «Registrar resultado» de RT-4 abre este sheet. | S5 sólo cambia el `onPrimary` del `StopCard`. |

## 12. Riesgos
- **`ALTER TYPE` + transacción de Prisma** es el error clásico de este repo (agenda ya lo sufrió):
  si los dos enums y la columna van juntos, la migración falla. **Van separadas** (§5.2).
- **GPS en dev build por cable**: el emulador da coordenadas falsas o nulas. La validación visual del
  respaldo hay que hacerla **con el teléfono real y el permiso denegado a propósito**.
- **`PaySheet` se mueve de archivo**: toca una pantalla ya validada (la ficha). El movimiento tiene
  que ser sin cambio visible; si aparece uno, es un bug del slice, no una mejora.
- **Migrar los dos llamadores de GPS toca agenda y cartera**, dos módulos ya mergeados. El helper
  tiene que conservar el mensaje que cada uno muestra hoy ("podés marcar el punto tocando el mapa" /
  "podés cargar lat/long a mano"): son textos distintos porque el respaldo de cada pantalla es
  distinto. El helper devuelve el **motivo**; el copy se queda en la pantalla.
- **`PARTIAL_PAYMENT` vs `PAID`** lo decide el monto contra el saldo. Con varios créditos por deudor
  el saldo es el **del crédito de la parada** (misma regla que la mora de S4), no el total.

## ⏸️ Pendiente de confirmar
Ninguno.
