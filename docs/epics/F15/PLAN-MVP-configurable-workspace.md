> ESTADO: BORRADOR v2 (2026-11-06) — G4 sin PASS: pendiente de la usuaria el recorte de la ola 1 (§4) y la secuencia (O-4). No se modifica código de producto hasta PASS.
> Sustituye a la v1. Anexo: `MATRIZ-simplificacion-interna.md` (opciones por módulo y correcciones C-1..C-15 de la validación). Numeración "F15" provisional.

# Plan MVP · Configurable Workspace

## 1. Objetivo
Que cada organización oculte lo que no usa (módulos opcionales y opciones internas de bajo riesgo) sin tocar datos, permisos ni topes del plan. Impacto medible de la v1: el menú del independiente pasa de 12 ítems (`NAV`, `nav.ts:48-61`) a 6, y el alta de crédito pasa de 3 modalidades y ~10 controles financieros a la modalidad que usa.

## 2. Rama y secuencia
- Una rama por fase, desde `dev` ya con F2b mergeada: `f15/p1-contrato-api`, `f15/p2-web-navegacion`, `f15/p3-opciones-credito-cliente`, `f15/p4-pestana-presets`. Commits locales; push/PR solo si la usuaria lo pide.
- **Secuencia (O-4, abierta):** la memoria de la usuaria (2026-11-06) pide dejar la personalización para después de cerrar los permisos (F4→F9). D-4 solo exigía cerrar F2b. Hasta que la usuaria decida, este plan es de diseño y no se abre ninguna rama.

## 3. Estado inicial con evidencia
Clases del marco. "VERIFICADO (G4)" = leído en código por una revisión delegada el 2026-11-06 con `archivo:línea`; la lectura final de cada ítem la repite quien implemente cada fase (G4 de la fase).

