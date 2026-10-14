import { createRandom } from '../../utils/distributions'
import { getNoise } from '../../utils/noise'
import { TILE_SIZE, hash } from '../terrain/heightField'
import { COVER_RULES } from './coverRules'

/**
 * Scatter one tile's ground cover from its data maps (terrain/tileData.js).
 * A tile owns the items whose centre lies inside it, so tiles never double
 * up. Moss is decided per world cell and mushrooms per trunk, so they're the
 * same whichever tile (or level of detail) computes them; twigs and leaves
 * come from the tile's own seeded random sequence.
 *
 * Each item: { x, y, z, yaw, normal: [x, y, z], scale: [x, y, z],
 *              palette, shade, variant }  (world metres; palette is an
 * index into the element's colour list in coverRules.js; leaves also carry
 * autumn: true/false and damp: 0–1)
 *
 * Plain data only, no Three.js.
 */

const SALT = { moss: 101, mushrooms: 211, damp: 307, twigs: 401, leaves: 503, flowers: 601, thin: 709 }
const smoothstep = (edge0, edge1, value) => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

// Bilinear lookups on the tile's grid at world (x, z).
function createLookup(data) {
  const { n, step, tileX, tileZ } = data
  const x0 = tileX * TILE_SIZE
  const z0 = tileZ * TILE_SIZE
  const at = (field, x, z) => {
    const gx = Math.min(Math.max((x - x0) / step, 0), n - 1)
    const gz = Math.min(Math.max((z - z0) / step, 0), n - 1)
    const c = Math.min(Math.floor(gx), n - 2)
    const r = Math.min(Math.floor(gz), n - 2)
    const fx = gx - c
    const fz = gz - r
    const i = r * n + c
    const top = field[i] + (field[i + 1] - field[i]) * fx
    const bottom = field[i + n] + (field[i + n + 1] - field[i + n]) * fx
    return top + (bottom - top) * fz
  }
  const normalAt = (x, z) => {
    const gx = Math.min(Math.max(Math.round((x - x0) / step), 0), n - 1)
    const gz = Math.min(Math.max(Math.round((z - z0) / step), 0), n - 1)
    const i = (gz * n + gx) * 3
    return [data.normal[i], data.normal[i + 1], data.normal[i + 2]]
  }
  const inside = (x, z) => x >= x0 && x < x0 + TILE_SIZE && z >= z0 && z < z0 + TILE_SIZE
  return { at, normalAt, inside, x0, z0 }
}

// Circles already claimed in this tile, so items don't overlap.
function createOccupancy() {
  const taken = []
  return {
    free(x, z, radius) {
      for (const other of taken) {
        const limit = radius + other.radius
        if ((other.x - x) ** 2 + (other.z - z) ** 2 < limit * limit) return false
      }
      return true
    },
    add(x, z, radius) {
      taken.push({ x, z, radius })
    },
  }
}

// Tilt "up" part of the way toward the ground normal (1 = lie on it).
function tilt(normal, amount) {
  const x = normal[0] * amount
  const y = 1 + (normal[1] - 1) * amount
  const z = normal[2] * amount
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
}

/**
 * data: tile data; options: { cover, seed, trunks }.
 * Returns { moss, mushrooms, twigs, branches, leaves: [variant0, 1, 2], flowers }.
 */
