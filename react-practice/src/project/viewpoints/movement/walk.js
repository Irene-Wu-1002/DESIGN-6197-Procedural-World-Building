/**
 * Walking (Human): move on the ground relative to where you look, eye at a
 * fixed height above it, around tree trunks. A very small head bob while
 * walking when motion effects are on.
 *
 * Every movement strategy has the same shape:
 *   place(state, from, ctx)      put the viewer at from.x/z (new viewpoint)
 *   update(dt, input, state, ctx) → { moving, turn }  one frame
 * state: { position (eye, Vector3), yaw, pitch, roll, tiltPitch, tiltRoll }
 * ctx:   { config, world, motion, antWorld }
 */

const smooth = (rate, dt) => 1 - Math.exp(-rate * dt)

export function createWalkMovement() {
  let groundY = 0
  let phase = 0
  let pace = 0

  return {
    place(state, from, { config, world }) {
      const spot = world.resolve(from.x, from.z, config.collision.radius, config.collision)
      groundY = world.heightAt(spot.x, spot.z)
      state.position.set(spot.x, groundY + config.eyeHeight, spot.z)
      state.roll = 0
      state.tiltPitch = 0
      state.tiltRoll = 0
      phase = 0
      pace = 0
    },

    update(dt, input, state, { config, world, motion }) {
      const { speed, runFactor, bob, stride } = config.movement
      const forward = input.move.y
      const strafe = input.move.x
      const amount = Math.min(Math.hypot(forward, strafe), 1)
      const target = amount * speed * (input.run ? runFactor : 1)
      pace += (target - pace) * smooth(8, dt)

      if (amount > 0.01) {
        const sin = Math.sin(state.yaw)
        const cos = Math.cos(state.yaw)
        const length = Math.hypot(forward, strafe)
        // Forward is -z at yaw 0; right is +x.
        const dx = (-sin * forward + cos * strafe) / length
        const dz = (-cos * forward - sin * strafe) / length
        const spot = world.resolve(
          state.position.x + dx * pace * dt,
          state.position.z + dz * pace * dt,
          config.collision.radius,
          config.collision
        )
        state.position.x = spot.x
        state.position.z = spot.z
      }
      groundY += (world.heightAt(state.position.x, state.position.z) - groundY) * smooth(10, dt)
      phase += (pace / stride) * Math.PI * 2 * dt
      const lift = motion ? Math.sin(phase * 2) * bob * Math.min(pace / speed, 1) : 0
      state.position.y = groundY + config.eyeHeight + lift
      return { moving: pace > 0.05, turn: 0, phase }
    },
  }
}
