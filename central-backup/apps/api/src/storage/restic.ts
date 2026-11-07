// restic executado pela central (teste de destino, inicialização e manutenção de repositórios).
// Senha do repositório sempre por arquivo temporário 0600 (RESTIC_PASSWORD_FILE), nunca por argumento.
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redact } from '@central/shared';

export interface ResticRun { stdout: string; stderr: string; code: number }

export async function restic(bin: string, args: string[], opts: { repo: string; password: string; env?: Record<string, string>; timeoutMs?: number; known?: string[] }): Promise<ResticRun> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-restic-'));
  const pwFile = path.join(dir, 'pw');
  writeFileSync(pwFile, opts.password, { mode: 0o600 });
  try {
    return await new Promise<ResticRun>((resolve) => {
      execFile(bin, ['--no-cache', '--quiet', ...args], {
        timeout: opts.timeoutMs ?? 120_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
        env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', TEMP: os.tmpdir(), TMP: os.tmpdir(), HOME: os.tmpdir(),
          RESTIC_REPOSITORY: opts.repo, RESTIC_PASSWORD_FILE: pwFile, ...opts.env }
      }, (err, stdout, stderr) => {
        const known = [opts.password, ...(opts.known ?? []), ...Object.values(opts.env ?? {})];
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : -1) : 0;
        resolve({ stdout, stderr: redact(String(stderr || (err && !stderr ? err.message : '')), known).slice(0, 4000), code });
      });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** URL de repositório no rest-server com usuário/senha embutidos (só em memória/variável de ambiente). */
export function restUrl(base: string, user: string, password: string, repoPath: string) {
  const u = new URL(base);
  u.username = encodeURIComponent(user);
  u.password = encodeURIComponent(password);
  u.pathname = `/${repoPath.replace(/^\/+/, '')}`;
  return `rest:${u.toString().replace(/\/$/, '')}`;
}
