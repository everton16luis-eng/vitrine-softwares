import { get, put } from '../../shared/api.js';
import { el, icon, badge, buildForm, formModal, datetime, toast, toastError } from '../../shared/ui.js';
import { pageHeader } from './_crud.js';

const FIELDS = [
  { type: 'section', label: 'Identidade' },
  { name: 'nome_comercial', label: 'Nome comercial', required: true, col: 6 },
  { name: 'slogan', label: 'Slogan', col: 6 },
  { name: 'logo_url', label: 'URL do logotipo', col: 6, help: 'Envie na Biblioteca de mídia e cole o endereço (/uploads/...).' },
  { name: 'favicon_url', label: 'URL do favicon', col: 6 },
  { name: 'cor_primaria', label: 'Cor base (escura)', type: 'color', col: 3 },
  { name: 'cor_destaque', label: 'Cor de destaque', type: 'color', col: 3 },
  { name: 'cor_secundaria', label: 'Cor secundária (gradientes)', type: 'color', col: 3 },
  { name: 'moeda_padrao', label: 'Moeda padrão', type: 'select', required: true, options: [['BRL', 'BRL'], ['USD', 'USD'], ['EUR', 'EUR']], col: 3 },
  { type: 'section', label: 'Contato e redes sociais', help: 'Não use dados fictícios em produção. Campos vazios não são exibidos no site.' },
  { name: 'email_contato', label: 'E-mail de contato', type: 'email', col: 6 },
  { name: 'telefone', label: 'Telefone', col: 6 },
  { name: 'whatsapp', label: 'WhatsApp (somente dígitos com DDI)', col: 6, placeholder: '5500000000000' },
  { name: 'whatsapp_mensagem', label: 'Mensagem inicial do WhatsApp', col: 6 },
  { name: 'endereco', label: 'Endereço', col: 12 },
  { name: 'instagram', label: 'Instagram (URL)', type: 'url', col: 6 }, { name: 'linkedin', label: 'LinkedIn (URL)', type: 'url', col: 6 },
  { name: 'github', label: 'GitHub (URL)', type: 'url', col: 6 }, { name: 'youtube', label: 'YouTube (URL)', type: 'url', col: 6 },
  { type: 'section', label: 'Informações comerciais (orçamentos)' },
  { name: 'razao_social', label: 'Razão social / nome do fornecedor', col: 6 },
  { name: 'documento_empresa', label: 'CNPJ/CPF do fornecedor', col: 6 },
  { name: 'validade_orcamento_dias', label: 'Validade padrão dos orçamentos (dias)', type: 'number', col: 6 },
  { name: 'condicoes_orcamento_padrao', label: 'Condições comerciais padrão', type: 'textarea', rows: 3 },
  { type: 'section', label: 'SEO padrão' },
  { name: 'seo_titulo_padrao', label: 'Título padrão', required: true, col: 12 },
  { name: 'seo_descricao_padrao', label: 'Descrição padrão', type: 'textarea', required: true, rows: 2 },
  { type: 'section', label: 'Avisos e notificações' },
  { name: 'aviso_site_ativo', label: 'Exibir aviso no topo do site', type: 'checkbox', col: 4 },
  { name: 'aviso_site', label: 'Texto do aviso', col: 8 },
  { name: 'notificar_email_novos_contatos', label: 'Enviar e-mail à equipe a cada novo contato', type: 'checkbox', col: 6 },
  { name: 'email_notificacoes', label: 'E-mail que recebe notificações', type: 'email', col: 6 },
  { name: 'rastrear_visualizacoes', label: 'Contar visualizações de produtos (agregado por dia, sem cookies)', type: 'checkbox' }
];

