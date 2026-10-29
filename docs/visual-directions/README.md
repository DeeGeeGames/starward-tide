# Stellar Atlas reference pack

This is the owner's accepted visual reference and animated asset proof for Galaxy Conquest issues #116–#119. It is a reference package, not a game implementation or an alternative game branch. The initial adoption covers the tactical battlefield and gameplay HUD. Title/setup/profile screens, the opened game-menu/help drawer, the campaign/galaxy view, and new effects are outside this batch.

The pack is published on `docs/stellar-atlas-references`. Use the immutable commit linked in issue #116 as the authoritative snapshot. Application code and the default branch are not changed by publishing this pack.

## Start with the accepted references

| File | Role |
| --- | --- |
| `03-stellar-atlas.png` | Accepted overall art direction: warm ivory, petrol ink, teal/vermilion, stippled worlds and inked ships. It is a mockup, not a screenshot of implemented gameplay. |
| `asset-proof/standalone.html` | Download and open this file locally for the live planet/warship proof. All input images are embedded; no server, API key, image service, or installed package is needed to play it. |
| `asset-proof/index.html` | Readable canonical source of the proof. The packager derives the standalone viewer from it without changing the accepted artwork or motion. |
| `asset-proof/planet-surface.png` | Accepted unlit 2:1 surface map used to render the rotating globe. |
| `asset-proof/atlas-warship.png` | Accepted transparent source illustration, top-down, bow pointing right. |
| `asset-proof/planet-frame.png` | Reusable 256×256 transparent globe frame at the initial rotation phase. |
| `asset-proof/warship-sprite.png` | Reusable centered 256×256 transparent ship export, pointing right. |
| `asset-proof/prompts.md` | Exact asset-generation prompts, transparency intent, and the texture-edge repair request. |
| `prompts.md` | Original prompts for the three visual directions and the Orbital Command refinement. |
| `reference-inputs/current-gameplay-desktop.png` | The actual source screenshot supplied as the layout reference when generating the concepts. |
| `01-orbital-command.png`, `02-deep-space.png` | Earlier alternative directions, included for provenance. These are **not** the adopted theme. |
| `index.html` | Comparison viewer for all three concepts; open with its sibling images available. |
| `manifest.json` | File sizes, PNG dimensions, and SHA-256 digests for the pack, excluding the manifest itself. |
| `validation.json` | Offline-browser verification results, exact PNG export digests, and the checks that remain outside this proof. |

The concept image is a style reference, not a sprite sheet. Its text, faction coloring, counts, UI layout details and surface features are not independent production assets. Keep UI text, faction identity, counters and selection as live presentation layers. The approved asset proof contains no combat/engine/capture effects, despite decorative trails appearing in the earlier concept.

## Obtain and use the package

The issues provide commit-pinned image, source and download links. GitHub previews PNG files but displays HTML as source; download `asset-proof/standalone.html` and open the downloaded file in a browser to run the animation.

An independent implementer can fetch the reference branch into an existing game clone:

```sh
git fetch origin docs/stellar-atlas-references
```

Use the exact reference commit recorded in #116 rather than assuming the moving branch is unchanged. In a clean implementation checkout, copy the pack from that commit without switching the implementation to the reference branch:

```sh
git restore --source=<reference-commit-from-issue-116> -- docs/visual-directions
node docs/visual-directions/package-preview.mjs
```

The restore command writes the listed directory; preserve any unrelated files already there before using it. `package-preview.mjs` uses only Node's built-in modules and also runs with Bun. It rebuilds the offline viewer and checksum manifest. The standalone viewer has **Save planet PNG** and **Save ship PNG** buttons that reproduce the normalization/export procedure. Prefer the standalone viewer for local file use: the source viewer's separate image inputs can encounter browser file-origin restrictions during canvas pixel reads.

Verify the received pack before editing it, using the recorded manifest. Rebuilding the manifest is packaging, not independent verification: compare the received bytes to the existing recorded hashes first.

## How the images were made

Generation used the built-in `imagegen` tool with a text prompt, reference image paths, and the `transparent_background` flag. No CLI/API model override, API key, fixed seed, or animation-frame generator was used. The prompts document the process; rerunning them is not expected to reproduce identical pixels. Reuse the accepted files as the masters.

1. Generate each concept separately using `reference-inputs/current-gameplay-desktop.png` as the layout reference and the corresponding full prompt in `prompts.md`. Stellar Atlas is the third concept. Orbital Command received one further graphic-style revision; its discarded first draft is not in the pack.
2. Generate the planet surface and warship separately, each using `03-stellar-atlas.png` as a **style reference**, not as an edit target or a sprite sheet. Use the exact prompts in `asset-proof/prompts.md`. Request the surface as opaque and the ship with genuine transparency.
3. The first planet map exposed a wrap seam. Apply the recorded **Planet texture wrapping revision** to that generated map, preserving the center while making the left/right edge regions predominantly matching petrol ocean. The supplied `planet-surface.png` is the repaired result. Inspect a full rotation: a phase-loop equality assertion does not by itself prove seam quality.
4. Inspect alpha, dimensions, silhouette, margins and actual-size readability. The resulting dimensions differ from requested preferred dimensions: trust `manifest.json` and the actual image headers.
5. Build motion from these fixed images using the proof's code. No separate animation frames were generated; no image was sliced out of the concept mockup.

