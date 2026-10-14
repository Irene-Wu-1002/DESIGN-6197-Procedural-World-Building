import { createRandom } from '../../utils/distributions'
import { TILE_SIZE, hash } from '../terrain/heightField'
import { COVER_RULES, FLOWER_COLORS, HABITAT_NORMAL, MOSS_COLORS } from './coverRules'
import { FULL_DENSITY } from './flowerField'

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
 * autumn: true/false and damp: 0–1). Habitat fields (moisture, sunlight,
 * shade, wind) come with the tile data.
 *
 * Plain data only, no Three.js.
 */

const SALT = { moss: 101, mushrooms: 211, damp: 307, twigs: 401, leaves: 503, flowers: 601, thin: 709, zone: 811 }
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

// Circles already claimed in this tile, so items don't overlap. Moss
// circles are marked, so flowers can grow up through a moss carpet.
function createOccupancy() {
  const taken = []
  return {
    free(x, z, radius, { throughMoss = false } = {}) {
      for (const other of taken) {
        if (throughMoss && other.moss) continue
        const limit = radius + other.radius
        if ((other.x - x) ** 2 + (other.z - z) ** 2 < limit * limit) return false
      }
      return true
    },
    add(x, z, radius, moss = false) {
      taken.push({ x, z, radius, moss })
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
 * data: tile data; options: { cover, seed, trunks, moss, flowers,
 * exclusions } (moss and flowers: the patch and colony fields,
 * cover/mossField.js and cover/flowerField.js; exclusions: the exclusion
 * zones, paths/exclusionZones.js, or null). Large things (mushrooms,
 * branches) stay wholly out of the zones; small things fade back in across
 * the soft edge and thin out on the ant trail.
 * Returns { moss, mushrooms, twigs, branches, leaves: [variant0, 1, 2], flowers }.
 */
export function scatterTile(data, { cover, seed, trunks, moss, flowers, exclusions = null }) {
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
    sunlight: field('sunlight', x, z),
    shade: field('shade', x, z),
    wind: field('wind', x, z),
    concavity: field('concavity', x, z),
    habitatSlope: field('habitatSlope', x, z),
  })
  // Exclusion zones: large things are blocked; small things survive with
  // this share (0–1; on the trail, as far as ants clear it).
  const blocked = (x, z, radius) => (exclusions ? exclusions.blocks(x, z, radius) : false)
  const smallKeep = (x, z) => (exclusions ? exclusions.keep(x, z) : 1)
  // Small things shrink a little where they fade out.
  const fadeScale = (keep) => 0.6 + 0.4 * keep

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
        const sunny = Math.max(g.sunlight - HABITAT_NORMAL.sunlight, 0) / (1 - HABITAT_NORMAL.sunlight)
        if (hash(a, b * 31 + m, seed + SALT.mushrooms + 10) < rule.sunAvoidance * sunny) continue
        const height = rule.height[0] + hash(a, b * 31 + m, seed + SALT.mushrooms + 6) ** 2 * (rule.height[1] - rule.height[0])
        // Large: the whole cap must stay out of the zones.
        if (blocked(x, z, height * 0.35)) continue
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

  // --- Moss: connected patches (mossField.js), filled with cushions on a
  // jittered world grid. Cushions in a patch may touch each other (that's
  // what makes a carpet); they avoid what's already placed, and everything
  // placed later avoids them.
  if (cover.moss.on && cover.moss.amount > 0 && moss) {
    const rule = COVER_RULES.moss
    const settings = cover.moss
    const { cell, jitter } = moss
    const placed = []
    // Habitat for moss, averaged over a 1.5 cm ring: this cancels the ~3 cm
    // hollows, so preferences follow broader damp, shady ground and patches
    // don't crumble into specks.
    const ring = 0.015
    const mossGround = (x, z, g) => {
      const average = (name) =>
        (g[name] +
          field(name, x + ring, z) +
          field(name, x - ring, z) +
          field(name, x, z + ring) +
          field(name, x, z - ring)) /
        5
      return { moisture: average('moisture'), shade: average('shade'), concavity: average('concavity'), trunk: g.trunk }
    }
    const firstX = Math.floor(x0 / cell)
    const firstZ = Math.floor(z0 / cell)
    const lastX = Math.floor((x0 + TILE_SIZE) / cell)
    const lastZ = Math.floor((z0 + TILE_SIZE) / cell)
    for (let iz = firstZ; iz <= lastZ; iz += 1) {
      for (let ix = firstX; ix <= lastX; ix += 1) {
        const h = (k) => hash(ix, iz, seed + SALT.moss + k)
        const x = (ix + 0.5 + jitter * (h(0) - 0.5)) * cell
        const z = (iz + 0.5 + jitter * (h(1) - 0.5)) * cell
        if (!look.inside(x, z)) continue
        const g = ground(x, z)
        if (g.habitatSlope > settings.maxSlope || g.hill > 0.2 || g.pebble > 0.3) continue
        const keep = smallKeep(x, z)
        const density = moss.density(x, z, mossGround(x, z, g)) * keep
        // Inside a patch every cell grows; at a soft edge, fewer do.
        if (density < 0.02 || h(2) >= density) continue
        const variation = 1 + (settings.scaleVariation / 100) * (h(3) * 2 - 1) * 0.6
        const radius = cell * rule.radius * (1 - rule.edgeShrink * (1 - density)) * variation * fadeScale(keep)
        if (g.trunk < radius * 0.5 || !occupancy.free(x, z, radius * 0.7)) continue
        placed.push([x, z, radius * 0.7])
        const tall = rule.height[0] + h(4) * (rule.height[1] - rule.height[0])
        // Each patch has its own tone; colour variation mixes in others.
        const colorVariation = settings.colorVariation / 100
        const palette = h(6) < colorVariation * 0.6 ? Math.floor(h(7) * MOSS_COLORS.length) : moss.toneAt(x, z)
        result.moss.push({
          x,
          y: g.y - radius * 0.1,
          z,
          yaw: h(5) * Math.PI * 2,
          normal: tilt(look.normalAt(x, z), 1),
          scale: [radius, radius * tall, radius],
          palette,
          shade: 0.5 + (h(8) - 0.5) * colorVariation,
          variant: 0,
        })
      }
    }
    for (const [x, z, radius] of placed) occupancy.add(x, z, radius, true)
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
      const sheltered = preference(1 - g.wind, rule.windShelter, 1 - HABITAT_NORMAL.wind)
      // Branches are large (blocked by the zones); twigs are small (fade).
      const zoneKeep = isBranch ? 1 : smallKeep(x, z)
      const chance =
        (amount * sheltered * zoneKeep * (1 + rule.underTreeBoost * underTree)) / (1 + rule.underTreeBoost)
      if (keep >= chance) continue
      if (g.slope > rule.maxSlope || g.hill > 0.3 || g.trunk < 0.02) continue
      const range = isBranch ? rule.branchLength : rule.length
      const length = (range[0] + size * (range[1] - range[0])) * fadeScale(zoneKeep)
      if (isBranch && blocked(x, z, length / 2)) continue
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
      const sheltered = preference(1 - g.wind, rule.windShelter, 1 - HABITAT_NORMAL.wind)
      const zoneKeep = smallKeep(x, z)
      const chance =
        (amount * litter * hollow * sheltered * zoneKeep * (1 + rule.underTreeBoost * underTree)) /
        (1 + rule.underTreeBoost)
      if (keep >= chance) continue
      if (g.slope > rule.maxSlope || g.hill > 0.35 || g.pebble > 0.5 || g.trunk < 0.01) continue
      const length = (rule.length[0] + size * (rule.length[1] - rule.length[0])) * fadeScale(zoneKeep)
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

  // --- Flowers (wood anemones): colonies (flowerField.js), or evenly
  // spaced / fully random where the ground suits them. Placed last, so
  // they never move anything else.
  if (cover.flowers.on && cover.flowers.amount > 0 && flowers) {
    const rule = COVER_RULES.flowers
    const settings = cover.flowers
    const colorVariation = settings.colorVariation / 100
    const suits = (g) =>
      g.hill <= 0.1 && g.pebble <= 0.2 && g.trunk >= rule.trunkGap
        ? flowers.suitability({ sunlight: g.sunlight, moisture: g.moisture, slope: g.habitatSlope })
        : 0
    // h: seven 0–1 numbers fixed for this flower (size, height, look).
    const addFlower = (x, z, tone, h) => {
      const g = ground(x, z)
      // Fade near the zones and on the trail, decided by position (the same
      // whichever tile places it).
      const zoneKeep = smallKeep(x, z)
      if (hash(Math.round(x * 1e5), Math.round(z * 1e5), seed + SALT.zone) >= zoneKeep) return
      if (!occupancy.free(x, z, 0.006, { throughMoss: true })) return
      occupancy.add(x, z, 0.006)
      const middle = (rule.height[0] + rule.height[1]) / 2
      const halfRange = (rule.height[1] - rule.height[0]) / 2
      const height = middle + (h[0] * 2 - 1) * halfRange * (settings.heightVariation / 100)
      const size = (1 + (h[1] * 2 - 1) * rule.scaleSpread * (settings.scaleVariation / 100)) * fadeScale(zoneKeep)
      // Mostly upright, nodding a little.
      const lean = (h[2] - 0.5) * 0.3
      result.flowers.push({
        x,
        y: g.y - 0.002,
        z,
        yaw: h[3] * Math.PI * 2,
        normal: [lean, 1, (h[4] - 0.5) * 0.3],
        scale: [middle * size, height * size, middle * size],
        // Each colony (or area) has a tone; colour variation mixes in others.
        palette: h[5] < colorVariation * 0.7 ? Math.floor(h[6] * FLOWER_COLORS.length) : tone,
        shade: 0.5 + (h[6] - 0.5) * colorVariation,
        variant: 0,
      })
    }

    if (settings.distribution === 'colonies') {
      for (const colony of flowers.coloniesIn(x0, z0, x0 + TILE_SIZE, z0 + TILE_SIZE)) {
        for (const flower of colony.flowers) {
          if (look.inside(flower.x, flower.z)) addFlower(flower.x, flower.z, colony.tone, flower.h)
        }
      }
    } else if (settings.distribution === 'even') {
      // One candidate per jittered cell, the cell set by the density (never
      // closer than the minimum spacing).
      const amount = settings.amount / 100
      const cell = Math.max(settings.minSpacing / 100 / 0.6, 1 / Math.sqrt(amount * FULL_DENSITY))
      for (let iz = Math.floor(z0 / cell); iz <= Math.floor((z0 + TILE_SIZE) / cell); iz += 1) {
        for (let ix = Math.floor(x0 / cell); ix <= Math.floor((x0 + TILE_SIZE) / cell); ix += 1) {
          const h = (k) => hash(ix, iz, seed + settings.seedOffset * 7919 + SALT.flowers + k)
          const x = (ix + 0.5 + 0.4 * (h(0) - 0.5)) * cell
          const z = (iz + 0.5 + 0.4 * (h(1) - 0.5)) * cell
          if (!look.inside(x, z)) continue
          const g = ground(x, z)
          if (h(2) >= suits(g) * flowers.regionAt(x, z)) continue
          addFlower(x, z, flowers.toneAt(x, z), [h(3), h(4), h(5), h(6), h(7), h(8), h(9)])
        }
      }
    } else {
      // Fully random: the same average density, no spacing rule.
      const random = tileRandom(SALT.flowers + settings.seedOffset * 7919)
      const tries = Math.round((settings.amount / 100) * FULL_DENSITY * TILE_SIZE * TILE_SIZE)
      for (let k = 0; k < tries; k += 1) {
        const x = x0 + random() * TILE_SIZE
        const z = z0 + random() * TILE_SIZE
        const keep = random()
        const h = [random(), random(), random(), random(), random(), random(), random()]
        const g = ground(x, z)
        if (keep >= suits(g) * flowers.regionAt(x, z)) continue
        addFlower(x, z, flowers.toneAt(x, z), h)
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

/**
 * A habitat preference multiplier, 1 + 2 · weight · (value − middle): 1 at
 * `middle`, and with the default middle from 1 − weight (value 0) to
 * 1 + weight (value 1). Never negative.
 */
export function preference(value, weight, middle = 0.5) {
  return Math.max(1 + 2 * weight * (value - middle), 0)
}
