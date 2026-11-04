-- DuckDB SQL used for Phase 1 (pumpdatafun sample 2026-10-15). Build step:
-- DuckDB: build working tables from pumpdatafun/pump-fun-trades-sample (2026-10-15)
SET TimeZone='UTC';
SET memory_limit='3GB'; SET temp_directory='/workspace/data/work/tmp'; SET threads=6;
CREATE OR REPLACE TABLE launch AS
  SELECT ts, slot, idx, mint, creator, payer, quote_mint = 'So11111111111111111111111111111111111111112' AS is_sol
  FROM '/workspace/data/pumpdata/launches/*.parquet';
CREATE OR REPLACE TABLE ev AS SELECT * FROM '/workspace/data/pumpdata/events/*.parquet';
CREATE OR REPLACE TABLE comp AS SELECT a AS mint, min(ts) AS ts_c, min(slot) AS slot_c FROM ev WHERE kind='complete' GROUP BY 1;
CREATE OR REPLACE TABLE mig  AS SELECT a AS mint, b AS pool, min(ts) AS ts_m, min(slot) AS slot_m FROM ev WHERE kind='migrate' GROUP BY 1,2;
-- curve landed, SOL-quoted
CREATE OR REPLACE TABLE ct AS
  SELECT ts, slot, idx, seq, mint, wallet, side='buy' AS is_buy, sol_lamports/1e9 AS sol, token_amount/1e6 AS tok,
         r1, r2, r3, r1/r2*1e6 AS mcap_sol
  FROM '/workspace/data/pumpdata/data/*.parquet'
  WHERE venue='curve' AND NOT failed AND quote_mint='So11111111111111111111111111111111111111112';
-- curve failed (one row per tx for counts)
CREATE OR REPLACE TABLE cf AS
  SELECT slot, idx, any_value(ts) ts, any_value(wallet) wallet, any_value(mint) mint, any_value(error) error, any_value(fee_lamports) fee, count(*) n_rows
  FROM '/workspace/data/pumpdata/data/*.parquet' WHERE venue='curve' AND failed GROUP BY 1,2;
-- pumpswap landed, SOL, in migration pool
CREATE OR REPLACE TABLE pt AS
  SELECT ts, slot, idx, mint, wallet, side='buy' AS is_buy, sol_lamports/1e9 AS sol
  FROM '/workspace/data/pumpdata/data/*.parquet'
  WHERE venue='pumpswap' AND NOT failed AND migration_pool AND quote_mint='So11111111111111111111111111111111111111112';


-- [cta]
CREATE OR REPLACE TABLE cta AS
SELECT t.*, t.ts-l.ts AS age_s, t.slot-l.slot AS age_slot, (t.wallet=l.creator) AS is_dev, l.ts AS launch_ts, l.slot AS launch_slot, l.creator
FROM ct t JOIN launch l USING(mint) WHERE l.is_sol;

-- [coin]
CREATE OR REPLACE TABLE coin AS
SELECT l.mint, l.ts launch_ts, l.slot launch_slot, l.creator, (l.ts < 1792094400) AS in_cohort,
  count(t.mint) n_trades, count(DISTINCT t.wallet) n_wallets, max(t.age_s) last_trade_age_s,
  coalesce(max(t.mcap_sol), 27.96) peak_mcap_sol, coalesce(sum(t.sol),0) vol_sol,
  cp.ts_c - l.ts AS ttg_s
FROM launch l LEFT JOIN cta t USING(mint) LEFT JOIN comp cp USING(mint)
WHERE l.is_sol GROUP BY l.mint,l.ts,l.slot,l.creator,cp.ts_c;

-- [coverage]
SELECT (SELECT count(*) FROM ct) curve_sol_trades,(SELECT count(*) FROM cta) curve_trades_on_day_launches,
 (SELECT count(*) FROM launch) launches_all,(SELECT count(*) FROM launch WHERE is_sol) launches_sol,
 (SELECT count(*) FROM comp) completes_all,(SELECT count(*) FROM comp JOIN launch USING(mint)) completes_of_day_launches,
 (SELECT (max(slot)-min(slot))*1.0/86400 FROM ct) slots_per_s;

