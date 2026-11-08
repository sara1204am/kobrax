# F15 · Matriz de simplificación interna por módulo

> Anexo del plan `PLAN-MVP-configurable-workspace.md` (v2). **Las olas de la matriz (O1/O2) son candidatas; manda el §6 del plan.** Fuente: tres lecturas de código del 2026-11-06 más la validación G4 del mismo día (correcciones aplicadas abajo).

## M. Simplificación interna por módulo

Fuente: tres lecturas de código (Cartera; Mora/Agenda/Pagos; Rutas/Cuenta/Dashboard/Import/Equipo/Perfil/móvil). Clase INFERIDO hasta releer en G4. Riesgo: **S** seguro (solo presentación) · **D** con default explícito · **P** no ocultar.

### 14.1 Hechos que condicionan el diseño
- **H-WS-20** No existe ningún mecanismo por organización para ocultar campos/pestañas/columnas/acciones; todo está en JSX. Lo único por organización son catálogos y `accounts.configuration`. El único "ocultar" real y compartido es el **tablero por defecto del dashboard** (`dashboards.isDefault`, lo fija `account:write`).
- **H-WS-21** El servidor casi no exige nada: `CreateClientDto` solo exige `clientType` (+ nombre/razón social por `assertIdentity`); `CreateCreditDto` solo `clientId` y `principalAmount`. El teléfono obligatorio es regla de la web. **El riesgo está en el motor de créditos** (`parseCreditTerms` → `TERMS_INVALID` si falta un campo que la UI ocultó) y en lo que leen Mora, Pagos y Rutas (`installmentAmount`, `frequency`, `nextDueDate`, coordenadas, contactos). El servidor **no** completa defaults dentro de `terms`.
- **H-WS-22** La API no exige foto, firma ni GPS reales en visitas; el móvil encola acciones offline sin ellos. **La API no debe endurecerse** (rompe la cola) y los códigos de catálogo usados por acciones pendientes deben seguir activos hasta sincronizar.
- **H-WS-23** Los datos de contexto de una gestión (`reasonCode`, `expectedIncomeDate`, `payerParty`, `templateCode`) son **solo de escritura hoy**: nada los lee (ni timeline, ni export, ni métricas). Ocultarlos solo deja de capturar un dato.
- **H-WS-24** Acoplamiento a evitar: vaciar el catálogo `NO_PAYMENT_REASON` oculta también "quién responde" (`withContext = reasons.length > 0`). Vaciar `PAYMENT_METHOD`, `CANCEL_REASON` o `RESCHEDULE_REASON` deja imposibles promesas, cancelar y reagendar (la API exige código activo). **El workspace nunca debe simplificar vaciando catálogos**: usa claves propias.
- **H-WS-25** Defecto previo detectado (no lo causa el workspace, lo hace visible): el modal de agenda no tiene campo banco, pero la API lo exige si el método tiene `requiresBank` (DEPOSIT/TRANSFER/CHECK de fábrica). Y el default de `ratePeriod` del formulario es `ANNUAL`, no "por cuota".
- **H-WS-26** Hay listas duplicadas web/móvil (`PAYERS`, `MORA_OUTCOMES`, modalidades). La v1 es solo web; la coherencia móvil se resuelve en F8 reutilizando el mismo `resolveWorkspace` de `shared`.
- **H-WS-27** El dueño de una cuenta nueva es `ACCOUNT_ADMIN`, pero Planificar rutas filtra por rol `COLLECTOR` (`planificar/page.tsx:55`, verificado): un independiente real ve la pantalla vacía. Defecto previo; **fuera de v1, a decidir (O-3)**.

