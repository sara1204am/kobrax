> **ESTADO: PLAN COMPLETO — ronda 2 (2026-10-02). Validador: PASS en la 2.ª pasada (ver fin del archivo).**

## ✅ Decisiones cerradas (ronda 2)

1. **Idempotencia:** `POST /mora/:creditId/activities` acepta `id` opcional (hecho en `7e27557`; reintento con el mismo id devuelve lo guardado, 409 `MORA_004` si es de otro crédito).
2. **Pantallas:** sin Figma; se construye con los componentes del sistema y la usuaria valida a ojo.
3. **Lista:** dentro de `cobranza.tsx`; el chip «En mora» pasa a leer `GET /mora` (no `groupPortfolio`).
4. **Rama:** `f10/mora` desde `feat/mora-central-f1`.

# Mora móvil — la central de mora del cobrador

**Fuente:** `docs/epics/F4/07-central-mora-recuperacion.md` §5 y T17–T19. **Build:** 🟢 Expo Go (el offline ya existe: `expo-sqlite` + cola propia, P6).

## 1. Objetivo

El cobrador ve **sus créditos en mora, uno por crédito**, con y sin señal, abre la ficha de recuperación de cada uno y registra desde ahí gestión (con resultado y promesa), pago y nota, todo encolable offline.

## 2. Rama

`f10/mora` (desde `feat/mora-central-f1`; se rebasa sobre `main` cuando la API entre).

## 3. Build

🟢 Expo Go. Sin módulos nativos nuevos.

## 4. Pantallas

**Sin node-id de Figma: no existe diseño de Mora — confirmado por la usuaria (2026-10-02).** Se construye con los componentes del sistema (CTA navy) y ella valida visualmente. Tampoco hay pulls de Figma en la construcción.

| Pantalla | Qué es | Figma |
|---|---|---|
| M1 · Lista de mora | tarjeta por crédito + chips + orden | — |
| M2 · Ficha de recuperación | `app/mora/[creditId].tsx` | — |
| M3 · Hojas de acción | gestión con resultado/promesa, pago, nota (`BottomSheet`) | — |

## 5. Contrato (API ya construida y verificada en esta rama)

El prefijo `/api` ya lo pone `API_BASE` (`src/api.ts`): los services pasan `/mora/...` a `apiQuery`/`apiMutate`, y las tablas de abajo lo muestran completo.

| Uso | Endpoint | Notas |
|---|---|---|
| Lista | `GET /api/mora` | `case:read`; el cobrador sólo ve lo suyo (el server acota). Orden `priority`/`daysPastDue`/`balance`/`lastAction`; filtros `hasPromise`, `priority`, `noActionSince`, `q`, `limit≤100`. Piso `días ≥ 1` por defecto. |
| Ficha | `GET /api/mora/:creditId` | `MoraCreditDetail` (lista + gestiones del caso abierto). |
| Historial/métricas | `GET /api/mora/:creditId/episodes`, `/metrics` | Móvil: sólo mora actual y última (§5 F4); métricas opcionales. |
| Promesas / notas | `GET /api/mora/:creditId/promises`, `/notes` | |
| Gestión | `POST /api/mora/:creditId/activities` | Resultado + promesa; abre el caso si no hay. **Reemplaza** al `POST /cases/:id/activities` previsto en F4 §4 para este flujo: sirve también a créditos **sin caso** (21 de 22 en la base de desarrollo). |
| Nota | `POST /api/mora/:creditId/notes` | `id` opcional puesto por el teléfono → reintento idempotente (`MORA_003` si el id es de otro crédito). |
| Pago | `POST /api/payments` + `Idempotency-Key` | ya existe (`createPayment`). |
| Visita | `POST /api/visits` | ya existe (`createVisit`), vía `rutas/resultado`. |

Tipos: **todos en `@kobrax/shared`** (`MoraCreditListItem`, `MoraCreditDetail`, `MoraPromise`, `CreditNote`, `NewCreditNote`, `MORA_SORTS`, `RECOVERY_RESULTS`, `validateRecoveryActivity`, `summarizePromises`, `computeRecoveryMetrics`). El móvil no redefine ninguno.

