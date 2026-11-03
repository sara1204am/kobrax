# Discovery · 04 · Aplicación móvil

> **Estado: COMPLETO 2026-11-02.** Método: `../../_framework/README.md` §2 (clases de evidencia) · hallazgo = plantilla T1. Raíz: `apps/mobile`. Solo lectura; no propone cambios. Estado de la alineación contrastado con el código, no con el plan.

## Resumen

El móvil **no tiene concepto de oficina propio**: no lo recibe en la identidad (`Me`), no filtra por él y no lo muestra salvo la «Agencia» en la ficha de mora y el selector de agencia de la configuración de importación. El alcance lo resuelve **el servidor** al responder; el teléfono hidrata lo que la API le devuelva a su usuario. La navegación son 5 pestañas fijas sin filtro por permiso; el gating por permiso existe solo en dos puntos de «Más» y «Mi cuenta».

## Hallazgos

### H-mov-01 · La identidad del móvil no trae oficina ni alcance
- Clase: VERIFICADO
- Evidencia: `src/auth-service.ts:11-24` (`Me`: `userId, email, profile, accountId, role, permissions, mfaEnabled, mfaRequired, requiresPasswordChange`; sin `branchId`/`branches`) (2026-11-02)
- Hecho: lo único que sabe el teléfono de su ámbito es el rol y la lista de permisos; no sabe a qué agencia pertenece.
- Implica para la épica: si el móvil debe saber en qué oficinas está la persona (R3), la identidad `Me` hay que ampliarla (afecta a web también, `MeInfo`, y al JWT/sesión que R9 deja para después).
- HUB: —

### H-mov-02 · El móvil no filtra ni agrupa por oficina; el alcance viene dado por el servidor
- Clase: VERIFICADO (código móvil) / INFERIDO (comportamiento del servidor)
- Evidencia: `grep -rniE "branch|agencia|oficina|sucursal"` en `apps/mobile/{app,src}` (sin tests) solo halla: `src/routes.service.ts:51,63` (`branchId?` en tipos `GenerateRouteInput`/`CreateRouteInput`, **sin ningún llamador**), `app/mora/[creditId].tsx:242` («Agencia»), `app/ajustes/importacion.tsx:128-362` y `src/import.service.ts:255-281` (alcance de importación), y textos de «oficina» que significan «lugar de trabajo» (`src/sync/hydrate.ts:2`, `app/(tabs)/_layout.tsx:31`) (2026-11-02)
- Hecho: ninguna pantalla de cartera, mora, agenda, rutas ni pagos del móvil envía `branchId`.
- Implica para la épica: «Hidratación de oficina» en el código es el nombre del sync, **no** tiene relación con las oficinas de F13. Un cambio de alcance en la API cambia lo que baja el teléfono sin tocar el móvil (INFERIDO: depende de 02).
- HUB: —

### H-mov-03 · La hidratación baja todo lo que el servidor le devuelva a ese usuario, sin parámetro de oficina
- Clase: VERIFICADO
- Evidencia: `src/sync/hydrate.ts:139-142` (`listPortfolio()`, `listMora({limit})`, `listRoutes({collectorId})`), `:143-164` (agenda: hoy, semana, vencidos), `:236-260` (fichas de cartera, tope `MAX_FICHAS = 150`, `:37`); `app/(tabs)/_layout.tsx:35-47` (se ejecuta al entrar al shell con `me.userId`) (2026-11-02)
- Hecho: el único parámetro de identidad es `collectorId` (para rutas); lo demás depende del filtro del servidor. Cada paso es independiente y nada se borra si falla (`:88-91`).
- Implica para la épica: un cobrador con alcance amplio (regional, normalizador de cartera de R4) bajaría muchas más fichas de las que hoy cubre el tope de 150; el comentario `:233-235` ya anticipa ese límite («si aparece un tenant que lo supere, el arreglo es un endpoint que devuelva el lote»).
- HUB: —

### H-mov-04 · La hidratación está atada a las pantallas: cambiar un filtro/alcance exige tocar `hydrate.ts`
- Clase: VERIFICADO
- Evidencia: `src/sync/hydrate.ts:129-138` (el respaldo se guarda bajo la consulta que la pantalla hace; «cada línea copia exactamente la llamada de su pantalla») (2026-11-02)
- Hecho: si una pantalla agrega un parámetro (p. ej. una oficina seleccionada), `hydrate.ts` debe replicarlo o llena «casillas que nadie consulta».
- Implica para la épica: un selector de oficina en el móvil, si se pidiera, tocaría hidratación y caché a la vez. Hoy no hay ninguno.
- HUB: —

