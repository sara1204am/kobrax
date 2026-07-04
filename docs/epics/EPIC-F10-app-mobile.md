# KOBRAX · EPIC F10 — App Mobile (Cobrador en Campo)
> *El cobrador nunca se detiene: la app funciona aunque no haya señal.*

**ID:** EPIC-F10 · **Estado:** ⏳ Pendiente
**Owner:** Mobile + Shared + Testing (consume API de F4–F8)
**Depende de:** F2a/F2b mobile (auth + SecureStore + biometría + sesión offline ya operativos) · F4 (clientes/créditos) · F5 (casos) · F6 (rutas/visitas/evidencia) · F7 (pagos)
**Desbloquea:** operación real en terreno (CU-04, CU-05 desde campo) · datos de campo que alimentan F11
**Requisitos:** CU-04 (ejecución de ruta) · CU-05 (registro de pago en campo) · RNF-05 (usabilidad) · refuerza el principio **offline-first** (no negociable) y **evidencia inmutable (SHA-256)**

---

## 1. Contexto y Posicionamiento en la Plataforma

El cobrador opera en **condiciones adversas**: zonas con señal débil o nula, manos ocupadas, sol directo, prisa. La app móvil es su única herramienta y **debe funcionar sin internet** — la regla de oro de Kobrax: *ninguna acción del cobrador se bloquea esperando la red*. Lo ya construido (F2a Slice 6 + F2b mobile) cubre **autenticación, SecureStore, biometría y sesión offline**. EPIC F10 construye **la operación de campo completa**: ver la ruta del día, visitar deudores, capturar evidencia (foto + GPS + firma con hash SHA-256), registrar pagos y **sincronizar todo cuando vuelve la conexión**.

> **Frontera con F9 (Web):** el panel web **dirige** (asigna casos/rutas, supervisa, concilia); la app móvil **ejecuta** (visita, captura evidencia, cobra). El cobrador no usa el panel; la gerencia no usa la app de campo.

### 1.1 Mapa de dependencias del proyecto

| EPIC | Nombre | Estado | Relación con F10 | Bloquea a F10 |
|------|--------|--------|------------------|---------------|
| F2a S6 / F2b mobile | Auth + SecureStore + biometría + offline | ✅ Completo | Base: tokens seguros, login offline, `routeAfterAuth` | Prereq (✅) |
| F4 | Core Financiero | 🚧 En curso | Lectura de cliente/crédito del caso a visitar | 🔴 Sí |
| F5 | Casos de cobranza | 🚧 Base | "Mis casos" del cobrador, estado, gestión | 🔴 Sí |
| F6 | Rutas + campo + evidencia | ✅ Base | **Núcleo**: ruta del día, visita, evidencia con hash | 🔴 Sí |
| F7 | Pagos | 📋 Listo | Registro de pago en campo (ledger inmutable) | 🔴 Sí |
| F8 | Realtime/notifs | 📋 Listo | Push de asignaciones; emisión de `collector.location` | 🟡 Parcial |
| F11 | Analítica | ⏳ Pendiente | Consume datos de campo capturados aquí | F10 desbloquea |

> **Estrategia de arranque:** el corazón de F10 es el **motor offline + evidencia** (Slices 0–2). Las pantallas de negocio (casos, ruta, pago) se montan encima por verticales, en cuanto su API (F5/F6/F7) es estable. Se construye con **dev build/prebuild** (no Expo Go) porque usa cámara, GPS y SSL pinning nativos.

### 1.2 Lo que ya existe (no se reconstruye)

- **Auth mobile sin BFF**: llama la API directo, tokens en **SecureStore**; modelo offline `sessionValidUntil = min(7d, now+8h)`.
- **Pantallas auth**: `index` (splash), `(auth)/login|mfa|mfa-setup|select-account`, `(auth)/forgot-password`, `(auth)/biometric-setup` + `(auth)/unlock`, `(app)/force-password-change`, `(app)/offline`.
- **Navegación post-login** centralizada en `src/post-login.ts` (`routeAfterAuth`: offline → cambio forzado → oferta biométrica → home).
- **Endurecimiento**: timeout 8h vía `touchSession`, re-bloqueo en `_layout` al volver a primer plano, SSL pinning cableado (`plugins/with-ssl-pinning.js`, hoy NO-OP sin pins).
- **Design system** vinculante (tokens) + harness de tests **jest-expo + RNTL** ya configurado (`jest.config.js` con `transformIgnorePatterns` para `.pnpm`).

