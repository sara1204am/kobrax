# F4/11 · Agenda operativa: plan por etapas

Estado: **implementado** (2026-10-07), sin commitear. Resultado por etapa en §9. Parte del análisis en
[`10-agenda-operativa.md`](./10-agenda-operativa.md): los números de problema (P#) de abajo remiten a su sección 3.

**Objetivo.** Que la Agenda deje de ser un calendario donde se guardan cosas y pase a ser el sistema que dice qué hay
que hacer, deja hacerlo, registra qué pasó y mantiene sincronizados Agenda, Historial, Rutas, Web y Móvil.

## 0. Decisiones tomadas

| # | Decisión | Efecto |
|---|---|---|
| D1 | **No se desactiva a un usuario que tenga gestiones pendientes.** Para desactivarlo, esas gestiones se pasan antes a otro usuario. | Etapa 5: bloqueo con conteo y flujo «reasignar y desactivar». |
| D2 | **Reasignar una gestión: solo quien la creó.** Misma regla que editar y eliminar. | Etapa 5: `PATCH /agenda/:id` con `assigneeId`, con `assertCreator`. |
| D3 | **Toda visita lleva ubicación y domicilio.** Al crear una ruta, las visitas agendadas ingresan a la planificación. | Etapa 1: validación al agendar + ingreso automático a la ruta (ver §0.1). |
| D4 | **Notificaciones locales del móvil: más adelante.** | Fuera de este plan; ver §8. |

### 0.1 Cómo se interpreta D3 (confirmar al empezar la Etapa 1)

- **«Ubicación y domicilio»:** agendar una `VISIT` exige una dirección del cliente **con coordenadas** (latitud y
  longitud) y con texto de domicilio. Hoy `assertReferences` solo comprueba que la dirección sea del cliente. Los
  clientes importados sin coordenadas deberán marcarse en el mapa antes de agendarles una visita (el selector de
  ubicación del modal ya lo permite).
- **«Debe ingresar a la planificación»:** al generar la ruta de un cobrador para un día, **todas sus visitas
  pendientes de ese día entran como paradas**, sin tener que elegirlas. Se suman a las paradas por mora (como hoy) y,
  si el crédito ya iba por mora, la parada es una sola y lleva el vínculo con la visita.

## 1. Principios (no se tocan)

- `AgendaItem` = intención y compromiso. Fuente de verdad del estado, el responsable y la fecha.
- `CreditActivity` = hecho histórico (qué ocurrió, cuándo, quién, resultado, nota).
- `RouteStop` = contenedor operativo de una visita.
- Cuatro estados persistidos: `SCHEDULED`, `EXECUTED`, `CANCELLED`, `RESCHEDULED`. «Vencida» y «En ruta» se derivan.
- Una sola ejecución (una sola actividad) por gestión, y siempre en una transacción.

## 2. Orden de las etapas

```
E1 Visita↔Ruta↔Agenda ──▶ E2 Integridad de la gestión ──▶ E3 Web operativa
                                                              │
                          E4 Notificaciones web ◀─────────────┤
                          E5 Equipo (reasignar, carga, baja) ◀┘
                          E6 Móvil (offline, acciones, día civil)
```

E1 es P0 y lo demás depende de él en el modelo de datos. E3 y E6 pueden avanzar en paralelo una vez cerrada la E2.
Cada etapa se entrega con sus tests, sin commit hasta que se revise.

---

## Etapa 1 · Visita ↔ Ruta ↔ Agenda (P0)

**Problemas que cierra:** P1, P2.

**Base de datos**
- Migración: `route_stops.agenda_item_id` (`String?`, referencia suave, índice `[accountId, agendaItemId]`). Sin RLS
  nueva: la tabla ya la tiene.
- **Unicidad:** a lo sumo una parada **activa** por gestión (índice único parcial sobre `agenda_item_id` donde la parada
  no está `SKIPPED` ni la ruta `CANCELLED`). Evita que una visita entre a dos rutas.

**API**
- `AgendaService` (alta y edición de `VISIT`): exigir dirección con `latitude` y `longitude` y domicilio no vacío →
  nuevo error `AGENDA_013` («La dirección necesita ubicación en el mapa»).
- `RoutesService.generate`: además de `creditIds` / mora, traer las **visitas pendientes** del cobrador para
  `plannedDate` y crearlas como paradas con `agendaItemId`. Si el crédito ya está en las paradas por mora, una sola
  parada con el vínculo. Orden y distancia por el mismo cálculo actual.
- `FieldService.createVisitOnce`: si la parada tiene `agendaItemId`, **en la misma transacción** crear `FieldVisit`,
  una única `CreditActivity` `VISIT`, enlazar `resultActivityId` y pasar el agendado a `EXECUTED`. Si el agendado ya no
  está pendiente (cancelado, reagendado o ejecutado), registrar la visita igual y no tocarlo.
- `AgendaService.complete` sobre una `VISIT` vinculada a una parada activa: rechazar con un error claro que indique
  hacerlo desde la parada (para no crear una segunda actividad ni perder GPS y evidencia). Una `VISIT` sin parada se
  ejecuta como hoy.
- `AgendaService.reschedule` / `cancel` / `remove` sobre una gestión con parada: ruta `PLANNED` → quitar la parada y
  renumerar `sequenceOrder`; ruta `IN_PROGRESS` → parada `SKIPPED`. Al reagendar, la nueva gestión queda pendiente y
  vuelve a entrar a la planificación del día al que se mueva.
- Relleno de datos: las visitas pendientes ya existentes no necesitan migración; entran la próxima vez que se genere
  una ruta de su día.

**Web y móvil**
- Planificador (`route-planner`, `app/api/routes/plan/route.ts`): marcar en la lista las paradas que vienen de una
  visita agendada (insignia «Agendada») y mostrar el domicilio.
- Móvil (`app/rutas/resultado.tsx`, `routes.service.ts`): sin cambios de contrato; el vínculo lo resuelve el servidor.
  Mostrar «Agendada» en la parada.

**Archivos principales:** `schema.prisma`, `routes.service.ts`, `field.service.ts`, `agenda.service.ts`,
`agenda.errors.ts`, `routes.serializer.ts`, `new-task-modal.tsx`, `components/route-planner/*`.

**Tests:** integración (`apps/api/test/integration`): visita agendada → ruta → parada → ejecución ⇒ exactamente **una**
`CreditActivity`, agendado `EXECUTED`, una `FieldVisit`. Unitarios: reagendar/cancelar con parada en ruta planificada y
en curso; visita sin coordenadas rechazada; ejecutar desde Agenda una visita vinculada rechazado; doble entrada a ruta
rechazada.

**Riesgos:** clientes importados sin coordenadas (se bloquea agendar visita hasta marcarlos); rutas ya generadas que no
incluyen visitas nuevas (se regeneran con «actualizar»); concurrencia entre ejecutar desde ruta y reagendar (la
transacción vuelve a leer el estado).

**Aceptación:** una visita agendada aparece en la ruta de su día sin elegirla; ejecutarla en la parada cierra la
gestión con una sola actividad; reagendarla o cancelarla la saca de la ruta.

---

## Etapa 2 · Integridad de la gestión (P0)

**Problemas que cierra:** P5, P12, P15, y la parte de trazabilidad de cancelar.

- **Reagendar conserva la hora.** El modal (`item-actions.tsx`) hoy fuerza `LAPSE` + `MORNING`. Pasa a precargar el
  modo, la hora o la franja originales y dejarlos editables. El DTO ya los acepta.
- **Promesas coherentes.** `reschedule` actualiza `details.promiseDate` de la copia al nuevo día; recrea el recordatorio
  de 24 h de la nueva fecha (si procede) y **cancela** el del original. Cancelar, eliminar y ejecutar una promesa
  cancelan su recordatorio (vínculo por `details.promiseReminderOf` o consulta por crédito + tipo + fecha; elegir el
  más simple al implementar).
- **Resultado visible.** `findOne` devuelve el resultado de la ejecución: resultado, nota, quién y cuándo (desde
  `resultActivityId`), y el motivo con su etiqueta del catálogo para cancelada y reagendada, más el id de la gestión
  relacionada (anterior / siguiente) para enlazar. El detalle web lo muestra; la línea de tiempo muestra el resultado
  en la fila y el monto en las promesas.
- **Línea de tiempo ligera:** separar «Próximas» e «Historial», máximo 10 filas con «ver más».
- Cancelar ≠ eliminar: se mantiene (cancelar deja rastro; eliminar es solo de lo cargado por error, y solo el creador).

**Archivos:** `agenda.service.ts`, `agenda.serializer.ts`, `agenda.types.ts` (shared), `[id]/page.tsx`,
`item-actions.tsx`, `lib/agenda.ts`, `messages/*.json`.

**Tests:** reagendar conserva hora exacta y franja; promesa reagendada mantiene `promiseDate` y recordatorio; cancelar
cancela el recordatorio; el detalle de una ejecutada trae resultado y nota.

**Aceptación:** una gestión ejecutada muestra qué pasó; reagendar nunca pierde la hora; no quedan recordatorios huérfanos.

---

## Etapa 3 · Web operativa (P0/P1)

**Problemas que cierra:** P11, P13, P14.

- `/` redirige a `/agenda` cuando el rol no tiene `report:read` (cobrador).
- `GET /agenda/summary` (nuevo, `agenda:read`): pendientes de hoy, vencidas, próxima gestión y las siguientes 5, con el
  día civil del tenant. Lo usan el Inicio, el contador del menú y, después, el móvil. Para `agenda:assign`, además la
  carga por cobrador (se reutiliza en la Etapa 5).
- Inicio: bloque **«Agenda de hoy»** (pendientes, vencidas, próxima, 4–5 siguientes, «Ver agenda»).
- Menú lateral: contador en «Agenda» = **vencidas + pendientes de hoy** del usuario (de `summary`, que ya usa el día
  civil del tenant: no cambia por zona horaria).
- Agenda: vista por defecto **Hoy**; añadir **Semana** (Hoy / Semana / Mes); el filtro de cobrador y el de tipo afectan
  también a las vencidas; avisar cuando hay más de las 50 que se traen.
- Menú ⋮ contextual por tipo: Llamada → «Copiar teléfono»; WhatsApp → «Abrir WhatsApp» (`wa.me`); Visita → «Ver
  ubicación»; el resto, igual. Se omite «Llamar por `tel:`» en web (sin uso en escritorio).

**Archivos:** `app/page.tsx`, `dashboard/page.tsx`, `components/panel-shell.tsx`, `lib/nav.ts`, `agenda/*`,
`agenda.controller.ts`, `agenda.service.ts`.

**Tests:** redirección del cobrador; bloque «Agenda de hoy» y contador; vista por defecto; filtros sobre vencidas;
menú por tipo.

**Aceptación:** un cobrador que entra por la web llega a su agenda; el Inicio responde «¿qué tengo que hacer hoy?».

---

## Etapa 4 · Notificaciones web (P1)

**Problemas que cierra:** P9 (web), P10.

- Tipos nuevos: `AGENDA_ASSIGNED`, `AGENDA_CHANGED` (reagendada, cancelada o eliminada por otro usuario),
  `AGENDA_OVERDUE` (resumen).
- `AgendaService` emite el evento (el bus ya está inyectado y sin uso) tras crear con responsable distinto del creador,
  reasignar, y reagendar/cancelar/eliminar hechos por quien no es el responsable.
- Job diario (mismo patrón de `setInterval` de los otros jobs, con el día civil del tenant): un resumen por responsable
  con vencidas, sin duplicar el mismo día.
- Campanita: al hacer clic navega a `/agenda/:id` (o `/agenda` en el resumen), y se actualiza sola (polling cada 60 s
  mientras la pestaña está visible; el socket queda fuera de este plan).

**Archivos:** `notification-type.enum.ts` (shared), `notifications.service.ts`, `agenda.service.ts`,
`panel-shell.tsx`, nuevo job de vencidas.

**Tests:** cada evento genera una notificación al destinatario correcto y ninguna al propio autor; el resumen no se
duplica; la campanita navega.

**Fuera de esta etapa:** push remoto y notificaciones locales del móvil (§8).

---

## Etapa 5 · Equipo: reasignar, carga y baja de usuarios (P1)

**Problemas que cierra:** P3, P4, P16.

- **Reasignar una gestión (D2):** `PATCH /agenda/:id` acepta `assigneeId`, **solo el creador** (`assertCreator`),
  con la misma validación de destinatario que el alta (cobrador o supervisor activo del alcance). Web: campo
  «Responsable» en el modal de edición. Emite `AGENDA_ASSIGNED`.
- **Carga por cobrador:** una vista simple (tabla) en `/agenda` o en el Inicio para `agenda:assign`: por cobrador,
  pendientes, vencidas y de hoy, desde `GET /agenda/summary`.
- **Baja de usuario (D1):** `PATCH` de miembro con `isActive:false` se rechaza (`USER_HAS_PENDING_WORK`, 409) si tiene
  gestiones pendientes, créditos a su cargo o paradas en rutas planificadas, con el conteo de cada uno. Se agrega
  `reassignToUserId` opcional: con él, en **una sola transacción**, se pasan sus gestiones pendientes, sus créditos
  (por el servicio de asignaciones, que ya mueve la agenda) y sus rutas planificadas al destinatario válido y luego se
  desactiva. El modal de baja del equipo ofrece elegir ese destinatario.
- **`handOffAgenda` completo:** mover también las gestiones con responsable explícito distinto del anterior cuando el
  crédito cambia de responsable, y cubrir el primer responsable de un crédito sin responsable.
- Los recordatorios automáticos (sin creador) pueden eliminarse por el responsable (excepción acotada a `createdBy`
  nulo), para resolver P22.

**Archivos:** `users.service.ts`, `assignment.service.ts`, `agenda.service.ts`, `dto/agenda.dto.ts`, `equipo/*` (web),
`new-task-modal.tsx`.

**Tests:** baja rechazada con trabajo pendiente y aceptada con destinatario; la transacción es atómica; reasignar solo
por el creador; `handOffAgenda` con responsable explícito y primer responsable; carga por cobrador por alcance.

**Aceptación:** nadie queda con gestiones a nombre de un usuario inactivo; el manager ve y mueve la carga.

---

## Etapa 6 · Móvil (P1)

**Problemas que cierra:** P6 (móvil), P17–P21.

- **Día civil del tenant:** el móvil pide `hoy` al servidor (en `/agenda/summary` o con la zona de la cuenta) en vez de
  `todayISO()` UTC. Revisar también `utcToday()` en `agenda.tsx` y los contadores del Inicio.
- **Offline completo:** `hydrate.ts` descarga los **detalles** (`getItem`) de hoy y de los próximos 7 días, con
  teléfono, dirección, mensaje y lo necesario para ejecutar.
- **Optimista:** al ejecutar, cancelar o reagendar sin conexión, actualizar de inmediato la caché de lista y detalle y
  los contadores (`optimistic.ts` hoy no cubre agenda).
- **Conflictos comprensibles:** mapear 409/404 de la cola a un mensaje («Esta gestión fue modificada por otro usuario»)
  con acciones «Actualizar» y «Descartar».
- **Lista de agenda:** acciones rápidas (Llamar, WhatsApp, Navegar), responsable y «Asignada por» en la fila, tile de
  **Vencidas pulsable**, vencidas arriba y sin el tope de 2.
- **Detalle:** mostrar Llamar y WhatsApp a la vez cuando hay ambos datos; WhatsApp nunca registra por sí solo (ya es así),
  y al volver se ofrece «Registrar ejecución».
- Visita vinculada a una parada: «Ver en la ruta» en lugar de ejecutar desde el detalle (coherente con la Etapa 1).

**Archivos:** `app/(tabs)/index.tsx`, `agenda.tsx`, `app/agenda/[id].tsx`, `src/sync/hydrate.ts`,
`src/sync/optimistic.ts`, `src/sync/queue.ts`, `src/home.ts`, `packages/shared/src/utils/agenda.ts`.

**Tests (jest):** hidratación de detalles; actualización optimista de lista y contadores; mapeo de errores de la cola;
día civil con zona de Bolivia y cambio de día; tile de vencidas.

**Aceptación:** una gestión descargada se ve y se ejecuta sin conexión, y la pantalla cambia al instante.

---

## 3. Zona horaria (transversal, se reparte en las etapas)

Una sola regla: día civil del tenant (`TenantClockService`). Se corrige donde se toca: recordatorios de cuotas
(`installment-reminders.service.ts`), validación de promesas (`mora.service.ts`), aviso de cuotas
(`promise-due.service.ts`) y el móvil (E6). Tests con la zona de Bolivia (UTC−4) cerca de la medianoche.

## 4. Auditoría (transversal)

Se mantiene `audit.record` fuera de la transacción por diseño del módulo. En los puntos nuevos (ejecución de visita en
ruta, baja con reasignación) la auditoría se escribe **dentro** de la misma transacción cuando el servicio de auditoría
lo permita; si no, queda registrado como deuda técnica y no se cambia el servicio de auditoría en este plan.

## 5. Pruebas y verificación

- API: `node --import tsx --test` por módulo (agenda, routes, field-ops, assignments, users, notifications) y la
  integración con base real (`test:integration`) para el flujo visita → ruta → ejecución.
- Web: `vitest` de agenda, dashboard, panel-shell y rutas; `tsc --noEmit`.
- Móvil: `jest`; `tsc --noEmit`. **No se puede probar en teléfono desde aquí**: lo visual y las acciones externas
  (`tel:`, WhatsApp, mapa) se confirman a mano.
- No hay E2E de navegador ni de móvil en el repo (ni Playwright, Detox ni Maestro). Los nueve escenarios críticos se
  cubren con integración de API + pruebas de componentes; montar E2E reales es un proyecto aparte.
- Cada etapa termina con la suite de su módulo en verde, `type-check` de los paquetes tocados y una nota de lo hecho.

## 6. Datos de prueba

Al cerrar cada etapa que lo necesite, ampliar el seed (`packages/database/prisma/seed.ts`): visitas agendadas con
coordenadas dentro de rutas, una promesa reagendada, una gestión cancelada, una ejecutada con resultado, y un cobrador
con carga para probar la baja. Se carga con `pnpm --filter @kobrax/database db:seed:refresh` (borra y recrea el demo).

## 7. Criterios de aceptación globales

- **Producto:** ninguna gestión importante queda escondida; el usuario sabe qué tiene hoy; ejecutar y reagendar dejan
  trazabilidad; las visitas funcionan con rutas.
- **Web:** el cobrador entra a su agenda; el Inicio muestra «Agenda de hoy»; Hoy/Semana/Mes; vencidas visibles y
  filtrables; el manager ve, asigna y reasigna; el menú depende del tipo; la campanita navega.
- **Móvil:** Llamar, WhatsApp y Navegar desde el detalle y la lista; ejecución offline con datos descargados; contadores
  al instante.
- **Integridad:** una visita ejecutada desde ruta genera una sola actividad; agenda y ruta no divergen; `promiseDate` y
  recordatorios coherentes; día civil único; ningún usuario inactivo con gestiones pendientes.

## 8. Fuera de este plan

- Notificaciones locales del móvil (D4): requieren `expo-notifications`, un build de desarrollo y prueba en teléfono.
  Las gestiones por franja necesitan una hora de aviso por defecto (a definir). Los avisos de asignación con la app
  cerrada necesitan push remoto, hoy un stub.
- Push remoto y socket en tiempo real para la campanita.
- E2E reales de web y móvil.
- Mover `audit.record` dentro de la transacción en todo el sistema.

## 9. Resultado de la implementación

Las seis etapas están hechas, con sus pruebas. Lo que sigue dice qué se hizo, **en qué se apartó del plan** y qué queda.

### Migraciones (2)
- `20261007000000_route_stop_agenda_item`: `route_stops.agenda_item_id` + índice único parcial (una visita, a lo sumo una parada activa).
- `20261007010000_notificaciones_de_agenda`: tipos `AGENDA_ASSIGNED`, `AGENDA_CHANGED`, `AGENDA_OVERDUE` y `notifications.agenda_item_id`.

### E1 · Visita ↔ ruta ↔ agenda ✅
- Toda visita exige una dirección del cliente con coordenadas (`AGENDA_013`); una dirección libre ya no se acepta.
- Al generar una ruta, las visitas pendientes del cobrador para ese día entran solas (primero si la ruta es por mora; al final si quien planifica eligió créditos). Si el crédito ya iba por mora es una sola parada con el vínculo.
- Ejecutar la parada cierra la gestión con **la misma** actividad, en la misma transacción. Ejecutarla desde la agenda se rechaza (`AGENDA_014`) y el detalle (web y móvil) manda a la parada.
- Reagendar, cancelar, eliminar, cambiar de tipo o de responsable mantienen la ruta (planificada: borra la parada y renumera; en curso: la deja salteada). Cancelar la ruta suelta sus visitas.
- Planificador web: cuenta las visitas del día y arma la ruta de quien solo tiene visitas.
- **Desvío:** el armado de rutas del móvil no cambió: el servidor suma las visitas solo.

### E2 · Integridad de la gestión ✅
- Reagendar conserva la hora exacta o la franja (web). Reagendar una promesa mueve `promiseDate`; el recordatorio de 24 h se recrea y el viejo se cancela. Cancelar, eliminar y ejecutar una promesa cancelan su recordatorio (vínculo `details.promiseItemId`). Editar una promesa ya no puede mover su día.
- El detalle trae el resultado de la ejecución (resultado, nota, quién, cuándo), el motivo de cancelar y reagendar, y enlaza gestión anterior y siguiente. Línea de tiempo en **Próximas** e **Historial** con las 8 más recientes y el resto plegado.

### E3 · Web operativa ✅
- `GET /agenda/summary` (pendientes de hoy, vencidas, próximas 5 y, con `agenda:assign`, carga por persona), con el día civil de la empresa.
- El cobrador que no ve el tablero va a su agenda. Inicio: bloque «Agenda de hoy». Menú: contador (vencidas + pendientes de hoy, rojo si hay vencidas). Agenda: **Día / Semana / Mes**; las vencidas obedecen a los filtros y avisan si hay más de las 50 traídas.
- «Hoy» del panel sale del servidor, no del UTC del proceso web.
- **Desvío:** las acciones por tipo (copiar teléfono, abrir WhatsApp, ver ubicación) viven en el **detalle**, no en el menú ⋮ de la lista: el teléfono y la dirección se revelan (y se auditan) solo al abrir el detalle. «Llamar» por `tel:` no se hizo en web (sin uso en escritorio). `whatsappLink` pasó a `shared`.

### E4 · Avisos web ✅
- Eventos `agenda.assigned` / `agenda.changed` (asignar, reagendar, cancelar, eliminar, editar, reasignar por otra persona) y resumen diario de vencidas por responsable (una vez por día civil, solo miembros activos).
- La campanita enlaza a la gestión (o a la agenda), se actualiza cada minuto con la pestaña visible y se cierra al navegar. La notificación del móvil también navega a la gestión.
- **Fuera:** push remoto y socket en tiempo real.

### E5 · Equipo ✅
- Reasignar una gestión (solo su dueño; mismo control de destinatario que el alta), con aviso al nuevo y al anterior. Los recordatorios automáticos (sin creador) son de su responsable.
- Desactivar a alguien con gestiones, créditos o rutas a su nombre se rechaza (`USER_HAS_PENDING_WORK`, con el conteo); con `reassignToUserId` se pasa todo y se desactiva en una transacción (créditos por el servicio de asignaciones, rutas al destinatario o canceladas si ya tiene una ese día, coberturas revocadas). Modal «Pasar el trabajo» en Equipo.
- Carga por persona en el Inicio (con `agenda:assign`).
- **Desvío:** `handOffAgenda` **no se tocó**. Una gestión asignada a propósito a otra persona que no es el responsable del crédito debe quedarse con ella al cambiar el responsable; el análisis lo había contado como problema y no lo es.

### E6 · Móvil ✅
- «Hoy» = día de la empresa (`GET /agenda/summary`) y, sin red, el reloj del teléfono corrido por esa diferencia; nunca UTC.
- Hidratación: hoy, los 7 días siguientes y el **detalle** de las pendientes (hoy primero, tope 60).
- Lo hecho sin señal se refleja ya en listas, contadores y detalle (`agenda-optimistic`).
- Los rechazos de la cola se explican (409 cambió mientras no había señal, 404 ya no es tuya, 403).
- **Avisos locales** (`expo-notifications`): un aviso 15 min antes de cada gestión con hora fija y, para las de franja, al empezar la franja (08:00 mañana, 13:00 tarde, 18:00 noche); se programan al hidratar y al abrir el Inicio, se cancelan al ejecutar, cancelar, reagendar o correr la hora, y al cerrar sesión; tocar uno abre la gestión. El permiso se pide una sola vez.
- **Acciones rápidas en la fila** (Llamar, WhatsApp con el mensaje, Navegar) leídas del detalle ya descargado.
- Vencidas arriba en la Agenda; tiles del Inicio pulsables; Llamar y WhatsApp juntos; «Asignada por» en la fila; «Registrar en la ruta» para visitas en ruta; detalle con el resultado.

### Zona horaria
Corregidos a «día civil de la empresa»: el job de recordatorios de cuotas, aviso `PROMISE_DUE`, el resumen de vencidas, el panel web y el móvil. **Queda:** la validación de «fecha pasada» de una promesa en `MoraService.addActivity` sigue usando «ayer UTC» (más permisiva que estricta; no produce rechazos falsos).

### Pruebas ejecutadas al cerrar
API 1375 · web 809 · móvil 726 · shared 306, todas en verde, más `tsc` limpio en los cuatro paquetes y la integración con base real (visita → ruta → ejecución; reagendar; índice único; baja con traspaso).

### Queda (decidido o fuera de alcance)
- Push remoto: los avisos locales no pueden decirle «te asignaron una gestión» a un teléfono con la app cerrada; eso necesita un servicio de push y los canales del servidor son simulados.
- El módulo `expo-notifications` es nativo: hace falta un build nuevo de la app (no basta recargar) y probarlo en un teléfono.
- E2E de navegador y de teléfono (no hay herramienta en el repo); lo visual y las acciones externas (`tel:`, WhatsApp, mapa) se confirman a mano.
- `audit.record` sigue fuera de la transacción en la agenda (diseño del módulo de auditoría); el traspaso de la baja audita después del commit.
- Clientes importados sin coordenadas: al agendarles una visita el formulario (web y móvil) avisa y deja marcar el punto en el mapa sobre la misma dirección; hasta marcarlo no se puede guardar. (El móvil necesita señal para marcarlo.)
