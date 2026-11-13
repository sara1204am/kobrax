> ESTADO: VALIDADO (G4 PASS 2026-11-06, 11/11). Decisiones D-1…D-3 aprobadas por la usuaria; D-4…D-6 derivan de H-5/H-6 y ADR-F14-06/07 (aprobados 2026-11-04). Advertencias: D-4…D-6 no fueron aprobadas una por una; los plazos de D-6 (24 h / 7 días) son propuesta; varias líneas citadas apuntan al inicio del bloque, no a la sentencia.

# Plan F4 · PII y archivos

> Resuelve **R-04** y **R-06 (definitivo)** del plan maestro (`ROLES-PERMISOS-PLAN.md` §C.7 y §E «Fase 4»). Va después de F2b (cerrada 2026-11-06). Esta fase **no toca el código del móvil** (se refactoriza en F8): todo lo que haga debe seguir sirviendo a la app móvil actual.

## 1. Objetivo
Que cada persona vea de un cliente sólo las categorías de dato que su rol permite (documento, contacto y ubicación, económicos), con una regla única aplicada igual en listados, detalle, agenda, mora, rutas, exportes y PDF; y que cada archivo subido tenga un dueño registrado en una tabla, se lea sólo con una política sobre ese dueño y pueda compartirse con un enlace firmado de vida corta.

## 2. Rama
`f14/p4-pii-archivos`, desde `f14/p2b-barrera-rls-alcance` (F1, F3, F2 y F2b ya están en esa línea; la rama de F2b está subida a `origin`).

## 3. Estado inicial con evidencia (releído 2026-11-06)

