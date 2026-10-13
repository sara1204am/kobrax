# Plan maestro de IA de Kobrax — datos primero, reglas después, IA donde hay volumen

> Documento rector, 2026-10-10. **Centraliza** y ordena lo ya escrito; no
> sustituye a los demás (ver §11). Propuesta para validar: no hay código.
> Cada afirmación sobre el estado actual se verificó en el repo; lo demás es diseño.

## 0. En una página

**Idea.** La IA es tan buena como los datos de contexto que Kobrax guarda. Hoy
guarda *qué pasó* en una gestión, pero no *de qué vive el deudor*, *cuándo le
llega el dinero*, *por qué no pagó* ni *cómo conviene cobrarle*. Esos datos, una
vez guardados, **ya mejoran la app sin IA** (reglas) y después alimentan la IA.

**Tres capas, cada una funciona sola:**

| Capa | Qué es | Sirve a | Necesita volumen |
|---|---|---|---|
| **A · Datos** | Guardar rubro, ciclo de ingreso, motivo, perfil de cobro, plantilla usada | Todos | No |
| **B · Reglas** | Usar esos datos de forma determinista: fechas de promesa, rutas, prioridad, alertas | Todos, incluso con pocos créditos | No |
| **C · IA** | Asistir (texto y voz) y aprender (qué funciona) | Asistencia: todos · Aprendizaje: cuentas con volumen | Solo el aprendizaje |

**Regla de oro:** la IA nunca es requisito. Si falta, se cae a la capa B; si
falta el dato, la regla se omite. Una cuenta de 20 créditos y una de 20.000
usan el mismo producto, con distinto nivel de asistencia.

## 1. Principios (heredados de lo ya diseñado)

1. **Determinista primero.** Si una regla clara resuelve, no se usa un modelo.
2. **La persona decide.** La IA propone con su porqué; nada irreversible ni
   mensajes automáticos al deudor.
3. **Cada dato con su origen:** manual, dictado, importado o sugerido-aceptado.
4. **Un solo punto de salida a modelos** (`ai-gateway`), apagable por cuenta.
5. **Degradación elegante:** sin red, sin IA, sin dato → sigue funcionando.
6. **Medir antes de afirmar:** ningún modelo reemplaza a una regla sin
   demostrar que la supera con datos reservados.

## 2. Capa A — Datos nuevos que hay que guardar

### 2.1 Qué falta hoy (verificado)

| Dato | Hoy | Dónde encajaría |
|---|---|---|
| Fuente de ingreso (asalariado, comerciante…) | ❌ | Perfil de ingreso del cliente |
| Rubro (transportista, funcionario…) | ❌ | Perfil de ingreso, catálogo |
| Ciclo de ingreso y día habitual | ❌ | Perfil de ingreso |
| Motivo de no pago | ❌ (solo `SPECIAL_CATEGORY` en campo) | Gestión |
| Fecha esperada de ingreso | ❌ | Gestión |
| Plantilla de mensaje usada | ❌ | Gestión |
| Quién responde realmente (titular, garante…) | ❌ | Gestión |
| Modalidad y horario de cobro | 🟡 `visit_schedule` solo se **escribe** al agregar una ubicación (el alta atómica lo descarta, no se edita, ningún endpoint lo devuelve); `preferredContactChannel` existe sin pantalla. Verificado en F4/13 | Perfil de cobro |
| Zona normalizada | 🟡 `client_locations.zone` es texto libre | Catálogo de zonas |
| Origen del dato (manual / dictado / importado) | ❌ | Perfil y gestión |

### 2.2 Diseño propuesto

**A1 · Catálogos nuevos.** Se aprovechan los catálogos por cuenta
(`catalog_items`: único por cuenta+tipo+código, con `metadata` JSON). Nuevos
tipos en el enum `CatalogType` (requiere migración de PostgreSQL):

