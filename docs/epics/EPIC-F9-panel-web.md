# KOBRAX · EPIC F9 — Panel Web (Supervisión & Gerencia)
> *El centro de mando de la cobranza: todo el tenant, en una sola pantalla.*

**ID:** EPIC-F9 · **Estado:** 🚧 En curso (W0 — identidad)
**Owner:** Web + Shared + Testing (consume API de F4–F8)
**Depende de:** F2a/F2b (BFF + auth web ya operativos) · F4 (clientes/créditos) · F5 (casos) · F6 (rutas/visitas) · F7 (pagos) · F8 (realtime/notifs)
**Desbloquea:** operación real de supervisores/gerencia · F11 (analítica avanzada se monta sobre este panel)
**Requisitos:** RF-10 (reportes/visualización) · RNF-05 (usabilidad) · refuerza RNF-01 (RBAC en UI) y RNF-04 (rendimiento percibido)

> ## ⚠️ Re-encuadre 2026-08-07 — leer antes que el resto
>
> Este epic se escribió cuando la única superficie del producto era la API, y sus slices 1–5
> apuntaban a los **endpoints genéricos** `/clients`, `/credits`, `/cases`. Entre medio se
> construyó todo el móvil (F10) y ahí el negocio quedó definido de verdad: cartera, agenda,
> rutas, import y cuenta, cada uno con sus endpoints y sus decisiones cerradas.
>
> Por eso se borró `src/app/panel/**` (el CRUD genérico) y el build se re-ordenó: **el panel web
> se construye sobre los mismos contratos que ya usa el móvil.**
>
> **El orden de ejecución vigente NO es el §4 de abajo, es
> [`F9/BUILD-PLAN.md`](./F9/BUILD-PLAN.md) (W0–W9).** El inventario de lo que existe y no se
> reconstruye está en [`F9/plans/BASE-INVENTORY.md`](./F9/plans/BASE-INVENTORY.md).
> El §4 de este documento se conserva como catálogo de historias — su numeración de slices
> quedó obsoleta.
>
> **Alcance que este epic NO cubría y ahora sí (etapa W0):** refactor visual de todo el auth
> contra el diseño de `docs/epics-web/login/`, **login con Google (OAuth real, no adorno)**,
> **i18n es/en**, registro público e ingreso por invitación desde la web.

---

## 1. Contexto y Posicionamiento en la Plataforma

El backend de Kobrax (F4–F8) expone una API completa de cobranza multi-tenant, pero **hoy no hay superficie para operarla**: lo único en web es el flujo de autenticación (F2a Slice 5 + F2b). EPIC F9 construye el **panel de gerencia y supervisión** — la herramienta diaria de quien dirige la cartera: ve el estado de la cobranza, asigna casos, supervisa cobradores en tiempo real, audita pagos y exporta reportes.

> **Frontera con F10 (Mobile):** el cobrador en campo **no** usa el panel web; usa la app móvil. F9 es para roles de oficina (ACCOUNT_ADMIN, MANAGER, SUPERVISOR). El panel **lee y dirige**; el campo **ejecuta**.

### 1.1 Mapa de dependencias del proyecto

| EPIC | Nombre | Estado | Relación con F9 | Bloquea a F9 |
|------|--------|--------|-----------------|--------------|
| F2a/F2b | Auth + BFF web | ✅ Completo | Base: cookies httpOnly, `middleware.ts`, selector de cuenta | Prereq (✅) |
| F4 | Core Financiero | 🚧 En curso | Pantallas clientes/créditos consumen sus endpoints | 🔴 Sí |
| F5 | Casos de cobranza | 🚧 Base | Tablero de casos, asignación, ciclo de vida | 🔴 Sí |
| F6 | Rutas + campo | ✅ Base | Vista de rutas, mapa, evidencia | 🟡 Parcial |
| F7 | Pagos | 📋 Listo | Conciliación, historial de pagos, `payment_request` | 🟡 Parcial |
| F8 | Realtime/notifs | 📋 Listo | `CollectorMap` en vivo, toasts de eventos, centro de notificaciones | 🟡 Parcial |
| F11 | Analítica | ⏳ Pendiente | F9 entrega dashboards base; F11 añade MV + export avanzado | F9 desbloquea F11 |

