# F4 / 08 — Eliminar el «caso» de cobranza

Estado: **todas las decisiones y puntos por confirmar están resueltos (2026-10-03)**.

### Alcance de entrega ✅ (2026-10-03)

- **Solo desarrollo y pruebas**: no hay teléfonos de personas reales. Por eso **no hay** atajos de compatibilidad `/cases/*`, ni versión mínima de la app, ni migración con pérdida de la cola de los teléfonos. Al cambiar el esquema local del móvil se borra también la cola. Los arreglos de idempotencia de la fase 0 se mantienen igual (duplicaban datos de verdad).
- Se avanza **hasta la fase 6 incluida**. La **fase 6 borra todo** (tablas y columnas del caso, y la base de dev se recrea) **y crea un seed nuevo** de acuerdo a lo que ya existe (ver «Seed nuevo»).
- Después: la usuaria valida visualmente (web y emulador) y **hace ella el merge a `dev`**.
- La **paridad web ↔ móvil** de cartera, importación y mora se hace **dentro de la fase 5**, sobre el modelo ya por crédito, para no construir dos veces.
Base del trabajo: **`dev`** (`00ce81d`): ya incluye PSF, asignación al importar, la central de mora web/API, los post-its, la ficha rediseñada y la ficha de mora móvil.
Origen: la conversación sobre «Registrar acción», Agenda y la cartera importada (ver «Por qué»).

## Por qué

El **caso** (`collection_cases`) duplica dos cosas que ya existen y las contradice:

| Concepto | Qué dice | Quién lo maneja |
|---|---|---|
| Responsable del crédito (`credits.assigned_manager_id` + `credit_assignments`) | quién atiende el crédito | importación y quien reparte |
| Episodio de mora (`credit_arrear_episodes`) | cuándo y cuánto estuvo en mora | trigger de la base |
| **Caso** | el flujo de trabajo de ese periodo | job de mora + botón manual + «Registrar acción» |

Consecuencias que ya vemos:

- El cobrador del caso (`case.assignee_id`) es una copia del responsable que puede quedar **vacía o distinta**: «Registrar acción» abre casos sin cobrador, y el cobrador no ve créditos que le asignaron.
- La **agenda exige un caso abierto** (`agenda_items.case_id` NOT NULL): no se puede hacer una visita, llamada o recordatorio **preventivo** sobre un crédito al día.
- 21 de 22 créditos en mora de dev no tienen caso; hay tres rutas para registrar una gestión con tres reglas distintas.

## Modelo objetivo

### Roles ✅

- **Cobrador** = oficial de crédito / vendedor / prestamista: es la persona asignada al crédito. Lo atiende **esté o no en mora**.
- **Supervisor** = cobrador con equipo: **ve todo lo de su agencia** (sucursal), puede tener **créditos propios a su cargo**, puede **asignar** a otros, **cambiar temporalmente una mora de un cobrador a otro** y **asignar una ayuda** al crédito (un segundo cobrador).
- **Gerente / administrador**: ven todo y reparten. No trabajan el crédito en campo.

### El crédito, por conceptos separados ✅ (D1)

No hay un campo `status` que mezcle todo. Cada cosa responde por sí sola:

```text
CRÉDITO
├── Situación ............ Al día | En mora          (derivada del episodio abierto; nadie la edita)
├── Mora
│   ├── episodio de mora (inicio, fin, origen)
│   ├── días de mora (desde el inicio del episodio actual)
│   ├── saldo vencido
│   └── prioridad (con pin manual)
├── Categoría de mora .... A / B / C / …            (calculada: días de mora + rangos configurados en Administración)
├── Castigo .............. condición independiente  (puede haber 240 días de mora y estar castigado)
└── Actividad de cobranza  gestiones · promesas · pagos · notas   (información; NO cambia la situación)
```

Presentación (semántica, el diseño puede adaptarse):

```text
🟢 Al día
🔴 En mora            Categoría B · 47 días de mora
⚫ Castigado          240 días de mora · Categoría C
          + datos sueltos: Última gestión: llamada · hoy   |   Promesa vigente: Bs X · 10/10
```

### Principios

1. **Un responsable principal por crédito**, y opcionalmente un cobrador de **apoyo** y/o un **reemplazo temporal**. No existe un «cobrador del caso».
2. **Todo cuelga del crédito**: gestiones, agenda, pagos, visitas, notas, paradas de ruta. Hacerlas **no exige mora**.
3. **La mora es un episodio**, no algo que alguien abre. Lo que se hace durante la mora queda además ligado al episodio vigente (para métricas y reportes).
4. Todo lo que se hace aparece en **el historial del crédito** (preventivo o no), con el episodio indicado cuando lo hay.
5. **Gestiones, promesas y pagos no son estados del crédito.** No se deriva «en gestión», «con promesa», «promesa incumplida» ni «sin gestión» como estado.

## Dónde va a vivir lo que hoy da el caso

| Hoy en el caso | Pasa a | Decisión |
|---|---|---|
| Estado (PENDING, IN_NEGOTIATION, PROMISE_TO_PAY, CLOSED…) | **Se elimina sin reemplazo por otro estado.** La situación (Al día / En mora) se deriva del episodio; la categoría, de los días + configuración; el castigo es una condición aparte | D1 ✅ |
| Prioridad + pin manual | **Episodio abierto** (`priority`, `priority_pinned_at`); el cálculo actual se conserva | D3 ✅ |
| `slaDueAt` | **Se elimina.** La antigüedad es el día de mora; una gestión, promesa o contacto **no** reinicia ni cambia los días de mora. La fecha comprometida de una promesa mantiene su propio vencimiento. **No** se crea «sin gestión hace N días» como reemplazo | D2 ✅ |
| `lastActionAt` | `credits.last_action_at`, **solo informativo** («Última gestión»); no es estado ni filtro de SLA | D2 ✅ |
| `assignee_id` | responsable del crédito (+ apoyo y reemplazo temporal) | D8 ✅ |
| `closedReason` | `ArrearEpisodeEnd` (ya existe) | |
| `case_activities` | **`credit_activities`** (`credit_id`, `episode_id` nullable) | |
| Cierre exige ≥1 gestión real (CASE_001) | Se elimina: ya no hay cierre manual | D7 ✅ |
| Reparto automático al menos cargado | **Se elimina** (no se difiere) | D6 ✅ |

