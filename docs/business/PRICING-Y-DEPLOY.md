# KOBRAX — Precios, Costos y Puesta en Marcha
### Explicado sin tecnicismos

> **Fecha:** 2026-08-12 · **Precios de proveedores verificados:** 2026-08-13
> **Para quién es este documento:** cualquier persona que tenga que tomar o entender una decisión sobre Kobrax — cuánto cobrar, cuánto cuesta operarlo, qué falta para poder vendérselo a alguien. **No hace falta saber de sistemas para leerlo.**

---

## Cómo leer este documento

Cada dato lleva una etiqueta que dice de dónde salió. Esto importa: no es lo mismo un número que leímos en la factura de un proveedor que uno que estimamos nosotros.

| Etiqueta | Qué significa |
|---|---|
| **[VERIFICADO-CÓDIGO]** | Lo comprobamos abriendo el programa de Kobrax. Es así, sin discusión. |
| **[VERIFICADO-2026-08]** | Lo leímos en la página oficial del proveedor el 13 de agosto de 2026. Las URLs están en la §12 para que cualquiera lo confirme. |
| **[SUPUESTO]** | Es una estimación nuestra. Puede estar mal. Cuando un supuesto es importante, lo decimos. |

### Diccionario mínimo (los ocho términos que aparecen todo el tiempo)

Si entendés estos ocho, entendés el documento entero.

| Palabra | Qué es, en criollo |
|---|---|
| **Servidor / VPS** | Una computadora que alquilamos por mes y que está prendida siempre, en un galpón lleno de computadoras en otro país. Ahí "vive" Kobrax. Nadie la ve ni la toca; se la alquila como quien alquila un depósito. |
| **La nube** | Justamente eso: computadoras y discos de otra empresa que alquilamos por mes en vez de comprar. |
| **Base de datos** | El archivo maestro donde está *todo*: clientes, créditos, pagos, visitas. Es lo único irreemplazable del sistema. Si se pierde el programa, se vuelve a instalar; si se pierde la base de datos, se perdió la empresa. |
| **Storage / almacenamiento** | El depósito donde se guardan las **fotos** que saca el cobrador. Se cobra por cuántos GB guardás y por mes. |
| **GB (gigabyte) / TB (terabyte)** | Medida de cuánto ocupan los archivos. Una foto de celular pesa alrededor de **1 MB**; mil fotos son **1 GB**; un millón de fotos son **1 TB**. |
| **Egress / tráfico de bajada** | Lo que algunos proveedores cobran **cada vez que alguien mira o descarga** una foto guardada. Guardar es barato; en algunos proveedores, *mirar* es caro. Esta distinción decide un proveedor entero (§7). |
| **Backup / respaldo** | Una copia de seguridad de la base de datos, guardada en otro lado, por si la computadora principal se rompe. |
| **Deploy / puesta en marcha** | El acto de sacar el sistema de la computadora de la programadora y ponerlo a funcionar en internet, donde los clientes lo usan de verdad. Hoy Kobrax **todavía no está desplegado**: funciona, pero sólo en la máquina de desarrollo. |

---

## 1. Resumen ejecutivo — lo que hay que saber si sólo leés una página

**Sobre cuánto cobrar**

Se cobra **por cobrador que usa la app, por mes**. Cuatro planes: Independiente **$15**, Cartera **$12 por cobrador** (mínimo 5), Institucional **$99 fijo + $10 por cobrador**, Enterprise **desde $800**.

⚠️ **Pero hay un problema nuevo con el precio**: cuando se escribió la primera versión de este documento, el dólar en Bolivia valía Bs 6,96. **Hoy vale Bs 11,71.** Nadie subió el precio, pero en bolivianos el producto se encareció un **68%**: $12 pasó de Bs 84 a **Bs 141**. Y el sueldo del cobrador boliviano no subió 68%. **Hay una decisión comercial pendiente sobre esto** (§3).

**Sobre cuánto cuesta operarlo**

Muy poco, y esa es la buena noticia grande del documento:

| Etapa | Cobradores | Costo mensual de operar |
|---|---|---|
| Piloto | 20 | **~$25** |
| Crecimiento | 150 | **~$145** |
| Escala | 800 | **~$540** |

En ningún caso el costo de la infraestructura supera el **11% de lo que se factura**. **El costo real de esta empresa no son las computadoras: es el tiempo de las personas** — soporte, ventas, atender un problema un domingo.

**Sobre dónde alojarlo**

**Contabo**, un proveedor alemán barato, con las computadoras en Estados Unidos (nunca en Alemania, por la demora). Es la opción correcta para el piloto y el crecimiento. Cuando llegue el primer cliente regulado por ASFI, la base de datos se muda a un proveedor más caro y más formal.

**Sobre las fotos**

Van a **Cloudflare R2**, que no cobra por mirarlas. Esto importa muchísimo porque los supervisores y las auditorías *se pasan el día abriendo fotos*. Con el proveedor tradicional (Amazon), eso genera facturas sorpresa.

**Sobre qué falta para vender**

Cuatro cosas bloquean el primer cliente. Ninguna es difícil; ninguna está hecha:

1. **Las fotos hoy se guardan en el disco de la propia computadora.** Es como guardar las escrituras en el cajón del escritorio en vez de la caja fuerte: si esa máquina se rompe o se actualiza, se pierden. Y las fotos **son el producto**.
2. **No existe la "receta" para instalar Kobrax en un servidor de verdad.** Hoy sólo arranca en la computadora de desarrollo.
3. **No hay respaldos automáticos de la base de datos**, ni se probó nunca restaurar uno.
4. 🔴 **La cuenta de Google Play tiene que ser de empresa, y esa verificación tarda de 2 a 4 semanas.** Esto no es trabajo: es *espera*. **Hay que iniciar el trámite ya**, no cuando la app esté lista, o vamos a tener la app terminada mirando el techo durante un mes.

Los tres primeros suman **entre 7 y 9 días de trabajo**.

---

## 2. Qué estamos vendiendo, exactamente

Kobrax reemplaza tres cosas que hoy el cliente ya paga, aunque no las vea en ninguna factura:

1. **La planilla de papel o el Excel** que el cobrador llena a mano y después alguien transcribe.
2. **La imposibilidad de saber qué está pasando en la calle** hasta que el cobrador vuelve a la oficina.
3. **La falta de prueba** cuando el deudor dice "a mí nunca me visitaron".

Ese tercer punto es el corazón del producto. Cuando el cobrador registra una visita, la app guarda la foto, la ubicación GPS y una **huella digital del archivo** — un código único que cambia si alguien modifica la foto aunque sea un píxel. **[VERIFICADO-CÓDIGO]** Eso convierte una visita en una prueba que se sostiene ante un juez o ante ASFI.

Por eso la unidad de cobro natural es **el cobrador equipado**: cada cobrador con la app instalada genera visitas trazables y evidencia sellada.

### Por qué cobrar por cobrador y no de otra forma

Evaluamos cuatro maneras de cobrar:

| Forma de cobrar | A favor | En contra | Veredicto |
|---|---|---|---|
| **Por cobrador por mes** | Predecible para los dos lados. Crece junto con el valor que entrega. **Y ya está programado**: el sistema ya sabe limitar cuántos usuarios puede tener una cuenta **[VERIFICADO-CÓDIGO]** | Un cliente chico con pocos cobradores paga poco | ✅ **La elegida** |
| Por tamaño de cartera (cantidad de créditos) | Se alinea con el tamaño del problema del cliente | La cantidad de créditos sube y baja todo el tiempo. Es difícil de auditar para el cliente. Y peor: **le da un incentivo a no cargar toda la cartera** para pagar menos | Sirve como *límite del plan*, no como precio |
| Comisión sobre lo recuperado | Vende solo: "gano si vos ganás" | Requiere que cada pago esté perfectamente conciliado, **invita a registrar cobros por fuera del sistema**, y ninguna financiera comparte un porcentaje de su recupero con un proveedor de software | ❌ Descartado como modelo. Sirve sólo como argumento de venta (§4) |
| Mixto: base fija + por cobrador | La base fija cubre lo que cuesta *tener* al cliente (soporte, capacitación, almacenamiento) más allá de cuántos cobradores tenga | Un número más que explicar en la reunión | ✅ Para el plan Institucional |

### El mercado boliviano — quién compra y cómo

