import { getNoise } from './noise'

/**
 * Week 5 wind: one wind model that particles, tree sway, and windmills read.
 *
 * Static part (rebuilt when terrain, trees, or wind settings change), on a
 * coarse grid:
 *   hill speed-up   faster on high ground
 *   steering        bends partly around steep hills
 *   updraft         rises up windward slopes, sinks down lee slopes
 *   shelter         calm behind ridges and forests that stand higher upwind
 *   forest drag     slower inside dense groves
 * Moving part (update(time) every frame), on a 1 m grid:
 *   gusts           patches of stronger wind that sweep downwind
 *   turbulence      small swirls (curl noise), stronger in sheltered spots
 *
 * Plain data only, no Three.js.
 */

export const DEFAULT_WIND = {
  playing: true,
  // Degrees the wind comes FROM; windmills face this way.
  direction: 45,
  strength: 6,
  gustiness: 40,
  turbulence: 30,
  terrainInfluence: 100,
  leaves: { on: true, amount: 60 },
  seeds: { on: true, amount: 50 },
  dust: { on: true, amount: 50 },
  sway: { on: true, strength: 100 },
  showField: false,
}

const COARSE = 2
// How far upwind (m) a ridge or forest can shelter a spot.
const SHELTER_REACH = 8
const FOREST_HEIGHT = 2
// Blurred trees per cell that counts as a full forest.
const FULL_FOREST = 0.35
const DYNAMIC_SPACING = 1
const GUST_SCALE = 0.07
const TURBULENCE_SCALE = 0.18
// Gust fronts travel at this share of the wind speed.
const GUST_TRAVEL = 0.6

/** Unit vector the wind blows toward (x, z) for a "from" angle in degrees. */
export function windVector(direction) {
  const radians = (direction * Math.PI) / 180
  return [-Math.sin(radians), -Math.cos(radians)]
}

