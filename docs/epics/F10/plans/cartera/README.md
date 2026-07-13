# Módulo CARTERA (Clientes y Préstamos) — índice

> **Fuente:** [`docs/flows/Cliente_Prestamo.pdf`](../../../../flows/Cliente_Prestamo.pdf) — spec funcional V1–V5.
> **Sin Figma.** Esta sección no tiene diseño: se construye **calcando el lenguaje visual ya construido**
> (tokens de `src/theme.ts`, componentes de `src/ui.tsx`, patrones de las pantallas de Agenda).
> **Enfoque igual que Agenda:** un plan por pantalla, cada uno un slice vertical funcional
> (backend que necesita + pantalla + seed/tests). Se construye, verifica y valida una antes de la siguiente.
> **Build: 🟢** — todo el módulo corre en **Expo Go**. No cruza la frontera del dev build.

## Documentos
- **[00-fundacion.md](./00-fundacion.md)** — deltas de backend que la spec exige y hoy no existen. **Va primero.**
- Planes por pantalla: se crean **just-in-time** al llegar a cada una.

## Qué reemplaza / absorbe
Este módulo **absorbe P2 (gestiones) y P4 (pagos)** del [BUILD-PLAN](../../BUILD-PLAN.md) §1: la ficha de
cobranza (V4) *es* la pantalla de gestión y de pago. No se construyen por separado.
Reemplaza el placeholder de `app/(tabs)/cobranza.tsx`.

## Slices (orden de construcción)

| # | Vista PDF | Pantalla | Ruta móvil | Estado |
|---|---|---|---|---|
| — | — | Fundación backend (incluye subida de archivos) | (sin pantalla) | ⬜ |
| S1 | **V3** | Lista de cartera (buscador + chips + tarjetas) | `app/(tabs)/cobranza.tsx` | ⬜ |
| S2 | **V1 + V2** | Alta: cliente → préstamo (flujo continuo, con foto de fachada) | `app/cliente/nuevo.tsx` → `app/prestamo/nuevo.tsx` | ⬜ |
| S3 | **V4** | Ficha de cobranza (detalle + pago con comprobante + gestión) | `app/cliente/[id].tsx` | ⬜ |
| — | **V5** | Importación CSV/XLSX | — | ⛔ **fuera de alcance móvil** |

**Orden:** leer antes de escribir (S1 sobre el seed), después el alta (S2, lo que hace funcional al cobrador
independiente), y al final la ficha (S3, el slice más grande — subsume gestiones y pagos).

**V5 (import) queda fuera:** el [BUILD-PLAN §4](../../BUILD-PLAN.md) ya la declara **gap de la web admin**,
no del móvil. El endpoint `POST /api/clients/imports` ya existe; falta la UI, y es web. El **contrato de
columnas** del PDF §4.3 (Banco Unión) sí se respeta acá, porque define cómo nace un crédito **importado**
— que el móvil debe saber pintar y **no** dejar editar.

---

## Decisiones (2026-07-12)

### D1. El crédito del móvil **no tiene cronograma** — la cuota es un valor congelado
Decisión estructural, y sale directo del PDF (§4.1, §4.2, §7, §8), que **en ningún momento pide generar un
plan de cuotas**. Los tres modos mandan sus campos operativos a `credit.metadata`:
`installment_amount`, `frequency`, `next_due_date`, `origin`, `external_ref`, `notes` (§7 lo dice literal).
La cuota calculada **"se congela como valor fijo"** y el "motor de amortización vivo" está **descartado en
§8**, porque "la app es de cobranza, no core financiero".

Dos razones más lo cierran:
- **Modo A permite préstamo abierto**: "Número de cuotas — *No* obligatorio. Vacío = préstamo
  abierto/renovable" (§4.1). Sin `n` **no existe cronograma posible**. No es un caso borde: es el préstamo
  informal recurrente, el corazón del segmento.
- El Modo C importado tampoco trae cuotas.

| | **Crédito del móvil** (A · B · C) | **Crédito con cronograma** (legacy: web / core) |
|---|---|---|
| `credit_installments` | **No existen** | Se generan (`buildSchedule`) — **no se toca** |
| Cuota | `metadata.installmentAmount` (congelada) | `installments[0].amount` |
| Próxima fecha | `metadata.nextDueDate` (avanza un período al cubrirse la cuota) | `min(dueDate)` de cuotas no pagadas |
| Mora | Días desde `nextDueDate` si hay saldo. En cartera **importada manda el archivo** (§6) | `computeArrears` |
| Editable | Sí, salvo `origin != 'manual'` → candado (§3, §4.3) | — |

`hasSchedule = installments.length > 0` distingue a los dos — **sin columna nueva**, como ya decía el plan.

