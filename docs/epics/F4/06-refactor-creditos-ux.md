# F4 · Fase 6 — Refactor UX de Créditos + motor financiero único

**Parent:** [EPIC-F4 Core Financiero](../EPIC-F4-core-financiero.md) · **Estado:** 🚧 En curso (Fases 0, 1 y 2 cerradas; sigue la Fase 3)
**Owner:** Shared · API · Web · Mobile · **Depende de:** [F4/03-creditos](./03-creditos.md), [F4/05-importacion-clientes](./05-importacion-clientes.md)

## Objetivo

Separar los conceptos que hoy mezcla la pantalla "Nuevo préstamo" y hacer que Nuevo, Detalle y Editar compartan
estructura, **reutilizando** `LoanFields`, `LoanQuotePanel`, el design system y la lógica de `packages/shared`.

```text
CRÉDITOS
├── + Nuevo crédito           → solo crea (calcular cuotas · cuota acordada · total acordado)
├── Importar créditos         → flujo masivo independiente (no se toca desde Nuevo ni Detalle)
└── Lista de créditos → Detalle (lectura) → Editar
```

## Hallazgos que motivan el plan (análisis 2026-09-24)

- **Hay dos matemáticas.** La cotización de web y mobile (`quoteLoan`, `packages/shared/src/utils/loan.ts`) es interés
  plano. El cronograma (`buildSchedule`, `apps/api/src/modules/credits/credit-math.ts`) es francés o plano, solo
  mensual, y vive solo en la API. Mostrar un plan con una fórmula y cobrar con otra es el riesgo principal.
- **Web y mobile nunca generan cronograma:** `buildPrestamoPayload` siempre envía `installmentAmount`, y
  `credits.service.ts` congela la cuota en `metadata` (decisión D1 de `docs/epics/F10/plans/cartera/README.md`).
- **La tasa viaja en unidades mezcladas:** la web manda porcentaje (10), mientras el DTO documenta fracción (0,10).
- **Importación:** `installmentAmount` y `nextDueDate` se leen pero no se guardan, y los valores desconocidos se
  guardan como `0` (`portfolio-import.service.ts`, `creditCreateData` / `updateCredit`).
- **Lo desconocido no se distingue de cero:** `interestRate` no es nullable, y una frecuencia desconocida se lee como `MONTHLY`.
- **Seguro de desgravamen y cargos:** no existen en ninguna capa.

## Fase 0 — Decisiones de dominio ✅ (2026-09-24)

| ID | Decisión |
|---|---|
| D1 | Definiciones del crédito: `calculated` · `agreed_installment` · `agreed_total`. |
| D2 | Tipo de interés (`simple` · `compound`) y método de amortización (D3) son **ejes distintos**. "Francés" no significa "compuesto". |
| D3 | Método de amortización: `fixed_installment` (cuota fija) · `fixed_principal` (capital fijo, cuota decreciente) · `single_payment`. |
| D4 | Combinaciones válidas: ver la matriz abajo. **Compuesto + capital fijo no se ofrece**, porque da el mismo resultado que simple + capital fijo. |
| D5 | Frecuencias: se suman `QUARTERLY`, `SEMIANNUAL` y `ANNUAL`. **Pago único es un método (D3), no una frecuencia.** `DAILY` se mantiene. |
| D6 | Fin de mes: se conserva el día del primer pago y, si el mes no lo tiene, se usa el último día del mes (31/01 → 28/02 → 31/03). |
| D7 | La tasa vive en `metadata.terms.ratePercent`, en **porcentaje**. La columna `interestRate` queda solo para mostrar, también en porcentaje. Ningún cálculo lee la columna. |
| D8 | `InterestBase` (`PER_PERIOD` / `TOTAL`) se mantiene y solo aplica con interés simple y cuota fija. |
| D9 | "Desconocido" es `null` o un campo ausente, nunca `0`. La UI muestra "No registrado". |
| D10 | Créditos importados: **solo lectura** (se mantiene `CREDIT_LOCKED`). |
| D11 | Cuota acordada, reparto por fila: capital = P/n e interés = cuota − P/n; la última fila absorbe el redondeo. |
| D12 | Préstamo abierto (cuota acordada sin n): se permite y **no tiene plan** ("No disponible"). |
| D13 | Préstamo que ya venía corriendo: se crea con Nuevo crédito y, en Detalle → Editar, "Estado al registrar" ajusta saldo, cuotas pagadas y mora **solo mientras no haya pagos registrados**. |
| D14 | La fuente de verdad depende del modo (ver abajo). |

### D4 — Matriz

