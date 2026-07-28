> **ESTADO: ronda 3 (2026-07-27) — PASS del validador. Listo para construir (`/f10-etapa` Paso F).**
> Ronda 2 dio FAIL por dos ubicaciones mal elegidas (mapas de estado fuera de `ui.tsx`, y un helper
> de nombre "reusado" que no existía). Corregido en §6/§7/§5.1.

# F10 · Rutas · S1 — Estados de ruta (RT-0)

## 1. Objetivo
Convertir el placeholder del tab **Rutas** en la pantalla real del día: el cobrador entra y ve en qué
estado está su jornada —sin ruta, con ruta en curso, o terminada— y puede arrancarla. Sin mapa: el
mapa entra en S2/S3/S4.

## 2. Rama
`f10/rutas-s1-estados` (sale de la rama actual, que ya contiene FUNDACION `b2172d6`).

## 3. Build
🟢 según `ui-screen-map §4` (las tres pantallas no usan mapa). En la práctica corre en el **dev build**
que ya está instalado, porque la app entera cruzó esa frontera en FUNDACION.

## 4. Pantallas Figma
File `daLWsKQGC4Sd1NacU9fmrP`, sección RUTAS `81:5`:

| # | Pantalla | node-id |
|---|---|---|
| RT-0a | Sin ruta creada | `46:4` |
| RT-0b | Ruta activa | `46:108` |
| RT-0c | Ruta completada | `46:282` |

Son **tres estados de UNA pantalla** (el tab Rutas), no tres screens: comparten cabecera y contenedor,
y lo que cambia es el cuerpo. Pull de Figma just-in-time al construir (Paso F), no ahora.

## 5. Contrato (verificado contra el código, 2026-07-27)

| Uso | Endpoint | Qué devuelve realmente |
|---|---|---|
| ¿Hay ruta hoy? | `GET /api/routes?collectorId&status&date` | Paginado. **Sin `stops`** (`routes.service.ts:111` no hace include). Un cobrador (ROUTE_EXECUTE sin ROUTE_ASSIGN) queda acotado a sus rutas por el server. |
| Ruta con paradas | `GET /api/routes/:id` | Incluye `stops` ordenadas por `sequenceOrder`. |
| Generar la ruta del día | `POST /api/routes/generate` | Crea desde los casos **abiertos asignados al cobrador**, ordenados por prioridad. ⚠ Tira `NO_STOPS_TO_ROUTE` si no hay casos abiertos. |
| Arrancar / cerrar | `PATCH /api/routes/:id {status}` | `PLANNED→IN_PROGRESS→COMPLETED`. Al pasar a COMPLETED emite `ROUTE_COMPLETED`. |

Tablas: `route_plans`, `route_stops` (lectura), `collection_cases` (la generación las lee).
Enums de `@kobrax/shared`: `RouteStatus`, `RouteStopStatus`.

### ⚠ Hallazgo que condiciona el slice — la parada no tiene nombre
`routes.serializer.ts:3` devuelve **sólo ids**:
```ts
{ id, clientId, caseId, sequenceOrder, status, visitedAt }
```
No hay nombre de cliente, ni dirección, ni coordenadas. Una lista de paradas que diga
`Cliente a1b2c3…` no le sirve a nadie. Es el **mismo hueco** que el README del módulo ya había
detectado para las coordenadas (§"Contrato real"), y toca resolverlo acá porque S1 es la primera
pantalla que dibuja paradas. Ver decisión **D-S1-NOMBRE** en §11.

## 6. Auditoría de reuso

