---
name: qa-bug
description: Crea una tarjeta de bug del QA manual de Kobrax en la lista "🐞 Bugs" de ClickUp, con el formato de las tarjetas actuales (título "BUG: <caso> · <resumen>", Caso, Entorno, Pasos, Resultado actual, Resultado esperado, Severidad, Nota técnica) y enlazada a la tarea del caso. El tester solo da el código del caso (W-LOG-46, M-LOG-04…) y qué falló; el skill completa el resto leyendo el caso en ClickUp y el código del repo. Usar cuando digan "/qa-bug W-LOG-23 …", "crea el bug de W-LOG-…", "reporta el fallo de M-…", "falló el caso …", "abre un bug".
---

# qa-bug — tarjeta de bug a partir del código del caso

El tester escribe **el código del caso** y **qué pasó**. Tú armas la tarjeta completa, la creas en ClickUp y la enlazas al caso. El tester no debería tener que escribir nada más, salvo que falte un dato que solo él conoce (ver "Cuándo preguntar").

**Argumento:** `<código del caso> <qué falló>`, en texto libre. Ej.:
- `/qa-bug W-LOG-23 con espacio al final sale Validación fallida`
- `/qa-bug M-LOG-10 el botón se queda cargando para siempre, adjunto C:\capturas\m10.png`

Si no viene el código del caso o no se entiende qué falló, pregunta solo eso.

## Datos fijos de ClickUp

| Qué | Valor |
|---|---|
| Workspace | `90171523582` (pásalo siempre como `workspace_id`; hay dos workspaces) |
| Lista de casos de QA | `901716889957` |
| Lista **🐞 Bugs** (destino) | `901717268806`, estado inicial `to do` |
| Sara (WEB) | `49529367` |
| Josué (MÓVIL) | `112059041` |
| URL web en uso | `https://kobrax.ikigaisystems.lat` |

Códigos de caso: `W-` = web, `M-` = móvil. El segmento del medio es la pantalla (`LOG` = login, etc.).

## Pasos

### 1. Encontrar el caso
1. Lista las tareas de la lista de casos (`clickup_filter_tasks`, `list_ids: ["901716889957"]`, `include_closed: true`).
2. Quédate con las que empiezan con `[WEB]` si el código empieza con `W-`, o con `[MÓVIL]` si empieza con `M-`.
3. Lee la descripción de cada una (`clickup_get_task` con `include: ["description"]`) hasta encontrar el bloque `**<código> · <título>**`.
4. De ese bloque copia: título del caso, pasos numerados, datos exactos (correos, contraseñas, textos) y el **Esperado**. Del encabezado de la tarea copia la URL de la pantalla y los usuarios de prueba.

Si el código no aparece en ninguna tarea, dilo y pide que lo revise. No inventes el caso.

### 2. Revisar si ya existe
Lista la lista Bugs (`list_ids: ["901717268806"]`, `include_closed: true`). Si ya hay un bug con el mismo código de caso, o uno que describe el mismo fallo (por ejemplo, un bug de W-LOG-17 que dice "Afecta también a: W-LOG-18"), no crees otro: muéstralo y pregunta si prefiere agregar un comentario a ese bug.

### 3. Ver la causa en el código
Busca en el repo el código de la pantalla y del endpoint involucrados (web: `apps/web/src/app/...`; móvil: `apps/mobile/...`; API: `apps/api/src/modules/...`). Sirve para:
- explicar en la **Nota técnica** qué archivo y línea produce el comportamiento (`ruta/archivo.ts:NN`);
- confirmar el texto exacto de los mensajes que aparecen en pantalla;
- detectar otros casos afectados por la misma causa (línea "Afecta también a:").

Solo lectura: este skill **no corrige el código**. Si no encuentras la causa con seguridad, omite la sección Nota técnica. No la adivines.

### 4. Decidir tipo y severidad

