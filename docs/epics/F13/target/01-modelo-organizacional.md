# Objetivo · 01 · Modelo organizacional

> **Estado: BORRADOR G2 (2026-11-02).** Base: ADR-0003 APROBADA (extender `branches`). Lo marcado «(ADR-0004)» o «(ADR-0002)» depende de una PROPUESTA sin aprobar. Evidencia: `../discovery/` (H-…).

## Pregunta que responde
¿Cómo se representan las oficinas y sus niveles?

## Principios
1. **Una oficina es un nodo de un árbol por cuenta.** Niveles flexibles (R1): el *tipo* de nodo es un catálogo editable, no un nivel fijo (como Gallium, H-gal-02).
2. **Se extiende `branches`**, no se reemplaza (ADR-0003): los `branch_id` de créditos, rutas, pagos y usuarios siguen valiendo (H-datos-01, H-datos-04).
3. **Migraciones solo aditivas** (RULES §E, B8). Toda tabla nueva lleva `account_id` y RLS `tenant_isolation` (B1).
4. **Toda mutación se audita** (B5): crear, renombrar, mover, desactivar, asignar.

## Entidades
| Entidad | Cambio | Campos clave |
|---|---|---|
| `branches` (existe, H-datos-01) | Se extiende | `parent_id` (FK propia, nulo = raíz) · `type_id` → `branch_types` · `path` (ruta materializada de ids, p. ej. `/raíz/regional/agencia/`) · `depth` · `is_active`. Se conservan `code` (único entre vivas, migración `20261021110000`) y `managerUserId` |
| `branch_types` (nueva) | Catálogo por cuenta | `account_id`, `code`, `name`, `sort_order`, `is_active`. Ejemplos: Central, Regional, Agencia. Sin reglas padre/hijo obligatorias en F13 (flexible); reglas por tipo quedan para después |
| `user_branch_assignments` (nueva) | Reemplaza la pertenencia única (H-datos-02) | `account_id`, `user_id`, `branch_id`, `role_id` (nulo; **guardado, no consumido** hasta F14, ADR-0002), `is_primary`, `revoked_at`. Único `(user_id, branch_id)` entre vigentes |
| `user_accounts.branch_id` | **Legado**, se mantiene | Escritura doble durante la transición; se retira en una fase posterior |
| `credits.branch_id` | `NOT NULL` + FK + índice `(account_id, branch_id)` | Solo al cerrar el backfill (A-1, D-3) |
| `payments.branch_id` | FK; **inmutable** | Oficina histórica del pago (A-2, A-7) |

## Correcciones tras revisión independiente (2026-11-02)
- La FK actual de `credits.branch_id` es `ON DELETE SET NULL` (`migrations/20260616022844_init…:799`): para `NOT NULL` hay que **recrearla RESTRICT**. `payments.branch_id` nace con FK RESTRICT. Falta en la tabla de arriba.
- `branches.is_root` (una por cuenta, índice único parcial); índices únicos parciales de `(user_id, branch_id)` vigentes, en SQL (precedente `20261021110000`).
- Crear hija y mover nodo: `SELECT … FOR UPDATE` del padre y del nodo movido en la misma transacción; verify SQL «`path` = `path(padre)` + `id`».
- **Seguridad (P0):** `credits.service.ts:288,463` y `routes.service.ts:306,376` escriben `branchId` del DTO sin comprobar que la oficina sea del tenant; la FK no protege (las comprobaciones de integridad referencial ignoran RLS). La resolución en servidor exige `branch.account_id = tenant` y retira `branchId` del PATCH de crédito (`credit.dto.ts:102,125`) o lo enruta a D-5.
- Mientras convivan `user_accounts.branch_id` y las asignaciones, **solo una asignación por usuario** hasta migrar todos los consumidores (`mora-query.ts:138-140`, `assignment.service.ts:161-165`, `agenda.service.ts:177-181` usan `LIMIT 1`/`findFirst`).

## Reglas del árbol
- Mismo `account_id` en padre e hijo; **sin ciclos**: al mover, el nuevo padre no puede estar dentro del subárbol del nodo.
- Profundidad máxima configurable con tope de seguridad (propuesta: 8) para acotar consultas; no es un tope de negocio.
- **Consulta de subárbol** = prefijo de `path` con índice `text_pattern_ops` `(account_id, path)`; sin `ltree` (H-08-02). Mover un nodo reescribe el `path` de su subárbol en **una transacción**.
- **Baja** (desactivar, no borrar): bloqueada si tiene hijas activas, créditos o usuarios vigentes; primero se mueven (reglas de Gallium H-gal-06; hoy sin tratamiento de huérfanos, H-datos-11).
- **Ruta completa** (R10): se calcula en la API desde los ids de `path` (una consulta), p. ej. `Central › Chuquisaca › Central`. No se denormaliza; así renombrar no deja rutas viejas.
- **Crédito en un nodo cualquiera activo** (en tenants de un solo nivel, la raíz). Si se exigiera nodo hoja queda como decisión D-11.

## Caso de referencia R10
```
Central
├── Regional La Paz
├── Regional Cochabamba
└── Regional Chuquisaca
    ├── Mesa Verde · Central · Luz y Verdad  (Sucre)
    └── Padilla · Monteagudo · Camargo       (provincia)
```
«Sucre/provincia» es descripción, no nivel (supuesto, DECISIONS R10).

## Impacto por perfil de tenant
| Perfil | Qué cambia | Qué NO debe cambiar | Cómo se comprueba |
|---|---|---|---|
| Gratuito individual | Recibe raíz «Principal» invisible (ADR-0004) | Ninguna pantalla ni flujo | R-1 |
| Equipo / agencia pequeña | Sus agencias planas pasan a hijas de una raíz; asignaciones espejo de `user_accounts.branch_id` | Quién ve qué | R-2, R-8 |
| Grande | Árbol con tipos y varias asignaciones | — | R-3 |

## Entradas HUB que cambiarían
Esquema de oficina/usuario-cuenta, créditos, pagos, rutas, seeds y `verify/` (B-D1…B-D7). Las filas HUB siguen `SEMBRADO`; se verifican al planear P1 (A4).