export async function render(c, ctx) {
  const canEdit = ctx.can('configuracoes.editar');
  const data = await get('/api/admin/configuracoes');
  const integ = data.integracoes;
  c.append(pageHeader('Configurações', 'Segredos de integrações (SMTP, gateways) ficam apenas nas variáveis de ambiente do servidor.'));

  c.append(el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' }, el('h2', { class: 'h6' }, 'Integrações'),
    el('ul', { class: 'list-unstyled mb-0 small' },
      el('li', {}, icon('envelope'), ' E-mail: ', integ.email.configurado ? badge('Configurado (SMTP)', 'success') : badge('Não configurado — e-mails não são enviados', 'warning')),
      el('li', { class: 'mt-1' }, icon('credit-card'), ' Mercado Pago: ', integ.pagamentos.mercadopago.configurado ? badge('Credenciais presentes', 'info') : badge('Não configurado', 'secondary')),
      el('li', { class: 'mt-1' }, icon('credit-card'), ' Stripe: ', integ.pagamentos.stripe.configurado ? badge('Credenciais presentes', 'info') : badge('Não configurado', 'secondary')),
      el('li', { class: 'mt-1' }, icon('hdd'), ` Armazenamento de arquivos: ${integ.armazenamento.driver}`)),
    el('p', { class: 'small text-body-secondary mt-2 mb-0' }, 'Pagamentos online não são processados nesta versão: veja docs/PAGAMENTOS.md para a integração futura.'))));

  const form = buildForm(FIELDS.map((f) => ({ ...f, readonly: !canEdit })), data.valores, ctx);
  c.append(el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' }, form.node)));
  if (canEdit) {
    const save = el('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      if (!form.validate()) return;
      save.disabled = true;
      try { await put('/api/admin/configuracoes', form.values()); toast('Configurações salvas. O site é atualizado em até 30 segundos.'); } catch (err) { form.showErrors(err.fields || {}, err.message); } finally { save.disabled = false; }
    } }, icon('check2'), ' Salvar configurações');
    c.append(el('div', { class: 'sticky-save' }, save));
  }

  // Modelos de e-mail
  const emails = await get('/api/admin/modelos-email');
  c.append(el('div', { class: 'card mt-4' }, el('div', { class: 'card-body' }, el('h2', { class: 'h6' }, 'Modelos de e-mail'),
    el('div', { class: 'list-group mb-3' }, emails.modelos.map((m) => el('button', { type: 'button', class: 'list-group-item list-group-item-action d-flex justify-content-between', onclick: () => formModal({
      title: m.nome,
      fields: [
        { type: 'section', label: 'Variáveis disponíveis', help: m.variaveis.map((v) => `{{${v}}}`).join('  ') },
        { name: 'assunto', label: 'Assunto', required: true, readonly: !canEdit },
        { name: 'corpo', label: 'Mensagem (texto simples)', type: 'textarea', rows: 10, required: true, readonly: !canEdit },
        { name: 'ativo', label: 'Modelo ativo', type: 'checkbox', readonly: !canEdit }
      ],
      values: m,
      onSubmit: async (v) => { if (!canEdit) return; await put(`/api/admin/modelos-email/${m.chave}`, v); toast('Modelo atualizado.'); }
    }) }, el('span', {}, m.nome), m.ativo ? badge('Ativo', 'success') : badge('Inativo', 'secondary')))),
    el('h3', { class: 'h6' }, 'Últimos envios'),
    emails.registro.length ? el('div', { class: 'table-responsive', tabindex: '0', role: 'region', 'aria-label': 'Registro de e-mails' }, el('table', { class: 'table table-sm small' },
      el('thead', {}, el('tr', {}, ['Data', 'Modelo', 'Destinatário', 'Situação'].map((h) => el('th', {}, h)))),
      el('tbody', {}, emails.registro.map((r) => el('tr', {}, el('td', {}, datetime(r.criado_em)), el('td', {}, r.modelo || '—'), el('td', {}, r.destinatario),
        el('td', {}, badge({ enviado: 'Enviado', nao_configurado: 'Não enviado (sem provedor)', falhou: 'Falhou' }[r.status], r.status === 'enviado' ? 'success' : r.status === 'falhou' ? 'danger' : 'warning')))))))
      : el('p', { class: 'small text-body-secondary' }, 'Nenhum envio registrado.'))));
}

export { toastError };
