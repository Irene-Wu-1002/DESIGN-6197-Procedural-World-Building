# Week 5: Distributions — A Procedural World

[← Class-notes index](README.md) · [← Main README](../../README.md)

Prototype tab: **Week 5 — Distributions** · Code: [`Week5Scene.jsx`](../../react-practice/src/components/Week5Scene.jsx), [`PathsPanel.jsx`](../../react-practice/src/components/PathsPanel.jsx), [`ScatterLayerPanel.jsx`](../../react-practice/src/components/ScatterLayerPanel.jsx), [`WindPanel.jsx`](../../react-practice/src/components/WindPanel.jsx), [`utils/`](../../react-practice/src/utils/)

![Week 5 tab: noise terrain with lakes, rivers, roads between windmills, scattered trees, bushes and rocks, and the Paths panel](../assets/screenshots/week-5-procedural-world.png)

## What I Built

Starting from an empty canvas, I built a small **procedural world** in layers. Each layer reads the data made by the layers before it:

1. **Noise terrain:** a height field from layered Perlin noise. Flat ground is grass and steep ground is rock.
2. **Scattering:** pine trees, round trees, bushes, rocks, and windmills, each placed by its own **placement rules** (a "protocol").
3. **Terrain-driven variation:** each tree, bush, and rock changes size, shape, colour, and density with the ground it stands on.
4. **Splines:** generated **rivers** that run downhill into lakes, and **roads** that link the windmills, with small bridges.
5. **Wind:** one wind field that blows **leaves, seeds, and road dust**, sways the trees, and turns the windmills.

Everything comes from seeds, so the same settings always rebuild the same world. The control panel has four tabs: **Terrain | Paths | Scatter | Wind**.

### The world pipeline

Rivers change the ground, windmills depend on the ground, roads depend on the windmills, and trees depend on the roads. So the world is built in a fixed order, and each step is **cached**. A tree slider re-runs only the last step and never re-routes the roads.

```text
1. heights from noise
2. rivers traced downhill and carved into the ground
3. terrain maps (slope, cliffs, water incl. rivers, moisture, sun)
4. windmills placed
5. roads routed between the windmills, ground flattened under them
6. terrain maps again (adds "distance to road")
7. trees, bushes, rocks scattered (windmills keep their spots)
8. wind field built from the final terrain and trees  →  particles every frame
```

## Key Ideas

- **Height field:** a grid of heights (201 × 201 points over 40 × 40 m) from fractal Perlin noise. Octaves add detail, persistence sets how strong the detail is, and lacunarity sets how much finer each octave is.
- **Slope-based colour:** the angle of each point's surface normal decides grass or rock, with a soft 4° blend.
- **Terrain data maps:** values computed once per terrain and shared by everything: height (0–1), slope, sun exposure, moisture, and distances to the nearest cliff, water, and road. The distances come from a **distance transform**, a two-pass sweep over the grid that gives every cell its distance to the nearest feature.
- **Distributions:** **Poisson disk** sampling gives evenly spaced points. Masking it with a **noise field** makes groves with clearings. **Instancing** draws every tree of one kind in a single draw call.
- **Placement protocol:** every asset layer is filtered by the same rules (surface, slope, height, cliff, water, road, spacing), and nothing overlaps, thanks to a spatial hash of placed footprints.
- **Pit filling (priority flood):** fills hollows in the height grid so every point has a downhill route to a lake or the map edge. Rivers follow that route.
- **Cheapest-path routing (A\*):** roads search a grid where each step costs more the steeper the road climbs. Lakes and cliffs are blocked, and crossing a river costs extra (and becomes a bridge). A **minimum spanning tree** picks which windmills to link.
- **Splines:** grid paths are thinned and smoothed with **centripetal Catmull-Rom** curves, then resampled at even spacing.
- **Wind field:** the base wind is changed by the terrain (faster on hills, calm behind ridges and forests, rising up slopes), then **gusts** (moving noise) and **turbulence** (curl noise, swirls that never pile up) are added each frame.
- **Particle pool:** preallocated arrays for thousands of particles, with no new memory each frame. Particles collide with the ground, rest, or float on water.
- **Vertex-shader sway:** trees bend on the GPU. The bend grows with the square of height, so the trunk base stays put.

## Parameters

### Terrain tab

