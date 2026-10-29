# Stellar Atlas pilot (#117)

Owner visual acceptance of this pilot was received in the implementation thread before #118/#119 began. The owner subsequently accepted the new artwork with the original dark UI and starfield; see PR #120 for final acceptance and delivery status.

## Inputs and rendering

Imported only `docs/visual-directions` from `a0dd71d9a230acf9ee3156422175d2e46f8aca7d` onto game master `20cff6b`. All 16 files were verified against the received SHA-256/byte manifest before running `package-preview.mjs`. Accepted masters and normalized transparent exports remain intact; no art was regenerated.

The adapter shares one 128×128 globe canvas/texture across ordinary planets. A fixed projection/lighting lookup is prepared once; a longitude-only sampler updates at most 24 times per game second. This bounds projection work independently of planet count and avoids a per-planet sampler or animation loop. The 256px reference export remains archival input. Warships use the normalized approved right-facing hull, existing positions/headings and a separate faction badge. Planet ownership outlines, names, counts and hit targets remain DOM layers. No simulation, save, camera or input algorithms changed.

Asset URLs are bundler imports, so production emits hashed relative assets. Workbox explicitly allows the 2.57 MB surface master within a 3 MiB precache budget. This adds download/cache weight; sources are retained for provenance. Texture ownership stays inside the adapter, including failed initialization cleanup. Reset/map replacement destroys planet sprites while retaining the shared texture until disposal.

## Validation and evidence

`bun run check`: lint, 195 tests, typecheck and production build passed. A concurrent browser run initially caused the existing seeded large-map test to time out; an isolated full rerun passed. Independent technical review found precache, initialization cleanup, pressed-button occlusion and focused-label contrast issues; all were repaired and affected checks repeated.

`browser.json` records repeated map replacement with stable texture/entity counts and stopped Pixi ticker. `interaction.json` records containment at 1440×900, 390×844 and 667×320, stable paused canvas and changes after resume. `*-fit/close/distant.png` show actual gameplay with DOM controls at each viewport. `factions.png` covers a four-faction generated match. `paused.png`/`playing.png` show the carrier fixture with approved warships; carriers retain their existing artwork. Browser automation uses Chromium/Linux with SwiftShader, DPR 2, and fresh temporary contexts; it is not physical hardware evidence.

Reproduction scripts use Playwright installed externally (`PLAYWRIGHT_MODULE` can specify its module path). Serve the baseline production dist on port 3128 and pilot dist on 3127, then run `compare.cjs`. Each scene uses a fresh context, 1280×800/DPR2, 2s warmup, and a 31s capture. Normal uses the deterministic capture/carrier fixture resumed at 1×; crowded uses the existing 1,500-unit diagnostics baseline. Raw JSON retains frame distributions, texture counts and context. These are software-rendered comparisons, not GPU timers or physical-device budgets.

`runtime.cjs` and `interaction.cjs` reproduce the visual/interaction evidence. Bundle `scripts/check-atlas-assets.ts` for a temporary browser page to check transparent corners, opaque center, no unchanged-clock updates, visible surface rotation and exact 48-second wrap.

## Remaining acceptance limits

Owner visual acceptance remains required. Physical phone/tablet performance, touch comfort, GPU memory profiling, and a real hidden-tab return without jumps have not been verified. Existing hidden-tab pause behavior is unchanged and globe rotation uses only simulation time. Capture and save compatibility retain existing regression coverage; every tactical-state combination has not been visually accepted. Review screenshots at actual size before accepting the 128px globe detail tradeoff. No later-batch art, HUD restyling, menus or new effects are included.

## Measured comparison

Milliseconds, baseline → final pilot (31s per capture):

| Scene | Draw p50 | Draw p95 | RAF p50 | Textures |
| --- | ---: | ---: | ---: | ---: |
| normal | 0.80 → 1.40 | 2.50 → 3.20 | 16.70 → 33.40 | 4.00 → 5.00 |
| crowded | 7.90 → 8.20 | 20.00 → 13.80 | 83.40 → 116.60 | 4.00 → 5.00 |

Normal draw cost increases; crowded draw tails improve in this sample. RAF cadence regresses on SwiftShader. These mixed results do not establish a hardware performance envelope: owner agreement on the remaining cadence/detail tradeoff is required before pilot acceptance. The first 256px candidate measured normal draw p50/p95 3.1/7.0ms and crowded 9.7/15.1ms; reducing the shared globe to128px lowered that cost. No claim of hardware acceleration or mobile performance is made.

The standalone production-bundled projection fixture passed in Chromium (`projection.json`). A combined projection/offline automation attempt timed out before reaching its offline exercise; offline reload and deployed-subpath runtime remain unverified. Build-time precache inclusion passed. CI check jobs passed for the pilot head at handback.
