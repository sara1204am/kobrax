# KOBRAX — Plan de construcción: que el sistema haga cumplir los planes

> **Fecha:** 2026-08-20
> **Implementa:** la grilla decidida en [LIMITES-POR-PLAN.md §4-A](./LIMITES-POR-PLAN.md).
> **Para quién:** la programadora. La dueña sólo necesita leer §1, §7 y §8.
> **Estado de partida:** el catálogo de planes ya existe en código
> (`packages/shared/src/constants/plans.ts`) y el panel lo muestra. **Nada lo hace cumplir todavía**,
> salvo el tope de usuarios, y ése ni siquiera lee el plan.

---

## 1. Dónde estamos hoy, verificado en el código

| Tope | ¿Se hace cumplir? | Dónde está (o dónde falta) |
|---|---|---|
| **Usuarios** | ⚠️ Sí, pero **no según el plan** | `users.service.ts:105` y `:156` leen `accounts.max_users`, columna suelta que **vale 5 en toda cuenta nueva** (`accounts.service.ts:75`), sea FREE o BUSINESS |
| **Créditos activos** | ❌ No | `credits.service.ts:123` (alta) · `portfolio-import.service.ts:217` (import masivo) |
| **Clientes** | ❌ No | `clients.service.ts:108` · `portfolio-import.service.ts:216` · `client-import.service.ts:166` |
| **Fotos por mes** | ❌ No | `field.service.ts:214` (`fieldEvidence.create`) |
| **Retención de fotos** | ❌ No | no existe nada que archive ni que venza |
| **Gestiones por mes** | ❌ No | `field.service.ts:170` (`fieldVisit.create`) + `caseActivity` en agenda y casos |
| **Sucursales** | ❌ No | la tabla `branches` existe; **cero código de producto** |
| **Suspender al moroso** | ✅ Sí | `auth.service.ts:238` — pero no hay palanca para activarlo |

`planCode` aparece en toda la API **sólo** en el serializer y en el DTO que lo marca de sólo lectura.
**Ningún guard lee el plan.** Hoy una cuenta FREE y una BUSINESS tienen los mismos topes reales.

---

## 2. Las tres reglas que ordenan todo el diseño

Todo lo que sigue sale de estas tres. Si una fase parece rara, la explicación está acá.

### R1 · Lo que ya ocurrió no se rechaza

Una visita, una foto y un pago **llegan de la calle, sin internet, ya sucedidos**. Rechazarlos al
sincronizar borra trabajo hecho, y en un producto cuyo valor es servir de prueba, eso no se hace.
→ *Fotos y gestiones sólo pueden avisar (§L2). Nunca bloquean.*

### R2 · El freno va donde está quien puede decidir, no donde llega el dato

El tope de créditos **sí** puede frenar, pero en el momento en que alguien puede hacer algo al
respecto: el administrador frente a la pantalla, o el cobrador **antes de encolar** el alta —cuando
todavía está frente al cliente y puede llamar a su jefe—. **Nunca al drenar la cola**, que es horas
después y sin nadie mirando. → §4.

### R3 · Un tope que no se cuenta no se muestra como si se contara

La tarjeta del plan de hoy lista lo que el plan incluye, sin barras: sólo los asientos tienen barra,
porque son lo único que se cuenta. Cada fase que agrega un contador **agrega su barra**, y ninguna
antes.

---

## 3. La forma que toma en el sistema

### 3.1 Sin tabla `plans` — y por qué

El anexo del documento de negocio proponía una tabla `plans` global. **No hace falta y cuesta más:**
una tabla pide migración, seed, mantenerla sincronizada con lo que muestra la web, y una pantalla
para editarla. Los números de un plan cambian una vez al año y con una campaña de marketing detrás:
eso es un release, no un dato de operación.

**La forma elegida:**

