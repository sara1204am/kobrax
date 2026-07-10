# EPIC F5 — Casos de Cobranza Enterprise (Pilar 3 · v2)

**ID:** EPIC-F5-v2 · **Estado:** 🚧 En curso — **base de Fase 1 implementada (subconjunto)** · **Owner:** API (+ Shared, Security, Testing)
**Depende de:** F4 (clientes/créditos) · **Requisitos:** RF-06, CU-03
**Design:** [design-system.md](../design-system.md) · **Arquitectura DB:** `DB_Architecture_COBRA.docx` → Pilar 3
**Versión:** 2.0 — Revisión enterprise completa

> ## ⚠️ Estado de ejecución (2026-06-18) — leer antes de continuar
> Se implementó y verificó (115 tests · e2e real) un **núcleo base** de casos, que cubre **parte de la Fase 1 de esta v2** pero
> con la **máquina de estados de 7 estados (v1)**, no la de 9 de v2. Módulo en `apps/api/src/modules/cases/` + `common/events/event-bus`.
>
> **✅ Ya construido (base):** módulo `cases` (CRUD), generación desde mora idempotente, **un caso abierto por crédito** (migración `add_case_open_unique` = M-F5-01),
> prioridad estática (saldo×días×riesgo→enum) + SLA por prioridad, asignación manual + auto por menor carga, máquina de estados **v1 (7 estados)** con `CASE_001`/`CASE_002`,
> bitácora append-only, cierre con motivo, auditoría por mutación, eventos `case.assigned`/`case.updated` (EventBus propio). **e2e:** generate→assign→PENDING→ACTIVE→PAID→close, CASE_001/002/DUP.
>
> **❌ Falta para completar la Fase 1 de v2 (delta):**
> - **Estados v2**: añadir `EXPIRED_PTP` + `LEGAL` al enum (migración M-F5-07) y **reescribir `CASE_TRANSITIONS`** a las 9-estados de §3 (p.ej. `PENDING→CLOSED`, `ACTIVE→LEGAL`).
> - **Columnas M-F5-02**: `legal_referral_at/by/reason`, `strategy_id`, `priority_score`, `contact_score`, `priority_calculated_at`.
> - **`CaseActivity` enriquecida** (M-F5-06 básico): `channel`, `channel_metadata`.
> - **Eventos granulares** (`case.created`, `case.status_changed`) + migrar de mi `EventBus` propio a **`@nestjs/event-emitter` (EventEmitter2)** como pide §8.
> - Asignación **round-robin por branch** explícita (hoy es "menor carga global").
>
> **❌ Falta Fase 2** (PaymentPromise, ContactAttempt, CollectionStrategy + CASE_003/004/005/006, PROMISE_001, CONTACT_001) **y Fase 3** (jobs de prioridad/SLA/EXPIRED_PTP/LEGAL).
>
> **Decisión pendiente:** ¿cerrar primero el **delta de la Fase 1 de v2** (estados 9 + columnas + eventos granulares) sobre lo ya hecho, o seguir incremental? El núcleo base es reutilizable.

> Esta revisión convierte F5 de un módulo CRUD con máquina de estados básica a un **motor de cobranza operativo**:
> ciclo de vida rico con estados de escalamiento, promesas de pago como entidad propia, estrategias configurables
> por segmento, contactabilidad estructurada, SLA con escalamiento automático y eventos de dominio granulares.
> Desbloquea F6, F7, F8 y el futuro módulo de IA/scoring.

---

## 0. Diagnóstico de v1 — Por qué se revisa

| Área | Problema en v1 | Impacto |
|------|---------------|---------|
| Máquina de estados | Falta `EXPIRED_PTP` y `LEGAL`; salto de `PROMISE_TO_PAY` a `CLOSED` sin validar cumplimiento | Cobranza sin escalamiento real |
| Prioridad | `monto × días × riesgo` estático; no decae, no considera contactabilidad | Cartera crítica mal ordenada |
| SLA | `sla_due_at` existe pero no hay escalamiento al vencerse | SLA decorativo |
| Contacto | `CaseActivity.type: CALL/MESSAGE` sin resultado estructurado | No se puede medir tasa de contactabilidad |
| Promesa de pago | Es solo un `status`, no una entidad con `promised_amount`, `promised_date` y ciclo propio | No hay seguimiento de PTP real |
| Estrategia | Cada cobrador decide libremente; no hay cadencia ni scripts por segmento | Operación no estandarizable |
| Eventos | Solo `case.assigned` + `case.updated`; F8 no puede reaccionar con precisión | F8 necesita polling o lógica de negocio ajena |
| Multi-canal | `type: MESSAGE` genérico; WhatsApp/SMS/email/llamada indiferenciados | Sin costo, consentimiento ni métricas por canal |

