# Discovery · 03 · Aplicación web

> **Estado: COMPLETO 2026-11-02.** Método: `../../_framework/README.md` §2 (clases de evidencia) · hallazgo = plantilla T1. Raíz de rutas: `apps/web/src` (se omite el prefijo). Solo lectura; el código manda sobre los documentos.
> Las pistas de `00-leads.md` (L-10) se resuelven al final. La referencia de la vista objetivo está en `10-referencia-gallium.md`.

## Resumen

La web conoce oficinas en **un solo lugar con administración** (Cuenta › Agencias) y las **muestra** en 4 sitios más (ficha de mora, detalle de equipo, importación, tabla de mora). No existe un árbol, no hay selector de oficina en el shell, y el filtro de Cartera está cableado pero **vacío**. Los permisos llegan del servidor en el layout y se guardan en un contexto; ocultar es cosmético y la API valida.

## Mapa: dónde aparece la oficina en la web

| Pantalla | ¿Muestra oficina? | ¿Filtra? | ¿Edita? | Evidencia |
|---|---|---|---|---|
| Cuenta › Agencias (`/cuenta/agencias`) | Sí (nombre, código, ciudad, responsable, miembros, créditos, estado) | — | **Sí**: alta, edición, baja, mover miembros | `app/(panel)/cuenta/agencias/branches-manager.tsx:42-390` |
| Equipo (lista) | No | No (solo rol y estado) | No | `app/(panel)/equipo/members-table.tsx:66-127,175-190` |
| Equipo (ficha) | Sí: «Oficina asignada» / «Sin oficina asignada» | — | No («las oficinas se administran en otra parte») | `app/(panel)/equipo/[userId]/member-tabs.tsx:56`; `member-header.tsx:16` |
| Cartera | No en columnas | Filtro `branchId` definido pero con **0 opciones** | No | `app/(panel)/cartera/page.tsx:80-82`; `portfolio-table.tsx:149-155` |
| Mora (lista) | Columna «Agencia» | Filtro si `showAssignee && branches.length > 1` | No | `app/(panel)/mora/arrears-table.tsx:190-193,265-274`; `mora/page.tsx:32,76` |
| Mora (ficha) | Sí (`branchName`) | — | No | `mora/[creditId]/ficha-summary.tsx:41,118`; `ficha-gestion.tsx:207` |
| Dashboard | No | `branchId` viaja a la API si está en la URL; **sin control en pantalla** | No | `lib/dashboard.ts:80,97-102`; `components/dashboard/dashboard-filters.tsx:20-22` |
| Rutas | No | No | No | `grep` de oficina/agencia/branch en `app/(panel)/rutas` = 0 resultados (solo el aviso «solo lo tuyo», `rutas/page.tsx:83,132`) |
| Pagos | No | No (filtro por oficial) | No | `app/(panel)/pagos/officers.ts:14-33` |
| Importación (ajustes y detalle) | Sí: alcance «Agencia» con selector de agencia | Define el alcance de la corrida | Elige agencia como alcance | `import/ajustes/setup-steps.tsx:20,295-354`; `import/[id]/page.tsx:169-172`; `lib/import.ts:276-290` |
| Préstamo (alta de crédito) | No | No (el `branchId` del crédito no está en el formulario) | No | `grep branch` en `cartera/[id]/prestamo/*` = solo comentarios |
| Actividad de cuenta | Entidad `branch` en el filtro de auditoría | Sí (por entidad) | — | `cuenta/actividad/activity-feed.tsx:11` |

## Hallazgos

### H-web-01 · La única pantalla de administración de oficinas es Cuenta › Agencias
- Clase: VERIFICADO
- Evidencia: `lib/cuenta-tabs.ts:7,22`; `app/(panel)/cuenta/agencias/page.tsx:12-24`; `branches-manager.tsx:42-390` (2026-11-02)
- Hecho: lista plana en tabla (nombre+código, ciudad, responsable, miembros, créditos, estado, acciones «Administrar» y «Editar»); alta/edición en modal (nombre, código, ciudad, dirección, responsable, activa); baja con modal; «Administrar» abre un modal de miembros con quitar y alta por checkboxes.
- Implica para la épica: es el punto de partida que F13 reemplaza o extiende; no hay jerarquía, nivel ni ruta completa.
- HUB: —

