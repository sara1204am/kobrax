# ADR-0004 · Tenant gratuito/individual frente al árbol

- Estado: **APROBADA con las revisiones de la sección Decisión** (alternativa B)
- Quién decide: la usuaria · Fecha de aprobación: 2026-11-02 · Fuente: respuestas a la revisión Fable: «1. sí · 2. sí, cuenta · 3. hay que mover cartera · 5. sí». Resumen: la raíz con la razón social de la cuenta se acepta visible como etiqueta en móvil/exportes; **la raíz cuenta en el tope del plan**; al pasar a Equipo, **la cartera de la raíz se mueve** a las nuevas oficinas (exige reasignación, D-5).

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
**REVISADA tras revisión independiente (Fable, 2026-11-02; releído en código por la IA).** Cambios sobre la propuesta de abajo:
1. «Oculta» = **sin pantallas de jerarquía en la web**. La raíz **sí se ve como etiqueta** en el móvil (ficha de mora «Agencia: …», `mora.serializer.ts:158-159` + `app/mora/[creditId].tsx:242`), en el selector de importación móvil (`portfolio-import.service.ts:1039-1043`) y en exportes. Sin tocar el móvil no se puede ocultar. Se acepta y la raíz se nombra con la **razón social** de la cuenta, no «Principal».
2. Columna explícita `is_root`: una por cuenta (índice único parcial), no se mueve ni se desactiva.
3. Hay que decir si la raíz cuenta en el tope del plan (FREE=1 ⇒ cero agencias creables). Añadir `branches` a `LIMIT_KEYS` (`plans.ts:181-206`, `plan-tools.service.ts:158`) es parte del cambio.
4. La raíz se crea en la misma transacción del alta de cuenta (`accounts.service.ts:113-115`) y en cualquier otro alta.
5. Individual→Equipo: la raíz con cartera histórica pasa a nodo mixto; mover esa cartera exige D-5 (reasignación), aún sin aprobar.
**PROPUESTA (sin aprobar): alternativa B.** La restricción A-1 («todo crédito tiene una oficina válida») hace imposible una raíz solo implícita: debe existir una fila. Cada cuenta recibe una oficina raíz «Principal» (migración + creación al registrarse). Mientras la cuenta tenga **una sola oficina**, la web no muestra jerarquía, selectores ni columnas de oficina, y el servidor la asigna solo (el cliente no envía nada, A-6). El tope por plan limita cuántas oficinas se crean (FREE 1). Sustituye a la suposición anterior de «oficina implícita». Costo: toca a todos los tenants, de forma aditiva e invisible; lo cubre la regresión R-1.

## Consecuencias
Define el contenido de `target/09-compatibilidad-tenants.md` y la lista de flujos de la regresión del perfil gratuito (RULES C4).