| ID | Clase | Hecho | Evidencia |
|---|---|---|---|
| H-1 | VERIFICADO (G4) | `accounts.configuration` es jsonb libre; hoy guarda `preferences`, `billing`, `importConfig`, `casePriority`, `arrears`, `creditLabels`. Sin trigger ni límite de tamaño. RLS `tenant_self`. | `schema.prisma:96`; `rls/001_enable_rls.sql:89-96` |
| H-2 | VERIFICADO (G4) | `PATCH /accounts/me` exige `account:write`; DTO de lista blanca (`forbidNonWhitelisted`). El merge de `configuration` solo corre si viene `preferences` o `billing`. `serializeAccount` es lista blanca. | `accounts.controller.ts:101`; `validation-pipe.ts:31`; `accounts.service.ts:~191`; `accounts.serializer.ts` |
| H-3 | VERIFICADO (G4) | `GET /auth/me` ya lee `configuration` y devuelve `account.preferences`; ampliar con `workspace` no toca JWT ni permisos. | `auth.service.ts:~383-418`; `user.types.ts:52-58` |
| H-4 | VERIFICADO (G4) | Agregar un campo a un DTO existente no altera `authz-snapshot.json` (la fila es por handler) ni `authz-dto-ids.spec`. | `authz-coverage.spec.ts`, `authz-dto-ids.spec.ts` |
| H-5 | VERIFICADO (G4) | Menú hardcodeado, filtra solo por permiso; `crumbsFor` recorre `NAV` completo; dos filtros de pestañas de Cuenta (uno sin uso real). | `nav.ts:48-124`; `panel-shell.tsx:357`; `cuenta/cuenta-tabs.tsx:20`; `cuenta-tabs.ts:33-36` |
| H-6 | VERIFICADO (G4) | `x-k-path` existe en todo `(panel)`, pero un layout no se re-ejecuta en navegación suave → el guard va en cada `page.tsx` de módulo. | `middleware.ts:70-75,170-186`; ver C-7 |
| H-7 | VERIFICADO (G4) | `CreateCreditDto` solo exige `clientId` y `principalAmount`; el servidor no completa defaults dentro de `terms`; `agreed_installment` no necesita tasa/tipo/amortización/seguro/cargos. | `credit.dto.ts:47,53,85`; `credit-engine.ts:531-567,796`; ver C-5 |
| H-8 | VERIFICADO (G4) | `termUnit` arranca en `YEARS` y `ratePeriod` en `ANNUAL`; `OFFERED_FREQUENCIES` es filtrable; hay precedente de "conservar el valor guardado" (`amortizations`, `termUnits`). | `credit-form.ts:131-149`; `credit-terms-fields.tsx:87-102,262`; `credit.enum.ts:22-27` |
| H-9 | VERIFICADO (G4) | El servidor ya acepta como destinatario de ruta a cualquier usuario activo; el bloqueo es solo web. | `routes.service.ts:177-192`; `planificar/page.tsx:55` |
| H-10 | VERIFICADO (G4) | Un `ACCOUNT_ADMIN` único nunca crea `route_change_request`. | `route-access.ts:~44-52`; `route-changes.service.ts:60` |
| H-11 | VERIFICADO (G4) | El dueño de una cuenta nueva es `ACCOUNT_ADMIN`. | `accounts.service.ts:76,135` |
| H-12 | VERIFICADO (G4) | Planes: sin gating de módulos; topes `users/credits/clients` bloquean en servidor, `photos/actions` solo avisan. | `plan-limits.service.ts:144`; `plans.ts:62-120`; `field.service.ts:66-70` |
| H-13 | VERIFICADO (G4) | "Beneficiario" no existe como campo; solo `PayerParty.BENEFICIARY` en 3 listas (web, móvil, literal del validador). | `income.enum.ts:40-48`; `recovery-activity.ts:140`; `reason-block.tsx:20` |
| H-14 | VERIFICADO (G4) | El móvil: pestañas fijas, catálogos cacheados, acciones encoladas; la API no exige foto/firma ni GPS real (sí `lat/lng`). | `(tabs)/_layout.tsx:62-66`; `hydrate.ts:39-52`; `field.dto.ts:26-27` |
| H-15 | INFERIDO | Un workspace malformado guardado a mano se serviría sin validar si `workspaceOf` no es tolerante. | diseño de §5 |
| H-16 | DESCONOCIDO | Ningún test cubre hoy `(panel)/layout.tsx` ni `dashboard/page.tsx`; la navegación suave del guard no está probada en este repo. | pregunta para P2: prueba real |
Más: correcciones C-1..C-15 de la matriz.

## 4. Alcance
**Troncales (no apagables):** Cartera, Mora, Pagos, Agenda, Inicio, Cuenta (General, Plan, Cobranza, Avanzado, Espacio de trabajo), Perfil y Seguridad. Una pestaña de un módulo troncal sí puede ocultarse **solo si** la matriz la marca S (p. ej. Facturación): troncal protege el módulo, no cada una de sus partes.

**Ola 1a — v1 (propuesta del revisor; pendiente de confirmar por la usuaria)**
1. Módulos ocultables: Rutas, Equipo, Oficinas, Importar, Exportar. Menú + guard por página + enlaces + migas + notificaciones.
2. Crédito: modalidad fija; con acordada, `termUnit = INSTALLMENTS` fijo (C-3); bloque avanzado (tipo, convención, base, seguro, cargos) sin tocar `arrearsMethod` (C-4); método de mora → default de la cuenta; frecuencias permitidas.
3. Cliente: ocultar secciones Ingresos, Garantes, Garantías, Adjuntos y campos género, canal preferido, NIT fiscal.
4. Pestaña "Espacio de trabajo" en Cuenta + presets Independiente / Equipo / Completo, con aviso "ocultar no es autorizar".
5. P-2 (cambio web de Planificar; tarea aparte, S).

**Ola 1b — después, con plan propio:** contexto de gestión en Mora **y** Agenda a la vez (C-2); ficha de Mora; Agenda (vistas, posponer); Pagos (canal, notas, recibo, foto); Cuenta (Facturación + alerta, Actividad, transferencia); tablero por defecto y widgets; P-1 (banco en agenda) si se recorta medios de pago. `BENEFICIARY` **queda fuera de la v1 (D-3 aprobada)** y solo entra, si la usuaria lo reabre, en 1b.

