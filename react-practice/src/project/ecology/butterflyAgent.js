import {
  ENERGY,
  FLIGHT,
  FLOWER_TYPES,
  LEARNING,
  REACH,
  SCENT,
  SCENT_TYPES,
  THERMAL,
  THRESHOLDS,
  TIMERS,
  TRAITS,
} from './ecologyConfig'
import { deriveTraits, drawMorphology } from './morphology'
import { clamp, clamp01, createRandom, lerp, smoothstep, wrapAngle } from './random'

/**
 * One autonomous butterfly, in four layers that only talk downward:
 *
 *   world state   the flower registry, scent particles, wind, weather (true
 *                 state, owned by ecology.js)
 *   perception    perceive(): what this butterfly can sense right now: open
 *                 flowers it can see (distance, field of view, trunk and fly
 *                 agaric occlusion, size and conspicuousness), the scent at
 *                 its two antennae (per scent type, smoothed), the light and
 *                 warmth where it is. Never nectar, never a particle's
 *                 source. Nectar is only learned by probing (contact).
 *   decision      decide(): a state machine with priorities
 *                   danger (obstacles, handled in motion) → bad weather →
 *                   body (cold / hot / exhausted) → hunger → explore or rest
 *                 with minimum state times, hysteresis and timeouts so it
 *                 neither flickers nor gets stuck.
 *   motion        move(): turn-rate and acceleration limited flight that
 *                 aims into crosswinds, keeps clear of bark, the fly agaric,
 *                 mushrooms, flower heads, the ground and other butterflies;
 *                 smooth landing curves onto perches; poses and animation
 *                 values for the renderer.
 *
 * Scent search is a simplified plume-tracking strategy: while the scent is
 * above threshold, fly upwind (steering toward the stronger antenna);
 * when it drops away, cast across the wind in widening zigzags; give up after
 * TIMERS.cast. In still air, follow the concentration change instead (keep
 * going while it rises, turn when it falls). Smelling a scent does not tell
 * it where the flower is: it must still see the flower to approach it.
 *
 * Learning: each flower type's preference rises after nectar and falls after
 * an empty or unreachable flower (LEARNING), with a little random
 * exploration kept. It applies to what it sees (choosing flowers) and what
 * it smells (scent attraction is Σ preference × concentration).
 *
 * Plain data only, no Three.js.
 */

export const STATES = ['explore', 'searchScent', 'approach', 'land', 'probe', 'feed', 'depart', 'bask', 'seekShelter', 'rest']
const FLYING = new Set(['explore', 'searchScent', 'approach', 'depart'])
const TYPES = SCENT_TYPES.length
// Body geometry at scale 1 (viewpoints/bodies.js): head ahead of the centre,
// leg length, antenna tips.
const BODY = { head: 0.0105, legs: 0.0035, antenna: [0.004, 0.006, -0.022] }
const smooth = (rate, dt) => 1 - Math.exp(-rate * dt)
const forwardX = (yaw) => -Math.sin(yaw)
const forwardZ = (yaw) => -Math.cos(yaw)
const yawOf = (dx, dz) => Math.atan2(-dx, -dz)
const ease = (t) => t * t * (3 - 2 * t)

const vec = (x = 0, y = 0, z = 0) => ({ x, y, z })
const set = (out, x, y, z) => {
  out.x = x
  out.y = y
  out.z = z
  return out
}
const copy = (out, a) => set(out, a.x, a.y, a.z)
const normalize = (v) => {
  const length = Math.hypot(v.x, v.y, v.z) || 1
  v.x /= length
  v.y /= length
  v.z /= length
  return v
}

/**
 * A butterfly with a seeded body (morphology.js); its abilities follow from
 * that body. place() puts it in the world.
 */
export function createButterflyAgent(index, seed) {
  const random = createRandom(seed * 7919 + index * 104729 + 13)
  const range = ([low, high]) => random.range(low, high)
  const morph = drawMorphology(random)
  const traits = {
    ...deriveTraits(morph),
    // Half the field of view (rad), and antenna sensitivity.
    fov: (TRAITS.fov * Math.PI) / 360,
    scentThreshold: range(TRAITS.scentThreshold),
  }
  return {
    index,
    random,
    morph,
    traits,
    prefs: FLOWER_TYPES.map(() => range(TRAITS.innate)),
    seen: 0,
    removing: false,
    position: vec(),
    velocity: vec(),
    yaw: random() * Math.PI * 2,
    airspeed: 0,
    climb: 0,
    turn: 0,
    energy: range(ENERGY.start) * traits.energyCapacity,
    temperature: 22,
    state: 'explore',
    stateTime: 0,
    reason: '',
    foraging: true,
    decideIn: 0,
    // What it perceives (perceive()).
    percept: {
      flowers: [],
      scent: new Array(TYPES).fill(0),
      left: 0,
      right: 0,
      attraction: 0,
      previous: 0,
      sun: 0,
      smelt: false,
      stamp: 0,
    },
    // Its own memory: flowers recently visited / failed (id → time).
    visited: new Map(),
    failed: new Map(),
    target: null,
    spot: null,
    phase: 'fly',
    land: null,
    search: { lastContact: -Infinity, started: 0, castSide: 1, castFlip: 0, mode: 'surge', cooldown: 0 },
    wander: { turnIn: 0, turnTo: 0, height: 0.2 },
    timer: 0,
    exploreTime: 0,
    feed: { drunk: 0, access: 0 },
    landFails: 0,
    // Pose and animation for the renderer.
    pose: { forward: vec(0, 0, -1), up: vec(0, 1, 0) },
    anim: { phase: random() * 10, beat: 1, wings: 'flap', legs: 0, proboscis: 0, tip: vec(), reach: 0 },
    stats: { visits: 0, drunk: 0, empty: 0, outOfReach: 0 },
    lod: 0,
    spotFailedAt: -Infinity,
    departFrom: null,
  }
}

/** Put the agent at (x, y, z), flying. */
export function placeAgent(agent, x, y, z) {
  set(agent.position, x, y, z)
  set(agent.velocity, 0, 0, 0)
  agent.airspeed = agent.traits.speed * 0.5
  agent.state = 'explore'
  agent.stateTime = 0
  agent.phase = 'fly'
  agent.target = null
  agent.spot = null
  agent.wander.height = lerp(FLIGHT.cruise[0], FLIGHT.cruise[1], agent.random())
}

// ---------------------------------------------------------------- perception

