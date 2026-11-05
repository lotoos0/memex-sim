SET TimeZone='UTC'; SET memory_limit='3GB'; SET threads=4;
CREATE OR REPLACE TABLE launches AS SELECT *, ts AS launch_ts, slot AS launch_slot, idx AS launch_idx FROM '@WORK@/launches/*.parquet' WHERE quote_mint='So11111111111111111111111111111111111111112' AND ts < 1792107000;
CREATE OR REPLACE TABLE complete AS SELECT a mint,arg_min(ts,struct_pack(s:=slot,i:=idx)) complete_ts,min(struct_pack(s:=slot,i:=idx)) complete_key FROM '@WORK@/events/*.parquet' WHERE kind='complete' GROUP BY 1;
CREATE OR REPLACE TABLE poollegs AS SELECT * FROM '@WORK@/graduations/*.parquet' WHERE quote_mint='So11111111111111111111111111111111111111112';
CREATE OR REPLACE TABLE ct AS SELECT t.ts,t.slot,t.idx,t.seq,t.mint,t.wallet,t.side,t.r1,t.r2,t.r3,
(t.sol_lamports-coalesce(g.quote_amount,0))/1e9 AS quote_sol,
(t.token_amount-coalesce(g.token_amount,0))/1e6 AS tokens,
coalesce(g.quote_amount,0)/1e9 pool_quote_sol,
l.launch_ts,l.creator,l.launch_slot,l.launch_idx,c.complete_ts,
(t.ts-l.launch_ts)::DOUBLE AS age_sec,
(t.r1/t.r2)*0.001 AS price_sol,
(1073000000.0-t.r2/1e6)/793100000.0 AS progress,
(t.r1/1e9)*(t.r2/1e6)/(30.0*1073000000.0) AS k_ratio
FROM '@WORK@/data/*.parquet' t JOIN launches l USING(mint)
LEFT JOIN complete c USING(mint)
LEFT JOIN poollegs g ON t.slot=g.slot AND t.idx=g.idx AND t.mint=g.mint AND t.wallet=g.wallet
WHERE t.venue='curve' AND NOT t.failed AND t.quote_mint='So11111111111111111111111111111111111111112'
AND t.ts>=l.launch_ts AND t.ts<=l.launch_ts+1800
AND struct_pack(s:=t.slot,i:=t.idx)>=struct_pack(s:=l.launch_slot,i:=l.launch_idx)
AND (c.complete_key IS NULL OR struct_pack(s:=t.slot,i:=t.idx)<=c.complete_key);
CREATE OR REPLACE TABLE integrity AS SELECT mint,count(*) n,
min(k_ratio) min_k,max(k_ratio) max_k,max(abs(k_ratio-1)) max_k_deviation,
min(progress) min_progress,max(progress) max_progress,
arg_min(r2/1e6+CASE WHEN side='buy' THEN tokens ELSE -tokens END,struct_pack(s:=slot,i:=idx,q:=seq)) inferred_initial_tokens,
arg_min(r1/1e9-CASE WHEN side='buy' THEN quote_sol ELSE -quote_sol END,struct_pack(s:=slot,i:=idx,q:=seq)) inferred_initial_sol,
count(*) FILTER(WHERE quote_sol<0 OR tokens<=0 OR r1<=0 OR r2<=0) invalid_rows,
count(*) FILTER(WHERE pool_quote_sol>0) split_pool_rows,
min(complete_ts-launch_ts) completion_age
FROM ct GROUP BY mint;
COPY (SELECT * FROM integrity) TO '@WORK@/integrity.csv' (HEADER);
COPY (SELECT l.*,c.complete_ts,c.complete_ts-l.launch_ts completion_age FROM launches l LEFT JOIN complete c USING(mint) ORDER BY mint) TO '@WORK@/launches.csv' (HEADER);
SELECT (SELECT count(*) FROM launches) launches,(SELECT count(*) FROM ct) trades,(SELECT count(*) FROM integrity) traded_coins;
SELECT quantile_cont(max_k_deviation,[0,.5,.9,.95,.99,1]) deviations,count(*) FILTER(WHERE max_k_deviation<=0.000001) standard_k,count(*) FILTER(WHERE abs(inferred_initial_tokens-1073000000)<=1) initial_tokens_ok,count(*) FILTER(WHERE abs(inferred_initial_sol-30)<0.000001) initial_sol_ok FROM integrity;
SELECT mint,n,min_k,max_k,inferred_initial_tokens,inferred_initial_sol,completion_age FROM integrity ORDER BY max_k_deviation DESC LIMIT 5;
