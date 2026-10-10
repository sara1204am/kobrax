# Estrategia de IA para Kobrax

> Análisis del 2026-10-09. Se apoya en la documentación verificada de
> `docs/producto/` y en la lectura de `E:\Tutator\gallium-10-casper`.
> Es una propuesta de diseño, no una promesa de funcionalidad: **hoy Kobrax no
> tiene ningún componente de IA** (verificado: sin SDK de modelos, sin embeddings,
> sin ML). Todo lo «inteligente» actual son reglas deterministas.

## 1. Punto de partida

### Lo que Kobrax ya tiene y la IA necesita
| Activo | Dónde | Por qué importa para IA |
|---|---|---|
| Resultados de cada gestión (`credit_activities`) con tipo y resultado | módulo mora | Etiquetas reales de qué funciona |
| Promesas de pago con cumplimiento (cumplida / incumplida) | mora | La etiqueta más valiosa: predice pago |
| Episodios de mora con historial y prioridad por reglas | mora, arrears | Línea base contra la que comparar un modelo |
| Visitas con GPS, foto y hash SHA-256 | field-ops | Señales de calidad y de fraude |
| Rutas planificadas vs. visitas reales | routes | Aprendizaje de tiempos y de éxito por zona |
| Notas libres (post-its) y bitácora | mora, clientes | Texto no estructurado listo para LLM |
| Importación de reportes PDF/Excel de entidades | imports | Formatos heterogéneos: problema ideal para IA |
| Plantillas de WhatsApp con variables | catálogos | Base para redacción asistida |
| Cifrado de PII + índice ciego, RLS, auditoría | common | Controles que el diseño de IA debe respetar, no saltarse |

### Limitación honesta
La instancia desplegada tiene datos de prueba. **Los modelos predictivos no se
pueden entrenar hasta tener historial real de al menos un piloto.** Por eso el
orden correcto es: primero capacidades con LLM que no necesitan histórico,
mientras se acumulan las etiquetas; después, predicción.

## 2. Qué es realmente «Casper» y qué enseña

Corrección importante: **Casper no es un sistema de IA.** Es un producto de
gestión de casos para una fundación (For Our Children Foundation) construido
sobre la plataforma **Gallium**; el cliente incluso **excluyó** el asistente de
IA del alcance de Casper (`.claude/rules/casper.md`). La IA vive en la plataforma
Gallium, y es de ahí de donde sale lo aprovechable.

### Patrones de Gallium que conviene copiar
| Patrón | Qué hace | Cómo aplicarlo en Kobrax |
|---|---|---|
| **Registro de capacidades de IA** con interruptor por oficina, nivel de riesgo y degradación definida | Cada función de IA se declara en un solo lugar y se apaga por cuenta | Mismo registro por `account`, atado a los planes (FREE sin IA, planes superiores con cupo) |
| **Prueba de cobertura del registro** que falla si una ruta llega al LLM sin declarar capacidad | Gallium encontró 31 de 33 puntos de entrada sin control | Un **único módulo `ai-gateway`**: ningún otro módulo importa el SDK |
| **Humano en el circuito estructural** | El asistente nunca escribe; solo abre un formulario precargado que la persona revisa | Igual: la IA propone, el cobrador o supervisor confirma |
| **Minimización de datos hacia el LLM** | Envían la *forma* del dato (letras → `a`, dígitos → `9`), nunca el valor | Seudonimizar: sin nombre, documento, teléfono ni dirección; montos redondeados o por rangos |
| **Identidad desde el token, no de la entrada** | El asistente del portal fija el beneficiario desde el JWT | El `account_id` y el usuario salen del contexto, nunca del prompt |
| **Límites duros** | Máximo de turnos, de tokens y rate limit por usuario | Presupuesto por cuenta y por cobrador |
| **Proveedor intercambiable** | Un SDK, tres variables de entorno | Mismo diseño; permite modelo pequeño para tareas simples |
| **Registro de uso y de gasto** | `ai_prompt_log` sin PII | Imprescindible: el plan cuesta $12 por cobrador |
| **Evidencia y trazabilidad** | Citas a archivo, placeholders en vez de inventar números | Toda recomendación con «por qué» y fuente |

