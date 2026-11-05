SET TimeZone='UTC';
COPY (SELECT c.mint,c.age_sec,c.slot,c.idx,c.seq,c.price_sol,c.progress,c.quote_sol,c.tokens,c.side,c.wallet,c.r1/1e9 vsol,c.r2/1e6 vtok,c.r3/1e9 real_sol FROM ct c JOIN integrity i USING(mint) WHERE i.max_k_deviation<=0.000001 ORDER BY c.mint,c.slot,c.idx,c.seq) TO '@WORK@/real-standard.csv' (HEADER);
SELECT count(*) FILTER(WHERE completion_age<=1) instant,count(*) FILTER(WHERE completion_age>1 AND completion_age<=1800) organic,count(*) FILTER(WHERE completion_age>1800) late_completions FROM integrity WHERE max_k_deviation<=0.000001;
SELECT count(*) exact_create_tx FROM launches l JOIN complete c USING(mint) JOIN integrity i USING(mint) WHERE i.max_k_deviation<=0.000001 AND c.complete_key=struct_pack(s:=l.launch_slot,i:=l.launch_idx);
SELECT max_k_deviation<=0.000001 standard,quantile_cont(max_k_deviation,[.5,.9,.99]) kerr,count(*) n FROM integrity GROUP BY ALL;
