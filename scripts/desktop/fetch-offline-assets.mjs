#!/usr/bin/env node
// Downloads the assets BentoPDF normally loads from CDNs at runtime, so the
// desktop app works without a network connection:
//   - PyMuPDF, Ghostscript and CoherentPDF WebAssembly engines
//   - Tesseract OCR worker, core and language data (eng, jpn, jpn_vert)
//   - Fonts used for OCR text layers and FreeText flattening
//   - Fallback fonts the PDF viewer uses for non-embedded fonts (CJK etc.)
//
// Output: public/desktop-assets/ (git-ignored). Packages come from the npm
// registry (integrity-checked by npm); OCR fonts come from the same pinned
// Noto commits the web build uses. Re-running skips what is already present.
//
// Usage: node scripts/desktop/fetch-offline-assets.mjs [--force]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const OUT = path.join(ROOT, 'public/desktop-assets');
const CACHE = path.join(os.tmpdir(), 'bentopdf-desktop-asset-cache');
const FORCE = process.argv.includes('--force');

const OCR_LANGUAGES = ['eng', 'jpn', 'jpn_vert'];
const TESSDATA_VARIANT = '4.0.0_best_int';

function readSource(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function versions() {
  const cdn = readSource('src/js/const/cdn-version.ts');
  const pick = (key) => cdn.match(new RegExp(`${key}:\\s*'([^']+)'`))?.[1];
  const provider = readSource('src/js/utils/wasm-provider.ts');
  const cpdf = provider.match(/coherentpdf@([\d.]+)/)?.[1];
  const v = {
    pymupdf: pick('pymupdf'),
    ghostscript: pick('ghostscript'),
    cpdf,
  };
  for (const [k, val] of Object.entries(v)) {
    if (!val)
      throw new Error(`Could not read the ${k} version from the source tree`);
  }
  return v;
}

function log(msg) {
  console.log(`[desktop-assets] ${msg}`);
}

function done(dir) {
  return !FORCE && fs.existsSync(path.join(dir, '.complete'));
}

function markDone(dir, info) {
  fs.writeFileSync(path.join(dir, '.complete'), JSON.stringify(info, null, 2));
}

/** Downloads an npm tarball (cached) and returns its extracted `package/` dir. */
function npmPackage(spec) {
  fs.mkdirSync(CACHE, { recursive: true });
  const safe = spec.replace(/[@/]/g, '_');
  const extractDir = path.join(CACHE, safe);
  const pkgDir = path.join(extractDir, 'package');
  if (fs.existsSync(path.join(pkgDir, 'package.json'))) return pkgDir;
  log(`downloading ${spec}`);
  const out = execFileSync(
    'npm',
    ['pack', spec, '--pack-destination', CACHE, '--json', '--silent'],
    { cwd: CACHE, encoding: 'utf8' }
  );
  const filename = JSON.parse(out)[0].filename;
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync('tar', ['-xzf', path.join(CACHE, filename), '-C', extractDir]);
  return pkgDir;
}

function copyDir(src, dest, filter = () => true) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (!filter(s, entry)) continue;
    if (entry.isDirectory()) copyDir(s, d, filter);
    else fs.copyFileSync(s, d);
  }
}

function freshDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

