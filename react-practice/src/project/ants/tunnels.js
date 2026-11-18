import { hash } from '../terrain/hash'

/**
 * The colony's tunnels: what lies under the ant hills (terrain/antHills.js).
 *
 *   chamber   a flattened hall a few centimetres under each nest's mound
 *   shaft     from each entrance on the surface down into its nest's chamber
 *   gallery   long tunnels joining the chambers of different nests: every
 *             nest is reachable (a spanning tree by distance) plus one
 *             extra gallery so there is a loop; they dip and wander a
 *             little, stay a few centimetres under the ground, and keep
 *             away from trunks
 *
 * Together they make a graph: nodes are entrances and chambers, edges are
 * centrelines sampled every couple of millimetres, which the ant walks
 * along underground (viewpoints/movement/burrow.js) and the renderer turns
 * into tubes (tunnelRenderer.js). Each node also knows how far it is (along
 * the tunnels) from the nearest entrance, which is how much daylight
 * reaches it.
 *
 * Decided by the seed, the nests, and the ground alone, like the rest of
 * the world. Plain data only, no Three.js.
 */

// Centreline sample spacing (m).
const SAMPLE = 0.002
// Tube radius (m): an ant's eye is 4 mm up, so it just fits.
export const TUNNEL_RADIUS = { gallery: 0.005, shaft: 0.0045 }
// Chambers: depth under the mound's base (m), horizontal and vertical
// half-size (m), for the main hill and the satellites, and how far the
// tunnels' floors sit above the chamber's (m). A chamber is a
// superellipsoid (CHAMBER_POWER): a flat floor and steep walls, so tunnels
// open into its walls cleanly.
const CHAMBER = { depth: { main: 0.03, satellite: 0.022 }, rx: { main: 0.017, satellite: 0.012 }, ry: 0.009, step: 0.001 }
export const CHAMBER_POWER = 4
// Shafts: how far they drop straight down before leaning toward the
// chamber, how far the crater's shaft swings out, and how far out from
// the chamber's wall it levels off to come in (m).
const SHAFT = { drop: 0.008, swing: 0.012, top: 0.002, door: 0.005 }
// Galleries: least depth under the ground (m), extra dip mid-way, sideways
// wander (share of the length), tries at avoiding trunks, and the trunk
// clearance that is good enough (m).
const GALLERY = { minDepth: 0.025, dip: [0.006, 0.02], wander: [0.06, 0.14], tries: 6, trunkGap: 0.06, smooth: 6 }
const SALT = 6101

const catmullRom = (p0, p1, p2, p3, t) => {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

/** Resample a dense polyline ([x, y, z, ...]) every SAMPLE metres. */
function resample(dense) {
  const count = dense.length / 3
  const out = [dense[0], dense[1], dense[2]]
  let carried = 0
  for (let i = 1; i < count; i += 1) {
    const ax = dense[i * 3 - 3]
    const ay = dense[i * 3 - 2]
    const az = dense[i * 3 - 1]
    const bx = dense[i * 3]
    const by = dense[i * 3 + 1]
    const bz = dense[i * 3 + 2]
    const span = Math.hypot(bx - ax, by - ay, bz - az)
    let at = SAMPLE - carried
    while (at <= span) {
      const t = at / span
      out.push(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t)
      at += SAMPLE
    }
    carried = span - (at - SAMPLE)
  }
  // Always end exactly on the last point.
  const last = dense.length - 3
  const tail = out.length - 3
  if (Math.hypot(out[tail] - dense[last], out[tail + 1] - dense[last + 1], out[tail + 2] - dense[last + 2]) > SAMPLE * 0.3) {
    out.push(dense[last], dense[last + 1], dense[last + 2])
  } else {
    out[tail] = dense[last]
    out[tail + 1] = dense[last + 1]
    out[tail + 2] = dense[last + 2]
  }
  return out
}

/** A Catmull-Rom curve through control points [[x, y, z], ...], resampled. */
function spline(control) {
  const pts = [control[0], ...control, control[control.length - 1]]
  const dense = []
  for (let i = 1; i < pts.length - 2; i += 1) {
    for (let k = 0; k < 24; k += 1) {
      const t = k / 24
      for (let c = 0; c < 3; c += 1) dense.push(catmullRom(pts[i - 1][c], pts[i][c], pts[i + 1][c], pts[i + 2][c], t))
    }
  }
  dense.push(...control[control.length - 1])
  return resample(dense)
}

function makeEdge(id, kind, a, b, points) {
  const count = points.length / 3
  const lengths = new Float32Array(count)
  for (let i = 1; i < count; i += 1) {
    lengths[i] =
      lengths[i - 1] +
      Math.hypot(points[i * 3] - points[i * 3 - 3], points[i * 3 + 1] - points[i * 3 - 2], points[i * 3 + 2] - points[i * 3 - 1])
  }
  return {
    id,
    kind,
    a,
    b,
    points: Float32Array.from(points),
    lengths,
    count,
    length: lengths[count - 1],
    radius: TUNNEL_RADIUS[kind],
  }
}

/**
 * Point and unit tangent (toward b) at arc length s along an edge:
 * out = { x, y, z, tx, ty, tz }.
 */
export function pointOnEdge(edge, s, out) {
  const { lengths, points, count } = edge
  let lo = 0
  let hi = count - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (lengths[mid] < s) lo = mid
    else hi = mid
  }
  const span = lengths[hi] - lengths[lo] || 1
  const t = Math.min(Math.max((s - lengths[lo]) / span, 0), 1)
  const ax = points[lo * 3]
  const ay = points[lo * 3 + 1]
  const az = points[lo * 3 + 2]
  const bx = points[hi * 3]
  const by = points[hi * 3 + 1]
  const bz = points[hi * 3 + 2]
  out.x = ax + (bx - ax) * t
  out.y = ay + (by - ay) * t
  out.z = az + (bz - az) * t
  // A smoother tangent: across a few samples either side.
  const ta = Math.max(lo - 2, 0)
  const tb = Math.min(hi + 2, count - 1)
  const dx = points[tb * 3] - points[ta * 3]
  const dy = points[tb * 3 + 1] - points[ta * 3 + 1]
  const dz = points[tb * 3 + 2] - points[ta * 3 + 2]
  const length = Math.hypot(dx, dy, dz) || 1
  out.tx = dx / length
  out.ty = dy / length
  out.tz = dz / length
  return out
}

