# Ventaja competitiva de Kobrax — funciones que se usan y simplifican

> Análisis del 2026-10-10. Contrasta la lista de competidores que compartiste
> contra lo que Kobrax **realmente hace hoy** (`docs/producto/`, verificado en
> código). Es una propuesta para validar con cobradores y agencias reales antes
> de construir.
>
> **Sobre los competidores:** las funciones que se les atribuyen vienen de la
> investigación que compartiste; no las verifiqué en sus productos. Dos puntos
> débiles: BDP Recupera aparece «por validar», y las tablas no son una auditoría.
> Recomiendo probar tú misma las versiones de prueba de AtllasPay, CarteraGo y
> CobrApp antes de afirmar nada frente a un evaluador.

## 1. Dónde está parado Kobrax

Los competidores se agrupan en dos mundos:

| Mundo | Quiénes | Qué resuelven bien | Dónde dejan espacio |
|---|---|---|---|
| **Bancos y core financiero** | Cobranza Digital Fortaleza, CIRRUS Collections, BDP Recupera | Segmentación por calificación y previsión, reportes gerenciales, integración con el core | Pensados para la propia entidad; venta e implementación pesadas; no son un SaaS para una agencia pequeña |
| **Prestamista y cobro cotidiano** | AtllasPay, CarteraGo, CobrApp, Geo Cash | Préstamo propio, cuotas, **caja**, recibos, GPS, offline, migración desde Excel | Orientados al que **presta y cobra lo suyo**; no a recuperar **mora de cartera ajena** con prueba |

**El espacio de Kobrax:** la **gestión de mora sobre cartera que llega de una
entidad** (agencias de cobranza, cooperativas, financieras pequeñas), con
**prueba verificable** de lo que se hizo. Ni los sistemas bancarios (demasiado
grandes) ni las herramientas de prestamista (otro problema) lo cubren, según lo
que compartiste.

## 2. Mapa de paridad: dónde igualas, dónde ganas, dónde te falta

| Capacidad | Kobrax hoy | Frente a la lista |
|---|---|---|
| Panel web + app del cobrador | ✅ | Paridad |
| Funcionamiento sin conexión y sincronización | ✅ cola idempotente, 750 pruebas en móvil | Paridad |
| Importar desde Excel / archivo | ✅ con vista previa, reconciliación y asignación | **Ventaja**: no solo migra, **concilia el archivo diario** de la entidad |
| Prueba de la visita (foto + GPS + huella SHA-256, inmutable) | ✅ | **Ventaja**: ninguno de los citados la anuncia |
| Mora como episodios con historial, promesas y métricas | ✅ | **Ventaja** frente a los de prestamista; parcial frente a bancos |
| Aislamiento por cliente en la base de datos, 2FA, auditoría | ✅ | Ventaja probable; no lo anuncian |
| Plan gratuito | ✅ | Ventaja de entrada (AtllasPay publica desde US$28 por ruta) |
| Seguimiento GPS en tiempo real del cobrador | 🟡 hay ubicación en visitas; el envío continuo desde el móvil no está | **Hueco** frente a AtllasPay y Geo Cash |
| **Caja: arqueo diario, entrega del efectivo, gastos en campo** | ❌ (el resumen de jornada suma lo recaudado, pero no hay rendición) | **Hueco serio** frente a AtllasPay, CarteraGo y CobrApp |
| **Recibo que el cliente se lleva** (PDF/imagen por WhatsApp, impresora) | 🟡 recibo numerado y foto de comprobante; no encontré recibo para enviar ni impresión | **Hueco** frente a CobrApp y CarteraGo |
| Segmentación por calificación y previsión regulatoria | 🟡 categorías de mora configurables y prioridad | Hueco frente a Fortaleza y CIRRUS (otro segmento) |
| Integración con el core financiero | ❌ solo por archivo | Hueco frente a CIRRUS (otro segmento) |

**Lectura honesta:** Kobrax gana en **prueba y control de la mora**, y pierde en
lo que el cobrador y el dueño de una agencia hacen **todos los días con el
dinero** (caja y recibos). Si una agencia compara a Kobrax con CarteraGo hoy,
esos dos huecos pesan más que la huella SHA-256.

## 3. Cuatro pruebas que debe pasar cada función

Para que se use y no estorbe, toda función nueva debe cumplir las cuatro:

1. **Quita un paso, no lo agrega.** Si el cobrador tiene que hacer algo extra
   para que el supervisor se beneficie, no se usará.
2. **Usa datos que ya se capturan.** Nada de formularios nuevos.
3. **Funciona sin red.** En campo no se puede depender de la conexión.
4. **Se enciende solo para quien la necesita.** Un cobrador independiente no
   debe ver pantallas de rendición ni de comisiones de agencia.

