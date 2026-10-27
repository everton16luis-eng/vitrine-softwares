import { get, post, put, del } from '../../shared/api.js';
import { el, icon, badge, money, dataTable, buildForm, formModal, confirmDialog, toast, toastError, debounce, withBusy, datetime } from '../../shared/ui.js';
import { pageHeader, entries } from './_crud.js';

const STATUS_TONE = { em_planejamento: 'secondary', em_desenvolvimento: 'info', demonstracao_disponivel: 'primary', disponivel: 'success', em_manutencao: 'warning', arquivado: 'dark' };

export async function render(c, ctx, params) {
  const meta = await get('/api/admin/produtos/opcoes');
  if (params[0]) return editor(c, ctx, params[0], meta);
  return list(c, ctx, meta);
}

function list(c, ctx, meta) {
  const state = { busca: '', status_comercial: '', publicado: '' };
  const table = dataTable({
    caption: 'Produtos',
    columns: [
      { label: '', render: (r) => el('img', { src: r.capa_url, alt: '', class: 'thumb', loading: 'lazy' }) },
      { label: 'Produto', render: (r) => el('div', {}, el('strong', {}, r.nome), el('div', { class: 'small text-body-secondary' }, r.categoria_nome), r.dados_demonstrativos ? badge('Demonstrativo', 'light border') : null) },
      { label: 'Status comercial', render: (r) => badge(meta.status[r.status_comercial], STATUS_TONE[r.status_comercial]) },
      { label: 'Publicação', render: (r) => (r.publicado ? badge('Publicado', 'success') : badge('Não publicado', 'secondary')) },
      { label: 'Destaque', render: (r) => (r.destaque ? icon('star-fill', 'text-warning') : '—') },
      { label: 'Preço', render: (r) => (r.preco ? money(r.preco, r.moeda) : 'Sob consulta') },
      { label: 'Visualizações', key: 'visualizacoes', class: 'text-end' },
      { label: 'Ordem', key: 'ordem', class: 'text-end' }
    ],
    load: (page) => get(`/api/admin/produtos?${new URLSearchParams({ pagina: page, ...Object.fromEntries(Object.entries(state).filter(([, v]) => v)) })}`),
    onRowClick: (r) => ctx.navigate(`produtos/${r.id}`)
  });
  c.append(
    pageHeader('Produtos', 'Somente produtos publicados, não arquivados e com categoria ativa aparecem no catálogo público.',
      ctx.can('produtos.editar') ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.navigate('produtos/novo') }, icon('plus-lg'), ' Novo produto') : null),
    el('div', { class: 'card' }, el('div', { class: 'card-body' },
      el('div', { class: 'toolbar' },
        el('input', { type: 'search', class: 'form-control', placeholder: 'Pesquisar produtos', 'aria-label': 'Pesquisar produtos', oninput: debounce((e) => { state.busca = e.target.value; table.refresh(1); }) }),
        el('select', { class: 'form-select', 'aria-label': 'Status comercial', onchange: (e) => { state.status_comercial = e.target.value; table.refresh(1); } }, el('option', { value: '' }, 'Todos os status'), entries(meta.status).map(([k, l]) => el('option', { value: k }, l))),
        el('select', { class: 'form-select', 'aria-label': 'Publicação', onchange: (e) => { state.publicado = e.target.value; table.refresh(1); } }, el('option', { value: '' }, 'Publicados e não publicados'), el('option', { value: 'true' }, 'Publicados'), el('option', { value: 'false' }, 'Não publicados'))),
      table.node)));
  table.refresh();
}

