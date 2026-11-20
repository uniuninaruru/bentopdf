import { describe, expect, it } from 'vitest';
import {
  fileKind,
  jpegOrientation,
  mimeFor,
  pdfNameFor,
  OPENABLE_EXTENSIONS,
} from '../desktop/convert';

/** A minimal JPEG header with an EXIF orientation tag. */
function jpegWithOrientation(value: number, little: boolean): Uint8Array {
  const tiff = new DataView(new ArrayBuffer(8 + 2 + 12 + 4));
  tiff.setUint16(0, little ? 0x4949 : 0x4d4d);
  tiff.setUint16(2, 42, little);
  tiff.setUint32(4, 8, little); // IFD0 right after the header
  tiff.setUint16(8, 1, little); // one entry
  tiff.setUint16(10, 0x0112, little); // Orientation
  tiff.setUint16(12, 3, little); // SHORT
  tiff.setUint32(14, 1, little);
  tiff.setUint16(18, value, little);
  const exif = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0]); // "Exif\0\0"
  const body = new Uint8Array(exif.length + tiff.byteLength);
  body.set(exif);
  body.set(new Uint8Array(tiff.buffer), exif.length);
  const size = body.length + 2;
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe1,
    size >> 8,
    size & 0xff,
    ...body,
    0xff,
    0xda,
  ]);
}

describe('desktop file routing', () => {
  it('sends each file type to the right place', () => {
    expect(fileKind('report.PDF')).toEqual({ type: 'pdf' });
    expect(fileKind('IMG_0202.JPG')).toEqual({
      type: 'image',
      fallbackTool: 'jpg-to-pdf',
    });
    expect(fileKind('photo.heic')).toEqual({
      type: 'image',
      fallbackTool: 'heic-to-pdf',
    });
    expect(fileKind('レポート.docx')).toEqual({
      type: 'tool',
      toolId: 'word-to-pdf',
    });
    expect(fileKind('slides.pptx')).toEqual({
      type: 'tool',
      toolId: 'powerpoint-to-pdf',
    });
    expect(fileKind('logo.svg')).toEqual({
      type: 'tool',
      toolId: 'svg-to-pdf',
    });
    expect(fileKind('archive.zip')).toEqual({ type: 'unsupported' });
    expect(fileKind('no-extension')).toEqual({ type: 'unsupported' });
  });

  it('offers every routed extension in the Open panel', () => {
    for (const e of ['pdf', 'jpg', 'png', 'heic', 'docx', 'xlsx', 'pptx']) {
      expect(OPENABLE_EXTENSIONS).toContain(e);
    }
    expect(OPENABLE_EXTENSIONS.every((e) => /^[a-z0-9]+$/.test(e))).toBe(true);
  });

  it('names the PDF after the source file', () => {
    expect(pdfNameFor('IMG_0202.JPG')).toBe('IMG_0202.pdf');
    expect(pdfNameFor('写真.2026.png')).toBe('写真.2026.pdf');
    expect(pdfNameFor('.hidden')).toBe('.hidden.pdf');
  });

  it('gives tool pages a MIME type they accept', () => {
    expect(mimeFor('a.JPG')).toBe('image/jpeg');
    expect(mimeFor('a.docx')).toContain('wordprocessingml');
    expect(mimeFor('a.unknown')).toBe('');
  });
});

describe('jpegOrientation', () => {
  it('reads the orientation in both byte orders', () => {
    expect(jpegOrientation(jpegWithOrientation(6, false))).toBe(6);
    expect(jpegOrientation(jpegWithOrientation(3, true))).toBe(3);
    expect(jpegOrientation(jpegWithOrientation(1, true))).toBe(1);
  });

  it('treats missing or broken data as upright', () => {
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda]))).toBe(1);
    expect(jpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(1);
    expect(jpegOrientation(jpegWithOrientation(6, false).slice(0, 20))).toBe(1);
    expect(jpegOrientation(jpegWithOrientation(42, true))).toBe(1);
  });
});
