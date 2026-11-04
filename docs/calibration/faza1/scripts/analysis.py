# Phase-1 calibration analysis. Data: HF pumpdatafun/pump-fun-trades-sample (2026-10-15). Run after build.sql.
import duckdb, json, math, numpy as np, pandas as pd
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from scipy.cluster.vq import kmeans2
OUT='/workspace/notes/calibration'; c=duckdb.connect('/workspace/data/work/pump.duckdb')
c.execute("SET enable_progress_bar=false; SET TimeZone='UTC'; SET memory_limit='3GB'; SET temp_directory='/workspace/data/work/tmp'")
Q={}; M={}
def q(name, sql):
    Q[name]=sql.strip(); return c.execute(sql).fetchdf()
def rec(df): return json.loads(df.to_json(orient='records'))
DAY0=1792022400; DAY1=DAY0+86400; CUT=DAY1-4*3600   # lifecycle cohort: launched before 20:00 UTC (>=4h follow-up)
M['meta']={'source':'huggingface.co/datasets/pumpdatafun/pump-fun-trades-sample','day':'2026-10-15 UTC','cohort_cutoff_utc':'20:00','sol_usd_assumed_for_compare':150}

# ---------- base tables ----------
q('cta',"""CREATE OR REPLACE TABLE cta AS
SELECT t.*, t.ts-l.ts AS age_s, t.slot-l.slot AS age_slot, (t.wallet=l.creator) AS is_dev, l.ts AS launch_ts, l.slot AS launch_slot, l.creator
FROM ct t JOIN launch l USING(mint) WHERE l.is_sol""")
q('coin',f"""CREATE OR REPLACE TABLE coin AS
SELECT l.mint, l.ts launch_ts, l.slot launch_slot, l.creator, (l.ts < {CUT}) AS in_cohort,
  count(t.mint) n_trades, count(DISTINCT t.wallet) n_wallets, max(t.age_s) last_trade_age_s,
  coalesce(max(t.mcap_sol), 27.96) peak_mcap_sol, coalesce(sum(t.sol),0) vol_sol,
  cp.ts_c - l.ts AS ttg_s
FROM launch l LEFT JOIN cta t USING(mint) LEFT JOIN comp cp USING(mint)
WHERE l.is_sol GROUP BY l.mint,l.ts,l.slot,l.creator,cp.ts_c""")
cov=q('coverage',"""SELECT (SELECT count(*) FROM ct) curve_sol_trades,(SELECT count(*) FROM cta) curve_trades_on_day_launches,
 (SELECT count(*) FROM launch) launches_all,(SELECT count(*) FROM launch WHERE is_sol) launches_sol,
 (SELECT count(*) FROM comp) completes_all,(SELECT count(*) FROM comp JOIN launch USING(mint)) completes_of_day_launches,
 (SELECT (max(slot)-min(slot))*1.0/86400 FROM ct) slots_per_s""")
M['coverage']=rec(cov)[0]; SLOT_MS=1000/M['coverage']['slots_per_s']; M['coverage']['ms_per_slot']=SLOT_MS

# ---------- 1. trade size ----------
AGEB="CASE WHEN age_s<10 THEN '0-10s' WHEN age_s<60 THEN '10-60s' WHEN age_s<600 THEN '1-10m' WHEN age_s<3600 THEN '10-60m' ELSE '1h+' END"
ts_=q('trade_size_by_age_side',f"""SELECT {AGEB} age_bucket, CASE WHEN is_buy THEN 'buy' ELSE 'sell' END side, count(*) n, sum(sol) vol_sol,
 quantile_cont(sol,0.1) p10, quantile_cont(sol,0.25) p25, quantile_cont(sol,0.5) p50, quantile_cont(sol,0.75) p75, quantile_cont(sol,0.9) p90, quantile_cont(sol,0.99) p99,
 avg(sol) mean, avg(ln(sol)) mu_ln, stddev(ln(sol)) sigma_ln, avg((sol>=1)::int) share_ge_1sol, avg((sol<0.01)::int) share_lt_001sol
FROM cta WHERE sol>0 AND NOT is_dev GROUP BY ALL ORDER BY min(age_s), side""")
M['trade_size_by_age_side']=rec(ts_)
allsz=q('trade_size_all',"""SELECT CASE WHEN is_buy THEN 'buy' ELSE 'sell' END side, count(*) n, quantile_cont(sol,[0.01,0.1,0.25,0.5,0.75,0.9,0.95,0.99,0.999]) q,
 avg(sol) mean, avg(ln(sol)) mu_ln, stddev(ln(sol)) sigma_ln FROM ct WHERE sol>0 GROUP BY 1""")
