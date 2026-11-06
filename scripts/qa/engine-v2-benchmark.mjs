import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const qa = process.argv.includes('--qa-only');
const root = process.cwd();
const out = resolve(root, 'output/engine-v2-pilot');
const tmp = mkdtempSync(join(tmpdir(), 'memex-engine-v2-'));
const outfile = join(tmp, 'runner.mjs');
const entry = qa ? 'engineV2Qa' : 'engineV2Benchmark';
const hash = (data) => createHash('sha256').update(data).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
try {
  const bundle = await build({
    entryPoints: ['src/qa/' + entry + '.ts'], bundle: true, platform: 'node', format: 'esm', outfile, metafile: true,
  });
  const { measure } = await import(pathToFileURL(outfile));
  if (!qa) {
    mkdirSync(out, { recursive: true });
    const inputs = Object.keys(bundle.metafile.inputs).sort();
    const provenance = {
      commit: git('rev-parse', 'HEAD'), node: process.version, platform: process.platform, arch: process.arch,
      inputs: Object.fromEntries(inputs.map(path => [path, hash(readFileSync(path))])),
      realReferenceSha256: hash(readFileSync('docs/calibration/sim01/real-market/sources.json')),
      v1Main: '4b976ad94dfe04429ec3e51af188f87dec06b461',
    };
    const runs = [];
    const seeds = ['V2-PILOT-A', 'V2-PILOT-B', 'V2-PILOT-C', 'V2-PILOT-D', 'V2-PILOT-E', 'V2-PILOT-F'];
    const replacer = (_, value) => typeof value === 'bigint' ? value.toString() : value;
    for (const seed of seeds) {
      let baseline;
      for (const variant of ['off', 'on', 'fixed-launches']) {
        const fd = openSync(join(out, seed + '-' + variant + '.ndjson'), 'w');
        let lines = [];
        const digest = createHash('sha256');
        const flush = () => {
          if (!lines.length) return;
          const data = lines.join('');
          writeSync(fd, data);
          digest.update(data);
          lines = [];
        };
        try {
          const result = measure(seed, variant, row => {
            lines.push(JSON.stringify(row, replacer) + '\n');
            if (lines.length >= 512) flush();
          });
          flush();
          const schedule = JSON.stringify(result.baselineSchedule);
          if (baseline === undefined) baseline = schedule;
          else if (schedule !== baseline) throw new Error('Baseline launch schedule diverged for ' + seed);
          runs.push({ ...result, tapeSha256: digest.digest('hex') });
          console.log(seed, variant, result.all.births, 'births', result.all.preMigrationFills, 'curve fills',
            result.all.migrations, 'migrations', result.advanceMs.toFixed(0), 'ms');
        } finally {
          closeSync(fd);
        }
      }
    }
    writeFileSync(join(out, 'summary.json'), JSON.stringify({ provenance, runs }, null, 2) + '\n');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
