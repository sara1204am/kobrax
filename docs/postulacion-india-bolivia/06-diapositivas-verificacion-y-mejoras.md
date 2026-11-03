# Las 10 diapositivas contra la app real: verificación y mejoras

> **Fecha:** 2026-10-12 · **Cierre de la postulación:** 2026-10-15
> **Qué es:** contraste de la versión corregida de las 10 diapositivas con el código y los documentos del repo
> (`02-dossier-tecnico.md`, `docs/business/*`, `docs/producto/*`, `docs/epics/F4/13-*`, `infra/production/*`, `git log`)
> y con las fuentes públicas de ASFI. Termina con el contenido que **se puede agregar** para fortalecerlas.
> **Regla usada:** si algo no está en el código como implementado, la diapositiva no lo afirma como función disponible.
>
> Leyenda: ✅ coherente y verificado · 🟡 coherente con matiz (conviene ajustar el texto) · 🔴 hay que corregir · ❓ no verificable desde el repo (lo confirma el equipo)

---

## 0. Veredicto en una página

La narrativa de las 10 diapositivas **es coherente con la app**: no promete IA que no existe, la etapa 1 de la hoja de ruta
refleja el estado real y la lista de «qué ya ofrece el producto» se sostiene en el código. Lo que hay que ajustar es poco y concreto:

| # | Hallazgo | Diapositiva | Gravedad |
|---|---|---|---|
| 1 | «Resúmenes de **casos**»: el producto **eliminó el concepto de caso** (F4/08); todo cuelga del **crédito** | 5 | 🔴 terminología |
| 2 | «Conservación de fotos 6/24/60 meses»: **hoy no hay nada que archive ni venza** las fotos (viven en disco local; la retención espera la migración a R2) | 7 | 🔴 prometer lo que no se hace cumplir |
| 3 | «Motivos de incumplimiento»: **ya existen** (F4/13 E4), pero en una rama **sin PR, sin desplegar y sin validar con cobradores**; el catálogo es un borrador | 4 | 🟡 decir «motivo de no pago», con estado |
| 4 | Fundadores: la biografía de la diap. 10 **no coincide** con lo que dice `PRICING-Y-DEPLOY.md` (cobradora en Banco FIE → encargada regional vs. «normalizadora de cartera») y **no hay nada del equipo en el repo** | 10 | 🔴 unificar y confirmar |
| 5 | Mora ASFI: **2024 y 2025 verificados**; **2019 (1,9 % / Bs 3.456 M) no pude confirmarlo** en fuente oficial | 3 | 🟡 confirmar antes de enviar |
| 6 | «Respaldos» y «almacenamiento de evidencias» en el «Ahora» de la diap. 8: los respaldos van **al mismo disco** y las fotos **al disco local**; ambos están en la lista de pendientes | 8 | 🟡 nombrarlos como pendientes |
| 7 | «Prueba de 30 días» en Professional y Business: ✅ existe, pero falta decir que **al vencer cae a FREE** (no se bloquea) | 7 | 🟡 completar |
| 8 | Hoja de ruta: hoy es solo futuro. El repo permite mostrar **cómo se construyó** y **en qué fase está** (lo que pidieron) | 8 | ➕ mejora |

> **Categoría de la postulación: Innovadoras · Etapa de Idea · FinTech.** Esto cambia el énfasis de varias láminas:
> ver §7 (al final) antes de aplicar las mejoras de §3.

Lo que **no** hay que tocar: el cuidado con la competencia (diap. 6), la advertencia de que no se afirma impacto
ambiental ni mejora de recuperación (diap. 8–9) y el cierre «la IA no sustituye al cobrador» (diap. 5). Son consistentes
con `05-pendientes-y-riesgos.md` §B.

---

## 1. Verificación diapositiva por diapositiva

### Diapositiva 1 · Presentación

| Afirmación | Estado | Evidencia / comentario |
|---|---|---|
| «Tecnología desarrollada en Bolivia» | ✅ | El repo es de 473 commits (2026-05-18 → 2026-10-10). |
| «Infraestructura de datos de cobranza en campo» | ✅ | Coincide con el posicionamiento del dossier §1 y §4. |
| Capturas reales de app y panel | ➕ | Hay despliegue con datos de prueba en `kobrax.ikigaisystems.lat` y seeds demo (§4.7). Usar capturas **de esa demo**, no del extracto real `docs/flows/mora union.PDF`. |

### Diapositiva 2 · La problemática

Texto de problema y ejemplos anecdóticos: **no depende de la app**. Está bien redactada (marca los casos como anécdotas, no estadística).
Único apoyo técnico que sí se puede citar: «pérdida de historial cuando cambia el responsable» **ya tiene respuesta real en el producto**:
al desactivar a un miembro con trabajo a su nombre, el sistema obliga a indicar a quién se traspasa y lo audita
(`users.service.ts`, `updateMember`; `docs/producto/roles-permisos-planes.md` §2). Puede usarse como puente a la diap. 4.

### Diapositiva 3 · La oportunidad de mercado

| Dato de la diapositiva | Estado | Fuente |
|---|---|---|
| Mora 2024: 3,2 % · Bs 7.076 millones | ✅ | Rendición Pública de Cuentas ASFI gestión 2024 (mora Bs 7.076 M, índice 3,2 %). |
| Mora cierre 2025: 3,0 % | ✅ con ajuste | ASFI informa **2,97 %**. «3,0 %» es redondeo válido; si se muestra un decimal, mejor «2,97 %». |
| Cartera en mora 2025: Bs 6.825 M · cartera de créditos Bs 229.576 M | 🟡 | Las cifras salen de una nota de prensa que cita a ASFI; el cociente es coherente con 2,97 %. Confirmar en el PDF oficial de ASFI (Rendición de Cuentas Final 2025) y citarlo. |
| Mora 2019: 1,9 % · Bs 3.456 M | ❓ | **No encontré respaldo** en la búsqueda. La serie histórica de ASFI (informe anual 2019 o su base de indicadores) lo confirma o lo corrige. Hasta entonces, mostrar solo 2024 → 2025 o rotularlo «dato por confirmar». |
| «El monto se duplicó aproximadamente» | ✅ | 3.456 → 7.076 = ×2,05 (si el dato de 2019 es correcto). |
| «No extrapolar a Dismac, inmobiliarias…» | ✅ | Coherente con `PRICING-Y-DEPLOY.md` §2 (mercado = `[SUPUESTO]`). |

> **Nota de coherencia con la app:** hoy el registro público crea **siempre** una cuenta tipo `INDEPENDENT`; los tipos
> `FINANCIAL_INSTITUTION`, `COLLECTION_AGENCY` y `RETAIL_CREDIT` existen en el modelo pero ningún flujo los asigna y
> ninguna regla ramifica por tipo (`roles-permisos-planes.md` §1). La lista «bancos, cooperativas, agencias, tiendas,
> inmobiliarias» es **mercado objetivo**, no segmentos configurados en el producto. Está bien decirlo así; evitar
> «Kobrax ya tiene un modo para bancos / inmobiliarias».

### Diapositiva 4 · La solución

| Afirmación | Estado | Evidencia |
|---|---|---|
| Plataforma web y móvil | ✅ | API NestJS, panel Next.js 14 (~25 pantallas), app Expo (5 pestañas). |
| «Registrar visitas, domicilios, referencias, pagos, acuerdos, promesas» | ✅ | Dossier §3.1–3.3: gestiones, promesas con fecha e importe, ubicaciones por cliente, referencias/garantes, pagos idempotentes. |
| «…y **motivos de incumplimiento**» | 🟡 | **Implementado** como «motivo de no pago» opcional en la gestión (F4/13 E4: `reason_code`, `expected_income_date`, `payer_party`, `origin`). **Pero:** vive en la rama `docs/ia-capa-datos`, sin PR ni merge, **no está desplegado** y no se ha validado en teléfono; la lista de motivos es un borrador pendiente de validar con cobradores. La visita de **ruta** también lo captura desde 2026-10-12 (D-55). |
| «Conservar la continuidad de cada crédito» | ✅ | Mora modelada como **episodios** con historial, promesas y notas; `credit_activities` es append-only. |
| «Trabajo móvil offline y sincronización» | ✅ | SQLite + cola idempotente + conflictos. 🟡 sin pruebas e2e en dispositivo físico. |
| «Evidencias e historial» | ✅ | Foto + GPS + SHA-256 **verificado en servidor**, deduplicado, inmutable. El hash **no** se calcula aún en el dispositivo (dossier §3.3). |
| «Rutas» | ✅ | Planificador de 4 pasos, mapa, resultado por parada, cobro con cuota sugerida, resumen de jornada. Optimización OSRM con degradación a línea recta. |

**Texto sugerido para el «motivo»:** *«motivo de no pago y quién responde, de forma estructurada (en validación con cobradores)»*.

### Diapositiva 5 · La innovación

