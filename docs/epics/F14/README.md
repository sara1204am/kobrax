# EPIC-F14 · Roles y permisos — **reservado, no iniciado**

> **Estado: RESERVADO.** No tiene arnés propio todavía. Esto es solo el contrato de entrada para que no se pierda lo conversado.
> Se instancia copiando el esqueleto de `../F13/` según `../_framework/README.md` §5, **después de F13/G2** (arquitectura aprobada).

## Qué se sabe (2026-10-29, dicho por la usuaria)
- Es la épica **siguiente** a F13 y trata de **roles**, con foco en la **web, que «ya está lista»**.
- El **móvil quedó desfasado** de la web y debe recibir **oficinas y roles**.
- Los roles de una organización grande (nacional, regional, administrador de agencia, cobrador) no son los 7 roles fijos de hoy; eso lo confirma Discovery.

## Qué la condiciona (pistas, no hechos aprobados)
| Pista | Clase | Fuente |
|---|---|---|
| Los 7 roles son globales y fijos (sin roles por cuenta) | VERIFICADO | `schema.prisma:215-227` |
| El móvil solo asigna ADMIN/SUPERVISOR/COLLECTOR | VERIFICADO | `shared/constants/roles.ts:11` |
| `MANAGER`, `AUDITOR`, `VIEWER` existen pero no se asignan por API; no hay overrides por usuario en código | INFERIDO (docs) | `docs/producto/README.md` |
| Las 5 pestañas móviles no se filtran por permiso | INFERIDO (docs) | `docs/producto/README.md` |
| Hay alineación móvil↔web **en curso** | INFERIDO | `../F10/plans/alineacion-web/README.md` |
| Lo que F3 diferido planteaba de «administración RBAC» | INFERIDO | `../README.md` (fila F3) |

## Dependencias de entrada
1. F13/G2 PASS: `target/01` (modelo organizacional) y `target/02` (roles, permisos y alcance) aprobados.
2. ADR-0002 aprobado (frontera F13/F14).
3. Estado real de la alineación móvil↔web (para no pisarla).

## Reglas heredadas
Las de `../F13/RULES.md` §A y §C aplican: mismo marco, y el **tenant gratuito individual** sigue siendo criterio de cada fase.
