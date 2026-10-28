import { antHillEntrances } from '../paths/antTrail'
import { ANT_HILL, hash } from '../terrain/heightField'
import { createPheromoneGrid } from './pheromoneGrid'

/**
 * The ant colony: agents that leave the ant hill, wander until they find
 * food, and carry it home, laying scent as they go (pheromoneGrid.js).
 * Ants walking out lay home scent; ants carrying food lay food scent; each
 * follows the other's. Nothing tells them where the trails are: the paths
 * form because ants that find food sooner lay scent sooner, and other ants
 * are drawn to the stronger trail.
 *
 * Each ant steers with three sensors ahead of it (left, centre, right),
 * scoring each by the scent it smells minus how steep the ground is that
 * way, so trails settle on gentle slopes. Ants also wander a little, and
 * ants heading home keep a sense of where the nest is (path integration,
 * like real ants), which keeps the return trip short.
 *
 * The food (the fly agaric, trunk bases, seeded foraging spots), the
 * entrances, and the random choices all come from the seed, and the
 * simulation runs in fixed steps, so a seed always grows the same trails.
 * The ground under the grid (heights, trunks, the agaric's stem) is
 * sampled once into the grid's cells, over a few frames.
 *
 * Plain data only, no Three.js.
 */

// Simulation step (s), and how often the scent ages (s of simulated time).
export const STEP = 0.05
const RELAX_EVERY = 0.25
// The grid: 3.6 m square at 1.2 cm, centred on the ant hill.
const GRID = { size: 3.6, cell: 0.012 }
// Furthest ants go from the nest centre before turning back (m).
const RANGE = 1.65
// Walking speed range (m/s), and the steering turn rate (rad/s).
const SPEED = [0.02, 0.035]
const TURN_RATE = 5
// Scent laid per second, and how it weakens with time since the ant left
// the nest or the food (s), so trails grow stronger toward their source.
const DEPOSIT = 0.5
const MEMORY = 20
// Scent is sensed on a log scale, ln(1 + s / FAINT) (Weber's law: ants
// compare ratios), so even the strongest trail has a clear centre line.
const FAINT = 0.03
// Grade (rise over run) weight at 100% slope avoidance, in the same units.
const SLOPE_WEIGHT = 3
// Ants on a strong trail wander less: wander / (1 + scent × STEADY).
const STEADY = 0.5
// Wandering (rad per √s at 100%), the homing pull (per s), and how far
// food can be smelled directly (m).
const WANDER = 2.4
const HOMING = 1.4
const SMELL = 0.1
// On the mound (share of its radius) searchers head outward and homeward
// ants straight for their entrance, so nobody circles in the crater where
// every trail meets.
const MOUND = 1.4
// A share of the ants are scouts: they ignore food scent and walk straighter
// (wander × SCOUT_WANDER), so new food keeps being found.
const SCOUTS = 0.15
const SCOUT_WANDER = 0.35
// Scouts turn only for clearly steeper ground (grade difference, at 100%
// slope avoidance), or they'd trace the contours and never get far.
const SCOUT_MARGIN = 0.1
// Searchers who find nothing for this long go home (s).
const GIVE_UP = 120
// One ant leaves the nest every this many seconds while the colony is out.
const RELEASE = 0.2
// Food: foraging spots (count, distance from the nest), trunks within reach.
const FORAGE = { count: 2, distance: [0.8, 1.5] }
const TRUNK_REACH = 1.6
const AGARIC_STEM = 0.01
// Loads each kind of food holds (it grows back at REGROW loads per second),
// so a busy source runs out, its trail fades, and the scouts find another.
const STOCK = { agaric: 1200, trunk: 800, forage: 600 }
const REGROW = 1
const SALT = 4401
// Ground rows sampled per frame while the colony builds its grid.
const BUILD_ROWS = 24
export const MAX_ANTS = 400

// Ant states.
export const INSIDE = 0
export const SEARCHING = 1
export const CARRYING = 2
export const HOMEWARD = 3

// A small seeded random stream (mulberry32).
function random(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle))

