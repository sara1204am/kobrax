# Cartera · 00 — Fundación backend (crédito flexible + cartera buscable + subida de archivos)

> Índice: [README.md](./README.md) · Spec: [`docs/flows/Cliente_Prestamo.pdf`](../../../../flows/Cliente_Prestamo.pdf)
> **Slice sin pantalla.** Deja el backend capaz de expresar los 3 modos de captura del PDF, de servir la
> lista de cartera y de recibir fotos. Sin esto, ninguna de las 3 pantallas es funcional.
> **Rama:** `f10/cartera-fundacion` · **Build: 🟢** (backend + Expo Go; no cruza el dev build).

## 1. Objetivo
Ocho deltas, ni uno más. Todo lo demás (alta de cliente, teléfonos, direcciones, adjuntos, cronograma, mora,
casos, gestiones, pagos idempotentes, hash SHA-256, RLS, audit, PII) **ya existe y se reusa sin tocar** — ver
la tabla de contrato real en el [README](./README.md).

---

## 2. Prisma / DB

### 2.1 `Credit.metadata` (JSONB)
```prisma
model Credit {
  // …existente…
  metadata Json @default("{}")
}
```
Forma del JSON (validada en `packages/shared`, igual que `agenda_items.details`):
```ts
type CreditMetadata = {
  frequency: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';   // siempre
  origin: 'manual' | 'quick_batch' | 'import' | 'api';      // siempre — bloquea edición si !== 'manual'
  externalRef?: string;        // No.Crédito del archivo (PDF §4.3, clave de upsert)
  installmentAmount?: number;  // SOLO snapshot (en GENERATED se deriva de installments[0])
  nextDueDate?: string;        // SOLO snapshot, ISO date (en GENERATED se deriva de la cuota impaga)
}
```
> **Por qué no columnas:** `frequency` y `origin` son universales pero baratas en JSONB y no se filtran;
> `installmentAmount`/`nextDueDate` solo existen en snapshot. El propio PDF §7 lo propone así.
> `ponytail:` techo — si la agenda termina **filtrando** por `nextDueDate`, se promueve a columna indexada.

### 2.2 `Payment` — foto del comprobante
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

### 3.1 `credit-math.ts` — frecuencia (único cambio de matemática)
`buildSchedule` es **mensual hardcodeado** (`addMonths(firstDueDate, i-1)`). Se parametriza:
```ts
buildSchedule({ …, frequency: PaymentFrequency })   // default 'MONTHLY' → comportamiento actual intacto
// paso: DAILY +i días · WEEKLY +7i · BIWEEKLY +14i · MONTHLY addMonths(i)
```
Una función `addPeriods(date, n, frequency)` reemplaza a `addMonths`. **La amortización no se toca**
(FLAT ya es la fórmula "% por período" del PDF).

### 3.2 `credits.service.create` — snapshot, "ya está en curso" y caso automático
`CreateCreditDto` suma:
```ts
frequency?: PaymentFrequency;          // default 'MONTHLY'
scheduleMode?: 'GENERATED'|'SNAPSHOT'; // default 'GENERATED'
installmentAmount?: number;            // obligatorio si SNAPSHOT
nextDueDate?: string;                  // obligatorio si SNAPSHOT
outstandingBalance?: number;           // "ya está en curso"; default = principalAmount
daysPastDue?: number;                  // "ya está en curso"; default 0
openCase?: boolean;                    // default false
origin?: CreditOrigin;                 // default 'manual'
externalRef?: string;
```
`installmentsCount` pasa a **opcional** (`@Min(0)`): en SNAPSHOT puede venir del archivo (columna "Plazo")
o faltar, y **no genera cronograma en ningún caso**.

Comportamiento:
- **GENERATED** (default): igual que hoy + `frequency`. `installmentsCount` obligatorio ≥ 1.
- **SNAPSHOT**: **no** llama a `buildSchedule`, no crea filas en `credit_installments`. Guarda
  `outstandingBalance`, `daysPastDue`, y en `metadata` la cuota y la próxima fecha de la fuente.
- **`openCase: true`**: crea el `CollectionCase` **en la misma transacción**, `assigneeId = tenant.userId`,
  `status: PENDING`, y `priority` derivada de la mora según PDF §5.2:
  `0 → LOW · 1–30 → MEDIUM · 31–90 → HIGH · >90 → CRITICAL`. Audit del caso incluido.
  (El alta de la app siempre lo manda en `true`; web/import siguen usando `POST /cases/generate`.)

### 3.3 `recalculateArrears` — **no pisar la mora del snapshot** ⚠️
`computeArrears` sobre un crédito sin cuotas devuelve `daysOverdue: 0` y **borraría** la mora que trajo el
archivo. Guarda explícita: **si el crédito no tiene `installments`, el recálculo es un no-op**
(PDF §6: *"en cartera importada prevalece el valor del archivo hasta la siguiente carga"*). Ver §7 (riesgo R1).

