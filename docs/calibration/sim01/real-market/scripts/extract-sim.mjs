import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../..');
const benchmark = resolve(here, '..');
const source = JSON.parse(readFileSync(join(benchmark, 'sources.json'), 'utf8'));
const args = process.argv.slice(2);
let work;
let smoke = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--work-dir' && args[i + 1] && work === undefined) work = resolve(args[++i]);
  else if (args[i] === '--smoke') smoke = true;
  else throw new Error(`Unknown/missing option: ${args[i]}`);
}
if (!work || work === benchmark || work.startsWith(benchmark + sep)) {
  throw new Error('Supply --work-dir outside the versioned reference, e.g. output/sim01-reproduction');
}
mkdirSync(work, { recursive: true });
const config = { ...source.simulation.config, ...(smoke ? { tokensPerSeed: 2, horizonSec: 3 } : {}) };
const hash = value => createHash('sha256').update(value).digest('hex');
const git = (...parameters) => execFileSync('git', parameters, { cwd: root, encoding: 'utf8' });
const temp = mkdtempSync(join(tmpdir(), 'sim01-pinned-extraction-'));
const provenance = { config, canonical: !smoke, variants: {} };
try {
  for (const variant of ['A', 'B']) {
    const commit = source.simulation[variant.toLowerCase()];
    // No checkout, runtime flag or mutation: every project source input is pinned.
    const inputs = new Map();
    const load = path => {
      if (!inputs.has(path)) inputs.set(path, git('show', `${commit}:${path}`).replaceAll('\r\n', '\n'));
      return inputs.get(path);
    };
    const outfile = join(temp, `${variant}.mjs`);
    await build({ absWorkingDir: root, entryPoints: ['src/qa/marketBehaviorBaseline.ts'], outfile,
      bundle: true, platform: 'node', format: 'esm', define: { 'import.meta.env.DEV': 'true' },
      plugins: [{ name: 'pinned-research-observer', setup(builder) {
        builder.onLoad({ filter: /[/\\](src|config)[/\\].*\.(ts|tsx|json)$/ }, args => {
          const path = relative(root, args.path).replaceAll('\\', '/');
          let contents = load(path);
          if (path === 'src/qa/marketBehaviorBaseline.ts') {
            const point = 'const print = { ageMs:';
            const result = '    preMigration: measurePath(';
            if (contents.split(point).length !== 2 || contents.split(result).length !== 2) {
              throw new Error('Pinned harness observer seam changed');
            }
            contents = contents.replace(point, "const print = { progress: sim['getCurveProgress'](), ageMs:")
              .replace(result, '    researchPrints: prints,\n' + result);
          }
          return { contents, loader: path.endsWith('.json') ? 'json' : path.endsWith('.tsx') ? 'tsx' : 'ts',
            resolveDir: dirname(args.path) };
        });
      } }],
    });
    const module = await import(pathToFileURL(outfile).href);
    const result = module.runMarketBehaviorBaseline(config);
    const original = { tokens: result.tokens.map(({ researchPrints, ...token }) => token), summary: result.summary };
    const measurement = hash(JSON.stringify(original));
    if (!smoke && measurement !== source.simulation.measurementSha256[variant.toLowerCase()]) {
      throw new Error(`${variant}: pinned PR72 measurement mismatch`);
    }
    writeFileSync(join(work, `sim-${variant}-tapes.json`), JSON.stringify(result.tokens));
    provenance.variants[variant] = { commit, measurementSha256: measurement,
      sourceSha256: hash(JSON.stringify([...inputs].sort(([a], [b]) => a.localeCompare(b)))) };
    console.log(`${variant}: ${result.tokens.length} tokens; ${smoke ? 'SMOKE ONLY' : 'exact PR72 reproduction PASS'}`);
  }
  writeFileSync(join(work, 'sim-extraction.json'), JSON.stringify(provenance, null, 2) + '\n');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