| Catálogo | Contenido | `metadata` útil |
|---|---|---|
| `INCOME_SOURCE` | Asalariado/profesional, Comerciante/productivo, Otro | — |
| `OCCUPATION` (rubro) | Transportista, funcionario público, comerciante de mercado, productor, construcción, servicios, docente… | `incomeSource`, `defaultCycle`, **`synonyms[]`** |
| `NO_PAYMENT_REASON` | Los motivos de `ia-aprendizaje-efectividad.md` §12.4 | `appliesTo[]`, `suggestion`, `asksExpectedIncomeDate`, `triggersContactUpdate`, `sensitive` |
| `COLLECTION_MODALITY` | Visita en negocio, en domicilio, recoger la cuota, paga en oficina, transferencia/QR | — |
| `ZONE` | Zonas y macrozonas de la cuenta | `parent` |

Los `synonyms` permiten reconocer texto («chofer», «micrero», «taxista») **sin IA**.
Cada cuenta ajusta su lista; se siembra una por defecto.

**A2 · Perfil de ingreso del cliente** (tabla nueva `client_income_profiles`,
con `account_id` y RLS como toda tabla operativa):

| Campo | Notas |
|---|---|
| `client_id` (único) | Un perfil vigente por cliente |
| `income_source_code`, `occupation_code` | Códigos del catálogo |
| `income_cycle` (enum) | `DAILY`, `WEEKLY`, `BIWEEKLY`, `MONTHLY`, `QUARTERLY`, `SEASONAL`, `IRREGULAR` |
| `income_day` | Día de semana o del mes |
| `origin` (enum) | `MANUAL`, `DICTATION`, `IMPORT`, `SUGGESTION_ACCEPTED` |
| `declared_by`, `declared_at` | Quién y cuándo |
| `notes` | Texto corto |

*Por qué una tabla y no columnas en `clients`:* mantiene `clients` liviana,
permite procedencia y es fácil de retirar. No se usa `clients.metadata`: ya
guarda `linkSuggestions`. **Por verificar:** si el perfil es del cliente o del
crédito (un cliente puede tener uno productivo y uno de consumo).

**A3 · Perfil de cobro** (sin migración): se define un **esquema validado en
`packages/shared`** y se guarda en lo que ya existe:

```
client_locations.visit_schedule  (JSON, por ubicación)
{ modality, frequency, window: {from, to}, days[], handoverBy, note }
clients.preferred_contact_channel
```

**A4 · Gestión** (`credit_activities`, columnas nuevas **nulables**; la tabla es
append-only, así que no hay reescritura):

| Columna | Para qué |
|---|---|
| `reason_code` | Motivo de no pago |
| `expected_income_date` | Solo si el motivo es «ingreso atrasado» |
| `template_code` | Plantilla usada en un `MESSAGE` |
| `payer_party` (enum) | `HOLDER`, `GUARANTOR`, `CODEBTOR`, `BENEFICIARY`, `NOT_LOCATED` |
| `payer_relation_id` | Enlaza a la relación ya cargada (garante, codeudor) |
| `origin` | `MANUAL` o `DICTATION` |

La regla de validez se agrega al **validador compartido**
(`validateRecoveryActivity`): el motivo solo aplica a gestiones sin pago, y la
fecha esperada solo con su motivo. Es la única fuente de verdad para web, móvil y API.

**A5 · Importación.** Permitir que el archivo traiga rubro, ciclo o tipo de
crédito. **No verificado** que hoy se mapee el tipo de crédito (`typeCode` solo
aparece nulo en pruebas); se revisa con `FIELD-RULES`.

### 2.3 Dónde se captura (sin añadir pasos)

| Dato | Pantalla | Esfuerzo del cobrador |
|---|---|---|
| Fuente, rubro, ciclo | Alta de cliente / primera gestión / **descripción libre (§4.1)** | Una vez |
| Motivo y fecha esperada | Hoja de gestión (opciones filtradas por fuente de ingreso) | 1 toque |
| Quién responde | Se sugiere al nombrar garante o codeudor | 0–1 toque |
| Perfil de cobro | Ficha del cliente y parada | Una vez |
| Plantilla usada | Al **elegir** la plantilla (`wa.me` no confirma el envío; hoy el código de plantilla se descarta) | 0 |

### 2.4 Offline, permisos y cambios en lo existente

- **Móvil:** los campos nuevos viajan en la caché del cliente; las escrituras
  usan las colas existentes (`client.update`, `mora.activity`). Hay que subir
  `QUEUE_VERSION` y mantener compatibilidad con ítems antiguos.
