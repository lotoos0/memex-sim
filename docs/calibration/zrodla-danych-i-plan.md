# memex-sim: źródła realnych danych rynkowych pump.fun i plan kalibracji

Stan: 4.11.2026. memex-sim main `0673d9e`. Program IDs: Pump `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`, PumpSwap `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`.

## 1. Źródła danych

### Darmowe (start tutaj)
- **Hugging Face `pumpdatafun/pump-fun-trades-sample`** (CC-BY-4.0, ~4.2 GB, Parquet). Pełna doba 2026-10-15: 4.56M udanych i 10.4M nieudanych trade'ów na krzywej, 17.2M trade'ów PumpSwap, 46 540 launchy, 302 graduacje, 850k portfeli. Kolumny: wallet, side, sol_lamports, token_amount, rezerwy, błąd. Zapytania lokalnie w DuckDB.
- **Hugging Face `Slinky21/Pumpfun_Memecoin_Corpus`** (MIT, ~6.7 GB). 39 dni (2026-06-05 do 07-14): 33.6M trade'ów, 798k tokenów, 5689 graduacji (0.71%), statystyki portfeli. Najpierw przeczytać `KNOWN_ISSUES.md`.
- Kaggle „Solana Launch Tape” i `cryptodata/pumpfun-dataset-light`: NIEZWERYFIKOWANE.

### Dune
- Darmowy plan to tylko podgląd: nie da się uruchamiać zapytań, nie ma API ani eksportu CSV. Trial 14 dni (2500 kredytów), Analyst $75/mies., Plus $399/mies.
- Tabele zweryfikowane w spellbook: `dex_solana.trades` z `project='pumpdotfun'` (krzywa) albo `'pumpswap'`, widoki `pumpdotfun_solana.trades`, `pumpswap_solana.trades` i `pumpswap_solana.pools`. Kolumny `fee_*` są błędne, bo fee jest zakodowane na sztywno jako 0.01.
- Tabele potwierdzone tylko przez kod osób trzecich: `pumpdotfun_solana.pump_evt_tradeevent` (od 2025-11-05) i `pumpdotfun_solana.pump_call_create`. Najpierw zrobić `SELECT * ... LIMIT 10`.
- Dashboardy:
  - https://dune.com/yehohanan/pumpfun-launch-analytics (~2.56% graduacji w 24h, mediana 16 s)
  - https://dune.com/ghostiemoh/pump-fun-and-the-launchpad-economy (~38k launchy/dzień, graduacja 0.8–3.5% miesięcznie)
  - https://dune.com/ghostiemoh/the-263k-token-day-what-actually-traded-on-solana
  - https://dune.com/geggonen/pump-fun-analytics-dashboard
  - https://dune.com/adam_tehc/pumpfun-creator-earnings
- Odsetki graduacji różnią się między źródłami, bo każde inaczej ją definiuje (0.65%, 0.71%, 2.5–3.5%). Ustalić jedną definicję: real_token_reserves = 0.

### Płatne / do streamingu
- **Helius**: darmowy plan to 1M kredytów/mies., 10 rps, `logsSubscribe`. `transactionSubscribe` od $49/mies., gRPC LaserStream od $499/mies.
- **Bitquery**: bez darmowego planu, trial 7 dni tylko real-time, płatne od $49/$99 za miesiąc.
- **Trawl.run**: zdekodowany Parquet za $8.68/tydzień (NIEZWERYFIKOWANE).
- **Flipside**: podobno zamknięte (NIEZWERYFIKOWANE).

## 2. Szkice zapytań (DuneSQL, NIETESTOWANE)

```sql
WITH t AS (
  SELECT block_time, block_slot, tx_index, trader_id AS wallet, tx_id,
         CASE WHEN token_sold_mint_address='So11111111111111111111111111111111111111112' THEN 'buy' ELSE 'sell' END AS side,
         CASE WHEN token_sold_mint_address='So11111111111111111111111111111111111111112' THEN token_bought_mint_address ELSE token_sold_mint_address END AS mint,
         CASE WHEN token_sold_mint_address='So11111111111111111111111111111111111111112' THEN token_sold_amount ELSE token_bought_amount END AS sol
  FROM dex_solana.trades
  WHERE project='pumpdotfun' AND block_time >= TIMESTAMP '2026-10-15' AND block_time < TIMESTAMP '2026-10-16'),
first_trade AS (SELECT mint, min(block_time) t0, min(block_slot) s0 FROM t GROUP BY 1)
```

