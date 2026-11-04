# Objetivo · 02 · Roles, permisos y alcance

> **Estado: BORRADOR G2 (2026-11-02).** Separa **rol** (qué puede hacer), **permiso** y **alcance** (sobre qué oficinas) — A-3. El catálogo de roles es de F14 (ADR-0002, PROPUESTA). Evidencia: H-02-01…02, H-05-01…10.

## Pregunta que responde
¿Quién ve y hace qué, según su rol y su oficina?

## Modelo
```
Permiso efectivo = permisos del rol (hoy user_accounts.role_id) ∩ alcance de oficinas (asignaciones vigentes + subárbol)
Rol         → qué acciones         (F14 lo amplía; F13 no lo toca; JWT sin cambios, A-5)
Alcance     → qué oficinas         (F13: user_branch_assignments)
Plan        → cuántas oficinas     (F13: tope por plan)
```

## Servicio único de alcance (`OfficeScopeService`)
Sustituye las 4 implementaciones actuales (H-02-01: `mora-query.ts:127-152`, `prisma.service.ts:93`, `assignment.service.ts:159`, `agenda.service.ts:175`).
- Entrada: contexto del tenant (cuenta, usuario, capacidades). Salida: `OfficeScope { kind: ALL | OFFICES | OWN, branchIds[] expandidos, userId }`.
- `kind` por **capacidad**, no por nombre de rol (C5): `data:scope:all` → ALL · `data:scope:branch` → OFFICES · ninguna → OWN (falla cerrado, B2).
- OFFICES = unión de los subárboles de las asignaciones vigentes del usuario. **Sin asignaciones ⇒ se comporta como OWN** (A-4: un supervisor sin oficina no obtiene acceso total); `ACCOUNT_ADMIN` conserva ALL por su capacidad.
- Entrega dos formas: fragmento SQL (`officeScopeSql(scope, alias)`) y condición Prisma, para que las consultas crudas y las de Prisma usen la misma lógica.
- **Política explícita `requireResponsible`:** hoy la *visibilidad* exige responsable y `branch_id` no nulo, y el *reparto* no (H-02-02). Se conservan ambas como política nombrada del mismo servicio para que unificar **no cambie comportamiento** (R-8). Cambiarlas es una decisión aparte.
- El servidor determina el alcance en cada petición desde la base; **no viaja en el JWT** (A-5; hoy `user_accounts.branch_id` ya se relee por petición, H-02-11).

## Permisos nuevos (R12)
| Permiso | Para qué | Quién lo trae al migrar (derivado de lo que hoy ya tienen, sin equivalencias por suposición) |
|---|---|---|
| `office:read` | ver árbol, detalle, miembros | roles con `user:read` hoy |
| `office:write` | crear/mover/desactivar oficinas, tipos, asignar usuarios | roles con `account:write` hoy (`ACCOUNT_ADMIN`; hoy también `SUPER_ADMIN`) |

La pestaña y los botones de Agencias pasan a usar `office:*` (hoy leen `user:read` y `account:write`, H-web-02). La API valida siempre; la UI solo oculta (B4).

## Plan
`plans.ts` gana `maxBranches` (FREE 1 · PROFESSIONAL 3 · BUSINESS 10 según `LIMITES-POR-PLAN.md:149`; ENTERPRISE a definir). Se valida al **crear**. Hoy no existe (H-08-03). Valor comercial pendiente de confirmar por la usuaria.

## Plataforma (R11)
`SUPER_ADMIN` sale de los roles de tenant hacia una capa de plataforma con auditoría y MFA propios, sin bypass de aislamiento. **Fase aparte** con plan de migración (hoy es un valor de enum sin uso operativo, V1). No bloquea P1–P2. Antes de tocarlo: revisar `mfa-policy.ts:13`, seeds, specs y migraciones que lo nombran.

## Reasignación de créditos entre oficinas (D-5, por aprobar)
Con `assignment:write` y alcance sobre origen **y** destino; auditada; los pagos previos no cambian (A-2). Reportes con dos dimensiones: oficina histórica del pago / oficina actual del crédito (D-6).

## Pendiente antes de migrar roles por asignación (A-3)
Revisar notificaciones y jobs que buscan al admin por `role.name='ACCOUNT_ADMIN'`, invitaciones y la restricción `isMobileRole` (`users.service.ts:146`, H-05-05).

## Impacto por perfil de tenant
| Perfil | Qué cambia | Qué NO debe cambiar | Cómo se comprueba |
|---|---|---|---|
| Gratuito individual | nada visible; el admin sigue con ALL | accesos | R-1 |
| Equipo | permisos `office:*` equivalentes a los de hoy | quién ve/edita agencias | R-2 |
| Grande | alcance por subárbol y varias asignaciones | aislamiento entre tenants | R-3, R-4, R-5 |

## Entradas HUB que cambiarían
HUB-009…016 (consumidores del alcance), guards/permisos (`permissions.ts`), plan (`plans.ts`).
