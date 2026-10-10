# Memoria y contexto especializado — aprender sin entrenar un modelo

> Diseño propuesto, 2026-10-10. Complementa `ia-plan-maestro.md` (§4.3 y §5).
> No hay código. Lo dicho sobre el estado actual se verificó en el repo.

## 1. El planteamiento

> Que Kobrax no vuelva a preguntarle al modelo lo que ya sabe, que aprenda de
> cada corrección, y que lo haga **sin crear un modelo de machine learning
> propio**: especializando el **contexto**, no el modelo.

| Enfoque | Qué se especializa | Costo | Reversible | Auditable |
|---|---|---|---|---|
| Entrenar o ajustar un modelo propio | Los pesos del modelo | Alto | No | Difícil |
| **Especializar el contexto (este diseño)** | Lo que se le entrega al modelo en cada consulta | Bajo | **Sí** | **Sí** |

El «aprendizaje» es **escribir y mantener conocimiento** en tablas de Kobrax; el
modelo de lenguaje sigue siendo un componente intercambiable que recibe ese
conocimiento como contexto.

## 2. Las seis memorias

| # | Memoria | Qué guarda | Dónde vive | Ejemplo |
|---|---|---|---|---|
| M1 | **Respuestas** | Salidas ya calculadas para entradas idénticas | Redis (ya existe), con vencimiento | El resumen de un crédito que no cambió |
| M2 | **Hechos derivados** | Agregados y resúmenes mantenidos de forma incremental | Postgres | Resumen vivo del crédito; tasa de promesas cumplidas por rubro |
| M3 | **Glosario** | Palabras y frases del negocio de esa cuenta | Catálogos y memoria | «micrero» → transportista; «se fue a Santa Cruz» → cambio de domicilio |
| M4 | **Ejemplos aprobados** | Pares entrada→salida que la persona aceptó o corrigió | Postgres | La descripción «chofer de turno noche» con los campos que se confirmaron |
| M5 | **Reglas del negocio** | Políticas explícitas de la cuenta | Postgres | «No contactar domingos», «máximo 3 contactos por semana» |
| M6 | **Formatos conocidos** | Huella de un archivo y su mapeo ya confirmado | Postgres | Las columnas del reporte de la entidad X |

## 3. Cómo se decide si hace falta preguntar al modelo

Una escalera: se baja un peldaño solo si el anterior no resolvió.

```
1. ¿Lo resuelve una regla determinista?        → sí: responder, sin modelo
2. ¿Hay una respuesta vigente en caché (M1)?    → sí: responder
3. ¿La memoria contiene la respuesta (M3–M6)?   → sí: responder y citar
4. Preguntar al modelo con contexto armado
   → guardar la respuesta (M1) y esperar el veredicto de la persona (§5)
```

**Métrica de madurez:** el porcentaje de peticiones resueltas **sin llamar al
modelo**. Debe subir con el uso; si no sube, la memoria no está aprendiendo.

## 4. El ensamblador de contexto

Es la pieza que convierte «preguntar a un modelo» en «preguntar a un modelo que
conoce este negocio». Para cada consulta arma, en este orden y dentro de un
presupuesto de tamaño:

| Bloque | Origen | Siempre |
|---|---|---|
| 1. Instrucciones de la capacidad y formato de salida | Código versionado | Sí |
| 2. **Reglas de la cuenta** (M5) | Memoria activa | Sí, las relevantes |
| 3. **Glosario** relevante (M3) | Memoria activa + catálogos | Sí |
| 4. **Ejemplos aprobados** parecidos (M4) | Los K más cercanos por clave | Sí |
| 5. **Hechos del caso** (M2) | Datos del crédito o cliente, ya seudonimizados | Sí |
| 6. La pregunta o el texto de la persona | Entrada | Sí |

Reglas: **solo** entra memoria activa y del mismo `account_id`; cada bloque
registra qué entradas usó (para explicar y para depurar); y cuando no cabe todo,
se recortan primero los ejemplos, luego el glosario, nunca las reglas ni los hechos.

## 5. El ciclo de aprendizaje

```
Sugerencia → veredicto (aceptó / corrigió / ignoró) → candidato de memoria
          → confirmaciones → memoria activa → mejor sugerencia
```

### 5.1 Qué señal genera cada acción

| Acción de la persona | Señal | Posible memoria |
|---|---|---|
| Aceptó tal cual | Confirmación | Refuerza el ejemplo (M4) o el glosario (M3) |
| Corrigió un campo | **Corrección** (la más valiosa) | Ejemplo con la salida correcta; nuevo sinónimo |
| Ignoró | Débil | Reduce la confianza de esa sugerencia |
| El resultado posterior se cumplió o no | Desenlace | Estadística derivada (M2) |
| Confirmó un mapeo de importación | Formato | Entrada M6 |

