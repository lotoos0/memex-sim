# EXIT fallthrough (opt-in): Opportunity Selection vs Position Management

**Verdict: KEEP as an opt-in experimental variant. It is not a calibration fix.** The mechanism does what it was built to do: the exit-memory BUY displacement is removed (73,784 → 0 pooled), outside-`known` SELL access is intact, nothing is forced, and BOUNDED/EXIT_ONLY are untouched. It also makes the market *busier* and *more cash-hungry* than EXIT_ONLY while Real C is far quieter, so it must not be read as moving the model toward Real C.

## What changed

`exitFallthrough` (requires `tokenExitOnly`, which requires BOUNDED + SELL fee reserve). In `decideTrade()` the contest, scoring, 45% gate, `sellBias`, SELL sizing and BUY sizing are unchanged. Only the resolution after an **exit-only winner** differs:

1. `cash <= 0` → SELL (unchanged). Otherwise SELL with the existing `sellBias` draw (unchanged).
2. If that draw does not SELL, the decision **falls through to BUY the best-scoring known candidate of the same contest** (tracked while scoring; no extra selection draw, no second `sellBias` draw, no forced SELL). Previously this was a WAIT.
3. No known candidate, or no spendable budget after the SELL reserve → WAIT. The budget check happens *before* the size draw, so an unfunded fallthrough consumes no RNG and is indistinguishable from EXIT_ONLY.

Files: `src/engineV2/agents.ts` (one parameter, `fallback` tracking, guard), `src/engineV2/world.ts` (flag, validation, manifest policy `exit: position-exit-fallthrough-1`, pass-through), `src/qa/engineV2Benchmark.ts` (option), `src/qa/engineV2Qa.ts` (gate), `scripts/qa/engine-v2-interest-a1*.mjs` (`--fallthrough` mode on the existing harness). Missing flags are omitted from serialization; BOUNDED/EXIT_ONLY/LEASE_ONLY/A1 configs, manifests and state layout are unchanged.

## Pre-commit acceptance checks (all passed, 6/6 seeds)

| Check | Result |
|---|---|
| Exit-choice reconciliation `selected:EXIT = SELL + WAIT + fallthrough BUY` | 206,739 = 81,578 + 68,025 + 57,136, asserted per run |
| Fallthrough reconciliation | 125,161 fallthrough decisions = 57,136 BUY + 68,025 WAIT; 57,136 BUY intents = 57,099 fills + 36 execution rejects + 0 admission rejects + 1 pending |
| WAIT with a usable alternative BUY after an exit-only choice | 73,784 (EXIT_ONLY) → **0** |
| Behavioral prefix vs EXIT_ONLY | The per-decision tape `(time, agent, ordinal, WAIT/TRADE/LAUNCH, token, side, size)` is identical until the first fallthrough that changes an outcome, and diverges **exactly** at that decision, in every seed (decision index 22,283–29,289; first change at 528–686 s). The trade-row tape (fact ids normalised, since they embed the config hash by design) first differs 350 ms later (the execution latency), never before. |
| Existing hashes | BOUNDED and EXIT_ONLY re-run match the committed manifests, `tapeSha256` and `fullTapeSha256` for all six seeds. `npm run qa:engine-v2` still prints `f8092dfbdd7be89f` / `edd06a22c30a0ffe`. |
| Scheduler | Periodic executions 462,254 in all cells; minimum decision gap 2,000 ms; reactive executions differ only through information flow (924,459 vs 924,454 for EXIT_ONLY) |

## Method

V2-PILOT-A–F, 90 simulated minutes, original 100 agents, BOUNDED scheduler, SELL fee reserve ON, no rotation, no parameter change. Same population definition as the A1 doc: 646 launches / 646 paths / 1,161,188 exposed seconds in every cell. Real C is descriptive only and was not regenerated.

**Data availability.** The local reference outputs the original harness needs (`output/engine-v2-real-c-baseline`, SELL-reserve, BOUNDED, persistence-audit and A1 summaries) do not exist in either checkout (`output/` is gitignored; `output/engine-v2` is an unrelated worktree). `--fallthrough` therefore anchors to the committed compact results and takes Real C's descriptive aggregates from that file's `real` block, read-only. The legacy OFF/CONTROL regressions against the missing references could **not** be re-checked here.

## Results (pooled over six seeds)

