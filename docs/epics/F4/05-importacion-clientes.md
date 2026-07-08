# F4 · Fase 5 — Importación masiva y reconciliación de clientes

**Parent:** [EPIC-F4 Core Financiero](../EPIC-F4-core-financiero.md) · **Estado:** ✅ Completada (MVP, 2026-06-18)
**Owner:** API · Security · Database · Shared · **Depende de:** Fase 2 (módulo clientes) + Fase 0 (cifrado/blind index) + Fase 1 (audit/RLS)
**Gaps que cierra:** importación multi-formato + **sincronización delta** (el "archivo oficial del día") con permisos y auditoría.

## ✅ Estado de ejecución (MVP, 2026-06-18)
Implementado y verificado (102 tests · type-check · `nest build` · migración con RLS · **e2e real**). Módulo en
`apps/api/src/modules/clients/import/` (`client-import.controller/service`, `import-plan.ts`, `csv.ts`, `import.dto.ts`):
- **`import-plan.ts`** (motor de reconciliación puro, testeado): empareja por `national_id_hash`; modos **RECONCILE** (actualiza/da de baja/crea),
  **UPSERT_ONLY** (sin bajas), **REPLACE** (destructivo, permiso elevado). **Regla fintech innegociable**: ausente con obligaciones activas → `needsReview` (no se da de baja).
- **`csv.ts`**: parser CSV propio (comillas, comas y saltos dentro de comillas, escapes) sin dependencias. JSON también soportado.
- **`POST /clients/imports`**: `{ source: csv|json, mode, dryRun?, mapping?, content|rows }`. PII cifrada al crear/actualizar (CryptoService + blind index).
  **Idempotente por `file_hash`** (mismo archivo → no-op). Persiste `ClientImportRun` (counts) + audita `IMPORT`. `dryRun` devuelve el plan **sin escribir**.
- **Permisos** nuevos: `client:import` (RECONCILE/UPSERT_ONLY) + `client:import:replace` (REPLACE) — añadidos al enum/roles/seed (ACCOUNT_ADMIN+MANAGER importan; REPLACE solo admin).
- **Migración** `20260618160000_add_client_import_runs` (tabla + RLS por tenant, mismo patrón `app_current_account()`).

**Verificación e2e (manager@):** UPSERT_ONLY de 2 clientes nuevos → `created=2` (sin bajas) → re-subir el mismo → `idempotentSkip` (1 sola corrida persistida) →
**dryRun RECONCILE** (solo IMP-001) → `updated=1, softDeleted=1, needsReview=2` (los de crédito activo **NO** se borran) **sin escribir** (DEMO sigue con 4 clientes) →
REPLACE sin permiso → `403 INSUFFICIENT_PERMISSION` → búsqueda por blind index tokenizada → `audit_logs` IMPORT (solo la real).

## Alcance del MVP vs. el diseño completo (abajo)
**En el MVP:** CSV + JSON inline en el body; procesamiento **síncrono** con `dryRun`; idempotencia por hash; reconciliación con protección; permisos; auditoría.
**Diferido (documentado abajo):** XLSX/PDF (necesitan libs/OCR), subida **multipart + storage S3/R2** con `file_url`, flujo **asíncrono en 3 pasos** (upload→plan→apply) con cola Redis para archivos grandes,
plantillas de mapeo guardadas, reporte de errores descargable, importación de **créditos**. El núcleo (motor de reconciliación) ya está y es reutilizable.

> **Por qué fase aparte:** parseo multi-formato, mapeo de columnas, validación por fila, **estrategia de
> reconciliación** (qué se actualiza / se da de baja / se crea), procesamiento asíncrono y **protección financiera**
> de los borrados son un dominio en sí mismo. Meterlo en `02-clientes` lo volvería inmanejable.

## Objetivo
Permitir cargar un padrón de clientes desde un archivo (CSV/JSON/XLSX; PDF con salvedades) y **reconciliarlo** contra
la cartera del tenant de forma segura, auditable e idempotente — pensado para el caso "**cada día se sube el archivo
oficial**": los que siguen se actualizan, los que ya no están se dan de baja (soft) y los nuevos se crean.

