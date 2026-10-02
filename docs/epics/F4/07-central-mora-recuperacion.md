# F4 · Fase 7 — Central de Mora y Recuperación por Crédito

**Parent:** F4 (créditos) · continúa `06-refactor-creditos-ux.md`
**Estado:** BORRADOR de plan (2026-10-01). Solo auditoría y diseño. **No se ha escrito código.**
Decisiones C1–C4 resueltas el 2026-10-01 (ver §9.C). Sin bloqueantes abiertos.

## Avance (rama `feat/mora-central-f1`, sin commits todavía)

| Tarea | Estado | Notas |
|---|---|---|
| T1 índice | ✅ escrita, **sin aplicar** | `20261003000000_mora_indice_dias`. Parcial sólo por `deleted_at IS NULL` (un parcial por `dpd > 0` no sirve: el piso viaja como parámetro). Rendimiento a 300k **sin medir**: la base de desarrollo tiene 30 créditos. |
| T2 contrato | ✅ | `packages/shared/src/types/mora.types.ts` (`MoraCreditListItem`, `MoraCreditDetail`, `MoraCaseLookup`, `MORA_SORTS`, `MoraListQuery`). |
| T3 `GET /mora` | ✅ | `apps/api/src/modules/mora/`. SQL crudo (el caso es 1-a-muchos para Prisma y no se puede ordenar por él). Validado contra la base real. |
| T4 browser web | ✅ | `lib/mora.ts`, `arrears-table.tsx`, `page.tsx`. |
| T8/T9/T10 ficha (primer corte) | ✅ parcial | `GET /mora/:creditId`, `GET /mora/by-case/:caseId`, `/mora/[creditId]` con header, resumen financiero, controles de caso y timeline. `/mora/<caseId>` redirige. **Faltan** persona (contactos/direcciones/garantes), pagos, promesas, notas, historial de mora. |
| T11a episodios | ✅ | Tabla `credit_arrear_episodes` + **trigger** `credits_track_arrear_episode` (migración `20261003020000_episodios_de_mora`) + backfill. Ver «Episodios de mora» abajo. Sin aplicar en la base de desarrollo. |
| T11b historial en la ficha | ✅ | `GET /mora/:creditId/episodes` (mismo alcance que la ficha, 404 si no se puede ver) + sección «Historial de mora» (`arrears-history.tsx`). Ver abajo. |
| T5 export CSV | ✅ | `GET /mora/export.csv`: stream por lotes de 1.000, BOM, tope 50.000 filas (se rechaza **antes** de escribir), auditado (`export:mora/EXPORT`). |
| T6 export PDF | ✅ | `GET /mora/export.pdf`: reporte con `Report` (pdfkit): título, generado el/por, fecha de corte, alcance, filtros en palabras, totales por fuente y moneda, tabla paginada. Tope 5.000 filas. **No revisado a ojo** (no hay renderizador de PDF en la máquina de desarrollo): validado por estructura, paginación y pruebas. |
| T7 export web | ✅ | Botones «Exportar CSV/PDF» en la tabla (con `case:export`) + proxy `app/api/mora/export`. La query sale de `moraExportQuery` (la misma de la lista, sin página). |
| T9 persona / T14 pagos y promesas / T12 notas | ✅ | Secciones de la ficha: Notas, Promesas de pago, Pagos y La persona. Ver «Secciones de la ficha» abajo. Migración `20261003030000_notas_de_credito` sin aplicar en la base de desarrollo. |
| T13 formulario de gestión con resultado y promesa | ✅ | `POST /mora/:creditId/activities` + `RegisterActivityButton`. Ver «Formulario de gestión» abajo. |
| T16 contratos finales | ✅ | Ya estaban en `mora.types.ts`: `MoraCreditDetail`, `MoraEpisode`, `MoraPromise`, `CreditNote`, `NewCreditNote`. La gestión es `MoraActivityItem` (no se creó `RecoveryActivityItem`: la ficha sólo muestra gestiones del caso) y las etiquetas de resultado son `RECOVERY_RESULTS`. Web, api y mobile compilan con el mismo tipo. |
| T15 métricas de recuperación | ✅ | `GET /mora/:creditId/metrics` + sección «Recuperación». Ver «Métricas de recuperación» abajo. |
| T16, T17–T19 | ⏳ pendientes | |

### Episodios de mora (T11a) — cómo quedó

- **Lo escribe un trigger sobre `credits`, no la aplicación** (decisión distinta a la del plan, que decía «servicio único»). La mora cambia desde el trabajo diario, las acciones manuales, el importador de PSF, los pagos y hasta un UPDATE a mano; un servicio dependería de que cada vía se acuerde de llamarlo. Es el mismo patrón de `credits_touch_client_totals` (totales de cartera).
- **Qué es «en mora»:** vivo, `days_past_due > 0` y estado que no es PAID / CANCELLED / WRITTEN_OFF. Misma definición que usa la lista.
- **Ciclo:** entra → abre; sigue → sólo sube el pico (`max_days_past_due`); sale → cierra con motivo `PAID | CURRENT | SOURCE_ABSENT | WRITTEN_OFF | CANCELLED | DELETED`.
- **`started_at` es estimado** (`started_at_estimated`) salvo que alguien declare `moraSince`/`arrearsSince`: para un importado se calcula como *corte − días*, no como «hoy − días».
- **Ausente de la fuente (D4) no es recuperado.** Cierra como `SOURCE_ABSENT`; si vuelve **todavía en mora** se reabre el mismo episodio; si vuelve **al día** se resuelve (CURRENT/PAID) y una mora posterior es un episodio nuevo. La regla `set-current` del importador (mora a 0 y luego ausente, en dos UPDATE de la misma transacción) se reclasifica a `SOURCE_ABSENT`.
- **Backfill:** (a) un episodio abierto por cada crédito en mora hoy; (b) episodios cerrados reconstruidos de los casos cerrados por el sistema (`PAID/CURRENT/SOURCE_ABSENT`), marcados `reconstructed`, sin días ni saldos. **No** se reconstruye desde `credit_external_snapshots` (pendiente, si se quiere más pasado de PSF) ni de los casos cerrados a mano.
- **Bug de diseño atrapado por la prueba real:** el importador de PSF cierra la mora (a 0) **antes** de marcar la ausencia; sin la regla anterior el episodio salía «CURRENT» (se puso al día) cuando en realidad faltó del reporte.
- **Verificación:** `prisma/verify/arrear_episodes.sql` (30 comprobaciones, con ROLLBACK; segura en cualquier base) y `test/integration/arrear-episodes.it.ts` (migración desde cero + los 5 reportes reales + acciones manuales; invariante tras cada paso). Con los reportes reales: 21 abiertos, 8 `SOURCE_ABSENT`, ninguno de PSF ausente figura como recuperado.
- **Para aplicarla:** `prisma migrate deploy` y volver a correr `prisma/rls/001_enable_rls.sql` (ya lista la tabla; da el GRANT al rol de la API). El trigger agrega una consulta indexada por escritura relevante; **no se midió** su costo en el job sobre 300 mil créditos.
### Historial de mora en la ficha (T11b)

