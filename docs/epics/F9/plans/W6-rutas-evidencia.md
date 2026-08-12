> **ESTADO: ✅ COMPLETA Y MERGEADA a `main` (12/08).** T0–T6, con code-review, ponytail-review y
> validación visual hechos. El gate del plan (§6-bis) evitó que se reescribieran dos componentes
> que W5 acababa de dejar.
>
> Verde al mergear: shared build + 46 · móvil type-check + **310 sin tocar un test** · API
> type-check + **563** · web type-check + **180** + build.
>
> Las tres decisiones de la dueña (§5, 12/08): **se le agregó el GET a la API** · **mapa de verdad
> con `maplibre-gl`** · **W6 antes que W7**. La primera nació del hallazgo que cambió la etapa
> entera: la evidencia no se podía leer desde ningún lado (§4.3).

# W6 — Rutas y evidencia

## 1. Objetivo

Que la supervisora vea **el día en la calle**: qué ruta tenía cada cobrador, en qué orden, hasta
dónde llegó, y —lo que hasta ahora sólo existía en el teléfono— **la prueba de que estuvo ahí**:
la foto, el punto GPS y el hash que la sella.

W5 mostró el trabajo asignado; W6 muestra el trabajo **ejecutado**. Es la etapa que cierra el
lazo: sin ella, el panel sabe qué se mandó a hacer y no qué se hizo.

## 2. Rama

`web/W6-rutas-evidencia`, **sale de `main` con W5 adentro** (`0efb73d`, ya en `origin/main`).

De W5 se hereda de verdad: `proxyMutation` y su archivo de handlers finos, `Fact`/`Card`/`Hint` en
`panel-ui`, `Column.defaultDir` del `DataTable`, `errorText` en `lib/api-error`, y el patrón de
`page.tsx` que lee `searchParams` y deja el orden en la URL.

## 3. Pantallas

| Ruta | Permiso | Qué hace |
|---|---|---|
| `/rutas` | `route:read` | Las rutas del día: cobrador, estado, avance y lo recaudado |
| `/rutas/[id]` | `route:read` | El recorrido en el mapa, las paradas en orden y la cuenta de la jornada |
| `/rutas/[id]/parada/[sid]` | `route:read` | La parada: cómo terminó, la evidencia y dónde se registró |

🔴 `/rutas/:path*` al matcher de `middleware.ts`, y `/api/routes/:path*` y `/api/visits/:path*`
para los handlers. En `lib/nav.ts` se le da vuelta el `built: false` a `routes`.

## 4. Contrato (verificado contra los controllers y los services)

### 4.1 Rutas — 10 endpoints, de los que el panel lee 4

| Endpoint | Permiso declarado | Notas |
|---|---|---|
| `GET /routes` | `route:read` | Filtros: `collectorId`, `date`, `status` + paginación |
| `GET /routes/:id` | `route:read` | Trae las paradas **con cliente, caso y `lastOutcome`**, ordenadas |
| `GET /routes/:id/preview` | `route:read` | La polilínea por calles, distancia, duración y el orden sugerido |
| `PATCH /routes/:id` | `route:read` (👇) | Cambiar el estado de la ruta |

Los otros 6 (`create`, `generate`, `optimize`, alta/baja/edición de paradas) son de armado y
quedan fuera: **el panel supervisa, no arma la ruta del cobrador** (§12).

### 4.2 🔴 La puerta de los endpoints de rutas es MÍNIMA a propósito

Todos declaran `@Roles(ROUTE_READ)`, incluidos los que escriben. **Quién puede hacer qué lo decide
el service por capacidad** (`ROUTE_ASSIGN` = sobre cualquiera; `ROUTE_EXECUTE` = sólo la propia;
ninguna = 403). Está así porque el cobrador arma su ruta desde el mapa y no tiene `ROUTE_WRITE` —
con la puerta estricta el flujo entero moría en 403.

Consecuencia para el panel: **`@Roles` no dice quién puede**. Para decidir qué botones dibujar hay
que mirar `ROUTE_ASSIGN`, igual que W5 miró `CASE_ASSIGN`. Y como en W5, el listado y el detalle
**se acotan solos**: un cobrador ve sólo sus rutas y nada en la respuesta lo dice (§4.6).

### 4.3 🔴 EL HALLAZGO: la evidencia no se puede leer

`/visits` tiene **exactamente dos endpoints y los dos escriben**:

```
POST /visits              @Roles(ROUTE_EXECUTE)
POST /visits/:id/evidence @Roles(ROUTE_EXECUTE)
```