> **Estrategia de arranque:** F9 **no** espera a que F4–F8 estén 100%. Se construye **por verticales (slices) alineados a cada módulo**: cada vertical se libera cuando su API correspondiente está estable. El orden recomendado sigue la disponibilidad: Clientes/Créditos (F4) → Casos (F5) → Pagos (F7) → Rutas+Realtime (F6/F8) → Dashboard agregado.

### 1.2 Lo que ya existe (no se reconstruye)

- **BFF propio** (sin next-auth): cookies httpOnly `k_access`/`k_refresh`/`k_preauth`, refresh silencioso en `middleware.ts`, handlers en `/api/account/*`.
- **Design system** vinculante en `packages/shared/src/design/tokens.ts` → `tailwind.config` ya importa de ahí.
- **Rutas auth** completas: `/login`, `/login/mfa`, `/login/mfa-setup`, `/login/select-account`, `/settings/security/*`.
- **Harness de tests web**: Vitest + RTL + MSW ya configurado (`vitest.config.ts`, `vitest.setup.ts`, `src/test/msw-server.ts`).

---

## 2. Objetivo de Negocio

Dar a gerencia y supervisión una **superficie única, en tiempo real y gobernada por permisos** para dirigir la operación de cobranza de su tenant: medir (dashboard/KPIs), gestionar cartera (clientes/créditos), distribuir trabajo (casos/rutas), supervisar el campo (mapa en vivo), controlar el dinero (pagos/conciliación) y administrar su organización (settings) — **sin ver jamás datos de otro tenant ni PII fuera de su permiso**.

**Outcome medible:** un SUPERVISOR entra, ve la salud de su cartera en < 2 s, asigna los casos en mora del día y observa a sus cobradores moverse en el mapa en vivo. Un MANAGER exporta el reporte de recuperación del mes. Un ACCOUNT_ADMIN da de alta un usuario y le asigna rol — todo respetando RBAC y dejando audit trail.

---

## 3. Alcance

### 3.1 Incluye ✅

- **Shell de aplicación**: layout autenticado (sidebar navy + topbar + breadcrumb), navegación por permisos, selector de tenant activo (multi-cuenta), perfil/logout.
- **Dashboard** de KPIs de cartera (recuperación, mora segmentada, productividad, casos por estado) con tarjetas + gráficos (Recharts).
- **Clientes** (F4): lista paginada con búsqueda por blind index, detalle con tabs (general/contactos/ubicaciones/relaciones/documentos/créditos), alta/edición con detección de duplicado, **reveal de PII auditado**.
- **Créditos** (F4): lista con días-mora coloreado, detalle con cronograma, panel de mora con recálculo, wizard de alta con preview de cronograma.
- **Casos** (F5): tablero (lista/kanban por estado), detalle con timeline de actividad, asignación manual/auto, transiciones de estado validadas.
- **Rutas** (F6): planificación/visualización de rutas, paradas ordenadas, visión de visitas con evidencia (foto + GPS + hash) — **solo lectura/supervisión** de lo capturado en campo.
- **Pagos** (F7): historial/ledger inmutable, conciliación, generación de `payment_request` (QR/link), aprobación si el rol lo permite.
- **Realtime** (F8): `CollectorMap` con ubicación de cobradores en vivo, toasts de eventos (`case.updated`, `payment.registered`, `route.completed`), **centro de notificaciones**.
- **Settings de organización** (subset operativo): usuarios (listar/invitar/activar/bloquear), roles (lectura + asignación), datos de cuenta, etiquetas de concepto del tenant. *(La administración RBAC profunda es de F3.)*
- **RBAC en UI**: hook `usePermissions`; cada acción/ruta/columna se muestra/oculta según el permiso efectivo de `GET /auth/me`.
- **Capa de datos tipada** desde `@kobrax/shared` (DTOs ya definidos por F4–F8), consumida vía el BFF.
- **Estados completos** por pantalla: loading (skeletons), empty, error, success; respeto de `prefers-reduced-motion`.

### 3.2 No incluye ❌ (out of scope explícito)

