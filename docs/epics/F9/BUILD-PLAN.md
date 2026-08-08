# F9 · BUILD-PLAN — orden de construcción del panel web

> Doc maestro de ejecución de [EPIC-F9](../EPIC-F9-panel-web.md). Un plan = una rama.
> Equivalente web del `docs/epics/F10/BUILD-PLAN.md` que gobernó el móvil.

**Creado:** 2026-08-07 · **Rama base:** `web/f9-auth` (sale de `main` + la limpieza del CRUD genérico)

---

## 1. Por qué este plan existe (y por qué F9 se re-ordenó)

El EPIC F9 se escribió cuando la única superficie del producto era la API. Sus slices 1–5
apuntaban a los **endpoints genéricos** `/clients`, `/credits`, `/cases`. Entre medio se construyó
todo el móvil (F10), y ahí el negocio quedó definido de verdad: cartera, agenda, rutas, import y
cuenta, cada uno con sus endpoints, sus reglas y sus decisiones cerradas.

Por eso el 2026-08-07 se **borró `src/app/panel/**`** (el CRUD genérico) y se re-ordenó el build:
el panel web se construye **sobre los mismos contratos que ya usa el móvil**, no sobre los CRUD
que nadie terminó de operar. Lo borrado está en el historial de git si hace falta mirarlo.

**Método:** el mismo que funcionó en el móvil — *módulo por módulo, pantalla por pantalla,
funcional*. Nada de andamios "para después".

---

## 2. Workflow por etapa (obligatorio)

```
1. Plan     docs/epics/F9/plans/W#-<nombre>.md   ← se itera con la usuaria hasta darlo por completo
2. Gate     validación del plan → PASS / FAIL     ← sin PASS no se escribe una línea de código
3. Rama     git checkout -b web/W#-<nombre>
4. Build    reusando lo del BASE-INVENTORY
5. Verde    pnpm --filter @kobrax/web type-check · test · build
6. Revisión /code-review + /ponytail-review · aplicar findings · re-verificar
7. Visual   handoff a la usuaria (navegador real, 1280 y 1440)
8. Merge    a main con 5+6+7 verdes · borrar la rama
9. Cierre   actualizar BASE-INVENTORY, el estado de la etapa acá, y la memoria de proyecto
```

`main` siempre queda verde y desplegable.

---

## 3. Reglas transversales (se heredan del móvil y del BFF)

1. **El navegador nunca ve un token.** Todo pasa por route handlers en `src/app/api/**`.
   Un componente cliente **jamás** llama a la API directamente.
2. **Toda ruta privada nueva entra al matcher de `middleware.ts`.** Es el error más fácil de
   cometer y el más difícil de notar: la pantalla anda hasta que expira el access token.
3. **Multi-tenant por capacidad, nunca por `tenantType`.** Lo mismo que rige en el móvil.
4. **Ocultar ≠ autorizar.** El `usePermissions` es cosmética; la API sigue validando siempre.
5. **Tokens visuales de `tailwind.config.ts` (fuente: `packages/shared/src/design/tokens.ts`).**
   Ningún color ni medida hardcodeada. La marca no se toca al rediseñar; se cambia el layout.
6. **TypeScript estricto, sin `any`.** `{data, meta, error}` en toda respuesta.
7. **No pintar lo que no existe.** Regla traída del móvil: si un botón no tiene respaldo en la
   API, no se dibuja. Vale para SSO, para métricas y para cualquier "próximamente".
8. **Un test de Vitest por lógica no trivial**, no por componente.
9. 🔴 **Una regla de negocio NO se re-implementa: se promueve a `packages/shared`.**
   El móvil dejó las reglas del dominio escritas como funciones puras dentro de
   `apps/mobile/src` (cotizar un préstamo, repartir el día de la agenda, ordenar la cartera,
   contar la jornada). **La web no las copia ni las reescribe**: se suben a `shared` y las
   consumen los dos. Si el escritorio cotiza un préstamo distinto que el teléfono, es un bug de
   plata, y aparece meses después. Ver el detalle por etapa en
   [`plans/BASE-INVENTORY.md §2`](./plans/BASE-INVENTORY.md).
   Promover = mover el archivo a `shared`, dejar el móvil importando de ahí, y verificar que sus
   tests siguen pasando **sin tocarlos**.

---

## 4. Etapas

