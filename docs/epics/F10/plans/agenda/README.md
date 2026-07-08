# Módulo AGENDA — índice

> **Enfoque: un plan por pantalla, cada uno un slice vertical FUNCIONAL** (backend que necesita +
> pantalla + seed/tests). Se construye, verifica y valida una pantalla antes de la siguiente.
> Reemplaza la parte "Agenda" de [../P1-home-agenda.md](../P1-home-agenda.md).

## Documentos
- **[DOMAIN.md](./DOMAIN.md)** — modelo de dominio objetivo (toda la spec) + decisiones de almacenamiento.
- **[00-fundacion.md](./00-fundacion.md)** — backend base (catálogos + `agenda_items` + enums + seed). **Va primero.**

## Planes por pantalla (build por CAPAS — núcleo funcional primero)
Diseño Figma "Kobrax movil" · fileKey `daLWsKQGC4Sd1NacU9fmrP` · sección `81:4`.
**Figma = guía VISUAL; los datos van al nuevo `agenda_items`** (los endpoints del `ui-screen-map` para
estas filas están superados por este módulo).

| # | Pantalla | Figma node-id | Archivo | Capa | Estado |
|---|---|---|---|---|---|
| — | Fundación backend (catálogos + agenda_items) | (sin pantalla) | [00-fundacion.md](./00-fundacion.md) | núcleo | 🟡 EN CURSO |
| S1 | **Principal** (calendario + secciones) | `64:4` | [main.md](./main.md) | núcleo | ⬜ |
| S2 | Crear agendado (5 tipos) | `65:724` Llamada · `65:828` Visita · `65:938` WhatsApp · `65:1047` Recordatorio · `65:1150` Promesa | `crear.md` | núcleo | ⬜ |
| S3 | Ver agendado (detalle) | `64:425` | `ver.md` | núcleo | ⬜ |
| S4 | Registrar acción (ejecutar) | `66:1763` · `66:2195` · `66:2440` · `66:2531` | `registrar-accion.md` | núcleo | ⬜ |
| S5 | Editar | (reusa `crear`) | `editar.md` | núcleo | ⬜ |
| S6 | Eliminar / cancelar / reagendar | (reusa `ver`) | `eliminar.md` | núcleo | ⬜ |
| + | Plantillas WhatsApp, evidencias visita, lapso/rango horario, adjuntos, campañas, ABM de catálogos | — | (slices) | extras | ⬜ diferido |

Cada archivo se crea **just-in-time** al llegar a esa pantalla (no todos de una).

## Gate de validación (por pantalla, antes de construir)
Cada plan de pantalla pasa **`/f10-validar-plan`** antes de tocar código. Ese gate exige (y verifica):
- **Reuso de shared**: no redefinir enums/tipos/utils que ya viven en `packages/shared` (ítem 12).
- **Parity de tokens**: colores/tipografía desde `src/theme.ts` (espejo de shared), nada hardcodeado (no-negociable, ítem 14).
- Node-id Figma real y confirmado (ítem 4), contrato real (ítem 5), tabla de reuso Paso B (ítem 6), economía Figma (ítem 17).
- El enforcement en **código** (usar tokens, reusar `ui.tsx`, no duplicar) lo cierran `/code-review` + `/ponytail-review` al terminar cada pantalla.
> Nota: los planes viven en `plans/agenda/` (no `plans/PN-*.md`); al validar se pasa el **path** del archivo a `/f10-validar-plan`.

## Decisiones (2026-07-08)
1. **Por capas**: modelo completo = objetivo (DOMAIN.md); se construye núcleo funcional primero, extras después.
2. **Campos por tipo** = JSONB `details` validado en shared (no tablas por tipo).
3. **Catálogos configurables por tenant YA** = tabla genérica `catalog_items` (los 11) + seed + ABM por endpoint; ABM visual = después.
4. Empezar limpio en el dominio agenda (no hay nada construido salvo docs + UI descartable). Login/Home/P0 se quedan.

## Objetivo del módulo
El cobrador abre **Agenda** y ve su **día**: qué tiene **agendado** (llamada, visita, WhatsApp,
recordatorio, promesa de pago), qué **completó** y qué quedó **vencido**. Navega por fechas
(tira infinita + calendario) y puede crear/ver/registrar/editar/eliminar un agendado.

## Modelo de datos (NUEVO — decidido)
**Tabla `agenda_items`** (multi-tenant + RLS + audit + soft-delete):
| Campo | Tipo | Nota |
|---|---|---|
| `id` | uuid | |
| `accountId` | uuid | tenant (RLS) |
| `caseId` | uuid FK → collection_cases | **siempre atado a un caso/deudor** |
| `clientId` | uuid | denormalizado para pintar sin join extra |
| `assigneeId` | uuid | cobrador (users.id) |
| `type` | `AgendaItemType` | **CALL · VISIT · WHATSAPP · REMINDER · PROMISE_TO_PAY** (enum nuevo) |
| `scheduledFor` | DateTime | fecha (día obligatorio, hora opcional) |
| `status` | `AgendaItemStatus` | **PENDING · DONE · CANCELLED** |
| `notes` | String? | |
| `resultActivityId` | uuid? | `case_activities.id` creado al completar |
| `createdAt/updatedAt/deletedAt` | | soft-delete para "eliminar" |

- Enums nuevos en `packages/shared` (fuente única) + Prisma.
- **Vencido = derivado**: `status=PENDING && scheduledFor < inicio de hoy` (no es un status).
- RLS + audit + **scope por capacidad** (cobrador solo ve/gestiona SUS agendados) como el resto.

## Endpoints (se construyen por pantalla, no todos de una)
- `GET /api/agenda?date=YYYY-MM-DD` · `GET /api/agenda/overdue?limit=` → **S1**
- `POST /api/agenda` → **S2** · `GET /api/agenda/:id` → **S3**
- `POST /api/agenda/:id/complete` → **S4** · `PATCH /api/agenda/:id` → **S5** · `DELETE /api/agenda/:id` → **S6**

## Estado actual del móvil (lo que YA existe)
Auth/login/MFA/biometría ✅ · Fundación P0 (`api-client`/`net`/`OfflineIndicator`) ✅ ·
Shell de 5 tabs ✅ · **Home funcional** ✅ · `ui.tsx` (Header, StatusBadge, ListRow, EmptyState,
BottomSheet, StatTile, SegmentTabs, SectionLabel) ✅ · servicios `cases/routes/notifications` ✅ ·
enriquecimiento + scope por capacidad en backend ✅.

## Reorden / limpieza (al arrancar S1)
**Se borra** (era otra cosa): `app/(tabs)/agenda.tsx` (lista de casos read-only) y `app/nueva-gestion.tsx` (scaffold).
**Se conserva** todo lo de "estado actual" + `cases.service.ts` (lo usa Home y luego Cobranza).

## Reuso transversal
`apiQuery`/`toQuery` (fetch+meta) · `Header`/`EmptyState`/`StatusBadge`/`SectionLabel`/`BottomSheet` de `ui.tsx` ·
utils moneda/fecha de shared · enums SIEMPRE en shared. Nuevos: `agenda.service.ts`, `AgendaCard`,
`WeekStrip`, `agendaTypeMeta` (ícono/label/tono por tipo), y `@react-native-community/datetimepicker` (dep nueva, picker meses/años).

## Reglas de fase
Las 3 del epic §3.3 + offline-first (nunca bloquear; cola real de escritura = P6) + multi-tenant por
capacidad + TS estricto + `{data,meta,error}`.
