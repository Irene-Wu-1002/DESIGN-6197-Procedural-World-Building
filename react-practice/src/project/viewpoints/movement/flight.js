/**
 * Flight (Butterfly): fly forward and back, turn with A/D (banking gently
 * into the turn), rise and sink. Every rate is smoothed so the camera never
 * jerks; bank and flutter are off when motion effects are off.
 * Altitude stays between minClearance above the ground and maxAltitude.
 * See orbit.js for the strategy interface.
 */

const smooth = (rate, dt) => 1 - Math.exp(-rate * dt)

export function createFlightMovement() {
  let pace = 0
  let turn = 0
  let climb = 0
  let time = 0
  // Height above the ground, kept apart from the flutter so it never drifts.
  let altitude = 0

  return {
    place(state, from, { config, world }) {
      const ground = world.heightAt(from.x, from.z)
      altitude = Math.max(config.eyeHeight, config.movement.minClearance)
      const spot = world.resolve(from.x, from.z, config.collision.radius, config.collision, altitude)
      state.position.set(spot.x, ground + altitude, spot.z)
      state.roll = 0
      state.tiltPitch = 0
      state.tiltRoll = 0
      pace = 0
      turn = 0
      climb = 0
    },

    update(dt, input, state, { config, world, motion }) {
      const m = config.movement
      time += dt
      pace += (input.move.y * m.speed * (input.run ? m.runFactor : 1) - pace) * smooth(3, dt)
      turn += (-input.move.x * m.turnRate - turn) * smooth(4, dt)
      const vertical = (input.held('rise') ? 1 : 0) - (input.held('sink') ? 1 : 0)
      climb += (vertical * m.climbRate - climb) * smooth(4, dt)

      state.yaw += turn * dt
      const nextX = state.position.x - Math.sin(state.yaw) * pace * dt
      const nextZ = state.position.z - Math.cos(state.yaw) * pace * dt
      altitude = Math.min(Math.max(altitude + climb * dt, m.minClearance), m.maxAltitude)
      const spot = world.resolve(nextX, nextZ, config.collision.radius, config.collision, altitude)
      const flutter = motion ? Math.sin(time * 9) * m.flutter : 0
      state.position.set(spot.x, world.heightAt(spot.x, spot.z) + altitude + flutter, spot.z)

      // Bank into the turn (positive turn = left = roll left).
      const bank = motion ? Math.max(Math.min(turn / m.turnRate, 1), -1) * m.bank : 0
      state.roll += (bank - state.roll) * smooth(3, dt)
      return { moving: Math.abs(pace) > 0.05, turn: turn / m.turnRate, altitude }
    },
  }
}
