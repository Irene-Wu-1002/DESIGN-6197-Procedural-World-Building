import { agaricSpot } from '../cover/flyAgaric'
import { ANT_HILL } from '../terrain/heightField'
import { antHillEntrances } from './antTrail'

/**
 * Exclusion zones: places ground cover keeps clear of, from the Paths
 * settings (DEFAULT_PATHS in antTrail.js).
 *
 *   ant hill       the mound, plus a clearance beyond its edge
 *   fly agaric     around its stem
 *   camera spawn   around the start view's focus (half-way from the ant
 *                  hill to the fly agaric)
 *   trail          the trail's strip, plus a clearance beyond its edge
 *   interaction    around each tunnel entrance (where the ant goes
 *                  underground)
 *
 * distance(x, z) is the signed distance to the nearest zone edge (m,
 * negative inside). Large objects (mushrooms, branches) must lie wholly
 * outside every zone (blocks); small ones (moss, twigs, leaves, flowers)
 * fade back in across the soft edge (fade: 0 at the edge – 1 beyond it).
 * On the trail, clearing strength sets how fully small things are cleared
 * (0: litter lies on the trail; 100%: bare, like any other zone). A zone
 * whose clearance is 0 and that has no size of its own is off.
 *
 * Plain data only, no Three.js.
 */

const smoothstep = (edge0, edge1, value) => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/**
 * paths: Paths settings; seed; antHill: is there one; agaric: is the fly
 * agaric shown; trail: the ant trail or null.
 */
export function createExclusions({ paths, seed, antHill, agaric, trail }) {
  const cm = (value) => value / 100
  const soft = cm(paths.softEdge)
  const circles = []
  const spot = agaricSpot(seed)
  if (antHill) {
    circles.push({ x: ANT_HILL.x, z: ANT_HILL.z, radius: ANT_HILL.radius + cm(paths.antHillClearance) })
    for (const entrance of antHillEntrances(seed)) {
      circles.push({ x: entrance.x, z: entrance.z, radius: entrance.radius + cm(paths.interactionClearance) })
    }
  }
  if (agaric && paths.agaricClearance > 0) circles.push({ x: spot.x, z: spot.z, radius: cm(paths.agaricClearance) })
  if (paths.spawnClearance > 0) circles.push({ x: spot.x / 2, z: spot.z / 2, radius: cm(paths.spawnClearance) })
  const trailEdge = trail ? trail.halfWidth + cm(paths.trailClearance) : 0
  // Beyond this, nothing is close enough to matter.
  const reach = soft + 0.05

  const circleDistance = (x, z) => {
    let best = Infinity
    for (const circle of circles) best = Math.min(best, Math.hypot(x - circle.x, z - circle.z) - circle.radius)
    return best
  }
  const trailDistance = (x, z) => (trail ? trail.distanceTo(x, z, trailEdge + reach) - trailEdge : Infinity)
  const distance = (x, z) => Math.min(circleDistance(x, z), trailDistance(x, z))
  const fade = (d) => (d < 0 ? 0 : soft <= 0 ? 1 : smoothstep(0, soft, d))
  const clearing = trail ? trail.clearing : 0

  return {
    circles,
    distance,
    fade,
    /** True if a large object of this radius at (x, z) would touch a zone. */
    blocks(x, z, radius) {
      return distance(x, z) < radius
    },
    /** 0–1: how much a small object survives here (0 inside, 1 well outside). */
    keep(x, z) {
      const nearTrail = fade(trailDistance(x, z))
      return fade(circleDistance(x, z)) * (1 - clearing * (1 - nearTrail))
    },
  }
}
