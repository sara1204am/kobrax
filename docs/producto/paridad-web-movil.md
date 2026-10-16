# Paridad web ↔ móvil — Kobrax

> **Fecha:** 2026-10-13 · **Base:** `main` en `5e062fa`
> **Cómo se armó:** inventario de rutas de `apps/web/src/app` y `apps/mobile/app`, más lectura de los componentes clave. **No se ejecutó** cada pantalla: una celda ✅ significa «existe en el código», no «validada en un dispositivo».
> **Mantenimiento:** se actualiza en el mismo PR que añade o quita una capacidad en cualquiera de las dos.

Leyenda: ✅ completo · 🟡 parcial / versión simple · — no existe · 🎯 destino recomendado (dónde debe vivir)

## 1. Acceso y cuenta

| Capacidad | Web | Móvil | 🎯 | Nota |
|---|---|---|---|---|
| Ingreso con correo y contraseña | ✅ | ✅ | Ambos | |
| Segundo factor (TOTP, QR, códigos de respaldo) | ✅ | ✅ | Ambos | |
| Biometría para desbloquear | — | ✅ | Móvil | Propio del teléfono |
| Recuperar / restablecer contraseña | ✅ | 🟡 | Ambos | El móvil pide el correo; el restablecimiento se completa con el enlace |
| Crear cuenta e invitación | ✅ | ✅ | Ambos | |
| Elegir cuenta (multi-cuenta) | ✅ | ✅ | Ambos | |
| Cambiar contraseña y sesiones activas | ✅ | ✅ | Ambos | |
| Perfil y preferencias (idioma) | ✅ | ✅ | Ambos | |
| Invitar miembros y asignar rol | ✅ | ✅ | Web | El móvil funciona; no invertir más |
| Lista de miembros y su detalle | ✅ | ✅ | Web | |
| Datos del negocio y plan con consumo | ✅ | 🟡 | Web | El móvil muestra datos; no edita con rol de gerente |
| Categorías de mora, plantillas de WhatsApp | ✅ | — | Web | Configuración |

## 2. Cartera y clientes

| Capacidad | Web | Móvil | 🎯 | Nota |
|---|---|---|---|---|
| Lista con búsqueda, contadores y filtros | ✅ | ✅ | Ambos | El móvil agrega orden por próximo vencimiento |
| Filtro por responsable y sucursal | ✅ | — | Web | Es de supervisión |
| Columnas configurables y exportación | ✅ | — | Web | |
| Ficha del cliente (identificación, ingreso, créditos, bitácora) | ✅ | ✅ | Ambos | |
| Alta y edición de cliente | ✅ | ✅ | Ambos | El móvil con aviso de duplicado |
| Varios teléfonos y ubicaciones con punto en el mapa | ✅ | ✅ | Ambos | |
| Red de contactos (garantes, familiares, vecinos) | ✅ | ✅ | Ambos | Verificar que la web iguale los tipos de relación |
| Garantías y adjuntos del legajo | ✅ | ✅ | Ambos | |
| Contactos protegidos con «Mostrar» | ✅ | ? | Ambos | Por verificar en móvil |

## 3. Créditos y pagos

| Capacidad | Web | Móvil | 🎯 | Nota |
|---|---|---|---|---|
| Alta de crédito (3 modalidades, cargos, plan de pagos) | ✅ | ✅ | Ambos | Rutas: `cartera/[id]/prestamo` y `prestamo/nuevo` |
| Crédito ya en curso (cuotas pagadas, saldo, mora) | ✅ | ✅ | Ambos | |
| Ficha del crédito y cronograma | ✅ | ✅ | Ambos | |
| Registrar un pago | ✅ | ✅ | Ambos | |
| Lista de pagos del día y detalle | ✅ | 🟡 | Web | El móvil consulta por día y por crédito |
| Cobro con QR de la cuenta del cobrador | — | ✅ | Móvil | |
| Solicitudes de pago (bandeja «por confirmar») | ✅ | — | Web | `/pagos/solicitudes` lista lo pendiente; la API tiene `GET /payment-requests` |

## 4. Mora y gestión

| Capacidad | Web | Móvil | 🎯 | Nota |
|---|---|---|---|---|
| Central de mora con situación, saldo y días | ✅ | ✅ | Ambos | |
| Filtros: mora, saldo, fuente, categoría, prioridad | ✅ | ✅ | Ambos | |
| Prioridad editable (manual o automática) | ✅ | ? | Web | Por verificar si el móvil la edita |
| Acciones masivas sobre créditos | ✅ | — | Web | |
| Registrar gestión con resultado y promesa | ✅ | ✅ | Ambos | |
| Motivo de no pago y quién responde | ✅ | ✅ | Ambos | |
| Notas con tipo y color | ✅ | ✅ | Ambos | |
| Responsables (ayuda y reemplazo temporal) | ✅ | ? | Web | |
| Exportar mora (CSV, PDF) | ✅ | — | Web | |