- **Endpoint:** `GET /mora/:creditId/episodes` → `MoraEpisode[]` (shared), del más reciente al más antiguo, numerados cronológicamente (la «Mora #1» es la más antigua). `case:read`; mismo alcance que `GET /mora/:creditId`.
- **Sección:** cada episodio muestra #, estado (Actual / cómo terminó), rango de fechas, duración, pico de mora, saldo al entrar y al salir, días con los que entró y origen de la mora.
- **No inventa el pasado:** inicio estimado → «(aprox.)»; episodio `reconstructed` → etiqueta «Reconstruido» y «—» en pico y saldos (nunca 0); `SOURCE_ABSENT` en ámbar con la nota «no se sabe si pagó o se puso al día», no en verde.
- **Degrada sin romper la ficha:** si el endpoint falla (p. ej. la API todavía sin la migración) la sección dice «No se pudo cargar el historial de mora» y el resto de la página sigue.
- **Error de zona horaria encontrado y corregido:** los días civiles (`@db.Date`) se formatean con `dayDate` (UTC). Con `date()` Bolivia (UTC−4) corría un día atrás (una mora del 29 aparecía el 28). Afectaba también a próxima fecha, último pago e inicio de mora en la ficha y la tabla, ya corregidos; la prueba fija `TZ=America/La_Paz`.
- **Verificado:** pruebas unitarias (serializador, componente), llamadas reales al API sobre `kobrax_it` (con los reportes PSF importados) y la ficha renderizada por la web contra ese API.
- **Fuera de alcance por ahora:** la serie de `credit_external_snapshots` como historia de PSF anterior a los episodios, y las métricas de recuperación (T15).

### Secciones de la ficha (persona, pagos, promesas, notas)

Layout: encabezado → resumen → **Notas** → [Historial de mora + Gestiones | Promesas + Pagos] → **La persona**. Cada sección carga por su cuenta y, si falla (permiso o API sin migrar), dice «no se pudo cargar» sin tumbar la ficha.

- **Notas** (nuevas). Tabla `credit_notes` (migración `20261003030000_notas_de_credito`, RLS en `001_enable_rls.sql`): del crédito, **independientes del caso**, **append-only** (sin editar ni borrar: corregir es escribir otra), tipo `INFO | WARNING | IMPORTANT`, 1–1000 caracteres (también en la base). `GET/POST /mora/:creditId/notes` (lectura `case:read`, escritura `case:write`, mismo alcance que la ficha: **404** si no se puede ver). El `id` puede venir del cliente y es **idempotente** (el móvil escribe sin red y reintenta); un id de otro crédito da 409. Se audita sin el texto. UI: plegadas por defecto (`<details>`), las importantes primero, formulario con el mismo id al reintentar.
- **Promesas** (sin tabla nueva). `GET /mora/:creditId/promises` lee `agenda_items PROMISE_TO_PAY`; el estado sale del agendado + su fecha + el desenlace de la gestión que la ejecutó: `ACTIVE | OVERDUE | KEPT | BROKEN | EXECUTED | CANCELLED | RESCHEDULED`. **Vencida sin cerrar (`OVERDUE`) NO es incumplida** (no se sabe si pagó) y no entra al cumplimiento. El resumen (`summarizePromises`, shared) cuenta sólo las cerradas; sin ninguna no hay porcentaje, no «0 %».
- **Pagos** (sin endpoint nuevo). `GET /payments?creditId=` ya existía. «Cobrado por Kobrax» no suma lo confirmado por un canal de la entidad; en un crédito PSF se avisa que el pago no cambia el saldo ni la mora reportados (D3). `PaymentActions` (registrar pago / cobro por QR) en el encabezado, con `suggestedPaymentAmount` ahora en el contrato de la lista y la ficha.
- **La persona** (sólo lectura). Reutiliza `ContactList`, `LocationList`, `GuarantorsSection`, `CollateralsSection` y `AttachmentsSection` de Cartera con `canWrite=false`. **Garantes y garantías son los de ESTE crédito** (filtrados por `creditIds`). Carga enmascarada; «Mostrar» revela por la ruta auditada (`PII_REVEAL`).
- **Verificado:** pruebas unitarias (API 1006, web 508, shared 234) y llamadas reales sobre `kobrax_it`: alcance del cobrador (404 en lo ajeno, nada escrito), idempotencia de la nota, 409 por id ajeno, ficha renderizada con notas, promesa creada desde una gestión, pagos y garante filtrado, y la ficha de un crédito sin caso. BFF: origen ajeno → 403, `creditId` no uuid → 404.
- **Pendiente:** adjuntos por crédito (hoy son del cliente), formulario de gestión con resultado y promesa (T13), métricas (T15), y mostrar el método y el banco de la promesa (hoy no se muestran; hace falta resolver el catálogo).

### Formulario de gestión con resultado y promesa (T13)

- **Regla única en shared** (`recovery-activity.ts`, `validateRecoveryActivity`): tipos `CALL | VISIT | MESSAGE | NOTE`; el **resultado es obligatorio** salvo en una nota y tiene que corresponder al tipo (`NOT_FOUND`/`WRONG_ADDRESS` son de visita, `WRONG_NUMBER` de llamada/mensaje); **«promesa de pago» y los datos de la promesa van juntos** (monto > 0, fecha no pasada, medio de pago; banco opcional). Los resultados son valores que ya existían (`AgendaOutcome` ∪ `VisitOutcome`), así que el historial nuevo se lee igual que el anterior. La usa el panel (no ofrece lo que la API rechaza), la API (rechaza de verdad) y la usará el móvil.
- **Endpoint:** `POST /mora/:creditId/activities` (`case:write`). Mismo alcance que la ficha (404 si no se puede ver, sin abrir caso ni escribir). **Si el crédito no tiene caso, lo abre** (`CasesService.create`, el mismo del botón «Abrir caso») y registra la gestión con `CasesService.addActivity` — una sola lógica: la promesa se vuelve `agenda_item`, se actualiza la última gestión y se avisa al tablero. Carrera de dos aperturas simultáneas: usa el caso de la otra persona. Responde `{ id, type, createdAt, caseId, caseOpened }`. Errores 400 con código `MORA_<CÓDIGO>`.
- **Panel:** el modal viejo (sólo tipo + nota) sale de `CaseActions`; el botón «Registrar gestión» del encabezado sirve **con o sin caso**. Campos: qué se hizo, resultado (filtrado por tipo), observaciones y, con «promesa de pago», monto (arranca con el sugerido), fecha, medio (catálogo `PAYMENT_METHOD` o los de siempre) y banco (catálogo `BANK`, sólo si existe). Errores de a uno y recién tras el primer intento. El timeline muestra «Resultado: …» con etiqueta (un valor que el diccionario no conoce se muestra crudo: hay gestiones anteriores con texto libre).
- **Decisiones:** (1) resultado obligatorio para llamada/visita/mensaje; (2) la API deja un día de margen en la fecha prometida (quien escribe en Bolivia a las 21:00 puede prometer «hoy»); (3) el caso abierto automáticamente queda **PENDING y sin cobrador** (igual que «Abrir caso»; el trabajo diario sí hereda `assignedManagerId`, esta vía no).
- **No se hizo:** teléfono usado / dirección visitada en la gestión (no se persisten hoy; harían falta columnas o `details`), y evidencia/ubicación (eso es de la visita del móvil).
- **Verificado:** pruebas unitarias (shared 249, API 1024, web 524) y llamadas reales sobre `kobrax_it`: gestión en un crédito sin caso (abre caso, queda 1 gestión con su resultado), segunda gestión reutiliza el caso, cobrador sobre un crédito ajeno → 404 sin escribir, promesa creada por un cobrador y leída en `/promises`, y los 400 por código.

> ⚠️ **Hallazgo de seguridad, ya existía y NO se tocó:** `POST /cases/:id/activities` (`CasesService.addActivity`) busca el caso sólo por id: un cobrador **no puede leer** el caso de otro (`GET /cases/:id` → 404) pero **sí puede escribirle gestiones** (→ 201; comprobado). `POST /mora/:creditId/activities` no tiene el problema (comprueba el alcance antes). Arreglarlo en `addActivity` (mismo `scopedToOwnCases` que `findOne`) es de una línea, pero hay que confirmar antes que el móvil no registre gestiones sobre casos que no son del cobrador (por ejemplo desde una ruta armada por un supervisor).

### Métricas de recuperación (T15)

Clasificación pedida en §2.3, con lo que quedó implementado:

| Métrica | Clasificación | Cómo |
|---|---|---|
| Monto recuperado | YA EXISTE | Σ `payments` **cobrados por Kobrax** dentro de la mora actual (y el total de toda la vida, aparte). Lo confirmado por un canal de la entidad no suma. |
| Cantidad de gestiones, llamadas, visitas, mensajes | YA EXISTE | `case_activities` de todos los casos del crédito, desde el inicio de la mora actual. Las notas y lo que escribe el sistema (pagos, estados, asignaciones) no cuentan como gestión. |
| Contactos (se habló con el deudor) | CALCULABLE | Gestión con resultado `CONTACTED / PROMISE_TO_PAY / REFUSAL / PARTIAL_PAYMENT / PAID`. Una llamada sin respuesta o un número equivocado no lo son. |
| Promesas hechas / cumplidas / incumplidas | YA EXISTE | `summarizePromises`; sólo las de la mora actual (por fecha de creación); el cumplimiento cuenta únicamente las cerradas. |
| Días hasta primer contacto / visita / pago | CALCULABLE desde adelante | Desde `started_at` del episodio (de ahí la importancia de T11a). `undefined` mientras no haya pasado: «Todavía sin contacto», nunca «0 días». |
| Días hasta la recuperación | CALCULABLE desde adelante | `durationDays` de la última mora que terminó **PAID o CURRENT** (SOURCE_ABSENT no cuenta como recuperada). |
| Mora anterior al historial | NO RECONSTRUIBLE | Se avisa (ver abajo). |

- **Una sola regla en shared** (`recovery-metrics.ts`, `computeRecoveryMetrics`): el backend sólo trae los datos y el móvil usará la misma. `GET /mora/:creditId/metrics` (`case:read`, mismo alcance que la ficha, 404 si no se puede ver).
- **Se miden sobre la mora actual**, no sobre toda la vida del crédito: un contacto de hace un año no es «el primer contacto» de esta mora. Sin mora abierta se muestra el histórico y no se calculan «días hasta…» (no hay desde cuándo contar).
- 🔴 **Hallazgo con datos reales: una mora que ya venía de antes de registrarse.** Un importado con 393 días de mora, gestionado por primera vez hoy, daba «395 días hasta el primer contacto»: correcto en el papel y engañoso (lo anterior pudo ocurrir fuera de Kobrax). Ahora `untrackedDays` = cuántos días llevaba la mora cuando se abrió su episodio (más de 3 días de diferencia; el trabajo diario la detecta al día siguiente) y la sección lo dice con un aviso. El número no se oculta, se contextualiza.
- **Fuera de alcance (no pedido):** comparativas entre cobradores, dashboards, roll-rates, serie diaria de DPD (siguen siendo NUEVO DATO).
- **Verificado:** shared 267, API 1034, web 542 y llamadas reales sobre `kobrax_it` (con `TZ` de Bolivia en las pruebas de fechas): crédito sin gestiones (todo «todavía sin…»), crédito con contacto, visita y promesa, 404 al cobrador sobre lo ajeno, y la ficha renderizada.

**Desviaciones respecto al plan**
- **Permiso `case:export`** (migración `20261003010000_permiso_case_export`, `ROLE_PERMISSIONS`, seed): lo tienen todos los roles con `case:read`. Los endpoints exigen `case:read` **y** `case:export`. `report:export` no se tocó; `permission-gates.spec.ts` lo vigila.
- **El CSV no lleva documento** (el plan decía «enmascarado»): se omitió para no descifrar PII en un listado masivo. Sin teléfonos ni direcciones tampoco. Las celdas de texto externo que empiezan con `= + - @` se prefijan con `'` (inyección de fórmulas en Excel).
- **Bug encontrado en la prueba real:** el stream del CSV perdía el contexto del tenant (`AsyncLocalStorage`) al consumirse después del handler y salía con cabecera y sin filas. Corregido con `inRequestContext`, con prueba de regresión.
- **Sin `POST /mora/:id/open-case`:** el botón «Abrir caso» usa el `POST /cases { creditId }` que ya existía (a través del BFF nuevo `app/api/cases/route.ts`).
- **Orden:** `overdueAmount` no es ordenable (vive en JSON/cuotas). Las claves son `daysPastDue, balance, priority, lastAction, slaDueAt, createdAt`.
- **Operaciones externas ausentes del último reporte** (`sync_status = ABSENT`) no se listan salvo con «incluir los que están al día» (D4: la ausencia no es mora ni pago).
- **Filtro por oficina** y exportación: siguen pendientes (requieren la lista de oficinas y T5–T7).
- **Enlaces viejos:** cuatro pantallas (`agenda/[id]`, `cartera/[id]/cases-section`, `pagos/[id]`, `rutas/[id]/parada/[sid]`) siguen enlazando `/mora/<caseId>`; funcionan por la redirección y se pueden cambiar a crédito después.

**Hallazgo con datos reales (base de desarrollo):** de 22 créditos en mora, **21 no tienen caso abierto**; el listado anterior sólo habría mostrado 1. Es exactamente el hueco que motivó listar por crédito.
**Alcance:** Web primero (Fases 0–6 y 10), Mobile después (Fases 7–9).
**Depende de:** PSF fases 1–9 (D1–D9), motor financiero F4/06 (D1–D20), asignación en importación.

> Regla de este documento: todo nombre (archivo, modelo, endpoint, símbolo) sale de la auditoría del repo.
> Lo que no se encontró se marca **NO EXISTE**. Lo que el código no permite afirmar se marca **VERIFICAR**.

---

## 0. Resumen ejecutivo

1. Hoy `/mora` lista **casos** (`GET /cases`, `CaseListItem`), no créditos. La fila y la ficha usan `case.id`.
   Un caso solo existe si el job diario lo abrió, así que un crédito en mora sin caso **no aparece**.
2. **No existe historial de mora.** `Arrear` es un snapshot por crédito (se borra y recrea) y solo lo escribe
   `recalculate-arrears`. Lo único parecido a episodios son los `CollectionCase` (`createdAt`→`closedAt`) y,
   para PSF, `CreditExternalSnapshot`.
3. **No existe sistema de notas** reutilizable por crédito. Solo `CaseActivity type=NOTE` (atada a un caso).
4. El formulario web de gestión no expone `result` ni `promise`, aunque `NewActivity` y la API los aceptan.
5. Mobile **ya tiene mora** (chip "En mora" en Cobranza, `MoraSheet`, avisos PSF). Lo que falta es una vista
   de trabajo de mora, no la mora en sí. La arquitectura offline es "hidratar + cola idempotente" sobre
   `expo-sqlite`; **no** hay WatermelonDB, ni sync incremental, ni resolución de conflictos.
6. Exportar: `GET /exports/cases` existe pero sin filtros y con PII en claro. PDF: existe `pdfkit` + helper
   `Report` en backend. No hay lib de PDF/CSV en web.

**Estrategia:** backend nuevo `mora` (consulta por crédito + ficha agregada + export) que consume los modelos
existentes; shared define el contrato; web lo consume; mobile lo consume después. La lógica de mora no se
duplica: la calcula el backend (`computeArrears`, `arrearsByMethod`, `case-lifecycle`).

---

## 1. Hallazgos de la auditoría

### 1.1 Mora vs Caso (cómo está hoy)

```
Credit.daysPastDue  (columna, denormalizada)
   ├─ job ArrearsJobService.run (cada 6 h, lotes de 200)  → actualiza días y llama openCaseIfNone
   ├─ markArrears / clearArrears / recalculateArrears (credits.service.ts)
   └─ importador PSF (portfolio-import.service.ts) → days reportados (IMPORTED)
            ↓
   CollectionCase (1 abierto por crédito) ← openCaseIfNone (case-lifecycle.ts:47)
            ↓ closeOpenCases: PAID | CURRENT | SOURCE_ABSENT | MANUAL
```

| Dato | Dónde vive realmente | Nota |
|---|---|---|
| `daysPastDue` | `credits.days_past_due` (columna) | Sin índice propio; `/cases` ordena vía join |
| `moraSince` / `arrearsSince` | `credits.metadata` (JSON) | Solo valor vigente; sin índice |
| `nextDueDate`, `installmentAmount`, `arrearsMethod` | `credits.metadata` (JSON) | Filtrar/ordenar exige JSON path |
| `overdueAmount` | `arrears.overdue_amount` | Solo si se corrió `recalculate-arrears`; nunca para importados/manuales/sin cronograma |
| `pastDueAmount` | **NO EXISTE** | Calculable: Σ(`amount − paidAmount`) de cuotas con `dueDate < hoy` (solo con cronograma) |
| `lastPayment` | **NO EXISTE** como columna | Calculable: `max(payments.paymentDate)` por crédito |
| Origen de mora | `arrearsSourceOf(meta)` → `CALCULATED | IMPORTED | MANUAL` | No es columna |
| Fuente del crédito | `credits.externalSource` (`PSF`/null) y `CREDIT_SOURCES=['KOBRAX','PSF']` | |
| Estado del crédito | `CreditStatus`: ACTIVE, PAID, DEFAULTED, RESTRUCTURED, WRITTEN_OFF, CANCELLED | |
| Estado del caso | `CaseStatus`: PENDING, ACTIVE, IN_NEGOTIATION, PROMISE_TO_PAY, PAID, CLOSED, WRITTEN_OFF | |
| **Estado reportado por el archivo** | `credits.metadata.reportedStatus` (etiqueta cruda: Vigente, Vencida, Ejecución…) y `credit_external_snapshots.reported_status` | `portfolio-credit.ts#reportedMeta`. Solo importados |
| Traducción de esa etiqueta | `mapStatus`/`STATUS_MAP` (`portfolio-credit.ts`): VIGENTE→ACTIVE, VENCIDO→DEFAULTED, CASTIGADO→WRITTEN_OFF, CANCELADO→CANCELLED; `statusMap` por tenant (`import-config.ts`) | "Vencida"/"Ejecución" **no** cambian `CreditStatus`: son grados de mora y el crédito sigue vivo (comentario de `import-config.ts`). La etiqueta cruda es la única fuente de ese grado |
| Monto vencido importado | `credits.metadata.pastDueAmount` (`creditCreateData/UpdateData`) | Reportado por el archivo; no hay que calcularlo para PSF |
| Último pago importado | `credits.metadata.lastPaymentDate` (`reportedMeta`) | Reportado por el archivo |
| Prioridad | `CasePriority`: LOW, MEDIUM, HIGH, CRITICAL (`computePriority`, `priorityPinnedAt`) | Vive en el **caso** |
| Oficina | `credits.branchId` / `collection_cases.branchId` → `branches` | Ningún filtro de lectura lo usa |
| Responsable | `collection_cases.assigneeId` (hereda `credits.assignedManagerId` al abrir) | Historial en `credit_assignments` |

**Créditos que hoy no tienen caso aunque estén vencidos** (el job no abre caso):
- sin cronograma ni `metadata.nextDueDate` (`arrearsFor` devuelve `null`);
- PSF con reporte desactualizado (D9, `isReportStale`);
- `days < account.configuration.caseGeneration.minDaysPastDue`;
- créditos cuyo caso se cerró y no se reabrió.

**Propios vs PSF**
- Propios (`externalSource` null): mora `CALCULATED` o `MANUAL`; se pueden marcar/poner al día (`ArrearsActions`).
- PSF: saldo y días son **reportados** al `reportedAsOf`; `code`/`status` bloqueados (D5); un `Payment` no toca
  saldo/mora (D3); ausencia = `syncStatus ABSENT` (D4); mora desactualizada tras N días (D9).
  `reportedStatus` se guarda en `CreditExternalSnapshot` (candidato para el "estado" tipo "Ejecución", ver §10).

### 1.2 Inventario de reuso (Web)

| Archivo | Símbolo | Qué hace | Conservar | Modificar | Reutilizar |
|---|---|---|---|---|---|
| `apps/web/src/app/(panel)/mora/page.tsx` | server component | Fetch `/cases`, `/auth/me`, `/users`, `/accounts/me` | patrón server-fetch | fuente → `/mora` | estructura |
| `.../mora/arrears-table.tsx` | `ArrearsTable` (client, `DataTable`) | Columnas client/días/saldo/origen/asignado/prioridad/estado/SLA | `FilterDef[]`, `SourceBadge`, `PriorityCell` | columnas por crédito, link a `/mora/${creditId}` | casi todo |
| `.../mora/bulk-actions.tsx` | `BulkActions` | assign / priority / clear sobre `caseIds` (máx 100, no atómico) | UX | mapear fila-crédito→caso; filas sin caso quedan deshabilitadas | sí |
| `.../mora/priority-cell.tsx` | `PriorityCell {caseId, priority, pinned, canWrite}` | Prioridad inline | sí | deshabilitar si no hay caso | sí |
| `.../mora/[id]/page.tsx` | ficha de caso | `GET /cases/:id` + facts + timeline | acciones | se reemplaza por `[creditId]` | `CaseActions`, `StatusControl` |
| `.../mora/[id]/case-actions.tsx` | `CaseActions` | gestión (NOTE/CALL/VISIT/MESSAGE), asignar, cerrar | modales | añadir `result` y `promise` | sí |
| `apps/web/src/lib/cases.ts` | `moraQuery`, `hasMoraFilters`, `STATUS_TONE`, `PRIORITY_TONE`, `nextStates`, `canClose` | arma query y tonos | tonos | `moraQuery`→ nueva query | tonos |
| `apps/web/src/app/api/mora/bulk/route.ts` | BFF bulk | | | | sí |
| `components/data-table.tsx` | `DataTable<T>` (+ `DATA-TABLE.md`) | tabla con `actions`, `selection`, prefs de columnas por `tableId` | sí | — | **base de todo** |
| `components/data-table-filters.tsx` | `FilterPanel`/`FilterDef` | tipos text/numberRange/dateRange/select/multiSelect/radio | sí | — | sí |
| `components/search-box.tsx` | `SearchBox` | `q` en URL | sí | — | sí |
| `components/panel-ui.tsx` | `Card`, `Fact`, `Section`, `PageHeader`, `Badge`, `EmptyState`, `Segmented` | UI | sí | — | sí |
| `components/modal.tsx`, `toast.tsx`, `ui.tsx` | `Modal`, `useToast`, `Button/Input/Select/Field` | | sí | — | sí |
| `components/source-badge.tsx` | `SourceBadge` | origen PSF/estado de sync | sí | — | sí |
| `components/payment-plan-table.tsx` | `PaymentPlanTable` | cronograma | sí | — | sí |
| `components/credit-progress.tsx` | `CreditProgress`, `CREDIT_STATUS_TONE` | progreso | sí | — | sí |
| `(panel)/pagos/payment-actions.tsx` | `PaymentModal {credit:{id,code,suggestedAmount,external}}` | registrar pago | sí | — | sí |
| `(panel)/cartera/[id]/credito/[cid]/credit-view.tsx` | `CreditView` (649 líneas) | resumen financiero + cronograma + origen | estilo | **no reusar entero** (mezcla edición); extraer partes de lectura | secciones |
| `.../credito/[cid]/arrears-actions.tsx` | `ArrearsActions` | marcar/poner al día | sí | — | sí (solo propios) |
| `(panel)/cartera/[id]/client-contacts.tsx` | `ContactList`, `LocationList`, `Dato`, `EyeButton` | contactos/direcciones con reveal auditado | sí | modo solo lectura | sí |
| `.../backing-sections.tsx` | `GuarantorsSection`, `CollateralsSection` | | sí | modo solo lectura | sí |
| `.../attachments-section.tsx` | `AttachmentsSection` | **Ojo:** adjuntos son del cliente (no hay `creditId`) | sí | — | sí |
| `.../cases-section.tsx`, `TimelineSection` | | `GET /clients/:id/timeline` | sí | — | sí |
| `apps/web/src/lib/format.ts` | `money`, `date`, `dayDate`, `dateTime`, `relativeDate` | | sí | — | sí |
| `apps/web/src/lib/download.ts` | `downloadText` | CSV en navegador (sin helper de escape) | — | no usar para el export de mora | no |
| `apps/web/src/app/api/exports/[type]/route.ts` | proxy con `ALLOWED` | stream + `Content-Disposition` | patrón | nuevo proxy dedicado `app/api/mora/export` | patrón |
| `apps/web/src/lib/nav.ts` | `NAV` (`permission: Permission.CASE_READ`), `crumbsFor` | | sí | etiqueta si se renombra | sí |

Convenciones web a respetar: server components + clientes finos; estado de tabla en searchParams; mutación por
`postJson/sendJson` → route handler BFF (`proxyMutation`, `sameOrigin`); i18n `next-intl` con claves en
`src/messages/es.json` **y** `en.json` (`i18n/messages.test.ts` valida paridad); tokens Tailwind `k-*`;
comentarios 🔴 para decisiones. Sin TanStack Query/Zustand. Vitest + Testing Library + MSW.

### 1.3 Inventario de reuso (Backend / DB / Shared)

| Archivo / modelo | Símbolo | Uso en este plan |
|---|---|---|
| `schema.prisma:790` | `Credit` | entidad principal de la lista |
| `:994` `CreditInstallment` | cuotas | `overdueAmount` calculado, cuotas vencidas |
| `:1018` `Arrear` | snapshot | no usar como fuente (incompleto) |
| `:1101` `CollectionCase` | caso | estado/prioridad/SLA/asignado |
| `:1140` `CaseActivity` | gestiones (append-only) | NOTE/CALL/VISIT/MESSAGE/PAYMENT/STATUS_CHANGE/ASSIGNMENT |
| `:1207` `FieldVisit` + `:1238` `FieldEvidence` | visitas GPS + evidencia (`fileHash` SHA-256) | gestión VISIT, evidencia |
| `:1289` `Payment` | pagos inmutables (`caseId`, `creditId`, `channel`) | pagos y recuperado |
| `:1425` `AgendaItem` | `PROMISE_TO_PAY` en `details Json`; `AgendaOutcome PROMISE_KEPT/BROKEN` | promesas |
| `:961` `CreditAssignment` | historial de asignaciones | "quién lo tiene y desde cuándo" |
| `:862` `CreditExternalSnapshot` | serie PSF (`reportedDaysPastDue`, `reportedBalance`, `reportedStatus`, `reportedAsOf`) | historial de mora PSF |
| `:379` `AuditLog` | `ARREARS_MARK/CLEAR/RECALC`, `EXTERNAL_*`, `EXPORT`, `PII_REVEAL` | auditoría, y reconstrucción parcial |
| `:640/:661/:687/:715/:734/:772` | `ClientContact`, `ClientLocation`, `ClientRelation`+`CreditGuarantor`, `Collateral`, `ClientAttachment` | ficha |
| `:121` `Branch` | oficinas | filtro oficina |
| `apps/api/.../cases/cases.service.ts` | `list` (~L525), `scopedToOwnCases` (L405), `findOne` (L721) | patrón de scope y filtros a **copiar** |
| `.../cases/dto/case.dto.ts` | `ListCasesQueryDto` | patrón de DTO de filtros |
| `.../cases/case-lifecycle.ts` | `openCaseIfNone`, `closeOpenCases`, `reopenAbsentCase` | punto de enganche del historial de mora |
| `.../arrears/arrears-job.service.ts` | `run`, `arrearsFor` | punto de enganche del historial |
| `.../credits/credits.service.ts` | `markArrears`, `clearArrears`, `recalculateArrears` | idem |
| `.../exports/exports.controller.ts`, `exports.service.ts`, `csv.ts` | `@Roles(REPORT_EXPORT)`, `StreamableFile`, `logExport` | patrón CSV |
| `apps/api/src/common/pdf/report.ts` | clase `Report` (pdfkit), `TableColumn<T>`, `arrearsTone` | patrón PDF (`client-pdf.ts`, `route-pdf.ts`) |
| `apps/api/src/common/audit/audit.service.ts` | `AuditService.record/recordMany` | auditoría |
| `packages/shared/src/types/case.types.ts` | `CaseListItem` (34-87), `CASE_SORTS`, `NewActivity`, `ActivityPromise` | base del nuevo `MoraCreditListItem` |
| `packages/shared/src/utils/*` | `arrears-method.ts`, `aging.ts`, `external-report.ts`, `payment-suggestion.ts` | cálculo compartido (ya es único) |
| `packages/shared/src/constants/permissions.ts` | `ROLE_PERMISSIONS` | fuente única de permisos |
| `apps/api/.../permission-gates.spec.ts` | valida permisos por controlador | **actualizar** al añadir endpoints |

### 1.4 Permisos reales (matriz)

| Rol | `case:*` | `credit:*` | `report:*` | Alcance real en `GET /cases` |
|---|---|---|---|---|
| SUPER_ADMIN / ACCOUNT_ADMIN | todos | todos | todos | todo el tenant |
| MANAGER | read, write, assign, close | read, write, pii:read | read, export | todo el tenant |
| SUPERVISOR | read, write, assign | read | read | todo el tenant |
| COLLECTOR | read, write | read, write | — | **solo** `assigneeId = userId` |
| AUDITOR | read | read, pii:read | read, export | todo el tenant |
| VIEWER | read | — | read | todo el tenant |

- RLS activo por tenant; el alcance `own` **no** está en BD (`rls/002_scope.sql` solo helpers): se aplica en
  aplicación (`scopedToOwnCases`: con `case:assign` ve todo; con `case:write` sin assign, solo lo suyo).
- **No hay alcance por oficina** (`PermissionScope.BRANCH` existe como enum, sin implementación). Un MANAGER ve
  todas las oficinas. Hoy "oficina" solo puede ser un **filtro**, no una restricción.
- La web no tiene guard de ruta por permiso (solo el menú y el 403 de la API). Patrón `denied` por sección.

---

## 2. Matrices de datos

### 2.1 Columnas del browser

| Columna | Campo | Modelo | Existe hoy | Requiere backend | Requiere cálculo |
|---|---|---|---|---|---|
| Nº de crédito (1ª, link) | `code` (+`creditId`) | `credits.code` (nullable) | sí (`creditCode`) | no (fallback: id corto si `code` null) | no |
| Deudor | `clientName`, `clientId` | `clients` | sí | no | no |
| Saldo | `outstandingBalance` | `credits` | sí (`amount`) | no | no |
| Monto original | `principalAmount` | `credits` | sí en BD, **no** en `CaseListItem` | añadir al select | no |
| Cuota | `installmentAmount` | `credits.metadata` | sí (`CaseListItem`) | no | no |
| Monto vencido real | `overdueAmount` | propios: cuotas (`credit_installments`); PSF: `metadata.pastDueAmount` | PSF sí (metadata); propios no | calcular en servicio y devolver `overdueSource: 'SCHEDULE'\|'REPORTED'` | propios: Σ(amount−paidAmount) con dueDate<hoy; `null` solo si no hay cronograma ni valor reportado |
| Último pago | `lastPaymentAt` | propios: `payments`; PSF: `metadata.lastPaymentDate` | PSF sí (metadata) | subquery `max(paymentDate)`; para PSF tomar el mayor entre el reportado y los pagos Kobrax | sí |
| Próxima fecha | `nextDueDate` | `credits.metadata` | sí (`CaseListItem`) | no (no ordenable sin índice) | no |
| Días de mora | `daysPastDue` | `credits` | sí | índice (ver T1) | no |
| Estado en origen (opcional) | `reportedStatus` = `metadata.reportedStatus` | `credits.metadata` | solo importados **y solo si el formato mapeó la columna Estado** | exponer tal cual; `null` → "—" | no. **Oculta por defecto**; no aplica a propios |
| Estado de gestión | `caseStatus` | `collection_cases.status` | sí | no | no — **oculta por defecto**; se edita en la ficha (ver §3.2) |
| Origen de mora | `arrearsSource` | derivado de `metadata` | sí | no | no |
| Fuente | `externalSource` | `credits` | sí | no | no |
| Inicio de mora | `moraSince` | `credits.metadata` | **no** en lista | exponer | PSF: sin dato → "—" |
| Prioridad | `priority` | `collection_cases` | sí | no | sin caso → "—" |
| Cobrador | `assigneeId` (+nombre) | `collection_cases` / `credits.assignedManagerId` | sí (caso) | fallback a `assignedManagerId` | no |
| Oficina | `branchId` (+nombre) | `credits`/`branches` | **no** en lista | join `branches` | no |
| Última gestión | `lastActionAt` | `collection_cases` | sí | no | no |
| Resultado última gestión | `lastActivityResult` | `case_activities.result` / `field_visits.outcome` | **no** | subquery última actividad | sí |
| Promesa activa | `hasActivePromise` | `agenda_items` | sí | no | no |
| Zona | `zone` | `client_locations` | solo `view=portfolio` | opcional | no |

### 2.2 Historial de recuperación (clasificación pedida)

| Elemento | Clasificación | Fuente / acción |
|---|---|---|
| Mora actual (días, desde, origen, monto vencido) | **Existe** (parcial) | `credits.days_past_due`, `metadata.moraSince`, cuotas |
| Historial de mora Kobrax | **Requiere persistencia nueva** (aprox. calculable con cronograma, no sin él) | tabla de episodios (T11) |
| Historial de mora PSF | **Existe** | `credit_external_snapshots` (una fila por corrida) |
| Episodios aproximados pasados | **Puede calcularse** | `collection_cases` (`createdAt`/`closedAt`/`closedReason`) |
| Gestiones: llamada/visita/mensaje/nota | **Existe** | `case_activities`, `field_visits` |
| Teléfono usado / dirección visitada | **No se persiste** (visita guarda GPS y `details Json`; llamada solo `notes`) | VERIFICAR `details`; capturar desde ahora |
| Resultado de gestión | **Existe** en visita (`VisitOutcome`) y `case_activities.result`; el form web no lo expone | exponer en form |
| Promesas | **Existe** como `agenda_items PROMISE_TO_PAY` | calcular estado con `AgendaOutcome` |
| Promesa cumplida/incumplida | **Existe** (`PROMISE_KEPT/BROKEN`) | vigilado por job `promise-due` |
| Pagos | **Existe** | `payments` |
| Notas por crédito | **Requiere persistencia nueva** | tabla `credit_notes` (T12) |
| Evidencias | **Existe** por visita | `field_evidences` (hash SHA-256) |
| Asignaciones históricas | **Existe** | `credit_assignments` |
| Eventos de mora (marcar/limpiar) | **Existe** (solo manuales) | `audit_logs` |
| Mora de Kobrax antes de hoy sin episodios | **No reconstruible** (sin cronograma) | aceptar y mostrar "Sin historial previo" |
| Cierres automáticos del job | **Parcial** (`closedReason` sin `closedBy`) | el episodio lo registrará |

### 2.3 Métricas

| Métrica | Clasificación | Cómo |
|---|---|---|
| Monto recuperado | YA EXISTE | Σ `payments` por crédito/caso |
| Cantidad de gestiones, llamadas, visitas | YA EXISTE | contar `case_activities` por `type` / `field_visits` |
| Promesas hechas | YA EXISTE | `agenda_items PROMISE_TO_PAY` |
| Promesas cumplidas / incumplidas | YA EXISTE | `AgendaOutcome` |
| Días hasta primer contacto / primera visita | CALCULABLE | `min(createdAt)` de actividades CALL/VISIT − inicio del episodio/caso |
| Días hasta primer pago | CALCULABLE | `min(paymentDate)` − inicio del episodio/caso |
| Días hasta recuperación | CALCULABLE desde adelante | `endedAt − startedAt` del episodio (T11); antes: del caso |
| Monto recuperado por episodio | CALCULABLE desde adelante | pagos entre `startedAt` y `endedAt` |
| Mora histórica Kobrax anterior a T11 | NO RECONSTRUIBLE (sin cronograma) | |
| Roll-rate / serie diaria de DPD Kobrax | REQUIERE NUEVO DATO | fuera de alcance (no solicitado) |

---

## 3. Diseño Web

### 3.1 Rutas
- `/mora` → browser de **créditos en mora** (una fila por crédito).
- `/mora/[creditId]` → ficha de recuperación.
- Compatibilidad: enlaces viejos `/mora/<caseId>` (notificaciones, bitácora, `CasesSection`) deben seguir
  funcionando. `[creditId]` resuelve: si el uuid no es crédito pero sí caso, **redirige** a su crédito.
  Actualizar los enlaces internos para que apunten al crédito.
- Etiqueta de menú: se mantiene `cases`→ renombrar copy a "Mora" (`panel.nav`), mismo permiso `CASE_READ`.

### 3.2 Browser
- Server component → `GET /mora?...` (nuevo). Estado en searchParams. `DataTable` con `tableId="mora"`.
- Visibles por defecto: Nº crédito · Deudor · Saldo · Vencido · Días · Prioridad · Cobrador · Oficina ·
  Última gestión (+resultado). Apagadas: estado de gestión, estado en origen, monto original, cuota, próxima fecha,
  último pago, inicio de mora, origen, fuente, promesa, zona.
- **Estado (decisión C1, revisada 2026-10-01):** **no hay columna de estado visible por defecto.** La pantalla mezcla
  créditos propios (cliente nuevo) e importados, hay usuarios que solo trabajan propios, y el estado del archivo es
  opcional (solo existe si el formato mapeó la columna). Lo que sí está siempre: días de mora y prioridad. Quedan como
  columnas **opcionales y apagadas**: "Estado de gestión" (estado del caso, editable en la ficha con `StatusControl`) y
  "Estado en origen" (`metadata.reportedStatus`, vacío "—" en propios y en importados sin ese dato). No se inventa un
  estado para propios (ni tramo ni etiqueta).
- **Edición en el browser (confirmada):** se mantiene la **prioridad inline** (`PriorityCell`, `case:write`) y las
  acciones en lote (asignar, prioridad, poner al día). No se agregan más celdas editables.
- Filtro por defecto `dpdMin=1` y créditos `ACTIVE` (o `DEFAULTED` PSF); `todos=1` sigue existiendo.
- Orden: `daysPastDue` (default desc), `balance`, `overdueAmount`, `priority`, `lastActionAt`, `createdAt`.
  **No** ordenable: `nextDueDate`, `moraSince` (JSON sin índice) → se ofrecen solo como columnas.
- Cobertura de créditos sin caso: la fila aparece con "—" en estado/prioridad y acción "Abrir caso" (ver T3).
- Selección en lote: se conserva `BulkActions`; opera solo sobre filas con caso (`caseIds`).

### 3.3 Búsqueda (`q`)
Hoy `q` = nombre palabra por palabra o zona (`ListCasesQueryDto`). Se amplía a: **Nº de crédito (`code`)**,
nombre/apellido/razón social, **documento** (por `nationalIdHash` exacto; el documento está cifrado, no se busca
por texto parcial), **teléfono** (VERIFICAR: `ClientContact.value` está cifrado → búsqueda por hash exacto
requeriría campo hash; si no existe, queda fuera y se documenta), zona (`client_locations.zone`) y dirección
(`address`). Lo que no sea indexable sin descifrar **no se promete**.

### 3.4 Filtros
| Filtro | Estado | Parámetro |
|---|---|---|
| Oficina | **nuevo** | `branchId` (select de `branches`) |
| Cobrador | existe | `assigneeId` (+ `unassigned`) |
| Días mín/máx | existe | `dpdMin`, `dpdMax` |
| Estado en origen | **no se incluye en esta entrega** | opcional y ausente en propios; se evalúa luego si algún tenant lo usa |
| Estado de gestión | existe | `status` (estado del caso) |
| Origen de mora | existe en UI como `source` mal nombrado | separar `arrearsSource` (CALCULATED/IMPORTED/MANUAL) de `source` (KOBRAX/PSF) |
| Fuente | existe | `source` |
| Prioridad | existe | `priority` |
| Saldo mín/máx | existe en API, falta en UI | `balanceMin/Max` |
| Promesa activa | existe en API, falta en UI | `hasPromise` |
| Sin gestión en N días | existe en API (`notVisitedSince`) | reusar semántica |
| SLA vencido | existe | `overdue` |
| Con/sin caso | **nuevo** | `hasCase` |

### 3.4 Permisos (reglas existentes + cambios)
- Lectura: `case:read` (sin cambios). Escritura de gestión: `case:write`. Asignar: `case:assign`. Cerrar: `case:close`.
  Pago: `payment:write`. Marcar/limpiar mora: `credit:write`.
- Alcance en lista y ficha (decisiones C2/C4, 2026-10-01): **COLLECTOR ve solo sus casos** (`case.assigneeId = userId`),
  como hoy (`scopedToOwnCases`). Los créditos sin caso y los casos sin asignar **no** los ve el cobrador: son de los
  roles superiores. Roles con `case:assign` (MANAGER, SUPERVISOR, admins) y lectura global (AUDITOR, VIEWER) ven
  **todo**, incluidos créditos sin caso y casos sin cobrador; para ellos hay filtros "Sin asignar" (`unassigned=true`)
  y "Sin caso" (`hasCase=false`). Consecuencia a tener presente: un crédito con `credits.assignedManagerId` = cobrador
  pero sin caso abierto no aparece para ese cobrador hasta que exista el caso.
- Oficina: **filtro**, no restricción (no hay alcance por oficina hoy). Ver decisión B2.
- PII: teléfonos/direcciones/documento siguen enmascarados con reveal auditado (`POST /api/clients/:id/reveal`).
- Nuevo endpoint ⇒ actualizar `permission-gates.spec.ts`.

### 3.5 Exportación
- Backend (no cliente): `GET /mora/export.csv` y `GET /mora/export.pdf`, mismo DTO de filtros que `GET /mora`
  (sin `page/limit`), mismo orden y mismo scope (`scopedToOwnCases`: el cobrador exporta solo sus casos).
  Auditoría `EXPORT` (como `logExport`) con los filtros aplicados y el conteo.
- **Permiso (decisión C3, 2026-10-01: exporta todo rol con acceso a Mora):** **no** se reparte `report:export`.
  🔴 Ese permiso también habilita `GET /exports/cases|clients|locations|backup`, que **no filtran por scope y
  revelan PII en claro**: dárselo a COLLECTOR/SUPERVISOR/VIEWER expondría la cartera completa. En su lugar se crea un
  permiso nuevo **`case:export`** (`permission.enum.ts` + `ROLE_PERMISSIONS`), concedido a todos los roles que ya
  tienen `case:read` (SUPER_ADMIN, ACCOUNT_ADMIN, MANAGER, SUPERVISOR, COLLECTOR, AUDITOR, VIEWER), y solo lo exige
  `/mora/export.*`. `report:export` queda igual. Actualizar seed y `permission-gates.spec.ts`.
- **CSV:** UTF-8 con BOM, separador y escape según `apps/api/src/modules/exports/csv.ts` (reusar, no duplicar),
  fechas ISO `YYYY-MM-DD`, importes con punto decimal y sin símbolo (columna `moneda` aparte), cabeceras en español.
  Columnas: nº crédito, deudor, documento **enmascarado**, saldo, moneda, monto vencido, cuota, último pago,
  próxima fecha, días mora, inicio mora, estado, origen de mora, fuente, prioridad, cobrador, oficina, última
  gestión, resultado última gestión, promesa activa. **Sin teléfonos ni dirección** (el export de cases actual
  revela PII en claro; aquí no).
- Volumen: stream con cursor por lotes de 1.000 (keyset por `id`+orden), sin cargar todo en memoria; tope duro
  configurable (propuesta 50.000 filas) con error claro "refina los filtros".
- **PDF:** `Report` (pdfkit) en `common/pdf/report.ts`. Título, fecha/hora de generación, **fecha de corte**
  (`max(reportedAsOf)` de los PSF incluidos, o "—"), filtros aplicados en texto legible (oficina, cobrador, mora,
  prioridad…), usuario, tabla paginada con cabecera repetida y pie `Página X de Y`, totales (n créditos, Σ saldo,
  Σ vencido) **por moneda y por fuente** (D7: no mezclar KOBRAX/PSF en silencio). Tope menor (propuesta 5.000
  filas) y aviso "usa CSV para el detalle completo".
- Web: botones "Exportar CSV/PDF" en `DataTable.actions`, como `<a>` a `app/api/mora/export?format=…&{query actual}`
  (proxy con lista blanca, igual que `app/api/exports/[type]`). Se ocultan sin `case:export`.
- "Exactamente lo consultado": el botón construye la URL desde los mismos searchParams que la tabla
  (helper compartido `moraQuery`), nunca desde estado paralelo.

### 3.6 Ficha `/mora/[creditId]`
Sin tabs (Cartera no las usa): una página con secciones y nav de anclas, mismo lenguaje visual (`Card`,
`Section`, `Fact`, `Badge`). Cada sección carga con su propio fetch y el patrón `denied`.

1. **Header** (`PageHeader`): deudor (link a `/cartera/[clientId]`), "Crédito {code}", chips: días de mora,
   saldo, estado, prioridad, `SourceBadge`, aviso "dato desactualizado" PSF. Acciones: Registrar gestión,
   Registrar pago (`PaymentModal`), Asignar, Cambiar estado/prioridad, Marcar/Poner al día (solo propios,
   `ArrearsActions`), Abrir caso (si no existe).
2. **Resumen financiero:** monto original, saldo, capital/interés/mora si hay cronograma, cuota, **monto vencido**
   (separado visualmente de saldo total), cuotas vencidas, último pago, próxima fecha, inicio de mora, progreso
   (`CreditProgress`). PSF: saldo y días "al dd/mm"; vencido "—".
3. **Mora actual e historial de mora:** episodio actual (inicio, días, DPD máx, origen) + lista de episodios
   anteriores (T11). Mientras no haya episodios propios: casos cerrados (aprox.) y, en PSF, serie de snapshots,
   con etiqueta "reconstruido".
4. **Gestiones** (timeline unificado): `case_activities` + `field_visits` (+evidencia) + pagos + asignaciones,
   ordenado por fecha. Formato pedido: `30 SEP · VISITA / Domicilio / Resultado: No encontrado / observación`.
   Filtro por tipo. Teléfono mostrado enmascarado; dirección/ubicación solo si se persistió.
5. **Promesas:** lista con monto, fecha, estado (vigente/cumplida/incumplida), derivada de `agenda_items`.
6. **Pagos:** `GET /payments?creditId=` (VERIFICAR filtro), con `channel` (Kobrax vs externo confirmado).
7. **Notas:** compactas, minimizadas por defecto (`🟡 texto`), expandibles; autor, fecha, tipo. Nuevo modelo (T12).
8. **Persona:** contactos y direcciones (`ContactList`/`LocationList`, reveal auditado), garantes y garantías
   **de este crédito** (`CreditGuarantor`, `CollateralCredit`), adjuntos del cliente (`AttachmentsSection`).
9. **Cronograma** (`PaymentPlanTable`) colapsado.
10. **Evidencias:** miniaturas desde `field_evidences` (con hash visible).

Vista del manager (§20 del pedido): quién lo tiene (`assignee` + `credit_assignments.startsAt`), desde cuándo,
cuánto debe, días, pagos, gestiones por tipo, resultados, promesas y cumplimiento, última y próxima acción
(`agenda_items` programados) — todo en la misma página, sin saltar de módulo.

---

## 4. Contrato común Web/Mobile (Fase 6) — nombres reales

Se define en `packages/shared` (tipos TS, patrón vigente; **sin zod**, no se introduce) y lo calcula el backend.

| Concepto | Nombre real hoy | Nuevo en shared |
|---|---|---|
| Crédito | `CreditDetail` (`client.types.ts:342`), `CreditOption` | `MoraCreditListItem`, `MoraCreditDetail` |
| Caso | `CaseListItem`, `CaseDetail` | embebido como `caseSummary` |
| Mora | `ArrearsSource`, `ArrearsMethod`, `agingBucket` | `MoraEpisode` |
| Asignación | `CreditAssignment` (API) | `MoraAssignee` |
| Pago | `PaymentItem`, `NewPayment` | sin cambios |
| Gestión | `CaseActivityItem`, `NewActivity`, `VisitItem` | `RecoveryActivityItem` (unión discriminada: activity/visit/payment/assignment) |
| Resultado | `VisitOutcome`, `AgendaOutcome` | `RECOVERY_RESULTS` etiquetas |
| Promesa | `ActivityPromise`, agenda `PROMISE_TO_PAY` | `MoraPromise {amount, dueDate, status}` |
| Nota | **no existe** | `CreditNote`, `NewCreditNote` |
| Contacto/Dirección | `PortfolioLocation`, endpoints de client | reuso |
| Evidencia | `EvidenceItem`, `EvidenceType` | reuso |
| Orden/filtros | `CASE_SORTS` | `MORA_SORTS`, `MoraListQuery` |

Operaciones del cobrador (contrato): ver crédito/mora/cliente (`GET /mora`, `GET /mora/:creditId`),
registrar llamada/visita/resultado/promesa (`POST /cases/:id/activities`, `POST /visits` — ya existen),
registrar pago (`POST /payments` con `Idempotency-Key`), agregar nota (`POST /credits/:id/notes`, nuevo),
agregar evidencia (`POST /visits/:id/evidence`), consultar dirección/teléfono (ficha de cliente, ya cacheada).

Regla: el cálculo de mora, vencido, aging, prioridad y estados queda en backend/shared (`computeArrears`,
`arrearsByMethod`, `computePriority`, `canTransition`). Web y mobile solo muestran.

---

## 5. Diseño Mobile (resumen; detalle en Fase 5 y plan F10)

Estado actual: `app/(tabs)/cobranza.tsx` (chip `overdue`, orden `mora` por `src/portfolio.ts`), ficha
`app/cliente/[id].tsx` (880 líneas, con `MoraSheet`), visitas en `app/rutas/resultado.tsx`, pendientes en
`app/pendientes.tsx`. No hay vista dedicada de mora, ni uso de `AGING_BUCKETS`.

- **Lista (cobrador):** tarjeta: nombre, nº crédito, días, saldo (vencido si existe), prioridad, última gestión +
  resultado, próxima acción (promesa vigente o visita agendada). Orden: prioridad → días. Chips: Crítica, Con
  promesa, Sin gestión N días. Fuente: nuevo `GET /mora` (mismo contrato, scope del cobrador).
- **Detalle:** arriba cliente/crédito/saldo/mora/prioridad; acciones: llamar (`tel:`), WhatsApp (si hay contacto
  WHATSAPP), iniciar visita (→ flujo `rutas/resultado`), registrar gestión, registrar pago, nota; después
  direcciones/teléfonos, últimas gestiones, notas, pagos, evidencias.
- **Campo:** reusar `currentLocation`/`resolveVisitCoords` (`gpsFallback`), `choosePhoto` + `uploadImage`,
  mapas MapLibre (`MiniMapCard`, `MapCanvas`). **Brecha:** no hay firma ni hash local (el hash lo da el servidor
  en `/api/uploads`); la etapa P8 de evidencia no está construida → la evidencia de mora usa el flujo actual.
- **Offline (encaja en lo existente, sin arquitectura nueva):**
  - Lectura: `cachedList`/`cachedOne` + `hydrate.ts`. Añadir un `CacheKind` (p. ej. `mora`) y que `hydrate`
    baje `GET /mora` del cobrador y la ficha de cada crédito (límite `MAX_FICHAS=150`). Datos offline mínimos:
    créditos asignados, cliente, saldo, mora, teléfonos, direcciones, últimas gestiones, notas, catálogos
    (ya hidratados).
  - Escritura: `queue.ts` ya soporta `visit` (con foto, pago y promesa dentro), `payment`, `case.activity`,
    `arrears.mark/clear`. **Nuevo:** `credit.note` (`QueueKind` en `db.ts:69-71` + `ACTION_LABEL` + `send()`),
    con id generado en el teléfono (`nuevoId()`) para idempotencia.
  - Conflictos: no hay resolución en el cliente; todas las acciones son append-only o idempotentes, un 4xx
    definitivo queda en `app/pendientes.tsx`. No se diseña nada paralelo.
  - Pago offline: ya permitido (`idempotencyKey`). En PSF no cambia saldo (D3): copy lo aclara.
- Jerarquía de producto: Web = consultar/supervisar/administrar/exportar; Mobile = ejecutar. Mobile no recibe
  filtros por oficina, exportación ni historial completo de episodios (solo el actual y el último).

---

## 6. Plan por fases

Orden ajustado respecto al pedido: **T11a (escritor de episodios) se adelanta a Fase 1** porque el historial
solo se acumula desde que se despliega; cuanto antes, más historia real tendrá la ficha cuando se construya.

| Fase | Contenido | Tareas |
|---|---|---|
| 0 | Auditoría y decisiones | este documento, T0 |
| 1 | Web — browser de créditos en mora (+ escritor de episodios) | T1, T2, T3, T11a |
| 2 | Web — filtros, búsqueda, permisos | T4 |
| 3 | Web — exportación CSV/PDF | T5, T6, T7 |
| 4 | Web — ficha de recuperación | T8, T9, T10 |
| 5 | Web — gestiones, notas, historial, métricas | T11b, T12, T13, T14, T15 |
| 6 | Contratos compartidos | T16 |
| 7 | Mobile — lista del cobrador | T17 |
| 8 | Mobile — detalle y acciones | T18 |
| 9 | Mobile — offline/sync/evidencias | T19 |
| 10 | Tests, regresión, estabilización | T20 |

Ramas: una por fase desde `main` (`feat/mora-f1-browser`, …). Antes de Mobile, cada slice F10 pasa
`/f10-validar-plan` (gate vigente del repo). Ningún merge sin la frase de autorización del usuario.

---

### TASK T0 — Cerrar decisiones bloqueantes
**Objetivo:** resolver §10-C antes de implementar T3/T5/T12.
**Por qué:** cambian modelo de datos y permisos.
**Archivos a modificar:** este documento (sección 10).
**Tests/Migración/Riesgos:** n/a. Riesgo: arrancar T3 sin saber qué es "Estado".
**Criterios de aceptación:** las 4 decisiones C1–C4 con respuesta escrita y fecha.

---

### TASK T1 — Base de datos e índices para la lista por crédito
**Objetivo:** que listar/ordenar créditos en mora sea viable con ~300k créditos.
**Por qué:** `credits.days_past_due` no tiene índice; `/cases` ordena por join (el propio job menciona 300.010 créditos).
**Archivos a modificar:** `packages/database/prisma/schema.prisma` (modelo `Credit`, índices).
**Archivos a crear:** migración `packages/database/prisma/migrations/<ts>_mora_indices/migration.sql`
(índice parcial `(account_id, days_past_due DESC, id) WHERE deleted_at IS NULL AND days_past_due > 0` y, si el
plan lo exige, `(account_id, branch_id)`; índice en `payments(credit_id, payment_date DESC)` si falta — VERIFICAR).
**Componentes existentes a reutilizar:** patrón de migraciones SQL del repo (`20260930000000_creditos_de_fuente_externa`).
**Backend:** ninguno. **Frontend Web / Mobile:** ninguno.
**Datos:** solo índices; no cambia columnas. **Permisos:** RLS ya cubre `credits`.
**UX/UI:** n/a.
**Tests:** `EXPLAIN` documentado en el PR con 300k créditos de desarrollo.
**Migración:** aditiva, `CREATE INDEX CONCURRENTLY` fuera de transacción si Prisma lo exige (VERIFICAR).
**Dependencias:** ninguna.
**Riesgos:** locks en tabla grande; índice parcial no usado si la query no repite el predicado.
**Criterios de aceptación:** `GET /mora?sort=daysPastDue` p95 aceptable sobre 300k créditos; sin regresión en `/cases`.

---

### TASK T2 — Contrato compartido mínimo del browser
**Objetivo:** tipos y query de la lista.
**Por qué:** web y mobile deben pedir lo mismo.
**Archivos a crear:** `packages/shared/src/types/mora.types.ts` (`MoraCreditListItem`, `MoraListQuery`,
`MORA_SORTS`), export en `packages/shared/src/types/index.ts`.
**Archivos a modificar:** `packages/shared/src/index.ts` si hace falta.
**Reutilizar:** forma de `CaseListItem` (`case.types.ts:34-87`), `ArrearsSource`, `CaseStatus`, `CasePriority`,
`CREDIT_SOURCES`, `PageMeta`/`PaginatedDto`.
**Backend/Web/Mobile:** consumen el tipo. **Datos:** ver §2.1.
**Permisos:** n/a. **UX/UI:** n/a.
**Tests:** `packages/shared` con vitest (`*.spec.ts`): defaults y parseo de `MoraListQuery`.
**Migración:** n/a. **Dependencias:** ninguna. **Riesgos:** divergir de `CaseListItem` (mantener nombres iguales).
**Criterios de aceptación:** `pnpm --filter @kobrax/shared test` y type-check de api/web/mobile en verde.

---

### TASK T3 — Backend: `GET /mora` (lista por crédito)
**Objetivo:** devolver una fila por crédito en mora, con caso opcional.
**Por qué:** hoy los créditos sin caso no aparecen y faltan columnas (oficina, vencido, último pago, resultado).
**Archivos a crear:** `apps/api/src/modules/mora/{mora.module.ts, mora.controller.ts, mora.service.ts,
dto/mora.dto.ts, mora-query.ts, mora.service.spec.ts}`; registrar en `app.module.ts`.
**Archivos a modificar:** `apps/api/src/modules/auth/.../permission-gates.spec.ts` (si enumera controladores).
**Reutilizar:** de `cases.service.ts` la lógica de `list` (filtros `dpdMin/Max`, `balanceMin/Max`, `source`,
`hasPromise`, `notVisitedSince`, `q`) y `scopedToOwnCases`; `ResponseDto.paginated`; `TenantContextService.can`.
Extraer a helper compartido (`cases/case-filters.ts`) en vez de copiar.
**Backend:** `GET /mora` (`@Roles(Permission.CASE_READ)`); base `Credit` LEFT JOIN caso abierto
(`CollectionCase` con `closedAt IS NULL`); `overdueAmount` por cuotas (null si PSF/sin cronograma);
`lastPaymentAt` y `lastActivityResult` por subquery; `branch` por join. Orden con desempate `id`.
Elegibles: `status IN (ACTIVE)` o `DEFAULTED` con `externalSource`; `daysPastDue > 0` salvo `todos=1`.
`POST /mora/:creditId/open-case` → delega en `openCaseIfNone` (permiso `case:write`).
**Frontend Web / Mobile:** ninguno aún. **Datos:** ver §2.1.
**Permisos:** scope COLLECTOR = solo `case.assigneeId = userId` (los créditos sin caso y los casos sin asignar los ven
solo roles superiores); resto, todo el tenant. Filtros `unassigned` y `hasCase`.
**UX/UI:** n/a.
**Tests:** un registro por crédito; COLLECTOR no ve créditos sin caso ni casos de otro; MANAGER ve ambos; cliente con 3 créditos (1 al día, 2 en mora) → 2 filas; crédito sin caso
aparece; PSF stale aparece marcado; scope COLLECTOR; orden estable en paginación; multi-tenant (RLS).
**Migración:** ninguna (T1 ya aporta índices).
**Dependencias:** T1, T2. **Riesgos:** `COUNT(*)` caro a 300k (usar `total` aproximado o cache corto — decidir con
`EXPLAIN`); N+1 en subqueries (usar `LATERAL`/agregado por lote).
**Criterios de aceptación:** respuesta `{data, meta, error}`; p95 aceptable; cobertura de los casos de test; sin PII en claro.

---

### TASK T4 — Web: browser `/mora` por crédito
**Objetivo:** reemplazar la tabla de casos por créditos conservando el lenguaje de Cartera.
**Por qué:** pedido central. **Archivos a modificar:** `apps/web/src/app/(panel)/mora/page.tsx`,
`arrears-table.tsx`, `bulk-actions.tsx`, `priority-cell.tsx`, `apps/web/src/lib/cases.ts` (o nuevo
`lib/mora.ts` con `moraQuery`/`MoraParams`), `src/messages/{es,en}.json` (namespace `panel.cases`/nuevo `panel.mora`).
**Archivos a crear:** `apps/web/src/lib/mora.ts`, `lib/mora.test.ts`, `(panel)/mora/arrears-table.test.tsx`.
**Reutilizar:** `DataTable` (`tableId="mora"`), `FilterPanel`, `SearchBox`, `Badge`, `SourceBadge`, `PriorityCell`,
`BulkActions`, `money/date` de `lib/format.ts`.
**Backend:** consume `GET /mora`. **Datos:** columnas de §3.2.
**Permisos:** menú sin cambios (`CASE_READ`); acciones por `can()`.
**UX/UI:** primera columna Nº de crédito (link a `/mora/${creditId}`), deudor debajo/segunda; sin rediseño visual;
fila sin caso: estado/prioridad "—" y botón "Abrir caso" solo con `case:write`.
**Tests:** una fila por crédito; cliente con varios créditos; paginación; orden; columnas por defecto; bulk
deshabilitado en filas sin caso; i18n paridad.
**Migración:** n/a. **Dependencias:** T2, T3.
**Riesgos:** regresión del bulk (opera por `caseIds`); `crumbsFor` oculta uuids (verificar breadcrumb).
**Criterios de aceptación:** `/mora` lista créditos; Nº de crédito primero; ningún caso duplicado; `vitest` verde.

---

### TASK T11a — Escritor de episodios de mora (adelantado a Fase 1)
**Objetivo:** empezar a persistir historial de mora **desde ya**.
**Por qué:** no hay historial independiente y no puede reconstruirse para créditos Kobrax sin cronograma.
**Archivos a modificar:** `packages/database/prisma/schema.prisma`; `apps/api/src/modules/arrears/arrears-job.service.ts`
(`arrearsFor`/transiciones); `cases/case-lifecycle.ts`; `credits/credits.service.ts` (`markArrears`, `clearArrears`);
importador `imports/portfolio-import.service.ts` (aparece/ausente/reaparece).
**Archivos a crear:** migración `<ts>_credit_arrear_episodes/migration.sql` (con política RLS `tenant_isolation`,
como el resto), `apps/api/src/modules/arrears/arrear-episodes.service.ts` + spec.
**Datos (modelo nuevo `CreditArrearEpisode`, tabla `credit_arrear_episodes`):** `id`, `accountId`, `creditId`,
`startedAt` (fecha de inicio de la mora), `endedAt?`, `endReason?` (reutilizar valores de `CaseCloseReason` +
`WRITTEN_OFF`), `startDaysPastDue`, `maxDaysPastDue`, `balanceAtStart`, `balanceAtEnd?`, `source`
(`ArrearsSource`), `reconstructed Boolean @default(false)`, `createdAt`, `updatedAt`. Índices `(accountId, creditId, startedAt desc)`
y único parcial "un episodio abierto por crédito". **No** se almacenan snapshots diarios (no solicitado).
**Backend:** el job abre episodio al cruzar de 0→>0, actualiza `maxDaysPastDue`, lo cierra al volver a 0/PAID/ausente;
las acciones manuales y el importador usan el mismo servicio (una sola fuente de la transición, no lógica duplicada).
Funciona para propios **y** PSF (no depende de que exista caso).
**Backfill:** script idempotente `packages/database/scripts/backfill-arrear-episodes.ts`: a partir de `collection_cases`
(createdAt→closedAt/closedReason) y `credit_external_snapshots` (transiciones de `reportedDaysPastDue`), marcando
`reconstructed=true`. Créditos Kobrax sin caso ni snapshot: sin episodio previo.
**Frontend/Mobile:** ninguno aquí. **Permisos:** solo lectura vía endpoints de T8/T11b.
**Tests:** transición 0→>0 abre; >0→0 cierra con motivo; reentrada abre episodio nuevo (#2); PSF ABSENT/REAPPEARED;
idempotencia del job (correr dos veces no duplica); RLS por tenant; backfill idempotente.
**Migración:** aditiva; sin tocar tablas existentes.
**Dependencias:** ninguna (puede ir en paralelo a T1–T4). **Riesgos:** doble escritura entre job/manual/import
(mitigado con servicio único + índice único parcial); costo en el job de 300k créditos (solo escribir en transición).
**Criterios de aceptación:** tras correr el job en dev, cada crédito en mora tiene exactamente un episodio abierto;
cerrar/reabrir produce #1, #2; backfill marcado `reconstructed`.

---

### TASK T5 — Backend: exportación CSV
**Objetivo:** `GET /mora/export.csv` con exactamente el filtro/orden/scope consultado.
**Archivos a modificar:** `mora.controller.ts`, `mora.service.ts`, `exports/csv.ts` (solo si falta helper).
**Archivos a crear:** `mora/mora-export.service.ts` + spec.
**Reutilizar:** `csv.ts` (escape), `logExport` (auditoría `EXPORT`), `StreamableFile`, mismo `MoraListQuery`.
**Backend:** ver §3.5 (BOM, columnas, streaming por keyset, tope). `@Roles(Permission.REPORT_EXPORT, Permission.CASE_READ)`.
**Frontend Web:** ver T7. **Datos:** columnas §3.5 (documento enmascarado, sin teléfonos/direcciones).
**Permisos:** nuevo `case:export` para todo rol con `case:read` (decisión C3). Crear el permiso en
`packages/shared/src/enums/permission.enum.ts` y `constants/permissions.ts` (`ROLE_PERMISSIONS`), seed y
`permission-gates.spec.ts`. `report:export` no se toca (ver §3.5).
**Tests:** CSV filtrado = lista filtrada (mismo conjunto, mismo orden); COLLECTOR exporta solo sus casos; sin
`case:export` → 403; COLLECTOR con `report:export` ausente sigue sin acceso a `/exports/cases`; encoding/BOM; caracteres especiales; 50k filas sin picos de memoria; `AuditLog EXPORT`.
**Migración:** n/a. **Dependencias:** T3. **Riesgos:** divergencia entre lista y export (mitigar compartiendo el
constructor de `where`); PII.
**Criterios de aceptación:** descarga idéntica en filas a la tabla filtrada; auditado.

---

### TASK T6 — Backend: exportación PDF
**Objetivo:** `GET /mora/export.pdf` como reporte real.
**Archivos a crear:** `apps/api/src/modules/mora/mora-pdf.ts` (patrón `client-pdf.ts`/`route-pdf.ts`) + spec.
**Reutilizar:** `common/pdf/report.ts` (`Report`, `TableColumn<T>`, `arrearsTone`), mismo `where` de T5.
**Backend:** contenido y totales por moneda/fuente según §3.5; tope 5.000 filas.
**Permisos/Migración:** como T5 / n/a. **Dependencias:** T3, T5 (constructor de `where` y servicio de datos).
**Tests:** PDF generado con filtros en el encabezado; paginación (varias páginas); totales correctos; scope;
403 sin permiso; tope.
**Riesgos:** fuentes/acentos en pdfkit; tiempos con 5.000 filas.
**Criterios de aceptación:** PDF con título, fecha de generación, fecha de corte, filtros, tabla y pie de página.

---

### TASK T7 — Web: botones de exportación
**Objetivo:** "Exportar CSV/PDF" sobre el resultado actual.
**Archivos a crear:** `apps/web/src/app/api/mora/export/route.ts` (proxy con lista blanca de formato, stream +
`Content-Disposition`, patrón `app/api/exports/[type]/route.ts`), `mora/export-buttons.tsx`.
**Archivos a modificar:** `arrears-table.tsx` (prop `actions` de `DataTable`).
**Reutilizar:** `DataTable.actions`, `sameOrigin`, `useToast`, `lib/mora.ts` (misma query).
**UX/UI:** botones `h-8`/`rounded-lg` como el resto de barras; ocultos sin `case:export`; si hay >tope, aviso.
**Tests:** la URL contiene exactamente los filtros activos; sin permiso no se renderiza; error 4xx muestra toast.
**Dependencias:** T5, T6. **Riesgos:** query desfasada entre tabla y export. **Criterios:** export = tabla.

---

### TASK T8 — Backend: ficha `GET /mora/:creditId`
**Objetivo:** endpoint agregado de cabecera + resumen.
**Archivos a modificar:** `mora.controller.ts`, `mora.service.ts`. **A crear:** `dto`, tipos `MoraCreditDetail` (T2/T16).
**Reutilizar:** `credits.service.ts` (detalle y cronograma), `cases.service.ts#findOne` (scope), `Arrear`/`computeArrears`,
`payment-suggestion.ts`, `external-report.ts`.
**Backend:** `GET /mora/:creditId` (`case:read`): crédito, cliente, caso abierto, asignado y desde cuándo
(`credit_assignments`), vencido, cuotas vencidas, último pago, próxima fecha, episodio actual. Secciones pesadas
(gestiones, pagos, notas, episodios) en endpoints separados para el patrón `denied` por sección:
`GET /mora/:creditId/activities`, `/payments`, `/promises`, `/episodes`, `/notes`, `/metrics`.
Si `:creditId` es id de caso → 301/redirect lógico (campo `redirectToCreditId`).
**Permisos:** mismo scope que T3 (404 si fuera de alcance, no 403, para no filtrar existencia).
**Tests:** crédito propio y PSF; fuera de scope; crédito sin caso; id de caso legacy.
**Dependencias:** T3. **Riesgos:** cuotas/vencido para PSF (null explícito). **Criterios:** payload cubre header y resumen.

---

### TASK T9 — Web: ficha `/mora/[creditId]` (header, resumen, persona)
**Objetivo:** ficha de recuperación reutilizando Cartera.
**Archivos a crear:** `(panel)/mora/[creditId]/{page.tsx, recovery-header.tsx, financial-summary.tsx,
person-section.tsx, section-nav.tsx}` + tests. **A modificar/eliminar:** `(panel)/mora/[id]/*` (se reubica; `CaseActions`,
`StatusControl` pasan a la nueva carpeta).
**Reutilizar:** `PageHeader`, `Card`, `Fact`, `Section`, `Badge`, `CreditProgress`, `PaymentModal`, `ArrearsActions`,
`ContactList`/`LocationList`, `GuarantorsSection`, `CollateralsSection`, `AttachmentsSection`, `PaymentPlanTable`.
Extraer de `credit-view.tsx` los bloques de lectura (`terms/current/plan/origin`) a componentes compartidos
**sin cambiar su comportamiento** (Cartera no debe regresar).
**Permisos:** `denied` por sección; reveal auditado; acciones por `can()`.
**UX/UI:** header según §3.6 (ej.: "Fernando Blanco Choque · Crédito 302-222-9734 · 391 días · Bs 7.011,42 · estado · Crítica").
**Tests:** ficha correcta del crédito (no del cliente), PSF vs propio, sección denegada no rompe la página, acciones por permiso.
**Dependencias:** T8. **Riesgos:** tocar `credit-view.tsx` (649 líneas) → cubrir con tests existentes de cartera antes.
**Criterios:** header + resumen + persona visibles; enlace desde la lista.

---

### TASK T10 — Web: compatibilidad de rutas y enlaces
**Objetivo:** que ningún enlace a `/mora/<caseId>` se rompa.
**Archivos a modificar:** `app/(panel)/mora/[creditId]/page.tsx` (redirect), `cases-section.tsx`, enlaces de
notificaciones/bitácora, `lib/nav.ts` (`crumbsFor`).
**Tests:** `/mora/<caseId>` redirige a `/mora/<creditId>`; `/mora/<creditId>` carga; id inexistente → 404.
**Dependencias:** T8, T9. **Riesgos:** notificaciones push móviles con deep link a caso (VERIFICAR en `notifications`).
**Criterios:** cero 404 en enlaces existentes.

---

### TASK T11b — Historial de mora en la ficha
**Objetivo:** mostrar episodios.
**Backend:** `GET /mora/:creditId/episodes` (episodios de T11a; si `reconstructed`, marcar; PSF: serie de snapshots).
**Web:** `mora/[creditId]/arrears-history.tsx` — "Mora #n · inicio → fin/pendiente · DPD máx · saldo · motivo".
**Tests:** crédito con 2 episodios cerrados + 1 abierto; sin historial → "Sin historial previo"; PSF con snapshots.
**Dependencias:** T9, T11a. **Riesgos:** expectativas de historial pasado (comunicar "reconstruido").
**Criterios:** orden cronológico, abierto marcado "actual".

---

### TASK T12 — Notas por crédito
**Objetivo:** notas independientes del caso.
**Por qué:** no existe sistema reutilizable; `CaseActivity NOTE` depende del caso y se pierde conceptualmente al cerrarlo.
**Archivos a modificar:** `schema.prisma`. **A crear:** migración con RLS; `apps/api/src/modules/credit-notes/*` (módulo
pequeño: `POST /credits/:id/notes`, `GET /mora/:creditId/notes`), `shared` `CreditNote/NewCreditNote`, web `notes-section.tsx`.
**Datos (`CreditNote`, tabla `credit_notes`):** `id` (acepta id del cliente para idempotencia móvil), `accountId`,
`creditId`, `clientId`, `authorId`, `body` (≤1000, igual que gestión), `kind` (`INFO | WARNING | IMPORTANT`),
`createdAt`; **append-only** (coherente con `CaseActivity`); sin edición/borrado en esta fase.
**Reutilizar:** `AuditService`, patrón de módulo, `Badge`/`Card`. **Permisos:** leer `case:read`; escribir `case:write`.
**UX/UI:** compactas, minimizadas por defecto, expandibles; 🟡 = `WARNING/IMPORTANT`.
**Tests:** crear/leer; permisos; aislamiento por tenant; idempotencia por `id`; scope COLLECTOR.
**Dependencias:** T9. **Riesgos:** notas viejas de `CaseActivity NOTE` — se muestran en el timeline de gestiones, no se migran.
**Criterios:** nota creada en ficha, visible para el equipo autorizado, auditada.

---

### TASK T13 — Gestiones: formulario completo y timeline unificado
**Objetivo:** registrar gestión con **resultado** y **promesa**, y ver el historial completo.
**Archivos a modificar:** `mora/[creditId]/case-actions.tsx` (campos `result`, `promise {amount, promiseDate,
paymentMethodCode, bankCode}`, teléfono usado/dirección si se decide capturar), `app/api/cases/[id]/activities/route.ts`
(solo si hace falta pasar campos), `mora.service.ts` (`GET /mora/:creditId/activities`).
**Archivos a crear:** `mora/[creditId]/activity-timeline.tsx` + `activity-form.tsx`.
**Reutilizar:** `NewActivity`, `ActivityPromise`, `POST /cases/:id/activities` (ya acepta `result` y `promise` y crea
`agenda_item`), `VisitOutcome`, timeline `GET /clients/:id/timeline` como referencia de la unión SQL.
**Backend:** si el crédito no tiene caso, `POST /mora/:creditId/activities` abre el caso (`openCaseIfNone`) y delega a
`CasesService.addActivity` (una sola lógica). Timeline = `case_activities` ∪ `field_visits`(+evidencia) ∪ `payments` ∪
asignaciones, paginado, filtrable por tipo.
**Permisos:** `case:write`. **UX/UI:** formato `30 SEP · VISITA / Domicilio / Resultado / observación` (§18).
**Tests:** gestión con resultado y promesa crea `agenda_item`; sin caso abre uno; visita aparece con GPS/evidencia;
orden; teléfono enmascarado.
**Dependencias:** T9. **Riesgos:** duplicar visita+actividad (la visita ya inserta su `case_activity` VISIT → deduplicar
por `visitId` en el timeline). **Criterios:** historial reconstruible sin salir de la ficha.

---

### TASK T14 — Pagos y promesas en la ficha
**Objetivo:** secciones Pagos y Promesas.
**Backend:** `GET /mora/:creditId/payments` (VERIFICAR `GET /payments?creditId=`; si falta el filtro, añadirlo en `payments`),
`GET /mora/:creditId/promises` (agenda `PROMISE_TO_PAY`: monto, fecha, `vigente|cumplida|incumplida` según `AgendaOutcome`).
**Web:** `payments-section.tsx`, `promises-section.tsx`; `PaymentModal` con `credit={{id, code, suggestedAmount, external}}`.
**Tests:** pago registrado aparece; canal `EXTERNAL_CONFIRMED` rotulado; PSF: copy "no modifica el saldo reportado" (D3).
**Dependencias:** T9. **Riesgos:** estado de promesa depende del job `promise-due`. **Criterios:** coinciden con `/pagos`.

---

### TASK T15 — Métricas de recuperación de la ficha
**Objetivo:** mostrar las métricas CALCULABLES/EXISTENTES de §2.3 (sin dashboards nuevos).
**Backend:** `GET /mora/:creditId/metrics`: monto recuperado, nº gestiones/llamadas/visitas, promesas
(hechas/cumplidas/incumplidas), días hasta primer contacto/visita/pago (relativo al episodio actual).
**Web:** `recovery-metrics.tsx` (fila de `Fact`). **Tests:** cálculo con datos fijos; episodio sin gestiones → "—".
**Dependencias:** T11a, T13, T14. **Riesgos:** métricas dependen de que el episodio exista.
**Criterios:** valores correctos; las no calculables se muestran "—", nunca 0 inventado.

---

### TASK T16 — Contratos compartidos finales (Fase 6)
**Objetivo:** congelar el contrato para Mobile.
**Archivos:** `packages/shared/src/types/mora.types.ts` (+`MoraCreditDetail`, `MoraEpisode`, `MoraPromise`,
`RecoveryActivityItem`, `CreditNote`, `NewCreditNote`), enums de etiquetas de resultado.
**Tests:** vitest de tipos/guards; type-check en api/web/mobile. **Dependencias:** T3–T15.
**Riesgos:** cambios de contrato tarde. **Criterios:** web y mobile compilan con el mismo tipo; ningún cálculo de mora fuera de shared/backend.

---

### TASK T17 — Mobile: lista de mora del cobrador
**Objetivo:** vista de trabajo de mora.
**Archivos a modificar:** `apps/mobile/app/(tabs)/cobranza.tsx` (o nueva pestaña/ruta bajo `app/`), `src/portfolio.ts`,
`src/cases.service.ts` (nuevo `listMora` → `GET /mora`), `src/sync/hydrate.ts` (hidratar), `src/db.ts` (`CacheKind` nuevo).
**Archivos a crear:** `src/mora.service.ts`, `src/mora.ts` (ordenar/filtrar) y `src/mora.test.ts`.
**Reutilizar:** `cachedList`, `OfflineIndicator`, `agingBucket` de shared, tarjetas de `cobranza.tsx`.
**UX:** tarjeta §5. **Permisos:** scope del servidor. **Tests (jest-expo):** orden, filtros, caché offline,
`hydrate` incluye mora. **Dependencias:** T16. **Riesgos:** duplicar `groupPortfolio` (reusar). Convertir a slice F10 + `/f10-validar-plan`.
**Criterios:** el cobrador ve sus créditos en mora con y sin red.

---

### TASK T18 — Mobile: detalle y acciones de recuperación
**Objetivo:** detalle por crédito con acciones.
**Archivos a modificar:** `app/cliente/[id].tsx` (hoy 880 líneas; **extraer** secciones en componentes antes de añadir),
nueva ruta `app/mora/[creditId].tsx`. **A crear:** `src/mora-detail.tsx`, `src/credit-notes.service.ts`.
**Reutilizar:** `MoraSheet`, `createPayment`, `case.activity`, `rutas/resultado.tsx` para visita, `Linking` para `tel:`/WhatsApp.
**Tests:** crédito correcto, acciones, nota, pago, gestión con promesa. **Dependencias:** T17.
**Riesgos:** pantalla ya grande; refactor mínimo y con tests. **Criterios:** llamar/visitar/registrar en ≤3 toques.

---

### TASK T19 — Mobile: offline, sync y evidencias
**Objetivo:** acciones de mora offline sin arquitectura paralela.
**Archivos a modificar:** `src/sync/queue.ts` (`QueuedAction` + `ACTION_LABEL` + `send()`), `src/db.ts` (`QueueKind`),
`src/sync/hydrate.ts`, `app/pendientes.tsx`. **Nuevo kind:** `credit.note`.
**Reglas:** id del teléfono (`nuevoId()`), servidor idempotente por id; un 4xx definitivo → `REJECTED`.
**Evidencia:** flujo actual `choosePhoto`/`uploadImage` dentro de `visit`; firma y hash local quedan **fuera**
(dependen de P8, no construida) — documentado como brecha.
**Tests:** cola FIFO, reintento, rechazo permanente, sin red → encola, reconexión → drena, idempotencia de nota.
**Dependencias:** T12, T18. **Riesgos:** cache de mora desactualizado → mostrar `localAt`; no hay resolución de conflictos (todo append-only).
**Criterios:** registrar visita/llamada/nota/pago sin red y verlo sincronizado al volver.

---

### TASK T20 — Tests, regresión y estabilización
**Backend:** specs de T3/T5/T6/T8/T11a/T12; `permission-gates.spec.ts` actualizado; RLS por tenant.
**Web (Vitest+MSW):** lista (un registro por crédito, cliente con varios créditos), filtros, búsqueda, oficina,
cobrador, prioridad, estado, origen, orden, paginación, permisos por rol, ficha correcta, gestiones, pagos, notas,
export CSV/PDF (filtrado, permisos, volumen, datos), paridad i18n es/en.
**Mobile (jest-expo):** lista, detalle, acciones, offline/sync, idempotencia, rechazo.
**Regresión:** Cartera (`credit-view`, `client-card`), `/pagos`, `/exportar`, job de mora (`arrears-job.service.spec.ts`),
`cases.service.spec.ts`.
**Comandos:** `pnpm --filter @kobrax/{api,web,mobile,shared} test` y type-check; `npx expo export --platform android`.
**Criterios:** verde en CI; ningún flujo de caso previo roto.

---

## 7. Matriz final

| Área | Existe | Reutilizar | Modificar | Crear | No disponible |
|---|---|---|---|---|---|
| Browser Web | `/mora` por **caso** | `DataTable`, `FilterPanel`, `SearchBox`, `PriorityCell`, `BulkActions` | `arrears-table.tsx`, `page.tsx`, `lib/cases.ts` | `GET /mora`, `lib/mora.ts` | filas de créditos sin caso |
| Filtros | assignee, dpd, source, priority, status, overdue | `FilterDef` | separar `arrearsSource`/`source` | `branchId`, `hasCase` | filtro por oficina como restricción de scope |
| Búsqueda | `q` nombre/zona | `SearchBox` | ampliar a nº crédito/documento | — | teléfono parcial (cifrado) |
| Export PDF | `pdfkit`, `Report`, PDFs de cliente/ruta | `Report`, `TableColumn` | — | `mora-pdf.ts`, proxy web | PDF de `/exports/cases` |
| Export CSV | `/exports/cases` (sin filtros, PII en claro), `csv.ts` | `csv.ts`, `logExport`, `StreamableFile` | — | `GET /mora/export.csv`, proxy | export filtrado hoy |
| Ficha crédito | `credit-view.tsx` (Cartera), `/mora/[id]` (caso) | `PaymentModal`, `ArrearsActions`, `PaymentPlanTable`, secciones de cliente | extraer lectura de `credit-view` | `/mora/[creditId]` | tabs (patrón no existe) |
| Gestiones | `case_activities`, `field_visits`, `POST /cases/:id/activities` | `NewActivity`, `VisitOutcome` | form (result/promesa) | timeline unificado, `POST /mora/:id/activities` | teléfono/dirección usados (no se persiste) |
| Notas | solo `CaseActivity NOTE` | `AuditService` | — | `CreditNote`, módulo, UI | edición/borrado |
| Historial mora | `collection_cases`, PSF snapshots, `AuditLog` | — | job, `credits.service`, importador | `CreditArrearEpisode` + backfill | mora Kobrax anterior sin cronograma |
| Offline | `expo-sqlite`, `cache`, `queue`, `hydrate`, `drain` | todo | `queue.ts`, `db.ts`, `hydrate.ts` | kind `credit.note`, `CacheKind` mora | sync incremental, resolución de conflictos, firma, hash local |
| Mobile | chip "En mora", `MoraSheet`, avisos PSF | `cobranza.tsx`, `cliente/[id].tsx`, `resultado.tsx` | `cliente/[id].tsx` (extraer) | lista y detalle de mora, `mora.service.ts` | permisos/gating por rol (P10), aging en UI |

---

## 8. Riesgos transversales
1. **Rendimiento a 300k créditos:** índices (T1) y evitar `COUNT` exactos caros; medir antes de afirmar.
2. **Doble verdad de mora** (`days_past_due` vs `metadata.moraSince`): la lista usa la columna; `moraSince` solo se muestra.
3. **Créditos sin caso:** cambia quién "ve" qué; mitigado por scope `assignedManagerId` y acción "Abrir caso".
4. **PSF:** vencido y estados dependen del reporte; nunca mezclar KOBRAX/PSF en totales (D7); respetar D3/D4/D5/D9.
5. **Tocar `credit-view.tsx` y `cliente/[id].tsx`** (archivos grandes): extraer con tests previos.
6. **PII en exportes:** el export existente revela PII; el de mora no.
7. **Contrato tardío:** congelar tipos en T2/T16 y no recalcular en cliente.

---

## 9. Decisiones

### A. Confirmadas por el código
- A1. La unidad es el crédito; hoy la fila de `/mora` es el caso (`CaseListItem`, `case.id`).
- A2. No existe historial de mora independiente; `Arrear` es snapshot por crédito.
- A3. No existe modelo de notas por crédito/cliente.
- A4. No hay alcance por oficina en lectura; el único scope real es "cobrador ve lo suyo" (por `assigneeId` del caso).
- A5. `report:export` solo lo tienen MANAGER, AUDITOR y admins (no SUPERVISOR ni COLLECTOR). Para Mora se crea `case:export` (C3).
- A6. Hay infraestructura PDF (`pdfkit` + `Report`) y CSV (`csv.ts`, `StreamableFile`) en backend; en web no hay librería de ninguno.
- A7. Offline móvil = `expo-sqlite` + `cache` + `queue` idempotente; no WatermelonDB, no cursor, no conflictos.
- A8. `GET /exports/cases` no acepta filtros y expone PII en claro.
- A9. Prioridad, estado y SLA viven en el **caso**; oficina y responsable también existen en el crédito.
- A10. Adjuntos son del cliente (`ClientAttachment` sin `creditId`); garantes y garantías sí están ligados al crédito.

### B. Recomendadas (hay alternativas)
- B1. `GET /mora` nuevo en backend (lista por crédito con caso opcional) en vez de reutilizar `/cases`. Reutilizar `/cases` no muestra créditos sin caso y no trae oficina/vencido/último pago.
- B2. Oficina como **filtro**, no como restricción de acceso (no inventar `BRANCH` scope en este plan).
- B3. Export CSV/PDF en backend (no en el navegador) y sin PII en claro.
- B4. Tabla propia `credit_arrear_episodes` (no `jsonb` en `credits.metadata`) para poder indexar y reportar.
- B5. Notas en tabla nueva `credit_notes`, append-only, en vez de reutilizar `CaseActivity NOTE` (depende de caso).
- B6. Ficha en una página con secciones y anclas (sin tabs), como Cartera.
- B7. Adelantar el escritor de episodios (T11a) a la Fase 1.
- B8. Mobile: reutilizar `GET /mora` + `hydrate`/`cachedList`; sin nueva infraestructura offline.

### C. Bloqueantes — RESUELTAS (2026-10-01, respuesta de la dueña)
- **C1. Estado.** "Ejecución" no es un valor de `CaseStatus` ni de `CreditStatus`: viene del archivo importado y se guarda
  como etiqueta cruda en `metadata.reportedStatus`, solo si el formato mapeó esa columna. Decisión final: **no hay
  columna de estado visible por defecto** (propios e importados conviven, y el dato no existe para propios ni
  siempre en importados). "Estado de gestión" y "Estado en origen" son columnas opcionales apagadas, sin filtro nuevo
  de estado de origen. Prioridad inline y acciones en lote: se mantienen. En la ficha el header no depende del
  estado: muestra días, saldo y prioridad, y el estado en origen solo si existe.
- **C2. Créditos sin caso:** se muestran todos (a los roles que ven todo; ver C4).
- **C3. Exportar:** pueden todos los roles con acceso a Mora, mediante un permiso nuevo `case:export`. No se reparte
  `report:export` porque abriría `/exports/cases` (sin scope, PII en claro).
- **C4. Cobrador:** ve solo sus casos (`case.assigneeId`). Lo que no tiene asignado (casos sin cobrador y créditos
  sin caso) lo ven los roles superiores. No se usa `credits.assignedManagerId` para el alcance.

### Pendiente de VERIFICAR en código (no bloquea el plan)
- Filtro `creditId` en `GET /payments`; búsqueda por teléfono/documento dado el cifrado de `ClientContact.value`;
  contenido de `field_visits.details` (teléfono/dirección usados); índices actuales de `payments`; deep links de
  notificaciones a `/mora/<caseId>`; campos de `AnalyticsQueryDto`; `ClientImportRun*`.

---

## 10. Fuera de alcance (por instrucción)
IA, scoring nuevo, predicciones, dashboards no solicitados, rediseño visual, snapshots diarios de DPD / roll-rates,
alcance por oficina, edición/borrado de notas, firma digital y hash local en mobile (dependen de P8), sync incremental.
