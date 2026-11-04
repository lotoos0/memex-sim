-- Day-to-day variance from Slinky21/Pumpfun_Memecoin_Corpus tokens.parquet (websocket-collected, see its KNOWN_ISSUES.md)
SET TimeZone='UTC';
SELECT date_trunc('day', detected_at)::DATE AS day, count(*) AS launches, count(*)/1440.0 AS launches_per_min,
  count(graduated_at) AS graduated, count(graduated_at)*1.0/count(*) AS grad_rate,
  quantile_cont(seconds_to_graduation, 0.5) AS ttg_median_s, quantile_cont(peak_market_cap_sol, 0.5) AS peak_mcap_sol_median,
  quantile_cont(initial_buy_sol, 0.5) AS dev_initial_buy_sol_median, quantile_cont(trade_count, 0.5) AS trades_per_token_median
FROM 'tokens.parquet' GROUP BY 1 ORDER BY 1;
