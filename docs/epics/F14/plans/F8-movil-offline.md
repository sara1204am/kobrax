> ESTADO: BORRADOR (2026-11-08). Pendiente `validar F8` (G4). **D-1…D-11 son propuestas: la usuaria debe aprobarlas antes de construir.** Hay **3 bifurcaciones reales** (D-2, D-4, D-8) que cambian lo que se construye; el resto deriva de decisiones ya aprobadas (H-5, H-6, H-10, ADR-F14-06/11). Ninguna línea de producto se toca antes del PASS de G4.

# Plan F8 · Móvil y offline

> Resuelve **N-06, N-07** del plan maestro (`ROLES-PERMISOS-PLAN.md` §E «Fase 8», ADR-F14-06, ADR-F14-11, H-5, H-6, H-10) y absorbe **todo lo que F2, F4 y F5 dejaron anotado «para F8»**. Es la única fase de F14 que toca `apps/mobile`.

## 1. Objetivo
Que la app del cobrador respete el modelo de permisos que ya existe en la API y la web: sepa qué puede hacer cada persona y no ofrezca lo demás; tenga una ventana sin conexión proporcional al riesgo del rol; muestre con claridad por qué el servidor rechazó algo que se hizo sin señal; deje de depender del «revelado» de datos personales para editar; no guarde el documento de identidad completo en el teléfono; y pueda dar de alta clientes en una oficina elegida cuando la regla de F2 lo exige.

