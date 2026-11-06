# Shrine STANDARD quality on Real C

Measured on 2026-10-15, 01:00–02:00 and 12:00–13:00 UTC. Each window uses the
two local Shrine files specified by the source gate and the checksum-pinned Real
C Parquets. The [reproduction command](README.md#reproduce) regenerates the
per-window `quality.json`, including source SHA-256 hashes and all denominators.

## Coverage and parity

| Measure | 01:00 UTC | 12:00 UTC |
| --- | ---: | ---: |
| Real C curve swap rows | 83,210 | 98,382 |
| Real C distinct transactions in scope (`slot`, `idx`) | 82,933 | 90,449 |
| Shrine admitted swaps / distinct signatures | 79,846 | 84,996 |
| Shrine excluded records / distinct signatures | 3,090 / 3,066 | 5,479 / 5,425 |
| Excluded share of Shrine in-scope records / breakdown legs | 3.73% / 7.22% | 6.06% / 17.34% |
| Real C rows with an exact unique pair | 79,846 (95.96%) | 84,971 (86.37%) |
| Real C transactions with at least one exact unique pair | 79,846 (96.28%) | 84,971 (93.94%) |
| Real C raw net quote / Shrine admitted net quote (SOL) | 41,838.07 / 39,178.34 | 38,045.50 / 33,386.80 |
| Real C net quote represented by exact pairs | 93.64% | 87.74% |
| Exact pairs agreeing on both post-swap reserves | 79,846 / 79,846 | 84,971 / 84,971 |
| Exact pairs agreeing on both pre- and post-swap stage | 79,846 / 79,846 | 84,971 / 84,971 |
| Resolved multi-swap groups agreeing with Real C, among fully paired groups | 13,574 / 13,574 | 13,679 / 13,679 |
| Real C completion events matched within observed STANDARD mints | 37 / 37 | 13 / 13 |
| Real C migration events matched to a Shrine pool within observed STANDARD mints | 37 / 37 | 13 / 13 |

At 01:00 there were 81 exact pairs in which the Shrine timestamp was one second
earlier and 13 in which it was two seconds earlier. At 12:00 there were 79 pairs
one second earlier. The normalized tape preserves Shrine's timestamp. This can
affect second-resolution candle or arrival metrics even for exact pairs.

The Real C hourly comparator uses raw source quote. The historical benchmark
deducts a linked graduation pool leg, which accounts for 33.295395694 SOL across
17 rows at 01:00 and 7.768486613 SOL across six rows at 12:00. None of those rows
had an exact admitted pair. Lifecycle evidence is independent of swap admission.
There were 30 and 32 Real C lifecycle records outside the observed STANDARD mint
cohort respectively. The lifecycle denominator is events within each window.

## Selection bias

Each cell is the share of Real C swap rows / raw fee-exclusive SOL represented
by unique exact pairs, using Real C's side, pre-swap stage and trade size.

| Real C stratum | 01:00 UTC | 12:00 UTC |
| --- | ---: | ---: |
| BUY | 95.16% / 92.00% | 93.49% / 90.18% |
| SELL | 96.89% / 95.55% | 78.68% / 85.15% |
| 0–80% progress | 95.34% / 92.95% | 84.75% / 86.70% |
| 0–80% progress, SELL | 96.53% / 94.75% | 76.29% / 83.47% |
| 80–90% progress | 98.41% / 96.75% | 96.57% / 94.61% |
| 90–100% progress | 98.53% / 96.31% | 98.15% / 94.92% |
| Below 0.01 SOL | 95.64% / 97.00% | 78.46% / 76.66% |
| At least 1 SOL | 93.15% / 91.43% | 85.69% / 84.90% |

At 12:00, the BUY share by swap count rises from 51.92% in Real C to 56.20% in
the exact cohort. At 01:00 it falls from 54.04% to 53.60%. Early SELLs and small
swaps are especially underrepresented at 12:00. One overall coverage correction
would preserve these differences. Trade intensity, side mix and size
distributions measured from the admitted rows are conditional on admission.
Within-slot gaps also constrain sequence measures such as streaks and reversals.

| Real C outcome without a unique admitted pair | 01:00 UTC | 12:00 UTC |
| --- | ---: | ---: |
| Exact candidate only among excluded legs | 3,309 | 9,376 |
| Weak candidate only among excluded legs | 33 | 3,976 |
| Retained weak candidate only | 1 | 8 |
| Ambiguous exact identity | 0 | 17 |
| No candidate | 21 | 34 |

Candidates provide evidence about which records drive the losses. A weak key
does not establish that a leg executed, and the normalized volumes exclude all
quarantined candidates. The two windows cannot detect events missed by both
sources or establish that the observed coverage generalizes to another date.
The previous source gate remains `INCONCLUSIVE` under its original criteria.
