# KOBRAX · EPIC F4 — Core Financiero: Clientes & Créditos
> *Control total, máxima recuperación.*

**ID:** EPIC-F4 · **Estado:** ⏳ Pendiente — Próximo a ejecutar (adelantado sobre F3)
**Owner:** API + Security + Database + Shared + Testing
**Depende de:** F2a (JwtAuthGuard · RolesGuard · TenantGuard · CryptoService)
**Desbloquea:** F5 (Casos de cobranza) · F7 (Pagos)
**Requisitos:** RF-04 · RF-05 · CU-02 · RNF-01 (datos sensibles / fintech)

---

## 1. Contexto y Posicionamiento en la Plataforma

Kobrax es la plataforma de cobranza inteligente enterprise para Latinoamérica. EPIC F4 construye el núcleo financiero: el maestro de clientes deudores y sus obligaciones de crédito. Sin estos datos, ninguna funcionalidad de campo (F5, F6) ni de pagos (F7) puede operar.

### 1.1 Mapa de dependencias del proyecto

| EPIC | Nombre | Estado | Relación con F4 | Prioridad |
|------|--------|--------|-----------------|-----------|
| F1 | Fundamentos & Schema | ✅ Completo | Schema Pilar 2 ya migrado | Base |
| F2a | Auth + Guards + CryptoService | ✅ Completo | Dependencia directa | Prereq. |
| **F4 ★** | **Core Financiero (este EPIC)** | ⏳ Próximo | **ESTE DOCUMENTO** | **Crítico** |
| F5 | Casos de Cobranza | 🔒 Bloqueado | Depende de F4 | Alta |
| F6 | Rutas y Visitas en Campo | 🔒 Bloqueado | Depende de F5 | Alta |
| F7 | Pagos y Recálculo de Saldo | 🔒 Bloqueado | Depende de F4 | Alta |
| F3 | RBAC Admin (diferido) | ⏸ Diferido | No bloquea F4 | Fin proyecto |

> **Decisión 2026-06-18:** F4 se adelanta sobre F3 porque los permisos `client:*`/`credit:*` ya están sembrados en `role_permissions` y los guards existen desde F2a. F4 es el primer EPIC con endpoints de recursos reales, lo que habilita `TenantContextInterceptor` y `AuditInterceptor`.

---

## 2. Análisis de Gaps — Qué Falta Para Empezar F4

El schema Pilar 2 está migrado y conforme al documento `DB_Architecture_COBRA`. Los gaps son 100% de capa de aplicación más un conjunto acotado de mejoras de privacidad/integridad.

### 2.1 Gaps BLOQUEANTES 🔴
> Deben resolverse antes de escribir la primera línea de F4.

| # | Gap | Descripción | Acción requerida | Agente |
|---|-----|-------------|-----------------|--------|
| **G1** | CryptoService en módulo auth | Está acoplado a `AuthModule`. Clients necesita AES-256-GCM y no puede importar `AuthModule`. | Promover a `common/crypto` como módulo global. Exportar `CryptoService` + `BlindIndexService` desde `@kobrax/shared`. | Security |
| **G2** | Migración PII Protection | `national_id` y `tax_id` en `Client`, `value` en `ClientContact`, `address` en `ClientLocation` están en texto claro. Viola RNF-01. | Migration `add_client_pii_protection`: columnas a ciphertext (`iv.tag.ct`), nueva col `national_id_hash` (HMAC), `@@unique([accountId, nationalIdHash])`. | Database |
| **G3** | Variable `APP_BLIND_INDEX_KEY` faltante | No existe en `.env` ni en el schema de validación de `ConfigModule`. | Añadir al `.env`, `.env.example` y schema Joi/Zod. Verificar al boot con error claro si ausente. | Security / DevOps |
| **G4** | `TenantContextInterceptor` no implementado | Diferido de F2. Sin él, todas las queries corren como superuser → el RLS de Postgres no recibe `account_id` por request → fuga cross-tenant garantizada. | Implementar interceptor que llama `prisma.withTenant(accountId)` antes de llegar al controller. Registrar globalmente. | Security |
| **G5** | `AuditInterceptor` no implementado | Diferido de F2. F4 es la primera fase con mutaciones de negocio reales. Sin audit trail no cumple estándar fintech ni el DoD. | Interceptor post-handler para POST/PATCH/DELETE: registra `who/when/entity/before/after(redactado)/ip/userAgent` en `audit_logs` append-only. | Security |

