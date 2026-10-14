import { ANT_HILL, TILE_SIZE } from '../terrain/heightField'
import { COVER_RULES, HABITAT_NORMAL, LEAF_COLORS } from './coverRules'

/**
 * Fallen leaves for one tile (called by scatterTile.js after twigs, so
 * leaves can pile against branches). Each candidate's chance multiplies:
 *
 *   drift      leafField.drift: drifts stretched along the wind
 *   hollow     more in hollows, fewer on ridges (hollow preference)
 *   obstacles  a band beside trunk bases (roots), the ant hill, the fly
 *              agaric, pebbles and branches, and a tail on their downwind
 *              (lee) side (obstacle accumulation; the lee scales with wind
 *              influence and the local wind)
 *   wind       fewer where it's windy, more where it's calm
 *   trees      more under trees (as before)
 *
 * Leaves keep the minimum spacing, except the overlap share, which pile on
 * top (a little higher for each leaf beneath). Colours come from
 * leafField.colorAt, so neighbours are related; a quarter pick their own.
 */

const smoothstep = (edge0, edge1, value) => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

// A soft band along an obstacle's edge (d: metres from its edge).
const besideBand = (d, width) => (d < 0 ? 0 : Math.exp(-d / width))

// A tail behind an obstacle (centre cx, cz, radius r) along the wind
// (wx, wz), length `reach` × r.
function leeTail(x, z, cx, cz, r, wx, wz, reach) {
  const px = x - cx
  const pz = z - cz
  const along = px * wx + pz * wz - r
  if (along < 0) return 0
  const across = Math.abs(px * wz - pz * wx)
  return Math.exp(-along / (reach * r)) * Math.exp(-((across / (r * 1.1)) ** 2))
}

// Distance from (x, z) to a branch lying on the ground (centre, yaw, length).
function branchDistance(x, z, branch) {
  const half = branch.scale[0] / 2
  const ux = Math.cos(branch.yaw)
  const uz = -Math.sin(branch.yaw)
  const t = Math.min(Math.max((x - branch.x) * ux + (z - branch.z) * uz, -half), half)
  return Math.hypot(x - branch.x - ux * t, z - branch.z - uz * t)
}

/**
 * ctx: { data, look, ground, occupancy, result, settings (cover.leaves),
 * leafField, trunks, landmarks: { antHill, agaric }, smallKeep, fadeScale,
 * random (the tile's seeded sequence), tilt }
 */