| Qué | Dónde vive |
|---|---|
| Los números de cada plan | `packages/shared/src/constants/plans.ts` — **ya existe**, lo leen web, móvil y API |
| 🆕 El piso de ENTERPRISE | el mismo catálogo. **Ningún plan SaaS es «ilimitado»** (LIMITES §4-A): un tope sin número no se cuenta, no avisa, y deja a un inquilino sin techo en una base compartida. `null` es sólo para Licencia |
| A qué plan pertenece una cuenta | `accounts.plan_code` — **ya existe** |
| La excepción negociada (§8.2 del doc) | `accounts.limits_override` **jsonb, nuevo** |
| El tope efectivo | `effectiveLimits(planCode, override)` en `shared` — **nuevo, 6 líneas** |

`accounts.max_users` **desaparece**: su valor se migra a `limits_override.users` sólo en las cuentas
donde difiera del plan.

### 3.2 El servicio que frena

`apps/api/src/common/plan/plan-limits.service.ts` — **nuevo**. Tres métodos y nada más:

```ts
limitsOf(): Promise<PlanLimits>          // plan + override de la cuenta del request
usage(kind): Promise<number>             // cuántos hay hoy
assertRoom(kind, cuantos = 1): Promise<void>   // cuenta y tira 422 si no entra
```

- Sin caché: es una consulta más por mutación, y las mutaciones que frena son altas, no lecturas.
- Lo inyectan `users`, `credits`, `clients`, `imports`. **No** lo inyectan `field-ops` ni `uploads`:
  esos avisan, no frenan (R1).
- El error es uno solo, con el tipo de tope adentro:
  `PLAN_LIMIT_REACHED · { kind, used, max }`. `USER_SEAT_LIMIT` se retira y se absorbe acá
  (`users.errors.ts:27`), con **un solo texto** que sirve para invitar y para reactivar.

### 3.3 Qué cuenta como cada cosa

| Tope | Consulta | Índice que hace falta |
|---|---|---|
| `users` | `userAccount.count({ isActive: true })` | ya está |
| `credits` | `credit.count({ deletedAt: null, status ∈ {ACTIVE, DEFAULTED, RESTRUCTURED} })` | parcial: `(account_id) WHERE deleted_at IS NULL AND status IN (…)` |
| `clients` | `client.count({ deletedAt: null })` | parcial: `(account_id) WHERE deleted_at IS NULL` |
| `photosPerMonth` | `fieldEvidence.count({ createdAt ≥ inicio de mes })` | **nuevo**: `(account_id, created_at)` — hoy sólo hay `(account_id, visit_id)` |
| `actionsPerMonth` | `fieldVisit.count({ createdAt ≥ inicio de mes })` | **nuevo**: `(account_id, created_at)` |

**`PAID`, `WRITTEN_OFF` y `CANCELLED` no cuentan** (Pregunta 9): el crédito cobrado libera lugar. Si
contaran, el cliente que cobra bien sería castigado por su propio éxito.

⚠️ **El inicio de mes es el del huso de la cuenta, no el del servidor.** Ya existe
`TenantClockService` (se construyó para la agenda, cuando «hoy» era el día UTC y en Bolivia el día
se pintaba vencido a partir de las 20:00). Los contadores mensuales lo usan; escribir `new Date()`
acá repite ese bug.

---

## 4. El caso difícil: el alta que llega de la calle

`apps/mobile/src/sync/queue.ts:70-71` encola `client.create` y `credit.create`. Al drenar,
`sync.service.ts:24` reintenta **3 veces** y después deja el ítem esperando un reintento manual, con
el error a la vista en la hoja de pendientes.

Traducido: **si el server rechaza el alta por tope, el préstamo que el cobrador cargó en la puerta
del deudor no entra nunca**, y se entera horas después leyendo un renglón rojo. Es el mismo trauma
de §5.3 del documento de negocio, aplicado a los créditos.

**La decisión (R2):**