| # | Etapa | Alcance | Depende de | Estado |
|---|-------|---------|-----------|--------|
| **W0** | **Identidad** | Refactor visual de todo el auth contra el diseño · **Google OAuth** · **i18n es/en** · registro público · invitación | — | 🚧 en curso |
| W1 | Shell del panel | Layout autenticado (sidebar navy + topbar + breadcrumb) · `usePermissions` · selector de empresa · estados loading/empty/error · kit de UI (`DataTable`, `Modal`, `Toast`, `Skeleton`, `Badge`, `EmptyState`, `PageHeader`) | W0 | ⏳ |
| W2 | Cuenta y equipo | Datos de la cuenta (`/accounts/me`) · miembros e invitaciones (`/users`) · roles (`/roles`, lectura + asignación) · seguridad de la cuenta (ya existe, se re-encuadra en el shell) | W1 | ⏳ |
| W3 | Cartera | Clientes y créditos (`/clients`, `/credits`): lista, ficha, alta y edición · PII tokenizada con reveal auditado · mora coloreada | W1 | ⏳ |
| W4 | Import | `/imports/portfolio`: configuración de columnas, preview y conciliación. **Es el gap que el móvil dejó anotado**: el import de oficina se hace en pantalla grande | W3 | ⏳ |
| W5 | Casos y agenda | `/cases` y `/agenda`: tablero, asignación, transiciones, timeline. La cara de supervisión del trabajo del cobrador | W3 | ⏳ |
| W6 | Rutas y evidencia | `/routes` y `/visits`: planes del día, paradas, evidencia capturada en campo (foto + GPS + hash). **Sólo lectura/supervisión** | W5 | ⏳ |
| W7 | Pagos | `/payments`: ledger inmutable, conciliación, solicitud de pago (QR/link), aprobación | W3 | ⏳ |
| W8 | Dashboard | KPIs de cartera + gráficos. Va **tarde a propósito**: necesita que los módulos de arriba produzcan datos reales para no medir el vacío | W2–W7 | ⏳ |
| W9 | Realtime y notificaciones | WebSocket (`collector.location`, `case.updated`, `payment.registered`) + centro de notificaciones | W6, W8 | ⏳ |

> **Cada etapa arranca promoviendo a `shared` las reglas que el móvil ya escribió para ese
> dominio** (regla §3.9). El detalle de qué promueve cada una está en
> [`plans/BASE-INVENTORY.md §1-bis.2`](./plans/BASE-INVENTORY.md). Las tres que más duelen si se
> olvidan: **W3 la cotización de préstamo** (es plata), **W5 el reparto del día** (`partitionDay`,
> que ya tuvo un bug donde una gestión cancelada desaparecía), y **W6 la cuenta de la jornada**
> (`summarizeDay`, que existe porque dos pantallas del mismo día decían cosas distintas).

### Por qué este orden

- **W0 primero** porque es la puerta: todo lo demás vive detrás del login.
- **W1 antes que cualquier módulo** porque el shell y el kit de UI son la base que los nueve
  módulos siguientes reusan. Construir un módulo antes del shell garantiza reescribirlo.
- **W2 antes que la operación** porque sin equipo cargado no hay a quién supervisar ni a quién
  asignarle casos. Además sus contratos ya se recorrieron en el móvil.
- **W3 → W4** es la espina de "meter los datos": primero el concepto de cartera, después la carga
  masiva que la llena de golpe.
- **W5 → W6 → W7** es la de "supervisar lo que pasó": trabajo asignado, trabajo ejecutado, plata.
- **W8 y W9 al final** porque miden y notifican lo que los anteriores producen.

---

## 5. Deltas de contrato conocidos

