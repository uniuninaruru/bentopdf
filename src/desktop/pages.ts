// Quick page operations on the open document, done with pdf-lib on the
// viewer's current bytes (annotations included). Larger reorganizations use
// the Organize Pages tool.

import { PDFDocument, degrees } from 'pdf-lib';

export class PageOpError extends Error {}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  const pdf = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  if (pdf.isEncrypted) {
    throw new PageOpError('encrypted');
  }
  return pdf;
}

async function save(pdf: PDFDocument): Promise<Uint8Array> {
  return pdf.save({ useObjectStreams: true });
}

/** Inserts a blank page after `afterIndex` (0-based), sized like that page. */
export async function insertBlankPage(
  bytes: Uint8Array,
  afterIndex: number
): Promise<Uint8Array> {
  const pdf = await load(bytes);
  const ref = pdf.getPage(
    Math.min(Math.max(afterIndex, 0), pdf.getPageCount() - 1)
  );
  const { width, height } = ref.getSize();
  const rotation = ref.getRotation().angle;
  const page = pdf.insertPage(afterIndex + 1, [width, height]);
  if (rotation) page.setRotation(degrees(rotation));
  return save(pdf);
}

export async function deletePage(
  bytes: Uint8Array,
  index: number
): Promise<Uint8Array> {
  const pdf = await load(bytes);
  if (pdf.getPageCount() <= 1) throw new PageOpError('last-page');
  pdf.removePage(index);
  return save(pdf);
}

export async function rotatePage(
  bytes: Uint8Array,
  index: number,
  delta: 90 | -90
): Promise<Uint8Array> {
  const pdf = await load(bytes);
  const page = pdf.getPage(index);
  const angle = (((page.getRotation().angle + delta) % 360) + 360) % 360;
  page.setRotation(degrees(angle));
  return save(pdf);
}

/** Inserts every page of `other` after `afterIndex`. Returns the page count added. */
export async function insertPdf(
  bytes: Uint8Array,
  other: Uint8Array,
  afterIndex: number
): Promise<{ bytes: Uint8Array; added: number }> {
  const pdf = await load(bytes);
  const src = await load(other);
  const pages = await pdf.copyPages(src, src.getPageIndices());
  pages.forEach((p, i) => pdf.insertPage(afterIndex + 1 + i, p));
  return { bytes: await save(pdf), added: pages.length };
}

export interface DocInfo {
  pages: number;
  version: string;
  title?: string;
  author?: string;
  producer?: string;
  created?: Date;
  modified?: Date;
}

export async function readInfo(bytes: Uint8Array): Promise<DocInfo> {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 16));
  const version = head.match(/%PDF-(\d\.\d)/)?.[1] ?? '?';
  const pdf = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const safe = <T>(fn: () => T): T | undefined => {
    try {
      return fn();
    } catch {
      return undefined;
    }
  };
  return {
    pages: pdf.getPageCount(),
    version,
    title: safe(() => pdf.getTitle()),
    author: safe(() => pdf.getAuthor()),
    producer: safe(() => pdf.getProducer()),
    created: safe(() => pdf.getCreationDate()),
    modified: safe(() => pdf.getModificationDate()),
  };
}
