# Flowers, scent, wind and butterflies

The World page's small pollination ecology. Every number lives in
`ecologyConfig.js`. They are simplified rules chosen so the behaviour reads
well at this scale. **They are not measured values for any real species.**

## Files

| File | Role |
| --- | --- |
| `ecologyConfig.js` | All parameters: flower types, scent, traits, energy, thresholds, timers |
| `flowerRegistry.js` | One record per flower in the loaded tiles (stable id, points, nectar) |
| `windSampler.js` | Local wind and shade from the Habitat field, cached on a 10 cm grid |
| `scentField.js` | Scent particle pool: advection, turbulence, decay, recycling, spatial hash |
| `butterflyAgent.js` | One butterfly: perception, decision, motion, physiology, learning |
| `ecology.js` | Owns all of the above; fixed sub-steps, population, LOD, persistence |
| `butterflyBody.js` | The animated body (wings, six legs, coiling proboscis) |
| `ecologyRenderer.js` | Draws butterflies, the scent points and the developer overlay (read only) |
| `EcologyPanel.jsx` | The "Flowers & butterflies" panel |

## Rules worth knowing

**Flowers.** A flower's appearance, scent and reward are separate:
- The campion smells strongest but holds little nectar.
- The deep bellflower holds the most nectar, but only long tongues reach it.

Nectar stays within [0, capacity]. It refills at a constant rate and drops only when a butterfly drinks. Emission follows:

```
emission = rate × openness × (1 − 0.3 × (1 − nectar / capacity))
```

So a drained flower smells 30% weaker. The UV pattern is drawn only for the viewer and has nothing to do with nectar.

**Wind.** The Habitat "Direction" is where the wind comes **from**. Scent drifts the other way. 100% wind is 0.6 m/s at flower height.

**Scent.** Particles move by:

```
pos += localWind × dt + √(2·D·dt)·noise
```

They run at a fixed 30 Hz. Strength halves every 3 s, and particles are recycled when weak, old or out of range. When the pool (9000) would overflow, each flower emits fewer particles that each carry more strength, so the concentration stays the same. Particles carry a scent type but **no source id**. The "show scent" toggle and the "particles shown" share only change what is drawn.

**Butterflies.** Each frame follows world → perceive → decide → move:
- **Vision** has a field of view, a range and occlusion by trunks and toadstools.
- **Smell** samples two antenna spheres and smooths the result.
- **Nectar** is unknown until the butterfly probes the flower.

Decisions run in priority order: exhaustion, rain or wind shelter, night roost, cold, heat, basking, foraging, rest. Each threshold has separate enter and leave values, so states don't flicker.

Plume tracking surges upwind while the scent is present, casts across the wind when it is lost, and gives up after a timeout.

Preferences per flower type rise after a reward and fall after an empty or unreachable flower. Body temperature relaxes toward air + sun + flight heat.

**Time.**
- Agents step at a fixed 60 Hz, scaled by the simulation: 0 when paused, at most 1×. The 4× and 20× clocks speed up the day, not the animals.
- The seed sets each butterfly's traits and random stream.
- Nectar and butterflies are kept across camera switches and leaving or re-entering the page. A new world seed starts afresh.
- When a tile unloads, its flowers' nectar is stored and restored when the tile reloads.

## Known simplifications

- The antenna sampling sphere (6 cm) is much larger than real antennae. It stands for the air drawn past them over a wingbeat.
- Butterflies are leashed to about 1.1 m around the watched area, so they stay where you are looking.
- An exhausted butterfly can only crawl (1 cm/s) to a visible flower within 15 cm. If none is that close, it stays resting.
- Butterflies beyond 2.5 m update less often and draw without legs or proboscis.
