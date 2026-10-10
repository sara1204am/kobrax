import { describe, expect, it } from 'vitest';
import { mapLink, whatsappLink } from './contact-links.js';

describe('whatsappLink', () => {
  it('deja solo los dígitos del teléfono y codifica el mensaje', () => {
    expect(whatsappLink('+591 780-12345', 'Hola ¿coordinamos?')).toBe('https://wa.me/59178012345?text=Hola%20%C2%BFcoordinamos%3F');
  });
  it('sin mensaje no agrega el parámetro', () => {
    expect(whatsappLink('78012345')).toBe('https://wa.me/78012345');
  });
});

describe('mapLink', () => {
  it('apunta al punto en un mapa abierto', () => {
    expect(mapLink(-16.5, -68.15)).toBe('https://www.openstreetmap.org/?mlat=-16.5&mlon=-68.15#map=17/-16.5/-68.15');
  });
});