| # | Hallazgo | Evidencia | Clase |
|---|---|---|---|
| E1 | El revelado del documento se pide con `GET /clients/:id?reveal=true` y sólo exige `client:read`: cualquier rol con lectura de clientes, **incluido VIEWER**, puede revelar. El comentario del código dice que `client:pii:read` se quitó a propósito para que el cobrador pueda editar. | `clients/clients.controller.ts:78-90` | VERIFICADO |
| E2 | `serializeClient` enmascara `nationalId`, `taxId`, el valor de los contactos y la dirección. **Nunca** enmascara: latitud/longitud, zona, notas de referencia, fotos de ubicación, nombre y notas de las relaciones, garantías (descripción, valor, fotos), `fileUrl` de adjuntos, perfil de ingresos, `metadata`. | `clients/clients.serializer.ts:158` (`serializeClient`), `:164-165`, `:52-61`, `:69-76`, `:96-106`, `:112-119`, `:131-149` | VERIFICADO |
| E3 | El revelado se audita como `client/PII_REVEAL` sin decir qué categorías. | `clients/clients.service.ts:660-663` | VERIFICADO |
| E4 | Otras pantallas devuelven el documento o el contacto **ya revelado** por su cuenta: Agenda (detalle devuelve `client.nationalId` en claro; contexto del cliente usa `findOne(id,true)` y trae teléfonos, direcciones, GPS y fotos), Mora (`documentMasked` pero ubicaciones con dirección descifrada, GPS y foto), Rutas (dirección descifrada, GPS, foto), Visitas de campo (GPS), Analítica (nombre y GPS por parada). Todas auditan como `PII_REVEAL` sin categorías. | `agenda/agenda.service.ts:504-515`, `:781-840`; `mora/mora.service.ts:705-750`; `routes/routes.service.ts:714-742`; `field-ops/field.service.ts:142-163`; `analytics/analytics.service.ts:599-631` | VERIFICADO (lectura del agente de exploración, líneas contrastadas en el código) |
| E5 | Permisos: existen `client:pii:read` y `credit:pii:read`; **`client:contact:read` no existe**. `client:pii:read` sólo lo tienen MANAGER y AUDITOR (y los dos administradores por tenerlo todo); se usa como guarda en tiempo de ejecución en un solo lugar (descarga del archivo de una importación). `credit:pii:read` no guarda nada. SUPERVISOR sólo tiene `client:read`; COLLECTOR `client:read` y `client:write`; VIEWER `client:read`. | `packages/shared/src/enums/permission.enum.ts:43,51`; `constants/permissions.ts:38,43,73,102,106,124,126,138`; `imports/portfolio-import.controller.ts:150` | VERIFICADO |
| E6 | Exportes: un solo permiso `report:export` (MANAGER, AUDITOR y administradores). No enmascaran nada (documento y contacto principal en claro); el comentario dice que auditan `client/PII_REVEAL` pero el código audita la acción `EXPORT`. El PDF del cliente imprime documento, NIT y direcciones; el de rutas imprime nombre y dirección. | `exports/exports.controller.ts:14-15`; `exports.service.ts:28-33,62,75-83,107-116`; `clients/client-pdf.ts:95-96,119`; `routes/route-pdf.ts:58-59` | VERIFICADO |
| E7 | Archivos: `POST /uploads` (8 MB; sólo jpeg/png/webp; el nombre es el SHA-256 del contenido más la extensión; se guarda en disco local por cuenta). `GET /uploads/:name` exige sesión y pasa por `UploadAccessService`: quien ve toda la cuenta lee todo; el resto, sólo lo que cuelga de algo visible (consulta con UNION y `LIKE` sobre JSON). **No existe tabla `files`.** Faltan en esa consulta las fotos de las relaciones y el logo de la cuenta. | `uploads/uploads.controller.ts:16-34`; `uploads.service.ts:77-93,100-109,121`; `upload-access.service.ts:26-55`; `schema.prisma:89,817` | VERIFICADO |
| E8 | Columnas que guardan una referencia de archivo: logo de la cuenta, foto y QR del perfil, fotos de ubicación, de relación y de garantía (JSON), adjuntos (`file_url`, `file_hash`, bandera `encrypted` sin código que la use), evidencias de campo, comprobante de pago (`receipt_url`, `receipt_hash`), archivo de importación (`file_key`, otros). | `schema.prisma:89,270,273,519,549-553,795,817,869,895-909,1583-1601,1653-1654` | VERIFICADO |
| E9 | Consumidores: la web muestra las imágenes por el proxy `app/api/uploads/[name]` (sesión por cookie) y sube por `app/api/account/upload`; el móvil construye la URL absoluta, guarda las imágenes en un caché de disco con una expresión regular sobre `/uploads/<64 hex>.<ext>` y sube por `POST /uploads`. | `apps/web/src/app/api/uploads/[name]/route.ts`; `apps/mobile/src/image-cache.ts:33`, `photo-uri.ts`, `uploads.service.ts:16-26` | VERIFICADO |
| E10 | El móvil manda `x-client-type: mobile` en cada petición y su pantalla de edición de cliente pide el revelado para no escribir la máscara encima del dato. Aplicar ya «el CI siempre enmascarado en móvil» la rompería. | `apps/mobile/src/api.ts:83,151`; `apps/mobile/app/cliente/editar.tsx:96`; `apps/mobile/src/clients.service.ts:122-125` | VERIFICADO |
| E11 | Registros con datos personales: dos `Logger` interpolan el correo (y el token de recuperación en modo dev); `redactPII` cubre documento, NIT, teléfono, dirección, valor y secretos, pero no nombre, correo, GPS ni URLs de archivos. | `auth/password.service.ts:55`; `users/users.service.ts:496`; `common/audit/redact.ts:5-20` | VERIFICADO |
| E12 | Cifrado en reposo: AES-256-GCM para documento, NIT, contactos y direcciones; índice ciego HMAC para buscar por documento. El contenido de los archivos subidos está en claro en disco. | `common/crypto/crypto.service.ts:26-43`; `blind-index.service.ts:38` | VERIFICADO |
| E13 | La guarda de cobertura de puertas compara contra `authz-snapshot.json`; cualquier endpoint nuevo exige actualizarlo y que la usuaria lo apruebe. | `modules/authz-coverage.spec.ts:16-19,80-87` | VERIFICADO |

