const fs = require('fs');
const os = require('os');
const path = require('path');
const plugin = require('./with-ssl-pinning');

const {
  buildAndroidNetworkSecurityConfig,
  buildIosPinnedDomain,
  validatePins,
  validateDomain,
  validateExpiration,
  resolveOptions,
  resolveNscWrite,
  GENERATED_MARKER,
} = plugin;

// Pins reales (intermedia YE2 y raíz Root YE de Let's Encrypt), ver docs/security/SSL-PINNING-MOVIL.md
const PIN_A = 's/tdAOmUzd8syaTuqfgGvFcn6DzA5Cmb+Vby1ST+U3Y=';
const PIN_B = 'sCkq5UWXjg+7mKu9lMhhYF5bGLsy7VI/UNW3tccdR7w=';
const NOW = new Date('2026-10-09T00:00:00Z');

describe('with-ssl-pinning: validatePins', () => {
  it('acepta 2 pins válidos y quita el prefijo sha256/', () => {
    expect(validatePins([`sha256/${PIN_A}`, PIN_B])).toEqual([PIN_A, PIN_B]);
  });
  it('falla con menos de 2 pins', () => {
    expect(() => validatePins([PIN_A])).toThrow(/al menos 2/);
  });
  it('falla con pins duplicados', () => {
    expect(() => validatePins([PIN_A, `sha256/${PIN_A}`])).toThrow(/duplicados/);
  });
  it('falla con pin mal formado (no base64 / largo incorrecto)', () => {
    expect(() => validatePins([PIN_A, 'AAAA'])).toThrow(/mal formado/);
    expect(() => validatePins([PIN_A, 'no es base64 !!'])).toThrow(/mal formado/);
    expect(() => validatePins([PIN_A, Buffer.alloc(20).toString('base64')])).toThrow(/mal formado/);
  });
  it('falla si no es array', () => {
    expect(() => validatePins('x')).toThrow(/array/);
  });
});

describe('with-ssl-pinning: domain / expiration', () => {
  it('dominio vacío o inválido falla', () => {
    expect(() => validateDomain('')).toThrow(/obligatorio/);
    expect(() => validateDomain(undefined)).toThrow(/obligatorio/);
    expect(() => validateDomain('https://api.kobrax.ikigaisystems.lat')).toThrow(/inválido/);
    expect(() => validateDomain('*.kobrax.com')).toThrow(/inválido/);
  });
  it('expiración inválida falla', () => {
    expect(() => validateExpiration('2027/01/01', NOW)).toThrow(/YYYY-MM-DD/);
    expect(() => validateExpiration('2027-02-30', NOW)).toThrow(/fecha real/);
    expect(() => validateExpiration('2026-01-01', NOW)).toThrow(/ya pasó/);
  });
  it('expiración válida u omitida', () => {
    expect(validateExpiration('2027-09-30', NOW)).toBe('2027-09-30');
    expect(validateExpiration(undefined, NOW)).toBeUndefined();
  });
});

describe('with-ssl-pinning: resolveOptions', () => {
  const base = { domain: 'api.kobrax.ikigaisystems.lat', pins: [PIN_A, PIN_B], expiration: '2027-09-30' };
  it('config válida queda activa', () => {
    const o = resolveOptions(base, {}, NOW);
    expect(o).toMatchObject({ active: true, domain: base.domain, pins: [PIN_A, PIN_B], ios: true });
  });
  it('enabled:false no activa nada', () => {
    expect(resolveOptions({ ...base, enabled: false }, {}, NOW)).toEqual({ active: false, reason: 'disabled' });
  });
  it('pins vacío es NO-OP, salvo KOBRAX_REQUIRE_SSL_PINNING=1 que falla', () => {
    expect(resolveOptions({ domain: base.domain, pins: [] }, {}, NOW)).toEqual({ active: false, reason: 'no-pins' });
    expect(() => resolveOptions({ domain: base.domain, pins: [] }, { KOBRAX_REQUIRE_SSL_PINNING: '1' }, NOW)).toThrow(
      /KOBRAX_REQUIRE_SSL_PINNING/,
    );
  });
  it('pins presentes con dominio vacío o un solo pin lanza (no degrada a NO-OP)', () => {
    expect(() => resolveOptions({ ...base, domain: '' }, {}, NOW)).toThrow(/obligatorio/);
    expect(() => resolveOptions({ ...base, pins: [PIN_A] }, {}, NOW)).toThrow(/al menos 2/);
  });
});

describe('with-ssl-pinning: XML Android e iOS', () => {
  it('genera el XML esperado', () => {
    const xml = buildAndroidNetworkSecurityConfig({
      domain: 'api.kobrax.ikigaisystems.lat',
      pins: [PIN_A, PIN_B],
      expiration: '2027-09-30',
    });
    expect(xml).toContain(GENERATED_MARKER);
    expect(xml).toContain('<domain-config cleartextTrafficPermitted="false">');
    expect(xml).toContain('<domain includeSubdomains="true">api.kobrax.ikigaisystems.lat</domain>');
    expect(xml).toContain('<trust-anchors>');
    expect(xml).toContain('<certificates src="system"/>');
    expect(xml).toContain('<pin-set expiration="2027-09-30">');
    expect(xml).toContain(`<pin digest="SHA-256">${PIN_A}</pin>`);
    expect(xml).toContain(`<pin digest="SHA-256">${PIN_B}</pin>`);
  });
  it('sin expiration omite el atributo', () => {
    const xml = buildAndroidNetworkSecurityConfig({ domain: 'a.example.com', pins: [PIN_A, PIN_B] });
    expect(xml).toContain('<pin-set>');
  });
  it('iOS usa NSPinnedCAIdentities', () => {
    expect(buildIosPinnedDomain({ pins: [PIN_A, PIN_B] })).toEqual({
      NSIncludesSubdomains: true,
      NSPinnedCAIdentities: [{ 'SPKI-SHA256-BASE64': PIN_A }, { 'SPKI-SHA256-BASE64': PIN_B }],
    });
  });
});

describe('with-ssl-pinning: NSC preexistente', () => {
  const generated = buildAndroidNetworkSecurityConfig({ domain: 'a.example.com', pins: [PIN_A, PIN_B] });
  it('no pisa un NSC ajeno', () => {
    expect(() => resolveNscWrite('<network-security-config/>', generated)).toThrow(/no se sobrescribe/);
  });
  it('regenera uno propio y crea si no existe', () => {
    expect(resolveNscWrite(generated, generated)).toBe(generated);
    expect(resolveNscWrite(null, generated)).toBe(generated);
  });
});

describe('with-ssl-pinning: plugin completo', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  afterAll(() => warn.mockRestore());

  it('enabled:false devuelve la config sin mods ni escribir archivos', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nsc-'));
    const cfg = { name: 'x' };
    const out = plugin(cfg, { enabled: false, domain: 'a.example.com', pins: [PIN_A, PIN_B] });
    expect(out).toBe(cfg);
    expect(out.mods).toBeUndefined();
    expect(fs.readdirSync(tmp)).toHaveLength(0);
  });
  it('config inválida lanza al aplicar el plugin', () => {
    expect(() => plugin({ name: 'x' }, { domain: 'a.example.com', pins: [PIN_A] })).toThrow(/al menos 2/);
  });
  it('config válida registra mods de android e ios', () => {
    const out = plugin(
      { name: 'x' },
      { domain: 'a.example.com', pins: [PIN_A, PIN_B], expiration: '2099-01-01' },
    );
    expect(out.mods.android).toBeDefined();
    expect(out.mods.ios).toBeDefined();
  });
});
