import * as path from 'node:path';
import * as vscode from 'vscode';
import { allTimeHistory, freeHistory, historyStart, renderMarkdown, summarize, type Summary } from './core/report';
import type { Segment } from './core/segment';
import { LedgerStore } from './core/store';
import { formatDuration, MINUTE, startOfNextDay } from './core/time';
import { Tracker, type ActivityContext } from './core/tracker';
import { GUMROAD_PRODUCT_ID } from './pro/gumroad';
import type { LicenseProvider } from './pro/license';
import { StoredLicenseProvider } from './pro/storedLicense';
import { registerProCommands, LICENSE_STATE_KEY } from './proCommands';
import { SummaryTreeProvider } from './view';

const TICK_MS = 30_000;
const FLUSH_MS = 60_000;

/** Returned from activate. Used by the integration tests. */
export interface LocalTimeLedgerApi {
  readonly dataFolder: string;
  readonly license: LicenseProvider;
  flush(): Promise<void>;
  summary(): Promise<Summary>;
  /** Present only when the extension runs in its own test host. Never in normal use. */
  readonly testing?: {
    setStoredLicense(text: string | undefined): Promise<void>;
  };
}

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('localTimeLedger');
}

function idleMs(): number {
  const minutes = config().get<number>('idleMinutes', 5);
  return Math.min(60, Math.max(1, Number.isFinite(minutes) ? minutes : 5)) * MINUTE;
}

