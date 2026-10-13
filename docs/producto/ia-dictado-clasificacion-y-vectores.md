# Dictado multi-tema, redacción enfocada y vectorización

> Diseño propuesto, 2026-10-10. Complementa `ia-plan-maestro.md` (C1, C2, C5),
> `ia-diseno-etapa-1.md` §4 e `ia-memoria-y-contexto.md`. No hay código; lo dicho
> del estado actual se verificó en el repo.

## 1. Lo que se quiere

1. Que al **dictar varias cosas juntas** (en la visita o en cualquier momento) la
   IA **clasifique** cada una y la ponga en su lugar.
2. Que mejore la **redacción** para que lo que se guarda sea claro, enfocado y
   profesional.
3. Que funcione **aunque haya pocos datos**.
4. Evaluar la **vectorización** de datos.

## 2. Por qué funciona con pocos datos

Clasificar un texto en categorías conocidas **no necesita entrenar nada**: un
modelo de lenguaje puede hacerlo «de cero» (*zero-shot*) si se le dan las
categorías y sus definiciones. Las categorías ya existen en Kobrax:

| Categoría | Fuente en Kobrax |
|---|---|
| Tipo y resultado de la gestión | `RECOVERY_RESULTS_BY_TYPE` (`recovery-activity.ts`) |
| Promesa de pago | Estructura de promesa existente |
| Motivo de no pago | Catálogo `NO_PAYMENT_REASON` (por crear) |
| Rubro y ciclo de ingreso | Catálogos `OCCUPATION`, `INCOME_SOURCE` (por crear) |
| Perfil de cobro | `visit_schedule` y `COLLECTION_MODALITY` |
| Datos de contacto | Contactos y ubicaciones del cliente |

La **memoria** (`ia-memoria-y-contexto.md`) mejora la precisión con el uso, pero
**no es condición** para empezar. Con una cuenta nueva y vacía, el clasificador
ya funciona con las definiciones del catálogo.

## 3. El dictado multi-tema

### 3.1 Ejemplo

> «Fui al negocio, no estaba, hablé con su hijo, dice que el papá cobra el
> viernes. Prometió trescientos para el sábado. Me dijo que se cambió de
> teléfono, ahora es 7 1 2 3 4 5 6 7, y que el local abre a las ocho.»

### 3.2 Qué produce: tarjetas de propuesta

| # | Tarjeta | Contenido propuesto | Frase de origen |
|---|---|---|---|
| 1 | **Gestión** | Visita · contacto con tercero (familiar) | «fui al negocio… hablé con su hijo» |
| 2 | **Motivo** | Ingreso atrasado · fecha esperada: viernes | «el papá cobra el viernes» |
| 3 | **Promesa** | 300 · sábado | «prometió trescientos para el sábado» |
| 4 | **Contacto nuevo** | Teléfono 7 1 2 3 4 5 6 7 → **actualizar** | «se cambió de teléfono» |
| 5 | **Perfil de cobro** | Horario: abre a las 8:00 | «el local abre a las ocho» |
| 6 | **Nota** | Redacción enfocada (ver §4) | — |

Cada tarjeta se acepta, se edita o se descarta por separado. Lo aceptado se
guarda por los caminos de siempre (gestión, actualización del cliente, perfil).

### 3.3 Un hueco que aparece al clasificar

La gestión del ejemplo es un **contacto con un tercero**, no con el deudor. Los
resultados actuales (`CONTACTED`, `NO_ANSWER`, `NOT_FOUND`, `REFUSAL`…) no
distinguen **con quién** se habló. Se propone `contact_party` (`HOLDER`,
`FAMILY`, `EMPLOYEE`, `GUARANTOR`, `OTHER`), que además alimenta el dato
«quién responde realmente» del plan maestro (A4).

### 3.4 Dos esquemas que hay que mapear

| Dónde se registra | Esquema | Pantalla |
|---|---|---|
| Parada de una ruta | Resultado de **visita** (`VisitOutcome`, evidencias) | `rutas/resultado.tsx` |
| Ficha de mora y agenda | **Gestión** (`RecoveryActivityInput`) | `gestion-sheet`, `agenda-register` |

El clasificador debe producir el esquema correcto según el contexto. El mapeo
exacto entre ambos **no está verificado** y es un trabajo previo.

## 4. Redacción enfocada

### 4.1 Para qué

El texto que se guarda llega a **informes a la entidad**, a veces a disputas y a
la revisión del supervisor. Hoy es lo que el cobrador escribió con prisa.