const flowerVisible = (agent, record, ctx, trunks, eye) => {
  const kind = FLOWER_TYPES[record.type]
  if (record.presence > ctx.env.level) return 0
  const open = ctx.env.open[record.type] ?? 1
  if (open < 0.35) return 0
  if (ctx.visibleRadius && Math.hypot(record.x - ctx.center.x, record.z - ctx.center.z) > ctx.visibleRadius) return 0
  const dx = record.head.x - eye.x
  const dy = record.head.y - eye.y
  const dz = record.head.z - eye.z
  const distance = Math.hypot(dx, dy, dz)
  if (distance > agent.traits.visualRange || distance < 1e-4) return 0
  // Field of view (horizontal), with a blind spot behind.
  const flat = Math.hypot(dx, dz)
  if (flat > 0.02) {
    const off = Math.abs(wrapAngle(yawOf(dx, dz) - agent.yaw))
    if (off > agent.traits.fov) return 0
  }
  // Occlusion: bark between eye and flower, or the fly agaric.
  for (const trunk of trunks) {
    if (segmentCircle(eye.x, eye.z, record.head.x, record.head.z, trunk.x, trunk.z, trunk.radius * 1.05)) return 0
  }
  const agaric = ctx.world.agaric?.()
  if (agaric) {
    const t = segmentClosest(eye.x, eye.z, record.head.x, record.head.z, agaric.x, agaric.z)
    const px = lerp(eye.x, record.head.x, t)
    const pz = lerp(eye.z, record.head.z, t)
    const py = lerp(eye.y, record.head.y, t)
    if (Math.hypot(px - agaric.x, pz - agaric.z) < 0.04 && py < agaric.y + 0.122) return 0
  }
  // Conspicuousness: bigger, closer, more open and more salient is easier.
  return (kind.visual.salience * record.radius * open) / distance
}

function segmentClosest(ax, az, bx, bz, cx, cz) {
  const vx = bx - ax
  const vz = bz - az
  const length2 = vx * vx + vz * vz
  return length2 > 0 ? clamp(((cx - ax) * vx + (cz - az) * vz) / length2, 0, 1) : 0
}
function segmentCircle(ax, az, bx, bz, cx, cz, radius) {
  const t = segmentClosest(ax, az, bx, bz, cx, cz)
  return Math.hypot(ax + (bx - ax) * t - cx, az + (bz - az) * t - cz) < radius
}

const scratch = { left: new Array(TYPES).fill(0), right: new Array(TYPES).fill(0), eye: vec(), wind: { x: 0, z: 0 } }

/** Antenna tip in world space (side −1 left, +1 right). */
function antenna(agent, side, out) {
  const s = agent.traits.scale
  const [across, up, ahead] = BODY.antenna
  const fx = forwardX(agent.yaw)
  const fz = forwardZ(agent.yaw)
  // Right of the heading is (−fz, fx) turned… for yaw 0 forward is −z and
  // right is +x.
  const rx = -fz
  const rz = fx
  return set(
    out,
    agent.position.x + (rx * across * side - fx * ahead) * s,
    agent.position.y + up * s,
    agent.position.z + (rz * across * side - fz * ahead) * s
  )
}

/**
 * What the butterfly senses now (writes agent.percept). dt: time since the
 * last perception, for smoothing the scent.
 */
export function perceive(agent, ctx, dt) {
  const p = agent.percept
  const eye = antenna(agent, 0, scratch.eye)
  // Vision: open, visible flowers in range.
  p.flowers.length = 0
  const trunks = ctx.world.trunksNear(eye.x, eye.z, agent.traits.visualRange + 0.3)
  ctx.flowers.query(eye.x, eye.z, agent.traits.visualRange, (record) => {
    const salience = flowerVisible(agent, record, ctx, trunks, eye)
    if (salience < THRESHOLDS.visual) return
    p.flowers.push({
      id: record.id,
      type: record.type,
      x: record.land.x,
      y: record.land.y,
      z: record.land.z,
      salience,
      distance: Math.hypot(record.head.x - eye.x, record.head.y - eye.y, record.head.z - eye.z),
    })
  })
  // Smell: both antennae, each a sampling sphere (SCENT.sniffRadius) spaced
  // wider apart than the real antennae, so the two sides differ.
  const spread = SCENT.sniffRadius * 0.5
  const fx = forwardX(agent.yaw)
  const fz = forwardZ(agent.yaw)
  const sniffAt = (side, out) => {
    const x = eye.x - fz * side * spread
    const z = eye.z + fx * side * spread
    ctx.scent.sample(x, eye.y, z, SCENT.sniffRadius, out)
    let value = 0
    for (let k = 0; k < TYPES; k += 1) value += out[k] * scentPreference(agent, k)
    return value
  }
  const left = sniffAt(-1, scratch.left)
  const right = sniffAt(1, scratch.right)
  // Short-term smoothing (≈ 0.3 s), so one particle drifting past doesn't
  // swing it round.
  const k = smooth(3, dt)
  p.left += (left - p.left) * k
  p.right += (right - p.right) * k
  for (let t = 0; t < TYPES; t += 1) p.scent[t] += ((scratch.left[t] + scratch.right[t]) / 2 - p.scent[t]) * k
  p.previous = p.attraction
  p.attraction = (p.left + p.right) / 2
  p.stamp += 1
  // Smelt only above its own threshold (with a lower one to keep it).
  const threshold = agent.traits.scentThreshold
  p.smelt = p.smelt ? p.attraction > threshold * 0.6 : p.attraction > threshold
  // Light and warmth where it is.
  p.sun = ctx.env.sun * (1 - ctx.shadeAt(agent.position.x, agent.position.z))
}

// The preference for a scent type: that of the flower types that smell so.
function scentPreference(agent, scentType) {
  let value = 0
  let count = 0
  FLOWER_TYPES.forEach((kind, k) => {
    if (kind.scent.type === scentType) {
      value += agent.prefs[k]
      count += 1
    }
  })
  return count ? value / count : 1
}

// ---------------------------------------------------------------- learning

function learn(agent, type, drunk) {
  const prefs = agent.prefs
  if (drunk > 0.02) prefs[type] += LEARNING.gain * Math.min(drunk / LEARNING.full, 1)
  else prefs[type] -= LEARNING.loss
  prefs[type] = clamp(prefs[type], LEARNING.min, LEARNING.max)
}

const remembered = (agent, id, now) =>
  (agent.visited.has(id) && now - agent.visited.get(id) < TIMERS.revisit) ||
  (agent.failed.has(id) && now - agent.failed.get(id) < TIMERS.failed)

