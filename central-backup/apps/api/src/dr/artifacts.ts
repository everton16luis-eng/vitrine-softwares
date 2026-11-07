// Artefatos para reconstruir o servidor: cloud-init (máquina nova com restic e agente, registrada
// na central com código de uso único) e playbook Ansible (pacotes, diretórios, serviços).
// Nenhum segredo de backup entra nos artefatos: os dados voltam pelas restaurações da central.
import type { DrPlan } from './plan.ts';

/** YAML com escalares sempre entre aspas (JSON é YAML válido): sem ambiguidade de tipos. */
export function toYaml(v: unknown, indent = 0): string {
  const pad = ' '.repeat(indent);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return v.map((x) => (x !== null && typeof x === 'object' ? `\n${pad}- ${toYaml(x, indent + 2).trimStart()}` : `\n${pad}- ${scalar(x)}`)).join('');
  }
  if (v !== null && typeof v === 'object') {
    const e = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    if (!e.length) return '{}';
    return e.map(([k, x]) => {
      const key = /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(k) ? k : JSON.stringify(k);
      if (x !== null && typeof x === 'object' && (Array.isArray(x) ? x.length : Object.keys(x).length)) return `\n${pad}${key}:${toYaml(x, indent + 2)}`;
      return `\n${pad}${key}: ${x !== null && typeof x === 'object' ? (Array.isArray(x) ? '[]' : '{}') : scalar(x)}`;
    }).join('');
  }
  return scalar(v);
}
const scalar = (x: unknown) => (typeof x === 'number' || typeof x === 'boolean' ? String(x) : x === null ? 'null' : JSON.stringify(String(x)));
/** Bloco literal (|) para scripts. */
const literal = (text: string, indent: number) => `|\n${text.split('\n').map((l) => (l ? ' '.repeat(indent) + l : '')).join('\n')}`;

const RESTIC = { version: '0.19.1', sha256: { amd64: 'f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c', arm64: 'a5f64aaab53d51e311fa3829124c5b703f2d14cf187d8640b6be3b2b49376465' } };
const debArch = (a: string) => (/^(x64|x86_64|amd64)$/.test(a) ? 'amd64' : /^(arm64|aarch64)$/.test(a) ? 'arm64' : null);

export interface AgentSource { repo: string; ref: string }

