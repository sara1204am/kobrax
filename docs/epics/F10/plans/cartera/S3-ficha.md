# Cartera · S3 — Ficha de cobranza (V4)

> Índice: [README.md](./README.md) · Spec: [`docs/flows/Cliente_Prestamo.pdf`](../../../../flows/Cliente_Prestamo.pdf) §5.4, §6, §7
> **Depende de** [00-fundacion.md](./00-fundacion.md) (pago que descuenta + comprobante + `uploads`), S1 (`creditView` en `serializeCase`), S2 (`AmountInput`, `Chips`, `uploads.service`). Todo ya construido.
> **Sin Figma:** extiende el mockup "Detalle de gestión" calcando Agenda (`app/agenda/ver.tsx`, `registrar-accion.tsx`).
> **Build:** 🟢 Expo Go — sin dependencias nuevas.
> **Rama:** se continúa en `f10/cartera-lista` (el módulo mergea junto).
> **Slice más grande del módulo: subsume P2 (gestiones) y P4 (pagos).**

## 1. Objetivo
La pantalla donde el cobrador pasa más tiempo (§5.4). Responde, en orden, las 3 preguntas del cobro:
**¿cuánto me debe?** (cabecera + próximo pago), **¿cómo lo contacto/encuentro?** (barra de acciones +
ubicación/contactos), **¿qué pasó antes?** (timeline). Y las 2 acciones núcleo: **registrar pago** (descuenta
el saldo, §5.4) y **registrar gestión** (no contesta/promesa/visita/inubicable). Reemplaza el placeholder
`app/cliente/[id].tsx`.

## 2. Alcance
**SÍ:** ficha completa (cabecera + barra Llamar/WhatsApp/Navegar con auto-log + tarjeta próximo pago +
progreso + datos del préstamo colapsables + selector de crédito + ubicación/contactos + timeline
pagos∪gestiones); **registrar pago** (hoja: monto precargado, método chips, foto comprobante, confirmar);
**registrar gestión** (hoja: catálogo de resultado + nota; **promesa** crea `agenda_item PROMISE_TO_PAY`);
"+ agregar contacto/ubicación" (reusa endpoints de Agenda).
**NO:** import (V5, web); mini-mapa arrastrable (se muestra el pin + "Navegar" deep-link; el mapa completo de
Agenda queda disponible si se pide); firma (P8); edición de datos financieros del importado (candado, §4.3);
cola offline de escritura (P6 — "Guardar" avisa y conserva, no encola).

## 3. Backend — una sola extensión (los reads y el pago ya existen)