---

## 2. Objetivo de Negocio

Dar al cobrador una app **offline-first, simple y a prueba de campo** para ejecutar su jornada de cobranza: ver su ruta y sus casos, registrar visitas con **evidencia digital inmutable** (foto + GPS + firma + hash SHA-256), **cobrar en terreno** y sincronizar de forma confiable cuando hay red — **sin perder jamás un dato local ni bloquear una acción por falta de conexión**.

**Outcome medible:** un cobrador sin señal abre la app (login offline), recorre su ruta del día, registra una visita con foto+GPS+firma y un pago parcial — todo guardado localmente al instante. Al recuperar señal, el `SyncService` sube todo en orden, el servidor **verifica el hash** de la evidencia y acepta el pago en su ledger inmutable. El cobrador nunca esperó a la red.

---

## 3. Alcance

### 3.1 Incluye ✅

- **Motor offline-first**: WatermelonDB local (schema espejo del subset operativo), cola de sync FIFO, optimistic updates, `OfflineIndicator`.
- **`SyncService`**: subida de cambios pendientes cada ~30 s con red, retry con backoff exponencial (3 intentos), resolución de conflictos last-write-wins por timestamp del servidor, redirección a login ante error de auth — **nunca pierde datos locales**.
- **Ruta del día** (F6): lista ordenada de paradas por prioridad, mapa de la ruta, navegación a cada parada, estado de visita.
- **Mis casos** (F5): casos asignados al cobrador, detalle, gestión/actividad, transiciones permitidas en campo.
- **Captura de evidencia** (F6): cámara (foto comprimida ≤ 800 KB) + **SHA-256 del buffer original antes de comprimir**, GPS (lat/lng/accuracy/timestamp), firma (canvas → PNG base64 + hash). Todo sellado localmente.
- **Registro de visita**: outcome de la gestión, notas, evidencia adjunta, guardado offline con `syncStatus: 'pending'`.
- **Registro de pago en campo** (F7): monto (no excede saldo, no negativo), método, comprobante; guardado local y encolado; el servidor lo aplica al ledger inmutable al sincronizar.
- **Notificaciones push** (F8): recepción de asignaciones/avisos; emisión de `collector.location` cuando hay red (supervisión en `CollectorMap` web).
- **Lectura de cliente/crédito** (F4): datos del deudor a visitar (PII tokenizada salvo permiso), saldo, días de mora.
- **Endurecimiento de seguridad** ya iniciado: SSL pinning con pins reales, datos sensibles cifrados/seguros, sin PII en logs.
- **Estados de campo**: indicador de conectividad, cola de pendientes, feedback de sync, modo sol (alto contraste).
- **Capa de UI premium** (calidad sin peso): fundación `components/ui/` (Button, Card, Badge, AmountInput, CaseCard) sobre tokens + **Reanimated 3** (microinteracciones en UI thread), **expo-haptics**, **FlashList** para listas, y **react-native-gifted-charts** solo para el anillo de progreso del día. Lo premium viene del *craft*, no de librería pesada — **sin** Tamagui/Paper ni Skia/Victory XL de base (detalle y porqués en §3.3).

### 3.2 No incluye ❌ (out of scope explícito)

- **Panel de supervisión/gerencia, dashboards, conciliación, administración** → es web (F9). La app de campo no administra.
- **Generación de cronogramas, recálculo de mora del lado servidor, lógica financiera** → vive en la API (F4/F7). La app **solo registra**; el servidor calcula.
- **Edición/borrado de evidencia** → la evidencia es **inmutable por diseño** (sin update/delete). Solo anulación auditada del lado servidor.
- **Administración RBAC / gestión de usuarios** → F3 (web). El cobrador opera con su rol fijo.
- **Reportes/analítica** → F11. La app captura datos; no los agrega.
- **iOS en esta fase** (si el alcance prioriza Android): se documenta como diferido si el equipo enfoca Android primero — el código RN es multiplataforma, pero la validación/pinning iOS puede diferirse.

