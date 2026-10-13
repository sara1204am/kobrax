# Push remoto (FCM directo, Android) — guía de activación

> **Estado: el código está completo y probado; el envío real NO está verificado** porque falta el proyecto de Firebase, su
> cuenta de servicio y un teléfono Android físico con un build que lleve `google-services.json`.
> Etapa **D-4**, independiente de las funcionalidades offline. Su relación con el pinning está al final.

## 1. Qué hay construido

| Pieza | Dónde | Estado |
|---|---|---|
| Tabla `device_push_tokens` (RLS forzada) | `packages/database/prisma/migrations/20261010000000_device_push_tokens` + `rls/001_enable_rls.sql` | ✅ aplicada y probada en la base local |
| Registrar / renovar / revocar / listar dispositivo | `apps/api/src/modules/notifications/push/devices.*` → `POST/GET/DELETE /api/notifications/devices` | ✅ 28 pruebas |
| Cliente FCM HTTP v1 sin SDK (JWT RS256 con `node:crypto`) | `push/fcm.client.ts` | ✅ probado con `fetch` falso |
| `PushService` (lista cerrada de 6 tipos, texto genérico, reintento, baja de tokens muertos, nunca lanza) | `push/push.service.ts` | ✅ |
| Canal `push` enganchado a `notifyUser` | `notification-channel.ts` | ✅ |
| Registro y renovación en la app, revocación al cerrar sesión, tap con la app abierta/cerrada | `apps/mobile/src/push.service.ts`, `push-target.ts`, `push-pending.ts`, `app/_layout.tsx`, `post-login.ts` | ✅ lógica pura probada; **no corrido en teléfono** |
| `google-services.json` condicional | `apps/mobile/app.config.js` | ✅ |

### Eventos (los del plan)
`ROUTE_ASSIGNED` · `ROUTE_CHANGE_REQUESTED` · `ROUTE_CHANGE_DECIDED` · `AGENDA_ASSIGNED` · `AGENDA_CHANGED` · `PROMISE_DUE`.
El destinatario y la condición de cada uno **ya los decide el emisor existente** (`NotificationsService`, `PromiseDueService`):
el canal de push solo se suma después de crear la notificación interna, así que **no hay un camino nuevo que pueda
duplicar**. Sin duplicados al reintentar: las operaciones de negocio idempotentes no emiten dos veces (replay sin notificar)
y el push lleva `tag = id de la notificación` (el teléfono reemplaza, no apila).

### Privacidad
El texto de pantalla bloqueada es **fijo y genérico** («Tienes una ruta nueva.», …): sin nombres, importes ni datos del
cliente. En `data` viajan solo ids opacos (`nid`, `uid`, `rid`, `aid`, `cid`). La app **no confía** en el push: navega y
pide el detalle a la API, y descarta el aviso si `uid` no es el usuario de la sesión.

## 2. Qué necesitas aportar (bloqueos externos)

1. **Un proyecto de Firebase** (gratis; plan Spark alcanza) con una app Android de package **`demo.kobrax.mobile`**
   (el de `app.json`; si se cambia para producción, hay que registrar el nuevo).
2. **La cuenta de servicio** del proyecto con el rol *Firebase Cloud Messaging API Admin*
   (Configuración del proyecto → Cuentas de servicio → *Generar nueva clave privada* → un `.json`).
3. **`google-services.json`** de esa app Android (Configuración del proyecto → tus apps → descargar).
4. **Un teléfono Android físico** con el build de desarrollo. Los emuladores sin Google Play Services no reciben FCM.

> No inventes ni commitees estos archivos: `google-services.json` está en `.gitignore` y la cuenta de servicio **nunca**
> entra al repositorio.

## 3. Activación, paso a paso

### Servidor
```bash
# 1) la cuenta de servicio en base64 (una sola línea)
base64 -w0 kobrax-firebase-adminsdk.json        # macOS: base64 -i archivo.json | tr -d '\n'

# 2) en /opt/kobrax/.env del servidor
FCM_SERVICE_ACCOUNT_JSON_B64=<la línea del paso 1>

# 3) migración (crea device_push_tokens) y reinicio
pnpm db:deploy
./deploy.sh            # 05-app.sh deriva el .env de la app e incluye la variable
```
Al arrancar, la API loguea `FCM configurado (proyecto <id>)`. Si las credenciales están mal formadas loguea
`Credenciales de FCM inválidas … El push remoto queda apagado` **sin imprimir el contenido**.

