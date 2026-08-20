# KOBRAX — Qué necesitamos saber para programar los planes

> **Fecha:** 2026-08-19
> **Para quién es:** la persona que arma los planes comerciales de Kobrax. **No hace falta saber de
> sistemas para responderlo.**
> **Qué se hace con las respuestas:** con ellas se programa el sistema para que **haga cumplir solo**
> los límites de cada plan, sin que nadie los controle a mano.
> **Documento hermano:** [PRICING-Y-DEPLOY.md](./PRICING-Y-DEPLOY.md), de donde salen los números
> que aparecen propuestos acá. Si ya lo leíste, este es el paso siguiente; si no, este se entiende solo.

---

## Lo que estamos pidiendo, en un párrafo

Kobrax vende planes, pero el sistema **sólo sabe hacer cumplir uno de sus límites**: cuántas personas
pueden entrar. Todo lo demás —cuántos créditos, cuántas fotos, cuánto tiempo se guardan— está escrito
en la lista de precios y **no está programado en ninguna parte**. Para programarlo hace falta que
alguien defina, número por número, qué incluye cada plan y qué tiene que pasar cuando un cliente llega
al tope. **Eso es lo único que pedimos.**

### Cómo devolver las respuestas

Al final (§10) hay una **hoja de respuestas** con las preguntas numeradas. Alcanza con completarla y
devolverla — no hace falta editar el resto del documento.

### Cómo leer las marcas

| Marca | Qué significa |
|---|---|
| 🔴 | **Sin esta respuesta no se puede empezar.** Son cuatro. |
| ✏️ | Hay una sugerencia escrita; falta confirmarla o corregirla. |
| ❓ | No hay sugerencia clara: las dos opciones son defendibles y la decisión es comercial. |
| ✅ | Ya está decidido. Se informa, no se pregunta. |

Cada pregunta viene con **nuestra sugerencia**. Si estás de acuerdo con todas, alcanza con escribir
*"confirmo las sugerencias"*.

---

## Diccionario mínimo

Ocho palabras que aparecen todo el tiempo. Con estas ocho se entiende el documento entero.

| Palabra | Qué es, en criollo |
|---|---|
| **Asiento** | Un lugar en el plan para que una persona use el sistema. Si el plan tiene 5 asientos, entran 5 personas. |
| **Crédito** | Un préstamo que un deudor tiene que pagar. Una misma persona puede deber **varios créditos** a la vez. |
| **Cliente / deudor** | La persona a la que se le cobra. **No es lo mismo que un crédito**, y esa diferencia importa (§5.2). |
| **Gestión / visita** | Cada vez que el cobrador registra un contacto: fue a la casa, llamó, dejó una nota. Es lo que genera las fotos. |
| **Tope / límite** | El máximo que incluye un plan. Lo importante no es el número sino **qué hace el sistema al llegar**. |
| **Bajar de plan** | Cuando un cliente pasa a un plan más chico. Es el momento más incómodo de todo el sistema (§8.1). |
| **SaaS** | El modelo de hoy: Kobrax corre en nuestros servidores y el cliente paga una cuota mensual. |
| **Licencia / instalación propia** | El otro modelo: se le vende el programa a la empresa y **ella lo instala en sus propios servidores**. Kobrax deja de operarlo. |

---

## 1. Son **dos productos**, no una escalera de cinco

| | **Kobrax SaaS** | **Kobrax Licencia** |
|---|---|---|
| Planes | FREE · PROFESSIONAL · BUSINESS · ENTERPRISE | uno solo, a medida |
| Dónde corre | En nuestros servidores | En los servidores del cliente |
| Cómo se cobra | Cuota mensual por plan | Venta de licencia (+ mantenimiento) |
| Quién lo opera y respalda | Nosotros | El cliente |
| Quién paga el almacenamiento de fotos, los mapas y el correo | Nosotros | El cliente |
| Cuántos límites tiene | Los de su plan | **Los que diga el contrato** |
| ¿Sabemos cuánto lo usan? | Sí | **No. Una vez instalado, no vemos nada** |
| A quién se le vende | Del cobrador independiente a la financiera mediana | Banco, entidad regulada por ASFI, cliente con política de datos propia |

**No son dos escalones del mismo producto: son dos negocios distintos**, con contratos, costos y
trabajo de programación distintos. La licencia tiene su propia grilla (§4-B) y sus propias preguntas
(§7).

---

## 2. ✅ La escalera quedó definida — pero hay un hueco que mirar

**Los cuatro planes SaaS son: FREE → PROFESSIONAL → BUSINESS → ENTERPRISE**, y la licencia va aparte.

Eso resuelve el lío de nombres que había: la lista de precios usaba *Independiente / Cartera /
Institucional / Enterprise* y el sistema por dentro usa otros. **A partir de acá vale la escalera de
arriba** y los nombres viejos se retiran.

⚠️ **Pero eso deja un hueco comercial que conviene decidir a propósito, no por descuido.**

La lista de precios tenía un plan **Independiente a $15/mes** para el cobrador que trabaja solo. En la
escalera nueva ese escalón desapareció: abajo está el FREE (gratis) y arriba PROFESSIONAL (que hoy
figura con $12 por cobrador y mínimo 5 → **$60/mes**).

