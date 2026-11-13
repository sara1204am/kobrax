> ESTADO: VALIDADO (G4 PASS 2026-11-08, 11/11). D-1…D-6 aprobadas por la usuaria el 2026-11-08 (camino 1: Seguridad sin Roles hasta F7).

# Plan F6 · Navegación web por permisos

> Resuelve **R-10, N-08 (web), R-08 (UI)** del plan maestro (`ROLES-PERMISOS-PLAN.md` §E «Fase 6», ADR-F14-09, Anexo 1 «Navegación»). Va después de F5 y antes del editor de roles (F7), que cuelga de la sección Seguridad que aquí se crea.

## 1. Objetivo
Que cada persona llegue a las pantallas que su rol permite **y a ninguna otra**, por el menú y por la URL: cada sección del menú pide su propio permiso (sin depender de `account:read`), cada ruta privada se protege en el servidor con una puerta uniforme (`requirePermission` → `<NoAccess/>`), y lo que hoy cuelga de «Cuenta» sin ser de la cuenta (Oficinas, Actividad, Accesos de soporte) pasa a su sección, con redirección permanente desde las rutas viejas.

## 2. Rama
`f14/p6-web-nav`, desde `f14/p5-roles-por-cuenta` (F5 aún no está en `main`).

## 3. Estado inicial con evidencia (releído 2026-11-08)

| # | Hallazgo | Evidencia | Clase |
|---|---|---|---|
| E1 | El menú tiene 12 ítems con **un** permiso cada uno; `account` pide `account:read`; no existen Organización, Seguridad ni Actividad como ítems. `visibleNav` es cosmética pura. | `apps/web/src/lib/nav.ts:48-61,72-77` | VERIFICADO |
| E2 | Oficinas, Actividad y Accesos de soporte son **pestañas de `/cuenta`**: `CUENTA_TABS` las lista con `office:read`, `audit:read` y `support:consent`. | `lib/cuenta-tabs.ts:16-28` | VERIFICADO |
| E3 | `cuenta/layout.tsx` llama `getAccount()` (`GET /accounts/me`, que exige `account:read`) y, si no es 200, **devuelve `noAccess` para todas las pestañas**. Un SUPERVISOR (tiene `office:read`, no `account:read`) o un AUDITOR (tiene `audit:read`, no `account:read`) no llega a su pestaña ni por URL. Es R-10. | `app/(panel)/cuenta/layout.tsx:22-30`; permisos de plantilla en `packages/shared/src/constants/permissions.ts` (SUPERVISOR 47-76 con `OFFICE_READ`/`USER_READ` y sin `ACCOUNT_READ`; AUDITOR 107-122 con `AUDIT_READ`) | VERIFICADO |
| E4 | No hay puerta de ruta común: cada `page.tsx` hace su `apiCall` y, si falla, pinta `EmptyState` con `t('noAccess')` (20 usos). El texto, el tono y el comportamiento (¿403?, ¿error de red?) no son uniformes: un 500 se muestra como «sin acceso». | `grep noAccess apps/web/src` (20 coincidencias); `cuenta/oficinas/page.tsx`, `cuenta/actividad/page.tsx` | VERIFICADO |
| E5 | `PanelLayout` pide `/auth/me` con `apiCall` directo y baja los permisos por `PermissionsProvider` (cliente). Ningún Server Component puede leer los permisos sin repetir la llamada. | `app/(panel)/layout.tsx:25-70`; `components/permissions.tsx` | VERIFICADO |
| E6 | El `matcher` de `middleware.ts` lista las rutas privadas una por una (`/cuenta`, `/equipo`, `/cartera`…); **una ruta nueva fuera de la lista no tiene sesión ni refresco silencioso**. | `middleware.ts:173-212` | VERIFICADO |
| E7 | `/auth/me` no informa si la sesión es de soporte (el token lleva `supportSessionId`, la respuesta no). El aviso «Sesión de soporte · vence HH:MM» quedó **sin consumidor** (INCIDENTS 2026-11-07). | `apps/api/src/modules/auth/auth.service.ts` (sin `support`); `packages/shared/src/types/user.types.ts` (`MeInfo`); `docs/epics/F14/execution/INCIDENTS.md` | VERIFICADO |
| E8 | El reintento ante `AUTHZ_STALE` ya existe en el BFF (una vez, marca de 20 s); `SessionWatcher` cubre logout/cambio de sesión entre pestañas. **Falta** avisar a la persona cuando sus permisos cambiaron y la pantalla actual ya no le corresponde. | `lib/bff.ts:28-29,94`; `components/session-watcher.tsx` | VERIFICADO |
| E9 | `/cuenta` redirige a `/cuenta/general`; se asume que todo el que lee la cuenta puede abrirla. | `app/(panel)/cuenta/page.tsx` | VERIFICADO |
| E10 | Hay ≈30 enlaces internos a `/cuenta/oficinas…` (árbol, ficha, papelera, `?tab=`), 1 a `/cuenta/actividad` y 1 a `/cuenta/soporte`; las migas salen de `NAV` + `panel.crumbs`. | `grep "/cuenta/" apps/web/src` | VERIFICADO |