**Cero endpoints de lectura.** Lo único que el panel alcanza hoy de una visita es `lastOutcome`,
que `serializeStop` saca de `visits[0].outcome` con `take: 1`. La foto, el punto GPS, la precisión,
la nota, los `details` de la variante y **el hash SHA-256 que prueba que el archivo no cambió** no
son alcanzables desde ninguna llamada.

O sea: la mitad «evidencia» del título de esta etapa **no existe del lado del servidor**. Es el
mismo tipo de hallazgo que el `POST /clients/imports` que no servía en W4, y hay que decidirlo
antes de escribir una línea de pantalla — por eso es la decisión D1.

Los datos sí están: `field_visits` (lat, lng, accuracy, outcome, notes, details, capturedAt) y
`field_evidences` (type, fileUrl, fileHash, lat, lng, capturedAt). **Las dos tablas son inmutables
por diseño** — sin `updated_at` ni `deleted_at` — que es justo lo que hace que sirvan como prueba.

### 4.4 Lo que W6 le agrega a la API (D1 · T0)

| Endpoint | Permiso | Qué devuelve |
|---|---|---|
| `GET /visits` | `ROUTE_READ` | Filtros `routeId`, `caseId`, `collectorId`, `date` + paginación. Sin evidencias: es un listado |
| `GET /visits/:id` | `ROUTE_READ` | La visita con **sus evidencias** (tipo, url, hash, punto, cuándo) |

Cuatro cosas que el diseño tiene que respetar, y que salen del resto del código:

1. **Scope por capacidad, no por rol** (§4.2): con `ROUTE_ASSIGN` se ven las visitas de todo el
   tenant; sin ella, sólo las propias. Mismo `scopedToOwn*` que rutas y casos.
2. **La dirección y el punto son PII y se auditan al revelarlos**, igual que en `routes.findOne` y
   en el detalle de agenda: **un registro de auditoría por consulta**, no uno por fila.
3. **El orden termina en `id`** — la lección de W3 y W5, ya van dos.
4. **La foto se sirve por `GET /uploads/:name`**, que ya existe y ya está arreglado (W2: el
   interceptor envolvía el `StreamableFile` en JSON y ninguna imagen se veía nunca). `fileUrl`
   guarda el nombre; el panel no inventa otra ruta.

### 4.5 El mapa (D2)

`maplibre-gl` — la dep que el inventario dejó elegida para la web, misma familia que el móvil y
los mismos tiles. **Es la primera dep nueva del panel desde W0**, así que se anota en
`apps/web/CLAUDE.md`, que lleva la lista de lo que hay de verdad.

Se dibuja: las paradas numeradas en su orden, la polilínea de `GET /routes/:id/preview`, y **el
punto donde se registró cada visita** — que es lo que deja ver si el cobrador estuvo donde dijo.

⚠️ El mapa va en un componente cliente y **sólo en el detalle**: cargar 200 kB de librería en el
listado, que no dibuja ningún mapa, es pagar el peso donde no se usa.

### 4.6 Lo que W5 ya enseñó y acá se hereda

- **El scope es invisible en la respuesta.** La pantalla pone el cartel de «estás viendo lo tuyo».
- **`GET /users` da 403 sin `user:read`**, que es el caso de SUPERVISOR: sin nombre **no** es sin
  cobrador. Las rutas tienen `collectorId` en la cara, así que esto pega igual acá.
- Los `POST` de estos controllers **responden 201**, no 200 (`proxyMutation` ya lo sabe).
- `DELETE /routes/:id/stops/:sid` responde **204**: sin cuerpo. Sólo importa si algún día el panel
  arma rutas (§12).

## 5. Las tres decisiones de la dueña (12/08) — cerradas

| # | Decisión | Qué implica |
|---|---|---|
| D1 | **Se le agrega el GET a la API** | Sin eso, «evidencia» sale del título de la etapa. Es T0, con su spec, y la segunda vez que el panel toca la API |
| D2 | **Mapa de verdad, con `maplibre-gl`** | Primera dep nueva del panel desde W0. Sólo en el detalle |
| D3 | **W6 antes que W7** | El orden del plan. Pagos queda desbloqueada y espera |

## 6. Lo que se promueve a `shared`

| Qué | Por qué |
|---|---|
| 🔴 **`summarizeDay`** (`route-summary.ts`) | La cuenta de la jornada: recaudado, progreso y categorías. **Es la ÚNICA cuenta**, y existe porque dos pantallas del mismo día decían cosas distintas. Reimplementarla en la web repite exactamente ese bug |
| `categoryOf` + `ResultCategory` | La regla que agrupa `NOT_FOUND` y `WRONG_ADDRESS` en «inubicables». **El código, no el rótulo** |
| `routeProgress`, `resolveStopCoords` | Cuánto se avanzó y de dónde salen las coordenadas de una parada |
| Tipos del contrato: `RouteItem`, `RouteStopItem`, `VisitItem`, `EvidenceItem` | Mismo criterio que agenda y casos en W5 |