- **Captura de evidencia en campo** (foto/GPS/firma) → es del cobrador, vive en F10.
- **Administración RBAC avanzada** (roles custom, `user_permission_override` con expiración, gestión de planes/branches profunda) → **F3** (diferido a fin de proyecto). F9 solo lee roles y asigna los existentes.
- **Vistas materializadas / KPIs pesados < 300 ms** y exportes ejecutivos avanzados → **F11**. F9 entrega los dashboards base con queries directas.
- **Nuevos endpoints de negocio**: F9 **no** crea lógica de dominio nueva. Si una pantalla necesita un agregado que la API no expone, se levanta un gap contra el EPIC dueño (F4–F8), no se resuelve en el BFF.
- **PWA/offline del panel**: el panel asume conectividad (es de oficina). Offline-first es exclusivo de mobile (F10).
- ~~**i18n completa**: F9 fija es-LA~~ → **revertido el 2026-08-07**: i18n real (es/en) entra en W0.
- **SSO más allá de Google**: Microsoft y Apple salen del diseño. Google se construye completo en W0.

---

## 4. Historias y Tareas

> Convención de slices: cada vertical es liberable de forma independiente cuando su API está estable. `Web` = pantallas/hooks; `Shared` = tipos/cliente API; `Testing` transversal.

### Slice 0 — Shell & Fundaciones de UI

| # | Historia | Agente | Entregable | Estado |
|---|----------|--------|-----------|--------|
| H0.1 | Layout autenticado | Web | `(app)/layout.tsx`: sidebar navy + topbar + breadcrumb + área de contenido; protegido por `middleware.ts` ya existente | ⏳ |
| H0.2 | Navegación por permisos | Web | `usePermissions()` (lee `/auth/me`); componente `<NavGuard permiso="...">`; ítems de menú se ocultan sin permiso | ⏳ |
| H0.3 | Selector de tenant activo | Web | Dropdown en topbar para usuarios multi-cuenta; reusa el flujo `select-account` del BFF | ⏳ |
| H0.4 | Cliente API tipado (BFF) | Shared/Web | `apiClient` que llama al BFF, tipado con DTOs de `@kobrax/shared`; manejo central de `{data,meta,error}`, 401→refresh, 403→toast | ⏳ |
| H0.5 | Kit de UI base | Web | `DataTable` (paginación/orden/filtros server-side), `Modal` confirm, `Toast`, `Skeleton`, `Badge/Chip`, `EmptyState`, `ErrorState`, `PageHeader` — todos con tokens del design system | ⏳ |
| H0.6 | Manejo de errores y sesión | Web | Boundary de error por ruta; expiración de sesión → redirección limpia a `/login`; banner de "sin conexión a API" | ⏳ |

### Slice 1 — Clientes & Créditos (sobre F4)

| # | Historia | Agente | Entregable | Estado |
|---|----------|--------|-----------|--------|
| H1.1 | Lista de clientes | Web | Tabla paginada (nombre, documento tokenizado, riesgo, estado, ingreso); filtros `status`/`risk`/`q`; búsqueda por blind index | ⏳ |
| H1.2 | Detalle de cliente + tabs | Web | Tabs general/contactos/ubicaciones/relaciones/documentos/créditos; **botón Revelar PII** solo con `client:pii:read` (auditado) | ⏳ |
| H1.3 | Alta/edición de cliente | Web | Formulario con validación en vivo; **detección de duplicado** (debounce por hash al salir del campo documento); confirm modal en baja | ⏳ |
| H1.4 | Lista/detalle de créditos | Web | Tabla con días-mora coloreado (0 verde · 1-30 amarillo · 31-60 naranja · >60 rojo); detalle con cronograma (capital/interés/saldo/estado por cuota) | ⏳ |
| H1.5 | Wizard de nuevo crédito | Web | 4 pasos (cliente → config → preview cronograma en vivo → confirmar); valida Σ cuotas antes de habilitar Confirmar; alerta si cliente tiene créditos activos | ⏳ |
| H1.6 | Panel de mora | Web | Créditos con `days_past_due>0`; recálculo individual/masivo (`credit:write`) con confirm modal; resultado sin reload | ⏳ |

### Slice 2 — Casos (sobre F5)

| # | Historia | Agente | Entregable | Estado |
|---|----------|--------|-----------|--------|
| H2.1 | Tablero de casos | Web | Vista lista + kanban por `CaseStatus`; filtros por estado/prioridad/asignado/sucursal; prioridad coloreada | ⏳ |
| H2.2 | Detalle de caso + timeline | Web | Datos del crédito/cliente; timeline de `case_activity`; badges de estado/prioridad/días mora | ⏳ |
| H2.3 | Asignación | Web | Asignar manual a cobrador o auto (menor carga); reasignación; respeta `case:assign` | ⏳ |
| H2.4 | Transiciones de estado | Web | Acciones de transición validadas contra `CASE_TRANSITIONS` (UI deshabilita saltos inválidos); confirm + nota obligatoria al cerrar | ⏳ |

