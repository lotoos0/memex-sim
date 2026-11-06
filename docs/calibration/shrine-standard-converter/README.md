# Shrine STANDARD converter

> **Calibration warning:** The admitted Shrine cohort is selective. Exclusions
> vary by hour, trade side, trade size, and curve stage. This cohort is **not an
> approved source for direct Engine V2 calibration**.

This offline converter audits the 01:00 and 12:00 UTC windows on 2026-10-15 against
Real C. It uses the local Shrine files for each hour and its following hour, then
applies a half-open window to the source block timestamp. The published
[Shrine source gate](../shrine-source-gate.md)
defines the windows and remains `INCONCLUSIVE`. See [quality report](quality-report.md)
for the measured coverage and selection bias.

## Reproduce

Use Node 22.18 or newer and the existing DuckDB CLI 2.0.0. From the repository root
with the original local inputs present, run these PowerShell commands. From a
separate checkout, use absolute paths to the existing inputs and a fresh local
output directory instead.

```powershell
node --test docs/calibration/shrine-standard-converter/converter.test.mjs
node docs/calibration/shrine-standard-converter/run.mjs `
  output/shrine-gate/raw output/sim01-pr3 `
  output/sim01-pr3/tools/duckdb.exe output/shrine-converter-run
```

The converter checks all seven Real C files against the [source manifest](../sim01/real-market/sources.json)
and records the Shrine input sizes and SHA-256 hashes. It reads the four existing
`.jsonl.zst` files directly. The converter requires a new output directory and
never updates an input or a source database. `quality.json` is emitted after both
windows finish. If a run fails, use a new directory for a retry.

## Output contract

| File | Contents |
| --- | --- |
| `HH-trades.jsonl` | One admitted swap per signature. `ts` is Unix seconds, `slot` is the block slot, and `wallet` is the leg trader. `sol` is the fee-exclusive executed quote in lamports, `tokens` is the executed amount in token atoms, and `r1`/`r2` are the post-swap virtual SOL/token reserves. `preSol`/`preTokens` reverse the signed swap deltas from the post-state. All six atomic fields are decimal strings. |
| `HH-rejected.jsonl` | One row per excluded Shrine record, with signature, source position, reason, breakdown leg count and available candidate keys and amounts. These fields are diagnostic. |
| `HH-events.jsonl` | Shrine's explicit `complete` observations and SOL-paired PumpSwap `pool` candidates for observed STANDARD mints. |
| `quality.json` | Per-hour input fingerprints, protocol/action counts, exclusions, transaction and swap counts, SOL volumes, reserve and stage agreement, ordering, lifecycle and bias strata. Atomic values and totals are decimal strings. |

STANDARD means SOL-quoted `PUMPFUN` on a mint with no `PUMPFUN_MAYHEM` record in
either input file for that window. A mixed-label mint goes to the MAYHEM cohort.
Other protocols, quotes and non-swap actions have separate counts. The converter
admits one BUY or SELL leg with matching action, known trader, exact atomic
amounts, positive token movement and positive observed and reversed reserves.
A reported zero-lamport dust swap can move tokens. Amounts come from
the leg and post-swap reserves from the record. A malformed or fractional atomic
value is excluded. Every multi-leg record and repeated in-scope signature is
quarantined together with its diagnostic legs.

Within a mint, slots supply chronological order. Within a mint and slot,
`orderInSlot` is a zero-based rank only when the observed trades form a single
exact chain in both virtual reserves and the group has no rejected neighbor.
Otherwise the rank is `null` and `orderStatus` records the reason. File and line
identify provenance. The order of JSONL records carries no execution semantics.

The [Real C benchmark](../sim01/real-market/README.md) bands are 0–80%, 80–90% and
90–100%, measured using the virtual token reserve and initial real token reserve.
The pre-swap stage owns the trade, and both pre/post stages are exported. The
comparison population follows the source gate's two hourly SOL curve windows,
with separate counts for Real C mints unlabelled by Shrine. The historical
benchmark additionally filters launch-age follow-up, K compatibility and instant
completions. Its curve-only accounting deducts the graduation pool leg when
present. `realPoolSplitBasis` reports that deduction separately from raw source
parity. The converter produces hourly source comparisons under these definitions.

An exact pair is unique on both sides by slot, mint, trader, side, lamports and
token atoms and has no competing exact candidate among excluded legs.
Timestamps, reserves and stages are checked after matching. Weak
keys drop amounts and can identify candidate coverage gaps. Real C has no Shrine
signature, so counts use distinct `(slot, idx)` in Real C and signatures in
Shrine. Real C lifecycle `complete` matches on mint, slot and timestamp. A Real C
`migrate` event additionally requires the same pool address on a Shrine PumpSwap
pool creation. Unpaired creations stay pool candidates.
