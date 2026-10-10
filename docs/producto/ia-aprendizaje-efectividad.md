# Aprender cuál es la manera más efectiva de cobrar

> Diseño propuesto, 2026-10-10. Amplía la «priorización que aprende» de
> `ventaja-competitiva.md` §10: priorizar decide **a quién** gestionar primero;
> esto decide **cómo** hacerlo. No hay código. Todo lo dicho sobre el estado
> actual se verificó en el repo; lo demás es diseño.

## 1. La pregunta

> Para este tipo de crédito, con este historial, en este momento:
> **¿qué gestión, por qué canal, a qué hora y con qué enfoque es más probable que
> termine en pago?**

Y la pregunta de la agencia: **¿qué hacen mejor mis mejores cobradores y puede
enseñarse al resto?**

## 2. Qué significa «efectivo» (hay que definirlo antes de medir)

Maximizar «lo recuperado» a secas lleva a presionar de más. Se propone medir:

| Medida | Definición | Por qué |
|---|---|---|
| **Promesa obtenida** | La gestión terminó en `PROMISE_TO_PAY` | Resultado inmediato |
| **Promesa cumplida** | La promesa se pagó en la fecha o dentro de un margen | Mide si la promesa era real |
| **Pago en N días** | Hubo pago tras la gestión, dentro de una ventana | El resultado que importa |
| **Esfuerzo** | Gestiones, visitas y km hasta el pago | Una visita cuesta más que un mensaje |
| **Sostenibilidad** | El crédito **no** vuelve a mora en un periodo | Cobrar hoy para que caiga mañana no es efectivo |
| **Fricción** | Rechazos, quejas, contactos fuera de regla | Efectivo sin dañar la relación |

**Efectividad = pago logrado por unidad de esfuerzo, sostenido, sin sobrepasar
los límites de contacto.** Los valores de N y el margen los define la agencia.

## 3. Qué datos hay hoy y qué falta

| Dato | ¿Existe? | Dónde | Para qué sirve |
|---|---|---|---|
| Tipo de gestión (`CALL`, `VISIT`, `MESSAGE`, `NOTE`) | ✅ | `credit_activities.type` | Canal |
| Resultado (`CONTACTED`, `NO_ANSWER`, `PROMISE_TO_PAY`…) | ✅ | `credit_activities.result` | Desenlace inmediato |
| Momento (fecha y hora) | ✅ | `credit_activities.created_at` | Mejor hora y día |
| Promesa y su cumplimiento | ✅ | módulo `mora` | Calidad de la promesa |
| Pagos con fecha | ✅ | `payments` | Desenlace final |
| Episodio de mora y su historial | ✅ | `credit_arrear_episodes` | Unidad de análisis |
| Visita con GPS y hora | ✅ | `field_visits` | Esfuerzo y desplazamiento |
| Autor de la gestión | ✅ | `credit_activities.user_id` | Comparar cobradores |
| Categoría y días de mora, monto | ✅ | crédito, categorías | Segmentación |
| Resultado **esperado** de una gestión agendada | 🟡 | catálogo `EXPECTED_RESULT`, `agenda_items.details` | Comparar plan contra realidad |
| **Qué plantilla de mensaje se usó** | ❌ | no se guarda (no hay rastro en el código) | Aprender qué mensaje funciona |
| **Motivo de no pago** | ❌ | solo `SPECIAL_CATEGORY` (fallecimiento, enfermedad…) en campo | Entender la causa, la señal más valiosa |
| Si el mensaje fue **leído** | ❌ | `wa.me` abre WhatsApp sin confirmación | No medible hoy |
| Intento número N dentro del episodio | 🟡 | derivable contando gestiones | Fatiga y rendimientos decrecientes |
| Costo de la gestión (tiempo, km) | 🟡 | derivable de visitas y rutas | Esfuerzo |

**Conclusión:** ya se puede responder bastante sobre **canal, hora y secuencia**.
Sobre **mensaje y motivo** hay que empezar a capturar **ya**, aunque no se use
todavía: los datos tardan meses en acumularse.