M['trade_size_all']=rec(allsz)
# tail: Hill estimator above p95, per side
tail=q('trade_size_tail_hill',"""WITH p AS (SELECT is_buy, quantile_cont(sol,0.95) x0 FROM ct WHERE sol>0 GROUP BY 1)
SELECT CASE WHEN t.is_buy THEN 'buy' ELSE 'sell' END side, any_value(p.x0) xmin_p95, count(*) n_tail, 1/avg(ln(t.sol/p.x0)) pareto_alpha
FROM ct t JOIN p USING(is_buy) WHERE t.sol>p.x0 GROUP BY 1""")
M['trade_size_tail']=rec(tail)
# size buckets in memex TRADE_SIZE_BUCKETS_SOL edges
bk=q('trade_size_buckets',"""SELECT CASE WHEN sol<0.03 THEN '<0.03' WHEN sol<0.05 THEN '0.03-0.05' WHEN sol<0.1 THEN '0.05-0.1' WHEN sol<0.25 THEN '0.1-0.25'
 WHEN sol<0.5 THEN '0.25-0.5' WHEN sol<1 THEN '0.5-1' WHEN sol<1.5 THEN '1-1.5' WHEN sol<2.5 THEN '1.5-2.5' ELSE '>=2.5' END b, count(*)*1.0/sum(count(*)) OVER () share
FROM ct WHERE sol>0 GROUP BY 1 ORDER BY min(sol)""")
M['trade_size_buckets_share']=rec(bk)
smp=c.execute("SELECT * FROM (SELECT sol, is_buy, age_s FROM cta WHERE sol>0 AND NOT is_dev) USING SAMPLE 400000 ROWS").fetchdf()
fig,ax=plt.subplots(1,2,figsize=(13,4.5)); bins=np.logspace(-5,2.5,80)
for side,col in [(True,'tab:green'),(False,'tab:red')]:
    ax[0].hist(smp[smp.is_buy==side].sol,bins=bins,alpha=.5,color=col,label='buy' if side else 'sell')
ax[0].set_xscale('log'); ax[0].set_title('Rozmiar transakcji (SOL), curve, 2026-10-15'); ax[0].legend(); ax[0].set_xlabel('SOL')
for lab,lo,hi in [('0-10s',0,10),('10-60s',10,60),('1-10m',60,600),('10-60m',600,3600),('1h+',3600,1e9)]:
    s=smp[(smp.age_s>=lo)&(smp.age_s<hi)].sol; ax[1].hist(s,bins=bins,histtype='step',weights=np.ones(len(s))/max(1,len(s)),label=lab)
ax[1].set_xscale('log'); ax[1].set_title('Rozmiar wg wieku coina (udział)'); ax[1].legend(); ax[1].set_xlabel('SOL')
plt.tight_layout(); plt.savefig(f'{OUT}/01_trade_size.png',dpi=110); plt.close()

# ---------- 2. inter-arrival ----------
q('gaps',"""CREATE OR REPLACE TABLE gaps AS SELECT mint, age_s,
 slot - lag(slot) OVER w AS gap_slot, ts - lag(ts) OVER w AS gap_s
FROM cta WINDOW w AS (PARTITION BY mint ORDER BY slot, idx, seq)""")
ia=q('interarrival',"""SELECT count(*) n, quantile_cont(gap_slot,[0.1,0.25,0.5,0.75,0.9,0.99]) q_slot, avg(gap_slot) mean_slot, stddev(gap_slot)/avg(gap_slot) cv_slot,
 avg((gap_slot=0)::int) share_same_slot, quantile_cont(gap_s,[0.5,0.9,0.99]) q_s, stddev(gap_s)/avg(gap_s) cv_s FROM gaps WHERE gap_slot IS NOT NULL""")
