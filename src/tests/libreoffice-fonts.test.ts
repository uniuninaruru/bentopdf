import { describe, expect, it } from 'vitest';
import { libreOfficeFontUrls } from '../js/utils/libreoffice-loader';

describe('libreOfficeFontUrls', () => {
  it('is empty unless configured', () => {
    expect(libreOfficeFontUrls('')).toEqual([]);
    expect(libreOfficeFontUrls(' , ')).toEqual([]);
  });

  it('splits a comma-separated list', () => {
    expect(
      libreOfficeFontUrls(
        '/fonts/NotoSansCJKjp-Regular.otf, https://example.com/a.ttf'
      )
    ).toEqual([
      '/fonts/NotoSansCJKjp-Regular.otf',
      'https://example.com/a.ttf',
    ]);
  });
});
