# Discovery · 02 · Backend y API

> **Estado: NO INICIADO** (G1 sin autorizar). Método: `../../_framework/README.md` §2 (clases de evidencia) · hallazgo = plantilla T1.
> Pistas previas relacionadas: ver `00-leads.md`. No cuentan como hallazgos.

## Qué debe responder
- Cada endpoint y servicio que lee o escribe oficina, rol o alcance; permiso que exige cada uno.
- Dónde se calcula el alcance (¿una función o varias copias?) y si son idénticas.
- Qué rol/oficina se asigna al registrarse (tenant individual).
- Qué hace analítica hoy, con qué consultas y sobre qué tablas.
- Jobs y trabajos de sistema que recorren cartera.

## Fuentes a leer (el código manda sobre los documentos)
- `apps/api/src/modules/{mora,agenda,assignments,imports,analytics,credits,clients,payments,routes,users,branches,auth,accounts}`
- `apps/api/src/common/**`, `apps/api/src/database/prisma.service.ts`
- `docs/producto/backend-modulos-y-reglas.md` (contraste)

## Lente de tenant (obligatoria en cada hallazgo)
¿Cómo se comporta esto hoy para: (a) tenant gratuito individual, (b) equipo/agencia pequeña, (c) tenant grande con varias oficinas?

## Hallazgos
_(vacío)_

## Contradicciones y desconocidos
_(vacío)_