## 4. Alcance / fuera de alcance

**Dentro**
- **Puerta de ruta uniforme:** `lib/authz.ts` con `getMe()` (cacheado por petición con `cache()` de React; el layout del panel lo usa también, una sola llamada a `/auth/me`) y `requirePermission(permiso | {anyOf})` para Server Components, que devuelve `<NoAccess/>` único (texto sin pistas de cómo entrar) y distingue **403** (sin acceso) de **error de red/500** (reintentar). `usePermissions()` sigue para Client Components.
- **Menú por secciones**, cada una con su permiso propio y, cuando haga falta, «cualquiera de»: Inicio · Cartera · Importar · Mora · Agenda · Rutas · Pagos · Exportar · **Organización** (`office:read`) · **Equipo** (`user:read`) · **Seguridad** (`role:read` o `user:sessions:revoke` o `support:consent`) · **Actividad** (`audit:read`) · **Cuenta** (`account:read`). `NavItem.permission` pasa a admitir una lista «cualquiera de».
- **Mover pantallas** (sin duplicarlas): `/cuenta/oficinas/**` → `/organizacion/**`; `/cuenta/actividad` → `/actividad`; `/cuenta/soporte` → `/seguridad/soporte`. Redirecciones permanentes desde las rutas viejas (todas las subrutas y `?tab=`). Actualizar los ≈30 enlaces internos, migas (`crumbs`) y textos es/en.
- **Cuenta deja de bloquear por `account:read` en el layout:** el marco (título + estado) se pinta si el permiso está; cada pestaña se protege con su propio permiso. `/cuenta` redirige a la primera pestaña que la persona puede abrir.
- **`/seguridad`** (índice): lista las pantallas de la sección a las que tiene permiso. En F6 contiene sólo **Accesos de soporte**; «Roles y permisos» llega con F7 (D-2).
- **Aviso «Sesión de soporte · vence HH:MM»** (cierra el pendiente de F5): `GET /auth/me` informa `supportSession { id, expiresAt }` cuando el actor es de plataforma; el panel muestra el banner. Es el **único** cambio de API de la fase.
- **Cambio de permisos en sesión:** si tras el refresco silencioso la pantalla abierta ya no está permitida, se muestra `<NoAccess/>` con el aviso «Tus permisos cambiaron» (sin cerrar la sesión ni perder la navegación).
- `middleware.ts`: las rutas nuevas entran al `matcher`.

