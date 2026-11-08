// Relatórios PDF dos levantamentos: pré-visualização, geração, guarda e consulta.
// Cada PDF fica no armazenamento privado, ligado à versão que o originou, e nunca é sobrescrito.
import crypto from 'node:crypto';
import { db, withTransaction } from '../../database/pool.js';
import { storage } from '../../services/storage/index.js';
import { audit } from '../../services/audit.js';
import { htmlToPdf } from '../../services/pdf.js';
import { notFound } from '../../utils/errors.js';
import { getSettings } from '../settings/settings.service.js';
import { getSurvey } from './surveys.service.js';
import { reportFileName } from './answers.js';
import { buildReportModel, renderReport, logoDataUri } from './report-document.js';
import { buildQuestionnaireDocx, questionnaireFileName } from './questionnaire-docx.js';
import { getBank } from './bank.service.js';

const newKey = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomBytes(16).toString('hex')}.pdf`;
};

/** HTML da pré-visualização (mesmo modelo do PDF). */
export async function previewHtml(id, versao) {
  const s = await getSurvey(id, { versao });
  const settings = await getSettings();
  const model = buildReportModel(s, settings);
  const toolbar = `<div class="previa-barra"><div><strong>Pré-visualização</strong> <span>— ${escapeText(s.codigo)}, versão ${s.versao.numero}${model.rascunho ? ' (em trabalho)' : ''}. A paginação final aparece no PDF.</span></div></div>`;
  return renderReport(model, { mode: 'preview', logoSrc: settings.logo_url || null, toolbar });
}

const escapeText = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Gera, guarda e registra o PDF da versão pedida (padrão: a mais recente). */
export async function generateReport(id, input = {}, req) {
  const versao = input.versao ?? null;
  const s = await getSurvey(id, { versao });
  const settings = await getSettings({ fresh: true });
  const model = buildReportModel(s, settings);
  const html = await renderReport(model, { mode: 'pdf', logoSrc: await logoDataUri(settings.logo_url) });
  const { buffer, paginas } = await htmlToPdf(html, { footer: `${model.empresa} · ${s.codigo} · versão ${s.versao.numero}` });
  const key = newKey();
  const nome = reportFileName(s.cliente_nome, s.projeto_nome, s.versao.numero);
  await storage().save(buffer, { key, privado: true });
  try {
    return await withTransaction(async (tx) => {
      const row = await tx.one(`INSERT INTO lr_relatorios (levantamento_id, versao_id, versao_numero, versao_status, arquivo_chave, nome_arquivo, tamanho, paginas, sha256, conteudo_sha256, gerado_por, gerado_por_nome)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [id, s.versao.id, s.versao.numero, s.versao.status, key, nome, buffer.length, paginas, crypto.createHash('sha256').update(buffer).digest('hex'), model.fingerprint, req.user.id, req.user.nome]);
      await audit(req, 'gerar_relatorio', 'levantamento', id, { relatorio_id: row.id, versao: s.versao.numero, versao_status: s.versao.status, paginas, arquivo: nome }, tx);
      return publicRow(row);
    });
  } catch (err) {
    await storage().remove(key, { privado: true }).catch(() => {});
    throw err;
  }
}

const publicRow = ({ arquivo_chave: _k, ...r }) => r;

export async function listReports(id) {
  if (!(await db.one('SELECT 1 FROM levantamentos WHERE id = $1', [id]))) throw notFound('Levantamento');
  const rows = await db.many('SELECT * FROM lr_relatorios WHERE levantamento_id = $1 ORDER BY gerado_em DESC, id DESC', [id]);
  return rows.map(publicRow);
}

/** Entrega o PDF guardado (inline para visualizar ou como download). */
export async function streamReport(id, relId, res, { inline = false } = {}) {
  const row = await db.one('SELECT * FROM lr_relatorios WHERE id = $1 AND levantamento_id = $2', [relId, id]);
  if (!row) throw notFound('Relatório');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(row.tamanho));
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${row.nome_arquivo}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  const stream = storage().read(row.arquivo_chave, { privado: true });
  stream.on('error', () => { if (!res.headersSent) res.status(404).json({ erro: 'Arquivo do relatório não encontrado no armazenamento.', codigo: 'NAO_ENCONTRADO' }); else res.end(); });
  stream.pipe(res);
}

// ------------------------------------------------------------------ questionário em Word
/** Questionário do levantamento (perguntas do roteiro dele), em branco ou com as respostas da versão. */
export async function surveyQuestionnaire(id, { versao = null, comRespostas = false } = {}, req) {
  const s = await getSurvey(id, { versao });
  const settings = await getSettings();
  const buffer = await buildQuestionnaireDocx({
    etapas: s.etapas, settings, cliente: s.cliente_nome, empresa: s.cliente_empresa, projeto: s.projeto_nome, codigo: s.codigo, comRespostas
  });
  await audit(req, 'exportar_questionario', 'levantamento', id, { versao: s.versao.numero, com_respostas: comRespostas });
  return { buffer, nome: questionnaireFileName(s.cliente_nome, s.projeto_nome) };
}

/** Questionário genérico com o roteiro ativo do banco de perguntas (sem cliente). */
export async function bankQuestionnaire() {
  const bank = await getBank();
  const etapas = bank.etapas.filter((e) => e.ativa).map((e) => ({ ...e, perguntas: e.perguntas.filter((q) => q.ativa) })).filter((e) => e.perguntas.length);
  const buffer = await buildQuestionnaireDocx({ etapas, settings: await getSettings() });
  return { buffer, nome: questionnaireFileName(null, null) };
}

export function sendDocx(res, { buffer, nome }) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(buffer);
}
