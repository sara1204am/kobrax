# Objetivo · 05 · Experiencia móvil

> **Estado: BORRADOR G2 (2026-11-02).** Evidencia: H-mov-01…09, H-06-08. RULES D1: hay una alineación móvil↔web en curso; no se pisa.

## Pregunta que responde
¿Qué cambia en el móvil y cómo se coordina con la alineación en curso?

## Principio
**El servidor impone el alcance; el móvil recibe solo lo que le corresponde.** Por eso F13 P1–P3 **no modifica el móvil**: los contratos existentes no cambian (solo se pueden añadir campos opcionales). Hoy el móvil no conoce la oficina (`Me` no la trae, H-mov-01) y no filtra por ella (H-mov-02); eso se mantiene hasta la fase de seguridad (A-5).

## Riesgos a resolver en la fase móvil (P4)
1. **Hidratación con techo de 150 fichas** (`hydrate.ts:37`, B-M2). Un normalizador asignado a una regional puede superarlo. La fase P4 lee `hydrate.ts` y `data-layer.test.ts` *ese día* y define: priorización (urgentes y de la jornada primero), paginación y mensaje de "datos incompletos". No se asume el comportamiento actual.
2. La hidratación está atada a las pantallas (H-mov-04): cambiar el alcance exige tocar `hydrate.ts`.
3. Offline intacto: la cola es idempotente con id del teléfono y no depende de la oficina (H-06-08).
4. La ficha de mora muestra la oficina del crédito (H-mov-09); con árbol, mostrar la ruta completa.
5. Las 5 pestañas son fijas y el gating por permiso es parcial (H-mov-05): el ajuste por rol es de F14.

## Coordinación
Antes de planear P4: leer el estado real de la alineación (`F10/plans/alineacion-web/README.md`; su cabecera dice 0.8 pendiente y el cuerpo la da por hecha, H-mov-06) y registrar el cruce en el plan. El type-check roto del móvil (`app/cuenta/datos.tsx`) es **preexistente** (D-8) y no se mezcla.

## Impacto por perfil de tenant
| Perfil | Qué cambia | Qué NO debe cambiar | Cómo se comprueba |
|---|---|---|---|
| Gratuito individual | nada | uso offline, cobros, jornada | R-1 + suite móvil (977) |
| Equipo | nada hasta P4 | datos descargados | R-2 |
| Grande | hidratación con alcance regional | que no se pierdan fichas | prueba en dispositivo (P4) |

## Entradas HUB que cambiarían
`hydrate.ts`, `Me`/sesión, ficha de mora, importación móvil (selector de agencia del servidor, H-mov-08) — todas en P4.