/**
 * Food for this seed: [{ x, z, reach, kind, stock }]. reach: an ant this
 * close to (x, z) has found it; stock: loads left (full to start).
 */
export function foodSources({ seed, trunks, agaric }) {
  const food = []
  if (agaric) food.push({ x: agaric.x, z: agaric.z, reach: AGARIC_STEM + 0.015, kind: 'agaric' })
  for (const trunk of trunks?.trunksNear(ANT_HILL.x, ANT_HILL.z, TRUNK_REACH) ?? []) {
    food.push({ x: trunk.x, z: trunk.z, reach: trunk.radius + 0.015, kind: 'trunk' })
  }
  // The same foraging spots the seeded scent trails lead to (antWorld.js).
  for (let k = 0; k < FORAGE.count; k += 1) {
    const angle = hash(seed, 30 + k, SALT) * Math.PI * 2
    const d = FORAGE.distance[0] + hash(seed, 40 + k, SALT) * (FORAGE.distance[1] - FORAGE.distance[0])
    const x = ANT_HILL.x + Math.cos(angle) * d
    const z = ANT_HILL.z + Math.sin(angle) * d
    if (!trunks || trunks.distance(x, z, 1) > 0.05) food.push({ x, z, reach: 0.03, kind: 'forage' })
  }
  for (const source of food) source.stock = STOCK[source.kind]
  return food
}

/**
 * settings (read live): colonySize, wander (0–1), slopeAvoidance (0–1),
 * sensorAngle (rad), sensorDistance (m), halfLife (s), diffusion (per s).
 */
