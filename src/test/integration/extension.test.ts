import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { LocalTimeLedgerApi } from '../../extension';
import { GUMROAD_PRODUCT_ID } from '../../pro/gumroad';
import { serializeStoredLicense } from '../../pro/storedLicense';

const ID = 'tidyloom.local-time-ledger';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Local Time Ledger in the editor', () => {
  let api: LocalTimeLedgerApi;

  before(async () => {
    const ext = vscode.extensions.getExtension<LocalTimeLedgerApi>(ID);
    assert.ok(ext, 'extension is installed');
    api = await ext.activate();
  });

  it('registers its commands', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const c of [
      'showReport',
      'openDataFolder',
      'pause',
      'resume',
      'refresh',
      'exportTimesheet',
      'enterLicense',
      'recheckLicense',
      'removeLicense',
      'aboutPro',
      'editSessions',
      'undoSessionEdit',
    ]) {
      assert.ok(all.includes(`localTimeLedger.${c}`), c);
    }
  });

  it('starts in the free edition with no key and keeps the 30 day history', async () => {
    assert.equal(api.license.isPro(), false);
    assert.equal(api.license.current().tier, 'free');
    assert.equal((await api.summary()).history.label, 'Last 30 days');
  });

  it('contributes the license commands with the exact titles', () => {
    const ext = vscode.extensions.getExtension(ID);
    const pkg = ext?.packageJSON as { contributes: { commands: Array<{ command: string; title: string; category: string }> } };
    const titles = new Map(pkg.contributes.commands.map((c) => [c.command, `${c.category}: ${c.title}`]));
    assert.equal(titles.get('localTimeLedger.enterLicense'), 'Local Time Ledger: Enter Pro License Key');
    assert.equal(titles.get('localTimeLedger.recheckLicense'), 'Local Time Ledger: Re-check Pro License');
    assert.equal(titles.get('localTimeLedger.removeLicense'), 'Local Time Ledger: Remove Pro License');
  });

  it('does not export a timesheet without a Pro license', async () => {
    const target = path.join(os.tmpdir(), `ltl-free-${String(process.pid)}.csv`);
    const written = await vscode.commands.executeCommand('localTimeLedger.exportTimesheet', {
      format: 'csv',
      firstDay: '2024-01-01',
      lastDay: '2030-12-31',
      target,
      quiet: true,
    });
    assert.equal(written, undefined);
    assert.equal(fs.existsSync(target), false);
  });

  it('tracks editing time and writes a JSON Lines file', async function () {
    const folder = process.env.LTL_TEST_WORKSPACE;
    assert.ok(folder);
    const doc = await vscode.workspace.openTextDocument(path.join(folder, 'example.ts'));
    const editor = await vscode.window.showTextDocument(doc);
    // Window focus is not guaranteed under xvfb. Activity is only counted in a focused window.
    if (!vscode.window.state.focused) {
      this.skip();
    }
    for (let i = 0; i < 3; i++) {
      await editor.edit((b) => {
        b.insert(new vscode.Position(0, 0), `// edit ${String(i)}\n`);
      });
      await sleep(400);
    }
    await api.flush();
    const files = fs.readdirSync(api.dataFolder).filter((f) => f.endsWith('.jsonl'));
    assert.equal(files.length, 1);
    const lines = fs.readFileSync(path.join(api.dataFolder, files[0] ?? ''), 'utf8').trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1] ?? '{}') as Record<string, unknown>;
    assert.equal(last.v, 1);
    assert.equal(last.language, 'typescript');
    assert.match(String(last.project), /^demo-project-/);
    const summary = await api.summary();
    assert.ok(summary.today.total >= 800, `today total ${String(summary.today.total)}`);
    await vscode.commands.executeCommand('workbench.action.files.revert');
  });

  it('opens the report as a markdown document', async () => {
    await vscode.commands.executeCommand('localTimeLedger.showReport');
    const doc = vscode.window.activeTextEditor?.document;
    assert.equal(doc?.languageId, 'markdown');
    assert.match(doc.getText(), /# Local Time Ledger report/);
    assert.match(doc.getText(), /## Today: /);
  });

  it('pauses and resumes without errors', async () => {
    await vscode.commands.executeCommand('localTimeLedger.pause');
    await vscode.commands.executeCommand('localTimeLedger.resume');
  });

  it('with a stored Pro license shows all time history and exports CSV, Markdown and HTML', async () => {
    const testing = api.testing;
    assert.ok(testing, 'test hooks exist in the test host');
    // An old month, far outside the free 30 days.
    fs.mkdirSync(api.dataFolder, { recursive: true });
    const oldStart = new Date(2024, 5, 3, 9).getTime();
    fs.writeFileSync(
      path.join(api.dataFolder, 'ledger-2024-06.jsonl'),
      JSON.stringify({
        v: 1,
        start: new Date(oldStart).toISOString(),
        end: new Date(oldStart + 2 * 3_600_000).toISOString(),
        project: 'old-project',
        language: 'go',
      }) + '\n',
    );
    await vscode.commands.executeCommand('localTimeLedger.refresh');
    const free = await api.summary();
    assert.equal(free.history.label, 'Last 30 days');
    assert.equal(free.days.some((d) => d.day === '2024-06-03'), false);

    await testing.setStoredLicense(
      serializeStoredLicense({
        productId: GUMROAD_PRODUCT_ID,
        licenseKey: 'FAKEFAKE-00000000-00000000-00000000',
        saleId: 'FAKE-SALE',
        uses: 1,
        mode: 'activation',
        checkedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    assert.equal(api.license.isPro(), true);
    const s = await api.summary();
    assert.equal(s.history.label, 'All time');
    assert.ok(s.history.total >= 2 * 3_600_000);
    assert.ok(s.days.some((d) => d.day === '2024-06-03'));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltl-export-'));
    const expect: Array<['csv' | 'markdown' | 'html', string, RegExp]> = [
      ['csv', 'sheet.csv', /^Date,Project,Hours,Minutes\r\n2024-06-03,old-project,2\.00,120\r\n/],
      ['markdown', 'sheet.md', /\| 2024-06-03 \| old-project \| 2\.00 \| 2h 00m \|/],
      ['html', 'sheet.html', /<td>2024-06-03<\/td><td>old-project<\/td><td class="num">2\.00<\/td>/],
    ];
    for (const [format, name, re] of expect) {
      const target = path.join(dir, name);
      const written = await vscode.commands.executeCommand('localTimeLedger.exportTimesheet', {
        format,
        firstDay: '2024-06-01',
        lastDay: '2024-06-30',
        project: '',
        target,
        quiet: true,
      });
      assert.equal(written, target);
      assert.match(fs.readFileSync(target, 'utf8'), re);
    }

    const config = vscode.workspace.getConfiguration('localTimeLedger');
    await config.update('clients', { 'old-project': { client: 'Example Client', hourlyRate: 50, currency: 'EUR' } }, vscode.ConfigurationTarget.Global);
    try {
      const priced = path.join(dir, 'priced.csv');
      const written = await vscode.commands.executeCommand('localTimeLedger.exportTimesheet', {
        format: 'csv',
        firstDay: '2024-06-01',
        lastDay: '2024-06-30',
        project: '',
        target: priced,
        quiet: true,
      });
      assert.equal(written, priced);
      assert.equal(
        fs.readFileSync(priced, 'utf8'),
        'Date,Project,Hours,Minutes,Client,Hourly rate,Currency,Amount,Billable hours,Billable minutes\r\n2024-06-03,old-project,2.00,120,Example Client,50,EUR,100.00,2.00,120\r\n',
      );
    } finally {
      await config.update('clients', undefined, vscode.ConfigurationTarget.Global);
    }

    await vscode.commands.executeCommand('localTimeLedger.removeLicense', { skipConfirm: true });
    assert.equal(api.license.isPro(), false);
    assert.equal((await api.summary()).history.label, 'Last 30 days');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('edits, splits, merges, deletes and undoes sessions only with a Pro license', async () => {
    const testing = api.testing;
    assert.ok(testing, 'test hooks exist in the test host');
    fs.mkdirSync(api.dataFolder, { recursive: true });
    const file = path.join(api.dataFolder, 'ledger-2023-03.jsonl');
    const t0 = new Date(2023, 2, 6, 9).getTime();
    const line = (a: number, b: number): string =>
      JSON.stringify({ v: 1, start: new Date(a).toISOString(), end: new Date(b).toISOString(), project: 'edit-project', language: 'go' });
    const original = line(t0, t0 + 3_600_000) + '\n';
    fs.writeFileSync(file, original);
    const ref = { start: new Date(t0).toISOString(), project: 'edit-project' };

    // Free edition: nothing is edited and the file is untouched.
    assert.equal(api.license.isPro(), false);
    const refused = await vscode.commands.executeCommand('localTimeLedger.editSessions', { ...ref, op: 'delete' });
    assert.equal(refused, false);
    assert.equal(fs.readFileSync(file, 'utf8'), original);

    await testing.setStoredLicense(
      serializeStoredLicense({
        productId: GUMROAD_PRODUCT_ID,
        licenseKey: 'FAKEFAKE-00000000-00000000-00000000',
        saleId: 'FAKE-SALE',
        uses: 1,
        mode: 'activation',
        checkedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    try {
      const split = await vscode.commands.executeCommand('localTimeLedger.editSessions', {
        ...ref,
        op: 'split',
        splitAt: new Date(t0 + 1_800_000).toISOString(),
      });
      assert.equal(split, true);
      assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 2);
      const merged = await vscode.commands.executeCommand('localTimeLedger.editSessions', { ...ref, op: 'merge-next' });
      assert.equal(merged, true);
      assert.equal(fs.readFileSync(file, 'utf8'), original);
      const edited = await vscode.commands.executeCommand('localTimeLedger.editSessions', { ...ref, op: 'edit', note: 'fixed', client: 'Acme' });
      assert.equal(edited, true);
      assert.match(fs.readFileSync(file, 'utf8'), /"note":"fixed","client":"Acme"/);
      const bad = await vscode.commands.executeCommand('localTimeLedger.editSessions', {
        ...ref,
        op: 'edit',
        newEnd: new Date(t0 - 60_000).toISOString(),
      });
      assert.equal(bad, false);
      const deleted = await vscode.commands.executeCommand('localTimeLedger.editSessions', { ...ref, op: 'delete' });
      assert.equal(deleted, true);
      assert.equal(fs.readFileSync(file, 'utf8'), '');
      for (let i = 0; i < 5; i++) {
        await vscode.commands.executeCommand('localTimeLedger.undoSessionEdit');
      }
      assert.equal(fs.readFileSync(file, 'utf8'), original);
    } finally {
      await vscode.commands.executeCommand('localTimeLedger.removeLicense', { skipConfirm: true });
      fs.rmSync(file, { force: true });
    }
  });
  it('tags sessions billable, splits into billable parts and exports billable hours per client', async () => {
    const testing = api.testing;
    assert.ok(testing, 'test hooks exist in the test host');
    fs.mkdirSync(api.dataFolder, { recursive: true });
    const file = path.join(api.dataFolder, 'ledger-2022-05.jsonl');
    const t0 = new Date(2022, 4, 9, 9).getTime();
    // A line in the 0.3.0 format, without note, client or billable.
    const original =
      JSON.stringify({ v: 1, start: new Date(t0).toISOString(), end: new Date(t0 + 2 * 3_600_000).toISOString(), project: 'bill-project', language: 'go' }) + '\n';
    fs.writeFileSync(file, original);
    const ref = { start: new Date(t0).toISOString(), project: 'bill-project' };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltl-billable-'));
    const exportCsv = async (name: string): Promise<string> => {
      const target = path.join(dir, name);
      await vscode.commands.executeCommand('localTimeLedger.exportTimesheet', {
        format: name.endsWith('.md') ? 'markdown' : 'csv',
        firstDay: '2022-05-09',
        lastDay: '2022-05-09',
        project: '',
        target,
        quiet: true,
      });
      return fs.readFileSync(target, 'utf8');
    };

    assert.equal(api.license.isPro(), false);
    const refused = await vscode.commands.executeCommand('localTimeLedger.editSessions', { ...ref, op: 'edit', billable: 'billable' });
    assert.equal(refused, false);
    assert.equal(fs.readFileSync(file, 'utf8'), original);

    await testing.setStoredLicense(
      serializeStoredLicense({
        productId: GUMROAD_PRODUCT_ID,
        licenseKey: 'FAKEFAKE-00000000-00000000-00000000',
        saleId: 'FAKE-SALE',
        uses: 1,
        mode: 'activation',
        checkedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    const config = vscode.workspace.getConfiguration('localTimeLedger');
    await config.update('clients', { 'bill-project': { client: 'Example Client', hourlyRate: 60, currency: 'EUR' } }, vscode.ConfigurationTarget.Global);
    try {
      // Untagged time in a priced project is billable by default, so the old amount is unchanged.
      assert.match(await exportCsv('a.csv'), /\r\n2022-05-09,bill-project,2\.00,120,Example Client,60,EUR,120\.00,2\.00,120\r\n$/);

      const split = await vscode.commands.executeCommand('localTimeLedger.editSessions', {
        ...ref,
        op: 'split',
        splitAt: new Date(t0 + 3_600_000).toISOString(),
        firstBillable: 'billable',
        secondBillable: 'non-billable',
      });
      assert.equal(split, true);
      const text = fs.readFileSync(file, 'utf8');
      assert.match(text, /"billable":true/);
      assert.match(text, /"billable":false/);
      assert.match(await exportCsv('b.csv'), /\r\n2022-05-09,bill-project,2\.00,120,Example Client,60,EUR,60\.00,1\.00,60\r\n$/);

      // Billable and non-billable parts cannot be merged back silently.
      const merge = await vscode.commands.executeCommand('localTimeLedger.editSessions', { ...ref, op: 'merge-next' });
      assert.equal(merge, false);

      const relabel = await vscode.commands.executeCommand('localTimeLedger.editSessions', { ...ref, op: 'edit', client: 'Other Client' });
      assert.equal(relabel, true);
      const md = await exportCsv('c.md');
      assert.match(md, /## Billable time per client/);
      assert.match(md, /\| Example Client \| 1\.00 \| 0\.00 \| 1\.00 \| 0\.00 EUR \|/);
      assert.match(md, /\| Other Client \| 1\.00 \| 1\.00 \| 0\.00 \| 60\.00 EUR \|/);

      await config.update('billableDefault', 'never', vscode.ConfigurationTarget.Global);
      const cleared = await vscode.commands.executeCommand('localTimeLedger.editSessions', { ...ref, op: 'edit', billable: 'default' });
      assert.equal(cleared, true);
      assert.match(await exportCsv('d.csv'), /Other Client,60,EUR,0\.00,0\.00,0\r\n/);

      await assert.rejects(
        Promise.resolve(vscode.commands.executeCommand('localTimeLedger.editSessions', { ...ref, op: 'edit', billable: 'maybe' })),
        /billable tag/,
      );

      for (let i = 0; i < 3; i++) {
        assert.equal(await vscode.commands.executeCommand('localTimeLedger.undoSessionEdit'), true);
      }
      assert.equal(fs.readFileSync(file, 'utf8'), original);
    } finally {
      await config.update('clients', undefined, vscode.ConfigurationTarget.Global);
      await config.update('billableDefault', undefined, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('localTimeLedger.removeLicense', { skipConfirm: true });
      fs.rmSync(file, { force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