M['interarrival_all']=rec(ia)[0]
iab=q('interarrival_by_age',f"""SELECT {AGEB} age_bucket, count(*) n, quantile_cont(gap_slot,0.5) p50_slot, quantile_cont(gap_slot,0.9) p90_slot, avg(gap_slot) mean_slot,
 stddev(gap_slot)/avg(gap_slot) cv_slot, avg((gap_slot=0)::int) share_same_slot FROM gaps WHERE gap_slot IS NOT NULL GROUP BY 1 ORDER BY min(age_s)""")
M['interarrival_by_age']=rec(iab)
# trades per live coin per second by age (lambda), cohort coins only
lam=q('trade_rate_by_age',f"""WITH b AS (SELECT * FROM (VALUES (0,10),(10,30),(30,60),(60,120),(120,300),(300,600),(600,1800),(1800,3600),(3600,14400)) v(lo,hi)),
 n AS (SELECT count(*) nc FROM coin WHERE in_cohort)
SELECT b.lo, b.hi, count(t.mint)*1.0/(any_value(n.nc)*(b.hi-b.lo)) trades_per_coin_s,
 count(DISTINCT t.mint)*1.0/any_value(n.nc) share_coins_active
FROM b CROSS JOIN n LEFT JOIN (SELECT cta.* FROM cta JOIN coin USING(mint) WHERE coin.in_cohort) t ON t.age_s>=b.lo AND t.age_s<b.hi GROUP BY b.lo,b.hi ORDER BY b.lo""")
M['trade_rate_by_age']=rec(lam)
# per active coin-minute (coins with >=1 trade in that minute): trades/min distribution
am=q('trades_per_active_coin_minute',"""SELECT quantile_cont(n,[0.25,0.5,0.75,0.9,0.99]) q, avg(n) mean FROM (SELECT mint, age_s//60 m, count(*) n FROM cta GROUP BY 1,2)""")
M['trades_per_active_coin_minute']=rec(am)[0]
g=c.execute("SELECT * FROM (SELECT gap_slot FROM gaps WHERE gap_slot IS NOT NULL) USING SAMPLE 400000 ROWS").fetchdf().gap_slot
fig,ax=plt.subplots(figsize=(7,4.5)); ax.hist(g+1,bins=np.logspace(0,5,60),color='tab:blue'); ax.set_xscale('log'); ax.set_yscale('log')
ax.set_title(f'Odstęp między transakcjami tego samego coina (slot+1; 1 slot≈{SLOT_MS:.0f} ms)'); ax.set_xlabel('sloty + 1')
plt.tight_layout(); plt.savefig(f'{OUT}/02_interarrival.png',dpi=110); plt.close()

# ---------- 3. buy share / net flow over lifetime ----------
AGEB2="CASE WHEN age_s<600 THEN (age_s//30)*30 WHEN age_s<900 THEN 600 WHEN age_s<1800 THEN 900 WHEN age_s<3600 THEN 1800 WHEN age_s<7200 THEN 3600 ELSE 7200 END"
bs=q('buy_share_by_age',f"""SELECT {AGEB2} age_lo, count(*) n, avg(is_buy::int) buy_share_cnt, sum(CASE WHEN is_buy THEN sol END)/sum(sol) buy_share_sol,
 sum(CASE WHEN is_buy THEN sol ELSE -sol END) net_sol, sum(CASE WHEN is_buy THEN sol ELSE -sol END)/count(DISTINCT mint) net_sol_per_active_coin, count(DISTINCT mint) active_coins
FROM cta t JOIN coin USING(mint) WHERE coin.in_cohort AND NOT t.is_dev GROUP BY 1 ORDER BY 1""")
M['buy_share_by_age']=rec(bs)
fig,ax=plt.subplots(1,2,figsize=(13,4.5))
x=bs.age_lo/60; ax[0].plot(x,bs.buy_share_cnt,'o-',label='udział buy (liczba)'); ax[0].plot(x,bs.buy_share_sol,'s-',label='udział buy (SOL)'); ax[0].axhline(.5,color='gray',ls=':')
ax[0].set_xscale('symlog'); ax[0].set_xlabel('wiek coina [min] (początek kubełka)'); ax[0].legend(); ax[0].set_title('Udział kupna vs wiek (bez dev)')
ax[1].bar(range(len(bs)),bs.net_sol_per_active_coin); ax[1].set_xticks(range(len(bs))); ax[1].set_xticklabels([f'{int(v)//60}m{int(v)%60:02d}' for v in bs.age_lo],rotation=90,fontsize=7)
ax[1].set_title('Net SOL flow na aktywnego coina'); plt.tight_layout(); plt.savefig(f'{OUT}/03_buy_share_age.png',dpi=110); plt.close()

