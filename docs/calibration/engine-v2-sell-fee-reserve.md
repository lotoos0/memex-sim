# Engine V2 SELL fee reserve experiment

The opt-in `sellFeeReserve: true` protects `1000 × BASE_FEE` (5,000,000 lamports,
0.005 SOL) from agent BUYs. It uses existing SOL. The usual side selection runs
first, and a BUY with no positive spendable amount returns WAIT. SELL still uses
the ordinary up-front fee, including when it draws down the protected amount.
OFF omits the flag from serialized configuration. ON includes it in the world
configuration and manifest hash checked during restore and replay.

## Result

The reserve prevented the observed early stall in all six worlds within the
90-minute test. All ON runs still executed trades in the final 28 seconds. The
horizon leaves persistence beyond 90 minutes unmeasured. ON reduced SELL
admission failures for insufficient funds from 344,906 to zero. It also moved
market activity farther from Real C on several dimensions, including early
intensity, late trade share and BUY share. No ON curve completed.

| Seed | Last swap OFF | Last swap ON |
| --- | ---: | ---: |
| A | 25:16.272 | 89:56.805 |
| B | 15:27.668 | 89:58.537 |
| C | 17:07.663 | 89:32.018 |
| D | 24:47.945 | 89:51.857 |
| E | 19:26.649 | 89:55.334 |
| F | 22:39.250 | 89:53.654 |

| Common pre-completion curve metric | Real C | OFF | ON |
| --- | ---: | ---: | ---: |
| Active non-instant paths | 20,278 | 188 | 645 |
| Executed BUY / SELL | 1,102,824 / 956,121 | 91,548 / 62,946 | 1,631,867 / 2,242,243 |
| BUY / SELL fee-exclusive quote (SOL) | 465,226.32 / 438,051.34 | 71,777.42 / 66,896.27 | 262,191.28 / 261,831.56 |
| BUY share by trade count | 53.56% | 59.26% | 42.12% |
| BUY share by SOL volume | 51.50% | 51.76% | 50.03% |
| Trades at token age 600–1,799 s | 251,092 (12.20%) | 374 (0.24%) | 1,503,112 (38.80%) |
| First 120 s, trades per exposed token-second | 0.469 | 4.023 | 7.379 |
| Curve completions per active non-instant path | 203 / 20,278 (1.00%) | 23 / 188 (12.23%) | 0 / 645 (0.00%) |

At the world level, OFF recorded 110,944 BUY and 82,685 SELL fills across curve
and pool, while ON recorded 1,688,747 BUY and 2,335,323 SELL fills, all on the
curve. In the common horizon, average quote per swap fell from 0.898 SOL to
0.135 SOL, versus 0.439 SOL in Real C. Longer activity came with substantially
more, smaller prints and with a lower completion rate than the reference.

| Rejection stage, side and reason | OFF | ON |
| --- | ---: | ---: |
| SELL admission `INSUFFICIENT_FUNDS` | 344,906 | 0 |
| SELL execution `SLIPPAGE` | 7,168 | 43,773 |
| SELL execution `DUST_OR_LIQUIDITY` | 0 | 11,198 |
| BUY execution `SLIPPAGE` | 12,609 | 48,057 |
| BUY execution `DUST_OR_LIQUIDITY` | 0 | 6 |

One ON SELL remained queued at the 90-minute boundary. It is counted separately
from fills and rejections. Real C contains no comparable intent or rejection data.

| Simulated minute | Agent SOL available, OFF | Agent SOL available, ON |
| ---: | ---: | ---: |
| 0 | 6,975.000 | 6,975.000 |
| 5 | 1,980.192 | 1,571.381 |
| 10 | 249.285 | 95.075 |
| 15 | 51.226 | 28.345 |
| 20 | 22.444 | 9.252 |
| 30 | 0.000 | 4.526 |
| 45 | 0.000 | 3.007 |
| 60 | 0.000 | 2.916 |
| 90 | 0.000 | 2.909 |

The protected amount is a BUY policy limit. Reserved SOL in the experiment
output means actual order escrow. At 90 minutes the ON escrow contained only
the 5,000-lamport fee for the pending SELL.

## Measurement

Use the local Real C vs V2 baseline directory containing `v2-runs.json` and
`metrics.json`. Run from the repository root with the existing dependencies.
Pass a fresh output directory. The optional final argument runs one seed and
writes its own JSON result, so independent seeds can run in parallel.

```powershell
node scripts/qa/engine-v2-sell-fee-reserve.mjs `
  output/engine-v2-real-c-baseline output/engine-v2-sell-fee-reserve-reproduction
```

The existing Engine V2 pilot harness runs the same six seeds (`V2-PILOT-A`–`F`),
Social ON, 100 agents per world, and 90 simulated minutes. Both modes use the
same per-seed baseline listing schedule. The harness consumes committed facts
in 30-second batches and uses the existing recorded-history pruning path. The
experiment verifies the OFF manifests, six compact tape SHA-256 values and
benchmark summaries against the saved baseline. It repeats the full ON run for
seed A and checks the tape hashes, manifest, counters and snapshots. A separate
QA fixture checks ON checkpoint restore and deterministic replay. Ledger
conservation is checked at all sampled times and at the end of each run.
The output records per-seed manifest and tape hashes, exact SOL balances in
lamports, rejection reasons and the Real C reference fingerprint. Run the
fixture with `npm run qa:engine-v2`.

The Real C comparison uses the same eligible STANDARD-compatible cohort and
sub-1,800-second curve horizon as the saved baseline, with known MAYHEM excluded.
Age 0–119 seconds intensity uses exposed token-seconds, including empty seconds.
Age 600–1,799 seconds is a share of all eligible curve swaps. Completion rate
uses active non-instant paths. The world-level last swap and execution totals
also include pool fills, so they use a different denominator.