export function scatterLeaves(ctx) {
  const { data, look, ground, occupancy, result, settings, leafField, trunks, landmarks, smallKeep, fadeScale, random, tilt } = ctx
  const rule = COVER_RULES.leaves
  const amount = settings.amount / 100
  const hollowPreference = settings.hollowPreference / 100
  const obstacles = (settings.obstacleAccumulation / 100) * rule.obstacleBoost
  const windInfluence = settings.windInfluence / 100
  const spacing = settings.minSpacing / 100
  const overlap = settings.overlapAmount / 100
  const scaleVariation = settings.scaleVariation / 100
  const rotationVariation = settings.rotationVariation / 100
  const x0 = data.tileX * TILE_SIZE
  const z0 = data.tileZ * TILE_SIZE
  const field = (name, x, z) => look.at(data[name], x, z)
  const nearTrunks = trunks ? trunks.trunksNear(x0 + TILE_SIZE / 2, z0 + TILE_SIZE / 2, rule.trunkReach + TILE_SIZE) : []
  const branches = result.branches
  const placed = []

  // How much obstacles gather leaves at (x, z), with the wind (wx, wz).
  const obstacleAt = (x, z, g, wx, wz) => {
    let beside = 0
    let lee = 0
    for (const trunk of nearTrunks) {
      const d = Math.hypot(x - trunk.x, z - trunk.z) - trunk.radius
      beside = Math.max(beside, besideBand(d, rule.rootBand))
      lee = Math.max(lee, leeTail(x, z, trunk.x, trunk.z, trunk.radius, wx, wz, rule.leeReach))
    }
    if (landmarks?.antHill) {
      const d = Math.hypot(x - ANT_HILL.x, z - ANT_HILL.z) - ANT_HILL.radius
      beside = Math.max(beside, besideBand(d, rule.hillBand))
      lee = Math.max(lee, leeTail(x, z, ANT_HILL.x, ANT_HILL.z, ANT_HILL.radius, wx, wz, rule.leeReach))
    }
    if (landmarks?.agaric) {
      const { x: ax, z: az } = landmarks.agaric
      const d = Math.hypot(x - ax, z - az) - rule.stemRadius
      beside = Math.max(beside, besideBand(d, rule.stemBand))
      lee = Math.max(lee, leeTail(x, z, ax, az, rule.stemRadius, wx, wz, rule.leeReach * 1.5))
    }
    // Pebbles: beside one (a ring around the leaf), or one just upwind.
    const ring = rule.pebbleRing
    const besidePebble = Math.max(
      field('pebble', x + ring, z),
      field('pebble', x - ring, z),
      field('pebble', x, z + ring),
      field('pebble', x, z - ring)
    )
    beside = Math.max(beside, 0.7 * besidePebble)
    const upwind = Math.max(
      field('pebble', x - wx * ring, z - wz * ring),
      field('pebble', x - wx * ring * 2, z - wz * ring * 2)
    )
    lee = Math.max(lee, upwind)
    for (const branch of branches) beside = Math.max(beside, besideBand(branchDistance(x, z, branch), rule.branchBand))
    // The lee needs wind to form: half of it in a light breeze, more as it
    // blows harder.
    const windy = windInfluence * (0.5 + 0.5 * Math.min(g.wind / HABITAT_NORMAL.wind, 1.5))
    return 1 + obstacles * (beside + rule.leeWeight * windy * lee)
  }

  const tries = Math.round(rule.perTile * (1 + rule.underTreeBoost) * rule.candidates)
  for (let k = 0; k < tries; k += 1) {
    const x = x0 + random() * TILE_SIZE
    const z = z0 + random() * TILE_SIZE
    // Every candidate draws all its numbers up front, so one leaf kept or
    // dropped never shifts the rest (tiles at any detail agree).
    const turn = random()
    const keep = random()
    const size = random()
    const variant = Math.floor(random() * rule.variants)
    const own = random()
    const ownPick = random()
    const lift = random()
    const shadeJitter = random()
    const pile = random()
    const g = ground(x, z)
    if (g.slope > rule.maxSlope || g.hill > 0.35 || g.pebble > 0.5 || g.trunk < 0.01) continue
    const [wx, wz] = leafField.windAt(x, z, g.windX, g.windZ)
    const underTree = Math.exp(-g.trunk / rule.underTreeReach)
    const hollow = 1 + hollowPreference * (0.35 + 1.3 * smoothstep(-0.3, 0.6, g.concavity) - 1)
    const calm = Math.max(1 + 2 * windInfluence * (HABITAT_NORMAL.wind - g.wind), 0)
    const zoneKeep = smallKeep(x, z)
    const chance =
      (amount *
        leafField.drift(x, z) *
        hollow *
        obstacleAt(x, z, g, wx, wz) *
        calm *
        zoneKeep *
        (1 + rule.underTreeBoost * underTree)) /
      ((1 + rule.underTreeBoost) * rule.candidates * rule.average)
    if (keep >= chance) continue
    const length =
      (rule.length[0] + (rule.length[1] - rule.length[0]) * (0.5 + (size - 0.5) * scaleVariation)) * fadeScale(zoneKeep)
    // Not on mushrooms or twigs; on moss they lie on top of the cushion.
    if (!occupancy.free(x, z, length * 0.2, { throughMoss: true })) continue
    // Spacing: closer leaves are only allowed for the overlap share, and
    // sit on top of the ones beneath.
    let beneath = 0
    let crowded = false
    for (const other of placed) {
      const d = Math.hypot(other.x - x, other.z - z)
      if (d < spacing) crowded = true
      if (d < (other.length + length) * 0.3) beneath += 1
    }
    if (crowded && pile >= overlap) continue
    placed.push({ x, z, length })
    // Related colours; a quarter of leaves pick their own.
    const color = leafField.colorAt(x, z)
    if (own < rule.ownColor) {
      color.autumn = ownPick < settings.autumn / 100
      color.palette = Math.floor(((ownPick * 7.31) % 1) * (color.autumn ? LEAF_COLORS.autumn : LEAF_COLORS.green).length)
    }
    // Aligned with the wind, turned more randomly with rotation variation.
    const windYaw = Math.atan2(-wz, wx)
    result.leaves[variant].push({
      x,
      y: Math.max(g.y, occupancy.mossTop(x, z)) + 0.0005 + lift * 0.0015 + beneath * rule.pileLift,
      z,
      yaw: windYaw + (turn - 0.5) * Math.PI * 2 * rotationVariation,
      normal: tilt(look.normalAt(x, z), 1),
      scale: [length, length, length],
      // Index into LEAF_COLORS.autumn or LEAF_COLORS.green.
      autumn: color.autumn,
      palette: color.palette,
      shade: Math.min(Math.max(color.shade + (shadeJitter - 0.5) * 0.3, 0), 1),
      variant,
      // Wetter leaves look darker (decaying).
      damp: g.moisture,
    })
  }
}