| Afirmación | Estado | Evidencia |
|---|---|---|
| Etapa 1 «Base operativa y asistencia» como **prioridad actual** | ✅ | Dossier §3.4: nivel 1 ✅ y nivel 2 🟡. |
| «Resúmenes de **casos**, alertas y estructuración de notas» | 🔴 | **«Caso» ya no existe** (F4/08, rama `feat/sin-caso`; `apps/mobile/CLAUDE.md`: «No hay casos: todo cuelga del crédito»). Decir **«resúmenes del crédito»**. Además: *alertas* ✅ existen (promesas por vencer, gestiones vencidas, recordatorios de cuota); *resúmenes* y *dictado/estructuración de notas* ❌ **no existen** (dossier §3.4). Están correctamente ubicados como «funciones iniciales **después** de consolidar el MVP». |
| Etapa 2 «Análisis de patrones» — *desarrollo futuro* | ✅ | No existe análisis de efectividad (dossier §3.1: analytics son descriptivos). |
| Etapa 3 «Recomendación contextual» — *visión futura* | ✅ | No existe. |
| «La IA no sustituye al cobrador» | ✅ | `ia-plan-maestro`/K1: sin modelo propio de ML; supervisión humana. |

### Diapositiva 6 · Diferenciación y competencia

| Afirmación | Estado | Comentario |
|---|---|---|
| Conectividad offline | ✅ | Pero **no es único**: CarteraGo y AtllasPay también lo ofrecen (dossier §4). La diapositiva lo presenta como «enfoque», no como exclusivo: correcto. |
| Plan gratuito + suscripciones | ✅ | FREE existe y se elige al registrarse (web y móvil). |
| Nombres de proveedores | ✅ | Coincide con `resumen.md` §3. **CobrApp y Geo Cash no aparecen**: correcto. |
| «Inteligencia progresiva» | ✅ | Es visión, y así se rotula. |

**Cuidado con el orden de lectura:** la tabla pone «Conectividad» y «Operación de campo» primero; los competidores las tienen.
Lo **defendible hoy** (dossier §4) es: evidencia con valor probatorio, mismo producto de 1 a 500 usuarios, aislamiento en
base de datos (RLS), mora como episodios y rutas sobre OSRM propio. Sugerencia en §3.3 de este documento.

### Diapositiva 7 · Modelo de negocio

Contraste con `packages/shared/src/constants/plans.ts` (catálogo único que leen web, móvil y API):

| Plan | En la diapositiva | En el código | Estado |
|---|---|---|---|
| FREE | $0 · 1 miembro · 20 créditos · 100 fotos/mes · 6 meses | `users 1 · credits 20 · photosPerMonth 100 · retention 6` | ✅ |
| PROFESSIONAL | $12/miembro · 25 · 1.000 · 5.000 fotos · 24 meses | `perSeat 12 · 25 · 1000 · 5000 · 24` | ✅ |
| BUSINESS | $99 + $10/miembro · 100 · 5.000 · 25.000 · 60 meses | `base 99 · perSeat 10 · 100 · 5000 · 25000 · 60` | ✅ |
| ENTERPRISE | «Precio personalizado» | `base 800 · perSeat 8` (**piso**, no ilimitado; el contrato lo sube) | 🟡 ver abajo |
| Prueba de 30 días (Professional y Business) | «según la oferta actual» | `TRIAL_DAYS = 30`, aplica a los planes pagos elegidos al registrarse; `plan-lifecycle.service.ts` los **cae a FREE** al vencer | ✅ + completar |

**Qué se hace cumplir hoy (importante para no sobre-prometer)** — `docs/business/LIMITES-BUILD-PLAN.md` §1 y `plan-limits.service.ts`:

| Tope | ¿El sistema lo hace cumplir? | Cómo decirlo en la diapositiva |
|---|---|---|
| Miembros | ✅ frena al invitar y al reactivar (cuenta también invitaciones pendientes) | «Hasta N miembros» ✔ |
| Créditos activos y clientes | ✅ frena en el alta y en la importación (y avisa en la vista previa) | «Hasta N créditos activos» ✔ |
| Fotos por mes y gestiones por mes | 🔔 **se cuentan y avisan** (80 % y 100 %); **nunca bloquean** a propósito: una foto de campo ya ocurrió | «N fotos/mes incluidas (aviso al llegar al tope)» |
| **Conservación de fotos (6/24/60 meses)** | ❌ **no se hace cumplir**: no hay archivado ni vencimiento (bloqueado por la migración a R2) | 🔴 «Política de conservación del plan» **o** quitar la fila de la diapositiva hasta que exista |
| Sucursales | ❌ la función no existe (solo la tabla) | Correctamente **ausente** de la diapositiva |
| Cobro automático / pasarela | ❌ no existe: factura y cambio de plan **manuales**; sin autoservicio de cambio de plan | No afirmar «suscripción automática»; decir «facturación mensual» |

**Dos precisiones de lenguaje:**
1. La diapositiva dice «**miembro**»; `PRICING-Y-DEPLOY.md` dice «por **cobrador**». En el código es **por asiento**
   (`price = base + perSeat × miembro`) y **cuentan todos los roles** (administrador, supervisor, cobrador). Mantener
   «miembro» en pantalla es lo correcto; no decir «por cobrador» en una cotización.
2. Las comparaciones con AtllasPay (USD 28 **por ruta**) y CarteraGo (desde USD 6 **por ruta**) usan **otra unidad**
   (ruta vs. miembro). No poner «somos más baratos» sin explicar la unidad. (Dossier §5.)

### Diapositiva 8 · Hoja de ruta y validación comercial

| Afirmación | Estado | Evidencia / comentario |
|---|---|---|
| «Ahora: validar flujos web y móviles, sincronización, evidencias, seguridad, respaldos, Google Play» | 🟡 | Todo es **trabajo pendiente real** (ver tabla siguiente). Está bien como «ahora», pero conviene **nombrar** cada pendiente. |
| 0–6 meses pilotos · 6–12 patrones · 12–18 recomendaciones | ✅ | Coherente con las etapas 3–5 de `resumen.md` §8 y rotulado como «objetivos propuestos». |
| «Indicadores iniciales» | ✅ | Compatible con lo que el producto ya registra (visitas planificadas vs. realizadas, promesas, resultados). |
| «No afirmamos mejora % de recuperación» | ✅ | Correcto: no hay medición. |

**Pendientes verificados para el «Ahora»:**

| Pendiente | Estado real | Fuente |
|---|---|---|
| Fotos en almacenamiento en la nube (R2) | ❌ hoy disco local; «las fotos son el producto» | `infra/production/README.md`; `PRICING-Y-DEPLOY.md` §7 |
| Respaldos **fuera del servidor** | ❌ `pg_dump` al mismo disco (sirve para deshacer una migración, no si el servidor muere) | `infra/production/deploy.sh`, README |
| Cuenta Google Play de empresa | ❓ el README de infraestructura la lista «sin empezar» (2–4 semanas de espera por verificación D-U-N-S); confirmar si cambió. El identificador de la app hoy es `demo.kobrax.mobile` (v1.1.0, versionCode 10100): **hay que definir el identificador definitivo** antes de publicar | `apps/mobile/app.json` |
| Push remoto, SSL pinning, cifrado en reposo | 🟡 implementados y probados en código; **no validados en teléfono** (falta proyecto Firebase) | dossier §3.3 |
| Pruebas e2e en dispositivo | ❌ solo pruebas unitarias y exportación | dossier §3.3 |
| Mapas de producción y paquetes offline | 🟡 sin estilo de producción; tiles de desarrollo | `05-pendientes` §C |
| OSRM en producción | ❓ el README de producción lo lista como no levantado; sin él las rutas degradan a línea recta | `infra/production/README.md` |

### Diapositiva 9 · Impacto

✅ Totalmente coherente: no cuantifica CO₂ ni papel ni recuperación y dice cómo medirlo. Los indicadores que menciona
(kilómetros, visitas repetidas, seguimiento de compromisos) **sí se pueden obtener de lo que la app ya registra**
(rutas con OSRM, visitas con GPS, promesas con seguimiento). Ver propuesta de línea base en §3.6.

### Diapositiva 10 · Fundadores y cierre

| Afirmación | Estado | Comentario |
|---|---|---|
| Biografía de Sara: Ingeniera de Sistemas, +6 años full stack, banca como «normalizadora de cartera», maestrante en IA | ❓/🔴 | Nada de esto está en el repo. **Y** `PRICING-Y-DEPLOY.md` §2 dice: «trabajó **un año como cobradora en Banco FIE** y ascendió a **encargada regional en Chuquisaca**». Son dos descripciones distintas del mismo cargo: elegir una, ajustar el otro documento y que coincida con el formulario. |
| Biografía de Josué | ❓ | El repo solo lo nombra como asignado de QA móvil. No hay datos que contrastar. Confirmar. |
| «Experiencia directa con el problema y capacidad para desarrollar la solución» | ✅ | Respaldado por el producto construido (§4.1). |
| Cita de visión | ✅ | Igual que la diap. 5: sin afirmar IA operativa. |

---

## 2. Inconsistencias **entre** documentos que conviene resolver antes de enviar

