// Gera questionários DOCX de exemplo (em branco e com respostas) a partir do banco de TESTES,
// em docs/levantamento/exemplos/. Uso: node tests/e2e/questionario-exemplo.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { resetDatabase, createStaff, closeDatabase } from '../integration/helpers.js';

const svc = await import('../../backend/src/modules/requirements/surveys.service.js');
const reports = await import('../../backend/src/modules/requirements/reports.service.js');
const OUT = path.resolve('docs/levantamento/exemplos');
mkdirSync(OUT, { recursive: true });
await resetDatabase();
const uid = await createStaff('questionario@exemplo.test', 'administrador', { nome: 'Marina Costa' });
const req = { user: { id: uid, nome: 'Marina Costa' }, ip: '127.0.0.1' };
const { id } = await svc.createSurvey({ cliente: { nome: 'Joana Prado', empresa: 'Padaria Prado' }, projeto: { nome: 'Gestão de encomendas' }, data_reuniao: '2026-11-10' }, req);
const s = await svc.getSurvey(id);
const qs = s.etapas.flatMap((e) => e.perguntas);
const pick = (t) => qs.find((q) => q.tipo === t);
await svc.saveAnswer(id, qs[0].id, { valor: 'Hoje os pedidos chegam pelo WhatsApp e são anotados num caderno.\nQueremos organizar as encomendas.' }, req);
if (pick('sim_nao')) await svc.saveAnswer(id, pick('sim_nao').id, { valor: 'sim', detalhe: 'Dois atendentes e a gerente.' }, req);
if (pick('selecao_multipla')) await svc.saveAnswer(id, pick('selecao_multipla').id, { valor: pick('selecao_multipla').opcoes.slice(0, 2) }, req);
for (const [nome, com] of [['questionario-em-branco', false], ['questionario-com-respostas', true]]) {
  const { buffer } = await reports.surveyQuestionnaire(id, { comRespostas: com }, req);
  writeFileSync(path.join(OUT, `${nome}.docx`), buffer);
  console.log(`${nome}.docx: ${(buffer.length / 1024).toFixed(0)} KB`);
}
await closeDatabase();
