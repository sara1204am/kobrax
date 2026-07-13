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

### D1. Un crédito, dos formas de nacer — **cronograma** o **snapshot**
Es la decisión estructural del módulo, y sale directo de la respuesta a "préstamo abierto":

| | **GENERATED** (cronograma) | **SNAPSHOT** (foto del estado) |
|---|---|---|
| Origen | Cobrador independiente: pacta capital, cuotas y fechas | Empresa: PDF escaneado / API pobre / archivo. **Solo se conoce saldo, cuota, mora y próxima fecha** |
| `credit_installments` | Se generan (`buildSchedule`) | **No existen** |
| Próxima fecha | Derivada: `min(dueDate)` de cuotas no pagadas | Dato de la fuente → `metadata.nextDueDate` |
| Cuota | Derivada: `installments[0].amount` | Dato de la fuente → `metadata.installmentAmount` |
| Mora (`daysPastDue`) | La calcula el backend (`computeArrears`) | **Manda el valor de la fuente**; el backend **no** la recalcula |
| Editable en el móvil | Sí (es del cobrador) | **No** los campos financieros (candado + "Sincronizado desde archivo") |

`hasSchedule = installments.length > 0` — **no hace falta una columna nueva** para distinguirlos.
Los Modos A/B/C del PDF §4 son: A y B → GENERATED · C → SNAPSHOT.

### D2. Los dos modos de captura entran **sin tocar la matemática del backend**
`buildSchedule` con `type: 'FLAT'` ya calcula `cuota = capital/n + capital × i`, que es **literalmente** la
fórmula "% por período" del PDF §4.2. Las tres formas de capturar convergen en `interestRate` (tasa por
período, fracción) antes de llegar a la API:

| Modo | Lo que tipea el usuario | Conversión (en `packages/shared`) |
|---|---|---|
| B — "% por período" | capital, i%, n | `interestRate = i / 100` |
| B — "% total" | capital, i% total, n | `interestRate = i / (100 × n)` |
| A — cuota directa | capital, cuota, n | `interestRate = (cuota − capital/n) / capital` |

El panel "Cuota / Total a cobrar / Ganancia" del PDF se calcula con esa misma función pura, en vivo, en el móvil.
**Cero código financiero nuevo en la API.**

### D3. Cuota editable / redondeo → **diferido**
El PDF permite redondear la cuota calculada antes de guardar. `scheduleIsBalanced` rechazaría un cronograma
cuya cuota no se derive del capital+tasa. Redondear implica pasar `installmentAmount` explícito a
`buildSchedule`. **MVP: la cuota es la que sale de la fórmula.** Se levanta si molesta en campo.
Corolario: **Modo A exige `cuota × n ≥ capital`** (si no, la tasa da negativa y el DTO la rechaza).
El PDF lo quería como advertencia no bloqueante; acá bloquea. Deuda marcada.

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

### D6. La cartera se agrupa **en el móvil**, no hay endpoint nuevo
V3 pide "una lista centrada en el cliente, con la deuda agregada". `GET /api/cases` ya devuelve
`clientName`, `amount`, `currency`, `daysPastDue`, `isOverdue` **y ya está acotado al cobrador**
(`assigneeId = userId` sin `case:assign`). La cartera del cobrador = sus casos, agrupados por `clientId`
en el cliente. El propio PDF dice que "cabe en memoria".
`ponytail:` techo conocido — la paginación de casos rompe el agrupado más allá de una página (~100).
Upgrade: `GET /api/portfolio` con agregación server-side, cuando un tenant real lo pida.

---

## Contrato real (auditado contra el código, 2026-07-12)

### Ya existe — se reusa tal cual
| Capacidad | Dónde |
|---|---|
| Alta de cliente + duplicados por documento | `POST /api/clients`, `GET /api/clients?q=` (blind index sobre `nationalIdHash` + ILIKE nombre) |
| Teléfonos y direcciones del cliente | `POST /api/clients/:id/contacts` · `/locations` (`client_contacts` / `client_locations`, con `photoUrls`) |
| Adjuntos del cliente (foto de fachada) | `POST /api/clients/:id/attachments` (`client_attachments` ya tiene `fileUrl` + `fileHash`) |
| **SHA-256 sobre el buffer original** | `field-ops/field-integrity.ts` → `sha256OfBase64()` (ya testeado) |
| Alta de préstamo + cronograma | `POST /api/credits` (`buildSchedule` FLAT/FRENCH, `scheduleIsBalanced`) |
| Mora | `POST /api/credits/:id/recalculate-arrears` (`computeArrears`) |
| Lista/detalle de casos, ya scoped al cobrador | `GET /api/cases`, `GET /api/cases/:id` (trae `activities`) |
| Registrar gestión | `POST /api/cases/:id/activities` |
| **Registrar pago** (idempotente, aplica a cuotas → saldo → mora, marca PAID) | `POST /api/payments` + header `Idempotency-Key` |
| PII en claro para el cobrador (teléfonos/direcciones) con audit `PII_REVEAL` | `GET /api/agenda/clients/:clientId/context` |
| Enmascarado de PII por defecto (`777****`) | `clients.serializer.ts` |
| Multi-tenant + RLS + audit + `{data,meta,error}` | `PrismaService.withTenant` · `AuditService` · `ResponseDto` |

