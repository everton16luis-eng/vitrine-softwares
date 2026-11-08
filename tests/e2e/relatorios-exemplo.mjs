// Gera relatórios PDF de exemplo em volumes diferentes para conferência visual (seção 15.2).
// Usa SOMENTE o banco de testes (DATABASE_URL_TEST, recriado do zero) e grava os arquivos em
// docs/levantamento/exemplos/.
//
// Uso: node tests/e2e/relatorios-exemplo.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resetDatabase, createStaff, closeDatabase, db } from '../integration/helpers.js';

const svc = await import('../../backend/src/modules/requirements/surveys.service.js');
const { buildReportModel, renderReport, logoDataUri } = await import('../../backend/src/modules/requirements/report-document.js');
const { htmlToPdf } = await import('../../backend/src/services/pdf.js');
const { getSettings } = await import('../../backend/src/modules/settings/settings.service.js');

const OUT = path.resolve('docs/levantamento/exemplos');
mkdirSync(OUT, { recursive: true });

await resetDatabase();
const uid = await createStaff('exemplos@exemplo.test', 'administrador', { nome: 'Marina Costa' });
const req = { user: { id: uid, nome: 'Marina Costa' }, ip: '127.0.0.1' };

const FRASES = [
  'Hoje os pedidos chegam pelo WhatsApp e são copiados para um caderno no balcão.',
  'Quando o movimento aumenta, ninguém sabe ao certo o que já foi confirmado com o cliente.',
  'A gerente revisa tudo no fim do dia e encontra divergências de valores e datas de entrega.',
  'Gostaríamos de ver em uma tela única o que precisa ser produzido amanhã, por categoria.',
  'Os atendentes não têm acesso aos valores de custo, apenas aos preços de venda.',
  'Um relatório mensal com os produtos mais pedidos ajudaria no planejamento das compras.',
  'A integração com o emissor de nota fiscal é desejável, mas pode ficar para depois.',
  'O sistema precisa funcionar no celular, porque as entregas são conferidas na rua.',
  'Já testamos uma planilha compartilhada, mas as pessoas sobrescreviam as informações umas das outras.',
  'O mais importante é não perder nenhuma encomenda de aniversário ou casamento.'
];
const texto = (n, seed = 0) => Array.from({ length: n }, (_, i) => FRASES[(seed + i) % FRASES.length]).join(' ');
const paragrafos = (p, n, seed) => Array.from({ length: p }, (_, i) => texto(n, seed + i * 3)).join('\n\n');

function valorPara(q, nivel, i) {
  switch (q.tipo) {
    case 'texto_curto': return { valor: ['Cerca de 2 horas por dia', 'Até R$ 40 mil', 'Carlos, do financeiro'][i % 3] };
    case 'sim_nao': return { valor: i % 3 ? 'sim' : 'nao', detalhe: nivel > 1 ? texto(1, i) : null };
    case 'selecao_unica': return { valor: q.opcoes[i % q.opcoes.length] };
    case 'selecao_multipla': return { valor: q.opcoes.filter((_, j) => (j + i) % 2 === 0) };
    case 'numero': return { valor: 12 + i };
    case 'data': return { valor: '2027-03-15', detalhe: 'Antes da temporada de Páscoa.' };
    case 'observacoes': return { valor: texto(2, i) };
    default: return { valor: nivel === 3 ? paragrafos(2, 3, i) : texto(nivel === 1 ? 1 : 2, i) };
  }
}

const LONGO = `${paragrafos(4, 5, 1)}\n\nPontos citados pelo cliente:\n- Cadastro de clientes com histórico de encomendas\n- Agenda de produção por dia e por turno\n- Confirmação automática por WhatsApp\n- Painel com o faturamento da semana\n\nReferência enviada: https://www.exemplo.com.br/cardapio-encomendas e contato pedidos@padariaprado.com.br.\n\n${paragrafos(3, 6, 4)}`;

const PORQUES = [
  { problema: 'Encomendas são entregues com atraso ou esquecidas.', niveis: [
    ['Por que as encomendas atrasam?', 'Porque a produção só descobre o pedido no dia da entrega.'],
    ['Por que a produção descobre tarde?', 'Porque o pedido fica anotado no caderno do balcão.'],
    ['Por que fica só no caderno?', 'Porque não existe um lugar comum para registrar e consultar pedidos.'],
    ['Por que não existe esse lugar?', 'Porque o volume cresceu e o processo informal nunca foi revisto.'],
    ['Por que o processo não foi revisto?', 'Porque a equipe não tem tempo nem ferramenta para isso.']
  ], causa: 'Ausência de um registro único e compartilhado de encomendas, visível para atendimento e produção.', observacoes: 'Validar com a equipe de produção na próxima reunião.' },
  { problema: 'Divergência de valores cobrados.', niveis: [
    ['Por que os valores divergem?', 'Cada atendente calcula o preço de um jeito.'],
    ['Por que cada um calcula de um jeito?', 'Não há tabela de preços atualizada à vista.'],
    ['Por que a tabela não está à vista?', 'Ela fica numa planilha no computador do escritório.']
  ], causa: 'Tabela de preços inacessível no momento do atendimento.', observacoes: null },
  { problema: 'Retrabalho no fechamento do caixa.', niveis: [
    ['Por que há retrabalho?', 'Os pagamentos de sinal não são registrados junto do pedido.'],
    ['Por que não são registrados?', 'O sinal é recebido por PIX e anotado depois, quando lembram.']
  ], causa: 'Falta de vínculo entre pagamento de sinal e encomenda.', observacoes: 'Possível integração com o banco em uma segunda etapa.' }
];

