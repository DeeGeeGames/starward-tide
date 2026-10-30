# Runtime fleet models

Derivatives of the branch's approved `docs/experiments/capital-ship-3d/v3` warship and `docs/experiments/fleet-3d` carrier, transport, and orbital platform. Original GLBs and editable Blender sources remain in those directories.

Rebuild from the repository root with `bun scripts/prepare-fleet.ts` (glTF Transform 4.5.1). The pipeline joins compatible primitives, welds, simplifies within 0.3% error (2% for the overview warship), and prunes unused data. No decoder or external texture requests are required. Material names remain intact for faction accents, including the warship's `Faction` enamel.

| Asset | Triangles | Primitives | Bytes |
| --- | ---: | ---: | ---: |
| Warship | 6,478 | 8 | 215,888 |
| Warship overview | 2,574 | 8 | 117,764 |
| Carrier | 3,488 | 6 | 186,952 |
| Transport | 1,376 | 6 | 66,084 |
| Defense platform | 1,480 | 6 | 74,940 |

Runtime preparation bakes transforms, centers each model's bounds, and normalizes its +X hull length to one unit (glTF +Y up). Instance transforms apply map positions, headings, and class lengths; faction accents receive per-instance colors. Hulls share geometry and materials across factions. Offscreen hulls are culled before batching, and batches grow geometrically. Game rules, collisions, and saves retain the existing planar coordinates; no model geometry is used for physics.

Warships use the overview derivative below a 45 CSS pixel hull length, switching to the detailed mesh when zoomed in. Both levels are derived from the same authored model. Other unit classes retain their prepared meshes at every zoom.

Bun emits imported GLBs as hashed assets. The service worker precaches them for offline play, including when hosted at a subpath.