### H-mov-05 · Las 5 pestañas son fijas; el gating por permiso es parcial y solo de UX
- Clase: VERIFICADO
- Evidencia: `app/(tabs)/_layout.tsx:62-66` (Inicio, Agenda, Rutas, Cobranza, Más; sin condición); `app/(tabs)/mas.tsx:27,40-52` (`canImport = permissions === null || can(permissions, CLIENT_IMPORT)` oculta «Importación»); `app/cuenta/index.tsx:15-17,34` (no pide la cuenta sin `ACCOUNT_READ`; nota: «Lo avanzado (sucursales, jerarquías, roles de la web, reportes) no vive en el móvil por diseño»); `src/permissions.ts:1-23` (`can/canAny/canAll`; «ocultar es UX, la API autoriza») (2026-11-02)
- Hecho: ninguna pestaña se oculta por permiso; mientras no se sabe el permiso (`null`) se ofrece todo.
- Implica para la épica: confirma la parte «las 5 pestañas no se filtran» de L-14; la parte «sin gating» se matiza: hay gating en «Importación» y «Mi cuenta». El móvil ya declara que las jerarquías no viven en él.
- HUB: —

### H-mov-06 · La alineación con la web está en ejecución y el encabezado del plan se contradice con su cuerpo
- Clase: CONTRADICTORIO
- Evidencia: `docs/epics/F10/plans/alineacion-web/README.md:1` («pendiente: 0.2, 0.4, 0.5, 0.7, 0.8 y las fases 1–6») y `:118` («0.8 ⬜») vs `:464-470` (§13.8: 0.5 ✅, 0.7 ✅, **0.8 ✅**, «`src/permissions.ts` (`can`)… gatea Importación») y `:501` (U4 ✅); código: `src/permissions.ts` y `mas.tsx:27` existen (2026-11-02)
- Hecho: el encabezado y la tabla de la Fase 0 no se actualizaron tras la ronda 4; el código confirma lo que dice §13.8.
- Implica para la épica: el plan debe leerse por §13.8, no por su cabecera; el último cambio al plan es del 2026-10-10 (`git log`), y el móvil siguió avanzando después (`561070e` plantillas de WhatsApp, `b098076`, `b3945cf` «Datos sin conexión»).
- HUB: —

### H-mov-07 · Qué parte de la alineación ya cubre el móvil y cuál queda fuera por diseño (relevante para F13)
- Clase: INFERIDO (documento) + VERIFICADO puntual en código
- Evidencia: `alineacion-web/README.md` §2 (se queda en la web: «filtros por agencia/responsable», «asignar/reasignar masivos», «equipo masivo y roles MANAGER/AUDITOR/VIEWER», «plan, facturación», «auditoría») y §13.8 (Fase 0 ✅ salvo 0.2 🟡/0.4 🔒; R1 🟡; cuenta, agenda, mora, importación construidos); código: `src/import.service.ts:255-281`, `app/ajustes/importacion.tsx:247-362` (la importación móvil sí maneja alcance «agencia»), `shared/constants/roles.ts:11` (el móvil asigna solo `ACCOUNT_ADMIN/SUPERVISOR/COLLECTOR`, L-07) (2026-11-02)
- Hecho: la supervisión por oficina no está en el alcance del móvil; la importación es la única función de configuración que usa agencias.
- Implica para la épica: gran parte de F13 (árbol, administración, filtros) es web-only; el móvil se ve afectado por (1) la forma de `Me`, (2) la cantidad y alcance de datos hidratados, (3) el selector de agencia de la importación si el modelo cambia.
- HUB: —

### H-mov-08 · Importación móvil: el selector de agencia sale de la configuración que baja del servidor
- Clase: VERIFICADO
- Evidencia: `app/ajustes/importacion.tsx:128` (`members = [], branches = []` de `screen`), `:247` (tipos `official | branch | account`), `:351-362` (texto: «El reconcile toca sólo los créditos de esta agencia»; sin agencias: «No hay agencias cargadas. Elegí "Empresa (todos)" mientras tanto») (2026-11-02)
- Hecho: la lista es plana (`{id, name}`); un árbol de nodos con nombres repetidos («Central») se vería ambiguo.
- Implica para la épica: R10 (ruta completa visible) también aplica a este selector si se mantiene en el móvil.
- HUB: —

