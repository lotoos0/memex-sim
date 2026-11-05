import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const options = { tokens: 1000, seconds: 1800, tick: 200, seeds: 'SIM01-A,SIM01-B,SIM01-C,SIM01-D,SIM01-E,SIM01-F', out: 'output/sim01-p1', repeat: false };
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  if (!(key in options)) throw new Error(`Unknown option ${key}`);
  if (key === 'repeat') options.repeat = true;
  else options[key] = typeof options[key] === 'number' ? Number(process.argv[++i]) : process.argv[++i];
}
if (![100, 200, 1000].includes(options.tick)) throw new Error('tick must be 100, 200 or 1000ms');
const work = resolve(root, options.out);
if (!relative(join(root, 'output'), work) || relative(join(root, 'output'), work).startsWith('..')) throw new Error('Use an output/ subdirectory');
mkdirSync(work, { recursive: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const config = { seeds: options.seeds.split(','), tokensPerSeed: options.tokens,
  horizonSec: options.seconds, tickMs: options.tick, startUtc: '2026-10-15T00:00:00.000Z', startHoursUtc: [8, 19] };
const provenance = { config, node: process.version, baselineCommit: '4b976ad94dfe04429ec3e51af188f87dec06b461', candidateCommit: git('rev-parse', 'HEAD'), variants: {} };
const temp = mkdtempSync(join(tmpdir(), 'sim01-p1-'));
try {
  for (const variant of ['A', 'B']) {
    const inputs = new Map();
    const outfile = join(temp, `${variant}.mjs`);
    await build({ absWorkingDir: root, entryPoints: ['src/qa/marketBehaviorBaseline.ts'], outfile,
      bundle: true, platform: 'node', format: 'esm', define: { 'import.meta.env.DEV': 'true' },
      plugins: [{ name: 'conditional-activity-observer', setup(builder) {
        builder.onLoad({ filter: /[/\\]src[/\\].*\.ts$/ }, args => {
          const path = relative(root, args.path).replaceAll('\\', '/');
          let contents = variant === 'A' ? git('show', `${provenance.baselineCommit}:${path}`) : readFileSync(args.path, 'utf8');
          contents = contents.replaceAll('\r\n', '\n');
          inputs.set(path, hash(contents));
          if (path === 'src/qa/marketBehaviorBaseline.ts') {
            const seam = 'const print = { ageMs:';
            if (contents.split(seam).length !== 2) throw new Error('Harness observer seam changed');
            contents = contents.replace(seam, "const print = { progress: sim['getCurveProgress'](), ready: sim['isMigrationRuntimeReady'](row.tMs), ageMs:")
              .replace('    preMigration: measurePath(', "    researchPrints: prints, finalPhase: sim.getPhase(), silentAfterSec: sim['flowSilentAfterSimMs'] / 1000,\n    preMigration: measurePath(")
              .replace('config.tickMs !== 200', '![100, 200, 1000].includes(config.tickMs)');
          }
          return { contents, loader: 'ts', resolveDir: dirname(args.path) };
        });
      } }],
    });
    const harness = await import(pathToFileURL(outfile).href);
    const started = performance.now();
    const result = harness.runMarketBehaviorBaseline(config);
    const elapsedMs = performance.now() - started;
    const serialized = JSON.stringify(result);
    if (options.repeat && serialized !== JSON.stringify(harness.runMarketBehaviorBaseline(config))) throw new Error(`${variant} nondeterministic`);
    writeFileSync(join(work, `sim-${variant}-tapes.json`), JSON.stringify(result.tokens));
    writeFileSync(join(work, `summary-${variant}.json`), JSON.stringify(result.summary, null, 2) + '\n');
    provenance.variants[variant] = { elapsedMs, measurementSha256: hash(serialized), repeated: options.repeat,
      sourceFiles: Object.fromEntries([...inputs].sort(([a], [b]) => a.localeCompare(b))) };
    writeFileSync(join(work, 'experiment.json'), JSON.stringify(provenance, null, 2) + '\n');
    console.log(`${variant}: ${result.tokens.length} tokens, ${elapsedMs.toFixed(0)}ms, ${hash(serialized)}`);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
