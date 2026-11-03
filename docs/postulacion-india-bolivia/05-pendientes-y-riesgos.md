# Pendientes y riesgos antes de enviar (cierre: 15 de octubre de 2026)

> Actualizado el 2026-10-10 con las conclusiones de `resumen.md` y el estado real del código.

## A. Datos que solo tú puedes aportar (no se inventan)

1. **Datos personales y equipo.** Nombre completo, ciudad, edad (≥ 18), ciudadanía y residencia boliviana, integrantes (máx. 5).
2. **Trayectoria de la fundadora.** El documento de precios dice que trabajó un año como cobradora en Banco FIE y llegó a encargada regional en Chuquisaca. Es un dato personal: confirma si quieres publicarlo. Es tu mayor ventaja de credibilidad, y encaja con la tesis «conocimiento operativo local» (resumen.md §9).
3. **Validación con usuarios reales.** No hay clientes ni pilotos documentados. Una carta de intención de una cooperativa o un cobrador que lo probó vale más que cualquier lámina.
4. **Conexión con la India.** Ningún documento del repo la menciona. La lámina 10 es una hipótesis; si tienes un contacto, empresa o programa concreto, agrégalo. Si no, preséntala como exploración.
5. **El pedido.** Qué buscas del concurso: mentoría, piloto, financiamiento, monto.
6. **Qué significa «PSF».** Ningún documento expande la sigla.

## B. Qué NO afirmar en la postulación

| No decir | Por qué |
|---|---|
| «Kobrax usa IA para recomendar / predecir / aprende de los resultados» | **No existe.** Hoy hay datos estructurados y reglas deterministas (prioridad de mora, hora recomendada). La IA analítica es hoja de ruta (resumen.md §5, §8). Decir «estamos construyendo la capa de inteligencia». |
| «Mejora la recuperación en X %» o cualquier cifra de efectividad | No hay medición. «No se debe prometer una mejora antes de medirla» (resumen.md §8). |
| «Somos los únicos con segmentación / analítica / offline / rutas» | Fortaleza y CIRRUS segmentan y planifican estrategias; AtllasPay y CarteraGo ofrecen rutas, GPS y offline a bajo costo (resumen.md §3). |
| «Los bancos bolivianos no tienen sistema de cobranza» | Algunos tienen aplicaciones propias o proveedores (resumen.md §2.2). Lo que se plantea es una brecha de accesibilidad y de análisis, a investigar. |
| «El BDP pagó Bs 400.000+ / Bs 467.464 a CIRRUS» | Las partidas son anticipos por «Compra de Software de Cobranza» a **Integre SRL**: no demuestran el costo total, el proveedor ni el alcance. No sumar periodos (resumen.md §4.1). |
| «La cartera castigada subió Bs 665 millones» como prueba de ineficacia de la cobranza | Cifra del BCB (2025) a contrastar con el documento oficial, su fecha y definición; castigo ≠ mora ≠ fin de la recuperación (resumen.md §2.3). |
| Precios de competidores como definitivos | Son precios públicos consultados; verificar con el proveedor. CobrApp y Geo Cash: sin verificar, no citarlos. |
| «El cobrador solo ve su cartera» (sin matiz) | Solo Mora, Agenda, Rutas y visitas filtran por responsable; Cartera y Pagos muestran toda la cuenta y la base de datos no aplica el alcance (`docs/producto/roles-permisos-planes.md` §3.3). |
| «Cumple ASFI» / «certificado» | No hay certificación; es un supuesto a consultar con abogado. |
| «Firma digital», «mapas offline» | Planeados o parciales. |
| «Push», «SSL pinning», «cifrado del dispositivo» como funciones verificadas | Están **implementados en código y probados con pruebas automáticas**, pero **no se han validado en un teléfono** (falta proyecto Firebase y prueba en dispositivo). Decir «implementado, en validación». |
| «Clientes activos», «en uso real», «37 cobradores / 301.640 créditos» | Está desplegado pero con datos de prueba; esas cifras vienen de una base sin aclarar y no son clientes. Decir «desplegado con datos de prueba». |
| Cifras de CO₂, papel ahorrado, % de recuperación | No hay medición. |
| Cifras de mercado de PRICING §2 y §4 como hechos | Son `[SUPUESTO]` de la fundadora, no estudios. |