| Momento | Qué pasa |
|---|---|
| **Al tocar «Guardar» en el móvil** | El teléfono ya sabe su tope (§L1.4) y avisa **ahí**, con señal o sin ella. El cobrador está frente al cliente y puede llamar a su jefe. |
| **Al drenar la cola** | El server **acepta igual** lo que venga de la cola aunque pase el tope, y lo anota como excedente. |
| **En la web y en el import** | Freno duro: la persona que decide está mirando la pantalla. |

Cómo distingue el server una cosa de la otra: el alta encolada ya viaja con **id puesto por el
teléfono** (`nuevoId()`, `queue.ts:70`). Ese mismo hecho —`id` provisto por el cliente— es la marca
de «esto ya ocurrió en la calle». Un alta desde la web no manda id.

> `ponytail:` **una línea en el guard, no un modo nuevo**: `assertRoom` recibe
> `{ soft: true }` cuando el dto trae id propio. El excedente se registra igual y se avisa (§L2.3).

---

## 5. El caso difícil 2: el archivo importado

Pregunta 10 del documento, respondida **A: se rechaza el archivo entero**.

Y sale casi gratis, porque el import **ya tiene vista previa**:
`portfolio-import.service.ts:184-191` calcula `counts.created` y, si es `dryRun`, devuelve el
resumen **antes de escribir nada**.

- **En la vista previa:** el resumen suma `roomLeft` y `wouldExceed`. La pantalla muestra
  *«el archivo trae 500 créditos nuevos y te quedan 80 lugares»* **antes** de que el usuario
  confirme. Nadie se entera al final.
- **Al aplicar:** un `assertRoom('credits', counts.created)` justo después de la línea 189, dentro de
  la misma transacción. Si no entra, no se escribe ni una fila.
- Lo mismo con `clients`, que se crean en el mismo lote (`:216`).
- El import legacy `client-import.service.ts:166` recibe el mismo trato.

---

## 6. Las fases

Cada fase deja el sistema entero y verde. Ninguna depende de la siguiente.

### L0 · La fundación — el plan pasa a mandar · **1 día**

**Base de datos** — una migración escrita a mano (`prisma migrate dev` no corre en este repo: la
shadow db no conoce `app_current_account`; se aplican con `migrate deploy`):

```sql
ALTER TYPE "PlanCode" RENAME VALUE 'STARTER' TO 'FREE';
ALTER TABLE accounts ADD COLUMN limits_override jsonb;
UPDATE accounts SET limits_override = jsonb_build_object('users', max_users)
  WHERE max_users <> 1;               -- 1 = lo que incluye el FREE
ALTER TABLE accounts DROP COLUMN max_users;
```

⚠️ `DROP COLUMN` en la misma migración **asume que no hay una versión anterior del API corriendo**.
Si la hay, se parte en dos despliegues: primero dejar de leerla, después borrarla.

**Código:**

| Archivo | Qué cambia |
|---|---|
| `schema.prisma:42,81,82` | enum `FREE`, default `FREE`, fuera `maxUsers`, adentro `limitsOverride` |
| `shared/constants/plans.ts` | `effectiveLimits(planCode, override)` + `parseOverride` |
| `common/plan/plan-limits.service.ts` | **nuevo** — §3.2 |
| `users.service.ts:105,156` | pasan a `assertRoom('users')` |
| `users.errors.ts:27` | `USER_SEAT_LIMIT` → `PLAN_LIMIT_REACHED` |
| `accounts.service.ts:74-75` | la cuenta nueva nace con **el plan que eligió** (L0.5), sin `maxUsers` |
| `accounts.serializer.ts` | `/accounts/me` devuelve `limits` y `usage`, no `maxUsers` |
| `shared/types/account.types.ts` | `AccountInfo`: fuera `maxUsers`, adentro `limits` + `usage` |
| `seed.ts:140,204` | `PlanCode.FREE` |

**Web:** la tarjeta del plan (`cuenta/plan-card.tsx`) deja de comparar contra `maxUsers` y usa
`limits.users`; la línea de «ajuste a medida» pasa a leer el override. `equipo/page.tsx` idem.

