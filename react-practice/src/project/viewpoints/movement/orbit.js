import * as THREE from 'three'

/**
 * Orbit (Free view): no body. The camera circles a focus point on the
 * ground: drag or the arrow keys turn and tilt it (the controller's look
 * input is the orbit angle), the wheel or + / − zoom, right-drag / Shift+drag
 * or W A S D pan the focus across the ground (faster when zoomed out), and
 * setFocus glides it to a spot (double-click). The camera never dips under
 * the ground.
 *
 * Every movement strategy has the same shape:
 *   place(state, from, ctx)      put the viewer at from.x/z (new viewpoint)
 *   update(dt, input, state, ctx) → { moving, turn }  one frame
 * and may add anchor() (where detail should stream) and near() (a near
 * plane that follows it).
 * state: { position (eye, Vector3), yaw, pitch, roll, tiltPitch, tiltRoll }
 * ctx:   { config, world, motion, antWorld }
 */

const smooth = (rate, dt) => 1 - Math.exp(-rate * dt)
const clamp = (value, low, high) => Math.min(Math.max(value, low), high)

export function createOrbitMovement() {
  const focus = new THREE.Vector3()
  const glide = new THREE.Vector3()
  const forward = new THREE.Vector3()
  let distance = 0.6
  let targetDistance = 0.6
  let gliding = false

  // Camera = focus, backed off along the view direction by `distance`.
  const pose = (state, world) => {
    const cos = Math.cos(state.pitch)
    forward.set(-Math.sin(state.yaw) * cos, Math.sin(state.pitch), -Math.cos(state.yaw) * cos)
    state.position.copy(focus).addScaledVector(forward, -distance)
    const floor = world.heightAt(state.position.x, state.position.z) + Math.max(distance * 0.04, 0.003)
    if (state.position.y < floor) state.position.y = floor
  }

  return {
    place(state, from, { config, world }) {
      focus.set(from.x, world.heightAt(from.x, from.z), from.z)
      const [near, far] = config.movement.distance
      distance = targetDistance = clamp(from.distance ?? config.movement.startDistance, near, far)
      gliding = false
      state.roll = 0
      state.tiltPitch = 0
      state.tiltRoll = 0
      pose(state, world)
    },

    /** Glide the focus to (x, z). */
    setFocus(x, z) {
      glide.set(x, 0, z)
      gliding = true
    },

    /** The ground point you're looking at (detail streams around it). */
    anchor() {
      return focus
    },

    /** Near plane for this zoom, so close-ups never clip. */
    near() {
      return clamp(distance * 0.01, 0.0005, 0.01)
    },

    update(dt, input, state, { config, world }) {
      const m = config.movement
      targetDistance = clamp(targetDistance * Math.exp(input.takeZoom(dt, m.zoomRate)), m.distance[0], m.distance[1])
      distance += (targetDistance - distance) * smooth(12, dt)

      const sin = Math.sin(state.yaw)
      const cos = Math.cos(state.yaw)
      const { x: strafe, y: ahead } = input.move
      if (strafe || ahead) {
        gliding = false
        const speed = m.speed * distance * (input.run ? m.runFactor : 1)
        focus.x += (-sin * ahead + cos * strafe) * speed * dt
        focus.z += (-cos * ahead - sin * strafe) * speed * dt
      }
      // Pan drag grabs the ground: drag right and it slides right (the focus
      // goes left); drag down and it comes toward you (the focus goes ahead).
      const pan = input.takePan()
      if (pan.x || pan.y) {
        gliding = false
        const scale = m.panPerPixel * distance
        focus.x += (-cos * pan.x - sin * pan.y) * scale
        focus.z += (sin * pan.x - cos * pan.y) * scale
      }
      if (gliding) {
        const k = smooth(6, dt)
        focus.x += (glide.x - focus.x) * k
        focus.z += (glide.z - focus.z) * k
        if (Math.hypot(glide.x - focus.x, glide.z - focus.z) < 1e-4) gliding = false
      }
      focus.y += (world.heightAt(focus.x, focus.z) - focus.y) * smooth(10, dt)
      pose(state, world)
      return { moving: false, turn: 0 }
    },
  }
}
