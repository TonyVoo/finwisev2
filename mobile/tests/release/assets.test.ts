/* eslint-disable @typescript-eslint/no-explicit-any -- config files are read loosely; the assertions are the types */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The icon and splash images (`pnpm make:icons`, `docs/RELEASE.md`). The stores reject a bad icon after
 * the upload, which is a slow place to find out: Apple refuses a transparent or alpha-channel icon, and
 * Android's adaptive icon needs a transparent foreground to sit on its background colour.
 */

const root = join(__dirname, '..', '..');
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo as Record<string, any>;

interface Png {
  width: number;
  height: number;
  colorType: number;
}

function png(relative: string): Png {
  const bytes = readFileSync(join(root, relative));
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25]! };
}

const RGB = 2;
const RGBA = 6;

describe('app icon', () => {
  it('is 1024x1024 with no alpha channel, as the App Store requires', () => {
    expect(app.icon).toBe('./assets/icon.png');
    expect(png('assets/icon.png')).toEqual({ width: 1024, height: 1024, colorType: RGB });
  });
});

describe('Android adaptive icon', () => {
  const adaptive = app.android.adaptiveIcon;

  it('puts a transparent 1024 foreground on a flat background colour', () => {
    expect(adaptive.backgroundColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(adaptive.foregroundImage).toBe('./assets/adaptive-icon-foreground.png');
    expect(png('assets/adaptive-icon-foreground.png')).toEqual({
      width: 1024,
      height: 1024,
      colorType: RGBA,
    });
  });

  it('has a single-colour icon for Android 13 themed icons', () => {
    expect(adaptive.monochromeImage).toBe('./assets/adaptive-icon-monochrome.png');
    expect(png('assets/adaptive-icon-monochrome.png')).toEqual({
      width: 1024,
      height: 1024,
      colorType: RGBA,
    });
  });
});

describe('splash screen', () => {
  const plugin = app.plugins.find(
    (p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen',
  );
  const config = plugin[1];

  it('shows the mark on the theme background, light and dark', () => {
    expect(config.image).toBe('./assets/splash-icon.png');
    expect(config.dark.image).toBe('./assets/splash-icon-dark.png');
    expect(config.backgroundColor).toBe('#F7F8FA');
    expect(config.dark.backgroundColor).toBe('#0F1115');
    expect(config.imageWidth).toBeGreaterThanOrEqual(120);
  });

  it('uses transparent images, so the background colour shows around the mark', () => {
    expect(png('assets/splash-icon.png').colorType).toBe(RGBA);
    expect(png('assets/splash-icon-dark.png').colorType).toBe(RGBA);
  });
});

describe('every image app.json points at', () => {
  it('exists in the repository', () => {
    const paths = [
      app.icon,
      app.android.adaptiveIcon.foregroundImage,
      app.android.adaptiveIcon.monochromeImage,
      ...app.plugins
        .filter((p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen')
        .flatMap((p: any) => [p[1].image, p[1].dark?.image]),
    ].filter((path): path is string => typeof path === 'string');
    expect(paths.length).toBe(5);
    for (const path of paths) expect(existsSync(join(root, path))).toBe(true);
  });
});
