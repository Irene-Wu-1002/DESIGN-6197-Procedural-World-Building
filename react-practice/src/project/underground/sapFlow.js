import { DEAD, ParticlePool } from '../../utils/particles'
import { createRandom } from '../../utils/distributions'
import { createGlowPoints } from './glowPoints'

/**
 * Sap: the water a tree draws, rising through it to the leaves, as
 * particles that follow paths through the tree.
 *
 *   route    from the root zone (where the water particles gather, in
 *            X-ray and the cross-section; the foot of the trunk in the
 *            normal view) up the trunk to the crown's base, then along
 *            the branches to a twig tip (cover/crowns.js pathsOf): only
 *            to tips that have grown, so a young crown's sap stops short
 *   rate     births per tree follow its water supply and its demand
 *            (underground/treeWater.js): a thirsty, well-watered tree
 *            pulls the most
 *   look     water-cyan in the roots, turning leaf-green toward the
 *            twigs, fading out into the leaves; drawn over the wood (no
 *            depth test), since sap runs inside it
 *
 * Each particle remembers its route and how far along it is; position is
 * found by walking the route's cumulative lengths (cursor kept per
 * particle, so it's a step or two per frame). Up the trunk each runs a
 * little off the axis (TRUNK_SPREAD of the radius), coming together at
 * the crown, so the trunk carries a band of sap, not a single file.
 *
 * Units are metres and seconds.
 */

const CAPACITY = 5000
// Trees within this (m) of you carry sap.
const VIEW = 10
// Births per second per tree at full supply and demand 1.
const RATE = 45
const SPEED = [0.8, 1.4]
// Where sap starts in the root zone: spread (share of Root reach) and
// depth (share of Root depth, as the water particles' sinks).
const ROOT_SPREAD = 0.35
const ROOT_DEPTH = [0.2, 0.5]
const SIZE = 0.04
// Colour along the route: [share, r, g, b] (linear).
const COLOURS = [
  [0, 0.35, 0.75, 0.95],
  [0.45, 0.25, 0.8, 0.7],
  [1, 0.5, 0.9, 0.18],
]
const FADE_IN = 0.04
const TRUNK_SPREAD = 0.7
const FADE_OUT = 0.12

const smoothstep = (edge0, edge1, value) => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}
const keyOf = (trunk) => `${trunk.x.toFixed(4)},${trunk.z.toFixed(4)}`

/** A route from points (Float32Array x, y, z): with cumulative lengths. */
function routeOf(points, order) {
  const count = points.length / 3
  const lengths = new Float32Array(count)
  for (let k = 1; k < count; k += 1) {
    const a = (k - 1) * 3
    const b = k * 3
    lengths[k] = lengths[k - 1] + Math.hypot(points[b] - points[a], points[b + 1] - points[a + 1], points[b + 2] - points[a + 2])
  }
  return { points, lengths, order }
}