### 5.2 Para no aprender de un error

- **Estado de candidato:** una corrección no es regla hasta confirmarse. El
  número de confirmaciones necesarias es configurable y **se calibra con el piloto**.
- **Revisión opcional:** las reglas y el glosario nuevos pueden requerir aprobación
  de un administrador de la cuenta antes de activarse.
- **Vencimiento:** toda entrada tiene vigencia y se degrada si deja de confirmarse.
- **Conflicto:** si dos entradas se contradicen, gana la más reciente y confirmada
  y la otra queda marcada, no se borra en silencio.
- **Anti-envenenamiento:** el texto libre de notas o audios **nunca se promueve a
  instrucción**. Solo se promueven campos estructurados y validados.

## 6. Qué aprende cada función

| Función | Qué recuerda | Efecto visible |
|---|---|---|
| **Importación (C4)** | Huella de columnas → mapeo confirmado (M6) | El siguiente archivo de la misma entidad se mapea **al instante, sin modelo** |
| **Descripción del cliente (C1)** | Sinónimos de rubro aceptados (M3) | La etapa de reglas entiende cada vez más sin IA |
| **Dictado (C2)** | Frases frecuentes → motivo o resultado (M3, M4) | Menos correcciones con el tiempo |
| **Resumen del crédito (C3)** | Resumen vivo actualizado incrementalmente (M2) | No se vuelve a leer todo el historial |
| **Mensajes (C5)** | Plantillas y tono que cada cobrador acepta (M4) | Sugerencias en su estilo |
| **Consultas al negocio (C9)** | Preguntas frecuentes guardadas (M1, M2) | Respuesta inmediata y a costo cero |
| **Rutas y agenda** | Tiempos reales por zona y rubro (M2) | Estimaciones más realistas |
| **«Qué funcionó» (B9)** | Tasas por segmento (M2) | Tablas que mejoran con cada cierre |

## 7. Modelo de datos propuesto

Todas con `account_id` y RLS, como toda tabla operativa de Kobrax.

| Tabla | Para qué | Campos principales |
|---|---|---|
| `ai_memory_entries` | Conocimiento durable (M2–M6) | `scope` (cuenta, usuario, cliente, crédito, zona, formato), `kind`, `key`, `value`, `status` (candidato, activa, rechazada, vencida), `support_count`, `confidence`, `valid_until`, `origin`, `reviewed_by`, `version` |
| `ai_feedback` | Cada veredicto | Sugerencia, capacidad, versión de prompt, veredicto, **diferencia** entre lo propuesto y lo final, desenlace posterior |
| `ai_memory_usage` | Qué memoria alimentó cada respuesta | Respuesta, entradas usadas |
| M1 (respuestas) | Caché | **Redis** con clave = capacidad + versión de prompt + huella de los hechos, y vencimiento |

**Verificado:** Redis ya está en el stack (guardia de límites y sesiones), así
que la caché no exige infraestructura nueva. La base es `postgres:15-alpine`
estándar, **sin pgvector**.

## 8. Recuperación: por claves primero, similitud después

| Estrategia | Cuándo | Costo |
|---|---|---|
| **Por clave estructurada** (segmento, rubro, zona, categoría de mora, formato) | Casi siempre | Bajo; determinista; explicable |
| **Por similitud de texto** (embeddings) | Solo para texto libre que las claves no cubren | Requiere cambiar la imagen de PostgreSQL o un servicio aparte; **no verificado** que convenga |

Recomendación: empezar solo por claves. Resuelve glosario, formatos, reglas,
segmentos y la mayoría de ejemplos. Se evalúa la similitud cuando haya evidencia
de que las claves no alcanzan.

## 9. Seguridad y privacidad de la memoria

La memoria **es dato del cliente**, así que hereda todos los controles y suma los
suyos.

| Riesgo | Control |
|---|---|
| Fuga entre cuentas | `account_id` + RLS; **nada se comparte entre cuentas por defecto** |
| Identificantes guardados en memoria | Se guardan **claves y formas**, no valores personales; resúmenes en forma seudonimizada y restituidos al mostrar |
| Derecho a que se olvide | Borrar las entradas del cliente o del crédito es una consulta, no «desaprender un modelo» |
| Conocimiento erróneo que se perpetúa | Candidatos, revisión, vencimiento, versión y reversión |
| Memoria que nadie ve | **Pantalla «Lo que Kobrax aprendió de tu operación»**: lista, edita, desactiva y borra |
| Cambio de proveedor de modelos | La memoria es de Kobrax y portable; el proveedor solo recibe contexto |
| Memoria obsoleta por cambio de reglas | Versión de política; cambiar una regla invalida lo dependiente |

