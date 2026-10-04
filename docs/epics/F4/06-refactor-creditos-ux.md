# F4 · Fase 6 — Refactor UX de Créditos + motor financiero único

**Parent:** [EPIC-F4 Core Financiero](../EPIC-F4-core-financiero.md) · **Estado:** 🚧 En curso (Fases 0 a 5 cerradas; la 6 es opcional)
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
| D17 | **El período de la tasa es independiente de la frecuencia de pago** (2026-09-25). El % se pacta por cuota, mensual, trimestral, semestral o anual, y el motor lo convierte a la tasa de la cuota. Nominal (proporcional) por defecto; efectiva (TEA) como opción. El plazo se puede cargar en cuotas, meses o años. Ver abajo. |
| D20 | **Cómo se cuenta la mora, por crédito** (2026-09-25). `oldest_unpaid` (desde la cuota impaga más antigua, lo de siempre) o `first_default` (bancario: desde el primer atraso hasta quedar al día). El default lo pone la cuenta; con pagos no se cambia. Ver abajo. |
| D18 | **Desgravamen y otros cargos** (2026-09-25). Desgravamen = % mensual sobre el saldo de capital, sumado a cada cuota. Cargos: monto por cuota, único en la 1.ª cuota (fijo o % del monto) o descontado del desembolso. Entran en el total y el saldo; la ganancia sigue siendo el interés. Ver abajo. |

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

**Fuera de alcance:** cuota variable manual (cuotas tipeadas una por una) y reestructuración. El desgravamen y los
cargos, que el plan original dejaba afuera, entraron por pedido de la usuaria (D18).

**Orden de despliegue:** API → web → mobile. Las frecuencias nuevas no se ofrecen en la UI hasta que la versión de
mobile que las entiende esté publicada, porque las versiones viejas las leen como `MONTHLY`.

## D13 (ampliada) y D20 — Cuotas ya pagadas en el alta y método de mora ✅ (2026-09-25)

**Cuotas ya pagadas (D13, decisiones de la usuaria):**
- Las pagadas son **siempre las primeras k, sin huecos** (1..k pagadas, k+1..n pendientes); el modelo de conteo
  (`initialState.paidInstallments`) ya lo representa. **Máximo n − 1**: no se registra un crédito con todas pagas.
- **Vuelve al alta web** (en la Fase 3 había quedado sólo en Editar): en *Plan de pagos* del Nuevo crédito, el select
  «Cuotas ya pagadas antes de registrarlo» (0..n−1) y la columna **Estado** de la tabla. Tocar una cuota **mueve el
  corte** (desmarcar la 4 deja 1–3; marcar la 7 deja 1–7). Editar usa el mismo control mientras no haya pagos.
- Sin campos manuales de saldo ni de días de mora cuando hay plan: el saldo sale de las cuotas y la mora de la
  primera impaga. Siguen a mano sólo en el préstamo abierto (sin plan).
- Lo pagado antes del registro **no genera `Payment`**; en las cuotas guardadas queda `PAID` **sin `paidAt`** (no se
  sabe cuándo se pagó). `priorPaidAmountOf` lo calcula y **«Recuperado X de Y» lo descuenta**: mide sólo lo cobrado en
  Kobrax (web, mobile y `paymentProgress`).
- La auditoría del alta y de la edición (`creditSummary`) incluye `initialState` y `arrearsMethod`.
- El panel derecho del alta muestra cuotas pagadas, saldo, próxima cuota y mora (`registrationSituation`, shared).

**D20 — método de mora** (`packages/shared/src/utils/arrears-method.ts`, tests en `arrears-method.spec.ts`):
- `oldest_unpaid` (default): desde la cuota impaga más antigua; pagar la más atrasada baja la mora.
- `first_default` (bancario): `metadata.arrearsSince` se fija en el primer atraso y **no se mueve** mientras siga
  habiendo cuotas vencidas; vuelve a 0 (y se borra) al quedar al día o con «Poner al día».
- Se guarda en `metadata.arrearsMethod` de **cada** crédito. El default es de la cuenta (`accounts.settings.arrearsMethod`,
  editable en Cuenta → datos) y viene preseleccionado en «Opciones avanzadas» del alta (web y móvil). Cambiar el
  default no toca los créditos ya dados.
- **Con pagos registrados no se cambia** (`CREDIT_HAS_PAYMENTS`); sin pagos se cambia, recalcula la mora y queda en la
  auditoría (antes y después).