### 3.3 Capa de UI premium — decisión de stack (2026-06-18)

> El cobrador pide simplicidad y rapidez, **pero la app debe verse de calidad, no básica**.
> Resultado buscado: *se siente fluida y premium en un teléfono barato bajo el sol, sin traicionar
> offline-first ni la simplicidad del cobrador.* Lo "premium" viene del **craft**, no de una librería pesada.

**Stack de UI (se suma a la base de tokens StyleSheet ya vigente en `theme.ts` / `components.tsx`; no la reemplaza):**

| Pieza | Decisión | Porqué |
|-------|----------|--------|
| `components/ui/` propios sobre tokens | ✅ Base | Conserva el design system Kobrax; el craft vive aquí |
| **Reanimated 3** | ✅ Adoptar | Microinteracciones en UI thread (60 fps en gama baja); ~80% de la sensación premium sin costar fluidez |
| **expo-haptics** | ✅ Adoptar | Feedback sutil al cobrar/visitar; se *siente* caro, peso ~0 |
| **FlashList** | ✅ Adoptar | Listas de casos fluidas en gama baja (vs FlatList) |
| **react-native-gifted-charts** | 🟡 Selectivo | Solo anillo de progreso/meta del día; ligero, sin Skia |
| **Tamagui / React Native Paper** | ❌ Descartado | Reescriben la base de tokens; look genérico no-marca; peso |
| **Skia + Victory Native XL** | ❌ No de base | Peso de build/bundle y jank en gama baja; reservado a un visual custom futuro que lo justifique |

**Tres reglas de diseño (las impone "premium bajo el sol en gama baja"):**
1. **Sol → contraste, no decoración.** Dato accionable (monto, nombre, días de mora) siempre en `navy`/`textPrimary`; `textMuted`/`textSecondary` solo para labels secundarios. Contraste ≥ 4.5:1 (refuerza el DoD visual del [design system](../design-system.md §8) y RNF-05).
2. **Gama baja → presupuesto de performance explícito.** Arranque < 2 s, listas a 60 fps, animación **solo** en UI thread (Reanimated, nunca `Animated` de JS), desactivable si el device es lento o `Reduce Motion` está activo ([design-system §7](../design-system.md)).
3. **Premium ≠ recargado → animación con propósito.** Cada microinteracción confirma una acción (press, check al guardar pago, slide del banner offline). Animación sin función = batería + percepción de lento.

> **Orden de ejecución:** construir la fundación `components/ui/` + **una pantalla real** (registrar pago o lista de casos) y **validarla en un Android de gama baja antes** de montar el resto de pantallas. Una pantalla validada en hardware barato vale más que todo el design system en teoría.

---

## 4. Historias y Tareas

> `Mobile` = pantallas/servicios/DB local; `Shared` = tipos/contratos; `Testing` = jest-expo + RNTL + Detox. Núcleo (Slices 0–2) antes que las verticales de negocio.

### Slice 0 — Dev build, DB local & shell de campo

| # | Historia | Agente | Entregable | Estado |
|---|----------|--------|-----------|--------|
| H0.1 | Dev build / prebuild | Mobile | `expo prebuild` (Android primero); integrar cámara/GPS/pinning nativos; documentar build local | ⏳ |
| H0.2 | WatermelonDB local | Mobile | Schema local (espejo subset: cliente, crédito, caso, ruta, parada, visita, evidencia, pago), modelos, migraciones locales | ⏳ |
| H0.3 | Tab navigator de campo | Mobile | `(tabs)`: Ruta · Casos · Pagos · Perfil; navegación + layout con tokens; reusa `routeAfterAuth` | ⏳ |
| H0.4 | Capa de red + cola | Mobile | `apiClient` mobile (Bearer desde SecureStore, 401→refresh/login); NetInfo; cola FIFO de operaciones pendientes | ⏳ |
| H0.5 | `OfflineIndicator` | Mobile | Banner "Sin conexión · N pendientes de sync" — **informativo, nunca bloquea**; estado global (Zustand) | ⏳ |
| H0.6 | Fundación UI premium | Mobile | `components/ui/` (Button, Card, Badge, AmountInput, CaseCard) sobre tokens + **Reanimated 3** (press/transición/skeleton) + `expo-haptics` + FlashList; **validar una pantalla núcleo en Android de gama baja antes de escalar** (§3.3) | ⏳ |

