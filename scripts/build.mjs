import * as esbuild from 'esbuild';

// Readable output on purpose: no minify, no source maps, so the shipped code can be read as is.
await esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  minify: false,
  sourcemap: false,
  legalComments: 'inline',
  logLevel: 'info',
});