### H-web-02 · Permisos de la pestaña y de los botones son distintos
- Clase: VERIFICADO
- Evidencia: `lib/cuenta-tabs.ts:22` (pestaña = `USER_READ`); `branches-manager.tsx:47` (`editable = can('account:write')`); `agencias/page.tsx:9-11`; `apps/api/src/modules/branches/branches.controller.ts:16-43` (`GET` = `USER_READ`; `POST/PATCH/DELETE/members` = `ACCOUNT_WRITE`) (2026-11-02)
- Hecho: quien tiene `user:read` ve la lista; solo `account:write` ve botones de alta/edición/mover. Si la API responde distinto de 200 se muestra «sin acceso».
- Implica para la épica: R5 («solo el super admin crea») choca con `account:write`, que hoy es de más roles (L-08, 05).
- HUB: —

### H-web-03 · La web conoce permisos desde `/auth/me` en el layout y los reparte por contexto
- Clase: VERIFICADO
- Evidencia: `app/(panel)/layout.tsx:26-29,69,84`; `components/permissions.tsx` (`PermissionsProvider`, `usePermissions().can`); `lib/nav.ts:48-61,70` (2026-11-02)
- Hecho: el layout pide `/auth/me` y `/auth/accounts` en servidor una vez; el menú se filtra con `visibleNav(user.permissions)`; los componentes cliente usan `can('…')`. Los server components piden `/auth/me` otra vez cuando lo necesitan (p. ej. `mora/page.tsx:27-33`).
- Implica para la épica: la web no recibe ninguna oficina ni alcance en la identidad: `MeInfo` no trae `branchId` (ver 04 y L-20 en 05).
- HUB: —

### H-web-04 · No hay selector de oficina; el único selector del shell es de empresa
- Clase: VERIFICADO
- Evidencia: `components/panel-shell.tsx:45-52,351-366,423,443,518` (`AccountList`, `canSwitch`); `grep -rniE "branch|agencia|oficina|sucursal"` sobre `apps/web/src` no halló ningún selector en `panel-shell` (2026-11-02)
- Hecho: el contexto que viaja es la cuenta (tenant); no existe estado de «oficina actual».
- Implica para la épica: un selector de oficina (como el de Gallium, `10`) sería nuevo; viviría junto a `AccountList` en el shell y el estado correría por URL o contexto (el patrón actual de filtros es URL).
- HUB: —

### H-web-05 · Cartera tiene el filtro por agencia, pero se alimenta con una lista vacía
- Clase: VERIFICADO
- Evidencia: `app/(panel)/cartera/page.tsx:80-82` (comentario «Las sucursales todavía no existen como endpoint» y `branches={[]}`); `portfolio-table.tsx:149-155`; `components/data-table-filters.tsx:109-115` (con 0 opciones el `select` se dibuja **deshabilitado** con «—»); `lib/cartera-query.ts:28` (`branchId` viaja como uuid) (2026-11-02)
- Hecho: el filtro existe y se ve apagado; la API de `/branches` ya existe y no se usa en Cartera.
- Implica para la épica: contradice la pista L-10 («Cartera sí filtra»): filtra en teoría, no en la práctica. También contradice el comentario del código, desactualizado frente a `GET /branches` (H-web-01).
- HUB: —

### H-web-06 · Mora sí filtra por oficina, con un endpoint propio y condiciones
- Clase: VERIFICADO
- Evidencia: `app/(panel)/mora/page.tsx:27-33,76` (`GET /mora/branches`); `mora-controller` `@Get('branches')` con `COLLECTION_READ` (`apps/api/src/modules/mora/mora.controller.ts:47-51`); `arrears-table.tsx:265-274` (solo si `showAssignee && branches.length > 1`); `lib/mora.ts:53` (`branchId` pasa a la API) (2026-11-02)
- Hecho: el filtro aparece solo para quien reparte (`assignment:write`) y con más de una oficina; el endpoint es de Mora, no el de `/branches`.
- Implica para la épica: hay dos fuentes de lista de oficinas (`/branches` y `/mora/branches`); la segunda tiene su propia lógica de alcance (02).
- HUB: —

### H-web-07 · El Dashboard acepta `branchId` pero no ofrece ningún control
- Clase: VERIFICADO
- Evidencia: `lib/dashboard.ts:78-81` (valida uuid) y `97-102` (`analyticsQuery` envía todo lo que haya en `filters`); `components/dashboard/dashboard-filters.tsx:20-22` (comentario: el filtro que no discrimina no se dibuja; «lo mismo con las sucursales, que hoy son cero») y ausencia de campo de agencia en las props `{collectors, sources, actions, today}` (2026-11-02)
- Hecho: la plomería existe (URL → API); falta el control. El comentario «hoy son cero» está desactualizado.
- Implica para la épica: el Dashboard por oficina es un cambio chico de UI si la API ya soporta el filtro (confirmar en 02).
- HUB: —

