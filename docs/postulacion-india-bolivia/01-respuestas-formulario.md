# Respuestas del formulario — India–Bolivia Innovation Challenge 2026

> Área temática: **FinTech, Inclusión Financiera y Digitalización de las PyMEs**
> Cierre: **15 de octubre de 2026**. Cada respuesta indica su límite de palabras.
> Todo lo afirmado aquí está respaldado por código o documentos del repo
> (ver `02-dossier-tecnico.md`). Lo que no está medido, o aún no existe, se dice como tal.
> Posicionamiento actualizado según `resumen.md` (visión estratégica, octubre 2026).

---

## 0. Nombre de la propuesta

**Kobrax: cobranza en campo con evidencia verificable y decisiones guiadas por datos**

(Alternativa corta: *Kobrax — Plataforma inteligente de cobranzas para Bolivia*.)

---

## 1. ¿Qué problema o necesidad de Bolivia busca resolver y a quién afecta? (máx. 200 palabras)

En Bolivia, muchos prestamistas independientes, cooperativas y financieras pequeñas cobran con planillas, Excel y WhatsApp. Los sistemas existentes suelen ser institucionales y costosos, o solo registran pagos y visitas. El cobrador sale sin una ruta pensada, nadie ve la calle hasta que vuelve y, cuando el deudor dice «nunca me visitaron», no hay prueba. Y aunque se registren gestiones, casi nadie sabe qué funcionó: qué promesas se cumplen, qué visitas rinden, dónde se pierde tiempo.

Kobrax es una plataforma de cobranzas que funciona desde el celular, incluso sin internet. Importa la cartera en mora, ordena la ruta del día, registra cada visita con foto, GPS y una huella digital (SHA-256) inalterable, y da al supervisor un panel con la mora y el trabajo de cada cobrador. Su siguiente etapa es usar esos datos estructurados para asistir las decisiones: resumir historiales, señalar promesas incumplidas y, cuando haya datos suficientes, medir qué estrategias recuperan mejor. Esa capa de inteligencia artificial todavía no está implementada.

Afecta a cobradores y entidades que prestan, de un prestamista individual a una cooperativa, y a los deudores, que reciben un trato documentado. El plan gratuito permite empezar sin costo.

---

## 2. ¿Cuál es el impacto ambiental de su solución en comparación con las alternativas existentes? (máx. 200 palabras)

El impacto es positivo pero modesto, y todavía no está medido.

**Frente al papel:** las planillas de visita, los recibos y los reportes impresos se reemplazan por registros digitales; la foto de evidencia sustituye la copia impresa.

**Frente a la ruta improvisada:** Kobrax ordena las paradas del día con un motor de rutas propio (OSRM), lo que reduce kilómetros recorridos y combustible por jornada. Estimamos internamente que las rutas mal armadas consumen entre 10 % y 20 % de la jornada; es una estimación nuestra, no un dato verificado, y por eso proponemos medir el ahorro real durante un piloto comparando kilómetros planificados y recorridos.

**Frente a otros programas de software:** Kobrax opera con infraestructura pequeña (un servidor y almacenamiento de objetos). Como principio de diseño, usa reglas deterministas antes que modelos de IA y reserva la IA para donde aporte valor, lo que limita el consumo de cómputo.

No declaramos cifras de CO₂ porque aún no las hemos medido. Preferimos comprometernos con una medición honesta en el piloto antes que presentar un número que no podemos respaldar.

---

## 3. Adjunte su propuesta (opcional)

Adjuntar **un solo PDF** armado con `03-pitch-deck-guion.md` (11 láminas) y, si es posible, un enlace a un video de demostración de 2–3 minutos (guion incluido en el mismo archivo). El `04-one-pager.md` sirve como resumen de una hoja.

---

## Conteo de palabras

| Respuesta | Palabras | Límite |
|---|---|---|
| 1. Problema y a quién afecta | 192 | 200 |
| 2. Impacto ambiental | 176 | 200 |

Contadas el 2026-10-10. Si editas el texto, vuelve a contar: el formulario corta en 200.
