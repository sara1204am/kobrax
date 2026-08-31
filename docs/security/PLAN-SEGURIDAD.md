# Kobrax — Plan de seguridad de datos (nivel bancario)

**Fecha:** 2026-08-26 · **Alcance:** API · Web · Móvil · Base de datos
**Motivo:** una cuenta GRUPAL mete a varias personas dentro del mismo tenant. Hoy el aislamiento
es *entre empresas*; adentro de una empresa no hay casi ninguno.

---

## 0. Lo que YA está construido (no se rehace)

Antes de planificar nada conviene decir qué existe, porque la mitad de un checklist de seguridad
genérico ya está resuelto acá:

| Control | Dónde vive |
|---|---|
| Aislamiento por tenant con RLS `FORCE`, rol sin `BYPASSRLS` | `packages/database/prisma/rls/001_enable_rls.sql` |
| Contexto RLS por transacción (`withTenant` / `SET LOCAL`) | `apps/api/src/common/context/` + los 30 services |
| Cifrado AES-256-GCM con IV por registro (PII de cliente, secreto MFA) | `apps/api/src/common/crypto/crypto.service.ts` |
| Búsqueda sobre campo cifrado sin descifrar (blind index) | `apps/api/src/common/crypto/blind-index.service.ts` |
| Auditoría global automática con redacción de PII, append-only por convención | `apps/api/src/common/audit/` |
| Rate limiting en Redis (global por token/IP + por endpoint) | `apps/api/src/common/guards/rate-limit.guard.ts` |
| `helmet`, CORS con lista blanca, `ValidationPipe` con `forbidNonWhitelisted` | `apps/api/src/main.ts` |
| Tokens fuera del navegador: cookies `httpOnly` + `SameSite=Strict` + refresh silencioso | `apps/web/src/middleware.ts`, `apps/web/src/lib/bff.ts` |
| Móvil: tokens sólo en SecureStore, ventana de 8 h, re-bloqueo biométrico, borrado de caché en los 4 caminos de cierre de sesión | `apps/mobile/src/session.ts` |
| MFA TOTP + códigos de respaldo · política de contraseña · bcrypt 12 | `apps/api/src/modules/auth/` |
| Refresh rotativo, hasheado en DB, con `familyId` y `jti` | `apps/api/src/modules/auth/token.service.ts` |
| **Detección de reuso de refresh**: revoca la familia entera y la sesión, con ventana de gracia para carreras concurrentes, y lanza el error *fuera* de la transacción para que la revocación no se pierda en el rollback | `apps/api/src/modules/auth/auth.service.ts:457-490` |
| Evidencia de campo con SHA-256 verificado en el servidor | `apps/api/src/modules/field-ops/field-integrity.ts` |
| Respaldo `pg_dump` con poda por retención | `apps/api/src/common/backup/backup.service.ts` |

**Conclusión honesta:** la puerta entre empresas está bien cerrada. Lo que falta es todo lo de
adentro de la empresa, y todo lo que pasa cuando el dato ya salió del servidor.

---

## 1. Los huecos reales, ordenados por riesgo

Cada uno con: qué pasa hoy (verificado en el código), qué haría un banco, y el arreglo **mínimo**
que lo cierra.

### S1 — Bloqueantes para vender a un grupo

#### 1.1 🔴 No existe el «necesito saber»: cualquier cobrador ve la cartera entera
**Hoy:** los permisos son verbos a nivel empresa. `COLLECTOR` tiene `CASE_READ`, `PAYMENT_READ`,
`CLIENT_READ` sobre *todo* el tenant (`packages/shared/src/constants/permissions.ts:61`). El
`collectorId` de `clients.service.ts:315` es un **filtro opcional de la consulta**, no un límite: quien
llame sin él recibe la cartera completa. Ya lo sabíamos de un caso puntual — `GET /payments` devuelve
los pagos del tenant, no los del cobrador.

**Un banco:** un gestor ve su cartera asignada. Ver la de otro es un evento auditado y, en general,
un permiso aparte.

Y el campo sensible tampoco lo detiene: `CLIENT_PII_READ` existe y el cobrador **no** lo tiene, pero
el revelado se le abrió a propósito (`clients.controller.ts:59-63` — exigirlo hacía que el formulario
de edición guardara la máscara encima del carnet). La decisión está bien tomada y auditada
(`client/PII_REVEAL`); lo que deja en claro es que **el único límite que falta es cuáles filas**.

