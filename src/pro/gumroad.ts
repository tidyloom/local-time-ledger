/**
 * Pure helpers for the Pro activation with Gumroad license keys.
 * No network code lives here. The one network call is in transport.ts.
 *
 * The activation runs only when the user starts it. It sends exactly
 * two things to Gumroad: the public product id and the license key the user pasted, plus
 * the increment_uses_count flag. Endpoint: POST https://api.gumroad.com/v2/licenses/verify
 * (form encoded). Gumroad says this endpoint "does not require an OAuth application",
 * so no secret token is needed or shipped. The result is stored locally and the extension
 * never contacts Gumroad again unless the user starts a re-check.
 *
 * Docs checked 2026-10-27: https://gumroad.com/help/article/76-license-keys and
 * https://gumroad.com/api (section "Licenses").
 */

export const GUMROAD_VERIFY_URL = 'https://api.gumroad.com/v2/licenses/verify';

/**
 * Public Gumroad product id of Local Time Ledger Pro (seller tidyloomdev, permalink hsflch).
 * It is shown in the License key block on the product's content page. It is public, not a
 * secret, and it is sent to Gumroad together with the license key the user pastes.
 */
export const GUMROAD_PRODUCT_ID = '6ygdMSSV3yuxuAeozXFVmQ==';

/** The Gumroad product page, opened in the browser only when the user asks for it. */
export const GUMROAD_PRODUCT_URL = 'https://tidyloomdev.gumroad.com/l/hsflch';

/** One purchase may be activated on at most this many machines. */
export const MAX_MACHINES = 3;

/** First activation counts a machine. A re-check the user starts does not. */
export type CheckMode = 'activation' | 'recheck';

export interface VerifyRequest {
  readonly url: string;
  readonly method: 'POST';
  readonly headers: { readonly 'Content-Type': 'application/x-www-form-urlencoded' };
  /** The exact form fields sent, kept for display in the activation dialog. */
  readonly fields: {
    readonly product_id: string;
    readonly license_key: string;
    readonly increment_uses_count: 'true' | 'false';
  };
  /** The form encoded body built from fields. */
  readonly body: string;
}

/** What the extension keeps on disk after a valid check. No buyer email or name is kept. */
export interface StoredLicense {
  readonly productId: string;
  readonly licenseKey: string;
  readonly saleId: string;
  readonly uses: number;
  readonly mode: CheckMode;
  readonly checkedAt: string;
}

export type InvalidReason =
  | 'invalid-key'
  | 'wrong-product'
  | 'refunded'
  | 'disputed'
  | 'chargebacked'
  | 'too-many-machines'
  | 'unavailable'
  | 'bad-response';

export type LicenseCheckResult =
  | { readonly valid: true; readonly license: StoredLicense }
  | { readonly valid: false; readonly reason: InvalidReason; readonly message: string };

/**
 * Builds the verify request. Trims the key and rejects an empty key or product id
 * before any call could be made.
 */
export function buildVerifyRequest(rawKey: string, mode: CheckMode, productId: string = GUMROAD_PRODUCT_ID): VerifyRequest | undefined {
  const licenseKey = rawKey.trim();
  const id = productId.trim();
  if (licenseKey.length === 0 || id.length === 0) {
    return undefined;
  }
  const fields = {
    product_id: id,
    license_key: licenseKey,
    increment_uses_count: mode === 'activation' ? 'true' : 'false',
  } as const;
  return {
    url: GUMROAD_VERIFY_URL,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    fields,
    body: new URLSearchParams(fields).toString(),
  };
}

function invalid(reason: InvalidReason, message: string): LicenseCheckResult {
  return { valid: false, reason, message };
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/**
 * Turns Gumroad's HTTP status and JSON body into a result that can be stored as is.
 * Valid only when success is true and the purchase is not refunded, disputed or chargebacked,
 * and the uses count is within MAX_MACHINES.
 *
 * Machine limit: Gumroad counts every call with increment_uses_count=true, including one
 * that we then reject, and the count cannot be lowered without the seller's secret token.
 * So the limit is enforced on activation only. A re-check (increment false) on a machine that
 * was already activated does not fail just because a rejected 4th activation raised the count.
 */
export function parseVerifyResponse(
  httpStatus: number,
  body: unknown,
  request: Pick<VerifyRequest, 'fields'>,
  now: Date,
): LicenseCheckResult {
  if (httpStatus === 404) {
    return invalid('invalid-key', 'Gumroad does not recognize this license key for Local Time Ledger Pro. Check that it was pasted in full.');
  }
  if (httpStatus !== 200) {
    return invalid('unavailable', `Gumroad could not check the key right now (HTTP ${String(httpStatus)}). Nothing was stored. Try again later.`);
  }
  const b = asRecord(body);
  if (b === undefined) {
    return invalid('bad-response', 'Unexpected reply from Gumroad.');
  }
  if (b.success !== true) {
    return invalid('invalid-key', 'Gumroad did not confirm this license key.');
  }
  const purchase = asRecord(b.purchase);
  const uses = b.uses;
  if (purchase === undefined || typeof uses !== 'number' || !Number.isInteger(uses) || uses < 0) {
    return invalid('bad-response', 'Gumroad confirmed the key but the reply was incomplete.');
  }
  if (typeof purchase.product_id === 'string' && purchase.product_id !== request.fields.product_id) {
    return invalid('wrong-product', 'This license key belongs to a different Gumroad product.');
  }
  // Each flag must be present and exactly false. A missing flag is not treated as false.
  if (purchase.refunded !== false) {
    return invalid('refunded', 'This purchase was refunded, so the key is no longer valid.');
  }
  if (purchase.disputed !== false) {
    return invalid('disputed', 'This purchase is disputed, so the key is not valid right now.');
  }
  if (purchase.chargebacked !== false) {
    return invalid('chargebacked', 'This purchase was charged back, so the key is no longer valid.');
  }
  const mode: CheckMode = request.fields.increment_uses_count === 'true' ? 'activation' : 'recheck';
  if (mode === 'activation' && uses > MAX_MACHINES) {
    return invalid(
      'too-many-machines',
      `This key is already active on ${String(MAX_MACHINES)} machines, the limit for one purchase. Contact support to move it to a new machine.`,
    );
  }
  const saleId = typeof purchase.sale_id === 'string' ? purchase.sale_id : '';
  return {
    valid: true,
    license: {
      productId: request.fields.product_id,
      licenseKey: request.fields.license_key,
      saleId,
      uses,
      mode,
      checkedAt: now.toISOString(),
    },
  };
}
