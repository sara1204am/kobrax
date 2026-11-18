# KOBRAX — Agente: Panel Web (Supervisores / Gerencia)
# Ubicación: apps/web/CLAUDE.md

## Responsabilidad
Panel de administración para supervisores, gerentes y dirección ejecutiva: identidad (login, MFA, empresa, recuperación), y los
módulos operativos del panel `(panel)`: cartera, mora, agenda, rutas, pagos, importación, exportación, equipo, organización
(oficinas), seguridad/roles, actividad, cuenta y ayuda. El detalle de cada pantalla vive en su carpeta de `src/app/(panel)/`.

> Actualizado en la auditoría de 2026-11-17: este archivo describía sólo el núcleo de identidad (2026-08-07). Si agregas una dep
> o un módulo, actualiza esta lista.

---

## Stack real

| Área | Qué se usa |
|---|---|
| Framework | Next.js 14 (App Router), TypeScript `strict` |
| Estilos | Tailwind CSS + tokens `k-*` (ver `tailwind.config.ts`) |
| Auth | **BFF propio** — route handlers en `src/app/api/**` + cookies httpOnly |
| Data fetching | `fetch` nativo. Server components para lectura, `postJson()` para mutar |
| Estado | Ninguno global. `useState` local; `sessionStorage` sólo para el selector de empresa |
| Tests | Vitest + Testing Library + MSW (`src/test/msw-server.ts`) |
| i18n | `next-intl` — es/en, **sin ruteo por idioma** (ver abajo) |
| Mapas | `maplibre-gl` — misma familia y mismos tiles que el móvil. **Sólo en `/rutas/[id]`**: son 250 kB, y el listado que no dibuja mapa no los paga |
| Otras deps | `qrcode` (sólo para pintar el QR del alta de MFA) |

**No hay** librería de componentes, ni cliente de cache, ni store global, ni
gráficos, ni WebSocket. Cuando un módulo los necesite de verdad, se agregan ahí.

---

## Patrón BFF (lo más importante de entender)

El navegador **nunca ve los tokens**. Todo pasa por el servidor de Next:

```
navegador → route handler (src/app/api/**) → API Nest (KOBRAX_API_URL)
             ↑ cookies httpOnly            ↑ Authorization: Bearer
```

- `src/lib/bff.ts` — `apiCall()` (habla con la API y adjunta el Bearer desde la
  cookie), set/clear de cookies, y `sameOrigin()` para CSRF.
- Cookies: `k_access` (15 min), `k_refresh` (7 días), `k_preauth` (5 min, el
  intermedio entre pasos del login). Todas `httpOnly` + `sameSite=strict`.
- `src/middleware.ts` — **refresh silencioso**: si expiró el access pero hay
  refresh, pide un par nuevo y re-setea las cookies. Si no, redirige a `/login`.
  El matcher lista las rutas privadas (`/dashboard`, `/settings`, `/cuenta`, `/equipo`, `/organizacion`, `/actividad`, `/ayuda`…):
  **toda ruta privada nueva tiene que sumarse a `config.matcher` de `src/middleware.ts`**.
- `src/lib/auth-flow.ts` — traduce el `LoginResult` del backend al paso que el
  cliente entiende (`done` / `mfa` / `mfa_setup` / `select_account`).
- `src/lib/client.ts` — `postJson()` y `routeByStep()` del lado del navegador.

Regla: **un componente cliente nunca llama a la API directamente**, siempre a un
route handler del mismo origen. Los handlers que mutan validan `sameOrigin()`.

---

## Idiomas (es/en)

El locale **vive en una cookie, no en la URL**. Prefijos `/es` y `/en` obligarían
a tocar todas las rutas y el matcher del middleware — mucho ruido para dos
idiomas.

- `src/i18n/config.ts` — locales, default y el nombre de la cookie (`k_locale`).
  Es la **única cookie de este panel que no pasa por el BFF**: no es httpOnly
  porque la escribe el navegador (`components/locale-switch.tsx`).
- `src/i18n/request.ts` — lee la cookie por request; un valor inventado cae al
  default. Esa guarda (`isLocale`) no es cosmética: abajo hay un `import()`
  dinámico armado con el valor de la cookie.
- `src/messages/{es,en}.json` — un archivo por idioma. `src/i18n/messages.test.ts`
  falla si una clave existe en uno y no en el otro.
- En componentes: `useTranslations('namespace')`, **igual en server y en client**
  components (next-intl lo soporta en los dos; el `AuthShell` es server).
- ⚠️ Al leer la cookie, el layout raíz vuelve dinámicas **todas** las rutas
  (`ƒ` en la salida del build). Es el precio del idioma sin prefijo en la URL.
- En Vitest `next-intl` está mockeado en `vitest.setup.ts` con el traductor real
  atado a `es.json`: los tests afirman sobre el español de verdad, y una clave
  que no exista rompe la prueba.

**Alcance traducido:** auth y los módulos que ya tienen su namespace en `messages/*.json`; cada módulo traduce lo suyo en su etapa.

## Estructura actual

