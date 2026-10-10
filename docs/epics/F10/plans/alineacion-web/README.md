> **ESTADO: EN EJECUCIÓN — ronda 3 (2026-10-10).** D-1…D-9 decididas y registradas en §13. **Implementado y probado:** D-4 (código), D-5-C, D-6, D-8 y la parte cuantificable de D-9; **pendiente:** 0.2, 0.4, 0.5, 0.7, 0.8 y las fases 1–6. **Bloqueado externamente:** verificación de push (Firebase + teléfono) y pinning en dispositivo, mapas offline (estilo propio). El estado de cada ítem refleja el código. **Ronda 4 (2026-10-10):** cuenta, agenda, mora, fotos, cifrado y pedidos de cambio construidos — ver §13.8; lo no construido y lo bloqueado está listado ahí.
> Plan maestro de alineación móvil ↔ web. Cada fase se detalla en su propio archivo just-in-time (`/f10-etapa`).

# F10 · Alineación del móvil con la web — plan maestro

## 0. Para qué

La web recibió en septiembre–octubre 2026 un rediseño grande (Rutas F4/12, Agenda F4/11, dashboard, fotos de la casa,
cuota a pagar, cambio de dirección de una parada, pedidos de cambio de ruta). **El móvil no consume casi nada de eso**:
`ef4e92f` (2026-10-08) cubrió planificación y tablero de hoy en API/web, y el blueprint dejó el móvil «solo después de
validar visualmente la web» (`docs/epics/F4/12-rutas-blueprint.md` §P).

La idea: **llevar al móvil lo que se hizo en web**, en este orden — Rutas → Agenda e Inicio → Usuarios/cuenta → Cartera →
Mora → Importación — **sin copiar la web**. El móvil es para el cobrador en campo (poca señal, sol, una mano); la
supervisión y la administración se quedan en la web. Y se **conserva lo que el móvil ya hace mejor**.

> Fuente: cinco análisis de solo lectura hechos el 2026-10-10 (rutas · agenda/inicio · cartera/mora · usuarios/import ·
> marco F10). Los puntos marcados **«verificar»** salen de la lectura de código sin ejecutarlo y se confirman en el plan
> detallado de cada fase.

## 1. Principios (no negociables)

| # | Principio | Por qué |
|---|---|---|
| P-1 | **Offline-first**: toda mutación nueva entra a la cola con **id fijado por el teléfono** (idempotente); nada bloquea esperando red. | `apps/mobile/CLAUDE.md`; ya es la regla vigente. |
| P-2 | **Decisiones F10 vigentes no se tocan**: expo-sqlite (D1), MapLibre única lib de mapas (D-MAP), CTA navy, «sin casos» (todo cuelga del crédito), StyleSheet + tokens. | Evita reabrir lo cerrado con la usuaria. |
| P-3 | **El API es la autoridad de permisos**: el móvil ofrece según `capabilities`/`permissions` y deja que el servidor valide; nunca decide permisos con caché. | Offline puede estar viejo. |
| P-4 | **Shared primero**: si la web y el móvil calculan lo mismo, la regla vive en `packages/shared` y se importa. | Dos pantallas no pueden decir números distintos. |
| P-5 | **El día es el de la empresa**, no el del reloj del teléfono ni el del servidor (UTC). | Bug de las 20:00 en UTC−4 ya sufrido en web. |
| P-7 | **El cobrador es independiente**: con la app de un solo usuario crea y administra su propia ruta, agenda y cartera sin manager; si hay manager, el equipo funciona **como en web** (la autoría decide). | Decisión D-2 (2026-10-10). |
| P-6 | **Una fase = un plan = una rama (`f10/…`)** y pasa el gate antes de tocar código; `main` se mantiene limpio. | Proceso F10 (BUILD-PLAN §1). |

### 1.1 Los dos perfiles de uso (D-2)

| Perfil | Quién es | Qué puede por sí mismo (verificado en código) |
|---|---|---|
| **Independiente** | Quien se registra solo: dueño de su cuenta (`ACCOUNT_ADMIN`, tiene `route:write/assign`). **Verificar** el rol que asigna el registro móvil. | Crea y edita sus rutas, agenda y cartera **directo**; no hay a quién pedirle nada. |
| **De equipo** | `COLLECTOR` con manager/supervisor (`route:read` + `route:execute`). | La API ya le deja **armar la suya** (`collectorFor`: el ejecutor solo arma la propia) → es su creador y la edita **directo**. |

**Regla única, la misma de la web (autoría):** la ruta la gobierna **quien la armó**. Sobre una ruta propia, el cobrador agrega,
quita, reordena, cambia dirección y cierra **sin pedir permiso**. Sobre una ruta que armó **otra persona** (manager), el
cobrador **propone** con motivo. Y si el cobrador armó la ruta y un supervisor le propone un cambio, el cobrador puede
**aprobar o rechazar desde el móvil**. "Ambos": proponer y decidir, según de quién sea la ruta. Un manager que quiera
**aumentar** paradas a la ruta de un cobrador lo hace **desde la web, como hoy**.

## 2. Qué NO se lleva al móvil (se queda en web)

Supervisión y administración, por rol y por uso en oficina: ranking de cobradores, tendencia, aging global, mapa del
equipo, KPIs de tenant, comparación entre períodos · asignar/reasignar/reemplazo/apoyo masivos · aprobar pedidos de cambio
de rutas **de otros** (sí se aprueban los de rutas propias: ver 1.1) · exportar CSV/PDF · castigar crédito · plan, facturación, plantillas · auditoría ·
advisor-links y mapeo avanzado de columnas · equipo masivo y roles MANAGER/AUDITOR/VIEWER · filtros por agencia/responsable.

## 3. Qué se conserva del móvil (y por qué)

| Qué | Por qué vale |
|---|---|
| Cierre de parada sin bloqueo: GPS con `gpsFallback`, visita + foto + cobro + promesa como ítems independientes en cola (`photo.lost` avisa) | Nunca se pierde una gestión en campo. |
| Ids fijados al abrir la pantalla + `Idempotency-Key = visit-<id>` | Cero doble cobro. |
| Borrador de ruta por diff, idempotente y por usuario | Se arma ruta sin señal. |
| **Posponer** con hora absoluta (+15/+30/+1 h) | **La web no lo tiene** (ver D-8). |
| Avisos locales de agenda (id por gestión, 15 min antes / inicio de franja) | Funcionan sin señal y sin la app abierta. |
| Acciones rápidas por fila (llamar, WhatsApp, navegar) con rastro | Una mano, sin abrir detalle. |
| Cálculo local del Inicio (`home.ts`) incluido lo cobrado en cola | El dato del teléfono es el más fresco. |
| Cartera agrupada por cliente + búsqueda global + filtros locales | Opera sin señal. |
| «Poner al día» / «Marcar en mora» desde la ficha | Atajo real de campo. |
| Biometría que solo desbloquea el token local, ventana offline de 8 h, borrado de caché al cambiar usuario/empresa conservando la cola | Seguridad sin perder trabajo. |
| `x-app-version`, `agenda-conflicts.ts`, «Ruta con ZIGZAG», navegar en el mapa propio | UX de campo ya pensada. |