function productFields(meta, opcoes) {
  return [
    { type: 'section', label: 'Identificação' },
    { name: 'nome', label: 'Nome', required: true, col: 6, max: 140 },
    { name: 'categoria_id', label: 'Categoria', type: 'select', numeric: true, required: true, col: 6, options: () => (opcoes.categorias || []).map((x) => [x.id, `${x.nome}${x.ativa ? '' : ' (inativa)'}`]) },
    { name: 'slug', label: 'Slug (URL)', col: 6, help: 'Gerado do nome se vazio. Ex.: meu-sistema → /softwares/meu-sistema' },
    { name: 'ordem', label: 'Ordem no catálogo', type: 'number', col: 3 },
    { name: 'destaque', label: 'Destacar na página inicial', type: 'checkbox', col: 3 },
    { name: 'resumo', label: 'Resumo', type: 'textarea', required: true, rows: 2, max: 400 },
    { name: 'descricao', label: 'Apresentação detalhada (Markdown)', type: 'markdown' },
    { name: 'problema_resolvido', label: 'Problema que resolve (Markdown)', type: 'textarea', rows: 3 },
    { name: 'publico_alvo', label: 'Perfil de cliente indicado (Markdown)', type: 'textarea', rows: 3 },
    { name: 'requisitos_tecnicos', label: 'Requisitos técnicos (Markdown)', type: 'textarea', rows: 3 },
    { type: 'section', label: 'Comercial', help: 'Somente "Disponível para contratação" exibe o botão "Contratar". Não marque como disponível sem confirmar a condição.' },
    { name: 'status_comercial', label: 'Status comercial', type: 'select', required: true, col: 6, options: entries(meta.status).filter(([k]) => k !== 'arquivado') },
    { name: 'modelo_contratacao', label: 'Modelo de contratação', type: 'select', required: true, col: 6, options: entries(meta.modelos) },
    { name: 'preco', label: 'Preço (opcional)', type: 'money', col: 4, help: 'Vazio = "Sob consulta".' },
    { name: 'preco_descricao', label: 'Texto do preço', col: 4, placeholder: 'a partir de' },
    { name: 'moeda', label: 'Moeda', type: 'select', required: true, col: 4, options: [['BRL', 'BRL'], ['USD', 'USD'], ['EUR', 'EUR']] },
    { type: 'section', label: 'Mídia e demonstração' },
    { name: 'imagem_id', label: 'Imagem de capa (biblioteca)', type: 'image', col: 6 },
    { name: 'imagem_url', label: 'ou caminho de imagem estática', col: 6, placeholder: '/assets/images/produtos/arquivo.svg' },
    { name: 'video_url', label: 'Vídeo demonstrativo (YouTube ou Vimeo)', type: 'url', col: 12 },
    { name: 'demo_tipo', label: 'Demonstração', type: 'select', required: true, col: 4, options: [['nenhuma', 'Nenhuma'], ['interna', 'Interna (dados fictícios)'], ['externa', 'Link externo']] },
    { name: 'demo_url', label: 'URL da demonstração externa', type: 'url', col: 5 },
    { name: 'demo_disponivel', label: 'Demonstração disponível', type: 'checkbox', col: 3 },
    { name: 'demo_aviso', label: 'Aviso exibido com a demonstração', max: 300 },
    { name: 'documentacao_url', label: 'Link da documentação', type: 'url', col: 6 },
    { name: 'manual_url', label: 'Link do manual de utilização', type: 'url', col: 6 },
    { type: 'section', label: 'SEO' },
    { name: 'seo_title', label: 'Título SEO', max: 70, col: 6 },
    { name: 'seo_description', label: 'Descrição SEO', max: 170, col: 6 }
  ];
}

