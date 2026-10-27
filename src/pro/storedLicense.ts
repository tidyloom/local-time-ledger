/**
 * Local storage format for a Pro license that passed the Gumroad check.
 * Pure code: no network, no file or editor API. The extension keeps the text in its
 * globalState on this machine (not synced).
 *
 * Only the fields of StoredLicense are kept. No buyer name or email is ever stored.
 */

import type { LicenseProvider, LicenseState } from './license';
import type { CheckMode, StoredLicense } from './gumroad';

/** Bump when the stored shape changes. Unknown versions are ignored, never guessed. */
export const STORED_LICENSE_VERSION = 1;

interface StoredLicenseFile {
  readonly v: number;
  readonly license: StoredLicense;
}

export function serializeStoredLicense(license: StoredLicense): string {
  const file: StoredLicenseFile = { v: STORED_LICENSE_VERSION, license };
  return JSON.stringify(file);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isMode(v: unknown): v is CheckMode {
  return v === 'activation' || v === 'recheck';
}

/**
 * Parses stored text back into a license. Returns undefined for anything that is not a
 * complete, current-version record, so a damaged or hand-edited file falls back to Free
 * instead of throwing.
 */
export function parseStoredLicense(text: string | undefined): StoredLicense | undefined {
  if (text === undefined || text.length === 0) {
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const file = raw as Record<string, unknown>;
  if (file.v !== STORED_LICENSE_VERSION) {
    return undefined;
  }
  const l = file.license;
  if (typeof l !== 'object' || l === null || Array.isArray(l)) {
    return undefined;
  }
  const r = l as Record<string, unknown>;
  if (
    !isNonEmptyString(r.productId) ||
    !isNonEmptyString(r.licenseKey) ||
    typeof r.saleId !== 'string' ||
    typeof r.uses !== 'number' ||
    !Number.isInteger(r.uses) ||
    r.uses < 0 ||
    !isMode(r.mode) ||
    typeof r.checkedAt !== 'string' ||
    Number.isNaN(Date.parse(r.checkedAt))
  ) {
    return undefined;
  }
  return {
    productId: r.productId,
    licenseKey: r.licenseKey,
    saleId: r.saleId,
    uses: r.uses,
    mode: r.mode,
    checkedAt: r.checkedAt,
  };
}

/** Pro when a stored license exists for the expected product, otherwise Free. */
export class StoredLicenseProvider implements LicenseProvider {
  private readonly license: StoredLicense | undefined;

  constructor(storedText: string | undefined, expectedProductId: string) {
    const parsed = parseStoredLicense(storedText);
    this.license = parsed !== undefined && parsed.productId === expectedProductId ? parsed : undefined;
  }

  current(): LicenseState {
    return this.license === undefined ? { tier: 'free', label: 'Free edition' } : { tier: 'pro', label: 'Pro edition' };
  }

  isPro(): boolean {
    return this.license !== undefined;
  }
}
