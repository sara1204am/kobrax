# Documentación funcional de Kobrax

> Documentación de producto verificada contra el código el **2026-10-09**
> (rama `docs/movil-alineacion-web`). Es la base para derivar cualquier otro
> material: presentaciones, manuales, propuestas, guiones de demo.
>
> Regla de lectura: cada documento marca lo **✅ implementado**, **🟡 parcial** y
> **📝 solo planeado**, y lista al final lo «no verificado». Donde el código y los
> documentos antiguos del repo se contradicen, manda el código.

Instancia desplegada: <https://kobrax.ikigaisystems.lat/login> (datos de prueba).

## Mapa de documentos

| # | Documento | Qué responde |
|---|---|---|
| 1 | [`roles-permisos-planes.md`](roles-permisos-planes.md) | Tipos de usuario, roles, matriz permiso × rol, qué ve cada rol en web y móvil, flujos de acceso (registro, invitación, 2FA, sesiones), planes y límites |
| 2 | [`web-A-acceso-dashboard-cuenta.md`](web-A-acceso-dashboard-cuenta.md) | Web: login, registro, invitación, recuperación, shell, dashboard, equipo, cuenta, exportar, perfil y seguridad |
| 3 | [`web-B-cartera-importacion-pagos.md`](web-B-cartera-importacion-pagos.md) | Web: cartera, ficha del cliente, créditos, importación (flujo y formatos), pagos y solicitudes |
| 4 | [`web-C-mora-agenda-rutas.md`](web-C-mora-agenda-rutas.md) | Web: central de mora, agenda, rutas y planificador; glosario y reglas de negocio |
| 5 | [`movil-A-acceso-inicio-agenda-cuenta.md`](movil-A-acceso-inicio-agenda-cuenta.md) | Móvil: acceso, Inicio (KPIs y su definición), Agenda, notificaciones, cuenta |
| 6 | [`movil-B-rutas-cobranza-clientes-import.md`](movil-B-rutas-cobranza-clientes-import.md) | Móvil: rutas y evidencia, cobranza, clientes, importación, offline y sincronización |
| 7 | [`backend-modulos-y-reglas.md`](backend-modulos-y-reglas.md) | API: módulos, endpoints, permisos, jobs, reglas de negocio e integraciones |
| 8 | [`modelo-de-datos.md`](modelo-de-datos.md) | Modelos, enums, relaciones (Mermaid), RLS y cifrado de PII |
| 9 | [`demo-datos-y-despliegue.md`](demo-datos-y-despliegue.md) | Datos de demo, empezar desde cero, escenarios de demostración, despliegue y variables |

### Propuestas (no implementado)

| Documento | Qué responde |
|---|---|
| [`ia-plan-maestro.md`](ia-plan-maestro.md) | **Documento rector de IA**: datos a guardar, reglas deterministas, funciones de IA por versión, privacidad y orden de construcción |
| [`agenda-recurrencia.md`](agenda-recurrencia.md) | Series de gestiones recurrentes (cobro diario) generadas como ocurrencias normales de la agenda |
| [`ia-dictado-clasificacion-y-vectores.md`](ia-dictado-clasificacion-y-vectores.md) | Dictado multi-tema, clasificación a campos, redacción enfocada y evaluación de vectorización |
| [`ia-memoria-y-contexto.md`](ia-memoria-y-contexto.md) | Memoria y contexto especializado: cómo la IA aprende de cada uso sin entrenar un modelo propio |
| [`estrategia-ia.md`](estrategia-ia.md) | Dónde puede entrar la IA, por módulo, con riesgos y hoja de ruta en tres etapas |
| [`ia-diseno-etapa-1.md`](ia-diseno-etapa-1.md) | Diseño detallado de la Etapa 1: base de IA, resumen del crédito, dictado en el teléfono, mapeo de importación, mensajes |
| [`ia-aprendizaje-efectividad.md`](ia-aprendizaje-efectividad.md) | Cómo Kobrax puede aprender qué manera de cobrar es más efectiva: medidas, datos que faltan, escalones y riesgos |
| [`ventaja-competitiva.md`](ventaja-competitiva.md) | Mapa frente a competidores, huecos de paridad, funciones que se usan en la práctica y perfiles de operación |

## Cómo usarlos según el objetivo

| Quiero… | Leer |
|---|---|
| Entender quién hace qué | 1 |
| Explicar el producto a un tercero | 2, 3, 4, 5, 6 (secciones «Propósito» y «Qué muestra») |
| Evaluar viabilidad técnica | 7, 8, 9 |
| Preparar una demo | 9, luego 4 y 6 |
| Escribir una postulación o propuesta | `docs/postulacion-india-bolivia/` (se apoya en estos documentos) |

## Hallazgos transversales (resumen)

Verificados por los agentes de auditoría; el detalle y la evidencia están en cada documento.

**Producto**
- 5 pestañas móviles sin filtrado por permisos; Importación y Mi cuenta las ven todos.
- Alcance por fila activo en aplicación solo para Mora, Agenda, Rutas y visitas; Cartera y Pagos muestran toda la cuenta; sin policies de alcance en RLS.
- Roles asignables por API: ADMIN, SUPERVISOR, COLLECTOR. MANAGER, AUDITOR y VIEWER existen pero no se asignan; overrides por usuario sin código; sin API de sucursales.
- Planes: bloquean usuarios, créditos y clientes; fotos y acciones solo avisan; la retención no se hace cumplir. Sin cambio de plan autoservicio.
- Importación: los modos RECONCILE/UPSERT_ONLY/REPLACE no tienen pantalla web; REPLACE se comporta como RECONCILE; la regla de ausentes «ask» no tiene UI.
- Pagos: sin reversión; sin pasarela real (el enlace de cobro apunta a `pay.kobrax.demo`).

**Acceso**
- Sin login con Google (el epic F9 lo prometía).
- Correos de invitación y de recuperación solo traen enlace `kobrax://` (móvil).
- Recuperar contraseña no tiene pantalla móvil; el cambio voluntario de contraseña no tiene entrada en el menú.

**Evidencia y offline**
- El hash SHA-256 lo calcula el servidor sobre la imagen ya comprimida; el móvil no hashea.
- Sin firma digital, sin push remoto registrado, sin interfaz de mapas offline, SSL pinning inactivo.
- Una visita registrada sin conexión no actualiza la parada localmente hasta sincronizar.

**Infraestructura**
- Fotos en disco local (sin driver S3/R2); SMS y email de notificaciones son stubs; WhatsApp solo por `wa.me`.
- Sin plantilla de importación, sin `eas.json`, sin script de restauración de respaldos.

## Cómo mantenerlos al día

1. Cambias una pantalla → actualizas su sección en el documento de web o móvil.
2. Cambias un permiso o un tope de plan → actualizas `roles-permisos-planes.md`.
3. Añades un endpoint o una regla → `backend-modulos-y-reglas.md`.
4. Añades una migración → `modelo-de-datos.md`.

Estas páginas se escribieron leyendo el código, no los planes. Los planes
(`docs/epics/`) describen la intención y varios están desactualizados; ver
`docs/postulacion-india-bolivia/05-pendientes-y-riesgos.md` §D.