*(Todo lo de este bloque es [SUPUESTO], basado en conocimiento de mercado. La fundadora puede corregirlo mejor que nadie: trabajó un año como cobradora en Banco FIE y ascendió a encargada regional en Chuquisaca.)*

- **Quién firma el contrato** cambia completamente según el cliente:
  - En una **cooperativa de ahorro y crédito**: firma el gerente general con visto bueno del consejo. **La venta tarda de 2 a 6 meses.**
  - En una **casa comercial que vende a crédito**: firma el dueño, en una semana.
  - Un **cobrador independiente**: decide él, hoy mismo.

  Por eso hay tres planes distintos y no uno: son tres compradores con tres lógicas distintas.

- **Cómo pagan**: las cooperativas y financieras necesitan factura, contrato anual y orden de servicio; desconfían del débito automático con tarjeta. El cobrador independiente paga por QR.

- **Cuánto pueden pagar**: un cobrador de campo gana entre **Bs 2.800 y Bs 4.000 al mes** (unos $239–342 al cambio de hoy). Un software que cuesta el 3% del sueldo de la persona que hace productiva es invisible en el presupuesto. Uno que cuesta el 20% se discute en directorio.

  ⚠️ **Cuidado con la lectura fácil de este número.** En la primera versión decía "$400–575" porque el dólar valía Bs 6,96. El sueldo no bajó: bajó el número cuando se lo traduce a dólares. Lo que importa para vender es el **precio en bolivianos contra un sueldo en bolivianos** — y ahí el producto se encareció (§3).

- **La ventaja que nadie puede copiar**: la fundadora conoce el trabajo del cobrador desde adentro y además dirigió a quienes lo hacen. El camino de entrada natural son las **cooperativas medianas de Chuquisaca y Potosí** y las **agencias de cobranza que trabajan para bancos** — no el banco directo, que es el cliente de dentro de tres años.

**Conclusión: se cobra por cobrador activo por mes, con factura mensual, y descuento de dos meses para quien paga el año por adelantado** (a las cooperativas les resulta más cómodo presupuestar una vez al año).

---

## 3. Los planes y sus precios

### 🔴 Primero: el tipo de cambio cambió, y esto afecta todo lo demás

**[VERIFICADO-2026-08]** Durante quince años, el dólar en Bolivia estuvo fijo en **Bs 6,96**. Ese número dejó de regir.

Al 13 de agosto de 2026:
- El **oficial** cotiza **Bs 11,71 por dólar**.
- El **paralelo** cotiza **Bs 11,47–11,50** — es decir, **por debajo** del oficial.

Esto último es notable: durante 2024 y 2025 el paralelo llegó a valer el doble que el oficial, y ese era el gran riesgo del negocio. **Esa brecha se cerró e incluso se dio vuelta.**

⚠️ **Antes de imprimir una lista de precios, confirmar el número del día en bcb.gob.bo.** Al verificar encontramos tres valores distintos dando vueltas (Bs 11,71, Bs 12,02, y hasta una página que todavía repetía el valor viejo como si siguiera vigente). **Sólo vale la fuente oficial.** Este documento usa Bs 11,71.

**Qué significa, en orden de importancia:**

**1. La buena noticia.** El riesgo de cobrar en bolivianos prácticamente desapareció. Antes, cobrar en Bs y pagar los servidores en dólares era peligroso: tu ingreso podía valer la mitad. Hoy no. La cláusula de revisión de precios sigue siendo prudente, pero dejó de ser urgente.

**2. La noticia cara.** Los precios en bolivianos **subieron un 68% sin que nadie los subiera**:

| Plan | Precio en USD | Antes (a Bs 6,96) | **Ahora (a Bs 11,71)** |
|---|---|---|---|
| Independiente | $15 | Bs 104 | **Bs 176** |
| Cartera (por cobrador) | $12 | Bs 84 | **Bs 141** |
| Institucional (base) | $99 | Bs 689 | **Bs 1.159** |
| Institucional (por cobrador) | $10 | Bs 70 | **Bs 117** |
| Enterprise | $800 | Bs 5.570 | **Bs 9.368** |

Y el sueldo del cobrador boliviano no subió 68% en bolivianos. **En términos reales, el producto se le encareció al cliente.**

**3. La decisión que se abre.** El margen es tan alto (§10) que hay lugar para bajar el precio en dólares y sostener la lista en bolivianos cerca de donde estaba. Con la infraestructura costando entre el 4% y el 11% de lo facturado, una lista de **Bs 120 por cobrador (≈ $10)** en lugar de Bs 141 **sigue dejando más del 70% de margen bruto.**

**Esta decisión es de la fundadora, no del documento.** Ella sabe qué número tolera una cooperativa de Chuquisaca mejor que cualquier análisis. Lo único que el análisis puede afirmar es: **el costo no obliga a cobrar Bs 141.**

**Recomendación de fondo (sin cambios):** listar los precios **en bolivianos con IVA incluido** — el cliente boliviano piensa en bolivianos y ASFI exige contratos en moneda local — con una cláusula de revisión anual. No atar el contrato al dólar paralelo: es ilegal facturar en él, y ahora además es innecesario.

### La tabla de planes

| | **Independiente** | **Cartera** | **Institucional** | **Enterprise** |
|---|---|---|---|---|
| **A quién le vendo** | Cobrador que trabaja por su cuenta, prestamista | Agencia de cobranza, casa comercial | Cooperativa, financiera chica | Banco, financiera regulada por ASFI, multi-regional |
| **Precio** | **$15/mes** (Bs 176) | **$12 por cobrador**, mínimo 5 → desde $60 (Bs 141 c/u) | **$99 + $10 por cobrador** (Bs 1.159 + 117) | **Desde $800/mes**, contrato anual (Bs 9.368+) |
| Cuántas personas pueden entrar | 2 | hasta 25 | hasta 100 | sin límite |
| Créditos activos | 300 | 5.000 | 30.000 | sin límite |
| Fotos por mes | 1.000 | 15.000 | 100.000 | sin límite |
| Cuánto tiempo se guardan las fotos | 12 meses | 24 meses | 5 años | a medida (según norma ASFI) |
| Sucursales | 1 | 3 | sin límite | sin límite |
| Soporte | Email, 48 h | Email 24 h + WhatsApp | Capacitación inicial + horario laboral | Contrato de servicio + un responsable de cuenta |
| Extras | — | Carga automática de extractos en PDF/CSV | Multi-sucursal, auditoría exportable | Instalación en servidores del cliente, informe de cumplimiento |

**Un detalle interesante:** el sistema **ya tiene programados** los cuatro nombres de plan **[VERIFICADO-CÓDIGO]**, pero están deliberadamente inactivos. Se decidió en su momento que **la única restricción real fuera la cantidad de usuarios**, y todo lo demás se controlara a mano. Fue una buena decisión: evitó construir un sistema de planes antes de saber qué planes se iban a vender.

### Qué justifica pasar de un plan al siguiente

- **De Independiente a Cartera**: necesitar más de 2 personas, y sobre todo la **carga automática de extractos**. Un cobrador independiente carga sus créditos a mano; una agencia vive de importar el archivo que le manda la financiera. Esa función **ya está construida [VERIFICADO-CÓDIGO]**.
- **De Cartera a Institucional**: manejar varias sucursales (ya está en el sistema), guardar las fotos por más años, y tener más de un supervisor mirando el panel.
- **De Institucional a Enterprise**: un contrato de servicio con penalidades, el informe de cumplimiento para ASFI, la retención según norma, y la conversación sobre instalarlo en los servidores del propio banco.

### Qué de todo esto se puede cobrar hoy, y qué hay que construir

Esto es importante para no vender algo que el sistema todavía no sabe hacer cumplir:

| Límite del plan | ¿Funciona hoy? |
|---|---|
| Cantidad de usuarios | ✅ **Sí, ya funciona.** El sistema no deja agregar un usuario de más **[VERIFICADO-CÓDIGO]** |
| Suspender una cuenta que no pagó | 🟡 A medias: el estado "suspendida" existe, pero **nada impide que sigan entrando**. Falta programarlo. **Esfuerzo: medio día.** *(En un software de cobranzas, no poder cortarle el servicio a un moroso tiene su ironía.)* |
| Máximo de créditos por plan | ❌ Hay que construirlo. Es contar y comparar contra el techo. **Un día.** |
| Máximo de fotos por mes | ❌ Hay que construirlo. Un contador mensual. **Bajo.** |
| Borrar fotos viejas según el plan | ❌ Hay que construirlo, **pero es más fácil de lo que parecía.** Ver §7: existe una forma de "archivar" las fotos viejas que las abarata sin borrarlas ni romper la promesa de que la evidencia es inalterable |
| Facturación y cobro automático | ❌ **No existe nada.** Para el piloto: factura a mano y cambio de plan a mano. Alcanza tranquilamente hasta unos 15 clientes. |