async function download(url, dest) {
  log(`downloading ${url.split('/').slice(-1)[0]}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

const noSourceMaps = (_s, entry) => !entry.name.endsWith('.map');

function wasmEngines(v) {
  const pymupdf = path.join(OUT, 'wasm/pymupdf');
  if (!done(pymupdf)) {
    freshDir(pymupdf);
    copyDir(
      npmPackage(`@bentopdf/pymupdf-wasm@${v.pymupdf}`),
      pymupdf,
      noSourceMaps
    );
    markDone(pymupdf, { version: v.pymupdf });
  }

  const gs = path.join(OUT, 'wasm/gs');
  if (!done(gs)) {
    freshDir(gs);
    const pkg = npmPackage(`@bentopdf/gs-wasm@${v.ghostscript}`);
    const assets = path.join(pkg, 'assets');
    copyDir(fs.existsSync(assets) ? assets : pkg, gs, noSourceMaps);
    for (const f of ['LICENSE', 'README.md', 'package.json']) {
      if (fs.existsSync(path.join(pkg, f)))
        fs.copyFileSync(path.join(pkg, f), path.join(gs, f));
    }
    markDone(gs, { version: v.ghostscript });
  }

  const cpdf = path.join(OUT, 'wasm/cpdf');
  if (!done(cpdf)) {
    freshDir(cpdf);
    const pkg = npmPackage(`coherentpdf@${v.cpdf}`);
    const dist = path.join(pkg, 'dist');
    copyDir(fs.existsSync(dist) ? dist : pkg, cpdf, noSourceMaps);
    for (const f of ['LICENSE', 'LICENSE.md', 'package.json']) {
      if (fs.existsSync(path.join(pkg, f)))
        fs.copyFileSync(path.join(pkg, f), path.join(cpdf, f));
    }
    markDone(cpdf, { version: v.cpdf });
  }
}

function ocrRuntime() {
  const ocr = path.join(OUT, 'ocr');
  const runtimeMarker = path.join(ocr, 'core');
  if (done(runtimeMarker)) return;
  fs.mkdirSync(ocr, { recursive: true });
  // Use the exact versions installed in node_modules so the worker matches the
  // tesseract.js API bundled into the app.
  const tess = path.join(ROOT, 'node_modules/tesseract.js');
  const core = path.join(ROOT, 'node_modules/tesseract.js-core');
  fs.copyFileSync(
    path.join(tess, 'dist/worker.min.js'),
    path.join(ocr, 'worker.min.js')
  );
  freshDir(runtimeMarker);
  copyDir(core, runtimeMarker, noSourceMaps);
  const version = JSON.parse(
    fs.readFileSync(path.join(tess, 'package.json'), 'utf8')
  ).version;
  markDone(runtimeMarker, { tesseract: version });
}

function ocrLanguages() {
  const dir = path.join(OUT, 'ocr/lang-data');
  fs.mkdirSync(dir, { recursive: true });
  for (const lang of OCR_LANGUAGES) {
    const dest = path.join(dir, `${lang}.traineddata.gz`);
    if (!FORCE && fs.existsSync(dest)) continue;
    const pkg = npmPackage(`@tesseract.js-data/${lang}`);
    const src = path.join(pkg, TESSDATA_VARIANT, `${lang}.traineddata.gz`);
    if (!fs.existsSync(src))
      throw new Error(`Missing ${TESSDATA_VARIANT}/${lang} in package`);
    fs.copyFileSync(src, dest);
  }
}

/** OCR / FreeText fonts, resolved from src/js/config/font-mappings.ts. */
async function ocrFonts() {
  const source = readSource('src/js/config/font-mappings.ts');
  const urls = new Map();
  for (const m of source.matchAll(/'([^']+)':\s*\n?\s*'(https:\/\/[^']+)'/g)) {
    urls.set(m[1], m[2]);
  }
  // Latin, CJK and the RTL scripts. Other scripts still download on demand.
  const families = [
    'Noto Sans',
    'Noto Sans JP',
    'Noto Sans SC',
    'Noto Sans TC',
    'Noto Sans KR',
    'Noto Naskh Arabic',
    'Noto Sans Hebrew',
  ];
  const dir = path.join(OUT, 'ocr/fonts');
  fs.mkdirSync(dir, { recursive: true });
  for (const family of families) {
    const url = urls.get(family);
    if (!url) {
      log(`warning: no URL for ${family} in font-mappings.ts, skipped`);
      continue;
    }
    const dest = path.join(dir, url.split('/').pop());
    if (!FORCE && fs.existsSync(dest)) continue;
    await download(url, dest);
  }
}

/** Fallback fonts for the PDF viewer (see src/js/config/editor-fonts.ts). */
function viewerFonts() {
  const source = readSource('src/js/config/editor-fonts.ts');
  const files = [
    ...source.matchAll(/'(fonts-[a-z]+@[\d.]+)\/(fonts\/[^']+)'/g),
  ].map((m) => ({
    pack: m[1],
    file: m[2],
  }));
  for (const { pack, file } of files) {
    const dest = path.join(OUT, 'fonts/embedpdf', pack, file);
    if (!FORCE && fs.existsSync(dest)) continue;
    const pkg = npmPackage(`@embedpdf/${pack}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(pkg, file), dest);
    const license = ['LICENSE', 'OFL.txt', 'LICENSE.txt'].find((f) =>
      fs.existsSync(path.join(pkg, f))
    );
    if (license)
      fs.copyFileSync(
        path.join(pkg, license),
        path.join(OUT, 'fonts/embedpdf', pack, license)
      );
  }
}

function sizeOf(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? sizeOf(p) : fs.statSync(p).size;
  }
  return total;
}

async function main() {
  const v = versions();
  log(
    `PyMuPDF ${v.pymupdf}, Ghostscript ${v.ghostscript}, CoherentPDF ${v.cpdf}`
  );
  fs.mkdirSync(OUT, { recursive: true });
  wasmEngines(v);
  ocrRuntime();
  ocrLanguages();
  await ocrFonts();
  viewerFonts();
  fs.writeFileSync(
    path.join(OUT, 'README.txt'),
    [
      'Offline assets for the BentoPDF desktop app, fetched by',
      'scripts/desktop/fetch-offline-assets.mjs. Each component keeps its own license:',
      '  wasm/pymupdf  PyMuPDF (AGPL-3.0)',
      '  wasm/gs       Ghostscript (AGPL-3.0)',
      '  wasm/cpdf     CoherentPDF (AGPL-3.0)',
      '  ocr/          Tesseract.js and language data (Apache-2.0 / MIT)',
      '  ocr/fonts, fonts/embedpdf  Noto fonts (SIL Open Font License 1.1)',
      '',
    ].join('\n')
  );
  log(
    `done: ${(sizeOf(OUT) / 1024 / 1024).toFixed(1)} MB in ${path.relative(ROOT, OUT)}`
  );
}

main().catch((err) => {
  console.error(`[desktop-assets] failed: ${err.message}`);
  process.exit(1);
});