async function editor(c, ctx, idParam, meta) {
  const isNew = idParam === 'novo';
  const canEdit = ctx.can('produtos.editar');
  const canPublish = ctx.can('produtos.publicar');
  const opcoes = await ctx.opcoes();
  let product = isNew ? { moeda: 'BRL', status_comercial: 'em_planejamento', modelo_contratacao: 'sob_orcamento', demo_tipo: 'nenhuma', ordem: 0 } : await get(`/api/admin/produtos/${Number(idParam)}`);
  const fctx = { ...ctx, opcoes };

  const header = el('div');
  const body = el('div');
  c.append(el('a', { href: '#/produtos', class: 'back-link' }, icon('arrow-left'), ' Produtos'), header, body);

  function drawHeader() {
    header.textContent = '';
    const actions = [];
    if (!isNew) {
      if (product.publicado) actions.push(el('a', { class: 'btn btn-outline-secondary', href: `/softwares/${product.slug}`, target: '_blank', rel: 'noopener' }, icon('box-arrow-up-right'), ' Ver no site'));
      if (canPublish && product.status_comercial !== 'arquivado') {
        actions.push(product.publicado
          ? el('button', { class: 'btn btn-outline-warning', type: 'button', onclick: (e) => action(e.currentTarget, 'despublicar', 'Produto despublicado.') }, icon('eye-slash'), ' Despublicar')
          : el('button', { class: 'btn btn-success', type: 'button', onclick: (e) => action(e.currentTarget, 'publicar', 'Produto publicado.') }, icon('eye'), ' Publicar'));
        actions.push(el('button', { class: 'btn btn-outline-secondary', type: 'button', onclick: async (e) => {
          if (await confirmDialog({ title: 'Arquivar produto', message: 'O produto será despublicado e mantido para histórico comercial. Continuar?', confirmLabel: 'Arquivar', danger: false })) action(e.currentTarget, 'arquivar', 'Produto arquivado.');
        } }, icon('archive'), ' Arquivar'));
      }
      if (canPublish && product.status_comercial === 'arquivado') actions.push(el('button', { class: 'btn btn-outline-primary', type: 'button', onclick: (e) => action(e.currentTarget, 'restaurar', 'Produto restaurado.') }, icon('arrow-counterclockwise'), ' Restaurar'));
      if (canEdit && !product.publicado) actions.push(el('button', { class: 'btn btn-outline-danger', type: 'button', onclick: removeProduct }, icon('trash'), ' Excluir'));
    }
    header.append(pageHeader(isNew ? 'Novo produto' : product.nome,
      isNew ? 'Preencha os dados gerais. Funcionalidades, galeria e perguntas ficam disponíveis após salvar.' : `Atualizado em ${datetime(product.atualizado_em)}`, ...actions));
    if (!isNew) {
      header.append(el('div', { class: 'd-flex flex-wrap gap-2 mb-3' },
        badge(meta.status[product.status_comercial], STATUS_TONE[product.status_comercial]),
        product.publicado ? badge('Publicado', 'success') : badge('Não publicado', 'secondary'),
        product.dados_demonstrativos ? badge('Registro demonstrativo', 'light border') : null,
        !product.categoria_ativa ? badge('Categoria inativa', 'danger') : null));
    }
  }

  async function action(btn, name, msg) {
    const r = await withBusy(btn, () => post(`/api/admin/produtos/${product.id}/${name}`), msg);
    if (r) { product = r; drawHeader(); drawBody(); }
  }

  async function removeProduct() {
    if (!(await confirmDialog({ title: 'Excluir produto', message: 'A exclusão definitiva só é permitida para produtos sem histórico comercial. Produtos com histórico devem ser arquivados. Continuar?', confirmLabel: 'Excluir' }))) return;
    try { await del(`/api/admin/produtos/${product.id}`); toast('Produto excluído.'); ctx.navigate('produtos'); } catch (err) { toastError(err); }
  }

  function drawBody() {
    body.textContent = '';
    const tabs = el('ul', { class: 'nav nav-tabs mb-3', role: 'tablist' });
    const panel = el('div');
    const sections = [['dados', 'Dados gerais']];
    if (!isNew) sections.push(['funcionalidades', `Funcionalidades (${product.funcionalidades.length})`], ['beneficios', `Benefícios (${product.beneficios.length})`], ['galeria', `Galeria (${product.imagens.length})`], ['faqs', `Perguntas (${product.faqs.length})`], ['planos', 'Planos']);
    const show = (k) => {
      tabs.querySelectorAll('button').forEach((b) => { b.classList.toggle('active', b.dataset.tab === k); b.setAttribute('aria-selected', String(b.dataset.tab === k)); });
      panel.textContent = '';
      ({ dados: dadosTab, funcionalidades: () => childTab('funcionalidades', 'funcionalidade'), beneficios: () => childTab('funcionalidades', 'beneficio'), galeria: galeriaTab, faqs: () => childTab('faqs'), planos: planosTab })[k](panel);
    };
    sections.forEach(([k, l]) => tabs.append(el('li', { class: 'nav-item', role: 'presentation' }, el('button', { class: 'nav-link', role: 'tab', type: 'button', dataset: { tab: k }, onclick: () => show(k) }, l))));
    body.append(tabs, panel);
    show('dados');
  }

  function dadosTab(panel) {
    const form = buildForm(productFields(meta, opcoes).map((f) => ({ ...f, readonly: !canEdit || product.status_comercial === 'arquivado' })), product, fctx);
    panel.append(el('div', { class: 'card' }, el('div', { class: 'card-body' }, form.node)));
    if (!canEdit || product.status_comercial === 'arquivado') return;
    const save = el('button', { class: 'btn btn-primary', type: 'button' }, icon('check2'), isNew ? ' Criar produto' : ' Salvar alterações');
    save.addEventListener('click', async () => {
      if (!form.validate()) return;
      save.disabled = true;
      try {
        const saved = isNew ? await post('/api/admin/produtos', form.values()) : await put(`/api/admin/produtos/${product.id}`, form.values());
        toast(isNew ? 'Produto criado. Agora cadastre funcionalidades e imagens.' : 'Alterações salvas.');
        ctx._opcoes = null;
        if (isNew) { ctx.navigate(`produtos/${saved.id}`); return; }
        product = saved;
        drawHeader();
      } catch (err) { form.showErrors(err.fields || {}, err.message); } finally { save.disabled = false; }
    });
    panel.append(el('div', { class: 'sticky-save' }, save));
  }

  function childTab(kind, tipo) {
    return (panel) => {
      const list = kind === 'faqs' ? product.faqs : tipo === 'beneficio' ? product.beneficios : product.funcionalidades;
      const fields = kind === 'faqs'
        ? [{ name: 'pergunta', label: 'Pergunta', required: true }, { name: 'resposta', label: 'Resposta', type: 'textarea', required: true }, { name: 'ordem', label: 'Ordem', type: 'number', col: 4 }]
        : [{ name: 'titulo', label: 'Título', required: true, col: 8 }, { name: 'icone', label: 'Ícone (Bootstrap Icons)', col: 4, placeholder: 'check2-circle' }, { name: 'descricao', label: 'Descrição', type: 'textarea' }, { name: 'ordem', label: 'Ordem', type: 'number', col: 4 }];
      const open = (item) => formModal({
        title: item ? 'Editar item' : 'Novo item', fields, values: item || { ordem: (list.length + 1) * 10 },
        onSubmit: async (v) => {
          const payload = kind === 'faqs' ? v : { ...v, tipo };
          if (item) await put(`/api/admin/produtos/${product.id}/${kind}/${item.id}`, payload); else await post(`/api/admin/produtos/${product.id}/${kind}`, payload);
          product = await get(`/api/admin/produtos/${product.id}`);
          toast('Item salvo.');
          drawBody();
          [...body.querySelectorAll('[data-tab]')].find((b) => b.dataset.tab === (kind === 'faqs' ? 'faqs' : tipo === 'beneficio' ? 'beneficios' : 'funcionalidades'))?.click();
        }
      });
      panel.append(el('div', { class: 'card' }, el('div', { class: 'card-body' },
        canEdit ? el('button', { class: 'btn btn-primary btn-sm mb-3', type: 'button', onclick: () => open(null) }, icon('plus-lg'), ' Adicionar') : null,
        list.length ? el('ul', { class: 'list-group' }, list.map((it) => el('li', { class: 'list-group-item d-flex gap-3 align-items-start' },
          it.icone ? icon(it.icone, 'fs-5 text-primary') : null,
          el('div', { class: 'flex-grow-1' }, el('strong', {}, it.titulo || it.pergunta), el('div', { class: 'small text-body-secondary' }, it.descricao || it.resposta || '')),
          canEdit ? el('div', { class: 'btn-group btn-group-sm' },
            el('button', { class: 'btn btn-outline-secondary', type: 'button', 'aria-label': 'Editar', onclick: () => open(it) }, icon('pencil')),
            el('button', { class: 'btn btn-outline-danger', type: 'button', 'aria-label': 'Remover', onclick: async () => {
              if (!(await confirmDialog({ message: 'Remover este item?', confirmLabel: 'Remover' }))) return;
              try { await del(`/api/admin/produtos/${product.id}/${kind}/${it.id}`); product = await get(`/api/admin/produtos/${product.id}`); toast('Item removido.'); drawBody(); } catch (err) { toastError(err); }
            } }, icon('trash'))) : null))) : el('p', { class: 'text-body-secondary mb-0' }, 'Nenhum item cadastrado.'))));
    };
  }

  function galeriaTab(panel) {
    const add = async () => {
      const file = await ctx.pickImage();
      if (!file) return;
      formModal({
        title: 'Legenda da imagem', fields: [{ name: 'legenda', label: 'Legenda', max: 200 }, { name: 'ordem', label: 'Ordem', type: 'number', col: 4 }], values: { ordem: (product.imagens.length + 1) * 10 },
        onSubmit: async (v) => { await post(`/api/admin/produtos/${product.id}/imagens`, { ...v, arquivo_id: file.id }); product = await get(`/api/admin/produtos/${product.id}`); toast('Imagem adicionada à galeria.'); drawBody(); }
      });
    };
    panel.append(el('div', { class: 'card' }, el('div', { class: 'card-body' },
      el('p', { class: 'text-body-secondary small' }, 'Priorize capturas reais das telas do sistema ou mockups criados para o projeto. Não use fotografias de pessoas no lugar de telas.'),
      canEdit ? el('button', { class: 'btn btn-primary btn-sm mb-3', type: 'button', onclick: add }, icon('plus-lg'), ' Adicionar imagem') : null,
      product.imagens.length ? el('div', { class: 'media-library' }, product.imagens.map((img) => el('figure', { class: 'media-card' },
        el('img', { src: img.url, alt: img.texto_alternativo || img.legenda || '' }),
        el('figcaption', {}, el('strong', {}, img.legenda || 'Sem legenda'), el('span', {}, img.arquivo_id ? `Biblioteca #${img.arquivo_id}` : 'Imagem estática do projeto'),
          canEdit ? el('button', { class: 'btn btn-sm btn-outline-danger mt-2', type: 'button', onclick: async () => {
            if (!(await confirmDialog({ message: 'Remover a imagem da galeria? O arquivo continua na biblioteca.', confirmLabel: 'Remover' }))) return;
            try { await del(`/api/admin/produtos/${product.id}/imagens/${img.id}`); product = await get(`/api/admin/produtos/${product.id}`); drawBody(); } catch (err) { toastError(err); }
          } }, icon('trash'), ' Remover') : null)))) : el('p', { class: 'text-body-secondary mb-0' }, 'Nenhuma imagem na galeria.'))));
  }

  function planosTab(panel) {
    const plans = opcoes.planos || [];
    const set = new Set(product.planos_ids);
    const checks = plans.map((p) => el('div', { class: 'form-check' }, el('input', { class: 'form-check-input', type: 'checkbox', id: `pl-${p.id}`, value: p.id, checked: set.has(p.id), disabled: !canEdit || null }),
      el('label', { class: 'form-check-label', for: `pl-${p.id}` }, `${p.nome}${p.preco ? ` — ${money(p.preco)}` : ''}${p.ativo ? '' : ' (inativo)'}`)));
    const save = el('button', { class: 'btn btn-primary btn-sm mt-3', type: 'button', onclick: async () => {
      const ids = checks.map((n) => n.querySelector('input')).filter((i) => i.checked).map((i) => Number(i.value));
      const r = await withBusy(save, () => put(`/api/admin/produtos/${product.id}/planos`, { planos: ids }), 'Planos associados.');
      if (r) product = r;
    } }, 'Salvar planos');
    panel.append(el('div', { class: 'card' }, el('div', { class: 'card-body' },
      el('p', { class: 'text-body-secondary small' }, 'Associe planos cadastrados em "Planos e preços". Cada produto pode ter modelos de cobrança diferentes.'),
      plans.length ? checks : el('p', {}, 'Nenhum plano cadastrado.'), canEdit && plans.length ? save : null)));
  }

  drawHeader();
  drawBody();
}