---

## 4. Cuánto le cuesta hoy al cliente el problema que resolvemos

*(Cifras [SUPUESTO], de orden de magnitud. La fundadora las puede afinar mejor que nadie.)*

Esta sección existe para una sola cosa: **poder decir en una reunión de ventas por qué $12 es barato.**

| Lo que el cliente ya está pagando | Cuánto |
|---|---|
| Sueldo de un cobrador de campo, con cargas sociales | Bs 3.500–5.500/mes (~$299–470) |
| Un supervisor consolidando planillas en Excel media jornada | ~Bs 2.000/mes de tiempo perdido |
| Mora que no se gestiona por no saber a quién visitar primero | En una cartera de 5.000 créditos con 8% de mora, **cada punto de recupero adicional son decenas de miles de bolivianos por mes** |
| Un juicio perdido o un reclamo en ASFI porque "no hay constancia de la visita" | Bs 10.000–70.000 por caso, más la sanción |
| Combustible y tiempo perdido en rutas mal armadas | 10–20% de la jornada del cobrador |

**El argumento de venta, en una frase:** el plan Cartera a $12 por cobrador es el **2 a 4% de lo que cuesta ese cobrador**. Si la app le hace recuperar **una sola cuota más por mes**, ya se pagó sola.

**Y el número para la diapositiva:** una agencia externa cobra entre 15% y 30% de lo que recupera. Kobrax cuesta el equivalente a **0,1–0,5% de lo recuperado** por un cobrador típico.

### Contra qué nos compara el cliente

| Alternativa | Cuánto le cuesta | Por dónde le ganamos |
|---|---|---|
| **Excel + WhatsApp + papel** | "Gratis" | Sin prueba legal, sin GPS, sin supervisión, sin historial. **Este es el competidor real del 80% del mercado** — no otro software |
| El módulo de cobranzas del sistema central del banco | $10.000 a $100.000+ de licencia e implementación | No funciona sin internet en la calle, no toma fotos con GPS, y tarda un año en implementarse |
| ERPs con "módulo de cobranzas" | $200–800/mes | Están hechos para cobrar por teléfono desde un escritorio, no para el campo boliviano |
| Apps regionales de cobranza en campo (colombianas, mexicanas) | $15–40 por usuario/mes | Sin presencia en Bolivia, sin soporte local, sin la carga de extractos de las financieras de acá, y con precios en dólar duro |

Nuestro precio entra **por debajo** de los competidores regionales y a una fracción del sistema bancario.

---

## 5. Cuánto cuesta operar Kobrax

### Qué hay que tener prendido para que funcione

**[VERIFICADO-CÓDIGO]** Kobrax no es un solo programa: son varias piezas que trabajan juntas. Esto es lo que hay que pagar por mes:

| # | Pieza | Para qué sirve, en criollo |
|---|---|---|
| 1 | **Base de datos (PostgreSQL)** | El archivo maestro. Todo lo importante vive acá. Tiene además una protección que hace que **una empresa no pueda ver los datos de otra ni por error de programación** |
| 2 | **Memoria rápida (Redis)** | Una libreta de apuntes veloz: recuerda quién está conectado y evita que alguien golpee el sistema mil veces por segundo |
| 3 | **El cerebro (la API)** | El programa que recibe cada pedido, decide si esa persona tiene permiso, y responde |
| 4 | **El panel web** | Lo que ven los supervisores en la computadora |
| 5 | **El calculador de rutas (OSRM)** | Arma el recorrido del cobrador por calles reales. Lo tenemos **instalado en nuestro propio servidor** en vez de pagarle a Google — un ahorro grande, ya funcionando |
| 6 | **El depósito de fotos** | ⚠️ **Hoy es el disco de la propia computadora.** Ver §7: esto es un problema serio |
| 7 | **Envío de correos** | Invitaciones y recuperación de contraseña. Hoy sale de una cuenta de Gmail |
| 8 | **Los mapas** | ⚠️ Hoy usamos los mapas gratuitos de OpenStreetMap, **cuyas reglas prohíben usarlos en un producto comercial**. Hay que resolverlo antes de vender |
| 9 | ~~Notificaciones push al celular~~ | **No existen.** Están simuladas: el sistema hace como que las manda **[VERIFICADO-CÓDIGO]**. No bloquean la venta (§11) |

### Cuánto van a pesar las fotos — la cuenta que define el costo

Esta es la única cuenta del documento que conviene entender en detalle, porque **es lo único que crece para siempre**. La base de datos crece poco; las fotos crecen todos los días y nunca se achican.

La fórmula es simple:

```
Espacio por mes = cobradores × visitas por día × fotos por visita × días hábiles × peso de cada foto
```

**Cuánto pesa una foto:** acá hay un hallazgo importante. La app del celular guarda las fotos **a la mitad de calidad, pero sin achicarlas de tamaño** **[VERIFICADO-CÓDIGO]**. La documentación del proyecto promete que las achica a 800 KB, **pero eso nunca se programó**. Resultado: cada foto pesa entre **0,5 y 1,5 MB**. Usamos **0,8 MB** como promedio.

Con los supuestos de 30 visitas por día, 1,5 fotos por visita y 22 días hábiles:

```
Un cobrador genera: 30 × 1,5 × 22 × 0,8 MB = 792 MB ≈ 0,8 GB por mes
```

| Etapa | Cobradores | GB nuevos por mes | GB acumulados al año |
|---|---|---|---|
| **A — Piloto** | 20 | 16 GB | ~190 GB |
| **B — Crecimiento** | 150 | 119 GB | ~1,4 TB |
| **C — Escala** | 800 | 634 GB | ~7,6 TB |

> ### 💡 La palanca de ahorro más rentable de todo el documento
>
> **Achicar las fotos a un tamaño razonable (unos 1280 píxeles de ancho) baja el peso de 0,8 MB a ~0,3 MB.** Es decir: **62% menos de almacenamiento, para siempre.**
>
> Cuesta **un día de trabajo** en la app del celular.
>
> Beneficia dos veces: pagamos menos almacenamiento, **y el cobrador gasta menos de su propio plan de datos** subiéndolas.
>
> Y no rompe nada: la huella digital de seguridad se calcula sobre la foto que efectivamente se sube, así que se sigue sellando exactamente lo que se guarda.
>
> **Debería hacerse antes del piloto.**

**Sobre la base de datos:** también crece, pero muy poco en comparación — alrededor de **1 GB por mes** en la etapa de crecimiento. Irrelevante para el costo. Lo único a vigilar es la tabla que registra *cada acción que cada persona hace en el sistema*: hacia la etapa C va a necesitar que se archiven los registros viejos.

---

### Etapa A — Piloto (1 a 3 clientes, ~20 cobradores)

**Todo entra en una sola computadora alquilada.** La carga real es baja: 20 personas usándolo de a ratos, y la app del celular está diseñada para funcionar sin internet y sincronizar después, en ráfagas.

> **Sobre los precios de Contabo:** los publica en euros y con distintos precios según cuánto te comprometas. Los de abajo son los de **24 meses**; el precio **mes a mes sale entre 15% y 20% más caro** — y mes a mes es la forma correcta de arrancar un piloto: no conviene atarse a dos años antes del primer cliente.
> Conversión usada: **€1 = $1,16** [SUPUESTO — verificar el día de contratar].