**No van**: `CATEGORY_LABEL` ni `CATEGORY_TONE` (texto y color en un idioma), ni nada de
`visit-result.ts` que sea del registro en campo — el panel **lee** resultados, no los escribe.

## 6-bis. Auditoría de reuso

Cada capacidad de las tres pantallas contra lo que ya existe. **Sin esta tabla, W6 reescribía dos
cosas que W5 acababa de dejar hechas** (lo encontró el gate del plan).

| Capacidad | Qué hacer | Dónde está |
|---|---|---|
| **Filtros del listado** (cobrador · fecha · estado, escritos a la URL) | 🔵 **EXTENDER** | `app/(panel)/casos/case-filters.tsx` — mismos `<select>`, mismo `set()` a los searchParams, misma vuelta a la página 1. Se sube a `components/url-filters.tsx` y lo usan casos y rutas |
| **Navegación por día** (‹ › · `input[type=date]` · «Hoy») | 🟢 **REUSAR** | `app/(panel)/agenda/day-picker.tsx`, tal cual. Se mueve a `components/` porque pasa a tener dos llamadores |
| Aritmética de fechas UTC (`shiftDay`, `dayOr`) | 🟢 **REUSAR** | `lib/agenda.ts`, con sus tests de fin de mes, año y bisiesto |
| Tabla paginada con orden por URL | 🟢 REUSAR | `components/data-table.tsx` (+ `Column.defaultDir`, de W5) |
| `meta` del sobre con respaldo | 🟢 REUSAR | `pageMeta` de `lib/bff.ts` |
| Ficha: caja, dato con rótulo, bajada, vacío, encabezado | 🟢 REUSAR | `Card`, `Fact`, `Hint`, `EmptyState`, `PageHeader` de `components/panel-ui.tsx` |
| Etiqueta de estado con tono | 🟢 REUSAR | `Badge` de `panel-ui`. El mapa código→tono es nuevo (`ROUTE_STATUS_TONE`), como `STATUS_TONE` en casos y cartera |
| Handlers que mutan | 🟢 REUSAR | `proxyMutation` de `lib/proxy.ts` |
| Traducir el error de la API | 🟢 REUSAR | `errorText` de `lib/api-error.ts` |
| Fechas y plata con locale | 🟢 REUSAR | `date`, `dateTime`, `money` de `lib/format.ts` |
| Agrupar por cobrador | 🟢 REUSAR | `groupByAssignee` de `lib/agenda.ts` — si el listado agrupa; si no, no se toca |
| **La cuenta de la jornada** | 🔵 EXTENDER (promover) | `summarizeDay` del móvil → `shared` (§6) |
| **El mapa del recorrido** | 🔴 **NUEVO** | `components/route-map.tsx` — **en `components/`, no dentro de la pantalla**: W9 lo va a querer para el seguimiento en vivo, y naciendo adentro de `/rutas/[id]` habría que reescribirlo |
| Lógica de rutas (acciones por estado, agrupado de paradas) | 🔴 NUEVO | `lib/routes.ts`, con tests. Mismo lugar y forma que `lib/cases.ts` y `lib/agenda.ts` |
| `GET /visits` y `GET /visits/:id` | 🔴 NUEVO | API (T0, §4.4) |

⚠️ Los dos 🔵 mueven código que hoy usa W5: al extraerlos hay que dejar **casos y agenda pasando
sus tests sin tocarlos**, igual que se exige con el móvil al promover a `shared`.

## 7. i18n

Namespace nuevo `panel.routes`. Los `VisitOutcome` (10 valores), `RouteStatus` (4) y
`RouteStopStatus` (4) se traducen por código, y `EvidenceType` (4) también. Los `details` de la
variante son JSON del móvil: se muestran los que el panel sabe nombrar y **el resto no se inventa**.

## 8. Tareas

