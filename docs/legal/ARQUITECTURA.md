# Arquitectura — privacidad, consentimiento y términos

Cómo está armado, para quien tenga que mantenerlo. El diagnóstico y las decisiones están en `ETAPA-A-auditoria-y-plan.md`; el estado, en
`INFORME-CUMPLIMIENTO.md`; lo que falta del lado jurídico, en `PENDIENTES-LEGALES.md`.

## 1. Modelo de datos (PostgreSQL)

| Tabla | Para qué | Quién escribe | Inmutabilidad |
|---|---|---|---|
| `legal_document_versions` | Cada versión de cada documento (tipo, idioma, `version`, texto, `content_sha256`, `is_material`, `effective_at`) | `db:seed:legal` / `LegalService.publishVersion` | Solo INSERT (trigger + REVOKE) |
| `user_legal_acceptances` | Constancia de que una persona **aceptó/reconoció** una versión (hash copiado, origen, IP, UA, versión de la app, hora de la base) | `LegalService.recordSignupAcceptances` | Solo INSERT |
| `consent_records` | Historial de un consentimiento **opcional** (otorgado/retirado). El estado vigente es la **última fila** por persona y finalidad | `LegalSelfService.setConsent` | Solo INSERT |
| `privacy_requests` | Solicitud de derechos y su estado actual | `PrivacyRequestsService` | Sin DELETE; `status` se actualiza solo por la máquina de estados |
| `privacy_request_events` | Un evento por cada paso de una solicitud (quién, qué estado, nota) | `PrivacyRequestsService.transition` | Solo INSERT |

- **Globales, sin `account_id`** (`legal_*`, `consent_records`): son por **persona**, como `users`. El control de acceso es de la aplicación (la clave sale de la sesión).
- **`privacy_requests`** tiene **RLS forzado** (`privacy_requests_access`): ve las filas sin cuenta (solicitudes personales, que filtra la app por quien las presentó) y las de la cuenta activa (solicitudes de titulares).
- La inmutabilidad es **doble**: `REVOKE` de UPDATE/DELETE/TRUNCATE a `kobrax_app` **y** `kobrax_scoped`, **y** el trigger `legal_forbid_mutation` (que también frena al dueño de las tablas).
- Los scripts de permisos `005b_legal.sql` y `005c_privacy_requests.sql` corren **antes** de `006_scope_policies.sql`, que debe ser el último (copia los permisos de `kobrax_app` a `kobrax_scoped`). `verify_legal.sql` (parte de `db:verify`) lo comprueba.

## 2. API (`apps/api/src/modules`)

```
legal/                  LegalService (documentos, hash, aceptaciones, consentimientos)
                        LegalSelfService (lo propio: pendientes, historial, re-aceptación, consentimientos)
                        LegalController  GET público de documentos; /legal/me, /legal/acceptances, /legal/consents/:purpose (autenticados)
privacy-requests/       PrivacyRequestsService + máquina de estados pura (privacy-requests.logic.ts)
                        PrivacyRequestsController (propias y de la organización) + PrivacyPlatformController (cola de plataforma)
```

Reglas que no se rompen:

1. **El cliente nunca manda un hash ni un texto**: solo ids de versión. El servidor calcula/lee el hash de **su** copia y rechaza una versión que no sea la vigente (`LEGAL_VERSION_STALE`).
2. **Atomicidad**: la aceptación se registra **dentro de la misma transacción** que crea la cuenta o activa al invitado.
3. **La persona sale de la sesión**, nunca del cuerpo ni de la URL.
4. **Re-aceptación** (`requiredFloor`/`isCovered`): el «piso» de un documento es su versión material vigente más reciente (o la más antigua si ninguna es material). Un cambio editorial no obliga; uno material sí.
5. **Los endpoints nuevos declaran su contrato** (`@Public`, `@Authenticated`, `@Roles`, `@Authz`) y quedan fijados en `docs/epics/F14/authz-snapshot.json`; abrir una ruta pública exige editar a conciencia `authz-coverage.spec.ts`.
6. Permiso de plataforma nuevo `platform:privacy:manage` (solo la persona de plataforma; ningún rol de empresa lo recibe).

## 3. Web (`apps/web`)

- **BFF** (`src/app/api/legal/*`, `src/app/api/privacy/*`): nombran campo por campo lo que transportan (lo demás se descarta), validan origen (CSRF) y rechazan ids/finalidades con caracteres raros antes de llegar a la API.
- **Formularios** (registro, invitación): dos casillas en línea debajo de la contraseña (`legal-consents.tsx`); cada enlace abre **un solo** modal con la versión exacta (`legal-document-modal.tsx`).
- **Páginas públicas** `src/app/(legal)/[doc]/page.tsx`: lista cerrada de rutas, `?v=` para versiones anteriores.
- **Mi perfil › Privacidad** (`privacy-panel.tsx`): comunicaciones, historial de aceptaciones y solicitudes propias. **Cuenta › Privacidad**: solicitudes de titulares de cobranza (`account:write`).
- **Re-aceptación**: el layout del panel pide `/legal/me`; si hay pendientes monta `LegalReacceptGate` (pantalla bloqueante con cierre de sesión).
- `APP_VERSION` (`.env` raíz) es la única fuente de la versión del producto; `next.config.mjs` expone solo esa variable.

## 4. Móvil (`apps/mobile`)

Solo el **alta** y la **aceptación de invitación** llevan la aceptación (`legal-consents.tsx`, `legal.service.ts`): mismas casillas y mismo texto que la web, modal de lectura con la versión exacta. `publicCall` ahora entrega el `code` de la API. El origen queda como «registro/invitación en la app» por el encabezado `x-client-type: mobile`.

## 5. Compartido (`packages/shared`)

Enums legales y de solicitudes, `SIGNUP_REQUIRED_DOCUMENTS`, y la lógica pura que usan web y móvil: `canSubmitLegal`, `legalPayload`, `parseLegal`, `parseLegalInline` (devuelven **datos**, nunca HTML).

## 6. Operación

- Aplicar en cada entorno: `pnpm db:deploy` → `pnpm db:rls` → `pnpm db:seed:legal`. **Sin documentos publicados el registro no deja crear cuentas.**
- Publicar una versión nueva: subir `version` en el archivo de `docs/legal/documentos/`, `material: true` si debe pedir re-aceptación, y correr `db:seed:legal`.
- Orden de despliegue: la API nueva **antes** que los clientes no sirve: el registro del móvil viejo (sin aceptación) recibe 422. Desplegar API + web + móvil juntos, o publicar el móvil primero.

## 7. Pruebas (dónde mirar)

`apps/api/test/integration/legal*.it.ts`, `privacy-requests.it.ts` (Postgres real, RLS, inmutabilidad, aislamiento) · `apps/api/src/modules/legal/*.spec.ts`, `privacy-requests/*.spec.ts` · `apps/web/src/**/legal*.test.*`, `privacy*.test.*` · `apps/mobile/src/legal*.test.*` · `packages/shared/src/utils/legal-acceptance.spec.ts` · `packages/database/prisma/rls/verify_legal.sql`.
