# F10 · Rutas · S6 — Resumen de la jornada (RT-7)

> **ESTADO: BORRADOR ronda 1 (2026-08-05). NO construir hasta PASS de `/f10-validar-plan`.**

## 1. Objetivo
Cerrar el día. El cobrador termina su recorrido y ve **qué hizo**: cuánto recaudó, cuántas paradas
completó y cómo terminó cada una. Desde ahí cierra la jornada.

Es la última pantalla del módulo: con S6, Rutas queda **completo de punta a punta** — crear (S2),
previsualizar (S3), ejecutar (S4), registrar (S5) y cerrar (S6).

## 2. Rama
`f10/rutas-s6-resumen`, **apilada sobre `f10/rutas-s5-resultado`**: el resumen cuenta los resultados
que registra S5. Se mergea con S4 y S5, o después de ellos.

## 3. Build
Dev build por cable (la pantalla vive dentro del stack de Rutas, que usa MapLibre).
Verificación: `type-check` + `jest` + `expo export` + smoke real + validación visual.

## 4. Pantallas Figma
| Mockup | node-id | PNG |
|---|---|---|
| RT-7 Resumen de jornada | `51:1053` | `RT-7 Resumen de jornada.png` |

Node-id del README del módulo, PNG exportado. **Cero llamadas al MCP.**

## 5. Contrato (verificado contra el código, 2026-08-05)

### 5.0 La decisión que manda acá: **los KPIs se calculan en el cliente**
`ui-screen-map.md §8.1` lo dejó cerrado: *«KPIs = calcular en cliente desde routes/cases/payments
locales (incluye acciones offline `pending`). **Sin endpoint de agregación nuevo**»*. El motivo sigue
siendo válido justo en esta pantalla: son contadores **intradía** de acciones que el cobrador acaba de
hacer en la calle, y hasta que sincronice el dispositivo es el único que tiene el dato fresco.

→ **No se crea `GET /routes/:id/summary`.** El resumen se arma con lo que la pantalla ya puede pedir.
Lo que falta son **dos campos de dato** en respuestas que ya existen, no una agregación.

### 5.1 Delta A — la parada dice cómo terminó
Para contar «Cobrados / Promesas / No contesta / Inubicables» hace falta el resultado de cada parada.
Hoy `serializeStop` devuelve `status` (`VISITED`), que no distingue **cómo** terminó.

```
serializeStop += lastOutcome?: VisitOutcome   // el outcome de su última visita
```
⚠ **El `include` NO existe**: `visits` no aparece en ninguna query del módulo de rutas. Hay que
sumarlo al lado de `STOP_CLIENT`/`STOP_CASE` (una constante `STOP_VISIT` con
`take: 1, orderBy: { capturedAt: 'desc' }`, para no traerse el historial entero de cada parada).
Una parada sin visitar lo devuelve `undefined`. **Sirve además a S4**: el pin del mapa puede
colorearse por resultado en vez de sólo por `VISITED`.

### 5.2 Delta B — el pago dice de qué caso es
`GET /payments?from=&to=` ya filtra por día (`ListPaymentsQueryDto`), pero el item serializado **no
trae `caseId`**, así que el cliente no puede quedarse con los pagos *de esta ruta*.

```
PaymentItem += caseId?: string
```
Con eso el total del día es una suma en el cliente: **un** `GET /payments` del día, filtrado por los
`caseId` de la ruta. Sin llamada por parada y sin endpoint de agregación.

### 5.3 Cerrar la jornada — ya existe
`PATCH /api/routes/:id {status: COMPLETED}` (`updateRouteStatus`), que además emite
`ROUTE_COMPLETED`. **No se toca.**

### 5.4 Las dos «próximas acciones» del mockup
- **«Sincronizar con oficina»**: la cola de sincronización real es **P6**, no existe. La fila se
  muestra y **avisa** — mismo criterio que usaron S1 con el FAB y S4 con "Registrar resultado":
  la pantalla se valida completa y el destino llega en su etapa. *No se finge una sincronización.*
- **«Revisar ruta de mañana»**: abre la pestaña Rutas. Es navegación, no funcionalidad nueva.

### 5.5 Delta C — cerrar el `"—"` que dejó S1
`RutaFinalizada` (RT-0c, `(tabs)/rutas.tsx:229`) ya muestra las métricas de la jornada cerrada, con
`StatTile label="Cobrado" value="—"` y el comentario *"se activa con los pagos en campo"*. **Ese
momento es ahora**: con §5.2 el número es calculable. Se llena ahí también, con la **misma**
`summarizeDay`, y la tarjeta gana una fila para entrar al resumen completo.

Si no se hiciera, el módulo tendría dos pantallas del mismo día diciendo cosas distintas.

## 6. Auditoría de reuso (Paso B)

| Necesito | ¿Existe? | Qué uso |
|---|---|---|
| Progreso de la ruta | ✅ | **`routeProgress(route)`** (`routes.service.ts:51`) — de la fundación |
| Recuadros de KPI | ✅ | `StatTile` (`ui.tsx`) |
| Filas de acción | ✅ | `ListRow` (`ui.tsx`) |
| Cabecera | ✅ | `Header` (`ui.tsx`) |
| Estado de ruta → etiqueta | ✅ | `ROUTE_STATUS_LABEL` (`ui.tsx`) |
| Moneda | ✅ | `money` (`agenda-form.ts`) |
| Cerrar la jornada | ✅ | `updateRouteStatus` (`routes.service.ts`) |
| Pagos del día | ✅ | `GET /payments?from=&to=` — **falta `caseId` en la respuesta** (§5.2) |
| Confirmar una acción destructiva | ✅ | `Alert` nativo — el mismo camino que usó agenda S6 para eliminar |
| Resultado por parada | ❌ | **Delta A** (§5.1) |
| Barra de progreso | ⚠️ **duplicada** | Ya existe inline en `(tabs)/rutas.tsx:182-184` (`barTrack`/`barFill`) → **consolidar** en `ProgressBar` de `ui.tsx` y migrar ese llamador |
| Métricas de la jornada cerrada | ⚠️ | **`RutaFinalizada`** (`(tabs)/rutas.tsx:229`) ya las muestra, con `Cobrado: "—"` esperando los pagos en campo → S6 lo completa (§5.5) |
| Agrupar outcomes en categorías | ❌ | `summarizeDay()` en `src/route-summary.ts` (**nuevo**, puro y testeado) |