async function cenario(nome, { cliente, empresa, projeto, nivel, fracao, longas = 0, porques = 0, consolidar = false, notas = false, concluir = false }) {
  const { id } = await svc.createSurvey({
    cliente: { nome: cliente, empresa, email: `${cliente.split(' ')[0].toLowerCase()}@exemplo.com.br`, telefone: '(11) 98888-7777' },
    projeto: { nome: projeto, descricao: 'Sistema para organizar pedidos, produção e entregas, acessível no computador e no celular.' },
    data_reuniao: '2026-11-05', observacoes_iniciais: nivel ? 'Reunião presencial na loja, com a proprietária e a gerente de produção.' : null
  }, req);
  const s = await svc.getSurvey(id);
  const qs = s.etapas.flatMap((e) => e.perguntas);
  let i = 0;
  for (const q of qs) {
    const deve = q.obrigatoria || (fracao > 0 && (i % Math.round(1 / fracao) === 0 || fracao >= 1));
    if (deve && nivel > 0) await svc.saveAnswer(id, q.id, q.tipo === 'texto_longo' && longas > 0 && i % 7 === 0 ? (longas--, { valor: LONGO }) : valorPara(q, nivel, i), req);
    else if (nivel > 0 && i % 9 === 4) await svc.saveAnswer(id, q.id, { pulada: true }, req);
    i++;
  }
  if (notas) for (const e of s.etapas) await svc.saveStageNote(id, e.id, { texto: texto(2, e.ordem) }, req);
  for (const p of PORQUES.slice(0, porques)) await svc.createInvestigation(id, { problema: p.problema, niveis: p.niveis.map(([pergunta, resposta]) => ({ pergunta, resposta })), causa: p.causa, observacoes: p.observacoes }, req);
  if (consolidar) {
    await svc.saveConsolidation(id, {
      consolidacao: {
        resumo_executivo: 'A Padaria Prado quer centralizar encomendas, produção e entregas num sistema simples, usado no balcão e no celular. O principal ganho esperado é não perder pedidos e reduzir o retrabalho no fechamento do dia.',
        contexto: 'A ideia surgiu depois de duas encomendas de casamento esquecidas em outubro. A proprietária quer um lugar único para registrar e acompanhar pedidos.',
        objetivo: 'Registrar 100% das encomendas no sistema e dar visibilidade da produção do dia seguinte até as 18h.',
        problemas: 'Pedidos dispersos entre WhatsApp e caderno; divergência de valores; retrabalho no caixa.',
        regras: 'Somente a gerente aprova descontos acima de 10%. Encomendas exigem sinal de 30%. Alterações até 48h antes da entrega.',
        duvidas: 'Confirmar se a emissão de nota fiscal entra na primeira etapa. Levantar volume médio de pedidos por semana.'
      },
      observacoes_finais: 'Próximo passo: reunião com a equipe de produção e envio das planilhas atuais. Proposta de escopo prevista para a semana seguinte.'
    }, req);
  }
  if (concluir) await svc.concludeSurvey(id, req);
  const fresh = await svc.getSurvey(id);
  const settings = await getSettings({ fresh: true });
  const model = buildReportModel(fresh, settings);
  const html = await renderReport(model, { mode: 'pdf', logoSrc: await logoDataUri(settings.logo_url) });
  const t0 = Date.now();
  const { buffer, paginas } = await htmlToPdf(html, { footer: fresh.codigo });
  writeFileSync(path.join(OUT, `${nome}.pdf`), buffer);
  console.log(`${nome}: ${paginas} páginas, ${(buffer.length / 1024).toFixed(0)} KB, ${Date.now() - t0} ms — ${model.totais.respondidas}/${model.totais.perguntas} respondidas`);
}

await cenario('1-pequeno', { cliente: 'Rafael Lima', empresa: null, projeto: 'Agenda de aulas particulares', nivel: 1, fracao: 0.15 });
await cenario('2-intermediario', { cliente: 'Joana Prado', empresa: 'Padaria Prado', projeto: 'Gestão de encomendas', nivel: 2, fracao: 0.5, porques: 1, consolidar: true, concluir: true });
await cenario('3-extenso', { cliente: 'Joana Prado', empresa: 'Padaria Prado Ltda.', projeto: 'Gestão de encomendas, produção e entregas', nivel: 3, fracao: 1, porques: 3, consolidar: true, notas: true, concluir: true });
await cenario('4-respostas-muito-longas', { cliente: 'Hélio Araújo', empresa: 'Clínica São Lucas', projeto: 'Prontuário e agenda multiprofissional', nivel: 2, fracao: 0.6, longas: 6, notas: true });
await cenario('5-sem-respostas', { cliente: 'Beatriz Nóbrega', empresa: 'Ateliê Nóbrega', projeto: 'Loja virtual de peças sob medida', nivel: 0, fracao: 0 });
await cenario('6-cinco-porques', { cliente: 'Otávio Mendes', empresa: 'Transportes Mendes', projeto: 'Controle de frota e manutenção', nivel: 1, fracao: 0.25, porques: 3 });

console.log(`Arquivos em ${OUT}`);
void db;
await closeDatabase();