### 2.2 Gaps IMPORTANTES 🟡
> Deben resolverse en F4, pero no bloquean el setup inicial.

| # | Gap | Descripción + Acción | Criterio de aceptación | Agente |
|---|-----|---------------------|------------------------|--------|
| **G6** | Módulo Clients inexistente | Crear `clients.module`, `clients.service`, `clients.controller`. DTOs con `class-validator` + `whitelist` + `forbidNonWhitelisted`. | `POST /clients` devuelve 201 con PII tokenizada | API |
| **G7** | Sub-recursos de cliente | No existen endpoints para `contacts`, `locations` (GPS + `photo_urls` JSONB), `relations` (red garante/familiar/vecino), `attachments` (`file_hash` SHA-256 inmutable). | CRUD completo; adjunto sella hash al subir | API |
| **G8** | Módulo Credits inexistente | Crear con generador de cronograma (amortización francesa/flat). Invariante: Σ cuotas = principal + interés. `outstanding_balance = principal` al crear. | `POST /credits` genera schedule con suma correcta | API |
| **G9** | Servicio de mora no existe | `days_past_due` y `arrear` existen en schema pero no hay lógica de recálculo. Crear `ArrearsService` parametrizable por `account.configuration`. Idempotente. | `POST /credits/:id/recalculate-arrears` devuelve mora correcta en seeds | API |
| **G10** | Tokenización PII en respuestas | No existe helper `tokenize()` en `@kobrax/shared`. Crear `maskDocument()` → `"12345***"`, `maskPhone()` → `"777****"`. Reveal solo con `?reveal=true` + permiso elevado (auditado). | Respuesta sin `?reveal` nunca muestra PII en claro (test) | Shared |
| **G11** | Búsqueda por documento rota al cifrar | Al cifrar `national_id`, los filtros `?q=CI-12345` dejan de funcionar. Usar `national_id_hash` (HMAC determinista) para buscar y deduplicar. | `GET /clients?q=CI-12345` resuelve por hash | API + Database |
| **G12** | Etiquetas de concepto por tenant | `credit_configuration` en `account.configuration` (JSONB): p.ej. `principal_amount` → "capital". Respuestas de `/credits/:id` incluyen labels del tenant. | Labels personalizados visibles en respuesta de crédito | API/Shared |

### 2.3 Gaps DIFERIDOS ⏸
> Documentados, no bloquean F4.

| # | Gap | Descripción | Diferido a |
|---|-----|-------------|-----------|
| D1 | `data_access_log` de lectura PII | Registrar cada acceso `?reveal=true` en tabla transversal. | F12 (Auditoría avanzada) |
| D2 | Enum `gender` + catálogo `risk_segment` | Hoy son texto libre. Migración opcional para integridad. | Diferible dentro de F4 o F8 |
| D3 | Rotación de claves cifrado/HMAC | Formato `iv.tag.ct` permite re-cifrado. Procedimiento debe documentarse. | F12 / DevSecOps |
| D4 | BYOK (Bring Your Own Key) | `tenant_encryption_key` y soberanía de claves por tenant. Requerimiento enterprise avanzado. | F12 |
| D5 | Recálculo de saldo al cobrar | `outstanding_balance` se recalcula al registrar pagos. Frontera explícita: F4 fija estado inicial. | F7 (Pagos) |
| D6 | Admin RBAC (F3) | Gestión de roles custom, `user_permission_override`, usuarios/tenants/branches. | F3 (fin de proyecto) |

---

## 3. Contratos API Completos

