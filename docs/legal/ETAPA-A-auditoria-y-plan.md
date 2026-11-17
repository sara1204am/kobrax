# Privacidad, consentimiento y términos — Etapa A: auditoría y plan

> Estado: **diagnóstico para revisión. No hay código implementado.** Fecha: 2026-11-16.
> Origen: cuatro auditorías de solo lectura (registro/auth, inventario de datos, controles de seguridad, normativa).
> Todo lo marcado **[NO VERIFICADO]** no se pudo confirmar en código o en fuente oficial. Nada de este documento es asesoría legal:
> la aprobación final es de un abogado boliviano.

## 1. Resumen ejecutivo

1. **Hoy no existe nada legal**: ni páginas de Términos/Privacidad/Cookies, ni casillas, ni tablas de aceptación, ni versionado de textos.
2. **Hay dos puertas de entrada sin aceptación**: registro de cuenta (web y móvil) y aceptación de invitación (web y móvil). Los usuarios ya existentes tampoco aceptaron nada.
3. **`audit_logs` no sirve como evidencia contractual**: no es append-only en la base (el rol de la app tiene UPDATE/DELETE), no tiene hash ni cadena. Hace falta una tabla propia, inmutable por trigger y `REVOKE`.
4. **Kobrax maneja datos de terceros (deudores, garantes) que sus usuarios no pueden consentir por ellos.** El modelo correcto es: la organización cliente es responsable; Kobrax es proveedor/encargado → requiere DPA.
5. **Varias garantías que un texto de privacidad tentaría a declarar hoy no están implementadas** (ver §6). Los documentos deben describir lo real.
6. **La normativa boliviana no tiene ley integral de datos**; el estándar más cercano es el D.S. 1793 (consentimiento expreso e informado). GDPR se usa como estándar de diseño, no como obligación (art. 3).

## 2. Hallazgos del repositorio (registro y base técnica)

| Tema | Hallazgo | Referencia |
|---|---|---|
| Registro web | 2 pasos (plan → formulario). Campos: negocio, nombre, apellido, email, clave, plan. Sin términos. | `apps/web/src/app/(auth)/registro/page.tsx` |
| BFF registro | Arma el body campo por campo: **un campo nuevo se pierde en silencio si no se nombra**. | `apps/web/src/app/api/auth/registro/route.ts:23-31` |
| API registro | `POST /accounts`, público, rate limit 10/h. Todo en una `withTenant` (account, rama raíz, user+profile, membresía, auditoría). | `accounts.service.ts:77-196` |
| Invitación | `POST /auth/invitation/accept` solo recibe `{code, password}`. Activa al usuario sin aceptación. | `auth/password.service.ts:107-150` |
| Móvil | `registro.tsx` e `invitacion.tsx` usan los mismos endpoints. | `apps/mobile/app/(auth)/` |
| Modelos | `User` global (sin RLS), `UserAccount` (membresía), `Account` (`tenant_self`). Convención: snake_case + `@map`, uuid, enums nativos. | `schema.prisma` |
| RLS | ~55 tablas con `tenant_isolation`; tabla nueva con `account_id` debe sumarse al array de `rls/001_enable_rls.sql`. Los `rls/*.sql` los aplica `db:rls`, no `migrate deploy`. | `prisma/rls/` |
| Auditoría | `AuditService` redacta PII; **sin hash, sin append-only**. | `common/audit/` |
| SHA-256 existente | Patrón reutilizable: `sha256OfBuffer`. | `field-ops/field-integrity.ts:9` |
| Tests API | `node:test`, specs **enumerados a mano** en `apps/api/package.json:13`. Integración: `test/integration/*.it.ts`. | — |
| Cobertura authz | Todo endpoint nuevo debe declarar contrato o da 403 `AUTHZ_000`. | `authz-coverage.spec.ts` |
| Mi perfil | Pestañas en `lib/perfil-tabs.ts` (`datos-personales`, `preferencias`, `seguridad`). Agregar `privacidad` es mecánico. | — |
| Versión | `APP_VERSION` ya existe (web). La API no tiene constante propia; móvil dice 1.1.0. | — |
| Cookies web | `k_access`, `k_refresh`, `k_preauth`, `k_renewed` (necesarias); `k_locale`, `k_dash_view` (preferencia, no esenciales estrictas). **Sin analítica ni tracking.** | `lib/bff.ts`, `locale-switch.tsx` |