**Móvil:** `cuenta/index.tsx:84` y `cuenta/miembros.tsx:46-47` leen los campos nuevos.

**Se prueba:** que el tope sale del plan y no de la cuenta · que el override le gana al plan · que
una cuenta FREE no puede invitar al segundo · que reactivar también frena · que `STARTER` viejo sigue
resolviendo a FREE (`plans.spec.ts`, ya está).

---

### L0.5 · El plan se elige al crear la cuenta · ✅ **CONSTRUIDO (20/08)**

**Decisión de la dueña (20/08):** al registrarse se muestran **las tarjetas de los planes** y la
persona elige según cómo va a usar Kobrax. No se le asigna un plan por descarte.

> **Estado:** hecho y verde en los cuatro paquetes — shared 71 · API 671 · web 362 · móvil 319 +
> `expo export`. Falta la validación visual. Los 30 días de prueba y «Enterprise por contacto» se
> resolvieron con las sugerencias de más abajo.

Esto reemplaza a la Pregunta 34 con algo mejor: **la prueba es del plan que eligió**, no siempre del
PROFESSIONAL.

#### El riesgo que hay que contener primero

`POST /accounts` es **público y sin sesión** (`create-account.dto.ts:13`): lo que llegue en el cuerpo
es entrada no confiable. Si `planCode` se guardara tal cual, cualquiera manda
`{"planCode":"ENTERPRISE"}` con `curl` y se queda con todo sin límite, para siempre. Y aunque nadie
haga trampa: **sin pasarela de cobro, elegir «Business» y quedárselo es regalar el plan.**

**Cómo se contiene, sin construir facturación:**

| Tarjeta | Qué crea |
|---|---|
| **Free** | Cuenta FREE, sin vencimiento. Entra y trabaja. |
| **Professional** · **Business** | Cuenta **con ese plan**, `status = TRIAL` y `trialEndsAt = hoy + 30 días`. Al vencer **cae a FREE** (L4), no se bloquea. Nos llega el aviso para cerrar la venta. |
| **Enterprise** | **No es autoservicio.** La tarjeta dice «Hablemos» y abre un formulario de contacto. No crea cuenta con ese plan: su precio se cotiza (§4-B del documento comercial). |

Lo peor que puede pasar con el endpoint abierto pasa a ser **30 días de BUSINESS**, y después cae
solo. El DTO valida contra una lista blanca de tres (`FREE | PROFESSIONAL | BUSINESS`); ENTERPRISE
**no es un valor aceptado**.

> **`trialEndsAt` no necesita migración:** `accounts.settings` es `jsonb` y ya existe
> (`schema.prisma:86`). El job de L4 lo lee de ahí.

#### Lo que se construye

| Dónde | Qué |
|---|---|
| `create-account.dto.ts` | `@IsIn(['FREE','PROFESSIONAL','BUSINESS']) @IsOptional() planCode` — default FREE |
| `accounts.service.ts:68-79` | el plan sale del dto, no del cable; los asientos salen del catálogo (`PLANS[code].limits.users`); `settings.trialEndsAt` si es pago |
| `accounts.service.ts:97-108` | la entrada de auditoría del alta suma `planCode` — **es la métrica más valiosa que tiene el registro**: qué plan elige la gente antes de conocer el producto |
| web `(auth)/registro/page.tsx` | **paso 1: las tarjetas · paso 2: el formulario de hoy**, con un chip «Professional · cambiar» arriba. Una sola ruta, un solo POST |
| móvil `(auth)/registro.tsx` | el mismo paso 1, en tarjetas apiladas |
| `shared/constants/plans.ts` | `SIGNUP_PLANS = ['FREE','PROFESSIONAL','BUSINESS']` — la lista blanca vive **una vez** y la usan el DTO y las dos pantallas |
| i18n | las tarjetas reusan las claves `plans.*` que ya existen (`names`, `price`, `limits`, `support`) |