export function scatterTile(data, { cover, seed, trunks }) {
  const look = createLookup(data)
  const { x0, z0 } = look
  const occupancy = createOccupancy()
  const result = { moss: [], mushrooms: [], twigs: [], branches: [], leaves: [[], [], []], flowers: [] }
  const field = (name, x, z) => look.at(data[name], x, z)
  const ground = (x, z) => ({
    y: field('height', x, z),
    moisture: field('moisture', x, z),
    slope: field('slope', x, z),
    pebble: field('pebble', x, z),
    hill: field('hill', x, z),
    litter: field('litter', x, z),
    trunk: field('trunkDistance', x, z),
  })

  // --- Mushrooms: clusters seeded by trunks (roots) and by damp tiles.
  if (cover.mushrooms.on && cover.mushrooms.amount > 0) {
    const rule = COVER_RULES.mushrooms
    const amount = cover.mushrooms.amount / 100
    const clusters = []
    const centerX = x0 + TILE_SIZE / 2
    const centerZ = z0 + TILE_SIZE / 2
    const nearby = trunks ? trunks.trunksNear(centerX, centerZ, rule.trunkRing[1] + TILE_SIZE) : []
    for (const trunk of nearby) {
      for (let k = 0; k < rule.perTrunk; k += 1) {
        if (hash(trunk.seed, k, seed + SALT.mushrooms) >= amount) continue
        const angle = hash(trunk.seed, k, seed + SALT.mushrooms + 1) * Math.PI * 2
        const distance =
          trunk.radius + rule.trunkRing[0] + hash(trunk.seed, k, seed + SALT.mushrooms + 2) ** 1.5 * (rule.trunkRing[1] - rule.trunkRing[0])
        clusters.push({
          x: trunk.x + Math.cos(angle) * distance,
          z: trunk.z + Math.sin(angle) * distance,
          key: [trunk.seed, k],
          // Roots keep it damp enough near a trunk.
          minMoisture: rule.minMoisture - 0.15,
        })
      }
    }
    if (hash(data.tileX, data.tileZ, seed + SALT.damp) < rule.dampTileChance * amount) {
      clusters.push({
        x: x0 + hash(data.tileX, data.tileZ, seed + SALT.damp + 1) * TILE_SIZE,
        z: z0 + hash(data.tileX, data.tileZ, seed + SALT.damp + 2) * TILE_SIZE,
        key: [data.tileX * 7 + 3, data.tileZ * 13 + 5],
        minMoisture: rule.minMoisture + 0.1,
      })
    }
    for (const cluster of clusters) {
      const [a, b] = cluster.key
      const members =
        rule.clusterSize[0] + Math.floor(hash(a, b, seed + SALT.mushrooms + 3) * (rule.clusterSize[1] - rule.clusterSize[0] + 1))
      for (let m = 0; m < members; m += 1) {
        const angle = hash(a, b * 31 + m, seed + SALT.mushrooms + 4) * Math.PI * 2
        const spread = Math.sqrt(hash(a, b * 31 + m, seed + SALT.mushrooms + 5)) * rule.clusterRadius
        const x = cluster.x + Math.cos(angle) * spread
        const z = cluster.z + Math.sin(angle) * spread
        if (!look.inside(x, z)) continue
        const g = ground(x, z)
        if (g.moisture < cluster.minMoisture || g.slope > rule.maxSlope) continue
        if (g.hill > 0.2 || g.pebble > 0.3 || g.trunk < 0.005) continue
        const height = rule.height[0] + hash(a, b * 31 + m, seed + SALT.mushrooms + 6) ** 2 * (rule.height[1] - rule.height[0])
        if (!occupancy.free(x, z, height * 0.35)) continue
        occupancy.add(x, z, height * 0.35)
        // A slight random lean, partly following the ground.
        const lean = (hash(a, b * 31 + m, seed + SALT.mushrooms + 7) - 0.5) * 0.25
        const normal = tilt(look.normalAt(x, z), 0.4)
        result.mushrooms.push({
          x,
          y: g.y - height * 0.05,
          z,
          yaw: angle,
          normal: [normal[0] + lean, normal[1], normal[2] - lean],
          scale: [height, height, height],
          palette: Math.floor(hash(a, b * 31 + m, seed + SALT.mushrooms + 8) * 5),
          shade: hash(a, b * 31 + m, seed + SALT.mushrooms + 9),
          variant: 0,
        })
      }
    }
  }

  // --- Moss: one possible cushion per world cell, kept by a patch noise.
  if (cover.moss.on && cover.moss.amount > 0) {
    const rule = COVER_RULES.moss
    const amount = cover.moss.amount / 100
    const patchNoise = {
      type: 'perlin',
      scale: 1 / rule.patchWavelength,
      octaves: 2,
      persistence: 0.5,
      lacunarity: 2,
      seed: seed * 31 + SALT.moss,
    }
    const firstX = Math.floor(x0 / rule.cell)
    const firstZ = Math.floor(z0 / rule.cell)
    const lastX = Math.floor((x0 + TILE_SIZE) / rule.cell)
    const lastZ = Math.floor((z0 + TILE_SIZE) / rule.cell)
    for (let iz = firstZ; iz <= lastZ; iz += 1) {
      for (let ix = firstX; ix <= lastX; ix += 1) {
        const x = (ix + 0.15 + 0.7 * hash(ix, iz, seed + SALT.moss)) * rule.cell
        const z = (iz + 0.15 + 0.7 * hash(ix, iz, seed + SALT.moss + 1)) * rule.cell
        if (!look.inside(x, z)) continue
        const g = ground(x, z)
        if (g.slope > rule.maxSlope || g.hill > 0.2 || g.pebble > 0.3) continue
        const radius = rule.radius[0] + hash(ix, iz, seed + SALT.moss + 2) * (rule.radius[1] - rule.radius[0])
        if (g.trunk < radius * 0.5) continue
        const patch = 0.5 + 0.5 * getNoise(x, z, patchNoise)
        const wet = smoothstep(rule.minMoisture, rule.minMoisture + 0.25, g.moisture)
        const nearTrunk = Math.exp(-g.trunk / rule.trunkReach)
        // Beside (not on) a pebble.
        const step = 0.012
        const besidePebble =
          Math.max(
            field('pebble', x + step, z),
            field('pebble', x - step, z),
            field('pebble', x, z + step),
            field('pebble', x, z - step)
          ) > 0.5
        const chance =
          amount * (1.4 * patch ** 1.5 * wet + 0.9 * nearTrunk + (besidePebble ? 0.35 * wet : 0))
        if (hash(ix, iz, seed + SALT.moss + 3) >= chance) continue
        if (!occupancy.free(x, z, radius * 0.7)) continue
        occupancy.add(x, z, radius * 0.7)
        const tall = rule.height[0] + hash(ix, iz, seed + SALT.moss + 4) * (rule.height[1] - rule.height[0])
        result.moss.push({
          x,
          y: g.y - radius * 0.1,
          z,
          yaw: hash(ix, iz, seed + SALT.moss + 5) * Math.PI * 2,
          normal: tilt(look.normalAt(x, z), 1),
          scale: [radius, radius * tall, radius],
          palette: Math.floor(hash(ix, iz, seed + SALT.moss + 6) * 4),
          shade: hash(ix, iz, seed + SALT.moss + 7),
          variant: 0,
        })
      }
    }
  }

  const tileRandom = (salt) => createRandom(Math.floor(hash(data.tileX, data.tileZ, seed + salt) * 4294967295))

  // --- Twigs and small branches: uniform random, more under trees.
  if (cover.twigs.on && cover.twigs.amount > 0) {
    const rule = COVER_RULES.twigs
    const amount = cover.twigs.amount / 100
    const random = tileRandom(SALT.twigs)
    const tries = Math.round(rule.perTile * (1 + rule.underTreeBoost))
    for (let k = 0; k < tries; k += 1) {
      const x = x0 + random() * TILE_SIZE
      const z = z0 + random() * TILE_SIZE
      const yaw = random() * Math.PI * 2
      const keep = random()
      const isBranch = random() < rule.branchChance
      const size = random()
      const palette = Math.floor(random() * 4)
      const shade = random()
      const g = ground(x, z)
      const underTree = Math.exp(-g.trunk / rule.underTreeReach)
      const chance = (amount * (1 + rule.underTreeBoost * underTree)) / (1 + rule.underTreeBoost)
      if (keep >= chance) continue
      if (g.slope > rule.maxSlope || g.hill > 0.3 || g.trunk < 0.02) continue
      const range = isBranch ? rule.branchLength : rule.length
      const length = range[0] + size * (range[1] - range[0])
      if (!occupancy.free(x, z, length * 0.15)) continue
      occupancy.add(x, z, length * 0.15)
      const item = {
        x,
        y: g.y + 0.001,
        z,
        yaw,
        normal: tilt(look.normalAt(x, z), 1),
        scale: [length, length, length],
        palette,
        shade,
        variant: 0,
      }
      ;(isBranch ? result.branches : result.twigs).push(item)
    }
  }

  // --- Leaves: uniform random with random turns, gathering in litter
  // patches, hollows, and under trees.
  if (cover.leaves.on && cover.leaves.amount > 0) {
    const rule = COVER_RULES.leaves
    const amount = cover.leaves.amount / 100
    const autumn = cover.autumn / 100
    const random = tileRandom(SALT.leaves)
    const tries = Math.round(rule.perTile * (1 + rule.underTreeBoost))
    for (let k = 0; k < tries; k += 1) {
      const x = x0 + random() * TILE_SIZE
      const z = z0 + random() * TILE_SIZE
      const yaw = random() * Math.PI * 2
      const keep = random()
      const size = random()
      const variant = Math.floor(random() * rule.variants)
      const isAutumn = random() < autumn
      const pick = random()
      const lift = random()
      // Every candidate draws all its numbers up front, so one leaf kept or
      // dropped never shifts the rest (tiles at any detail agree).
      const shade = random()
      const g = ground(x, z)
      const underTree = Math.exp(-g.trunk / rule.underTreeReach)
      const litter = 0.3 + 0.7 * smoothstep(0.3, 0.8, g.litter)
      const hollow = 0.8 + 0.4 * smoothstep(0.45, 0.7, g.moisture)
      const chance =
        (amount * litter * hollow * (1 + rule.underTreeBoost * underTree)) / (1 + rule.underTreeBoost)
      if (keep >= chance) continue
      if (g.slope > rule.maxSlope || g.hill > 0.35 || g.pebble > 0.5 || g.trunk < 0.01) continue
      const length = rule.length[0] + size * (rule.length[1] - rule.length[0])
      // Leaves may overlap each other and twigs, but not moss or mushrooms.
      if (!occupancy.free(x, z, length * 0.2)) continue
      result.leaves[variant].push({
        x,
        y: g.y + 0.0005 + lift * 0.0015,
        z,
        yaw,
        normal: tilt(look.normalAt(x, z), 1),
        scale: [length, length, length],
        // Index into LEAF_COLORS.autumn or LEAF_COLORS.green.
        autumn: isAutumn,
        palette: Math.floor(pick * (isAutumn ? 5 : 4)),
        shade,
        variant,
        // Wetter leaves look darker (decaying).
        damp: g.moisture,
      })
    }
  }

  // --- Flowers (wood anemones): one possible flower per world cell, kept
  // in noise-clustered drifts. Placed last, so they never move anything else.
  if (cover.flowers?.on && cover.flowers.amount > 0) {
    const rule = COVER_RULES.flowers
    const amount = cover.flowers.amount / 100
    const firstX = Math.floor(x0 / rule.cell)
    const firstZ = Math.floor(z0 / rule.cell)
    const lastX = Math.floor((x0 + TILE_SIZE) / rule.cell)
    const lastZ = Math.floor((z0 + TILE_SIZE) / rule.cell)
    for (let iz = firstZ; iz <= lastZ; iz += 1) {
      for (let ix = firstX; ix <= lastX; ix += 1) {
        const h = (k) => hash(ix, iz, seed + SALT.flowers + k)
        const x = (ix + 0.1 + 0.8 * h(0)) * rule.cell
        const z = (iz + 0.1 + 0.8 * h(1)) * rule.cell
        if (!look.inside(x, z)) continue
        const g = ground(x, z)
        if (g.slope > rule.maxSlope || g.hill > 0.1 || g.pebble > 0.2 || g.trunk < rule.trunkGap) continue
        const suited = flowerMoisture(g.moisture)
        const patch = flowerPatchAt(x, z, seed)
        if (h(2) >= amount * suited * smoothstep(0.45, 0.75, patch) * 1.6) continue
        if (!occupancy.free(x, z, 0.006)) continue
        occupancy.add(x, z, 0.006)
        const height = rule.height[0] + h(3) * (rule.height[1] - rule.height[0])
        // Mostly upright, nodding a little.
        const lean = (h(4) - 0.5) * 0.3
        result.flowers.push({
          x,
          y: g.y - 0.002,
          z,
          yaw: h(5) * Math.PI * 2,
          normal: [lean, 1, (h(6) - 0.5) * 0.3],
          scale: [height, height, height],
          palette: Math.floor(h(7) * 4),
          shade: h(8),
          variant: 0,
        })
      }
    }
  }

  // Middle-ring tiles keep a fixed share of each kind, decided per item by
  // its position, so this is always a subset of the full scatter: when the
  // tile comes into the near ring, items are only added, never moved.
  if (data.pebbles === false) thinForDistance(result, seed)

  return result
}

