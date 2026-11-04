# F13 · Arquitectura objetivo

> **Estado: BORRADOR G2 (2026-11-02).** G1 confirmado por la usuaria. Los 9 documentos están escritos; G2 sigue abierto hasta aprobar ADR-0002 y ADR-0004 y revisar la arquitectura.
> ADR-0003 está APROBADA; lo que depende de ADR-0002/0004 está marcado como PROPUESTA en cada documento.

## Reglas
1. Cada decisión de diseño referencia un ADR **APROBADO** (`../decisions/DECISIONS.md`). Una propuesta no basta.
2. Cada afirmación sobre «cómo es hoy» referencia un hallazgo H-… de `../discovery/`.
3. Cada documento termina con **Impacto por perfil de tenant**: gratuito individual · equipo · grande (RULES §C).
4. Cada documento lista las entradas HUB que cambiarían.
5. Reparto F13/F14 de los documentos: lo decide ADR-0002 (propuesta hoy: 01, 03, 06, 07, 08, 09 en F13; 02, 04, 05 se entregan a F14).

## Documentos
| # | Archivo | Pregunta que responde | Depende de |
|---|---|---|---|
| 01 | [modelo-organizacional](./01-modelo-organizacional.md) | ¿Cómo se representan las oficinas y sus niveles? | ADR-0003; discovery 01 |
| 02 | [roles-permisos-alcance](./02-roles-permisos-alcance.md) | ¿Quién ve y hace qué, según su rol y su oficina? | ADR-0002; discovery 05 |
| 03 | [flujo-datos](./03-flujo-datos.md) | ¿Cómo viajan los datos de oficina a gerencia? | discovery 02, 06 |
| 04 | [experiencia-web](./04-experiencia-web.md) | ¿Cómo entra un usuario por oficina y cómo cambia cada módulo web? | discovery 03 |
| 05 | [experiencia-movil](./05-experiencia-movil.md) | ¿Qué cambia en el móvil y cómo se coordina con la alineación en curso? | discovery 04 |
| 06 | [analitica-gerencial](./06-analitica-gerencial.md) | ¿Qué ve cada nivel gerencial y de dónde salen esos datos? | discovery 02, 08 |
| 07 | [integracion-externa](./07-integracion-externa.md) | ¿Cómo entra la cartera desde sistemas externos sin sustituirlos? | discovery 06 |
| 08 | [crecimiento-futuro](./08-crecimiento-futuro.md) | ¿Qué queda preparado para crecer y qué no se construye ahora? | todos |
| 09 | [compatibilidad-tenants](./09-compatibilidad-tenants.md) | ¿Qué garantiza que el tenant gratuito individual no pierde nada? | ADR-0004; discovery todos |

## Cierre (G2)
Ver `../GATES.md` → G2.
