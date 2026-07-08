# Agenda · S1 — Pantalla principal

> **ESTADO: ✅ CONSTRUIDO (2026-07-08, rama `f10/agenda-fundacion`, commit 9abbb40).** Verde: mobile
> type-check + 53 jest + expo export. Pendiente: validación visual de la usuaria en dispositivo.
> Índice: [README.md](./README.md) · Modelo: [DOMAIN.md](./DOMAIN.md). **Depende de [00-fundacion.md](./00-fundacion.md)**
> (tabla `agenda_items` + catálogos + seed ya construidos). Acá solo: endpoints de lectura + pantalla.
> **Pantalla Figma:** Agenda Diaria `64:4` (guía visual; datos = `agenda_items`). **Build:** 🟢 Expo Go
> (⚠️ `@react-native-community/datetimepicker` — si no corre en Expo Go SDK 51, cae a dev build 🔵; verificar al instalar).
> Rama propuesta: `f10/agenda-main`.

## 1. Objetivo
Al entrar a **Agenda**, el cobrador ve su **día**: una **tira de calendario** (hoy centrado y marcado),
y debajo tres secciones — **Para hoy**, **Completados**, **Vencidos** — con los agendados del día
seleccionado. Solo **lectura + navegación** de fechas; crear/registrar/editar/eliminar son S2–S6.

## 2. Alcance
**SÍ:** endpoints de lectura `GET /agenda?date=` y `GET /agenda/overdue` (sobre las tablas que ya dejó
00-fundacion); pantalla principal con tira de calendario infinita + selector de mes/año + las 3 secciones
+ card de agendado.
**NO:** la tabla/enums/RLS/seed (son 00-fundacion); crear (S2), detalle (S3), completar (S4), editar (S5),
eliminar (S6). El FAB y el tap en una card **quedan cableados** a un placeholder hasta que exista su pantalla.

## 3. Backend (sobre la fundación — solo lectura acá)
> Tabla `agenda_items`, enums, catálogos, RLS y seed ya vienen de [00-fundacion.md](./00-fundacion.md).
1. **Endpoints de lectura (S1):**
   - `GET /api/agenda?date=YYYY-MM-DD` → agendados del día (rango `[00:00, 24:00)` de `scheduledDate`),
     **scope por capacidad** (cobrador → solo `assigneeId = yo`), enriquecido con **nombre de deudor**
     (join `client`), ordenado por hora asc. La separación por sección la hace el móvil con `status`.
   - `GET /api/agenda/overdue?limit=` → `status=SCHEDULED && scheduledDate < hoy`, **desc por fecha**,
     paginado (`meta.total` para el "ver más"). Mismo scope + enriquecimiento.
2. **Tests** (node:test): listar por día con scope por cobrador; overdue orden desc + límite; enriquecimiento
   (nombre); RLS (un cobrador no ve agendados de otro).

## 4. Móvil — pantalla principal
- **`agenda.service.ts`** (thin sobre `apiQuery`): `listByDay(dateISO)` y `listOverdue(limit)` con tipos
  verificados contra el serializer real.
- **Tira de calendario infinita** (header navy): `FlashList` horizontal paginado por semanas; **hoy
  centrado y marcado** al montar; tap en día → recarga la lista de ese día. Scroll a hoy con animación sutil (Reanimated, ya instalado).
- **Botón "abrir calendario"** → `@react-native-community/datetimepicker` (dep nueva) modo date con
  navegación **meses/años**; al elegir, la tira salta a esa fecha.
- **3 secciones** (`SectionLabel` existente) sobre `FlashList`:
  1. **Para hoy** = agendados `SCHEDULED` del día. Vacío → EmptyState "Sin pendientes".
  2. **Completados** = `EXECUTED` del día.
  3. **Vencidos** = de `GET /agenda/overdue`, **máx 2** visibles + botón **"Ver más"** (`meta.total > 2`).
- **`AgendaCard`** (nuevo en `ui.tsx`): ícono por tipo (`agendaTypeMeta`), nombre del deudor, hora, tipo,
  estado; barra de acento por tipo/urgencia; tap → navega (placeholder S3 por ahora).
- **FAB "+"** → navega a placeholder (S2 lo reemplaza).
- Estados loading/empty/error/offline; pull-to-refresh; race-guard al cambiar de día (como Home/Agenda actual).

## 5. Reuso (Paso B)
| Capacidad | Decisión | Path |
|---|---|---|
| Fetch + meta | REUSAR | `api-client.ts` `apiQuery`/`toQuery` |
| Header / EmptyState / SectionLabel / StatusBadge | REUSAR | `ui.tsx` |
| Moneda / fecha | REUSAR | `@kobrax/shared` utils |
| Enums de dominio | NUEVO en shared | `AgendaItemType`/`AgendaItemStatus` |
| Card de agendado / tira de días / meta por tipo | NUEVO | `ui.tsx`: `AgendaCard`, `WeekStrip`, `agendaTypeMeta` |
| Servicio de datos | NUEVO | `src/agenda.service.ts` |
| Picker mes/año | NUEVO (dep) | `@react-native-community/datetimepicker` |

## 6. Tareas (orden)
1. Prisma: modelo + enums + migración + RLS + índices. `prisma generate` + migrar.
2. Enums en shared.
3. Módulo `agenda/` + `GET /agenda?date` + `GET /agenda/overdue` + serializer (con nombre de deudor) + scope.
4. Seed de la semana (5 tipos, hoy/futuro/≥3 vencidos). Tests del service.
5. Móvil: borrar `agenda.tsx` viejo + `nueva-gestion.tsx`; `agenda.service.ts`; `agendaTypeMeta`+`AgendaCard`+`WeekStrip` en `ui.tsx`; instalar datetimepicker.
6. Pantalla principal: tira + picker + 3 secciones + estados + refresh.
7. Verificar (API type-check+tests; móvil type-check+jest+expo export) + handoff visual.

## 6.bis Reglas de la fase
Las 3 del epic §3.3: **sol→contraste** (nombre/monto/hora en navy/text, labels en muted); **gama baja→perf**
(FlashList no FlatList, animación solo UI-thread/Reanimated, arranque < 2 s); **animación con propósito**
(scroll-a-hoy y pull-to-refresh, nada decorativo). + `AgendaItemType`/tono desde el enum de shared (no strings
hardcodeados); tokens desde `theme.ts`; solo lectura (cero POST/PATCH); offline no bloquea.

## 7. DoD
- Backend: migración aplicada, RLS activa, `GET /agenda?date` y `/overdue` con tests verdes, seed cargado.
- Móvil: con la API real, la tira muestra hoy centrado; cambiar de día recarga; "Para hoy/Completados/Vencidos"
  con datos del seed; vencidos con "máx 2 + ver más"; offline no rompe.
- Verificación verde (type-check + jest + expo export) + validación visual de la usuaria.

## 8. Decisiones
- Permisos `AGENDA_READ`/`AGENDA_WRITE` **nuevos** (cerrado en 00-fundacion §8).
- `scheduledDate` día obligatorio + hora opcional → dentro de "Para hoy" se ordena por hora (los sin hora al final).
- **"Ver más" de vencidos**: expande in-place con paginado (no pantalla dedicada) — decidido.
