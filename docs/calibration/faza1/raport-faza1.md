# Faza 1 — kalibracja rynku memex-sim na realnych danych pump.fun

*Data: 2026-11-04. Tryb: wyłącznie research — **zero zmian w repo memex-sim** (czytane read-only, `main` @ `0673d9e`; obszar „final BUY / tiny curveRealToken” nietknięty). Wszystkie liczby pochodzą z danych lub z kodu; pliki źródłowe obok raportu.*

## 0. TL;DR (najważniejsze wnioski)

1. **Tempo transakcji w memex-sim jest ~20× za wysokie na starcie i ~300× za wysokie po 10 min**, i prawie nie wygasa. Real: 1,36 tx/s na świeżego coina (0–10 s) → 0,0074 tx/s (10–30 min). Sim (headless): 28 tx/s → 2,4 tx/s. Główna przyczyna w kodzie: `executeMarketFlowAsTape` zawsze tnie przepływ na **2–24 transakcje na tick 200 ms** (`tokenSim.ts:892-896`), niezależnie od Poissona w `stepMarket`.
2. **Migracja jest drastycznie za łatwa**: sim 38% tokenów migruje w ciągu 30 min (mediana **5,3 s** realnego czasu!); real **2,58%** launchy (z czego 40% to „instant” — dev kupuje ~85 SOL w tx tworzącym), organicznie **1,55%**, mediana czasu **309 s**.
3. **Dwa zegary**: `stepMarket` dostaje `dtSec = realDtSec`, a progi wieku/fate/dev używają `simTimeMs` (×60, `SIM_TIME_MULTIPLIER`). Np. `MIN_MIGRATION_AGE_SEC=90` = 1,5 s realnie; DOA-dev-sell przy 120 s sim = 2 s realnie. Dev w simie sprzedaje medianowo po **0,4 s**, realnie po **25 s**.
4. **Rozkład rozmiarów za wąski**: real σ(ln SOL) ≈ 2,2–2,3, 36% transakcji < 0,03 SOL; sim σ ≈ 1,23, tylko 9% < 0,03 SOL (KS D=0,30).
5. **Brak „umierania”**: realnie 60% coinów bez graduacji nie ma już żadnej transakcji po 5 min (81% po 60 min); w simie 0% tokenów milknie w 30 min.
6. **Kierunek przepływu**: realnie po pierwszych 30 s wolumen jest **netto sprzedażowy** (buy ≈ 47% SOL), w simie stale kupujący (buy ≈ 54–61% SOL) → systematyczny wzrost ceny → (2).
7. **Snajperzy za słabi**: realnie blok 0 = 12,2% całego (nie-dev) buy-SOL, pierwsze 5 s = 24,1%; sim: pierwszy tick 0,4%, 5 s 4,4%.

## 1. Źródło danych i zastrzeżenia

- **Główne**: Hugging Face `pumpdatafun/pump-fun-trades-sample` (CC-BY-4.0), dzień **2026-10-15 UTC**, odczyt z ledgera (receipt: 399 170 bloków, 0 rozbieżności z RPC). Pobrane do `/workspace/data/pumpdata/` (1,3 GB; pominięto `signatures/` 2,8 GB — niepotrzebne).
  - 4 013 534 udanych transakcji na krzywej w SOL; 46 540 launchy (36 897 quote=SOL; reszta to custom pairs — **wykluczone** z metryk SOL); 1 067 eventów `complete`/`migrate`; 10,27 mln nieudanych tx na krzywej; 11,0 mln transakcji PumpSwap w pulach migracyjnych.
  - Slot = **216,3 ms** (399 487 slotów / 86 400 s — z danych, nie 400 ms).