function smoothstep(edge0, edge1, value) {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

// Separable box blur, radius in cells.
function blur(values, points, radius) {
  const temp = new Float32Array(values.length)
  const out = new Float32Array(values.length)
  const width = radius * 2 + 1
  for (let row = 0; row < points; row += 1) {
    for (let column = 0; column < points; column += 1) {
      let sum = 0
      for (let c = column - radius; c <= column + radius; c += 1) {
        if (c >= 0 && c < points) sum += values[row * points + c]
      }
      temp[row * points + column] = sum / width
    }
  }
  for (let row = 0; row < points; row += 1) {
    for (let column = 0; column < points; column += 1) {
      let sum = 0
      for (let r = row - radius; r <= row + radius; r += 1) {
        if (r >= 0 && r < points) sum += temp[r * points + column]
      }
      out[row * points + column] = sum / width
    }
  }
  return out
}

function createBilinear(points, step, size) {
  const half = size / 2
  return (field, x, z) => {
    const gx = Math.min(Math.max((x + half) / step, 0), points - 1)
    const gz = Math.min(Math.max((z + half) / step, 0), points - 1)
    const c = Math.min(Math.floor(gx), points - 2)
    const r = Math.min(Math.floor(gz), points - 2)
    const fx = gx - c
    const fz = gz - r
    const i = r * points + c
    const top = field[i] + (field[i + 1] - field[i]) * fx
    const bottom = field[i + points] + (field[i + points + 1] - field[i + points]) * fx
    return top + (bottom - top) * fz
  }
}

/**
 * fields: terrain maps; trees: [{ x, z }] (pines and round trees);
 * settings: the wind state. Returns the wind field object.
 */
export function buildWindField(fields, trees, settings) {
  const { size } = fields
  const points = Math.floor((fields.points - 1) / COARSE) + 1
  const step = fields.step * COARSE
  const count = points * points
  const half = size / 2
  const [dx, dz] = windVector(settings.direction)
  const base = settings.strength
  const influence = settings.terrainInfluence / 100
  const capped = Math.min(influence, 1)
  const bilinear = createBilinear(points, step, size)

  const height = new Float32Array(count)
  const level = new Float32Array(count)
  for (let row = 0; row < points; row += 1) {
    for (let column = 0; column < points; column += 1) {
      const fine = row * COARSE * fields.points + column * COARSE
      height[row * points + column] = fields.heights[fine]
      level[row * points + column] = fields.grids.level[fine]
    }
  }

  // Forest density: trees per cell, blurred to a smooth 0–1 map.
  const trunks = new Float32Array(count)
  for (const tree of trees) {
    const column = Math.round((tree.x + half) / step)
    const row = Math.round((tree.z + half) / step)
    if (column >= 0 && row >= 0 && column < points && row < points) {
      trunks[row * points + column] += 1
    }
  }
  const forest = blur(blur(trunks, points, 2), points, 2)
  for (let index = 0; index < count; index += 1) {
    forest[index] = Math.min(forest[index] / FULL_FOREST, 1)
  }
  // Height of the "obstacle" surface: ground plus canopy.
  const canopy = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    canopy[index] = height[index] + forest[index] * FOREST_HEIGHT
  }

  const velocityX = new Float32Array(count)
  const velocityZ = new Float32Array(count)
  const velocityY = new Float32Array(count)
  const shelter = new Float32Array(count)
  const speed = new Float32Array(count)

  for (let row = 0; row < points; row += 1) {
    for (let column = 0; column < points; column += 1) {
      const index = row * points + column
      const x = -half + column * step
      const z = -half + row * step
      const left = column > 0 ? index - 1 : index
      const right = column < points - 1 ? index + 1 : index
      const up = row > 0 ? index - points : index
      const down = row < points - 1 ? index + points : index
      const gx = (height[right] - height[left]) / ((right - left) * step)
      const gz = (height[down] - height[up]) / (((down - up) / points) * step)

      // Steering: remove part of the flow that runs straight into a slope.
      let vx = dx
      let vz = dz
      const gradient = Math.hypot(gx, gz)
      if (gradient > 1e-4) {
        const nx = gx / gradient
        const nz = gz / gradient
        const into = vx * nx + vz * nz
        const amount = Math.min(gradient, 1) * 0.5 * capped
        vx -= into * nx * amount
        vz -= into * nz * amount
        const length = Math.hypot(vx, vz) || 1
        vx /= length
        vz /= length
      }

      // Shelter: steepest rise of ground or canopy looking upwind.
      let worst = 0
      for (let distance = step; distance <= SHELTER_REACH; distance += step) {
        const upwind = bilinear(canopy, x - dx * distance, z - dz * distance)
        worst = Math.max(worst, (upwind - height[index]) / distance)
      }
      const calm = smoothstep(0.05, 0.4, worst) * capped

      const speedUp = Math.max(1 + 0.5 * (level[index] - 0.5) * influence, 0.2)
      const drag = forest[index] * 0.6 * capped
      const local = base * speedUp * (1 - 0.65 * calm) * (1 - drag)
      // Ground rising downwind pushes air up; falling ground pulls it down.
      const rise = gx * dx + gz * dz

      velocityX[index] = vx * local
      velocityZ[index] = vz * local
      velocityY[index] = base * rise * 0.6 * influence * (1 - calm)
      shelter[index] = calm
      speed[index] = local
    }
  }

  // Moving gusts and turbulence on a coarser 1 m grid, refreshed per frame.
  const dynamicPoints = Math.round(size / DYNAMIC_SPACING) + 1
  const dynamicCount = dynamicPoints * dynamicPoints
  const dynamicBilinear = createBilinear(dynamicPoints, DYNAMIC_SPACING, size)
  const gust = new Float32Array(dynamicCount).fill(1)
  const turbulenceX = new Float32Array(dynamicCount)
  const turbulenceZ = new Float32Array(dynamicCount)
  const turbulenceY = new Float32Array(dynamicCount)
  const gustiness = settings.gustiness / 100
  const turbulence = settings.turbulence / 100
  const gustNoise = { type: 'perlin', scale: GUST_SCALE, octaves: 2, seed: 77 }
  const swirlNoise = { type: 'perlin', scale: TURBULENCE_SCALE, octaves: 1, seed: 91 }
  const liftNoise = { type: 'perlin', scale: TURBULENCE_SCALE, octaves: 1, seed: 13 }
  const epsilon = 0.25

  let slowest = Infinity
  let fastest = 0
  for (let index = 0; index < count; index += 1) {
    slowest = Math.min(slowest, speed[index])
    fastest = Math.max(fastest, speed[index])
  }

  const field = {
    size,
    base,
    direction: [dx, dz],
    gustiness,
    // Calmest and windiest static speed anywhere on the map.
    speedRange: [slowest, fastest],
    // Static wind speed at ground level (no gusts), for previews.
    speedAt: (x, z) => bilinear(speed, x, z),
    shelterAt: (x, z) => bilinear(shelter, x, z),
    gustAt: (x, z) => dynamicBilinear(gust, x, z),

    update(time) {
      const travel = base * GUST_TRAVEL * time
      for (let row = 0; row < dynamicPoints; row += 1) {
        for (let column = 0; column < dynamicPoints; column += 1) {
          const index = row * dynamicPoints + column
          const x = -half + column * DYNAMIC_SPACING
          const z = -half + row * DYNAMIC_SPACING
          // Gust pattern slides downwind over time.
          const gx = x - dx * travel
          const gz = z - dz * travel
          const g = getNoise(gx, gz, gustNoise)
          gust[index] = Math.max(1 + gustiness * 2.2 * g, 0.2)
          if (turbulence === 0) continue
          // Curl of a drifting noise potential: swirls with no sources or sinks.
          const sx = x - dx * travel * 0.5 + time * 0.7
          const sz = z - dz * travel * 0.5 - time * 0.5
          const dPsiDz =
            (getNoise(sx, sz + epsilon, swirlNoise) - getNoise(sx, sz - epsilon, swirlNoise)) /
            (2 * epsilon)
          const dPsiDx =
            (getNoise(sx + epsilon, sz, swirlNoise) - getNoise(sx - epsilon, sz, swirlNoise)) /
            (2 * epsilon)
          const strength = (turbulence * base * 0.6) / TURBULENCE_SCALE
          turbulenceX[index] = dPsiDz * strength
          turbulenceZ[index] = -dPsiDx * strength
          turbulenceY[index] = getNoise(sx, sz, liftNoise) * turbulence * base * 0.3
        }
      }
    },

    /**
     * Wind velocity at a point, written into `out` ({ x, y, z, gust, speed }).
     * Slower near the ground (wind profile); updrafts fade with height.
     */
    sample(x, y, z, out) {
      const ground = bilinear(height, x, z)
      const above = Math.max(y - ground, 0)
      const profile = 0.35 + 0.65 * smoothstep(0, 3, above)
      const g = dynamicBilinear(gust, x, z)
      const calm = bilinear(shelter, x, z)
      const swirl = 0.5 + calm
      out.gust = g
      out.x = bilinear(velocityX, x, z) * profile * g + dynamicBilinear(turbulenceX, x, z) * swirl
      out.z = bilinear(velocityZ, x, z) * profile * g + dynamicBilinear(turbulenceZ, x, z) * swirl
      out.y =
        bilinear(velocityY, x, z) * (1 - smoothstep(0, 6, above)) +
        dynamicBilinear(turbulenceY, x, z) * swirl
      out.speed = bilinear(speed, x, z) * profile * g
      return out
    },
  }
  field.update(0)
  return field
}
