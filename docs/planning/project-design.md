# Project Design — A City Built Inside Giant Trees

[← Planning index](README.md) · [← Main README](../../README.md)

## Concept

| City inside the trunk | Village among the roots |
| --- | --- |
| <img src="../assets/screenshots/ideas-concept-in-hole.png" alt="A city seen through huge round openings in a giant hollow trunk, with floating green platforms" width="380"> | <img src="../assets/screenshots/ideas-concept-in-roots.png" alt="Glass-dome buildings, paths, and a stream winding between giant tree trunks" width="380"> |
| Round portals open the trunk to the sky; platforms and parks hang inside the hollow — the model for the **trunk / industrial district** and the portals in the Project tab. | Domed homes, footpaths, and a river at the base of the trees — the mood for the **root-level underground city** and the ground layer. |

*Concept reference images from a mood board (third-party artwork, not my own), used for inspiration.*

A City Built Inside Giant Trees  
Several impossibly large trees contain an entire world. Different parts of the trees become different urban layers: roots form underground cities, trunks contain dense industrial districts, branches support villages, and the canopy reaches into a completely different climate.

## Why I chose this concept

I wanted to build a world that feels both natural and architectural. A giant tree gives me a clear vertical structure, but each layer can still have its own environment, culture, and atmosphere. It also lets me experiment with scale, exploration, and environmental transitions instead of creating just one flat landscape.

## Techniques I can use

- Voxels: build the main terrain, giant tree forms, caves, and layered environments.
- Noise: use Perlin or Cellular Noise to create irregular roots, bark, terrain, cliffs, and organic shapes.
- Procedural generation: generate branches, roots, villages, and environmental details with controlled randomness.
- Seed + deterministic generation: recreate the same world while testing different parameters.
- Meshing: convert voxel structures into smoother 3D surfaces.
- Different resolutions: use larger voxels for the overall tree structure and finer detail for villages or interiors.
- Shaders / atmosphere: create fog, rain, light, moisture, and different climates at different heights.

## Project Progress Tab — Giant Tree World

The **Project** tab in the web prototype is the first working version of this concept: a forest of 1–8 giant trees (the user chooses; default 3), each complete from root to canopy, with holes carved into every trunk. Full write-up, screenshots, and measurements: [Project Progress 01](../class-notes/project-01-giant-trees.md).

![Three giant trees in the Project tab](../assets/screenshots/project-giant-trees.png)

### Techniques used

| Technique | How it is used in the tab |
| --- | --- |
| **Signed distance fields (voxel density)** | Each tree is a set of simple shapes (tapered tubes and squashed spheres). The density at any point is the negative distance to the tree surface: positive means wood, negative means air. |
| **Procedural generation** | Roots arch out and dive into the ground. The trunk leans and wobbles. Branches curl upward, each with one fork. Foliage pads cluster at branch tips and the crown. |
| **Seed + deterministic generation** | One world seed gives each tree its own seed, so the trees differ, but the same seed always rebuilds the same world. The **Trees** slider sets how many grow: one stands in the centre, two to five form a ring that widens to keep a constant gap, and six or more add a centre tree inside the ring. |
| **CSG** | Segments of one root or branch join with a hard minimum. Separate roots and branches are **smooth-unioned** into the trunk, which creates the flared buttresses. **Portals** (round tunnels) and an optional **hollow core** are subtracted last. |
| **Noise** | 3D value noise adds vertical bark ridges and broad lumps (outward only, so walls never thin). Stronger fBm makes the canopy pads look leafy. |
| **Meshing** | Marching Cubes turns the density field into a smooth triangle surface. Round portals need this; blocky voxels would lose their shape. |
| **Chunking + multi-resolution** | The world is split into 16³-cell chunks. Chunks no shape can reach are skipped, and each chunk evaluates only nearby shapes. Low / Medium / High presets change the cell size (1.6 / 1.1 / 0.8 m). |
| **Shaders & fog** | Vertex colours separate damp roots, bark, moss, leaves, and warm heartwood inside the holes. A height-fog shader patch makes the ground misty and the canopy clear, so each layer reads as its own climate. |

### System structure

```text
ProjectScene.jsx  (React UI + Three.js scene)
  │  parameters: seed, tree shape, holes, resolution
  ▼
giantTreeWorker.js  (Web Worker, off the main thread)
  │
  ├─ giantTrees.js  createWorldBlueprint()  → 1–8 trees as primitive lists
  │                 planChunks()            → chunks near a tree, bottom to top
  │                 sampleRegionDensity()   → density = SDF + CSG + noise
  │                 colorChunkVertices()    → natural + city-layer colours
  │
  ├─ chunkMesher.js sampleChunkField()      → padded density grid per chunk
  │                 polygonizeChunk()       → Marching Cubes triangles
  │
  └─ noise3d.js     valueNoise3D / fbm3D / seeded random
  │
  │  streams finished chunks back in batches
  ▼
ProjectScene.jsx  → one mesh per chunk, shadows, height fog, growth clip
```

- **UI layer:** `ProjectScene.jsx` owns the scene, camera, lights, ground, fog, and control panel. Changing a shape parameter restarts the worker; view settings such as colouring, fog, wireframe, chunk bounds, and growth update instantly without regenerating.
- **Generation layer:** the worker builds the blueprint, plans the chunks, and meshes them one by one. Chunks come back bottom to top, so the trees visibly grow from the roots while generating.
- **Geometry layer:** `giantTrees.js` holds all tree rules and the density function. `chunkMesher.js` is a general-purpose Marching Cubes mesher. It samples one extra ring of points around each chunk, so neighbouring chunks meet without cracks.

### How the tab maps to the urban layers

| Tree part | Future city layer | Shown in the tab as |
| --- | --- | --- |
| Roots | Underground city | Dark, damp root colouring; blue in the city-layer view |
| Trunk + portals | Industrial district | Hollow trunk with round portals; warm heartwood walls |
| Branches | Villages | Lighter, mossy limbs; yellow in the city-layer view |
| Canopy | Different climate zone | Foliage pads above the fog line |

### Next steps

- Platforms, floors, and bridges inside the portals — the first city geometry.
- Lights on the heartwood walls so the interiors read as inhabited.
- Different interiors per layer (root halls, trunk shafts, branch villages).
- Save/load tree worlds with Firebase.
- Terrain and rivers around the roots instead of a flat ground.
