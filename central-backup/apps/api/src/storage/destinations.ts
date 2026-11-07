// Destinos de backup e repositórios restic.
//
// local_rest: disco da própria central servido pelo rest-server em modo --append-only --private-repos.
//   - os agentes só gravam (não apagam) e cada servidor só enxerga o próprio repositório;
//   - a central faz a manutenção (forget/prune/check) direto no disco, onde mora o repositório.
// s3: qualquer serviço compatível (AWS, MinIO, Cloudflare R2, Backblaze B2) via backend s3 do restic.
import { existsSync, mkdirSync, readFileSync, renameSync, statfsSync, writeFileSync, rmSync, accessSync, constants } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import { validate, SAFE_PATH_PATTERN } from '@central/contracts';
import { validationError, conflict } from '@central/shared';
import type { Tx } from '@central/database';
import type { SecretStore } from '../secrets.ts';
import { restic, restUrl } from './restic.ts';

export const LocalRestConfig = Type.Object({
  /** endereço pelo qual os AGENTES alcançam o rest-server (https em produção) */
  agent_url: Type.String({ pattern: '^https?://[^\\s/]+(:\\d+)?/?$', maxLength: 200 }),
  /** diretório de dados do rest-server (--path) no disco da central */
  data_dir: Type.String({ pattern: SAFE_PATH_PATTERN, maxLength: 500 })
}, { additionalProperties: false });

export const S3Config = Type.Object({
  provider: Type.Union([Type.Literal('aws'), Type.Literal('minio'), Type.Literal('r2'), Type.Literal('b2'), Type.Literal('outro')]),
  endpoint: Type.String({ pattern: '^https?://[^\\s]+$', maxLength: 300 }),
  bucket: Type.String({ pattern: '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' }),
  prefix: Type.Optional(Type.String({ pattern: '^[A-Za-z0-9/_-]{0,200}$' })),
  region: Type.Optional(Type.String({ pattern: '^[a-z0-9-]{2,40}$' }))
}, { additionalProperties: false });

export const S3Credentials = Type.Object({ access_key_id: Type.String({ minLength: 3, maxLength: 200 }), secret_access_key: Type.String({ minLength: 8, maxLength: 300 }) }, { additionalProperties: false });

export type DestinationKind = 'local_rest' | 's3';
export interface DestinationRow { id: number; client_id: number | null; kind: DestinationKind; name: string; config: Record<string, any>; access_secret_id: number | null }

export function checkConfig(kind: DestinationKind, config: unknown) {
  const v = validate(kind === 'local_rest' ? LocalRestConfig : S3Config, config);
  if (!v.ok) throw validationError(Object.fromEntries(Object.entries(v.errors).map(([k, m]) => [`config.${k}`, m])), 'Configuração do destino inválida.');
  return v.value as Static<typeof LocalRestConfig> | Static<typeof S3Config>;
}

const s3Env = (cred: Static<typeof S3Credentials>, cfg: Static<typeof S3Config>): Record<string, string> =>
  ({ AWS_ACCESS_KEY_ID: cred.access_key_id, AWS_SECRET_ACCESS_KEY: cred.secret_access_key, ...(cfg.region ? { AWS_DEFAULT_REGION: cfg.region } : {}) });

function s3Repo(cfg: Static<typeof S3Config>, sub: string) {
  const prefix = [cfg.prefix, sub].filter(Boolean).join('/').replace(/\/+/g, '/');
  return `s3:${cfg.endpoint.replace(/\/$/, '')}/${cfg.bucket}/${prefix}`;
}

async function s3Credentials(tx: Tx, store: SecretStore, dest: DestinationRow) {
  if (!dest.access_secret_id) throw conflict('Destino S3 sem credencial definida.');
  const v = validate(S3Credentials, JSON.parse(await store.reveal(tx, dest.access_secret_id)));
  if (!v.ok) throw conflict('Credencial do destino em formato inválido.');
  return v.value;
}

