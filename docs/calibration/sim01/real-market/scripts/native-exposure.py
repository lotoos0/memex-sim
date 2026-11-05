"""Unique per-token second bins by state at second start, not summed episode bins."""

import os
import csv, json, math, collections, itertools
from pathlib import Path
D = Path(os.environ['SIM01_WORK_DIR'])
out = {}

def band(p):
    return '0_80' if p < 0.8 else '80_90' if p < 0.9 else '90_100'
launches = {r['mint']: r for r in csv.DictReader(open(D / 'launches.csv', newline='', encoding='utf8'))}
for label in ['real', 'A', 'B']:
    ends = None if label == 'real' else {t['tokenId']: t['observationEndSec'] for t in json.load(open(D / ('sim-' + label + '-tapes.json')))}
    counts = collections.defaultdict(collections.Counter)
    with open(D / ('candles-' + label + '-1s.csv'), newline='', encoding='utf8') as f:
        for id, g in itertools.groupby(csv.DictReader(f), key=lambda r: r['id']):
            lastsec = -1
            state = '0_80'
            lastprogress = 0
            for row in g:
                sec = int(row['age_second'])
                gap = sec - lastsec - 1
                counts[state]['bins'] += gap
                counts[state]['empty'] += gap
                k = row['band_at_bucket_start']
                counts[k]['bins'] += 1
                counts[k]['active'] += 1
                counts[k]['trades'] += int(row['buy_count']) + int(row['sell_count'])
                state = band(float(row['progress_close']))
                lastprogress = float(row['progress_close'])
                lastsec = sec
            if label == 'real':
                age = launches[id]['completion_age']
                end = min(1800, float(age)) if age else 1800
            else:
                end = ends[id]
            total = max(math.ceil(end), lastsec + 1)
            tail = total - lastsec - 1
            if tail and lastprogress < 1:
                counts[state]['bins'] += tail
                counts[state]['empty'] += tail
    out[label] = {k: {**dict(v), 'empty_share': v['empty'] / v['bins'], 'trades_per_exposed_second_bin': v['trades'] / v['bins']} for k, v in counts.items()}
json.dump(out, open(D / 'native-exposure.json', 'w'), indent=2)
print(json.dumps(out, indent=2))