### Errores de Gallium que NO hay que repetir
- **Las evaluaciones existen pero no están conectadas a nada** y los fixtures dorados no los ejecuta nadie. En Kobrax, un cambio de prompt no entra sin que corra un set de evaluación.
- **Una función de «traer tu propio proveedor» saltaba el control de gasto** y hubo que eliminarla. No ofrecer atajos fuera del gateway.
- **Un bug de rol dejó a los super admins en solo lectura para el asistente.** Probar el asistente con cada rol.
- **Primera auditoría con 6 hallazgos «confiados» falsos.** Verificar rutas de ejecución reales antes de afirmar cobertura.
- Gallium no tiene costos ni latencias medidos; no asumir los suyos.

## 3. Dónde entra la IA, módulo por módulo

Leyenda esfuerzo: S = días, M = semanas, L = meses. Valor y riesgo: A / M / B.

| # | Módulo | Capacidad | Tipo | Datos | Esfuerzo | Valor | Riesgo |
|---|---|---|---|---|---|---|---|
| 1 | Importación | Asistente de mapeo de columnas y explicación de anomalías para formatos nuevos de entidades | LLM | El propio archivo, sin PII | M | A | B |
| 2 | Mora | **Resumen del crédito antes de contactar** (qué pasó, qué se prometió, qué evitar) | LLM | Bitácora, notas, promesas | S | A | B |
| 3 | Mora / móvil | **Dictado de la gestión en el teléfono**: el oficial habla, ve el texto, corrige; Kobrax sugiere resultado, monto y fecha | Voz del sistema (gratis) + reglas; modelo opcional sobre el texto | Texto dictado | S-M | A | M |
| 4 | Agenda / WhatsApp | Redacción de mensaje según contexto y plantilla; la persona envía | LLM | Plantillas + contexto seudonimizado | S | M | M |
| 5 | Dashboard | Preguntas en lenguaje natural sobre indicadores, vía herramientas con permisos (no SQL libre) | LLM + tools | Analytics existente | M | M | M |
| 6 | Mora | **Probabilidad de que una promesa se cumpla / de que el crédito pague** | ML clásico | Histórico real | M-L | A | M |
| 7 | Mora | Alerta temprana: créditos al día con riesgo de entrar en mora | ML clásico | Cuotas, pagos, histórico | M-L | A | M |
| 8 | Rutas | Valor esperado por parada, no solo distancia; tiempos aprendidos | ML + OSRM | Rutas vs. visitas | L | A | B |
| 9 | Campo / auditoría | **Detección de anomalías en cobradores** (GPS lejos del domicilio, desplazamientos imposibles, fotos repetidas, cobros atípicos) | Reglas → ML | Visitas, hash, pagos | S (reglas) | A | M |
| 10 | Evidencia | Control de calidad de foto (borrosa, interior, duplicada) y OCR de comprobantes | Visión | Fotos | M | M | M |
| 11 | Supervisión | **Plan diario sugerido**: reparto de cartera, rutas y reasignaciones, aprobable en un clic | Agente + optimización | Todo lo anterior | L | A | M |
| 12 | Análisis | Pronóstico de recuperación y flujo de caja por cartera | Estadística | Histórico | M | M | B |
| 13 | Deudor (futuro) | Recordatorios y confirmación de promesas por WhatsApp automatizados | LLM | — | L | M | **A** |

### Notas por capacidad
- **#1 es la mejor primera apuesta comercial.** Cada financiera nueva trae un formato de reporte distinto; hoy hay parsers y reglas por campo mantenidos a mano. La IA propone el mapeo y la persona lo confirma en la vista previa que ya existe. Reduce el costo de incorporar clientes.
- **#2 y #3 atacan lo que más duele al cobrador:** leer historia antes de visitar y escribir después. En móvil offline, el resumen debe **generarse en servidor y quedar en caché**; no se puede llamar al modelo sin red. El dictado (#3) no tiene ese problema: usa el reconocimiento de voz del propio teléfono.
- **#6 y #7 reemplazan o complementan** `arrears-priority-score.ts`. Deben compararse siempre contra esa regla actual; si no la superan, no se activan.
- **#9 puede empezar sin ML.** Ya existen GPS, hash y horas. Reglas simples dan valor inmediato al supervisor y al dueño que no confía en su cobrador.
- **#13 no se hace en la primera fase** (ver riesgos).

## 4. El «siguiente nivel»: de sistema de registro a sistema de decisión

Hoy Kobrax **registra** lo que ocurrió. El salto es que **decida qué hacer
después y aprenda del resultado**:

```
Recomendación → Acción del cobrador → Resultado (visita, promesa, pago) → Aprendizaje
        ▲                                                                      │
        └──────────────────────────────────────────────────────────────────────┘
```

Kobrax ya captura las dos puntas del ciclo (acción y resultado etiquetado). Esa
es su ventaja de fondo: **datos propietarios de cobranza de campo en un mercado
informal y de microcrédito de América Latina**, que no tienen los grandes
sistemas bancarios ni los productos genéricos.

Tres formas de llevarlo más allá:

1. **Copiloto del supervisor (#11).** Cada mañana el sistema propone el reparto,
   las rutas y qué créditos reasignar, con el motivo. El supervisor aprueba o
   corrige, y cada corrección es una etiqueta de entrenamiento.
2. **Auditoría automática de la operación (#9, #10).** Convertir la evidencia
   (foto, GPS, hash) en un score de confiabilidad por cobrador y por visita.
   Es lo que un dueño de cartera realmente compra: control sin estar en la calle.
3. **Inteligencia comparativa entre cuentas.** Con consentimiento y datos
   anonimizados, ofrecer referencias («tu tasa de cumplimiento de promesas vs. la
   de carteras similares»). Es un efecto de red, pero requiere análisis legal y
   de privacidad antes; marcarlo como hipótesis.

Para el concurso y para la narrativa de inclusión financiera, hay una línea
adicional: **perfil de comportamiento de pago para microcrédito informal**,
útil para quien no tiene historial bancario. Es una hipótesis que exige
cuidado ético (ver §5) y no debe presentarse como capacidad existente.

## 5. Riesgos y reglas no negociables

| Riesgo | Regla |
|---|---|
| **Presión indebida al deudor.** La IA optimizando «recuperar más» puede empujar a acoso | La IA recomienda *cuándo y por qué canal*, nunca *qué tan agresivo*. Sin amenazas generadas; tono limitado por plantilla aprobada. Frecuencia máxima de contacto configurable |
| **Sesgo y discriminación** en scoring | No usar atributos sensibles ni sus sustitutos (zona como proxy, nombre, género, edad si no está justificado). Revisar resultados por grupo antes de activar |
| **Decisiones automáticas con efecto sobre personas** | Nada irreversible sin humano: no castigar un crédito, no marcar fraude, no enviar mensajes por sí solo |
| **PII hacia un proveedor externo** (probablemente fuera de Bolivia) | Seudonimizar siempre en el gateway; nunca nombre, documento, teléfono, dirección. Esto es consistente con el cifrado que ya existe |
| **Normativa** (ASFI, protección de datos, tratamiento de datos personales) | **No verificado en este análisis.** Consultar abogado antes de #6, #7, #13 y de la comparativa entre cuentas |
| **Alucinación** | Respuestas con fuente: cada dato citado enlaza a la gestión o nota de origen. Cifras siempre calculadas por el sistema, nunca «escritas» por el modelo |
| **Costo** | Presupuesto de IA por cuenta y por cobrador, ligado al plan. Medir antes de prometer; el costo por cobrador debe caber en el precio de $12 |
| **Offline** | La IA no puede ser requisito para trabajar. Todo degrada a lo que ya existe |
| **Evaluación** | Ninguna capacidad se activa sin un set de evaluación ejecutado y un criterio de salida |

## 6. Hoja de ruta propuesta

| Fase | Contenido | Condición de salida |
|---|---|---|
| **0 · Fundaciones** | Módulo `ai-gateway`; registro de capacidades por cuenta; seudonimización; registro de uso y de gasto; límites; arnés de evaluación; prueba de cobertura | Ninguna llamada a un modelo fuera del gateway; costo visible por cuenta |
| **Etapa 1 · IA útil desde el primer piloto** | #1 mapeo de importación, #2 resumen del crédito, #3 nota de voz, #4 redacción de mensajes. Diseño detallado: `ia-diseno-etapa-1.md` | Cada capacidad con evaluación aprobada, apagable por cuenta y con indicadores de impacto |
| **Etapa 2 · Basada en resultados reales** | #9 anomalías por reglas verificables, patrones de promesas cumplidas e incumplidas, #6 y #7 probabilidad de recuperación y alerta de mora, #5 consulta en lenguaje natural, #12 pronóstico | Datos suficientes de un piloto real; supera la regla actual en datos reservados; sin sesgo por grupo |
| **Etapa 3 · Optimización de recuperación** | #8 rutas por valor esperado, #11 copiloto del supervisor y reparto de cartera, #10 visión | Supervisores aceptan la mayoría de sugerencias; mejora medible |
| **Fuera del plan actual** | #13 contacto automatizado al deudor | Marco legal resuelto y consentimiento |

La fase 3 depende de **tener usuarios reales**: es una razón más para priorizar
el piloto.

## 7. Cómo presentarlo en la postulación (sin sobrevender)

- Hoy: «Kobrax **captura los datos y resultados** que alimentarán la IA de
  cobranza, con controles de privacidad desde el diseño».
- Hoja de ruta: «Primeras capacidades asistidas por IA, siempre con aprobación
  humana: resumen de crédito, importación inteligente, auditoría de evidencia».
- No decir: «IA predictiva», «scoring», «automatización de cobranza» como
  funcionalidad existente. No existe todavía.

## 8. Cómo se implementa sobre la arquitectura actual

Basado en lo verificado en `backend-modulos-y-reglas.md` y `movil-B`. Es un
diseño propuesto; nada de esto existe aún.

| Pieza | Propuesta | Se apoya en |
|---|---|---|
| **Módulo `ai` en la API** | Único punto que habla con el proveedor. Expone servicios por capacidad (`summarizeCredit`, `mapImportColumns`, `draftMessage`…). El resto del código nunca importa el SDK | Patrón de módulos NestJS existente |
| **Registro de capacidades** | Tabla por cuenta (`account_ai_settings`: capacidad, activa, tope mensual) y chequeo central antes de cada llamada | `common/plan` ya hace `assertRoom` y alertas de uso; reutilizar para topes |
| **Permiso** | Nuevo permiso `ai:use` (y quizá `ai:admin`) en el RBAC | `permission.enum.ts`; recordar que overrides por usuario no tienen código hoy |
| **Seudonimización** | Capa que reemplaza nombre, documento, teléfono, dirección por marcadores y los restituye al mostrar | `CryptoService` y el índice ciego ya separan PII del resto |
| **Registro de uso** | Tabla `ai_usage_log` (cuenta, capacidad, tokens, costo, latencia, resultado), sin contenido con PII | `AuditLog` y su redacción |
| **Trabajos largos** | Hoy los jobs usan `setInterval`, sin cola. Para llamadas lentas conviene una cola real (p. ej. BullMQ sobre el Redis existente) o, al menos, respuesta asíncrona con consulta | Redis ya está en el stack; WebSocket para avisar |
| **Móvil** | Resúmenes: se piden online y se guardan en la tabla `cache` de SQLite (`kind` + `id`). Dictado: lo hace el reconocimiento de voz del teléfono, sin red ni costo; el texto se registra por la cola `mora.activity` existente | `src/db.ts`, `src/sync/queue.ts` |
| **Web** | Botón «Sugerir» / panel lateral en la ficha de mora, siempre con «Aceptar / Editar / Descartar». Para #5, un buscador en el dashboard | Fichas y modales existentes |
| **Evaluación** | Carpeta de casos dorados por capacidad, ejecutada en CI; un cambio de prompt o de modelo no entra si baja el puntaje | Lo que Gallium tiene sin conectar |
| **Datos para ML** | Vista o tabla de «ejemplos» (crédito, contexto al momento de la acción, resultado a N días). Empezar a poblarla ya, aunque no se entrene todavía | `credit_activities`, promesas, pagos |

### Primer paso concreto, de bajo riesgo
1. Crear el módulo `ai` con una sola capacidad: **resumen del crédito** (#2).
2. Con registro de uso, tope por cuenta y apagado desde `/cuenta`.
3. Botón en la ficha de mora web y en la ficha móvil (con caché).
4. Medir costo y utilidad con la cuenta de demo antes de ampliar.

Es pequeño, no toca datos de forma destructiva y deja construido el gateway,
que es lo que luego sostiene todo lo demás.

## 9. Decisiones abiertas

1. ¿Proveedor de modelos y dónde se procesan los datos? (afecta privacidad y costo)
2. ¿Qué presupuesto de IA por cobrador cabe en cada plan?
3. ¿Qué capacidades de IA se incluyen en FREE, si alguna?
4. ¿Se acepta el riesgo regulatorio de #6 y #7 antes de consultar a un abogado?
5. ¿Primer piloto: con qué entidad y cuántos cobradores, para empezar a acumular etiquetas?
