> **ESTADO: EN BORRADOR — ronda 1 (2026-08-11). NO construir hasta PASS.**
>
> Ronda 1 deja el contrato verificado contra el controller y el service, y **las cuatro decisiones
> de la dueña ya cerradas** (§5, 11/08): tabla con filtros · el día · generar casos con
> confirmación · `sort` a la API. La última hace que W5 **toque la API**, cosa que ninguna etapa
> del panel había hecho hasta ahora — ver §4.4 y T0.

# W5 — Casos y agenda

## 1. Objetivo

Que la supervisora vea **el trabajo del equipo**, no el suyo: qué casos hay abiertos, quién los
tiene, cuáles se están venciendo, qué se agendó para hoy y qué de eso se hizo.

Es la primera etapa del panel que **no es carga de datos sino supervisión**. W3 y W4 llenaron la
cartera; W5 es la primera que mira lo que el equipo hace con ella.

En el móvil la agenda es la del cobrador y el día es suyo. Acá el mismo endpoint devuelve **todo
el tenant** sin que haya que pedir nada: el scope se decide por capacidad (§4.3). Eso es lo que
hace que esta etapa sea barata y también lo que la vuelve peligrosa de leer mal — 40 gestiones de
8 cobradores mezcladas en una lista no son una pantalla de supervisión, son un volcado.

## 2. Rama

`web/W5-casos-agenda`, **sale de `main` con W4 adentro**.

🔴 W4 todavía **no está mergeada** (vive en `web/W4-import`). Antes de la primera línea:
`git log -1` de la rama tiene que ser descendiente del merge de W4 — no de `2b7c059`. La rama de
Cuenta del móvil salió de un commit viejo y el merge terminó con **dos copias de dos
componentes** sin que git marcara conflicto; sólo lo agarró el type-check.

De W4 se hereda de verdad: `Card` y `Hint` en `panel-ui`, el `Select` de `ui.tsx`, y el patrón de
`lib/import.ts` para traducir códigos de error de la API (§7).

## 3. Pantallas

| Ruta | Permiso | Qué hace |
|---|---|---|
| `/casos` | `case:read` | La tabla con filtros (estado, prioridad, cobrador, vencidos), orden por URL y el botón de generar |
| `/casos/[id]` | `case:read` | La ficha: deudor, crédito, estado, y el timeline de gestiones |
| `/agenda` | `agenda:read` | Lo agendado de **un día** (con selector de fecha), separado en pendiente y hecho, más los vencidos |
| `/agenda/[id]` | `agenda:read` | El detalle de una gestión y su historial |

🔴 **`/casos/:path*` y `/agenda/:path*` al matcher de `middleware.ts`**, y también
`/api/cases/:path*` y `/api/agenda/:path*`. Es el error más fácil de cometer: la pantalla anda
hasta que expira el access token, 15 minutos después.

En `lib/nav.ts` se les da vuelta el `built: false` a `cases` y `agenda`.

## 4. Contrato (verificado contra `cases.controller.ts`, `agenda.controller.ts` y sus services)

### 4.1 Casos — 8 endpoints

| Endpoint | Permiso | Notas |
|---|---|---|
| `GET /cases` | `case:read` | Filtros: `status`, `priority`, `assigneeId`, `clientId`, `overdue`, `open`, `view=portfolio` + paginación |
| `GET /cases/:id` | `case:read` | Trae `activities` ordenadas **desc** — el timeline ya viene armado |
| `POST /cases` | `case:write` | Alta manual sobre un `creditId` |
| `POST /cases/generate` | `case:assign` | **Genera casos en lote** por mora (`minDaysPastDue`); devuelve `{ created }` |
| `PATCH /cases/:id` | `case:write` | Transición de estado (+ `reason`) |
| `POST /cases/:id/assign` | `case:assign` | `collectorId`, o `auto: true` → el cobrador **menos cargado** |
| `POST /cases/:id/activities` | `case:write` | Registrar una gestión (con `promise` opcional) |
| `POST /cases/:id/close` | `case:close` | Cerrar con motivo obligatorio |