- **Permisos:** `client:write` y `collection:write` actuales; sin permisos nuevos.
- **Migración de datos:** ninguna; todo es nulable. La capa B **debe** tolerar
  cuentas sin estos datos.
- **Límites de plan:** ninguno.
- **RLS:** `client_income_profiles` se añade al script `rls/` (recordar que se
  aplica a mano tras cada migración).

## 3. Capa B — Reglas deterministas (sirven con pocos créditos)

Todas son funciones puras en `packages/shared` (probadas, usadas igual en web,
móvil y API) y funcionan **sin red y sin costo**.

| # | Regla | Entrada | Salida | Estado hoy |
|---|---|---|---|---|
| B1 | **Fecha de promesa sugerida** | Ciclo y día de ingreso, motivo, fecha esperada | Primera fecha razonable tras el próximo ingreso | Nuevo |
| B2 | **Gestión en la fecha de ingreso** | Perfil de ingreso | Sugerir agendar ese día y no antes | Nuevo |
| B3 | **Ruta del día v2** | Zona, horario de cobro, promesas de hoy, ciclo | Paradas agrupadas por zona, respetando ventanas | Mejora de rutas existentes |
| B4 | **Prioridad v2** | Score actual + promesa vencida, ciclo próximo, motivo, intentos | Lista ordenada **con el porqué** | Extiende `arrears-priority-score` |
| B5 | **Siguiente acción por motivo** | Motivo y rubro | Acción sugerida (texto editable) | Nuevo |
| B6 | **Cobro diario en negocio** | Perfil de cobro | Generar la visita del día automáticamente | Nuevo (ver nota) |
| B7 | **Alerta de evento externo** | Motivos por zona y fecha | «12 créditos de la zona X reportan bloqueo» | Nuevo |
| B8 | **Alertas de operación** | Visitas, GPS, hash | Cobrador sin actividad, visita lejos, foto repetida | Nuevo |
| B9 | **«Qué funcionó»** | Gestiones y resultados por segmento | Tablas con margen de duda; «sin datos suficientes» | Nuevo |
| B10 | **Reparto de cartera por zona** | Zonas y carga | Asignación sugerida | Extiende asignaciones |
| B11 | **Depuración de datos** | Faltantes por cliente | Lista: sin ubicación, sin teléfono, sin rubro | Nuevo |
| B12 | **Informe a la entidad (plantilla)** | Gestiones, promesas, evidencia | PDF estructurado | Extiende exportación PDF |

**Dos límites reales que descubrí al verificar:**

1. **La agenda no soporta gestiones recurrentes.** B6 no puede ser un ítem de
   agenda repetido: se resuelve como *visita sugerida generada al armar la ruta*
   a partir del perfil de cobro, o se construye recurrencia aparte (más grande).
2. **El optimizador de rutas no maneja ventanas horarias.** El propio blueprint
   marca «hora fija en el optimizador» como faltante. B3 se hace con una
   heurística: partir por ventana y zona, y luego optimizar dentro de cada grupo.

## 4. Capa C — IA

### 4.1 Funciones nuevas pedidas: describir al cliente y que se distribuya en campos

> «Es chofer de micro en la zona sur, trabaja de noche, cobra por semana; la
> esposa es garante y su teléfono es…» → los campos se llenan solos.

**Flujo:** en el alta o la ficha, un cuadro «Describir al cliente» (texto o
dictado) → una **tabla de propuestas** campo por campo, con la frase de origen
resaltada y la confianza → la persona acepta, edita o descarta cada una → se
guarda como una actualización normal del cliente (cola offline existente).

**Dos etapas, para poder funcionar sin IA y sin exponer datos:**

| Etapa | Qué hace | Costo | Datos personales |
|---|---|---|---|
| **1 · Reglas** | Reconoce rubro por **sinónimos del catálogo**, ciclos («por semana», «cada tres meses»), horarios, zonas, teléfonos y números con expresiones regulares | Cero, offline | **Se quedan en el dispositivo** |
| **2 · Modelo (opcional)** | Interpreta lo que las reglas no entienden, **solo sobre campos no identificadores** (rubro, ciclo, horario, modalidad, zona macro) | Por uso | **Nombres, teléfonos y direcciones no salen**: los extraen las reglas y se reemplazan por marcadores |