## Decisiones

### Tomadas ✅

- **D1 — Estado manual.** Se elimina; no se reemplaza por otro enum. Situación **Al día / En mora** derivada del episodio abierto. **Categoría de mora** (A/B/C/…) calculada por días de mora con **rangos configurables desde Administración** (nada hardcodeado; el usuario no la elige). La **categoría de la persona no interviene**. **Castigado** es una condición independiente (no una categoría ni un estado). Gestiones, promesas, pagos y notas son información de cobranza. Criterios de aceptación al final de este documento.
- **D2 — SLA.** Se elimina, sin métrica de reemplazo (ver tabla).
- **D3 — Prioridad.** En el episodio abierto, con pin manual. Un crédito al día no tiene prioridad.
- **D4 — Acciones preventivas en web.** La misma ficha de mora se muestra también desde `cartera/[id]/credito/[cid]`, sin duplicar componentes.
- **D5 — Permisos.** Se **renombran en este cambio** (ver «Permisos»).
- **D6 — Reparto automático al menos cargado.** Se elimina.
- **D7 — Cierre manual de mora.** Se elimina. La mora termina por pago, al día, ausencia del reporte, castigo o cancelación.
- **D8 — Alcance y asignación.** El supervisor ve **todo lo de su agencia**, puede tener créditos propios, asigna a otros, cambia **temporalmente** una mora de un cobrador a otro y asigna **ayuda** (segundo cobrador). Gerente y administrador ven todo.
- **D9 — Ausente del reporte (PSF).** Se indica en la ficha que **ya no aparece en el reporte**, que probablemente **se puso al día o se canceló** (el reporte no dice cuál: no se afirma pagado). Se trabaja **como ya trabajamos la mora**: sale de la lista activa, el episodio cierra con motivo «ausente del reporte» y queda en el historial; con `todos` se sigue viendo. No se bloquea el trabajo de campo.
- **D10 — Reasignar.** Lo agendado y sin ejecutar pasa al nuevo responsable (que es **otro cobrador**); lo ya ejecutado queda a nombre de quien lo hizo; el historial de asignaciones lo registra.
- **D11 — Recordatorio de cuota.** Pensado **para los créditos del sistema** (a partir de su cronograma). En los **importados**, si el archivo trae la siguiente fecha de pago, se usa como **guía** («Próximo pago») y puede generar el recordatorio.

### Puntos confirmados ✅ (2026-10-03)

- ✅ **D1-a · Castigo.** Hoy `credits.status` incluye `WRITTEN_OFF` (y `DEFAULTED`, que repite la mora). (Se agrega `credits.written_off_at/by/reason` como **fuente de verdad del castigo**; el estado `WRITTEN_OFF` se migra a esa condición y el importador PSF (`CASTIGADO`) la marca. `DEFAULTED` no se toca en este cambio: sigue como lo reporta PSF, y se evalúa aparte porque duplica la mora.)
- ✅ **D1-b · Categorías.** (Tabla `arrear_categories` por cuenta: código, nombre, desde-días, hasta-días (último sin límite), color. Validación: empieza en 1, sin huecos ni solapes. Valores iniciales de ejemplo A 1–30, B 31–60, C 61+, editables en Administración. La categoría no se guarda: se calcula con la configuración vigente.)
- ✅ **D1-c · Prioridad.** El cálculo actual usa días de mora, saldo y el segmento de riesgo de la persona. Dijiste que la categoría de la persona no interviene en A/B/C. **Confirmado: la prioridad sigue consumiendo el segmento de riesgo de la persona.** Quitarlo, si algún día se decide, es un cambio separado y no forma parte de este.
- ✅ **D1-d · Filtro «sin gestión desde».** Existe hoy en la lista de mora y es lo que D2 rechaza como reemplazo del SLA. (Se elimina junto con el caso; «Última gestión» queda solo como dato.)
- ✅ **D8-a · Reemplazo temporal y ayuda.** El plan de asignación original dejó el **apoyo temporal fuera a propósito**; ahora entra. (En `credit_assignments`: tipo `PRINCIPAL` / `TEMPORAL` (con vencimiento) / `APOYO`. Cobrador principal, temporal y de apoyo **ven y trabajan** el crédito. Mientras dura el reemplazo temporal, lo agendado pendiente pasa al reemplazo y **vuelve** al principal al vencer; el principal conserva la visibilidad. Asignan: supervisor de esa agencia, gerente y administrador.)
- ✅ **D9-a · Texto del aviso.** (La ausencia sigue sin afirmar «pagado»: «Ya no aparece en el reporte del dd/mm. Puede haberse puesto al día o cancelado; el reporte no lo dice».)
- ✅ **D11-a · Importados.** (La fecha reportada se muestra como «Próximo pago (según el reporte del dd/mm)» y genera el recordatorio solo si el reporte no está viejo.)

## Limpieza previa (cartera, importación y mora)

