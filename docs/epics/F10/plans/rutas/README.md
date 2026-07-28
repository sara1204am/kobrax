> **ESTADO: EN BORRADOR — ronda 1 (2026-07-15). NO construir hasta PASS del validador.**
> Overview del módulo. Cada slice se detalla en su propio archivo just-in-time.

# F10 · Módulo RUTAS (móvil) — plan maestro

## Objetivo
Construir el módulo de Rutas de campo del cobrador: crear ruta desde mapa, previsualizar/optimizar,
ejecutar parada por parada sobre mapa, registrar resultado y cerrar jornada. **Fidelidad ~100% a los
mockups** `docs/epics/F10/figma/rutas/` (14 pantallas), normalizando tokens a la guía (CTA morado → navy).

## Decisiones de arranque (cerradas con la usuaria, 2026-07-15)
| # | Decisión | Implicancia |
|---|---|---|
| D-MAP | **MapLibre es la ÚNICA lib de mapas de la app.** Se elimina `react-native-maps` y se migran sus usos: `agenda/crear.tsx` y el picker de ubicación de **cliente/garantes** (`cliente/nuevo.tsx`, `cliente/[id].tsx`). | Un solo motor de mapas, offline-capable, FOSS, sin vendor lock. |
| D-BUILD | **Cruza la frontera de dev build AHORA** (`expo prebuild` + `expo run:android` por cable). MapLibre no corre en Expo Go. | Adelanta la frontera 🔵 que el BUILD-PLAN ponía en P6/P7. Verificación por celular+cable (no Expo Go). |
| D-OFFLINE | **Packs offline completos en esta etapa** (tiles por región descargables) atados al modelo de hidratación de oficina (§4.1). | Servicio de packs + trigger de descarga. Es lo que hace la operación 100% offline en zonas sin señal. |
| D-SPLIT | **Sub-planes `plans/rutas/`** (fundación + S1…S6), un plan por pantalla/slice, como cartera y agenda. | Módulo grande, iterable, funcional pantalla por pantalla. |
| D-REUSE | **RT-5/RT-6 reusan cartera** (gestión/pago/uploads-foto) **y agenda** (promesa). | La ficha de parada y el sheet de resultado NO se reconstruyen: converge lo ya hecho. |

## Contrato real (verificado contra código, 2026-07-15)
- **Rutas:** `POST /api/routes` · `POST /api/routes/generate` · `GET /api/routes` · `GET /api/routes/:id` · `PATCH /api/routes/:id {status}` · `PATCH /api/routes/:id/stops/:sid {status?,sequenceOrder?}`. Permisos: `ROUTE_READ/WRITE/ASSIGN/EXECUTE`.
- **Enums (shared/prisma):** `RouteStatus = PLANNED|IN_PROGRESS|COMPLETED|CANCELLED` · `RouteStopStatus = PENDING|IN_ROUTE|VISITED|SKIPPED` · `VisitOutcome = NO_CONTACT|CONTACTED|PROMISE_TO_PAY|PARTIAL_PAYMENT|PAID|REFUSAL|NOT_FOUND|RESCHEDULED`.
- **⚠ Coordenadas de parada — DECISIÓN SUPERADA POR S1 (2026-07-28).** `route_stops` sigue sin lat/lng, pero `serializeStop` **ya no devuelve sólo ids**: `GET /routes/:id` incluye al cliente y la parada trae `clientName` y `address` (ubicación primaria = primera `HOME`, si no la primera cargada), descifrada y con `route/PII_REVEAL` auditado. El join en el móvil contra `GET /clients` quedó descartado (obligaba a bajar la cartera entera y a repetirlo en S2/S3/S4). **Para el mapa falta sólo el par lat/lng: se suma por el mismo camino** (`select` de la location ya está en el `include`), no con un join en cliente. `resolveStopCoords` de la fundación queda sin uso si eso ocurre.
- **Visitas (RT-6):** `POST /api/visits {outcome, latitude, longitude, ...}` · `POST /api/visits/:id/evidence` (foto/hash → módulo `uploads` de cartera). `field_visits` es **append-only** (sólo INSERT).
- **Pago (RT-6 Cobrado):** `POST /api/payments {creditId,amount,method}` + header `Idempotency-Key` (mapea a `payments.idempotencyKey`, **no** `reference`).
- **Promesa (RT-6 Promesa):** vive en `agenda_items` (patrón cartera/agenda), **no** en un endpoint de rutas.