### H-mov-09 · La ficha de mora muestra la agencia del crédito, no la del usuario
- Clase: VERIFICADO
- Evidencia: `app/mora/[creditId].tsx:242` (`detail.branchName ? <Fact label="Agencia" …>`); `packages/shared/src/types/mora.types.ts:105` (`branchName?`) (2026-11-02)
- Hecho: único lugar donde el cobrador ve una oficina; es la del crédito.
- Implica para la épica: si un normalizador de cartera de una regional ve créditos de varias agencias (R4), esa fila es la que le dice de cuál es cada uno.
- HUB: —

## Cómo se sincroniza (lo relevante para oficinas)

| Aspecto | Hecho | Evidencia |
|---|---|---|
| Lectura | Hidratación al entrar al shell; los datos quedan en SQLite local bajo la consulta de cada pantalla | `hydrate.ts:1-11,129-138`; `_layout.tsx:35-47` |
| Escritura | Cola con ids fijados por el teléfono (idempotente); el motor sube antes de hidratar | `_layout.tsx:40-44`; B9 de `RULES.md` |
| Autoridad de permisos | La API; el teléfono solo decide qué ofrecer, con permisos que pueden estar viejos si se leyeron sin señal | `permissions.ts:3-5` |
| Tope de fichas | 150 clientes con ficha completa | `hydrate.ts:37,240` |
| Caché | Cifrado, poda a 7 días / 50 MB (plan §13.8 0.5, 0.7); se borra al cambiar usuario/empresa conservando la cola | `alineacion-web/README.md:468-469` y §3 |

## Lente de tenant

| Perfil | Hoy |
|---|---|
| (a) Gratuito individual | Es el perfil natural del móvil: sin oficina visible, hidrata solo lo suyo; «Importación» y «Mi cuenta» se ofrecen según permisos. |
| (b) Equipo pequeño | El supervisor/cobrador ve lo que el servidor le entrega; la agencia aparece solo en la ficha de mora. |
| (c) Tenant grande | Cualquier alcance mayor (regional) multiplicaría lo hidratado más allá del tope de 150 fichas sin que la pantalla lo explique; no hay selector que lo acote. |

## Contradicciones y desconocidos

| # | Tipo | Detalle |
|---|---|---|
| M-C1 | CONTRADICTORIO | El plan de alineación se contradice a sí mismo (H-mov-06): cabecera dice 0.8 pendiente; §13.8 y el código dicen hecho. |
| M-C2 | CONTRADICTORIO (pista L-14) | L-14 dice «las 5 pestañas no se filtran por permiso»: cierto para las pestañas (H-mov-05); falso si se entiende «el móvil no tiene gating»: hay en «Importación» y «Mi cuenta». |
| M-D1 | DESCONOCIDO | Qué devuelven `GET /portfolio`, `/mora`, `/agenda` a un usuario con alcance de agencia vs. de cuenta: es lo que el teléfono bajaría. Responde: 02-backend-api (alcance por endpoint). |
| M-D2 | DESCONOCIDO | Si el móvil aguanta un alcance mayor (cientos o miles de créditos) en SQLite y en la hidratación: sin medición (la propia nota 0.7 dice «rendimiento en gama baja sin medir»). Responde: prueba en dispositivo. |
| M-D3 | NO VERIFICADO | `docs/producto/movil-A…B` no se leyó (el código manda); el estado real de pantallas se tomó del código y de §13.8 del plan. |
| M-D4 | NO VERIFICADO | Nada de lo del plan está verificado en un teléfono (el propio plan lo dice: `README.md:457`). |

## Resolución de pistas

| Lead | Resultado |
|---|---|
| **L-14** | **PARCIALMENTE CONFIRMADA.** Móvil desfasado de la web y plan en curso: confirmado (H-mov-06/07); el plan sigue en «ronda 3/4» y el móvil avanzó después del 2026-10-10. Las 5 pestañas no se filtran por permiso: confirmado (H-mov-05), pero hay gating puntual en «Más» y «Mi cuenta». |