---

## 1. Objetivo de negocio (revisado)

Que la cartera vencida se gestione como un **flujo operativo trazable, estandarizable y escalable**:

- Un caso por crédito en mora, con prioridad dinámica y SLA que escala automáticamente al vencerse.
- Promesas de pago como objetos de negocio con seguimiento de cumplimiento.
- Estrategias de cobranza configurables por segmento de riesgo (cadencia, canal, umbral de escalamiento).
- Contactabilidad estructurada por canal (resultado, consentimiento, próximo intento).
- Eventos de dominio granulares que habilitan F8 (notificaciones, auditoría, realtime) sin acoplamiento.
- Escalamiento automático a cartera legal con auditoría completa.

Cubre **CU-03** (asignación), **CU-04** (seguimiento de gestiones), **CU-05** (escalamiento a legal).

---

## 2. Alcance total (v2)

### Incluye
- **Ciclo de vida de casos** con 9 estados + transiciones validadas server-side.
- **`PaymentPromise`**: entidad propia con `promised_amount`, `promised_date`, `promised_channel`, ciclo `PENDING → KEPT / BROKEN / PARTIAL`.
- **`CollectionStrategy`**: plantilla configurable por tenant/segmento (cadencia, canal preferido, umbrales de escalamiento).
- **`ContactAttempt`**: entidad estructurada por canal con resultado, consentimiento, duración, próximo intento.
- **Prioridad dinámica**: score con decaimiento temporal + penalización por intentos fallidos + boost por monto.
- **SLA con escalamiento**: al vencer `sla_due_at` → reasignación automática o subida de prioridad + evento `case.sla_breached`.
- **Generación automática** desde mora: umbral configurable por `account.configuration`, idempotente, con estrategia asignada.
- **Asignación**: manual, round-robin por branch, y por especialización (cobrador con mejor tasa en segmento).
- **Bitácora** (`CaseActivity`) append-only enriquecida con `channel`, `channel_metadata` JSONB, `contact_attempt_id`.
- **Eventos de dominio granulares** (ver sección 7).
- **Escalamiento a legal**: transición `ACTIVE/IN_NEGOTIATION → LEGAL` con `legal_referral_at`, `legal_referral_by`, motivo.

### No incluye (diferido)
- Rutas, visitas, evidencia → **F6**.
- Registro de pagos real → **F7**.
- Notificaciones/WebSocket → **F8** (F5 solo emite eventos).
- Scoring predictivo ML → **IA futura** (se reserva `predicted_recovery_score` en `CollectionCase`).
- Integración con canales externos (WhatsApp Business API, SMS gateway) → **F9**.

---

## 3. Máquina de estados (v2)

### Estados

| Estado | Descripción |
|--------|-------------|
| `PENDING` | Caso creado, sin asignar o recién asignado, sin gestión iniciada |
| `ACTIVE` | Cobrador asignado, gestión en curso |
| `IN_NEGOTIATION` | Deudor en diálogo activo; se documentan acuerdos parciales |
| `PROMISE_TO_PAY` | Promesa de pago formal registrada (`PaymentPromise` activa) |
| `EXPIRED_PTP` | Promesa vencida sin pago o pago parcial insuficiente |
| `LEGAL` | Expediente derivado a gestión legal/judicial |
| `PAID` | Deuda saldada (total o acuerdo cumplido) |
| `WRITTEN_OFF` | Castigo contable; deuda irrecuperable |
| `CLOSED` | Cerrado con motivo (incluye PAID y WRITTEN_OFF como sub-flujos) |

### Transiciones permitidas (`CASE_TRANSITIONS` en `@kobrax/shared`)

```
PENDING         → ACTIVE, CLOSED (con motivo)
ACTIVE          → IN_NEGOTIATION, PROMISE_TO_PAY, LEGAL, WRITTEN_OFF, CLOSED
IN_NEGOTIATION  → PROMISE_TO_PAY, ACTIVE, LEGAL, WRITTEN_OFF, CLOSED
PROMISE_TO_PAY  → PAID, EXPIRED_PTP, LEGAL
EXPIRED_PTP     → ACTIVE, IN_NEGOTIATION, LEGAL, WRITTEN_OFF, CLOSED
LEGAL           → PAID, WRITTEN_OFF, CLOSED
PAID            → CLOSED
WRITTEN_OFF     → CLOSED
CLOSED          → (terminal)
```

### Reglas de transición (validadas server-side, nunca en cliente)