| Qué | Detalle | USD/mes |
|---|---|---|
| **La computadora** — Contabo "Cloud VPS 8": 8 procesadores, 24 GB de memoria, 300 GB de disco, ubicada en EE.UU. | Corre todo: el cerebro, el panel, la base de datos, la memoria rápida y el calculador de rutas | **~$18** (a 24 meses) · **~$21** (mes a mes) *[VERIFICADO-2026-08: €14,00 + €1,55 de recargo por estar en EE.UU.]* |
| **Depósito de fotos** — Cloudflare R2 | 190 GB al cerrar el año, menos los 10 GB que regalan | **~$3** *[VERIFICADO-2026-08]* |
| **Respaldos** de la base de datos — Backblaze B2 | ~50 GB de copias, menos 10 GB gratis | **menos de $1** *[VERIFICADO-2026-08]* |
| Dominio (kobrax.bo) + DNS | $12 al año | $1 |
| Certificado de seguridad (el candadito del navegador) | Gratis y automático | $0 |
| **Envío de correos** — Resend | **3.000 correos por mes gratis.** De sobra para el piloto, y más confiable que Gmail | **$0** *[VERIFICADO-2026-08]* |
| **Mapas** | ⚠️ **Acá hay una corrección.** Los planes gratuitos de MapTiler y de Stadia son **explícitamente para uso no comercial** — un piloto pago no califica. Queda **OpenFreeMap**, que es gratis de verdad pero lo mantiene una comunidad y no garantiza nada. Si se quiere un respaldo contractual: **Stadia Starter, $20/mes** | **$0** (o $20) |
| Monitoreo (avisarnos si se cae) | Herramientas gratuitas | $0 |
| **TOTAL** | | **~$23–27/mes** *(con mapas pagos: $43–47)* |

**Costo por cobrador: ~$1,20 por mes.** Con 20 cobradores en plan Cartera se facturan $240 → **la infraestructura es el 10% del ingreso.**

> ⚠️ **Corrección respecto de la primera versión de este documento.** Decía "8 procesadores / 24 GB con disco rápido NVMe por $9–15". Ese precio no existe: el disco rápido es otra línea de producto de Contabo y **cuesta el doble** (~$34/mes). Para 20 cobradores el disco común alcanza perfectamente. El disco rápido es el paso siguiente, cuando la base de datos empiece a sentirlo — o directamente cuando se mude a su propia máquina en la etapa B.

---

### Etapa B — Crecimiento (~15 clientes, ~150 cobradores)

**Acá la base de datos se muda a su propia computadora.** El porqué está explicado en la §8, y es una de las decisiones más importantes del documento.

| Qué | Detalle | USD/mes |
|---|---|---|
| **Computadora de la aplicación** — Contabo "Cloud VPS 12": 12 procesadores, 48 GB | El cerebro, el panel, la memoria rápida y el calculador de rutas | **~$31** *[VERIFICADO-2026-08: €25,00 + recargo]* |
| **Computadora de la base de datos** — Contabo "Plus 8" con **disco rápido NVMe** | Sólo la base de datos. **Acá el disco rápido sí se justifica**: es la máquina que más trabaja con el disco | **~$34** *[VERIFICADO-2026-08: €28,00 + recargo]* |
| Depósito de fotos | 1,4 TB acumulado. **Si se achican las fotos: sólo 500 GB → $7,50** | ~$8–21 |
| Respaldos | 200 GB de copias + copia completa de la máquina | **~$3–5** *(la primera versión estimó $8; Backblaze salió más barato de lo esperado)* |
| Envío de correos | **Resend $20 por 50.000** o **Brevo $9 por 5.000**. A este volumen —invitaciones y recuperación de contraseña— alcanza Brevo | **~$9–20** *[VERIFICADO-2026-08]* |
| **Mapas** | Stadia Starter $20 o MapTiler Flex $30. ⚠️ **El riesgo real acá son los "paquetes de mapas sin internet"** que se baja la app del celular para funcionar sin señal: 150 cobradores bajándolos pueden consumir el plan entero solos. **Hay que medirlo antes de elegir** | **~$30–60** |
| Monitoreo | | $0–15 |
| Dominio y varios | | $2 |
| **TOTAL** | | **~$120–170/mes** |

**Costo por cobrador: ~$0,80–1,15.** Facturando ~$1.700 → **la infraestructura es el 7–10% del ingreso.**

---

### Etapa C — Escala (~60 clientes, ~800 cobradores)

Acá ya hay clientes regulados, así que parte del sistema tiene que poder defenderse ante una auditoría (§6).

| Qué | Detalle | USD/mes |
|---|---|---|
| 2 computadoras de aplicación + repartidor de carga | Dos cerebros trabajando en paralelo *(esto requiere una modificación al programa que todavía no está hecha)* | **~$62** |
| **Base de datos administrada por un tercero** — la pieza que sale de Contabo primero | Tres presupuestos reales *[VERIFICADO-2026-08]*: **DigitalOcean $122,10** (con copia de respaldo en vivo: ~$244) · **Supabase ~$150–200** (incluye recuperación al minuto exacto por $100) · **Neon ~$197** | **~$150–300** |
| Memoria rápida | En la misma máquina o aparte | $0–15 |
| Calculador de rutas en su propia máquina | Contabo chico | **~$8** |
| Depósito de fotos | 7,6 TB (con fotos achicadas: 2,9 TB). **Archivando lo de más de un año baja otro ~30%** | ~$45–115 |
| Respaldos con retención larga | ~1 TB | **~$10** *(la primera versión estimó $20)* |
| Envío de correos | Por volumen | ~$20–35 |
| Mapas | Plan profesional o servidor propio | ~$50–100 |
| Monitoreo y registro de errores | | ~$30–50 |
| **TOTAL** | | **~$380–700/mes** |

**Costo por cobrador: ~$0,48–0,88.** Facturando $8.000–10.000 → **la infraestructura es el 4–8% del ingreso.**

> ⚠️ **Ojo con Neon.** La primera versión lo listó en "$50–100". Ese es el precio de una base de datos **que duerme la mayor parte del tiempo**. Neon cobra **por hora encendida**, y una base de datos de producción no se apaga nunca: 730 horas al mes son $77–162 sólo de encendido, más el almacenamiento. **A tiempo completo, Neon no es la opción barata.** DigitalOcean o Supabase salen menos.

---

### La conclusión de toda esta sección

**La infraestructura nunca es el problema económico de este negocio.** En ninguna etapa supera el 11% de lo facturado.

**El dinero de verdad se va en soporte, ventas y el tiempo de operar el sistema** — atender un problema, hacer un respaldo, revisar por qué algo anda lento. Por eso la decisión de qué proveedor usar **no es una decisión de plata: es una decisión de horas y de riesgo.**

---

## 6. ¿Contabo sí o no?

### Por qué sí

- **El precio por hardware es imbatible**: entre 4 y 6 veces más barato que Amazon, Google o Microsoft por las mismas prestaciones. Para un producto que factura en bolivianos, cada dólar de infraestructura pesa doble.
- Discos generosos, tráfico incluido de sobra, y **todo el sistema de Kobrax ya está preparado para correr en una sola máquina** — la "receta" ya está escrita **[VERIFICADO-CÓDIGO]**.

### Las contras que hay que decirse en voz alta

| Contra | Qué significa en la práctica |
|---|---|
| **No hay garantía de servicio real.** Si se cae, se cae; las compensaciones son simbólicas | Para el piloto: **aceptable**, y por una razón concreta — la app del celular funciona sin internet, así que una caída de dos horas **no detiene a los cobradores en la calle**, sólo al supervisor mirando el panel. Para un banco: **inaceptable** |
| **El soporte es lento** (tickets que tardan horas o días) | Si la máquina se muere un domingo, sos vos y tu respaldo |
| **No ofrecen base de datos administrada** | Los respaldos, las actualizaciones y las restauraciones son 100% tu problema. **Esta es LA razón para mudar la base de datos antes que cualquier otra cosa** |
| **Mala reputación de sus direcciones de internet** | Algunos filtros de correo las tienen marcadas. Consecuencia práctica: **nunca mandar correos desde esa máquina**, siempre a través de un servicio externo. Ya está diseñado así |
| **Demora desde Bolivia** | Si la máquina está en Alemania, cada clic tarda ~250 milisegundos de ida y vuelta y **se nota** en el panel. En Estados Unidos (Nueva York o St. Louis) son ~150 ms, que está bien. **Regla: contratar en EE.UU., nunca en Europa** |
| **Cumplimiento normativo / ASFI** | Cuando el cliente sea una entidad regulada, su área de riesgo va a preguntar dónde están los datos y qué certificaciones tiene el lugar. Contabo tiene certificaciones en algunos de sus centros **(verificar el específico)**, pero el nombre no tranquiliza a un oficial de riesgo como sí lo hace Amazon. **Hoy no es un impedimento legal** [SUPUESTO — consultar con un abogado antes de firmar con una regulada], **pero es fricción en la venta** |

