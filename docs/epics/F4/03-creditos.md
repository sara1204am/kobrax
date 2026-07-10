# F4 · Fase 3 — Módulo Créditos (cronograma + mora)

**Parent:** [EPIC-F4 Core Financiero](../EPIC-F4-core-financiero.md) · **Estado:** ✅ Completada (2026-06-18)
**Owner:** API · Shared · **Depende de:** Fase 2 (clientes existen) + Fases 0/1
**Gaps que cierra:** G8 (módulo credits + cronograma) · G9 (servicio de mora) · G12 (labels de concepto por tenant)

## ✅ Estado de ejecución (2026-06-18)
Implementado y verificado (88 tests · type-check · `nest build` · migración · **e2e real**). Módulo en
`apps/api/src/modules/credits/` (`credits.controller/service/serializer`, `credit-math.ts`, `dto/credit.dto`, `credits.errors`, `credits.module`):
- **`credit-math.ts`** (puro, testeado): `buildSchedule` (amortización **FRENCH** cuota constante / **FLAT** capital constante; trabaja en céntimos;
  invariante Σ cuotas = capital + interés con la última cuota absorbiendo el redondeo) + `computeArrears` (mora determinista por `asOf`, días de gracia, excluye pagadas).
- **CRUD créditos** bajo `withTenant(tenantContext.accountId)`: create (genera cronograma + valida invariante → `400 SCHEDULE_INVALID`; `outstanding_balance = principal`),
  list (filtros clientId/status/branchId + paginación), findOne (+installments+arrears+**labels**), update (solo status/manager/branch/code), `GET :id/schedule`, `POST :id/recalculate-arrears`.
- **Mora** (`recalculate-arrears`): parámetros desde `account.configuration.arrears` (dailyMoratoriumRate/penaltyRate/graceDays, con defaults), **snapshot idempotente** (deleteMany+create del `Arrear`), marca cuotas `OVERDUE`, actualiza `days_past_due`.
- **Labels de concepto por tenant** (`account.configuration.creditLabels`, defaults Capital/Tasa/Saldo).
- **Migración** `20260618140000_add_installment_breakdown`: `credit_installments.principal`/`interest` (desglose por cuota, el contrato lo pedía).
- Permiso `credit:write` añadido a MANAGER (shared + seed) para operar cartera.

