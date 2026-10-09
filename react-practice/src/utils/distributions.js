// Week 5: ways to scatter points across a square area.
// Every method is seeded, so one seed rebuilds the same layout.

export const DISTRIBUTION_METHODS = [
  {
    id: 'random',
    label: 'Uniform random',
    note: 'Each point picks x and y independently. Fast, but points clump together and leave gaps.',
  },
  {
    id: 'grid',
    label: 'Jittered grid',
    note: 'One point per grid cell, nudged by the jitter amount. Even coverage that still looks loose.',
  },
  {
    id: 'poisson',
    label: 'Poisson disk',
    note: 'No two points closer than the minimum spacing (Bridson’s algorithm). Natural, evenly spaced, like a forest.',
  },
  {
    id: 'clustered',
    label: 'Noise clustered',
    note: 'Random points kept only where a noise field is high, so they gather into groves and clearings.',
  },
]

// Small seeded random number generator (mulberry32).
export function createRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function uniformRandom(count, size, random) {
  const points = []
  for (let index = 0; index < count; index += 1) {
    points.push({ x: random() * size, y: random() * size })
  }
  return points
}

function jitteredGrid(count, size, jitter, random) {
  const cells = Math.max(1, Math.round(Math.sqrt(count)))
  const cellSize = size / cells
  const points = []
  for (let row = 0; row < cells; row += 1) {
    for (let column = 0; column < cells; column += 1) {
      const offsetX = 0.5 + (random() - 0.5) * jitter
      const offsetY = 0.5 + (random() - 0.5) * jitter
      points.push({
        x: (column + offsetX) * cellSize,
        y: (row + offsetY) * cellSize,
      })
    }
  }
  return points
}

// Bridson's fast Poisson disk sampling, capped at `count` points.
function poissonDisk(count, size, minDistance, random, attempts = 30) {
  const cellSize = minDistance / Math.SQRT2
  const gridWidth = Math.ceil(size / cellSize)
  const grid = new Array(gridWidth * gridWidth).fill(-1)
  const points = []
  const active = []

  const addPoint = (point) => {
    points.push(point)
    active.push(points.length - 1)
    const column = Math.floor(point.x / cellSize)
    const row = Math.floor(point.y / cellSize)
    grid[row * gridWidth + column] = points.length - 1
  }

  const isFarEnough = (point) => {
    const column = Math.floor(point.x / cellSize)
    const row = Math.floor(point.y / cellSize)
    for (let y = Math.max(0, row - 2); y <= Math.min(gridWidth - 1, row + 2); y += 1) {
      for (let x = Math.max(0, column - 2); x <= Math.min(gridWidth - 1, column + 2); x += 1) {
        const neighbour = grid[y * gridWidth + x]
        if (neighbour === -1) continue
        const dx = points[neighbour].x - point.x
        const dy = points[neighbour].y - point.y
        if (dx * dx + dy * dy < minDistance * minDistance) return false
      }
    }
    return true
  }

  addPoint({ x: random() * size, y: random() * size })

  while (active.length > 0 && points.length < count) {
    const activeIndex = Math.floor(random() * active.length)
    const origin = points[active[activeIndex]]
    let found = false

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const angle = random() * Math.PI * 2
      const radius = minDistance * (1 + random())
      const candidate = {
        x: origin.x + Math.cos(angle) * radius,
        y: origin.y + Math.sin(angle) * radius,
      }
      if (candidate.x < 0 || candidate.x >= size || candidate.y < 0 || candidate.y >= size) {
        continue
      }
      if (isFarEnough(candidate)) {
        addPoint(candidate)
        found = true
        break
      }
    }

    if (!found) active.splice(activeIndex, 1)
  }

  return points
}

// Smooth value noise on a lattice, used as the clustering density field.
function valueNoise(x, y, seed) {
  const hash = (gridX, gridY) => {
    let value = Math.imul(gridX, 374761393) + Math.imul(gridY, 668265263) + seed
    value = Math.imul(value ^ (value >>> 13), 1274126177)
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296
  }
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const top = hash(x0, y0) + (hash(x0 + 1, y0) - hash(x0, y0)) * sx
  const bottom = hash(x0, y0 + 1) + (hash(x0 + 1, y0 + 1) - hash(x0, y0 + 1)) * sx
  return top + (bottom - top) * sy
}

export function clusterDensity(x, y, size, clusterScale, seed) {
  const frequency = clusterScale / size
  return valueNoise(x * frequency, y * frequency, seed)
}

function noiseClustered(count, size, clusterScale, seed, random) {
  const points = []
  const maxTries = count * 40
  for (let tries = 0; tries < maxTries && points.length < count; tries += 1) {
    const x = random() * size
    const y = random() * size
    const density = clusterDensity(x, y, size, clusterScale, seed)
    // Sharpen the field so clearings stay mostly empty.
    if (random() < density ** 3) points.push({ x, y })
  }
  return points
}

export function distributePoints({
  method,
  count,
  size,
  seed,
  jitter,
  minDistance,
  clusterScale,
}) {
  const random = createRandom(seed)
  switch (method) {
    case 'grid':
      return jitteredGrid(count, size, jitter, random)
    case 'poisson':
      return poissonDisk(count, size, minDistance, random)
    case 'clustered':
      return noiseClustered(count, size, clusterScale, seed, random)
    case 'random':
    default:
      return uniformRandom(count, size, random)
  }
}
