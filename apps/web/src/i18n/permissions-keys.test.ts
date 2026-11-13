import { describe, it, expect } from 'vitest';
import { Permission } from '@kobrax/shared';
import es from '@/messages/es.json';
import en from '@/messages/en.json';
import { permissionKey } from '@/lib/roles';

type Dict = { permissions: Record<string, { name?: string; description?: string }>; roles: { modules: Record<string, string>; roleNames: Record<string, string> } };

describe('textos de los permisos (F14 · F7, D-7)', () => {
  for (const [lang, messages] of [['es', es as unknown as Dict], ['en', en as unknown as Dict]] as const) {
    it(`🔴 los ${Object.values(Permission).length} permisos tienen nombre y descripción en ${lang}`, () => {
      for (const code of Object.values(Permission)) {
        const entry = messages.permissions[permissionKey(code)];
        expect(entry?.name, `${lang}: nombre de ${code}`).toBeTruthy();
        expect(entry?.description, `${lang}: descripción de ${code}`).toBeTruthy();
      }
    });

    it(`no sobran textos de permisos que ya no existen (${lang})`, () => {
      const valid = new Set(Object.values(Permission).map(permissionKey));
      for (const key of Object.keys(messages.permissions)) expect(valid.has(key), `${lang}: ${key}`).toBe(true);
    });

    it(`todo módulo del catálogo tiene su nombre en ${lang}`, () => {
      for (const code of Object.values(Permission)) {
        const module = code.split(':')[0]!;
        if (module === 'data') continue;
        expect(messages.roles.modules[module], `${lang}: módulo ${module}`).toBeTruthy();
      }
    });

    it(`los roles de plantilla tienen nombre en ${lang}`, () => {
      for (const key of ['ACCOUNT_ADMIN', 'MANAGER', 'SUPERVISOR', 'COLLECTOR', 'AUDITOR', 'VIEWER']) expect(messages.roles.roleNames[key]).toBeTruthy();
    });
  }
});
