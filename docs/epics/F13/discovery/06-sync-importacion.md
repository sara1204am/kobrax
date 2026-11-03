# Discovery · 06 · Sincronización e importación

> **Estado: NO INICIADO** (G1 sin autorizar). Método: `../../_framework/README.md` §2 (clases de evidencia) · hallazgo = plantilla T1.
> Pistas previas relacionadas: ver `00-leads.md`. No cuentan como hallazgos.

## Qué debe responder
- Cómo entra la cartera hoy (archivo) y qué define a qué oficina y responsable queda cada crédito.
- Qué modelos soportan datos externos (snapshots, claves externas, vínculos de asesor) y cómo funciona PRESENT/ABSENT.
- Qué existe para ingesta por API (nada, parcial, completo).
- Cómo sincroniza el móvil (cola, ids, idempotencia) y qué pasa con datos de oficina.

## Fuentes a leer (el código manda sobre los documentos)
- `apps/api/src/modules/imports/**`, `schema.prisma` (CreditExternalSnapshot, ClientExternalKey, ExternalAdvisorLink, enums de origen/sync)
- `apps/mobile/src/sync/**`, `docs/epics/F10/plans/P6-offline-sync.md`

## Lente de tenant (obligatoria en cada hallazgo)
¿Cómo se comporta esto hoy para: (a) tenant gratuito individual, (b) equipo/agencia pequeña, (c) tenant grande con varias oficinas?

## Hallazgos
_(vacío)_

## Contradicciones y desconocidos
_(vacío)_
