# Panel web — Parte C: Mora, Agenda y Rutas

Documentación funcional pantalla por pantalla de `apps/web/src/app/(panel)/{mora,agenda,rutas}`.
Fuente de verdad: el código (web en `apps/web/src`, reglas en `apps/api/src/modules/*` y `packages/shared/src`).
`docs/epics/F4/*` se usó solo como apoyo; las contradicciones con el código están en la sección final.
Donde no se pudo comprobar algo se escribe «no verificado».

## Índice

1. [Cómo leer este documento y roles](#1-cómo-leer-este-documento-y-roles)
2. Mora
   - [/mora — Central de Mora (lista)](#mora--central-de-mora--mora)
   - [/mora/[creditId] — Ficha de gestión](#mora--ficha-de-gestión--moracreditid)
3. Agenda
   - [/agenda — Agenda (día / semana / mes)](#agenda--agenda--agenda)
   - [/agenda/[id] — Detalle de una gestión agendada](#agenda--detalle-de-la-gestión--agendaid)
4. Rutas
   - [/rutas — Rutas (Hoy, Historial día, Historial período)](#rutas--rutas--rutas)
   - [/rutas/planificar — Planificar rutas (4 pasos)](#rutas--planificar-rutas--rutasplanificar)
   - [/rutas/[id] — Detalle de ruta](#rutas--detalle-de-ruta--rutasid)
   - [/rutas/[id]/parada/[sid] — Detalle de parada](#rutas--detalle-de-parada--rutasidparadasid)
5. [Glosario y reglas de negocio](#glosario-y-reglas-de-negocio)
6. [Contradicciones docs ↔ código y observaciones](#contradicciones-docs--código-y-observaciones)
7. [No verificado](#no-verificado)

---

## 1. Cómo leer este documento y roles

**Convenciones.** «BFF» = route handler de Next (`apps/web/src/app/api/*`) que reenvía a la API NestJS con el Bearer de la sesión y exige mismo origen (`sameOrigin`, 403 `CSRF` si no). «API» = NestJS (`apps/api`). Los endpoints se citan como los llama la pantalla (servidor→API o navegador→BFF).

**Qué permisos manda cada rol** (`packages/shared/src/constants/permissions.ts`):

| Permiso | Cobrador | Supervisor | Gerente | Admin cuenta | Auditor | Visor |
|---|---|---|---|---|---|---|
| `collection:read` (ve Mora) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `collection:write` (gestión, prioridad, notas) | ✔ | ✔ | ✔ | ✔ | — | — |
| `collection:export` (CSV/PDF) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `assignment:write` (repartir, apoyo, temporal) | — | ✔ | ✔ | ✔ | — | — |
| `credit:write` (poner al día) | ✔ | — | ✔ | ✔ | — | — |
| `data:scope:all` | — | — | ✔ | ✔ | ✔ | ✔ |
| `data:scope:branch` | — | ✔ | — | ✔ (tiene todos) | — | — |
| `agenda:read` / `agenda:write` | ✔ / ✔ | ✔ / ✔ | ✔ / ✔ | ✔ / ✔ | — | — |
| `agenda:assign` | — | ✔ | ✔ | ✔ | — | — |
| `route:read` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `route:execute` | ✔ | — | — | ✔ | — | — |
| `route:assign` / `route:write` | — | ✔ / ✔ | ✔ / ✔ | ✔ / ✔ | — | — |
| `payment:write` | ✔ | ✔ | ✔ | ✔ | — | — |
| `user:read` (`GET /users`) | — | — | ✔ | ✔ | — | — |

Consecuencias que se repiten en las pantallas:

- **Alcance de datos** (`moraScopeOf`, `mora-query.ts`): `data:scope:all` → todo el tenant; `data:scope:branch` → lo propio + créditos **con responsable** de su agencia; sin ninguno (cobrador) → solo lo que tiene a su cargo (responsable, reemplazo temporal o apoyo vigentes). Un crédito sin responsable solo lo ve el alcance total. Fuera de alcance se responde 404 (no 403).
- **«Administrador de la empresa» para rutas** = quien tiene a la vez `route:assign` y `route:execute` (solo `ACCOUNT_ADMIN`, `route-access.ts`).
- Sin `user:read` (supervisor, cobrador) `GET /users` da 403: la web resuelve nombres con `/assignments/assignees` o `/agenda/assignees`; cuando no puede, muestra «Responsable desconocido/Cobrador desconocido», nunca «sin responsable».
- Menú: `/mora` aparece con `collection:read`, `/agenda` con `agenda:read`, `/rutas` con `route:read` (`apps/web/src/lib/nav.ts`). Un auditor/visor **no ve Agenda**.
- El middleware protege `/mora/*`, `/agenda/*`, `/rutas/*` y sus BFF (`apps/web/src/middleware.ts`): sin sesión redirige a login.

---

## Mora

### Central de Mora — `/mora`
Archivos: `apps/web/src/app/(panel)/mora/{page,arrears-table,bulk-actions,export-buttons,priority-cell}.tsx`, `apps/web/src/lib/mora.ts`; API `apps/api/src/modules/mora/{mora.controller,mora.service,mora-query,mora.serializer,mora-export*}.ts`.

- **Propósito:** listar **una fila por crédito en mora** (ya no hay «caso»), con filtros, prioridad editable, acciones masivas y exportación.
- **Quién accede:** `collection:read` (menú y `GET /mora`). El alcance de filas depende de `data:scope:*` (ver §1). Quien no tiene `assignment:write` ve el aviso «Estás viendo sólo lo que tenés asignado» (aunque tenga alcance total, p. ej. un auditor: el aviso lo decide `assignment:write`, no el alcance real). Sin permiso, la API responde 403 y la página muestra un `EmptyState` con el mensaje del error.
- **Qué muestra:**
  - Subtítulo de la pantalla (sin título grande, ya está en el menú).
  - Tabla `DataTable` (`tableId="mora"`, preferencias de columnas por usuario). Tamaños de página 25/50/100 (por defecto 25). Orden, filtro y página los resuelve el servidor.
  - Columnas visibles por defecto: **Nº de crédito** (enlace a `/mora/{creditId}`), **Cliente**, **Situación** (badge «Al día/En mora» + categoría con su color + «Castigado»), **Saldo** (ordenable), **Vencido** (monto realmente vencido; tooltip dice si viene del cronograma o del archivo reportado), **Días de mora** (ordenable), **Prioridad** (ordenable; celda editable), **Responsable**, **Última gestión** (fecha + tipo + resultado; solo informativa, no ordena).
  - Columnas apagadas (se prenden en «Columnas»): Oficina, Estado en origen (el que mapeó el archivo), Monto original, Cuota, Próximo vencimiento, Último pago, Mora desde, Origen de la mora (Calculada/Del archivo/A mano, o insignia de fuente externa con su corte y aviso de dato viejo/ausente), Promesa vigente.
  - **Ausente ≠ cero:** si el dato no existe (importado sin cuota, crédito propio sin cronograma) se muestra «—», nunca 0.
  - Filtros (panel lateral; las claves son las de la URL): Responsable y «Créditos sin responsable» (solo quien tiene `assignment:write`), Oficina (solo si hay más de una y se puede repartir), Categoría de mora (opciones = rangos configurados en la cuenta), Castigo (todos / solo castigados / sin castigados), Rango de días de mora, Rango de saldo, Fuente (Kobrax o fuente externa), Prioridad (Crítica/Alta/Media/Baja), «Sólo con promesa vigente», «Incluir los que están al día».
  - Búsqueda: nº de crédito, nombre/apellido/razón social (palabra por palabra) o zona; máximo 80 caracteres. El documento no se busca acá.
  - Botones **Exportar CSV / Exportar PDF** (solo con `collection:export`).
  - Selección de filas (única tabla del panel con checkboxes) que habilita las acciones masivas.
- **Acciones:**
  1. **Abrir la ficha:** clic en el nº de crédito.
  2. **Cambiar prioridad desde la celda** (solo con `collection:write`; sin él la pastilla es solo lectura). Abre un modal con 4 opciones (Crítica «Ir hoy», Alta «Esta semana», Media «Ritmo normal», Baja «Puede esperar»); elegir aplica y cierra. Si ya estaba fijada (📌) aparece «Volver a la automática». Llama `PATCH /api/mora/{creditId}/priority` con `{ priority: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'|null }` (`null` = soltar). Un crédito al día no tiene prioridad (celda «—»; la API devuelve 409 `MORA_007` si se intenta).
  3. **Acciones masivas** (aparecen al seleccionar filas; máximo **100 créditos por vez**, validado en el BFF):
     - **Asignar a un cobrador** (visible con `assignment:write`): modal con selector de cobrador (obligatorio). `POST /api/mora/bulk {action:'assign', userId, creditIds}` → `POST /assignments/bulk`. Cada crédito es atómico; los que no pasan vuelven con motivo `NOT_FOUND` / `ALREADY_ASSIGNED` / `OUT_OF_AGENCY` / `CONFLICT`. Lo agendado pendiente del responsable anterior pasa al nuevo (texto del modal). Un supervisor solo reparte créditos de su agencia y a gente de su agencia; solo se puede asignar a cobradores/supervisores activos, o a uno mismo (`assignment-rules.ts`).
     - **Cambiar prioridad** (visible con `collection:write`): elige prioridad o «volver a la automática»; el BFF hace un `PATCH /mora/{id}/priority` por crédito. Queda **fijada**: el cálculo diario no la toca hasta soltarla.
     - **Poner al día** (el botón se dibuja siempre que hay selección): modo obligatorio — «Corren al siguiente período» (por defecto), «Con la fecha que elija» (fecha obligatoria, `min` = hoy, debe ser futura) o «Sin fecha de vencimiento». Advierte «No se deshace en bloque». `POST /credits/{id}/arrears/clear` por crédito; exige `credit:write` (supervisor → falla con 403), el crédito activo y **no importado/externo** (`creditLocked`). Pone `days_past_due = 0`, mueve/borra la fecha de vencimiento y borra la marca manual; el episodio lo cierra el trigger con motivo `CURRENT`.
     - Resultado: «Listo: N préstamos» o «Entraron X y fallaron Y. <motivo del primero>»; la selección se limpia solo si todo entró.
  4. **Exportar:** `GET /api/mora/export?format=csv|pdf&<filtros de la URL>` → `GET /mora/export.csv|.pdf` (exige `collection:export` **y** `collection:read`). Baja **todo** el resultado con los mismos filtros, búsqueda, orden y alcance (sin página). Tope: **50.000 filas en CSV, 5.000 en PDF**; si se excede la API rechaza antes de empezar con un mensaje que dice qué hacer (agregar filtros, o bajar CSV). Columnas del CSV: Nº de crédito, Deudor, Moneda, Saldo, Monto original, Cuota, Próxima fecha, Monto vencido, Origen del monto vencido, Último pago, Días de mora, Inicio de la mora, Origen de la mora, Fuente, Corte del reporte, Reporte desactualizado, Estado en origen, Situación, Categoría, Castigado, Prioridad, Responsable, Oficina, Última gestión, Tipo y Resultado de última gestión, Promesa vigente (`mora-export.ts`).
- **Datos que consume:**
  - `GET /mora?page&limit&…filtros` — lista (servidor, `limit` ≤ 100).
  - `GET /auth/me` — permisos; `GET /users` — nombres (puede dar 403); `GET /accounts/me` — moneda (por defecto BOB); `GET /mora/branches` — oficinas para el filtro; `GET /assignments/assignees` (solo con `assignment:write`); `GET /arrear-categories` — rangos para el filtro.
  - Escrituras vía BFF: `PATCH /api/mora/{id}/priority`, `POST /api/mora/bulk`, `GET /api/mora/export`.
- **Navegación:** llega desde el menú «Mora», el dashboard y enlaces de agenda («Ver en Mora»). Lleva a `/mora/{creditId}`.
- **Estados especiales:**
  - Vacío sin filtros: «Nadie te debe» (buena noticia). Vacío con filtros: «No hay préstamos con esos filtros — Probá quitando alguno» (el piso de mora de apertura **no** cuenta como filtro).
  - Error de la lista: `EmptyState` con el mensaje de la API.
  - Valores de URL inventados (orden o fuente desconocidos, flags distintos de `true/false`) no viajan a la API.
  - Los créditos de fuente externa «ausentes del último reporte» (`sync_status = ABSENT`) **no se listan** salvo con «Incluir los que están al día».
  - Cuidado: el filtro «promesa vigente» y la columna «Promesa vigente» se calculan **por cliente** (cualquier promesa agendada hoy o después de ese cliente), mientras que la ficha lo calcula por crédito (ver Observaciones).
- **Estado:** ✅ implementado y con pruebas (`*.test.tsx`).

> **Qué entra en la lista (regla servidor, `buildMoraWhere`):** crédito del tenant no borrado, en alcance, y vivo: `status = ACTIVE`, o `DEFAULTED` solo si es de fuente externa; por defecto `days_past_due >= 1`. `dpdMin` explícito manda sobre el piso; «Sólo castigados» incluye los castigados aunque no tengan mora. Orden por defecto: días de mora desc; los nulos (al día) van al final y siempre se desempata por días de mora desc e `id`.

---

### Ficha de gestión — `/mora/[creditId]`
Archivos: `mora/[creditId]/*.tsx` (`ficha-gestion`, `ficha-summary`, `activity-form`, `promises-section`, `payments-section`, `notes-section`, `note-dialog`, `notes-board`, `sticky-note`, `use-notes`, `arrears-history`, `recovery-metrics`, `responsibles-section`, `write-off-button`, `psf-notice`, `person-sections`). La misma ficha (`FichaGestion`, sin cabecera ni «La persona») se reutiliza en la pestaña «Ficha» de `/rutas/[id]/parada/[sid]`.

- **Propósito:** ver y trabajar un crédito en mora (o al día) en un solo lugar: situación, bitácora, promesas, pagos, notas, historial de episodios, métricas y responsables.
- **Quién accede:** `collection:read` y que el crédito esté **en su alcance** (si no, 404 → `notFound()`). La ficha, a diferencia de la lista, **no exige estar en mora**: un crédito recién saldado se puede abrir. Qué botones aparecen:
  - «Registrar gestión», crear/mover/editar notas: `collection:write`.
  - «Registrar pago» / «Solicitar pago»: `payment:write` (el componente `PaymentActions` se oculta solo sin el permiso).
  - Prioridad editable: `collection:write`.
  - Responsables (apoyo/temporal/quitar): `assignment:write`.
  - Castigar/Revertir castigo: `credit:write` **y** `data:scope:all` (gerente/administrador).
  - Sección «La persona»: requiere poder leer `/clients/{id}` (`client:read`); si falla se muestra «sin permiso».
- **Qué muestra (orden de arriba hacia abajo):**
  1. **Cabecera:** «Gestión de cobranza», subtítulo «Cliente · Crédito {código}» y acciones.
  2. **Resumen** (`FichaSummary`): chips (situación, categoría, castigado, prioridad con 📌 si está fijada, fuente externa con corte, estado en origen); tarjeta «Saldo adeudado» con barra de % pagado (= (monto original − saldo)/monto original, acotado 0–100; solo si hay ambos), monto original y vencido; celdas: Mora actual (días), Cuota, Próximo vencimiento, Último pago, Mora desde, Última gestión, Promesa vigente (la ACTIVE de fecha más próxima: monto · fecha), Responsable, Oficina. Enlaces «Abrir ficha del cliente» (`/cartera/{clientId}`) y «Abrir el crédito» (`/cartera/{clientId}/credito/{creditId}`).
  3. **Aviso PSF** (`PsfNotice`, solo crédito de fuente externa): si `ABSENT` → «ausente del reporte desde dd/mm» (ausente no es pagado); si el reporte está viejo → «reporte desactualizado» con su corte. No bloquea el trabajo.
  4. **Responsables:** el principal y, vigentes, los reemplazos temporales y las ayudas (con vencimiento).
  5. **Métricas de recuperación** (ver Glosario): recuperado + nº de pagos + saldo con que entró; gestiones (total y desglose llamadas/visitas/mensajes); contactos; días hasta la primera visita y el primer pago; segundo renglón: primer contacto, promesas cumplidas/cerradas con % de cumplimiento y promesas activas, duración de la última mora recuperada, recuperado en toda la vida del crédito.
  6. **Acordeones:** Bitácora/Gestiones (abierta de entrada, hasta las **100** más recientes), Promesas, Notas (con tablero de post-its), Pagos (últimos 50), Historial de mora (episodios), La persona (garantes, garantías, adjuntos; solo lectura — se corrige desde Cartera).
- **Acciones:**
  - **Registrar gestión** (`RegisterActivityButton`, `POST /api/mora/{creditId}/activities` → `POST /mora/{id}/activities`):
    - *Tipo* (obligatorio): Llamada, Visita, Mensaje, Nota.
    - *Resultado* (obligatorio salvo Nota; no permitido en Nota): Llamada/Mensaje → Contactado, No respondió, Número equivocado, Se negó, Promesa de pago; Visita → Contactado, No lo encontré, Dirección incorrecta, Se negó, Promesa de pago.
    - *Promesa* (solo si resultado = Promesa de pago, y entonces obligatoria): monto > 0 (se precarga con el monto sugerido del crédito), fecha ≥ hoy, medio de pago (catálogo `PAYMENT_METHOD`; si no hay catálogo, CASH/TRANSFER/QR/CARD/MOBILE_PAYMENT), banco opcional (catálogo `BANK`). La API da un día de margen para la hora de Bolivia.
    - *Observación*: texto ≤ 1.000 caracteres; **obligatoria si el tipo es Nota**.
    - Validación idéntica en cliente y servidor (`validateRecoveryActivity`); errores `MORA_*` traducidos. Registra la actividad ligada al **episodio abierto** (o a ninguno si está al día) y actualiza «última gestión». La promesa se crea como agendado `PROMISE_TO_PAY` (con recordatorio automático el día anterior si es posible). Funciona con crédito al día o en mora, pero **no** cambia la situación del crédito ni abre «caso».
  - **Registrar pago / Solicitar pago:** `PaymentModal` (`/api/payments`, monto > 0, medio, canal, notas, clave de idempotencia). Detalle en la parte de Pagos (fuera de este alcance).
  - **Castigar / Revertir castigo** (`WriteOffButton`): motivo opcional (≤ 500) al castigar; `POST /api/credits/{id}/write-off` o `DELETE`. El castigo es una **condición** (`written_off_at`), no un estado: no cierra la mora, no cambia `status`, el trabajo diario sigue contando días. Idempotente.
  - **Prioridad** (celda del resumen, igual que en la lista).
  - **Responsables** (`assignment:write`): *Agregar apoyo* (usuario obligatorio, vencimiento opcional; `POST /assignments/support`; sin traspaso de agenda); *Cambiar responsable temporal* (usuario y vencimiento obligatorios, motivo opcional; `POST /assignments/temporary`; lo agendado pendiente pasa al reemplazo y vuelve al vencer o revocar; el responsable conserva el crédito); *Quitar* un temporal/apoyo (`DELETE /assignments/{id}`; el principal no se quita, se reasigna). Reglas: vencimiento futuro; el reemplazo/apoyo no puede ser el mismo principal; no duplicar un temporal/apoyo vigente; supervisor solo dentro de su agencia (403).
  - **Notas tipo post-it** (`collection:write`): *Nueva nota* (modal: tipo Información/Aviso/Importante, texto 1–1.000 obligatorio, color de 6: amarillo, rosa, azul, verde, morado, naranja). «Mostrar tablero» dibuja los post-its **anclados dentro de la sección** donde viven (`PAGE`, `TIMELINE`, `PROMISES`, `NOTES`, `PAYMENTS`, `HISTORY`, `PERSON`): se arrastran (pueden cambiar de sección), se redimensionan (160–520 × 120–440 px), se pintan, suben al frente y se editan en línea; cada gesto se guarda con `PATCH /api/mora/{id}/notes/{noteId}` y se revierte si falla. Se crean con id generado en el cliente (idempotente) en cascada según cuántas hay (`POST /api/mora/{id}/notes`). **Editar texto/tipo y borrar** (borrado lógico) solo lo hace **quien la escribió o quien tiene `assignment:write`** (403 `MORA_005`); mover/pintar/redimensionar, cualquiera con `collection:write` que vea el crédito. Hasta 200 notas por crédito en la lectura. Se audita el cambio sin guardar el texto (puede traer datos personales).
- **Datos que consume:** `GET /mora/{id}` (detalle + últimas 100 actividades + asignaciones), `/mora/{id}/episodes`, `/mora/{id}/metrics`, `/mora/{id}/promises`, `/mora/{id}/notes`, `GET /payments?creditId=&limit=50`, `/catalogs/PAYMENT_METHOD`, `/catalogs/BANK`, `/catalogs/COLLATERAL_TYPE` (con persona), `/clients/{clientId}`, `/auth/me`, `/users`, `/accounts/me`, `/assignments/assignees` (con `assignment:write`). Escrituras: `POST /api/mora/{id}/activities`, `…/notes`, `PATCH/DELETE …/notes/{noteId}`, `PATCH …/priority`, `/api/assignments/{temporary,support}`, `DELETE /api/assignments/{id}`, `/api/credits/{id}/write-off`, `/api/payments`.
- **Navegación:** llega desde `/mora`, desde `/agenda/{id}` («Ver en Mora»), desde el dashboard y, embebida, desde la parada de una ruta. Lleva a `/cartera/{clientId}`, `/cartera/{clientId}/credito/{creditId}`, `/pagos?creditId=…`, `/pagos/solicitudes/nueva?creditId=…`.
- **Estados especiales:**
  - Crédito inexistente o fuera de alcance → 404. Otro error → `EmptyState` con el mensaje.
  - Si falla la lectura de episodios/promesas/notas/pagos la ficha sigue entera y esa sección dice «no disponible».
  - Sin episodio abierto: métricas en ventana «histórico» (no calcula «días hasta…»); la prioridad no existe.
  - Importado: «Mora desde» no se estima restando días al corte; el inicio del episodio queda marcado «estimado».
  - Historial de mora (episodios): del más reciente al más antiguo, numerados cronológicamente («Mora #1» es la primera). Cada uno muestra fechas (marca «estimada» si el inicio es corte−días), duración, pico de días, saldo al entrar y al salir, días con que entró, fuente (Calculada/Del archivo/A mano), insignia «Reconstruido» (de casos anteriores a la tabla), «Actual» o motivo de cierre.
  - Un crédito al día pero castigado sigue mostrando «Castigado».
- **Estado:** ✅ ficha completa. «La persona» es solo lectura por diseño.

---

## Agenda

### Agenda — `/agenda`
Archivos: `agenda/{page,agenda-connector,agenda-screen,day-panel,week-panel,month-calendar,mini-calendar,overdue-panel,agenda-row,side-cards,new-task-modal,location-picker}.tsx`, `apps/web/src/lib/agenda.ts`; API `apps/api/src/modules/agenda/*`.

- **Propósito:** ver y crear las gestiones agendadas (llamada, visita, WhatsApp, recordatorio, promesa de pago) en vista de día, semana o mes, con las vencidas a la vista.
- **Quién accede:** `agenda:read` (cobrador, supervisor, gerente, administrador; **no** auditor ni visor). «Nueva tarea» requiere `agenda:write`. El **selector de responsable** y la carga del equipo solo con `agenda:assign` (supervisor, gerente, administrador) y solo si `GET /agenda/assignees` devuelve gente. Alcance de lo que se lista (`assigneeScope`): **sin `agenda:assign` (cobrador): solo las gestiones donde él es el responsable**; con `agenda:assign`: las de los créditos de su alcance (supervisor = su agencia; gerente/administrador = todo el tenant).
- **Qué muestra:**
  - Cabecera: título, subtítulo (distinto si supervisa: «equipo»), segmentado **Día / Semana / Mes** (URL `?view=` vacío=día, `week`, `calendar`=mes), selector «Equipo» (solo supervisores; «Mi agenda» o «Todos»/una persona) o la etiqueta «Solo yo», y botón **Nueva tarea**.
  - Aviso «Estás viendo sólo tus gestiones» a quien no supervisa.
  - Columna izquierda: **mini-calendario** (marca los días con gestiones del mes), **Filtros** (búsqueda por cliente / código de crédito / id; responsable si supervisa; tipo; estado) y **Resumen** del conjunto visible (total, pendientes, hechas, reagendadas+canceladas).
  - Panel **Vencidas** (si hay): gestiones `SCHEDULED` con fecha anterior al día de la empresa; vista previa de 2 y «Ver las N»; carga hasta 50 (más recientes primero) y avisa «Se muestran las primeras X de Y. Filtra por cobrador para ver el resto».
  - **Día:** gestiones del día agrupadas por franja horaria (Mañana 08–12, Tarde 12–18, Noche 18–24; las de hora fija caen en su franja) y ordenables por hora, por tipo o por responsable; botones día anterior/siguiente/Hoy.
  - **Semana:** lunes a domingo, una tarjeta por día con sus filas (hora fija primero, luego franja por orden de carga); clic en el día abre la vista Día.
  - **Mes:** grilla desde el lunes de la primera semana hasta el domingo de la última; cada celda muestra hasta 3 chips por tipo y «+N»; marca roja con las vencidas del día; fondo de aviso si el día tiene **más de 20** gestiones.
  - Cada fila (`AgendaRow`): hora/franja, tipo, estado, cliente · crédito, situación del crédito (al día/en mora + días + categoría), saldo, asignado a, menú «⋮» (Abrir, Completar, Reagendar, Cancelar, y Editar/Eliminar solo si `canEdit`).
- **Acciones:**
  - **Navegar** (día/semana/mes, mini-calendario, «Hoy»): cambia `?date=` y `?view=`.
  - **Filtrar** (responsable/tipo/estado en la URL `gestor`, `tipo`, `estado`; búsqueda en estado local). El filtro se aplica **en el navegador** sobre lo que ya se trajo (no en la API).
  - **Nueva tarea** (`NewTaskModal`; `POST /api/agenda`): 
    1. Buscar cliente (≥ 3 caracteres; `GET /api/clients?q=&limit=8`; muestra el documento enmascarado para distinguir homónimos) → carga contexto `GET /api/agenda/context/{clientId}` (créditos agendables, teléfonos, direcciones; revela PII y exige `agenda:write`).
    2. *Crédito* (obligatorio; por defecto el primero; sin créditos visibles no se puede agendar). El agendado es **por crédito**, esté al día o en mora.
    3. *Asignar a* (solo con `agenda:assign`): vacío = responsable del crédito (o quien agenda si no tiene). Debe ser cobrador/supervisor activo de su alcance; si no, `AGENDA_010`/`AGENDA_011`.
    4. *Tipo* (obligatorio): Llamada (contacto), WhatsApp (contacto + mensaje ≤ 1.000, con plantillas del catálogo `WHATSAPP_TEMPLATE`), Visita (dirección **con punto en el mapa** — se puede agregar o corregir en el `LocationPicker`; sin punto no se permite guardar), Recordatorio (descripción ≤ 500), Promesa de pago (monto > 0 y **no mayor al saldo** salvo crédito de fuente externa, fecha ≥ hoy, medio de pago del catálogo y banco si el medio lo exige; muestra monto original/vencido/saldo como referencia).
    5. *Fecha* (≥ hoy de la empresa, `AGENDA_003` si es pasada) y *momento*: franja (Mañana/Tarde/Noche) u hora fija HH:mm (obligatoria con hora fija; `AGENDA_004`).
    6. *Observaciones* opcional.
    - Efectos: una visita se engancha sola a la ruta planificada del responsable ese día (si existe). Una promesa crea además un recordatorio la víspera (si la víspera es posterior a hoy). Notifica al asignado.
    - Idempotente por `id` (cola offline del móvil).
  - **Abrir / Completar / Reagendar / Cancelar / Editar / Eliminar:** desde el menú de la fila redirigen a `/agenda/{id}?accion=…` donde se abre el diálogo correspondiente.
- **Datos que consume:** `GET /agenda?date=` (día), `GET /agenda?from=&to=` (grilla del mes), `GET /agenda/overdue?limit=50`, `GET /agenda/summary` (para saber «hoy» de la empresa; en Bolivia desde las 20:00 el UTC ya es mañana), `GET /agenda/assignees`, `GET /auth/me`. Escrituras: `POST /api/agenda`, `/api/agenda/assignees`, `/api/agenda/context/{clientId}` y `…/locations` (alta/edición de dirección), `/api/catalogs/{PAYMENT_METHOD,WHATSAPP_TEMPLATE}`.
- **Navegación:** llega del menú «Agenda», la campanita (resumen de vencidas), el inicio y la ruta. Lleva a `/agenda/{id}` y `/agenda?date=`.
- **Estados especiales:**
  - Día vacío sin filtros: «No hay nada agendado para este día» con CTA «Nueva tarea». Con filtros: «No hay gestiones con esos filtros».
  - Error de lista: `EmptyState` con el mensaje.
  - `GET /agenda/assignees` da 403 sin `agenda:assign`: el selector no se dibuja (comportamiento esperado).
  - «Vencida» y «pendiente» son derivadas (`SCHEDULED` con fecha < hoy de la empresa), nunca un estado guardado: una gestión de hoy a las 08:00 no es vencida a las 20:00.
- **Estado:** ✅ implementado (vistas día/semana/mes, alta, filtros, vencidas). Nota: el texto de vacío «Las gestiones se agendan desde la app del cobrador» es anterior a «Nueva tarea» en web (ver Observaciones).

---

### Detalle de la gestión — `/agenda/[id]`
Archivos: `agenda/[id]/{page,item-actions,contact-actions}.tsx`; API `agenda.service.ts` (`findOne`, `complete`, `cancel`, `reschedule`, `update`, `remove`).

- **Propósito:** ver una gestión agendada con su contexto (cliente, crédito, resultado, historial) y ejecutarla, reagendarla, cancelarla, editarla o eliminarla.
- **Quién accede:** `agenda:read` y que la gestión esté en su alcance (si no, 404). Acciones de estado (completar/reagendar/cancelar) requieren `agenda:write` **y** estado `SCHEDULED`. **Editar y eliminar solo las puede hacer quien creó la gestión** (sin excepción para el administrador; si no tiene creador, su responsable) y solo pendiente (`AGENDA_012`).
- **Qué muestra:**
  - Encabezado: tipo · fecha · momento (hora fija o franja) · estado · insignia «Vencida».
  - Tarjeta azul del crédito: código, saldo actual, días de mora (rojo/verde), documento del cliente **en claro** (revelado auditado: `client/PII_REVEAL` y `agenda_item/PII_REVEAL`) y enlace «Ver en Mora».
  - Datos de la gestión: tipo, fecha, momento, asignado a, «asignada por», teléfono/dirección con que se ejecuta, y para promesas monto, fecha y medio.
  - Si se ejecutó: «Qué pasó» (resultado + quién y cuándo + nota). Recordatorio/mensaje/observaciones. Motivo de cancelación/reagendado, y enlaces «Reagendada a …» / «Viene de …».
  - **Línea de tiempo del crédito**: próximas (pendientes) y pasadas (hasta 8 visibles + «Ver N más»); la API trae las últimas 20 gestiones del mismo crédito.
- **Acciones:**
  - **Completar** (`POST /api/agenda/{id}/complete {outcome, notes?}`): resultado obligatorio, válido según el tipo: Llamada y WhatsApp → Hablé con el deudor / No respondió / El número no es del deudor; Visita → Hablé con el deudor / No lo encontré en el domicilio / La dirección no corresponde; Promesa de pago → «Confirmó el pago» (`PROMISE_KEPT`) / «No pagó» (`PROMISE_BROKEN`); Recordatorio → Realizado. Notas ≤ 1.000 (UI). Efecto: crea una actividad de crédito (`CALL`/`VISIT`/`MESSAGE`/`NOTE` según el tipo) ligada al episodio abierto, pasa el agendado a `EXECUTED` apuntando a esa actividad y, si es promesa, cancela su recordatorio. Resultado fuera de lista → 400 `AGENDA_007`; ya no pendiente → 409 `AGENDA_008`. Un reintento con el mismo resultado devuelve lo ya hecho.
    - **Visita que una ruta lleva:** en lugar de «Completar» se ofrece «Abrir en la ruta» (a `/rutas/{routeId}/parada/{stopId}`), porque registrarla acá duplicaría la actividad y no dejaría GPS ni evidencia (`AGENDA_014`).
  - **Reagendar** (`POST …/reschedule {scheduledDate, timeMode, scheduledTime|timeSlot, reasonCode}`): fecha ≥ hoy (por defecto mañana), conserva hora exacta o franja, **motivo obligatorio** del catálogo `RESCHEDULE_REASON` (sin catálogo el desplegable avisa). Cierra la original como `RESCHEDULED` y crea una **nueva** con `rescheduledFromId`, mismo responsable y mismo creador; en promesas mueve `promiseDate` y rehace el recordatorio; la visita se desprende de la ruta vieja y entra a la del nuevo día si existe. La pantalla se refresca sobre la original (ahora «Reagendada a …»).
  - **Cancelar** (`POST …/cancel {reasonCode}`): motivo obligatorio del catálogo `CANCEL_REASON`. Queda visible con estado Cancelada (para que desaparezca está «Eliminar»). Libera la parada de ruta y cancela el recordatorio de la promesa.
  - **Editar** (solo creador; abre el mismo modal que «Nueva tarea» precargado; `PATCH /api/agenda/{id}`): se puede cambiar tipo, campos del tipo, hora/franja, observaciones (vacías limpian) y, con `agenda:assign`, el responsable. **No** cambia fecha, crédito ni cliente (la fecha se cambia reagendando; la fecha de una promesa tampoco se edita desde acá).
  - **Eliminar** (solo creador, solo pendiente; `DELETE /api/agenda/{id}`): borrado lógico, vuelve a `/agenda`. Una gestión ya ejecutada no se borra.
  - **Acciones de contacto** (solo pendiente): WhatsApp → abre `wa.me` con el mensaje; Llamada → copia el teléfono; Visita → «Ver ubicación» (mapa) si hay coordenadas. No registran nada: son atajos.
  - «Posponer» (+15/+30/+60 min) **existe en la API** (`POST /agenda/{id}/postpone`) pero la web no la ofrece.
- **Datos que consume:** `GET /agenda/{id}`, `/auth/me`, `/catalogs/CANCEL_REASON`, `/catalogs/RESCHEDULE_REASON` (solo si hay acciones), `GET /agenda/summary` (día de hoy). Escrituras BFF: `/api/agenda/{id}` (PATCH, DELETE), `/api/agenda/{id}/{complete,cancel,reschedule}`.
- **Navegación:** llega de `/agenda`, de enlaces en notificaciones y del historial de otra gestión. El parámetro `?accion=completar|reagendar|cancelar|editar|eliminar` abre directamente el diálogo. Lleva a `/mora/{creditId}`, a la parada de la ruta y a otras gestiones del historial.
- **Estados especiales:** 404 si no existe o está fuera de alcance; sin `agenda:write` no hay botones; gestión no pendiente: sin acciones de estado ni contacto; sin catálogo de motivos: desplegable vacío con aviso.
- **Estado:** ✅.

---

## Rutas

### Rutas — `/rutas`
Archivos: `rutas/{page,route-tabs,period-picker,today-board,today-table,routes-table,collector-work-table,work-summary,start-route-button}.tsx`, `apps/web/src/lib/routes.ts`; API `routes.service.ts` (`list`).

- **Propósito:** ver el trabajo de campo: qué cobrador tiene ruta hoy y cómo va (Hoy), y consultar el historial por día o por período con resumen por cobrador.
- **Quién accede:** `route:read` (todos los roles incluidos auditor y visor). Alcance (`list`): con `route:assign` ve todo y puede filtrar cobrador; con `route:execute` sin assign (cobrador) solo sus rutas; solo-lectura (auditor/visor) ve toda la cuenta. A quien no tiene `route:assign` la pantalla le muestra «Estás viendo sólo tus rutas» (incluso al auditor, que en realidad ve todo — ver Observaciones).
- **Qué muestra:**
  - Selector **Hoy / Historial**; dentro de Historial, **Día / Período**. Un enlace viejo `?modo=planificacion` redirige a `/rutas/planificar`.
  - **Hoy** (`?modo` ausente; día = el de la empresa, cambiable con el selector de día): 4 totales (cobradores, paradas, gestionadas, pendientes) y tabla con **una fila por cobrador**: Cobrador, Estado (Planificada/En curso/Completada/Cancelada o «Sin ruta»), Paradas («5 / 8»), Progreso (% y barra), Cobrado hoy (suma de pagos del día), Siguiente parada (nombre del cliente; «Todas gestionadas» si cerró), Acciones. Quien administra rutas ve también a los cobradores activos **sin ruta** (rol `COLLECTOR`); el cobrador solo la propia. Filtros: cobrador (si administra) y estado (incluye «Sin ruta»). Orden por defecto: En curso, Planificada, Completada, Cancelada, Sin ruta y luego alfabético; ordenable por cobrador, estado, paradas, progreso, cobrado.
  - **Historial · Día:** tabla de rutas del día (Fecha, Cobrador, Estado, Paradas visitadas/total, Distancia km) paginada 25/50/100, con filtros cobrador/estado.
  - **Historial · Período:** selector de rango con atajos y dos fechas (por defecto últimos 7 días; si se invierte, se ordena); **resumen por cobrador** (días, rutas, paradas, gestionadas, pendientes) y totales. Trae hasta **5 páginas de 100** rutas; si hay más, avisa «truncado».
- **Acciones:**
  - **Iniciar ruta** (botón en la fila «Hoy», solo si la ruta está Planificada y el usuario es su cobrador o quien la armó): `PATCH /api/routes/{id}/status {status:'IN_PROGRESS'}`. La API valida de nuevo (ver detalle de ruta).
  - **Ver** (ruta en curso/cerrada o sin permiso de iniciar): `/rutas/{id}`.
  - **Planificar** (fila «Sin ruta», solo con `route:assign`): `/rutas/planificar?date={día}&collectorId={id}`.
  - Cambiar de día/período/filtros/orden/página (URL).
- **Datos que consume:** `GET /routes?date=&limit=100` (Hoy; incluye `visitedCount`, `nextStop`, `collected`), `GET /routes?…&page&limit&sort&dir&collectorId&status` (día), `GET /routes?from=&to=…` (período), `GET /auth/me`, `GET /users`, `GET /agenda/summary`. Escritura: `PATCH /api/routes/{id}/status`.
- **Navegación:** desde el menú «Rutas». Lleva a `/rutas/{id}` y `/rutas/planificar`. (La web **no** ofrece «Planificar rutas» en la cabecera: se planifica desde la fila de cada cobrador.)
- **Estados especiales:** vacío Hoy «No hay cobradores ni rutas para este día»; vacío día «No hay rutas para este día»; sin resultados con filtros; error → `EmptyState`; un cobrador sin nombre resoluble («Cobrador desconocido», p. ej. sin `user:read`).
- **Estado:** ✅ (Hoy, Día, Período, resumen por cobrador).

---

### Planificar rutas — `/rutas/planificar`
Archivos: `rutas/planificar/{page,plan-screen,plan-filters,plan-preview,plan-location-dialog}.tsx`, `apps/web/src/lib/plan.ts`, BFF `api/routes/{plan,plan-preview}`; API `routes.service.ts` (`generate`, `previewPoints`).

- **Propósito:** armar y publicar la ruta de **un cobrador para un día** eligiendo créditos, ubicaciones, orden y revisando recorrido antes de publicar.
- **Quién accede:** `route:assign` (supervisor, gerente, administrador). Sin él la página **redirige a `/rutas`** (la API también lo rechazaría). Requiere al menos un cobrador activo (rol `COLLECTOR`); si no hay: «No hay cobradores activos».
- **Qué muestra / pasos** (barra de 4 pasos; si se llega con `?date=&collectorId=` desde «Hoy» arranca en el paso 2 con un aviso «Planificando para X el …»):
  1. **Fecha y cobrador:** fecha (≥ hoy; por defecto mañana) con atajos de 7 días; «Mínimo de paradas» (1–50, por defecto **8**; es solo un aviso, no bloquea); chips de cobradores con ✓ y nº de paradas si ya tienen ruta ese día. Lista de las **visitas agendadas** de ese cobrador ese día (hora, cliente, crédito, prioridad): «se marcarán automáticamente en la ruta».
  2. **Clientes:** lista de créditos disponibles (máx. **100**; dice «N encontrados, mostrando 100») con filtros: búsqueda, días de mora (1-7, 8-15, 16-30, 31-60, 61-90, 90+), categoría, prioridad, zona, saldo mín/máx, promesa, última visita (nunca / hace 7/15/30 días), resultado de la última visita, y «Cartera: todos» (ayudar a otros). Por defecto solo la cartera del cobrador (responsable, temporal o apoyo vigentes) y **excluye los créditos que ya son parada de una ruta viva ese día** (una cancelada los libera); orden por prioridad desc. Panel «elegidos» con la ubicación de cada uno (cambiar/agregar con diálogo; sin punto en el mapa se marca en naranja).
  3. **Mapa y orden:** mapa con las paradas numeradas; reordenar arrastrando o con ↑/↓; quitar; buscar por área (radio en km) para sumar candidatos cercanos. Pines: agendada/con hora fija vs. pendiente.
  4. **Vista previa:** recorrido por calles, distancia, duración, **hora de salida** (por defecto 08:30; editable), llegada estimada por parada, aviso de «llega tarde» si la llegada estimada supera la hora fija de una visita agendada, y, si existe, «aplicar el orden sugerido» (ahorra km/min). No guarda nada.
- **Acciones:** *Siguiente / Atrás*; *Publicar (N paradas)* — `POST /api/routes/plan {plannedDate, assignments:[{collectorId, creditIds, locations}], requirePoints:true}` → API `generate`.
  - Validaciones de la pantalla: no avanza del paso 2 sin créditos elegidos ni con alguno sin punto en el mapa; publicar exige ≥ 1 parada y todas con punto.
  - Reglas de la API: fecha entre **hoy y hoy + 14 días** (`ROUTE_PAST_DATE`, `ROUTE_TOO_FAR`; la pantalla no limita el máximo con `max`, así que 14+ días rebota con el mensaje del servidor); el cobrador debe estar activo en el tenant; **solo una ruta por cobrador y día** (`ROUTE_ALREADY_FOR_DAY`: la pantalla ya lo detecta y ofrece «Ir a la ruta» o «siguiente cobrador»); los créditos deben estar en alcance; las visitas agendadas de ese cobrador ese día **entran solas** (con créditos elegidos, al final; sin elección, primero) y si el crédito ya iba por mora es **una sola parada** con el vínculo a la visita; con `requirePoints` toda parada debe tener punto (`ROUTE_STOPS_WITHOUT_POINT` lista cuáles faltan); sin paradas → «No tenés casos abiertos…». El `sequenceOrder` respeta el orden armado.
  - El cobrador recibe un aviso (`ASSIGNED`); queda auditado `route/GENERATE`.
- **Datos que consume:** `GET /mora?limit=100&excludeRouted={día}&assigneeId=…` (disponibles), `GET /routes?date=&limit=100`, `GET /arrear-categories`, `GET /agenda?date=`, `GET /users`, `GET /auth/me`, `GET /agenda/summary`; `POST /api/routes/plan-preview` → `POST /routes/plan-preview` (hasta 60 puntos; no guarda ni expone nombres/direcciones); `GET /api/agenda/context/{clientId}` (ubicaciones en el diálogo).
- **Navegación:** desde «Planificar» de la fila «Sin ruta» en `/rutas` o por URL. Al publicar queda en la misma pantalla con confirmación «Ruta de X con N paradas» y la ruta pasa a verse en `/rutas`.
- **Estados especiales:** cobrador con ruta ese día → pantalla con enlace a la ruta (no se arma otra); error al cargar disponibles → estado «reintentar»; lista corta («Hay N, mínimo M») solo avisa; sin motor OSRM la vista previa llega sin geometría ni tiempos y lo dice.
- **Estado:** ✅.

---

### Detalle de ruta — `/rutas/[id]`
Archivos: `rutas/[id]/{page,route-actions,next-stop-card,route-editor,change-requests-panel,record-visit-dialog,whatsapp-button}.tsx`, BFF `api/routes/[id]/{status,optimize,stops,stops/[sid],change-requests,pdf}`, `api/visits`, `api/payments`; API `routes.service.ts`, `route-access.ts`, `route-changes.service.ts`, `field.service.ts`.

- **Propósito:** centro de supervisión de una ruta: avance, recaudo, mapa y paradas; iniciar/completar/cancelar; editar o pedir cambios; registrar visitas.
- **Quién accede:** `route:read`; quien administra rutas ve cualquiera del tenant; el cobrador solo la suya (ajena → 404). Qué puede hacer cada uno lo calcula la API en `capabilities` (`routeCapabilities`) — la web solo muestra o esconde botones:
  - **canManage («arma»)** = creador de la ruta, o administrador (assign+execute), o (ruta anterior a F4/12 sin creador) manager/cobrador.
  - **canRun («anda»)** = cobrador de la ruta, creador, administrador, o manager en ruta sin creador.
  - `start`/`complete`: estado válido y (canRun o manager). `cancel`: estado válido, **sin visitas registradas** y canRun. `edit`: ruta abierta y canManage. `requestChange`: abierta, no canManage, y (manager o su cobrador). `recordVisit`: no cancelada y (canRun, manager o su cobrador).
- **Qué muestra:**
  - Cabecera: nombre del cobrador, día, estado (Planificada / En curso / Completada / Cancelada); acciones y «Descargar PDF» (`GET /api/routes/{id}/pdf` → hoja de ruta).
  - Resumen: **Cobrado** (suma de pagos del día de los créditos de las paradas), **Gestionadas** («5 / 8»), **Pendientes**, **Distancia** (o «sin distancia»), barra de %, chips por categoría de resultado (Cobrado, Prometido, No respondió, Inalcanzable, Otros; solo las > 0), motivo del cierre/cancelación si lo hay.
  - **Siguiente parada** (si la ruta no está cerrada): primera parada sin gestionar con cliente, dirección, monto vencido y días de mora; botones WhatsApp, «Registrar gestión» y «Ver parada».
  - **Pedidos de cambio** (si hay): pendientes y últimos 5 resueltos.
  - **Mapa + lista de paradas** (`RouteEditor`): recorrido por calles, paradas numeradas con estado (Pendiente / En camino / Visitada / Saltada), último resultado, «con visita agendada», hora fija, «ayuda», monto vencido y días; pines de las visitas registradas (las de «sin ubicación» (0,0) no se dibujan); **sugerencias** de mora sin ruta a menos de `SUGGEST_KM` de alguna parada («visitas preventivas»; se pueden ocultar). Aviso cuando el motor de ruteo no está y el mapa une los puntos con rectas.
- **Acciones:**
  - **Iniciar ruta** (`PATCH /api/routes/{id}/status {status:'IN_PROGRESS', reason?}`): PLANIFICADA → EN CURSO. Si quien inicia no es el cobrador ni quien la armó, **motivo obligatorio** (5–500 caracteres; `ROUTE_REASON_REQUIRED`); guarda `startedAt`.
  - **Completar jornada** (`…{status:'COMPLETED'}`): EN CURSO → COMPLETADA. Si quedan paradas sin gestionar o la completa alguien ajeno, **motivo obligatorio**; las paradas abiertas pasan a **SALTADA** y liberan su visita agendada. Guarda `completedAt` y emite `route.completed`. (Compatibilidad: apps móviles anteriores a `ROUTE_CLOSE_REASON_MIN_APP_VERSION` pueden cerrar su ruta sin motivo; la web siempre lo envía.)
  - **Cancelar ruta** (`…{status:'CANCELLED', reason}`): PLANIFICADA o EN CURSO → CANCELADA con **motivo obligatorio**; las paradas abiertas pasan a SALTADA y liberan agenda; se avisa al cobrador y al creador. **Con visitas ya registradas no se cancela, se completa** (botón deshabilitado «Cancelar» con la explicación). Si quien la mira no es canRun, el botón es «Pedir cancelar la ruta» (crea un pedido `CANCEL`).
  - **Optimizar orden** (`POST /api/routes/{id}/optimize`; visible con `edit`, ruta abierta y > 1 parada sin gestionar): pide a OSRM el recorrido óptimo (`trip`, primera y última fijas, sin volver al inicio) y **solo aplica si ahorra ≥ 1 km o ≥ 10 min**. Las paradas **con hora fija, ya gestionadas o sin punto conservan su lugar**; el resto reparte los lugares libres.
  - **Editar paradas** («Editar recorrido», `?editar=1`; si quien edita no es dueño se muestra «Pedir cambios»): agregar una parada (desde la lista de disponibles con los mismos filtros del planificador, desde el mapa por área o desde las sugerencias; pide elegir la ubicación si el cliente tiene varias), quitar, mover (↑/↓/arrastrar) y **cambiar la dirección** de una parada pendiente. Reglas API: solo ruta abierta (`ROUTE_CLOSED`); quitar y mover **solo paradas PENDIENTES** (`ROUTE_STOP_DONE`); no repetir el crédito en la misma ruta (`ROUTE_STOP_DUPLICATE`); la ubicación debe ser del cliente y tener punto; al quitar se renumera sin huecos y el total sale de contar paradas. Si el usuario **no** es quien armó la ruta, cada una de estas acciones se convierte en un **pedido de cambio** con motivo.
  - **Pedidos de cambio** (`/api/routes/{id}/change-requests`): tipos `ADD_STOP`, `REMOVE_STOP`, `REORDER`, `CANCEL`; motivo obligatorio (5–500). Solo se puede pedir si no se es dueño (`ROUTE_REQUEST_NOT_NEEDED` si ya puede hacerlo directo) y la ruta está abierta. **Aprobar/Rechazar: solo quien «arma» la ruta (creador o administrador)**; al aprobar la API aplica el cambio con las mismas reglas (si ya no se puede, el pedido vuelve a Pendiente y explica por qué, `ROUTE_REQUEST_STALE`); **Retirar**: solo quien lo pidió, mientras esté pendiente. Se notifica a cada parte. Quien no es dueño ve solo sus propios pedidos.
  - **Registrar gestión** (`RecordVisitDialog`, desde «Siguiente parada», fila de la lista o ficha de parada): ver abajo.
  - **WhatsApp:** abre `wa.me` con el mejor teléfono del cliente (WhatsApp principal > teléfono principal > cualquier WhatsApp > primero) y un saludo con el nombre; usa `GET /api/agenda/context/{clientId}` (requiere `agenda:write`).
- **Registrar gestión / visita** (`POST /api/visits`, luego pasos separados):
  - *Resultado* (una de 6 variantes): **Pagó** (requiere `payment:write`, si no el botón está bloqueado), **Promesa**, **No contestó** (canal Llamada o Puerta), **Sin contacto en la visita** (siempre en la puerta; casilla «se dejó el aviso de cobro»), **Dirección incorrecta** (nota obligatoria), **Especial** (categoría obligatoria del catálogo `SPECIAL_CATEGORY`).
  - *Monto* (Pagó/Promesa) > 0; en Pagó no puede superar el **monto vencido** de la parada salvo crédito de fuente externa (sin tope). Si monto ≥ vencido − 0,005 el resultado es `PAID`, si no `PARTIAL_PAYMENT`. Medio de cobro: Efectivo/QR/Transferencia; en Promesa, medio del catálogo y fecha ≥ hoy.
  - *Nota* (opcional salvo Dirección incorrecta), *foto* opcional (imagen; la API limita a 8 MB), y para «No contestó» / «Sin contacto» la opción «Agendar nueva visita» (fecha y franja; solo si la parada tiene ubicación o dirección).
  - **Qué se envía:** el panel no tiene GPS del cobrador: manda el punto conocido de la parada (o 0,0 si no hay) con `gpsFallback:true` y `source:'WEB'`, por lo que la visita queda marcada **GPS estimado**, a nombre del cobrador de la ruta y con «registrada por» quien la cargó. Si quien la carga no es el cobrador, la pantalla lo avisa.
  - **Pasos posteriores independientes** (la visita ya existe y no se deshace; cada fallo se informa por separado): foto → `POST /api/visits/{id}/evidence {type:'PHOTO', fileUrl, fileHash}`; pago → `POST /api/payments` con clave de idempotencia `visit-{id}`; promesa → `POST /api/agenda` (promesa con franja Mañana); nueva visita → `POST /api/agenda` (VISIT).
  - **Reglas de la API** (`field.service.createVisit`): parada obligatoria (o crédito si es el cobrador); GPS válido; detalles validados contra el resultado; solo el cobrador de la ruta o quien administra rutas (si no, 404); ruta no cancelada (`visitRouteCancelled`); una parada ya visitada **no se visita otra vez**: se **corrige** con una visita nueva que apunta a la corregida (`correctsVisitId`); la visita marca la parada `VISITED`, deja actividad en la bitácora del crédito (una corrección es una Nota) y **cierra la visita agendada** ligada en la misma transacción.
- **Datos que consume:** `GET /routes/{id}` (paradas con dirección en claro; audita `PII_REVEAL`), `GET /routes/{id}/preview` (geometría), `GET /visits?routeId=`, `GET /payments?creditId=&from=&to=` (uno por crédito), `GET /mora?…` (disponibles; solo ruta abierta), `GET /arrear-categories` (en edición), `GET /routes/{id}/change-requests`, `GET /users`, `GET /auth/me`, `GET /agenda/summary`, catálogos `SPECIAL_CATEGORY`, `PAYMENT_METHOD`.
- **Navegación:** desde `/rutas` (fila Hoy/Día/Período). Lleva a `/rutas/{id}/parada/{sid}`, `/cartera/{clientId}`, `/rutas/planificar`.
- **Estados especiales:** ruta inexistente/ajena → 404; ruta sin paradas «Esta ruta no tiene paradas»; ruta cerrada (completada/cancelada) → sin edición, sin siguiente parada; motor de ruteo caído → mapa con rectas; cambios concurrentes → `ROUTE_STATE_CHANGED` «actualizá y volvé a intentar»; fecha de ruta no se puede mover (se cancela y se arma otra).
- **Estado:** ✅.

---

### Detalle de parada — `/rutas/[id]/parada/[sid]`
Archivos: `rutas/[id]/parada/[sid]/{page,stop-actions}.tsx`; reutiliza `FichaGestion`, `RecordVisitDialog`, `WhatsAppButton`.

- **Propósito:** ver una parada concreta: su ubicación, la ficha de gestión del crédito, las visitas registradas (con correcciones) y la evidencia.
- **Quién accede:** mismo alcance que la ruta (`GET /routes/{id}` valida; no existe `GET /stops/{id}`, la parada se busca en la ruta). «Registrar gestión» y «Corregir» requieren `capabilities.recordVisit` y que la parada tenga crédito.
- **Qué muestra:**
  - Cabecera: nombre del cliente (o «Parada N»), «Parada N · X días de mora», estado de la parada (Pendiente / En camino / Visitada / Saltada), «Ver ficha del cliente», WhatsApp y «Registrar gestión» (solo si no está visitada).
  - Datos de la parada: dirección, lugar (tipo de ubicación y dueño si es de garante/familiar), hora (real si se visitó, o la hora fija agendada), último resultado.
  - Pestañas: **Ficha** (la ficha de mora del crédito sin cabecera ni «La persona»), **Visitas** (cada visita: resultado, fecha, quién la cargó y «a nombre de», GPS con precisión, insignia «GPS estimado» si fue derivado del punto de la parada, notas, evidencias; botón «Corregir» en las que no son correcciones) y **Evidencia** (fotos con su hash SHA-256; la firma se retiró del panel: otros tipos se muestran como enlace). Abre en «Visitas» si ya fue visitada, en «Ficha» si no.
- **Acciones:** Registrar gestión / Corregir visita (mismo diálogo y reglas que en el detalle de ruta, con `correctsVisitId` al corregir); WhatsApp; ver ficha del cliente.
- **Datos que consume:** `GET /routes/{id}`, `GET /visits?routeStopId=`, `GET /visits/{id}` (uno por visita, con evidencias; audita `PII_REVEAL`), `GET /auth/me`, `GET /users`, `GET /agenda/summary`; la ficha: ver `/mora/[creditId]`. Escrituras: `POST /api/visits`, `/api/visits/{id}/evidence`, `/api/payments`, `/api/agenda`.
- **Navegación:** desde el mapa/lista/siguiente parada de `/rutas/{id}`; enlace «← volver». La evidencia se sirve por `/api/uploads/<archivo>` (handler propio con Bearer).
- **Estados especiales:** parada que no pertenece a la ruta → 404; parada sin crédito → la pestaña Ficha dice «sin crédito» y no se registra gestión; sin visitas → «No visitada»; evidencia de URL externa → enlace (no imagen rota).
- **Estado:** ✅.

---

## Glosario y reglas de negocio

**Mora / días de mora.** `credits.days_past_due`. Quién lo escribe depende del **origen de la mora** (`arrearsSourceOf`): *Del archivo* (crédito importado/PSF): manda el archivo hasta la próxima carga, el job no lo toca; *A mano*: se deriva de `moraSince` declarada por una persona (`manualArrears`); *Calculada*: sale del cronograma de cuotas (cuota impaga más antigua) con el método bancario del crédito (D20: `arrearsSince`), o de la próxima fecha de vencimiento si no hay cronograma. Si no se puede saber de dónde sale, el job **no toca** el crédito (no escribe 0). Operaciones externas `ABSENT` del reporte se saltan enteras. El job corre cada 6 h (`arrears-job.service.ts`, «diario en la práctica»), por lotes de 200, y no notifica.

**Monto vencido.** Importado: lo que dijo el archivo (`pastDueAmount`); propio con cronograma y mora calculada: Σ(monto − pagado) de cuotas con vencimiento anterior a hoy y no pagadas; mora a mano o sin cronograma: sin dato («—»).

**Situación (Al día / En mora).** Sale **solo** de si el crédito tiene un **episodio de mora abierto** (`moraSituation`); no depende de gestiones ni promesas. El castigo es independiente.

**Episodio de mora** (`credit_arrear_episodes`). Un periodo de mora de un crédito. Lo abre y cierra un **trigger de base** sobre `credits` (`credits_track_arrear_episode`), no una persona ni el job directamente: 
- *Se abre* cuando el crédito pasa a estar «en mora»: `deleted_at IS NULL`, `days_past_due > 0` y estado distinto de `PAID`/`CANCELLED` (el castigo **no** lo cierra). Hay a lo sumo uno abierto por crédito (índice único parcial). Inicio = fecha declarada (`moraSince`/`arrearsSince`) o, si no, `reported_as_of`(o hoy) − días, marcado **estimado**; fuente = Calculada/Del archivo/A mano.
- *Se actualiza* mientras sigue en mora: sube `max_days_past_due`.
- *Se reabre* el último episodio cerrado por `SOURCE_ABSENT` si el crédito vuelve al reporte (`PRESENT`) todavía en mora, para que un crédito que «parpadea» no sume episodios.
- *Se cierra* (fecha fin = hoy, saldo al cierre) con motivo: `DELETED` (borrado), `CANCELLED` (cancelado), `SOURCE_ABSENT` (ausente del reporte: no se sabe cómo terminó y **no cuenta como recuperación**), `PAID` (pagado, o saldo ≤ 0,005) o `CURRENT` (se puso al día). El valor `WRITTEN_OFF` solo existe en episodios históricos.
- Se dispara al cambiar `days_past_due`, `status`, `deleted_at` o `sync_status`.

**Prioridad.** Vive en el episodio abierto (un crédito al día no tiene). Valores: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`. Cálculo (`arrears-priority-score.ts`): `score = saldo/1000 × pesoMonto + días × pesoDías + pesoRiesgo(segmento del cliente)`; por defecto pesoMonto = 1, pesoDías = 1, riesgo ALTO = 30 / MEDIO = 15 / BAJO = 0. Umbrales por defecto: `score ≥ 100` Crítica, `≥ 60` Alta, `≥ 30` Media, si no Baja. Es configurable por cuenta (`accounts.configuration.casePriority`, mezcla superficial con los defaults). Ejemplo: saldo 7.000, 20 días, riesgo medio → 7 + 20 + 15 = 42 → Media. Se recalcula en el job (cada 6 h), al recalcular la mora desde Créditos y al **soltar** una prioridad fijada. **Fijar** una prioridad (`priority_pinned_at`) hace que el recálculo no la pise (candado 📌). El orden de lista por prioridad pone Crítica primero en descendente y los nulos al final. Un episodio recién abierto puede mostrar «—» hasta el siguiente recálculo (el trigger no la calcula; no verificado el camino de importación).

**Categoría de mora (A/B/C…).** Se **calcula** con los días de mora y los rangos de la cuenta (Administración → categorías); nunca se guarda en el crédito ni la elige el usuario. Por defecto A = 1–30, B = 31–60, C = 61+. Validación de rangos: empieza en 1, sin huecos ni solapes, solo el último puede no tener tope, códigos únicos. Un crédito al día (días < 1) no tiene categoría. Un cambio de rangos rige en la siguiente consulta (sin caché).

**Castigo.** Condición (`written_off_at`), no estado: no cierra mora ni episodio. Solo `credit:write` + `data:scope:all`. Se revierte.

**Promesa de pago.** Agendado de tipo `PROMISE_TO_PAY` con `details {amount, promiseDate, paymentMethodCode, bankCode?}`. Estado derivado (`promiseStatus`, `mora-promises.ts`), sin columna propia:
- `ACTIVE`: agendada (`SCHEDULED`) y fecha ≥ hoy (UTC).
- `OVERDUE` («vencida sin cerrar»): `SCHEDULED` con fecha pasada. **No es incumplida**: nadie registró qué pasó.
- `KEPT` (cumplida) / `BROKEN` (incumplida): `EXECUTED` cuyo desenlace registrado (`credit_activities.result`) es `PROMISE_KEPT` / `PROMISE_BROKEN`. Ese desenlace lo elige **una persona** al completar la gestión en Agenda («Confirmó el pago» / «No pagó»). **No hay conciliación automática con los pagos registrados.**
- `EXECUTED` (sin desenlace conocido), `CANCELLED`, `RESCHEDULED` (reagendada: se cuenta en su reemplazo).
- *Cumplimiento* (`summarizePromises`): `kept / (kept + broken)`; sin ninguna cerrada no hay porcentaje («—», no 0 %). «Hechas» excluye las reagendadas. Las métricas de la ficha cuentan solo promesas **creadas** dentro de la mora actual.
- Tope al crear: el monto no puede superar el saldo, salvo crédito de fuente externa. La fecha no puede ser pasada. La promesa vigente de la **lista** se calcula por cliente; la de la **ficha** por crédito.

**Gestión (actividad).** Registro en `credit_activities`: Llamada, Visita, Mensaje, Nota, y automáticas de Pago/Asignación. Resultado por tipo (ver ficha). «Contacto» = gestión no-Nota con resultado `CONTACTED`, `PROMISE_TO_PAY`, `REFUSAL`, `PARTIAL_PAYMENT` o `PAID`; «No respondió», «número equivocado», «no encontrado», «dirección incorrecta» **no** son contacto. La «última gestión» es solo informativa (no es un estado).

**Métricas de recuperación.** Ventana = desde el inicio del episodio abierto; sin episodio, histórico. «Días hasta primer contacto/visita/pago» quedan vacíos si todavía no ocurrió (no 0). Si Kobrax empezó a registrar la mora más de 3 días después de que empezó (`untrackedDays`), se muestran también los días desde que se registra. Solo cuenta lo cobrado por Kobrax (`KOBRAX_COLLECTED`), no lo confirmado por la entidad externa.

**Pago registrado en ficha vs. pago en visita.** Un pago de campo se registra como `POST /payments` aparte de la visita (con `visitId`); si falla, la visita queda registrada y se avisa.

**Jornada / ruta.** `route_plans`: una por **cobrador y día** (único). Estados y transiciones (`route-rules.ts`): `PLANNED` → `IN_PROGRESS` | `CANCELLED`; `IN_PROGRESS` → `COMPLETED` | `CANCELLED`; `COMPLETED` y `CANCELLED` son finales (no se reabren). «Abierta» = Planificada o En curso (es la única editable). Completar/cancelar con paradas abiertas las pasa a Saltada y libera su visita agendada. Con visitas registradas no se cancela. Motivo escrito: 5–500 caracteres. Planificación: hoy ≤ día ≤ hoy + 14.

**Parada.** `route_stops`, una por crédito (y por cliente en rutas antiguas). Estados (`STOP_TRANSITIONS`): `PENDING` → `IN_ROUTE` | `SKIPPED`; `IN_ROUTE` → `PENDING` | `SKIPPED`; `VISITED` y `SKIPPED` finales. **No se pasa a Visitada a secas**: se registra la visita. «Abierta/sin gestionar» = Pendiente o En camino. La parada lleva una ubicación concreta (`locationId`, con punto en el mapa); si nació de una visita agendada guarda el vínculo (`agendaItemId`) y la hora fija. Cambios de estado permitidos manualmente a quien anda o arma la ruta; mover/quitar/cambiar dirección: solo quien la armó (los demás piden), solo paradas pendientes.

**Orden y optimización.** Orden = `sequenceOrder` 1..N sin huecos. Reordenar reescribe la secuencia en dos pasadas. Optimizar: OSRM `trip` con primera y última fijas, sin viaje de vuelta; se sugiere/aplica solo si ahorra ≥ 1 km o ≥ 10 min; las paradas con hora fija, gestionadas o sin punto no se mueven. Permanencia por parada para el cálculo de duración: 10 min (solo paradas sin gestionar). La hora fija es restricción dura: se muestra siempre el conflicto «llega tarde».

**Resultado de visita** (`VisitOutcome`): `NO_CONTACT`, `CONTACTED`, `PROMISE_TO_PAY`, `PARTIAL_PAYMENT`, `PAID`, `REFUSAL`, `NOT_FOUND`, `RESCHEDULED`, `WRONG_ADDRESS`, `SPECIAL`. Variantes del panel → resultado: Pagó → `PAID`/`PARTIAL_PAYMENT`; Promesa → `PROMISE_TO_PAY`; No contestó y Sin contacto en la visita → `NO_CONTACT`; Dirección incorrecta → `WRONG_ADDRESS`; Especial → `SPECIAL`. Categoría de resultado para el resumen de ruta: Cobrado (`PAID`, `PARTIAL_PAYMENT`), Prometido (`PROMISE_TO_PAY`), No respondió (`NO_CONTACT`), Inalcanzable (`NOT_FOUND`, `WRONG_ADDRESS`), Otros (`CONTACTED`, `REFUSAL`, `RESCHEDULED`, `SPECIAL`). Una visita es append-only: no se edita, se corrige con otra. Evidencia: foto con SHA-256, inmutable; la agrega quien registró la visita, su cobrador o quien administra rutas; adjuntar dos veces la misma foto devuelve la ya guardada.

**Agenda.** Estados: `SCHEDULED`, `EXECUTED`, `CANCELLED`, `RESCHEDULED` (vencida y pendiente son derivadas). Tipos: `CALL`, `VISIT`, `WHATSAPP`, `REMINDER`, `PROMISE_TO_PAY`. Modo de hora: `FIXED` (HH:mm) o `LAPSE` (franja Mañana/Tarde/Noche); existe `RANGE` en el enum pero la web no lo ofrece. Todo agendado nace asignado al responsable del crédito (o a quien lo crea). Reasignar la cartera mueve lo pendiente al nuevo responsable.

**Quién puede aprobar cambios de ruta.** Quien «arma» la ruta: su creador, el administrador de la empresa (assign+execute), o —en rutas anteriores sin creador— un manager o su cobrador. Un manager que no la armó y el cobrador de una ruta armada por otro **piden**; un manager sí puede iniciar/completar (con motivo) pero no cancelar directo.

---

## Contradicciones docs ↔ código y observaciones

1. **`docs/epics/F4/12-rutas-blueprint.md` (línea ~14)** dice que la web «no puede iniciar, cancelar ni completar una ruta, ni optimizar, ni previsualizar, ni registrar una visita». Es el diagnóstico previo: el código actual sí lo permite (acciones de estado, optimizar, vista previa, registrar/corregir visita, pedidos de cambio). El propio documento, en su plan de fases, lo marca como construido.
2. **`docs/epics/F4/12`** (§E.3) dice que `optimize` «puede mover visitas con hora fija y paradas ya visitadas» y reordena todas: **ya no**; el código conserva paradas con hora fija, gestionadas y sin punto.
3. **`docs/epics/F4/07` (línea ~322)** dice que la promesa cumplida/incumplida está «vigilado por job `promise-due`». El job `PROMISE_DUE` (`promise-due.service.ts`) avisa de **cuotas próximas a vencer**, no de promesas; cumplida/incumplida solo sale del desenlace que registra una persona al completar la gestión.
4. **Comentario de la migración `20261003020000_episodios_de_mora`** define «en mora» excluyendo `WRITTEN_OFF`; la migración posterior `20261005000000_eliminar_caso` redefine el trigger: **castigar ya no cierra el episodio** (solo `PAID`/`CANCELLED` lo excluyen). Vale la segunda (y `F4/08`).
5. **«Promesa vigente» no es consistente entre lista y ficha:** la lista (filtro y columna) la calcula por **cliente**; la ficha toma las promesas `ACTIVE` del **crédito**. Un cliente con dos créditos mostrará «promesa vigente» en ambos en la lista.
6. **Aviso «Estás viendo sólo lo que tenés asignado / tus rutas / tus gestiones»** depende de no tener `assignment:write` / `route:assign` / `agenda:assign`, no del alcance real: un auditor o visor (alcance total, solo lectura) ve el aviso aunque ve toda la cuenta.
7. **Texto de vacío de Agenda** («Las gestiones se agendan desde la app del cobrador») quedó anterior al botón «Nueva tarea» del panel.
8. **«Poner al día» en lote:** el botón se dibuja aunque el usuario no tenga `credit:write`; la API responde 403 por crédito (supervisor) y el resultado parcial lo informa. Además `clearArrears` busca el crédito por id sin aplicar el alcance de Mora (no verificado si la RLS cubre ese caso).
9. **Fecha máxima de planificación:** el `input type=date` solo tiene `min`; el límite de 14 días lo hace la API al publicar.
10. **Filtros de Agenda** (responsable, tipo, estado, búsqueda) se aplican en el navegador sobre el día/mes ya traído; «Vencidas» trae 50, y el contador usa el total del servidor solo si no hay filtro.
11. **Posponer** (+15/30/60 min) está en la API y en el móvil, no en la web.

## No verificado

- Si existe pantalla/Administración para editar `casePriority` (pesos y umbrales) y para los rangos de categoría desde la web (solo se verificó el endpoint `/arrear-categories` y el servicio).
- Que la importación de cartera calcule la prioridad del episodio recién abierto (solo se encontraron llamadas a `recomputeForCredit` en el job, Créditos y la prioridad manual).
- Aplicación del alcance de datos en `POST /credits/{id}/arrears/clear` y en `write-off`.
- Detalle del formulario de pago (`PaymentModal`: canales, límites) y del flujo de «Solicitar pago»: fuera de este alcance.
- Valor de `SUGGEST_KM` (sugerencias de mora cercana) y los atajos exactos del selector de período (se reutiliza `presetRange` del dashboard).
- Límite exacto de tamaño y tipo de foto en `POST /uploads` (el BFF indica «8 MB» validado por la API).
- Estado de commits de los cambios de agenda/rutas en el working tree al momento de la lectura.