### Slice 1 — SyncService (corazón offline-first)

| # | Historia | Agente | Entregable | Estado |
|---|----------|--------|-----------|--------|
| H1.1 | Motor de sync | Mobile | `sync.service.ts`: corre cada ~30 s con red; FIFO por `createdAt`; sube cambios `pending`→`synced` | ⏳ |
| H1.2 | Retry & backoff | Mobile | 3 intentos con backoff exponencial; marca `error` tras agotar; reintenta en siguiente ciclo; **nunca borra el dato local** | ⏳ |
| H1.3 | Resolución de conflictos | Mobile | Last-write-wins con timestamp del **servidor**; merge de campos; log de conflicto | ⏳ |
| H1.4 | Manejo de auth en sync | Mobile | Error de auth en sync → refresh; si falla → redirige a login conservando la cola | ⏳ |
| H1.5 | Estado de sync en UI | Mobile | Feedback por ítem (pendiente/sincronizado/error); contador global; pull-to-sync manual | ⏳ |

### Slice 2 — Evidencia digital inmutable (F6)

| # | Historia | Agente | Entregable | Estado |
|---|----------|--------|-----------|--------|
| H2.1 | Captura de foto + hash | Mobile | `EvidenceCapture`: foto → **SHA-256 del buffer original** → comprime ≤ 800 KB → guarda local con `syncStatus: 'pending'` | ⏳ |
| H2.2 | GPS de la visita | Mobile | `location.service.ts`: lat/lng/accuracy/timestamp; rechaza visita sin GPS válido; badge de ubicación | ⏳ |
| H2.3 | Captura de firma | Mobile | `SignatureCapture`: canvas → PNG base64 → SHA-256; timestamp + GPS embebidos | ⏳ |
| H2.4 | `evidence.service.ts` | Mobile | Orquesta foto+GPS+firma; calcula hashes; persiste; encola subida; el servidor **verifica hash al persistir** (rechaza si no coincide → `EVIDENCE_001`) | ⏳ |
| H2.5 | Permisos nativos | Mobile | `app.json`: cámara + ubicación (mensajes en es); manejo de permiso denegado sin crashear | ⏳ |

### Slice 3 — Ruta del día (F6) & Mis casos (F5)

| # | Historia | Agente | Entregable | Estado |
|---|----------|--------|-----------|--------|
| H3.1 | Ruta del día | Mobile | Paradas ordenadas por prioridad; mapa de ruta; distancia; estado por parada | ⏳ |
| H3.2 | Detalle de parada / visita | Mobile | Datos del deudor (PII tokenizada), saldo/mora; botón "Registrar visita" → flujo de evidencia | ⏳ |
| H3.3 | Mis casos | Mobile | Casos asignados (`assigneeId = yo`); filtro por estado; `CaseCard` (deudor, monto, días mora, estado, distancia) | ⏳ |
| H3.4 | Gestión de caso en campo | Mobile | Registrar `case_activity`; transiciones permitidas (valida `CASE_TRANSITIONS`); offline-first | ⏳ |

### Slice 4 — Pago en campo (F7)