function forget(agent, now) {
  for (const [id, time] of agent.visited) if (now - time > TIMERS.revisit) agent.visited.delete(id)
  for (const [id, time] of agent.failed) if (now - time > TIMERS.failed) agent.failed.delete(id)
}

/** The flower it chooses among those it sees, or null. */
function chooseFlower(agent, now) {
  const options = agent.percept.flowers.filter((flower) => !remembered(agent, flower.id, now))
  if (!options.length) return null
  if (agent.random() < LEARNING.explore) return options[Math.floor(agent.random() * options.length)]
  let best = null
  let bestScore = 0
  for (const flower of options) {
    const score = agent.prefs[flower.type] * flower.salience / (1 + 2 * flower.distance)
    if (score > bestScore) {
      bestScore = score
      best = flower
    }
  }
  return best
}

// ---------------------------------------------------------------- spots

/** A perch on a flower record (pose follows the flower's sway). */
function flowerSpot(agent, record) {
  return { kind: 'flower', id: record.id, yaw: agent.yaw }
}

/** Resolve a spot to a world pose now: { point, up, forward, tip }. */
function spotPose(agent, spot, ctx, out) {
  const s = agent.traits.scale
  if (spot.kind === 'flower') {
    const record = ctx.flowers.get(spot.id)
    if (!record) return null
    const kind = FLOWER_TYPES[record.type]
    const sway = ctx.flowers.sway(record, 0.87 + kind.land, ctx.swayTime, ctx.swayWind, scratch.wind)
    set(out.up, record.nx, record.ny, record.nz)
    // Forward: its heading, made perpendicular to the flower's axis.
    const fx = forwardX(spot.yaw)
    const fz = forwardZ(spot.yaw)
    const along = fx * out.up.x + fz * out.up.z
    set(out.forward, fx - out.up.x * along, -out.up.y * along, fz - out.up.z * along)
    normalize(out.forward)
    // Head over the corolla's centre, feet on the petals or rim.
    set(
      out.point,
      record.land.x + sway.x + out.up.x * BODY.legs * s - out.forward.x * BODY.head * s,
      record.land.y + out.up.y * BODY.legs * s - out.forward.y * BODY.head * s,
      record.land.z + sway.z + out.up.z * BODY.legs * s - out.forward.z * BODY.head * s
    )
    const deep = ctx.flowers.sway(record, 0.87 + kind.nectary, ctx.swayTime, ctx.swayWind, scratch.wind)
    set(out.tip, record.nectary.x + deep.x, record.nectary.y, record.nectary.z + deep.z)
    out.hasTip = true
    return out
  }
  if (spot.kind === 'ground') {
    set(out.point, spot.x, ctx.world.surfaceAt(spot.x, spot.z) + BODY.legs * s, spot.z)
    set(out.up, 0, 1, 0)
    set(out.forward, forwardX(spot.yaw), 0, forwardZ(spot.yaw))
    out.hasTip = false
    return out
  }
  // Bark or the fly agaric's stem: clinging upright, back to the outside.
  const ground = ctx.world.groundAt(spot.cx, spot.cz)
  set(out.up, spot.nx, 0, spot.nz)
  set(out.forward, 0, 1, 0)
  set(out.point, spot.cx + spot.nx * (spot.radius + BODY.legs * s), ground + spot.height, spot.cz + spot.nz * (spot.radius + BODY.legs * s))
  out.hasTip = false
  return out
}

const poseScratch = { point: vec(), up: vec(), forward: vec(), tip: vec() }

/** A sunny (or, with shade: true, shaded) bit of ground near the butterfly. */
function groundSpot(agent, ctx, { shade = false, radius = 0.4, tries = 12 } = {}) {
  let best = null
  let bestValue = -Infinity
  for (let k = 0; k < tries; k += 1) {
    const angle = agent.random() * Math.PI * 2
    const distance = radius * Math.sqrt(agent.random())
    const x = agent.position.x + Math.cos(angle) * distance
    const z = agent.position.z + Math.sin(angle) * distance
    // Keep off bark and the fly agaric.
    const clear = ctx.world.resolve(x, z, 0.02, { trunks: true, flyAgaric: true, mushrooms: true })
    if (clear.hit) continue
    const light = 1 - ctx.shadeAt(x, z)
    const value = shade ? -light : light
    if (value > bestValue) {
      bestValue = value
      best = { kind: 'ground', x, z, yaw: agent.yaw, light }
    }
  }
  return best
}

/** Shelter: the lee side of the nearest trunk, or the fly agaric's stem. */
function shelterSpot(agent, ctx) {
  const { x, z } = agent.position
  const toward = ctx.wind.toward
  const calm = ctx.wind.strength < 0.05
  let best = null
  let bestDistance = Infinity
  for (const trunk of ctx.world.trunksNear(x, z, 2.5)) {
    let nx = toward[0]
    let nz = toward[1]
    if (calm) {
      const d = Math.hypot(x - trunk.x, z - trunk.z) || 1
      nx = (x - trunk.x) / d
      nz = (z - trunk.z) / d
    }
    const radius = trunk.radius * 1.07
    const px = trunk.x + nx * radius
    const pz = trunk.z + nz * radius
    const distance = Math.hypot(px - x, pz - z)
    if (distance < bestDistance) {
      bestDistance = distance
      best = { kind: 'bark', cx: trunk.x, cz: trunk.z, nx, nz, radius, height: lerp(0.55, 0.8, agent.random()) }
    }
  }
  const agaric = ctx.world.agaric?.()
  if (agaric) {
    let nx = calm ? 1 : toward[0]
    let nz = calm ? 0 : toward[1]
    const distance = Math.hypot(agaric.x + nx * 0.02 - x, agaric.z + nz * 0.02 - z)
    // The cap keeps the rain off: preferred when it's about as near.
    if (distance < bestDistance * 1.5) {
      best = { kind: 'cap', cx: agaric.x, cz: agaric.z, nx, nz, radius: 0.011, height: 0.05 + agaric.y - ctx.world.groundAt(agaric.x, agaric.z) }
    }
  }
  return best
}

// ---------------------------------------------------------------- states

function enter(agent, state, ctx, reason = '') {
  agent.state = state
  agent.stateTime = 0
  agent.reason = reason
  agent.timer = 0
  if (state === 'explore') {
    agent.target = null
    agent.spot = null
    agent.phase = 'fly'
    agent.exploreTime = 0
  }
  if (state === 'searchScent') {
    agent.search.started = ctx.now
    agent.search.lastContact = ctx.now
    agent.search.mode = 'surge'
    agent.search.heading = undefined
  }
}