### 14.2 Mecanismo: un registro de opciones simplificables
Un solo catálogo en `shared` (`WORKSPACE_OPTIONS`), que es lo único que la pestaña de configuración y los componentes consultan. Cada entrada: `{ key, module, kind: 'section'|'field'|'choices'|'fixed', risk, default?, requires?, mobile: 'none'|'mirror' }`.
- Solo entran las opciones **S** y **D**. Las **P** no tienen entrada (no se pueden ocultar por construcción).
- `kind: 'fixed'` guarda un valor (p. ej. `credit.definition = 'agreed_installment'`); el helper `workspaceDefaults()` produce el payload que antes pedía el campo oculto, de modo que el formulario nunca envía vacío algo que el motor exige.
- `choices` restringe lo ofrecido en selectores; **siempre se incluye el valor ya guardado** del registro que se edita.
- Hook web único: `useWorkspace()` con `shows(key)`, `fixed(key)`, `choices(key)`.
- Persistencia en `configuration.workspace.options` (mismo documento de §7). Servidor: valida claves y valores contra el catálogo; no consulta el workspace para aceptar o rechazar operaciones (D-1).
- La interfaz no muestra interruptores sueltos: muestra **grupos con lenguaje de negocio** por módulo ("Mis créditos son de cuota acordada", "Registrar el motivo de no pago") y presets que activan varios. El detalle fino queda en el catálogo.

### 14.3 Matriz por módulo
**Ola:** O1 = v1 (alto impacto, bajo riesgo) · O2 = siguiente · — = no se ofrece.

#### Cartera · crédito
| Opción | Efecto | Riesgo | Ola | Notas / default exigido |
|---|---|---|---|---|
| **Modalidad fija** `credit.definition` (calculated / agreed_installment / agreed_total) | Si es acordada, desaparecen tasa, período de tasa, convención, base, tipo de interés, amortización, seguro y cargos (8 controles) | D | **O1** | Defaults del formulario salen del helper. `agreed_installment`: exige `installmentAmount`, `frequency`, `firstDueDate`; `installmentsCount` vacío = préstamo abierto (D12). Conservar la modalidad de créditos existentes al editar |
| Avanzadas de `calculated`: `rateConvention`, `rateBase`, `insuranceMonthlyPercent`, `charges` | Oculta el bloque "Avanzadas" | S | **O1** | Mostrar igual cargos/seguro ya guardados en un crédito existente |
| `frequency` permitidas (de `OFFERED_FREQUENCIES`) | Menos opciones | S | **O1** | Incluir la guardada. Pagos y recordatorios leen `frequency` |
| `arrearsMethod` oculto | Usa el de la cuenta | S | **O1** | Ya es el patrón "oculto + default de cuenta" |
| `interestType` fijo (SIMPLE) | Oculta selector | D | O2 | Compuesto + capital fijo ya se rechaza (D4) |
| `amortization` fija (FIXED_INSTALLMENT) | Oculta selector | D | O2 | Pago único solo aparece si el crédito ya lo tiene |
| `ratePeriod` fijo | Oculta selector | D | O2 | **Elegir el default a propósito** (hoy ANNUAL) |
| `termUnit` fija (cuotas o meses) | Oculta selector | D | O2 | Se guarda siempre convertido a cuotas |
| Cotización / tabla de plan en el alta | Oculta paneles | S | O2 | |
| Estado inicial "ya está en curso" | — | D | — | Lo usa quien digitaliza cartera vieja (relevante al independiente): **no** se oculta |
| `principal`, `firstDueDate`, `ratePercent` (calculated), `installmentAmount` (agreed_installment), `agreedTotal`, `installmentsCount` | — | P | — | Obligatorios del motor |
| Responsable y oficina del crédito | Ya se ocultan con 1 oficina o sin `assignment:write` | — | — | No ofrecer: en equipos define visibilidad (RLS) |