| # | Historia | Agente | Entregable | Estado |
|---|----------|--------|-----------|--------|
| H4.1 | Formulario de pago | Mobile | `PaymentForm` + `AmountInput`: monto (no excede saldo, no negativo → `PAYMENT_001`), método, referencia | ⏳ |
| H4.2 | Pago offline + cola | Mobile | Guarda local con `syncStatus: 'pending'`; optimistic update del saldo; encola para ledger del servidor | ⏳ |
| H4.3 | Comprobante de pago | Mobile | Genera comprobante local (con hash); evidencia opcional de pago; idempotencia por referencia para evitar doble cobro | ⏳ |
| H4.4 | Confirmación de aplicación | Mobile | Al sincronizar, refleja el estado real devuelto por F7 (aplicado/rechazado); reconcilia saldo optimista | ⏳ |

### Slice 5 — Notificaciones & ubicación (F8)

| # | Historia | Agente | Entregable | Estado |
|---|----------|--------|-----------|--------|
| H5.1 | Push de asignaciones | Mobile | Registro de push token; recepción de aviso de caso/ruta asignada; deep-link a la pantalla | ⏳ |
| H5.2 | Emisión `collector.location` | Mobile | Con red, emite ubicación al room `tenant:{accountId}` (alimenta `CollectorMap` web); respeta privacidad/consentimiento | ⏳ |

### Slice 6 — Endurecimiento & calidad

| # | Historia | Agente | Entregable | Estado |
|---|----------|--------|-----------|--------|
| H6.1 | SSL pinning real | Mobile | Pins SPKI reales en `app.json`; validar con dev build/prebuild contra endpoint productivo (plugin ya cableado) | ⏳ |
| H6.2 | Tests offline & evidencia | Testing | jest-expo + RNTL: sync (cola/retry/conflicto), hash de evidencia, pago offline; **Detox**: visita con foto+GPS offline → sync | ⏳ |
| H6.3 | UX de campo | Mobile/Testing | Touch targets ≥ 48px, alto contraste sol, body ≥ 15px; estados loading/empty/error; sin acción bloqueada por red | ⏳ |

---

## 5. Contratos y Modelo de Datos

> F10 **no define endpoints ni tablas de servidor nuevos**: consume F4–F8. Define el **schema local** (WatermelonDB) y el **contrato de sincronización**.

### 5.1 Modelo offline-first (principio no negociable)

```
Toda acción del cobrador:
1. Se guarda PRIMERO en WatermelonDB local
2. Se marca syncStatus: 'pending'
3. Se refleja en UI inmediatamente (optimistic update)
4. Con internet → SyncService sube los cambios (FIFO)
5. Conflictos → last-write-wins con timestamp del servidor
NUNCA bloquear una acción esperando respuesta de red.
```

### 5.2 Schema local (subset espejo)

| Tabla local | Origen API | Campos clave de sync |
|-------------|-----------|----------------------|
| `clients` (read-mostly) | F4 | `serverId`, datos tokenizados, `lastSyncedAt` |
| `credits` (read-mostly) | F4 | `serverId`, `outstandingBalance`, `daysPastDue` |
| `cases` | F5 | `serverId`, `status`, `assigneeId`, `syncStatus` |
| `case_activities` | F5 | `localId`, `caseId`, `type`, `notes`, `syncStatus` |
| `route_plans` / `route_stops` | F6 | `serverId`, orden por prioridad, estado de parada |
| `field_visits` | F6 | `localId`, outcome, GPS, `syncStatus` |
| `field_evidences` | F6 | `localId`, `fileUri`, `fileHash` (SHA-256), GPS, `capturedAt` — **inmutable** |
| `payments` | F7 | `localId`, monto, método, `reference` (idempotencia), `syncStatus` |
| `sync_queue` | — | FIFO: `op`, `entity`, `payload`, `retryCount`, `status`, `createdAt` |

> Campos de control en toda fila local: `syncStatus: 'pending' | 'synced' | 'error'`, `localId` (UUID generado en el dispositivo), `serverId` (asignado al sincronizar), `updatedAtLocal`.

### 5.3 Contrato de sincronización