// Share of each kind kept in the middle ring. Big features stay whole
// (mushrooms, branches, large moss cushions) so patches still read from
// the air; small litter thins.
export const MIDDLE_RING_KEEP = {
  mushrooms: 1,
  branches: 1,
  mossLarge: 1,
  moss: 0.5,
  flowers: 0.85,
  twigs: 0.75,
  leaves: 0.5,
}
// Moss cushions at least this wide (radius, m) count as large.
const LARGE_MOSS = 0.012

function thinForDistance(result, seed) {
  const keep = (item, share) =>
    share >= 1 || hash(Math.round(item.x * 1e5), Math.round(item.z * 1e5), seed + SALT.thin) < share
  const k = MIDDLE_RING_KEEP
  result.mushrooms = result.mushrooms.filter((item) => keep(item, k.mushrooms))
  result.branches = result.branches.filter((item) => keep(item, k.branches))
  result.moss = result.moss.filter((item) => keep(item, item.scale[0] >= LARGE_MOSS ? k.mossLarge : k.moss))
  result.flowers = result.flowers.filter((item) => keep(item, k.flowers))
  result.twigs = result.twigs.filter((item) => keep(item, k.twigs))
  result.leaves = result.leaves.map((list) => list.filter((item) => keep(item, k.leaves)))
}

/** Flower drift strength at (x, z): 0–1 (flowers grow above ~0.5). */
export function flowerPatchAt(x, z, seed) {
  const rule = COVER_RULES.flowers
  return (
    0.5 +
    0.5 *
      getNoise(x, z, {
        type: 'perlin',
        scale: 1 / rule.patchWavelength,
        octaves: 2,
        persistence: 0.5,
        lacunarity: 2,
        seed: seed * 37 + SALT.flowers,
      })
  )
}

/** How well flowers like this moisture: 0–1 (moist, not wet). */
export function flowerMoisture(moisture) {
  const [dry, wet] = COVER_RULES.flowers.moisture
  return smoothstep(dry, dry + 0.15, moisture) * (1 - smoothstep(wet - 0.1, wet, moisture))
}
