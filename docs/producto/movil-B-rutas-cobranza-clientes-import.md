# App móvil del cobrador · Parte B — Rutas, Cobranza, Clientes, Importación y Offline

> Documentación funcional pantalla por pantalla. Fuente: **código real** de `apps/mobile` (Expo Router) y, donde hace falta saber quién puede qué, `packages/shared` y `apps/api`. Los documentos `docs/epics/F10/**` se usaron solo de apoyo; las contradicciones con el código están en la sección «Contradicciones documento ↔ código».
> Fecha de relevamiento: 2026-10-09. Rama de trabajo: `docs/movil-alineacion-web` (working tree con cambios sin commitear en `apps/mobile`: lo documentado es lo que hay en disco).
> Leyenda de **Estado**: ✅ funciona como diseñado según el código · 🟡 funciona con huecos/limitaciones señaladas · 📝 solo existe como plan/servicio sin pantalla.
> «No verificado» = deducido de leer código, sin ejecutarlo en un teléfono.

---

## Índice

0. [Convenciones y reglas comunes](#0-convenciones-y-reglas-comunes)
1. [Rutas](#1-rutas)
   - 1.1 [Rutas (pestaña) — `/(tabs)/rutas`](#11-rutas-pestaña--tabsrutas)
   - 1.2 [Crear ruta desde el mapa — `/rutas/crear`](#12-crear-ruta-desde-el-mapa--rutascrear)
   - 1.3 [Vista previa de la ruta — `/rutas/preview`](#13-vista-previa-de-la-ruta--rutaspreview)
   - 1.4 [Confirmación — `/rutas/confirmar`](#14-confirmación--rutasconfirmar)
   - 1.5 [Mapa de ruta (activo) — `/rutas/mapa`](#15-mapa-de-ruta-activo--rutasmapa)
   - 1.6 [Registrar resultado de la parada — `/rutas/resultado`](#16-registrar-resultado-de-la-parada--rutasresultado)
   - 1.7 [Resumen de jornada — `/rutas/resumen`](#17-resumen-de-jornada--rutasresumen)
   - 1.8 [Evidencia: foto, GPS y hash (transversal a Rutas y Cobranza)](#18-evidencia-foto-gps-y-hash)
   - 1.9 [Mapas MapLibre (componentes y packs offline)](#19-mapas-maplibre)
2. [Cobranza](#2-cobranza)
   - 2.1 [Cobranza / Cartera (pestaña) — `/(tabs)/cobranza`](#21-cobranza--cartera-pestaña--tabscobranza)
   - 2.2 [Ficha de mora — `/mora/[creditId]`](#22-ficha-de-mora--moracreditid)
   - 2.3 [Hoja «Registrar gestión» (incluye promesa)](#23-hoja-registrar-gestión-incluye-promesa)
   - 2.4 [Hoja «Nota del crédito»](#24-hoja-nota-del-crédito)
   - 2.5 [Hoja «Registrar pago» y «Mostrar mi QR»](#25-hoja-registrar-pago-y-mostrar-mi-qr)
3. [Clientes y préstamos](#3-clientes-y-préstamos)
   - 3.1 [Ficha de cobranza del cliente — `/cliente/[id]`](#31-ficha-de-cobranza-del-cliente--clienteid)
   - 3.2 [Nuevo cliente — `/cliente/nuevo`](#32-nuevo-cliente--clientenuevo)
   - 3.3 [Detección de duplicados](#33-detección-de-duplicados)
   - 3.4 [Editar cliente (y crédito) — `/cliente/editar`](#34-editar-cliente-y-crédito--clienteeditar)
   - 3.5 [Dónde queda el cliente — `/cliente/mapa`](#35-dónde-queda-el-cliente--clientemapa)
   - 3.6 [Nuevo préstamo — `/prestamo/nuevo`](#36-nuevo-préstamo--prestamonuevo)
4. [Importación móvil](#4-importación-móvil)
   - 4.1 [Gate de importación — `/import`](#41-gate-de-importación--import)
   - 4.2 [Elegir archivo — `/import/archivo`](#42-elegir-archivo--importarchivo)
   - 4.3 [Vista previa de importación — `/import/preview`](#43-vista-previa-de-importación--importpreview)
   - 4.4 [Resultado — `/import/resultado`](#44-resultado--importresultado)
   - 4.5 [Ajustes › Importación — `/ajustes/importacion`](#45-ajustes--importación--ajustesimportacion)
   - 4.6 [Emparejar columnas — `/ajustes/importacion-columnas`](#46-emparejar-columnas--ajustesimportacion-columnas)
   - 4.7 [Historial de importaciones — `/ajustes/importacion-historial`](#47-historial-de-importaciones--ajustesimportacion-historial)
   - 4.8 [Detalle de una corrida — `/ajustes/importacion-corrida`](#48-detalle-de-una-corrida--ajustesimportacion-corrida)
5. [Offline y sincronización (transversal)](#5-offline-y-sincronización)
   - 5.1 [Pantalla «Sin subir» — `/pendientes`](#51-pantalla-sin-subir--pendientes)
   - 5.2 – 5.10 Mecanismo completo
6. [Contradicciones documento ↔ código](#6-contradicciones-documento--código)
7. [Hallazgos y riesgos detectados](#7-hallazgos-y-riesgos-detectados)
8. [No verificado](#8-no-verificado)

---

## 0. Convenciones y reglas comunes

**Quién puede usar la app móvil.** Solo los roles `ACCOUNT_ADMIN`, `SUPERVISOR` y `COLLECTOR` son «roles móviles» (`MOBILE_ROLES` en `packages/shared/src/constants/roles.ts`; el servidor lo impone al asignar rol en `users.service.ts`). La app **no oculta pantallas por rol**: todas las pestañas y botones se ven igual y el servidor responde 403 si falta el permiso. Excepciones con lógica propia en el cliente: `canAssign` (editar notas ajenas) y `viewer.canConfigure` (configurar la importación).

**Permisos relevantes** (según `ROLE_PERMISSIONS`, `packages/shared/src/constants/permissions.ts`; los overrides por usuario en DB pueden cambiarlo):

| Capacidad | COLLECTOR | SUPERVISOR | ACCOUNT_ADMIN |
|---|---|---|---|
| Ver rutas / usar `/routes`, `/visits` (puerta `route:read`) | sí | sí | sí |
| Ejecutar ruta propia (`route:execute`) | sí | **no** (tiene `route:assign` + `route:write`) | sí (todos los permisos salvo `audit:read`) |
| Cobranza: leer / escribir gestiones y notas (`collection:read/write`) | sí | sí | sí |
| Registrar pagos (`payment:write`) | sí | sí | sí |
| Alta/edición de clientes (`client:write`) | sí | **no** (solo `client:read`) | sí |
| Alta de préstamos (`credit:write`) | sí | **no** | sí |
| Importar cartera (`client:import`) | sí | sí | sí |
| Reparte cartera (`assignment:write`) → puede configurar la importación | no (salvo que sea dueño de la cuenta) | sí | sí |
| Leer la cuenta `GET /accounts/me` (`account:read`) | **no** | no | sí |

**Idempotencia.** Toda escritura repetible lleva un `id` generado por el teléfono (`nuevoId()`, UUID v4 sobre `Math.random`, `src/ids.ts`) fijado **al abrir la pantalla/hoja**, o una `Idempotency-Key` en pagos. Por eso un reintento (doble toque, timeout, cola) no duplica.

**Resultado de una llamada** (`src/api-client.ts`): `ok` / `offline` (sin red **o** timeout de 15 s; en subidas 60 s) / `unauthenticated` / `error` (con `httpStatus`). `offline` con `reason: 'timeout'` significa «resultado desconocido, el pedido pudo haber llegado».

**Estados de pantalla repetidos:** cargando (spinner), «Sin conexión» (📴, solo cuando no hay copia local), «No se pudo cargar» (⚠️). Un fallo de red al refrescar **no borra** lo que ya estaba en pantalla.

**Banner global** (`OfflineIndicator`, montado en `app/_layout.tsx`): rojo «Sin conexión · N pendientes de sync» sin red; ámbar «Subiendo · N pendientes» con red y cola no vacía; tocable (lleva a `/pendientes`) si hay pendientes. Pantalla de «actualizá la app» (`UpgradeGate`) cubre todo ante un 426.

---

## 1. Rutas

Modelo: una **ruta** = un día de un cobrador, con **paradas** (una parada = un crédito + su cliente). Estados de ruta `PLANNED → IN_PROGRESS → COMPLETED` (o `CANCELLED`), de parada `PENDING | IN_ROUTE | VISITED | SKIPPED`. API: `GET/POST /routes`, `POST /routes/generate`, `PATCH /routes/:id`, `GET /routes/:id/preview`, `POST /routes/:id/optimize`, `POST/DELETE/PATCH /routes/:id/stops[/sid]`. Servicio móvil: `src/routes.service.ts`.

Flujo feliz: **Rutas** → (Generar ruta del día | Crear desde el mapa) → **Vista previa** → **Confirmación** → **Mapa de ruta** → (por parada) **Registrar resultado** → **Resumen de jornada**.

### 1.1 Rutas (pestaña) — `/(tabs)/rutas`
Archivo: `apps/mobile/app/(tabs)/rutas.tsx`.

- **Propósito:** ver la ruta de hoy en tres estados (sin ruta, en curso, finalizada) y lanzar la acción del día.
- **Quién accede:** cualquier rol móvil con sesión (puerta de API `route:read`). Siempre trabaja con **su propia** ruta: pide `GET /routes?collectorId=<yo>` y busca la de la fecha de hoy (`plannedDate` truncado a `YYYY-MM-DD`; el filtro de fecha se hace en el teléfono, no con `?date=`).
- **Qué muestra:**
  - Fecha larga de hoy.
  - **Sin ruta** (`SinRuta`): ícono 🗺️, «Sin ruta para hoy», botones «Generar ruta del día» y «Crear desde el mapa».
  - **En curso/planificada** (`RutaEnCurso`): tarjeta «Ruta del día» con insignia de estado (Planificada / En curso), barra «Progreso de ruta» (% = paradas VISITED+SKIPPED / total), tiles *Visitas n/N*, *Pendientes*, *Cobrado* (verde si > 0), botón «Iniciar ruta» (si PLANNED) o «Continuar ruta» (si IN_PROGRESS), botón «Agregar paradas en el mapa», y tarjeta oscura **«SIGUIENTE PARADA»** (primera `PENDING`) con nombre, dirección y «Ver cliente ›».
  - **Finalizada/Cancelada** (`RutaFinalizada`): ✅ «¡Ruta finalizada!» o 🚫 «Ruta cancelada», tiles Visitas y Cobrado y botón «Ver resumen de la jornada».
  - Lista **«PARADAS (n)»**: `n. Cliente` + subtítulo «Visita agendada · dirección» + insignia de estado (Pendiente / En camino / Visitada / Omitida). Vacía: «Ruta sin paradas — Generá la ruta de nuevo para cargar tus casos». En jornada cerrada las filas no son tocables.
  - Pull-to-refresh y recarga al enfocar.
- **Acciones:**
  - «Generar ruta del día» → `POST /routes/generate {id, collectorId, plannedDate: hoy}` (sin `creditIds`: el servidor toma los **créditos en mora** del cobrador por prioridad del episodio y suma sus visitas agendadas del día). El `id` es fijo hasta que salga bien (un reintento no crea otra). Errores del servidor se muestran en rojo y **se recarga igual** (caso `ROUTE_DUPLICATE_DAY`: la ruta existe y se muestra). Si no hay nada que armar el servidor contesta `ROUTE_EMPTY` («No tenés casos abiertos para armar la ruta de hoy» — texto con residuo de la palabra «casos»).
  - «Crear desde el mapa» → `/rutas/crear`. «Agregar paradas en el mapa» → `/rutas/crear` (ver hallazgo H-3).
  - «Iniciar ruta» → `/rutas/preview?routeId=`. «Continuar ruta» → `/rutas/mapa?routeId=`.
  - «Siguiente parada» / fila de parada → `/cliente/<clientId>`.
  - «Ver resumen de la jornada» → `/rutas/resumen?routeId=`.
- **Comportamiento offline:** **lectura disponible** (lista de rutas y detalle con caché `route`); si no hay copia → «Sin conexión — Tu ruta aparecerá cuando vuelva la red». **«Generar ruta del día» es solo online** (sin conexión muestra «Sin conexión. Reintentá cuando vuelva la red.»; no se encola). El monto «Cobrado» sale de `GET /payments` del día (caché `payment`); **no incluye pagos que todavía están en la cola**.
- **Datos:** `GET /auth/me` (o `me` local), `GET /routes?collectorId=`, `GET /routes/:id`, `GET /payments?from=&to=&limit=100`, `POST /routes/generate`.
- **Navegación:** entra desde el tab bar, desde `router.replace('/(tabs)/rutas')` (confirmar, resumen). Sale a crear, preview, mapa, resumen, ficha de cliente.
- **Estado:** ✅ (con observación H-3 y la advertencia de que el detalle de una ruta `PLANNED` no se hidrata, ver §5.5).

### 1.2 Crear ruta desde el mapa — `/rutas/crear`
Archivo: `app/rutas/crear.tsx`; lógica en `src/route-draft.ts`, `route-candidates.ts`, `route-days.ts`.

- **Propósito:** armar el recorrido tocando pines sobre el mapa; funciona igual sin señal porque trabaja sobre un **borrador local**.
- **Quién accede:** cualquier rol móvil; la API (`POST /routes`, `POST /routes/:id/stops`) usa la puerta `route:read` y decide por capacidad en el service (el cobrador arma la suya).
- **Qué muestra:**
  - Selector horizontal de **día**: hoy y los próximos 14 (`ROUTE_MAX_DAYS_AHEAD = 14`); un punto marca los días que ya tienen ruta. Parámetro `?date=` opcional (válido si es hoy..+14).
  - Aviso «Ya tenés una ruta armada para este día: la ves en la pestaña Rutas» si el día está ocupado y no hay borrador con ruta.
  - **Mapa** con un pin **por ubicación** (casa, trabajo, garante, familiar; un cliente puede aportar varios). Color: morado = ya en el recorrido (con su número), verde = con mora, azul marino = otro. Tocar un lugar **sin pin** abre `/cliente/nuevo?lat=&lng=`.
  - Franja ámbar «N clientes sin ubicación cargada ›» → hoja con la lista; tocar uno abre `/cliente/editar?clientId=`.
  - Tarjeta del pin elegido: nombre, de quién es el punto («Casa», «Casa de Luis Vargas (garante)»), dirección, monto (rojo si hay mora), insignia de estado y botón **Agregar al recorrido / Quitar**.
  - Barra inferior «Ver el recorrido · N paradas» → hoja **«El recorrido»** con ↑ ↓ ✕ por parada y botón «Ver el recorrido en el mapa».
  - Insignia «Sin sincronizar» en el header si hay cambios sin subir.
- **Acciones y reglas:**
  - Candidatas: `GET /mora?limit=100` (solo créditos **en mora**, ya acotados al cobrador; **una candidata por crédito**, un cliente con dos créditos aporta dos paradas). No aparecen clientes al día ni más de 100.
  - Cada toque cambia el borrador (`withStop`/`withoutStop`/`moveStop`), lo guarda y, si hay red y sesión, lo **sincroniza por diferencia** contra el servidor (`flushDraft`: crea la ruta con `createId` persistido si no existe, quita paradas sobrantes, agrega las faltantes, reordena). Las paradas ya visitadas/omitidas no se tocan.
  - «Agregar al recorrido» queda **deshabilitado** si el día ya tiene ruta y el borrador local no conoce su `routeId`.
  - «Ver el recorrido en el mapa» exige `draft.routeId` (ruta ya creada en el servidor) → `/rutas/preview?routeId=`.
- **Comportamiento offline:** **disponible y encolado como borrador** (no entra a la cola de acciones). El borrador vive en SecureStore por usuario y día; se reintenta solo en cada drenaje del motor de sync (`flushPendingDrafts`). Sin red no se puede abrir la vista previa de una ruta que todavía no existe en el servidor. Con la cartera no cacheada y sin red: «Sin conexión — Tu cartera aparece cuando vuelva la red». El borrador se **descarta** al cerrar sesión o cambiar de usuario, y los borradores de días pasados sin ruta creada se borran (el servidor rechaza con `ROUTE_PAST_DATE`).
- **Datos:** `GET /routes?collectorId=`, `GET /mora?limit=100` (caché `mora`, scope `route-plan:`), `POST /routes`, `GET /routes/:id`, `POST/DELETE/PATCH /routes/:id/stops`.
- **Navegación:** desde Rutas; sale a preview, `/cliente/nuevo`, `/cliente/editar`.
- **Estado:** 🟡 — funciona, con las restricciones anotadas (solo mora, tope 100, no agrega a rutas generadas por el servidor, ver H-3).

### 1.3 Vista previa de la ruta — `/rutas/preview`
Archivo: `app/rutas/preview.tsx`; `src/route-eta.ts`.

- **Propósito:** ver el recorrido dibujado, medido y confirmar/iniciar la jornada.
- **Quién accede:** quien tenga la ruta a su alcance (puerta `route:read`; scope en el service).
- **Qué muestra:** mapa (240 px) con pines numerados y polilínea; tiles **PARADAS / DISTANCIA / DURACIÓN** (`—` si no hay dato); si el servidor sugiere un orden mejor, aviso «⚠️ Recorrido poco eficiente. Estás recorriendo X km extra. Podés ahorrar N min optimizando la ruta» con **Optimizar / Ignorar**; leyenda «No se pudo calcular el recorrido por las calles. Se muestra en línea recta; podés iniciar la ruta igual» si falló el cálculo; lista **«SECUENCIA DE PARADAS»** con la hora estimada (`clockAt` desde el momento en que se abrió la pantalla + `etaMinutes`).
- **Acciones:**
  - **Optimizar** → `POST /routes/:id/optimize` (aplica el orden sugerido) y recarga. Sin red: «Sin conexión: no se puede reordenar ahora».
  - **Ignorar** oculta el aviso (solo en memoria).
  - **«Confirmar e iniciar ruta →»** → `PATCH /routes/:id {status: IN_PROGRESS}`; deshabilitado con 0 paradas. Si no hay red, **la jornada arranca igual y el cambio se encola** (`route.status`); luego `router.replace('/rutas/confirmar')`. Si el servidor rechaza (p. ej. `ROUTE_TRANSITION`) muestra el mensaje y no avanza.
- **Comportamiento offline:** **degrada**: la ruta sale de caché; la geometría por calles (`GET /routes/:id/preview`) necesita red → se dibuja con rectas entre las paradas con punto y los números salen vacíos. Iniciar funciona (encolado). Optimizar es **solo online**.
- **Datos:** `GET /routes/:id`, `GET /routes/:id/preview`, `POST /routes/:id/optimize`, `PATCH /routes/:id`.
- **Navegación:** desde Rutas («Iniciar ruta») y Crear («Ver el recorrido en el mapa»); va a `/rutas/confirmar`.
- **Estado:** ✅

### 1.4 Confirmación — `/rutas/confirmar`
Archivo: `app/rutas/confirmar.tsx`.

- **Propósito:** cerrar el arranque de la jornada y dejar al cobrador parado en la primera visita.
- **Quién accede:** igual que 1.3.
- **Qué muestra:** 🚀 «¡Todo listo para iniciar!», tiles CLIENTES / RECORRIDO / ESTIMADOS (de `totalCases`, `totalDistanceKm`, `estimatedMinutes` de la ruta), tarjeta **SIGUIENTE PARADA** (primera `PENDING`) con «📍 Navegar» y «📞 Llamar», y lista «PARADAS PENDIENTES (n)». Sin pendientes: «Sin paradas pendientes — Todas las visitas de hoy están resueltas».
- **Acciones:** «Navegar» abre **`/cliente/mapa`** (mapa propio de Kobrax, no Google Maps); «Llamar» abre `tel:` con el primer contacto con valor (deshabilitado si no hay); fila de parada → `/cliente/<id>`; «Ir al mapa de la ruta» → `/rutas/mapa` (replace); «Ver mi ruta» → pestaña Rutas. No cambia estados: la ruta ya pasó a `IN_PROGRESS` (o quedó encolada).
- **Comportamiento offline:** disponible con caché (`route`, `client.context` para el teléfono). Error «Sin conexión.» si no hay copia de la ruta.
- **Datos:** `GET /routes/:id`, `GET /agenda/clients/:id/context`.
- **Navegación:** desde preview; sale a mapa de ruta, Rutas, ficha de cliente, mapa de cliente.
- **Estado:** ✅

### 1.5 Mapa de ruta (activo) — `/rutas/mapa`
Archivo: `app/rutas/mapa.tsx`.

- **Propósito:** ejecutar la jornada parada por parada sobre el mapa.
- **Quién accede:** igual que 1.3.
- **Qué muestra:** barra «Ruta con ZIGZAG ACTIVA» si el cálculo todavía sugiere reordenar; mapa con pines numerados (verde = visitada, morado = seleccionada, azul = pendiente) y la polilínea; **tarjeta de parada** (`StopCard`): cliente, dirección, tiles «MONTO EN MORA» (solo con monto **y** moneda) y «DÍAS DE MORA», botón principal **«Registrar resultado →»**, «📞 Llamar» y «Ver detalle». Con todas las paradas resueltas: «¡Terminaste tus paradas!» + «Ver resumen de la jornada». Sin paradas con punto: «Ruta sin paradas ubicadas».
- **Acciones:** tocar un pin selecciona y carga el teléfono del cliente; «Registrar resultado» → `/rutas/resultado?routeId=&stopId=`; «Ver detalle» → `/cliente/<id>?routeId=&stopId=` (la ficha muestra «Hora recomendada» y «Garantes cerca»); «Llamar» → `tel:`. Controles +/−/recentrar.
- **Comportamiento offline:** disponible con caché; sin red la línea es recta y el aviso de zigzag no se calcula. **Importante:** el estado de una parada registrada sin señal **no se actualiza localmente** hasta que la cola suba la visita (ver H-1).
- **Datos:** `GET /routes/:id`, `GET /routes/:id/preview`, `GET /agenda/clients/:id/context`.
- **Navegación:** desde Rutas/Confirmar/Resultado; sale a Resultado, ficha de cliente, Resumen.
- **Estado:** ✅ (con H-1).

### 1.6 Registrar resultado de la parada — `/rutas/resultado`
Archivos: `app/rutas/resultado.tsx`, reglas en `src/visit-result.ts`, red en `src/field.service.ts`.

- **Propósito:** cerrar la parada. Toda variante termina en **una visita** (`POST /visits`, append-only) que marca la parada `VISITED` y deja la gestión en la bitácora del crédito; Cobrado y Promesa escriben además en pagos y agenda.
- **Quién accede:** el cobrador dueño de la ruta (`route:execute`) o quien administra rutas (`route:assign`/`route:write`; registraría «a nombre de» el cobrador y la coordenada queda marcada estimada). Sin ninguno → 403 `AUTH_002`. La parada debe pertenecer a la ruta; ruta cancelada → `VISIT_ROUTE_CANCELLED`.
- **Qué muestra:** «Cliente · debe {monto en mora}», rejilla **«¿Qué pasó?»** con 6 variantes, banner de error/aviso, campos propios de la variante, campo «Observación» y botón con el texto de la variante.

**Variantes (`VISIT_VARIANTS`):**

| Variante | Resultado enviado (`outcome`) | Campos | Se habilita «guardar» cuando… | Efectos adicionales |
|---|---|---|---|---|
| ✅ Cobrado — «Confirmar cobro» | `PAID`, o `PARTIAL_PAYMENT` si el monto no cubre el monto en mora (tolerancia 0,005) | Monto cobrado, Método (Efectivo/QR/Transf.; QR muestra «Mostrar mi QR»), Foto del comprobante (opcional) | monto > 0 y ≤ tope (tope = **monto en mora de la parada**; sin tope si el crédito es de fuente externa/PSF) | `POST /payments` con `Idempotency-Key = visit-<id de la visita>`, `receiptUrl/receiptHash` si hay foto |
| 🤝 Promesa de pago — «Registrar promesa» | `PROMISE_TO_PAY` | Monto prometido, Fecha de compromiso (calendario) | monto > 0 y fecha `YYYY-MM-DD` | Crea ítem de agenda `PROMISE_TO_PAY` (franja mañana, `LAPSE`), método fijo `CASH`; texto «Se agendará un recordatorio el día anterior» |
| 📵 No contesta — «Registrar» | `NO_CONTACT` | Canal intentado: Llamada / Puerta (default Llamada) | siempre | `details = {channel}` |
| 🚶 Visita sin contacto — «Finalizar visita» | `NO_CONTACT` | Switch «Aviso de cobro dejado», «Subir foto del domicilio» (opcional) | siempre | `details = {channel:'DOOR', noticeLeft}` |
| 📍 Dirección incorrecta — «Reportar error» | `WRONG_ADDRESS` | Observación **obligatoria** | notas no vacías | — |
| ✳️ Gestión especial — «Guardar gestión» | `SPECIAL` | Categoría (catálogo `SPECIAL_CATEGORY` del tenant) | `categoryCode` elegido (no vacío, ≤ 50) | `details = {categoryCode}`; el servidor verifica que exista y esté activa |

- **Reglas de envío (en orden):**
  1. **GPS nunca bloquea**: `currentLocation()` (permiso en primer plano, precisión *Balanced*). Sin permiso/GPS apagado/sin fijar → usa lat/lng de la parada y marca `gpsFallback = true`. Solo si tampoco hay ubicación de la parada falla con «No se pudo obtener la ubicación y la parada no tiene una cargada. Activá el GPS para registrar». El servidor además deriva «GPS estimado» (coincide exactamente con el punto de la parada, o carga a nombre de otro, o desde web). **No hay validación de distancia** a la parada.
  2. `createVisit` con `id` fijo (`useRef` al abrir la pantalla) → un reintento devuelve la visita ya creada. Una parada ya visitada rechaza con `VISIT_STOP_DONE` (corregir = nueva visita con `correctsVisitId`; la app **no** ofrece corregir).
  3. **Sin red**: se encola **una sola acción `visit`** con la visita, la foto (copiada a disco durable), el pago y la promesa; se vuelve al mapa. Las partes que fallen después de que la visita salió se **re-encolan como ítems propios** (`visit.evidence`, `payment` con la misma llave, `agenda.create`).
  4. **Con red**: tras la visita, sella la foto (`POST /visits/:id/evidence`), cobra y agenda. Lo que falle se **encola** (aunque el fallo sea un 4xx: acabará «Rechazado» en Pendientes). Si algo quedó pendiente o perdido la pantalla **se queda** mostrando el aviso («La visita quedó registrada; … quedó guardado en el teléfono y se sube solo…» / «…pero el pago NO se guardó. Anotalo y avisá a tu supervisor») y el botón pasa a «Volver a la ruta».
- **Comportamiento offline:** **encolado** (`visit` + partes). La foto con red se sube al sacarla; sin red queda local y viaja en la cola. Sin sesión (`getUserId` vacío) no se puede encolar: «No se pudo guardar en el teléfono. Reintentá con señal».
- **Datos:** `GET /routes/:id` (caché), catálogo `SPECIAL_CATEGORY`, `POST /uploads`, `POST /visits`, `POST /visits/:id/evidence`, `POST /payments`, `POST /agenda`.
- **Navegación:** desde Mapa de ruta; vuelve con `router.replace('/rutas/mapa')`.
- **Estado:** ✅ (observaciones H-1, H-2, H-4: tope por monto en mora, método de promesa fijo en efectivo, no hay corrección de visita).

### 1.7 Resumen de jornada — `/rutas/resumen`
Archivo: `app/rutas/resumen.tsx`; cuentas en `packages/shared/src/utils/route-day.ts` (`summarizeDay`).

- **Propósito:** cerrar el día: cuánto se recaudó, cuántas paradas se completaron y cómo terminaron.
- **Quién accede:** quien tenga la ruta a su alcance.
- **Qué muestra:** «TOTAL RECAUDADO HOY» (suma de pagos del día **cuyo `creditId` pertenece a paradas de esta ruta**), «Progreso de visitas n de N completadas» + barra, fecha, tarjetas **RESULTADOS POR CATEGORÍA** (Cobrados = PAID/PARTIAL; Promesas; No contesta = NO_CONTACT; Inubicables = NOT_FOUND/WRONG_ADDRESS; Otros = resto) solo con conteo > 0, y «PRÓXIMAS ACCIONES»: «Ver lo que falta subir» (→ `/pendientes`) y «Revisar ruta de mañana» (→ pestaña Rutas). El avance cuenta paradas con resultado (`lastOutcome`) que **vino del servidor**.
- **Acciones:** **«Finalizar y Cerrar Jornada →»**:
  - sin paradas pendientes → `PATCH /routes/:id {status: COMPLETED}` directo;
  - con pendientes → pide **motivo** (5–500 caracteres, `isValidReason`); las paradas quedan «saltadas» y el motivo en la bitácora de la ruta; «Cerrar jornada» deshabilitado hasta que el texto sea válido; «Volver».
  - Sin red **o con sesión vencida**, el cierre se **encola** (`route.status` con su motivo) y se vuelve a Rutas. Con jornada ya cerrada solo muestra «Esta jornada ya está cerrada».
- **Comportamiento offline:** lectura con caché; cierre **encolado**. Sin copia de la ruta: «Sin conexión.» El total recaudado sale de caché de pagos; no incluye cobros aún en cola (H-1).
- **Datos:** `GET /routes/:id`, `GET /payments?from=&to=`, `PATCH /routes/:id`.
- **Navegación:** desde Rutas (jornada cerrada) y Mapa («Ver resumen»); vuelve a Rutas.
- **Estado:** ✅

### 1.8 Evidencia: foto, GPS y hash

Resumen de qué se captura y qué exige cada flujo (todo verificado en código):

| Evidencia | Dónde | ¿Obligatoria? | Detalle |
|---|---|---|---|
| **GPS de la visita** | Registrar resultado | Siempre se envía lat/lng/`accuracy`; **nunca bloquea** (fallback a la parada) | `src/location.ts`; `POST /visits` exige coordenadas válidas (`VISIT_GPS`) |
| **Foto del comprobante** | Cobrado (resultado), hoja «Registrar pago» | **No** | Se comprime y sube; el pago lleva `receiptUrl` + `receiptHash` |
| **Foto del domicilio** | Visita sin contacto | **No** | Se sella como evidencia `PHOTO` contra la visita |
| **Fotos de ubicación del cliente** | Formulario de cliente (alta/edición) | No | Solo online (sube con `POST /uploads` al elegirla) |
| **Firma** | — | — | **No existe en el móvil** (el endpoint acepta `SIGNATURE`, la app solo manda `PHOTO`) |

- **Captura** (`src/photo.ts`): alerta «Agregar foto» → Cámara / Galería (`expo-image-picker`, calidad 0.5; pide permiso). Se **reduce antes de guardar/subir**: lado largo ≤ 1280 px, ≤ 800 KB, escalones de calidad 0.7 → 0.55 → 0.4 (`photo-compress.ts`); si la compresión falla sigue la original. Si ya hay ≥ 150 MB de fotos pendientes (`PENDING_PHOTOS_MAX_BYTES`) se bloquea la **nueva** con «Hay muchas fotos sin subir…» (lo ya guardado jamás se borra).
- **Hash:** el móvil **no calcula SHA-256**. `POST /uploads` (multipart, timeout 60 s) devuelve `{url, hash}` calculado por el servidor sobre el archivo recibido (ya comprimido) y nombra el archivo por ese hash; el móvil reenvía ese hash al sellar la evidencia (`addVisitEvidence` manda `fileUrl` + `fileHash`, sin `content`, así que el servidor no vuelve a verificarlo contra bytes en este camino). Ver contradicción C-2.
- **Inmutabilidad:** `field_visits` es append-only; la evidencia repetida (mismo hash en la misma visita) devuelve la existente.
- **Offline:** la foto se copia a `documentDirectory/queue-photos/` al encolar (el caché de la cámara puede vaciarse); se borra al subir bien o al descartar el ítem. Si el archivo desaparece antes de subir, nace un aviso `photo.lost` (rechazado, visible hasta que se descarta); un **cobro sale igual sin comprobante**.

### 1.9 Mapas MapLibre
Archivos `src/maps/*`.

- **Componentes:** `MapCanvas` (pines numerados por tono, polilínea, controles +/−/recentrar, toque en mapa vacío), `MapPicker` (marcar/arrastrar UN punto; lo usa el formulario de cliente en modo «Mapa»), `MiniMapCard` (mapa estático no interactivo; garantes cerca en la ficha desde una ruta).
- **Fuente de tiles:** `EXPO_PUBLIC_MAP_STYLE_URL` (self-hosted) o, si falta, **raster público de OpenStreetMap solo para desarrollo** (su política prohíbe producción/descarga masiva). Centro por defecto: Santa Cruz (-17.7833, -63.1821), zoom 13 / pin 16.
- **Packs offline:** `offline-packs.service.ts` y `pack-budget.ts` existen (radio 10 km, zoom 10–15, máx. 1 500 tiles, máx. 3 regiones, estimación 14 MB por pack, exige `MAP_STYLE_URL`) pero **ninguna pantalla los invoca** (no hay botón «Descargar mapa de zona» ni gestión en Ajustes/Más). 📝 Solo servicio + plan.
- **Requiere dev build:** MapLibre no corre en Expo Go. El mapa necesita red para tiles salvo que haya pack descargado (no hay forma de descargarlo desde la app hoy).
- **Estado:** componentes ✅ · packs 📝.

---

## 2. Cobranza

Todo es **por crédito** (no hay «caso»). Servicio: `src/mora.service.ts` (`GET /mora`, `/mora/:creditId`, `/promises`, `/notes`, `/episodes`, `/metrics`, `POST /mora/:creditId/activities` y `/notes`).

### 2.1 Cobranza / Cartera (pestaña) — `/(tabs)/cobranza`
Archivo: `app/(tabs)/cobranza.tsx`; lógica pura `src/portfolio.ts`, `src/mora.ts`.

- **Propósito:** ver la cartera del cobrador por cliente (deuda agregada) y la lista de créditos en mora, buscar y filtrar.
- **Quién accede:** cualquier rol móvil (`collection:read`). El servidor acota por alcance: responsable, **reemplazo temporal** o **apoyo** (cobrador); supervisor = su agencia.
- **Qué muestra:** título «Cartera», buscador «Buscar por nombre o documento», chips con contador **Todos · Hoy · En mora · Al día · Pagados · PSF**, botones «Filtros (n)» / «Quitar filtros», toggle tarjetas ↔ lista compacta (preferencia guardada en SecureStore `cartera.compact`), orden (**Mora, Deuda mayor, Nombre A-Z, Próximo vencimiento**; oculto en «En mora» donde el orden es fijo prioridad → días → saldo) y FAB morado «+» (nuevo cliente).
  - **Tarjeta de cliente:** nombre, zona · «n préstamos» · «n castigados» · fuente («PSF al 02/10», «ausente del reporte», «dato desactualizado»), deuda total (roja con mora), línea secundaria («8 días de mora» / «Cuota Bs 300 · vence 15 jul»), etiqueta «Cat. X», insignia (Al día/Por vencer/En mora/Pagado/Castigado).
  - **Chip «En mora»:** cambia a lista **por crédito** (`GET /mora`), con sub-chips **Todos / Críticos / Con promesa**, tarjeta con «Crédito N · n días de mora», «Última gestión: hace n días · Promesa vigente», monto vencido, insignia de prioridad (Baja/Media/Alta/Crítica, «En mora» si no hay), «Castigado» o «Al día». Estados: «Nadie en mora 🎉», «Sin resultados».
  - **Hoja de filtros** (`MoraFilterSheet`): rango de días de mora, rango de saldo, fuente (Todas/Kobrax/PSF), categorías de mora de la cuenta, prioridades y castigados (todos/solo/excluir). Se aplican en el teléfono sobre lo bajado (valen sin señal).
  - **Búsqueda global:** con ≥ 2 caracteres y 300 ms de debounce consulta `GET /clients?q=` y muestra «Otros clientes — No están en tu cartera de hoy» (sin deuda ni estado a propósito).
- **Acciones:** tarjeta de cliente → `/cliente/<clientId>`; tarjeta de mora → `/mora/<creditId>`; «Otros clientes» → `/cliente/<id>`; FAB → `/cliente/nuevo`. Chip «Hoy» = próxima fecha de cobro igual a hoy (día UTC). «Al día» = con saldo y sin mora; «Pagados» = sin saldo; «PSF» = algún crédito de fuente externa.
- **Comportamiento offline:** **disponible**. Cartera = `GET /mora?todos=true` paginado (100 por página, máx. 20 páginas = 2 000 créditos) guardado entero bajo una clave; mora = `GET /mora?limit=100`. Sin red salen de caché y la lista de mora dice **«Sin señal · datos de las HH:MM»**. La búsqueda sin red filtra por **nombre** en la cartera cacheada (el documento no viaja en esa lista); incluye altas hechas sin señal (filas provisionales). Sin copia: «Sin conexión — Tu cartera aparecerá cuando vuelva la red».
- **Datos:** `GET /mora?todos=true&limit=100&page=n`, `GET /mora?limit=100`, `GET /arrear-categories`, `GET /clients?q=&status=ACTIVE&limit=20`.
- **Navegación:** tab bar y «Más › Ver cartera»; sale a ficha de cliente, ficha de mora, nuevo cliente.
- **Estado:** ✅

### 2.2 Ficha de mora — `/mora/[creditId]`
Archivo: `app/mora/[creditId].tsx`; secciones en `src/mora-sections.tsx`, textos en `src/mora-ficha.ts`.

- **Propósito:** ficha de recuperación de un crédito: estado, datos, y las acciones de campo (llamar, WhatsApp, gestión, pago, nota).
- **Quién accede:** quien tenga el crédito en alcance (`collection:read`); fuera de alcance → 404. Escribir requiere `collection:write` (gestión, nota) y `payment:write` (pago).
- **Qué muestra:** aviso «Sin señal · datos de las HH:MM» si es copia local; aviso PSF (ausente del reporte / dato desactualizado / corte); cabecera (nombre, insignias de situación, Castigado, «Categoría X», «Prioridad Y», fuente; línea de situación; «Crédito N · n días de mora»; monto vencido grande; subtítulo); botonera **Llamar · WhatsApp · Gestión · Pago · Nota**; tarjeta **Resumen** (saldo, monto original, % del capital pagado con barra, vencido, cuota, días de mora, inicio de la mora, próximo vencimiento, último pago, «Números al corte del», agencia, responsable, reemplazo temporal/apoyo, última gestión, promesa vigente); «Cómo ubicarlo» (teléfonos y direcciones); secciones **Recuperación** (métricas), **Gestiones** (línea de tiempo), **Promesas de pago**, **Notas** (post-its por color/tipo), **Pagos**, **Historial de mora** (episodios).
- **Acciones:**
  - **Llamar / WhatsApp:** abre `tel:` / `https://wa.me/<dígitos>` con el teléfono principal (o el primero) y **deja una nota-rastro** («Llamada», «WhatsApp») en el crédito (`POST /mora/:id/activities` tipo `NOTE`; sin red se encola). Es una nota, no una llamada con resultado. Deshabilitado con aviso si no hay teléfono.
  - **Gestión** → hoja 2.3. **Pago** → hoja 2.5. **Nota** → hoja 2.4 (el id de gestión/nota se regenera al abrir).
  - **Editar/Borrar nota** (✏️/🗑) solo si es autora o tiene `assignment:write` (`canEditNoteText`); borrar pide confirmación; **solo en línea**.
- **Comportamiento offline:** **lectura con caché** (`mora.detail`, `mora.promises`, `mora.notes`, `payment`, `mora.episodes`, `mora.metrics`, `client.context`); gestión, pago y nota se **encolan**; editar/borrar nota **solo online** («Corregir o borrar una nota necesita conexión…»). Una sección que no se pudo leer dice «No disponible» y el resto sigue.
- **Datos:** `GET /mora/:id`, `/promises`, `/notes`, `/episodes`, `/metrics`, `GET /payments?creditId=`, `GET /agenda/clients/:id/context`, `GET /auth/me`; escrituras `POST /mora/:id/activities`, `POST /mora/:id/notes`, `PATCH|DELETE /mora/:id/notes/:noteId`, `POST /payments`.
- **Navegación:** desde Cobranza (chip En mora). **La ficha del cliente no enlaza a esta pantalla** (solo se llega desde la lista de mora).
- **Estado:** ✅

### 2.3 Hoja «Registrar gestión» (incluye promesa)
Archivo: `src/gestion-sheet.tsx`; resultados en `src/mora-actions.ts`; validador en `packages/shared/src/utils/recovery-activity.ts`. La usan la ficha de mora y la ficha de cliente.

- **Propósito:** registrar el resultado de un intento de cobro y, si corresponde, una **promesa de pago**.
- **Quién accede:** `collection:write` sobre el crédito.
- **Qué muestra:** título «Registrar gestión»; **Resultado** (chips): *Contestó* (CALL/CONTACTED), *No contesta* (CALL/NO_ANSWER), *Número equivocado* (CALL/WRONG_NUMBER), *Visita: lo encontré* (VISIT/CONTACTED), *Visita: no estaba* (VISIT/NOT_FOUND), *Dirección equivocada* (VISIT/WRONG_ADDRESS), *Se negó a pagar* (CALL/REFUSAL), *Promesa de pago* (CALL/PROMISE_TO_PAY); con «Promesa»: **Monto prometido**, **Pagará el** (calendario, no antes de hoy), **Medio de pago** (catálogo `PAYMENT_METHOD` del tenant; Efectivo/Transferencia/QR si no cargó), **Banco** (solo si el medio tiene `requiresBank` y el tenant tiene bancos); campo «Nota» (opcional).
- **Validaciones (antes de encolar):** `gestionError` = validador compartido (resultado coherente con el tipo, promesa solo con resultado «promesa», monto > 0, fecha no anterior a hoy, medio requerido) + banco si hace falta. Mensajes en español («La fecha prometida no puede ser anterior a hoy.»).
- **Comportamiento offline:** `submitMoraActivity` intenta `POST /mora/:creditId/activities` con `id` fijado al abrir la hoja; con `offline` **encola `mora.activity`** con el mismo id. «Sesión vencida» → mensaje, no encola. Catálogos: caché en memoria del proceso + base local (hidratados).
- **Datos:** `POST /mora/:creditId/activities`; catálogos `PAYMENT_METHOD`, `BANK`.
- **Estado:** ✅ (la visita de ruta usa otra pantalla, 1.6, con otras variantes).

### 2.4 Hoja «Nota del crédito»
Archivo: `src/note-sheet.tsx`.

- **Propósito:** dejar dicho algo (post-it) en el crédito: «solo contesta de noche», etc.
- **Qué muestra:** **Tipo** (Informativa / Atención / Importante), **Color** (amarillo, rosa, azul, verde, morado, naranja), texto multilínea con contador `n/1000` (`MORA_NOTE_MAX_LENGTH`). Crear: «Guardar nota»; corregir: título «Editar nota» y «Guardar cambios».
- **Reglas:** texto no vacío tras `trim` y ≤ 1000. Crear = idempotente por `id` (se **encola** `credit.note` sin red). **Corregir/borrar = solo en línea** (el servidor decide quién; se explica con un mensaje).
- **Datos:** `POST/PATCH/DELETE /mora/:creditId/notes[/noteId]`.
- **Estado:** ✅ — Nota solo disponible en la ficha de mora (no en la ficha de cliente).

### 2.5 Hoja «Registrar pago» y «Mostrar mi QR»
Archivos: `src/pay-sheet.tsx`, `src/payment-submit.ts`, `src/qr-cobro.tsx`, `src/payments.service.ts`.

- **Propósito:** registrar un cobro sobre un crédito (desde ficha de mora o ficha de cliente).
- **Quién accede:** `payment:write`.
- **Qué muestra:** **Monto** (precargado con `suggestedPaymentAmount` o la cuota; en PSF, la mora reportada), nota «No cambia el saldo ni la mora del reporte» si es PSF; **Método** (Efectivo, Transferencia, QR); **¿Quién recibió la plata?** («La cobré yo» / «Pagó en la entidad»); con QR, botón **«Mostrar mi QR»**; **«Foto de comprobante»**; botón «Confirmar pago».
- **Reglas:** `monto > 0` y `≤ saldo` (tope = saldo del crédito; **sin tope** para créditos importados/PSF). `paymentDate` = hora del dispositivo al cobrar (viaja con la cola). `channel` solo se envía si no es «La cobré yo». Llave `pay-<timestamp>-<random>` generada al abrir la hoja y reutilizada en el intento y en la cola → un reintento no cobra dos veces.
- **Mostrar mi QR:** abre un modal blanco con la **foto del QR cargada en el perfil del cobrador** (`GET /users/me/profile` → `paymentQrUrl`). No hay pasarela: el deudor paga con su app bancaria y **el cobrador registra el pago a mano** con método QR («La app no lo detecta sola»). Sin QR cargado ofrece ir a `/cuenta/perfil`.
- **Comportamiento offline:** pago **encolado** (`payment`; el comprobante local viaja con el ítem). Se muestra en el historial de la ficha de cliente como «Guardado en el teléfono · se sube con señal». «Mostrar mi QR» **no tiene caché**: sin red dice «No se pudo leer tu perfil».
- **Datos:** `POST /payments` (header `Idempotency-Key`), `POST /uploads`, `GET /users/me/profile`.
- **Estado:** ✅

---

## 3. Clientes y préstamos

### 3.1 Ficha de cobranza del cliente — `/cliente/[id]`
Archivo: `app/cliente/[id].tsx`.

- **Propósito:** ficha por cliente: deuda, préstamos, acciones de campo, pagos y legajo.
- **Quién accede:** `client:read` + que el cliente tenga créditos en el alcance del usuario (`GET /agenda/clients/:id/context`); si no tiene (o responde AGENDA_002) se degrada a la identidad (`GET /clients/:id`).
- **Qué muestra:**
  - *Sin préstamos con vos:* nombre, documento, «Sin préstamos registrados» y botón **«Registrar préstamo»** (→ `/prestamo/nuevo`).
  - *Normal:* nombre, ✏️ editar, insignia de estado, documento · zona, tags *Castigado* / *Categoría X*, **deuda total** (suma de saldos; roja con mora), avisos PSF (🔒 importado; ⚠️ ya no viene en el reporte; ⚠️ dato desactualizado), banner de revisión de vínculo, barra **Llamar · WhatsApp · Navegar**, tarjeta **Próximo pago** (cuota, vencimiento, días de mora y desde cuándo, «Cuota a reclamar: N.º n») con botones **Registrar pago**, **Registrar gestión** y **Poner al día / Marcar en mora**, barra «Recuperado X de Y», selector de **Préstamos (n)** si hay más de uno, bloque colapsable «Datos del préstamo» (saldo, total a cobrar, capital, definición, interés, cuotas, frecuencia, próxima fecha, documento enmascarado, cliente desde, método de mora, origen, operación PSF, «No registrados», «Ver plan de pagos (n cuotas)»), solo si se abrió desde una ruta: «🕘 Hora recomendada» y «Garantes cerca» (mini-mapa); contactos y ubicaciones; garantes y adjuntos del legajo; **Historial** (pagos y gestiones mezclados, con los pagos en cola arriba).
- **Acciones:** *Llamar/WhatsApp* abren la app externa y dejan nota-rastro; *Navegar* abre `/cliente/mapa` (mapa Kobrax) y deja nota «Navegación»; **Registrar pago** (2.5, tope = saldo del préstamo elegido; sin tope si `locked`/importado); **Registrar gestión** (2.3); **Marcar en mora** (días opcionales → `POST` arrears mark; solo en préstamo sin cronograma y no importado) y **Poner al día** (dos opciones: «Corre al <fecha próxima>» —fecha **resuelta en el teléfono**— o «Sin fecha de vencimiento»; **no se ofrece en préstamos importados**); ✏️ → `/cliente/editar?clientId=&creditId=`.
- **Regla de préstamo provisional:** un préstamo dado de alta sin señal (`pending`) **oculta** pagar, gestionar y marcar/poner al día con «⏳ Este préstamo todavía no subió al servidor…» (el servidor respondería 404).
- **Comportamiento offline:** lectura con caché (`client.context`, `client`, `mora.detail`, `credit`, `payment`); pago, gestión, marcar mora y poner al día se **encolan** (`payment`, `mora.activity`, `arrears.mark`, `arrears.clear`); adjuntos y alta de garantes necesitan red.
- **Datos:** `GET /agenda/clients/:id/context`, `GET /clients/:id`, `GET /mora/:creditId`, `GET /payments?creditId=`, `GET /credits/:id`; escrituras como arriba.
- **Navegación:** desde Cobranza, Rutas, mapa de ruta (con `routeId`), búsqueda global. Sale a editar, mapa de cliente, nuevo préstamo.
- **Estado:** ✅

### 3.2 Nuevo cliente — `/cliente/nuevo`
Archivo: `app/cliente/nuevo.tsx`; formulario único `src/cliente-form-view.tsx`; payload y reglas en `packages/shared/src/utils/client-form.ts`.

- **Propósito:** dar de alta un cliente (opcionalmente seguido de su préstamo), también en la puerta del deudor sin señal.
- **Quién accede:** `client:write` (cobrador y administrador; el supervisor ve la pantalla pero la API responde 403). Parámetros opcionales `?lat=&lng=` (alta desde el mapa de Rutas: la primera ubicación arranca con ese punto).
- **Qué muestra:** formulario en acordeones — **Identificación** (tipo Persona/Empresa, nombre o razón social, apellido, documento CI/RUC opcional, género, segmento de riesgo Bajo/Medio/Alto, estado), **Teléfonos** (tipo Teléfono/Email, número, «Tiene WhatsApp», «Principal»), **Ubicaciones** (tipo Casa/Trabajo/Familia/Otra, dirección, zona, **captura de coordenadas** Manual / «Mi ubicación» / Mapa, referencia, fotos), **Garantes y contactos** (cada uno con sus teléfonos/ubicaciones y qué préstamos garantiza), **Garantías**. Pie: **«Guardar y agregar préstamo»** y **«Solo guardar cliente»**.
- **Validaciones:** `canSubmitCliente`: persona → nombre ≥ 2 y apellido ≥ 1; empresa → razón social ≥ 2; **al menos un teléfono** de tipo PHONE con valor. Detección de duplicados (3.3) antes de encolar: documento repetido **bloquea**, nombre repetido pide confirmar. Tope del plan (`hayLugar('clients')`) → «Tu plan llegó al tope de clientes. Avisale a tu administrador…».
- **Acciones:** `createClient` (`POST /clients`) con **id del teléfono**. Con red: ok; sin red: se **encola `client.create`**, se escribe una **fila provisional** en caché (aparece en búsqueda y ficha con `pending`) y se continúa: «Guardar y agregar préstamo» → `/prestamo/nuevo?clientId=&name=` (replace), «Solo guardar» → vuelve.
- **Comportamiento offline:** **encolado** (alta completa con teléfonos y ubicaciones anidados). Las **fotos de ubicación** necesitan red (`POST /uploads`; sin red: «No se pudo subir la foto»). Capturar GPS sin permiso/señal da aviso y permite cargar lat/long a mano.
- **Datos:** `POST /clients/duplicate-check`, `POST /clients`, `GET /accounts/me` (tope; ver H-5).
- **Navegación:** FAB de Cobranza, toque en mapa vacío de Crear ruta, Ajustes › Importación (modo manual). Sale a `/prestamo/nuevo` o atrás.
- **Estado:** ✅ (H-5 sobre el tope del plan).

### 3.3 Detección de duplicados
Archivos: `src/duplicate-check.ts`, `src/duplicate-notice.tsx`.

- **Cuándo corre:** al salir (blur) de nombre, apellido o documento y otra vez al guardar. Solo pregunta con **documento ≥ 3 caracteres** o **nombre y apellido ≥ 2** (razón social ≥ 2).
- **Reglas:** el **documento repetido bloquea** («Ya existe un cliente con ese documento. No se puede crear otro.»; muestra el nombre, documento enmascarado, nº de préstamos, «dado de baja» si aplica); el **mismo nombre advierte** («Ya hay alguien con ese nombre», hasta 3 coincidencias + «y n más», «con otro documento») y exige tocar **«Es otra persona, continuar»** (la confirmación vale solo para ese nombre exacto).
- **Con red:** `POST /clients/duplicate-check` decide el servidor.
- **Sin red:** responde el teléfono con la cartera bajada y las fichas cacheadas, mostrando «Sin señal: se revisó con lo guardado en el teléfono. El servidor lo vuelve a revisar al subir». **Límite explícito:** la cartera no trae documento, así que el documento solo se compara contra clientes con ficha en claro en este teléfono (los dados de alta aquí); el servidor frena el resto al subir (`CLIENT_DUP`), y entonces el alta queda «Rechazado» en Pendientes.
- **Estado:** ✅

### 3.4 Editar cliente (y crédito) — `/cliente/editar`
Archivo: `app/cliente/editar.tsx`; `src/cliente-queue.ts`.

- **Propósito:** corregir datos del cliente (mismo formulario que el alta) y, si llega `creditId`, redefinir condiciones del préstamo.
- **Quién accede:** `client:write` (+ `credit:write` para el crédito).
- **Qué muestra:** `ClienteFormView` prellenado con datos **en claro** (`GET /clients/:id?reveal=true`, auditado) y, abajo, tarjeta «💳 Datos del crédito» con el formulario de condiciones, cotización, «Estado al registrar», próxima fecha y nota; o el motivo del bloqueo: 🔒 importado, «Ya tiene pagos registrados…» (se puede mover la próxima fecha), «Tiene un cronograma guardado…».
- **Acciones:** «Guardar cambios» manda **solo la diferencia** (`diffCliente`): primero bajas, luego altas y cambios de contactos/ubicaciones/garantes/garantías; después `PATCH /credits/:id` con lo que cambió. Deshabilitado si la redefinición del crédito no es válida.
- **Comportamiento offline:** **la pantalla necesita red para abrir** (el `reveal` nunca sale de caché): sin red muestra «Sin conexión.». Si la señal se corta **durante** el guardado y todo lo cambiado es repetible (cambios y bajas de teléfonos/direcciones y datos del cliente) se encola entero (`client.update`, `client.contact`, `client.location`). Si trae **altas** de teléfono/dirección, garantes, garantías o cambios del crédito, **no se encola nada** y se pide señal. El cambio del crédito es siempre solo online.
- **Datos:** `GET /clients/:id?reveal=true`, `GET /credits/:id`, `GET /credits?clientId=`, `PATCH /clients/:id`, `POST|PATCH|DELETE /clients/:id/{contacts,locations,relations,collaterals}`, `PATCH /credits/:id`.
- **Navegación:** desde ficha de cliente (✏️), Crear ruta (clientes sin ubicación) y Mapa de cliente («Marcar el punto»); vuelve atrás.
- **Estado:** 🟡 (offline muy limitado; ver H-6).

### 3.5 Dónde queda el cliente — `/cliente/mapa`
Archivo: `app/cliente/mapa.tsx`.

- **Propósito:** ver en el mapa de Kobrax todas las ubicaciones del cliente (propias y de garantes/familia), sustituyendo a Google Maps.
- **Quién accede:** quien pueda leer el contexto del cliente.
- **Qué muestra:** mapa con un pin por ubicación con punto, panel con la destacada (tipo Casa/Trabajo/Garante/Familia/Otra, dirección, zona) y lista «Ver» de las otras. Sin puntos: «Sin punto marcado — Este cliente tiene dirección escrita, pero nadie marcó el lugar» y botón **«Marcar el punto»** (→ `/cliente/editar`).
- **Acciones:** tocar pin o fila para enfocar. **No es navegación paso a paso.**
- **Offline:** datos de `client.context` en caché; tiles según §1.9.
- **Datos:** `GET /agenda/clients/:id/context`.
- **Navegación:** desde «Navegar» de ficha de cliente y de Confirmación. Parámetros `clientId`, `locationId`, `name`.
- **Estado:** ✅

### 3.6 Nuevo préstamo — `/prestamo/nuevo`
Archivo: `app/prestamo/nuevo.tsx`; formulario `src/credit-terms-view.tsx`; motor `creditFormState`/`buildNewCreditPayload` de `@kobrax/shared`.

- **Propósito:** registrar un préstamo de un cliente con el mismo modelo y cotización que la web.
- **Quién accede:** `credit:write` (cobrador y administrador). Requiere `clientId`; sin él: «Un préstamo se carga desde la ficha de su cliente…» y botón «Nuevo cliente».
- **Qué muestra:** tarjeta con el nombre del cliente, condiciones del préstamo (definición, capital, tasa/cuotas, frecuencia, fecha, método de mora por defecto de la cuenta), **panel de cotización en vivo** y «Ver plan de pagos», switch **«Este préstamo ya está en curso»** (cuotas ya pagadas; muestra saldo, próxima cuota y mora resultantes), «Nota», botón **«Crear crédito»**. Éxito: ✅ «Préstamo registrado», cuota y vencimiento, «Ver ficha» / «Registrar otro».
- **Reglas:** habilitado solo si el motor lo da por válido (`canSubmit`; con «en curso», además `registeredState.ok`). La moneda mostrada está fija en **BOB/«Bs»** (constante `CURRENCY`). Tope del plan (`hayLugar('credits')`).
- **Comportamiento offline:** **encolado** (`credit.create` con `id` del teléfono; FIFO: si el cliente también estaba en la cola va antes). Escribe fila provisional en el contexto del cliente. Si el cliente falló, el préstamo también falla (queda para el próximo intento / descarte).
- **Datos:** `GET /accounts/me` (método de mora, tope), `POST /credits`.
- **Navegación:** desde Nuevo cliente («Guardar y agregar préstamo») y ficha de cliente («Registrar préstamo»); termina en la ficha.
- **Estado:** ✅ (H-5, moneda fija).

---

## 4. Importación móvil

El móvil **no parsea archivos**: sube el archivo y dibuja lo que devuelve la API (`/imports/portfolio`). Servicio: `src/import.service.ts`. **Todo el módulo es solo online** (el archivo se lee en el servidor). Permisos: `client:import` para todo el módulo (cobrador, supervisor, administrador); **configurar** (PATCH de config) exige además `assignment:write` o ser **dueño de la cuenta** (`IMPORT_CONFIG_FORBIDDEN`). La app lo sabe con `ConfigScreen.viewer.canConfigure`.

Entradas: (a) **gate automático** tras el login (último paso de `routeAfterAuth`): se ofrece si el tenant tiene origen = archivo y «Preguntar al iniciar sesión» y hoy no se importó ni saltó; **falla cerrado** (sin config legible no interrumpe); (b) **Más › Importación › Importar datos** (`?from=menu`, sin gate); (c) Ajustes › «Probar con un archivo».

### 4.1 Gate de importación — `/import`
Archivo: `app/import/index.tsx`.

- **Propósito:** ofrecer traer la cartera del día.
- **Qué muestra:** 📥 «Traé la cartera de hoy», «Subí el archivo que emite tu sistema. Vas a ver qué cambia antes de que se aplique nada», botones «Sincronizar datos» y «Ir al Dashboard» (o «Volver» con `from=menu`).
- **Acciones:** «Sincronizar datos» → `/import/archivo`. «Ir al Dashboard» **marca el día como saltado** (`k_import_skip_day`) y va a las tabs; con `from=menu` solo vuelve (no marca).
- **Offline:** muestra el banner global; seguir exige red en las pantallas siguientes. Flags en SecureStore, **globales del teléfono** (no por usuario).
- **Datos:** ninguno propio (flags locales).
- **Estado:** ✅

### 4.2 Elegir archivo — `/import/archivo`
Archivo: `app/import/archivo.tsx`; `src/file-picker.ts`.

- **Propósito:** elegir el archivo del día.
- **Qué muestra:** título «Traé la cartera de hoy»/«Listo para continuar», dropzone «Tocá para elegir el archivo» (muestra el nombre elegido), caja **Requisitos** (formato según la config: «CSV o Excel (.xlsx) · hasta 15 MB», «Reporte PDF con una tabla…», «Extracto PDF…», o «Hasta 15 MB» si no se leyó la config; «Tiene que traer el N° de crédito de cada registro»). Con `test=1` el título es «Probar con un archivo».
- **Acciones:** selector de documentos (PDF, CSV, texto, .xlsx, .xls — el backend rechaza .xls al abrirlo); «Siguiente» → `/import/preview` con `uri,name,mimeType,test`. **Deshabilitado sin archivo o sin red** («Sin conexión. El import se hace en la oficina, con wifi.»).
- **Offline:** **solo online.**
- **Datos:** `GET /imports/portfolio/config`.
- **Estado:** ✅

### 4.3 Vista previa de importación — `/import/preview`
Archivo: `app/import/preview.tsx`.

- **Propósito:** ver qué va a pasar antes de aplicar. **No se puede saltear**: confirmar solo existe tras leer la vista previa.
- **Qué muestra:** nombre del archivo; «Corte del dd/mm/aaaa · Asesor X»; tiles **QUÉ VA A PASAR** (Agregados, Actualizados, Ya no vienen, Volvieron, Ignorados, Al día); listas plegadas a 8 con «Mostrar n más»: **Se agregan** (marca «revisar vínculo» si se parece a un cliente existente), **Se actualizan** (saldo/mora «antes → después»), **Volvieron al reporte**, **Ya no vienen en el reporte** (no es pago ni cierre), **No se importan (n)** con motivo en lenguaje del usuario (`NO_CODE`, `DUP_IN_FILE`, `MATCHES_MANUAL`, `MATCHES_OUT_OF_SCOPE`, «Le falta un dato que marcaste obligatorio»), y advertencias globales (fecha de corte desconocida; columna de días de atraso sin confirmar/sospechosa/inconsistente).
- **Reglas:**
  - Archivo ya importado (`alreadyApplied`/`idempotentSkip`): «Este archivo ya se importó el … por …», **sin botón de confirmar**.
  - Modo de asignación del servidor: **SELF** («Estos créditos se asignarán a ti») o **CHOOSE** (quedan con el responsable que sugiere el reporte; si hay nuevos sin responsable el servidor no deja confirmar: botón **«Asignar todo a mí»** los pone a nombre de quien confirma; repartir entre varios se hace en el panel web).
  - Con `test=1` **no hay «Confirmar»**: se muestra «Es una prueba: nada se importa» y «Importar de verdad».
- **Acciones:** «Confirmar importación» → mismo POST con `dryRun=false` (+ `assignments` si «Asignar todo a mí»); al salir bien `markImported()` (marca el día) y `replace` a Resultado. Error: «Reintentar».
- **Offline:** **solo online** (errores: «Sin conexión. El import se hace en la oficina, con wifi.», «Tu sesión venció»).
- **Datos:** `POST /imports/portfolio` (multipart, `dryRun=true|false`, `assignments`).
- **Estado:** ✅

### 4.4 Resultado — `/import/resultado`
Archivo: `app/import/resultado.tsx`.

- **Propósito:** informar cómo terminó la importación; también sirve en modo lectura (`mode=read`) para «Ver detalle» de Ajustes.
- **Qué muestra:** banner ✅ «Cartera actualizada» / ⚠️ «Importado, con registros afuera» / ↺ «Este archivo ya se había importado»; tiles de conteo; **NO SE IMPORTARON (n)** con hasta 8 registros y su motivo («y n más»); botón «Ir al inicio» (o «Volver» en lectura). Sin «‹» tras importar (atrás sería la vista previa ya aplicada).
- **Offline:** pantalla sin llamadas (todo viaja por parámetros de navegación). **No hay «Descargar reporte de errores»** (no implementado).
- **Estado:** ✅

### 4.5 Ajustes › Importación — `/ajustes/importacion`
Archivo: `app/ajustes/importacion.tsx`. Llega desde **Más › Importación › Reglas de importación**.

- **Propósito:** definir una vez cómo se lee el archivo para que el import diario no vuelva a preguntar.
- **Quién accede:** quien tenga `client:import`; **cambiar** solo `canConfigure` (reparte cartera o dueño). Sin permiso, los controles no se mueven y dice «Sólo quien reparte la cartera o el dueño de la cuenta puede cambiar esta configuración».
- **Qué muestra:** **ÚLTIMA IMPORTACIÓN** (cuándo, plantilla, alcance, Agregados/Actualizados/Al día, filas con problemas, «Ver detalle», «Historial de importaciones»); **ORIGEN DE DATOS** (Manual / Archivo; en manual: «Agregar cliente y crédito a mano»); **ALCANCE DEL ARCHIVO** (Oficial de crédito / Agencia / Empresa; con oficial o agencia, elegir cuál); **Forma del archivo** (una fila por crédito CSV/Excel · tabla en PDF · bloque por crédito en PDF); «¿El archivo trae el cobrador?»; **Reglas** (ausentes: Ponerlos al día / Dejarlos como están / Decidir en cada importación); **Emparejar columnas** (n campos); **Llave de match** (N° de crédito, fija); **AL INICIAR SESIÓN** («Preguntar al iniciar sesión»); «Probar con un archivo»; «Reiniciar la configuración» (con confirmación; no toca la cartera ya importada). El asistente bloquea filas hasta que el paso previo esté resuelto y dice por qué.
- **Acciones:** cada cambio hace `PATCH /imports/portfolio/config` al toque con actualización optimista y **vuelve al valor previo** si el servidor rechaza (invariantes validados en backend). Cambiar la forma del archivo **resetea el emparejado**.
- **Offline:** **solo online**: sin red la lista se atenúa y bloquea, con botón «Reintentar»; «Sin conexión: no se guardó.».
- **Datos:** `GET/PATCH /imports/portfolio/config`.
- **Estado:** ✅

### 4.6 Emparejar columnas — `/ajustes/importacion-columnas`
Archivo: `app/ajustes/importacion-columnas.tsx`.

- **Propósito:** decir de qué columna/etiqueta del archivo sale cada campo.
- **Qué muestra:** caja **Llave: N° de crédito ← "<columna>"**; en PDF, fila «Dónde empieza cada registro» (bloques) o «Cuál es la fila de encabezados» (tabla); «Muestra: <archivo>» y las columnas halladas; lista **CAMPOS** (etiqueta, `"origen"`/«sin emparejar», estado Obligatorio / Opcional / No importar, ⚠ si no tiene origen o los días de atraso no están confirmados); «Cómo viene: …» bajo el nombre (Todo junto / Dos apellidos y después los nombres / Columnas separadas, con ejemplo); barra **«Confirmá que "<col>" son los días de atraso»** con «Confirmar».
- **Acciones:** elegir/cambiar archivo de muestra (se **recuerda la ruta** en SecureStore; si el sistema limpió el caché se olvida en silencio) → `POST /imports/portfolio?columnsOnly=true`; estado del campo por hoja de 3 opciones; «De dónde se lee» (para días de atraso muestra valores reales de la muestra por cliente); «Quitar del emparejado» (no la llave ni el cliente); «+ Agregar campo del archivo». Cambiar la columna de días de atraso vuelve `calibrated=false` (confirmar es un acto aparte).
- **Offline:** **solo online** (leer la muestra y guardar). Esta pantalla **no** consulta `canConfigure` antes de intentar: el servidor rechaza con su mensaje.
- **Datos:** `GET/PATCH /imports/portfolio/config`, `POST /imports/portfolio?columnsOnly=true`.
- **Estado:** ✅

### 4.7 Historial de importaciones — `/ajustes/importacion-historial`
Archivo: `app/ajustes/importacion-historial.tsx`.

- **Propósito:** lista de corridas (más reciente primero, hasta 50), solo lectura.
- **Qué muestra:** por corrida: fecha · quién, archivo, «Corte dd/mm/aaaa», «n nuevos · n actualizados · n rechazados». Vacío: «Todavía no se importó ningún archivo». Con copia local: «Sin conexión: datos guardados en el teléfono.»
- **Acciones:** tocar una corrida → `/ajustes/importacion-corrida?id=`. Pull-to-refresh.
- **Offline:** **lectura con caché** (`import.run`, `list`) si ya se vio con señal; si no, «Sin conexión — El historial aparecerá cuando vuelva la red».
- **Datos:** `GET /imports/portfolio/runs?limit=50`.
- **Estado:** ✅

### 4.8 Detalle de una corrida — `/ajustes/importacion-corrida`
Archivo: `app/ajustes/importacion-corrida.tsx`.

- **Propósito:** ver qué le pasó a cada registro de una corrida.
- **Qué muestra:** cabecera (fecha · autor; archivo, plantilla, alcance, corte, asesor), tiles, «n no se importaron», «n clientes nuevos para revisar vínculo en el panel», nota «Es de antes del historial…», y por acción (Agregados, Actualizados, Volvieron, Ya no vienen, Al día, No se importaron) una lista plegable de hasta 100 registros (8 + «Mostrar más») con «antes → después» o motivo. **Sin descarga del archivo** (eso es del panel).
- **Offline:** cada lista se guarda al abrirla con señal y se ve sin ella; si no: «Sin conexión: esta lista no está guardada en el teléfono».
- **Datos:** `GET /imports/portfolio/runs/:id`, `/runs/:id/items?action=&limit=100`.
- **Estado:** ✅

---

## 5. Offline y sincronización

Principio (apps/mobile/CLAUDE.md): el cobrador nunca espera a la red para trabajar; toda acción se guarda primero en el teléfono y sube cuando hay conexión. Implementación real: `src/db.ts`, `src/sync/*`, `src/queue-photos.ts`, `src/route-draft.ts`, `src/store/net.ts`.

### 5.1 Pantalla «Sin subir» — `/pendientes`
Archivo: `app/pendientes.tsx`.

- **Propósito:** auditar lo que el cobrador hizo y aún no llegó al servidor, y forzar el reintento.
- **Quién accede:** cualquier usuario con sesión; muestra **solo los ítems de su `userId`**.
- **Qué muestra:** «Esto ya quedó guardado en el teléfono y se sube solo cuando haya señal. No hace falta que lo vuelvas a cargar.»; resumen de fotos en espera («n fotos esperan señal · x MB de 150 MB»); una fila por ítem con **etiqueta** (Visita registrada, Pago cobrado, Gestión agendada, Gestión ejecutada, Gestión pospuesta, Estado de la jornada, Cliente nuevo, Préstamo nuevo, Préstamo marcado en mora, Préstamo puesto al día, Gestión cancelada, Gestión reagendada, Gestión registrada, Nota del crédito, Foto de la visita, Foto que no se pudo adjuntar, Datos del cliente, Teléfono del cliente, Dirección del cliente), cuándo y **motivo del último fallo**, y una **insignia**: *En espera* (0 intentos), *n intento(s)* (ámbar), *Rechazado* (rojo), *No soportado* (rojo). Vacío: ✅ «No hay nada pendiente — Todo lo que registraste ya está en el servidor».
- **Acciones:** **«Reintentar ahora»** (`drain(force:true)`: ignora el tope de 3 intentos; deshabilitado y rotulado «Sin conexión» sin red); **«Descartar»** solo en *Rechazado* y *No soportado*, con confirmación destructiva («no se va a subir y se borra del teléfono. No se puede deshacer»): borra la fila, las copias de fotos y la fila provisional de un alta descartada. Mensajes tras reintentar: «Sigue sin haber señal…», «Tu sesión venció…», «Hay que actualizar la app…», «n subieron; n siguen sin poder subir», «n acciones subieron».
- **Offline:** disponible (todo local).
- **Datos:** SQLite `queue`, carpeta `queue-photos`.
- **Navegación:** tocando el banner global o «Ver lo que falta subir» del resumen de jornada.
- **Estado:** ✅

### 5.2 Almacenamiento local
- **SQLite `kobrax.db`** (`expo-sqlite`, único archivo con SQL: `src/db.ts`), tres tablas: **`cache`** (genérica: `kind`+`scope`+`id`+JSON del servidor+`fetched_at`; **descartable**), **`queue`** (acciones sin subir; `id` autoincremental = orden FIFO real; `user_id`, `kind`, `payload`, `idempotency_key`, `attempts`, `last_error`, `created_at`) y **`meta`** (`schema_version` y mapas `idmap:local:… → id real`).
- **SecureStore:** tokens, `userId`, ventana de sesión, **borradores de ruta** (por usuario y día), flags de import, preferencia de vista de cartera, muestra de importación.
- **Archivos:** `documentDirectory/queue-photos/` (fotos de la cola).
- **Versión de esquema (`SCHEMA_VERSION = 3`):** si cambia, **se borran caché, cola y meta** (decisión «dev-only» documentada: «no hay teléfonos con colas reales»). Con teléfonos reales habría que migrar antes de subir la versión (ver H-7).
- **Tipos de caché:** `session, client, client.context, portfolio, mora, mora.detail, mora.promises, mora.notes, mora.episodes, mora.metrics, credit, route, agenda, agenda.detail, catalog, notification, payment, list.meta, import.run, account, arrear.categories, members`.
- **Sesión offline:** `me()` sin red responde con el último `me` guardado mientras la ventana local (8 h de inactividad, renovada con cada `me()` con red) siga vigente; vencida → login. Pantalla `(app)/offline` («Trabaja sin conexión») solo aparece si no hay `me` local.

### 5.3 Lectura sin conexión
`cachedList` / `cachedOne` (`src/sync/cached.ts`): con red guardan la respuesta tal cual; **solo el estado `offline`** cae a la copia local (un error 4xx/5xx o una sesión vencida llegan a la pantalla sin disfrazar). Las listas se guardan **por consulta** (scope = query string) y las fichas por id; el `meta.total` se guarda aparte. La copia trae `localAt` (hora de bajada), que algunas pantallas muestran como «Sin señal · datos de las HH:MM» (lista de mora y ficha de mora).

### 5.4 Cola de acciones (qué se encola)
Tipos (`QueuedAction`): `visit` (visita + foto + cobro + promesa), `payment`, `agenda.create`, `agenda.complete`, `agenda.postpone` (con hora absoluta `toTime`), `agenda.cancel`, `agenda.reschedule`, `route.status`, `client.create`, `credit.create`, `arrears.mark`, `arrears.clear` (con **fecha ya resuelta**, nunca «siguiente período»), `mora.activity`, `credit.note`, `visit.evidence`, `photo.lost`, `client.update`, `client.contact` (add/update/remove), `client.location` (add/update/remove). Versión de payload `QUEUE_VERSION = 1`; una fila con versión mayor o tipo desconocido o dañada se muestra como **No soportado**.
- **Idempotencia por tipo:** ids puestos por el teléfono (visita, gestión, nota, agenda, cliente, préstamo); `Idempotency-Key` en pagos (`visit-<id>` o `pay-…`); valores fijos en PATCH; búsqueda previa por teléfono/dirección antes de repetir altas sin id (con mapa `local:<uuid>` → id real; un `agenda.create` que cita un contacto `local:` espera «a que suba el teléfono nuevo»).
- **Dueño:** la cola es de un `userId`; sin sesión no se puede encolar (`enqueue` devuelve `false` y la pantalla avisa «no se pudo guardar en el teléfono»). Logout/cierre de sesión **no borra la cola** (sí caché y borradores de ruta).

### 5.5 Hidratación («sync de oficina»)
`hydrate(collectorId)` (`src/sync/hydrate.ts`) corre **una vez al montar el shell de tabs** (login/arranque), **después** de arrancar el motor de sync y **sin esperarla** (si no hay red falla en silencio; se reintenta al volver a entrar). No hay botón manual ni re-hidratación periódica: solo se refresca lo que cada pantalla vuelve a pedir con red.
Baja, cada recurso de forma independiente (lo que entró, entró; nada se borra si falla): cartera completa, mora, conteo de mora (Inicio), rutas del cobrador, agenda de hoy + 7 días, vencidos (100), detalle de cada gestión pendiente, avisos locales de agenda, notificaciones, pagos de hoy, categorías de mora, **detalle de la ruta `IN_PROGRESS`**, 6 catálogos (medios de pago, bancos, categorías especiales, motivos de cancelación y reagendado, plantillas de WhatsApp) y, para hasta **150 clientes** de la cartera/mora, su ficha, contexto, y por cada crédito: ficha de mora, episodios, métricas, promesas, notas y pagos.
**No se hidrata:** el detalle (paradas) de una ruta `PLANNED` (se cachea solo cuando se abre con señal), la geometría/estimación de `GET /routes/:id/preview`, datos con `reveal` (PII en claro), tiles de mapa, ni nada de Importación fuera de lo que se visitó.
Cada llamada usa **los mismos parámetros que la pantalla** (si una pantalla cambia parámetros, hay que cambiarlos en `hydrate.ts` o llena casillas que nadie consulta).

### 5.6 Motor de sincronización (`src/sync/sync.service.ts`)
- **Cuándo drena:** al montar tabs; en cada **flanco de reconexión** (sin red → con red, vía NetInfo; `isInternetReachable=false` cuenta como sin red); **cada 60 s** si hay red; y con «Reintentar ahora» (`force`). Un candado impide dos drenajes simultáneos. Sin red no se despierta ningún temporizador de trabajo.
- **Orden:** FIFO por `id` de inserción (no por reloj del equipo).
- **Un ítem que falla no traba a los demás.** Cortan el ciclo entero (sin contar intento): sin red/timeout (`offline`), sesión vencida (`auth`) y 426 (`upgrade`).
- **Tras la cola**, el mismo drenaje sincroniza los **borradores de ruta** (`flushPendingDrafts`); no son ítems de la cola (se sincronizan por diferencia).
- **Contador:** `pendingCount` alimenta el banner global y se actualiza al encolar y al terminar cada drenaje.

### 5.7 Estados de un ítem encolado, reintentos y rechazos
| Estado visible | Condición | Qué pasa |
|---|---|---|
| **En espera** | `attempts = 0` | Se intentará en el próximo drenaje |
| **n intento(s)** | falla pasajera (5xx, 408, 429, error de red de la subida de archivo, excepción interna): `markFailed` suma 1 | Se reintenta en cada drenaje **hasta 3 intentos**; desde ahí **deja de intentarse solo** y espera «Reintentar ahora» |
| **Rechazado** | 4xx del servidor distinto de 408/429/426 (datos inválidos, sin permiso, ya no aplica; p. ej. `VISIT_STOP_DONE`, `ROUTE_TRANSITION`, duplicado de documento): `attempts = 99` | **No se reintenta solo**, queda a la vista con el motivo; «Reintentar ahora» lo vuelve a mandar; solo se puede **Descartar** a mano |
| **No soportado** | tipo desconocido / payload dañado / versión más nueva | Nunca se envía; se puede descartar |
| *(offline / auth / 426)* | sin red, sesión vencida o app vieja | No cuenta intento; todo queda a salvo; el banner/gate lo explica |
| **photo.lost** | foto que ya no está en el teléfono | Nace «Rechazado» como aviso persistente |

Notas de borde: un `offline` por **timeout** (15 s) es «resultado desconocido» pero se trata igual (seguro por los ids). Acciones sobre gestiones de agenda rechazadas se **explican** con el conflicto probable (`agenda-conflicts.ts`: otra persona la canceló/reagendó/ejecutó). Un DELETE que da 404 cuenta como hecho. Un 426 jamás descarta nada.

### 5.8 Fotos encoladas
Ver §1.8: copia durable a `queue-photos/`, tope de 150 MB de pendientes (bloquea la foto **nueva**), sube con la visita/pago, se borra al subir o descartar, aviso `photo.lost` si el sistema la borró. Con señal la foto se sube **al tomarla** (el ítem lleva solo la URL+hash).

### 5.9 Recorrido (borrador de ruta)
Ver §1.2: persistencia en SecureStore por usuario/día, sincronización por diferencia (idempotente), reintento en cada drenaje, descarte al salir de sesión/cambiar de usuario o pasar el día sin crearse.

### 5.10 Qué NO funciona (o funciona limitado) sin conexión
- **Solo online:** generar la ruta del día; optimizar recorrido; geometría por calles y estimaciones (degrada a rectas); iniciar **Crear ruta → Ver el recorrido** de una ruta aún no creada en el servidor; editar notas/borrar notas; abrir **Editar cliente** (necesita `reveal`); altas de teléfono/dirección desde editar, garantes, garantías y cambios de crédito; adjuntos del legajo; subir fotos de ubicación del cliente; «Mostrar mi QR»; **todo el módulo de Importación** (y Ajustes de importación); login, MFA, registro.
- **Con caché pero potencialmente viejo:** cartera, mora, fichas, rutas, pagos del día; la búsqueda sin red solo por nombre.
- **Pantallas tabs fuera de este documento** (Inicio, Agenda) tienen su propio comportamiento (Parte A).
- **Tiles de mapa:** sin packs descargados (no hay UI) el mapa depende de red; con red intermitente se verán zonas vacías.

---

## 6. Contradicciones documento ↔ código

| # | Documento | Dice | Código real |
|---|---|---|---|
| C-1 | `apps/mobile/CLAUDE.md` «SyncService» | Corre cada **30 s**, **3 intentos con backoff exponencial** | Cada **60 s** (`CICLO_MS`), tope de **3 intentos sin backoff**; reintento espaciado = eventos (reconexión/ciclo). Rechazos 4xx = `attempts 99` |
| C-2 | `apps/mobile/CLAUDE.md` «Flujo de evidencia», `plans/rutas/S5` §158 | «SHA-256 del buffer **original antes de comprimir**», calculado en el móvil, la API verifica | El móvil **no hashea**. Comprime primero y el **servidor** hashea lo recibido (`POST /uploads`); el hash reenviado es de la copia comprimida y no se re-verifica contra bytes en esta ruta |
| C-3 | `apps/mobile/CLAUDE.md` | `EvidenceCapture` «siempre foto + GPS + timestamp», `SignatureCapture` con canvas de firma | Foto **opcional** en 2 variantes; **no existe firma**; la app no manda `capturedAt` (el instante lo estampa el servidor al recibir) |
| C-4 | `plans/rutas/FUNDACION.md` §11 / README «Trigger de packs: Descargar mapa de zona en Rutas + espejo en Ajustes» | Hay acción de descarga y gestión | **No hay pantalla**; solo `offline-packs.service.ts` sin llamadores |
| C-5 | `apps/mobile/CLAUDE.md` «Expo Camera» y estructura | `expo-camera`/`ImageManipulator`, `SignatureCapture`, NativeWind en sección de design | Se usa `expo-image-picker` + `expo-image-manipulator`; sin firma; StyleSheet + tokens (el propio doc lo aclara arriba) |
| C-6 | `plans/import` README (según comentario en `import.service.ts`) | Los flags del gate llevan el `userId` | Claves **globales** del teléfono (`k_import_*`); dos cobradores en el mismo teléfono comparten el flag del día |
| C-8 | Copy de UI | «Generá la ruta con tus casos abiertos», `ROUTE_EMPTY` «No tenés casos abiertos» | El modelo ya no tiene «caso» (F4/08); son créditos en mora |

---

## 7. Hallazgos y riesgos detectados

- **H-1 · Parada registrada sin señal no cambia en pantalla.** No hay actualización optimista de la caché `route` al encolar la visita: al volver al mapa la parada sigue `PENDING` (y el avance/«Cobrado» del resumen no la cuentan hasta que la cola suba y se refresque). El cobrador podría registrarla dos veces; la segunda visita se rechazaría (`VISIT_STOP_DONE`) y, al ir el pago dentro de la visita, ese cobro no se enviaría. *Deducido del código; no verificado en dispositivo.*
- **H-2 · Tope del cobro por «monto en mora».** En Registrar resultado el tope y el resultado (`PAID` vs `PARTIAL_PAYMENT`) se calculan contra `overdueAmount` de la parada, no contra el saldo total; la hoja de pago de la ficha topea con el saldo. Qué envía el servidor como `overdueAmount` para un crédito al día no está verificado (si fuera 0 el cobro quedaría deshabilitado).
- **H-3 · «Agregar paradas en el mapa» sobre una ruta generada por el servidor.** `crear.tsx` deshabilita «Agregar al recorrido» si el día tiene ruta y el borrador local no tiene `routeId`; una ruta creada con «Generar ruta del día» no deja borrador, por lo que el botón de la pestaña Rutas lleva a un mapa donde no se puede agregar. *Por código.*
- **H-4 · No hay forma de corregir una visita** desde el móvil (el servidor lo soporta con `correctsVisitId`). La promesa de la visita siempre usa método `CASH` (no hay selector en esa variante).
- **H-5 · Tope del plan para el cobrador.** `hayLugar()` lee `GET /accounts/me`, que exige `account:read`; el cobrador no lo tiene (el propio código lo comenta en `tenantCurrency`), así que para él devuelve «hay lugar» y el aviso previo no se muestra; el freno real queda del lado del servidor. Moneda de «Nuevo préstamo» fija en BOB.
- **H-6 · Editar cliente offline es mínimo:** exige red para abrir; solo se encola si la señal se corta durante el guardado y solo para cambios repetibles.
- **H-7 · Cambio de `SCHEMA_VERSION` borra la cola** (hoy aceptado como «dev-only»). Antes de publicar una versión con cambio de esquema a teléfonos con trabajo pendiente hace falta migración de la cola.
- **H-8 · Logout con recorrido sin sincronizar lo pierde** (borrador de ruta); la cola de acciones sí se conserva.
- **H-9 · Sin pack de mapas** (C-4): «operación 100% offline en zonas sin señal» (objetivo del plan) no se cumple para el mapa.
- **H-10 · Rol supervisor:** ve FAB «Nuevo cliente», «Registrar préstamo» y botones de ejecución de ruta aunque el servidor lo rechace (la app no oculta por rol).
- **H-11 · Visitas offline sin `capturedAt`:** la hora registrada es la de llegada al servidor, no la del cobro en campo; el pago sí lleva `paymentDate` del dispositivo.

---

## 8. No verificado

- Comportamiento en dispositivo real (todo lo anterior sale de lectura de código y comentarios; no se ejecutó la app).
- Qué devuelve el servidor en `overdueAmount`/`currency` para créditos al día en las paradas (H-2).
- Si `route:execute` de un SUPERVISOR/ACCOUNT_ADMIN se comporta como se infiere del mapa de permisos (pueden existir overrides en DB).
- Si el backend acepta `capturedAt` enviado por la app en `POST /visits` (el DTO lo reconoce; la app no lo manda).
- Reglas exactas del servidor para rechazar una promesa de pago con fecha pasada creada desde Registrar resultado (el selector no pone `minimumDate`).
- Existencia/estado de pantallas de otras partes referenciadas (`/cuenta/perfil`, Inicio, Agenda): documentadas en la Parte A.
- Texto exacto y orden de campos de `CreditTermsFormView` (`src/credit-terms-view.tsx`) y de `ActivityTimeline`/`MetricsSection` (solo se resumieron por título).
- Estado de los slices del plan `docs/epics/F10/plans/rutas/S3`, `S4…S6` y de `plans/alineacion-web` (plan maestro en borrador según memoria del proyecto): no se contrastaron punto por punto.