/** Teste real: cria um repositório restic descartável no destino, lê a configuração e remove. */
export async function testDestination(tx: Tx, store: SecretStore, dest: DestinationRow, resticBin: string) {
  const password = randomBytes(24).toString('base64url');
  const sub = `_central-teste-${Date.now().toString(36)}`;
  const details: Record<string, unknown> = {};
  if (dest.kind === 'local_rest') {
    const cfg = dest.config as Static<typeof LocalRestConfig>;
    if (!existsSync(cfg.data_dir)) return { ok: false, error: `Diretório ${cfg.data_dir} não existe na central.`, details };
    try { accessSync(cfg.data_dir, constants.W_OK); } catch { return { ok: false, error: `Sem permissão de escrita em ${cfg.data_dir}.`, details }; }
    // o rest-server com autenticação não sobe sem o arquivo; a central é a dona dele
    const htpasswd = path.join(cfg.data_dir, '.htpasswd');
    if (!existsSync(htpasswd)) { writeFileSync(htpasswd, '', { mode: 0o600 }); details.htpasswd_criado = true; }
    const fs = statfsSync(cfg.data_dir);
    details.capacity_bytes = Number(fs.blocks) * Number(fs.bsize);
    details.free_bytes = Number(fs.bavail) * Number(fs.bsize);
    const dir = path.join(cfg.data_dir, sub);
    try {
      const init = await restic(resticBin, ['init'], { repo: dir, password });
      if (init.code !== 0) return { ok: false, error: `restic init falhou: ${init.stderr}`, details };
      const cat = await restic(resticBin, ['cat', 'config', '--json'], { repo: dir, password });
      if (cat.code !== 0) return { ok: false, error: `leitura do repositório falhou: ${cat.stderr}`, details };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // o rest-server precisa responder no endereço dos agentes (401 sem senha = no ar e exigindo autenticação)
    try {
      const res = await fetch(new URL('/', cfg.agent_url), { method: 'GET', signal: AbortSignal.timeout(5000) });
      details.rest_server_status = res.status;
      if (res.status !== 401) return { ok: false, error: `O rest-server em ${cfg.agent_url} respondeu ${res.status}; esperado 401 (autenticação exigida).`, details };
    } catch (err) {
      return { ok: false, error: `rest-server inacessível em ${cfg.agent_url}: ${(err as Error).message}`, details };
    }
    return { ok: true, error: null, details };
  }
  const cfg = dest.config as Static<typeof S3Config>;
  const cred = await s3Credentials(tx, store, dest);
  const env = s3Env(cred, cfg);
  const repo = s3Repo(cfg, sub);
  const init = await restic(resticBin, ['init'], { repo, password, env, timeoutMs: 60_000 });
  if (init.code !== 0) return { ok: false, error: `restic init no bucket falhou: ${init.stderr}`, details };
  const cat = await restic(resticBin, ['cat', 'config', '--json'], { repo, password, env });
  details.note = 'O repositório de teste fica no bucket (prefixo _central-teste-*): a central não recebe permissão de exclusão em destinos imutáveis.';
  return cat.code === 0 ? { ok: true, error: null, details } : { ok: false, error: `leitura falhou: ${cat.stderr}`, details };
}

// ------------------------------------------------------------ htpasswd do rest-server
/**
 * Inclui/atualiza o usuário no .htpasswd (formato {SHA}). A senha é um token aleatório de 192 bits,
 * então o hash sem sal não abre espaço para força bruta. O rest-server relê o arquivo em até 30 s.
 */
export function upsertHtpasswd(dataDir: string, user: string, password: string) {
  if (!/^[a-z0-9-]{3,60}$/.test(user)) throw new Error('Usuário de repositório inválido.');
  const file = path.join(dataDir, '.htpasswd');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith(`${user}:`)) : [];
  lines.push(`${user}:{SHA}${createHash('sha1').update(password).digest('base64')}`);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, lines.join('\n') + '\n', { mode: 0o600 });
  renameSync(tmp, file);
}