# ---------- 4. graduation ----------
gr=q('graduation',"""SELECT count(*) launches, count(ttg_s) graduated, count(ttg_s)*1.0/count(*) rate,
 quantile_cont(ttg_s,[0.1,0.25,0.5,0.75,0.9]) ttg_q_s, avg(ttg_s) ttg_mean_s FROM coin WHERE in_cohort""")
M['graduation']=rec(gr)[0]
ga=q('graduation_all_day_launches',"SELECT count(*) launches, count(ttg_s) graduated, count(ttg_s)*1.0/count(*) rate FROM coin")
M['graduation_all_day_launches']=rec(ga)[0]
gm=q('mcap_at_complete',"""SELECT quantile_cont(mcap_sol,[0.1,0.5,0.9]) q, count(*) n FROM (SELECT mint, arg_max(mcap_sol, slot*10000+idx) mcap_sol FROM ct JOIN comp USING(mint) WHERE ct.slot<=comp.slot_c GROUP BY 1)""")
M['mcap_sol_at_complete']=rec(gm)[0]
gh=q('reach_thresholds',"""SELECT avg((peak_mcap_sol>=40)::int) ge40, avg((peak_mcap_sol>=60)::int) ge60, avg((peak_mcap_sol>=100)::int) ge100, avg((peak_mcap_sol>=200)::int) ge200, avg((peak_mcap_sol>=300)::int) ge300,
 quantile_cont(peak_mcap_sol,[0.25,0.5,0.75,0.9,0.95,0.99]) peak_q FROM coin WHERE in_cohort""")
M['peak_mcap_sol']=rec(gh)[0]

# ---------- 5. dev ----------
dv=q('dev_behaviour',"""WITH d AS (SELECT t.mint, min(CASE WHEN NOT is_buy THEN age_s END) first_sell_age, sum(CASE WHEN is_buy THEN tok ELSE 0 END) bought_tok,
  sum(CASE WHEN NOT is_buy THEN tok ELSE 0 END) sold_tok, sum(CASE WHEN is_buy THEN sol ELSE 0 END) bought_sol, sum(CASE WHEN NOT is_buy THEN sol ELSE 0 END) sold_sol,
  min(CASE WHEN is_buy AND age_slot=0 THEN sol END) init_buy_sol
 FROM cta t JOIN coin USING(mint) WHERE coin.in_cohort AND t.is_dev GROUP BY 1)
SELECT (SELECT count(*) FROM coin WHERE in_cohort) cohort, count(*) devs_traded, avg((init_buy_sol IS NOT NULL)::int) share_with_block0_buy,
 quantile_cont(init_buy_sol,[0.1,0.25,0.5,0.75,0.9]) init_buy_q_sol, count(first_sell_age)*1.0/count(*) share_dev_sold,
 quantile_cont(first_sell_age,[0.1,0.25,0.5,0.75,0.9]) first_sell_age_q_s, avg(CASE WHEN bought_tok>0 THEN least(sold_tok/bought_tok,1) END) mean_frac_sold,
 avg(CASE WHEN bought_tok>0 THEN (sold_tok>=0.99*bought_tok)::int END) share_sold_all, avg(sold_sol-bought_sol) mean_dev_pnl_sol_gross,
 quantile_cont(sold_sol-bought_sol,[0.1,0.5,0.9]) dev_pnl_q FROM d""")
