// Padronização automática de logomarcas para a seção "Empresas que confiam em nossas soluções".
//
// Recebe a logo em qualquer formato aceito (PNG, JPG, WebP ou SVG), em qualquer proporção, com
// ou sem fundo, e gera duas imagens WebP com dimensões IDÊNTICAS para todas as marcas:
//
//   - mono: marca em branco com transparência, preservando detalhes internos (letras vazadas,
//           símbolos e partes coloridas viram tons do mesmo branco, em vez de uma silhueta chapada);
//   - cor:  marca original, sem o fundo, no mesmo enquadramento (usada ao passar o mouse).
//
// Etapas: leitura segura (SVG validado e convertido em bitmap; nunca é publicado) → remoção de
// fundo sólido → recorte das bordas vazias → escala com "peso visual" equivalente (uma marca
// quadrada não domina uma horizontal) → centralização em área padrão com margens → WebP.
import { detectType } from '../media/file-type.js';

let sharp = null;
try { sharp = (await import('sharp')).default; } catch { sharp = null; }

export const LOGO_CANVAS = Object.freeze({ width: 480, height: 240 });
export const LOGO_TYPES = Object.freeze({
  png: { mime: 'image/png', exts: ['png'] },
  jpg: { mime: 'image/jpeg', exts: ['jpg', 'jpeg'] },
  webp: { mime: 'image/webp', exts: ['webp'] },
  svg: { mime: 'image/svg+xml', exts: ['svg'] }
});

const MAX_INPUT_PIXELS = 40_000_000;
const MAX_SIDE = 10_000;
const MIN_SIDE = 16;
const WORK_MAX = 1600;          // resolução de trabalho (suficiente para a área final de 480×240)
const SVG_MAX_BYTES = 1024 * 1024;
const ALPHA_VISIBLE = 20;       // alfa mínimo considerado parte da marca no recorte
const EDGE_PROBE = 3;          // pixels examinados além da borda de um branco (anel serrilhado)

export class LogoError extends Error {}

export const isLogoProcessingAvailable = () => Boolean(sharp);

// ------------------------------------------------------------------ tipo e SVG seguro
/** Tipo real do arquivo pelo conteúdo (a extensão e o Content-Type não são confiáveis). */
export function detectLogoType(buffer) {
  const t = detectType(buffer);
  if (t && LOGO_TYPES[t]) return t;
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;
  const head = buffer.toString('utf8', 0, Math.min(buffer.length, 4096)).replace(/^﻿/, '');
  return /^\s*(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[\s\S]*?>\s*)*<svg[\s>]/i.test(head) ? 'svg' : null;
}

