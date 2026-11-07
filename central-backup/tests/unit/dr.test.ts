import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { buildPlan, type DrInput } from '../../apps/api/src/dr/plan.ts';
import { cloudInit, ansiblePlaybook, toYaml } from '../../apps/api/src/dr/artifacts.ts';

const GB = 1024 ** 3;
const now = new Date('2026-06-10T12:00:00Z');
function base(): DrInput {
  return {
    now,
    server: { id: 1, name: 'web-01', os_name: 'Ubuntu', os_version: '24.04', arch: 'x64', memory_bytes: 4 * GB, disk_used_bytes: 20 * GB },
    inventory: {
      collected_at: '2026-06-10T00:00:00.000Z',
      packages: [{ name: 'nginx', version: '1.24' }, { name: 'postgresql-16', version: '16.3' }, { name: 'libc6', version: '2.39' }, { name: 'php8.3-fpm', version: '8.3' }, { name: 'bash', version: '5' }],
      services: [
        { name: 'nginx.service', active: 'active', sub: 'running' }, { name: 'ssh.service', active: 'active', sub: 'running' },
        { name: 'systemd-journald.service', active: 'active', sub: 'running' }, { name: 'postgresql@16-main.service', active: 'active', sub: 'running' },
        { name: 'old.service', active: 'inactive', sub: 'dead' }
      ]
    },
    applications: [{ id: 1, name: 'Loja', technology: 'php', install_dir: '/var/www/loja', data_dirs: ['/var/www/loja/uploads'], config_files: ['/etc/nginx/sites-available/loja'], systemd_unit: 'loja-worker.service', domains: ['loja.exemplo.com.br'], rpo_minutes: 1500, rto_minutes: 240 }],
    databases: [{ id: 7, name: 'loja', engine: 'postgresql', db_name: 'loja', file_path: null, version: 'PostgreSQL 16.3', size_bytes: 2 * GB }],
    jobs: [
      { id: 10, name: 'arquivos', kind: 'arquivos', database_id: null, paths: ['/var/www', '/etc/nginx'], enabled: true, schedule: '0 3 * * *', timezone: 'America/Sao_Paulo', last_success_at: '2026-06-10T06:00:00Z', latest_valid: { id: 100, restic_id: 'a'.repeat(64), taken_at: '2026-06-10T06:00:00Z', size_bytes: 5 * GB } },
      { id: 11, name: 'banco', kind: 'banco', database_id: 7, paths: [], enabled: true, schedule: '0 */6 * * *', timezone: 'UTC', last_success_at: '2026-06-10T06:00:00Z', latest_valid: { id: 101, restic_id: 'b'.repeat(64), taken_at: '2026-06-10T06:00:00Z', size_bytes: 1 * GB } }
    ],
    restoreHistory: [],
    target: { os_name: 'Ubuntu', os_version: '24.04', arch: 'x86_64', memory_bytes: 4 * GB, disk_bytes: 80 * GB }
  };
}

test('dr: plano completo e pronto, com pacotes, serviços e RPO/RTO', () => {
  const p = buildPlan(base());
  assert.equal(p.ready, true, JSON.stringify(p.findings));
  assert.deepEqual(p.packages, ['nginx', 'postgresql-16', 'php8.3-fpm']);
  // serviços do sistema (ssh, journald) e parados ficam de fora; a unidade da aplicação entra
  assert.deepEqual(p.services, ['loja-worker.service', 'nginx.service', 'postgresql@16-main.service']);
  assert.equal(p.rpo.atual_min, 360);
  assert.equal(p.rpo.projetado_min, 1440); // pior intervalo: diário
  assert.equal(p.rto.vazao, 'estimada');
  assert.equal(p.rto.estimado_min, p.steps.reduce((s, x) => s + x.minutes, 0));
  assert.ok(p.steps.some((s) => s.title.includes('banco loja')));
  assert.deepEqual(p.domains, ['loja.exemplo.com.br']);
  assert.equal(p.restore_points.length, 2);
  assert.ok(p.findings.some((f) => f.code === 'versao_postgresql' && f.message.includes('PostgreSQL 16')));
});

test('dr: incompatibilidades e lacunas de cobertura viram pendências críticas', () => {
  const i = base();
  i.target = { os_name: 'Debian', os_version: '12', arch: 'arm64', memory_bytes: 2 * GB, disk_bytes: 10 * GB };
  i.applications[0]!.data_dirs.push('/srv/arquivos');
  i.jobs[1]!.latest_valid = null;
  i.databases.push({ id: 8, name: 'relatorios', engine: 'mysql', db_name: 'rel', file_path: null, version: null, size_bytes: null });
  i.inventory.packages = null;
  const p = buildPlan(i);
  assert.equal(p.ready, false);
  const codes = new Set(p.findings.map((f) => f.code));
  for (const c of ['distro_diferente', 'arquitetura_diferente', 'memoria_menor', 'disco_insuficiente', 'caminho_sem_backup', 'banco_sem_validado', 'banco_sem_backup', 'job_sem_validado', 'inventario_pacotes']) assert.ok(codes.has(c), c);
  assert.equal(p.findings[0]!.severity, 'critico'); // ordenado por gravidade
  assert.match(p.findings.find((f) => f.code === 'caminho_sem_backup')!.message, /\/srv\/arquivos/);
});