Antes de la fase 1 se deja limpio lo existente de estos tres módulos (auditoría 2026-10-03). Lo que es **código muerto, claves de texto sin uso, comentarios y docs desactualizados** se arregla ya; lo que es **paridad con el móvil** va a la fase 5.
- Web/API/shared: borrar `matchesText` (cartera) y el re-export `PAGE_SIZES` sin consumidor; borrar las claves i18n sin uso (`portfolio.sections.creditFixed`, `creditEditable`, `creditFixedHint`, `quote.belowCapital`, `activityType.PROMISE`, `errors.INVALID_ASSIGNEE` si se confirma); borrar `notePreview` y `MoraListQuery` sin uso; arreglar el comentario cortado de `timeline-section.tsx:56`.
- Importación: **borrar el módulo huérfano `clients/imports`** (controlador, servicio, csv, plan y 4 specs, sin ningún consumidor); borrar las claves `panel.import.run.lastRun*`; agregar las traducciones es/en que faltan (`IMPORT_FILE_NOT_STORED`, `IMPORT_RUN_NOT_FOUND`, `INVALID_ADVISOR_CODE`, `USER_NOT_MEMBER`, `USER_REQUIRED`); mostrar el recuento de **ignorados** en la vista previa y el historial web; pasar a shared las listas de códigos de rechazo y aviso que web y móvil duplican (las etiquetas siguen locales); alinear el comentario `ponytail:` del móvil sobre las claves con el README.
- Importación, web: controles de Ajustes para **base del saldo, mapa de estados y días de dato viejo** (hoy solo se cambian por API, aunque FIELD-RULES promete el editor de estados).
- Docs de importación: README del plan (encabezado «borrador» y `pdfjs-dist + xlsx` → `exceljs`), FIELD-RULES (encabezado falso sobre `importConfig`), BUILD-PLAN L86 («IMPORT web NO existe»), S3 D-N7 (obsoleto: los endpoints y la migración ya existen).
- `docs/flows/psf-diario/` guarda 5 PDFs de reportes **ficticios** (de prueba): se quedan.
- Textos: «tablero flotando sobre la pantalla» → «notas ancladas a cada sección» (comentarios y `launcherSub` es/en); quitar las referencias a «Gallium».
- Colores sueltos → tokens (`k-info-bg`, `k-teal`, `k-teal-bg`; `k-purple` en el aro del post-it) y extraer un `ToneTile` que comparten `activity-card` y `payments-section`; quitar el medio de pago duplicado en la tarjeta de pagos.
- Docs: `docs/epics/F4/07-central-mora-recuperacion.md` (encabezado, avance y post-its), `docs/epics/F10/BUILD-PLAN.md` y `plans/mora/README.md` (estado HECHO), `plans/cartera/S2` y `S3` («reemplazado por P6»), `F4/03-creditos.md` (apuntar a 06), `README.md` (el import móvil existe), `apps/mobile/CLAUDE.md` (dice WatermelonDB, el código usa `expo-sqlite`; y la descripción de `cobranza.tsx`).
- Móvil: quitar los archivos que solo reexportan de shared (`cliente-form.ts`, `cliente-diff.ts`, `prestamo-form.ts`) y los exports sin uso de `portfolio.ts`; fechas de la ficha con `prettyDate`; mismas etiquetas de resultado y tipo (mapa compartido) y el mismo color por estado de promesa.
- La parada de ruta enlaza por `caseId` (`rutas/[id]/parada/[sid]/page.tsx:76`): se resuelve en la fase 4 (pasa a `creditId`) y entonces desaparecen `byCase`, `MoraCaseLookup` y el redireccionamiento.

## Cobertura: lo hecho en cartera/importación y mora frente a este plan

| Lo que hicimos | Toca al caso | Qué hace el plan |
|---|---|---|
| PSF D1–D2 (identidad por operación, cliente provisional, vincular) | `link-client` mueve casos | solo mueve actividades y agenda por crédito |
| PSF D3 (un pago no toca saldo/mora/estado) | cierre del caso al pagar todo | el pago de Kobrax cierra la mora vía estado del crédito y trigger de episodios; PSF sin cambios |
| PSF D4 (ausencia ≠ pagado, no resucita cerrados) | el job cierra con `SOURCE_ABSENT` y reabre el mismo caso | lo maneja el trigger de episodios; aviso y trabajo sobre un ausente: **D9** |
| PSF D7 (KPIs por fuente) | «casos activos», rendimiento por cobrador | se redefinen sobre episodios abiertos y responsable; se avisa el cambio de definición |
| PSF D9 (dato viejo) | el job no abre caso si está viejo | desaparece con el caso; el aviso de dato viejo sigue en la ficha |
| Asignación al importar (P1–P11) | el caso copia el responsable solo al abrirse | el responsable es la única asignación; apoyo y temporal (**D8**); qué pasa con lo pendiente (**D10**); el filtro «Cobrador del caso» se elimina, queda «Responsable» |
| Historial de importaciones | no toca casos | sin cambios |
| Contactos y direcciones del archivo | no toca casos | sin cambios; Agenda los usa desde el cliente |
| Central de mora (lista, filtros, exportación) | `hasCase`, estado, prioridad, SLA, `noActionSince`, cobrador | filtros por situación, **categoría** (configurable), castigado, responsable y agencia; prioridad del episodio; **sin** filtro de SLA ni «sin gestión desde»; la exportación pierde la columna SLA y gana la categoría |
| Acciones masivas de la lista de mora | `caseIds`, `/cases/{id}/assign` y `priority` | por `creditIds`: asignar = reasignar el responsable por `AssignmentService` |
| Ficha de mora (gestiones, promesas, pagos, historial, notas post-it, métricas) | «Registrar acción» abre caso; actividades por caso | actividades por crédito con episodio; promesas = agenda; notas y post-its ya son del crédito |
| Ficha de mora móvil (`mora.activity`, `credit.note`) | usa el caso solo para la traza y el pago | ya por crédito: es la base de la fase 5 |

