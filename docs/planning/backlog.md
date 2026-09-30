# Feature Backlog

Features I would like to implement over the semester, grouped by priority. Checkboxes are
updated as work is completed. Items move up or down as I learn what is actually feasible.

**Status key:** `[ ]` not started · `[~]` in progress · `[x]` done

---

## P0 — Foundations

The core terrain and scattering pipeline. Everything else depends on these.

- [ ] **Heightfield terrain generator** — Houdini heightfield network driven by layered
  noise, exposed as an HDA with controls for scale, octaves, and erosion strength.
- [ ] **Hydraulic erosion pass** — realistic water-carved valleys and sediment deposition,
  with masks output for downstream scattering.
- [ ] **Slope and altitude masks** — reusable mask generation so material and scatter
  layers respond automatically to terrain shape.
- [ ] **Point scattering system** — density-driven scatter with masks, jitter, and
  per-instance random scale/rotation.
- [ ] **Houdini to Unreal export pipeline** — reliable round-trip of terrain and point
  data, documented as a tutorial so it is repeatable.

## P1 — World Systems

Systems that turn terrain into a believable place.

- [ ] **Procedural river networks** — flow paths that follow terrain gradient, carve banks,
  and remain continuous downhill.
- [ ] **Biome distribution** — temperature/moisture map driving which vegetation and
  material sets appear where, with blended transitions instead of hard edges.
- [ ] **Road and path generation** — least-cost pathfinding across the heightfield that
  avoids steep slopes and flattens terrain along its route.
- [ ] **Modular rock and cliff library** — a small set of procedurally generated meshes
  with LODs, varied enough to avoid visible repetition.
- [ ] **Procedural vegetation** — at least one tree species built parametrically, with
  variation driven by a seed parameter.

## P2 — Structures and Detail

- [ ] **Building generator** — parametric structures from a footprint, with floors, roofs,
  and openings driven by attributes.
- [ ] **Settlement layout** — placing buildings along generated roads with sensible
  spacing, orientation, and terrain conforming.
- [ ] **Wall and fence system** — geometry that follows a curve and adapts to terrain
  height without floating or clipping.
- [ ] **Debris and clutter scatter** — small-scale detail pass that reads existing masks
  to make spaces feel inhabited.

## P3 — Look Development and Presentation

- [ ] **Layered landscape material** — auto-blending by slope and height, with distance
  tiling breakup.
- [ ] **Time-of-day and weather setup** — lighting presets that let the same world be
  presented under different conditions.
- [ ] **Cinematic camera flythrough** — a rendered sequence of the final world for the
  end-of-semester submission.

## P4 — Stretch Goals

Only if time allows.

- [ ] **Wave function collapse experiment** — tile-based layout generation as an
  alternative to noise-driven placement.
- [ ] **Custom Python tooling** — batch export and asset-naming utilities to reduce manual
  steps in the pipeline.
- [ ] **Runtime PCG in Unreal** — generating content at play time rather than baking it,
  to compare cost and control against the offline approach.
- [ ] **Performance profiling pass** — measure draw calls and frame time, then document
  what optimization actually bought.

---

## Web Prototype Track — Giant Tree City

Built in the **Project** tab of `react-practice/`. See
[Project Progress 01](../class-notes/project-01-giant-trees.md).

- [x] **Three seeded giant trees** — roots, trunk, branches, and canopy from one density field.
- [x] **User-chosen tree count** — 1–8 trees; the layout, camera, shadows, and fog adapt.
- [x] **Portals and hollow core** — round tunnels subtracted from each trunk.
- [x] **Chunked Marching Cubes in a Web Worker** — seamless chunks, streamed root to top.
- [x] **Layer colouring and height fog** — roots / trunk / branches / canopy read as separate zones.
- [ ] **Platforms and bridges in the portals** — first city geometry inside the trees.
- [ ] **Lights on heartwood walls** — show that the interiors are inhabited.
- [ ] **Save/load tree worlds** — extend the Firebase service beyond the Week 3 schema.

## Completed

- Three giant trees with portals (web prototype) — 2026-09-30.

## Notes

- P0 items should be finished before mid-semester; the later tiers assume that pipeline
  works end to end.
- Each completed feature should produce a tutorial in [`../tutorials/`](../tutorials/) so
  the technique is recorded, not just the result.