### Slice 3 — Pagos (sobre F7)

| # | Historia | Agente | Entregable | Estado |
|---|----------|--------|-----------|--------|
| H3.1 | Historial de pagos (ledger) | Web | Tabla inmutable de pagos por crédito/cliente; monto en mono; sin edición (refleja inmutabilidad del backend) | ⏳ |
| H3.2 | Conciliación | Web | Vista de pagos vs saldos; marca de pagos conciliados/pendientes; filtros por fecha/método | ⏳ |
| H3.3 | Solicitud de pago (QR/link) | Web | Generar `payment_request`; mostrar QR + link copiable; estado de la solicitud | ⏳ |
| H3.4 | Aprobación de pago | Web | Acción visible solo con `payment:approve`; confirm + audit | ⏳ |

### Slice 4 — Rutas, Mapa & Realtime (sobre F6 + F8)

| # | Historia | Agente | Entregable | Estado |
|---|----------|--------|-----------|--------|
| H4.1 | Vista de rutas | Web | Planes de ruta del día, paradas ordenadas por prioridad, estado de visita por parada | ⏳ |
| H4.2 | Detalle de visita + evidencia | Web | Foto, GPS y `file_hash` capturados en campo (solo lectura); indicador "evidencia verificada" (hash OK) | ⏳ |
| H4.3 | `CollectorMap` en vivo | Web | Mapa con ubicación de cobradores vía WebSocket (`collector.location`); reconexión con backoff; respeta room `tenant:{accountId}` | ⏳ |
| H4.4 | Eventos en tiempo real | Web | `useRealtime()`: suscribe a `case.updated`/`payment.registered`/`route.completed`; toasts + refresh suave de la vista activa | ⏳ |
| H4.5 | Centro de notificaciones | Web | Bandeja persistente (módulo `notifications` de F8): no leídas, marcar leído, deep-link al recurso | ⏳ |

### Slice 5 — Dashboard & Settings

| # | Historia | Agente | Entregable | Estado |
|---|----------|--------|-----------|--------|
| H5.1 | Dashboard de cartera | Web | Tarjetas KPI (saldo total, tasa de mora, recuperación del mes, casos por estado) + gráficos Recharts; rango de fechas | ⏳ |
| H5.2 | Settings: cuenta & etiquetas | Web | Datos de la cuenta; edición de `credit_configuration` (labels de concepto del tenant) | ⏳ |
| H5.3 | Settings: usuarios (subset) | Web | Listar/invitar/activar/bloquear usuarios; asignar rol existente; **sin** edición de permisos custom (eso es F3) | ⏳ |

### Slice 6 — Calidad transversal

| # | Historia | Agente | Entregable | Estado |
|---|----------|--------|-----------|--------|
| H6.1 | Tests de componentes/hooks | Testing | Vitest + RTL + MSW por slice (mock del BFF); `usePermissions`, `apiClient`, tablas, formularios, reveal PII | ⏳ |
| H6.2 | E2E de flujos críticos | Testing | Playwright: login → dashboard; asignar caso; revelar PII (auditado); registrar/aprobar pago; ver cobrador en mapa | ⏳ |
| H6.3 | A11y & rendimiento | Testing/Web | Auditoría axe (AA), focus rings, `prefers-reduced-motion`; budget de bundle; skeleton en toda carga | ⏳ |

---

## 5. Contratos y Modelo de Datos

> F9 **no define endpoints ni tablas nuevas**: consume los contratos de F4–F8 a través del BFF, con DTOs de `@kobrax/shared`. Esta sección fija **cómo** se consumen.

### 5.1 Patrón de consumo (BFF como proxy de sesión)

```
Browser ──(cookie httpOnly k_access)──► BFF (Next route handler)
   BFF ──(Bearer JWT desde cookie)──► API NestJS (F4–F8)
   API ──{data, meta, error}──► BFF ──► Browser
```

