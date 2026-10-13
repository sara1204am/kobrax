/**
 * Configuración dinámica de Expo: parte de `app.json` y agrega **solo lo que depende del entorno de build**.
 *
 * Push remoto (FCM, D-4): Android necesita `google-services.json` (el archivo del proyecto de Firebase) para que
 * `getDevicePushTokenAsync` pueda inicializar Firebase. Ese archivo es de cada entorno y **no se commitea**
 * (`apps/mobile/.gitignore`). Se toma de:
 *   1. la variable `GOOGLE_SERVICES_JSON` (ruta al archivo), o
 *   2. `./google-services.json` junto a este archivo.
 *
 * Sin el archivo el build **sigue funcionando**: la app compila y corre, solo que sin push remoto (los avisos locales de
 * agenda y la bandeja no dependen de Firebase). Se avisa por consola para que no pase desapercibido en un build de producción.
 */
const fs = require('node:fs');
const path = require('node:path');

module.exports = ({ config }) => {
  const file = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
  const exists = fs.existsSync(path.resolve(__dirname, file));

  if (!exists) {
    // eslint-disable-next-line no-console
    console.warn(
      '[kobrax] google-services.json no encontrado: este build NO tendrá push remoto (FCM). ' +
        'Ver docs/epics/F10/plans/alineacion-web/PUSH-FCM.md',
    );
    return config;
  }

  return {
    ...config,
    android: { ...config.android, googleServicesFile: file },
  };
};
