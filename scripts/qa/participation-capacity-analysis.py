"""Measure P1c from the PR73 ordered CSVs and paired simulation tapes."""
import argparse
from array import array
import collections
import csv
import hashlib
import itertools
import json
import math
from pathlib import Path
import random
import sys

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--work-dir', type=Path, required=True)
parser.add_argument('--reference-work', type=Path, required=True)
parser.add_argument('--prepare-real', action='store_true')
args = parser.parse_args()
REF = args.reference_work.resolve()
OUT = args.work_dir.resolve()
if OUT == ROOT / 'output' or not OUT.is_relative_to(ROOT / 'output'):
    parser.error('Use a dedicated output subdirectory')

WINDOWS = [(-120,-60),(-60,-30),(-30,-10),(-10,0),(0,10),(10,30),(30,120)]

def dist(values):
    x = sorted(values)
    def q(p):
        if not x: return None
        pos=(len(x)-1)*p; lo=math.floor(pos)
        return x[lo]+(x[math.ceil(pos)]-x[lo])*(pos-lo)
    return dict(n=len(x),p10=q(.1),p50=q(.5),p90=q(.9),p99=q(.99),max=x[-1] if x else None)

def concentration(values):
    x=sorted(values,reverse=True); n=len(x); total=sum(x)
    if not total: return dict(n=n,total=0)
    counts={}; accum=0
    for i,v in enumerate(x,1):
        accum+=v
        for p in [.5,.8,.9]:
            if accum>=total*p and str(p) not in counts: counts[str(p)]=i/n
    asc=list(reversed(x))
    return dict(n=n,total=total,top1_share=sum(x[:max(1,math.ceil(n*.01))])/total,
        top5_share=sum(x[:max(1,math.ceil(n*.05))])/total,top10_share=sum(x[:max(1,math.ceil(n*.1))])/total,
        token_fraction_for_volume=counts,gini=2*sum((i+1)*v for i,v in enumerate(asc))/(n*total)-(n+1)/n)

def aligned(rows,entry,end,lo,hi):
    a=rows[entry][0];start=max(0,a+lo);stop=min(end,a+hi)
    if hi<=0:
        selected=[x for x in rows[:entry] if start<=x[0] and (x[0]<stop or (hi==0 and x[0]==stop))]
    else:
        if stop>start:
            selected=[x for x in rows[entry+1:] if start<=x[0] and (x[0]<stop or (stop==end and x[0]==stop) or (hi==120 and x[0]==stop))]
        else:
            selected=[x for x in rows[entry+1:] if x[0]==a] if lo==0 and start==stop==a else []
    return start,stop,selected