| | Cuota fija | Capital fijo | Pago único |
|---|---|---|---|
| **Simple** | ✅ `P/n + P·i` (el plano actual; con base `TOTAL`: `P(1+i)/n`) | ✅ interés sobre el saldo | ✅ `P·(1 + i·n)` |
| **Compuesto** | ✅ anualidad (francés) | ❌ no se ofrece | ✅ `P·(1 + i)^n` |

### D14 — Fuente de verdad según el modo

```text
                  ┌─ calculated ───────── API calcula → API manda
definitionMode ───┼─ agreed_installment ─ el usuario manda la cuota → la API valida y deriva
                  └─ agreed_total ─────── el usuario manda el total → la API deriva la cuota
```

- **calculated:** la API recalcula con `calculateCredit(terms)` y su resultado es el autoritativo.
  - Una cuota del cliente que difiere en ±0,01 por redondeo se normaliza al valor del motor.
  - Una diferencia mayor se **rechaza** con 400. No se permiten dos resultados financieros para el mismo modo.
- **agreed_installment:** la cuota enviada es contractual. La API **no** la reemplaza; valida que sea > 0 y deriva el total y la ganancia.
- **agreed_total:** el total enviado es contractual. La API deriva la cuota (total ÷ n, y la última cuota absorbe el redondeo) o el pago único.
- **Importado:** mandan los datos importados.
- **Transición de mobile:** las apps viejas no envían `terms` y siguen por el camino actual, que no cambia. Un cliente que sí envía `terms` recibe las reglas de arriba.

**Regla arquitectónica:** vista previa (web y mobile) y persistencia (API) usan **la misma función** `calculateCredit`.

## Fases

| Fase | Contenido | Complejidad |
|---|---|---|
| 1 | **Motor financiero compartido:** `CreditTerms` → `calculateCredit()` → cotización y cronograma. Frecuencias nuevas, regla de fin de mes, `metadata.terms`, API con D14. Paridad con `quoteLoan`. | Alta |
| 2 | **Web · Nuevo crédito:** sin checkbox "en curso"; tres definiciones; total acordado con pago único o en cuotas; Opciones avanzadas (solo tipo de interés, método y base); vista previa del plan. | Media |
| 3 | **Web · Detalle y Edición:** lectura → Editar; secciones Condiciones · Estado actual · Plan · Cobranza · Origen; "Estado al registrar" (D13); badges en la lista. | Media |
| 4 | **Importados:** guardar cuota y próxima fecha; no escribir `0` cuando falta el dato; completitud; `importRunId`; detalle de solo lectura. | Alta |
| 5 | **Mobile:** mismo modelo; hoja con el plan; estado actual en la ficha; bug `clientId` en `ajustes/importacion.tsx`; "Recuperado X de Y" (`src/ficha.ts` `recovered`) con `paymentProgress` (D15), que hoy mide contra el capital. | Media |
| 6 | **Cronograma real** (`CreditInstallment`) con la misma función. **Solo si hace falta**, porque cambia la mora y la aplicación de pagos. | Alta |

**Fuera de alcance:** seguro de desgravamen, cargos y comisiones (épica financiera aparte; **no** aparecen en
Opciones avanzadas), cuota variable manual y reestructuración.

**Orden de despliegue:** API → web → mobile. Las frecuencias nuevas no se ofrecen en la UI hasta que la versión de
mobile que las entiende esté publicada, porque las versiones viejas las leen como `MONTHLY`.

## Fase 2 — Web · Nuevo crédito ✅ (2026-09-24)

- **Lógica** (shared, `packages/shared/src/utils/credit-form.ts`, con tests):
  - `CreditForm` es el estado de la pantalla. `creditFormState` devuelve las condiciones, el cálculo, lo que falta,
    los avisos y si se puede guardar. `buildNewCreditPayload` arma el alta con `terms`, y los campos sueltos se
    derivan de las condiciones con `resolveCreditTerms`: pasan D14 por construcción.
  - Un número vacío es un **faltante**, nunca un 0 inventado. Mientras falte algo, la pantalla no muestra los errores
    del motor.
  - Queda lista para que mobile la use en la Fase 5.
- **Pantalla** (`apps/web/src/app/(panel)/cartera/[id]/prestamo/loan-form.tsx`):
  - Selector `Segmented` con Calcular cuotas · Cuota acordada · Total acordado.
  - Total acordado con forma de pago: pago único o en cuotas.
  - «Opciones avanzadas» plegable (`<details>`), solo en el modo calculado: tipo de interés, método (cuota fija o
    pago único) y base de la tasa si aplica.
  - Cotización en vivo y **vista previa del plan de pagos**, con las columnas Cuota · Fecha · Capital · Interés ·
    Total · Saldo de capital.
  - Textos: «Monto a prestar», «Primer pago» / «Fecha de pago», «Dar el crédito». Título, botón y ruta de
    navegación dicen «Nuevo crédito».