/** Fly to a spot and settle there (rest, bask, shelter). */
function goToSpot(agent, state, spot, ctx, reason, timer = 0) {
  enter(agent, state, ctx, reason)
  agent.spot = spot
  agent.phase = 'fly'
  agent.timer = timer
  agent.land = null
}

/** Land right where it is (too cold or weak to go anywhere). */
function settleHere(agent, state, ctx, reason) {
  enter(agent, state, ctx, reason)
  const spot = { kind: 'ground', x: agent.position.x, z: agent.position.z, yaw: agent.yaw }
  agent.spot = spot
  agent.phase = 'land'
  agent.land = { t: 0, from: copy(vec(), agent.position), duration: Math.max(TIMERS.land * 2, (agent.position.y - ctx.world.groundAt(spot.x, spot.z)) / 0.15) }
}

const isFlying = (agent) => FLYING.has(agent.state) || agent.phase === 'fly'

/** Leave a perch (or a landing) and fly on. */
function takeOff(agent, ctx, next = 'explore') {
  // The flower it leaves doesn't count as an obstacle while it lifts off.
  agent.departFrom = agent.spot?.kind === 'flower' ? agent.spot.id : null
  agent.spot = null
  agent.phase = 'fly'
  enter(agent, 'depart', ctx, next)
  agent.airspeed = agent.traits.speed * 0.3
}

/**
 * Re-make the decision (every TIMERS.decide). Higher priorities first;
 * each state also checks its own exit conditions in move().
 */
export function decide(agent, ctx) {
  const { env } = ctx
  const now = ctx.now
  const share = agent.energy / agent.traits.energyCapacity
  const p = agent.percept
  forget(agent, now)

  // Hunger, with hysteresis.
  if (share < THRESHOLDS.hungry) agent.foraging = true
  else if (share > THRESHOLDS.sated) agent.foraging = false

  const minTime = agent.stateTime >= TIMERS.minState
  const sheltered = agent.state === 'seekShelter'
  const nightRest = agent.state === 'rest' && agent.reason === 'night'

  // 1. Bad weather (rain, strong wind) and night: shelter / roost.
  const rainy = env.rain > (sheltered ? THRESHOLDS.rain.leave : THRESHOLDS.rain.enter)
  const windy = ctx.wind.strength > (sheltered ? THRESHOLDS.wind.leave : THRESHOLDS.wind.enter)
  const dark = env.daylight < (nightRest ? THRESHOLDS.dark.leave : THRESHOLDS.dark.enter)
  if (agent.energy <= 0) {
    if (!(agent.state === 'rest' && agent.reason === 'exhausted') && !['probe', 'feed', 'land'].includes(agent.state)) {
      if (agent.spot?.kind === 'flower' && agent.phase === 'settled') enter(agent, 'probe', ctx)
      else settleHere(agent, 'rest', ctx, 'exhausted')
    }
    return
  }
  // (A shelter it couldn't reach a moment ago: wait it out where it is.)
  const couldNotReach = now - agent.spotFailedAt < 20
  if (rainy || windy) {
    if (!sheltered) {
      const spot = couldNotReach ? null : shelterSpot(agent, ctx)
      if (spot) goToSpot(agent, 'seekShelter', spot, ctx, rainy ? 'rain' : 'wind')
      else settleHere(agent, 'seekShelter', ctx, rainy ? 'rain' : 'wind')
    }
    return
  }
  if (dark) {
    if (!nightRest) {
      const spot = couldNotReach ? null : shelterSpot(agent, ctx)
      if (spot) goToSpot(agent, 'rest', spot, ctx, 'night')
      else settleHere(agent, 'rest', ctx, 'night')
    }
    return
  }
  // Weather and night have passed: stay a while, then go on.
  if (sheltered || nightRest) {
    if (agent.phase === 'settled' && agent.stateTime > TIMERS.shelterMin && agent.temperature >= THRESHOLDS.flightMin + 1) {
      takeOff(agent, ctx)
    }
    return
  }

  // 2. Body: too cold to fly, too hot, or chilly enough to bask.
  const cold = agent.temperature < THRESHOLDS.flightMin
  if (cold && FLYING.has(agent.state)) {
    if (p.sun > 0.15 || env.sun > 0.2) {
      const spot = groundSpot(agent, ctx, { radius: 0.2, tries: 8 })
      if (spot) {
        goToSpot(agent, 'bask', spot, ctx, 'cold', lerp(...TIMERS.basking, agent.random()))
        return
      }
    }
    settleHere(agent, 'rest', ctx, 'cold')
    return
  }
  if (agent.state === 'rest' && agent.reason === 'cold') {
    // Basks where it sits if the sun reaches it; flies once warm.
    if (p.sun > 0.1 && agent.phase === 'settled') {
      agent.state = 'bask'
      agent.reason = 'cold'
      agent.stateTime = 0
      agent.timer = TIMERS.basking[1]
    } else if (agent.temperature >= THRESHOLDS.flightMin + 1) takeOff(agent, ctx)
    return
  }
  const hot = agent.temperature > (agent.state === 'rest' && agent.reason === 'hot' ? THRESHOLDS.hot.leave : THRESHOLDS.hot.enter)
  if (hot) {
    if (!(agent.state === 'rest' && agent.reason === 'hot') && FLYING.has(agent.state) && minTime) {
      const spot = groundSpot(agent, ctx, { shade: true })
      if (spot) goToSpot(agent, 'rest', spot, ctx, 'hot', TIMERS.rest[1])
    }
    return
  }
  if (agent.state === 'rest' && agent.reason === 'hot') {
    takeOff(agent, ctx)
    return
  }
  if (agent.state === 'bask') {
    const warm = agent.temperature >= THRESHOLDS.baskEnd
    const hungry = share < THRESHOLDS.weak * 2
    if (agent.phase === 'settled' && ((warm && agent.stateTime > 3) || agent.stateTime > agent.timer || hungry)) {
      if (agent.temperature >= THRESHOLDS.flightMin + 1) takeOff(agent, ctx)
    }
    return
  }
  const wantsBask =
    agent.temperature < THRESHOLDS.baskStart && env.sun > 0.25 && share > THRESHOLDS.weak * 2 && agent.search.cooldown < now
  if (wantsBask && (agent.state === 'explore' || (agent.state === 'searchScent' && !p.smelt)) && minTime) {
    const spot = groundSpot(agent, ctx)
    if (spot && spot.light > 0.45) {
      goToSpot(agent, 'bask', spot, ctx, 'chilly', lerp(...TIMERS.basking, agent.random()))
      return
    }
    // No sunny ground in reach: don't keep looking for a while.
    agent.search.cooldown = now + 10
  }

  // 3. Hunger: the foraging chain.
  if (agent.state === 'explore' || agent.state === 'searchScent') {
    if (agent.foraging) {
      // A flower in sight is taken up at once (a short settle, no flicker:
      // approach has its own exits).
      const flower = chooseFlower(agent, now)
      if (flower && agent.stateTime > 0.25) {
        enter(agent, 'approach', ctx)
        agent.target = { id: flower.id, type: flower.type, x: flower.x, y: flower.y, z: flower.z, lastSeen: now }
        return
      }
      if (agent.state === 'explore' && p.smelt && now > agent.search.cooldown && share > THRESHOLDS.weak * 0.5) {
        enter(agent, 'searchScent', ctx)
        return
      }
    } else if (agent.state === 'searchScent') {
      enter(agent, 'explore', ctx)
      return
    }
  }
  if (agent.state === 'approach') {
    const target = agent.target
    const record = ctx.flowers.get(target.id)
    const seen = p.flowers.find((flower) => flower.id === target.id)
    if (seen) {
      target.lastSeen = now
      target.x = seen.x
      target.y = seen.y
      target.z = seen.z
    }
    const closed = record && (ctx.env.open[record.type] ?? 1) < 0.3
    if (!record || closed || now - target.lastSeen > TIMERS.lostSight || agent.stateTime > TIMERS.approachTimeout) {
      // Gone (tile unloaded), closed, out of sight or out of reach.
      if (record) agent.failed.set(target.id, now)
      enter(agent, p.smelt ? 'searchScent' : 'explore', ctx)
    }
    return
  }

  // 4. Not hungry: wander, and now and then perch on a flower or the ground.
  if (agent.state === 'explore' && !agent.foraging && agent.exploreTime > 12 + 10 * agent.random()) {
    const flower = agent.percept.flowers[0]
    const record = flower && ctx.flowers.get(flower.id)
    const spot = record ? flowerSpot(agent, record) : groundSpot(agent, ctx)
    if (spot) goToSpot(agent, 'rest', spot, ctx, 'idle', lerp(...TIMERS.rest, agent.random()))
    return
  }
  if (agent.state === 'rest' && agent.reason === 'idle' && agent.phase === 'settled' && (agent.stateTime > agent.timer || agent.foraging)) {
    takeOff(agent, ctx)
  }
}

