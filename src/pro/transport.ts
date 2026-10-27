/**
 * The only network code in Local Time Ledger. It sends one form encoded POST to the Gumroad
 * license verify endpoint, and it only runs when the user starts the Enter Pro License Key or
 * Re-check Pro License command. The lint config allows fetch in this file and nowhere else.
 */

import type { Transport } from './activation';
import { GUMROAD_VERIFY_URL } from './gumroad';

const TIMEOUT_MS = 15_000;

export const postVerify: Transport = async (request) => {
  if (request.url !== GUMROAD_VERIFY_URL) {
    throw new Error('Refusing to send a license key anywhere but the Gumroad verify endpoint.');
  }
  const response = await fetch(GUMROAD_VERIFY_URL, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return { status: response.status, body };
};
