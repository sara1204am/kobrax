> **ESTADO: APROBADO — ronda 1 (2026-08-12).** Las dos decisiones de la dueña están cerradas (§5):
> **`PaymentMethod` se arregla en `shared`** —y el arreglo es limpio, porque hoy no lo consume
> nadie— y **el panel sí registra pagos**, con el aviso de que no se pueden corregir.
>
> Todo lo demás está verificado contra el controller, el service y el schema.

# W7 — Pagos

> **CERRADA: mergeada a `main` el 12/08.** Verde antes de mergear: shared build + 46 · móvil
> type-check + 310 · API type-check + 563 · web type-check + 194 + build. Con `/code-review` (seis
> hallazgos, arreglados) y `/ponytail-review` (−11 líneas) hechos.
>
> **Falta el recorrido por cable —el doble clic en confirmar— y la validación visual.**

## 1. Objetivo

Que la oficina vea **la plata**: qué se cobró, quién lo registró y contra qué crédito se aplicó. Y
que pueda **pedir un cobro** —un QR o un link— para el deudor que no va a recibir a nadie en la
puerta.

Es la etapa que cierra el ciclo que W3 abrió: la cartera dice cuánto se debe, W5 y W6 muestran el
trabajo hecho, y acá aparece el resultado.

## 2. Rama

`web/W7-pagos`, **sale de `main` con W6 adentro**.

De W6 se hereda: `UrlFilters` y `DayPicker` en `components/`, `pageMeta`, `proxyMutation`,
`errorText`, y el patrón de `lib/<modulo>.ts` con sus pruebas.

## 3. Pantallas

| Ruta | Permiso | Qué hace |
|---|---|---|
| `/pagos` | `payment:read` | El ledger del período: monto, medio, crédito, quién registró |
| `/pagos/[id]` | `payment:read` | El detalle de un pago y su comprobante |
| `/pagos/solicitudes/nueva` | `payment:write` | Pedir un cobro: QR o link para mandarle al deudor |

🔴 `/pagos/:path*` al matcher, `/api/payments/:path*` y `/api/payment-requests/:path*` para los
handlers, y `built: true` a `payments` en `lib/nav.ts`.

## 4. Contrato (verificado contra `payments.controller.ts`, el service y el schema)

### 4.1 Los seis endpoints

| Endpoint | Permiso | Notas |
|---|---|---|
| `GET /payments` | `payment:read` | Filtros: `creditId`, `caseId`, `from`, `to` + paginación |
| `GET /payments/:id` | `payment:read` | Un pago |
| `POST /payments` | `payment:write` | Registrar. **Lleva `Idempotency-Key` como header** (§4.3) |
| `POST /payment-requests` | `payment:write` | Pedir un cobro; devuelve `qrPayload` y `url` |
| `GET /payment-requests/:id` | `payment:read` | Estado de la solicitud (`PENDING`/`PAID`/`EXPIRED`/`CANCELLED`) |
| `POST /payment-requests/:id/confirm` | **`payment:approve`** | Confirmar que entró. Es un permiso aparte |

### 4.2 🔴 El ledger es INMUTABLE

`payments` no tiene `update` ni `delete`, y el schema lo dice: **ledger inmutable**. No hay endpoint
para corregir ni anular un pago.

Consecuencia directa para el panel: **ninguna pantalla ofrece editar ni borrar**, y un pago mal
cargado se arregla con otro asiento, no tocando el anterior. Es la misma regla que la evidencia de
W6, y por el mismo motivo: si se pudiera cambiar, no probaría nada.

⚠️ Hay que decirlo en pantalla **antes** de confirmar, no después: es el único momento en que la
persona puede evitar el error.

### 4.3 🔴 `Idempotency-Key` es un HEADER, no un campo

`POST /payments` lo lee de `@Headers('idempotency-key')`. `apiCall` del BFF arma sus propios
headers, así que el handler tiene que **pasarlo explícitamente** — mandarlo en el cuerpo lo deja
sin efecto y un doble clic registra el pago dos veces. **En plata, eso no es un detalle.**

La clave la genera el navegador (`crypto.randomUUID()`) al abrir el formulario, no al enviar: si se
generara al enviar, cada reintento traería una distinta y la idempotencia no serviría para nada.

### 4.4 🔴 `PaymentMethod` de `shared` está podrido (C7)