### 3.1 Reads: se componen 3 endpoints existentes — cero backend de lectura nuevo
| Necesidad de la ficha | Endpoint (ya existe) |
|---|---|
| Cabecera (nombre, doc en claro, zona), teléfonos/direcciones **en claro**, lista de créditos (selector) | **`GET /agenda/clients/:id/context`** (revela PII con `AGENDA_WRITE` + audit; el COLLECTOR lo tiene) |
| Cuota/próxima fecha/origen/**candado** + gestiones del crédito elegido | **`GET /cases/:caseId`** (`serializeCase` con `creditView`, enriquecido en S1) |
| Historial de pagos | **`GET /payments?caseId=`** |
> El timeline (pagos ∪ gestiones, cronológico) se **intercala en el móvil** (función pura). Reusar el context
> de Agenda como fuente de PII de la ficha es coherente: mismo cobrador, misma reveal auditada; se anota el reuso.

### 3.2 Registrar pago: ya está (fundación) — se reusa `POST /payments`
`POST /api/payments` (idempotente, `Idempotency-Key`) ya **descuenta el saldo aunque no haya cronograma**
(bug R2 cerrado), **avanza `nextDueDate`** si la cuota quedó cubierta, y acepta `receiptUrl`/`receiptHash`
(§5.4). No se toca. La foto del comprobante va por `POST /uploads` (S2) → devuelve `{url, hash}`.

### 3.3 Registrar gestión: **extender `addActivity`** para la promesa atómica (§5.4 + decisión usuaria)
`POST /cases/:id/activities` (`CasesService.addActivity`) hoy crea un `CaseActivity` (tipo + resultado + nota)
y toca `lastActionAt`. Se extiende para que, **cuando el resultado es una promesa de pago**, cree en la
**misma transacción** un `agenda_items PROMISE_TO_PAY` — así la promesa **enciende el badge PROMESA en la
cartera** (S1 lo lee de ahí) y **aparece en la Agenda** del cobrador. Consistente con S1/S2.
```ts
// CreateActivityDto += (opcional; sin él, comportamiento actual intacto)
@IsOptional() @ValidateNested() @Type(() => ActivityPromiseDto) promise?: ActivityPromiseDto;
// ActivityPromiseDto: { amount>0 (2 dec), promiseDate: ISO, paymentMethodCode, bankCode? }
```
- `ActivityPromiseDto` se declara **ANTES** de `CreateActivityDto` (aprendizaje de S2: `emitDecoratorMetadata`
  evalúa `@Type(()=>X)` **eager** → `ReferenceError` TDZ si va después).
- `addActivity` con `promise`: selecciona `clientId`/`creditId` del caso, crea el `CaseActivity`
  (result `PROMISE_TO_PAY`) **y** el `agenda_items` (type `PROMISE_TO_PAY`, `SCHEDULED`,
  `scheduledDate = promiseDate`, `details` = la promesa, `assigneeId = userId`), + audit del ítem.
  Igual que el REMINDER de S2: `agenda_items` se escribe directo en el `tx` (es una tabla, no otro módulo).
- Sin catálogo server-side de `paymentMethodCode` acá (los chips salen del catálogo del tenant en el móvil).
  `ponytail:` si un tenant lo exige, se valida contra `catalog_items` como en `POST /agenda`.

### 3.4 Auto-log de Llamar/WhatsApp/Navegar (§5.4, §7)
Cada tap registra un `CaseActivity` automático (trazabilidad sin esfuerzo): Llamar→`CALL`, WhatsApp→`MESSAGE`,
Navegar→`NOTE`. Reusa `POST /cases/:id/activities` tal cual (sin promesa). El deep-link (tel:, wa.me, geo:)
lo abre el móvil con `Linking`.

## 4. Móvil

### 4.1 Servicios
| Pieza | Decisión | Path |
|---|---|---|
| `clientContext` / `addClientContact` / `addClientLocation` | **REUSAR** | `agenda.service.ts` (ya existen) |
| `getCase(id)` (detalle + activities) | **EXTENDER** | `cases.service.ts` (hoy solo `listCases`) |
| `addActivity(caseId, input)` (gestión + promesa) | **NUEVO** | `cases.service.ts` |
| `listPayments(caseId)` / `createPayment(input, idemKey)` | **NUEVO** | `payments.service.ts` |
| `uploadImage` (comprobante) | **REUSAR** | `uploads.service.ts` (S2) |
| `apiMutate` con header opcional (`Idempotency-Key`) | **EXTENDER** | `api-client.ts` (pasa `headers?` a `authedFetch`→`apiFetch`) |

### 4.2 `ficha.ts` (puro, con test)
`buildTimeline(activities, payments)` → lista unificada ordenada por fecha desc (cada ítem: tipo, fecha, texto,
monto/método si es pago). `recovered(principal, outstanding)` para la barra de progreso. Sin red, sin React.

### 4.3 Pantalla `app/cliente/[id].tsx` (reemplaza placeholder)
De arriba a abajo (§5.4): **cabecera** (nombre, doc, zona, deuda total dominante, badge, etiqueta
"Importado · candado" si `locked`); **barra de acciones** (Llamar/WhatsApp/Navegar → `Linking` + auto-log);
**tarjeta Próximo pago** (cuota, fecha, mora acumulada; botones **Registrar pago** primario / **Registrar
gestión** secundario); **progreso** (Recuperado X de Y); **datos del préstamo** colapsables + **selector de
crédito** si hay ≥2; **ubicación y contactos** (pin + teléfonos + "+ agregar"); **timeline** (pagos∪gestiones).
Estados loading/offline/error; pull-to-refresh.

### 4.4 Hoja Registrar pago (`BottomSheet`)
`AmountInput` (precargado con la cuota, editable para parcial), método (`Chips`: Efectivo·Transferencia·QR),
**foto de comprobante** opcional (`expo-image-picker` → `uploadImage`), confirmar → `createPayment`
(con `Idempotency-Key` generado en el cliente; el botón se desactiva mientras guarda para evitar doble-submit).
Al volver: refetch de caso + pagos → saldo abajo, fecha avanzada, pago en el timeline.

### 4.5 Hoja Registrar gestión (`BottomSheet`)
`Chips` de resultado (No contesta·Visita·Inubicable·**Promesa de pago**) + nota. Si **Promesa**: `AmountInput`
(monto) + fecha (`datetimepicker`) + método (`Chips`) → `addActivity` con `promise`. El resto → `addActivity`
simple. Al volver: la gestión aparece en el timeline; la promesa además enciende PROMESA en la cartera.

## 5. Reuso (Paso B)
| Capacidad | Decisión | Path |
|---|---|---|
| PII en claro auditada (teléfonos/direcciones) + créditos | REUSAR | `GET /agenda/clients/:id/context` |
| Detalle de caso con `creditView` | REUSAR | `GET /cases/:id` (`serializeCase`, S1) |
| Pago que descuenta + comprobante + idempotencia | REUSAR | `POST /payments` (fundación) |
| Subida de comprobante (SHA-256 buffer original) | REUSAR | `POST /uploads` + `uploads.service` |
| `addActivity` (CaseActivity + lastActionAt) | **EXTENDER** | `cases.service` (promesa → agenda_item) |
| `AmountInput` / `Chips` / `BottomSheet` / `PORTFOLIO_STATUS_META` / `money` | REUSAR | `ui.tsx` / `agenda-form` (S1/S2) |
| `Header` / `Field` / `Button` / `ErrorBanner` / `SectionLabel` | REUSAR | `ui.tsx` / `components.tsx` |
| `datetimepicker` / `expo-image-picker` / `expo-location` / `Linking` | REUSAR | deps ya instaladas (`Linking` es RN core) |
| Timeline (intercalar) / progreso | **NUEVO** | `src/ficha.ts` (puro + test) |
| `getCase` / `addActivity` / `listPayments` / `createPayment` | **NUEVO** | `cases.service` / `payments.service` (móvil) |
| Enums de dominio (`PaymentMethod`, `CaseActivityType`, `AgendaItemType`) | REUSAR | `@kobrax/shared` / `@prisma/client` |

## 6. Tareas (orden: backend → servicios → puro → UI)
1. Backend: `ActivityPromiseDto` (antes de `CreateActivityDto`) + `CreateActivityDto.promise`;
   `addActivity` crea el `agenda_item PROMISE_TO_PAY` atómico + audit. Tests.
2. Móvil servicios: `apiMutate` con `headers?`; `cases.service` (`getCase`, `addActivity`);
   `payments.service` (`listPayments`, `createPayment`).
3. `src/ficha.ts` (timeline + progreso) + test.
4. Hojas: pago + gestión (`BottomSheet`).
5. Pantalla `app/cliente/[id].tsx`: cabecera + acciones + próximo pago + progreso + datos/selector +
   ubicación/contactos + timeline + estados. Cablear las 2 hojas.
6. Verificar: API type-check + tests · móvil type-check + jest + `expo export` · smoke real contra `:4010`.

## 7. Reglas de la fase
Las 3 del epic §3.3 — **sol→contraste** (deuda/cuota/monto en `navy`; labels en `muted`), **gama baja→perf**
(`FlashList` para el timeline si crece; sheets con Reanimated ya integrado; sin re-render por tecla),
**animación con propósito** (haptic al registrar pago, transición de la hoja). + multi-tenant **por capacidad**
· TS estricto sin `any` · `{data,meta,error}` · **audit en toda mutación** (pago ya audita; gestión/promesa
auditan) · **evidencia inmutable**: SHA-256 del comprobante en el server · enums y timeline **derivados**,
nunca duplicando reglas de dominio. **Offline**: "Guardar" avisa y conserva; la cola real es P6.

## 8. Decisiones (cerradas con la usuaria, 2026-07-14)
- **Ficha completa**: S3 incluye registrar pago **y** registrar gestión (los 2 botones viven juntos).
- **Promesa → `agenda_item PROMISE_TO_PAY`**: una promesa cargada en la ficha enciende PROMESA en la cartera
  (S1) y aparece en la Agenda — consistente con lo ya construido.
- **PII de la ficha**: se reusa el context auditado de Agenda (no se crea otra puerta de reveal).
- **Auto-log** de Llamar/WhatsApp/Navegar: se cablea (§5.4/§7), reusando `POST /cases/:id/activities`.
- **Idempotencia del pago**: `Idempotency-Key` generado en el cliente + botón que se desactiva; la cola offline
  idempotente real es P6.

## 9. Tests
- **API** (node:test): `addActivity` sin `promise` = solo `CaseActivity` (comportamiento actual); con `promise`
  crea **también** un `agenda_item PROMISE_TO_PAY` con `scheduledDate = promiseDate` y `details` = la promesa,
  en scope del cobrador, + audit; el badge/consistencia se cubre por el test de S1 (`hasActivePromise`).
- **móvil** (jest): `buildTimeline` intercala pagos y gestiones por fecha desc y marca el tipo; `recovered`
  clampa a `[0, principal]`; la hoja de gestión exige monto+fecha+método solo cuando el resultado es promesa.

## 10. DoD
- Backend: `addActivity` con promesa atómica + tests verdes; sin regresión en la gestión simple.
- Con la API real: abrir la ficha de un deudor del seed, ver deuda/cuota/estado/timeline; **registrar un pago
  parcial** y ver bajar el saldo + el pago en el timeline; **registrar el pago de la cuota** y ver avanzar la
  próxima fecha; **registrar una gestión de promesa** y verla en el timeline **y** como PROMESA en la cartera
  (S1) **y** en la Agenda; Llamar/WhatsApp/Navegar dejan su evento; un crédito importado muestra el candado.
- Verde: API type-check + tests · móvil type-check + jest + `expo export`.
- **Validación visual de la usuaria** (parity con "Detalle de gestión" de Agenda).

## 11. Riesgos / decisiones abiertas
- **Reuso del context de Agenda como PII de la ficha**: si el módulo se audita, este es un punto a mirar
  (ya mitigado: `AGENDA_WRITE` + audit propio). Alternativa futura: un context de cartera dedicado.
- **`addActivity` no auditaba** hoy (solo emite evento). La gestión-promesa **sí** audita el `agenda_item`;
  auditar toda gestión simple queda como mejora menor (no bloquea).
- **Idempotencia**: sin cola offline (P6), un pago sin señal se pierde (avisa, conserva el monto tipeado).
- **Timeline paginado**: se trae el historial completo del caso (cabe para un deudor); si un caso tuviera
  cientos de eventos, paginar. `ponytail:` techo conocido.
