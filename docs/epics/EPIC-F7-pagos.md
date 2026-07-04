# EPIC F7 — Pagos (Pilar 4 · Gestión de Recaudo)

**ID:** EPIC-F7 · **Estado:** ✅ Completado (base, 2026-06-18) · **Owner:** API + Security (+ Shared, Database, Testing)
**Depende de:** **F4** (créditos/cuotas), **F5** (casos, opcional) · **Requisitos:** RF-09, CU-05
**Design:** [design-system.md](../design-system.md) · **Arquitectura DB:** `DB_Architecture_COBRA.docx` → **Pilar 4**

> ## ✅ Estado de ejecución (base, 2026-06-18)
> Implementado y verificado (137 tests · type-check · `nest build` · migración · **e2e real**). Módulo `apps/api/src/modules/payments/`
> (+ `payment-apply.ts` puro). Migración `20260618200000_add_payment_idempotency` (`payments.idempotency_key` + unique por tenant).
> - **Registro `POST /payments`** (header **`Idempotency-Key`**): **aplicación atómica** dentro de `withTenant` — cuota (más antigua primero) → saldo → días de mora;
>   crédito saldado → `status PAID`, saldo 0. **Ledger inmutable** (sin update/delete); `receipt_number` secuencial por tenant.
> - **Anti-doble-contabilización**: idempotencia por `Idempotency-Key` (reintento → **replay**, mismo pago) + unicidades `external_transaction_id`/`receipt_number` (→ `PAYMENT_DUP`).
> - **Validaciones**: monto ≤ 0 o que **excede el saldo** → `PAYMENT_001`; crédito no ACTIVE → `CREDIT_NOT_ACTIVE`.
> - **Cobro digital**: `POST /payment-requests` (QR/link con `reference`/`qr_payload`/`url`/expiración) + `POST /payment-requests/:id/confirm` (conciliación → crea el pago, marca `PAID` + `paid_payment_id`).
> - **Eventos** `payment.registered` (para F8). Auditoría por registro. Permisos `payment:write` (registrar = COLLECTOR), `payment:approve` (conciliar = MANAGER), `payment:read`.
>
> **e2e:** collector registra pago 100 (recibo 2) → saldo 600→500; reenvío mismo `Idempotency-Key` → **replay** (mismo id, no duplica); excedente → `PAYMENT_001`; collector crea solicitud QR → manager concilia (recibo 3, request `PAID`+paidPaymentId). Recibos 1,2,3 secuenciales; ledger inmutable.
>
> **Frontera/diferido:** recálculo completo del `Arrear` snapshot tras el pago se hace con el endpoint de F4 (`/credits/:id/recalculate-arrears`); aquí se actualizan saldo + `days_past_due`. Integración real con PSP/pasarela y webhooks de conciliación = futuro (la interfaz `provider`/`external_transaction_id` queda lista).

> Cierra el ciclo: registra el **recaudo** (efectivo o digital) como un **ledger inmutable**, lo aplica a la deuda
> (cuota → saldo → mora) y soporta cobros digitales (QR/link). La integridad contable es el corazón de este epic.

## 0. Estado de ejecución
**Pendiente.** Schema modelado y migrado en F1 (`Payment` ledger **inmutable**, `PaymentRequest`), con RLS y
**unicidades anti-doble-contabilización** ya presentes (`@@unique([accountId, receiptNumber])`,
`@@unique([accountId, externalTransactionId])`). F7 construye el módulo `payments` + la **aplicación atómica** a la deuda.

## 1. Objetivo de negocio
Que cada pago quede registrado de forma **íntegra, inmutable y conciliable**, se aplique correctamente al crédito
(reduciendo saldo y mora), y que el cobro digital (QR/link) sea simple para el cliente. Cubre **CU-05 (registro de pago)**.