```
shared:  PAYMENT_METHODS = ['cash', 'transfer', 'qr', 'card', 'mobile_payment']   ← minúsculas
Prisma:  enum PaymentMethod { CASH TRANSFER QR CARD MOBILE_PAYMENT }               ← lo que la API espera
```

Mandar el de `shared` **hace rebotar el pago**. Es un delta conocido (C7 del BUILD-PLAN) que
sobrevivió a seis etapas porque ninguna registraba pagos. **W7 es la primera que lo toca de verdad**,
así que hay que decidirlo — §5.

### 4.5 Lo que W7 promueve a `shared`

| Qué | Por qué |
|---|---|
| **`PaymentMethod` arreglado** | D1. Hoy es minúscula legacy y **no lo consume nadie**: el móvil se escribió su propio tipo local. Se arregla, el móvil importa de ahí y se borra la copia |
| `PaymentItem`, `NewPayment`, `PaymentRequestItem` | Contrato, mismo criterio que agenda, casos y rutas |

### 4.5-bis 🔴 `applyPayment` NO se promueve (corrección de la ronda 1)

La ronda 1 lo daba por promovible «porque es plata». Verificado contra el código, **no se puede y
además no hace falta**:

- `payment-apply.ts` importa `InstallmentStatus` y `Prisma` de `@prisma/client`. **`shared` tiene
  cero dependencias de runtime** —es lo que le permite correr en el teléfono— así que meterlo ahí
  significaría o agregar Prisma a `shared`, o aflojarle los tipos al enum para que entre.
- Y sobre todo: **el panel no reparte pagos.** Registra el monto y el servidor decide cómo se
  aplica al cronograma. Aflojar tipos buenos para un consumidor que no existe es justo la
  promoción especulativa que la regla §3.9 quiere evitar.

Se queda en la API, con sus specs. Si algún día el panel previsualiza el reparto —«este pago cubre
la cuota 3 y deja 200 a cuenta»—, ahí sí, y con el consumidor a la vista.

### 4.6 Lo que ya se sabe y acá se hereda

- **`GET /payments` devuelve los del TENANT, no los de un cobrador** (lección de Rutas). Con
  `registeredBy` se ve quién lo cargó; si hiciera falta filtrar por persona, **no hay parámetro**.
- 🔴 **El ledger no trae el nombre del deudor**: devuelve `creditId` y `caseId`. Resolverlo por fila
  serían dos llamadas por pago —crédito y cliente— o **cuarenta por página**. Por eso la lista
  **no tiene columna de deudor** y el nombre sale en el detalle, que es una fila sola y se lo puede
  permitir. No es un olvido; si algún día molesta, el arreglo es un `view=` que enriquezca la
  respuesta, como hizo casos.
- **El total de la pantalla es el de la PÁGINA**, no el del período: no hay endpoint de agregación
  y sumar el período entero exigiría traerlo entero. El rótulo dice cuántos pagos está contando,
  para que el número no se lea como «lo cobrado en el mes».
- Sin `user:read` no hay nombres: `registeredBy` es un id, y **sin nombre no es «sin nadie»** (W5).
- Los `POST` responden **201**: `proxyMutation` ya lo sabe.
- El comprobante (`receiptUrl`) sale por `/api/uploads/…` **tal cual viene**: es una ruta, no un
  nombre. Lo pagó W6 y no se vuelve a pagar.

### 4.7 🔴 Registrar y pedir un cobro **exigen un crédito**, y el ledger no lo elige (T4/T5)

`POST /payments` pide `creditId` obligatorio. Y `POST /payment-requests` lo acepta **opcional** —pero
`confirmRequest` tira `paymentInvalid('La solicitud no tiene crédito asociado')`: una solicitud sin
crédito genera un QR que **nunca se va a poder conciliar**. Así que las dos pantallas lo exigen igual.

Consecuencia de diseño: `/pagos` no elige el crédito (no tiene buscador de deudores, y armarlo sería
un módulo). **La puerta es la ficha del crédito**, que ahora lleva a `/pagos?creditId=…`; con el
crédito en la URL aparecen las dos acciones. Sin él, el botón de registrar sigue estando y dice a
dónde ir (`register.noCredit`) — esconderlo dejaría a la persona buscando algo que existe.

Por eso el alta de pago **no es una ruta**: es un modal sobre el ledger, que es donde ya está el
crédito y donde el pago recién registrado se ve aparecer.

