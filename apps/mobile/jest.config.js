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
  transformIgnorePatterns: [
    'node_modules/.pnpm/(?!(jest-)?(react-native|@react-native|@react-native-community|react-native-.*|@react-navigation|expo|expo-.*|@expo|@expo-google-fonts|@unimodules|unimodules|sentry-expo|native-base|@testing-library)[@+])',
  ],
};