## 6. Hallazgo que corrige el plan F4 (T17)

F4 T17 dice «reusar `groupPortfolio`». **No sirve:** `groupPortfolio` agrupa **casos** por cliente (`GET /cases?view=portfolio`), y la mora es **por crédito y existe sin caso**. Con datos reales: de 22 créditos en mora, 21 no tienen caso; el chip «En mora» actual de `cobranza.tsx` sólo vería ese 1. La lista nueva lee `GET /mora` y no pasa por `groupPortfolio`. `groupPortfolio` queda intacto para Cartera.

## 7. Auditoría de reuso

| Capacidad | Clasificación | Dónde |
|---|---|---|
| Tipos de mora, resultado, promesa, nota, validación de gestión | REUSAR | `packages/shared` (`mora.types.ts`, `recovery-activity.ts`, `promises.ts`, `recovery-metrics.ts`) |
| Cliente HTTP, `toQuery`, `QueryResult`/`MutateResult` | REUSAR | `src/api-client.ts` |
| Caché de lectura offline | REUSAR | `src/sync/cached.ts` (`cachedList`/`cachedOne`) |
| Tipo de caché `mora` / `mora.detail` | EXTENDER | `CacheKind` en `src/db.ts` |
| Hidratación en oficina | EXTENDER | `src/sync/hydrate.ts`: un paso «mora» que **copia la llamada de la pantalla** (regla del archivo) + fichas de los créditos hasta `MAX_FICHAS` |
| Cola de escritura | EXTENDER | `src/sync/queue.ts`: `QueuedAction` + `ACTION_LABEL` + `send()`; `QueueKind` en `db.ts` |
| Gestión con resultado y promesa | EXTENDER | acción nueva `mora.activity` (id del teléfono) sobre `POST /mora/:creditId/activities`; id del teléfono (`nuevoId()`), el endpoint ya es idempotente por id |
| Nota | NUEVO (acción de cola) | `credit.note`, id vía `nuevoId()` (`src/ids.ts`) |
| Pago | REUSAR | `createPayment` + acción `payment` de la cola; `AmountInput` de `ui.tsx` |
| Visita | REUSAR | `app/rutas/resultado.tsx` + acción `visit` |
| Tarjeta de la lista | EXTENDER/NUEVO | `MoraCard` en `ui.tsx` (la usan lista y, a futuro, agenda) sobre `ListRow`/`StatusBadge`; prioridad con `CASE_PRIORITY_LABEL`/`caseStatusTone` |
| Chips, orden, vacío, hojas | REUSAR | `Chips`, `SegmentTabs`, `EmptyState`, `BottomSheet`, `PickerSheet`, `OfflineIndicator` |
| Llamar / WhatsApp / mapa | REUSAR | `Linking`, `MiniMapCard`, `currentLocation` (como `cliente/[id].tsx`) |
| Hojas de pago y gestión | REUSAR/EXTRAER | `PaySheet` y `GestionSheet` hoy viven **dentro** de `cliente/[id].tsx` (880 líneas): se **extraen a componentes** y la ficha de mora y `cliente/[id]` usan los mismos (no se copian) |
| Orden/filtro de la lista | NUEVO | `src/mora.ts` + `src/mora.test.ts` (puro) |
| Servicio | NUEVO | `src/mora.service.ts` (`listMora`, `getMora`, `addNote`, `addMoraActivity`) |
| Pendientes del cobrador | EXTENDER | `app/pendientes.tsx` ya lista `ACTION_LABEL` |

## 8. Artefactos nuevos (con su ubicación)

- `src/mora.service.ts` — lectura/escritura de `/mora` (service, no en el componente).
- `src/mora.ts` (+test) — orden y chips puros del lado del teléfono.
- ~~`MoraCard` en `ui.tsx`~~ → no hace falta: la tarjeta es `CaseCard` (REUSAR) y sus props las arma `moraCardProps` en `src/mora.ts` (probado).
- `app/mora/[creditId].tsx` — la ficha.
- Hojas extraídas de `cliente/[id].tsx` → `src/pay-sheet.tsx`, `src/gestion-sheet.tsx`.
- Acciones de cola `credit.note` y `mora.activity`.

