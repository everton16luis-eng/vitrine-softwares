// Clientes e parceiros exibidos na página inicial. A logomarca enviada é padronizada no
// servidor (mesmas dimensões, versão monocromática e colorida); o original fica guardado.
import { api, post, download } from '../../shared/api.js';
import { el, icon, badge, withBusy, confirmDialog, datetime, toast } from '../../shared/ui.js';
import { crudPage } from './_crud.js';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg';

/** Miniatura sobre fundo escuro, como no site. */
const logoThumb = (row, size = 'sm') => (row.logo_mono_url
  ? el('span', { class: `partner-thumb partner-thumb-${size}` }, el('img', { src: row.logo_mono_url, alt: `Logomarca de ${row.nome}`, width: 480, height: 240, loading: 'lazy' }))
  : el('span', { class: `partner-thumb partner-thumb-${size} partner-thumb-empty` }, icon('image'), ' Sem logo'));

function statusCell(row) {
  const box = el('div', { class: 'd-flex flex-wrap gap-1' });
  box.append(row.ativo ? badge('Ativo', 'success') : badge('Inativo', 'secondary'));
  box.append(row.divulgacao_autorizada ? badge('Divulgação autorizada', 'info') : badge('Sem autorização', 'warning'));
  if (row.publico) box.append(badge('No site', 'primary'));
  return box;
}

function previewNode(row) {
  if (!row?.logo_mono_url) return null;
  const info = row.logo_info || {};
  const dims = row.logo_original_largura ? `${row.logo_original_largura}×${row.logo_original_altura} px` : '';
  return el('div', { class: 'partner-preview' },
    el('div', { class: 'partner-preview-pair' },
      el('figure', {}, logoThumb(row, 'lg'), el('figcaption', {}, 'Monocromática (padrão)')),
      el('figure', {}, el('span', { class: `partner-thumb partner-thumb-lg partner-thumb-${info.fundo_colorida === 'escuro' ? 'dark' : 'light'}` },
        el('img', { src: row.logo_cor_url, alt: `Logomarca colorida de ${row.nome}`, width: 480, height: 240 })), el('figcaption', {}, 'Colorida (ao passar o mouse)'))),
    el('p', { class: 'form-text mb-2' }, [row.logo_original_nome, dims, info.fundo === 'removido' ? 'fundo removido automaticamente' : null,
      row.logo_processada_em ? `processada em ${datetime(row.logo_processada_em)}` : null].filter(Boolean).join(' · ')));
}

export async function render(container, ctx) {
  const canEdit = ctx.can('parceiros.editar');
  let page;

  const reprocessAll = el('button', { class: 'btn btn-sm btn-outline-secondary', type: 'button', onclick: async (e) => {
    const ok = await confirmDialog({ title: 'Reprocessar logomarcas', message: 'Gerar novamente as versões exibidas no site a partir dos arquivos originais de todas as marcas?', confirmLabel: 'Reprocessar', danger: false });
    if (!ok) return;
    const r = await withBusy(e.currentTarget, () => post('/api/admin/parceiros/reprocessar'));
    if (r) { toast(r.falhas.length ? `${r.processados} de ${r.total} reprocessadas; ${r.falhas.length} com falha.` : `${r.processados} logomarca(s) reprocessada(s).`, r.falhas.length ? 'warning' : 'success'); page.table.refresh(); }
  } }, icon('arrow-repeat'), ' Reprocessar todas');

  const intro = el('div', { class: 'alert alert-light border d-flex flex-wrap gap-3 align-items-center justify-content-between' },
    el('div', {},
      el('strong', {}, 'Seção "Empresas que confiam em nossas soluções". '),
      'Aparecem no site apenas os cadastros ativos, com divulgação autorizada e logomarca enviada. ',
      'Envie a logo em PNG, JPG, WebP ou SVG, em qualquer formato (horizontal, quadrada ou vertical): ela é centralizada e padronizada automaticamente, sem cortes nem distorções.'),
    canEdit ? reprocessAll : null);

  page = await crudPage(container, ctx, {
    title: 'Clientes e parceiros',
    description: 'Marcas exibidas na página inicial.',
    endpoint: '/api/admin/parceiros',
    editPerm: 'parceiros.editar',
    singular: 'cliente/parceiro',
    newLabel: 'Nova empresa',
    loadOne: true,
    extraTop: intro,
    empty: 'Nenhuma empresa cadastrada.',
    defaults: { ativo: true, divulgacao_autorizada: false, ordem: 0 },
    filters: [{ name: 'ativo', label: 'Todas as situações', options: [['true', 'Ativas'], ['false', 'Inativas']] }],
    columns: [
      { label: 'Logo', render: (r) => logoThumb(r) },
      { label: 'Empresa', render: (r) => el('div', {}, el('strong', {}, r.nome), r.site_url ? el('div', { class: 'small text-body-secondary text-truncate' }, r.site_url) : null) },
      { label: 'Exibição', render: statusCell },
      { label: 'Ordem', key: 'ordem', class: 'text-end' }
    ],
    rowActions: (row, { refresh }) => [
      row.tem_original ? el('button', { class: 'btn btn-outline-secondary', type: 'button', title: 'Baixar arquivo original', 'aria-label': 'Baixar arquivo original',
        onclick: (e) => withBusy(e.currentTarget, () => download(`/api/admin/parceiros/${row.id}/logo/original`, row.logo_original_nome || 'logo')) }, icon('download')) : null,
      row.tem_original ? el('button', { class: 'btn btn-outline-secondary', type: 'button', title: 'Reprocessar logomarca', 'aria-label': 'Reprocessar logomarca',
        onclick: async (e) => { if (await withBusy(e.currentTarget, () => post(`/api/admin/parceiros/${row.id}/logo/reprocessar`), 'Logomarca reprocessada.')) refresh(); } }, icon('arrow-repeat')) : null
    ].filter(Boolean),
    deleteMessage: (row) => `Excluir "${row.nome}"? A empresa sai do site e a logomarca (original e versões processadas) é apagada. Esta ação não pode ser desfeita.`,
    fields: (_c, v) => [
      { name: 'nome', label: 'Nome da empresa', required: true, max: 150, col: 8 },
      { name: 'ordem', label: 'Ordem de exibição', type: 'number', min: 0, col: 4, help: 'Menor aparece primeiro.' },
      { name: 'site_url', label: 'Site da empresa (opcional)', type: 'url', max: 500, placeholder: 'https://', help: 'Se informado, a logomarca vira um link.' },
      { name: 'arquivo', label: v.id ? 'Substituir logomarca' : 'Logomarca', type: 'file', accept: ACCEPT, preview: previewNode(v),
        help: v.logo_mono_url ? 'Deixe em branco para manter a logomarca atual.' : 'PNG (com ou sem transparência), JPG, WebP ou SVG. Fundos sólidos são removidos automaticamente.' },
      { name: 'ativo', label: 'Ativo', type: 'checkbox', col: 6 },
      { name: 'divulgacao_autorizada', label: 'Empresa autorizou a divulgação da marca', type: 'checkbox', col: 6 },
      { name: 'observacoes', label: 'Observações internas', type: 'textarea', rows: 2, max: 2000, help: 'Ex.: quem autorizou e quando. Não aparece no site.' }
    ],
    prepare: ({ arquivo, ...data }) => ({ ...data, ordem: data.ordem ?? 0 }),
    afterSave: async (saved, values) => {
      if (!values.arquivo) return;
      const fd = new FormData();
      fd.append('arquivo', values.arquivo);
      await api(`/api/admin/parceiros/${saved.id}/logo`, { method: 'POST', form: fd });
    }
  });
}
