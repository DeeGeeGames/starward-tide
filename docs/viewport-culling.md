# Viewport culling (#43)

## Remaining scope after the overlapping work

#45 supplied opt-in diagnostics and the crowded baseline (#42). #47 replaced the Canvas renderer with ECSpresso renderer2D/PixiJS (#44), cached ship textures, and cropped the backing canvas to the map/viewport intersection. #48 added defense-platform orbits. Those changes did **not** select visible units: the adapter still synchronized every hull. This change adds candidate selection to that existing adapter without another rendering path or a gameplay-index change.

## Implementation

`render-candidates.ts` owns a separate presentation-only ECSpresso world using the pinned 0.24.1 Spatial Index plugin, with only a `postUpdate` rebuild. One bound per occupied planet covers the largest unit orbit (`radius + 32`); each traveler has a point bound at its current position. These bounds never enter the gameplay world, combat queries, or saves. The 1,500-unit crowded fixture needs 302 bounds (two occupied planets plus 300 travelers).

Each draw refreshes membership and positions from the current game state, rebuilds the presentation index, and queries world-space viewport bounds. Orbit groups avoid computing offscreen orbit positions. A narrow pass uses `unitPoint()` and conservative bounds for rotated 32-unit ship textures and screen-sized cargo badges, including large saved cargo labels. Candidate output preserves gameplay query order. The renderer creates/synchronizes hull entities only for visible units and removes culled views. Explicit display ordering preserves overlap order after a paused pan and after badge-container promotion.

When the complete map is visible, indexing cannot save visible drawing work; selection bypasses maintenance and clears the derived bounds. Close zoom rebuilds from current state. Camera changes and paused commands are handled on the next draw, independently of simulation ticks. Death, arrival, reset, and world replacement remove stale membership.

Travel sprites, highlighted/pending routes, orbit graphics, defense platforms, and engagements keep their separate rendering paths. In particular, an offscreen hull does not suppress a line crossing the viewport. No combat ordering, colliders, persistence schema, shared ship-count cache, or HUD behavior changes.

Diagnostics include `render.index` (membership maintenance, rebuild, query, exact filtering together), and renderer inspection reports `totalShips`, broad `candidates`, exact visible `ships`, and `indexEntries`. `draw` includes all of this work. Normal URLs still expose no developer API or timings.

## Validation

The focused Bun regressions compare index output with exhaustive displayed positions over desktop/mobile sizes, multiple zoom levels, many pan positions, and orbit times. They also cover paused dispatch, movement, arrival, death, empty worlds, reset/replacement, all four badge-only viewport edges, full-map bypass and rebuilding after zoom. Queries leave gameplay units and the combat index unchanged. The existing gameplay/save regressions run with the complete suite.

Raw browser measurements and screenshots are recorded in `performance/viewport-culling.json` and the linked evidence below. Measurements use production bundles in the T3 collaborative Chromium 154/Linux browser, 1280×800 CSS pixels, DPR 2, with SwiftShader software rendering. These measure synchronous JavaScript and browser RAF cadence, not GPU timers or physical-device throughput. Each capture lasts 31 seconds with diagnostics enabled, the crowded fixture, AI off, pace 1×, and no input during capture. Close zoom is 5× fit anchored on Vega. The initial before-fit capture starts later in simulation time; it retains the same 1,500 live units. Each close capture reloads the fixture and starts after a one-second warm-up. Host variance affects simulation and HUD timings as well, so fit-view differences do not isolate culling cost. Do not infer a general frame-rate improvement from these serial captures.

| Capture | Visible hulls | Index bounds | Selection p50/p95 (ms) | Whole draw p50/p95 (ms) | RAF p50 (ms) |
| --- | ---: | ---: | --- | --- | ---: |
| Before fit | 1500 | — | — | 2.6 / 3.1 | 66.6 |
| Initial after fit | 1500 | 0 | 0.1 / 0.2 | 3.4 / 4.7 | 83.2 |
| Final fit repeat | 1500 | 0 | 0.1 / 0.2 | 3.4 / 4.6 | 66.7 |
| Before close | 1500 | — | — | 4.2 / 5.9 | 250.0 |
| Initial after close | 600 | 302 | 0.5 / 0.8 | 2.9 / 4.6 | 250.0 |
| Final after close | 600 | 302 | 0.5 / 0.8 | 3.3 / 5.2 | 266.6 |

The final close capture reduces synchronized/drawn hulls by **60%** and measured synchronous draw p50 by approximately **21%**, including the 0.5 ms selection cost. The broad spatial query contains 863 units at that final snapshot; exact silhouette filtering leaves 600. The initial close snapshot contains 600 broad candidates. Grid-cell false positives vary as travelers move. All 300 travel lines remain in both captures.

There is **no demonstrated net RAF improvement** in these software-GPU captures: close RAF is unchanged in the initial pair and slower in the final repeat. Fit view has no drawing reduction, incurs about 0.1 ms selection overhead, and does not demonstrate a net benefit. The implementation therefore bypasses indexing at fit. Remaining routes, fill work and host variance limit the benefit of CPU hull culling. Hardware GPU/mobile performance and physical touch feel remain unmeasured; these measurements justify reduced hull work, not a general frame-rate claim.

Browser evidence at 1280×800 and 390×844 (desktop UA, DPR 2):

- Desktop: [fit](performance/culling-desktop-fit.png), [close](performance/culling-desktop-close.png), [viewport edge](performance/culling-desktop-edge.png).
- Mobile layout: [fit](performance/culling-mobile-fit.png), [close](performance/culling-mobile-close.png), [viewport edge](performance/culling-mobile-edge.png).
- Actual-adapter overlap regression: two overlapping, opposing transports with upright cargo badges, paused throughout. Pan to cull only the first hull, then return: visible hull counts **2 → 1 → 2**, lines **2 → 2 → 2**. The [before](performance/culling-order-before.png) and [after](performance/culling-order-after.png) screenshots have **identical RGB pixels**. This validates the independent review repair for recreated hull ordering.
- Offscreen endpoints: zero visible hulls still retain two [crossing travel lines and a crossing engagement](performance/culling-crossing-lines.png). A [pending highlighted route](performance/culling-crossing-highlight.png) also remains visible. Transitioning both travelers to orbit removes both travel sprites. No browser console entries were reported across these checks.

These measurements describe the retired Pixi adapter. The isometric 3D migration replaces its spatial-index culling and overlap-order fixture with projected hull visibility, GPU instancing, and depth testing. Routes remain independent of hull visibility. Current projection and asset checks live in `src/isometric.test.ts` and `src/fleet-models.test.ts`; historical screenshots and measurements above remain available as evidence of the earlier renderer.

Validation at the culling revision: `bun run check` passed lint, **190 tests**, strict typechecking, and the production build. Independent review's overlap-order finding was repaired and re-reviewed with no remaining source findings. The task-owned browser tab and HTTP server were closed; port 3010 was verified stopped.
