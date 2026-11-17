> ESTADO: CONSTRUIDA (2026-11-14), sin G4 propio (orden «continúa hasta terminar en P10»).

# Plan P10 · Guías de pantalla y Centro de ayuda

Rama `f15/p9-spotlight-recorrido` (P10 se commiteó encima; no se abrió rama aparte).

**Hecho:** el motor de P9 ahora corre dos tipos de guía (`Run` = recorrido | pantalla). Anclas `data-tour="screen.<módulo>.<acción>"` en las páginas de Cartera, Mora, Agenda, Pagos, Rutas, Equipo y Organización. Los pasos cuya ancla no está en la página (botón oculto por permiso) se descartan. Sale sola la primera visita al módulo solo si: cuenta nueva (`onboarding.status` definido), recorrido general `done`/`skipped`, y la guía no vista; marca `screens["screen.<módulo>"]` = `seen`/`dismissed`. Desde «?»: «Guía de esta pantalla» y «Centro de ayuda». `/ayuda` (server + `HelpCenter` con búsqueda sin tildes) sale de `helpEntries`; `/ayuda` entra al matcher del middleware. Textos `guides.screen.*`, `guides.help.*`, `helpCenter.*`, es/en.

**Anclas que NO existen todavía** (esos pasos se descartan solos; el catálogo se conserva): portfolio.filters, mora.filters, mora.registerActivity, agenda.promises, organization.assign. `team.roles` ancla la tabla de miembros y `routes.plan` las pestañas.

**Evidencia:** web 1476/1476 (141 archivos), `tsc` limpio, shared 611/611. **No verificado:** navegador real; el menú «?» y las guías automáticas.