## 2. Rama
`f14/p8-movil`, desde `f14/p7-editor-roles` (F4–F7 están en el PR #27, aún sin mergear).

## 3. Estado inicial con evidencia (releído 2026-11-08)

| # | Hallazgo | Evidencia | Clase |
|---|---|---|---|
| E1 | **Ventana sin conexión fija de 8 h para todos los roles.** Se calcula al guardar la sesión y se renueva con cada `me()` exitoso; no mira permisos. H-10 pide 2 h para quien tiene `assignment:write` o `user:write`. | `apps/mobile/src/session.ts:34,43-51,68-73`; `auth-service.ts:214` | VERIFICADO |
| E2 | **`AUTHZ_STALE` se maneja sin nombrarlo:** un 401 cualquiera dispara el refresh y UN reintento; si el segundo también es 401 se limpia la sesión. Funciona (el refresh emite un token con la versión nueva) pero no está probado ni documentado para este caso. | `apps/mobile/src/api-client.ts:57-77` | VERIFICADO |
| E3 | `me()` guarda el último `me` en la base local y, **sin red, responde con ese `me` guardado** (permisos de cuando hubo señal). El arranque del shell hace `me()` ANTES de iniciar el motor de sincronización y de hidratar, o sea: la cola no se drena con permisos más viejos que el último `me` con red. | `auth-service.ts:205-232,80`; `app/(tabs)/_layout.tsx:36-48` | VERIFICADO |
| E4 | **Los tabs no se filtran por permiso** (5 fijos); sólo «Más» oculta Importar con `can()` y algunas pantallas de Cuenta/Mora usan `can()` suelto. No hay una forma común de preguntar los permisos desde cualquier pantalla (cada una llama a `authService.me()`). | `app/(tabs)/_layout.tsx:56-60`; `app/(tabs)/mas.tsx:27`; `app/cuenta/index.tsx:51,55`; `app/mora/[creditId].tsx:94-95`; `src/permissions.ts` | VERIFICADO |
| E5 | **La cola ya distingue «falló» de «rechazado»:** un 4xx (salvo 408/429/426) marca el ítem `rechazado` con el mensaje del servidor, deja de reintentar y «Pendientes» ofrece **Descartar**. Lo que falta es explicarlo: un 404 por «ya no ves a ese cliente» o un 403 por «tu rol ya no lo permite» se muestran con el texto técnico del servidor. | `src/sync/sync.service.ts:61-72`; `src/sync/queue.ts:699-726`; `app/pendientes.tsx:125-149` | VERIFICADO |
| E6 | **La API no impide que un rol fuera del móvil (AUDITOR, VIEWER) inicie sesión desde la app:** `isMobileRole` sólo se usa al invitar o cambiar el rol; el login/refresh sólo guarda `deviceType` en la sesión. H-5 dice «fuera del móvil». | `apps/api/src/modules/users/users.service.ts:208,336`; `auth/auth.service.ts:515`; `packages/shared/src/constants/roles.ts:11-16` | VERIFICADO |
| E7 | **La edición de cliente pide `?reveal=true`** para prellenar teléfonos y direcciones. Con `PII_MOBILE_MASK` encendido la API contesta **403 `PII_REVEAL_DENIED` aunque sólo se quieran los contactos**; hoy el interruptor está apagado, por eso nadie lo nota. El comentario de la API dice que el interruptor «tapa el documento pero no el teléfono que el cobrador necesita», pero el código lo niega todo. | `apps/mobile/app/cliente/editar.tsx:96`; `src/clients.service.ts:122-125`; `apps/api/src/modules/clients/clients.service.ts:684-699`; `packages/shared/src/utils/pii-fields.ts:57-60` | VERIFICADO |
| E8 | **El canal de la petición sale de un encabezado que manda el cliente** (`x-client-type`), no de la sesión. Quien tenga un token del móvil puede declararse «web» y saltarse la máscara. | `apps/api/src/common/context/tenant-context.interceptor.ts:49`; `apps/mobile/src/api.ts:83,151`; `shared/utils/pii-fields.ts:37-39` | VERIFICADO |
| E9 | **Alta de cliente sin oficina:** el móvil no manda `branchId`. Con la regla de F2, un cobrador sin oficina o con varias, o un gerente asignado a la raíz, recibe 422 (`CLIENT_BRANCH_UNRESOLVED`, `CLIENT_CREATE_AT_ROOT`). El móvil no tiene selector de oficina ni sabe a qué oficinas pertenece la persona (`/auth/me` no las trae; `GET /branches` exige `office:read`, que el cobrador no tiene). | `apps/api/src/common/authz/policies/client-create.policy.ts:41-56`; `apps/mobile/src/clients.service.ts`; `apps/api/src/modules/auth/auth.service.ts` (`me`) | VERIFICADO |
| E10 | El móvil no muestra `otherCredits` (el aviso de F2 de que el cliente tiene créditos que la persona no ve). | `grep otherCredits apps/mobile` (sin coincidencias) | VERIFICADO |
| E11 | Las fotos se piden por la URL antigua `/api/uploads/<hash>` y el caché de imágenes se indexa por esa URL; `POST /uploads` ya devuelve `fileId`, que el móvil ignora. La ruta antigua sigue funcionando «un release» (F4). | `apps/mobile/src/photo-uri.ts`, `image-cache.ts:32-97`, `uploads.service.ts:16-46`; F4 plan D (rollback) | VERIFICADO |
| E12 | El caché local y la cola están **cifrados en reposo** (XChaCha20-Poly1305, llave en SecureStore); cerrar sesión borra el caché y las fotos pero **no la cola**. Con `PII_MOBILE_MASK` encendido el servidor ya no manda el documento completo al canal móvil, así que «CI nunca completo en el teléfono» se cumple por construcción, siempre que el canal sea confiable (E8). | `apps/mobile/src/at-rest.ts:1-40`; `session.ts:105-119` | VERIFICADO |
| E13 | **Solapa con F10/P10** («Gating por capacidad/rol»), etapa 🔵 sin construir. | `docs/epics/F10/BUILD-PLAN.md` (fila P10) | VERIFICADO |
| E14 | **Línea base del móvil medida hoy:** `jest` 83 suites / **982 pruebas** verdes (≈38 s), en la rama `f14/p7-editor-roles`. | `cd apps/mobile && npx jest` | VERIFICADO |

## 4. Alcance / fuera de alcance

**Dentro**
1. **Sesión y permisos:** ventana offline por permisos (D-2); `AUTHZ_STALE` explícito y probado; una sola fuente de los permisos en la app (`useMe`/`useCan`) que se actualiza con cada `me()`; el `me` guardado lleva la fecha en que se leyó.
2. **Roles fuera del móvil:** la API rechaza login y refresh del canal móvil para roles que no son de campo (`MOBILE_ROLE_NOT_ALLOWED`, D-3) y la app lo explica y cierra la sesión.
3. **Menú y acciones por permiso:** los tabs y las acciones sólo aparecen si la persona tiene el permiso (N-07); la API sigue siendo la que autoriza.
4. **Cola (N-06):** `me` se refresca ANTES de subir lo pendiente (ya ocurre; se prueba); los rechazos se explican con un motivo claro («ya no tienes acceso a este cliente», «tu rol ya no permite esto», «la oficina cambió») y siguen visibles hasta descartarlos.
5. **Datos personales (F4):** la API deja de negar el revelado de CONTACTOS al canal móvil y sigue tapando siempre el DOCUMENTO (D-4); el canal sale de la sesión y no del encabezado (D-5); la edición del cliente funciona con el documento enmascarado (no lo prellena, no lo reenvía); la API rechaza una máscara como valor de documento al guardar.
6. **Archivos (F4):** subir y mostrar fotos con `fileId`/`GET /files/:id` y el caché de imágenes indexado por `fileId` (D-6).
7. **Alta de cliente (F2):** `GET /auth/me` informa las oficinas de la persona (campo aditivo); el formulario ofrece elegir oficina sólo cuando hace falta (RULES C2: con una sola oficina no hay selector) y explica los 422 de oficina (D-7).
8. **Ficha:** aviso `otherCredits` (D-8).
9. **Más › Cuenta:** rol y oficinas de la persona.
10. Pruebas del móvil y de los cambios de API que lo sostienen; coordinación de versión mínima de la app para encender `PII_MOBILE_MASK` (D-5/D-10).

**Fuera**
- **Rehacer la app** (el refactor que anunció la usuaria) y el resto de etapas de F10 (mapas, evidencia, push…). F8 adapta la app actual; lo que construya sirve para cuando se rehaga porque vive en servicios y en la API.
- AUDITOR y VIEWER en el móvil (H-5: fuera).
- Editar roles desde el móvil (F7 es sólo-web, D-1 de F7).
- Plantillas de WhatsApp del móvil (pendiente aparte).
- El flujo «crear MI crédito sobre un cliente que no veo» (F2b D-6) en el móvil, salvo que la usuaria elija incluirlo (D-8).
- Retirar la ruta antigua `/uploads/<hash>` (queda para F9 cuando la app mínima ya use `fileId`).
- Pruebas en un dispositivo real: las hace la usuaria (ver §13).

## 5. Dependencias
F1 (versiones, `AUTHZ_STALE`), F2 (oficina de registro, `otherCredits`), F4 (PII, archivos), F5 (roles por cuenta, `MOBILE_ROLES`), F6/F7 (sin cambios para el móvil). H-5, H-6, H-10 y ADR-F14-06/11 aprobadas (2026-11-04).

### Decisiones de la fase (todas PROPUESTA, esperan a la usuaria)
| ID | Decisión | Estado |
|---|---|---|
| D-1 | F8 **adapta la app actual**; no la rehace. Sustituye la etapa **P10** de F10 (se anota en el `BUILD-PLAN`). | PROPUESTA |
| D-2 | **Ventana sin conexión** (⚠ bifurcación): 8 h para el cobrador y **2 h para quien tiene `assignment:write` o `user:write`** (H-10, aprobada), se recalcula con cada `me()` leído con red. **Excepción propuesta: una cuenta de una sola persona** (el cobrador independiente, que es su propio administrador) conserva 8 h, porque no tiene a quién asignar y RULES C exige no degradarla. Para saberlo, `GET /auth/me` informa `account.soloUser` (campo aditivo). Alternativas: (a) 2 h literal para todos los que tengan esos permisos, incluido el independiente; (b) 2 h sólo para gerente y supervisor, 8 h para el administrador. | PROPUESTA (elegir) |
| D-3 | La API rechaza **login y refresh** del canal móvil para roles que no son de campo con `403 MOBILE_ROLE_NOT_ALLOWED`. Una sesión ya abierta de alguien que pasa a AUDITOR/VIEWER cae en su próximo refresh. La app lo explica («Tu rol se usa desde la web») y cierra la sesión local. No es seguridad (esa persona tiene los mismos permisos en la web): es la regla de producto de H-5. | PROPUESTA |
| D-4 | **Revelado en el móvil** (⚠ bifurcación). **A (recomendada):** con `PII_MOBILE_MASK` encendido, `?reveal=true` desde el móvil devuelve los CONTACTOS en claro (auditado) y el DOCUMENTO siempre enmascarado, sin 403; la edición sigue prellenando teléfonos y direcciones. **B:** el móvil nunca revela: la edición muestra los contactos enmascarados y sólo se pueden reemplazar (más cambios de pantalla, y el cobrador no ve el teléfono completo al editarlo). En ambas el documento va enmascarado y no se reenvía si no cambió. | PROPUESTA (elegir) |
| D-5 | El **canal sale de la sesión**: la API fija el dispositivo en la sesión al iniciar sesión (el encabezado sólo cuenta entonces), el refresco lo conserva ignorando el encabezado, y el token lleva `ch`. `PII_MOBILE_MASK` sigue **apagado por omisión**: se enciende como paso de operación cuando la versión mínima de la app sea la de F8 (la puerta de versión ya existe). Mientras tanto una app vieja sigue funcionando. | PROPUESTA |
| D-6 | **Archivos:** la app usa `fileId` y `GET /files/:id` para subir y mostrar fotos; el caché se indexa por `fileId`; la ruta antigua queda un release más (se retira en F9). Se puede **diferir a después del refactor** si la usuaria prefiere (no bloquea al resto). | PROPUESTA |
| D-7 | **Oficinas en el alta:** `GET /auth/me` agrega `offices: [{ id, name, isRoot }]` (las de la membresía). El selector aparece sólo si hay más de una opción (las propias; y, con `office:read`, las del alcance vía `GET /branches`). Un 422 de oficina se explica con texto propio. | PROPUESTA |
| D-8 | **Ficha del cliente** (⚠ bifurcación): (a) sólo el aviso `otherCredits` («este cliente tiene N créditos más fuera de tu alcance», sin datos); (b) además, el flujo de la web para un duplicado que no veo (nombre y documento enmascarados + «crear mi crédito sobre este cliente», `GET /clients/:id/preview`). | PROPUESTA (elegir; recomiendo (a) ahora) |
| D-9 | **Tabs y acciones por permiso** con un almacén pequeño de `me` (`useMe`/`useCan`), alimentado por `authService.me()`. Un tab sin permiso no se dibuja; la pantalla igual maneja el 403 de la API. | PROPUESTA |
| D-10 | **Compatibilidad con apps instaladas:** todo cambio de API es aditivo o está detrás de un interruptor apagado; la regla de roles (D-3) afecta sólo al canal móvil de roles no-campo; el cambio de D-4/D-5 se enciende con la versión mínima. | PROPUESTA |
| D-11 | **Verificación:** pruebas unitarias del móvil (jest) y de la API; la prueba en un dispositivo real la hace la usuaria con una lista de casos que se le entrega al cerrar (no se afirma «probado en el teléfono»). | PROPUESTA |

### Cruce con la alineación móvil en curso (regla D1)
Releído `../F10/BUILD-PLAN.md`: P10 (gating por capacidad) coincide con el punto 3; se absorbe aquí (D-1). El resto de etapas 🔵 de F10 no se tocan. Los cambios de API son aditivos o apagados (D-10), de modo que una app vieja sigue funcionando y la nueva se puede probar contra la misma API.

## 6. Archivos afectados (IDs HUB; los nuevos se crean al cerrar la fase)

| ID HUB | Archivo / símbolo | Cambio |
|---|---|---|
| H14-071 (nuevo) | `apps/api/src/modules/auth/auth.service.ts` (`login`, `refresh`, `me`), `auth/token.service.ts`, `jwt-auth.guard.ts`, `common/context/tenant-context.*` | Rechazo de roles fuera del móvil (D-3); dispositivo fijo en la sesión y claim `ch` (D-5); `me` con `offices` y `account.soloUser` (D-2, D-7) |
| H14-072 (nuevo) | `apps/api/src/modules/clients/clients.service.ts` (`get`, `update`), `common/authz/pii.service.ts`, `packages/shared/src/utils/pii-fields.ts` | Revelado de contactos para el canal móvil sin 403; documento enmascarado siempre; rechazo de máscara como documento (D-4) |
| H14-073 (nuevo) | `apps/mobile/src/session.ts`, `auth-service.ts`, `api-client.ts`, `store/me.ts` (nuevo), `permissions.ts` | Ventana por permisos, `AUTHZ_STALE` explícito, almacén de `me` (D-2, D-9) |
| H14-074 (nuevo) | `apps/mobile/app/(tabs)/_layout.tsx`, `app/(tabs)/mas.tsx`, pantallas con acciones | Tabs y acciones por permiso (D-9) |
| H14-075 (nuevo) | `apps/mobile/src/sync/queue.ts`, `sync/sync.service.ts`, `app/pendientes.tsx` | Motivos claros de rechazo; `me` antes de drenar (N-06) |
| H14-076 (nuevo) | `apps/mobile/app/cliente/editar.tsx`, `src/clients.service.ts`, `cliente-form-view.tsx`, `cliente-diff.ts` | Edición con documento enmascarado (D-4) |
| H14-077 (nuevo) | `apps/mobile/src/photo-uri.ts`, `image-cache.ts`, `uploads.service.ts`, `cliente-legajo.ts` | `fileId` y caché por `fileId` (D-6) |
| H14-078 (nuevo) | alta de cliente (`app/cliente/nuevo*`, `clients.service.ts`), selector de oficina, `app/cliente/[id].tsx` (`otherCredits`), `app/cuenta/index.tsx` | Oficina en el alta, aviso de otros créditos, rol y oficinas en Cuenta (D-7, D-8) |
| H14-079 (nuevo) | `apps/mobile/app/(auth)/login.tsx`, `post-login.ts` | Mensaje de rol fuera del móvil (D-3) |
| H14-020…024, H14-041…045, H14-046…049 (existen) | uploads/archivos, PII, roles por cuenta | consultados: ver IMPACT-MAP |

## 7. Invariantes que aplican
B3/B4 (ocultar no es autorizar: la API valida siempre), B5 (todo revelado de contactos se audita, con categorías y canal, nunca valores), B8/B9 (sin migraciones de datos; cambios de API aditivos), B12 (todo spec nuevo registrado), F14-A H-5, H-6, H-10, ADR-F14-06/11; **D1/D2** (cruce con F10 y no arrastrar `docs/epics/F15/`); C2 (una oficina, un usuario: sin selectores ni avisos nuevos).

## 8. Perfiles de tenant y protección del gratuito individual
- **FREE / cobrador independiente** (es ACCOUNT_ADMIN de una cuenta de una persona y trabaja en la calle con la app): **no debe empeorar.** Con D-2 conserva 8 h (`soloUser`); sin oficina ni equipo no ve selector ni avisos nuevos; su cola, sus fotos y su caché no cambian. Es el caso que más cuidado exige porque un 2 h literal (alternativa (a)) lo degradaría sin ningún beneficio de seguridad.
- **Empresa:** gerente y supervisor pasan a 2 h sin conexión; el cobrador sigue en 8 h; AUDITOR/VIEWER dejan de entrar desde la app; el alta de cliente pide oficina cuando hace falta.
- **Regresión del gratuito individual (G5):** registrarse, iniciar sesión, trabajar 8 h sin conexión, crear cliente y crédito, registrar un pago encolado y subirlo al volver la señal, editar un cliente, subir una foto y verla; sin pantallas ni textos nuevos.

## 9. Riesgos
| Riesgo | Mitigación |
|---|---|
| Encender `PII_MOBILE_MASK` antes de que la app nueva esté instalada rompe la edición de clientes de la app vieja. | D-5/D-10: apagado por omisión; se enciende con la versión mínima; con D-4 (A) la app vieja sigue editando contactos. |
| Una app vieja reenvía el documento enmascarado como si fuera un valor nuevo y lo pisa. | La API rechaza una máscara como documento al guardar (prueba); la app solo manda campos cambiados. |
| El rechazo de roles no-campo deja a alguien sin entrar a una cuenta pequeña (p. ej. un VIEWER invitado). | Mensaje claro («entra desde la web»); sólo afecta al canal móvil. |
| Ventana de 2 h en gerente/supervisor interrumpe una jornada larga sin señal. | Es la decisión H-10; se renueva con cada `me()` con red; se avisa antes de vencer (propuesta de implementación: aviso a 15 min). |
| El canal fijo en la sesión rompe sesiones existentes. | Las sesiones sin dispositivo guardado se tratan como hoy (encabezado) hasta que renuevan; prueba. |
| Caché de imágenes por `fileId` deja fotos huérfanas o vacía el caché de golpe. | Migración perezosa: la clave nueva convive con la vieja hasta la purga normal; prueba del índice. |
| No hay forma de probar en dispositivo desde aquí. | D-11: lista de casos manuales para la usuaria; el cierre dice «no probado en dispositivo». |
| Solape con otro trabajo móvil en curso. | Rama propia desde F7; cruce D1 hecho (E13). |

## 10. Pruebas
**Línea base:** `apps/mobile` `jest` y `tsc --noEmit` se miden antes de la primera línea (se pega en VERIFICATIONS); API `npm test` 2070, web 1328, shared 495, integración 306/306 en `off` y `enforce`.

**Nuevas (registradas en `jest` del móvil y en `test`/`test:integration` de la API):**
- **Móvil:** ventana por permisos (8 h / 2 h / `soloUser`) y su renovación; `AUTHZ_STALE` (un reintento, el segundo cierra); `useMe/useCan`; tabs por permiso; motivos de rechazo de la cola (404/403/422 → texto claro) y que lo rechazado no se reintenta ni se pierde; que `me` se lee antes de drenar; edición con documento enmascarado (no se prellena, no se reenvía); selector de oficina (una opción = sin selector; varias = selector; 422 explicado); aviso `otherCredits`; mensaje de rol fuera del móvil; caché de imágenes por `fileId`.
- **API:** login y refresh móviles de AUDITOR/VIEWER → 403; el mismo rol por web → 200; dispositivo fijo en la sesión y `ch` en el token (cambiar el encabezado después no cambia el canal); `me` con `offices` y `soloUser`; `?reveal=true` desde el canal móvil con la máscara encendida → contactos sí, documento enmascarado, auditado, sin 403; PATCH con una máscara como documento → 422; con el interruptor apagado, comportamiento idéntico al actual.
- **Contrato:** `GET /clients/:id` con `otherCredits` y `GET /auth/me` con campos nuevos no rompen el parseo del móvil.
- **Snapshot de puertas:** sin cambios (no hay endpoints nuevos).

## 11. Rollback
Cambios de API aditivos o detrás de interruptor: revertir la rama devuelve el comportamiento anterior. `PII_MOBILE_MASK` se apaga con una variable. La regla de roles (D-3) se revierte quitando la comprobación. Sin migraciones de datos.

## 12. Tareas ordenadas (datos → API → web → móvil)
**Datos:** ninguna (verificar que las oficinas de la membresía se pueden leer con la consulta actual; si hiciera falta un índice, aditivo).

**API**
1. `me`: `offices` y `account.soloUser`; `roleKey`.
2. Dispositivo fijo en la sesión + claim `ch`; el interceptor lee `ch` (con respaldo al encabezado para sesiones sin él); refresh lo conserva.
3. Rechazo de roles no-campo en login y refresh del canal móvil (`MOBILE_ROLE_NOT_ALLOWED`).
4. Revelado de contactos para el canal móvil con la máscara (D-4 A) y rechazo de máscara como documento.
5. Specs + integración (`f8-movil.it.ts`) registrados.

**Web:** ninguna (el campo nuevo de `/auth/me` es aditivo; `MeInfo` se actualiza en `shared`).

**Móvil**
6. Almacén `me` y `useCan`; ventana por permisos; `AUTHZ_STALE` explícito.
7. Tabs y acciones por permiso; mensaje de rol fuera del móvil.
8. Cola: motivos de rechazo; `me` antes de drenar.
9. Edición con documento enmascarado; oficina en el alta; `otherCredits`; Más › Cuenta.
10. Archivos con `fileId` y caché (si D-6 se mantiene).
11. Lista de casos manuales para la usuaria.

## 13. Criterios de cierre
- **G5:** salida pegada en `VERIFICATIONS.md` de: `jest` y `tsc` del móvil (antes y después), API `npm test`, shared, web, integración completa en `off` y `enforce`, `f8-movil.it.ts`, `next build`; regresión del gratuito individual (§8); **y la lista de casos manuales para dispositivo real, marcada «no probada en dispositivo» hasta que la usuaria la corra**.
- **G6:** `/code-review` con hallazgos corregidos o aceptados con motivo; recorrido del mapa de impacto por H14-071…079 y los HUB consultados.
- **G7:** HUB, `STATUS`, `HANDOFF`, `VERIFICATIONS`, `INCIDENTS` y `docs/producto/roles-permisos-planes.md` al día; nota en `F10/BUILD-PLAN.md` (P10 absorbida por F8). **F9 sólo con orden de la usuaria.**
