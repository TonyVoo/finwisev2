/**
 * Read the device's accessibility tree instead of guessing at pixels.
 *
 * Every §8 E2E case asserts on screen copy ("the pill reads `Offline · 1 pending`"), and a
 * screenshot cannot be asserted on - a tester reads it and decides. `uiautomator dump` gives
 * the same strings the accessibility layer serves, which is also what §13's accessibility
 * items are about, so a case's verdict comes out of text rather than out of eyesight.
 *
 *   node docs/qa/scripts/ui.mjs dump            # every node with text or a label
 *   node docs/qa/scripts/ui.mjs tap <substring> # tap the centre of the first match
 *   node docs/qa/scripts/ui.mjs find <substring>
 */

import { execFileSync } from 'node:child_process';

const ADB = process.env.QA_ADB ?? 'adb';
const serial = process.env.QA_SERIAL;
const target = serial ? ['-s', serial] : [];

function dump() {
  execFileSync(ADB, [...target, 'shell', 'uiautomator', 'dump', '/sdcard/qa-ui.xml'], {
    stdio: 'pipe',
  });
  const xml = execFileSync(ADB, [...target, 'exec-out', 'cat', '/sdcard/qa-ui.xml'], {
    maxBuffer: 64 * 1024 * 1024,
  }).toString('utf8');

  const nodes = [];
  const re = /<node\b([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = {};
    for (const a of m[1].matchAll(/(\w[\w-]*)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const text = (attrs.text ?? '').trim();
    const desc = (attrs['content-desc'] ?? '').trim();
    if (!text && !desc) continue;
    const b = /\[(\d+),(\d+)]\[(\d+),(\d+)]/.exec(attrs.bounds ?? '');
    nodes.push({
      text,
      desc,
      cls: attrs.class,
      clickable: attrs.clickable === 'true',
      bounds: b ? b.slice(1).map(Number) : null,
    });
  }
  return nodes;
}

function centre(node) {
  const [x1, y1, x2, y2] = node.bounds;
  return [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)];
}

const [, , command, ...rest] = process.argv;
const needle = rest.join(' ').toLowerCase();
const nodes = dump();

if (command === 'dump') {
  for (const n of nodes) {
    console.log(
      `${n.clickable ? '*' : ' '} ${JSON.stringify(n.text || n.desc)}${
        n.text && n.desc ? ` / ${JSON.stringify(n.desc)}` : ''
      } @${n.bounds?.join(',')}`,
    );
  }
} else if (command === 'find' || command === 'tap') {
  const hit = nodes.find(
    (n) =>
      n.text.toLowerCase().includes(needle) || n.desc.toLowerCase().includes(needle),
  );
  if (!hit) {
    console.error(`no node matching ${JSON.stringify(needle)}`);
    process.exit(1);
  }
  console.log(JSON.stringify(hit));
  if (command === 'tap') {
    if (!hit.bounds) {
      console.error('match has no bounds');
      process.exit(1);
    }
    const [x, y] = centre(hit);
    execFileSync(ADB, [...target, 'shell', 'input', 'tap', String(x), String(y)], {
      stdio: 'pipe',
    });
    console.log(`tapped ${x},${y}`);
  }
} else {
  console.error('usage: dump | find <text> | tap <text>');
  process.exit(2);
}
