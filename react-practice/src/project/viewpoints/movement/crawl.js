/**
 * Crawling (Ant): eye a few millimetres above the surface you stand on
 * (ground, moss cushions, twigs), blocked by trunks, mushroom stems, and the
 * fly agaric; the view tilts part of the way with the slope under you.
 *
 * Follow scent (toggle): near a pheromone trail the ant walks along it on
 * its own, turning with the trail, until the trail ends or you move.
 * See orbit.js for the strategy interface.
 */

const smooth = (rate, dt) => 1 - Math.exp(-rate * dt)
// Sample spacing for the slope under the ant (about its body length).
const FOOT = 0.003

const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle))

export function createCrawlMovement() {
  let surfaceY = 0
  let pace = 0
  // { trail, s, direction } while following a scent trail.
  let following = null
  const point = { x: 0, z: 0, tx: 0, tz: 0 }

  const settle = (state, world, config, dt, snap) => {
    const { x, z } = state.position
    const target = world.surfaceAt(x, z)
    surfaceY = snap ? target : surfaceY + (target - surfaceY) * smooth(25, dt)
    // Never sink toward the surface while catching up (eye stays ≥ 3 mm).
    surfaceY = Math.max(surfaceY, target - config.eyeHeight * 0.25)
    state.position.y = surfaceY + config.eyeHeight
  }

  return {
    get following() {
      return Boolean(following)
    },

    place(state, from, { config, world }) {
      const spot = world.resolve(from.x, from.z, config.collision.radius, config.collision)
      state.position.x = spot.x
      state.position.z = spot.z
      state.roll = 0
      state.tiltPitch = 0
      state.tiltRoll = 0
      pace = 0
      following = null
      settle(state, world, config, 0, true)
    },

    /** Start or stop following the nearest scent trail. Returns whether it follows. */
    toggleScent(state, { config, antWorld }) {
      if (following) {
        following = null
        return false
      }
      const near = antWorld?.nearestTrail(state.position.x, state.position.z)
      if (!near || near.distance > config.movement.scentReach) return false
      near.trail.pointAt(near.s, point)
      // Head whichever way along the trail you're already facing.
      const facing = -Math.sin(state.yaw) * point.tx - Math.cos(state.yaw) * point.tz
      following = { trail: near.trail, s: near.s, direction: facing >= 0 ? 1 : -1 }
      return true
    },

    stopScent() {
      following = null
    },

    update(dt, input, state, { config, world, motion }) {
      const m = config.movement
      const amount = Math.min(Math.hypot(input.move.x, input.move.y), 1)
      if (following && amount > 0.2) following = null
      const target = (following ? 1 : amount) * m.speed * (input.run ? m.runFactor : 1)
      pace += (target - pace) * smooth(10, dt)

      let nextX = state.position.x
      let nextZ = state.position.z
      if (following) {
        const { trail } = following
        following.s += following.direction * pace * dt
        if (following.s <= 0 || following.s >= trail.length) {
          following = null
        } else {
          trail.pointAt(following.s, point)
          // Pull onto the trail and turn to face along it.
          nextX += (point.x - nextX) * smooth(12, dt)
          nextZ += (point.z - nextZ) * smooth(12, dt)
          const heading = Math.atan2(-point.tx * following.direction, -point.tz * following.direction)
          state.yaw += wrapAngle(heading - state.yaw) * smooth(3, dt)
        }
      } else if (amount > 0.01) {
        const sin = Math.sin(state.yaw)
        const cos = Math.cos(state.yaw)
        const length = Math.hypot(input.move.x, input.move.y)
        nextX += ((-sin * input.move.y + cos * input.move.x) / length) * pace * dt
        nextZ += ((-cos * input.move.y - sin * input.move.x) / length) * pace * dt
      }
      const spot = world.resolve(nextX, nextZ, config.collision.radius, config.collision)
      state.position.x = spot.x
      state.position.z = spot.z
      settle(state, world, config, dt, false)

      // Lean with the slope: compare the surface ahead/behind and to the sides.
      const sin = Math.sin(state.yaw)
      const cos = Math.cos(state.yaw)
      const { x, z } = state.position
      const ahead = world.surfaceAt(x - sin * FOOT, z - cos * FOOT) - world.surfaceAt(x + sin * FOOT, z + cos * FOOT)
      const side = world.surfaceAt(x + cos * FOOT, z - sin * FOOT) - world.surfaceAt(x - cos * FOOT, z + sin * FOOT)
      const share = motion ? m.tilt : 0
      state.tiltPitch += (Math.atan2(ahead, 2 * FOOT) * share - state.tiltPitch) * smooth(6, dt)
      state.tiltRoll += (Math.atan2(side, 2 * FOOT) * share - state.tiltRoll) * smooth(6, dt)
      return { moving: pace > 0.003, turn: 0, following: Boolean(following) }
    },
  }
}
