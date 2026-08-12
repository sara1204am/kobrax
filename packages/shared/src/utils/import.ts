/**
 * Derivados puros del import de cartera: lo que las pantallas calculan a partir de la config,
 * sin red y sin texto en ningún idioma.
 *
 * Los rótulos (`PROFILE_META`, `ABSENT_RULE_META`, `warningText`…) **no viven acá**: el panel es
 * bilingüe y el móvil no, así que cada uno pone su texto. Acá va la regla.
 */
import type { FieldRule, ImportConfig, NameOrder, ScopeMember } from '../types/import.types.js';

/** Los tres estados de un campo. Un solo control, no dos toggles. */
export type FieldState = 'required' | 'optional' | 'off';

export function fieldState(rule: FieldRule | undefined): FieldState {
  if (!rule || rule.enabled === false) return 'off';
  return rule.required ? 'required' : 'optional';
}

export function applyFieldState(rule: FieldRule | undefined, state: FieldState): FieldRule {
  // `from` e `in` los trae el spread: cambiar el estado nunca desempareja el campo.
  return { ...rule, enabled: state !== 'off', required: state === 'required' };
}

/** El primer dato que falta para poder importar. `null` = está todo. */
export type SetupStep = 'source' | 'scope' | 'profile' | 'fields' | null;

export function setupStep(config: ImportConfig): SetupStep {
  if (config.source !== 'file') return 'source';
  if (config.scope.kind !== 'account' && !config.scope.ref) return 'scope';
  if (!config.profile.kind) return 'profile';
  // Sin ningún campo emparejado no hay nada que importar: falta el paso de columnas.
  if (Object.values(config.fields).every((r) => !r.from)) return 'fields';
  return null;
}

/** Partículas que se pegan a la palabra siguiente y no cuentan como apellido propio. */
const PARTICLES = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y']);

/**
 * Cómo quedaría un nombre según la regla elegida — se muestra con un nombre REAL del archivo de
 * muestra, que es lo único que deja decidir sin adivinar (§2.3).
 *
 * Espejo de `splitName` de la API, y por eso está acá y no en cada app: si las dos pantallas
 * previeran el corte distinto, el usuario elegiría una regla y obtendría otra. El `'—'` es el
 * hueco a dibujar cuando la regla no separa nada.
 */
export function previewName(full: string, order: NameOrder): { lastName: string; firstName: string } {
  /*
   * Con columnas separadas el nombre completo **no se usa**: `splitName` devuelve las columnas
   * `clientLastName` y `clientFirstName` emparejadas aparte y descarta esta cadena. Previsualizar
   * el corte del nombre entero acá decía que todos los clientes iban a entrar sin nombres — lo
   * contrario de lo que hace esa opción, y esta función existe justamente para que las dos
   * pantallas no previean el corte distinto.
   */
  if (order === 'split-columns') return { lastName: '—', firstName: '—' };
  if (order !== 'surnames-first') return { lastName: full, firstName: '—' };
  const words = full.split(/\s+/).filter(Boolean);
  const surnames: string[] = [];
  let i = 0;
  while (i < words.length && surnames.filter((w) => !PARTICLES.has(w)).length < 2) {
    surnames.push(words[i]!);
    i++;
  }
  if (words.length < 3 || i >= words.length) return { lastName: full, firstName: '—' };
  return { lastName: surnames.join(' '), firstName: words.slice(i).join(' ') };
}

/**
 * §2.4: con alcance `Empresa (todos)` y un solo miembro activo, la cartera se autoasigna a esa
 * persona y no hay paso de reparto.
 *
 * ponytail: "un solo miembro activo", no "un solo usuario con capacidad de cobrar". El rol que
 * cobra se llama distinto en cada tenant (COLLECTOR, oficial de crédito, gestor) y acá esto sólo
 * pinta un subtítulo — el autoasignado real lo decide el backend al reconciliar. Si algún día el
 * subtítulo miente en una cuenta con admin + 1 cobrador, se filtra por rol.
 */
export function soleAssignee(members: ScopeMember[]): ScopeMember | null {
  return members.length === 1 ? members[0]! : null;
}

/**
 * Qué pantalla de resultado corresponde. `skipped` NO es "no pasó nada": es "este archivo ya se
 * había aplicado", y por eso llega con los conteos de aquella corrida y sin listas.
 */
export type ResultKind = 'ok' | 'warned' | 'skipped';

export function resultKind(invalid: number, idempotentSkip: boolean): ResultKind {
  if (idempotentSkip) return 'skipped';
  return invalid > 0 ? 'warned' : 'ok';
}