## 3. Matriz de datos (resumen por categoría)

Base jurídica = **propuesta**, sujeta a revisión legal. Retención = lo que existe hoy en código.

| Categoría | Datos (modelo.campo) | Módulo | Almacén / protección hoy | Quién accede | Base propuesta | Retención hoy |
|---|---|---|---|---|---|---|
| **Usuario registrado** | email, hash de clave, MFA (cifrado), nombre, teléfono, `documentNumber` (**sin cifrar**), foto | auth/users | Postgres; clave bcrypt-12; MFA AES-GCM | propio, admin, USER_READ | Contrato (alta de cuenta); seguridad = interés legítimo [REVISAR] | sin purga |
| **Organización** | razón social, NIT, teléfono, email, dirección, plan | tenants | Postgres (claro) | ACCOUNT_READ | Contrato | sin purga |
| **Empleados/cobradores** | `lastKnownLat/Lng` (**tabla global, sin RLS**), visitas con GPS, rendimiento | field-ops/analytics | Postgres (claro) | **[NO VERIFICADO quién lee lastKnown]** | Contrato + interés legítimo del empleador; **[REVISIÓN LEGAL: geolocalización laboral]** | visitas inmutables; sin purga |
| **Deudores** | cédula/NIT (AES-GCM), nombre, género, contactos (AES-GCM), direcciones (cifradas) + GPS (claro), adjuntos (foto cédula), bitácora de gestión | clients/credits/mora | Postgres + disco local; sin cifrado de archivos | por permiso `client:pii:read` y alcance de oficina | **La define la organización cliente** (Kobrax = encargado) | soft delete; sin supresión |
| **Terceros** | garantes/referencias (nombre claro; contactos cifrados), garantías con fotos | clients | igual | igual | La define la organización cliente [REVISIÓN LEGAL: terceros sin relación directa] | sin purga |
| **Geolocalización** | `FieldVisit`, `FieldEvidence`, `ClientLocation`, `Branch`, `lastKnown*`, ciudad/país por IP | field-ops/routes | Postgres | por alcance | ver arriba | evidencias inmutables |
| **Financieros** | saldos, mora, pagos (ledger inmutable), ingresos (`ClientIncomeProfile`, categoría ECONOMIC) | credits/payments | Postgres (claro) | permiso + alcance | Organización cliente | sin purga |
| **Técnicos** | `UserSession` (IP, UA, ciudad), `AuditLog` (IP, UA), tokens push FCM, SQLite móvil (cifrado por fila) | auth/audit/mobile | Postgres, Redis, dispositivo | admin/auditor | Seguridad = interés legítimo [REVISAR]; minimización de IP | **sin purga de logs/sesiones** |
| **Archivos** | fotos, firmas, recibos, **archivo original de importación (puede tener PII en claro)** | uploads/imports | disco local (`UPLOADS_DIR`), sin cifrado | enlaces firmados 5 min | según dato | huérfanos 7 d; **retención por plan solo cuenta, no borra** |
| **Respaldos** | `pg_dump` completo | backup | mismo servidor, **14 días, sin copia externa**, sin cifrar el archivo | operador | Obligación de continuidad [REVISAR] | 14 días |

Servicios externos y qué reciben: servidor Contabo (EE. UU.): todos los datos; FCM (Google): tokens; Gmail SMTP: correo del usuario y enlaces; OpenStreetMap/Esri: IP y zona consultada por el navegador; Google Fonts: IP del visitante; WhatsApp: **sin API**, se abre `wa.me` en el dispositivo del cobrador. **No hay IA externa**; solo lógica determinista (`priorityScore`, franja recomendada, segmentos). S3/R2/MinIO: variables sin implementación.

## 4. Riesgos identificados