Nota honesta: extraer un **nombre propio** o un **teléfono** de un texto libre
con un modelo implica que el modelo vea ese dato. Por eso, en este plan, esos
campos los resuelven **reglas locales y formularios**, no el modelo. Es el costo
de no violar la información del usuario.

### 4.2 Catálogo de funciones de IA

Modo: **R** = regla, **A** = asistida (modelo sin necesitar histórico),
**L** = aprendida (necesita volumen).

| # | Función | Módulo | Modo | Para quién | Versión |
|---|---|---|---|---|---|
| C1 | Descripción libre → campos del cliente | Clientes | R→A | Cobrador | **V1** |
| C2 | Dictado → gestión, motivo y promesa | Mora | R→A | Cobrador | **V1** |
| C3 | Resumen del crédito antes de contactar | Mora | A | Cobrador | **V1** |
| C4 | Mapeo de columnas de importación | Importación | A | Agencia | **V1** |
| C5 | Mensajes: plantilla → dictado → mejora de tono | Agenda | R→A | Cobrador | **V1** |
| C6 | Informe a la entidad, redactado con evidencia | Informes | A | Agencia | **V1** |
| C7 | Normalizar direcciones y zonas; duplicados difusos | Clientes | R→A | Agencia | **V1** |
| C8 | Explicar «por qué esta prioridad» | Mora | R→A | Todos | **V1** |
| C9 | Preguntar al negocio en lenguaje natural | Dashboard | A | Dueño | V1.5 |
| C10 | Probabilidad de promesa cumplida y de pago | Mora | L | Agencia con volumen | V1.5 |
| C11 | Alerta temprana: al día que entrará en mora | Mora | L | Agencia con volumen | V1.5 |
| C12 | Mejor franja y canal por segmento | Agenda | R→L | Agencia con volumen | V1.5 |
| C13 | Anomalías aprendidas de la operación | Campo | R→L | Dueño | V2 |
| C14 | Efecto de cada acción, con experimentos | Mora | L | Agencia con volumen | V2 |
| C15 | Rutas por valor esperado y zona | Rutas | R→L | Supervisor | V2 |
| C16 | Plan diario sugerido para el supervisor | Supervisión | L | Supervisor | V2 |
| C17 | Pronóstico de recuperación por cartera | Análisis | L | Gerente | V2 |
| C18 | Contacto automático al deudor | — | — | — | **Fuera del plan** |

### 4.3 Cómo se decide entre regla y aprendido (pocos o muchos créditos)

No con un número fijo de créditos, sino **por incertidumbre**:

```
¿Hay datos suficientes en ESTE segmento para que el modelo supere a la regla?
   sí → modo aprendido (con su porqué y su margen)
   no → regla (capa B)
```

- Cada decisión (prioridad, franja, ruta) tiene **una regla de respaldo** y se
  compara con el modelo sobre datos reservados.
- Un segmento con pocos casos muestra «sin datos suficientes» y usa la regla.
- El umbral lo fija la evidencia del piloto, **no una cifra supuesta aquí**.
- Para cuentas pequeñas, una vía opcional: **referencias agregadas** entre
  cuentas con consentimiento. Hipótesis: requiere revisión legal.

| Perfil de cuenta | Qué recibe |
|---|---|
| Pocos créditos (cobrador solo) | Capa A + B + asistencia C1–C8 |
| Volumen medio (agencia) | Lo anterior + B7–B10 + primeras tablas B9 |
| Volumen alto (entidad) | Lo anterior + modelos aprendidos C10–C17 |

## 5. Privacidad: lo suficiente para empezar, con espacio para endurecer

> El detalle de seguridad se profundiza después (decisión de la fundadora). Aquí
> solo el marco para que el plan sea factible sin exponer datos.

### 5.1 Clases de dato

| Clase | Ejemplos | ¿Puede llegar a un modelo externo? |
|---|---|---|
| **P0 · Público o de catálogo** | Rubros, motivos, zonas, plantillas | Sí |
| **P1 · Operativo no identificante** | Ciclo, modalidad, resultado, días de mora, categoría | Sí |
| **P2 · Financiero contextual** | Montos, fechas | **Solo transformado** (rangos, fechas relativas) |
| **P3 · Identificante** | Nombre, documento, teléfono, dirección, correo, foto | **No** |
| **P4 · Texto libre** | Notas, dictado | Solo tras redacción, **con opción de la cuenta (apagada por defecto)** |