| Código | Regla |
|--------|-------|
| `CASE_001` | No cerrar sin al menos una gestión (`CaseActivity`) registrada |
| `CASE_002` | Transición no permitida por `CASE_TRANSITIONS` |
| `CASE_003` | No transicionar a `PROMISE_TO_PAY` sin `PaymentPromise` activa asociada |
| `CASE_004` | No transicionar a `LEGAL` sin motivo de escalamiento + aprobación de role `case:escalate` |
| `CASE_005` | No transicionar a `PAID` sin referencia de pago (`payment_reference_id`) de F7 |
| `CASE_006` | `EXPIRED_PTP` solo disparado automáticamente por job al vencer `PaymentPromise.promised_date` |

---

## 4. Modelo de datos (v2)

### 4.1 `collection_case` (cambios sobre v1)

```sql
-- Nuevos campos
legal_referral_at        TIMESTAMPTZ
legal_referral_by        UUID REFERENCES users(id)
legal_referral_reason    TEXT
strategy_id              UUID REFERENCES collection_strategy(id)
predicted_recovery_score DECIMAL(5,2)          -- reservado para IA
contact_score            DECIMAL(5,2)          -- tasa de contactabilidad calculada
priority_score           DECIMAL(10,4)         -- score dinámico (reemplaza enum simple)
priority_calculated_at   TIMESTAMPTZ           -- última vez que se recalculó

-- Índices
UNIQUE PARTIAL (account_id, credit_id) WHERE status NOT IN ('CLOSED','WRITTEN_OFF')  -- M2 de v1
INDEX (assignee_id, status, sla_due_at)  -- queries de dashboard cobrador
INDEX (account_id, status, priority_score DESC)  -- ordenamiento de cartera
```

### 4.2 `payment_promise` (nueva tabla)

```sql
CREATE TABLE payment_promise (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           UUID NOT NULL REFERENCES collection_case(id),
  account_id        UUID NOT NULL,                    -- RLS
  promised_amount   DECIMAL(15,2) NOT NULL,
  promised_date     DATE NOT NULL,
  promised_channel  TEXT NOT NULL,                    -- TRANSFER/CASH/CARD/OTHER
  status            TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING/KEPT/BROKEN/PARTIAL
  actual_amount     DECIMAL(15,2),                    -- registrado al cumplirse (F7)
  payment_ref_id    UUID,                             -- FK a F7 payment
  broken_at         TIMESTAMPTZ,
  broken_reason     TEXT,
  notes             TEXT,
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Solo una promesa PENDING por caso a la vez
  CONSTRAINT one_active_promise UNIQUE (case_id) WHERE status = 'PENDING'
);
```

### 4.3 `contact_attempt` (nueva tabla)

```sql
CREATE TABLE contact_attempt (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          UUID NOT NULL REFERENCES collection_case(id),
  account_id       UUID NOT NULL,
  activity_id      UUID REFERENCES case_activity(id),
  channel          TEXT NOT NULL,    -- PHONE/WHATSAPP/SMS/EMAIL/IN_PERSON
  phone_number     TEXT,             -- enmascarado en respuesta API
  email_address    TEXT,             -- enmascarado
  result           TEXT NOT NULL,    -- NO_ANSWER/WRONG_NUMBER/REFUSED/CALLBACK/NEGOTIATING/RESOLVED
  duration_seconds INTEGER,          -- llamadas
  has_consent      BOOLEAN DEFAULT false,  -- consentimiento de comunicación registrado
  next_attempt_at  TIMESTAMPTZ,
  channel_metadata JSONB,            -- message_id WhatsApp, email thread_id, etc.
  attempted_by     UUID NOT NULL REFERENCES users(id),
  attempted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices
INDEX (case_id, attempted_at DESC)
INDEX (case_id, result)  -- tasa de contactabilidad
```

### 4.4 `collection_strategy` (nueva tabla)

