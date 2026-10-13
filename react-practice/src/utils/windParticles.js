import { createRandom } from './distributions'
import {
  DEAD,
  FLOATING,
  FLYING,
  ParticlePool,
  RESTING,
  createGround,
  createPicker,
} from './particles'

/**
 * Week 5 wind particles, all pushed by the wind field:
 *   leaves  shed by trees (coloured like the tree), tumble, land, and can be
 *           lifted again by a strong gust; on water they float and fade
 *   seeds   light pollen/seed fluff from sunny grass and bushes; follows the
 *           wind closely and rides updrafts
 *   dust    puffs off the dirt roads, only while a gust passes
 * Plain data only, no Three.js (see particleRenderers.js for drawing).
 */

export const WIND_PARTICLE_LIMITS = { leaves: 1000, seeds: 5000, dust: 800 }

// The wind strength the default emission rates are tuned for (m/s).
const REFERENCE_STRENGTH = 6
// Seconds a particle takes to fade out at the end of its life.
const FADE = 0.8
// Toggled-off systems age this much faster, so they clear out quickly.
const FAST_AGING = 4

const LEAF = {
  life: [8, 14],
  size: [0.8, 1.4],
  drag: 1.6,
  gravity: 1.4,
  flutter: 1.6,
  rest: [2, 5],
  // A resting leaf can be lifted again when the gust and the (near-ground,
  // so slowed) wind are this strong.
  liftGust: 1.25,
  liftSpeed: 2.8,
  floatTime: 3,
}

const SEED = {
  life: [6, 12],
  size: [0.07, 0.12],
  drag: 5,
  sink: 0.07,
  colors: [
    [1, 0.97, 0.82],
    [0.98, 0.92, 0.55],
    [1, 1, 1],
  ],
}

const DUST = {
  life: [1.5, 3],
  size: [0.35, 0.6],
  drag: 2,
  rise: 0.5,
  color: [0.74, 0.62, 0.44],
  opacity: 0.28,
  // Puffs only lift where the gust factor and wind speed are this high.
  gust: 1.15,
  minSpeed: 2.5,
  puff: [3, 5],
}

const mean = ([low, high]) => (low + high) / 2