| Capacidad | Decisión | Dónde |
|---|---|---|
| Cabecera de pantalla | **REUSAR** | `src/ui.tsx` › `Header` |
| Estado vacío (RT-0a) | **REUSAR** | `src/ui.tsx` › `EmptyState` |
| Fila de parada | **REUSAR** | `src/ui.tsx` › `ListRow` (title/subtitle/right/onPress) |
| Badge de estado de parada | **REUSAR** | `src/ui.tsx` › `StatusBadge` (tonos ya definidos) |
| Métricas de la jornada (RT-0c) | **REUSAR** | `src/ui.tsx` › `StatTile` |
| Rótulo de sección | **REUSAR** | `src/ui.tsx` › `SectionLabel` |
| Banner sin conexión | **REUSAR** | `src/ui.tsx` › `OfflineIndicator` |
| Botones | **REUSAR** | `src/components.tsx` › `Button` |
| Listar / traer / generar / cambiar estado de ruta | **REUSAR** | `src/routes.service.ts` — `listRoutes`, `getRoute`, `generateRoute`, `updateRouteStatus` ya existen |
| Progreso de la ruta (hechas/total) | **REUSAR** | `src/routes.service.ts` › `routeProgress` (ya lo usa el Home) |
| Patrón "traer la ruta activa del cobrador" | **REUSAR** | `app/(tabs)/index.tsx:44-60` hace exactamente esta consulta |
| Sesión / usuario actual | **REUSAR** | `src/session.ts` |
| Tirar para actualizar | **REUSAR** | `RefreshControl` de React Native (mismo patrón que Ajustes › Importación) |
| Nombre y dirección de cada parada | **EXTENDER** | `apps/api/.../routes.serializer.ts` › `serializeStop` (D-S1-NOMBRE, §5.1) |
| Nombre para mostrar de un cliente | **NUEVO** | `apps/api/.../clients/clients.serializer.ts` › `clientDisplayName()` exportado. **Hoy NO existe**: `clients.serializer.ts:110` sólo pasa `businessName` crudo, y `clientLabel()` de `portfolio-import.service.ts:419` es privado del import y no contempla `ClientType.COMPANY`. Vive en `clients` porque la regla es de ese dominio; `routes` la consume. |
| Etiqueta + tono de `RouteStatus` / `RouteStopStatus` | **NUEVO** | `src/ui.tsx` › `ROUTE_STATUS_LABEL` y `STOP_STATUS_META`. Ahí viven los otros cuatro (`CASE_STATUS_LABEL:119`, `caseStatusTone:100`, `PORTFOLIO_STATUS_META:251`, `AGENDA_TYPE_META:332`) bajo la regla que el propio archivo declara en `:97` — *el enum es dominio (shared), el color es UI y vive acá*. Mismo shape `{label, tone}`. |

**Cero COMPONENTES nuevos en `ui.tsx`** (sí dos mapas de estado, que es donde el archivo los junta).
Las tres pantallas se arman con los componentes que ya existen: es la señal de que la fundación de
P0/P1 cubre este slice.

## 7. Artefactos nuevos
1. `app/(tabs)/rutas.tsx` — **reescritura** del placeholder. Una screen, tres estados. De un solo
   uso, así que vive en la screen.
2. `src/ui.tsx` › `ROUTE_STATUS_LABEL` + `STOP_STATUS_META` — mapas estado→etiqueta/tono, junto a
   los otros cuatro del archivo. Los usa Rutas y los van a usar S3/S4/S6, que dibujan las mismas
   paradas: por eso `ui.tsx` y no la screen.
3. `apps/api/.../clients/clients.serializer.ts` › `clientDisplayName()` — regla "empresa → razón
   social; persona → apellidos + nombres", exportada para que `routes.serializer` la consuma en vez
   de reimplementarla. **Deuda anotada:** `clientLabel()` del import (`portfolio-import.service.ts:419`)
   hace lo mismo peor (ignora empresas); debería converger acá, pero migrarlo no es de este slice.
4. Backend: el delta de §5.1 en `routes.serializer.ts` — extensión, no artefacto nuevo.

## 8. Tareas
1. **Backend §5.1**: `clientDisplayName()` en `clients.serializer.ts` + `include` del cliente en
   `findOne` + `clientName`/`address` en `serializeStop`. Test del serializer: persona, empresa,
   y cliente **sin ubicación cargada**.
2. Espejo del tipo en `src/routes.service.ts` (`RouteStopItem` suma los dos campos opcionales).
3. `ROUTE_STATUS_LABEL` + `STOP_STATUS_META` en `src/ui.tsx` + test.
4. `rutas.tsx`: carga (ruta del día del cobrador) + los tres estados + loading/error/offline.
5. RT-0a — vacío con "Generar ruta del día" y "Crear desde el mapa" apagado **con motivo visible**;
   manejar `NO_STOPS_TO_ROUTE` con un mensaje que diga qué hacer (no hay casos abiertos), no el código.
6. RT-0b — progreso + lista de paradas ordenadas con nombre y dirección + "Iniciar ruta".
7. RT-0c — métricas de cierre + lista en modo lectura.
8. Tirar para actualizar.
9. Verificación: `type-check` + `jest` (API y móvil) + `expo export`.

