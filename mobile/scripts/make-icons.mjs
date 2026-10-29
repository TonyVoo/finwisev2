/**
 * `pnpm make:icons` - draws the app icon and splash images and writes them to `assets/`.
 *
 * One mark (a flat teal receipt with a white check) drawn as SVG, rendered with resvg, so the
 * images are reproducible and a colour change is one line here. The SVG sources are written
 * to `assets/source/` too, for a designer to open or replace.
 *
 *   icon.png                        1024, opaque RGB (the App Store refuses an alpha channel)
 *   adaptive-icon-foreground.png    1024, transparent, mark inside Android's safe zone
 *   adaptive-icon-monochrome.png    1024, transparent, one colour (Android 13 themed icons)
 *   splash-icon.png / -dark.png     transparent, cropped to the mark
 *
 * Colours are the app's own (`src/theme/tokens.ts`): teal #0D7A64, and #3DBBA0 on the dark theme.
 */
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'assets');
mkdirSync(join(assets, 'source'), { recursive: true });

const TEAL = '#0D7A64';
const TEAL_DARK_THEME = '#3DBBA0';
const WHITE = '#FFFFFF';

// The slip is 440 x 580, centred on a 1024 canvas, with a torn zig-zag bottom edge.
const SLIP =
  'M340,222 H684 Q732,222 732,270 V802 L688,766 L644,802 L600,766 L556,802 L512,766 ' +
  'L468,802 L424,766 L380,802 L336,766 L292,802 V270 Q292,222 340,222 Z';
const LINES = [
  { x: 352, y: 290, width: 240 },
  { x: 352, y: 342, width: 140 },
];
const CHECK = '408,578 484,654 626,498';

const lines = (fill) =>
  LINES.map(
    (l) => `<rect x="${l.x}" y="${l.y}" width="${l.width}" height="26" rx="13" fill="${fill}"/>`,
  ).join('');
const check = (stroke) =>
  `<polyline points="${CHECK}" fill="none" stroke="${stroke}" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/>`;

const svg = (viewBox, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;

/** The mark in colour: a slip, two faint text lines, and the check. */
const mark = (slip, faint) => `<path d="${SLIP}" fill="${slip}"/>${lines(faint)}${check(WHITE)}`;

const scaled = (factor, inner) =>
  `<g transform="translate(512 512) scale(${factor}) translate(-512 -512)">${inner}</g>`;

const sources = {
  // A white tile, full bleed: the stores round the corners themselves.
  icon: svg(
    '0 0 1024 1024',
    `<rect width="1024" height="1024" fill="${WHITE}"/>${scaled(1.12, mark(TEAL, '#9ED3C6'))}`,
  ),
  // Android masks the foreground to a circle or squircle; only the inner two thirds is always visible.
  'adaptive-icon-foreground': svg('0 0 1024 1024', scaled(0.86, mark(TEAL, '#9ED3C6'))),
  // Alpha is all that is used: the slip is solid and the check and lines are cut out of it.
  'adaptive-icon-monochrome': svg(
    '0 0 1024 1024',
    scaled(
      0.86,
      `<mask id="cut"><rect width="1024" height="1024" fill="#fff"/>${lines('#000')}${check('#000')}</mask>` +
        `<path d="${SLIP}" fill="#000" mask="url(#cut)"/>`,
    ),
  ),
  // Cropped to the mark so `imageWidth` in app.json is the width of the mark, not of a mostly empty canvas.
  'splash-icon': svg('232 162 560 720', mark(TEAL, '#9ED3C6')),
  'splash-icon-dark': svg('232 162 560 720', mark(TEAL_DARK_THEME, '#B7EBDD')),
};

/** An RGB PNG (colour type 2): resvg only writes RGBA, and an iOS icon may not have alpha at all. */
function rgbPng({ width, height, pixels }) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const alpha = pixels[from + 3];
      if (alpha !== 255) throw new Error('the icon must be fully opaque');
      raw.set(pixels.subarray(from, from + 3), row + 1 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const WIDTH = { 'splash-icon': 840, 'splash-icon-dark': 840 };

for (const [name, source] of Object.entries(sources)) {
  writeFileSync(join(assets, 'source', `${name}.svg`), `${source}\n`);
  const image = new Resvg(source, {
    fitTo: { mode: 'width', value: WIDTH[name] ?? 1024 },
  }).render();
  const png = name === 'icon' ? rgbPng(image) : image.asPng();
  writeFileSync(join(assets, `${name}.png`), png);
  console.log(`assets/${name}.png  ${image.width}x${image.height}  ${png.length} bytes`);
}
