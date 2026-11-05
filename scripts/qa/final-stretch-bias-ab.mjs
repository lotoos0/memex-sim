import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const lf = text => text.replaceAll('\r\n', '\n');
const sha = text => createHash('sha256').update(text).digest('hex');
const options = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (['--verify', '--qa-only'].includes(key)) options[key] = true;
  else if (['--base', '--tokens', '--seeds', '--seconds', '--out'].includes(key)
    && args[i + 1] && !args[i + 1].startsWith('--') && options[key] === undefined) options[key] = args[++i];
  else throw new Error(`Invalid option ${key}`);
}
const baseCommit = git('rev-parse', options['--base'] ?? '84eca0906dc26387ca8b0fd761faad547e06a3fb');
const tokenPath = 'src/tokens/tokenSim.ts';
const sourceA = lf(git('show', `${baseCommit}:${tokenPath}`));
const sourceB = lf(readFileSync(join(root, tokenPath), 'utf8')).trim();
const oldBranch = `      // Same prints, more of them on the bid, once the coin has already raised
      // real quote. The dense-tape stall was selling this stretch back down.
      if (migrationReady && progressToMigration >= FINISH_STRETCH_MIN_PROGRESS) {
        effectiveBuyBias = 0.98;
      } else if (migrationReady && progressToMigration >= 0.8) {`;
const newBranch = '      if (migrationReady && progressToMigration >= 0.8) {';
if (sourceA.split(oldBranch).length !== 2 || sourceA.replace(oldBranch, newBranch) !== sourceB) {
  throw new Error('A/B isolation failed: expected exactly the authorized BUY-bias branch removal');
}
const temp = mkdtempSync(join(tmpdir(), 'memex-sim01-ab-'));
async function bundle(entry, variant) {
  const outfile = join(temp, `${entry}-${variant}.mjs`);
  const result = await build({ absWorkingDir: root, entryPoints: [`src/qa/${entry}.ts`], outfile,
    bundle: true, platform: 'node', format: 'esm', define: { 'import.meta.env.DEV': 'true' }, metafile: true,
    plugins: variant === 'A' ? [{ name: 'pinned-baseline', setup(builder) {
      builder.onLoad({ filter: /[/\\]src[/\\]tokens[/\\]tokenSim\.ts$/ }, () => ({ contents: sourceA,
        loader: 'ts', resolveDir: resolve(root, 'src/tokens') }));
    } }] : [],
  });
  return { module: await import(pathToFileURL(outfile).href), inputs: Object.keys(result.metafile.inputs).sort() };
}
try {
  if (options['--qa-only']) {
    await bundle('finalStretchBiasComparisonQa', 'B');
    for (const variant of ['A', 'B']) {
      console.log(`Execution/curve regressions: ${variant}`);
      const official = await bundle('officialCurveQa', variant);
      official.module.runOfficialCurveQa();
      await bundle('finalStretchCurveQa', variant);
      await bundle('migrationGateQa', variant);
    }
    console.log('A/B source isolation: PASS');
  } else {
    const a = await bundle('marketBehaviorBaseline', 'A');
    const b = await bundle('marketBehaviorBaseline', 'B');
    if (JSON.stringify(a.inputs) !== JSON.stringify(b.inputs)) throw new Error('Different bundle inputs');
    const runtimeInputs = a.inputs.filter(path => !path.startsWith('src/qa/'));
    for (const path of runtimeInputs.filter(path => path !== tokenPath)) {
      if (lf(git('show', `${baseCommit}:${path}`)) !== lf(readFileSync(resolve(root, path), 'utf8')).trim()) {
        throw new Error(`Unrelated runtime difference: ${path}`);
      }
    }
    const config = { ...a.module.defaultBaselineConfig,
      seeds: (options['--seeds'] ?? 'SIM01-A,SIM01-B,SIM01-C,SIM01-D,SIM01-E,SIM01-F').split(','),
      tokensPerSeed: Number(options['--tokens'] ?? 1000), horizonSec: Number(options['--seconds'] ?? 1800) };
    const run = (variant, module) => {
      const started = Date.now();
      const result = module.runMarketBehaviorBaseline(config);
      console.log(`${variant}: ${result.tokens.length} tokens in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      return result;
    };
    const resultA = run('A', a.module);
    const resultB = run('B', b.module);
    const serializedA = JSON.stringify(resultA), serializedB = JSON.stringify(resultB);
    if (options['--verify']) {
      if (serializedA !== JSON.stringify(run('A repeat', a.module))
        || serializedB !== JSON.stringify(run('B repeat', b.module))) throw new Error('Nondeterministic A/B');
    }
    const comparisonModule = await bundle('finalStretchBiasComparison', 'B');
    const comparison = comparisonModule.module.compareFinalStretchBias(resultA, resultB);
    const output = resolve(root, options['--out'] ?? 'output/sim01-buy-bias-ab.json');
    mkdirSync(dirname(output), { recursive: true });
    // Full PR1-compatible token/episode records remain available beside the compact comparison.
    writeFileSync(`${output}.A.json`, serializedA + '\n');
    writeFileSync(`${output}.B.json`, serializedB + '\n');
    const fingerprint = variant => sha(JSON.stringify(a.inputs.map(path => [path,
      path === tokenPath && variant === 'A' ? sourceA : lf(readFileSync(resolve(root, path), 'utf8')).trim()])));
    const runnerPaths = ['scripts/qa/final-stretch-bias-ab.mjs', 'src/qa/finalStretchBiasComparison.ts'];
    const report = { schemaVersion: 1, baseCommit, candidateSourceCommit: git('rev-parse', 'HEAD'),
      candidateDirtyPaths: git('diff', 'HEAD', '--name-only').split('\n').filter(Boolean),
      nodeVersion: process.version, config, sourceIsolationPassed: true,
      bundleSha256: { a: fingerprint('A'), b: fingerprint('B') },
      runnerSha256: sha(JSON.stringify(runnerPaths.map(path => [path, lf(readFileSync(resolve(root, path), 'utf8'))]))),
      measurementSha256: { a: sha(serializedA), b: sha(serializedB) },
      repeatedIdentically: Boolean(options['--verify']),
      summaryA: resultA.summary, summaryB: resultB.summary, ...comparison };
    const { tokenPairs, ...metadata } = report;
    writeFileSync(output, `${JSON.stringify(metadata, null, 2).slice(0, -2)},\n  "tokenPairs": [\n${tokenPairs.map(row => `    ${JSON.stringify(row)}`).join(',\n')}\n  ]\n}\n`);
    console.log(`Wrote ${output}; baseline 90-ready n=${comparison.cohortA.bands['90_100_ready'].tokens}`);
    console.log(JSON.stringify({ a: { migrated: resultA.summary.migrated, reached80: resultA.summary.reached80 },
      b: { migrated: resultB.summary.migrated, reached80: resultB.summary.reached80 } }));
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
