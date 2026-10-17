# PixiJS ship renderer

Issue #44 uses ECSpresso 0.24.1's `createRenderer2DPlugin` in a presentation-only world. PixiJS is pinned to **8.19.0**, the same version used by that ECSpresso release's development dependency and within its `^8.0.0` optional peer range. PixiJS remains actively maintained; its v8 application, texture, and ticker APIs are documented at https://pixijs.com/8.x/guides/components/application.

The original hull paths, owner palettes, and detail thresholds are preserved in `ship-art.ts`. Canvas rasterizes each side/kind/detail combination once into a shared texture, rather than submitting every ship's paths each frame. Ordinary ships use retained ECS sprite components; cargo badges are lazy, upright child sprites with a constant screen size. The fit baseline needs only three shared textures for 1,500 ships; all twelve hull variants are created only as needed. Large cargo values from compatible saves retain their full label. Animated routes, orbital rings and engagement beams use Graphics; stars are retained until the map changes.

The existing RAF in `main.ts` is the only loop owner. `startLoop: false`, `autoStart: false`, and a private, stopped Pixi ticker prevent a second simulation or render loop. Each draw synchronizes the presentation world with `unitPoint()`, runs transform propagation with `presentation.update(0)`, and calls `app.render()`. Rendering and camera controls continue while gameplay is paused. Pixi pointer processing is disabled; DOM planet buttons and the existing map input still own selection, pan, pinch, zoom, and dispatch.

The single backing canvas is viewport-sized at the device pixel ratio (capped at 3), rather than rasterizing the whole map at every zoom. Its CSS box cancels the enclosing DOM map transform, while the Pixi root applies the same camera in logical coordinates. CSS clipping preserves the old logical map boundary without a GPU stencil pass. Planets and HUD remain DOM overlays. Regression checks cover viewport alignment, map-edge clipping, detail thresholds, and dashed routes with offscreen endpoints.

No render spatial index is introduced. The existing combat index excludes orbiting ships and remains unchanged. Pixi clips rasterization to the viewport, but CPU synchronization still processes every unit. Issue #43's candidate-query work is still separate; this migration neither implements it nor maintains a competing render index.

Ownership: the adapter owns one Application, its presentation world, Graphics, sprites, and texture sources. Removing a unit removes its presentation entity and destroys its sprite children without destroying shared hull textures. Game replacement explicitly resets the fleet and destroys cargo textures; the bounded twelve hull textures and Application are reused. Disposal is idempotent, awaits presentation teardown, destroys the Application/Graphics, and destroys all shared texture sources. Pixi objects never enter gameplay components or saved snapshots.

## Evidence and remaining acceptance

See `performance/renderer/` for identical paused mixed-fleet saves before and after migration at distant (0.5× fit), normal (fit), and close (5× fit) zoom, desktop 1280×800 and mobile-layout 390×844, DPR 2. The visual fixture is recorded alongside those screenshots. It includes both owners, both silhouettes, orbital ships, travelers, and cargo. Additional screenshots cover mobile pending-order highlighting and resumed combat. These are Chromium automation with a desktop user agent, not physical phone/touch testing or owner acceptance.

The renderer migration remains open for owner presentation/feel acceptance and performance direction. The measured SwiftShader comparison regressed; no physical-GPU speedup or resolution of late-game hitches is claimed.

## Crowded production comparison

The [raw reports](performance/renderer/comparison.json) repeat #42's exact 1,500-unit LAB_MAP fixture at 1× pace, 1280×800 CSS pixels, DPR 2, fit scale 0.4431818181818182, Chromium 154/Linux with ANGLE SwiftShader. One tab ran at a time, with one second of warmup before a 31-second capture and no input during the capture. The Canvas capture used PR #45's production build; Pixi used this migration with CSS map clipping. Final browser checks cleared the task-origin service worker/cache before loading the rebuilt bundle. Earlier exploratory captures with two tabs or a GPU stencil mask are excluded.

| Metric, ms | Canvas p50 / p95 / p99 / max | Pixi p50 / p95 / p99 / max |
| --- | --- | --- |
| RAF interval | 66.7 / 83.4 / 100.0 / 116.6 | 100.1 / 116.7 / 116.8 / 133.4 |
| Synchronous draw | 2.1 / 3.7 / 4.7 / 7.3 | 2.7 / 3.6 / 5.1 / 10.7 |
| Simulation update | 1.3 / 3.0 / 7.0 / 8.6 | 2.9 / 4.1 / 5.8 / 8.1 |
| HUD refresh | 1.1 / 1.7 / 2.3 / 2.4 | 1.4 / 1.6 / 2.6 / 3.3 |
| Save capture, two samples | 2.9 / 3.1 / 3.1 / 3.1 | 3.3 / 4.5 / 4.5 / 4.5 |
| Save validate/clone sync, two samples | 5.1 / 5.4 / 5.4 / 5.4 | 6.2 / 6.9 / 6.9 / 6.9 |

Canvas recorded 435 RAF intervals and Pixi 287. Both captured two periodic autosaves; offsets are in the raw reports. Median cadence regressed about 50%, despite similar synchronous drawing spans. Graphics submission, browser compositing and software GPU work are outside that synchronous span; these data do not isolate which is responsible. Simulation code is unchanged, and larger RAF intervals can put more fixed steps into one update. The existing dt clamp can also reduce simulated progress during slow frames. These sequential runs remain subject to host variance and do not establish physical-GPU performance. Autosave and simulation costs remain separate and unresolved by a renderer switch.

Memory observations are ownership/count checks, not a GPU-memory profiler: the fit fixture retained 1,500 sprites, 1,503 presentation entities, three shared hull textures and one stopped ticker. Repeated fixture installation retained those counts, the same canvas, and the same WebGL context. At this viewport, the backing color image is 2560×1600 (about 16.4 MB RGBA), compared with Canvas's 2400×2640 (about 25.3 MB) at fit and 3600×3960 (about 57 MB) at close zoom. These estimates exclude depth/MSAA, browser surfaces, allocations and driver overhead; they are not total resident GPU memory.

Browser validation also saved and reloaded the mixed fleet, preserving 10 warships, 10 transports, pending/active orders and simulation time while resuming paused. Starting a new generated conquest through the normal setup flow reused the same canvas/context and replaced the old fleet. Page disposal removed the diagnostics API/panel and caused `gl.isContextLost()` to become true, confirming the task-owned WebGL context was released. Native click/right-click dispatch, route highlighting, keyboard pan, mouse drag, wheel zoom, pause/resume and desktop/mobile resize were exercised. Physical touch/pinch feel is unmeasured. Focused self-review repaired the deprecated Sprite-child pattern by promoting only badge-bearing ships to Containers, then rechecked close zoom, commands and combat. No independent renderer agent was used, per the owner's request to implement #44 personally.

To repeat mixed-fleet screenshots, use an isolated test origin/profile and install `performance/renderer/visual-fixture.json` as a schema-v1 `game` snapshot in a dedicated profile, then Continue normally. It starts paused at time 5 on LAB_MAP with 20 units and no orders. Desktop fit camera is x=374.0909090909091, y=130, scale=0.4431818181818182; distant camera x=507.04545454545456, y=265, scale=0.2215909090909091; close camera x=-509.5454545454545, y=-869, scale=2.215909090909091. Mobile close is x=-560, y=-355, scale=1.425. For the command/combat screenshots, select Sol, right-click Deneb, highlight the waiting order in Orders, close the drawer, then resume briefly and pause. Remove the dedicated fixture profile afterward.
