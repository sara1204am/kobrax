# Diseño — IA Etapa 1: del registro a la ayuda para decidir

> **Estado: propuesta para validar. No hay código.** Documento del 2026-10-09.
> Complementa `estrategia-ia.md` (visión y mapa completo). Cada afirmación sobre
> el código actual fue verificada leyendo los archivos citados.

## 0. Idea central

No competir con «Kobrax tiene IA». Demostrar que resuelve problemas de cobranza
que el software tradicional no resuelve bien:

| Nivel | Qué es | Estado |
|---|---|---|
| 1 · Software tradicional | Registra créditos, pagos, visitas, mora: «qué ocurrió» | Existe |
| 2 · Plataforma operativa | Conecta cartera, campo, promesas, evidencia y seguimiento, incluso offline | Existe |
| 3 · Inteligencia asistida | Interpreta el historial, prepara la siguiente gestión, recomienda prioridades. La persona decide | **Este diseño empieza aquí** |

La IA se construye **sobre** los datos y reglas de los niveles 1 y 2, no al lado:
conoce el contexto operativo de la cobranza (episodios, promesas, resultados
válidos), no es un chatbot genérico.

### Las tres etapas

| Etapa | Contenido | Necesita datos reales |
|---|---|---|
| **1 — Útil desde el primer piloto** | Mapeo de importación · Resumen del crédito · Dictado de la gestión en el teléfono (gratis) · Mensajes | No |
| **2 — Basada en resultados** | Anomalías por reglas · Patrones de promesas · Probabilidad de recuperación y alerta de mora | **Sí** |
| **3 — Optimización** | Qué cliente visitar primero · Rutas por valor esperado · Reparto de cartera | **Sí, y mucho** |

Este documento diseña la **Etapa 1**. La Etapa 1 también construye la base
(gateway, controles, medición) que sostiene las etapas 2 y 3.

## 1. Qué entra en la Etapa 1

Orden recomendado de construcción:

| # | Capacidad | Problema real que ataca | Se apoya en |
|---|---|---|---|
| 0 | **Base de IA** (gateway, controles, medición) | — | `common/plan`, `CryptoService`, `AuditLog` |
| 1 | **Resumen del crédito** | El cobrador llega a la visita sin leer la historia | `mora` (bitácora, promesas, notas) |
| 2 | **Dictado de la gestión en el teléfono** (gratis, en el dispositivo) | Escribir la gestión en campo es lento y se omite | `mora.activity`, validador compartido, reconocimiento de voz del sistema |
| 3 | **Mapeo de importación** | Cada entidad trae columnas distintas; incorporarla es trabajo manual | `imports`, `/import/ajustes` |
| 4 | **Mensajes**: plantilla con variables, dictado y, opcional, mejora de tono | Redactar WhatsApp consume tiempo y varía el tono | catálogo de plantillas, `wa.me`, el mismo dictado |

Fuera de esta etapa: cualquier mensaje automático al deudor, scoring,
recomendación de rutas, lectura de PDF con IA, análisis de fotos.

## 2. Arquitectura de la base (capacidad 0)

### 2.1 Módulo `ai` en la API

```
apps/api/src/modules/ai/
├── ai.module.ts
├── ai-gateway.service.ts      # ÚNICO punto que llama al proveedor
├── ai-capability.registry.ts  # capacidades declaradas + riesgo + degradación
├── ai-budget.service.ts       # topes mensuales por cuenta
├── ai-redactor.ts             # seudonimización
├── ai-usage.service.ts        # registro de uso
├── providers/                 # interfaz + implementación
├── prompts/                   # constructores puros, versionados
├── evals/                     # casos dorados por capacidad
└── capabilities/
    ├── credit-summary.service.ts
    ├── dictation-refine.service.ts   # opcional: refina el TEXTO dictado
    ├── import-mapping.service.ts
    └── message-draft.service.ts
```