| # | Tarea | Sale verde con |
|---|---|---|
| T0 | **API**: `GET /visits` y `GET /visits/:id` con scope, auditoría del revelado y desempate por `id` | `api` type-check + spec en `field.service.spec.ts` (ya está en la lista de `package.json`) |
| T1 | Promover a `shared` `summarizeDay`, `categoryOf`, `routeProgress` y los tipos | shared + móvil **310 sin tocar un test** |
| T2 | BFF de lo que muta (estado de la ruta) + matcher + `nav.ts` + esqueleto de i18n | type-check + `nav.test.ts` + `messages.test.ts` |
| T2-bis | **Subir a `components/` los dos 🔵 de §6-bis**: los filtros por URL (de `CaseFilters`) y el `DayPicker` | **casos y agenda verdes sin tocar sus tests** |
| T3 | `/rutas`: la lista del día, reusando lo de T2-bis | pantalla + `lib/routes.ts` con tests |
| T4 | `/rutas/[id]`: paradas en orden + la cuenta de la jornada con `summarizeDay` | pantalla |
| T5 | El mapa (D2) en `components/route-map.tsx`: recorrido, paradas numeradas y el punto de cada visita | pantalla + dep anotada en `apps/web/CLAUDE.md` |
| T6 | `/rutas/[id]/parada/[sid]`: la visita, su evidencia y el hash | pantalla |

## 9. Tests

| Qué | Dónde |
|---|---|
| `summarizeDay` y `categoryOf` | ya tienen cobertura en el móvil — **tienen que seguir pasando sin tocarse** |
| El scope y la auditoría del `GET /visits` nuevo | `field.service.spec.ts` (T0) |
| Qué acciones ofrece una ruta según su estado | `lib/routes.test.ts` |
| El agrupado de paradas por estado, y el vacío | idem |

## 10. Verificación

```
pnpm --filter @kobrax/shared build && pnpm --filter @kobrax/shared test
pnpm --filter @kobrax/mobile type-check && pnpm --filter @kobrax/mobile test   # 310, sin tocarlos
pnpm --filter @kobrax/api type-check && pnpm --filter @kobrax/api test
pnpm --filter @kobrax/web type-check && pnpm --filter @kobrax/web test
pnpm --filter @kobrax/web build      # ⚠️ con el `dev` APAGADO: comparten `.next`
```

Y el recorrido por cable con **dos sesiones**, supervisora y cobrador, como en W5.

## 11. Reglas de la etapa

Las transversales del BUILD-PLAN §3 valen todas; las que esta etapa toca de cerca:

1. **Multi-tenant por capacidad, nunca por rol** — acá pega doble, porque la puerta `@Roles` de
   rutas es mínima a propósito (§4.2) y el permiso declarado no dice quién puede.
2. **Ocultar ≠ autorizar**: el scope real lo aplica el service; la pantalla sólo evita ofrecer.
3. **Una regla de negocio no se re-implementa, se promueve** — `summarizeDay` es el caso (§6).
4. **No pintar lo que no existe**: sin T0, la evidencia no se dibuja «pronto», no se dibuja.
5. **La evidencia es inmutable**: ni editar ni borrar, ni siquiera para quien tiene todo.

## 12. Trampas y riesgos

- 🔴 **Sin T0 no hay evidencia** (§4.3). Es lo primero y bloquea T6.
- 🔴 **La puerta `@Roles` de rutas miente** (§4.2): dice `ROUTE_READ` en endpoints que escriben.
  Para decidir qué se dibuja, mirar `ROUTE_ASSIGN`.
- 🔴 **Las visitas y las evidencias son INMUTABLES** — sin `updated_at` ni `deleted_at`. El panel
  no ofrece editarlas ni borrarlas: es lo que las vuelve prueba.
- **La foto sale por `GET /uploads/:name`**, no por la `fileUrl` cruda.
- **Un tenant puede no tener OSRM** (el preview sale de un contenedor aparte): si el preview
  falla, la lista de paradas tiene que seguir dibujándose. El mapa es un extra, no el contenido.
- ⚠️ `maplibre-gl` es la primera dep nueva del panel: actualizar la lista de `apps/web/CLAUDE.md`.
- ⚠️ Tocar `shared` obliga a reiniciar el `dev` de la web. T1 toca `shared`.
- ⚠️ **PowerShell**: `[id]` es comodín (usar `-LiteralPath`) y `Set-Content -Encoding utf8` escribe
  BOM. Para editar código, las herramientas de edición.

## 13. Fuera de alcance

- **Armar o reordenar la ruta desde el panel** (`create`, `generate`, `optimize`, alta y baja de
  paradas): el cobrador arma la suya desde el teléfono, con el mapa en la mano.
- **Registrar una visita o subir evidencia** desde el panel: son `ROUTE_EXECUTE` y se hacen en la
  calle. El panel **lee**. (§11.5: tampoco se edita ni se borra lo que ya se registró.)
- **El seguimiento en vivo del cobrador** (`collector.location` por WebSocket): es W9.
- **Los KPIs de la jornada agregados por equipo**: es W8, que mide lo que esta etapa produce.
