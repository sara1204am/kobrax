/**
 * Jest para el mobile (Expo SDK 51). `jest-expo` aporta el transform RN + mocks nativos.
 * `transformIgnorePatterns` ajustado a la estructura **pnpm** (`node_modules/.pnpm/<pkg>@ver`):
 * el patrón por defecto de jest-expo asume node_modules planos y dejaría sin transformar
 * los archivos Flow de react-native (error "Unexpected identifier 'ErrorHandler'").
 */
module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Specs co-localizados (mismo patrón que el backend).
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  // Mock del módulo nativo de SQLite: desde P6 los services lo arrastran por importar el caché.
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Los tests de pantalla con RNTL montan el árbol completo y, con muchas suites corriendo en
  // paralelo, los 5 s por defecto se quedan cortos: fallaban por carga de la máquina y no por el
  // código. Subirlo no tapa nada — un test que de verdad se cuelga igual muere a los 15 s.
  testTimeout: 15_000,
  transformIgnorePatterns: [
    'node_modules/.pnpm/(?!(jest-)?(react-native|@react-native|@react-native-community|react-native-.*|@react-navigation|expo|expo-.*|@expo|@expo-google-fonts|@unimodules|unimodules|sentry-expo|native-base|@testing-library)[@+])',
  ],
};