**Fuera**
- Editor de roles y cualquier API `GET/PUT /roles…` (F7). La página «Roles y permisos» **no** se crea aquí.
- Móvil (F8): ninguna tarea; sus pestañas por `can()` son de F8.
- Rediseño visual del menú (la personalización de la interfaz es F15, al final).
- Cambiar qué permiso exige la API de cada endpoint (cerrado en F3).
- Páginas de módulos operativos (Cartera, Mora, Agenda, Rutas, Pagos, Exportar, Importar): sólo se les aplica la puerta uniforme **si** hoy resuelven «sin acceso» a mano; su comportamiento no cambia.

## 5. Dependencias
F1 (reintento `AUTHZ_STALE`), F3 (contrato de permisos por endpoint), F5 (permisos por cuenta, `support:consent`, `/cuenta/soporte`). ADR-F14-09 y H-5 aprobados 2026-11-04.

### Decisiones de la fase
| ID | Decisión | Estado |
|---|---|---|
| D-1 | Las cinco secciones del ADR-F14-09 con el permiso del plan maestro; ninguna depende de `account:read` salvo Cuenta. | Derivada de ADR-F14-09 (aprobado) |
| D-2 | En F6 **Seguridad** contiene sólo Accesos de soporte; Roles y permisos llega con F7. La sección aparece si la persona tiene cualquiera de `role:read`, `user:sessions:revoke` o `support:consent` (hoy: administrador, y gerente por `role:read`/sesiones), y su índice lista sólo lo que puede abrir. | **APROBADA** (2026-11-08) |
| D-3 | URLs nuevas: `/organizacion`, `/actividad`, `/seguridad/soporte`, con 308 permanente desde las viejas (el «301» del plan maestro se implementa como redirección permanente de Next.js). | **APROBADA** (2026-11-08) |
| D-4 | `requirePermission` valida **en el servidor** con el `permissions` de `/auth/me`, por encima de lo que diga la API de la pantalla; la API sigue siendo la autoridad (si el permiso del token estuviera viejo, la API responde 403 y la pantalla muestra `<NoAccess/>`). | **APROBADA** (2026-11-08) |
| D-5 | El banner de soporte sale de `/auth/me.supportSession`; no se infiere del token en el navegador. | **APROBADA** (2026-11-08) |
| D-6 | Una sola oficina (RULES C2): «Organización» sigue mostrando la ficha simple (`SingleOffice`), sin árbol; el administrador de una cuenta de una oficina no ve pantallas nuevas salvo que el ítem del menú cambie de lugar. | **APROBADA** (2026-11-08) |

### Cruce con la alineación móvil en curso (regla D1)
El móvil no se toca (decisión de la usuaria, `mobile-refactor-pendiente-f14`). El único cambio compartido es la **adición** de `supportSession` a `/auth/me`: campo opcional, ignorado por el móvil actual.

## 6. Archivos afectados (IDs HUB; los nuevos se crean al cerrar la fase)

| ID HUB | Archivo / símbolo | Cambio |
|---|---|---|
| H14-054 (nuevo) | `apps/web/src/lib/authz.ts` (nuevo), `components/no-access.tsx` (nuevo), `app/(panel)/layout.tsx` | `getMe()` cacheado, `requirePermission`, `<NoAccess/>`; el layout usa `getMe()` |
| H14-055 (nuevo) | `lib/nav.ts`, `lib/nav.test.ts`, `components/panel-shell.tsx` (+ test), `messages/es.json` y `en.json` (`panel.nav`, `panel.crumbs`) | secciones Organización / Seguridad / Actividad, permiso «cualquiera de», migas |
| H14-056 (nuevo) | `app/(panel)/cuenta/**` (layout, `page.tsx`, `cuenta-tabs.tsx`), `lib/cuenta-tabs.ts` (+ test) | layout sin bloqueo por `account:read`, pestañas restantes, redirección a la primera permitida |
| H14-057 (nuevo) | `app/(panel)/cuenta/oficinas/**` → `app/(panel)/organizacion/**`; ≈30 enlaces internos; `lib/offices*.ts` | mover pantalla de Oficinas |
| H14-058 (nuevo) | `app/(panel)/cuenta/actividad/**` → `app/(panel)/actividad/**`; `app/(panel)/cuenta/soporte/**` → `app/(panel)/seguridad/soporte/**`; `app/(panel)/seguridad/page.tsx` (nuevo) | mover Actividad y Accesos de soporte; índice de Seguridad |
| H14-059 (nuevo) | `apps/web/next.config.*`, `middleware.ts` (`matcher`) | redirecciones permanentes y rutas nuevas con sesión |
| H14-060 (nuevo) | `apps/api/src/modules/auth/auth.service.ts` (`me`), `packages/shared/src/types/user.types.ts` (`MeInfo`), `components/panel-shell.tsx`, `lib/session-sync.ts` | `supportSession` en `/auth/me` y banner |
| H14-061 (nuevo) | páginas con `noAccess` a mano (20 usos) | pasar a la puerta uniforme sin cambiar su permiso |
| H14-017 / H14-052 (existen) | `bff.ts` (`AUTHZ_STALE`), pantalla «Accesos de soporte» | consultados: el reintento no cambia; la pantalla sólo cambia de ruta |

