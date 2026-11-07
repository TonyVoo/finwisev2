import { COPY } from '@/copy/strings';
import { REALMS_EN, REALMS_VI, TUTIEN_EN, TUTIEN_VI, realmIndex } from '@/copy/tutien';
import { ENGLISH_COPY, applyLanguagePreference, setActiveFlavor } from '@/i18n/apply';

type Node = { readonly [key: string]: string | Node };

function leaves(node: Node, path: string[] = []): Array<[string, string]> {
  return Object.entries(node).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [[[...path, key].join('.'), value] as [string, string]]
      : leaves(value, [...path, key]),
  );
}
function lookup(root: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], root);
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

afterEach(() => {
  setActiveFlavor('none');
  applyLanguagePreference('en');
});

describe.each([
  ['Vietnamese', TUTIEN_VI as unknown as Node],
  ['English', TUTIEN_EN as unknown as Node],
])('the %s cultivation overlay', (_name, overlay) => {
  it('renames only strings the app has, and keeps every {placeholder} of the original', () => {
    for (const [path, text] of leaves(overlay)) {
      const original = lookup(ENGLISH_COPY.COPY, path);
      expect(typeof original).toBe('string');
      expect(placeholders(text)).toEqual(placeholders(original as string));
    }
  });
});

describe('the overlay in use', () => {
  it('lays the skin’s names over the language, and takes them off again', () => {
    applyLanguagePreference('vi');
    expect(COPY.invest.title).toBe('Đầu tư');

    setActiveFlavor('tutien');
    applyLanguagePreference('vi');
    expect(COPY.invest.title).toBe('Thiên cơ');
    expect(COPY.settings.title).toBe('Động phủ');

    applyLanguagePreference('en');
    expect(COPY.invest.title).toBe('Oracle');

    setActiveFlavor('none');
    applyLanguagePreference('en');
    expect(COPY.invest.title).toBe('Investing');
  });

  it('never renames anything that carries a figure or an action', () => {
    const flat = leaves(TUTIEN_VI as unknown as Node).map(([p]) => p);
    for (const path of flat)
      expect(path).toMatch(/\.(title|open|openNew|placeholder|current|other)$/);
  });
});

describe('realms', () => {
  it('has a name in each language for every stage', () => {
    expect(REALMS_VI).toHaveLength(REALMS_EN.length);
  });
  it('moves up a realm every fifth of the way, and ascends only when the goal is reached', () => {
    expect([0, 19, 20, 39, 40, 59, 60, 79, 80, 99, 100].map(realmIndex)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5,
    ]);
    expect(realmIndex(150)).toBe(5);
    expect(realmIndex(-5)).toBe(0);
  });
});
