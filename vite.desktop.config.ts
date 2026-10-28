// Vite config for the macOS desktop app (Tauri). It reuses the web config and
// only changes what the desktop build needs, so upstream changes to
// vite.config.ts keep flowing in:
//   - adds desktop.html (the viewer-first app window) as an entry
//   - drops marketing/SEO pages, pre-compression and the service worker
//   - injects the embed bridge into every tool page so the app window can
//     hand documents to tools and receive their results
//   - outputs to dist-desktop/
//
// Run with --mode desktop so .env.desktop points CDN assets at the bundled
// copies in public/desktop-assets (see scripts/desktop/fetch-offline-assets.mjs).

import { resolve } from 'path';
import type { ConfigEnv, Plugin, UserConfig } from 'vite';
import { defineConfig } from 'vitest/config';
import baseConfig from './vite.config';

const DROPPED_PLUGINS = new Set([
  'vite:compression',
  'sw-precache',
  'language-redirect',
]);

// Entries from the web build that only make sense on bentopdf.com.
const MARKETING_ENTRIES = [
  /^about$/,
  /^contact$/,
  /^faq$/,
  /^privacy$/,
  /^terms$/,
  /^licensing$/,
  /^kura$/,
  /^hyper-compress$/,
  /^404$/,
  /^blog-/,
  /^pdf-converter$/,
  /^pdf-editor$/,
  /^pdf-security$/,
  /^pdf-merge-split$/,
];

function desktopPagesPlugin(): Plugin {
  return {
    name: 'desktop-pages',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const isAppWindow = ctx.path.endsWith('/desktop.html');
        const tags = [];
        if (!isAppWindow) {
          tags.push({
            tag: 'script',
            attrs: { type: 'module', src: '/src/desktop/embed-bridge.ts' },
            injectTo: 'head-prepend' as const,
          });
        }
        return {
          html: html.replace('<html', '<html data-desktop="true"'),
          tags,
        };
      },
    },
  };
}

export default defineConfig(async (env: ConfigEnv) => {
  const resolved =
    typeof baseConfig === 'function'
      ? await (
          baseConfig as (e: ConfigEnv) => UserConfig | Promise<UserConfig>
        )(env)
      : (baseConfig as UserConfig);
  const base = resolved as UserConfig & { test?: unknown };

  const plugins = (base.plugins ?? [])
    .flat()
    .filter(
      (p) =>
        !(
          p &&
          typeof p === 'object' &&
          'name' in p &&
          DROPPED_PLUGINS.has(p.name)
        )
    );

  const input = {
    ...((base.build?.rollupOptions?.input as Record<string, string>) ?? {}),
  };
  for (const key of Object.keys(input)) {
    if (MARKETING_ENTRIES.some((re) => re.test(key))) delete input[key];
  }
  input.desktop = resolve(__dirname, 'desktop.html');

  return {
    ...base,
    plugins: [desktopPagesPlugin(), ...plugins],
    define: {
      ...base.define,
      __SIMPLE_MODE__: JSON.stringify(true),
      __DISABLE_GITHUB_STARS__: JSON.stringify(true),
    },
    clearScreen: false,
    server: {
      ...base.server,
      port: 5173,
      strictPort: true,
      // Tauri's dev window loads from here; the docs proxy is not needed.
      proxy: undefined,
    },
    build: {
      ...base.build,
      outDir: 'dist-desktop',
      emptyOutDir: true,
      // WKWebView on macOS 13+ supports modern syntax.
      target: 'safari16',
      reportCompressedSize: false,
      chunkSizeWarningLimit: 8000,
      rollupOptions: {
        ...base.build?.rollupOptions,
        input,
      },
    },
  };
});
