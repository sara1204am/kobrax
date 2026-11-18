---
type: PRIVACY
version: 0.1.0
title: Política de Privacidad
material: true
---
# Política de Privacidad de Kobrax

[PENDIENTE DE CONFIRMACIÓN LEGAL] Este texto es un borrador de trabajo y todavía no fue revisado por un abogado especializado en Bolivia. Describe lo que Kobrax hace hoy según su funcionamiento actual; no promete medidas que no estén implementadas.

## 1. Quién es el responsable

**Mabel Sara Acha Moya**, persona natural, titular de Kobrax. Hoy no existe una sociedad que ofrezca el servicio. Documento de identidad / NIT y domicilio: [PENDIENTE DE CONFIRMACIÓN LEGAL]. Canal de privacidad: kobraxikigai@gmail.com.

## 2. Tres papeles distintos

- **Usuario de Kobrax**: tú, si creaste una cuenta o te invitaron. Sobre **tus datos de cuenta** Kobrax decide para qué se usan.
- **Organización cliente**: la entidad, o el profesional independiente, que contrata Kobrax. Decide qué datos de su cartera carga y para qué, y responde por tener derecho a hacerlo.
- **Titular de datos de cobranza**: la persona cuyos datos se cargan en una cartera (deudor, garante, referencia). Sobre estos datos Kobrax actúa como **encargado** de la Organización cliente. Quien administra una cuenta no consiente por ellos.

## 3. Qué datos recopilamos

**De tu cuenta**
- Nombre, apellido, correo electrónico, teléfono, foto y datos laborales que completes (por ejemplo, código de empleado).
- Número de documento, si lo registras en tu perfil.
- Contraseña (se guarda únicamente su huella cifrada) y datos de verificación en dos pasos.
- Si el correo ya fue confirmado y cuándo. El enlace de confirmación vence a las 48 horas, sirve una sola vez y de él solo se guarda su huella.

**De tu organización**
- Razón social, NIT, teléfono, correo, dirección y plan.

**Técnicos y de uso**
- Dirección IP, navegador o dispositivo, ciudad y país aproximados (deducidos de la IP con una base local), fecha de las sesiones, versión de la aplicación y, si activas las notificaciones, un identificador del dispositivo.
- Registros de auditoría: quién hizo qué y cuándo dentro de la plataforma.

**De ubicación**
- Si usas la app en campo, la **última ubicación conocida** y las coordenadas de cada visita y de cada evidencia que registres.

**Datos de cartera (los carga tu organización)**
- Datos de deudores, garantes y referencias: nombre, documento, teléfonos, correos, direcciones y coordenadas, ingresos, créditos, pagos, gestiones, notas, fotografías y firmas. Su tratamiento lo define la Organización cliente.

## 4. Cómo los recopilamos

Directamente de ti al crear tu acceso y usar la plataforma; de tu organización cuando carga o administra datos; y automáticamente desde tu navegador o dispositivo.

## 5. Para qué los usamos y con qué base

- **Darte acceso y operar el servicio** (cuenta, planes, funciones): para ejecutar el contrato que aceptas al registrarte.
- **Seguridad y prevención de fraude** (sesiones, bloqueos, auditoría): interés legítimo en proteger la plataforma. [PENDIENTE DE CONFIRMACIÓN LEGAL]
- **Cumplir obligaciones legales** cuando corresponda.
- **Comunicaciones comerciales** (novedades, promociones): solo si marcas esa casilla; es opcional, independiente y puedes retirarla cuando quieras.

[PENDIENTE DE CONFIRMACIÓN LEGAL: Bolivia no tiene una ley integral de protección de datos; las bases se plantean según el estándar de consentimiento informado del D.S. 1793 y las buenas prácticas internacionales. Un abogado debe validarlas.]

## 6. Quién puede acceder

- **Dentro de tu organización**, las personas según su rol y su oficina.
- **Personal de Kobrax**, solo mediante una sesión de soporte con consentimiento de la organización, de duración limitada y registrada.
- **Proveedores** que nos prestan servicios, descritos abajo.

## 7. Proveedores y transferencias internacionales

- Alojamiento: servidor en Contabo, ubicado en Estados Unidos. Allí residen la base de datos y los archivos.
- Notificaciones push: Firebase Cloud Messaging (Google), si activas las notificaciones.
- Correo: servicio SMTP de Gmail, para enviarte invitaciones y enlaces de recuperación.
- Mapas: tu navegador o app consulta teselas de OpenStreetMap y Esri; esos servicios ven tu IP y la zona consultada.
- Tipografías: tu navegador las pide a Google Fonts; Google ve tu IP.
- WhatsApp: Kobrax **no envía mensajes por su cuenta**; abre WhatsApp en el dispositivo de quien cobra con el texto preparado.

[PENDIENTE DE CONFIRMACIÓN LEGAL: transferencia internacional de datos a Estados Unidos y a estos proveedores.]

## 8. Inteligencia artificial

Hoy Kobrax **no envía datos a modelos de inteligencia artificial de terceros**. Usa reglas automáticas para ordenar la mora y sugerir franjas de contacto, siempre como apoyo a una persona. Ver la [Política de Inteligencia Artificial](/ia).

## 9. Geolocalización y evidencias

La ubicación se usa para registrar visitas y evidencias de cobranza en campo, solo mientras la aplicación está abierta y el usuario la solicita. La aplicación móvil usa la cámara y la ubicación para ese fin y **no lee los contactos, el registro de llamadas ni los archivos del teléfono**. Las fotografías, firmas y coordenadas de una evidencia se guardan junto a una huella digital (SHA-256) que permite comprobar que no fueron alteradas. Los archivos se entregan mediante enlaces firmados de corta duración.