## 2. Alcance
### Incluye
- **`payment`**: registro tipo **ledger inmutable** (sin update/delete); métodos cash/transfer/qr/card/mobile_payment.
- **Aplicación a la deuda** (transacción atómica): `credit_installment.paid_amount`/estado + `credit.outstanding_balance` + recálculo de `arrear`/`days_past_due`.
- **Anti-doble-contabilización**: unicidad por `receipt_number`/`external_transaction_id` + **idempotency-key**.
- **`payment_request`**: generar QR/link, expiración, **conciliación** (marca `PAID` + `paid_payment_id`).
- **Eventos** `payment.registered` (los consume F8).
### No incluye
- Integración real con pasarelas/PSP y conciliación bancaria automática → futuro (se deja la interfaz `provider`/webhook).
- Contabilidad/libro mayor oficial, estados financieros → fuera del producto en esta fase.
- Reembolsos/anulación contable compleja → se modela como **asiento de ajuste** (nuevo registro), nunca editando el pago.

## 3. Conformidad con `DB_Architecture_COBRA` — Pilar 4
| Tabla (doc) | Modelo Prisma | Estado | Nota |
|-------------|---------------|--------|------|
| `payment` | `Payment` | ✅ Conforme (mejora) | Doc: monto/fecha/método/provider/external_transaction_id/receipt_number. Schema añade `installment_id` y **unicidades** (`receipt_number`, `external_transaction_id`) → anti-doble-cobro. **Inmutable.** |
| `payment_request` | `PaymentRequest` | ✅ Conforme | `status`, `reference` único, `qr_payload`, `url`, `expires_at`, `paid_payment_id`. |

**Conclusión:** Pilar 4 **conforme**, con el schema **mejorando** al doc en las garantías de unicidad. F7 es lógica de aplicación.

### Mejoras propuestas
| # | Mejora | Tipo | Por qué |
|---|--------|------|---------|
| **M1** | **Idempotency-Key** obligatorio en `POST /payments` (header) → mismo key = mismo resultado, sin doble asiento. | API | Evita doble POST por reintento de red (campo/QR). **Vinculante.** |
| **M2** | **Aplicación atómica** en una transacción `withTenant`: payment + cuota + saldo + mora; **confirmar antes de lanzar** errores (un `throw` haría rollback del asiento). | API | Consistencia contable; patrón ya usado en el refresh de F2a. **Vinculante.** |
| **M3** | **Política de excedente** configurable por tenant: por defecto **rechazar** monto > saldo (`PAYMENT_001`); opción "saldo a favor". | API/Shared | El doc no la define; default seguro. |
| **M4** | **`receipt_number` secuencial por tenant** (generación sin colisión, respaldada por la unicidad existente). | API | Numeración de recibo confiable. |
| **M5** | **Conciliación** `payment_request → payment`: endpoint/worker que marca `PAID` + enlaza `paid_payment_id`; expira las vencidas. | API | Cierra el flujo de cobro digital. |
| **M6** | **Única fuente de escritura** de `outstanding_balance` = `PaymentService` (invariante verificado). | API | Evita descuadres por escrituras dispersas. |

## 4. Contratos API (F7)
Todos **Bearer** + `TenantGuard` + `RolesGuard`. Respuestas `{data,meta,error}`.
```
POST /payments              {creditId, amount, method, caseId?, installmentId?, provider?, externalTransactionId?}
                            Header: Idempotency-Key        (payment:write)  → 201 · 400 PAYMENT_001 · 409 PAYMENT_DUP
GET  /payments       ?creditId&caseId&from&to&page&limit   (payment:read)   → 200 paginado
GET  /payments/:id                                         (payment:read)   → 200
POST /payment-requests      {creditId|caseId, amount, method:QR|...}  (payment:write) → 201 {reference, qrPayload, url, expiresAt}
GET  /payment-requests/:id                                 (payment:read)   → 200
POST /payment-requests/:id/confirm  {externalTransactionId} (payment:approve) → 200 (concilia → crea payment, marca PAID)
```
> Códigos: `PAYMENT_001` (monto ≤ 0 o excede saldo), `PAYMENT_DUP` (idempotency-key / external_transaction_id repetido). Sin `PATCH/DELETE` (inmutable).

