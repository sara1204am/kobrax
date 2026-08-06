# P6 · Offline & Sync — plan de etapa

> **ESTADO: ✅ PASS del gate `/f10-validar-plan` (2026-08-06, ronda 2). Habilitado para construir.**
> La ronda 1 salió **FAIL** por un motivo: el plan cambiaba el motor offline y dejaba el EPIC §3.1 y
> el BUILD-PLAN §1 diciendo *WatermelonDB*. Se corrigieron los dos; el cambio y su porqué viven en §4 D1.
>
> Etapa del [BUILD-PLAN §1](../BUILD-PLAN.md) y punto **3** de la cola acordada ([§5](../BUILD-PLAN.md)).
> Cierra el único principio no-negociable que hoy la app **no cumple**: `CLAUDE.md` #4, offline-capable.

---

## 1. Objetivo

Que el cobrador **abra la app sin señal y trabaje igual**: ver su jornada y su cartera, registrar
visitas, gestiones y pagos — y que todo eso suba solo cuando vuelva la red, sin perder un dato ni
esperar a la conexión para nada.

---

## 2. Rama y build

- **Rama:** `f10/P6-offline`
- **Build:** 🔵 dev build. La frontera **ya está cruzada** desde Rutas (MapLibre), así que no hay
  `expo prebuild` nuevo que hacer salvo por la dep del punto D1.

---

## 3. Pantallas

P6 **no tiene pantallas propias de Figma**: es infraestructura, y el diseño no tiene una vista de
sync. Lo único con superficie nueva es la hoja de pendientes, que **la pide el epic (H1.5)**, no un
mockup — se construye con **parity visual** sobre `ui.tsx`, igual que Cuenta y Cartera, que también
se hicieron sin Figma. El resto es UI ya construida:

| Qué | Dónde | Cambio |
|---|---|---|
| `OfflineIndicator` | `src/ui.tsx` (existe, P0) | Ya muestra "Sin conexión"; suma **"· N pendientes"** leyendo `pendingCount`, que `useNetStore` **ya declara y nadie escribe** |
| Hoja "Pendientes de subir" | nueva, en `src/` | Lista lo encolado, su estado y un **reintentar ahora**. Sale del tap en el indicador (epic H1.5) |
| Sello por ítem | tarjetas ya existentes | Un punto/etiqueta "sin subir" en lo que todavía no viajó |

---

## 4. Decisiones de arquitectura

### D1 — El motor es **`expo-sqlite`** + cola propia, **no WatermelonDB**

> **Elección de la usuaria (2026-08-06):** SQLite desde el arranque, en vez de arrancar con archivos
> JSON y mudarse después. Su criterio de campo manda acá: viene de manejar cartera real en banca, y
> una cartera grande de cobrador no entra cómoda en un JSON que se parsea entero en memoria. Se evita
> la mudanza a mitad de camino, que es la parte cara.

El BUILD-PLAN decía WatermelonDB. **Se corrige, y estas son las razones medidas:**

1. **Su protocolo de sync exige backend que no existe.** WatermelonDB sincroniza con
   `pullChanges`/`pushChanges`: un endpoint por tenant que devuelva *lo que cambió desde X* por cada
   tabla. En la API **no hay nada de eso** (grep: cero). Construirlo es un módulo entero, y encima
   `payments` y `field_visits` **no tienen `updated_at`** (son append-only por diseño) → no encajan
   en el modelo que WatermelonDB necesita.
2. **El producto no necesita sync bidireccional.** El ciclo acordado es *oficina → campo → vuelta*
   (`ui-screen-map §4.1`): un solo dispositivo edita lo suyo, nadie compite por la misma fila. Toda
   la maquinaria de conflictos de WatermelonDB resuelve un problema que este producto no tiene.
3. **Lo que sí hace falta es una base local, no un framework de sync.** SQLite da consultas con
   índices y lectura parcial (no hay que cargar la cartera entera en memoria para buscar un
   cliente), que es el 100% de lo que estas pantallas necesitan. Los decoradores, los observables
   y las migraciones propias de WatermelonDB resuelven otra cosa.