## 4. Cuatro escalones, de menor a mayor

Cada escalón sirve por sí mismo y alimenta al siguiente.

### Escalón 1 — Lo que funcionó (descriptivo; sin IA)
Tablas de efectividad por segmento. Ejemplo de lectura:

> Para créditos de categoría B, la **llamada tras 18:00** obtiene más promesas
> cumplidas que la **visita por la mañana**.

- Se calcula con consultas sobre datos que ya existen.
- Muestra **tamaño de muestra y margen de duda**; con pocos casos dice «no hay
  datos suficientes», no un porcentaje.
- Es lo más defendible ante una entidad: son sus propios números.

### Escalón 2 — Siguiente mejor acción (reglas + estadística)
La ficha del crédito sugiere **una** acción con su motivo:

> «Llamar hoy entre 18:00 y 20:00 — en créditos parecidos, el 2.º intento por
> llamada tras una visita sin contacto es lo que más promesas cumplidas obtuvo.»

- Siempre **una** sugerencia y su porqué; el cobrador la acepta o la ignora.
- Cada vez que acepta, ignora o hace otra cosa, **eso es un dato**.

### Escalón 3 — Experimentos controlados
La observación sola engaña (ver §5). Para saber qué causa mejor resultado hay que
**probar**:

- Entre opciones **igualmente aceptables** (dos plantillas corteses, dos franjas
  horarias razonables), el sistema alterna de forma aleatoria y mide.
- La agencia **activa y delimita** cada experimento; nunca se experimenta con
  algo que pueda perjudicar al deudor.
- Un resultado solo se adopta con evidencia suficiente.

### Escalón 4 — Modelos que aprenden el efecto (más adelante)
Modelos que estiman **cuánto cambia** la probabilidad de pago por una gestión
concreta (no solo quién pagará). Requieren volumen y los experimentos del
escalón 3. **No es lo primero.**

## 5. Los riesgos que invalidan el aprendizaje

| Riesgo | Qué pasa | Cómo se evita |
|---|---|---|
| **Sesgo de selección** | El cobrador visita a quien ya cree que pagará; la visita «parece» más efectiva que la llamada | Comparar dentro de segmentos parecidos; escalón 3 con asignación aleatoria |
| **Pocos datos** | Un cobrador independiente con 20 créditos no genera conclusiones | Mostrar «sin datos suficientes»; referencias agregadas **con consentimiento** |
| **Cambio de contexto** | Lo que funcionó en un mes de aguinaldo no sirve en otro | Ventanas de tiempo y revisión periódica |
| **Premiar la presión** | Optimizar «recuperado» empuja a acoso | Medida de efectividad con fricción y sostenibilidad; límites de contacto inviolables |
| **Sesgo contra personas** | Aprender patrones que discriminan | No usar atributos sensibles ni sus sustitutos; revisar resultados por grupo |
| **Evaluar al cobrador con mala métrica** | Un cobrador con cartera difícil luce «malo» | Comparar contra lo esperable para esa cartera, no contra el promedio |
| **Datos mal capturados** | Resultado puesto al azar para salir del paso | Dictado con sugerencia reduce el esfuerzo; validar contra el comportamiento posterior |

## 6. Qué capturar desde ya (barato y habilita todo lo demás)

| # | Cambio | Esfuerzo | Por qué ahora |
|---|---|---|---|
| L1 | **Guardar la plantilla usada** en cada gestión `MESSAGE` | S | Sin esto no se aprende qué mensaje funciona |
| L2 | **Catálogo `NO_PAYMENT_REASON`** (motivo de no pago: sin ingreso, olvido, disputa, enfermedad, desempleo, cambio de domicilio…) usando el mecanismo de catálogos existente | S | Es la señal más informativa y hoy no existe |
| L3 | **Capturar el motivo con el dictado** (`suggestFromDictation` detecta «dijo que no le pagaron en el trabajo») | S | Cero esfuerzo adicional para el cobrador |
| L4 | **Registrar si la sugerencia se aceptó** (cuando exista) | S | Es la etiqueta de aprendizaje |
| L5 | **Vista de ejemplos** (crédito, contexto al momento, acción, resultado a N días) | M | Base única para análisis y modelos |

