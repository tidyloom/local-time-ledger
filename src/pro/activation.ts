/**
 * Runs one license check through an injected transport. Pure apart from the transport, so the
 * whole flow is unit tested with a fake one. The real transport is in transport.ts.
 */

import { buildVerifyRequest, GUMROAD_PRODUCT_ID, parseVerifyResponse, type CheckMode, type LicenseCheckResult, type VerifyRequest } from './gumroad';

export interface TransportResponse {
  readonly status: number;
  /** Parsed JSON body, or undefined when the body was not JSON. */
  readonly body: unknown;
}

export type Transport = (request: VerifyRequest) => Promise<TransportResponse>;

/**
 * Makes exactly one verify call for the key, or none when the key is empty.
 * Network failures become an 'unavailable' result instead of throwing.
 */
export async function checkLicense(
  rawKey: string,
  mode: CheckMode,
  transport: Transport,
  now: () => Date,
  productId: string = GUMROAD_PRODUCT_ID,
): Promise<LicenseCheckResult> {
  const request = buildVerifyRequest(rawKey, mode, productId);
  if (request === undefined) {
    return { valid: false, reason: 'invalid-key', message: 'No license key was entered. Nothing was sent.' };
  }
  let response: TransportResponse;
  try {
    response = await transport(request);
  } catch {
    return {
      valid: false,
      reason: 'unavailable',
      message: 'Could not reach Gumroad. Check the connection and try again. Nothing was changed.',
    };
  }
  return parseVerifyResponse(response.status, response.body, request, now());
}

/**
 * What a re-check does with the stored license. A definite "no" from Gumroad removes it.
 * A failed or unclear call keeps it, so being offline never takes Pro away.
 */
export function recheckAction(result: LicenseCheckResult): 'update' | 'remove' | 'keep' {
  if (result.valid) {
    return 'update';
  }
  return result.reason === 'unavailable' || result.reason === 'bad-response' ? 'keep' : 'remove';
}