### 4.2 Agenda — 14 endpoints, de los que el panel usa 7

| Endpoint | Permiso | Notas |
|---|---|---|
| `GET /agenda?date=` | `agenda:read` | Un día. **Sólo `date`**: no hay filtro por cobrador (§4.5) |
| `GET /agenda/overdue` | `agenda:read` | `SCHEDULED` con fecha < hoy, paginado |
| `GET /agenda/:id` | `agenda:read` | Detalle + deudor con CI **en claro** + historial del caso |
| `POST /agenda/:id/complete` | `agenda:write` | Deja un `CaseActivity` y pasa el ítem a `EXECUTED` |
| `POST /agenda/:id/cancel` | `agenda:write` | Motivo del catálogo (`/catalogs`). **Sigue visible** |
| `POST /agenda/:id/reschedule` | `agenda:write` | Cierra ésta como reagendada y **devuelve la nueva** |
| `PATCH /agenda/:id` | `agenda:write` | Editar una pendiente. **Sin fecha ni deudor**: eso es reagendar |

Los otros 7 (`clients/:id/context`, alta de teléfono, alta y corrección de dirección, `POST
/agenda`, `postpone`, `DELETE`) son del flujo de campo. Ver §12.

### 4.3 🔴 El scope ya es por capacidad, y eso decide toda la etapa

`assigneeScope()` en agenda y `scopedToOwnCases()` en casos hacen lo mismo:

- **con `AGENDA_ASSIGN` / `CASE_ASSIGN`** (supervisora, gerencia) → se ve **todo el tenant**;
- **sin ellos** (cobrador) → sólo lo propio.

**No hay que pedir nada ni pasar ningún parámetro**: el panel ya ve todo porque quien lo usa tiene
esos permisos. Es el mismo criterio que `GET /payments`, que devuelve los del tenant y no los del
cobrador — cosa que en Rutas costó descubrir.

La consecuencia incómoda: **la misma pantalla le muestra cosas distintas a dos personas** y no hay
nada en la respuesta que lo diga. Un cobrador que abra `/casos` va a ver una lista corta y correcta
sin ninguna señal de que está filtrada. §7 le pone un rótulo.

### 4.4 🔴 `GET /cases` tiene el orden FIJO — **D4: se le agrega `sort`**

Hoy es `orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }]`, cableado en el service, y el
`DataTable` de W1 ordena empujando `?sort=&dir=` a la URL: sin tocar la API, ninguna columna
ordena.

**Decidido (D4): se le agrega `sort` a `GET /cases`.** Ordenar en cliente quedaba descartado —
ordena **sólo la página visible**, que es la trampa que W3 ya documentó: parece que ordenó la
lista y ordenó 20 filas, y la fila de 200 días de mora sigue escondida en la página 4.

Alcance del cambio en la API (T0), chico y con spec propio:

| `sort` | Ordena por | Por qué |
|---|---|---|
| `priority` | `priority` (el actual) | Sigue siendo el **default**: sin `sort`, nada cambia |
| `daysPastDue` | `credit.daysPastDue` | Es como una supervisora mira su cartera |
| `balance` | `credit.outstandingBalance` | «Los que más plata deben» |
| `slaDueAt` | `slaDueAt` | Se filtra con `overdue=true` pero no se podía ordenar |
| `createdAt` | `createdAt` | Antigüedad del caso |

Dos cosas que no se pueden olvidar, y las dos las pagó W3:

1. **El orden termina siempre en `id`.** Sin desempate, `LIMIT/OFFSET` repite y saltea filas
   entre páginas cuando hay empates — y en `priority` los empates son la regla, no la excepción.
2. `daysPastDue` y `outstandingBalance` **viven en `credit`**, no en `collection_cases`: se ordena
   por la relación (`orderBy: { credit: { daysPastDue: 'desc' } }`), que Prisma sí soporta —
   distinto de `_count`/`SUM`, que fue lo que obligó al SQL crudo en W3.

`sort` desconocido → se cae al default, **no** 400: es un parámetro que viaja en la URL y una URL
vieja compartida por chat no tiene que reventar la pantalla.