- **Componentes nuevos:**
  - `components/credit-terms-fields.tsx` (`CreditTermsFields`, `CreditQuotePanel`).
  - `components/payment-plan-table.tsx` (`PaymentPlanTable`, con fechas por `dayDate` en UTC).
- **Quitado:** el checkbox «Este préstamo ya está en curso» y sus textos. ⚠️ Hasta la Fase 3 (D13, «Estado al
  registrar» desde el detalle), **la web no puede cargar un préstamo que ya venía corriendo**. Mobile todavía puede.
- **Desvío del plan:**
  - Se creó `CreditTermsFields` en vez de ampliar `LoanFields`, porque `LoanFields` sigue sirviendo a la ficha, que
    edita créditos sin `terms`.
  - En la Fase 3 la ficha pasa a `CreditTermsFields` con modos de lectura y edición, y `loan-fields.tsx` se borra.
    Durante ese intervalo conviven dos componentes.
- **Corregido de paso:** la fecha por defecto usaba `toISOString()` (UTC) y en Bolivia proponía mañana a partir de
  las 20:00.
- **Encontrado para la Fase 3:** el `Schedule` de la ficha formatea los vencimientos con `date()` (hora local) y en
  Bolivia puede mostrarlos un día antes. `PaymentPlanTable` ya usa `dayDate`.
- **Verificado en el navegador:** capturas de los tres modos y alta real por el BFF. El rechazo D14
  `CREDIT_INSTALLMENT_MISMATCH` también se comprobó por el BFF.

## Fase 1 — Detalle

### Estado (2026-09-24)

- ✅ **Motor:** `packages/shared/src/utils/credit-engine.ts` (`calculateCredit`, `checkClientInstallment`, y
  `quoteLoan` / `quoteFromInstallment` como adaptadores). Tests en `credit-engine.spec.ts`: invariantes sobre las 5
  combinaciones D4, los ejemplos del pedido y la paridad de la cuota con la fórmula anterior. La única diferencia de
  la grilla es un empate en medio céntimo, donde el motor redondea hacia arriba.
- ✅ **Fechas:** `addPeriods` con las frecuencias trimestral, semestral y anual y con la regla D6.
  `OFFERED_FREQUENCIES` limita lo que ofrece la web mientras mobile no las soporte.
- ✅ **API:** `buildSchedule` (`apps/api/src/modules/credits/credit-math.ts`) delega en el motor. Las fechas pasan de
  `setMonth` local a UTC con D6.
- ✅ **Total mostrado:** `quoteLoan` devuelve como total la Σ de las cuotas del plan (antes era `cuota × n`, que podía
  diferir en céntimos del total real).
- ✅ **D15:** el saldo es el total pendiente (ver abajo).
- ✅ **Condiciones + D14:**
  - `CreateCreditDto.terms` (forma validada por `parseCreditTerms` de shared).
  - La regla D14 es la función pura `resolveCreditTerms` (shared, con tests); `credits.service.ts` solo la aplica y
    traduce cada rechazo a su error: `CREDIT_TERMS_INVALID`, `CREDIT_TERMS_CONFLICT`, `CREDIT_INSTALLMENT_MISMATCH`,
    `CREDIT_TERMS_NOT_PERSISTABLE`.
  - Se guardan `metadata.terms` + `termsVersion: 1`. El serializer expone `terms`, y `totalToCollect` usa el total
    exacto del motor.
  - Sin `terms` el alta es la de siempre, así que la cola offline de apps viejas sigue entrando.
- ⚠️ **Límites conocidos hasta otras fases:**
  - **Capital fijo:** el motor lo calcula (sirve para la vista previa), pero **no se registra**
    (`CREDIT_TERMS_NOT_PERSISTABLE`). Sus cuotas bajan y hoy se congela una sola, así que el avance de la próxima fecha
    tras un pago quedaría mal. Se habilita con el cronograma real (Fase 6).
  - **Edición:** la edición financiera de un crédito con `terms` se rechaza (`CREDIT_TERMS_EDIT_UNSUPPORTED`) hasta la
    Fase 3, que recalcula condiciones y saldo juntos. Lo no financiero (estado, código, tipo, cobrador) sí se edita.
- ⏳ **Sin cambios de pantalla todavía:** web y mobile no mandan `terms` hasta las Fases 2 y 5.

