/**
 * Config plugin de SSL pinning para Kobrax (EPIC-F2b historia 15).
 *
 * ⚠️ REQUIERE DEV BUILD / PREBUILD (EAS o `expo prebuild`). NO funciona en Expo Go,
 * porque inyecta configuración nativa (Android network-security-config + iOS
 * NSPinnedDomains). En Expo Go el pinning simplemente no aplica.
 *
 * El pinning usa hashes SPKI SHA-256 (base64). Para obtenerlos del certificado real:
 *   openssl s_client -connect api.kobrax.com:443 | openssl x509 -pubkey -noout \
 *     | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64
 *
 * Configuración (app.json → plugins): ["./plugins/with-ssl-pinning", { "domain": "...", "pins": ["sha256/AAAA..."] }]
 * Si no se pasan pins, el plugin es un NO-OP seguro (no rompe TLS) y avisa por consola.
 * Pasa siempre ≥2 pins (uno de respaldo) para no quedar fuera al rotar el certificado.
 */
const {
  withAndroidManifest,
  withDangerousMod,
  withInfoPlist,
  AndroidConfig,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const NSC_RESOURCE = 'network_security_config';

/** Normaliza "sha256/XXXX" → "XXXX" (los <pin> de Android llevan el digest sin prefijo). */
function bareDigest(pin) {
  return pin.replace(/^sha256\//, '');
}

function buildNetworkSecurityXml(domain, pins) {
  const pinTags = pins
    .map((p) => `      <pin digest="SHA-256">${bareDigest(p)}</pin>`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config>
    <domain includeSubdomains="true">${domain}</domain>
    <pin-set>
${pinTags}
    </pin-set>
  </domain-config>
</network-security-config>
`;
}

/** Android: escribe res/xml/network_security_config.xml y lo referencia en el manifest. */
function withAndroidSslPinning(config, { domain, pins }) {
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const xmlDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, `${NSC_RESOURCE}.xml`), buildNetworkSecurityXml(domain, pins));
      return cfg;
    },
  ]);

  config = withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$['android:networkSecurityConfig'] = `@xml/${NSC_RESOURCE}`;
    return cfg;
  });

  return config;
}

/** iOS: NSPinnedDomains en Info.plist (App Transport Security). */
function withIosSslPinning(config, { domain, pins }) {
  return withInfoPlist(config, (cfg) => {
    const ats = cfg.modResults.NSAppTransportSecurity ?? {};
    ats.NSPinnedDomains = {
      ...(ats.NSPinnedDomains ?? {}),
      [domain]: {
        NSIncludesSubdomains: true,
        NSPinnedCAIdentities: pins.map((p) => ({ 'SPKI-SHA256-BASE64': bareDigest(p) })),
      },
    };
    cfg.modResults.NSAppTransportSecurity = ats;
    return cfg;
  });
}

module.exports = function withSslPinning(config, props = {}) {
  const { domain, pins } = props;
  if (!domain || !Array.isArray(pins) || pins.length === 0) {
    // NO-OP seguro: sin pins no tocamos la red (evita romper TLS en dev).
    console.warn('[with-ssl-pinning] sin `pins` configurados → pinning desactivado (NO-OP).');
    return config;
  }
  config = withAndroidSslPinning(config, { domain, pins });
  config = withIosSslPinning(config, { domain, pins });
  return config;
};