M['dev']=rec(dv)[0]
dvs=c.execute("SELECT first_sell_age FROM (SELECT mint, min(age_s) first_sell_age FROM cta WHERE is_dev AND NOT is_buy GROUP BY 1)").fetchdf()

# ---------- 6. snipers ----------
sn=q('snipers',"""WITH b AS (SELECT t.* FROM cta t JOIN coin USING(mint) WHERE coin.in_cohort AND is_buy AND NOT is_dev),
 per AS (SELECT mint, sum(sol) buy_all, sum(CASE WHEN age_slot=0 THEN sol ELSE 0 END) b0, sum(CASE WHEN age_s<=5 THEN sol ELSE 0 END) s5,
   sum(CASE WHEN age_s<=60 THEN sol ELSE 0 END) s60, count(DISTINCT CASE WHEN age_slot=0 THEN wallet END) n_b0_wallets, count(DISTINCT CASE WHEN age_slot<=2 THEN wallet END) n_le2slot_wallets FROM b GROUP BY 1)
SELECT count(*) coins_with_nondev_buys, avg((b0>0)::int) share_coins_with_block0_snipe, sum(b0)/sum(buy_all) block0_share_of_all_buy_sol,
 sum(s5)/sum(buy_all) first5s_share_of_all_buy_sol, sum(s60)/sum(buy_all) first60s_share_of_all_buy_sol, sum(b0)/nullif(sum(s60),0) block0_share_of_first60s,
 sum(s5)/nullif(sum(s60),0) first5s_share_of_first60s, quantile_cont(n_b0_wallets,[0.5,0.9,0.99]) block0_wallets_q, avg(n_b0_wallets) block0_wallets_mean,
 quantile_cont(CASE WHEN b0>0 THEN b0 END,[0.5,0.9]) block0_sol_q FROM per""")
M['snipers']=rec(sn)[0]

# ---------- 7. post-migration ----------
pm=q('post_migration_decay',f"""WITH m AS (SELECT mint, min(ts_m) ts_m FROM mig GROUP BY 1),
 obs AS (SELECT mint, ts_m, ({DAY1}-ts_m) horizon FROM m),
 b AS (SELECT range*300 lo FROM range(0,288)),
 cnt AS (SELECT b.lo, count(*) n_coins FROM b JOIN obs ON obs.horizon >= b.lo+300 GROUP BY 1),
 tr AS (SELECT ((p.ts-m.ts_m)//300)*300 lo, count(*) n, sum(sol) vol, count(DISTINCT p.wallet) wallets_sum_over_coins
        FROM pt p JOIN m USING(mint) WHERE p.ts>=m.ts_m GROUP BY 1)
SELECT cnt.lo, cnt.n_coins, coalesce(tr.n,0)*1.0/cnt.n_coins trades_per_coin, coalesce(tr.vol,0)/cnt.n_coins sol_per_coin
FROM cnt LEFT JOIN tr USING(lo) ORDER BY 1""")
pw=q('post_migration_wallets',f"""WITH m AS (SELECT mint, min(ts_m) ts_m FROM mig GROUP BY 1)
SELECT lo, avg(w) wallets_per_coin_active FROM (SELECT p.mint, ((p.ts-m.ts_m)//300)*300 lo, count(DISTINCT wallet) w FROM pt p JOIN m USING(mint) WHERE p.ts>=m.ts_m GROUP BY 1,2) GROUP BY 1 ORDER BY 1""")
pm=pm.merge(pw,on='lo',how='left')
pmv=pm[pm.n_coins>=50].copy()
def halflife(y,x):
    y=np.asarray(y,float); x=np.asarray(x,float); k=(y>0); 
    if k.sum()<3: return None
    b=np.polyfit(x[k],np.log(y[k]),1)[0]; return float(math.log(2)/-b) if b<0 else None
