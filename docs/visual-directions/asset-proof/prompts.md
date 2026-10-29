# Stellar Atlas asset proof

Source illustrations generated with the built-in image tool, using `../03-stellar-atlas.png` as a style reference. The globe animation uses a surface texture and fixed spherical projection in a 2D canvas. The warship uses one transparent sprite with procedural travel and heading. No effects or game integration are included.

Deliverables: `planet-surface.png` is the opaque 2:1 surface texture; `atlas-warship.png` is the unmodified transparent source illustration. `planet-frame.png` and `warship-sprite.png` are centered 256x256 transparent PNG exports from the preview. The ship export faces right. `index.html` plays the live animation using the two source PNGs; open it alongside those files. The planet completes one revolution per 48 seconds. The ship follows an 8-second approach and then an 18-second orbit. The proof has no generated animation-frame strip: geometry and sprite identity remain stable through procedural motion.

Validation: project typecheck passed; browser checks covered transparent input corners, the globe loop and fixed circular silhouette, continuous orbit entry at both scales, pause, scrubbing, replay, zoom, backgrounds, and page containment at 390px. No browser errors. Full game integration and crowded-scene performance were not tested.

## planet-surface

Use case: stylized-concept.
Asset type: ONE seamless 2:1 equirectangular surface texture for a 2D animated illustrated planet in Galaxy Conquest.
The attached image is STYLE REFERENCE ONLY, especially its teal-and-cream Terra. Create a new production texture, not another mockup.
Primary request: a flat rectangular world map of a fictional ocean planet, rendered as a beautiful mid-century screenprinted astronomical atlas illustration. FULL BLEED rectangle, 2:1 width-to-height, preferably 1536x768, fully opaque.
Deep petrol ink oceans (#103e4c), mineral teal continental shelves (#238b8e), warm ochre/ivory continents (#d9c49b). Four or five bold organic continents and some small archipelagos, clearly visible broad shapes. Fine sparse ink stipple and imperfect printed coastlines match the reference. Low microtexture density so a small sphere remains legible. A few restrained thin inland contour marks. No black outlines around the rectangular image.
This will wrap around a rotating sphere: left and right edges must join seamlessly, with matching dark ocean at both outermost edges. Polar bands subdued with small pale ice areas, no huge white caps. NO baked-in light or shadow, no sphere shading, no atmosphere, no cast shadow: runtime handles lighting. No planet circle, no border, no frame, no text, no labels, no UI, no spacecraft, no stars, no background paper margin. It is an unlit planet albedo map, not a landscape painting. Flat ink-and-stipple illustration; absolutely no photorealism or glossy 3D rendering. The entire canvas is the planet surface map.

## atlas-warship

Use case: stylized-concept.
Asset type: ONE transparent top-down 2D capital-warship sprite for Galaxy Conquest, matching the attached Stellar Atlas style reference.
Create one isolated ship, large and centered, on a genuinely TRANSPARENT canvas with generous empty margins (at least 10% all sides), preferably landscape 1536x1024. No floor, no paper rectangle, no baked shadow outside the hull. Alpha transparency is required.
Ship silhouette: a long, broad, heavy CAPITAL WARSHIP viewed EXACTLY from above, bow pointing RIGHT, stern to LEFT. Bilaterally symmetric outline across its horizontal centerline. Length about 2.5 times width. BLUNT angular bow, stepped armored shoulders, broad rear engine block. Two small gun turrets on the dorsal centerline, a low central bridge, one or two strong panel divisions. This is a substantial gunship, not a needle fighter or arrowhead, no wings, no circular saucer, no twin transport cargo pods.
Style: mature mid-century space-program illustration / printed astronomical field manual. Strong clean petrol-ink outer silhouette (#103e4c), warm ivory armor (#dfd0ab), mineral teal hull panels (#197d82). Fine restrained screenprinted stippling in shadowed panels, hand-inked contour quality, 3-4 broad tones, high contrast large shapes that remain readable when the ship is just 26px long. Details should be subordinate to the silhouette. Surface lighting is soft and near-overhead so the sprite can rotate in a 2D map without an obvious directional cast shadow. No ground shadow, no perspective foreshortening, no isometric tilt.
NO exhaust flame, NO engine trail, NO glow, NO particles, NO combat or damage effects, no stars, no planets, no orbit rings, no badges, no text, no labels, no logo, no frame. The only visible object is this one ship. The attached screenshot is solely for style; do not copy its UI or backdrop.

## Planet texture wrapping revision

Use case: precise-object-edit.
Edit this exact illustrated planet equirectangular surface map. Keep all the existing atlas palette, continents, ink stippling, printed character and full-bleed 2:1 rectangular format. Keep its center 75% essentially unchanged.
Fix the horizontal wrapping seam for use on a rotating globe: create a smooth continuous deep petrol OCEAN MERIDIAN along BOTH the leftmost 8% and rightmost 8% of the image, with no cut-off land or islands at either extreme edge. Both extreme edges must be the SAME solid deep petrol ocean color (#104450) at each latitude, fading into the existing coastlines inward. Top and bottom may retain polar texture but they also must match at the LEFT/RIGHT seam. This is a horizontally seamless cylindrical planet texture.
No globe, no lighting, no shadow, no atmospheric effect, no extra borders or text; fully opaque unlit flat world map. Preserve the illustrated artwork and existing broad organic landmasses. The requested edit is ONLY edge-seam repair.