**El arreglo mínimo:** un `scope` por rol (`account` | `branch` | `own`) resuelto **en el servidor**,
que se traduzca en un `WHERE` obligatorio inyectado en el repositorio, igual que hoy se inyecta
`accountId`. Un solo lugar, no un `if` por endpoint. El `scope` ya está diseñado en
`apps/api/src/modules/auth/CLAUDE.md` — nunca se implementó.
Regla de revisión, idéntica a la del tenant: *si una consulta de lectura no lleva el scope del
usuario, el PR no pasa.*

Esfuerzo: **L** (es la más grande, y la que más vale).

#### 1.2 🔴 La bitácora se puede editar y borrar
**Hoy:** `audit_logs` está en la lista de tablas operativas del script de RLS, así que recibe
`GRANT SELECT, INSERT, UPDATE, DELETE` (línea 61). El modelo dice «APPEND ONLY» pero eso es una
convención de Prisma, no una regla de la base: cualquier SQL de la aplicación puede reescribir la
historia.

**Un banco:** la bitácora es lo único que sobrevive a la discusión. Debe ser inmutable y demostrable.

**El arreglo mínimo:** sacar `audit_logs` del bucle genérico y darle su propio bloque:
`GRANT SELECT, INSERT` solamente, más un trigger `BEFORE UPDATE OR DELETE` que lance excepción.
Encadenado con hash (`prev_hash` + hash de la fila) sólo si hace falta demostrárselo a un auditor
externo — es barato, pero no es lo que cierra el hueco.

Esfuerzo: **S**.

#### 1.3 🟠 Una policy de RLS sin `WITH CHECK`
**Hoy:** `user_permission_overrides` tiene `USING (account_id IS NULL OR ...)` y **no** tiene
`WITH CHECK` (`001_enable_rls.sql:78`). Se puede insertar un override apuntando a otra empresa.

**El arreglo mínimo:** agregar el `WITH CHECK` correspondiente. Y una prueba que intente el insert
cruzado y espere el rechazo — porque este hueco es invisible desde la aplicación.

Esfuerzo: **S**.

---

### S2 — El teléfono perdido

#### 2.1 🔴 La copia local de la cartera está en claro
**Hoy:** `apps/mobile/src/db.ts` usa `expo-sqlite` sin cifrar (`kobrax.db`). SecureStore protege los
tokens; la base con nombres, teléfonos, direcciones, saldos y GPS de los deudores, no. Un teléfono
rooteado o un respaldo del dispositivo entrega la cartera completa.

**Un banco:** el dato en el dispositivo va cifrado con una llave del enclave seguro, y se borra solo.

**El arreglo mínimo:** SQLCipher (`expo-sqlite` con `SQLITE_HAS_CODEC` o `op-sqlite`) con la llave
generada por dispositivo y guardada en SecureStore. **La cola no cambia de lugar** — se cifra igual,
pero sigue sin borrarse en el logout, porque puede ser un pago sin entregar.

Esfuerzo: **M** (el riesgo está en la migración: la base actual hay que descartarla, que es
exactamente lo que el diseño del caché ya contempla).

#### 2.2 🟠 La biometría es opcional y la decide el cobrador
**Hoy:** `biometric.ts` existe y el re-bloqueo funciona, pero es una preferencia personal.

**El arreglo mínimo:** que sea una política del tenant (`requireDeviceLock`), servida en
`GET /accounts/me` y aplicada en el arranque de la app. La empresa decide, no el cobrador.

Esfuerzo: **S**.

#### 2.3 🟠 No hay borrado remoto
**Hoy:** el admin puede revocar una sesión (ya existe), y el móvil borra el caché cuando el refresh
es rechazado — así que *el borrado ya ocurre*, pero recién la próxima vez que la app abra con red.

**El arreglo mínimo:** eso es suficiente para v1. Lo que falta es **nombrarlo** en el panel: un
botón «Cerrar sesión y borrar datos de este dispositivo» sobre la lista de sesiones, que es la
revocación que ya existe con el texto correcto. Sin construir nada nuevo.

Esfuerzo: **S**.

---

### S3 — El dato en reposo y en tránsito

#### 3.1 🟠 La llave de cifrado es una sola y no se puede rotar
**Hoy:** `APP_ENCRYPTION_KEY` en el `.env`, sin versión en el ciphertext
(`crypto.service.ts:34` → `iv.tag.ct`). Rotar la llave significa re-cifrar todo a mano, sin poder
distinguir qué fila está en qué llave.

**El arreglo mínimo:** prefijo de versión en el formato (`v1.iv.tag.ct`), mapa de llaves, y descifrado
que acepte las viejas. El re-cifrado se vuelve un trabajo en segundo plano en vez de una parada de
producción. **Ahora es una línea de formato; con datos en producción es una migración cara.**

Esfuerzo: **S ahora, L después.** Por eso está acá y no más abajo.

