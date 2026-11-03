import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOGO_CANVAS, LogoError, isLogoProcessingAvailable, detectLogoType, assertSafeSvg, processLogo
} from '../../backend/src/modules/partners/logo-processor.js';

const skip = !isLogoProcessingAvailable() && 'sharp não instalado';
const sharp = isLogoProcessingAvailable() ? (await import('sharp')).default : null;

const svg = (body, attrs = 'width="300" height="100" viewBox="0 0 300 100"') => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`);

/** Logo sintética: retângulo colorido (opcionalmente com um furo branco) sobre fundo. */
async function raster({ width, height, bg, fg = '#1d4ed8', hole = false, format = 'png' }) {
  const box = `<rect x="${width * 0.2}" y="${height * 0.3}" width="${width * 0.6}" height="${height * 0.4}" fill="${fg}"/>`;
  const holeRect = hole ? `<rect x="${width * 0.4}" y="${height * 0.42}" width="${width * 0.2}" height="${height * 0.16}" fill="#ffffff"/>` : '';
  const bgRect = bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : '';
  const img = sharp(svg(`${bgRect}${box}${holeRect}`, `width="${width}" height="${height}"`));
  return format === 'jpg' ? img.flatten({ background: bg || '#ffffff' }).jpeg({ quality: 95 }).toBuffer() : img.png().toBuffer();
}

async function rawOf(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, ...info };
}
const alphaAt = (r, x, y) => r.data[(y * r.width + x) * 4 + 3];

describe('detecção e validação de SVG', () => {
  test('reconhece SVG pelo conteúdo, com ou sem declaração XML', () => {
    assert.equal(detectLogoType(svg('<circle cx="5" cy="5" r="4"/>')), 'svg');
    assert.equal(detectLogoType(Buffer.from('<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
    assert.equal(detectLogoType(Buffer.from('<html><body>oi</body></html>')), null);
    assert.equal(detectLogoType(Buffer.from('texto qualquer')), null);
  });

  test('bloqueia scripts, eventos, entidades e referências externas', () => {
    const bad = [
      '<script>alert(1)</script>',
      '<rect onload="alert(1)" width="5" height="5"/>',
      '<foreignObject><div>x</div></foreignObject>',
      '<image href="https://exemplo.com/a.png" width="5" height="5"/>',
      '<image xlink:href="file:///etc/passwd" width="5" height="5"/>',
      '<a href="javascript:alert(1)"><rect width="5" height="5"/></a>',
      '<style>@import url(https://exemplo.com/x.css);</style>',
      '<rect style="fill:url(https://exemplo.com/x)" width="5" height="5"/>'
    ];
    for (const body of bad) assert.throws(() => assertSafeSvg(svg(body)), LogoError, body);
    assert.throws(() => assertSafeSvg(Buffer.from('<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>')), LogoError);
  });

  test('aceita SVG comum com gradientes e referências internas', () => {
    assert.doesNotThrow(() => assertSafeSvg(svg('<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><rect fill="url(#g)" width="50" height="20"/><use href="#g"/>')));
  });
});

describe('padronização das logomarcas', { skip }, () => {
  test('qualquer proporção gera imagens com as mesmas dimensões', async () => {
    const inputs = [
      [await raster({ width: 900, height: 200, bg: '#ffffff', format: 'jpg' }), 'jpg'],
      [await raster({ width: 400, height: 400 }), 'png'],
      [await raster({ width: 200, height: 700, bg: '#ffffff' }), 'png'],
      [svg('<text x="10" y="70" font-size="60" fill="#e11d48">Marca</text>'), 'svg']
    ];
    for (const [buf, type] of inputs) {
      const r = await processLogo(buf, type);
      for (const out of [r.mono, r.cor]) {
        const meta = await sharp(out).metadata();
        assert.equal(meta.format, 'webp');
        assert.equal(meta.width, LOGO_CANVAS.width);
        assert.equal(meta.height, LOGO_CANVAS.height);
        assert.equal(meta.hasAlpha, true);
      }
      assert.ok(r.mono.length < 60_000, 'versão web deve ser leve');
    }
  });

  test('remove fundo sólido, mantém margens e não corta a marca', async () => {
    const r = await processLogo(await raster({ width: 800, height: 300, bg: '#ffffff', format: 'jpg' }), 'jpg');
    assert.equal(r.info.fundo, 'removido');
    const mono = await rawOf(r.mono);
    // bordas da área padrão transparentes (margem) e centro preenchido
    assert.equal(alphaAt(mono, 0, 0), 0);
    assert.equal(alphaAt(mono, mono.width - 1, mono.height - 1), 0);
    assert.ok(alphaAt(mono, mono.width / 2, mono.height / 2) > 200);
    // monocromática: pixels visíveis são claros e neutros
    let checked = 0;
    for (let i = 0; i < mono.data.length; i += 4) {
      if (mono.data[i + 3] < 128) continue;
      const [rr, gg, bb] = [mono.data[i], mono.data[i + 1], mono.data[i + 2]];
      assert.ok(rr > 230 && Math.abs(rr - gg) < 8 && Math.abs(rr - bb) < 8);
      checked++;
    }
    assert.ok(checked > 1000);
  });

  test('detalhes internos (furo branco) continuam visíveis na versão monocromática', async () => {
    const r = await processLogo(await raster({ width: 600, height: 300, bg: '#ffffff', hole: true }), 'png');
    const mono = await rawOf(r.mono);
    const center = alphaAt(mono, mono.width / 2, mono.height / 2);
    // ponto sobre a cor da marca, à esquerda do furo
    const ink = alphaAt(mono, Math.round(mono.width * 0.33), mono.height / 2);
    assert.ok(ink > 200, `tinta ${ink}`);
    assert.ok(center < ink / 2, `furo ${center} deveria ser vazado`);
  });

  test('logo branca (feita para fundo escuro) não desaparece', async () => {
    const r = await processLogo(await raster({ width: 600, height: 300, fg: '#ffffff' }), 'png');
    const mono = await rawOf(r.mono);
    assert.ok(alphaAt(mono, mono.width / 2, mono.height / 2) > 200);
    assert.equal(r.info.fundo_colorida, 'escuro');
  });

  test('imagem sem marca visível ou pequena demais é recusada', async () => {
    const blank = await sharp({ create: { width: 300, height: 120, channels: 3, background: '#ffffff' } }).png().toBuffer();
    await assert.rejects(processLogo(blank, 'png'), LogoError);
    const tiny = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).png().toBuffer();
    await assert.rejects(processLogo(tiny, 'png'), LogoError);
    await assert.rejects(processLogo(Buffer.from('não é imagem'), 'png'), LogoError);
  });
});
