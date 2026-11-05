"""Event-path metrics. Rows are (age_seconds, post-swap SOL price, progress, quote SOL, side)."""

import csv, json, itertools, math, collections, time
from pathlib import Path
import bisect, os
D = Path(os.environ['SIM01_WORK_DIR'])
H = 1800.0
GEN = 30 / 1073000000

def dist(xs):
    if isinstance(xs, collections.Counter):
        if not xs:
            return {'n': 0, 'p10': None, 'p50': None, 'p90': None, 'p99': None}
        vals = sorted(xs)
        cumulative = list(itertools.accumulate((xs[x] for x in vals)))
        n = cumulative[-1]

        def at(i):
            return vals[bisect.bisect_left(cumulative, i + 1)]
        qs = []
        for p in [0.1, 0.5, 0.9, 0.99]:
            pos = (n - 1) * p
            lo = math.floor(pos)
            qs.append(at(lo) + (at(math.ceil(pos)) - at(lo)) * (pos - lo))
        return dict(n=n, p10=qs[0], p50=qs[1], p90=qs[2], p99=qs[3])
    values = sorted((x for x in xs if x is not None))
    if not values:
        return {'n': 0, 'p10': None, 'p50': None, 'p90': None, 'p99': None}

    def q(p):
        index = (len(values) - 1) * p
        lo = math.floor(index)
        return values[lo] + (values[math.ceil(index)] - values[lo]) * (index - lo)
    return dict(n=len(values), p10=q(0.1), p50=q(0.5), p90=q(0.9), p99=q(0.99))

def moves(prices, initial):
    peak = last = initial
    dd = 0.0
    sgn = 0
    anchor = initial
    imp = []
    cor = []
    flips = 0
    nz = 0
    for p in prices:
        sign = (p > last) - (p < last)
        if sign:
            nz += 1
            if sign != sgn:
                if sgn:
                    (imp if sgn > 0 else cor).append(abs(last / anchor - 1) * 100)
                    flips += 1
                anchor = last
                sgn = sign
        last = p
        peak = max(peak, p)
        dd = max(dd, 1 - p / peak)
    if sgn:
        (imp if sgn > 0 else cor).append(abs(last / anchor - 1) * 100)
    return (dd * 100, imp, cor, flips, nz)

