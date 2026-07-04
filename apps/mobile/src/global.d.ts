// Expo inyecta las variables EXPO_PUBLIC_* en `process.env` en tiempo de build.
// Declaramos el global mínimo para TS (sin traer @types/node, que añadiría globals de Node).
declare const process: { env: { [key: string]: string | undefined } };