-- [trade_size_by_age_side]
SELECT CASE WHEN age_s<10 THEN '0-10s' WHEN age_s<60 THEN '10-60s' WHEN age_s<600 THEN '1-10m' WHEN age_s<3600 THEN '10-60m' ELSE '1h+' END age_bucket, CASE WHEN is_buy THEN 'buy' ELSE 'sell' END side, count(*) n, sum(sol) vol_sol,
 quantile_cont(sol,0.1) p10, quantile_cont(sol,0.25) p25, quantile_cont(sol,0.5) p50, quantile_cont(sol,0.75) p75, quantile_cont(sol,0.9) p90, quantile_cont(sol,0.99) p99,
 avg(sol) mean, avg(ln(sol)) mu_ln, stddev(ln(sol)) sigma_ln, avg((sol>=1)::int) share_ge_1sol, avg((sol<0.01)::int) share_lt_001sol
FROM cta WHERE sol>0 AND NOT is_dev GROUP BY ALL ORDER BY min(age_s), side;

-- [trade_size_all]
SELECT CASE WHEN is_buy THEN 'buy' ELSE 'sell' END side, count(*) n, quantile_cont(sol,[0.01,0.1,0.25,0.5,0.75,0.9,0.95,0.99,0.999]) q,
 avg(sol) mean, avg(ln(sol)) mu_ln, stddev(ln(sol)) sigma_ln FROM ct WHERE sol>0 GROUP BY 1;

-- [trade_size_tail_hill]
WITH p AS (SELECT is_buy, quantile_cont(sol,0.95) x0 FROM ct WHERE sol>0 GROUP BY 1)
SELECT CASE WHEN t.is_buy THEN 'buy' ELSE 'sell' END side, any_value(p.x0) xmin_p95, count(*) n_tail, 1/avg(ln(t.sol/p.x0)) pareto_alpha
FROM ct t JOIN p USING(is_buy) WHERE t.sol>p.x0 GROUP BY 1;

-- [trade_size_buckets]
SELECT CASE WHEN sol<0.03 THEN '<0.03' WHEN sol<0.05 THEN '0.03-0.05' WHEN sol<0.1 THEN '0.05-0.1' WHEN sol<0.25 THEN '0.1-0.25'
 WHEN sol<0.5 THEN '0.25-0.5' WHEN sol<1 THEN '0.5-1' WHEN sol<1.5 THEN '1-1.5' WHEN sol<2.5 THEN '1.5-2.5' ELSE '>=2.5' END b, count(*)*1.0/sum(count(*)) OVER () share
FROM ct WHERE sol>0 GROUP BY 1 ORDER BY min(sol);

-- [gaps]
CREATE OR REPLACE TABLE gaps AS SELECT mint, age_s,
 slot - lag(slot) OVER w AS gap_slot, ts - lag(ts) OVER w AS gap_s
FROM cta WINDOW w AS (PARTITION BY mint ORDER BY slot, idx, seq);

-- [interarrival]
SELECT count(*) n, quantile_cont(gap_slot,[0.1,0.25,0.5,0.75,0.9,0.99]) q_slot, avg(gap_slot) mean_slot, stddev(gap_slot)/avg(gap_slot) cv_slot,
 avg((gap_slot=0)::int) share_same_slot, quantile_cont(gap_s,[0.5,0.9,0.99]) q_s, stddev(gap_s)/avg(gap_s) cv_s FROM gaps WHERE gap_slot IS NOT NULL;

-- [interarrival_by_age]
SELECT CASE WHEN age_s<10 THEN '0-10s' WHEN age_s<60 THEN '10-60s' WHEN age_s<600 THEN '1-10m' WHEN age_s<3600 THEN '10-60m' ELSE '1h+' END age_bucket, count(*) n, quantile_cont(gap_slot,0.5) p50_slot, quantile_cont(gap_slot,0.9) p90_slot, avg(gap_slot) mean_slot,
 stddev(gap_slot)/avg(gap_slot) cv_slot, avg((gap_slot=0)::int) share_same_slot FROM gaps WHERE gap_slot IS NOT NULL GROUP BY 1 ORDER BY min(age_s);

