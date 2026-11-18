> ESTADO: VALIDADO v3 (PASS 2026-11-13, P1–P4) — el primer intento dio FAIL por 5 ítems (citas, HUB, IDs de reglas, regresión del gratuito, cruce móvil); corregidos y revalidado 11/11 el mismo día. Decisiones O-5, D-8 y D-9 aprobadas por la usuaria. Alcance confirmado por la usuaria: F15 solo agrega personalización; no cambia el comportamiento de los demás módulos (el workspace solo oculta). Código de producto solo con la orden de abrir la rama.
> **Ampliación 2026-11-13:** onboarding y aprendizaje progresivo (fases **P5 a P10**), detalladas en `PROPUESTA-onboarding-y-aprendizaje.md` con las decisiones D-10 a D-18 aprobadas. El G4 de este plan cubre **P1–P4**; cada fase P5+ valida el suyo antes de tocar código (RULES A7).
> v3 = v2 actualizada a lo que avanzó la épica de roles y permisos (F4–F9) y los ajustes de UI posteriores (§0). Sustituye a la v2. Anexo: `MATRIZ-simplificacion-interna.md` (opciones por módulo y correcciones C-1..C-15 de la validación). Numeración "F15" provisional.

# Plan MVP · Configurable Workspace

## 0. Qué cambió desde la v2 (2026-11-06 → 2026-11-13)
Evidencia: lectura del código en `dev` al 2026-11-13 (PRs #26–#34 mergeados; F14 está en `main` y desplegada). Los hechos H-1..H-14 de §3 se releyeron; los que cambian se marcan allí.

| # | Qué cambió | Efecto en este plan |
|---|---|---|
| 1 | **F6 reordenó el menú** (`nav.ts:64-91`): Oficinas pasó a `/organizacion`, Actividad a `/actividad` (módulo propio, ya no pestaña de Cuenta) y apareció **Seguridad** (`/seguridad`, con Roles y Accesos de soporte). Un administrador ve **14 ítems**, no 12. | §1, §4 (claves de módulo), H-5. Seguridad entra como **troncal** (D-8). |
| 2 | **F5/F7: roles por cuenta y editor de roles.** Los permisos ya no son fijos por rol: cada cuenta edita los suyos (`/seguridad/roles`). | A-2 y las pruebas deben cubrir **roles personalizados**, no solo los de fábrica (§11, §13). P-2 no puede filtrar por nombre de rol. |
| 3 | **Los tableros son por persona** (`dashboards.ownerUserId`; tres tableros de ejemplo la primera vez que alguien abre el dashboard; «predeterminado» también es por persona). | **Obsoleto** el plan de «guardar el tablero por defecto de la cuenta» como parte del preset y la restricción `account:write` + `report:read` (C-9). El preset deja de tocar tableros (§4). |
| 4 | **El selector de widgets ya ofrece contenido, no tipos**, y no ofrece los tipos sin fuente de datos (`widget-registry.ts`, `CatalogItem`). | La tarea «quitar funnel/gauge/histogram/text del buscador» ya está hecha: sale del alcance. |
| 5 | **MFA obligatorio para `ACCOUNT_ADMIN`** (`mfa-policy.ts`). El independiente, que es `ACCOUNT_ADMIN`, ya enrola 2FA al entrar. | Perfil y Seguridad personal confirmados como troncales (§4); sin otro efecto. |
| 6 | **`/auth/me` ya trae `account.soloUser`** (`auth.service.ts:406-447`: un solo miembro activo) y `account.preferences`. | Sirve para S-1 y para ofrecer el preset «Independiente» sin llamada extra; **no** cambia D-2 (el preset sigue siendo elección del administrador). |
| 7 | **F4: archivos con tabla `files` y enlaces firmados; documento enmascarado por permiso.** | Ocultar la sección Adjuntos sigue siendo solo UI; no se oculta ni se toca ningún archivo (R3). El enmascarado de PII no depende del workspace (R2). |
| 8 | **F2/F2b: el aviso «créditos de otra persona» (tarjetas informativas) y el alcance por RLS.** | La tarjeta de créditos ajenos es **P** (aviso de seguridad): no se ofrece ocultarla. |
| 9 | **F8 (móvil) cerrada en código** (roles de campo, canal por sesión, oficinas en `/auth/me`); falta probarla en teléfono. | C-14 y O-1 siguen abiertas, pero ya no dependen de «F8 pendiente». |
| 10 | **Producción corre F14** (deploy del 2026-11-13). Base de producción reseteada con seed demo. | O-4 queda **resuelta**: no hay nada que esperar. F15 no lleva migración, así que no arriesga datos. |

## 1. Objetivo
Que cada organización oculte lo que no usa (módulos opcionales y opciones internas de bajo riesgo) sin tocar datos, permisos ni topes del plan. Impacto medible de la v1: el menú del independiente (un `ACCOUNT_ADMIN`) pasa de 14 ítems (`NAV`, `nav.ts:64-91`) a 8: Inicio, Cartera, Mora, Agenda, Pagos, Seguridad, Cuenta y Perfil (se ocultan Rutas, Equipo, Organización, Importar, Exportar y Actividad), y el alta de crédito pasa de 3 modalidades y ~10 controles financieros a la modalidad que usa.

## 2. Rama y secuencia
- Una rama por fase, desde `dev` (que ya contiene F14 completa): `f15/p1-contrato-api`, `f15/p2-web-navegacion`, `f15/p3-opciones-credito-cliente`, `f15/p4-pestana-presets`; onboarding: `f15/p5-catalogo-recomendacion`, `f15/p6-onboarding-estado`, `f15/p7-asistente`, `f15/p8-bienvenida-primeros-pasos`, `f15/p9-recorrido-spotlight`, `f15/p10-guias-ayuda`. Commits locales; push/PR solo si la usuaria lo pide.
- **Secuencia (O-4, RESUELTA 2026-11-13):** los permisos (F4→F9) están cerrados, mergeados a `main` y desplegados; la condición de la usuaria («personalización al final») se cumplió. Sigue valiendo que no se abre rama ni se escribe código hasta el PASS de G4 y la orden de la usuaria.

## 3. Estado inicial con evidencia
Clases del marco. "VERIFICADO (G4)" = leído en código por una revisión delegada el 2026-11-06 con `archivo:línea`; la lectura final de cada ítem la repite quien implemente cada fase (G4 de la fase).

| ID | Clase | Hecho | Evidencia |
|---|---|---|---|
| H-1 | VERIFICADO (G4) | `accounts.configuration` es jsonb libre; hoy guarda `preferences`, `billing`, `importConfig`, `casePriority`, `arrears`, `creditLabels`. Sin trigger ni límite de tamaño. RLS `tenant_self`. | `schema.prisma:96`; `rls/001_enable_rls.sql:98-99` (`tenant_self` sobre `accounts`; corregido en G4 2026-11-13) |
| H-2 | VERIFICADO (G4) | `PATCH /accounts/me` exige `account:write`; DTO de lista blanca (`forbidNonWhitelisted`). El merge de `configuration` solo corre si viene `preferences` o `billing`. `serializeAccount` es lista blanca. | `accounts.controller.ts:101`; `validation-pipe.ts:31`; `accounts.service.ts:188` (relevado 2026-11-13: la condición `if (dto.preferences || dto.billing)` sigue igual); `accounts.serializer.ts` |
| H-3 | VERIFICADO (G4) | `GET /auth/me` ya lee `configuration` y devuelve `account.preferences` y `account.soloUser`; ampliar con `workspace` no toca JWT ni permisos. (v3: se agregó `soloUser`.) | `auth.service.ts:~383-418`; `user.types.ts:52-58` |
| H-4 | VERIFICADO (G4) | Agregar un campo a un DTO existente no altera `authz-snapshot.json` (la fila es por handler) ni `authz-dto-ids.spec`. | `authz-coverage.spec.ts`, `authz-dto-ids.spec.ts` |
| H-5 | VERIFICADO (G4) · ACTUALIZADO v3 | Menú hardcodeado, filtra solo por permiso (y `anyOf` para Seguridad); `crumbsFor` recorre `NAV` completo; dos filtros de pestañas de Cuenta (uno sin uso real). **Cambió con F6:** 14 ítems para un administrador; Cuenta tiene 7 pestañas (General, Plan, Cobranza, Mensajes, Catálogos, Facturación, Avanzado): **Oficinas y Actividad ya no son pestañas**, son los módulos `/organizacion` y `/actividad`. | `nav.ts:64-91,108-111`; `cuenta/cuenta-tabs.tsx:20`; `cuenta-tabs.ts:16-33` |
| H-6 | VERIFICADO (G4) | `x-k-path` existe en todo `(panel)`, pero un layout no se re-ejecuta en navegación suave → el guard va en cada `page.tsx` de módulo. | `middleware.ts:73` (`headers.set('x-k-path', …)`; el rango 170-186 de la v2 no lo contiene); ver C-7 |
| H-7 | VERIFICADO (G4) | `CreateCreditDto` solo exige `clientId` y `principalAmount`; el servidor no completa defaults dentro de `terms`; `agreed_installment` no necesita tasa/tipo/amortización/seguro/cargos. | `credit.dto.ts:47,53,85`; `packages/shared/src/utils/credit-engine.ts:203-206,298-301,531` (despacho por modalidad, cuota acordada, `parseCreditTerms`); ver C-5 |
| H-8 | VERIFICADO (G4) | `termUnit` arranca en `YEARS` y `ratePeriod` en `ANNUAL`; `OFFERED_FREQUENCIES` es filtrable; hay precedente de "conservar el valor guardado" (`amortizations`, `termUnits`). | `credit-form.ts:131-149`; `credit-terms-fields.tsx:87-102,262`; `credit.enum.ts:22-27` |
| H-9 | VERIFICADO (G4) · RELEÍDO v3 | El servidor ya acepta como destinatario de ruta a cualquier usuario activo; el bloqueo es solo web y filtra por **nombre de rol** `COLLECTOR`. Con roles personalizados (F7) ese filtro es frágil: P-2 debe decidir si filtra por permiso (`route:execute`) en vez de por rol. | `routes.service.ts:177-192`; `planificar/page.tsx:55` |
| H-10 | VERIFICADO (G4) | Un `ACCOUNT_ADMIN` único nunca crea `route_change_request`. | `route-access.ts:~44-52`; `route-changes.service.ts:60` |
| H-11 | VERIFICADO (G4) · RELEÍDO v3 | El dueño de una cuenta nueva es `ACCOUNT_ADMIN`, rol crítico: MFA obligatorio. | `accounts.service.ts:76,135`; `mfa-policy.ts` |
| H-12 | VERIFICADO (G4) | Planes: sin gating de módulos; topes `users/credits/clients` bloquean en servidor, `photos/actions` solo avisan. | `plan-limits.service.ts:144`; `plans.ts:62-120`; `field.service.ts:66-70` |
| H-13 | VERIFICADO (G4) | "Beneficiario" no existe como campo; solo `PayerParty.BENEFICIARY` en 3 listas (web, móvil, literal del validador). | `income.enum.ts:40-48`; `recovery-activity.ts:140`; móvil `apps/mobile/src/reason-block.tsx:25`; web `components/activity-context-fields.tsx:79-84` (corregido en G4 2026-11-13) |
| H-14 | VERIFICADO (G4) · ACTUALIZADO v3 | El móvil: **pestañas filtradas por permiso desde F8** (`tabAllowed`), catálogos cacheados, acciones encoladas; la API no exige foto/firma ni GPS real (sí `lat/lng`). | `apps/mobile/app/(tabs)/_layout.tsx:12,69-73`; `apps/mobile/src/tabs.ts:17`; `hydrate.ts:39-52`; `field.dto.ts:26-27` |
| H-15 | INFERIDO | Un workspace malformado guardado a mano se serviría sin validar si `workspaceOf` no es tolerante. | diseño de §5 |
| H-17 | VERIFICADO (v3) | Los tableros son de cada persona (`ownerUserId`); no existe un «tablero por defecto de la cuenta». Cada persona recibe tres de ejemplo al abrir el dashboard. Rige `report:read`. | `dashboards.service.ts:28-56`; `dashboards.controller.ts:14` |
| H-18 | VERIFICADO (v3) | El selector de widgets ofrece contenido (`CatalogItem`) y no ofrece los tipos sin fuente; los tipos sin fuente siguen en `WIDGET_DEFINITIONS` para abrir tableros guardados. | `widget-registry.ts` |
| H-19 | VERIFICADO (v3) | Los permisos son por cuenta y editables (F5/F7); `NAV` pide permisos concretos por sección (`office:read`, `user:read`, `audit:read`, `role:read`, `account:read`…). | `nav.ts:73-89`; `docs/epics/F14/plans/F5-roles-por-cuenta.md`, `F7-editor-de-roles.md` |
| H-16 | DESCONOCIDO | Ningún test cubre hoy `(panel)/layout.tsx` ni `dashboard/page.tsx`; la navegación suave del guard no está probada en este repo. | pregunta para P2: prueba real |
Más: correcciones C-1..C-15 de la matriz (C-6, C-9 y C-10 con nota v3).

## 4. Alcance
**Troncales (no apagables):** Cartera, Mora, Pagos, Agenda, Inicio, Cuenta (General, Plan, Cobranza, Mensajes, Catálogos, Avanzado, Espacio de trabajo), Perfil, Seguridad personal (`/settings/*`) y **Seguridad del acceso (`/seguridad`: Roles y Accesos de soporte), propuesta D-8**: sin ella nadie edita permisos ni revoca accesos. Una pestaña de un módulo troncal sí puede ocultarse **solo si** la matriz la marca S (p. ej. Facturación): troncal protege el módulo, no cada una de sus partes.

**Ola 1a — v1 (propuesta del revisor; pendiente de confirmar por la usuaria)**
1. Módulos ocultables: Rutas, Equipo, Organización (`/organizacion`), Importar, Exportar y Actividad (`/actividad`, ver D-9). Menú + guard por página + enlaces + migas + notificaciones.
2. Crédito: modalidad fija; con acordada, `termUnit = INSTALLMENTS` fijo (C-3); bloque avanzado (tipo, convención, base, seguro, cargos) sin tocar `arrearsMethod` (C-4); método de mora → default de la cuenta; frecuencias permitidas.
3. Cliente: ocultar secciones Ingresos, Garantes, Garantías, Adjuntos y campos género, canal preferido, NIT fiscal.
4. Pestaña "Espacio de trabajo" en Cuenta + presets Independiente / Equipo / Completo, con aviso "ocultar no es autorizar".
5. P-2 (cambio web de Planificar; tarea aparte, S).

**Ola 1b — después, con plan propio:** contexto de gestión en Mora **y** Agenda a la vez (C-2); ficha de Mora; Agenda (vistas, posponer); Pagos (canal, notas, recibo, foto); Cuenta (Facturación + alerta, transferencia de propiedad); P-1 (banco en agenda) si se recorta medios de pago. `BENEFICIARY` **queda fuera de la v1 (D-3 aprobada)** y solo entra, si la usuaria lo reabre, en 1b.

**Ola 2 — onboarding y aprendizaje (P5–P10; propuesta aprobada, plan de cada fase just-in-time):** asistente de 8 pasos para el administrador de una cuenta nueva (tras MFA), bienvenida de invitados, primeros pasos en Inicio derivados de datos reales, **recorrido con spotlight por todo el menú y la barra superior**, guías de pantalla y Centro de ayuda `/ayuda`. Estado de la organización en `configuration.onboarding`; estado de cada persona en la tabla nueva `user_guide_states` (**única migración de F15**, aditiva, fase P6). **Fuera:** sugerencias de descubrimiento (D-15), videos, el móvil (se hará todo junto en una etapa posterior) y las guías de las opciones de la ola 1b.

**Fuera de alcance (v3):** tableros y widgets (ya son por persona y configurables, §0 #3-#4); la tarjeta de créditos ajenos (P); campos individuales distintos de los listados, constructor libre de pantallas, bloqueo en API (D-1), cambios en móvil (O-1/F8), gating comercial (D-7), variantes por rol u oficina (D-6), tabla propia, operaciones sobre catálogos (R9).

## 5. Contrato y arquitectura
```
accounts.configuration.workspace = {
  version: 1,                 // versión del contrato
  rev: <entero>,              // control optimista: el PATCH envía el rev que leyó
  hiddenModules: ModuleKey[], // ocultar, no deshabilitar
  options: { [OptionKey]: boolean | string | string[] }
}
```
- `options`: `false` = ocultar sección/campo; `string` = valor fijo; `string[]` = opciones permitidas. Ausente = visible/sin restricción. Ausente todo el documento = Completo (R5).
- Catálogos en `packages/shared`: `WORKSPACE_MODULES` (`key, navKeys, routes[], requires[], core`) y `WORKSPACE_OPTIONS` (`key, module, kind, risk, default, requires, mobile`). Solo opciones S o D; las P no tienen entrada.
- `parseWorkspace` tolerante al leer (ignora claves desconocidas; versión mayor a la conocida → se trata como Completo y no se modifica); estricto al escribir. `resolveWorkspace(config, { planCode })` devuelve lo visible; `workspaceDefaults()` produce el payload que antes pedía el campo oculto.
- **API (sin endpoint nuevo):** `workspace` en `UpdateAccountDto`; ampliar la condición de merge de `accounts.service.ts` (C-12); reemplazo completo del subárbol `workspace` dentro de una transacción con comprobación de `rev` (409 si no coincide; 409 si el guardado trae versión menor que la almacenada); tope de tamaño; auditoría solo del subárbol `workspace` (C-13); `workspace` en `/auth/me → account` y, si hace falta, en el serializer de `/accounts/me`.
- **Web:** `useWorkspace()` (`shows`, `fixed`, `choices`) desde el mismo `me` (sin llamada extra); entra por el layout (`visibleNav`, `crumbsFor`), por el filtro cliente de pestañas de Cuenta (C-6) y por contexto en los formularios. Guard por `page.tsx` de módulo + layout (C-7); al redirigir se muestra un aviso "módulo oculto para tu organización". `router.refresh()` tras guardar. Enlaces/notificaciones a módulos ocultos se resuelven a Inicio (C-8).
- **Móvil:** sin cambios. El contrato ya viaja por `/auth/me`; F8 lo consume con el mismo `resolveWorkspace` (C-14).

**Reglas:** R1 solo quita; R2 la API no consulta el workspace; R3 nunca se borra ni modifica un dato; R4 no va en el JWT ni toca `authz_version`; R5 ausente = Completo; R6 todo `fixed` lleva `default` válido contra el motor; R7 una opción oculta nunca oculta un valor ya guardado del registro que se ve o edita (en alta no hay registro: manda la config; en edición: `shows` es verdadero si el registro tiene un valor distinto del default fijo, y `workspaceDefaults()` nunca sobrescribe un valor existente); R8 `requires` entre opciones y módulos; R9 ninguna opción actúa sobre catálogos.

**Salvaguardas al guardar (servidor):** S-1 Equipo no se oculta con más de un miembro o invitaciones pendientes; S-2 Oficinas no con más de una oficina activa; S-3 Rutas no con rutas en curso; S-4 listas permitidas ≥1 y fijos válidos (p. ej. frecuencia o modalidad existente); S-5 solo `account:write` escribe; S-6 los topes del plan siguen aplicando con módulos ocultos; S-7 (D-9) Actividad no se oculta con más de un miembro activo. Mensajes con conteos solo en la respuesta del PATCH a quien tiene `account:write`, nunca en `/auth/me`.

## 6. Dependencias
- F14: **cerrada y desplegada** (F1–F9; 2026-11-13). No tocar `common/authz/*`, `auth.service.ts` (permisos), `rls/*`, `schema.prisma`. Sin migración. Este plan no agrega endpoints (`PATCH /accounts/me` ya existe, H-4); si alguna fase añadiera un handler, debe registrarse en `authz-snapshot.json`.
- P-2 (web, S) antes de ofrecer Rutas al independiente. P-1 solo para 1b.
- Decisión O-4 (secuencia): **resuelta** (§14).
- **Cruce con el móvil (RULES D1, registrado en G4 2026-11-13).** F15 no cambia código del móvil, pero sí `packages/shared` (`user.types.ts`, `credit-form.ts`, módulo workspace nuevo) y el móvil lo importa: `apps/mobile/app/prestamo/nuevo.tsx` crea créditos con `buildNewCreditPayload` y `creditFormState` de `credit-form.ts`, y `apps/mobile/src/auth-service.ts` ya lee `account.soloUser` de `/auth/me`. Estado de la alineación móvil↔web: EN EJECUCIÓN, ronda 3 (`docs/epics/F10/plans/alineacion-web/README.md`; principio P-4: la regla compartida vive en `shared`). **Condición:** los cambios en `credit-form.ts` son **solo aditivos** (helper `workspaceDefaults()` y filtros opcionales; ninguna firma ni valor por defecto existente cambia); el campo `workspace` de `/auth/me` es opcional en el tipo; el cierre de P1 y P3 incluye `tsc` del móvil y sus pruebas de crédito. El móvil no consulta el workspace en v1 (O-1/C-14).

## 7. Archivos afectados e IDs HUB
F15 tiene su HUB en `hub/HUB.md` (IDs `H15-001`…`H15-025`, sembrados en el G4 del plan, 2026-11-13) y su `hub/IMPACT-MAP.md`; cruza con los HUB de F13 y F14. Cada ID se relee y se pasa a `VERIFICADO <fecha>` en el G4 de su fase. Archivos: `packages/shared` (nuevo módulo workspace, `user.types.ts`, `credit-form.ts`); `accounts.service.ts`, `account.dto.ts`, `accounts.serializer.ts`, `auth.service.ts` (`me`); `lib/nav.ts`, `(panel)/layout.tsx`, `panel-shell.tsx`, `cuenta/cuenta-tabs.tsx`, `lib/notifications.ts`, `billing-alert.tsx` (1b); `credit-terms-fields.tsx`, `loan-form.tsx`, `credit-editor.tsx`, `client-form.tsx`, `client-card.tsx`; `rutas/planificar/page.tsx` (P-2); `messages/es.json`, `en.json`. Cada archivo se consulta en el HUB antes de tocarlo.

## 8. Invariantes
CLAUDE.md: 1 multi-tenant (vive en la fila de `accounts`), 3 audit trail, 6 TypeScript estricto sin `any`, 7 respuesta `{data, meta, error}`. F13/RULES heredadas por F14 y por F15 (`RULES.md` de esta épica): **A2** (propuesta ≠ decisión), **A3** (clase de evidencia), **A4** (consultar HUB e IMPACT-MAP antes de tocar algo transversal), **A5** (nada exitoso sin salida comprobable), **A6** (código manda), **A7** (plan just-in-time, una fase = una rama), **A8** (las transiciones de gate se confirman), **B12** (specs nuevos de API en el script `test`), **C1–C5** (tenant gratuito individual: no configurar nada nuevo, regresión en G5, capacidad por permiso y no por tipo de tenant) y **D1** (cruce móvil, §6). F14-A H-2 (permisos en JWT + `authz_version`: no se toca). F14-B: rama por fase, sin PASS de G4 no hay código de producto, specs nuevos de API en el script `test`, migraciones aditivas (aquí ninguna).

## 9. Perfiles de tenant
| Perfil | Qué cambia | Protección |
|---|---|---|
| Independiente (1 `ACCOUNT_ADMIN`, FREE, 1 oficina; `account.soloUser` en `/auth/me`) | Es el destinatario del impacto | Preset a mano; Cuenta, Plan y Seguridad siempre visibles; MFA ya obligatorio; P-2 |
| Equipo (varios miembros, 1 oficina) | Puede ocultar Oficinas/Importar/Exportar | S-1 impide ocultar Equipo con miembros |
| Multi-oficina / banco | Normalmente "Completo" | S-2 impide ocultar Oficinas con más de una |
| Equipo con roles personalizados (F7) | El workspace solo quita sobre lo que el rol ya permite | A-2 con roles de fábrica **y** personalizados |
| Usuario multi-cuenta | Workspace por cuenta activa | Cambio de cuenta recarga `me`; prueba dedicada |
| Plan gratuito vs pago | Sin diferencia en v1 | `planGate` vacío (D-7); topes siguen en servidor |
Cuentas existentes y nuevas: sin documento = Completo; ningún registro ni seed escribe un workspace.

## 10. Riesgos
| Riesgo | Mitigación |
|---|---|
| PATCH con solo `workspace` se descarta en silencio (C-12) | Prueba dedicada; ampliar la condición |
| Guard en layout no cubre navegación suave (C-7) | Guard por `page.tsx` + prueba real |
| Enlaces a módulos ocultos (C-8) | Criterio A-5 con recorrido del catálogo |
| Default inválido al ocultar (`termUnit`, `ratePeriod`, CASH) | R6 + prueba contra el motor en `shared` |
| Admin se deja la cuenta inusable | S-4, Cuenta troncal, "Restablecer a Completo" en la pestaña y prueba |
| Dos admins pisándose | `rev` + 409 |
| Confundir ocultar con autorizar | Texto en pantalla; nombre `hiddenModules`; R2 |
| Sesiones abiertas | `router.refresh()` en quien guarda; el resto al recargar; se documenta en pantalla |
| Móvil distinto de la web | O-1; F8 reutiliza `resolveWorkspace` |
| Choque con F14 | §6 |

## 11. Pruebas
- **shared** (Vitest): `parseWorkspace` (tolerante/estricto/versión mayor), `resolveWorkspace`, cierre de `requires`, propiedad "nunca añade", defaults de cada `fixed` pasan `parseCreditTerms`/`resolveCreditTerms` (R6), `catálogo P ⇒ sin entrada`.
- **API:** PATCH solo-`workspace` persiste; no pisa otras claves de `configuration` (replicar `accounts.service.spec.ts:336-363`); `rev` y 409; S-1..S-5; tamaño; auditoría solo `workspace`; aislamiento cuenta A/B; `/auth/me` incluye `workspace` y no filtra conteos; un rol sin `account:write` recibe 403 en `PATCH /accounts/me` (probar COLLECTOR y SUPERVISOR de fábrica **y un rol personalizado**); quien tiene `account:read` lee sin editar; topes del plan con módulo oculto; `authz-coverage` y `authz-dto-ids` sin cambio. **Todos los specs nuevos se registran en el script `test` de `apps/api/package.json`.**
- **Web (Vitest, `src/**/*.test.{ts,tsx}`):** ampliar `nav.test.ts` y el filtro de pestañas que se dibuja (C-6); guard por página; crédito con modalidad fija (alta y edición de un crédito de otra modalidad); `credit-editor` (hoy sin test); formularios de cliente; pestaña de configuración; paridad es/en.
- **Dorado A-1:** sin `workspace`, nav, pestañas y formularios idénticos a hoy.
- **Regresión del gratuito individual (RULES C4):** el G5 de cada fase corre los **12 flujos R-1** de `docs/epics/F13/target/09-compatibilidad-tenants.md` («Regresión del individual — lista de flujos») con el workspace vacío y con el preset «Independiente», y pega la salida en `execution/VERIFICATIONS.md`. Un gratuito individual que no configura nada (C2) debe seguir viendo todo lo que hoy ve (A-1); el preset es opcional y lo elige él.

## 12. Rollback
Sin migración: borrar `configuration.workspace` (o guardar "Completo") restaura el comportamiento. Revertir el código es seguro: el jsonb extra se ignora. Una opción `fixed` solo afecta el formulario; los registros guardados no cambian.

## 13. Tareas y criterios
**Tareas ordenadas (datos → API → web → móvil):** P1 contrato en `shared` + API + auditoría + pruebas → P2 navegación, guard por página, migas, enlaces, notificaciones → P-2 → P3 opciones de crédito y cliente → P4 pestaña, presets, textos es/en, "Restablecer" → **P5** catálogo de guías y `recommendSetup` en `shared` → **P6** `configuration.onboarding`, `/auth/me`, tabla `user_guide_states` y su endpoint (migración aditiva; snapshot de puertas aprobado por la usuaria) → **P7** asistente de 8 pasos → **P8** bienvenida de invitados y primeros pasos → **P9** motor de spotlight y recorrido general → **P10** guías de pantalla y `/ayuda`. Móvil: una etapa posterior que porte todo lo construido.

**Criterios de aceptación:** A-1 sin `workspace` todo idéntico; A-2 `visible(workspace) ⊆ visible(permisos)` para todo rol (de fábrica y personalizado) y configuración; A-3 configuración inválida (troncal, `requires`, S-1..S-5, tamaño, versión) → 422/409 y nada se guarda; A-4 URL directa o enlace suave a módulo oculto → redirección con aviso; A-5 ningún enlace dibujado, miga ni notificación apunta a un módulo oculto; A-6 con modalidad fija no hay selector y un crédito existente de otra modalidad se abre, muestra y guarda sin perder datos; A-7 cada cambio auditado (subárbol `workspace`, quién, cuándo, ip); A-8 cuenta A no afecta a B; A-9 `/auth/me` entrega el workspace a todo miembro (sin conteos); `PATCH` y `GET /accounts/me` según permiso; A-10 topes del plan intactos; A-11 `authz-coverage` sin diferencias; A-12 con cada opción de 1a activa, crear y editar crédito y cliente pasa por la API real sin campos exigidos vacíos; A-13 valor guardado oculto se muestra y se conserva; A-14 pruebas existentes verdes con configuración vacía; A-15 ninguna opción P tiene entrada; A-16 dos guardados con el mismo `rev` → el segundo recibe 409.

**Cierre por fase (evidencia exigida):** G5 verificación funcional, técnica, de seguridad y regresión con comandos y salida registrados en `execution/VERIFICATIONS.md` (T5); G6 `/code-review` + impacto transversal (web/API/móvil) revisado; G7 HUB (`H15-nnn`) y HANDOFF al día, STATUS actualizado.

## 14. Decisiones
| ID | Estado | Decisión |
|---|---|---|
| D-1 | APROBADA (usuaria, 2026-11-06) | Solo UI en v1; la API no consulta el workspace. |
| D-2 | RESUELTA por evidencia | Sin preset automático por `accountType` (siempre `INDEPENDENT`). |
| D-3 | APROBADA (usuaria, 2026-11-06) | Beneficiario fuera de v1 (solo reabrible en 1b). |
| D-4 | APROBADA, CUMPLIDA (v3) | Rama nueva tras F2b; F14 completa está en `dev` y `main`. |
| D-5 | RESUELTA (usuaria, 2026-11-06) | Mora y los troncales no se apagan. |
| D-6 | APROBADA (usuaria, 2026-11-06) | Workspace por organización; variantes por rol/oficina después. |
| D-7 | APROBADA (usuaria, 2026-11-06) | Sin gating comercial por módulo; gancho `planGate` vacío. |
| O-1 | ABIERTA | ¿Rutas se oculta también en móvil en F8? (no frena la v1). |
| O-2 | RESUELTA (usuaria) | Cuentas nuevas en "Completo"; el admin elige "Independiente". |
| O-3 | RESUELTA (usuaria) | El independiente puede planificarse rutas a sí mismo → P-2 (cambio web). |
| O-4 | RESUELTA por evidencia (2026-11-13) | Permisos cerrados y desplegados: se puede implementar. Falta solo el PASS de G4 y la orden. |
| O-5 | RESUELTA (usuaria, 2026-11-13) | Ola 1a como §4; todo lo demás a 1b. |
| D-10…D-18 | APROBADAS (usuaria, 2026-11-13) | Onboarding y aprendizaje: dentro de F15 (D-10); asistente de 8 pasos (D-11); recomendación por plan solo como sugerencia (D-12); estado de guías en el servidor (D-13) en tabla propia (D-17); asistente solo para administradores de cuentas nuevas tras MFA (D-14); sin sugerencias por ahora (D-15); móvil, videos y guías de la ola 1b fuera, Centro de ayuda dentro (D-16); recorrido con spotlight por todo el menú (D-18). Detalle en `PROPUESTA-onboarding-y-aprendizaje.md` §6. |
| D-8 | APROBADA (usuaria, 2026-11-13) | Seguridad del acceso (`/seguridad`) es **troncal**: no se puede ocultar. Es donde se editan roles y se revocan accesos. |
| D-9 | APROBADA (usuaria, 2026-11-13) | Actividad (`/actividad`) es ocultable **solo en pantalla** y **solo mientras la cuenta tenga un único miembro activo** (salvaguarda S-7); la auditoría sigue registrándose y la API no cambia. |