- Aplicado en: alta (con cuotas pagadas), pago (`creditPatchAfterPayment`), trabajo diario (`arrears-job`),
  recálculo manual, edición y «Poner al día». Importada y mora marcada a mano no usan el método (su dueño es otro).
- La ficha (web y móvil) muestra las dos lecturas: «167 días desde 12 abr · Cuota a reclamar: 5 (venció 12 may)»
  (`CreditDetail.arrearsSince` + `oldestUnpaid`).
- Verificado por la API real: 10 cuotas de 150, 3 pagadas, hoy sep 2026 → 167 días; paga la 4 → `oldest_unpaid` 137,
  `first_default` 167 desde el 12 abr; cambiar el método con pagos → `CREDIT_HAS_PAYMENTS`; default de la cuenta aplicado.

## D18 — Desgravamen y otros cargos ✅ (2026-09-25)

**Reglas** (respuestas de la usuaria; `packages/shared`, tests en `credit-extras.spec.ts`), sólo en «Calcular cuotas»:
- `CalculatedTerms.insuranceMonthlyPercent`: desgravamen = saldo de capital **al inicio** de cada período × % mensual
  (con otra frecuencia, × 12 / cuotas por año). Tope 5 % mensual (`INSURANCE_INVALID`).
- `CalculatedTerms.charges[]` (`CreditCharge`: `label?`, `timing`, `amount` **o** `percent`):
  - `per_installment` — monto fijo en cada cuota (no admite %);
  - `first_installment` — una vez, en la 1.ª cuota: monto fijo o % del monto;
  - `deducted` — descontado del desembolso: no toca las cuotas; `quote.extras.netDisbursement` = monto − descontado
    (`DEDUCTION_TOO_LARGE` si se come todo).
- Cada fila del plan lleva `insurance` y `charges`; su `amount` los incluye. **Total a cobrar y saldo (D15) los
  incluyen**: el cliente los debe. «Ganancia» sigue siendo sólo el interés; seguro, cargos y monto a entregar se
  muestran aparte (`quote.extras`).
- Con desgravamen o cargo en la 1.ª cuota las cuotas varían → la API guarda el cronograma fila por fila (como la
  cuota variable). La tabla `credit_installments` no separa seguro/cargos (van dentro de `amount`): para estas filas
  el control del alta es Σ capital = monto, no Σ cuota = capital + interés.
- Sin seguro ni cargos no se guarda ninguna clave nueva: los créditos de siempre quedan igual.
- **Pantalla (web y móvil), Opciones avanzadas:** «Desgravamen (% mensual)» y «⚙ Otros cargos» (lista: descripción,
  cómo se cobra, valor). El panel muestra Desgravamen · Otros cargos · Descontado · Monto a entregar; el plan, las
  columnas Seguro y Cargos; la ficha, el seguro y los cargos pactados.
- Verificado por la API real: 10.000 al 18 % anual, 12 meses, francés; desgravamen 0,05 %; 5 por cuota; 1 % de
  comisión; 100 descontados → 1.ª cuota 1.026,80, 2.ª 926,42, total 11.194,99; un pago de 1.026,80 salda la 1.ª.

**Pantalla de «Calcular cuotas» — valores por defecto (pedido de la usuaria):** el interés arranca en **anual** y
el «Período del préstamo» en **años** (luego meses). Layout en pantalla ancha: datos en 3/4 y el panel de la cuota
en 1/4, fijo al bajar (Nuevo crédito y Editar).

## D17 — Tasa con período propio y plazo en meses/años ✅ (2026-09-25)

**El problema:** el banco dice «18 % anual a 3 años» y se paga mensual; el prestamista, «5 % mensual» y cobra
semanal. La pantalla sólo tenía «Interés (%)», que el motor tomaba siempre **por cuota**: un 18 % anual cargado así
cobraba 18 % cada mes.

**La regla** (`packages/shared`, con tests en `credit-rate-period.spec.ts`):
- `CalculatedTerms.ratePeriod` (`per_installment` · `monthly` · `quarterly` · `semiannual` · `annual`) y
  `rateConvention` (`nominal` · `effective`). Opcionales y sólo se guardan si no son el default: un crédito de
  siempre queda igual (sigue `termsVersion: 1`).
- `periodicRatePercent` da la tasa de la cuota, la única que usa el cálculo:
  - nominal = tasa × (períodos de la tasa por año ÷ cuotas por año). 18 % anual, mensual → 1,5 %;
  - efectiva = (1 + tasa)^(períodos de la tasa ÷ cuotas por año) − 1. 18 % TEA, mensual → ≈ 1,389 %.