**Entre $0 y $60 no hay nada.** Eso significa que el cobrador independiente **usa Kobrax gratis para
siempre y nunca paga**, porque el siguiente escalón le cuesta cuatro veces lo que estaba dispuesto a
gastar.

**❓ Pregunta 2.** ¿Está bien así? Tres caminos:

| Opción | Qué implica |
|---|---|
| **A. Sí, el independiente es free y no paga** | El free es puro canal de entrada: se monetiza cuando esa persona entra a una agencia y la recomienda |
| **B. PROFESSIONAL baja su mínimo** | Que arranque en 1–2 cobradores en vez de 5, y así el independiente que crece paga algo |
| **C. Se agrega un escalón pago entre medio** | Vuelve el "Independiente $15" con otro nombre. **Es un plan más que construir, explicar y mantener** |

> **Sugerencia: B.** No agrega un plan nuevo, no deja el hueco, y convierte al independiente en
> cliente el día que suma a su primer ayudante — que es exactamente cuando puede pagar.

**✏️ Pregunta 3.** ¿Qué precio le corresponde a cada plan de la escalera nueva? *(la lista vieja tenía
$15 / $12 por cobrador / $99+$10 / desde $800, atados a los nombres viejos)*

---

## 3. 🔴 La regla de oro: ¿todos tienen la app completa?

La idea es: **cualquier plan, incluido el FREE, trae la aplicación entera.** Una empresa chica usa todo
Kobrax igual que una grande; lo único que la limita son los **números** (cuánta gente, cuántos
créditos, cuántas fotos).

Eso **contradice** lo que dice hoy la lista de precios, que reserva la **importación de extractos** para
el plan de arriba y la usa como argumento para subir de plan.

| | **Todos tienen todo, cambian los números** | **Algunas funciones son de plan pago** *(lo que dice PRICING hoy)* |
|---|---|---|
| Qué empuja a subir de plan | Crecer: más cobradores, más cartera | Necesitar una función que no tenés |
| Lo bueno | El cliente conoce el producto entero desde el día 1. **Y para programar es mucho más simple** | El motivo de compra es concreto y fácil de vender |
| Lo malo | Si el plan chico le alcanza, no sube nunca | Hay que construir, explicar y probar cada función apagada |

**🔴 Pregunta 4.** ¿Se confirma que **todos los planes traen la app completa** y sólo cambian los
números? En particular: **¿el FREE puede importar extractos de la financiera?**

> **Sugerencia: sí, todos traen todo, incluido el import.** Es más simple de programar, de vender y de
> explicar. Y el motivo de subir sigue existiendo solo: una agencia que crece se pasa de créditos y de
> cobradores sin que nadie le ponga una pared.

---

## 4. Las grillas para completar

### 4-A · Planes SaaS *(corren en nuestros servidores)*

✅ **RESPONDIDA (20/08/2026).** Esta es la grilla decidida por la dueña. Reemplaza a los números
propuestos, que eran entre 3 y 6 veces más generosos en cartera y en fotos.

| Límite | **FREE** | **PROFESSIONAL** | **BUSINESS** | **ENTERPRISE** *(piso, se cotiza)* |
|---|---|---|---|---|
| **Precio** | $0 | $12 × cobrador | $99 + $10 × cobrador | $800 + $8 × cobrador |
| ✅ **Usuarios** | 1 | 25 | 100 | 500 |
| ✅ **Créditos activos** | 20 | 1.000 | 5.000 | 50.000 |
| ✅ **Clientes (deudores)** | 20 | 1.000 | 5.000 | 50.000 |
| ✅ **Fotos por mes** | 100 | 5.000 | 25.000 | 250.000 |
| ✅ **Meses que se guardan las fotos** | 6 | 24 | 60 | 120 |
| ⚠️ **Sucursales** | 1 | 3 | 10 | a medida |
| ⚠️ **Gestiones por mes** | 100 | 2.500 | 12.500 | 125.000 |
| ✅ **Soporte** | Base de conocimientos + chat comunitario | Email 24 h + WhatsApp | Capacitación + horario laboral | Responsable de cuenta |

### Por qué ENTERPRISE ya no dice «sin límite» *(decidido el 20/08)*

Los números de ENTERPRISE son un **piso**: lo que incluye el precio de partida. El contrato de cada
cliente los sube en su propia cuenta. Lo que ve en pantalla sigue diciendo **«a medida»** — el
número vive en el contrato, no en la aplicación.

**«Ilimitado» se sacó del producto entero por tres motivos**, y ninguno es el costo del
almacenamiento *(un cliente de 100 cobradores acumula ~960 GB en su primer año: $14 al mes contra
los $800 que paga)*:

1. **Un tope sin número no se cuenta, y lo que no se cuenta no se ve.** Nadie se entera de que un
   cliente consume cinco veces lo cotizado hasta que lo dice la base de datos.
2. **En multi-tenant, un inquilino sin techo es riesgo de todos.** Un extracto mal armado con dos
   millones de filas degrada la base donde viven los demás clientes. El tope no es sólo comercial:
   es la baranda operativa.
3. **«Ilimitado» es una palabra que no se puede devolver.** Subirla después es renegociar con
   alguien que se siente estafado. *«Incluye 50.000 créditos; si crecés, lo ampliamos»* es la misma
   venta sin la trampa.

