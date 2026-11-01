/* eslint-disable @typescript-eslint/no-explicit-any -- config files are read loosely; the assertions are the types */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The build configuration a store submission depends on (`docs/RELEASE.md`). None of it runs in a
 * test, so the cheap guard is to pin the things that are easy to get wrong silently: a production
 * build pointed at localhost, a secret in a file that ships inside the app, a permission prompt
 * with no Vietnamese text.
 */

const root = join(__dirname, '..', '..');
const readJson = (name: string) =>
  JSON.parse(readFileSync(join(root, name), 'utf8')) as Record<string, any>;

const app = readJson('app.json').expo as Record<string, any>;
const eas = readJson('eas.json') as Record<string, any>;
const vi = readJson('locales/vi.json') as Record<string, any>;

/** Builds that run only on a developer's own machine, so a local server address is correct for them. */
const LOCAL_PROFILES = ['development', 'simulator'];

describe('eas.json', () => {
  it('has a development, a preview, a production and a simulator build', () => {
    expect(Object.keys(eas.build).sort()).toEqual([
      'development',
      'preview',
      'production',
      'simulator',
    ]);
  });

  it('keeps the simulator build to the iOS simulator, where a local address is meant to work', () => {
    expect(eas.build.simulator.ios.simulator).toBe(true);
    expect(eas.build.simulator.distribution).toBe('internal');
    expect(eas.build.simulator.developmentClient).toBeUndefined();
  });

  it('keeps the dev client out of preview and production', () => {
    expect(eas.build.development.developmentClient).toBe(true);
    expect(eas.build.preview.developmentClient).toBeUndefined();
    expect(eas.build.production.developmentClient).toBeUndefined();
  });

  it('numbers builds itself, so a resubmission is never rejected for a repeated build number', () => {
    expect(eas.cli.appVersionSource).toBe('remote');
    expect(eas.build.production.autoIncrement).toBe(true);
  });

  it('never points a shipped build at a local server, or carries a secret', () => {
    for (const [name, profile] of Object.entries<Record<string, any>>(eas.build)) {
      for (const [key, value] of Object.entries<string>(profile.env ?? {})) {
        expect(key).toMatch(/^EXPO_PUBLIC_/);
        expect(key).not.toMatch(/KEY|SECRET|TOKEN|PASSWORD/);
        if (key === 'EXPO_PUBLIC_API_BASE_URL' && !LOCAL_PROFILES.includes(name)) {
          expect(value).toMatch(/^https:\/\//);
          expect(value).not.toMatch(/localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\./);
        }
      }
    }
  });
});

describe('app.json', () => {
  it('has the same identifier on both stores', () => {
    expect(app.ios.bundleIdentifier).toBe(app.android.package);
    expect(app.android.package).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/);
  });

  it('has a short on-device name that fits under the icon (the stores keep the full name)', () => {
    // iOS cuts a label at about 12 letters, so "Expense Tracker" showed as "ExpenseTra...".
    expect(app.name.length).toBeLessThanOrEqual(12);
  });

  it('has a semantic version, and leaves build numbers to EAS', () => {
    expect(app.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(app.ios.buildNumber).toBeUndefined();
    expect(app.android.versionCode).toBeUndefined();
  });

  it('declares that the app uses only the exempt kind of encryption (HTTPS), or the App Store asks on every upload', () => {
    expect(app.ios.infoPlist.ITSAppUsesNonExemptEncryption).toBe(false);
  });

  it('never ships a localhost API address in the config file', () => {
    const url = app.extra.apiBaseUrl;
    if (url !== null) expect(url).toMatch(/^https:\/\//);
  });

  it('says why each permission is asked for, in English and in Vietnamese', () => {
    const picker = app.plugins.find(
      (p: unknown) => Array.isArray(p) && p[0] === 'expo-image-picker',
    );
    const face = app.plugins.find(
      (p: unknown) => Array.isArray(p) && p[0] === 'expo-local-authentication',
    );
    expect(picker[1].cameraPermission.length).toBeGreaterThan(20);
    expect(picker[1].photosPermission.length).toBeGreaterThan(20);
    expect(face[1].faceIDPermission.length).toBeGreaterThan(20);
    for (const key of [
      'NSCameraUsageDescription',
      'NSPhotoLibraryUsageDescription',
      'NSFaceIDUsageDescription',
    ]) {
      expect(typeof vi.ios[key]).toBe('string');
      expect(vi.ios[key].length).toBeGreaterThan(10);
    }
  });

  it('asks for no permission the app does not use', () => {
    const picker = app.plugins.find(
      (p: unknown) => Array.isArray(p) && p[0] === 'expo-image-picker',
    );
    expect(picker[1].microphonePermission).toBe(false);
  });
});