Alternativa sin base64: `FCM_SERVICE_ACCOUNT_FILE=/ruta/fuera/del/repo/cuenta.json` (permisos `600`).

### Móvil
```bash
cd apps/mobile
cp /ruta/descargada/google-services.json ./google-services.json   # o GOOGLE_SERVICES_JSON=/ruta/al.json
npx expo prebuild --clean
npx expo run:android            # por cable, teléfono físico
```
Sin el archivo el build **compila y corre igual**, pero avisa por consola
`google-services.json no encontrado: este build NO tendrá push remoto` y la app no registra dispositivo (los avisos
locales de la agenda y la bandeja siguen funcionando).

### Verificación (checklist de aceptación)
- [ ] La API arranca con `FCM configurado (proyecto …)`.
- [ ] Al iniciar sesión en el teléfono (con permiso concedido) aparece una fila en `device_push_tokens` (`SELECT user_id, platform, is_active, last_seen_at FROM device_push_tokens`).
- [ ] `GET /api/notifications/devices` lista el dispositivo **sin** el token.
- [ ] Con la app **cerrada**, asignarle una ruta desde la web hace sonar «Tienes una ruta nueva.» y al tocarlo abre Rutas.
- [ ] Con la app en segundo plano, una gestión asignada abre `/agenda/<id>`.
- [ ] Cerrar sesión borra la fila (o la deja inactiva) y el teléfono deja de recibir.
- [ ] Iniciar sesión en el mismo teléfono con **otro usuario** y asignarle algo al primero: **no** muestra el aviso.
- [ ] Revocar el permiso de notificaciones en Ajustes: la app sigue funcionando sin errores.
- [ ] Desinstalar y reinstalar: el token viejo pasa a inactivo tras el primer envío fallido (`UNREGISTERED`).

## 4. Operación y diagnóstico

| Síntoma | Qué mirar |
|---|---|
| No llega nada | ¿hay `FCM configurado` en el log? ¿fila activa del usuario? `last_error` y `failure_count` en `device_push_tokens` |
| `last_error = UNREGISTERED` | el token murió (desinstalaron): se da de baja solo; el teléfono lo vuelve a registrar al abrir la app |
| `failure_count` creciendo | fallo transitorio de red/FCM; tras 5 seguidos se da de baja y se re-registra en el próximo arranque |
| El aviso llega pero no navega | revisar que `data.type` sea uno de los 6 y los ids sean UUID (se validan antes de navegar) |

Se limpian solos los tokens sin verse hace 60 días (oportunista, al registrar). Un teléfono que cambia de usuario **dentro de
la misma empresa** desactiva el token del anterior; **entre empresas** la RLS impide tocar la fila ajena, y ahí cubren el
`uid` del aviso y la revocación al cerrar sesión (mejor esfuerzo, ver riesgos).

## 5. Riesgos residuales (honestos)

- **Cierre de sesión sin red**: la revocación del dispositivo es de mejor esfuerzo. Si no hay señal al salir, la fila queda
  activa hasta el próximo registro de ese teléfono. Mitigación: el aviso lleva `uid` y la app descarta el de otra persona.
- **Entrega no garantizada**: FCM es de mejor esfuerzo (Doze, ahorro de batería de algunos fabricantes). Por eso la bandeja
  interna y los avisos locales **no** dependen del push.
- **Sin iOS**: esta etapa es Android. iOS necesitaría APNs (clave en Firebase) y un build firmado; no está en el alcance.
- **Un solo canal Android** (`kobrax-avisos`, importancia alta). Si el usuario lo silencia en el sistema, no suena.

## 6. Relación con el SSL pinning (D-4)

El plan pide cerrar el pinning real **junto** al push. **Está implementado a nivel de código y de configuración**
(`apps/mobile/plugins/with-ssl-pinning.js`, 20 pruebas; pins medidos del certificado de producción; guía en
`docs/security/SSL-PINNING-MOVIL.md`) pero **no verificado en un teléfono**: hace falta un `expo prebuild` y comprobar con un
proxy (mitmproxy/Charles) que la conexión falla con el pin puesto y funciona sin proxy. Hasta esa prueba, la etapa de
push+pinning se considera **«implementada, sin verificar en dispositivo»**, no «terminada».
