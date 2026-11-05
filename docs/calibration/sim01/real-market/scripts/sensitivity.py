"""Native 1s candles and common 120-second first-80 windows."""

import os
import sys, csv, json, itertools, math, collections, datetime
from pathlib import Path
from analyze import Bag, GEN, H, band, dist
D = Path(os.environ['SIM01_WORK_DIR'])

def stream_real():
    launches = {r['mint']: r for r in csv.DictReader(open(D / 'launches.csv', newline='', encoding='utf8'))}
    with open(D / 'real-standard.csv', newline='', encoding='utf8') as f:
        for mint, g in itertools.groupby(csv.DictReader(f), key=lambda x: x['mint']):
            rows = list(g)
            l = launches[mint]
            c = float(l['completion_age']) if l['completion_age'] else None
            if c is not None and c <= 1:
                continue
            end = min(H, c) if c is not None else H
            yield (mint, float(l['launch_ts']), [(float(x['age_sec']), float(x['price_sol']), float(x['progress']), float(x['quote_sol']), x['side']) for x in rows], end)

def stream_sim(v):
    raw = json.load(open(D / ('sim-' + v + '-tapes.json')))
    for t in raw:
        if not t['researchPrints']:
            continue
        yield (t['tokenId'], datetime.datetime.fromisoformat(t['startUtc'].replace('Z', '+00:00')).timestamp(), [(x['ageMs'] / 1000, x['priceUsd'] / 150, x['progress'], x['quoteUsd'] / 150, x['side'].lower()) for x in t['researchPrints']], t['observationEndSec'])
result = {}
for label, stream in [('real', stream_real()), ('A', stream_sim('A')), ('B', stream_sim('B'))]:
    win = Bag()
    eligible = 0
    ret = 0
    native = {k: {'body': [], 'range': [], 'tradeonly_body': [], 'tradeonly_range': [], 'trades': 0, 'buys': 0, 'buyquote': 0.0, 'sellquote': 0.0, 'candles': 0, 'flat': 0, 'green': 0} for k in ['0_80', '80_90', '90_100']}
    with open(D / ('candles-' + label + '-1s.csv'), 'w', newline='', encoding='utf8') as f:
        writer = csv.writer(f)
        writer.writerow(['id', 'age_second', 'unix_second', 'band_at_bucket_start', 'open', 'high', 'low', 'close', 'trade_open', 'trade_high', 'trade_low', 'quote_sol', 'buy_count', 'sell_count', 'progress_close'])
        for id, birth, rows, end in stream:
            entry = next((i for i, x in enumerate(rows) if x[2] >= 0.8), None)
            if entry is not None and rows[entry][0] <= 1680:
                eligible += 1
                begin = rows[entry]
                stop = min(end, begin[0] + 120)
                selected = [x for x in rows[entry + 1:] if x[0] <= stop]
                win.add(selected, begin[0], stop, begin[1])
                ret += any((x[2] < 0.8 for x in selected))
            last = GEN
            progress = 0
            for sec, g in itertools.groupby(rows, key=lambda x: math.floor(x[0])):
                points = list(g)
                ps = [x[1] for x in points]
                state = band(progress)
                z = native[state]
                high = max(last, *ps)
                low = min(last, *ps)
                buys = sum((x[4] == 'buy' for x in points))
                bq = sum((x[3] for x in points if x[4] == 'buy'))
                sq = sum((x[3] for x in points if x[4] == 'sell'))
                writer.writerow([id, sec, birth + sec, state, last, high, low, ps[-1], ps[0], max(ps), min(ps), bq + sq, buys, len(points) - buys, points[-1][2]])
                z['body'].append((ps[-1] / last - 1) * 100)
                z['range'].append((high / low - 1) * 100)
                z['tradeonly_body'].append((ps[-1] / ps[0] - 1) * 100)
                z['tradeonly_range'].append((max(ps) / min(ps) - 1) * 100)
                z['candles'] += 1
                z['trades'] += len(points)
                z['buys'] += buys
                z['buyquote'] += bq
                z['sellquote'] += sq
                z['flat'] += high == low
                z['green'] += ps[-1] > last
                last = ps[-1]
                progress = points[-1][2]
    result[label] = {'from80_window120': win.result(), 'window120_eligible': eligible, 'returned_below80_window120': ret, 'return_share_window120': ret / eligible if eligible else None, 'native_candles': {}}
    for k, z in native.items():
        result[label]['native_candles'][k] = {**{x: z[x] for x in ['candles', 'trades', 'buys']}, 'buy_quote_sol': z['buyquote'], 'sell_quote_sol': z['sellquote'], 'buy_count_share': z['buys'] / z['trades'] if z['trades'] else None, 'buy_quote_share': z['buyquote'] / (z['buyquote'] + z['sellquote']) if z['buyquote'] + z['sellquote'] else None, 'body_pct': dist(z['body']), 'range_pct': dist(z['range']), 'tradeonly_body_pct': dist(z['tradeonly_body']), 'tradeonly_range_pct': dist(z['tradeonly_range']), 'flat_share': z['flat'] / z['candles'] if z['candles'] else None, 'green_share': z['green'] / z['candles'] if z['candles'] else None}
    print(label, 'native candles and 120s done', flush=True)
json.dump(result, open(D / 'sensitivity.json', 'w'), indent=2, allow_nan=False)