### 4.5 🔴 `GET /agenda` no filtra por cobrador

Toma **sólo `date`**. Con `AGENDA_ASSIGN` eso significa las gestiones de **todo el equipo** de ese
día, mezcladas, sin forma de pedir las de una persona.

La lista de un día es chica (decenas, no miles) y **no está paginada**, así que agrupar o filtrar
por cobrador **en cliente** es correcto y no miente: se recibió el día entero. Es la salida barata
y es honesta; queda anotado para que nadie la lea como un descuido.

### 4.6 Las reglas de la agenda que el panel tiene que respetar

Vienen cerradas del módulo del móvil y no se rediscuten:

1. **El día deja rastro; la hora no.** Reagendar a otro día deja la gestión visible en el día
   viejo, marcada como reagendada. Cambiar la hora dentro del mismo día simplemente la cambia.
2. **Cancelado y reagendado siguen visibles en el día**, no desaparecen.
3. **Las promesas de pago no tienen tabla**: son `agenda_items` de tipo `PROMISE_TO_PAY`
   (⚠️ el enum de Prisma es `PROMISE_TO_PAY`, no `PROMESA`).
4. `DELETE /agenda/:id` es **soft-delete** y responde **200 con el ítem**, no 204.
5. Los motivos de cancelación salen del **catálogo** (`GET /catalogs/:catalog`), no de una lista
   escrita en la pantalla.

### 4.7 Las transiciones las manda `CASE_TRANSITIONS`

Ya está en `shared` (`src/constants/case-transitions.ts`). **La pantalla ofrece sólo los estados a
los que se puede ir desde el actual** — no un `<select>` con los siete. El servidor valida igual;
esto es para no ofrecer un botón que va a rebotar.

`CLOSED` no se ofrece en ese control: tiene su propio endpoint y **exige motivo**
(`case:close`, que es un permiso aparte).

## 5. Las cuatro decisiones de la dueña (11/08) — cerradas

| # | Decisión | Qué implica |
|---|---|---|
| D1 | **`/casos` es una TABLA con filtros**, no un tablero kanban | Reusa el `DataTable` de W1 sin tocarlo. Filtros de estado, prioridad, cobrador y vencidos; las transiciones válidas se ofrecen con un menú por fila (`⋮` → pasar a… / asignar / cerrar). **El kanban con arrastrar y soltar queda fuera** (§12): no hay librería de drag&drop instalada y es una etapa entera. El BUILD-PLAN decía «tablero» — esta decisión lo corrige |
| D2 | **La agenda es de UN DÍA**, con selector de fecha | Una llamada, igual que el móvil, y los vencidos aparte con su propio endpoint. Es lo que la API entrega tal cual: la semana serían 7 llamadas o un endpoint nuevo |
| D3 | **Entra `POST /cases/generate`**, con confirmación | Es el botón que llena el tablero de golpe. El modal dice **cuántos días de atraso** se van a tomar y que **no hay forma de deshacerlo en bloque**; al volver se muestra el conteo (`{ created }`) |
| D4 | **Se le agrega `sort` a `GET /cases`** | §4.4. W5 **toca la API**, cosa que ninguna etapa del panel había hecho: es un cambio chico y con spec, y es la única forma de que ordenar ordene la lista entera y no la página |

## 6. Lo que se promueve a `shared`

Regla del BUILD-PLAN §3.9: **va la regla, nunca el texto en un idioma.**

### Sí van (desde `apps/mobile/src/agenda-form.ts`)

| Qué | Por qué |
|---|---|
| **`partitionDay`** | 🔴 El reparto del día. `done = status !== SCHEDULED`. **Tiene test de no-regresión**: la pantalla usaba `=== EXECUTED` y **una gestión cancelada desaparecía del día**. Si la web lo reimplementa, reimplementa el bug |
| `FormState`, `FormAction`, `formReducer`, `initialForm`, `canSubmit` | La máquina del formulario de gestión |
| `hydrateForm`, `buildPatch`, `buildPayload` | Alta, edición y **PATCH parcial** |
| `todayISO`, `toLocalDate`, `toISO`, `toHHmm` | Fechas sin `Date` en el medio, que es de donde salen los corrimientos de zona |