/**
 * hills: the nests (terrain/antHills.js); entrances: antHillEntrances
 * (each with its hill); sampler: the ground; trunks: the trunk field (or
 * null); seed. Returns { nodes, edges, hills, entranceNode(index),
 * pointAt(edge, s, out), daylight(edge, s) } or null without hills.
 */
export function createTunnelNetwork({ hills, entrances, sampler, trunks, seed }) {
  if (!hills?.length || !sampler) return null
  const ground = (x, z) => sampler.height(x, z)
  const nodes = []
  const edges = []
  const addNode = (node) => {
    node.id = nodes.length
    node.edges = []
    nodes.push(node)
    return node
  }
  const addEdge = (kind, a, b, points) => {
    const edge = makeEdge(edges.length, kind, a.id, b.id, points)
    edges.push(edge)
    a.edges.push(edge.id)
    b.edges.push(edge.id)
    return edge
  }

  // Chambers, under each mound's base (the ground just beyond the mound).
  const chambers = hills.map((hill) => {
    let base = 0
    for (let k = 0; k < 8; k += 1) {
      const angle = (k / 8) * Math.PI * 2
      base += ground(hill.x + Math.cos(angle) * hill.radius * 1.4, hill.z + Math.sin(angle) * hill.radius * 1.4)
    }
    base /= 8
    const kind = hill.main ? 'main' : 'satellite'
    const y = base - CHAMBER.depth[kind]
    const rx = CHAMBER.rx[kind]
    return addNode({
      kind: 'chamber',
      hill: hill.index,
      x: hill.x,
      y,
      z: hill.z,
      rx,
      ry: CHAMBER.ry,
      // The hall's centre: its floor a step below the tunnels' floors.
      cy: y - TUNNEL_RADIUS.gallery - CHAMBER.step + CHAMBER.ry,
    })
  })

  // Shafts: from each entrance down into its own chamber.
  const entranceNodes = entrances.map((entrance, index) => {
    const chamber = chambers[entrance.hill ?? 0]
    const top = [entrance.x, ground(entrance.x, entrance.z) - SHAFT.top, entrance.z]
    const node = addNode({ kind: 'entrance', hill: entrance.hill ?? 0, entrance: index, x: top[0], y: top[1], z: top[2] })
    let dx = entrance.x - chamber.x
    let dz = entrance.z - chamber.z
    let flat = Math.hypot(dx, dz)
    const swingAngle = hash(seed, 300 + index, SALT) * Math.PI * 2
    if (flat < 1e-4) {
      // The crater's shaft: straight down, then out and back in.
      dx = Math.cos(swingAngle)
      dz = Math.sin(swingAngle)
    } else {
      dx /= flat
      dz /= flat
    }
    flat = Math.max(flat, chamber.rx + SHAFT.swing)
    // Down and toward the chamber, then in level through its wall.
    const out = Math.max((chamber.rx + flat) * 0.5, chamber.rx + SHAFT.swing)
    const door = chamber.rx + SHAFT.door
    const midY = (top[1] - SHAFT.drop + chamber.y) / 2
    const lean = (hash(seed, 320 + index, SALT) - 0.5) * 0.006
    const control = [
      top,
      [top[0], top[1] - SHAFT.drop, top[2]],
      [chamber.x + dx * out - dz * lean, midY, chamber.z + dz * out + dx * lean],
      [chamber.x + dx * door, chamber.y, chamber.z + dz * door],
      [chamber.x + dx * chamber.rx * 0.5, chamber.y, chamber.z + dz * chamber.rx * 0.5],
      [chamber.x, chamber.y, chamber.z],
    ]
    addEdge('shaft', node, chamber, spline(control))
    return node
  })

  // Galleries: a spanning tree between the nests (nearest first), plus the
  // shortest pair left over.
  const pairs = []
  for (let i = 0; i < chambers.length; i += 1) {
    for (let j = i + 1; j < chambers.length; j += 1) {
      pairs.push({ i, j, d: Math.hypot(chambers[i].x - chambers[j].x, chambers[i].z - chambers[j].z) })
    }
  }
  pairs.sort((p, q) => p.d - q.d)
  const group = chambers.map((_, i) => i)
  const find = (i) => (group[i] === i ? i : (group[i] = find(group[i])))
  const links = []
  const spare = []
  for (const pair of pairs) {
    const gi = find(pair.i)
    const gj = find(pair.j)
    if (gi !== gj) {
      group[gi] = gj
      links.push(pair)
    } else spare.push(pair)
  }
  if (spare.length) links.push(spare[0])

  links.forEach((pair, linkIndex) => {
    const a = chambers[pair.i]
    const b = chambers[pair.j]
    let best = null
    for (let attempt = 0; attempt < GALLERY.tries; attempt += 1) {
      const points = galleryPath(a, b, ground, (n) => hash(seed, linkIndex * 50 + attempt * 7 + n, SALT))
      let clearance = Infinity
      if (trunks) {
        for (let i = 0; i < points.length; i += 3 * 8) clearance = Math.min(clearance, trunks.distance(points[i], points[i + 2], 1))
      }
      if (!best || clearance > best.clearance) best = { points, clearance }
      if (clearance > GALLERY.trunkGap) break
    }
    addEdge('gallery', a, b, best.points)
  })

  // How far each node is from daylight (along the tunnels).
  for (const node of nodes) node.daylight = node.kind === 'entrance' ? 0 : Infinity
  const open = [...entranceNodes]
  while (open.length) {
    open.sort((p, q) => p.daylight - q.daylight)
    const node = open.shift()
    for (const id of node.edges) {
      const edge = edges[id]
      const other = nodes[edge.a === node.id ? edge.b : edge.a]
      const d = node.daylight + edge.length
      if (d < other.daylight) {
        other.daylight = d
        if (!open.includes(other)) open.push(other)
      }
    }
  }

  return {
    nodes,
    edges,
    hills,
    chambers,
    /** The node for entrance `index` (antHillEntrances order). */
    entranceNode(index) {
      return entranceNodes[index] ?? null
    },
    pointAt: pointOnEdge,
    /** Distance (m, along the tunnels) from (edge, s) to the nearest entrance. */
    daylight(edge, s) {
      return Math.min(nodes[edge.a].daylight + s, nodes[edge.b].daylight + edge.length - s)
    },
  }
}

