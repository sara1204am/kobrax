# F10 · Rutas · S4 — Mapa activo y detalle de parada (RT-4 · RT-5)

> **ESTADO: BORRADOR ronda 1 (2026-08-04). NO construir hasta PASS de `/f10-validar-plan`.**

## 1. Objetivo
La jornada ya arrancó (S3 dejó la ruta en `IN_PROGRESS`). S4 es **la pantalla donde el cobrador
trabaja**: el mapa de su ruta activa, toca el pin de la parada a la que llegó, ve a quién tiene
enfrente y cuánto debe, y de ahí dispara la acción (llamar, WhatsApp, navegar, registrar resultado).

**Lo que S4 NO hace:** registrar el resultado. Eso es el sheet de **S5** (RT-6). Acá el botón
"Registrar resultado" queda cableado a un aviso, igual que hizo S1 con el FAB hasta que llegó S2.

## 2. Rama
`f10/rutas-s4-mapa-activo`, desde `main` (`cf97fc1`, con S3 ya mergeado).

## 3. Build
Dev build por cable (`expo run:android`) — MapLibre no corre en Expo Go (D-BUILD del README).
Verificación: `type-check` + `jest` + `expo export` + smoke real contra `:4010` + validación visual.

## 4. Pantallas Figma
Sección `81:4` del file `daLWsKQGC4Sd1NacU9fmrP`. **PNGs en `docs/epics/F10/figma/rutas/`** — se leen
del disco con Read, no se pullea el MCP (rate-limit del plan Starter).

| Mockup | node-id | PNG | Qué aporta |
|---|---|---|---|
| RT-4 Mapa activo (pin seleccionado) | `51:541` | `RT-4 Mapa activo (pin seleccionado).png` | mapa full + pin resaltado + tarjeta inferior + banner zigzag |
| RT-5 Detalle de parada | `51:915` | `RT-5 Detalle de parada.png` | ficha del deudor + hora recomendada + mini-mapa de garantes + últimas gestiones + barra de acciones |

**Economía Figma:** los dos node-ids ya están confirmados en el README del módulo (§Pantallas → slices)
y sus PNGs están exportados. **Cero llamadas al MCP en este slice.**

## 5. Contrato (verificado contra el código, 2026-08-04)

### 5.0 Lo que YA está y no se toca
- `GET /api/routes/:id` → ruta + `stops[]`, y desde S1/S3 cada parada trae `clientName`, `address`,
  **`latitude`/`longitude`** (`serializeStop`, ubicación primaria = primera `HOME`, si no la primera),
  descifrada y con `route/PII_REVEAL` auditado.
- `PATCH /api/routes/:id/stops/:sid {status?, sequenceOrder?}` → mover la parada a `IN_ROUTE`.
- `GET /api/agenda/clients/:clientId/context` → contactos **y `locations[]` con `locationType` +
  `latitude`/`longitude`**, ya descifrados y auditados.
- `actionLinks(target, platform)` en `agenda.service.ts` → `tel:` y `geo:`/`maps:` según sistema.

### 5.1 Delta A — la parada necesita la mora (RT-4, bloqueante)
La tarjeta inferior de RT-4 muestra **MONTO EN MORA** y **DÍAS DE MORA**; hoy `serializeStop` no
devuelve ninguno de los dos, así que la tarjeta no se puede pintar con datos reales.

**Cómo se resuelve:** por el camino que ya abrieron S1 y S3 — ensanchar el `include` del `findOne` de
rutas y agregar los campos al serializer. **No** con un `GET /credits` desde el móvil (obligaría a una
llamada por parada). El caso ya está en la parada (`caseId`); de su `credit` salen
`outstandingBalance`, `currency` y `daysPastDue`, exactamente como los expone `clientContext`.

```
serializeStop += {
  overdueAmount?: number   // credit.outstandingBalance
  currency?: string        // credit.currency
  daysPastDue?: number     // credit.daysPastDue
}
```
Una parada sin caso o sin crédito los devuelve `undefined` y la tarjeta oculta los dos recuadros —
mismo criterio que `address`/`latitude`: la parada existe igual.

### 5.2 Delta B — «Garante cercano» (RT-5): **sin backend nuevo**
Hallazgo de la auditoría: **`GUARANTOR` es un valor de `LocationType`**, no una entidad aparte. Los
garantes ya viven en `client_locations` con su `latitude`/`longitude`, y `clientContext` **ya los
devuelve**. El mini-mapa de RT-5 se arma filtrando `locations` por `locationType === 'GUARANTOR'`.
**Cero endpoints nuevos, cero migración.**

### 5.3 Delta C — «Hora recomendada» (RT-5): regla nueva, dato existente
El mockup muestra `10:30 AM - 12:00 PM`. **No existe el dato ni la regla** — se define acá.

**Regla (decidida, ver §11-D3):** la franja en la que a ese deudor **se le contactó efectivamente**
antes. Se leen los `agenda_items` `EXECUTED` del cliente que tienen `resultActivityId` (es decir, los
que produjeron una gestión real), se agrupan por `timeSlot` — y si la gestión fue de hora fija, por la
franja en que cae su `scheduledTime` — y gana la franja con más contactos efectivos.

