# F15 · RULES

Heredan íntegras `../F13/RULES.md` §A (proceso), §B (guardrails de producto), §C (tenant gratuito individual) y §D (coordinación móvil), y `../F14/RULES.md` (F14-B: reglas de trabajo). Este archivo solo añade lo propio de F15.

## F15-A · Decisiones que son reglas (aprobadas por la usuaria, 2026-11-06 y 2026-11-13; ver `PLAN-MVP-configurable-workspace.md` §14)
- **D-1** Solo UI en v1: la API **no consulta** el workspace para aceptar o rechazar operaciones (R2).
- **D-3** «Beneficiario» queda fuera de la v1.
- **D-5** Mora y los troncales (Cartera, Mora, Pagos, Agenda, Inicio, Cuenta, Perfil) no se apagan.
- **D-6** El workspace es por organización; variantes por rol u oficina, después.
- **D-7** Sin bloqueo comercial por módulo (gancho `planGate` vacío).
- **D-8** Seguridad del acceso (`/seguridad`) es troncal.
- **D-9** Actividad (`/actividad`) se oculta solo en pantalla y solo con un único miembro activo (S-7).
- **O-5** Ola 1a como en el plan §4; todo lo demás, a 1b.
- **R1–R9** (plan §5): solo quita; la API no lo consulta; nunca se borra un dato; no va en el JWT; ausente = Completo; todo `fixed` lleva default válido; un valor guardado oculto sigue visible; `requires` entre opciones; ninguna opción actúa sobre catálogos.

## F15-B · Reglas de trabajo
- Rama por fase: `f15/p<N>-<nombre>`, desde `dev`. Commits locales; push/PR solo si la usuaria lo pide.
- Sin PASS de G4 (plan validado) no se modifica código de producto.
- El motor Workspace (P1–P4) **no lleva migración**. La única excepción es la tabla de estado de guías de la fase P6 (D-13), **aditiva** y reversible, que debe pasar su propio G4.
- En P1–P4 no se tocan `common/authz/*`, `rls/*`, `schema.prisma` ni el JWT, y el snapshot de puertas no debe cambiar (A-11). En P6 (D-13) sí se toca `schema.prisma` y `rls/*` para la tabla de guías, y el snapshot cambia **solo con la aprobación de la usuaria**; el JWT y `common/authz/*` no se tocan en ninguna fase.
- Los cambios en `packages/shared` son **aditivos** y el cierre de la fase corre `tsc` del móvil (cruce D1, plan §6).
- Todo spec nuevo de la API se registra en el script `test` de `apps/api/package.json` (B12).
