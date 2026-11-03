// Receitas de implantação: como cada software é instalado. O servidor valida tudo
// contra a lista de operações autorizadas — nada aqui vira comando de shell livre.
import { put } from '../../shared/api.js';
import { el, icon, badge, formModal, toast } from '../../shared/ui.js';
import { crudPage, yesNo } from './_crud.js';
import { reference } from './deployments.js';

const joinCmd = (argv) => (Array.isArray(argv) ? argv.join(' ') : argv || '');

// Variáveis: uma por linha, "NOME=origem" ou "NOME=origem:valor".
const varsToLines = (list = []) => list.map((x) => `${x.nome}=${x.origem}${x.valor !== undefined && x.valor !== null && x.valor !== '' ? `:${x.valor}` : ''}`);
function linesToVars(lines) {
  return lines.map((line) => {
    const eq = line.indexOf('=');
    if (eq < 1) return { nome: line, origem: '' };
    const nome = line.slice(0, eq).trim();
    const rest = line.slice(eq + 1).trim();
    const colon = rest.indexOf(':');
    return colon < 0 ? { nome, origem: rest } : { nome, origem: rest.slice(0, colon).trim(), valor: rest.slice(colon + 1) };
  });
}

// Campos do cliente: "chave | rótulo | tipo | responsável | obrigatorio | padrão".
const fieldsToLines = (list = []) => list.map((f) => [f.chave, f.rotulo, f.tipo, f.responsavel, f.obrigatorio ? 'obrigatorio' : 'opcional', f.padrao || ''].join(' | ').replace(/( \| )+$/, ''));
const linesToFields = (lines) => lines.map((line) => {
  const [chave, rotulo, tipo, responsavel, obrig, padrao] = line.split('|').map((s) => s.trim());
  return { chave, rotulo, tipo: tipo || 'texto', responsavel: responsavel || 'cliente', obrigatorio: /^(obrigat|sim|s$|true)/i.test(obrig || ''), ...(padrao ? { padrao } : {}) };
});

// Verificações HTTP: "/caminho 200 texto esperado (opcional)".
const checksToLines = (list = []) => list.map((c) => `${c.caminho} ${c.status}${c.contem ? ` ${c.contem}` : ''}`);
const linesToChecks = (lines) => lines.map((line) => {
  const [caminho, status, ...rest] = line.split(/\s+/);
  return { caminho, status: Number(status || 200), ...(rest.length ? { contem: rest.join(' ') } : {}) };
});

