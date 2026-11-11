/**
 * F14 · F6: Oficinas, Actividad y Accesos de soporte dejaron de ser pestañas de /cuenta y pasaron a su propia sección
 * del menú. Las rutas viejas siguen existiendo como redirección **permanente** (308) para no romper marcadores,
 * enlaces en correos ni pantallas abiertas. `:path*` conserva las subrutas (`/cuenta/oficinas/<id>/…`) y Next conserva `?tab=`.
 */
export const LEGACY_REDIRECTS = [
  { source: '/cuenta/oficinas', destination: '/organizacion', permanent: true },
  { source: '/cuenta/oficinas/:path*', destination: '/organizacion/:path*', permanent: true },
  { source: '/cuenta/actividad', destination: '/actividad', permanent: true },
  { source: '/cuenta/soporte', destination: '/seguridad/soporte', permanent: true },
];