export function createSapFlow(scene) {
  const pool = new ParticlePool(CAPACITY)
  const random = createRandom(11)
  const points = createGlowPoints(pool, { depthTest: false })
  points.object.renderOrder = 20
  points.object.visible = false
  scene.add(points.object)

  // Per particle: its route, where it starts (in pool.velocity), how far
  // it has gone (pool.timer), its speed (pool.life) and its cursor.
  const routes = new Array(CAPACITY).fill(null)
  const cursor = new Uint16Array(CAPACITY)
  const total = new Float32Array(CAPACITY)
  // Per tree: { base y, ground y, trunkOnly, crown routes, owed births }.
  const trees = new Map()
  let builtVersion = null

  const treeOf = (trunk, crowns, groundY) => {
    const key = keyOf(trunk)
    let tree = trees.get(key)
    if (tree) return tree
    const frame = crowns.pathsOf(trunk)
    if (!frame) return null
    const foot = [trunk.x, groundY, trunk.z]
    tree = {
      trunk,
      groundY,
      trunkOnly: routeOf(Float32Array.from([...foot, frame.base.x, frame.base.y, frame.base.z]), 0),
      crown: frame.paths.map(({ points: path, order }) => routeOf(Float32Array.from([...foot, ...path]), order)),
      owed: 0,
    }
    trees.set(key, tree)
    return tree
  }

  const spawn = (tree, growth, roots, underground) => {
    const index = pool.spawn()
    if (index < 0) return
    // A branch that has grown, or just the trunk.
    let route = tree.trunkOnly
    for (let tries = 0; tries < 6; tries += 1) {
      const pick = tree.crown[Math.floor(random() * tree.crown.length)]
      if (pick && pick.order <= growth - 0.02) {
        route = pick
        break
      }
    }
    const p = index * 3
    const { trunk } = tree
    if (underground) {
      const angle = random() * Math.PI * 2
      const distance = roots.reach * ROOT_SPREAD * Math.sqrt(random())
      pool.velocity[p] = trunk.x + Math.cos(angle) * distance
      pool.velocity[p + 1] = tree.groundY - roots.rootDepth * (ROOT_DEPTH[0] + random() * (ROOT_DEPTH[1] - ROOT_DEPTH[0]))
      pool.velocity[p + 2] = trunk.z + Math.sin(angle) * distance
    } else {
      // From the foot of the trunk, a little around it.
      const angle = random() * Math.PI * 2
      pool.velocity[p] = trunk.x + Math.cos(angle) * trunk.radius * 0.5
      pool.velocity[p + 1] = tree.groundY
      pool.velocity[p + 2] = trunk.z + Math.sin(angle) * trunk.radius * 0.5
    }
    const first = Math.hypot(
      route.points[0] + pool.spin[p] - pool.velocity[p],
      route.points[1] - pool.velocity[p + 1],
      route.points[2] + pool.spin[p + 2] - pool.velocity[p + 2]
    )
    // Its line up the trunk (in pool.spin x, z).
    const turn = random() * Math.PI * 2
    const off = trunk.radius * TRUNK_SPREAD * Math.sqrt(random())
    pool.spin[p] = Math.cos(turn) * off
    pool.spin[p + 2] = Math.sin(turn) * off
    routes[index] = route
    cursor[index] = 0
    total[index] = first + route.lengths[route.lengths.length - 1]
    pool.timer[index] = 0
    pool.life[index] = SPEED[0] + random() * (SPEED[1] - SPEED[0])
    pool.seed[index] = random()
  }

  // Where a particle is, `s` metres along (its start, then its route).
  const place = (index, s) => {
    const p = index * 3
    const route = routes[index]
    const { points: path, lengths } = route
    const sx = pool.velocity[p]
    const sy = pool.velocity[p + 1]
    const sz = pool.velocity[p + 2]
    const first = total[index] - lengths[lengths.length - 1]
    const ox = pool.spin[p]
    const oz = pool.spin[p + 2]
    if (s < first) {
      const t = s / (first || 1)
      pool.position[p] = sx + (path[0] + ox - sx) * t
      pool.position[p + 1] = sy + (path[1] - sy) * t
      pool.position[p + 2] = sz + (path[2] + oz - sz) * t
      return
    }
    const along = s - first
    let k = cursor[index]
    while (k < lengths.length - 2 && lengths[k + 1] < along) k += 1
    cursor[index] = k
    const a = k * 3
    const b = Math.min(k + 1, lengths.length - 1) * 3
    const t = Math.min((along - lengths[k]) / (lengths[k + 1] - lengths[k] || 1), 1)
    pool.position[p] = path[a] + (path[b] - path[a]) * t
    pool.position[p + 1] = path[a + 1] + (path[b + 1] - path[a + 1]) * t
    pool.position[p + 2] = path[a + 2] + (path[b + 2] - path[a + 2]) * t
    // Off the axis up the trunk (the first stretch), meeting at the crown.
    if (k === 0) {
      pool.position[p] += ox * (1 - t)
      pool.position[p + 2] += oz * (1 - t)
    }
  }

  const colour = (share, index) => {
    let k = 1
    while (k < COLOURS.length - 1 && COLOURS[k][0] < share) k += 1
    const [a0, ...from] = COLOURS[k - 1]
    const [a1, ...to] = COLOURS[k]
    const t = Math.min(Math.max((share - a0) / (a1 - a0), 0), 1)
    for (let c = 0; c < 3; c += 1) pool.color[index * 3 + c] = from[c] + (to[c] - from[c]) * t
  }

  return {
    /**
     * Once per frame. on: Sap flow; trunks; trees: the tree water states;
     * crowns: the crown renderer (pathsOf); roots: { reach, rootDepth };
     * ground(trunk): the height the trunk stands at; underground: X-ray or
     * the cross-section is on (sap starts in the root zone); version:
     * changes when the ground or the crowns do.
     */
    update({ dt, on, trunks, trees: states, crowns, roots, anchor, ground, underground, camera, viewportHeight, version }) {
      points.object.visible = on && Boolean(trunks)
      if (!points.object.visible) {
        if (pool.alive) pool.clear()
        trees.clear()
        return
      }
      if (version !== builtVersion) {
        builtVersion = version
        pool.clear()
        trees.clear()
      }
      dt = Math.min(dt, 0.05)

      const near = new Set()
      for (const trunk of trunks.trunksNear(anchor.x, anchor.z, VIEW)) {
        const state = states.stateOf(trunk)
        if (!state) continue
        const tree = treeOf(trunk, crowns, ground(trunk))
        if (!tree) continue
        near.add(tree)
        tree.owed += RATE * state.supply * states.demandOf(trunk) * dt
        while (tree.owed >= 1) {
          tree.owed -= 1
          spawn(tree, state.growth, roots, underground)
        }
      }
      for (const [key, tree] of trees) if (!near.has(tree)) trees.delete(key)

      for (let index = 0; index < CAPACITY; index += 1) {
        if (pool.state[index] === DEAD) continue
        pool.timer[index] += pool.life[index] * dt
        const share = pool.timer[index] / total[index]
        if (share >= 1) {
          routes[index] = null
          pool.kill(index)
          continue
        }
        place(index, pool.timer[index])
        colour(share, index)
        pool.size[index] = SIZE * (0.7 + 0.6 * pool.seed[index])
        pool.alpha[index] = smoothstep(0, FADE_IN, share) * (1 - smoothstep(1 - FADE_OUT, 1, share))
      }
      points.update(camera, viewportHeight, 0.9)
    },

    get alive() {
      return pool.alive
    },

    dispose() {
      scene.remove(points.object)
      points.dispose()
    },
  }
}
