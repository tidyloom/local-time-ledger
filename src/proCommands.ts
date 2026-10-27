/**
 * Pro commands: enter, re-check and remove the license key, and the timesheet export.
 * The license commands are the only code that can reach the network, through postVerify,
 * and only when the user runs them.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  buildTimesheet,
  customRange,
  defaultFileName,
  presetRanges,
  renderTimesheet,
  type DateRange,
  type TimesheetFormat,
} from './core/export';
import { allTimeHistory } from './core/report';
import type { Segment } from './core/segment';
import { startOfNextDay } from './core/time';
import { checkLicense, recheckAction } from './pro/activation';
import { GUMROAD_PRODUCT_URL } from './pro/gumroad';
import type { LicenseProvider } from './pro/license';
import { parseStoredLicense, serializeStoredLicense } from './pro/storedLicense';
import { postVerify } from './pro/transport';

export const LICENSE_STATE_KEY = 'localTimeLedger.proLicense';

export interface ProHost {
  license(): LicenseProvider;
  storedText(): string | undefined;
  setStoredLicense(text: string | undefined): Promise<void>;
  flush(): Promise<void>;
  /** Every tracked segment, all time, including what this window has not written yet. */
  readAll(): Promise<Segment[]>;
}

/** Arguments that let a caller (or a test) skip the pickers. All are optional. */
export interface ExportArgs {
  readonly format?: TimesheetFormat;
  /** Inclusive local days, YYYY-MM-DD. */
  readonly firstDay?: string;
  readonly lastDay?: string;
  readonly project?: string;
  /** Absolute file path to write. */
  readonly target?: string;
  /** Do not offer to open the file afterwards. */
  readonly quiet?: boolean;
}

const ENTER = 'Enter Pro License Key';
const ABOUT = 'About Pro';

const DISCLOSURE =
  'To check the key, Local Time Ledger sends the Pro product id and the key you entered to api.gumroad.com, once, now. ' +
  'Nothing else is sent, and nothing is sent at any other time. Your time data never leaves this machine.';

async function showAboutPro(): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(GUMROAD_PRODUCT_URL));
}

async function offerPro(feature: string): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `${feature} is part of Local Time Ledger Pro. Everything in the free edition keeps working as it is.`,
    ENTER,
    ABOUT,
  );
  if (choice === ENTER) {
    await vscode.commands.executeCommand('localTimeLedger.enterLicense');
  } else if (choice === ABOUT) {
    await showAboutPro();
  }
}

async function pickRange(segments: readonly Segment[], now: number): Promise<DateRange | undefined> {
  const all = allTimeHistory(segments, now);
  const ranges: DateRange[] = [...presetRanges(now), { label: 'All time', from: all.from, to: startOfNextDay(now) }];
  const custom = 'Custom range...';
  const picked = await vscode.window.showQuickPick([...ranges.map((r) => r.label), custom], {
    title: 'Export Timesheet: date range',
    ignoreFocusOut: true,
  });
  if (picked === undefined) {
    return undefined;
  }
  if (picked !== custom) {
    return ranges.find((r) => r.label === picked);
  }
  const dayPrompt = (prompt: string) =>
    vscode.window.showInputBox({
      title: 'Export Timesheet: custom range',
      prompt,
      placeHolder: 'YYYY-MM-DD',
      ignoreFocusOut: true,
      validateInput: (v) => (customRange(v, v) ? undefined : 'Use a date like 2026-01-31.'),
    });
  const first = await dayPrompt('First day (included)');
  if (first === undefined) {
    return undefined;
  }
  const last = await dayPrompt('Last day (included)');
  if (last === undefined) {
    return undefined;
  }
  const range = customRange(first, last);
  if (!range) {
    void vscode.window.showErrorMessage('The last day must not be before the first day.');
  }
  return range;
}

async function pickProject(segments: readonly Segment[], range: DateRange): Promise<string | undefined> {
  const names = [...new Set(segments.filter((s) => s.end > range.from && s.start < range.to).map((s) => s.project))].sort((a, b) =>
    a.localeCompare(b),
  );
  if (names.length <= 1) {
    return '';
  }
  const allLabel = 'All projects';
  const picked = await vscode.window.showQuickPick([allLabel, ...names], { title: 'Export Timesheet: project', ignoreFocusOut: true });
  if (picked === undefined) {
    return undefined;
  }
  return picked === allLabel ? '' : picked;
}

async function pickFormat(): Promise<TimesheetFormat | undefined> {
  const items: Array<vscode.QuickPickItem & { format: TimesheetFormat }> = [
    { label: 'CSV', description: 'for spreadsheets and invoicing tools', format: 'csv' },
    { label: 'Markdown', description: 'plain text tables', format: 'markdown' },
    { label: 'Printable HTML', description: 'open in a browser and print or save as PDF', format: 'html' },
  ];
  const picked = await vscode.window.showQuickPick(items, { title: 'Export Timesheet: format', ignoreFocusOut: true });
  return picked?.format;
}

function defaultFolder(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder && folder.uri.scheme === 'file' ? folder.uri : vscode.Uri.file(os.homedir());
}

