// Central de Implantação: lista, criação e acompanhamento de cada instalação.
// O painel apenas enfileira tarefas; quem executa é o agente (npm run agente).
import { get, post, put } from '../../shared/api.js';
import { el, icon, badge, date, datetime, dataTable, formModal, infoModal, confirmDialog, toast, toastError, debounce, withBusy, loading } from '../../shared/ui.js';
import { pageHeader, entries } from './_crud.js';

export const STATUS_TONE = {
  em_preparacao: 'secondary', aguardando_cliente: 'warning', pronta_para_instalar: 'info', em_execucao: 'primary', aguardando_tecnico: 'warning',
  falhou: 'danger', em_validacao: 'info', pronta_para_entrega: 'success', entregue: 'success', cancelada: 'dark'
};
const ETAPA_TONE = { pendente: 'light', em_andamento: 'primary', aguardando_cliente: 'warning', aguardando_tecnico: 'warning', concluida: 'success', falhou: 'danger' };
const PASSO_ICON = { pendente: 'circle', executando: 'arrow-repeat', concluido: 'check-circle-fill', falhou: 'x-circle-fill', ignorado: 'dash-circle', aguardando: 'hourglass-split' };
const PASSO_TONE = { pendente: 'text-body-secondary', executando: 'text-primary', concluido: 'text-success', falhou: 'text-danger', ignorado: 'text-body-secondary', aguardando: 'text-warning' };
const TASK_TONE = { pendente: 'secondary', executando: 'primary', concluida: 'success', falhou: 'danger', aguardando: 'warning', cancelada: 'dark' };
const DNS_TONE = { nao_verificado: 'secondary', ok: 'success', divergente: 'warning', sem_registro: 'warning', erro: 'danger' };
const SSL_TONE = { pendente: 'secondary', emitido: 'success', erro: 'danger', expirando: 'warning', expirado: 'danger' };
/** Passos cuja reexecução pode afetar dados: o servidor exige administrador. */
const SENSITIVE = new Set(['criar_banco', 'migracoes', 'seed']);

let refCache = null;
export const reference = async () => (refCache ||= await get('/api/admin/implantacoes-referencia'));

