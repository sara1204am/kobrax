# Cartera · S4 — Menú "Clientes", búsqueda global y orden

> Índice: [README.md](./README.md) · Spec: [`docs/flows/Cliente_Prestamo.pdf`](../../../../flows/Cliente_Prestamo.pdf) §5.3
> **Depende de S1/S2/S3** (lista, alta, ficha) — ya construidos en `f10/cartera-lista`.
> **Sin Figma:** se calca lo ya construido (tokens de `src/theme.ts`, `ListRow`/`BottomSheet`/`Chips` de `src/ui.tsx`).
> **Build:** 🟢 Expo Go. Rama propuesta: `f10/cartera-menu-busqueda`.

## 1. Objetivo
Que la cartera de clientes deje de ser una pantalla a la que se llega de casualidad:
1. El menú **Más** gana una sección **Clientes** con todas las puertas de entrada (ver cartera, dar de alta,
   importar, reglas de importación) — incluida la pantalla de **importar clientes**, que hoy sólo aparece
   sola en el primer login del día y no tiene forma de abrirse a mano.
2. La lista gana **orden elegible** (hoy el orden es fijo: mora desc → próxima fecha).
3. El buscador se vuelve **global**: hoy sólo filtra los ~100 casos cargados, así que un cliente sin préstamo
   —o fuera de esa página— es **invisible en la app**.

## 2. Alcance

**Hallazgo de la auditoría de reuso: el CRUD ya está completo.** No se escribe CRUD nuevo en S4.

| | Dónde vive hoy | S4 |
|---|---|---|
| **C**rear | `app/cliente/nuevo.tsx` (+ `/prestamo/nuevo` encadenado) | sólo se agrega la entrada del menú |
| **R**eer | `app/(tabs)/cobranza.tsx` (lista) · `app/cliente/[id].tsx` (ficha) | orden + búsqueda global |
| **U**pdate | `app/cliente/editar.tsx` (cliente + crédito) | sin cambios |
| **D**elete | **estado `INACTIVE`** desde el selector *Estado* de Editar | sin cambios (decisión D3) |

**SÍ:** sección *Clientes* en `mas.tsx` · píldora de orden con 4 criterios · búsqueda local ampliada + fallback
server-side a `GET /clients?q=` · degradado de la ficha para un cliente sin préstamos (lo destapa la búsqueda global).

**NO:** baja dura (`DELETE /clients/:id`, existe en la API — ver D3) · paginación server-side de la cartera
(el techo de ~100 sigue anotado en D6 del README) · pantalla hub nueva (D1) · renombrar el tab (abierto §9) ·
cambios de backend: **S4 no toca la API**.

## 3. Menú — sección "Clientes" en `app/(tabs)/mas.tsx`
`mas.tsx` hoy es un `ScrollView` de tres `ListRow`. Se le agrega un `SectionLabel` + cuatro filas. **Sin pantalla nueva.**

| Fila | Subtítulo | Destino | Estado |
|---|---|---|---|
| Ver cartera | Todos tus clientes y su deuda | `/(tabs)/cobranza` | pantalla ya construida (S1) |
| Nuevo cliente | Alta manual, con o sin préstamo | `/cliente/nuevo` | pantalla ya construida (S2) |
| **Importar datos** | Subí el archivo de tu sistema | `/import` | **deuda del módulo import** — ver abajo |
| Reglas de importación | Cómo se leen las columnas del archivo | `/ajustes/importacion` | fila existente, **se renombra** |

La fila de hoy se llama *"Importación"* y va a las **reglas**, no al import. Con las dos juntas el nombre
actual es ambiguo → pasa a *"Reglas de importación"*.

> ⚠️ **Esto no lo decide S4: ya estaba decidido.** El módulo import lo especifica en su
> [§6.3 "Desde el menú"](../import/README.md): *"`Más` → **Importar datos** → entra por I1, mismo flujo,
> mismo código. **Sin gate, sin flags de día**"*. Nunca se cableó. S4 sólo **paga esa deuda** — y por eso
> usa la etiqueta que ese plan ya eligió (*Importar datos*, no "Importar clientes": el archivo trae créditos
> con su cliente, y el ancla es el crédito). `app/import/index.tsx` es **I1 Inicio Sync** (`24:1049`) y
> pertenece a ese módulo, no a cartera. Sin pull de Figma: el cambio es de navegación, no de diseño.

