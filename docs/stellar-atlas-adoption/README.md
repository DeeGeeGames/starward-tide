# Stellar Atlas battlefield and HUD adoption (#118 / #119)

The owner explicitly accepted the #117 pilot in the implementation thread before this work began. Final appearance remains pending owner acceptance. Do not merge this visual work before that gate.

## Artwork and provenance

Accepted concept, planet surface and warship masters remain unchanged under `docs/visual-directions`, pinned to `a0dd71d9a230acf9ee3156422175d2e46f8aca7d`. New unit and surface masters live under `assets/stellar-atlas/masters`; runtime exports live immediately above them. `manifest.json` records source/export dimensions, sizes and SHA-256 hashes; `exports.json` records crop bounds. No runtime asset points to a private image-generation directory.

New art used the built-in image tool, one call per asset plus a targeted transport proportion revision. Each `*-prompt.txt` is the exact request. Transport/carrier/platform used the accepted concept plus normalized warship as style references. Ochre terrain used the concept plus accepted surface; mineral terrain used the concept. The transport revision used the initial transport candidate; `transport-v2.png` is the chosen runtime source. Generative prompts do not reproduce identical pixels; reuse these masters.

`scripts/normalize-atlas.cjs` detects unit bounds at alpha ≥16, preserves alpha/aspect ratio and centers a maximum 224px footprint in a 256px export. Terrain exports resize to 1024×512. Serve the repository root at 127.0.0.1:3129 and run with Playwright available (`PLAYWRIGHT_MODULE` may name an external installation). The accepted master files are never edited by normalization. Browser contact-sheet evidence covers transparent unit silhouettes on paper/ink and all three terrain types through a complete revolution.

Three shared 128px globe canvases/textures replace the pilot's single shared globe. Each updates at most 24 Hz from simulation time, independently of planet count. World names select terrain deterministically; no persisted state or terrain mechanics are added. Warships, transports and platforms retain the existing positions/headings/orbits. Carrier artwork changes only in tactical gameplay; setup retains its existing SVG. Live badges/ownership/counts remain separate from illustration. Existing routes, blockades, cargo, bombardment, carrier courses and race markers remain supported, with darker ink colors for contrast on paper. Runtime sprites retain the same 32-world-unit texture envelope and existing hit geometry.

## HUD boundaries

Only tactical header, command rail/sheet, Orders, destination prompts, warnings, results/status and gameplay save status are themed. Paper backgrounds are opaque; headings use Georgia and controls retain utilitarian/tabular text. Existing disclosure, scrolling inside panels, responsive breakpoints, hit targets, commands and keyboard state remain unchanged. Title/setup/profile screens and opened `#field-guide` keep their existing styles. No custom fonts, menus, new effects, mechanics, save migrations or control redesign are included.

## Validation

`bun run check` passed: lint, 195 tests, typecheck and production build. Independent technical review completed; count/race contrast and initialization-failure cleanup findings were repaired and rechecked. Candidate initialization rejection now disposes the stage and globe textures as well as presentation resources.

`browser.json` records viewport containment and actual paused production, Orders/destination interactions, bombardment cancellation and pause/resume checks. Screenshots show desktop 1440×900, portrait 390×844 and short landscape 667×320, with close/distant views and tactical-state examples. `races.json`, `projection.json` and `offline.json` record additional checks where available. Evidence scripts require Playwright; all use temporary browser contexts without touching an owner's browser profile. Screenshots validate CSS-pixel viewport behavior, not physical-device touch comfort.

Performance compares accepted pilot commit `8bf212a` (port 3128) against this adoption (port 3127), using sequential fresh-context 31s captures at 1280×800/DPR2/1×, identical deterministic capture/carrier and 1500-unit crowded fixtures, 2s warmup. `compare.cjs` records raw reports with renderer texture counts. Chromium/Linux uses SwiftShader software rendering; results are not hardware GPU timings. Separate GPU memory profiling and physical-device performance remain unavailable.

Final owner acceptance remains required, including asset readability at real play scale and any measured performance/detail tradeoff. No merge has been performed.

## Measured pilot comparison

Milliseconds, accepted pilot → adoption. One sequential 31s capture per scene/version; small differences should not be treated as hardware benchmarks.

| Scene | Draw p50 | Draw p95 | RAF p50 | Textures |
| --- | ---: | ---: | ---: | ---: |
| normal | 1.30 → 2.30 | 3.20 → 5.70 | 33.40 → 33.40 | 5.00 → 7.00 |
| crowded | 8.20 → 9.20 | 13.60 → 11.50 | 116.60 → 116.60 | 5.00 → 7.00 |

Three terrain variants add approximately 1 ms median draw work and two shared globe textures. The globe texture pixel allocation grows from 64 KiB to 192 KiB (dimension-based estimate; actual driver memory was not profiled). Normal median RAF cadence is unchanged in this sample; crowded draw tails improve. Normal draw tails increase, so final acceptance includes this cost/detail tradeoff. No draw samples exceed 50 ms.

Production offline reload passed at both root and a local simulated subpath, including opening the saved carrier fixture with 20 holdings and new artwork. The diagnostics query URL itself was not cached by the default Workbox query policy; the offline checks navigate to normal production URLs. Excluded title-button and opened-game-menu computed font/color/background/border values match the accepted pilot (`excluded-styles.json`). All three globe variants passed alpha, stationary-clock, visible-rotation and 48-second wrap checks.

`extra.json` and `returning-route.png` verify recalling an active order into its Returning state. A real hidden-tab check was unavailable because headless Chromium kept the background page visible; this is not evidence of hidden-tab pause behavior. Physical-device/touch comfort and GPU memory profiling remain unverified. Save-error/result-banner styles received static review; storage failure and final-result browser journeys were not separately injected. Capture rules retain existing regression coverage; a complete in-game capture transition and every tactical-state combination were not separately recorded. The profile dialog was not separately screenshot-tested.