function projectName(): string {
  const custom = config().get<string>('projectName', '').trim();
  if (custom !== '') {
    return custom;
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  return vscode.workspace.name ?? (folder ? path.basename(folder.uri.path) : '(no workspace)');
}

function currentContext(): ActivityContext {
  const editor = vscode.window.activeTextEditor;
  return { project: projectName(), language: editor?.document.languageId ?? 'other' };
}

export function activate(context: vscode.ExtensionContext): LocalTimeLedgerApi {
  const store = new LedgerStore(path.join(context.globalStorageUri.fsPath, 'ledger'));
  const tracker = new Tracker({ idleMs: idleMs(), now: () => Date.now() });
  // The license lives in globalState on this machine and is not synced. Reading it is local.
  let license: LicenseProvider = new StoredLicenseProvider(context.globalState.get<string>(LICENSE_STATE_KEY), GUMROAD_PRODUCT_ID);
  const tree = new SummaryTreeProvider();
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'localTimeLedger.showReport';

  // Segments read from disk for the history window, plus what this window wrote since.
  let cache: Segment[] = [];
  let cacheTo = 0;
  let cachePro = false;
  let reloading: Promise<void> | undefined;

  const reload = (): Promise<void> => {
    reloading ??= (async () => {
      const now = Date.now();
      const pro = license.isPro();
      // Free reads the last 30 days. Pro reads every ledger file there is.
      const from = pro ? ((await store.earliestMonth()) ?? historyStart(now)) : historyStart(now);
      const to = startOfNextDay(now);
      const result = await store.read(from, to);
      cache = result.segments;
      cacheTo = to;
      cachePro = pro;
    })().finally(() => {
      reloading = undefined;
    });
    return reloading;
  };

  const currentSummary = async (): Promise<Summary> => {
    const now = Date.now();
    if (now >= cacheTo || cachePro !== license.isPro()) {
      await reload();
    }
    const segments = [...cache, ...tracker.peek()];
    return summarize(segments, now, license.isPro() ? allTimeHistory(segments, now) : freeHistory(now));
  };

  const render = async (): Promise<void> => {
    const s = await currentSummary();
    tree.update(s);
    if (config().get<boolean>('showStatusBar', true)) {
      const paused = tracker.paused ? ' (paused)' : '';
      status.text = `$(clock) ${formatDuration(s.today.total)}${paused}`;
      const thisProject = s.today.byProject.find(([p]) => p === projectName());
      status.tooltip = [
        `Local Time Ledger${paused}`,
        `Today: ${formatDuration(s.today.total)}`,
        `This project today: ${formatDuration(thisProject ? thisProject[1] : 0)}`,
        `This week: ${formatDuration(s.week.total)}`,
        license.current().label,
        'Click for the full report. Data stays on this machine.',
      ].join('\n');
      status.show();
    } else {
      status.hide();
    }
  };

  const flush = async (): Promise<void> => {
    const segments = tracker.drain();
    if (segments.length > 0) {
      await store.append(segments);
      cache.push(...segments);
    }
  };

  const safe = (work: () => Promise<void>): void => {
    work().catch((err: unknown) => {
      console.error('[local-time-ledger]', err);
    });
  };

  const onActivity = (): void => {
    if (vscode.window.state.focused) {
      tracker.activity(currentContext());
    }
  };

  context.subscriptions.push(
    status,
    tree,
    vscode.window.registerTreeDataProvider('localTimeLedger.summary', tree),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length > 0 && e.document === vscode.window.activeTextEditor?.document) {
        onActivity();
      }
    }),
    vscode.workspace.onDidSaveTextDocument(onActivity),
    vscode.window.onDidChangeTextEditorSelection(onActivity),
    vscode.window.onDidChangeActiveTextEditor(onActivity),
    vscode.window.onDidChangeTextEditorVisibleRanges(onActivity),
    vscode.window.onDidChangeActiveTerminal(onActivity),
    vscode.debug.onDidStartDebugSession(onActivity),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        onActivity();
        safe(async () => {
          await reload();
          await render();
        });
      } else {
        tracker.stop();
        safe(flush);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('localTimeLedger')) {
        tracker.setIdleMs(idleMs());
        safe(render);
      }
    }),
    vscode.commands.registerCommand('localTimeLedger.showReport', async () => {
      await flush();
      await reload();
      const s = await currentSummary();
      const doc = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: renderMarkdown(s, Date.now(), store.dir, license.current().label),
      });
      await vscode.window.showTextDocument(doc, { preview: false });
    }),
    vscode.commands.registerCommand('localTimeLedger.openDataFolder', async () => {
      await flush();
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(store.fileFor(Date.now())));
    }),
    vscode.commands.registerCommand('localTimeLedger.pause', async () => {
      tracker.pause();
      await flush();
      await render();
    }),
    vscode.commands.registerCommand('localTimeLedger.resume', async () => {
      tracker.resume();
      onActivity();
      await render();
    }),
    vscode.commands.registerCommand('localTimeLedger.refresh', async () => {
      await flush();
      await reload();
      await render();
    }),
  );

  const setStoredLicense = async (text: string | undefined): Promise<void> => {
    await context.globalState.update(LICENSE_STATE_KEY, text);
    license = new StoredLicenseProvider(text, GUMROAD_PRODUCT_ID);
    await reload();
    await render();
  };

  registerProCommands(context, {
    license: () => license,
    storedText: () => context.globalState.get<string>(LICENSE_STATE_KEY),
    setStoredLicense,
    flush,
    readAll: async () => {
      const now = Date.now();
      const from = (await store.earliestMonth()) ?? historyStart(now);
      const result = await store.read(from, startOfNextDay(now));
      return [...result.segments, ...tracker.peek()];
    },
  });

  const tick = setInterval(() => {
    tracker.tick();
    safe(render);
  }, TICK_MS);
  const flusher = setInterval(() => {
    safe(flush);
  }, FLUSH_MS);
  context.subscriptions.push({
    dispose: () => {
      clearInterval(tick);
      clearInterval(flusher);
      tracker.stop();
      try {
        store.appendSync(tracker.drain());
      } catch (err) {
        console.error('[local-time-ledger]', err);
      }
    },
  });

  onActivity();
  safe(async () => {
    await reload();
    await render();
  });

  return {
    dataFolder: store.dir,
    get license() {
      return license;
    },
    flush,
    summary: currentSummary,
    ...(context.extensionMode === vscode.ExtensionMode.Test ? { testing: { setStoredLicense } } : {}),
  };
}

export function deactivate(): void {
  // Final flush happens in the disposable registered in activate.
}