**Fuera de alcance:** campos individuales distintos de los listados, constructor libre de pantallas, bloqueo en API (D-1), cambios en móvil (O-1/F8), gating comercial (D-7), variantes por rol u oficina (D-6), tabla propia, operaciones sobre catálogos (R9).

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

**Salvaguardas al guardar (servidor):** S-1 Equipo no se oculta con más de un miembro o invitaciones pendientes; S-2 Oficinas no con más de una oficina activa; S-3 Rutas no con rutas en curso; S-4 listas permitidas ≥1 y fijos válidos (p. ej. frecuencia o modalidad existente); S-5 solo `account:write` escribe; S-6 los topes del plan siguen aplicando con módulos ocultos. Mensajes con conteos solo en la respuesta del PATCH a quien tiene `account:write`, nunca en `/auth/me`.

## 6. Dependencias
- F14: F2b cerrada (memoria 2026-11-06). No tocar `common/authz/*`, `auth.service.ts` (permisos), `rls/*`, `schema.prisma`. Sin migración.
- P-2 (web, S) antes de ofrecer Rutas al independiente. P-1 solo para 1b.
- Decisión O-4 (secuencia) de la usuaria.

## 7. Archivos afectados e IDs HUB
F15 no tiene HUB todavía: se siembra en el G4 de cada fase (`H15-nnn`, plantilla T3) con estos candidatos: `packages/shared` (nuevo módulo workspace, `user.types.ts`, `credit-form.ts`); `accounts.service.ts`, `account.dto.ts`, `accounts.serializer.ts`, `auth.service.ts` (`me`); `lib/nav.ts`, `(panel)/layout.tsx`, `panel-shell.tsx`, `cuenta/cuenta-tabs.tsx`, `lib/notifications.ts`, `billing-alert.tsx` (1b); `credit-terms-fields.tsx`, `loan-form.tsx`, `credit-editor.tsx`, `client-form.tsx`, `client-card.tsx`; `rutas/planificar/page.tsx` (P-2); `messages/es.json`, `en.json`. Cada archivo se consulta en el HUB antes de tocarlo.

## 8. Invariantes
CLAUDE.md: 1 multi-tenant (vive en la fila de `accounts`), 3 audit trail, 6 TypeScript estricto sin `any`, 7 respuesta `{data, meta, error}`. F13/RULES §A–§D heredadas por F14 (proceso, guardrails de producto, **§C tenant gratuito individual**, §D coordinación móvil; B12 registro de specs). F14-A H-2 (permisos en JWT + `authz_version`: no se toca). F14-B: rama por fase, sin PASS de G4 no hay código de producto, specs nuevos de API en el script `test`, migraciones aditivas (aquí ninguna).

## 9. Perfiles de tenant
| Perfil | Qué cambia | Protección |
|---|---|---|
| Independiente (1 `ACCOUNT_ADMIN`, FREE, 1 oficina) | Es el destinatario del impacto | Preset a mano; Cuenta y Plan siempre visibles; P-2 |
| Equipo (varios miembros, 1 oficina) | Puede ocultar Oficinas/Importar/Exportar | S-1 impide ocultar Equipo con miembros |
| Multi-oficina / banco | Normalmente "Completo" | S-2 impide ocultar Oficinas con más de una |
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
- **API:** PATCH solo-`workspace` persiste; no pisa otras claves de `configuration` (replicar `accounts.service.spec.ts:336-363`); `rev` y 409; S-1..S-5; tamaño; auditoría solo `workspace`; aislamiento cuenta A/B; `/auth/me` incluye `workspace` y no filtra conteos; COLLECTOR/SUPERVISOR 403 en `PATCH` y `GET /accounts/me`; MANAGER lee sin editar; topes del plan con módulo oculto; `authz-coverage` y `authz-dto-ids` sin cambio. **Todos los specs nuevos se registran en el script `test` de `apps/api/package.json`.**
- **Web (Vitest, `src/**/*.test.{ts,tsx}`):** ampliar `nav.test.ts` y el filtro de pestañas que se dibuja (C-6); guard por página; crédito con modalidad fija (alta y edición de un crédito de otra modalidad); `credit-editor` (hoy sin test); formularios de cliente; pestaña de configuración; paridad es/en.
- **Dorado A-1:** sin `workspace`, nav, pestañas y formularios idénticos a hoy.