El código de la pantalla también lo esperaba: su comentario dice *"Entra acá el primer login del día si el
tenant tiene `askOnLogin`, y también desde Más › Importación"*. La segunda mitad de esa frase nunca se cableó.
**Lo único a resolver** es el botón secundario: hoy hace `router.replace('/(tabs)')` + `markImportSkipped()`,
correcto viniendo del gate y erróneo viniendo del menú (marcaría el día como "saltado" sin que hubiera gate,
justo lo que el §6.3 excluye con "sin flags de día") → con `?from=menu` es `router.back()` sin marcar nada.

## 4. Búsqueda global (`app/(tabs)/cobranza.tsx` + `src/clients.service.ts`)

Dos capas, sin romper lo que hoy funciona:

1. **Local, instantánea** (lo de hoy, D6 del README): filtra la cartera cargada. Se le agrega **zona** a los
   campos que matchea (`matchesSearch` en `src/portfolio.ts` ya normaliza acentos/mayúsculas).
2. **Servidor, en diferido**: `useClientSearch(query)` — **hook nuevo, extraído de código que ya existe**
   (ver §4.1). Umbral y debounce **los de hoy: ≥ 2 caracteres, 300 ms**; no se inventan valores nuevos.
   Por debajo llama a `searchClients(q)` (`GET /clients?q=&status=ACTIVE&limit=20`, blind index sobre
   documento + ILIKE sobre nombre). Los hits que **no** están en la cartera cargada se pintan al pie de la misma
   `FlashList` (`ListFooterComponent`), bajo un separador **"Otros clientes"**, como fila simple
   (nombre + documento enmascarado, sin deuda: esos datos no vienen de este endpoint).
   - **Race-guard** por `reqId` **dentro del hook**, igual que `fetchCartera`.
   - **Offline / error** → la sección simplemente no aparece. Nunca rompe la lista local (offline-first).
     Tampoco `unauthenticated`: ninguna pantalla de campo rutea a login por su cuenta (Home, cartera y ficha
     muestran su estado; `api-client` ya limpió la sesión si el server la revocó), y la propia lista está
     pidiendo datos con **la misma sesión** — así que el aviso sale de ahí. Un redirect disparado desde un
     hook de búsqueda taparía ese mensaje.
   - **Permiso:** `COLLECTOR` ya tiene `client:read` con scope **ACCOUNT** (`seed.ts:120`), así que el
     buscador ve **todo el tenant**, no sólo lo asignado a mí. No es exposición nueva: es exactamente lo que
     ya hace el buscador del alta de agenda (`app/agenda/crear.tsx`), con la misma PII enmascarada.
   - **Interacción con D3:** `searchClients` filtra `status=ACTIVE` → un cliente puesto en **INACTIVO** (la
     "baja" de este módulo) **desaparece del buscador global** pero **sigue en la lista** si tiene un caso
     abierto (ver el techo de D3). Es el comportamiento aceptado en S4; se unifica cuando se filtre por
     `client.status` en `view=portfolio`.
   - La búsqueda global **ignora el chip activo** (si es global, es global). El chip sigue rigiendo la cartera local.

