import * as THREE from 'three'

/**
 * Third-person chase camera (the butterfly's default view). It sits behind
 * and above the body and aims a little above it, so the body rides slightly
 * below the centre of the screen. Position and aim follow on soft springs,
 * so the camera lags gently into turns and climbs; it never rolls.
 *
 * Drag swings it around the body (yaw) and up or down (elevation); once
 * you fly again it drifts back behind. Zoom changes the distance. It stays
 * above the ground and out of tree trunks.
 *
 * settings (viewpointConfig.js `chase`): distance, distanceLimits,
 * elevation, elevationLimits, lift (aim above the body, share of the
 * distance), follow / aim (spring rates, per s), recenterDelay (s),
 * recenterRate (per s), clearance (m above the ground), trunkGap (m).
 */

const smooth = (rate, dt) => 1 - Math.exp(-rate * dt)
const clamp = (value, [low, high]) => Math.min(Math.max(value, low), high)
const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle))

export function createChaseCamera(world) {
  const position = new THREE.Vector3()
  const target = new THREE.Vector3()
  const goal = new THREE.Vector3()
  const goalTarget = new THREE.Vector3()
  const matrix = new THREE.Matrix4()
  const up = new THREE.Vector3(0, 1, 0)
  let swing = 0
  let elevation = 0
  let distance = 0
  let idle = 0

  // Where the camera wants to be for a body at `center` heading `heading`.
  const aimAt = (center, heading, settings, outPosition, outTarget) => {
    const angle = heading + swing
    const flat = Math.cos(elevation) * distance
    outPosition.set(
      center.x + Math.sin(angle) * flat,
      center.y + Math.sin(elevation) * distance,
      center.z + Math.cos(angle) * flat
    )
    const clear = world.resolve(outPosition.x, outPosition.z, settings.trunkGap, { trunks: true })
    outPosition.x = clear.x
    outPosition.z = clear.z
    outPosition.y = Math.max(outPosition.y, world.heightAt(outPosition.x, outPosition.z) + settings.clearance)
    outTarget.copy(center).addScaledVector(up, distance * settings.lift)
  }

  return {
    /** Back to the default framing (behind, default distance). */
    reset(settings) {
      swing = 0
      elevation = settings.elevation
      distance = settings.distance
      idle = 0
    },

    /** Back behind the body, keeping the chosen distance. */
    recenter(settings) {
      swing = 0
      elevation = settings.elevation
      if (!distance) distance = settings.distance
      idle = 0
    },

    /** Drag: swing around the body and tilt (radians, like look input). */
    look(yaw, pitch, settings) {
      if (!yaw && !pitch) return
      swing = wrapAngle(swing + yaw)
      elevation = clamp(elevation - pitch, settings.elevationLimits)
      idle = 0
    },

    /** Zoom as the log of a distance factor (> 0 is further). */
    zoom(amount, settings) {
      if (amount) distance = clamp(distance * Math.exp(amount), settings.distanceLimits)
    },

    /** The settled pose for a body (for transitions): fills position, quaternion. */
    pose(center, heading, settings, outPosition, outQuaternion) {
      aimAt(center, heading, settings, outPosition, goalTarget)
      matrix.lookAt(outPosition, goalTarget, up)
      return outQuaternion.setFromRotationMatrix(matrix)
    },

    /**
     * Follow the body one frame and place `camera`. snap jumps straight to
     * the goal (after a transition or a teleport).
     */
    update(dt, { center, heading, moving, settings, camera, snap = false }) {
      idle += dt
      if (moving && idle > settings.recenterDelay) {
        const k = smooth(settings.recenterRate, dt)
        swing += wrapAngle(0 - swing) * k
        elevation += (settings.elevation - elevation) * k
      }
      aimAt(center, heading, settings, goal, goalTarget)
      if (snap) {
        position.copy(goal)
        target.copy(goalTarget)
      } else {
        position.lerp(goal, smooth(settings.follow, dt))
        target.lerp(goalTarget, smooth(settings.aim, dt))
        position.y = Math.max(position.y, world.heightAt(position.x, position.z) + settings.clearance)
      }
      camera.position.copy(position)
      matrix.lookAt(position, target, up)
      camera.quaternion.setFromRotationMatrix(matrix)
    },

    get distance() {
      return distance
    },
  }
}