## 5. Modelo de datos (cambios F7)
Sin cambios estructurales (Pilar 4 ya conforme, con unicidades). F7 añade lógica de servicio. Opcional: tabla/columna de
**idempotency keys** (`payment_idempotency(account_id, key, payment_id, created_at)`) si no se reutiliza `external_transaction_id` como clave.

## 6. Historias y tareas
| # | Historia | Agente | Estado |
|---|----------|--------|--------|
| 1 | Módulo `payments`: registro **ledger inmutable** + validaciones (`PAYMENT_001`) | API | ⏳ |
| 2 | **Aplicación atómica** a la deuda (cuota → saldo → mora) en `withTenant`, confirmando antes de lanzar | API | ⏳ |
| 3 | Anti-doble-contabilización: **Idempotency-Key** + unicidades (`PAYMENT_DUP`) | Security | ⏳ |
| 4 | Política de excedente configurable + `receipt_number` secuencial por tenant | API | ⏳ |
| 5 | `payment_request`: generar QR/link + expiración + **conciliación** (`/confirm` → payment, `PAID`) | API | ⏳ |
| 6 | Evento `payment.registered` (lo consume F8); auditoría completa del asiento | API | ⏳ |
| 7 | DTOs + validaciones (`PaymentMethod`, monto, moneda del tenant) | Shared | ⏳ |
| 8 | Tests: pago parcial, excedente rechazado, duplicado detectado, sin deuda activa bloqueado, saldo/mora consistentes | Testing | ⏳ |

## 7. Seguridad & Cumplimiento (checklist F7)
- [ ] RLS del tenant en toda query; `JwtAuthGuard`+`TenantGuard`+`RolesGuard` (`payment:*`).
- [ ] Pago **inmutable**: sin update/delete; correcciones = asiento de ajuste nuevo, auditado.
- [ ] **Idempotencia** garantizada (key + unicidad) contra doble ejecución (reintento de red).
- [ ] Aplicación a la deuda **atómica y consistente**; `outstanding_balance` con única fuente de escritura.
- [ ] Monto validado (> 0, no excede saldo salvo política explícita); moneda = la del tenant/crédito.
- [ ] Toda registración deja `audit_logs`; `payment_request` no adivinable (`reference` aleatoria).

## 8. DoD (F7)
- [ ] **CU-05 end-to-end**: registrar pago (efectivo y QR) → aplica a cuota → reduce saldo → recalcula mora.
- [ ] Pago **no editable** (verificado por test). Reintento con mismo Idempotency-Key no duplica el asiento.
- [ ] Pago parcial correcto; excedente rechazado (`PAYMENT_001`); duplicado detectado (`PAYMENT_DUP`); crédito sin deuda activa bloqueado.
- [ ] Saldo y mora **consistentes** tras una secuencia de pagos (test de invariante).
- [ ] Aislamiento multi-tenant; `lint`+`type-check`+`test` verdes; cobertura ≥ 80%.

## 9. Estrategia de tests
- **Unit:** validación de monto/excedente, generación de `receipt_number`, política de aplicación (cuota→saldo→mora), idempotencia.
- **Integración (testcontainers):** secuencia de pagos y verificación de invariantes (Σ pagos + saldo = principal+interés−condonado), `PAYMENT_DUP`, conciliación de `payment_request`, RLS A/B, evento emitido.

## 10. Observabilidad & métricas
- `audit_logs` por cada asiento. Métricas (base de F11): recaudo diario por tenant/sucursal/cobrador, ticket promedio, % por método, tasa de conciliación de QR.

## 11. Riesgos
| Riesgo | Mitigación |
|--------|-----------|
| Doble contabilización (reintento) | Idempotency-Key + unicidad `external_transaction_id`/`receipt_number` |
| Descuadre de saldo/mora | Aplicación atómica + única fuente de escritura + invariantes en tests |
| Edición/borrado de un pago | Inmutabilidad por diseño; correcciones por asiento de ajuste auditado |
| Excedente o moneda incorrecta | Validación de monto/saldo + moneda del tenant + política configurable |
| Conciliación digital incompleta | Estado `PAID` + `paid_payment_id`; expiración de requests vencidas |