### H-web-08 · Equipo no muestra ni filtra por oficina en la lista; la ficha solo la muestra
- Clase: VERIFICADO
- Evidencia: `equipo/members-table.tsx:66-127` (columnas: miembro, rol, estado, último acceso, acciones) y `175-190` (filtros: rol, estado); `equipo/[userId]/member-tabs.tsx:56`; `packages/shared/src/types/user.types.ts:18,78` (`Member.branchId?`, `branchName`) (2026-11-02)
- Hecho: el dato `branchId` llega en cada `Member`, pero la tabla no lo usa; los filtros se aplican en memoria (`teamView`).
- Implica para la épica: confirma L-10 para Equipo; asignar gente se hace por Cuenta › Agencias o `PATCH /users/:id {branchId}` (`app/api/users/[id]/route.ts:16`), no por Equipo.
- HUB: —

### H-web-09 · Rutas y Pagos no conocen la oficina; el alcance lo pone el servidor
- Clase: VERIFICADO (UI) / INFERIDO (servidor)
- Evidencia: `rutas/page.tsx:83,132` (mensaje «solo lo tuyo» para quien no supervisa); `pagos/officers.ts:14-33` (quién se ofrece en el filtro depende del permiso: `user:read` → todo el equipo; `agenda:assign` → «cobradores de su agencia» vía `GET /agenda/assignees`; resto → nadie) (2026-11-02)
- Hecho: no hay filtro ni columna de oficina; la limitación para el supervisor ocurre en `GET /agenda/assignees` (servidor).
- Implica para la épica: contradice parcialmente L-13 (Pagos «toda la cuenta»): el filtro del ledger por oficial sí reduce al supervisor a su agencia, pero solo para elegir a quién consultar (INFERIDO para el ledger en sí; lo verifica 02).
- HUB: —

### H-web-10 · La importación usa agencia como alcance de la corrida
- Clase: VERIFICADO
- Evidencia: `import/ajustes/setup-steps.tsx:20` (`SCOPE_KINDS: ['account','official','branch']`), `295-354`; `import/[id]/page.tsx:169-172`; `lib/import.ts:276-290` (si la agencia guardada ya no existe, se avisa); `packages/shared/src/types/import.types.ts:97,120` (`ScopeBranch`) (2026-11-02)
- Hecho: el alcance «Agencia» exige elegir una agencia y limita la reconciliación a ella; las agencias salen de la pantalla de configuración (`screen.branches`).
- Implica para la épica: con un árbol, «agencia» pasa a ser «nodo y su subárbol»: hay que decidir qué significa el alcance de importación (06).
- HUB: —

### H-web-11 · Componentes reutilizables disponibles para una vista de oficinas
- Clase: VERIFICADO
- Evidencia: `components/modal.tsx` (`Modal`), `components/panel-ui.tsx` (`Section`, `Badge`, `EmptyState`), `components/ui.tsx` (`Button`, `Field`, `Input`, `Select`, `ErrorBanner`), `components/data-table.tsx` + `data-table-filters.tsx` + `DATA-TABLE.md` (estado en URL, filtros select/radio/rango), `components/permissions.tsx`, `components/toast.tsx`, `lib/client.ts:21` (`sendJson`), `lib/bff.ts` (`apiCall`), `lib/branches.ts` (`BranchRow`, `memberLabel`, `membersOf`, `candidatesFor`), `components/reason-dialog.tsx`, `components/search-box.tsx` (2026-11-02)
- Hecho: hay primitivas para modales, tablas, filtros, confirmaciones, avisos y llamadas al BFF, todas en Tailwind (`k-*`).
- Implica para la épica: el árbol, el control de nivel, la vista previa, el detalle de oficina, la papelera y el selector del shell **no existen**; hay que construirlos. `package.json` de la web no trae React Query, PrimeReact, Leaflet ni librería de DnD (2026-11-02): el patrón es servidor + `router.refresh()`.
- HUB: —