- **Sin historial suficiente (< 2 contactos efectivos) NO se muestra el chip.** Una recomendación
  sacada de un solo dato es una corazonada disfrazada de estadística, y entrena a ignorarlas.
- Se reusa **`AgendaTimeSlot`** (`MORNING`/`AFTERNOON`/`NIGHT`) — no se inventa un enum de franjas.

**Sin endpoint nuevo.** El dato depende sólo del `clientId`, y `GET /api/agenda/clients/:clientId/context`
ya devuelve todo lo del cliente — **y la ficha de RT-5 ya lo llama** (`app/cliente/[id].tsx`). Se le
suma un campo:

```
clientContext(...)  +=  contactHint?: { timeSlot: AgendaTimeSlot, basedOn: number }
```
`basedOn` = cuántos contactos efectivos respaldan la franja (para el texto "según 4 contactos
previos"). **Ausente** cuando no llega al mínimo — así el móvil no decide la regla, sólo pinta.

> **Cálculo puro y testeable:** la agrupación vive en `recommendedSlot()`, una función pura del
> **módulo de agenda de la API** (su único consumidor), con su spec. No va a `shared`: el móvil no
> calcula nada, muestra lo que la API resolvió.

## 6. Auditoría de reuso (Paso B — obligatoria antes de crear nada)

| Necesito | ¿Existe? | Qué uso |
|---|---|---|
| Mapa con pines + polilínea | ✅ | `MapCanvas` (`src/maps/MapCanvas.tsx`), ya con `markers`/`routeLine`/`controls` |
| Mini-mapa estático (RT-5) | ✅ | `MiniMapCard` (`src/maps/`) |
| Recuadros MONTO/DÍAS | ✅ | `StatTile` (`ui.tsx`) — S3 ya lo usa en el preview |
| Filas de "últimas gestiones" | ✅ | `ListRow` + `AGENDA_TYPE_META` (ícono/tono por tipo) de `ui.tsx` |
| Historial del deudor | ✅ | `buildTimeline` (`src/ficha.ts`) — **la ficha de cartera ya lo pinta** |
| Ficha del deudor completa (RT-5) | ✅ | **`app/cliente/[id].tsx`** — préstamos, contactos, ubicación, historial, gestión/pago/promesa |
| `tel:` / `wa.me` / `geo:` | ✅ | `actionLinks` (`agenda.service.ts`) — **no escribir un segundo** |
| Contactos y ubicaciones del cliente | ✅ | `clientContext` (`agenda.service.ts`) |
| Estado de ruta/parada → etiqueta | ✅ | `ROUTE_STATUS_LABEL` / `STOP_STATUS_META` (`ui.tsx`, de Rutas S1) |
| Distancia/duración legibles | ✅ | `humanDistance` / `humanDuration` (`src/route-eta.ts`, de S3) |
| Moneda | ✅ | `money` (`agenda-form.ts`) / utils de `shared` |
| Mora por parada | ❌ | **Delta A** (§5.1) |
| Franja recomendada | ❌ | **Delta C** (§5.3) — se suma a `clientContext`, **sin endpoint nuevo** |
| Franja → etiqueta legible | ✅ | **`TIME_SLOT_LABEL`** (`agenda-form.ts:62`, Mañana/Tarde/Noche) — el rango horario se agrega **ahí**, no en un mapa paralelo |
| Pines de garantes | ✅ | ya vienen en `clientContext.locations` (**Delta B**, §5.2) |

**Regla de oro:** nada de esta tabla se re-implementa. Si algo no encaja, se ensancha el que existe.

## 7. Artefactos nuevos (los mínimos)

| Artefacto | Path | Por qué no alcanza lo que hay |
|---|---|---|
| `app/rutas/mapa.tsx` | móvil | RT-4 no existe: es el mapa de la ruta **en ejecución** con selección de pin |
| `StopCard` | `src/ui.tsx` | la tarjeta inferior de RT-4; **va a `ui.tsx` porque S5 la reusa** bajo el sheet |
| `recommendedSlot()` | `apps/api/.../agenda/` | la regla de §5.3, pura y testeada. **Un solo consumidor (la API)** → no va a `shared` |
| `TIME_SLOT_RANGE` | `src/agenda-form.ts` | el rango legible de cada franja, **pegado a `TIME_SLOT_LABEL` que ya vive ahí** — no un segundo mapa en otro paquete |
| barra de acciones de RT-5 | `app/cliente/[id].tsx` | **se agrega a la ficha existente**, no es pantalla nueva (D1) |

**Nada más.** No hay endpoint nuevo (§5.3) ni `stopHint()` en el servicio del móvil: la ficha ya
llama a `clientContext`, que es donde viaja el dato.

## 8. Tareas
1. **Backend Delta A** — `include` del crédito en `findOne` de rutas + 3 campos en `serializeStop` + test.
2. **Backend Delta C (regla)** — `recommendedSlot()` puro en el módulo de agenda + spec (franja
   ganadora, empate, hora fija → franja, `< 2` → sin franja).
3. **Backend Delta C (cable)** — `contactHint` en la respuesta de `clientContext` + test. Sin endpoint nuevo.
4. **Móvil RT-4** — `app/rutas/mapa.tsx`: `MapCanvas` con los pines numerados, pin seleccionado
   resaltado, banner de zigzag si el preview trae `suggestion`, `StopCard` abajo, "Ver detalle" →
   `/cliente/[id]`, "Registrar resultado" → aviso "S5".
5. **Móvil RT-5** — en `app/cliente/[id].tsx`: barra inferior (📞 · 💬 · 📍 Navegar · Resultado),
   chip de hora recomendada y mini-mapa con los garantes. **Todo condicionado a llegar desde una ruta**
   (`?routeId=&stopId=`): la ficha abierta desde cartera no cambia.
6. **Cable** — la ruta activa de `(tabs)/rutas.tsx` abre `/rutas/mapa`; S3 `confirmar.tsx` también.
7. **Verificación** — type-check + jest + `expo export` + **smoke real** + validación visual por cable.

## 9. Reglas de la fase
- CTA morado del Figma → **navy** (design-system §2); el morado queda para el pin seleccionado y acentos.
- Tokens de `src/theme.ts`. **Cero colores hardcodeados** (no-negociable del gate).
- Enums SIEMPRE de `shared` — `AgendaTimeSlot` se reusa, no se duplica.
- Offline-first: sin red el mapa usa el pack offline y la tarjeta pinta lo último cargado; **ninguna
  acción del cobrador se bloquea** esperando a la red.
- Multi-tenant por `accountId` + scope por capacidad; nada de ramificar por `tenantType`.
- Mapa en gama baja: limitar pines renderizados, sin re-render por frame.

## 10. DoD
- [ ] La parada trae mora y días, y la tarjeta los pinta (o los oculta si no hay crédito).
- [ ] Tocar un pin selecciona la parada y abre su tarjeta; "Ver detalle" abre la ficha real.
- [ ] La franja recomendada aparece **sólo** con ≥ 2 contactos efectivos, y dice en qué se basa.
- [ ] Los garantes con ubicación se ven en el mini-mapa, diferenciados del deudor.
- [ ] Sin red: el mapa y la tarjeta siguen usables; nada bloquea.
- [ ] type-check + jest + `expo export` verdes · smoke real contra `:4010` · validación visual.
- [ ] `/code-review` + `/ponytail-review` corridos y sus hallazgos cerrados.
- [ ] BASE-INVENTORY actualizado (`StopCard`, `recommendedSlot`, `TIME_SLOT_RANGE`, `contactHint`).

## 11. Decisiones cerradas (con la usuaria, 2026-08-04)
| # | Decisión | Implicancia |
|---|---|---|
| **D1** | **RT-5 reusa la ficha de cartera**, no es pantalla nueva. | El pin abre `app/cliente/[id].tsx`; S4 sólo le suma la barra de acciones y los dos extras, condicionados a venir de una ruta. Una sola ficha que mantener. |
| **D2** | **«Garante cercano» ENTRA.** | Sale gratis: `GUARANTOR` ya es un `LocationType` con lat/lng y `clientContext` ya lo devuelve (§5.2). |
| **D3** | **«Hora recomendada» ENTRA**, derivada de datos reales. | Regla de §5.3 sobre `agenda_items` ejecutados. Con menos de 2 contactos efectivos no se muestra: se prefiere el silencio a una recomendación inventada. |
| **D4** | El banner **«Ruta con ZIGZAG ACTIVA»** se muestra cuando el preview vigente **todavía trae `suggestion`**. | Sin estado nuevo. La alternativa ("mostrarlo sólo si ignoró la sugerencia en S3") exigiría persistir ese "ignorar", que hoy es estado local de `preview.tsx`. Si el recorrido sigue dando vueltas, el aviso sigue siendo cierto — lo haya ignorado o no. **Asunción a validar en la revisión visual.** |

## 12. Riesgos
- **La regla de la franja se apoya en historial que en dev casi no existe.** El seed tiene pocos
  `agenda_items` ejecutados por cliente → el chip casi nunca va a aparecer al validar visualmente.
  **Mitigación:** sembrar 3–4 gestiones ejecutadas en distintas franjas para un deudor de la ruta demo.
- **La mora de la parada sale del crédito del caso**, y un cliente puede tener más de un crédito
  (cartera D1). La parada apunta a **un** caso, así que muestra la mora **de ese** crédito, no la
  suma del deudor. Hay que decir eso en la etiqueta para no mentir.
- **Deuda de proceso:** **S3 se construyó sin plan escrito** (nunca existió `S3-*.md`), contra la
  regla del README del módulo. No bloquea S4, pero S3 quedó sin DoD ni gate registrados.

## ⏸️ Pendiente de confirmar
Ninguno. El único punto abierto de la ronda 1 se cerró en **D4**.