- Cuotas por año (`PAYMENTS_PER_YEAR`): diario 360 (convención bancaria), semanal 52, quincenal 26 (el calendario
  avanza de a 14 días), mensual 12, trimestral 4, semestral 2, anual 1.
- El tope de 100 % se controla sobre la tasa **ya convertida**. «% del total» no admite período
  (`RATE_PERIOD_NOT_SUPPORTED`).
- **Plazo:** `CreditForm.termUnit` (cuotas · meses · años) → `termInstallments`: 3 años mensual = 36 cuotas. Si no da
  cuotas enteras (1 mes semanal) se avisa (`TERM_NOT_WHOLE`), no se redondea. Se guarda en cuotas.
- La columna `interest_rate` guarda la tasa **como se pactó** (18), sólo para mostrar (D7).
- Verificado: 10.000 al 18 % nominal anual, francés mensual, 12 meses → cuota 916,80 (la de un simulador bancario),
  por la API real y en la ficha web.

**Pantallas:** en web y móvil, el interés lleva al lado «El interés es: por cuota / mensual / … / anual» y la
equivalencia («Equivale a 1,5 % por cuota (mensual)»); el plazo, «cuotas / meses / años» con «= 36 cuotas»; «Tipo de
tasa» (nominal/efectiva) va en Opciones avanzadas. La ficha muestra «18 % anual» y, debajo, «1,5 % por cuota». De un
importado se muestra «X % (según la fuente)», porque el archivo del banco no dice el período.

## Cuota variable (capital fijo) se registra ✅ (2026-09-25)

**Adelanta la parte de la Fase 6 que hacía falta.** Con capital fijo la cuota baja en cada pago, así que no hay una
sola cuota que congelar. En vez de rechazarlo (`CREDIT_TERMS_NOT_PERSISTABLE`, eliminado):
- `resolveCreditTerms` devuelve `schedule` cuando las cuotas varían, y la API **guarda ese cronograma** en
  `credit_installments`. Pagos (`applyPayment`, en orden), mora (`computeArrears`), próxima fecha y cuota
  (`creditView`) ya funcionaban sobre filas: son los de los créditos con cronograma de siempre.
- «En curso» (D13): las primeras k cuotas nacen `PAID`.
- Edición sin pagos: se borran las filas y se rehacen con las condiciones nuevas. Pasar a cuota fija las deja vacías
  y congela la cuota. `termsEditBlock` sólo bloquea el cronograma **sin** `terms` (web anterior a F4/06).
- Compuesto + capital fijo sigue sin ofrecerse (D4): al elegir cuota variable el interés queda simple.
- Verificado por la API real: 12.000 al 24 % anual, 6 meses → 2.240, 2.200 … 2.040; tras pagar la primera,
  saldo 10.600 y próxima cuota 2.200.

**Pantalla de «Calcular cuotas» (pedido de la usuaria, 2026-09-25), web y móvil:**
- «Tipo de cuota: Cuota fija / Cuota variable», a la vista (antes «Método», escondido en Opciones avanzadas).
  **Pago único ya no se ofrece**; sólo aparece si el crédito guardado lo tiene.
- «Período del préstamo» en **meses o años** (sin «cuotas»). Al reabrir un calculado, el período vuelve en meses
  (`installmentsToMonths`); si no da meses enteros (10 cuotas semanales), en cuotas. En cuota acordada y total
  acordado sigue la opción «cuotas».
- Rótulos: «Período del préstamo» y «Frecuencia de pago».

## Fase 5 — Mobile ✅ (2026-09-25)

- **Decisión (usuaria, 2026-09-25): en el móvil, «Este préstamo ya está en curso» sigue en el alta.** En la calle,
  sin señal, crear y después ajustar serían dos operaciones offline y el préstamo quedaría un rato con el saldo
  equivocado. Viaja como `initialState` en el mismo `POST /credits` (con `terms`); la API aplica la misma regla D13
  (`registeredState`) que en la edición. La web sigue ajustándolo desde Editar.
  - `CreateCreditDto.initialState`: exige `terms` (`CREDIT_TERMS_INVALID`), no se mezcla con
    `outstandingBalance`/`daysPastDue` sueltos (`CREDIT_TERMS_CONFLICT`) y valida contra las condiciones
    (`CREDIT_INITIAL_STATE_INVALID`). `buildNewCreditPayload(form, clientId, initialState?)` lo arma.
  - ⚠️ `InitialStateDto` tiene que declararse **antes** de `CreateCreditDto`: con `emitDecoratorMetadata` la API no
    arrancaba (`Cannot access 'InitialStateDto' before initialization`). Los tests con `tsx` no lo detectan.
