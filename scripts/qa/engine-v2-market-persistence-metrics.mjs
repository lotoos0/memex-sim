export const ageBand = (sec) => sec < 120 ? '0-2' : sec < 600 ? '2-10' : sec < 1200 ? '10-20' : '20-30';
const progressBand = (p) => p < .2 ? '0-20' : p < .5 ? '20-50' : p < .8 ? '50-80' : p < .9 ? '80-90' : '90-100';
const cell = () => ({ exposure: 0, active: 0, trades: 0, buy: 0, buySol: 0, sellSol: 0 });
export const add = (bag, key, n = 1) => { bag[key] = (bag[key] ?? 0) + n; };
export function newResult() {
  return { paths: 0, cells: {}, exactLifecycle: {}, engineExposure: {}, bursts: {}, gaps: {}, windows: {},
    progression: {}, pathStats: [], choices: {}, evictions: {}, transitions: {} };
}
function flow(bag, key, row) {
  const c = bag[key] ??= cell();
  c.trades++;
  if (row.side === 'BUY') { c.buy++; c.buySol += row.quote; } else c.sellSol += row.quote;
}
export function analyze(path, result) {
  const rows = path.rows.filter((r) => r.ms >= 0 && r.ms < 1800000);
  const completion = path.completeMs ?? null;
  if (!rows.length || completion !== null && completion <= 1000) return;
  result.paths++;
  const end = completion === null ? 1800 : Math.min(1800, Math.floor(completion / 1000) + 1);
  const counts = new Uint32Array(end);
  const localBursts = {}, localGaps = {}, localWindows = {};
  const changes = path.changes ?? [];
  let idx = 0, lastMs = 0, progress = 0, ci = 0, state = 'ACTIVE';
  let series = 0, gap = 0, seen = false, runs = 0, returns35 = 0, longest = 0;
  for (let sec = 0; sec < end; sec++) {
    while (ci < changes.length && changes[ci][0] <= sec * 1000) state = changes[ci++][1];
    if (path.changes) add(result.engineExposure, state);
    const idle = sec * 1000 - lastMs;
    const proxy = idle >= 35000 ? 'DORMANT' : idle >= 10000 ? 'QUIET' : 'ACTIVE';
    const keys = ['all', `age:${ageBand(sec)}`, `progress:${progressBand(progress)}`, `idle:${proxy}`,
      `cross:${ageBand(sec)}:${progressBand(progress)}:${proxy}`];
    if (path.changes) keys.push(`native:${state}`);
    const first = idx;
    while (idx < rows.length && Math.floor(rows[idx].ms / 1000) === sec) {
      const row = rows[idx++];
      const preIdle = row.ms - lastMs;
      flow(result.exactLifecycle, preIdle >= 35000 ? 'proxy:DORMANT' : preIdle >= 10000 ? 'proxy:QUIET' : 'proxy:ACTIVE', row);
      if (row.state) flow(result.exactLifecycle, `engine:${row.state}`, row);
      if (row.selectedState) flow(result.exactLifecycle, `selected:${row.selectedState}`, row);
      lastMs = row.ms;
      progress = row.post;
    }
    const n = idx - first;
    counts[sec] = n;
    for (const key of keys) {
      const c = result.cells[key] ??= cell();
      c.exposure++;
      if (n) c.active++;
      for (let j = first; j < idx; j++) flow(result.cells, key, rows[j]);
    }
    if (n) {
      if (!series) {
        runs++;
        if (seen) { add(result.gaps, gap); add(localGaps, gap); if (gap >= 35) returns35++; }
      }
      series++; gap = 0; seen = true;
    } else {
      if (series) { add(result.bursts, series); add(localBursts, series); longest = Math.max(longest, series); series = 0; }
      gap++;
    }
  }
  if (series) { add(result.bursts, series); add(localBursts, series); longest = Math.max(longest, series); }
  for (const width of [1, 5, 10]) {
    for (let sec = 0; sec + width <= end; sec += width) {
      let n = 0;
      for (let j = sec; j < sec + width; j++) n += counts[j];
      add(result.windows[`${width}:all`] ??= {}, n);
      add(result.windows[`${width}:${ageBand(sec)}`] ??= {}, n);
      add(localWindows[width] ??= {}, n);
    }
  }
  const pathSummary = { token: path.token, trades: rows.length, runs, returns35, longest,
    active: counts.reduce((a, b) => a + (b > 0), 0), trailingGap: gap,
    seriesHistogram: localBursts, gapHistogram: localGaps, windowHistograms: localWindows };
  result.pathStats.push(pathSummary);
  for (const threshold of [.8, .9]) {
    const mark = rows.findIndex((r) => r.post >= threshold);
    if (mark < 0) continue;
    const at = rows[mark].ms;
    const group = result.progression[threshold] ??= { paths: 0, retreated: 0, completed: 0, noLater: 0,
      finalBelow: 0, advanced120: 0, stalled120: 0, declined120: 0, tailSilent300: 0,
      before: cell(), after: cell(), knownAt: 0, known120: 0, selectedBefore: 0, selectedAfter: 0 };
    group.paths++;
    const later = rows.slice(mark + 1);
    if (later.some((r) => r.post < threshold)) group.retreated++;
    if (completion !== null) group.completed++;
    if (!later.length) group.noLater++;
    if (rows.at(-1).post < threshold) group.finalBelow++;
    if (gap >= 300) group.tailSilent300++;
    const at120 = later.filter((r) => r.ms <= at + 120000).at(-1)?.post ?? rows[mark].post;
    if (at120 > rows[mark].post) group.advanced120++;
    else if (at120 < rows[mark].post) group.declined120++;
    else group.stalled120++;
    const beforeStart = Math.max(0, at - 120000), afterEnd = Math.min(end * 1000, at + 120000);
    group.before.exposure += (at - beforeStart) / 1000;
    group.after.exposure += (afterEnd - at) / 1000;
    // The crossing trade itself is excluded from both windows.
    for (let j = 0; j < rows.length; j++) {
      if (j < mark && rows[j].ms >= beforeStart) flow(group, 'before', rows[j]);
      if (j > mark && rows[j].ms <= afterEnd) flow(group, 'after', rows[j]);
    }
    const knownAt = (time) => { let n = 0; for (const [t, count] of path.known ?? []) { if (t > time) break; n = count; } return n; };
    group.knownAt += knownAt(at); group.known120 += knownAt(afterEnd);
    group.selectedBefore += (path.selections ?? []).filter((t) => t >= beforeStart && t < at).length;
    group.selectedAfter += (path.selections ?? []).filter((t) => t > at && t <= afterEnd).length;
  }
}
export function quantileHist(hist, qs = [.5, .9, .99]) {
  const n = Object.values(hist).reduce((a, b) => a + b, 0);
  const ordered = Object.entries(hist).map(([x, n]) => [+x, n]).sort((a, b) => a[0] - b[0]);
  return qs.map((q) => { let k = 0; return ordered.find(([, count]) => (k += count) >= Math.ceil(q * n))?.[0] ?? null; });
}
