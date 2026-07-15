> **ESTADO: EN BORRADOR — ronda 1 (2026-07-15). NO construir hasta PASS de `/f10-validar-plan`.**

# F10 · Rutas — FUNDACION (motor de mapas + dev build + packs offline)

## 1. Objetivo
Poner la base de mapas del módulo Rutas: adoptar **MapLibre como único motor de mapas de la app**,
cruzar a **dev build**, dejar los **componentes de mapa compartidos** (canvas, picker, mini-card), el
**servicio de rutas** y la **infraestructura de packs offline**. Sin esta base, ningún slice de Rutas
(S1–S6) ni la migración de agenda/cartera puede construirse.

## 2. Rama
`f10/rutas-fundacion`

## 3. Build
🔵 **dev build** — `expo prebuild` + `expo run:android` por cable (MapLibre no corre en Expo Go).
Verificación visual por celular+cable (no emulador Expo Go). Cierra la migración de mapas de toda la app.

## 4. Pantallas Figma
Ninguna propia (es infra). Habilita los mapas de: RT-1.* `47:471/586/767`, RT-2.* `49:1857/2012`,
RT-3 `49:2185`, RT-4 `51:541`, RT-5 `51:915` (mini-map). El picker migrado se ve en `agenda/crear` y en
la sección de ubicación de `cliente/nuevo` + `cliente/[id]` (cliente y garantes).

## 5. Contrato (endpoints/tablas)
- Consume: `GET /api/routes`, `GET /api/routes/:id`, `POST /api/routes`, `POST /api/routes/generate`,
  `PATCH /api/routes/:id`, `PATCH /api/routes/:id/stops/:sid`, `GET /api/clients` (para coords).
- Tablas leídas: `route_plans`, `route_stops`, `clients`, `client_locations`. Sin tablas nuevas.
- Envelope `{data,meta,error}` vía `authedFetch`. Multi-tenant server-side (`accountId` del JWT).
- **Join de coords** (regla del módulo): `routes.service` resuelve `stop.clientId → client.location.{lat,lng}`
  usando `GET /api/clients`. No se toca el backend.

## 6. Auditoría de reuso (Paso B)
| Capacidad | Clasif. | Path / acción |
|---|---|---|
| HTTP autenticado (Bearer+refresh) | **REUSAR** | `src/api-client.ts` (`authedFetch`) — base de `routes.service` |
| Store de conectividad | **REUSAR** | `src/store/net.ts` (`useNetStore`) — gating de descarga de packs |
| Enums de dominio | **REUSAR** | `@kobrax/shared`: `RouteStatus`, `RouteStopStatus`, `VisitOutcome` (NUNCA redefinir) |
| Fundación UI (Header/Badge/Row/Sheet/Empty) | **REUSAR** | `src/ui.tsx` |
| GPS del dispositivo | **REUSAR** | `expo-location` (ya instalado y usado) |
| Permiso de ubicación | **REUSAR** | `app.json` plugin `expo-location` (ya declarado) |
| Config plugin / prebuild-ready | **REUSAR** | `plugins/with-ssl-pinning` ya existe → la app ya prevé prebuild |
| Picker de un punto (agenda) | **REEMPLAZAR** | `agenda/crear.tsx`: `react-native-maps` `MapView`→ `MapPicker` (MapLibre) |
| Ubicación cliente/garantes | **EXTENDER** | `cliente/nuevo.tsx` + `cliente/[id].tsx`: hoy sólo GPS-botón → agregar `MapPicker` visual |
| Motor de mapa react-native-maps | **ELIMINAR** | quitar dep `react-native-maps` (única lib = MapLibre) |
| **Canvas de mapa** (pins/polyline/controles) | **NUEVO** | `src/maps/MapCanvas.tsx` |
| **Picker de un punto** (draggable + GPS) | **NUEVO** | `src/maps/MapPicker.tsx` |
| **Mini-mapa estático** (RT-5) | **NUEVO** | `src/maps/MiniMapCard.tsx` |
| **Config de tiles/estilo** | **NUEVO** | `src/maps/tiles.ts` |
| **Servicio de packs offline** | **NUEVO** | `src/maps/offline-packs.service.ts` (MapLibre `OfflineManager`) |
| **Servicio de rutas** | **NUEVO** | `src/routes.service.ts` (list/get/generate/create/updateStatus/updateStop + join coords) |

> **Ubicación de lo nuevo:** los componentes de mapa son pesados y específicos de MapLibre → viven en un
> módulo `src/maps/` (no en `ui.tsx`, que se mantiene liviano). Regla de reuso: usados por ≥2 pantallas → compartidos. *[ponytail: `src/maps/` mantiene `ui.tsx` sin peso de MapLibre.]*