- **Alta** (`app/prestamo/nuevo.tsx`): el mismo modelo que la web —tres definiciones, opciones avanzadas,
  cotización— con `CreditForm` de shared. «Ver plan de pagos» abre una hoja (`PlanSheet`) con las filas del motor.
  Sin `clientId` explica que el préstamo se carga desde un cliente, en vez de no hacer nada al guardar.
- **Edición** (`app/cliente/editar.tsx`): redefine condiciones y estado al registrar con `creditRedefinition`
  (shared, la misma regla que la web). Con pagos o cronograma guardado sólo se mueve la próxima fecha; el importado
  no se edita. Antes mandaba campos sueltos, que la API rechaza en créditos con `terms`.
- **Ficha** (`app/cliente/[id].tsx`): carga también `GET /credits/:id`. «Recuperado X de Y» usa `recovery`
  (`src/ficha.ts`, sobre `paymentProgress`): contra el total si la base es `total`, sin barra si el total no se
  conoce. «Datos del préstamo» muestra saldo, total, definición, cuotas, frecuencia, «No registrado» del importado
  (D9), lo cargado en curso y el plan en una hoja.
- **Componentes:** `src/credit-terms-view.tsx` (`CreditTermsFormView`, `CreditQuotePanel`, `PlanSheet`,
  `InitialStateFields`) y `src/credit-labels.ts` (los mismos textos que la web, con las 7 frecuencias).
- **Bug `ajustes/importacion.tsx`:** «Agregar crédito a mano» abría el alta sin cliente. Ahora va al alta de
  cliente, que ya ofrece «guardar y cargar préstamo».
- **Frecuencias nuevas:** el móvil ya las lee y las rotula, pero `OFFERED_FREQUENCIES` **no se amplió**: según el
  orden de despliegue, se ofrecen recién cuando esta versión del móvil esté publicada.
- **Verificado:** tests (mobile 329) y el alta del móvil con `initialState` por la API real, incluido el reintento
  idempotente de la cola. La app no se corrió en un dispositivo.

## Fase 4 — Importados ✅ (2026-09-25)

- **D9 sin migración:** `principal_amount`, `interest_rate`, `outstanding_balance`, `days_past_due` e
  `installments_count` son `NOT NULL`. Hacerlas anulables arrastraba API, web y mobile, así que el alta
  importada sigue escribiendo un 0 de relleno, pero **el campo queda en `metadata.importMissing`**
  (`packages/shared/src/utils/credit-import.ts`, `nextImportMissing`, con tests). La API lo expone como
  `unknownFields` y la web dibuja «No registrado» (`isUnknownField`).
  - Alta: falta lo que el archivo no trajo.
  - Actualización: lo que llega deja de faltar **y se escribe** (ahora también capital y desembolso). Lo que no
    llega no se toca y, si ya se conocía, sigue conocido.
  - Importado antes de la Fase 4 (sin lista): se toma como faltante lo que el archivo actual no trae.
- **Cuota y próximo vencimiento** se guardan en `metadata` al crear y al actualizar (antes se leían y se descartaban).
- **`importRunId` / `importedAt`** en `metadata`: el id de la corrida se genera antes de escribir y es el mismo de
  `client_import_runs`.
- **Serializer, sólo origen `import`:** nº de cuotas, frecuencia y una cuota en 0 son desconocidos siempre. El
  importador nunca escribe el nº de cuotas y la columna nace en `@default(1)`: el total por cobrar salía = una cuota
  y la barra de progreso medía contra eso. Vale también para los importados viejos.
- **Código:** la lógica de qué escribe una fila salió de `portfolio-import.service.ts` a
  `apps/api/src/modules/imports/portfolio-credit.ts` (`creditCreateData`, `creditUpdateData`, con spec).
- **Web · detalle de solo lectura:** Condiciones y Estado actual con «No registrado»; el plan dice que lo lleva la
  fuente (antes decía «cuota congelada» y «préstamo abierto»); Origen muestra la última importación y la completitud
  («Datos que trajo el archivo: 5 de 9 · No registrados: …»). En la lista, monto y saldo desconocidos dicen
  «No registrado».