## Pantallas → slices (node-ids del ui-screen-map §4)
| Slice | Pantallas Figma (mockup · node-id) | Mapa | Reusa |
|---|---|---|---|
| **FUNDACION** | (infra, sin pantalla propia) | motor | — |
| **S1 · Estados de ruta** | RT-0a Sin ruta `46:4` · RT-0b Ruta activa `46:108` · RT-0c Ruta completada `46:282` | no | `ListRow`,`StatusBadge`,`StatTile`,`Header`,`EmptyState` |
| **S2 · Crear desde mapa** | RT-1.1 Selección vacío `47:471` · RT-1.2 +card `47:586` · RT-1.3 Crear cliente `47:767` | **sí** | `MapCanvas`,`MiniMapCard` + alta cliente de **cartera** |
| **S3 · Preview + confirmar** | RT-2.1 Preview `49:1857` · RT-2.2 Zigzag `49:2012` · RT-3 Confirmar `49:2185` | **sí** (polyline) | `MapCanvas`,`StatTile`,`ListRow` (reorder) |
| **S4 · Mapa activo + parada** | RT-4 Mapa activo `51:541` · RT-5 Detalle parada `51:915` | **sí** | `MapCanvas` + ficha de **cartera** |
| **S5 · Registrar resultado** | RT-6 Sheet variantes `51:676` | no | `BottomSheet` + pago/gestión/foto **cartera** + promesa **agenda** |
| **S6 · Resumen jornada** | RT-7 Resumen `51:1053` | no | `StatTile`,`ListRow` |
| — | Wrappers a ignorar: `Edit ruta 50:404`, `Group 1 48:1427`, `Group 2 49:1854` | — | — |

## Orden de construcción
`FUNDACION` (motor de mapas + dev build + packs offline + services) → `S1` → `S2` → `S3` → `S4` → `S5` → `S6`.
Cada slice: rama `f10/rutas-<slice>`, verificación (`type-check`+`jest`+`expo export`) + `/code-review` + `/ponytail-review` + validación visual por cable, merge a `main` limpio (workflow BUILD-PLAN §2).

## Reglas del módulo (además de §3.3 del epic)
- CTA morado del Figma → **navy** (design-system §2). Purple sólo acento/estado.
- Sol → contraste (monto/mora/nombre en navy); gama baja → animación sólo UI thread (Reanimated); animación con propósito.
- Mapa en gama baja: limitar pins renderizados, sin re-render por frame; recenter/zoom en UI thread.
- Nada de ramificar por `tenantType`. Multi-tenant vía `accountId` (ya en el contrato).

## Decisiones cerradas (2026-07-15) — ver detalle en `FUNDACION.md §11`
- **Tiles = self-hosted en R2/S3** (extractos OSM regionales, sin key/lock). Precondición ops: generar/publicar extractos.
- **Trigger de packs** = acción "Descargar mapa de zona" en Rutas + espejo en Ajustes/Más.
- **Dev build** = `expo prebuild` local + `run:android` por cable.
- **Ruteo = real por calles** (no haversine) → se ancla el motor al planificar **S3** (⚠ tensión con offline: ver FUNDACION §11.4).

## Riesgo abierto (para S3, no bloquea la fundación)
- **Motor de ruteo real + offline:** API online rompe offline; on-device (Valhalla/GraphHopper) es pesado; OSRM self-host puede compartir los extractos de R2. Se decide al planificar S3.