| # | Delta | Detalle |
|---|-------|---------|
| C1 | Prefijo `/api` | `KOBRAX_API_URL` ya lo incluye (`…:4010/api`). Los paths se escriben sin él. |
| C2 | Pagos cuelgan de la raíz | `payments.controller.ts` es `@Controller('')`: los paths son `/payments`, no `/payments/payments`. |
| C3 | `GET /payments` devuelve los del **tenant** | No los del cobrador. Lección del módulo de rutas del móvil. |
| C4 | Import de cartera ≠ import de clientes | `/imports/portfolio` (el bueno, con 3 formas de archivo) vs `/clients/imports` (el viejo, que **no sirve**: matchea por carnet y borra al ausente). |
| C5 | `DELETE /agenda/:id` responde **200 con el ítem**, no 204 | |
| C6 | Sin endpoints de agregación | Los KPIs se calculan en cliente, igual que en el móvil (decisión cerrada). W8 lo hereda. |
| C7 | **`PaymentMethod` de `shared` es legacy y NO sirve** | `PAYMENT_METHODS` son minúsculas (`'cash'`, `'transfer'`…); el enum de Prisma que la API espera es MAYÚSCULA (`CASH`, `TRANSFER`, `QR`, `CARD`, `MOBILE_PAYMENT`). Mandar el de shared hace rebotar el pago. Afecta W7. |
| C8 | **Los garantes NO son una entidad** | `GUARANTOR` es un valor de `LocationType`: viven en `client_locations` con lat/lng. Para "garantes de X" se filtra `locations` por tipo — no hay tabla ni endpoint de garantes. Afecta W3. |
| C9 | **El nombre visible tiene una sola regla** | `clientDisplayName()` en `apps/api/src/modules/clients/clients.serializer.ts`. No inventar un `${firstName} ${lastName}` en la web. Afecta W3, W5, W6. |
| C10 | `POST /visits` vive en `field-ops`, no en `visits/` | Su DTO usa **`lat`/`lng`**, no `latitude`/`longitude`. `field_visits` es **inmutable**: se escribe sólo en el INSERT. Afecta W6. |
| C11 | La mora de una parada es la de **su** caso | No la suma del deudor: un cliente puede tener varios créditos. Afecta W6. |
| C12 | No hay parsers por banco | Sumar un formato al import = configurarlo desde Ajustes, no escribir código. Tres formas: `rows` (CSV) · `pdf-rows` · `pdf-blocks`. Afecta W4. |
| C13 | **Excel no se lee** | La dep `xlsx` nunca se instaló y `rows.parser` sólo hace CSV. En el móvil se dejó así por peso de bundle; **en la web ese motivo no aplica** — W4 es el lugar natural para instalarla de verdad. |
| C14 | El crédito creado desde el móvil **no tiene cronograma** | Decisión D1 de cartera: la cuota queda congelada en `credit.metadata`. La web va a encontrarse créditos sin `schedule` y no puede asumir que siempre hay uno. Afecta W3, W7. |
| C15 | Las promesas de pago viven en `agenda_items` | No hay tabla de promesas: son ítems de agenda de tipo `PROMESA`. Afecta W5, W7. |
| C16 | No existe `account_invitations` | Un invitado es un `User` en estado `PENDING` + token. Afecta W0 (`/invitacion`) y W2. |

---

## 6. Decisiones cerradas (2026-08-07)

| # | Decisión | Motivo |
|---|----------|--------|
| D1 | **SSO: sólo Google, construido de verdad** | Los otros dos botones del diseño salen. Google se implementa completo (API + BFF), no como adorno. |
| D2 | **i18n real desde W0** (es/en) | El selector del diseño se pinta porque va a tener qué ofrecer. |
| D3 | **La fila de stats sale del panel izquierdo** | «+35% · 2.500+ · 99,9%» son afirmaciones sobre el negocio, no sobre el software. Quedan la marca, el titular y las 4 features. |
| D4 | **El panel web NO es offline.** | Offline-first es exclusivo del móvil. El panel es de oficina y asume conexión. |
| D5 | **Se construye sobre los contratos que usa el móvil**, no sobre los CRUD genéricos | Motivo de la limpieza de `src/app/panel/**`. |

---

## 7. Verificación de cada etapa

```powershell
pnpm --filter @kobrax/web type-check
pnpm --filter @kobrax/web test
pnpm --filter @kobrax/web build      # el build de Next es el que agarra los errores de RSC
pnpm --filter @kobrax/web dev        # :3000 — necesita la API en :4010
```

La validación visual la hace la usuaria en navegador real. Las etapas que tocan la API suman
`pnpm --filter @kobrax/api type-check` y `test`.

⚠️ **`build` y `dev` comparten `.next/` y se pisan.** Correr `next build` con el servidor de
desarrollo levantado deja al `dev` sirviendo 500 con `Cannot find module './283.js'` — y lo
confuso es que **no** es un error del código: la página que devuelve es una de error que puede
pasar cualquier chequeo ingenuo del HTML. Si aparece: matar el `dev`, borrar `apps/web/.next`,
levantarlo de nuevo. La verificación se corre con el `dev` apagado.