> **Consecuencia crítica:** con esta decisión, **todo** crédito nacido en el móvil tiene cero cuotas. Los
> bugs R1 y R2 (§7) dejan de ser un caso borde de la cartera importada y pasan a ser **el camino principal**.
> Arreglarlos no es opcional: es la fundación.

**Lo que esta decisión BORRA del plan anterior** (tres deltas que ya no hacen falta):
- ~~Parametrizar `buildSchedule` con `frequency`~~ → `buildSchedule` **no se toca**. La frecuencia solo sirve
  para avanzar `nextDueDate` un período: una función `addPeriods()` pura.
- ~~La dualidad `scheduleMode: GENERATED | SNAPSHOT`~~ → hay una sola forma de nacer desde el móvil.
- ~~La conversión cuota → `interestRate` para alimentar `buildSchedule`~~ → ver D2.

### D2. La matemática del PDF vive **entera en el móvil**, en una función pura de shared
El panel en vivo "Cuota / Total a cobrar / Ganancia" (§4.2) se calcula antes de guardar; lo que viaja a la
API es **la cuota ya congelada**. Las fórmulas son las del PDF, tal cual, sin motor financiero:

| Base (§4.2) | Fórmula |
|---|---|
| **% por período** (default — "la convención dominante en cobro informal") | `cuota = capital/n + capital × i/100` · `total = cuota × n` |
| **% total** | `total = capital × (1 + i/100)` · `cuota = total / n` |
| **Modo A — cuota directa** | el usuario la tipea; no hay cálculo |

`interestRate` (la columna que ya existe) se guarda **informativa**, igual que en el Modo C importado
("Tasa Interés — Informativo en ficha; **no recalcula cuota**", §4.3). **Cero código financiero nuevo en la
API**, y esta vez de verdad: la API ni siquiera recibe una tasa derivada.

### D3. La cuota **es editable** (redondeo) y `cuota × n < capital` es una **advertencia, no un bloqueo**
Ambas cosas las pide el PDF explícitamente: "La cuota es editable tras el cálculo (para redondeo) y al
editarla se recalcula el total" (§5.2) y "advertencia **no bloqueante** si el total a cobrar fuera menor que
el capital" (§5.2, validaciones). El plan anterior las difería porque `scheduleIsBalanced` rechazaba un
cronograma cuya cuota no se derivara del capital+tasa — pero con **D1 no hay cronograma que balancear**, así
que el obstáculo desapareció. La cuota redondeada se guarda literal en `metadata.installmentAmount`.
**Sale gratis. Entra.**

### D4. Permisos: se habilita el alta, **sin gating por tenant**
`COLLECTOR` no tiene hoy `client:write` ni `credit:write` → no puede dar de alta nada. Se agregan al seed.
La **matriz por tipo de tenant** del PDF §3 (import-only en ENTERPRISE, alta manual solo en STARTER/PRO)
**no se construye acá**: `Account` ya tiene `accountType` y `planCode`, y el gating es la etapa
**P10-rbac-gating** del BUILD-PLAN. Multi-tenant en este módulo = **por capacidad** (`can(permission)`),
nunca por `accountType`.

### D5. Fotos: **entran ahora** (fachada + comprobante) — confirmado por la usuaria (2026-07-12)
Corrige una advertencia errónea mía: `expo-image-picker` **funciona en Expo Go**, cámara incluida.
Las fotos **no** obligan al dev build. El costo real es otro: **no existe subida de archivos en el sistema**
(`field-ops` recibe una `fileUrl` ya existente y el base64 solo para verificar; no hay multer ni cliente S3).
→ La fundación construye un slice de **almacenamiento** (`POST /api/uploads`), que es el primitivo que
**P8-evidencia reusará** para foto+GPS+firma de las visitas.
El hash **no se inventa**: `sha256OfBase64()` ya existe y está testeado en
`apps/api/src/modules/field-ops/field-integrity.ts`.

### D6. La cartera se agrupa y se busca **en el móvil**, no hay endpoint nuevo
V3 pide "una lista centrada en el cliente, con la deuda agregada" y **"búsqueda local instantánea (la cartera
de un cobrador cabe en memoria)"** (§5.3). `GET /api/cases` ya devuelve `clientName`, `amount`, `currency`,
`daysPastDue`, `isOverdue` **y ya está acotado al cobrador** (`assigneeId = userId` sin `case:assign`).
La cartera del cobrador = sus casos, agrupados por `clientId` en el cliente; el buscador filtra ese array.
→ **Se cae el delta del `q` server-side** que el plan anterior pedía: el PDF no lo necesita, y `GET /cases`
se queda como está.
`ponytail:` techo conocido — la paginación de casos rompe el agrupado y la búsqueda más allá de una página
(~100). Upgrade: `GET /api/portfolio` con agregación server-side, cuando un tenant real lo pida.