| # | Riesgo | Sev. |
|---|---|---|
| R1 | Cero aceptación contractual en registro, invitación y usuarios existentes | Alta |
| R2 | `audit_logs`, `payments`, `field_evidences` mutables a nivel de base (solo inmutables por convención de la app) | Alta |
| R3 | `Profile.documentNumber`, nombres, coordenadas, ingresos y fotos en claro; archivos de importación originales en disco con PII | Alta |
| R4 | Sin flujo de supresión/rectificación/exportación individual; solo soft delete de clientes | Alta |
| R5 | Retención de fotos por plan **no se aplica**; sin purga de logs, sesiones, notificaciones | Media-alta |
| R6 | `lastKnownLat/Lng` en tabla global sin RLS; lectura sin confirmar | Media-alta |
| R7 | Barrera RLS de alcance (`SCOPE_RLS_MODE`) apagada por defecto; `PII_MOBILE_MASK` apagado y falsificable | Media |
| R8 | Respaldos sin copia externa ni cifrado de archivo; lecturas por enlace firmado no auditadas | Media |
| R9 | Sin encabezados de seguridad en la web (CSP, HSTS, X-Frame-Options); Google Fonts desde navegador | Media |
| R10 | Sin runbook de incidentes/brechas | Media |
| R11 | Cola offline móvil se escribe en claro si falta la llave local | Media |
| R12 | Transferencia internacional: servidor en EE. UU. con datos de titulares bolivianos [REVISIÓN LEGAL] | Media |

## 5. Normativa (estado de verificación)

| Norma | Qué aporta | Estado |
|---|---|---|
| CPE 21.2, 25, 130-131 | Privacidad, inviolabilidad de comunicaciones, acción de protección de privacidad (habeas data) | PARCIAL |
| **D.S. 1793 art. 56** (no Ley 164) | Consentimiento previo, expreso e informado; revocable; finalidad; cesión a terceros solo con consentimiento/orden. Ámbito (¿solo TIC?) sin aclarar | PARCIAL |
| D.S. 1793 art. 57 | Comunicaciones comerciales: indicar cómo rechazar | PARCIAL |
| Ley 164 arts. 78, 87 | Clic-aceptar = **indicio de prueba**, no firma digital | PARCIAL (inferencia) |
| Ley 453 arts. 13, 19-22, 40.6 | Información clara, contratos de adhesión, cláusulas abusivas (art. 22.2.5: cesión de datos). Aplicabilidad B2B dudosa | PARCIAL |
| Ley 393 arts. 474-475 | Reserva; alcance a un proveedor tecnológico **[NO VERIFICADO]** | PARCIAL |
| D.S. 5384 / Res. ASFI/540/2025 | Empresas de Tecnología Financiera. **Si Kobrax cae en este régimen: [NO VERIFICADO]** | PARCIAL |
| Ley integral de datos | **No hay**; proyectos en trámite (estado a nov-2026 [NO VERIFICADO]) | PARCIAL |
| GDPR arts. 3, 6, 7, 22, 28, 30, 33 | Estándar de diseño; **no obligatorio** en Bolivia salvo oferta a personas en la UE | VERIFICADO (resto: solo títulos) |

Las fuentes se leyeron vía resúmenes de lexivox/gdpr-info. **Contrastar con Gaceta Oficial antes de citar un artículo en cualquier documento publicado.**

## 6. Lo que los documentos NO pueden afirmar hoy

- Cifrado de todo dato personal (solo documentos, contactos, direcciones y MFA).
- Retención de fotos aplicada (solo se cuenta).
- Eliminación segura o supresión a pedido (no existe).
- Inmutabilidad de auditoría/evidencia garantizada por la base (solo por la app).
- Almacenamiento en la nube S3/R2 (hoy es disco local en un VPS).
- Cumplimiento GDPR, ISO, SOC 2 o autorización ASFI (no hay ninguna).
- Copia de respaldo fuera del servidor.

## 7. Arquitectura propuesta

### 7.1 Modelos (nombres a convención del repo)

