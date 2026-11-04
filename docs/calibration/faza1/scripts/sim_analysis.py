# Analyse headless memex-sim output (harness.ts; 120 tokens x 30 real min, 200 ms ticks, live-spawn fates).
import duckdb, json
c=duckdb.connect(); c.execute("SET enable_progress_bar=false")
D='/workspace/data/memex-headless'
c.execute(f"CREATE TABLE s AS SELECT tok, t::DOUBLE/1000 age_s, side='BUY' is_buy, w, usd/150.0 sol, mcap/150.0 mcap_sol FROM read_json('{D}/out_trades.jsonl', format='newline_delimited')")
c.execute(f"CREATE TABLE k AS SELECT * FROM read_json('{D}/out_tokens.json')")
S={}; f=lambda sql: json.loads(c.execute(sql).fetchdf().to_json(orient='records'))
S['n_tokens']=c.execute('select count(*) from k').fetchall()[0][0]; S['n_trades']=c.execute('select count(*) from s').fetchall()[0][0]
S['trade_rate_by_age']=f("""WITH b AS (SELECT * FROM (VALUES (0,10),(10,30),(30,60),(60,120),(120,300),(300,600),(600,1800)) v(lo,hi))
 SELECT lo,hi,count(s.tok)*1.0/(120*(hi-lo)) trades_per_token_s FROM b LEFT JOIN s ON s.age_s>=lo AND s.age_s<hi GROUP BY lo,hi ORDER BY lo""")
AG="CASE WHEN age_s<10 THEN '0-10s' WHEN age_s<60 THEN '10-60s' WHEN age_s<600 THEN '1-10m' ELSE '10-30m' END"
S['trade_size_by_age_side']=f(f"""SELECT {AG} age_bucket, CASE WHEN is_buy THEN 'buy' ELSE 'sell' END side, count(*) n, quantile_cont(sol,[0.1,0.5,0.9,0.99]) q, avg(ln(sol)) mu_ln, stddev(ln(sol)) sigma_ln, avg((sol<0.01)::int) share_lt_001
 FROM s WHERE sol>0 GROUP BY ALL ORDER BY min(age_s), side""")
S['trade_size_all']=f("SELECT quantile_cont(sol,[0.01,0.1,0.25,0.5,0.75,0.9,0.99]) q, avg(ln(sol)) mu_ln, stddev(ln(sol)) sigma_ln, avg((sol<0.03)::int) share_lt_003, max(sol) mx FROM s WHERE sol>0")
S['interarrival']=f("""SELECT quantile_cont(g,[0.1,0.25,0.5,0.75,0.9,0.99]) q_ms, avg(g) mean_ms, stddev(g)/avg(g) cv, avg((g=0)::int) share_0ms FROM
 (SELECT (age_s - lag(age_s) OVER (PARTITION BY tok ORDER BY age_s))*1000 g FROM s) WHERE g IS NOT NULL""")
S['buy_share_by_age']=f("""SELECT CASE WHEN age_s<600 THEN floor(age_s/30)*30 WHEN age_s<900 THEN 600 ELSE 900 END age_lo, count(*) n, avg(is_buy::int) buy_cnt, sum(CASE WHEN is_buy THEN sol END)/sum(sol) buy_sol FROM s GROUP BY 1 ORDER BY 1""")
S['migration']=f("SELECT count(*) n, count(migratedAt) migrated, count(migratedAt)*1.0/count(*) rate, quantile_cont(migratedAt/1000.0,[0.1,0.25,0.5,0.75,0.9]) t_q_s FROM k")
S['peak_mcap_sol']=f("SELECT quantile_cont(peakMcapUsd/150,[0.25,0.5,0.75,0.9]) q FROM k")
S['dead']=f("SELECT count(deadAt) n_dead FROM k")
S['last_trade_age']=f("SELECT quantile_cont(m,[0.1,0.5,0.9]) q, avg((m<300)::int) dead_by_5m FROM (SELECT k.tok, max(s.age_s) m FROM k LEFT JOIN s USING(tok) GROUP BY 1)")
S['dev']=f("""SELECT count(DISTINCT tok) tokens_dev_sold, quantile_cont(fs,[0.1,0.5,0.9]) first_sell_q_s FROM (SELECT tok, min(age_s) fs FROM s WHERE w LIKE 'dv%' AND NOT is_buy GROUP BY 1)""")
S['dev_first_buy']=f("SELECT quantile_cont(sol,[0.1,0.5,0.9]) q FROM (SELECT tok, arg_min(sol, age_s) sol FROM s WHERE w LIKE 'dv%' AND is_buy GROUP BY 1)")
S['snipers']=f("""SELECT sum(CASE WHEN age_s<=0.2 THEN sol END)/sum(sol) first_tick_share_all_buy, sum(CASE WHEN age_s<=5 THEN sol END)/sum(sol) first5s_share_all_buy,
 sum(CASE WHEN age_s<=60 THEN sol END)/sum(sol) first60s_share_all_buy, sum(CASE WHEN age_s<=5 THEN sol END)/sum(CASE WHEN age_s<=60 THEN sol END) first5s_of_60s,
 sum(CASE WHEN w LIKE 'sn%' AND age_s<=60 THEN sol END)/sum(CASE WHEN age_s<=60 THEN sol END) sn_label_share_first60s FROM s WHERE is_buy AND w NOT LIKE 'dv%'""")
S['wallets']=f("SELECT quantile_cont(n,[0.5,0.9,0.99]) trades_per_wallet_token_q, count(*) wallet_token_pairs FROM (SELECT tok,w,count(*) n FROM s GROUP BY 1,2)")
S['wallets_per_token']=f("SELECT quantile_cont(n,[0.1,0.5,0.9]) q FROM (SELECT tok, count(DISTINCT w) n FROM s GROUP BY 1)")
S['trades_per_token']=f("SELECT quantile_cont(n,[0.1,0.5,0.9]) q FROM (SELECT k.tok, count(s.tok) n FROM k LEFT JOIN s USING(tok) GROUP BY 1)")
S['actor_mix_by_trades']=f("SELECT left(w,2) grp, count(*)*1.0/sum(count(*)) OVER () share FROM s GROUP BY 1 ORDER BY 2 DESC")
json.dump(S,open('/workspace/notes/calibration/sim_metrics.json','w'),indent=1)
for k,v in S.items(): print(k, json.dumps(v)[:900])
