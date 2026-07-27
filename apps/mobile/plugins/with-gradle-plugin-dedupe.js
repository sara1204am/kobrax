/**
 * Config plugin: deduplica el composite build de `@react-native/gradle-plugin`.
 *
 * Con pnpm el paquete queda en dos rutas reales (la raíz hoisteada del monorepo y la de
 * `.pnpm/`). El `settings.gradle` que genera el template de RN 0.74 hace `includeBuild` dos
 * veces resolviendo cada una distinto, y Gradle aborta:
 *
 *   Included build .../.pnpm/@react-native+gradle-plugin@x/... has build path :gradle-plugin
 *   which is the same as included build .../node_modules/@react-native/gradle-plugin
 *
 * Igualamos la resolución del segundo `includeBuild` a la del bloque `pluginManagement`.
 * Sin esto, `expo run:android` falla en configure con cada `expo prebuild`.
 */
const { withSettingsGradle } = require('expo/config-plugins');

const RESOLUCION_DUPLICADA =
  "require.resolve('@react-native/gradle-plugin/package.json', { paths: [require.resolve('react-native/package.json')] })";
const RESOLUCION_UNICA = "require.resolve('@react-native/gradle-plugin/package.json')";

module.exports = function withGradlePluginDedupe(config) {
  return withSettingsGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(RESOLUCION_DUPLICADA)) {
      // El template cambió: si el error de "same build path" vuelve, actualizar este plugin.
      console.warn('[with-gradle-plugin-dedupe] no se encontró el includeBuild duplicado → NO-OP.');
      return cfg;
    }
    cfg.modResults.contents = cfg.modResults.contents.split(RESOLUCION_DUPLICADA).join(RESOLUCION_UNICA);
    return cfg;
  });
};