| Tema | Dónde dice qué | Qué usar |
|---|---|---|
| Roles base | `dossier` §2: «6 roles»; `roles-permisos-planes.md` §2: **7** (`SUPER_ADMIN`, `ACCOUNT_ADMIN`, `MANAGER`, `SUPERVISOR`, `COLLECTOR`, `AUDITOR`, `VIEWER`) y solo **3 asignables** por la API | «7 roles, 36 permisos» |
| Conteo de pruebas | dossier §8 (dev, 2026-10-10): API 1.542 · web 938 · móvil 916 · integración 51. F4/13 (rama `docs/ia-capa-datos`): shared 423 · API 1.583 · web 971 · móvil 959 · integración 99 | Citar **una** fecha y una rama; sumar «más de 3.500 pruebas automáticas» es seguro con cualquiera |
| «Desplegado» | `PRICING-Y-DEPLOY.md` §1/§9: «no desplegado» (desactualizado); dossier §7: desplegado con datos de prueba | «Desplegado con datos de prueba» |
| Topes del FREE | `LIMITES-POR-PLAN.md` §2/§5.1 (sugerencias viejas: 50 créditos / 300 fotos); `plans.ts` y §4-A: **20 créditos / 100 fotos** | La diapositiva ya usa 20/100 ✔ |
| Mínimo de 5 cobradores en Professional | PRICING lo conserva como duda abierta; la grilla vigente no lo exige | No mencionarlo |
| Costo de infraestructura etapa piloto | PRICING §1 «~$25» vs §5 «$23–27 (con mapas pagos $43–47)» vs dossier «~$23–47» | «~$25–45/mes en el piloto» |

---

## 3. Qué agregar para mejorar las diapositivas

Todo lo de abajo **ya existe en el repo**, con su estado. Cada bloque dice a qué diapositiva suma y cómo decirlo sin sobre-prometer.

### 3.1 Hoja de ruta: «cómo fuimos construyendo la app» y en qué fase estamos (Diap. 8)

Propuesta: reemplazar la línea de tiempo solo-futuro por **tres bandas**: *Construido → Ahora → Próximo*. La banda «Construido»
sale del historial real (`git log`, `HANDOFF.md`, `docs/epics/*`):