**Qué dice cada tarjeta:** nombre, precio, los cuatro topes que se sienten (miembros, créditos
activos, fotos por mes, meses de historial) y el soporte. Todo sale del catálogo y de i18n: **cero
números escritos en la pantalla**.

**Se prueba:** que elegir PROFESSIONAL crea la cuenta con 25 asientos y con vencimiento a 30 días ·
que sin `planCode` la cuenta nace FREE con 1 asiento · que `{"planCode":"ENTERPRISE"}` y
`{"planCode":"loquesea"}` **rebotan con 400** · que el paso 1 no deja seguir sin elegir.

> ⚠️ **Esta fase se puede construir antes que L0** y da efecto real desde el día uno: los asientos
> son el único tope que la API ya hace cumplir, así que elegir Professional **entrega de verdad**
> sus 25 miembros. Lo demás (créditos, fotos) queda descrito en la tarjeta y sin contar hasta L1.

---

### L1 · Créditos y clientes — el primer freno de verdad · **1,5 días**

| Dónde | Qué se agrega |
|---|---|
| `credits.service.ts:123` | `assertRoom('credits')` antes del create, dentro de la transacción |
| `clients.service.ts:108` | `assertRoom('clients')` |
| `portfolio-import.service.ts:~190` | `assertRoom` por lote + `roomLeft`/`wouldExceed` en la vista previa (§5) |
| `client-import.service.ts:166` | ídem |
| móvil `credits.service.ts` / `clients.service.ts` | el 422 se muestra con su texto; **el alta encolada no se pierde** (§4) |
| móvil, al guardar | consulta el tope **local** y avisa antes de encolar |
| web `plan-card.tsx` | barras reales de créditos y clientes (ya hay `usage`) |
| web import | el cartel de «te pasás por 420» en la vista previa |

**Lo que hace falta en el móvil y hoy no está:** `/accounts/me` se pide **en vivo**
(`account.service.ts:36`, `apiQuery`), así que en modo avión el teléfono no sabe su tope. Hay que
pasarlo por `cached()` o sumarlo a `hydrate()`. Es media hora.

**Se prueba:** el alta 21 en un FREE de 20 rebota con `PLAN_LIMIT_REACHED` · un archivo de 500 con 80
lugares **no escribe ni una fila** y lo dice en la vista previa · un crédito `PAID` no ocupa lugar ·
el alta con id propio (de la cola) entra igual y se marca excedente.

---

### L2 · Fotos y gestiones — avisar, nunca frenar · **1 día**

Contadores de sólo lectura + el aviso del 80% (Pregunta 36).

1. **Contadores:** `photosPerMonth` sobre `field_evidences` y `actionsPerMonth` sobre `field_visits`,
   con los dos índices nuevos de §3.3.
2. **Aviso al 80%** al administrador de la cuenta, por el módulo `notifications` que ya existe.
   **Una vez por mes y por tope**, no en cada foto: se guarda la marca en `limits_override`… no —
   en `accounts.settings`, que ya es el cajón de estado de la cuenta.
3. **Aviso al 100% hacia adentro:** al llegar al tope, lo que sigue es una conversación de venta, no
   un cartel más. Sale por el mismo canal (correo interno).
4. **Web:** barras informativas en la tarjeta del plan, con el renglón «se reinicia el 1 de
   {mes}» (Pregunta 13: día 1, no aniversario).

**Nada bloquea.** Ni una rama de código que devuelva error acá (R1).

---

### L3 · La palanca — cambiar de plan y suspender · **0,5 día**

Hoy se hace a mano por SQL. Lo mínimo que lo saca de ahí:

```
pnpm --filter @kobrax/api plan:set -- --account <id> --plan BUSINESS
pnpm --filter @kobrax/api plan:set -- --account <id> --override '{"users":40}'
pnpm --filter @kobrax/api account:suspend -- --account <id>
```