**Abierto (para S1):** el §5.3 quiere buscar también **por teléfono**, pero los teléfonos salen enmascarados
(`777****`) salvo por el endpoint auditado de agenda. Buscar por teléfono en memoria exigiría traerlos en
claro a la lista, lo que choca con P6 del PDF (tokenización por permiso). → S1 arranca con nombre + documento;
el teléfono se decide ahí.

### D7. Lo que el PDF pide y **queda fuera** de este módulo (diferido explícito)
- **Vocabulario configurable por tenant** (P5: `credit_configuration`, "Capital" vs "Monto financiado") →
  no entra. Etiquetas fijas en es-LatAm. Se levanta cuando un tenant real lo pida.
- **Job diario de mora** (§6) → hoy la mora se recalcula al registrar un pago y por el endpoint
  `recalculate-arrears`. El cron es infraestructura, no F10 móvil.
- **Evento automático en el historial al tocar Llamar/WhatsApp/Navegar** (§5.4, §7) → es una `CaseActivity`
  por tap; entra en **S3** (la ficha), no en la fundación.
- **Sistema francés** (§4.2) → el propio PDF lo descarta para el MVP.
- **Importación V5** (§5.5) → web, fuera de F10 móvil. El contrato de columnas del §4.3 sí se respeta acá.
- **Diccionario de estados por tenant** (VIGENTE→active, §4.3) → es del importador, o sea web.

---

## Contrato real (auditado contra el código, 2026-07-12)

### Ya existe — se reusa tal cual
| Capacidad | Dónde |
|---|---|
| Alta de cliente + duplicados por documento | `POST /api/clients`, `GET /api/clients?q=` (blind index sobre `nationalIdHash` + ILIKE nombre) |
| Teléfonos y direcciones del cliente | `POST /api/clients/:id/contacts` · `/locations` (`client_contacts` / `client_locations`, con `photoUrls`) |
| Adjuntos del cliente (foto de fachada) | `POST /api/clients/:id/attachments` (`client_attachments` ya tiene `fileUrl` + `fileHash`) |
| **SHA-256 sobre el buffer original** | `field-ops/field-integrity.ts` → `sha256OfBase64()` (ya testeado) |
| Alta de préstamo | `POST /api/credits` (se **extiende**; `buildSchedule`/`scheduleIsBalanced` quedan intactos para la web) |
| Mora | `POST /api/credits/:id/recalculate-arrears` (`computeArrears`) — **con la guarda de R1** |
| `Client.metadata` (JSONB) para `origin` | `schema.prisma:488` — **ya existe** |
| Lista/detalle de casos, ya scoped al cobrador | `GET /api/cases`, `GET /api/cases/:id` (trae `activities`) |
| Registrar gestión | `POST /api/cases/:id/activities` |
| **Registrar pago** (idempotente, aplica a cuotas → saldo → mora, marca PAID) | `POST /api/payments` + header `Idempotency-Key` |
| PII en claro para el cobrador (teléfonos/direcciones) con audit `PII_REVEAL` | `GET /api/agenda/clients/:clientId/context` |
| Enmascarado de PII por defecto (`777****`) | `clients.serializer.ts` |
| Multi-tenant + RLS + audit + `{data,meta,error}` | `PrismaService.withTenant` · `AuditService` · `ResponseDto` |

### No existe — lo construye [00-fundacion.md](./00-fundacion.md)
1. `Credit.metadata` (JSONB) — no hay dónde guardar cuota, frecuencia, próxima fecha, origen, nota.
   (`Client.metadata` **ya existe** — `schema.prisma:488` — así que el `client.metadata.origin` del §3 sale gratis.)
2. **Crédito sin cronograma** — `installmentsCount` es obligatorio (`credit.dto.ts:29`) y `create` **siempre**
   genera cuotas. El préstamo abierto del §4.1 hoy es inexpresable.
