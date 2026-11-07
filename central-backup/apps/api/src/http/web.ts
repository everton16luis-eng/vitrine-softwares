// Serve o build do painel web (apps/web/dist) pela mesma origem da API: o cookie de sessão é
// SameSite=Strict e o CSRF vai em cabeçalho, então front e API precisam ser o mesmo site.
// Sem dependência extra: só arquivos de dentro do diretório do build, com fallback de SPA.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

/**
 * CSP do painel: só scripts e conexões da própria origem. `style-src 'unsafe-inline'` é necessário
 * porque os gráficos (recharts) e o layout usam atributos `style`; nenhum script inline é permitido.
 */
export const PANEL_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",
  "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"
].join('; ');

export function webHandler(distDir: string) {
  const root = path.resolve(distDir);
  const index = path.join(root, 'index.html');
  const available = () => existsSync(index);
  return {
    available,
    /** Retorna true se respondeu (arquivo do build ou index.html da SPA). */
    serve(req: FastifyRequest, reply: FastifyReply): boolean {
      if (req.method !== 'GET' && req.method !== 'HEAD') return false;
      let url: string;
      try { url = decodeURIComponent((req.raw.url ?? '/').split('?')[0]!); } catch { return false; }
      if (url.startsWith('/api/') || url === '/api' || url.includes('\0')) return false;
      if (!available()) return false;
      const file = path.resolve(root, `.${url}`);
      const inside = file === root || file.startsWith(root + path.sep);
      let target = index;
      if (inside && url !== '/' && existsSync(file) && statSync(file).isFile()) target = file;
      else if (path.extname(url)) return false; // arquivo inexistente: 404 normal, não a SPA
      const ext = path.extname(target);
      const hashed = target.includes(`${path.sep}assets${path.sep}`);
      reply.header('content-type', TYPES[ext] ?? 'application/octet-stream')
        .header('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache')
        .header('content-security-policy', PANEL_CSP)
        .header('x-robots-tag', 'noindex');
      reply.code(200).send(readFileSync(target));
      return true;
    }
  };
}