**Verificación e2e (manager@):** crear crédito (1200 @ 1%/cuota × 12 FRENCH) → moneda = `BOB` (la del tenant; incoherente → `CREDIT_CURRENCY`) →
cronograma 12 cuotas con **invariante exacta** (Σ cuotas 1279.42 = capital 1200 + interés 79.42; cuota#1 = 94.62 capital + 12 interés) →
recalcular mora `asOf` → 137 días, 533.1 en mora, interés 73.03 (**idempotente**: 2ª llamada idéntica) → `audit_logs`: `CREATE`(payload plano JSON-safe) + `ARREARS_RECALC`.

**Bugs cazados y corregidos:** (1) `audit.record` con `after` = objeto Prisma crudo (Decimal) no persistía → se pasa un **resumen plano JSON-safe**;
(2) `accounts` tiene **RLS** → leer la config del tenant **sin** `withTenant` devolvía null (moneda caía a USD) → ahora se lee con contexto.

**Frontera explícita:** el recálculo de `outstanding_balance` al cobrar es **F7** (aquí solo se fija el estado inicial = principal).

> Modela la obligación financiera: genera el **cronograma** de cuotas y calcula la **mora**, con conceptos
> personalizables por empresa. Es la base de los pagos (F7) y los casos (F5).

## Objetivo
CRUD de créditos con generación de cronograma (`credit_installment`) que cumple la invariante de suma, servicio de
recálculo de mora (`days_past_due` + `arrear`) parametrizable por tenant, y etiquetas de concepto configurables.

## Historias
| # | Historia | Criterio de aceptación | Est. |
|---|----------|------------------------|------|
| H9 | CRUD Créditos + generador de cronograma | `POST /credits` genera `CreditInstallment`. **Σ cuotas = principal + interés** (±1 centavo). `outstanding_balance = principal` al crear. `400 SCHEDULE_INVALID` si no cuadra. Audit. | 2d |
| H10 | Servicio de mora | `POST /credits/:id/recalculate-arrears` produce `days_past_due` y `Arrear` esperados en seeds. Parametrizado por `account.configuration`. **Idempotente**. | 2d |
| H11 | Labels de concepto por tenant | `credit_configuration` en `account.configuration`; `GET /credits/:id` retorna campos con labels del tenant; default si no configurado. | 1d |
| H12d | DTOs Créditos | `CreateCreditDto`/`UpdateCreditDto`/`CreditResponseDto`/`InstallmentDto`/`ArrearDto`. Validaciones: montos positivos, fecha desembolso, `currency` = la del tenant. | 1d |

## Contratos (resumen — detalle en master §3.2)
```
POST /credits                         (credit:write) 201 · 400 SCHEDULE_INVALID
GET  /credits   ?clientId&status&branchId&page&limit (credit:read) 200
GET  /credits/:id                     (credit:read) 200 (+ installments + arrears + labels)
PATCH /credits/:id                    (credit:write) 200
GET  /credits/:id/schedule            (credit:read) 200
POST /credits/:id/recalculate-arrears (credit:write) 200 · 422
```

## Diseño concreto
- **Generador de cronograma:** soportar **amortización francesa** (cuota constante) y **flat** (capital constante);
  el tipo viene en `CreateCreditDto`. Redondeo: distribuir el descuadre de centavos en la última cuota; validar
  invariante `|Σ cuotas − (principal + interés)| ≤ 1 centavo` o lanzar `SCHEDULE_INVALID`.
- **`outstanding_balance = principal`** al crear (el recálculo al cobrar es **F7**, frontera explícita).
- **Servicio de mora (`ArrearsService`):** parámetros desde `account.configuration` (tasa moratoria, penalización,
  días de gracia). Recalcula `days_past_due` (a partir de la cuota vencida más antigua) y genera/actualiza `Arrear`
  (interés moratorio + penalización). **Idempotente y determinista**: misma fecha de corte → mismo resultado.
- **Labels (`credit_configuration`):** mapa `{ principal_amount: "capital", interest_rate: "recargo", ... }` por tenant,
  aplicado en el serializer del crédito; defaults si el tenant no lo configuró.

## Análisis / decisiones a tomar
1. **Método de amortización por defecto.** ¿Francesa o flat como default si el DTO no lo especifica? Recomendado: **francesa**
   (lo más común en crédito de consumo). Confirmar y documentar la fórmula exacta.
2. **Origen de la fecha de corte de mora.** ¿`now()` del servidor o un parámetro `asOf`? Recomendado: `asOf` opcional
   (default `now`) → permite recálculos históricos reproducibles y facilita los tests.
3. **`arrear`: histórico vs snapshot.** ¿Una fila por recálculo (histórico) o upsert del estado actual? Recomendado:
   **snapshot upsert por crédito** (estado actual) + el histórico vive en `audit_logs`. Confirmar (afecta a F11).
4. **Edición de crédito (`PATCH`).** Definir qué campos son editables sin recalcular el cronograma (p.ej. `assigned_manager_id`,
   `status`) vs los que lo regenerarían (monto/cuotas/tasa → **no** editables tras desembolso; requieren reestructura → futuro).
5. **Generación de casos.** Cuando un crédito entra en mora, ¿se crea el `collection_case`? Eso es **F5**; F4 solo deja
   `days_past_due`/`arrear` listos. Frontera explícita.

## Checklist de seguridad (de esta fase)
- [ ] `JwtAuthGuard`+`TenantGuard`+`RolesGuard(credit:*)`; `ParseUUIDPipe`; DTOs `whitelist`.
- [ ] Montos no negativos; `currency` consistente con el tenant; cliente del crédito pertenece al mismo tenant.
- [ ] Invariante de cronograma validada server-side (`SCHEDULE_INVALID`).
- [ ] Recálculo de mora idempotente; toda mutación → `audit_log`.

## Criterios de aceptación (DoD Fase 3)
- [ ] Crear crédito genera cronograma con suma correcta (±1 centavo) y `outstanding_balance = principal`.
- [ ] Recálculo de mora produce `days_past_due`/`Arrear` esperados sobre seeds; ejecutarlo dos veces da el mismo resultado.
- [ ] Labels de concepto del tenant visibles en la respuesta; default si no hay configuración.
- [ ] Aislamiento A/B; `lint`+`type-check`+`test` verdes.

## Verificación
```powershell
pnpm --filter @kobrax/api test    # unit (cronograma: 1 cuota / interés 0 / redondeo; mora: gracia/parcial/al día) + integración
# curl: crear crédito → ver schedule cuadrado; recalcular mora dos veces → idéntico
```