| Entrada (dictado) | Salida (nota guardada) |
|---|---|
| «Ese señor es un mentiroso, siempre dice que va a pagar y no paga, fui como tres veces y su hijo me dijo que mañana» | «Visita en el negocio. Atendió un familiar, quien indicó que el titular pagaría mañana. Tercer intento sin pago.» |
| «La señora está mal de salud, tiene cáncer, no puede trabajar» | «Titular declara imposibilidad de trabajar por motivo de salud.» **y** motivo = *Salud o fallecimiento* |

### 4.2 Reglas de redacción

| Regla | Efecto |
|---|---|
| **Objetiva y neutra** | Sin insultos, juicios ni adjetivos sobre la persona |
| **Atribuida** | «el cliente indicó que…», «se observó que…»: distingue lo dicho de lo observado |
| **Concisa** | Respeta el máximo existente (`RECOVERY_NOTES_MAX_LENGTH` = 1000) |
| **Sin duplicar lo ya estructurado** | Lo que quedó en motivo, promesa o contacto no se repite en la nota |
| **Minimización** | Datos sensibles innecesarios (diagnósticos, detalles familiares) se sustituyen por la categoría |
| **Sin inventar** | Nunca añade hechos que no se dijeron |

### 4.3 Control

- Se muestra **original y propuesta** lado a lado; la persona elige.
- Por defecto se guarda **solo la nota confirmada**. Conservar el dictado original
  es **opcional y con vencimiento** (decisión pendiente, §9).
- Una comprobación automática verifica que **toda cifra y fecha** de la salida
  estaba en la entrada.

## 5. Cómo se ejecuta: por etapas, sin exponer datos

| Etapa | Qué hace | Modelo | Datos personales |
|---|---|---|---|
| **1 · Segmentar y extraer con reglas** | Divide por frases; detecta teléfonos, montos, fechas, días, palabras clave y sinónimos del catálogo | No | Se quedan en el dispositivo |
| **2 · Clasificar** | Asigna cada fragmento a una categoría; resuelve ambigüedades | Sí, opcional | Solo texto **ya seudonimizado**; teléfonos y documentos ya fueron extraídos por reglas |
| **3 · Redactar** | Escribe la nota enfocada | Sí, opcional | Igual |
| **4 · Validar** | Pasa por `validateRecoveryActivity` y por la comprobación de cifras | No | — |

**Sin proveedor o sin opción activada**, las etapas 1 y 4 siguen dando
propuestas útiles (resultado, promesa, teléfono, horario). La nota quedaría con
el texto dictado, ligeramente limpio por reglas.

**Límite que hay que decir:** los **nombres propios** en el dictado («hablé con
Juan») no los detectan reglas simples y el modelo los vería. Mitigaciones: guiar
al cobrador a decir **la relación** («su hijo») y no el nombre; mantener la etapa
con modelo **apagada por defecto** (texto libre = clase P4 del plan maestro);
evaluar un modelo local o dentro del propio servidor.

## 6. Qué es la vectorización y para qué sirve aquí

Convertir un texto en una **lista de números** (vector) tal que textos de
significado parecido queden cerca. Permite buscar **por significado**, no por
palabras exactas.

### 6.1 Usos posibles en Kobrax, ordenados por valor

| # | Uso | Qué resuelve | ¿Necesita vectores? |
|---|---|---|---|
| V1 | **Clasificar frases al catálogo** («micrero» → transportista; «se fue a Santa Cruz» → cambio de domicilio) | Reconocer variantes sin lista exacta | Ayuda; con pocos datos basta el modelo de lenguaje |
| V2 | **Recuperar ejemplos parecidos** para el contexto (memoria M4) | Que el modelo vea correcciones previas relevantes | Útil cuando los ejemplos superan lo que cabe en un contexto |
| V3 | **Mapear encabezados de importación** («F. Vencim.» ≈ «fecha de vencimiento») | Archivos de formatos nuevos | Ayuda; el modelo también lo resuelve |
| V4 | **Casos parecidos** para proponer la siguiente acción | Aprender de resultados similares | Las **claves estructuradas** (rubro, ciclo, categoría) ya cubren la mayor parte |
| V5 | **Deduplicar nombres y direcciones** | Evitar clientes repetidos | **No**: es mejor similitud textual clásica; ya existen `name-search.ts` y `tokenize.ts` |

### 6.2 Qué **no** conviene vectorizar

