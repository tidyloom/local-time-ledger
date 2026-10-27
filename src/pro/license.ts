/**
 * Boundary between the free core and Pro. Nothing here talks to the network.
 *
 * Rules for this boundary:
 * 1. Free features never ask for the tier. They work the same with or without Pro.
 * 2. Only Pro-only features (all time history, timesheet export) may check isPro().
 * 3. The tier comes from a license stored on this machine. The only network call is the
 *    Gumroad check the user starts with a command, and the README states what it sends.
 */

export type Tier = 'free' | 'pro';

export interface LicenseState {
  readonly tier: Tier;
  /** Free text shown to the user, for example "Free edition". */
  readonly label: string;
}

export interface LicenseProvider {
  current(): LicenseState;
  isPro(): boolean;
}

export class FreeLicense implements LicenseProvider {
  current(): LicenseState {
    return { tier: 'free', label: 'Free edition' };
  }

  isPro(): boolean {
    return false;
  }
}