`sin límite` queda reservado para **Kobrax Licencia** (§4-B), que es el único caso donde de verdad
no hay nada que hacer cumplir: corre en el servidor del cliente y no vemos nada.

> ❗ **El precio de ENTERPRISE lleva «por cobrador» y eso corrige una inversión de la grilla.** Con
> $800 plano, un cliente BUSINESS de 80 cobradores pagaba **$899** — más que el piso del plan de
> arriba, que además venía sin topes. A partir de ~71 cobradores convenía pedir ENTERPRISE. Con el
> cargo por asiento, subir de plan **nunca sale más barato**, y el ingreso crece con el cliente en
> vez de congelarse — que es justo lo que el «ilimitado» apagaba.

> ⚠️ **Los 120 meses de retención son simetría con la escalera, no normativa.** El número real sale
> de cuánto exige ASFI que guarden las entidades que van a comprar este plan. Eso lo sabe un cliente,
> no nosotros.

**La intención declarada:** con 1 usuario y 20 créditos, el FREE se llena en una o dos semanas de
uso real; al ver que PROFESSIONAL da 50 veces más por $12, la decisión de pagar es inmediata.

Tres observaciones sobre esta grilla, ninguna bloqueante:

1. ⚠️ **Sucursales sigue sin existir en el producto** (§5.6). El número está puesto, pero no hay
   pantalla para crear una. **No se muestra en el panel** hasta que la función exista.
2. ⚠️ **Gestiones por mes no puede frenar nada** (§5.3): la visita llega de campo, sin internet, ya
   ocurrida. El número sirve para avisar o para facturar, nunca para bloquear.
3. ❗ **Clientes y créditos con el mismo número hacen que el de clientes casi nunca actúe**: un
   cliente puede deber varios créditos, así que el tope de créditos se llena primero. El de clientes
   sólo muerde en una cartera cargada sin préstamos. Si la idea era que fueran dos frenos distintos,
   el de clientes tendría que ser **más chico** que el de créditos.

> 💡 **A mirar en BUSINESS:** 5.000 créditos activos es la cartera de una agencia, no la de una
> financiera mediana —que anda por arriba de 20.000—. Con este número, el cliente BUSINESS típico
> llega al tope y el único escalón siguiente cuesta $800. Es una decisión defendible (empuja a
> ENTERPRISE), pero conviene que sea a propósito.

### 4-B · Kobrax Licencia *(la empresa lo instala en su propio servidor)*

Mismas filas, para que se pueda comparar. **Lo que se ponga acá no lo hace cumplir el sistema**: una
vez instalado en la casa del cliente, no vemos nada (§7). Es lo que dice el contrato.

| Límite | **LICENCIA** |
|---|---|
| *Precio* | *a cotizar — Pregunta 22* |
| **Usuarios** | |
| **Créditos activos** | |
| **Clientes (deudores)** | |
| **Fotos por mes** | *no aplica — el almacenamiento lo paga el cliente* |
| **Meses que se guardan las fotos** | *lo decide el cliente* |
| **Sucursales** | |
| **Gestiones por mes** | |
| **Soporte** | |
| **Mantenimiento anual** | |
| **Instalaciones que cubre** *(producción / pruebas)* | |

Si se confirma la **Pregunta 4**, no hace falta ninguna fila de funciones: todos los planes traen todo
y estas dos tablas son el producto entero.

---

## 5. Límite por límite

Cada bloque dice lo mismo: **qué se cuenta**, **qué pasa al llegar al tope**, y **la pregunta**.

### 5.1 Usuarios ✅ *el único que ya funciona*

**Qué se cuenta:** las personas activas de la empresa. Alguien invitado que todavía no aceptó **ya
ocupa asiento**. Desactivar a alguien libera su lugar.

**Qué pasa hoy al llegar al tope:** el sistema no deja invitar a nadie más, y tampoco deja reactivar a
alguien que se había desactivado. El botón de invitar se apaga solo y aparece un cartel explicando.

**🔴 Pregunta 5.** ¿Cuántos usuarios incluye cada plan, **incluido el FREE**? *(ver grilla §4-A)*

⚠️ **Dato:** hoy **toda cuenta nueva nace con 5 asientos**, sin importar el plan. Es el número que hay
que corregir primero.

**✏️ Pregunta 6.** ¿Alguien invitado que todavía no aceptó debe seguir ocupando asiento?
> **Sugerencia:** sí, como hoy. Si no ocupa lugar, un cliente invita a 50 personas para reservarse los
> cupos.

**✏️ Pregunta 7.** El PROFESSIONAL dice **"mínimo 5 cobradores"**. ¿Es un mínimo de **facturación** (se
le cobran 5 aunque tenga 3) o de **uso** (el sistema le exige tener 5)?
> **Sugerencia:** de facturación. El sistema no debería obligar a nadie a contratar personal. *(Ver
> también Pregunta 2: bajar este mínimo es la forma de tapar el hueco entre $0 y $60.)*

### 5.2 🔴 Créditos o clientes: hay que elegir uno

Esta es la pregunta que se hizo como *"máximo de clientes"*, y **son dos cosas distintas**:

- Un **cliente** (deudor) puede tener **varios créditos**.
- Cada crédito genera su propio seguimiento, sus visitas y sus fotos.

