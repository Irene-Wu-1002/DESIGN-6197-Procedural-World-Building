/**
 * Walking underground (Ant): along the colony's tunnels (ants/tunnels.js).
 * The ant keeps to a tunnel's centreline, a few millimetres up off its
 * floor; W / S walk on or back, A / D edge toward either wall, and the view
 * turns and tips with the tunnel. In a chamber, where several tunnels meet,
 * the ant takes the one it is facing. Space walks on by itself.
 *
 * Reaching the top of a shaft brings the ant out on the surface: update()
 * then returns { surfaced: entrance index }, and crawl.js takes over again.
 * Used by crawl.js; not a viewpoint movement of its own.
 */

const smooth = (rate, dt) => 1 - Math.exp(-rate * dt)
const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle))
// Eye below the centreline (m): the floor is a radius down, the eye 4 mm up.
const EYE_DROP = 0.0011
// How far the ant can edge toward a wall (share of the radius).
const SIDE_REACH = 0.4
// How much of a tunnel's slope tips the view, and the most it tips (rad).
const TIP_SHARE = 0.75
const TIP_LIMIT = 1.1
// Starting this far down a shaft (m).
const START = 0.006

export function createBurrow() {
  // { network, edge, s, direction (+1: toward edge.b), side (m), auto }
  let at = null
  let pace = 0
  const point = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 }

  const nodeAhead = () => at.network.nodes[at.direction > 0 ? at.edge.b : at.edge.a]

  // The way an edge leaves `node` (unit, horizontal part).
  const leaving = (edge, node, out) => {
    const fromA = edge.a === node.id
    at.network.pointAt(edge, fromA ? Math.min(START, edge.length) : Math.max(edge.length - START, 0), out)
    const sign = fromA ? 1 : -1
    return { x: out.tx * sign, y: out.ty * sign, z: out.tz * sign, fromA }
  }

  // Which tunnel to take on from a chamber: the one most nearly ahead.
  const chooseAt = (node, state) => {
    const fx = -Math.sin(state.yaw)
    const fz = -Math.cos(state.yaw)
    let best = null
    for (const id of node.edges) {
      const edge = at.network.edges[id]
      const way = leaving(edge, node, point)
      const flat = Math.hypot(way.x, way.z) || 1
      let score = (way.x * fx + way.z * fz) / flat
      // Turning straight back is the last resort.
      if (edge === at.edge) score -= 0.6
      if (!best || score > best.score) best = { edge, fromA: way.fromA, score }
    }
    return best
  }

  const describe = (edge, toward) => {
    const node = at.network.nodes[toward]
    if (node.kind === 'entrance') return 'Up toward the light.'
    if (edge.kind === 'gallery') return node.hill === 0 ? 'Toward the main nest.' : `Toward nest ${node.hill + 1}.`
    return 'Down into the nest chamber.'
  }

  const place = (state) => {
    at.network.pointAt(at.edge, at.s, point)
    // Edge toward a wall: sideways across the tunnel, level.
    const flat = Math.hypot(point.tx, point.tz) || 1
    const sx = -point.tz / flat
    const sz = point.tx / flat
    state.position.set(point.x + sx * at.side, point.y - EYE_DROP, point.z + sz * at.side)
  }

  return {
    get active() {
      return Boolean(at)
    },
    get auto() {
      return Boolean(at?.auto)
    },

    /** The hill of the nest you're under (or heading for). */
    get hill() {
      return at ? nodeAhead().hill : -1
    },

    /** Go down entrance `index`'s shaft. Returns a hint, or null if there's no way down. */
    enter(state, network, index) {
      const node = network?.entranceNode(index)
      if (!node) return null
      const edge = network.edges[node.edges[0]]
      const fromA = edge.a === node.id
      at = { network, edge, s: fromA ? START : edge.length - START, direction: fromA ? 1 : -1, side: 0, auto: false }
      pace = 0
      network.pointAt(edge, at.s, point)
      const sign = at.direction
      const flat = Math.hypot(point.tx, point.tz)
      if (flat > 0.2) state.yaw = Math.atan2(-point.tx * sign, -point.tz * sign)
      state.tiltPitch = -0.6
      state.tiltRoll = 0
      state.roll = 0
      place(state)
      return 'Underground. Walk on (W) or let the tunnel lead you (Space).'
    },

    leave() {
      at = null
      pace = 0
    },

    /** Space: walk on by itself, or stop. Returns whether it walks. */
    toggleAuto() {
      if (!at) return false
      at.auto = !at.auto
      return at.auto
    },

    update(dt, input, state, { config, motion }) {
      const m = config.movement
      let hint = null
      const forward = input.move.y
      if (at.auto && Math.abs(forward) > 0.2) at.auto = false
      const push = at.auto ? 1 : forward
      const target = Math.min(Math.abs(push), 1) * m.speed * (input.run ? m.runFactor : 1)
      pace += (target - pace) * smooth(10, dt)
      // Facing back down the tunnel and walking on: turn round.
      at.network.pointAt(at.edge, at.s, point)
      const fx = -Math.sin(state.yaw)
      const fz = -Math.cos(state.yaw)
      const flat = Math.hypot(point.tx, point.tz)
      if (!at.auto && flat > 0.3 && Math.abs(forward) > 0.2 && pace < m.speed * 0.25) {
        const ahead = ((point.tx * fx + point.tz * fz) / flat) * at.direction
        if (ahead < -0.2) at.direction = -at.direction
      }
      const sign = push >= 0 ? 1 : -1
      at.s += at.direction * sign * pace * dt

      // Off the end of this tunnel: into a chamber (take the way ahead), or
      // out at the top of a shaft.
      if (at.s <= 0 || at.s >= at.edge.length) {
        const node = at.network.nodes[at.s <= 0 ? at.edge.a : at.edge.b]
        if (node.kind === 'entrance') {
          const index = node.entrance
          at = null
          return { moving: false, turn: 0, following: false, surfaced: index }
        }
        const overshoot = at.s <= 0 ? -at.s : at.s - at.edge.length
        const next = chooseAt(node, state)
        const changed = next.edge !== at.edge
        at.edge = next.edge
        at.direction = next.fromA ? 1 : -1
        at.s = next.fromA ? Math.min(overshoot, at.edge.length) : Math.max(at.edge.length - overshoot, 0)
        // Walking backward through a chamber keeps walking backward.
        if (sign < 0) at.direction = -at.direction
        if (changed) hint = describe(at.edge, at.direction * sign > 0 ? at.edge.b : at.edge.a)
      }

      // Edge toward the walls.
      const reach = at.edge.radius * SIDE_REACH
      at.side += input.move.x * m.speed * 0.5 * dt
      at.side = Math.min(Math.max(at.side, -reach), reach)
      if (Math.abs(input.move.x) < 0.1) at.side *= 1 - smooth(1.5, dt)
      place(state)

      // Turn with the tunnel while walking on, and tip with its slope.
      at.network.pointAt(at.edge, at.s, point)
      const way = at.direction * sign
      const tx = point.tx * way
      const ty = point.ty * way
      const tz = point.tz * way
      const level = Math.hypot(tx, tz)
      if (pace > 0.002 && level > 0.25 && sign > 0) {
        const heading = Math.atan2(-tx, -tz)
        state.yaw += wrapAngle(heading - state.yaw) * smooth(at.auto ? 4 : 2.5, dt)
      }
      const slope = Math.atan2(ty, Math.max(level, 1e-4)) * (sign > 0 ? 1 : -1)
      const tip = Math.min(Math.max(slope * TIP_SHARE, -TIP_LIMIT), TIP_LIMIT)
      state.tiltPitch += (tip - state.tiltPitch) * smooth(4, dt)
      const lean = motion ? (at.side / Math.max(reach, 1e-4)) * 0.15 : 0
      state.tiltRoll += (lean - state.tiltRoll) * smooth(5, dt)
      return { moving: pace > 0.003, turn: 0, following: at.auto, hint }
    },
  }
}
