import * as path from 'node:path';
import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', timeout: 60_000, color: false });
  mocha.addFile(path.resolve(__dirname, './extension.test.js'));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${String(failures)} integration test(s) failed`));
      } else {
        resolve();
      }
    });
  });
}