first=pmv.iloc[0]
def t_half(col):
    v=pmv[col].values; idx=np.where(v<=v[0]/2)[0]; return float(pmv.lo.values[idx[0]]) if len(idx) else None
M['post_migration']={'n_migrations_day':int(c.execute('select count(distinct mint) from mig').fetchall()[0][0]),
 'first5min_trades_per_coin':float(first.trades_per_coin),'first5min_sol_per_coin':float(first.sol_per_coin),
 'time_to_half_trades_s':t_half('trades_per_coin'),'time_to_half_sol_s':t_half('sol_per_coin'),
 'exp_fit_halflife_trades_s_0_2h':halflife(pmv[pmv.lo<7200].trades_per_coin,pmv[pmv.lo<7200].lo),
 'exp_fit_halflife_sol_s_0_2h':halflife(pmv[pmv.lo<7200].sol_per_coin,pmv[pmv.lo<7200].lo),
 'series_first_24_buckets':rec(pmv.head(24)), 'at_1h':rec(pmv[pmv.lo==3600]), 'at_6h':rec(pmv[pmv.lo==21600]), 'at_12h':rec(pmv[pmv.lo==43200])}
fig,ax=plt.subplots(1,3,figsize=(15,4.3))
for i,(col,t) in enumerate([('trades_per_coin','transakcje / coin / 5 min'),('sol_per_coin','SOL wolumen / coin / 5 min'),('wallets_per_coin_active','unikalne portfele / aktywny coin / 5 min')]):
    ax[i].plot(pmv.lo/3600,pmv[col]); ax[i].set_yscale('log'); ax[i].set_xlabel('godziny od migracji'); ax[i].set_title(t)
plt.suptitle('PumpSwap (pula migracyjna) po graduacji, 2026-10-15'); plt.tight_layout(); plt.savefig(f'{OUT}/05_post_migration_decay.png',dpi=110); plt.close()

# ---------- 8. wallets ----------
q('wal',"""CREATE OR REPLACE TABLE wal AS SELECT wallet, count(*) n, count(DISTINCT mint) mints, (max(ts)-min(ts)) span_s, avg(sol) avg_sol,
 coalesce(stddev(sol)/nullif(avg(sol),0),0) size_cv, avg(is_buy::int) buy_share, sum(sol) vol FROM ct WHERE sol>0 GROUP BY 1""")
q('hold',"""CREATE OR REPLACE TABLE hold AS SELECT wallet, quantile_cont(h,0.5) med_hold_s, count(*) n_pos FROM (
 SELECT wallet, mint, min(CASE WHEN NOT is_buy THEN ts END) - min(CASE WHEN is_buy THEN ts END) h FROM ct GROUP BY 1,2) WHERE h IS NOT NULL AND h>=0 GROUP BY 1""")
