// Cliente HTTPS do agente. Conexões sempre de saída; o servidor é validado pela CA da central
// (fixada por SHA-256 no registro) e o agente se autentica com o próprio certificado (mTLS).
import https from 'node:https';

export interface Tls { ca?: string; cert?: string; key?: string; insecureForPinnedFetch?: boolean }

export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    super(typeof body === 'object' && body && 'title' in body ? String((body as { title: unknown }).title) : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

export interface Response { status: number; headers: Record<string, string | string[] | undefined>; text: string; json: unknown }

export function request(url: string, { method = 'GET', body, tls, timeoutMs = 30_000 }: { method?: string; body?: unknown; tls: Tls; timeoutMs?: number }): Promise<Response> {
  const u = new URL(url);
  if (u.protocol !== 'https:') return Promise.reject(new Error('A central precisa ser acessada por HTTPS.'));
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = https.request(u, {
      method,
      ca: tls.ca, cert: tls.cert, key: tls.key,
      rejectUnauthorized: !tls.insecureForPinnedFetch,
      minVersion: 'TLSv1.3',
      headers: { accept: 'application/json', ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}), 'user-agent': 'central-agent' },
      timeout: timeoutMs
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size > 8 * 1024 * 1024) req.destroy(new Error('Resposta grande demais.')); else chunks.push(c); });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: unknown = null;
        if (String(res.headers['content-type'] ?? '').includes('json') && text) { try { json = JSON.parse(text); } catch { json = null; } }
        const out = { status: res.statusCode ?? 0, headers: res.headers, text, json };
        if (out.status >= 400) reject(new HttpError(out.status, json)); else resolve(out);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado na conexão com a central.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Cliente autenticado (mTLS); o material TLS pode ser trocado após a renovação do certificado. */
export class GatewayClient {
  private readonly baseUrl: string;
  private tls: Tls;
  constructor(baseUrl: string, tls: Tls) { this.baseUrl = baseUrl; this.tls = tls; }
  setTls(tls: Tls) { this.tls = tls; }
  async call<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    const res = await request(new URL(path, this.baseUrl).toString(), { method, body, tls: this.tls, timeoutMs });
    return res.json as T;
  }
}
