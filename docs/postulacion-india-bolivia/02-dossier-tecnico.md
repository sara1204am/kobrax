# Kobrax — Dossier técnico y de estado real

> Auditoría del código del repo al **2026-10-09** (rama `docs/movil-alineacion-web`,
> base `main` en `3940025`). Es la fuente de verdad para la postulación: si algo no
> está aquí como IMPLEMENTADO, no se afirma en el formulario ni en el deck.
>
> Leyenda: ✅ implementado · 🟡 parcial · 📝 solo planeado · ❌ no existe

## 1. Qué es

Plataforma multi-tenant de gestión de cobranzas para Latinoamérica. Una misma
plataforma sirve desde un cobrador independiente hasta una financiera regulada.
Tres componentes: API (NestJS), panel web (Next.js 14) y app móvil del cobrador
(Expo / React Native, offline-first).

## 2. Escala del producto (medido en el repo)

| Elemento | Dato | Fuente |
|---|---|---|
| Módulos del backend | 20 (+ `common/`) | `apps/api/src/modules` |
| Modelos / enums de datos | 48 / 39 | `packages/database/prisma/schema.prisma` |
| Migraciones | 48 | `packages/database/prisma/migrations` |
| Tablas con aislamiento RLS forzado | 41 | `packages/database/prisma/rls/` |
| Permisos RBAC / roles base | 36 / 6 | `packages/shared/src/enums/permission.enum.ts` |
| Rutas del panel web (grupo panel) | ~25 pantallas | `apps/web/src/app/(panel)` |
| Idiomas del panel | es / en (3.310 líneas c/u, test de paridad) | `apps/web/src/messages` |
| Pantallas de la app móvil | 5 pestañas + auth, import, cuenta | `apps/mobile/app` |
| Archivos de prueba | API+shared 116 · web 94 · móvil 61 suites | ver §8 |
| Pruebas móvil ejecutadas | **750 pasan / 0 fallan** (jest, 2026-10-09) | corrida directa |

## 3. Funcionalidades por componente

### 3.1 API
| Capacidad | Estado | Nota |
|---|---|---|
| Auth: JWT + refresh con rotación, denylist Redis, sesiones | ✅ | |
| 2FA TOTP + códigos de respaldo | ✅ | |
| RBAC y alcance de datos por fila | 🟡 | activo en aplicación para Mora, Agenda, Rutas y visitas; **no** en Cartera ni Pagos; sin policies en RLS (§6). Overrides por usuario: solo modelo, sin código |
| Multi-tenant con RLS `FORCE` | ✅ | script `rls/001_enable_rls.sql` aplicado tras cada migración |
| Auditoría de mutaciones con PII redactada | ✅ | tabla no es append-only a nivel de BD |
| Cifrado AES-256-GCM de PII + índice ciego HMAC | ✅ | |
| Evidencia: foto + GPS + SHA-256 verificado, deduplicado, inmutable | ✅ | `field-ops/field-integrity.ts` |
| Mora: episodios, prioridad, categorías, promesas, notas | ✅ | |
| Agenda, recordatorios de cuota, reprogramación | ✅ | |
| Rutas: planificación, optimización OSRM, pedidos de cambio, PDF | ✅ | degrada a línea recta si OSRM cae |
| Importación de cartera (Excel/CSV/PDF), modos RECONCILE/UPSERT/REPLACE | ✅ | dry-run, historial por corrida |
| Pagos: registro idempotente, solicitudes y confirmación | ✅ | |
| Dashboards y analytics (aging, desempeño, tendencia, mapa de visitas) | ✅ | |
| Exportaciones CSV/PDF y respaldo | ✅ | |
| Realtime (Socket.io) y push FCM (Android) | ✅ | push solo con credenciales FCM |
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
| Inicio con KPIs del día calculados en el dispositivo | ✅ |
| Agenda: crear, ver, registrar gestión, posponer, avisos locales | ✅ |
| Cobranza/mora: ficha, gestión, promesa, nota, pago, QR de cobro | ✅ |
| Rutas: crear, confirmar, mapa, resultado por parada, resumen de jornada | ✅ |
| Importación desde el móvil | ✅ |
| Offline: SQLite + cola idempotente + sincronización + conflictos | ✅ |
| Foto de evidencia con hash de servidor y GPS | ✅ |
| Llamada y WhatsApp (deep links) | ✅ |
| Mapas MapLibre | 🟡 sin estilo de producción ni paquetes offline en la UI |
| SSL pinning | 🟡 plugin presente, lista de pines vacía (no-op) |
| Hash SHA-256 calculado en el dispositivo | 🟡 solo en servidor |
| Firma digital | 📝 |
| Push remoto (registro de token) | 📝 |
| Cifrado en reposo de caché/cola local | 📝 |

## 4. Diferenciadores defendibles

1. **Evidencia con valor probatorio:** foto + GPS + huella SHA-256 verificada en servidor, inmutable y deduplicada.
2. **Offline-first real:** cola idempotente; una caída de red o de servidor no frena al cobrador. 750 pruebas verdes en móvil.
3. **Mismo producto de 1 a 500 usuarios:** plan gratuito para el independiente; importación de «archivo oficial del día» para la financiera.
4. **Aislamiento a nivel de base de datos (RLS):** no depende solo de código de aplicación.
5. **Mora modelada como episodios**, con historial, promesas y métricas de recuperación (no un estado manual).
6. **Rutas sobre OSRM propio**, sin depender de Google ni pagar por consulta.

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

## 6. Seguridad: lo que se puede y no se puede afirmar

**Se puede afirmar:** RLS forzada en 41 tablas; AES-256-GCM en datos personales; 2FA; tokens con rotación y detección de reuso; rate limiting; auditoría con redacción; hash de evidencia.

**No afirmar:**
- «El cobrador solo ve su cartera» sin matizar: el alcance por fila se aplica en la aplicación para Mora, Agenda, Rutas y visitas, pero los listados de Cartera (clientes, créditos) y Pagos devuelven los de toda la cuenta, y no hay policies de alcance en la base de datos (`docs/producto/roles-permisos-planes.md` §3.3).
- Cumplimiento o certificación ASFI: no hay ninguna; el documento de precios lo marca como supuesto a consultar con abogado.
- Cifrado del dispositivo, SSL pinning activo o respaldos restaurados y probados.

## 7. Estado de despliegue

**Desplegado y accesible en <https://kobrax.ikigaisystems.lat/login>** (confirmado por la fundadora el 2026-10-09). Opera con datos de prueba, no con clientes reales. Detalle de la arquitectura de despliegue y de los datos de demo: `docs/producto/demo-datos-y-despliegue.md`.

> `docs/business/PRICING-Y-DEPLOY.md` §1 y §9 (agosto 2026) todavía dice «no desplegado» y lista cuatro bloqueantes (fotos en disco local, receta de producción, respaldos automáticos, cuenta de Google Play de empresa). Ese documento está desactualizado en cuanto al despliegue; los bloqueantes que sigan vigentes están por confirmar en el documento de despliegue.

Presentar como **MVP funcional completo y desplegado, en etapa previa al piloto con usuarios reales**.

## 8. Calidad

- Móvil: 61 suites / 750 pruebas, ejecutadas el 2026-10-09, todas pasan.
- Web: 94 archivos de prueba (~923 casos, conteo estático; no ejecutados en esta auditoría).
- API + shared: 116 archivos `*.spec.ts` y 4 pruebas de integración (no ejecutados en esta auditoría).
- Sin medición de cobertura ni e2e. Los conteos que aparecen en otros documentos del repo corresponden a fechas distintas.