#### 3.2 🟠 Las evidencias viven en el disco de la API, en claro
**Hoy:** `uploads.service.ts` guarda en `UPLOADS_DIR` y sirve por `/api/uploads` (con su
`ponytail:` diciendo que el día que haya bucket se cambia el cuerpo). Fotos de deudores y firmas
en un directorio plano.

**El arreglo mínimo:** el driver de S3/R2 que el propio comentario ya previó, con cifrado del lado
del servidor y URL firmada de vida corta en vez de streaming por la API. **Está bloqueado por
infraestructura** (mismo bloqueo que L5 de límites de plan), no por código.

Esfuerzo: **M**, cuando haya bucket.

#### 3.3 🟠 El respaldo es un `pg_dump` sin cifrar, en el mismo disco
**Hoy:** `backup.service.ts` corre `pg_dump`, comprime y poda. Un archivo con **todos los tenants**
en claro, junto a la aplicación.

**El arreglo mínimo:** cifrarlo con la llave pública de respaldo (`age` o `gpg`) antes de escribirlo,
y mandarlo al mismo bucket de 3.2. Y una prueba de restauración anotada — un respaldo que nunca se
restauró no es un respaldo.

Esfuerzo: **S** (el cifrado) + **S** (la prueba, manual y anotada).

#### 3.4 🟡 Sin CSP en el panel y sin pinning en el móvil
**Hoy:** el panel web no declara ninguna `Content-Security-Policy` (`helmet` está en la API, que
sirve JSON; el HTML lo sirve Next). El móvil usa `fetch` plano contra `EXPO_PUBLIC_API_URL`, sin
pinning — aunque `apps/mobile/CLAUDE.md` lo declara como requisito.

**El arreglo mínimo:** `headers()` en `next.config.mjs` con CSP, HSTS y `frame-ancestors: none`.
El pinning **después de que la API tenga certificado y dominio estables**: pinnear contra un
certificado que va a cambiar es la forma más rápida de dejar a toda la flota sin app.

Esfuerzo: **S** la CSP · **M** el pinning, y no antes de tiempo.

---

### S4 — Detectar y demostrar

#### 4.1 🟡 Nada detecta que alguien se está llevando la cartera
**Hoy:** exportar, respaldar y listar no tienen techo de volumen ni alerta. Un usuario legítimo
puede bajarse todo, despacio, y no queda más rastro que una línea de auditoría por acción.

**El arreglo mínimo:** contar filas leídas/exportadas por usuario y día sobre el Redis que ya está,
y avisar al dueño de la cuenta al pasar el umbral (el canal de avisos ya existe, es el de los
límites de plan). No bloquear en v1 — avisar.

Esfuerzo: **M**.

#### 4.2 🟡 El borrado no borra
**Hoy:** soft delete en todo (`deleted_at`), sin purga. Correcto para operar, insuficiente cuando un
cliente pide que lo borren o cuando una empresa se va.

**El arreglo mínimo:** un trabajo de purga por tenant con retención configurable, que anonimice la PII
del cliente (nombre, documento, teléfonos, direcciones) y conserve los agregados financieros y la
bitácora. Se apoya en el cifrado que ya existe: *tirar la llave por tenant* es la vía más barata al
borrado criptográfico, y es la que conviene diseñar desde el 3.1.

Esfuerzo: **M**.

#### 4.3 🟡 Los secretos viven en `.env`
**Hoy:** `JWT_SECRET`, `JWT_REFRESH_SECRET`, `APP_ENCRYPTION_KEY`, SMTP, `DATABASE_URL`.

**El arreglo mínimo:** cuando haya proveedor de nube, su gestor de secretos. Hasta entonces, lo único
que importa de verdad: **que no estén en el repositorio** y que la rotación esté documentada.
No construir un gestor propio.

Esfuerzo: **S** (documentar), el resto es infraestructura.

---

## 2. Orden de trabajo propuesto

Ordenado por *riesgo real de la cuenta grupal que se valida esta semana*, no por prolijidad.

| # | Bloque | Qué entra | Por qué en ese orden |
|---|---|---|---|
| 1 | **Adentro de la empresa** | 1.1 scope por rol · 1.2 bitácora inmutable · 1.3 `WITH CHECK` | Es lo que la cuenta grupal rompe hoy. Sin esto no se puede decir «tu cobrador sólo ve lo suyo». |
| 2 | **Sesión** | 2.2 bloqueo obligatorio · 2.3 el botón con el texto correcto | Barato, y cierra el teléfono compartido. El robo de token ya está cubierto. |
| 3 | **El teléfono** | 2.1 base local cifrada | Es el único lugar donde la cartera entera está en claro fuera del servidor. |
| 4 | **Formato de llave** | 3.1 versión en el ciphertext | Una línea hoy, una migración cara con datos en producción. |
| 5 | **Borde** | 3.4 CSP · 3.3 respaldo cifrado | Rápidos y visibles en cualquier revisión externa. |
| 6 | **Cuando haya bucket** | 3.2 evidencias en S3/R2 firmadas | Bloqueado por infraestructura, igual que L5. |
| 7 | **Vigilancia** | 4.1 exfiltración · 4.2 purga · 4.3 secretos | Valen cuando ya hay volumen real que vigilar. |