Ya están en `shared` y **no hay que tocarlas**: `CASE_TRANSITIONS`, `TIME_SLOT_HOURS`,
`slotOfTime`, `validateAgendaDetails`, los enums de agenda.

### No van (texto en un idioma)

`MONTHS` · `WEEKDAYS_SHORT` · `formatLongDate` · `TIME_SLOT_LABEL` · `money` (`shared` ya tiene
`formatCurrency`, y el móvil escribió el suyo antes). La web pone meses y días con
`Intl.DateTimeFormat` en el idioma activo, que además es lo correcto para un panel bilingüe.

⚠️ Antes de exportar, revisar colisiones en los barriles: `canSubmit` y `buildPatch` son nombres
genéricos y `shared` ya tuvo dos choques (`hasChanges` → `hasClientChanges` en W3).

## 7. i18n

Namespaces nuevos `panel.cases` y `panel.agenda`. `messages.test.ts` falla si una clave existe en
un idioma y no en el otro, y **una clave vacía también falla** (lo pagó W4).

- Los **estados de caso y los tipos de gestión** se traducen en el panel, por código. No se
  promueven los rótulos del móvil: son español.
- Los **motivos de cancelación vienen del catálogo del servidor** y **no se traducen**: los edita
  el tenant, son suyos. Mismo criterio que las etiquetas del catálogo de campos en W4.
- Los códigos de error de la API se traducen con el patrón de `lib/import.ts` (`errorText`): en
  `es` gana el mensaje del servidor, en `en` se traduce por código, **y un código desconocido se
  muestra crudo**.
- Un rótulo para §4.3: cuando quien mira no tiene `CASE_ASSIGN`, la pantalla dice que está viendo
  **lo suyo**. Sin eso, una lista filtrada parece una lista corta.

## 8. Tareas

| # | Tarea | Sale verde con |
|---|---|---|
| T0 | **API**: `sort` en `ListCasesQueryDto` + `GET /cases` (D4, §4.4), con el desempate por `id` | `api` type-check + **su spec en `cases.service.spec.ts`** (que ya está en la lista de `package.json`) |
| T1 | Promover a `shared` `partitionDay` + la máquina del formulario + los helpers de fecha. El móvil importa de ahí | `shared` build + test · móvil type-check + **310 sin tocar un test** |
| T2 | BFF: `api/cases/**` (lista, ficha, transición, asignar, actividad, cerrar, generar) y `api/agenda/**` (día, vencidos, detalle, completar, cancelar, reagendar, editar) | type-check + tests de handler |
| T3 | Matcher del middleware, `nav.ts` → `built: true` ×2, esqueleto de los dos namespaces | `nav.test.ts` + `messages.test.ts` |
| T4 | `/casos`: la tabla con sus filtros y el orden por URL (D1 + D4) | pantalla + `lib/cases.ts` con tests |
| T5 | `/casos/[id]`: ficha + timeline + transición (sólo las válidas) + asignar + cerrar con motivo | pantalla |
| T6 | `/agenda`: el día con su selector de fecha, `partitionDay`, agrupado por cobrador (§4.5) + los vencidos | pantalla |
| T7 | `/agenda/[id]`: detalle + completar / cancelar / reagendar | pantalla |
| T8 | El botón de generar casos (D3): confirmación con los días de atraso, el aviso de que no se deshace, y el conteo de vuelta | pantalla |

## 9. Tests

Vitest, **por lógica no trivial, no por componente**.

| Qué | Dónde |
|---|---|
| `partitionDay` | ya tiene su test de no-regresión en el móvil — **tiene que seguir pasando sin tocarse** |
| El `sort` nuevo: cada clave ordena por lo suyo, el desconocido cae al default y **el desempate por `id` está siempre** | `apps/api/.../cases.service.spec.ts` (T0) |
| Qué transiciones ofrece la ficha para cada estado (y que `CLOSED` nunca sale por ahí) | `lib/cases.test.ts` |
| Qué acciones ofrece una gestión según su estado | `lib/agenda.test.ts` |
| Código de error → texto, con el fallback y el código crudo | idem |
| El agrupado por cobrador de un día, incluido «sin asignar» | idem |

