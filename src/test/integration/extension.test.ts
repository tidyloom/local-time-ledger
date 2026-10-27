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

    await vscode.commands.executeCommand('localTimeLedger.removeLicense', { skipConfirm: true });
    assert.equal(api.license.isPro(), false);
    assert.equal((await api.summary()).history.label, 'Last 30 days');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
