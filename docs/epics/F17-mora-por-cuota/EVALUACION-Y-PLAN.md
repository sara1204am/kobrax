# F17 · Gestión de mora por cuota — evaluación arquitectónica y plan (MVP)

> Fecha: 2026-11-20 · Estado: **F0, F1 y F2 implementados** (sin commit) · **F3 (interés moratorio) en espera de decisiones D1–D10**
> Método: auditoría del repositorio real + segunda opinión independiente (Claude Fable) · Convención: **HECHO** = verificado en el código, **INFERENCIA**, **PROPUESTA**.

## 1. Recomendación ejecutiva

Entregar **ya** la opción A (sin cargos adicionales) con **mora por cuota visible** y la **política de mora sellada en cada crédito**; dejar la opción B
(interés moratorio anual) como una fase posterior, porque obliga a tocar el camino del dinero (`applyCore`) y depende de decisiones legales y contractuales
que sólo la dueña del producto puede tomar. Sellar la política **hoy** evita el único error caro: que más adelante un cambio de política alcance créditos viejos.

## 2. Diagnóstico (A)

| Pieza | Estado | Evidencia |
|---|---|---|
| Plan actualizado por cuota (pagado/pendiente/vencido), imputación FIFO, mora por cuota | **Existe** (hecho en la auditoría «Mora vs Cartera») | `packages/shared/src/utils/payment-plan.ts`, `credits/credit-plan.ts` |
| Libro de imputaciones inmutable | **Existe** | tabla `payment_applications` |
| Cálculo de días de mora por cuota | **Faltaba** (sólo un número por crédito) | ahora `UpdatedPlanRow.daysPastDue` |
| Capital vencido separado del interés corriente | **Faltaba** | ahora `overduePrincipal` / `overdueInterest` (interés primero) |
| Detalle de cuotas vencidas en Mora | **Faltaba** | ahora `OverdueInstallmentsSection` |
| Política de mora por cuenta/producto/crédito | **No existía** | ahora `late_policy_versions` + `credits.late_policy_version_id` |
| Código legado de mora con cargos | **Existía y era incompatible** | `credit-math.ts` `computeArrears`: tasa diaria **0,001 por defecto (36,5 % anual) que nadie configuró**, base = todo lo vencido × días de la cuota más antigua, `float`, y la tabla `arrears` se borra y recrea. Ninguna pantalla lo usa; sí salía en `GET /credits/:id`. |
| `applyCore` con cargos fuera del plan | **No lo soporta** (rechaza `monto > saldo`, descuenta todo del saldo, marca `PAID` con saldo 0, exige `ACTIVE`) | `payments.service.ts` |
| `credits.metadata` como lugar del snapshot | **No sirve** | `readCreditMetadata` es lista blanca y los escritores reescriben la columna: una clave nueva se perdería al primer pago |

## 3. Arquitectura recomendada (B–E)

```
CUENTA (accounts: país, moneda, zona horaria, tipo)        ← contexto, no condiciones de crédito
   └─ late_policy_versions  (scope=ACCOUNT)  v1, v2…        ← política por defecto de la cuenta (append-only)
        └─ late_policy_versions (scope=PRODUCT, type_code)  ← override por producto (CREDIT_TYPE), opcional
              └─ credits.late_policy_version_id             ← referencia INMUTABLE, sellada al crear (trigger)
```

| Nivel | Qué guarda | Qué NO guarda |
|---|---|---|
| Cuenta | País, moneda, zona horaria, tipo; política por defecto (versión) | Condiciones de cada crédito |
| Producto (`CREDIT_TYPE`) | Override opcional de la política (versión) | Tasas del crédito |
| Crédito | Referencia inmutable a la versión de política; plan contractual | Cargos calculados dentro de la cuota |

**Decisión:** tres niveles reales (no cuatro); «configuración financiera» no es una entidad aparte: es la política por defecto de la cuenta. Sin override por oficina.

### Modelo de datos mínimo

| Entidad | MVP | Reservado (F3+) |
|---|---|---|
| `late_policy_versions` (hecha) | `kind` NONE; `scope`, `type_code`, `version`, `grace_days`, `effective_from`, `created_by` | `ANNUAL_RATE` con `annual_rate` y `day_count` (ya en el esquema, **no activable** desde la API) |
| `credits.late_policy_version_id` (hecho) | Sellado por trigger en TODO camino de creación | — |
| `credit_late_charges` (libro append-only de devengos) | — | Por crédito+cuota+tramo, con parámetros usados, `ACCRUAL/REVERSAL/WAIVER`, único `(credit, cuota, period_from)` |
| `payment_applications.component` | — | `INSTALLMENT` \| `LATE_CHARGE` |
| Tope acumulado, base alternativa | — | Columnas nuevas en una versión nueva |

## 4. Integración con el motor existente (H)

