# Cartera · 00 — Fundación backend (crédito sin cronograma + cobro que descuenta + subida de archivos)

> Índice: [README.md](./README.md) · Spec: [`docs/flows/Cliente_Prestamo.pdf`](../../../../flows/Cliente_Prestamo.pdf)
> **Slice sin pantalla.** Deja el backend capaz de expresar los 3 modos de captura del PDF, de servir la
> lista de cartera y de recibir fotos. Sin esto, ninguna de las 3 pantallas es funcional.
> **Rama:** `f10/cartera-fundacion` · **Build: 🟢** (backend + Expo Go; no cruza el dev build).
> **Revisión 2026-07-13:** reescrito contra el PDF (antes contradecía §4.1/§7/§8) y contra el código real.
> Cambios: se cae el cronograma generado (D1), se caen 3 deltas, y **dos bugs confirmados** (R1/R2) pasan de
> "riesgo a verificar" a **tarea bloqueante**.

## 1. Objetivo
El PDF describe un crédito **sin plan de cuotas**: capital, una cuota congelada, una frecuencia y una próxima
fecha (§4.1, §4.2, §7). El backend hoy **no puede expresarlo** (`installmentsCount` obligatorio, siempre
genera cronograma) y, peor, **se rompe en silencio si un crédito no tiene cuotas**: un pago no descuenta la
deuda y la mora se pisa con 0. Este slice cierra esas dos cosas, agrega el JSONB donde viven los campos
operativos, y construye el único primitivo que falta: subir un archivo.

Todo lo demás — alta de cliente, teléfonos, direcciones, adjuntos, casos, gestiones, pagos idempotentes, hash
SHA-256, RLS, audit, PII — **ya existe y se reusa sin tocar** (tabla de contrato en el [README](./README.md)).

---

## 2. Prisma / DB

### 2.1 `Credit.metadata` (JSONB)
```prisma
model Credit {
  // …existente…
  metadata Json @default("{}")
}
```
`Client.metadata` **ya existe** (`schema.prisma:488`) → el `client.metadata.origin` del §3 no cuesta nada.

