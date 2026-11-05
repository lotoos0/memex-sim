import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (['--verify', '--qa-only'].includes(key)) options[key] = true;
  else if (['--seeds', '--tokens', '--seconds', '--out'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--')) {
    if (options[key] !== undefined) throw new Error(`Duplicate option ${key}`);
    options[key] = args[++i];
  } else throw new Error(`Unknown option or missing value: ${key}`);
}
const hash = value => createHash('sha256').update(value).digest('hex');
const temp = mkdtempSync(join(tmpdir(), 'memex-sim01-'));
async function bundle(entry) {
  const outfile = join(temp, `${entry}.mjs`);
  const result = await build({ absWorkingDir: root, entryPoints: [`src/qa/${entry}.ts`], outfile,
    bundle: true, platform: 'node', format: 'esm', define: { 'import.meta.env.DEV': 'true' }, metafile: true });
  return { module: await import(pathToFileURL(outfile).href), inputs: Object.keys(result.metafile.inputs).sort() };
}
try {
  if (options['--qa-only']) {
    for (const entry of ['tradeOhlcQa', 'ohlcConsistencyAuditQa', 'marketBehaviorMetricsQa', 'conditionalActivityQa', 'conditionalActivityFinancialQa']) await bundle(entry);
    const official = await bundle('officialCurveQa');
    official.module.runOfficialCurveQa();
    console.log('SIM-01 QA: PASS');
  } else {
    const { module: harness, inputs } = await bundle('marketBehaviorBaseline');
    const config = { ...harness.defaultBaselineConfig };
    if (options['--seeds']) config.seeds = options['--seeds'].split(',');
    if (options['--tokens']) config.tokensPerSeed = Number(options['--tokens']);
    if (options['--seconds']) config.horizonSec = Number(options['--seconds']);
    if (!config.seeds.length || config.seeds.some(seed => !seed.trim()) || new Set(config.seeds).size !== config.seeds.length) {
      throw new Error('Seeds must be nonempty and unique');
    }
    for (const key of ['tokensPerSeed', 'horizonSec']) {
      if (!Number.isSafeInteger(config[key]) || config[key] <= 0) throw new Error(`${key} must be a positive integer`);
    }
    const result = harness.runMarketBehaviorBaseline(config);
    const serialized = JSON.stringify(result);
    if (options['--verify']) {
      const repeated = JSON.stringify(harness.runMarketBehaviorBaseline(config));
      if (serialized !== repeated) throw new Error('Determinism check failed');
      console.log(`Determinism: PASS (${hash(serialized)})`);
    }
    const git = (...parameters) => execFileSync('git', parameters, { cwd: root, encoding: 'utf8' }).trim();
    const sourceFingerprint = paths => hash(JSON.stringify(paths.map(path =>
      [path.replaceAll('\\', '/'), readFileSync(resolve(root, path), 'utf8').replaceAll('\r\n', '\n')])));
    const runtimeInputs = inputs.filter(path => !path.startsWith('src/qa/'));
    const tracked = new Set(git('ls-files', '--', ...inputs).split('\n'));
    const dirtyMeasuredPaths = [...git('diff', 'HEAD', '--name-only', '--', ...inputs).split('\n').filter(Boolean),
      ...inputs.filter(path => !tracked.has(path))].sort();
    const report = { schemaVersion: 1, sourceCommit: git('rev-parse', 'HEAD'),
      sourceDirtyPaths: dirtyMeasuredPaths, runtimeSourceSha256: sourceFingerprint(runtimeInputs),
      harnessSourceSha256: sourceFingerprint(inputs.filter(path => path.startsWith('src/qa/'))),
      nodeVersion: process.version, config, measurementSha256: hash(serialized), ...result };
    const output = resolve(root, options['--out'] ?? 'output/sim01-baseline.json');
    mkdirSync(dirname(output), { recursive: true });
    // Keep the checked-in baseline reviewable: one token per line, readable summary.
    const { tokens, ...metadata } = report;
    const header = JSON.stringify(metadata, null, 2).slice(0, -2);
    writeFileSync(output, `${header},\n  "tokens": [\n${tokens.map(token => `    ${JSON.stringify(token)}`).join(',\n')}\n  ]\n}\n`);
    console.log(`Wrote ${output}`);
    console.log(JSON.stringify(report.summary, null, 2));
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