## 4. Brechas, por módulo (resumen)

### Rutas — la que más falta
| Capacidad web | Móvil hoy |
|---|---|
| Ubicación concreta por parada (`locationId`) | No: el borrador descarta la elegida; el servidor guarda la principal. |
| Tipo y dueño de la dirección («Garante · Juan Pérez») | Parcial (solo al crear). |
| Fotos de la casa: miniatura en pin/lista + visor | No (`locationPhotoUrl(s)` ya llega en el JSON; no hay caché de imágenes). |
| Cuota a pagar al registrar + «usar este monto» | No: `resultado.tsx` arranca en `''` (la cuota ya viene en la parada). |
| Cambiar la dirección de una parada | No. |
| Pedidos de cambio (ADD/REMOVE/REORDER/CANCEL con motivo) y `capabilities` | No: `ROUTE_REQUEST_REQUIRED` sale como error genérico. |
| Cerrar con pendientes pidiendo motivo / cancelar ruta | No: «Cerrar igual» sin motivo (el API lo tolera por un shim `legacyField`). |
| Hora fija visible y «llega tarde» | No. |
| Ir en mapa / «estoy aquí» / `POST /routes/leg` | No (línea recta; sin `UserLocation`). |
| WhatsApp en la parada | No (solo «Llamar»). |
| Vista previa sin guardar (`plan-preview`) con ETA | Parcial (`GET /:id/preview`, ruta ya creada). |
| Historial de la parada: visitas, corrección, evidencia con hash | No. |
| `visitId` en el cobro | No (solo la llave de idempotencia). |
| Mapas utilizables en producción | **Falta**: sin `EXPO_PUBLIC_MAP_STYLE_URL` cae a OSM (solo dev); `offline-packs.service` no se invoca (sin UI de descarga). |

### Agenda e Inicio
Casi alineado. Faltan: **editar y eliminar no se encolan** (solo en línea) · vista Semana (ya hidratada, sin vista) ·
filtros tipo/estado · el Inicio no usa `GET /agenda/summary` · contactos efectivos y promesas del día · sin push remoto
(solo avisos locales) · contador del 🔔 en 0 offline. **Riesgos**: `home.ts` y `whenLabel` usan reloj del teléfono; el
filtro de `/payments` va en UTC; límite de 64 notificaciones locales en iOS (tope 50).

### Usuarios / cuenta / seguridad
Sesión, MFA (enrolar), biometría, invitar y cambiar rol ya existen. Faltan: **cambio voluntario de contraseña** ·
gestionar MFA (desactivar, códigos de respaldo) · **lista y revocación de sesiones/dispositivos** (los endpoints existen) ·
**gating por permiso** en el tab Más (hoy Importación y Mi cuenta se ven a todos; protege solo el 403) · QR del perfil
(**verificar**).

### Cartera
Faltan: miniatura/visor y «principal» de las fotos de la vivienda (hoy solo un ✓) · tipo y dueño de la dirección en la
lista «Contactos y ubicación» (hoy plana) · **alta de contacto/dirección sin señal** (**verificar**: un análisis dice que no se
encola y otro que sí, con ids `local:`) · adjuntos sin cola.

### Mora
Faltan: fijar prioridad (la web lo permite con `COLLECTION_WRITE`; el cobrador debería) · foto/tipo/dueño en «Cómo
ubicarlo» · notas solo en línea (decisión explícita; revisar). Reasignación, exportes y castigo no aplican.
> Nota: el revelado de PII en `/agenda/clients/:id/context` **sí** queda auditado en el servidor
> (`agenda_client_context / PII_REVEAL`); el análisis lo dio por no encontrado.

### Importación
Alineado en lo esencial (subir, preview con asignación, config y mapeo, compuerta en login). Falta gating por rol/permiso y
confirmar historial/detalle de corrida.

## 5. Fase 0 — Fundación transversal (antes de las pantallas)

> **Estado real (2026-10-10):** 0.1 ✅ · 0.6 🟡 (426 hecho; `ROUTE_*` como éxito/descarte visible pendiente) · 0.2 ⬜ · 0.3 ⬜ · 0.4 ⬜ (bloqueada: estilo propio) · 0.5 ⬜ · 0.7 ⬜ · 0.8 ⬜. Orden y criterios de salida: §13.2.

| Id | Entrega | Por qué es prerrequisito |
|---|---|---|
| 0.1 | **Manejo del 426 / versión mínima** (pantalla «actualizá la app») y política de `MIN_APP_VERSION`. | Para retirar el shim `legacyField` sin dejar APK viejos rechazados con un error críptico. |
| 0.2 | **Día de la empresa** en `home.ts`, `dueSoon`, `whenLabel`, `queuedCollectedToday` y el filtro de pagos (fin del `T23:59:59Z`). | P-5. Afecta Inicio, Agenda y Rutas. |
| 0.3 | **Shared**: mover lo duplicado que las fases siguientes tocan (cálculo del día de ruta/ETA/candidatas, agrupación de cartera) y fijar test de *parity* de tokens. | P-4; evita que web y móvil diverjan. |
| 0.4 | **Mapas en producción**: `EXPO_PUBLIC_MAP_STYLE_URL`, UI «Descargar mapa de zona» (servicio ya existe), punto «estoy aquí», cachear `getRoutePreview`. | Sin esto el mapa no sirve sin señal. |
| 0.5 | **Caché de imágenes** (fotos de la casa de lo que hay hoy en ruta) con tope y purga; **TTL/purga** del caché SQLite. | Fotos + gama baja. |
| 0.6 | **Cola**: tipos nuevos, `QUEUE_VERSION`, y tratar `ROUTE_REQUEST_STALE/RESOLVED/STATE_CHANGED/STOP_DONE/CLOSED` como éxito o descarte **visible** (no reintento infinito). | Las mutaciones de la fase 1 las necesitan. |
| 0.7 | **Cifrado de PII en reposo** (D-3, cerrada): cifrar el contenido de `cache` y `queue` con una llave de dispositivo en SecureStore; TTL y purga; ver 5.1. | Riesgo de seguridad real. |
| 0.8 | **RBAC mínimo** (P10 parcial): helper `can(permission)` y gating de entradas en Más y acciones. | P-3. |

### 5.1 Diseño del cifrado en reposo (D-3, decidida: «hagámosla»)

**Hecho verificado:** `expo-sqlite` instalado es **14.0.6** (SDK 51) y **no trae SQLCipher** (sin plugin ni mención en su
CHANGELOG). Cifrar el archivo entero exigiría subir de SDK; no es proporcionado para este plan.

