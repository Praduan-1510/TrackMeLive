import { describe, expect, it } from 'vitest';
import { parseShareLink } from './link';

const TOKEN = 'AbCdEfGhIjKlMnOpQr-_12';

describe('parseShareLink', () => {
  it('reads the 22-character base64url token from /s/{token}', () => {
    expect(parseShareLink(`/s/${TOKEN}`)).toEqual({ kind: 'token', token: TOKEN });
    expect(parseShareLink(`/s/${TOKEN}/`)).toEqual({ kind: 'token', token: TOKEN });
  });
  it('calls a cut-off, too long or mistyped token malformed', () => {
    expect(parseShareLink(`/s/${TOKEN.slice(0, 21)}`)).toEqual({ kind: 'malformed' });
    expect(parseShareLink(`/s/${TOKEN}x`)).toEqual({ kind: 'malformed' });
    expect(parseShareLink(`/s/${TOKEN.slice(0, 21)}+`)).toEqual({ kind: 'malformed' });
    expect(parseShareLink('/s/')).toEqual({ kind: 'malformed' });
  });
  it('ignores paths that aren’t share links', () => {
    expect(parseShareLink('/')).toEqual({ kind: 'none' });
    expect(parseShareLink('/index.html')).toEqual({ kind: 'none' });
  });
});
