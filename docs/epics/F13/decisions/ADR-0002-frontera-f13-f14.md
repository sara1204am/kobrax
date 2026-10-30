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
— (pendiente de la usuaria; se decide en G2, tras Discovery).

## Consecuencias
Define qué documentos de `target/` son de F13 (01, 03, 06, 07, 08, 09) y cuáles se entregan a F14 (02, 04, 05).