### 4.1 🟡 El buscador remoto ya está escrito — se consolida, no se copia
`app/agenda/crear.tsx:138-146` ya tiene **exactamente** este buscador: `searchClients` + `setTimeout` de
**300 ms** + `>= 2` caracteres + `clearTimeout` en el cleanup + descarte del resultado si ya hay cliente
elegido. Escribirlo de nuevo en `cobranza.tsx` sería la segunda copia → viola la regla de oro del
[BASE-INVENTORY](../BASE-INVENTORY.md) ("si algo se usa en ≥2 lugares, vive acá y se importa; si encontrás un
near-duplicado, se **consolida**, no se suma").

→ **`src/use-client-search.ts` (NUEVO, mínimo):** `useClientSearch(query, { enabled })` → `ClientHit[]`.
Encapsula debounce + umbral + cleanup + race-guard. Lo consumen **las dos** pantallas; `agenda/crear.tsx` se
refactoriza para usarlo en la misma pasada y queda **más corto** que hoy. Es un hook, no un componente: no
entra a `ui.tsx`; vive al lado de `clients.service.ts`, que es de donde sale su dato. Se registra en el
BASE-INVENTORY al cerrar la etapa (tarea 9).

**El hook arregla un bug latente de paso:** el `clearTimeout` de hoy cancela el **timer**, no el `fetch` ya
lanzado — dos búsquedas rápidas pueden resolver fuera de orden y dejar en pantalla los hits de la consulta
vieja. Por eso el guard va por `reqId` dentro del hook, no por `clearTimeout` solo. Es el tipo de arreglo
que sólo aparece cuando se consolida en un lugar en vez de copiar.

### 4.2 🔴 Lo que destapa la búsqueda global — la ficha se cae
`app/cliente/[id].tsx` carga con `clientContext(clientId)`, que **devuelve error `AGENDA_002` si el cliente no
tiene casos asignados a mí**, y además la pantalla exige `credits[0]` para renderizar. Un resultado de la
búsqueda global —cliente sin préstamo, o de otro cobrador— cae hoy en **"No se pudo cargar"**, que es
mentira y un callejón sin salida.

→ S4 degrada la ficha en vez de fallar:
- Si `clientContext` falla con error de negocio **o** devuelve `credits.length === 0`, se cae a
  `getClient(id)` (`client:read`, no necesita caso) para la identidad.
- Se renderiza cabecera + `EmptyState` **"Sin préstamos registrados"** + CTA **"Registrar préstamo"** →
  `/prestamo/nuevo?clientId=…&name=…` (esa ruta **ya acepta esos params**).
- `offline` sigue siendo `offline`; el degradado es sólo para el error de negocio y el caso de 0 créditos.

Sin esto la búsqueda global entrega resultados que no se pueden abrir.

## 5. Orden — `sortPortfolio()` en `src/portfolio.ts`

Función **pura** nueva, al lado de `filterPortfolio`. El orden de hoy (mora desc → próxima fecha asc, embebido
al final de `groupPortfolio`) se extrae tal cual y pasa a ser la clave `'mora'`, **el default** — cero cambio de
comportamiento para quien no toque nada.

| Clave | Etiqueta | Criterio |
|---|---|---|
| `mora` *(default)* | Mora | días de mora desc → próxima fecha asc (el de hoy, §5.3) |
| `deuda` | Deuda mayor | `totalDebt` desc |
| `nombre` | Nombre A-Z | `name` con `localeCompare('es')` |
| `vencimiento` | Próximo vencimiento | `nextDueDate` asc, sin fecha al final |

**Control:** píldora `⇅ Ordenar · <criterio>` a la derecha de la fila de chips → abre `BottomSheet` (ya existe)
con `Chips` (ya existe) de las 4 opciones. Un toque para ver, un toque para elegir; sin asc/desc (cada criterio
tiene un sentido obvio y el cobrador tiene una mano ocupada).

**Tests** (`src/portfolio.test.ts`, ya existe): un caso por criterio + que `'mora'` da exactamente el mismo
array que hoy (no-regresión).

## 6. Reuso (Paso B)
| Capacidad | Decisión | Path |
|---|---|---|
| Filas del menú + etiqueta de sección | REUSAR | `src/ui.tsx` (`ListRow`, `SectionLabel`) |
| Hoja de opciones + chips del selector de orden | REUSAR | `src/ui.tsx` (`BottomSheet`, `Chips`) |
| Buscar clientes en todo el tenant | **REUSAR (ya existe)** | `src/clients.service.ts` → `searchClients()` + `clientDisplayName()` |
| **Debounce + umbral del buscador remoto** | **CONSOLIDAR** (hoy vive suelto en una screen) | `app/agenda/crear.tsx:138-146` → sube a `src/use-client-search.ts`; las 2 pantallas lo importan |
| Detalle de cliente sin caso asignado | **REUSAR (ya existe)** | `src/clients.service.ts` → `getClient()` |
| Vacío / lista / tarjeta / tokens | REUSAR | `src/ui.tsx`, `src/theme.ts`, `FlashList` |
| Alta de préstamo con cliente ya elegido | REUSAR | `app/prestamo/nuevo.tsx` (`?clientId=&name=`) |
| Pantalla del import | **REUSAR (ya existe)** | `app/import/index.tsx` — sólo faltaba la puerta |
| `matchesSearch` (+ zona) · `sortPortfolio` (nuevo) | **EXTENDER** | `src/portfolio.ts` (+ test) |
| Ficha con 0 créditos | **EXTENDER** | `app/cliente/[id].tsx` (degradado, no pantalla nueva) |
| Backend | **NADA** | S4 no toca la API |

## 7. Tareas (orden)
1. `mas.tsx`: sección *Clientes* con las 4 filas + renombrar la fila de reglas.
2. `import/index.tsx`: `?from=menu` → botón secundario `router.back()` sin `markImportSkipped()`.
3. `portfolio.ts`: extraer el orden actual → `sortPortfolio` con las 4 claves; `matchesSearch` + zona. Tests.
4. `cobranza.tsx`: píldora + `BottomSheet` de orden, cableado a `sortPortfolio`.
5. **`src/use-client-search.ts`**: extraer el hook de `agenda/crear.tsx` y **refactorizar esa pantalla** para
   consumirlo (consolidar, no sumar — §4.1). Sin cambio de comportamiento en agenda.
6. `cobranza.tsx`: sección "Otros clientes" en el footer, alimentada por el hook.
7. `cliente/[id].tsx`: degradado a `getClient` + `EmptyState` "Sin préstamos" + CTA préstamo.
8. Verificar (móvil type-check + jest + `expo export`) → **`/code-review` + `/ponytail-review`** (workflow
   §2 del [BUILD-PLAN](../../BUILD-PLAN.md), aplicar findings y re-verificar) → handoff visual a la usuaria.
9. Al cerrar: registrar `sortPortfolio` y `use-client-search.ts` en el
   [BASE-INVENTORY](../BASE-INVENTORY.md) y marcar S4 ✅ en el [README](./README.md).

## 8. Reglas de la fase (epic §3.3 + no-negociables)
**Sol → contraste**: nombre y deuda en `navy`; "Otros clientes" y el criterio de orden en `muted`.
**Gama baja → perf**: orden y filtro en memoria, puros; la búsqueda remota va con debounce (nunca una llamada
por tecla). **Animación con propósito**: sólo el slide del `BottomSheet` que ya existe.
· **PII enmascarada** en toda la lista, también en los hits remotos (`GET /clients` ya la enmascara) — sin
`PII_REVEAL` · offline **no bloquea** ni la lista local ni el menú · TS estricto sin `any` · nada hardcodeado
fuera de `theme.ts`.

## 9. Decisiones (cerradas con la usuaria, 2026-07-28)

- **D1 — El menú es una sección, no una pantalla hub.** "Aumentar al menú Clientes y que ahí vaya todo": las
  cuatro puertas viven como filas dentro de *Más*. Una pantalla intermedia que sólo contiene 4 `ListRow`
  agrega un tap y un archivo sin agregar nada. Si más adelante la sección crece (segmentos, etiquetas,
  exportar), se promueve a pantalla propia — el destino de las filas no cambia.
- **D2 — Búsqueda = local + fallback al servidor.** Lo instantáneo sigue siendo instantáneo; el servidor sólo
  entra cuando lo local no alcanza. Es lo único que hace visible a un cliente **sin préstamo**, que hoy no
  existe en ninguna pantalla de la app.
- **D3 — Sin baja dura.** "Todo el CRUD" se cierra con el estado **INACTIVO** que ya está en Editar.
  `DELETE /clients/:id` existe en la API (baja lógica: `deletedAt` + `INACTIVE`, y rechaza si el cliente tiene
  créditos activos) y **queda sin cablear**. Efecto secundario que ahorra: `apiMutate` hoy trata el **204 como
  error** (sólo acepta 200/201 con body) — no hace falta tocarlo en S4.
  `ponytail:` techo conocido — **INACTIVO no saca al cliente de la cartera**: la lista sale de `GET /cases`, no
  del estado del cliente, así que un cliente dado de baja con un caso abierto sigue apareciendo. Upgrade:
  exponer `client.status` en `view=portfolio` y filtrarlo, cuando alguien se queje.
- **D4 — Orden: 4 criterios en hoja, sin asc/desc.**

**Abierto (no bloquea S4):** el tab se llama **"Cobranza"** pero su cabecera dice **"Cartera"**. Renombrarlo
toca `(tabs)/_layout.tsx` y el mapa de pantallas del epic; se decide aparte.

## 10. DoD
- Desde **Más › Clientes** se llega a la cartera, al alta, al **importador** y a las reglas de importación;
  entrando al importador desde el menú, el botón secundario **vuelve** en vez de marcar el import como saltado.
- La píldora de orden reordena la lista en vivo con los 4 criterios; **"Mora" da el mismo orden que antes** de S4.
- Escribiendo el nombre de un cliente **que no está en la cartera cargada**, aparece bajo "Otros clientes" y
  **su ficha abre** — mostrando "Sin préstamos registrados" y el CTA de registrar préstamo si no tiene ninguno.
- Sin conexión: la lista local y el menú siguen funcionando; la sección remota simplemente no aparece.
- **El buscador de `agenda/crear.tsx` sigue comportándose igual** después de pasarlo al hook compartido
  (mismo umbral, mismo debounce, sin request por tecla) — es la prueba de que se consolidó y no se duplicó.
- Verificación verde (type-check + jest + `expo export`) + **`/code-review` y `/ponytail-review` aplicados**
  + **validación visual de la usuaria** + BASE-INVENTORY actualizado.
