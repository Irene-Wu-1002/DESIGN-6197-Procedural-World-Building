import { createRandom, fbm3D, valueNoise3D } from './noise3d'

// Giant-tree world for the semester project: "A City Built Inside Giant Trees".
//
// Each tree is described by signed-distance primitives (negative = inside):
//   roots    tapered tubes that arch out of the trunk and dive into the ground
//   trunk    one tapered tube from below ground to the crown
//   branches tapered tubes that curve upward, each with one fork
//   canopy   noisy spheres clustered at branch tips and the crown
//   holes    round tunnels cut through the trunk, plus an optional hollow core
//
// Wood parts are joined with a smooth union so roots and branches flare into
// the trunk. Holes are subtracted afterwards (sequential CSG, as in Week 3).
// Density returned to the mesher is -distance, so positive = solid.

export const PART = {
  root: 0,
  trunk: 1,
  branch: 2,
  canopy: 3,
  hole: 4,
}

export const RESOLUTION_PRESETS = {
  low: { label: 'Low', cellSize: 1.6 },
  medium: { label: 'Medium', cellSize: 1.1 },
  high: { label: 'High', cellSize: 0.8 },
}

export const CHUNK_CELLS = 16
export const GROUND_CLIP = -3

// Hollow-core radius as a fraction of the trunk radius. The remaining wall
// must stay thicker than the deepest bark-noise dent or the trunk splits.
const CORE_FRACTION = 0.45
const BARK_STREAKS = 0.6
const BARK_LUMPS = 1.2

export function createDefaultTreeParams() {
  return {
    seed: 2026,
    treeHeight: 64,
    trunkRadius: 6,
    rootCount: 7,
    rootSpread: 1,
    branchCount: 5,
    branchAngle: 32,
    canopySize: 1,
    barkNoise: 1,
    holeCount: 3,
    holeSize: 0.6,
    hollowCore: true,
    spacing: 1,
    blend: 1,
    resolution: 'medium',
  }
}

// ---------------------------------------------------------------------------
// Blueprint: turn parameters into primitives (cheap, done once per generation)
// ---------------------------------------------------------------------------

// `tube` groups the segments of one root, branch, or the trunk. Segments in a
// tube use a hard min; separate tubes are smooth-blended (see treeDistance).
function cone(a, b, ra, rb, part, tube = 0) {
  const pad = Math.max(ra, rb)
  return {
    kind: 'cone',
    part,
    tube,
    ax: a[0], ay: a[1], az: a[2],
    bx: b[0], by: b[1], bz: b[2],
    ra, rb,
    min: [
      Math.min(a[0], b[0]) - pad,
      Math.min(a[1], b[1]) - pad,
      Math.min(a[2], b[2]) - pad,
    ],
    max: [
      Math.max(a[0], b[0]) + pad,
      Math.max(a[1], b[1]) + pad,
      Math.max(a[2], b[2]) + pad,
    ],
  }
}

function sphere(center, r, part) {
  return {
    kind: 'sphere',
    part,
    cx: center[0], cy: center[1], cz: center[2],
    r,
    min: [center[0] - r, center[1] - r, center[2] - r],
    max: [center[0] + r, center[1] + r, center[2] + r],
  }
}

function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    a * p0[2] + b * p1[2] + c * p2[2] + d * p3[2],
  ]
}

// Sample a cubic curve into tapered cone segments.
function addTube(list, controlPoints, radiusAt, part, segments, tube) {
  const [p0, p1, p2, p3] = controlPoints
  let previous = bezier(p0, p1, p2, p3, 0)
  let previousRadius = radiusAt(0)
  for (let s = 1; s <= segments; s += 1) {
    const t = s / segments
    const point = bezier(p0, p1, p2, p3, t)
    const radius = radiusAt(t)
    list.push(cone(previous, point, previousRadius, radius, part, tube))
    previous = point
    previousRadius = radius
  }
  return previous
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s]

