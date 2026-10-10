# F4/10 · Agenda operativa: análisis del estado real y propuesta

Fecha del análisis: 2026-10-06. Solo diagnóstico: no incluye cambios de código.

**Método.** Se investigó el código real de backend, web y móvil con tres lecturas en paralelo. Los hallazgos
marcados «(verificado)» los comprobó directamente quien escribió este documento; el resto viene de esas lecturas, con
sus referencias a archivo y línea, y conviene confirmarlo al implementar cada pieza.

**Resumen.** La Agenda funciona bien para crear y ejecutar gestiones, pero no logra que el usuario las cumpla: nada
avisa (no hay notificaciones de agenda), las visitas están desconectadas de las rutas, y una visita hecha en ruta deja
la gestión agendada vencida o duplicada.

---

## 1. Estado actual (lo que existe)

- **Modelo:** `AgendaItem` con tipo (5), estado (4: `SCHEDULED`, `EXECUTED`, `CANCELLED`, `RESCHEDULED`) y responsable
  (`assigneeId`). Solo `account` es FK real; crédito, cliente y responsable son referencias suaves. «Vencida» no se
  guarda: se deriva (`SCHEDULED` con fecha anterior a hoy, `agenda.serializer.ts`).
- **Ejecutar:** crea una actividad de bitácora (`CreditActivity`) y enlaza `resultActivityId`. Idempotente si se repite
  con el mismo resultado.
- **Reagendar:** crea una gestión nueva (copia responsable, datos y creador) y deja la original en `RESCHEDULED`.
- **Permisos:** el cobrador ve lo suyo. Con `agenda:assign` (supervisor, gerente, administrador) ve el alcance de su
  agencia o de toda la cuenta (`moraScopeOf`).
- **Reasignación de cartera:** `handOffAgenda` mueve las gestiones pendientes al nuevo responsable.
- **Web:** vistas Día y Mes, vencidas arriba, filtros, menú ⋮, detalle con línea de tiempo.
- **Móvil:** Inicio con hasta 3 próximas y contadores, tira de calendario, detalle con WhatsApp / llamar / navegar, cola
  offline.

## 2. Arquitectura actual del flujo

```
Crear ──▶ AgendaItem (SCHEDULED) ──▶ Ejecutar ──▶ CreditActivity (bitácora)
              │ ├─▶ Reagendar ─▶ item nuevo (el original queda RESCHEDULED)
              │ └─▶ Cancelar
              ╳  (sin vínculo)
Rutas ◀── /mora (créditos en mora)      Visita en ruta ─▶ FieldVisit + CreditActivity
Campanita ◀── pagos, plan, cuotas       (no toca la agenda)
              ╳  (cero eventos de agenda)
```

## 3. Problemas encontrados

### Arquitectura y datos
1. **Visita duplicada o abandonada (verificado).** `field-ops` y `routes` no referencian la agenda en ningún punto.
   Visitar la parada no cierra el agendado `VISIT`, que queda vencido. Si además se ejecuta desde Agenda, hay dos
   actividades `VISIT` del mismo crédito. Y ejecutar desde Agenda no deja evidencia de campo (GPS, foto, parada).
2. **Rutas desconectadas.** La ruta se arma solo desde `/mora` (`routes.service.ts`, `routes/plan/route.ts`). Una visita
   agendada sobre un crédito al día nunca llega a una ruta; sobre uno en mora entra por casualidad, sin trazabilidad.
3. **Usuario desactivado.** `users.service.ts` solo cambia `isActive`: sus gestiones pendientes y sus créditos quedan a
   su nombre, sin job de limpieza. El job de recordatorios sigue creando recordatorios para él.
4. **Reasignación incompleta.** `handOffAgenda` solo mueve gestiones cuyo responsable es el anterior: no mueve las
   asignadas explícitamente a otra persona, ni las de un crédito que recibe responsable por primera vez.
5. **Promesas inconsistentes.** Al reagendar, `details.promiseDate` queda con la fecha vieja. El recordatorio de 24 h no
   se recrea al reagendar y tampoco se cancela al cancelar, eliminar o ejecutar la promesa.