La lista de precios habla de **"créditos activos"**, no de clientes. Y tiene una razón buena: **el
trabajo del sistema crece con los créditos, no con las personas.** Un cliente con 4 créditos da cuatro
veces más trabajo y ocupa cuatro veces más lugar que uno con 1.

**🔴 Pregunta 8.** ¿El tope se cuenta sobre **créditos** o sobre **clientes**? Y sus números por plan.
> **Sugerencia:** créditos, como ya dice la lista de precios. Es lo que mide el trabajo real.

**✏️ Pregunta 9.** ¿Qué quiere decir "activo"?
> **Sugerencia:** un crédito con saldo pendiente y sin dar de baja. Uno ya pagado deja de contar y
> libera lugar. Si contaran los pagados, **el cliente que cobra bien sería castigado por su propio
> éxito** — justo al revés de lo que vende Kobrax.

**❓ Pregunta 10. La grande de este bloque.** Las agencias no cargan sus créditos a mano: **importan un
archivo** que les manda la financiera, con cientos de créditos de una vez. ¿Qué pasa cuando ese archivo
trae 500 créditos y al cliente le quedan 80 lugares?

| Opción | Qué pasa | A favor | En contra |
|---|---|---|---|
| **A. Rechazar el archivo entero** | No entra ninguno. El mensaje dice cuántos sobran | La cartera nunca queda a medias | Frustra en el momento |
| **B. Importar hasta llenar** | Entran 80, quedan 420 afuera | Algo entra | **Nadie sabe cuáles quedaron afuera.** El cobrador sale a la calle con una cartera incompleta sin enterarse |
| **C. Dejar pasar y avisar** | Entran los 500 y aparece un aviso | Nunca frena la operación | El límite deja de ser un límite |

> **Sugerencia: A.** Una cartera incompleta es peor que una importación que falla: el error se descubre
> recién cuando el deudor reclama que nunca lo visitaron.

### 5.3 ❓ Gestiones y visitas: la trampa

**Una visita no se puede rechazar.** El cobrador registra la gestión **sin internet**, parado en la
puerta del deudor. Cuando el teléfono se conecta —a veces horas después— **la visita ya ocurrió en el
mundo real**. Rechazarla ahí significa borrar trabajo hecho, y en un producto cuyo valor central es
servir de prueba legal, eso no es aceptable.

Traducido: un límite de gestiones **no puede bloquear nada**. Sólo puede avisar, o facturarse aparte.

**❓ Pregunta 11.** ¿Se quiere un tope de gestiones por mes?
> **Sugerencia: no.** El límite de usuarios ya lo controla de manera indirecta: un cobrador hace las
> visitas que hace, y se cobra por cobrador. Un tope de gestiones castiga justo al cliente que más usa
> el producto, que es el que menos riesgo tiene de irse.

Si igual se quiere: **11a.** ¿cuenta sólo visitas a domicilio o cualquier contacto, incluida una
llamada? **11b.** ¿se reinicia el día 1 de cada mes? **11c.** ¿qué pasa al pasarse — aviso al cliente,
aviso interno, o se factura el excedente?

### 5.4 ✏️ Fotos por mes

Es el único límite que **cuesta plata de verdad**: cada foto ocupa espacio para siempre. Un cobrador
genera alrededor de **0,8 GB por mes** en fotos.

Tiene el mismo problema que las gestiones: la foto llega junto con la visita, sin internet de por
medio. **No se puede rechazar sin borrar evidencia.**

**✏️ Pregunta 12.** ¿Se confirman los números por plan, y cuánto le toca al FREE? ¿El sistema **avisa**
o **bloquea**?
> **Sugerencia:** los números sí, pero **como aviso, nunca como bloqueo**. Al 80% se le avisa al
> cliente; al 100% avisa internamente para abrir la conversación de cambio de plan. Una foto de campo
> no se rechaza jamás.

**✏️ Pregunta 13.** ¿El contador mensual se reinicia el **día 1 del mes** o en la **fecha de
aniversario** del contrato?
> **Sugerencia:** día 1. Es lo que el cliente entiende sin que nadie se lo explique.

### 5.5 ✏️ Cuánto tiempo se guardan las fotos

Uno de los principios del producto es que **la evidencia es inalterable**, y borrar una foto que se usó
como prueba tiene consecuencias legales.

Hay una salida: el proveedor de almacenamiento tiene un modo **"de archivo"** que **abarata la foto
vieja un 30% sin borrarla**. Sigue existiendo y sigue verificándose; sólo cuesta menos guardarla.

**✏️ Pregunta 14.** La retención por plan, ¿es **borrar** o **archivar**?
> **Sugerencia:** archivar, nunca borrar. Cuesta casi lo mismo y evita una discusión legal que no
> conviene tener. **Excepción a discutir: el FREE** — ver §6.

### 5.6 ❓ Sucursales

⚠️ **Aviso importante: las sucursales todavía no existen en el producto.** El lugar para guardarlas
está preparado, pero **no hay ninguna pantalla** para crearlas ni para asignarles gente. Vender "hasta
3 sucursales" hoy es vender algo que el cliente no va a poder usar.