## 7. Invariantes que aplican
B3/B4 (el servidor decide: ocultar no es autorizar), B5 (los accesos de soporte siguen auditados), B12 (todo spec nuevo registrado en su paquete), B13, F14-A H-5 (AUDITOR y VIEWER ven Actividad sin `account:read`), H-11 (aviso de sesión de soporte), C2 (una oficina sin jerarquía), D1/D2 (el móvil no se toca; no arrastrar cambios ajenos —`docs/epics/F15/` es de otra sesión—).

## 8. Perfiles de tenant y protección del gratuito individual
- **FREE / cobrador independiente (administrador de una sola oficina y un solo usuario):** conserva todas las capacidades. Cambios visibles mínimos: «Oficinas» y «Actividad» pasan de pestañas de Cuenta a ítems del menú y las URLs viejas redirigen; «Equipo» y el resto no cambian. No aparece ninguna pantalla nueva con contenido (el índice de Seguridad sólo lista «Accesos de soporte», vacío). Sin jerarquía de oficinas (C2).
- **Empresa:** supervisor y auditor dejan de recibir «sin acceso» en lo que sí pueden ver (R-10). Cada rol ve sólo las secciones que su plantilla permite.
- **Regresión del gratuito individual (G5):** registrarse, iniciar sesión, ver el menú, abrir Cartera y crear cliente/crédito, abrir Cuenta (General/Plan/Facturación), abrir Oficinas por la URL vieja (redirige) y nueva, abrir Actividad, cerrar sesión y volver a entrar; todo sin pantallas de error.

## 9. Riesgos
| Riesgo | Mitigación |
|---|---|
| Enlaces guardados o internos a `/cuenta/oficinas…` rotos. | Redirección permanente con `:path*`, test que enumera las rutas viejas conocidas y una búsqueda global de `/cuenta/oficinas`, `/cuenta/actividad`, `/cuenta/soporte` en el código. |
| Una ruta nueva sin entrada en el `matcher` queda sin refresco silencioso (E6). | Test de `middleware.test.ts` que exige que cada carpeta privada de `app/(panel)` esté cubierta por el `matcher`. |
| `requirePermission` pinta «sin acceso» ante un error transitorio de la API. | Distinguir 403 de red/5xx (estado de error con reintento) y probarlo. |
| Mover `oficinas` rompe tests con rutas fijas (`offices-view.test.tsx`). | Mover los tests con la pantalla; sin cambiar su contenido. |
| Doble llamada a `/auth/me` por petición. | `getMe()` con `cache()` y verificación por un test que cuenta llamadas. |
| `supportSession` en `/auth/me` cambia un contrato compartido con el móvil. | Campo opcional y aditivo; snapshot de puertas no cambia (no hay endpoint nuevo). |