### 3.4 `payments.service` — avanzar la próxima fecha del snapshot + guardar el comprobante
- Un pago sobre un crédito SNAPSHOT no tiene cuota que marcar: solo descuenta `outstandingBalance`
  (**verificar** que el aplicador actual no asuma `installments.length > 0` — ver riesgo R2).
- Si el pago **cubre la cuota** (`amount >= metadata.installmentAmount`), avanza `metadata.nextDueDate`
  un período según `metadata.frequency`. Pago parcial: la fecha **no** se mueve
  (PDF §5.4: *"la cuota permanece vigente por el remanente"*).
- `CreatePaymentDto` suma `receiptUrl?` + `receiptHash?` (los devuelve `POST /uploads`, §3.6).

### 3.5 `cases` — la cartera se puede buscar y pintar
- `ListCasesQueryDto` suma **`q?: string`** → mismo patrón que `clients.service` (OR de `nationalIdHash`
  exacto + ILIKE sobre `firstName`/`lastName`/`businessName`). Sin `q`, cero cambios de comportamiento.
- `serializeCase` suma, cuando el query incluye el crédito: **`installmentAmount`**, **`nextDueDate`** y
  **`origin`** (para el candado de la UI). Una función `creditView(credit)` en `packages/shared` centraliza
  el "derivá del cronograma o leé del metadata" y la usan **API y móvil** — fuente única, sin duplicar la regla.

### 3.6 `uploads/` — módulo NUEVO (el único), primitivo de almacenamiento
No existe subida de archivos en el sistema: `field-ops` recibe una `fileUrl` **ya existente** y el base64 solo
para verificar el hash (`field-integrity.ts:16` lo dice: *"en prod el server lo baja de S3"*).
```
POST /api/uploads   (multipart, FileInterceptor)  → { url, hash, size, mimeType }
```
- Calcula **SHA-256 sobre el buffer original**, antes de cualquier transformación → **reusa
  `sha256OfBase64()`** de `field-ops/field-integrity.ts`. No se escribe un hash nuevo.
- Driver de almacenamiento detrás de una interfaz mínima: **disco local en dev**, **S3/R2 en prod**
  (`S3_BUCKET`/`S3_REGION`/`S3_ACCESS_KEY`/`S3_SECRET_KEY` ya están en el contrato de env del CLAUDE.md raíz).
  Dep nueva: `@aws-sdk/client-s3`.
- Límites: ≤ 8 MB, solo `image/jpeg|png|webp`. Permiso: cualquiera con sesión (el objeto se ata al recurso al
  usarlo, no al subirlo). Audit del upload.
- **Es el primitivo que P8-evidencia reusa** para foto + GPS + firma de las visitas: P8 le agrega el vínculo a
  `field_evidences` y el GPS, no reescribe la subida.

Consumo: la fachada va a `POST /clients/:id/attachments` (`fileType: PHOTO`, ya existe, ya tiene `fileHash`)
y/o a `client_locations.photoUrls`; el comprobante va en el `POST /payments` (§3.4).

### 3.7 Permisos (seed)
`COLLECTOR` suma **`client:write`** y **`credit:write`**. Sin gating por tenant (decisión D4 del README).
`client:pii:read` **NO** se agrega: el teléfono en claro sigue saliendo por el endpoint auditado de agenda.

---

## 4. Tareas (en orden — datos y lectura antes que escritura)
1. `packages/shared`: `PaymentFrequency`, `CreditOrigin`, `CreditMetadata` + validador, `creditView()`,
   conversión de los 3 modos → `interestRate`, estado derivado de cartera. **Con sus tests.**
2. Prisma: migración `add_credit_metadata_and_payment_receipt` + `prisma generate`.
3. `credit-math.ts`: `addPeriods` + `frequency` en `buildSchedule` (default MONTHLY = comportamiento actual).
4. `credits.service`: SNAPSHOT, "ya está en curso", `openCase`, guarda de arrears (§3.3).
5. `cases`: `q` + enriquecimiento del serializer con `creditView()`.
6. `uploads/`: módulo + driver disco/S3 + hash reusado.
7. `payments.service`: snapshot (fecha) + `receiptUrl`/`receiptHash`.
8. Seed (§5).

## 5. Seed
El seed ya trae clientes con teléfonos/direcciones/créditos/casos (lo amplió agenda). Se agrega **lo que hoy
no existe y las 3 pantallas necesitan**:
1. **≥2 créditos SNAPSHOT** (`origin: 'import'`, sin cuotas, con `installmentAmount` + `nextDueDate` +
   `daysPastDue > 0`) → para probar el candado y que la mora **no** se recalcule.
2. Créditos GENERATED con **frecuencias variadas** (uno diario, uno semanal) → gota a gota.
3. Un cliente con **2+ créditos activos** (ya existe) → probar el selector de crédito de la ficha y el
   agregado "2 préstamos" de la tarjeta.
4. Cobertura de los **5 estados derivados** del PDF §5.3 (AL DÍA · POR VENCER · EN MORA · PROMESA · PAGADO)
   → un caso por estado, para que los chips de filtro no salgan vacíos.

