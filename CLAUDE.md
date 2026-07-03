# Wildcraft

A 3D survival crafting game built with Three.js. Voxel world with smooth
heightmap terrain, destructible blocks, trees with health, mining down to
stone and ores, and a building/crafting system (planks, beams, walls,
fireplaces, arches, decorations).

## Run it
From the project root:
```
python3 -m http.server
```
Then open http://localhost:8000 in a browser.

## Architecture
- Voxel world stored as chunks of Uint8Array block IDs.
- Smooth terrain via fractal simplex noise heightmap + 3D noise for caves/ores.
- Per-chunk face-culled meshing with procedural canvas textures.
- First-person controls (pointer lock) with AABB physics vs voxels.
- Per-block target highlight via voxel raycast (DDA).
- Trees are a special placed structure with a `health` map keyed by block pos.
- Inventory is a flat map {blockId: count}; crafting is recipe-driven.

## Module layout
See `js/` — engine (renderer/loop/input), world (blocks/noise/chunk/mesher/
worldgen/textures), entities (player), gameplay (mining/placing/crafting/
inventory/recipes/health), ui (hud), save (saveManager).

## Tunables
All gameplay numbers live in `js/config.js`. Edit there, not in modules.
