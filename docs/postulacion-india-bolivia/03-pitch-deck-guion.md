# Pitch deck y guion de demo — Kobrax

> Para convertir en PDF o presentación. 10 láminas, una idea por lámina, máximo
> 35 palabras de texto en pantalla por lámina. Lo marcado `[COMPLETAR]` necesita
> un dato que solo tú tienes; no se inventa.

## Láminas

### 1. Portada
**Kobrax** — Cobranza con evidencia, desde el celular, incluso sin internet.
India–Bolivia Innovation Challenge 2026 · FinTech e Inclusión Financiera
`[COMPLETAR]` nombre, contacto, ciudad.

### 2. El problema
Planilla de papel, Excel y WhatsApp.
- El cobrador sale sin ruta.
- Nadie ve la calle hasta que vuelve.
- «Nunca me visitaron»: no hay prueba.

### 3. A quién afecta
Cobradores independientes · cooperativas y financieras pequeñas · agencias de cobranza · y los deudores, que reciben un trato sin registro.
Los sistemas bancarios existentes están pensados para instituciones grandes.

### 4. La solución
Una plataforma, tres piezas: **app del cobrador** (offline), **panel web** del supervisor, **API** segura.
Importa la cartera, ordena la ruta, registra la visita con foto + GPS + huella digital.

### 5. Demo (captura o video)
Mostrar el recorrido: importar → mora → planificar ruta → visita con foto → panel. Ver guion abajo.

### 6. Por qué es distinto
- Evidencia inalterable (SHA-256).
- Offline-first.
- Del independiente a la financiera con el mismo producto.
- Aislamiento por cliente en la propia base de datos.

### 7. Estado y tracción — con honestidad
MVP funcional completo y desplegado (kobrax.ikigaisystems.lat): 20 módulos, panel de ~25 pantallas, app con 5 pestañas, 750 pruebas verdes en móvil. Datos de prueba, sin clientes reales todavía.
Siguiente: piloto con usuarios reales. `[COMPLETAR]` si hay cobradores o entidades dispuestas a probar (carta de intención, nombre, cantidad).

### 8. Modelo de negocio
Plan gratuito (1 cobrador, 20 créditos) → $12 por cobrador/mes → $99 + $10 por cobrador → empresa.
Infraestructura estimada: ≤11 % de lo facturado.

### 9. Impacto
- Social: acceso a herramientas profesionales para el prestamista pequeño; trato documentado al deudor.
- Ambiental: menos papel y rutas más cortas; **medición propuesta en el piloto** (sin cifras de CO₂ inventadas).

### 10. Expansión y conexión con la India — hipótesis a validar
La cobranza de campo sobre microcrédito y financieras pequeñas es una realidad también en India.
Líneas a explorar: adaptar a pagos interoperables (el equivalente local de nuestro QR de cobro), idioma y operación offline en zonas de baja conectividad.
`[COMPLETAR]` cualquier contacto real; si no existe, dejar la lámina como «exploración».

### 11. Pedido
Mentoría en inclusión financiera y salida a mercado, conexión con entidades de microcrédito y un piloto medible.
`[COMPLETAR]` qué necesitas exactamente (mentoría, piloto, financiamiento, monto).

---

## Guion de video de demo (2–3 minutos)

| Tiempo | Pantalla | Voz |
|---|---|---|
| 0:00–0:15 | Planilla de papel / Excel | «Así se cobra hoy en gran parte de Bolivia.» |
| 0:15–0:35 | Panel web: importar archivo de mora | «Importo la cartera del día; Kobrax detecta qué cambió.» |
| 0:35–0:55 | Central de mora y dashboard | «El supervisor ve la mora y prioriza.» |
| 0:55–1:20 | Planificador de rutas | «Arma la ruta del cobrador en el mapa y la publica.» |
| 1:20–2:00 | Móvil: ruta, parada, foto, GPS, resultado | «El cobrador visita, toma la foto y registra; todo queda sellado con su huella digital.» |
| 2:00–2:15 | Móvil en modo avión y luego sincroniza | «Sin internet sigue trabajando; al volver, sincroniza.» |
| 2:15–2:40 | Panel: visita con evidencia y mapa de visitas | «El supervisor ve la evidencia al instante.» |
| 2:40–3:00 | Cierre | «Kobrax: cobranza con evidencia, para quien presta en Bolivia.» |

Grabar con **datos sintéticos** (no el extracto real de Banco Unión de `docs/flows/`).
