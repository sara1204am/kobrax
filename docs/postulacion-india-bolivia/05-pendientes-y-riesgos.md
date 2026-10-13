# Pendientes y riesgos antes de enviar (cierre: 15 de octubre de 2026)

## A. Datos que solo tú puedes aportar (no se inventan)

1. **Datos personales y equipo.** Nombre completo, ciudad, edad (≥ 18), ciudadanía y residencia boliviana, integrantes (máx. 5).
2. **Trayectoria de la fundadora.** El documento de precios dice que trabajó un año como cobradora en Banco FIE y llegó a encargada regional en Chuquisaca. Es un dato personal: confirma si quieres publicarlo. Es tu mayor ventaja de credibilidad.
3. **Validación con usuarios reales.** No hay clientes ni pilotos documentados. Una carta de intención de una cooperativa o un cobrador que lo probó vale más que cualquier lámina.
4. **Conexión con la India.** Ningún documento del repo la menciona. La lámina 10 es una hipótesis; si tienes un contacto, empresa o programa concreto, agrégalo. Si no, preséntala como exploración.
5. **El pedido.** Qué buscas del concurso: mentoría, piloto, financiamiento, monto.
6. **Qué significa «PSF».** Ningún documento expande la sigla.

## B. Qué NO afirmar en la postulación

| No decir | Por qué |
|---|---|
| «El cobrador solo ve su cartera» (sin matiz) | Solo Mora, Agenda, Rutas y visitas filtran por responsable; Cartera y Pagos muestran toda la cuenta y la base de datos no aplica el alcance (`docs/producto/roles-permisos-planes.md` §3.3). |
| «Cumple ASFI» / «certificado» | No hay certificación; es un supuesto a consultar con abogado. |
| «Firma digital», «push», «mapas offline», «SSL pinning» | Planeados o parciales. |
| «Clientes activos», «en uso real», «37 cobradores / 301.640 créditos» | Está desplegado pero con datos de prueba; esas cifras vienen de una base sin aclarar y no son clientes. Decir «desplegado con datos de prueba». |
| Cifras de CO₂, papel ahorrado, % de recuperación | No hay medición. |
| Cifras de mercado de PRICING §2 y §4 como hechos | Son `[SUPUESTO]` de la fundadora, no estudios. |

## C. Riesgos y cómo mitigarlos

- **Evaluadores piden demo en vivo:** tener una cuenta con datos sintéticos y la app instalada; probar la demo sin internet antes.
- **Datos reales en documentos del repo:** `docs/flows/mora union.PDF` es un extracto real de Banco Unión. No adjuntarlo ni mostrarlo sin anonimizar.
- **Mapas:** hoy usan tiles de OpenStreetMap de desarrollo; es aceptable en demo, no en producción.
- **Inconsistencias entre documentos del repo:** corregidas en parte (README y HANDOFF); aún quedan indicadas en §D.

## D. Documentación del repo que sigue desactualizada

| Documento | Problema | Acción sugerida |
|---|---|---|
| `docs/epics/README.md`, `EPIC-F4` (cabecera) | Dicen F4 «pendiente» y F5–F8 «bloqueado»; F4 está construido y «caso» ya no existe (F4/08) | Actualizar tabla de estados |
| `docs/epics/F4/07`, `F4/12` | Mencionan `/cases`, `caseId`, `case:read` | Revisar tras F4/08 |
| `docs/business/LIMITES-POR-PLAN.md` §2 y §5.1 | Hablan de mínimo 5 cobradores y de FREE con 50 créditos / 300 fotos; la grilla vigente es 20 / 100 | Alinear con §4-A |
| `docs/business/PRICING-Y-DEPLOY.md` §3 y §10 | Nombres de plan viejos; costo etapa A $23–27 vs $37 | Unificar |
| `apps/web/CLAUDE.md` | Dice que solo existe la identidad y «no hay gráficos» | Reescribir |
| `docs/epics/F10/BUILD-PLAN.md` §4 | «de campo (real): 0 de ~32» frente a §5 | Actualizar |
| `docs/security/PLAN-SEGURIDAD.md` §4.bis | Cita «base de producción» con 301.640 créditos | Aclarar origen |

## E. Plan de 6 días

| Día | Tarea |
|---|---|
| 9–10 oct | Revisar respuestas del formulario; completar datos de §A |
| 11 oct | Grabar demo con datos sintéticos; capturas del panel y la app |
| 12 oct | Armar PDF de 10 láminas desde `03-pitch-deck-guion.md` |
| 13 oct | Conseguir una carta de intención o testimonio de un usuario real |
| 14 oct | Revisión final de todo; probar el enlace del video |
| 15 oct | Enviar (con margen antes del cierre) |