```sql
CREATE TABLE collection_strategy (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              UUID NOT NULL,   -- RLS tenant
  name                    TEXT NOT NULL,
  risk_segment            TEXT,            -- HIGH/MEDIUM/LOW — null = default
  days_past_due_min       INTEGER,         -- rango de aplicación
  days_past_due_max       INTEGER,
  preferred_channels      TEXT[],          -- ['PHONE','WHATSAPP','SMS']
  max_attempts_per_day    INTEGER DEFAULT 3,
  attempt_interval_hours  INTEGER DEFAULT 8,
  escalate_after_days     INTEGER,         -- días sin contacto → escalar prioridad
  legal_threshold_days    INTEGER,         -- días en EXPIRED_PTP → sugerir LEGAL
  sla_hours_by_priority   JSONB,           -- {"CRITICAL":4,"HIGH":24,"MEDIUM":72,"LOW":168}
  script_template         JSONB,           -- templates por estado/canal
  is_default              BOOLEAN DEFAULT false,
  is_active               BOOLEAN DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 4.5 `case_activity` (cambios sobre v1)

```sql
-- Nuevos campos sobre la estructura existente
contact_attempt_id  UUID REFERENCES contact_attempt(id)
channel             TEXT              -- canal del activity si aplica
channel_metadata    JSONB             -- metadata enriquecida (M6 de v1, ahora obligatorio)
promise_id          UUID REFERENCES payment_promise(id)
duration_seconds    INTEGER
```

### 4.6 Migraciones requeridas

| ID | Nombre | Tipo | Descripción |
|----|--------|------|-------------|
| M-F5-01 | `add_case_open_unique` | Index | Índice parcial único `(account_id, credit_id) WHERE status NOT IN (CLOSED, WRITTEN_OFF)` |
| M-F5-02 | `add_case_legal_fields` | Column | `legal_referral_at/by/reason`, `strategy_id`, `priority_score`, `contact_score` |
| M-F5-03 | `create_payment_promise` | Table | Tabla completa con constraint de unicidad |
| M-F5-04 | `create_contact_attempt` | Table | Tabla completa con índices |
| M-F5-05 | `create_collection_strategy` | Table | Tabla completa |
| M-F5-06 | `enrich_case_activity` | Column | `contact_attempt_id`, `channel`, `channel_metadata`, `promise_id`, `duration_seconds` |
| M-F5-07 | `case_status_enum_v2` | Enum | Añadir `EXPIRED_PTP` y `LEGAL` al enum de estados |

---

## 5. Prioridad dinámica (v2)

### Fórmula de score

```
priority_score = (
  (outstanding_balance / baseline_amount) × weight_amount     +  -- monto relativo al portfolio
  (days_past_due / max_dpd) × weight_days                     +  -- urgencia temporal
  risk_multiplier[risk_segment]                                +  -- HIGH=1.5, MEDIUM=1.0, LOW=0.7
  time_decay_penalty                                           +  -- días sin gestión × penalty_rate
  failed_attempts_penalty                                         -- intentos fallidos × penalty_rate
) × sla_breach_multiplier                                        -- ×2 si SLA vencido
```

**Parámetros configurables por tenant en `account.configuration`:**
- `weight_amount`, `weight_days` (pesos relativos, suman 1.0)
- `risk_multiplier` por segmento
- `time_decay_rate` (penalización por día sin gestión)
- `failed_attempt_penalty` (penalización por intento fallido)
- `sla_breach_multiplier`

**Recálculo:** job schedulado cada hora + recálculo inmediato en cada `CaseActivity` registrada.

### Niveles de prioridad derivados del score

| Nivel | Score | Color dashboard |
|-------|-------|-----------------|
| `CRITICAL` | ≥ 0.85 | Rojo |
| `HIGH` | 0.65 – 0.84 | Naranja |
| `MEDIUM` | 0.40 – 0.64 | Amarillo |
| `LOW` | < 0.40 | Verde |

---

## 6. SLA con escalamiento (v2)

### Cálculo de `sla_due_at`

```
sla_due_at = case_assigned_at + strategy.sla_hours_by_priority[priority_level]
```

### Acciones al vencer SLA (job schedulado cada 15 min)

| Condición | Acción automática | Evento emitido |
|-----------|-------------------|----------------|
| SLA vencido, cobrador activo | Subir `priority_score` × `sla_breach_multiplier`, notificar supervisor | `case.sla_breached` |
| SLA vencido +24h sin gestión | Reasignar automáticamente (menor carga en branch) + emitir asignación | `case.sla_breached`, `case.assigned` |
| SLA vencido +48h | Escalar a supervisor + flag `requires_supervisor_review` | `case.escalated` |
| En `EXPIRED_PTP` > `strategy.legal_threshold_days` | Sugerir escalamiento a LEGAL (no automático; requiere `case:escalate`) | `case.legal_escalation_suggested` |

---

## 7. Contratos API (v2)

Todos **Bearer** + `TenantGuard` + `RolesGuard`. Respuestas `{data, meta, error}`.

### Casos

```
POST   /cases                         {creditId, priority?, strategyId?}      (case:write)   → 201 · 409 CASE_DUP
POST   /cases/generate                {minDaysPastDue?, strategyId?}          (case:assign)  → 200 {created:n, skipped:n}
GET    /cases          ?status&assigneeId&priority&overdue&slaBreached&        (case:read)    → 200 paginado
                        segment&page&limit&sort
