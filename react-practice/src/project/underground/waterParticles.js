import { DEAD, ParticlePool } from '../../utils/particles'
import { createRandom } from '../../utils/distributions'

/**
 * Water in the soil as a particle system pushed through a vector field
 * (the Week 5 particle pool):
 *
 *   emitters   the water table under you (anywhere within REGION, a few
 *              mm above it) and the pockets (water.js), each a point
 *              source puffing out a dense cluster
 *   field      the velocity the water wants at any point, the sum of
 *                rise   capillary rise: up, strongest just above the table
 *                sinks  each tree's root zone (trunk, Root reach, Root
 *                       depth) pulls water toward it, harder up close and
 *                       the thirstier the tree (its demand, treeWater.js)
 *                swirl  two octaves of ABC flow (Arnold–Beltrami–
 *                       Childress), a divergence-free field, drifting with
 *                       time: organic curls without bunching up
 *   motion     each particle's velocity eases toward the field (it has a
 *              little inertia), then moves (Euler steps)
 *   life       pale cyan when born, mid blue, then deep blue as it ages;
 *              fades in and out; dies at the end of its life, at the
 *              ground, or soaked up inside a root zone (it ages fast
 *              there, so it fades rather than vanishing)
 *
 * The ground and the table under the region are kept on a 25 cm grid
 * (rebuilt when you move a cell), so particles look them up cheaply.
 *
 * Plain data only, no Three.js. Units are metres and seconds.
 */

const CAPACITY = 6000
// Particles live within this distance (m) of where you look.
const REGION = 4
const CELL = 0.25
// Births per second at Particles 100%, and the share from pockets.
const RATE = 900
const POCKET_SHARE = 0.4
const LIFE = [4, 8]
const RESPONSE = 2.5
const RISE = { speed: 0.12, fade: 0.6 }
const SINK = { speed: 0.5, range: 2.2, soak: 0.55 }
// The root zone's centre, as a share of Root depth below the ground.
const SINK_DEPTH = 0.35
const SWIRL = [
  { wavelength: 0.7, speed: 0.045, drift: 0.25 },
  { wavelength: 0.23, speed: 0.02, drift: 0.4 },
]
const SIZE = [0.045, 0.026]
// Colour over life: [age share, r, g, b] (linear, before display).
const COLOURS = [
  [0, 0.35, 0.75, 0.95],
  [0.35, 0.06, 0.3, 0.9],
  [1, 0.02, 0.03, 0.7],
]
const FADE_IN = 0.06
const FADE_OUT = 0.25

const smoothstep = (edge0, edge1, value) => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