La pantalla de memoria es además un **rasgo de confianza**: la agencia ve y
controla qué «sabe» el sistema, algo que no ofrece un modelo opaco.

## 10. Frente a un modelo de ML propio

| Aspecto | Contexto especializado (este plan) | Modelo de ML propio |
|---|---|---|
| Cuándo da valor | **Desde el primer día** | Tras acumular volumen |
| Cambiar de proveedor de IA | Trivial | Reentrenar |
| Explicar una respuesta | Se muestran las entradas usadas | Difícil |
| Corregir un error | Editar una entrada | Reentrenar |
| Aislamiento por cuenta | Natural | Complejo |
| Predicción cuantitativa (probabilidad de pago) | **No la reemplaza** | Su ventaja |
| Costo recurrente por llamada | Sí, mitigado por caché y memoria | Costo de entrenamiento y operación |

**Límite honesto:** el contexto especializado hace que un modelo de lenguaje sea
más preciso y consistente en el vocabulario y las reglas del negocio. **No crea
capacidad predictiva** sobre quién pagará; eso sigue necesitando estadística o
ML con datos reales (C10–C14 del plan maestro). Las dos cosas se complementan:
estadísticas simples en M2 cubren mucho antes de necesitar un modelo.

## 11. Lecciones de Gallium que se aplican

Del repo de referencia:

- **La caché semántica de reportes se eliminó** (commit `ed9c8763`): una caché
  que devuelve un informe viejo es peor que no tener caché. Aquí la clave incluye
  la **huella de los hechos**, así que un cambio de datos invalida la respuesta.
- **Las evaluaciones existían sin conectarse a nada.** Aquí, cada corrección
  aceptada **alimenta el conjunto de pruebas** de esa capacidad.
- **Una función sin control saltaba el gasto.** La memoria y la caché pasan por
  el mismo `ai-gateway`; no hay camino lateral.

## 12. Orden de construcción

| Paso | Entrega | Depende de | Esfuerzo |
|---|---|---|---|
| 1 | **M6** memoria de formatos de importación | Gateway | S-M |
| 2 | **M1** caché con huella de hechos | Gateway | S |
| 3 | `ai_feedback` + captura de veredictos en cada función | Funciones C1–C5 | M |
| 4 | **M3** glosario que crece con las correcciones aceptadas | 3 | M |
| 5 | **M5** reglas de la cuenta inyectadas en el contexto | Gateway | S-M |
| 6 | **M2** resumen vivo del crédito y estadísticas por segmento | Capa A del plan maestro | M |
| 7 | **M4** ejemplos aprobados en el contexto | 3 | M |
| 8 | Pantalla «Lo que Kobrax aprendió» | 3–7 | M |

El **paso 1 da el efecto más visible con el menor esfuerzo**: «el segundo archivo
de esa entidad se importa solo».

## 13. Métricas

| Métrica | Qué dice |
|---|---|
| % de peticiones resueltas sin modelo | Madurez de la memoria |
| Tasa de aceptación de sugerencias, por función y en el tiempo | Si mejora |
| Tasa de corrección por campo | Dónde falla |
| Costo por cuenta y por cobrador | Efecto de caché y memoria |
| Entradas candidatas → activas → vencidas | Salud de la memoria |

## 14. Por verificar

1. ¿Cuántas confirmaciones convierten un candidato en memoria activa? (piloto)
2. ¿Las reglas nuevas requieren aprobación de un administrador, siempre o
   configurable?
3. ¿La memoria de **usuario** (estilo de cada cobrador) es útil o añade ruido?
4. ¿Hace falta similitud de texto o bastan las claves?
5. Política de retención y de borrado ante la baja de un cliente.
6. ¿Qué parte de la memoria puede tener un valor semilla común a todas las
   cuentas, **curado a mano** y no extraído de datos de otros clientes?

## 15. Decisiones

| # | Decisión | Resolución | Estado |
|---|---|---|---|
| K1 | ¿El «aprendizaje» es memoria y contexto, sin modelo propio? | Sí; es lo que se puede construir y explicar ahora | **Aprobada 2026-10-10** |
| K2 | ¿Empezar por la memoria de formatos de importación? | Sí: mayor efecto con menor esfuerzo | **Aprobada 2026-10-10** |
| K3 | ¿Las reglas aprendidas requieren aprobación del administrador? | Sí por defecto; configurable por cuenta | **Aprobada 2026-10-10** |
| K4 | ¿Se muestra la pantalla «Lo que Kobrax aprendió»? | Sí; es control y confianza | **Aprobada 2026-10-10** |
| K5 | ¿Aprendizaje entre cuentas? | No por ahora; solo valores semilla curados a mano | **Aprobada 2026-10-10** |

Registro general de decisiones de IA: `ia-plan-maestro.md` §15.