## 10. Medidas de seguridad que existen hoy

- Contraseñas guardadas con hash seguro; verificación en dos pasos exigida a los roles críticos (como los administradores).
- Cifrado en tránsito entre tu dispositivo y el servicio.
- Cifrado a nivel de aplicación (AES-256-GCM) de: documento de identidad y NIT de los clientes, contactos, direcciones y el secreto de verificación en dos pasos. Otros datos se protegen con control de acceso y no con cifrado de campo.
- Aislamiento entre organizaciones en la base de datos y control de acceso por rol y por oficina.
- Registro de auditoría de las operaciones sensibles, límite de intentos de acceso y sesiones que se pueden revocar.
- Ninguna medida garantiza seguridad absoluta.

## 11. Cuánto tiempo conservamos los datos

Conservamos los datos mientras tu cuenta esté activa y después según obligaciones legales y de seguridad. Los respaldos de la base de datos se conservan por un período limitado. [PENDIENTE DE CONFIRMACIÓN LEGAL: plazos de conservación por tipo de dato y procedimiento de eliminación; hoy no hay eliminación automática.]

## 12. Tus derechos

Puedes pedirnos acceso, corrección, actualización, eliminación (cuando corresponda), limitación del tratamiento, oposición, exportación de tus datos y retirar tus consentimientos opcionales. Escríbenos a kobraxikigai@gmail.com. [PENDIENTE DE CONFIRMACIÓN LEGAL: plazo de respuesta.]

- Si eres **titular de datos de cobranza** (por ejemplo, un deudor, garante o referencia), no necesitas tener cuenta: escríbenos al mismo correo. Tu solicitud se deriva a la organización responsable de tu cartera y Kobrax la asiste. Si crees que tus datos se cargaron sin derecho, o que te están hostigando, también puedes **reportarlo** en [/reportar](/reportar) y, si se confirma, podemos suspender el acceso de esa cuenta.
- Kobrax **no declara cumplir** una ley de protección de datos concreta: Bolivia no tiene una ley integral vigente y usamos buenas prácticas internacionales como guía. [PENDIENTE DE CONFIRMACIÓN LEGAL: marco aplicable.]
- No eliminamos información sujeta a obligaciones legales, auditorías o conservación justificada; en ese caso la bloqueamos y te lo explicamos.
- Si no estás conforme, puedes presentarnos un reclamo por el mismo canal. Mantienes tu derecho a acudir a las autoridades competentes.

## 13. Cookies y almacenamiento

Ver la [Política de Cookies](/cookies).

## 14. Menores

[PENDIENTE DE CONFIRMACIÓN LEGAL: tratamiento de datos de menores.]

## 15. Cambios y versiones

Publicamos cada versión de esta política con su fecha y la conservamos. Los cambios materiales se te comunican y, cuando corresponda, se te pide un nuevo reconocimiento. Versión y fecha de vigencia se muestran junto al documento.


## 16. Aplicación móvil y tiendas de aplicaciones

Esta sección describe la aplicación móvil de Kobrax (Android) y sirve de base para la ficha de privacidad de las tiendas de aplicaciones.

**Permisos que pide la aplicación y para qué**
- **Ubicación (solo con la aplicación abierta):** marcar la dirección de un deudor y registrar visitas y evidencias. No se pide ubicación en segundo plano.
- **Cámara y fotos:** foto de fachada del cliente y comprobante de pago, que el usuario toma o elige.
- **Notificaciones:** avisos de agenda y alertas del servicio.
- **Huella o rostro del dispositivo:** desbloquear la sesión. La biometría la gestiona el sistema del teléfono; Kobrax no recibe ni guarda tu huella ni tu rostro.
- La aplicación **no lee los contactos, el registro de llamadas, los mensajes ni los archivos** del teléfono.

**Qué datos se envían a Kobrax:** los de tu cuenta y los de la cartera que tú registras (identificación, contacto, direcciones y coordenadas, gestiones, pagos informados, fotografías y firmas), más datos técnicos de la sesión. No vendemos datos ni los usamos para publicidad. Los datos de cartera pertenecen a la Organización cliente (puedes ser tú, si trabajas por tu cuenta).

**Qué queda en el teléfono:** para funcionar sin internet, la aplicación guarda una copia local de la información que necesitas y de las acciones pendientes de enviar. Se sincroniza cuando hay conexión. Si pierdes el teléfono, avisa a tu organización o escríbenos para cerrar tus sesiones.

**Seguridad:** la conexión a nuestros servidores está cifrada y la aplicación verifica la identidad del servidor. Las evidencias llevan una huella digital que permite comprobar que no fueron alteradas.

**Eliminación de tu cuenta y de tus datos:** pídela en [/eliminar-cuenta](/eliminar-cuenta), sin abrir la aplicación, o escribe a kobraxikigai@gmail.com desde el correo de tu cuenta. Para proteger tu cuenta, te enviaremos un correo con un enlace de un solo uso para confirmar que la solicitud es tuya antes de ejecutarla. [PENDIENTE TÉCNICO: Google Play exige además una opción dentro de la aplicación móvil.] [PENDIENTE DE CONFIRMACIÓN LEGAL: plazos y qué se conserva por obligación legal.]

**Datos de terceros:** la aplicación guarda datos de personas que no la usan (deudores, garantes, referencias). Esas personas pueden pedir acceso, corrección o eliminación, o reportar un uso indebido, escribiendo al mismo correo.