// A CSP do painel proíbe o atributo style; larguras dinâmicas vão pelo CSSOM.
function progressBar(value, tone = 'success') {
  const bar = el('div', { class: `progress-bar bg-${tone}` });
  bar.style.width = `${value}%`;
  return el('div', { class: 'progress deploy-progress', role: 'progressbar', 'aria-label': 'Progresso', 'aria-valuenow': value, 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar);
}
function colorChip(color) {
  const chip = el('span', { class: 'color-chip' });
  chip.style.background = color;
  return chip;
}

function agentAlert(agente) {
  if (agente?.online) {
    return agente.executor === 'simulado'
      ? el('div', { class: 'alert alert-info small py-2' }, icon('info-circle'), ' Agente em ', el('strong', {}, 'modo simulado'), ': o fluxo é percorrido sem alterar o servidor.')
      : null;
  }
  return el('div', { class: 'alert alert-warning small py-2', role: 'status' }, icon('exclamation-triangle'),
    ' O agente de implantação não está em execução', agente?.visto_em ? ` (último sinal: ${datetime(agente.visto_em)})` : '',
    '. As tarefas ficam na fila até ele ser iniciado no servidor (', el('code', {}, 'npm run agente'), ').');
}

export async function render(c, ctx, params) {
  const ref = await reference();
  if (params[0]) return detail(c, ctx, Number(params[0]), ref);
  const state = { busca: '', status: '' };
  const table = dataTable({
    caption: 'Implantações',
    columns: [
      { label: 'Código', class: 'text-nowrap', key: 'codigo' },
      { label: 'Cliente', key: 'cliente_nome' },
      { label: 'Software', key: 'produto_nome' },
      { label: 'Domínio', render: (r) => r.dominio || el('span', { class: 'text-body-secondary' }, 'a definir') },
      { label: 'Contratação', render: (r) => date(r.contratada_em) },
      { label: 'Situação', render: (r) => badge(ref.status[r.status], STATUS_TONE[r.status]) },
      { label: 'Etapa', render: (r) => el('span', { class: 'small' }, `${r.etapa_atual}. ${ref.etapas[r.etapa_atual]}`) },
      { label: 'Progresso', render: (r) => el('div', { class: 'd-flex align-items-center gap-2' }, progressBar(r.progresso, r.status === 'falhou' ? 'danger' : 'success'), el('span', { class: 'small' }, `${r.progresso}%`)) },
      { label: 'Atualização', render: (r) => el('span', { class: 'small' }, datetime(r.atualizado_em)) },
      { label: 'Responsável', render: (r) => r.responsavel_nome || '—' }
    ],
    load: (page) => get(`/api/admin/implantacoes?${new URLSearchParams({ pagina: page, ...Object.fromEntries(Object.entries(state).filter(([, v]) => v)) })}`),
    onRowClick: (r) => ctx.navigate(`implantacoes/${r.id}`),
    empty: 'Nenhuma implantação registrada.'
  });
  const agentBox = el('div');
  get('/api/admin/implantacoes/agente').then((a) => { const n = agentAlert(a); if (n) agentBox.append(n); }).catch(() => {});
  c.append(
    pageHeader('Implantações', 'Instalação, configuração e entrega de cada sistema contratado, em ambiente isolado por cliente.',
      ctx.can('implantacoes.editar') ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => createForm(ctx) }, icon('plus-lg'), ' Nova implantação') : null),
    agentBox,
    el('div', { class: 'card' }, el('div', { class: 'card-body' },
      el('div', { class: 'toolbar' },
        el('input', { type: 'search', class: 'form-control', placeholder: 'Código, cliente ou domínio', 'aria-label': 'Pesquisar implantações', oninput: debounce((e) => { state.busca = e.target.value; table.refresh(1); }) }),
        el('select', { class: 'form-select', 'aria-label': 'Situação', onchange: (e) => { state.status = e.target.value; table.refresh(1); } },
          el('option', { value: '' }, 'Todas as situações'), entries(ref.status).map(([k, l]) => el('option', { value: k }, l)))),
      table.node)));
  table.refresh();
}

async function createForm(ctx) {
  const o = await ctx.opcoes();
  const receitas = (o.receitas || []).filter((r) => r.ativa);
  if (!receitas.length) {
    toast('Cadastre antes uma receita de implantação para o software (menu Implantação › Receitas).', 'warning');
    return;
  }
  formModal({
    title: 'Nova implantação',
    submitLabel: 'Criar implantação',
    fields: [
      { type: 'section', label: 'Contratação', help: 'Os recursos do servidor (usuário, diretório, banco, porta e serviço) são exclusivos desta implantação e derivados do identificador.' },
      { name: 'cliente_id', label: 'Cliente', type: 'select', numeric: true, required: true, col: 6, options: () => (o.clientes || []).map((x) => [x.id, `${x.nome}${x.empresa ? ` — ${x.empresa}` : ''}`]) },
      { name: 'receita_id', label: 'Software e receita de instalação', type: 'select', numeric: true, required: true, col: 6, options: () => receitas.map((r) => [r.id, `${r.produto_nome} — ${r.nome}${r.versao_app ? ` (v${r.versao_app})` : ''}`]) },
      { name: 'dominio', label: 'Domínio do cliente', col: 6, placeholder: 'sistema.empresa.com.br', help: 'Pode ser informado depois. Sem http:// e sem barras.' },
      { name: 'responsavel_id', label: 'Responsável técnico', type: 'select', numeric: true, col: 6, options: () => (o.equipe || []).map((u) => [u.id, u.nome]) },
      { name: 'contratada_em', label: 'Data da contratação', type: 'date', col: 6 },
      { name: 'slug', label: 'Identificador (opcional)', col: 6, help: 'Letras minúsculas, números e hífen. Gerado automaticamente se vazio.' },
      { name: 'observacoes', label: 'Observações internas', type: 'textarea', rows: 2 },
      { name: 'adicional', label: 'Instalação adicional para o mesmo cliente e software (confirmo que não é duplicidade)', type: 'checkbox' }
    ],
    values: { cliente_id: Number(ctx.query.get('cliente')) || null, contratada_em: new Date().toISOString().slice(0, 10) },
    onSubmit: async (v) => {
      const receita = receitas.find((r) => r.id === v.receita_id);
      const r = await post('/api/admin/implantacoes', { ...v, produto_id: receita?.produto_id });
      toast(`Implantação ${r.codigo} criada.`);
      ctx.navigate(`implantacoes/${r.id}`);
    }
  });
}