Un script, con el patrón que ya usa `arrears:run` (`modules/arrears/run-once.ts` +
`"arrears:run"` en `package.json`). Escribe en `audit_logs` como cualquier mutación.

> `ponytail:` **script, no pantalla interna.** Una pantalla de administración de Kobrax es un panel
> aparte, con su login y sus permisos, para una operación que hoy pasa una vez por semana. Cuando
> haya más de 10 clientes pagando, la pantalla se justifica sola.

---

### L4 · Prueba, caída al FREE y cuentas dormidas · **1 día**

Un job diario, mismo patrón que `arrears:run`:

| Regla | Qué hace |
|---|---|
| Prueba vencida (Pregunta 34) | 30 días con límites PROFESSIONAL → **cae a FREE**, no se bloquea |
| Suspensión por falta de pago (Pregunta 35) | **cae a FREE**, no corte seco. El corte seco queda para quien ya no responde |
| Cuenta FREE dormida (Pregunta 20) | 6 meses sin entrar → aviso; 9 meses → sólo lectura y fotos archivadas |
| Bajar de plan estando por encima (Pregunta 31) | **congelar**: nadie se desactiva solo, pero no se puede sumar. Sale gratis — es lo que `assertRoom` ya hace |

Las cuatro son la misma consulta diaria sobre `accounts` y un cambio de `plan_code`.

---

### L5 · Retención de fotos · **1 día — BLOQUEADA**

**No se puede construir todavía.** `UploadsService` guarda en **disco local**
(`uploads.service.ts:57`, con un `ponytail:` que lo dice); el modo «archivo» que abarata la foto
vieja un 30% es una función del proveedor de nube. Sin bucket no hay tier de archivo, y borrar no es
opción (Pregunta 14: **archivar, nunca borrar**).

**Depende de:** mudar `store()`/`streamOf()` a S3/R2 — la firma y el hash no cambian, está previsto.

Cuando exista: un job mensual que marca `field_evidences` con más de N meses y les cambia la clase de
almacenamiento. **N sale del plan** (6 / 24 / 60 / 120 meses).

---

### L6 · Sucursales · **3 a 5 días — es un módulo, no un límite**

La tabla `branches` existe con sus relaciones (`credits`, `cases`, `route_plans`, `user_accounts` ya
apuntan a ella). Falta **todo el producto**: alta, edición, asignar gente, filtrar por sucursal en
las pantallas que ya tienen el campo.

**Recomendación: sacar «sucursales» de la grilla comercial hasta que esto exista.** Prometerle «hasta
3 sucursales» a un cliente que no puede crear ninguna es la forma más rápida de perder al primer
BUSINESS, que es justo el que la va a pedir. El tope en sí es media hora **después** del módulo.

---

## 7. Lo que hay que decidir antes de arrancar

| # | Pregunta | Bloquea | Sugerencia |
|---|---|---|---|
| **34** | ✅ **Respondida (20/08):** el plan **se elige al crear la cuenta**, con tarjetas | — | Los pagos entran como **prueba de 30 días** del plan elegido y caen a FREE (§L0.5) |
| **34a** | ✅ **Resuelta:** la prueba dura **30 días** (`TRIAL_DAYS` en shared) | — | Un ciclo de cobranza completo: alcanza para ver el producto trabajar |
| **34b** | ✅ **Resuelta:** ENTERPRISE **no es elegible**; se muestra al pie y se contesta hablando | — | Falta la casilla de contacto: hoy la tarjeta dice «escribinos» sin dirección, porque el producto no tiene ninguna configurada |
| **32** | La excepción negociada, ¿vale para todos los topes o sólo usuarios? | L0 *(barato)* | Todos: es la misma columna |
| **11a** | «Gestión» ¿es sólo la visita a domicilio, o también la llamada? | L2 | Sólo la visita (`field_visits`). Es lo que genera fotos y lo que se puede contar sin discutir |
| **12b** *(nueva)* | ¿La foto del comprobante de pago y la de perfil cuentan contra el tope de fotos? | L2 | No. Se vende la evidencia de campo; contar un cambio de avatar como «foto» es indefendible |
| **8/9** | ✅ Respondidas | — | créditos, con `PAID`/`WRITTEN_OFF`/`CANCELLED` fuera |
| **10** | ✅ Respondida | — | rechazar el archivo entero, avisando en la vista previa |
| **15** | ¿Sucursales entran ahora? | L6 | Sacarlas de la grilla hasta que exista el módulo |
| **19/20/21** | Cuentas FREE: ¿cuántas por empresa? ¿dormidas? ¿marca de agua? | L4 | Una por NIT y por correo · aviso a los 6 meses, sólo lectura a los 9 · sí a la marca |

