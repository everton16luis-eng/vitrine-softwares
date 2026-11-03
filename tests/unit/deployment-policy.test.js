import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCommand, splitCommand, renderEnv, renderNginx, renderSystemdUnit, normalizeDomain, assertSlug,
  assertGitUrl, assertGitRef, assertSharedDir, maskSecrets, resourcesFor, PolicyError
} from '../../backend/src/modules/deployments/policy.js';
import { normalizeCommands, normalizeVariables, normalizeFields } from '../../backend/src/modules/deployments/recipes.service.js';

const rejects = (fn, re) => assert.throws(fn, (err) => err instanceof PolicyError && (!re || re.test(err.message)));

describe('política de execução', () => {
  test('aceita somente comandos da lista autorizada', () => {
    for (const ok of ['npm ci --omit=dev', 'npm install --omit=dev --no-audit', 'npm run build', 'npm run db:migrate', 'npm run seed -- --force',
      'node backend/src/database/cli/migrate.js', 'node scripts/setup.mjs --nome=Empresa']) {
      assert.deepEqual(validateCommand(splitCommand(ok)), splitCommand(ok), ok);
    }
    for (const bad of ['bash -c ls', 'sh script.sh', 'npm exec rimraf', 'npx something', 'node -e process.exit()', 'node --eval 1',
      'node /etc/passwd.js', 'node ../fora.js', 'npm ci --unsafe-perm', 'npm run x;rm', 'curl http://x', 'npm run build && rm -rf /',
      'node script.js $(whoami)', 'node script.js `id`', 'npm run "a b"', 'git pull', 'sudo npm ci', 'node script.js --require=./x.js']) {
      rejects(() => validateCommand(splitCommand(bad)), undefined);
    }
  });

  test('identificadores, domínios, refs e diretórios são estritos', () => {
    assert.equal(assertSlug('acme-churchflow'), 'acme-churchflow');
    for (const s of ['a', 'Acme', 'acme_x', '-acme', 'acme-', 'a'.repeat(29), '../etc', 'acme;rm']) rejects(() => assertSlug(s));
    assert.equal(normalizeDomain('Sistema.Empresa.com.br.'), 'sistema.empresa.com.br');
    for (const d of ['http://x.com', 'x.com/a', 'localhost', 'a b.com', 'x.com;', 'x.com\nserver_name y', '*.x.com', '1.2.3.4']) rejects(() => normalizeDomain(d));
    assert.equal(assertGitUrl('https://github.com/org/app.git'), 'https://github.com/org/app.git');
    for (const u of ['http://github.com/x', 'git@github.com:x/y.git', 'https://user:token@github.com/x', 'file:///etc', 'https://github.com/x?y=1']) rejects(() => assertGitUrl(u));
    assert.equal(assertGitRef('v1.2.0'), 'v1.2.0');
    for (const r of ['--upload-pack=x', '../main', 'main branch', 'a;b']) rejects(() => assertGitRef(r));
    assert.equal(assertSharedDir('storage/uploads'), 'storage/uploads');
    for (const d of ['/etc', '../x', 'a/../../b', 'storage/.env', '']) rejects(() => assertSharedDir(d));
  });

  test('.env é escapado e sem quebra de linha', () => {
    const out = renderEnv({ A: 'x"y$HOME\\z', B: '' });
    assert.match(out, /A="x\\"y\\\$HOME\\\\z"/);
    rejects(() => renderEnv({ A: 'linha1\nB=injetado' }));
    rejects(() => renderEnv({ 'A B': 'x' }));
  });

  test('Nginx usa apenas valores validados', () => {
    const conf = renderNginx({ slug: 'acme-app', dominio: 'app.acme.com.br', porta: 4100, ssl: true, opcoes: { websocket: true } });
    assert.match(conf, /server_name app\.acme\.com\.br;/);
    assert.match(conf, /proxy_pass http:\/\/127\.0\.0\.1:4100;/);
    assert.match(conf, /ssl_certificate \/etc\/letsencrypt\/live\/app\.acme\.com\.br\/fullchain\.pem;/);
    assert.match(conf, /Upgrade \$http_upgrade/);
    rejects(() => renderNginx({ slug: 'acme-app', dominio: 'a.com; include /etc/passwd', porta: 4100 }));
    rejects(() => renderNginx({ slug: 'acme-app', dominio: 'a.com', porta: 22 }));
    rejects(() => renderNginx({ slug: 'acme-app', dominio: 'a.com', porta: 4100, opcoes: { client_max_body_size_mb: '10m; root /' } }));
  });

  test('unidade systemd isola a instalação', () => {
    const unit = renderSystemdUnit({ slug: 'acme-app', execStart: ['/usr/bin/node', 'server.js'] });
    assert.match(unit, /User=app-acme-app/);
    assert.match(unit, /ReadWritePaths=\/srv\/clientes\/acme-app/);
    assert.match(unit, /NoNewPrivileges=true/);
    rejects(() => renderSystemdUnit({ slug: 'acme-app', execStart: ['node', 'x.js'] }));
    rejects(() => renderSystemdUnit({ slug: 'acme-app', execStart: ['/usr/bin/node', 'x.js;rm'] }));
  });

  test('recursos de cada instalação são derivados do slug', () => {
    const r = resourcesFor('acme-app');
    assert.equal(r.usuario, 'app-acme-app');
    assert.equal(r.banco, 'cli_acme_app');
    assert.equal(r.nginxSite, 'vitrine-acme-app.conf');
    assert.ok(r.usuario.length <= 32);
    assert.ok(resourcesFor('a'.repeat(28)).usuario.length <= 32);
  });

  test('segredos são mascarados nos logs', () => {
    assert.equal(maskSecrets('senha=SuperSecreta123 ok', ['SuperSecreta123']), 'senha=•••• ok');
    assert.equal(maskSecrets('postgresql://cli_x:abc123@127.0.0.1/db'), 'postgresql://cli_x:••••@127.0.0.1/db');
  });
});

describe('validação de receitas', () => {
  test('comandos: início e instalação obrigatórios, lista autorizada', () => {
    const c = normalizeCommands({ instalacao: ['npm ci --omit=dev'], migracoes: [['npm', 'run', 'db:migrate']], inicio: 'node server.js' });
    assert.deepEqual(c.instalacao, [['npm', 'ci', '--omit=dev']]);
    assert.deepEqual(c.inicio, ['node', 'server.js']);
    rejects(() => normalizeCommands({ instalacao: ['npm ci'] }), /inicialização/);
    rejects(() => normalizeCommands({ inicio: 'node server.js' }), /instalação/);
    rejects(() => normalizeCommands({ instalacao: ['npm ci'], build: ['bash build.sh'], inicio: 'node s.js' }), /Build/);
  });

  test('variáveis: origem coerente com os campos e porta obrigatória', () => {
    const campos = normalizeFields([{ chave: 'nome_sistema', rotulo: 'Nome do sistema', tipo: 'texto', obrigatorio: true }, { chave: 'smtp_senha', rotulo: 'Senha SMTP', tipo: 'segredo' }]);
    const vars = normalizeVariables([{ nome: 'PORT', origem: 'porta' }, { nome: 'APP_NAME', origem: 'cliente', valor: 'nome_sistema' }, { nome: 'SMTP_PASS', origem: 'segredo', valor: 'smtp_senha' }], { campos, requerBanco: true });
    assert.equal(vars.length, 3);
    rejects(() => normalizeVariables([{ nome: 'APP', origem: 'fixo', valor: 'x' }], { campos, requerBanco: true }), /porta/);
    rejects(() => normalizeVariables([{ nome: 'PORT', origem: 'porta' }, { nome: 'X', origem: 'cliente', valor: 'smtp_senha' }], { campos, requerBanco: true }), /sigiloso/);
    rejects(() => normalizeVariables([{ nome: 'PORT', origem: 'porta' }, { nome: 'API_SECRET', origem: 'fixo', valor: 'abcdefgh123' }], { campos, requerBanco: true }), /sigilosa/);
    rejects(() => normalizeVariables([{ nome: 'PORT', origem: 'porta' }, { nome: 'DATABASE_URL', origem: 'banco' }], { campos, requerBanco: false }), /banco/);
  });
});
