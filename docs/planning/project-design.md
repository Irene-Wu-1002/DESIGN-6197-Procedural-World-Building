# Project Design — Umwelt: A Micro World Through an Ant's Eyes

[← Planning index](README.md) · [← Main README](../../README.md)

## Concept

An endless forest floor, seen from the height of an ant.

At human scale the ground under our feet is nothing: some soil, a few pebbles, fallen leaves, a clump of moss, a red fly agaric mushroom. At ant scale it becomes a whole world. Pebbles are boulders, moss is a dense forest, a dew drop is a lens the size of a car, and a mushroom is a tower that reaches into the light. Under the surface, a fungal network and the ants' own tunnels form a hidden second world.

The world is **unlimited**. The viewer starts at an ant hill beside a large fly agaric and walks with **W A S D**. New ground is generated ahead as they move, and the forest floor never ends. Walking back to a place shows exactly the same ground, because everything comes from one seed.

The project has three goals:

1. **Build the world:** a procedural micro landscape, mostly built as a **height field** (a grid of heights), with objects scattered across it.
2. **Make it endless:** stream the world in tiles around the viewer, so it can be explored forever at a steady frame rate.
3. **Change how it is perceived:** the same world can be seen through human eyes or through the ant's senses: blurry wide-angle vision, light humans can't see, and smell trails that are invisible to us.

The second goal comes from Jakob von Uexküll's idea of the **umwelt**: every animal lives in its own perceived world, shaped by its senses. A human and an ant standing in the same place do not experience the same place.

## References

### Marshmallow Laser Feast — *In the Eyes of the Animal* (2015)

