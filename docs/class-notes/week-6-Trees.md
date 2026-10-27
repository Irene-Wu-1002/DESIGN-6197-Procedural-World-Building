# Week 6: Trees — Branching System

Prototype tab: **Topic 6 — Branching System** · Code: [`Week6Scene.jsx`](../../react-practice/src/components/Week6Scene.jsx), [`BranchingPanel.jsx`](../../react-practice/src/components/BranchingPanel.jsx), [`components/branching/`](../../react-practice/src/components/branching/), [`utils/branching/`](../../react-practice/src/utils/branching/)

## What I built

A study that compares four ways of growing branching shapes, one method per tab: **Recursive**, **L-System**, **Stochastic**, and **Space Colonization**. Every method returns the same data (`{ segments, tips }`, where each segment knows the step it grows in), and one renderer draws them all, so the methods can be compared under the same view and the same seed.

Shared across the tabs:

- **Grow** replays the growth step by step: every branch of the current step extends out of its parent together. It plays by itself when a tab opens and after Reset, Random Seed or a preset; slider drags update at once.
- A full growth takes about 0.45 s per step, kept between 2 and 6 s so a 7-generation tree and a 300-iteration one both play at a watchable pace. **Growth speed** (0.25–3×) scales that.
- Colour runs from bark at the root to leaf green at the last step, so the order of growth reads as bands.
- On a regrow the camera re-frames the result; each tab keeps its own settings.
- Everything is capped at 120,000 segments; the readout says when a cap is reached.

## Method 1: Recursive branching

A trunk grows up from the origin. At the end of every branch, N children split off. Each child:

1. **tilts** away from its parent by the split angle,
2. **turns** around the parent by an even share of the circle, plus the spread twist for each generation,
3. is **shorter** than its parent by the length ratio,
4. is bent a little toward up or down by **tropism**.

This repeats until the depth limit. Branches are grown generation by generation (breadth first), which lets **Grow** reveal the tree one generation at a time. The colour runs from bark at the trunk to leaf green at the tips, so each generation reads as its own band.

### Parameters

| Control | Default | Range | Meaning |
|---|---|---|---|
| Depth | 6 | 1–9 | Number of split generations |
| Children per split | 2 | 1–5 | Branches made at each split |
| Prune chance | 0 | 0–0.6 | Chance a branch doesn't grow; breaks the symmetry |
| Seed | 1 | 0–999 | Same seed, same tree |
| Split angle | 30° | 0–90° | Tilt of each child away from its parent |
| Angle jitter | 10° | 0–45° | Random variation in tilt and turn |
| Spread twist | 137.5° | 0–180° | Extra turn per generation; 137.5° (the golden angle) spreads branches evenly |
| Trunk length | 2.0 | 0.5–4 | Length of the first segment |
| Length ratio | 0.72 | 0.4–0.95 | Child length ÷ parent length |
| Length jitter | 0.15 | 0–0.5 | Random variation in length |
| Tropism | 0 | −1 to +1 | Negative bends toward gravity (roots), positive toward light |
| Grow downward | off | toggle | Starts the trunk pointing down, for roots |
| Show tips | on | toggle | Dots at the branch ends |

Presets: **Binary tree**, **Bush**, **Conifer-ish**, **Roots**.

The tree is capped at 120,000 segments, so depth 9 with 5 children stays responsive; the readout says when the cap is reached.

## Method 2: L-System

A text rule is rewritten again and again, starting from the **axiom**. A 3D turtle then walks the final string:

