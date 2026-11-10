/**
 * Resolve a `public/` asset against Vite's base. The app is built with
 * `base: './'` so it works from a GitHub Pages subpath and the Tauri webview,
 * where an absolute `/assets/...` would point at the wrong root.
 */
export function assetUrl(rel: string): string {
  const base = import.meta.env.BASE_URL || './';
  const cleanBase = base.endsWith('/') ? base : `${base}/`;
  return `${cleanBase}${rel.replace(/^\/+/, '')}`;
}
