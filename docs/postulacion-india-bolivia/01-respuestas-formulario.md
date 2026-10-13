# Respuestas del formulario — India–Bolivia Innovation Challenge 2026

> Área temática: **FinTech, Inclusión Financiera y Digitalización de las PyMEs**
> Cierre: **15 de octubre de 2026**. Cada respuesta indica su límite de palabras.
> Todo lo afirmado aquí está respaldado por código o documentos del repo
> (ver `02-dossier-tecnico.md`). Lo que no está medido se dice como tal.

---

## 1. ¿Qué problema o necesidad de Bolivia busca resolver y a quién afecta? (máx. 200 palabras)

En Bolivia, muchos prestamistas independientes, cooperativas y financieras pequeñas cobran sus créditos con planillas de papel, Excel y WhatsApp. El cobrador sale a la calle sin una ruta pensada, nadie sabe qué ocurre en terreno hasta que vuelve, y cuando el deudor afirma «nunca me visitaron» no existe prueba. Esto encarece el crédito, aumenta la mora y deja a los pequeños prestamistas sin las herramientas que sí tienen los bancos, que son costosas y están pensadas para ellos.

Kobrax es una plataforma de gestión de cobranzas que funciona desde el celular, incluso sin internet. Importa la cartera en mora, organiza las visitas del día en una ruta, registra cada visita con foto, GPS y una huella digital (SHA-256) que no puede alterarse, y ofrece al supervisor un panel con la mora y el trabajo de cada cobrador.

Afecta, en primer lugar, a los cobradores de campo y a las entidades que prestan, desde un prestamista individual hasta una cooperativa. También a los deudores, que pasan a recibir un trato documentado y no arbitrario. El plan gratuito permite que un cobrador independiente empiece sin costo.

---

## 2. ¿Cuál es el impacto ambiental de su solución en comparación con las alternativas existentes? (máx. 200 palabras)

El impacto es positivo pero modesto, y todavía no está medido.

**Frente al papel:** las planillas de visita, los recibos y los reportes impresos se reemplazan por registros digitales; la foto de evidencia sustituye la copia impresa.

**Frente a la ruta improvisada:** Kobrax ordena las paradas del día con un motor de rutas propio (OSRM), lo que reduce kilómetros recorridos y combustible por jornada. Estimamos internamente que las rutas mal armadas consumen entre 10 % y 20 % de la jornada; es una estimación nuestra, no un dato verificado, y por eso proponemos medir el ahorro real durante un piloto comparando kilómetros planificados y recorridos.

**Frente a otros programas de software:** Kobrax está diseñado para operar con infraestructura pequeña (un servidor y almacenamiento de objetos), sin necesidad de grandes centros de datos propios.

No declaramos cifras de CO₂ porque aún no las hemos medido. Preferimos comprometernos con una medición honesta en el piloto antes que presentar un número que no podemos respaldar.

---

## 3. Adjunte su propuesta (opcional)

Adjuntar **un solo PDF** armado con `03-pitch-deck-guion.md` (10–11 láminas) y, si es posible, un enlace a un video de demostración de 2–3 minutos (guion incluido en el mismo archivo). El `04-one-pager.md` sirve como resumen de una hoja.

---

## Conteo de palabras

| Respuesta | Palabras | Límite |
|---|---|---|
| 1. Problema y a quién afecta | 184 | 200 |
| 2. Impacto ambiental | 162 | 200 |

Contadas el 2026-10-09. Si editas el texto, vuelve a contar: el formulario corta en 200.
