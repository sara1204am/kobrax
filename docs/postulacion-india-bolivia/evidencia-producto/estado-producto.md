# Estado del producto — Kobrax (2026-10-13)

> Qué está **verificado en la plataforma desplegada**, qué es **parcial** y qué es **futuro**.
> Regla: si algo no se vio funcionando o no consta en el código como implementado, no se afirma.
> Marcas del Word: ● visto en captura · ○ solo en código con pruebas.
> Fuentes: recorrido con Playwright sobre https://kobrax.ikigaisystems.lat (13 oct 2026), `main` en `5e062fa`, y `docs/postulacion-india-bolivia/02-dossier-tecnico.md`.

Leyenda: ✅ verificado en pantalla · 🟡 parcial o con límite · 📝 solo planeado

---

## 1. Verificado (✅)

| Capacidad | Evidencia |
|---|---|
| **Cartera**: lista de clientes con deuda, mora y estado; filtros por responsable, sucursal, rango de mora, estado, deuda y fuente | Fig. 2 |
| **Ficha del cliente**: identificación, perfil de ingreso, créditos con avance de pago, contactos y direcciones protegidos, bitácora, garantes y garantías | Fig. 3 |
| **Central de mora**: créditos en mora con situación, saldo, vencido, días de mora, responsable, última gestión y **prioridad editable** | Lista `/mora` |
| **Ficha del crédito**: saldo, datos clave, responsables (ayuda y reemplazo temporal), recuperación, gestiones, promesas, notas, pagos e historial de mora | Fig. 4, 10 |
| **Registro de gestiones con motivo de no pago y quién responde** (opcional) | Fig. 5 |
| **App móvil del cobrador** instalada en un teléfono Android: Inicio, Agenda, Rutas, Cartera, filtros, Importación, Seguridad y Equipo | Fig. M1–M8 (capturas del 13 oct 2026) |
| **Agenda** por día, semana y mes, con vencidas, filtros y «Nueva tarea» | Fig. 6 |
| **Planificación de rutas** por cobrador y día; **ruta** con paradas numeradas sobre el mapa, recaudo y avance | Fig. 7 |
| **Visita con GPS, precisión, nota y huella SHA-256**; «una visita y su evidencia no se editan ni se borran» | Fig. 8, 9 |
| **Pagos** con medio, comprobante y quién registró; ligados al crédito | Fig. 10, lista `/pagos` |
| **Importación de cartera** con historial por corrida y ajustes de columnas y reglas | Fig. 11, `/import/ajustes` |
| **Tablero configurable** con KPI, dona, barras, tabla, lista, líneas y calendario | Fig. 1 |
| **Equipo y roles**, **plan con consumo**, categorías de mora, plantillas de WhatsApp | `/equipo`, `/cuenta` |
| **Exportación** a CSV (clientes, ubicaciones, mora, agenda) y respaldo | `/exportar` (enlaces; no se descargó) |
| **Idioma** español / inglés y **sesiones activas** | `/settings/perfil`, `/settings/security/sessions` |

---

## 2. Parcial o con límites (🟡)

| Capacidad | Qué falta o qué límite tiene |
|---|---|
| **Trabajo sin conexión** (cola local, fotos en cola, sincronización sin duplicados, mapas descargables) | Implementado y con pruebas automatizadas; **sin validar en campo** con señal intermitente |
| **Alta de crédito desde el móvil** (3 modalidades, cuotas ya pagadas, cargos) | En el código; sin captura ni validación en teléfono |
| **Captura de evidencia en la visita móvil** (foto, GPS, huella) | En el código; sin captura. La app no captura firma |
| **Trazado de la ruta por calles** | La pantalla avisa «No pudimos calcular el recorrido»; las paradas se ven igual. Falta el servicio de ruteo en producción |
| **Mapa de visitas del tablero** | Apareció vacío en la captura; por verificar |
| **Widgets del tablero**: embudo, medidor, histograma, texto | Se pueden añadir pero muestran «sin datos aún» |
| **Conservación de fotos por plan** (6 / 24 / 60 meses) | La cifra se muestra en el plan; el repo no tiene un proceso que la aplique |
| **Notificaciones push** | Código presente; faltan el proyecto Firebase y las llaves |
| **Cambio de plan** | Lo hace el equipo de Kobrax; no es autoservicio |
| **Pantalla de «Solicitudes de pago»** | No se distinguió de la lista de pagos; la de «nueva solicitud» no se pudo verificar |
| **Motivo de no pago en la visita de ruta del móvil** | Implementado en el código; sin validar en teléfono |
| **Rendimiento web** | Errores de hidratación de React en `/mora/:id`, `/rutas/:id` e `/import` (no visibles para el usuario) |

---

## 3. Futuro (📝)

No existe hoy y **no debe presentarse como terminado**:

| Capacidad | Condición |
|---|---|
| Resumen del crédito y dictado por voz a gestión | Siguiente paso de la hoja de ruta |
| Análisis de qué gestión, horario y zona funciona mejor | Requiere volumen de datos (pilotos) y el catálogo de zonas |
| Alerta temprana de créditos de alto riesgo | Después del análisis |
| Recomendación de la siguiente acción (cuándo, por qué canal, con qué mensaje) | Visión; siempre la aprueba una persona |

**Lo que sí existe como base para ese futuro:** cada gestión guarda datos estructurados (resultado, promesa, motivo de no pago, quién responde, plantilla elegida) y el cliente tiene perfil de ingreso y de cobro. La «hora recomendada» y la prioridad de mora son **reglas**, no un modelo de inteligencia artificial.