`ponytail:` **lo que NO se construye.** No hay ORM, no hay modelos con decoradores, no hay capa
reactiva: `db.ts` expone las pocas consultas que las pantallas piden y nada más. El día que haga
falta reactividad, el store de Zustand que ya existe alcanza.

**Dep nueva:** `expo-sqlite` (SDK de Expo, no un tercero). SecureStore **no sirve** para esto: tiene
techo de ~2 KB por valor en Android, y el propio `route-draft.ts` ya dejó anotado que hay que mudarse
cuando el dato crezca.

### D2 — La sincronización va **por diferencia**, no por historial

Es la regla que **ya inventó `route-draft.ts`** en Rutas S2 y que funcionó: se compara lo que el
teléfono quiere contra lo que el server tiene, y se aplican las diferencias. Reintentar no duplica.
P6 **generaliza ese patrón** y absorbe `route-draft`, que dejó escrito que este es su destino.

### D3 — Todo lo que se encola es **append-only o idempotente**

No es casualidad, es lo que hace la cola segura y ya es así en el backend:

| Acción | Endpoint | Por qué es segura de reintentar |
|---|---|---|
| Pago | `POST /payments` | Header **`Idempotency-Key`** (→ `payments.idempotencyKey`). Ya implementado |
| Visita | `POST /visits` | `field_visits` es append-only; la clave la genera el cliente |
| Evidencia | `POST /visits/:id/evidence` | idem, colgada de la visita |
| Gestión de agenda | `POST /agenda`, `/:id/complete`, `/:id/postpone` | estado destino explícito, no un incremento |

**Nada de UPDATE ciego en la cola.** Si una acción no es idempotente, no se encola: se pide señal.

### D4 — Hidratación: **pull completo por recurso**, no incremental

Bajar de nuevo la jornada entera cuesta ~300 KB y ocurre una vez por mañana, con wifi de oficina.
Un pull incremental exigiría `?since=` en cada endpoint (backend nuevo) para ahorrar unos KB.
No se paga.

---

## 5. Contrato — se consume lo que ya existe, **cero endpoints nuevos**

**Hidratar (GET, en la oficina o cuando haya red):**
`/cases?view=portfolio` · `/routes` + `/routes/:id` · `/agenda?date=` + `/agenda/overdue` ·
`/clients/:id` · `/credits/:id` · `/catalogs/:catalog` · `/notifications`

**Subir (la cola):** `POST /visits` · `POST /visits/:id/evidence` · `POST /payments` (+`Idempotency-Key`) ·
`POST /agenda` · `POST /agenda/:id/complete` · `POST /agenda/:id/postpone` · `POST /uploads` (fotos) ·
y las de ruta que hoy hace `route-draft` (`/routes`, `/routes/:id/stops`).

**Tablas locales (espejo del subset):** clientes, créditos, casos, rutas, paradas, agenda, catálogos,
notificaciones. Más la **cola** y el **registro de hidratación** (cuándo se bajó cada recurso).

---

## 6. Auditoría de reuso (Paso B)

