# ADR-0002 · Frontera entre F13 (organización) y F14 (roles)

- Estado: **PROPUESTA**
- Quién decide: la usuaria · Fecha de aprobación: — · Fuente: —

## Contexto
La usuaria indicó (2026-10-29) que la épica siguiente a F13 es la de **roles**, con foco en la web, que «ya está lista», mientras el móvil quedó desfasado y debe recibir oficinas y roles. El alcance de datos de una persona depende de a la vez su oficina (F13) y su rol (F14).

## Problema
¿Dónde termina la organización y dónde empiezan los roles, si el *alcance* («qué oficinas veo») es mitad de cada uno?

## Alternativas consideradas
- A. F13 = árbol de oficinas + motor de alcance; F14 = catálogo de roles, permisos, administración y adaptación completa de web/móvil por rol. Pro: cada una entrega valor propio. Contra: F13 necesita al menos un par de roles de prueba para validarse.
- B. F13 incluye también los roles nuevos mínimos; F14 solo administración y móvil. Pro: F13 se prueba extremo a extremo. Contra: F13 crece.
- C. Una sola épica. Contra: demasiado grande para un contexto controlable.

## Evidencia
- Los roles son globales y fijos (`Role.name @unique`, sin `accountId`; `schema.prisma:215-227`) — VERIFICADO.
- Solo `ACCOUNT_ADMIN`, `SUPERVISOR` y `COLLECTOR` se pueden asignar desde el móvil (`packages/shared/src/constants/roles.ts:11`) — VERIFICADO.
- Documentación de producto dice que `MANAGER`, `AUDITOR` y `VIEWER` existen pero no se asignan por API (`docs/producto/README.md`) — INFERIDO, a contrastar con código.

## Decisión
**REVISADA (Fable, 2026-11-02):** (1) `role_id` de la asignación queda **siempre NULL** en F13, con FK a `roles`; no es espejo de `user_accounts.role_id` (F14 no debe reconciliar datos). (2) Corrección: la vista de oficinas (`target/04`, R7) es de **F13 (P3)**, no de F14; F14 recibe solo la adaptación por rol. (3) F13 deja sí o sí: `OfficeScopeService` que recibe capacidades por interfaz y no lee `role.name`; asignaciones con `revoked_at`, `is_primary` y auditoría; `office:*` en enum, `ROLE_PERMISSIONS` y `permission-gates.spec.ts`; ningún consumidor nuevo con `LIMIT 1`/`findFirst` sobre asignaciones.
**PROPUESTA (sin aprobar): alternativa A.** F13 = árbol de oficinas + asignaciones + servicio único de alcance + permisos `office:*` + tope por plan. F14 = catálogo de roles, delegación y administración de roles por oficina, y la adaptación de web/móvil por rol. F13 guarda `role_id` en la asignación pero **no lo consume** (R8; el rol efectivo sigue siendo `user_accounts.role_id`, JWT sin tocar, A-5). Para validar F13 bastan los 7 roles actuales.

## Consecuencias
Define qué documentos de `target/` son de F13 (01, 03, 06, 07, 08, 09) y cuáles se entregan a F14 (02, 04, 05).