- **Subida (push):** la app envía operaciones encoladas (FIFO por `createdAt`) con su `localId`. El servidor responde con `serverId` + timestamp; la app mapea `localId→serverId` y marca `synced`.
- **Idempotencia:** operaciones financieras (pago) llevan `reference` única; reenvíos no duplican (el servidor F7 detecta duplicado → no doble contabiliza).
- **Verificación de hash:** al subir evidencia, el servidor (F6) recalcula y compara `file_hash`; **rechaza si no coincide** (`EVIDENCE_001`). La app marca esa evidencia como `error` y no la reintenta a ciegas.
- **Conflicto:** si el servidor tiene una versión más nueva, gana el timestamp del servidor (last-write-wins); la app reconcilia el estado local.
- **Auth:** 401 en sync → refresh con SecureStore; si falla → login, **conservando la cola** intacta.
- **Bajada (pull):** ruta/casos del día se refrescan con red; se cachean para operar offline.

### 5.4 Endpoints consumidos (referencia)

| Vertical | Endpoints API (dueño) |
|----------|----------------------|
| Identidad | `GET /auth/me`, `POST /auth/refresh` (ya en F2a) |
| Cliente/Crédito | `GET /clients/:id`, `GET /credits/:id` (F4) |
| Casos | `GET /cases?assignee=me`, `PATCH /cases/:id`, actividad (F5) |
| Rutas/Visitas | `GET /routes`, `POST /field-visits`, `POST .../evidence` (F6) |
| Pagos | `POST /payments` (ledger inmutable, idempotente) (F7) |
| Push/Realtime | registro push, `collector.location` (F8) |

---

## 6. Seguridad & Cumplimiento (checklist fintech)

> Hereda el [checklist transversal](./README.md) y añade los controles propios de un cliente móvil en campo.

### 6.1 Específicos de F10

- [ ] **Tokens en SecureStore** (Keystore/Keychain), nunca en AsyncStorage ni en claro. (Ya base de F2.)
- [ ] **Sesión offline acotada**: `sessionValidUntil = min(7d, now+8h)`; re-bloqueo biométrico al volver a primer plano; timeout 8h. (Ya base de F2.)
- [ ] **Evidencia inmutable**: `file_hash` SHA-256 calculado **sobre el buffer original antes de comprimir**; sin update/delete local; servidor verifica hash al persistir.
- [ ] **GPS obligatorio** en visita/evidencia: rechaza captura sin ubicación válida (no se falsea la georreferencia).
- [ ] **Pago idempotente**: `reference` única por pago; el reenvío en sync no duplica; monto validado (no negativo, no excede saldo) en cliente **y** servidor.
- [ ] **PII**: tokenizada por defecto en pantallas; reveal solo con permiso (auditado por API); **nunca PII en logs del dispositivo**.
- [ ] **SSL pinning** con pins SPKI reales (dev build/prebuild); sin pinning → no se confía en la red.
- [ ] **Cola persistente segura**: datos en cola cifrados en reposo; al hacer logout, decidir política de la cola (conservar cifrada vs purgar) — documentada.
- [ ] **Permisos nativos mínimos**: solo cámara + ubicación; mensajes claros; degradación sin crash si se deniegan.
- [ ] **Sin secretos en el bundle**: `EXPO_PUBLIC_*` solo para config no sensible (URL API); nada de claves embebidas.
- [ ] **Multi-tenant**: la app opera en el tenant del JWT; el `collector.location` se emite solo al room del propio tenant.

### 6.2 Datos en reposo en el dispositivo

| Dato | Almacenamiento | Protección |
|------|----------------|-----------|
| Tokens JWT | SecureStore | Keystore/Keychain del OS |
| Cola de sync / datos operativos | WatermelonDB | Cifrado en reposo; sin PII en claro en logs |
| Evidencia (foto/firma) | FileSystem | Hash SHA-256 sellado; subida a S3/R2 vía API; archivo local purgado tras sync confirmado |
| PII de cliente | Memoria/DB local | Tokenizada; reveal efímero, no persistido |

---

## 7. Criterios de Aceptación (DoD) — F10