> Todos los endpoints requieren: `Bearer JWT` (`JwtAuthGuard`) + `TenantGuard` + `RolesGuard`.
> Respuestas en formato `{data, meta, error}`. PII tokenizada por defecto.
> `?reveal=true` solo con permiso elevado → genera entrada en `audit_logs`.

### 3.1 Módulo Clientes — CU-02

| Método + Ruta | Permiso | Código OK | Comportamiento clave | Errores |
|---------------|---------|-----------|----------------------|---------|
| `POST /clients` | `client:write` | 201 | Cifra PII, calcula `national_id_hash`, verifica unicidad, tokeniza respuesta | `409 CLIENT_DUP` |
| `GET /clients` | `client:read` | 200 | Paginado. Filtros: `status`, `risk`, `q` (por hash). PII tokenizada. | `400 INVALID_FILTER` |
| `GET /clients/:id` | `client:read` | 200 | Incluye contactos, ubicaciones, relaciones. `?reveal=true` → plaintext + audit. | `404 RESOURCE_NOT_FOUND` |
| `PATCH /clients/:id` | `client:write` | 200 | Re-cifra PII modificada. Recalcula hash si cambia documento. Emite `audit_log`. | `409 CLIENT_DUP` · `404` |
| `DELETE /clients/:id` | `client:write` | 204 | Soft delete (`status = INACTIVE`, `deleted_at`). Emite `audit_log`. | `404 RESOURCE_NOT_FOUND` |

#### Sub-recursos del cliente
> Todos requieren `client:write` y emiten `audit_log`.

| Método + Ruta | Código | Notas de implementación |
|---------------|--------|------------------------|
| `POST /clients/:id/contacts` | 201 | Cifra `contact.value`. Solo un `is_primary` por tipo. Tokeniza en respuesta. |
| `PATCH /clients/:id/contacts/:cid` | 200 | Re-cifra si cambia `value`. `is_verified` solo con permiso elevado. |
| `DELETE /clients/:id/contacts/:cid` | 204 | Soft delete. No eliminar único contacto primario si hay créditos activos. |
| `POST /clients/:id/locations` | 201 | Acepta GPS (lat/lng), `photo_urls` JSONB, `visit_schedule` JSONB. Cifra `address`. |
| `PATCH/DELETE /clients/:id/locations/:lid` | 200/204 | PATCH re-cifra `address`. `photo_urls` actualizable vía PATCH. |
| `POST /clients/:id/relations` | 201 | `relation_type`: `GUARANTOR \| FAMILY \| NEIGHBOR \| OTHER`. `is_contactable` boolean. |
| `PATCH/DELETE /clients/:id/relations/:rid` | 200/204 | Soft delete en DELETE. |
| `POST /clients/:id/attachments` | 201 | Recibe `file_url`. Sella `file_hash` SHA-256. **Inmutable**: no hay PATCH. |
| `DELETE /clients/:id/attachments/:aid` | 204 | Solo baja lógica (`is_deleted = true`). |

### 3.2 Módulo Créditos

| Método + Ruta | Permiso | Código | Comportamiento clave | Errores |
|---------------|---------|--------|----------------------|---------|
| `POST /credits` | `credit:write` | 201 | Genera cronograma completo. `outstanding_balance = principal`. Valida Σ cuotas. Emite audit. | `400 SCHEDULE_INVALID` |
| `GET /credits` | `credit:read` | 200 | Filtros: `clientId`, `status`, `branchId`, `page`, `limit`. | `400 INVALID_FILTER` |
| `GET /credits/:id` | `credit:read` | 200 | Incluye installments + arrears + labels de concepto del tenant. | `404 RESOURCE_NOT_FOUND` |
| `PATCH /credits/:id` | `credit:write` | 200 | Solo campos permitidos. Emite audit. | `400` · `404` |
| `GET /credits/:id/schedule` | `credit:read` | 200 | Cronograma con estado por cuota (PENDING/PAID/OVERDUE), capital, interés, saldo. | `404` |
| `POST /credits/:id/recalculate-arrears` | `credit:write` | 200 | Recalcula `days_past_due` y `Arrear`. Parametrizado por `account.configuration`. Idempotente. | `404` · `422` |

