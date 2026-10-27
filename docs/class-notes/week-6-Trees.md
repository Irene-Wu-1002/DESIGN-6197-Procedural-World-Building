# Week 6: Trees — Branching System

Prototype tab: **Topic 6 — Branching System** · Code: [`Week6Scene.jsx`](../../react-practice/src/components/Week6Scene.jsx), [`BranchingPanel.jsx`](../../react-practice/src/components/BranchingPanel.jsx), [`utils/branching/`](../../react-practice/src/utils/branching/)

## What I built

A study that compares ways of growing branching shapes, one method per tab. Every method returns the same data (`{ segments, tips }`), and one renderer draws them all, so the methods can be compared under the same view and the same seed.

The first method is **recursive branching**.

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

## Why

The ant micro-world needs branching shapes at several scales: trees and fallen branches above ground, roots and the mycelium network below. Recursive branching is the simplest version of all of them and the baseline the next methods (space colonisation, L-systems) are compared against. Its weakness is already visible: the branches don't know about each other or the space around them, so they cross and crowd. Space colonisation fixes that by letting the space decide where branches grow.
