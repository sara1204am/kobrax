# Agenda recurrente — cobro diario y gestiones que se repiten

> Diseño propuesto, 2026-10-10. Sustituye la solución provisoria de
> `ia-plan-maestro.md` B6 («visita sugerida al armar la ruta»): se agrega
> recurrencia real a la agenda. No hay código; lo dicho del estado actual se
> verificó en el repo.

## 1. El problema

Hay clientes a los que se cobra **todos los días en su negocio**, o a los que
hay que **recoger la cuota** porque no tienen tiempo. Hoy cada visita habría que
agendarla a mano, una por una.

**Verificado:** `agenda_items` modela **una ocurrencia**: tipo (`CALL`, `VISIT`,
`WHATSAPP`, `REMINDER`, `PROMISE_TO_PAY`), estado (`SCHEDULED`, `EXECUTED`,
`CANCELLED`, `RESCHEDULED`), fecha y hora, y el encadenamiento de
reprogramación (`rescheduled_from_id`). No existe el concepto de «serie».

## 2. Principio de diseño: serie + ocurrencias materializadas

No se cambia el significado de `agenda_items`. Se agrega una **serie** que
*genera* ocurrencias normales.

```
agenda_series  (la regla: «de lunes a sábado, 8:00–10:00, visita en el negocio»)
      │  un trabajo genera, con anticipación, las ocurrencias
      ▼
agenda_items   (cada día, un ítem normal; mismo flujo de siempre)
```

**Por qué así:**

| Ventaja | Detalle |
|---|---|
| **El móvil no cambia** | Sigue viendo ítems del día; no necesita lógica de recurrencia en el dispositivo, por lo que el modo offline no se complica |
| **Rutas, resultados y métricas siguen funcionando** | Cada ocurrencia es un ítem normal: se agrega a la ruta, se ejecuta, se cancela, se reprograma |
| **Hay precedente en el código** | `installment-reminders.service.ts` ya crea ítems automáticamente desde las cuotas |
| **Excepciones naturales** | Cancelar o reprogramar un día no toca la serie |
| **Fácil de desactivar** | Pausar o terminar la serie es un solo cambio |

## 3. Modelo de datos propuesto

Tabla nueva `agenda_series` (con `account_id` y RLS):

| Campo | Para qué |
|---|---|
| `client_id`, `credit_id`, `assignee_id` | A quién, qué crédito y quién cobra |
| `type` | `VISIT` o `CALL`, normalmente |
| `pattern` | `DAILY`, `WEEKDAYS`, `WEEKLY`, `CUSTOM_DAYS` |
| `days_of_week[]` | Para `WEEKLY` y `CUSTOM_DAYS` |
| `time_mode`, `scheduled_time`, `time_slot` | Igual que `agenda_items` (hora fija, franja o rango) |
| `start_date`, `end_date` | Vigencia; `end_date` opcional |
| `status` | `ACTIVE`, `PAUSED`, `ENDED` |
| `end_reason` | Por qué terminó |
| `origin` | `MANUAL`, `COLLECTION_PROFILE` (nace del perfil de cobro) |
| `generated_until` | Hasta qué fecha ya se materializó |
| `created_by`, `updated_by` | Quién |

Cambios en `agenda_items` (columnas nulables):

| Campo | Para qué |
|---|---|
| `series_id` | A qué serie pertenece |
| `occurrence_date` | Fecha de la ocurrencia original |

Restricción de unicidad `(series_id, occurrence_date)` para que el generador sea
**idempotente**: ejecutarlo dos veces no duplica.

## 4. El generador

Un trabajo de fondo, como los que ya existen (intervalos con `setInterval`,
verificado que **no se usa `@nestjs/schedule`**):

1. Recorre las series `ACTIVE`.
2. Materializa ocurrencias hasta un **horizonte configurable** (por ejemplo,
   los próximos días hábiles).
3. Usa el **reloj del tenant** (`TenantClockService`) para decidir qué es «hoy»;
   un error de zona horaria generaría visitas el día equivocado.
4. Respeta feriados y días no laborables **si la cuenta los define** (**no
   verificado** que exista ese concepto; si no, queda como mejora).

## 5. Cuándo una serie debe terminar o pausarse

Es lo que evita que el cobrador visite a quien ya pagó.

