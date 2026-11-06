import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { createZstdDecompress } from 'node:zlib';
import { compare, compareLifecycle, transitions } from './compare.mjs';
import { convert, lifecycle, parseAmounts, SOL } from './normalize.mjs';

const DAY = '2026-10-15';
const WINDOWS = ['01', '12'];
const manifestUrl = new URL('../sim01/real-market/sources.json', import.meta.url);
const json = (value, space) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, space);
const sqlString = (value) => `'${value.replaceAll('\\', '/').replaceAll("'", "''")}'`;
const nullableInt = (value) => value === null ? null : BigInt(value);

async function fingerprint(path) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest('hex') };
}

async function readShrine(directory, hour, start, end) {
  const rows = [];
  const mayhem = new Set();
  const protocolActions = {};
  const inputs = [];
  for (const suffix of [hour, String(Number(hour) + 1).padStart(2, '0')]) {
    const file = `${DAY}-${suffix}.jsonl.zst`;
    const path = resolve(directory, file);
    const source = createReadStream(path);
    const hash = createHash('sha256');
    let bytes = 0;
    source.on('data', (chunk) => { hash.update(chunk); bytes += chunk.length; });
    const decompressed = createZstdDecompress();
    const lines = createInterface({ input: decompressed, crlfDelay: Infinity });
    const stream = pipeline(source, decompressed);
    // Await the pipeline as well as readline so an input error cannot produce a partial report.
    await Promise.all([stream, (async () => {
      let number = 0;
      for await (const line of lines) {
        number++;
        let header;
        try { header = JSON.parse(line); }
        catch (error) { throw new Error(`Invalid JSON in ${file} at line ${number}`, { cause: error }); }
        if (header.protocol === 'PUMPFUN_MAYHEM' && header.mint) mayhem.add(header.mint);
        if (!Number.isSafeInteger(header.timestamp)) throw new Error(`Invalid timestamp in ${file} at line ${number}`);
        if (header.timestamp < start || header.timestamp >= end) continue;
        const category = `${header.protocol}/${header.action}`;
        protocolActions[category] = (protocolActions[category] ?? 0) + 1;
        if (header.protocol === 'PUMPFUN' || (header.protocol === 'PUMPSWAP' && header.action === 'createPool')) {
          const row = parseAmounts(line);
          rows.push({ ...row, file, line: number });
        }
      }
    })()]);
    inputs.push({ file, bytes, sha256: hash.digest('hex') });
  }
  return { rows, mayhem, protocolActions, inputs };
}

function readReal(duckdb, manifest, realDir, start, end) {
  const paths = (prefix) => manifest.dataset.files.filter((f) => f.path.startsWith(prefix))
    .map((f) => sqlString(resolve(realDir, f.path))).join(', ');
  const query = `
    SET TimeZone='UTC';
    WITH trades AS (
      SELECT ts, slot, idx, seq, mint, wallet, side, t.sol_lamports::VARCHAR sol, t.token_amount::VARCHAR tokens,
        CASE WHEN r1 = trunc(r1) AND abs(r1) < 9007199254740992 THEN r1::BIGINT::VARCHAR END r1,
        CASE WHEN r2 = trunc(r2) AND abs(r2) < 9007199254740992 THEN r2::BIGINT::VARCHAR END r2,
        g.quote_amount::VARCHAR pool_sol, g.token_amount::VARCHAR pool_tokens
      FROM read_parquet([${paths('data/')}]) t
      LEFT JOIN (SELECT slot, idx, mint, wallet, sum(quote_amount) quote_amount, sum(token_amount) token_amount
        FROM read_parquet([${paths('graduations/')}]) WHERE quote_mint=${sqlString(SOL)} GROUP BY ALL) g
      USING (slot, idx, mint, wallet)
      WHERE t.ts >= ${start} AND t.ts < ${end} AND t.venue='curve' AND NOT t.failed
        AND t.quote_mint=${sqlString(SOL)} AND t.side IN ('buy', 'sell')
    ), lifecycle AS (
      SELECT ts, slot, a mint, kind, CASE WHEN kind='migrate' THEN b END pool
      FROM read_parquet([${paths('events/')}]) WHERE ts >= ${start} AND ts < ${end}
        AND kind IN ('complete', 'migrate')
    )
    SELECT (SELECT list(trades) FROM trades) trades, (SELECT list(lifecycle) FROM lifecycle) lifecycle;`;
  const result = JSON.parse(execFileSync(duckdb, ['-batch', '-bail', '-no-agent', '-json', '-c', query],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }))[0];
  return { ...result, trades: (result.trades ?? []).map((row) => ({ ...row,
    sol: nullableInt(row.sol), tokens: nullableInt(row.tokens),
    r1: nullableInt(row.r1), r2: nullableInt(row.r2),
  })), lifecycle: result.lifecycle ?? [] };
}

