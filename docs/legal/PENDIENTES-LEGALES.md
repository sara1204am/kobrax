# Pendientes jurídicos y regulatorios

Lista de lo que **un abogado especializado en Bolivia debe confirmar** y de los datos que **solo la sociedad puede dar**. En los documentos
publicados esto aparece como `[PENDIENTE DE CONFIRMACIÓN LEGAL]` (resaltado en la pantalla). Nada de esto se inventó para completar un texto.

## A. Datos de la sociedad (los aporta Ikigai Tech Bolivia S.A.)

| Dato | Estado | Dónde aparece |
|---|---|---|
| Razón social «Ikigai Tech Bolivia S.A.» | Informada por la titular; **contrastar con el testimonio de constitución** | Términos, Privacidad, DPA |
| Representante legal «Mabel Sara Acha Moya» | Informado; **contrastar con poder / certificado de Fundempresa** | Términos, Privacidad, DPA |
| Correo de privacidad kobraxikigai@gmail.com | Informado. Es un Gmail: **migrar a un correo de dominio propio** antes del lanzamiento (`PRIVACY_CONTACT_EMAIL` en `apps/web/src/lib/app-config.ts` y los textos) | Todos los documentos y la pantalla de registro |
| NIT | **Falta** | Términos, Privacidad, DPA |
| Domicilio legal | **Falta** | Términos, Privacidad, DPA |
| Matrícula de comercio | **Falta** | — |

## B. Preguntas para el abogado

1. **¿Kobrax es una Empresa de Tecnología Financiera** (D.S. 5384 y Res. ASFI/540/2025, con sus modificaciones) o presta un servicio financiero complementario? ¿Necesita licencia o registro ante ASFI? Es la duda de aplicabilidad más seria.
2. **Reserva de la Ley 393** (arts. 474–475): ¿alcanza a Kobrax como proveedor tecnológico de cooperativas e IFD? ¿Cómo trasladarla por contrato?
3. **Ámbito real del D.S. 1793 art. 56** (consentimiento previo, expreso e informado): ¿solo sector TIC o cualquier tratamiento? Confirmar la numeración contra la Gaceta Oficial (las fuentes difieren entre D.S. 1793 y otros).
4. **Valor probatorio del clic-aceptar** (Ley 164 art. 87, indicio sin firma digital): ¿qué constancia mínima conviene? ¿Se busca valor pleno con firma digital y entidad certificadora (ADSIB)?
5. **IP en la evidencia**: ¿se justifica guardarla completa y por cuánto tiempo?
6. **Bases jurídicas** de cada tratamiento (cuenta, seguridad, comunicaciones comerciales) y del D.S. 1793 art. 57 (comunicaciones comerciales).
7. **Ley 453**: ¿aplica a la relación con cooperativas y empresas (B2B)? Validez de las cláusulas de los Términos (cláusulas abusivas, cesión de datos, art. 22.2.5).
8. **Cobranza**: legalidad del tratamiento de datos de deudores y garantes sin su consentimiento directo; contacto por WhatsApp, horarios permitidos, geolocalización y fotos de personas (propia imagen, CPE 21.2).
9. **Autoridad de una organización** sobre los datos de sus deudores y alcance del DPA; **un administrador no consiente por los titulares**: confirmar que la redacción lo deja claro.
10. **Transferencia internacional**: el servidor está en EE. UU. (Contabo); además FCM (Google), Gmail, mapas (OSM/Esri) y Google Fonts ven IP o tokens. ¿Qué base y garantías se necesitan?
11. **Plazos**: respuesta a solicitudes de derechos, notificación de brechas (a titulares, a clientes, a autoridad), conservación por tipo de dato, eliminación.
12. **Menores**: edad mínima de la cuenta y tratamiento de datos de menores.
13. **IA**: criterios de equidad; garantías antes de incorporar decisiones automatizadas con efecto significativo.
14. **Responsabilidad y jurisdicción**: topes razonables, ley aplicable, mecanismo de resolución de controversias, **sin renuncias generales a derechos irrenunciables**.
15. **Proyectos de ley** de protección de datos (PL 538/2025-2026, PL 630/2025-2026, anteproyecto AGETIC): estado a la fecha de la revisión.
16. **Verificación de fuentes**: la investigación normativa usó resúmenes de lexivox/gdpr-info. **Ningún artículo debe citarse en un documento publicado sin contrastarlo con la Gaceta Oficial.**

## C. Decisiones de producto/seguridad que quedan abiertas (no son legales, pero condicionan lo que se puede afirmar)

- Hasta que no se implementen no se pueden declarar: cifrado de todos los datos personales, retención de fotos aplicada, supresión a pedido, respaldo fuera del servidor, S3/R2.
- Barrera de re-aceptación en la API (hoy solo de interfaz).
- Pantalla de plataforma para atender las solicitudes de derechos; plazos y recordatorios.
- Correo de aviso ante cambios materiales; versión en inglés de los documentos.
- **Runbook de brechas de seguridad** (no existe): necesario para poder comprometerse a notificar.

## D. Cómo publicar la versión definitiva

1. El abogado revisa y aprueba `docs/legal/documentos/*.es.md`.
2. Se actualizan los archivos y se **sube `version` a `1.0.0`** con `material: true` (cada versión publicada es inmutable).
3. `pnpm db:seed:legal` en cada entorno. Las personas que aceptaron `0.1.0` verán la pantalla de re-aceptación (cambio material).
4. Se quitan los marcadores `[PENDIENTE…]` solo de lo ya confirmado.

## E. Titular del servicio y Google Play (2026-11-17)

Mientras no exista la sociedad, los textos nombran como titular a **Mabel Sara Acha Moya, persona natural** (no a Ikigai Tech Bolivia S.A.). Responde con su patrimonio personal.

1. **Al constituirse la sociedad:** cambiar el titular en `terms`, `dpa` y `privacy` (versión nueva, material → re-aceptación) y reflejarlo en la cuenta de Google Play (una app no se mueve fácil de una cuenta personal a una de organización: decidir el identificador de paquete definitivo antes de publicar).
2. **Preguntas para el abogado boliviano:** (a) base legal del cobrador independiente como responsable de datos de deudores; (b) alcance del D.S. 1793 y de las normas de ASFI o de consumo sobre cobranza (horarios, medios, contacto con terceros); (c) si conviene una figura intermedia (empresa unipersonal) antes de la S.A.; (d) validez de la cláusula de responsabilidad e indemnidad del usuario (`terms` §7.2).
3. **Pendientes técnicos que los textos ya reconocen:** formulario público de reportes de abuso o corrección (hoy solo correo); botón de suspensión de cuenta (hoy solo CLI `account:suspend`); eliminación de cuenta dentro de la app móvil y página web pública para pedirla (exigencia de Google Play).
4. **Google Play:** `privacy` §16 es la base para la ficha de Seguridad de los datos. Bloqueo técnico aparte: migrar Expo SDK 51 para apuntar a API 36 y soportar páginas de 16 KB (ver análisis de publicación en Play).
