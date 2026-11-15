import test from 'node:test';
import assert from 'node:assert/strict';
import { TRANSLATIONS, t, type Locale } from './translations';

test('all locales share identical translation keys', () => {
  const baseKeys = Object.keys(TRANSLATIONS['pt-BR']).sort();
  for (const locale of ['en', 'es'] as Locale[]) {
    const keys = Object.keys(TRANSLATIONS[locale]).sort();
    assert.deepEqual(keys, baseKeys, `Key mismatch for locale ${locale}`);
    for (const k of baseKeys) {
      const value = t(locale, k as keyof (typeof TRANSLATIONS)['pt-BR']);
      assert.equal(typeof value, 'string');
      assert.ok(value.trim().length > 0, `Empty value for ${locale}.${k}`);
    }
  }
});
