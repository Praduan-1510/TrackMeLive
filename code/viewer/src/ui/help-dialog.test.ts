import { describe, expect, it } from 'vitest';
import { browserFamily } from './help-dialog';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  firefox: 'Mozilla/5.0 (Android 16; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0',
};

describe('browserFamily', () => {
  it('tells the browsers whose settings differ apart', () => {
    expect(browserFamily(UA.iphoneSafari)).toBe('safari-ios');
    expect(browserFamily(UA.macSafari)).toBe('safari-mac');
    expect(browserFamily(UA.androidChrome)).toBe('chromium');
    expect(browserFamily(UA.samsung)).toBe('chromium');
    expect(browserFamily(UA.firefox)).toBe('firefox');
  });
  it('gives general steps where it can’t be sure', () => {
    expect(browserFamily(UA.iphoneChrome)).toBe('other');
    expect(browserFamily('SomethingElse/1.0')).toBe('other');
  });
});
