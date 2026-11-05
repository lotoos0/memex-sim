# P1 conditional activity: preregistered experiment

Approved scope: one change to pre-migration organic arrival intensity. A is main
`4b976ad94dfe04429ec3e51af188f87dec06b461`; B replaces the last-print 18% excitement
with an executed-print exponential memory. No curve-progress/readiness trigger.

Parameters fixed before the full run: 8s exponential time constant, +0.075 trades/s
per executed print, state capped at +2 trades/s, and the extra rate capped at five
times the current organic rate (total at most six times organic). Isolated uncapped
kernel mass is 0.6; this is not a stability proof for the entire interacting engine.
Both BUY and SELL contribute equally; quote size is not an excitation weight.
Queries use simulation milliseconds and the previously committed tick only. Pending
prints commit at tick end, including actual developer/user fills. Rejected orders and
genesis do not contribute. Stillborn, silence, collapse and DEAD cannot receive the
extra rate. Existing finish-stretch floor and post-migration last-print rule remain.

Primary run: six seeds SIM01-A through SIM01-F, 1000 fresh launches/seed, 1800s
launch-age horizon, 200ms ticks, 2026-10-15 at alternating 08Z/19Z. No parameter
search or compensating changes. Paired initial token ids/fates/stillborn draws remain
identical; subsequent RNG paths may diverge when arrival counts differ.

Keep all-cohort, first80, start-of-tick readiness groups and reference-compatible
native/event metrics separate. Report A-defined first80/ready membership as well as
each variant's endogenous membership. Bootstrap is a separate diagnostic cohort.
Distribution definitions fixed before running: high activity >=2 prints in a unique
1s exposed bin; burst = contiguous high-activity bins; silence = contiguous zero-print
bins. Include edge-clipped runs, report peak prints/bin, run lengths and token share
ever high; do not optimize toward 2.111 trades/s. Price and quote definitions inherit
the persistent benchmark. Aggregate rate increases alone cannot establish realism.

Validate exact repeated-run determinism and fixed-event kernel invariance under time
partition; independently compare whole-engine 100/200/1000ms runs (the existing
tick-driven RNG/regime model is not assumed path invariant). Check memory saturation,
decay, no look-ahead, end-tick commits, no revival and production financial contracts.