### 3.3 Códigos de error estándar F4

| Código | HTTP | Descripción |
|--------|------|-------------|
| `CLIENT_DUP` | 409 | Documento ya registrado en este tenant. Mensaje genérico sin revelar si el registro existe. |
| `SCHEDULE_INVALID` | 400 | Cronograma generado no cumple la invariante Σ cuotas = principal + interés. |
| `RESOURCE_NOT_FOUND` | 404 | El recurso no existe O no pertenece al tenant actual. Mensaje genérico (anti-enumeración). |
| `INSUFFICIENT_PERMISSION` | 403 | Intento de usar `?reveal=true` sin permiso `client:pii:read` o `credit:pii:read`. |

---

## 4. Especificaciones UI/UX

> Kobrax no es "una app básica de cobranza". Cada pantalla debe transmitir tecnología, confianza y eficiencia.

### 4.1 Principios de diseño para F4

- **Tipografía:** Plus Jakarta Sans como tipografía principal · DM Mono para montos (`Bs 1,250.00`), IDs (`#KBX-2024-001`), fechas de vencimiento.
- **Colores:** Deep Teal `#004D40` (acciones principales) · Mint White `#FAFFFE` (fondo) · Cool Teal `#008080` (secundario).
- **Estados de cuota:** Pagado `#1B5E20` · Mora `#BF360C` · Pendiente `#546E7A`.
- **PII siempre tokenizada** en listados (`777****` / `12345***`). Botón "Revelar" visible solo para usuarios con permiso `client:pii:read`. Cada reveal queda auditado.
- Loading states en cada acción asíncrona. **Skeleton screens** en lugar de spinners genéricos.
- Confirmaciones destructivas con **diálogo modal** — nunca acción inmediata en DELETE.
- Mensajes de error **nunca revelan existencia** de registros (anti-enumeración).

### 4.2 Pantallas — Módulo Clientes

| Pantalla | Contenido y funcionalidad | Consideraciones UX/Seguridad |
|----------|--------------------------|------------------------------|
| **Lista de clientes** | Tabla paginada: nombre, documento (tokenizado), segmento riesgo (badge color), estado (chip), fecha de ingreso. Filtros: búsqueda, estado, segmento. Botón `+ Nuevo cliente`. | Documento siempre como `12345***`. Sin botón Revelar en lista. Búsqueda usa blind index en backend. |
| **Detalle del cliente** | Header con nombre, ID, segmento riesgo. Tabs: Información General \| Contactos \| Ubicaciones \| Relaciones \| Documentos \| Créditos. Botones Editar y Dar de baja. | Tab General muestra PII tokenizada + botón "Revelar" (permiso + audit). Tab Créditos muestra saldo total y días mora en badges. |
| **Formulario nuevo/editar** | Tipo persona, documento, nombre, fecha nac./constitución, género, segmento riesgo. Validación en tiempo real. Detección de duplicado al salir del campo documento. | Al escribir en campo documento: consulta debounce al backend por hash. Si duplicado → inline warning antes de enviar. |
| **Red de investigación** | Vista agrupada: Contactos (tipo, canal, verificado), Ubicaciones (mapa mini + horario visita), Relaciones (garante/familiar/vecino + `is_contactable`). | Teléfonos/emails tokenizados. Mapa usa coordenadas GPS. Documentos muestran nombre + hash, no URL directa. |

### 4.3 Pantallas — Módulo Créditos

