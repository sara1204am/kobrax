# Discovery · 03 · Aplicación web

> **Estado: NO INICIADO** (G1 sin autorizar). Método: `../../_framework/README.md` §2 (clases de evidencia) · hallazgo = plantilla T1.
> Pistas previas relacionadas: ver `00-leads.md`. No cuentan como hallazgos.

## Qué debe responder
- Navegación, rutas y qué permiso gobierna cada pantalla.
- Dónde la web muestra, filtra o ignora la oficina (Equipo, Dashboard, Cartera, Mora, Rutas, Pagos, Cuenta, Import).
- Qué ve hoy cada rol; qué ve el tenant individual.
- Cómo viaja el contexto (BFF, cookies, selector de empresa) y dónde podría vivir un selector de oficina.

## Fuentes a leer (el código manda sobre los documentos)
- `apps/web/src/app/(panel)/**`, `src/lib/*`, `src/components/*`, `src/middleware.ts`, `src/app/api/**`
- `docs/producto/web-A…C` (contraste)

## Lente de tenant (obligatoria en cada hallazgo)
¿Cómo se comporta esto hoy para: (a) tenant gratuito individual, (b) equipo/agencia pequeña, (c) tenant grande con varias oficinas?

## Hallazgos
_(vacío)_

## Contradicciones y desconocidos
_(vacío)_
