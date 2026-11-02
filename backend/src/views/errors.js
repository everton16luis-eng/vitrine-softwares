import { html } from '../utils/html.js';
import { layout } from './layout.js';
import { getPublicSettings } from '../modules/settings/settings.service.js';

const FALLBACK_SETTINGS = { nome_comercial: 'Sua empresa de tecnologia', seo_descricao_padrao: '', cor_primaria: '#0F172A' };

const MESSAGES = {
  404: { title: 'Página não encontrada', text: 'O endereço acessado não existe ou foi removido.', icon: 'signpost-split' },
  403: { title: 'Acesso não permitido', text: 'Você não tem permissão para acessar este conteúdo.', icon: 'shield-lock' },
  500: { title: 'Algo deu errado', text: 'Ocorreu um erro inesperado. Nossa equipe foi notificada pelos registros do sistema. Tente novamente em instantes.', icon: 'exclamation-octagon' }
};

export async function renderErrorPage(req, res, status, detail) {
  let settings = FALLBACK_SETTINGS;
  try { settings = { ...FALLBACK_SETTINGS, ...(await getPublicSettings()) }; } catch { /* banco indisponível: usa padrão */ }
  const m = MESSAGES[status] || { title: 'Não foi possível concluir', text: detail || 'Verifique os dados e tente novamente.', icon: 'info-circle' };
  const body = html`<section class="section error-page"><div class="container narrow text-center">
    <i class="bi bi-${m.icon} error-icon" aria-hidden="true"></i>
    <p class="eyebrow">Erro ${status}</p>
    <h1>${m.title}</h1>
    <p class="lead-muted">${status < 500 && detail ? detail : m.text}</p>
    <div class="d-flex justify-content-center flex-wrap gap-2 mt-4">
      <a class="btn btn-accent" href="/">Ir para o início</a>
      <a class="btn btn-outline-ink" href="/servicos">Ver serviços</a>
      <a class="btn btn-link" href="/contato">Falar com a gente</a>
    </div>
  </div></section>`;
  res.status(status).type('html').send(layout({ settings, title: m.title, path: req.path, body, noindex: true }));
}