class Bag:
    def __init__(self):
        self.paths=0;self.full=0;self.seconds=0.;self.zero_prints=0;self.offered=0
        self.n=0;self.buy=0;self.bq=0.;self.sq=0.;self.bins=0;self.active=0
        self.sizes=array('d');self.buy_sizes=array('d');self.sell_sizes=array('d')
        self.counts=[];self.quotes=[];self.rates=[];self.net_rates=[];self.durations=[]
        self.observable_counts=[];self.observable_quotes=[];self.zero_quote=0.;self.zero_sizes=array('d')
        self.count_square=0.;self.gross_square=0.;self.net_square=0.;self.absnet=0.
    def add(self,rows,start,end,full_width=None):
        self.offered+=1
        duration=max(0.,end-start)
        if duration>0 or rows:
            self.observable_counts.append(len(rows));self.observable_quotes.append(sum(x[3] for x in rows))
        if duration<=0:
            self.zero_prints+=len(rows)
            self.zero_quote+=sum(x[3] for x in rows);self.zero_sizes.extend(x[3] for x in rows)
            return
        self.paths+=1;self.full+=full_width is not None and abs(duration-full_width)<1e-8
        self.seconds+=duration;self.durations.append(duration)
        b=sum(x[3] for x in rows if x[4]=='buy');s=sum(x[3] for x in rows if x[4]=='sell')
        self.n+=len(rows);self.buy+=sum(x[4]=='buy' for x in rows);self.bq+=b;self.sq+=s
        self.counts.append(len(rows));self.quotes.append(b+s);self.rates.append(len(rows)/duration);self.net_rates.append((b-s)/duration)
        bucket=collections.defaultdict(lambda:[0,0.,0.])
        for x in rows:
            self.sizes.append(x[3]);(self.buy_sizes if x[4]=='buy' else self.sell_sizes).append(x[3])
            z=bucket[math.floor(x[0])];z[0]+=1;z[1 if x[4]=='buy' else 2]+=x[3]
        bins=max(0,math.ceil(end)-math.floor(start))
        bins+=sum(not (math.floor(start)<=sec<math.ceil(end)) for sec in bucket)
        self.bins+=bins;self.active+=len(bucket)
        for n,b,s in bucket.values():
            self.count_square+=n*n;self.gross_square+=(b+s)**2;self.net_square+=(b-s)**2;self.absnet+=abs(b-s)
    def result(self):
        gross=self.bq+self.sq;net=self.bq-self.sq
        mean=self.n/self.bins if self.bins else 0
        return dict(offered_paths=self.offered,observed_paths=self.paths,full_windows=self.full,
            zero_exposure_prints_excluded_from_rates=self.zero_prints,exposure_seconds=self.seconds,
            zero_exposure_quote_sol=self.zero_quote,zero_exposure_transaction_sol=dist(self.zero_sizes),
            observable_trades_per_token_including_zero_age=dist(self.observable_counts),
            observable_volume_concentration_including_zero_age=concentration(self.observable_quotes),
            exposed_age_second_bins=self.bins,trades=self.n,buy_count=self.buy,
            trades_per_second=self.n/self.seconds if self.seconds else None,
            active_bin_share=self.active/self.bins if self.bins else None,
            trades_per_active_bin=self.n/self.active if self.active else None,
            buy_sol=self.bq,sell_sol=self.sq,gross_sol=gross,net_sol=net,
            buy_sol_per_second=self.bq/self.seconds if self.seconds else None,
            sell_sol_per_second=self.sq/self.seconds if self.seconds else None,
            gross_sol_per_second=gross/self.seconds if self.seconds else None,
            net_sol_per_second=net/self.seconds if self.seconds else None,
            mean_transaction_sol=gross/self.n if self.n else None,
            net_to_gross=net/gross if gross else None,
            transaction_sol=dist(self.sizes),buy_transaction_sol=dist(self.buy_sizes),sell_transaction_sol=dist(self.sell_sizes),
            trades_per_token=dist(self.counts),quote_sol_per_token=dist(self.quotes),
            paths_with_prints=sum(x>0 for x in self.counts),
            exposure_seconds_paths_with_prints=sum(t for n,t in zip(self.counts,self.durations) if n>0),
            trades_per_second_among_paths_with_prints=self.n/sum(t for n,t in zip(self.counts,self.durations) if n>0) if self.n else None,
            rate_per_token=dist(self.rates),net_rate_per_token=dist(self.net_rates),duration_sec=dist(self.durations),
            volume_concentration=concentration(self.quotes),trade_concentration=concentration(self.counts),
            gross_sol_sd_per_age_second_bin=math.sqrt(max(0,self.gross_square/self.bins-(gross/self.bins)**2)) if self.bins else None,
            net_sol_sd_per_age_second_bin=math.sqrt(max(0,self.net_square/self.bins-(net/self.bins)**2)) if self.bins else None,
            absolute_net_sol_per_age_second_bin=self.absnet/self.bins if self.bins else None,
            trade_count_fano_per_age_second_bin=(self.count_square/self.bins-mean**2)/mean if mean else None)

def real_tokens():
    launches={x['mint']:x for x in csv.DictReader(open(REF/'launches.csv',newline='',encoding='utf8'))}
    with open(REF/'real-standard.csv',newline='',encoding='utf8') as stream:
        for mint,group in itertools.groupby(csv.DictReader(stream),key=lambda x:x['mint']):
            c=launches[mint]['completion_age'];completion=float(c) if c else None
            if completion is not None and completion<=1:continue
            end=min(1800,completion) if completion is not None else 1800
            rows=[(float(x['age_sec']),float(x['price_sol']),float(x['progress']),float(x['quote_sol']),x['side']) for x in group]
            yield mint,rows,end,{}