- **Identificantes** (nombres, documentos, teléfonos, direcciones): clase P3. Los
  vectores **conservan información** y pueden permitir reconstruir el texto
  original en ciertos casos; se tratan con el mismo nivel que el texto fuente.
- Notas libres **sin seudonimizar**.
- Montos y fechas (para eso hay consultas exactas).

### 6.3 Dónde guardarlos: opciones

| Opción | Cómo | Ventajas | Inconvenientes |
|---|---|---|---|
| **A · pgvector** | Extensión de PostgreSQL | Búsqueda en la propia base, con RLS por cuenta | **La base actual es `postgres:15-alpine` estándar, sin pgvector** (verificado): requiere cambiar la imagen o el servicio gestionado; Prisma lo trata como tipo no soportado y se usan consultas SQL directas |
| **B · Vectores en PostgreSQL como arreglo + comparación en la aplicación** | Columna de números; se compara en memoria por cuenta | Sin infraestructura nueva | Adecuado solo mientras el corpus **por cuenta** sea pequeño; **no medido** |
| **C · Servicio de vectores aparte** | Base vectorial externa | Escala | Otro sistema que operar y asegurar; datos fuera de la base |
| **D · No vectorizar todavía** | Claves + modelo de lenguaje | Cero | Pierde la recuperación por significado |

### 6.4 De dónde salen los vectores

| Opción | Detalle | Cuidado |
|---|---|---|
| Servicio del proveedor de modelos | Fácil, buena calidad | Cada texto sale a un tercero: solo **texto seudonimizado o de catálogo** |
| Modelo de vectores propio en el servidor | El dato no sale | Operarlo; **calidad en español de Bolivia no verificada** |

## 7. Recomendación sobre vectores

**No empezar por vectores.** Con pocos datos aportan poco, y lo que se quiere
conseguir ahora (clasificar y redactar) lo hace el modelo de lenguaje con las
definiciones del catálogo.

| Fase | Qué se usa |
|---|---|
| **Ahora** | Sinónimos del catálogo + clasificación *zero-shot* + claves estructuradas |
| **Cuando la memoria crezca** | Vectores para V1–V3 sobre **frases de catálogo y glosario** (texto no identificante): opción B, o A si la imagen de la base cambia por otras razones |
| **Si se justifica** | V2 con ejemplos seudonimizados |

**Condición para dar el paso:** que el glosario y los ejemplos de una cuenta
**no quepan** en el contexto de una consulta, o que las claves no encuentren el
caso. Hasta entonces es complejidad sin beneficio medible.

## 8. Orden de construcción

| Paso | Entrega | Esfuerzo |
|---|---|---|
| 1 | Segmentador y extractor por reglas (etapa 1) | M |
| 2 | Validador de cifras y de esquema (etapa 4) | S |
| 3 | Tarjetas de propuesta en móvil: gestión, motivo, promesa, contacto, perfil | M |
| 4 | `contact_party` y mapeo visita ↔ gestión | S-M |
| 5 | Clasificación *zero-shot* con modelo (etapa 2) | M |
| 6 | Redacción enfocada (etapa 3), con original y propuesta lado a lado | M |
| 7 | Evaluación con frases reales de cobradores | M |
| 8 | Medir si conviene vectorizar (§7) | S |

## 9. Por verificar

1. Mapeo exacto entre el resultado de visita (`VisitOutcome`) y la gestión.
2. Calidad del dictado y de la clasificación **con acento y ruido reales**.
3. Qué hace el modelo con **números dichos en palabras** y con teléfonos
   dictados dígito por dígito.
4. ¿Se conserva el dictado original, y por cuánto tiempo?
5. Tamaño real de glosario y ejemplos por cuenta, para decidir vectores.

## 10. Decisiones para ti

| # | Decisión | Mi recomendación |
|---|---|---|
| D1 | ¿Se guarda el dictado original además de la nota confirmada? | No por defecto; opción con vencimiento corto |
| D2 | ¿La redacción enfocada puede omitir datos sensibles y pasarlos a una categoría? | Sí, mostrando siempre la diferencia |
| D3 | ¿Empezar con vectores o sin ellos? | **Sin ellos**; reevaluar cuando la memoria lo pida |
| D4 | ¿Guiar al cobrador a decir la relación y no el nombre? | Sí; es la mitigación más barata para los nombres propios |
| D5 | ¿La clasificación con modelo queda apagada por defecto? | Sí, con opción por cuenta |