| Metric | BOUNDED | EXIT_ONLY | EXIT_FALLTHROUGH | Real C (descriptive) |
|---|---:|---:|---:|---:|
| Common swaps | 342,586 | 381,895 | 410,290 | n/a |
| BUY / SELL | 171,389 / 171,197 | 190,646 / 191,249 | 214,688 / 195,602 | n/a |
| BUY count share | 50.03% | 49.92% | 52.33% | 53.56% |
| BUY SOL / SELL SOL | 71,385 / 65,831 | 106,296 / 100,590 | 111,026 / 105,008 | n/a |
| First-120s swaps / exposed s | 0.6437 | 0.6601 | 0.6866 | 0.4693 |
| Swaps / active second | 1.349 | 1.313 | 1.319 | 3.055 |
| Empty token-seconds | 78.13% | 74.95% | 73.21% | 98.14% |
| Empty 5 s / 10 s windows | 45.25 / 35.01% | 32.91 / 17.01% | 30.64 / 15.77% | 95.77 / 94.21% |
| Active-series p50/p90/p99 s | 1/3/7 | 1/3/6 | 1/3/6 | 1/4/18 |
| Internal-gap p50/p90/p99 s | 2/8/25 | 3/10/33 | 2/9/32 | 3/44/604 |
| Paths with ≥300 s terminal silence | 46.44% | 0.00% | 0.00% | 91.82% |
| Size SOL p50 / p90 / p99 | .1583 / 1.144 / 2.689 | .3591 / 1.284 / 2.833 | .3321 / 1.270 / 2.845 | .1615 (median) |
| Reach 80% / 90% / complete | 86 / 22 / 1 | 83 / 23 / 1 | 87 / 23 / 1 | 3.38% / n/a / 1.00% |
| Full position exits (all / exit-origin) | 54,787 / 0 | 66,026 / 20,100 | 67,196 / 20,470 | n/a |
| DUST_OR_LIQUIDITY rejects | 3 | 63 | 27 | n/a |

Reach-80% as a share of 646 paths: 13.31% / 12.85% / 13.47%. One completion per cell cannot support any completion-rate claim.

### BUY / SELL count and SOL by token age

| Age min | BOUNDED count | EXIT_ONLY count | FALLTHROUGH count | BOUNDED SOL | EXIT_ONLY SOL | FALLTHROUGH SOL |
|---|---:|---:|---:|---:|---:|---:|
| 0–2 | 35,124 / 14,777 | 37,146 / 14,024 | 39,027 / 14,200 | 20,521 / 12,126 | 23,932 / 12,629 | 24,169 / 12,625 |
| 2–10 | 69,274 / 65,229 | 74,852 / 64,467 | 82,691 / 66,210 | 34,289 / 34,697 | 44,129 / 43,087 | 45,464 / 44,337 |
| 10–20 | 41,114 / 53,379 | 47,224 / 62,649 | 56,171 / 64,419 | 12,655 / 14,429 | 23,692 / 27,726 | 25,889 / 29,952 |
| 20–30 | 25,877 / 37,812 | 31,424 / 50,109 | 36,799 / 50,773 | 3,920 / 4,579 | 14,544 / 17,148 | 15,504 / 18,095 |

(BUY / SELL in each cell.)

### Fallthrough decisions and fills

| | Pooled |
|---|---:|
| Exit-only selections | 206,739 (SELL 81,578; WAIT 68,025; BUY 57,136) |
| Fallthrough BUY intents → executed BUY fills | 57,136 → 57,099 (+36 execution rejects, +1 pending at cutoff) |
| Fallthrough BUY volume | 23,088 SOL (ex fees) |
| Fill age at 0–2 / 2–10 / 10–20 / ≥20 min | 4,696 / 16,329 / 15,915 / 20,159 |
| WAIT remaining on the fallthrough path | 68,025, all `BUY_BUDGET` (no spendable cash), none with an eligible alternative BUY |
| Per-seed fallthrough fills | 9,160 / 9,470 / 9,336 / 9,737 / 10,278 / 9,118 |

63% of fallthrough BUY fills hit tokens older than 10 minutes, because the known set keeps old tokens. The upper bound estimated before implementation (73,784) was an overestimate; realised conversion was 57,136.

### Cash and stranded positions

| Sim minute | BOUNDED | EXIT_ONLY | FALLTHROUGH |
|---|---:|---:|---:|
| 10 | 2,102 | 2,101 | 2,098 |
| 30 | 132 | 623 | 376 |
| 60 | 10 | 382 | 180 |
| 90 | 9 | 412 | 300 |