**❓ Pregunta 15.** ¿Las sucursales entran en la primera versión de los planes, o se sacan de la grilla
hasta que la función exista?
> **Sugerencia:** sacarlas por ahora. Prometer una función que no existe es la forma más rápida de
> perder al primer cliente BUSINESS, que es justamente el que la va a pedir.

---

## 6. 🆕 El plan FREE — sus preguntas propias

Un plan gratis no es "el plan chico con precio cero": es el único que **cuesta plata y no la devuelve**.
Cada cuenta FREE guarda fotos en nuestro almacenamiento, para siempre, sin facturar nada.

### Cuánto cuesta un FREE, en números

Con 1 cobrador haciendo 200 fotos por mes: **160 MB por mes por cuenta**. Con 500 cuentas FREE activas
son **80 GB nuevos por mes**, alrededor de **$1,20/mes** el primer mes… **y $14/mes al año**, porque no
para de acumularse. No es dramático, pero **crece para siempre si las fotos no vencen nunca**.

**✏️ Pregunta 16.** ¿Cuánto tiempo se guardan las fotos de una cuenta FREE?
> **Sugerencia: 3 meses.** Es el único límite del FREE que **no puede ser generoso**, porque es el
> único que se paga en efectivo todos los meses. Y es defendible: si el cliente necesita historial, ese
> es exactamente el motivo para pasar al plan pago.

**🔴 Pregunta 17.** Los números del FREE: usuarios, créditos y fotos por mes. *(ver grilla §4-A)*
> **Sugerencia:** **1 usuario · 50 créditos · 300 fotos por mes.** Suficiente para que un cobrador
> independiente trabaje de verdad y se enamore del producto; chico como para que una empresa de tres
> personas se quede corta en la primera semana.

**❓ Pregunta 18.** ¿El FREE **vence** o es para siempre?
> **Sugerencia:** para siempre, mientras se use. Un free que vence es una prueba gratis disfrazada, y
> ya se decidió que la prueba gratis en este mercado se vuelve eterna (§8.4). El free permanente cumple
> otra función: **es el canal de entrada del cobrador independiente**, que después recomienda Kobrax en
> la agencia donde trabaja.

**❓ Pregunta 19.** ¿Cuántas cuentas FREE puede tener una misma empresa? Sin una regla, alguien con 12
cobradores abre 12 cuentas gratis en vez de pagar un plan.
> **Sugerencia:** una por NIT y una por correo. No frena a un decidido, pero frena al que lo hace por
> comodidad, que son casi todos.

**❓ Pregunta 20.** ¿Qué pasa con una cuenta FREE **dormida** — sin entrar hace 6 meses? Sus fotos
siguen costando todos los meses.
> **Sugerencia:** a los 6 meses sin actividad se avisa por correo; a los 9, la cuenta pasa a sólo
> lectura y las fotos se archivan. **Nunca se borra sin avisar**: puede haber evidencia adentro.

**✏️ Pregunta 21.** ¿La cuenta FREE lleva alguna marca visible de Kobrax en lo que imprime o exporta
(un "Generado con Kobrax" al pie de un comprobante)?
> **Sugerencia:** sí. Es publicidad gratis y un motivo suave para pasar al plan pago.

**✏️ Pregunta 22.** ¿El FREE tiene soporte?
> **Sugerencia:** no personalizado. Documentación y nada más. Cada consulta de un free cuesta tiempo
> que sale del mismo lugar que el soporte de los que pagan.

---

## 7. 🆕 Kobrax Licencia — instalación en servidores del cliente

**No es un plan: es otro producto**, con otro contrato y otro trabajo. Su grilla está en §4-B.

### Lo que hay que entender antes de ponerle precio

Cinco cosas cambian cuando el programa se instala en la casa del cliente:

1. **Nunca más sabemos cuánto lo usan.** No hay forma de contar sus usuarios, sus créditos ni sus
   fotos. **Cualquier límite del contrato es un límite de confianza**, no uno que el sistema pueda
   hacer cumplir — salvo que se construya una llave de licencia, que es trabajo aparte.
2. **El cliente paga su propia infraestructura**: servidores, almacenamiento de fotos, mapas, correo.
   Eso baja nuestro costo a casi cero y **sube el suyo**. Conviene decírselo en la primera reunión.
3. **Cada instalación es una versión distinta corriendo.** Un cliente que no actualiza durante un año
   está usando un Kobrax que ya nadie recuerda. **Ahí es donde el soporte se vuelve caro.**
4. **Los respaldos y la seguridad pasan a ser problema del cliente.** Eso es exactamente lo que un banco
   quiere oír, y también lo que nos saca la responsabilidad de encima.
5. **Hoy no existe ni el instalador.** Kobrax todavía no está preparado para instalarse en ningún
   servidor, ni siquiera en el nuestro. Vender una licencia antes de eso es vender una promesa.

### Las preguntas

**🔴 Pregunta 23.** ¿Cómo se cobra?

| Modelo | Cómo funciona | Comentario |
|---|---|---|
| **A. Licencia única + mantenimiento anual** | Se paga una vez (ej. $15.000) y después un % al año (típico: 18–20%) por actualizaciones y soporte | Es lo que una entidad regulada espera y sabe presupuestar |
| **B. Suscripción anual** | Se paga todos los años; si deja de pagar, la licencia vence | Ingreso más predecible; a algunos compradores les incomoda |
| **C. Por cantidad de usuarios** | El precio sale de cuántos cobradores va a tener | Más justo, pero **requiere confiar** o construir la llave de licencia |

