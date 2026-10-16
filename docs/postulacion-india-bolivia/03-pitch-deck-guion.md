# Pitch deck y guion de demo — Kobrax

> Para convertir en PDF o presentación. 11 láminas, una idea por lámina, máximo
> 35 palabras de texto en pantalla por lámina. Lo marcado `[COMPLETAR]` necesita
> un dato que solo tú tienes; no se inventa.
>
> **Cambio de enfoque (según `resumen.md`):** antes el relato era «cobranza con evidencia,
> offline». Ahora es **de gestionar cobranzas a mejorar las decisiones de recuperación**.
> La parte de inteligencia se presenta como **hoja de ruta**, nunca como producto ya
> funcionando. Offline y rutas dejan de ser el diferencial (la competencia también los tiene).

## Láminas

### 1. Portada
**Kobrax** — De gestionar cobranzas a mejorar las decisiones de recuperación.
India–Bolivia Innovation Challenge 2026 · FinTech e Inclusión Financiera
`[COMPLETAR]` nombre, contacto, ciudad.

### 2. El problema
Papel, Excel y WhatsApp. Y aunque se registre, **no se sabe qué funcionó**.
- Sin ruta; nadie ve la calle.
- «Nunca me visitaron»: sin prueba.
- ¿Qué promesas se cumplen? ¿Qué visita rinde?

### 3. A quién afecta
Cobradores independientes · cooperativas y financieras pequeñas · agencias de cobranza · y los deudores, que reciben un trato sin registro.
Los sistemas institucionales son costosos y pensados para entidades grandes.

### 4. La solución hoy
Una plataforma, tres piezas: **app del cobrador** (offline), **panel web**, **API** segura.
Importa la cartera, ordena la ruta, registra la visita con foto + GPS + huella digital y guarda promesas y resultados de forma estructurada.

### 5. Demo (captura o video)
Importar → mora → planificar ruta → visita con foto → panel. Ver guion abajo.

### 6. El mercado y la brecha — con honestidad
Ya existen soluciones: bancarias (BDP Recupera, Fortaleza, CIRRUS) con segmentación, y SaaS de ruta desde USD 6–28/mes (CarteraGo, AtllasPay).
La brecha que exploramos: **convertir los datos de cobranza en decisiones**, a un costo accesible.

### 7. Por qué es distinto
- Evidencia inalterable (SHA-256).
- Mismo producto del independiente a la financiera.
- Aislamiento por cliente en la propia base de datos.
- Mora como episodios: datos listos para analizar.

### 8. De registrar a decidir — hoja de ruta
1. Registrar ✅ · 2. Automatizar 🟡 · 3. Asistir con IA (resumen, dictado) · 4. Medir qué estrategia funciona · 5. Recomendar, con supervisión humana.
**Hoy: etapas 1–2. La IA analítica aún no está implementada.**

### 9. Estado y tracción — con honestidad
MVP funcional desplegado (kobrax.ikigaisystems.lat): 20 módulos, ~25 pantallas web, app de 5 pestañas, 916 pruebas móvil. Datos de prueba; sin clientes reales aún.
`[COMPLETAR]` piloto: entidad, cantidad.

### 10. Modelo, impacto y expansión
Gratis (1 cobrador) → $12 por cobrador/mes → empresa. Infraestructura ≤11 % de lo facturado.
Impacto ambiental: **a medir en el piloto**. India: exploración en microcrédito de campo. `[COMPLETAR]` contacto real.

### 11. Pedido
Mentoría en inclusión financiera e IA aplicada a cobranza, conexión con entidades de microcrédito y un piloto medible.
`[COMPLETAR]` qué necesitas exactamente (mentoría, piloto, financiamiento, monto).

---

### Lámina de innovación — «Del dato a la decisión» (versión final, 2026-10-13)
Fondo azul oscuro, tres tarjetas blancas, una etiqueta de estado por tarjeta y máximo tres ideas cada una.
El detalle, los límites de caracteres y la verificación contra el repo están en `06-diapositivas-verificacion-y-mejoras.md`.

| ENTENDER · *Disponible · en validación* | DESCUBRIR · *Siguiente paso* | RECOMENDAR · *Visión futura* |
|---|---|---|
| Registramos por qué no pagó, de qué vive y cómo cobrarle. | Hoy: mejor horario por deudor y rendimiento por cobrador. | Sugiere cuándo contactar, por qué canal y con qué mensaje. |
| Alertas de promesas, cuotas y vencidas; prioridad de mora automática. | Con datos de pilotos: qué gestión, horario y zona cumple más. | El cobrador o supervisor aprueba, ajusta o descarta. |
| Siguiente: resumen del crédito y dictado por voz. | Después: alerta temprana de créditos de alto riesgo. | Si la IA falta, se usa la regla: nunca es requisito. |

**Pie:** «Primero estructuramos los datos. Después descubrimos patrones. Finalmente, recomendamos mejores decisiones.»
*Siempre decide una persona.*

---

## Guion de video de demo (2–3 minutos)

Mostrar **solo lo que existe**. La inteligencia se menciona como siguiente etapa, sin simularla en pantalla.

| Tiempo | Pantalla | Voz |
|---|---|---|
| 0:00–0:15 | Planilla de papel / Excel | «Así se cobra hoy en gran parte de Bolivia.» |
| 0:15–0:35 | Panel web: importar archivo de mora | «Importo la cartera del día; Kobrax detecta qué cambió.» |
| 0:35–0:55 | Central de mora y ficha de un crédito (historial, promesas) | «El supervisor ve la mora y, por crédito, qué se hizo y qué se prometió.» |
| 0:55–1:20 | Planificador de rutas | «Arma la ruta del cobrador en el mapa y la publica.» |
| 1:20–2:00 | Móvil: ruta, parada, foto, GPS, resultado | «El cobrador visita, toma la foto y registra; todo queda sellado con su huella digital.» |
| 2:00–2:15 | Móvil en modo avión y luego sincroniza | «Sin internet sigue trabajando; al volver, sincroniza.» |
| 2:15–2:35 | Panel: visita con evidencia y mapa de visitas | «Cada gestión queda estructurada: resultado, promesa, evidencia.» |
| 2:35–3:00 | Cierre (lámina 8) | «Estos datos son la base: el siguiente paso es ayudar a decidir qué hacer en cada caso.» |

Grabar con **datos sintéticos** (no el extracto real de Banco Unión de `docs/flows/`).