### 5.2 Técnicas disponibles (a evaluar en la fase de seguridad)

| Técnica | Qué da | Costo |
|---|---|---|
| Reemplazo por marcadores (seudonimización) | Modelo no ve identificantes | Bajo |
| Generalización (montos en rangos, zona a macrozona) | Menos reidentificación | Bajo |
| Reglas y modelos **en el dispositivo o en el propio servidor** | El dato no sale | Medio; calidad en español de Bolivia por probar |
| Modelo de lenguaje propio o local | Sin terceros | Alto; **rendimiento no verificado** |
| Agregación y umbral mínimo de grupo (k-anonimato) para estadísticas entre cuentas | Evita reidentificar | Medio |
| Contratos y regiones del proveedor | Control legal | Administrativo |

**Punto de partida:** P3 nunca sale; P4 apagado; P2 transformado; registro de uso
sin contenido; apagado por cuenta. Con eso se puede empezar y endurecer después.

## 6. Cómo se ve en cada perfil de operación

| Perfil | Datos que ve capturar | Reglas | IA |
|---|---|---|---|
| **Trabajo solo** | Rubro, ciclo, motivo, cobro | B1, B2, B4, B5, B11 | C1, C2, C3, C5, C8 |
| **Tengo equipo** | Lo anterior | + B3, B7, B8, B9, B10 | + C4, C7, C9 |
| **Cobro para una entidad** | Lo anterior | + B12 | + C6, C10–C17 según volumen |

La IA va en **cupo mensual por plan**, con complemento; el costo se traslada al
usuario. El mecanismo de tope está en `ia-diseno-etapa-1.md` §2.3.

## 7. Alcance de la primera versión («V1»)

**Entra:**

| Bloque | Contenido |
|---|---|
| **A · Datos** | A1–A4 completos; A5 si la importación lo permite |
| **B · Reglas** | B1, B2, B3, B4, B5, B7, B9 (tablas), B11, B12 (plantilla) |
| **C · IA** | C1–C8, todos con humano en el circuito y apagables por cuenta |
| **Base** | `ai-gateway`, registro de uso, tope por cuenta, seudonimización, evaluación |

**No entra:** modelos aprendidos (C10–C17), consultas en lenguaje natural (C9),
contacto automático al deudor (C18), recurrencia en agenda.

### Orden de construcción

| Paso | Entrega | Depende de | Esfuerzo |
|---|---|---|---|
| 1 | **A3** perfil de cobro (sobre campos existentes) | — | S |
| 2 | **A1 + A2** catálogos y perfil de ingreso | — | M |
| 3 | **A4** columnas de gestión + validador compartido | A1 | M |
| 4 | **B1, B2, B4, B5** reglas de fecha y prioridad | 2, 3 | M |
| 5 | **B3, B7, B11** rutas por zona, evento externo, depuración | 2 | M |
| 6 | **Base de IA** (gateway, uso, tope, seudonimización, evaluación) | — | M |
| 7 | **C2 + C1 etapa 1** dictado y descripción por reglas | 3, 6 | M |
| 8 | **C3, C8** resumen y explicación | 6 | M |
| 9 | **C4, C5, C7** importación, mensajes, normalización | 6 | M |
| 10 | **C1/C2 etapa 2**, **C6** con modelo | 6, 7 | M |
| 11 | **B9** tablas «qué funcionó» | 3 + datos acumulados | M |

Los pasos 1 a 5 **no necesitan IA ni proveedor** y se pueden entregar solos.
**Corren contra el reloj** porque capturan los datos que tardan meses en acumularse.

## 8. Qué se necesita de fuera