Available SOL summed over the 600 agent accounts of the six seeds (as in the A1 doc; conservation is asserted at every sample). Open positions / outside `known` at 90 min: BOUNDED 25,347 / 18,163; EXIT_ONLY 9,373 / 1,399; FALLTHROUGH 9,445 / 1,430. The new variant spends the cash EXIT_ONLY released.

### Per-seed change, FALLTHROUGH − EXIT_ONLY

| Seed | Swaps | BUY | SELL | Cash at 90 min (SOL) | First-120s rate | Fallthrough fills |
|---|---:|---:|---:|---:|---:|---:|
| A | +5,122 | +4,299 | +823 | −7.4 | +0.033 | 9,160 |
| B | +4,394 | +3,650 | +744 | −29.2 | +0.036 | 9,470 |
| C | +4,646 | +4,006 | +640 | −17.6 | +0.026 | 9,336 |
| D | +4,640 | +4,014 | +626 | −22.4 | +0.022 | 9,737 |
| E | +4,215 | +3,936 | +279 | −24.6 | +0.018 | 10,278 |
| F | +5,378 | +4,137 | +1,241 | −10.8 | +0.025 | 9,118 |

The sign is identical in all six seeds for swaps, BUY, SELL, early rate (positive) and end cash (negative). Reach-80% changes by 0, 0, 0, +2, +2, 0 (not a stable effect). Full per-seed values for 28 metrics, including BOUNDED contrasts, are in the results JSON. As before, these are model-system effects of six deterministic seeds, not significance tests.

## Does fallthrough change narrative-pressure scoring?

**No, in these worlds.** Exit-only candidates remain in the shared scoring pool and in the narrative counts, so in principle they could dilute `pressure`. Measured on every decision that had an exit-only candidate (635,358 with fallthrough, 636,820 with EXIT_ONLY), a counterfactual with known-only counts found **no decision in which any candidate had a nonzero narrative pressure term**, hence zero changed scores, zero changed best-known candidates and zero changed fallthrough targets. Exit-only tokens shared a narrative with a known token in 121,271 decisions, but the interest term was already 0 there (attention minus fatigue minus elapsed seconds has decayed). The scoring is therefore `draw(60)` alone in this regime. This is a statement about this regime and these seeds, not a proof for other social settings; the diagnostic counter stays in the harness.

## Interpretation and limits

* **Achieved:** zero displacement; outside-`known` SELL preserved (exit-origin SELL fills and full exits roughly unchanged); known-token BUY increased in every seed; no extra decisions, scheduler untouched.
* **Not achieved / worse against Real C:** intensity (first 120 s 0.687 vs 0.469), empty-second share (73% vs 98%) and per-trade size (median 0.332 vs 0.161 SOL) move *away* from Real C, as EXIT_ONLY already had. BUY share moves toward Real C (52.3% vs 53.6%) but that is one marginal.
* **Cost:** 63% of the new BUYs are late-token BUYs, ending cash is 27% lower than EXIT_ONLY, and total BUY is +12.6% over EXIT_ONLY (+25% over BOUNDED). A calibration decision about the late-age BUY mass belongs to the separate A2 interest-decay experiment, which this change deliberately does not preempt.
* This is not a replacement of BOUNDED and changes no default; flag off is byte-for-byte the previous behavior.

## Validation

Checks run: `npm run qa:engine-v2` (new `exitFallthroughGate`: SELL kept, fallthrough BUY target and evidence, one size draw, flag-off WAIT, no-known WAIT, unfunded fallthrough without a size draw, known winner unchanged, flag-requires-exit validation, checkpoint restore and deterministic rerun); `npm run build`; `npm run lint` (0 errors, existing warnings). Eighteen uninstrumented repeats (3 cells × 6 seeds) match both tape hashes, manifests and all summaries. No browser QA and no remote CI were run; V1/UI are unchanged.

## Reproduction (PowerShell, from the repository root)

```powershell
foreach ($letter in @('A','B','C','D','E','F')) {
  node --max-old-space-size=1800 scripts/qa/engine-v2-interest-a1.mjs x output/engine-v2-fallthrough "V2-PILOT-$letter" --fallthrough
  if ($LASTEXITCODE -ne 0) { throw "Failed seed $letter" }
}
node --max-old-space-size=1800 scripts/qa/engine-v2-interest-a1-summary.mjs output/engine-v2-fallthrough --fallthrough
```

The first positional argument is unused in this mode. Outputs refuse overwriting; use a fresh directory. Compact results: [engine-v2-exit-fallthrough-results.json](engine-v2-exit-fallthrough-results.json). Source fingerprints and tape hashes per cell/seed are in that file.