> **Sugerencia: A**, con el mantenimiento anual claramente separado en el contrato. Es el modelo que el
> área de compras de un banco ya sabe procesar.

**✏️ Pregunta 24.** ¿Qué incluye el mantenimiento anual? *(actualizaciones · soporte y en qué horario ·
horas de consultoría · tiempo de respuesta comprometido)*

**✏️ Pregunta 25.** Si el cliente **deja de pagar el mantenimiento**, ¿el sistema **sigue funcionando**
(sólo se queda sin actualizaciones ni soporte) o **deja de funcionar**?
> **Sugerencia:** sigue funcionando. Un sistema de cobranzas que se apaga solo le corta la operación a
> una entidad regulada, y eso termina en un juicio, no en una renovación.

**✏️ Pregunta 26.** ¿La instalación, la migración de sus datos y la capacitación **se cobran aparte**?
> **Sugerencia:** sí, como un proyecto separado y por adelantado. Es el trabajo más pesado de toda la
> venta y el que más se subestima.

**❓ Pregunta 27.** ¿La licencia tiene **límites de usuarios o de créditos**, o es realmente ilimitada?
*(es la grilla §4-B)*
> **Sugerencia:** ilimitada. Si el precio ya es alto, poner un tope que además no podemos verificar
> agrega fricción de venta sin agregar ingreso.

**✏️ Pregunta 28.** ¿Cuántas instalaciones cubre una licencia? *(producción, pruebas, respaldo)*
> **Sugerencia:** una de producción y una de pruebas. Un ambiente de pruebas es una necesidad real de
> cualquier entidad seria, y cobrárselo aparte se siente mezquino.

**✏️ Pregunta 29.** ¿Hay un **precio piso** por debajo del cual no se cotiza una licencia?
> **Sugerencia:** sí. Cada cliente instalado consume soporte para siempre; por debajo de cierto monto
> conviene decir que no y ofrecerle el plan ENTERPRISE en la nube.

**✏️ Pregunta 30.** ¿Se entrega el código fuente?
> **Sugerencia:** no. Sí un compromiso de que, si Kobrax desaparece, el código queda disponible para el
> cliente — es la garantía estándar y suele alcanzar para cerrar la objeción.

---

## 8. Preguntas que valen para todos los planes

### 8.1 🔴 Qué pasa cuando un cliente **baja** de plan

Un cliente con 14 cobradores y 8.000 créditos pasa de BUSINESS a PROFESSIONAL. Queda por encima del
tope en las dos cosas a la vez.

**🔴 Pregunta 31.** ¿Qué tiene que hacer el sistema?

| Opción | Qué pasa |
|---|---|
| **A. Congelar** | Los 14 siguen trabajando, pero no puede sumar el 15. Nada se desactiva solo. |
| **B. Forzar** | El cliente elige a quién desactivar antes de que el cambio se aplique. |
| **C. Impedir** | No se puede bajar de plan estando por encima. |

> **Sugerencia: A.** Sacarle cobradores de la calle a un cliente porque se atrasó con una factura es la
> peor forma de cobrarle. Además es lo que el sistema ya hace hoy, así que no cuesta nada.

⚠️ Esta pregunta también aplica **al caer de un plan pago al FREE** si alguien deja de pagar. Es el caso
más probable de todos.

### 8.2 ✏️ El cliente que negocia un número a medida

Una financiera pide 40 usuarios pero no quiere el plan de arriba. ¿Se le arma un plan propio o se le
pone una excepción a su cuenta?

**✏️ Pregunta 32.** ¿Y esa excepción vale para **todos** los límites o sólo para los usuarios?
> **Sugerencia:** una excepción en su cuenta, no un plan nuevo. Crear un plan por cliente ensucia la
> lista de precios que ve todo el mundo y multiplica lo que hay que mantener.

### 8.3 ✏️ Quién puede cambiarle el plan a un cliente

Hoy: **nadie desde el producto**. Se cambia por dentro del sistema, a mano, por la programadora.

**✏️ Pregunta 33.** ¿Alcanza con una pantalla interna de Kobrax, o el cliente tiene que poder cambiarse
el plan solo desde su cuenta?
> **Sugerencia:** pantalla interna. Con el FREE existiendo, el auto-servicio hacia arriba sólo tiene
> sentido cuando haya una pasarela de cobro conectada — antes de eso, es regalar planes.

### 8.4 ✏️ El período de prueba

El sistema ya marca las cuentas nuevas como **"en prueba"**, pero **nada la hace vencer**: una cuenta en
prueba lo sigue estando para siempre.

**✏️ Pregunta 34.** **Con un FREE permanente, ¿hace falta una prueba gratis de los planes pagos?**
> **Sugerencia:** no una prueba tradicional. En su lugar: **30 días con los límites del PROFESSIONAL**,
> y al vencer la cuenta **cae al FREE** en vez de bloquearse. Nadie pierde sus datos, nadie queda
> afuera, y el que necesitaba más ya sabe exactamente por qué paga.

### 8.5 ✅ Cortarle el servicio al que no paga

