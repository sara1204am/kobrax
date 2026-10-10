# SSL pinning de la app móvil (Android / iOS)

Plugin: `apps/mobile/plugins/with-ssl-pinning.js` (config plugin de Expo, se aplica en `expo prebuild` / EAS).
Pruebas: `apps/mobile/plugins/with-ssl-pinning.test.js`.

## 1. Qué se pinnea y por qué

- Host: `api.kobrax.ikigaisystems.lat` (producción; ver `infra/production/05-app.sh` y `README.md`).
- El certificado lo emite **Let's Encrypt** vía Nginx Proxy Manager y **la hoja rota cada ~60-90 días**.
  Pinnear la hoja rompería toda la flota en cada renovación.
- Se pinnea la **clave pública (SPKI SHA-256, base64) de la(s) CA de la cadena**: la intermedia vigente,
  la raíz propia de su jerarquía y una raíz de respaldo. La hoja nunca.
- Android: `res/xml/network_security_config.xml` con `<pin-set expiration>` (OkHttp/`fetch` de RN 0.74 lo respeta, API 24+).
  iOS: `NSPinnedDomains[...].NSPinnedCAIdentities` (coincide con cualquier CA de la cadena, no con la hoja).
- Solo aplica a builds nativas (EAS / `expo prebuild`); en Expo Go no hay pinning.

## 2. Pins vigentes (medidos el 2026-10-09 con un handshake TLS real)

| # | Certificado | Tipo de clave | Vence | Pin (SPKI SHA-256 base64) | Uso |
|---|---|---|---|---|---|
| 0 | hoja `CN=api.kobrax.ikigaisystems.lat` (emisor YE2) | EC secp384r1 | 2026-11-29 | `6Af7r3iVvA26gc4r5DlsbIu3HP3P/hhS5MZpyXpTfCw=` | **NO se pinnea** (rota) |
| 1 | intermedia `Let's Encrypt YE2` (emisor Root YE) | EC secp384r1 | 2028-09-02 | `s/tdAOmUzd8syaTuqfgGvFcn6DzA5Cmb+Vby1ST+U3Y=` | pin |
| 2 | raíz `ISRG Root YE` (cross-firmada por ISRG Root X2) | EC secp384r1 | 2032-09-02 | `sCkq5UWXjg+7mKu9lMhhYF5bGLsy7VI/UNW3tccdR7w=` | pin (cubre YE1, YE2, ...) |
| 3 | raíz `ISRG Root X2` (cross-firmada por ISRG Root X1) | EC secp384r1 | 2032-09-02 | `diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI=` | pin de respaldo |

Configuración que debe llevar `apps/mobile/app.json`:

```json
["./plugins/with-ssl-pinning", {
  "domain": "api.kobrax.ikigaisystems.lat",
  "pins": [
    "s/tdAOmUzd8syaTuqfgGvFcn6DzA5Cmb+Vby1ST+U3Y=",
    "sCkq5UWXjg+7mKu9lMhhYF5bGLsy7VI/UNW3tccdR7w=",
    "diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI="
  ],
  "expiration": "2027-09-30"
}]
```

`expiration` es la válvula: pasada esa fecha Android deja de exigir el pin (vuelve a validar solo con la CA del
sistema). iOS **no** soporta expiración. Hay que publicar una versión con pins/fecha nuevos antes de esa fecha.

## 3. Cómo recalcular los pins

```bash
HOST=api.kobrax.ikigaisystems.lat
openssl s_client -connect $HOST:443 -servername $HOST -showcerts </dev/null 2>/dev/null \
 | awk '/BEGIN CERT/{n++} n{print > "cert" n ".pem"}'
for f in cert*.pem; do
  openssl x509 -in $f -noout -subject -issuer -enddate
  openssl x509 -in $f -pubkey -noout | openssl pkey -pubin -outform der \
    | openssl dgst -sha256 -binary | openssl enc -base64
done
```

Cada pin debe ser base64 de 32 bytes (44 caracteres). El plugin lo valida y exige >= 2 pins distintos.
Ojo: no sustituir pins por la hoja ni por el hash del certificado completo; debe ser el SPKI.

## 4. Rotación segura

1. Let's Encrypt anuncia cambios de jerarquía/intermedias con meses de antelación. Suscribirse a su anuncio y revisar
   la cadena servida cada trimestre con el script de la sección 3.
2. **Publicar la app con el pin nuevo ANTES de que la CA cambie** (el servidor sigue con la cadena vieja; la app
   acepta vieja y nueva porque lleva ambos pins). Esperar a que la adopción de la versión sea alta.
3. Solo después cambiar la cadena en el servidor (renovación / `preferred_chain`). Nunca al revés.
4. Mantener siempre >= 2 pins: uno de la cadena actual y uno de respaldo de otra jerarquía (raíz X2 hoy).
5. Subir `expiration` en cada release de la app (siempre ~12 meses por delante) y recompilar.
6. Caso emergencia: si ya no se puede publicar a tiempo, la fecha `expiration` del pin-set desactiva el pin en Android
   (iOS requiere nueva versión).

## 5. Qué pasa si falla el pinning

- La app **no conecta** a la API (fallo TLS en toda petición). Cualquier cobrador queda sin sincronizar; la cola
  offline guarda los datos localmente y no se pierde nada, pero no sube.
- Mostrar el mensaje de "sin conexión con el servidor" ya existente; soporte debe conocer el síntoma: todos los
  dispositivos fallan a la vez desde una fecha concreta (cambio de CA).
- Recuperación: (a) publicar versión con pins/`expiration` nuevos (EAS update no basta: es config nativa, requiere
  build); (b) mientras tanto, la API sigue accesible por web (panel) con el navegador, que no usa estos pins;
  (c) en Android, la propia `expiration` ya vigente reabre la conexión si llegó la fecha.
- Un build no debe salir a producción sin pins: usar `KOBRAX_REQUIRE_SSL_PINNING=1` en el perfil EAS de producción
  para que el build falle en vez de degradar a NO-OP.

## 6. Cómo probarlo en un teléfono real

1. Generar build (dev client o preview) con los pins puestos; instalarlo en un Android real.
2. En la PC, arrancar `mitmproxy` (o Charles) e instalar su CA en el teléfono (almacén de usuario) y poner el proxy
   Wi-Fi apuntando a la PC.
3. Abrir la app e iniciar sesión: **debe fallar** (error TLS / "sin conexión"). Con una build sin pinning (`enabled:false`)
   el mismo proxy sí funciona; así se confirma que el bloqueo viene del pin.
4. Quitar el proxy: la app debe conectar normal.
5. Verificar además que la prueba no es un falso positivo: `adb logcat | grep -i -E "pin|CertPathValidator"`
   muestra `Certificate pinning failure` en el caso 3.
6. En iOS repetir con Charles; confirmar que falla (requiere iOS 14+).

## 7. Riesgos residuales

- Si Let's Encrypt migra a otra raíz/jerarquía distinta de YE y X2 sin que se publique antes una app con pins nuevos,
  las apps fallarán hasta la `expiration` (Android) o hasta actualizar (iOS).
- Se pinnean CAs, no la hoja: un atacante con una cert emitida por la misma CA (mis-issuance) no se detecta.
  Es el costo aceptado de no pinnear la hoja con Let's Encrypt.
- Android < 7 (API < 24) ignora el NSC: no hay pinning ahí. Los usuarios con root/Frida pueden saltarse el pinning.
- Los hashes de intermedias YE1/YE2 pueden cambiar en cada rotación de LE: por eso el pin principal es la raíz YE.
