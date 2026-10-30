# F13 · GATES

> Definición de cada gate. El **estado** vive solo en `STATUS.md`. Vocabulario: PASS · FAIL · BLOCKED · NOT_APPLICABLE, siempre con justificación.
> **Regla central:** terminar una tarea no abre el siguiente gate. Lo abre la autorización explícita de la usuaria, escrita en `STATUS.md`.
> Si falta información, la sesión se detiene y pregunta; no rellena.

## Gates de la épica

### G0 · Arnés completo y validado
- **Entra:** nada.
- **Sale con PASS si:** existen los archivos del mapa del README; todo enlace relativo resuelve; README ≤ 60 líneas; no hay instrucciones contradictorias; una sesión nueva puede responder la tabla «Dónde responder cada pregunta»; el skill `epic-fase` existe y apunta a rutas reales.
- **Evidencia:** `execution/VERIFICATIONS.md`.
- **Aprueba:** técnico propone PASS; la usuaria autoriza pasar a G1.

### G1 · Discovery completo y evidenciado
- **Entra:** G0 PASS + autorización de la usuaria.
- **Sale con PASS si:** los 10 archivos `discovery/01…09` + `00-inventario` están llenos; **cada hallazgo** lleva clase de evidencia y `archivo:línea`/test/comando; no queda hallazgo CONTRADICTORIO sin resolver o sin dueño; `hub/HUB.md` cubre todos los puntos que tocan oficina/alcance/rol y sus entradas están `VERIFICADO`; las pistas de `00-leads.md` quedaron confirmadas, refutadas o pasadas a DESCONOCIDO; el estado por **perfil de tenant** (gratuito individual, equipo, grande) está descrito.
- **Prohibido en G1:** proponer solución o editar código.

### G2 · Arquitectura objetivo documentada y contrastada
- **Entra:** G1 PASS + autorización.
- **Sale con PASS si:** los 9 documentos de `target/` están llenos; cada decisión de diseño referencia un ADR; cada afirmación sobre el estado actual referencia un hallazgo H-…; `discovery/09-brechas.md` mapea lo actual contra lo objetivo; los ADR que bloquean el diseño están APROBADOS (no PROPUESTA); `target/09` demuestra, por perfil, que el tenant gratuito individual no pierde nada.

### G3 · Roadmap, dependencias y planes aprobados
- **Entra:** G2 PASS + autorización.
- **Sale con PASS si:** `ROADMAP.md` define por fase: objetivo, dependencias, orden, entregables, gates y criterios de aceptación; el orden respeta DB → API → diseño de acceso → módulos; cada fase tiene su criterio de regresión para el perfil gratuito; la usuaria aprobó el roadmap. Los planes técnicos **no** se escriben aún.

## Gates por fase (G4–G7 se repiten en cada fase del roadmap)

### G4 · Plan específico aprobado antes de modificar código
- **Entra:** G3 PASS y la fase anterior cerrada (G7).
- **Sale con PASS si:** existe `plans/<fase>-*.md` con las 13 secciones de la plantilla T4; el estado inicial se **releyó hoy** contra el código (no se copia de discovery); todos los archivos afectados tienen entrada HUB consultada; las pruebas nuevas están registradas en el script `test` correspondiente; hay rollback; `/epic-fase F13 validar <fase>` dio PASS; la usuaria dio OK.
- **Sin PASS no se crea la rama ni se escribe código.**

### G5 · Verificación funcional, técnica, de seguridad y regresión
- **Sale con PASS si:** `type-check` y tests de cada paquete tocado pasan **con salida pegada**; el SQL de verificación de la fase pasa; las pruebas de aislamiento multi-tenant y de alcance pasan; la **regresión del perfil gratuito individual** pasa; todo en `execution/VERIFICATIONS.md`.

### G6 · Code review e impacto transversal
- **Sale con PASS si:** `/code-review` aplicado y sus hallazgos resueltos o justificados; se recorrió el `hub/IMPACT-MAP.md` de cada entrada HUB tocada y los consumidores siguen verdes; `/ponytail-review` si el repo lo ofrece.

### G7 · Cierre documental
- **Sale con PASS si:** HUB actualizado (cambio realizado, prueba, estado); `PROGRESS`, `STATUS`, `HANDOFF` y `execution/PHASES-LOG.md` al día; los docs de producto afectados (`docs/producto/…`, según su sección «Cómo mantenerlos al día») actualizados; contradicciones nuevas anotadas.
