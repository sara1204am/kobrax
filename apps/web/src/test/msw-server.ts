import { setupServer } from 'msw/node';

/** Servidor MSW compartido por los tests (handlers se añaden por test con server.use). */
export const server = setupServer();