1. Wielkość trade'u według wieku coina:
```sql
, a AS (SELECT t.*, date_diff('second', f.t0, t.block_time) age FROM t JOIN first_trade f USING(mint))
SELECT CASE WHEN age<10 THEN '0-10s' WHEN age<60 THEN '10-60s' WHEN age<600 THEN '1-10m' WHEN age<3600 THEN '10-60m' ELSE '1h+' END bucket, side,
       count(*) n, approx_percentile(sol, ARRAY[0.1,0.25,0.5,0.75,0.9,0.99]) q, avg(ln(sol)) mu_log, stddev(ln(sol)) sigma_log
FROM a WHERE sol>0 GROUP BY 1,2
```
2. Odstępy między trade'ami (cv > 1 oznacza, że trade'y przychodzą seriami):
```sql
, g AS (SELECT mint, date_diff('millisecond', lag(block_time) OVER (PARTITION BY mint ORDER BY block_slot, tx_index), block_time) gap_ms FROM t)
SELECT approx_percentile(gap_ms, ARRAY[0.1,0.5,0.9,0.99]) q, avg(gap_ms) mean, stddev(gap_ms)/avg(gap_ms) cv FROM g WHERE gap_ms IS NOT NULL
```
3. Kupno/sprzedaż w czasie życia coina: `a` z zapytania 1, `GROUP BY floor(age/30)`, `count_if(side='buy')*1.0/count(*)` i przepływ netto SOL.
4. Odsetek graduacji i czas do graduacji:
```sql
WITH c AS (SELECT account_mint mint, call_block_time t0 FROM pumpdotfun_solana.pump_call_create WHERE call_block_time >= TIMESTAMP '2026-10-15' AND call_block_time < TIMESTAMP '2026-10-16'),
done AS (SELECT mint, min(evt_block_time) t1 FROM pumpdotfun_solana.pump_evt_tradeevent
         WHERE evt_block_time >= TIMESTAMP '2026-10-15' AND evt_block_time < TIMESTAMP '2026-10-17' AND real_token_reserves = 0 GROUP BY 1) -- kolumna NIEZWERYFIKOWANA
SELECT count(*) launches, count(d.mint) grads, count(d.mint)*1.0/count(*) rate, approx_percentile(date_diff('second', c.t0, d.t1), ARRAY[0.1,0.5,0.9]) ttg_s
FROM c LEFT JOIN done d USING(mint)
```
5. Kiedy sprzedaje dev:
```sql
, dev AS (SELECT account_mint mint, account_user creator, call_block_time t0 FROM pumpdotfun_solana.pump_call_create WHERE call_block_time >= TIMESTAMP '2026-10-15' AND call_block_time < TIMESTAMP '2026-10-16')
SELECT approx_percentile(date_diff('second', d.t0, s.first_sell), ARRAY[0.1,0.25,0.5,0.75,0.9]) q, count(*) devs_who_sold
FROM dev d JOIN (SELECT mint, wallet, min(block_time) first_sell FROM t WHERE side='sell' GROUP BY 1,2) s ON s.mint=d.mint AND s.wallet=d.creator
```
6. Udział snajperów:
```sql
, e AS (SELECT t.mint, t.sol, t.block_slot - f.s0 dslot, date_diff('second', f.t0, t.block_time) dsec FROM t JOIN first_trade f USING(mint) WHERE side='buy')
SELECT avg(CASE WHEN dslot=0 THEN 1.0 ELSE 0 END) share_trades_block0,
       sum(CASE WHEN dslot=0 THEN sol END)/sum(CASE WHEN dsec<=60 THEN sol END) block0_share_of_first_min_sol,
       sum(CASE WHEN dsec<=5 THEN sol END)/sum(sol) first5s_share
FROM e
```
7. Spadek wolumenu po migracji: trade'y `project='pumpswap'` dla zgraduowanych mintów, kubełki po 5 minut od t1, przez 0–24h (wychodzi z tego half-life).
8. Profile portfeli (boty i ludzie):
```sql
SELECT wallet, count(*) n, count(DISTINCT mint) mints, n*1.0/greatest(1, date_diff('minute', min(block_time), max(block_time))) trades_per_min,
       avg(sol) avg_sol, stddev(sol)/avg(sol) size_cv, count_if(side='buy')*1.0/count(*) buy_share
FROM t GROUP BY 1 HAVING count(*) >= 3
```
9. Launche na minutę według godziny:
```sql
SELECT hour(call_block_time) h, count(*)/60.0/7 launches_per_min FROM pumpdotfun_solana.pump_call_create
WHERE call_block_time >= now() - interval '7' day GROUP BY 1 ORDER BY 1
```
Na datasecie z HF to samo działa w DuckDB z kolumnami `venue='curve'`, `wallet`, `side`, `sol_lamports/1e9`, `slot`, `idx` oraz tabelami `launches/` i `graduations/`.