### ✅ D15 — El saldo es el total pendiente de cobro (decidida 2026-09-24)

**El problema:** `credits.service.ts` creaba todo crédito sin "en curso" con `outstandingBalance = principalAmount`,
y `payments.service.ts` (`applyCore`) rechaza un pago mayor que el saldo. En un préstamo de 1.000 al 10 % en
5 cuotas de 300 (total 1.500), la 4.ª cuota rebotaba con "El monto excede el saldo pendiente": **la ganancia no se
podía cobrar nunca**.

**La decisión:** `credits.outstanding_balance` significa **saldo TOTAL pendiente de cobro** (capital + ganancia), **no**
saldo de capital.

| Concepto | Dónde vive | Qué es |
|---|---|---|
| **Saldo total pendiente** | columna `outstanding_balance` | Lo que falta cobrar. Lo descuentan los pagos, así que una cuota completa entra entera. |
| **Saldo de capital** | derivado, `CreditScheduleRow.principalBalance` | Cuánto del capital prestado falta devolver. Se calcula desde el plan; **no** vive en ninguna columna ni se mezcla con la anterior. |

**La base se guarda solo cuando se sabe:** `metadata.balanceBasis` la escribe el alta y **nunca se estampa una
suposición** en un crédito viejo. `balanceBasisOf` (`packages/shared/src/utils/loan.ts`) da la base efectiva:

| Caso | Base |
|---|---|
| Marca guardada | la marca (`total` o `principal`) |
| Origen `import` / `api` | `total`: el saldo del archivo ya es el total pendiente, y conserva esa semántica |
| Manual sin marca | `legacy`: nació con saldo = capital y no está migrado |

**Implementado (Fase 1):**
- **Alta** (`credits.service.ts` `create`), en este orden:
  1. "En curso": el saldo informado, con base `total`.
  2. Si se conoce el total (Σ del cronograma o cuota × n): ese total, con base `total`.
  3. Préstamo abierto: el capital, con base `principal` (ver D16).
- **Pagos:** sin cambios en `applyCore`. Con saldo = total, una cuota que ya cubre ganancia se cobra entera
  (test `payments.service.spec.ts`, "D15").
- **Barra de progreso** (`paymentProgress`, `packages/shared/src/utils/credit-balance.ts`, usada por
  `credits-section.tsx`):
  - Base `total`: se mide **contra el total por cobrar**. Si el total no se conoce, **no hay barra**, porque no se inventa.
  - Base `legacy` y `principal`: contra el capital, como antes, hasta la migración.
- **Serializer:** expone `balanceBasis` (efectiva) y `totalToCollect`.

### ⚠️ D16 — Préstamo abierto (abierta)

Sin número de cuotas nadie conoce el total, así que el saldo sigue naciendo = capital (base `principal`). Con esa base,
un préstamo abierto **todavía no puede cobrar más que el capital**: es el comportamiento de antes, no una regresión.
Hay que definir qué significa "terminar" un préstamo abierto: un tope, cerrarlo a mano o darle un total al registrarlo.

### Créditos existentes: qué significa hoy su saldo y cómo migrarlos (sin ejecutar)

**Qué escribió cada camino hasta hoy:**

| Grupo | Cómo nació | Qué significa su saldo | ¿Se corrige solo? |
|---|---|---|---|
| 1 · importado/api | archivo del banco | total pendiente (decisión D15) | no hace falta: ya es `total` |
| 2 · manual, nació = capital, con ganancia | web/móvil sin "en curso" o API con cronograma | **capital − pagos**: le falta la ganancia | **sí**: nuevo saldo = total − Σ pagos |
| 4 · manual "en curso" | saldo tipeado por el cobrador | el que tipeó, con semántica desconocida | **no**: revisar a mano |
| 5 · abierto o sin cuota | sin total conocido | capital − pagos | **no**: depende de D16 |
| 6 · sin ganancia (total ≤ capital) | cualquiera | las dos bases coinciden | sí: solo marcar `total`, el saldo no cambia |
| 7 · sin auditoría de alta | anterior al audit | no se puede distinguir entre 2 y 4 | **no**: revisar a mano |

Lo que separa el grupo 2 del 4 es el **log de auditoría del alta**: `audit_logs.after.outstandingBalance`
guarda el saldo con el que nació. Si es igual al capital, nació con la regla vieja; si no, lo tipeó alguien.

