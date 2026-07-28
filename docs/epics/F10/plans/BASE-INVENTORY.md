# F10 · Inventario de Base Reusable (ledger anti-duplicación)

> **Índice vivo de lo que YA existe y DEBE reusarse.** Lo lee el skill `/f10-etapa` en su
> auditoría de reuso (Paso B) antes de proponer cualquier artefacto nuevo, y lo **actualiza** al
> cerrar cada etapa. **Regla de oro:** si algo se usa en ≥2 lugares, vive acá y se importa —
> nunca se copia ni se re-implementa. El código es la verdad; este índice es el atajo + la intención.
>
> Al agregar una fila: `artefacto → path → qué hace → creado en P#`. Si encontrás un near-duplicado, se **consolida**, no se suma.

---

## Shared — `packages/shared` (dominio, fuente única)
> **Regla:** tipos/enums/constantes/utils de dominio se importan de acá. **Nunca** redefinir `CaseStatus`, montos, hashes, transiciones ni tokens en el móvil.

| Artefacto | Path | Qué provee |
|---|---|---|
| Enums de dominio | `src/enums/*` | `CaseStatus`, `CasePriority`, `CaseActivityType`, `VisitOutcome`, `EvidenceType`, `NotificationType`, `PaymentRequestStatus`, `RouteStatus`, `Role`, `Permission` |
| Transiciones de caso | `src/constants/case-transitions.ts` | `CASE_TRANSITIONS` — validar transición permitida (P2/P3) |
| Permisos | `src/constants/permissions.ts` | scopes RBAC (ej. `clients.import`) para el gating de P10 |
| Constantes | `src/constants/kobrax.constants.ts` | límites/valores compartidos |
| Tokens de diseño (FUENTE) | `src/design/tokens.ts` | los colores/tipografía que `theme.ts` espeja — parity check en P0 |
| DTOs de respuesta | `src/dtos/{response,error,pagination}.dto.ts` | forma `{ data, meta, error }` + paginación |
| Utils | `src/utils/{currency,date,hash,tokenize}.utils.ts` | formateo de moneda/fecha, SHA-256 (P8), tokenización PII |
| Validación | `src/validation/password-policy.ts` | `checkPassword` (ya usado por `PasswordChecklist`) |
| Tipos | `src/types/{auth,realtime}.types.ts` | contrato auth + eventos WS (P9) |

## Mobile UI — `apps/mobile/src`
| Artefacto | Path | Qué hace | P |
|---|---|---|---|
| Tokens móvil | `theme.ts` | `COLORS`, `HERO_GRADIENT`, `TYPE`, `SPACING`, `RADIUS` (espejo de shared/design) | base |
| UI auth | `components.tsx` | `Button` (primary/ghost), `Field` (+toggle), `ErrorBanner`, `Hero`, `Card`, `SecurityFooter`, `TextLink`, `PasswordChecklist` | base |
| **Fundación de campo** | `ui.tsx` | `Header`, `StatusBadge` (+`BadgeTone`), `ListRow`, `EmptyState`, `BottomSheet`, `OfflineIndicator` (banner Reanimated, informativo) | Slice 0 / P0 |
| OTP | `otp-input.tsx` | `OtpInput` (MFA) | base |

## Mobile data/servicios — `apps/mobile/src`
| Artefacto | Path | Qué hace | P |
|---|---|---|---|
| Cliente HTTP | `api.ts` | `apiFetch<T>`, `ApiResult<T>` — base URL con `/api`, header `x-client-type`, status 0 = sin red | base |
| **Cliente HTTP autenticado** | `api-client.ts` | `authedFetch<T>` (Bearer desde SecureStore + refresh 401→retry) + `refreshSession`. **Base de todos los `*.service.ts` de P1–P5**; `authService` lo reusa | P0 |
| **Store conectividad** | `store/net.ts` | `useNetStore` (Zustand: `isConnected`/`pendingCount`) + `subscribeConnectivity` (NetInfo). Fuente única de red | P0 |
| Servicio auth | `auth-service.ts` | `authService` (me/login/logout/refresh/…), tipo `Me` | base |
| Sesión | `session.ts` | `getSession`, `isSessionValid`, `touchSession` (ventana 8h/7d) | base |
| Biometría | `biometric.ts` | enable/clear/shouldOffer/isEnabled | base |
| Ruteo post-login | `post-login.ts` | `routeAfterAuth` (único punto de decisión tras auth) | base |
| Ruteo por step | `route-step.ts` | `routeByStep` (login → paso) | base |

## Mobile navegación — `apps/mobile/app`
| Grupo | Path | Contenido |
|---|---|---|
| Auth | `(auth)/` | login, mfa, mfa-setup, select-account, forgot-password, unlock, biometric-setup |
| Fuera de tabs | `(app)/` | offline, force-password-change |
| **Shell de campo** | `(tabs)/` | `Tabs` nativo (5 tabs) + index/agenda/rutas/cobranza/mas |

## Pendiente de crear (se llena a medida que cada P lo produzca)
> Cuando una etapa cree algo reusable (un `apiClient` con refresh, un store Zustand, un `useCases`, `CaseCard`, `AmountInput`, `sync.service`, `evidence.service`…) **se agrega acá con su path y su P**. Antes de crear cualquiera de estos, revisar si otro P ya lo dejó.

- ✅ P0 pobló: `api-client.ts` (`authedFetch`), `store/net.ts` (`useNetStore`), `OfflineIndicator`. Deps instaladas: NetInfo, Zustand, Reanimated, expo-haptics, FlashList.
- ✅ **Rutas FUNDACION** pobló `src/maps/`: `tiles.ts` (fuente de tiles + conversión `[lng,lat]`↔`{lat,lng}`), `MapCanvas` (pines + polyline), `MapPicker` (elegir 1 punto — ya lo usan `agenda/crear` y el alta de cliente/garantes), `MiniMapCard` (mapa estático), `offline-packs.service`. **MapLibre es la única lib de mapas**; `react-native-maps` se eliminó. `routes.service.ts` sumó `generate/create/updateStatus/updateStop` + `resolveStopCoords` + `routeProgress`.
- ✅ **Import** pobló: `src/import.service.ts` (contrato + derivados puros + flags del gate + memoria del archivo de muestra), `src/file-picker.ts` (`pickImportFile`, aparte porque `expo-document-picker` toca nativo al importarse y está en el camino del login), y en `src/api.ts` → **`postMultipart` + `uploadFailure`**, que comparten las DOS subidas de la app (import y evidencia fotográfica): techo de espera de 60 s y la distinción entre "no hay red" y "el archivo no se puede abrir". Backend: `modules/imports/` con **tres motores por FORMA de archivo** (`rows` CSV · `pdf-rows` tabla en PDF · `pdf-blocks` bloques etiquetados), `field-catalog.ts` (`num()` con separadores mezclados, `splitName`, `splitPhones`) e `import-config.ts` (invariantes + `detectFileShape`).
  - ⚠ **No hay parsers por banco** (C12). Sumar un formato = configurarlo desde Ajustes, no escribir código.
  - ⚠ Excel **no se lee**: la dep `xlsx` nunca se instaló y `rows.parser` sólo hace CSV.
