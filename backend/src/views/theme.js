// Tema do site, do painel e da área do cliente a partir das três cores configuradas no painel.
// As cores são livres, então os tons usados como texto e o texto sobre a cor de destaque são
// calculados aqui para manter contraste AA (4,5:1) sobre o papel, seja qual for a escolha.

export const DEFAULT_COLORS = Object.freeze({ primaria: '#12233D', destaque: '#C8401E', secundaria: '#1D5F8A' });
export const PAPER = '#F3F5F7';
const WHITE = '#FFFFFF';
const HEX = /^#[0-9a-f]{6}$/i;

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

export function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Mistura `hex` com `towards` em passos até atingir `min` de contraste contra `bg` (ou desistir no limite). */
export function readableOn(hex, bg, min = 4.5, towards = '#000000') {
  const from = toRgb(hex);
  const to = toRgb(towards);
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = toHex(from.map((v, i) => v + (to[i] - v) * t));
    if (contrast(c, bg) >= min) return c;
  }
  return towards.toUpperCase();
}

const pick = (v, d) => (HEX.test(v || '') ? v.toUpperCase() : d);

/** Variáveis CSS do tema. Os nomes --brand-* são a API pública de brand.css. */
export function themeVariables(settings = {}) {
  const primaria = pick(settings.cor_primaria, DEFAULT_COLORS.primaria);
  const destaque = pick(settings.cor_destaque, DEFAULT_COLORS.destaque);
  const secundaria = pick(settings.cor_secundaria, DEFAULT_COLORS.secundaria);
  // A tinta precisa ser escura: com uma cor primária clara, o texto usa a versão escurecida dela.
  const ink = readableOn(primaria, PAPER, 9);
  const onAccent = contrast(WHITE, destaque) >= contrast(ink, destaque) ? WHITE : ink;
  return {
    '--brand-ink': ink,
    '--brand-accent': destaque,
    '--brand-on-accent': onAccent,
    '--brand-accent-text': readableOn(destaque, WHITE, 4.5, ink),
    '--brand-line': secundaria,
    '--brand-line-text': readableOn(secundaria, WHITE, 4.5, ink)
  };
}

export const themeCss = (settings) => `:root{${Object.entries(themeVariables(settings)).map(([k, v]) => `${k}:${v};`).join('')}}\n`;
