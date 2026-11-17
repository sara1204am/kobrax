> ESTADO: EN EJECUCIÓN (2026-11-14) — G4 aprobado por la orden de la usuaria «continúa hasta terminar en P10».

# Plan P8 · Bienvenida del invitado y primeros pasos en Inicio

## 1. Objetivo
Una tarjeta de bienvenida en el primer ingreso a una organización y una tarjeta de «primeros pasos» derivada de datos reales, ambas descartables y guardadas por persona en el servidor (P6).

## 2. Rama
`f15/p8-bienvenida-primeros-pasos`, desde `f15/p7-asistente-web`.

## 3. Estado inicial con evidencia (releído hoy, 2026-11-14)
| # | Hecho | Evidencia |
|---|---|---|
| E-1 | `GET/PUT /users/me/guides` y `mergeGuideState` ya existen (P6); no había BFF para el navegador. | `users.controller.ts:32-42`; `app/api/users/` solo tenía `route.ts` y `[id]/` |
| E-2 | **Inicio redirige a `/agenda` a quien no tiene `report:read`** (un cobrador): para esa persona el aterrizaje es la Agenda, no Inicio. | `app/(panel)/dashboard/page.tsx:80-84` |
| E-3 | El layout ya conoce `me`, sus permisos, el workspace y el estado del asistente. | `app/(panel)/layout.tsx:29-32,53` |
| E-4 | Los listados `/clients`, `/credits`, `/payments` devuelven `meta.total`; piden `client:read`, `credit:read` y `payment:read`. | `bff.ts:43`; controladores |
| E-5 | `roleNames` se traduce bajo `roles.roleNames`; un rol personalizado no tiene traducción. | `messages/es.json` |
| E-6 | El editor de P4 y el asistente de P7 ya existen; P7 termina con `leave()`. | `onboarding-wizard.tsx` |

## 4. Alcance
**Dentro:** `shared/utils/first-steps.ts` (`firstSteps`, puro); `mergeGuideState`; BFF `GET/PATCH /api/users/me/guides` (mezcla el parche con lo guardado y valida el origen); `OnboardingCards` (servidor) y `OnboardingCardsView` (cliente) montados en el layout y mostrados solo en `/dashboard` y `/agenda`; textos es/en; el asistente da por vista la bienvenida al terminar.
**Fuera:** recorrido con spotlight (P9); guías de pantalla y ayuda (P10); móvil.

## 5. Dependencias
D-14, D-16 aprobadas; P6 (estado por persona), P7 (asistente).

## 6. Archivos afectados (HUB)
H15-033 (Inicio como ancla; ver E-2: el ancla real es el layout), H15-016 (layout), H15-024 (mensajes), H15-027/H15-028 (estado de guías, solo se consume).

## 7. Invariantes
R1 (nunca se sugiere lo que el permiso o el módulo visible no dan), progreso derivado de datos y no guardado, el estado es por persona y organización, cuenta anterior sin estado = nada, nunca bloquea, sin sugerencias de descubrimiento (D-15).

## 8. Perfiles de tenant
- **Gratuito individual:** cuenta nueva: ve «primeros pasos» (cliente, crédito, pago según su permiso); una cuenta anterior no ve nada (A-1).
- **Invitado / roles personalizados:** solo las tareas que su permiso y su menú permiten; un rol sin traducción se muestra con su nombre.

## 9. Riesgos
1. Que a un miembro de una cuenta anterior le salga la tarjeta → solo con estado de asistente en la cuenta (cuentas nuevas).
2. Costo en cada carga → una lectura del estado y, solo si la tarjeta de pasos sigue abierta, tres lecturas de una página de un elemento; cualquier fallo deja sin tarjeta.
3. Dos pestañas que marcan cosas distintas se pisan → el BFF mezcla el parche con lo guardado.
4. Mostrar la tarjeta fuera de contexto → solo en `/dashboard` y `/agenda`.

## 10. Pruebas
`first-steps.spec.ts` (8), `onboarding.spec.ts` (+5 de `mergeGuideState`), `onboarding-cards-view.test.tsx` (7), `onboarding-wizard.test.tsx` (marca la bienvenida al terminar), y verificación real `p8-web-cards.real.ts` (API + `next start`).

## 11. Rollback
Sin migración. Quitar `<OnboardingCards>` del layout deja el panel como antes; el estado guardado es inocuo.

## 12. Tareas
shared (`firstSteps`, `mergeGuideState`) → BFF → componentes → textos → montaje → pruebas.

## 13. Criterios de cierre
G5 con salidas pegadas; R-1; G6; G7.