- El navegador **nunca** ve el JWT: el BFF lo inyecta desde la cookie httpOnly.
- 401 desde la API → el BFF intenta `refresh` silencioso; si falla → 401 al browser → redirección a `/login`.
- 403 → se propaga como error tipado → toast "No tienes permiso para esta acción".
- `meta.pagination` (de F4) alimenta el `DataTable` server-side; **nunca** se pagina en cliente.

### 5.2 Endpoints consumidos (referencia, no se implementan aquí)

| Vertical | Endpoints API (dueño) | Permiso UI mínimo |
|----------|----------------------|-------------------|
| Identidad | `GET /auth/me` | (autenticado) |
| Clientes | `GET/POST/PATCH/DELETE /clients`, sub-recursos, `?reveal=true` | `client:read` / `client:write` / `client:pii:read` |
| Créditos | `GET/POST/PATCH /credits`, `/credits/:id/schedule`, `/recalculate-arrears` | `credit:read` / `credit:write` |
| Casos | `GET/POST/PATCH /cases`, asignación, transición (F5) | `case:read` / `case:write` / `case:assign` / `case:close` |
| Rutas/Visitas | `GET /routes`, `/route-stops`, `/field-visits` (F6) | `route:read` / `route:write` / `route:assign` |
| Pagos | `GET /payments`, `POST /payment-requests`, aprobación (F7) | `payment:read` / `payment:write` / `payment:approve` |
| Realtime | WS `tenant:{accountId}`/`user:{userId}`; eventos `case.updated`, `payment.registered`, `collector.location`, `route.completed` (F8) | (según vertical) |
| Notifs | `GET/PATCH /notifications` (F8) | (autenticado) |
| Reportes | KPIs base (F11 ampliará) | `report:read` / `report:export` |

### 5.3 Capa de datos en el front

- **`apiClient`** (H0.4): un único punto que serializa filtros/paginación, normaliza `{data,meta,error}`, y expone métodos tipados por DTO de `@kobrax/shared`. **Prohibido** `fetch` suelto en componentes.
- **Cache/estado servidor:** React Query (o equivalente ya presente) con invalidación por mutación; los eventos realtime invalidan/parchean queries.
- **Tokens visuales:** importados de `packages/shared/src/design/tokens.ts`; ningún color/medida hardcodeada.

### 5.4 Reveal de PII en web (contrato de seguridad)

1. La UI muestra PII **tokenizada por defecto** (`12345***`, `777****`) — viene así de la API.
2. Botón "Revelar" visible **solo** si `usePermissions` confirma `client:pii:read`/`credit:pii:read`.
3. Al revelar, el BFF llama `?reveal=true`; la **API** genera el `audit_log`. El front **no** persiste el plaintext (no se cachea, no va a logs del browser, se limpia al salir de la vista).

---

## 6. Seguridad & Cumplimiento (checklist fintech)

> Hereda el [checklist transversal](./README.md) y añade los controles propios de un cliente web.

### 6.1 Específicos de F9

- [ ] **JWT nunca en el navegador**: solo en cookie httpOnly vía BFF. Sin tokens en `localStorage`/`sessionStorage`.
- [ ] **Cookies**: `httpOnly` + `SameSite=Lax` + `Secure` en prod (https). *(En dev local se usa `next dev` para que viajen sobre http — ver HANDOFF.)*
- [ ] **RBAC en UI = defensa en profundidad, no sustituto**: ocultar un botón **no** autoriza; la API sigue validando. UI y API deben coincidir en el permiso.
- [ ] **PII**: tokenizada por defecto; reveal solo con permiso; plaintext nunca se cachea/loggea en cliente; cada reveal queda auditado por la API.
- [ ] **Anti-enumeración**: errores 404/403 se muestran genéricos ("No encontrado"/"Sin permiso"); la UI no revela existencia de recursos de otro tenant.
- [ ] **CSRF**: mutaciones del BFF protegidas (origin check / token CSRF en handlers que mutan cookies/estado).
- [ ] **CSP + headers**: Content-Security-Policy, `X-Frame-Options: DENY`, `Referrer-Policy`, sin inline scripts no controlados.
- [ ] **XSS**: nada de `dangerouslySetInnerHTML` con datos del servidor sin sanitizar; React escapa por defecto, mantenerlo.
- [ ] **WebSocket por tenant**: el cliente solo se une a su room `tenant:{accountId}`; el servidor (F8) impone el aislamiento — el front no debe poder forzar otra room.
- [ ] **Realtime no filtra**: un evento mal dirigido nunca debe pintar datos de otro tenant (test de aislamiento de room).
- [ ] **Sesión**: expiración → limpieza de estado en memoria + redirección; no quedan datos sensibles en el árbol de React tras logout.
- [ ] **Footer de seguridad** ("🔒 TLS 1.3") visible (continuidad con auth, trust fintech).