6. **Relojes.** El job de recordatorios, la validación de promesas (`mora.service.ts`) y el aviso de cuotas
   (`promise-due.service.ts`) usan UTC; la agenda usa el día civil del tenant. El móvil usa `todayISO()` en UTC: en
   Bolivia, desde las 20:00, pediría el día siguiente (esto último es inferencia, no prueba).
7. **Auditoría fuera de la transacción.** Si el proceso muere entre el commit y `audit.record`, queda un cambio sin rastro.
8. Sin job que cancele agendados de créditos pagados o castigados; sin FK que impida borrar un crédito o usuario
   referenciado; `GET /agenda` no acota el rango `from`/`to`.

### Producto y UX
9. **Cero avisos de agenda.** El enum de notificaciones no tiene tipo de agenda; `AgendaService` inyecta el bus de
   eventos y no lo usa; los canales de salida son stubs; `expo-notifications` no está instalado. Una gestión asignada
   solo se ve si se abre la app.
10. **Campanita estática.** Carga una sola vez al montar, sin polling ni socket, y al hacer clic no navega a ningún lado
    (`panel-shell.tsx`).
11. **Cobrador en la web (verificado).** `COLLECTOR` no tiene `report:read` y el dashboard lo exige
    (`dashboard/page.tsx:64`): al entrar por `/` cae en «tu rol no ve el tablero» sin enlace a su agenda. Ningún rol
    tiene un bloque de «mi día» en el Inicio.
12. **El resultado de una gestión ejecutada no se ve en el detalle:** ni resultado, ni nota, ni quién ni cuándo; tampoco
    el motivo de cancelar o reagendar.
13. Menú lateral sin contador de pendientes o vencidas.
14. Las vencidas ignoran el filtro de cobrador y están capadas a 50 sin aviso.
15. **Reagendar convierte siempre a franja «Mañana»** y pierde la hora exacta (`item-actions.tsx`).
16. No se puede reasignar una gestión ya creada ni ver la carga por cobrador.

### Móvil
17. Sin conexión solo se descargan hoy y las vencidas; el detalle no se hidrata, así que una gestión nunca abierta con
    red no se puede ejecutar ni ver su teléfono o dirección.
18. Tras ejecutar sin conexión, la lista y los contadores siguen mostrándola pendiente (`optimistic.ts` no cubre agenda).
19. Los conflictos (409 / 404 al sincronizar) quedan como «rechazados» sin explicar el motivo.
20. Las gestiones por franja nunca generan alerta; el tile de vencidas del Inicio no es pulsable y en la Agenda salen al
    final (solo 2 visibles).
21. Enviar WhatsApp (abrir `wa.me`) no registra nada y la hoja no obliga a registrar después.

### Permisos
22. Editar y eliminar solo por el creador: los recordatorios automáticos (sin creador) no los puede eliminar nadie.
23. El supervisor no tiene `user:read` ni `account:read`: quedan vacíos los filtros del dashboard y del planificador de
    rutas, y no ve la configuración de plantillas aunque las use.
24. `complete` no controla propiedad: un supervisor que ejecuta deja la actividad a su nombre, no al del responsable.

## 4. Modelo recomendado

- **`AgendaItem` = intención y compromiso:** qué, cuándo y quién. Única fuente de verdad del estado.
- **Ejecución:** produce exactamente una `CreditActivity`; para visitas además `FieldVisit`. El item la enlaza con
  `resultActivityId`. El historial se lee de la bitácora, no se mezcla con la agenda.
- **Ruta = contenedor de ejecución, no otra lista:** `RouteStop.agendaItemId` (opcional).
  - La ruta se arma desde dos fuentes: créditos en mora (como hoy) y visitas agendadas pendientes (nuevo).
  - Al registrar la visita de una parada con `agendaItemId`: una sola actividad, y el agendado pasa a `EXECUTED`, en la
    misma transacción.
  - Si se reagenda o cancela una gestión que está en una ruta planificada: se saca la parada. Si la ruta está en curso:
    la parada pasa a `SKIPPED`.
- **Estados:** se mantienen los cuatro. «Vencida» (derivada) y «En ruta» (derivada del vínculo con la parada) no son
  estados persistidos.

## 5. Experiencia web recomendada