#### Cartera · cliente (alta y ficha)
| Opción | Riesgo | Ola | Notas |
|---|---|---|---|
| Secciones **Ingresos**, **Garantes**, **Garantías no personales**, **Adjuntos** | S | **O1** | Sin lectores críticos. Sin Ingresos se ofrecen todos los motivos de no pago |
| `gender`, `preferredContactChannel`, `taxId` | S | **O1** | |
| `clientType` fijo (PERSON) | D | O2 | Define qué exige `assertIdentity` |
| `riskSegment` | D | O2 | Pondera el score de prioridad de mora (HIGH 30 / MEDIUM 15 / LOW 0); oculto = 0, no rompe |
| Coordenadas / mapa / fotos de fachada | S (solo con Rutas apagado) | O2 | Rutas usa lat/lng. Condición cruzada con el módulo Rutas (`requires`) |
| `nationalId` | D | — | Sin documento no hay chequeo de duplicados por carnet |
| Perfil de cobro "Cómo cobrarle" | S | — | Ya se oculta con catálogo vacío; no tocar catálogos (H-WS-24) |
| Nombre / razón social, **teléfonos y correos**, direcciones | P | — | Toda la cobranza depende de ellos |
| Columnas Riesgo / Estado del cliente | S | — | Ya apagadas por defecto; la preferencia de columnas es por usuario |

#### Mora
| Opción | Riesgo | Ola | Notas |
|---|---|---|---|
| **Bloque de contexto** (motivo de no pago, fecha de ingreso esperada, quién responde) | S | **O1** | H-WS-23. No vaciar el catálogo; clave propia |
| Opción `BENEFICIARY` de "quién responde" | S | **O1** | Única forma de "beneficiario" que existe. Tocar 3 listas (web, móvil en F8, literal del validador, que **sigue permitiendo todo**) |
| Secciones de la ficha: métricas, notas, pagos, historial de episodios, "La persona", promesas (si no se usan) | S | **O1** | Aisladas |
| Tipos de gestión ofrecidos | S | O2 | Siempre `NOTE` y al menos otro. Conservar `PROMISE_TO_PAY` si hay promesas. Solo UI; el validador compartido acepta el conjunto completo |
| Resultados ofrecidos por tipo | D | O2 | Ocultar los negativos (no contestó, número errado) pierde métricas de intento. Siempre ≥1 por tipo no-NOTE. No ocultar CONTACTED / REFUSAL / PROMISE_TO_PAY |
| Prioridad (columna, filtro, chip) | S (visual) | O2 | **No** apagar el cálculo: orden y filtros dependen de él |
| Columnas opcionales y filtros avanzados | S | O2 | Ya son preferencia por usuario; la API ignora filtros desconocidos |
| Responsables, acciones masivas, castigar | S | — | Ya dependen de permiso o alcance |
| Datos de la promesa (monto, fecha, medio, banco requerido), timeline, botón "Registrar gestión", `PsfNotice` si hay importación | P | — | |

#### Agenda
| Opción | Riesgo | Ola | Notas |
|---|---|---|---|
| Vistas Semana / Mes | S | **O1** | Solo URL |
| Posponer (+15/+30/+60) | S | O2 | |
| Panel de vencidas, tarjetas laterales, filtros | S | O2 | |
| Tipos de agendado ofrecidos | D | O2 | `VISIT` es P si Rutas está encendido; `REMINDER` lo crea igual el job de cuotas |
| Resultados negativos al ejecutar | D | O2 | No ocultar `PROMISE_KEPT/BROKEN` (cierran la promesa) |
| Cancelar / Reagendar y sus motivos | P | — | La API exige motivo activo; con 1 motivo se podría autoseleccionar (O2) |

#### Pagos
| Opción | Riesgo | Ola | Notas |
|---|---|---|---|
| **Canal** (KOBRAX_COLLECTED / EXTERNAL_CONFIRMED) | D | **O1** | Default KOBRAX_COLLECTED (afecta la métrica `recoveredAmount`) |
| Notas, N.º de recibo, foto del comprobante | S | **O1** | Hash e imagen siempre juntos |
| Atajos "cuota" / "liquidar" | S | O2 | |
| Selector de medio | D | O2 | Default CASH; **si CASH se desactiva el default queda inválido** → la validación del workspace lo impide |
| Tarjetas de resumen, columnas y filtros del ledger | S | O2 | |
| Solicitudes de pago (QR/link) | S | O2 | Hoy flag global de build y la API sigue viva; por organización sería un interruptor de UI |
| Crédito, monto, idempotencia, fecha | P | — | Anulación y conciliación no existen hoy |