- **Definicje**: wiek coina = `ts(trade) − ts(create)`; *kohorta cyklu życia* = launche SOL przed 20:00 UTC (≥ 4 h obserwacji, 29 117 coinów). **Graduacja = event `complete`** (real token reserves = 0). Tabela `graduations/` (302 wiersze) to tylko „PostCompleteBuy” i **nie** jest pełną listą graduacji. Dev = `launches.creator`.
- **Zastrzeżenia**: jeden dzień (brak sezonowości tygodniowej); czas bloku ma rozdzielczość 1 s (odstępy liczone w slotach); `sol_lamports` przed opłatami; wiersz kompletujący krzywą zawiera też nogę puli (302 wiersze); Mayhem-mode nieoflagowany w eksporcie; SOL/USD **nieznane w danych** — do porównań używam `SOL_PRICE_USD=150` z memex.
- **Zmienność dzień-do-dnia** (`Slinky21/Pumpfun_Memecoin_Corpus`, 2026-06-05…07-14, `slinky_daily.json`): korpus zbierany websocketem, z poważnymi problemami (KNOWN_ISSUES: graduacje praktycznie nie łapane do ~07-04, 20% wierszy to System Program, dziury w dniach). Wiarygodne okno 07-05…07-14: graduation rate **1,8–2,7%/dzień** (spójne z naszym 2,5%), mediana peak mcap 28–32 SOL/dzień (CV 3%), launche/min 8–22 (niekompletne pokrycie → nie używać jako tempa). Pełny trades.parquet (5,7 GB) **pominięty** — przy tych problemach jakości nie warto.
- **memex-sim „co produkuje”**: zamiast tylko analizy — uruchomiłem **headless harness** na *kopii* `src/` (git archive HEAD → `/workspace/data/memex-headless`, repo nietknięte; `sim_harness.ts`): 120 tokenów × 30 min realnego czasu, tick 200 ms jak `registry.ts`, fate jak `spawnFreshToken` (SHORT/NORMAL/LONG_RUNNER), sesje rozłożone na dobę. Brak transakcji użytkownika/narracji. 656 445 transakcji. Próba mała (120 tokenów) — wyniki kierunkowe.

## 2. Metryki (real, 2026-10-15)

### 2.1 Rozmiar transakcji (SOL) — `01_trade_size.png`
| wiek | strona | n | p10 | p50 | p90 | p99 | μ_ln | σ_ln | <0,01 SOL |
|---|---|---|---|---|---|---|---|---|---|
| 0–10 s | buy | 284 031 | 0,010 | **0,176** | 1,43 | 4,94 | −1,94 | 2,00 | 10% |
| 0–10 s | sell | 162 262 | 0,010 | 0,148 | 1,34 | 3,95 | −2,05 | 1,93 | 10% |
| 10–60 s | buy | 546 380 | 0,008 | 0,065 | 0,68 | 1,98 | −2,76 | 1,86 | 16% |
| 10–60 s | sell | 499 856 | 0,008 | 0,078 | 0,80 | 2,33 | −2,61 | 1,88 | 13% |
| 1–10 min | buy | 836 308 | 0,004 | 0,046 | 0,58 | 1,98 | −3,23 | 2,11 | 28% |
| 1–10 min | sell | 806 145 | 0,004 | 0,047 | 0,75 | 2,22 | −3,04 | 2,09 | 24% |
| 10–60 min | buy | 200 344 | 0,002 | 0,096 | 0,97 | 2,71 | −2,89 | 2,52 | 23% |
| 10–60 min | sell | 190 387 | 0,004 | 0,111 | 1,01 | 2,79 | −2,59 | 2,44 | 19% |
(bez dev). Całość: mediana buy 0,065 / sell 0,073 SOL, średnia 0,31 SOL, p99,9 = 8,5 / 6,8 SOL. **Ogon** (Hill, powyżej p95 ≈ 1,22–1,33 SOL): α_Pareto = **1,91 (buy) / 2,22 (sell)**. Udział w kubełkach `TRADE_SIZE_BUCKETS_SOL`: <0,03: 35,6%; 0,03–0,05: 9,9%; 0,05–0,1: 12,9%; 0,1–0,25: 13,8%; 0,25–0,5: 10,7%; 0,5–1: 9,6%; 1–1,5: 3,9%; 1,5–2,5: 2,4%; ≥2,5: 1,3%.

