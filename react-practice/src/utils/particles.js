/**
 * Reusable particle pool: preallocated arrays, no allocation per frame.
 * Behaviour lives in the systems that own a pool (see windParticles.js).
 * Plain data only, no Three.js.
 */

export const DEAD = 0
export const FLYING = 1
export const RESTING = 2
export const FLOATING = 3

export class ParticlePool {
  constructor(capacity) {
    this.capacity = capacity
    this.position = new Float32Array(capacity * 3)
    this.velocity = new Float32Array(capacity * 3)
    // Rotation angles (x, y, z) for particles drawn as meshes.
    this.spin = new Float32Array(capacity * 3)
    this.color = new Float32Array(capacity * 3)
    // Drawn size, and the size it started with (for particles that grow).
    this.size = new Float32Array(capacity)
    this.baseSize = new Float32Array(capacity)
    this.alpha = new Float32Array(capacity)
    this.age = new Float32Array(capacity)
    this.life = new Float32Array(capacity)
    this.timer = new Float32Array(capacity)
    // Per-particle random 0–1, for phases and variety.
    this.seed = new Float32Array(capacity)
    this.state = new Uint8Array(capacity)
    this.free = []
    for (let index = capacity - 1; index >= 0; index -= 1) this.free.push(index)
    this.alive = 0
  }

  /** Index of a fresh particle, or -1 when the pool is full. */
  spawn() {
    if (this.free.length === 0) return -1
    const index = this.free.pop()
    this.state[index] = FLYING
    this.age[index] = 0
    this.timer[index] = 0
    this.alpha[index] = 0
    this.alive += 1
    return index
  }

  kill(index) {
    if (this.state[index] === DEAD) return
    this.state[index] = DEAD
    this.alpha[index] = 0
    this.size[index] = 0
    this.free.push(index)
    this.alive -= 1
  }

  clear() {
    for (let index = 0; index < this.capacity; index += 1) this.kill(index)
  }
}

/**
 * Fast ground lookups for particles: bilinear height, and whether a point
 * is over water (lake or river, nearest grid cell).
 */
export function createGround(fields) {
  const { points, step, size, heights, grids } = fields
  const half = size / 2
  return {
    height(x, z) {
      const gx = Math.min(Math.max((x + half) / step, 0), points - 1)
      const gz = Math.min(Math.max((z + half) / step, 0), points - 1)
      const c = Math.min(Math.floor(gx), points - 2)
      const r = Math.min(Math.floor(gz), points - 2)
      const fx = gx - c
      const fz = gz - r
      const i = r * points + c
      const top = heights[i] + (heights[i + 1] - heights[i]) * fx
      const bottom = heights[i + points] + (heights[i + points + 1] - heights[i + points]) * fx
      return top + (bottom - top) * fz
    },
    isWater(x, z) {
      const column = Math.min(Math.max(Math.round((x + half) / step), 0), points - 1)
      const row = Math.min(Math.max(Math.round((z + half) / step), 0), points - 1)
      const index = row * points + column
      return grids.isLake[index] === 1 || grids.isRiver[index] === 1
    },
    inside(x, z, margin = 0) {
      return Math.abs(x) <= half + margin && Math.abs(z) <= half + margin
    },
  }
}

/** Weighted random picks from a list (weights ≥ 0), via cumulative sums. */
export function createPicker(items, weightOf) {
  const cumulative = new Float32Array(items.length)
  let total = 0
  items.forEach((item, index) => {
    total += Math.max(weightOf(item), 0)
    cumulative[index] = total
  })
  return {
    total,
    pick(random) {
      if (total <= 0) return null
      const target = random() * total
      let low = 0
      let high = items.length - 1
      while (low < high) {
        const middle = (low + high) >> 1
        if (cumulative[middle] < target) low = middle + 1
        else high = middle
      }
      return items[low]
    },
  }
}