Buena noticia: **el corte ya está programado y funciona.** Una empresa marcada como suspendida **no deja
entrar a nadie**, ni al dueño.

Lo que falta es **la palanca**: no hay ninguna pantalla para marcar a una empresa como suspendida. Hoy
se hace a mano por dentro del sistema.

**✏️ Pregunta 35.** ¿Suspender es un corte seco (nadie entra, como hoy), un escalón de **sólo lectura**,
o directamente **caer al FREE**?
> **Sugerencia: caer al FREE.** Es más humano que el corte seco, no requiere construir una tercera
> modalidad, y deja al cliente adentro del producto — que es desde donde vuelve a pagar. El corte seco
> queda para el que ya no responde.

### 8.6 ❓ Cuándo avisar que se está por llegar al tope

**❓ Pregunta 36.** ¿A qué porcentaje avisa el sistema, y a quién?
> **Sugerencia:** al 80% le avisa al administrador de la cuenta del cliente, y al 100% avisa
> internamente a Kobrax — porque cuando alguien llega al 100% lo que sigue es una conversación de venta,
> no un cartel más.

---

## 9. Cuánto cuesta programar cada cosa

| Qué | Estado hoy | Cuánto tarda |
|---|---|---|
| Usuarios | ✅ funciona | ya está |
| Cortarle el servicio al moroso | ✅ funciona | ya está |
| Guardar los planes con sus límites | ❌ no existe | 1 día |
| **Agregar el plan FREE** | ❌ no existe | medio día *(sale de la misma tabla)* |
| Elegir plan al registrarse | ❌ hoy siempre es el mismo | medio día |
| Créditos activos | ❌ no existe | 1 día, más 1 por el caso del archivo importado |
| Fotos por mes | ❌ no existe | 1 día |
| Archivar fotos por antigüedad | ❌ no existe | 1 día *(después de mudar las fotos a la nube)* |
| La pantalla para suspender / cambiar de plan | ❌ no existe | medio día |
| Avisos de "estás al 80%" | ❌ no existe | medio día |
| **Cuentas FREE dormidas** (aviso y archivado) | ❌ no existe | medio día |
| Sucursales | ❌ la función entera no existe | 3 a 5 días |
| Facturación y cobro automático | ❌ no existe | proyecto aparte, no antes de 10 clientes pagando |
| 🆕 **Instalador para servidores del cliente** | ❌ **no existe ni para los nuestros** | 3 a 5 días |
| 🆕 **Llave de licencia** *(sólo si la licencia lleva topes)* | ❌ no existe | 2 días |
| 🆕 **Empaquetar actualizaciones para el cliente** | ❌ no existe | 2 a 3 días |

**Los planes SaaS, sin sucursales ni facturación: entre 5 y 7 días.**
**La licencia suma entre 5 y 10 días más**, y no se puede empezar hasta que exista el instalador — que
de todos modos hace falta para poder vender el SaaS.

---

## 10. Si sólo se pueden contestar cuatro

1. 🔴 **Pregunta 4** — ¿todos los planes traen la app completa?
2. 🔴 **Pregunta 5 + 17** — cuántos usuarios incluye cada plan, incluido el FREE.
3. 🔴 **Pregunta 8** — ¿el tope es de créditos o de clientes?, y sus números.
4. 🔴 **Pregunta 31** — qué pasa cuando un cliente baja de plan.

La **licencia (§7) no bloquea nada**: se puede responder más adelante, porque igual no se puede
construir hasta que exista el instalador.

---

## 11. Hoja de respuestas

*Completar y devolver. Con esto alcanza.*

### 11.1 Grilla SaaS ✅ *respondida el 20/08/2026 — ver §4-A*

| Límite | FREE | PROFESSIONAL | BUSINESS | ENTERPRISE *(piso)* |
|---|---|---|---|---|
| Precio | $0 | $12 × cobrador | $99 + $10 × cobrador | $800 + $8 × cobrador |
| Usuarios | 1 | 25 | 100 | 500 |
| Créditos activos | 20 | 1.000 | 5.000 | 50.000 |
| Clientes | 20 | 1.000 | 5.000 | 50.000 |
| Fotos por mes | 100 | 5.000 | 25.000 | 250.000 |
| Meses que se guardan las fotos | 6 | 24 | 60 | 120 |
| Sucursales *(la función no existe todavía)* | 1 | 3 | 10 | a medida |
| Gestiones por mes *(sólo avisa, no bloquea)* | 100 | 2.500 | 12.500 | 125.000 |
| Soporte | Base de conocimientos + chat comunitario | Email 24 h + WhatsApp | Capacitación + horario laboral | Responsable de cuenta |

**Dónde vive esto en el sistema:** `packages/shared/src/constants/plans.ts`. Es el catálogo que lee
el panel; **todavía no es una guarda** (ver §9).

### 11.2 Grilla Licencia

| Límite | LICENCIA |
|---|---|
| Precio | |
| Mantenimiento anual | |
| Usuarios | |
| Créditos activos | |
| Clientes | |
| Sucursales | |
| Gestiones por mes | |
| Soporte | |
| Instalaciones que cubre | |

