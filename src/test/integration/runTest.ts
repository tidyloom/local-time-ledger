import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../../');
  const extensionTestsPath = path.resolve(__dirname, './index');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-project-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ltl-user-'));
  fs.writeFileSync(path.join(workspace, 'example.ts'), 'export const answer = 42;\n');
  const executable = process.env.LTL_EDITOR_EXECUTABLE;
  const version = process.env.LTL_VSCODE_VERSION;
  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      ...(executable ? { vscodeExecutablePath: executable } : { version: version ?? 'stable' }),
      launchArgs: [
        workspace,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-gpu',
        '--no-sandbox',
        `--user-data-dir=${userData}`,
      ],
      extensionTestsEnv: { LTL_TEST_WORKSPACE: workspace },
    });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error('Integration tests failed', err);
  process.exit(1);
});
