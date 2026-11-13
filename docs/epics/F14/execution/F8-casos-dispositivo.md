# F14 · F8 — Casos para probar en un teléfono real

> **Estado: NO PROBADOS EN DISPOSITIVO.** Las pruebas automáticas del móvil (jest) y de la API cubren la lógica, pero ninguna corrió en un teléfono: lo hace la usuaria con esta lista. Cada caso dice qué hacer y qué debe pasar. Marca ✅ / ❌ y anota lo que veas.
>
> **Antes de empezar:** API y base con las migraciones al día; la app de esta rama (`f14/p8-movil`) instalada. Para los casos de datos personales (grupo C), arrancar la API con `PII_MOBILE_MASK=on`; para los demás, da igual.

## Usuarios de prueba (clave `Kobrax123!`)
Cobrador (`cobrador1@kobrax.demo`), supervisor (`supervisor@kobrax.demo`), gerente (`manager@kobrax.demo`), administrador (`owner@kobrax.demo`), y un auditor y una persona de consulta que se crean desde la web (Equipo › Invitar). Para la cuenta de una sola persona: registrar una cuenta nueva desde la app o la web.

## A · Quién puede entrar a la app (D-3)
| # | Qué hacer | Debe pasar | ✔ |
|---|---|---|---|
| A1 | Entrar con el **auditor** | No entra; dice «Tu rol se usa desde la web: entra desde el navegador» | |
| A2 | Entrar con la **persona de consulta** | Igual que A1 | |
| A3 | Entrar con cobrador, supervisor, gerente y administrador | Entran normal | |
| A4 | Con el supervisor **dentro de la app**, desde la web cambiarle el rol a Auditor; en el teléfono esperar a que renueve la sesión (o forzar con «actualizar») | La app vuelve al ingreso y **muestra el mensaje** de A1 | |

## B · Ventana sin conexión (D-2)
| # | Qué hacer | Debe pasar | ✔ |
|---|---|---|---|
| B1 | Cobrador: entrar, modo avión, esperar o adelantar el reloj ~3 h, abrir la app | **Sigue funcionando** (ventana de 8 h) | |
| B2 | Supervisor o gerente: entrar, modo avión, ~2 h 10 min | **Pide volver a entrar / pantalla sin conexión** (ventana de 2 h) | |
| B3 | **Cuenta de una sola persona** (administrador independiente): entrar, modo avión, ~3 h | **Sigue funcionando** (conserva 8 h) | |
| B4 | Supervisor: con red, abrir la app y volver a usarla | La ventana se renueva (otras 2 h desde ahí) | |

## C · Datos personales (D-4) — con `PII_MOBILE_MASK=on`
| # | Qué hacer | Debe pasar | ✔ |
|---|---|---|---|
| C1 | Cobrador: abrir **Editar cliente** de uno de su cartera | Abre **sin error**; teléfonos y direcciones en claro; el **documento sale protegido** (`12345***`) con la nota «Documento protegido…» | |
| C2 | Editar solo el nombre y guardar | Guarda; el documento no cambia | |
| C3 | Borrar parte del documento protegido y guardar | Avisa «El documento está protegido: escribe el documento completo o déjalo como estaba» y no guarda | |
| C4 | Escribir un documento completo nuevo y guardar | Guarda (es un cambio real) | |
| C5 | Alta de cliente con un documento nuevo | Sigue funcionando; el aviso de duplicados no se dispara con el documento protegido | |
| C6 | Desde la web, mismo cliente, revelar documento | Lo ve completo (la web no cambia) | |

## D · Alta de cliente y oficina (D-7)
| # | Qué hacer | Debe pasar | ✔ |
|---|---|---|---|
| D1 | **Cobrador con una sola oficina**, Nuevo cliente | **No aparece selector de oficina**; guarda | |
| D2 | **Cobrador con varias oficinas** (asignarle 2 desde la web), Nuevo cliente | Aparece «Oficina donde se registra»; **no deja guardar hasta elegir**; guarda en la elegida | |
| D3 | **Gerente asignado a la central**, Nuevo cliente | Ofrece las agencias (no la central); exige elegir | |
| D4 | Cobrador **sin oficina**, Nuevo cliente | Si el servidor lo rechaza, explica que falta la oficina (no el texto técnico) | |
| D5 | Cuenta de una persona / una oficina | Nada nuevo en pantalla | |

## E · Duplicados y créditos ajenos (D-8)
| # | Qué hacer | Debe pasar | ✔ |
|---|---|---|---|
| E1 | Nuevo cliente con el documento de un cliente que **no está en tu cartera** (lo lleva otra persona) | Dice «Este cliente ya existe y lo llevan otras personas» con nombre y documento protegido y el botón **«Crear mi préstamo sobre este cliente»** | |
| E2 | Tocar ese botón | Abre el formulario de préstamo para ese cliente; al guardar, **recién ahí lo ves** en tu cartera | |
| E3 | Lo mismo **sin señal** | No ofrece el botón (solo el servidor sabe que existe) | |
| E4 | Lo mismo con un rol sin `credit:create` | Solo explica, sin botón | |
| E5 | Ficha de un cliente que tiene créditos de otras personas | Muestra «Este cliente tiene N créditos más que no ves, por un saldo de …. A cargo de: …» (sin detalle) | |
| E6 | Ficha de un cliente que ves entero | **No** muestra ese aviso | |

## F · Cola y permisos al reconectar (N-06)
| # | Qué hacer | Debe pasar | ✔ |
|---|---|---|---|
| F1 | Sin señal, registrar un pago y una gestión; recuperar señal | Suben solos | |
| F2 | Sin señal, editar un cliente; desde la web **quitarle el cliente al cobrador** (reasignar el crédito a otra persona); recuperar señal | La acción queda **rechazada** en «Pendientes» con «Ya no tienes acceso a este cliente o crédito…» y el botón **Descartar** | |
| F3 | Sin señal, hacer algo; desde la web **cambiarle el rol** al cobrador a uno sin ese permiso; recuperar señal | Rechazada con «Tu rol o tu oficina ya no permiten esta acción…» | |
| F4 | Alta de cliente sin oficina que el servidor rechaza al subir | Rechazada con «Falta elegir en qué oficina se registra el cliente…» | |
| F5 | Recuperar señal con el rol ya cambiado | Los permisos y los tabs se actualizan **antes** de subir | |

## G · Menú y cuenta (D-9)
| # | Qué hacer | Debe pasar | ✔ |
|---|---|---|---|
| G1 | Los cuatro roles de campo | Ven los **cinco tabs** de siempre | |
| G2 | Más › Cuenta | Muestra **Mi rol** y **Mis oficinas** (o «Sin oficina asignada») | |

## H · Regresión del perfil gratuito individual
Registrar una cuenta nueva, entrar, crear cliente y crédito, registrar un pago sin señal y subirlo al volver, editar un cliente, subir una foto y verla. **No debe aparecer ninguna pantalla, selector ni texto nuevo.**

## Resultado
Anota aquí lo que falló: _______________________________________________
