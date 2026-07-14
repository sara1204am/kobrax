# Cartera · S2 — Alta: cliente → préstamo (V1 + V2)

> Índice: [README.md](./README.md) · Spec: [`docs/flows/Cliente_Prestamo.pdf`](../../../../flows/Cliente_Prestamo.pdf) §5.1, §5.2, §4.1, §4.2
> **Depende de [00-fundacion.md](./00-fundacion.md)** (`POST /credits` extendido, `POST /uploads`, `client:write`/`credit:write` al COLLECTOR, `quoteLoan` en shared) — ya construido.
> **Sin Figma:** se calca el lenguaje visual de Agenda (`app/agenda/crear.tsx`) — mismos tokens, chips, selectores, `Field`, footer CTA.
> **Build:** 🟢 Expo Go — dep nueva `expo-image-picker` (funciona en Expo Go, cámara incluida; D5).
> **Rama:** se continúa en `f10/cartera-lista` (el módulo se mergea junto, como Agenda).

## 1. Objetivo
El cobrador da de alta **un cliente y su préstamo en un solo gesto** (§5.1: "para el cobrador ambos son una
sola acción"). **V1** captura al cliente (identificación + contacto + ubicación con foto de fachada opcional);
**V2** captura el préstamo en **Modo A (cuota directa)** o **Modo B (cuota calculada)** con panel en vivo
Cuota/Total/Ganancia. Al guardar el préstamo nace el crédito **congelado** (sin cronograma, D1), su caso, y su
**próxima fecha en la agenda** del cobrador. Es lo que hace funcional al cobrador independiente.

## 2. Alcance
**SÍ:** alta atómica de cliente (cliente + teléfono + ubicación en **una** transacción); alta de préstamo
Modo A/B con `quoteLoan` (shared) y cuota editable; foto de fachada (`expo-image-picker` → `POST /uploads` →
`client_locations.photoUrls`); caso automático (`openCase`, ya en fundación) + **agenda-item automático** con
la próxima fecha; pantalla de éxito con "Ver ficha" / "Registrar otro".
**NO:** ficha/pago/gestión (S3); import (V5, web); **toggle Persona/Empresa** (default **Persona**, el gating
por tipo de tenant es P10 — D4); mapa arrastrable (se usa **captura GPS de un toque** de `expo-location`, ya
instalada; el mapa de agenda queda disponible si se pide); sistema francés (§4.2, diferido por el propio PDF).

## 3. Backend (dos extensiones a servicios que ya existen — sin tablas nuevas)

### 3.1 Alta atómica del cliente (decisión usuaria: endpoint anidado)
`POST /api/clients` (`CreateClientDto`) hoy crea **solo** el cliente; teléfono y ubicación son endpoints
aparte → 3 llamadas encadenadas con estados parciales si la red se corta en campo. Se extiende para crearlos
en **la misma transacción**:
```ts
// CreateClientDto += (ambos opcionales; sin ellos, comportamiento actual intacto)
@IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreateContactDto) contacts?: CreateContactDto[];
@IsOptional() @ValidateNested() @Type(() => CreateLocationDto) location?: CreateLocationDto;
```
`ClientsService.create` crea el cliente y, **dentro del mismo `tx`**, sus `contacts` y su `location` reusando
el cifrado ya existente (`crypto.encrypt` / `enc`, `photoUrls`). Atómico: si un sub-recurso falla, **rollback
total** (no queda un cliente huérfano). Audit del cliente (ya está) + un audit por sub-recurso creado.
**Cero regresión:** sin `contacts`/`location`, la web sigue igual.

### 3.2 Agenda-item automático al crear el préstamo (decisión usuaria: cablearlo)
§5.2: "Genera la próxima fecha de cobro en la agenda del cobrador". En `CreditsService.create`, dentro del
bloque `if (dto.openCase)` que **ya** crea el caso, y **solo si** hay `metadata.nextDueDate`, crear también un
`agenda_items` en el **mismo `tx`**:
```ts
type: REMINDER · status: SCHEDULED · scheduledDate: nextDueDate · assigneeId: tenant.userId
caseId: <el caso recién creado> · creditId · clientId · details: { description: 'Cobrar cuota' } · createdBy
```
- **Tipo REMINDER**: no hay un tipo "cobro programado" entre los 5; el recordatorio es el que calza (§5.2 lo
  llama "recordar cobrar"). `timeMode` default `FIXED` con `scheduledTime` nulo (recordatorio de día, sin hora
  — el modelo lo admite; la Agenda ya tolera hora ausente).
- Solo nace por la **alta del móvil** (`openCase:true`). La web/import usa `POST /cases/generate` → **no**
  genera recordatorios (sin spam de agenda).
- Aparece en la Agenda del cobrador (scope por `assigneeId`), cerrando el ciclo cartera→agenda. Audit del ítem.
- **No dispara PROMESA** en S1 (esa mira `PROMISE_TO_PAY`), no interfiere.

### 3.3 Lo que ya existe y se reusa sin tocar
`POST /credits` (fundación: `installmentAmount`/`frequency`/`nextDueDate`/`outstandingBalance`/`daysPastDue`/
`openCase`/`origin`) · `POST /uploads` (SHA-256, driver disco) · dedup por documento (`clientDuplicate`) ·
`GET /clients?q=` (buscador de cliente para el "+" de cartera) · RLS · audit · `{data,meta,error}`.

## 4. Matemática (shared, ya existe — no se reescribe)
`quoteLoan({ principal, interestPercent, installments, base })` y `quoteFromInstallment(principal, cuota, n)`
(`utils/loan.ts`) calculan el panel Cuota/Total/Ganancia del §4.2 (las 2 bases) y recalculan al **redondear**
la cuota a mano (§5.2). El móvil los usa en cada tecla; **la API recibe la cuota ya congelada** (D2). Nada
nuevo en shared salvo, si hace falta, la etiqueta es-LatAm de `PaymentFrequency` (UI, en el móvil).

## 5. Móvil

### 5.1 V1 — Registro de cliente (`app/cliente/nuevo.tsx`, hoy placeholder)
Una pantalla con scroll, 3 zonas y CTA fija doble:
- **Zona 1 Identificación**: nombre + apellido + documento (CI). *Persona-only* (toggle diferido). Documento:
  al salir del campo, chequeo de duplicado — el `POST` devuelve `clientDuplicate` → banner "Ya registraste a
  este cliente" (no se usa un `GET` extra: el dedup del alta ya lo resuelve).
- **Zona 2 Contacto**: teléfono (teclado telefónico) + casilla **"Tiene WhatsApp"** (default on). El contacto
  se manda como `WHATSAPP` si la casilla está marcada, si no `PHONE`; `isPrimary: true`.
- **Zona 3 Ubicación**: dirección (texto) + zona/barrio + **"Capturar GPS aquí"** (un toque, `expo-location`)
  + referencia + **foto de fachada** (`expo-image-picker`, opcional).
- **CTA doble**: "Guardar y agregar préstamo" (primary → crea el cliente y navega a V2 con `clientId`) ·
  "Solo guardar cliente" (ghost → crea y vuelve a Cartera). **Mínimo para guardar: nombre + teléfono** (§5.1).

### 5.2 V2 — Registro de préstamo (`app/prestamo/nuevo.tsx`, nuevo)
- **Cabecera**: tarjeta del cliente (no editable) con nombre + zona.
- **Segmented control** (`SegmentTabs`): "Cuota directa" (A) | "Calcular cuota" (B). Default **A** (§4.1).
- **Modo A**: capital · cuota · frecuencia (chips) · próxima fecha (default hoy+1 período) · nº cuotas
  (opcional, vacío = préstamo abierto) · switch **"Ya está en curso"** → saldo + días de mora · nota.
- **Modo B**: capital · interés % + base (chips % período / % total) · nº cuotas · frecuencia · primera fecha.
  **Panel en vivo** (`quoteLoan`): Cuota / Total / Ganancia; **cuota editable** (redondeo → recalcula total,
  `quoteFromInstallment`); advertencia **no bloqueante** si `cuota×n < capital` (§5.2, D3).
- **Guardar**: `POST /credits` con `openCase:true`, `installmentAmount` = cuota congelada, `origin:'manual'`.
  → **pantalla de éxito** (cliente · cuota · próxima fecha) con "Ver ficha" (S3) / "Registrar otro" (reset).
- **Validaciones** (§5.2): capital > 0; cuota > 0; interés 0–100 (período) / 0–500 (total); fecha ≥ hoy salvo
  "ya en curso". Reglas puras en `prestamo-form.ts`.

### 5.3 Piezas móviles
| Pieza | Decisión | Path |
|---|---|---|
| `AmountInput` (monto + moneda, `decimal-pad`) | **NUEVO** en `ui.tsx` | lo usan V2 y el pago de S3 (≥2 usos) |
| `Chips` (pills single-select) | **NUEVO** en `ui.tsx` | frecuencia + base de interés (≥2 usos); hoy los chips viven locales en `agenda/crear.tsx` |
| `cliente-form.ts` (reducer + validación, mín nombre+tel) | **NUEVO** + test | `src/` |
| `prestamo-form.ts` (Modo A/B, panel `quoteLoan`, validaciones) | **NUEVO** + test | `src/` |
| `clients.service.ts` += `createClient` (anidado) | **EXTENDER** | `src/` (creado en Agenda S2) |
| `credits.service.ts` += `createCredit` | **NUEVO** | `src/` (thin sobre `apiMutate`) |
| `uploads.service.ts` += `uploadImage` | **NUEVO** | `src/` (multipart → `{url,hash}`) |
| Captura GPS de un toque | REUSAR | `expo-location` (instalada) |
| Cámara/galería | **NUEVO (dep)** | `expo-image-picker` (Expo Go) |
| Fecha | REUSAR | `@react-native-community/datetimepicker` |
| `Field` / `Button`(primary+ghost) / `ErrorBanner` | REUSAR | `components.tsx` |
| `Header` / `SegmentTabs` / `SectionLabel` | REUSAR | `ui.tsx` |
| `money()` / `quoteLoan` / `PaymentFrequency`/`CreditOrigin`/`InterestBase` | REUSAR | `agenda-form.ts` / `@kobrax/shared` |
| `apiMutate` | REUSAR | `api-client.ts` |

## 6. Tareas (orden: shared/backend → datos → UI)
1. Backend: `CreateClientDto` (`contacts?`/`location?`) + `ClientsService.create` anidado atómico + audit; tests.
2. Backend: `CreditsService.create` agenda-item automático en el `tx` del `openCase` + audit; tests.
3. Móvil servicios: `clients.service.createClient`, `credits.service.createCredit`, `uploads.service.uploadImage`.
4. Móvil piezas: `AmountInput` + `Chips` en `ui.tsx`; `cliente-form.ts` + `prestamo-form.ts` (+ tests).
5. Móvil V1: `app/cliente/nuevo.tsx` (3 zonas + GPS + foto + CTA doble).
6. Móvil V2: `app/prestamo/nuevo.tsx` (segmented A/B + panel + validaciones + éxito).
7. Instalar `expo-image-picker`; permisos de cámara en `app.json`.
8. Verificar: API type-check + tests · móvil type-check + jest + `expo export` · smoke real contra `:4010`.

## 7. Reglas de la fase
Las 3 del epic §3.3 — **sol→contraste** (capital/cuota/total en `navy`; labels en `muted`), **gama baja→perf**
(el form es `useReducer` local, sin re-render por tecla; panel recalculado con función pura), **animación con
propósito** (haptic al guardar, transición de éxito, nada más). + multi-tenant **por capacidad** (`can()`,
nunca `accountType`) · TS estricto sin `any` · `{data,meta,error}` · **audit en toda mutación** (cliente,
sub-recursos, crédito, caso, agenda-item, upload) · **evidencia inmutable**: SHA-256 de la foto en el server
(reusa `POST /uploads`) · matemática y enums **siempre** en `packages/shared`.
**Offline** (cola real = P6): sin señal, "Guardar" muestra `ErrorBanner` y **conserva el formulario**; no se
pierde lo tipeado. No bloquea otras acciones.

## 8. Decisiones (cerradas)
- **Alta atómica** (usuaria, 2026-07-14): `POST /clients` anidado en una transacción, no 3 llamadas.
- **Agenda-item automático** (usuaria, 2026-07-14): al crear el préstamo nace un `REMINDER` con la próxima fecha.
- **Persona-only**: el toggle Persona/Empresa se difiere (gating por tenant = P10, D4). Etiquetas fijas es-LatAm.
- **Default Modo A** (§4.1, predeterminado del cobrador individual); la cuota se congela (D1/D2).
- **GPS de un toque** (`expo-location`), sin mapa arrastrable en S2.
- **Foto de fachada** vía `POST /uploads` → `client_locations.photoUrls` (§5.1).

## 9. Tests
- **shared**: `quoteLoan` ya tiene sus tests (fundación). Si se agrega label de frecuencia, no necesita test.
- **API** (node:test): alta anidada crea cliente+contacto+ubicación en una transacción; un sub-recurso inválido
  **hace rollback** (no queda cliente); sin `contacts`/`location` la respuesta es la de hoy. Crédito con
  `openCase` + `nextDueDate` crea **un** `agenda_item` REMINDER con esa fecha, asignado al cobrador; sin
  `openCase` no lo crea; documento duplicado → `clientDuplicate`.
- **móvil** (jest): `cliente-form` habilita "Guardar" solo con nombre+teléfono; `prestamo-form` — Modo B
  calcula cuota/total/ganancia del ejemplo del PDF (1000, 10%, 5 → 300/1500/500), la cuota editada recalcula
  el total, la advertencia `cuota×n<capital` no bloquea, cambiar de modo conserva capital.

## 10. DoD
- Backend: alta anidada + agenda-item automático con tests verdes; audit en todo; sin regresión.
- Con la API real: dar de alta un cliente con teléfono + GPS + foto en un gesto; agregar un préstamo Modo A y
  otro Modo B; ver el crédito, su caso y su **recordatorio en la Agenda**; el saldo = capital; la cartera (S1)
  lo muestra. Documento repetido → banner de duplicado.
- Verde: API type-check + tests · móvil type-check + jest + `expo export`.
- **Validación visual de la usuaria** (parity con Agenda: mismos chips, Field, footer CTA).

## 11. Riesgos / decisiones abiertas
- **`expo-image-picker`** es dep nueva: verificar que corre en Expo Go SDK 51 al instalar (D5 dice que sí).
  Si fallara, la foto cae a "asignar después" (opcional en §5.1) y no bloquea el alta.
- **Timezone** (heredado): fechas ancladas a medianoche UTC (mismas helpers que Agenda) para que "fecha ≥ hoy"
  no rechace el día actual del cobrador.
- **Atomicidad del cruce V1→V2**: el cliente y el préstamo son dos gestos/pantallas; entre ambos el cliente ya
  quedó guardado (correcto: §5.1 permite "Solo guardar cliente"). Dentro de V1 el alta sí es atómica (§3.1).
- **Offline**: como Agenda S2, "Guardar" no encola; la cola real de escritura es **P6**.