---

## 3. Lo que NO se va a construir (y por qué)

- **Un motor de políticas tipo ABAC.** El `scope` de tres valores del punto 1.1 cubre lo que el
  producto necesita. Un motor de reglas es una segunda base de datos que nadie sabe depurar a las 3 am.
- **HSM propio / servicio de llaves propio.** Cuando haya proveedor, se usa el suyo.
- **Bitácora en cadena de bloques.** El trigger que impide `UPDATE`/`DELETE` da el 95% de la garantía
  por el 2% del trabajo.
- **Pinning antes de tener dominio y certificado definitivos.** Deja a la flota sin app y el beneficio
  es marginal sobre TLS bien configurado.
- **Bloquear por volumen en 4.1.** Avisar primero. Un umbral mal calibrado que corta a la operación es
  peor que el riesgo que evita.
- **Cifrar la cola del móvil aparte del caché.** Misma base, misma llave. Lo que la cola necesita no es
  otro cifrado, es no borrarse — y eso ya está resuelto.

---

## 4. Cómo se verifica cada bloque

Regla: cada punto deja **una prueba que falla si el control se rompe**, no un documento que diga que
se hizo.

- 1.1 → un test por endpoint de lectura: cobrador A pide, no aparece nada de cobrador B.
- 1.2 → un `UPDATE` contra `audit_logs` que espera excepción.
- 1.3 → insert cruzado de override que espera rechazo de la policy.
- 2.1 → abrir el archivo `kobrax.db` y verificar que no aparece ningún nombre en claro.
- 3.1 → descifrar un ciphertext `v1` con el mapa de llaves nuevo.
- 3.3 → restaurar el respaldo cifrado en un Postgres limpio, una vez, y anotar la fecha.

---

## 4.bis Cómo se aborda cada frente

Las tres preguntas —seguridad del dato, cifrado, offline— no se resuelven en la misma capa. Poner
las tres en el mismo lugar es el error clásico.

### A. Seguridad del dato → **el alcance va a la base, no a la aplicación**

La pregunta de diseño es dónde se impone «este cobrador sólo ve lo suyo». Hay dos opciones y una
gana claramente:

| | En la aplicación (repositorio/servicio) | **En la base (RLS), como el tenant** |
|---|---|---|
| Cubre el SQL crudo | ❌ **No.** Hay 26 `$queryRaw` en 16 archivos — 7 en `analytics`, 3 en `clients`. Es decir: la ruta por donde se leen muchas filas de golpe es justo la que se escapa. | ✅ Sí, sin tocarlos |
| Se puede olvidar | Sí, en cada endpoint nuevo | No |
| Simetría con lo que ya existe | Distinta del tenant | **Idéntica al tenant** |
| Costo en consultas calientes | Ninguno | Una subconsulta en la policy de `clients` |

**Decisión propuesta: RLS.** El aislamiento entre empresas ya lo garantiza la base y nadie lo puede
olvidar; el aislamiento dentro de la empresa merece exactamente la misma garantía. Y el argumento
decisivo no es la elegancia: es que el camino de lectura masiva (analytics) **hoy no pasa por Prisma**.

**Y sale casi gratis, porque las dos piezas ya están:**

1. `TenantContextService` ya propaga `accountId`, `userId` y `permissions` por `AsyncLocalStorage`
   (`common/context/tenant-context.service.ts`). El dato que la policy necesita ya viaja.
2. `withTenant` ya hace `SET LOCAL app.current_account_id`. Se le suman dos variables más
   (`app.current_user_id`, `app.current_scope`) en la misma línea, y las policies nuevas las leen
   igual que `app_current_account()`.

#### Contrato de scopes (cerrado)

Son **exactamente tres valores**. No hay un cuarto.

| Scope | Quién | Qué ve |
|---|---|---|
| `account` | Admin y Supervisor | Toda la cartera del tenant. **No depende del canal**: vale desde web y, si un flujo autorizado lo requiere, desde móvil. |
| `own` | Cobrador | Únicamente su **asignación efectiva** (abajo). **Channel-agnostic**: el mismo alcance en web y en móvil. |
| `system` | Trabajos de sistema autorizados | Se establece **explícitamente** por el contexto del job. Nunca por omisión. |
| *(ausente)* | — | **DENY / fail-closed.** No es un valor: es la falta de uno. |

