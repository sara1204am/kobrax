# Objetivo · 04 · Experiencia web

> **Estado: BORRADOR G2 (2026-11-02).** R7: la vista de oficinas es **igual que la de Gallium** (`C:\Tutator\gallium-10`, `/admin/offices`), adaptando solo lo que Kobrax exige. Detalle de Gallium: `../discovery/10-referencia-gallium.md`. Evidencia: H-web-01…13, H-gal-01…09.

## Pregunta que responde
¿Cómo entra un usuario por oficina y cómo cambia cada módulo web?

## Vista de oficinas (Cuenta › Oficinas, reemplaza Agencias)
Réplica del comportamiento de Gallium:
- Conmutador **Árbol** (el **Mapa** queda fuera de F13: Kobrax no tiene Leaflet, H-gal-08).
- Árbol con buscador, control de nivel (expandir hasta N) y atajos de teclado, arrastrar y soltar para mover, menú ⋮ por fila (Editar · Añadir hija · Alta rápida · Ver detalle · Desactivar), vista previa al hacer clic.
- **Diferencias deliberadas con Gallium:** (1) la **ruta completa siempre visible** (R10); (2) el árbol muestra lo mismo que cubre el alcance — no heredar el desajuste árbol/datos de Gallium (H-gal-04); (3) multi-tenant y RLS; (4) formulario adaptado al dominio de Kobrax (no beneficiarios/documentos/país, H-gal-07/09).
- Formulario en pestañas: **Datos** (nombre, código, tipo, padre, responsable) · **Contacto y ubicación** · **Equipo** (miembros). Detalle: estadísticas (usuarios, créditos, mora), miembros, historial de auditoría. **Papelera** de oficinas desactivadas.
- Asignación de usuarios desde la **ficha del usuario** (como Gallium) y desde la pestaña Equipo de la oficina (reutiliza `BranchesManager`, H-web-11).
- Catálogo de **tipos de oficina** editable con `office:write`.
- Escala: carga perezosa de hijos para árboles grandes (Gallium asume < 200 y no lo resuelve, H-gal-08).

## Cómo se construye (stack distinto)
Gallium usa Next 16 + PrimeReact + React Query; Kobrax usa Next 14 + Tailwind, BFF + server components y `router.refresh()` (H-web-12). **No se copia código: se reimplementa el comportamiento** con los componentes de Kobrax (`Modal`, `Section`, `Badge`, `EmptyState`, `DataTable`, `usePermissions`). El árbol interactivo y el arrastre son nuevos; la dependencia de arrastre (p. ej. dnd-kit) se nota en el plan de la fase, no requiere decisión.

## Los demás módulos
| Módulo | Hoy | Objetivo |
|---|---|---|
| Cartera | filtro por agencia con `branches={[]}` (deshabilitado, H-web-05) | selector de oficina (árbol, con ruta completa) alimentado con el alcance |
| Dashboard | acepta `branchId`, sin control (H-web-07) | mismo selector; analítica con alcance (06) |
| Equipo | sin columna/filtro de oficina (H-web-08) | columna y filtro de oficinas (varias) |
| Mora | filtra por oficina solo para quien reparte (H-web-06) | mismo selector común |
| Rutas, Pagos | el servidor pone el alcance (H-web-09) | sin cambios de pantalla en F13 |
| Importación | alcance de corrida = agencia (H-web-10) | alcance = nodo (incluye subárbol) |
| Shell | solo selector de empresa (H-web-04) | selector de oficina **después**, con el contexto de seguridad (A-5) |

## Reglas
- **Un tenant con una sola oficina no ve nada de esto** (C2): ni pestaña de árbol, ni selector, ni columnas.
- Terminología única «oficina» en la UI (hoy mezcla agencia/oficina/sucursal, H-web-13); se limpian comentarios desactualizados (`cartera/page.tsx:80`, `dashboard-filters.tsx:22`).
- La UI solo oculta; la API valida (B4). Textos en `messages/es.json` y `en.json`.

## Impacto por perfil de tenant
| Perfil | Qué cambia | Qué NO debe cambiar | Cómo se comprueba |
|---|---|---|---|
| Gratuito individual | nada visible | navegación y pantallas | R-1 |
| Equipo | «Agencias» pasa a «Oficinas»; mismas acciones | quién puede editar | R-2 |
| Grande | árbol, detalle, papelera, selectores | rendimiento con muchos nodos | R-3 + prueba de carga (fase G) |

## Entradas HUB que cambiarían
Cuenta › Agencias, Cartera, Dashboard, Equipo, Mora, Import (web).