def sim_tokens(variant):
    for t in json.loads((OUT/f'sim-{variant}-tapes.json').read_text(encoding='utf8')):
        rows=[(x['ageMs']/1000,x['priceUsd']/150,x['progress'],x['quoteUsd']/150,x['side'].lower()) for x in t['researchPrints']]
        yield t['tokenId'],rows,t['observationEndSec'],dict(fate=t['fate'],stillborn=t['stillborn'], seed=t['seed'],
            start_utc=t['startUtc'], migration=t['migratedAtSec'],
            readiness_groups=sorted({e['group'] for e in t['episodes']}),
            warmup=hashlib.sha256(json.dumps([x for x in t['researchPrints'] if x['ageMs']<=60000]).encode()).hexdigest())

def analyze(label, stream):
    groups = {name: Bag() for name in ('initial', 'active', 'entrants_full', 'entrants_pre80')}
    windows = {f'{lo}_{hi}': Bag() for lo, hi in WINDOWS}
    age_ranges = [(120, 300), (300, 600), (600, 1800), (120, 600)]
    ages = {f'{lo}_{hi}': {name: Bag() for name in ('all_initial', 'all_active', 'entrants')}
            for lo, hi in age_ranges}
    tokens, entry_ages, entry_gross, entry_net, recycling = [], [], [], [], []
    for token_id, rows, end, meta in stream:
        entry = next((i for i, row in enumerate(rows) if row[2] >= .8), None)
        active = bool(rows)
        groups['initial'].add(rows, 0, end)
        if active:
            groups['active'].add(rows, 0, end)
        if entry is not None:
            first80 = rows[entry][0]
            pre = rows[:entry+1]
            gross = sum(row[3] for row in pre)
            net = sum(row[3] if row[4] == 'buy' else -row[3] for row in pre)
            entry_ages.append(first80)
            entry_gross.append(gross)
            entry_net.append(net)
            if net > 0:
                recycling.append(gross / net)
            groups['entrants_full'].add(rows, 0, end)
            groups['entrants_pre80'].add(pre, 0, first80)
            if first80 <= 1680:
                for lo, hi in WINDOWS:
                    start, stop, selected = aligned(rows, entry, end, lo, hi)
                    windows[f'{lo}_{hi}'].add(selected, start, stop, hi-lo)
        age_stats = {}
        for lo, hi in age_ranges:
            key = f'{lo}_{hi}'
            stop = min(hi, end)
            if stop <= lo:
                continue
            selected = [row for row in rows if lo <= row[0] < hi or row[0] == end == hi]
            ages[key]['all_initial'].add(selected, lo, stop, hi-lo)
            if active:
                ages[key]['all_active'].add(selected, lo, stop, hi-lo)
            if entry is not None:
                ages[key]['entrants'].add(selected, lo, stop, hi-lo)
            age_stats[key] = (len(selected), stop-lo, sum(row[3] for row in selected))
        tokens.append(dict(id=token_id, active=active, end=end,
                           first80=None if entry is None else rows[entry][0],
                           trades=len(rows), quote_sol=sum(row[3] for row in rows),
                           age_stats=age_stats, **meta))
    entrants = [t for t in tokens if t['first80'] is not None]
    return dict(
        contribution=dict(initial_tokens=len(tokens), active_tokens=sum(t['active'] for t in tokens),
                          entrants=len(entrants)),
        groups={k: v.result() for k, v in groups.items()},
        first80_sec=dist(entry_ages),
        cumulative_first80_gross_sol=dist(entry_gross),
        cumulative_first80_net_sol=dist(entry_net),
        cumulative_first80_gross_to_net=dist(recycling),
        aligned_windows={k: v.result() for k, v in windows.items()},
        aligned_horizon_eligible=sum(age <= 1680 for age in entry_ages),
        age_windows={k: {g: b.result() for g, b in v.items()} for k, v in ages.items()},
    ), tokens