GET    /cases/:id                                                              (case:read)    → 200 + activities + promises
PATCH  /cases/:id                     {status, reason?, paymentRefId?}         (case:write)   → 200 · 409 CASE_002/003/004/005
POST   /cases/:id/assign              {collectorId?, auto?:bool, mode?}        (case:assign)  → 200 · emite case.assigned
POST   /cases/:id/escalate-legal      {reason}                                (case:escalate)→ 200 · emite case.escalated
POST   /cases/:id/close               {reason}                                (case:close)   → 200 · 422 CASE_001
```

### Actividades y contacto

```
POST   /cases/:id/activities          {type, notes?, result?, channel?,        (case:write)   → 201 append-only
                                       durationSeconds?, promiseId?}
POST   /cases/:id/contact-attempts    {channel, result, phoneNumber?,          (case:write)   → 201
                                       hasConsent?, nextAttemptAt?,
                                       channelMetadata?}
GET    /cases/:id/contact-attempts    ?channel&result&page&limit               (case:read)    → 200 paginado
```

### Promesas de pago

```
POST   /cases/:id/promises            {promisedAmount, promisedDate,           (case:write)   → 201 · 409 si ya hay PENDING
                                       promisedChannel, notes?}
GET    /cases/:id/promises                                                     (case:read)    → 200
PATCH  /cases/:id/promises/:pid       {status, actualAmount?, paymentRefId?,   (case:write)   → 200
                                       brokenReason?}