export function createColony() {
  const grid = createPheromoneGrid({ centerX: ANT_HILL.x, centerZ: ANT_HILL.z, ...GRID })
  const { n, cell } = grid
  // The ground under each cell: height, and whether it's blocked.
  const heights = new Float32Array(n * n)
  const blocked = new Uint8Array(n * n)
  const ants = Array.from({ length: MAX_ANTS }, () => ({
    state: INSIDE,
    x: 0,
    z: 0,
    heading: 0,
    // Last step's position and heading, for smooth drawing between steps.
    px: 0,
    pz: 0,
    ph: 0,
    speed: 0,
    // Seconds since leaving the nest or the food.
    timer: 0,
    // Seconds since it came out (for fading in).
    age: 0,
    scout: false,
  }))

  let world = null
  let food = []
  let entrances = []
  let rand = random(1)
  let buildRow = n
  let out = 0
  let releaseTimer = 0
  let relaxTimer = 0
  let time = 0
  let delivered = 0

  const heightAt = (x, z) => {
    const i = grid.indexAt(x, z)
    return i < 0 ? 0 : heights[i]
  }

  const buildRows = (rows) => {
    const { sampler, trunks, agaric } = world
    const end = Math.min(buildRow + rows, n)
    for (let iz = buildRow; iz < end; iz += 1) {
      const z = grid.minZ + (iz + 0.5) * cell
      for (let ix = 0; ix < n; ix += 1) {
        const x = grid.minX + (ix + 0.5) * cell
        const i = iz * n + ix
        heights[i] = sampler.height(x, z)
        const inTrunk = trunks ? trunks.distance(x, z, 0.5) <= 0 : false
        const inStem = agaric ? Math.hypot(x - agaric.x, z - agaric.z) < AGARIC_STEM : false
        blocked[i] = inTrunk || inStem ? 1 : 0
      }
    }
    buildRow = end
  }

  const release = () => {
    const ant = ants.find((a) => a.state === INSIDE)
    if (!ant || !entrances.length) return
    const entrance = entrances[Math.floor(rand() * entrances.length)]
    const angle = rand() * Math.PI * 2
    ant.x = ant.px = entrance.x + Math.cos(angle) * entrance.radius
    ant.z = ant.pz = entrance.z + Math.sin(angle) * entrance.radius
    ant.heading = ant.ph = angle
    ant.speed = SPEED[0] + rand() * (SPEED[1] - SPEED[0])
    ant.state = SEARCHING
    ant.scout = rand() < SCOUTS
    ant.timer = 0
    ant.age = 0
    out += 1
  }

  // Score of smelling `field` at (x, z), seen from height h0 a distance d away.
  const score = (field, x, z, h0, d, slopeAvoidance) => {
    const i = grid.indexAt(x, z)
    if (i < 0 || blocked[i]) return -Infinity
    return (field ? Math.log(1 + field[i] / FAINT) : 0) - (slopeAvoidance * SLOPE_WEIGHT * Math.abs(heights[i] - h0)) / d
  }

  const turnToward = (ant, angle, rate) => {
    ant.heading += wrapAngle(angle - ant.heading) * Math.min(rate * STEP, 1)
  }

  const nearestEntrance = (x, z) => {
    let found = null
    let best = Infinity
    for (const entrance of entrances) {
      const d = Math.hypot(entrance.x - x, entrance.z - z) - entrance.radius
      if (d < best) {
        best = d
        found = entrance
      }
    }
    return { entrance: found, distance: best }
  }

  const stepAnt = (ant, settings, quota) => {
    ant.px = ant.x
    ant.pz = ant.z
    ant.ph = ant.heading
    ant.timer += STEP
    ant.age += STEP
    const searching = ant.state === SEARCHING
    const homeward = ant.state !== SEARCHING
    if (searching && (ant.timer > GIVE_UP || Math.hypot(ant.x - ANT_HILL.x, ant.z - ANT_HILL.z) > RANGE)) {
      ant.state = HOMEWARD
    }

    // Three sensors: follow the scent laid by the other half of the trip.
    const field = searching ? grid.food : grid.home
    const h0 = heightAt(ant.x, ant.z)
    const d = settings.sensorDistance
    const a = settings.sensorAngle
    const sense = (offset, blind) =>
      score(
        blind ? null : field,
        ant.x + Math.cos(ant.heading + offset) * d,
        ant.z + Math.sin(ant.heading + offset) * d,
        h0,
        d,
        settings.slopeAvoidance
      )
    // Scouts searching smell only the ground's slope.
    const blind = searching && ant.scout
    const left = sense(-a, blind)
    const centre = sense(0, blind)
    const right = sense(a, blind)
    const margin = blind ? SCOUT_MARGIN * SLOPE_WEIGHT * settings.slopeAvoidance : 0
    if (centre + margin < left || centre + margin < right) {
      const toward = left > right ? -1 : 1
      // Both sides blocked or off the grid: turn around.
      if (!Number.isFinite(Math.max(left, right))) ant.heading += Math.PI * (0.5 + rand() * 0.5)
      else ant.heading += toward * TURN_RATE * STEP
    }

    // Food close enough to smell pulls a searcher straight in; a homeward
    // ant keeps a bearing on the nearest entrance.
    const onMound = Math.hypot(ant.x - ANT_HILL.x, ant.z - ANT_HILL.z) < ANT_HILL.radius * MOUND
    if (searching && onMound) {
      turnToward(ant, Math.atan2(ant.z - ANT_HILL.z, ant.x - ANT_HILL.x), 4)
    } else if (searching) {
      for (const source of food) {
        if (source.stock < 1) continue
        const dx = source.x - ant.x
        const dz = source.z - ant.z
        if (Math.hypot(dx, dz) < source.reach + SMELL) {
          turnToward(ant, Math.atan2(dz, dx), 6)
          break
        }
      }
    } else if (homeward) {
      const { entrance } = nearestEntrance(ant.x, ant.z)
      if (entrance) turnToward(ant, Math.atan2(entrance.z - ant.z, entrance.x - ant.x), onMound ? 6 : HOMING)
    }
    const steady = blind ? 1 / SCOUT_WANDER : 1 + grid.sample(field, ant.x, ant.z) * STEADY
    ant.heading = wrapAngle(ant.heading + ((rand() * 2 - 1) * settings.wander * WANDER * Math.sqrt(STEP)) / steady)

    // Move, unless something is in the way.
    const x = ant.x + Math.cos(ant.heading) * ant.speed * STEP
    const z = ant.z + Math.sin(ant.heading) * ant.speed * STEP
    const i = grid.indexAt(x, z)
    if (i < 0 || blocked[i]) {
      ant.heading += (rand() < 0.5 ? -1 : 1) * Math.PI * (0.5 + rand() * 0.5)
    } else {
      ant.x = x
      ant.z = z
    }

    // Lay scent: fresh near where the trip began.
    const amount = DEPOSIT * STEP * Math.exp(-ant.timer / MEMORY)
    if (ant.state === SEARCHING) grid.deposit(grid.home, ant.x, ant.z, amount)
    else if (ant.state === CARRYING) grid.deposit(grid.food, ant.x, ant.z, amount)

    // Arrivals.
    if (ant.state === SEARCHING) {
      for (const source of food) {
        if (source.stock >= 1 && Math.hypot(source.x - ant.x, source.z - ant.z) < source.reach) {
          source.stock -= 1
          ant.state = CARRYING
          ant.timer = 0
          ant.heading += Math.PI
          break
        }
      }
    } else {
      const { entrance, distance } = nearestEntrance(ant.x, ant.z)
      if (entrance && distance < 0.004) {
        if (ant.state === CARRYING) delivered += 1
        if (ant.state === CARRYING && out <= quota) {
          // Drop the food and head straight back out.
          ant.state = SEARCHING
          ant.timer = 0
          ant.heading += Math.PI
        } else {
          ant.state = INSIDE
          out -= 1
        }
      }
    }
  }

  const step = (settings, activity) => {
    const quota = Math.round(Math.min(settings.colonySize, MAX_ANTS) * activity)
    // Too many out: the last ones searching turn for home.
    let extra = -quota
    for (const ant of ants) if (ant.state === SEARCHING || ant.state === CARRYING) extra += 1
    for (let k = ants.length - 1; k >= 0 && extra > 0; k -= 1) {
      if (ants[k].state === SEARCHING) {
        ants[k].state = HOMEWARD
        extra -= 1
      }
    }
    for (const source of food) source.stock = Math.min(source.stock + REGROW * STEP, STOCK[source.kind])
    releaseTimer += STEP
    if (out < quota && releaseTimer >= RELEASE) {
      releaseTimer = 0
      release()
    }
    for (const ant of ants) if (ant.state !== INSIDE) stepAnt(ant, settings, quota)
    relaxTimer += STEP
    if (relaxTimer >= RELAX_EVERY) {
      grid.relax(relaxTimer, settings)
      relaxTimer = 0
    }
    time += STEP
  }

  return {
    grid,
    ants,
    heightAt,

    /** True once the ground under the grid has been sampled. */
    get ready() {
      return Boolean(world) && buildRow >= n
    },

    /**
     * Start over on this ground: sampler, trunks (field), seed, antHill
     * (on/off), agaric ({ x, z } or null). Clears every scent.
     */
    place({ sampler, trunks, seed, antHill, agaric }) {
      world = sampler && antHill ? { sampler, trunks, agaric } : null
      food = world ? foodSources({ seed, trunks, agaric }) : []
      entrances = world ? antHillEntrances(seed) : []
      buildRow = 0
      this.reset(seed)
    },

    /** Every ant back inside and the scent gone (same seed, same story). */
    reset(seed = 1) {
      rand = random(Math.imul(seed, 2654435761) ^ SALT)
      for (const ant of ants) ant.state = INSIDE
      for (const source of food) source.stock = STOCK[source.kind]
      out = 0
      releaseTimer = 0
      relaxTimer = 0
      time = 0
      delivered = 0
      grid.clear()
    },

    /** Sample a few more rows of ground (call each frame until ready). */
    build() {
      if (world && buildRow < n) buildRows(BUILD_ROWS)
    },

    /** One fixed simulation step. activity: share of the colony out (0–1). */
    step(settings, activity) {
      if (this.ready) step(settings, activity)
    },

    /** The food sources ([{ x, z, reach, kind, stock }]). */
    get food() {
      return food
    },

    stats() {
      let carrying = 0
      for (const ant of ants) if (ant.state === CARRYING) carrying += 1
      return { out, carrying, delivered, time, ready: this.ready }
    },
  }
}