- **Verificado:** E2E con dos CSV contra la API local (config temporal, restaurada con `reset`) y la ficha por SSR.

## Fase 3 — Web · Detalle y Edición ✅ (2026-09-25)

- **Reglas de edición** (API `credits.service.ts` `update`; la ficha usa el mismo criterio, `termsEditBlock` de shared):
  - **Organización** (estado, código, tipo, responsable): siempre, también en el importado.
  - **Operativos** (nota, próximo cobro): cualquier crédito propio, tenga o no `terms`. Antes un crédito con
    `terms` rechazaba hasta la nota.
  - **Redefinir** (`terms` y/o `initialState` en el `PATCH`): la API recalcula cuota, total, saldo (D15),
    próximo vencimiento y mora con `resolveCreditTerms` + `registeredState`. Se rechaza:
    - con pagos registrados (`CREDIT_HAS_PAYMENTS`): sería una reestructura;
    - con cronograma guardado (`CREDIT_HAS_SCHEDULE`): hasta la Fase 6;
    - si es importado (`CREDIT_LOCKED`);
    - si se mezcla con campos financieros sueltos o con `nextDueDate` (`CREDIT_TERMS_CONFLICT`);
    - si el estado no cierra con las condiciones (`CREDIT_INITIAL_STATE_INVALID`).
  - **Campos sueltos** (capital, tasa, cuota, frecuencia): siguen sólo para créditos sin `terms` (mobile hasta la
    Fase 5). Con `terms` → `CREDIT_TERMS_EDIT_UNSUPPORTED`.
  - Esto cierra el pendiente de D15: al cambiar la cuota o el capital, el saldo total se recalcula.
- **D13 · Estado al registrar** (`packages/shared/src/utils/credit-edit.ts`, `registeredState`, con tests):
  - Cuotas ya pagadas (k), saldo pendiente (opcional) y días de mora. Se guarda en `metadata.initialState`.
  - Saldo: el tipeado (base `total`, ≤ total) o total − Σ de las k primeras cuotas del plan. En el préstamo abierto,
    el capital (base `principal`, D16).
  - Próximo vencimiento: la cuota k+1 del plan (o `firstDueDate` + k períodos si es abierto). k < n.
  - Mora > 0: marca manual `moraSince` y abre el caso (como «Marcar en mora»). Esa marca sólo se toca si cambió el
    número: una marca puesta con «Marcar en mora» sobrevive a corregir la cuota, y bajar la mora declarada a 0
    saca la que ella misma puso. Con 0, la mora la calcula la fecha.
  - Con esto la web vuelve a poder cargar un préstamo que ya venía corriendo: se crea con Nuevo crédito y se ajusta
    en Editar.
- **Ficha** (`apps/web/src/app/(panel)/cartera/[id]/credito/[cid]/`):
  - `credit-view.tsx`: lectura con Condiciones (con cuota, total y ganancia del motor) · Estado actual (saldo,
    total, próximo cobro, mora, estado, barra D15) · Plan (`PaymentPlanTable` desde `calculateCredit(terms)`, o
    el cronograma guardado con `dayDate`) · Cobranza · Origen.
  - `credit-editor.tsx`: `CreditTermsFields` + cotización + vista previa del plan, «Estado al registrar» con el
    saldo y la fecha que van a quedar, y Cobranza. Si no se puede redefinir, dice por qué.
  - `credit-card.tsx` orquesta: botón **Editar**, Cancelar / Guardar cambios.
  - `lib/credit-patch.ts` compara contra cómo se abrió la ficha, no contra las columnas: un crédito viejo
    (sin `terms`) se abre como cuota acordada y guardar sólo una nota no lo redefine.
  - Crédito anterior a F4/06: se muestra lo que se cobra y, al redefinirlo, queda con `terms`.
- **Lista** (`credits-section.tsx`): badges de definición, «Cargado en curso», «Préstamo abierto» e «Importado».
- **Serializer:** expone `initialState` y, sólo en la ficha, `hasPayments`.
- **Borrado:** `components/loan-fields.tsx`. `hydratePrestamo` / `PrestamoForm` siguen vivos para mobile (Fase 5).
- **Corregido:** el cronograma guardado de la ficha formatea las fechas con `dayDate` (antes `date()`, un día antes
  en Bolivia).

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
  - Textos: «Monto a prestar», «Primer pago» / «Fecha de pago», «Crear crédito». Título, botón y ruta de
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