### 🔴 Novedad grande: Hetzner dejó de ser la alternativa

**[VERIFICADO-2026-08 en la página oficial de Hetzner]** El 15 de junio de 2026, Hetzner —que este documento recomendaba como "plan B natural"— **aumentó sus precios entre 107% y 204%.**

En sus centros de Estados Unidos:

| Máquina | Antes | Después | Aumento |
|---|---|---|---|
| CCX13 (2 procesadores, 8 GB) | €16,99 | **€43,49** | +156% |
| CCX23 (4 procesadores, 16 GB) | €33,99 | **€87,49** | +157% |
| CPX11 | €5,99 | **€17,49** | +192% |
| CPX21 | €11,99 | **€31,99** | +167% |

Para dimensionarlo: **una máquina de 4 procesadores y 16 GB en Hetzner hoy cuesta €87,49 — más del doble que una de 12 procesadores y 48 GB en Contabo (€25,00).** Encima, sus máquinas en EE.UU. traen 1 TB de tráfico incluido contra los 20 TB de las europeas.

**Qué cambia esto:** el "plan B" pasa a ser **DigitalOcean** — más caro que el Contabo, pero con una marca que se puede defender ante un cliente y con base de datos administrada en la misma casa.

### Comparación de alternativas

| Proveedor | Máquina equivalente | USD/mes | Comentario |
|---|---|---|---|
| **Contabo** (EE.UU.) | 8 proc / 24 GB · con disco rápido | **~$18** · **~$34** | El más barato por lejos. Sin garantía de servicio real |
| **Hetzner** (EE.UU.) | 8 proc / 32 GB | **~$100+** | 🔴 **Descartado por precio desde junio 2026** |
| **Vultr** (São Paulo) | 8 proc / 32 GB | ~$190 | Única opción con centro en Sudamérica; los ~50 ms que ahorra no justifican el precio |
| **DigitalOcean** (Nueva York) | 8 proc / 32 GB | ~$168 [SUPUESTO] | Base de datos administrada en la misma casa (**$60,90** a **$122,10**). **Nuevo plan B** |
| **Amazon (AWS)** | equivalente | ~$250–400 [SUPUESTO] | Sólo cuando un cliente Enterprise lo exija por contrato |
| **Base de datos administrada suelta** | ver §5-C | DigitalOcean **$60,90–244** · Supabase **$25 + extras** · Neon **~$112–197** | Se combina con una máquina barata para la app: **la mejor relación riesgo/precio de las etapas B y C** |

> **La lección más importante de todo esto no es sobre Hetzner.** Es que **un proveedor barato puede triplicar su precio de un día para el otro**, y no hay nada que puedas hacer al respecto.
>
> Lo que sí podés hacer es **estar preparado para mudarte**. Kobrax hoy está armado de una forma estándar y portable **[VERIFICADO-CÓDIGO]**, y eso es exactamente lo que convierte "Contabo triplicó el precio" en **una tarde de trabajo** en vez de un proyecto de tres meses. **Vale la pena mantenerlo así.**

### Cuándo mudarse y a dónde

| Momento | Qué se hace |
|---|---|
| **Piloto (hoy)** | Todo en una máquina de Contabo en EE.UU. Riesgo asumido, y barato |
| **Primer cliente Institucional / ~10 clientes** | **Sacar la base de datos a un proveedor que la administre**: con los precios de hoy, **Supabase (~$50–60) o DigitalOcean ($60,90)** antes que Neon. Ganás respaldos automáticos y restauración de un clic. Todo lo demás sigue en Contabo. **Costo: +$60–160/mes** |
| **Primer cliente regulado por ASFI / Enterprise** | La aplicación se muda a DigitalOcean o Amazon, con un contrato de servicio que se pueda mostrar (**Hetzner ya no compite en precio**), o se abre la conversación de instalarlo en los servidores del propio cliente |

---

## 7. Dónde guardar las fotos

### El problema, primero

**[VERIFICADO-CÓDIGO]** Hoy las fotos **se guardan en el disco de la misma computadora donde corre el sistema**.

Es como guardar las escrituras de la casa en el cajón del escritorio en vez de en la caja fuerte. Funciona perfectamente... hasta que la computadora se rompe, se reemplaza o se actualiza. Y entonces se perdieron.

**Las fotos son el producto.** Sin ellas, Kobrax es una planilla con GPS.

Detalles de lo que hay hoy:
- Cada foto se guarda con su huella digital como nombre, con un máximo de 8 MB, y sólo acepta los formatos comunes de imagen.
- **No hay ninguna conexión a un depósito en la nube programada.** Hay una nota en el código, escrita por quien lo programó, que dice explícitamente que esa parte se escribe cuando haya dónde guardar.
- **Dato revelador**: una de las configuraciones ya tiene el valor `"auto"`, que es **la convención específica de Cloudflare R2**. Quien diseñó esto ya tenía R2 en la cabeza.
- Cuando alguien mira una foto desde el panel, **pasa por nuestro sistema**, que verifica que esa persona tenga permiso. Es más lento que servirla directo, pero es lo que garantiza que una empresa no vea las fotos de otra.

### Comparación de proveedores *[VERIFICADO-2026-08]*

Recordá la distinción clave del diccionario: **guardar** cuesta una cosa, y **mirar** puede costar otra.

| Proveedor | Guardar ($/GB por mes) | **Mirar** ($/GB) | Comentario |
|---|---|---|---|
| **Amazon S3** | 0,023 | **0,09** (los primeros 100 GB del mes, gratis) | **El "mirar" lo mata**: descargar 1 TB de fotos = **$90 de golpe** |
| **Cloudflare R2** | 0,015 | **$0 — gratis, siempre** | Regala 10 GB. ✅ **La elegida** |
| **🆕 Cloudflare R2 "acceso poco frecuente"** | **0,010** | **$0**, pero $0,01/GB cada vez que se pide | Mínimo 30 días guardado. Ver abajo: resuelve un problema que teníamos abierto |
| **Backblaze B2** | **0,00695** | Gratis hasta 3 veces lo que guardás | El más barato para guardar → **ideal para los respaldos** |
| Depósito propio en la misma máquina | ~$0 | $0 | ❌ **No sirve**: el disco de esa máquina **es justamente el riesgo** que queremos eliminar. Se muere con ella |
| Depósito de Contabo | ~0,01 [SUPUESTO] | $0, pero lento | Barato pero con velocidad limitada. Sirve para respaldos, no para mostrar fotos |

### Por qué Cloudflare R2

1. **Que mirar sea gratis es la variable que decide.** Los supervisores abren fotos todo el día, y una auditoría de un cliente Institucional puede descargarse meses de evidencia de una sentada. Con Amazon eso es una factura sorpresa; con R2 no cuesta nada.
2. **El costo es trivial en todas las etapas**: $3 · $8–21 · $45–115 por mes.
3. **Backblaze B2 para los respaldos**, por dos motivos: es la mitad de precio para guardar, y **tener los respaldos en otra empresa que los datos vivos es higiene básica** — si una falla, la otra sigue de pie.

### 🆕 Un hallazgo que resuelve un problema que teníamos abierto

La §3 dejó pendiente una contradicción incómoda: los planes prometen **borrar las fotos después de cierto tiempo**, pero uno de los principios del sistema es que **la evidencia es inalterable**. ¿Cómo borrás algo que prometiste no tocar nunca?

**Cloudflare tiene ahora una modalidad de "acceso poco frecuente"** que resuelve esto exactamente:

- La foto de más de un año **baja de $0,015 a $0,010 por GB**.
- **No se borra.** Sigue existiendo y sigue verificando contra su huella digital original.
- Sólo se paga un extra ($0,01/GB) **si alguien efectivamente la pide** — que por definición es el caso raro.

**El resultado:** ~30% menos de costo sobre todo lo que envejece, sin tocar la promesa de inmutabilidad ni el diseño del sistema. **La "retención por plan" deja de ser un borrado con implicancias legales y pasa a ser simplemente un cambio de estante.** Es la solución barata y la correcta al mismo tiempo.

