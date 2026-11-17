# Informe de cumplimiento — privacidad, consentimiento y términos

> Estado al 2026-11-17. Tres estados, sin adornos: **IMPLEMENTADO Y VERIFICADO** (hay código y una prueba que lo demuestra),
> **PARCIALMENTE IMPLEMENTADO** y **PENDIENTE DE VALIDACIÓN LEGAL**.
> **Esto no es una declaración de que Kobrax cumpla GDPR ni ninguna norma boliviana.** Es un inventario técnico de lo que existe.
> La aprobación jurídica final corresponde a un abogado especializado en Bolivia y, donde corresponda, de las jurisdicciones donde opere Kobrax.

## 1. IMPLEMENTADO Y VERIFICADO

| # | Capacidad | Dónde | Prueba |
|---|---|---|---|
| 1 | Documentos legales **versionados** (6 tipos) con hash SHA-256 del texto, vigencia y marca de cambio material. Una versión publicada **no se edita** | `legal_document_versions`, `pnpm db:seed:legal` | `legal.it.ts` (trigger + REVOKE), seed que falla si el texto cambia sin subir versión |
| 2 | **Aceptación de Términos y reconocimiento de la Política**, en casillas **separadas y desmarcadas**, antes de crear la cuenta (web y móvil) y al aceptar una invitación | registro, invitación | `legal-signup.it.ts`, `registro/page.test.tsx`, `invitacion/page.test.tsx`, `legal-consents.test.tsx` (móvil) |
| 3 | **Evidencia inmutable**: usuario, cuenta, versión exacta, hash que **calcula el servidor** (nunca el cliente), acción, origen (web/móvil/invitación/perfil/re-aceptación), hora de la base, IP, user-agent y versión de la app | `user_legal_acceptances` | `legal.it.ts`: ni la app ni el dueño de las tablas pueden UPDATE/DELETE/TRUNCATE; `verify_legal.sql` |
| 4 | **Atomicidad**: sin aceptación no queda cuenta, usuario ni membresía; una invitación no se consume | `AccountsService.create`, `PasswordService.acceptInvitation` | `legal-signup.it.ts` (Postgres real) |
| 5 | Una **versión que ya no es la vigente se rechaza** (409) y la pantalla pide volver a marcar | API + web + móvil | integración y pruebas de pantalla |
| 6 | **Consentimiento opcional** (comunicaciones comerciales): independiente, desmarcado por omisión, no condiciona el acceso; otorgar/retirar inserta una fila **nueva** (el historial no se reescribe); retirar es tan fácil como otorgar | Mi perfil › Privacidad | `legal-self.it.ts`, `privacy-panel.test.tsx` |
| 7 | **Historial de aceptaciones** de cada persona, con enlace a la versión exacta | Mi perfil › Privacidad | `legal-self.it.ts`, `privacy-panel.test.tsx` |
| 8 | **Re-aceptación solo ante cambio material** (un cambio editorial no la pide), parcial si cambió un solo documento, con pantalla bloqueante que permite cerrar sesión | `requiredFloor`, `LegalReacceptGate` | `legal.logic.spec.ts`, `legal-self.it.ts`, `legal-reaccept-gate.test.tsx` |
| 9 | **Solicitudes de derechos** (acceso, rectificación, supresión, limitación, oposición, portabilidad, retirar consentimiento) con estados *Recibida → En revisión → Requiere información → Aprobada/Rechazada → Completada*, máquina de estados validada en servidor, **rechazo con justificación obligatoria**, un evento inmutable por paso | `privacy_requests`, `privacy_request_events` | `privacy-requests.it.ts`, `privacy-requests.logic.spec.ts` |
| 10 | **Separación jurídica de los tres roles**: persona usuaria (solicitudes `APP_USER`, las atiende Kobrax), organización cliente (solicitudes de titulares `DEBTOR_VIA_ORG`, las atiende la organización con `account:write`) y titular de datos de cobranza. La plataforma **no** puede tocar las solicitudes de titulares | RLS + filtros + `platform:privacy:manage` | `privacy-requests.it.ts` (404 entre cuentas, 404 de plataforma sobre titulares) |
| 11 | **Aislamiento entre cuentas** de las solicitudes de titulares (RLS forzado) y entre personas en lo propio (la clave sale de la sesión) | `privacy_requests_access`, `LegalSelfService` | `privacy-requests.it.ts`, `legal-self.it.ts`, `verify_legal.sql` |
| 12 | Páginas públicas permanentes con versiones anteriores (`?v=`) y huella: `/terminos`, `/privacidad`, `/cookies`, `/dpa`, `/uso-aceptable`, `/ia` | web | build + verificación HTTP |
| 13 | Los textos legales se muestran **como texto**, nunca como HTML (sin `dangerouslySetInnerHTML`; en móvil, elementos nativos) | web y móvil | `legal-text.test.tsx`, `legal-acceptance.spec.ts`, `legal-consents.test.tsx` |
| 14 | Cookies: lista real (necesarias vs preferencia). **No hay analítica, publicidad ni seguimiento**; por eso no hay banner | `/cookies` | auditoría de código (grep de analítica/seguimiento) |
| 15 | Controles de acceso de los endpoints nuevos declarados y fijados en el snapshot de autorización; la lista de permisos de plataforma sigue cerrada | `authz-snapshot.json`, `platform.spec.ts` | 92 specs de autorización |

