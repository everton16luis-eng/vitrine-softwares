// Central de Implantação: receitas, implantações, fila, agente (executor simulado),
// DNS, retomada, reexecução, segredos e entrega.
process.env.IMPLANTACAO_IPS = '203.0.113.10';
process.env.IMPLANTACAO_EXECUTOR = 'simulado';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
// Import dinâmico: os imports estáticos são avaliados antes das variáveis acima.
const h = await import('./helpers.js');

const skip = !h.hasTestDatabase() && 'DATABASE_URL_TEST não configurado';
const { _setResolver } = await import('../../backend/src/modules/deployments/domains.service.js');
const { claimTask, recoverStaleTasks } = await import('../../backend/src/agent/queue.js');
const { runTask } = await import('../../backend/src/agent/runner.js');
const { recheckWaitingDns } = await import('../../backend/src/agent/agent.js');
const { createSimulatedExecutor } = await import('../../backend/src/agent/executors/simulated.js');

let dnsIp = '198.51.100.7'; // começa apontando para OUTRO servidor
_setResolver({ resolve4: async () => [dnsIp], resolve6: async () => { const e = new Error('sem AAAA'); e.code = 'ENODATA'; throw e; } });

const RECEITA = {
  nome: 'Padrão Node + PostgreSQL',
  repositorio_url: 'https://github.com/exemplo/churchflow.git',
  referencia: 'v1.0.0',
  versao_app: '1.0.0',
  comandos: { instalacao: ['npm ci --omit=dev'], migracoes: ['npm run db:migrate'], seed: ['npm run db:seed'], inicio: 'node backend/src/server.js' },
  campos_cliente: [
    { chave: 'nome_sistema', rotulo: 'Nome exibido no sistema', tipo: 'texto', obrigatorio: true, responsavel: 'cliente' },
    { chave: 'nome_empresa', rotulo: 'Razão social', tipo: 'texto', obrigatorio: true, responsavel: 'automatico', padrao: '{cliente.empresa}' },
    { chave: 'cor_principal', rotulo: 'Cor principal', tipo: 'cor', responsavel: 'cliente' },
    { chave: 'smtp_senha', rotulo: 'Senha do SMTP', tipo: 'segredo', obrigatorio: true, responsavel: 'cliente' }
  ],
  variaveis: [
    { nome: 'NODE_ENV', origem: 'fixo', valor: 'production' }, { nome: 'PORT', origem: 'porta' }, { nome: 'DATABASE_URL', origem: 'banco' },
    { nome: 'APP_URL', origem: 'dominio' }, { nome: 'APP_SECRET', origem: 'gerado' }, { nome: 'APP_NAME', origem: 'cliente', valor: 'nome_sistema' },
    { nome: 'SMTP_PASS', origem: 'segredo', valor: 'smtp_senha' }
  ],
  diretorios_persistentes: ['storage'],
  verificacoes: [{ caminho: '/saude', status: 200 }],
  orientacoes_uso: 'Acesse o endereço e entre com o e-mail cadastrado.'
};

async function drain(executor) {
  let n = 0;
  for (let task = await claimTask('teste'); task; task = await claimTask('teste')) { await runTask(task, { executor }); n++; }
  return n;
}

