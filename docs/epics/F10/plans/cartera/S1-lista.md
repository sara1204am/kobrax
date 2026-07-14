# Cartera · S1 — Lista de cartera (V3)

> Índice: [README.md](./README.md) · Spec: [`docs/flows/Cliente_Prestamo.pdf`](../../../../flows/Cliente_Prestamo.pdf) §5.3
> **Depende de [00-fundacion.md](./00-fundacion.md)** (crédito sin cronograma, `creditView`, seed) — ya construido.
> **Sin Figma:** se calca la pantalla-lista de Agenda (`app/(tabs)/agenda.tsx`) — mismos tokens, mismo
> esqueleto loading/offline/error/empty, misma `FlashList`. **Build:** 🟢 Expo Go.
> Rama propuesta: `f10/cartera-lista` (sale de `f10/cartera-fundacion`).

## 1. Objetivo
Al entrar a **Cobranza**, el cobrador ve **su cartera**: una sola lista **centrada en el cliente** (§5.3 —
"la unidad mental es la gente que me debe; el préstamo es un atributo"). Cada tarjeta agrega la **deuda total**
del cliente, muestra un contador si tiene varios préstamos ("2 préstamos"), un **badge de estado** con color
semántico y una línea secundaria "Cuota Bs 300 · vence 15 jul" o "8 días de mora". Arriba: **buscador local**
(nombre + documento) y **chips de filtro** (Todos · Hoy · En mora · Al día · Pagados). Solo **lectura + búsqueda**.

## 2. Alcance
**SÍ:** enriquecer `GET /cases` (opt-in `view=portfolio`) con **zona**, **documento enmascarado** y
**promesa vigente**; pantalla de lista con buscador, chips, tarjeta de cliente agregada, orden por defecto, y
los 4 estados de carga; FAB "+ Nuevo" y tap en tarjeta **cableados a placeholder** (S2/S3).
**NO:** alta de cliente/préstamo (S2), ficha de cobranza (S3), registrar pago/gestión (S3). **Sin `q`
server-side** (la búsqueda es local, D6). **Iconos llamar/navegar de la tarjeta → S3** (necesitan revelar PII
auditada; la ficha ya los tiene). **Import (V5) → web, fuera.**

## 3. Backend — enriquecer `GET /cases` (opt-in, no toca a Home)
`GET /cases` ya lo consume **Home** (`index.tsx`). Para no cargar a Home con decrypt + joins, la enriquecemos
**solo cuando el query pide `view=portfolio`**. Aditivo: agenda no usa este endpoint, Home lo ignora.
1. `ListCasesQueryDto`: `view?: 'portfolio'` (`@IsOptional() @IsIn(['portfolio'])`).
2. `cases.service.list` — cuando `view === 'portfolio'`, además del include actual:
   - **Zona**: incluir **una** ubicación del cliente (la primaria/más reciente de `client_locations`, `take: 1`)
     → `zone`.
   - **Documento**: `decrypt(nationalId)` → `maskDocument()` (ya en shared, la misma que usa `clients.serializer`)
     → `documentMasked`. **Enmascarado, no PII en claro** → sin audit `PII_REVEAL`.
   - **Promesa vigente**: una consulta a `agenda_items` (`type = PROMISE_TO_PAY`, `status = SCHEDULED`,
     `scheduledDate >= hoy`) sobre el set de `clientId` de la página → mapa `clientId → hasActivePromise`.
     Una sola query para toda la página (no N+1).
3. `serializeCase`: exponer `zone?`, `documentMasked?`, `hasActivePromise?` **solo** cuando vienen resueltos
   (el servicio los inyecta; en agenda/mutaciones quedan `undefined`). Cuota/próxima fecha/origen/candado ya
   los expone la fundación vía `creditView`.
4. **Scope intacto**: el cobrador ya está acotado a `assigneeId = yo` (sin `case:assign`) — su cartera = sus
   casos. RLS y envelope sin cambios.