export async function render(c, ctx) {
  const ref = await reference();
  await crudPage(c, ctx, {
    title: 'Receitas de implantação',
    singular: 'receita',
    description: 'Configuração de instalação de cada software: repositório, versão, comandos, banco, variáveis, Nginx e verificações. Cada software pode usar tecnologia e processo próprios.',
    endpoint: '/api/admin/receitas',
    editPerm: 'implantacoes.receitas',
    newLabel: 'Nova receita',
    needsOptions: true,
    loadOne: true,
    invalidatesOptions: true,
    columns: [
      { label: 'Software', key: 'produto_nome' },
      { label: 'Receita', key: 'nome' },
      { label: 'Tecnologia', render: (r) => ref.tecnologias[r.tecnologia] || r.tecnologia },
      { label: 'Versão', render: (r) => r.versao_app || r.referencia },
      { label: 'Banco', render: (r) => yesNo(r.requer_banco) },
      { label: 'Token do repositório', render: (r) => (r.tem_token_git ? badge('Configurado', 'success') : badge('Público / não definido', 'light')) },
      { label: 'Ativa', render: (r) => yesNo(r.ativa) }
    ],
    filters: [{ name: 'produto_id', label: 'Todos os softwares', options: (fctx) => (fctx.opcoes.produtos || []).map((p) => [p.id, p.nome]) }],
    rowActions: (row, { refresh }) => [el('button', { class: 'btn btn-outline-secondary', type: 'button', title: 'Token de leitura do repositório', 'aria-label': 'Token de leitura do repositório', onclick: () => tokenForm(row, refresh) }, icon('key'))],
    defaults: {
      ativa: true, tecnologia: 'node', referencia: 'main', node_versao_minima: 20, requer_banco: true,
      cmd_instalacao: ['npm ci --omit=dev'], cmd_migracoes: ['npm run db:migrate'], cmd_inicio: 'node backend/src/server.js',
      variaveis_txt: ['NODE_ENV=fixo:production', 'PORT=porta', 'DATABASE_URL=banco', 'APP_URL=dominio', 'APP_SECRET=gerado'],
      campos_txt: ['nome_sistema | Nome exibido no sistema | texto | cliente | obrigatorio', 'nome_empresa | Razão social | texto | automatico | obrigatorio | {cliente.empresa}'],
      verificacoes_txt: ['/ 200'], client_max_body_size_mb: 20, timeout_s: 60, websocket: false
    },
    fields: (fctx, v) => {
      // Converte a estrutura salva para os editores em linhas.
      if (v.comandos && !v.cmd_inicio) {
        for (const g of ['instalacao', 'build', 'migracoes', 'seed', 'personalizacao']) v[`cmd_${g}`] = (v.comandos[g] || []).map(joinCmd);
        v.cmd_inicio = joinCmd(v.comandos.inicio);
      }
      if (Array.isArray(v.variaveis) && !v.variaveis_txt) v.variaveis_txt = varsToLines(v.variaveis);
      if (Array.isArray(v.campos_cliente) && !v.campos_txt) v.campos_txt = fieldsToLines(v.campos_cliente);
      if (Array.isArray(v.verificacoes) && !v.verificacoes_txt) v.verificacoes_txt = checksToLines(v.verificacoes);
      if (v.nginx_opcoes) Object.assign(v, { client_max_body_size_mb: v.nginx_opcoes.client_max_body_size_mb, timeout_s: v.nginx_opcoes.timeout_s, websocket: v.nginx_opcoes.websocket });
      const cmdHelp = 'Um comando por linha. Permitidos: npm ci / npm install, npm run <script>, node <arquivo.js do projeto>. Sem shell, redirecionamentos ou encadeamentos.';
      return [
        { type: 'section', label: 'Identificação' },
        { name: 'produto_id', label: 'Software', type: 'select', numeric: true, required: true, col: 6, options: () => (fctx.opcoes.produtos || []).map((p) => [p.id, p.nome]) },
        { name: 'nome', label: 'Nome da receita', required: true, col: 6 },
        { name: 'tecnologia', label: 'Tecnologia', type: 'select', required: true, col: 4, options: Object.entries(ref.tecnologias) },
        { name: 'node_versao_minima', label: 'Node.js mínimo', type: 'number', col: 4, min: 16 },
        { name: 'versao_app', label: 'Versão do software', col: 4, placeholder: '1.0.0' },
        { name: 'repositorio_url', label: 'Repositório Git (HTTPS)', required: true, col: 8, placeholder: 'https://github.com/organizacao/sistema.git', help: 'Sem usuário ou token na URL. Para repositório privado, defina o token de leitura pelo botão de chave na lista.' },
        { name: 'referencia', label: 'Branch, tag ou commit', required: true, col: 4, help: 'Prefira uma tag de versão.' },
        { name: 'requer_banco', label: 'Usa banco PostgreSQL próprio (banco e usuário exclusivos por cliente)', type: 'checkbox' },
        { name: 'ativa', label: 'Receita ativa', type: 'checkbox' },

        { type: 'section', label: 'Comandos', help: cmdHelp },
        { name: 'cmd_instalacao', label: 'Instalação de dependências', type: 'lines', rows: 2, required: true, col: 6 },
        { name: 'cmd_build', label: 'Build (opcional)', type: 'lines', rows: 2, col: 6 },
        { name: 'cmd_migracoes', label: 'Migrations (backup automático antes)', type: 'lines', rows: 2, col: 6 },
        { name: 'cmd_seed', label: 'Dados iniciais / seed (opcional)', type: 'lines', rows: 2, col: 6 },
        { name: 'cmd_personalizacao', label: 'Personalização com os dados do cliente (opcional)', type: 'lines', rows: 2, col: 6 },
        { name: 'cmd_inicio', label: 'Inicialização da aplicação', required: true, col: 6, placeholder: 'node backend/src/server.js', help: 'Executado pelo serviço systemd da instalação.' },

        { type: 'section', label: 'Informações do cliente', help: 'Uma por linha: chave | rótulo | tipo | responsável | obrigatorio/opcional | padrão. Tipos: ' + Object.keys(ref.tipos_campo).join(', ') + '. Responsável: ' + Object.keys(ref.responsaveis_campo).join(', ') + '. Padrões automáticos: ' + ref.tokens_automaticos.join(', ') + '. O domínio é pedido sempre, não precisa ser listado.' },
        { name: 'campos_txt', label: 'Campos', type: 'lines', rows: 5 },

        { type: 'section', label: 'Variáveis de ambiente (.env)', help: 'Uma por linha: NOME=origem ou NOME=origem:valor. Origens: fixo:<valor>, gerado (segredo aleatório), banco (DATABASE_URL), dominio, host, porta, cliente:<chave>, segredo:<chave de campo sigiloso>. Senhas nunca são digitadas aqui.' },
        { name: 'variaveis_txt', label: 'Variáveis', type: 'lines', rows: 6 },

        { type: 'section', label: 'Servidor e verificações' },
        { name: 'diretorios_persistentes', label: 'Diretórios persistentes entre versões', type: 'lines', rows: 2, col: 6, help: 'Relativos ao projeto, ex.: storage/uploads. Mantidos em shared/.' },
        { name: 'verificacoes_txt', label: 'Verificações HTTP após instalar', type: 'lines', rows: 2, col: 6, help: 'Uma por linha: /caminho 200 texto-esperado (opcional).' },
        { name: 'client_max_body_size_mb', label: 'Upload máximo (MB)', type: 'number', col: 4, min: 1 },
        { name: 'timeout_s', label: 'Tempo limite do proxy (s)', type: 'number', col: 4, min: 10 },
        { name: 'memoria_mb', label: 'Memória mínima (MB)', type: 'number', col: 2 },
        { name: 'disco_mb', label: 'Disco mínimo (MB)', type: 'number', col: 2 },
        { name: 'websocket', label: 'Aplicação usa WebSocket', type: 'checkbox' },
        { name: 'orientacoes_uso', label: 'Orientações de uso (vão no resumo de entrega)', type: 'textarea', rows: 3 },
        { name: 'observacoes', label: 'Observações internas', type: 'textarea', rows: 2 }
      ];
    },
    prepare: (v) => {
      const {
        cmd_instalacao: instalacao, cmd_build: build, cmd_migracoes: migracoes, cmd_seed: seed, cmd_personalizacao: personalizacao, cmd_inicio: inicio,
        campos_txt: campos, variaveis_txt: variaveis, verificacoes_txt: verificacoes, client_max_body_size_mb: maxMb, timeout_s: timeout, websocket, ...rest
      } = v;
      return {
        ...rest,
        comandos: { instalacao, build, migracoes, seed, personalizacao, inicio },
        campos_cliente: linesToFields(campos || []),
        variaveis: linesToVars(variaveis || []),
        verificacoes: linesToChecks(verificacoes || []),
        nginx_opcoes: { client_max_body_size_mb: maxMb ?? 20, timeout_s: timeout ?? 60, websocket: Boolean(websocket) }
      };
    },
    deleteMessage: (r) => `Excluir a receita "${r.nome}"? Receitas já usadas em implantações não podem ser excluídas — desative-as.`
  });
}

function tokenForm(row, refresh) {
  formModal({
    title: 'Token de leitura do repositório', size: '', submitLabel: 'Salvar token',
    fields: [
      { type: 'section', label: row.tem_token_git ? 'Já existe um token configurado.' : 'Nenhum token configurado.', help: 'Use um token com permissão SOMENTE de leitura (ex.: fine-grained token do GitHub com "Contents: read"). Ele é armazenado cifrado e nunca é exibido nem gravado nos logs.' },
      { name: 'token', label: 'Novo token', type: 'password', help: 'Deixe em branco e salve para remover o token.' }
    ],
    onSubmit: async (v) => {
      await put(`/api/admin/receitas/${row.id}/token`, { token: v.token || '' });
      toast(v.token ? 'Token salvo.' : 'Token removido.');
      refresh();
    }
  });
}
