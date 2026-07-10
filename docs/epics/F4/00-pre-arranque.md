# F4 · Fase 0 — Pre-arranque (Infra de cifrado + migración PII)

**Parent:** [EPIC-F4 Core Financiero](../EPIC-F4-core-financiero.md) · **Estado:** ✅ Completada (2026-06-18)
**Owner:** Security · Database · DevOps · **Depende de:** F2a (`CryptoService` base) · **Bloquea:** Fase 2 y 3
**Gaps que cierra:** G1 (CryptoService→common) · G2 (migración PII) · G3 (`APP_BLIND_INDEX_KEY`)

## ✅ Estado de ejecución (2026-06-18)
Implementado y verificado (67 tests verdes · type-check · `nest build` · `migrate deploy` + seed · arranque real + login):
- **0.1** `APP_BLIND_INDEX_KEY` (32 bytes hex) en `.env` raíz + `.env.example` + `packages/database/.env` (para el seed); validado en
  `env.validation.ts`; getter `blindIndexKey` en `AppConfigService`. **`BlindIndexService.onModuleInit` valida la clave al boot (fail-fast).**
- **0.2** `CryptoService` movido a `common/crypto/` + nuevo **`BlindIndexService`** (HMAC-SHA256, normalización canónica
  `trim→upper→quita [\s.\-/]`) + **`CryptoModule` `@Global`**. `AuthModule` ya no declara CryptoService; MFA sigue verde (login `done`).
- **0.3** Migración `20260618120000_add_client_pii_protection` aplicada (`migrate deploy`): columna `national_id_hash`,
  `@@unique([accountId, nationalIdHash])`, drop del índice no-único previo. Schema actualizado. **Seed siembra/migra la PII cifrada**
  (verificado en DB: `clients.national_id` = ciphertext `iv.tag.ct`, `national_id_hash` poblado, índice único presente).

**Notas:** el seed lee las claves de `process.env` (Prisma Client no auto-carga `.env` → al correrlo manual hay que exportar
`DATABASE_URL`/`APP_ENCRYPTION_KEY`/`APP_BLIND_INDEX_KEY`, o usar `prisma db seed`). El seed es **auto-sanable**: una fila demo
sembrada en claro antes de F4 se migra in situ a cifrada (no duplica). Quedó una fila de cliente cruft en una cuenta de prueba
ficticia (`acc-tena…`) de sesiones previas — ajena a F4.

> **Por qué va primero:** si se escribe el módulo de clientes antes de tener cifrado + blind index, la PII se
> guardaría en claro y la búsqueda por documento se rompería al cifrar después. Esta fase deja la base lista.

## Objetivo
Tener disponible, antes de cualquier código de negocio: (1) la clave de blind index validada al boot,
(2) `CryptoService` + `BlindIndexService` inyectables globalmente, y (3) el schema con la PII cifrada y un índice
ciego único por documento.

## Tareas
| # | Tarea | Detalle técnico | Agente |
|---|-------|-----------------|--------|
| 0.1 | **`APP_BLIND_INDEX_KEY`** | Generar 32 bytes hex (`openssl rand -hex 32`). Añadir a `.env`, `.env.example` y al esquema de validación del `ConfigModule` (zod). **Distinta** de `APP_ENCRYPTION_KEY`. Fail-fast al boot con mensaje claro si falta o no mide 32 bytes. | Security/DevOps |
| 0.2 | **Promover `CryptoService`** | Mover de `modules/auth` a `common/crypto`; crear `CryptoModule` **`@Global()`** que exporte `CryptoService` + nuevo `BlindIndexService`. Actualizar imports en `AuthModule` (MFA sigue usándolo). | Security |
| 0.3 | **Migración `add_client_pii_protection`** | `national_id`/`tax_id` (Client), `value` (ClientContact), `address` (ClientLocation) → almacenan **ciphertext** (`iv.tag.ct`; el tipo sigue `String`). Nueva col `nationalIdHash String?` (HMAC). `@@unique([accountId, nationalIdHash])` + `@@index([accountId, nationalIdHash])`. Retirar el `@@index([accountId, nationalId])` no-único previo. Verificar RLS/GRANTs en las tablas tocadas. | Database |

## Diseño concreto
- **`BlindIndexService.hash(value)`** = `HMAC-SHA256(normalize(value), APP_BLIND_INDEX_KEY)` en hex. **Normalización canónica**
  obligatoria para que `"CI-12345"`, `"ci 12345"` y `"12345"` colisionen igual → `trim → upper → quitar [\s.\-/]`.
  Documentar la normalización (es contractual: cambiarla invalida los hashes existentes).
- **`CryptoService`** se mantiene tal cual (AES-256-GCM, formato `iv.tag.ct`); solo cambia de módulo. No tocar su API.
- **Orden de columnas:** el ciphertext es más largo que el plaintext → confirmar que las columnas son `text`/`varchar` sin
  límite ajustado (Prisma `String` → `text` por defecto en Postgres, OK).

## Análisis / decisiones a tomar (revisar antes de implementar)
1. **Backfill de datos existentes.** El `seed.ts` siembra clientes con documento en claro. Decisión:
   **actualizar el seed** para que cifre `national_id`/`tax_id`/contactos/direcciones y calcule `national_id_hash` al sembrar
   (reusar `CryptoService`/`BlindIndexService` desde un helper). Si hubiera datos reales, haría falta además un script de
   migración de datos que re-cifre lo existente — hoy no aplica (solo seed), pero dejarlo anotado.
2. **¿`national_id_hash` nullable o requerido?** Nullable (`String?`) porque hay clientes sin documento (empresas con
   solo `tax_id`, o personas sin CI registrado). La unicidad sobre nullable en Postgres **no colisiona entre nulls** (OK).
   Decidir si la unicidad debe ser sobre `national_id_hash` **o** sobre un hash combinado documento+tipo.
3. **Rotación de clave** (R5 del master): el formato `iv.tag.ct` permite re-cifrar campo a campo; el blind index, en cambio,
   **requeriría recalcular todos los hashes** si rota `APP_BLIND_INDEX_KEY`. Documentar que esa clave es de larga vida.

## Criterios de aceptación (DoD Fase 0)
- [ ] La app **no arranca** sin `APP_BLIND_INDEX_KEY` (o si no mide 32 bytes) — con mensaje claro.
- [ ] `CryptoService` y `BlindIndexService` se inyectan desde cualquier módulo (smoke test); MFA de `AuthModule` sigue verde.
- [ ] Migración aplica en limpio: las columnas guardan ciphertext, `national_id_hash` poblado, unicidad activa.
- [ ] `pnpm db:seed` corre y **siembra cifrado** (verificable: `SELECT national_id FROM clients` muestra `iv.tag.ct`).
- [ ] `prisma validate` + migración + `type-check` + tests de auth previos: verdes.

## Verificación
```powershell
# clave presente y de 32 bytes
node -e "console.log(Buffer.from(process.env.APP_BLIND_INDEX_KEY,'hex').length)"  # → 32
pnpm --filter @kobrax/database db:migrate ; pnpm --filter @kobrax/database db:seed
# ciphertext en reposo (no plaintext)
psql $env:DATABASE_URL -c "SELECT national_id, national_id_hash FROM clients LIMIT 3;"
pnpm --filter @kobrax/api test   # auth/MFA sigue verde tras mover CryptoService
```