```
src/
├── app/
│   ├── (auth)/                     # login, login/mfa, login/mfa-setup,
│   │                               # login/select-account, forgot/reset-password
│   ├── api/                        # BFF: auth/* y account/*
│   ├── dashboard/                  # aterrizaje post-login (mínimo)
│   ├── settings/perfil/            # Mi perfil en pestañas: datos-personales, preferencias, seguridad
│   ├── layout.tsx · page.tsx · globals.css
│   └── middleware.ts
├── components/                     # ui.tsx, auth-shell.tsx, otp-input.tsx,
│                                   # password-checklist.tsx, locale-switch.tsx
├── i18n/                           # config.ts, request.ts
├── messages/                       # es.json, en.json
├── lib/                            # bff.ts, auth-flow.ts, client.ts, format.ts
└── test/msw-server.ts
```

Componentes del sistema (mira si ya existe antes de escribir uno):
`ui.tsx` (`Button` con `size`/`fullWidth`/variantes, `TextButton` para acciones de texto, `IconButton`, `Input`, `Select`, `Textarea`, `Switch`, `Field`, `ErrorBanner`),
`form-kit.tsx` (`Tabs` accesibles, `Checkbox`, `ConfirmDialog`, `FormSection`, `FormActions`), `panel-ui.tsx` (`PageHeader`,
`Section`, `Badge`, `Segmented`, `Card`, `EmptyState`…), `data-table.tsx` (`DataTable`), `modal.tsx` (`Modal`).
**No escribas `<button>`, `<select>` ni `<textarea>` a mano** (salvo tarjetas/filas clicables, pastillas con estado, celdas de calendario e ítems de menú, que son excepciones y siguen en el baseline): `pnpm --filter @kobrax/web lint` (ratchet en
`scripts/check-raw-elements.mjs`) falla si crece su cantidad respecto de `scripts/raw-elements-baseline.json`; al migrar una pantalla
baja el número y se fija con `node scripts/check-raw-elements.mjs --update`.

---

## Cómo se construye un módulo nuevo

Mismo método que funcionó en el móvil: **módulo por módulo, pantalla por
pantalla, funcional**.

1. Elegir los endpoints **reales** que ya expone la API para ese dominio (los que
   usa el móvil), no los CRUD genéricos.
2. Server component para la lectura inicial (`apiCall(..., { auth: true })`).
3. `'use client'` sólo donde hay interacción; mutaciones vía route handler nuevo
   en `src/app/api/**` que valide `sameOrigin()`.
4. Sumar la ruta al matcher de `middleware.ts`.
5. Un test de Vitest por lógica no trivial (no por componente).

---

## Design System

Los tokens viven en `tailwind.config.ts` y salen de
`packages/shared/src/design/tokens.ts`. Son la marca: **no los toques al
rediseñar**, cambiá el layout.

```
k-navy #1A3A52 · k-slate #2B5A7D · k-periwinkle #5B7DBE · k-light-bg #D8E5F2
k-purple #7B68D6 · k-highlight #F0ECFF · k-bg #F8F9FB
k-text #1A2B3E · k-text-2 #5B7795 · k-muted #8FA3B8 · k-border #D8E5F2
k-success #27AE60 / bg #E8F8F0 · k-danger #DC3545 / bg #FCE8E8
k-warning #F59E0B / bg #FFF3CD / text #7A5C00
```

Además: `shadow-k-card`, `shadow-k-focus`, `shadow-k-focus-error`, `bg-k-hero`.

Tipografía: H1 28/600 navy · H2 22/600 navy · H3 18/500 text · body 14/400 text ·
small 12/400 muted. Labels de campo: 11px, uppercase, tracking-wide.

---

## Variables de entorno

```
KOBRAX_API_URL             # default http://127.0.0.1:4010/api — server-side, nunca al navegador
NEXT_PUBLIC_MAP_STYLE_URL  # el style.json self-hosted de los tiles (W6). Sin él, raster de OSM
```

`KOBRAX_API_URL` va **sin** prefijo `NEXT_PUBLIC_`: el navegador no tiene que saber
dónde vive la API, y si aparece uno ahí es un error de diseño.

La del mapa es la única `NEXT_PUBLIC_`, y con motivo: **la pide el navegador** para
bajar los tiles, así que no puede resolverse del lado del servidor. Mientras no esté,
el mapa cae a los tiles raster de openstreetmap.org, que son **sólo para desarrollo**
(su política de uso prohíbe producción).

---

## Verificación

```
pnpm --filter @kobrax/web type-check
pnpm --filter @kobrax/web test
pnpm --filter @kobrax/web dev      # :3000, necesita la API en :4010
```

⚠️ **Si tocaste `packages/shared`, reiniciá el `dev`.** `next.config.mjs` usa
`resolve.symlinks = false` (sin eso react-refresh rompe el paquete CJS y todas
las pantallas que importan de `shared` dan 500). El precio es que Next resuelve
`@kobrax/shared` dentro de `node_modules` y **no vigila sus cambios**: después de
`pnpm --filter @kobrax/shared build` el dev sigue sirviendo el módulo viejo. El
síntoma es claro y desconcierta igual: `X is not a function` sobre algo que
acabás de exportar.