### 7.1 Funcional
- [ ] El cobrador hace **login offline** (sesión válida previa) y opera sin red.
- [ ] **Ruta del día** y **mis casos** se ven y operan offline (datos cacheados).
- [ ] **Registrar visita** con foto + GPS + firma funciona sin red: guardado local instantáneo, `syncStatus: 'pending'`.
- [ ] **Registrar pago** en campo: monto validado, guardado local, optimistic update del saldo, encolado.
- [ ] Al recuperar red, el **`SyncService` sube todo en orden**, sin perder datos; conflictos resueltos por timestamp del servidor.
- [ ] El **servidor verifica el hash** de la evidencia al persistir; evidencia con hash inválido se marca `error`, no se acepta.
- [ ] El pago llega al **ledger inmutable** sin doble contabilización (idempotencia por `reference`).

### 7.2 Seguridad y privacidad
- [ ] **Ninguna acción del cobrador se bloquea por red** (verificado en test de flujo offline).
- [ ] Evidencia **inmutable**: no editable/borrable localmente; hash sellado sobre el original.
- [ ] PII nunca en logs del dispositivo; tokenizada en UI; reveal auditado.
- [ ] Tokens solo en SecureStore; re-bloqueo biométrico tras background; timeout 8h.
- [ ] SSL pinning activo con pins reales (dev build); sin pins → no confía en la red.
- [ ] `collector.location` solo al room del propio tenant.

### 7.3 Calidad y UX
- [ ] `type-check` + `jest` verdes; `expo export` (bundle Metro) sin errores.
- [ ] Detox: "visita con foto+GPS **offline** → sync al recuperar red" en verde.
- [ ] Touch targets ≥ 48px; body ≥ 15px; alto contraste para sol; estados loading/empty/error en cada pantalla.
- [ ] DoD visual del [design system](../design-system.md §8) cumplido (tokens, tipografía mobile, `<LinearGradient>` para hero, sin gradientes CSS).
- [ ] `OfflineIndicator` visible y honesto (N pendientes); feedback de sync por ítem.
- [ ] **Capa premium (§3.3)**: microinteracciones con Reanimated en UI thread (no JS), `expo-haptics` en cobrar/visitar, listas con FlashList; animaciones respetan `Reduce Motion`.
- [ ] **Validado en hardware de gama baja**: pantalla núcleo (pago o lista de casos) a 60 fps y arranque < 2 s en un Android barato real.
- [ ] **Contraste sol**: datos accionables en `navy`/`textPrimary` (≥ 4.5:1); grises suaves solo en labels secundarios.

---

## 8. Estrategia de Tests

| Nivel | Qué se prueba | Herramienta | Cobertura objetivo |
|-------|---------------|-------------|--------------------|
| **Unit** | `evidence.service` (SHA-256 sobre original, no sobre comprimido), `location.service` (rechazo sin GPS), validación de pago (no negativo/excede), idempotencia por `reference`, mapeo `localId↔serverId` | jest-expo | ≥ 80% |
| **Sync** | Cola FIFO por `createdAt`, retry/backoff (3 intentos), conflicto last-write-wins, auth-error→login conservando cola, **nunca pierde dato local** | jest-expo (fakes de API/Net) | Crítico al 100% |
| **Componente/Screen** | `EvidenceCapture`, `SignatureCapture`, `PaymentForm`, `CaseCard`, ruta del día, `OfflineIndicator` | RNTL (timers con `jest.useFakeTimers()`) | Pantallas críticas |
| **E2E** | **Detox**: registrar visita con foto+GPS **offline** → recuperar red → sync → servidor verifica hash; pago offline → sync → ledger | Detox | Flujo crítico al 100% |
| **Negativos** | Visita sin GPS → rechazada; hash manipulado → `EVIDENCE_001`; pago duplicado → no doble cobro; PII en logs → ausente; acción offline nunca bloqueada | jest-expo/Detox | 100% de casos |

> Reusar `jest.config.js` con `transformIgnorePatterns` sobre `.pnpm` (si no, RN Flow rompe). Screens con timers → `jest.useFakeTimers()`. La app no corre en el entorno headless: validar con `type-check` + `expo export` + Detox en emulador.

---

## 9. Observabilidad & Métricas