// ---------------------------------------------------------------- motion

/** Steer toward a horizontal ground velocity (m/s) and a height. */
function fly(agent, ctx, dt, groundVx, groundVz, targetY, drift) {
  const t = agent.traits
  const weak = agent.energy / t.energyCapacity < THRESHOLDS.weak
  const maxSpeed = t.speed * (weak ? 0.6 : 1) * 1.25
  // Light bodies on big wings are carried further by the wind.
  drift = Math.min(drift * t.windDrift, 0.9)
  ctx.wind.at(agent.position.x, agent.position.z, scratch.wind)
  // Air velocity that gives that ground velocity once the wind (the share
  // it doesn't correct) is added: it heads up into a crosswind.
  let ax = groundVx - scratch.wind.x * drift
  let az = groundVz - scratch.wind.z * drift
  let speed = Math.hypot(ax, az)
  if (speed > maxSpeed) {
    ax *= maxSpeed / speed
    az *= maxSpeed / speed
    speed = maxSpeed
  }
  // Turn, no faster than its turn rate.
  const before = agent.yaw
  if (speed > 0.01) {
    const wanted = yawOf(ax, az)
    const delta = wrapAngle(wanted - agent.yaw)
    const step = t.turnRate * dt
    agent.yaw += clamp(delta, -step, step)
  }
  agent.turn += (wrapAngle(agent.yaw - before) / Math.max(dt, 1e-4) - agent.turn) * smooth(6, dt)
  // Speed up or slow down, no faster than its acceleration; slower while turning hard.
  const aligned = Math.max(Math.cos(wrapAngle(yawOf(ax, az) - agent.yaw)), 0.2)
  agent.airspeed += clamp(speed * aligned - agent.airspeed, -t.accel * dt, t.accel * dt)
  const vx = forwardX(agent.yaw) * agent.airspeed + scratch.wind.x * drift
  const vz = forwardZ(agent.yaw) * agent.airspeed + scratch.wind.z * drift
  // Height: ease toward the target, limited climb rate; fluttering bobs.
  const vy = clamp((targetY - agent.position.y) * 3, -FLIGHT.climb, FLIGHT.climb)
  agent.climb += (vy - agent.climb) * smooth(5, dt)
  set(agent.velocity, vx, agent.climb, vz)
  const p = agent.position
  p.x += vx * dt
  p.y += agent.climb * dt
  p.z += vz * dt

  // Keep clear: bark, the fly agaric, mushrooms (low down), flower heads,
  // the ground, other butterflies.
  const ground = ctx.world.groundAt(p.x, p.z)
  const altitude = p.y - ground
  const gap = agent.spot?.kind === 'bark' || agent.spot?.kind === 'cap' ? 0.02 : FLIGHT.trunkGap
  const resolved = ctx.world.resolve(p.x, p.z, gap, { trunks: true, flyAgaric: true, mushrooms: altitude < 0.06 }, altitude)
  if (resolved.hit) {
    p.x = resolved.x
    p.z = resolved.z
  }
  for (const other of ctx.agents) {
    if (other === agent || other.seen <= 0) continue
    const dx = p.x - other.position.x
    const dy = p.y - other.position.y
    const dz = p.z - other.position.z
    const d = Math.hypot(dx, dy, dz)
    if (d > 1e-6 && d < FLIGHT.separation) {
      const push = ((FLIGHT.separation - d) / d) * 0.5
      p.x += dx * push
      p.y += dy * push * 0.5
      p.z += dz * push
    }
  }
  let floor = ground + FLIGHT.clearance
  ctx.flowers.query(p.x, p.z, 0.03, (record) => {
    const own = record.id === agent.target?.id || record.id === agent.spot?.id || (agent.state === 'depart' && record.id === agent.departFrom)
    if (record.presence <= ctx.env.level && !own) {
      floor = Math.max(floor, record.head.y + 0.015)
    }
  })
  if (p.y < floor) {
    p.y = floor
    agent.climb = Math.max(agent.climb, 0)
  }
  // Flight pose: banked into turns, nose with the climb.
  const roll = clamp(-agent.turn * 0.12, -0.6, 0.6)
  const pitch = clamp(agent.climb * 1.2, -0.5, 0.5)
  setFlightPose(agent, pitch, roll)
  agent.anim.beat = 1 + 0.5 * Math.max(agent.climb / FLIGHT.climb, 0) + 0.3 * (agent.airspeed / Math.max(t.speed, 0.01))
  // Glides on the way down, beats otherwise.
  agent.anim.wings = agent.climb < -0.15 ? 'glide' : 'flap'
}

