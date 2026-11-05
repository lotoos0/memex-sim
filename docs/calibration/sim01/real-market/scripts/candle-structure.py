"""Observed-bar structure; no synthetic candles for empty seconds."""

import os
import csv, json, collections
from pathlib import Path
D = Path(os.environ['SIM01_WORK_DIR'])
result = {}
for label in ['real', 'A', 'B']:
    counts = collections.defaultdict(lambda: collections.Counter())
    with open(D / ('candles-' + label + '-1s.csv'), newline='', encoding='utf8') as f:
        for r in csv.DictReader(f):
            c = counts[r['band_at_bucket_start']]
            n = int(r['buy_count']) + int(r['sell_count'])
            op, hi, lo, cl = [float(r[k]) for k in ['open', 'high', 'low', 'close']]
            c['candles'] += 1
            c['single_print'] += n == 1
            c['wick'] += hi > max(op, cl) * (1 + 1e-10) or lo < min(op, cl) * (1 - 1e-10)
            c['trade_only_flat'] += float(r['trade_high']) == float(r['trade_low'])
    result[label] = {k: {**dict(v), 'single_print_share': v['single_print'] / v['candles'], 'wick_share': v['wick'] / v['candles'], 'trade_only_flat_share': v['trade_only_flat'] / v['candles']} for k, v in counts.items()}
json.dump(result, open(D / 'candle-structure.json', 'w'), indent=2)
print(json.dumps(result, indent=2))
