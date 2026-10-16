# Inventario de evidencia — Kobrax

> **Fecha de captura:** 2026-10-13 · **Entorno:** https://kobrax.ikigaisystems.lat (demostración, `main` en `5e062fa`)
> **Cuenta usada:** gerente de demostración (`manager@kobrax.demo`), por el login real de la aplicación.
> **Datos:** ficticios del seed (`DEMO`); no se creó, editó ni borró ningún registro.
> **Entregable:** `kobrax-evidencia-producto.docx` (12 páginas) · originales en `screenshots/web/` · recortes del documento en `screenshots/web/recortes/`.
> **Móvil (React Native):** 8 capturas de un teléfono Android en `screenshots/movil/`; ver §3.

---

## 1. Lo que entra en el documento Word

| Fig. | Flujo | Módulo · pantalla | Plataforma | Original | Qué se verificó |
|---|---|---|---|---|---|
| 1 | Portada | Inicio · dashboard | Web | `01_inicio_dashboard.png` | Saldo de cartera Bs 88.536, cartera en mora Bs 57.341 (64,8 %), 13 créditos en mora, recaudado Bs 2.085, agenda de hoy y cartera por días de mora |
| 2 | 1 · Cartera | Cartera · filtros abiertos | Web | `02_cartera_filtros_abiertos.png` | Panel de filtros (responsable, sucursal, rango de mora, estado, rango de deuda, fuente) y lista de 25 clientes con deuda y días de mora |
| 3 | 1 · Cartera | Cartera · ficha del cliente | Web | `03_cartera_cliente_detalle.png` | Identificación, **perfil de ingreso**, créditos con avance de pago, contactos y direcciones ocultos con «Mostrar», bitácora, garantes y garantías |
| 4 | 2 · Mora | Mora · ficha del crédito `CRD-DEMO-0001` | Web | `04_mora_credito_ficha.png` | Saldo Bs 7.811,18, 47 días de mora, promesa vigente, responsables (responsable, ayuda, reemplazo temporal), panel de recuperación (Bs 150 recuperados, 16 gestiones, promesas 1 de 2) |
| 5 | 2 · Mora | Mora · registrar gestión | Web | `05_mora_registrar_gestion_modal.png` | Formulario con **motivo de no pago** y **quién responde** (opcional). Se abrió, se eligieron valores y se **canceló**: no se guardó |
| 6 | 3 · Trabajo del día | Agenda · día | Web | `07_agenda_dia.png` | Gestión vencida resaltada; gestiones del 13 de octubre por hora; 6 pendientes, 3 completadas |
| 7 | 3 · Trabajo del día | Rutas · detalle de ruta | Web | `08_rutas_ruta_con_mapa.png` | Ruta de Carlos Collector en curso: Bs 380 recaudados, 2 de 4 gestionadas, 12,4 km, siguiente parada, mapa con paradas numeradas, créditos cercanos |
| 8 | 4 · Trazabilidad | Rutas · parada visitada · Historial | Web | `10_parada_dab5.png` | Resultado «Pagó», GPS −16,54090 / −68,08400, precisión ± 9,5 m, nota del cobrador; «una visita y su evidencia no se editan ni se borran» |
| 9 | 4 · Trazabilidad | Rutas · parada · Evidencias (recorte) | Web | `11_parada_evidencias.png` | Huella SHA-256 del archivo original |
| 10 | 4 · Trazabilidad | Mora · pagos del crédito | Web | `06_mora_pagos_del_credito.png` | 10 pagos, Bs 2.798 cobrados por Kobrax, con medio, comprobante y quién registró |
| 11 | 5 · Operación | Import · historial | Web | `09_import_historial.png` | 4 corridas con nuevos, actualizados, volvieron, al día, ausentes, rechazadas e ignoradas |

**Criterio de selección** (según lo pedido): la primera pantalla de cada módulo suele ser una tabla, así que **solo el primer flujo muestra los filtros abiertos**; en los demás se eligió la pantalla con más datos (ficha, ruta, historial).

---

## 2. Inventario completo de módulos web

Recorrido con Playwright sobre la sesión de gerente. «Explorado» = se abrió y se leyó su contenido; «Capturado» = entra en el Word.