Reglas:
- **Nadie fuera de `ai/` importa el SDK del proveedor.** Una prueba lo verifica
  (patrón de Gallium: sin ella, 31 de 33 puntos de entrada quedaron sin control).
- **Sin credenciales la IA queda apagada y todo lo demás sigue igual.** Es el
  mismo contrato que ya tiene FCM (`FCM_SERVICE_ACCOUNT_*` opcionales en
  `env.validation.ts`).
- Variables nuevas, todas opcionales: `AI_ENABLED`, `AI_PROVIDER`, `AI_BASE_URL`,
  `AI_API_KEY`, `AI_MODEL_TEXT`, `AI_MODEL_STT`, `AI_TIMEOUT_MS`.
- La Etapa 1 **no usa llamadas a herramientas ni agentes**: el modelo recibe
  datos y devuelve JSON con esquema fijo. Sin herramientas no hay forma de que
  un texto malicioso en una nota provoque una acción.

### 2.2 Modelo de datos nuevo (todas con `account_id` y RLS, principio no negociable #1)

| Tabla | Para qué | Notas |
|---|---|---|
| `account_ai_settings` | Capacidad × cuenta: activa, tope mensual, opciones (p. ej. incluir notas libres) | Apagado por defecto |
| `ai_usage_log` | Cuenta, usuario, capacidad, versión de prompt, modelo, tokens, costo, latencia, resultado | **Sin contenido** del prompt ni de la respuesta |

Se aplican las políticas RLS con el script `rls/001_enable_rls.sql`, que hoy se
corre a mano tras cada migración: **recordarlo en el plan de despliegue**.

### 2.3 Tope mensual: no reutilizar `assertRoom`

Verificado en `common/plan/plan-limits.service.ts`:
- `assertRoom` solo acepta `users | credits | clients` (tipo `CountedLimit`).
- Los contadores mensuales (`photosPerMonth`, `actionsPerMonth`) están en otro
  tipo **a propósito**: nunca frenan, porque una foto o una visita ya ocurrió
  (regla R1).

La IA es lo contrario: es **opcional y no ocurrió ya**. Frenarla no perjudica el
trabajo de campo. Por eso se propone un `AiBudgetService` aparte, con tope
**duro**, que al agotarse responde `AI_BUDGET_REACHED` y la interfaz vuelve al
flujo manual. Tocaría `packages/shared/src/constants/plans.ts` para añadir
`aiCallsPerMonth` por plan (hoy hay un único lugar donde viven los topes).

### 2.4 Permisos y alcance
- Nuevo permiso `ai:use` en `permission.enum.ts`.
- Cada capacidad exige además el permiso del recurso que lee: el resumen exige
  `COLLECTION_READ` y **respeta el alcance** ya aplicado con `moraAccessConditions`.
  Un cobrador no puede pedir el resumen de un crédito que no ve.
- Límite por usuario con el `@RateLimit` existente.

### 2.5 Seudonimización (`ai-redactor.ts`)
Qué sale hacia el proveedor y qué no:

| Dato | ¿Sale? | Cómo |
|---|---|---|
| Nombre, documento, teléfono, dirección, correo del cliente, contactos y garantes | **No** | Se reemplazan por `[CLIENTE]`, `[TELÉFONO]`… y se restituyen al mostrar |
| Montos, fechas, días de mora, categoría, resultados | Sí | No identifican por sí solos |
| Notas libres | Solo con opción de la cuenta, tras redacción | Texto libre es el riesgo mayor: se redacta con la lista de nombres y números **conocidos del propio cliente** más patrones (teléfonos, documentos, correos) |

Límite honesto: la redacción de texto libre es de mejor esfuerzo, no perfecta.
Por eso la opción «incluir notas libres» arranca **apagada**.

## 3. Capacidad 1 — Resumen del crédito

**Idea clave:** el modelo no calcula nada. El sistema arma los **hechos** de forma
determinista; el modelo solo los ordena en lenguaje natural.