### Permisos ✅ (D5: se hace aquí)

Hoy `case:assign` hace tres cosas: reparte casos, **ve toda la cartera** y habilita `agenda:assign`. Se separan:

- **Ver todo / agencia / lo propio** → alcance de datos (ya existe el alcance por sucursal): supervisor = agencia, gerente y administrador = todo, cobrador = lo propio (+ apoyo y temporal).
- **Repartir créditos, cambiar temporalmente, asignar ayuda** → `assignment:write` (ya existe).
- Renombre (los nombres son mi propuesta, fáciles de cambiar):

| Hoy | Pasa a |
|---|---|
| `case:read` | `collection:read` |
| `case:write` | `collection:write` (gestiones, agenda y notas del crédito) |
| `case:export` | `collection:export` |
| `case:assign` | se elimina (se reparte en alcance + `assignment:write`) |
| `case:close` | se elimina (D7) |

Migración: tabla `permissions`, `role_permissions` y `user_permission_overrides`; seeds; constantes de shared; guards `@Roles`; menú y chequeos de la web; pruebas de `permission-gates`. Las sesiones abiertas llevan los permisos viejos hasta renovar el token: ventana de coexistencia con ambos nombres (los nombres viejos se aceptan hasta la fase 6).

## Criterios de aceptación de D1

1. Ya no existe dependencia funcional del estado manual pendiente / en negociación / promesa / cerrado.
2. La UI muestra **Al día** o **En mora** según los datos reales de mora.
3. Un crédito en mora obtiene su categoría A/B/C/… por días de mora.
4. Los rangos son configurables desde Administración y no están hardcodeados.
5. La categoría de la persona no interviene.
6. **Castigado** se conserva como condición independiente.
7. Gestiones, promesas, pagos y notas siguen como actividad/información, no como estados principales.
8. No se introduce un enum nuevo que reemplace al estado manual anterior.
9. La información histórica no se pierde.
10. Filtros, listados, detalle, API y demás consumidores quedan alineados con este modelo.

No implementar: «gestión reciente → En gestión», «promesa vigente → Con promesa», «promesa vencida → Promesa incumplida», guardar a mano `category = B`, `persona.category → categoría de mora`, ni `Categoría = Castigado`.

## Estrategia: expandir → migrar → contraer

Cada fase deja todo funcionando y con tests verdes. Hasta la fase 6 todo es reversible.

### Fase 0 — Preparación
- ✅ Decisiones D1–D11 y puntos confirmados (castigo, categorías, prioridad, reemplazo temporal y ayuda, filtro «sin gestión desde», texto del ausente).
- ✅ Backup de la base de dev: `E:/kobrax/backups/kobrax-dev-antes-de-sin-caso-20261003.dump` (pg_dump -Fc, 47 tablas con datos; 13 casos). Restaurar con `pg_restore`.
- **Base = `dev`** (hecho: `f10/mora` y `feat/mora-central-f1` entraron el 2026-10-03).
- ⏳ **Bloqueo para la rama:** hay trabajo **sin commitear** de la sesión (post-its anclados con su migración `20261003050000`, cards de Gestiones/Pagos/Historial, acordeones azules con alto fijo y este plan). Debe commitearse y entrar a `dev` **antes** de abrir `feat/sin-caso`, o la rama nacería sobre una base sin ellos.
- Rama `feat/sin-caso` desde `dev` (pendiente del punto anterior).
- **Primero arreglar los huecos de idempotencia** (sección «Offline», bloque A): son previos al cambio, no consecuencia de él, y si no se hacen la migración los hereda.

### Fase 1 — Base de datos (solo aditivo) y shared
- Migración **aditiva**:
  - tabla `credit_activities` + backfill desde `case_activities` (`credit_id` por `collection_cases.credit_id`, `episode_id` por fechas);
  - `credit_arrear_episodes`: `priority`, `priority_pinned_at`; backfill desde el caso abierto;
  - `credits.last_action_at`, backfill con la última gestión;
  - `field_visits`, `route_stops`, `notifications`: `credit_id` (+ backfill por `case_id`);
  - `agenda_items.case_id` pasa a **nullable**; `agenda_items.resultActivityId` apunta a `credit_activities`;
  - índices por `(account_id, credit_id, created_at)`;
  - **`arrear_categories`** (por cuenta: código, nombre, desde-días, hasta-días nullable, color, orden, RLS) con valores iniciales A 1–30, B 31–60, C 61+ (D1-b);
  - **castigo**: `credits.written_off_at`, `written_off_by`, `written_off_reason`; backfill desde los créditos con estado `WRITTEN_OFF` (D1-a);
  - `credit_assignments`: tipo `PRINCIPAL` / `TEMPORAL` / `APOYO` (+ vencimiento ya existente `expires_at`) (D8-a).
- Verificación de la migración: conteos antes/después (`case_activities` = `credit_activities`, nada huérfano) con un script tipo `db:audit`.
- Shared: tipos con `caseId` **opcional** y `creditId` obligatorio; nuevos tipos de actividad por crédito. `AgendaFormState` y `scheduleReady` dejan de exigir `caseId`.

