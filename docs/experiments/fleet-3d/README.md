# Low-poly fleet models

Three static 3D assets in the approved warship v3 material style. Reference silhouettes were read from `origin/master` revision recorded in `references/source-revision.txt`; copies of the actual carrier, transport and platform sprites are included. The initial experiment checkout predated those sprites; these reference copies pin the artwork used to author the models. No runtime files are changed by the exploration.

| Asset | Triangles | GLB size | Render primitives |
| --- | ---: | ---: | ---: |
| Carrier | 3,952 | 205 KB | 8 |
| Troop transport | 1,412 | 69 KB | 8 |
| Orbital defense platform | 1,552 | 78 KB | 6 |

Each asset directory contains an editable `.blend`, optimized `.glb`, isometric/aft PNG renders, and Khronos validation report. The approved normal warship remains unchanged in `../capital-ship-3d/v3/`.

## Design and runtime conventions

Carrier: thick lower hull, twin hangar shoulders, recessed central channel, elevated aft bridge, four drives and small defensive batteries. Transport: paired armored troop pods, narrow command fuselage, three drives, no main battery. Platform: circular armored base, four cardinal blocks and twin cannons.

All models face +X. Up is Blender +Z / glTF +Y. Origins are at the central hull coordinate, with identity root transforms. Dimensions use the same illustrative design units as the sample; relative scales are provisional. Each model uses six reusable materials and no textures. `Faction_Accent` is a distinct cyan material for later faction tinting. Lighting and cameras are in the Blender source only. GLB files include emissive-strength metadata and require no mesh-compression decoder.

Single-segment chamfers and 8–16-sided sections reduce geometry while preserving volume. Optimized exports join static surfaces. Turrets are editable individual pieces in Blender but are not animation-rigged in the joined GLB. Collision proxies and LODs are not supplied; this is a small static fleet asset set for future integration. Draw counts are geometry counts, not fleet performance benchmarks.

## Reproduction and validation

Run `build_fleet.py` in Blender; it creates separate scenes without clearing existing scenes. Output paths resolve relative to the saved script. It writes raw exports beside the source assets. Run the optimization command from this fleet-3d directory. Optimize each raw export with glTF Transform 4.5.1, for example:

```sh
bun x @gltf-transform/cli@4.5.1 optimize carrier/carrier.raw.glb carrier/carrier.glb --compress false --simplify false --texture-compress false --instance false --palette false
```

All final GLBs pass Khronos validation with zero errors or warnings. Informational notices identify six degenerate bevel triangles in the transport and forty in the carrier; the platform has no notices. `roundtrip-checks.json` records successful re-import of the optimized GLBs into temporary Blender scenes, finite geometry, triangle counts, bounds and the repaired carrier turret seating. Temporary verification scenes were removed.

Independent structural review completed; a small carrier turret mounting gap was repaired and rechecked. Front and aft renders were inspected. Project `bun run typecheck` and script syntax checks passed. This does not establish engine integration, fleet performance or owner visual acceptance. No gameplay files or existing samples were modified.
