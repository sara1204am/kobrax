# Discovery · 01 · Modelo de datos

> **Estado: NO INICIADO** (G1 sin autorizar). Método: `../../_framework/README.md` §2 (clases de evidencia) · hallazgo = plantilla T1.
> Pistas previas relacionadas: ver `00-leads.md`. No cuentan como hallazgos.

## Qué debe responder
- Todas las tablas, columnas, índices y restricciones que mencionan oficina, usuario-cuenta, rol, alcance o plan.
- Cuáles son nulables y por qué; cómo se llena `branch_id` hoy en créditos, pagos y rutas.
- Qué policies RLS existen, en qué tablas y qué alcance leen.
- Qué migraciones tocaron oficinas/alcance y qué hace cada script de `prisma/verify/`.
- Qué datos reales existen hoy (cuentas con y sin oficinas) — solo lectura.

## Fuentes a leer (el código manda sobre los documentos)
- `packages/database/prisma/schema.prisma`, `migrations/`, `rls/`, `verify/`, `seed*.ts`
- `docs/producto/modelo-de-datos.md` (contraste)

## Lente de tenant (obligatoria en cada hallazgo)
¿Cómo se comporta esto hoy para: (a) tenant gratuito individual, (b) equipo/agencia pequeña, (c) tenant grande con varias oficinas?

## Hallazgos
_(vacío)_

## Contradicciones y desconocidos
_(vacío)_