### Fase 2 — API núcleo
- **Alcance** (`mora-query`, `visible()`, agenda, clientes): cobrador = sus créditos (principal, temporal o apoyo); **supervisor = su agencia** (alcance por sucursal, que ya existe); gerente y administrador = todo. Sale de `credit_assignments` y de la sucursal, no de `cc.assignee_id`. Hoy el supervisor tiene alcance total (D8).
- **Asignación**: `AssignmentService` incorpora **reemplazo temporal** (con vencimiento y regreso automático al principal) y **ayuda** (segundo cobrador); asignan supervisor de la agencia, gerente y administrador; al reasignar se traspasa lo agendado sin ejecutar (D10). Es el «apoyo temporal» que el plan de asignación original dejó fuera.
- **Permisos**: se separan `case:assign` / `case:close` y se renombran `case:*` → `collection:*` (ver «Permisos»); coexistencia de nombres hasta la fase 6.
- **Categorías de mora**: servicio que calcula la categoría por días + configuración vigente, y API de administración (listar, editar rangos con validación de huecos y solapes).
- **Castigo**: el endpoint de castigar/revertir escribe `written_off_*` y deja constancia en la auditoría; el importador PSF (`CASTIGADO`) la marca.
- `POST /mora/:creditId/activities`: **deja de abrir caso**; escribe `credit_activities`; actualiza `last_action_at`. Un solo validador para todas las vías (`validateRecoveryActivity`).
- **Promesas**: una sola función de creación (la de Agenda: valida monto y catálogo, recordatorio de 24 h, asignado = responsable del crédito); «Registrar acción» la usa.
- **Agenda** por crédito: `create` recibe `creditId`; `clientContext` lista **todos** los créditos del cliente en alcance; `complete` escribe `credit_activities`; `agendaItemId` opcional al registrar una acción para cerrar el ítem.
- Prioridad por episodio: recalculo diario sobre episodios abiertos; endpoint de pin sobre el crédito.
- Atajos de compatibilidad: `/cases/*` queda como **shim** que resuelve el crédito por el caso (para el móvil ya instalado y su cola offline).

### Fase 3 — API consumidores
- `payments`: sin `caseId`; el cierre por pago total ya lo cubre el estado del crédito + trigger de episodios.
- `field-ops` (visitas): `creditId` en vez de `caseId`; escribe `credit_activities`.
- `routes`: generar y paradas por crédito (`credit.assigned_manager_id = cobrador`); `route_stops.credit_id`.
- `notifications` y `promise-due`: `creditId`, destinatario = responsable; eventos `case.*` → `credit.*`.
- `analytics`: «casos activos» → «créditos en mora» (episodios abiertos); `collectorPerformance` por responsable.
- `clients`: timeline y filtro de cobrador por crédito; PDF.
- `credits`: se elimina `openCase` y la agenda «Cobrar cuota» ligada al caso; `markArrears`/`clearArrears` ya no abren/cierran casos.
- `arrears job`: solo recalcula días de mora y prioridad de episodios abiertos; **desaparecen** `openCaseIfNone`, `closeOpenCases` y `reopenAbsentCase` (el trigger de episodios ya maneja ausencia y reaparición).
- **Recordatorio de cuota** (D11): a partir del cronograma de los créditos del sistema; en importados, a partir de la fecha de próximo pago del reporte si no está viejo.
- **Ausente del reporte** (D9): la ficha indica que ya no aparece y que pudo ponerse al día o cancelarse; se sigue pudiendo registrar acciones y agendar.
- Se eliminan `slaDueAt`, el filtro «SLA vencido» y el filtro «sin gestión desde» (D2, D1-d); `lastActionAt` queda como dato.
- `exports`, auditoría (`entity: 'case'` → `'credit_activity'`), seeds y scripts (`seed*.ts`, `audit-psf.ts`).

### Fase 4 — Web
- **Administración → «Categorías de mora»**: pantalla para editar los rangos (D1-b).
- **Situación del crédito** en lista, ficha y cartera: chip **Al día / En mora** + «Categoría B · 47 días de mora» + **Castigado** aparte; «Última gestión» y «Promesa vigente» como datos sueltos, no como estado. Filtros: situación, categoría, castigado, responsable, agencia.
- **Responsable**: «Agregar ayuda» y «Cambiar temporalmente» en la ficha y en las acciones masivas.
- Nav: la clave `cases` pasa a `mora`; el filtro «Cobrador del caso» y `collectorId` se reemplazan por `managerId`.
- `mora/page` + `arrears-table`: sin columnas ni filtros de caso; prioridad y cobrador desde crédito/episodio; acciones masivas por `creditIds`.
- `mora/[creditId]`: se borran `OpenCaseButton`, `CaseActions`, `StatusControl`; etapa derivada en el resumen; la misma ficha se ofrece desde `cartera/[id]/credito/[cid]` para créditos al día (D4).
- `agenda/new-task-modal`: manda `creditId`, lista todos los créditos del deudor.
- `pagos`, `rutas` (planificador, editor, parada), `dashboard` (KPI «casos activos», tabla de cobradores), exportar, `cartera/[id]/cases-section`.
- Se borran `app/api/cases/**` y `lib/cases.ts`; se renombra el namespace i18n `panel.cases` (351 claves) a `panel.mora`; los pocos grupos propios del caso (estado, prioridad, `bulkWithoutCase`) se eliminan.
- Tests: ~22 archivos a revisar (7 con referencias reales).