Dos reglas que evitan que esto se degrade con el tiempo:

- **El canal no es un scope.** No existe `mobile` ni `web`. Si el móvil tuviera su propio modelo de
  seguridad habría dos verdades, y la que mandaría sería la más débil. La base determina el alcance;
  web y móvil sólo lo consumen.
- **Una asignación temporal tampoco es un scope.** Es un dato de la asignación efectiva, dentro de `own`.

#### Contrato de asignación efectiva

```
effective_assignment(user, credit) =
      asignación permanente vigente
   OR asignación temporal vigente
```

Una asignación temporal **no reemplaza ni destruye** la permanente. Ejemplo canónico:

> Crédito 123 · permanente → Juan · temporal → Sara.
> Sara opera mientras la temporal esté vigente. Juan conserva la suya. Al expirar, Sara deja de verlo
> y la de Juan sigue intacta.

La asignación temporal debe: ser creada por un actor autorizado (Supervisor/Admin), tener
trazabilidad y auditoría, usuario origen y destino cuando corresponda, fecha de inicio y de
expiración, y **no puede otorgársela un cobrador a sí mismo**.

**Importación desde móvil.** Cuando un flujo del móvil incorpora cartera para un cobrador, el sistema
**crea o actualiza la asignación**; esos créditos entran a su asignación efectiva. El cobrador no
recibe acceso a toda la cartera del tenant, y la app **no descarga todo para filtrar localmente**:

```
DB → RLS/scope → alcance efectivo → API → caché móvil     ✅
DB completa → API → móvil → filtro local                  ❌
```

#### 🔴 Gap bloqueante: el modelo de datos NO soporta este contrato

Antes de escribir una sola policy hay que resolver esto. Lo que hay hoy:

| Vínculo | Grano | Problema |
|---|---|---|
| `credits.assigned_manager_id` | Crédito | Lo más parecido a una asignación permanente. Lo setea la importación cuando el archivo es de un oficial (`portfolio-import.service.ts:674`). Nullable, referencia suave. |
| `collection_cases.assignee_id` | **Caso, no crédito** | Nullable, referencia suave, y **de un solo valor: asignar a Sara borra a Juan.** |
| `route_plans.collector_id` | Día | Es una jornada, no una asignación. |
| `agenda_items.assignee_id` | Ítem | Idem. |

Cuatro huecos concretos contra el contrato:

1. **No existe ninguna entidad de asignación temporal.** Ni tabla, ni vigencia, ni otorgante, ni
   origen/destino. Los ocho requisitos de la asignación temporal no tienen dónde vivir.
2. **La asignación es destructiva.** `assignee_id` es una columna escalar: reasignar sobrescribe.
   Viola directamente «la temporal no destruye la permanente».
3. **El contrato es a nivel crédito y el modelo asigna a nivel caso.** Y los casos son **transitorios**:
   el trabajo diario de mora los abre y los cierra según la mora (en la corrida real: 924 cerrados,
   1588 → 666 abiertos). Con `own` basado en casos, **el cobrador pierde de vista al cliente en cuanto
   se pone al día** — que es justo cuando hay que sostener la relación.
4. **Hay dos nociones de «permanente» compitiendo** (`assigned_manager_id` a nivel crédito vs
   `assignee_id` a nivel caso) y ningún documento dice cuál manda.

**Qué falta, dicho como entrega y no como migración** (la migración NO se improvisa acá):

- una entidad de asignación crédito↔usuario con: tipo (permanente | temporal), vigencia (inicio,
  expiración nullable para la permanente), otorgante, estado, y borrado no destructivo;
- la regla de unicidad: una permanente vigente por crédito, N temporales vigentes;
- la guarda de auto-otorgamiento (otorgante ≠ destinatario) como constraint, no como `if`;
- la decisión de qué pasa con `credits.assigned_manager_id` y `collection_cases.assignee_id`:
  cuál se migra a la entidad nueva y cuál queda como dato operativo;
- el punto de escritura en la importación del móvil.

**Hasta que esto esté cerrado, las policies de `own` no se pueden escribir**: no hay contra qué
consultar. `account` y `system` sí serían escribibles hoy, pero partir el trabajo dejaría a `own`
—el único scope que realmente restringe— sin implementar, que es la mitad que importa.

#### ✅ El modelo, resuelto (2026-08-26)