Forma del JSON (validada en `packages/shared`, igual que `agenda_items.details`). Los nombres salen del
mapeo del PDF §7 y §4.3:
```ts
type CreditMetadata = {
  frequency: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';   // §4.1 chips, default MONTHLY
  origin: 'manual' | 'quick_batch' | 'import' | 'api';      // §3 — !== 'manual' ⇒ candado financiero
  installmentAmount?: number;  // la cuota CONGELADA (§4.2). Ausente solo si el archivo no la trajo (§4.3)
  nextDueDate?: string;        // ISO date — "alimenta la agenda" (§4.3)
  externalRef?: string;        // No.Crédito del archivo — clave de upsert (§4.3)
  notes?: string;              // §4.1, campo "Nota"
}
```
> **Por qué JSONB y no columnas:** es lo que el §7 recomienda literalmente ("se alojan en `credit.metadata`
> (JSONB)… si el uso demuestra que son universales, promoverlos a columnas en una migración posterior").
> `ponytail:` techo conocido, y el propio PDF lo nombra — **si la agenda termina *filtrando* por
> `nextDueDate`, se promueve a columna indexada.** Ese es el disparador, no antes.

### 2.2 `Payment` — foto del comprobante (§5.4)
El ledger es inmutable y **no tiene dónde guardar la foto**. Dos columnas, escritas en el INSERT:
```prisma
model Payment {
  // …existente…
  receiptUrl  String? @map("receipt_url")
  receiptHash String? @map("receipt_hash")  // SHA-256 del buffer original
}
```
No rompe la inmutabilidad: se setean al registrar el pago, nunca se actualizan.

### 2.3 Migración
`add_credit_metadata_and_payment_receipt`. No toca RLS (las policies de `credits` y `payments` ya existen).
**Sin tablas nuevas, sin enums de DB nuevos.** `PaymentFrequency`/`CreditOrigin` viven en `packages/shared`:
no son columnas, son claves dentro del JSON.

---

## 3. Backend NestJS

### 3.1 `credit-math.ts` — dos funciones puras, y `buildSchedule` **no se toca**
Con D1 (sin cronograma) la matemática de amortización queda intacta; lo que hace falta es aritmética de
períodos y una mora que no dependa de cuotas:
```ts
addPeriods(date, n, frequency)           // DAILY +n · WEEKLY +7n · BIWEEKLY +14n · MONTHLY addMonths(n)
arrearsFromDueDate(nextDueDate, outstandingBalance, asOf)  // → días de mora, 0 si no hay saldo
```
`arrearsFromDueDate` es el §6 del PDF ("días desde la cuota vencida más antigua no cubierta") aplicado al
crédito sin cronograma: con una sola `nextDueDate` que **solo avanza cuando la cuota queda cubierta**, esa
fecha *es* la cuota vencida más antigua. `buildSchedule`, `scheduleIsBalanced` y `computeArrears` siguen
sirviendo a los créditos con cronograma (web/core) **sin un solo cambio**.

### 3.2 `credits.service.create` — préstamo abierto, "ya está en curso" y caso automático
`CreateCreditDto` suma (todo opcional, el default preserva el comportamiento actual):
```ts
frequency?: PaymentFrequency;   // default 'MONTHLY'
installmentAmount?: number;     // la cuota congelada
nextDueDate?: string;           // ISO date
outstandingBalance?: number;    // "ya está en curso" (§4.1); default = principalAmount
daysPastDue?: number;           // "ya está en curso"; default 0
openCase?: boolean;             // default false
origin?: CreditOrigin;          // default 'manual'
externalRef?: string;
notes?: string;
```
`installmentsCount` pasa a **opcional** (`@IsInt() @Min(0)`): **vacío = préstamo abierto/renovable** (§4.1).

Comportamiento — **una sola regla, sin modos**:
- **Si viene `installmentAmount`** (el crédito del móvil, los 3 modos): **no** se llama a `buildSchedule`, no
  se crean filas en `credit_installments`. La cuota, la frecuencia y la próxima fecha van a `metadata`.
- **Si no viene** (la web y el importador de hoy): comportamiento actual intacto, `installmentsCount ≥ 1`
  obligatorio, cronograma generado. **Cero regresión.**
- **`openCase: true`** (§5.2): crea el `CollectionCase` **en la misma transacción**, `assigneeId = tenant.userId`,
  `status: PENDING`, y `priority` derivada de la mora: `0 → LOW · 1–30 → MEDIUM · 31–90 → HIGH · >90 → CRITICAL`.
  Audit del caso incluido. (El alta de la app siempre lo manda en `true`; web/import siguen usando
  `POST /cases/generate`, que ya existe.)

### 3.3 🔴 La mora **no se pisa con 0** — la guarda va en los DOS caminos
`computeArrears` sobre un array vacío devuelve `daysOverdue: 0` (`credit-math.ts:148-150`). Hoy eso se
escribe en la DB **sin ninguna guarda**, y en **dos lugares distintos**:

| Camino | Línea | Qué hace hoy |
|---|---|---|
| `POST /credits/:id/recalculate-arrears` | `credits.service.ts:198` | `daysPastDue: arrear.daysOverdue` → **0** |
| `POST /payments` | `payments.service.ts:82` | `daysPastDue: daysPastDue(effective, new Date())` → **0** |

Con D1, **todo crédito del móvil cae acá**. Regla única, aplicada en ambos:
- **Crédito con cronograma** → `computeArrears`, como hoy.
- **Crédito sin cronograma** → `arrearsFromDueDate(metadata.nextDueDate, saldo, hoy)`.
- **`origin === 'import'`** → **no se recalcula nada**: manda el archivo hasta la siguiente carga
  (§6, literal). Ni el recálculo ni el pago le tocan `daysPastDue`.

> El plan anterior solo blindaba `recalculate-arrears`. Registrar un pago le borraba la mora igual.

### 3.4 🔴 Un pago **descuenta la deuda aunque no haya cuotas**
Bug confirmado, y es el más grave del slice. `applyPayment` (`payment-apply.ts:29-51`) recorre las cuotas no
pagadas; con `installments: []` devuelve `applied: 0, leftover: amount`, y entonces
`payments.service.ts:78` calcula `newBalance = balance − 0`. Resultado: **se inserta la fila en `payments`
con el monto completo y `outstandingBalance` no baja**. El crédito nunca llega a `PAID`. No crashea: pierde
plata en silencio. Hoy solo afecta a créditos importados sin cuotas; **con D1 afectaría a todos**.

Fix: cuando no hay cuotas que amortizar, el `leftover` **se aplica al saldo**:
`newBalance = max(0, balance − amount)`, `status → PAID` si llega a 0. Es la regla del §5.4 ("inserta
payment, descuenta `outstanding_balance`") sin cronograma de por medio.

Además, en el mismo servicio:
- **Avanzar la próxima fecha** un período **solo si la cuota quedó cubierta**
  (`amount >= metadata.installmentAmount` → `nextDueDate = addPeriods(nextDueDate, 1, frequency)`).
  **Pago parcial: la fecha no se mueve** — "la cuota permanece vigente por el remanente" (§5.4, literal).
- `CreatePaymentDto` suma `receiptUrl?` + `receiptHash?` (los devuelve `POST /uploads`, §3.6).

### 3.5 `cases` — la tarjeta de cartera necesita cuota, fecha y origen
`serializeCase` hoy solo expone `amount`, `currency`, `daysPastDue` (`cases.serializer.ts:48-50`). La tarjeta
del §5.3 pide *"Cuota Bs 300 · vence 15 jul"* y el detalle (§5.4) pide el candado del importado. Se agrega,
cuando el query incluye el crédito: **`installmentAmount`**, **`nextDueDate`** y **`origin`**.
Una función **`creditView(credit)`** en `packages/shared` centraliza el *"derivá del cronograma o leé del
metadata"* y la usan **API y móvil** — fuente única, sin duplicar la regla.

**No se agrega `q`**: el §5.3 pide búsqueda **local en memoria** (D6 del README). `ListCasesQueryDto` queda
como está.

### 3.6 `uploads/` — módulo NUEVO (el único), primitivo de almacenamiento
No existe subida de archivos en el sistema: `field-ops` recibe una `fileUrl` **ya existente** y el base64 solo
para verificar el hash (`field-integrity.ts:16` lo dice: *"en prod el server lo baja de S3"*).
```
POST /api/uploads   (multipart, FileInterceptor)  → { url, hash, size, mimeType }
```
- Calcula **SHA-256 sobre el buffer original**, antes de cualquier transformación → **reusa
  `sha256OfBase64()`** de `field-ops/field-integrity.ts` (ya testeado). No se escribe un hash nuevo.
- Driver de almacenamiento detrás de una interfaz mínima: **disco local en dev**, **S3/R2 en prod**
  (`S3_BUCKET`/`S3_REGION`/`S3_ACCESS_KEY`/`S3_SECRET_KEY` ya están en el contrato de env del CLAUDE.md raíz).
  Dep nueva: `@aws-sdk/client-s3`.
- Límites: ≤ 8 MB, solo `image/jpeg|png|webp`. Permiso: cualquiera con sesión (el objeto se ata al recurso al
  usarlo, no al subirlo). Audit del upload.
- **Es el primitivo que P8-evidencia reusa** para foto + GPS + firma de las visitas: P8 le agrega el vínculo a
  `field_evidences` y el GPS, no reescribe la subida.

Consumo: la fachada (§5.1) va a `POST /clients/:id/attachments` (`fileType: PHOTO`, ya existe, ya tiene
`fileHash`) y/o a `client_locations.photoUrls`; el comprobante (§5.4) va en el `POST /payments` (§3.4).

### 3.7 Permisos (seed)
`COLLECTOR` suma **`client:write`** y **`credit:write`** (hoy no los tiene — `seed.ts:114-117` — así que no
puede dar de alta nada). Sin gating por tenant: la matriz del PDF §3 (import-only en ENTERPRISE) es la etapa
**P10-rbac-gating**; acá el multi-tenant es **por capacidad** (`can(permission)`), nunca por `accountType`.
`client:pii:read` **NO** se agrega: el teléfono en claro sigue saliendo por el endpoint auditado de agenda.

---

## 4. Tareas (en orden — arreglar lo roto antes de construir encima)
1. `packages/shared`: `PaymentFrequency`, `CreditOrigin`, `CreditMetadata` + validador, `creditView()`,
   **cálculo de cuota/total/ganancia (las 2 bases del §4.2)**, estado derivado de cartera. **Con sus tests.**
2. Prisma: migración `add_credit_metadata_and_payment_receipt` + `prisma generate`.
3. `credit-math.ts`: `addPeriods()` + `arrearsFromDueDate()`. **`buildSchedule` no se toca.**
4. 🔴 `payments.service`: **aplicar el pago al saldo cuando no hay cuotas** (§3.4) — el bug primero.
5. 🔴 Mora: la guarda de §3.3 en **`credits.service.recalculateArrears` Y en `payments.service`**.
6. `credits.service.create`: `installmentAmount`/`frequency`/`nextDueDate`, préstamo abierto,
   "ya está en curso", `openCase`.
7. `cases`: enriquecer el serializer con `creditView()`.
8. `payments.service`: avanzar `nextDueDate` + `receiptUrl`/`receiptHash`.
9. `uploads/`: módulo + driver disco/S3 + hash reusado.
10. Seed (§5).

## 5. Seed
El seed ya trae clientes con teléfonos/direcciones/créditos/casos (lo amplió agenda). Se agrega **lo que hoy
no existe y las 3 pantallas necesitan**:
1. **≥2 créditos importados** (`origin: 'import'`, sin cuotas, con `installmentAmount` + `nextDueDate` +
   `daysPastDue > 0`) → para probar el candado y que la mora **no** se recalcule.
2. **≥2 créditos manuales sin cronograma** con frecuencias variadas (uno diario, uno semanal) → gota a gota.
3. **1 préstamo abierto** (`installmentsCount` vacío, §4.1) → el caso que el backend hoy no puede expresar.
4. Un cliente con **2+ créditos activos** (ya existe) → probar el selector de crédito de la ficha y el
   agregado "2 préstamos" de la tarjeta (§5.3).
5. Cobertura de los **5 estados derivados** del §5.3 (AL DÍA · POR VENCER · EN MORA · PROMESA · PAGADO)
   → un caso por estado, para que los chips de filtro no salgan vacíos. (`PROMESA` necesita un `agenda_item`
   `PROMISE_TO_PAY` vigente — ver el abierto de D6 en el README.)

## 6. Auditoría de reuso (Paso B)
| Capacidad | Decisión | Path |
|---|---|---|
| Aislamiento tenant + RLS | REUSAR | `PrismaService.withTenant` |
| Contexto + scope **por capacidad** | REUSAR | `TenantContextService.can()` |
| Envelope + paginación | REUSAR | `ResponseDto` (`@kobrax/shared`) |
| Audit trail | REUSAR | `AuditService.record` |
| **SHA-256 sobre buffer original** | **REUSAR** | `field-ops/field-integrity.ts:9` → `sha256OfBase64()` |
| **Cronograma + amortización + mora con cuotas** | **NO SE TOCA** | `credit-math.ts` (`buildSchedule`, `scheduleIsBalanced`, `computeArrears`) |
| `addPeriods` / `arrearsFromDueDate` | **NUEVO** | `credit-math.ts` (2 funciones puras) |
| `CreateCreditDto` / `credits.service.create` | **EXTENDER** | crédito sin cronograma + en curso + `openCase` |
| `payments.service` / `payment-apply.ts` | **ARREGLAR + EXTENDER** | descuento sin cuotas (R2) + `nextDueDate` + comprobante |
| `serializeCase` | **EXTENDER** | cuota / próxima fecha / origen vía `creditView()` |
| `ListCasesQueryDto` | **NO SE TOCA** | la búsqueda es local (§5.3) |
| Cliente + teléfonos + direcciones + **adjuntos** + duplicados | REUSAR | módulo `clients` completo |
| `Client.metadata` (para `origin`) | REUSAR | `schema.prisma:488` — ya existe |
| Casos + gestiones + pagos idempotentes (`Idempotency-Key`) | REUSAR | módulos `cases` / `payments` |
| PII en claro auditada para el cobrador | REUSAR | `GET /api/agenda/clients/:clientId/context` |
| `Credit.metadata` + `Payment.receipt*` | NUEVO | Prisma |
| `PaymentFrequency`/`CreditOrigin`/`creditView()`/cuota-total-ganancia/estado de cartera | NUEVO | `packages/shared` (fuente única API+móvil) |
| **Módulo `uploads/`** (multipart + driver disco/S3) | NUEVO | `apps/api/src/modules/uploads` — lo reusa **P8** |

## 7. Riesgos / decisiones abiertas
- **R1 — CONFIRMADO (alto).** La mora se pisa con 0 en un crédito sin cuotas, en **dos** lugares:
  `credits.service.ts:198` y `payments.service.ts:82`. Viola el §6 del PDF. → guarda de §3.3 + tests 3 y 5.
- **R2 — CONFIRMADO (crítico).** Un pago sobre un crédito sin cuotas **no descuenta el saldo**:
  `payment-apply.ts:50` devuelve `applied: 0` y `payments.service.ts:78` hace `balance − 0`. Se registra el
  dinero y la deuda queda intacta, en silencio. → fix de §3.4 + test 4. **Es el motivo por el que este slice
  va antes que cualquier pantalla.**
- **R3 (medio).** El módulo `uploads` es infra nueva (S3/R2, credenciales, límites). Es el mayor riesgo de
  cronograma del slice. Mitigación: driver de **disco local en dev** → nada bloquea el desarrollo si el bucket
  todavía no está aprovisionado.
- **Abierto (S1): buscar por teléfono** (§5.3) contra la tokenización de PII (P6). Ver D6 del README.
- **Abierto (S1): estado `PROMESA`** (§5.3) sale de `agenda_items`, no del caso. Ver D6 del README.
- **Decidido, no abierto:** sin cronograma desde el móvil (D1) · cuota editable y advertencia no bloqueante
  (D3) · gating por tipo de tenant → P10 · import CSV (V5) → web · vocabulario configurable, job diario de
  mora y sistema francés → diferidos (D7).

## 8. Tests (node:test, como el resto de la API)
1. **Cálculo del §4.2** (shared, función pura): "% por período" con capital 1.000, i 10%, n 5 → **cuota 300,
   total 1.500, ganancia 500** (el ejemplo literal del PDF). "% total" con los mismos datos → cuota 220.
   Cuota redondeada a mano → el total se recalcula y **se guarda tal cual** (D3).
2. **Crédito sin cronograma**: `create` con `installmentAmount` **no** crea filas en `credit_installments`;
   `installmentsCount` vacío (préstamo abierto) se acepta. Y la regresión: sin `installmentAmount`, el
   cronograma se sigue generando igual que hoy.
3. 🔴 **R1**: `recalculate-arrears` sobre un crédito sin cuotas **no** pisa `daysPastDue`; sobre uno con
   `origin: 'import'` es **no-op** aunque tenga `nextDueDate` vencida.
4. 🔴 **R2**: un pago de 100 sobre un crédito sin cuotas con saldo 500 deja **`outstandingBalance = 400`**;
   un pago que cubre el saldo entero lo deja en 0 y el crédito en `PAID`.
5. 🔴 **R1 por la puerta del pago**: registrar un pago sobre un crédito importado **no** le toca la mora.
6. Pago que **cubre la cuota** avanza `nextDueDate` un período según `frequency` (los 4 valores);
   **pago parcial no la mueve**.
7. `openCase: true` crea el caso en la misma transacción, asignado al cobrador, con la prioridad derivada de
   la mora (0→LOW · 1–30→MEDIUM · 31–90→HIGH · >90→CRITICAL).
8. `POST /uploads` devuelve el **SHA-256 del buffer original** y rechaza tipo/tamaño fuera de límite.
9. `serializeCase` expone cuota/próxima fecha/origen tanto para un crédito con cronograma (derivadas) como
   para uno sin él (del metadata) — `creditView()` es la misma función en ambos.

## 9. Reglas de la fase (no-negociables)
Multi-tenant **por capacidad** (`can()`), nunca por `accountType` · RLS intacta en las tablas tocadas ·
**TS estricto sin `any`** · `{data,meta,error}` en toda respuesta · **audit en toda mutación**
(crédito, caso, pago, upload) · **evidencia inmutable**: hash SHA-256 sobre el **buffer original**, calculado
en el server, guardado en DB al registrar · enums y reglas de dominio **siempre** en `packages/shared`
(nunca redefinidos en API ni en móvil).
(Las 3 reglas de UI del epic §3.3 no aplican: slice sin pantalla.)

## 10. DoD
- 🔴 **Los dos bugs, cerrados y con test**: un pago descuenta el saldo sin cronograma (R2) y la mora del
  importado sobrevive a un recálculo **y a un pago** (R1).
- Migración aplicada · seed cargado con importados + préstamo abierto + frecuencias + los 5 estados.
- API `type-check` + tests verdes (los actuales + los nuevos), **sin regresión** en los créditos con cronograma.
- **Smoke real**: crear un préstamo en Modo A (cuota directa), uno en Modo B (cuota calculada) y uno abierto
  (sin `n`) vía API; registrar un pago parcial y ver **bajar el saldo** y **no** moverse la fecha; registrar
  el pago de la cuota completa y ver **avanzar** `nextDueDate`; `GET /cases` devolviéndolos con cuota, próxima
  fecha y origen; `POST /uploads` de un JPEG devolviendo su hash y una `url` que
  `POST /clients/:id/attachments` acepta.
- Sin UI → sin `expo export` ni validación visual en este slice.