| Control | Range (default) | Meaning |
| --- | --- | --- |
| **Seed** | 0–999 (5) | Which random landscape. |
| **Scale** | 0.01–0.2 (0.06) | Noise frequency; higher gives smaller, busier hills. |
| **Height** | 0–15 (6) | How tall the hills are. Taller hills have steeper sides, so more rock. |
| **Octaves** | 1–8 (5) | Layers of detail. |
| **Persistence** | 0.1–0.9 (0.5) | How strong each finer layer is. |
| **Lacunarity** | 1.5–3.5 (2) | How much finer each layer gets. |
| **Rock slope** | 0–60° (30°) | Steepness where grass turns to rock. Asset rules follow it. |
| **Show water / Water level** | on, 0–60% (20%) | A lake plane at this share of the height range. |

### Paths tab

**Rivers**

| Control | Range (default) | Meaning |
| --- | --- | --- |
| **Show rivers** | on | |
| **River count** | 0–4 (2) | Springs are at least 10 m apart; the header shows how many found room. |
| **River seed** | 0–999 (3) | Which springs are picked. |
| **Lowest spring height** | 30–90% (55%) | Rivers start on ground at least this high. |
| **Width at mouth** | 0.5–3 m (1.8) | Width grows from 0.5 m at the spring to this. |
| **Channel depth** | 0–1.5 m (0.6) | Depth grows downstream; the water surface never flows uphill. |

**Roads**

| Control | Range (default) | Meaning |
| --- | --- | --- |
| **Show roads** | on | |
| **Road to map edge** | on | One extra road from the windmill nearest the edge, off the map. |
| **Allow bridges** | on | Off forces roads to go around rivers. |
| **Road width** | 0.8–3 m (1.6) | The ground is flattened under the road and blended over a 1 m shoulder. |
| **Slope avoidance** | 0–100% (60%) | 0 runs straight over hills; 100 takes long, gentle detours. |

### Scatter tab

Global: **Scatter seed** (7) and **Preview on ground**. The preview tints the terrain with the open layer's rules, or with the moisture, sun, altitude, road-distance, or wind-speed map.

Each layer has its own **protocol** and **terrain response**. Defaults:

| Layer | Amount | Surface | Max slope | Height band | Cliff buffer | Road buffer | Water | Spacing | Grouping |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Windmills** | 3 (count) | grass | 10° | 55–100% | 2 m | — | avoid, ≥ 4 m | 12 m | scattered |
| **Rocks** | 40% | rock | 90° | 0–100% | off | 0.8 m | ignore; shallow water allowed | 1.2 m | scattered |
| **Pine trees** | 60% | grass | 30° | 30–100% | 0.5 m | 1 m | avoid, ≥ 1.5 m | 1.3 m | groves |
| **Round trees** | 50% | grass | 25° | 0–70% | 1 m | 1 m | avoid, ≥ 0.5 m | 1.5 m | groves |
| **Bushes** | 50% | any | 35° | 0–100% | off | 0.5 m | near, ≤ 6 m | 1 m | groves |

- **Placement order:** windmills → rocks → pines → round trees → bushes. Earlier layers claim space first.
- **Groves:** density means how much of the land the groves cover. **Scattered:** density is the chance to keep each candidate point.

**Terrain response** (per layer, 0–200%, default 100%) sets how strongly the ground shapes each instance. **Random variation** (0–100%, default 30%) is plain per-instance noise on top.

| Layer | Size | Shape | Colour | Density |
| --- | --- | --- | --- | --- |
| **Pine trees** | bigger when moist; stunted near the top and next to cliffs | narrow deep in a grove, wider at its edge; lean up to 6° downhill | blue-green when moist, yellow-olive when dry or high, lighter in sun | soft treeline over the top 20% of the height range |
| **Round trees** | bigger when moist, smaller on slopes | wider canopy in the open; lean downhill | rich green when moist, yellow-green when dry, warmer in sun | thinner on dry ground |
| **Bushes** | biggest at the shore | slightly wider when moist | deep green when wet, olive when dry | thinner on dry ground |
| **Rocks** | boulders on steep ground and under cliffs, pebbles by the water | flatter and rounder by the water | darker when wet, paler up high, moss on shaded damp rock | — |
| **Windmills** | — | all face into the wind | — | — |

### Wind tab