| Capacidad | Decisión | Path |
|---|---|---|
| Estado de conectividad | **REUSAR** | `src/store/net.ts` → `useNetStore` + `subscribeConnectivity`. **`pendingCount` ya existe en el store y nadie lo escribe**: P6 es quien lo alimenta |
| Banner de sin conexión | **EXTENDER** | `src/ui.tsx` → `OfflineIndicator`. Se le suma el contador y el tap; **no** se escribe un segundo banner |
| Red, envelope, refresh 401 | **REUSAR** | `src/api-client.ts` → `authedFetch`/`apiQuery`/`apiMutate`. La cola llama a los **mismos services**, no a un cliente HTTP nuevo |
| Detección de "sin red" en una llamada | **REUSAR** | `status: 'offline'` ya lo devuelven todos los services (`api.ts` mapea el fallo a `status 0`). **Es el disparador de encolado**: no hace falta inventar otro |
| Cola de la ruta armada en el mapa | **ABSORBER** | `src/route-draft.ts` — su `diffStops` es puro y se conserva; su persistencia y su flush pasan a la cola general. El archivo lo declara: *"cuando llegue P6, esto se enchufa ahí y se borra"* |
| Subida de fotos | **REUSAR** | `src/api.ts` → `postMultipart` + `uploadFailure` (techo de 60 s, distingue "sin red" de "archivo ilegible") · `src/uploads.service.ts` |
| Idempotencia de pago | **REUSAR** | `src/payments.service.ts` → `createPayment(input, idempotencyKey)`. **La clave la genera el cliente**: se genera al encolar, no al enviar |
| Resultado de visita | **REUSAR** | `src/field.service.ts` + `src/visit-result.ts` |
| Memoria local de flags | **REUSAR patrón** | `src/import.service.ts` y `biometric.ts` usan SecureStore para cosas chicas. Sigue así lo chico; lo grande va a file-system |
| Reintento al reconectar | **REUSAR** | `subscribeConnectivity` ya avisa el cambio de red: el motor se suscribe ahí, **no** hace polling propio |
| Cuentas del día / KPIs | **REUSAR** | `src/home.ts`, `src/route-summary.ts`, `src/portfolio.ts` — ya son puras y toman arrays: funcionan igual con datos locales, **sin tocarlas** |
| **`src/db.ts`** (base local) | **NUEVO** | Abre la base `expo-sqlite`, crea el esquema y expone las consultas que las pantallas piden. **Único lugar con SQL en toda la app** — ninguna pantalla ni service escribe una query |
| **`src/sync/queue.ts`** | **NUEVO** | La cola FIFO persistida: `enqueue`, `list`, `markSynced`, `markError`. Puro sobre `db.ts` |
| **`src/sync/sync.service.ts`** | **NUEVO** | El motor: drena la cola, backoff, auth, y avisa al store. Es el `SyncService` del epic (H1.1–H1.4) |
| **`src/sync/hydrate.ts`** | **NUEVO** | El "sync de oficina": baja los recursos de la jornada y los guarda. Es el checkpoint de `ui-screen-map §4.1` |
| **Hoja de pendientes** | **NUEVO** | `src/pendientes.tsx` (componente con lógica, como `qr-cobro.tsx`) — H1.5 |

---

## 7. Tareas (orden: leer antes de escribir)

1. **Fundación** — instalar `expo-sqlite`; `src/db.ts` (abrir, esquema, guardar/leer/limpiar) con su test.
2. **Hidratar** — `hydrate.ts`: bajar jornada + cartera y guardar. Disparo manual + al login con red.
3. **Leer offline** — los services aprenden a caer al caché cuando la llamada devuelve `offline`.
   **Se toca cada `*.service.ts`, no cada pantalla** (las pantallas ya manejan `status: 'offline'`).
4. **Cola** — `queue.ts` + `sync.service.ts`: encolar, drenar, backoff, marcar. Con test.
5. **Escribir offline** — enchufar la cola en las escrituras de D3 (visita, evidencia, pago, agenda).
6. **Absorber `route-draft`** — su flush pasa a la cola; se conserva `diffStops` y su test.
7. **UI** — `OfflineIndicator` con contador + hoja de pendientes + sello "sin subir" en las tarjetas.
8. **Verificar** — `type-check` + `test` + `expo export`; **smoke real en modo avión** con el teléfono.

---

## 8. Reglas de la fase

Las 3 del epic §3.3 (sol→contraste · gama baja→perf en UI thread · animación con propósito), más:

- **Nunca bloquear al cobrador por red.** Ninguna acción espera al servidor para darse por hecha.
- **Nunca borrar un dato local que no subió.** Ni al fallar, ni al agotar reintentos, ni al cerrar sesión.
- **Un solo camino, con red y sin red.** No hay una rama "offline" que se pruebe menos que la normal
  (es lo que ya hace `route-draft`, y por eso funcionó).