3. 🔴 **Un pago sobre un crédito sin cuotas no descuenta la deuda** — bug confirmado, no un riesgo teórico.
   Es el camino principal después de D1. Ver R2 en [00-fundacion §7](./00-fundacion.md#7-riesgos--decisiones-abiertas).
4. 🔴 **La mora se pisa con 0** en dos lugares distintos cuando el crédito no tiene cuotas — viola el §6
   del PDF ("en cartera importada prevalece el valor del archivo"). Ver R1.
5. **"Ya está en curso"** (§4.1) — `CreateCreditDto` no acepta `outstandingBalance` ni `daysPastDue`.
6. **Caso automático** al crear el préstamo (§5.2) — hoy hay que llamar a `POST /cases` aparte.
7. **Cuota y próxima fecha en la lista** — `serializeCase` solo expone saldo, moneda y mora
   (`cases.serializer.ts:48-50`); la tarjeta del §5.3 necesita "Cuota Bs 300 · vence 15 jul" y el `origin`
   para el candado. **No hace falta un `q` server-side**: el §5.3 pide **búsqueda local en memoria**.
8. **Permisos de alta** para el COLLECTOR (`client:write`, `credit:write` — hoy no los tiene, `seed.ts:114`).
9. **Subida de archivos** — `POST /api/uploads` (no existe nada) + foto del comprobante en `Payment`.

## Auditoría de reuso — móvil
| Capacidad | Decisión | Path |
|---|---|---|
| Red, envelope, offline, refresh 401 | REUSAR | **`src/api-client.ts`** (`apiQuery`/`apiMutate`/`toQuery`). *(`src/api.ts` es la capa de fetch cruda que aquél consume — no se usa directo.)* |
| Chrome, badges, vacíos, hojas, tabs de filtro | REUSAR | `src/ui.tsx` (`Header`, `StatusBadge`, `EmptyState`, `BottomSheet`, `SegmentTabs`, `SectionLabel`, `StatTile`) |
| Inputs de texto y banner de error | REUSAR | `src/components.tsx` (`Field`, `ErrorBanner`) |
| **`Button`** | **EXTENDER** | `src/components.tsx:27` — hoy solo `primary \| ghost`. La ficha (§5.4) pide un secundario y el sheet de pago un destructivo → se agregan las variantes que falten, **no** se escribe otro botón |
| **Formato de moneda `money()`** | **REUSAR** (ya existe) | `src/agenda-form.ts:35` (wrapper de `formatCurrency` de shared) — *no escribir otro* |
| **Tarjeta de deudor** | **EXTENDER** (ya existe) | `src/ui.tsx` → `CaseCard` (`name`/`subtitle`/`amount`/`status`/`overdue`). Se le agrega el contador "2 préstamos" del PDF §5.3 — *no un `ClientCard` nuevo* |
| Selector + hoja de opciones + multilínea + chips | **SUBIR a `ui.tsx`** | hoy locales en `app/agenda/crear.tsx` (`SelectRow`:756, `Multiline`:793, `PickerSheet`:816 — solo este último tiene el comentario "sube a `ui.tsx`") |
| Fecha | REUSAR | `@react-native-community/datetimepicker` (instalado) |
| GPS de un toque | REUSAR | `expo-location` (instalado) |
| Lógica de formulario pura + reducer, testeada sin red | REUSAR patrón | `src/agenda-form.ts` + `src/agenda-form.test.ts` |
| Tokens | REUSAR | `src/theme.ts` (`COLORS`/`TYPE`/`SPACING`/`RADIUS`) — nada hardcodeado |
| `AmountInput` (monto con moneda, teclado numérico) | **NUEVO** en `src/ui.tsx` | hoy es un `TextInput` crudo con `decimal-pad` duplicado en agenda; lo usan V2 y el pago de V4 (≥2 usos) |
| Cámara/galería | **NUEVO (dep)** | `expo-image-picker` — funciona en Expo Go |
| **Cálculo de cuota/total/ganancia** (las 2 bases del §4.2) | **NUEVO** en `packages/shared` | función pura; el panel en vivo del móvil la usa en cada tecla. La API **no** la necesita (D2) |
| **Estado derivado de cartera** (AL DÍA · POR VENCER · EN MORA · PROMESA · PAGADO, §5.3) | **NUEVO** en `packages/shared` | regla única — "los estados se calculan, nunca se editan". **Ojo `PROMESA`**: sale de una promesa vigente, que hoy vive en `agenda_items` (`type: PROMISE_TO_PAY`, `status: SCHEDULED`) — el caso no la conoce. Se resuelve en S1 |
| **`creditView(credit)`** (cuota/próxima fecha "derivá del cronograma o leé del metadata") | **NUEVO** en `packages/shared` | fuente única, la usan API (serializer) y móvil |

## Reglas de fase
Las 3 del epic §3.3 + **multi-tenant por capacidad** (nunca por `accountType`) + **offline-first**: la acción
nunca se bloquea (la cola real de escritura es P6) + **TS estricto sin `any`** + `{data,meta,error}` +
**audit en toda mutación** + **evidencia inmutable**: hash SHA-256 sobre el **buffer original** al registrar
(no sobre el archivo recomprimido) + enums y utilidades de dominio **siempre** en `packages/shared`.

## Gate
Cada plan de pantalla pasa **`/f10-validar-plan <path>`** antes de tocar código. Ítem 4 (node-id Figma) **no
aplica**: no hay diseño. Lo sustituye la **parity con las pantallas de Agenda ya construidas** (mismos
componentes, mismos tokens, mismo esqueleto loading/offline/error/empty).