L1–L3 son cambios pequeños y **no obligan a usar IA**; sirven también a los
reportes de hoy.

## 7. Cómo se ve para cada usuario

### Cobrador
- En la ficha: una sugerencia de acción con su motivo, no un panel de analítica.
- Tras gestionar: un toque para el motivo (o ya viene del dictado).
- Nada que configurar.

### Supervisor o dueño de agencia
- **«Qué funciona en mi cartera»**: tablas del escalón 1 con su margen de duda.
- **«Qué hacen mejor mis mejores cobradores»**: patrones de gestión (canal,
  hora, secuencia) para compartir, comparados contra cartera equivalente.
- Control de experimentos: qué se prueba, cuánto lleva, qué resultó.

### Entidad mandante (agencia que cobra para un banco)
- En el informe: «estrategia aplicada y su efecto», con números verificables.

## 8. Tenants distintos, aprendizaje distinto

| Perfil | Qué puede aprender | Limitación |
|---|---|---|
| **Trabajo solo** (pocos créditos) | Poco por sí solo; usa referencias | Muestras pequeñas; depende de datos agregados con consentimiento |
| **Tengo equipo** | Escalones 1 y 2; comparar cobradores | Necesita volumen y buena captura |
| **Cobro para una entidad** | Escalones 1–3; experimentos acordados con la entidad | Mayor volumen; requiere acuerdo para experimentar |

El aprendizaje **entre cuentas** es una hipótesis: exige consentimiento,
anonimización y revisión legal. No se debe prometer.

## 9. Orden propuesto

| Paso | Entrega | Necesita |
|---|---|---|
| 1 | L1 + L2 (+ L3 con el dictado) | Un cambio pequeño en móvil y catálogo |
| 2 | Escalón 1: tablas «qué funcionó» para supervisor | Consultas sobre datos existentes |
| 3 | Escalón 2: «siguiente mejor acción» | Datos del paso 1 acumulados y L4 |
| 4 | Escalón 3: experimentos delimitados | Volumen de una agencia y su acuerdo |
| 5 | Escalón 4: modelos de efecto | Todo lo anterior |

El **paso 1 no depende de nada** y es lo único que corre contra el reloj:
cada semana sin capturar es información que no se recupera.

## 10. Decisiones para ti

| # | Decisión | Recomendación |
|---|---|---|
| E1 | ¿Qué cuenta como «pago en N días» y qué margen es «promesa cumplida»? | Que lo fije cada cuenta, con valores por defecto de la agencia piloto |
| E2 | ¿Qué motivos de no pago se ofrecen? | Partir de 8 a 10, validados con cobradores reales; que sea editable por cuenta |
| E3 | ¿Se permite experimentar con asignación aleatoria? | Solo con opción explícita de la cuenta y límites claros |
| E4 | ¿Comparar cobradores entre sí? | Sí, pero contra cartera equivalente y mostrado como aprendizaje, no como ranking |
| E5 | ¿Aprendizaje entre cuentas? | Posponer hasta tener consentimiento y revisión legal |

---

## 11. Motivos de no pago — primera versión con conocimiento de terreno

> Añadido el 2026-10-10 a partir de lo que describió la fundadora, que trabajó
> como cobradora. Es una **versión borrador para validar con 2 o 3 cobradores**,
> no una lista cerrada. Resuelve la decisión E2.

> **Actualizado en §12:** la fuente de ingreso se amplía a **rubro** y **ciclo de ingreso**, se recuperan los motivos «ingreso atrasado», «olvido» y «cambio de teléfono», y se agrega el **perfil de cobro**. Donde §12 y §11.3–11.4 difieran, vale §12.

### 11.1 Lo que dijo, y qué implica para el diseño

