WITH
ordered AS (
    SELECT *,
        lag(ts) OVER (PARTITION BY mint ORDER BY slot,idx,seq) AS previous_ts,
        lag(r2/1e6,1,1073000000.0) OVER (PARTITION BY mint ORDER BY slot,idx,seq) AS previous_tokens
    FROM ct
),
standard AS (
    SELECT c.*, lag(c.r1/1e9,1,30.0) OVER (PARTITION BY c.mint ORDER BY c.slot,c.idx,c.seq) AS previous_sol
    FROM ct c JOIN integrity i USING(mint) WHERE i.max_k_deviation<=0.000001
)
SELECT
    (SELECT count(*) FROM launches) AS launches,
    (SELECT count(*) FROM ct) AS trades,
    (SELECT count(*) FROM integrity WHERE max_k_deviation<=0.000001) AS standard_tokens,
    (SELECT count(*) FROM (SELECT mint,slot,idx,seq FROM ct GROUP BY ALL HAVING count(*)>1)) AS duplicate_keys,
    (SELECT count(*) FROM ordered WHERE ts<previous_ts) AS backward_timestamps,
    (SELECT count(*) FROM ct WHERE quote_sol<0 OR tokens<=0 OR r1<=0 OR r2<=0) AS invalid_rows,
    (SELECT max(abs(r2/1e6-previous_tokens+CASE WHEN side='buy' THEN tokens ELSE -tokens END)) FROM ordered) AS token_delta_error_max,
    (SELECT max(abs(r1/1e9-previous_sol-CASE WHEN side='buy' THEN quote_sol ELSE -quote_sol END)) FROM standard) AS standard_quote_delta_error_max,
    (SELECT count(*) FROM standard WHERE progress< -0.000001 OR progress>1.000001) AS standard_invalid_progress;
