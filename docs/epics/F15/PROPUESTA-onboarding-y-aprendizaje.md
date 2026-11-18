> ESTADO: BORRADOR (2026-11-13) — propuesta de producto, UX y arquitectura. **Sin código, sin rama.** Las decisiones D-10 a D-16 (§6) esperan a la usuaria. Parte de la petición «onboarding inteligente, Workspace y aprendizaje progresivo» y se contrasta con el código de `dev` del 2026-11-13.
> Se apoya en `PLAN-MVP-configurable-workspace.md` (v3) y su HUB. **D-10 aprobada (2026-11-13): esto va DENTRO de F15**, no como épica aparte; sus fases son P5 en adelante.

# Onboarding inteligente y aprendizaje progresivo

## 1. Auditoría: qué existe hoy (evidencia releída el 2026-11-13)
| # | Hecho | Evidencia |
|---|---|---|
| A-1 | **No existe ningún sistema de bienvenida, tour, ayuda contextual ni progreso de aprendizaje.** Es terreno nuevo. Lo único parecido es un aviso derivado de datos (`BillingAlert`), que no se descarta: desaparece cuando se completan los datos. | búsqueda en web, API, shared y móvil; `components/billing-alert.tsx` |
| A-2 | **El plan se elige al registrarse** (Free, Professional, Business; Enterprise no es elegible) y los planes de pago traen 30 días de prueba, tras los cuales la cuenta **cae a Free**. La fecha va en `accounts.settings.trialEndsAt`. | `registro/plan-picker.tsx`; `plans.ts:143,151`; `accounts.service.ts:73-97` |
| A-3 | **Los topes de los planes coinciden con tu texto** (Free 1 miembro, 20 créditos, 100 fotos; Professional 25 y 1.000; Business 100 y 5.000). Free tiene **1 oficina**. | `plans.ts:58-92` |
| A-4 | **El alta no devuelve sesión**: se hace el login y `routeByStep` decide el destino. Para el administrador eso significa **primero el enrolamiento de MFA** (obligatorio para `ACCOUNT_ADMIN`). Un asistente de configuración no puede ir antes. | `registro/page.tsx:22-23,76`; `auth.service.ts:113-118`; `mfa-policy.ts` |
| A-5 | **Un invitado** pasa por `/invitacion` (fija contraseña, entra y `routeByStep` lo lleva al panel). No pasa por el registro y no es quien configura la organización. | `invitacion/page.tsx:71-95` |
| A-6 | **`/auth/me` ya entrega** `account.{name, soloUser, preferences}` pero **no el plan** (el plan sale por `/accounts/me`). Un asistente solo para administradores puede pedir `/accounts/me` sin penalizar a los demás. | `auth.service.ts:383-447` |
| A-7 | **No hay dónde guardar estado por persona y organización.** `users` y `user_accounts` no tienen jsonb. Precedentes: preferencias de tabla en `localStorage` por usuario (`table-prefs.ts`, que justifica que «no es negocio»); tableros en una tabla propia por persona. | `schema.prisma:228-262,344`; `lib/table-prefs.ts:13` |
| A-8 | **Existe cambio de organización activa** (`/api/auth/switch-account`) y un usuario puede estar en varias cuentas. | `api/auth/switch-account/route.ts`; `panel-shell.tsx` |
| A-9 | **Precedente de inicialización perezosa:** al abrir el dashboard por primera vez se crean tres tableros de ejemplo para esa persona. Inicio es el ancla natural de la bienvenida. | `dashboards.service.ts:28-56` |
| A-10 | **La mayoría de lo que hay que «aprender» ya se puede medir con datos reales** (cuántos clientes, créditos, pagos, miembros, importaciones, rutas). Eso evita guardar «completé el tutorial». | HUB y endpoints existentes |
| A-11 | **Textos bilingües obligatorios:** hay prueba de paridad es/en; cada paso de guía cuesta dos textos. | `messages/es.json`, `en.json` |
| A-12 | **F15 no tiene código todavía:** el Workspace es un plan (v3, G4 pendiente). El onboarding depende de que exista el contrato `workspace` y su API (P1). | `docs/epics/F15/STATUS.md` |