export function createWaterParticles() {
  const pool = new ParticlePool(CAPACITY)
  const random = createRandom(7)
  const side = Math.round(((REGION + 1) * 2) / CELL) + 1
  const grounds = new Float32Array(side * side)
  const tables = new Float32Array(side * side)
  let gridX = Infinity
  let gridZ = Infinity
  let gridField = null
  let sinks = []
  let pockets = []
  let owed = 0
  let clock = 0
  const flow = [0, 0, 0]

  const buildGrid = (field, sampler, cx, cz) => {
    const sample = {}
    for (let row = 0; row < side; row += 1) {
      for (let column = 0; column < side; column += 1) {
        const x = (cx + column - (side - 1) / 2) * CELL
        const z = (cz + row - (side - 1) / 2) * CELL
        sampler.sample(x, z, sample)
        grounds[row * side + column] = sample.height - sample.pebbleHeight
        tables[row * side + column] = field.tableAt(x, z)
      }
    }
    gridX = cx
    gridZ = cz
    gridField = field
  }
  // Bilinear lookup in one of the grids.
  const lookup = (grid, x, z) => {
    const gx = Math.min(Math.max(x / CELL - gridX + (side - 1) / 2, 0), side - 1.001)
    const gz = Math.min(Math.max(z / CELL - gridZ + (side - 1) / 2, 0), side - 1.001)
    const c = Math.floor(gx)
    const r = Math.floor(gz)
    const fx = gx - c
    const fz = gz - r
    const i = r * side + c
    const top = grid[i] + (grid[i + 1] - grid[i]) * fx
    const bottom = grid[i + side] + (grid[i + side + 1] - grid[i + side]) * fx
    return top + (bottom - top) * fz
  }

  /** The field's velocity at a point, into `out` [x, y, z]. */
  const fieldAt = (x, y, z, out) => {
    const table = lookup(tables, x, z)
    const rise = RISE.speed * (0.35 + 0.65 * Math.exp(-Math.max(y - table, 0) / RISE.fade))
    out[0] = 0
    out[1] = rise
    out[2] = 0
    for (const sink of sinks) {
      const dx = sink.x - x
      const dy = sink.y - y
      const dz = sink.z - z
      const distance = Math.hypot(dx, dy, dz) || 1
      const pull = SINK.speed * sink.demand * (1 - smoothstep(0, sink.range, distance)) ** 2
      out[0] += (dx / distance) * pull
      out[1] += (dy / distance) * pull
      out[2] += (dz / distance) * pull
    }
    // ABC flow: curl of (sin kz, sin kx, sin ky), so divergence-free.
    for (const { wavelength, speed, drift } of SWIRL) {
      const k = (Math.PI * 2) / wavelength
      const t = clock * drift
      out[0] += speed * (Math.cos(k * y + t) + 0.6 * Math.sin(k * z - t))
      out[1] += speed * (Math.cos(k * z + 1.3 * t) + 0.6 * Math.sin(k * x + t))
      out[2] += speed * (Math.cos(k * x - 0.7 * t) + 0.6 * Math.sin(k * y + 0.5 * t))
    }
    return out
  }

  const spawn = (x, y, z) => {
    const index = pool.spawn()
    if (index < 0) return
    const p = index * 3
    pool.position[p] = x
    pool.position[p + 1] = y
    pool.position[p + 2] = z
    pool.velocity[p] = 0
    pool.velocity[p + 1] = RISE.speed * 0.5
    pool.velocity[p + 2] = 0
    pool.life[index] = LIFE[0] + random() * (LIFE[1] - LIFE[0])
    pool.seed[index] = random()
  }

  const emit = (anchor, count) => {
    for (let n = 0; n < count; n += 1) {
      if (pockets.length && random() < POCKET_SHARE) {
        // A dense puff from near the pocket's centre.
        const pocket = pockets[Math.floor(random() * pockets.length)]
        const spread = () => (random() + random() + random() - 1.5) * 0.4
        spawn(pocket.x + pocket.rx * spread(), pocket.y + pocket.ry * spread(), pocket.z + pocket.rz * spread())
      } else {
        const angle = random() * Math.PI * 2
        const distance = REGION * Math.sqrt(random())
        const x = anchor.x + Math.cos(angle) * distance
        const z = anchor.z + Math.sin(angle) * distance
        spawn(x, lookup(tables, x, z) + random() * 0.01, z)
      }
    }
  }

  const mix = (age, out, index) => {
    let k = 1
    while (k < COLOURS.length - 1 && COLOURS[k][0] < age) k += 1
    const [a0, ...from] = COLOURS[k - 1]
    const [a1, ...to] = COLOURS[k]
    const t = Math.min(Math.max((age - a0) / (a1 - a0), 0), 1)
    for (let c = 0; c < 3; c += 1) out[index + c] = from[c] + (to[c] - from[c]) * t
  }

  return {
    pool,
    fieldAt,

    /**
     * Once per frame while shown. field: water.js (null clears);
     * sampler: the ground; trunks: the trunk field; roots: { reach,
     * rootDepth }; anchor: where you look; rate: Particles %;
     * demandOf(trunk): how hard the tree draws water (default 1).
     */
    update({ dt, field, sampler, trunks, roots, anchor, rate, demandOf = () => 1 }) {
      if (field !== gridField) {
        pool.clear()
        gridField = null
        gridX = Infinity
        pockets = []
      }
      if (!field) return
      dt = Math.min(dt, 0.05)
      clock += dt
      const cx = Math.round(anchor.x / CELL)
      const cz = Math.round(anchor.z / CELL)
      if (Math.abs(cx - gridX) > 1 || Math.abs(cz - gridZ) > 1 || !gridField) buildGrid(field, sampler, cx, cz)
      pockets = field.pocketsNear(anchor.x, anchor.z, REGION)
      sinks = (trunks ? trunks.trunksNear(anchor.x, anchor.z, REGION + SINK.range) : []).map((trunk) => ({
        x: trunk.x,
        y: lookup(grounds, trunk.x, trunk.z) - roots.rootDepth * SINK_DEPTH,
        z: trunk.z,
        range: roots.reach * SINK.range,
        soak: roots.reach * SINK.soak,
        demand: demandOf(trunk),
      }))

      owed += RATE * (rate / 100) * dt
      const births = Math.floor(owed)
      owed -= births
      emit(anchor, births)

      for (let index = 0; index < CAPACITY; index += 1) {
        if (pool.state[index] === DEAD) continue
        const p = index * 3
        const x = pool.position[p]
        const y = pool.position[p + 1]
        const z = pool.position[p + 2]
        // Soaked up in a root zone: age faster, so it fades away there.
        let soak = 1
        for (const sink of sinks) {
          const distance = Math.hypot(sink.x - x, sink.y - y, sink.z - z)
          if (distance < sink.soak) soak = Math.max(soak, 1 + 4 * (1 - distance / sink.soak))
        }
        pool.age[index] += dt * soak
        const age = pool.age[index] / pool.life[index]
        if (
          age >= 1 ||
          y > lookup(grounds, x, z) - 0.005 ||
          Math.hypot(x - anchor.x, z - anchor.z) > REGION + 0.5
        ) {
          pool.kill(index)
          continue
        }
        fieldAt(x, y, z, flow)
        const ease = Math.min(dt * RESPONSE, 1)
        for (let c = 0; c < 3; c += 1) {
          pool.velocity[p + c] += (flow[c] - pool.velocity[p + c]) * ease
          pool.position[p + c] += pool.velocity[p + c] * dt
        }
        mix(age, pool.color, p)
        pool.size[index] = (SIZE[0] + (SIZE[1] - SIZE[0]) * age) * (0.7 + 0.6 * pool.seed[index])
        pool.alpha[index] = smoothstep(0, FADE_IN, age) * (1 - smoothstep(1 - FADE_OUT, 1, age))
      }
    },

    /** The ground and table heights near where you look (for the field arrows). */
    groundAt: (x, z) => lookup(grounds, x, z),
    tableAt: (x, z) => lookup(tables, x, z),
    get ready() {
      return Boolean(gridField)
    },
    /** Pockets emitting near where you look. */
    get pocketCount() {
      return pockets.length
    },
  }
}