function setFlightPose(agent, pitch, roll) {
  const fx = forwardX(agent.yaw)
  const fz = forwardZ(agent.yaw)
  const cos = Math.cos(pitch)
  set(agent.pose.forward, fx * cos, Math.sin(pitch), fz * cos)
  // Up: tilted by pitch, then rolled about forward.
  const ux = -fx * Math.sin(pitch)
  const uy = cos
  const uz = -fz * Math.sin(pitch)
  // Right = forward × up.
  const f = agent.pose.forward
  const rx = f.y * uz - f.z * uy
  const ry = f.z * ux - f.x * uz
  const rz = f.x * uy - f.y * ux
  const c = Math.cos(roll)
  const s = Math.sin(roll)
  set(agent.pose.up, ux * c + rx * s, uy * c + ry * s, uz * c + rz * s)
}

/** Fly toward a point, slowing near it; returns the remaining distance. */
function flyTo(agent, ctx, dt, x, y, z, { drift = FLIGHT.drift.approach, slow = 0.15, minSpeed = 0.05 } = {}) {
  const dx = x - agent.position.x
  const dz = z - agent.position.z
  const flat = Math.hypot(dx, dz)
  const speed = Math.max(minSpeed, agent.traits.speed * Math.min(flat / slow, 1))
  const vx = flat > 1e-5 ? (dx / flat) * speed : 0
  const vz = flat > 1e-5 ? (dz / flat) * speed : 0
  // Stay at cruise height until near, then come down to it.
  const near = 1 - smoothstep(0.08, 0.35, flat)
  const height = lerp(Math.max(agent.wander.height + ctx.world.groundAt(agent.position.x, agent.position.z), y), y, near)
  fly(agent, ctx, dt, vx, vz, height, drift)
  return Math.hypot(flat, y - agent.position.y)
}

function wander(agent, ctx, dt, band = FLIGHT.cruise, speedShare = 1) {
  const w = agent.wander
  w.turnIn -= dt
  if (w.turnIn <= 0) {
    w.turnIn = lerp(1.2, 3, agent.random())
    w.turnTo = agent.yaw + (agent.random() - 0.5) * 2.2
    w.height = lerp(band[0], band[1], agent.random())
  }
  // Pulled back toward the watched area when it strays.
  const dx = ctx.center.x - agent.position.x
  const dz = ctx.center.z - agent.position.z
  const away = Math.hypot(dx, dz)
  let heading = w.turnTo
  if (away > FLIGHT.leash) {
    const pull = smoothstep(FLIGHT.leash, FLIGHT.leash * 2, away)
    heading = agent.yaw + wrapAngle(yawOf(dx, dz) - agent.yaw) * pull + wrapAngle(w.turnTo - agent.yaw) * (1 - pull)
  }
  const speed = agent.traits.speed * speedShare
  const ground = ctx.world.groundAt(agent.position.x, agent.position.z)
  fly(agent, ctx, dt, forwardX(heading) * speed, forwardZ(heading) * speed, ground + w.height, FLIGHT.drift.cruise)
}

/** Scent search: surge upwind on contact, cast across the wind without. */
function searchScent(agent, ctx, dt) {
  const p = agent.percept
  const s = agent.search
  const now = ctx.now
  const speed = agent.traits.speed * 0.75
  ctx.wind.at(agent.position.x, agent.position.z, scratch.wind)
  const windSpeed = Math.hypot(scratch.wind.x, scratch.wind.z)
  if (p.smelt) s.lastContact = now
  const lost = now - s.lastContact
  let heading
  const balance = (p.right - p.left) / Math.max(p.right + p.left, 1e-6)
  if (windSpeed > 0.04) {
    const upwind = yawOf(-scratch.wind.x, -scratch.wind.z)
    if (lost < 0.4) {
      s.mode = 'surge'
      // Upwind, nudged toward the stronger side (right is −yaw).
      heading = upwind - balance * 0.6
    } else {
      s.mode = 'cast'
      s.castFlip -= dt
      if (s.castFlip <= 0) {
        s.castSide *= -1
        s.castFlip = 0.6 + Math.min(lost, TIMERS.cast) * 0.25
      }
      heading = upwind + s.castSide * 1.25
    }
  } else {
    // Still air: keep going while it gets stronger, turn when it fades
    // (judged once per perception, from the change since the last one).
    s.mode = 'gradient'
    if (s.stamp !== p.stamp) {
      s.stamp = p.stamp
      if (s.heading === undefined) s.heading = agent.yaw
      if (p.attraction < p.previous) s.heading += (agent.random() < 0.5 ? -1 : 1) * lerp(0.6, 1.5, agent.random())
      s.heading -= balance * 0.5
    }
    heading = s.heading
  }
  const ground = ctx.world.groundAt(agent.position.x, agent.position.z)
  const height = ground + lerp(FLIGHT.search[0], FLIGHT.search[1], 0.5 + 0.5 * Math.sin(ctx.now * 0.9 + agent.index))
  fly(agent, ctx, dt, forwardX(heading) * speed, forwardZ(heading) * speed, height, FLIGHT.drift.approach)
  if (lost > TIMERS.cast || now - s.started > TIMERS.search) {
    s.cooldown = now + 3
    enter(agent, 'explore', ctx)
  }
}