**Diseño: cifrado a nivel de campo en la capa `db.ts`** (único archivo que escribe SQL, así que no se toca ninguna pantalla):
| Pieza | Decisión |
|---|---|
| Qué se cifra | La columna JSON de `cache` y el payload de `queue`. Las columnas de índice (`kind`, `id`, fechas, estado) quedan en claro y **sin PII**. |
| Algoritmo | AES-256-GCM (o XChaCha20-Poly1305) con nonce por fila, vía `@noble/ciphers` (JS puro, auditada, sin módulo nativo, pesa poco). **Verificar** rendimiento en gama baja con 150 fichas. |
| Llave | 256 bits aleatorios generados al primer arranque, guardados en **SecureStore** (Keystore/Keychain) con `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Nunca viaja ni se respalda. |
| Búsqueda | Ya es en memoria (`portfolio.ts`, `partitionDay`): no depende de SQL sobre el JSON. **Verificar** que ningún filtro use `json_extract`. |
| Migración | Subir `SCHEMA_VERSION`: el caché se descarta (es descartable) y la cola **se re-cifra en el arranque** (no se pierde: puede tener pagos). |
| Logout | `clearCache` ya borra el caché; **la cola sobrevive** (por diseño) pero cifrada; al cambiar de usuario/empresa, lo que no sea del nuevo usuario se rechaza visible (0.6). |
| Retención | TTL por tipo (ficha de cliente y contexto: 7 días; ruta: hasta cerrar + 2 días) y purga por tamaño. |
| Límite honesto | Protege contra extracción del archivo (backup, root, equipo robado y desbloqueado por otro medio). No protege si el teléfono está desbloqueado y comprometido en caliente. |

## 6. Fase 1 — Rutas (F4/12 en el móvil)

| Slice | Entrega | Detalles que importan |
|---|---|---|
| R1 | **Modelo y datos**: ubicación por parada en `RouteDraft` (`{creditId, locationId}`); tipo y dueño en lista/mapa/confirmar/resultado; **cuota precargada** y «usar este monto»; `visitId` en el cobro; hora fija visible; ocultar paradas sin punto. | Es lo barato y de mayor valor: los datos ya llegan en el JSON. |
| R2 | **Fotos de la casa**: miniatura en pin y lista, visor con principal, caché de imágenes. | Depende de 0.5. Diseño tomado de la web (`photo-viewer`). |
| R3 | **Cambiar la dirección de una parada** (`PATCH stops/:sid {locationId}`) con cola; elegir ubicación por candidata al crear. | Si la ubicación se borró en el servidor, la cola relee y pide elegir de nuevo. |
| R4 | **`capabilities` + pedidos de cambio** (regla de autoría, 1.1): leer `capabilities`/`pendingRequests`; en ruta ajena, diálogo de motivo y `POST change-requests` con cola; en ruta propia con pedidos de otros, **bandeja para aprobar/rechazar**; «Mis pedidos». | API: el DTO no acepta `id` del teléfono → añadirlo o deduplicar por `kind+payload+routeId` (ver D-2). |
| R5 | **Cerrar con pendientes pidiendo motivo ✅ (implementado, §13.4); cancelar ruta ⬜; retirar el shim `legacyField`:** tolerancia por versión hecha (opción C), retiro completo = opción B condicionada (§13.4). | Requiere 0.1 ✅ y 0.6 ✅. |
| R6 | **Ir en mapa / «estoy aquí» / `POST /routes/leg`** (online, con respaldo a recta), **WhatsApp** en la parada, **vista previa sin guardar** (`plan-preview`) con ETA y «llega tarde». | `actionLinks` ya existe; el mapa propio sigue siendo el destino de «Navegar». |
| R7 | **Historial de la parada**: visitas, corrección (`correctsVisitId`), evidencia con hash. | Solo lectura; inmutable. |

## 7. Fase 2 — Agenda e Inicio

| Slice | Entrega |
|---|---|
| A1 | **Cola para editar y eliminar gestiones** (`agenda.update`/`agenda.delete`); el 403 por autoría es rechazo permanente (doc F4/09 §3.5). |
| A2 | Inicio: **contactos efectivos y promesas tomadas hoy**, **promesas que vencen hoy**, usar `GET /agenda/summary` (día de empresa), ruta en curso. **Sin** ranking/tendencia/aging. |
| A3 | Vista **Semana** (ya hidratada) y filtros por tipo/estado (baja prioridad). |
| A4 | **Notificaciones**: contador offline desde caché; asignación/cambios al hidratar. El **push remoto** es la etapa D-4, ya implementada en código y pendiente de verificar en dispositivo (§13.3, `PUSH-FCM.md`). |
| A5 | Revisar notificaciones iOS (64 máx.) priorizando las próximas 48 h. |

## 8. Fase 3 — Usuarios, cuenta y seguridad

| Slice | Entrega |
|---|---|
| U1 | **Cambio voluntario de contraseña**. |
| U2 | **Gestionar MFA** (desactivar, códigos de respaldo) y política de «lo hago después» para admin (CRITICAL_ROLES). |
| U3 | **Sesiones/dispositivos**: listar y revocar (endpoints `GET/DELETE /auth/sessions`). |
| U4 | **Gating por permiso** en Más/Mi cuenta/Importación (usa 0.8). |
| U5 | Perfil: QR de cobro (**verificar**). Equipo (≤5) no cambia. |

## 9. Fase 4 — Cartera

| Slice | Entrega |
|---|---|
| C1 | Fotos de la vivienda con **miniatura, principal y visor**; en el formulario, marcar principal y quitar. |
| C2 | **Tipo y dueño** de cada dirección en la ficha y en «Contactos y ubicación». |
| C3 | **Alta de contacto/dirección sin señal** (cola con id local) — **verificar** estado real antes de planificar. |
| C4 | Adjuntos con cola (baja prioridad). |

## 10. Fase 5 — Mora

| Slice | Entrega |
|---|---|
| M1 | **Fijar prioridad** desde la ficha (con cola). |
| M2 | Foto, tipo y dueño de la ubicación en «Cómo ubicarlo». |
| M3 | Notas: decidir si se permite editar/borrar sin señal (hoy solo en línea). |

## 11. Fase 6 — Importación

| Slice | Entrega |
|---|---|
| I1 | Gating por permiso (`client:import`) y por rol en la entrada de Más. |
| I2 | Verificar historial/detalle de corrida y descarga; el resto (advisor-links, mapeo avanzado) queda en web. |

## 12. Cambios de API / shared que este plan requiere

| Cambio | Para |
|---|---|
| `POST /routes/:id/change-requests` acepta `id` del cliente (idempotente) o dedupe documentado | R4 |
| Fecha de subida de cada foto de ubicación (opcional) | R2/C1 (la web también lo pidió) |
| `GET /routes/:id` ya trae `capabilities`/`pendingRequests`: confirmar contrato y moverlo a `shared` | R4 |
| Retiro del shim `legacyField` condicionado a `MIN_APP_VERSION` | R5 |
| Tipos de la cola nuevos en el contrato del móvil (no del API) | 0.6 |

## 13. Registro de decisiones

> Estados: **decidida** (hay decisión, sin código) · **implementada** (código + pruebas automáticas) · **verificada** (probada
> además en el entorno real: dispositivo, producción) · **bloqueada externamente** (falta algo que no está en el repo).
> Fecha del registro: 2026-10-10. El estado refleja el código, no la intención.

| # | Decisión | Estado | Resumen |
|---|---|---|---|
| D-1 | Orden de la Fase 0 | **decidida** (aplicada en esta pasada) | 0.1 y 0.6 primero; 0.2 y 0.8 en paralelo; 0.7 antes de R2/C1; 0.4/0.5 en paralelo a R1–R3 (§13.2) |
| D-2 | Pedidos de cambio y cobrador independiente | decidida | La autoría decide (§1.1) |
| D-3 | Cifrado de SQLite/cola | decidida · **pendiente de implementar** (0.7) | Diseño en §5.1; no entra en esta pasada |
| D-4 | Push remoto FCM + pinning real | **implementada**, **bloqueada externamente** para verificar | Backend y app completos y probados; falta Firebase + teléfono (§13.3) |
| D-5 | Retiro de `legacyField` | **C implementada**; B planificada | Tolerancia por versión (§13.4) |
| D-6 | Planificar varios días | **implementada** (API + móvil) | Ventana 0–14 días (§13.5) |
| D-7 | Diseño web adaptado | decidida | §13.1 |
| D-8 | Posponer solo en móvil | **implementada** (API + móvil) | Opción A (§13.6) |
| D-9 | Presupuesto de fotos y mapas | **implementada** en lo cuantificable; resto en Fase 0 | §13.7 |

### 13.1 Cómo se adapta cada pieza de la web al móvil (D-7)

La web es para pantalla grande con puntero; el móvil, para una mano, sol y poca señal. **Se conserva la información y el
orden visual; cambia la interacción.**

| Pieza web | En el móvil | Por qué |
|---|---|---|
| Fila de parada: número, foto, nombre, dirección, chips, fila de acciones, ⋯ | `StopCard`: foto 56 dp, nombre y dirección a todo el ancho, chips (estado, monto, días, hora fija); **acciones ≥ 52 px**: primaria «Registrar», secundarias (WhatsApp, Llamar, Ir en mapa) como íconos con etiqueta corta; ⋯ abre una **hoja inferior** | Botones táctiles grandes; sin hover. |
| Pin con miniatura en todos los puntos | Foto **solo en la parada siguiente y la seleccionada** (o al hacer zoom ≥ 15); el resto, pin numerado | Rendimiento en gama baja y legibilidad. |
| Visor de fotos (diálogo centrado, flechas, barra de zoom) | **Pantalla completa**, paginado por deslizamiento, pellizco para zoom, «Principal» y «n de total», cerrar con X o gesto | Gestos nativos; flechas y barra sobran. |
| Modal «Ubicación de {cliente}» | **Hoja inferior alta**: tarjetas por dirección (ícono de tipo, dueño y relación, dirección, miniatura, «sin punto»); «Agregar dirección» y «Marcar en el mapa» abren pantalla propia | El modal de 880 px no cabe; el mapa necesita pantalla. |
| Registrar gestión (diálogo) | La pantalla `resultado.tsx` existente + bloque **«Cuota a pagar Bs 450 · vence 07/10» con «Usar este monto»** sobre el monto | No se rehace; se enriquece. |
| Pedir cambio (diálogo con motivo) | Hoja inferior con motivo (mínimo de caracteres) y envío; estado en «Mis pedidos» con chips Pendiente/Aprobado/Rechazado | Mismo flujo, formato móvil. |
| Hover resalta pin; «Ir en mapa» centra | **Tocar la fila selecciona** (resalta el pin sin mover la cámara); «Ir en mapa» centra con zoom ≥ 16 | No hay hover; igual que la web decidida. |
| Tabla «Hoy» con filtros por cobrador/estado | **No existe**: el cobrador ve **su** ruta. Es vista de supervisión (queda en web) | No aplica al rol. |
| Tarjeta de KPIs del dashboard | Los `StatTile` del Inicio (ya existen), con los indicadores personales de la fase 2 | Ya alineado. |
| Cuota, tipo y dueño, fotos, ETA | Mismos datos y mismas reglas (de `shared`) | P-4. |
| Estados sin red | Acciones que **requieren red** (`routes/leg`, `plan-preview`) se degradan visiblemente (recta, «sin ETA») y lo dicen | P-1. |

**Tokens:** `theme.ts` espeja `k-*` de la web (paridad probada por test, 0.3); CTA navy; contraste ≥ 4.5:1 bajo el sol.

### 13.2 D-1 — Orden definitivo de la Fase 0

**Recomendación original del plan:** «antes de R4/R5 solo 0.1 y 0.6; 0.4/0.5 en paralelo a R1–R3». **Se contrastó con el
código y se confirma, con tres precisiones:**

| Evidencia encontrada | Consecuencia |
|---|---|
| `isPermanentRejection` trataba el 426 como rechazo definitivo (`sync/queue.ts`) y la app no manejaba `APP_001` (grep sin resultados) | 0.1 y 0.6 **bloquean** a R5/D-5-B: sin ellos, activar `MIN_APP_VERSION` descartaría cobranzas de la cola. Hecho en esta pasada |
| `legacyField` solo se puede retirar si la app envía `reason` (`resumen.tsx` no lo mandaba) | R5 (cerrar con motivo) es **prerrequisito de D-5-C** y se implementó junto con él |
| `change-requests` no acepta `id` del teléfono (DTO) | R4 depende de un cambio de API (no hecho): **no** se adelanta |
| El caché de imágenes (0.5) necesita el presupuesto de D-9 | Se definió D-9 primero (constantes en `shared`); 0.5 queda desbloqueada |
| `0.7` (cifrado) toca `db.ts`, único archivo que escribe SQL | Debe ir **antes** de R2/C1: no se suman fotos y más fichas a un caché sin cifrar |

**Orden vigente (✅ = hecho en esta pasada):**

```
Etapa A (prerrequisitos, estrictamente secuencial)
  0.1 Manejo del 426 ✅ ──► 0.6 Cola: 426 no es rechazo ✅ (y ROUTE_* como éxito/descarte visible ⬜)
