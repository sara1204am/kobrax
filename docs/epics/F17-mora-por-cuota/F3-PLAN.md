# F17 · F3 — Interés moratorio: plan técnico

> Fecha: 2026-11-21 · Estado: **PLAN PARA REVISIÓN (sin código de F3 todavía)** · Prerrequisitos hechos: D1–D10 cerradas, zona horaria (`accountToday`), interruptor y versionado de política (F2b).
> Convención: **HECHO** = verificado en el código · **PROPUESTA** = decisión técnica mía que pide tu visto bueno.

## 1. Qué se quiere (resumen de las decisiones cerradas)

| | Regla |
|---|---|
| Activación | Apagado por defecto; se enciende en Cuenta → Cobranza. Cada cambio = versión nueva; **solo créditos creados después** (D8). |
| D1 | Un pago se aplica **por cuota, de la más antigua**: primero mora, luego interés corriente, luego capital. |
| D2 | Base = **capital vencido pendiente de la cuota** (nunca la cuota entera, nunca interés sobre interés). |
| D3 | Actual/365 (360 configurable). |
| D4 | El devengo se corta en `paymentDate` (fecha de cobro), aunque la imputación siga el orden de **registro**. |
| D5 | Tasa máxima validada + tope acumulado opcional por cuota (% de su capital vencido). |
| D6 | Con saldo 0 y mora pendiente el crédito **no pasa a `PAID`** hasta pagarla o exonerarla (auditado). |
| D7 | Castigado: el devengo se congela en `written_off_at`; los pagos se siguen aceptando. |
| D9 | Gracia en días, configurable. |
| D10 | Préstamos abiertos (sin plan): sin cargos. |

## 2. Hechos del código que condicionan el diseño

* **HECHO** `buildUpdatedPlan` / `allocatePayments` (`shared/utils/payment-plan.ts`) son puras, en centavos enteros, y **imputan por importe de cuota** (capital + interés corriente) en orden de registro. No conocen fechas de cobro ni cargos.
* **HECHO** `payment_applications` es el ledger de hechos: `@@unique([paymentId, installmentNumber, kind])`, importe con signo (APPLY > 0, REVERSAL < 0), `policy_version` sellada. Hoy no distingue *qué* se pagó de la cuota.
* **HECHO** `payments.payment_date` existe y puede ser anterior a `created_at` (hay tope de antigüedad, `PAYMENT_BACKDATE_DAYS`). `credits.outstanding_balance` = total pendiente del plan.
* **HECHO** el cronograma trae `principal` e `interest` por cuota (motor y `credit_installments`); las condiciones sin desglose no.
* **HECHO** `applyCore` (`payments.service.ts`) corre en una transacción con candado por crédito y es el **único** lugar que escribe aplicaciones y estado del crédito. `payment-integrity.ts` verifica coherencia.

## 3. Diseño (PROPUESTA)

### 3.1 El devengo es una función pura, no un contador que se muta
`lateInterest(cuota, eventos, política, asOf)` en `packages/shared` (mismo código para API, web y verificador). Entrada: capital vencido de la cuota, fecha de vencimiento, y la lista **ordenada** de pagos que tocaron su capital `{fechaDeCobro, capitalPagado}`. Salida: cargo devengado por tramos `{desde, hasta, base, días, importe}`.

* Cada pago **cierra un tramo** y reduce la base; el tramo abierto corre hasta `asOf` y se calcula al leer (nunca se guarda el «hoy»).
* **Aritmética entera con `BigInt`**: `importe = round_half_up(base_centavos × tasa × días / (convención × 100))`, **redondeado por tramo** a centavo. Sin flotantes.
* Días: se cuentan días **posteriores** al vencimiento más la gracia: `días_devengados = max(0, díasDeAtraso − gracia)`.
* **Tope por cuota**: Σ tramos ≤ `capPct % × capital de la cuota`; al llegar, el devengo se detiene.
* **Castigado**: el `asOf` efectivo se limita a `written_off_at`.
* **Sin desglose capital/interés en el cronograma ⇒ no hay base ⇒ no se devenga** (se informa, no se inventa).

### 3.2 Fechas de cobro fuera de orden
La imputación va en orden de **registro**; las fechas de cobro pueden ir hacia atrás. Regla: el corte de un tramo es `max(últimoCorte, fechaDeCobro)`; el devengo **nunca retrocede** ni genera días negativos. Es conservador y determinista; se documenta en pantalla («el cobro del día X se imputó al corte del día Y»). Un pago registrado tarde **no reescribe** cargos ya imputados a pagos posteriores.

