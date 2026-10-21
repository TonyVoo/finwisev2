"""Cross-reference every case id in TEST_PLAN.md against the test files that name it.

The plan's own rule (§1, Traceability) is that an automated case names its own id inside
the test file, so this is the mechanical answer to "which cases are actually executed?".
A case counts as executed if a test file names it, or if the plan records a `**Result**`
line for it (the device and manual cases, which no file can claim).

Usage: python -I docs/qa/scripts/ledger.py [--json out.json]
"""

import collections
import io
import json
import os
import re
import sys

PLAN = os.path.join('docs', 'qa', 'TEST_PLAN.md')
SKIP_DIRS = {'node_modules', '.git', 'dist', 'build', '.expo', 'coverage'}


def read_cases(path=PLAN):
    """Every `### ID` heading in the plan, with its Layer line and whether it has a Result."""
    cases = collections.OrderedDict()
    cur = None
    for line in io.open(path, encoding='utf-8'):
        m = re.match(r'^### ([A-Z]+-\d+)\s*(.*)', line)
        if m:
            cur = m.group(1)
            cases[cur] = {'title': m.group(2).strip(), 'layer': '', 'result': False}
            continue
        if not cur:
            continue
        s = line.strip()
        if s.startswith('- **Layer**') and not cases[cur]['layer']:
            cases[cur]['layer'] = s[len('- **Layer**'):].strip()
        if s.startswith('- **Result'):
            cases[cur]['result'] = True
    return cases


def read_mentions(cases, root='.'):
    """Which test files name each case id."""
    mentions = collections.defaultdict(set)
    sep = os.sep
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if not re.search(r'\.(ts|tsx|js)$', name):
                continue
            path = os.path.join(dirpath, name)
            if 'test' not in path.lower():
                continue
            try:
                text = io.open(path, encoding='utf-8', errors='ignore').read()
            except OSError:
                continue
            rel = path.replace(sep, '/').lstrip('./')
            for cid in set(re.findall(r'\b([A-Z]{3,4}-\d{1,2})\b', text)):
                if cid in cases:
                    mentions[cid].add(rel)
    return mentions


def kind(layer):
    """`auto` if any layer a test runner can reach is named; otherwise `device`."""
    tags = {t for t in ('API', 'Unit', 'E2E', 'Manual', 'Integration') if re.search(r'\b' + t + r'\b', layer)}
    return 'auto' if tags & {'API', 'Unit', 'Integration'} else 'device'


def main():
    cases = read_cases()
    mentions = read_mentions(cases)
    rows = [
        {
            'id': cid,
            'kind': kind(v['layer']),
            'tests': sorted(mentions.get(cid, ())),
            'result': v['result'],
            'layer': v['layer'],
            'title': v['title'],
        }
        for cid, v in cases.items()
    ]

    counts = collections.Counter((r['kind'], bool(r['tests']), r['result']) for r in rows)
    print('total cases: %d' % len(rows))
    print('\n=== (kind, named by a test, has a Result line) ===')
    for key, n in sorted(counts.items()):
        print('%4d  %s' % (n, key))

    unexec = [r for r in rows if not r['tests'] and not r['result']]
    print('\n=== %d cases with neither ===' % len(unexec))
    for k in ('auto', 'device'):
        group = [r['id'] for r in unexec if r['kind'] == k]
        print('\n-- %s (%d):' % (k, len(group)))
        print(', '.join(group))

    if '--json' in sys.argv:
        out = sys.argv[sys.argv.index('--json') + 1]
        json.dump(rows, io.open(out, 'w', encoding='utf-8'), indent=1)
        print('\nwrote %s' % out)


if __name__ == '__main__':
    main()