| Control | Range (default) | Meaning |
| --- | --- | --- |
| **Pause / Play wind** | playing | Freezes particles, sway, and blades. |
| **Wind direction (from)** | 0–359° (45°) | Where the wind comes from; windmills face it. |
| **Strength** | 0–15 m/s (6) | Base wind speed. |
| **Gustiness** | 0–100% (40%) | Strength of the gust patches that sweep downwind. |
| **Turbulence** | 0–100% (30%) | Small swirls, stronger behind ridges and forests. |
| **Terrain influence** | 0–150% (100%) | Hill speed-up, shelter, steering around hills, updrafts, forest drag. |
| **Show wind field** | off | Short streaks that ride the wind just above the ground. |
| **Leaves** | on, 60% (max 1,000) | Shed by exposed trees in the tree's own colour; tumble, land, float on water, and are lifted again by strong gusts. |
| **Seeds & pollen** | on, 50% (max 5,000) | Light fluff from sunny grass and bushes; rides updrafts. |
| **Road dust** | on, 50% (max 800) | Puffs off the roads only while a gust passes. |
| **Tree sway** | on, 0–200% (100%) | Pines are stiffer than round trees; sheltered trees sway less. |

## How It Was Built

I worked in steps, writing and reviewing a plan before each one, and checked each step with Node tests and headless-browser screenshots.

| Step | What changed | Problems found and fixed |
| --- | --- | --- |
| Empty canvas → terrain | Noise height field, grass/rock by slope, shadows | Camera too close; pulled back to fit the whole terrain. |
| Scattering | Five low-poly assets, instancing, no-overlap check | Density slider stopped working above ~40% (groves filled up). Density now means grove coverage. Rocks hung over the map edge; added a "reach" margin. |
| Layer protocols + water | Per-layer rules, lakes, rule preview overlay | A 3 m cliff buffer left only one windmill; tuned the defaults to 2 m and 55% height. |
| Terrain variation | Moisture and sun maps, response tables, sway-ready parts | Rocks grew 50% too big on steep ground; centred the steepness term so only unusual spots grow. |
| Rivers + roads | Pit filling, carving, A* roads, bridges, road buffers | Roads up to 33% steep: the cost now charges the road's own climb (now about 13%). Smoothed roads clipped cliff corners; cells next to cliffs are blocked. |
| Wind | Wind field, particles, sway shader, Wind tab | The simulation ran in slow motion on slow frames; long frames are now split into small steps. The wind map was washed out; it now uses its own calm-to-windy range. |

**Measured** (default settings, Node tests on this machine):

- Full world rebuild after a terrain change: 30–100 ms.
- Scatter only: about 20 ms.
- Wind field: 7 ms to build, 0.25 ms per frame.
- Particles: 0.4–0.65 ms per frame.
- 0 placement-rule violations across all test terrains.
- Rivers never flow uphill; roads never enter a lake or cross a cliff.
- Seeds drift within 3–7° of the wind direction.

## Why I Built This

Week 5 turns the earlier studies into the building blocks of the **ant micro-world** project:

- **Distributions with rules** are how ground cover will be placed: pebbles with Poisson spacing, moss in noise-clustered patches, mushrooms where it's damp. The protocol (surface, slope, water, distance buffers) carries over directly.
- **Terrain data maps** (slope, moisture, sun, distances) are the same maps the micro-world needs to decide where moss, fungi, and ants go.
- **Splines** ([`splines.js`](../../react-practice/src/utils/splines.js)) are reusable for **ant trails** and **roots and mycelium**.
- **The particle pool** ([`particles.js`](../../react-practice/src/utils/particles.js)) is reusable for rain, spores, pollen, and the ants' scent trails.
- **The cached pipeline** keeps the world interactive as more layers are added.

## Limitations and Next Steps

- **Hand-drawn paths:** paths are generated only. Drawing rivers or roads by clicking on the terrain would need ray picking.
- **Bridges are rare at the defaults,** because crossing a river is expensive; raising slope avoidance or adding rivers shows them.
- **Wind is 2D near the ground,** with a simple height profile. It isn't a full 3D fluid simulation.
- **Particles run on the CPU** (about 7,000 at the defaults). Rain or mist with 100k+ particles would need a GPU version.
- **Sway doesn't move the shadow coordinates** on the ground. The swaying shadows themselves are drawn, so the difference is small.
- **Next particle ideas:** river flow and foam, rain and runoff, valley mist, fireflies (with a time-of-day slider), and hydraulic erosion that reshapes the terrain itself.