### Qué hay que programar (1 a 2 días)

1. Instalar la librería oficial de Amazon (R2 es compatible con ella; sólo se le indica otra dirección).
2. Cambiar las dos funciones que hoy guardan y leen del disco. **La huella digital y la verificación de permisos no cambian** — tal como lo previó quien dejó la nota en el código.
3. Agregar un dato de configuración que hoy no existe (la dirección del depósito).
4. **Decisión de diseño:** seguir mostrando las fotos a través de nuestro sistema. Es más simple y mantiene intacto el control de quién ve qué. Alcanza hasta la etapa C.
5. **Mudar lo del piloto:** un solo comando copia todo. Como cada archivo se llama por su huella digital, no puede haber dos con el mismo nombre.

---

## 8. Cómo se arma todo esto en producción

### Etapa piloto: todo en una máquina

```
                        Internet
                           │
              Cloudflare (filtra ataques, gratis)
                           │
┌── Una computadora en Contabo, EE.UU. ────────────────────┐
│                                                          │
│   Portero (Caddy) — pone el candadito de seguridad       │
│         │                          │                     │
│   app.kobrax.bo              api.kobrax.bo               │
│   (el panel web)             (el cerebro)                │
│                                    │                     │
│   Base de datos ───────────────────┘                     │
│   Memoria rápida        (ninguna de estas tres es        │
│   Calculador de rutas    accesible desde afuera)         │
└──────────────────────────────────────────────────────────┘
            │                          │
    Fotos en Cloudflare R2      Respaldos en Backblaze B2
```

Tres decisiones de esta etapa:

- **El "portero" (Caddy)** consigue y renueva solo el certificado de seguridad — el candadito del navegador. Son quince líneas de configuración contra las cien de la alternativa tradicional.
- **La base de datos, la memoria rápida y el calculador de rutas no son accesibles desde internet.** Sólo el portero habla con el mundo. *(En la computadora de desarrollo sí están abiertos, porque es cómodo; en producción **no deben estarlo**.)*
- El panel web ya está diseñado para que **el navegador del usuario nunca hable directo con el cerebro** **[VERIFICADO-CÓDIGO]**. Eso significa que las credenciales nunca llegan al navegador — una decisión de seguridad que ya está tomada y funcionando.

### Etapa crecimiento: la base de datos se muda

```
Máquina 1 (aplicación):  portero + panel + cerebro + memoria + rutas
Máquina 2 (datos):       sólo la base de datos    ← o directamente administrada por un tercero
Fotos en R2                    Respaldos en B2
```

**Por qué separar la base de datos — cuatro razones, en orden de importancia:**

1. **Los síntomas se cruzan y no sabés a quién culpar.** Cuando alguien importa un extracto de 30.000 filas o exporta un Excel grande, esa tarea consume toda la máquina **justo cuando la base de datos más la necesita**. El panel "se pone lento" y no hay forma de saber cuál de los dos tiene la culpa. Separadas, cada una tiene su propio presupuesto de recursos.

2. **El radio de la explosión.** Una actualización que sale mal, un disco lleno de registros o un programa que consume toda la memoria **tumban la máquina entera**. Si la base de datos vive ahí, **un descuido de programación se convierte en un incidente de datos**. Y la base de datos es lo único que no se puede reconstruir: el programa se vuelve a instalar en minutos; los datos, no.

3. **Respaldos y restauraciones en serio.** Con la base de datos sola se pueden hacer copias del disco completo y **ensayar restauraciones sin tocar la máquina que está atendiendo clientes**.

4. **Es el camino a mudarla afuera.** Si la base de datos ya vive sola, mudarla a un proveedor que la administre es cambiar una línea de configuración. Si vive enredada con todo lo demás, es un proyecto.

La memoria rápida y el calculador de rutas se quedan con la aplicación: si se pierden, se regeneran solos.

### Etapa escala

Dos máquinas de aplicación con un repartidor de carga adelante, una modificación al programa para que las dos se coordinen (**hay que construirla**), base de datos administrada con copia en vivo, y el calculador de rutas en su propia máquina.

**Nada exótico.** La arquitectura actual aguanta creciendo hacia arriba mucho antes de necesitar esto.

---

## 9. Qué falta para poder vender — la lista completa

**Lo que ya está hecho y funcionando [VERIFICADO-CÓDIGO]:** el sistema avisa si está sano, frena a quien lo golpee demasiado, tiene las protecciones de seguridad estándar, **impide que una empresa vea los datos de otra a nivel de la base de datos** (no sólo por programación, que es lo que suele fallar), registra cada acción de cada persona, y valida su propia configuración al arrancar. Tiene además **541 pruebas automáticas en el cerebro, 310 en la app del celular y 111 en el panel**.

**Lo que no existe:** ninguna receta de instalación para producción, ningún proceso automático que revise el código antes de publicarlo, ninguna configuración de portero, ningún respaldo, y ninguna configuración para publicar la app en las tiendas.

### 🔴 BLOQUEANTES — sin esto no hay primer cliente

| # | Qué hay que hacer | Por qué | Cuánto |
|---|---|---|---|
| 1 | **Conectar las fotos a Cloudflare R2** | Hoy se guardan en el disco de la máquina y **mueren con ella**. Las fotos SON el producto | 1–2 días |
| 2 | **Escribir la "receta" de instalación para producción** | Hoy el sistema sólo arranca en modo desarrollo | 2–3 días |
| 3 | **Dominio + certificado de seguridad** | Sin candadito no funcionan ni las sesiones del panel ni el guardado seguro en el celular. Y ningún cliente serio acepta un sitio sin candadito | Medio día |
| 4 | **Generar las claves de producción y guardarlas fuera del servidor** | ⚠️ **Esto es lo más delicado de toda la lista.** Hay una clave que cifra los datos sensibles de los clientes. **Si se pierde, esos datos se pierden para siempre — no hay forma de recuperarlos, ni siquiera con los respaldos.** Es el secreto más crítico de la empresa. Va en un gestor de contraseñas, con un procedimiento escrito de quién lo tiene | Medio día + escribir el procedimiento |
| 5 | **Aplicar y verificar el aislamiento entre empresas en el servidor real** | Es la promesa central del producto: que una empresa no vea los datos de otra. **Está programado, pero nunca se probó contra una base de datos real.** Hay que probarlo con dos empresas de prueba antes de que haya una de verdad | 1 día |
| 6 | **Respaldos automáticos + probar UNA restauración completa** | **Un respaldo que nunca se restauró no es un respaldo, es una carpeta.** Hay que hacer la restauración una vez, cronometrarla y anotar cuánto tardó. Con evidencia legal de por medio, perder la base de datos es perder la empresa | 1 día |
| 7 | **Correo profesional** | Gmail corta a los ~500 correos por día y puede cancelar el acceso sin aviso. Las invitaciones y las recuperaciones de contraseña **son parte del alta de un cliente**: si fallan, el cliente no puede ni empezar | Medio día |
| 8 | **Apuntar todo a las direcciones reales** | Hoy todo apunta a la computadora de desarrollo | 2 horas |

**Total: 7 a 9 días de trabajo.**

### 🔴 Y uno que no es trabajo sino ESPERA — empezar ya

| # | Qué | Por qué |
|---|---|---|
| **15b** | **Abrir la cuenta de Google Play como EMPRESA (con número D-U-N-S). Iniciar el trámite ahora, antes que cualquier otra cosa de esta lista** | **[VERIFICADO-2026-08]** Google cambió las reglas: las cuentas **personales** creadas después de noviembre de 2023 **no pueden publicar una app** sin antes hacer una prueba cerrada con **12 personas usándola durante 14 días corridos e ininterrumpidos**. Las cuentas de **empresa verificadas están exentas** — pero **la verificación tarda de 2 a 4 semanas**. Kobrax es una empresa: le corresponde la cuenta de empresa de todos modos. **El riesgo es puramente de calendario**: si esto se descubre el día que la app está lista, son 2 a 4 semanas con la app terminada sin poder publicarla. **Trámite: 1 hora. Espera: 2 a 4 semanas.** |

### 🟡 IMPORTANTE — primeras semanas de producción