#### Rutas (si el módulo está encendido)
| Opción | Riesgo | Ola | Notas |
|---|---|---|---|
| Vista "Período", resumen por cobrador, columnas cobrador/cobrado | S | O2 | Con 1 usuario no aportan |
| Panel de pedidos de cambio | S | O2 | Con 1 usuario nunca se crea; el móvil encola `route.change.*`: **no tocar backend** |
| "Optimizar" (web) | S | O2 | Solo el botón; el móvil lo usa |
| Filtros avanzados de Planificar | S | O2 | |
| Pestaña de evidencia en la parada | S | — | Los datos siguen y el móvil sigue escribiendo |
| Iniciar / completar / cancelar, registrar visita, resultados de visita | P | — | `VisitOutcome` es enum de BD |
| Evidencia foto / firma / GPS | — | — | Código fijo; la API no los exige y no debe empezar a exigirlos (H-WS-22) |

#### Cuenta, Dashboard, Importar, Exportar, Equipo, Perfil
| Opción | Riesgo | Ola | Notas |
|---|---|---|---|
| Pestaña **Facturación** + `BillingAlert` del marco | D | **O1** | Ocultar ambos a la vez o el aviso apunta a una ruta oculta |
| Pestaña **Actividad**, transferencia de propiedad, nota de retención, tarjeta "Tipos de oficina" | S | **O1** | |
| **Tablero por defecto del preset** (sin tabla de cobradores ni mapa de visitas) | S | **O1** | Se implementa **guardando el tablero por defecto de la cuenta**, sin mecanismo nuevo. Ojo: la página pide los 6 endpoints de analytics aunque no estén en el tablero |
| Widgets `funnel/gauge/histogram/text` (sin fuente de datos) | S | **O1** | Quitarlos del buscador "Añadir widget" |
| Formulario de jornada (Cobranza) | S | O2 | Existe `DEFAULT_PREFERENCES`; el móvil no lo lee |
| Import: vínculo de asesores, controles de asignación, pasos 4–5 del asistente | S / D | O2 | Usan `DEFAULT_IMPORT_CONFIG`. **No** ocultar `code`, `clientName`, `absentRule` |
| Exportar: CSV individuales | S | O2 | El respaldo **no** se puede quitar de todos lados |
| QR de cobro del perfil | D | O2 | Solo si la cuenta no cobra por QR (el móvil lo usa) |
| Pestañas General, **Plan**, Cobranza (moneda, decimales, categorías de mora), Avanzado (respaldo) | P | — | Las consumen Mora, Rutas y el móvil; el respaldo es la única salida de datos |
| Selector multi-empresa, campana de notificaciones, MFA | P | — | El selector ya se oculta solo con 1 empresa |

### 14.4 Qué compone el preset "Independiente" de la ola O1
Menú: Inicio, Cartera, Mora, Agenda, Pagos, Cuenta (Importar según preset). Crédito: modalidad fija "cuota acordada", sin avanzadas, frecuencias recortadas, método de mora de la cuenta. Cliente: sin Ingresos/Garantes/Garantías/Adjuntos/género/canal/NIT. Mora: sin bloque de contexto, sin beneficiario, ficha reducida. Agenda: solo vista Día. Pagos: sin canal, notas, recibo ni foto. Cuenta: sin Facturación, Actividad ni transferencia. Dashboard: tablero sin tabla de cobradores ni mapa.

### 14.5 Reglas y prerrequisitos
- **R6** Todo `kind: 'fixed'` lleva un `default` válido contra el motor; test que construye el payload con cada opción oculta y lo pasa por `parseCreditTerms` / `resolveCreditTerms`.
- **R7** Una opción oculta nunca oculta un valor ya guardado en el registro que se ve o edita.
- **R8** Una opción solo puede ocultarse si ninguna otra opción activa la requiere (`requires`): coordenadas y `VISIT` solo con Rutas apagado.
- **R9** Ninguna opción actúa sobre catálogos (H-WS-24).
- **P-1** (previo, recomendado) corregir H-WS-25 (banco en agenda) antes de ofrecer recortar métodos de pago.
- **P-2** (previo, decidido) Planificar rutas para el propio usuario (H-WS-27, O-3 resuelta): incluir al usuario actual entre los destinatarios si tiene `route:execute`. Verificar que `POST /routes/plan` acepta como destinatario a un `ACCOUNT_ADMIN` (reglas de `route-access.ts` / `assignment-rules.ts`: no verificado) y que con 1 usuario no se generan pedidos de cambio.