## 4. Alcance / fuera de alcance

**Dentro**
- Categorías de PII y una sola política de campos (compartida) que decide, por persona y por canal, qué categorías ve; aplicada en clientes, agenda, mora, rutas, visitas, analítica, exportes y PDF.
- Permiso nuevo `client:contact:read`; política `pii.reveal`; documento enmascarado por defecto para el supervisor en Agenda, Mora y Rutas (D-3); auditoría de cada revelado con categorías, sin valores.
- Regla «el documento va siempre enmascarado en móvil» implementada **detrás de un interruptor apagado** hasta F8 (D-2).
- Tablas `files` y `file_owners` con RLS por empresa, relleno de lo existente, servicio de archivos, `GET /files/:id`, enlaces firmados de 5 minutos, lectura legada de `/uploads/:name` durante un release con la misma política, auditoría de lectura de documentos, y limpieza de lo subido que nunca se ató (D-1).
- Corrección de los dos registros con correo y una prueba que revisa el código fuente para que no vuelva a pasar.
- Web: las imágenes y descargas pasan a usar el identificador del archivo; el botón de revelar desaparece para quien no puede.

**Fuera**
- Cualquier cambio en el código del móvil (F8). Seguirá usando las URLs legadas y su caché.
- Cifrado en reposo del contenido de los archivos, antivirus, miniaturas y anonimización de clientes (H-12 la deja fuera de F14).
- Datos bancarios de garantes: **no existen** hoy en el esquema; `credit:pii:read` se conserva sin consumidor y se documenta como reservado (D-5).
- Regla de lint propia para registros: se reemplaza por una prueba que revisa el código fuente.

## 5. Dependencias
F1, F3, F2 y F2b cerradas (G7 PASS). Decisiones de producto: H-5 y H-6 (aprobadas 2026-11-04), ADR-F14-06 y ADR-F14-07. Decisiones de esta fase: D-1…D-3 aprobadas hoy; D-4…D-6 son consecuencia directa de lo anterior (ver tabla de decisiones).

### Decisiones de la fase
| ID | Decisión | Estado |
|---|---|---|
| D-1 | Entregar la tabla `files` con enlaces firmados **ahora** (no diferirla). El móvil sigue con la ruta legada un release. | **APROBADA** por la usuaria (2026-11-06) |
| D-2 | La regla «documento siempre enmascarado y sin revelar en móvil» se implementa pero queda **apagada** (`PII_MOBILE_MASK`, por omisión apagado) hasta F8. | **APROBADA** (2026-11-06) |
| D-3 | El supervisor ve el documento **enmascarado por defecto** en Agenda, Mora y Rutas y lo revela con la acción explícita auditada. Ven el documento completo por defecto: quien tiene `client:pii:read` (administrador, gerente, auditor) y quien tiene alcance propio (el cobrador, sobre su cartera). | **APROBADA** (2026-11-06) |
| D-4 | Permiso nuevo `client:contact:read` (contactos, direcciones, GPS, fotos de ubicación, relaciones) para todos los roles menos VIEWER, y política `pii.reveal` = `client:read` + `client:contact:read` + que el cliente sea visible (404 si no). | Derivada de H-5 y ADR-F14-06 (**aprobadas**) |
| D-5 | `credit:pii:read` se conserva sin consumidor y se documenta como reservado para datos bancarios y de garantes cuando existan. Sin cambio de código. | Técnica, sin efecto visible |
| D-6 | Una persona que sube un archivo y no lo ata en 24 horas lo deja en estado «huérfano»; el archivo físico se borra a los 7 días si sigue sin dueño. | Derivada de ADR-F14-07 |

### Cruce con la alineación móvil en curso (regla D1)
Leído `../F10/plans/alineacion-web/README.md` (estado: ronda 4, 2026-10-10, módulos restantes). F4 **no cambia código ni contratos del móvil**: sigue sirviendo `GET /uploads/<hash>.<ext>`, `POST /uploads` con la misma respuesta (se le agrega `fileId`, campo nuevo que ignora) y `GET /clients/:id?reveal=true` con el mismo comportamiento para el canal móvil mientras `PII_MOBILE_MASK` esté apagado. Lo que F8 debe adoptar queda en la tarea 14.