## 7. Artefactos nuevos

| Artefacto | Path | Por qué |
|---|---|---|
| `app/rutas/resumen.tsx` | móvil | RT-7 |
| `ProgressBar` | `src/ui.tsx` | **consolidación**, no artefacto nuevo: la barra ya vive inline en `(tabs)/rutas.tsx` y ahora la usan dos pantallas |
| `src/route-summary.ts` | móvil | **`summarizeDay(route, payments)`**: agrupa outcomes en las 4 categorías y suma el recaudado. Puro → es la parte que puede contar mal, y se prueba sin red |

## 8. Tareas
1. **API** — `include` de la última visita + `lastOutcome` en `serializeStop` (§5.1) + `caseId` en el
   serializer de pagos (§5.2) + tests.
2. **Móvil** — `summarizeDay()` + su test (categorías, ruta vacía, pagos de otra ruta, parada sin visitar).
3. **Móvil** — `ProgressBar` a `ui.tsx` y **migrar la barra inline de `(tabs)/rutas.tsx`** (§6).
4. **Móvil** — `app/rutas/resumen.tsx` + cerrar jornada con confirmación (§11-D2).
5. **Móvil** — `RutaFinalizada` deja de mostrar `"—"` y usa la misma `summarizeDay` (§5.5).
6. **Cable** — el mapa activo (S4) lleva al resumen cuando no quedan paradas pendientes; y la ruta
   completada de `(tabs)/rutas` abre el resumen.
7. **Verificación** — type-check + jest + `expo export` + **smoke real** + validación visual.

## 9. Reglas de la fase
- **KPIs en el cliente** (§5.0). Cualquier "sería más fácil con un endpoint que sume" está fuera.
- Offline-first: el resumen se arma con lo que haya; sin red muestra la ruta cargada y el recaudado
  en blanco, **no una pantalla vacía**. Cerrar la jornada sin red no se pierde: el estado sube cuando
  vuelva (mismo criterio que "Iniciar ruta" en S3).
- Tokens de `src/theme.ts`, nada hardcodeado. Enums de dominio desde `shared`.
- Multi-tenant por capacidad (`ROUTE_EXECUTE`); TS estricto sin `any`; `{data,meta,error}`.

## 10. DoD
- [ ] El total recaudado sale de los pagos **de las paradas de esta ruta**, no de todo el tenant.
- [ ] Las 4 categorías cuadran con las paradas visitadas; una parada sin visitar no cuenta.
- [ ] El progreso coincide con el que muestra la pestaña Rutas (misma función).
- [ ] Cerrar la jornada con paradas pendientes **pide confirmación** y dice cuántas quedan.
- [ ] Una ruta ya cerrada no se puede volver a cerrar.
- [ ] La pestaña Rutas y el resumen muestran **el mismo** recaudado (misma `summarizeDay`); el `"—"`
      de `RutaFinalizada` desapareció.
- [ ] La barra de progreso quedó en un solo lugar (`ProgressBar`), sin copia inline.
- [ ] type-check + jest + `expo export` · smoke real · validación visual.
- [ ] `/code-review` + `/ponytail-review` cerrados · BASE-INVENTORY actualizado.

## 11. Decisiones cerradas
| # | Decisión | Implicancia |
|---|---|---|
| **D1** | **Sin endpoint de agregación** (heredada de `ui-screen-map §8.1`). | El resumen se calcula en el cliente; el server sólo suma dos campos de dato (§5.1, §5.2). |
| **D2** | **Cerrar con paradas pendientes se permite, con confirmación** que diga cuántas quedan. | Un cobrador puede terminar el día sin completar todo (se hizo de noche, el barrio se puso feo). Bloquearlo lo empujaría a marcar visitas falsas — que es peor que un día incompleto. *Asunción a validar en la revisión visual.* |
| **D3** | «Sincronizar con oficina» **avisa**, no finge. | La cola real es P6 (§5.4). |

## 12. Riesgos
- **`GET /payments` devuelve los pagos del tenant, no los del cobrador.** El filtro por los `caseId`
  de la ruta es lo que lo acota; sin él, el "recaudado hoy" mostraría lo que cobró otra persona.
  Es el punto que el smoke tiene que atacar.
- **La categoría «Inubicables» junta `NOT_FOUND` y `WRONG_ADDRESS`**, que S5 separó a propósito. Para
  el resumen del día es la misma acción del cobrador (fue y no pudo cobrar), pero **la agrupación vive
  en `summarizeDay` y no en la DB**: el dato fino sigue estando entero en `field_visits`.
- **`SPECIAL` y `REFUSAL` no tienen tarjeta en el mockup.** Se cuentan en «Otros», que sólo aparece si
  hay alguna: inventarle una tarjeta fija al mockup sería peor que mostrarla cuando existe.
- Apilar tres ramas (S4→S5→S6) sin mergear alarga el diff acumulado. Si el `/code-review` de S4 pide
  cambios, hay que rebasear dos ramas.

## ⏸️ Pendiente de confirmar
Ninguno.
