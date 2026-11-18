> ESTADO: CONSTRUIDA (2026-11-14), sin G4 propio (orden «continúa hasta terminar en P10»).

# Plan P9 · Motor de spotlight, botón «?» y recorrido general

Rama `f15/p9-spotlight-recorrido` (desde `f15/p8-bienvenida-primeros-pasos`).

**Hecho:** `components/tour.tsx` (`TourProvider`, `SpotlightTour`, `startTour()`, `useTour()`); anclas `data-tour` en el menú y la barra (`panel-shell.tsx`); botón «?» con «Recorrido general» y «Seguir donde lo dejé»; `tourResumeIndex` en `shared/guides.ts`; textos `guides.tour.*`, `tour.*`, `help.*` (es/en); lanzadores en la bienvenida y al final del asistente; el cajón del menú se abre por el evento `kobrax:tour-menu`.

**Reglas:** pasos de `guideSteps` (plan ∧ permiso ∧ workspace, R1); `Esc` deja a medias (retomable), «Omitir» guarda `skipped`; progreso por persona y organización en `user_guide_states` (P6); si el elemento no se ve (idioma/organización dentro del menú del celular) la tarjeta sale centrada sin recuadro; `<dialog>` modal = foco atrapado.

**Evidencia:** web 1465/1465 (140 archivos), shared 611/611, `tsc` limpio. `tour.test.tsx`: 9 casos (orden, R1, guardado, omitir, teclado/Esc, retomar, versión del catálogo, varias organizaciones, cajón).
**No verificado:** navegador real (spotlight sobre el menú en escritorio y celular).
