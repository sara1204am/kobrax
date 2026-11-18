# F15 · Mapa de impacto

> «Si cambio X, ¿qué reviso?». Se arma desde `HUB.md`. Cada fila dice qué clase de evidencia tiene.

## Cadena general
```
Cuenta (H15-001, 002)  →  Shared (003…007)  →  API (008…014)  →  Web (015…024)  →  Móvil (025)
```

## Si cambio… reviso
| Cambio | Reviso (HUB) | Evidencia de la relación |
|---|---|---|
| Forma de `configuration.workspace` (contrato) | 003, 004, 008, 010, 011, 012, 015, 018, 025 | VERIFICADO: `configuration` lo leen `me()` (012) y el merge de `accounts.service` (008) |
| Condición de merge de `configuration` | 008, 001, y la importación de cartera (`portfolio-import.service.ts:1223` la reescribe, C-12) | VERIFICADO en 008; INFERIDO la importación |
| `/auth/me` (`account.workspace`) | 003, 012, 025 (el móvil lo lee), 015, 016 | VERIFICADO: `soloUser` y `preferences` ya viajan por ahí |
| `credit-form.ts` (defaults, `workspaceDefaults`) | 005, 006, 007, 020, 021, **025 (móvil)** | VERIFICADO: `prestamo/nuevo.tsx` usa `buildNewCreditPayload` |
| Qué exige el motor por modalidad | 006, 005, 020, 021 | VERIFICADO en 006 |
| `NAV` / módulos ocultables | 015, 016, 017, 019, 023, 024 | VERIFICADO en 015; enlaces C-8 INFERIDOS hasta releer |
| Pestañas de Cuenta | 018, 024 | VERIFICADO: dos filtros (C-6) |
| Secciones y campos del cliente | 022, 024 | INFERIDO (sin lectores críticos, a verificar en P3) |
| Filtro de destinatarios de Planificar (P-2) | 023 | VERIFICADO: filtra por nombre de rol |
| Snapshot de puertas de autorización | 009, 010, 014 | VERIFICADO: F15 no agrega handlers; si lo hiciera, falla 014 |
| Estado de onboarding de la organización (`configuration.onboarding`) | 001, 008, 012, 026, 029 | VERIFICADO en 008 y 012; INFERIDO 026 |
| Tabla y endpoint de guías por persona | 027, 028, 014 (snapshot de puertas), 002 (patrón de RLS) | VERIFICADO: no existen hoy; el snapshot cambia con aprobación de la usuaria |
| Barra superior / menú (recorrido spotlight) | 015, 017, 030, 031 | VERIFICADO en 015 y 030 |
| Catálogo de guías (`shared`) | 032, 034, 024 (textos es/en), 025 (móvil, solo tipos) | VERIFICADO: no existe hoy |
| Destino tras alta e invitación | 029, 016, 033 | VERIFICADO: `routeByStep` decide |
