/**
 * Resolves a root-relative asset URL ("/assets/x") against the page origin.
 *
 * Self-hosted builds (the desktop app, air-gapped servers) can point CDN
 * settings at paths on the same origin. Code that runs inside blob: workers
 * cannot resolve root-relative paths, so those URLs are made absolute before
 * they reach a worker. Absolute URLs and empty values are returned unchanged.
 */
export function absoluteAssetUrl(url: string): string;
export function absoluteAssetUrl(url: string | undefined): string | undefined;
export function absoluteAssetUrl(url: string | undefined): string | undefined {
  if (!url || !url.startsWith('/') || url.startsWith('//')) return url;
  if (typeof location === 'undefined') return url;
  const origin = location.origin;
  if (!origin || origin === 'null') return url;
  return origin + url;
}