### Flujo
1. El usuario abre la ficha de mora (web `/mora/[creditId]` o móvil `mora/[creditId]`).
2. Pulsa «Preparar contacto» (o se carga si ya hay uno vigente).
3. `POST /api/mora/:creditId/ai-summary`: verifica permiso, alcance y tope.
4. Se arma el bloque de hechos desde `mora.service`: días de mora y categoría,
   episodio vigente, últimas N gestiones (tipo, resultado, fecha), promesas con su
   estado (cumplida / incumplida / vigente), pagos recientes, notas (según opción).
5. El gateway pide un JSON con esquema fijo.
6. La API **valida** la salida y devuelve el resumen.

### Salida (esquema)
```json
{
  "resumen": "texto breve",
  "puntos": [{"texto": "…", "fuente": "activity:<id> | promise:<id> | note:<id>"}],
  "precauciones": ["…"],
  "siguiente_paso": "sugerencia, no orden"
}
```

### Controles
- **Cada punto cita su fuente** y la interfaz la enlaza a la gestión original.
- **Verificación automática:** toda cifra y fecha de la salida debe aparecer en
  el bloque de hechos; si no, la respuesta se descarta o se marca. Una cifra
  inventada nunca llega al usuario.
- **Caché:** clave = crédito + huella de (última gestión, estado de promesas,
  cantidad de pagos). Se regenera solo si cambia algo. En móvil se guarda en la
  tabla `cache` de SQLite (`kind` = `ai.summary`); sin red se muestra el último
  disponible con su fecha.
- **El resumen no se persiste como dato del crédito**: es una vista derivada.

## 4. Capacidad 2 — Dictado de la gestión en el teléfono (gratis)

**Objetivo:** que el oficial, en la visita, *hable*; vea en pantalla lo que dijo;
corrija lo que haga falta y confirme. Sin escribir el reporte completo.

### Cambio de enfoque respecto a la primera versión de este diseño
La primera versión proponía grabar audio, subirlo y transcribirlo en un servicio
de pago. **Se descarta como camino principal** por tres razones:

| | Audio al servidor (descartado) | Dictado en el dispositivo (elegido) |
|---|---|---|
| Costo por uso | Pago por minuto de transcripción | **Cero**: lo hace el sistema del teléfono |
| Offline | No; se encola y se procesa luego | **Sí**, si el teléfono tiene el paquete de idioma |
| Privacidad | El audio sale y hay que guardarlo y borrarlo | El audio no pasa por Kobrax; no hay almacén de audio ni política de retención |
| Piezas nuevas | Almacén de audio, tabla de borradores, cola `voice.note` | Un botón de micrófono y una función pura |

### Dos capas, de menor a mayor

**Capa 1 — Dictado del propio teclado (cero desarrollo).**
Los campos de notas ya son `TextInput` multilínea (`agenda-register.tsx`,
`gestion-sheet.tsx`). El micrófono del teclado del teléfono ya funciona ahí. Sirve
desde el día uno y no requiere cambiar nada; es el plan B si falla la capa 2.

