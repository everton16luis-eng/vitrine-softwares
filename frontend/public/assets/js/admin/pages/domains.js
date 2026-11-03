// Domínios das implantações: apontamento DNS, certificado SSL e renovação.
import { get, post } from '../../shared/api.js';
import { el, icon, badge, date, datetime, dataTable, infoModal, toast, debounce, withBusy } from '../../shared/ui.js';
import { pageHeader, entries } from './_crud.js';
import { reference } from './deployments.js';

const DNS_TONE = { nao_verificado: 'secondary', ok: 'success', divergente: 'warning', sem_registro: 'warning', erro: 'danger' };
const SSL_TONE = { pendente: 'secondary', emitido: 'success', erro: 'danger', expirando: 'warning', expirado: 'danger' };

export async function render(c, ctx) {
  const ref = await reference();
  const state = { busca: '', status_dns: '' };
  const table = dataTable({
    caption: 'Domínios',
    columns: [
      { label: 'Domínio', render: (r) => el('a', { href: `https://${r.nome}`, target: '_blank', rel: 'noopener' }, r.nome) },
      { label: 'Cliente', key: 'cliente_nome' },
      { label: 'Implantação', render: (r) => el('a', { href: `#/implantacoes/${r.implantacao_id}` }, r.codigo) },
      { label: 'DNS', render: (r) => el('div', {}, badge(ref.dns[r.status_dns], DNS_TONE[r.status_dns]), r.ipv4?.length ? el('div', { class: 'small text-body-secondary' }, r.ipv4.join(', ')) : null) },
      { label: 'SSL', render: (r) => badge(ref.ssl[r.status_ssl], SSL_TONE[r.status_ssl]) },
      { label: 'Expira em', render: (r) => (r.ssl_expira_em ? date(r.ssl_expira_em) : '—') },
      { label: 'Renovação', render: (r) => (r.renovacao_automatica === null || r.renovacao_automatica === undefined ? '—' : r.renovacao_automatica ? 'Automática' : badge('Não configurada', 'warning')) },
      { label: 'Verificado', render: (r) => el('span', { class: 'small' }, datetime(r.dns_verificado_em)) },
      { label: '', class: 'text-end', render: (r) => el('div', { class: 'btn-group btn-group-sm' },
        el('button', { class: 'btn btn-outline-secondary', type: 'button', title: 'Verificar DNS agora', 'aria-label': `Verificar DNS de ${r.nome}`, onclick: async (e) => {
          const x = await withBusy(e.currentTarget, () => post(`/api/admin/dominios/${r.id}/verificar`));
          if (x) { toast(x.mensagem, x.status_dns === 'ok' ? 'success' : 'warning'); table.refresh(); }
        } }, icon('broadcast')),
        el('button', { class: 'btn btn-outline-secondary', type: 'button', title: 'Instruções de DNS para o cliente', 'aria-label': `Instruções de DNS para ${r.nome}`, onclick: () => instructions(r) }, icon('signpost-split'))) }
    ],
    load: (page) => get(`/api/admin/dominios?${new URLSearchParams({ pagina: page, ...Object.fromEntries(Object.entries(state).filter(([, v]) => v)) })}`),
    empty: 'Nenhum domínio cadastrado. Os domínios são informados em cada implantação.'
  });
  c.append(pageHeader('Domínios', 'Apontamento DNS, certificados SSL e renovação. O DNS das implantações em espera é rechecado automaticamente a cada 5 minutos pelo agente.'),
    el('div', { class: 'card' }, el('div', { class: 'card-body' },
      el('div', { class: 'toolbar' },
        el('input', { type: 'search', class: 'form-control', placeholder: 'Domínio ou cliente', 'aria-label': 'Pesquisar domínios', oninput: debounce((e) => { state.busca = e.target.value; table.refresh(1); }) }),
        el('select', { class: 'form-select', 'aria-label': 'Situação do DNS', onchange: (e) => { state.status_dns = e.target.value; table.refresh(1); } },
          el('option', { value: '' }, 'Todas as situações de DNS'), entries(ref.dns).map(([k, l]) => el('option', { value: k }, l)))),
      table.node)));
  table.refresh();
}

async function instructions(r) {
  const { instrucoes } = await get(`/api/admin/dominios/${r.id}/instrucoes`);
  infoModal({
    title: `DNS de ${r.nome}`,
    body: el('div', {},
      el('p', { class: 'small text-body-secondary' }, 'Envie estas instruções ao responsável pelo domínio do cliente.'),
      el('pre', { class: 'small bg-body-tertiary p-3 rounded pre-line' }, instrucoes),
      el('button', { class: 'btn btn-sm btn-outline-secondary', type: 'button', onclick: () => navigator.clipboard?.writeText(instrucoes).then(() => toast('Instruções copiadas.')) }, icon('clipboard'), ' Copiar'))
  });
}