| Necesidad | Para | Estado |
|---|---|---|
| Proveedor de modelos de lenguaje | C1–C8 etapa 2 | Por decidir |
| Reconocimiento de voz en el dispositivo (`expo-speech-recognition`, SDK 51) | C1, C2, C5 | Existe; **`es-BO` sin verificar** |
| **Geocodificación** | C7, rutas por zona desde direcciones | **No existe en el repo**; hoy las coordenadas vienen del dispositivo o a mano |
| Build de desarrollo móvil | Módulo nativo de voz | **No hay `eas.json`** |
| Aplicar RLS a mano tras migrar | Tablas nuevas | Proceso existente a recordar |

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Que el cobrador no capture los datos | Esfuerzo mínimo; dictado; capturar solo en el momento natural |
| Datos de baja calidad | Origen registrado; validación contra comportamiento posterior |
| Rubros y motivos mal diseñados | Validar con cobradores; catálogos editables |
| Presión indebida optimizada | La IA decide cuándo y por qué canal, no la dureza; límites de contacto |
| Sesgo contra grupos | Sin atributos sensibles ni sustitutos; revisar por grupo |
| Complejidad de pantallas | Perfiles de operación; progresivo |
| Falsa precisión con pocos datos | «Sin datos suficientes»; regla de respaldo |
| Sobrepromesa en la postulación | Presentar como hoja de ruta; ver §10 |

## 10. Cómo contarlo

| Decir | No decir |
|---|---|
| «Kobrax captura el contexto de cada deudor y lo usa con reglas claras; la IA asiste y aprende cuando hay volumen» | «IA predictiva» como funcionalidad actual |
| «El oficial describe o dicta; Kobrax propone los campos; la persona confirma» | «La IA llena la ficha sola» |
| «Los datos personales identificantes no se envían a modelos externos» | «Los datos son 100 % privados» |

## 11. Mapa de documentos de IA (nada se elimina)

| Documento | Qué cubre | Estado |
|---|---|---|
| **`ia-plan-maestro.md`** (este) | Plan integrado: datos, reglas, IA, privacidad, versiones | Rector |
| [`ia-memoria-y-contexto.md`](ia-memoria-y-contexto.md) | Cómo Kobrax aprende sin entrenar un modelo: memorias, ensamblador de contexto, ciclo de veredictos | Detalle de la mejora continua (decisiones K1–K5 aprobadas) |
| [`ia-dictado-clasificacion-y-vectores.md`](ia-dictado-clasificacion-y-vectores.md) | Dictado multi-tema, clasificación a campos, redacción enfocada, evaluación de vectores | Detalle de C1, C2 y C5 |
| [`agenda-recurrencia.md`](agenda-recurrencia.md) | Series de gestiones recurrentes sobre la agenda | Detalle de B6 |
| [`estrategia-ia.md`](estrategia-ia.md) | Visión, riesgos, mapa de capacidades por módulo | Contexto |
| [`ia-diseno-etapa-1.md`](ia-diseno-etapa-1.md) | Base técnica: gateway, controles, resumen, dictado, mapeo, mensajes | Detalle de C2–C5 |
| [`ia-aprendizaje-efectividad.md`](ia-aprendizaje-efectividad.md) | Qué medir, motivos, rubro, perfil de cobro, escalones de aprendizaje | Detalle de A y C10–C14 |
| [`ventaja-competitiva.md`](ventaja-competitiva.md) | Competidores, paridad, funciones de uso real | Contexto |

**Reconciliación:** la sección 4 de `ia-diseno-etapa-1.md` ya fue actualizada al
dictado en el dispositivo. Los motivos de `ia-aprendizaje-efectividad.md` §12.4
son la lista base de A1.

## 12. Por verificar antes de construir

1. ¿Rubro e ingreso por **cliente** o por **crédito**?
2. ¿La **importación** trae rubro, ciclo o tipo de crédito?
3. ¿Hay `es-BO` en el reconocimiento de voz de los teléfonos reales?
4. ¿Cómo se construye el módulo nativo (no hay `eas.json`)?
5. ¿Qué geocodificador y con qué política de datos?
6. ¿La agenda necesita recurrencia, o basta la visita sugerida (B6)?
7. Normativa sobre datos personales y cobranza (consulta legal).
8. Los **umbrales** de «datos suficientes» (se fijan con el piloto).

## 13. Decisiones para ti