## 5. Agenda

| Capacidad | Web | Móvil | 🎯 | Nota |
|---|---|---|---|---|
| Día | ✅ | ✅ | Ambos | |
| Semana y mes | ✅ | 🟡 | Ambos | El móvil: tira de la semana y selector de fecha |
| Tipos: llamada, visita, WhatsApp, recordatorio, promesa | ✅ | ✅ | Ambos | |
| Crear tarea | ✅ | ✅ | Ambos | |
| Asignar a otro cobrador | ✅ | — | Web | El móvil muestra «Asignada por…» |
| Recordatorios en el teléfono | — | ✅ | Móvil | |
| Detalle con ubicación y mapa | ✅ | ✅ | Ambos | |

## 6. Rutas y visitas

| Capacidad | Web | Móvil | 🎯 | Nota |
|---|---|---|---|---|
| Planificar rutas de varios cobradores y días | ✅ | — | Web | |
| Armar la ruta propia del día (automática o desde el mapa) | — | ✅ | Móvil | |
| Optimizar el orden de paradas | ✅ | ✅ | Ambos | |
| Elegir qué ubicación visitar (cliente, garante, familiar) | ✅ | ✅ | Ambos | |
| Cambiar la dirección de una parada | ✅ | ✅ | Ambos | |
| Pedir y aprobar cambios de ruta | ✅ | ✅ | Ambos | |
| Registrar resultado de la visita con GPS y foto | 🟡 | ✅ | Móvil | La web muestra el resultado y la evidencia; el móvil la captura |
| Huella SHA-256 de la evidencia | ✅ | ✅ | Ambos | La web la muestra; el móvil la genera |
| Mapa con paradas numeradas y créditos cercanos | ✅ | ✅ | Ambos | |
| Mapas descargables sin señal | — | ✅ | Móvil | |
| Historial y resumen de la jornada | ✅ | ✅ | Ambos | |
| Descargar la ruta en PDF | ✅ | — | Web | |

## 7. Importación

| Capacidad | Web | Móvil | 🎯 | Nota |
|---|---|---|---|---|
| Subir archivo (CSV/Excel, tabla en PDF, extracto PDF) | ✅ | ✅ | Web | Archivos grandes se manejan mejor desde el escritorio |
| Configurar forma, alcance, columnas y reglas | ✅ | ✅ | Web | Duplicado; el móvil es versión simple |
| Probar sin importar | ✅ | ✅ | Ambos | |
| Vista previa y resultado de la corrida | ✅ | ✅ | Ambos | |
| Historial de importaciones | ✅ | ✅ | Ambos | |

## 8. Operación y análisis

| Capacidad | Web | Móvil | 🎯 | Nota |
|---|---|---|---|---|
| Tablero configurable (KPI, dona, barras, mapa, etc.) | ✅ | — | Web | |
| Inicio del cobrador (progreso del día) | — | ✅ | Móvil | |
| Exportación CSV (clientes, ubicaciones, mora, agenda) y respaldo | ✅ | — | Web | |
| Notificaciones | ✅ | ✅ | Ambos | Push: faltan llaves Firebase |
| Trabajo sin conexión y cola de pendientes | — | ✅ | Móvil | |

## 9. Lectura rápida

- **Solo web (supervisión y configuración):** tablero, exportación, planificación multi-cobrador, acciones masivas, plantillas y categorías.
- **Solo móvil (campo):** biometría, ruta propia del día, cobro con QR, mapas sin señal, cola sin conexión, captura de la visita.
- **Duplicado sin motivo claro:** configuración de importación, invitación de miembros y datos del negocio. Son candidatos a quedarse como «versión simple» en el móvil.
- **Por verificar (?):** prioridad editable y responsables de la mora en el móvil; contactos protegidos con «Mostrar»; qué tan completa es la vista de Semana y Mes.

## 10. Reglas de mantenimiento

1. Una capacidad nueva con **configuración o varios usuarios** nace en web; el móvil solo la consume.
2. Una capacidad nueva de **campo o sin conexión** nace en móvil; la web la muestra.
3. Los nombres de campos y estados salen de `@kobrax/shared`; no se redefinen en cada app.
4. Cada PR que cambia una fila actualiza este documento.