| Symbol | Turtle action |
|---|---|
| `F` / `f` | Move forward, drawing / not drawing |
| `+` `-` | Turn left / right |
| `&` `^` | Pitch down / up |
| `\` `/` | Roll left / right |
| `\|` | Turn around |
| `[` `]` | Save / return to the turtle's position (makes branches) |

Other letters (`X`, `A`, `B`…) only drive the rewriting. Rules are typed as `X=F[+X]F[-X]`; the panel shows the first 120 characters of the rewritten string, so you can watch it grow with each iteration. Rewriting stops at 200,000 symbols.

| Control | Default | Range | Meaning |
|---|---|---|---|
| Axiom, Rules 1–3 | Fractal plant | text | The grammar |
| Iterations | 5 | 1–7 | How many times the rules are applied |
| Turn angle | 25° | 0–90° | Angle for `+ - & ^ \ /` |
| Angle jitter | 4° | 0–20° | Random variation; also a random roll at every `[`, which lifts flat rules into 3D |
| Step length | 0.09 | 0.02–1 | Length of one `F` |
| Length scale per branch | 1 | 0.5–1 | Each nested branch is this much shorter |
| Tropism | 0 | −1 to +1 | Bends the heading toward down / up a little at every step |
| Seed | 1 | 0–999 | Seeds the jitter |

Presets: **Fractal plant** (`X=F+[[X]-X]-F[-FX]+X`, `F=FF`), **Weed** (`F=F[+F]F[-F][F]`), **3D bush** (the classic bush from *The Algorithmic Beauty of Plants*), **3D tree**. Growth follows the turtle: a segment's step is how many `F`s lie between it and the root.

## Method 3: Stochastic branching

No fixed rule decides the shape. Every growing tip takes one small step at a time and makes random choices: it wanders a little, sometimes splits off a side branch, and sometimes stops.

| Control | Default | Range | Meaning |
|---|---|---|---|
| Steps | 90 | 20–250 | How many steps the tips take |
| Step length | 0.1 | 0.03–0.3 | Length of one step |
| Start points | 1 | 1–6 | Tips that start on a small circle |
| Split chance | 0.06 | 0–0.3 | Per tip, per step |
| Stop chance | 0.005 | 0–0.05 | Per tip, per step |
| Wander | 12° | 0–45° | Random turn on every step |
| Split angle | 35° | 10–90° | How far a side branch turns away |
| Tropism | 0.2 | −1 to +1 | Lean toward down / up |
| Flatness | 0 | 0–1 | Squashes vertical movement; 1 keeps growth in a flat layer, like mycelium |
| Grow downward | off | toggle | Start pointing down |

Presets: **Sapling**, **Roots**, **Hyphae** (flat, four start points), **Lightning**. Split and stop chances balance each other: if splits outpace stops, the number of tips grows exponentially, so active tips are capped at 4,000.

## Method 4: Space colonization (Runions et al., 2007)

**Attraction points** fill a volume. On every iteration each point pulls on the nearest branch node within the **influence radius**; each node that is pulled grows one step toward the average direction of its points. A point is removed once a node comes within the **kill distance**. Branches split wherever points pull in different directions, and growth stops when no points are left. The attraction points are drawn as faint blue dots, and on Grow each one disappears at the iteration a branch reaches it, so you can watch the tree eat the volume.

| Control | Default | Range | Meaning |
|---|---|---|---|
| Volume shape | Crown | Crown · Cone · Column · Soil slab | Where the points are scattered; the slab is a flat layer under the grid, grown into downward |
| Volume size / height | 3 / 5 | 1–6 / 0–8 | Size of the volume and how high it sits |
| Points | 800 | 100–4000 | Number of attraction points |
| Influence radius | 1.5 | 0.3–3 | How far a point can pull |
| Kill distance | 0.3 | 0.05–1 | How close a branch must come to remove a point |
| Step length | 0.15 | 0.05–0.5 | Growth per iteration |
| Max iterations | 300 | 50–600 | Safety limit |
| Tropism | 0 | −1 to +1 | Lean toward down / up |
| Start points | 1 | 1–6 | Roots on a small circle; their trunks grow straight until they reach the points |

Presets: **Crown tree**, **Wide canopy**, **Column / poplar**, **Mycelium** (soil slab, four start points).

**Speed:** the naive version checks every point against every node on every iteration, and took 6 s in the worst case. Here each point remembers its nearest node, and only a newly grown node can replace it, found through a grid of cells the size of the influence radius. Presets build in 7–40 ms; the worst case (4,000 points, influence 3) takes about 0.4 s. A step that would land on an existing node is skipped, so two points pulling in opposite directions can't trap growth in a loop.

## Comparing the four

| | Recursive | L-System | Stochastic | Space colonization |
|---|---|---|---|---|
| Decides the shape | Fixed split rule | A grammar | Chance, step by step | The space to fill |
| Branches avoid each other | No | No | No | Yes, they compete for points |
| Character | Regular, symmetric | Plant-like, self-similar | Wild, organic | Natural crowns, fills a volume |
| Best for the micro-world | Quick placeholders | Small plants, ferns, weeds | Roots, cracks, lightning | Tree crowns and the mycelium network |

## Why

The ant micro-world needs branching shapes at several scales: trees and fallen branches above ground, roots and the mycelium network below. Recursive branching is the simplest version of all of them and the baseline the next methods (space colonisation, L-systems) are compared against. Its weakness is already visible: the branches don't know about each other or the space around them, so they cross and crowd. Space colonisation fixes that by letting the space decide where branches grow.