def source_hash(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            digest.update(block)
    return digest.hexdigest()


def summarize(label, stream):
    result, tokens = analyze(label, stream)
    if label != 'Real':
        migrated = [t['migration'] for t in tokens if t['migration'] is not None]
        result['migration'] = {'count': len(migrated), 'time_sec': dist(migrated)}
        result['stillborn'] = sum(t['stillborn'] for t in tokens)
    else:
        result['migration'] = reference['comparison']['real']['migration_sec']
    return result, tokens


def totals(tokens):
    return dict(tokens=len(tokens), trades=sum(t['trades'] for t in tokens),
                gross=sum(t['quote_sol'] for t in tokens))


def delta(pairs):
    return dict(n=len(pairs),
                trades=dist(y['trades']-x['trades'] for x,y in pairs),
                quote=dist(y['quote_sol']-x['quote_sol'] for x,y in pairs),
                migration=sum(int(y['migration'] is not None)-int(x['migration'] is not None) for x,y in pairs))


def slim(result):
    keys = ['observed_paths', 'full_windows', 'zero_exposure_prints_excluded_from_rates',
            'zero_exposure_quote_sol', 'exposure_seconds', 'trades', 'buy_count',
            'trades_per_second', 'buy_sol', 'sell_sol', 'gross_sol', 'net_sol',
            'gross_sol_per_second', 'net_sol_per_second', 'net_to_gross',
            'transaction_sol', 'buy_transaction_sol', 'sell_transaction_sol',
            'trades_per_token', 'volume_concentration', 'paths_with_prints',
            'trades_per_second_among_paths_with_prints']
    def metrics(p):
        return {key:p[key] for key in keys}
    return {**{key:result[key] for key in [
                'contribution', 'first80_sec', 'cumulative_first80_gross_sol',
                'cumulative_first80_net_sol', 'cumulative_first80_gross_to_net',
                'aligned_horizon_eligible', 'migration']},
            'stillborn':result.get('stillborn'),
            'groups':{k:metrics(result['groups'][k]) for k in ['initial','active','entrants_full','entrants_pre80']},
            'windows':{k:metrics(v) for k,v in result['aligned_windows'].items()},
            'ages':{k:{g:metrics(p) for g,p in bins.items()} for k,bins in result['age_windows'].items()
                    if k in ['120_300','300_600','600_1800','120_600']}}


reference = json.loads((ROOT/'docs/calibration/sim01/real-market/research-results.json').read_text(encoding='utf-8'))
real_hashes = {p.name: source_hash(p) for p in [REF/'real-standard.csv', REF/'launches.csv', Path(__file__)]}
cache = OUT/'real-metrics.json'
if cache.exists():
    saved = json.loads(cache.read_text(encoding='utf-8'))
    if saved['hashes'] != real_hashes:
        raise ValueError('Real cache input or analyzer changed. Use a fresh work directory or regenerate the cache.')
    real = saved['metrics']
else:
    result, _ = summarize('Real', real_tokens())
    real = slim(result)
    cache.write_text(json.dumps(dict(hashes=real_hashes,metrics=real),allow_nan=False),encoding='utf-8')
print('Real measured', flush=True)
if args.prepare_real:
    sys.exit(0)
arms, cohorts = {'Real':real}, {}
for label, stream in [('A',sim_tokens('A')),('B',sim_tokens('B'))]:
    result, cohorts[label] = summarize(label,stream)
    arms[label] = slim(result)
    print(label, 'measured', flush=True)

a,b = cohorts['A'],cohorts['B']
assert len(a)==len(b)==6000
for x,y in zip(a,b):
    assert all(x[k]==y[k] for k in ['id','seed','fate','stillborn','start_utc','warmup'])
    assert not y['stillborn'] or y['trades']==0

for label, key in [('Real','real'),('A','A')]:
    measured=arms[label]
    original=reference['comparison'][key]
    assert measured['contribution']['entrants']==original['first80_n']
    assert measured['groups']['active']['trades']==original['metrics']['full']['trades']
    post=[measured['windows'][k] for k in ['0_10','10_30','30_120']]
    orig=reference['sensitivity'][key]['from80_window120']
    assert sum(p['trades']+p['zero_exposure_prints_excluded_from_rates'] for p in post)==orig['trades']
    assert math.isclose(sum(p['exposure_seconds'] for p in post),orig['duration_sec'],rel_tol=1e-10)
    assert math.isclose(sum(p['gross_sol']+p['zero_exposure_quote_sol'] for p in post),
                        orig['buy_quote_sol']+orig['sell_quote_sol'],rel_tol=1e-10)

active = [t for t in a if t['active']]
leaders = {t['id'] for t in sorted(active,key=lambda t:(-t['quote_sol'],t['id']))[:math.ceil(len(active)*.05)]}
fixed = {label:{name:totals([t for t in rows if (t['id'] in leaders)==top])
                for name,top in [('leaders',True),('others',False)]}
         for label,rows in [('A',a),('B',b)]}
l0,o0,l1,o1 = [fixed[v][g]['gross'] for v in ['A','B'] for g in ['leaders','others']]
def share(l,o):
    return l/(l+o)
fixed['leader_contribution']=(share(l1,o0)-share(l0,o0)+share(l1,o1)-share(l0,o1))/2
fixed['other_contribution']=(share(l0,o1)-share(l0,o0)+share(l1,o1)-share(l1,o0))/2

pairs=list(zip(a,b))
paired={'all':delta(pairs),'A_entrants':delta([(x,y) for x,y in pairs if x['first80'] is not None])}
for group in ['80_90_ready','80_90_not_ready','90_100_ready','90_100_not_ready']:
    paired[group]=delta([(x,y) for x,y in pairs if group in x['readiness_groups']])
def conditional_rate(rows):
    active_age = [t['age_stats']['120_600'] for t in rows
                  if t['age_stats'].get('120_600', (0,))[0]]
    return sum(x[0] for x in active_age)/sum(x[1] for x in active_age) if active_age else 0


def primary(rows):
    active_rows = [t for t in rows if t['active']]
    quotes = sorted((t['quote_sol'] for t in active_rows), reverse=True)
    return (sum(quotes[:math.ceil(len(quotes)*.05)])/sum(quotes),
            dist(t['trades'] for t in active_rows)['p99'], conditional_rate(rows))


def contrasts(left, right):
    x,y = primary(left),primary(right)
    return (y[0]-x[0], y[1]/x[1]-1, y[2]/x[2]-1)


seeds = sorted({t['seed'] for t in a})
strata = [[pair for pair in pairs if pair[0]['seed']==seed] for seed in seeds]
per_seed = {seed:contrasts(*zip(*group)) for seed,group in zip(seeds,strata)}
rng = random.Random(10037)
samples = []
for _ in range(500):
    sample = [pair for group in strata for pair in rng.choices(group,k=len(group))]
    samples.append(contrasts(*zip(*sample)))
bootstrap = {}
for name, values in zip(['top5_share_delta','p99_relative','age120_600_rate_relative'],zip(*samples)):
    ordered = sorted(values)
    bootstrap[name] = [ordered[12],ordered[487]]

fixed_ages={}
for age in ['120_300','300_600','600_1800']:
    fixed_ages[age]={v:{g:{'trades':sum(x[0] for x in stats),'gross':sum(x[2] for x in stats)}
                        for g, top in [('leaders',True),('others',False)]
                        for stats in [[t['age_stats'].get(age,(0,0,0)) for t in rows if (t['id'] in leaders)==top]]}
                     for v,rows in [('A',a),('B',b)]}

out=dict(arms=arms, fixed_A_top5=fixed, fixed_A_top5_by_age=fixed_ages,
         paired=paired, per_seed=per_seed, paired_bootstrap_95=bootstrap,
         provenance=json.loads((OUT/'experiment.json').read_text()),
         input_sha256={p.name:source_hash(p) for p in [
             REF/'real-standard.csv',REF/'launches.csv',OUT/'sim-A-tapes.json',OUT/'sim-B-tapes.json',Path(__file__)]})
(OUT/'results.json').write_text(json.dumps(out,indent=2,allow_nan=False)+'\n',encoding='utf8')
print('Paired warm-up, stillborn and Real/A 120 s benchmark checks passed')