## 7. Artefactos nuevos (justificación + ubicación)
- `src/maps/MapCanvas.tsx` — mapa full con markers numerados, polyline de ruta, botones zoom/recenter. Usado por S2/S3/S4. **Props abstraen MapLibre** para poder cambiar de motor sin tocar screens.
- `src/maps/MapPicker.tsx` — selector de un punto (marker draggable + "usar mi ubicación"). Reemplaza el `MapView` de agenda y se agrega a cartera. Un solo picker para toda la app.
- `src/maps/MiniMapCard.tsx` — preview estático no-interactivo (RT-5 "Hora recomendada" + garante cercano).
- `src/maps/tiles.ts` — `MAP_STYLE_URL` / fuente de tiles + estilo (define la fuente elegida, ver ⏸️).
- `src/maps/offline-packs.service.ts` — `createPack(region,bounds,zoom)`, `listPacks()`, `deletePack()`, progreso de descarga. Envuelve `OfflineManager` de MapLibre.
- `src/routes.service.ts` — tipos `Route`/`Stop` + fetchers + `resolveStopCoords(stops, clients)`.

## 8. Tareas (orden: dep → nativo → componentes → migración → packs)
1. Instalar `@maplibre/maplibre-react-native`; remover `react-native-maps` del `package.json`.
2. `app.json`: plugin de MapLibre si aplica; confirmar permisos de ubicación (ya están).
3. `expo prebuild` (genera `android/`); `expo run:android` por cable → smoke de arranque.
4. `src/maps/tiles.ts` — fuente de tiles (según ⏸️ #1).
5. `src/maps/MapCanvas.tsx` + `MapPicker.tsx` + `MiniMapCard.tsx` (leen tokens de `theme.ts`).
6. **Migrar `agenda/crear.tsx`** a `MapPicker` (quitar `react-native-maps`). Smoke: crear agendado con ubicación.
7. **Extender `cliente/nuevo.tsx` + `cliente/[id].tsx`**: `MapPicker` en la sección de ubicación (cliente + garantes). Smoke: alta cliente con punto en mapa.
8. `src/routes.service.ts` (fetchers + join coords) — sin UI todavía; se consume desde S1+.
9. `src/maps/offline-packs.service.ts` + trigger de descarga (según ⏸️ #2).
10. Verificar: `type-check` + `jest` + `expo export --platform android` (o build dev por cable).

## 9. Reglas de la fase
- Las 3 de §3.3 del epic (sol→contraste, gama baja→UI thread, animación con propósito).
- **Un solo motor de mapas** post-fundación: `grep react-native-maps` debe dar 0 tras la migración.
- `MapCanvas`/`MapPicker` **abstraen MapLibre** (props neutrales) → un cambio de motor futuro no toca screens.
- Packs offline: descarga **sólo con conexión** (usar `useNetStore`), informar progreso, nunca bloquear.
- Tokens: sin colores nuevos sin agregarlos antes a `tokens.ts`/`theme.ts`.

## 10. DoD
- MapLibre renderiza en dev build por cable; `react-native-maps` eliminado (0 imports).
- `agenda/crear`, `cliente/nuevo`, `cliente/[id]` capturan ubicación con `MapPicker` (smoke real OK).
- `routes.service` devuelve rutas con coords resueltas (probado contra API 4010).
- `offline-packs.service` descarga un pack de región y el mapa renderiza **sin red** (smoke offline real).
- Verde: `type-check` + `jest` + export/build. Revisado con `/code-review` + `/ponytail-review`.
- Validación visual por la usuaria (celular+cable).

## 11. Decisiones cerradas (2026-07-15)
1. **Tile source = self-hosted en R2/S3.** Extractos regionales de OSM (planetiler/tilemaker) servidos desde el R2/S3 de Kobrax. `tiles.ts` apunta a esa URL; sin API key ni vendor lock. → **Dependencia externa (ops):** generar los extractos regionales y publicarlos en R2 es precondición para que los packs tengan datos. El servicio de packs se construye apuntando a esa URL; los extractos pueden generarse en paralelo. Sin extractos publicados, el smoke offline usa un extracto de prueba (una ciudad).
2. **Trigger de packs = acción "Descargar mapa de zona"** en la fundación de Rutas (visible al cobrador) **espejada en Ajustes/Más** (gestión: descargar/borrar/ver tamaño). Corre sólo con conexión (`useNetStore`), muestra progreso, no bloquea.
3. **Dev build = `expo prebuild` local + `expo run:android` por cable.** Sin EAS. Coincide con la verificación celular+cable.
4. **Optimización/ruteo → se resuelve en S3** con ruteo **real por calles** (decisión de la usuaria). ⚠ **Tensión offline a cerrar en S3:** ruteo por calles + offline no es trivial (API online rompe offline; on-device offline = motor pesado tipo Valhalla/GraphHopper, o self-host OSRM sincronizado con los mismos extractos R2). No es concern de la fundación; se ancla al planificar S3.

## ⏸️ Pendiente de confirmar
Ninguno para la fundación. (El motor de ruteo real de S3 se decide al planificar S3.)