| Severidad | Cuándo | `priority` |
|---|---|---|
| Crítica | Seguridad (entra sin contraseña, se ven datos de otra empresa, XSS que se ejecuta), pérdida de datos, nadie puede usar la pantalla | `urgent` |
| Alta | La función principal del caso no funciona, pero hay otra forma de hacerlo o afecta a pocos usuarios | `high` |
| Media | Funciona, pero el mensaje, la validación o el flujo confunden al usuario | `normal` |
| Baja | Visual o de comodidad; la pantalla funciona | `low` |

Es **mejora** (no falla) cuando el caso técnicamente pasa, pero el tester propone algo mejor, o cuando el caso decía "si te parece incorrecto → BUG de mejora". En ese caso el título lleva `Mejora:` después del `·` y la descripción empieza con la línea `**Tipo:** mejora de …`.

### 5. Armar la tarjeta

**Título:** `BUG: <código> · <resumen>`. El resumen es una frase corta que describe el síntoma visto por el usuario, no la causa técnica. Ej.: `BUG: W-LOG-04 · En iPad el formulario de login queda desalineado respecto al panel izquierdo`.

**Descripción (markdown), en este orden.** Omite las secciones que no aplican:

```markdown
**Tipo:** mejora de UX (…)                      ← solo si es mejora
**Caso:** <código> · <título del caso> — tarea \[WEB\] <Pantalla>: [<url de la tarea del caso>](<url de la tarea del caso>)
**Entorno:** <ver abajo>
**Usuario:** <correo usado> · **Se repite:** siempre / a veces (N de M)   ← si se conoce
**Afecta también a:** <otros códigos>           ← solo si aplica

## Pasos
1. …  (numerados, con los datos exactos entre `backticks`)

## Resultado actual
<lo que pasó, con los textos exactos de pantalla en **negrita**>

## Resultado esperado
<lo que dice el Esperado del caso; si es mejora, la propuesta concreta, con los textos sugeridos>

## Severidad
<Crítica|Alta|Media|Baja> (<motivo en pocas palabras>)

## Nota técnica
<archivo:línea y explicación breve de la causa>

## Adjunto
<nombre del archivo> (captura)                  ← solo si se adjuntó
```

**Entorno:**
- Web: `Chrome escritorio. URL: [https://kobrax.ikigaisystems.lat/<ruta>](https://kobrax.ikigaisystems.lat/<ruta>)`, más el modo dispositivo o el navegador si el caso lo usa (Edge, iPad en DevTools, etc.).
- Móvil: dispositivo y versión de Android/iOS. Si el tester no los da, reutiliza los del bug de móvil más reciente de la lista Bugs y agrega `— _confirmar_`.

Escribe todo en español claro, para alguien no técnico, excepto la Nota técnica. Usa "Resultado actual" solo para lo observado, sin opiniones. No repitas el mismo dato en dos secciones.

### 6. Crear, enlazar y adjuntar
1. `clickup_create_task`: `list_id: "901717268806"`, `name`, `markdown_description`, `priority`, `status: "to do"`. En `assignees` va el tester: Sara (`49529367`) si el caso es `W-`, Josué (`112059041`) si es `M-`, salvo que quien ejecuta el skill sea otra persona (en ese caso, `clickup_resolve_assignees` con `"me"`).
2. `clickup_add_task_link` desde el bug hacia la tarea del caso. Es un **enlace**, no una subtarea: los bugs tienen que quedar todos juntos en la lista Bugs.
3. Si el tester dio una ruta de captura o video: `clickup_attach_task_file` al bug.

No marques el checkbox del caso ni edites la tarea del caso. Eso lo hace el tester.

### 7. Responder
Muestra, en pocas líneas:
- el enlace al bug como `[BUG: <código> · <resumen>](<url>)`;
- la severidad elegida y por qué;
- lo que quedó con `_confirmar_` o lo que no se pudo verificar en el código.

## Cuándo preguntar
Pregunta **solo** si:
- falta el código del caso o no se entiende qué falló;
- el código no existe en ninguna tarea de casos;
- ya hay un bug igual (paso 2);
- el fallo no se puede reproducir con los pasos del caso y el tester no dijo qué hizo distinto.

Lo demás (severidad, título, entorno web, textos esperados) decídelo tú y, si hace falta, acláralo en la respuesta.
