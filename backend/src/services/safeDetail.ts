/**
 * The adapters' own messages ("receipt model answered 503", "quick add model gave no answer") are fixed
 * strings that never carry a key, a quota, anything from the input or what the model said - their tests
 * assert that - so they may be logged, which is what tells an operator *why* something failed. Any other
 * message could be anything and stays out of the log.
 */
const OWN_MESSAGE =
  /^(receipt model |quick add model |text provider |image too large|the model did not)/;

export function safeDetail(error: unknown): { detail?: string } {
  const message = error instanceof Error ? error.message : '';
  return OWN_MESSAGE.test(message) ? { detail: message } : {};
}
