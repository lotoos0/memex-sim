# Engine V2 runtime and storage

## Scope and operation

V1 remains the default. Select **Open V2 session** to open the single resumable V2 recording for this browser profile and origin. Refreshing V2 or opening it again resumes its last durable boundary. Browser downtime contributes no simulation time. Opening V1 leaves the V2 recording in place.

## Durability and replay

- Each frame records the simulation time, ingress, complete committed facts, previous checksum and UI command ordinal. Frames and checkpoints are versioned, canonicalized, checksummed and gzip-compressed. The browser issues at most one write at a time and advances in slices of at most one simulated second.
- IndexedDB uses one strict-durability transaction for the frame, head and optional checkpoint. The writer compares the expected head within that transaction. A stale tab aborts. The UI publishes the clock and balances after commit. The synchronous trading API can show a provisional admission during the saving indicator. Reload restores the last durable batch if the browser closed mid-write.
- The restart cache is built initially and every 120 simulated seconds. It includes the world, pending heap, RNG, agents, ledger, active orders, social timers and bounded read models. It is anchored to a frame checksum. A checkpoint carries no copy of the tape. Replacing a checkpoint removes its superseded cache in the same transaction.
- Restore verifies the head, checkpoint and anchor, then deterministically reruns the suffix and compares generated facts to stored facts. The archive reader verifies each frame's checksum and previous link as it reads. A missing prefix block is caught by the frame count on startup. Corruption in a historical block before the checkpoint is detected when that block is streamed. A failed save or incompatible restore stops the runtime with a visible error.
- `recordedFrames()` streams the tape to replay or benchmark consumers. `rerunRecording()` executes archived ingress from genesis, comparing facts at every durable boundary. **Export V2 recording** writes a verified NDJSON stream in browsers with the file picker API. The first line carries the head and world config. Each following line is one canonical frame, decoded with `readCanonical<Frame>()`. The exporter pins a durable head while the simulation may continue.

## Retention

The durable tape retains all financial facts, events and ingress for the life of the browser recording. The application leaves archive deletion to the browser owner. Browser storage policy, quota and explicit clearing of site data still apply. The current UI manages one recording per origin and browser profile.

The browser keeps the live world, one in-flight batch and a bounded read model in memory. The current scenario has a finite participant population and launch period. Closed orders and archived ingress leave the live world after their batch. Unexpired active orders and scheduler tasks remain authoritative. The hot view retains the exact five-minute trade window plus the recent tape, up to 3,600 one-second bars per token and capped personal history, audit and feed rows. Lifetime ledger positions and trader aggregates are retained separately. The browser chart and trade panels show recent history. Legacy chart averages derived from personal fills use that capped series. The archive is the source for full historical series. Combining one-second bars into larger buckets can change the floating-point grouping of display volume sums. Financial amounts and archived fill values are unchanged.

The former 160,000-fact and 20-minute stop thresholds are removed. Slow writes apply backpressure to simulation time. A storage failure freezes the published view at its last durable point and prevents further submissions. Commands can be retried after a normal in-flight save finishes. A failed writer requires reload.

## Verification

- `npm run qa:engine-v2` covers the existing financial and deterministic fixtures plus pending orders, single migration, dormant state, scheduled repost, restart checkpoint rotation, suffix rerun, full recorded playback, full deterministic rerun, stale writers, injected quota failure, damaged gzip and missing frames.
- Edge 156 tested native IndexedDB and a real 90 SOL UI order. A paused reload retained one pending order, available balance 9.999995 SOL and identical head hash `3d8101df45d217cb`. Resuming produced one migration and balance 19.856109548 SOL. Closing and reopening Edge with the same test profile retained the balance, marker and `PARTIAL_CLOSED` execution.
- Lint and build pass with the existing hook and bundle-size warnings. The pre-storage deterministic fixture hashes remain `f8092dfbdd7be89f` and `edd06a22c30a0ffe`.

## Disk-backed stress

`node --expose-gc scripts/qa/engine-v2-storage-stress.mjs 1 6 12` ran one world with 100 agents, Social enabled, seed `V2-STORAGE-STRESS` and five-second simulated batches. Node 22.18.0 on Windows used the same recording, checksum, codec and restore code with a test filesystem backend. This backend is for measurement. The browser uses IndexedDB transactions.

| Simulated time | Cumulative wall time | Facts | Fills | Frame archive MiB | Latest checkpoint KiB | Restore | Heap after GC MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 h | 18.0 s | 483,031 | 27,289 | 22.43 | 424.1 | 101 ms | 13.6 |
| 6 h | 65.5 s | 740,276 | 27,289 | 29.35 | 424.1 | 112 ms | 15.9 |
| 12 h | 133.7 s | 1,048,735 | 27,289 | 37.60 | 424.0 | 111 ms | 18.3 |

At 12 h the cumulative p95 ordinary save was 15.0 ms, p95 checkpoint save 155.0 ms and p95 advance 2.5 ms. Sampled heap peaked at 71.6 MiB and process RSS at 313.6 MiB. Peak sampled queue was 3,865 tasks. The largest five-second batch held 5,222 facts. The hot trade buffer peaked at 21,617 rows. Each measured restore matched the prior world and projection hashes and conserved assets. These restores landed on checkpoint boundaries. The workload produced its fills in the first hour and continued recording scheduled agent activity afterward.

The 12 h restore matched world hash `3a3620c57ce1cd21`, hot-view hash `09e4397437eb3208` and archive head `aebc3849a6da7a4d`.

The earlier calibration pilot remains historical. This run exercises runtime and persistence with the existing model.

## Edge and IndexedDB

Edge 156 advanced the actual V2 adapter in accelerated five-second simulated batches while rendering Pulse. At 1 h the recording held 500,259 sampled facts, 27,144 fills and 723 frames. The origin's storage estimate was 24.38 MiB. Sampled renderer heap peaked at 100.9 MiB and the pending queue at 3,725. Hot trade rows peaked at 20,138 across markets. The V2 app's production frame target is one second. Search took 29–60 ms in the accelerated run. The longest observed main-thread task was 95 ms, with p95 advance-and-save time of 127 ms for ordinary frames and 246 ms for checkpoints at the 1 h sample.

Reload at 3,715 simulated seconds restored the 115-second suffix after the latest checkpoint and matched head hash `299ad03da3e1e391`. Reload, suffix verification and an injected quota failure together took 558 ms. The injected write failure kept the previous visible ledger, token view and persisted head. Native IndexedDB stale-writer abort and browser restart were exercised separately. The browser's storage quota and eviction policy remain external constraints. Gzip and checkpoint encoding still contribute main-thread latency under accelerated load.

An Edge export test used the V2 button and a substituted picker that returned a real origin-private file handle. All 291 frames, 20,470 fills and one command were present in the 186,151,628-byte uncompressed export. Each frame linked to its predecessor and the final checksum matched the exported head. The OS file-picker dialog was outside this fixture.