## 10. Verificación

```
pnpm --filter @kobrax/shared build && pnpm --filter @kobrax/shared test
pnpm --filter @kobrax/mobile type-check && pnpm --filter @kobrax/mobile test   # 310, sin tocarlos
pnpm --filter @kobrax/api type-check && pnpm --filter @kobrax/api test
pnpm --filter @kobrax/web type-check && pnpm --filter @kobrax/web test
pnpm --filter @kobrax/web build      # ⚠️ con el `dev` APAGADO: los dos escriben en `.next`
```

Y el recorrido por cable con **dos sesiones distintas**: una supervisora y un cobrador, para ver
que la misma pantalla muestra cosas distintas y que las dos son correctas. Es lo único que prueba
§4.3, y ninguna prueba automática lo ve.

## 11. Trampas y riesgos

- 🔴 **El scope es invisible en la respuesta** (§4.3). Dos personas ven listas distintas y nada lo
  dice. Es el equivalente de W5 al «`GET /payments` devuelve los del tenant» de Rutas.
- 🔴 **Los spec de la API se listan A MANO** en su `package.json`. T0 usa `cases.service.spec.ts`,
  que ya está en esa lista — pero si el `sort` termina en un archivo nuevo, **hay que sumarlo o no
  corre**, y el verde miente.
- 🔴 **El orden nuevo tiene que terminar en `id`** (§4.4). Sin desempate, `LIMIT/OFFSET` repite y
  saltea filas entre páginas, y con `priority` los empates son la regla. Lo pagó W3.
- 🔴 **`GET /agenda/:id` revela el CI en claro y lo audita.** No es una lectura más: si se llama
  para pintar una lista, se auditan N revelados por pantalla. Se llama **sólo al abrir el detalle**.
- **`GET /agenda/clients/:id/context` exige `AGENDA_WRITE`, no `AGENDA_READ`**, justamente porque
  revela PII. Una supervisora con sólo lectura recibe 403 en un endpoint que «parece» de lectura.
- ⚠️ **El orden de las rutas del controller de agenda importa**: `GET /:id` está declarado último
  a propósito. Si el BFF arma mal las rutas, `overdue` se puede comer con un 400 de UUID.
- ⚠️ **`reschedule` devuelve la gestión NUEVA**, no la vieja. Refrescar con ese id y creer que es
  la misma deja la pantalla mostrando otra cosa.
- ⚠️ Tocar `shared` obliga a **reiniciar el `dev`** de la web (`resolve.symlinks = false`). T1 toca
  `shared`.
- ⚠️ **Nunca correr `next build` con el `dev` levantado**: comparten `.next` y el build le pisa los
  chunks al servidor de desarrollo — todas las pantallas quedan en blanco y no es el código. Se
  pagó en W4.
- ⚠️ `git commit -F archivo`: PowerShell no tiene here-docs y un mensaje con una ruta dispara un
  guard del harness.

## 12. Fuera de alcance (dicho para que no se pida después)

- **El tablero kanban con arrastrar y soltar** (D1). `/casos` es una tabla con filtros. No hay
  librería de drag&drop instalada y hacerlo a mano —con teclado y lector de pantalla, que es lo
  que lo vuelve caro— es una etapa entera.
- **La agenda por semana** (D2): un día por pantalla, con selector de fecha.
- **Agendar desde el panel** (`POST /agenda`, `clients/:id/context`, alta de teléfono y dirección):
  es el flujo de campo, y arrastra el mapa y la PII en claro. El panel **supervisa** lo agendado.
- **`postpone`** (+15 / +30 / +1h): son los botones del cobrador que ya está en la puerta.
- **La evidencia de las visitas** (foto, GPS, hash): es W6.
- **El mapa de casos** (`view=portfolio` trae el punto del domicilio): es W6, con las rutas.
- **Realtime** (`case.updated` por WebSocket): es W9. Acá se refresca navegando.