### 6.2 Multi-tenant en el panel

- El tenant activo se deriva **siempre** del JWT/sesión (BFF), nunca de un parámetro manipulable por el cliente.
- Cambiar de tenant (multi-cuenta) re-ejecuta el flujo `select-account` del BFF → nuevo contexto RLS server-side. El front **purga** todo el cache de datos al cambiar de cuenta.

---

## 7. Criterios de Aceptación (DoD) — F9

### 7.1 Funcional
- [ ] Un SUPERVISOR inicia sesión y ve el **dashboard de cartera** con KPIs reales de su tenant en la primera carga.
- [ ] Gestión de **clientes** end-to-end: listar/buscar (por hash), ver detalle, crear con detección de duplicado, editar, dar de baja — todo con PII tokenizada y reveal auditado.
- [ ] Gestión de **créditos**: ver cronograma, recalcular mora, crear con wizard (preview de cronograma válido antes de confirmar).
- [ ] **Casos**: tablero, detalle con timeline, asignación, transiciones válidas (UI bloquea saltos inválidos).
- [ ] **Pagos**: historial inmutable, conciliación, generar `payment_request` (QR/link), aprobar si el rol lo permite.
- [ ] **Mapa en vivo**: al menos un cobrador moviéndose en `CollectorMap` vía WebSocket; toasts de eventos llegan solo al tenant correcto.
- [ ] **Settings**: alta/baja de usuario y asignación de rol existente; edición de etiquetas de concepto del tenant.

### 7.2 Seguridad y RBAC
- [ ] La UI **respeta permisos**: un COLLECTOR/role limitado no ve acciones para las que no tiene permiso (test por rol).
- [ ] Ningún token JWT accesible desde JS del navegador (verificado en test/inspección).
- [ ] PII nunca en claro sin reveal+permiso; reveal genera audit (verificado contra la API).
- [ ] Aislamiento realtime: un evento de tenant B nunca se pinta en sesión de tenant A (test).
- [ ] Headers de seguridad (CSP, X-Frame-Options) presentes en respuestas del panel.

### 7.3 Calidad y UX
- [ ] `lint` + `type-check` + `vitest` verdes; cobertura de hooks/utils críticos ≥ 80%.
- [ ] E2E Playwright de los flujos críticos en verde (login→dashboard, asignar caso, reveal PII, registrar/aprobar pago, mapa en vivo).
- [ ] Toda pantalla tiene estados idle/loading(skeleton)/empty/error/success.
- [ ] DoD visual del [design system](../design-system.md §8) cumplido: tokens, tipografía, touch/click targets, focus rings, contraste AA, `prefers-reduced-motion`.
- [ ] Sin colores/medidas fuera de `KOBRAX_TOKENS`.

---

## 8. Estrategia de Tests

| Nivel | Qué se prueba | Herramienta | Cobertura objetivo |
|-------|---------------|-------------|--------------------|
| **Unit** | `usePermissions` (matriz rol→permiso), `apiClient` (normaliza `{data,meta,error}`, 401→refresh, 403→error), serializadores de filtros/paginación, formateo de montos/fechas, lógica de días-mora coloreado | Vitest | ≥ 80% |
| **Componente** | `DataTable` (orden/paginación server), formularios (validación + duplicado debounce), reveal PII (muestra/oculta según permiso), wizard de crédito (gating de Confirmar), toasts de eventos | Vitest + RTL + **MSW** (mock del BFF) | Componentes críticos |
| **Integración (front)** | Flujo de slice contra BFF mockeado: lista→detalle→mutación→invalidación de cache; cambio de tenant purga cache | RTL + MSW | Flujos por slice |
| **E2E** | Login→dashboard; crear/editar cliente; asignar y transicionar caso; revelar PII (auditado); generar y aprobar pago; ver cobrador en `CollectorMap` (WS mock); RBAC por rol | **Playwright** | 5 flujos críticos al 100% |
| **A11y** | Roles ARIA, focus visible, navegación por teclado, contraste, `role="alert"` en errores | axe + Playwright | Sin violaciones AA |
| **Negativos** | JWT no accesible desde JS; PII en claro ausente sin reveal; acción sin permiso oculta y rechazada por API; evento cross-tenant no se pinta | Vitest/Playwright | 100% de casos |