### 2.2 Odstępy między transakcjami (na coin) — `02_interarrival.png`
Całość: mediana **1 slot (~216 ms)**, p75 4, p90 14 slotów (~3 s), p99 673 slotów (~146 s); **34% transakcji w tym samym slocie** co poprzednia; CV = **25,7** (ekstremalna paczkowość). Wg wieku: 0–10 s mediana 1 slot, 46% same-slot, CV 1,9; 1–10 min p90 12 slotów, CV 6,3; 10–60 min mediana 2, p90 58 slotów.
**Tempo na launchowanego coina (λ)**: 0–10 s **1,36 tx/s**; 10–30 s 0,75; 30–60 s 0,49; 1–2 min 0,29; 2–5 min 0,107; 5–10 min 0,033; 10–30 min **0,0074**; 30–60 min 0,0015 → w przybliżeniu λ(t) ≈ 1,36·(t/5 s)^−0,95. Odsetek coinów aktywnych w oknie: 93% (0–10 s) → 26% (5–10 min) → 9% (30–60 min). Na aktywną coin-minutę: mediana 3, średnia 22,6, p99 250 tx.

### 2.3 Udział kupna i net flow vs wiek — `03_buy_share_age.png`
0–30 s: buy **58% (liczba) / 60% (SOL)**, net +2,55 SOL na aktywnego coina. Od 30 s do 10 min stabilnie: buy 50–52% (liczba), **46–48% (SOL)**, net −0,17…−0,36 SOL/aktywny coin/30 s. 10–15 min −0,66; 30–60 min −0,52; 1–2 h buy 42% (liczba). Wniosek: po pierwszych 30 s rynek jest netto podażowy; sprzedaże są nieco większe niż kupna.

### 2.4 Graduacja
Kohorta 29 117: **750 graduacji = 2,58%** (cały dzień 2,48%). **299 (40%) w ≤ 1 s** od create — dev kupuje w tym samym tx mediana 85,005 SOL (czyli całą krzywą) → to „instant/bundle”, nie organiczny rynek. **Organicznie (>1 s): 451 = 1,55%**, czas: p10 96 s, p25 167 s, **mediana 309 s**, p75 872 s, p90 3 465 s. Mcap w momencie complete: mediana **410,88 SOL** (zgodne z teorią krzywej). Peak mcap (kohorta): mediana **36,4 SOL**, p75 55, p90 98,6, p95 168; ≥60 SOL: 21,7%, ≥100: 9,8%, ≥200: 4,1%, ≥300: 2,8%.

### 2.5 Dev — `04_dev_first_sell.png`
Z devów, którzy handlowali (23 184/29 117): 99,7% kupuje w bloku 0; initial buy p10 0,047, p25 0,065, **mediana 0,26**, p75 0,99, p90 3,0 SOL. **90,3% sprzedaje**, pierwsza sprzedaż: p10 3 s, p25 7 s, **mediana 25 s**, p75 93 s, p90 376 s. **88% sprzedaje wszystko**, średni ułamek sprzedany 0,89. Gross PnL deva: mediana 0, p10 −0,29, p90 +0,86 SOL.

### 2.6 Snajperzy (bez deva)
Coiny z kupnem nie-deva w bloku 0: **40,9%**. Udział w całym buy-SOL coina: **blok 0 = 12,2%, pierwsze 5 s = 24,1%, pierwsze 60 s = 52,4%**. W obrębie pierwszej minuty: blok 0 = 23,3%, 5 s = 46,1%. Portfele w bloku 0: średnio 1,39, p90 5, p99 10; SOL w bloku 0 (gdy jest): mediana 3,1, p90 10,4.

### 2.7 Po migracji (PumpSwap, pula migracyjna) — `05_post_migration_decay.png`
1 067 migracji. Na migrowany coin w 1. 5 min: **1 157 tx, 415 SOL, ~349 portfeli**. Trades spadają o połowę po ~15 min, wolumen SOL po ~5 min; dopasowanie wykładnicze 0–2 h: half-life **≈ 25 min (tx) / 27 min (SOL)**. Po 1 h: 181 tx i 30 SOL / 5 min; po 6 h: 4,2 tx, 1,7 SOL (n=770); po 12 h: 3,0 tx, 1,0 SOL (n=489). (Zawiera „instant graduates”.)