- **Append-only local**: `case_activities`, `field_visits`, `field_evidences`, `payments` sólo se
  INSERTAN localmente, nunca se actualizan (BUILD-PLAN §3).
- Multi-tenant por capacidad, TS estricto sin `any`, `{data,meta,error}`.
- **El caché es por usuario y se borra en el logout**: la cartera de un cobrador no puede quedar
  legible para el que se loguee después en el mismo teléfono.

---

## 9. DoD

Funcional según este plan · `pnpm --filter @kobrax/mobile type-check` · `test` ·
`npx expo export --platform android` · `/code-review` + `/ponytail-review` aplicados ·
**validación en modo avión sobre el dispositivo real** (la prueba de fuego de esta etapa) ·
merge a `main` sólo con todo verde.

**Smoke de aceptación (el outcome del epic §2):** con el teléfono **en modo avión** — abrir la app,
ver la ruta del día y la cartera, registrar una visita con foto, cobrar un pago parcial, cerrar y
reabrir la app (los datos siguen), volver a poner señal y ver que **todo sube solo** y los números
coinciden con el servidor.

---

## 10. Riesgos y decisiones abiertas

| # | Riesgo | Guarda |
|---|---|---|
| R1 | **Plata que existe en el teléfono y no en el server.** Un pago encolado que nunca sube | Idempotencia por clave del cliente + la cola **nunca se descarta sola** + el pendiente se ve en la UI con su antigüedad |
| R2 | **La foto de evidencia pesa.** Encolar imágenes llena el disco | Se encola la **ruta del archivo**, no los bytes; la foto ya vive en el FS del teléfono. Límite y limpieza al confirmar la subida |
| R3 | **Login offline.** Hoy `routeAfterAuth` manda a `/(app)/offline` si `me()` no responde | Ya hay sesión local con ventana de 8 h (`session.ts`): P6 la usa para dejar entrar al shell con datos locales en vez de a la pantalla de offline |
| R4 | **Caché viejo que miente.** Datos de anteayer mostrados como si fueran de hoy | Cada recurso guarda **cuándo se bajó**, y la UI lo dice ("datos de las 08:15") cuando no hay red |
| R5 | Reloj del dispositivo desfasado → orden de la cola incorrecto | La cola es **FIFO por orden de inserción**, no por timestamp del dispositivo |
| R6 | **El esquema local se desincroniza del server** al agregar un campo | El caché es **descartable**: si la versión del esquema no coincide, se borra y se re-hidrata. Nunca se migra dato local de lectura — no es la fuente de verdad. **La cola sí se migra o se conserva** (esa sí es dato del cobrador) |

## 11. Decisiones cerradas por defecto (2026-08-06)

La usuaria delegó la decisión técnica. Se cierran así; **cualquiera es objetable en la revisión del
plan**, y ninguna cambia la arquitectura de §4.

- **Q1 — Entra la cartera completa, no sólo la jornada.** Son ~300 KB y se baja una vez en la
  oficina. El cobrador que se cruza en la calle con un deudor que no estaba en su ruta tiene que
  poder abrirle la ficha y cobrarle: es el caso real que justifica todo el módulo.
- **Q2 — La cola drena al reconectar, al abrir la app y cada 60 s mientras haya red.** El epic decía
  ~30 s; se sube a 60 y se ata a eventos en vez de dejar un timer corriendo siempre — en un teléfono
  de gama baja al sol, la batería es parte de la UX (regla §3.3.2). Sin red no se despierta nada.
- **Q3 — El logout con cola pendiente avisa y no borra.** Se le dice cuántas acciones faltan subir y
  se ofrece esperar; si igual sale, **la cola queda guardada atada a ese usuario** y se drena cuando
  vuelva a entrar. Nunca se descarta: puede ser un pago. El **caché de lectura sí se borra** en el
  logout (§8), que es un dato de otro; la cola es trabajo suyo todavía no entregado.
