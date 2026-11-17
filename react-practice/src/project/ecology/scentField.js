import { FLOWER_TYPES, SCENT, SCENT_NECTAR_DROP, SCENT_TYPES } from './ecologyConfig'

/**
 * Flower scent as particles: what the viewer sees drifting off the flowers
 * and what the butterflies sniff. One pool for the whole world, in typed
 * arrays (no objects per particle).
 *
 * Each particle: position (x, y, z), age, lifetime, scent type, strength.
 * Strength halves every SCENT.halfLife seconds; a particle is recycled at
 * the end of its life, once it is too faint, or when it drifts out of the
 * active area (SCENT.simRadius from its centre).
 *
 * Movement: new position = old position + local wind velocity × dt, plus,
 * as a separate and small term, a random walk with the set diffusion
 * (m²/s). No other random velocity, so with no wind a plume only spreads
 * slowly around its flower and with wind it goes downwind at wind speed.
 * Wind applies to every particle each step, so a change of wind turns the
 * particles already in the air.
 *
 * Emission: each open flower in the active area emits
 *   rate × openness × (1 − SCENT_NECTAR_DROP × (1 − nectar share))
 * particles per second. If every flower in range together would fill more
 * than BUDGET of the pool, all of them emit proportionally fewer particles
 * (emitScale < 1) and each new particle starts that much stronger, so the
 * expected concentration downwind stays the same; only its graininess
 * changes.
 *
 * Sniffing (sample): the scent around a point, per scent type, as
 * Σ strength × (1 − d² / r²) over particles within r: "particle
 * equivalents". It uses a spatial hash rebuilt each step, so a query only
 * looks at the few cells around it. Particles carry no flower id: a
 * butterfly can tell how much of which scent is here, never where it came
 * from.
 *
 * Plain data only, no Three.js.
 */

const BUCKETS = 8192
const BUDGET = 0.85
const TYPES = SCENT_TYPES.length