| Pantalla | Contenido y funcionalidad | Consideraciones UX/Seguridad |
|----------|--------------------------|------------------------------|
| **Lista de créditos** | Tabla: código, cliente, monto principal, saldo vigente, estado, días mora, cuotas al día/vencidas. Filtros: cliente, estado, sucursal, rango de fechas. | Columna días mora con color dinámico: 0 = verde · 1-30 = amarillo · 31-60 = naranja · >60 = rojo. Monto en DM Mono. |
| **Detalle del crédito** | Header: cliente, código, estado, días mora, saldo. Tabs: Cronograma \| Mora \| Historial pagos (F7) \| Documentos. Labels de concepto según configuración del tenant. | Tab Cronograma: tabla con número cuota, fecha, capital, interés, total, estado (chip), saldo restante. Cuotas vencidas resaltadas en rojo suave. |
| **Nuevo crédito (wizard)** | Paso 1: Seleccionar cliente. Paso 2: Configurar crédito (monto, tasa, cuotas, tipo amortización, fecha desembolso). Paso 3: Preview cronograma. Paso 4: Confirmar y crear. | Preview generado en tiempo real (llamada al backend). Validar Σ cuotas antes de habilitar Confirmar. Alerta si cliente tiene otros créditos activos. |
| **Panel de mora** | Créditos con `days_past_due > 0`, ordenados desc. Acción rápida "Recalcular mora" por crédito o masivo. Muestra: días mora, monto en mora, penalización, interés moratorio. | Botón Recalcular visible solo para `credit:write`. Confirmar modal antes de recálculo masivo. Resultado visible inmediatamente sin reload. |

---

## 5. Arquitectura de Seguridad — Fintech Grade

### 5.1 Flujo de datos PII

| Etapa | Campo | En tránsito (API) | En reposo (DB) | En respuesta |
|-------|-------|-------------------|----------------|-------------|
| Cliente · Documento | `national_id` / `tax_id` | TLS 1.3 | AES-256-GCM (`iv.tag.ct`) | `12345***` |
| Contacto · Valor | `contact.value` | TLS 1.3 | AES-256-GCM | `777****` |
| Ubicación · Dirección | `address` | TLS 1.3 | AES-256-GCM | `Calle ****` |
| Búsqueda por documento | `national_id_hash` | `q=CI-12345` → hash en backend | HMAC-SHA256 (blind index) | No expuesto |
| Reveal (con permiso) | Todos los PII | `?reveal=true` + token | Descifra en memoria | Plaintext + `audit_log` |

### 5.2 Variables de entorno — Checklist pre-arranque

| Variable | Formato | Propósito | Estado |
|----------|---------|-----------|--------|
| `APP_ENCRYPTION_KEY` | 32 bytes hex | Clave maestra AES-256-GCM. Existente desde F2a. | ✅ Existe |
| `APP_BLIND_INDEX_KEY` | 32 bytes hex | HMAC-SHA256 para blind index. **DEBE ser distinta** de `ENCRYPTION_KEY`. | ❌ **Falta** |
| `DATABASE_URL` | Connection string | Conexión Postgres con RLS. | ✅ Existe |
| `JWT_SECRET` / `JWT_EXPIRY` | String / tiempo | Auth JWT. Existente desde F2a. | ✅ Existe |

### 5.3 Checklist de seguridad F4 (DoD de seguridad)

- [ ] Toda query corre con contexto RLS del tenant (`TenantContextInterceptor` + `kobrax_app`, nunca superuser).
- [ ] `JwtAuthGuard` + `TenantGuard` + `RolesGuard` en **todos** los endpoints — sin excepción.
- [ ] DTOs con `class-validator` (`whitelist: true`, `forbidNonWhitelisted: true`). IDs con `ParseUUIDPipe`.
- [ ] PII cifrada en reposo (AES-256-GCM) y tokenizada en respuestas. `?reveal` solo con permiso + audit.
- [ ] Documento buscable/único vía blind index (HMAC). Clave índice ≠ clave cifrado.
- [ ] PII **nunca** en logs, nunca en mensajes de error. Errores genéricos sin enumeración.
- [ ] Toda mutación emite `audit_log` append-only (`who/when/entity/before/after-redactado/ip/userAgent`).
- [ ] `file_hash` SHA-256 sellado al subir adjunto. Adjuntos inmutables (test: PATCH sobre adjunto → 405).
- [ ] Cronograma valida invariante de suma. Montos no negativos. `currency` consistente con tenant.
- [ ] Recálculo de mora idempotente y determinista. Misma fecha → mismo resultado (test).
- [ ] Tests de aislamiento cross-tenant: tenant A nunca ve clientes/créditos de tenant B.
- [ ] PII nunca en claro en respuestas sin `?reveal` (assert en suite de testing).

