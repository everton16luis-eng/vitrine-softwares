// Levantamento de Requisitos: banco de perguntas, entrevista, versões, histórico, PDF e permissões.
// Cobre os critérios de teste da seção 13 e os critérios de aceite 15.4 da especificação.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './helpers.js';
import { findBrowser } from '../../backend/src/services/pdf.js';

const skip = !h.hasTestDatabase() && 'DATABASE_URL_TEST não configurado';
const noBrowser = !findBrowser() && 'Chrome/Chromium não encontrado (defina PDF_CHROME_PATH)';
const API = '/api/admin/requisitos';

const flat = (s) => s.etapas.flatMap((e) => e.perguntas);
const byType = (s, tipo) => flat(s).find((q) => q.tipo === tipo);

describe('levantamento de requisitos', { skip }, () => {
  let admin;
  let gerente;
  let leitor;
  let consulta;
  let cliente;
  let adminId;
  const ctx = {};

  before(async () => {
    await h.resetDatabase();
    adminId = await h.createStaff('admin@teste.local', 'administrador', { nome: 'Ana Administradora' });
    await h.createStaff('gerente@teste.local', 'gerente_comercial', { nome: 'Gil Gerente' });
    await h.createStaff('consulta@teste.local', 'consulta');
    // Perfil somente leitura do módulo
    const perfil = await h.db.one("INSERT INTO perfis (codigo, nome, descricao) VALUES ('leitor_lr', 'Leitor LR', 'Só consulta') RETURNING id");
    await h.db.query("INSERT INTO perfis_permissoes (perfil_id, permissao_id) SELECT $1, id FROM permissoes WHERE codigo = 'levantamentos.ver'", [perfil.id]);
    await h.createStaff('leitor@teste.local', 'leitor_lr', { nome: 'Lia Leitora' });
    await h.createCustomer('cliente@teste.local');
    admin = await h.loginAs('admin@teste.local');
    gerente = await h.loginAs('gerente@teste.local');
    leitor = await h.loginAs('leitor@teste.local');
    consulta = await h.loginAs('consulta@teste.local');
    cliente = await h.loginAs('cliente@teste.local', 'cliente');
  });
  after(() => h.closeDatabase());

  test('roteiro inicial instalado: 8 etapas e todas as perguntas, administráveis', async () => {
    const r = await admin.get(`${API}/roteiro`);
    assert.equal(r.status, 200);
    assert.equal(r.body.etapas.length, 8);
    assert.deepEqual(r.body.etapas.map((e) => e.perguntas.length), [8, 10, 10, 10, 10, 10, 10, 7]);
    assert.equal(r.body.etapas[0].titulo, 'Entendendo a ideia');
    assert.equal(r.body.etapas[0].perguntas[0].enunciado, 'Me conte um pouco sobre a sua ideia. O que você gostaria de criar?');
    const tipos = new Set(r.body.etapas.flatMap((e) => e.perguntas.map((p) => p.tipo)));
    for (const t of ['texto_curto', 'texto_longo', 'sim_nao', 'selecao_unica', 'selecao_multipla', 'numero', 'data', 'observacoes']) assert.ok(tipos.has(t), `tipo ${t} presente no roteiro`);
  });

  test('cria levantamento com cliente e projeto novos e fotografa o roteiro', async () => {
    const r = await gerente.post(`${API}/levantamentos`, {
      cliente: { nome: 'Joana Prado', empresa: 'Padaria Prado', email: 'joana@prado.com.br', telefone: '(11) 98888-7777' },
      projeto: { nome: 'Gestão de encomendas', descricao: 'Pedidos de bolos e salgados para eventos.' },
      data_reuniao: '2026-11-05', observacoes_iniciais: 'Primeira reunião, presencial.'
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.codigo, /^LR-\d{4}-0001$/);
    ctx.s1 = r.body.id;
    const s = (await gerente.get(`${API}/levantamentos/${ctx.s1}`)).body;
    assert.equal(s.status, 'em_andamento');
    assert.equal(s.versao.numero, 1);
    assert.equal(s.versao.status, 'em_trabalho');
    assert.equal(flat(s).length, 75);
    assert.equal(s.responsavel_nome, 'Gil Gerente');
    assert.equal(s.cliente_nome, 'Joana Prado');
    ctx.cliente = s.cliente_id;
    ctx.projeto = s.projeto_id;
    const aud = await h.db.one("SELECT usuario_nome FROM auditoria WHERE acao = 'criar' AND entidade = 'levantamento' AND entidade_id = $1", [String(ctx.s1)]);
    assert.equal(aud.usuario_nome, 'Gil Gerente');
  });

  test('valida dados do cadastro no servidor', async () => {
    const semCliente = await admin.post(`${API}/levantamentos`, { projeto: { nome: 'X' }, data_reuniao: '2026-11-05' });
    assert.equal(semCliente.status, 422);
    const dataRuim = await admin.post(`${API}/levantamentos`, { cliente: { nome: 'Zé' }, projeto: { nome: 'Projeto Z' }, data_reuniao: '2026-02-30' });
    assert.equal(dataRuim.status, 422);
    assert.ok(dataRuim.body.campos.data_reuniao);
    const emailRuim = await admin.post(`${API}/levantamentos`, { cliente: { nome: 'Zé', email: 'nao-e-email' }, projeto: { nome: 'Projeto Z' }, data_reuniao: '2026-11-05' });
    assert.equal(emailRuim.status, 422);
    const respRuim = await admin.post(`${API}/levantamentos`, { cliente: { nome: 'Zé' }, projeto: { nome: 'Projeto Z' }, data_reuniao: '2026-11-05', responsavel_id: 999999 });
    assert.equal(respRuim.status, 422);
    assert.equal((await h.db.one("SELECT count(*)::int AS n FROM lr_clientes WHERE nome = 'Zé'")).n, 0, 'nada é gravado quando a validação falha');
  });

  test('um cliente com vários projetos e um projeto com vários levantamentos', async () => {
    const p2 = await gerente.post(`${API}/clientes/${ctx.cliente}/projetos`, { nome: 'Aplicativo de fidelidade' });
    assert.equal(p2.status, 201);
    ctx.projeto2 = p2.body.id;
    const s2 = await gerente.post(`${API}/levantamentos`, { cliente_id: ctx.cliente, projeto_id: ctx.projeto2, data_reuniao: '2026-11-06' });
    assert.equal(s2.status, 201);
    const s3 = await gerente.post(`${API}/levantamentos`, { cliente_id: ctx.cliente, projeto_id: ctx.projeto, data_reuniao: '2026-11-07' });
    assert.equal(s3.status, 201);
    ctx.s3 = s3.body.id;

    const c = (await gerente.get(`${API}/clientes/${ctx.cliente}`)).body;
    assert.equal(c.projetos.length, 2);
    assert.equal(c.levantamentos.length, 3);
    const p = (await gerente.get(`${API}/projetos/${ctx.projeto}`)).body;
    assert.equal(p.levantamentos.length, 2);

    // Projeto de outro cliente não pode ser usado
    const outro = await gerente.post(`${API}/clientes`, { nome: 'Outro Cliente' });
    const cruzado = await gerente.post(`${API}/levantamentos`, { cliente_id: outro.body.id, projeto_id: ctx.projeto, data_reuniao: '2026-11-07' });
    assert.equal(cruzado.status, 422);
  });

  test('registra todos os tipos de resposta e valida no servidor', async () => {
    const s = (await admin.get(`${API}/levantamentos/${ctx.s1}`)).body;
    const save = (q, body) => admin.put(`${API}/levantamentos/${ctx.s1}/respostas/${q.id}`, body);
    const casos = [
      ['texto_curto', { valor: 'Umas 2 horas por dia' }, 'Umas 2 horas por dia'],
      ['texto_longo', { valor: 'Linha 1\n\nLinha 2 com acentuação: ção, ã, é' }, 'Linha 1\n\nLinha 2 com acentuação: ção, ã, é'],
      ['sim_nao', { valor: 'sim', detalhe: 'Por e-mail' }, 'sim'],
      ['selecao_unica', { valor: byType(s, 'selecao_unica').opcoes[1] }, byType(s, 'selecao_unica').opcoes[1]],
      ['selecao_multipla', { valor: ['WhatsApp', 'Papel'] }, ['Papel', 'WhatsApp']],
      ['numero', { valor: '1.250,5' }, 1250.5],
      ['data', { valor: '2027-03-01', detalhe: 'Antes da Páscoa' }, '2027-03-01'],
      ['observacoes', { valor: 'Nada a acrescentar.' }, 'Nada a acrescentar.']
    ];
    for (const [tipo, body, esperado] of casos) {
      const q = byType(s, tipo);
      const r = await save(q, body);
      assert.equal(r.status, 200, `${tipo}: ${JSON.stringify(r.body)}`);
      assert.deepEqual(r.body.resposta.valor.valor, esperado, tipo);
      assert.equal(r.body.respondida, true);
    }
    assert.equal((await save(byType(s, 'sim_nao'), { valor: 'talvez' })).status, 422);
    assert.equal((await save(byType(s, 'selecao_unica'), { valor: 'Opção que não existe' })).status, 422);
    assert.equal((await save(byType(s, 'selecao_multipla'), { valor: ['Fax'] })).status, 422);
    assert.equal((await save(byType(s, 'numero'), { valor: 'doze' })).status, 422);
    assert.equal((await save(byType(s, 'data'), { valor: '31/12/2026' })).status, 422);
    assert.equal((await save(byType(s, 'texto_longo'), { valor: 'x'.repeat(20001) })).status, 422);
    assert.equal((await admin.put(`${API}/levantamentos/${ctx.s1}/respostas/999999`, { valor: 'x' })).status, 404);
    // pergunta de outro levantamento não é aceita
    const outra = flat((await admin.get(`${API}/levantamentos/${ctx.s3}`)).body)[0];
    assert.equal((await admin.put(`${API}/levantamentos/${ctx.s1}/respostas/${outra.id}`, { valor: 'x' })).status, 404);
  });

  test('salvamento automático: entrevista interrompida é retomada sem perda', async () => {
    const s = (await gerente.get(`${API}/levantamentos/${ctx.s1}`)).body;
    const q = s.etapas[1].perguntas[0];
    for (const parcial of ['A massa', 'A massa desanda', 'A massa desanda quando falta controle de pedidos']) {
      assert.equal((await gerente.put(`${API}/levantamentos/${ctx.s1}/respostas/${q.id}`, { valor: parcial })).status, 200);
    }
    const skipQ = s.etapas[1].perguntas[1];
    assert.equal((await gerente.put(`${API}/levantamentos/${ctx.s1}/respostas/${skipQ.id}`, { pulada: true })).status, 200);
    assert.equal((await gerente.put(`${API}/levantamentos/${ctx.s1}/etapas/${s.etapas[1].id}/nota`, { texto: 'Cliente emocionado ao falar das perdas.' })).status, 200);
    assert.equal((await gerente.put(`${API}/levantamentos/${ctx.s1}/posicao`, { etapa_atual: 1 })).status, 200);

    // "Fechou o navegador": nova sessão, mesmo estado
    const outra = await h.loginAs('gerente@teste.local');
    const again = (await outra.get(`${API}/levantamentos/${ctx.s1}`)).body;
    assert.equal(again.etapa_atual, 1);
    assert.equal(again.etapas[1].perguntas[0].resposta.valor.valor, 'A massa desanda quando falta controle de pedidos');
    assert.equal(again.etapas[1].perguntas[1].resposta.pulada, true);
    assert.equal(again.etapas[1].nota, 'Cliente emocionado ao falar das perdas.');
    assert.ok(again.progresso.respondidas >= 9);

    // Edições seguidas formam um único registro de histórico, com o responsável
    const hist = await h.db.many("SELECT * FROM lr_historico WHERE levantamento_id = $1 AND tipo = 'resposta' AND referencia_id = $2", [ctx.s1, q.id]);
    assert.equal(hist.length, 1);
    assert.equal(hist[0].valor_anterior, null);
    assert.equal(hist[0].valor_novo.valor.valor, 'A massa desanda quando falta controle de pedidos');
    assert.equal(hist[0].usuario_nome, 'Gil Gerente');
  });

  test('histórico identifica valor anterior, novo e responsáveis de cada alteração', async () => {
    const s = (await admin.get(`${API}/levantamentos/${ctx.s1}`)).body;
    const q = s.etapas[1].perguntas[0];
    await admin.put(`${API}/levantamentos/${ctx.s1}/respostas/${q.id}`, { valor: 'Controle de pedidos é feito em papel' });
    const r = await admin.get(`${API}/levantamentos/${ctx.s1}/historico`);
    assert.equal(r.status, 200);
    const doQ = r.body.items.filter((x) => x.tipo === 'resposta' && x.referencia_id === q.id);
    assert.equal(doQ.length, 2, 'outro usuário abre um novo registro');
    const [ultimo] = doQ;
    assert.equal(ultimo.usuario_nome, 'Ana Administradora');
    assert.equal(ultimo.valor_anterior.valor.valor, 'A massa desanda quando falta controle de pedidos');
    assert.equal(ultimo.valor_novo.valor.valor, 'Controle de pedidos é feito em papel');
    assert.equal(ultimo.rotulo, q.enunciado);
    assert.ok(ultimo.criado_em);
    assert.ok(r.body.auditoria.some((a) => a.acao === 'criar'));
  });

  test('histórico, fotografia do roteiro e versões são protegidos no banco', async () => {
    await assert.rejects(h.db.query('DELETE FROM lr_historico WHERE levantamento_id = $1', [ctx.s1]), /não pode ser apagado/);
    const old = await h.db.one('SELECT id FROM lr_historico WHERE levantamento_id = $1 ORDER BY id LIMIT 1', [ctx.s1]);
    await assert.rejects(h.db.query("UPDATE lr_historico SET valor_anterior = '\"adulterado\"' WHERE id = $1", [old.id]), /não pode ser alterado/);
    await assert.rejects(h.db.query("UPDATE lr_roteiro_perguntas SET enunciado = 'adulterado' WHERE levantamento_id = $1", [ctx.s1]), /não pode ser alterado/);
  });

  test('gerencia o banco de perguntas: criar, editar, duplicar, reordenar, desativar e excluir', async () => {
    const bank = (await admin.get(`${API}/roteiro`)).body;
    const etapa = bank.etapas[0];
    // seleção exige alternativas
    const semOpcoes = await admin.post(`${API}/perguntas`, { etapa_id: etapa.id, enunciado: 'Qual o porte?', tipo: 'selecao_unica', opcoes: ['Pequeno'] });
    assert.equal(semOpcoes.status, 422);
    const nova = await admin.post(`${API}/perguntas`, { etapa_id: etapa.id, enunciado: 'Qual o porte da empresa?', tipo: 'selecao_unica', opcoes: ['Pequeno', 'Médio', 'Grande'], orientacao: 'Pergunte o número de funcionários.' });
    assert.equal(nova.status, 201, JSON.stringify(nova.body));
    assert.equal(nova.body.personalizada, true);
    ctx.custom = nova.body.id;
    const dup = await admin.post(`${API}/perguntas/${ctx.custom}/duplicar`);
    assert.equal(dup.status, 201);
    assert.match(dup.body.enunciado, /\(cópia\)$/);
    // reordenar: a nova pergunta vai para o topo da etapa
    const ids = (await admin.get(`${API}/roteiro`)).body.etapas[0].perguntas.map((p) => p.id);
    const novaOrdem = [ctx.custom, ...ids.filter((x) => x !== ctx.custom)];
    assert.equal((await admin.put(`${API}/perguntas/ordem`, { etapa_id: etapa.id, ids: novaOrdem })).status, 200);
    assert.equal((await admin.get(`${API}/roteiro`)).body.etapas[0].perguntas[0].id, ctx.custom);
    assert.equal((await admin.put(`${API}/perguntas/ordem`, { etapa_id: etapa.id, ids: novaOrdem.slice(1) })).status, 400, 'lista incompleta é recusada');
    // excluir: pergunta do roteiro inicial não; personalizada sim
    assert.equal((await admin.del(`${API}/perguntas/${etapa.perguntas[0].id}`)).status, 409);
    assert.equal((await admin.del(`${API}/perguntas/${dup.body.id}`)).status, 204);
    // etapas e categorias
    const et = await admin.post(`${API}/etapas`, { titulo: 'Etapa extra', descricao: 'Criada no teste' });
    assert.equal(et.status, 201);
    assert.equal((await admin.put(`${API}/etapas/${et.body.id}`, { titulo: 'Etapa extra (renomeada)' })).body.titulo, 'Etapa extra (renomeada)');
    assert.equal((await admin.del(`${API}/etapas/${etapa.id}`)).status, 409, 'etapa padrão não é excluída');
    assert.equal((await admin.del(`${API}/etapas/${et.body.id}`)).status, 204);
    const cat = await admin.post(`${API}/categorias`, { titulo: 'Segurança da informação' });
    assert.equal(cat.status, 201);
    assert.equal(cat.body.chave, 'seguranca_da_informacao');
    assert.equal((await admin.put(`${API}/etapas/${etapa.id}`, { descricao: 'Descrição revisada da etapa 1.' })).status, 200);
    const aud = await h.db.many("SELECT acao, entidade FROM auditoria WHERE entidade IN ('lr_pergunta','lr_etapa','lr_categoria')");
    for (const a of ['criar', 'duplicar', 'reordenar', 'excluir', 'editar']) assert.ok(aud.some((x) => x.acao === a), `auditoria de ${a}`);
  });

  test('15.4-1: modificar, desativar ou excluir perguntas não altera levantamentos anteriores', async () => {
    const bank = (await admin.get(`${API}/roteiro`)).body;
    const alvo = bank.etapas[1].perguntas.find((p) => p.enunciado === 'Qual problema você gostaria de resolver?');
    const antes = (await admin.get(`${API}/levantamentos/${ctx.s1}`)).body;
    const fotoAntes = flat(antes).find((q) => q.origem_pergunta_id === alvo.id);

    assert.equal((await admin.put(`${API}/perguntas/${alvo.id}`, { enunciado: 'Que dor do negócio você quer eliminar?', tipo: 'selecao_unica', opcoes: ['Tempo', 'Dinheiro'] })).status, 200);
    const sel = bank.etapas[1].perguntas.find((p) => p.tipo === 'selecao_multipla');
    assert.equal((await admin.put(`${API}/perguntas/${sel.id}`, { opcoes: ['Papel', 'Planilha', 'Sistema'] })).status, 200);
    const desativar = bank.etapas[1].perguntas.find((p) => p.enunciado.startsWith('Quem mais é prejudicado'));
    assert.equal((await admin.put(`${API}/perguntas/${desativar.id}`, { ativa: false })).status, 200);
    assert.equal((await admin.put(`${API}/etapas/${bank.etapas[1].id}`, { titulo: 'O problema' })).status, 200);

    const depois = (await admin.get(`${API}/levantamentos/${ctx.s1}`)).body;
    const fotoDepois = flat(depois).find((q) => q.origem_pergunta_id === alvo.id);
    assert.deepEqual(fotoDepois, fotoAntes, 'pergunta do levantamento antigo continua igual');
    assert.equal(fotoDepois.enunciado, 'Qual problema você gostaria de resolver?');
    assert.equal(fotoDepois.tipo, 'texto_longo');
    assert.deepEqual(flat(depois).find((q) => q.origem_pergunta_id === sel.id).opcoes, ['Papel', 'Planilha', 'WhatsApp', 'Outro sistema', 'Manualmente', 'Outra forma']);
    assert.ok(flat(depois).some((q) => q.origem_pergunta_id === desativar.id), 'pergunta desativada continua no levantamento antigo');
    assert.equal(depois.etapas[1].titulo, 'Identificando o problema');

    // Levantamento novo usa o banco atualizado
    const novo = await admin.post(`${API}/levantamentos`, { cliente_id: ctx.cliente, projeto_id: ctx.projeto, data_reuniao: '2026-11-08' });
    const sNovo = (await admin.get(`${API}/levantamentos/${novo.body.id}`)).body;
    assert.equal(flat(sNovo).find((q) => q.origem_pergunta_id === alvo.id).enunciado, 'Que dor do negócio você quer eliminar?');
    assert.ok(!flat(sNovo).some((q) => q.origem_pergunta_id === desativar.id));
    assert.ok(flat(sNovo).some((q) => q.origem_pergunta_id === ctx.custom), 'pergunta personalizada entra nos novos');
    assert.equal(sNovo.etapas[1].titulo, 'O problema');

    // Excluir a pergunta personalizada não afeta quem já a usou
    assert.equal((await admin.del(`${API}/perguntas/${ctx.custom}`)).status, 204);
    const sNovo2 = (await admin.get(`${API}/levantamentos/${novo.body.id}`)).body;
    assert.equal(flat(sNovo2).find((q) => q.origem_pergunta_id === ctx.custom)?.enunciado, 'Qual o porte da empresa?');
    ctx.sNovo = novo.body.id;
  });

  test('investigação de problemas — 5 porquês', async () => {
    const seis = Array.from({ length: 6 }, (_, i) => ({ pergunta: `Por que ${i}?`, resposta: 'Porque sim.' }));
    assert.equal((await admin.post(`${API}/levantamentos/${ctx.s1}/investigacoes`, { problema: 'Pedidos se perdem', niveis: seis })).status, 422);
    const r = await admin.post(`${API}/levantamentos/${ctx.s1}/investigacoes`, {
      problema: 'Pedidos de encomenda se perdem',
      niveis: [
        { pergunta: 'Por que os pedidos se perdem?', resposta: 'Porque são anotados em papéis soltos.' },
        { pergunta: 'Por que são anotados em papéis soltos?', resposta: 'Porque cada atendente anota de um jeito.' },
        { pergunta: 'Por que cada um anota de um jeito?', resposta: 'Porque não existe um procedimento padrão.' }
      ],
      causa: 'Ausência de registro centralizado e padronizado dos pedidos.',
      observacoes: 'Validar com a equipe de atendimento.'
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ctx.inv = r.body.id;
    const up = await admin.put(`${API}/levantamentos/${ctx.s1}/investigacoes/${ctx.inv}`, { causa: 'Falta de um registro único de pedidos.' });
    assert.equal(up.status, 200);
    const extra = await admin.post(`${API}/levantamentos/${ctx.s1}/investigacoes`, { problema: 'Investigação descartável' });
    assert.equal((await admin.del(`${API}/levantamentos/${ctx.s1}/investigacoes/${extra.body.id}`)).status, 204);
    const hist = await h.db.many("SELECT * FROM lr_historico WHERE levantamento_id = $1 AND tipo = 'investigacao' ORDER BY id", [ctx.s1]);
    assert.ok(hist.some((x) => x.valor_novo === null && x.valor_anterior?.problema === 'Investigação descartável'), 'remoção fica no histórico');
    const s = (await admin.get(`${API}/levantamentos/${ctx.s1}`)).body;
    assert.equal(s.investigacoes.length, 1);
    assert.equal(s.investigacoes[0].niveis.length, 3);
  });

  test('conclusão exige obrigatórias, trava a versão e reabertura cria nova versão sem destruir a anterior', async () => {
    const s = (await admin.get(`${API}/levantamentos/${ctx.s1}`)).body;
    const pend = await admin.post(`${API}/levantamentos/${ctx.s1}/concluir`);
    assert.equal(pend.status, 422);
    assert.equal(pend.body.codigo, 'OBRIGATORIAS_PENDENTES');
    for (const p of pend.body.campos.pendentes) {
      await admin.put(`${API}/levantamentos/${ctx.s1}/respostas/${p.id}`, { valor: `Resposta obrigatória ${p.id}` });
    }
    assert.equal((await admin.put(`${API}/levantamentos/${ctx.s1}/consolidacao`, { consolidacao: { resumo_executivo: 'Padaria quer centralizar encomendas.', problemas: 'Perda de pedidos.' }, observacoes_finais: 'Próxima reunião com a equipe.' })).status, 200);
    assert.equal((await admin.put(`${API}/levantamentos/${ctx.s1}/consolidacao`, { consolidacao: { chave_inexistente: 'x' } })).status, 422);

    // Leitor não conclui
    assert.equal((await leitor.post(`${API}/levantamentos/${ctx.s1}/concluir`)).status, 403);
    const ok = await admin.post(`${API}/levantamentos/${ctx.s1}/concluir`);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const c = (await admin.get(`${API}/levantamentos/${ctx.s1}`)).body;
    assert.equal(c.status, 'concluido');
    assert.equal(c.versao.status, 'concluida');
    assert.equal(c.editavel, false);
    assert.equal((await admin.get(`${API}/projetos/${ctx.projeto}`)).body.situacao, 'aguardando_detalhamento');

    const q = s.etapas[1].perguntas[0];
    assert.equal((await admin.put(`${API}/levantamentos/${ctx.s1}/respostas/${q.id}`, { valor: 'mudança proibida' })).status, 409);
    // Proteção também no banco
    await assert.rejects(h.db.query("UPDATE lr_respostas SET valor = '{\"valor\":\"x\",\"detalhe\":null}' WHERE versao_id = $1", [c.versao.id]), /versão em trabalho/);
    await assert.rejects(h.db.query("UPDATE lr_versoes SET observacoes_finais = 'x' WHERE id = $1", [c.versao.id]), /concluída/);

    assert.equal((await admin.post(`${API}/levantamentos/${ctx.s1}/reabrir`, {})).status, 422, 'motivo obrigatório');
    const re = await admin.post(`${API}/levantamentos/${ctx.s1}/reabrir`, { motivo: 'Cliente enviou novas informações por e-mail.' });
    assert.equal(re.status, 200);
    assert.equal(re.body.versao, 2);
    const v2 = (await admin.get(`${API}/levantamentos/${ctx.s1}`)).body;
    assert.equal(v2.versao.numero, 2);
    assert.equal(v2.versao.status, 'em_trabalho');
    assert.equal(v2.etapas[1].perguntas[0].resposta.valor.valor, 'Controle de pedidos é feito em papel', 'conteúdo copiado');
    assert.equal(v2.investigacoes.length, 1);
    assert.equal(v2.versao.consolidacao.resumo_executivo, 'Padaria quer centralizar encomendas.');

    await admin.put(`${API}/levantamentos/${ctx.s1}/respostas/${q.id}`, { valor: 'Agora usam planilha compartilhada' });
    const v1 = (await admin.get(`${API}/levantamentos/${ctx.s1}?versao=1`)).body;
    assert.equal(v1.versao.status, 'concluida');
    assert.equal(v1.etapas[1].perguntas[0].resposta.valor.valor, 'Controle de pedidos é feito em papel', 'versão 1 preservada');
    assert.equal(v1.versoes.length, 2);
    const audits = (await h.db.many("SELECT acao FROM auditoria WHERE entidade = 'levantamento' AND entidade_id = $1", [String(ctx.s1)])).map((a) => a.acao);
    assert.ok(audits.includes('concluir') && audits.includes('reabrir'));
    const reab = await h.db.one("SELECT * FROM lr_historico WHERE levantamento_id = $1 AND rotulo = 'Reabertura'", [ctx.s1]);
    assert.equal(reab.valor_novo.motivo, 'Cliente enviou novas informações por e-mail.');
  });

  test('compara versões e entrevistas diferentes', async () => {
    const r = await admin.get(`${API}/levantamentos/comparar?a=${ctx.s1}:1&b=${ctx.s1}:2`);
    assert.equal(r.status, 200);
    assert.equal(r.body.diferencas, 1);
    const linha = r.body.linhas.find((l) => l.diferente);
    assert.equal(linha.a, 'Controle de pedidos é feito em papel');
    assert.equal(linha.b, 'Agora usam planilha compartilhada');
    const cross = await admin.get(`${API}/levantamentos/comparar?a=${ctx.s1}&b=${ctx.sNovo}`);
    assert.equal(cross.status, 200);
    assert.ok(cross.body.linhas.some((l) => l.somente_em === 'b'), 'perguntas que só existem em uma das entrevistas aparecem');
    assert.equal((await admin.get(`${API}/levantamentos/comparar?a=abc&b=1`)).status, 422);
  });

  test('duplica levantamento: mesmas perguntas da origem, sem respostas, independente', async () => {
    const origem = (await admin.get(`${API}/levantamentos/${ctx.s1}`)).body;
    const d = await admin.post(`${API}/levantamentos/${ctx.s1}/duplicar`, { data_reuniao: '2026-12-01' });
    assert.equal(d.status, 201);
    ctx.dup = d.body.id;
    const s = (await admin.get(`${API}/levantamentos/${ctx.dup}`)).body;
    assert.equal(s.origem_id, ctx.s1);
    assert.equal(s.projeto_id, origem.projeto_id);
    assert.deepEqual(flat(s).map((q) => [q.enunciado, q.tipo, q.opcoes, q.obrigatoria]), flat(origem).map((q) => [q.enunciado, q.tipo, q.opcoes, q.obrigatoria]),
      'roteiro da origem (inclusive textos antigos), não o banco atual');
    assert.equal(s.progresso.respondidas, 0, 'respostas não são copiadas');
    assert.equal(s.investigacoes.length, 0);
    assert.equal(s.status, 'em_andamento');
    await admin.put(`${API}/levantamentos/${ctx.dup}/respostas/${flat(s)[0].id}`, { valor: 'Resposta só da cópia' });
    const origemDepois = (await admin.get(`${API}/levantamentos/${ctx.s1}`)).body;
    assert.deepEqual(flat(origemDepois).map((q) => q.resposta), flat(origem).map((q) => q.resposta), 'origem não é afetada');
  });

  test('arquiva, filtra e pesquisa por cliente, projeto, palavra-chave, status e período', async () => {
    assert.equal((await admin.post(`${API}/levantamentos/${ctx.s3}/arquivar`)).status, 200);
    assert.equal((await admin.put(`${API}/levantamentos/${ctx.s3}/respostas/${flat((await admin.get(`${API}/levantamentos/${ctx.s3}`)).body)[0].id}`, { valor: 'x' })).status, 409);
    const padrao = (await admin.get(`${API}/levantamentos`)).body;
    assert.ok(!padrao.items.some((x) => x.id === ctx.s3), 'arquivados ficam fora da lista padrão');
    const arq = (await admin.get(`${API}/levantamentos?status=arquivado`)).body;
    assert.deepEqual(arq.items.map((x) => x.id), [ctx.s3]);
    const kw = (await admin.get(`${API}/levantamentos?busca=${encodeURIComponent('planilha compartilhada')}`)).body;
    assert.deepEqual(kw.items.map((x) => x.id), [ctx.s1], 'palavra-chave encontra respostas');
    const kw2 = (await admin.get(`${API}/levantamentos?busca=${encodeURIComponent('registro único')}`)).body;
    assert.ok(kw2.items.some((x) => x.id === ctx.s1), 'palavra-chave encontra os 5 porquês');
    const porProjeto = (await admin.get(`${API}/levantamentos?projeto_id=${ctx.projeto2}`)).body;
    assert.equal(porProjeto.total, 1);
    const porCliente = (await admin.get(`${API}/levantamentos?cliente_id=${ctx.cliente}&status=todos`)).body;
    assert.equal(porCliente.total, 5);
    const periodo = (await admin.get(`${API}/levantamentos?de=2026-11-06&ate=2026-11-07&status=todos`)).body;
    assert.equal(periodo.total, 2);
    assert.equal((await admin.post(`${API}/levantamentos/${ctx.s3}/desarquivar`)).status, 200);
    const resumo = (await admin.get(`${API}/resumo`)).body;
    assert.equal(resumo.indicadores.clientes, 2);
    assert.equal(resumo.indicadores.projetos, 2);
    assert.equal(resumo.indicadores.aguardando_detalhamento, 1);
    assert.equal(resumo.indicadores.em_andamento, 5);
    assert.equal(resumo.ultimos.length, 5);
  });

  test('permissões negadas no backend', async () => {
    const s1 = `${API}/levantamentos/${ctx.s1}`;
    // Usuário sem nenhuma permissão do módulo
    for (const [m, p] of [['get', `${API}/levantamentos`], ['get', s1], ['get', `${API}/roteiro`], ['get', `${API}/resumo`], ['get', `${s1}/previa`], ['get', `${s1}/historico`]]) {
      assert.equal((await consulta[m](p)).status, 403, `${m} ${p}`);
    }
    // Somente leitura: lê, mas não altera nada
    assert.equal((await leitor.get(s1)).status, 200);
    assert.equal((await leitor.get(`${API}/roteiro`)).status, 200);
    const q = flat((await leitor.get(s1)).body)[0];
    const negados = [
      () => leitor.post(`${API}/levantamentos`, { cliente: { nome: 'X' }, projeto: { nome: 'Y' }, data_reuniao: '2026-11-08' }),
      () => leitor.put(`${s1}/respostas/${q.id}`, { valor: 'x' }),
      () => leitor.put(`${s1}/consolidacao`, { consolidacao: {} }),
      () => leitor.post(`${s1}/investigacoes`, { problema: 'xxx' }),
      () => leitor.post(`${s1}/duplicar`, {}),
      () => leitor.post(`${s1}/arquivar`),
      () => leitor.post(`${s1}/reabrir`, { motivo: 'qualquer motivo' }),
      () => leitor.post(`${s1}/relatorios`, {}),
      () => leitor.post(`${API}/perguntas`, { etapa_id: 1, enunciado: 'Nova?', tipo: 'texto_curto' }),
      () => leitor.put(`${API}/etapas/1`, { titulo: 'Invadida' }),
      () => leitor.post(`${API}/clientes`, { nome: 'Novo' })
    ];
    for (const call of negados) assert.equal((await call()).status, 403);
    // Gerente comercial cria e edita, mas não gerencia perguntas
    assert.equal((await gerente.post(`${API}/perguntas`, { etapa_id: 1, enunciado: 'Nova?', tipo: 'texto_curto' })).status, 403);
    // Clientes da área do cliente e anônimos não acessam nada
    assert.equal((await cliente.get(`${API}/levantamentos`)).status, 403);
    assert.equal((await cliente.get(s1)).status, 403);
    assert.equal((await h.anon().get(s1)).status, 401);
    // CSRF obrigatório
    const semCsrf = await admin.agent.put(`${s1}/respostas/${q.id}`).send({ valor: 'x' });
    assert.equal(semCsrf.status, 403);
  });

  test('pré-visualização do relatório usa os dados da versão e escapa conteúdo', async () => {
    const s = (await admin.get(`${API}/levantamentos/${ctx.s1}`)).body;
    const q = flat(s).find((x) => x.tipo === 'texto_longo' && !x.resposta);
    await admin.put(`${API}/levantamentos/${ctx.s1}/respostas/${q.id}`, { valor: '<script>alert(1)</script> veja https://exemplo.com.br/doc.' });
    const r = await admin.get(`${API}/levantamentos/${ctx.s1}/previa`);
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.ok(r.text.includes('Relatório de descoberta e levantamento de requisitos'));
    assert.ok(!r.text.includes('<script>alert(1)</script>'));
    assert.ok(r.text.includes('&lt;script&gt;'));
    assert.ok(r.text.includes('<a href="https://exemplo.com.br/doc">'), 'links clicáveis');
    assert.ok(r.text.includes('Não constitui, isoladamente, uma especificação técnica definitiva'));
    const v1 = await admin.get(`${API}/levantamentos/${ctx.s1}/previa?versao=1`);
    assert.ok(v1.text.includes('Controle de pedidos é feito em papel'));
    assert.ok(!v1.text.includes('Agora usam planilha compartilhada'));
  });

  test('15.4-3: PDF fica guardado, ligado à versão, e continua representando a versão que o originou', { skip: noBrowser, timeout: 180_000 }, async () => {
    const r1 = await admin.post(`${API}/levantamentos/${ctx.s1}/relatorios`, { versao: 1 });
    assert.equal(r1.status, 201, JSON.stringify(r1.body));
    assert.equal(r1.body.versao_numero, 1);
    assert.equal(r1.body.versao_status, 'concluida');
    assert.equal(r1.body.nome_arquivo, 'levantamento-requisitos-joana-prado-gestao-de-encomendas.pdf');
    assert.ok(r1.body.paginas >= 6, `páginas: ${r1.body.paginas}`);
    assert.equal(r1.body.arquivo_chave, undefined, 'chave do arquivo não é exposta');
    const f1 = await admin.agent.get(`${API}/levantamentos/${ctx.s1}/relatorios/${r1.body.id}/arquivo`).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    assert.equal(f1.status, 200);
    assert.equal(f1.headers['content-type'], 'application/pdf');
    assert.equal(f1.body.subarray(0, 5).toString(), '%PDF-');
    const sha = (await import('node:crypto')).createHash('sha256').update(f1.body).digest('hex');
    assert.equal(sha, r1.body.sha256);

    // Versão em trabalho muda; o PDF da versão 1 não muda
    const s = (await admin.get(`${API}/levantamentos/${ctx.s1}`)).body;
    await admin.put(`${API}/levantamentos/${ctx.s1}/respostas/${s.etapas[0].perguntas[1].id}`, { valor: 'Nova informação da versão 2' });
    const r2 = await admin.post(`${API}/levantamentos/${ctx.s1}/relatorios`, {});
    assert.equal(r2.status, 201);
    assert.equal(r2.body.versao_numero, 2);
    assert.equal(r2.body.versao_status, 'em_trabalho');
    assert.equal(r2.body.nome_arquivo, 'levantamento-requisitos-joana-prado-gestao-de-encomendas-v2.pdf');
    assert.notEqual(r2.body.conteudo_sha256, r1.body.conteudo_sha256);
    const lista = (await leitor.get(`${API}/levantamentos/${ctx.s1}/relatorios`)).body;
    assert.deepEqual(lista.map((x) => x.versao_numero), [2, 1]);
    const again = await admin.agent.get(`${API}/levantamentos/${ctx.s1}/relatorios/${r1.body.id}/arquivo`).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    assert.equal((await import('node:crypto')).createHash('sha256').update(again.body).digest('hex'), r1.body.sha256, 'arquivo antigo intacto');
    await assert.rejects(h.db.query('UPDATE lr_relatorios SET versao_numero = 9 WHERE id = $1', [r1.body.id]), /não pode ser alterado/);
    const aud = await h.db.one("SELECT detalhes FROM auditoria WHERE acao = 'gerar_relatorio' AND entidade_id = $1 ORDER BY id LIMIT 1", [String(ctx.s1)]);
    assert.equal(aud.detalhes.versao, 1);
    // Relatório de outro levantamento não é servido por este caminho
    assert.equal((await admin.get(`${API}/levantamentos/${ctx.dup}/relatorios/${r1.body.id}/arquivo`)).status, 404);
  });
});