> Reusar la infra existente (`vitest.config.ts`, `vitest.setup.ts`, `src/test/msw-server.ts`). Playwright se incorpora en este epic (no existía aún).

---

## 9. Observabilidad & Métricas

- **Logs del BFF**: estructurados (JSON), sin PII ni tokens, con `requestId`, `accountId`, `userId`, ruta, status, duración. 401/403/5xx siempre logueados.
- **Métricas de producto** (alimentan F11): pantallas más usadas, tiempo a primer dato (TTFB percibido), tasa de reveal de PII por usuario (señal de auditoría/abuso), casos asignados/día desde el panel.
- **Auditoría**: toda mutación desde el panel pasa por la API → `audit_logs` (la responsabilidad de auditar es del backend; el panel solo origina la acción autenticada).
- **Realtime health**: estado de conexión WS visible (conectado/reintentando/offline); métricas de reconexión.
- **Errores de front**: boundary por ruta reporta a un sink (sin PII); el usuario ve `ErrorState` accionable, nunca un stack.

---

## 10. Riesgos y Mitigaciones

| # | Riesgo | Impacto | Mitigación |
|---|--------|---------|-----------|
| R1 | API de F5/F6/F7/F8 aún inestable o incompleta al iniciar F9 | 🔴 Alto | Construir **por slices alineados a cada módulo**; cada slice se libera cuando su API está estable. Mock con MSW mientras tanto. No bloquear el shell ni Clientes/Créditos (F4 ya disponible). |
| R2 | Fuga de PII en el cliente (cache, logs del browser, devtools) | 🔴 Crítico | Tokenización por defecto; plaintext de reveal nunca cacheado ni logueado; limpieza al salir de la vista; reveal auditado por la API; test de ausencia de PII. |
| R3 | RBAC de UI tratado como autorización real | 🔴 Crítico | Doctrina explícita: ocultar ≠ autorizar. La API valida siempre. Tests que confirman 403 aunque el botón se fuerce. |
| R4 | WebSocket filtra eventos entre tenants | 🔴 Crítico | El aislamiento lo impone F8 (rooms por tenant); el front no puede unirse a otra room; test de evento cross-tenant que no se pinta. |
| R5 | Cookies `Secure` rompen sesión en local | 🟡 Medio | Usar `next dev` en local (documentado en HANDOFF); en prod (https) `Secure` es correcto. Detección y banner si /me da 401 por cookie no enviada. |
| R6 | Dashboards pesados sin MV → lentitud | 🟡 Medio | F9 usa queries directas para KPIs base con paginación/limites; el endurecimiento (MV, < 300 ms) es de F11. Skeletons para enmascarar latencia. |
| R7 | Mismatch react/react-dom bajo `node-linker=hoisted` rompe build de Next | 🟡 Medio | Respetar `pnpm.overrides` react/react-dom = 18.2.0 (alineado con RN); arrancar con `pnpm --filter @kobrax/web dev`; no subir versión sin alinear mobile. |
| R8 | Divergencia visual con el design system | 🟢 Bajo | Tokens importados de `@kobrax/shared`; lint visual / DoD visual por pantalla; revisión contra `design-system.md`. |

---

## Cómo levantar / desarrollar (recordatorio)

```powershell
cd D:\kobrax\app-kobrax\kobrax
pnpm --filter @kobrax/web dev          # http://localhost:3000 (usar next dev en local)
pnpm --filter @kobrax/web test         # Vitest + RTL + MSW
```
- BFF lee la API vía `KOBRAX_API_URL` (`.env`, default `:4010/api`). La API y Docker deben estar arriba (ver HANDOFF).

---

*KOBRAX · EPIC F9 — Documento listo para ejecución por slices.*
*Orden recomendado: Slice 0 (shell) → Slice 1 (clientes/créditos, F4 ya listo) → Slice 2 (casos) → Slice 3 (pagos) → Slice 4 (rutas+realtime) → Slice 5 (dashboard/settings) → Slice 6 (calidad).*
