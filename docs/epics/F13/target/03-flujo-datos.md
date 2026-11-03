# Objetivo · 03 · Flujo de datos

> **Estado: BORRADOR G2 (2026-11-02).** Evidencia: H-02-03/04/12, H-06-01…10, H-datos-04.

## Pregunta que responde
¿Cómo viajan los datos de oficina a gerencia, y quién decide la oficina de cada registro?

## Regla de oro (A-6, A-8)
**El servidor determina y valida la oficina; nunca se confía en la del cliente.** Ausencia de oficina ≠ ausencia de restricción: un registro sin oficina válida se rechaza (nuevos) o va a excepciones (históricos).

## Oficina de un crédito (hoy: la da el DTO o la corrida, H-02-03)
Orden de resolución al crear/importar:
1. `branchId` explícito → debe estar **activo y dentro del alcance del actor**.
2. Si no viene: oficina primaria del responsable, si tiene exactamente una.
3. Si no: la única oficina de la cuenta (tenant individual, ADR-0004).
4. Si no se puede resolver: **422**, nunca `NULL` en silencio.
Cambio posterior: solo por la acción de reasignación (D-5), auditada.

## Pagos (A-2, A-7)
`payments.branch_id` = oficina del crédito **al momento del pago**, escrita por el servidor, inmutable, con FK. Mover el crédito no la altera. Reportes: oficina histórica (pago) vs oficina actual (crédito) son dos dimensiones.

## Importación (H-06-01…06)
- Hoy la oficina solo se fija si la corrida es de alcance `branch` (`portfolio-credit.ts:109`); con alcance cuenta u oficial queda `NULL`.
- Objetivo: la oficina se **deriva** con la regla de arriba; la columna «Agencia» del archivo (hoy parseada y sin uso, H-06-03) se resuelve por `code` de oficina y se valida contra el alcance; una **re-importación no cambia** la oficina de un crédito existente.
- `assertImportAgency` pasa a usar el servicio de alcance (subárbol, no igualdad).

## Jobs y avisos (H-02-12, H-06-10)
Los trabajos de sistema usan un alcance de sistema **explícito y nombrado**; los avisos al administrador dejan de buscarse por nombre de rol.

## Flujo hacia gerencia
Oficina → su subárbol → ancestros. Los consolidados por nodo salen de agregar por prefijo de `path` (ver 06). Nada se copia a tablas nuevas en F13.

## Migración de datos (D-3, aprobada)
1. Crear tipos y raíz «Principal» por cuenta; colgar las agencias actuales de la raíz.
2. Espejo de `user_accounts.branch_id` → `user_branch_assignments`.
3. Backfill de `credits.branch_id` por capas: responsable → origen de importación/alcance → **única oficina hoja** de la cuenta (tras crear la raíz, «única oficina» ya no existe en cuentas con agencias) → **excepciones** (lista que revisa el administrador). Sin inventar datos.
4. `NOT NULL` y validación A-1 **solo** cuando las excepciones sean 0.
5. FK de pagos tras tratar huérfanos. Cada paso con script `verify/*.sql` (B8) y sin reescribir pagos.

## Impacto por perfil de tenant
| Perfil | Qué cambia | Qué NO debe cambiar | Cómo se comprueba |
|---|---|---|---|
| Gratuito individual | el servidor completa la oficina (raíz) | el formulario de crédito/pago/import no pide nada | R-1, R-7 |
| Equipo | oficina derivada y validada | oficina de sus créditos existentes | R-2, R-6 |
| Grande | reasignación auditada, pagos históricos intactos | atribución de pagos viejos | R-3, R-6, R-7 |

## Entradas HUB que cambiarían
Créditos (alta/edición), pagos, importación, rutas (DTO con `branchId`), jobs.