**Sólo la 34 bloquea de verdad.** Las demás se pueden contestar mientras se construye la fase
anterior.

---

## 8. Orden, costo y qué se puede cortar

| Fase | Qué entrega | Costo | ¿Se puede cortar? |
|---|---|---|---|
| **L0** | El plan manda. Sin esto no hay nada | **1 d** | No |
| **L0.5** | ✅ Elegir plan al registrarse, con tarjetas | **hecho** | — |
| **L1** | El freno que sostiene el precio | **1,5 d** | No — es el tope que empuja a pagar |
| **L2** | Los avisos del 80% | **1 d** | Sí, se puede posponer: no bloquea nada por diseño |
| **L3** | La palanca sin SQL a mano | **0,5 d** | Sí, mientras haya pocos clientes |
| **L4** | Prueba, caída al FREE, dormidas | **1 d** | Parcialmente: la caída al FREE conviene tenerla antes del primer cliente que deje de pagar |
| | **Subtotal vendible** | **6 días** | |
| **L5** | Retención de fotos | 1 d | Bloqueada por S3/R2 |
| **L6** | Sucursales | 3–5 d | Es otro producto |

**Camino corto para poder cobrar: L0.5 (hecho) + L0 + L1 = 2,5 días de acá en adelante.** Con eso el
cliente **elige su plan al entrar**, FREE y PROFESSIONAL son planes de verdad, y la diferencia entre
uno y otro se siente en la primera semana — que es exactamente lo que busca la grilla.

---

## 9. Cómo se verifica cada fase

```powershell
pnpm --filter @kobrax/shared build      # ⚠️ y reiniciar el dev de la web si estaba levantado
pnpm --filter @kobrax/shared test
pnpm --filter @kobrax/api type-check
pnpm --filter @kobrax/api test          # ⚠️ los spec se listan A MANO en package.json
pnpm --filter @kobrax/web type-check
pnpm --filter @kobrax/web test
pnpm --filter @kobrax/mobile type-check
pnpm --filter @kobrax/mobile test
```

Más un **smoke real por fase** contra la base de desarrollo (el patrón que destapó los defectos que
los tests no vieron en Rutas y en Import): crear una cuenta FREE, llegar al tope de créditos con el
alta y con un archivo, y comprobar que la web, el móvil y el import dicen lo mismo.

---

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| `DROP COLUMN max_users` con una versión vieja del API corriendo | Partir en dos despliegues si hay algún ambiente sin actualizar |
| Contar créditos en cada alta sobre una cartera de 200.000 | Índice parcial (§3.3). Un `count` indexado por tenant es submilisegundo; se mide antes de dar por buena la fase |
| El contador mensual en huso del servidor | `TenantClockService`, que ya existe por el mismo bug en la agenda |
| Un alta rechazada envenena la cola del móvil | §4: lo encolado nunca se rechaza por tope |
| Vender lo que no existe (sucursales, retención) | Sacarlos de la grilla hasta L5/L6 |
| **Regalar un plan pago desde el registro público** | Lista blanca en el DTO + prueba de 30 días que **cae sola** a FREE. ENTERPRISE no es elegible (§L0.5) |