## 5. Las dos decisiones de la dueña (12/08) — cerradas

| # | Decisión | Qué implica |
|---|---|---|
| D1 | **`PaymentMethod` se ARREGLA en `shared`** | Pasa a MAYÚSCULA y queda alineado con Prisma. ✅ **El arreglo es limpio: hoy no lo consume nadie** — el móvil se escribió su propio tipo local (con un comentario diciendo que el de `shared` «es otro») y la API usa el de Prisma. Así que además de arreglarlo, el móvil pasa a importarlo y se borra la copia. Queda **una sola verdad**, y el próximo módulo que toque pagos no vuelve a pisar la mina |
| D2 | **El panel SÍ registra pagos** | La oficina carga el que llega por transferencia o al mostrador. La confirmación dice, **antes** de registrar, que un pago no se puede editar ni anular y que un error se corrige con otro asiento (§4.2). Es el único momento en que se puede evitar |

## 6. Tareas

| # | Tarea | Sale verde con |
|---|---|---|
| T0 | Arreglar `PaymentMethod` en `shared` (D1) y promover el contrato de pagos. El móvil borra su copia | shared + móvil **310 sin tocar un test** + API |
| T1 | BFF: `payments` (registrar, con el header de idempotencia) y `payment-requests` | tests de handler, incluido **que el header viaja** |
| T2 | Matcher + `nav.ts` + esqueleto de `panel.payments` en los dos idiomas | `nav.test.ts` + `messages.test.ts` |
| T3 | `/pagos`: el ledger con filtros de período y crédito | pantalla + `lib/payments.ts` con tests |
| T4 | `/pagos/[id]`: el detalle y su comprobante | pantalla |
| T5 | `/pagos/solicitudes/nueva`: pedir el cobro, con el QR y el link para copiar | pantalla |

## 7. Tests

| Qué | Dónde |
|---|---|
| `applyPayment` y `creditPatchAfterPayment` | se quedan en la API (§4.5-bis); sus specs **no se tocan** |
| 🔴 Que el `Idempotency-Key` viaje **como header** | test del handler, con MSW |
| Que el medio de pago viaje como la API lo espera | `lib/payments.test.ts` |
| El período por defecto y uno inválido en la URL | idem |

## 8. Verificación

```
pnpm --filter @kobrax/shared build && pnpm --filter @kobrax/shared test
pnpm --filter @kobrax/mobile type-check && pnpm --filter @kobrax/mobile test   # 310, sin tocarlos
pnpm --filter @kobrax/api type-check && pnpm --filter @kobrax/api test
pnpm --filter @kobrax/web type-check && pnpm --filter @kobrax/web test
pnpm --filter @kobrax/web build      # ⚠️ con el `dev` APAGADO
```

Y el recorrido por cable: registrar un pago, **hacer doble clic en confirmar** y verificar que
entró UNO solo. Los datos salen de `db:seed:day` (W6).

## 9. Trampas y riesgos

- 🔴 **El header de idempotencia** (§4.3). Es el defecto más caro posible de esta etapa: se paga dos
  veces y el ledger no se puede corregir.
- 🔴 **El ledger no se edita ni se borra** (§4.2). Ninguna pantalla ofrece lo contrario.
- 🔴 **`PaymentMethod` de `shared` hace rebotar el pago** (§4.4). Es D1 y va antes de todo.
- ⚠️ **`shared` no tiene NINGUNA dependencia de runtime** y es lo que le permite correr en el
  teléfono. Nada que importe de `@prisma/client` puede mudarse ahí (§4.5-bis).
- ⚠️ `confirm` pide `payment:approve`, que **ni el supervisor tiene por defecto**: verificar contra
  `ROLE_PERMISSIONS` antes de dibujar el botón, o queda un 403 esperando.
- ⚠️ Las trampas del entorno de siempre: `next build` con el `dev` apagado, `-LiteralPath` en
  PowerShell, `git commit -F` y **nunca `git add -A` a ciegas** — en W6 se coló un documento ajeno.

## 10. Fuera de alcance

- **La conciliación bancaria automática**: no hay integración con ningún banco; `confirm` es manual.
- **Cobrar de verdad** (pasarela): `qrPayload` y `url` los arma la API; el panel los muestra.
- **Anular o corregir un pago**: no existe del lado del servidor, y es a propósito (§4.2).
- **Los KPIs de recaudación**: es W8.