## 2. Dónde cuestiono la petición (y por qué)
1. ~~No hace falta un wizard de 8 pasos.~~ **La usuaria eligió el asistente completo (D-11).** Se mantiene la preocupación de fondo (que no cueste abandonos) y se resuelve con el atajo «Usar la recomendada y terminar», los pasos omitibles y la escritura única al final.
2. **La recomendación no puede depender de la cantidad de miembros el día 0**: toda cuenta nace con uno. Sí puede depender del plan, como *sugerencia explicada* y nunca como regla (Business puede preferir la vista simple).
3. **El progreso de aprendizaje no debe ser un contador de pantallas vistas.** Debe salir de **hechos reales** («ya tienes un cliente») y solo se guarda lo que no se puede deducir: qué guías descartó o pospuso la persona.
4. **No mezclar estado de organización y de persona.** El Workspace y el estado del asistente son de la organización (los edita quien tiene `account:write`). El estado de guías es de cada persona **en cada organización**.
5. **Las sugerencias de descubrimiento deben respetar el plan.** Free tiene 1 miembro y 1 oficina: sugerirle Equipo u Organización es prometer algo que no puede usar. Para Free, esas sugerencias no existen.
6. ~~Es otra épica, no una fase de F15.~~ **Resuelto por la usuaria (D-10): va dentro de F15.** Consecuencia: el arnés exige un plan de fase just-in-time (RULES A7) y un G4 por fase; el G4 de F15 cubre P1–P4 y cada fase de onboarding (P5 en adelante) trae el suyo, para no alargar la validación del motor.

## 3. Propuesta de experiencia
### 3.1 Primer ingreso: quién ve qué
| Persona | Qué ve | Cuándo |
|---|---|---|
| Administrador de una cuenta **nueva** | Asistente corto (3.2) | La primera vez que entra al panel, **después** de enrolar MFA. Nunca antes. |
| Miembro invitado | Una tarjeta de bienvenida en Inicio: su rol, qué puede hacer y a quién pedir ayuda. **Sin asistente organizacional.** | Primer ingreso a esa organización |
| Administrador de una cuenta **que ya existía** | Nada obligatorio. Un enlace discreto «Revisar mi espacio de trabajo» en Cuenta. | — (no se rompen cuentas existentes) |
| Quien cambia de organización | La bienvenida que corresponda a **esa** organización, una sola vez | Primer ingreso a cada una |

### 3.2 El asistente de 8 pasos (solo administrador con `account:write`; D-11 aprobada)
Un asistente completo, pensado para que **no cueste abandonos**:
- **Barra de progreso** «Paso 3 de 8» y botón **Atrás** en todos los pasos.
- **Atajo permanente «Usar la configuración recomendada y terminar»** en cada paso: quien solo quiere empezar no recorre los 8.
- Los pasos 2 a 5 se pueden **omitir uno por uno** («Dejar como está»).
- **Nada se guarda hasta el paso 7**: los cambios viven en memoria y se escriben en **una sola llamada** (`workspace` + `onboarding` con `rev`). Si cierra a la mitad no queda una configuración a medias.
- Cerrar con la X equivale a **«Hacerlo después»**: la cuenta queda como estaba (Completo) y `onboarding.status` pasa a `skipped`. No vuelve a aparecer solo; queda el enlace en Cuenta y la tarjeta de primeros pasos.
- Nunca bloquea el acceso a la aplicación.

| Paso | Qué ve | Qué decide |
|---|---|---|
| 1 · Bienvenida y recomendación | Una frase de beneficio, la configuración recomendada y **por qué** («Elegiste Free: trabajas solo, así que mostramos lo esencial»). Tranquilidad: «No tienes que configurar todo ahora; puedes cambiarlo cuando quieras» | Aceptar la recomendación o seguir ajustando |
| 2 · Tu menú | Los módulos que tendrá, en lenguaje de negocio («Rutas: planificar visitas»), con los siempre visibles marcados | Qué módulos mostrar |
| 3 · Cómo trabajas | Preguntas de negocio, nunca técnicas: «¿Haces visitas a tus clientes?», «¿Cargas cartera desde un archivo?» (traducen a módulos y a opciones) | Opciones principales |
| 4 · Ficha de clientes | Qué secciones y campos mostrar (Ingresos, Garantes, Garantías, Adjuntos, género, canal, NIT) con un ejemplo de ficha en vivo | Secciones y campos |
| 5 · Tus créditos | Cómo se calculan tus créditos: «Cuota acordada», «Total acordado» o «Cálculo con intereses» (con un ejemplo de cada uno y qué pide el alta) | Modalidad y opciones financieras |
| 6 · Vista previa | El menú, la ficha y el alta de crédito tal como quedarán, con lo que cambió resaltado frente a «Completo» | Nada: revisar |
| 7 · Confirmar | Resumen en una lista corta y «Esto no cambia permisos, planes ni datos» | Guardar |
| 8 · Entrar | «Listo. Puedes cambiarlo en Cuenta › Espacio de trabajo.» y entra a Inicio con los primeros pasos | — |