---

## 6. Plan de Ejecución

> **Cada fase vive en su propio archivo** (en [`F4/`](./F4/)) — fuente ejecutable para implementar y analizar en
> secuencia. Las tablas de abajo son el resumen; el detalle, las decisiones a tomar y la verificación están en cada archivo.

| Fase | Archivo | Foco | Bloqueante |
|------|---------|------|-----------|
| 0 | [F4/00-pre-arranque](./F4/00-pre-arranque.md) ✅ | Clave blind index · `CryptoService`→common · migración PII | 🔴 sí |
| 1 | [F4/01-interceptores](./F4/01-interceptores.md) ✅ | `TenantContextInterceptor` · `AuditInterceptor` · `tokenize` | 🔴 sí |
| 2 | [F4/02-clientes](./F4/02-clientes.md) ✅ | CRUD clientes + sub-recursos + búsqueda (CU-02) | — |
| 3 | [F4/03-creditos](./F4/03-creditos.md) ✅ | CRUD créditos + cronograma + mora + labels | — |
| 4 | [F4/04-tests-cierre](./F4/04-tests-cierre.md) | Pirámide de tests + DoD de seguridad (transversal, desde Fase 2) | — |
| 5 | [F4/05-importacion-clientes](./F4/05-importacion-clientes.md) ✅ (MVP) | Importación masiva (CSV/JSON) + reconciliación diaria (upsert/baja/alta) con permisos | — |

> **Orden crítico:** las historias de Infra/Seguridad (Fase 0 y 1) deben completarse antes de escribir la primera línea de negocio. Sin `TenantContextInterceptor` activo, cualquier test de integración es inválido.

### Fase 0 — Pre-arranque 🔴 (días 1-2)

| # | Tarea | Detalle técnico | Agente |
|---|-------|----------------|--------|
| 0.1 | `APP_BLIND_INDEX_KEY` | Generar 32 bytes hex. Añadir a `.env`, `.env.example`, `ConfigModule` validation. Error claro al boot si ausente. | Security/DevOps |
| 0.2 | Promover `CryptoService` | Mover de `modules/auth` a `common/crypto`. Crear `GlobalModule` o exportar desde `CoreModule`. Añadir `BlindIndexService` (HMAC-SHA256). Actualizar importaciones en `AuthModule`. | Security |
| 0.3 | Migración PII Protection | `add_client_pii_protection`: `national_id`/`tax_id`/`contact.value`/`location.address` → ciphertext. Nueva col `national_id_hash` (HMAC). `@@unique([accountId, nationalIdHash])`. Retirar índice no-único previo sobre `nationalId`. | Database |

### Fase 1 — Interceptores diferidos (días 2-3)

| # | Tarea | Detalle técnico | Agente |
|---|-------|----------------|--------|
| 1.1 | `TenantContextInterceptor` | Extraer `accountId` del JWT. Llamar `prisma.$executeRaw(SET kobrax_app.current_account_id = ...)` antes del handler. Registrar como `APP_INTERCEPTOR` global. Tests: query sin interceptor = denegada por RLS. | Security |
| 1.2 | `AuditInterceptor` | Post-handler para mutaciones. Captura: `userId`, `accountId`, `entity`, `entityId`, `action`, `before`, `after`, `ip`, `userAgent`, `timestamp`. PII redactada en snapshots. Append-only en `audit_logs`. | Security |
| 1.3 | Helpers `tokenize` en Shared | `maskDocument(value)` → `"12345***"` · `maskPhone(value)` → `"777****"` · `maskEmail(value)` → `"usu***@dom***.com"`. Usar en serializers de respuesta. | Shared |

