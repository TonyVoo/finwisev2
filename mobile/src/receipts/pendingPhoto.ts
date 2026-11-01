/**
 * The photo taken by the camera shortcut, waiting for the Add expense form that it opens.
 *
 * Held in memory only: a receipt photo is private, and one that survived a restart would be attached to
 * an expense nobody asked it for. The form reads it with {@link peekStashedPhoto} while it starts and
 * clears it as soon as it has, so it is used once; a newer photo replaces an older one.
 */

let stashed: string | null = null;

export function stashPhoto(dataBase64: string): void {
  stashed = dataBase64;
}

export function peekStashedPhoto(): string | null {
  return stashed;
}

export function clearStashedPhoto(): void {
  stashed = null;
}
