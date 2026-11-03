# Discovery · 08 · Dependencias e infraestructura

> **Estado: NO INICIADO** (G1 sin autorizar). Método: `../../_framework/README.md` §2 (clases de evidencia) · hallazgo = plantilla T1.
> Pistas previas relacionadas: ver `00-leads.md`. No cuentan como hallazgos.

## Qué debe responder
- Versiones y extensiones de PostgreSQL disponibles, Redis, almacenamiento, hosting actual.
- Límites de plan en código vs. grilla comercial (incluye el tope de sucursales).
- Dependencias externas (mapas, push, correo) que condicionan oficinas o analítica.
- Restricciones operativas (un solo servidor, respaldos, despliegue).

## Fuentes a leer (el código manda sobre los documentos)
- `docker-compose.yml`, `packages/shared/src/constants/plans.ts`, `apps/api/src/common/plan/**`
- `docs/business/LIMITES-*.md`, `docs/producto/demo-datos-y-despliegue.md`

## Lente de tenant (obligatoria en cada hallazgo)
¿Cómo se comporta esto hoy para: (a) tenant gratuito individual, (b) equipo/agencia pequeña, (c) tenant grande con varias oficinas?

## Hallazgos
_(vacío)_

## Contradicciones y desconocidos
_(vacío)_