Los pasos 2 a 5 reutilizan los mismos componentes y el mismo catálogo de opciones que la pestaña **Cuenta › Espacio de trabajo**, pero con otro marco (una decisión por pantalla, vista previa al lado): **no es una copia de la pantalla de Cuenta**. La interfaz no muestra nombres internos (`termUnit`, `arrearsMethod`, `fixed`, `requires`).

**Recomendación (sugerencia, no regla):** Free → Independiente; Professional → Equipo; Business → Completo. Sin datos suficientes → Independiente (sencillo y seguro). Se calcula con una función pura en `shared`, con tabla de pruebas.

### 3.3 Primeros pasos (Inicio)
Una tarjeta plegable con 3 a 5 tareas **derivadas de datos reales** (crear un cliente, crear un crédito, registrar una gestión o un pago…), adaptada a lo visible por plan ∧ permiso ∧ workspace. Se cierra sola al completarse o a mano, y no bloquea nada.

### 3.4 Guías: recorrido con spotlight + ayuda por pantalla (D-18, pedido por la usuaria el 2026-11-13)
**Recorrido general (el centro de la experiencia).** Se oscurece toda la pantalla y se **enfoca un elemento real** con un recuadro de luz; al lado aparece una tarjeta con una explicación que sirve de verdad y los botones **Atrás · Siguiente · Omitir recorrido**. Avanza por **todo el menú** y por **la barra superior**, en el mismo orden en que se ven.
- **Qué recorre:** cada módulo visible del menú (Inicio, Cartera, Mora, Agenda, Pagos, Rutas, Importar, Exportar, Equipo, Organización, Seguridad, Actividad, Cuenta, Perfil), y después **cambio de idioma, ayuda «?», avisos y menú de sesión** (más el cambio de organización, si la persona tiene varias). Un independiente con el preset simple recorre unos 12 pasos; un Completo, unos 18.
- **Solo lo que existe para esa persona:** los pasos se arman con `plan ∧ permiso ∧ workspace`; un módulo oculto o sin permiso se salta solo.
- **Cada tarjeta es útil, no decorativa:** una frase de **qué es**, tres puntos de **qué haces ahí**, y **«Empieza por…»** con la primera acción concreta. Barra de progreso «Paso 3 de 12».
- **Cómo se lanza:** se ofrece al terminar el asistente (paso 8), en la bienvenida del invitado y siempre desde el botón **«?»** de la barra superior («Recorrido general», «Guía de esta pantalla», «Centro de ayuda»). Omitir y repetir siempre disponibles; si se interrumpe, ofrece **«Seguir donde lo dejé»** (el paso se guarda en `user_guide_states`).
- **Maqueta interactiva:** pantalla 5 de `diseno/` (https://claude.ai/artifact/NP7wYGNCPPecxh6zxRfT5t).
- **Accesibilidad y adaptación:** foco atrapado en la tarjeta, `Esc` sale, `←`/`→` navegan, respeta «reducir movimiento»; en el celular el menú es un cajón y el recorrido lo **abre** para enfocar cada ítem; el selector de idioma se enfoca en la instancia que realmente se ve (en celular vive dentro del cajón).
- **No interrumpe:** nunca arranca solo en medio de un formulario o una operación, ni por segunda vez si ya se omitió.

**Guía de esta pantalla (secundaria).** La primera vez que se entra a un módulo, y solo si la acción que enseña aún no se hizo, un spotlight corto (2 a 4 pasos) señala los **botones y acciones principales** de esa pantalla (p. ej., en Cartera: «Nuevo cliente», filtros, la ficha). Se repite desde «?». Es el mismo motor, con catálogo por módulo.

**Centro de ayuda (`/ayuda`, dentro de la primera versión).** Se genera del **mismo catálogo**: una explicación por módulo y por acción, con búsqueda. Una sola fuente para el recorrido, la guía de pantalla y la ayuda. Sin videos.

### 3.5 Descubrimiento progresivo — **DIFERIDO (D-15)**
> La usuaria decidió no incluir sugerencias en esta etapa. Lo de abajo se conserva como criterio de diseño para retomarlo; no entra en P5–P10.

Tarjetas **dentro de la pantalla correspondiente**, no ventanas emergentes, con tope de frecuencia y descarte permanente. Reglas sobre datos que ya se cargan (p. ej. «tienes 12 clientes con visita pendiente» → Rutas; «cargaste 30 clientes a mano» → Importar). Solo si el módulo está disponible por permiso, workspace y **plan**. Nada comercial.

## 4. Arquitectura (con el mínimo de piezas nuevas)
| Qué | Dónde vive | ¿Pieza nueva? | Por qué |
|---|---|---|---|
| Configuración visible | `configuration.workspace` (F15) | No | Ya diseñado |
| Estado del asistente de la organización | `configuration.onboarding = {v, status: pending\|done\|skipped, decidedBy, decidedAt, preset}` | **Clave nueva dentro del mismo jsonb, sin migración**; separada de `workspace` | Es de la organización; la edita quien tiene `account:write`; `absent` = cuenta anterior = sin asistente |
| Progreso de aprendizaje (hechos) | **Derivado** de datos reales | No | No se guarda lo que se puede calcular (A-10) |
| Guías descartadas o pospuestas | **Servidor** (D-13): tabla `user_guide_states` (D-17, pendiente), una fila por persona y organización, jsonb con `version` | **Sí: migración aditiva + endpoint propio** | Sigue a la persona entre navegadores y, más adelante, al móvil. Justificado porque la usuaria pidió continuidad; el progreso real sigue derivándose de datos y no se guarda |
| Catálogo de guías y de sugerencias | `packages/shared` (datos estáticos con versión y `requires`) | Módulo nuevo | Una sola fuente para tour, ayuda y sugerencias; versionado sin migración |
| Recomendación inicial | `recommendSetup(ctx)` en `shared` | Función pura | Probable sin interfaz |
| Plan, permisos | Los de siempre | No | **Disponibilidad de una guía = cálculo en cada render** (`plan ∧ permiso ∧ workspace`), nunca guardada: cubre cambio de plan, de rol y de workspace sin migrar nada |

- **API:** `PATCH /accounts/me` acepta `onboarding` además de `workspace` (la misma ampliación de la condición de merge, C-12, se hace **una vez** para ambos). El asistente guarda `workspace` y `onboarding` **en una sola llamada** (con `rev`). **Estado de guías (D-13):** un endpoint propio `GET`/`PUT /users/me/guides` (sin permiso especial: cada persona solo toca su fila), con aislamiento por cuenta y por usuario, y **carga no bloqueante** (después de pintar el panel, sin ralentizar la carga inicial). Es un handler nuevo: el snapshot de puertas (`authz-snapshot.json`) **cambia y lo aprueba la usuaria**, como en F2 y F3.
- **`/auth/me`** añade `account.onboarding.status` (un dato mínimo, sin llamada extra). Las cuentas nuevas nacen con `status: 'pending'`.
- **Seguridad (heredada de F15):** ocultar ≠ autorizar; defaults válidos para el motor; reversible; móvil sin cambios; cuentas antiguas intactas. **Única migración de la épica (D-13):** aditiva, con RLS por cuenta, reversible borrando la tabla; el motor Workspace (P1–P4) sigue sin migración.

## 5. Fases propuestas (dentro de F15; cada una en su rama `f15/p<N>-<nombre>`, `dev` como base, y con su G4)
| Fase | Objetivo | Depende de | Verificación |
|---|---|---|---|
| F15 · P1–P4 | Motor Workspace (ya planificado) | G4 PASS | según F15 |
| **P5** | `shared`: catálogo de guías, `recommendSetup`, tipos | — | pruebas unitarias; `tsc` del móvil |
| **P6** | `configuration.onboarding` + `/auth/me` + cuentas nuevas en `pending` + **tabla `user_guide_states` y su endpoint** (D-13/D-17) | P1 | API; aislamiento entre cuentas y entre usuarios; migración aditiva y su reversa; snapshot de puertas aprobado |
| **P7** | Asistente del administrador (web) | P5, P6, P2–P4 | recorrido con 3 planes; MFA primero; invitado no lo ve |
| **P8** | Bienvenida de invitados + primeros pasos en Inicio | P6 | permisos y roles personalizados |
| **P9** | **Motor de spotlight** + botón «?» + **recorrido general del menú y la barra superior** (todos los módulos visibles) + «Seguir donde lo dejé» | P5, P6 | pasos filtrados por plan ∧ permiso ∧ workspace; omitir/repetir; no interrumpir; cajón del menú en celular; foco y teclado; cambio de cuenta |
| **P10** | **Guías de pantalla** (primera visita) de Cartera, Mora, Agenda, Pagos, Rutas, Equipo y Organización + **Centro de ayuda `/ayuda`** | P9 | paridad es/en; el catálogo es la única fuente |
| ~~P11~~ | ~~Sugerencias de descubrimiento~~ **(diferida, D-15)** | P9 | — |

## 6. Decisiones que necesitan aprobación
| ID | Decisión | Mi recomendación |
|---|---|---|
| D-10 | ¿Épica propia (F16) o fase de F15? | **APROBADA (usuaria, 2026-11-13): dentro de F15** (fases P5 en adelante, un G4 por fase) |
| D-11 | Forma del asistente | **APROBADA (usuaria, 2026-11-13): asistente completo de 8 pasos**, con atajo para terminar, pasos 2 a 5 omitibles y una sola escritura al final (§3.2) |
| D-12 | Recomendación por plan | **APROBADA (usuaria, 2026-11-13):** Free → Independiente; Professional → Equipo; Business → Completo; solo como sugerencia, siempre explicada y modificable; sin datos suficientes → Independiente |
| D-13 | Dónde se guardan las guías descartadas | **APROBADA (usuaria, 2026-11-13): en el servidor desde el inicio** (no `localStorage`). Es la **primera migración de F15** (aditiva) y añade un endpoint: ver D-17 y §4 |
| D-18 | Forma de la guía | **APROBADA (usuaria, 2026-11-13, pedida con sus palabras):** recorrido con spotlight sobre la pantalla real que **pasa por todo el menú**, el cambio de idioma y las acciones visibles, con Siguiente/Atrás/Omitir (§3.4) |
| D-17 | Forma de guardarlo en el servidor | **Tabla propia `user_guide_states`** (clave `user_id` + `account_id`, jsonb versionado) en vez de una columna en `user_accounts`: aísla el estado de interfaz de la tabla de membresías y roles, que lleva triggers de autorización (`user_accounts_sync_account_role`) y es de alto riesgo. **APROBADA (usuaria, 2026-11-13).** |
| D-14 | Cuándo y a quién se muestra el asistente | **APROBADA (usuaria, 2026-11-13):** solo `account:write`, **después de MFA**, una sola vez, solo en cuentas nuevas; las existentes no reciben nada obligatorio (solo el enlace en Cuenta); con varios administradores, el primero que lo termina u omite lo resuelve para todos |
| D-15 | Sugerencias de descubrimiento | **APROBADA (usuaria, 2026-11-13): sin sugerencias por ahora.** Se difiere la fase P11. Queda como criterio para cuando se retome: tarjetas en pantalla (no ventanas), con tope de frecuencia y sin sugerir lo que el plan, el permiso o el workspace no permiten |
| D-16 | Qué queda fuera de la primera versión | **APROBADA (usuaria, 2026-11-13).** **Fuera:** videos; el móvil (no se toca ahora: todo lo del móvil, con todo lo ya construido, se trabaja junto en una sola etapa posterior); las guías de las *opciones de personalización* de la ola 1b, que se agregan al catálogo cuando se construya cada opción. **Dentro:** el Centro de ayuda `/ayuda` (P10) y las guías de Mora, Agenda y Pagos **tal como existen hoy** |