## 4. Funciones propuestas, por quién las usa

### Para el cobrador: menos trabajo en la calle

| # | Función | Qué cambia en su día | Se apoya en lo que ya existe | Esfuerzo | Valor |
|---|---|---|---|---|---|
| C1 | **«Hoy te toca»**: la ruta del día se propone sola al abrir la app (promesas de hoy, vencidas, prioridad, cercanía); él ajusta, no arma | Cero decisiones al empezar | Agenda, prioridad de mora, planificador y OSRM | M | Alto |
| C2 | **Cobro en 2 toques**: monto precargado (cuota o promesa), método habitual, enviar recibo | Menos escritura en cada cobro | `pay-sheet`, promesas, catálogos | S-M | Alto |
| C3 | **Recibo por WhatsApp / imagen** con número, monto, saldo y empresa | El cliente se queda con prueba; el cobrador no escribe | `receiptNumber`, `wa.me`, variables de plantilla | M | Alto (paridad) |
| C4 | **Dictado de la gestión** (ya diseñado, gratis, en el teléfono) | Habla en vez de escribir | `ia-diseno-etapa-1.md` §4 | S-M | Alto |
| C5 | **Resumen del crédito antes de llamar o visitar** | No lee historial largo | `ia-diseno-etapa-1.md` §3 | M | Medio-alto |
| C6 | **Mis cierres del día**: lo cobrado, lo prometido y lo que queda, en una vista | Sabe cómo le fue sin sumar | `summarizeDay`, resumen de jornada | S | Medio |

### Para la agencia o entidad: control sin papeleo

| # | Función | Qué cambia | Se apoya en | Esfuerzo | Valor |
|---|---|---|---|---|---|
| A1 | **Rendición de caja**: el cobrador declara lo entregado; el supervisor confirma; la diferencia se ve al instante | Cierra el hueco más serio frente a CarteraGo/AtllasPay | Pagos, resumen de jornada | M | **Muy alto** |
| A2 | **Informe a la entidad mandante**: un PDF por cartera o crédito con gestiones, promesas y evidencia verificada | Es lo que la agencia **vende** al banco y lo que le permite conservar el contrato | Bitácora, evidencia con hash, exportación PDF | M | **Muy alto**; diferenciador |
| A3 | **Verificación de evidencia por enlace**: el banco o un tercero comprueba que la foto y la visita no fueron alteradas, sin entrar al sistema | Convierte el hash en algo que otro puede comprobar | `field_evidences.file_hash` | M | **Muy alto**; ningún citado lo anuncia |
| A4 | **Alertas de la operación** (reglas, no IA): cobrador sin actividad, visita lejos del domicilio, desplazamiento imposible, foto repetida entre visitas | El dueño deja de revisar a mano | Visitas con GPS, hash | S-M | Alto |
| A5 | **Reparto de cartera por zona**: seleccionar en el mapa y asignar; sugerencia por cercanía y carga | Ahorra horas del supervisor | Asignaciones, coordenadas | M | Alto |
| A6 | **Comisiones del cobrador** calculadas con reglas de la agencia | Elimina el cálculo en Excel a fin de mes | Pagos, atribución por responsable | M | Alto (por validar con una agencia) |
| A7 | **Archivo diario de la entidad, en un clic**: sube, ve qué cambió, aplica | Ya existe; pulirlo y hacerlo recurrente | Importación con reconciliación | S | Alto |

### Para varias entidades a la vez (agencia que cobra para varios bancos)
- **A8 · Cartera por mandante:** formato de archivo, informe y reglas por entidad
  dentro de la misma cuenta. Depende de validar si hay agencias en Bolivia que
  hoy trabajan con más de un banco.

## 5. «Perfiles de operación»: cómo no complicar

Hoy `accountType` es siempre `INDEPENDENT` y **no cambia nada** (verificado). Es
una oportunidad: convertirlo en un selector real al registrarse, que encienda
solo lo necesario.

| Perfil | Quién | Se enciende | Se oculta |
|---|---|---|---|
| **Trabajo solo** | Cobrador o prestamista independiente | Cartera, agenda, ruta, cobro, recibo, dictado | Equipo, rendición, informes a mandante, comisiones |
| **Tengo equipo** | Agencia o negocio de cobro | Lo anterior + reparto, rendición de caja, alertas, comisiones | Informe a mandante (opcional) |
| **Cobro para una entidad** | Agencia con contrato o cooperativa con archivo diario | Lo anterior + archivo diario, informe a la entidad, verificación de evidencia | — |

El perfil no es un plan de pago: es **qué pantallas ven**. Cambiarlo es cambiar
configuración, no migrar datos.

## 6. Qué no hacer (por ahora)

