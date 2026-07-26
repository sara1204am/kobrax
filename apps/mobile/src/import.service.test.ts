import {
  applyFieldState,
  decideImportGate,
  fieldState,
  lastRunWhen,
  previewName,
  setupProgress,
  setupStep,
  type ImportConfig,
} from './import.service';

const cfg = (over: Partial<ImportConfig> = {}): ImportConfig => ({
  source: 'file',
  profile: { kind: 'rows', headerRow: 1 },
  fields: { code: { from: 'NRO' } },
  nameOrder: 'full',
  scope: { kind: 'account', ref: null },
  absentRule: 'set-current',
  carriesAssignee: false,
  askOnLogin: true,
  ...over,
});

describe('fieldState — un control, tres estados (§6.5)', () => {
  it('mapea la regla al estado que ve el usuario', () => {
    expect(fieldState(undefined)).toBe('off');
    expect(fieldState({ enabled: false })).toBe('off');
    expect(fieldState({ from: 'X' })).toBe('optional');
    expect(fieldState({ from: 'X', required: true })).toBe('required');
  });

  it('el ida y vuelta no pierde el emparejado', () => {
    const rule = { from: 'ATRASO', in: 'table' as const, required: true };
    const apagado = applyFieldState(rule, 'off');
    expect(apagado.from).toBe('ATRASO');
    expect(apagado.in).toBe('table');
    expect(fieldState(apagado)).toBe('off');
    expect(fieldState(applyFieldState(apagado, 'required'))).toBe('required');
  });

  it('nunca deja el estado contradictorio del invariante 1', () => {
    const off = applyFieldState({ from: 'X', required: true }, 'off');
    expect(off.enabled).toBe(false);
    expect(off.required).toBe(false); // apagado NO puede quedar obligatorio
  });
});

describe('setupStep — asistente de primera vez (§6.9)', () => {
  it('pide las cosas en el orden en que dependen entre sí', () => {
    expect(setupStep(cfg({ source: 'manual' }))).toBe('source');
    expect(setupStep(cfg({ scope: { kind: 'branch', ref: null } }))).toBe('scope');
    expect(setupStep(cfg({ fields: {} }))).toBe('fields');
    expect(setupStep(cfg({ fields: { code: { enabled: true } } }))).toBe('fields'); // sin `from` no alcanza
  });

  it('con todo configurado se apaga', () => {
    expect(setupStep(cfg())).toBeNull();
    expect(setupProgress(null)).toBeNull();
  });

  it('la barra muestra en qué paso va', () => {
    expect(setupProgress('profile')).toEqual({ current: 3, total: 4 });
  });
});

describe('previewName — la decisión que el archivo no puede responder (§2.3)', () => {
  it('todo junto va a APELLIDOS, no a nombres (C13)', () => {
    expect(previewName('MARTINEZ DURAN JUAN ANTONIO', 'full')).toEqual({
      lastName: 'MARTINEZ DURAN JUAN ANTONIO',
      firstName: '—',
    });
  });

  it('dos apellidos y el resto nombres', () => {
    expect(previewName('MARTINEZ DURAN JUAN ANTONIO', 'surnames-first')).toEqual({
      lastName: 'MARTINEZ DURAN',
      firstName: 'JUAN ANTONIO',
    });
  });

  it('las partículas se pegan al apellido siguiente', () => {
    expect(previewName('DE LA CRUZ MAMANI ROSA', 'surnames-first')).toEqual({
      lastName: 'DE LA CRUZ MAMANI',
      firstName: 'ROSA',
    });
  });

  it('menos de tres palabras: no adivina, deja entero', () => {
    expect(previewName('PEREZ JUAN', 'surnames-first').lastName).toBe('PEREZ JUAN');
  });
});

describe('decideImportGate — el toggle "preguntar al iniciar sesión" (§6.7)', () => {
  const now = new Date('2026-07-25T09:00:00');
  const sinFlags = { lastDay: null, skipDay: null };
  const file = { source: 'file' as const, askOnLogin: true };

  it('ofrece el import el primer login del día', () => {
    expect(decideImportGate(file, sinFlags, now)).toBe(true);
  });

  it('askOnLogin apagado → nunca interrumpe; se entra por el menú', () => {
    expect(decideImportGate({ ...file, askOnLogin: false }, sinFlags, now)).toBe(false);
  });

  it('tenant que carga a mano → el módulo no existe para él', () => {
    expect(decideImportGate({ source: 'manual', askOnLogin: true }, sinFlags, now)).toBe(false);
  });

  it('ya importó hoy → no molesta', () => {
    expect(decideImportGate(file, { lastDay: '2026-07-25', skipDay: null }, now)).toBe(false);
  });

  it('saltó hoy → no molesta HOY, pero el flag es otro: saltar no es importar', () => {
    expect(decideImportGate(file, { lastDay: null, skipDay: '2026-07-25' }, now)).toBe(false);
    // Al día siguiente vuelve a ofrecer, porque nunca se importó.
    expect(decideImportGate(file, { lastDay: null, skipDay: '2026-07-25' }, new Date('2026-07-26T09:00:00'))).toBe(true);
  });

  it('lo de ayer no cuenta', () => {
    expect(decideImportGate(file, { lastDay: '2026-07-24', skipDay: '2026-07-24' }, now)).toBe(true);
  });
});

describe('lastRunWhen', () => {
  it('distingue hoy de otro día', () => {
    const now = new Date('2026-07-25T20:00:00');
    expect(lastRunWhen('2026-07-25T08:14:00', now)).toBe('Hoy 08:14');
    expect(lastRunWhen('2026-07-24T08:14:00', now)).toBe('24 jul 08:14');
  });
});
