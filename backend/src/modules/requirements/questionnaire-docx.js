// Questionário em Word (.docx) para enviar ao cliente antes ou depois da reunião de descoberta.
// Mostra só o que o cliente precisa ler: etapas, perguntas e espaço para responder. As orientações
// do roteiro são para o entrevistador e ficam de fora. Alternativas viram caixas de seleção do Word
// (clicáveis); textos ganham um quadro para digitar.
import {
  BorderStyle, CheckBox, Document, Footer, Header, ImageRun, Packer, PageNumber, Paragraph,
  Table, TableCell, TableRow, TabStopType, TextRun, WidthType, HeightRule
} from 'docx';
import { DEFAULT_COLORS, readableOn } from '../../views/theme.js';
import { formatAnswer, isAnswered } from './answers.js';
import { longDate, logoDataUri } from './report-document.js';

const FONT = 'Arial';
const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v, d) => (HEX.test(v || '') ? v : d).slice(1).toUpperCase();
const PAGE_W = 11906; // A4 em twips
const MARGIN = 1134; // 2 cm
const CONTENT_W = PAGE_W - MARGIN * 2;

/** Nome do arquivo: questionario-<cliente>-<projeto>.docx (ou questionario-descoberta.docx). */
export function questionnaireFileName(cliente, projeto) {
  const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  const parts = ['questionario', slug(cliente), slug(projeto)].filter(Boolean);
  return `${parts.length > 1 ? parts.join('-') : 'questionario-descoberta'}.docx`;
}

