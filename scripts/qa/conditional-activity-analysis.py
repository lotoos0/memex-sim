"""P1 analysis reuses benchmark definitions; large outputs stay in output/."""
import argparse
import collections
import csv
import hashlib
import itertools
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'docs/calibration/sim01/real-market/scripts'
parser = argparse.ArgumentParser()
parser.add_argument('--work-dir', required=True, type=Path)
parser.add_argument('--reference-work', required=True, type=Path)
parser.add_argument('--reuse-computed', action='store_true', help='Recheck existing benchmark outputs and recompute P1 extras')
args = parser.parse_args()
work, reference = args.work_dir.resolve(), args.reference_work.resolve()
if work == reference or not work.is_relative_to(ROOT / 'output'):
    raise ValueError('Use a separate output/ experiment directory')
os.environ['SIM01_WORK_DIR'] = str(work)
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
sys.path.insert(0, str(SCRIPTS))
from analyze import Bag, dist  # noqa: E402
from reproduce import compare_subset  # noqa: E402

def read(name):
    return json.loads((work / name).read_text(encoding='utf-8'))

def write(name, value):
    (work / name).write_text(json.dumps(value, indent=2, allow_nan=False) + '\n', encoding='utf-8')

def sha(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            digest.update(block)
    return digest.hexdigest()

for name in ['real-standard.csv', 'launches.csv']:
    target = work / name
    if not target.exists():
        # Link immutable prepared inputs when possible; never mutate them.
        try:
            target.hardlink_to(reference / name)
        except OSError:
            shutil.copyfile(reference / name, target)
if args.reuse_computed:
    previous = read('analysis-provenance.json')
    for name, digest in previous['inputs_sha256'].items():
        if sha(work / name) != digest:
            raise ValueError(f'Cached analysis belongs to different input: {name}')
if not args.reuse_computed:
    for name in ['analyze.py', 'sensitivity.py', 'candle-structure.py', 'native-exposure.py', 'hours-sensitivity.py']:
        subprocess.run([sys.executable, str(SCRIPTS / name)], check=True)
historical = json.loads((ROOT / 'docs/calibration/sim01/real-market/research-results.json').read_text(encoding='utf-8'))
for name, filename in [('comparison', 'comparison.json'), ('sensitivity', 'sensitivity.json'),
                       ('native_exposure', 'native-exposure.json'), ('candle_structure', 'candle-structure.json'),
                       ('hours_sensitivity', 'hours-sensitivity.json')]:
    if name == 'hours_sensitivity':
        compare_subset(historical[name], read(filename), name)
        continue
    for label in ['real', 'A']:
        compare_subset(historical[name][label], read(filename)[label], name + '.' + label)
print('Real and A match persistent benchmark: PASS', flush=True)

def activity():
    result = {}
    launches = {x['mint']: x for x in csv.DictReader(open(work / 'launches.csv', newline='', encoding='utf-8'))}
    for label in ['real', 'A', 'B']:
        ends = None if label == 'real' else {t['tokenId']: t['observationEndSec'] for t in read(f'sim-{label}-tapes.json')}
        stages = collections.defaultdict(lambda: dict(bins=0, active=0, trades=0, high=0,
            tokens=set(), high_tokens=set(), peaks=[], burst_lengths=[], silence_lengths=[], intensity=collections.Counter()))
        with open(work / f'candles-{label}-1s.csv', newline='', encoding='utf-8') as stream:
            for token, rows in itertools.groupby(csv.DictReader(stream), key=lambda x: x['id']):
                rows = list(rows)
                end = min(1800, float(launches[token]['completion_age'] or 1800)) if label == 'real' else ends[token]
                total = max(math.ceil(end), int(rows[-1]['age_second']) + 1)
                sparse = {int(x['age_second']): x for x in rows}
                state = '0_80'
                run_kind = None
                run_stage = None
                run_length = 0
                peaks = collections.Counter()
                def close_run():
                    if run_kind in ['burst', 'silence']:
                        stages[run_stage]['burst_lengths' if run_kind == 'burst' else 'silence_lengths'].append(run_length)
                for second in range(total):
                    row = sparse.get(second)
                    stage = row['band_at_bucket_start'] if row else state
                    n = int(row['buy_count']) + int(row['sell_count']) if row else 0
                    c = stages[stage]
                    c['bins'] += 1
                    c['active'] += n > 0
                    c['trades'] += n
                    c['high'] += n >= 2
                    c['tokens'].add(token)
                    c['intensity'][n] += 1
                    peaks[stage] = max(peaks[stage], n)
                    if n >= 2:
                        c['high_tokens'].add(token)
                    kind = 'burst' if n >= 2 else 'silence' if n == 0 else 'single'
                    if kind == run_kind and stage == run_stage:
                        run_length += 1
                    else:
                        close_run()
                        run_kind, run_stage, run_length = kind, stage, 1
                    if row:
                        progress = float(row['progress_close'])
                        state = '0_80' if progress < .8 else '80_90' if progress < .9 else '90_100'
                close_run()
                for stage, peak in peaks.items():
                    stages[stage]['peaks'].append(peak)
        result[label] = {}
        for stage, c in stages.items():
            native = read('native-exposure.json')[label][stage]
            assert c['bins'] == native['bins'] and c['trades'] == native['trades']
            assert sum(c['intensity'].values()) == c['bins']
            assert sum(c['burst_lengths']) == c['high']
            assert sum(c['silence_lengths']) == c['bins'] - c['active']
            result[label][stage] = dict(tokens=len(c['tokens']), exposed_bins=c['bins'],
                high_activity_token_share=len(c['high_tokens']) / len(c['tokens']),
                high_bin_share=c['high'] / c['bins'], prints_per_bin=dist(c['intensity']),
                token_peak_prints_per_bin=dist(c['peaks']), burst_duration_sec=dist(c['burst_lengths']),
                silence_duration_sec=dist(c['silence_lengths']),
                intensity_histogram={str(k): v for k, v in sorted(c['intensity'].items())})
    return result

if not args.reuse_computed or not (work / 'activity-distributions.json').exists():
    write('activity-distributions.json', activity())
tokens = {v: read(f'sim-{v}-tapes.json') for v in ['A', 'B']}
if [(x['tokenId'], x['fate'], x['stillborn'], x['startUtc']) for x in tokens['A']] != [(x['tokenId'], x['fate'], x['stillborn'], x['startUtc']) for x in tokens['B']]:
    raise AssertionError('Initial conditions differ')
paired = {}
for name, selection in {
    'initial_cohort': lambda t: True,
    'A_reached80': lambda t: t['first80Sec'] is not None,
    'A_80_90_ready': lambda t: any(e['group'] == '80_90_ready' for e in t['episodes']),
    'A_80_90_not_ready': lambda t: any(e['group'] == '80_90_not_ready' for e in t['episodes']),
    'A_90_100_ready': lambda t: any(e['group'] == '90_100_ready' for e in t['episodes']),
    'A_90_100_not_ready': lambda t: any(e['group'] == '90_100_not_ready' for e in t['episodes']),
}.items():
    pairs = [(a, b) for a, b in zip(tokens['A'], tokens['B']) if selection(a)]
    values = {}
    for label, field in [('trades', 'trades'), ('maxDrawdown', 'maxDrawdownPct')]:
        values[label] = dist([b['preMigration'][field] - a['preMigration'][field] for a, b in pairs])
    values['quote_sol_delta'] = dist([(b['preMigration']['buyQuoteUsd'] + b['preMigration']['sellQuoteUsd'] - a['preMigration']['buyQuoteUsd'] - a['preMigration']['sellQuoteUsd']) / 150 for a, b in pairs])
    values['migration_delta_count'] = sum(b['migratedAtSec'] is not None for a, b in pairs) - sum(a['migratedAtSec'] is not None for a, b in pairs)
    paired[name] = dict(tokens=len(pairs), delta_B_minus_A=values)
write('paired.json', paired)
anchor_windows = {v: Bag() for v in ['A', 'B']}
anchor_counts = collections.Counter()
for a, b in zip(tokens['A'], tokens['B']):
    anchor = a['first80Sec']
    if anchor is None or anchor > 1680:
        continue
    anchor_counts['A_eligible_anchors'] += 1
    for v, token in [('A', a), ('B', b)]:
        end = min(anchor + 120, token['observationEndSec'])
        if end < anchor:
            anchor_counts[v + '_ended_before_anchor'] += 1
            continue
        initial = 30 / 1073000000
        rows = []
        for x in token['researchPrints']:
            age = x['ageMs'] / 1000
            if age <= anchor:
                initial = x['priceUsd'] / 150
            elif age <= end:
                rows.append((age, x['priceUsd'] / 150, x['progress'], x['quoteUsd'] / 150, x['side'].lower()))
        anchor_windows[v].add(rows, anchor, end, initial)
write('A-anchor-windows.json', dict(counts=dict(anchor_counts), metrics={v: b.result() for v, b in anchor_windows.items()}))
cohorts = {}
age_activity = {}
for v, ts in tokens.items():
    quiet = [t for t in ts if t['stillborn']]
    cohorts[v] = dict(tokens=len(ts), dead=sum(t['finalPhase'] in ['DEAD', 'RUGGED'] for t in ts),
        stillborn=len(quiet), stillborn_trade_count=dist([len(t['researchPrints']) for t in quiet]),
        migrated=sum(t['migratedAtSec'] is not None for t in ts),
        active=sum(bool(t['researchPrints']) for t in ts),
        inactive_last60s_unmigrated=sum(t['migratedAtSec'] is None and not any(
            x['ageMs'] / 1000 > t['observationEndSec'] - 60 for x in t['researchPrints']) for t in ts),
        total_quote_sol=sum(sum(x['quoteUsd'] / 150 for x in t['researchPrints']) for t in ts),
        trades=sum(len(t['researchPrints']) for t in ts),
        observed_seconds=sum(t['observationEndSec'] for t in ts),
        high_activity_tokens=sum(any(n >= 2 for n in collections.Counter(math.floor(x['ageMs'] / 1000)
                                 for x in t['researchPrints']).values()) for t in ts),
        post_silence_prints=sum(sum(x['ageMs'] / 1000 >= t['silentAfterSec'] for x in t['researchPrints'])
                                for t in ts if t['silentAfterSec'] is not None))
    age_activity[v] = {}
    for start, end in [(0, 10), (10, 60), (60, 120), (120, 300), (300, 600), (600, 1800)]:
        seconds = sum(max(0, min(end, t['observationEndSec']) - start) for t in ts)
        points = [x for t in ts for x in t['researchPrints'] if start <= x['ageMs'] / 1000 < end]
        age_activity[v][f'{start}_{end}'] = dict(exposure_seconds=seconds, trades=len(points),
            trades_per_second=len(points) / seconds if seconds else None,
            quote_sol_per_second=sum(x['quoteUsd'] / 150 for x in points) / seconds if seconds else None)
write('cohorts.json', cohorts)
write('age-activity.json', age_activity)
write('analysis-provenance.json', dict(
    reference_source_manifest_sha256=sha(ROOT / 'docs/calibration/sim01/real-market/sources.json'),
    inputs_sha256={name: sha(work / name) for name in ['real-standard.csv', 'launches.csv', 'sim-A-tapes.json', 'sim-B-tapes.json']},
    scripts_sha256={str(p.relative_to(ROOT)): sha(p) for p in [Path(__file__).resolve(), *sorted(SCRIPTS.glob('*.py'))]}))
print('P1 paired initial conditions and analysis: PASS', flush=True)