// ------------------------------------------------------------------ detalhe
async function detail(c, ctx, id, ref) {
  const box = el('div');
  c.append(el('a', { href: '#/implantacoes', class: 'back-link' }, icon('arrow-left'), ' Implantações'), box);
  let d = await get(`/api/admin/implantacoes/${id}`);
  let timer = null;
  const canExec = ctx.can('implantacoes.executar');
  const canEdit = ctx.can('implantacoes.editar');

  // Atualização automática enquanto houver tarefa na fila ou em execução.
  function schedule() {
    clearTimeout(timer);
    if (!d.tarefa_ativa) return;
    timer = setTimeout(async () => {
      if (!box.isConnected) return;
      try { d = await get(`/api/admin/implantacoes/${id}`); draw(); } catch { schedule(); }
    }, 3000);
  }
  const reload = async () => { d = await get(`/api/admin/implantacoes/${id}`); draw(); };

  async function enqueue(tipo, passo, button) {
    const r = await withBusy(button, () => post(`/api/admin/implantacoes/${id}/tarefas`, { tipo, passo }));
    if (!r) return;
    toast(d.agente?.online ? 'Tarefa enviada ao agente.' : 'Tarefa na fila. O agente ainda não está em execução.', d.agente?.online ? 'success' : 'warning');
    await reload();
  }

  function draw() {
    box.textContent = '';
    const a = d.acoes;
    const actions = [];
    if (canExec && a.iniciar) actions.push(el('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => enqueue('instalar', null, e.currentTarget) }, icon('play-fill'), ' Iniciar instalação'));
    if (canExec && a.continuar) actions.push(el('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => enqueue('instalar', null, e.currentTarget) }, icon('skip-forward-fill'), ' Continuar'));
    if (canExec && a.testar) actions.push(el('button', { class: 'btn btn-outline-primary', type: 'button', onclick: (e) => enqueue('testar', null, e.currentTarget) }, icon('clipboard-check'), ' Executar testes'));
    actions.push(el('button', { class: 'btn btn-outline-secondary', type: 'button', onclick: () => logsModal(id, d) }, icon('terminal'), ' Ver logs'));
    if (canExec && a.entregar) actions.push(el('button', { class: 'btn btn-success', type: 'button', onclick: () => deliverForm() }, icon('send-check'), ' Finalizar entrega'));
    if (d.resumo_entrega) actions.push(el('a', { class: 'btn btn-outline-success', href: `/api/admin/implantacoes/${id}/resumo`, target: '_blank', rel: 'noopener' }, icon('printer'), ' Resumo de entrega'));

    box.append(pageHeader(`Implantação ${d.codigo}`, `${d.cliente_nome}${d.cliente_empresa ? ` (${d.cliente_empresa})` : ''} · ${d.produto_nome}${d.receita.versao_app ? ` v${d.receita.versao_app}` : ''}`, ...actions));
    const agent = agentAlert(d.agente);
    if (agent) box.append(agent);
    box.append(el('div', { class: 'd-flex flex-wrap align-items-center gap-3 mb-3' },
      badge(d.status_rotulo, STATUS_TONE[d.status]),
      el('div', { class: 'd-flex align-items-center gap-2 flex-grow-1 deploy-progress-wide' }, progressBar(d.progresso, d.status === 'falhou' ? 'danger' : 'success'), el('strong', { class: 'small' }, `${d.progresso}%`)),
      d.tarefa_ativa ? el('span', { class: 'small text-primary' }, el('span', { class: 'spinner-border spinner-border-sm me-1', 'aria-hidden': 'true' }),
        `${ref.tarefas[d.tarefa_ativa.tipo]} — ${d.tarefa_ativa.status === 'pendente' ? 'na fila' : 'em execução'} (tarefa #${d.tarefa_ativa.id})`) : null,
      el('span', { class: 'small text-body-secondary' }, `Atualizado em ${datetime(d.atualizado_em)}`)));

    box.append(el('div', { class: 'row g-3' },
      el('div', { class: 'col-xl-8' }, timelineCard(), stepsCard()),
      el('div', { class: 'col-xl-4' }, clientCard(), domainCard(), checksCard(), resourcesCard(), tasksCard(), manageCard())));
    schedule();
  }

  function timelineCard() {
    return el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' },
      el('h2', { class: 'h6' }, 'Fluxo de implantação'),
      el('ol', { class: 'deploy-flow' }, d.etapas.map((e) => el('li', { class: `is-${e.status}${e.etapa === d.etapa_atual ? ' is-current' : ''}` },
        el('span', { class: 'deploy-flow-dot', 'aria-hidden': 'true' }, e.status === 'concluida' ? icon('check-lg') : e.status === 'falhou' ? icon('x-lg') : String(e.etapa)),
        el('div', {},
          el('div', { class: 'fw-semibold' }, e.rotulo),
          badge(ref.etapa_status[e.status], ETAPA_TONE[e.status]),
          e.detalhe ? el('div', { class: 'small text-body-secondary pre-line mt-1' }, e.detalhe) : null))))));
  }

  function stepsCard() {
    const groups = [3, 4, 5, 6].map((n) => ({ n, passos: d.passos.filter((p) => p.etapa === n) })).filter((g) => g.passos.length);
    return el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' },
      el('h2', { class: 'h6' }, 'Passos técnicos'),
      el('p', { class: 'small text-body-secondary' }, 'Cada passo é uma operação pré-aprovada e repetível. Em caso de falha, corrija a causa e reexecute somente o passo afetado; a instalação continua do ponto em que parou.'),
      groups.map((g) => el('div', { class: 'mb-3' },
        el('h3', { class: 'deploy-group-title' }, `${g.n}. ${ref.etapas[g.n]}`),
        el('ul', { class: 'list-unstyled mb-0 deploy-steps' }, g.passos.map((p) => el('li', { class: 'd-flex gap-2 align-items-start py-1 border-bottom' },
          el('span', { class: PASSO_TONE[p.status], title: p.status }, icon(PASSO_ICON[p.status], p.status === 'executando' ? 'spin' : '')),
          el('div', { class: 'flex-grow-1' },
            el('div', {}, p.rotulo, p.tentativas > 1 ? el('span', { class: 'small text-body-secondary' }, ` · ${p.tentativas} tentativas`) : null),
            p.concluido_em && p.status === 'concluido' ? el('div', { class: 'small text-body-secondary' }, datetime(p.concluido_em)) : null,
            p.erro ? el('div', { class: `small pre-line ${p.status === 'aguardando' ? 'text-warning-emphasis' : 'text-danger'}` }, p.erro) : null),
          canExec && d.acoes.reexecutar && p.status !== 'pendente' && (!SENSITIVE.has(p.passo) || ctx.user.permissoes.includes('*'))
            ? el('button', { class: 'btn btn-sm btn-outline-secondary', type: 'button', title: 'Reexecutar este passo', 'aria-label': `Reexecutar: ${p.rotulo}`, onclick: (e) => rerun(p, e.currentTarget) }, icon('arrow-clockwise'))
            : null)))))));
  }

  async function rerun(p, button) {
    const msg = SENSITIVE.has(p.passo)
      ? `Reexecutar "${p.rotulo}"? Esta operação atua sobre o banco de dados da instalação. Um backup é feito antes das migrations.`
      : `Reexecutar "${p.rotulo}"? Os passos seguintes que já tinham sido concluídos são mantidos.`;
    if (!(await confirmDialog({ title: 'Reexecutar etapa', message: msg, confirmLabel: 'Reexecutar', danger: SENSITIVE.has(p.passo) }))) return;
    enqueue('reexecutar', p.passo, button);
  }

  function clientCard() {
    return el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' },
      el('div', { class: 'd-flex justify-content-between align-items-center mb-2' }, el('h2', { class: 'h6 mb-0' }, 'Informações do cliente'),
        canEdit && !['entregue', 'cancelada'].includes(d.status) ? el('button', { class: 'btn btn-sm btn-outline-primary', type: 'button', onclick: clientForm }, icon('pencil'), ' Atualizar') : null),
      d.pendencias.length
        ? el('div', { class: 'alert alert-warning small py-2' }, el('strong', {}, 'Pendências: '), d.pendencias.map((p) => p.rotulo).join(', '), '.')
        : el('p', { class: 'small text-success' }, icon('check-circle'), ' Todas as informações obrigatórias foram registradas.'),
      d.campos.length ? el('dl', { class: 'small mb-0 deploy-fields' }, d.campos.map((f) => [
        el('dt', {}, f.rotulo, f.obrigatorio ? el('span', { class: 'text-danger' }, ' *') : null, el('span', { class: 'text-body-secondary fw-normal' }, ` · ${f.responsavel_rotulo}`)),
        el('dd', {}, f.tipo === 'segredo'
          ? (f.definido ? el('span', {}, icon('lock-fill'), ' Definido (armazenado cifrado)') : el('span', { class: 'text-body-secondary' }, 'Não definido'))
          : f.tipo === 'cor' && f.valor ? el('span', {}, colorChip(f.valor), ` ${f.valor}`)
            : f.valor || el('span', { class: 'text-body-secondary' }, '—'))
      ])) : el('p', { class: 'small text-body-secondary mb-0' }, 'A receita não pede informações do cliente.')));
  }

  function clientForm() {
    const canSecret = ctx.can('implantacoes.segredos');
    const typeOf = { texto: 'text', texto_longo: 'textarea', email: 'email', url: 'url', cor: 'text', segredo: 'password' };
    const values = { dominio: d.dominio?.nome || '' };
    d.campos.forEach((f) => { if (f.tipo !== 'segredo') values[f.chave] = f.valor ?? ''; });
    formModal({
      title: 'Atualizar informações do cliente',
      fields: [
        { name: 'dominio', label: 'Domínio', placeholder: 'sistema.empresa.com.br', help: 'Trocar o domínio depois da configuração do Nginx refaz Nginx, DNS, SSL e HTTPS.' },
        ...d.campos.map((f) => ({
          name: f.chave, label: f.rotulo, type: typeOf[f.tipo] || 'text', col: f.tipo === 'texto_longo' ? 12 : 6,
          placeholder: f.tipo === 'cor' ? '#0EA5E9' : f.tipo === 'segredo' && f.definido ? '•••••••• (mantido)' : null,
          readonly: f.tipo === 'segredo' && !canSecret,
          help: f.tipo === 'segredo' ? (canSecret ? 'Armazenado cifrado. Deixe em branco para manter o valor atual.' : 'Requer a permissão "Gerenciar credenciais das implantações".') : f.ajuda || null
        }))
      ],
      values,
      onSubmit: async (v) => {
        const { dominio, ...rest } = v;
        const valores = {};
        for (const f of d.campos) {
          if (!(f.chave in rest)) continue;
          if (f.tipo === 'segredo' && !rest[f.chave]) continue;
          valores[f.chave] = rest[f.chave] ?? '';
        }
        await put(`/api/admin/implantacoes/${id}/dados-cliente`, { dominio: dominio || null, valores });
        toast('Informações registradas.');
        await reload();
      }
    });
  }

  function domainCard() {
    const dm = d.dominio;
    const body = el('div', { class: 'card-body' }, el('div', { class: 'd-flex justify-content-between align-items-center mb-2' }, el('h2', { class: 'h6 mb-0' }, 'Domínio e SSL'),
      dm ? el('button', { class: 'btn btn-sm btn-outline-secondary', type: 'button', onclick: async (e) => {
        const r = await withBusy(e.currentTarget, () => post(`/api/admin/implantacoes/${id}/verificar-dns`));
        if (r) { toast(r.mensagem, r.status_dns === 'ok' ? 'success' : 'warning'); await reload(); }
      } }, icon('broadcast'), ' Verificar DNS') : null));
    if (!dm) { body.append(el('p', { class: 'small text-body-secondary mb-0' }, 'Nenhum domínio informado ainda.')); return el('div', { class: 'card mb-3' }, body); }
    body.append(el('p', { class: 'mb-2' }, el('a', { href: `https://${dm.nome}`, target: '_blank', rel: 'noopener' }, dm.nome)),
      el('div', { class: 'd-flex flex-wrap gap-2 mb-2' }, badge(`DNS: ${ref.dns[dm.status_dns]}`, DNS_TONE[dm.status_dns]), badge(`SSL: ${ref.ssl[dm.status_ssl]}`, SSL_TONE[dm.status_ssl])),
      el('ul', { class: 'small list-unstyled mb-2' },
        el('li', {}, 'IPv4 encontrados: ', dm.ipv4?.length ? dm.ipv4.join(', ') : '—'),
        dm.ipv6?.length ? el('li', {}, `IPv6 encontrados: ${dm.ipv6.join(', ')}`) : null,
        el('li', {}, `Última verificação: ${datetime(dm.dns_verificado_em)}`),
        dm.ssl_expira_em ? el('li', {}, `Certificado válido até ${date(dm.ssl_expira_em)}`) : null,
        dm.renovacao_automatica !== null && dm.renovacao_automatica !== undefined ? el('li', {}, `Renovação automática: ${dm.renovacao_automatica ? 'ativa' : 'NÃO configurada'}`) : null));
    if (dm.status_dns !== 'ok') {
      const ins = el('div', { class: 'small' });
      body.append(el('details', {}, el('summary', { class: 'small' }, 'Instruções para o cliente ajustar o DNS'), ins));
      get(`/api/admin/dominios/${dm.id}/instrucoes`).then((r) => {
        ins.append(el('pre', { class: 'small bg-body-tertiary p-2 rounded mt-2 mb-1 pre-line' }, r.instrucoes),
          el('button', { class: 'btn btn-sm btn-link p-0', type: 'button', onclick: () => navigator.clipboard?.writeText(r.instrucoes).then(() => toast('Instruções copiadas.')) }, icon('clipboard'), ' Copiar'));
      }).catch(() => {});
    }
    return el('div', { class: 'card mb-3' }, body);
  }

  function checksCard() {
    if (!d.verificacoes.length) return null;
    const ok = d.verificacoes.every((v) => v.ok);
    return el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' },
      el('h2', { class: 'h6' }, 'Últimas verificações ', ok ? badge('Todas aprovadas', 'success') : badge('Com falhas', 'danger')),
      el('ul', { class: 'list-unstyled small mb-0' }, d.verificacoes.map((v) => el('li', { class: 'py-1' },
        el('span', { class: v.ok ? 'text-success' : 'text-danger' }, icon(v.ok ? 'check-circle-fill' : 'x-circle-fill')), ` ${v.descricao}`,
        v.detalhe ? el('div', { class: 'text-body-secondary ms-4' }, v.detalhe) : null))),
      el('div', { class: 'small text-body-secondary mt-2' }, datetime(d.verificacoes[0].criado_em))));
  }

  function resourcesCard() {
    const r = d.recursos;
    const rows = [['Diretório', r.diretorio], ['Usuário do sistema', r.usuario], ['Banco de dados', r.banco], ['Serviço', r.servico], ['Site Nginx', r.nginx], ['Porta interna', r.porta],
      ['Receita', `${d.receita.nome} (${d.receita.tecnologia})`], ['Versão', d.versao_instalada || d.receita.versao_app || d.receita.referencia]];
    return el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' },
      el('h2', { class: 'h6' }, 'Ambiente isolado'),
      el('dl', { class: 'small mb-0 deploy-fields' }, rows.filter(([, v]) => v).map(([k, v]) => [el('dt', {}, k), el('dd', {}, el('code', {}, String(v)))])),
      d.segredos.length ? el('p', { class: 'small text-body-secondary mt-2 mb-0' }, icon('shield-lock'), ` ${d.segredos.length} credencial(is) cifrada(s) no servidor — nunca exibidas.`) : null,
      d.backups.length ? el('details', { class: 'small mt-2' }, el('summary', {}, `Backups (${d.backups.length})`),
        el('ul', { class: 'mb-0' }, d.backups.map((b) => el('li', {}, `${datetime(b.criado_em)} — ${b.motivo}`, el('div', { class: 'text-body-secondary' }, el('code', {}, b.arquivo)))))) : null));
  }

  function tasksCard() {
    if (!d.tarefas.length) return null;
    return el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' },
      el('h2', { class: 'h6' }, 'Histórico de execuções'),
      el('ul', { class: 'timeline' }, d.tarefas.map((t) => el('li', {},
        el('div', { class: 'small text-body-secondary' }, `#${t.id} · ${datetime(t.criada_em)}${t.solicitada_por_nome ? ` · ${t.solicitada_por_nome}` : ' · automática'}`),
        el('div', {}, ref.tarefas[t.tipo], t.passo ? ` — ${ref.passos[t.passo] || t.passo}` : '', ' ', badge(t.status, TASK_TONE[t.status])),
        t.erro ? el('div', { class: 'small text-danger pre-line' }, t.erro) : null,
        el('button', { class: 'btn btn-link btn-sm p-0', type: 'button', onclick: () => logsModal(id, d, t.id) }, 'logs desta execução'))))));
  }

  function manageCard() {
    if (!canEdit || ['entregue', 'cancelada'].includes(d.status)) {
      return d.resumo_entrega ? el('div', { class: 'card mb-3' }, el('div', { class: 'card-body small' },
        el('h2', { class: 'h6' }, 'Entrega'), `Entregue em ${datetime(d.entregue_em)}${d.entregue_por_nome ? ` por ${d.entregue_por_nome}` : ''}.`)) : null;
    }
    return el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' },
      el('h2', { class: 'h6' }, 'Gestão'),
      el('p', { class: 'small mb-2' }, `Responsável: ${d.responsavel_nome || '—'}`, d.pedido_numero ? ` · Pedido ${d.pedido_numero}` : '', d.contrato_numero ? ` · Contrato ${d.contrato_numero}` : ''),
      d.observacoes ? el('p', { class: 'small pre-line text-body-secondary' }, d.observacoes) : null,
      el('div', { class: 'd-flex flex-wrap gap-2' },
        el('button', { class: 'btn btn-sm btn-outline-secondary', type: 'button', onclick: async () => {
          const o = await ctx.opcoes();
          formModal({
            title: 'Dados internos', size: '',
            fields: [
              { name: 'responsavel_id', label: 'Responsável técnico', type: 'select', numeric: true, options: () => (o.equipe || []).map((u) => [u.id, u.nome]) },
              { name: 'observacoes', label: 'Observações internas', type: 'textarea', rows: 3 }
            ],
            values: { responsavel_id: d.responsavel_id, observacoes: d.observacoes },
            onSubmit: async (v) => { await put(`/api/admin/implantacoes/${id}`, v); toast('Alterações salvas.'); await reload(); }
          });
        } }, icon('person-gear'), ' Responsável e observações'),
        d.acoes.cancelar ? el('button', { class: 'btn btn-sm btn-outline-danger', type: 'button', onclick: () => formModal({
          title: 'Cancelar implantação', size: '', submitLabel: 'Cancelar implantação',
          fields: [{ type: 'section', label: 'Os recursos já criados no servidor não são removidos automaticamente.', help: 'Nenhuma aplicação em funcionamento é interrompida por este cancelamento. A remoção, se necessária, deve ser feita manualmente após backup.' },
            { name: 'motivo', label: 'Motivo', type: 'textarea', rows: 2, required: true }],
          onSubmit: async (v) => { await post(`/api/admin/implantacoes/${id}/cancelar`, v); toast('Implantação cancelada.', 'warning'); await reload(); }
        }) }, icon('x-octagon'), ' Cancelar') : null)));
  }

  function deliverForm() {
    formModal({
      title: 'Finalizar entrega',
      submitLabel: 'Registrar entrega',
      fields: [
        { type: 'section', label: `Endereço: https://${d.dominio?.nome}`, help: 'O resumo de entrega reúne software, versão, endereço, recursos, orientações da receita e o resultado das verificações. Ele nunca contém senhas.' },
        { name: 'instrucoes_acesso', label: 'Instruções de acesso para o cliente', type: 'textarea', rows: 4, required: true, help: 'Ex.: "O responsável recebe por e-mail um link para definir a própria senha." Não escreva senhas aqui — o sistema bloqueia.' },
        { name: 'observacoes', label: 'Observações finais', type: 'textarea', rows: 2 }
      ],
      onSubmit: async (v) => {
        await post(`/api/admin/implantacoes/${id}/entregar`, v);
        toast('Entrega registrada.');
        await reload();
        window.open(`/api/admin/implantacoes/${id}/resumo`, '_blank', 'noopener');
      }
    });
  }

  draw();
}