5. **Tests** (node:test): `view=portfolio` agrega zona/documento-enmascarado/promesa; sin `view` la respuesta
   queda idéntica a hoy (cero regresión, Home no cambia); `hasActivePromise` true solo si hay una promesa
   `SCHEDULED` futura; el documento sale **enmascarado**, nunca en claro.

## 4. Estado derivado (shared, ya existe — no se reescribe)
`portfolioStatus(credit, asOf, dueSoonDays)` en `packages/shared/utils/loan.ts` ya calcula
**AL DÍA · POR VENCER · EN MORA · PROMESA · PAGADO** con la precedencia del §5.3 (PAGADO > PROMESA > MORA >
POR VENCER > AL DÍA) y consume `hasActivePromise`. **PROMESA es un badge (morado), no un chip** (los chips del
§5.3 son 5: Todos/Hoy/En mora/Al día/Pagados). S1 solo la **usa**; nada nuevo en shared salvo, si hace falta,
etiquetas/tono del estado (`PortfolioStatus` ya es un enum de shared).

## 5. Móvil — pantalla de cartera (`app/(tabs)/cobranza.tsx`)
- **`cases.service.ts`**: extender `CaseListItem` con `zone?`, `documentMasked?`, `hasActivePromise?`,
  `installmentAmount?`, `nextDueDate?`, `frequency?`, `origin?`, `locked?` (hoy el tipo está **desactualizado**:
  el comentario dice "no trae nombre ni monto" pero el serializer ya los trae). Agregar `view: 'portfolio'` a
  `ListCasesParams`. Un solo fetch (`listCases({ view:'portfolio', open? })`); la cartera de un cobrador cabe
  en memoria (§5.3).
- **`src/portfolio.ts`** (puro, con tests): agrupa `CaseListItem[]` por `clientId` →
  `ClientPortfolio { clientId, name, zone, documentMasked, currency, totalDebt, creditCount, status,
  maxDaysPastDue, nextDueDate, installmentAmount, secondaryLine }`. `status` = el **peor** estado entre los
  créditos del cliente (vía `portfolioStatus` de shared). `secondaryLine` = "N días de mora" si hay mora, si no
  "Cuota Bs X · vence DD mmm". **Orden por defecto: mora desc, luego próxima fecha** (§5.3). + filtro por chip
  y **búsqueda local** (nombre + documento, case/acento-insensible).
- **Pantalla** (calca `agenda.tsx`): header navy "Cartera"; **buscador** (input existente de `components.tsx`);
  **fila de chips** `SegmentTabs`/chips (Todos · Hoy · **En mora** con contador en rojo · Al día · Pagados);
  `FlashList` de **tarjetas de cliente**; **FAB "+ Nuevo"** → placeholder (S2). Estados
  loading/offline/error/empty + pull-to-refresh + race-guard (mismo patrón que Agenda/Home).
- **`ClientCard`** (extiende `CaseCard` en `ui.tsx`, no un componente nuevo — reuso del README): nombre + zona;
  **deuda total** como cifra dominante (roja si hay mora); línea secundaria; **badge** con color por
  `PortfolioStatus`; contador "N préstamos" si `creditCount > 1`; tap → placeholder ficha (S3).
  Iconos llamar/navegar **diferidos a S3** (PII auditada). Añadir la variante/tono morado del badge si falta.