## 6. Archivos afectados (IDs HUB; los nuevos se crean al cerrar la fase)

| ID HUB | Archivo / símbolo | Cambio |
|---|---|---|
| H14-037 (nuevo) | `packages/shared/src/enums/permission.enum.ts`, `constants/permissions.ts`, nuevo `utils/pii-fields.ts` | permiso `client:contact:read`; categorías de PII y función pura «¿puede ver esta categoría?» |
| H14-038 (nuevo) | `clients/clients.serializer.ts`, `clients.controller.ts`, `clients.service.ts` (`findOne`, revelado, auditoría) | proyección por categoría; política `pii.reveal`; auditoría con categorías |
| H14-039 (nuevo) | `agenda/agenda.service.ts`, `mora/mora.service.ts` + `mora.serializer.ts`, `routes/routes.service.ts` + `routes.serializer.ts`, `field-ops/field.service.ts`, `analytics/analytics.service.ts` | misma proyección; documento por defecto según D-3 |
| H14-040 (nuevo) | `exports/exports.service.ts`, `clients/client-pdf.ts`, `routes/route-pdf.ts`, `mora/mora-export.ts` | proyección por categoría; auditoría consistente; el PDF no incrusta lo que el rol no ve |
| H14-041 (nuevo) | `schema.prisma`, migración nueva, `rls/` (policy y permisos), `verify_files.sql` | tablas `files` y `file_owners`, relleno, RLS |
| H14-014 (existe) | `uploads/uploads.controller.ts`, `uploads.service.ts`, `upload-access.service.ts` | `POST /uploads` crea el registro pendiente; `GET /uploads/:name` resuelve por la tabla y conserva la consulta actual como respaldo un release |
| H14-042 (nuevo) | nuevo `files/` (servicio, controlador, política de lectura, firma de enlaces, limpieza) | `GET /files/:id`, enlace firmado, auditoría |
| H14-043 (nuevo) | puntos donde se guarda una URL: adjuntos, fotos de ubicación / relación / garantía (`clients.service.ts`), comprobante (`payments.service.ts`), foto y QR de perfil (`users` / `profile`), evidencia (`field.service.ts`), logo (`accounts`), archivo de importación | registran al dueño en `file_owners` |
| H14-044 (nuevo) | web: `cartera/[id]/attachments-section.tsx`, `client-card.tsx`, `pagos/[id]/receipt-button.tsx`, `rutas/[id]/parada/[sid]/page.tsx`, `components/location-photos.tsx`, `components/panel-shell.tsx`, `app/api/uploads/*`, nuevo `app/api/files/[id]/route.ts` | usan el identificador; revelar sólo si se puede |
| H14-045 (nuevo) | `password.service.ts:55`, `users.service.ts:496`, nueva prueba de código fuente, `apps/api/package.json` | sin correo en registros |
| H14-026 (existe) | `mora/mora-query.ts` `visibleClientIdsSql` | sin cambio de regla; la política de archivos lo reutiliza |

Cambios transversales consultados en `hub/HUB.md` (sección «Cambiar uploads (H14-014)» y «Cambiar `visibleClientIdsSql` (H14-026)»): clientes, mora, pagos, exportes, PDF, evidencias, perfil y la lectura de archivos de la importación.

## 7. Invariantes que aplican
B1 (la tabla nueva lleva `account_id` y RLS), B3 y B4 (el servidor decide), B5 (todo revelado y toda lectura de documento se audita), B7 (respuesta estándar), B8 (migración aditiva con script de verificación), B9 (el móvil sigue siendo cliente de una API que lo sigue sirviendo), B10 (la política de campos vive en `packages/shared`), B11 (sin `any`), B12 (toda prueba nueva registrada a mano en `test`), B13 (reconstruir `shared`), F14-A H-5, H-6 y H-12, C2 y C5 (se decide por permiso y alcance, no por tipo de tenant).

