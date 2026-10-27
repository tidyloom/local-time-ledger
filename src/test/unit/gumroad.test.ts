import * as assert from 'node:assert/strict';
import {
  buildVerifyRequest,
  GUMROAD_PRODUCT_ID,
  GUMROAD_VERIFY_URL,
  MAX_MACHINES,
  parseVerifyResponse,
  type VerifyRequest,
} from '../../pro/gumroad';

// Obviously fake values only.
const PRODUCT = 'FAKE-PRODUCT-ID-000==';
const KEY = 'FAKEFAKE-00000000-00000000-00000000';
const NOW = new Date('2026-01-01T00:00:00.000Z');

function req(mode: 'activation' | 'recheck'): VerifyRequest {
  const r = buildVerifyRequest(KEY, mode, PRODUCT);
  assert.ok(r);
  return r;
}

function okBody(purchase: Record<string, unknown> = {}, uses: unknown = 1): Record<string, unknown> {
  return {
    success: true,
    uses,
    purchase: {
      product_id: PRODUCT,
      sale_id: 'FAKE-SALE-ID==',
      email: 'buyer@example.invalid',
      refunded: false,
      disputed: false,
      chargebacked: false,
      ...purchase,
    },
  };
}

describe('gumroad license helpers', () => {
  it('builds a form encoded POST for activation and for re-check', () => {
    const a = buildVerifyRequest(`  ${KEY} \n`, 'activation', PRODUCT);
    assert.deepEqual(a, {
      url: GUMROAD_VERIFY_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      fields: { product_id: PRODUCT, license_key: KEY, increment_uses_count: 'true' },
      body: `product_id=FAKE-PRODUCT-ID-000%3D%3D&license_key=${KEY}&increment_uses_count=true`,
    });
    assert.equal(req('recheck').fields.increment_uses_count, 'false');
    assert.equal(GUMROAD_VERIFY_URL, 'https://api.gumroad.com/v2/licenses/verify');
  });

  it('sends no secret token or other fields', () => {
    const r = req('activation');
    assert.deepEqual(Object.keys(r.fields).sort(), ['increment_uses_count', 'license_key', 'product_id']);
    assert.doesNotMatch(r.body, /token|secret/i);
  });

  it('refuses empty keys and an empty product id', () => {
    assert.equal(buildVerifyRequest('   ', 'activation', PRODUCT), undefined);
    assert.equal(buildVerifyRequest(KEY, 'activation', ''), undefined);
    assert.equal(buildVerifyRequest(KEY, 'activation', '   '), undefined);
  });

  it('uses the real product id by default and form encodes its trailing equals signs', () => {
    assert.equal(GUMROAD_PRODUCT_ID, '6ygdMSSV3yuxuAeozXFVmQ==');
    const r = buildVerifyRequest(KEY, 'activation');
    assert.ok(r);
    assert.equal(r.fields.product_id, '6ygdMSSV3yuxuAeozXFVmQ==');
    assert.match(r.body, /(^|&)product_id=6ygdMSSV3yuxuAeozXFVmQ%3D%3D(&|$)/);
    assert.equal(new URLSearchParams(r.body).get('product_id'), GUMROAD_PRODUCT_ID);
  });

  it('accepts a clean purchase and returns a storable license without the buyer email', () => {
    const r = parseVerifyResponse(200, okBody({}, MAX_MACHINES), req('activation'), NOW);
    assert.ok(r.valid);
    assert.deepEqual(r.license, {
      productId: PRODUCT,
      licenseKey: KEY,
      saleId: 'FAKE-SALE-ID==',
      uses: MAX_MACHINES,
      mode: 'activation',
      checkedAt: NOW.toISOString(),
    });
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
    assert.doesNotMatch(JSON.stringify(r), /example\.invalid/);
  });

  it('treats HTTP 404 and success false as an invalid key', () => {
    const nf = parseVerifyResponse(404, { success: false, message: 'That license does not exist for the provided product.' }, req('activation'), NOW);
    assert.equal(!nf.valid && nf.reason, 'invalid-key');
    const notOk = parseVerifyResponse(200, { ...okBody(), success: false }, req('activation'), NOW);
    assert.equal(!notOk.valid && notOk.reason, 'invalid-key');
  });

  it('rejects refunded, disputed and chargebacked purchases, and missing flags', () => {
    for (const flag of ['refunded', 'disputed', 'chargebacked'] as const) {
      const r = parseVerifyResponse(200, okBody({ [flag]: true }), req('recheck'), NOW);
      assert.equal(!r.valid && r.reason, flag);
      const missing = parseVerifyResponse(200, okBody({ [flag]: undefined }), req('recheck'), NOW);
      assert.equal(missing.valid, false);
    }
  });

  it('enforces the machine limit on activation only', () => {
    const fourth = parseVerifyResponse(200, okBody({}, MAX_MACHINES + 1), req('activation'), NOW);
    assert.equal(!fourth.valid && fourth.reason, 'too-many-machines');
    const recheck = parseVerifyResponse(200, okBody({}, MAX_MACHINES + 1), req('recheck'), NOW);
    assert.ok(recheck.valid);
    assert.equal(recheck.license.mode, 'recheck');
  });

  it('rejects another product, incomplete replies and server errors', () => {
    const wrong = parseVerifyResponse(200, okBody({ product_id: 'OTHER-FAKE-ID==' }), req('activation'), NOW);
    assert.equal(!wrong.valid && wrong.reason, 'wrong-product');
    // null stands in for a missing count (undefined would pick the helper's default).
    for (const uses of [null, -1, 1.5, '2']) {
      const r = parseVerifyResponse(200, okBody({}, uses), req('activation'), NOW);
      assert.equal(!r.valid && r.reason, 'bad-response');
    }
    const noUses = parseVerifyResponse(200, { success: true, purchase: okBody().purchase }, req('activation'), NOW);
    assert.equal(!noUses.valid && noUses.reason, 'bad-response');
    const noPurchase = parseVerifyResponse(200, { success: true, uses: 1 }, req('activation'), NOW);
    assert.equal(!noPurchase.valid && noPurchase.reason, 'bad-response');
    const notJson = parseVerifyResponse(200, null, req('activation'), NOW);
    assert.equal(!notJson.valid && notJson.reason, 'bad-response');
    const down = parseVerifyResponse(503, null, req('activation'), NOW);
    assert.equal(!down.valid && down.reason, 'unavailable');
  });
});