### 2.8 Portfele (krzywa) — `06_wallet_clusters.png`
173 974 portfeli; mediana 4 tx, p90 24, p99 184; 17% ma 1 tx. **Top 1% portfeli = 59% transakcji i 49% wolumenu.** Mediana holdu (mediana per portfel): p25 16,5 s, **p50 52 s**, p75 164 s, p90 657 s.
Reguła „bot-like” (≥5 tx i (mediana holdu < 30 s lub ≥ 3 tx/min)): **14% portfeli, 64% transakcji, 53% wolumenu**.
k-means (k=4, portfele ≥5 tx, cechy log: liczba tx, tx/min, mints, CV rozmiaru, hold, buy share) — *klastry są niestabilne między uruchomieniami; traktować jako ilustrację*: (a) „rotatory multi-coin”: 20% portfeli, 55% tx, 61% wolumenu, mediana 56 tx / 19 mints / hold 41 s; (b) „szybkie flippery”: 42%, 8% tx, hold 27 s; (c) „human-like holderzy”: 32%, 7% tx, hold 269 s, buy share 0,6; (d) „HFT na jednym coinie”: 5% portfeli, 25% tx, 4,2 tx/min, hold 10 s.

### 2.9 Launche wg godziny UTC — `07_launches_by_hour.png`
Średnio **32,3 launchy/min** (SOL-quoted ~25/min); min **17,9/min o 08 UTC**, max **56,7/min o 19 UTC**. Dołek 02–11 UTC (18–24/min), szczyt 16–21 UTC (40–57/min). Transakcje na krzywej: 1 753/min (08 UTC) – 4 322/min (16 UTC), stosunek max/min 2,5×.

### 2.10 Nieudane transakcje (krzywa)
10,27 mln nieudanych vs 4,48 mln udanych tx → **69,7% prób kończy się błędem**, opłaty za nieudane 399 SOL; **top 100 portfeli = 96% nieudanych** → to spam botów, nie ludzie. Kody błędów (UWAGA: `InstructionError(i, Custom(n))` wskazuje instrukcję, nie program — mapowanie do IDL pump **NIEZWERYFIKOWANE**): 6001 (w IDL pump: AlreadyInitialized) 31%, 7 26%, 12 10%, 23 7%, **6042 BuySlippageBelowMinTokensOut 4%**, 408 3%, 4 3%, 412 3%, **6002 TooMuchSolRequired 1,4%**, **6003 TooLittleSolReceived 1,2%**. Kody < 100 to najpewniej programy botów/SPL.

### 2.11 Cykl życia — `08_lifecycle.png`
Coiny bez graduacji (28 367): 10% ma ≤ 1 tx, 26% ≤ 5 tx; ostatnia transakcja przed **1 min: 35%, 5 min: 60%, 15 min: 72%, 60 min: 81%**. Tx/coin: mediana 22, p90 234 (cała kohorta: 22 / 261); portfele/coin: mediana 5, p90 41.

## 3. memex-sim vs real — `09_real_vs_sim.png`, `sim_metrics.json`, `compare_ks.json`

