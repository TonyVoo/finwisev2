import type { z } from 'zod';

/** The contract's `details.issues` entry: a dotted path to the field, and what is wrong. */
// A `type`, not an `interface`: only a type alias is assignable to the wire schema's
// open-ended issue object.
export type WireIssue = { path: string; message: string };

/**
 * Turn a zod failure into the contract's `details.issues` list.
 *
 * `path` is the client's handle on the failure: it is what lets a form put the message
 * next to the field. One zod issue does not always have a usable one. A closed
 * (`strictObject`) schema reports an unexpected key **on the container**, with the key
 * names in a separate `keys` list and an empty `path` - and that is the failure a
 * closed-schema API produces most often (a typo'd or stale field). Left as is, the client
 * gets an issue with `path: ""` and has to parse the key out of the message. So that issue
 * is expanded into one entry per unexpected key, each with the key as its path (under the
 * container's own path when it is nested).
 */
export function toIssues(error: z.ZodError): { issues: WireIssue[] } {
  const issues: WireIssue[] = [];

  for (const issue of error.issues) {
    const base = issue.path.map(String);
    if (issue.code === 'unrecognized_keys') {
      const keys = (issue as unknown as { keys?: unknown }).keys;
      if (Array.isArray(keys) && keys.length > 0) {
        for (const key of keys) {
          issues.push({ path: [...base, String(key)].join('.'), message: issue.message });
        }
        continue;
      }
    }
    issues.push({ path: base.join('.'), message: issue.message });
  }

  return { issues };
}