-- [trade_rate_by_age]
WITH b AS (SELECT * FROM (VALUES (0,10),(10,30),(30,60),(60,120),(120,300),(300,600),(600,1800),(1800,3600),(3600,14400)) v(lo,hi)),
 n AS (SELECT count(*) nc FROM coin WHERE in_cohort)
SELECT b.lo, b.hi, count(t.mint)*1.0/(any_value(n.nc)*(b.hi-b.lo)) trades_per_coin_s,
 count(DISTINCT t.mint)*1.0/any_value(n.nc) share_coins_active
FROM b CROSS JOIN n LEFT JOIN (SELECT cta.* FROM cta JOIN coin USING(mint) WHERE coin.in_cohort) t ON t.age_s>=b.lo AND t.age_s<b.hi GROUP BY b.lo,b.hi ORDER BY b.lo;

-- [trades_per_active_coin_minute]
SELECT quantile_cont(n,[0.25,0.5,0.75,0.9,0.99]) q, avg(n) mean FROM (SELECT mint, age_s//60 m, count(*) n FROM cta GROUP BY 1,2);

-- [buy_share_by_age]
SELECT CASE WHEN age_s<600 THEN (age_s//30)*30 WHEN age_s<900 THEN 600 WHEN age_s<1800 THEN 900 WHEN age_s<3600 THEN 1800 WHEN age_s<7200 THEN 3600 ELSE 7200 END age_lo, count(*) n, avg(is_buy::int) buy_share_cnt, sum(CASE WHEN is_buy THEN sol END)/sum(sol) buy_share_sol,
 sum(CASE WHEN is_buy THEN sol ELSE -sol END) net_sol, sum(CASE WHEN is_buy THEN sol ELSE -sol END)/count(DISTINCT mint) net_sol_per_active_coin, count(DISTINCT mint) active_coins
FROM cta t JOIN coin USING(mint) WHERE coin.in_cohort AND NOT t.is_dev GROUP BY 1 ORDER BY 1;

-- [graduation]
SELECT count(*) launches, count(ttg_s) graduated, count(ttg_s)*1.0/count(*) rate,
 quantile_cont(ttg_s,[0.1,0.25,0.5,0.75,0.9]) ttg_q_s, avg(ttg_s) ttg_mean_s FROM coin WHERE in_cohort;

-- [graduation_all_day_launches]
SELECT count(*) launches, count(ttg_s) graduated, count(ttg_s)*1.0/count(*) rate FROM coin;

-- [mcap_at_complete]
SELECT quantile_cont(mcap_sol,[0.1,0.5,0.9]) q, count(*) n FROM (SELECT mint, arg_max(mcap_sol, slot*10000+idx) mcap_sol FROM ct JOIN comp USING(mint) WHERE ct.slot<=comp.slot_c GROUP BY 1);

-- [reach_thresholds]
SELECT avg((peak_mcap_sol>=40)::int) ge40, avg((peak_mcap_sol>=60)::int) ge60, avg((peak_mcap_sol>=100)::int) ge100, avg((peak_mcap_sol>=200)::int) ge200, avg((peak_mcap_sol>=300)::int) ge300,
 quantile_cont(peak_mcap_sol,[0.25,0.5,0.75,0.9,0.95,0.99]) peak_q FROM coin WHERE in_cohort;

-- [dev_behaviour]
WITH d AS (SELECT t.mint, min(CASE WHEN NOT is_buy THEN age_s END) first_sell_age, sum(CASE WHEN is_buy THEN tok ELSE 0 END) bought_tok,
  sum(CASE WHEN NOT is_buy THEN tok ELSE 0 END) sold_tok, sum(CASE WHEN is_buy THEN sol ELSE 0 END) bought_sol, sum(CASE WHEN NOT is_buy THEN sol ELSE 0 END) sold_sol,
  min(CASE WHEN is_buy AND age_slot=0 THEN sol END) init_buy_sol
 FROM cta t JOIN coin USING(mint) WHERE coin.in_cohort AND t.is_dev GROUP BY 1)
SELECT (SELECT count(*) FROM coin WHERE in_cohort) cohort, count(*) devs_traded, avg((init_buy_sol IS NOT NULL)::int) share_with_block0_buy,
 quantile_cont(init_buy_sol,[0.1,0.25,0.5,0.75,0.9]) init_buy_q_sol, count(first_sell_age)*1.0/count(*) share_dev_sold,
 quantile_cont(first_sell_age,[0.1,0.25,0.5,0.75,0.9]) first_sell_age_q_s, avg(CASE WHEN bought_tok>0 THEN least(sold_tok/bought_tok,1) END) mean_frac_sold,
 avg(CASE WHEN bought_tok>0 THEN (sold_tok>=0.99*bought_tok)::int END) share_sold_all, avg(sold_sol-bought_sol) mean_dev_pnl_sol_gross,
 quantile_cont(sold_sol-bought_sol,[0.1,0.5,0.9]) dev_pnl_q FROM d;

-- [snipers]
WITH b AS (SELECT t.* FROM cta t JOIN coin USING(mint) WHERE coin.in_cohort AND is_buy AND NOT is_dev),
 per AS (SELECT mint, sum(sol) buy_all, sum(CASE WHEN age_slot=0 THEN sol ELSE 0 END) b0, sum(CASE WHEN age_s<=5 THEN sol ELSE 0 END) s5,
   sum(CASE WHEN age_s<=60 THEN sol ELSE 0 END) s60, count(DISTINCT CASE WHEN age_slot=0 THEN wallet END) n_b0_wallets, count(DISTINCT CASE WHEN age_slot<=2 THEN wallet END) n_le2slot_wallets FROM b GROUP BY 1)
SELECT count(*) coins_with_nondev_buys, avg((b0>0)::int) share_coins_with_block0_snipe, sum(b0)/sum(buy_all) block0_share_of_all_buy_sol,
 sum(s5)/sum(buy_all) first5s_share_of_all_buy_sol, sum(s60)/sum(buy_all) first60s_share_of_all_buy_sol, sum(b0)/nullif(sum(s60),0) block0_share_of_first60s,
 sum(s5)/nullif(sum(s60),0) first5s_share_of_first60s, quantile_cont(n_b0_wallets,[0.5,0.9,0.99]) block0_wallets_q, avg(n_b0_wallets) block0_wallets_mean,
 quantile_cont(CASE WHEN b0>0 THEN b0 END,[0.5,0.9]) block0_sol_q FROM per;

-- [post_migration_decay]
WITH m AS (SELECT mint, min(ts_m) ts_m FROM mig GROUP BY 1),
 obs AS (SELECT mint, ts_m, (1792108800-ts_m) horizon FROM m),
 b AS (SELECT range*300 lo FROM range(0,288)),
 cnt AS (SELECT b.lo, count(*) n_coins FROM b JOIN obs ON obs.horizon >= b.lo+300 GROUP BY 1),
 tr AS (SELECT ((p.ts-m.ts_m)//300)*300 lo, count(*) n, sum(sol) vol, count(DISTINCT p.wallet) wallets_sum_over_coins
        FROM pt p JOIN m USING(mint) WHERE p.ts>=m.ts_m GROUP BY 1)
SELECT cnt.lo, cnt.n_coins, coalesce(tr.n,0)*1.0/cnt.n_coins trades_per_coin, coalesce(tr.vol,0)/cnt.n_coins sol_per_coin
FROM cnt LEFT JOIN tr USING(lo) ORDER BY 1;

-- [post_migration_wallets]
WITH m AS (SELECT mint, min(ts_m) ts_m FROM mig GROUP BY 1)
SELECT lo, avg(w) wallets_per_coin_active FROM (SELECT p.mint, ((p.ts-m.ts_m)//300)*300 lo, count(DISTINCT wallet) w FROM pt p JOIN m USING(mint) WHERE p.ts>=m.ts_m GROUP BY 1,2) GROUP BY 1 ORDER BY 1;

-- [wal]
CREATE OR REPLACE TABLE wal AS SELECT wallet, count(*) n, count(DISTINCT mint) mints, (max(ts)-min(ts)) span_s, avg(sol) avg_sol,
 coalesce(stddev(sol)/nullif(avg(sol),0),0) size_cv, avg(is_buy::int) buy_share, sum(sol) vol FROM ct WHERE sol>0 GROUP BY 1;

-- [hold]
CREATE OR REPLACE TABLE hold AS SELECT wallet, quantile_cont(h,0.5) med_hold_s, count(*) n_pos FROM (
 SELECT wallet, mint, min(CASE WHEN NOT is_buy THEN ts END) - min(CASE WHEN is_buy THEN ts END) h FROM ct GROUP BY 1,2) WHERE h IS NOT NULL AND h>=0 GROUP BY 1;

-- [launches_by_hour]
SELECT (ts-1792022400)//3600 hour_utc, count(*)/60.0 launches_per_min, count_if(is_sol)/60.0 sol_launches_per_min FROM launch GROUP BY 1 ORDER BY 1;

-- [trades_by_hour]
SELECT (ts-1792022400)//3600 hour_utc, count(*)/60.0 curve_trades_per_min FROM ct GROUP BY 1 ORDER BY 1;

-- [failed_rate]
SELECT (SELECT count(*) FROM cf) failed_tx, (SELECT count(DISTINCT (slot,idx)) FROM ct) landed_tx_sol,
 (SELECT count(*) FROM (SELECT DISTINCT slot, idx FROM '/workspace/data/pumpdata/data/*.parquet' WHERE venue='curve' AND NOT failed)) landed_tx_all,
 (SELECT sum(fee)/1e9 FROM cf) failed_fees_sol, (SELECT count(DISTINCT wallet) FROM cf) failed_wallets;

-- [failed_errors]
SELECT try_cast(regexp_extract(error,'Custom\((\d+)\)',1) AS INT) code, count(*) n FROM cf GROUP BY 1 ORDER BY 2 DESC LIMIT 15;

-- [failed_wallet_concentration]
SELECT sum(n) FILTER (WHERE r<=100)*1.0/sum(n) top100_wallet_share FROM (SELECT wallet, count(*) n, row_number() OVER (ORDER BY count(*) DESC) r FROM cf GROUP BY 1);

-- [lifecycle]
SELECT count(*) n, avg((n_trades<=1)::int) share_le1_trade, avg((n_trades<=5)::int) share_le5_trades,
 avg((coalesce(last_trade_age_s,0)<60)::int) dead_by_1m, avg((coalesce(last_trade_age_s,0)<300)::int) dead_by_5m, avg((coalesce(last_trade_age_s,0)<900)::int) dead_by_15m,
 avg((coalesce(last_trade_age_s,0)<3600)::int) dead_by_60m, quantile_cont(n_trades,[0.25,0.5,0.75,0.9,0.99]) trades_per_coin_q, quantile_cont(n_wallets,[0.5,0.9,0.99]) wallets_per_coin_q,
 quantile_cont(vol_sol,[0.5,0.9,0.99]) vol_sol_per_coin_q FROM coin WHERE in_cohort AND ttg_s IS NULL;

-- ===== Slinky21 corpus: day-to-day variance (slinky_daily.sql) =====
-- Day-to-day variance from Slinky21/Pumpfun_Memecoin_Corpus tokens.parquet (websocket-collected, see its KNOWN_ISSUES.md)
SET TimeZone='UTC';
SELECT date_trunc('day', detected_at)::DATE AS day, count(*) AS launches, count(*)/1440.0 AS launches_per_min,
  count(graduated_at) AS graduated, count(graduated_at)*1.0/count(*) AS grad_rate,
  quantile_cont(seconds_to_graduation, 0.5) AS ttg_median_s, quantile_cont(peak_market_cap_sol, 0.5) AS peak_mcap_sol_median,
  quantile_cont(initial_buy_sol, 0.5) AS dev_initial_buy_sol_median, quantile_cont(trade_count, 0.5) AS trades_per_token_median
FROM 'tokens.parquet' GROUP BY 1 ORDER BY 1;

-- ===== memex-sim headless output analysis: see sim_analysis.py (DuckDB SQL inline) =====