export function createWindParticles() {
  const pools = {
    leaves: new ParticlePool(WIND_PARTICLE_LIMITS.leaves),
    seeds: new ParticlePool(WIND_PARTICLE_LIMITS.seeds),
    dust: new ParticlePool(WIND_PARTICLE_LIMITS.dust),
  }
  const random = createRandom(2024)
  const between = ([low, high]) => low + (high - low) * random()
  const carry = { leaves: 0, seeds: 0, dust: 0 }
  const air = { x: 0, y: 0, z: 0, gust: 1, speed: 0 }
  let env = null

  /**
   * fields: terrain maps; wind: wind field;
   * leafSources: [{ x, y, z, radius, height, color: [r, g, b] }] tree canopies;
   * bushes: [{ x, z }]; roads: buildRoads() result or null.
   */
  function setEnvironment({ fields, wind, leafSources, bushes, roads }) {
    const { points, step, size, grids } = fields
    const half = size / 2
    // Seed sources: sunny, gentle, dry grass (every 4th grid point), plus bushes.
    const meadow = []
    for (let row = 0; row < points; row += 4) {
      for (let column = 0; column < points; column += 4) {
        const index = row * points + column
        if (grids.isLake[index] || grids.isRiver[index]) continue
        if (grids.slope[index] > fields.rockSlope || grids.roadDistance[index] < 0.8) continue
        const sun = fields.sampleAt(index).sun
        meadow.push({
          x: -half + column * step,
          z: -half + row * step,
          weight: sun * (1 - grids.slope[index] / 45),
        })
      }
    }
    for (const bush of bushes) meadow.push({ x: bush.x, z: bush.z, weight: 2 })

    const reference = Math.max(wind.base, 0.01)
    env = {
      fields,
      wind,
      ground: createGround(fields),
      // Exposed trees shed more leaves.
      leaves: createPicker(leafSources, (tree) => (wind.speedAt(tree.x, tree.z) / reference) ** 2),
      seeds: createPicker(meadow, (spot) => spot.weight),
      roads: roads ? roads.roads.flatMap((road) => road.samples.filter((s) => !s.bridge)) : [],
      roadWidth: roads?.roads[0]?.width ?? 1.5,
    }
  }

  // Emit at a rate that keeps about `target` alive, scaled by wind strength.
  function emit(kind, dt, settings, lifeRange, spawnOne) {
    const config = settings[kind]
    if (!config.on) {
      carry[kind] = 0
      return
    }
    const pool = pools[kind]
    const target = WIND_PARTICLE_LIMITS[kind] * (config.amount / 100)
    const windFactor = Math.min(settings.strength / REFERENCE_STRENGTH, 2)
    carry[kind] += (target / mean(lifeRange)) * windFactor * dt
    while (carry[kind] >= 1) {
      carry[kind] -= 1
      if (pool.alive >= target) {
        carry[kind] = 0
        break
      }
      spawnOne()
    }
  }

  function spawnLeaf() {
    const tree = env.leaves.pick(random)
    if (!tree) return
    const pool = pools.leaves
    const index = pool.spawn()
    if (index < 0) return
    const p = index * 3
    const angle = random() * Math.PI * 2
    const reach = random() * tree.radius
    pool.position[p] = tree.x + Math.cos(angle) * reach
    pool.position[p + 1] = tree.y + between([0.5, 1]) * tree.height
    pool.position[p + 2] = tree.z + Math.sin(angle) * reach
    pool.velocity.fill(0, p, p + 3)
    pool.spin[p] = random() * Math.PI * 2
    pool.spin[p + 1] = random() * Math.PI * 2
    pool.spin[p + 2] = random() * Math.PI * 2
    const tint = 0.9 + random() * 0.2
    pool.color[p] = tree.color[0] * tint
    pool.color[p + 1] = tree.color[1] * tint
    pool.color[p + 2] = tree.color[2] * tint
    pool.size[index] = pool.baseSize[index] = between(LEAF.size)
    pool.life[index] = between(LEAF.life)
    pool.seed[index] = random()
  }

  function spawnSeed() {
    const spot = env.seeds.pick(random)
    if (!spot) return
    const pool = pools.seeds
    const index = pool.spawn()
    if (index < 0) return
    const p = index * 3
    const x = spot.x + (random() - 0.5) * 0.8
    const z = spot.z + (random() - 0.5) * 0.8
    pool.position[p] = x
    pool.position[p + 1] = env.ground.height(x, z) + between([0.1, 0.6])
    pool.position[p + 2] = z
    pool.velocity.fill(0, p, p + 3)
    const color = SEED.colors[Math.floor(random() * SEED.colors.length)]
    pool.color.set(color, p)
    pool.size[index] = pool.baseSize[index] = between(SEED.size)
    pool.life[index] = between(SEED.life)
    pool.seed[index] = random()
  }

  // One attempt: a random road spot puffs only if a gust is passing over it.
  function spawnDustPuff() {
    if (env.roads.length === 0) return
    const spot = env.roads[Math.floor(random() * env.roads.length)]
    env.wind.sample(spot.x, spot.y + 0.3, spot.z, air)
    if (air.gust < DUST.gust || air.speed < DUST.minSpeed) return
    const pool = pools.dust
    const count = Math.round(between(DUST.puff))
    for (let n = 0; n < count; n += 1) {
      const index = pool.spawn()
      if (index < 0) return
      const p = index * 3
      pool.position[p] = spot.x + (random() - 0.5) * env.roadWidth
      pool.position[p + 1] = spot.y + between([0.05, 0.2])
      pool.position[p + 2] = spot.z + (random() - 0.5) * env.roadWidth
      pool.velocity[p] = air.x * 0.5
      pool.velocity[p + 1] = 0.3 + random() * 0.4
      pool.velocity[p + 2] = air.z * 0.5
      const tint = 0.9 + random() * 0.15
      pool.color[p] = DUST.color[0] * tint
      pool.color[p + 1] = DUST.color[1] * tint
      pool.color[p + 2] = DUST.color[2] * tint
      pool.size[index] = pool.baseSize[index] = between(DUST.size)
      pool.life[index] = between(DUST.life)
      pool.seed[index] = random()
    }
  }

  function updateLeaves(dt, aging) {
    const pool = pools.leaves
    const { wind, ground, fields } = env
    const [wx, wz] = wind.direction
    const { position: pos, velocity: vel, spin } = pool
    for (let index = 0; index < pool.capacity; index += 1) {
      const state = pool.state[index]
      if (state === DEAD) continue
      pool.age[index] += dt * aging
      const p = index * 3
      let x = pos[p]
      let y = pos[p + 1]
      let z = pos[p + 2]
      const seed = pool.seed[index]

      if (state === FLYING) {
        wind.sample(x, y, z, air)
        vel[p] += (air.x - vel[p]) * LEAF.drag * dt
        vel[p + 2] += (air.z - vel[p + 2]) * LEAF.drag * dt
        vel[p + 1] += (air.y * 0.6 - vel[p + 1]) * LEAF.drag * 0.5 * dt - LEAF.gravity * dt
        // Flutter: side-to-side and up-down wobble across the wind.
        const phase = pool.age[index] * (3 + seed * 3) + seed * 40
        const wobble = Math.sin(phase)
        vel[p] += -wz * wobble * LEAF.flutter * dt
        vel[p + 2] += wx * wobble * LEAF.flutter * dt
        vel[p + 1] += Math.cos(phase * 1.3) * 0.9 * dt
        x += vel[p] * dt
        y += vel[p + 1] * dt
        z += vel[p + 2] * dt
        const tumble = (2 + seed * 4) * (0.4 + Math.hypot(vel[p], vel[p + 2]) * 0.25) * dt
        spin[p] += tumble
        spin[p + 1] += tumble * 0.6
        spin[p + 2] += tumble * 0.8

        const floor = ground.height(x, z)
        if (y <= floor + 0.03) {
          vel.fill(0, p, p + 3)
          if (ground.isWater(x, z)) {
            pool.state[index] = FLOATING
            y = floor + Math.max(fields.sample(x, z).depth, 0) + 0.02
            pool.timer[index] = LEAF.floatTime
          } else {
            pool.state[index] = RESTING
            y = floor + 0.03
            pool.timer[index] = between(LEAF.rest)
          }
          // Lie flat.
          spin[p] = 0
          spin[p + 2] = 0
        }
      } else if (state === RESTING) {
        pool.timer[index] -= dt * aging
        wind.sample(x, y + 0.4, z, air)
        if (air.gust > LEAF.liftGust && air.speed > LEAF.liftSpeed && random() < dt * 0.8) {
          pool.state[index] = FLYING
          vel[p] = air.x * 0.3
          vel[p + 1] = 1.2 + random()
          vel[p + 2] = air.z * 0.3
        } else if (pool.timer[index] <= 0) {
          pool.life[index] = Math.min(pool.life[index], pool.age[index] + FADE)
        }
      } else if (state === FLOATING) {
        wind.sample(x, y, z, air)
        x += air.x * 0.08 * dt
        z += air.z * 0.08 * dt
        pool.timer[index] -= dt * aging
        if (pool.timer[index] <= 0) {
          pool.kill(index)
          continue
        }
      }

      if (!ground.inside(x, z, 0.5) || pool.age[index] >= pool.life[index]) {
        pool.kill(index)
        continue
      }
      pos[p] = x
      pos[p + 1] = y
      pos[p + 2] = z
      let fade = Math.min(1, (pool.life[index] - pool.age[index]) / FADE, pool.age[index] / 0.3)
      if (pool.state[index] === FLOATING) fade = Math.min(fade, pool.timer[index] / LEAF.floatTime)
      pool.alpha[index] = fade
      pool.size[index] = pool.baseSize[index] * fade
    }
  }

  function updateSeeds(dt, aging) {
    const pool = pools.seeds
    const { wind, ground } = env
    const { position: pos, velocity: vel } = pool
    for (let index = 0; index < pool.capacity; index += 1) {
      if (pool.state[index] === DEAD) continue
      pool.age[index] += dt * aging
      const p = index * 3
      wind.sample(pos[p], pos[p + 1], pos[p + 2], air)
      vel[p] += (air.x - vel[p]) * SEED.drag * dt
      vel[p + 1] += (air.y - vel[p + 1]) * SEED.drag * dt - SEED.sink * dt
      vel[p + 2] += (air.z - vel[p + 2]) * SEED.drag * dt
      pos[p] += vel[p] * dt
      pos[p + 1] += vel[p + 1] * dt
      pos[p + 2] += vel[p + 2] * dt
      // Skim along the ground instead of passing through it.
      const floor = ground.height(pos[p], pos[p + 2]) + 0.05
      if (pos[p + 1] < floor) {
        pos[p + 1] = floor
        if (vel[p + 1] < 0) vel[p + 1] = -vel[p + 1] * 0.3
      }
      if (!ground.inside(pos[p], pos[p + 2], 0.5) || pool.age[index] >= pool.life[index]) {
        pool.kill(index)
        continue
      }
      pool.alpha[index] =
        0.85 * Math.min(1, pool.age[index] / 0.6, (pool.life[index] - pool.age[index]) / 1)
    }
  }

  function updateDust(dt, aging) {
    const pool = pools.dust
    const { wind, ground } = env
    const { position: pos, velocity: vel } = pool
    for (let index = 0; index < pool.capacity; index += 1) {
      if (pool.state[index] === DEAD) continue
      pool.age[index] += dt * aging
      const t = pool.age[index] / pool.life[index]
      if (t >= 1) {
        pool.kill(index)
        continue
      }
      const p = index * 3
      wind.sample(pos[p], pos[p + 1], pos[p + 2], air)
      vel[p] += (air.x * 0.7 - vel[p]) * DUST.drag * dt
      vel[p + 2] += (air.z * 0.7 - vel[p + 2]) * DUST.drag * dt
      // Rises at first, then settles.
      vel[p + 1] += (DUST.rise * (1 - t) - 0.25 * t) * dt - vel[p + 1] * 0.5 * dt
      pos[p] += vel[p] * dt
      pos[p + 1] += vel[p + 1] * dt
      pos[p + 2] += vel[p + 2] * dt
      const floor = ground.height(pos[p], pos[p + 2]) + 0.05
      if (pos[p + 1] < floor) pos[p + 1] = floor
      if (!ground.inside(pos[p], pos[p + 2], 0.5)) {
        pool.kill(index)
        continue
      }
      pool.size[index] = pool.baseSize[index] * (0.6 + 0.9 * t)
      pool.alpha[index] = DUST.opacity * (1 - t) * Math.min(1, pool.age[index] / 0.15)
    }
  }

  /** Advance every wind particle by dt seconds. settings = the wind state. */
  function update(dt, settings) {
    if (!env) return
    emit('leaves', dt, settings, LEAF.life, spawnLeaf)
    emit('seeds', dt, settings, SEED.life, spawnSeed)
    // Dust tries more often than it succeeds (only during gusts).
    emit('dust', dt * 3, settings, DUST.life, spawnDustPuff)
    updateLeaves(dt, settings.leaves.on ? 1 : FAST_AGING)
    updateSeeds(dt, settings.seeds.on ? 1 : FAST_AGING)
    updateDust(dt, settings.dust.on ? 1 : FAST_AGING)
  }

  function clear() {
    Object.values(pools).forEach((pool) => pool.clear())
  }

  return { pools, setEnvironment, update, clear }
}