### Fase 2 — Módulo Clientes (días 3-7)

| # | Historia | Criterio de aceptación | Agente | Est. |
|---|----------|----------------------|--------|------|
| H5 | CRUD Clientes + PII + Unicidad | `POST /clients` 201 con PII cifrada. `GET` tokenizado. `PATCH` re-cifra. `DELETE` soft. Duplicado → 409. Test: mismo CI en tenant B → permitido. | API | 2d |
| H6 | Sub-recursos (contactos, ubicaciones, relaciones, adjuntos) | CRUD contactos (cifra `value`). CRUD ubicaciones (GPS + `photo_urls` + cifra `address`). CRUD relaciones (tipos, `is_contactable`). POST adjuntos (sella `file_hash`, inmutable). Audit en toda mutación. | API | 2d |
| H7 | Búsqueda y listado | `GET /clients?q=CI-12345` busca por hash. Filtros `status`/`risk`/`q` funcionan. Paginación correcta. PII tokenizada en todos los resultados. | API | 1d |
| H8d | DTOs Clientes | `CreateClientDto`, `UpdateClientDto`, `ClientResponseDto` + DTOs de sub-recursos. `class-validator`: `whitelist`, `forbidNonWhitelisted`. `ParseUUIDPipe` en todos los `:id`. | Shared | 1d |

### Fase 3 — Módulo Créditos (días 7-12)

| # | Historia | Criterio de aceptación | Agente | Est. |
|---|----------|----------------------|--------|------|
| H9 | CRUD Créditos + Generador Cronograma | `POST /credits` genera `CreditInstallments`. Σ cuotas = principal + interés (±1 centavo redondeo). `outstanding_balance = principal`. `SCHEDULE_INVALID` si no cuadra. Audit emitido. | API | 2d |
| H10 | Servicio de mora | `POST /credits/:id/recalculate-arrears` produce `days_past_due` y `Arrear` esperados en seeds. Parametrizado por `account.configuration`. Idempotente. | API | 2d |
| H11 | Labels de concepto por tenant | `credit_configuration` en `account.configuration`. `GET /credits/:id` retorna campos con labels del tenant. Default si no configurado. | API/Shared | 1d |
| H12d | DTOs Créditos | `CreateCreditDto`, `UpdateCreditDto`, `CreditResponseDto`, `InstallmentDto`, `ArrearDto`. Validaciones: montos positivos, fecha desembolso, `currency` match con tenant. | Shared | 1d |

### Fase 4 — Tests (paralelo/final, días 5-14)

| Tipo | Casos de prueba requeridos | Herramienta | Cobertura |
|------|--------------------------|-------------|-----------|
| **Unit** | Cifrado/descifrado roundtrip. Tokenización (máscara). Blind index determinista. Generador de cronograma: 1 cuota, interés 0, redondeo. Recálculo mora: días gracia, pago parcial, al día. | Jest + mocks Prisma | ≥ 80% |
| **Integración** | `POST /clients` → 201 con PII cifrada en DB. Duplicado bloqueado. `GET` tokenizado. `PATCH` re-cifra. RLS A/B: tenant A no ve datos de tenant B (404). Audit emitido por toda mutación. `?reveal` + permiso → plaintext + audit. Schedule sum invariant. | Supertest + testcontainers + Postgres real | Críticos al 100% |
| **Negativos** | PII en logs (assert ausente). PII en claro en respuesta sin `?reveal` (assert ausente). Documento duplicado → 409, no 500. Cronograma inválido → 400 `SCHEDULE_INVALID`. Cross-tenant → 404 genérico (no 403, no revela existencia). | Jest + supertest | 100% casos |

---

## 7. Definition of Done (DoD) — F4