/** Dimensões de PNG/JPEG (o docx precisa delas para manter a proporção do logo). */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { type: 'jpg', w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

async function logoRun(settings) {
  const uri = await logoDataUri(settings.logo_url).catch(() => null);
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(uri || '');
  if (!m) return null;
  const data = Buffer.from(m[2], 'base64');
  const size = imageSize(data);
  if (!size || !size.w || !size.h) return null;
  const h = 34;
  const w = Math.min(180, Math.round((size.w / size.h) * h));
  return new ImageRun({ type: size.type, data, transformation: { width: w, height: Math.round((w / size.w) * size.h) } });
}

/**
 * @param {object} p
 *   etapas: [{ titulo, perguntas: [{ enunciado, tipo, opcoes, obrigatoria, resposta? }] }]
 *   settings: configurações do site (nome, contato, cores, logo)
 *   cliente, empresa, projeto, codigo, data: textos da identificação (opcionais)
 *   comRespostas: preenche os quadros com as respostas já registradas
 * @returns {Promise<Buffer>}
 */
export async function buildQuestionnaireDocx({ etapas, settings = {}, cliente = null, empresa = null, projeto = null, codigo = null, data = null, comRespostas = false }) {
  const ink = hex(settings.cor_primaria, DEFAULT_COLORS.primaria);
  const accent = readableOn(`#${hex(settings.cor_destaque, DEFAULT_COLORS.destaque)}`, '#FFFFFF', 4.5).slice(1);
  const line = hex(settings.cor_secundaria, DEFAULT_COLORS.secundaria);
  const muted = '5B6676';
  const rule = 'C9D1DB';
  const nomeEmpresa = settings.nome_comercial || settings.razao_social || 'Nossa equipe';
  const run = (text, o = {}) => new TextRun({ text: String(text ?? ''), font: FONT, ...o });
  const para = (children, o = {}) => new Paragraph({ children: [].concat(children), spacing: { after: 120, line: 276 }, ...o });

  // Quadro de resposta: tabela de uma célula, borda fina, altura mínima conforme o tipo.
  const box = (linhas, texto = '') => new Table({
    width: { size: CONTENT_W - 567, type: WidthType.DXA },
    columnWidths: [CONTENT_W - 567],
    indent: { size: 567, type: WidthType.DXA },
    rows: [new TableRow({
      height: { value: 300 * linhas, rule: HeightRule.ATLEAST },
      children: [new TableCell({
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        borders: Object.fromEntries(['top', 'bottom', 'left', 'right'].map((k) => [k, { style: BorderStyle.SINGLE, size: 4, color: rule }])),
        children: String(texto || '').split('\n').map((t) => para(run(t, { size: 21 }), { spacing: { after: 40 } }))
      })]
    })]
  });
  const choice = (label, checked) => para([new CheckBox({ checked, checkedState: { value: '2612' }, uncheckedState: { value: '2610' } }), run(`  ${label}`, { size: 21 })], { indent: { left: 567 }, spacing: { after: 60 }, keepNext: true, keepLines: true });
  const hint = (t) => para(run(t, { size: 18, italics: true, color: muted }), { indent: { left: 567 }, spacing: { after: 60 }, keepNext: true });

  function answerArea(q) {
    const r = comRespostas && isAnswered(q.resposta) ? q.resposta.valor : null;
    const val = r?.valor;
    const detalhe = r?.detalhe || '';
    switch (q.tipo) {
      case 'texto_curto': return [box(1, val ?? '')];
      case 'numero': return [box(1, comRespostas && isAnswered(q.resposta) ? formatAnswer(q, q.resposta) : '')];
      case 'data': return [hint('Data (dd/mm/aaaa) e, se quiser, um comentário.'), box(1, comRespostas && isAnswered(q.resposta) ? formatAnswer(q, q.resposta) : '')];
      case 'sim_nao': return [choice('Sim', val === 'sim'), choice('Não', val === 'nao'), hint('Comentário (opcional):'), box(2, detalhe)];
      case 'selecao_unica':
      case 'selecao_multipla': {
        const chosen = new Set(Array.isArray(val) ? val : val ? [val] : []);
        return [hint(q.tipo === 'selecao_unica' ? 'Marque uma opção.' : 'Marque todas as que se aplicam.'),
          ...(q.opcoes || []).map((o) => choice(o, chosen.has(o))), hint('Comentário (opcional):'), box(2, detalhe)];
      }
      case 'observacoes': return [box(3, val ?? '')];
      default: return [box(5, val ?? '')];
    }
  }

  const logo = await logoRun(settings);
  const contato = [settings.email_contato, settings.telefone].filter(Boolean).join(' · ');
  const total = etapas.reduce((n, e) => n + e.perguntas.length, 0);
  const hasRequired = etapas.some((e) => e.perguntas.some((q) => q.obrigatoria));

  const body = [
    logo ? para(logo, { spacing: { after: 240 } }) : para(run(nomeEmpresa, { bold: true, size: 24, color: ink }), { spacing: { after: 240 } }),
    para(run('QUESTIONÁRIO DE DESCOBERTA', { bold: true, size: 18, color: accent, characterSpacing: 40 }), { spacing: { after: 60 } }),
    para(run(projeto || 'Levantamento de requisitos', { bold: true, size: 40, color: ink }), {
      spacing: { after: 160 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: accent, space: 8 } }
    }),
    ...(cliente ? [para([run('Preparado para: ', { size: 21, color: muted }), run([cliente, empresa].filter(Boolean).join(' · '), { size: 21, bold: true })], { spacing: { after: 40 } })] : []),
    para([run('Data: ', { size: 21, color: muted }), run(longDate(data || new Date()), { size: 21 }), ...(codigo ? [run('     Referência: ', { size: 21, color: muted }), run(codigo, { size: 21 })] : [])], { spacing: { after: 240 } }),
    para(run('Como responder', { bold: true, size: 24, color: ink }), { spacing: { before: 120, after: 80 } }),
    para(run(`Estas ${total} perguntas nos ajudam a entender a sua ideia, como o trabalho é feito hoje e o que você espera do sistema. Responda com as suas palavras: não existem respostas certas ou erradas, e exemplos do dia a dia ajudam muito.`, { size: 21 })),
    para(run('Escreva dentro dos quadros (eles crescem conforme o texto). Nas alternativas, clique na caixa para marcar. Se não souber ou não quiser responder alguma pergunta, deixe em branco — conversamos sobre ela na reunião.', { size: 21 })),
    ...(hasRequired ? [para([run('Perguntas marcadas com ', { size: 21 }), run('*', { size: 21, bold: true, color: accent }), run(' são as mais importantes para começarmos.', { size: 21 })])] : []),
    para(run(`Ao terminar, salve o arquivo e envie de volta${settings.email_contato ? ` para ${settings.email_contato}` : ''}.`, { size: 21 }), { spacing: { after: 200 } })
  ];

  etapas.forEach((e, ei) => {
    body.push(new Paragraph({
      keepNext: true,
      spacing: { before: 360, after: 160 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ink, space: 4 } },
      children: [run(`${ei + 1}`, { bold: true, size: 26, color: accent }), run(`   ${e.titulo}`, { bold: true, size: 26, color: ink })]
    }));
    e.perguntas.forEach((q, qi) => {
      body.push(new Paragraph({
        keepNext: true, keepLines: true,
        spacing: { before: 200, after: 100 },
        indent: { left: 567, hanging: 567 },
        tabStops: [{ type: TabStopType.LEFT, position: 567 }],
        children: [run(`${ei + 1}.${qi + 1}`, { bold: true, size: 19, color: line }), run(`\t${q.enunciado}`, { bold: true, size: 22, color: ink }),
          ...(q.obrigatoria ? [run(' *', { bold: true, size: 22, color: accent })] : [])]
      }));
      body.push(...answerArea(q));
    });
  });

  body.push(
    new Paragraph({ keepNext: true, spacing: { before: 480, after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ink, space: 4 } },
      children: [run('Algo mais?', { bold: true, size: 26, color: ink })] }),
    para(run('Use este espaço para qualquer coisa que não coube nas perguntas: ideias, preocupações, exemplos ou links.', { size: 21 })),
    box(6),
    para(run(`Obrigado pelo seu tempo! ${nomeEmpresa}${contato ? ` · ${contato}` : ''}`, { size: 19, color: muted }), { spacing: { before: 360 } })
  );

  const headerLine = new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: rule, space: 4 } },
    children: [run(nomeEmpresa, { size: 16, color: muted }), run('\tQuestionário de descoberta', { size: 16, color: muted })]
  });
  const footLeft = [cliente, projeto].filter(Boolean).join(' — ');
  const footerLine = new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
    children: [run(footLeft, { size: 16, color: muted }), run('\tPágina ', { size: 16, color: muted }),
      new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: muted }), run(' de ', { size: 16, color: muted }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: muted })]
  });

  const doc = new Document({
    creator: nomeEmpresa,
    title: `Questionário de descoberta${projeto ? ` — ${projeto}` : ''}`,
    description: 'Questionário de levantamento de requisitos',
    styles: { default: { document: { run: { font: FONT, size: 21, color: '1F2933' } } } },
    sections: [{
      properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, header: 567, footer: 567 } } },
      headers: { default: new Header({ children: [headerLine] }) },
      footers: { default: new Footer({ children: [footerLine] }) },
      children: body
    }]
  });
  return Packer.toBuffer(doc);
}