## 8. Perfiles de tenant y protección del gratuito individual
- **FREE / cobrador independiente:** quien trabaja solo es el administrador de su cuenta; tiene todos los permisos, incluido `client:pii:read` y `client:contact:read`, y alcance sobre toda la cuenta. Ve exactamente lo mismo que hoy: documento, contactos, direcciones, fotos y comprobantes. No configura nada nuevo y no aparece pantalla nueva.
- **Empresa con jerarquía:** cambian cosas visibles sólo para el supervisor (documento enmascarado en Agenda, Mora y Rutas), para VIEWER (sin contactos ni ubicaciones, sin revelar) y para quien abre un archivo que no le corresponde (404).
- **Regresión del gratuito individual (G5):** crear cliente con documento, contacto y dirección; verlos completos tras revelar; adjuntar un documento y una foto de ubicación y verlos; registrar un pago con comprobante y abrirlo; cambiar la foto de perfil; exportar clientes; generar el PDF del cliente. Sin diferencias frente a la línea base.

## 9. Riesgos
1. **Romper el móvil actual.** Mitigación: las URLs legadas y su caché no cambian; la regla del documento en móvil queda apagada (D-2); pruebas de que `GET /uploads/<hash>` sigue sirviendo igual.
2. **Relleno ambiguo:** el mismo archivo (mismo hash) puede colgar de varios dueños. Mitigación: tabla `file_owners` separada; el relleno inserta un dueño por referencia; el script de verificación cuenta referencias sin registro.
3. **Archivo sin dueño que quedó referenciado** (relleno incompleto). Mitigación: durante un release la lectura legada conserva la consulta actual como respaldo.
4. **Enlace firmado filtrado.** Mitigación: vida de 5 minutos, ligado a un archivo, firma comparada en tiempo constante, ruta con límite de peticiones, nunca lista nada; la firma incluye la cuenta.
5. **Rendimiento de la lectura:** buscar por dueño en cada imagen de una lista. Mitigación: índices en `file_owners`; la política reutiliza `visibleClientIdsSql`, que ya está medida; auditoría sólo de documentos y evidencias, no de cada foto.
6. **Borrar un archivo compartido.** Mitigación: sólo se borra el físico si no tiene ningún dueño y lleva 7 días huérfano.
7. **Omitir una pantalla** que devuelve PII por su cuenta. Mitigación: la prueba de integración recorre cada endpoint de E4 y E6 con cada rol.
8. **La edición de cliente escribe la máscara encima del dato** (el error que motivó E1). Mitigación: la política `pii.reveal` mantiene el revelado para quien puede editar; prueba de que guardar sin revelar no pisa el dato.

## 10. Pruebas
**Existentes que se ejecutan y deben seguir verdes:** `clients.service.spec`, `clients.scope.spec`, `other-credits.spec`, `exports.service.spec`, `csv.spec`, `mora-export.spec`, `mora.serializer.spec`, `routes.serializer.spec`, `agenda.service.spec`, `field.service.spec`, `uploads.service.spec`, `uploads.access.spec`, `redact.spec`, `audit.service.spec`, `crypto.service.spec`, `blind-index.service.spec`, `permission-gates.spec` (se actualiza: SUPERVISOR sigue sin `client:pii:read`; el nuevo permiso aparece en la matriz), `authz-coverage.spec` (snapshot), `client-collection-profile.it`, `authz-coverage.it`, toda la integración en `off` y `enforce`, y las pruebas web del cliente y la ficha.