/** A gallery's centreline from chamber a to chamber b ([x, y, z, ...]). */
function galleryPath(a, b, ground, h) {
  const length = Math.hypot(b.x - a.x, b.z - a.z)
  const steps = Math.max(Math.ceil(length / SAMPLE), 4)
  const ux = (b.x - a.x) / length
  const uz = (b.z - a.z) / length
  const lerp = ([lo, hi], t) => lo + (hi - lo) * t
  const amplitude = [lerp(GALLERY.wander, h(1)) * length, 0.15 * lerp(GALLERY.wander, h(2)) * length]
  const frequency = [0.5 + Math.floor(h(3) * 2) * 0.5, 2 + Math.floor(h(4) * 3)]
  const phase = [h(5) * Math.PI * 2, h(6) * Math.PI * 2]
  const dip = lerp(GALLERY.dip, h(7))
  const xs = []
  const ys = []
  const zs = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const ends = Math.sin(Math.PI * t)
    const offset =
      ends *
      (amplitude[0] * Math.sin(Math.PI * 2 * frequency[0] * t + phase[0]) +
        amplitude[1] * Math.sin(Math.PI * 2 * frequency[1] * t + phase[1]))
    const x = a.x + ux * length * t - uz * offset
    const z = a.z + uz * length * t + ux * offset
    const level = t * t * (3 - 2 * t)
    const y = Math.min(a.y + (b.y - a.y) * level - ends * dip, ground(x, z) - GALLERY.minDepth)
    xs.push(x)
    ys.push(y)
    zs.push(z)
  }
  // Smooth out kinks where the ground above pushed the tunnel down.
  const smooth = ys.map((_, i) => {
    let sum = 0
    let n = 0
    for (let k = -GALLERY.smooth; k <= GALLERY.smooth; k += 1) {
      const j = Math.min(Math.max(i + k, 0), ys.length - 1)
      sum += ys[j]
      n += 1
    }
    return sum / n
  })
  smooth[0] = a.y
  smooth[smooth.length - 1] = b.y
  const dense = []
  for (let i = 0; i < xs.length; i += 1) dense.push(xs[i], Math.min(smooth[i], ys[i] + 0.004), zs[i])
  return resample(dense)
}
