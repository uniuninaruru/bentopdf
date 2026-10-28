#!/usr/bin/env node
// Creates Japanese test PDFs for checking the desktop app by hand:
//   jp-embedded.pdf     Japanese TrueType font embedded as a subset (3 pages)
//   jp-nonembedded.pdf  Japanese text in a non-embedded CID font, so the
//                       viewer has to use its fallback font
// Output: test/desktop/ (git-ignored).
//
// The embedded font must be TrueType: pdf-lib/fontkit produce broken subsets
// of CFF-based OpenType fonts (e.g. NotoSansCJK .otf), which no reader shows.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const OUT = path.join(ROOT, 'test/desktop');
fs.mkdirSync(OUT, { recursive: true });

async function embedded() {
  const fontPath = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf';
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fs.readFileSync(fontPath), { subset: true });
  pdf.setTitle('日本語テスト文書');
  pdf.setAuthor('BentoPDF デスクトップ');
  const pages = [
    [
      '第1章 はじめに',
      '日本語の PDF を表示・編集・保存できるか確認します。',
      'ひらがな・カタカナ・漢字・ＡＢＣ・１２３が混在した文章です。',
      '吾輩は猫である。名前はまだ無い。',
    ],
    [
      '第2章 注釈のテスト',
      'この行をハイライトしてください。',
      'ここにテキスト注釈を追加します。',
      '東京都千代田区丸の内一丁目',
    ],
    [
      '第3章 検索のテスト',
      '検索キーワード「群馬大学」をこのページに置きます。',
      '最後のページです。',
    ],
  ];
  for (const [title, ...lines] of pages) {
    const page = pdf.addPage([595, 842]);
    page.drawText(title, {
      x: 56,
      y: 760,
      size: 24,
      font,
      color: rgb(0.1, 0.1, 0.3),
    });
    lines.forEach((line, i) =>
      page.drawText(line, { x: 56, y: 700 - i * 34, size: 16, font })
    );
    page.drawText(`${pdf.getPageCount()} / ${pages.length}`, {
      x: 280,
      y: 40,
      size: 10,
      font,
    });
  }
  fs.writeFileSync(path.join(OUT, 'jp-embedded.pdf'), await pdf.save());
}

/** Hand-built PDF referencing KozMinPr6N-Regular without embedding it. */
function nonEmbedded() {
  const text = '非埋め込みフォントの日本語テキスト';
  const hex = [...text]
    .map((c) => c.codePointAt(0).toString(16).padStart(4, '0'))
    .join('');
  const stream = `BT /F1 22 Tf 56 760 Td <${hex}> Tj ET\nBT /F1 14 Tf 56 720 Td <${[...'代替フォントで表示されれば成功です。'].map((c) => c.codePointAt(0).toString(16).padStart(4, '0')).join('')}> Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type0 /BaseFont /KozMinPr6N-Regular /Encoding /UniJIS-UCS2-H /DescendantFonts [6 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /KozMinPr6N-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> /FontDescriptor 7 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /KozMinPr6N-Regular /Flags 6 /FontBBox [-437 -340 1147 1317] /ItalicAngle 0 /Ascent 1317 /Descent -349 /CapHeight 742 /StemV 80 >>',
  ];
  let out = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets)
    out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(
    path.join(OUT, 'jp-nonembedded.pdf'),
    Buffer.from(out, 'latin1')
  );
}

await embedded();
nonEmbedded();
console.log(`test PDFs written to ${path.relative(ROOT, OUT)}`);