w=c.execute("SELECT w.*, h.med_hold_s FROM wal w LEFT JOIN hold h USING(wallet)").fetchdf()
w['tpm']=w.n/np.maximum(w.span_s/60,1)
M['wallets']={'n_wallets':int(len(w)),'trades_q':w.n.quantile([.5,.9,.99,.999]).to_dict(),'share_wallets_1trade':float((w.n==1).mean()),
 'top1pct_wallets_share_trades':float(w.n.sort_values(ascending=False).head(max(1,len(w)//100)).sum()/w.n.sum()),
 'top1pct_wallets_share_vol':float(w.vol.sort_values(ascending=False).head(max(1,len(w)//100)).sum()/w.vol.sum()),
 'hold_s_q_over_wallets':w.med_hold_s.dropna().quantile([.1,.25,.5,.75,.9]).to_dict()}
act=w[w.n>=5].copy(); act['hold']=act.med_hold_s.fillna(act.span_s)  # never sold: use span
F=np.column_stack([np.log1p(act.n),np.log1p(act.tpm),np.log1p(act.mints),act.size_cv.clip(0,5),np.log1p(act.hold),act.buy_share])
Z=(F-F.mean(0))/F.std(0); np.random.seed(7); cent,lab=kmeans2(Z,4,minit='++',seed=7)
act['cl']=lab; prof=act.groupby('cl').agg(wallets=('n','size'),trades=('n','sum'),vol=('vol','sum'),med_n=('n','median'),med_tpm=('tpm','median'),
 med_mints=('mints','median'),med_size_cv=('size_cv','median'),med_hold_s=('hold','median'),med_buy_share=('buy_share','median'),med_avg_sol=('avg_sol','median'))
prof['share_wallets']=prof.wallets/prof.wallets.sum(); prof['share_trades_all']=prof.trades/w.n.sum(); prof['share_vol_all']=prof.vol/w.vol.sum()
# label: bot-like if median hold < 60s or median trades/min >= 2
prof['label']=np.where((prof.med_hold_s<60)|(prof.med_tpm>=2),'bot-like','human-like')
M['wallet_clusters_ge5_trades']=rec(prof.reset_index())
rule=(w.n>=5)&((w.med_hold_s.fillna(1e9)<30)|(w.tpm>=3))
M['wallet_rule_botlike']={'rule':'n>=5 AND (median hold<30s OR trades/min>=3)','share_wallets':float(rule.mean()),'share_trades':float(w.n[rule].sum()/w.n.sum()),'share_vol':float(w.vol[rule].sum()/w.vol.sum())}
fig,ax=plt.subplots(figsize=(7.5,5.5)); s=act.sample(min(40000,len(act)),random_state=1)
sc=ax.scatter(s.hold+1,s.tpm,c=s.cl,s=3,cmap='tab10',alpha=.5); ax.set_xscale('log'); ax.set_yscale('log'); ax.set_xlabel('mediana hold [s] + 1'); ax.set_ylabel('transakcje / min aktywności')
ax.set_title('Portfele (≥5 trade) — klastry k-means (k=4)'); plt.colorbar(sc,label='klaster'); plt.tight_layout(); plt.savefig(f'{OUT}/06_wallet_clusters.png',dpi=110); plt.close()

# ---------- 9. launches by hour ----------
lh=q('launches_by_hour',f"""SELECT (ts-{DAY0})//3600 hour_utc, count(*)/60.0 launches_per_min, count_if(is_sol)/60.0 sol_launches_per_min FROM launch GROUP BY 1 ORDER BY 1""")
M['launches_by_hour_utc']=rec(lh); M['launches_per_min_day']={'mean':float(lh.launches_per_min.mean()),'min':float(lh.launches_per_min.min()),'max':float(lh.launches_per_min.max())}
th=q('trades_by_hour',f"""SELECT (ts-{DAY0})//3600 hour_utc, count(*)/60.0 curve_trades_per_min FROM ct GROUP BY 1 ORDER BY 1""")
M['curve_trades_by_hour_utc']=rec(th)
fig,ax=plt.subplots(figsize=(9,4.3)); ax.bar(lh.hour_utc,lh.launches_per_min,label='wszystkie'); ax.bar(lh.hour_utc,lh.sol_launches_per_min,alpha=.7,label='SOL-quoted')
ax2=ax.twinx(); ax2.plot(th.hour_utc,th.curve_trades_per_min,'k.-',label='curve trades/min'); ax.set_xlabel('godzina UTC'); ax.set_ylabel('launche / min'); ax2.set_ylabel('curve trades / min')
ax.legend(loc='upper left'); ax.set_title('Launche i aktywność wg godziny (UTC), 2026-10-15'); plt.tight_layout(); plt.savefig(f'{OUT}/07_launches_by_hour.png',dpi=110); plt.close()

# ---------- 10. failed trades ----------
idl=json.load(open('/tmp/off/idl/pump.json')); names={e['code']:e['name'] for e in idl.get('errors',[])}
fl=q('failed_rate',"""SELECT (SELECT count(*) FROM cf) failed_tx, (SELECT count(DISTINCT (slot,idx)) FROM ct) landed_tx_sol,
 (SELECT count(*) FROM (SELECT DISTINCT slot, idx FROM '/workspace/data/pumpdata/data/*.parquet' WHERE venue='curve' AND NOT failed)) landed_tx_all,
 (SELECT sum(fee)/1e9 FROM cf) failed_fees_sol, (SELECT count(DISTINCT wallet) FROM cf) failed_wallets""")
fr=rec(fl)[0]; fr['fail_share_of_attempts']=fr['failed_tx']/(fr['failed_tx']+fr['landed_tx_all']); M['failed']=fr
fe=q('failed_errors',r"""SELECT try_cast(regexp_extract(error,'Custom\((\d+)\)',1) AS INT) code, count(*) n FROM cf GROUP BY 1 ORDER BY 2 DESC LIMIT 15""")
fe['pump_idl_name']=[names.get(int(x)) if pd.notna(x) else None for x in fe.code]; fe['share']=fe.n/fr['failed_tx']
M['failed_top_errors']=rec(fe)
fw=q('failed_wallet_concentration',"""SELECT sum(n) FILTER (WHERE r<=100)*1.0/sum(n) top100_wallet_share FROM (SELECT wallet, count(*) n, row_number() OVER (ORDER BY count(*) DESC) r FROM cf GROUP BY 1)""")
M['failed']['top100_wallets_share_of_failed']=float(fw.iloc[0,0])

# ---------- 11. lifecycle ----------
lc=q('lifecycle',"""SELECT count(*) n, avg((n_trades<=1)::int) share_le1_trade, avg((n_trades<=5)::int) share_le5_trades,
 avg((coalesce(last_trade_age_s,0)<60)::int) dead_by_1m, avg((coalesce(last_trade_age_s,0)<300)::int) dead_by_5m, avg((coalesce(last_trade_age_s,0)<900)::int) dead_by_15m,
 avg((coalesce(last_trade_age_s,0)<3600)::int) dead_by_60m, quantile_cont(n_trades,[0.25,0.5,0.75,0.9,0.99]) trades_per_coin_q, quantile_cont(n_wallets,[0.5,0.9,0.99]) wallets_per_coin_q,
 quantile_cont(vol_sol,[0.5,0.9,0.99]) vol_sol_per_coin_q FROM coin WHERE in_cohort AND ttg_s IS NULL""")
M['lifecycle_nongraduated']=rec(lc)[0]
cc=c.execute("SELECT peak_mcap_sol, last_trade_age_s, ttg_s FROM coin WHERE in_cohort").fetchdf()
fig,ax=plt.subplots(1,2,figsize=(13,4.5))
ax[0].hist(cc.peak_mcap_sol,bins=np.logspace(np.log10(20),np.log10(5000),70)); ax[0].set_xscale('log'); ax[0].set_yscale('log'); ax[0].axvline(27.96,color='gray',ls=':'); ax[0].set_title('Peak mcap na curve [SOL] (kohorta)')
la=cc[cc.ttg_s.isna()].last_trade_age_s.fillna(0); xs=np.logspace(0,4.2,80); ax[1].plot(xs,[(la<x).mean() for x in xs]); ax[1].set_xscale('log'); ax[1].set_xlabel('wiek [s]'); ax[1].set_title('CDF: wiek ostatniej transakcji (coiny bez graduacji)')
plt.tight_layout(); plt.savefig(f'{OUT}/08_lifecycle.png',dpi=110); plt.close()
# dev sell + snipe chart
fig,ax=plt.subplots(figsize=(7,4.3)); ax.hist(dvs.first_sell_age+1,bins=np.logspace(0,4.5,60)); ax.set_xscale('log'); ax.set_xlabel('wiek coina przy 1. sprzedaży dev [s]+1'); ax.set_title('Timing pierwszej sprzedaży dewelopera')
plt.tight_layout(); plt.savefig(f'{OUT}/04_dev_first_sell.png',dpi=110); plt.close()

json.dump(M,open(f'{OUT}/metrics.json','w'),indent=1,default=float)
with open(f'{OUT}/queries.sql','w') as f:
    f.write('-- DuckDB SQL used for Phase 1 (pumpdatafun sample 2026-10-15). Build step:\n'+open(f'{OUT}/build.sql').read()+'\n')
    for k,v in Q.items(): f.write(f'\n-- [{k}]\n{v};\n')
print('ok')