| Metryka | pump.fun (2026-10-15) | memex-sim (kod → headless) | Werdykt | Propozycja (tylko pomysł) |
|---|---|---|---|---|
| Tempo tx/token, 0–10 s | 1,36/s | `baseLambda` 8–24/s (`tokenSim.ts:402`), tape 2–24 tx/tick (`:892-896`) → **28/s** | **za szybko ~20×** | λ_start ≈ 1–1,5/s; liczba tx w tape = wynik Poissona, nie stały split |
| Tempo 10–30 min | 0,0074/s (na launch) | **2,4/s** | **za szybko ~300×, brak wygaszania** | λ(t) ∝ (t/5 s)^−0,95 lub `attentionDecayPerSec` na realnym zegarze, half-life ~1–2 min |
| Odstępy | mediana 216 ms, 34% w tym samym slocie, CV 25,7 | mediana 23 ms, p90 234 ms, 0% równoczesnych, CV 7,2 (KS D=0,55) | **za regularne / za gęste** | kwantyzacja do slotu (~216–400 ms) + klastry (Hawkes/compound Poisson) |
| Rozmiar (σ_ln) | 2,2–2,3 (całość), 1,9–2,5 wg wieku | `tradeSigma` 0,75–1,2 (`:405`); realnie 1,23 | **za wąski** | `tradeSigma` ≈ 2,0 |
| Rozmiar mediana | 0,065–0,073 SOL (0–10 s: 0,18) | 0,096 SOL | OK/lekko za duży | mediana zależna od wieku: 0,18 → 0,05 → 0,1 SOL |
| Pył < 0,03 SOL | 35,6% | 8,7%; min clip `tradeSizeMinClipSol` 0,025–0,12 | **brak pyłu** | min clip ~0,001 SOL; dodać kubełki 0,001/0,005/0,01 |
| Ogon | Pareto α≈1,9–2,2 > ~1,25 SOL; p99,9 8,5 SOL | wieloryb ×4–18 jednorodnie (`marketModel.ts:63-66`); max 2 780 SOL | ogon nierealny | Pareto α≈2 z cap ~10–20 SOL |
| Buy share (liczba / SOL) 0–30 s | 58% / 60% | 46% / 61% | kierunek OK w SOL, liczba odwrotnie | buyBias 0,58 na start |
| Buy share po 30 s | 50–52% / **46–48%** | 45–48% / **54–60%** | **sim stale kupujący** | buyBias ~0,51 (liczba) i sprzedaże ~1,1× większe |
| Graduacja | 2,58% (organicznie 1,55%) | **38% w 30 min** | **za często ~15–25×** | cel 1,5–2,5% (lub świadomie wyższy dla gameplayu) |
| Czas do graduacji | mediana 309 s (org.), p90 58 min | mediana **5,3 s**, p90 41 s | **za szybko ~60×** | bramki wieku na zegarze realnym (`MIN_MIGRATION_AGE_SEC` jest w sim-sec: `tokenSim.ts:2500`) |
| Próg migracji | 410,9 SOL mcap (~85 SOL zebrane) | 228 SOL × $150 = $34,2k (`tokenMarketRegimes.ts:20,572`) | za nisko | ~411 SOL mcap (stałe zamrożone → wymaga decyzji, AGENTS.md) |
| Start mcap | 27,96 SOL (~$4,2k @150) | $2 000 = 13,3 SOL (`generator.ts:84`) | za nisko 2× | 27,96 SOL·SOL_PRICE |
| Peak mcap | mediana 36,4 SOL, p90 98,6 | mediana 178 SOL, p25 86 | **za wysoko ~5×** | wynika z kierunku/tempa — po poprawkach ↑ |
| Dev initial buy | mediana 0,26 SOL | mediana 0,27 SOL (`buildDevFlow`, `:1693`) | **OK** | — |
| Dev 1. sprzedaż | 90% devów; mediana 25 s, p90 376 s; 88% całość | 100% tokenów; mediana **0,4 s**, p90 1,4 s | **za wcześnie ~60×** (zegar sim) | lognormal: mediana 25 s, p25 7 s, p75 93 s (realny czas) |
| Snajperzy | blok 0 12,2% buy-SOL; 5 s 24,1%; 60 s 52,4%; 41% coinów | 1. tick 0,4%; 5 s 4,4%; 60 s 30,5% (launch tick λ×0,1×0,15, `:756,764`) | **za słabi** | z p≈0,4 burst 1–5 buyów, mediana ~3 SOL w 1. slocie |
| Po migracji | 1 157 tx / 415 SOL w 1. 5 min; −68% tx po 25 min; half-life ~25 min | 2 020 tx / 1 190 SOL; −37% tx po 25 min | za dużo, zbyt wolny spadek | λ po migracji ≈ 4 tx/s na start, half-life ~25 min |
| Umieranie | 60% martwe po 5 min, 81% po 60 min | 0% martwych po 30 min (last trade ≥ 1 778 s) | **brak śmierci** | DOA = zero przepływu po ~1–5 min (real) |
| Tx/coin | mediana 22, p90 261 | mediana 3 590 (30 min) | **~160×** | wynik λ |
| Portfele/coin | mediana 5, p90 41 | mediana 654 | **~130×** | pula portfeli cross-token, reuse |
| Struktura aktorów | ~14% portfeli botowych = 64% tx | `late_retail` 58% tx, `dip_buyers` 23%, `snipers` 0,8%, `dev` 0,7% | brak botów multi-coin | grupa „bot/rotator”: ~55–65% tx, hold ~40 s |
| Launche/min | 32,3 (17,9–56,7) | spawn co 6–12 s realnie = 5–10/min (`registry.ts:16-17`) | UI-ograniczenie, OK | zostawić; ew. skalować wg godziny |
| Sesje | max/min tx/min 2,5×; dołek 02–11 UTC, szczyt 16–21 UTC | `tempoMul` 0,62–1,42 (2,3×) (`session.ts:85-116`); EU 06–15 @UTC+2 | **zakres OK**, rozkład godzin nie | `tempoMul` z profilu godzinowego (`metrics.json → curve_trades_by_hour_utc`) |
| Nieudane tx | 69,7% prób, 96% od top-100 portfeli | brak (tylko latency usera) | n/d (spam botów) | ewentualnie tylko slippage usera (6042/6002/6003 ~7%) |