**Estrategia propuesta (nada de esto está ejecutado):**
1. **Diagnóstico**, solo lectura, en cada ambiente: la consulta de abajo agrupa y calcula el ajuste propuesto.
2. **Marcar sin tocar saldos:** grupos 1 y 6 → `balanceBasis = 'total'`. No cambia ningún número.
3. **Corregir el grupo 2** con una migración de datos explícita y auditada, fila por fila (`before`/`after`):
   - saldo = total − Σ pagos, y marca `total`;
   - en los créditos **PAGADOS** de este grupo (la ganancia nunca se cobró) **no se reabre nada**: se listan para
     que el negocio decida.
4. **Grupos 4, 5 y 7:** lista para revisión humana. Quedan `legacy`, con la barra contra el capital como hoy.
5. **Compatibilidad mientras tanto:** los `legacy` se comportan exactamente como antes (mismo saldo, misma barra,
   mismos pagos). Solo los créditos nuevos nacen con la regla nueva.

```sql
-- D15 · diagnóstico de solo lectura. Grupos como en la tabla de arriba.
WITH c AS (
  SELECT cr.id, cr.status,
         coalesce(cr.metadata->>'origin', 'manual')  AS origin,
         cr.metadata->>'balanceBasis'                AS basis,
         cr.principal_amount AS principal, cr.outstanding_balance AS balance, cr.installments_count AS n,
         (cr.metadata->>'installmentAmount')::numeric AS cuota,
         (SELECT sum(i.amount) FROM credit_installments i WHERE i.credit_id = cr.id)            AS schedule_total,
         (SELECT coalesce(sum(p.amount), 0) FROM payments p WHERE p.credit_id = cr.id)          AS paid,
         (SELECT (a.after->>'outstandingBalance')::numeric FROM audit_logs a
           WHERE a.entity = 'credit' AND a.entity_id = cr.id::text AND a.action = 'CREATE'
           ORDER BY a.created_at LIMIT 1)                                                       AS balance_at_create
  FROM credits cr WHERE cr.deleted_at IS NULL
), k AS (
  SELECT *, coalesce(schedule_total, CASE WHEN cuota IS NOT NULL AND n > 0 THEN cuota * n END) AS total FROM c
)
SELECT CASE
         WHEN basis IS NOT NULL                         THEN '0 ya marcado (' || basis || ')'
         WHEN origin IN ('import', 'api')               THEN '1 importado/api'
         WHEN total IS NULL                             THEN '5 abierto o sin cuota'
         WHEN total <= principal                        THEN '6 sin ganancia'
         WHEN balance_at_create IS NULL                 THEN '7 sin auditoría de alta'
         WHEN abs(balance_at_create - principal) < 0.01 THEN '2 nació = capital (corregible)'
         ELSE                                                '4 cargado en curso'
       END AS grupo,
       count(*) AS creditos,
       count(*) FILTER (WHERE status = 'PAID') AS pagados,
       sum(CASE WHEN total > principal AND abs(balance_at_create - principal) < 0.01
                THEN (total - paid) - balance END) AS ajuste_saldo_propuesto
FROM k GROUP BY 1 ORDER BY 1;
```

Resultado en la base local de desarrollo (2026-09-24): 11 créditos. Grupo 1: 2; grupo 5: 5; grupo 6: 4 (1 pagado).
**Ninguno del grupo 2**, así que la local no sirve para medir el impacto: hay que correr la consulta en cada
ambiente real.

**Pendiente de la Fase 3:** editar la cuota o el capital de un crédito con base `total` hoy **no** recalcula el saldo
(ya pasaba antes con el capital). Las reglas de edición de D13 tienen que ajustar el saldo total cuando cambie el total.

### Plan original

- `packages/shared/src/utils/credit-engine.ts`: `CreditTerms` (unión discriminada por `definition`), `calculateCredit(terms)` →
  `{ quote, schedule | null, issues }`, en centavos enteros.
- `addPeriods` con las frecuencias nuevas y la regla D6. `PaymentFrequency` con `QUARTERLY`, `SEMIANNUAL` y `ANNUAL`.
- `CreditMetadata.terms` (versionado con `termsVersion: 1`), leído por `readCreditMetadata`.
- `buildSchedule` sale de `credit-math.ts` y la API importa el motor de shared. `computeArrears` se queda en la API.
- `CreateCreditDto.terms` opcional; `credits.service.ts` aplica D14.
- `quoteLoan` se mantiene como adaptador (paridad centavo a centavo) hasta las Fases 2 y 5.

**Terminado cuando:** existe una sola implementación del cálculo; las pruebas de paridad y de invariantes pasan
(Σ capital = P, Σ cuotas = total, saldo final 0, fin de mes, ejemplo trimestral 25/10/2026, ejemplo informal
1.000 → 1.500); las tres apps compilan; y todavía no cambia ninguna pantalla.
