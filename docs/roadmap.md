# Implementation status and roadmap

Status reflects source at `cf775f0` (main after PR #41). See the [architecture](architecture.md) for implementation details and limitations, and the [historical plan](archive/Plan.md) for the original rationale and proposals.

## Status definitions

- **IMPLEMENTED:** connected in current source. This does not assert exhaustive testing or production readiness.
- **PARTIAL:** working functionality exists, with the listed missing behavior or limitations.
- **PLANNED:** an unimplemented historical product intention or proposal retained for discussion. It is not implementation approval, a delivery commitment, or an approved technical design.

All future implementation needs a separately scoped task and the [approved AI workflow](ai-workflow.md). Agent and simulation safety rules remain in [AGENTS.md](../AGENTS.md). This documentation cleanup approves no feature, dependency, provider abstraction, code removal, or architecture change.

## Current simulation

| Area | Status | Current implementation and boundary |
| --- | --- | --- |
| Simulation mode | IMPLEMENTED | Registry/TokenSim synthetic market, actors, regimes, sessions and token generation. No real wallet, blockchain or live feed. |
| Pulse | IMPLEMENTED | Three columns, dense/comfortable layout, filters, sorts, favorites, card news and quick buy. Actual bucket definitions differ from the old five-per-column plan. |
| Token charts | IMPLEMENTED | Price/mcap, 1s/15s/30s/1m (default 1s), migration/dev/user markers and average-price lines. Sparse candles, not continuous gap filling. |
| Quick trading | IMPLEMENTED | tokenId-keyed buy/sell, pending execution, position accounting and histories. Simulated latency/slippage and fake wallet. |
| Limit orders | PARTIAL | Placement, reservations, triggering, cancellation, audit and execution history exist. Repricing, expiry and advanced policies are absent; triggering does not guarantee the limit fill price. |
| Token lifecycle and retention | PARTIAL | Bonding progress, migration and floor/DEAD handling exist. Historical RUGGED display duration and automatic dead-token eviction do not. |
| News and feed | IMPLEMENTED | Synthetic event-driven posts/authors and local user posts. No external news integration. |
| Token-page panels | PARTIAL | Trades, Feed, Positions, Orders, Holders, Top Traders, floating instant trade and trades table exist. Dev Tokens remains a placeholder. |
| Presets/settings | PARTIAL | Component state/localStorage settings exist. RPC/MEV/auto-fee/max-fee controls have no execution effect. No separate presetStore/uiStore modules. |
| Navigation | PARTIAL | Pulse and TokenPage are routed. Other decorative header labels are not implemented pages. |
| Persistence | PARTIAL | UI preferences and favorites persist. Quick orders, wallet, positions and simulations do not survive reload. Legacy IndexedDB journal is not Replay storage. |
| QA | PARTIAL | Type/build gates and two focused browser scenarios exist. Coverage and reproducibility gaps remain; CI does not run lint. |

Source entry points for these rows are linked from [architecture](architecture.md), including its [QA section](architecture.md#qa-coverage-and-limitations). Status is based on code, not the historical plan's checkboxes.

## Historical intentions awaiting separate approval

| Intention | Status | What remains undecided or unimplemented |
| --- | --- | --- |
| Replay | PLANNED | Historical idea: record/load a run, replay it, scrub a timeline and support export. No recorder/player, timeline controls, storage format or provider contract is implemented or approved by this document. |
| Optional Live paper-trading | PLANNED | Historical long-term idea, following simulation/Replay. No feed, provider, API selection or implementation approval. Existing simulation-only restrictions remain in force. |
| Lifecycle animations and sound | PLANNED | Historical ideas include appearance/rug/migration animation and fill/event sounds. The proposed animation/audio libraries are not approved dependency additions or a committed design. |

The old plan's provider interface, named component tree, standalone stores and rewrite checklist are historical proposals, not prerequisites for current feature work. They remain preserved in the archive rather than promoted into new architecture decisions.

## Existing decisions and historical differences

| Historical decision or proposal | Current interpretation |
| --- | --- |
| Practice trading safely; Sim -> Replay -> Live vision | Simulation is implemented. Later modes remain intentions with separate approval requirements. |
| Simulated wallet, SOL-denominated trading, fixed reference price | Retained. Current balances are 120 SOL in development / 1 SOL otherwise, with a $150 SOL reference. |
| Registry outside Zustand; snapshots in stores; candles direct to chart | Retained in the active runtime. See architecture and AGENTS.md for boundaries. |
| Vite SPA, Tailwind and small vertical slices | Existing stack/process choices, not a new migration proposal. |
| Roughly five tokens per column, $69K runtime migration, $500K cap, dead-token cleanup | Historical values/claims superseded by the current source. Architecture records actual behavior without changing constants or retention policy. |
| Reuse the entire old engine/sim path; introduce providers and named new stores | Not an accurate description of current wiring. Some engine utilities are active; other modules are historical. Provider/store extraction is not authorized. |

## Open questions and technical limitations

These are discussion and investigation topics, not approved fixes or an ordered implementation backlog:

- What retention behavior should apply to old tokens and tokens with open positions? Current session state is not globally bounded.
- What should registry stop/start restore or reset? The current execution subscription/store lifecycle has risks.
- What timing semantics should apply after delayed/background callbacks? Registry and token clocks advance differently.
- How should the registry's age-based New Pairs predicate relate to the UI's newest-20 list?
- How should activity counts and Top Traders be described when computed from a truncated recent tape?
- Which partial UI controls should be labelled, removed, or implemented? No choice is made here.
- What regression coverage and QA portability/reproducibility are needed before further core changes?
- What historical code should remain as reference? No automatic deletion or restoration is approved.

The [architecture](architecture.md#other-known-limitations) records the evidence. Resolving these questions, changing the frozen migration constants, or selecting a new architecture belongs to separate work.