## 4. Rekomendacje (ranking)

1. **Ujednolicić zegar** (realny vs sim ×60): wszystkie bramki wieku, fate timeouts, dev warm-up, `MIN_MIGRATION_AGE_SEC`, `ageSec < 100` w `tokenActors.ts` liczyć w tym samym czasie, w którym gracz widzi wykres. To pojedyncza przyczyna kilku rozjazdów (graduacja w sekundach, dev-sell po 0,4 s).
2. **Liczba transakcji = proces punktowy**: usunąć sztywne 2–24 tx/tick z `executeMarketFlowAsTape`; λ(wiek) wg 2.2 (start ~1,4/s, spadek ~1/t), z klastrami w jednym slocie (34%).
3. **Wygaszanie i śmierć**: większość coinów ma umierać w 1–5 min (60% w 5 min); `attentionDecayPerSec` w realnym czasie, z twardym „zero flow” dla DOA.
4. **Kalibracja migracji**: cel 1,5–2,5% (decyzja produktowa, bo realny rate może być nudny), mediana ~5 min; po decyzji ownera — próg 410,9 SOL mcap / start 27,96 SOL (zmiana zamrożonych stałych wymaga notki migracyjnej).
5. **Rozmiary**: lognormal σ≈2,0 + ogon Pareto α≈2, min clip ~0,001 SOL, mediana zależna od wieku; wagi kubełków wg 2.1.
6. **Kierunek**: po 30 s buy ≈ 51% liczby, ≈ 47% SOL (lekki drenaż), na start 58–60%.
7. **Snajperzy + dev**: burst w bloku 0 (41% coinów, ~12% buy-SOL); dev-exit lognormal med. 25 s, 88% pełnego wyjścia.
8. **Aktorzy**: dodać „rotatorów/botów” cross-token (55–65% tx) i pulę portfeli współdzieloną przez tokeny.
9. **Post-migracja**: 1. 5 min ~1 150 tx/415 SOL, half-life ~25 min.
10. **Sesje**: `tempoMul` z realnego profilu godzinowego (dołek 02–11 UTC, szczyt 16–21 UTC).

## 5. Następne kroki
- Faza 3-light: skrypt kalibracyjny generujący `market-calibration.json` z `metrics.json` + walidacja KS/Wasserstein przez `sim_harness.ts` (już działa headless; obecny baseline: KS rozmiar D=0,30, odstępy D=0,55).
- Druga doba danych (inny dzień tygodnia) — pumpdata sprzedaje pełne archiwum; albo Dune trial dla agregatów 7–30 dni (godziny, graduation rate).
- Decyzje ownera: (a) realizm vs gameplay dla rate'u migracji i tempa, (b) zmiana zamrożonych stałych (`types.ts`, migracja).
- Wszystko powyżej to pomysły — **nic nie zaimplementowano**.

## Pliki
`metrics.json` (wszystkie liczby real), `sim_metrics.json` (headless sim), `compare_ks.json`, `slinky_daily.json`, `queries.sql` (całe SQL DuckDB), `build.sql`, `analysis.py`, `sim_analysis.py`, `compare.py`, `sim_harness.ts`, wykresy `01…09_*.png`.