```

### Estrategias

```
GET    /collection-strategies         ?segment&active                          (strategy:read) → 200
POST   /collection-strategies         {name, riskSegment?, ...}               (strategy:write)→ 201
GET    /collection-strategies/:id                                             (strategy:read) → 200
PATCH  /collection-strategies/:id     {slaHoursByPriority?, ...}              (strategy:write)→ 200
```

### Códigos de error completos

| Código | Descripción |
|--------|-------------|
| `CASE_001` | Cerrar sin gestión previa registrada |
| `CASE_002` | Transición de estado no permitida |
| `CASE_003` | `PROMISE_TO_PAY` sin `PaymentPromise` activa |
| `CASE_004` | Escalamiento a LEGAL sin permiso `case:escalate` o sin motivo |
| `CASE_005` | Marcar `PAID` sin `payment_reference_id` de F7 |
| `CASE_006` | `EXPIRED_PTP` solo dispara el job automático (no manual) |
| `CASE_DUP` | Ya existe un caso abierto para ese crédito |
| `PROMISE_001` | Ya existe una promesa PENDING para este caso |
| `CONTACT_001` | Canal requiere `hasConsent: true` para continuar |

---

## 8. Eventos de dominio (v2)

Todos via `EventEmitter2` (F5) → consumidos por F8 (notificaciones, audit, realtime).

| Evento | Disparador | Payload clave |
|--------|-----------|---------------|
| `case.created` | POST /cases | `caseId`, `creditId`, `accountId`, `strategyId` |
| `case.assigned` | POST /cases/:id/assign | `caseId`, `assigneeId`, `previousAssigneeId`, `mode` |
| `case.status_changed` | PATCH /cases/:id | `caseId`, `from`, `to`, `reason`, `changedBy` |
| `case.sla_breached` | Job SLA | `caseId`, `assigneeId`, `breachedAt`, `hoursOverdue` |
| `case.escalated` | POST /cases/:id/escalate-legal | `caseId`, `escalatedBy`, `reason` |
| `case.legal_escalation_suggested` | Job SLA | `caseId`, `daysSinceExpiredPtp` |
| `case.promise_created` | POST /cases/:id/promises | `caseId`, `promiseId`, `promisedAmount`, `promisedDate` |
| `case.promise_kept` | PATCH promise status=KEPT | `caseId`, `promiseId`, `actualAmount` |
| `case.promise_broken` | Job PTP o PATCH status=BROKEN | `caseId`, `promiseId`, `brokenReason` |
| `case.contact_attempted` | POST /cases/:id/contact-attempts | `caseId`, `channel`, `result`, `attemptedBy` |
| `case.closed` | POST /cases/:id/close | `caseId`, `reason`, `closedBy`, `finalStatus` |
| `case.priority_recalculated` | Job prioridad | `caseId`, `oldScore`, `newScore`, `newLevel` |

---

## 9. Historias y tareas (v2)

| # | Historia | Agente | Fase | Estado |
|---|----------|--------|------|--------|
| 1 | Módulo `cases`: CRUD + máquina de estados v2 (9 estados, `CASE_001–006`) | API | 1 | ⏳ |
| 2 | Migraciones M-F5-01 a M-F5-07 + RLS verificada en todas las tablas nuevas | DB | 1 | ⏳ |
| 3 | DTOs completos: Case, Activity, Promise, ContactAttempt, Strategy | Shared | 1 | ⏳ |
| 4 | Generación automática desde mora (umbral por `account.configuration`, idempotente, `strategyId`) | API | 1 | ⏳ |
| 5 | `PaymentPromise` CRUD + validación `CASE_003` + constraint `PROMISE_001` | API | 2 | ⏳ |
| 6 | `ContactAttempt` CRUD + enriquecimiento de `CaseActivity` + consentimiento `CONTACT_001` | API | 2 | ⏳ |
| 7 | `CollectionStrategy` CRUD + asignación automática de estrategia al generar caso | API | 2 | ⏳ |
| 8 | Asignación manual + round-robin por branch + por especialización (mejor tasa en segmento) | API | 2 | ⏳ |
| 9 | Prioridad dinámica: fórmula configurable + job de recálculo cada hora | API/Job | 3 | ⏳ |
| 10 | SLA con escalamiento: job cada 15 min + reasignación automática + `case.sla_breached` | API/Job | 3 | ⏳ |
| 11 | Job `EXPIRED_PTP`: detectar promesas vencidas → transicionar estado + evento | Job | 3 | ⏳ |
| 12 | Job sugerencia LEGAL: `EXPIRED_PTP` > `strategy.legal_threshold_days` | Job | 3 | ⏳ |
| 13 | Escalamiento a LEGAL: endpoint + role `case:escalate` + `CASE_004` | API | 3 | ⏳ |
| 14 | Eventos de dominio granulares (12 eventos) vía EventEmitter2 | API | 2 | ⏳ |
| 15 | Audit: toda mutación → `audit_logs` (who/when/before/after/ip) | Security | 1 | ⏳ |
| 16 | Tests unitarios: máquina de estados (todas las transiciones), prioridad, SLA, auto-asignación | Testing | transversal | ⏳ |
| 17 | Tests integración (testcontainers): generación idempotente, CASE_DUP, CASE_001–006, RLS A/B | Testing | transversal | ⏳ |
| 18 | Tests de jobs: EXPIRED_PTP, SLA breach, recálculo de prioridad, sugerencia LEGAL | Testing | transversal | ⏳ |

---

## 10. Fases de implementación

### Fase 1 — Núcleo operativo (semanas 1–2)
**Objetivo:** Un caso puede crearse, asignarse, gestionarse y cerrarse correctamente.

**Incluye:**
- Migraciones M-F5-01, M-F5-02, M-F5-07 (índice único + campos legales + enum v2).
- Módulo `cases` completo: CRUD, máquina de estados v2, `CASE_001/002`.
- Generación desde mora (historia 4) con asignación de estrategia default.
- Asignación manual + round-robin básico (historia 8, solo round-robin).
- `CaseActivity` append-only con `channel` y `channel_metadata` (M-F5-06 básico).
- DTOs + validaciones (historia 3, solo entidades de Fase 1).
- Audit logs en toda mutación (historia 15).
- Eventos: `case.created`, `case.assigned`, `case.status_changed`, `case.closed`.
- Tests: transiciones válidas/inválidas, CASE_001/002, CASE_DUP, RLS A/B.

**DoD Fase 1:**
- [ ] CU-03 end-to-end: crear → asignar → gestionar → cerrar.
- [ ] Transición inválida rechazada (`CASE_002`); cierre sin gestión rechazado (`CASE_001`).
- [ ] Índice parcial evita `CASE_DUP`.
- [ ] Aislamiento multi-tenant verificado.
- [ ] `lint` + `type-check` + `test` verdes; cobertura ≥ 80% en módulo `cases`.

---

### Fase 2 — Promesas, contacto y estrategias (semanas 3–4)
**Objetivo:** La gestión es estructurada, multi-canal y orientada a resultados medibles.

**Incluye:**
- Migraciones M-F5-03, M-F5-04, M-F5-05 (tablas nuevas completas).
- `PaymentPromise` CRUD + `CASE_003` + `PROMISE_001` (historia 5).
- `ContactAttempt` CRUD + consentimiento `CONTACT_001` + enriquecimiento de `CaseActivity` (historia 6).
- `CollectionStrategy` CRUD + asignación automática al generar caso (historia 7).
- Asignación por especialización (mejor tasa en segmento, historia 8 completa).
- Eventos adicionales: `case.promise_created`, `case.promise_broken`, `case.promise_kept`, `case.contact_attempted`.
- DTOs para `Promise`, `ContactAttempt`, `Strategy`.
- Tests: CASE_003, PROMISE_001, CONTACT_001, asignación por especialización, eventos Fase 2.

**DoD Fase 2:**
- [ ] Promesa de pago con ciclo propio `PENDING → KEPT/BROKEN/PARTIAL`.
- [ ] `ContactAttempt` estructurado con resultado + canal + consentimiento.
- [ ] `CollectionStrategy` asignada automáticamente al generar caso.
- [ ] Asignación por menor carga Y por mejor tasa en segmento disponibles.
- [ ] 12 eventos de dominio emitidos y verificados por test.
- [ ] Cobertura ≥ 80% en módulos nuevos de Fase 2.

---

### Fase 3 — Automatización, scoring y escalamiento (semanas 5–6)
**Objetivo:** El sistema se gestiona proactivamente sin intervención manual constante.

**Incluye:**
- Prioridad dinámica: fórmula completa + parámetros configurables por tenant + job cada hora (historia 9).
- SLA con escalamiento: job cada 15 min + reasignación automática +24h sin gestión + flag supervisor +48h (historia 10).
- Job `EXPIRED_PTP`: detecta promesas vencidas → transiciona caso + `case.promise_broken` (historia 11).
- Job sugerencia LEGAL: `EXPIRED_PTP` > `legal_threshold_days` → `case.legal_escalation_suggested` (historia 12).
- Escalamiento a LEGAL: endpoint + role `case:escalate` + `CASE_004` + `CASE_005` (historia 13, integrada con F7).
- Eventos: `case.sla_breached`, `case.escalated`, `case.legal_escalation_suggested`, `case.priority_recalculated`.
- Tests de jobs: idempotencia, condiciones de borde, aislamiento multi-tenant en jobs.

**DoD Fase 3:**
- [ ] Prioridad recalculada automáticamente con parámetros configurables por tenant.
- [ ] SLA breach detectado en ≤ 15 min → reasignación o escalamiento automático.
- [ ] `EXPIRED_PTP` transiciona automáticamente al vencer `promised_date`.
- [ ] Sugerencia LEGAL emitida sin automatizar la decisión (requiere `case:escalate`).
- [ ] Jobs idempotentes verificados (doble ejecución no duplica efectos).
- [ ] Cobertura ≥ 80% en módulo de jobs.
- [ ] CU-05 end-to-end: caso en `EXPIRED_PTP` → escalamiento a LEGAL → cierre.

---

## 11. Seguridad & Cumplimiento (checklist v2)

- [ ] RLS del tenant en **todas** las tablas nuevas (`payment_promise`, `contact_attempt`, `collection_strategy`).
- [ ] `JwtAuthGuard` + `TenantGuard` + `RolesGuard` en todos los endpoints; `ParseUUIDPipe` en todos los IDs.
- [ ] Transiciones validadas **server-side** contra `CASE_TRANSITIONS`; nunca confiar en estado enviado por cliente.
- [ ] Bitácora `CaseActivity` **append-only**; prohibido UPDATE/DELETE (enforced en RLS + repositorio).
- [ ] Cambio de estado → `STATUS_CHANGE` en `CaseActivity` + `audit_logs` (who/when/before/after/ip/user-agent).
- [ ] Asignación solo a usuarios del **mismo tenant** (y branch si aplica el scope).
- [ ] Escalamiento a LEGAL requiere role `case:escalate`; no disponible a cobradores estándar.
- [ ] `phone_number` y `email_address` en `ContactAttempt` **enmascarados en respuesta API** (solo últimos 4 dígitos/caracteres visibles a roles sin `pii:read`).
- [ ] Consentimiento de comunicación registrado antes de contacto por canales regulados (WhatsApp, SMS).
- [ ] Jobs con retry idempotente; fallos aislados por `account_id` (un tenant no bloquea a otros).
- [ ] Errores genéricos sin enumeración de recursos; rate limiting en endpoints de generación masiva.
- [ ] `predicted_recovery_score` no expuesto en API pública hasta implementación IA.

---

## 12. Observabilidad & métricas

### Métricas operativas
- Casos por estado / prioridad / cobrador / segmento de riesgo.
- Tasa de contactabilidad por canal / cobrador / segmento.
- Tasa de cumplimiento de promesas de pago (KEPT / total).
- Casos vencidos por SLA (breach rate) por cobrador y branch.
- Edad media del caso por estado.
- Tiempo medio de resolución (creación → PAID/CLOSED).
- Distribución de resultados de `ContactAttempt` por canal.

### Audit
- `audit_logs` en toda mutación (asignación, transición, cierre, escalamiento, promise update).
- `contact_attempt.has_consent` trazable por regulación.
- `legal_referral_at/by/reason` inmutable una vez registrado.

### Alertas sugeridas (para F8 o monitoreo externo)
- Cobrador con > N casos en SLA breach.
- Caso en `EXPIRED_PTP` sin reasignación en > 24h.
- Generación masiva de casos que supere umbral de capacidad del equipo.

---

## 13. DTOs principales (`@kobrax/shared`)

```typescript
// Case
CreateCaseDto        { creditId: UUID; strategyId?: UUID; notes?: string }
UpdateCaseDto        { status: CaseStatus; reason?: string; paymentRefId?: UUID }
AssignCaseDto        { collectorId?: UUID; auto?: boolean; mode?: 'round-robin' | 'specialization' }
EscalateLegalDto     { reason: string }
CloseCaseDto         { reason: string }
GenerateCasesDto     { minDaysPastDue?: number; strategyId?: UUID; dryRun?: boolean }