const SVG_FORBIDDEN = [
  [/<!DOCTYPE|<!ENTITY/i, 'declarações DOCTYPE/ENTITY'],
  [/<\?xml-stylesheet/i, 'folhas de estilo externas'],
  [/<\s*script/i, 'scripts'],
  [/<\s*(foreignObject|iframe|embed|object|audio|video|canvas|handler|listener)\b/i, 'conteúdo incorporado'],
  [/\son[a-z]+\s*=/i, 'atributos de evento (on...)'],
  [/javascript:|vbscript:/i, 'links executáveis'],
  [/@import/i, 'importação de estilos'],
  // Referências só podem apontar para o próprio arquivo (#id) ou para bitmap embutido.
  [/\b(?:xlink:)?href\s*=\s*["']\s*(?!#|data:image\/(?:png|jpe?g|webp|gif);base64,)/i, 'referências a arquivos ou endereços externos'],
  [/url\(\s*["']?\s*(?!#|data:image\/(?:png|jpe?g|webp|gif);base64,)/i, 'referências a arquivos ou endereços externos']
];

/**
 * O SVG nunca é publicado: ele só é aceito se não tiver nada além de desenho e é convertido
 * em bitmap. Qualquer construção capaz de executar código ou buscar recursos é recusada.
 */
export function assertSafeSvg(buffer) {
  if (buffer.length > SVG_MAX_BYTES) throw new LogoError('SVG acima de 1 MB.');
  const text = buffer.toString('utf8');
  if (text.includes('\u0000') || text.includes('�')) throw new LogoError('SVG com codificação inválida.');
  for (const [re, what] of SVG_FORBIDDEN) {
    if (re.test(text)) throw new LogoError(`SVG recusado por segurança: contém ${what}. Exporte a logo novamente como SVG simples ou envie PNG.`);
  }
}

// ------------------------------------------------------------------ utilitários de pixel
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

async function loadRaster(buffer, type) {
  const opts = { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS };
  let meta;
  try {
    if (type === 'svg') {
      // Rasteriza com densidade suficiente para ~2000 px no maior lado.
      const base = await sharp(buffer, opts).metadata();
      const side = Math.max(base.width || 0, base.height || 0) || 300;
      opts.density = Math.min(2400, Math.max(72, Math.round((72 * 2000) / side)));
    }
    meta = await sharp(buffer, opts).metadata();
  } catch {
    throw new LogoError('Não foi possível ler a imagem. O arquivo pode estar corrompido.');
  }
  const swap = (meta.orientation || 1) >= 5;
  const width = swap ? meta.height : meta.width;
  const height = swap ? meta.width : meta.height;
  if (!width || !height) throw new LogoError('Imagem sem dimensões válidas.');
  if (type !== 'svg' && (width > MAX_SIDE || height > MAX_SIDE)) throw new LogoError(`Imagem grande demais (máximo ${MAX_SIDE} px por lado).`);
  if (type !== 'svg' && (width < MIN_SIDE || height < MIN_SIDE)) throw new LogoError(`Imagem pequena demais (mínimo ${MIN_SIDE} px por lado).`);

  let out;
  try {
    out = await sharp(buffer, opts).rotate()
      .resize({ width: WORK_MAX, height: WORK_MAX, fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch {
    throw new LogoError('Não foi possível processar a imagem.');
  }
  const { data, info } = out;
  if (info.channels !== 4 || data.length !== info.width * info.height * 4) throw new LogoError('Formato de cor não suportado.');
  return { px: data, w: info.width, h: info.height, originalWidth: width, originalHeight: height };
}

/**
 * Remove fundo liso (comum em JPG): se a borda da imagem tem uma cor predominante, ela vira
 * transparente, com transição suave e "descontaminação" das bordas serrilhadas.
 */
export function removeSolidBackground(px, w, h) {
  const samples = [];
  const step = Math.max(1, Math.floor((2 * (w + h)) / 4000));
  const take = (x, y) => { const i = (y * w + x) * 4; samples.push(i); };
  for (let x = 0; x < w; x += step) { take(x, 0); take(x, h - 1); }
  for (let y = 0; y < h; y += step) { take(0, y); take(w - 1, y); }

  const transparent = samples.filter((i) => px[i + 3] < 128).length;
  if (transparent / samples.length > 0.5) return { fundo: 'transparente' };
  const opaque = samples.filter((i) => px[i + 3] >= 128);
  const median = (ch) => { const v = opaque.map((i) => px[i + ch]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const bg = [median(0), median(1), median(2)];
  const dist = (i) => Math.hypot(px[i] - bg[0], px[i + 1] - bg[1], px[i + 2] - bg[2]);
  const uniform = opaque.filter((i) => dist(i) <= 40).length / opaque.length;
  if (uniform < 0.8) return { fundo: 'mantido' };

  for (let i = 0; i < px.length; i += 4) {
    const f = smoothstep(14, 56, dist(i));
    if (f >= 1) continue;
    if (f > 0) for (let c = 0; c < 3; c++) px[i + c] = Math.round(Math.min(255, Math.max(0, (px[i + c] - (1 - f) * bg[c]) / f)));
    px[i + 3] = Math.round(px[i + 3] * f);
  }
  const hex = `#${bg.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  return { fundo: 'removido', cor_fundo: hex };
}

/** Caixa delimitadora da parte visível (ignora bordas transparentes). */
export function visibleBox(px, w, h, threshold = ALPHA_VISIBLE) {
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function crop(px, w, box) {
  const out = Buffer.alloc(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) px.copy(out, y * box.w * 4, ((box.y + y) * w + box.x) * 4, ((box.y + y) * w + box.x + box.w) * 4);
  return out;
}

/**
 * Áreas quase brancas que encostam no fundo transparente são parte da marca (ex.: texto branco
 * de uma logo feita para fundo escuro). Só as cercadas pela própria marca são espaço vazado
 * (ex.: a letra branca dentro de um círculo colorido). Retorna, por pixel, 1 = branco da marca.
 */
function whiteInkMask(px, w, h, whiteish) {
  const n = w * h;
  const inMask = (p) => whiteish[p] > 0.5 && px[p * 4 + 3] > 127;
  const label = new Int32Array(n).fill(-1);
  const keep = new Uint8Array(n);
  const queue = new Int32Array(n);
  const members = [];
  // A borda serrilhada (principalmente de JPG) deixa um anel fino e semitransparente entre o
  // branco e o fundo removido; olhar alguns pixels adiante evita confundi-lo com "marca ao redor".
  const touchesClear = (x, y, dx, dy) => {
    for (let k = 1; k <= EDGE_PROBE; k++) {
      const nx = x + dx * k; const ny = y + dy * k;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return true;
      const q = ny * w + nx;
      if (px[q * 4 + 3] < 128) return true;
      if (k > 1 && inMask(q)) return false;
    }
    return false;
  };
  for (let start = 0; start < n; start++) {
    if (label[start] !== -1 || !inMask(start)) continue;
    let head = 0; let tail = 0; let open = 0; let closed = 0;
    queue[tail++] = start; label[start] = start; members.length = 0;
    while (head < tail) {
      const p = queue[head++];
      members.push(p);
      const x = p % w; const y = (p / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) { open++; continue; }
        const q = ny * w + nx;
        if (inMask(q)) { if (label[q] === -1) { label[q] = start; queue[tail++] = q; } } else if (touchesClear(x, y, dx, dy)) open++; else closed++;
      }
    }
    if (open / Math.max(1, open + closed) > 0.3) for (const p of members) keep[p] = 1;
  }
  // Bordas suavizadas (serrilhado) vizinhas de um branco da marca também pertencem a ele.
  const out = new Uint8Array(keep);
  for (let p = 0; p < n; p++) {
    if (keep[p] || !whiteish[p]) continue;
    const x = p % w; const y = (p / w) | 0;
    for (let dy = -1; dy <= 1 && !out[p]; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx; const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && keep[ny * w + nx]) { out[p] = 1; break; }
      }
    }
  }
  return out;
}

/**
 * Versão monocromática legível. Em vez de pintar todo pixel visível (o que transformaria
 * "letras brancas dentro de um círculo azul" num círculo chapado), o tratamento:
 *   1. considera as áreas quase brancas cercadas pela marca como espaço vazado;
 *   2. converte as demais cores em tons do mesmo branco, do mais forte (cores mais escuras)
 *      ao mais suave (mínimo de 55%), mantendo símbolo e texto distinguíveis;
 *   3. se a marca é toda clara (feita para fundo escuro), usa a forma inteira e a luminosidade.
 */
export function toMonochrome(px, w, h) {
  const n = w * h;
  const ink = new Float32Array(n);
  const tone = new Float32Array(n);
  const whiteish = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (!px[i + 3]) continue;
    const r = px[i] / 255; const g = px[i + 1] / 255; const b = px[i + 2] / 255;
    tone[p] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    whiteish[p] = smoothstep(0.78, 0.94, tone[p]) * (1 - smoothstep(0.1, 0.28, Math.max(r, g, b) - Math.min(r, g, b)));
  }
  const whiteInk = whiteInkMask(px, w, h, whiteish);
  let sumA = 0;
  let sumColor = 0; // tinta que não é branca: decide se a marca é "toda clara"
  for (let p = 0; p < n; p++) {
    const a = px[p * 4 + 3] / 255;
    if (!a) continue;
    ink[p] = a * (whiteInk[p] ? 1 : 1 - whiteish[p]);
    sumA += a;
    sumColor += a * (1 - whiteish[p]);
  }
  const modo = sumA && sumColor / sumA < 0.15 ? 'claro' : 'escuro';
  if (modo === 'claro') for (let p = 0; p < n; p++) ink[p] = px[p * 4 + 3] / 255;
  // Intensidade: escuras mais fortes no modo "escuro" (o branco da marca conta como forte);
  // claras mais fortes no modo "claro".
  const weightOf = (p) => (modo === 'claro' ? tone[p] : whiteInk[p] ? 1 : 1 - tone[p]);

  // Percentis 10/90 ponderados pela tinta, para normalizar o contraste entre as cores da marca.
  const bins = new Float64Array(101);
  let total = 0;
  for (let p = 0; p < n; p++) if (ink[p] > 0.05) { bins[Math.round(weightOf(p) * 100)] += ink[p]; total += ink[p]; }
  const pct = (q) => { let acc = 0; for (let k = 0; k <= 100; k++) { acc += bins[k]; if (acc >= q * total) return k / 100; } return 1; };
  const lo = pct(0.1);
  const hi = pct(0.9);
  const range = hi - lo;

  const out = Buffer.alloc(n * 4);
  let coverage = 0;
  for (let p = 0; p < n; p++) {
    const factor = range < 0.12 ? 1 : 0.55 + 0.45 * clamp01((weightOf(p) - lo) / range);
    const alpha = Math.round(255 * ink[p] * factor);
    out[p * 4] = 255; out[p * 4 + 1] = 255; out[p * 4 + 2] = 255; out[p * 4 + 3] = alpha;
    coverage += alpha;
  }
  return { px: out, modo, cobertura: coverage / (255 * n) };
}

/**
 * Escala com "peso visual" equivalente: limita largura e altura à área útil e aproxima a ÁREA
 * ocupada de um alvo comum, compensando marcas muito densas ou muito finas.
 */
export function placement(w, h, density) {
  const { width: W, height: H } = LOGO_CANVAS;
  const maxW = W * 0.84;
  const maxH = H * 0.6;
  const target = W * H * 0.2;
  let s = Math.min(maxW / w, maxH / h, Math.sqrt(target / (w * h)));
  const dens = Math.min(1, Math.max(0.05, density));
  s *= Math.min(1.12, Math.max(0.9, (0.5 / dens) ** 0.15));
  s = Math.min(s, maxW / w, maxH / h);
  const tw = Math.max(1, Math.round(w * s));
  const th = Math.max(1, Math.round(h * s));
  const left = Math.floor((W - tw) / 2);
  const top = Math.floor((H - th) / 2);
  return { tw, th, left, top, right: W - tw - left, bottom: H - th - top };
}

async function compose(px, w, h, pos) {
  return sharp(px, { raw: { width: w, height: h, channels: 4 } })
    .resize(pos.tw, pos.th, { fit: 'fill', kernel: 'lanczos3' })
    .extend({ top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 90, alphaQuality: 100, effort: 5 })
    .toBuffer();
}

/**
 * @param {Buffer} buffer arquivo enviado
 * @param {string} type   'png' | 'jpg' | 'webp' | 'svg' (de detectLogoType)
 * @returns {Promise<{ mono: Buffer, cor: Buffer, original: { width, height }, info: object }>}
 */
export async function processLogo(buffer, type) {
  if (!sharp) throw new LogoError('O processamento de imagens (módulo sharp) não está instalado no servidor. Execute "npm ci" sem omitir dependências opcionais.');
  if (!LOGO_TYPES[type]) throw new LogoError('Tipo de imagem não suportado.');
  if (type === 'svg') assertSafeSvg(buffer);

  const { px, w, h, originalWidth, originalHeight } = await loadRaster(buffer, type);
  const bg = removeSolidBackground(px, w, h);
  const box = visibleBox(px, w, h);
  if (!box || box.w < 4 || box.h < 4) throw new LogoError('Não foi possível identificar a logomarca na imagem: ela parece vazia, transparente ou da mesma cor do fundo.');

  const cut = crop(px, w, box);
  let alphaSum = 0;
  for (let i = 3; i < cut.length; i += 4) alphaSum += cut[i];
  const density = alphaSum / (255 * box.w * box.h);
  const mono = toMonochrome(cut, box.w, box.h);
  const pos = placement(box.w, box.h, density);
  const [monoOut, corOut] = await Promise.all([compose(mono.px, box.w, box.h, pos), compose(cut, box.w, box.h, pos)]);

  // Fundo em que a versão colorida fica legível: marcas claras pedem fundo escuro.
  let lum = 0;
  for (let i = 0; i < cut.length; i += 4) lum += (cut[i + 3] / 255) * (0.2126 * cut[i] + 0.7152 * cut[i + 1] + 0.0722 * cut[i + 2]) / 255;
  const fundoColorida = alphaSum && lum / (alphaSum / 255) > 0.7 ? 'escuro' : 'claro';

  return {
    mono: monoOut,
    cor: corOut,
    original: { width: originalWidth, height: originalHeight },
    info: {
      versao: 1,
      tela: `${LOGO_CANVAS.width}x${LOGO_CANVAS.height}`,
      area_marca: `${pos.tw}x${pos.th}`,
      proporcao: Number((box.w / box.h).toFixed(3)),
      fundo: bg.fundo,
      ...(bg.cor_fundo ? { cor_fundo: bg.cor_fundo } : {}),
      modo_monocromatico: mono.modo,
      fundo_colorida: fundoColorida
    }
  };
}