class Bag:

    def __init__(self):
        self.n = 0
        self.duration = 0.0
        self.trades = 0
        self.buy = 0
        self.bvol = 0.0
        self.svol = 0.0
        self.bins = 0
        self.empty = 0
        self.zero = 0
        self.transaction_sizes = []
        self.buy_sizes = []
        self.sell_sizes = []
        self.buy_runs = []
        self.sell_runs = []
        self.flips_per_100 = []
        self.flips_total = 0
        self.active_bins = 0
        self.mdd = []
        self.close_mdd = []
        self.imp = []
        self.cor = []
        self.cimp = []
        self.ccor = []
        self.flips = []
        self.fliprate = []
        self.durations = []
        self.counts = []
        self.ret = []
        self.r1 = collections.Counter()
        self.r5 = collections.Counter()
        self.flat = 0
        self.candles = 0
        self.green = 0
        self.red = 0
        self.body = []
        self.range = []

    def add(self, rows, start, end, initial):
        self.n += 1
        duration = max(0, end - start)
        self.duration += duration
        self.durations.append(duration)
        self.counts.append(len(rows))
        self.zero += duration == 0
        self.transaction_sizes.extend((x[3] for x in rows))
        self.buy_sizes.extend((x[3] for x in rows if x[4] == 'buy'))
        self.sell_sizes.extend((x[3] for x in rows if x[4] == 'sell'))
        for side, streak in itertools.groupby(rows, key=lambda x: x[4]):
            (self.buy_runs if side == 'buy' else self.sell_runs).append(sum((1 for _ in streak)))
        self.trades += len(rows)
        self.buy += sum((x[4] == 'buy' for x in rows))
        self.bvol += sum((x[3] for x in rows if x[4] == 'buy'))
        self.svol += sum((x[3] for x in rows if x[4] == 'sell'))
        dd, im, co, fl, nz = moves([x[1] for x in rows], initial)
        self.flips_total += fl
        if rows:
            self.flips_per_100.append(100 * fl / len(rows))
        self.mdd.append(dd)
        self.imp.extend(im)
        self.cor.extend(co)
        self.flips.append(fl)
        if nz > 1:
            self.fliprate.append(fl / (nz - 1))
        self.ret.append((rows[-1][1] / initial - 1) * 100 if rows else 0.0)
        buckets = collections.defaultdict(list)
        for x in rows:
            buckets[math.floor(x[0])].append(x)
        exposed = set(range(math.floor(start), math.ceil(end))) | set(buckets)
        self.active_bins += len(buckets)
        self.bins += len(exposed)
        self.empty += len(exposed) - len(buckets)
        last = initial
        grid = []
        for sec in sorted(exposed):
            r = buckets.get(sec, [])
            if r:
                ps = [last] + [x[1] for x in r]
                op = last
                last = ps[-1]
                hi = max(ps)
                lo = min(ps)
                self.candles += 1
                self.flat += hi == lo
                self.green += last > op
                self.red += last < op
                self.body.append((last / op - 1) * 100)
                self.range.append((hi / lo - 1) * 100)
            grid.append(last)
        cd, ci, cc, _, _ = moves(grid, initial)
        self.close_mdd.append(cd)
        self.cimp.extend(ci)
        self.ccor.extend(cc)
        prev = initial
        for p in grid:
            self.r1[(p / prev - 1) * 100] += 1
            prev = p
        self.r5.update(((grid[i] / (initial if i == 4 else grid[i - 5]) - 1) * 100 for i in range(4, len(grid))))

    def result(self):
        q = self.bvol + self.svol
        return {'direction_changes_per_100_trades': 100 * self.flips_total / self.trades if self.trades else None, 'direction_changes_per_100_trades_by_path': dist(self.flips_per_100), 'buy_quote_sol_per_exposure_second': self.bvol / self.duration if self.duration else None, 'sell_quote_sol_per_exposure_second': self.svol / self.duration if self.duration else None, 'trades_per_active_episode_second_bin': self.trades / self.active_bins if self.active_bins else None, 'transaction_quote_sol': dist(self.transaction_sizes), 'buy_transaction_quote_sol': dist(self.buy_sizes), 'sell_transaction_quote_sol': dist(self.sell_sizes), 'buy_run_length_trades': dist(self.buy_runs), 'sell_run_length_trades': dist(self.sell_runs), 'paths': self.n, 'zero_duration_paths': self.zero, 'duration_sec': self.duration, 'trades': self.trades, 'buy_count': self.buy, 'sell_count': self.trades - self.buy, 'buy_count_share': self.buy / self.trades if self.trades else None, 'buy_quote_sol': self.bvol, 'sell_quote_sol': self.svol, 'buy_volume_share': self.bvol / q if q else None, 'trades_per_sec': self.trades / self.duration if self.duration else None, 'exposed_second_bins': self.bins, 'empty_bin_share': self.empty / self.bins if self.bins else None, 'drawdown_trade_pct': dist(self.mdd), 'drawdown_close1s_pct': dist(self.close_mdd), 'impulse_trade_pct': dist(self.imp), 'correction_trade_pct': dist(self.cor), 'impulse_close1s_pct': dist(self.cimp), 'correction_close1s_pct': dist(self.ccor), 'direction_changes': dist(self.flips), 'flip_share': dist(self.fliprate), 'duration_distribution_sec': dist(self.durations), 'trade_count_distribution': dist(self.counts), 'return_pct': dist(self.ret), 'return_1s_pct': dist(self.r1), 'return_5s_pct': dist(self.r5), 'nonzero_return_1s_pct': dist(collections.Counter({x: n for x, n in self.r1.items() if x != 0})), 'observed_candles': self.candles, 'flat_observed_candle_share': self.flat / self.candles if self.candles else None, 'green_candle_share': self.green / self.candles if self.candles else None, 'candle_body_pct': dist(self.body), 'candle_range_pct': dist(self.range)}

def band(p):
    return '0_80' if p < 0.8 else '80_90' if p < 0.9 else '90_100'