| Tentación | Por qué no |
|---|---|
| Integración con el core de cada banco | Venta e implementación pesadas; compite en el terreno de CIRRUS y Fortaleza. El archivo diario ya es el puente |
| Calificación y previsión regulatoria | Es de la entidad regulada, no de la agencia; requiere conocimiento normativo que no está verificado |
| Impresora Bluetooth | Útil, pero es hardware y soporte; el recibo por WhatsApp resuelve el 80 % con una fracción del trabajo (a validar) |
| Scoring o IA predictiva | Necesita datos reales de un piloto; antes, lo que genera datos |
| Un chatbot que cobre al deudor | Riesgo ético y legal alto |

## 7. Orden sugerido

| Orden | Entregar | Por qué primero |
|---|---|---|
| 1 | **C2 + C3 + C6** cobro rápido, recibo y cierre del día | Cierra la paridad básica; lo ve cualquier cobrador desde el primer día |
| 2 | **A1** rendición de caja | Sin esto, una agencia no puede dejar su Excel |
| 3 | **A2 + A3** informe a la entidad y verificación | Es la ventaja que nadie más ofrece y la razón por la que una agencia paga |
| 4 | **C4 + C5** dictado y resumen (Etapa 1 de IA) | Ya diseñado |
| 5 | **C1** «Hoy te toca» y **A4** alertas | Reglas, sin IA, con mucho valor diario |
| 6 | **A5, A6, A7** | Tras validar con una agencia |

## 8. Cómo validar rápido (antes de escribir código)

1. **Un día de acompañamiento** con un cobrador real: anotar cada vez que
   escribe, suma o espera.
2. **Tres entrevistas** con dueños de agencia o cooperativa: «¿qué haces a fin de
   mes que te quita más tiempo?». Escuchar caja, comisiones y reportes.
3. **Prueba tú misma** AtllasPay, CarteraGo y CobrApp un día: confirma o corrige
   la tabla de la sección 2.
4. **Pregunta directa** a una agencia: «si el banco te pide pruebas de gestión,
   ¿qué le envías hoy?». La respuesta valida o descarta A2 y A3.

Tu experiencia como cobradora en el terreno (PRICING §2) es el mejor activo:
úsala para el paso 1 y descartar lo que suena bien pero no se usa.

## 9. Decisiones para ti

| # | Decisión | Mi recomendación |
|---|---|---|
| V1 | ¿Priorizas cerrar la paridad (C2, C3, A1) o la ventaja única (A2, A3)? | **Paridad primero, ventaja después**; ambas caben en un mes de trabajo enfocado a validar |
| V2 | ¿Los perfiles de operación entran en el registro? | Sí; es lo que impide que el producto «se vea complicado» |
| V3 | ¿Hay una agencia con la que validar A1, A2 y A6? | Conseguir una antes de construir |
| V4 | ¿La rendición de caja es por cobrador o por ruta? | Por jornada del cobrador (ya existe «cerrar jornada») |

---

## 10. La misma pregunta, vista desde la IA

> Añadido el 2026-10-10 a pedido: «desde el punto de vista del uso de la IA en
> el sistema». Complementa `estrategia-ia.md` e `ia-diseno-etapa-1.md`.

### 10.1 El espacio libre

En la lista de competidores que compartiste, **ninguno anuncia IA aplicada a la
cobranza**: sus diferenciadores son operativos (caja, GPS, offline, integración
con el core). Según esa lista, quien ofrezca IA útil y comprobable en la
operación diaria no compite contra nadie con esa propuesta. No lo verifiqué en
sus productos; confírmalo con las pruebas de la sección 8.

El riesgo es el contrario: cualquiera puede añadir un chatbot. Por eso la
ventaja **no puede estar en el modelo**, que es un insumo que todos compran.

### 10.2 Dónde sí está la ventaja defendible

| Fuente | Por qué es difícil de copiar | Estado en Kobrax |
|---|---|---|
| **Resultados etiquetados de campo**: qué gestión, a quién, cuándo, y si pagó | Se acumulan con uso real; un competidor que empieza hoy no los tiene | Ya se capturan (gestiones, promesas, pagos, visitas) |
| **IA integrada en el flujo**, no al lado | Exige conocer cada pantalla y regla del negocio | Se apoya en validadores y reglas compartidas ya existentes |
| **Evidencia verificable + IA** | La IA propone, la persona decide y la evidencia queda sellada y comprobable por terceros | Hash SHA-256 y bitácora inmutable ya existen |
| **Español hablado de Bolivia** en campo | Datos y pruebas locales; los modelos genéricos fallan con acento y jerga | A probar en terreno |
| **Controles de confianza** (apagado por cuenta, tope, auditoría, sin PII) | Es lo que una entidad regulada exige para aceptar IA | Diseñado, no construido |

