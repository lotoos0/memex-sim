# Shrine STANDARD multi-leg recovery

Measured on the existing 2026-10-15 inputs at 01:00–02:00 and 12:00–13:00 UTC.
The [README command](README.md#reproduce) reproduces the original single-leg
baseline and the separate recovery cohort from the same four Shrine files.
The recovery pass runs before Real C validation. The source gate remains
`INCONCLUSIVE` under its original criteria.

## Evidence and exclusions

Each recovered record has a single complete reserve chain for its mint and slot,
including every admitted single-leg swap in the group and exactly one of its two
legs. The preceding swap's post-state and following swap's pre-state establish
the recovered reserves and both signed atomic deltas. The two anchors come from
different original Shrine records. Every recovered source record reported zero
for its own post reserves, so the recorded zeros contributed no evidence.

| Outcome for originally rejected two-leg records | 01:00 UTC | 12:00 UTC |
| --- | ---: | ---: |
| Total examined | 3,004 | 4,534 |
| Recovered | 283 | 372 |
| Another rejected record in the group | 857 | 1,606 |
| Other PUMPFUN source record in the group | 143 | 93 |
| Fewer than two confirming swaps available | 1,457 | 2,019 |
| More than one exact chain or leg identity | 256 | 406 |
| Unsupported leg shape | 1 | 30 |
| Search bound reached | 7 | 8 |

All 655 recovered records selected the first listed leg. Leg position played no
role in the decision. For all 502 recovered BUYs, the other leg had at least as
much SOL and fewer tokens. In 343 cases its SOL was within one lamport of the
executed quote multiplied by 1.0125. For all 153 recovered SELLs, the other leg
had the same token amount and at most as much SOL. That pattern is consistent
with instruction limits and gross BUY amounts. The available records cannot
establish the origin or meaning of every unselected leg. In particular, all 628
twelve-leg records at 12:00 remain outside recovery.

## Comparison with Real C

Coverage below is the share of Real C swap rows or fee-exclusive raw SOL with a
unique exact pair. Stage is assigned from the pre-swap token reserve. The
before column uses the single-leg baseline, and the after column adds only
proven recovery records.

| Measure | 01:00 before → after | 12:00 before → after |
| --- | ---: | ---: |
| Exact swap pairs | 79,846 → 80,129 | 84,971 → 85,343 |
| BUY row coverage | 95.163% → 95.630% | 93.489% → 94.060% |
| SELL row coverage | 96.891% → 97.082% | 78.680% → 78.849% |
| Total SOL coverage | 93.643% → 94.295% | 87.741% → 88.216% |
| BUY SOL coverage | 92.002% → 92.922% | 90.181% → 90.962% |
| SELL SOL coverage | 95.547% → 95.889% | 85.149% → 85.298% |
| 0–80% stage row coverage | 95.345% → 95.709% | 84.754% → 85.156% |
| 80–90% stage row coverage | 98.412% → 98.661% | 96.568% → 96.849% |
| 90–100% stage row coverage | 98.529% → 98.757% | 98.153% → 98.286% |
| BUY share among exact pairs | 53.596% → 53.668% | 56.199% → 56.296% |
| BUY share in all Real C swap rows | 54.043% | 51.919% |

The 01:00 recovery added 210 BUYs and 73 SELLs, representing 272.956359 SOL.
The 12:00 recovery added 292 BUYs and 80 SELLs, representing 180.579240 SOL.
Real C independently matched the fee-exclusive quote, token amount, both post
reserves and both curve stages for all 655 recovered swaps. All fully paired
ordered groups in the combined cohort agreed with Real C order. Baseline
trade, rejection and event files matched the original run byte for byte.

At 12:00 the BUY share moves farther from Real C even though both sides gain
coverage. The exact cohort still underrepresents early SELLs and remains
selective. The two observed windows leave coverage on other dates and events
missed by both sources unresolved. The combined cohort is **not an approved
source for direct Engine V2 calibration**.