## 6. Reuso (Paso B)
| Capacidad | Decisión | Path |
|---|---|---|
| Fetch + envelope + meta | REUSAR | `api-client.ts` (`apiQuery`/`toQuery`) |
| Header / EmptyState / FlashList / SegmentTabs / StatusBadge | REUSAR | `ui.tsx` |
| Input de búsqueda / banner error | REUSAR | `components.tsx` (`Field`, `ErrorBanner`) |
| Moneda `money()` / fecha | REUSAR | `agenda-form.ts` (wrapper de `formatCurrency`) |
| **`portfolioStatus` + `PortfolioStatus`** (5 estados) | REUSAR (ya existe) | `@kobrax/shared` |
| **`creditView`** (cuota/próxima fecha) | REUSAR (ya existe) | `@kobrax/shared` + serializer |
| `maskDocument` | REUSAR | `@kobrax/shared` (misma que `clients.serializer`) |
| **`CaseCard`** | **EXTENDER** | `ui.tsx` — zona, deuda dominante, contador de préstamos, tono morado |
| **`portfolio.ts`** (agrupar/ordenar/buscar/filtrar, puro) | **NUEVO** | `apps/mobile/src` (+ test) |
| `serializeCase` / `cases.service.list` / `ListCasesQueryDto` | **EXTENDER** | enriquecimiento opt-in `view=portfolio` |
| Pantalla | REEMPLAZA placeholder | `app/(tabs)/cobranza.tsx` |

## 7. Tareas (orden)
1. Backend: `view=portfolio` en DTO + service (zona, documento enmascarado, promesa) + serializer + tests.
2. Móvil: extender `cases.service.ts` (tipos + `view`).
3. `src/portfolio.ts` (agrupar/estado/orden/buscar/filtrar) + su test.
4. `ui.tsx`: extender `CaseCard` → `ClientCard`; tono morado del badge si falta.
5. Pantalla `cobranza.tsx`: buscador + chips + lista + estados + refresh + FAB placeholder.
6. Verificar (API type-check + tests; móvil type-check + jest + `expo export`) + handoff visual a la usuaria.

## 8. Reglas de la fase (epic §3.3 + no-negociables)
**Sol → contraste**: nombre/deuda/días de mora en `navy`/`textPrimary`, zona/labels en `muted`. **Gama baja →
perf**: `FlashList` (no FlatList), búsqueda/orden en memoria puros, animación solo UI-thread. **Animación con
propósito**: pull-to-refresh, nada decorativo. + multi-tenant **por capacidad** (scope ya aplicado) · RLS
intacta · `{data,meta,error}` · **estado y matemática siempre en `packages/shared`** (nunca redefinidos en el
móvil) · **PII enmascarada** en la lista (sin `PII_REVEAL`) · offline no bloquea la lectura.

## 9. Decisiones (cerradas para S1)
- **PROMESA se cablea ahora** (usuaria, 2026-07-13): `GET /cases?view=portfolio` expone `hasActivePromise`
  desde una promesa vigente en `agenda_items`; `portfolioStatus` la pinta morada. Resuelve el "abierto" de D6.
- **Buscador = nombre + documento** (usuaria, 2026-07-13): el documento viaja **enmascarado** (`12345***`);
  el teléfono **no** entra a la lista (chocaría con la tokenización de PII, P6) → se decide en S3, donde la
  ficha ya revela PII auditada. Resuelve el otro "abierto" de D6.
- **Chips = 5 fijos** (§5.3), **PROMESA es badge, no chip**. "En mora" con contador en rojo.
- **Iconos llamar/navegar de la tarjeta → S3** (necesitan PII en claro; la ficha ya los incluye).
- **Enriquecimiento opt-in (`view=portfolio`)** para no cargar a Home con decrypt/joins. `ponytail:` techo —
  la agrupación en memoria rompe si la cartera supera una página (~100); upgrade = `GET /portfolio` con
  agregación server-side cuando un tenant real lo pida (ya anotado en D6 del README).

## 10. DoD
- Backend: `GET /cases?view=portfolio` devuelve zona + documento enmascarado + `hasActivePromise`; sin `view`,
  respuesta idéntica (Home sin cambios); tests verdes, sin regresión.
- Móvil: contra la API real, la cartera agrupa por cliente, agrega la deuda, pinta los 5 estados (incluida
  PROMESA morada del seed), ordena por mora; el buscador filtra por nombre y documento en vivo; los chips
  filtran; "N préstamos" aparece en el cliente multi-crédito; offline/empty/error no rompen.
- Verificación verde (type-check + jest + `expo export`) + **validación visual de la usuaria** (parity con
  las pantallas de Agenda).