| Evento | Qué pasa con la serie |
|---|---|
| El crédito sale de mora o se paga | **Termina** (`end_reason = CREDIT_CLEARED`) |
| El crédito se castiga o se cancela | **Termina** |
| Se registra un pago completo del día | La ocurrencia de hoy se cierra; la serie continúa |
| El cliente promete pagar en una fecha | **Pausa** hasta esa fecha, o la persona decide |
| Cambia el responsable del crédito | Las ocurrencias futuras pasan al nuevo responsable |
| El cobrador está de licencia | Se reasignan o se pausan sus series |
| Pasa `end_date` | **Termina** |

La clave es que **la serie es sugerencia del sistema, no obligación**: el
cobrador puede saltar un día sin afectar la serie.

## 6. Interacción con lo que ya existe

| Pieza | Efecto |
|---|---|
| **Rutas (`agenda-route-link`)** | Las ocurrencias del día aparecen como candidatos de la ruta; con las ventanas horarias del perfil de cobro se agrupan por franja |
| **Resultado de la visita** | Igual que hoy; al ejecutarse queda en la bitácora |
| **Promesas de pago** | Una promesa pausa o ajusta la serie; el `PROMISE_TO_PAY` sigue siendo ítem único |
| **Recordatorios de cuota** | Sin cambios |
| **Límites de plan** | Los topes miden acciones ejecutadas, no ítems agendados: sin efecto |
| **Offline** | El móvil cachea los ítems ya materializados; crear o cambiar una serie es **solo en línea** o con una acción en cola nueva (`agenda.series`) |

## 7. Pantallas

| Dónde | Qué |
|---|---|
| **Ficha del cliente (web y móvil)**, tarjeta «Perfil de cobro» | Si la modalidad es «diaria» o «recoger la cuota», ofrece **«Crear visitas recurrentes»** con el horario ya precargado |
| **Agenda** | Los ítems de una serie llevan una marca; al abrirlos: «Esta visita» o «Esta y las siguientes» (patrón conocido de calendarios) |
| **Panel del supervisor** | Lista de series activas por cobrador, para ver la carga de cobro diario |

## 8. Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Un campo de «repetir» dentro del propio `agenda_items` | Mezcla regla y ocurrencia; cada cambio exigiría reescribir el historial |
| Calcular la recurrencia en el dispositivo | Duplica lógica en web y móvil y complica el offline |
| Solo generar la visita al armar la ruta (la solución provisoria) | Funciona, pero no deja ver ni gestionar la serie, ni la carga futura |

La solución provisoria **se mantiene como respaldo**: si una cuenta no activa
series, el perfil de cobro sigue generando la sugerencia al armar la ruta.

## 9. Orden de construcción

| Paso | Entrega | Esfuerzo |
|---|---|---|
| 1 | Tabla `agenda_series`, columnas en `agenda_items`, RLS | S |
| 2 | Generador idempotente con reloj del tenant | M |
| 3 | Reglas de término y pausa (§5) | M |
| 4 | Pantalla en ficha del cliente + marca en agenda | M |
| 5 | Vista del supervisor | S-M |
| 6 | Feriados y días no laborables (si se decide) | S |

Depende del **perfil de cobro** de la capa A (`ia-plan-maestro.md` §2.2, A3);
pero **puede entregarse sin él**, con creación manual de la serie.

## 10. Por verificar

1. ¿Existe en alguna parte el concepto de feriado o día no laborable?
2. ¿Cómo trata hoy `agenda-route-link` varias visitas del mismo cliente en un día?
3. ¿Qué horizonte de generación conviene para el volumen real de una agencia?
4. ¿Se necesita editar «solo esta» o «esta y las siguientes» en la primera versión?

## 11. Decisiones para ti

| # | Decisión | Mi recomendación |
|---|---|---|
| R1 | ¿Series reales en la agenda, o solo la visita sugerida en la ruta? | Series reales, con la sugerencia como respaldo |
| R2 | ¿Cobro diario incluye sábados? | Configurable por serie; valor por defecto de lunes a sábado para el rubro comercio |
| R3 | ¿Qué hace el sistema al registrarse un pago completo? | Cerrar la ocurrencia de hoy y sugerir terminar la serie si el crédito sale de mora |