| Lo que dijo | Qué implica |
|---|---|
| El motivo depende de **quién es el deudor**: un profesional que perdió el empleo no es lo mismo que un comerciante sin ventas | Los motivos **no son una lista única**: dependen de la **fuente de ingreso** |
| En comerciantes: no hay ventas, hubo **bloqueos**, un accidente | Existe una categoría de **evento externo** que afecta a muchos a la vez |
| **Sobreendeudado**: sacó demasiados créditos | Motivo propio |
| El crédito **lo sacó para otra persona** (pasa bastante) | Motivo propio, y cambia **a quién** hay que cobrar |
| **Cambió de ubicación** (otro departamento) y solo quedó el garante o codeudor | Motivo propio, y aparece la pregunta **«¿quién está pagando?»** |
| A veces **no hay voluntad de pago** | Motivo propio, formulado con neutralidad |

### 11.2 Dos datos distintos, no uno

El texto mezcla dos cosas que conviene separar:

| Dato | Pregunta | Valores |
|---|---|---|
| **Motivo de no pago** | ¿Por qué no pagó? | Ver 11.4 |
| **Quién responde realmente** | ¿Quién está pagando o debería pagar? | Titular · Garante · Codeudor · Persona beneficiaria (tomó el crédito para otro) · Nadie ubicado |

El segundo se apoya en lo que ya existe: los garantes están ligados al crédito
(`credit_guarantors` → `client_relations`), así que «Garante» puede apuntar a una
persona real ya cargada.

### 11.3 Fuente de ingreso: se pregunta una vez

Hoy no existe este dato (verificado). Se captura **una sola vez por cliente o
crédito**, con un toque, y filtra los motivos que se ofrecen:

| Fuente de ingreso | Se ofrecen motivos de… |
|---|---|
| **Asalariado o profesional** | Empleo, ingreso, deudas, titularidad, ubicación, voluntad |
| **Comerciante o productivo** | Ventas, evento externo, deudas, titularidad, ubicación, voluntad |
| **Otro / no sabe** | La lista corta general |

Esto cumple la regla de no complicar: **cada persona ve entre 8 y 10 opciones,
no 20**, y solo las que tienen sentido para ese deudor.

### 11.4 Lista de motivos (borrador)

| Grupo | Motivo (redacción neutra) | Solo si es… |
|---|---|---|
| Capacidad de pago | Perdió el empleo | Asalariado o profesional |
| Capacidad de pago | Ingresos reducidos | Asalariado o profesional |
| Capacidad de pago | Sin ventas o negocio caído | Comerciante o productivo |
| Capacidad de pago | **Evento externo** (bloqueo, paro, accidente, clima) | Comerciante o productivo |
| Capacidad de pago | Problema de salud o fallecimiento en la familia | Todos |
| Endeudamiento | Sobreendeudamiento (varios créditos) | Todos |
| Titularidad | Declara que el crédito fue para otra persona | Todos |
| Ubicación | Cambió de domicilio o de ciudad; no se lo ubica | Todos |
| Voluntad | No manifiesta intención de pago | Todos |
| — | Otro (con nota) | Todos |

Sensibilidad de la redacción: **«para otra persona»** y **«no manifiesta
intención»** son juicios. Se registran como lo que el cliente **declaró** o lo que
el cobrador **observó**, nunca como un hecho. El registro puede llegar a un
informe o a una disputa.

### 11.5 Por qué la categoría «evento externo» es valiosa

Cuando varios créditos de una misma zona comparten el motivo «bloqueo» en las
mismas fechas, **no es un problema de los cobradores ni de los deudores**: es un
evento. Con eso el sistema puede:

- avisar al supervisor: «12 créditos de la zona X reportan bloqueos esta semana»;
- **no penalizar** al cobrador en comparaciones por un periodo así;
- sugerir **reprogramar** en vez de insistir;
- dejarlo documentado para la entidad.

Es una función que ningún competidor de la lista menciona y que se apoya solo en
un campo de selección, sin modelo.

### 11.6 Cómo se captura sin esfuerzo