### 11.3 Las preguntas

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | *(informativa — §1: son dos productos)* | — |
| 2 | ❓ El hueco entre $0 y $60: ¿A, B o C? | |
| 3 | ✏️ Precio de cada plan de la escalera nueva | |
| 4 | 🔴 ¿Todos los planes traen la app completa? ¿El FREE importa extractos? | |
| 5 | 🔴 Usuarios por plan → *ver grilla 11.1* | |
| 6 | ✏️ ¿El invitado que no aceptó ocupa asiento? | |
| 7 | ✏️ El "mínimo 5" de PROFESSIONAL, ¿es de facturación o de uso? | |
| 8 | 🔴 ¿El tope se cuenta en créditos o en clientes? | |
| 9 | ✏️ ¿Qué cuenta como crédito "activo"? | |
| 10 | ❓ Archivo importado que se pasa del tope: ¿A, B o C? | |
| 11 | ❓ ¿Hay tope de gestiones por mes? *(si sí: 11a, 11b, 11c)* | |
| 12 | ✏️ Fotos por mes: ¿números? ¿avisa o bloquea? | |
| 13 | ✏️ ¿El contador mensual arranca el día 1 o en el aniversario? | |
| 14 | ✏️ Fotos viejas: ¿borrar o archivar? | |
| 15 | ❓ ¿Las sucursales entran ahora o se sacan de la grilla? | |
| **16** | ✏️ **FREE:** ¿cuántos meses se guardan sus fotos? | |
| **17** | 🔴 **FREE:** usuarios, créditos y fotos por mes | |
| **18** | ❓ **FREE:** ¿vence o es para siempre? | |
| **19** | ❓ **FREE:** ¿cuántas cuentas por empresa? | |
| **20** | ❓ **FREE:** ¿qué pasa con una cuenta dormida 6 meses? | |
| **21** | ✏️ **FREE:** ¿lleva marca "Generado con Kobrax"? | |
| **22** | ✏️ **FREE:** ¿tiene soporte? | |
| **23** | 🔴 **Licencia:** ¿cómo se cobra? ¿A, B o C? | |
| **24** | ✏️ **Licencia:** ¿qué incluye el mantenimiento anual? | |
| **25** | ✏️ **Licencia:** si deja de pagar el mantenimiento, ¿sigue funcionando? | |
| **26** | ✏️ **Licencia:** ¿instalación y capacitación se cobran aparte? | |
| **27** | ❓ **Licencia:** ¿tiene límites o es ilimitada? → *grilla 11.2* | |
| **28** | ✏️ **Licencia:** ¿cuántas instalaciones cubre? | |
| **29** | ✏️ **Licencia:** ¿hay precio piso? | |
| **30** | ✏️ **Licencia:** ¿se entrega el código fuente? | |
| 31 | 🔴 ¿Qué pasa al bajar de plan estando por encima? ¿A, B o C? | |
| 32 | ✏️ La excepción negociada, ¿vale para todos los límites o sólo usuarios? | |
| 33 | ✏️ ¿Quién le cambia el plan a un cliente? | |
| 34 | ✏️ ¿Hace falta prueba gratis existiendo el FREE? | |
| 35 | ✏️ Suspender: ¿corte seco, sólo lectura, o caer al FREE? | |
| 36 | ❓ ¿A qué porcentaje avisa, y a quién? | |

---

## Anexo — para la programadora

*Esta sección no hace falta leerla para responder el documento.*

| Qué | Dónde está |
|---|---|
| Los planes | `packages/database/prisma/schema.prisma:42` (`enum PlanCode`) — hoy `STARTER · PROFESSIONAL · BUSINESS · ENTERPRISE`, **escritos y sin usar**. La escalera nueva pide **cambiar `STARTER` por `FREE`** |
| El límite de usuarios | `accounts.max_users` — un número suelto por cuenta (`schema.prisma:82`) |
| El freno al invitar | `apps/api/src/modules/users/users.service.ts:155` |
| El freno al reactivar | `apps/api/src/modules/users/users.service.ts:104` *(agregado el 19/08)* |
| El contador de asientos | `accounts.service.ts:37` — cuenta membresías activas |
| El plan al registrarse | `accounts.service.ts:74` — **siempre STARTER, siempre 5 asientos** |
| El plan es de sólo lectura para el producto | `accounts/dto/account.dto.ts:9` y su test en `accounts.service.spec.ts:201` |
| El freno por cuenta suspendida | `apps/api/src/modules/auth/auth.service.ts:238` |
| Sucursales | La tabla `branches` existe; **cero código de producto** |
| Los números propuestos | [PRICING-Y-DEPLOY.md](./PRICING-Y-DEPLOY.md) §3 |

**Forma que va a tomar la respuesta en el sistema:** una tabla `plans` global (código, nombre comercial,
y una columna por límite, con `null` = sin tope), la cuenta guardando sólo **a qué plan pertenece**, y
una columna de excepción por cuenta para el caso negociado (§8.2). El límite deja de vivir suelto en
cada cuenta, así que cambiar un plan pasa a ser editar una fila y no un `UPDATE` masivo.

**Sobre la licencia:** el modo instalación propia **no necesita código de límites distinto** — es una
fila más en `plans` con los topes en `null`. Lo que sí necesita, y no existe, es el instalador, el
empaquetado de actualizaciones y —sólo si la licencia lleva topes (Pregunta 27)— una llave de licencia
firmada. Ninguna de las tres es parte de este trabajo.