## 6. Auditoría de reuso (Paso B)
| Capacidad | Decisión | Path |
|---|---|---|
| Aislamiento tenant + RLS | REUSAR | `PrismaService.withTenant` |
| Contexto + scope **por capacidad** | REUSAR | `TenantContextService.can()` |
| Envelope + paginación | REUSAR | `ResponseDto` (`@kobrax/shared`) |
| Audit trail | REUSAR | `AuditService.record` |
| **SHA-256 sobre buffer original** | **REUSAR** | `field-ops/field-integrity.ts` → `sha256OfBase64()` |
| Cronograma + mora | **EXTENDER** | `credit-math.ts` (solo se le agrega `frequency`) |
| `CreateCreditDto` / `credits.service.create` | **EXTENDER** | snapshot + en curso + `openCase` |
| `ListCasesQueryDto` + `serializeCase` | **EXTENDER** | `q` + cuota/próxima fecha/origen |
| Cliente + teléfonos + direcciones + **adjuntos** + duplicados | REUSAR | módulo `clients` completo |
| Casos + gestiones + pagos idempotentes | REUSAR | módulos `cases` / `payments` |
| PII en claro auditada para el cobrador | REUSAR | `GET /api/agenda/clients/:clientId/context` |
| `Credit.metadata` + `Payment.receipt*` | NUEVO | Prisma |
| `PaymentFrequency`/`CreditOrigin`/`creditView()`/conversión cuota↔tasa/estado de cartera | NUEVO | `packages/shared` (fuente única API+móvil) |
| **Módulo `uploads/`** (multipart + driver disco/S3) | NUEVO | `apps/api/src/modules/uploads` — lo reusa **P8** |

## 7. Riesgos / decisiones abiertas
- **R1 (alto).** `recalculate-arrears` sobre un crédito SNAPSHOT devuelve `daysOverdue: 0` y **borra la mora
  del archivo**. Es el bug más probable del slice. → guarda explícita (§3.3) + test propio (§8.3).
- **R2 (medio).** `payments.service` aplica el pago recorriendo `credit_installments`. **Verificar** que no
  asuma que existen; un crédito SNAPSHOT tiene cero. Si asume, es una guarda más, no un rediseño.
- **R3 (medio).** El módulo `uploads` es infra nueva (S3/R2, credenciales, límites). Es el mayor riesgo de
  cronograma del slice y viene de la decisión D5. Mitigación: driver de **disco local en dev** → nada bloquea
  el desarrollo si el bucket todavía no está aprovisionado.
- **D3 abierta.** El redondeo de la cuota queda fuera (el Modo A bloquea `cuota × n < capital`, cuando el PDF
  lo quería como advertencia). Se levanta si molesta en campo.
- **Decidido, no abierto:** gating por tipo de tenant → P10 · import CSV (V5) → web, fuera de F10 móvil.

## 8. Tests (node:test, como el resto de la API)
1. `buildSchedule` con las 4 frecuencias: los `dueDate` avanzan el paso correcto y **`scheduleIsBalanced` sigue verde**.
2. Conversión de los 3 modos de captura (shared, función pura): "% por período", "% total" y "cuota directa"
   producen la **misma cuota** que luego devuelve `buildSchedule`. Es la prueba de que el PDF §4 entra sin motor nuevo.
3. **SNAPSHOT no genera cuotas** y **`recalculate-arrears` es no-op** sobre él (no pisa `daysPastDue`) — riesgo R1.
4. Pago que cubre la cuota **avanza** `nextDueDate` un período; pago parcial **no** la mueve.
5. `openCase: true` crea el caso en la misma transacción, asignado al cobrador, con la prioridad derivada de la mora.
6. `GET /cases?q=` filtra por nombre y por documento (blind index), y respeta el scope del cobrador.
7. `POST /uploads` devuelve el **SHA-256 del buffer original** y rechaza tipo/tamaño fuera de límite.

## 9. Reglas de la fase (no-negociables)
Multi-tenant **por capacidad** (`can()`), nunca por `accountType` · RLS intacta en las tablas tocadas ·
**TS estricto sin `any`** · `{data,meta,error}` en toda respuesta · **audit en toda mutación**
(crédito, caso, pago, upload) · **evidencia inmutable**: hash SHA-256 sobre el **buffer original**, calculado
en el server, guardado en DB al registrar · enums y reglas de dominio **siempre** en `packages/shared`
(nunca redefinidos en API ni en móvil).
(Las 3 reglas de UI del epic §3.3 no aplican: slice sin pantalla.)

## 10. DoD
Migración aplicada · seed cargado con snapshot + frecuencias + los 5 estados · API `type-check` + tests verdes
(los 174 actuales + los nuevos) · smoke real: crear un crédito en Modo A, uno en Modo B y uno SNAPSHOT vía API;
`GET /cases?q=` devolviéndolos con cuota, próxima fecha y origen; `POST /uploads` de un JPEG devolviendo su
hash y una `url` que `POST /clients/:id/attachments` acepta.
Sin UI → sin `expo export` ni validación visual en este slice.