/** Fly to the spot, land on it (a smooth curve), then hold it. */
function perchFlow(agent, ctx, dt) {
  const pose = spotPose(agent, agent.spot, ctx, poseScratch)
  if (!pose) {
    // The flower is gone (its tile unloaded): fly on.
    takeOff(agent, ctx)
    return false
  }
  const a = agent.anim
  if (agent.phase === 'fly') {
    // Aim at a point just off the surface, along its normal.
    const off = agent.spot.kind === 'bark' || agent.spot.kind === 'cap' ? 0.06 : 0.04
    const remaining = flyTo(agent, ctx, dt, pose.point.x + pose.up.x * off, pose.point.y + pose.up.y * off, pose.point.z + pose.up.z * off)
    a.legs += (0 - a.legs) * smooth(6, dt)
    if (remaining < 0.025 || (agent.stateTime > TIMERS.approachTimeout && remaining < 0.08)) {
      agent.phase = 'land'
      agent.land = { t: 0, from: copy(vec(), agent.position), fromForward: copy(vec(), agent.pose.forward), fromUp: copy(vec(), agent.pose.up), duration: TIMERS.land }
    } else if (agent.stateTime > TIMERS.approachTimeout * 1.5) {
      // Can't get there (blocked, or blown off): give up.
      agent.spotFailedAt = ctx.now
      takeOff(agent, ctx)
      return false
    }
    return false
  }
  if (agent.phase === 'land') {
    const land = agent.land
    land.t += dt / land.duration
    const t = ease(Math.min(land.t, 1))
    const p = agent.position
    p.x = lerp(land.from.x, pose.point.x, t)
    p.y = lerp(land.from.y, pose.point.y, t) + Math.sin(Math.PI * t) * 0.006
    p.z = lerp(land.from.z, pose.point.z, t)
    blendPose(agent, land.fromForward ?? agent.pose.forward, land.fromUp ?? agent.pose.up, pose.forward, pose.up, t)
    agent.airspeed *= 1 - smooth(4, dt)
    set(agent.velocity, 0, 0, 0)
    agent.climb = 0
    a.legs += (1 - a.legs) * smooth(8, dt)
    a.beat = lerp(1.2, 0.4, t)
    a.wings = 'flap'
    if (land.t >= 1) {
      agent.phase = 'settled'
      agent.yaw = yawOf(pose.forward.x, pose.forward.z)
    }
    return false
  }
  // Settled: stay on the (swaying) spot.
  copy(agent.position, pose.point)
  copy(agent.pose.forward, pose.forward)
  copy(agent.pose.up, pose.up)
  a.legs = 1
  return true
}

function blendPose(agent, f0, u0, f1, u1, t) {
  const f = agent.pose.forward
  const u = agent.pose.up
  set(f, lerp(f0.x, f1.x, t), lerp(f0.y, f1.y, t), lerp(f0.z, f1.z, t))
  normalize(f)
  set(u, lerp(u0.x, u1.x, t), lerp(u0.y, u1.y, t), lerp(u0.z, u1.z, t))
  // Make up perpendicular to forward.
  const along = u.x * f.x + u.y * f.y + u.z * f.z
  set(u, u.x - f.x * along, u.y - f.y * along, u.z - f.z * along)
  normalize(u)
}

/** One motion step of dt seconds for the current state. */
export function move(agent, ctx, dt) {
  const a = agent.anim
  agent.stateTime += dt
  const state = agent.state
  // Proboscis coils by default.
  let proboscis = 0
  if (state === 'explore') {
    agent.exploreTime += dt
    wander(agent, ctx, dt, agent.foraging ? FLIGHT.forage : FLIGHT.cruise, agent.foraging ? 1 : 0.7)
  } else if (state === 'searchScent') {
    searchScent(agent, ctx, dt)
  } else if (state === 'approach') {
    const t = agent.target
    const record = ctx.flowers.get(t.id)
    if (!record) {
      enter(agent, 'explore', ctx)
    } else {
      // Fly toward where it last saw the flower's landing spot.
      const remaining = flyTo(agent, ctx, dt, t.x, t.y + 0.035, t.z)
      if (remaining < 0.03) {
        enter(agent, 'land', ctx)
        agent.spot = flowerSpot(agent, record)
        agent.phase = 'land'
        agent.land = { t: 0, from: copy(vec(), agent.position), fromForward: copy(vec(), agent.pose.forward), fromUp: copy(vec(), agent.pose.up), duration: TIMERS.land }
        agent.target.lastSeen = ctx.now
        // Gusts can blow it off as it comes in.
        const gust = ctx.wind.strength * (0.8 + 0.4 * agent.random())
        agent.land.fails = gust > THRESHOLDS.landingWind * agent.traits.gustTolerance && agent.random() < THRESHOLDS.landingFailChance
      }
    }
  } else if (state === 'land') {
    const fails = agent.land?.fails
    if (fails && agent.land.t > 0.55) {
      // Blown off the flower: try again, or give it up after two misses.
      agent.landFails += 1
      if (agent.landFails >= 2) {
        agent.failed.set(agent.target.id, ctx.now)
        learn(agent, agent.target.type, 0)
        agent.landFails = 0
      }
      takeOff(agent, ctx)
    } else if (perchFlow(agent, ctx, dt)) {
      agent.landFails = 0
      enter(agent, 'probe', ctx)
    }
  } else if (state === 'probe' || state === 'feed') {
    const settled = perchFlow(agent, ctx, dt)
    const record = ctx.flowers.get(agent.spot?.id ?? agent.target?.id)
    if (!settled || !record) {
      // The flower went away under it.
      if (agent.state === state) takeOff(agent, ctx)
    } else {
      proboscis = probeAndFeed(agent, ctx, dt, record)
    }
  } else if (state === 'depart') {
    agent.timer += dt
    a.legs += (0 - a.legs) * smooth(5, dt)
    // Up and away, then wander.
    const ground = ctx.world.groundAt(agent.position.x, agent.position.z)
    const speed = agent.traits.speed * 0.6
    fly(agent, ctx, dt, forwardX(agent.yaw) * speed, forwardZ(agent.yaw) * speed, ground + agent.wander.height, FLIGHT.drift.cruise)
    if (agent.timer > TIMERS.depart) enter(agent, 'explore', ctx)
  } else if (state === 'bask' || state === 'seekShelter' || state === 'rest') {
    if (agent.reason === 'exhausted' && agent.phase === 'settled') crawl(agent, ctx, dt)
    else perchFlow(agent, ctx, dt)
  }
  // Wings by what it's doing.
  if (agent.phase === 'settled' && !FLYING.has(agent.state)) {
    if (agent.state === 'bask') a.wings = 'open'
    else if (agent.state === 'probe' || agent.state === 'feed') a.wings = 'feed'
    else a.wings = 'closed'
    a.beat = 0
  }
  // Proboscis: uncoils for probing and feeding, coils back otherwise.
  a.proboscis += clamp(proboscis - a.proboscis, -dt / (TIMERS.recoil * agent.traits.uncoil), dt / (TIMERS.uncoil * agent.traits.uncoil))
  a.phase += dt * 13 * a.beat
}