| Módulo | Ruta | Estado | Qué hay (verificado en pantalla) |
|---|---|---|---|
| Inicio | `/dashboard` | Capturado (fig. 1) | Panel **configurable** (botón Editar → añadir widget). Tipos disponibles: KPI, dona, barras, tabla, mapa, lista, líneas, calendario, embudo, medidor, histograma y texto. Embudo, medidor, histograma y texto aparecen «sin datos aún». Filtros: período, cobrador, fuente, prioridad. Widgets sembrados: agenda de hoy, carga del equipo, cartera por días de mora, mora por rango, agenda del período, indicadores de gestión, cartera por cobrador, mapa de visitas, evolución |
| Cartera | `/cartera` | Capturado (fig. 2, 3) | 25 clientes; búsqueda; filtros; columnas; «Nuevo cliente»; ficha `/cartera/:id` |
| Import | `/import` | Capturado (fig. 11) | Subida de archivo, historial de importaciones con detalle por corrida |
| Import · Ajustes | `/import/ajustes` | Explorado | «Configurá tu importación»: archivo de muestra, columnas, reglas, datos del reporte, asesores, reinicio a configuración de fábrica, «Probar sin importar» |
| Mora | `/mora` | Explorado (lista) y capturado (ficha, fig. 4, 5, 10) | 13 créditos con situación, saldo, vencido, mora, **prioridad editable** (Crítica / Alta / Media / Baja, o volver a la automática), responsable y última gestión; Exportar CSV y PDF |
| Agenda | `/agenda` | Capturado (fig. 6) | Vistas Día / Semana / Mes, mini-calendario, filtros, resumen del día, vencidas, «Nueva tarea» |
| Rutas | `/rutas` | Explorado (lista) y capturado (detalle, fig. 7, 8, 9) | Pestañas Hoy / Historial; tablero por cobrador (cobrador, estado, paradas, progreso, recaudado); acciones de la ruta (completar, optimizar orden, cancelar, descargar PDF) |
| Rutas · Planificar | `/rutas/planificar` | Explorado | Elegir día (hoy, mañana, +7 días) y cobradores con su carga, mínimo de paradas; avisa cuando un cobrador ya tiene ruta ese día |
| Pagos | `/pagos` | Explorado | 8 pagos por Bs 2.627,94 con fecha, monto, medio, fuente, quién registró, comprobante; «Registrar un pago» |
| Pagos · Solicitudes | `/pagos/solicitudes` | Explorado | Muestra el mismo listado de pagos; **no se distinguió una pantalla propia** |
| Pagos · Nueva solicitud | `/pagos/solicitudes/nueva` | No verificado | La página cargó sin contenido reconocible en el recorrido automático |
| Equipo | `/equipo` | Explorado | «16 de 25 miembros» con rol y estado (administrador, gerente, supervisor, cobradores) |
| Cuenta | `/cuenta` | Explorado | Plan **Professional** con consumo (miembros 16/25, créditos 20/1000, clientes 25/1000, fotos 7/5000, gestiones 24/2500); datos del negocio, zona horaria, país y moneda (BOB), cómo se cuenta la mora, categorías de mora A/B/C con rangos, 3 plantillas de WhatsApp |
| Exportar | `/exportar` | Explorado | Enlaces de exportación: clientes, ubicaciones, mora, agenda y respaldo. **No se descargó ningún archivo** |
| Mi perfil | `/settings/perfil` | Explorado | Preferencias (idioma es/en) y seguridad |
| Seguridad · Sesiones | `/settings/security`, `/settings/security/sessions` | Explorado | Sesiones activas, «Cerrar todas las demás» |

---

## 3. Aplicación móvil (React Native)

Capturas tomadas por la usuaria en un teléfono Android el 13 oct 2026 (cuenta de gerente de demostración, APK 1.1.0). Originales sin recorte: `E:\kobrax\movil` (17 imágenes); las 8 elegidas están copiadas en `screenshots/movil/`.

| Fig. | Archivo | Pantalla | Por qué se eligió |
|---|---|---|---|
| M1 | `m01_inicio.jpeg` | Inicio | Progreso del día, KPIs, aviso de verificación en dos pasos, agenda de hoy |
| M2 | `m02_agenda.jpeg` | Agenda | Calendario semanal, filtro por tipo (llamada, visita, WhatsApp…), vencidos, «Asignada por» |
| M3 | `m03_ruta_crear_mapa.jpeg` | Crear ruta | Pin por ubicación, selector de día, clientes sin ubicación |
| M4 | `m04_cartera.jpeg` | Cartera | Contadores, categoría de mora, castigado, fuente PSF |
| M5 | `m05_cartera_filtros.jpeg` | Filtros | Mora, saldo, fuente, categoría, prioridad |
| M6 | `m06_importacion.jpeg` | Importación | Origen, alcance, forma del archivo (tabla en PDF), reglas |
| M7 | `m07_seguridad.jpeg` | Seguridad | Cambiar contraseña, segundo factor, sesiones activas |
| M8 | `m08_miembros.jpeg` | Equipo | Roles y límite 16 de 25 |