`credit_assignments` (migración `20260826000000`). Tres formas, **sin columna de tipo que pueda
contradecirse con las fechas**:

| Forma | Cómo se reconoce | Vence |
|---|---|---|
| Permanente | `expires_at IS NULL AND case_id IS NULL` | Nunca. **Una sola vigente por crédito** (índice único parcial) |
| Temporal con fecha | `expires_at` puesta | Sola |
| Temporal atada a un caso | `case_id` puesta | Al cerrarse el caso se revoca (decisión de la dueña: por defecto al cerrar, con fecha opcional encima; vence lo que ocurra primero) |

Nada se borra: revocar es `revoked_at`, así que la tabla **es** el historial. La auto-asignación la
cierra el permiso `assignment:write` (Admin, Gerente, Supervisor — el cobrador no lo tiene), no un
constraint: un supervisor **sí** puede tomarse un crédito para cubrir a alguien de baja, y una regla
dura de «otorgante ≠ destinatario» bloquearía ese caso legítimo.

`collection_cases.assignee_id` **se queda** como dato operativo (quién trabaja esta cobranza hoy:
rutas, agenda, balanceo). Deja de decidir quién ve qué.

#### 🔴 Y el gap que apareció al medir la base real

La tabla es correcta y **está vacía por definición**. Contra la base de producción, hoy:

| | |
|---|---|
| Créditos vivos | **301.640** |
| Con `assigned_manager_id` (la supuesta asignación permanente) | **1** |
| Con `branch_id` | **0** — y hay **0 sucursales** |
| Cobranzas con cobrador | 1.628, sobre **1.629 créditos** (0,54% de la cartera) — y 964 ya cerradas |
| Cobradores activos | **37** |

**No existe reparto de cartera en este sistema.** Los 37 cobradores ven los 301.640 créditos porque
nada los limita — que es exactamente el hueco §1.1, ahora medido. El backfill desde
`assigned_manager_id` crea **una** fila, y el vínculo real (casos) cubre medio punto porcentual de la
cartera y además es transitorio.

Consecuencia dura: **encender `own` en F2 sin resolver la población deja a los 37 cobradores sin
cartera.** No es un riesgo teórico; es aritmética.

Lo que falta ya no es esquema, es una **decisión de producto: cómo se reparte la cartera.** Los
caminos posibles, sin recomendación todavía porque es una decisión de campo:

1. **Desde la importación** — el extracto trae un oficial por crédito y el import lo escribe. El
   camino ya existe a medias (`portfolio-import.service.ts:674`, `scope.kind === 'official'`) y nadie
   lo usa. Es el único que puede repartir 301.640 créditos sin trabajo manual.
2. **Por agencia/sucursal** — hoy imposible: 0 sucursales, 0 créditos con `branch_id`. Es el módulo L6,
   sin construir.
3. **Manual por el supervisor** — 301.640 créditos entre 37 personas a mano no es un plan.
4. **Derivada de la actividad** — quien gestionó el crédito queda asignado. Reparte solo, pero
   arranca en cero y tarda meses en cubrir la cartera.

**Ninguna se implementa hasta que se elija.** Y hasta entonces F2 no puede encender `own`.

#### 🔴 Hallazgo nuevo: la línea que sostiene todo el aislamiento está concatenada

`prisma.service.ts:43`:

```ts
await tx.$executeRawUnsafe(`SET LOCAL app.current_account_id = '${accountId}'`);
```

Es **la única línea de la que depende el aislamiento entre empresas**, y es la que está armada
pegando strings. Hoy no es explotable porque el `accountId` sale del JWT firmado — pero la garantía
vive fuera del archivo: alcanza con que un solo llamador futuro pase un `accountId` que venga de un
parámetro o de un cuerpo de request para que se pueda cerrar la comilla y reescribir el contexto de
tenant. Es exactamente la clase de suposición que se rompe seis meses después, en un endpoint que
todavía no existe.

**El arreglo, que además es lo que hace falta para el scope:**

```ts
await tx.$queryRaw`SELECT set_config('app.current_account_id', ${accountId}, true),
                          set_config('app.current_user_id',    ${userId},    true),
                          set_config('app.current_scope',      ${scope},     true)`;
```

`set_config` es una función normal, así que acepta parámetros ligados — que es justo lo que
`SET LOCAL` no permite y lo que llevó al `Unsafe`. Esfuerzo: **S**. Va antes que las policies.

#### ✅ F1 — hecho (2026-08-26)