/** Probe, then drink. Returns the proboscis target (0 coiled – 1 out). */
function probeAndFeed(agent, ctx, dt, record) {
  const kind = FLOWER_TYPES[record.type]
  const a = agent.anim
  const pose = spotPose(agent, agent.spot, ctx, poseScratch)
  if (pose?.hasTip) copy(a.tip, pose.tip)
  const ratio = agent.traits.proboscis / kind.corollaDepth
  const access = clamp01((ratio - REACH.minRatio) / (1 - REACH.minRatio))
  // How far its proboscis gets toward the nectar.
  a.reach = Math.min(ratio, 1)
  const now = ctx.now
  const open = ctx.env.open[record.type] ?? 1
  const badWeather = ctx.env.rain > THRESHOLDS.rain.enter || ctx.wind.strength > THRESHOLDS.wind.enter
  if (agent.state === 'probe') {
    // Wait for the proboscis to uncoil, then feel for nectar.
    if (agent.stateTime < TIMERS.uncoil * agent.traits.uncoil + TIMERS.probe) return 1
    agent.stats.visits += 1
    if (access <= 0) {
      // Its tongue is too short for this corolla.
      agent.stats.outOfReach += 1
      learn(agent, record.type, 0)
      agent.failed.set(record.id, now)
      takeOff(agent, ctx)
      return 0
    }
    // Contact: only now does it find out how much nectar there is.
    if (ctx.flowers.readNectar(record.id, now) < 0.01) {
      agent.stats.empty += 1
      learn(agent, record.type, 0)
      agent.visited.set(record.id, now)
      takeOff(agent, ctx)
      return 0
    }
    agent.state = 'feed'
    agent.stateTime = 0
    agent.feed.drunk = 0
    agent.feed.access = access
    return 1
  }
  // Feeding.
  const room = agent.traits.energyCapacity - agent.energy
  const wanted = Math.min(ENERGY.intake * agent.feed.access * dt, room)
  const drunk = ctx.flowers.drink(record.id, wanted, now)
  agent.energy = clamp(agent.energy + drunk, 0, agent.traits.energyCapacity)
  agent.feed.drunk += drunk
  agent.stats.drunk += drunk
  const dry = wanted > 1e-6 && drunk < wanted * 0.2
  const full = agent.energy / agent.traits.energyCapacity >= THRESHOLDS.sated
  if (dry || full || agent.stateTime > TIMERS.feedMax || open < 0.3 || badWeather) {
    learn(agent, record.type, agent.feed.drunk)
    agent.visited.set(record.id, now)
    takeOff(agent, ctx)
    return 0
  }
  return 1
}

/** Exhausted: walk (no flight) to a flower it can see close by, if any. */
function crawl(agent, ctx, dt) {
  agent.anim.legs = 1
  const flower = agent.percept.flowers.find((f) => f.distance < 0.15 && !remembered(agent, f.id, ctx.now))
  if (!flower) return
  const dx = flower.x - agent.position.x
  const dz = flower.z - agent.position.z
  const d = Math.hypot(dx, dz)
  const record = ctx.flowers.get(flower.id)
  if (!record) return
  if (d < 0.01) {
    // Climb up onto it and probe.
    enter(agent, 'land', ctx)
    agent.target = { ...flower, lastSeen: ctx.now }
    agent.spot = flowerSpot(agent, record)
    agent.phase = 'land'
    agent.land = { t: 0, from: copy(vec(), agent.position), fromForward: copy(vec(), agent.pose.forward), fromUp: copy(vec(), agent.pose.up), duration: 1.5 }
    return
  }
  const step = Math.min(0.01 * dt, d)
  agent.yaw = yawOf(dx, dz)
  agent.spot.x += (dx / d) * step
  agent.spot.z += (dz / d) * step
  agent.spot.yaw = agent.yaw
  perchFlow(agent, ctx, dt)
}

// ---------------------------------------------------------------- body

/** Energy and body temperature for dt seconds. */
export function physiology(agent, ctx, dt) {
  const flying = isFlying(agent) && agent.state !== 'land'
  const settled = agent.phase === 'settled' && !FLYING.has(agent.state)
  const t = agent.traits
  let cost = t.restCost
  if (flying) cost = t.flightCost
  else if (agent.state === 'bask' && settled) cost = t.baskCost
  agent.energy = clamp(agent.energy - cost * dt, 0, agent.traits.energyCapacity)

  let posture = THERMAL.posture.perched
  if (flying) posture = THERMAL.posture.flight
  else if (agent.state === 'bask' && settled) posture = THERMAL.posture.bask
  else if (agent.anim.wings === 'closed') posture = THERMAL.posture.closed
  let sun = agent.percept.sun
  if (agent.spot && (agent.spot.kind === 'bark' || agent.spot.kind === 'cap') && settled) sun *= 0.3
  const equilibrium = ctx.env.air + THERMAL.sun * t.absorb * sun * posture + (flying ? THERMAL.flight : 0)
  const tau = t.warmTime / (1 + THERMAL.windCooling * ctx.wind.strength)
  agent.temperature += (equilibrium - agent.temperature) * (1 - Math.exp(-dt / tau))
}

/** Plain-words status for the followed butterfly. */
export function statusOf(agent) {
  switch (agent.state) {
    case 'explore':
      return agent.foraging ? 'Looking for flowers' : 'Wandering'
    case 'searchScent':
      return 'Caught a flower scent'
    case 'approach':
      return 'Flying to a flower'
    case 'land':
      return 'Landing on a flower'
    case 'probe':
      return 'Probing the flower'
    case 'feed':
      return 'Drinking nectar'
    case 'depart':
      return 'Leaving'
    case 'bask':
      return agent.phase === 'settled' ? 'Basking in the sun' : 'Looking for a sunny spot'
    case 'seekShelter':
      if (agent.phase !== 'settled') return agent.reason === 'rain' ? 'Seeking shelter from the rain' : 'Seeking shelter from the wind'
      return agent.reason === 'rain' ? 'Sheltering from the rain' : 'Sheltering from the wind'
    case 'rest':
      if (agent.reason === 'night') return agent.phase === 'settled' ? 'Resting for the night' : 'Going to roost'
      if (agent.reason === 'cold') return 'Too cold to fly'
      if (agent.reason === 'hot') return 'Resting in the shade'
      if (agent.reason === 'exhausted') return 'Too weak to fly'
      return 'Resting'
    default:
      return ''
  }
}

export { enter as enterState }
