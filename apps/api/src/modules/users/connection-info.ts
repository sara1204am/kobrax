/**
 * Lo que se le enseña a un administrador de una conexión ajena: navegador, sistema y una IP
 * **enmascarada**. El user-agent crudo y la IP completa no salen de la API: sirven para rastrear a
 * una persona y la pantalla no los necesita para decir «Windows · Chrome desde Sucre».
 */
export function parseUserAgent(ua: string | null | undefined): { browser: string | null; os: string | null } {
  if (!ua) return { browser: null, os: null };
  // El orden importa: Edge y Opera dicen «Chrome»; Chrome dice «Safari»; iOS dice «Mac OS X».
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /okhttp|Expo|ReactNative/i.test(ua)
              ? 'App Kobrax'
              : null;
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iOS/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : /okhttp/i.test(ua)
              ? 'Android'
              : null;
  return { browser, os };
}

/** `190.129.12.34` → `190.129.*.*` · `2800:cd0:1:2::3` → `2800:cd0:*`. Sin IP, `null`. */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const clean = ip.replace(/^::ffff:/, '');
  if (clean.includes(':')) return `${clean.split(':').slice(0, 2).join(':')}:*`;
  const parts = clean.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.*.*` : null;
}
