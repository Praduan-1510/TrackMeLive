import { describe, expect, it } from 'vitest';
import { RE2JS } from './re2js-stub';

describe('the re2js stand-in', () => {
  it('refuses to compile, which Firestore turns into a failed pipeline expression', () => {
    expect(() => RE2JS.compile()).toThrow(/aren’t available on the viewer page/);
  });
});
