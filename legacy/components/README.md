# Historical component references

These components come from the pre-rewrite symbol-centric UI. The current [router](../../src/router.tsx) and pages do not import them. Keep them as historical reference, not as a functioning alternative UI.

Their relative imports still refer to paths such as `../store/tradingStore` and `../engine/types`, which would resolve inside `legacy/` and do not exist there. Some components also refer to removed APIs, including `resetView`, `tfSec`, and `chartType`. Merely fixing imports would not restore a supported UI.

The application TypeScript configuration includes `src/`, not these files. Their presence does not mean they are checked by the application build or that their features are implemented in the current UI.

See the [current architecture](../../docs/architecture.md) and [status roadmap](../../docs/roadmap.md). This documentation cleanup does not move, repair, or delete legacy code and does not authorize restoring or removing its behavior.