describe('central de implantação', { skip }, () => {
  let admin;
  let comercial;
  let produtoId;
  let receitaId;
  let clienteId;
  let impId;

  before(async () => {
    await h.resetDatabase();
    await h.createStaff('admin@exemplo.test');
    await h.createStaff('comercial@exemplo.test', 'gerente_comercial');
    admin = await h.loginAs('admin@exemplo.test');
    comercial = await h.loginAs('comercial@exemplo.test');
    produtoId = (await h.db.one("SELECT id FROM produtos WHERE slug = 'churchflow'")).id;
    clienteId = (await h.db.one("INSERT INTO clientes (nome, email, empresa) VALUES ('Maria Teste', 'maria@exemplo.test', 'Igreja Exemplo') RETURNING id")).id;
  });
  after(h.closeDatabase);

  test('receitas: validação da lista autorizada e token nunca devolvido', async () => {
    const bad = await admin.post('/api/admin/receitas', { ...RECEITA, produto_id: produtoId, comandos: { ...RECEITA.comandos, build: ['bash build.sh'] } });
    assert.equal(bad.status, 422);
    assert.match(bad.body.mensagem || bad.body.erro || JSON.stringify(bad.body), /não autorizado/);
    const semPorta = await admin.post('/api/admin/receitas', { ...RECEITA, produto_id: produtoId, variaveis: RECEITA.variaveis.filter((v) => v.origem !== 'porta') });
    assert.equal(semPorta.status, 422);

    const ok = await admin.post('/api/admin/receitas', { ...RECEITA, produto_id: produtoId });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    receitaId = ok.body.id;
    assert.deepEqual(ok.body.comandos.instalacao, [['npm', 'ci', '--omit=dev']]);

    const tok = await admin.put(`/api/admin/receitas/${receitaId}/token`, { token: 'ghp_tokenDeLeitura123' });
    assert.equal(tok.status, 200);
    const got = await admin.get(`/api/admin/receitas/${receitaId}`);
    assert.equal(got.body.tem_token_git, true);
    assert.ok(!JSON.stringify(got.body).includes('ghp_tokenDeLeitura123'));
    assert.ok(!('token_git_cifrado' in got.body));

    assert.equal((await comercial.post('/api/admin/receitas', { ...RECEITA, produto_id: produtoId, nome: 'Outra' })).status, 403);
  });

  test('criação: recursos isolados, etapas e pendências do cliente', async () => {
    assert.equal((await comercial.post('/api/admin/implantacoes', { cliente_id: clienteId, produto_id: produtoId, receita_id: receitaId })).status, 403);
    const badDomain = await admin.post('/api/admin/implantacoes', { cliente_id: clienteId, produto_id: produtoId, receita_id: receitaId, dominio: 'http://x.com/a' });
    assert.equal(badDomain.status, 422);

    const r = await admin.post('/api/admin/implantacoes', { cliente_id: clienteId, produto_id: produtoId, receita_id: receitaId, dominio: 'app.igreja-exemplo.com.br' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    impId = r.body.id;
    assert.match(r.body.codigo, /^IMP-\d{4}-0001$/);

    const d = (await admin.get(`/api/admin/implantacoes/${impId}`)).body;
    assert.equal(d.slug, 'igreja-exemplo-churchflo');
    assert.equal(d.porta, 4100);
    assert.equal(d.recursos.usuario, 'app-igreja-exemplo-churchflo');
    assert.equal(d.recursos.banco, 'cli_igreja_exemplo_churchflo');
    assert.equal(d.status, 'aguardando_cliente');
    assert.equal(d.etapas[0].status, 'concluida');
    assert.equal(d.etapas[1].status, 'aguardando_cliente');
    assert.equal(d.campos.find((c) => c.chave === 'nome_empresa').valor, 'Igreja Exemplo', 'campo automático preenchido');
    assert.deepEqual(d.pendencias.map((p) => p.chave).sort(), ['nome_sistema', 'smtp_senha']);
    assert.ok(d.passos.some((p) => p.passo === 'criar_banco') && d.passos.some((p) => p.passo === 'seed') && !d.passos.some((p) => p.passo === 'build'));

    const dup = await admin.post('/api/admin/implantacoes', { cliente_id: clienteId, produto_id: produtoId, receita_id: receitaId, dominio: 'outro.igreja-exemplo.com.br' });
    assert.equal(dup.status, 409, 'impede instalação duplicada sem confirmação');
    const sameDomain = await admin.post('/api/admin/implantacoes', { cliente_id: clienteId, produto_id: produtoId, receita_id: receitaId, dominio: 'app.igreja-exemplo.com.br', adicional: true });
    assert.equal(sameDomain.status, 422);
  });

  test('instalação exige informações obrigatórias; segredos são cifrados e nunca devolvidos', async () => {
    const early = await admin.post(`/api/admin/implantacoes/${impId}/tarefas`, { tipo: 'instalar' });
    assert.equal(early.status, 422);

    const bad = await admin.put(`/api/admin/implantacoes/${impId}/dados-cliente`, { valores: { cor_principal: 'azul' } });
    assert.equal(bad.status, 422);
    const ok = await admin.put(`/api/admin/implantacoes/${impId}/dados-cliente`, { valores: { nome_sistema: 'Gestão da Igreja', cor_principal: '#0EA5E9', smtp_senha: 'SenhaSmtpMuitoSecreta!' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body.pendencias, []);

    const row = await h.db.one("SELECT valor_cifrado FROM implantacao_segredos WHERE implantacao_id = $1 AND chave = 'campo:smtp_senha'", [impId]);
    assert.ok(!row.valor_cifrado.includes('SenhaSmtpMuitoSecreta'));
    const d = (await admin.get(`/api/admin/implantacoes/${impId}`)).body;
    assert.ok(!JSON.stringify(d).includes('SenhaSmtpMuitoSecreta'));
    assert.equal(d.campos.find((c) => c.chave === 'smtp_senha').definido, true);
    assert.equal(d.status, 'pronta_para_instalar');
    assert.equal(d.acoes.iniciar, true);
    assert.equal((await h.db.one('SELECT count(*)::int n FROM auditoria WHERE detalhes::text LIKE $1', ['%SenhaSmtp%'])).n, 0);
  });

  test('fila: uma tarefa ativa por implantação', async () => {
    assert.equal((await comercial.post(`/api/admin/implantacoes/${impId}/tarefas`, { tipo: 'instalar' })).status, 403);
    const t = await admin.post(`/api/admin/implantacoes/${impId}/tarefas`, { tipo: 'instalar' });
    assert.equal(t.status, 201);
    const again = await admin.post(`/api/admin/implantacoes/${impId}/tarefas`, { tipo: 'instalar' });
    assert.equal(again.status, 409);
  });

  test('agente: instala tudo e aguarda o cliente quando o DNS não aponta', async () => {
    const executor = createSimulatedExecutor();
    assert.equal(await drain(executor), 1);
    const d = (await admin.get(`/api/admin/implantacoes/${impId}`)).body;
    assert.equal(d.status, 'aguardando_cliente');
    const dnsStep = d.passos.find((p) => p.passo === 'verificar_dns');
    assert.equal(dnsStep.status, 'aguardando');
    assert.match(dnsStep.erro, /registro do tipo A .*203\.0\.113\.10/);
    assert.ok(d.passos.filter((p) => p.ordem < dnsStep.ordem).every((p) => p.status === 'concluido'), 'passos anteriores concluídos');
    assert.equal(d.etapas.find((e) => e.etapa === 3).status, 'concluida');
    assert.equal(d.etapas.find((e) => e.etapa === 4).status, 'aguardando_cliente');
    assert.equal(d.dominio.status_dns, 'divergente');

    const env = executor.calls.find((c) => c.name === 'writeEnv').args[1];
    assert.equal(env.PORT, '4100');
    assert.equal(env.APP_URL, 'https://app.igreja-exemplo.com.br');
    assert.equal(env.APP_NAME, 'Gestão da Igreja');
    assert.equal(env.SMTP_PASS, 'SenhaSmtpMuitoSecreta!');
    assert.match(env.DATABASE_URL, /^postgresql:\/\/cli_igreja_exemplo_churchflo:.+@127\.0\.0\.1:5432\/cli_igreja_exemplo_churchflo$/);
    assert.ok(env.APP_SECRET.length >= 30);
    assert.deepEqual(executor.calls.find((c) => c.name === 'fetchCode').args[1].token, 'ghp_tokenDeLeitura123');

    const logs = (await admin.get(`/api/admin/implantacoes/${impId}/logs`)).body.itens.map((l) => l.mensagem).join('\n');
    for (const secret of ['SenhaSmtpMuitoSecreta!', env.APP_SECRET, env.DATABASE_URL.split(':')[2].split('@')[0], 'ghp_tokenDeLeitura123']) {
      assert.ok(!logs.includes(secret), 'nenhum segredo nos logs');
    }
    assert.match(logs, /Aguardando o cliente/);
  });

  test('rechecagem automática do DNS retoma a instalação até a validação', async () => {
    assert.equal(await recheckWaitingDns(), 0, 'ainda divergente');
    dnsIp = '203.0.113.10';
    assert.equal(await recheckWaitingDns(), 1);
    await drain(createSimulatedExecutor());
    const d = (await admin.get(`/api/admin/implantacoes/${impId}`)).body;
    assert.equal(d.status, 'pronta_para_entrega', JSON.stringify(d.passos.filter((p) => p.status !== 'concluido')));
    assert.ok(d.passos.every((p) => p.status === 'concluido'));
    assert.equal(d.dominio.status_ssl, 'emitido');
    assert.ok(d.verificacoes.length >= 8 && d.verificacoes.every((v) => v.ok), JSON.stringify(d.verificacoes));
    assert.ok(d.instalada_em);
    assert.equal(d.acoes.entregar, true);
  });

  test('alterar dados do cliente após a instalação pede nova personalização', async () => {
    await admin.put(`/api/admin/implantacoes/${impId}/dados-cliente`, { valores: { nome_sistema: 'Igreja Online' } });
    let d = (await admin.get(`/api/admin/implantacoes/${impId}`)).body;
    assert.equal(d.etapas.find((e) => e.etapa === 5).status, 'aguardando_tecnico');
    const executor = createSimulatedExecutor();
    assert.equal((await admin.post(`/api/admin/implantacoes/${impId}/tarefas`, { tipo: 'personalizar' })).status, 201);
    await drain(executor);
    assert.equal(executor.calls.filter((c) => c.name === 'writeEnv').at(-1).args[1].APP_NAME, 'Igreja Online');
    d = (await admin.get(`/api/admin/implantacoes/${impId}`)).body;
    assert.equal(d.etapas.find((e) => e.etapa === 5).status, 'concluida');
    assert.equal(d.status, 'pronta_para_entrega');
  });

  test('falha em um passo, reexecução e continuação', async () => {
    const c2 = (await h.db.one("INSERT INTO clientes (nome, email) VALUES ('João Teste', 'joao@exemplo.test') RETURNING id")).id;
    const r = await admin.post('/api/admin/implantacoes', { cliente_id: c2, produto_id: produtoId, receita_id: receitaId, dominio: 'joao.exemplo.com.br' });
    const id = r.body.id;
    await admin.put(`/api/admin/implantacoes/${id}/dados-cliente`, { valores: { nome_sistema: 'App do João', nome_empresa: 'João ME', smtp_senha: 'outraSenha123' } });
    await admin.post(`/api/admin/implantacoes/${id}/tarefas`, { tipo: 'instalar' });
    await drain(createSimulatedExecutor({ falharEm: ['runAppCommand'] }));
    let d = (await admin.get(`/api/admin/implantacoes/${id}`)).body;
    assert.equal(d.status, 'falhou');
    assert.equal(d.passos.find((p) => p.passo === 'instalar_dependencias').status, 'falhou');
    assert.equal(d.etapas.find((e) => e.etapa === 4).status, 'falhou');
    assert.equal(d.porta, 4101, 'porta exclusiva');

    assert.equal((await admin.post(`/api/admin/implantacoes/${id}/tarefas`, { tipo: 'reexecutar', passo: 'instalar_dependencias' })).status, 201);
    await drain(createSimulatedExecutor());
    d = (await admin.get(`/api/admin/implantacoes/${id}`)).body;
    assert.equal(d.passos.find((p) => p.passo === 'instalar_dependencias').status, 'concluido');
    assert.equal(d.status, 'aguardando_tecnico');
    assert.equal(d.acoes.continuar, true);

    assert.equal((await comercial.post(`/api/admin/implantacoes/${id}/tarefas`, { tipo: 'reexecutar', passo: 'migracoes' })).status, 403);
    await admin.post(`/api/admin/implantacoes/${id}/tarefas`, { tipo: 'instalar' });
    await drain(createSimulatedExecutor());
    d = (await admin.get(`/api/admin/implantacoes/${id}`)).body;
    assert.equal(d.status, 'pronta_para_entrega', JSON.stringify(d.passos.filter((p) => p.status !== 'concluido')));
    assert.ok(d.backups.length >= 1, 'backup antes das migrations');
  });

  test('tarefa interrompida volta para a fila e retoma do último passo concluído', async () => {
    const c3 = (await h.db.one("INSERT INTO clientes (nome, email) VALUES ('Ana Teste', 'ana@exemplo.test') RETURNING id")).id;
    const id = (await admin.post('/api/admin/implantacoes', { cliente_id: c3, produto_id: produtoId, receita_id: receitaId, dominio: 'ana.exemplo.com.br' })).body.id;
    await admin.put(`/api/admin/implantacoes/${id}/dados-cliente`, { valores: { nome_sistema: 'App da Ana', nome_empresa: 'Ana ME', smtp_senha: 'maisUmaSenha1' } });
    await admin.post(`/api/admin/implantacoes/${id}/tarefas`, { tipo: 'instalar' });
    const task = await claimTask('agente-que-vai-cair');
    // Simula queda: dois passos concluídos, um em execução, sinal de vida antigo.
    await h.db.query("UPDATE implantacao_passos SET status = 'concluido' WHERE implantacao_id = $1 AND passo IN ('verificar_requisitos','criar_usuario')", [id]);
    await h.db.query("UPDATE implantacao_passos SET status = 'executando' WHERE implantacao_id = $1 AND passo = 'preparar_diretorios'", [id]);
    await h.db.query("UPDATE tarefas_implantacao SET heartbeat_em = now() - interval '10 minutes' WHERE id = $1", [task.id]);
    assert.equal(await recoverStaleTasks(), 1);
    assert.equal((await h.db.one('SELECT status FROM tarefas_implantacao WHERE id = $1', [task.id])).status, 'pendente');

    const executor = createSimulatedExecutor();
    await drain(executor);
    assert.ok(!executor.calls.some((c) => c.name === 'ensureUser'), 'não repete passos concluídos');
    assert.ok(executor.calls.some((c) => c.name === 'prepareDirs'), 'retoma do passo interrompido');
    assert.equal((await admin.get(`/api/admin/implantacoes/${id}`)).body.status, 'pronta_para_entrega');
  });

  test('entrega: bloqueia senhas no resumo e encerra a implantação', async () => {
    const withSecret = await admin.post(`/api/admin/implantacoes/${impId}/entregar`, { instrucoes_acesso: 'Use a senha SenhaSmtpMuitoSecreta! para entrar.' });
    assert.equal(withSecret.status, 422);
    const withPwd = await admin.post(`/api/admin/implantacoes/${impId}/entregar`, { instrucoes_acesso: 'Usuário admin, senha: 123456' });
    assert.equal(withPwd.status, 422);
    const ok = await admin.post(`/api/admin/implantacoes/${impId}/entregar`, { instrucoes_acesso: 'O responsável recebe por e-mail um link para definir a própria senha.' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));

    const d = (await admin.get(`/api/admin/implantacoes/${impId}`)).body;
    assert.equal(d.status, 'entregue');
    assert.equal(d.progresso, 100);
    assert.equal(d.etapas.find((e) => e.etapa === 7).status, 'concluida');
    const doc = await admin.get(`/api/admin/implantacoes/${impId}/resumo`);
    assert.equal(doc.status, 200);
    assert.match(doc.text, /https:\/\/app\.igreja-exemplo\.com\.br/);
    assert.match(doc.text, /não contém senhas/);
    assert.ok(!doc.text.includes('SenhaSmtpMuitoSecreta'));
    assert.equal((await admin.post(`/api/admin/implantacoes/${impId}/tarefas`, { tipo: 'testar' })).status, 409, 'encerrada');
  });

  test('domínios: listagem e instruções', async () => {
    const list = await admin.get('/api/admin/dominios');
    assert.equal(list.status, 200);
    assert.ok(list.body.items.some((d) => d.nome === 'app.igreja-exemplo.com.br' && d.status_dns === 'ok'));
    const dominioId = list.body.items[0].id;
    const ins = await admin.get(`/api/admin/dominios/${dominioId}/instrucoes`);
    assert.match(ins.body.instrucoes, /203\.0\.113\.10/);
  });
});
