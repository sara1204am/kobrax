# Panel web (apps/web) — Parte B: Cartera, Importación y Pagos

> Documentación **funcional**, pantalla por pantalla, escrita a partir del código real (no de los planes).
> Fecha de corte del análisis: 2026-10-09, rama `docs/movil-alineacion-web`.
> Convención: las rutas de archivo son relativas a la raíz del repo. `P` = `apps/web/src/app/(panel)`.
> Donde algo no se pudo comprobar en el código se escribe **«no verificado»**.
> Donde `docs/epics` o `docs/refactor` contradicen al código, está marcado con **⚠ Contradicción** y recopilado en la sección 9.

## 0. Índice de pantallas

| # | Pantalla | Ruta | Sección |
|---|----------|------|---------|
| 1 | Cartera (lista de clientes) | `/cartera` | 2.1 |
| 2 | Nuevo cliente (modal) + detección de duplicados | `/cartera` (modal «Nuevo cliente») | 2.2 |
| 3 | Ficha del cliente | `/cartera/[id]` | 2.3 |
| 4 | Edición por secciones de la ficha (modal) | `/cartera/[id]` (modal «Editar») | 2.4 |
| 5 | Revisión de vínculo (banner de la ficha) | `/cartera/[id]` | 2.5 |
| 6 | Bitácora completa del cliente | `/cartera/[id]/bitacora` | 2.6 |
| 7 | Crédito: vista / editor / plan / mora | `/cartera/[id]/credito/[cid]` | 2.7 |
| 8 | Nuevo préstamo | `/cartera/[id]/prestamo` | 2.8 |
| 9 | Importación de cartera (subir → vista previa → confirmar + historial) | `/import` | 3.1 |
| 10 | Detalle de una importación | `/import/[id]` | 3.2 |
| 11 | Ajustes de importación | `/import/ajustes` | 3.3 |
| 12 | Emparejar columnas | `/import/ajustes/columnas` (redirige a #11) | 3.4 |
| 13 | Pagos (libro de pagos) | `/pagos` | 4.1 |
| 14 | Detalle de un pago | `/pagos/[id]` | 4.2 |
| 15 | Registrar un pago (modal) | `/pagos` y `/cartera/[id]/credito/[cid]` | 4.3 |
| 16 | Pedir un cobro (solicitud de pago) | `/pagos/solicitudes/nueva?creditId=…` | 4.4 |
| 17 | Detalle de una solicitud de cobro | `/pagos/solicitudes/[id]` | 4.5 |
| 18 | Listado de solicitudes | `/pagos/solicitudes` (redirige a `/pagos`) | 4.6 |

Secciones transversales: 1 (reglas comunes), 5 (importación: flujo extremo a extremo y formatos), 6 (permisos por rol), 7–9 (estado, contradicciones, no verificado).

---

## 1. Reglas comunes a las tres áreas

### 1.1 Cómo se decide el acceso

* **El menú** (`apps/web/src/lib/nav.ts`) muestra «Cartera» con `client:read`, «Importar» con `client:import`, «Pagos» con `payment:read`. Sin el permiso el ítem **no se dibuja**.
* **Las páginas no comprueban permisos por sí mismas**: quien escriba la URL llega, y es la **API** la que devuelve 403 (la lista cae en un estado de error). `apps/web/src/middleware.ts` solo exige sesión (cookie `k_access`/`k_refresh`) para `/cartera`, `/import`, `/pagos` y sus `/api/*`.
* **Alcance de datos (RLS)**: `apps/api/src/database/prisma.service.ts` + `packages/database/prisma/rls/002_scope.sql`. Quien tiene `data:scope:all` ve toda la empresa; **quien no lo tiene corre con scope `own`** (solo su asignación efectiva, permanente + temporales vigentes). Con la matriz por defecto (`packages/shared/src/constants/permissions.ts`) tienen `data:scope:all`: ACCOUNT_ADMIN, MANAGER, AUDITOR, VIEWER. **COLLECTOR y SUPERVISOR no** (el SUPERVISOR tiene `data:scope:branch`, pero el código solo distingue `account`/`own`: «sucursal» no está implementado en RLS). La matriz real puede estar personalizada en base de datos: **no verificado**.
* Respuestas API estandarizadas `{ data, meta, error }`; el panel las consume por BFF (`apiCall` en `apps/web/src/lib/bff.ts`; los componentes cliente llaman a `/api/*` del propio Next, que reenvía con el Bearer y valida `sameOrigin`).

### 1.2 Tabla de listado (`DataTable`)

`apps/web/src/components/data-table.tsx` (+ `data-table-filters.tsx`, `search-box.tsx`, `lib/table-prefs.ts`). Las listas de Cartera, Pagos, Historial de importaciones y Movimientos de una importación la usan.

* El **estado vive en la URL** (`?sort=&dir=&page=&pageSize=&q=…`): se comparte por link y «atrás» funciona. La tabla no llama a la API: el server component pide y la tabla solo escribe la URL.
* Tamaños de página: **25 / 50 / 100** (`PAGE_SIZES`); la API acota `limit ≤ 100`.
* Botones de barra: **Filtros** (panel lateral), **Columnas** (mostrar/ocultar y reordenar con arrastre o Alt+flechas), «Por página», paginación Anterior/Siguiente, «Limpiar».
* Preferencias (filtros, orden, tamaño, columnas) por usuario y por tabla en `localStorage` (`tablePrefs:<userId>:<tableId>`, `PREFS_VERSION = 1`); no se guarda la página. No viajan entre equipos.
* Dos vacíos distintos: «lista vacía» (sin filtros) y «sin resultados» (con filtros).
* La selección de filas es opt-in; ni Cartera ni Pagos la usan (sí la usa la vista previa de importación para asignar responsables).

### 1.3 Catálogos, moneda y fuente

* Moneda mostrada: `AccountInfo.currencyCode` de `GET /accounts/me` (por defecto `BOB`).
* **Fuente del crédito** (`creditSource`): `KOBRAX` (lo calcula el sistema) o `PSF` (reportado por archivo). Se ve como insignia (`components/source-badge.tsx`) y como filtro «Fuente» en Cartera y Pagos.
* Catálogos usados: `CREDIT_TYPE` (tipo de crédito), `COLLATERAL_TYPE` (tipo de garantía), vía `GET /catalogs/:type`.

---

## 2. Cartera

### 2.1 Cartera — `/cartera`

* **Propósito:** ver a quién se le presta, cuánto debe y hace cuántos días, una fila por persona, para triar y abrir fichas.
* **Quién accede:** menú con `client:read` (todos los roles por defecto). La API `GET /clients` exige `client:read` (`clients.controller.ts`). Sin acceso: pantalla «No tienes acceso a la cartera» con `[Reintentar]` (`RetryState`) y el mensaje del servidor. Con scope `own` (cobrador) la lista es **solo su cartera asignada** (ver 1.1). `Nuevo cliente` solo si `client:write`.
* **Qué muestra** (`P/cartera/page.tsx`, `portfolio-table.tsx`):
  * Bajada «Quién te debe, cuánto y hace cuántos días.» (sin título: ya lo dice el menú).
  * **Columnas** (visibles por defecto): *Cliente* (nombre/razón social + documento **enmascarado**; enlace a la ficha; ordenable), *Deuda* (suma de créditos; ordenable, 1.er clic descendente; si parte es de créditos reportados muestra «de ella X reportada (PSF)» o «toda reportada (PSF)»), *Mora* (máximo de días; ordenable; en rojo si aún debe, en gris si ya pagó), *Créditos* (conteo), *Estado* (insignia, **no ordenable**). Columnas ocultas por defecto, activables en «Columnas»: *Riesgo* (`riskSegment`) y *Estado del cliente* (Activo/Inactivo/Bloqueado).
  * **Estado** (derivado en el navegador con `portfolioStatus` de `shared`): *Pagado* si saldo ≤ 0,005; *En mora* si días > 0; si no, *Al día*. **«Por vencer» nunca aparece en la lista** (no hay `nextDueDate` agregado); sí en la ficha. «Promesa» existe como etiqueta pero no se usa en esta lista.
  * **Filtros** (panel lateral; las claves son las de la URL): *Responsable* (select con los miembros del equipo = `assignedManagerId` de algún crédito), *Sucursal* (se dibuja **apagado/vacío**: no hay endpoint de sucursales), *Rango de mora* (`dpdMin`–`dpdMax`), *Estado* (radio: En mora → `dpdMin=1`; Pagado → `debtMax=0`), *Rango de deuda* (`debtMin`–`debtMax`), *Fuente* (Kobrax / PSF). También acepta por URL `creditsMin/creditsMax`, `status`, `risk` (sin control visible).
  * **Búsqueda** (`SearchBox`, 300 ms de debounce, `?q=`): nombre, razón social o **documento completo** (el documento está cifrado: se busca por blind index; una parte del carnet no encuentra). Varios términos = AND (hasta 5, `searchTerms`).
  * Orden: el adaptador solo envía `sort`/`dir` si el usuario ordenó (`name`, `debt`, `dpd`, `createdAt`); el comentario del componente dice que «abre por mora descendente», pero el orden por defecto del servidor cuando no llega `sort` es **no verificado**.
  * Pie «Mostrando X–Y de N clientes».
* **Acciones:** abrir ficha (clic en nombre); ordenar; filtrar; buscar; ⚙ Columnas; **Nuevo cliente** (2.2, solo `client:write`).
* **Datos que consume:** `GET /clients?view=portfolio&page&limit&q&sort&dir&dpdMin…&managerId&source` (lista + agregados calculados en la misma consulta); `GET /accounts/me` (moneda); `GET /auth/me` (userId para preferencias); `GET /users` (selector de responsable; si da 403 el selector queda vacío y la pantalla abre igual); `GET /catalogs/COLLATERAL_TYPE` (para el modal de alta).
* **Navegación:** llega desde el menú «Cartera», desde el dashboard, desde Mora/Pagos y tras importar. Lleva a `/cartera/[id]`.
* **Estados especiales:** carga = tabla atenuada mientras Next trae la página; error = `RetryState`; vacío «La cartera está vacía / Cuando des de alta a un cliente va a aparecer acá»; sin resultados «Ningún cliente coincide». Un valor inventado en la URL (sort inexistente, `dpdMin` con letras, uuid inválido) **se descarta antes de llegar a la API** (`lib/cartera-query.ts`).
* **Estado:** ✅ operativa. 🟡 el filtro «Sucursal» está apagado.

### 2.2 Nuevo cliente (modal) y detección de duplicados — `/cartera` (modal)

* **Propósito:** dar de alta un cliente (con teléfonos, direcciones, garantes y garantías) sin salir de la cartera.
* **Quién accede:** botón visible solo con `client:write` (ACCOUNT_ADMIN, MANAGER, COLLECTOR por defecto; el SUPERVISOR no). API `POST /clients` con `client:write`. La ruta antigua `/cartera/nuevo` **ya no existe**.
* **Qué muestra:** modal ancho «Nuevo cliente» con las mismas secciones que la ficha en acordeón (`components/client-form.tsx`): *Identificación* (abierta), *Contacto*, *Direcciones*, *Garantes y contactos*, *Garantías*. Texto «Con nombre, apellido y un teléfono alcanza para guardar.»
* **Acciones / campos** (validación en `packages/shared/src/utils/client-form.ts` y en el servidor):
  * **Tipo**: Persona | Empresa (por defecto Persona).
  * **Documento** (CI o NIT): texto libre, **opcional**. Si ya existe → bloquea.
  * **Persona**: *Nombre* (obligatorio, ≥ 2 caracteres para habilitar Guardar) y *Apellido* (obligatorio, ≥ 1); *Género* (Sin especificar / Masculino / Femenino / Otro). **Empresa**: *Razón social* (obligatoria, ≥ 2).
  * *Segmento de riesgo*: texto libre opcional. *Estado*: Activo (def.) / Inactivo / Bloqueado.
  * **Teléfonos/correos** (`ContactRows`): tipo Teléfono | Correo; valor (teléfono: patrón `[\d+][\d\s-]{4,}`, máx. 32, «Al menos 5 dígitos. Puede empezar con + y llevar espacios o guiones»); casilla WhatsApp (marcada por defecto; envía tipo `WHATSAPP`); casilla Principal. Arranca con **una fila de teléfono principal**. **Obligatorio al menos un teléfono con valor** para habilitar «Guardar» (regla del formulario: `canSubmitCliente`; el servidor **no** la exige).
  * **Direcciones**: tipo (Domicilio, Trabajo, Familiar, Otra), zona/barrio, dirección, referencia, ubicación en el mapa (modo Manual lat/long, «Mi ubicación» por GPS del navegador, o clic en mapa con pin arrastrable; lat ∈ [-90, 90], long ∈ [-180, 180]), **fotos de la vivienda** (hasta 20, JPEG/PNG/WebP; la primera es la principal). Una fila sin datos no se envía.
  * **Garantes**: nombre (obligatorio para que se envíe), relación (Garante, Familiar, Compañero de trabajo, Vecino, Otro), género, «Se le puede llamar», notas, sus propios teléfonos y direcciones, y los **créditos que garantiza** (vacío si el cliente aún no tiene créditos: «Se puede vincular después»).
  * **Garantías**: tipo (catálogo `COLLATERAL_TYPE`, o texto libre máx. 64 si no hay catálogo), descripción (**obligatoria**, máx. 500; sin ella la fila se descarta), valor estimado (≥ 0), moneda (desplegable; arranca en la de la cuenta), fotos, créditos que respalda.
  * **Detección de duplicados** (`lib/duplicate-check.ts` → `POST /clients/duplicate-check`, `client:read`): con 400 ms de espera mientras se escribe, cuando hay documento ≥ 3 caracteres, o nombre+apellido ≥ 2 caracteres cada uno (empresa: razón social ≥ 2).
    * **Mismo documento → BLOQUEA**: mensaje bajo el campo «Este carnet ya es de {nombre}» + enlace «Ver cliente» (nueva pestaña). Si el dueño está dado de baja: «…que está dado de baja. No se puede usar para un cliente nuevo.» El servidor igual rechaza con `CLIENT_DUP` (409).
    * **Mismo nombre → AVISA, no bloquea**: tarjeta amarilla con hasta **5** homónimos (nombre, documento enmascarado o «sin carnet», «otro carnet», nº de créditos) y la casilla **«Es otra persona, crear igual»**; Guardar queda deshabilitado hasta marcarla. La confirmación es **para ese nombre**: si se cambia, hay que volver a confirmar.
    * Antes de guardar se vuelve a consultar sin esperar (la última respuesta podría tener tres teclas de atraso).
  * **Guardar** → `POST /clients` con el cuerpo `buildClientePayload` (cliente + contactos + direcciones + garantes + garantías en **una sola transacción**). Éxito: toast «Guardado» y redirige a `/cartera/[id]`. Error: banner con el mensaje del servidor (`CLIENT_DUP`, «Una persona requiere nombre y apellido», «Una empresa requiere razón social», límite de plan).
* **Reglas de negocio del servidor** (`clients.service.ts`): documento y teléfonos/direcciones cifrados en reposo; documento único por empresa (blind index `nationalIdHash`); **límite de plan** `PLAN_LIMIT_REACHED` («Tu plan permite N clientes. Ya tenés M.») al crear; auditoría `CREATE` por cada sub-entidad.
* **Datos que consume:** `POST /clients/duplicate-check` (vía `/api/clients/duplicate-check`), `POST /clients` (vía `/api/clients`), `POST /uploads` (vía `/api/account/upload`, fotos).
* **Navegación:** desde `/cartera` → tras guardar a `/cartera/[id]`. Cerrar el modal vuelve a la misma lista con los mismos filtros.
* **Estados especiales:** «Buscando si ya existe…» mientras consulta; el botón Guardar muestra `loading`; el modal se monta al abrir (borrador limpio cada vez). Un campo obligatorio dentro de un acordeón plegado abre su sección al fallar la validación nativa.
* **Estado:** ✅.

### 2.3 Ficha del cliente — `/cartera/[id]`

* **Propósito:** perfil operativo completo de una persona: identificación, créditos, contactos, direcciones, adjuntos, garantes, garantías, resumen y bitácora.
* **Quién accede:** `client:read` (`GET /clients/:id`). Un `[id]` que no es uuid → 404; cliente inexistente/otro tenant → 404; otro error → «No tienes acceso a la cartera» con el mensaje del servidor. Las secciones de otros dominios degradan sin tumbar la pantalla: sin `credit:read` la sección Créditos dice «Tu rol no puede ver los créditos.»; sin permiso de bitácora/`/users` la bitácora dice «Todavía no se registró ninguna gestión ni cobranza.»
* **Qué muestra** (`P/cartera/[id]/page.tsx`, `client-card.tsx` y componentes):
  * **Encabezado:** nombre completo o razón social, tipo (Persona/Empresa), insignia de estado del cliente; acciones: **Descargar PDF** y **Dar de baja**.
  * **Banner «Revisar vínculo»** (2.5) si el cliente quedó pendiente de revisión.
  * **Identificación:** Documento (enmascarado hasta revelar), NIT (si existe), Segmento de riesgo (si existe), Alta (fecha).
  * **Créditos** (`credits-section.tsx`): botón «+ Nuevo crédito» (con `credit:write`) → 2.8; tarjetas desplegables por crédito: código (enlace a 2.7), tipo de crédito (catálogo o «Sin clasificar»), insignias (definición de condiciones, «Cargado en curso», «Préstamo abierto», fuente PSF «al dd/mm» / «Ausente del reporte» / «Dato desactualizado», o «Importado»), Monto total, estado (Vigente, Pagado, En mora, Reestructurado, Castigado, Anulado), días de mora; al abrir: Monto total, Cuota (+ «vence dd/mm/aaaa»), Saldo pendiente, barra de progreso de pago. Abierta por defecto si está en mora y no cerrada. Los **cerrados** (Pagado/Anulado/Castigado) se ocultan; enlace «Ver historial (N)» / «Ocultar historial» (`?historial=1`). Si el servidor no informa un dato de un crédito importado se muestra «No registrado».
  * **Contacto** (`ContactList`): tipo, valor **enmascarado**, insignia «principal»; botones **Mostrar** (revela todos) y ojo (detalle: tipo, valor, principal, verificado, notas).
  * **Direcciones** (`LocationList`): dirección, tipo · zona, miniatura de la primera foto, **Mostrar** y ojo → modal con fotos (visor con zoom/siguiente), zona, dirección, referencia, coordenadas y **mapa** con el punto (o «Sin punto en el mapa»).
  * **Adjuntos:** lista por tipo (Documento de identidad, Fotografía, Contrato, Otro), fecha, huella SHA-256 abreviada (12 caracteres), Ver (modal de imagen), Descargar, Editar (reclasificar tipo), Quitar. Estado vacío con zona de arrastre.
  * **Columna derecha:** *Resumen de cuenta* (Balance total adeudado, Créditos totales, Vencidos = créditos con mora > 0 y saldo > 0, en rojo si > 0); *Bitácora de actividad* (últimas **8** entradas + «Ver todo» → 2.6); *Garantes y contactos* (nombre, relación, «no contactar», teléfonos/direcciones, «Garantiza N préstamos», ojo → detalle); *Garantías* (descripción, tipo · valor, «Respalda N préstamos»).
  * La ficha pide hasta **100 créditos** (`limit=100`); más allá no se listan: **no verificado** si hay paginación.
* **Acciones:**
  * **Mostrar / revelar PII:** `POST /api/clients/:id/reveal` → `GET /clients/:id?reveal=true`. Cualquiera con `client:read` puede (el requisito `client:pii:read` fue retirado del endpoint); **cada revelado queda auditado** (`client/PII_REVEAL`). Revela documento, teléfonos y direcciones de la ficha entera.
  * **Editar** (por sección, solo `client:write`): primero revela (para no pisar el dato real con la máscara) y abre 2.4.
  * **Descargar PDF** (`GET /api/clients/:id/pdf`): «Legajo de cliente» con KPIs (saldo total, créditos vigentes de total, mora máxima, créditos en mora), Identificación, Contactos, Ubicaciones, Créditos, Créditos en mora (situación, días, saldo, prioridad, en mora desde, última gestión), Respaldo (garantes y garantías) y Adjuntos. **Revela PII** igual que «Mostrar» y se audita como `PII_REVEAL`. El enlace se muestra siempre (API exige `client:read`).
  * **Dar de baja** (`DELETE /clients/:id`): visible con `client:write`, **sin créditos activos** (en la lista de la ficha) y estado distinto de Inactivo. Confirmación «¿Dar de baja a X? Queda inactivo y sale de la cartera, pero su historial —cobranzas, pagos y gestiones— sigue en pie.» No borra: pone `deletedAt` y estado Inactivo. El servidor rechaza con `CLIENT_HAS_CREDITS` si tiene créditos con estado `ACTIVE`. Éxito → toast y vuelve a `/cartera`.
  * **Adjuntos:** «Subir archivo» o arrastrar (primer archivo soltado) → sube a `POST /uploads` y registra `POST /clients/:id/attachments` con `fileType: OTHER` y la huella; reclasificar con `PATCH`; quitar con confirmación («El archivo sale del legajo junto con su huella… No se puede deshacer») → `DELETE`. **El servidor de uploads solo acepta JPEG, PNG o WebP, máx. 8 MB** (`uploads.service.ts`): un PDF o Word es rechazado con «Tipo no permitido…», aunque el texto de ayuda sugiera «CI, certificados de trabajo o facturas».
* **Datos que consume:** `GET /clients/:id`, `GET /credits?clientId=&limit=100`, `GET /accounts/me`, `GET /clients/:id/timeline?limit=8`, `GET /users`, `GET /catalogs/CREDIT_TYPE`, `GET /catalogs/COLLATERAL_TYPE` (siete llamadas en paralelo; solo la del cliente decide si hay pantalla); `POST /clients/:id/reveal`, `PATCH /clients/:id` (BFF → varias llamadas), `DELETE /clients/:id`, adjuntos y PDF como arriba.
* **Navegación:** llega desde Cartera, Pagos, Mora, Agenda, detalle de importación y enlaces de duplicados. Lleva a: crédito (2.7), nuevo préstamo (2.8), bitácora (2.6), y desde el crédito a Mora (`/mora/[creditId]`, solo con `collection:read`).
* **Estados especiales:** timeline vacío/denegado, créditos denegados, adjuntos vacíos con ayuda, «Sin teléfonos/direcciones/garantes/garantías cargadas». Botones de edición ausentes sin `client:write`.
* **Estado:** ✅. 🟡 el texto de ayuda de Adjuntos («Los adjuntos todavía no se pueden abrir desde el panel») está **obsoleto**: el código ya ofrece Ver y Descargar (⚠ Contradicción interna, ver 8).

### 2.4 Edición por secciones — `/cartera/[id]` (modal «Editar»)

* **Propósito:** corregir una sección de la ficha en el lugar (no hay ruta de edición).
* **Quién accede:** `client:write`; el servidor lo exige en cada sub-recurso.
* **Qué muestra:** modal ancho con la sección elegida: *Identificación*, *Contacto*, *Direcciones*, *Garantes y contactos* o *Garantías*, con los mismos campos y validaciones de 2.2 (hidratados con el dato **ya revelado**). Botón «+ Agregar …» por sección.
* **Acciones:** **Guardar** (deshabilitado hasta que haya cambios): el navegador calcula un *diff* (`diffCliente`: agregar/actualizar/quitar por sub-entidad, incluidos teléfonos y direcciones de cada garante) y lo manda a `PATCH /api/clients/:id`, que lo traduce a varias llamadas a la API (`PATCH /clients/:id`, `POST/PATCH/DELETE …/contacts|locations|relations|collaterals`). **No es atómico:** si una falla, las anteriores ya quedaron guardadas; se devuelve el mensaje de la que falló y cuántos cambios entraron (`applied`).
  * Desde la web **no se edita el NIT** (se muestra pero el formulario no tiene campo; el DTO de la API sí lo admite).
  * Cambiar documento a uno existente → `CLIENT_DUP`; cambiar tipo/identidad sin nombre → `CLIENT_INVALID`.
  * Los garantes y garantías se vinculan a créditos (`creditIds`, máx. 50 por entrada).
* **Datos:** `PATCH /api/clients/:id` (BFF), `POST /api/clients/:id/reveal` (antes de abrir y al guardar, para refrescar).
* **Navegación:** se cierra al guardar y la ficha se recarga.
* **Estados especiales:** botón Guardar con `loading`; banner de error con el mensaje del servidor.
* **Estado:** ✅ (🟡 por la no-atomicidad documentada).

### 2.5 Revisión de vínculo — banner de `/cartera/[id]`

* **Propósito:** resolver si un cliente creado por una importación es la misma persona que otro ya existente.
* **Quién accede:** el banner aparece si `client.linkReviewPending`; los botones solo con `credit:write` (ACCOUNT_ADMIN, MANAGER, COLLECTOR por defecto).
* **Qué muestra:** tarjeta amarilla «Revisar vínculo». Dos textos: *con sugerencias* («La importación creó este cliente porque ya tenías a alguien con el mismo nombre, y no los juntó sola…») o *mismo archivo* («El reporte trae varias operaciones con este mismo nombre y se juntaron en un solo cliente. Confirmá que es una sola persona.»). Lista de candidatos (nombre + nº de créditos, enlace en nueva pestaña).
* **Acciones:**
  * **«Es esta persona»** (por candidato): hace `POST /api/credits/:id/link-client {clientId}` por **cada crédito de este cliente**, y navega a la ficha destino. En el servidor (`credits.service.ts › linkClient`): mueve el crédito y sus gestiones, agenda, paradas de ruta y solicitudes de pago al cliente destino, **guarda la clave de nombre confirmada** para que futuras importaciones lo asocien solo, y si el cliente de origen se queda sin créditos y estaba en revisión, lo **retira** (soft delete) pasando teléfonos/direcciones al destino si este no tenía.
  * **«Es otra persona»**: `POST /api/credits/link-review/:clientId/confirm` cierra la revisión (el cliente queda como nuevo).
* **Datos:** los de arriba. **Navegación:** al destino elegido o recarga de la ficha.
* **Estados especiales:** botones deshabilitados mientras corre uno; error en banner (`errorText`).
* **Estado:** ✅. Nota: esta revisión **no vive en la pantalla del crédito** sino en la ficha del cliente; en la pantalla de crédito no hay ninguna revisión de vínculo.

### 2.6 Bitácora completa — `/cartera/[id]/bitacora`

* **Propósito:** ver todo lo hecho con una persona (pagos, agenda, gestiones) en orden cronológico.
* **Quién accede:** `client:read` (cliente) + el endpoint de timeline (`client:read`). Un 404 del cliente → 404.
* **Qué muestra:** título «Bitácora de actividad», subtítulo con el nombre, botón «Volver al cliente». Lista de **50** entradas por página con punto de color por tipo (pago verde, agenda azul, gestión violeta): título (Pago registrado; Llamada / Visita domiciliaria / WhatsApp / Recordatorio / Promesa de pago; Nota / Llamada / Visita / Pago / Reasignación / Mensaje), detalle (monto, estado de la agenda — Agendada/Realizada/Cancelada/Reagendada —, notas, «Asignado a X (rol)», quién lo hizo) y fecha relativa. Paginación simple «Página N de M» con Anterior/Siguiente (solo si hay más de una página).
* **Acciones:** paginar; volver. Solo lectura.
* **Datos:** `GET /clients/:id`, `GET /clients/:id/timeline?page&limit=50`, `GET /users` (nombres).
* **Navegación:** desde «Ver todo» de la ficha; vuelve a `/cartera/[id]`.
* **Estados especiales:** sin entradas o 403 → «Todavía no se registró ninguna gestión ni cobranza.»; error del cliente → `RetryState`.
* **Estado:** ✅.

### 2.7 Crédito — `/cartera/[id]/credito/[cid]`

* **Propósito:** ver (y editar) las condiciones, el estado actual, el plan de pagos, la cobranza y el origen de un crédito.
* **Quién accede:** `credit:read` (`GET /credits/:id`). `[cid]` no uuid o inexistente → 404; otro error → «No tienes acceso a la cartera». Botón **Editar** y acciones de mora con `credit:write`; **Registrar un pago** con `payment:write`; bloque de gestión de cobranza con `collection:read`. El `[id]` de la URL (cliente) **no se valida contra el crédito**: se usa solo para el enlace «Volver al cliente».
* **Qué muestra** (`credit-card.tsx`, `credit-view.tsx`):
  * **Encabezado:** saldo pendiente como título («No registrado» si el import no lo trajo), subtítulo «Capital X · código», insignias «Importado» (crédito bloqueado) y «N días» de mora; acciones: *Registrar un pago*, *Pagos del crédito* (→ `/pagos?creditId=…`), *Volver al cliente*, *Editar*. Aviso «Este crédito vino de otra fuente: sus números los manda esa fuente, no se editan acá.» si está bloqueado.
  * **Gestión de cobranza** (con `collection:read`): insignia de situación (`SituationBadge`: al día / en mora / castigado + categoría) y botón «Abrir gestión de cobranza» → `/mora/[creditId]`.
  * **Condiciones:** si tiene `terms`: definición (Calcular cuotas / Cuota acordada / Total acordado), monto, interés (como se pactó, p. ej. «18 % anual», y su equivalente «por cuota»; tipo de interés y método de amortización), cuota o total acordado, número de cuotas (o «Pago único»/«Préstamo abierto»), frecuencia, primer pago/fecha de pago, desgravamen, otros cargos, y un recuadro con **Cuota (o primera cuota), Total a cobrar y Ganancia**. Si no tiene `terms` (legado/importado): capital, cuota, cuotas, frecuencia, interés — con «No registrado» para lo que el archivo no trajo.
  * **Estado actual:** Saldo pendiente, Total a cobrar, Próximo cobro, Mora (insignia con días, «desde dd/mm», «Cuota a reclamar: N (venció dd/mm)») o «Al día», método de conteo de mora (si no está bloqueado), Estado, barra de progreso de pago; notas de «cargado en curso», «Mora declarada al registrarlo», saldo legado y, para créditos reportados, aviso amarillo «Saldo y mora son del corte del …, hace más de N días: pueden no reflejar la situación de hoy».
  * **Plan de pagos:** calculado por el motor con las mismas condiciones que se guardaron (tabla con cuota, fecha, capital, interés, total, saldo; seguro y cargos si aplican), o cronograma guardado (cuota, vence, monto, pagado, estado Pendiente/Parcial/Pagada/Vencida), o textos «Préstamo abierto: sin número de cuotas no hay plan» / «Crédito importado: el plan lo lleva la fuente» / «no tiene cronograma, y está bien». **Exportar plan de pagos** descarga un CSV en el navegador (`paymentPlanCsv`).
  * **Cobranza:** Responsable (cobrador asignado o «Sin asignar»), Código, Tipo de crédito, Notas.
  * **Origen:** Origen (Cargado a mano / Carga rápida / Importado de archivo / Integración), Moneda, Desembolso, Registrado, Última importación, Referencia externa, Operación (fuente + id), «Números al corte del», «En el reporte» (Viene / Ya no viene desde dd/mm) y «Datos que trajo el archivo: X de 9» con la lista de no registrados.
* **Acciones:**
  * **Editar** (`credit:write`): activa el editor (`credit-editor.tsx`). Según `termsEditBlock`:
    * Editable cuando no hay pagos, no está bloqueado y no tiene cronograma guardado sin condiciones: se pueden **redefinir condiciones** (mismos campos que 2.8) y el **estado al registrar** (cuotas ya pagadas, saldo, días de mora); panel lateral con la cuota/plan en vivo.
    * Bloqueado con mensaje: «Ya tiene pagos registrados: … Eso es una reestructura» (`payments`), «Tiene un cronograma guardado…» (`schedule`), «Este crédito vino de otra fuente…» (`locked`).
    * Siempre editables (salvo `locked`, que deshabilita Estado y Código): **Estado** (Vigente, Pagado, En mora, Reestructurado, Castigado, Anulado), **Código** (máx. 64), **Tipo de crédito**, **Responsable** (solo con `assignment:write`; opciones = cobradores activos + uno mismo; «Cambiarlo no mueve los casos abiertos»), **Próximo cobro** (con pagos o cronograma), **Notas** (máx. 500).
    * Guardar → `PATCH /api/credits/:id` con un parche mínimo. Reglas del servidor: no se puede mezclar redefinición con campos sueltos (`CREDIT_TERMS_CONFLICT`); un crédito importado rechaza cambios financieros, de fecha, estado o código (`CREDIT_LOCKED`); con condiciones se edita redefiniéndolas (`CREDIT_TERMS_EDIT_UNSUPPORTED`); con pagos no se redefine (`CREDIT_HAS_PAYMENTS`).
    * ⚠ **El selector de Estado ofrece «Castigado»**, pero el servidor lo rechaza (`CREDIT_WRITE_OFF_USE_ENDPOINT`: «El castigo no es un estado: usá POST /credits/:id/write-off»).
  * **Mora manual** (`arrears-actions.tsx`, con `credit:write`, oculto si el crédito está bloqueado/importado):
    * *Marcar en mora* (si 0 días): modal con «Días que lleva en mora» (0–3650; 0 = desde hoy) → `POST /credits/:id/arrears {days}`. Exige crédito `ACTIVE` (`CREDIT_NOT_ACTIVE`) y no importado (`CREDIT_LOCKED`); abre cobranza en Mora y los días corren solos.
    * *Poner al día* (si hay mora): elige cómo queda — «Corre al siguiente período», «Con la fecha que acordamos» (fecha futura obligatoria; `ARREARS_DATE_PAST` si no lo es) o «Sin fecha de vencimiento» → `POST /credits/:id/arrears/clear {mode, date?}`.
  * **Castigo:** **no está en esta pantalla.** Se hace desde `/mora/[creditId]` (botón de castigo; API `POST/DELETE /credits/:id/write-off`, requiere `credit:write` **y** `data:scope:all`, o `WRITE_OFF_FORBIDDEN`). Aquí solo se refleja en la insignia de situación y en el PDF de la ficha («Castigado»). Un reporte importado con estado mapeado a «castigado» también marca el castigo (`portfolio-credit.ts`).
  * **Registrar un pago:** abre el modal 4.3 con el crédito fijado y el importe sugerido (`suggestedPaymentAmount`).
* **Datos que consume:** `GET /credits/:id`, `GET /users`, `GET /catalogs/CREDIT_TYPE`, `GET /assignments/assignees`; `PATCH /credits/:id`, `POST /credits/:id/arrears`, `POST /credits/:id/arrears/clear`, `POST /payments`.
* **Navegación:** desde la ficha (tarjeta de crédito), desde Pagos (detalle de pago → «Crédito»). Lleva a `/pagos?creditId=…`, `/mora/[id]`, `/cartera/[clientId]`.
* **Estados especiales:** campos «No registrado» para créditos importados incompletos; crédito bloqueado (solo lectura); aviso de reporte desactualizado (umbral `staleAfterDays`, 1–60, por defecto 2).
* **Estado:** ✅ lectura; 🟡 edición (opción «Castigado» inválida en el selector).

### 2.8 Nuevo préstamo — `/cartera/[id]/prestamo`

* **Propósito:** registrar un crédito manual para un cliente, con cálculo en vivo de cuota y plan.
* **Quién accede:** botón «+ Nuevo crédito» con `credit:write`; la API `POST /credits` exige `credit:write`. La ruta no comprueba permiso: quien escriba la URL ve el formulario y falla al guardar. El cliente debe existir (404 si no).
* **Qué muestra** (`prestamo/loan-form.tsx`, `components/credit-terms-fields.tsx`): encabezado «Nuevo crédito — Para {cliente}», formulario de condiciones + panel lateral con **Cuota, Total a cobrar, Ganancia** (y primera cuota, desgravamen, cargos, «Monto a entregar» si hay descuentos), y el **Plan de pagos** (fecha, capital, interés, total, saldo, seguro, cargos) como vista previa «con las mismas condiciones que se guardan».
* **Acciones / campos** (i18n `portfolio.creditForm`, reglas en `packages/shared/src/utils/credit-form.ts` / `credit-engine.ts`):
  * *Cómo definirlo*: **Calcular cuotas** (la cuota sale de interés, nº de cuotas y frecuencia), **Cuota acordada** (sin tasa) o **Total acordado** (sin tasa; pago único o en cuotas).
  * *Monto a prestar* (> 0), *Interés (%)* con período (por cuota / mensual / trimestral / semestral / anual) y convención (Nominal / Efectiva TEA) — muestra la «equivalencia por cuota»; *Plazo* en cuotas, meses o años (debe dar un número entero de cuotas con la frecuencia: 1–600); *Frecuencia* (Diario, Semanal, Quincenal, Mensual, Trimestral, Semestral, Anual); *Primer pago* / *Fecha de pago*.
  * *Opciones avanzadas*: tipo de interés (Simple/Compuesto), tipo de cuota (Cuota fija / Cuota variable / Pago único), cómo se aplica el interés (% por cuota / % del total; solo simple + cuota fija), **desgravamen** (0–5 % mensual sobre saldo), **otros cargos** (por cuota, monto único en la 1.ª cuota, % en la 1.ª cuota, monto descontado, % descontado), **método de conteo de mora** (desde la cuota impaga más antigua / desde el primer atraso hasta quedar al día; por defecto el de la cuenta).
  * *Cuotas ya pagadas antes de registrarlo* (selector sobre el plan; no puede ser todas) para créditos que ya corrían fuera de Kobrax.
  * *Lo cobra* (responsable; solo si la API devuelve asignables, es decir con `assignment:write`), *Notas* (máx. 500).
  * Validaciones visibles (`issues`): monto > 0; interés ≥ 0 y ≤ 100 % por cuota / 500 % sobre el total; combinaciones no ofrecidas; cuotas 1–600; cuota/total > 0; frecuencia obligatoria; fecha válida; «el total no alcanza para esa cantidad de cuotas»; «Vas a cobrar menos de lo que prestás. Se puede guardar igual.»; desgravamen 0–5 %; lo descontado no puede ser todo el monto.
  * **Crear crédito** → `POST /api/credits`. Éxito: toast «Crédito registrado» y navega a la pantalla del crédito.
* **Reglas del servidor** (`credits.service.ts › create`): la moneda debe ser la de la cuenta (`CREDIT_CURRENCY`); no se crean créditos con origen importado/externo (`CREDIT_ORIGIN_NOT_ALLOWED`); estado al registrar inválido → `CREDIT_INITIAL_STATE_INVALID`; **límite de plan** de créditos activos `PLAN_LIMIT_REACHED`; el cronograma se valida (`SCHEDULE_INVALID`).
* **Datos:** `GET /clients/:id`, `GET /assignments/assignees`, `GET /accounts/me` (moneda y método de mora por defecto); `POST /credits`.
* **Navegación:** desde la ficha; «Cancelar» = `router.back()`; al guardar → `/cartera/[id]/credito/[nuevo]`.
* **Estados especiales:** botón Crear deshabilitado hasta que el estado del formulario sea válido; banner de error con el mensaje del servidor.
* **Estado:** ✅.

---

## 3. Importación de cartera

> El panel solo implementa la importación de **créditos** («Importación de cartera»): endpoints `/imports/portfolio/*`. El antiguo import de **clientes** con modos `RECONCILE` / `UPSERT_ONLY` / `REPLACE` (`POST /clients/imports`, `apps/api/src/modules/clients/import/`) **no tiene pantalla en el panel web** (no hay ninguna llamada en `apps/web`). Ver sección 5.5.

### 3.1 Importar datos — `/import`

* **Propósito:** subir el archivo del día, ver qué va a cambiar (vista previa sin escribir) y confirmar la importación; más el historial.
* **Quién accede:** `client:import` (ACCOUNT_ADMIN, MANAGER, SUPERVISOR, COLLECTOR por defecto; la API exige `client:import` en todos los endpoints de `/imports/portfolio`). Asignar responsables en la vista previa requiere `assignment:write`; quien no lo tiene queda en modo «SELF» (todo a sí mismo). Si `GET /imports/portfolio/config` falla: `EmptyState` con el mensaje.
* **Qué muestra** (`P/import/page.tsx`, `import-runner.tsx`, `history-table.tsx`, `assignment-controls.tsx`):
  * Encabezado «Import de cartera — Subí el archivo del día, mirá qué va a cambiar y recién ahí confirmá», botón **Ajustes**.
  * **Puertas** (en vez de la zona de carga): «El import está apagado» (`source = manual`: «Esta empresa carga la cartera a mano. Se enciende en Ajustes») o «Falta configurar el import» con la razón (`source` / `scope` / `profile` / `fields`: aún no hay ninguna columna emparejada), con botón «Ir a Ajustes».
  * **Zona de carga:** arrastrar o «Elegir archivo»; muestra el formato esperado según la forma configurada («CSV o Excel (.xlsx) · hasta 15 MB», «Reporte PDF con una tabla · hasta 15 MB», «Extracto PDF · hasta 15 MB»). **Elegir el archivo dispara de inmediato la vista previa** (dry-run).
  * **Vista previa** («Esto es lo que va a cambiar. Todavía no se guardó nada. El archivo se vuelve a subir al confirmar»): nombre del archivo, «Corte del dd/mm/aaaa» (o «El reporte no dice su fecha de corte») y «Asesor X»; tarjetas con contadores: **Nuevos, Se actualizan**, y si > 0: **Ya no vienen en el reporte (ausentes), Volvieron al reporte, Revisar vínculo, Ignoradas**, más **No se importan (inválidas)**; bloque **Avisos** agrupado (p. ej. «Todavía no confirmaste cuál columna son los días de atraso», «Puede que la columna de días de atraso esté mal elegida», «Hay créditos vigentes y sin cargos, pero con días de atraso», «El reporte no trae su fecha de corte…»).
  * **Tablas por balde** (cada una con título y conteo): *Nuevos* (N.º de crédito, Cliente + marcas «Revisar vínculo» / «cliente que ya tenías», Saldo, Mora, Estado en el reporte, Responsable), *Se actualizan* (código, cliente, saldo y mora **antes → después**, estado en el reporte, responsable actual / nuevo), *Volvieron al reporte*, *Ya no vienen en el reporte* (código, cliente, saldo, mora que pasa a 0 si la regla es «ponerlos al día»), *No se importan* (fila, código, cliente, motivo).
  * **Asignación de responsables:** modo `SELF` (el que importa no reparte): leyenda «Estos créditos se asignarán a ti» / «Mantendrán su responsable actual». Modo `CHOOSE` (con `assignment:write`): selector por fila, selección múltiple con «Asignar a…» / «Asignar a mí», «Asignar todos los sin asignar a…», «Mostrar sólo sin asignar», conteo «Asignados N · Sin asignar M» y por usuario; el reporte sugiere el responsable (etiqueta «del reporte»); en las actualizaciones se puede **reasignar** (insignia «Reasignación»), y al confirmar con reasignaciones sale un modal «Vas a cambiar el responsable de N créditos existentes. Sus casos abiertos siguen con el cobrador que tienen» con la lista.
  * **Aviso de plan:** «Este archivo trae N créditos nuevos y en tu plan quedan M lugares: sobran K. El archivo no se importa a medias…» → **Confirmar** deshabilitado.
  * **Resultado:** «Importación terminada» con contadores, tres leyendas (`Listo. La cartera quedó actualizada` / `Se importó, y N registros quedaron afuera` / `Este archivo ya se había importado. No se volvió a aplicar`), resumen por responsable («Nuevos por responsable», «N créditos reasignados», notas de asignaciones no aplicadas), los mismos baldes en modo lectura y «Importar otro archivo».
  * **Historial de importaciones** (tabla): *Fecha* (enlace al detalle), *Archivo*, *Corte*, *Asesor*, *Importó*, y contadores **Nuevos, Actualizados, Volvieron, Al día, Ausentes, Rechazadas (rojo), Ignoradas** (cada número enlaza al detalle filtrado por movimiento). **Filtros:** Fecha de importación (rango), Fecha de corte (rango), Importó (select); **búsqueda** por nombre del archivo, código de asesor o nombre de quien importó. Orden fijo (sin columnas ordenables). 25 filas por página por defecto.
* **Acciones:** elegir/soltar archivo; **Confirmar e importar** (deshabilitado si el plan se excede, si «ya se aplicó este archivo» —con «Este archivo ya se importó el {fecha} ({quien}). Confirmar no cambia nada; para reasignar responsables, usá Cartera»—, o si en modo CHOOSE quedan créditos nuevos sin responsable: «Quedan N créditos nuevos sin responsable: asignalos para poder confirmar»); **Cancelar** (descarta la vista previa); **Importar otro archivo**.
* **Reglas de negocio visibles** (detalle y fuente en la sección 5):
  * Un crédito se identifica por su **N.º de crédito/operación**; si ya existe (fuente PSF) se **actualiza** (saldo, mora, estado, etc.); si no, se **crea** (con cliente nuevo o asociado a uno existente).
  * **Ausentes** (estaban en el reporte anterior y ya no): **nunca se borran**; quedan marcados «Ausente» desde el día de corte; con la regla «Ponerlos al día» sus días de mora pasan a 0 (saldo y estado no se tocan); con «Dejarlos como están» no cambia nada.
  * **Duplicados**: el mismo N.º de crédito dos veces en el archivo → la segunda fila va a *No se importan* (`DUP_IN_FILE`). Un N.º que ya existe cargado a mano → rechazado (`MATCHES_MANUAL`), un N.º fuera del alcance del archivo → rechazado (`MATCHES_OUT_OF_SCOPE`).
  * **Idempotencia**: el mismo archivo (hash SHA-256) ya aplicado no se vuelve a aplicar.
  * **Reportes viejos no pisan nuevos**: si la fecha de corte es anterior a la del último reporte aplicado en ese alcance → `REPORT_OUTDATED`.
  * **Límite del plan**: el archivo entero se rechaza si los créditos nuevos exceden el cupo (no se importa «hasta llenar»).
* **Datos que consume:** `GET /imports/portfolio/config`, `GET /imports/portfolio/runs?…` (historial), `GET /auth/me`, `GET /accounts/me`, `GET /assignments/assignees`; `POST /api/imports/run` → `POST /imports/portfolio` (multipart: `file`, `dryRun`, `assignments` JSON).
* **Navegación:** desde el menú «Importar» (y, en el móvil, tras iniciar sesión). Lleva a `/import/ajustes`, `/import/[id]`.
* **Estados especiales:** leyendo el archivo («Leyendo el archivo…»); errores de la API traducidos (sección 5.4: `FILE_SHAPE_MISMATCH`, `XLS_LEGACY_NOT_SUPPORTED`, `NO_RECORDS_MAPPED`, `REPORT_OUTDATED`, `ADVISOR_NOT_LINKED`, `ADVISOR_BELONGS_TO_OTHER`, `UNASSIGNED_NEW_CREDITS`, `ASSIGNEE_NOT_ELIGIBLE`, `ASSIGNMENT_CONFLICT`, `PLAN_LIMIT_REACHED`, …); historial vacío «Todavía no importaste ningún archivo»; sin resultados «Ninguna importación coincide…».
* **Estado:** ✅ para CSV/Excel y PDF configurados. 🟡 la regla «Decidir en cada importación» no tiene interfaz de decisión (ver 5.3).

### 3.2 Detalle de una importación — `/import/[id]`

* **Propósito:** auditar qué hizo una corrida: metadatos, archivo original y movimiento por crédito.
* **Quién accede:** `client:import` (`GET /imports/portfolio/runs/:id`, `…/items`). `[id]` no uuid o inexistente → 404. Los botones **Ver documento** / **Descargar** se muestran solo si el usuario tiene `client:pii:read` **y** la importación guardó el archivo; la API del archivo exige **ambos** permisos (`client:import` y `client:pii:read`, el guard exige todos).
* **Qué muestra:** «← Importar datos», título «Importación del {fecha hora}», subtítulo con el nombre del archivo. Tarjeta con: Importó, Fecha de corte, Asesor, Alcance (Toda la empresa / Cartera de {nombre} / Sucursal {nombre}), Filas ignoradas (totales o notas), Archivo (nombre · tamaño). Aviso «Importación anterior al historial: no quedaron registradas cuáles se pusieron al día ni qué filas se rechazaron» si `itemsComplete = false`. **Pestañas** con contador: Todos, Nuevos, Actualizados, Volvieron, Al día, Ausentes, Rechazadas (`?action=`). **Tabla de movimientos** (50 por página): Registro (n.º de fila), Operación, Cliente (enlace a la ficha; «cliente nuevo»/«cliente que ya tenías» para creados), Movimiento (insignia; solo en «Todos»), Saldo y Mora (antes → después), Estado, Detalle (motivo de rechazo traducido o nota).
* **Acciones:** cambiar de pestaña, paginar, ver/descargar el documento original (`/api/imports/runs/:id/file[?download=1]`), ir a la ficha de un cliente.
* **Datos:** `GET /imports/portfolio/runs/:id`, `…/runs/:id/items?action&page&limit`, `GET /accounts/me`, `GET /auth/me`, `GET /imports/portfolio/config` (para resolver nombres del alcance).
* **Navegación:** desde el historial (fecha o un contador) y vuelve a `/import`.
* **Estados especiales:** «Esta importación es anterior a que se guardara el archivo» (sin archivo); «No hubo movimientos de este tipo»; error → `EmptyState`.
* **Estado:** ✅.

### 3.3 Ajustes de importación — `/import/ajustes`

* **Propósito:** configurar cómo se lee el archivo de la empresa y qué reglas se aplican, y vincular asesores a usuarios.
* **Quién accede:** ver: `client:import`. **Editar** (toda la configuración y los vínculos de asesor): `assignment:write` **o** ser **dueño** de la cuenta (`isOwner`) — `canConfigure` en `portfolio-import.service.ts`; los demás ven un aviso «Sólo quien reparte la cartera o el dueño de la cuenta puede cambiar esta configuración. Podés verla, pero no editarla» y los controles quedan deshabilitados (`fieldset disabled`); el servidor igual responde `IMPORT_CONFIG_FORBIDDEN`.
* **Qué muestra** (`import-setup.tsx`, `setup-steps.tsx`, `columns-step.tsx`, `field-row.tsx`, `report-step.tsx`, `config-status.tsx`, `advisor-links.tsx`):
  * Stepper (Archivo · Configuración · Revisar · Importar), indicador «Guardando… / Todos los cambios están guardados» (**todo se guarda solo** con cada cambio, `PATCH /imports/portfolio/config`).
  * **Origen de la cartera:** «De un archivo que sube la oficina» ↔ «Se carga a mano» (con «a mano» el import queda **apagado para toda la empresa**).
  * **Paso 1 — Tu archivo:** subir un archivo de **muestra** (solo se lee, no se importa: `POST …?columnsOnly=true`); elegir **forma del archivo**: «Una fila por crédito» (CSV/Excel), «Una tabla adentro de un PDF», «Un bloque por crédito» (PDF). Cambiar la forma con columnas ya emparejadas pide confirmación y **borra el emparejado**.
  * **Paso 2 — ¿A quién pertenece esta cartera?** (alcance): *Toda la empresa*, *Un oficial de crédito* (select de miembros) o *Una agencia o sucursal* (select de sucursales). Con «empresa» y un solo asignable, queda a nombre de esa persona.
  * **Paso 3 — Emparejar columnas** (3.4).
  * **Paso 4 — Reglas:** «Los créditos que el archivo no trae» (Ponerlos al día / Dejarlos como están / Decidir en cada importación); «El archivo dice de quién es cada crédito» (`carriesAssignee`); «Ofrecer importar al iniciar sesión» (`askOnLogin`, aplica a la app del cobrador, no al panel).
  * **Paso 5 — Datos del reporte:** *Qué es el saldo del archivo* (Capital pendiente / Total adeudado), *Días hasta marcar el dato como viejo* (entero 1–60, por defecto 2), *Estados del reporte* (tabla etiqueta del archivo → estado de crédito Kobrax; se escribe en mayúsculas y sin tildes; Kobrax ya conoce VIGENTE→Vigente, VENCIDO→En mora, CASTIGADO→Castigado, CANCELADO→Anulado; errores `EMPTY_LABEL`, `INVALID_STATUS`, `DUPLICATE_LABEL`).
  * **Probar sin importar:** corre el archivo de muestra completo en dry-run y muestra «N nuevos · M actualizados · K al día», filas ignoradas, avisos, tope de plan y las primeras 10 operaciones.
  * Tarjeta lateral de **estado de la configuración** (correctos / por revisar / sin columna, dato obligatorio faltante) y **Resumen** (archivo, alcance, forma, columnas «X de Y listos», días de atraso confirmados) con «Guardar y continuar» → `/import`.
  * **Volver a la configuración de fábrica** (modal de confirmación; borra emparejado, alcance y forma; lo ya importado no se toca).
  * **Asesores de los reportes:** lista de códigos vinculados (código → persona), «Estos códigos ya vinieron en un reporte y no tienen a nadie: …», formulario *Código del asesor* (mayúsculas, máx. 12; el servidor exige `[A-Z0-9]{2,12}`) + *Quién lleva esa cartera* (miembro activo) → «Vincular»; «Quitar».
* **Acciones / reglas** (validadas también en el servidor, `import-config.ts`): código y cliente **no se pueden apagar ni quitar** (campos «siempre se importa»); un campo no puede ser obligatorio y no importarse (`FIELD_RULE_CONFLICT`); obligatorio exige columna (`FIELD_NOT_MAPPED`); una columna no puede alimentar dos datos (`COLUMN_ALREADY_MAPPED`); alcance oficial/sucursal exige referencia (`IMPORT_NOT_CONFIGURED`); la confirmación de los días de atraso solo se acepta en un paso aparte de elegir la columna (`CALIBRATION_STALE`); cambiar la forma resetea el emparejado (`PROFILE_CHANGED`); sin `balanceBasis` válido (`INVALID_BALANCE_BASIS`), `staleAfterDays` fuera de 1–60 (`INVALID_STALE_AFTER_DAYS`), estado inexistente en `statusMap` (`INVALID_STATUS_MAP`).
* **Datos:** `GET /imports/portfolio/config` (config + catálogo de campos + último run + miembros + sucursales + `viewer`), `GET /imports/portfolio/advisors`; `PATCH /imports/portfolio/config`, `POST /imports/portfolio?columnsOnly=true|dryRun=true`, `PUT/DELETE /imports/portfolio/advisors/:code` (vía `/api/imports/...`).
* **Navegación:** desde «Ajustes» en `/import` o desde las puertas; «← Volver al import»; «Guardar y continuar» → `/import`.
* **Estados especiales:** con origen «a mano» solo se ve la tarjeta de origen y el reinicio; paso 3 bloqueado hasta subir muestra («Subí un archivo de muestra para ver qué columnas trae»); «Se leyó el archivo pero no trae ninguna columna reconocible».
* **Estado:** ✅. Sin interfaz para `profile.signature` ni para `headerRow` en la forma «una fila por crédito» (ver 5.3).

### 3.4 Emparejar columnas — `/import/ajustes/columnas`

* **Propósito:** (histórico) pantalla propia de emparejado. **Hoy es solo una redirección** a `/import/ajustes` (`P/import/ajustes/columnas/page.tsx`); el emparejado vive en el **Paso 3** de la pantalla de Ajustes (`columns-step.tsx`).
* **Quién accede:** igual que 3.3.
* **Qué muestra (Paso 3):**
  * Según la forma: *PDF de bloques* → «Dónde arranca cada crédito» (select con los textos candidatos y su cuenta = nº de créditos); *tabla en PDF* → «Cuál fila son los encabezados» (select de anclas con vista previa); *filas* → no hay selector (el encabezado está en la fila 1 por defecto).
  * **Días de atraso primero y aparte** («Primero confirmá los días de atraso»): elegir la columna (solo candidatas numéricas), ver una tabla *Cliente · Días de atraso* con **los valores reales del archivo de muestra**, y recién entonces **confirmar** («Sí, esos son los días de atraso»). Cambiar la columna vuelve a pedir confirmación.
  * **Datos necesarios** (los marcados con ⭐ del catálogo: N.º de crédito, Cliente, Cuota, Saldo; Días de retraso va arriba): por campo, un select *Sale de* con las columnas del archivo (las ya usadas aparecen deshabilitadas «ya alimenta X»), ejemplos de valores, estado (Listo / Confirmar / Falta / No se importa), *Cómo se trata* (Obligatorio / Opcional / No importar) y «Quitar de la lista».
  * **Nombre del cliente:** «¿Cómo viene el nombre?» — *Todo junto*, *Dos apellidos y después los nombres*, *Vienen en columnas separadas* — con vista previa «Quedaría: apellidos «X», nombres «Y»».
  * **Datos adicionales** y botón **«Agregar más datos»** con el resto del catálogo (ver 5.2).
* **Acciones:** cada cambio se guarda al instante. Al cambiar el ancla del PDF se **relee** la muestra.
* **Datos:** los de 3.3. **Navegación:** parte de `/import/ajustes`.
* **Estados especiales:** «El archivo de muestra no trae ninguna columna numérica que sirva»; «Esta columna no trae valores en las primeras filas».
* **Estado:** ✅ (la ruta `/columnas` es solo un alias).

---

## 4. Pagos

### 4.1 Pagos — `/pagos`

* **Propósito:** libro de pagos recibidos: cuánto, cómo y contra qué crédito, por período.
* **Quién accede:** `payment:read` (ACCOUNT_ADMIN, MANAGER, SUPERVISOR, COLLECTOR, AUDITOR, VIEWER). Un cobrador (scope `own`) ve **solo pagos de sus créditos**. Si la API falla, `EmptyState` con el mensaje. «Registrar un pago» solo con `payment:write` (siempre visible para quien lo tiene; sin `?creditId=` el modal pide elegir el crédito desde la ficha). «Pedir un cobro» solo con `payment:write` **y** lista filtrada por un crédito (`?creditId=`).
* **Qué muestra** (`P/pagos/page.tsx`, `payments-table.tsx`):
  * Título «Pagos — Lo que entró: cuánto, cómo y contra qué crédito», insignia «{n} pagos · {monto}» (**suma de la página mostrada**, no del período entero).
  * Columnas: *Fecha* (fecha y hora; enlace al detalle; ordenable, desc), *Monto* (ordenable), *Medio* (Efectivo, Transferencia, QR, Tarjeta, Pago móvil; ordenable), *Fuente* (Kobrax o insignia PSF), *Registró* (nombre o «—»), *Comprobante* (`#número` o «—»; ordenable).
  * **Filtros:** *Período* (rango de fechas; **por defecto, del día 1 del mes en curso a hoy**), *Fuente* (Kobrax/PSF). Si se llega con `?creditId=` aparece un enlace «Ver todos los pagos» (la lista está acotada a ese crédito y no hay chip visible del filtro).
  * Paginación 25 por defecto.
* **Acciones:** ordenar, filtrar por período/fuente, abrir un pago; con `payment:write`: **Registrar un pago** (4.3; sin `?creditId=` solo avisa que hay que elegir el crédito) y, con `?creditId=`, **Pedir un cobro** (4.4).
* **Datos que consume:** `GET /payments?from&to&page&limit&sort&dir&creditId&source` (el `to` se manda como fin de día UTC), `GET /users`, `GET /accounts/me`, `GET /auth/me`, y `GET /credits/:id` cuando hay `creditId` (código, importe sugerido, si es externo).
* **Navegación:** desde el menú, desde la ficha/crédito («Pagos del crédito» → `?creditId=`). Lleva a `/pagos/[id]`.
* **Estados especiales:** vacío «No hay pagos en este período / Probá con otro rango de fechas»; sin resultados «No hay pagos con esos filtros». **No hay forma de registrar un pago sin pasar por un crédito**: sin `creditId` el modal dice «Elegí primero el crédito desde la ficha del deudor.»
* **Estado:** ✅. 🟡 no hay buscador de texto ni filtro por cobrador/medio en la UI (el API admite `clientId`, que la web no usa).

### 4.2 Detalle de un pago — `/pagos/[id]`

* **Propósito:** ver un pago individual (los pagos son un libro inmutable).
* **Quién accede:** `payment:read` (`GET /payments/:id`); uuid inválido o inexistente → 404.
* **Qué muestra:** título = nombre del cliente, subtítulo fecha/hora. Tarjeta con: Monto, Medio, Registró (nombre o «—» si no hay `user:read`), N.º de comprobante, Proveedor, Id externo; enlaces **«Crédito»** (`/cartera/[cliente]/credito/[id]`) y **«Gestión de cobranza»** (`/mora/[creditId]`). Si hay comprobante: imagen (si la URL es relativa `/api/uploads/…`), enlace «Ver el comprobante» (si es `http(s)`) o texto plano (cualquier otro esquema, para evitar `javascript:`).
* **Acciones:** solo navegación; **no hay editar ni anular** («Los pagos no se editan ni se borran: el ledger es la fuente de la plata»; se corrige con otro asiento).
* **Datos:** `GET /payments/:id`, `GET /users`, `GET /accounts/me`, `GET /credits/:id`, `GET /clients/:id`.
* **Navegación:** desde `/pagos` y desde confirmar una solicitud; a crédito, mora.
* **Estados especiales:** error → `EmptyState`; cliente/crédito no cargado → título genérico «El pago».
* **Estado:** ✅.

### 4.3 Registrar un pago (modal) — `/pagos?creditId=…` y pantalla del crédito

* **Propósito:** asentar un pago recibido contra un crédito.
* **Quién accede:** `payment:write` (ACCOUNT_ADMIN, MANAGER, SUPERVISOR, COLLECTOR; AUDITOR y VIEWER no). API `POST /payments` con `payment:write`. Disponible en `/pagos?creditId=` y en el botón «Registrar un pago» de la pantalla del crédito.
* **Qué muestra:** modal «Registrar un pago»: Crédito (solo lectura, código), **Monto** (decimal; se **precarga con el importe sugerido** — «Sugerido: lo que corresponde cobrar hoy» — y se selecciona al enfocar), enlace «Más opciones». Aviso para créditos externos (PSF): «el pago queda registrado como cobro de Kobrax y no cambia el saldo ni la mora reportados. Se actualizan con el próximo reporte.» Texto de inmutabilidad («Un pago registrado no se puede editar ni anular»).
* **Acciones / campos:** *Monto* (obligatorio, > 0, hasta 2 decimales en el servidor); *Medio de pago* (Efectivo [def.], Transferencia, QR, Tarjeta, Pago móvil); *¿Quién recibió la plata?* («La cobró Kobrax» [def.] / «Pagó por un canal de la entidad»); *Nota* (≤ 500). **Registrar** → `POST /api/payments` con cabecera **`idempotency-key`** (uuid nuevo cada vez que se abre el modal): un reintento no duplica (`idempotentReplay`).
* **Reglas del servidor** (`payments.service.ts › applyCore`):
  * Monto > 0 (`PAYMENT_001`); crédito inexistente → 404.
  * Crédito **Kobrax**: debe estar `ACTIVE` (`CREDIT_NOT_ACTIVE`); el monto **no puede exceder el saldo pendiente** («El monto excede el saldo pendiente»); aplica el pago a las cuotas en orden, baja el saldo, y si llega a 0 el crédito pasa a **Pagado**.
  * Crédito **importado/externo**: se registra el pago pero **no cambia saldo ni mora** (los manda el reporte).
  * Numeración de comprobante correlativa por empresa (`receiptNumber`); duplicado → `PAYMENT_DUP`.
  * El API acepta `paymentDate` (no futura, ≤ 30 días atrás), `receiptUrl`, `receiptHash`, `provider`, `externalTransactionId`, `visitId`: **la web no los envía** (usa el momento actual).
  * Emite el evento `PAYMENT_REGISTERED` y registra auditoría.
* **Datos:** `POST /api/payments` → `POST /payments`.
* **Navegación:** al éxito cierra, toast «Pago registrado» y recarga la lista/crédito.
* **Estados especiales:** error traducido (`PAYMENT_001`, `AUTH_002` «No tenés permiso…», genérico); sin crédito → texto «Elegí primero el crédito».
* **Estado:** ✅.

### 4.4 Pedir un cobro — `/pagos/solicitudes/nueva?creditId=…`

* **Propósito:** generar una solicitud de cobro (QR + link) para enviar al deudor.
* **Quién accede:** `payment:write` (comprobado en el cliente: sin él, «No tenés permiso para esta acción»; API `POST /payment-requests` con `payment:write`). Sin `creditId` válido: «Elegí primero el crédito desde la ficha del deudor».
* **Qué muestra:** «Pedir un cobro — Se genera un QR y un link para mandarle al deudor. El cobro entra cuando él paga.» Formulario: Crédito (solo lectura), **Monto** (> 0), **Medio de pago** (por defecto QR; Efectivo, Transferencia, QR, Tarjeta, Pago móvil), botones Cancelar / **Generar**.
* **Acciones:** **Generar** → `POST /api/payment-requests {creditId, amount, method}`; al éxito `router.replace('/pagos/solicitudes/[id]')`.
* **Reglas del servidor:** crea la solicitud con referencia aleatoria, `qrPayload = KOBRAX|<ref>|<monto>`, **`url = https://pay.kobrax.demo/<ref>`** y **vence a las 24 h**. ⚠ La URL es un **marcador de demostración**: no hay pasarela de pago real conectada (**no verificado** que exista otro mecanismo).
* **Datos:** `GET /credits/:id` (código), `POST /payment-requests`.
* **Navegación:** desde `/pagos?creditId=` («Pedir un cobro»); a la solicitud creada.
* **Estados especiales:** error en banner traducido.
* **Estado:** 🟡 funcional pero con link/QR de demostración.

### 4.5 Detalle de una solicitud de cobro — `/pagos/solicitudes/[id]`

* **Propósito:** mostrar el QR/link y, cuando el dinero ya entró, confirmar el cobro.
* **Quién accede:** `payment:read` (`GET /payment-requests/:id`); uuid inválido o inexistente → 404. **Confirmar** requiere `payment:approve` (ACCOUNT_ADMIN y MANAGER por defecto; sin él se muestra «Tu rol no puede confirmar cobros»).
* **Qué muestra:** insignia de estado (Pendiente, Pagado, Vencido, Cancelado), Monto, Medio, Crédito (código); tarjeta con el **QR** (generado en el navegador con `qrcode` a partir de `qrPayload`) y el **link** con botón «Copiar»; y, si está Pendiente, la tarjeta «Confirmar que entró» («Sólo si ya viste la plata acreditada. Confirmar crea el pago y no se deshace»).
* **Acciones:** copiar link; **Confirmar que entró** → `POST /api/payment-requests/:id/confirm`: aplica el pago con las mismas reglas de 4.3 (proveedor `payment_request`), marca la solicitud `PAID` y vincula el pago; al éxito toast «Cobro confirmado» y redirige a `/pagos/[idPago]`. Solicitud no pendiente → `PAYREQ_STATE`.
* **Datos:** `GET /payment-requests/:id`, `GET /accounts/me`, `GET /credits/:id`; `POST /payment-requests/:id/confirm`.
* **Navegación:** desde 4.4; al confirmar a 4.2.
* **Estados especiales:** ya pagado/vencido/cancelado → sin tarjeta de confirmación. No se verificó un proceso que pase las solicitudes a «Vencido» al cumplirse las 24 h (**no verificado**).
* **Estado:** 🟡 (flujo manual de confirmación; sin pasarela real).

### 4.6 Listado de solicitudes — `/pagos/solicitudes`

* **Propósito:** (no existe como pantalla) **redirige a `/pagos`** (`P/pagos/solicitudes/page.tsx`). No hay listado de solicitudes: solo se ven por enlace directo desde el momento de creación.
* **Estado:** 📝 pendiente (sin pantalla; no hay endpoint de listado en el controller de pagos).

---

## 5. Importación — flujo extremo a extremo, formatos y reglas

### 5.1 Flujo extremo a extremo

1. **Configurar una vez** (3.3, solo `assignment:write` o dueño): origen = archivo → subir muestra → forma del archivo → alcance → emparejar columnas (confirmar la columna de días de atraso) → reglas → datos del reporte → «Probar sin importar». Para PDF con código de asesor: vincular el **asesor → usuario**.
2. **Subir el archivo del día** en `/import`. Al elegirlo, el navegador lo manda con `dryRun=true`.
3. **Servidor (dry-run)** (`portfolio-import.service.ts › run`): valida config (origen no manual, hay emparejado, alcance completo), valida que los bytes correspondan a la forma configurada, lee el archivo con el perfil, normaliza valores, lee del encabezado PDF la **fecha de corte** y el **asesor**, calcula propiedad/alcance, aplica «reporte viejo no pisa», clasifica filas (crear / actualizar / ausente / al día / inválida / ignorada), resuelve clientes para los nuevos, calcula cupo de plan y devuelve la **vista previa** sin escribir.
4. **Revisión** en pantalla: avisos, rechazos, asignación de responsables y cupo.
5. **Confirmar**: el navegador **vuelve a subir el mismo archivo** con `dryRun=false` y, en modo CHOOSE, las `assignments` (`create` por responsable y `reassign`). El servidor re-calcula todo en una transacción y: guarda el documento original (`uploads/imports`), crea clientes y créditos, actualiza existentes, marca ausentes / pone al día, asigna responsables, rellena huecos de contacto, escribe **snapshots** por crédito, el **run** y sus **items** (para el historial), y audita (`portfolio_import` + transiciones por crédito).
6. **Resultado y historial**: pantalla de resultado (3.1) y fila nueva en el historial; el detalle (3.2) conserva el movimiento por crédito y el archivo original.

### 5.2 Formatos de archivo y columnas reconocidas

**Formatos aceptados**

| Forma (`profile.kind`) | Archivo | Cómo lo lee | Notas verificadas |
|---|---|---|---|
| `rows` — «Una fila por crédito» | **CSV** (`.csv`, `.txt`; MIME `text/csv`, `text/plain`) o **Excel `.xlsx`** | La fila `profile.headerRow` (por defecto **1**) son los encabezados; cada fila siguiente es un crédito. En Excel solo la **primera hoja** (`exceljs`). CSV: separador **coma**, comillas dobles, UTF-8 (`apps/api/src/modules/clients/import/csv.ts`; punto y coma/tabulador **no se detectan**). | El tipo se decide por los **bytes** (zip `PK` = Excel, si no CSV), no por la extensión. La pantalla no tiene selector de fila de encabezados para esta forma. |
| `pdf-rows` — «Una tabla adentro de un PDF» | **PDF** con tabla | Ancla de encabezados elegida en Ajustes (`tableAnchor`); una fila por crédito. | `pdf.js`/coordenadas; estado de prueba con PDFs reales: **no verificado**. |
| `pdf-blocks` — «Un bloque por crédito» | **PDF** (extracto) | `recordStart` = texto que abre cada bloque; lee etiqueta→valor por coordenadas y el «cuadro de columnas» (valores `in: table` = **última fila** del cuadro). | Los campos del cuadro (p. ej. días de mora) se leen de la última fila. |

* Tamaño máximo **15 MB**; MIME aceptados por la API: `application/pdf`, `…spreadsheetml.sheet`, `application/vnd.ms-excel`, `text/csv`, `text/plain` (otro tipo → el archivo no llega y se responde `FILE_REQUIRED`).
* El navegador ofrece `.csv,.txt,.pdf,.xlsx,.xls`, pero **`.xls` (Excel antiguo) se rechaza** con `XLS_LEGACY_NOT_SUPPORTED` («guardalo como .xlsx o CSV»). Un PDF con forma CSV configurada (o al revés) → `FILE_SHAPE_MISMATCH`.
* **Fecha de corte y código de asesor** solo se leen en **PDF**: se buscan en las primeras 15 líneas con las etiquetas «fecha de corte / fecha de reporte / fecha corte / fecha reporte / corte al : dd/mm/aaaa» y «asesor/oficial : CÓDIGO». **En CSV/Excel no se leen** (siempre sale el aviso «El reporte no trae su fecha de corte»; el servidor acepta un `reportDate` explícito pero la web no lo envía).

**Catálogo de datos que se pueden emparejar** (`apps/api/src/modules/imports/field-catalog.ts`; es la **única** lista de campos que el import escribe; lo no emparejado se descarta)

| Campo | Etiqueta en pantalla | Tipo | En el catálogo | Qué hace |
|---|---|---|---|---|
| `code` | N.º de crédito | texto | ⭐ **bloqueado** | Llave de match (se quita el sufijo de marca de alta tipo `(N)`). Debe ser **una palabra con al menos un dígito** (`A-Z a-z 0-9 - / . _`, ≤ 40); lo demás (totales, notas de PDF) se **ignora** como fila. Sin código pero con nombre → `NO_CODE`. |
| `clientName` | Cliente (nombre completo) | texto | ⭐ **bloqueado** | Se separa según `nameOrder` (abajo). Sin nombre al crear → «SIN NOMBRE». |
| `clientLastName`, `clientFirstName` | Apellidos / Nombres | texto | — | Para «columnas separadas». |
| `installmentAmount` | Cuota | número | ⭐ | Se guarda en `metadata`; ausente → conserva el previo. |
| `daysPastDue` | Días de retraso | entero | ⭐ (requiere confirmación) | Mora declarada por la fuente. |
| `outstandingBalance` | Saldo | número | ⭐ | Saldo; ausente → no toca (al crear: 0). |
| `coHolder` | Co-titular | texto | — | `metadata`. |
| `phone` | Teléfono | texto | — | Una celda con varios (`2468145 - 68401916`, separados por `,` `;` `/` o « - ») se divide en contactos; **solo se escribe si el cliente no tiene ninguno**. |
| `address`, `addressRef` | Dirección / Referencia | texto | — | Crea domicilio **solo si el cliente no tiene direcciones**. |
| `businessAddress` | Negocio / dirección del negocio | texto | — | Crea ubicación de trabajo si no hay. |
| `status` | Estado | texto | — | Etiqueta → estado vía `statusMap`/predeterminados (VIGENTE, VENCIDO, CASTIGADO, CANCELADO). |
| `principalAmount` | Capital | número | — | Capital. |
| `interestRate` | Tasa de interés | número | — | |
| `currency` | Moneda | texto | — | BOLIVIANOS→BOB, DOLARES→USD; otro valor se guarda crudo. |
| `disbursedAt` | Fecha de desembolso | fecha | — | Formato **dd/mm/aaaa**; otro formato → vacío. |
| `pastDueAmount` | Monto en mora | número | — | `metadata`. |
| `nextDueDate` | Próximo vencimiento | fecha | — | dd/mm/aaaa. |
| `branchLabel` | Agencia | texto | — | En el catálogo; no se escribe (valida alcance, **no verificado** su uso efectivo). |
| `termMonths` | Plazo (meses) | entero | — | «48» o «48 M». |
| `lastPaymentDate` | Fecha del último pago | fecha | — | |
| `clientNationalId` | Carnet / documento del cliente | texto | — | Asocia al cliente existente por documento (blind index) y lo guarda cifrado en clientes nuevos. |
| `guarantorName`, `guarantorPhone` | Garante / Teléfono del garante | texto | — | Se guardan como «garante reportado» en `metadata` del crédito. |

* ⭐ = los que vienen en «Datos necesarios» al configurar por primera vez; el resto entra con «Agregar más datos». `branchLabel` y los campos no listados arriba no tienen tratamiento especial.
* **Formatos de valor** (`normalizeRecord`): números aceptan `859,743.98`, `1.682,11`, `(4,767.67)` = negativo y `%`; la regla es «el último separador es el decimal si le siguen 1–2 cifras». **Ausente ≠ cero**: un valor que no se pudo leer es `null` y **no se escribe**; una columna presente y en blanco cuenta como 0.
* **Nombre** (`nameOrder`): *Todo junto* → el texto completo va a **apellidos** (los listados vienen «APELLIDO APELLIDO NOMBRE»); *Dos apellidos y después los nombres* → las dos primeras palabras (sin contar partículas DE/DEL/LA/LAS/LOS/Y) son apellidos, el resto nombres; con menos de 3 palabras queda entero; *Columnas separadas* → se usan `clientLastName`/`clientFirstName`.

### 5.3 Reglas de negocio de la importación

* **Alcance** (`scope`): *empresa* (todo), *oficial* (créditos del responsable) o *sucursal*. Define qué créditos pueden marcarse como ausentes. Un crédito existente **fuera del alcance** con el mismo N.º se rechaza `MATCHES_OUT_OF_SCOPE`.
* **Quién importa qué** (`import-assignment.ts › resolveImportOwnership`): *sin `assignment:write`* → solo su cartera (alcance = él mismo, modo SELF); un reporte de un asesor vinculado a **otra** persona → `ADVISOR_BELONGS_TO_OTHER`; asesor sin vínculo → `ADVISOR_NOT_LINKED`. *Con `assignment:write`* → modo CHOOSE; asesor vinculado → alcance y sugerencia = ese usuario; asesor sin vínculo con alcance «empresa» → `ADVISOR_NOT_LINKED`.
* **Crear:** cada N.º nuevo crea un crédito de fuente **PSF** (`origin = IMPORT`, `syncStatus = PRESENT`, bloqueado para edición manual: «Los datos financieros de un crédito importado no se editan; actualizá con una nueva importación»). El cliente se resuelve así: (1) por **documento** si el archivo lo trae y coincide; (2) por **nombre ya confirmado** antes (vínculo guardado); si no, se crea cliente **nuevo**, marcado «Revisar vínculo» cuando hay homónimos existentes o varias operaciones sin documento con el mismo nombre en el mismo archivo (2.5).
* **Actualizar:** escribe solo lo que el archivo trae (saldo, mora, capital, tasa, estado, desembolso y `metadata`); lo ausente se conserva. **Estado:** con etiqueta mapeada se aplica; con etiqueta no mapeada, **si el crédito estaba en un estado distinto de Vigente vuelve a Vigente** (⚠ difiere de lo que dice FIELD-RULES, ver 8). Etiqueta «castigado» registra el castigo (`writtenOffAt`, motivo «Reportado como castigado en la importación»).
* **Ausentes:** marcados `ABSENT` con `absentSince` = fecha de corte; no se eliminan. Regla *Ponerlos al día*: `daysPastDue = 0` (solo créditos `ACTIVE`; saldo/estado intactos). Regla *Dejarlos como están*: nada. Regla *Decidir en cada importación* (`ask`): **el servidor la trata como «dejarlos como están»** y la web no ofrece una lista para decidir por crédito. Si un ausente **reaparece**, se actualiza el mismo crédito («Volvieron al reporte»).
* **Datos de contacto:** teléfono, dirección y dirección del negocio **solo rellenan huecos** (si el cliente ya tiene alguno no se agrega).
* **Obligatorios:** un campo marcado «Obligatorio» sin valor en una fila → esa fila va a *No se importan* con «Le falta un dato que marcaste obligatorio» (`MISSING_<CAMPO>`); no se importa a medias.
* **Avisos que no rechazan:** `MORA_SIN_CONFIRMAR`, `MORA_INCONSISTENTE` (vigente, monto en mora 0 y días > 0), `MORA_COLUMNA_SOSPECHOSA` (si > 20 % de las filas), `REPORT_DATE_UNKNOWN`.
* **Saldo vs. pagos de Kobrax:** en créditos PSF el pago registrado en Kobrax **no cambia** saldo ni mora; los manda el reporte (4.3).
* **Responsables:** modo SELF asigna los nuevos al importador; modo CHOOSE exige responsable para todo crédito nuevo (`UNASSIGNED_NEW_CREDITS`), valida que sea un cobrador asignable (`ASSIGNEE_NOT_ELIGIBLE`) y avisa si el responsable cambió mientras tanto (`ASSIGNMENT_CONFLICT`). Reasignar créditos existentes no mueve los casos abiertos.

### 5.4 Códigos de error mostrados (extracto)

`FILE_REQUIRED`, `FILE_SHAPE_MISMATCH`, `XLS_LEGACY_NOT_SUPPORTED`, `PARSE_FAILED`, `SIGNATURE_MISMATCH`, `NO_RECORDS_MAPPED`, `IMPORT_DISABLED`, `IMPORT_NOT_CONFIGURED`, `IMPORT_CONFIG_FORBIDDEN`, `REPORT_OUTDATED`, `INVALID_REPORT_DATE`, `ADVISOR_NOT_LINKED`, `ADVISOR_BELONGS_TO_OTHER`, `INVALID_ADVISOR_CODE`, `USER_NOT_MEMBER`, `USER_REQUIRED`, `UNASSIGNED_NEW_CREDITS`, `ASSIGNEE_NOT_ELIGIBLE`, `ASSIGNMENT_CONFLICT`, `ASSIGNMENT_FORBIDDEN`, `ALREADY_APPLIED`, `INVALID_ASSIGNMENTS`, `IMPORT_FILE_NOT_STORED`, `IMPORT_RUN_NOT_FOUND`, `PLAN_LIMIT_REACHED`. Textos en `apps/web/src/messages/es.json › panel.import.errors`. Motivos de rechazo por fila: `MISSING`, `NO_CODE`, `DUP_IN_FILE`, `MATCHES_MANUAL`, `MATCHES_OUT_OF_SCOPE`.

### 5.5 Los modos RECONCILE / UPSERT_ONLY / REPLACE

* Existen **solo** en el import de **clientes** (`POST /clients/imports`, `ClientImportController`): `RECONCILE` (actualiza/da de baja/crea), `UPSERT_ONLY` (sin bajas), `REPLACE` (destructivo; exige el permiso `client:import:replace`); requiere además `client:import` y `client:write`; admite `dryRun`. **No hay pantalla ni llamada desde apps/web** («el import de CLIENTES, anterior al de cartera, sin pantalla hoy» — comentario del propio controlador).
* La **importación de cartera** que sí tiene pantalla no expone elegir modo: internamente registra cada corrida como `mode: 'RECONCILE'` (`portfolio-import.service.ts`) y su comportamiento de «ausentes» se controla con la regla *Ponerlos al día / Dejarlos como están / Decidir en cada importación* (5.3). **El modo REPLACE no existe para cartera** y nunca borra.
* Dry-run: sí existe en la pantalla (la vista previa del paso 2 del flujo es un dry-run; «Probar sin importar» en Ajustes también).

---

## 6. Matriz de permisos (valores por defecto)

Origen: `packages/shared/src/constants/permissions.ts`. ✔ = tiene el permiso. La matriz efectiva en base de datos puede diferir (**no verificado**).

| Permiso | Qué habilita en estas pantallas | ADMIN | MANAGER | SUPERVISOR | COLLECTOR | AUDITOR | VIEWER |
|---|---|---|---|---|---|---|---|
| `client:read` | Cartera, ficha, bitácora, duplicados, revelar PII, PDF | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `client:write` | Nuevo cliente, editar secciones, adjuntos, dar de baja | ✔ | ✔ | — | ✔ | — | — |
| `client:pii:read` | Ver/descargar el archivo original de una importación (junto a `client:import`) | ✔ | ✔ | — | — | ✔ | — |
| `client:import` | Menú Importar, importar, historial, ajustes (lectura) | ✔ | ✔ | ✔ | ✔ | — | — |
| `client:import:replace` | Solo import de clientes (sin pantalla) | ✔ | — | — | — | — | — |
| `credit:read` | Créditos en ficha y pantalla de crédito | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| `credit:write` | Nuevo préstamo, editar crédito, mora manual, revisión de vínculo, castigo (con `data:scope:all`) | ✔ | ✔ | — | ✔ | — | — |
| `collection:read` | Enlace a gestión de cobranza (Mora) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `assignment:write` | Editar ajustes de importación, elegir/reasignar responsables, responsable de crédito | ✔ | ✔ | ✔ | — | — | — |
| `payment:read` | Menú Pagos, lista, detalle, solicitud | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `payment:write` | Registrar pago, pedir cobro | ✔ | ✔ | ✔ | ✔ | — | — |
| `payment:approve` | Confirmar que entró un cobro | ✔ | ✔ | — | — | — | — |
| `data:scope:all` | Sin él, scope `own` (solo cartera asignada) | ✔ | ✔ | — | — | ✔ | ✔ |

(El dueño de la cuenta, `isOwner`, puede además configurar la importación aunque no tenga `assignment:write`.)

---

## 7. Resumen de estado

| Pantalla | Estado | Nota |
|---|---|---|
| Cartera | ✅ | Filtro Sucursal apagado |
| Nuevo cliente + duplicados | ✅ | Teléfono obligatorio solo en la UI |
| Ficha del cliente | ✅ | Ayuda de adjuntos obsoleta; solo imágenes ≤ 8 MB |
| Edición por secciones | ✅ | No atómica |
| Revisión de vínculo | ✅ | Vive en la ficha, no en el crédito |
| Bitácora | ✅ | |
| Crédito | ✅ / 🟡 | «Castigado» ofrecido en el selector pero rechazado; castigo vive en Mora |
| Nuevo préstamo | ✅ | |
| Importar | ✅ / 🟡 | Regla `ask` sin interfaz de decisión |
| Detalle de importación | ✅ | |
| Ajustes de importación | ✅ | |
| Emparejar columnas | ✅ | Ruta redirige; vive en Ajustes (paso 3) |
| Pagos | ✅ | Total del encabezado = solo página actual |
| Detalle de pago | ✅ | |
| Registrar pago | ✅ | |
| Pedir un cobro / detalle | 🟡 | Link `pay.kobrax.demo`; sin pasarela |
| Listado de solicitudes | 📝 | Redirige a `/pagos` |
| Import de clientes (RECONCILE/UPSERT_ONLY/REPLACE) | 📝 | Solo API, sin pantalla |

---

## 8. Contradicciones entre documentación y código

1. **Modos RECONCILE / UPSERT_ONLY / REPLACE.** `docs/epics/F4/05-importacion-clientes.md` los presenta como la importación del producto; en el panel **no existen** (solo API de clientes sin pantalla). La importación de cartera registra siempre `RECONCILE` y no ofrece elegir.
2. **Regla de ausentes `ask`.** `docs/epics/F10/plans/import/FIELD-RULES.md` (§5.2 y tabla de cambios) dice que la vista previa lista los ausentes y el usuario elige **por crédito**; en el código el servidor convierte `ask` en `no-touch` (`portfolio-import.service.ts`: `config.absentRule === 'ask' ? 'no-touch'`) y la web no tiene esa selección. En el móvil (plan F10) sí está previsto: **no verificado**.
3. **Estado en actualización.** FIELD-RULES §2 dice «no toca (no degrada un DEFAULTED a ACTIVE)»; el código (`updatedStatus` en `portfolio-credit.ts`) devuelve a **Vigente** un crédito cuyo estado previo no era Vigente cuando la etiqueta del archivo no se mapea.
4. **Catálogo de campos.** FIELD-RULES §2 lista un campo `assignee` y no lista `termMonths`, `lastPaymentDate`, `clientNationalId`, `businessAddress`, `guarantorName`, `guarantorPhone`, `phone`, `address`, `addressRef`; el código (`field-catalog.ts`) es al revés: no tiene `assignee` y sí esos campos. FIELD-RULES también describe dos formas de archivo (`rows`, `pdf-blocks`); el código y la UI tienen **tres** (`pdf-rows` incluida). Y presenta Excel/CSV como pendiente: ya está implementado (`exceljs`).
5. **Teléfono obligatorio.** El texto del formulario dice que hace falta un teléfono; solo lo exige el cliente web (`canSubmitCliente`), el servidor no (`CreateClientDto`/`create`).
6. **Adjuntos.** El i18n `portfolio.attachmentsHint` dice «todavía no se pueden abrir desde el panel»; el código ofrece Ver y Descargar. Además la ayuda sugiere subir documentos; el servidor solo admite JPEG/PNG/WebP (8 MB).
7. **Acceso al PII.** Los comentarios de la pantalla hablan de «Mostrar» como acción con permiso; el controlador de la API exige solo `client:read` para revelar (el permiso `client:pii:read` se retiró del endpoint), y deja el rastro `client/PII_REVEAL`. El permiso `client:pii:read` sí se exige para el archivo original de importación.
8. **Selector de estado del crédito.** El editor ofrece `WRITTEN_OFF` (de `CREDIT_STATUSES`), pero `PATCH /credits/:id` lo rechaza.
9. **«Por cobrador del caso».** El filtro «Responsable» de la cartera es el responsable del **crédito** (F4/08: sin «casos»); el texto de ayuda de `form.assignedToHint` de i18n todavía menciona «el cobrador del caso».

---

## 9. Lo que no se pudo verificar

* Orden por defecto de `GET /clients?view=portfolio` cuando la web no manda `sort` (el comentario del componente dice «mora descendente», pero el adaptador no lo envía).
* Matriz de permisos efectiva en base de datos (se documentó la matriz por defecto del código) y comportamiento de `data:scope:branch`.
* Qué ve exactamente un cobrador bajo RLS `own` en cada tabla (clientes sin crédito asignado, etc.): se documentó el principio, no las políticas fila a fila.
* Paginación de la ficha cuando el cliente tiene más de 100 créditos.
* Proceso que pasa las solicitudes de cobro a «Vencido» a las 24 h, y existencia de una pasarela real detrás de `pay.kobrax.demo`.
* Comportamiento real con PDFs de bancos distintos al de muestra (`pdf-rows`/`pdf-blocks`) y con CSV con separador distinto de coma.
* Uso efectivo del campo `branchLabel` (validación de alcance por agencia) en la importación.
* Opciones de moneda del desplegable de garantías (`monedas`) y comportamiento del buscador por documento parcial en la cartera (comentario del código: no encuentra).
* Cómo se muestran en la UI los motivos `MATCHES_MANUAL`/`MATCHES_OUT_OF_SCOPE` en la vista previa cuando coinciden con un crédito bloqueado por origen distinto (solo se verificó el texto de i18n).
