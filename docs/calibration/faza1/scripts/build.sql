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