**Nuevas (todas registradas en el script `test` o `test:integration` de su paquete):**
- `pii-fields.spec` (shared): matriz categoría × rol × canal; interruptor de móvil apagado y encendido.
- Spec de la política `pii.reveal` y del documento por defecto (D-3), incluida la propiedad «guardar sin revelar no pisa el dato».
- Specs del serializador y de cada pantalla de E4: lo que ve cada rol.
- Specs del servicio de archivos: registro pendiente, atado, dueños múltiples, política de lectura por tipo de dueño, enlace firmado (vencido, alterado, de otra cuenta), limpieza.
- Spec de código fuente: ningún `Logger` interpola correo, teléfono ni documento.
- Integración `f4-pii-archivos.it.ts`: cada endpoint de E4 y E6 con administrador, gerente, supervisor, cobrador, auditor y VIEWER; archivos de un cliente de otra oficina; legado y nuevo dan el mismo resultado; el móvil sigue leyendo `/uploads/<hash>`.
- `rls/verify_files.sql`: RLS de las tablas, referencias sin registro, dueños huérfanos.
- Web: pruebas de los componentes que cambian (revelar oculto sin permiso; imagen por identificador).
- **Snapshot de puertas:** los endpoints nuevos (`GET /files/:id`, creación del enlace y la lectura firmada) cambian `authz-snapshot.json`; se regenera y se le pide la aprobación a la usuaria al cerrar G5.

## 11. Rollback
Migración **aditiva** (dos tablas nuevas, sin tocar las columnas de URL existentes): se deshace con `DROP TABLE`. Interruptores: `PII_MOBILE_MASK` (apagado por omisión) y la lectura legada de `/uploads/:name` con su consulta actual como respaldo. Si el registro de archivos fallara en producción, la lectura legada responde como hoy. Volver a F2b = revertir los commits de la rama; ningún dato propio de F4 es necesario para el resto del sistema.

## 12. Tareas ordenadas
**Datos**
1. Migración aditiva: `files` y `file_owners`, RLS por empresa, permisos de aplicación, índices, relleno desde todas las columnas de E8, `verify_files.sql`.
2. Permiso `client:contact:read` en `packages/shared` y en el mapa de roles; reconstruir `shared`.

**API**
3. `pii-fields.ts` (categorías y regla pura) con su spec.
4. Política `pii.reveal` y de documento por defecto; proyección en `serializeClient`; auditoría con categorías.
5. Proyección en Agenda, Mora, Rutas, Visitas y Analítica (E4).
6. Exportes y PDF: proyección, auditoría consistente, el PDF no incrusta lo que el rol no ve.
7. Interruptor `PII_MOBILE_MASK` (apagado) y su spec.
8. Servicio de archivos y registro de dueños en cada punto de E8.
9. Política de lectura por tipo de dueño; `GET /uploads/:name` resuelve por la tabla con respaldo.
10. Controlador `files` y enlaces firmados; límite de peticiones; auditoría de documentos.
11. Limpieza de archivos pendientes y huérfanos (trabajo de fondo con `withSystemTenant`).
12. Registros sin correo y su spec de código fuente.

**Web**
13. Imágenes y descargas por identificador (proxy nuevo `app/api/files/[id]`); el botón de revelar y los datos de contacto respetan los permisos; textos es/en.

**Móvil**
14. Ninguna tarea. Se anotan para F8: encender `PII_MOBILE_MASK`, quitar el revelado de la edición, usar `fileId` y enlaces firmados, y ajustar el caché de imágenes.

## 13. Criterios de cierre
- **G5:** pegar en `VERIFICATIONS.md` la salida de: pruebas unitarias de API y shared, web, integración completa en `off` y en `enforce`, `verify_files.sql`, `verify_scope.sql`, `tsc` limpio en api, web, shared y database, y la regresión del perfil gratuito individual (sección 8). Snapshot de puertas aprobado por la usuaria.
- **G6:** `/code-review` con los hallazgos corregidos o aceptados con motivo; recorrido del mapa de impacto del HUB por H14-014, H14-026 y H14-037…045.
- **G7:** HUB, `STATUS`, `HANDOFF`, `VERIFICATIONS`, `INCIDENTS` y `docs/producto/roles-permisos-planes.md` al día; las tareas para F8 anotadas en `HANDOFF`. **No se abre F5 por iniciativa propia** salvo la orden vigente de la usuaria de seguir F4→F7.
