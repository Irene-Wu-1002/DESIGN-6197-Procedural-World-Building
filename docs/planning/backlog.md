# Feature Backlog

Features for **Umwelt: A Micro World Through an Ant's Eyes**, grouped by priority. The
design, scale table, and techniques are in [`project-design.md`](project-design.md).
Checkboxes are updated as work is completed. Items move up or down as I learn what is
actually feasible.

**Status key:** `[ ]` not started · `[~]` in progress · `[x]` done

---

## P0 — Endless Height Field

The ground and the streaming system. Everything else is placed on top of it.
*(Milestone 1 · Map tab, first version)*

- [ ] **World height function** — `height(x, z, seed)` in real metres, built from
  `utils/noise.js`: fBm at about 30 cm, 3 cm, and 2 mm wavelengths, plus domain warping.
  The same position and seed always give the same height.
- [ ] **Position-based stamps** — pebble domes, dents, and the ant-hill mound with an
  entrance crater at the origin. Stamps are decided by hashing world cells, never kept in
  a global list, so any tile can be built on its own.
- [ ] **Data maps** — slope, curvature, and moisture computed from `height()` with finite
  differences, so they match across tile edges.
- [ ] **Tile streaming** — 20 cm × 20 cm tiles stored in a `Map` by `"i,j"`. A ring of
  about 5 tiles stays loaded around the viewer; tiles that leave the ring are disposed or
  pooled. Walking away and coming back shows the same ground.
- [ ] **Seamless tile edges** — neighbouring tiles sample the same world points at their
  edges, and normals come from `height()`, not `computeVertexNormals()`.
- [ ] **Build queue / Web Worker** — new tiles are built 1–2 per frame or in a worker (as
  in the Week 3 voxel study), so walking never drops frames.
- [ ] **Height and moisture colouring** — dry sand on ridges and dark damp soil in hollows,
  from the data maps.
- [ ] **Human camera with W A S D** — orbit view of the patch that moves the streaming
  centre.
- [ ] **Hide the edge of the world** — fog or depth of field fades out the loaded ring.

## P1 — Ground Cover and Landmark

The objects that make the ground read as a forest floor at ant scale.
*(Milestones 2–3)*

- [ ] **Per-tile scattering** — each tile gets `tileSeed = hash(i, j, worldSeed)` and
  runs the Week 5 `distributePoints`, offset into world space.
- [ ] **Seamless scattering across tile borders** — switch pebbles to a jittered
  one-candidate-per-cell scheme (or accept only points whose cell is inside the tile) so
  Poisson spacing holds across edges.
- [ ] **Placement filters** — no moss on steep slopes, more mushrooms where it is wet,
  driven by the data maps.
- [ ] **Surface alignment** — every object samples the height under it and tilts to the
  surface normal.
- [ ] **Instanced ground cover** — pebbles and sand stones (Poisson), moss and grass
  (noise clustered), fallen leaves and twigs (random + rotation), with per-instance size,
  rotation, and colour from the seed. Instances are removed together with their tile.
- [ ] **Procedural fly agaric** — lathe stem and cap from profile curves, noise-bent stem
  and uneven cap edge, radial gills.
- [ ] **Spot shader** — raised white Voronoi spots on the red cap.
- [ ] **Growth stages** — button → open cap → flat and old, chosen by seed.
- [ ] **Region-based mushroom placement** — mushrooms are decided on a coarser grid (about
  1 m regions) so a mushroom is never cut off at a tile edge; a large fly agaric always
  stands next to the starting ant hill.

## P2 — Ant Camera and Perception Modes

Seeing the same world through the ant's senses. *(Milestones 4–5)*

- [ ] **Ant camera** — wide, low camera about 2 mm above the surface that walks on the
  height field with W A S D, plus a run key for exploring.
- [ ] **Depth precision at 2 mm** — `logarithmicDepthBuffer` (or a scaled unit) so near
  and far geometry don't z-fight.
- [ ] **Floating origin** — keep the camera near (0, 0, 0) and shift the world, so
  positions don't jitter after a long walk.
- [ ] **LOD rings** — dense tiles near the camera and coarse ones farther out, with skirts
  to hide cracks between resolutions. Fine 2 mm grain as a normal map.
- [ ] **Macro depth of field** — tiny focus distance so the world reads as microscopic.
- [ ] **Mode switcher** — Human / Ant vision / Smell / Underground. Switching changes only
  cameras and shaders, never the geometry.
- [ ] **Ant-vision post-process** — hexagonal compound-eye cells, lower sharpness, and a
  colour shift toward UV / blue-green.
- [ ] **Smell mode** — pheromone trails as glowing ribbons that fade over time while the
  rest of the world dims.

## P3 — Underground and Ant Agents

The hidden second world and the living paths across the surface. *(Milestones 6–7)*

- [ ] **Mycelium network** — space colonisation per region, rooted at that region's
  mushrooms, with fixed links to neighbouring regions so the network continues
  endlessly.
- [ ] **Pulse shader** — light waves running along each strand (*Poetics of Soil*).
- [ ] **Underground cutaway** — the surface becomes translucent or is cut away to reveal
  the network.
- [ ] **Ant tunnels** — tube meshes along tunnel paths below the ant hill (the height
  field cannot make caves).
- [ ] **Ant agents** — ants walk the height field and prefer gentle slopes.
- [ ] **Pheromone grid** — trails that fade over time, stored in a sparse map per tile
  because they are not seed-based and can't be regenerated.
- [ ] **Vector field** — slope and pheromone strength combined into a direction field the
  ants follow, so paths form on their own.
- [ ] **Ride an ant** — the ant camera follows one agent along its path.

## P4 — Look Development and Stretch Goals

Only if time allows.

- [ ] **Translucent leaves and moss** — fake subsurface scattering when the sun is behind
  them.
- [ ] **Dew drops** — refractive spheres showing a tiny upside-down image of the world.
- [ ] **Dust and spores** — GPU particles drifting in light shafts.
- [ ] **Weather** — sun, clouds, and rain at ant size (a raindrop as a falling boulder).
- [ ] **Local erosion** — thermal or hydraulic erosion per tile with a margin, or faked
  with noise, without breaking determinism.
- [ ] **Local SDF patches** — small voxel/SDF pieces (Weeks 3–4) only where overhangs are
  really needed.
- [ ] **Sound** — soil and forest-floor sounds, as in both references.
- [ ] **Concept tab content** — concept, references, and the scale table with images.
- [ ] **Save/load worlds** — store seed and parameters with the Firebase service.
- [ ] **Performance profiling pass** — measure tiles loaded, draw calls, and frame time,
  then document what each optimisation bought.

---

## Notes

- P0 should be working end to end before ground cover starts: every later item assumes
  `height()` and tile streaming.
- The determinism rule applies everywhere: anything generated must come from world
  position plus seed. Only pheromones are stored state.
- Each completed feature should produce a tutorial in [`../tutorials/`](../tutorials/) so
  the technique is recorded, not just the result.