| # | Qué | Por qué | Cuánto |
|---|---|---|---|
| 9 | **Achicar las fotos en el celular** | **La palanca del 62% del almacenamiento** (§5), y de paso el cobrador gasta menos de su propio plan de datos | 1 día |
| 10 | **Contratar mapas de verdad** | Los mapas gratuitos que usamos **prohíben el uso comercial en sus reglas**. Además, los paquetes que la app se baja para funcionar sin señal son de alto volumen | Medio a 1 día |
| 11 | **Monitoreo y alertas** | Sin esto, **el que se entera de que el sistema se cayó es el cliente** | 1 día |
| 12 | **Guardar los registros de errores en un solo lugar** | Depurar un problema en producción sin registros es adivinar | Medio a 2 días |
| 13 | **Revisión automática antes de publicar** | Las 962 pruebas automáticas ya existen; hoy **el único guardián de que se corran es la disciplina de la programadora** | 1 día |
| 14 | **Procedimiento escrito de publicar y de dar marcha atrás** | **La primera publicación con miedo se hace a las 2 de la mañana.** Tener el procedimiento escrito antes evita improvisar en el peor momento | 1 día |
| 15 | **Publicar la app en las tiendas** | Los cobradores no van a usar herramientas de desarrollo en producción. Cuenta de Google Play ($25 una vez) y de Apple ($99 al año) | 2–3 días + espera de las tiendas (Android días, Apple 1–2 semanas) |
| 16 | **Poder suspender a un cliente que no paga** | Sin esto no hay forma de cortarle el servicio a un moroso... en un software de cobranzas | Medio día |

### 🟢 DESPUÉS — cuando llegue la etapa B

Separar la base de datos · la modificación para que dos máquinas se coordinen · archivar los registros viejos de auditoría · la política de retención de fotos por plan · los límites de créditos y fotos por plan · facturación automática · un ambiente de pruebas separado del real.

---

## 10. El modelo financiero

### Los costos que no son infraestructura — los que siempre se olvidan

| Qué | Cuánto | Comentario |
|---|---|---|
| Cuenta de desarrollador de Apple | **$99 al año** *[VERIFICADO-2026-08]* | Obligatoria para iPhone |
| Cuenta de Google Play | **$25, una sola vez** *[VERIFICADO-2026-08]* | ⚠️ Cuenta de **empresa** — ver §9 #15b |
| Servicio de compilación de la app (Expo) | **$0** (30 compilaciones/mes gratis) → **$199/mes** el escalón siguiente *[VERIFICADO-2026-08]* | ⚠️ **Corrección:** la primera versión decía "$0–99". **El escalón sobre el plan gratuito saltó a $199.** Pero el plan gratuito alcanza de sobra: un producto así no hace 30 compilaciones por mes. Presupuestar $199 recién cuando duela |
| Cobrar por QR o tarjeta en Bolivia | ~1,5–3% por transacción [SUPUESTO — cotizar] | El QR interoperable a través de un banco propio es lo más barato; las tarjetas cuestan 3–5% |
| **Impuestos sobre la factura** | **IVA 13% + IT 3% ≈ 16% de lo facturado** | La facturación electrónica es obligatoria. ⚠️ **El precio de lista tiene que pensarse con IVA incluido**, o la cooperativa te lo va a descontar igual |
| Contador y facturación | ~Bs 700–1.500/mes | Desde la primera factura |
| **Soporte — tu tiempo o el de alguien** | **El costo dominante real a partir de ~10 clientes** | |

### Cuántos cobradores hacen falta para cubrir los costos

*(Sin contar sueldos. Neto de impuestos y comisión de cobro, cada asiento de $12 deja ~$9,70.)*

| Etapa | Costo mensual total | **Cobradores para cubrirlo** |
|---|---|---|
| A | $37 | **4** |
| B | $160 | **17** |
| C | $560 | **58** |

### Margen bruto

| Etapa | Se factura | Menos impuestos y comisión (~19%) | Menos infraestructura | **Queda** | **Para qué alcanza** |
|---|---|---|---|---|---|
| **A**: 20 asientos ≈ $240 | $240 | $194 | $37 | **$157 (65%)** | Un piloto no paga un sueldo — y no tiene por qué: **paga el aprendizaje** |
| **B**: 150 asientos ≈ $1.900 | $1.900 | $1.540 | $160 | **$1.380 (73%)** | ~2 sueldos bolivianos de soporte, o 1 de la fundadora |
| **C**: 800 asientos + 2 Enterprise ≈ $10.500 | $10.500 | $8.500 | $560 | **$7.940 (76%)** | Un equipo de 4 a 6 personas en Bolivia |

### Las dos conclusiones honestas

**1. Reverificar todos los precios no movió el caso de negocio.** Contabo salió un poco más caro de lo estimado, Hetzner explotó pero no lo usábamos, Backblaze salió más barato, Neon salió mucho más caro, los mapas dejaron de ser gratis. Neto: **el margen se movió 1 o 2 puntos** y el punto de equilibrio de la etapa B pasó de 13 a 17 cobradores. **La infraestructura sigue sin ser el problema económico de este negocio.**

**2. El negocio se convierte en un sueldo real entre las etapas A y B — alrededor de 60 a 80 asientos vendidos.** Antes de eso, cada mes de piloto cuesta menos que una cena afuera. **La presión no es de caja: es de velocidad de venta.**

> ⚠️ **El riesgo económico de verdad no está en ninguna de estas tablas: es el precio en bolivianos (§3).**
>
> Ajustar la lista de Bs 141 a Bs 120 por cobrador **borra más margen que todos los proveedores de infraestructura juntos.** Ahí está la decisión que mueve la aguja, no en si el servidor sale $18 o $34.

---

## 11. Decisiones abiertas — resolver ANTES de vender el primer plan