## 3. Mapowanie na memex-sim

| Metryka | Gdzie w memex-sim |
|---|---|
| Wielkość trade'u | `baseTradeSizeUsd`, `tradeSigma` (`tokenSim.ts:404-405`), wieloryby (`marketModel.ts:63-66`), `TRADE_SIZE_BUCKETS_SOL` (`tokenMarketRegimes.ts:39`) |
| Odstępy i serie | `baseLambda`, `attention` (`tokenSim.ts:402,409`), Poisson (`marketModel.ts:50-52`), serie (`tokenMarketRegimes.ts:70-73,210-212`) |
| Kupno/sprzedaż | `buyBias`/drift (`marketModel.ts`), archetypy (`tokenSim.ts:2346-2390`) |
| Graduacja | szanse archetypów (`tokenSim.ts:2336-2342`), losy (`generator.ts:41-47,75-82`), bramki (`tokenMarketRegimes.ts:30-33`) |
| Dev | `tokenSim.ts:1693-1740`, `maxDevEvents`, `getDevFlowPowerMul`, aktor `dev` (`tokenActors.ts:51`) |
| Snajperzy | `tokenActors.ts:57-68`, tick startowy (`tokenSim.ts:752-757`), `snipersPct` (`generator.ts:66`) |
| Po migracji | `MIGRATION_SHOCK_*`, `POST_MIGRATION_*` (`tokenMarketRegimes.ts:20-38`), `decideMigrationOutcome` (`:521`) |
| Portfele | `HolderWalletProfile` (`tokenSim.ts:93`), wybór portfeli (`~1440-1490`), `tokenActors.ts` |
| Launche/godzina | `registry.ts:16-17`, `src/market/session.ts:64,85-116` |
| Nieudane trade'y | `tokenSim.ts:2096-2131`, latencja (~`:294`) |

`config/config.json` należy do starego, nieaktywnego silnika. Profile sesji są w `src/market/session.ts`.

## 4. Plan w fazach (same pomysły)
1. **Eksploracja (2–4 dni, za darmo):** datasety z HF do DuckDB, 9 metryk, kwantyle i dopasowane rozkłady (lognormalny/Pareto), krótki raport. Opcjonalnie trial Dune, żeby porównać wiele dni.
2. **Własny zbieracz (1–2 tyg., tylko gdy potrzebne świeże dane):** Helius `logsSubscribe` albo gRPC → dekodowanie z oficjalnych IDL → kolejka (Redis Streams/NATS) → Parquet/DuckDB albo ClickHouse, z zapisem nieudanych transakcji i uzupełnianiem luk przez RPC. Koszt (NIEZWERYFIKOWANY): ~40–80 GB/dzień danych z WebSocketu, czyli ~0.8–1.6M kredytów dziennie. Darmowy plan starczy na kilka dni próbki z samej krzywej, ciągły zbiór wymaga ~$499/mies. albo dostawcy Yellowstone. Miejsce na dysku: ~150 MB/dzień.
3. **Kalibracja i walidacja (1–2 tyg.):** skrypt poza aplikacją generuje `config/market-calibration.json`, headless symulacja liczy te same metryki, porównanie testami KS i odległością Wassersteina z progami w CI. Zmiany parametrów wymagają zgody według `AGENTS.md`.

Te źródła nie powiedzą, kim są ludzie za portfelami, nie pokażą sygnałów z social mediów ani domyślnych ustawień UI pump.fun.