class Dataset:

    def __init__(self, label):
        self.label = label
        self.bags = {k: Bag() for k in ['full', '0_80', '80_90', '90_100', 'from80', 'first80_to_first90']}
        self.tokens = 0
        self.active = 0
        self.migrated = 0
        self.first80 = []
        self.first90 = []
        self.ttm = []
        self.t8090 = []
        self.returned = 0
        self.bandtoks = collections.Counter()
        self.instant = 0
        self.tokenstats = []

    def add(self, id, rows, end, migration, instant=False):
        self.tokens += 1
        if instant:
            self.instant += 1
            return
        if not rows:
            return
        self.active += 1
        if migration is not None:
            self.migrated += 1
            self.ttm.append(migration)
        self.bags['full'].add(rows, 0, end, GEN)
        state = 0.0
        price = GEN
        start = 0.0
        episode = []
        visited = set()
        entry = None
        entry90 = None
        ret = False
        for i, row in enumerate(rows):
            old = band(state)
            episode.append(row)
            new = band(row[2])
            if entry is None and row[2] >= 0.8:
                entry = (row[0], row[1], i)
            if entry90 is None and row[2] >= 0.9:
                entry90 = (row[0], row[1], i)
            if entry and row[2] < 0.8:
                ret = True
            if new != old or row[2] >= 1:
                self.bags[old].add(episode, start, row[0], price)
                visited.add(old)
                episode = []
                start = row[0]
                price = row[1]
            state = row[2]
        if state < 1 and (end > start or episode):
            self.bags[band(state)].add(episode, start, end, price)
            visited.add(band(state))
        for k in visited:
            self.bandtoks[k] += 1
        if entry:
            self.first80.append(entry[0])
            self.bags['from80'].add(rows[entry[2] + 1:], entry[0], end, entry[1])
            self.returned += ret
            if entry90:
                self.first90.append(entry90[0])
                self.t8090.append(entry90[0] - entry[0])
                self.bags['first80_to_first90'].add(rows[entry[2] + 1:entry90[2] + 1], entry[0], entry90[0], entry[1])
        self.tokenstats.append({'id': id, 'first80': None if not entry else entry[0], 'first90': None if not entry90 else entry90[0], 'migration': migration, 'returned': ret})

    def result(self):
        return {'label': self.label, 'tokens_input': self.tokens, 'active_noninstant': self.active, 'instant_excluded': self.instant, 'migrated_noninstant': self.migrated, 'migration_share_active_noninstant': self.migrated / self.active if self.active else None, 'first80_n': len(self.first80), 'first90_n': len(self.first90), 'returned_below80': self.returned, 'returned_share_entrants': self.returned / len(self.first80) if self.first80 else None, 'first80_not_migrated': sum((x['first80'] is not None and x['migration'] is None for x in self.tokenstats)), 'first80_sec': dist(self.first80), 'first90_sec': dist(self.first90), 'first80_to_first90_sec': dist(self.t8090), 'migration_sec': dist(self.ttm), 'band_token_n': dict(self.bandtoks), 'metrics': {k: v.result() for k, v in self.bags.items()}}

def real():
    launches = {r['mint']: r for r in csv.DictReader(open(D / 'launches.csv', newline='', encoding='utf8'))}
    data = Dataset('real_standard_K_active_noninstant')
    with open(D / 'real-standard.csv', newline='', encoding='utf8') as f:
        for mint, g in itertools.groupby(csv.DictReader(f), key=lambda x: x['mint']):
            rr = list(g)
            l = launches[mint]
            c = float(l['completion_age']) if l['completion_age'] else None
            migration = c if c is not None and c <= H else None
            instant = c is not None and c <= 1
            rows = [(float(x['age_sec']), float(x['price_sol']), float(x['progress']), float(x['quote_sol']), x['side']) for x in rr]
            data.add(mint, rows, min(H, migration) if migration is not None else H, migration, instant)
    return data
if __name__ == '__main__':
    result = {}
    begin = time.time()
    d = real()
    result['real'] = d.result()
    json.dump(d.tokenstats, open(D / 'real-token-metrics.json', 'w'), separators=(',', ':'))
    print('real done', time.time() - begin, flush=True)
    json.dump(result, open(D / 'comparison.json', 'w'), indent=2, allow_nan=False)
    for variant in ['A', 'B']:
        f = D / ('sim-' + variant + '-tapes.json')
        if not f.exists():
            raise FileNotFoundError(f'Missing simulation tape: {f}; run extract-sim.mjs first')
        d = Dataset('sim_' + variant + '_active_noninstant')
        raw = json.load(open(f))
        for t in raw:
            rows = [(x['ageMs'] / 1000, x['priceUsd'] / 150, x['progress'], x['quoteUsd'] / 150, x['side'].lower()) for x in t['researchPrints']]
            d.add(t['tokenId'], rows, t['observationEndSec'], t['migratedAtSec'], t['migratedAtSec'] is not None and t['migratedAtSec'] <= 1)
        result[variant] = d.result()
        json.dump(d.tokenstats, open(D / ('sim-' + variant + '-token-metrics.json'), 'w'), separators=(',', ':'))
        print(variant, 'done', time.time() - begin, flush=True)
        del raw, d
    json.dump(result, open(D / 'comparison.json', 'w'), indent=2, allow_nan=False)