function createTree(index, base, params, worldSeed) {
  const random = createRandom(worldSeed * 7919 + index * 104729 + 17)
  const jitter = (amount) => (random() * 2 - 1) * amount

  const H = params.treeHeight * (0.88 + random() * 0.24)
  const R = params.trunkRadius * (0.88 + random() * 0.24)
  const wood = []
  const canopy = []
  const holes = []
  let tubeId = 0 // trunk is tube 0

  // Trunk: a gently leaning, wandering column from below ground to the crown.
  const trunkTop = H * 0.82
  const leanAngle = random() * Math.PI * 2
  const lean = [Math.cos(leanAngle) * R * 0.9, 0, Math.sin(leanAngle) * R * 0.9]
  const wobblePhase = random() * Math.PI * 2
  const trunkPoints = []
  const trunkSteps = 8
  for (let s = 0; s <= trunkSteps; s += 1) {
    const t = s / trunkSteps
    const wobble = Math.sin(t * Math.PI * 1.6 + wobblePhase) * R * 0.35 * t
    trunkPoints.push({
      p: [
        base[0] + lean[0] * t * t + wobble,
        -R * 0.6 + t * (trunkTop + R * 0.6),
        base[2] + lean[2] * t * t + wobble * 0.6,
      ],
      r: R * (1.1 - 0.62 * Math.pow(t, 1.25)),
    })
  }
  for (let s = 0; s < trunkSteps; s += 1) {
    const a = trunkPoints[s]
    const b = trunkPoints[s + 1]
    wood.push(cone(a.p, b.p, a.r, b.r, PART.trunk))
  }

  const trunkAt = (y) => {
    const clamped = Math.max(trunkPoints[0].p[1], Math.min(trunkTop, y))
    for (let s = 0; s < trunkSteps; s += 1) {
      const a = trunkPoints[s]
      const b = trunkPoints[s + 1]
      if (clamped <= b.p[1]) {
        const t = (clamped - a.p[1]) / (b.p[1] - a.p[1])
        return {
          p: [a.p[0] + (b.p[0] - a.p[0]) * t, clamped, a.p[2] + (b.p[2] - a.p[2]) * t],
          r: a.r + (b.r - a.r) * t,
        }
      }
    }
    return trunkPoints[trunkSteps]
  }

  // Roots: arch outward above the ground, then dive below it.
  const rootOffset = random() * Math.PI * 2
  for (let r = 0; r < params.rootCount; r += 1) {
    const angle = rootOffset + (r / params.rootCount) * Math.PI * 2 + jitter(0.25)
    const dir = [Math.cos(angle), 0, Math.sin(angle)]
    const side = [-dir[2], 0, dir[0]]
    const spread = R * 3.1 * params.rootSpread * (0.8 + random() * 0.4)
    const curl = jitter(R * 0.9)
    const center = trunkAt(R * 1.6).p
    const archHeight = R * (0.35 + random() * 0.45)
    addTube(
      wood,
      [
        add(center, scale(dir, R * 0.3)),
        add([center[0], R * 1.0, center[2]], scale(dir, R * 1.2)),
        add(add([center[0], archHeight, center[2]], scale(dir, R + spread * 0.6)), scale(side, curl)),
        add(add([center[0], -R * 0.7, center[2]], scale(dir, R + spread)), scale(side, curl * 1.6)),
      ],
      (t) => R * (0.64 - 0.5 * Math.pow(t, 0.8)),
      PART.root,
      6,
      ++tubeId
    )
  }

  // Branches: spread around the upper trunk (golden-angle azimuths) and curl up.
  const branchTips = []
  const branchOffset = random() * Math.PI * 2
  const elevationBase = (params.branchAngle * Math.PI) / 180
  for (let b = 0; b < params.branchCount; b += 1) {
    const heightFraction = 0.56 + (0.26 * (b + 0.5)) / params.branchCount + jitter(0.03)
    const start = trunkAt(H * heightFraction)
    const azimuth = branchOffset + b * 2.39996 + jitter(0.3)
    const elevation = elevationBase + jitter(0.14)
    const dir = [
      Math.cos(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      Math.sin(azimuth) * Math.cos(elevation),
    ]
    const length = H * 0.36 * (1 - 0.35 * ((heightFraction - 0.56) / 0.26)) * (0.85 + random() * 0.3)
    const startRadius = start.r * 0.58
    const endRadius = R * 0.14
    const radiusAt = (t) => startRadius + (endRadius - startRadius) * Math.pow(t, 0.7)
    const controls = [
      start.p,
      add(start.p, scale(dir, length * 0.35)),
      add(add(start.p, scale(dir, length * 0.7)), [0, length * 0.1, 0]),
      add(add(start.p, scale(dir, length)), [0, length * 0.28, 0]),
    ]
    branchTips.push(addTube(wood, controls, radiusAt, PART.branch, 5, ++tubeId))

    // One fork leaves the branch just past its middle.
    const forkStart = bezier(...controls, 0.55)
    const forkAzimuth = azimuth + (random() < 0.5 ? -1 : 1) * (0.5 + random() * 0.3)
    const forkElevation = elevation + 0.3
    const forkDir = [
      Math.cos(forkAzimuth) * Math.cos(forkElevation),
      Math.sin(forkElevation),
      Math.sin(forkAzimuth) * Math.cos(forkElevation),
    ]
    const forkLength = length * 0.48
    const forkRadius = radiusAt(0.55) * 0.62
    branchTips.push(
      addTube(
        wood,
        [
          forkStart,
          add(forkStart, scale(forkDir, forkLength * 0.4)),
          add(forkStart, scale(forkDir, forkLength * 0.75)),
          add(add(forkStart, scale(forkDir, forkLength)), [0, forkLength * 0.2, 0]),
        ],
        (t) => forkRadius + (R * 0.1 - forkRadius) * t,
        PART.branch,
        3,
        ++tubeId
      )
    )
  }

  // Canopy: clustered foliage blobs at every tip and around the crown.
  const leaf = R * params.canopySize
  branchTips.forEach((tip) => {
    canopy.push(sphere(add(tip, [0, leaf * 0.4, 0]), leaf * (1 + random() * 0.35), PART.canopy))
    for (let c = 0; c < 2; c += 1) {
      const offset = [jitter(leaf * 1.1), jitter(leaf * 0.4), jitter(leaf * 1.1)]
      canopy.push(sphere(add(tip, offset), leaf * (0.7 + random() * 0.3), PART.canopy))
    }
  })
  const crown = trunkPoints[trunkSteps].p
  canopy.push(sphere(add(crown, [0, leaf * 0.8, 0]), leaf * 1.5, PART.canopy))
  for (let c = 0; c < 4; c += 1) {
    const angle = (c / 4) * Math.PI * 2 + random()
    canopy.push(
      sphere(
        add(crown, [Math.cos(angle) * leaf * 1.3, jitter(leaf * 0.4), Math.sin(angle) * leaf * 1.3]),
        leaf * (1 + random() * 0.3),
        PART.canopy
      )
    )
  }

  // Holes: round portals through the trunk, from the root gate upward.
  const holeBottom = R * 1.5
  const holeTop = H * 0.62
  let highestHole = holeBottom
  const holeAzimuth = random() * Math.PI * 2
  for (let h = 0; h < params.holeCount; h += 1) {
    const y = holeBottom + ((holeTop - holeBottom) * (h + 0.5)) / params.holeCount + jitter(R * 0.25)
    const center = trunkAt(y)
    // Golden-angle steps keep neighbouring portals on different sides, so
    // the trunk wall between them is never cut all the way around.
    const azimuth = holeAzimuth + h * 2.39996 + jitter(0.2)
    const dir = [Math.cos(azimuth), jitter(0.12), Math.sin(azimuth)]
    const reach = (center.r + R) * 1.2
    // Crowded portals shrink instead of overlapping in height; two portals at
    // the same height on different sides would cut the trunk in two.
    const spacing = (holeTop - holeBottom) / params.holeCount
    const radius = Math.min(center.r * params.holeSize * (0.9 + random() * 0.2), spacing * 0.42)
    holes.push(cone(add(center.p, scale(dir, -reach)), add(center.p, scale(dir, reach)), radius, radius, PART.hole))
    highestHole = Math.max(highestHole, y + radius)
  }

  // Hollow core: an inner shaft so the portals open into a habitable interior.
  if (params.hollowCore && params.holeCount > 0) {
    const coreBottom = R * 1.2
    const coreTop = highestHole + R * 0.4
    const steps = 4
    for (let s = 0; s < steps; s += 1) {
      const a = trunkAt(coreBottom + ((coreTop - coreBottom) * s) / steps)
      const b = trunkAt(coreBottom + ((coreTop - coreBottom) * (s + 1)) / steps)
      holes.push(cone(a.p, b.p, a.r * CORE_FRACTION, b.r * CORE_FRACTION, PART.hole))
    }
  }

  const all = [...wood, ...canopy, ...holes]
  const noiseMargin = R * 1.2
  const bounds = {
    min: [0, 1, 2].map((axis) => Math.min(...all.map((p) => p.min[axis])) - noiseMargin),
    max: [0, 1, 2].map((axis) => Math.max(...all.map((p) => p.max[axis])) + noiseMargin),
  }
  bounds.min[1] = Math.max(bounds.min[1], GROUND_CLIP - 2)

  return {
    index,
    seed: worldSeed * 31 + index * 977,
    height: H,
    radius: R,
    base,
    wood,
    canopy,
    holes,
    bounds,
  }
}

export function createWorldBlueprint(params) {
  const random = createRandom(params.seed * 2654435761)
  const ringRadius = params.treeHeight * 0.62 * params.spacing
  const trees = []
  const treeCount = 3
  const startAngle = random() * Math.PI * 2

  for (let t = 0; t < treeCount; t += 1) {
    const angle = startAngle + (t / treeCount) * Math.PI * 2 + (random() * 2 - 1) * 0.25
    const distance = ringRadius * (0.85 + random() * 0.3)
    trees.push(
      createTree(t, [Math.cos(angle) * distance, 0, Math.sin(angle) * distance], params, params.seed)
    )
  }

  return { trees, params }
}

// ---------------------------------------------------------------------------
// Density: evaluated millions of times, so it avoids allocation.
// ---------------------------------------------------------------------------

function coneDistance(p, x, y, z) {
  const bax = p.bx - p.ax
  const bay = p.by - p.ay
  const baz = p.bz - p.az
  const pax = x - p.ax
  const pay = y - p.ay
  const paz = z - p.az
  const lengthSq = bax * bax + bay * bay + baz * baz
  let t = (pax * bax + pay * bay + paz * baz) / lengthSq
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const dx = pax - bax * t
  const dy = pay - bay * t
  const dz = paz - baz * t
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (p.ra + (p.rb - p.ra) * t)
}

// Foliage pads are spheres squashed vertically (approximate ellipsoid SDF),
// which reads as layered canopy instead of one round ball.
const PAD_SQUASH = 1.7

function primitiveDistance(p, x, y, z) {
  if (p.kind === 'sphere') {
    const dx = x - p.cx
    const dy = (y - p.cy) * PAD_SQUASH
    const dz = z - p.cz
    return (Math.sqrt(dx * dx + dy * dy + dz * dz) - p.r) / PAD_SQUASH
  }
  return coneDistance(p, x, y, z)
}

// Polynomial smooth minimum: joins shapes with a fillet of size k.
function smoothMin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

function smoothMax(a, b, k) {
  return -smoothMin(-a, -b, k)
}

function overlaps(p, min, max) {
  return (
    p.min[0] <= max[0] && p.max[0] >= min[0] &&
    p.min[1] <= max[1] && p.max[1] >= min[1] &&
    p.min[2] <= max[2] && p.max[2] >= min[2]
  )
}

const CANOPY_BLEND = 0.5
const CANOPY_NOISE = 0.45

// How far a primitive can reach beyond its own bounds once smooth blending
// and noise are applied. Chunks must gather every primitive within this
// reach, or neighbouring chunks disagree and seams appear.
function influenceMargins(tree, params) {
  const R = tree.radius
  const bark = 0.14 * params.barkNoise * (BARK_STREAKS + BARK_LUMPS)
  const wood = R * (0.5 * params.blend + bark + 0.3)
  const canopy = R * (CANOPY_BLEND + CANOPY_NOISE + 0.2) * PAD_SQUASH
  return { wood, canopy }
}

function expand(min, max, margin) {
  return [
    [min[0] - margin, min[1] - margin, min[2] - margin],
    [max[0] + margin, max[1] + margin, max[2] + margin],
  ]
}

/**
 * Collect the primitives that can affect a region. Chunks that receive no
 * wood or canopy primitives are empty air and are skipped before sampling.
 */
export function gatherRegion(world, min, max) {
  const region = { trees: [] }
  world.trees.forEach((tree) => {
    const margins = influenceMargins(tree, world.params)
    const [woodLo, woodHi] = expand(min, max, margins.wood)
    const [canopyLo, canopyHi] = expand(min, max, margins.canopy)
    const wood = tree.wood.filter((p) => overlaps(p, woodLo, woodHi))
    const canopy = tree.canopy.filter((p) => overlaps(p, canopyLo, canopyHi))
    if (wood.length === 0 && canopy.length === 0) return
    region.trees.push({
      tree,
      wood,
      canopy,
      holes: tree.holes.filter((p) => overlaps(p, woodLo, woodHi)),
    })
  })
  return region
}

// Scratch output for classification (avoids per-vertex allocation).
const detail = { part: PART.trunk, holeWall: false, distance: 0 }

function treeDistance(entry, params, x, y, z, wantDetail) {
  const { tree } = entry
  const R = tree.radius
  const woodBlend = R * 0.5 * params.blend
  const barkAmplitude = R * 0.14 * params.barkNoise
  const canopyAmplitude = R * CANOPY_NOISE

  // Hard min inside each tube (its segments are contiguous in the list), then
  // smooth union between tubes so roots and branches flare into the trunk.
  let wood = Infinity
  let tubeDistance = Infinity
  let currentTube = -1
  let nearestPart = PART.trunk
  let nearestRaw = Infinity
  for (let i = 0; i < entry.wood.length; i += 1) {
    const p = entry.wood[i]
    if (p.tube !== currentTube) {
      if (tubeDistance !== Infinity) {
        wood = wood === Infinity ? tubeDistance : smoothMin(wood, tubeDistance, woodBlend)
      }
      tubeDistance = Infinity
      currentTube = p.tube
    }
    const d = primitiveDistance(p, x, y, z)
    if (d < tubeDistance) tubeDistance = d
    if (wantDetail && d < nearestRaw) {
      nearestRaw = d
      nearestPart = p.part
    }
  }
  if (tubeDistance !== Infinity) {
    wood = wood === Infinity ? tubeDistance : smoothMin(wood, tubeDistance, woodBlend)
  }

  // Bark: vertical ridges plus broad lumps, only near the surface. Noise is
  // remapped to 0..1 so bark only grows outward and never thins the wall
  // left between the portals and the hollow core.
  if (barkAmplitude > 0 && Math.abs(wood) < barkAmplitude * 2 + R * 0.4) {
    const s = tree.seed
    const streaks = valueNoise3D(x * 0.45, y * 0.05, z * 0.45, s) * 0.5 + 0.5
    const lumps = fbm3D(x * 0.07, y * 0.07, z * 0.07, s + 55, 2) * 0.5 + 0.5
    wood -= (streaks * BARK_STREAKS + lumps * BARK_LUMPS) * barkAmplitude
  }

  let canopy = Infinity
  for (let i = 0; i < entry.canopy.length; i += 1) {
    const d = primitiveDistance(entry.canopy[i], x, y, z)
    canopy = canopy === Infinity ? d : smoothMin(canopy, d, R * CANOPY_BLEND)
  }
  if (canopy !== Infinity && Math.abs(canopy) < canopyAmplitude * 2) {
    canopy += fbm3D(x * 0.11, y * 0.11, z * 0.11, tree.seed + 91, 3) * canopyAmplitude
  }

  let distance = Math.min(wood, canopy)

  let hole = Infinity
  for (let i = 0; i < entry.holes.length; i += 1) {
    hole = Math.min(hole, coneDistance(entry.holes[i], x, y, z))
  }
  if (hole !== Infinity) distance = smoothMax(distance, -hole, R * 0.25)

  if (wantDetail) {
    detail.part = canopy < wood ? PART.canopy : nearestPart
    // Surface points on a carved wall sit almost exactly on the hole boundary.
    detail.holeWall = hole !== Infinity && hole < R * 0.1
    detail.distance = distance
  }
  return distance
}

/** Density at a point: positive inside the trees, negative in the air. */
export function sampleRegionDensity(region, params, x, y, z) {
  let distance = Infinity
  for (let t = 0; t < region.trees.length; t += 1) {
    const d = treeDistance(region.trees[t], params, x, y, z, false)
    if (d < distance) distance = d
  }
  // Stop just below the ground plane so buried roots are not meshed.
  distance = Math.max(distance, GROUND_CLIP - y)
  return -distance
}

/** Which layer a surface point belongs to, for vertex colouring. */
export function classifyRegionPoint(region, params, x, y, z) {
  let best = Infinity
  let result = { part: PART.trunk, holeWall: false, tree: null }
  for (let t = 0; t < region.trees.length; t += 1) {
    const entry = region.trees[t]
    const d = treeDistance(entry, params, x, y, z, true)
    if (d < best) {
      best = d
      result = { part: detail.part, holeWall: detail.holeWall, tree: entry.tree }
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

// Vertex colours are read as linear by three.js, so convert from sRGB hex.
const toLinear = (channel) => Math.pow(channel / 255, 2.2)
const hex = (value) => [
  toLinear((value >> 16) & 255),
  toLinear((value >> 8) & 255),
  toLinear(value & 255),
]

const NATURAL = {
  root: hex(0x3a2a1f),
  trunk: hex(0x6b4a33),
  branch: hex(0x7a6a4c),
  moss: hex(0x56743a),
  leafShade: hex(0x24481f),
  leafSun: hex(0x86b04a),
  heartwood: hex(0xd0925a),
}

export const LAYER_COLORS = {
  [PART.root]: { label: 'Roots — underground city', color: '#5b7cfa' },
  [PART.trunk]: { label: 'Trunk — industrial district', color: '#f08a3c' },
  [PART.branch]: { label: 'Branches — villages', color: '#f2c84b' },
  [PART.canopy]: { label: 'Canopy — climate zone', color: '#58c46b' },
  [PART.hole]: { label: 'Hole walls — open interiors', color: '#e2476b' },
}
const LAYER_RGB = Object.fromEntries(
  Object.entries(LAYER_COLORS).map(([part, { color }]) => [
    part,
    hex(parseInt(color.slice(1), 16)),
  ])
)

const mix = (a, b, t, out) => {
  out[0] = a[0] + (b[0] - a[0]) * t
  out[1] = a[1] + (b[1] - a[1]) * t
  out[2] = a[2] + (b[2] - a[2]) * t
  return out
}
const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Vertex colours for a chunk mesh. Returns two colour sets: a natural look
 * (bark darkens toward the damp roots, moss on upward faces, warm heartwood
 * inside the holes) and a diagnostic view that colours each urban layer.
 */
export function colorChunkVertices(region, params, positions, normals) {
  const count = positions.length / 3
  const natural = new Float32Array(positions.length)
  const layers = new Float32Array(positions.length)
  const color = [0, 0, 0]
  const scratch = [0, 0, 0]

  for (let v = 0; v < count; v += 1) {
    const x = positions[v * 3]
    const y = positions[v * 3 + 1]
    const z = positions[v * 3 + 2]
    const ny = normals[v * 3 + 1]
    const info = classifyRegionPoint(region, params, x, y, z)
    const tree = info.tree
    const H = tree ? tree.height : params.treeHeight
    const heightFraction = y / H
    const grain = valueNoise3D(x * 0.5, y * 0.07, z * 0.5, 7)

    if (info.holeWall && info.part !== PART.canopy) {
      mix(NATURAL.heartwood, NATURAL.trunk, 0.15 + 0.15 * grain, color)
    } else if (info.part === PART.canopy) {
      const light = smoothstep(0.55, 1.05, heightFraction) * 0.6 + Math.max(ny, 0) * 0.35
      const variation = valueNoise3D(x * 0.2, y * 0.2, z * 0.2, 13) * 0.2
      mix(NATURAL.leafShade, NATURAL.leafSun, Math.max(0, Math.min(1, light + variation)), color)
    } else {
      mix(NATURAL.root, NATURAL.trunk, smoothstep(0.02, 0.14, heightFraction), color)
      mix(color, NATURAL.branch, smoothstep(0.5, 0.72, heightFraction), scratch)
      color[0] = scratch[0]
      color[1] = scratch[1]
      color[2] = scratch[2]
      const shade = 0.82 + 0.18 * grain
      color[0] *= shade
      color[1] *= shade
      color[2] *= shade
      const mossNoise = valueNoise3D(x * 0.15, y * 0.15, z * 0.15, 29) * 0.5 + 0.5
      const moss = smoothstep(0.3, 0.85, ny) * mossNoise
      mix(color, NATURAL.moss, moss, scratch)
      color[0] = scratch[0]
      color[1] = scratch[1]
      color[2] = scratch[2]
    }

    natural[v * 3] = color[0]
    natural[v * 3 + 1] = color[1]
    natural[v * 3 + 2] = color[2]

    const layer = LAYER_RGB[info.holeWall && info.part !== PART.canopy ? PART.hole : info.part]
    layers[v * 3] = layer[0]
    layers[v * 3 + 1] = layer[1]
    layers[v * 3 + 2] = layer[2]
  }

  return { natural, layers }
}

// ---------------------------------------------------------------------------
// Chunk planning
// ---------------------------------------------------------------------------

/**
 * List the chunks that intersect any tree's bounds, bottom to top so the
 * world appears to grow from the roots. Chunks with no nearby primitives are
 * counted as culled and never sampled.
 */
export function planChunks(world, cellSize) {
  const size = CHUNK_CELLS * cellSize
  const keys = new Map()

  world.trees.forEach((tree) => {
    const { min, max } = tree.bounds
    for (let cz = Math.floor(min[2] / size); cz <= Math.floor(max[2] / size); cz += 1) {
      for (let cy = Math.floor(min[1] / size); cy <= Math.floor(max[1] / size); cy += 1) {
        for (let cx = Math.floor(min[0] / size); cx <= Math.floor(max[0] / size); cx += 1) {
          const key = `${cx},${cy},${cz}`
          if (!keys.has(key)) keys.set(key, { key, cx, cy, cz })
        }
      }
    }
  })

  const chunks = []
  let culled = 0
  keys.forEach((chunk) => {
    const origin = [chunk.cx * size, chunk.cy * size, chunk.cz * size]
    const min = [origin[0] - cellSize, origin[1] - cellSize, origin[2] - cellSize]
    const max = [origin[0] + size + cellSize, origin[1] + size + cellSize, origin[2] + size + cellSize]
    if (max[1] < GROUND_CLIP) {
      culled += 1
      return
    }
    const region = gatherRegion(world, min, max)
    if (region.trees.length === 0) {
      culled += 1
      return
    }
    chunks.push({ ...chunk, origin, min, max, region })
  })

  chunks.sort((a, b) => a.cy - b.cy || a.cx - b.cx || a.cz - b.cz)
  return { chunks, culled, candidates: keys.size, chunkWorldSize: size }
}