## 10. Pruebas
**Existentes que deben seguir verdes:** web `vitest` completo (1258), `nav.test.ts`, `cuenta-tabs.test.ts`, `panel-shell.test.tsx`, `offices-view.test.tsx`, `support-access-view.test.tsx`, `middleware.test.ts`, `bff.test.ts`, `session-watcher.test.tsx`; API `auth.service.spec.ts`; `authz-coverage` (sin cambios de snapshot); integración sin tocar.

**Nuevas (web, registradas en `vitest` del paquete `apps/web`; la de API en el script `test` de `apps/api`):**
- `lib/authz.test.ts`: `requirePermission` con permiso / sin permiso / `anyOf` / error de red; `getMe` hace una sola llamada por petición.
- `nav.test.ts` ampliado **por plantilla de rol** (ADMIN, GERENTE, SUPERVISOR, COBRADOR, AUDITOR, VIEWER): qué secciones ve cada uno; el supervisor ve Organización y no Cuenta; el auditor ve Actividad y no Cuenta; el viewer no ve Equipo ni Seguridad.
- `cuenta-tabs.test.ts`: ya no incluye Oficinas, Actividad ni Soporte; redirección a la primera pestaña permitida.
- Redirecciones: las rutas viejas redirigen con 308 conservando subrutas y `?tab=`.
- `middleware.test.ts`: cobertura del `matcher` para toda carpeta privada.
- Aviso de cambio de permisos en sesión.
- Banner «Sesión de soporte» (con y sin sesión) y, en API, `me` con `supportSession` sólo para actor de plataforma.
- Integración: no se agrega; `f5-roles-plataforma.it.ts` se amplía con `GET /auth/me` bajo sesión de soporte.

## 11. Rollback
Sólo frontend y un campo aditivo de `/auth/me`: revertir la rama devuelve el menú anterior. Las redirecciones se deshacen quitándolas de `next.config`. Sin migraciones de datos.

## 12. Tareas ordenadas
**Datos:** ninguna.

**API**
1. `GET /auth/me` devuelve `supportSession { id, expiresAt }` cuando el actor es de plataforma (campo opcional en `MeInfo`); spec en el script `test`.

**Web**
2. `lib/authz.ts` (`getMe`, `requirePermission`), `<NoAccess/>`; el layout del panel usa `getMe()`.
3. `NAV` con las secciones nuevas y permiso «cualquiera de»; migas y textos es/en; `nav.test.ts` por plantilla.
4. Mover Oficinas, Actividad y Accesos de soporte (con sus tests y enlaces); índice `/seguridad`.
5. `cuenta/layout.tsx` sin bloqueo por `account:read`; pestañas restantes; redirección a la primera permitida.
6. `next.config` (redirecciones permanentes) y `middleware.ts` (`matcher`) con su test de cobertura.
7. Pasar los 20 `noAccess` a mano a la puerta uniforme (sin cambiar su permiso).
8. Banner «Sesión de soporte» y aviso «Tus permisos cambiaron».

**Móvil:** ninguna (F8).

## 13. Criterios de cierre
- **G5:** salida pegada en `VERIFICATIONS.md` de: unitarias de API, shared y web; `tsc` limpio en api y web; integración de `f5-roles-plataforma.it.ts` (y suite completa en `off` sólo si se tocó API más allá de `me`); regresión del gratuito individual (§8); prueba manual con los seis roles de plantilla de qué ve cada uno (tabla en VERIFICATIONS).
- **G6:** `/code-review` con hallazgos corregidos o aceptados con motivo; recorrido del mapa de impacto por H14-054…061, H14-017 y H14-052.
- **G7:** HUB, `STATUS`, `HANDOFF`, `VERIFICATIONS`, `INCIDENTS` (cerrar el pendiente del aviso de soporte) y `docs/producto/roles-permisos-planes.md` al día. F7 sólo por la orden vigente de seguir F4→F7.
