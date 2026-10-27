import * as assert from 'assert';
import type { StoredLicense } from '../../pro/gumroad';
import { parseStoredLicense, serializeStoredLicense, StoredLicenseProvider } from '../../pro/storedLicense';

const sample: StoredLicense = {
  productId: 'FAKE_PRODUCT_ID',
  licenseKey: 'FAKE-0000-0000-0000',
  saleId: 'FAKE_SALE',
  uses: 1,
  mode: 'activation',
  checkedAt: '2026-10-27T16:00:00.000Z',
};

describe('stored license', () => {
  it('round trips a license', () => {
    assert.deepStrictEqual(parseStoredLicense(serializeStoredLicense(sample)), sample);
  });

  it('ignores empty, broken and non object text', () => {
    assert.strictEqual(parseStoredLicense(undefined), undefined);
    assert.strictEqual(parseStoredLicense(''), undefined);
    assert.strictEqual(parseStoredLicense('{not json'), undefined);
    assert.strictEqual(parseStoredLicense('[]'), undefined);
    assert.strictEqual(parseStoredLicense('null'), undefined);
  });

  it('ignores unknown versions', () => {
    assert.strictEqual(parseStoredLicense(JSON.stringify({ v: 2, license: sample })), undefined);
  });

  it('ignores incomplete or bad fields', () => {
    const bad: Record<string, unknown>[] = [
      { ...sample, licenseKey: '  ' },
      { ...sample, productId: 5 },
      { ...sample, uses: -1 },
      { ...sample, uses: 1.5 },
      { ...sample, mode: 'other' },
      { ...sample, checkedAt: 'yesterday' },
    ];
    for (const license of bad) {
      assert.strictEqual(parseStoredLicense(JSON.stringify({ v: 1, license })), undefined);
    }
  });

  it('drops extra fields such as a buyer email', () => {
    const parsed = parseStoredLicense(JSON.stringify({ v: 1, license: { ...sample, email: 'fake@example.invalid' } }));
    assert.deepStrictEqual(parsed, sample);
  });

  it('provider is Pro only for the expected product', () => {
    const text = serializeStoredLicense(sample);
    assert.strictEqual(new StoredLicenseProvider(text, 'FAKE_PRODUCT_ID').isPro(), true);
    assert.strictEqual(new StoredLicenseProvider(text, 'FAKE_PRODUCT_ID').current().tier, 'pro');
    assert.strictEqual(new StoredLicenseProvider(text, 'OTHER').isPro(), false);
    assert.strictEqual(new StoredLicenseProvider(undefined, 'FAKE_PRODUCT_ID').current().tier, 'free');
  });
});