### 14.6 Criterios de aceptación adicionales
- **A-12** Con cada opción de la ola O1 activada, crear y editar un crédito, cliente, gestión y pago pasa por la API real sin error ni campos exigidos vacíos.
- **A-13** Un registro existente con un valor que la configuración ocultaría se muestra y se guarda sin perderlo.
- **A-14** Las pruebas existentes de cada pantalla siguen pasando con configuración vacía (Completo).
- **A-15** Ninguna opción marcada P tiene entrada en `WORKSPACE_OPTIONS`.


---

## C. Correcciones de la validación G4 (2026-11-06) — mandan sobre el texto anterior

| ID | Corrección | Evidencia |
|---|---|---|
| C-1 | **H-WS-23 corregida.** Los datos de contexto de una gestión **sí se sirven** por la API (`serializeCreditActivity` los devuelve en el detalle de mora), pero ninguna pantalla web ni móvil los pinta; solo los formularios los escriben. Hay un índice previsto para una futura "capa B". Ocultar el bloque sigue siendo seguro. Distinto de `agenda_items.reasonCode` (cancelar/reagendar), que sí se lee. | `mora/credit-activity.ts:60-87`; `mora.service.ts:208`; `schema.prisma` índice `(accountId, reasonCode, createdAt)` |
| C-2 | **El contexto de gestión está duplicado en Agenda.** `agenda/[id]/item-actions.tsx:112` repite la lógica `reasons.length > 0` y `agenda/[id]/page.tsx:103` decide si pide los motivos. Ocultar en Mora sin tocar Agenda deja el bloque visible al ejecutar un agendado. Las dos pantallas van en la misma ola. | informe web G4 §6 |
| C-3 | **`termUnit` arranca en `YEARS`** (`credit-form.ts:149`). Con `agreed_installment` quien escribe "12" cree que son 12 cuotas y el motor lo convierte a 12 años. Al fijar la modalidad **hay que fijar también `termUnit = INSTALLMENTS`** (sube de O2 a la misma ola que la modalidad fija). | informe web G4 §4 |
| C-4 | **"Avanzadas" contiene `arrearsMethod`** para todas las modalidades (`credit-terms-fields.tsx:~289`). Ocultar el bloque entero quitaría el método de mora. Separar en el JSX: ocultar tipo/convención/base/seguro/cargos y tratar `arrearsMethod` aparte (default de cuenta). | informe web G4 §4 |
| C-5 | **Errores del motor:** un `terms` mal formado da `creditTermsInvalid(['TERMS_SHAPE'])` (`credits.service.ts:1084-1086`); `TERMS_INVALID` aparece cuando `calculateCredit` reporta errores. Siempre obligatorios en `terms`: `principal` y `firstDueDate`. `calculated` exige además `ratePercent`, `periods`, `interestType`, `amortization`, `frequency`. `agreed_installment`: `installmentAmount` y `frequency`. `agreed_total`: `agreedTotal` y `repayment` (con cuotas, también `frequency` y `periods`). `dto.principalAmount` debe coincidir con `terms.principal`. | informe backend G4 §4 |
| C-6 | **Hay dos filtros de pestañas de Cuenta.** `visibleCuentaTabs` (solo lo usa su test) y `CUENTA_TABS.filter(can)` en el componente cliente `cuenta/cuenta-tabs.tsx:20`, que es el que se dibuja. El workspace debe entrar por el segundo, y las pruebas A-1/A-2 deben cubrir el que se dibuja (o unificar los dos). | informe web G4 §1 |
| C-7 | **Guard de ruta: no basta el layout.** Un layout de App Router no se vuelve a ejecutar en navegación suave entre rutas hijas (inferencia sin probar en el repo). El guard va **en cada `page.tsx` de módulo** (como ya hacen `rutas/planificar/page.tsx:49` y `dashboard/page.tsx:80`) y, además, en el layout para carga completa. Requiere prueba real. | informe web G4 §2 |
| C-8 | **Enlaces a módulos apagados no listados antes:** `lib/notifications.ts:15` (`/rutas/${routeId}`), `billing-alert.tsx:22` y el punto de aviso en `cuenta-tabs.tsx:42`, `agenda/[id]/page.tsx:253` y `pagos/[id]/page.tsx:76` (hacia paradas de ruta), `cuenta/agencias/page.tsx:5` (redirige a `/cuenta/oficinas`), selector de oficina y datos de `/users` en el dashboard, y `crumbsFor` (recorre `NAV` completo, no el filtrado). | informe web G4 §1, §3 |
| C-9 | **Dashboard:** 11 llamadas por carga (6 de analytics + `/dashboards`, `/auth/me`, `/users`, resumen de agenda y oficinas) aunque el tablero no tenga el widget; `dashboard/page.tsx:60` vuelve a pedir `/auth/me`. Guardar el tablero por defecto exige `account:write` **y** `report:read`. Escribe en `dashboards` (otra tabla), no en `configuration`. | informe web G4 §5 |
| C-10 | **P-2:** el endpoint es `POST /routes/generate` (no `/routes/plan`). El servidor **ya acepta** como destinatario a cualquier usuario activo (`assertCollector` no mira el rol; `ACCOUNT_ADMIN` tiene `route:execute` y `route:assign`). El bloqueo es solo de la web (`planificar/page.tsx:55`). P-2 se reduce a un cambio web. Un `ACCOUNT_ADMIN` único nunca genera `route_change_request` (`canManage`). | informe backend G4 §5, §6 |
| C-11 | **Visitas:** `lat`/`lng` **sí son obligatorios** en `POST /visits` (rango validado); lo que no se exige es GPS real (`gpsFallback`, `source=WEB` o coordenada de la parada se aceptan y se marcan estimadas). Además `validateVisitDetails(outcome, details)` valida contenido por resultado. Foto y firma no se exigen. | informe backend G4 §7 |
| C-12 | **Escritura de `workspace` — trampa de implementación:** el merge de `configuration` solo corre dentro de `if (dto.preferences \|\| dto.billing)` (`accounts.service.ts:~191`). Hay que ampliarlo, o un PATCH con solo `workspace` se descarta en silencio. `serializeAccount` es lista blanca: `workspace` no sale por `GET /accounts/me` salvo que se agregue. Leer-mezclar-escribir sobre `configuration` entero es last-write-wins; `portfolio-import.service.ts:1223` también la reescribe. | informe backend G4 §1, riesgos a-b |
| C-13 | **Auditoría:** `before/after` guardan la fila `accounts` completa (incluye `billing`; solo `taxId` está en `redactKeys`). Para el workspace auditar solo el subárbol `workspace` (o redactar el resto). | informe backend G4 riesgo d |
| C-14 | **Móvil:** `account.service.ts:51` cachea `/accounts/me` (topes del plan). El workspace viaja por `/auth/me`; si más adelante el móvil lo lee por `/accounts/me` lo verá viejo hasta refrescar. Decisión para F8. | informe backend G4 riesgo c |
| C-15 | **Pruebas:** `credit-editor.tsx` no tiene test propio; el test de `loan-form` mockea `buildNewCreditPayload` (no sirve para probar defaults: se prueba en `shared`); no hay test de `dashboard/page.tsx` ni de `(panel)/layout.tsx`. Web: `vitest run` toma `src/**/*.test.{ts,tsx}` (no hay que registrar). API: todo spec nuevo va al script `test` de `apps/api/package.json` (F13 B12 / F14-B). Hay test de paridad es/en de i18n. Estimación (no medida): 40–70 claves por idioma. | informe web G4 §9 |