// Payment Promise
CreatePromiseDto     { promisedAmount: number; promisedDate: Date; promisedChannel: string; notes?: string }
UpdatePromiseDto     { status: PromiseStatus; actualAmount?: number; paymentRefId?: UUID; brokenReason?: string }

// Contact Attempt
CreateContactAttemptDto {
  channel: ContactChannel
  result: ContactResult
  phoneNumber?: string
  hasConsent?: boolean
  durationSeconds?: number
  nextAttemptAt?: Date
  channelMetadata?: Record<string, unknown>
  notes?: string
}

// Activity
CreateActivityDto    { type: ActivityType; notes?: string; result?: string; channel?: string;
                       durationSeconds?: number; promiseId?: UUID; channelMetadata?: Record<string, unknown> }

// Strategy
CreateStrategyDto    { name: string; riskSegment?: RiskSegment; daysPastDueMin?: number; daysPastDueMax?: number;
                       preferredChannels: ContactChannel[]; maxAttemptsPerDay: number;
                       attemptIntervalHours: number; escalateAfterDays?: number;
                       legalThresholdDays?: number; slaHoursByPriority: SlaHoursConfig;
                       scriptTemplate?: Record<string, unknown> }
```

---

## 14. Riesgos (v2)

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|-----------|
| Casos duplicados por crédito | Media | Alto | Índice parcial único + generación idempotente + `CASE_DUP` |
| Cerrar casos sin trabajarlos | Media | Alto | `CASE_001` + audit |
| Saltos de estado desde cliente | Alta | Alto | Validación server-side contra `CASE_TRANSITIONS` |
| Asignación cruzada entre tenants | Baja | Crítico | RLS + verificación de pertenencia + scope del permiso |
| Promesas marcadas como cumplidas sin pago real | Media | Alto | `CASE_005` + referencia obligatoria a F7 |
| Jobs con doble ejecución producen duplicados | Media | Alto | Idempotencia con upsert + lock por `case_id` |
| SLA job con lock contention en cartera grande | Media | Medio | Procesamiento por batch + index `(sla_due_at, status)` |
| Contacto sin consentimiento en canales regulados | Alta | Crítico | `CONTACT_001` + `has_consent` trazable en audit |
| Escalamiento LEGAL automático no deseado | Baja | Crítico | `CASE_004` requiere role explícito; sugerencia ≠ acción |
| Prioridad score con parámetros mal calibrados | Media | Medio | `dryRun` en generación + recálculo simulable sin persistir |

---

## 15. DoD global (Epic F5 v2)

- [ ] **CU-03 end-to-end**: generar desde mora → asignar (auto/manual/especialización) → contactar → registrar gestiones → transicionar → cerrar.
- [ ] **CU-04 end-to-end**: registrar contacto estructurado → crear promesa → seguimiento → marcar cumplida/rota.
- [ ] **CU-05 end-to-end**: caso en `EXPIRED_PTP` → sugerencia LEGAL → escalamiento con `case:escalate` → cierre.
- [ ] Todas las reglas `CASE_001` a `CASE_006` + `PROMISE_001` + `CONTACT_001` validadas y auditadas.
- [ ] Prioridad recalculada automáticamente; SLA con escalamiento funcional.
- [ ] Jobs idempotentes y aislados por tenant.
- [ ] 12 eventos de dominio emitidos y verificados por test (F8 puede consumirlos sin lógica de negocio en F8).
- [ ] RLS verificada en las 5 tablas del pilar: `collection_case`, `payment_promise`, `contact_attempt`, `collection_strategy`, `case_activity`.
- [ ] Aislamiento multi-tenant A/B completo.
- [ ] `lint` + `type-check` + `test` verdes; cobertura ≥ 80% en todos los módulos de F5.
- [ ] `phone_number`/`email_address` enmascarados verificado en tests de respuesta API.
- [ ] Documentación de mapeo de estados v2 vs `DB_Architecture_COBRA` actualizada.