**Descartadas** (duplicadas o de poco valor): Inicio desplazado, Agenda desplazada, selector de fecha, «Sin ruta para hoy», orden de la cartera, menú Más (plegado y desplegado) y Mi cuenta. El menú Más desplegado sirve si se quiere mostrar «Importar datos / Reglas / Historial».

**Funciones verificadas en el código** (sin captura): ingreso con biometría, recuperar contraseña, registro e invitación, invitar miembros con rol; cliente con varios teléfonos, ubicaciones y red de garantes/familiares/vecinos; crédito en 3 modalidades (calcular cuotas, cuota acordada, total acordado) con interés simple/compuesto, cargos y cuotas ya pagadas; importación en 3 formas (CSV/Excel, tabla en PDF, extracto PDF) con prueba previa; resultado de visita (cobrado, promesa, no contesta, sin contacto, dirección incorrecta, especial); cambio de dirección de una parada; cola sin conexión. Referencias: `apps/mobile/src/credit-labels.ts`, `apps/mobile/src/cliente-form-view.tsx`, `apps/mobile/src/import.service.ts`, `apps/mobile/src/visit-result.ts`, `apps/mobile/src/route-stop-location.ts`.

**Sigue pendiente:** recorrido en campo con capturas de visita (foto, GPS, cobro) y de modo sin conexión.

---

## 4. Hallazgos técnicos durante la captura

Son observaciones; **no se modificó código**.

| # | Hallazgo | Dónde | Gravedad |
|---|---|---|---|
| 1 | Errores de React #425 y #422 en la consola del navegador (desajuste entre el HTML del servidor y el del cliente; React vuelve a renderizar en el cliente). Las pantallas se ven bien | `/mora/:id`, `/rutas/:id`, `/import` | Media: no rompe nada visible, pero cuesta rendimiento. Hipótesis sin verificar: fechas formateadas con la zona horaria del servidor |
| 2 | El trazado de la ruta por calles no se calcula: la pantalla avisa «No pudimos calcular el recorrido. Las paradas se ven igual» | `/rutas/:id` | Baja: la pantalla lo comunica; falta el servicio de ruteo en producción |
| 3 | El widget «Mapa de visitas» del tablero aparece vacío en la captura (la leyenda sí dice 5 visitadas y 5 pendientes) | `/dashboard` | A revisar: puede ser del navegador sin gráficos del equipo de captura |
| 4 | La «foto» de evidencia de la demostración es un cuadro negro (marcador del seed) | `/rutas/:id/parada/:sid` · Evidencias | Baja: solo es dato de demostración |
| 5 | Banner «Protege tu cuenta: activa la verificación en dos pasos» visible en Inicio con la cuenta de gerente | `/dashboard` | Informativa |
| 6 | La carga del tablero no llega a «network idle» (se mantiene una conexión abierta); se resolvió esperando elementos y no la red | `/dashboard` | Informativa |

---

## 5. Comandos y pruebas ejecutadas

| Paso | Cómo |
|---|---|
| Herramientas | `playwright-core` instalado en un directorio temporal (el repo no trae Playwright ni tests E2E); Chrome del sistema |
| Auditoría del repo | Lectura de `apps/web`, `apps/mobile`, `docs/producto/`, `docs/design-system.md` y `docs/postulacion-india-bolivia/` |
| Login | Formulario real de `/login` con la cuenta de demostración; sin saltarse ningún control |
| Exploración | Recorrido de las 11 rutas del inventario y 8 subpantallas; lectura de títulos, botones, secciones y enlaces |
| Capturas | Viewport 1440 px; alto ajustado al contenido (máx. 2.200 px); espera de carga antes de cada captura; revisión visual de cada imagen |
| Interacciones | Abrir el panel de filtros de Cartera; abrir una ficha; abrir el formulario de gestión y **cancelarlo**; expandir la sección de pagos; cambiar de pestaña en una parada |
| Datos | Solo lectura. **Ningún registro fue creado, editado ni borrado** |
| Documento | `docx` (Node) → Word → exportado a PDF solo para revisar la maquetación (6 páginas) |
| Código | Sin cambios en código de producción ni commits |
