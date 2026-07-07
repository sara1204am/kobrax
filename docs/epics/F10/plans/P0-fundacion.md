# P0 · Fundación — apiClient + conectividad + parity de tokens

## 1. Objetivo
Cerrar la fundación de campo: un **cliente HTTP autenticado reusable** (Bearer desde SecureStore + refresh 401→retry) que todos los services de P1–P5 consumen sin reimplementar auth, un **store de conectividad** (Zustand + NetInfo) con **`OfflineIndicator`** informativo, **parity de tokens** `theme.ts ↔ shared`, y las **deps premium** (Reanimated/haptics/FlashList) instaladas para que P1 arranque sin fricción. Tabs + `components/ui` ya existen (Slice 0).

## 2. Rama
`f10/P0-fundacion`

## 3. Build
🟢 Expo Go — cero nativo, cero claves nuevas. (Reanimated corre en Expo Go SDK 51 vía su plugin babel; no requiere prebuild.)

## 4. Pantallas Figma
**Ninguna dedicada.** P0 es fundación transversal. El `OfflineIndicator` es un **banner** especificado en `apps/mobile/CLAUDE.md` (§OfflineIndicator: "Sin conexión · X acciones pendientes de sync", solo informativo, **nunca bloquea**), no un nodo Figma. Se monta sobre las 5 tabs ya existentes.

## 5. Contrato
- **Endpoints:** ninguno nuevo. El `apiClient` reusa los ya definidos vía `apiFetch` (base `…:4010/api`, delta C1 ✅ ya OK). El único endpoint que toca su lógica es `POST /auth/refresh` (ya implementado en `authService.refresh`).
- **Tablas:** ninguna.
- **Estado offline:** `netStore` (Zustand) expone `{ isConnected, pendingCount }`. `pendingCount` = **0 fijo en P0** (la cola real llega en P6; el banner ya lo lee para no re-tocarlo después).
- **KPIs / decisiones cerradas:** N/A en P0.

## 6. Auditoría de reuso (Paso B)

| Capacidad | Estado | Path | Nota |
|---|---|---|---|
| Fetch base (URL `/api`, `x-client-type`, status 0 = sin red) | **REUSAR** | `src/api.ts` (`apiFetch`) | no se toca |
| Token desde almacenamiento seguro | **REUSAR** | `src/session.ts` (`getSession`) | SecureStore |
| Refresh rotatorio 401 | **REUSAR** | `src/auth-service.ts` (`authService.refresh`) | ya limpia sesión si el server rechaza |
| Cliente HTTP **autenticado** (Bearer + 401→refresh→retry) | **NUEVO** | `src/api-client.ts` (`authedFetch<T>`) | extrae el patrón que hoy duplican `me()`/`changePassword()` |
| Store de conectividad | **NUEVO** | `src/store/net.ts` (Zustand) | `useNetStore` |
| Banner offline | **NUEVO** | `src/ui.tsx` (`OfflineIndicator`) | usado por ≥2 tabs → vive en `ui.tsx` |
| Tokens de diseño | **EXTENDER** | `src/theme.ts` | resolver delta de parity (§9) |
| UI de campo (Header/StatusBadge/ListRow/EmptyState/BottomSheet) | **REUSAR** | `src/ui.tsx` | Slice 0, no se toca |

## 7. Artefactos nuevos (todos justificados + ubicados para reuso)
1. **`src/api-client.ts` → `authedFetch<T>(path, init)`** — lee token de `getSession`, llama `apiFetch`, y ante 401 llama `authService.refresh()` y reintenta **una** vez. Devuelve `ApiResult<T>`. Import unidireccional (`api-client → auth-service`), sin ciclo. Es la base de todos los `*.service.ts` de P1–P5.
2. **`src/store/net.ts` → `useNetStore`** (Zustand) — `{ isConnected, pendingCount }` + suscripción a `NetInfo.addEventListener`. Fuente única de conectividad.
3. **`OfflineIndicator`** en `src/ui.tsx` — banner que lee `useNetStore`; oculto si `isConnected`. Montado una vez en `app/(tabs)/_layout.tsx`. Animación: ver §9 decisión D3.

## 8. Tareas (ordenadas)
- [ ] `npx expo install` de las deps (§9 D1) + config babel de Reanimated (`plugin` en `babel.config.js`, debe ir **último**).
- [ ] Resolver parity de tokens (§9 D2) en `theme.ts`.
- [ ] `src/api-client.ts` con `authedFetch<T>` (+ des-duplicar: `me()`/`changePassword()` pasan a usarlo si D4 = sí).
- [ ] `src/store/net.ts` con `useNetStore` + listener NetInfo.
- [ ] `OfflineIndicator` en `ui.tsx` + montarlo en `(tabs)/_layout.tsx`.
- [ ] Test: `api-client.test.ts` (401→refresh→retry: éxito, refresh-falla, sin-red) + `net-store.test.ts` (toggle isConnected). Patrón jest-expo existente.
- [ ] Verificar: `type-check` + `test` + `expo export --platform android`.

## 9. Reglas de fase + decisiones abiertas
Reglas §3.3 epic: (1) sol→contraste; (2) gama baja→animación solo UI thread (Reanimated, nunca `Animated` JS); (3) animación con propósito (el slide del banner confirma cambio de estado de red). P0-específica: `apiClient` = **extender** el patrón existente, no segundo cliente; `OfflineIndicator` **informativo, nunca bloquea**.

**Decisiones cerradas (2026-07-06):**
- **D1 ✅ Instalar todo ahora:** NetInfo + Zustand + Reanimated + haptics + FlashList (`npx expo install`). P1 arranca enseguida.
- **D2 ✅ Blanco puro:** `theme.white` se mantiene `#FFFFFF` para contraste de cards bajo el sol; se documenta la divergencia intencional vs `bgWhite:#FAFBFD` en `theme.ts`. No se agregan `softPeriw`/`veryLightPurp` hasta que una pantalla los use (YAGNI).
- **D3 ✅ Banner con slide (Reanimated):** microinteracción en UI thread al cambiar el estado de red (habilitado por D1).
- **D4 ✅ Des-duplicar auth:** `me()`/`changePassword()` se refactorizan para usar `authedFetch` (borra el retry duplicado; el test del helper cubre el patrón).

## 10. DoD
- `authedFetch` cubre 401→refresh→retry con test verde; los services de P1 lo consumen sin tocar auth.
- `OfflineIndicator` aparece/desaparece con la conectividad real, sin bloquear ninguna acción.
- Parity de tokens resuelta (sin divergencia silenciosa theme↔shared).
- `type-check` + `jest` + `expo export` verdes. Validación visual (emulador + gama baja) por la usuaria.
- BASE-INVENTORY actualizado con `api-client.ts`, `store/net.ts`, `OfflineIndicator`.

