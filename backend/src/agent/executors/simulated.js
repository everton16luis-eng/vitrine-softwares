// Executor SIMULADO: percorre o fluxo completo sem tocar no sistema operacional.
// Usado em desenvolvimento, nos testes automatizados e para ensaiar receitas novas.
// Ainda assim valida tudo com a mesma política do executor real.
import { validateCommand, renderEnv, renderNginx, renderSystemdUnit, assertSharedDir } from '../../modules/deployments/policy.js';

/**
 * @param {object} [opts]
 * @param {Iterable<string>} [opts.falharEm] operações que devem falhar (ex.: 'runAppCommand', 'issueCertificate')
 * @param {Function} [opts.onCall] observador (nome, args) para testes
 */
export function createSimulatedExecutor({ falharEm = [], onCall } = {}) {
  const fail = new Set(falharEm);
  const calls = [];
  const op = (name, fn) => async (...args) => {
    calls.push({ name, args });
    onCall?.(name, args);
    if (fail.has(name)) throw new Error(`Falha simulada em ${name}.`);
    return fn(...args);
  };
  return {
    nome: 'simulado',
    pollMs: 10,
    calls,
    falharEm: fail,
    checkRequirements: op('checkRequirements', async () => ({ node: 'v22 (simulado)', git: 'ok', nginx: 'ok', certbot: 'ok', postgresql: 'ok' })),
    ensureUser: op('ensureUser', async () => ({})),
    prepareDirs: op('prepareDirs', async (r, dirs = []) => { dirs.forEach(assertSharedDir); return {}; }),
    fetchCode: op('fetchCode', async () => ({ commit: 'simulado' })),
    ensureDatabase: op('ensureDatabase', async () => ({})),
    writeEnv: op('writeEnv', async (r, vars) => { renderEnv(vars); return {}; }),
    runAppCommand: op('runAppCommand', async (r, argv) => { validateCommand(argv); return { saida: `(simulado) ${argv.join(' ')}` }; }),
    activateRelease: op('activateRelease', async () => ({})),
    backupDatabase: op('backupDatabase', async (r) => ({ arquivo: `${r.backups}/simulado.dump`, tamanho: 0 })),
    installService: op('installService', async (r, { inicio }) => { validateCommand(inicio); renderSystemdUnit({ slug: r.slug, execStart: ['/usr/bin/node', ...inicio.slice(1)] }); return {}; }),
    serviceAction: op('serviceAction', async (r, action) => (action === 'is-active' ? { estado: 'active' } : {})),
    writeNginx: op('writeNginx', async (r, o) => { renderNginx({ slug: r.slug, ...o }); return {}; }),
    issueCertificate: op('issueCertificate', async () => ({})),
    certificateInfo: op('certificateInfo', async () => ({ expira_em: new Date(Date.now() + 89 * 86_400_000).toISOString(), renovacao_automatica: true })),
    dbPing: op('dbPing', async () => ({})),
    httpGet: op('httpGet', async () => ({ status: 200, body: '', simulado: true }))
  };
}
