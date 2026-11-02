// Gera as ilustrações de interface (mockups SVG) usadas pelos produtos demonstrativos
// e a imagem Open Graph padrão (PNG). Todas são criações originais do projeto —
// não há fotografias de pessoas nem material de terceiros.
// Uso: node scripts/generate-images.js
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'frontend', 'public', 'assets', 'images');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const INK = '#0e1525';
const PANEL = '#131c2e';
const LINE = '#22304a';
const TEXT = '#e6ebf3';
const MUTED = '#8792a8';

function frame({ title, accent, nav, active = 0, heading, body, w = 960, h = 600 }) {
  const navItems = nav.map((n, i) => `
    <rect x="16" y="${92 + i * 40}" width="176" height="32" rx="8" fill="${i === active ? accent : 'none'}" fill-opacity="${i === active ? 0.16 : 0}"/>
    <rect x="30" y="${103 + i * 40}" width="10" height="10" rx="3" fill="${i === active ? accent : MUTED}"/>
    <text x="50" y="${113 + i * 40}" font-size="13" fill="${i === active ? '#fff' : MUTED}">${esc(n)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Segoe UI, Inter, Arial, sans-serif" role="img" aria-label="${esc(title)} — ${esc(heading)} (ilustração com dados fictícios)">
  <rect width="${w}" height="${h}" rx="18" fill="${INK}"/>
  <rect x="0" y="0" width="${w}" height="44" rx="18" fill="#0a101c"/><rect x="0" y="26" width="${w}" height="18" fill="#0a101c"/>
  <circle cx="24" cy="22" r="6" fill="#ff6b6b"/><circle cx="44" cy="22" r="6" fill="#ffd166"/><circle cx="64" cy="22" r="6" fill="#2fd8a4"/>
  <rect x="${w / 2 - 150}" y="12" width="300" height="20" rx="10" fill="#151e31"/>
  <text x="${w / 2}" y="26" font-size="11" fill="${MUTED}" text-anchor="middle">${esc(title.toLowerCase())}.demo — dados fictícios</text>
  <rect x="0" y="44" width="208" height="${h - 44}" fill="#0f1626"/>
  <rect x="20" y="58" width="22" height="22" rx="6" fill="${accent}"/>
  <text x="50" y="74" font-size="15" font-weight="700" fill="#fff">${esc(title)}</text>
  ${navItems}
  <text x="236" y="86" font-size="20" font-weight="700" fill="#fff">${esc(heading)}</text>
  <rect x="${w - 140}" y="68" width="112" height="26" rx="8" fill="${accent}"/>
  <text x="${w - 84}" y="85" font-size="12" font-weight="700" fill="${INK}" text-anchor="middle">+ Novo</text>
  ${body}
</svg>`;
}

function kpiRow(items, accent, y = 112) {
  const cw = (960 - 236 - 28 - (items.length - 1) * 14) / items.length;
  return items.map(([label, value], i) => {
    const x = 236 + i * (cw + 14);
    return `<rect x="${x}" y="${y}" width="${cw}" height="78" rx="12" fill="${PANEL}" stroke="${LINE}"/>
      <text x="${x + 16}" y="${y + 28}" font-size="11" fill="${MUTED}" letter-spacing=".5">${esc(label.toUpperCase())}</text>
      <text x="${x + 16}" y="${y + 60}" font-size="24" font-weight="700" fill="${i === 0 ? accent : '#fff'}">${esc(value)}</text>`;
  }).join('');
}

function tableBlock(cols, rows, accent, y = 210, tags = []) {
  const x0 = 236;
  const width = 960 - x0 - 28;
  const colW = width / cols.length;
  const head = cols.map((c, i) => `<text x="${x0 + 18 + i * colW}" y="${y + 30}" font-size="11" fill="${MUTED}" letter-spacing=".5">${esc(c.toUpperCase())}</text>`).join('');
  const body = rows.map((r, ri) => {
    const ry = y + 46 + ri * 40;
    return `<line x1="${x0}" x2="${x0 + width}" y1="${ry}" y2="${ry}" stroke="${LINE}"/>` + r.map((cell, ci) => {
      const tx = x0 + 18 + ci * colW;
      const tag = tags[ri] && ci === r.length - 1 ? tags[ri] : null;
      if (tag) {
        const color = { ok: '#2fd8a4', warn: '#ffd166', bad: '#ff8a8a', info: '#9bbcff' }[tag];
        return `<rect x="${tx - 6}" y="${ry + 11}" width="${Math.max(70, cell.length * 7 + 18)}" height="20" rx="10" fill="${color}" fill-opacity=".16"/><text x="${tx + 4}" y="${ry + 25}" font-size="11" font-weight="600" fill="${color}">${esc(cell)}</text>`;
      }
      return `<text x="${tx}" y="${ry + 26}" font-size="13" fill="${ci === 0 ? '#fff' : TEXT}">${esc(cell)}</text>`;
    }).join('');
  }).join('');
  const hgt = 46 + rows.length * 40 + 8;
  return `<rect x="${x0}" y="${y}" width="${width}" height="${hgt}" rx="12" fill="${PANEL}" stroke="${LINE}"/>${head}${body}`;
}

function barChart(values, labels, accent, y = 210, title = '') {
  const x0 = 236;
  const width = 960 - x0 - 28;
  const hgt = 330;
  const max = Math.max(...values);
  const bw = (width - 60) / values.length;
  const bars = values.map((v, i) => {
    const bh = (v / max) * (hgt - 90);
    const bx = x0 + 30 + i * bw + bw * 0.2;
    return `<rect x="${bx}" y="${y + hgt - 36 - bh}" width="${bw * 0.6}" height="${bh}" rx="6" fill="${accent}" fill-opacity="${0.45 + (i / values.length) * 0.55}"/>
      <text x="${bx + bw * 0.3}" y="${y + hgt - 14}" font-size="11" fill="${MUTED}" text-anchor="middle">${esc(labels[i])}</text>`;
  }).join('');
  const grid = [0.25, 0.5, 0.75].map((g) => `<line x1="${x0 + 20}" x2="${x0 + width - 20}" y1="${y + 54 + (hgt - 90) * g}" y2="${y + 54 + (hgt - 90) * g}" stroke="${LINE}" stroke-dasharray="4 6"/>`).join('');
  return `<rect x="${x0}" y="${y}" width="${width}" height="${hgt}" rx="12" fill="${PANEL}" stroke="${LINE}"/>
    <text x="${x0 + 18}" y="${y + 30}" font-size="13" font-weight="600" fill="#fff">${esc(title)}</text>${grid}${bars}`;
}

function calendar(accent, y = 112, events = {}) {
  const x0 = 236;
  const width = 960 - x0 - 28;
  const cw = width / 7;
  const ch = 66;
  const days = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
  let out = `<rect x="${x0}" y="${y}" width="${width}" height="${ch * 6 + 40}" rx="12" fill="${PANEL}" stroke="${LINE}"/>`;
  days.forEach((d, i) => { out += `<text x="${x0 + i * cw + cw / 2}" y="${y + 26}" font-size="11" fill="${MUTED}" text-anchor="middle">${d}</text>`; });
  for (let i = 0; i < 35; i++) {
    const cx = x0 + (i % 7) * cw;
    const cy = y + 40 + Math.floor(i / 7) * ch;
    out += `<rect x="${cx + 4}" y="${cy + 4}" width="${cw - 8}" height="${ch - 8}" rx="8" fill="#0f1626"/>
      <text x="${cx + 14}" y="${cy + 22}" font-size="11" fill="${MUTED}">${(i % 31) + 1}</text>`;
    if (events[i]) {
      const [label, tone] = events[i];
      const color = tone === 'warn' ? '#ffd166' : accent;
      out += `<rect x="${cx + 10}" y="${cy + 32}" width="${cw - 20}" height="20" rx="6" fill="${color}" fill-opacity=".2"/><text x="${cx + 16}" y="${cy + 46}" font-size="10" font-weight="600" fill="${color}">${esc(label)}</text>`;
    }
  }
  return out;
}

const C = { churchflow: '#7c9cff', spacecontrol: '#2fd8a4', fleetmanager: '#ffb547' };
const NAV = {
  churchflow: ['Painel', 'Membros', 'Voluntários', 'Escalas', 'Eventos', 'Relatórios'],
  spacecontrol: ['Painel', 'Reservas', 'Espaços', 'Locatários', 'Checklist', 'Inventário'],
  fleetmanager: ['Painel', 'Veículos', 'Manutenções', 'Abastecimentos', 'Documentos', 'Custos']
};

const IMAGES = {
  'churchflow-capa': () => frame({ title: 'ChurchFlow', accent: C.churchflow, nav: NAV.churchflow, heading: 'Visão geral', body:
    kpiRow([['Membros', '248'], ['Voluntários', '64'], ['Eventos no mês', '12'], ['Pendentes', '7']], C.churchflow)
    + tableBlock(['Evento', 'Data', 'Equipe', 'Situação'], [['Encontro de domingo', '02/nov', 'Recepção', 'Confirmado'], ['Ensaio geral', '04/nov', 'Louvor', 'Pendente'], ['Ação social', '09/nov', 'Infantil', 'Confirmado'], ['Reunião de líderes', '12/nov', 'Coordenação', 'Pendente']], C.churchflow, 210, ['ok', 'warn', 'ok', 'warn']) }),
  'churchflow-escalas': () => frame({ title: 'ChurchFlow', accent: C.churchflow, nav: NAV.churchflow, active: 3, heading: 'Escalas de serviço', body:
    tableBlock(['Voluntário', 'Função', 'Evento', 'Confirmação'], [['Voluntário A', 'Recepção', 'Domingo 18h', 'Confirmado'], ['Voluntário B', 'Som', 'Domingo 18h', 'Pendente'], ['Voluntário C', 'Mídia', 'Domingo 18h', 'Confirmado'], ['Voluntário D', 'Infantil', 'Sábado 9h', 'Recusado'], ['Voluntário E', 'Recepção', 'Sábado 9h', 'Pendente'], ['Voluntário F', 'Louvor', 'Quarta 20h', 'Confirmado']], C.churchflow, 112, ['ok', 'warn', 'ok', 'bad', 'warn', 'ok']) }),
  'churchflow-membros': () => frame({ title: 'ChurchFlow', accent: C.churchflow, nav: NAV.churchflow, active: 1, heading: 'Membros e visitantes', body:
    kpiRow([['Membros', '248'], ['Visitantes (30d)', '19'], ['Novos cadastros', '6']], C.churchflow)
    + tableBlock(['Nome', 'Tipo', 'Desde', 'Situação'], [['Pessoa Exemplo 01', 'Membro', '2019', 'Ativo'], ['Pessoa Exemplo 02', 'Visitante', '2026', 'Acompanhar'], ['Pessoa Exemplo 03', 'Membro', '2021', 'Ativo'], ['Pessoa Exemplo 04', 'Visitante', '2026', 'Acompanhar']], C.churchflow, 210, ['ok', 'info', 'ok', 'info']) }),
  'churchflow-relatorios': () => frame({ title: 'ChurchFlow', accent: C.churchflow, nav: NAV.churchflow, active: 5, heading: 'Relatórios', body:
    kpiRow([['Participação média', '82%'], ['Escalas no trimestre', '146'], ['Equipes', '9']], C.churchflow)
    + barChart([62, 70, 66, 78, 84, 81, 88], ['mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov'], C.churchflow, 210, 'Participação nas escalas (%)') }),

  'spacecontrol-capa': () => frame({ title: 'SpaceControl', accent: C.spacecontrol, nav: NAV.spacecontrol, heading: 'Agenda de reservas', body:
    calendar(C.spacecontrol, 112, { 3: ['Salão', 'ok'], 5: ['Sala A'], 9: ['Gourmet'], 12: ['Salão'], 13: ['Sala A', 'warn'], 18: ['Salão'], 22: ['Gourmet'], 26: ['Sala A'], 30: ['Salão'] }) }),
  'spacecontrol-agenda': () => frame({ title: 'SpaceControl', accent: C.spacecontrol, nav: NAV.spacecontrol, active: 1, heading: 'Reservas', body:
    kpiRow([['Reservas no mês', '23'], ['Ocupação', '68%'], ['A devolver', '2']], C.spacecontrol)
    + tableBlock(['Espaço', 'Data', 'Contrato', 'Situação'], [['Salão Principal', '03/nov', 'CT-0041', 'Confirmada'], ['Sala de Reuniões A', '04/nov', 'CT-0042', 'Confirmada'], ['Espaço Gourmet', '01/nov', 'CT-0039', 'A devolver'], ['Salão Principal', '10/nov', 'CT-0044', 'Pré-reserva']], C.spacecontrol, 210, ['ok', 'ok', 'warn', 'info']) }),
  'spacecontrol-checklist': () => frame({ title: 'SpaceControl', accent: C.spacecontrol, nav: NAV.spacecontrol, active: 4, heading: 'Checklist de devolução — CT-0039', body:
    tableBlock(['Item', 'Entregue', 'Devolvido', 'Situação'], [['Cadeira', '40', '40', 'OK'], ['Mesa redonda', '6', '6', 'OK'], ['Taça de vidro', '60', '57', '3 avarias'], ['Toalha de mesa', '8', '7', '1 faltante']], C.spacecontrol, 112, ['ok', 'ok', 'bad', 'warn'])
    + `<rect x="236" y="342" width="696" height="70" rx="12" fill="#131c2e" stroke="#22304a"/><text x="254" y="372" font-size="12" fill="#8792a8">COBRANÇA ADICIONAL CALCULADA</text><text x="254" y="398" font-size="20" font-weight="700" fill="#ffd166">R$ 99,00</text>` }),
  'spacecontrol-inventario': () => frame({ title: 'SpaceControl', accent: C.spacecontrol, nav: NAV.spacecontrol, active: 5, heading: 'Inventário de utensílios', body:
    tableBlock(['Item', 'Espaço', 'Quantidade', 'Estado'], [['Cadeira', 'Salão Principal', '120', 'Bom'], ['Mesa redonda', 'Salão Principal', '15', 'Bom'], ['Projetor', 'Sala A', '1', 'Revisar'], ['Taça de vidro', 'Gourmet', '57', 'Repor 3'], ['Toalha de mesa', 'Salão Principal', '19', 'Repor 1']], C.spacecontrol, 112, ['ok', 'ok', 'warn', 'bad', 'bad']) }),

  'fleetmanager-capa': () => frame({ title: 'FleetManager', accent: C.fleetmanager, nav: NAV.fleetmanager, heading: 'Painel da frota', body:
    kpiRow([['Veículos ativos', '18'], ['Alertas', '4'], ['Consumo médio', '9,8 km/l'], ['Custo/km', 'R$ 1,42']], C.fleetmanager)
    + barChart([42, 38, 51, 47, 44, 53, 49, 46], ['A01', 'B02', 'C03', 'D04', 'E05', 'F06', 'G07', 'H08'], C.fleetmanager, 210, 'Custo operacional por veículo (R$ mil)') }),
  'fleetmanager-painel': () => frame({ title: 'FleetManager', accent: C.fleetmanager, nav: NAV.fleetmanager, heading: 'Indicadores', body:
    kpiRow([['Disponibilidade', '94%'], ['Em manutenção', '1'], ['Documentos a vencer', '2']], C.fleetmanager)
    + barChart([9.1, 9.4, 9.8, 9.6, 10.1, 9.9], ['jun', 'jul', 'ago', 'set', 'out', 'nov'], C.fleetmanager, 210, 'Consumo médio da frota (km/l)') }),
  'fleetmanager-manutencao': () => frame({ title: 'FleetManager', accent: C.fleetmanager, nav: NAV.fleetmanager, active: 2, heading: 'Alertas de manutenção', body:
    tableBlock(['Equipamento', 'Leitura', 'Próxima revisão', 'Alerta'], [['AAA-0A01', '48.210 km', '50.000 km', 'Em 1.790 km'], ['AAA-0B02', '131.400 km', '130.000 km', 'Atrasada'], ['MAQ-0003', '3.920 h', '4.000 h', 'Em 80 h'], ['AAA-0D04', '22.050 km', '30.000 km', 'Em dia']], C.fleetmanager, 112, ['warn', 'bad', 'warn', 'ok']) }),
  'fleetmanager-abastecimento': () => frame({ title: 'FleetManager', accent: C.fleetmanager, nav: NAV.fleetmanager, active: 3, heading: 'Abastecimentos', body:
    tableBlock(['Data', 'Veículo', 'Litros', 'Valor'], [['28/out', 'AAA-0A01', '40,2', 'R$ 251,20'], ['26/out', 'AAA-0B02', '180,0', 'R$ 1.098,00'], ['21/out', 'AAA-0A01', '42,5', 'R$ 263,50'], ['19/out', 'AAA-0D04', '38,7', 'R$ 240,90'], ['15/out', 'AAA-0B02', '176,4', 'R$ 1.076,00']], C.fleetmanager, 112) })
};

function hero() {
  const accent = '#2fd8a4';
  return frame({ title: 'Painel', accent, nav: ['Visão geral', 'Cadastros', 'Operações', 'Financeiro', 'Relatórios', 'Configurações'], heading: 'Visão geral', w: 960, h: 640, body:
    kpiRow([['Registros', '1.284'], ['Pendências', '12'], ['Concluídos', '96%']], accent)
    + barChart([30, 42, 38, 55, 61, 58, 72, 80], ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'], accent, 210, 'Evolução semanal (ilustrativo)')
    + `<rect x="236" y="556" width="696" height="56" rx="12" fill="#131c2e" stroke="#22304a"/><circle cx="262" cy="584" r="8" fill="${accent}"/><text x="282" y="589" font-size="13" fill="#e6ebf3">Fluxo concluído • atualização registrada no histórico</text>` });
}

const placeholder = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 600" width="960" height="600"><rect width="960" height="600" fill="${INK}"/><g fill="none" stroke="#2fd8a4" stroke-width="6" opacity=".7"><rect x="390" y="230" width="180" height="130" rx="16"/><path d="M420 330l40-45 30 30 25-20 25 35"/></g><text x="480" y="410" fill="${MUTED}" font-family="Segoe UI, Arial" font-size="18" text-anchor="middle">Imagem não definida</text></svg>`;

// Identidade PROVISÓRIA: sem logotipo, apenas a paleta (azul #0EA5E9, roxo #8B5CF6, azul-marinho #0F172A).
// Substitua o favicon e a imagem Open Graph quando a marca definitiva estiver pronta.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0EA5E9"/><stop offset="1" stop-color="#8B5CF6"/></linearGradient></defs><rect x="1" y="1" width="30" height="30" rx="9" fill="#0F172A"/><rect x="7" y="7" width="18" height="18" rx="5" fill="url(#f)"/></svg>`;

const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630" font-family="Montserrat, Segoe UI, Arial, sans-serif">
  <defs>
    <radialGradient id="g1" cx="90%" cy="0%" r="75%"><stop offset="0" stop-color="#8B5CF6" stop-opacity=".45"/><stop offset="1" stop-color="#0F172A" stop-opacity="0"/></radialGradient>
    <radialGradient id="g2" cx="5%" cy="5%" r="60%"><stop offset="0" stop-color="#0EA5E9" stop-opacity=".25"/><stop offset="1" stop-color="#0F172A" stop-opacity="0"/></radialGradient>
    <linearGradient id="t" x1="0" x2="1"><stop offset="0" stop-color="#0EA5E9"/><stop offset="1" stop-color="#8B5CF6"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="#0F172A"/><rect width="1200" height="630" fill="url(#g1)"/><rect width="1200" height="630" fill="url(#g2)"/>
  <rect x="80" y="150" width="96" height="6" rx="3" fill="url(#t)"/>
  <text x="80" y="270" font-size="68" font-weight="700" fill="#F8FAFC">Transformamos ideias</text>
  <text x="80" y="355" font-size="68" font-weight="700" fill="url(#t)">em soluções digitais</text>
  <text x="80" y="440" font-size="28" fill="#CBD5E1">Sistemas sob medida • plataformas web • gestão • automações • integrações</text>
</svg>`;

await mkdir(path.join(OUT, 'produtos'), { recursive: true });
await mkdir(path.join(root, 'frontend', 'public', 'assets', 'icons'), { recursive: true });
for (const [name, fn] of Object.entries(IMAGES)) await writeFile(path.join(OUT, 'produtos', `${name}.svg`), fn());
await writeFile(path.join(OUT, 'produtos', 'sistemas-personalizados-capa.svg'), frame({
  title: 'Sob medida', accent: '#c792ff', nav: ['Requisitos', 'Protótipo', 'Desenvolvimento', 'Testes', 'Implantação', 'Suporte'], active: 0, heading: 'Levantamento de requisitos', body:
    tableBlock(['Etapa', 'Entregável', 'Responsável', 'Situação'], [['Entendimento', 'Mapa do processo', 'Equipe', 'Concluído'], ['Requisitos', 'Documento de escopo', 'Equipe + cliente', 'Em validação'], ['Protótipo', 'Telas navegáveis', 'Equipe', 'Planejado'], ['Proposta', 'Orçamento formal', 'Equipe', 'Planejado']], '#c792ff', 112, ['ok', 'warn', 'info', 'info'])
}));
await writeFile(path.join(OUT, 'produtos', 'placeholder.svg'), placeholder);
await writeFile(path.join(OUT, 'hero-dashboard.svg'), hero());
await writeFile(path.join(root, 'frontend', 'public', 'assets', 'icons', 'favicon.svg'), favicon);
await writeFile(path.join(OUT, 'og-default.svg'), og);

try {
  const sharp = (await import('sharp')).default;
  await sharp(Buffer.from(og)).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'og-default.png'));
  console.log('og-default.png gerado.');
} catch (err) {
  console.warn(`sharp indisponível (${err.message}); og-default.png não foi gerado.`);
}
console.log(`Imagens geradas em ${OUT}`);