### Fase 5 — Móvil
Orden dentro de la fase (cada paso deja la app funcionando y con la cola intacta):
1. **Compatibilidad primero**: la app empieza a mandar su versión (`x-app-version`); el servidor mantiene los atajos (ver «Offline»). Nada se borra todavía.
2. **Migración de la cola al arrancar** (antes de cualquier limpieza de caché): reescribe los ítems con `caseId` a su forma por crédito.
3. `mora/[creditId]` (ya por crédito) pasa a ser la base: la traza (`registrarRastro`) y el pago dejan de depender de `detail.case?.id`.
4. `cobranza.tsx`, `hydrate` y búsqueda offline leen créditos del responsable (incluidos los **al día**) en vez de `listCases`; `groupPortfolio` se adapta a filas por crédito; Home deja de usar `listCases` para la moneda.
5. `cliente/[id].tsx` (GestionSheet, PaySheet, MoraSheet) por `creditId`; la ficha muestra **Al día / En mora**, categoría y castigo, y los créditos donde el cobrador es **temporal o de apoyo** aparecen en su cobranza.
6. `agenda/crear`, `rutas/crear`, `rutas/resultado`, `route-draft` por crédito (con migración o descarte del borrador).
7. `SCHEMA_VERSION` 3 (borra solo la caché, nunca la cola) **después** de que la migración del paso 2 haya corrido.
8. **Paridad con la web** (auditoría 2026-10-03), sobre el modelo por crédito:
   - *Cartera*: aviso de **duplicado al crear un cliente** (`/clients/duplicate-check`, en línea y contra la cartera local sin señal); **adjuntos** del cliente (ver y subir foto de carnet/contrato); bloque de solo lectura de **garantes y garantías** en la ficha; aviso «posible duplicado, revisa en el panel» para clientes provisionales (`linkReviewPending`); chip **PSF** en la lista; mostrar documento, fecha de alta y método de mora en la ficha.
   - *Mora*: **historial de mora** (episodios) en la ficha; **métricas de recuperación** (`computeRecoveryMetrics`); gestiones con el **formato de tarjeta** (icono por tipo, rojo si no se logró); promesas con `summarizePromises` y el **mismo color por estado que la web**; pagos con medio, canal, quién registró y total cobrado; notas con color, tipo y autor (crear sigue siendo lo principal; editar/borrar solo si el rol puede); avisos PSF de **dato viejo y ausente** con el mismo texto; filtros de rango de mora, saldo y fuente; la validación de la gestión con `validateRecoveryActivity` (fecha no pasada) y `bankCode` en la promesa.
   - *Importación*: la **pantalla de resultado** muestra los ausentes y los que volvieron (hoy muestra «Al día», que da 0 con la regla por defecto); **historial de importaciones** (lista y detalle, ya existen los endpoints; la decisión de diferirlo quedó obsoleta); en la vista previa, «ya aplicado» con fecha y autor y el recuento de **ignorados**; opción «asignar todo a mí» cuando un crédito nuevo no trae sugerencia (hoy es un callejón sin salida que manda al panel web).
9. Tests (~12 archivos, 8 con uso real) y los planes de `docs/epics/F10`.

### Fase 6 — Contracción y seed nuevo (irreversible, autorizada)
- Migración que borra `collection_cases`, `case_activities`, `case_id` de todas las tablas, enums `CaseStatus`/`CasePriority`/`CaseActivityType`, el índice único parcial de un caso abierto, `credit_assignments.case_id` y su predicado, y el estado `WRITTEN_OFF` del crédito (ya vive en `written_off_at`).
- Eliminar `modules/cases`, `case-transitions`, `case-lifecycle`, `byCase`, los tipos y enums de shared; quitar los nombres viejos de permisos `case:*`; actualizar `CLAUDE.md` de api/database/shared/mobile y la lista de tablas RLS (`001_enable_rls.sql`, `verify_isolation.sql`).
- **Se recrea la base de dev** (`prisma migrate reset`, con backup previo) y se corre el **seed nuevo**.
- Verificación final (`db:audit`, tests de las tres apps y type-check).

#### Seed nuevo
Reemplaza los seeds actuales (`seed.ts`, `seed-bulk.ts`, `seed-day.ts`) por uno coherente con el modelo sin caso. Re-ejecutable. Fechas **relativas a la fecha en que se corre** (nunca fijas).
- **Cuenta demo** con sus usuarios de siempre (administrador, gerentes, supervisores de **dos agencias**, cobradores), permisos nuevos `collection:*` y las **categorías de mora** A/B/C iniciales.
- **Créditos creados en la app (Kobrax)**: con cronograma y pagos; al día, en mora de distintas categorías (A, B y C) y uno **castigado**; con su recordatorio de cuota.
- **Créditos importados (PSF)**: operaciones con la forma de los reportes (datos **anonimizados**, nunca nombres reales) de `docs/flows/psf-diario`, asesor CQE vinculado a un cobrador, uno **ausente del reporte**, uno con **dato viejo**, historial de importaciones con detalle por registro, cliente provisional para «Revisar vínculo».
- **Un crédito en mora «completo»**: al abrir su ficha **todo está lleno**: gestiones variadas (llamada, visita, mensaje, nota; con resultados logrados y fallidos), promesas en todos los estados, **notas post-it** en todas las secciones y colores, pagos con distintos medios y canales (Kobrax y entidad), **historial de 3 episodios**, persona con garante, familia, compañero y vecino, garantías, contactos y direcciones con coordenadas, responsable con **ayuda** y un **reemplazo temporal** vigente.
- **Agenda**: **un solo ítem vencido** y, para **la semana siguiente**, ítems **de distintos tipos y días** (llamada, visita, WhatsApp, recordatorio y promesa de pago).
- Cartera suficiente para que las listas, filtros y la analítica se vean con volumen razonable (decenas, no miles).
## Offline: detalles y huecos

> **Alcance dev-only (2026-10-03):** no hay teléfonos con colas reales. Del bloque B se **descartan** los atajos del servidor, la versión mínima y la migración con pérdida de `case.activity`; basta subir `SCHEMA_VERSION` y **borrar también la cola** al actualizar. Los huecos del bloque A (idempotencia) se corrigen igual, y la sección «Limpieza» sigue valiendo.

Revisión de la capa offline sobre `f10/mora` (cola, caché, hidratación). Leído en el código, no ejecutado.

### Cómo funciona hoy (lo que hay que respetar)