* La mora por cuota sale de `buildUpdatedPlan` (una sola función, la misma para Cartera y Mora). No hay cálculo en el frontend.
* Un pago cubre **primero el interés corriente de la cuota y después el capital** (regla implementada y probada).
* Cuando exista B, la base del devengo es el **capital pendiente de cada cuota** (nunca la cuota entera, nunca cargos previos: sin capitalización).

## 5. Wizard, modo simple/avanzado, migración (G, J)

* **No configurar la mora en el wizard.** Default «sin cargos adicionales»; el resumen lo dice en una línea y remite a Ajustes.
* Modo simple (hoy): se ve el atraso, los días por cuota, lo vencido (capital/interés) y el aviso «sin cargos por mora».
* Modo avanzado (F3): tasa anual, convención de días, gracia, tope, detalle del cálculo; obligatorios sólo si se elige B.
* **Migración (hecha):** cada cuenta existente recibe la v1 `NONE`; cada crédito existente se sella con ella. No se tocó ningún saldo ni cronograma, no se asignó ninguna tasa, no se generó ningún cargo.
* Importados (PSF): nunca devengan; manda la fuente.

## 6. Créditos castigados (8)

* Estado contable (`written_off_at`), estado de mora (episodio), recuperación (pagos) y saldo de capital son condiciones independientes y ya se conservan.
* **El castigo no genera cargos nuevos** (con la política `NONE` no hay cargos; con B el devengo se congela en `written_off_at`, decisión D7).

## 7. Plan por fases

| Fase | Contenido | Estado |
|---|---|---|
| **F0** | Quitar el interés moratorio inventado (default de la tasa diaria 36,5 % → 0) | **Hecha** |
| **F1** | Días por cuota, capital/interés vencido, detalle en Mora, columna de días en Cartera | **Hecha** |
| **F2** | Versiones de política append-only, backfill `NONE`, sellado por trigger en todo camino, `latePolicy` en la ficha | **Hecha** |
| F2b | UI «Configuración → Cuenta → Configuración financiera» (hoy sólo habría una opción) y política por producto | Pendiente (sin valor hasta F3) |
| F0b | Dejar de escribir/exponer `arrears.interest/penalty` y borrar la tabla `arrears` | Pendiente: **requiere tu confirmación** (migración destructiva) |
| **F3** | Interés moratorio anual: función de devengo en `shared` (entera/decimal), libro `credit_late_charges`, `component` en `payment_applications`, cambios en `applyCore`, cierre por tramos, exoneración manual auditada | **Bloqueada por D1–D10** |
| V2/V3 | % diario, cargos fijos, topes avanzados, perfiles regulatorios (ASFI), flujos de aprobación | Fuera del MVP |

## 8. Decisiones que sólo tú puedes tomar (con default recomendado)

| # | Decisión | Default |
|---|---|---|
| D1 | Orden de imputación de un pago | Por cuota: mora, interés, capital (validar con asesoría legal por país) |
| D2 | Base de cálculo | Capital vencido pendiente de la cuota; nunca la cuota entera |
| D3 | Convención de días | Actual/365 (360 configurable) |
| D4 | Fecha de corte del devengo | `paymentDate` (aunque la imputación siga el orden de registro) |
| D5 | Tope | Tasa máxima validada al guardar + tope acumulado opcional por cuota; el tope legal lo declara la cuenta |
| D6 | Crédito con mora pendiente al llegar su saldo a 0 | No pasa a `PAID` hasta pagarla o exonerarla (con auditoría) |
| D7 | Castigados | El devengo se congela en `written_off_at`; los pagos se siguen aceptando |
| D8 | Aplicar B a créditos vigentes | No; sólo con acción explícita por crédito y fecha de inicio futura |
| D9 | Gracia | 0 días, configurable |
| D10 | Préstamos abiertos (sin plan) | Sin cargos en el MVP |

## 9. Riesgos

1. Tocar `applyCore` para B (tope, saldo, `PAID`) — pruebas de concurrencia e idempotencia obligatorias; actualizar el verificador de coherencia.
2. Legal: usura, anatocismo y orden de imputación varían por país; Kobrax no debe afirmar cumplimiento.
3. Pagos registrados tarde u offline: fecha de cobro ≠ de registro (D4).
4. Cronogramas importados sin desglose capital/interés: B no tiene base; bloquearlo en esos créditos.
5. Zona horaria: el plan corta días en UTC; con dinero por día, un desfase de un día es un cargo erróneo (resolver antes de F3).
6. Precisión: el devengo no debe hacerse con `number` de coma flotante.

## 10. Criterios de aceptación y pruebas

Cubiertos hoy: días por cuota (unit `shared`), capital/interés vencido (unit), `DEFAULT_ARREAR_PARAMS` sin cargos (unit), detalle de cuotas vencidas (web), sellado en todo camino de creación,
creación concurrente de la v1, inmutabilidad de la referencia y de las versiones, no-retroactividad de una política nueva, política por producto (integración con base real).
Pendientes para F3: devengo por cuota (propiedad), idempotencia por tramo, concurrencia de cierres, reversos/exoneraciones, imputación con componente, castigados.