- **`legal_documents`** (global, sin RLS): `id`, `type` (enum: TERMS, PRIVACY, COOKIES, DPA, AUP, AI_POLICY), `slug`, `created_at`.
- **`legal_document_versions`** (global, inmutable): `id`, `document_id`, `version` (semver), `locale`, `content` (texto/markdown), `content_sha256`, `published_at`, `effective_at`, `is_material` (bool), `change_summary`, `retired_at`. Una versión publicada **no se edita**: se publica otra.
- **`user_legal_acceptances`** (inmutable, solo INSERT): `id`, `user_id`, `account_id` (nullable), `document_version_id`, `content_sha256` (copia del hash aceptado), `action` (ACCEPTED, ACKNOWLEDGED), `source` (SIGNUP_WEB, SIGNUP_MOBILE, INVITATION_WEB/MOBILE, RE_ACCEPT, PROFILE), `accepted_at` (**hora del servidor UTC**), `ip` (**ver §7.4**), `user_agent` (recortado), `app_version`.
- **`consent_records`** (opcionales, **append-only con historial**): `id`, `user_id`, `purpose` (MARKETING, ANALYTICS, COOKIES_NON_ESSENTIAL), `status` (GRANTED, WITHDRAWN), `document_version_id` (nullable), `source`, `recorded_at`, `ip`, `user_agent`, `app_version`. El estado vigente = último registro por (usuario, finalidad). Retirar = insertar fila nueva, no actualizar.
- **`privacy_requests`**: `id`, `account_id` (nullable), `requester_user_id` (nullable), `subject_kind` (APP_USER, DEBTOR_VIA_ORG), `type` (ACCESS, RECTIFICATION, ERASURE, RESTRICTION, OBJECTION, PORTABILITY, WITHDRAW_CONSENT), `status` (RECEIVED, IN_REVIEW, NEEDS_INFO, APPROVED, REJECTED, COMPLETED), `rejection_reason`, `due_at`, `created_at`, `updated_at`, más tabla hija **`privacy_request_events`** (cada cambio de estado, inmutable).
- **`processing_activities`** (registro art. 30 como documento versionado; opcional, fase tardía).

**Aislamiento**: documentos y aceptaciones son por **persona** (como `User`, global, sin RLS) y se controlan en la app, igual que `users`/`profiles`. `privacy_requests` con `account_id` **sí** va a RLS (`tenant_isolation`) y se suma al array de `001_enable_rls.sql`; las de usuarios de Kobrax sin cuenta usan el contexto de plataforma.

### 7.2 Inmutabilidad real (cierra R2 para lo nuevo)
- Migración SQL a mano: `REVOKE UPDATE, DELETE, TRUNCATE` sobre las tablas de evidencia al rol `kobrax_app` **y** trigger `BEFORE UPDATE OR DELETE` que lanza excepción.
- Sin cadena de hashes en esta fase (propuesta opcional posterior). El hash SHA-256 del texto aceptado + versión demuestran **qué texto** aceptó la persona.
- Prueba de integración: `UPDATE`/`DELETE` como `kobrax_app` debe fallar.

### 7.3 Flujos
1. **Registro (web y móvil)**: casillas obligatorias de Términos y de Privacidad (reconocimiento: `ACKNOWLEDGED`, no consentimiento general), opcionales desmarcadas (marketing, analítica). DTO nuevo con la versión **vigente** que el cliente vio; **el servidor valida que sea la vigente**, calcula el hash desde su copia (nunca confía en el del cliente), y guarda todo **dentro de la misma transacción** de `accounts.service.ts`. BFF: nombrar los campos nuevos.
2. **Invitación**: mismo patrón en `acceptInvitation` (hoy sin aceptación).
3. **Usuarios existentes y cambios materiales**: guard de re-aceptación (estado en `/auth/me` y paso `legal_required` en el login) solo si la versión nueva es `is_material`. Cambio editorial no obliga.
4. **Páginas públicas** `/terminos`, `/privacidad`, `/cookies` (+ `/dpa`, `/uso-aceptable`, `/ia`) con enlace permanente por versión; el contenido sale de `legal_document_versions`.
5. **Mi perfil → Privacidad** (pestaña nueva): historial de aceptaciones, consentimientos opcionales (retirar/otorgar), solicitudes de derechos y su estado.
6. **Cookies**: hoy no hay cookies no esenciales ni tracking. **No se implementa banner de consentimiento** hasta que exista algo que lo requiera; sí se publica la política con la lista real (necesarias vs preferencia). Las preferencias `k_locale`/`k_dash_view` se declaran como funcionales.
7. **Organización cliente / DPA**: la aceptación del DPA la hace el ACCOUNT_ADMIN **en nombre de la organización** (registro con `account_id`), separada de la aceptación individual. La política y la UI dicen explícitamente que ese administrador **no consiente por los deudores**.
8. **Derechos del deudor**: se reciben como `privacy_requests` con `subject_kind = DEBTOR_VIA_ORG` y se **derivan a la organización responsable**; Kobrax solo asiste (acceso/exportación) según el DPA.

