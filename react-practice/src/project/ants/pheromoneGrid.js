/**
 * The pheromone grid: two scents laid by the ant agents on a square of
 * ground centred on the ant hill.
 *   home   laid by ants walking out from the nest (leads back to it)
 *   food   laid by ants carrying food home (leads out to the food)
 * Both evaporate (a half-life) and spread to their neighbours (diffusion).
 * Unlike the rest of the world this is stored state: it can't be rebuilt
 * from the seed, only grown again by the ants.
 *
 * Cell (ix, iz) is index iz * n + ix and covers
 * [minX + ix * cell, minX + (ix + 1) * cell) along x (likewise z).
 *
 * Plain data only, no Three.js.
 */

// Scent never piles up past this (the busiest trails just saturate).
const MAX_SCENT = 1000

export function createPheromoneGrid({ centerX, centerZ, size, cell }) {
  const n = Math.round(size / cell)
  const minX = centerX - (n * cell) / 2
  const minZ = centerZ - (n * cell) / 2
  const food = new Float32Array(n * n)
  const home = new Float32Array(n * n)
  const scratch = new Float32Array(n * n)

  /** Cell index under (x, z), or -1 outside the grid. */
  const indexAt = (x, z) => {
    const ix = Math.floor((x - minX) / cell)
    const iz = Math.floor((z - minZ) / cell)
    if (ix < 0 || iz < 0 || ix >= n || iz >= n) return -1
    return iz * n + ix
  }

  // Spread over the four nearest cells, so trails come out smooth.
  const splat = (field, x, z, amount) => {
    const fx = (x - minX) / cell - 0.5
    const fz = (z - minZ) / cell - 0.5
    const ix = Math.floor(fx)
    const iz = Math.floor(fz)
    const tx = fx - ix
    const tz = fz - iz
    for (const [dx, dz, w] of [
      [0, 0, (1 - tx) * (1 - tz)],
      [1, 0, tx * (1 - tz)],
      [0, 1, (1 - tx) * tz],
      [1, 1, tx * tz],
    ]) {
      const cx = ix + dx
      const cz = iz + dz
      if (cx < 0 || cz < 0 || cx >= n || cz >= n) continue
      const i = cz * n + cx
      field[i] = Math.min(field[i] + amount * w, MAX_SCENT)
    }
  }

  // Evaporate, then blend each cell toward the mean of its four neighbours.
  const relax = (field, keep, diffusion) => {
    if (diffusion <= 0) {
      for (let i = 0; i < field.length; i += 1) field[i] *= keep
      return
    }
    scratch.set(field)
    for (let iz = 0; iz < n; iz += 1) {
      const row = iz * n
      for (let ix = 0; ix < n; ix += 1) {
        const i = row + ix
        const left = ix > 0 ? scratch[i - 1] : scratch[i]
        const right = ix < n - 1 ? scratch[i + 1] : scratch[i]
        const down = iz > 0 ? scratch[i - n] : scratch[i]
        const up = iz < n - 1 ? scratch[i + n] : scratch[i]
        const mean = (left + right + down + up) * 0.25
        field[i] = (scratch[i] + (mean - scratch[i]) * diffusion) * keep
      }
    }
  }

  return {
    n,
    cell,
    minX,
    minZ,
    size: n * cell,
    food,
    home,
    indexAt,

    /** Scent of one field ('food' or 'home') at (x, z); 0 outside. */
    sample(field, x, z) {
      const i = indexAt(x, z)
      return i < 0 ? 0 : field[i]
    },

    deposit(field, x, z, amount) {
      splat(field, x, z, amount)
    },

    /**
     * Age both scents by dt seconds: halfLife (s) of the evaporation,
     * diffusion (0–1) per second.
     */
    relax(dt, { halfLife, diffusion }) {
      const keep = 0.5 ** (dt / Math.max(halfLife, 0.1))
      const spread = Math.min(diffusion * dt, 1)
      relax(food, keep, spread)
      relax(home, keep, spread)
    },

    clear() {
      food.fill(0)
      home.fill(0)
    },
  }
}