## 9. Reglas de la fase
- **Sol → contraste:** nombre del cliente y estado de la parada en `navy`; los secundarios en `text2`.
- **Gama baja:** la lista de paradas de una jornada es chica (decenas). `ScrollView` alcanza;
  FlashList sería infra sin caso. Si aparece una ruta de cientos, se cambia ahí.
- **Animación con propósito:** ninguna en este slice.
- **Del módulo:** CTA morado del Figma → **navy**; purple sólo acento.
- **Multi-tenant:** el scope lo aplica el server por capacidad (`routes.service.ts:100-104`); el
  móvil no filtra por rol ni ramifica por `tenantType`.

## 10. DoD
- [ ] Las tres pantallas se ven y se navegan en el teléfono, con datos reales.
- [ ] Sin ruta → **Generar ruta del día** → aparece la ruta con sus paradas, **con nombre y dirección**.
- [ ] "Crear desde el mapa" se ve apagado y dice por qué.
- [ ] **Iniciar ruta** mueve `PLANNED→IN_PROGRESS` y la pantalla pasa a RT-0b.
- [ ] Una parada de un cliente sin ubicación cargada se dibuja igual (dirección vacía, sin romper).
- [ ] Sin casos abiertos → mensaje entendible, no `NO_STOPS_TO_ROUTE`.
- [ ] `type-check` + `jest` verdes **en API y móvil** + `expo export` OK.
- [ ] `/code-review` + `/ponytail-review` aplicados.
- [ ] Validación visual por la usuaria.

## 11. Decisiones cerradas (con la usuaria, 2026-07-27)

### D-S1-NOMBRE — el nombre sale del backend
`serializeStop` se **extiende** con `clientName` y `address` del cliente, vía `include` en
`GET /routes/:id`. Se descartó el join en el móvil contra `GET /clients`: funcionaba, pero obligaba
a traer la cartera entera cada vez que se abre Rutas y a repetir ese join en S2, S3 y S4, que
dibujan las mismas paradas. Una consulta del server resuelve los cuatro slices.

**Consecuencia: el slice deja de ser 100% móvil.** Suma un delta de contrato (§5.1) y su test.

### D-S1-CREAR — el vacío muestra los dos caminos, uno apagado
"Generar ruta del día" activo, y **"Crear desde el mapa" deshabilitado con el motivo visible**
("Disponible en la próxima versión"). Se ve desde ya que el camino existe. Regla del proyecto: un
control apagado siempre dice POR QUÉ lo está — un botón gris sin motivo es un bug para el usuario.

### D-S1-LIFECYCLE — S1 arranca, S6 cierra
`PLANNED→IN_PROGRESS` ("Iniciar ruta") vive acá: es lo que convierte RT-0a en RT-0b, y sin eso la
pantalla sería sólo lectura y no habría forma de llegar al estado activo ni para probarlo.
`→COMPLETED` pertenece al **Resumen de jornada (S6)**, donde el cobrador ve qué hizo antes de cerrar
el día. Hasta que S6 exista, una ruta se cierra desde el backend; no se inventa un botón provisorio.

## 5.1 Delta de contrato (backend, nuevo en este slice)

`apps/api/src/modules/routes/routes.serializer.ts` — `serializeStop` pasa a devolver:
```ts
{ id, clientId, caseId, sequenceOrder, status, visitedAt, clientName, address }
```
- `findOne` suma el `include` del cliente con su ubicación primaria. `list` **no cambia** (no trae
  stops).
- `clientName` sale de `clientDisplayName()` (empresa → razón social; persona → apellidos +
  nombres), que **hay que escribir**: hoy no existe (§6). Se exporta desde `clients.serializer.ts`
  y `routes.serializer.ts` la importa — no se copia la regla en dos lados.
- Ambos campos son **opcionales en el tipo**: una parada de un cliente sin ubicación cargada existe
  y tiene que poder dibujarse igual, con la dirección vacía.
- "Ubicación primaria" = la primera `LocationType.HOME`; si no hay ninguna, la primera que haya.
  Un cliente puede tener varias (domicilio y negocio) y la casa es donde se cobra.
- Sin migración: es lectura de tablas que ya existen.

## ⏸️ Pendiente de confirmar
- (nada) — las tres decisiones quedaron cerradas. Falta el gate del validador.
