// Auxiliar root (deploy/implantacao/helper.mjs): partes que não dependem do sistema operacional.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnvFile, assertCwd, OPERACOES } from '../../deploy/implantacao/helper.mjs';
import { renderEnv, resourcesFor, PolicyError } from '../../backend/src/modules/deployments/policy.js';

const HELPER = fileURLToPath(new URL('../../deploy/implantacao/helper.mjs', import.meta.url));

describe('auxiliar root', () => {
  test('lista fechada de operações, sem execução livre', () => {
    assert.deepEqual(OPERACOES.sort(), ['ativar-versao', 'backup-banco', 'certificado', 'criar-banco', 'criar-usuario', 'executar', 'gravar-env',
      'instalar-servico', 'nginx', 'obter-codigo', 'preparar-diretorios', 'renovacao', 'requisitos', 'servico'].sort());
    const r = spawnSync(process.execPath, [HELPER, 'shell'], { input: '{}', encoding: 'utf8' });
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.equal(out.ok, false);
    assert.match(out.erro, /Operação não permitida/);
    const proto = spawnSync(process.execPath, [HELPER, '__proto__'], { input: '{}', encoding: 'utf8' });
    assert.match(JSON.parse(proto.stdout.trim()).erro, /Operação não permitida/);
  });

  test('.env gerado pela política é lido de volta sem perdas', () => {
    const vars = { A: 'simples', B: 'com "aspas" e $HOME e \\barra', C: '', D: 'postgresql://u:p@127.0.0.1:5432/db' };
    assert.deepEqual(parseEnvFile(renderEnv(vars)), vars);
    assert.deepEqual(parseEnvFile('X=sem_aspas\nexport Y="1"\nZ="ok"'), { Z: 'ok' }, 'ignora linhas fora do formato');
  });

  test('comandos só rodam na versão em preparação ou na versão ativa', () => {
    const r = resourcesFor('acme-app');
    assert.equal(assertCwd(r, r.current), r.current);
    assert.equal(assertCwd(r, `${r.releases}/20261102120000`), `${r.releases}/20261102120000`);
    for (const bad of ['/', '/etc', r.dir, r.shared, `${r.releases}/20261102120000/../../..`, `${r.releases}/x`, '/srv/clientes/outro/current']) {
      assert.throws(() => assertCwd(r, bad), PolicyError, bad);
    }
  });
});