## 1. Formatos soportados
| Formato | Soporte | Notas |
|---------|---------|-------|
| **CSV** | ✅ Primario | Delimitador y encoding configurables; cabecera obligatoria; streaming para archivos grandes. |
| **JSON** | ✅ | Array de objetos; mismo mapeo lógico que CSV. |
| **XLSX (Excel)** | ✅ | Requiere lib (`exceljs`/`xlsx`); leer **solo la primera hoja** o la indicada; tratar fórmulas como su valor. |
| **PDF** | 🟡 **Limitado / a decidir** | Solo PDF **tabular estructurado** (tablas reales) vía extractor; PDF escaneado/arbitrario necesita **OCR** y es poco fiable. **Recomendación: NO incluir PDF en el MVP de esta fase** (alta complejidad/baja fiabilidad); habilitarlo después con plantilla fija u OCR dedicado. |

> **Mapeo de columnas:** distintas organizaciones traen cabeceras distintas (`CI`, `documento`, `nro_doc`…). Se necesita
> un **mapa columna→campo** (p.ej. `{ "CI": "national_id", "Nombre": "first_name", "Cel": "contact.phone" }`),
> enviado en la petición o guardado como **plantilla reutilizable por tenant/origen**.

## 2. Modos de importación (estrategia de reconciliación)
Clave de emparejamiento = **`national_id_hash`** (blind index de la Fase 0), por tenant.

| Modo | Existentes (match) | Ausentes (en DB, no en archivo) | Nuevos (en archivo, no en DB) | Uso |
|------|--------------------|--------------------------------|-------------------------------|-----|
| **`RECONCILE`** (recomendado, "archivo oficial del día") | **Actualiza** | **Baja lógica** (soft delete / `INACTIVE`) — **protegido** (ver §3) | **Crea** | Padrón diario que reemplaza la fotografía anterior pero conserva historia/relaciones. |
| **`UPSERT_ONLY`** (más seguro) | Actualiza | **No toca** | Crea | Cargas incrementales sin riesgo de baja accidental. |
| **`REPLACE`** (peligroso) | Recrea | Soft delete masivo | Crea | Solo si el archivo es la **única** fuente de verdad y no hay créditos/casos atados. |

> Por defecto se ejecuta en **`RECONCILE`** y siempre con **dry-run/preview** previo. `REPLACE` exige confirmación
> explícita y permiso elevado.

## 3. Seguridad de los borrados (regla fintech — innegociable)
Un cliente "ausente en el archivo de hoy" **NO** se elimina sin red de seguridad:
- **Nunca** hard delete. Solo `status = INACTIVE` + `deleted_at` (soft), reversible.
- Si el cliente tiene **créditos activos o casos abiertos** → **no se da de baja**: se marca para **revisión**
  (`skipped: needs_review`) y se reporta. La deuda viva no desaparece por no venir en un CSV.
- El borrado por reconciliación se **audita fila por fila** y es **reversible** (restore desde la baja lógica).

## 4. Flujo (asíncrono, con preview)
```
1. POST /clients/imports          → sube archivo (multipart) → guarda blob + file_hash; crea ImportRun (status=UPLOADED)
2. POST /clients/imports/:id/plan → parsea + aplica mapeo + valida por fila → status=PLANNED
                                     devuelve PREVIEW: {toCreate, toUpdate, toSoftDelete, needsReview, invalidRows[]}
3. POST /clients/imports/:id/apply{mode,confirm} (dry-run? real?) → procesa en background (cola)
                                     → status=RUNNING → DONE; counts finales + reporte de errores descargable
GET  /clients/imports/:id         → estado + métricas (created/updated/deleted/skipped/errors)
GET  /clients/imports/:id/errors  → CSV/JSON de filas inválidas (motivo por fila)
```
- **Validación por fila** (documento presente, formato, duplicados dentro del propio archivo, etc.); las filas inválidas
  **no abortan** el lote: se reportan y el resto continúa (configurable: `strict` = todo-o-nada).
- **Cifrado al vuelo**: documentos/teléfonos/direcciones se cifran y se calcula `national_id_hash` al persistir (Fase 0).
- **Idempotencia**: re-aplicar el **mismo `file_hash`** no duplica (match por hash de archivo + por documento).

## 5. Modelo de datos (nuevo — migración `add_client_imports`)
```prisma
model ClientImportRun {
  id          String   @id @default(uuid())
  accountId   String   @map("account_id")
  source      String                       // csv | json | xlsx | pdf
  fileUrl     String   @map("file_url")
  fileHash    String   @map("file_hash")    // SHA-256 del archivo (idempotencia + traza)
  mode        String                        // RECONCILE | UPSERT_ONLY | REPLACE
  mapping     Json                          // mapa columna→campo (o ref a plantilla)
  status      String   @default("UPLOADED") // UPLOADED|PLANNED|RUNNING|DONE|FAILED
  created     Int      @default(0)
  updated     Int      @default(0)
  softDeleted Int      @default(0) @map("soft_deleted")
  skipped     Int      @default(0)
  errors      Int      @default(0)
  createdBy   String?  @map("created_by")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  @@index([accountId, status])
  @@map("client_import_runs")
}
```
> Opcional: `ClientImportRowError(runId, rowNumber, reason, rawRedacted)` para el reporte. El archivo se guarda en
> object storage (S3/R2) como cualquier evidencia; el `file_hash` sella la traza.