- **Telemetría de sync** (sin PII): ítems pendientes, latencia de sync, tasa de error/retry, conflictos resueltos, antigüedad del dato más viejo en cola.
- **Métricas de campo** (alimentan F11): visitas/día por cobrador, % visitas con evidencia válida, pagos en campo, tiempo medio por parada, cobertura de ruta.
- **Integridad de evidencia**: % de evidencias con hash verificado OK en servidor (señal de manipulación o corrupción si baja).
- **Salud offline**: tiempo en modo offline, tamaño de cola, fallos de sync persistentes.
- **Logs del dispositivo**: estructurados, **sin PII ni tokens**; errores de sync con `requestId`/`accountId`/`userId` (no plaintext sensible).
- **Auditoría**: las acciones llegan a `audit_logs` cuando sincronizan (la auditoría la sella el servidor; la app origina la acción autenticada).

---

## 10. Riesgos y Mitigaciones

| # | Riesgo | Impacto | Mitigación |
|---|--------|---------|-----------|
| R1 | Pérdida de datos locales ante fallo de sync | 🔴 Crítico | `SyncService` nunca borra local hasta confirmación del servidor; retry con backoff; cola persistente; tests que verifican preservación del dato. |
| R2 | Doble contabilización de un pago en reintentos | 🔴 Crítico | Idempotencia por `reference` única; el servidor (F7) detecta duplicado; optimistic update reconciliado con respuesta real. |
| R3 | Manipulación/corrupción de evidencia | 🔴 Crítico | SHA-256 sobre el **buffer original antes de comprimir**; servidor re-verifica y rechaza (`EVIDENCE_001`); evidencia inmutable (sin update/delete). |
| R4 | Falsear GPS / visita sin ubicación | 🔴 Alto | GPS obligatorio y validado para registrar visita/evidencia; accuracy registrada; sin GPS → no se permite la captura. |
| R5 | Cámara/GPS/pinning requieren nativo → Expo Go no basta | 🟡 Medio | Dev build/prebuild desde Slice 0; documentar build local Android; pinning validado con build real (NO-OP en Expo Go documentado). |
| R6 | Conflictos de sync corrompen estado | 🟡 Medio | Last-write-wins por timestamp del servidor; merge por campo; log de conflicto; tests de conflicto. |
| R7 | PII filtrada en logs/dispositivo | 🔴 Crítico | Tokenización por defecto; reveal efímero no persistido; asserts de ausencia de PII en logs; cola cifrada en reposo. |
| R8 | Batería/datos por sync agresivo | 🟢 Bajo-Medio | Sync cada ~30 s solo con red; backoff; pull-to-sync manual; emitir `collector.location` con throttle. |
| R9 | `node-linker=hoisted` / `.pnpm` rompe Metro o jest | 🟡 Medio | Mantener `.npmrc` hoisted (requerido por Expo/Metro); `transformIgnorePatterns` sobre `.pnpm` en jest; no subir react/react-dom sin alinear web. |

---

## Cómo levantar / desarrollar (recordatorio)

```powershell
cd D:\kobrax\app-kobrax\kobrax
pnpm --filter @kobrax/mobile start         # Metro (Expo) ; en emulador: tecla 'a'
pnpm --filter @kobrax/mobile type-check    # tsc --noEmit
pnpm --filter @kobrax/mobile test          # jest-expo + RNTL
# Para cámara/GPS/pinning (nativo):
cd apps\mobile ; npx expo prebuild --platform android   # genera android/ para dev build
```
- API base vía `EXPO_PUBLIC_API_URL` (`apps/mobile/.env`). **Emulador Android: `http://10.0.2.2:4010/api`**; dispositivo físico = IP de la PC en la LAN.
- Mantener `.npmrc` `node-linker=hoisted`. SSL pinning real requiere dev build (no Expo Go).

---

*KOBRAX · EPIC F10 — Documento listo para ejecución por slices.*
*Orden recomendado: Slice 0 (dev build + DB local) → Slice 1 (SyncService) → Slice 2 (evidencia) → Slice 3 (ruta/casos) → Slice 4 (pago en campo) → Slice 5 (push/ubicación) → Slice 6 (endurecimiento + calidad).*