- Cola en SQLite: `queue(kind, payload JSON, idempotency_key, attempts, last_error)`. El payload es `JSON.stringify` de la acción y se lee con `JSON.parse` **sin versión ni validación** (`queue.ts:255`). Orden FIFO por id; sin grafo de dependencias.
- Reintento: 3 intentos; cualquier 4xx salvo 408/429 es **rechazo permanente** (queda «Rechazado» para siempre, con reintento manual). 401 y error de red detienen todo el drenaje.
- `SCHEMA_VERSION` borra solo la caché, **nunca la cola**; la caché también se borra al cerrar sesión y al cambiar de usuario o cuenta.
- Ítems de la cola y qué llevan:

| Tipo | Referencia al caso / crédito |
|---|---|
| `case.activity` | **solo `caseId`** (sin `creditId` ni `id`) |
| `visit` | `input.caseId?`, `routeStopId?`; el pago y la promesa embebidos llevan `creditId` y `caseId` |
| `agenda.create` | `caseId` y `creditId` (sin `id`) |
| `payment` | `creditId`, `caseId?` (con llave de idempotencia) |
| `mora.activity`, `credit.note` | `creditId` + `id` del teléfono |
| `agenda.complete / postpone / cancel / reschedule` | solo el id de la agenda |
| `client.create`, `credit.create`, `arrears.*`, `route.status` | sin caso (`credit.create` fuerza `openCase: true`) |

### A. Huecos que ya existen y la migración no debe heredar

Se arreglan **antes** de la fase 1 (fase 0):

1. `case.activity` **no es idempotente** (no manda `id`): reintentar duplica la gestión y la promesa. Los tipos nuevos (`mora.activity`, `credit.note`) ya mandan `id`.
2. `agenda.create` **no tiene `id` del cliente**: un reintento tras respuesta perdida crea otro ítem y otro recordatorio.
3. `POST /visits` **no es idempotente**: respuesta perdida = estado 0 = «sin señal» = se reenvía y se duplica la visita.
4. `agenda.postpone` **no es idempotente** (corre la hora dos veces) y `agenda.complete` reintentado da 4xx aunque ya se hizo (queda «Rechazado» en falso).
5. `apiFetch` convierte **todo** fallo en estado 0, incluido el timeout de 15 s con el servidor ya procesando. Es la causa raíz de 1 a 4.
6. **Pago, foto o promesa dentro de una `visit` se pierden en silencio**: `send()` ignora el resultado y desencola la visita. En línea, `resultado.tsx` solo avisa con un cartel y **no encola** lo que falló.
7. Un `kind` desconocido o un payload corrupto **rompe el drenaje completo** (`send()` devuelve `undefined` y se lee `r.status`) y bloquea la cola en cada ciclo. No hay botón para descartar un ítem rechazado.
8. Pagos sin recuperación de carrera en la unicidad de la llave (da 500 en vez de devolver el pago existente).
9. Borrador de ruta: **no se separa por usuario, no se borra al cerrar sesión**, y `createRoute` no tiene llave de idempotencia (un reintento crea dos rutas).
10. Un cliente o crédito creado sin señal **no aparece en la caché**: no se puede registrar nada sobre lo recién creado hasta sincronizar.
11. Editar cliente, contactos y ubicaciones no se encola: se pierde la edición sin señal.
12. La foto se guarda como URI, no como archivo: si el sistema limpia la caché antes del envío, la foto se pierde y la visita igual se desencola.
13. Caché: `listOverdue` usa el mismo scope para `limit=1` (Home) y `limit=100` (agenda) y se pisan; sin señal devuelve `total = filas`; «cobrado hoy» ignora los pagos encolados.
14. La app **no manda su versión**: el servidor no puede detectar clientes viejos.

### B. Lo que exige el cambio

**Contrato del servidor** (todo idempotente por `id` del cliente):

- `POST /credits/:creditId/activities` (o el de mora): `{id, type, result, notes, promise}`, **sin abrir caso**.
- `POST /agenda` con `creditId` e `id` propio; un reintento devuelve el ítem existente.
- `POST /visits` con `creditId` (+ `routeStopId` opcional) e `id` o llave.
- Paradas de ruta por `creditId`; `GET /payments?creditId=` (ya existe).
- **Atajos de compatibilidad** durante N versiones: `POST /cases/:id/activities` (resuelve el crédito en el servidor) y aceptar `caseId` en `visit`, `agenda.create` y `payment` ignorándolo. Ya existe `GET /mora/by-case/:caseId` como base.
- Cabecera `x-app-version` y, si hace falta, **versión mínima** que corte clientes demasiado viejos con un mensaje claro.

**Migración de ítems ya encolados** (al arrancar la app, **antes** de borrar caché):

- `payment`: ya trae `creditId`; se ignora el `caseId`.
- `agenda.create`: trae ambos; se descarta el `caseId` y se le agrega un `id`.
- `visit`: derivar el `creditId` por el pago embebido o por la parada; si no se puede, queda con el atajo del servidor.
- `case.activity`: **no tiene `creditId`**. Se busca `caseId → creditId` en las cachés `case` y `case.detail`, y se reescribe como actividad por crédito con **`id` nuevo**. La caché solo tiene lo último hidratado, así que esta migración **es con pérdida**: lo que no se resuelva sigue por el atajo del servidor y no se borra.
- Regla de oro: **no quitar un tipo de `send()` ni de `ACTION_LABEL` mientras pueda haber ítems viejos en un teléfono.** Hoy un tipo desconocido rompe el drenaje (hueco 7): primero se arregla eso, para que un tipo desconocido pase a «no soportado», visible y descartable.
- Se añade **versión al payload** de la cola para que la próxima migración no dependa de adivinar.

**Mapeo preventivo → episodio:** el cliente **no manda** episodio; el servidor lo resuelve al escribir (el episodio abierto en ese momento, o ninguno). Una acción preventiva encolada antes de que el crédito entre en mora queda sin episodio, y está bien.