### 10.3 La regla que evita complicar: IA invisible

La IA que más se usa es la que **no añade una pantalla**: mejora algo que el
usuario ya hace.

| Función que ya existe | Cómo mejora con IA | Lo que ve el usuario |
|---|---|---|
| **Prioridad de la mora** (`arrears-priority-score`, por reglas) | Aprende qué créditos pagan tras qué gestión | La misma lista, mejor ordenada |
| **Ruta del día** (OSRM por distancia) | Pondera valor esperado y ventana de éxito | La misma ruta, más útil |
| **Cuadro de notas** de la gestión | Dictado con sugerencia de resultado y promesa | Menos toques |
| **Plantillas de WhatsApp** | Ajuste de tono y contexto | El mismo botón |
| **Importación** | Propone el mapeo de columnas nuevas | La misma pantalla de columnas, ya completada |
| **Alertas** | De reglas fijas a patrones aprendidos | El mismo aviso, menos falsas alarmas |

Cada una **nace como regla** y se vuelve aprendida cuando hay datos. Así no hay
que esperar un piloto largo para sacar algo útil.

### 10.4 Ventaja por tipo de usuario

| Perfil de operación | La IA que le sirve | Qué se paga aparte |
|---|---|---|
| **Trabajo solo** | Dictado, resumen del crédito, mensajes | Cupo mensual pequeño |
| **Tengo equipo** | Lo anterior + auditoría de la operación, reparto sugerido, preguntas al negocio en lenguaje natural | Cupo mayor |
| **Cobro para una entidad** | Lo anterior + **informe a la entidad redactado a partir de hechos verificados**, pronóstico de recuperación por cartera, mapeo de archivos nuevos | Cupo mayor, o complemento |

Como dijiste, el costo se traslada al usuario: encaja con un **cupo mensual por
plan** (el mecanismo está diseñado en `ia-diseno-etapa-1.md` §2.3) y con
complementos para quien quiera más.

### 10.5 Las cinco funciones de IA con más ventaja real

Ordenadas por la combinación **utilidad diaria × dificultad de copiar**:

| # | Función | Para quién | Por qué da ventaja | Datos que necesita |
|---|---|---|---|---|
| 1 | **Informe a la entidad, redactado y verificable** | Agencia | La agencia vende justamente esto; hoy se arma a mano. La IA redacta la narrativa; los números salen del sistema y cada afirmación enlaza su evidencia | Ninguno extra |
| 2 | **Dictado que registra la gestión** | Cobrador | Ahorra tiempo en cada visita y mejora la calidad del registro | Ninguno |
| 3 | **Auditoría automática de la operación** | Dueño o supervisor | Sustituye revisión manual; la evidencia sellada la hace creíble | Visitas actuales |
| 4 | **Priorización que aprende** (créditos y rutas) | Cobrador y supervisor | Es el efecto que crece con el uso y que nadie puede copiar sin datos | Histórico real |
| 5 | **Preguntar al negocio en lenguaje natural** | Dueño o gerente | Convierte el panel en respuestas: «¿quién recuperó más esta semana?» | Analytics actual |

Fuera de esta lista, por ahora: contacto automático al deudor y scoring
crediticio. Riesgo ético y legal alto; no dan ventaja que valga ese riesgo.

### 10.6 El efecto que no se copia: el ciclo de aprendizaje

```
Recomendación → acción del cobrador → resultado (visita, promesa, pago) → aprendizaje
```

Cada gestión que el cobrador **corrige** es una etiqueta. Con el tiempo,
Kobrax sabe en qué región y con qué tipo de cartera funciona qué gestión. Con
consentimiento y datos anonimizados, ese conocimiento puede devolverse a todas
las cuentas como referencia. **Es una hipótesis que requiere revisión legal y de
privacidad**; no debe presentarse como capacidad existente.

### 10.7 Cómo contarlo sin prometer de más

| Decir | No decir |
|---|---|
| «Kobrax captura los resultados de campo que alimentan la IA y la mantiene bajo control humano» | «Kobrax tiene IA predictiva» |
| «El oficial dicta; Kobrax propone; la persona confirma» | «La IA gestiona la cobranza» |
| «Informes a la entidad con evidencia verificable» | «Cumplimiento automático ante ASFI» |

### 10.8 Qué decidir

| # | Decisión | Recomendación |
|---|---|---|
| I1 | ¿Cuál es la **función estrella** de IA para mostrar y vender? | El **informe a la entidad** (agencia) y el **dictado** (cobrador): se entienden en segundos y no necesitan histórico |
| I2 | ¿Las funciones que aprenden entran como reglas primero? | Sí, para entregar valor desde el primer piloto |
| I3 | ¿La IA es parte del plan o un complemento? | Cupo en el plan, con complemento para más |
