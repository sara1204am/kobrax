# F4 · Fase 1 — Interceptores transversales (RLS + Auditoría + Tokenización)

**Parent:** [EPIC-F4 Core Financiero](../EPIC-F4-core-financiero.md) · **Estado:** ✅ Completada (2026-06-18)
**Owner:** Security · Shared · **Depende de:** — (se implementó antes que la Fase 0; los interceptores no dependen del cifrado) · **Bloquea:** Fase 2 y 3
**Gaps que cierra:** G4 (`TenantContextInterceptor`) · G5 (`AuditInterceptor`) · G10-parcial (helpers `tokenize`)

## ✅ Estado de ejecución (2026-06-18)
Implementado y verificado (62 tests verdes · type-check · `nest build` · arranque real + login/`/me`):
- **`TenantContextService`** (`common/context/`, AsyncLocalStorage) + **`TenantContextInterceptor`** global (patrón Observable que
  suscribe `next.handle()` dentro de `als.run` para propagar el contexto a través de awaits). Se puebla desde `request.user` del `JwtAuthGuard`;
  request sin auth → pass-through. Módulo `@Global` `TenantContextModule`.
- **`AuditService`** + **`AuditInterceptor`** + decorador **`@Audit(entity)`** + **`redactPII`** (`common/audit/`). Audita mutaciones de
  handlers decorados (CREATE/UPDATE/DELETE), escribe `audit_logs` append-only vía `withTenant(accountId)`, con PII redactada; no audita sin contexto.
- **`tokenize`** en `@kobrax/shared`: `maskDocument`/`maskPhone`/`maskEmail` (+ tests).
- Registro global en `app.module` (TenantContext **antes** que Audit para que el contexto esté activo al auditar).

**Decisión de diseño (importante para Fase 2):** el contexto de tenant se **propaga por ALS** pero **NO** se añadió (aún) una
extensión Prisma que auto-envuelva *toda* query en `withTenant` — eso colisionaría con los `withTenant` explícitos de auth
(transacciones anidadas) y no hay endpoints de recursos todavía para validarlo. **Patrón canónico para Fase 2/3:** los servicios de
recurso inyectan `TenantContextService` + `PrismaService` y ejecutan `this.prisma.withTenant(tenantContext.accountId, (tx) => …)`.
La prueba A/B de RLS end-to-end se hará en la **Fase 2** con el primer endpoint de recurso (clientes).

> **Por qué va antes del negocio:** sin `TenantContextInterceptor` activo, las queries no fijan `account_id` por
> request → el RLS de Postgres no aísla → **cualquier test de integración de F4 sería inválido**. Y sin
> `AuditInterceptor` no se cumple el estándar fintech del DoD.

## Objetivo
Activar los dos interceptores diferidos de F2 (que F4 finalmente habilita por tener endpoints de recursos) y los
helpers de tokenización que usarán los serializers de las Fases 2 y 3.

## Tareas
| # | Tarea | Detalle técnico | Agente |
|---|-------|-----------------|--------|
| 1.1 | **`TenantContextInterceptor`** | Fija el contexto RLS por request con el `accountId` del `@CurrentUser`. Registrar como `APP_INTERCEPTOR` global. Test: una query sin contexto queda **denegada por RLS**. | Security |
| 1.2 | **`AuditInterceptor`** | Para mutaciones (POST/PATCH/DELETE): registra `userId/accountId/entity/entityId/action/before/after(redactado)/ip/userAgent` en `audit_logs` **append-only**. PII redactada en los snapshots. | Security |
| 1.3 | **Helpers `tokenize` (Shared)** | `maskDocument(v)` → `"12345***"` · `maskPhone(v)` → `"777****"` · `maskEmail(v)` → `"usu***@dom***.com"`. Puros, testeables, usados por los serializers de respuesta. | Shared |

## Diseño concreto
**1.1 — Cómo fijar el contexto RLS por request (este es el punto técnico más delicado de F4):**
- El `prisma.withTenant(accountId, cb)` actual envuelve **una transacción**. Para un interceptor request-scoped hay dos vías:
  - **(A) AsyncLocalStorage + Prisma Client Extension (recomendada).** Guardar el `accountId` en un ALS al entrar al request;
    un `$extends({ query })` que, antes de cada operación, ejecute `SET LOCAL app.current_account_id = <als.accountId>`
    dentro de una transacción implícita. Es la "Prisma extension + request-transaction" que se citó como motivo del diferimiento en F2.
  - **(B) Transacción por request.** El interceptor abre `withTenant` y expone el `tx` a los servicios (vía ALS/`nestjs-cls`).
    Más simple de razonar pero acopla todos los servicios al `tx` del request.
- **Decisión a tomar** (ver análisis). Mantener coherencia con los usos actuales de `withTenant` (refresh/sesiones de F2a).

**1.2 — Cómo obtener `before/after` para el audit:**
- Un interceptor HTTP no conoce el estado previo del registro. Opciones:
  - **(A) Prisma Client Extension (recomendada):** en `update`/`delete`, leer la fila previa dentro de la misma operación → `before`;
    el resultado → `after`. Captura automática y consistente a nivel DB.
  - **(B) `AuditService` explícito** invocado por cada servicio mutante (más verboso, pero control fino del snapshot).
- En ambos casos, **redactar PII** (documento/teléfono/dirección) en `before/after` antes de persistir.

## Análisis / decisiones a tomar
1. **Estrategia RLS (A vs B).** Recomendado **(A) ALS + Prisma extension**: menos acoplamiento, funciona para queries sueltas y
   transacciones. Riesgo: las extensiones de Prisma + `SET LOCAL` requieren que cada query corra en una transacción → validar
   performance y compatibilidad con el pool. **Definir aquí** y dejarlo como patrón para F5–F7.
2. **Unificar con `withTenant`.** Hoy auth usa `withTenant` directo. Decidir si se migra a usar el mismo ALS o conviven
   (el interceptor cubre los controllers; `withTenant` sigue para flujos internos como el refresh). No deben pisarse.
3. **Alcance del audit.** ¿Auditar también lecturas con `?reveal=true`? El master lo manda a `data_access_log` (F12), pero
   el reveal de PII debería dejar **al menos** un `audit_log` inmediato en F4 (está en el DoD de seguridad). Confirmar.
4. **Redacción de PII en snapshots.** Definir la lista de campos a redactar por entidad (Client: national_id/tax_id;
   ClientContact: value; ClientLocation: address) — centralizar en un mapa reutilizable.

## Criterios de aceptación (DoD Fase 1)
- [ ] Una query de recurso **sin** contexto de tenant → **denegada por RLS** (test con dos tenants A/B).
- [ ] Toda mutación deja un `audit_logs` append-only con `before/after` y **PII redactada** (test).
- [ ] `maskDocument`/`maskPhone`/`maskEmail` con tests unitarios (incluye casos borde: valor corto, vacío, email sin dominio).
- [ ] Interceptores registrados globalmente; los flujos de auth existentes (refresh/sesiones) siguen verdes.

## Verificación
```powershell
pnpm --filter @kobrax/api test          # incluye specs de interceptores + máscaras
# Integración (testcontainers): cliente del tenant A no aparece para el tenant B; mutación → fila en audit_logs
```