| Punto del contrato | Dónde queda resuelto |
|---|---|
| 1. Cómo se establece `account_id` | `prisma.service.ts` → `runScoped()`, parámetro ligado en `set_config('app.current_account_id', …)` |
| 2. Cómo se establece `user_id` | Igual, desde `TenantContextService` (AsyncLocalStorage). Vacío en `system`. |
| 3. Cómo se establece el scope | Derivado del permiso `data:scope:all`: con él → `account`, sin él → `own` |
| 4. `own` vale en web **y** móvil | El contexto no lleva canal: no hay de dónde sacar un alcance distinto por cliente |
| 5. `own` = asignación efectiva | Documentado arriba. **No implementado**: bloqueado por el gap de modelo de datos |
| 6–9. Permanente / temporal / no destructiva / autorizada y auditada | Contrato escrito arriba; **el modelo de datos no lo soporta todavía** |
| 10. Scope ausente = DENY | Se escribe la variable vacía → `app_current_scope()` devuelve NULL → toda policy niega |
| 11. `system` explícito | `withSystemTenant()`, única puerta de elevación. `grep withSystemTenant` la audita |
| 12. Canal y scope no se mezclan | `DataScope` tiene tres valores y un test lo fija |

**No se escribieron policies de RLS.** `002_scope.sql` define únicamente los helpers de lectura
(`app_current_user()`, `app_current_scope()`, `app_scope_sees_all()`), así que se puede aplicar sin
cambiar el comportamiento de nada.

#### ⚠️ Dos requisitos que F2 no puede saltear

1. **Los permisos nuevos no están en la base.** `data:scope:all` y `assignment:write` existen en el
   mapa de `shared`, pero la tabla `permissions` tiene **0 filas** con esos códigos — y los
   `permissions` del JWT salen de `role_permissions`, no del mapa. Efecto hoy: **todos**, admin
   incluido, derivan `own`. Es inofensivo mientras no haya policies, y es fail-closed, que es el lado
   correcto para equivocarse. Pero el día que F2 encienda las policies, **el admin se queda sin ver
   nada** hasta que estos dos permisos se siembren. El propio archivo ya avisa que el seed y el mapa
   se separaron en silencio una vez (2026-08-06); esta es la segunda.
2. **La migración `20260826000000` está escrita y probada, pero NO aplicada.** A propósito: nada
   escribe todavía en `credit_assignments`, así que aplicarla ahora no aporta nada y la decisión de
   reparto pendiente todavía podría tocarla. Se aplica con `prisma migrate deploy` y **después hay
   que volver a correr `001_enable_rls.sql`**, que ya lista la tabla nueva.

### B. Cifrado → **tres capas distintas, y no cifrar de más**

El error caro acá es cifrar todo a nivel de aplicación. Cada campo cifrado deja de poder buscarse,
ordenarse y agruparse, y el módulo de mora entero vive de ordenar por saldo y por días.

| Capa | Qué protege | Estado |
|---|---|---|
| **Campo (AES-256-GCM en la app)** | Al que tiene acceso legítimo a la base | ✅ Documento del cliente + secreto MFA. **Y así queda.** |
| **Volumen / disco + respaldo cifrado** | Al que se lleva el disco o el archivo de respaldo | ❌ Falta el respaldo (3.3); el disco es del proveedor |
| **Tránsito (TLS)** | Al que escucha la red | ✅ Falta endurecer (3.4) |

Lo que **no** se cifra a nivel campo, y por qué: teléfono, dirección, montos y fechas. La amenaza que
eso cubriría —volcado de base robado— la cubre mejor la capa de volumen, sin romper media aplicación.
Y para lo que sí se cifra, la búsqueda ya está resuelta con el blind index (HMAC-SHA256 con llave
propia, distinta de la de cifrado).

**Lo único que hay que hacer hoy es una línea:** el prefijo de versión en el ciphertext
(`v1.iv.tag.ct`). Sin él no hay rotación posible: no se puede saber qué fila está cifrada con qué
llave. Hoy es un cambio de formato; con datos en producción es una migración con parada.

**Y una decisión de diseño que conviene tomar ahora aunque se implemente después:** llave por tenant,
envuelta por la llave maestra (DEK/KEK). No es purismo — es lo que vuelve barato el borrado del
punto 4.2: dar de baja a una empresa o borrar a un cliente pasa a ser *tirar una llave* en vez de
recorrer y sobrescribir tablas. Se diseña junto con el versionado, se implementa cuando haya KMS.

### C. Offline → **primero achicar lo que baja, después cifrarlo**

El orden importa más que la técnica:

**1. Lo que más protege el dato offline es el punto 1.1, y no cuesta nada extra.** Hoy el teléfono
de un cobrador puede tener la cartera completa de la empresa. Con el alcance impuesto en la base,
el mismo teléfono baja **solamente su cartera asignada**. Es la misma corrección: reduce la
superficie antes de cifrarla, que siempre es más barato que cifrar de más.