[Project page](https://marshmallowlaserfeast.com/project/in-the-eyes-of-the-animal/)

A VR installation in Grizedale Forest that shows the same woodland through the senses of a mosquito, a dragonfly, a frog, and an owl. Each animal gets its own visual language. The mosquito senses carbon dioxide as swirling particle clouds, the dragonfly sees sharper detail and more colours, the frog's prey appears as coloured trails, and the owl has sharp distant vision but a blurry edge. The forest was captured with LiDAR, drones, CT scans, and photogrammetry and rendered in real time.

**What I take from it:**
- One world, several **perception modes**. Changing the senses changes the visuals, not the geometry.
- Invisible things (CO₂, smell, motion) can be **made visible** as particles and trails.
- A sense can be shown by what it **hides** (the owl's blurred edge) as much as by what it shows.

### Marshmallow Laser Feast — *Poetics of Soil: Fly Agaric I* (2025)

[Project page](https://marshmallowlaserfeast.com/project/poetics-of-soil-fly-agaric-i-video-installation/)

A multichannel video installation at Somerset House (part of *Soil: The World at Our Feet*). It centres on the fly agaric mushroom and the fungal networks in the soil, and visualises the "hidden rhythms" of soil as pulsing, living systems, with spatial sound and the voice of mycologist Merlin Sheldrake.

**What I take from it:**
- The **fly agaric** as the landmark of the world: instantly readable, with a strong red-and-white silhouette.
- The ground as something **alive**: a pulsing mycelium network underneath the surface.
- Soil life drawn at a scale where it becomes **monumental**.

## Why this direction

A height field is the cheapest technique that fits the ground, and the world it builds is naturally endless:

| Need | How the ant world answers it |
| --- | --- |
| Cheap to build | A height field grows with **area**, not volume. A 1000 × 1000 grid is 1 M samples, about 1000× fewer than a voxel block of the same resolution. |
| Detail without a scale gap | The detail *is* the natural surface: soil grains, moss, pebbles. |
| Simple methods per object | Everything is organic. Different object types (mushrooms, grass, leaves) each get a simple dedicated method. |
| Interesting parts in view | The ant camera walks on the surface, so the interesting parts are always in view. |
| Something new to discover | The world is unlimited. A height field is a function of position, so any amount of ground can be generated on demand, as in Week 2's infinite noise map. |

The feeling of **giant scale** comes from the ant's point of view, not from huge geometry: to an ant, the fly agaric is a 68 m tower.

## Scale

An ant is about 5 mm long and a person is about 1.7 m tall, a ratio of roughly **1 : 340**. Multiplying real sizes by 340 gives the ant's sense of scale:

| Real object | Real size | Feels like (× 340) |
| --- | --- | --- |
| Sand grain | 0.5 mm | 17 cm stone |
| Dew drop | 3 mm | 1 m glass sphere |
| Pebble | 1 cm | 3.4 m boulder |
| Moss clump | 2 cm tall | 7 m forest |
| Grass blade | 10 cm tall | 34 m tower |
| Fallen leaf | 8 cm wide | 27 m sheet, like a roof |
| Fly agaric | 20 cm tall | 68 m tower |
| One world tile | 20 cm × 20 cm | 68 m × 68 m block |
| Visible area around the ant | about 2 m across | about 700 m, a whole valley |
| Walking 1 km as a human | 1 km | 340 km, a long journey |

The world is modelled in real units (metres), and the ant camera sits about **2 mm** above the ground. Keeping real units makes the scale honest and makes the human ↔ ant switch a camera change, not a different world. The ant walks at a few centimetres per second in real units, so the world feels huge to cross. A "run" key can speed this up for exploring.

## World layers

| Layer | Contents | Main technique |
| --- | --- | --- |
| **Surface** | Soil, sand, small pebbles, bumps and cracks | **Height field** with layered noise |
| **Ground cover** | Moss, grass blades, fallen leaves, twigs, larger pebbles | **Distributions** + instancing on top of the height field |
| **Landmark** | One (or a few) fly agaric mushrooms | Procedural lathe mesh + shader spots |
| **Underground** | Mycelium network, ant tunnels | Branching growth (space colonisation) shown as glowing lines/points in a cutaway view |
| **Air** | Dust, spores, drifting light, dew | GPU particles, depth of field, light shafts |

## Perception modes (the umwelt)

The world stays the same; each mode changes only cameras and shaders.

| Mode | What it shows | How |
| --- | --- | --- |
| **Human** | The patch seen from above, at normal scale | Orbit camera, natural colours |
| **Ant vision** | Blurry, very wide view, low to the ground | Wide fisheye camera at ~2 mm height. A post-process pass breaks the image into hexagonal cells (compound eye), lowers sharpness, and shifts colours toward ultraviolet/blue-green. Ants see poorly but sense polarised and UV light. |
| **Smell** | Pheromone trails and the chemical landscape | Trails drawn as glowing ribbons that fade over time; the rest of the world dims. This makes an invisible sense visible, like the mosquito's CO₂ clouds in *In the Eyes of the Animal*. |
| **Underground** | The fungal network and tunnels | The surface becomes translucent or is cut away; mycelium pulses with light waves running along it (*Poetics of Soil*). |

## Techniques

### 1. Height field (core)

A height field stores one height per (x, z) grid point. The surface is a flat grid mesh whose vertices move up by that height. It is the main answer to the performance feedback.

- **Layered noise (fBm) at several scales:** large gentle slopes (about 30 cm wavelength), mid-scale bumps and hollows (about 3 cm), and fine grain (about 2 mm). Each octave adds smaller detail, which matters here because the camera goes from 1 m away down to 2 mm.
- **Domain warping:** distorting the noise input so soil looks pushed and settled, not regular.
- **Stamps:** extra shapes added into the height map, such as pebble bumps (rounded domes combined with `max`), footprint-like dents, and a raised ant-hill mound with a crater at the entrance.
- **Simple erosion (optional):** a few passes of thermal or hydraulic erosion to fill hollows with fine sand and sharpen ridges.
- **Data maps from the height field:** slope, curvature, and a "moisture" map (low and flat areas = wet). These drive colour, and later decide where moss and mushrooms grow.
- **GPU displacement:** store the heights in a texture and move the vertices in the vertex shader, so changing a parameter does not rebuild the mesh in JavaScript.
- **Level of detail:** the grid is dense near the camera and coarse far away (chunked LOD or a clipmap ring around the camera). Very fine grain is added as a **normal map** instead of real geometry.

**Limitation and plan:** a height field cannot make overhangs, caves, or tunnels, because each (x, z) point has only one height. The underground layer will be built separately (tube meshes along tunnel paths, and the mycelium as lines). Small local voxel/SDF patches (from Weeks 3–4) are an option, but only where they are really needed, never for the whole world.

### 2. Distributions (from Week 5)

The Week 5 study already compares four scattering methods. Each one fits a different kind of object:

| Object | Method | Why |
| --- | --- | --- |
| Pebbles, sand stones | **Poisson disk** | Natural spacing; stones don't overlap |
| Moss and grass | **Noise clustered** | Grows in clumps with bare patches |
| Fallen leaves | **Uniform random** + rotation | Scattered by wind |
| Mushrooms | **Noise clustered** with a moisture filter | Fungi grow in damp, shaded spots, sometimes in rings |

Placement is filtered by the height field's data maps (for example, no moss on steep slopes, more mushrooms where it's wet). Every object is placed on the surface by sampling the height there and tilting it to match the surface normal.

### 3. Instancing

Thousands of grass blades, moss strands, and pebbles are drawn as **instanced meshes** (one draw call per object type, as in Week 5). Size, rotation, and colour vary per instance from the seed.

### 4. Procedural fly agaric

- **Stem and cap from profile curves:** a 2D outline spun around the vertical axis (lathe geometry). Noise bends the stem and makes the cap edge uneven.
- **Gills** under the cap from radial ridges.
- **White spots** from a cellular (Voronoi) noise shader on the red cap. Each spot is slightly raised.
- **Seeded growth stages:** button → open cap → flat and old.

### 5. Paths and agents (planned)

- **Ant agents** walk across the height field, preferring gentle slopes. They leave pheromone that fades over time; other ants are drawn to stronger trails, so paths form by themselves.
- **Vector fields:** the slope of the height field and the pheromone strength combine into a direction field that the ants follow. This also links to the course topics on paths and vector fields.
- The ant-vision camera can **ride on one ant**, following its path and staying on the surface.

### 6. Mycelium network

- **Space colonisation** (a branching growth algorithm): growth tips move toward scattered attraction points under the soil and split as they go, like roots or hyphae. The network connects the mushrooms, linking surface and underground.
- Shown as **lines or point clouds** with a shader pulse running along each strand, the "hidden rhythm" from *Poetics of Soil*.

### 7. Shaders, light, and atmosphere

- **Macro look:** strong **depth of field** (tiny focus distance) so the world reads as microscopic, like macro photography.
- **Translucent leaves and moss:** light passing through thin surfaces (fake subsurface scattering) when the sun is behind them.
- **Dew drops:** refractive spheres that show a tiny upside-down image of the world.
- **Dust and spores:** GPU particles drifting in light shafts.
- **Height and moisture colouring:** dry sand on ridges, dark damp soil in hollows, from the height field's data maps.

### 8. Seeds and determinism

As in every earlier study, one seed rebuilds the same patch exactly: height field, scattered objects, mushrooms, mycelium, and ant starting positions.

## Planned system structure

```text
MicroWorldScene.jsx     React UI + Three.js scene, camera modes (human / ant / smell / underground)
  │  parameters: seed, terrain, cover density, mushroom, perception mode
  ▼
heightField.js          heights (fBm + warp + stamps + erosion) → Float32Array + texture
                        slope / curvature / moisture maps
  ├─ distributions.js   (Week 5) Poisson / clustered / random scattering, filtered by the maps
  ├─ groundCover.js     instanced pebbles, grass, moss, leaves placed on the surface
  ├─ flyAgaric.js       lathe stem + cap, Voronoi spot shader
  ├─ mycelium.js        space-colonisation network under the surface
  ├─ ants.js            agents, pheromone grid, vector field (planned)
  └─ shaders/           terrain displacement, ant-vision post-process, smell glow, DoF
```

## How the Project tabs are used

| Tab | Role |
| --- | --- |
| **Concept** | This concept, references, and the scale table, with images |
| **Map** | The working micro world: the height field first, then ground cover, the mushroom, and the perception modes |

## Milestones

1. **Height field terrain:** noise layers, stamps, data maps, GPU displacement, human camera. *(Map tab, first version)*
2. **Ground cover:** Week 5 distributions moved onto the height field with instancing.
3. **Fly agaric:** procedural mushroom and spot shader as the landmark.
4. **Ant camera:** low wide-angle camera that walks on the surface; depth of field.
5. **Perception modes:** ant-vision post-process and smell trails.
6. **Underground:** mycelium network and cutaway view.
7. **Ant agents and pheromone paths.**

## Open questions

- How large should the patch be? 1 m × 1 m keeps it focused. Larger needs stronger level of detail.
- How much should ant vision degrade the image, so it still feels like an ant but stays readable for viewers?
- Should sound be part of it (soil sounds, as in both references)?
