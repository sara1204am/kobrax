# Kobrax — Dossier técnico y de estado real

> Auditoría del código del repo al **2026-10-10** (rama `dev`, merge `89b3d01`:
> incluye la alineación móvil ↔ web, PR #6–#12). Es la fuente de verdad para la
> postulación: si algo no está aquí como IMPLEMENTADO, no se afirma en el formulario
> ni en el deck. La visión estratégica y el análisis competitivo están en `resumen.md`.
>
> Leyenda: ✅ implementado · 🟡 parcial o sin validar en dispositivo · 📝 solo planeado · ❌ no existe

## 1. Qué es

Plataforma multi-tenant de gestión de cobranzas para Latinoamérica. Una misma
plataforma sirve desde un cobrador independiente hasta una financiera regulada.
Tres componentes: API (NestJS), panel web (Next.js 14) y app móvil del cobrador
(Expo / React Native, offline-first).

**Posicionamiento (resumen.md §11):** de gestionar cobranzas a **mejorar las decisiones de
recuperación**. Hoy el producto cubre la parte operativa y la captura estructurada de datos;
la capa de inteligencia artificial analítica es **visión de evolución, no funcionalidad** (§3.4).

## 2. Escala del producto (medido en el repo)

| Elemento | Dato | Fuente |
|---|---|---|
| Módulos del backend | 20 (+ `common/`) | `apps/api/src/modules` |
| Modelos / enums de datos | 48 / 39 | `packages/database/prisma/schema.prisma` |
| Migraciones | 47 | `packages/database/prisma/migrations` |
| Tablas operativas con aislamiento RLS forzado | 39 en la lista del script (+ auxiliares) | `packages/database/prisma/rls/001_enable_rls.sql` |
| Permisos RBAC / roles base | 36 / 6 | `packages/shared/src/enums/permission.enum.ts` |
| Rutas del panel web (grupo panel) | ~25 pantallas | `apps/web/src/app/(panel)` |
| Idiomas del panel | es / en (test de paridad) | `apps/web/src/messages` |
| Pantallas de la app móvil | 5 pestañas + auth, import, cuenta, rutas, mora | `apps/mobile/app` |
| Archivos de prueba | API+shared 118 · web 94 · móvil 78 suites | conteo de archivos |
| Pruebas ejecutadas (2026-10-10) | API **1.542** · web **938** · móvil **916** · integración API **51** · todas pasan | corrida directa |

## 3. Funcionalidades por componente

### 3.1 API
| Capacidad | Estado | Nota |
|---|---|---|
| Auth: JWT + refresh con rotación, denylist Redis, sesiones | ✅ | |
| 2FA TOTP + códigos de respaldo | ✅ | |
| **MFA obligatorio para roles críticos** (SUPER_ADMIN, ACCOUNT_ADMIN) | ✅ | no se desactiva ni se posterga (salvo gracia explícita configurable); impuesto en el servidor |
| RBAC y alcance de datos por fila | 🟡 | activo en aplicación para Mora, Agenda, Rutas y visitas; **no** en Cartera ni Pagos; sin policies en RLS (§6). Overrides por usuario: solo modelo, sin código |
| Multi-tenant con RLS `FORCE` | ✅ | script `rls/001_enable_rls.sql` aplicado tras cada migración |
| Auditoría de mutaciones con PII redactada | ✅ | tabla no es append-only a nivel de BD |
| Cifrado AES-256-GCM de PII + índice ciego HMAC | ✅ | |
| Evidencia: foto + GPS + SHA-256 verificado, deduplicado, inmutable | ✅ | `field-ops/field-integrity.ts` |
| Mora: episodios, prioridad (automática o fijada), categorías, promesas, notas | ✅ | |
| Agenda, recordatorios de cuota, reprogramación, posponer | ✅ | |
| Resumen del día: contactos efectivos, promesas tomadas y que vencen hoy | ✅ | definición única en el servidor (`GET /agenda/summary`) |
| Hora recomendada de contacto (regla sobre contactos efectivos previos) | ✅ | regla determinista, no un modelo |
| Rutas: planificación, optimización OSRM, pedidos de cambio, PDF | ✅ | degrada a línea recta si OSRM cae |
| Importación de cartera (Excel/CSV/PDF), modos RECONCILE/UPSERT/REPLACE | ✅ | dry-run, historial por corrida |
| Pagos: registro idempotente, solicitudes y confirmación | ✅ | |
| Dashboards y analytics (aging, desempeño, tendencia, mapa de visitas) | ✅ | descriptivos; no hay análisis de efectividad de estrategias |
| Exportaciones CSV/PDF y respaldo | ✅ | |
| Realtime (Socket.io) | ✅ | |
| Push FCM (Android): tokens por dispositivo, envío genérico | 🟡 | implementado y probado en código; **no verificado con credenciales ni en teléfono** |
| Planes y límites | 🟡 | catálogo completo; verificar qué topes se hacen cumplir |
| Almacenamiento S3/R2 | ❌ | hoy disco local por tenant |
| SMS / email de notificaciones | ❌ | stubs que solo registran log |
| WhatsApp por API de proveedor | ❌ | se usa deep link `wa.me` y plantillas |
| Geocodificación | ❌ | las ubicaciones llegan con coordenadas |
| Conciliación de pagos contra extractos bancarios | ❌ | la conciliación existente es de cartera |

### 3.2 Panel web
| Pantalla | Estado |
|---|---|
| Dashboard editable con grilla, KPIs, aging, desempeño, tendencia, mapa de visitas | ✅ |
| Cartera (tabla server-side, ficha del cliente, créditos, garantes, adjuntos, PDF) | ✅ |
| Importación con vista previa, asignación y detalle por corrida | ✅ |
| Central de mora (filtros, acciones masivas, exportación, ficha de gestión) | ✅ |
| Agenda (mes/semana/día, vencidas, reprogramación) | ✅ |
| Rutas (hoy/historial, planificador de 4 pasos, mapa, aprobar cambios) | ✅ |
| Pagos (ledger, detalle, solicitudes) | ✅ con límites (total por página) |
| Equipo, cuenta, plan, MFA, sesiones activas | ✅ |
| Cambio de plan autoservicio / checkout | 📝 |
| Widgets funnel, gauge, histogram, text | 📝 placeholder |
| Pruebas e2e y auditoría a11y automática | ❌ |

### 3.3 App móvil (cobrador)
| Capacidad | Estado |
|---|---|
| Login, 2FA, biometría, invitación, registro, select-account | ✅ |
| Seguridad de la cuenta: cambiar contraseña, MFA, sesiones activas | ✅ |
| Inicio con KPIs del día (los de agenda los calcula el servidor, con respaldo local fechado) | ✅ |
| Agenda: crear, editar/eliminar sin señal, registrar gestión, posponer, avisos locales | ✅ |
| Cobranza/mora: ficha, gestión, promesa, nota, pago, QR de cobro, fijar prioridad | ✅ |
| Rutas: crear (varios días), confirmar, mapa, resultado por parada, cobro con cuota sugerida, resumen de jornada | ✅ |
| Rutas: cambiar la dirección de una parada, cancelar con motivo, pedidos de cambio, historial de la parada | ✅ |
| Fotos de la vivienda con visor y caché local; tipo y dueño de cada dirección | ✅ |
| Importación desde el móvil (con historial) | ✅ |
| Offline: SQLite + cola idempotente + sincronización + conflictos | ✅ |
| Foto de evidencia con hash de servidor y GPS; compresión previa | ✅ |
| Llamada y WhatsApp (deep links) | ✅ |
| Cifrado en reposo de caché y cola local (XChaCha20-Poly1305, llave en el almacén seguro) | 🟡 implementado y probado en código; **falta validar en teléfono** y regenerar el proyecto nativo (`expo-crypto`) |
| SSL pinning | 🟡 pines reales de producción configurados; **sin probar en dispositivo** |
| Push remoto (registro de token y navegación al tocar) | 🟡 implementado; **sin credenciales Firebase ni prueba en teléfono** |
| Mapas MapLibre | 🟡 sin estilo de producción ni paquetes offline en la UI |
| Hash SHA-256 calculado en el dispositivo | 🟡 solo en servidor |
| Foto en el pin del mapa, zoom por pellizco, vista «Semana», notas de mora sin señal | 📝 |
| Firma digital | 📝 |
| Pruebas e2e en dispositivo | ❌ solo pruebas unitarias y exportación de la app |

### 3.4 Inteligencia sobre la cobranza (resumen.md §5–§8)

Esta tabla existe para no sobre-afirmar. La visión tiene tres niveles; solo los dos primeros existen, y el segundo de forma parcial.

| Nivel | Qué es | Estado | Qué hay hoy |
|---|---|---|---|
| 1. Registrar | créditos, pagos, visitas, rutas, promesas, resultados | ✅ | todo lo de §3.1–3.3 |
| 2. Gestionar y automatizar | agenda, prioridad, alertas, recordatorios, rutas | 🟡 | prioridad de mora automática (reglas), recordatorios de cuota, alertas de promesas por vencer y de gestiones vencidas, optimización de rutas, hora recomendada. **Faltan** agendas recurrentes y el resumen de historiales |
| 3. Analizar, recomendar, aprender | patrones, efectividad de estrategias, recomendaciones explicadas | ❌ | **no existe**: no hay modelo, ni análisis de efectividad, ni recomendaciones, ni dictado por voz |

Datos estructurados que ya se capturan (base del nivel 3): tipo y resultado de cada gestión, promesas con fecha e importe y su seguimiento, motivo de cancelación o reagendado, evidencia con fecha y ubicación, episodios de mora con historial. **Faltan** para el análisis: catálogo de motivos de incumplimiento, canal y estrategia utilizada, y el registro de si una recomendación se aceptó, corrigió o rechazó.

Etapas de la hoja de ruta (resumen.md §8): 1 consolidar la operación (en curso, avanzada) · 2 estructurar datos (parcial) · 3 automatizar y asistir (inicial) · 4 analizar efectividad (no iniciada) · 5 recomendaciones predictivas (no iniciada; solo con datos suficientes y evaluación).

## 4. Diferenciadores defendibles (contrastados con la competencia, §9)

Hay competidores que ya ofrecen rutas, trabajo offline, GPS, segmentación y estrategias por segmento (§9). Por eso no son diferenciadores únicos: **offline, rutas y reportes**. Lo defendible hoy:

1. **Evidencia con valor probatorio:** foto + GPS + huella SHA-256 verificada en servidor, inmutable y deduplicada.
2. **Mismo producto de 1 a 500 usuarios:** plan gratuito para el independiente; importación de «archivo oficial del día» para la financiera.
3. **Aislamiento a nivel de base de datos (RLS):** no depende solo de código de aplicación.
4. **Mora modelada como episodios**, con historial, promesas y métricas de recuperación (no un estado manual): es la base de datos que permitiría el análisis.
5. **Rutas sobre OSRM propio**, sin depender de Google ni pagar por consulta.
6. **Seguridad de punta a punta en el móvil** (MFA obligatorio para roles críticos, cifrado en reposo): ver estados en §3.3.

El diferenciador **estratégico** —asistencia y aprendizaje sobre resultados reales— es **visión, no producto** (§3.4). Debe presentarse como tal.

## 5. Modelo de negocio (fuente: `docs/business/`)

| Plan | Precio | Usuarios | Créditos activos |
|---|---|---|---|
| FREE | $0 | 1 | 20 |
| PROFESSIONAL | $12 por cobrador/mes | 25 | 1.000 |
| BUSINESS | $99 + $10 por cobrador/mes | 100 | 5.000 |
| ENTERPRISE (piso) | $800 + $8 por cobrador/mes, anual | 500 | 50.000 |

- Precios en USD; el dólar oficial pasó de Bs 6,96 a Bs 11,71 (verificado 2026-08-13). Hay una decisión abierta sobre sostener Bs 141 o bajar a ~Bs 120 para PROFESSIONAL.
- Costo de infraestructura estimado: ~$23–47/mes en etapa piloto (~20 cobradores), ≤11 % de lo facturado en todas las etapas. Son estimaciones con precios de proveedores de agosto 2026.
- Punto de equilibrio estimado: 4 / 17 / 58 cobradores según etapa.
- **Sin clientes pagantes ni métricas de adopción documentadas.**
- **Referencias de mercado (resumen.md §3 y §4):** AtllasPay publica USD 28 por ruta/mes (Starter); CarteraGo, desde USD 6 la primera ruta y USD 4,50 las siguientes. Los precios de Kobrax (USD 12 por cobrador) quedan en el rango de estas ofertas SaaS; las tarifas deben verificarse con cada proveedor antes de compararlas en público.
- **Costo de un sistema institucional:** la hipótesis de «Bs 400.000 o más» es **preliminar**: las partidas del BDP (anticipos «Integre SRL – Compra de Software de Cobranza») son una referencia contable, no el precio total del sistema, ni demuestran que el proveedor sea CIRRUS IT. No sumar periodos.

## 6. Seguridad: lo que se puede y no se puede afirmar

**Se puede afirmar:** RLS forzada en las tablas operativas; AES-256-GCM en datos personales; 2FA y MFA obligatorio para roles críticos (impuesto en el servidor); tokens con rotación y detección de reuso; rate limiting; auditoría con redacción; hash de evidencia; cifrado en reposo del dispositivo **implementado** (validación en teléfono pendiente).

**No afirmar:**
- «El cobrador solo ve su cartera» sin matizar: el alcance por fila se aplica en la aplicación para Mora, Agenda, Rutas y visitas, pero los listados de Cartera (clientes, créditos) y Pagos devuelven los de toda la cuenta, y no hay policies de alcance en la base de datos (`docs/producto/roles-permisos-planes.md` §3.3).
- Cumplimiento o certificación ASFI: no hay ninguna; el documento de precios lo marca como supuesto a consultar con abogado.
- SSL pinning «activo y verificado» o respaldos restaurados y probados.
- Que la IA ya recomienda, predice o aprende (§3.4).

## 7. Estado de despliegue

**Desplegado y accesible en <https://kobrax.ikigaisystems.lat/login>** (confirmado por la fundadora el 2026-10-09). Opera con datos de prueba, no con clientes reales. Detalle de la arquitectura de despliegue y de los datos de demo: `docs/producto/demo-datos-y-despliegue.md`.

> Lo desplegado puede ir **por detrás** de `dev`: los cambios de la alineación móvil (migración `device_push_tokens`, `GET /payments?day=`, resumen de agenda ampliado, MFA obligatorio) deben desplegarse API y app **juntas**. Confirmar la versión realmente desplegada antes de decir qué está «en producción».

> `docs/business/PRICING-Y-DEPLOY.md` §1 y §9 (agosto 2026) todavía dice «no desplegado» y lista cuatro bloqueantes (fotos en disco local, receta de producción, respaldos automáticos, cuenta de Google Play de empresa). Ese documento está desactualizado en cuanto al despliegue.

Presentar como **MVP funcional completo y desplegado, en etapa previa al piloto con usuarios reales**.

## 8. Calidad

- Ejecutadas el 2026-10-10 y todas pasan: API 1.542 · web 938 · móvil 916 (78 suites) · integración API contra Postgres real 51.
- Sin medición de cobertura. No hay pruebas e2e ni validación en teléfono físico de las funciones nuevas del móvil.
- Los conteos que aparecen en otros documentos del repo corresponden a fechas distintas.

## 9. Competencia (resumen.md §3) — qué se sabe y qué no

Comparación de lo que se identificó públicamente; **no es una auditoría técnica** ni demuestra que lo no documentado no exista.

| Solución | Lo documentado | Precio público | Lectura para Kobrax |
|---|---|---|---|
| BDP Recupera | cartera, direcciones georreferenciadas, rutas, gestiones, pagos (para funcionarios del propio banco) | no identificado | referente funcional local; no es un producto que se venda |
| Cobranza Digital Fortaleza | segmentación por calificación, estrategias por segmento, recordatorios | no identificado | referente institucional |
| CIRRUS IT Collections | integración con el core, segmentación, estrategias, reportes, notificaciones | no identificado | competidor/proveedor institucional |
| AtllasPay | web + Android, rutas, GPS, offline, reportes, roles | USD 28/ruta/mes | competidor operativo SaaS |
| CarteraGo | préstamos, cartera, rutas, caja, offline, reportes | desde USD 6/ruta/mes | competidor operativo SaaS |
| CobrApp, Geo Cash | **pendiente de verificar** | — | no usar como referencia sin fuentes |

**Conclusión (resumen.md §12):** no se puede decir que en Bolivia falten soluciones analíticas ni que «nadie ofrece segmentación». La pregunta estratégica es si Kobrax puede ofrecer una combinación más **accesible, contextualizada y progresivamente inteligente**, y eso solo se demuestra con datos y recomendaciones medidas.