## 6. Permisos
- `client:import` (subir + planificar + aplicar en `RECONCILE`/`UPSERT_ONLY`).
- `client:import:replace` (o gate por nivel de rol) para el modo **destructivo** `REPLACE` y para confirmar bajas masivas.
> Como la administración RBAC (F3) está diferida, se añaden **solo estos permisos** al enum + seed (cambio mínimo,
> coherente con la decisión abierta de la Fase 2 sobre `*:pii:read`). **No** abre el módulo de administración de roles.

## 7. Análisis / decisiones a tomar (revisar antes de implementar)
1. **¿PDF dentro o fuera del MVP?** Recomendado **fuera** (CSV/JSON/XLSX primero); PDF tabular/OCR como fase posterior.
   ¿Hay un formato de PDF concreto y fijo del cliente que justifique una plantilla? → si sí, se acota a esa plantilla.
2. **Modo por defecto:** ¿`RECONCILE` (actualiza/da de baja/crea, con protección) o `UPSERT_ONLY` (sin bajas)?
   Recomendado **`RECONCILE` con protección** por tu descripción del "archivo oficial diario".
3. **Bajas con deuda viva:** confirmar la regla — **no dar de baja** clientes con créditos/casos activos (marcar `needs_review`). (Recomendado.)
4. **Sync vs async:** archivos grandes → **cola en background** (BullMQ/Redis, que ya está) + estados. ¿Umbral para procesar inline vs background?
5. **Plantillas de mapeo:** ¿guardar el mapa columna→campo por tenant/origen (reutilizable) o enviarlo en cada importación?
   Recomendado: **plantilla guardada** + override por corrida.
6. **¿Importar también créditos?** Tu pedido es de **clientes**. Los créditos/saldos suelen venir en el mismo archivo oficial →
   evaluar una fase hermana (importación de créditos) o extender el mapeo. **Decisión:** fuera de esta fase; anotado.
7. **Conflictos dentro del archivo:** documento repetido en el mismo CSV → regla (primero gana / última gana / error de fila). Definir.
8. **Reversibilidad:** ¿endpoint para **revertir** una corrida (restaurar bajas y deshacer updates)? Recomendado al menos restaurar las bajas lógicas de esa corrida.

## 8. Checklist de seguridad (de esta fase)
- [ ] `JwtAuthGuard`+`TenantGuard`+`RolesGuard(client:import[:replace])`; archivo validado (tipo/tamaño/MIME).
- [ ] Cada corrida y **cada fila mutada** → `audit_log` (con PII redactada). `file_hash` sella el archivo.
- [ ] Bajas solo soft y **protegidas** ante deuda viva; reversibles.
- [ ] PII cifrada al persistir; el reporte de errores **no** expone documentos en claro.
- [ ] Idempotencia por `file_hash`; `REPLACE` requiere permiso elevado + confirmación explícita.
- [ ] Aislamiento por tenant (un archivo nunca toca clientes de otro tenant).

## 9. Criterios de aceptación (DoD Fase 5)
- [ ] Importar un CSV oficial en `RECONCILE`: existentes **actualizados**, ausentes **dados de baja (soft)**, nuevos **creados** — con counts correctos.
- [ ] Un cliente ausente **con crédito activo** NO se da de baja: queda `needs_review` y se reporta.
- [ ] Re-aplicar el **mismo archivo** no produce cambios (idempotente).
- [ ] Filas inválidas se reportan sin abortar el lote (modo no-strict); el reporte no filtra PII.
- [ ] XLSX y JSON producen el mismo resultado que el CSV equivalente.
- [ ] `REPLACE` exige permiso elevado + confirmación; toda la corrida queda auditada.
- [ ] Aislamiento A/B; `lint`+`type-check`+`test` verdes; cobertura del servicio de importación ≥ 80%.

## 10. Verificación
```powershell
pnpm --filter @kobrax/api test    # unit (parser/ mapeo/ reconciliación: create/update/softdelete/needs_review/idempotencia)
# e2e: subir CSV → plan (preview) → apply RECONCILE → ver counts; re-subir mismo archivo → 0 cambios;
#      cliente con crédito activo ausente → needs_review (no baja)
```