test('dr: metas da aplicação comparadas com RPO projetado e RTO estimado; vazão medida', () => {
  const i = base();
  i.applications[0]!.rpo_minutes = 60;
  i.applications[0]!.rto_minutes = 30;
  const p = buildPlan(i);
  const codes = p.findings.map((f) => f.code);
  assert.ok(codes.includes('rpo_acima_da_meta') && codes.includes('rto_acima_da_meta') && codes.includes('rpo_atual_acima_da_meta'));
  // vazão medida: 1 GB em 10 s ≈ 102 MB/s → passos de dados mais curtos
  i.restoreHistory = [{ bytes: GB, seconds: 10 }];
  const fast = buildPlan(i);
  assert.equal(fast.rto.vazao, 'medida');
  assert.match(fast.rto.base, /102\.4 MB\/s/);
  assert.ok(fast.rto.estimado_min < p.rto.estimado_min);
  // pouco volume não vira medida
  i.restoreHistory = [{ bytes: 1024, seconds: 1 }];
  assert.equal(buildPlan(i).rto.vazao, 'estimada');
});

test('dr: YAML com escalares entre aspas (sem conversão de tipos)', () => {
  const y = toYaml({ a: 'yes', b: '0755', c: ['on', 'null', 'x: y'], d: { e: true, f: 3 }, 'chave estranha': [], g: {} });
  assert.deepEqual(parse(y), { a: 'yes', b: '0755', c: ['on', 'null', 'x: y'], d: { e: true, f: 3 }, 'chave estranha': [], g: {} });
});

test('dr: cloud-init válido, restic conferido por SHA-256 e entradas validadas', () => {
  const p = buildPlan(base());
  const text = cloudInit(p, { hostname: 'web-01-dr', gatewayUrl: 'https://central.exemplo.com.br:8443', caSha256: 'c'.repeat(64), enrollmentCode: 'ABCD-EFGH-IJKL', agentSource: { repo: 'https://github.com/org/repo.git', ref: 'v1.0.0' } });
  assert.ok(text.startsWith('#cloud-config\n'));
  const doc = parse(text);
  assert.equal(doc.hostname, 'web-01-dr');
  const script: string = doc.write_files[0].content;
  assert.match(script, /restic_0\.19\.1_linux_amd64\.bz2/);
  assert.match(script, /f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c {2}restic\.bz2" \| sha256sum -c -/);
  assert.match(script, /central-agent enroll --url https:\/\/central\.exemplo\.com\.br:8443 --ca-sha256 c{64} --code ABCD-EFGH-IJKL/);
  assert.match(script, /^set -euo pipefail$/m);
  assert.deepEqual(doc.runcmd, [['bash', '/root/central-dr.sh']]);
  const opt = { hostname: 'x', gatewayUrl: 'https://c', caSha256: 'c', enrollmentCode: 'x' };
  assert.throws(() => cloudInit(p, { ...opt, agentSource: { repo: 'http://inseguro/repo', ref: 'main' } }), /Origem do agente/);
  assert.throws(() => cloudInit(p, { ...opt, agentSource: { repo: 'https://x/r.git; rm -rf /', ref: 'main' } }), /Origem do agente/);
  assert.throws(() => cloudInit(p, { ...opt, agentSource: { repo: 'https://x/r.git', ref: 'main; reboot' } }), /Origem do agente/);
  const arm = buildPlan({ ...base(), target: { ...base().target, arch: 'aarch64' } });
  assert.match(cloudInit(arm, { ...opt, agentSource: { repo: 'https://x/r.git', ref: 'main' } }), /linux_arm64\.bz2/);
});

test('dr: playbook Ansible com PGDG, pacotes, diretórios e serviços por tag', () => {
  const p = buildPlan(base());
  const y = ansiblePlaybook(p, { applications: base().applications });
  const [play] = parse(y);
  assert.equal(play.hosts, 'dr_destino');
  const byName = Object.fromEntries(play.tasks.map((t: { name: string }) => [t.name, t]));
  assert.deepEqual(byName['Pacotes da origem']['ansible.builtin.apt'].name, ['nginx', 'postgresql-16', 'php8.3-fpm']);
  assert.ok(byName['Repositório PGDG (mesma versão principal da origem)']);
  assert.deepEqual(byName['Diretórios das aplicações'].loop, ['/var/www/loja', '/var/www/loja/uploads']);
  assert.deepEqual(byName['Serviços da origem (rodar DEPOIS de restaurar os dados)'].tags, ['servicos']);
  assert.doesNotMatch(y, /senha|password|token/i);
});