## 12. Rollback
Sin migración: borrar `configuration.workspace` (o guardar "Completo") restaura el comportamiento. Revertir el código es seguro: el jsonb extra se ignora. Una opción `fixed` solo afecta el formulario; los registros guardados no cambian.

## 13. Tareas y criterios
**Tareas ordenadas (datos → API → web → móvil):** P1 contrato en `shared` + API + auditoría + pruebas → P2 navegación, guard por página, migas, enlaces, notificaciones → P-2 → P3 opciones de crédito y cliente → P4 pestaña, presets, textos es/en, "Restablecer". Móvil: F8.

**Criterios de aceptación:** A-1 sin `workspace` todo idéntico; A-2 `visible(workspace) ⊆ visible(permisos)` para todo rol y configuración; A-3 configuración inválida (troncal, `requires`, S-1..S-5, tamaño, versión) → 422/409 y nada se guarda; A-4 URL directa o enlace suave a módulo oculto → redirección con aviso; A-5 ningún enlace dibujado, miga ni notificación apunta a un módulo oculto; A-6 con modalidad fija no hay selector y un crédito existente de otra modalidad se abre, muestra y guarda sin perder datos; A-7 cada cambio auditado (subárbol `workspace`, quién, cuándo, ip); A-8 cuenta A no afecta a B; A-9 `/auth/me` entrega el workspace a todo miembro (sin conteos); `PATCH` y `GET /accounts/me` según permiso; A-10 topes del plan intactos; A-11 `authz-coverage` sin diferencias; A-12 con cada opción de 1a activa, crear y editar crédito y cliente pasa por la API real sin campos exigidos vacíos; A-13 valor guardado oculto se muestra y se conserva; A-14 pruebas existentes verdes con configuración vacía; A-15 ninguna opción P tiene entrada; A-16 dos guardados con el mismo `rev` → el segundo recibe 409.

**Cierre por fase (evidencia exigida):** G5 verificación funcional, técnica, de seguridad y regresión con comandos y salida registrados en `execution/VERIFICATIONS.md` (T5); G6 `/code-review` + impacto transversal (web/API/móvil) revisado; G7 HUB (`H15-nnn`) y HANDOFF al día, STATUS actualizado.

## 14. Decisiones
| ID | Estado | Decisión |
|---|---|---|
| D-1 | APROBADA (usuaria, 2026-11-06) | Solo UI en v1; la API no consulta el workspace. |
| D-2 | RESUELTA por evidencia | Sin preset automático por `accountType` (siempre `INDEPENDENT`). |
| D-3 | APROBADA (usuaria, 2026-11-06) | Beneficiario fuera de v1 (solo reabrible en 1b). |
| D-4 | APROBADA, parcialmente cumplida | Rama nueva tras F2b (cerrada); ver O-4. |
| D-5 | RESUELTA (usuaria, 2026-11-06) | Mora y los troncales no se apagan. |
| D-6 | APROBADA (usuaria, 2026-11-06) | Workspace por organización; variantes por rol/oficina después. |
| D-7 | APROBADA (usuaria, 2026-11-06) | Sin gating comercial por módulo; gancho `planGate` vacío. |
| O-1 | ABIERTA | ¿Rutas se oculta también en móvil en F8? (no frena la v1). |
| O-2 | RESUELTA (usuaria) | Cuentas nuevas en "Completo"; el admin elige "Independiente". |
| O-3 | RESUELTA (usuaria) | El independiente puede planificarse rutas a sí mismo → P-2 (cambio web). |
| O-4 | ABIERTA | ¿Implementar ahora o después de cerrar permisos (F4→F9), según la memoria del 2026-11-06? |
| O-5 | ABIERTA | ¿Confirmas el recorte: ola 1a como §4 y todo lo demás a 1b? (antes aprobaste la ola 1 completa). |
