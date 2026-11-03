# F13 · Mapa de impacto

> «Si cambio X, ¿qué reviso?». Se arma desde el HUB. Cada flecha dice **qué clase de evidencia** tiene.
> Hoy solo contiene las relaciones **estructurales** que se leyeron el 2026-10-29. El resto se llena en G1.

## Cadena general (de abajo hacia arriba)
```
DB (HUB-001…005, 010)  →  Shared (006…008, 024)  →  API (009, 011…023)  →  Web (025…030)  →  Móvil (031…034)
```

## Si cambio… reviso
| Cambio | Reviso (HUB) | Evidencia de la relación |
|---|---|---|
| `Branch` (forma, borrado) | 002, 003, 004, 005, 022, 025 | VERIFICADO: relaciones en `schema.prisma:147-150` |
| `UserAccount.branchId` (significado o cardinalidad) | 009, 011, 012, 013, 014, 021, 023, 029 | VERIFICADO en 011 y 012-013 (parcial); resto NO VERIFICADO |
| Cómo se calcula el alcance (`withTenant` / `moraScopeOf`) | 009, 010, 011, 012, 013, 014, 016 | VERIFICADO 009, 011; INFERIDO el resto |
| `ROLE_PERMISSIONS` o `RoleType` | 007, 008, 009, 011, 025 (permisos de pestañas) y toda pantalla que gatea por permiso | VERIFICADO 007-009, 025 |
| `Credit.branchId` (cómo se asigna) | 011, 013, 015, 016, 017, 018, 019, 026, 027 | VERIFICADO el origen (DTO/alcance de import); consumidores NO VERIFICADOS |
| Filtros de analítica por oficina | 016, 028 | VERIFICADO: API acepta `branchId`; dashboard no lo ofrece |
| Contratos de `packages/shared` | 024 + todo consumidor web/móvil | INFERIDO (regla B13) |
| Hidratación offline del móvil | 034 | DESCONOCIDO |

## Pendiente (G1)
- Convertir cada fila en grafo completo: consumidor ↔ proveedor, con `archivo:línea`.
- Marcar los puntos donde una misma regla está **duplicada** (p. ej. alcance de agencia repetido en Mora, Agenda y Asignaciones: VERIFICADO que es lógica separada; si es idéntica, NO VERIFICADO).