For additional artwork, use the accepted concept plus the relevant accepted sprite as references. Keep palette, line weight, stipple density, light treatment and proportions coherent. Warships are heavy capital ships with blunt bows and stepped shoulders, not needle fighters. Transports need a short/wide silhouette with obvious twin cargo pods. Additional planet terrain is visual variation, not a new game mechanic. Extra faction palettes require coherent treatment and visual review; persisted faction IDs remain unchanged.

## Exact sprite preparation and motion

The implementation of these procedures is in `asset-proof/index.html`; `package-preview.mjs` adds export buttons to the standalone version.

### Warship normalization

- Decode the untouched source PNG into an offscreen canvas.
- Find the union bounds of pixels with alpha **at least 16**. This threshold is only used to find bounds; preserve original color and alpha when drawing.
- The source hull has nearly opaque pixels topping out at alpha 254. Do not search only for alpha 255 or assume the black-looking image-viewer background is baked into the sprite.
- Crop to the detected bounds when drawing, preserve the aspect ratio, and center on (128, 128) of a transparent 256×256 canvas.
- Draw at 224 pixels long, pointing right (angle zero). This produces the supplied `warship-sprite.png`.
- In the proof, draw the original source using these same bounds, translating and rotating around its center. The game-scale footprint is 26 pixels long at the full 728 CSS-pixel viewer width. The inspection view is 3×.

### Planet projection

- Resize the supplied surface to a 1024×512 sampling canvas.
- Produce a 256×256 transparent circular output. For each pixel inside the unit disk, calculate the surface normal with positive Z.
- Longitude comes from `atan2(nx, nz) / (2 * PI) + 0.5`; latitude comes from `asin(ny) / PI + 0.5`. Add `seconds / 48` to longitude and wrap modulo one.
- Keep lighting fixed: the normal-light dot product uses (-0.56, -0.42, 0.71), clamped below at zero. Broad light levels are 1, 0.78 and 0.43, blended toward ink RGB (12, 42, 49). A narrow alpha edge keeps the circular boundary clean.
- The texture moves under a stationary shadow and outline; this is not a flat disk spinning like a wheel. The proof updates globe pixels at a target 24 updates/second while the presentation draws with RAF.
- The supplied `planet-frame.png` is the globe at phase zero. Selection brackets, outline accents, names and counters are not baked into the PNG.
- Game-scale planet diameter is 68 pixels in the full-width proof. On narrower viewer widths the entire canvas scales down, so that strip is not a physical-phone size/performance acceptance test.

The standalone preview's ship follows an eight-second cubic approach with a tangent-continuous entry into an eighteen-second circular orbit. Those timings and that curve demonstrate rendering only. **Production must use existing game positions, paths, speeds and headings**, and respect game pause/visibility behavior.

The paper ground is drawn procedurally in the proof using flat color, faint chart lines and deterministic sparse grain; there is no separate approved paper-texture PNG.

## What is established, and what remains to prove

The owner accepted the concept and this source-art/motion proof. The proof uses a 2D Canvas renderer, not a 3D runtime. It demonstrates reusable source art, stable sprite identity, transparency, globe projection and movement/orientation.

The proof's built-in checks verify the phase-zero/full-revolution equality, globe alpha silhouette, transparent ship corner, and position/heading continuity at orbit entry for both view scales. Browser verification also covered pause, scrubbing, replay, background and zoom controls, local layout containment at 390px, and absence of browser errors. Normalized PNG exports were inspected. Project typechecking passed.

The proof does **not** establish production shader/texture architecture, multi-planet CPU/GPU cost, game camera/hit-target integration, save compatibility, faction tinting, crowded combat readability or physical-device performance. In particular, do not copy the per-pixel CPU globe loop into every game planet and assume it is scalable. Measure a real-game pilot and choose an appropriate cached/Pixi rendering approach.

Useful review procedure: inspect at 1× and 3×; scrub through 0/8/12/24/48 seconds; pause/resume and replay the approach; inspect transparency-grid and ink grounds; export both PNGs; check a full revolution including the repaired meridian; and verify source hashes. Compare normal/crowded game performance only after integration.

## Integration boundaries and review gates

Issue #117 is the real-game pilot. Owner visual acceptance of that pilot is required before expanding to #118 (remaining battlefield assets) and #119 (tactical HUD). The latter two can proceed in parallel after that gate. Final visual behavior also needs owner acceptance; independent technical review and checks do not substitute for it.

The proof was created from application commit `1d31aa7110e89b38ee8968020be2811aeecc1f67`. The reference-only publication is based on default-branch commit `20cff6b219fd882eb680d49ae05b8d64f95f423f`. These are provenance markers, not a request to revert implementation to either revision. Inspect current game code and coordinate carrier work #107.

Preserve the existing PixiJS/ECSpresso renderer ownership, single RAF/ticker behavior, camera/DOM overlays, labels, orbit clearances, culling and disposal. No gameplay, balance, movement, persisted faction identity or save schema changes are included. Shared CSS must not leak HUD restyling into excluded menus. Run `bun run check` for implementation work and document browser evidence and any unavailable device checks.