### H-web-12 · El patrón de datos de la web es BFF + server components, sin caché cliente
- Clase: VERIFICADO
- Evidencia: `lib/bff.ts:5-9` («el navegador nunca ve los tokens»); `agencias/page.tsx:14-17` (server fetch) y `branches-manager.tsx:60-73` (`sendJson` + `router.refresh()`); `components/DATA-TABLE.md` («la tabla no llama a la API») (2026-11-02)
- Hecho: toda lectura es de servidor; las mutaciones pasan por route handlers `app/api/**` (`branches/route.ts`, `branches/[id]/route.ts`, `branches/[id]/members/route.ts`) y se refrescan con la ruta.
- Implica para la épica: un árbol interactivo con arrastrar-y-soltar y mutaciones locales (Gallium usa React Query) es un patrón nuevo para esta web.
- HUB: —

### H-web-13 · Los textos de oficina viven en `messages/es.json` con terminología mezclada
- Clase: VERIFICADO
- Evidencia: `messages/es.json:2445` (`account.branches`), `:782-783` («Oficina»/«Todas las oficinas»), `:2951-2952` («Sucursal»/«Todas las sucursales»), `:2574` («Agencia»), `:3769-3770` («Oficina asignada») (2026-11-02)
- Hecho: la misma entidad se llama «agencia», «oficina» y «sucursal» según la pantalla; la ruta es `/cuenta/agencias`.
- Implica para la épica: la unificación del nombre (y de los niveles configurables, R1) toca i18n en ambos idiomas (`messages/en.json`).
- HUB: —

## Lente de tenant

| Perfil | Hoy |
|---|---|
| (a) Gratuito individual | Ve Cuenta › Agencias solo si tiene `user:read` (propietario tiene todo): ve una tabla vacía con «Añadir» (`branches-manager.tsx:138-139`). Equipo/Mora/Cartera: sin señal de oficinas (filtro de Mora no se dibuja con ≤1; el de Cartera sale apagado). Inferido: no necesita configurar nada. |
| (b) Equipo pequeño | Agencias como lista plana; el supervisor ve su agencia por el alcance del servidor y la pantalla lo dice (`mora/page.tsx` aviso `scopedToMine` solo para quien no reparte). |
| (c) Tenant grande | La tabla plana no escala a un árbol; sin buscador, sin ruta completa (nombres repetidos como «Central» no se distinguen: R10). |

## Contradicciones y desconocidos

| # | Tipo | Detalle |
|---|---|---|
| W-C1 | CONTRADICTORIO (pista L-10) | L-10 dice «Cartera y Mora sí filtran»: Mora sí (H-web-06); Cartera tiene el filtro pero `branches={[]}` (H-web-05). Se corrige: Cartera filtra «sobre el papel». |
| W-C2 | CONTRADICTORIO (código vs comentario) | `cartera/page.tsx:80` dice que las sucursales no existen como endpoint; `GET /branches` existe y la propia web lo usa en `agencias/page.tsx:15`. Mismo desfase en `dashboard-filters.tsx:22` («hoy son cero»). |
| W-C3 | CONTRADICTORIO (pista L-11) | `docs/producto/README.md` y `plans.ts:12` dicen que no hay función de sucursales; hay pestaña, rutas BFF, API y filtros en Mora/Import. Ya registrado en `09-brechas`. |
| W-D1 | DESCONOCIDO | Si `GET /analytics/*` realmente aplica `branchId` y el alcance del supervisor (la web solo reenvía). Pregunta: ¿qué hace `analytics.service.ts` con `branchId`? Responde: 02-backend-api. |
| W-D2 | DESCONOCIDO | Qué ve cada rol en Cuenta › Agencias hoy más allá de `user:read`: MANAGER tiene `user:read` y `account:read`, no `account:write` (L-08); falta confirmarlo con un usuario de prueba. Responde: 05. |
| W-D3 | NO VERIFICADO | `app/(panel)/agenda` (excluida de la lista de pantallas de la tarea) no se leyó; `grep` mostró 0 coincidencias de oficina en esa carpeta. |

## Resolución de pistas

| Lead | Resultado |
|---|---|
| **L-10** | **PARCIALMENTE CONFIRMADA y corregida.** Equipo: no muestra ni filtra por oficina — confirmado (H-web-08). Dashboard: acepta `branchId` y no tiene selector — confirmado (H-web-07). Cartera: el filtro existe pero está vacío (H-web-05) — la pista decía «sí filtra». Mora: filtra con condiciones (H-web-06). |
