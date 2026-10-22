import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAccountDto } from './dto/account.dto';

const HASH = 'a'.repeat(64);

async function errorsOf(body: Record<string, unknown>) {
  const errors = await validate(plainToInstance(UpdateAccountDto, body));
  return errors.map((e) => e.property);
}

describe('UpdateAccountDto — identidad y contacto del negocio', () => {
  it('todo es opcional: un parche sin esos campos sigue valiendo', async () => {
    assert.deepEqual(await errorsOf({ businessName: 'Cobranzas Pérez' }), []);
  });

  it('acepta valores válidos', async () => {
    const errors = await errorsOf({
      logoUrl: `/api/uploads/${HASH}.png`,
      phone: '+591 70000000',
      email: 'contacto@minegocio.com',
      website: 'https://minegocio.com',
      address: 'Av. 6 de Agosto #1234',
      city: 'La Paz',
    });
    assert.deepEqual(errors, []);
  });

  it('🔴 null es la forma de quitarlos: pasa la validación, no se confunde con «no tocarlo»', async () => {
    const errors = await errorsOf({ logoUrl: null, phone: null, email: null, website: null, address: null, city: null });
    assert.deepEqual(errors, []);
  });

  it('🔴 el logo sólo puede ser una ruta que devolvió /uploads: ni URL de afuera ni ruta inventada', async () => {
    for (const logoUrl of [
      'https://evil.example/logo.png',
      `//evil.example/api/uploads/${HASH}.png`,
      '/api/uploads/../../etc/passwd',
      `/api/uploads/${'a'.repeat(63)}.png`, // hash corto
      `/api/uploads/${HASH}.svg`, // svg ejecuta scripts: no se admite
      `/api/uploads/${HASH}.png?x=1`,
    ]) {
      assert.deepEqual(await errorsOf({ logoUrl }), ['logoUrl'], logoUrl);
    }
  });

  it('el sitio web exige http(s) con protocolo; javascript: y texto suelto no', async () => {
    assert.deepEqual(await errorsOf({ website: 'minegocio.com' }), ['website']);
    assert.deepEqual(await errorsOf({ website: 'javascript:alert(1)' }), ['website']);
    assert.deepEqual(await errorsOf({ website: 'ftp://minegocio.com' }), ['website']);
    assert.deepEqual(await errorsOf({ website: 'http://minegocio.com/contacto' }), []);
  });

  it('correo y teléfono con forma válida; largos fuera de rango se rechazan', async () => {
    assert.deepEqual(await errorsOf({ email: 'no-es-un-correo' }), ['email']);
    assert.deepEqual(await errorsOf({ phone: '123' }), ['phone']);
    assert.deepEqual(await errorsOf({ city: 'x'.repeat(81) }), ['city']);
    assert.deepEqual(await errorsOf({ address: '' }), ['address']);
  });
});

describe('UpdateAccountDto — preferencias de trabajo', () => {
  it('acepta un parche parcial y uno completo', async () => {
    assert.deepEqual(await errorsOf({ preferences: { workEnd: '17:30' } }), []);
    assert.deepEqual(
      await errorsOf({ preferences: { workDays: [1, 2, 3], workStart: '07:00', workEnd: '15:00', weekStart: 'SUN', defaultLocale: 'en' } }),
      [],
    );
  });

  it('rechaza horas mal escritas, días fuera de 1–7 o repetidos, y valores fuera de lista', async () => {
    for (const preferences of [
      { workStart: '8:00' },
      { workEnd: '25:00' },
      { workDays: [0, 1] },
      { workDays: [1, 8] },
      { workDays: [1, 1] },
      { workDays: [1, 2, 3, 4, 5, 6, 7, 1] },
      { weekStart: 'VIE' },
      { defaultLocale: 'fr' },
    ]) {
      assert.deepEqual(await errorsOf({ preferences }), ['preferences'], JSON.stringify(preferences));
    }
  });

  it('un campo desconocido dentro de preferencias también es error (el pipe global usa forbidNonWhitelisted)', async () => {
    const errors = await validate(plainToInstance(UpdateAccountDto, { preferences: { zona: 'x' } }), { whitelist: true, forbidNonWhitelisted: true });
    assert.ok(errors.length > 0);
  });
});