### 7.4 IP y minimización
Guardar IP completa en la evidencia de aceptación tiene justificación probatoria, pero debe declararse en la política. Propuesta: IP completa en la aceptación (finalidad: prueba) y **retención limitada y documentada** [DECISIÓN + REVISIÓN LEGAL]; User-Agent recortado.

### 7.5 Endpoints (todos con contrato de autorización, o dan `AUTHZ_000`)
`GET /legal/documents/:type/current` (público), `GET /legal/documents/:type/versions[/:version]` (público), `GET /legal/acceptances/me`, `POST /legal/acceptances` (re-aceptación autenticada), `GET/POST /legal/consents/me`, `POST /legal/consents/me/:purpose/withdraw`, `GET/POST /privacy/requests`, `GET /privacy/requests/:id`, y para administración/plataforma: `POST /platform/legal/versions` (publicar) y gestión de solicitudes. Respuestas `{data, meta, error}`.

### 7.6 Archivos a modificar/crear (estimado)
- **Prisma**: `schema.prisma` + 2-3 migraciones (`*_legal_*`) + `rls/001_enable_rls.sql` (solo `privacy_requests`) + `rls/verify_legal.sql`.
- **API**: nuevo módulo `modules/legal/` (service, controller, DTOs, errores, spec); cambios en `accounts.service.ts`, `create-account.dto.ts`, `password.service.ts`, `accept-invitation.dto.ts`, `auth.service.ts` (`me`, paso `legal_required`), `apps/api/package.json:13` (specs), shared (constante de tipos de documento).
- **Web**: `(auth)/registro/page.tsx`, `(auth)/invitacion/*`, `api/auth/registro/route.ts`, `api/auth/invitacion/*`, rutas públicas `/terminos` etc., `settings/perfil/privacidad/`, `lib/perfil-tabs.ts`, `messages/{es,en}.json`, middleware (rutas públicas).
- **Móvil**: `registro.tsx`, `invitacion.tsx` (**el móvil está en refactor F14/F8 según la memoria del proyecto: coordinar antes de tocarlo**).
- **Docs**: `docs/legal/*` (política, términos, cookies, DPA, AUP, IA como **borradores con `[PENDIENTE DE CONFIRMACIÓN LEGAL]`**), `docs/legal/PENDIENTES-LEGALES.md`, runbook de incidentes.

### 7.7 Pruebas (de la lista del encargo)
Unitarias y de integración en `accounts.service.spec.ts`, spec nuevo `legal.service.spec.ts`, integración `legal.it.ts` (RLS, inmutabilidad, versión correcta, aislamiento entre usuarios), Vitest en `registro/page.test.tsx` y componentes nuevos, y E2E del flujo de registro (hoy el repo no tiene E2E de navegador visible: **[a confirmar si se agrega Playwright]**). Comprobaciones finales: `tsc`, build de producción y los specs relevantes (el `lint` de la web es un placeholder).

## 8. Plan de implementación sugerido (Etapa B, incremental)

| Paso | Contenido | Depende de |
|---|---|---|
| B1 | Modelos + migraciones + inmutabilidad + módulo `legal` (publicar/leer versiones, hash) + tests de integración | — |
| B2 | Aceptación en registro (API + BFF + web) y en invitación; transacción única | B1 |
| B3 | Páginas públicas de documentos + **borradores** con marcadores de pendiente legal | B1 |
| B4 | Consentimientos opcionales + pestaña Privacidad (historial, retirar) | B1-B2 |
| B5 | Re-aceptación por cambio material (guard + paso en login) | B2 |
| B6 | Solicitudes de derechos (usuario y deudor vía organización) + estados | B1 |
| B7 | Móvil (registro e invitación) | B2, tras F8 |
| B8 | Endurecimiento de hallazgos §4 que el usuario priorice (cifrado `documentNumber`, headers web, purgas, trigger en `audit_logs`) | aparte |