## 2. PARCIALMENTE IMPLEMENTADO

| # | Qué | Qué falta |
|---|---|---|
| P1 | **Re-aceptación** | Es una barrera de **interfaz** (pantalla bloqueante en el panel web). La API no corta el resto de endpoints a quien no re-aceptó, y el móvil no muestra la pantalla de re-aceptación (solo el alta y la invitación llevan la aceptación). Decisión consciente para no romper la app ni integraciones; cerrar la brecha exige decidir política de bloqueo |
| P2 | **Solicitudes de derechos** | Registran y dan seguimiento; **no ejecutan** la supresión, rectificación ni exportación: una persona hace el trabajo y marca «Completada». No hay pantalla de plataforma para la cola (solo API `/platform/privacy-requests`); no hay plazos ni recordatorios (`due_at` sin definir) |
| P3 | **Documentos en inglés** | Solo existen en español; se piden siempre en `es` |
| P4 | **Evidencia de IP** | Se guarda completa con fines probatorios; **sin política de retención definida** |
| P5 | **Notificación de cambios materiales** | Se pide re-aceptación al ingresar; no se envía correo avisando del cambio |
| P6 | **Panel móvil de Privacidad** | El móvil no tiene Mi perfil › Privacidad ni solicitudes de derechos (solo la aceptación al crear el acceso) |
| P7 | **Pruebas E2E de navegador** | No hay (no se agregó Playwright). Cubierto con pruebas unitarias, de componente y de integración contra Postgres real; **nada se probó a mano en un navegador ni en un teléfono** |

## 3. PENDIENTE DE VALIDACIÓN LEGAL

Todo lo que sigue **no se puede resolver en código** y está marcado `[PENDIENTE DE CONFIRMACIÓN LEGAL]` en los documentos. Ver `PENDIENTES-LEGALES.md`.

- Los **6 textos** son **borradores `0.1.0` sin revisión de abogado**.
- Datos de la sociedad: NIT, domicilio legal, matrícula de comercio; confirmar razón social y representante contra la documentación societaria.
- Bases jurídicas por tratamiento y su encaje en el D.S. 1793 art. 56 (cuyo ámbito no está aclarado).
- Si Kobrax cae bajo el régimen de **Empresas de Tecnología Financiera** (D.S. 5384, Res. ASFI/540/2025) o la reserva de la Ley 393.
- Valor probatorio del *clic-aceptar* (indicio, no firma digital, Ley 164 art. 87) y retención de la IP.
- Plazos: respuesta a solicitudes, notificación de brechas, conservación por tipo de dato, eliminación.
- Transferencia internacional (servidor en EE. UU.; FCM, Gmail, mapas, fuentes).
- Cobranza: WhatsApp, horarios, geolocalización, fotos de personas, y la autoridad de una organización para tratar datos de deudores.
- Menores; criterios de equidad de la IA; límites de responsabilidad y jurisdicción.

## 4. Lo que NO se afirma (y por qué)

Los documentos describen solo lo que el código hace hoy. En particular **no** declaran: cifrado de todo dato personal (solo documento, NIT, contactos, direcciones y secreto MFA), retención de fotos aplicada (solo se cuenta), eliminación segura a pedido, almacenamiento en nube S3/R2 (hoy es disco local), copia de respaldo fuera del servidor, ni certificaciones ISO, SOC 2 o autorización ASFI (no hay ninguna).
Los riesgos de seguridad descubiertos en la auditoría (Etapa A §4) **no se corrigieron** en este trabajo: son el paso B8 y requieren aprobación porque cambian funcionalidad existente.
