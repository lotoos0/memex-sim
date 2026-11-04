# Kalibracja realizmu rynku — handoff (stan na 2026-11-04)

Cel: memex-sim ma się zachowywać jak pump.fun 1:1 (bez blockchaina). Wszystkie liczby "realne" pochodzą z
HF `pumpdatafun/pump-fun-trades-sample`, dzień **2026-10-15 UTC** (CC-BY-4.0). Szczegóły i definicje:
`faza1/raport-faza1.md`, surowe metryki: `faza1/metrics.json`. Źródła danych i stałe pump.fun: `zrodla-danych-i-plan.md`.

Zasada pracy: **jeden mały PR = jedna rzecz**, zawsze z tabelą przed/po z headless harnessu, `tsc`/lint/build zielone,
reguły z `AGENTS.md` (frozen contracts, migration notes).

## Co już jest w main

| PR | Zmiana |
|---|---|
| #56 | Pełna krzywa bonding + atomowy handoff migracji |
| #57 | Jeden zegar: `SIM_TIME_MULTIPLIER = 1`, czas sim tylko przez `src/tokens/simClock.ts`; fille stemplowane czasem sim, due-ness zleceń na czasie ściennym |
| #58 | Napływ trade'ów = Poisson(λ·Δt) na zegarze sim, λ maleje z wiekiem, każdy coin ma wylosowany "czas ciszy"; nowy gate migracji (≥90 s, ≥$3.5k real quote, ≥5 holderów, ≥12 trade'ów/5 min); bez sztucznych dodatkowych printów |
| #59 | Narodziny tokenów = Poisson wg tabeli launchy/min dla godziny UTC (`src/market/launchRate.ts`), ~połowa "stillborn", eviction martwych tokenów (`registryEviction.ts`, nigdy pozycja/zlecenie/oglądany), cap renderu Pulse 20/16/20 po filtrach |

## Realne vs sim (ostatnie pomiary)

| Metryka | Realne | Sim teraz | Uwagi |
|---|---:|---:|---|
| trades/s na coin, 0–10 s | 1,36 | 1,57 | OK |
| trades/s, 1–2 min | 0,29 | 0,12 | ~2× za mało |
| trades/s, 10–30 min | 0,0074 | 0,0030 | ~2× za mało |
| bez trade'ów po 5 min | 60% | 85–87% | za martwo (stillborn nigdy nie otwiera crowd flow) |
| launche/min | 32,3 (17,9 @08Z … 56,7 @19Z) | 17,4 @08Z / 58,1 @19Z | OK |
| graduacja | 2,58% (organicznie 1,55%), mediana 309 s | 2,5–2,9% | OK; mediana czasu do sprawdzenia |
| mcap martwego tokena | ~launch (~28 SOL) | ~$4,3k | dev buy odpala zawsze |
| portfele/coin, mediana | 5 | ~11–14 | za mało reuse portfeli |
| dev pierwszy sell | 25 s | ~0,7 s | za szybko |
| snajperzy, blok startowy | 12,2% buy-SOL (41% coinów) | ~0,4% | za słabi |
| peak mcap, mediana | 36,4 SOL | — | do zmierzenia |

Przybliżenie realnego zaniku: λ(t) ≈ 1,36·(t/5 s)^−0,95 tx/s. Odsetek aktywnych coinów: 93% (0–10 s) → 26% (5–10 min) → 9% (30–60 min).

## Kolejne kroki (proponowana kolejność, każdy osobny PR)

1. **Kalibracja "żywotności"**: zbić "bez trade'ów po 5 min" z ~86% do ~60% i podnieść tempo 1 min+ ~2×; dev buy nie na każdym starcie (stillborn ma stać przy mcap startowym).
2. **Oficjalne stałe krzywej pump.fun**: 1,073B virtual tokens, 30 virtual SOL, 793,1M real tokens, supply 1B, graduacja gdy real tokens = 0 (~85 SOL, mcap ~410,9 SOL), fee 1,25%. Szczegóły i źródła w `zrodla-danych-i-plan.md`.
3. **Snajperzy, dev, rozmiary trade'ów** (rozkład wg wieku i strony: `metrics.json` → `trade_size_by_age_side`, `snipers`, `dev`).
4. **Reuse portfeli** (`wallets`, `wallet_clusters_ge5_trades`).
5. **Wygląd świec** — właściciel dostarczy screeny z realnego rynku do porównania.

## Jak mierzyć

- W repo: `src/qa/birthHarnessQa.ts` (launche/min, stillborn, graduacja, populacja, koszt ticka), `src/qa/arrivalDecayQa.ts`, `launchRateQa.ts`, `migrationGateQa.ts`, `simClockQa.ts` itd. Uruchamiane headless po zbundlowaniu esbuildem, jak w `docs/cash-cap-sell-reachability.md`: `./node_modules/.bin/esbuild src/qa/<plik>.ts --bundle --platform=node --format=esm --define:import.meta.env.DEV=true --out-extension:.js=.mjs --outdir=/tmp/qa && node /tmp/qa/<plik>.mjs`.
- `faza1/scripts/sim_harness.ts` + `sim_analysis.py` — harness z fazy 1 (pisany przed #57; API `TokenSim.tick` mogło się zmienić, traktować jako wzór liczenia metryk per wiek).
- `faza1/scripts/build.sql` + `analysis.py` — liczenie metryk realnych z parquetów datasetu w DuckDB (dataset ~1,3 GB, nie commitować).
