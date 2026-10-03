import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';

export class WebAccessError extends Error {}

/** Conservative global-unicast allowlist; reject mapped/transition IPv6 too. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const first = parseInt(address.split(':')[0], 16);
    const second = parseInt(address.split(':')[1] || '0', 16);
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 &&
      !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) &&
      !(first === 0x3fff && second < 0x1000);
  }
  return false;
}

export function publicWebUrl(raw: string): URL {
  if (raw.length > 2048) throw new WebAccessError('URL troppo lungo.');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') ||
      url.username || url.password || url.hash ||
      /(^|\.)(localhost|local|internal|home|lan|test|invalid|onion)$/.test(url.hostname))
    throw new WebAccessError('URL web non consentito: occorre HTTPS pubblico.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isPublicAddress(host))
    throw new WebAccessError('Gli indirizzi locali o riservati non sono consentiti.');
  return url;
}

type HttpOptions = { signal?: AbortSignal; maxBytes?: number; timeoutMs?: number; headers?: Record<string, string> };

/** DNS is validated then pinned to this socket (no rebinding); each redirect is revalidated. */
export async function fetchPublicText(raw: string, options: HttpOptions = {}) {
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 12_000),
    ...(options.signal ? [options.signal] : [])]);
  let url = publicWebUrl(raw);
  const originalOrigin = url.origin;
  for (let hop = 0; hop <= 3; hop++) {
    signal.throwIfAborted();
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const resolving = lookup(hostname, { all: true, verbatim: true });
    const addresses = await new Promise<Awaited<typeof resolving>>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      resolving.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      if (signal.aborted) abort();
    });
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
      throw new WebAccessError('Destinazione di rete privata o riservata bloccata.');
    const pinned = addresses.find((item) => item.family === 4) ?? addresses[0];
    const currentUrl = url;
    const result = await new Promise<{ redirect?: string; text: string; contentType: string }>((resolve, reject) => {
      const req = request(currentUrl, {
        // A fixed family disables automatic family selection and keeps this socket pinned.
        method: 'GET', signal, agent: false, family: pinned.family,
        lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
        headers: {
          'User-Agent': 'Lumi/0.1 (local assistant)',
          Accept: 'application/json, application/rss+xml, text/html, text/plain;q=0.8',
          'Accept-Encoding': 'identity',
          ...(currentUrl.origin === originalOrigin ? options.headers : {}),
        },
      }, (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.destroy();
          resolve({ redirect: res.headers.location, text: '', contentType: '' });
          return;
        }
        const contentType = String(res.headers['content-type'] || '').toLowerCase();
        const maxBytes = options.maxBytes ?? 700_000;
        if (status < 200 || status >= 300 ||
            !/(text\/|application\/(json|[^;]*xml))/.test(contentType) ||
            (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') ||
            Number(res.headers['content-length'] || 0) > maxBytes) {
          res.destroy();
          reject(new WebAccessError(`Risposta web non utilizzabile (HTTP ${status}).`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy(new WebAccessError('Contenuto web troppo grande.'));
          } else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8'), contentType }));
      });
      req.on('error', reject);
      req.end();
    });
    if (!result.redirect) return { ...result, url: currentUrl.href };
    if (hop === 3) throw new WebAccessError('Troppi reindirizzamenti.');
    url = publicWebUrl(new URL(result.redirect, currentUrl).href);
  }
  throw new WebAccessError('Richiesta web non completata.');
}