export function createScentField(random) {
  const capacity = SCENT.capacity
  const px = new Float32Array(capacity)
  const py = new Float32Array(capacity)
  const pz = new Float32Array(capacity)
  const age = new Float32Array(capacity)
  const life = new Float32Array(capacity)
  const strength = new Float32Array(capacity)
  const type = new Uint8Array(capacity)
  // A serial number per particle (stays with it when slots move), for the
  // display to thin a fixed subset without flicker.
  const serial = new Uint32Array(capacity)
  let nextSerial = 1
  // Bucket heads and links of the spatial hash (−1 = none).
  const head = new Int32Array(BUCKETS).fill(-1)
  const next = new Int32Array(capacity)
  let count = 0
  let emitScale = 1
  let emitted = 0
  let recycled = 0
  let dropped = 0
  const wind = { x: 0, z: 0 }
  const inv = 1 / SCENT.cell

  const bucket = (ix, iy, iz) => {
    let h = Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)
    h ^= h >>> 13
    return (h >>> 0) & (BUCKETS - 1)
  }

  // Remove particle i by moving the last one into its slot.
  const kill = (i) => {
    count -= 1
    if (i !== count) {
      px[i] = px[count]
      py[i] = py[count]
      pz[i] = pz[count]
      age[i] = age[count]
      life[i] = life[count]
      strength[i] = strength[count]
      type[i] = type[count]
      serial[i] = serial[count]
    }
    recycled += 1
  }

  const spawn = (x, y, z, scentType, s) => {
    if (count >= capacity) {
      dropped += 1
      return
    }
    const i = count
    count += 1
    px[i] = x
    py[i] = y
    pz[i] = z
    age[i] = 0
    life[i] = SCENT.lifetime[0] + (SCENT.lifetime[1] - SCENT.lifetime[0]) * random()
    strength[i] = s
    type[i] = scentType
    serial[i] = nextSerial
    nextSerial = (nextSerial + 1) >>> 0
    emitted += 1
  }

  const rebuildGrid = () => {
    head.fill(-1)
    for (let i = 0; i < count; i += 1) {
      const b = bucket(Math.floor(px[i] * inv), Math.floor(py[i] * inv), Math.floor(pz[i] * inv))
      next[i] = head[b]
      head[b] = i
    }
  }

  const meanLife = (SCENT.lifetime[0] + SCENT.lifetime[1]) / 2

  return {
    px,
    py,
    pz,
    age,
    life,
    strength,
    type,
    serial,
    get count() {
      return count
    },
    get emitScale() {
      return emitScale
    },

    /**
     * One step of dt seconds. ctx: { wind (windSampler), flowers (registry),
     * now (ecology time, s), center {x, z}, radius (emission range, m),
     * open [per flower type 0–1], level (season presence level), groundAt
     * (x, z) → m, diffusion (m²/s) }.
     */
    step(dt, ctx) {
      if (dt <= 0) return
      const decay = Math.pow(0.5, dt / SCENT.halfLife)
      const sigma = Math.sqrt(2 * Math.max(ctx.diffusion, 0) * dt)
      const reach2 = SCENT.simRadius * SCENT.simRadius
      const { center } = ctx
      for (let i = count - 1; i >= 0; i -= 1) {
        age[i] += dt
        strength[i] *= decay
        if (age[i] >= life[i] || strength[i] < SCENT.minStrength) {
          kill(i)
          continue
        }
        ctx.wind.at(px[i], pz[i], wind)
        px[i] += wind.x * dt
        pz[i] += wind.z * dt
        if (sigma > 0) {
          px[i] += sigma * random.normal()
          py[i] += sigma * random.normal()
          pz[i] += sigma * random.normal()
        }
        const floor = ctx.groundAt(px[i], pz[i]) + SCENT.floor
        if (py[i] < floor) py[i] = floor + (floor - py[i])
        const dx = px[i] - center.x
        const dz = pz[i] - center.z
        if (dx * dx + dz * dz > reach2) kill(i)
      }

      // Emission from open flowers in range, scaled to the pool's budget.
      let load = 0
      const emitting = []
      ctx.flowers.query(center.x, center.z, ctx.radius, (record) => {
        if (record.presence > ctx.level) return
        const kind = FLOWER_TYPES[record.type]
        const open = ctx.open[record.type] ?? 1
        if (open <= 0.02) return
        const rate =
          kind.scent.rate * open * (1 - SCENT_NECTAR_DROP * (1 - ctx.flowers.fullness(record, ctx.now)))
        load += rate * meanLife
        emitting.push(record, rate)
      })
      const wanted = load > 0 ? Math.min(1, (capacity * BUDGET) / load) : 1
      // Ease the scale so a flower coming into range doesn't jolt it.
      emitScale += (wanted - emitScale) * Math.min(dt * 2, 1)
      emitScale = Math.min(emitScale, wanted * 1.05, 1)
      for (let k = 0; k < emitting.length; k += 2) {
        const record = emitting[k]
        const rate = emitting[k + 1]
        record.emit += rate * emitScale * dt
        const scentType = FLOWER_TYPES[record.type].scent.type
        while (record.emit >= 1) {
          record.emit -= 1
          const jitter = record.radius * 0.3
          spawn(
            record.scent.x + (random() - 0.5) * jitter,
            record.scent.y,
            record.scent.z + (random() - 0.5) * jitter,
            scentType,
            1 / emitScale
          )
        }
      }
      rebuildGrid()
    },

    /**
     * Scent within `radius` of (x, y, z), per scent type, into out (an
     * array of SCENT_TYPES.length numbers). Returns the total.
     */
    sample(x, y, z, radius, out) {
      for (let k = 0; k < TYPES; k += 1) out[k] = 0
      const r2 = radius * radius
      const reach = Math.ceil(radius * inv)
      const cx = Math.floor(x * inv)
      const cy = Math.floor(y * inv)
      const cz = Math.floor(z * inv)
      let total = 0
      for (let iz = cz - reach; iz <= cz + reach; iz += 1) {
        for (let iy = cy - reach; iy <= cy + reach; iy += 1) {
          for (let ix = cx - reach; ix <= cx + reach; ix += 1) {
            for (let i = head[bucket(ix, iy, iz)]; i >= 0; i = next[i]) {
              // Buckets can share particles from far cells: check the cell.
              if (Math.floor(px[i] * inv) !== ix || Math.floor(py[i] * inv) !== iy || Math.floor(pz[i] * inv) !== iz) continue
              const dx = px[i] - x
              const dy = py[i] - y
              const dz = pz[i] - z
              const d2 = dx * dx + dy * dy + dz * dz
              if (d2 >= r2) continue
              const value = strength[i] * (1 - d2 / r2)
              out[type[i]] += value
              total += value
            }
          }
        }
      }
      return total
    },

    /** Drop every particle (a new world seed). */
    clear() {
      count = 0
      rebuildGrid()
    },

    stats() {
      return { particles: count, capacity, emitScale, emitted, recycled, dropped }
    },
  }
}