**Capa 2 — Botón de micrófono dentro de la app.**
Usa el reconocimiento de voz nativo del sistema mediante el paquete
[`expo-speech-recognition`](https://github.com/jamsch/expo-speech-recognition),
que envuelve el reconocimiento de iOS y de Android, existe para Expo SDK 51
(`npm install expo-speech-recognition@sdk-51`) y ofrece un modo en el dispositivo.
Aporta lo que el teclado no: **texto parcial en vivo** mientras habla, idioma
fijado y control del flujo.

### Flujo en la visita
```
Pulsa 🎤 en la ficha de ESE crédito → habla
   → el texto aparece en vivo en el cuadro de «Notas»  (el oficial lo ve y lo edita)
   → Kobrax SUGIERE resultado y promesa (fichas tocables)  ← ver «estructurar»
   → el oficial corrige, valida
   → se registra como cualquier gestión (mora.activity, cola offline, id idempotente)
```
El texto dictado **es** el reporte (`notes`). La estructura (resultado, promesa)
solo ahorra los toques.

### Estructurar el texto dictado (también gratis y offline)

La sugerencia de campos sale de una **función pura** en `packages/shared`
(donde ya viven las reglas compartidas y la regla dice «funciones puras, sin
efectos»), probada con casos y usada igual en web y móvil:

`suggestFromDictation(texto, hoy) → { tipo?, resultado?, promesa?: {monto?, fecha?}, faltantes[] }`

| Detecta | Ejemplos de frases | Resultado sugerido |
|---|---|---|
| No estaba | «no estaba», «nadie abrió», «no lo encontré» | `NOT_FOUND` (visita) |
| Dirección errada | «esa dirección no es», «se mudó» | `WRONG_ADDRESS` |
| No contestó | «no contestó», «apagado», «buzón» | `NO_ANSWER` (llamada) |
| Se negó | «se negó», «dijo que no va a pagar» | `REFUSAL` |
| Contactado | «hablé con él», «me atendió» | `CONTACTED` |
| Promesa | «prometió pagar el viernes cien dólares» | `PROMISE_TO_PAY` + monto y fecha |

- Fechas relativas («mañana», «el viernes», «el 15») se resuelven con el reloj del
  tenant (`TenantClockService`) y el día civil local.
- Cifras dichas con palabras («quinientos», «mil doscientos») se convierten.
- **Nunca inventa:** si no encuentra monto o fecha, queda en `faltantes` y la
  ficha aparece vacía para completar a mano.
- **Cada sugerencia pasa por `validateRecoveryActivity`**, el validador que ya
  usan web, móvil y API. Lo que no valida no se ofrece.

Límite honesto: un analizador por reglas cubre las frases frecuentes, no todas.
Cuando no entiende, no estorba: el cuadro de notas funciona igual. Se mide la
cobertura con frases reales de cobradores antes de prometer nada.

### Refinamiento opcional con modelo (solo si la cuenta lo activa)
Cuando hay red y la cuenta activó IA, se puede enviar **solo el texto**
(seudonimizado; nunca audio) para mejorar la extracción. El resultado pasa por el
mismo validador y sigue siendo una sugerencia. Es opcional: la función ya
entrega valor sin esto. Mantiene la Etapa 1 sin llamadas a herramientas.

### Qué cambia en el código existente
- **Móvil:** botón de micrófono en `gestion-sheet.tsx` y `agenda-register.tsx`;
  permiso de micrófono; paquete nativo nuevo.
- **Shared:** `suggestFromDictation` + pruebas, junto a `recovery-activity.ts`.
- **API:** nada para la capa 1 y 2; la gestión entra por el `POST /mora/:id/activities` de siempre.
- **Cola offline:** sin tipo nuevo. Dictar no necesita red; registrar usa `mora.activity`.

### Riesgos propios del dictado
| Riesgo | Mitigación |
|---|---|
| **«Gratis» no significa «privado»**: en Android el reconocimiento por defecto puede enviar el audio a servidores del fabricante del sistema; en iOS depende del idioma | Usar el modo en el dispositivo cuando exista y decirlo al usuario; no se asegura privacidad total |
| Paquete de idioma sin descargar → no funciona sin red | Detectar disponibilidad y guiar la descarga; si no, caer a la capa 1 |
| **Español de Bolivia (`es-BO`) no verificado** como disponible fuera de línea | Probar en los teléfonos reales de los cobradores; si no hay `es-BO`, usar otra variante de español |
| Ruido de calle, acento, gama baja | Prueba en terreno antes de activar; el oficial siempre ve y corrige |
| Módulo nativo: no corre en Expo Go | La app ya requiere *development build* por MapLibre; confirmar que existe la cadena de build (no hay `eas.json` en el repo) |
| Dictar datos personales de terceros | Las notas ya son datos del crédito con sus controles; no se envían a un modelo salvo opción de la cuenta y tras redacción |

## 5. Capacidad 3 — Mapeo de importación

### Problema
Cada entidad envía un formato distinto. Hoy se resuelve con reglas por campo
(`FIELD-RULES`) y configuración manual en `/import/ajustes`.

### Flujo
1. Se sube un Excel o CSV con columnas no reconocidas.
2. El sistema extrae **solo**: encabezados + estadísticas por columna (tipo,
   longitud, proporción numérica, formato de fecha) + *forma* de unos pocos
   valores (letras → `a`, dígitos → `9`). **No salen valores reales.**
3. El modelo propone «columna del archivo → campo de Kobrax» con una confianza.
4. La persona lo revisa en la pantalla de columnas que ya existe y lo confirma.
5. La **vista previa en seco** (dry-run) ya existente valida el resultado antes de aplicar.

### Límites declarados
- Solo Excel y CSV. **La lectura de PDF con IA queda fuera**: las tablas en PDF
  son frágiles y hay parsers dedicados.
- Si la confianza es baja, no propone: dice que no sabe.

## 6. Capacidad 4 — Mensajes (entra en la Etapa 1)

Tres niveles, de menor a mayor, y los dos primeros **no necesitan IA**:

| Nivel | Qué hace | Costo | Estado |
|---|---|---|---|
| **M1 · Plantilla con variables** | El oficial elige una plantilla del catálogo y Kobrax rellena nombre, monto, fecha y empresa; se envía por WhatsApp (`wa.me`) | Cero | La base **ya existe**: catálogo `WHATSAPP_TEMPLATE`, `whatsappLink` y variables en `agenda-quick.ts` y `agenda-register.tsx` |
| **M2 · Dictar el mensaje** | El oficial **dicta** lo que quiere decir con el mismo micrófono de la capa 2; el texto aparece en el cuadro, lo corrige y lo envía | Cero | Reutiliza el botón de dictado |
| **M3 · Mejorar el tono** | Con red y con IA activada, un modelo reescribe el texto dictado en un tono cortés y claro, **solo texto, sin audio**, seudonimizado | Costo por uso, con tope | Opcional |

### Reglas fijas (valen para M2 y M3)
- **La persona revisa y envía.** Kobrax no envía nada por su cuenta.
- Sin amenazas, sin mencionar a terceros (familiares, vecinos, empleadores), sin
  plazos o consecuencias que el sistema no pueda cumplir.
- Se comprueba contra los `MESSAGE` recientes del crédito para avisar si hay
  exceso de contacto.
- El texto final se registra como gestión `MESSAGE` con su resultado, igual que hoy.

### Para M3, el contrato con el modelo
Entrada: el texto, la promesa vigente y los días de mora (sin nombre ni teléfono).
Salida: un único mensaje de texto. Una comprobación determinista posterior
descarta cualquier salida con cifras o fechas que no estaban en la entrada.

## 7. Evaluación y medición

### Antes de activar (evaluaciones)
Cada capacidad exige un conjunto de casos dorados **ejecutado en CI**; un cambio
de prompt o de modelo no entra si baja el resultado. Gallium tiene el mismo
conjunto sin conectar a nada: aquí es condición de entrada.

| Capacidad | Casos que no pueden faltar |
|---|---|
| Resumen | Cifras no inventadas (verificación automática); crédito sin historia; nota con instrucción maliciosa («ignora lo anterior…»); fuga de datos personales |
| Dictado (`suggestFromDictation`) | Frases reales de cobradores con acento y ruido; monto o fecha faltante; varias promesas; resultado ambiguo; frases que no debe interpretar |
| Mapeo | Encabezados con tildes y abreviaturas; columnas duplicadas; encabezado engañoso |
| Mensajes | Rechazo de lenguaje amenazante; consistencia con la plantilla |

Los criterios numéricos de aprobación **no se fijan aquí**: se acuerdan con datos
de la primera corrida. Nada de inventar umbrales.

### Después de activar (impacto en el piloto)
Medir para poder decirlo con evidencia, no con intuición:

| Indicador | Cómo |
|---|---|
| Tiempo de registrar una gestión, con y sin dictado | Evento en cliente |
| % de gestiones con sugerencia aceptada tal cual / corregida / ignorada | Evento en cliente |
| % de visitas precedidas por un resumen | Eventos |
| Tiempo de incorporar un formato de entidad nuevo, con y sin asistente | Manual en el piloto |
| Costo por cuenta y por cobrador | `ai_usage_log` |

## 8. Orden de construcción

| Paso | Entrega | Depende de |
|---|---|---|
| A | Módulo `ai` vacío + variables + gateway + prueba «solo el gateway toca el SDK» | — |
| B | `account_ai_settings`, `ai_usage_log`, RLS, permiso `ai:use`, `AiBudgetService`, pantalla de ajustes en `/cuenta` | A |
| C | Seudonimizador + arnés de evaluación | A |
| D | Resumen del crédito (API + web + móvil con caché) | B, C |
| E | Dictado: `suggestFromDictation` en `shared` + pruebas, botón de micrófono en la gestión (módulo nativo), prueba en teléfonos de cobradores | — (no depende de la base de IA) |
| F | Mapeo de importación | B, C |
| G | Mensajes: M1 plantillas (ya existe) → M2 dictado → M3 mejora de tono | E (M2), B y C (M3) |
| H | Instrumentación de impacto y tablero de uso | B |

Cada paso es entregable por separado y deja el sistema funcionando si se detiene.
Antes de tocar código, este diseño debe convertirse en un plan de etapa y pasar
el gate de validación que usa el repo (`/f10-validar-plan`) o su equivalente.

## 9. Riesgos específicos de esta etapa

| Riesgo | Mitigación |
|---|---|
| Fuga de datos personales en texto libre | Opción apagada por defecto; redacción con nombres conocidos; sin persistir prompts |
| Inyección de instrucciones en notas o texto dictado | Sin herramientas; salida con esquema y validador; ningún efecto directo |
| Confianza excesiva en el resumen | Fuentes citadas, cifras verificadas, rótulo «generado, revisar» |
| Sesgo hacia presión excesiva (mensajes) | Plantillas, reglas fijas, control de frecuencia, humano envía |
| Costo superior al previsto | Tope duro por cuenta, caché por huella, modelo pequeño por defecto |
| Dependencia de red en campo | Todo degrada al flujo manual; el dictado funciona sin red si el paquete de idioma está instalado |
| Dictado deficiente con acento y ruido; `es-BO` sin verificar | Probar en los teléfonos reales de los cobradores; el oficial siempre ve y corrige |
| Proveedor fuera de Bolivia | Seudonimización obligatoria; decisión D1 |

## 10. Decisiones que necesito de ti

| # | Decisión | Mi recomendación |
|---|---|---|
| D1 | Proveedor de modelos (solo para resumen, mapeo y mejora de tono; el dictado ya no necesita proveedor) y dónde se procesan los datos | Interfaz intercambiable; prueba comparativa corta en español |
| D2 | ¿Incluir notas libres en el resumen por defecto? | **No**; opción por cuenta |
| D3 | ¿IA en el plan FREE? | Cupo muy pequeño o ninguno; es palanca para subir de plan |
| D4 | ¿Aceptas que «gratis» no implique «privado» en el dictado (en Android el audio puede procesarse en servidores del sistema)? | Sí, usando el modo en el dispositivo cuando exista y avisando al usuario |
| D5 | ¿Con qué teléfonos y qué paquete de idioma se prueba el dictado? | Con los teléfonos reales de 2 o 3 cobradores, antes de construir el botón |
| D6 | ¿Quién ve el resumen? | Quien ya ve el crédito (alcance existente) |
| D7 | Tope mensual por plan | Medir en el piloto antes de fijarlo |
| D8 | Mensajes en la primera entrega | **Sí, M1 y M2** (sin costo); M3 con modelo después |
