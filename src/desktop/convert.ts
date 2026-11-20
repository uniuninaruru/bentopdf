// What the app does with a file that is not a PDF: common images become a PDF
// right here (like Preview or Acrobat), other documents go to BentoPDF's
// matching conversion tool with the file already loaded.

import { PDFDocument } from 'pdf-lib';

export type FileKind =
  | { type: 'pdf' }
  | { type: 'image'; fallbackTool: string }
  | { type: 'tool'; toolId: string }
  | { type: 'unsupported' };

const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

/** Images the web view decodes itself, with the tool to use if it cannot. */
const IMAGES: Record<string, string> = {
  jpg: 'jpg-to-pdf',
  jpeg: 'jpg-to-pdf',
  jpe: 'jpg-to-pdf',
  jfif: 'jpg-to-pdf',
  png: 'png-to-pdf',
  gif: 'image-to-pdf',
  webp: 'webp-to-pdf',
  bmp: 'bmp-to-pdf',
  heic: 'heic-to-pdf',
  heif: 'heic-to-pdf',
  tif: 'tiff-to-pdf',
  tiff: 'tiff-to-pdf',
  avif: 'image-to-pdf',
};

/** Other formats, each handled by an existing BentoPDF tool page. */
const TOOLS: Record<string, string> = {
  svg: 'svg-to-pdf',
  psd: 'psd-to-pdf',
  jp2: 'image-to-pdf',
  jpx: 'image-to-pdf',
  jxr: 'image-to-pdf',
  pnm: 'image-to-pdf',
  pgm: 'image-to-pdf',
  pbm: 'image-to-pdf',
  ppm: 'image-to-pdf',
  pam: 'image-to-pdf',
  doc: 'word-to-pdf',
  docx: 'word-to-pdf',
  dot: 'word-to-pdf',
  dotx: 'word-to-pdf',
  docm: 'word-to-pdf',
  xls: 'excel-to-pdf',
  xlsx: 'excel-to-pdf',
  xlsm: 'excel-to-pdf',
  ppt: 'powerpoint-to-pdf',
  pptx: 'powerpoint-to-pdf',
  pps: 'powerpoint-to-pdf',
  ppsx: 'powerpoint-to-pdf',
  odt: 'odt-to-pdf',
  ods: 'ods-to-pdf',
  odp: 'odp-to-pdf',
  odg: 'odg-to-pdf',
  rtf: 'rtf-to-pdf',
  txt: 'txt-to-pdf',
  csv: 'csv-to-pdf',
  json: 'json-to-pdf',
  xml: 'xml-to-pdf',
  eml: 'email-to-pdf',
  msg: 'email-to-pdf',
  epub: 'epub-to-pdf',
  mobi: 'mobi-to-pdf',
  fb2: 'fb2-to-pdf',
  cbz: 'cbz-to-pdf',
  cbr: 'cbz-to-pdf',
  xps: 'xps-to-pdf',
  oxps: 'xps-to-pdf',
  pages: 'pages-to-pdf',
  pub: 'pub-to-pdf',
  vsd: 'vsd-to-pdf',
  vsdx: 'vsd-to-pdf',
  wpd: 'wpd-to-pdf',
  wps: 'wps-to-pdf',
};

export function fileKind(name: string): FileKind {
  const e = ext(name);
  if (e === 'pdf') return { type: 'pdf' };
  if (IMAGES[e]) return { type: 'image', fallbackTool: IMAGES[e] };
  if (TOOLS[e]) return { type: 'tool', toolId: TOOLS[e] };
  return { type: 'unsupported' };
}

/** Every extension the Open panel should offer. */
export const OPENABLE_EXTENSIONS = [
  'pdf',
  ...Object.keys(IMAGES),
  ...Object.keys(TOOLS),
];

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'text/xml',
  eml: 'message/rfc822',
  epub: 'application/epub+zip',
};

/** MIME type for a file name; tool pages check it when files are handed over. */
export function mimeFor(name: string): string {
  return MIME[ext(name)] ?? '';
}

/** "IMG_0202.JPG" → "IMG_0202.pdf" */
export function pdfNameFor(name: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.pdf`;
}

// ------------------------------------------------------------ image to PDF

/** EXIF orientation of a JPEG (1 = upright), or 1 when there is none. */
export function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    const size = view.getUint16(offset + 2);
    if (
      marker === 0xffe1 &&
      offset + 10 <= view.byteLength &&
      view.getUint32(offset + 4) === 0x45786966 // "Exif"
    ) {
      const tiff = offset + 10;
      if (tiff + 8 > view.byteLength) return 1;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      if (ifd + 2 > view.byteLength) return 1;
      const count = view.getUint16(ifd, little);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > view.byteLength) return 1;
        if (view.getUint16(entry, little) === 0x0112) {
          const value = view.getUint16(entry + 8, little);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    offset += 2 + size;
  }
  return 1;
}

async function decodeImage(
  bytes: Uint8Array,
  type: string
): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('empty image');
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function rasterize(
  img: HTMLImageElement,
  type: 'image/jpeg' | 'image/png'
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  if (type === 'image/jpeg') {
    // JPEG has no transparency; keep transparent areas white, not black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((r) =>
    canvas.toBlob(r, type, 0.92)
  );
  if (!blob) throw new Error('could not encode the image');
  return new Uint8Array(await blob.arrayBuffer());
}

// A4 in points. Large photos are shrunk to fit; the image keeps its full
// resolution, only the page gets a printable size.
const A4_SHORT = 595.28;
const A4_LONG = 841.89;
const PX_TO_PT = 0.75; // 96 dpi

/** Makes a one-page PDF from an image the web view can decode. */
export async function imageToPdf(
  bytes: Uint8Array,
  name: string
): Promise<Uint8Array> {
  const e = ext(name);
  const type = mimeFor(name) || 'application/octet-stream';
  const img = await decodeImage(bytes, type);
  const width = img.naturalWidth;
  const height = img.naturalHeight;

  const pdf = await PDFDocument.create();
  let embedded;
  const isJpeg = type === 'image/jpeg';
  if (isJpeg && jpegOrientation(bytes) === 1) {
    // Upright JPEG: embed the original bytes, no quality loss.
    embedded = await pdf.embedJpg(bytes);
  } else if (e === 'png') {
    try {
      embedded = await pdf.embedPng(bytes);
    } catch {
      embedded = await pdf.embedPng(await rasterize(img, 'image/png'));
    }
  } else if (isJpeg || e === 'heic' || e === 'heif') {
    // Rotated JPEGs and HEIC photos: re-encode upright (the web view applies
    // the EXIF orientation when it draws).
    embedded = await pdf.embedJpg(await rasterize(img, 'image/jpeg'));
  } else {
    embedded = await pdf.embedPng(await rasterize(img, 'image/png'));
  }

  let w = width * PX_TO_PT;
  let h = height * PX_TO_PT;
  const [maxW, maxH] = w > h ? [A4_LONG, A4_SHORT] : [A4_SHORT, A4_LONG];
  const scale = Math.min(1, maxW / w, maxH / h);
  w *= scale;
  h *= scale;
  const page = pdf.addPage([w, h]);
  page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
  pdf.setTitle(name.replace(/\.[^.]+$/, ''));
  pdf.setCreator('BentoPDF');
  return pdf.save({ useObjectStreams: true });
}