1. **En la gestión:** campo opcional «Motivo» (un toque, con las opciones
   filtradas por fuente de ingreso).
2. **Con el dictado:** `suggestFromDictation` propone el motivo a partir de frases
   como «se quedó sin trabajo», «hubo bloqueo y no vendió», «el crédito lo sacó
   para su hermano», «se fue a Santa Cruz». Siempre como sugerencia.
3. **Quién responde:** se propone solo cuando se menciona al garante o al
   codeudor.

### 11.7 Lo que el sistema podrá aprender con esto

| Hipótesis a **probar**, no a asumir | Cómo se comprueba |
|---|---|
| Quien perdió el empleo recupera más lento que el comerciante afectado por un evento | Tiempo hasta el pago por motivo |
| Con «sobreendeudamiento» una reestructuración rinde más que insistir | Resultado a N días por tipo de acción y motivo |
| Cuando el crédito fue para otra persona, contactar a la beneficiaria rinde más que al titular | Promesas cumplidas por destinatario |
| Con «cambió de domicilio», pasar al garante o codeudor es lo más efectivo | Pagos tras gestión al garante |

La observación de la fundadora de que el caso del profesional sin empleo «es más
difícil de recuperar» es justamente una hipótesis que el sistema puede
**confirmar con números** de su propia cartera.

### 11.8 Para validar con un cobrador

- ¿Falta algún motivo que oyes seguido?
- ¿Alguno suena distinto en la calle? ¿Cómo lo dice la gente?
- ¿La fuente de ingreso (asalariado, comerciante, otro) alcanza o hay una cuarta?
- ¿Cuánto tarda marcarlo después de una visita? Debe ser un toque, no un paso más.

---

## 12. Rubro, ciclo de ingreso, motivos completos y perfil de cobro

> Añadido el 2026-10-10. Incorpora lo que aportó la fundadora: saber el **rubro**,
> recuperar los motivos «ingreso atrasado», «olvido» y «cambio de teléfono», y
> registrar **cómo conviene cobrar** a cada cliente.

### 12.1 Son tres cosas distintas

| Cosa | Pregunta | Cambia | Ejemplo |
|---|---|---|---|
| **Quién es** (rubro e ingreso) | ¿De qué vive y cuándo le llega el dinero? | Casi nunca | Transportista, ingreso por flete; funcionario, sueldo cada 3 meses |
| **Qué pasó** (motivo) | ¿Por qué no pagó **esta vez**? | Cada gestión | Ingreso atrasado, sin ventas |
| **Cómo cobrarle** (perfil de cobro) | ¿Qué forma y horario funcionan con él? | Rara vez | Cobro diario en el negocio; hay que recoger la cuota |

Mezclarlas llena la gestión de preguntas. Separadas, cada una se pregunta **una
vez** o **solo cuando cambia**.

### 12.2 Rubro e ingreso: qué se registra del cliente

| Campo | Valores | Para qué |
|---|---|---|
| **Fuente de ingreso** | Asalariado o profesional · Comerciante o productivo · Otro | Filtra los motivos que se ofrecen |
| **Rubro** | Catálogo **editable por cuenta**: transportista, funcionario público, comerciante de mercado, productor agrícola, construcción, servicios, profesional independiente, docente… | Entender la cartera y aprender por rubro |
| **Ciclo de ingreso** | Diario · Semanal · Quincenal · Mensual · Trimestral · Por temporada · Irregular | Alinear la fecha de promesa con cuándo realmente le llega el dinero |
| **Día habitual de ingreso** (opcional) | Día del mes o de la semana | Sugerir cuándo gestionar |

**Verificado:** hoy no existe ninguno de estos campos en el cliente. Existe
`metadata` (JSON) como punto de partida, pero lo correcto es un catálogo propio
(el mecanismo de catálogos ya admite tipos nuevos, como `CREDIT_TYPE` o
`WHATSAPP_TEMPLATE`).

### 12.3 Por qué el ciclo de ingreso es lo más útil

