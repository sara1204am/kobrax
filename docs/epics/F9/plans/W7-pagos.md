> **ESTADO: EN BORRADOR — ronda 1 (2026-08-12). NO construir hasta PASS.**
>
> Trae **una decisión abierta y una sola** (§5): qué se hace con `PaymentMethod` de `shared`, que
> hoy es legacy y hace rebotar cualquier pago (§4.4). Todo lo demás está verificado contra el
> controller, el service y el schema.

# W7 — Pagos

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
| `PaymentItem`, `NewPayment`, `PaymentRequestItem` | Contrato, mismo criterio que agenda, casos y rutas |
| **`applyPayment`** (de la API) | Cómo se reparte un pago entre las cuotas. **Es plata**: si el panel previera un reparto distinto del que el servidor aplica, la persona confirma una cosa y pasa otra |
| `creditPatchAfterPayment` | Qué queda del crédito después: próximo vencimiento y mora. ⚠️ El orden importa — la mora se mide contra la fecha YA avanzada |

⚠️ Las dos viven hoy **en la API**, no en el móvil: es la primera promoción que va en esa dirección.
Hay que verificar que sus specs siguen pasando sin tocarse, igual que se hace con el móvil.

### 4.6 Lo que ya se sabe y acá se hereda

- **`GET /payments` devuelve los del TENANT, no los de un cobrador** (lección de Rutas). Con
  `registeredBy` se ve quién lo cargó; si hiciera falta filtrar por persona, **no hay parámetro**.
- Sin `user:read` no hay nombres: `registeredBy` es un id, y **sin nombre no es «sin nadie»** (W5).
- Los `POST` responden **201**: `proxyMutation` ya lo sabe.
- El comprobante (`receiptUrl`) sale por `/api/uploads/…` **tal cual viene**: es una ruta, no un
  nombre. Lo pagó W6 y no se vuelve a pagar.

## 5. Decisión abierta

| # | Pregunta | Opciones |
|---|---|---|
| D1 | **¿Qué se hace con `PaymentMethod` de `shared`?** | **(a) Arreglarlo**: pasa a MAYÚSCULA y se alinea con Prisma. Es lo correcto, pero hay que revisar quién lo consume hoy — si el móvil ya manda el valor bueno por su cuenta, el arreglo es limpio; si alguien depende del minúscula, se rompe. **(b) Esquivarlo**: W7 usa el enum de Prisma vía un tipo propio y deja `PAYMENT_METHODS` marcado como muerto. Más barato, deja la trampa armada para la próxima |

## 6. Tareas

| # | Tarea | Sale verde con |
|---|---|---|
| T0 | Resolver D1 y promover a `shared` el contrato + `applyPayment` + `creditPatchAfterPayment` | shared + **API con sus specs sin tocar** + móvil 310 |
| T1 | BFF: `payments` (registrar, con el header de idempotencia) y `payment-requests` | tests de handler, incluido **que el header viaja** |
| T2 | Matcher + `nav.ts` + esqueleto de `panel.payments` en los dos idiomas | `nav.test.ts` + `messages.test.ts` |
| T3 | `/pagos`: el ledger con filtros de período y crédito | pantalla + `lib/payments.ts` con tests |
| T4 | `/pagos/[id]`: el detalle y su comprobante | pantalla |
| T5 | `/pagos/solicitudes/nueva`: pedir el cobro, con el QR y el link para copiar | pantalla |

## 7. Tests

| Qué | Dónde |
|---|---|
| `applyPayment` y `creditPatchAfterPayment` | ya tienen spec en la API — **tienen que seguir pasando sin tocarse** |
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
- ⚠️ **Promover desde la API es nuevo**: hasta ahora todo salía del móvil. Los specs de la API que
  cubren `applyPayment` tienen que seguir pasando sin tocarse.
- ⚠️ `confirm` pide `payment:approve`, que **ni el supervisor tiene por defecto**: verificar contra
  `ROLE_PERMISSIONS` antes de dibujar el botón, o queda un 403 esperando.
- ⚠️ Las trampas del entorno de siempre: `next build` con el `dev` apagado, `-LiteralPath` en
  PowerShell, `git commit -F` y **nunca `git add -A` a ciegas** — en W6 se coló un documento ajeno.

## 10. Fuera de alcance

- **La conciliación bancaria automática**: no hay integración con ningún banco; `confirm` es manual.
- **Cobrar de verdad** (pasarela): `qrPayload` y `url` los arma la API; el panel los muestra.
- **Anular o corregir un pago**: no existe del lado del servidor, y es a propósito (§4.2).
- **Los KPIs de recaudación**: es W8.
