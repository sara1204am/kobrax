# Discovery · 07 · Tests y calidad

> **Estado: NO INICIADO** (G1 sin autorizar). Método: `../../_framework/README.md` §2 (clases de evidencia) · hallazgo = plantilla T1.
> Pistas previas relacionadas: ver `00-leads.md`. No cuentan como hallazgos.

## Qué debe responder
- Qué specs cubren alcance, oficina, roles y aislamiento entre tenants; cuáles protegen de verdad y cuáles solo existen.
- Qué hay en integración y qué necesita base de datos.
- Qué verificaciones SQL existen y cuáles están cableadas a un script.
- Existencia de CI y de linters reales (hoy son placeholders).

## Fuentes a leer (el código manda sobre los documentos)
- `apps/api/package.json` (script `test`), `apps/api/test/integration/**`, specs de HUB
- `apps/web/**/*.test.tsx`, `apps/mobile/**/*.test.*`, `packages/database/prisma/verify/*.sql`
- carpetas de CI (`.github/`, etc.) si existen

## Lente de tenant (obligatoria en cada hallazgo)
¿Cómo se comporta esto hoy para: (a) tenant gratuito individual, (b) equipo/agencia pequeña, (c) tenant grande con varias oficinas?

## Hallazgos
_(vacío)_

## Contradicciones y desconocidos
_(vacío)_