- El **funcionario de la alcaldía que cobra cada 3 meses** no es «moroso»: tiene
  un ciclo. Insistir antes de su fecha de cobro no rinde.
- El **transportista al que le atrasan el flete** paga cuando le pagan. Una
  promesa corta alineada a esa fecha tiene probabilidad alta.

El sistema puede, **sin IA**:

1. **Sugerir la fecha de promesa** justo después del próximo ingreso esperado.
2. **Agendar la gestión** para ese día y no antes.
3. **No tratar igual** a un cliente con ciclo trimestral que a uno diario.

Y con datos reales puede **aprender** qué rubros y ciclos cumplen promesas, y con
qué margen.

### 12.4 Motivos de no pago — lista completa (borrador v2)

Reemplaza a §11.4. Cambios: se recupera **ingreso atrasado**, **olvido** y el
**teléfono**.

| Grupo | Motivo (redacción neutra) | Se ofrece a | Qué sugiere hacer |
|---|---|---|---|
| Capacidad de pago | Perdió el empleo | Asalariado o profesional | Más difícil de recuperar; evaluar plazo o reestructura |
| Capacidad de pago | Ingresos reducidos | Todos | Revisar monto de cuota o plan |
| Capacidad de pago | Sin ventas o negocio caído | Comerciante o productivo | Seguimiento corto; revisar actividad |
| Capacidad de pago | **Evento externo** (bloqueo, paro, accidente, clima) | Comerciante o productivo | Reprogramar; avisar al supervisor si se repite en la zona |
| Capacidad de pago | Problema de salud o fallecimiento en la familia | Todos | Trato sensible; no presionar |
| **Timing del ingreso** | **Ingreso atrasado** (le pagan tarde) | Todos | **Pagará al cobrar:** promesa corta alineada a esa fecha; pide la **fecha esperada de ingreso** |
| Endeudamiento | Sobreendeudamiento | Todos | Conversar un plan realista |
| Titularidad | Declara que el crédito fue para otra persona | Todos | Preguntar quién responde realmente |
| Ubicación | **Cambió de domicilio o de teléfono**; no se lo ubica | Todos | **Ubicarlo de nuevo:** actualizar datos; consultar a garante o contactos |
| Descuido | **Olvido o descuido** | Todos | Basta un recordatorio; no enviar al cobrador (es poco frecuente) |
| Voluntad | No manifiesta intención de pago | Todos | Escalar al supervisor |
| — | Otro (con nota) | Todos | — |

Notas:
- **«Ingreso atrasado» pide un segundo dato opcional:** la fecha esperada de
  ingreso. Es lo que convierte el motivo en una fecha de promesa útil.
- **«Cambió de domicilio o de teléfono» dispara una acción:** ofrecer en el mismo
  momento «actualizar dirección o teléfono», que ya existen en la ficha del
  cliente. Si no se actualiza, el dato malo vuelve a hacer perder una visita.
- La columna «Qué sugiere hacer» es **texto de ayuda editable**, no una regla. Es
  la hipótesis de la fundadora; el sistema puede confirmarla o corregirla.

### 12.5 Perfil de cobro: «cómo hay que cobrarle»

Lo que mencionaste —cobrar **todos los días en el negocio** o **recoger la
cuota porque no tiene tiempo**— es información práctica que hoy se pierde en la
memoria del cobrador. Se propone un perfil corto por cliente (o por ubicación):

| Campo | Valores | Ejemplo |
|---|---|---|
| **Modalidad** | Visita en el negocio · Visita en el domicilio · Recoger la cuota · Paga él en oficina · Transferencia o QR | «Recoger la cuota» |
| **Frecuencia** | Diaria · Semanal · Según calendario de cuotas | «Todos los días» |
| **Horario** | Franja o rango | «Mañana, antes de abrir» |
| **Quién entrega** | El titular · Un familiar · Un empleado | «Su hijo en el negocio» |
| **Nota** | Texto corto | «Tocar el portón verde» |

**Verificado:** ya existen campos para esto y ninguna pantalla los usa.