export function removeHtpasswd(dataDir: string, user: string) {
  const file = path.join(dataDir, '.htpasswd');
  if (!existsSync(file)) return;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith(`${user}:`));
  writeFileSync(`${file}.tmp`, lines.join('\n') + (lines.length ? '\n' : ''), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

// ------------------------------------------------------------ repositórios
export interface RepoAccess {
  repositoryId: number;
  /** URL do repositório como o AGENTE a usa (com credencial de acesso, se houver) */
  agentRepo: string;
  password: string;
  env: Record<string, string>;
  /** acesso de manutenção da central (local_rest: caminho no disco) */
  maintenanceRepo: string;
  maintenanceEnv: Record<string, string>;
}

/** Garante o repositório do servidor no destino (cria senha, usuário e `restic init` uma única vez). */
export async function ensureRepository(tx: Tx, store: SecretStore, dest: DestinationRow, server: { id: number; client_id: number }, resticBin: string) {
  let repo = await tx.one('SELECT * FROM backup_repositories WHERE destination_id = $1 AND server_id = $2 AND tool = $3 FOR UPDATE', [dest.id, server.id, 'restic']);
  if (!repo) {
    const user = `c${server.client_id}-s${server.id}`;
    const repoPath = dest.kind === 'local_rest' ? `${user}/restic` : `clientes/${server.client_id}/servidores/${server.id}/restic`;
    const passwordId = await store.put(tx, { clientId: server.client_id, kind: 'repo_password', value: randomBytes(32).toString('base64url') });
    const accessId = dest.kind === 'local_rest' ? await store.put(tx, { clientId: server.client_id, kind: 'repo_access', value: randomBytes(24).toString('base64url') }) : null;
    repo = await tx.one(`INSERT INTO backup_repositories (destination_id, server_id, client_id, repo_user, path, password_secret_id, access_secret_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [dest.id, server.id, server.client_id, user, repoPath, passwordId, accessId]);
  }
  const access = await repositoryAccess(tx, store, dest, repo!);
  if (!repo!.initialized_at) {
    if (dest.kind === 'local_rest') {
      const cfg = dest.config as Static<typeof LocalRestConfig>;
      mkdirSync(path.join(cfg.data_dir, repo!.repo_user), { recursive: true, mode: 0o700 });
      upsertHtpasswd(cfg.data_dir, repo!.repo_user, await store.reveal(tx, repo!.access_secret_id));
    }
    const init = await restic(resticBin, ['init'], { repo: access.maintenanceRepo, password: access.password, env: access.maintenanceEnv, timeoutMs: 60_000 });
    if (init.code !== 0 && !/already (exists|initialized)|config file already exists/i.test(init.stderr)) throw new Error(`Não foi possível inicializar o repositório: ${init.stderr}`);
    await tx.query('UPDATE backup_repositories SET initialized_at = now() WHERE id = $1', [repo!.id]);
  }
  return access;
}

export async function repositoryAccess(tx: Tx, store: SecretStore, dest: DestinationRow, repo: Record<string, any>): Promise<RepoAccess> {
  const password = await store.reveal(tx, Number(repo.password_secret_id));
  if (dest.kind === 'local_rest') {
    const cfg = dest.config as Static<typeof LocalRestConfig>;
    const accessPw = await store.reveal(tx, Number(repo.access_secret_id));
    return {
      repositoryId: Number(repo.id), password, env: {},
      agentRepo: restUrl(cfg.agent_url, repo.repo_user, accessPw, repo.path),
      maintenanceRepo: path.join(cfg.data_dir, ...String(repo.path).split('/')), maintenanceEnv: {}
    };
  }
  const cfg = dest.config as Static<typeof S3Config>;
  const env = s3Env(await s3Credentials(tx, store, dest), cfg);
  const url = s3Repo(cfg, repo.path);
  return { repositoryId: Number(repo.id), password, env, agentRepo: url, maintenanceRepo: url, maintenanceEnv: env };
}
