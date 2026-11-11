import type { PolicyService } from './policy.service';

/**
 * Doble de `PolicyService` para los specs que instancian los servicios a mano (F14 · F2). NO decide nada: devuelve lo que cada política
 * "resolvería" (p. ej. la oficina de registro) y registra qué se le preguntó. Las decisiones reales se prueban en `policies/*.spec.ts`
 * y en la integración.
 */
export function fakePolicy(results: Record<string, (input: unknown) => Record<string, unknown> | undefined> = {}) {
  const asked: { name: string; input: unknown }[] = [];
  const service = {
    has: () => true,
    check: async (name: string, input?: unknown) => {
      asked.push({ name, input });
      const data = results[name]?.(input);
      return data ? { allow: true as const, data } : { allow: true as const };
    },
    assert: async (name: string, input?: unknown) => {
      asked.push({ name, input });
      return results[name]?.(input);
    },
  } as unknown as PolicyService;
  return { service, asked };
}
