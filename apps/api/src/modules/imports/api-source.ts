/**
 * Llamar a la API de la que sale la cartera: la petición que la persona configuró (como en Postman),
 * hecha desde el servidor.
 *
 * 🔴 La URL la escribe un usuario y la llamada sale desde adentro de nuestra red (SSRF): sólo `https`,
 * nunca a una IP privada o local —se comprueba la IP **ya resuelta**, la misma a la que se conecta—,
 * sin seguir redirecciones y con tope de tiempo y de tamaño. La excepción para probar contra una API
 * en la propia máquina es explícita y no existe en producción.
 *
 * Sin Nest ni Prisma → testeable levantando un servidor local.
 */
import { lookup as dnsLookup } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

export type ApiMethod = 'GET' | 'POST';

export interface ApiRequest {
  method: ApiMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ApiSourceOptions {
  /** Permite `http` y direcciones locales. Sólo desarrollo. */
  allowLocal?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

export class ApiSourceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const API_TIMEOUT_MS = 30_000;
/** El mismo tope que un archivo subido. */
export const API_MAX_BYTES = 15 * 1024 * 1024;
const MAX_HEADERS = 20;
const MAX_HEADER_VALUE = 4096;
const MAX_BODY = 20_000;
/** Las pone el cliente HTTP: pisarlas permite desfigurar la petición. */
const RESERVED_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'accept-encoding', 'upgrade', 'expect']);

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, bits, 'ipv4');
}
// En IPv6 se admite sólo el espacio público (2000::/3); fuera quedan loopback, locales y las IPv4 disfrazadas.
const publicV6 = new BlockList();
publicV6.addSubnet('2000::', 3, 'ipv6');
const tunnelV6 = new BlockList();
tunnelV6.addSubnet('2002::', 16, 'ipv6'); // 6to4 lleva una IPv4 adentro

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family === 6) return publicV6.check(address, 'ipv6') && !tunnelV6.check(address, 'ipv6');
  return false;
}

/** La URL, ya validada. No resuelve nombres: eso se comprueba al conectar. */
export function checkApiUrl(raw: string, allowLocal = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiSourceError('IMPORT_API_URL', 'La dirección no es una URL válida');
  }
  if (url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:')) {
    throw new ApiSourceError('IMPORT_API_URL', 'La dirección tiene que empezar con https://');
  }
  if (url.username || url.password) {
    throw new ApiSourceError('IMPORT_API_URL', 'El usuario y la clave van en una cabecera, no en la dirección');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowLocal && isIP(host) && !isPublicAddress(host)) throw privateAddress();
  return url;
}

export function checkApiHeaders(headers: Record<string, string>): void {
  const entries = Object.entries(headers);
  if (entries.length > MAX_HEADERS) throw new ApiSourceError('IMPORT_API_HEADER', `Como máximo ${MAX_HEADERS} cabeceras`);
  for (const [name, value] of entries) {
    if (!/^[A-Za-z0-9!#$%&'*+\-.^_`|~]{1,100}$/.test(name) || RESERVED_HEADERS.has(name.toLowerCase())) {
      throw new ApiSourceError('IMPORT_API_HEADER', `La cabecera "${name}" no se puede usar`);
    }
    // Lo que no entra en una cabecera HTTP (saltos de línea incluidos).
    if (value.length > MAX_HEADER_VALUE || !/^[\t\x20-\x7e\x80-\xff]*$/.test(value)) {
      throw new ApiSourceError('IMPORT_API_HEADER', `El valor de la cabecera "${name}" tiene caracteres no permitidos`);
    }
  }
}

export function checkApiBody(body: string | undefined): void {
  if (body && body.length > MAX_BODY) throw new ApiSourceError('IMPORT_API_BODY', 'El cuerpo es demasiado largo');
}

const privateAddress = (): ApiSourceError =>
  new ApiSourceError('IMPORT_API_BLOCKED', 'Esa dirección apunta a una red privada o local, y no se puede consultar');

/** Resuelve el nombre y corta si alguna de sus IP es privada. Es la que usa la conexión: no hay segunda consulta. */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true }, (error, addresses) => {
    if (error || addresses.length === 0) return callback(error ?? new Error('ENOTFOUND'), '', 4);
    if (!addresses.every((a) => isPublicAddress(a.address))) return callback(privateAddress(), '', 4);
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof addresses) => void)(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

/** Hace la petición y devuelve el cuerpo. Nunca incluye en un error lo que respondió la API ni las cabeceras enviadas. */
export function callApi(req: ApiRequest, opts: ApiSourceOptions = {}): Promise<Buffer> {
  const url = checkApiUrl(req.url, opts.allowLocal);
  checkApiHeaders(req.headers);
  checkApiBody(req.body);
  const timeoutMs = opts.timeoutMs ?? API_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? API_MAX_BYTES;
  const body = req.method === 'POST' && req.body ? Buffer.from(req.body, 'utf8') : undefined;

  const headers: Record<string, string | number> = { accept: 'application/json', 'user-agent': 'Kobrax' };
  if (body) headers['content-type'] = 'application/json';
  for (const [name, value] of Object.entries(req.headers)) headers[name.toLowerCase()] = value;
  headers['accept-encoding'] = 'identity';
  if (body) headers['content-length'] = body.length;
  else if (req.method === 'POST') headers['content-length'] = 0;

  return new Promise<Buffer>((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const signal = AbortSignal.timeout(timeoutMs);
    const fail = (error: Error): void => {
      if (error instanceof ApiSourceError) return reject(error);
      if (signal.aborted) return reject(new ApiSourceError('IMPORT_API_TIMEOUT', 'La API tardó demasiado en responder'));
      reject(new ApiSourceError('IMPORT_API_UNREACHABLE', 'No se pudo conectar con la API'));
    };
    const request = send(
      url,
      { method: req.method, headers, signal, ...(opts.allowLocal ? {} : { lookup: publicLookup }) },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.destroy();
          return reject(new ApiSourceError('IMPORT_API_STATUS', `La API respondió con el código ${status}`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            reject(new ApiSourceError('IMPORT_API_TOO_LARGE', 'La respuesta supera el tamaño máximo (15 MB)'));
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', fail);
        res.on('end', () => (res.complete ? resolve(Buffer.concat(chunks)) : fail(new Error('INCOMPLETE'))));
      },
    );
    request.on('error', fail);
    request.end(body);
  });
}