## C. Riesgos y cómo mitigarlos

- **Prometer más IA de la que existe:** es el riesgo principal del nuevo enfoque. Toda mención de inteligencia va con «hoja de ruta» o «aún no implementado»; la lámina 8 lo marca en pantalla.
- **Evaluadores piden demo en vivo:** tener una cuenta con datos sintéticos y la app instalada; probar la demo sin internet antes. Probar en teléfono real las funciones nuevas del móvil (nunca se validaron en dispositivo).
- **Lo desplegado va por detrás de `dev`:** confirmar qué versión corre en kobrax.ikigaisystems.lat antes de demostrar funciones nuevas (MFA obligatorio, resumen ampliado, fotos de vivienda). API y app se despliegan juntas.
- **Datos reales en documentos del repo:** `docs/flows/mora union.PDF` es un extracto real de Banco Unión. No adjuntarlo ni mostrarlo sin anonimizar.
- **Mapas:** hoy usan tiles de OpenStreetMap de desarrollo; es aceptable en demo, no en producción ni para descarga masiva offline.
- **Competencia citada con precisión:** no atribuir contratos ni funcionalidades que no estén en una fuente pública.
- **Inconsistencias entre documentos del repo:** corregidas en parte (README y HANDOFF); aún quedan indicadas en §D.

## D. Documentación del repo que sigue desactualizada

| Documento | Problema | Acción sugerida |
|---|---|---|
| `docs/epics/F10/plans/alineacion-web/README.md` §13.8 | Marca A2 y U2 como decisiones abiertas y ya están implementadas (D1/D2) | Actualizar |
| `docs/epics/README.md`, `EPIC-F4` (cabecera) | Dicen F4 «pendiente» y F5–F8 «bloqueado»; F4 está construido y «caso» ya no existe (F4/08) | Actualizar tabla de estados |
| `docs/epics/F4/07`, `F4/12` | Mencionan `/cases`, `caseId`, `case:read` | Revisar tras F4/08 |
| `docs/business/LIMITES-POR-PLAN.md` §2 y §5.1 | Hablan de mínimo 5 cobradores y de FREE con 50 créditos / 300 fotos; la grilla vigente es 20 / 100 | Alinear con §4-A |
| `docs/business/PRICING-Y-DEPLOY.md` §1, §3, §9 y §10 | Dice «no desplegado»; nombres de plan viejos; costo etapa A $23–27 vs $37 | Unificar |
| `apps/web/CLAUDE.md` | Dice que solo existe la identidad y «no hay gráficos» | Reescribir |
| `docs/epics/F10/BUILD-PLAN.md` §4 | «de campo (real): 0 de ~32» frente a §5 | Actualizar |
| `docs/security/PLAN-SEGURIDAD.md` §4.bis | Cita «base de producción» con 301.640 créditos | Aclarar origen |

## E. Verificación de fuentes citadas en `resumen.md` (antes de usar cifras en público)

1. Banco Central de Bolivia: informe de estabilidad financiera — «cartera castigada +Bs 665 millones en 2025» (periodo y definición).
2. ASFI/BCB: series de mora, cartera reprogramada y castigada por tipo de entidad.
3. BDP: estados financieros (partidas «Integre SRL – Compra de Software de Cobranza»: Bs 54.393 · 467.464 · 204.234).
4. Precios públicos de AtllasPay (USD 28/ruta) y CarteraGo (desde USD 6): confirmar vigencia.
5. CobrApp y Geo Cash: identificar proveedor, mercado y capacidades antes de citarlos.

## F. Plan de 6 días

| Día | Tarea |
|---|---|
| 9–10 oct | Revisar respuestas del formulario y el nuevo enfoque; completar datos de §A |
| 11 oct | Grabar demo con datos sintéticos (solo lo que existe); capturas del panel y la app; validar en teléfono lo que se vaya a mostrar |
| 12 oct | Armar PDF de 11 láminas desde `03-pitch-deck-guion.md` |
| 13 oct | Conseguir una carta de intención o testimonio de un usuario real |
| 14 oct | Revisión final de todo (§B es la lista de control); probar el enlace del video |
| 15 oct | Enviar (con margen antes del cierre) |