| Cuándo | Hito construido | Evidencia |
|---|---|---|
| may–jul 2026 | **Fundación y núcleo de datos:** monorepo, multi-tenant con RLS, auth (JWT + refresh + 2FA), cifrado de datos personales | F0–F2 ✅ (`HANDOFF.md`) |
| jul 2026 | **Núcleo financiero:** clientes con PII cifrada, créditos con cronograma y mora, importación, pagos con ledger inmutable, evidencia SHA-256, realtime | F4–F8 base ✅ |
| jul–ago 2026 | **App del cobrador (offline-first):** agenda, rutas con mapa y resultado por parada, cuenta y registro, sincronización offline | F10 P0–P6; rutas S1–S6 (4 ago); offline (7 ago) |
| ago 2026 | **Panel web completo** (W0–W8): cartera, importación, mora/agenda, rutas y evidencia, pagos, dashboard | PR/merge 10–13 ago |
| ago 2026 | **Planes y límites** (FREE/PROFESSIONAL/BUSINESS/ENTERPRISE), registro con plan, prueba de 30 días, avisos de uso | 20–23 ago |
| ago 2026 | **Despliegue automático** en cada merge, con respaldo previo, migraciones y RLS | 30 ago (`deploy.yml`) |
| sep 2026 | **Motor financiero único** y nuevo alta de crédito (condiciones, cuota variable, desgravamen, cargos) | F4/06, 24–26 sep |
| oct 2026 | **Central de mora** (web y móvil); **«caso» eliminado**: todo cuelga del crédito | F4/07, F4/08 |
| oct 2026 | **Alineación móvil ↔ web** (PR #6–#12) y **rutas** rediseñadas | F4/12 |
| 10 oct 2026 | **Capa de datos para IA** (perfil de ingreso, perfil de cobro, motivo de no pago, plantilla elegida) | F4/13 E1–E6 (rama, sin PR) |

**Dónde estamos, mapeado a las 5 etapas de `resumen.md` §8** (esta es la «fase» que piden mostrar):

| Etapa | Estado | Qué hay |
|---|---|---|
| 1 · Consolidar la gestión operativa | **Avanzada** (en curso) | Todo lo de §4 del dossier; pendiente validar en teléfono y piloto |
| 2 · Estructurar datos para análisis | **Iniciada** | Capa A hecha en rama: catálogos por cuenta, motivo de no pago, perfil de ingreso y de cobro, origen del dato (manual/dictado/importado). Falta validar la lista de motivos con cobradores |
| 3 · Automatizar y asistir | **Inicial** | Prioridad automática de mora, recordatorios, alertas de promesas, hora recomendada (reglas deterministas). Faltan agendas recurrentes, resumen de historial, dictado |
| 4 · Analizar efectividad | No iniciada | Requiere datos de uso real |
| 5 · Recomendaciones | No iniciada | Solo con datos suficientes y evaluación |

**Frase sugerida:** *«Construimos desde el dato hacia la inteligencia: hoy cerramos las etapas 1 y 2 sobre una base
desplegada; las etapas 4 y 5 solo comienzan cuando haya datos reales de pilotos.»*

**Detalle de honestidad para esa lámina** (una línea): *«Desplegado con datos de prueba. Sin clientes pagantes todavía.»*

### 3.2 Multi-tenant: explicarlo y usarlo como argumento (Diap. 4 o 6)

La diapositiva 6 menciona «diferencias entre un cobrador independiente y una operación empresarial» pero **no muestra el
mecanismo**. Es la ventaja técnica más sólida y la menos comunicada:

| Punto | Verificado en el repo |
|---|---|
| **Una sola plataforma** de cobrador independiente a financiera | `account_id` en toda entidad operativa; el registro crea una cuenta y su administrador (también cobra) |
| **Aislamiento a nivel de base de datos** (no solo en el código) | RLS `FORCE` en 39 tablas operativas; cuenta `DEMO2` existe solo para probar que una empresa no ve a la otra; hay pruebas de integración contra Postgres real |
| **Un usuario, varias empresas** | Membresías múltiples + pantalla «select-account» (demo `multi@`) |
| **Roles y permisos** | 7 roles, 36 permisos, MFA obligatorio para roles críticos (impuesto en el servidor), sesiones activas, auditoría de mutaciones con PII redactada |
| **Gating por capacidad, no por tipo de cuenta** | Regla de arquitectura: «capacidades por RBAC, nunca por `tenantType`» |
| **Sin mezcla de datos entre entidades** | Decisión K5 de F4/13: sin aprendizaje entre cuentas; todo dato queda por `account_id` — **importante para bancos y para la futura IA** (`resumen.md` §10) |

**Límites a decir con honestidad (si preguntan):** el alcance por fila *dentro* de una empresa («el cobrador solo ve su cartera»)
se aplica en Mora, Agenda, Rutas y visitas, **pero no en Cartera ni Pagos** y no hay policies de alcance en la base de datos
(`05-pendientes` §B). Y hoy no hay pantalla para crear sucursales.

**Texto sugerido (diap. 6, fila nueva «Aislamiento»):** *«Cada empresa trabaja en su propio espacio, aislado en la base de
datos. El mismo producto sirve a un cobrador independiente y a una financiera; solo cambian los permisos y los topes del plan.»*

### 3.3 Reordenar «Diferenciación» según lo realmente defendible (Diap. 6)

Orden sugerido de filas (de más defendible a menos):

1. **Evidencia con valor probatorio**: foto + GPS + huella SHA-256 verificada en servidor, inmutable y sin duplicados.
2. **Un producto, de 1 a 500 usuarios**: plan gratuito para el independiente; importación del «archivo oficial del día» para la financiera.
3. **Aislamiento por empresa en la base de datos** (§3.2).
4. **Mora como episodios**: historial, promesas y métricas de recuperación; es la base de datos que habilita el análisis.
5. **Rutas sobre OSRM propio**, sin pagar por consulta a Google.
6. Offline y reportes → como *requisito de campo*, no como diferencial (la competencia los tiene).

### 3.4 Precios: información que fortalece la diapositiva 7

Todo viene de `docs/business/PRICING-Y-DEPLOY.md`. Las cifras marcadas `[S]` son **supuestos** de la fundadora, no estudios.

| Información | Dato | Estado |
|---|---|---|
| **Una escalera de 4 planes + «Licencia»** | FREE → PROFESSIONAL → BUSINESS → ENTERPRISE (SaaS) y, aparte, **Kobrax Licencia** (instalación en servidores del cliente: banco/ASFI). «Son dos negocios, no cinco escalones» | Decisión tomada; la licencia **no se puede vender aún** (no existe instalador) |
| **Cada plan trae la app completa** | No hay funciones apagadas por plan; cambian solo los números → más simple de vender y de probar | ✅ decidido (Pregunta 4) |
| **El plan FREE es canal de entrada** | Independiente que luego recomienda Kobrax en la agencia donde trabaja | Hipótesis comercial |
| **Prueba → FREE, no bloqueo** | 30 días con límites de PROFESSIONAL; al vencer cae a FREE, nadie pierde datos | ✅ implementado |
| **Ningún plan es «ilimitado»** | ENTERPRISE es piso a medida: lo que no se cuenta no se ve; un inquilino sin techo es riesgo de todos (multi-tenant) | ✅ decidido |
| **Subir de plan nunca sale más barato** | Corrige una inversión de la grilla vieja; hay una prueba automática | ✅ en código |
| **Precio en bolivianos** | Con dólar oficial a Bs 11,71: PROFESSIONAL ≈ **Bs 141**/miembro; BUSINESS ≈ Bs 1.159 + 117/miembro. Decisión abierta: sostener Bs 141 o bajar a ~Bs 120 | Verificado 2026-08-13; **reconfirmar el tipo de cambio del día** |
| **Costo de operar** | ~$25–45/mes en piloto (20 cobradores), ~$120–170 con 150, ~$380–700 con 800; **≤ 11 % de lo facturado** en todas las etapas | Estimación con precios de proveedores de agosto 2026 |
| **Equilibrio** | ~4 / 17 / 58 cobradores según etapa | Estimación |
| **Relación valor/precio** | $12 ≈ **2–4 %** del costo de un cobrador (Bs 3.500–5.500/mes con cargas); agencias externas cobran 15–30 % de lo recuperado | `[S]` |
| **Competencia por unidad** | AtllasPay USD 28/**ruta**/mes; CarteraGo desde USD 6/**ruta**/mes; Kobrax USD 12/**miembro**/mes | Unidades distintas; verificar vigencia |
| **Referencia de sistema institucional** | «Bs 400.000 o más» es hipótesis; las partidas del BDP son anticipos a otro proveedor y **no se suman** | Solo como hipótesis |

**Qué agregaría a la diapositiva 7 sin recargarla:** una línea «Todos los planes incluyen la aplicación completa; cambian los
límites», otra «La prueba vence en FREE: no se pierde información» y, en ENTERPRISE, «desde $800 + $8/miembro, a medida». Y
mover a una nota de orador (no a la lámina) la relación 2–4 % porque es supuesto.

**Riesgo a no cometer:** presentar «suscripción» como si hubiera cobro automático. Hoy es **factura y cambio de plan a mano**,
suficiente hasta ~15 clientes (PRICING §3).

### 3.5 La capa de datos (F4/13): evidencia de que «de la visita al dato» ya empezó (Diap. 4 y 5)

Es el hecho más fuerte para sostener la tesis de la postulación y hoy **no está en las diapositivas**. Qué captura (todo opcional, todo por `account_id`, con **origen** manual/dictado/importado):

| Dato | Para qué sirve después | Estado |
|---|---|---|
| **Motivo de no pago** + fecha de ingreso esperada + **quién responde** | Analizar por qué fallan las promesas; sugerir fecha de seguimiento | ✅ web y móvil (rama) |
| **Perfil de ingreso del cliente** (fuente, rubro, ciclo, día) | Proponer fecha de promesa según cuándo le llega el dinero | ✅ web y móvil (rama) |
| **Perfil de cobro por ubicación** (modalidad, franja, días, quién recibe) | Ordenar rutas por cómo conviene cobrarle | ✅ captura; la agenda aún no lo usa |
| **Plantilla de mensaje elegida** | Medir qué mensaje se usa; «elegida», no «enviada» (`wa.me` no confirma envío) | ✅ móvil |
| **Catálogos por cuenta** (rubros, ocupaciones, motivos, modalidades) | Vocabulario propio de cada entidad; siembra automática al registrarse | ✅ |

**Principios que conviene citar:** todo dato nuevo es **opcional** (no frena al cobrador en campo); `credit_activities` es
**append-only**; **sin modelo propio de ML por ahora** (K1); **sin aprendizaje entre cuentas** (K5).
**Qué NO decir:** que el sistema ya «usa» estos datos para recomendar. Esos datos alimentan la capa B (reglas) y C (IA) que
**aún no existe** (E6: la importación tampoco trae rubro ni ciclo).

**Mejora de la diapositiva 5 (Etapa 2 «Análisis de patrones»):** agregar una línea de «ya capturamos» antes del
«analizaremos»: *«Ya estructuramos: motivo de no pago, perfil de ingreso, perfil de cobro y plantilla usada.»*

### 3.6 Línea base de medición (Diap. 8 y 9)

La diapositiva promete indicadores; se puede decir **de dónde saldrán** porque ya se registran:

| Indicador de la diap. 8–9 | Fuente en la app |
|---|---|
| Visitas realizadas vs. planificadas | Rutas y paradas con resultado + resumen de jornada (`GET /agenda/summary`) |
| Promesas cumplidas | Promesas con fecha/importe y su seguimiento; promesas que vencen hoy |
| Contactos efectivos | Definición única en servidor |
| Kilómetros / desplazamientos | Distancia de ruta (OSRM) + visitas con GPS |
| Visitas repetidas | Historial de gestiones por ubicación/crédito |
| Tiempo de registro | ❓ **no se mide hoy**: habría que instrumentarlo antes del piloto |
| Uso de papel | ❓ no se mide: por encuesta en el piloto |

### 3.7 Estado y prueba de madurez (Diap. 4 u 8: una franja «Hoy»)

Datos verificados para una franja de credibilidad:

- **20 módulos** de backend, **48 modelos** y **47 migraciones**; ~**25 pantallas** web (es/en); app de **5 pestañas**.
- **Más de 3.500 pruebas automáticas** (API, web y móvil) más **51–99 de integración** contra Postgres real; todas en verde (corridas del 10 oct).
- **Desplegado** en `kobrax.ikigaisystems.lat`, con despliegue automático en cada merge y **respaldo previo** a cada migración.
- **Demo sembrada:** 2 empresas (para probar aislamiento), 25 clientes, 17 créditos creados en la app + 6 importados, ~17 jornadas de ruta, con fotos y huella.
- Importa **Excel/CSV/PDF** (reporte de mora de banco) con vista previa y asignación. Matiz: el modo «reemplazar» hoy se comporta como «reconciliar» y los modos no tienen selector en la web (`docs/producto/README.md`); no venderlos como tres modos.

**A no usar como «tracción»:** «37 cobradores / 301.640 créditos» (son datos de prueba de origen sin aclarar) ni «clientes activos».

### 3.8 Seguridad, en una línea (Diap. 6 o 9)

Se puede afirmar: **cifrado AES-256-GCM** de datos personales, **MFA obligatorio** para administradores, tokens con rotación y
detección de reuso, **auditoría** de cada mutación, **RLS** por empresa, **hash SHA-256** de la evidencia.
Con «implementado, en validación en teléfono»: cifrado en reposo del dispositivo, SSL pinning, push.
**No afirmar:** cumplimiento o certificación ASFI (no hay; es supuesto a consultar con abogado).

### 3.9 El pedido al Challenge (Diap. 8): hacerlo más concreto

Hoy: «empresas aliadas, usuarios, mentoría, conexiones». Con lo que la app **ya habilita**, el pedido se puede volver medible:

- **Piloto acotado:** 1–3 entidades, ~20 cobradores (es la «etapa A» del modelo de costos, ~$25–45/mes de infraestructura).
- **Qué se mide** (§3.6) y **la línea base antes de atribuir mejoras**.
- **Qué necesita el piloto para empezar** (los pendientes reales de §1, diap. 8): R2, respaldos fuera del servidor, Google Play, validación en teléfono.
- **Dato que falta y que solo el equipo tiene:** monto o tipo de apoyo (mentoría vs. financiamiento) — `05-pendientes` §A.5.

---

## 4. Texto propuesto para las láminas que cambian

### Diap. 4 — recuadro «Qué ya ofrece el producto»
> Gestión web y móvil; cartera, importación y rutas; registro de gestiones, pagos y promesas; **motivo de no pago y quién
> responde (en validación con cobradores)**; evidencia con foto, GPS y huella SHA-256; historial por crédito; trabajo
> móvil sin conexión con sincronización. **Desplegado con datos de prueba.**

### Diap. 5 — Etapa 1
> **Etapa 1 · Base operativa y asistencia.** Consolidar el MVP, validar en campo y mejorar la calidad de los registros.
> Ya incluye alertas de promesas y gestiones vencidas y prioridad automática de mora. Siguiente: **resumen del crédito** y
> estructuración de notas de gestión.

*(Cambiar «casos» por «crédito» en toda la lámina.)*

### Diap. 7 — nota al pie
> Todos los planes incluyen la aplicación completa; cambian los límites. Los planes pagos inician con 30 días de prueba y,
> al vencer, la cuenta pasa a FREE sin perder información. ENTERPRISE parte de $800 + $8 por miembro, a medida.
> Precios en USD; en bolivianos al tipo de cambio oficial vigente.

*(Y sobre la conservación de fotos, elegir:)*
> «Conservación de fotos según el plan» **o** retirar «6 / 24 / 60 meses» hasta que la retención se aplique.

### Diap. 8 — bandas
> **Construido:** núcleo de datos y seguridad · app offline del cobrador · panel web · planes y límites · despliegue
> automático · central de mora · capa de datos para análisis.
> **Ahora:** validar en teléfono, almacenamiento de evidencias en la nube, respaldos fuera del servidor, publicación en Google Play.
> **Próximo:** pilotos → patrones → recomendaciones.

---

### Diap. 4/5 · Innovación — versión final «Del dato a la decisión» (2026-10-13)

Mantiene el fondo azul oscuro y las tarjetas blancas. Cambios: títulos de **resultado** (Entender · Descubrir · Recomendar),
una **etiqueta de estado** por tarjeta según lo construido, **máximo tres ideas** por tarjeta y una frase que conecta las etapas.

| | **Tarjeta 1** | **Tarjeta 2** | **Tarjeta 3** |
|---|---|---|---|
| Sobretítulo | ETAPA 1 · DATOS | ETAPA 2 · PATRONES | ETAPA 3 · RECOMENDACIÓN |
| Título | **Entender** | **Descubrir** | **Recomendar** |
| Etiqueta | Disponible · en validación | Siguiente paso | Visión futura |
| Idea 1 | Registramos por qué no pagó, de qué vive y cómo cobrarle. | Hoy: mejor horario por deudor y rendimiento por cobrador. | Sugiere cuándo contactar, por qué canal y con qué mensaje. |
| Idea 2 | Alertas de promesas, cuotas y vencidas; prioridad de mora automática. | Con datos de pilotos: qué gestión, horario y zona cumple más. | El cobrador o supervisor aprueba, ajusta o descarta. |
| Idea 3 | Siguiente: resumen del crédito y dictado por voz. | Después: alerta temprana de créditos de alto riesgo. | Si la IA falta, se usa la regla: nunca es requisito. |

**Frase inferior:** «Primero estructuramos los datos. Después descubrimos patrones. Finalmente, recomendamos mejores decisiones.»
**Línea pequeña debajo:** «Siempre decide una persona.»

**Límites de texto:** título ≤ 12 caracteres · etiqueta ≤ 28 · cada idea ≤ 70 · frase inferior ≤ 110.

**Verificación de cada afirmación contra el repo**

| Texto de la lámina | Estado | Evidencia |
|---|---|---|
| «Por qué no pagó, de qué vive y cómo cobrarle» | 🟡 Hecho, **en validación** | F4/13 E2–E4 (PR #13, sin desplegar ni validar en teléfono) |
| «Alertas de promesas, cuotas y vencidas» | ✅ Disponible | `promise-due.service.ts`, `installment-reminders.service.ts`, `agenda-overdue.service.ts` |
| «Prioridad de mora automática» | ✅ Disponible | `arrears-priority-score.ts` (saldo + días de mora + riesgo), regla determinista |
| «Resumen del crédito y dictado por voz» (siguiente) | ❌ No existe | Plan de IA, capa C; solo existe el campo «origen: dictado» |
| «Mejor horario por deudor» | ✅ Disponible, **por regla** | `recommended-slot.ts`: franja con más contactos efectivos, mínimo 2 |
| «Rendimiento por cobrador» | ✅ Disponible | `GET /analytics/collector-performance` y resumen por cobrador en rutas |
| «Qué gestión, horario y zona cumple más» | ❌ No existe | Analytics descriptivos; falta el catálogo `ZONE`; **con datos de pilotos** porque no hay aprendizaje entre cuentas (K5) |
| «Alerta temprana de alto riesgo» | ❌ No existe | Plan V1.5; rotulado «Después» |
| «Sugiere cuándo, por qué canal y qué mensaje» | ❌ No existe | Solo se **registra** la plantilla elegida (F4/13 E5); no se sugiere |
| «La IA nunca es requisito» | ✅ Principio | `ia-plan-maestro` (K1): toda función tiene su regla de respaldo |

**Qué NO escribir en esta lámina:** «casos» (es «créditos»), «aprende», «predice» ni «optimiza con IA» en una tarjeta que no
sea la 3; ni «disponible» para el resumen o el dictado hasta que existan y estén desplegados.

**Qué se puede construir para subir la tarjeta 2 antes del 15 de octubre** (de menor a mayor esfuerzo):
1. Fecha de promesa sugerida con el ciclo de ingreso del cliente (el dato ya existe, E3).
2. Resumen del crédito armado con reglas a partir del historial.
3. Tablero de efectividad: promesas cumplidas por tipo de gestión, horario y motivo (los datos ya están en gestiones y promesas).
4. Rendimiento por zona (requiere decidir la normalización de zonas).
5. Dictado a gestión con el reconocimiento de voz del teléfono.

Solo se pasa algo a «Disponible» cuando existe en `dev` y está desplegado.

---

## 5. Lo que solo el equipo puede confirmar (antes del 15 de octubre)

1. **Biografías** de Sara y Josué (una sola versión, igual en la diapositiva, el formulario y `PRICING-Y-DEPLOY.md`).
2. **Mora 2019** en ASFI y la fuente oficial de Bs 6.825 M / Bs 229.576 M.
3. **Estado de Google Play** (cuenta de empresa/D-U-N-S) e identificador definitivo de la app.
4. **Qué versión corre en producción**: lo desplegado puede ir por detrás de `dev`; la capa F4/13 **no está** en `main` ni desplegada.
5. **Si pueden mostrar «motivo de no pago» en la demo**: requiere desplegar F4/13 (sin PR hoy; el merge requiere su autorización escrita).
6. **Conexión con la India** y **pedido concreto**: siguen siendo `[COMPLETAR]` (`05-pendientes` §A.4–5).
7. **Carta de intención o testimonio** de un usuario real: sigue siendo lo que más suma y lo único que falta de «validación».

## 6. Fuentes consultadas

- Repo: `docs/postulacion-india-bolivia/02-dossier-tecnico.md`, `05-pendientes-y-riesgos.md`, `03-pitch-deck-guion.md`, `resumen.md`;
  `docs/business/PRICING-Y-DEPLOY.md`, `LIMITES-POR-PLAN.md`, `LIMITES-BUILD-PLAN.md`; `docs/producto/roles-permisos-planes.md`,
  `demo-datos-y-despliegue.md`; `docs/epics/F4/13-capa-datos-ia-plan.md`; `docs/HANDOFF.md`; `infra/production/*`;
  `packages/shared/src/constants/plans.ts`; `apps/api/src/common/plan/*`; `apps/mobile/app.json`; `git log`.
- ASFI, [Rendición Pública de Cuentas Final 2025](https://asfi.gob.bo/sites/default/files/2026-03/Presentaci%C3%B3n%20Audiencia%20de%20Rendici%C3%B3n%20P%C3%BAblica%20de%20Cuentas%20Final%20Gesti%C3%B3n%202025.pdf) (mora 2,97 % a dic. 2025).
- ASFI, [Rendición Pública de Cuentas Final 2024](https://www.asfi.gob.bo/sites/default/files/2025-07/Presentaci%C3%B3n%20Audiencia%20de%20Rendici%C3%B3n%20P%C3%BAblica%20de%20Cuentas%20Final%20Gesti%C3%B3n%202024.pdf) (mora Bs 7.076 M; 3,2 %).
- [eju.tv: mora 2,97 % al cierre de 2025](https://eju.tv/?p=4938130) (origen periodístico de Bs 6.825 M y Bs 229.576 M; confirmar en ASFI).

---

## 7. Ajuste por categoría: «Innovadoras – Etapa de Idea» · FinTech

> **Fuente:** la invitación de la Embajada de la India (cierre 15 de octubre). Ofrece dos categorías —*Innovadoras (Etapa de
> Idea)* y *Emprendedoras (Etapa de Negocio)*— y cinco áreas temáticas, entre ellas FinTech. **No tengo las bases ni los
> criterios de evaluación del formulario**; lo de abajo parte solo de lo que dice la invitación y de lo que el repo prueba.
> Lo que dependa de las bases está marcado ❓.

### 7.1 Qué cambia para las diapositivas

Kobrax tiene un producto desplegado, y la categoría es **Idea**. No es una contradicción, pero hay que **decirlo de forma
explícita** para que el jurado no lea «ya es un negocio» ni «es solo una idea»:

> **«Una idea con prototipo funcional»**: producto técnicamente construido y desplegado con datos de prueba; todavía sin
> validación comercial ni clientes pagantes. Lo que se postula es la **idea de inteligencia sobre cobranza** y la
> validación con usuarios reales.

Consecuencias concretas:

| Diapositiva | Ajuste para Etapa de Idea |
|---|---|
| **1 · Portada** | Agregar «Categoría: Innovadoras · Etapa de Idea · FinTech» (en la actual dice «FinTech · tecnología desarrollada en Bolivia»). |
| **2–3 · Problema y mercado** | Es donde más pesa una idea: mantener. Resolver antes el dato de mora 2019 (§1, diap. 3). |
| **4 · Solución** | Presentar el producto como **prueba de factibilidad** («la idea ya es técnicamente viable»), no como evidencia de tracción. |
| **5 · Innovación** | Es **el centro** de la postulación. Subirla en importancia; sumar «ya estructuramos» de §3.5. |
| **6 · Competencia** | Mantener el tono actual; para una idea, reconocer competidores suma credibilidad. |
| **7 · Modelo de negocio** | **Reducir.** Una tabla de 4 planes con topes lee a «Etapa de Negocio». Dejar FREE / PROFESSIONAL / BUSINESS / a medida en una línea de *hipótesis de modelo*; el detalle va a notas del orador. |
| **8 · Hoja de ruta** | Es lo que una Idea debe mostrar: *qué falta validar y con quién*. Conservar las bandas de §3.1 y el pedido de §3.9. |
| **9 · Impacto** | Mantener. El «no afirmamos cifras» es coherente con una idea. |
| **10 · Fundadores** | Los **equipos** pesan mucho en idea: ver §7.3. |

### 7.2 Lo que NO hay que hacer en esta categoría

- No presentar el despliegue o las 3.500 pruebas como **tracción comercial**: son *madurez técnica*. Ponerlas bajo «viabilidad».
- No afirmar clientes, pilotos ni ingresos (no existen) ni usar los volúmenes de la base de prueba.
- No dejar que la diapositiva 7 parezca un plan de ventas cerrado: los precios son una **hipótesis a validar** (varias cifras del
  documento de precios son `[SUPUESTO]`).
- No omitir el prototipo: ocultarlo sería desperdiciar la ventaja que otras ideas no tienen. Solo hay que **nombrarlo bien**.

### 7.3 Equipo ❓ (revisar antes de enviar)

- La invitación se dirige a *«innovadoras y emprendedoras»* y la categoría se llama **«Innovadoras»**. **Revisar en las bases
  si exige que el equipo sea de mujeres o esté liderado por ellas** y cómo cuenta la participación de Josué como cofundador.
  Si la regla existe, la diapositiva 10 y el formulario deben reflejar con precisión el rol de cada integrante; si no existe,
  no hay nada que cambiar.
- `05-pendientes` §A.1 ya anota: edad ≥ 18, ciudadanía y residencia bolivianas, **máximo 5 integrantes**. Confirmar que ambos
  integrantes cumplen.
- Unificar las biografías (§1, diap. 10).

### 7.4 Encaje con el área temática FinTech

La diapositiva 1 usa «FinTech». Para el jurado de esta convocatoria, la lectura más fuerte que sale del repo es
**inclusión financiera y acceso**, no «software de cobranzas»:

- Un **plan gratuito** para el cobrador independiente y para equipos pequeños, sobre el mismo producto que usa una financiera.
- **Operación sin internet** para zonas de conectividad limitada.
- Datos estructurados que mejoran la **continuidad del crédito** y la trazabilidad (evidencia verificable de cada gestión).
- Brecha de costo frente a sistemas institucionales (hipótesis `[SUPUESTO]`, citar como tal).

Frase sugerida: *«FinTech para quienes cobran y prestan fuera de los grandes bancos: la misma plataforma, desde un cobrador
independiente hasta una financiera, funcionando también sin conexión.»*

### 7.5 Orden sugerido de la presentación para Etapa de Idea

1. Portada (con categoría) → 2. Problema → 3. Mercado → 4. Idea y solución (prototipo como prueba de factibilidad) →
5. Innovación (el núcleo) → 6. Diferenciación y competencia → 7. **Qué validaremos y cómo** (hoja de ruta + pedido) →
8. Impacto → 9. Modelo (hipótesis, una lámina corta) → 10. Equipo y cierre.

*(Es el mismo contenido de las 10 diapositivas, con la hoja de ruta antes del modelo de negocio.)*

### 7.6 Pendientes específicos de la categoría

1. **Leer las bases y los criterios** del formulario (`https://forms.gle/BhikiFHeRhvt9xst7`): límites de caracteres, si se pide
   video o PDF, y si el prototipo se declara o se adjunta.
2. **Confirmar que una idea con producto desplegado encaja en «Etapa de Idea»** y no en «Etapa de Negocio». El repo respalda
   «sin clientes ni ingresos», que es lo que normalmente separa ambas; las bases lo definen.
3. Ajustar `01-respuestas-formulario.md` y `03-pitch-deck-guion.md` (el guion de 11 láminas) a esta categoría: ambos hablan hoy
   de «MVP funcional completo y desplegado» sin mencionar la etapa.

---

# PARTE II — Material adicional para reforzar la presentación

> Agregado el 2026-10-12. Sale de `docs/producto/*` (verificado contra el código el 2026-10-09/10) y de los planes de IA.
> Cada bloque dice a qué diapositiva suma y qué estado tiene.

## 8. Brechas frente a la competencia que la presentación no debe ocultar

`docs/producto/ventaja-competitiva.md` (2026-10-10) contrasta Kobrax con la lista de competidores. Conclusión del propio
documento: **Kobrax gana en prueba y control de la mora, y pierde en lo que se hace todos los días con el dinero.**
Esto importa para la diap. 6 y para las preguntas del jurado: es mejor nombrar las brechas que dejar que las descubran.
(Aviso del propio documento: las funciones atribuidas a los competidores salen de una investigación previa, no de auditar
sus productos.)

| Capacidad | Estado en Kobrax | Frente a la competencia |
|---|---|---|
| Panel web + app del cobrador, offline con sincronización | ✅ | Paridad |
| Importar y **conciliar el archivo diario** de una entidad | ✅ | Ventaja: no solo migra desde Excel |
| Prueba de la visita (foto + GPS + SHA-256, inmutable) | ✅ | Ventaja: ninguno de los citados la anuncia |
| Mora como episodios con historial, promesas y métricas | ✅ | Ventaja frente a las apps de prestamista |
| Plan gratuito | ✅ | Ventaja de entrada |
| Seguimiento GPS **continuo** del cobrador | 🟡 hay ubicación por visita; el envío continuo desde el móvil no está | **Hueco** frente a AtllasPay y Geo Cash |
| **Caja**: arqueo, entrega de efectivo, gastos en campo | ❌ | **Hueco serio** frente a AtllasPay, CarteraGo y CobrApp |
| **Recibo que el cliente se lleva** (imagen/PDF por WhatsApp, impresora) | 🟡 recibo numerado y foto de comprobante; no hay recibo para enviar | **Hueco** frente a CobrApp y CarteraGo |
| Segmentación por calificación y previsión regulatoria | 🟡 categorías de mora configurables | Hueco frente a Fortaleza y CIRRUS (otro segmento) |
| Integración con el core financiero | ❌ solo por archivo | Hueco frente a CIRRUS (otro segmento) |
| Pasarela de cobro real | ❌ el enlace de cobro apunta a un dominio de demostración; sin reversión de pagos | — |

**Cómo usarlo:**
- En la diap. 6 **no** escribir «somos más completos»; la tabla de «Enfoque de Kobrax» ya está bien redactada.
- Si preguntan por caja o recibos: *«Es el siguiente bloque de producto que priorizamos con agencias reales; hoy cubrimos el
  control y la prueba de la gestión de mora.»* (ver §10, P7).
- En la diap. 4, «pagos» es **registro de pagos** (ledger idempotente, solicitudes y confirmación), no cobro en línea.

### 8.1 Tres ventajas que todavía **no** existen y podrían ser el diferencial

Propuestas de `ventaja-competitiva.md` §4, **no implementadas**. Sirven para la diap. 8 como «qué validaremos con una
agencia», nunca como función actual:

| Idea | Qué haría | Por qué diferencia |
|---|---|---|
| **A2 · Informe a la entidad mandante** | Un PDF por cartera con gestiones, promesas y evidencia verificada | Es lo que una agencia **vende** al banco para conservar su contrato |
| **A3 · Verificación de evidencia por enlace** | Un tercero comprueba que la foto y la visita no fueron alteradas, sin entrar al sistema | Convierte el hash SHA-256 en algo que otro puede comprobar; ningún competidor citado lo anuncia |
| **A1 · Rendición de caja** | El cobrador declara lo entregado; el supervisor confirma | Cierra el hueco más serio frente a CarteraGo y AtllasPay |

La propuesta recomienda **paridad primero (recibo, cobro rápido, caja), ventaja después (informe y verificación)**, y validar
con al menos una agencia real antes de construir.

### 8.2 «Perfiles de operación» (idea para la diap. 6 u 8)

Hoy el tipo de cuenta no cambia nada (siempre `INDEPENDENT`). La propuesta es un selector al registrarse que **enciende solo
lo necesario**: *Trabajo solo* · *Tengo equipo* · *Cobro para una entidad*. Responde a «diferencias entre un cobrador
independiente y una operación empresarial» (diap. 6) y evita que el producto parezca complicado. **Estado: propuesta.**

## 9. La inteligencia, con más detalle y con su estado (diap. 5)

Fuente: `docs/producto/ia-plan-maestro.md` (2026-10-10). **Hoy Kobrax no tiene ningún componente de IA** (sin SDK de
modelos, sin embeddings, sin ML); todo lo «inteligente» actual son reglas deterministas.

### 9.1 Tres capas; cada una funciona sola

| Capa | Qué es | Sirve a | Necesita volumen | Estado |
|---|---|---|---|---|
| **A · Datos** | Guardar rubro, ciclo de ingreso, motivo de no pago, perfil de cobro, plantilla elegida | Todos | No | ✅ **hecha** (F4/13; en rama, sin merge) |
| **B · Reglas** | Usar esos datos de forma determinista: fecha de promesa sugerida, ruta por zona, prioridad con el porqué | Todos, incluso con pocos créditos | No | 🟡 parcial (prioridad de mora y hora recomendada existen; el resto es nuevo) |
| **C · IA** | Asistir (texto y voz) y aprender qué funciona | Asistencia: todos · aprendizaje: cuentas con volumen | Solo el aprendizaje | ❌ diseño |

**Regla de oro (frase para la diap. 5):** *la IA nunca es requisito.* Si falta, se cae a la regla; si falta el dato, la
regla se omite. Una cuenta de 20 créditos y una de 20.000 usan el mismo producto con distinto nivel de asistencia.

### 9.2 Versiones planteadas (todas ❌ no construidas)

| Versión | Qué incluye | Condición |
|---|---|---|
| **V1** | Descripción libre → campos del cliente · dictado → gestión, motivo y promesa · resumen del crédito antes de contactar · mapeo de columnas de importación · mensajes · informe a la entidad · normalizar direcciones · «por qué esta prioridad» | Humano en el circuito; apagable por cuenta; sin datos identificantes hacia el modelo |
| **V1.5** | Preguntar al negocio en lenguaje natural · probabilidad de promesa cumplida · alerta temprana · mejor franja y canal | Volumen suficiente por segmento |
| **V2** | Anomalías aprendidas · efecto de cada acción con experimentos · rutas por valor esperado · plan diario del supervisor · pronóstico de recuperación | Datos reales de pilotos |
| **Fuera del plan** | **Contacto automático al deudor** | Riesgo ético y legal alto |

> Los pasos 1–5 de construcción (datos y reglas) **no necesitan IA ni proveedor** y «corren contra el reloj» porque capturan lo
> que tarda meses en acumularse. Por eso F4/13 se hizo primero. Argumento para la diap. 5:
> *«Empezamos por el dato porque es lo único que no se puede acelerar.»*

### 9.3 Cómo se decide entre regla y modelo (diap. 5, «criterios verificables»)

```
¿Hay datos suficientes en ESTE segmento para que el modelo supere a la regla?
   sí → modo aprendido (con su porqué y su margen de duda)
   no → regla de respaldo («sin datos suficientes»)
```

Cada decisión tiene una regla de respaldo y se compara con el modelo sobre datos reservados. **El umbral lo fija el piloto, no
una cifra supuesta.** Es la respuesta concreta a «supervisión humana, criterios verificables y evaluación de resultados».

### 9.4 Privacidad hacia modelos externos (punto fuerte para FinTech)

| Clase de dato | Ejemplos | ¿Llega a un modelo externo? |
|---|---|---|
| P0 · Catálogo | Rubros, motivos, zonas, plantillas | Sí |
| P1 · Operativo no identificante | Ciclo, modalidad, resultado, días de mora | Sí |
| P2 · Financiero contextual | Montos, fechas | Solo transformado (rangos, fechas relativas) |
| **P3 · Identificante** | Nombre, documento, teléfono, dirección, foto | **No** |
| P4 · Texto libre | Notas, dictado | Solo tras redacción y con opción de la cuenta (apagada por defecto) |

Decisiones **aprobadas** por la fundadora (2026-10-10): **K1** sin modelo propio de ML (memoria y contexto); **K2** empezar por
la memoria de formatos de importación; **K3** las reglas aprendidas requieren aprobación del administrador; **K4** pantalla
«Lo que Kobrax aprendió de tu operación»; **K5** sin aprendizaje entre cuentas.

**Qué NO decir:** «los datos son 100 % privados». Sí: *«los datos personales identificantes no se envían a modelos externos»*
(es el diseño; aún no está construido).

### 9.5 «IA invisible»: mejorar lo que el usuario ya hace

La IA que más se usa no añade una pantalla. Cada función **nace como regla** y se vuelve aprendida cuando hay datos:

| Ya existe | Con IA o aprendizaje | Lo que ve la persona |
|---|---|---|
| Prioridad de mora (por reglas) | Aprende qué créditos pagan tras qué gestión | La misma lista, mejor ordenada |
| Ruta del día (OSRM por distancia) | Pondera valor esperado y ventana de éxito | La misma ruta, más útil |
| Notas de la gestión | Dictado con sugerencia de resultado y promesa | Menos toques |
| Importación | Propone el mapeo de columnas nuevas | La misma pantalla, ya completada |

### 9.6 Funciones estrella para mostrar (`ventaja-competitiva.md` §10.5)

1. **Informe a la entidad redactado a partir de hechos verificados** (para agencias).
2. **Dictado que registra la gestión** (para el cobrador; usa el reconocimiento de voz del teléfono, sin costo por uso).
3. Auditoría automática de la operación (reglas primero: cobrador sin actividad, visita lejos del domicilio, foto repetida).

Todas son **propuestas**: ninguna está en producción.

## 10. Preguntas probables del jurado y respuestas honestas

Redactadas solo con hechos verificados; las marcadas ❓ requieren que el equipo complete el dato.

| # | Pregunta | Respuesta propuesta |
|---|---|---|
| P1 | ¿Qué es lo que **ya funciona**? | Plataforma web y móvil desplegada con datos de prueba: cartera, importación, mora con promesas, agenda, rutas con mapa, registro de visita con foto, GPS y huella, pagos y trabajo sin conexión. Más de 3.500 pruebas automáticas pasan. |
| P2 | ¿Tienen clientes o ingresos? | No todavía. Es una idea con prototipo funcional; el siguiente paso es un piloto con una o pocas entidades para medir. |
| P3 | ¿Usan IA hoy? | No. Hoy hay datos estructurados y reglas deterministas (prioridad de mora, hora recomendada). La IA es hoja de ruta y empieza por asistencia (resumen, dictado) antes que por predicción. |
| P4 | ¿Por qué no hay IA aún si es su diferencial? | Un modelo útil necesita datos de contexto que casi nadie guarda: motivo de no pago, ciclo de ingreso, cómo conviene cobrar. Primero construimos esa capa de datos; es lo que no se puede acelerar. |
| P5 | ¿Qué los hace distintos de BDP Recupera, Fortaleza, CIRRUS, AtllasPay o CarteraGo? | Existen y son referentes; algunos ya hacen segmentación, rutas y offline. Lo defendible es la **combinación**: evidencia verificable de cada gestión, un mismo producto del cobrador independiente a la financiera, aislamiento por empresa en la base de datos y un camino planificado hacia el aprendizaje sobre resultados reales. No afirmamos ser los únicos. |
| P6 | ¿Cómo garantizan que los datos de una entidad no se mezclan con otra? | Cada entidad es una cuenta aislada, con políticas a nivel de base de datos (RLS forzada en 39 tablas) y pruebas de integración contra Postgres real; además, el diseño de IA descarta aprender entre cuentas. |
| P7 | AtllasPay y CarteraGo tienen caja y recibos. ¿Y ustedes? | Aún no. Es el bloque que priorizamos con agencias reales; hoy cubrimos control y prueba de la gestión de mora (§8). |
| P8 | ¿Cumplen con ASFI? | No tenemos certificación ni la afirmamos. Es un tema para asesoría legal antes de operar con entidades reguladas. |
| P9 | ¿El cobrador solo ve su cartera? | En Mora, Agenda, Rutas y visitas, sí; en los listados de Cartera y Pagos todavía ve los de toda la cuenta. Está identificado como mejora de seguridad antes del piloto. |
| P10 | ¿Funciona sin internet? | Sí: la app guarda localmente, encola y sincroniza al reconectar, con control de conflictos. Está probada con pruebas automáticas; falta validarla en más teléfonos y con pruebas e2e. |
| P11 | ¿Cuánto cuesta y cómo ganan? | Suscripción por miembro: gratis, $12, $99 + $10 y a medida. La infraestructura estimada es ≤ 11 % de lo facturado. Son hipótesis a validar en el piloto; aún sin clientes pagantes. |
| P12 | ¿Qué impacto ambiental o social esperan? | Menos papel y desplazamientos repetidos es una **hipótesis**; la mediremos con línea base en el piloto antes de afirmar cifras. |
| P13 | ¿Qué necesitan del Challenge? | Una entidad aliada para un piloto acotado, acceso a usuarios reales, mentoría de modelo comercial y conexiones con entidades financieras. ❓ *monto o tipo de apoyo* |
| P14 | ¿Qué relación tienen con la India? | ❓ El repo no la documenta; preséntenla como exploración o con el contacto real que tengan. |
| P15 | ¿Qué riesgos ven? | Que el cobrador no capture los datos (por eso todo es opcional y rápido), sobre-prometer IA (por eso va como hoja de ruta), sesgos y presión indebida al deudor (límites y supervisión humana) y depender de proveedores baratos (el despliegue es portable). |
| P16 | ¿Por qué ustedes? | ❓ Completar con la trayectoria confirmada de Sara y Josué (§1, diap. 10): experiencia directa en cobranza y capacidad de construir; el producto es la prueba. |
| P17 | ¿Cuánto tiempo tomó construirlo? | El repositorio registra 473 commits entre mayo y octubre de 2026: núcleo y app del cobrador en julio–agosto, panel web en agosto, mora y datos para IA en octubre. |
| P18 | ¿El dato de mora es oficial? | Sí, de ASFI: 3,2 % y Bs 7.076 M en 2024; 2,97 % en 2025. ❓ confirmar 2019 antes de mostrarlo. |

## 11. Notas del orador por lámina (Etapa de Idea, ~35–45 s cada una)

**1. Portada.** «Somos [nombres]. Kobrax es una idea con prototipo funcional: una plataforma que conecta lo que pasa en la
calle con la información que necesita quien gestiona una cartera. Categoría Innovadoras, FinTech.»

**2. Problema.** «Cada día de cobranza genera información valiosa: dónde vive el deudor, qué prometió, por qué no pagó. Hoy
queda en libretas, hojas de cálculo y mensajes; si cambia el responsable, se pierde. No hablamos de fraude: hablamos de
continuidad.»

**3. Mercado.** «La mora del sistema financiero fue de Bs 7.076 millones en 2024 y de Bs 6.825 millones en 2025, 2,97 %. No es
que siempre suba: cambia, y gestionarla requiere información oportuna. Además del sistema financiero hay comercios y empresas
que venden a crédito; ese mercado se dimensiona por separado.»

**4. Solución.** «Kobrax registra la visita, la promesa, el pago, el motivo de no pago y la evidencia —foto, ubicación y huella
digital— y conserva el historial de cada crédito, también sin internet. Está construida y desplegada con datos de prueba: la
parte técnica de la idea es viable.»

**5. Innovación.** «Las herramientas actuales registran lo que pasó. Queremos ayudar a decidir qué hacer. Empezamos por el
dato: ya estructuramos el motivo de no pago, el perfil de ingreso y cómo conviene cobrarle. Después vienen asistencia, análisis
y recomendaciones, siempre con una persona decidiendo y solo cuando haya datos suficientes.»

**6. Competencia.** «Hay soluciones valiosas: BDP Recupera, Fortaleza, CIRRUS, AtllasPay, CarteraGo. No decimos que sean
iguales ni que no analicen. Nuestra apuesta es integrar la operación de campo con evidencia verificable, aislamiento por empresa
y un camino de aprendizaje sobre resultados reales, diseñado para Bolivia.»

**7. Qué validaremos / hoja de ruta.** «Ahora: validar en teléfono, almacenar evidencias en la nube, respaldos y publicar en
Google Play. Luego, pilotos con empresas bolivianas; después, patrones; después, recomendaciones. Los plazos son objetivos que
se ajustan con lo que aprendamos.»

**8. Impacto.** «Mejor visibilidad de la cartera, tecnología boliviana accesible, y menos papel y desplazamientos repetidos
como hipótesis a medir. No afirmamos cifras que no medimos.»

**9. Modelo.** «Suscripción por miembro, con plan gratuito para empezar. Son hipótesis que validaremos con el piloto; todavía no
tenemos clientes pagantes.»

**10. Equipo y cierre.** «Conocemos la cobranza desde adentro y sabemos construir tecnología. Kobrax no promete una IA
milagrosa: construye primero los datos de campo para que las decisiones sean mejores.»

## 12. Guion de demo ajustado (2–3 min) y qué mostrar

El guion base está en `03-pitch-deck-guion.md`. Ajustes para Etapa de Idea y para no exponer lo que no está desplegado:

| Tiempo | Mostrar | Estado seguro para mostrar |
|---|---|---|
| 0:00–0:15 | Planilla / Excel / WhatsApp | — |
| 0:15–0:40 | Importar archivo de mora y ver qué cambió (vista previa) | ✅ |
| 0:40–1:05 | Central de mora → ficha del crédito (historial, promesas, notas) | ✅ |
| 1:05–1:30 | Planificar ruta en el mapa | ✅ (si OSRM no está arriba, la ruta es línea recta: probar antes) |
| 1:30–2:00 | Móvil: parada → foto → GPS → resultado; modo avión → sincroniza | ✅ validar en teléfono real |
| 2:00–2:20 | Registrar gestión con **motivo de no pago** y quién responde | 🟡 **solo si F4/13 está desplegada**; si no, mostrarlo en local u omitirlo |
| 2:20–2:40 | Panel: visita con evidencia y mapa de visitas | ✅ |
| 2:40–3:00 | Cierre: «estos datos son la base; el siguiente paso es ayudar a decidir» | — |

**Antes de grabar:** `pnpm db:seed:refresh` (las fechas del seed son relativas al día), datos **sintéticos** (nunca
`docs/flows/mora union.PDF`) y probar en teléfono físico las funciones nuevas del móvil, que nunca se validaron en dispositivo.

## 13. Matriz final: afirmar · matizar · no afirmar

| Tema | ✅ Se puede afirmar | 🟡 Con matiz | ❌ No afirmar |
|---|---|---|---|
| Producto | Web + móvil desplegados con datos de prueba; offline y sincronización; evidencia foto+GPS+SHA-256 verificada en servidor | Cifrado en reposo, SSL pinning y push: «implementados, en validación en teléfono» | «En uso real», «clientes activos» |
| Datos | Mora como episodios; promesas; **motivo de no pago** y perfil de ingreso (en validación con cobradores) | Perfil de cobro: se captura, la agenda aún no lo usa | Que el sistema ya recomienda con esos datos |
| IA | Hoja de ruta por etapas; reglas deterministas actuales; supervisión humana | «Estamos construyendo la capa de inteligencia» | Que aprende, predice o recomienda; dictado, resúmenes o analítica de efectividad |
| Mercado | Mora ASFI 2024 y 2025 | Mora 2019 (confirmar); el mercado comercial se dimensiona aparte | Extrapolar cifras bancarias a Dismac o inmobiliarias |
| Competencia | Nombres y funcionalidades documentadas públicamente | Precios públicos «a verificar» | «Somos los únicos»; CobrApp y Geo Cash sin verificar |
| Seguridad | RLS, AES-256-GCM, MFA obligatorio para administradores, auditoría | Alcance por fila: aplica en Mora/Agenda/Rutas, no en Cartera/Pagos | Cumplimiento o certificación ASFI |
| Negocio | Planes y topes del catálogo; miembros, créditos y clientes se hacen cumplir; prueba 30 días → FREE | Fotos y gestiones solo avisan; precios = hipótesis | Retención de fotos aplicada; cobro automático; suscripción con pasarela |
| Impacto | Hipótesis y cómo medirlo | Reducción de papel y desplazamientos «potencial» | Cifras de CO₂, papel o % de recuperación |
| Despliegue | Autodespliegue con respaldo previo a cada migración | Respaldos en el mismo disco; fotos en disco local | «Alta disponibilidad»; «respaldos restaurados y probados» |

## 14. Tarjeta de datos verificados (para tener a mano)

| Dato | Valor | Fuente / fecha |
|---|---|---|
| Commits / periodo | 473 · 2026-05-18 → 2026-10-10 | `git log` |
| Módulos backend · modelos · enums · migraciones | 20 · 48 · 39 · 47 | dossier §2 (10-oct) |
| Pantallas web (panel) · pestañas móviles | ~25 · 5 + auth, import, cuenta, rutas, mora | dossier §2 |
| Idiomas del panel | es / en (con test de paridad) | dossier §2 |
| Roles · permisos | 7 (3 asignables por API) · 36 | `roles-permisos-planes.md` |
| Tablas con RLS forzada | 39 (lista del script) | dossier §2 |
| Pruebas (dev, 10-oct) | API 1.542 · web 938 · móvil 916 · integración 51 | dossier §8 |
| Pruebas (rama F4/13) | shared 423 · API 1.583 · web 971 · móvil 959 · integración 99 | F4/13 §10 |
| Despliegue | https://kobrax.ikigaisystems.lat (datos de prueba) | dossier §7 |
| Demo | 2 empresas · 25 clientes · 17 créditos en app + 6 importados · ~17 jornadas | `demo-datos-y-despliegue.md` |
| Mora ASFI | 3,2 % · Bs 7.076 M (2024); 2,97 % · Bs 6.825 M (2025) | ASFI / eju.tv |
| Cartera de créditos (dic. 2025) | Bs 229.576 M | eju.tv citando ASFI |
| Planes | FREE $0 · PRO $12/miembro · BUSINESS $99+$10 · ENTERPRISE $800+$8 (piso) | `plans.ts` |
| Tipo de cambio de referencia | Bs 11,71/USD (13-ago-2026; reconfirmar) | `PRICING-Y-DEPLOY.md` |
| Costo de infraestructura estimado | ≤ 11 % de lo facturado | `PRICING-Y-DEPLOY.md` (estimación) |
| Competidores (precio público) | AtllasPay USD 28/ruta/mes · CarteraGo desde USD 6/ruta/mes | `resumen.md` §3 (verificar vigencia) |

## 15. Lista de entrega (12 → 15 de octubre)

| Día | Qué | Responsable sugerido |
|---|---|---|
| **12 oct** | Unificar biografías; confirmar mora 2019 y fuente oficial; leer las bases del formulario (¿equipo de mujeres? ¿Etapa Idea con prototipo?) | Equipo |
| **12–13 oct** | Aplicar los textos de §4 y §7 a las diapositivas; mover la hoja de ruta antes del modelo (§7.5) | Sara |
| **13 oct** | Probar en teléfono real: login, ruta, visita con foto, modo avión; decidir si F4/13 se muestra (requiere merge autorizado por escrito) | Josué (QA móvil) y Sara |
| **13 oct** | Pedir una carta de intención o testimonio a un cobrador, cooperativa o agencia | Equipo |
| **14 oct** | Grabar la demo (datos sintéticos, `db:seed:refresh`); usar §13 como lista de control | Sara |
| **14 oct** | Alinear `01-respuestas-formulario.md` y `03-pitch-deck-guion.md` con la categoría Idea | Sara |
| **15 oct** | Revisión final y envío con margen antes del cierre | Equipo |
