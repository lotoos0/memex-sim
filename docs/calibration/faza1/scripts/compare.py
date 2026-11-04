# Real vs memex-sim (headless) comparison: KS tests + chart. Reads pump.duckdb and harness output.
import duckdb, json, numpy as np, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from scipy.stats import ks_2samp
OUT='/workspace/notes/calibration'
r=duckdb.connect('/workspace/data/work/pump.duckdb',read_only=True); r.execute("SET enable_progress_bar=false")
s=duckdb.connect(); s.execute("SET enable_progress_bar=false")
s.execute("CREATE TABLE s AS SELECT tok, t::DOUBLE/1000 age_s, side='BUY' is_buy, usd/150.0 sol FROM read_json('/workspace/data/memex-headless/out_trades.jsonl', format='newline_delimited')")
R={}
rs=r.execute("SELECT sol FROM (SELECT sol FROM cta WHERE sol>0 AND age_s<1800) USING SAMPLE 200000 ROWS").fetchnumpy()['sol']
ss=s.execute("SELECT sol FROM (SELECT sol FROM s WHERE sol>0) USING SAMPLE 200000 ROWS").fetchnumpy()['sol']
k=ks_2samp(np.log(rs),np.log(ss)); R['ks_trade_size_log']={'D':float(k.statistic),'p':float(k.pvalue),'note':'real: curve trades age<30min; sim: all, USD/150'}
rg=r.execute("SELECT gap_slot*216.28 g FROM (SELECT gap_slot FROM gaps WHERE gap_slot IS NOT NULL AND age_s<1800) USING SAMPLE 200000 ROWS").fetchnumpy()['g']
sg=s.execute("SELECT g FROM (SELECT (age_s-lag(age_s) OVER (PARTITION BY tok ORDER BY age_s))*1000 g FROM s) WHERE g IS NOT NULL USING SAMPLE 200000 ROWS").fetchnumpy()['g']
k=ks_2samp(rg,sg); R['ks_interarrival_ms']={'D':float(k.statistic),'p':float(k.pvalue),'note':'real gap in slots x 216.28 ms'}
R['ttg_organic']=json.loads(r.execute("SELECT count(*) n, quantile_cont(ttg_s,[0.1,0.25,0.5,0.75,0.9]) q FROM coin WHERE in_cohort AND ttg_s>1").fetchdf().to_json(orient='records'))[0]
R['ttg_organic']['rate']=R['ttg_organic']['n']/r.execute("SELECT count(*) FROM coin WHERE in_cohort").fetchall()[0][0]
R['instant_grad_le1s']=r.execute("SELECT count(*) FROM coin WHERE in_cohort AND ttg_s<=1").fetchall()[0][0]
json.dump(R,open(f'{OUT}/compare_ks.json','w'),indent=1); print(R)
M=json.load(open(f'{OUT}/metrics.json')); S=json.load(open(f'{OUT}/sim_metrics.json'))
fig,ax=plt.subplots(1,3,figsize=(16,4.5))
x=[(a['lo']+a['hi'])/2 for a in S['trade_rate_by_age']]
ax[0].loglog(x,[a['trades_per_token_s'] for a in S['trade_rate_by_age']],'o-',label='memex-sim (headless)')
xr=[(a['lo']+a['hi'])/2 for a in M['trade_rate_by_age'] if a['hi']<=1800]
ax[0].loglog(xr,[a['trades_per_coin_s'] for a in M['trade_rate_by_age'] if a['hi']<=1800],'s-',label='pump.fun (na launch)')
ax[0].set_xlabel('wiek [s]'); ax[0].set_ylabel('transakcje / s / token'); ax[0].legend(); ax[0].set_title('Tempo transakcji vs wiek')
b=np.logspace(-5,3,70); ax[1].hist(rs,bins=b,weights=np.ones(len(rs))/len(rs),histtype='step',label='pump.fun'); ax[1].hist(ss,bins=b,weights=np.ones(len(ss))/len(ss),histtype='step',label='memex-sim'); ax[1].set_ylabel('udział'); ax[1].set_xscale('log'); ax[1].legend(); ax[1].set_title('Rozmiar transakcji [SOL]')
b=np.logspace(0,6,70); ax[2].hist(rg+1,bins=b,weights=np.ones(len(rg))/len(rg),histtype='step',label='pump.fun'); ax[2].hist(sg+1,bins=b,weights=np.ones(len(sg))/len(sg),histtype='step',label='memex-sim'); ax[2].set_ylabel('udział'); ax[2].set_xscale('log'); ax[2].legend(); ax[2].set_title('Odstęp między transakcjami [ms]+1')
plt.tight_layout(); plt.savefig(f'{OUT}/09_real_vs_sim.png',dpi=110)
