# Discovery · 05 · Seguridad y autorización

> **Estado: NO INICIADO** (G1 sin autorizar). Método: `../../_framework/README.md` §2 (clases de evidencia) · hallazgo = plantilla T1.
> Pistas previas relacionadas: ver `00-leads.md`. No cuentan como hallazgos.

## Qué debe responder
- Cómo se resuelve un permiso desde el rol hasta el endpoint (JWT, guards, overrides).
- Qué contiene el token/sesión (¿viaja la oficina?).
- Si `Role.level` o los overrides por usuario se usan.
- Qué impide a un usuario ver otra oficina hoy, capa por capa (UI, API, base).
- Auditoría de cambios de oficina/alcance.

## Fuentes a leer (el código manda sobre los documentos)
- `apps/api/src/modules/auth/**`, `common/guards`, `roles.guard`, `packages/shared/src/constants/permissions.ts`, `enums/permission.enum.ts`
- `packages/database/prisma/rls/**`, `modules/permission-gates.spec.ts`

## Lente de tenant (obligatoria en cada hallazgo)
¿Cómo se comporta esto hoy para: (a) tenant gratuito individual, (b) equipo/agencia pequeña, (c) tenant grande con varias oficinas?

## Hallazgos
_(vacío)_

## Contradicciones y desconocidos
_(vacío)_
