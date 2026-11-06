# P1c frozen experiment

A is main 4b976ad94dfe04429ec3e51af188f87dec06b461. B changes organic arrival intensity only.
Observe 12 completed 5 s bins, require two BUY and two SELL bins, use clamp((active - 3)/5) and a 60 s decay constant. Preserve the first 60 s. Reserve 20% times (1 - 0.5C) of reference intensity. Release at most 0.20/s times clamp((C - 0.4)/0.6), credit/60 s and prior credit per tick. Cap stock at 12 and expire oldest lots 120 s after the start of their deposit bucket. Use existing protected lifecycle branches. The 12 SOL guard is absent.

Pilot 600 paired births, then six SIM01-A..F seeds with 1000 paired births each, 200 ms ticks and 1800 s horizon. Repeat full arms exactly. No parameter search. Use the PR73 Real reference and P1b cohort definitions.

Success requires top 5% quote share +3 pp with an increase in leader activity, p99 trades/token +10%, and participating 120–600 s intensity +15%, supported across seeds. Reject if all-cohort trades or gross SOL move by more than 10%, migration by more than 0.5 pp or 25% relative, net/gross by more than 3 pp, or if lifecycle/contract regressions occur. Performance budget 10% per simulated token-second. Report inconclusive when coverage or robustness is insufficient.