### No existe — lo construye [00-fundacion.md](./00-fundacion.md)
1. `Credit.metadata` (JSONB) — no hay dónde guardar frecuencia, origen, cuota/próxima fecha del snapshot.
2. **Frecuencia** de pago — `buildSchedule` es **mensual hardcodeado** (`addMonths`). Sin diario/semanal/quincenal no hay gota a gota.
3. **Modo SNAPSHOT** — `installmentsCount` es obligatorio y siempre se genera cronograma.
4. **"Ya está en curso"** — `CreateCreditDto` no acepta `outstandingBalance` ni `daysPastDue`.
5. **Caso automático** al crear el préstamo (PDF §5.2) — hoy hay que llamar a `POST /cases` aparte.
6. **Búsqueda en la cartera** — `GET /cases` no tiene `q`, y el serializer no expone cuota ni próxima fecha.
7. **Permisos de alta** para el COLLECTOR.
8. **Subida de archivos** — `POST /api/uploads` (no existe nada) + foto del comprobante en `Payment`.

## Auditoría de reuso — móvil
| Capacidad | Decisión | Path |
|---|---|---|
| Red, envelope, offline, refresh 401 | REUSAR | `src/api.ts` (`apiQuery`/`apiMutate`/`toQuery`) |
| Chrome, badges, vacíos, hojas, tabs de filtro | REUSAR | `src/ui.tsx` (`Header`, `StatusBadge`, `EmptyState`, `BottomSheet`, `SegmentTabs`, `SectionLabel`, `StatTile`) |
| Botones e inputs de texto | REUSAR | `src/components.tsx` (`Button`, `Field`, `ErrorBanner`) |
| **Formato de moneda `money()`** | **REUSAR** (ya existe) | `src/agenda-form.ts` — *no escribir otro*; si se comparte, se **mueve** a shared |
| **Tarjeta de deudor** | **EXTENDER** (ya existe) | `src/ui.tsx` → `CaseCard` (`name`/`subtitle`/`amount`/`status`/`overdue`). Se le agrega el contador "2 préstamos" del PDF §5.3 — *no un `ClientCard` nuevo* |
| Selector + hoja de opciones + multilínea + chips | **SUBIR a `ui.tsx`** | hoy locales en `app/agenda/crear.tsx` (`SelectRow`, `PickerSheet`, `Multiline`), ya marcados en el código como pendientes de subir |
| Fecha | REUSAR | `@react-native-community/datetimepicker` (instalado) |
| GPS de un toque | REUSAR | `expo-location` (instalado) |
| Lógica de formulario pura + reducer, testeada sin red | REUSAR patrón | `src/agenda-form.ts` + `src/agenda-form.test.ts` |
| Tokens | REUSAR | `src/theme.ts` (`COLORS`/`TYPE`/`SPACING`/`RADIUS`) — nada hardcodeado |
| `AmountInput` (monto con moneda, teclado numérico) | **NUEVO** en `src/ui.tsx` | hoy es un `TextInput` crudo con `decimal-pad` duplicado en agenda; lo usan V2 y el pago de V4 (≥2 usos) |
| Cámara/galería | **NUEVO (dep)** | `expo-image-picker` — funciona en Expo Go |
| Estado derivado de cartera (AL DÍA/POR VENCER/EN MORA/PROMESA/PAGADO) + conversión cuota↔tasa | **NUEVO** en `packages/shared` | regla única, la usan API y móvil |

## Reglas de fase
Las 3 del epic §3.3 + **multi-tenant por capacidad** (nunca por `accountType`) + **offline-first**: la acción
nunca se bloquea (la cola real de escritura es P6) + **TS estricto sin `any`** + `{data,meta,error}` +
**audit en toda mutación** + **evidencia inmutable**: hash SHA-256 sobre el **buffer original** al registrar
(no sobre el archivo recomprimido) + enums y utilidades de dominio **siempre** en `packages/shared`.

## Gate
Cada plan de pantalla pasa **`/f10-validar-plan <path>`** antes de tocar código. Ítem 4 (node-id Figma) **no
aplica**: no hay diseño. Lo sustituye la **parity con las pantallas de Agenda ya construidas** (mismos
componentes, mismos tokens, mismo esqueleto loading/offline/error/empty).