function splitBasis(rows) {
  let rowsWithPoolLeg = 0;
  let poolLamports = 0n;
  let poolTokenAtoms = 0n;
  for (const row of rows) {
    if (row.pool_sol === null && row.pool_tokens === null) continue;
    rowsWithPoolLeg++;
    poolLamports += BigInt(row.pool_sol ?? 0);
    poolTokenAtoms += BigInt(row.pool_tokens ?? 0);
  }
  return { rowsWithPoolLeg, poolLamports, poolTokenAtoms };
}

async function writeLines(path, records) {
  // The caller owns the new work directory. Write in batches to bound temporary strings.
  for (let start = 0; start < records.length; start += 4096) {
    const chunk = records.slice(start, start + 4096).map((row) => json(row)).join('\n') + '\n';
    await writeFile(path, chunk, { flag: start === 0 ? 'wx' : 'a' });
  }
  if (records.length === 0) await writeFile(path, '', { flag: 'wx' });
}

async function run(shrineDir, realDir, duckdb, output) {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  for (const file of manifest.dataset.files) {
    const actual = await fingerprint(resolve(realDir, file.path));
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) throw new Error(`Real C checksum mismatch: ${file.path}`);
  }
  await mkdir(output);
  await writeFile(resolve(output, 'INCOMPLETE'), 'Only quality.json marks a successful run.\n');
  const report = { schemaVersion: 1, dayUtc: DAY, realRevision: manifest.dataset.revision,
    sourceGateVerdict: 'INCONCLUSIVE', windows: {} };
  for (const hour of WINDOWS) {
    process.stderr.write(`Converting ${DAY} ${hour}:00 UTC\n`);
    const start = Date.parse(`${DAY}T${hour}:00:00Z`) / 1000;
    const end = start + 3600;
    const shrine = await readShrine(shrineDir, hour, start, end);
    const converted = convert(shrine.rows, shrine.mayhem);
    const reference = readReal(duckdb, manifest, realDir, start, end);
    const standard = reference.trades.filter((row) => !shrine.mayhem.has(row.mint));
    const events = lifecycle(shrine.rows, converted.standardMints);
    const realEvents = reference.lifecycle.filter((event) => converted.standardMints.has(event.mint));
    report.windows[hour] = { startInclusive: start, endExclusive: end, inputs: shrine.inputs,
      protocolActions: shrine.protocolActions, separated: { ...converted.separate,
        mayhemMintsInInputFiles: shrine.mayhem.size, realMayhemRows: reference.trades.length - standard.length },
      ...compare(converted, standard), realWindowTransitions: transitions(standard),
      realPoolSplitBasis: splitBasis(standard), lifecycle: compareLifecycle(events, realEvents),
      realLifecycleOutsideObservedStandardMints: reference.lifecycle.length - realEvents.length };
    await writeLines(resolve(output, `${hour}-trades.jsonl`), converted.trades);
    await writeLines(resolve(output, `${hour}-rejected.jsonl`), converted.rejected);
    await writeLines(resolve(output, `${hour}-events.jsonl`), events);
  }
  await writeFile(resolve(output, 'quality.json'), json(report, 2) + '\n', { flag: 'wx' });
  await rm(resolve(output, 'INCOMPLETE'));
}

const args = process.argv.slice(2);
if (args.length !== 4) {
  process.stderr.write('Usage: node run.mjs <shrine-raw-dir> <real-c-dir> <duckdb-executable> <new-output-dir>\n');
  process.exitCode = 2;
} else {
  try { await run(args[0], args[1], resolve(args[2]), args[3]); }
  catch (error) { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; }
}