### 7.1 Funcional
- [ ] CU-02 end-to-end: crear cliente con contactos/ubicaciones/relaciones, buscarlo por documento (hash), editarlo y darlo de baja lógica.
- [ ] Cliente con documento duplicado en el mismo tenant → rechazado (`CLIENT_DUP`). El mismo documento en otro tenant → permitido.
- [ ] Crear crédito genera el cronograma correcto. Σ cuotas cuadra (±1 centavo redondeo). `outstanding_balance = principal` al crear.
- [ ] Recálculo de mora produce `days_past_due` y `Arrear` esperados sobre datos seed conocidos.
- [ ] Labels de concepto del tenant aparecen en respuestas de crédito.

### 7.2 Seguridad y privacidad
- [ ] Datos sensibles **nunca** viajan en claro en la API (verificado por test de negativos).
- [ ] PII nunca aparece en logs de aplicación ni en mensajes de error (assert en tests).
- [ ] Aislamiento: un tenant nunca ve clientes/créditos de otro (test RLS con tenants A y B).
- [ ] Toda mutación emite `audit_log`. Snapshot `before/after` con PII redactada.
- [ ] `file_hash` sellado al subir adjunto. Adjuntos inmutables (test: PATCH sobre adjunto → 405).
- [ ] `?reveal=true` sin permiso → 403. Con permiso → plaintext + `audit_log` inmediato.

### 7.3 Calidad de código
- [ ] `lint` + `type-check` + `test` verdes en CI.
- [ ] Cobertura de servicios `clients`/`credits` ≥ 80%.
- [ ] Todos los endpoints documentados en OpenAPI/Swagger con ejemplos de respuesta tokenizada.
- [ ] No hay secrets hardcodeados. `ConfigModule` valida al boot.

---

## 8. Riesgos y Mitigaciones

| # | Riesgo | Impacto | Mitigación |
|---|--------|---------|-----------|
| R1 | Cifrar documento rompe búsqueda/unicidad | 🔴 Alto | Blind index HMAC (`national_id_hash`) para buscar y deduplicar sin exponer plaintext. Clave índice ≠ clave cifrado. Tests de búsqueda por hash. |
| R2 | Fuga de PII en logs/errores/respuestas | 🔴 Crítico | Tokenización por defecto. `?reveal` auditado. Redacción en `audit_logs`. Asserts en tests negativos que verifican ausencia de PII en claro. |
| R3 | `account_id` ausente en alguna query | 🔴 Crítico | `TenantContextInterceptor` global + revisión de cada endpoint en code review. Test: query sin interceptor → denegada por RLS de Postgres. |
| R4 | Cronograma/mora inconsistentes con pagos futuros | 🟡 Medio | F4 fija estado inicial. El recálculo al cobrar es responsabilidad exclusiva de F7. Frontera explícita en contratos API. |
| R5 | Rotación de claves cifrado/HMAC | 🟡 Medio | Formato `iv.tag.ct` permite re-cifrado campo por campo. Documentar procedimiento de rotación. Claves desde env validado al boot. |
| R6 | Performance con muchos clientes cifrados | 🟢 Bajo-Medio | Blind index con `@@index([accountId, nationalIdHash])` garantiza búsqueda O(log n). Paginación obligatoria en todos los listados. |

---

## 9. Observabilidad y Métricas de Cartera

F4 establece la base de datos operativa que F11 (Dashboard / Analytics) consumirá. Desde F4 deben ser consultables:

- Total de clientes activos por tenant y por sucursal.
- Clientes por segmento de riesgo (distribución).
- Total de créditos activos, en mora y al día por tenant.
- Saldo total de cartera (Σ `outstanding_balance`) por tenant/sucursal.
- `days_past_due` promedio y máximo por segmento.
- Tasa de mora = créditos con `days_past_due > 0` / total créditos activos.
- Audit trail de toda acción de alta/edición/baja de cliente y crédito.

**Logs:** estructurados (JSON), nivel `info`/`warn`/`error`, sin PII, con `requestId`, `accountId`, `userId`, `duration`. Trazas de recálculo de mora: créditos procesados, duración total, errores.

---

*KOBRAX · EPIC F4 — Documento listo para ejecución.*
*Empieza por G1-G5 (bloqueantes) → Fase 0 → Fase 1 → Fase 2 → Fase 3 → Tests.*