- **Inicio:** si el rol no ve el tablero, redirigir a `/agenda`. Para el resto, bloque «Agenda de hoy»: pendientes,
  vencidas (lo más importante), próxima gestión y las siguientes 4–5 con hora, y «Ver agenda». Para manager y
  supervisor, carga por cobrador (pendientes y vencidas).
- **Agenda:** por defecto el día de hoy con vencidas arriba; vistas Hoy, Semana y Mes; el filtro de cobrador afecta
  también a las vencidas; contador en el menú lateral.
- **Detalle:** la ejecutada muestra resultado, nota, quién y cuándo; la cancelada o reagendada muestra motivo y enlace a
  la gestión relacionada; reagendar conserva la hora.
- **Campanita:** solo eventos que requieren atención (asignación, cambio hecho por otro, resumen diario de vencidas),
  con enlace al detalle.
- **Rutas:** además de `/mora`, ofrecer «visitas agendadas pendientes» como fuente.

## 6. Experiencia móvil recomendada

Mantener Inicio, detalle y cola. Agregar notificaciones locales (hora exacta, y una hora por defecto para las franjas),
descargar detalles de hoy y de los próximos 7 días, actualizar lista y contadores de forma optimista al ejecutar sin
conexión, calcular «hoy» con el día civil del tenant, explicar los rechazos por conflicto y hacer pulsable el tile de
vencidas.

## 7. Manager vs cobrador

| | Cobrador | Supervisor / Manager |
|---|---|---|
| Crear para sí | Sí | Sí |
| Asignar a otro | No (403) | Sí (supervisor en su agencia, manager en toda la cuenta) |
| Ver agenda | Solo la suya | Del alcance |
| Ejecutar, reagendar, cancelar | Sí | Sí |
| Editar y eliminar | Solo si la creó | Solo si la creó |
| Reasignar una gestión | No existe | No existe (**falta**) |
| Carga y vencidas por persona | No | No existe (**falta**) |

## 8. Matriz de tipos (corregida con el código)

| Tipo | Campos | Se agenda | Se ejecuta | Entra a ruta |
|---|---|---|---|---|
| Llamada | teléfono | Sí | Sí (contactado / sin respuesta / número equivocado) | No |
| WhatsApp | teléfono, mensaje (plantilla) | Sí | Sí (ídem) | No |
| Visita | dirección | Sí | Sí (contactado / no encontrado / dirección equivocada) | **Hoy no**; debería sí |
| Recordatorio | descripción | Sí | Sí (hecho) | No |
| Promesa | monto, fecha, medio de pago | Sí | Sí (cumplida / rota) | No |

## 9. Evaluación de la propuesta UX inicial

**Está bien:** bloque «Agenda de hoy» en el Inicio; Agenda como vista central; campanita solo para alertas; rutas que
consumen visitas de la Agenda; ejecución separada de la creación.

**Se corrige:**
- «Agenda fuente central de todas las gestiones»: lo ejecutado vive en la bitácora; fusionarlas mezclaría plan con hecho.
- Rutas «consumen las visitas»: correcto pero no exclusivo; la fuente de mora debe seguir.
- Campanita con «próximas gestiones»: es ruido en web; su lugar son las notificaciones locales del móvil.
- Falta en la propuesta: el cobrador en la web, el resultado de lo ejecutado, la reasignación y el cierre de la gestión al
  visitar en ruta.

**Innecesario:** estados nuevos, una agenda de visitas aparte, duplicar plantillas (ya se administran desde Cuenta).

## 10. Recomendación por prioridad

1. **Visita ↔ ruta ↔ agenda:** `RouteStop.agendaItemId`, cierre atómico y una sola actividad.
2. **Avisos:** eventos de asignación, cambio por otro y vencidas; campanita que navegue; notificaciones locales en el móvil.
3. **Cobrador en la web:** redirigir a su agenda y «Agenda de hoy» en el Inicio.
4. **Detalle:** mostrar resultado y motivo de lo ejecutado, cancelado y reagendado.
5. **Integridad:** reasignar al desactivar un usuario; completar `handOffAgenda`; sincronizar `promiseDate` y recordatorio
   de promesas; reagendar conservando la hora.
6. **Móvil sin conexión:** detalles y próximos 7 días, actualización optimista, día civil del tenant.
7. **Gestión de equipo:** reasignar una gestión y ver la carga por cobrador.