Etapa B (en paralelo con A, sin dependencia mutua)
  0.2 Día de la empresa ⬜     0.8 RBAC mínimo ⬜     D-4 push + pinning ✅(código)     D-9 constantes ✅
Etapa C (después de A)
  R5 cerrar con motivo ✅ ──► D-5-C ✅ ──► (cuando haya flota) D-5-B ⬜
  0.7 Cifrado en reposo ⬜ ──► R2 fotos de la casa / C1 ⬜
Etapa D (en paralelo a R1–R3)
  0.4 Mapas en producción ⬜ (bloqueada: estilo propio)   0.5 Caché de imágenes ⬜
D-6 multi-día ✅ (independiente) · D-8 posponer ✅ (independiente)
```
**Criterios de salida de la Fase 0:** 0.1, 0.6, 0.7 y 0.8 en verde en `type-check` + `jest` + `expo export`; sin PII en
claro en `kobrax.db` (verificado abriendo el archivo); un 426 simulado deja la cola intacta.

### 13.3 D-4 — Push remoto FCM directo (Android) y SSL pinning real

**Estado: implementada y probada; NO verificada en dispositivo; bloqueada externamente** (proyecto de Firebase, cuenta de
servicio, `google-services.json`, teléfono Android físico). Guía de activación paso a paso: **`PUSH-FCM.md`**.

- **Decisión final:** FCM HTTP v1 directo, **sin `firebase-admin` ni Expo Push ni EAS** (cero dependencias nuevas en la API;
  JWT RS256 con `node:crypto`). Alternativas descartadas: Expo Push (depende de un servicio y de EAS para credenciales; el
  proyecto hace builds locales con `prebuild`); `firebase-admin` (sumaba una dependencia grande y un cambio de lockfile).
- **Compatibilidad validada con el repo:** Expo SDK 51, `expo-notifications ~0.28.19` (ya instalado), `android.package`
  `demo.kobrax.mobile`, sin `eas.json` ni carpetas nativas versionadas → `app.config.js` agrega `googleServicesFile` solo si
  el archivo existe; el build no se rompe sin él.
- **Backend (`apps/api/src/modules/notifications/push/`):** tabla `device_push_tokens` (RLS forzada, único
  `(empresa, usuario, instalación)`, índices); `POST/GET/DELETE /api/notifications/devices` (siempre del usuario de la
  sesión: el `userId` nunca sale del cuerpo ni de la URL); `FcmClient`; `PushService` (lista **cerrada** de 6 tipos, texto
  genérico, reintento acotado, baja de tokens muertos, **nunca lanza**); canal `push` enganchado a `notifyUser`.
  Credenciales: `FCM_SERVICE_ACCOUNT_JSON_B64` o `FCM_SERVICE_ACCOUNT_FILE` (opcionales; sin ellas el envío queda apagado).
- **Móvil:** registro tras autenticarse (idempotente), renovación de token, revocación al cerrar sesión, handler que
  descarta el aviso si `uid` ≠ usuario de la sesión, navegación al tocar (app abierta, en segundo plano y **cerrada**:
  `getLastNotificationResponseAsync` + destino pendiente que consume `routeAfterAuth`).
- **Eventos:** `ROUTE_ASSIGNED`, `ROUTE_CHANGE_REQUESTED`, `ROUTE_CHANGE_DECIDED`, `AGENDA_ASSIGNED`, `AGENDA_CHANGED`,
  `PROMISE_DUE`. Destinatarios y condiciones: **los de los emisores existentes** (no se tocaron). Sin duplicados: el canal
  se invoca una vez por notificación persistida y el push lleva `tag = id`.
- **Pinning real:** `plugins/with-ssl-pinning.js` reescrito (valida pins/dominio/expiración, falla el build ante config
  inválida, no pisa un NSC ajeno). **Pins medidos del certificado de producción** (`api.kobrax.ikigaisystems.lat`, jerarquía
  Let's Encrypt YE): intermedia YE2 + Root YE + Root X2, con `expiration 2027-09-30`. El dominio estaba mal en `app.json`
  (`api.kobrax.com`). Verificado con `expo prebuild --platform android`: genera `network_security_config.xml` con los 3 pins
  y el manifest lo referencia. **Falta** probarlo en teléfono con un proxy (ver `docs/security/SSL-PINNING-MOVIL.md`).
- **Archivos:** API `notifications/push/*`, `notification-channel.ts`, `notifications.module.ts`, `config/*`; DB migración
  `20261010000000_device_push_tokens` + `rls/001_enable_rls.sql`; móvil `src/push*.ts`, `app/_layout.tsx`,
  `src/post-login.ts`, `src/auth-service.ts`, `app.config.js`, `plugins/with-ssl-pinning.js`; infra `05-app.sh`, `.env.example`.
- **Pruebas:** API 28 unitarias (`push.spec.ts`) + 9 de integración contra Postgres real (`push-devices.it.ts`); móvil
  `push-target` (7), `push-pending` (3), plugin de pinning (20).
- **Criterios de aceptación pendientes (los de `PUSH-FCM.md §3`):** token en `device_push_tokens` tras iniciar sesión; push
  con app cerrada abre la pantalla correcta; otro usuario en el mismo teléfono no lo ve; el proxy falla con el pin puesto.
- **Riesgos residuales:** revocación al cerrar sesión sin red es de mejor esfuerzo (cubre el `uid`); FCM no garantiza
  entrega (Doze); la `expiration` del pin-set hay que subirla en cada release; Android < 7 ignora el NSC; iOS fuera de alcance.
- **Relación con el pinning:** etapa **independiente** de las funcionalidades offline pero **cerrada junto** al pinning.
  Hasta la prueba en dispositivo de ambos, la etapa figura como «implementada, sin verificar» — no como terminada.

### 13.4 D-5 — Retiro de `legacyField` (opción C ahora, B después)

**Estado: C implementada y probada; B planificada, no activada.**

- **Qué cambió:** `RequestContext.appVersion` (el interceptor lee `x-app-version`, recortada a 32 caracteres) →
  `RoutesService.updateStatus` calcula `legacyClientReason(version, '1.1.0')`. La tolerancia («el cobrador cierra SU ruta con
  paradas sin gestionar sin motivo») aplica **solo** a un cobrador sobre su propia ruta **y** a un cliente cuya versión es
  menor a `1.1.0`, ausente o ilegible. Una app ≥ 1.1.0 sin motivo recibe `ROUTE_REASON_REQUIRED`.
- **Contrato del motivo:** `PATCH /routes/:id {status, reason?}`; `reason` 5–500 caracteres (`isValidReason`). La app
  nueva (`resumen.tsx`) lo pide, lo manda y lo **encola con su motivo** (`route.status` con `reason`, valor fijo →
  idempotente). Se corrigió además un hueco: con sesión vencida el cierre se perdía en silencio; ahora se encola.
- **Versión ausente / inválida:** se tolera (es la conducta de hoy: la web no manda el header y ya valida en su UI) y **queda
  marcado** en la auditoría (`after.legacyCompat = version_missing | version_invalid | version_below`, más `appVersion`).
  🔴 **No es una puerta de seguridad**: el header lo controla el cliente. Solo decide una regla funcional/de auditoría;
  autenticación, permisos, alcance y las demás reglas (cancelar exige motivo, rutas ajenas, estados) no dependen de él.
- **Cola offline:** un 426 ya no es rechazo permanente ni cuenta intento (`isPermanentRejection`, `drain`); el cierre
  encolado antes de actualizar sale solo al actualizar. Reintentos idempotentes: cerrar una ruta ya cerrada devuelve lo mismo.
- **Pruebas:** API 8 nuevas en `routes.service.spec` (viejo sin motivo tolerado y marcado; nuevo sin motivo rechazado; nuevo
  con motivo; motivo corto; header ausente/ilegible/manipulado; la versión no afloja permisos ni cancelar; idempotencia) + 3 en
  `app-version.spec`; móvil: cola (426), servicio (motivo), `UpgradeGate`.
- **Pasar de C a B — criterios verificables (todos deben cumplirse):**
  1. **Distribución conocida:** existe un canal de actualización (hoy el bloqueante «cuenta de Google Play de empresa» de
     `docs/business/PRICING-Y-DEPLOY.md` §1/§9; el producto aún no está desplegado) y hay un build con `versionCode ≥ 10100` publicado.
  2. **Inventario de flota:** cero cierres tolerados en 14 días:
     ```sql
     SELECT date_trunc('day', created_at) AS dia, after->>'legacyCompat' AS motivo, after->>'appVersion' AS version, count(*)
     FROM audit_logs WHERE entity = 'route' AND action = 'UPDATE' AND after ? 'legacyCompat'
       AND created_at > now() - interval '14 days' GROUP BY 1,2,3 ORDER BY 1 DESC;
     ```
  3. **Pantalla de actualización publicada** en la versión mínima que se exigirá (el `UpgradeGate` está en 1.1.0): `MIN_APP_VERSION`
     solo puede ser ≥ 1.1.0.
  4. **Comunicación a usuarios** y fecha anunciada; **recuperación:** dejar `MIN_APP_VERSION` vacío apaga el corte al instante
     (el guard exime `/auth` y `/health`, así que la app vieja puede cerrar sesión y ver el aviso).
  5. **Validación del impacto en la cola:** con un 426 simulado, la cola queda intacta (probado) y se reanuda al actualizar.
  Si no hay Play Store ni forma de actualizar la flota, **B no se activa**: se deja C.

### 13.5 D-6 — Planificar varios días

**Recomendación original:** «propia y de varios días; otros cobradores es de supervisión (web)». **Contrastada con el
modelo:** se confirma y no hizo falta migración.

- **Evidencia:** `route_plans` ya tiene `@@unique([accountId, collectorId, plannedDate])`; `assertNotPast` ya permitía hoy y
  futuro; `GET /routes` ya acepta `from`/`to`; `createId` persistido hace idempotente el reintento. Faltaban un **tope hacia
  adelante** (no había ninguno) y que el móvil dejara de estar atado a `todayISO()`.
- **Reglas:**
  1. Se arma una ruta para **hoy ≤ día ≤ hoy + 14** (día de la empresa). Más lejos: `422 ROUTE_TOO_FAR`. Pasado: `ROUTE_PAST_DATE`.
     14 = dos semanas: cubre «planifico la próxima semana» con holgura; más lejos la cartera, las visitas agendadas y las
     direcciones ya cambiaron. Constante `ROUTE_MAX_DAYS_AHEAD` en `shared` (la API es la autoridad; la app solo no ofrece lo que rebotaría).
  2. **Una ruta por cobrador y día** (`ROUTE_DUPLICATE_DAY`), sin importar el estado. Las pantallas marcan los días que ya tienen ruta.
  3. **Planificar una ruta futura ≠ operar la jornada.** La fecha solo se valida al **crear**; modificar una ruta ya armada
     (agregar/quitar/mover paradas, cerrar) no pasa por la regla de fechas y sigue gobernada por autoría y estado.
  4. **Cambiar la fecha de una ruta no existe** y no se agrega: el camino es cancelar la ruta `PLANNED` (sin visitas) y armar
     otra. Motivo: una parada puede estar ligada a una visita agendada con su propia fecha; mover la ruta dejaría la agenda y
     la ruta en días distintos.
  5. **Un mismo crédito puede estar en rutas de días distintos** (visitas de seguimiento legítimas); el modelo no lo impide y
     no se agrega una restricción. El choque del mismo día entre cobradores lo evita el planificador con `excludeRouted`.
  6. **Otros cobradores:** quien tiene `route:assign/write` (web, o un administrador en móvil) elige cobrador; el ejecutor
     solo arma la **suya** (`collectorFor`, ya existente).
- **Offline y sincronización:** un borrador **por día** bajo la misma clave del usuario (formato viejo legible sin migrar);
  `createId` fijado y persistido antes de llamar; el motor de sync sincroniza **todos** los días pendientes y descarta los
  pasados que nunca se crearon; un día sin señal corta y reintenta. Zonas horarias: `todayISO()` (día de la empresa), nunca el
  reloj del teléfono ni UTC.
- **Validación:** backend (fechas, duplicado, autoría); la interfaz solo ofrece días válidos y marca los ocupados.
- **Archivos:** API `routes.service.ts` (`assertPlannable`), `routes.errors.ts`; shared `route-rules.ts`; móvil
  `route-days.ts`, `route-draft.ts`, `app/rutas/crear.tsx`, `sync/sync.service.ts`.
- **Pruebas:** API 5 (límites 0/+1/+7/+14/+15, `generate`, un día por cobrador, reintento idempotente) + suite de integración
  contra Postgres real; móvil 4 (`route-days`) + 11 (borradores de varios días).
- **Criterios de aceptación:** armar hoy y mañana sin pisarse; el día 15 se rechaza con mensaje; un día con ruta no se re-arma;
  un borrador de ayer no sobrevive; sin señal, los dos días suben al reconectar sin duplicar rutas.

### 13.6 D-8 — Posponer una gestión (solo móvil)

**Decisión: opción A.** La web sigue con **Reagendar** (cambia el día, exige motivo, deja la cadena histórica). **No** se crea
pantalla web ni ruta BFF. *Razón:* Posponer es una herramienta de campo («voy tarde / me pidieron más tarde»), sin motivo ni
cambio de día; en oficina el supervisor reagenda con trazabilidad. Mezclarlos en web invitaba a confundirlos.

- **Defectos reales encontrados y corregidos:**
  1. Cruzar la medianoche movía la gestión **al día siguiente en silencio** (era Reagendar sin motivo). Ahora: `422
     AGENDA_POSTPONE_RULE` y la app explica «usá Reagendar».
  2. Una gestión vencida **de hoy** se posponía sobre su hora vieja y seguía en el pasado. Ahora parte de «ahora».
  3. Una gestión de un **día que ya pasó** se «posponía» sin sentido. Ahora: regla `past-day` → Reagendar.
  4. `toTime` igual o anterior a la actual (o a «ahora») se aceptaba. Ahora se rechaza (`not-later`).
  5. El reenvío de la cola de un `toTime` ya aplicado salía rechazado: ahora es **idempotente** (éxito, sin re-auditar).
  6. Local: sin hora destino el parche era `{}` (el aviso quedaba viejo y la lista sin cambiar); la franja no se anulaba; el
     aviso no se reprogramaba. Corregido.
  7. Auditoría `POSTPONE` solo guardaba `after`: ahora lleva `before` (fecha/hora/modo/franja) y `via` (`minutes|toTime`); el
     actor sale del contexto (como el resto).
- **Reglas finales:** pasos 15/30/60 o hora exacta; **mismo día**; hacia adelante; permanece `SCHEDULED` con hora fija; sin
  motivo; solo el asignado (alcance existente) → 404 para otro.
- ⚠️ **Cambio de contrato para clientes viejos:** quien mandaba `minutes` a las 23:50 antes pasaba al día siguiente; ahora
  recibe 422. Es lo pedido (no confundir con Reagendar) y los 4xx de la cola salen con explicación (`agenda-conflicts`).
- **Pruebas:** API 14 de posponer en `agenda.service.spec` (incrementos, límite 23:30+15 sí / 23:50+15 no, desde ahora, día
  pasado, día futuro, `toTime`, idempotencia, alcance); móvil 5 (`postponeTarget` desde ahora) + 1 (explicación 422).
- **Riesgo residual:** el teléfono calcula «ahora» con su reloj y el servidor con el de la empresa: ante una diferencia el
  servidor es la autoridad y puede rechazar (se explica al cobrador).

### 13.7 D-9 — Presupuesto de fotos y mapas offline

**Recomendación original:** «descargar solo la principal de lo que hay hoy en ruta; tiles por zona a pedido». **Se
cuantificó** (constantes y derivación en `packages/shared/src/constants/offline-budget.ts`, con pruebas):

| Concepto | Valor | Derivación / evidencia |
|---|---|---|
| Lado largo de una foto | **1280 px** | sobra para reconocer una fachada o leer un comprobante; 12 MP → ~1 MP |
| Peso máximo individual | **800 KB** | la regla que el CLAUDE.md del móvil ya fijaba y nadie cumplía; el servidor acepta 8 MB |
| Calidad JPEG | escalera **0.7 → 0.55 → 0.4** | un escalón por pasada, siempre desde la original |
| Estimación por foto tras comprimir | ~150–350 KB | supuesto declarado (≈1.4 bits/px a q0.7); medir en campo |
| Jornada pesimista | 35 fotos ≈ **27 MB** | 30 paradas × 1 + 5 extras × 800 KB |
| Fotos pendientes (tope) | **150 MB** (~5 jornadas sin sincronizar), aviso al 80 % | al tope se bloquea la foto **nueva**; **nunca** se borra lo pendiente |
| Caché de imágenes de ubicaciones | **40 MB**, LRU, solo la principal | 30 paradas × ~250 KB ≈ 7.5 MB + próximas rutas + margen del visor |
| Pack de mapa | radio **10 km**, zoom **10–15**, ≤ 1 500 tiles | referencia: **526 tiles ≈ 12.8 MB**; con z16 serían 1 822 (≈ 44 MB) y con 15 km/z16 3 836 (≈ 94 MB) |
| Regiones / total de packs | **3** / **150 MB** | peor caso 3 × 1 500 × 25 KB ≈ 110 MB |
| Caché SQLite | **7 días**, tope **50 MB** | PII de fichas: retener más es riesgo sin beneficio |
| Presupuesto total de la app | < 400 MB | muy por debajo del GB que puede faltar en un teléfono de gama baja |

- **Implementado:** constantes + funciones puras (`estimatePackTiles`, `decidePack`, `nextPhotoQuality`, `canQueuePhoto`) con
  12 pruebas; **compresión de fotos** en el móvil (`photo-compress.ts` + `expo-image-manipulator ~12.0.5`, dependencia nueva) con
  9 pruebas de la lógica; **cupo de pendientes** que bloquea la foto nueva con mensaje claro; **diagnóstico** en «Sin subir»
  (cantidad y MB frente al tope); **presupuesto de mapas** antes de descargar (`pack-budget.ts`, 6 pruebas) y defaults del
  servicio bajados de 15 km/z16 a 10 km/z15.
- **No implementado (pertenece a la Fase 0, no a esta pasada):** caché de imágenes con LRU (0.5), TTL/purga de SQLite (0.5/0.7),
  UI de «Descargar mapa de zona» y «estoy aquí» (0.4), barrido de fotos huérfanas.
- **Mapas — proveedor y licencia:** MapLibre `OfflineManager` **soporta** packs offline, pero **ninguna pantalla lo invoca** y el
  estilo de respaldo es el raster público de OSM, cuya política **prohíbe la descarga masiva**. El servicio ya se niega a
  descargar sin `EXPO_PUBLIC_MAP_STYLE_URL`. **Bloqueo externo:** tiles propios (R2 sin aprovisionar). No se afirma soporte
  offline completo hasta tenerlos.
- **Supuestos a medir:** peso real por escena, fotos por jornada, peso medio de un tile (25 KB). Revisar los valores cuando
  haya 2 semanas de telemetría de campo, si el 95 % de las jornadas supera el 50 % del tope de pendientes, o si aparece un
  teléfono con < 2 GB libres.
- **Hash de evidencia:** el servidor calcula el SHA-256 del archivo **que recibe** (el comprimido): es el que queda
  almacenado y es el inmutable. El original no se conserva (distinto de lo que decía el CLAUDE.md del móvil).

### 13.8 Ronda 4 — módulos restantes (2026-10-10)

> Estado real, no la intención. ✅ = código + pruebas automáticas · 🟡 = hecho a medias (se dice qué falta) · ⬜ = no construido ·
> 🔒 = bloqueado por algo externo. **Nada de esto está verificado en un teléfono**: faltan push, pinning, y recorrer cada pantalla.
> Auditoría de reuso previa (Paso B) hecha por área sobre el código; los hallazgos que cambiaron el plan están en cada fila.

**Fundación (Fase 0)**

| # | Estado | Qué hay / qué falta |
|---|---|---|
| 0.1 / 0.6 | ✅ | El código estable del servidor (`ROUTE_*`, `VISIT_*`) viaja en `MutateResult` y `SendResult`; un 426 no descarta la cola; los rechazos quedan visibles en «Sin subir» |
| 0.2 | 🟡 | Pagos del día por `GET /payments?day=` (API nueva, día civil de la empresa); «hoy» en gestión/promesa/alta usa el día de la empresa. **Falta** `home.ts` (usa el reloj local del teléfono: correcto si el teléfono está en la zona de la empresa) |
| 0.3 | 🟡 | `haversineKm` y `formatDistanceKm` pasan a `shared` (web y móvil). Quedan 4 copias de `addDays` |
| 0.4 | 🔒 | Mapas offline: falta estilo propio (`EXPO_PUBLIC_MAP_STYLE_URL`); el raster de OSM prohíbe la descarga masiva |
| 0.5 | ✅ | Caché de imágenes (`image-cache.ts`: LRU 40 MB, se vacía al cerrar sesión), precarga de la principal de las paradas pendientes, poda del caché SQLite (7 días / 50 MB) |
| 0.7 | ✅ | Caché y cola cifrados (XChaCha20-Poly1305, llave en SecureStore, migración perezosa sin subir `SCHEMA_VERSION`). **Dependencia nativa nueva (`expo-crypto`): hace falta un nuevo `prebuild`.** Rendimiento en gama baja sin medir |
| 0.8 | ✅ | `src/permissions.ts` (`can`); reemplaza los literales de cuenta y gatea Importación. Solo UX: la API autoriza |

**Rutas**

| # | Estado | Qué hay / qué falta |
|---|---|---|
| R1 | 🟡 | ✅ ubicación elegida por crédito en el borrador y al crear la parada · ✅ tipo/dueño, hora fija, cuota y «sin punto» en la parada del mapa · ✅ «Cuota a pagar · Usar este monto» · ✅ el cobro viaja con `visitId`. ⬜ tipo/dueño en la lista de Rutas y en confirmar/resultado |
| R2 | 🟡 | ✅ miniatura y visor (paginado) en la parada, la ficha del cliente y «Cómo ubicarlo». ⬜ foto en el pin del mapa · ⬜ zoom por pellizco (no hay gesture-handler) |
| R3 | ✅ | «Otra dirección» en la parada (PATCH `locationId`) con cola `route.stop.location` |
| R4 | 🟡 | ✅ API: `id` del teléfono en `POST change-requests` (reintento no duplica; `ROUTE_REQUEST_ID` si es ajeno) · ✅ pantalla de pedidos: aprobar, rechazar, retirar, **pedir cancelar** · ⬜ pedir agregar/quitar/reordenar paradas desde el móvil |
| R5 | ✅ | Cancelar ruta con motivo (con señal directo, sin señal a la cola); respeta `capabilities.cancel` |
| R6 | 🟡 | ✅ WhatsApp, «Ir en mapa», «Estoy aquí» (con distancia) · ⬜ `POST /routes/leg`, `plan-preview` y «llega tarde» |
| R7 | 🟡 | ✅ historial de la parada (solo lectura, en línea) · ⬜ corregir una gestión (`correctsVisitId`) · ⬜ ver la evidencia con su hash |

**Agenda / Inicio**

| # | Estado | Qué hay / qué falta |
|---|---|---|
| A1 | ✅ | Editar y eliminar gestiones sin señal (`agenda.update` / `agenda.delete`); lo eliminado sale de listas, contadores y avisos |
| A2 | 🟡 | ✅ pagos del día en el día de la empresa. ⬜ «contactos efectivos» y «promesas de hoy»: **decisión abierta** (§ preguntas): chocan con «KPIs en el cliente» o piden ampliar `GET /agenda/summary` |
| A3 | 🟡 | ✅ filtro por tipo. ⬜ vista «Semana» (la tira de días ya navega la semana; no hay resumen) |
| A4 | 🟡 | ✅ contador de no leídas sin señal. ⬜ marcar leída sin señal |
| A5 | ✅ | Tope de recordatorios aplicado también a los acumulados (quedan los más cercanos). ⬜ horizonte de 48 h |

**Cuenta / seguridad**

| # | Estado | Qué hay / qué falta |
|---|---|---|
| U1 | ✅ | Cambiar contraseña desde Seguridad. **Corregido**: un 401 por credencial equivocada (contraseña actual mal escrita) cerraba la sesión y borraba el caché; ya no |
| U2 | 🟡 | ✅ activar, desactivar (con contraseña) y regenerar códigos. ⬜ política para roles críticos (hoy la API permite desactivar): decisión abierta |
| U3 | ✅ | Sesiones activas: listar, cerrar una, cerrar las demás |
| U4 | ✅ | = 0.8 |
| U5 | ✅ | Perfil/QR de cobro con respaldo local (la imagen del QR depende de la caché de fotos) |

**Cartera / Mora / Importación**

| # | Estado | Qué hay / qué falta |
|---|---|---|
| C1 | 🟡 | ✅ miniatura y visor en la ficha. ⬜ editar fotos de una dirección, «hacer principal», agregar desde el formulario |
| C2 / M2 | ✅ | Tipo y dueño de cada dirección en la ficha y en «Cómo ubicarlo» (el contexto ya traía los datos; el móvil los tiraba) |
| C3 | ✅ | Alta de teléfono (celular/WhatsApp) y de dirección (sin fotos) sin señal desde «Editar cliente»; la cola busca antes de crear |
| C4 | ✅ | Adjuntos del legajo sin señal (cola `client.attachment`, dedupe por hash) |
| M1 | ✅ | Fijar y soltar la prioridad (solo con `collection:write`), con cola |
| M3 | ⬜ | Notas: editar/borrar siguen **solo en línea** (decisión vigente del código; encolarlas exige una decisión de producto: el cobrador podría creer que quedó y luego recibir un 403 de autoría) |
| I1 / I2 | ✅ | Importación gateada por `client:import`; «Historial de importaciones» accesible desde Más |

**Pruebas de esta ronda:** API 1522 + 51 de integración · shared 345 · web 938 · móvil 908 · `tsc` limpio en las 4 · `expo export` Android OK.
**Ramas** (acumulativas, sin PR): `f10/alineacion-rutas` → `-cuenta` → `-agenda` → `-mora` → `-fotos` (la última contiene todo).

**Decisiones abiertas para la usuaria** (no se avanzó sin ellas): (1) A2: ¿los contadores «contactos efectivos / promesas» se calculan en el
cliente (aproximado: solo ve agenda) o se amplía `GET /agenda/summary`? (2) U2: ¿se bloquea desactivar MFA a los roles críticos?
(3) M3: ¿notas editables sin señal? **Riesgo nuevo a vigilar:** `GET /payments` ahora acepta `day`; una app 1.1.0 contra una API vieja
recibiría 400 por parámetro desconocido, así que API y app se despliegan juntas.

## 14. Orden y dependencias

```
Fase 0 (0.1 · 0.2 · 0.6 primero)
   ├─ R1 → R2 (0.5) → R3 → R4 (0.6, API id) → R5 (0.1, D-5) → R6 (0.4) → R7
   ├─ A1 · A2 (0.2) → A3 → A4/A5 (D-4)
   ├─ U1 · U2 · U3 → U4 (0.8)
   ├─ C1 (0.5) → C2 → C3 → C4
   ├─ M1 → M2 → M3
   └─ I1 → I2
```

Cada slice: plan propio vía `/f10-etapa`, gate `/f10-validar-plan`, rama `f10/alineacion-<slice>`,
verificación `pnpm --filter @kobrax/mobile type-check` + `test` + `npx expo export --platform android`, revisión
`/code-review`, **validación visual por cable** de la usuaria, merge solo con su frase de autorización.

## 15. Fuera de alcance

Móvil iOS/Android nativo propio de supervisores · firma (diferida a v2) · pasarela de pagos (QR es la foto del banco) ·
i18n del móvil (hoy español fijo; la web es es/en) · rediseño visual del móvil · WatermelonDB.

## 16. Estado / historial del validador

| Ronda | Fecha | Resultado | Notas |
|---|---|---|---|
| 1 | 2026-10-10 | — (sin correr) | Plan maestro en borrador. |
| 2 | 2026-10-10 | — (sin correr) | Cerradas D-2, D-3, D-7 con la usuaria; D-4, D-5, D-8 en explicación. |
| 3 | 2026-10-10 | — (sin correr) | D-1, D-4, D-5, D-6, D-8 y D-9 cerradas e implementadas (§13); el gate sigue sin correr: debe pasar antes de construir las fases 1–6. |
| 4 | 2026-10-10 | — (sin correr formalmente) | Se hizo la auditoría de reuso por área (Paso B) sobre el código real y se construyó; el gate formal `/f10-validar-plan` por etapa sigue pendiente para lo no construido (§13.8). |