// ------------------------------------------------------------------ logs ao vivo
const LEVEL_CLASS = { info: '', aviso: 'log-warn', erro: 'log-error', comando: 'log-cmd', saida: 'log-out' };

function logsModal(id, d, tarefa = null) {
  const pre = el('div', { class: 'deploy-log', role: 'log', 'aria-live': 'polite', tabindex: '0' }, loading());
  const follow = el('input', { class: 'form-check-input', type: 'checkbox', id: 'log-follow', checked: true });
  const body = el('div', {},
    el('div', { class: 'd-flex justify-content-between align-items-center mb-2 small' },
      el('span', { class: 'text-body-secondary' }, tarefa ? `Execução #${tarefa}` : 'Todas as execuções', ' · senhas e tokens são mascarados'),
      el('div', { class: 'form-check form-switch mb-0' }, follow, el('label', { class: 'form-check-label', for: 'log-follow' }, 'Acompanhar'))),
    pre);
  const m = infoModal({ title: `Logs — ${d.codigo}`, body, size: 'modal-xl' });
  let last = 0;
  let stop = false;
  let first = true;
  m.dialog.addEventListener('hidden.bs.modal', () => { stop = true; });
  (async function poll() {
    while (!stop) {
      try {
        const q = new URLSearchParams({ depois: last, limite: 1000 });
        if (tarefa) q.set('tarefa', tarefa);
        const r = await get(`/api/admin/implantacoes/${id}/logs?${q}`);
        if (first) { pre.textContent = ''; if (!r.itens.length) pre.append(el('div', { class: 'text-body-secondary' }, 'Nenhum registro ainda.')); first = false; }
        for (const l of r.itens) {
          pre.append(el('div', { class: LEVEL_CLASS[l.nivel] || '' },
            el('span', { class: 'log-time' }, new Date(l.criado_em).toLocaleTimeString('pt-BR')), ' ',
            l.passo ? el('span', { class: 'log-step' }, `[${l.passo}] `) : null, l.mensagem));
        }
        last = r.ultimo;
        if (r.itens.length && follow.checked) pre.scrollTop = pre.scrollHeight;
      } catch (err) { if (first) { pre.textContent = ''; pre.append(el('div', { class: 'log-error' }, err.message)); } }
      await new Promise((res) => setTimeout(res, 2000));
    }
  })();
}