/** Returns the written file path, or undefined when nothing was written. */
async function exportTimesheet(host: ProHost, args: ExportArgs = {}): Promise<string | undefined> {
  if (!host.license().isPro()) {
    // Not awaited: the message stays until the user answers it, and nothing depends on it.
    void offerPro('Timesheet export');
    return undefined;
  }
  await host.flush();
  const segments = await host.readAll();
  const now = Date.now();
  let range: DateRange | undefined;
  if (args.firstDay !== undefined && args.lastDay !== undefined) {
    range = customRange(args.firstDay, args.lastDay);
    if (!range) {
      throw new Error('Invalid date range for the timesheet export.');
    }
  } else {
    range = await pickRange(segments, now);
  }
  if (!range) {
    return undefined;
  }
  const project = args.project ?? (await pickProject(segments, range));
  if (project === undefined) {
    return undefined;
  }
  const format = args.format ?? (await pickFormat());
  if (format === undefined) {
    return undefined;
  }
  const sheet = buildTimesheet(segments, range, project);
  let target: vscode.Uri | undefined;
  if (args.target !== undefined) {
    target = vscode.Uri.file(args.target);
  } else {
    const filters: Record<TimesheetFormat, Record<string, string[]>> = {
      csv: { CSV: ['csv'] },
      markdown: { Markdown: ['md'] },
      html: { HTML: ['html'] },
    };
    target = await vscode.window.showSaveDialog({
      title: 'Save timesheet',
      defaultUri: vscode.Uri.joinPath(defaultFolder(), defaultFileName(sheet, format)),
      filters: filters[format],
    });
  }
  if (!target) {
    return undefined;
  }
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(renderTimesheet(sheet, format, now)));
  if (args.quiet !== true) {
    const open = format === 'html' ? 'Open in Browser' : 'Open';
    void vscode.window.showInformationMessage(`Timesheet saved to ${path.basename(target.fsPath)}.`, open).then(async (choice) => {
      if (choice === undefined) {
        return;
      }
      if (format === 'html') {
        await vscode.env.openExternal(target);
      } else {
        await vscode.window.showTextDocument(target, { preview: false });
      }
    });
  }
  return target.fsPath;
}

async function enterLicense(host: ProHost): Promise<boolean> {
  const key = await vscode.window.showInputBox({
    title: 'Local Time Ledger: Enter Pro License Key',
    prompt: 'Paste the license key from your Gumroad receipt. The next step shows what will be sent before anything is sent.',
    placeHolder: 'XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX',
    ignoreFocusOut: true,
    password: true,
  });
  if (key === undefined || key.trim() === '') {
    return false;
  }
  const go = 'Check Key';
  const consent = await vscode.window.showInformationMessage('Check this license key with Gumroad?', { modal: true, detail: DISCLOSURE }, go);
  if (consent !== go) {
    return false;
  }
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Checking the license key with Gumroad...' },
    () => checkLicense(key, 'activation', postVerify, () => new Date()),
  );
  if (!result.valid) {
    void vscode.window.showErrorMessage(`${result.message} Pro was not activated.`);
    return false;
  }
  await host.setStoredLicense(serializeStoredLicense(result.license));
  void vscode.window.showInformationMessage(
    'Local Time Ledger Pro is active on this machine. The key is stored locally. Thank you for supporting the extension.',
  );
  return true;
}

async function recheckLicense(host: ProHost): Promise<void> {
  const stored = parseStoredLicense(host.storedText());
  if (!stored) {
    void vscode.window.showInformationMessage('No Pro license is stored on this machine, so there is nothing to re-check.');
    return;
  }
  const go = 'Re-check';
  const consent = await vscode.window.showInformationMessage('Re-check the stored license key with Gumroad?', { modal: true, detail: DISCLOSURE }, go);
  if (consent !== go) {
    return;
  }
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Re-checking the license key with Gumroad...' },
    () => checkLicense(stored.licenseKey, 'recheck', postVerify, () => new Date(), stored.productId),
  );
  switch (recheckAction(result)) {
    case 'update':
      if (result.valid) {
        await host.setStoredLicense(serializeStoredLicense(result.license));
      }
      void vscode.window.showInformationMessage('The Pro license is valid. Nothing else changed.');
      return;
    case 'keep':
      void vscode.window.showWarningMessage(`${result.valid ? '' : result.message} Pro stays active.`);
      return;
    case 'remove':
      await host.setStoredLicense(undefined);
      void vscode.window.showWarningMessage(
        `${result.valid ? '' : result.message} The stored license was removed and the free edition is active. Your data is unchanged.`,
      );
      return;
  }
}

async function removeLicense(host: ProHost, skipConfirm: boolean): Promise<void> {
  if (host.storedText() === undefined) {
    void vscode.window.showInformationMessage('No Pro license is stored on this machine.');
    return;
  }
  if (!skipConfirm) {
    const go = 'Remove';
    const choice = await vscode.window.showWarningMessage(
      'Remove the Pro license from this machine? Your tracked time is not touched. You can enter the key again later.',
      { modal: true },
      go,
    );
    if (choice !== go) {
      return;
    }
  }
  await host.setStoredLicense(undefined);
  void vscode.window.showInformationMessage('The Pro license was removed from this machine. The free edition is active.');
}

export function registerProCommands(context: vscode.ExtensionContext, host: ProHost): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('localTimeLedger.enterLicense', () => enterLicense(host)),
    vscode.commands.registerCommand('localTimeLedger.recheckLicense', () => recheckLicense(host)),
    vscode.commands.registerCommand('localTimeLedger.removeLicense', (opts?: { skipConfirm?: boolean }) =>
      removeLicense(host, opts?.skipConfirm === true),
    ),
    vscode.commands.registerCommand('localTimeLedger.exportTimesheet', (args?: ExportArgs) => exportTimesheet(host, args)),
    vscode.commands.registerCommand('localTimeLedger.aboutPro', showAboutPro),
  );
}