**2. Recién después, cifrar la base local.** `expo-sqlite` no soporta cifrado: hay que pasar a
SQLCipher (`op-sqlite`). El costo real es menor de lo que parece, porque **la app ya requiere dev
build** para los mapas — no se pierde nada que hoy se tenga.

**3. La línea que ya está bien trazada y hay que respetar al cifrar.** `db.ts` separa dos cosas con
naturalezas opuestas, y la seguridad las trata distinto:

| | `cache` | `queue` |
|---|---|---|
| Qué es | Copia de lo que el server ya sabe | Trabajo sin entregar (puede ser un pago) |
| Al cerrar sesión | **Se borra** (ya pasa, en los 4 caminos de cierre) | **No se borra nunca** |
| Vida | Atada a la sesión de 8 h | Hasta que suba |
| Cifrado | Misma llave | Misma llave |

O sea: la expiración del caché **ya está resuelta** por `clearSession`, y no hay que inventarle un
TTL propio. Lo único que falta es el cifrado.

**El riesgo que hay que aceptar en voz alta:** con la llave del dispositivo en SecureStore, si el
usuario borra los datos de la app o restaura el teléfono, la cola cifrada se vuelve ilegible y se
pierde un pago sin entregar. No es un riesgo nuevo —hoy ese teléfono perdido pierde la cola igual—,
pero conviene decidirlo a propósito y no descubrirlo. La mitigación barata, si algún día duele:
subir la cola apenas hay señal, que es lo que el `SyncService` ya intenta cada 30 s.

---

## 5. Grado de verificación de este documento

Este plan se escribió leyendo el código, no de memoria. Pero no todo se verificó igual, y la
diferencia importa: **un hueco inventado cuesta una semana de trabajo que no hacía falta.**

| Afirmación | Cómo se verificó |
|---|---|
| 1.1 sin scope por fila | ✅ Leído: `permissions.ts:61-84` (COLLECTOR tiene `CLIENT_READ`/`CLIENT_WRITE`/`CREDIT_WRITE`), `clients.service.ts:315` (`collectorId` es filtro opcional), y búsqueda de `RoleType.COLLECTOR` en todos los módulos: sólo aparece en tests y en el gateway de realtime. **No hay imposición de alcance en ningún lado.** |
| 1.2 bitácora editable | ✅ Leído: `001_enable_rls.sql:30` mete `audit_logs` en el array operativo y la línea 61 le da `UPDATE, DELETE`. |
| 1.3 policy sin `WITH CHECK` | ✅ Leído: `001_enable_rls.sql:75-80`. |
| 2.1 SQLite en claro | ✅ Leído: `db.ts:19` importa `expo-sqlite` pelado, sin códec. |
| 3.1 llave sin versión | ✅ Leído: `crypto.service.ts:34`, formato `iv.tag.ct`. |
| 3.4 sin CSP / sin pinning | ✅ Búsqueda sin resultados en `apps/web` para CSP; `api.ts:2` usa `fetch` plano. |
| 3.2 uploads en disco · 3.3 respaldo sin cifrar | ⚠️ Verificado por búsqueda, no leyendo el archivo entero. La conclusión es firme (el propio `ponytail:` de `uploads.service.ts:49` la confirma), el detalle puede tener matices. |
| 4.1 · 4.2 · 4.3 | ⚠️ Ausencias, no hallazgos. Se afirma que *no existe* algo; se verificó buscando, que es más débil que leer. |
| A · `$executeRawUnsafe` concatenado | ✅ Leído: `prisma.service.ts:43`. **No se verificó llamador por llamador** que hoy todos pasen un `accountId` del JWT — la afirmación es sobre la construcción, no sobre una explotabilidad actual. |
| A · 26 `$queryRaw` en 16 archivos | ✅ Conteo real de la búsqueda (incluye specs, así que la cifra de código productivo es algo menor; los de `analytics` y `clients` sí son productivos). |
| C · `expo-sqlite` sin cifrado, dev build ya requerido | ⚠️ Lo primero es firme (`db.ts:19`). Lo del dev build sale de `apps/mobile/CLAUDE.md` («mapas en dev build»), no de haber corrido el build. |

**Un punto ya se cayó en la revisión:** la primera versión de este plan decía que faltaba detectar
el reuso del refresh. Es falso — está implementado y bien (`auth.service.ts:457-490`), con ventana de
gracia para carreras y el error lanzado fuera de la transacción. El error fue mío: busqué en
`session.service.ts` en vez del flujo real. Queda anotado a propósito, porque es el tipo de hueco
inventado del que este documento tiene que cuidarse.