export function cloudInit(plan: DrPlan, opts: { hostname: string; gatewayUrl: string; caSha256: string; enrollmentCode: string; agentSource: AgentSource }) {
  const arch = debArch(plan.target.arch);
  if (!arch) throw new Error(`Arquitetura sem binário oficial do restic: ${plan.target.arch}`);
  if (!/^https:\/\/[^\s'"]+$/.test(opts.agentSource.repo) || !/^[0-9a-f]{7,40}$|^[A-Za-z0-9._/-]{1,100}$/.test(opts.agentSource.ref)) throw new Error('Origem do agente inválida.');
  const script = [
    '#!/bin/bash',
    'set -euo pipefail',
    '# 1) Node.js 22 (repositório oficial NodeSource, assinado)',
    'install -d -m 0755 /etc/apt/keyrings',
    'curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg',
    'echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list',
    'apt-get update -q && apt-get install -y -q nodejs',
    `# 2) restic ${RESTIC.version} oficial, conferido pelo SHA-256 da release`,
    'cd /tmp',
    `curl -fsSLo restic.bz2 https://github.com/restic/restic/releases/download/v${RESTIC.version}/restic_${RESTIC.version}_linux_${arch}.bz2`,
    `echo "${RESTIC.sha256[arch]}  restic.bz2" | sha256sum -c -`,
    'bunzip2 -f restic.bz2 && install -m 0755 restic /usr/local/bin/restic',
    '# 3) agente da central, na versão fixada',
    `git clone --quiet ${opts.agentSource.repo} /opt/central-src`,
    `git -C /opt/central-src checkout --quiet ${opts.agentSource.ref}`,
    'bash /opt/central-src/central-backup/apps/agent/install/install.sh',
    '# 4) registro na central (código de uso único, vence em poucas horas)',
    `central-agent enroll --url ${opts.gatewayUrl} --ca-sha256 ${opts.caSha256} --code ${opts.enrollmentCode}`,
    'systemctl enable --now central-agent',
    'rm -f /root/central-dr.sh'
  ].join('\n');
  return `#cloud-config
# Plano de DR gerado pela Central de Backup em ${plan.generated_at} para ${plan.source.server}.
# Contém um código de registro de USO ÚNICO: não reutilize este arquivo.
hostname: ${JSON.stringify(opts.hostname)}
package_update: true
packages:${toYaml(['curl', 'ca-certificates', 'gnupg', 'git', 'bzip2'], 2)}
write_files:
  - path: "/root/central-dr.sh"
    permissions: "0700"
    owner: "root:root"
    content: ${literal(script, 6)}
runcmd:
  - ["bash", "/root/central-dr.sh"]
`;
}

export function ansiblePlaybook(plan: DrPlan, input: { applications: { name: string; install_dir: string | null; data_dirs: string[] }[] }) {
  const usesPg = plan.packages.some((p) => /^postgresql-\d+$/.test(p));
  const dirs = [...new Set(input.applications.flatMap((a) => [a.install_dir, ...a.data_dirs]).filter((d): d is string => Boolean(d)))].sort();
  const tasks: Record<string, unknown>[] = [];
  if (usesPg) {
    tasks.push(
      { name: 'Chave do repositório PGDG', 'ansible.builtin.get_url': { url: 'https://www.postgresql.org/media/keys/ACCC4CF8.asc', dest: '/etc/apt/keyrings/pgdg.asc', mode: '0644' }, tags: ['base'] },
      { name: 'Repositório PGDG (mesma versão principal da origem)', 'ansible.builtin.apt_repository': { repo: 'deb [signed-by=/etc/apt/keyrings/pgdg.asc] https://apt.postgresql.org/pub/repos/apt {{ ansible_distribution_release }}-pgdg main', filename: 'pgdg', state: 'present' }, tags: ['base'] }
    );
  }
  if (plan.packages.length) tasks.push({ name: 'Pacotes da origem', 'ansible.builtin.apt': { name: plan.packages, state: 'present', update_cache: true }, tags: ['base'] });
  if (dirs.length) tasks.push({ name: 'Diretórios das aplicações', 'ansible.builtin.file': { path: '{{ item }}', state: 'directory', mode: '0750' }, loop: dirs, tags: ['base'] });
  if (plan.services.length) tasks.push({ name: 'Serviços da origem (rodar DEPOIS de restaurar os dados)', 'ansible.builtin.systemd_service': { name: '{{ item }}', enabled: true, state: 'started' }, loop: plan.services, tags: ['servicos'] });
  const header = [
    `# Plano de DR — ${plan.source.server} (${plan.source.os}) → ${plan.target.os_name} ${plan.target.os_version}`,
    `# Gerado pela Central de Backup em ${plan.generated_at}. Sem segredos: os dados voltam pelas restaurações da central.`,
    '# 1) ansible-playbook -i inventario.ini dr.yml --tags base',
    '# 2) restaurações pela central (bancos e arquivos)',
    '# 3) ansible-playbook -i inventario.ini dr.yml --tags servicos',
    ...(plan.findings.filter((x) => x.severity !== 'info').map((x) => `# [${x.severity}] ${x.message}`))
  ].join('\n');
  const play = [{ name: `Reconstrução de ${plan.source.server}`, hosts: 'dr_destino', become: true, gather_facts: true, tasks: tasks.length ? tasks : [{ name: 'Nada a instalar (inventário sem pacotes/serviços)', 'ansible.builtin.debug': { msg: 'Colete o inventário com as seções pacotes e servicos.' } }] }];
  return `---\n${header}\n${toYaml(play).trimStart()}\n`;
}