| # | Decisión | Recomendación |
|---|---|---|
| 1 | 🔴 **¿A qué precio en bolivianos?** *(la pregunta cambió de forma)* El riesgo cambiario se disolvió — el paralelo hoy está **por debajo** del oficial. Pero al pasar de Bs 6,96 a Bs 11,71, **la lista en bolivianos subió 68% sin que nadie la subiera** | Listar **en bolivianos con IVA incluido**, con revisión anual. **La decisión pendiente es tuya: sostener $12 (= Bs 141) o recalibrar a ~Bs 120 (= $10).** El costo no obliga a Bs 141: con la infraestructura en 4–11% del ingreso, Bs 120 sigue dejando más del 70% de margen. **Quién sabe qué tolera una cooperativa de Chuquisaca sos vos, no este documento** |
| 2 | **¿Quién paga el plan de datos del cobrador?** Las fotos suben por su celular | Dejarlo explícito en el contrato (lo paga el empleador). **Achicar las fotos (§9 #9) reduce este argumento casi a nada** |
| 3 | **¿De quién son las fotos si el cliente cancela?** | Definirlo ya: exportación completa a pedido + 90 días de gracia + certificado de borrado. **Es pregunta segura de toda cooperativa** |
| 4 | **¿Prueba gratis o piloto pago?** | **Piloto pago simbólico** (Bs 500/mes por 3 meses, después precio de lista). En este mercado, la prueba gratis se vuelve eterna. El sistema ya sabe manejar el estado "en prueba" **[VERIFICADO-CÓDIGO]** |
| 5 | **¿Qué pasa si se pierde una foto que era prueba judicial?** | Límite de responsabilidad en el contrato, y los respaldos de la §9 como respaldo técnico. Consultar a un abogado una vez y reutilizar el contrato |
| 6 | **¿Cuándo construir la facturación dentro del producto?** | **No antes de 10 clientes pagando.** Hasta ahí, factura a mano. Los planes ya están programados pero dormidos, y **está bien que sigan así** |
| 7 | **Aceptar el riesgo de Contabo, por escrito** | Documentarlo internamente: *"el piloto corre sin garantía de servicio; la base de datos se muda al primer cliente Institucional"*. **Que no sea una sorpresa futura sino un plan** |
| 8 | **¿Y las notificaciones al celular?** | **No existen** (están simuladas) **y no bloquean la venta**: el cobrador vive dentro de la app, y el panel se actualiza solo. **Posponer hasta que un cliente las pida con nombre y apellido** |

---

## 12. Dónde verificar cada precio

Todos estos enlaces se consultaron el **13 de agosto de 2026**. Los precios de infraestructura se mueven — el caso Hetzner (§6) es la prueba.

**Revisar esta lista antes de contratar cualquier cosa y antes de comprometer un precio con un cliente.**

### Servidores

| Qué mirar | Dónde |
|---|---|
| **Contabo — precios de servidores** (ojo: cambian según si te comprometés a 1, 12 o 24 meses) | https://contabo.com/en/vps/ |
| Contabo — lista completa de productos | https://contabo.com/en-us/product-list/ |
| Contabo — **recargo por ubicación** (lo que cuesta tenerlo en EE.UU.) ⚠️ esa URL dio error al verificar; el recargo aparece al elegir la región durante la compra | https://contabo.com/en/location-fees/ |
| **Hetzner — el anuncio oficial del aumento de junio 2026** (leer antes de siquiera considerarlo) | https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/ |
| Hetzner — servidores | https://www.hetzner.com/cloud/ |
| DigitalOcean — bases de datos administradas | https://www.digitalocean.com/pricing/managed-databases |
| Vultr — servidores rápidos | https://www.vultr.com/products/high-frequency-compute/ |

### Bases de datos administradas

| Qué mirar | Dónde |
|---|---|
| **Neon** — ⚠️ cuidado: cobra por hora encendida (§5-C) | https://neon.com/pricing |
| **Supabase** — $25 el plan base; la recuperación al minuto exacto es un extra de $100 | https://supabase.com/pricing |

### Almacenamiento de fotos

| Qué mirar | Dónde |
|---|---|
| **Cloudflare R2** — incluye la modalidad de "acceso poco frecuente" (§7) | https://developers.cloudflare.com/r2/pricing/ |
| **Backblaze B2** — para los respaldos | https://www.backblaze.com/cloud-storage/pricing |
| Amazon S3 — sólo para comparar | https://aws.amazon.com/s3/pricing/ |

### Mapas, correo y tiendas de apps

| Qué mirar | Dónde |
|---|---|
| **MapTiler** — verificar si el plan gratuito sigue siendo sólo para uso no comercial | https://www.maptiler.com/cloud/pricing/ |
| **Stadia Maps** — su plan gratuito es explícitamente no comercial | https://stadiamaps.com/pricing/ |
| Expo — planes y límites del plan gratuito | https://docs.expo.dev/billing/plans/ |
| Expo — precios por uso | https://docs.expo.dev/billing/usage-based-pricing/ |
| **Google Play — la regla de los 12 probadores y la cuenta de empresa** (§9 #15b) | https://support.google.com/googleplay/android-developer/answer/14151465 |

### Tipo de cambio — el número que más importa de todo este documento

| Qué mirar | Dónde |
|---|---|
| **Banco Central de Bolivia — cotizaciones oficiales.** **Es la única fuente que vale**; las demás arrastran datos viejos | https://www.bcb.gob.bo/?q=cotizaciones_tc |
| Paralelo (referencia de mercado, no oficial) | https://dolarbolivia.net/ |

⚠️ Al verificar el tipo de cambio aparecieron **tres valores distintos**: Bs 11,71, Bs 12,02, y una página que todavía repetía el valor viejo como si siguiera vigente. **Sólo vale el Banco Central.** Este documento usa Bs 11,71.

---

## Anexo — Glosario completo

Todos los términos técnicos que aparecen en el documento, en orden alfabético.

| Término | Qué es |
|---|---|
| **API** | El "cerebro" del sistema: el programa que recibe cada pedido (traeme los clientes, guardá este pago), verifica que quien lo pide tenga permiso, y responde. El panel web y la app del celular **no hacen nada por su cuenta**: le preguntan a la API |
| **ASFI** | La Autoridad de Supervisión del Sistema Financiero de Bolivia — el organismo que regula bancos y financieras. Sus exigencias definen el plan Enterprise |
| **Auditoría / registro de auditoría** | Una lista que anota **quién hizo qué, cuándo y desde dónde**. Kobrax la tiene completa [VERIFICADO-CÓDIGO] |
| **Backup / respaldo** | Copia de seguridad de la base de datos, guardada en otro proveedor. **Un respaldo que nunca se probó restaurar no cuenta como respaldo** |
| **Base de datos** | El archivo maestro con todo: clientes, créditos, pagos, visitas. Lo único irreemplazable |
| **Certificado SSL / el candadito** | Lo que hace que el navegador muestre el candadito y que nadie pueda espiar la conexión. Es gratis y automático con la herramienta que elegimos |
| **Cloudflare** | Empresa que ofrece dos cosas que usamos: protección contra ataques (gratis) y el depósito de fotos R2 |
| **Compilar / build** | Convertir el código de la app en el archivo instalable que va a la tienda de Google o de Apple |
| **D-U-N-S** | Un número de identificación de empresas que Google exige para verificar una cuenta de desarrollador corporativa. Tramitarlo tarda semanas (§9 #15b) |
| **Deploy / puesta en marcha** | Sacar el sistema de la computadora de desarrollo y ponerlo a funcionar en internet de verdad |
| **Egress** | Lo que algunos proveedores cobran cada vez que alguien **mira o descarga** un archivo. Guardar es barato; mirar puede ser caro. Esta distinción decide el proveedor de fotos (§7) |
| **Encriptar / cifrar** | Convertir un dato en algo ilegible salvo que se tenga la clave. Kobrax cifra los datos sensibles de los clientes. ⚠️ **Si se pierde la clave, se pierden los datos para siempre** (§9 #4) |
| **GB / TB** | Medidas de tamaño. Una foto de celular ≈ 1 MB · mil fotos = 1 GB · un millón de fotos = 1 TB |
| **Hash / huella digital** | Un código único calculado a partir de un archivo. **Si alguien modifica la foto aunque sea un píxel, el código cambia.** Es lo que convierte una foto en prueba (§2) |
| **Multi-tenant / multi-empresa** | Que varias empresas usen el mismo sistema **sin poder ver los datos de las otras**. Es la promesa central de Kobrax, y está garantizada a nivel de la base de datos, no sólo por programación (§9 #5) |
| **NVMe** | Un tipo de disco mucho más rápido. Cuesta el doble. Vale la pena para la base de datos, no para el resto (§5) |
| **OSRM** | El calculador de rutas por calles reales. **Lo tenemos instalado en nuestro propio servidor** en lugar de pagarle a Google — un ahorro importante que ya está funcionando |
| **Panel web** | Lo que ven los supervisores y gerentes en la computadora |
| **PITR ("recuperación a un punto en el tiempo")** | Poder devolver la base de datos a cómo estaba en un minuto específico del pasado. Cuesta caro ($100/mes en Supabase) pero es la red de seguridad definitiva |
| **PostgreSQL** | El programa de base de datos que usamos. Gratuito y de calidad industrial |
| **Redis** | La "libreta de apuntes rápida": recuerda quién está conectado y frena a quien golpee el sistema demasiadas veces |
| **RLS (aislamiento a nivel de fila)** | La protección que hace que la propia base de datos rechace mostrar datos de otra empresa, **incluso si el programa tiene un error**. Es un cinturón además del tirante |
| **S3 / compatible con S3** | El formato estándar de la industria para depósitos de archivos en la nube. Que R2 sea "compatible con S3" significa que se conecta con las mismas herramientas |
| **Servidor / VPS** | Una computadora alquilada por mes, prendida siempre, en un centro de datos de otro país. Ahí vive Kobrax |
| **SLA / garantía de servicio** | El compromiso contractual del proveedor sobre cuánto puede estar caído y qué te compensa si pasa. **Contabo prácticamente no ofrece uno**, y ese es el riesgo que aceptamos (§6) |
| **Socket / tiempo real** | La tecnología que hace que el panel del supervisor se actualice solo, sin apretar F5, cuando un cobrador registra algo en la calle |
| **Storage** | El depósito de fotos. Se paga por GB guardado por mes |
| **Tiles / teselas de mapa** | Los cuadraditos de imagen con los que se arma un mapa en pantalla. Se pagan por cantidad de cuadraditos servidos. ⚠️ Los "paquetes sin internet" que se baja la app consumen muchísimos (§5-B) |

---

*Este documento nació del análisis del sistema Kobrax tal como está construido hoy. Lo marcado como [VERIFICADO-CÓDIGO] se comprobó abriendo el programa. Los precios marcados [VERIFICADO-2026-08] se leyeron de las páginas oficiales listadas en la §12 el 13 de agosto de 2026, **y se vuelven a verificar antes de contratar**.*
