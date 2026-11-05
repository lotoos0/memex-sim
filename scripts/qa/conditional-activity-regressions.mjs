import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = '4b976ad94dfe04429ec3e51af188f87dec06b461';
const directory = join(root, 'output/sim01-p1-regressions');
mkdirSync(directory, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'p1-regressions-'));
const names = ['completionHandoffQa', 'curveParityAuditQa', 'curveParityQa', 'migrationGateQa',
  'stillbornLaunchQa', 'arrivalDecayQa', 'volumeBasisQa', 'cashCapSellQa', 'buyExhaustionQa', 'tradeTimestampQa', 'simClockQa'];
const result = {};
try {
  for (const name of names) {
    result[name] = {};
    for (const variant of name === 'cashCapSellQa' ? ['A', 'B', 'A_fee125', 'B_fee125'] : ['A', 'B']) {
      const outfile = join(temp, `${name}-${variant}.mjs`);
      await build({ absWorkingDir: root, entryPoints: [`src/qa/${name}.ts`], outfile,
        bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', define: { 'import.meta.env.DEV': 'true' },
        plugins: [{ name: 'baseline-control', setup(builder) {
          builder.onLoad({ filter: /[/\\]src[/\\].*\.ts$/ }, args => {
            const path = relative(root, args.path).replaceAll('\\', '/');
            let contents = variant.startsWith('A')
              ? execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root, encoding: 'utf8' }) : readFileSync(args.path, 'utf8');
            // Additional diagnostic only: retain the original failures above. The official
            // fee is independently asserted by officialCurveQa and P1 financial QA.
            if (variant.endsWith('_fee125') && path === 'src/qa/cashCapSellQa.ts') {
              if (contents.split('const f = 0.99;').length !== 2) throw new Error('Fee fixture seam changed');
              contents = contents.replace('const f = 0.99;', 'const f = 0.9875;');
            }
            return { contents, loader: 'ts', resolveDir: dirname(args.path) };
          });
        } }],
      });
      const log = console.log, error = console.error;
      const lines = [];
      console.log = console.error = (...args) => lines.push(args.map(String).join(' '));
      try {
        await import(pathToFileURL(outfile).href);
        result[name][variant] = { pass: true };
      } catch (error) {
        result[name][variant] = { pass: false, error: error.message };
      } finally { console.log = log; console.error = error; }
      writeFileSync(join(directory, `${name}-${variant}.log`), lines.join('\n') + '\n');
    }
    console.log(`${name}: ${JSON.stringify(result[name])}`);
  }
  writeFileSync(join(directory, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  if (Object.values(result).some(row => row.A.pass && !row.B.pass)) process.exitCode = 1;
} finally { rmSync(temp, { recursive: true, force: true }); }