### C. Casos borde a probar

- **Crédito reasignado o fuera de alcance mientras no había señal:** mora y agenda dan 404 → rechazo permanente genérico. Debe decir **qué** pasó («ya no es tu crédito») y ofrecer descartar.
- **El crédito sale de la mora (pago total) mientras tanto:** hoy una promesa o un `agenda.create` encolado para ese caso da 4xx. Sin caso, ya no debería fallar.
- **Fechas:** un `agenda.create` encolado un día y enviado al siguiente se rechaza por «fecha pasada» (el servidor usa el reloj de la cuenta, la app el del teléfono). Definir: si la fecha ya pasó al drenar, se manda igual como vencida o se avisa; nunca se descarta en silencio.
- **Dos dispositivos del mismo usuario:** seguro solo para lo idempotente (con los arreglos del bloque A).
- **Otro usuario inicia sesión en el mismo teléfono:** la cola del primero queda guardada pero invisible; el borrador de ruta no.
- **Versiones mezcladas** (app vieja con servidor nuevo, y al revés).
- **Ítems «Rechazados» antiguos:** pantalla de pendientes con «descartar», y limpieza por antigüedad avisada.

## Limpieza (lo que debe desaparecer al final)

Se borra en la fase 6 (y en la 5 para el móvil), **no antes**, y solo cuando nada lo use. Se verifica buscando `caseId`, `CaseStatus`, `/cases`, `openCase` y `case:`.

- **Base de datos:** tablas `collection_cases` y `case_activities`; columnas `case_id` en `agenda_items`, `payments`, `payment_requests`, `field_visits`, `route_stops`, `notifications`, `credit_assignments` (y su predicado `case_id IS NULL`); enums `CaseStatus`, `CasePriority`, `CaseActivityType` y los valores `CASE_ASSIGNED/UPDATED`; índices parciales `idx_cases_*` y el único «un caso abierto por crédito»; relaciones `cases` en Account, Client, Credit y Branch; las tablas en `001_enable_rls.sql` y `verify_isolation.sql`; el backfill de episodios que lee casos.
- **API:** módulo `cases` completo (service, controller, serializer, errors, dto; `case-priority` se **mueve** al episodio, no se borra), `case-lifecycle`, `MoraService.byCase` y `GET by-case`, eventos `case.*`, errores `CASE_001/002`, entidades de auditoría `case`, `case_portfolio` y `collection_case`, export `cases`, specs asociadas.
- **Shared:** `case.types`, enums `case-*`, `case-transitions`, `CASE_CLOSE_REASONS`, `MoraCaseSummary` y `MoraCaseLookup`, `caseId` en agenda, payment, route, client y realtime, `utils/agenda` (que exige `caseId`), `route-day`.
- **Web:** `app/api/cases/**`, `lib/cases.ts` (+ test), `open-case-button`, `status-control`, `case-actions`, `cases-section`, el redirect `/mora/by-case` y `MoraCaseLookup`, claves i18n propias del caso, el KPI «casos activos», `caseStatus` y `hasCase` en filtros, `collectorId` en cartera.
- **Móvil:** `cases.service.ts`, `trace.ts` por caso, `ficha.queuedPayments(caseId)`, tipos de caché `case` y `case.detail`, tipo de cola `case.activity` (cuando ya no quede ninguno), `caseIds` y `clientByCase` del borrador, etiquetas duplicadas («Gestión registrada» y «Gestión de mora registrada»), el tipo de caché `credit` sin uso, la columna `idempotency_key` de la cola si sigue sin leerse.
- **Seeds y scripts:** `seed.ts`, `seed-bulk.ts`, `seed-day.ts`, `audit-psf.ts` (actualiza `closed_reason`), pruebas de integración de importación.
- **Docs:** `CLAUDE.md` de api, database, shared y mobile (el de móvil dice WatermelonDB pero el código usa SQLite), `docs/epics/F10/plans/*` (cartera, agenda, rutas, P6, mora, BASE-INVENTORY, ui-screen-map), `README` de database.
- **Ramas y entorno:** borrar `feat/sin-caso`, `f10/mora` y `feat/mora-central-f1` (ya están en `dev`) solo con permiso de la usuaria; quitar los atajos de compatibilidad cuando la versión mínima de la app los deje de necesitar.

## Riesgos

1. **Cola offline del móvil**: al ser solo desarrollo, se borra con el esquema local (ver «Alcance de entrega»). Los reintentos duplicados se evitan con los ids de la fase 0.
2. **Una sola mora abierta por crédito**: hoy lo impone el índice único del caso; el episodio no tiene esa restricción. Revisar si hace falta un único parcial en `credit_arrear_episodes`.
3. **Alcance (D8)**: cambia lo que ve el supervisor; probar con datos reales antes de activarlo.
4. ~~Ramas sin mergear~~ resuelto: ya están en `dev`.
5. **Analítica**: los números de «casos activos» y de rendimiento por cobrador cambian de definición; avisar y no comparar series.

## Tamaño (estimación a ojo, una persona)

~38 referencias en el schema; ~1.500 líneas del módulo `cases` más ~15 módulos de API; ~42 archivos de código en web (+351 claves i18n y ~22 tests); ~32 archivos en móvil; ~25 en shared.
Fases 0: 2–3 días (huecos de idempotencia) · 1: 2 · 2: 6–7 (suma asignación temporal y ayuda, categorías, castigo y renombre de permisos) · 3: 4–5 · 4: 5–6 (suma la pantalla de categorías) · 5: 5–6 · 6: 2. Total: **unas 5 a 6 semanas**.

## Qué no cambia

- Responsable del crédito, historial de asignaciones, episodios de mora y su trigger, notas del crédito, pagos de PSF (D3 de PSF), reglas de importación.
