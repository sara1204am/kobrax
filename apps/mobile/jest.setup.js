/**
 * Mock global de `expo-sqlite`.
 *
 * `db.ts` importa el módulo nativo en el tope, y desde P6 casi todos los `*.service.ts` lo arrastran
 * (leen del caché cuando no hay red). Sin este mock, cualquier suite que toque un service —aunque
 * no pruebe nada de la base— falla al cargar el módulo nativo, que en jest no existe.
 *
 * Devuelve una base que no guarda nada: los tests que sí prueban la base declaran su propio
 * `jest.mock('expo-sqlite')`, que tiene precedencia sobre este.
 */
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => ({
    execAsync: jest.fn(async () => {}),
    runAsync: jest.fn(async () => ({ lastInsertRowId: 0, changes: 0 })),
    getFirstAsync: jest.fn(async () => null),
    getAllAsync: jest.fn(async () => []),
    withTransactionAsync: jest.fn(async (fn) => fn()),
  })),
}));