| # | Decisión | Mi recomendación |
|---|---|---|
| M1 | ¿Arrancar por la capa A (datos) ya, antes que cualquier IA? | **Sí**: es lo único que corre contra el reloj y mejora la app sin IA |
| M2 | ¿Perfil de ingreso en el cliente o en el crédito? | Cliente, con posibilidad de sobrescribir por crédito; validar con un caso real |
| M3 | ¿V1 incluye C1–C8 completos o solo con reglas, sin proveedor de modelos? | Reglas primero (pasos 1–5, 7); la etapa con modelo sale cuando se decida el proveedor |
| M4 | ¿Aceptas que nombres y teléfonos los resuelvan reglas y formularios, no el modelo? | Sí, es la forma de empezar sin exponer identificantes |
| M5 | ¿Con qué cuenta y cuántos cobradores se valida la capa A? | Una agencia real o un cobrador con 2–3 jornadas |

> Estado de M1–M5: **pendientes**. La fundadora aprobó el 2026-10-10 las
> decisiones K1–K5 (§15); estas cinco aún no se han resuelto.

## 14. Actualizaciones posteriores a la primera redacción

Cambios acordados después de redactar este plan. Los documentos detallados
están en el mapa de §11.

| Tema | Qué cambia | Documento |
|---|---|---|
| **Agenda recurrente** | Se agrega recurrencia **real** a la agenda (series que generan ocurrencias normales). La visita sugerida al armar la ruta (§3, B6) queda como **respaldo** para cuentas que no activen series | [`agenda-recurrencia.md`](agenda-recurrencia.md) |
| **Dictado multi-tema** | Un dictado con varios temas se clasifica en tarjetas (gestión, motivo, promesa, contacto, perfil, nota). Aparece un hueco: `contact_party` (con quién se habló) | [`ia-dictado-clasificacion-y-vectores.md`](ia-dictado-clasificacion-y-vectores.md) |
| **Redacción enfocada** | La nota que se guarda se redacta de forma objetiva, atribuida y concisa, con original y propuesta lado a lado | Ídem §4 |
| **Clasificar con pocos datos** | Clasificación *zero-shot* con las definiciones de los catálogos; no exige volumen | Ídem §2 |
| **Vectorización** | **No empezar por vectores**; reevaluar cuando glosario y ejemplos no quepan en el contexto. La base actual no tiene pgvector | Ídem §6–7 |

## 15. Registro de decisiones

| Fecha | # | Decisión | Estado |
|---|---|---|---|
| 2026-10-10 | **K1** | El aprendizaje es memoria y contexto especializado, **sin modelo propio de ML** | **Aprobada** |
| 2026-10-10 | **K2** | Se empieza por la **memoria de formatos de importación** | **Aprobada** |
| 2026-10-10 | **K3** | Las reglas aprendidas requieren **aprobación del administrador** por defecto, configurable por cuenta | **Aprobada** |
| 2026-10-10 | **K4** | Se muestra la pantalla **«Lo que Kobrax aprendió de tu operación»** | **Aprobada** |
| 2026-10-10 | **K5** | **Sin aprendizaje entre cuentas** por ahora; solo valores semilla curados a mano | **Aprobada** |
| — | M1–M5 | Ver §13 | Pendientes |
| — | R1–R3 | Ver [`agenda-recurrencia.md`](agenda-recurrencia.md) §11 | Pendientes |
| — | D1–D5 | Ver [`ia-dictado-clasificacion-y-vectores.md`](ia-dictado-clasificacion-y-vectores.md) §10 | Pendientes |
| — | E1–E5 | Ver [`ia-aprendizaje-efectividad.md`](ia-aprendizaje-efectividad.md) §10 | Pendientes |

### Consecuencias de lo aprobado

- **K2 fija el primer entregable de IA con efecto visible:** el segundo archivo
  de una misma entidad se importa sin modelo. Está en el paso 1 de
  [`ia-memoria-y-contexto.md`](ia-memoria-y-contexto.md) §12.
- **K3 y K4 se construyen juntas:** la pantalla de memoria es donde el
  administrador aprueba, edita, desactiva o borra lo aprendido.
- **K5 simplifica el diseño de datos:** toda la memoria queda por `account_id`;
  no hace falta ninguna capa de anonimización entre cuentas en esta versión.