### 3.3 Imputación con mora (cambio en `allocatePayments`)
Por cuota, de la más antigua: **mora → interés corriente → capital**. La mora de cada cuota se calcula a la **fecha de cobro** del pago (3.2). El importe del pago que sobre pasa a la cuota siguiente.

### 3.4 Persistencia
1. `payment_applications` gana **`component`** (`SCHEDULED` por defecto | `LATE_INTEREST`) y el único pasa a `(payment_id, installment_number, kind, component)`. Las filas existentes quedan `SCHEDULED`: **migración aditiva, sin tocar datos**.
2. Tabla nueva **`credit_late_waivers`** (append-only, RLS, sin UPDATE/DELETE): `credit_id, installment_number, amount, reason, created_by, created_at`. La exoneración es un **hecho**, no una edición.
3. **No** se persiste el devengo abierto ni un «saldo de mora»: se deriva = `devengado(réplica) − cobrado(aplicaciones LATE_INTEREST) − exonerado`. Es lo que hace reproducible el historial y permite que el verificador compare.
   * Riesgo asumido: si en el futuro cambia el redondeo, la réplica de créditos viejos podría diferir un centavo. Mitigación: la versión de política y una constante de versión del algoritmo se sellan en cada aplicación (`policy_version`).

### 3.5 `outstanding_balance` y D6
`outstanding_balance` **sigue siendo el saldo del plan** (cuotas), sin mora: no se mezclan dos conceptos en una columna. Se agrega a la ficha `lateInterestPending` por separado. `PAID` exige `outstanding_balance = 0` **y** mora pendiente = 0 (D6); si solo queda mora, el crédito sigue `ACTIVE` y la mora sigue visible.

### 3.6 Créditos existentes (D8)
No cambia nada para ellos. La activación explícita por crédito (con fecha de inicio **futura**) es F3-e y crea una versión sellada nueva solo para ese crédito.

## 4. Entrega por pasos (cada uno con su commit y suite verde)

| Paso | Contenido | Toca dinero en vivo |
|---|---|---|
| **F3-a** | `late-interest.ts` en `shared` + pruebas de propiedad (conservación de centavos, sin retroceso, tope, gracia, castigado, 360/365, bisiestos, fechas fuera de orden). **Sin DB ni API.** | No |
| **F3-b** | Migración (`component`, `credit_late_waivers`) + RLS + permisos + modelo Prisma. | No (aditivo) |
| **F3-c** | `allocatePayments`/`buildUpdatedPlan` con política; `applyCore` escribe `LATE_INTEREST`; regla D6; verificador de coherencia; **pruebas de concurrencia e idempotencia** (dos pagos simultáneos al mismo crédito, reintento con la misma clave). | **Sí — el paso de riesgo** |
| **F3-d** | Exoneración (endpoint auditado + permiso + UI) y mostrar mora en Mora, Cartera y Pagos (línea aparte). | Sí (solo lectura + 1 escritura) |
| **F3-e** | Activación explícita por crédito con fecha futura. | Sí |

Cada paso se revisa contigo antes de pasar al siguiente de riesgo (F3-c).

## 5. Decisiones que necesito de ti (PROPUESTA con mi recomendación)

| # | Pregunta | Recomendado |
|---|---|---|
| P1 | Redondeo del devengo | **Por tramo, half-up a centavo** |
| P2 | Gracia | **No devenga durante la gracia, y no es retroactiva al terminar** (`max(0, días − gracia)`) |
| P3 | Fechas de cobro hacia atrás | **El corte nunca retrocede** (3.2) |
| P4 | ¿Quién puede exonerar? | Permiso **nuevo** `late_interest:waive` (separado de `payment:write`), con motivo obligatorio y auditoría |
| P5 | `outstanding_balance` | **Sin mora**; mora aparte (3.5) |
| P6 | Tope (D5) | Se aplica **por cuota** sobre su capital; ya está en la política |

## 6. Riesgos
1. `applyCore` es el camino de mayor impacto: cualquier error mueve plata. Por eso F3-c va solo, con propiedades y concurrencia, y detrás del interruptor (con la política `NONE` el camino debe ser **idéntico bit a bit** al actual: prueba de equivalencia sobre todas las suites existentes).
2. Legal: usura, anatocismo y orden de imputación varían por país; Kobrax no afirma cumplimiento (el aviso ya está en la pantalla).
3. Cronogramas importados sin desglose: no devengan (3.1).
4. Pagos offline desde el móvil: la fecha de cobro la trae el dispositivo; se acota con `assertPaymentDate` (ya existe).
