/**
 * Back, or somewhere sensible when there is nothing to go back to.
 *
 * A screen opened from a deep link, a notification or a cold start has no history, and `router.back()`
 * there is an unhandled `GO_BACK` that shows as an error banner in development and does nothing in a build.
 */
export interface BackRouter<Href> {
  canGoBack(): boolean;
  back(): void;
  replace(href: Href): void;
}

export function goBack<Href>(router: BackRouter<Href>, fallback: Href): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
