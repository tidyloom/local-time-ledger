import * as assert from 'node:assert/strict';
import { checkLicense, recheckAction, type Transport } from '../../pro/activation';
import type { VerifyRequest } from '../../pro/gumroad';

const PRODUCT = 'FAKE-PRODUCT-ID-000==';
const KEY = 'FAKEFAKE-00000000-00000000-00000000';
const NOW = () => new Date('2026-01-01T00:00:00.000Z');

function fake(status: number, body: unknown): { transport: Transport; calls: VerifyRequest[] } {
  const calls: VerifyRequest[] = [];
  return {
    calls,
    transport: (r) => {
      calls.push(r);
      return Promise.resolve({ status, body });
    },
  };
}

const ok = (uses = 1) => ({
  success: true,
  uses,
  purchase: { product_id: PRODUCT, sale_id: 'FAKE-SALE', refunded: false, disputed: false, chargebacked: false },
});

describe('license check flow', () => {
  it('makes exactly one call per activation, with increment true', async () => {
    const f = fake(200, ok());
    const r = await checkLicense(` ${KEY} `, 'activation', f.transport, NOW, PRODUCT);
    assert.ok(r.valid);
    assert.equal(f.calls.length, 1);
    const call = f.calls[0];
    assert.ok(call);
    assert.equal(call.url, 'https://api.gumroad.com/v2/licenses/verify');
    assert.equal(call.fields.increment_uses_count, 'true');
    assert.equal(call.fields.license_key, KEY);
  });

  it('re-check sends increment false', async () => {
    const f = fake(200, ok(5));
    const r = await checkLicense(KEY, 'recheck', f.transport, NOW, PRODUCT);
    assert.ok(r.valid);
    assert.equal(f.calls[0]?.fields.increment_uses_count, 'false');
  });

  it('sends nothing for an empty key', async () => {
    const f = fake(200, ok());
    const r = await checkLicense('   ', 'activation', f.transport, NOW, PRODUCT);
    assert.equal(r.valid, false);
    assert.equal(f.calls.length, 0);
  });

  it('turns a network failure into unavailable', async () => {
    const r = await checkLicense(KEY, 'activation', () => Promise.reject(new Error('offline')), NOW, PRODUCT);
    assert.ok(!r.valid);
    assert.equal(r.reason, 'unavailable');
  });

  it('re-check keeps Pro when Gumroad cannot be reached and removes it on a definite no', async () => {
    assert.equal(recheckAction(await checkLicense(KEY, 'recheck', fake(200, ok()).transport, NOW, PRODUCT)), 'update');
    assert.equal(recheckAction(await checkLicense(KEY, 'recheck', fake(503, undefined).transport, NOW, PRODUCT)), 'keep');
    assert.equal(recheckAction(await checkLicense(KEY, 'recheck', fake(200, 'nope').transport, NOW, PRODUCT)), 'keep');
    assert.equal(recheckAction(await checkLicense(KEY, 'recheck', fake(404, { success: false }).transport, NOW, PRODUCT)), 'remove');
    const refunded = { ...ok(), purchase: { ...ok().purchase, refunded: true } };
    assert.equal(recheckAction(await checkLicense(KEY, 'recheck', fake(200, refunded).transport, NOW, PRODUCT)), 'remove');
  });
});