Los pasos B1-B6 son el núcleo del encargo; B8 son riesgos descubiertos que **no** se corrigen sin aprobación porque tocan funcionalidad existente.

## 8b. Datos confirmados y decisiones (2026-11-16)

Confirmado por la titular del proyecto (no verificado contra ningún registro oficial):

| Dato | Valor | Estado |
|---|---|---|
| Razón social | **Ikigai Tech Bolivia S.A.** | Confirmada por la titular; **[PENDIENTE: contrastar con el testimonio de constitución]** |
| Representante legal | **Mabel Sara Acha Moya** | Confirmado por la titular; **[PENDIENTE: contrastar con poder / certificado de Fundempresa]** |
| Canal de privacidad y contacto | **kobraxikigai@gmail.com** | Confirmado. Es un Gmail: **[RECOMENDADO: migrar a un dominio propio antes del lanzamiento]** |
| NIT | — | **[PENDIENTE DE CONFIRMACIÓN LEGAL]** |
| Domicilio legal | — | **[PENDIENTE DE CONFIRMACIÓN LEGAL]** |
| Matrícula de comercio | — | **[PENDIENTE DE CONFIRMACIÓN LEGAL]** |

Decisiones tomadas para continuar (delegadas por la titular; revisables):

1. **Alcance de la primera entrega: B1–B6.** El móvil (B7) queda para después de F8; los hallazgos de seguridad (B8) no se tocan sin aprobación expresa.
2. **IP en la evidencia de aceptación: se guarda completa**, con la finalidad probatoria declarada en la política. **[Plazo de retención: PENDIENTE DE CONFIRMACIÓN LEGAL]**: hasta que se defina no se purga nada, y la política lo dirá así.
3. **Sin E2E de navegador nuevo.** No se agrega Playwright (dependencia nueva sin pedido expreso). Se cubre con pruebas unitarias, de componente (Vitest) y de integración contra Postgres real; el E2E queda como **[PENDIENTE]**.
4. **Los documentos se redactan como borradores** con estos datos y marcadores explícitos donde falta información. No se inventan NIT, domicilio ni certificaciones.

## 8c. Estado de la implementación

| Paso | Estado |
|---|---|
| B1 · modelos, migración, inmutabilidad, módulo `legal`, lectura pública | **Implementado y verificado** (11 unitarios + 10 de integración; 92 de autorización) |
| B2 · aceptación en registro e invitación (API + BFF + web) | **Implementado y verificado** (2154 unitarios API, 10 integración B2, 1524 web, build de producción). **Móvil NO actualizado: ver nota** |
| B3 · páginas públicas + borradores + publicación (`db:seed:legal`) + modal de lectura | **Implementado y verificado** (1537 tests web, build de producción). Los textos son **borradores sin revisión legal** |
| B4 · consentimientos opcionales + pestaña Privacidad | Pendiente |
| B5 · re-aceptación por cambio material | Pendiente |
| B6 · solicitudes de derechos | Pendiente |

Notas de B1: las tres tablas son **globales** (por persona, sin RLS) y solo admiten INSERT: trigger `legal_forbid_mutation` en la migración `20261116100000_legal_foundations` y `REVOKE`/`GRANT` en `prisma/rls/005b_legal.sql (corre ANTES de 006: ver nota en el archivo)` (se aplica con `db:rls`). Se abrieron 4 rutas públicas `GET /legal/...` y se registraron a conciencia en `authz-coverage.spec.ts` y `docs/epics/F14/authz-snapshot.json`.

Notas de B2:

- 🔴 **El registro y la aceptación de invitación del MÓVIL (`apps/mobile`) quedan rotos contra esta API**: no envían `termsVersionId`/`privacyVersionId` y reciben 422 `LEGAL_ACCEPTANCE_REQUIRED`. Es deliberado (el móvil está en refactor, B7), pero **no se puede desplegar la API sin resolver B7 o sin una decisión explícita sobre las altas desde el móvil**.
- La aceptación y los consentimientos se guardan **dentro de la misma transacción** que crea la cuenta o activa al invitado: sin aceptación no queda cuenta, usuario ni membresía, y una invitación no se consume (probado contra Postgres real).
- El servidor valida que la versión enviada sea la vigente (`LEGAL_VERSION_STALE`, 409) y usa **su** hash; el cliente solo manda ids.
- **No hay casilla de analítica**: el panel no usa hoy ninguna tecnología de seguimiento (verificado en la auditoría), así que no hay nada que consentir. La API ya soporta `analyticsOptIn` para cuando exista.
- Los documentos se piden **siempre en español** (`LEGAL_LOCALE`) hasta publicar traducciones; pedir `en` sin versión publicada dejaría sin poder registrarse a quien usa la interfaz en inglés.
- Hasta que B3 publique los borradores, **el registro web muestra «No se pudieron cargar los Términos…»** y no deja crear cuentas (no hay documento que aceptar). Es el comportamiento correcto sin documentos.
- Los tests de integración existentes que crean cuentas usan `legalAcceptance()` del harness (publica documentos de prueba `0.0.1-test` si faltan).

Notas de B3 y cambios de diseño pedidos por la titular:

- **La aceptación va en un pop-up, no en el formulario.** El registro y la invitación no llevan casillas ni resumen: entran enteros en pantalla, sin scroll. Al pulsar el botón principal se abre un pop-up con las **dos casillas obligatorias y separadas** (aceptar Términos; reconocer Política), desmarcadas; al confirmar sigue el alta. Cada documento se lee completo en un modal encima, con la **versión exacta** que se va a aceptar, y desde ahí se marca la casilla.
- **Se quitó la casilla de marketing y el resumen de privacidad del registro** (decisión de la titular; difiere del encargo original, que pedía marketing opcional en el registro). La API (`marketingOptIn`, `consent_records`) sigue lista: ese consentimiento se pedirá, si se desea, desde Mi perfil › Privacidad (B4). Nada lo activa por defecto.
- **Páginas públicas permanentes**: `/terminos`, `/privacidad`, `/cookies`, `/dpa`, `/uso-aceptable`, `/ia`, con `?v=<versión>` para versiones anteriores, huella SHA-256 y enlaces desde el pie del menú. El clic normal en el formulario abre el modal; Ctrl/⌘/clic central abre la página.
- **Publicación**: `pnpm db:seed:legal` publica `docs/legal/documentos/*.es.md` (idempotente, apto para cada despliegue). **Una versión publicada no se edita**: si el archivo cambia sin subir `version`, el script falla (y la base lo impide). Hoy las 6 versiones son `0.1.0` (borrador). Al aprobarlas un abogado, publicar `1.0.0` marcada `material`.
- **Bug corregido en `Modal`**: cerrar un diálogo anidado cerraba también al padre (React propaga `close` por su árbol). Ahora cada diálogo solo reacciona a su propio cierre.
- Los textos usan lo comprobado en la auditoría y marcan con `[PENDIENTE DE CONFIRMACIÓN LEGAL]` NIT, domicilio, edad mínima, precios, SLA, plazos de conservación/respuesta/notificación de brechas, jurisdicción, transferencia internacional, menores y derechos de los titulares de cobranza.

## 9. Pendientes que NO se pueden resolver en código

Razón social, NIT, domicilio, representante legal y canal de privacidad de **Ikigai Tech Bolivia** (solo consta el nombre en el footer: **[PENDIENTE DE CONFIRMACIÓN LEGAL]**); si Kobrax cae bajo el régimen ETF/ASFI; alcance del art. 475 Ley 393; ámbito real del D.S. 1793 art. 56; valor probatorio del clic-aceptar y retención de la IP; legalidad de la cobranza (WhatsApp, horarios, geolocalización, fotos de personas); transferencia internacional (servidor en EE. UU.); estado de los proyectos de ley de datos; firma digital con entidad certificadora si se busca valor pleno.
