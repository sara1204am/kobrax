# ADR-0004 · Tenant gratuito/individual frente al árbol

- Estado: **PROPUESTA**
- Quién decide: la usuaria · Fecha de aprobación: — · Fuente: —

## Contexto
Requisito de la usuaria (2026-10-29): el tenant gratuito individual debe trabajar tranquilo aunque el producto se diseñe para el tenant más grande.
Hoy el plan FREE tiene 1 usuario, 20 créditos y 1 sucursal (`docs/business/LIMITES-POR-PLAN.md:141-149`, INFERIDO hasta contrastar con código). `packages/shared/src/constants/plans.ts:12` comenta que no existe un tope `branches` porque «la función no existe» — CONTRADICTORIO con `apps/api/src/modules/branches/` (existe, VERIFICADO).

## Problema
¿Qué ve y qué necesita un tenant que no usa jerarquía? ¿Existe su «raíz» como fila, como concepto implícito o solo bajo ciertos planes?

## Alternativas consideradas
- A. **Raíz implícita**: sin filas nuevas hasta que el tenant crea una oficina; el comportamiento actual es el predeterminado. Pro: cero migración para el individual. Contra: dos caminos de código (con y sin árbol).
- B. **Raíz materializada para todos** (relleno de datos). Pro: un solo camino. Contra: toca a todos los tenants, incluido el que no lo necesita.
- C. **Niveles superiores solo en planes altos** (control por límites de plan). Pro: alineado con el negocio. Contra: requiere definir topes que hoy no existen en código.
- Combinaciones posibles (p. ej. A + C).

## Evidencia
Ver arriba; falta Discovery de cómo se crea el tenant individual (registro) y qué rol/oficina recibe (`alineacion-web/README.md` §1.1 dice «verificar el rol que asigna el registro móvil»: DESCONOCIDO).

## Decisión
— (pendiente).

## Consecuencias
Define el contenido de `target/09-compatibilidad-tenants.md` y la lista de flujos de la regresión del perfil gratuito (RULES C4).