## 9. Tareas (lectura antes que escritura)

**M1 — lista (T17)**
- [x] `CacheKind` `mora`/`mora.detail`; `src/mora.service.ts` con `listMora` sobre `cachedList`.
- [x] `src/mora.ts`: orden prioridad → días; chips «Crítica», «Con promesa», «Sin gestión N días»; test.
- [x] En `cobranza.tsx`, **modo de lista por chip**: con «En mora» la fuente pasa a `GET /mora` y se pintan `MoraCard` (una por crédito); los demás chips siguen con `groupPortfolio` y `CaseCard`. `FlashList`, loading/empty/error, `OfflineIndicator`, «datos de las HH:MM» (`localAt`).
- [x] `hydrate.ts`: paso «mora» con **los mismos parámetros** que la pantalla + test de que se hidrata.

**M2 — ficha y acciones (T18)**
- [ ] Extraer `PaySheet`/`GestionSheet` de `cliente/[id].tsx` con tests antes de tocar.
- [ ] `app/mora/[creditId].tsx`: cabecera (cliente, crédito, saldo, mora, prioridad), acciones llamar / WhatsApp / visita / gestión / pago / nota; secciones contactos+direcciones, últimas gestiones, promesas, notas, pagos.
- [ ] Llamar/visitar/registrar en ≤ 3 toques.

**M3 — offline (T19)**
- [ ] Acciones de cola `credit.note` y `mora.activity`; `ACTION_LABEL`; `send()`; `QueueKind`.
- [ ] Tests: sin red → encola; reconexión → drena FIFO; 4xx → `REJECTED` en pendientes; nota reintentada no duplica.
- [ ] Evidencia: flujo actual `choosePhoto`/`uploadImage` **dentro de `visit`**. Firma y hash local quedan fuera (P8-firma diferida a v2 por decisión del 2026-08-06): brecha documentada.

## 10. Reglas de la fase

- Las 3 de §3.3 del epic: sol → contraste; gama baja → nada pesado en el hilo de UI (FlashList, sin `.map` de cientos de tarjetas); animación con propósito.
- **El cálculo de mora, vencido, aging, prioridad y promesas es del servidor/shared.** El teléfono sólo muestra y ordena lo que ya vino.
- **Multi-tenant/RBAC por capacidad** (no por `tenantType`): el alcance lo pone el servidor; el móvil no filtra «lo mío».
- Cola: todo append-only o idempotente; id del teléfono; un 4xx definitivo no se reintenta.
- Pago offline en PSF no cambia saldo (D3): el copy lo aclara.
- Sin pulls de Figma (no hay diseño); la validación es visual por la usuaria.

## 11. DoD

- Funcional: el cobrador ve sus créditos en mora con y sin red; abre la ficha; registra gestión con promesa, pago y nota sin red y los ve sincronizados al volver.
- Verificación: `pnpm --filter @kobrax/mobile type-check` + `test` + `npx expo export --platform android`; `/code-review`.
- Validación visual por la usuaria (emulador / gama baja).
- `BASE-INVENTORY.md` y `BUILD-PLAN.md` actualizados al cerrar.

## 12. Riesgos / decisiones abiertas

1. ~~Idempotencia de la gestión~~ ✅ resuelta: el endpoint ya acepta `id` (`7e27557`).
2. **Caché de mora desactualizado:** se muestra «datos de las HH:MM»; sin resolución de conflictos (todo append-only).
3. `cliente/[id].tsx` (880 líneas): la extracción de hojas es el riesgo de regresión; se hace con tests primero.
4. El filtro «Sin gestión N días» depende de `noActionSince` del servidor; confirmar que cabe en la clave de caché por query.

## Validación

- 1.ª pasada: FAIL — pantallas aún «pendientes», prefijo `/api` sin decir, cambio de `cobranza.tsx` sin definir.
- 2.ª pasada (2026-10-02): PASS — corregidos los tres; ítems 1–16 verificados contra código (`nuevoId` en `src/ids.ts`, `MiniMapCard`, `currentLocation`, `cachedList`, `API_BASE`). Advertencia: sin node-ids por no existir diseño (confirmado por la usuaria).