| Campo existente | Dónde | Estado |
|---|---|---|
| `visitSchedule` (JSON, por ubicación) | `client_locations`; solo se escribe al agregar una ubicación: el alta atómica lo descarta, no se puede editar y ningún endpoint lo devuelve | Sin UI; **requiere cambios de API primero** (ver F4/13 E2) |
| `preferredContactChannel` | `clients`; en API, tipos y seeds | Sin UI en web ni móvil |
| `referenceNotes` (indicaciones del lugar) | `client_locations` | Existe |

El campo existe en la base, pero la API solo lo escribe al agregar una ubicación;
exponerlo exige primero cambios de API (ver `docs/epics/F4/13-capa-datos-ia-plan.md`, E2).

### 12.6 Qué desbloquea el perfil de cobro

| Para… | Se logra |
|---|---|
| **El cobrador** | Ve en la parada «cobrar en el negocio por la mañana; recoger la cuota» sin recordarlo |
| **El planificador de rutas** | Respeta el horario de cada cliente al ordenar paradas |
| **La agenda** | Una gestión recurrente para el cliente de cobro diario (**no verifiqué si la agenda soporta repetición**) |
| **El supervisor** | Detecta la cartera de cobro diario, que consume mucho tiempo, y la asigna mejor |
| **El aprendizaje** | La modalidad deja de ser un factor oculto que confunde el análisis de efectividad |

### 12.7 Cómo se captura sin complicar

| Dato | Cuándo se pregunta | Esfuerzo del cobrador |
|---|---|---|
| Fuente de ingreso, rubro, ciclo | **Una vez**, al alta del cliente o en su primera gestión | 3 toques, una sola vez |
| Motivo | Al cerrar una gestión sin pago | 1 toque, o lo propone el dictado |
| Fecha esperada de ingreso | Solo si el motivo es «ingreso atrasado» | 1 selección de fecha |
| Perfil de cobro | Una vez, o cuando el cliente lo dice | 1 pantalla corta; el dictado puede proponerlo |

Con **dictado**, frases como «cobra cada tres meses», «hay que ir todos los días
a su negocio», «no tiene tiempo, mejor recoger la cuota» llenan estos campos
como **sugerencias**, igual que el resultado de la gestión.

### 12.8 Por verificar antes de construir

- Dónde guardar rubro, ciclo y fuente de ingreso: ¿cliente o crédito? Un mismo
  cliente puede tener un crédito productivo y uno de consumo. **No verificado.**
- Si la **importación** de cartera trae alguno de estos datos (por ejemplo el
  tipo de crédito) para precargarlos. **No verificado.**
- Si la **agenda** soporta gestiones recurrentes. **No verificado.**
- Cómo viajan los campos nuevos en la caché offline del cliente.

### 12.9 Orden propuesto (actualiza §9)

| Paso | Entrega | Esfuerzo |
|---|---|---|
| 1 | Perfil de cobro: pantalla corta sobre `visitSchedule` y `preferredContactChannel` | S |
| 2 | Catálogos de rubro y de motivos; campos de fuente de ingreso y ciclo | S-M |
| 3 | Motivo en la gestión + «fecha esperada de ingreso» + acción «actualizar teléfono o domicilio» | S-M |
| 4 | Fecha de promesa sugerida según el ciclo de ingreso | S |
| 5 | Dictado que sugiere motivo y perfil | S |
| 6 | Tablas «qué funcionó» por rubro, ciclo y motivo | M |

Los pasos 1 a 4 **no necesitan IA** y ya mejoran el trabajo diario.

### 12.10 Para validar con cobradores

- ¿Qué otros rubros se repiten en la cartera, además de transportista,
  funcionario y comerciante?
- ¿Hay ciclos que no están en la lista (por ejemplo, ingreso por cosecha)?
- ¿Cuáles modalidades de cobro de esta lista se usan, y cuáles faltan?
- ¿El perfil de cobro es del cliente o de cada ubicación? (un comerciante tiene
  negocio y domicilio)
