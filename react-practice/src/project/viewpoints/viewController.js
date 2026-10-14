import * as THREE from 'three'
import { createViewInput } from './input'
import { createCrawlMovement } from './movement/crawl'
import { createFlightMovement } from './movement/flight'
import { createWalkMovement } from './movement/walk'
import { lerpPreset, presetValues } from './viewEffects'
import { VIEWPOINTS, VIEW_SHARED } from './viewpointConfig'

/**
 * The viewpoint controller: one place that owns the viewer and the camera.
 *
 * - Holds the viewer's pose and runs exactly one movement strategy (the
 *   active viewpoint's); the others are idle.
 * - Switches viewpoints with a camera move: pull back, dolly out to reveal
 *   the new body where you are, then into its eye, while field of view,
 *   haze, vision effects, and perception blend across. With reduced motion
 *   it crossfades instead. New switches wait until it finishes, and the
 *   last frame always lands exactly on the new eye.
 * - "View body" (out to third person and back) and the ant's tunnels use
 *   the same machinery.
 * - Each frame returns what the scene needs: where to stream detail, the
 *   blended visual parameters, and embodiment cues for the overlays.
 *
 * It never touches the generated world: the scene reads `anchor` from the
 * frame and streams around it exactly as before.
 */

const MOVEMENTS = { walk: createWalkMovement, flight: createFlightMovement, crawl: createCrawlMovement }

const clamp01 = (t) => Math.min(Math.max(t, 0), 1)
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10)
const stage = (u, start, end) => clamp01((u - start) / (end - start))
const smooth = (rate, dt) => 1 - Math.exp(-rate * dt)
// Switch timeline (share of the duration): pull back, dolly out, hold, in.
const SWITCH = { pull: 0.18, out: 0.55, hold: 0.72 }
// Where the body is fully shown during a switch.
const BODY_IN = [0.12, 0.3]
const BODY_OUT = [0.8, 0.96]
// Fastest the detailed area may move (m/s), so tiles keep up with it.
const ANCHOR_SPEED = 2.5
const UI_CHECK_SECONDS = 0.15
const HINT_SECONDS = 2.6

function paramsOf(config) {
  return {
    fov: config.camera.fov,
    near: config.camera.near,
    far: config.camera.far,
    hazeScale: config.haze.scale,
    hazeMin: config.haze.min,
    shadowReach: config.shadowReach,
    streamAhead: config.streamAhead,
    effects: presetValues(config.effects),
    perception: { ...config.perception },
  }
}

function copyParams(p) {
  return { ...p, effects: { ...p.effects, tint: [...p.effects.tint] }, perception: { ...p.perception } }
}

const NUMBERS = ['fov', 'near', 'far', 'hazeScale', 'hazeMin', 'shadowReach', 'streamAhead']
function lerpParams(a, b, t, out) {
  for (const key of NUMBERS) out[key] = a[key] + (b[key] - a[key]) * t
  // Near plane in log space: it spans 0.3 mm to 1 cm.
  out.near = Math.exp(Math.log(a.near) + (Math.log(b.near) - Math.log(a.near)) * t)
  lerpPreset(a.effects, b.effects, t, out.effects)
  for (const key of Object.keys(b.perception)) {
    out.perception[key] = a.perception[key] + (b.perception[key] - a.perception[key]) * t
  }
  return out
}

const newState = () => ({ position: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, tiltPitch: 0, tiltRoll: 0 })

/**
 * camera: the scene camera; world: worldQueries; bodies: bodies.js;
 * antWorld: antWorld.js; start: { id, x, z, yaw, pitch };
 * hooks: { onUi(ui), capture() } — capture copies the current frame for
 * a crossfade (viewEffects.capture).
 */
export function createViewController({ camera, world, bodies, antWorld, start, hooks }) {
  const input = createViewInput()
  const movements = {}
  const movementFor = (id) => {
    movements[id] ??= MOVEMENTS[VIEWPOINTS[id].movement.type]()
    return movements[id]
  }
  const settings = { compoundEye: true, motionEffects: true, reducedMotion: false }

  let id = start.id
  let config = VIEWPOINTS[id]
  let movement = movementFor(id)
  let state = newState()
  const params = paramsOf(config)
  const ctxFor = (forConfig) => ({ config: forConfig, world, motion: settings.motionEffects, antWorld })

  state.yaw = start.yaw
  state.pitch = start.pitch ?? config.camera.startPitch
  movement.place(state, start, ctxFor(config))

  // The running switch / body view / tunnel, or null.
  let action = null
  let time = 0
  let info = { moving: false, turn: 0 }

  // Scratch objects.
  const euler = new THREE.Euler(0, 0, 0, 'YXZ')
  const lookMatrix = new THREE.Matrix4()
  const up = new THREE.Vector3(0, 1, 0)
  const va = new THREE.Vector3()
  const vb = new THREE.Vector3()
  const turnQ = new THREE.Quaternion()
  const partQ = new THREE.Quaternion()
  const lookQ = new THREE.Quaternion()
  const direction = new THREE.Vector3()
  const anchor = new THREE.Vector3(state.position.x, 0, state.position.z)
  let anchorReady = false

  const eyeQuaternion = (s, out) => {
    euler.set(s.pitch + s.tiltPitch, s.yaw, s.roll + s.tiltRoll)
    return out.setFromEuler(euler)
  }
  const lookAtQuaternion = (from, target, out) => {
    lookMatrix.lookAt(from, target, up)
    return out.setFromRotationMatrix(lookMatrix)
  }
  // Move around `focus` from `a` to `b`: direction turns, distance changes
  // in log space (so a 1.7 m → 4 mm change feels like an even zoom).
  const dolly = (focus, a, b, t, out) => {
    va.subVectors(a, focus)
    vb.subVectors(b, focus)
    const la = Math.log(Math.max(va.length(), 1e-5))
    const lb = Math.log(Math.max(vb.length(), 1e-5))
    va.normalize()
    vb.normalize()
    turnQ.setFromUnitVectors(va, vb)
    partQ.identity().slerp(turnQ, t)
    return out.copy(va).applyQuaternion(partQ).multiplyScalar(Math.exp(la + (lb - la) * t)).add(focus)
  }
  const clampPitch = (forConfig, pitch) =>
    Math.min(Math.max(pitch, forConfig.camera.pitchLimits[0]), forConfig.camera.pitchLimits[1])

  /** Third-person shot of `forConfig`'s body with its eye at `eye`. */
  const framingOf = (forConfig, eye, yaw, focus, shot) => {
    const [forward, height] = forConfig.body.eye
    const f = forConfig.framing
    focus.set(eye.x + Math.sin(yaw) * forward, eye.y - height + f.lookUp, eye.z + Math.cos(yaw) * forward)
    // Behind and to one side, looking down a little.
    const angle = yaw + 0.6
    const flat = Math.cos(f.elevation) * f.distance
    shot.set(
      focus.x + Math.sin(angle) * flat,
      focus.y + Math.sin(f.elevation) * f.distance,
      focus.z + Math.cos(angle) * flat
    )
    shot.y = Math.max(shot.y, world.heightAt(shot.x, shot.z) + f.distance * 0.15)
  }
  const orbit = (focus, shot, angle, out) => {
    va.subVectors(shot, focus).applyAxisAngle(up, angle)
    return out.copy(focus).add(va)
  }

  // --- UI state (sent only when it changes).
  const ui = {
    id,
    target: null,
    busy: false,
    bodyView: false,
    nearTunnel: false,
    following: false,
    scentNearby: false,
    label: '',
    labelId: 0,
    hint: '',
    hintId: 0,
  }
  let uiDirty = true
  let uiCheck = 0
  let hintUntil = 0
  let nearEntrance = -1
  const setUi = (patch) => {
    for (const [key, value] of Object.entries(patch)) {
      if (ui[key] !== value) {
        ui[key] = value
        uiDirty = true
      }
    }
  }
  const showHint = (hint) => {
    setUi({ hint, hintId: ui.hintId + 1 })
    hintUntil = time + HINT_SECONDS
  }
  const showLabel = (forConfig, text) =>
    setUi({ label: text ?? `${forConfig.label} · eye height ${forConfig.eyeHeightLabel}`, labelId: ui.labelId + 1 })

  // --- Switching viewpoints.
  const finishSwitch = (next) => {
    id = next.id
    config = VIEWPOINTS[id]
    movement = next.movement
    state = next.state
    Object.assign(params, copyParams(next.params))
    input.clearActions()
    bodies.hideAll()
    setUi({ id, target: null, nearTunnel: false, following: false, scentNearby: false })
  }

  const select = (nextId) => {
    if (action || nextId === id || !VIEWPOINTS[nextId]) return false
    const nextConfig = VIEWPOINTS[nextId]
    const nextMovement = movementFor(nextId)
    const nextState = newState()
    nextState.yaw = state.yaw
    nextState.pitch = clampPitch(nextConfig, nextConfig.camera.startPitch)
    nextMovement.place(nextState, { x: state.position.x, z: state.position.z }, ctxFor(nextConfig))
    if (movement.stopScent) movement.stopScent()
    const next = { id: nextId, movement: nextMovement, state: nextState, params: paramsOf(nextConfig) }
    showLabel(nextConfig)
    setUi({ busy: true, target: nextId })

    if (settings.reducedMotion) {
      hooks.capture()
      finishSwitch(next)
      action = { kind: 'crossfade', t: 0, duration: VIEW_SHARED.crossfadeSeconds }
      return true
    }
    const eye = nextState.position.clone()
    const focus = new THREE.Vector3()
    const shot = new THREE.Vector3()
    framingOf(nextConfig, eye, nextState.yaw, focus, shot)
    // Pull back along your current gaze, by a step sized to your old body.
    camera.getWorldDirection(direction)
    const pulled = camera.position
      .clone()
      .addScaledVector(direction, -config.framing.distance * 0.15)
      .addScaledVector(up, config.framing.distance * 0.04)
    action = {
      kind: 'switch',
      t: 0,
      duration: VIEW_SHARED.transitionSeconds,
      next,
      fromPosition: camera.position.clone(),
      fromQuaternion: camera.quaternion.clone(),
      fromParams: copyParams(params),
      pulled,
      eye,
      eyeQ: eyeQuaternion(nextState, new THREE.Quaternion()),
      focus,
      shot,
      held: orbit(focus, shot, nextConfig.framing.orbit * 0.3, new THREE.Vector3()),
      config: nextConfig,
    }
    return true
  }

  const stepSwitch = (a) => {
    const u = clamp01(a.t / a.duration)
    lerpParams(a.fromParams, a.next.params, smootherstep(u), params)
    const position = camera.position
    if (u < SWITCH.pull) {
      position.lerpVectors(a.fromPosition, a.pulled, ease(stage(u, 0, SWITCH.pull)))
      camera.quaternion.copy(a.fromQuaternion)
    } else if (u < SWITCH.out) {
      const k = ease(stage(u, SWITCH.pull, SWITCH.out))
      dolly(a.focus, a.pulled, a.shot, k, position)
      lookAtQuaternion(position, a.focus, lookQ)
      camera.quaternion.slerpQuaternions(a.fromQuaternion, lookQ, k)
    } else if (u < SWITCH.hold) {
      const k = ease(stage(u, SWITCH.out, SWITCH.hold))
      orbit(a.focus, a.shot, a.config.framing.orbit * 0.3 * k, position)
      lookAtQuaternion(position, a.focus, camera.quaternion)
    } else {
      const k = ease(stage(u, SWITCH.hold, 1))
      dolly(a.focus, a.held, a.eye, k, position)
      lookAtQuaternion(position, a.focus, lookQ)
      camera.quaternion.slerpQuaternions(lookQ, a.eyeQ, k)
    }
    const opacity = stage(u, BODY_IN[0], BODY_IN[1]) * (1 - stage(u, BODY_OUT[0], BODY_OUT[1]))
    bodies.show(a.config.body.model, a.eye, a.next.state.yaw, a.config.body.eye, opacity)
    // Keep clear of the ground, and the near plane inside the body's scale.
    const ground = world.heightAt(position.x, position.z)
    position.y = Math.max(position.y, ground + Math.min(a.config.eyeHeight * 0.5, 0.002))
    params.near = Math.max(Math.min(params.near, position.distanceTo(a.focus) * 0.15), 0.0002)
    return u >= 1
  }

  // --- View body: out to third person, hold, back.
  const viewBody = () => {
    if (action?.kind === 'body') {
      // Pressed again while looking: head back now.
      const [out, hold] = VIEW_SHARED.bodyViewSeconds
      if (action.t < out + hold) action.t = Math.max(action.t, out + hold)
      return true
    }
    if (action) return false
    if (movement.stopScent) movement.stopScent()
    const eye = state.position.clone()
    const focus = new THREE.Vector3()
    const shot = new THREE.Vector3()
    framingOf(config, eye, state.yaw, focus, shot)
    action = {
      kind: 'body',
      t: 0,
      eye,
      eyeQ: eyeQuaternion(state, new THREE.Quaternion()),
      focus,
      shot,
      held: orbit(focus, shot, config.framing.orbit * 0.5, new THREE.Vector3()),
      reduced: settings.reducedMotion,
      jumped: 0,
      fadeFrom: -1,
    }
    if (action.reduced) {
      hooks.capture()
      action.fadeFrom = 0
    }
    setUi({ busy: true, bodyView: true })
    return true
  }

  const stepBody = (a) => {
    const [out, hold, back] = VIEW_SHARED.bodyViewSeconds
    const end = out + hold + back
    const position = camera.position
    let opacity = 1
    if (a.reduced) {
      // Cut out, hold, cut back, each hidden under a short crossfade.
      if (a.t >= out + hold && a.jumped === 0) {
        hooks.capture()
        a.jumped = 1
        a.fadeFrom = a.t
      }
      if (a.jumped === 0) {
        position.copy(a.shot)
        lookAtQuaternion(position, a.focus, camera.quaternion)
      } else {
        position.copy(a.eye)
        camera.quaternion.copy(a.eyeQ)
        opacity = 0
      }
    } else if (a.t < out) {
      const k = ease(a.t / out)
      dolly(a.focus, a.eye, a.shot, k, position)
      lookAtQuaternion(position, a.focus, lookQ)
      camera.quaternion.slerpQuaternions(a.eyeQ, lookQ, k)
      opacity = stage(k, 0.1, 0.5)
    } else if (a.t < out + hold) {
      orbit(a.focus, a.shot, config.framing.orbit * 0.5 * ease((a.t - out) / hold), position)
      lookAtQuaternion(position, a.focus, camera.quaternion)
    } else {
      const k = ease(clamp01((a.t - out - hold) / back))
      dolly(a.focus, a.held, a.eye, k, position)
      lookAtQuaternion(position, a.focus, lookQ)
      camera.quaternion.slerpQuaternions(lookQ, a.eyeQ, k)
      opacity = 1 - stage(k, 0.6, 0.95)
    }
    bodies.show(config.body.model, a.eye, state.yaw, config.body.eye, opacity)
    params.near = Math.max(Math.min(paramsOf(config).near, position.distanceTo(a.focus) * 0.15), 0.0002)
    const done = a.reduced ? a.t >= out + hold + VIEW_SHARED.crossfadeSeconds : a.t >= end
    if (done) {
      params.near = config.camera.near
      bodies.hideAll()
      setUi({ busy: false, bodyView: false })
    }
    return done
  }

  // --- Ant tunnels: fade to dark, come out at the next entrance.
  const enterTunnel = (index) => {
    const exit = antWorld.exitFrom(index)
    if (!exit) return false
    movement.stopScent?.()
    action = { kind: 'tunnel', t: 0, index, exit, moved: false }
    showLabel(config, 'Through the tunnel…')
    setUi({ busy: true })
    return true
  }

  const stepTunnel = (a) => {
    const [down, hold, back] = VIEW_SHARED.tunnelSeconds
    if (!a.moved && a.t >= down) {
      state.yaw = a.exit.yaw
      state.pitch = clampPitch(config, config.camera.startPitch)
      movement.place(state, a.exit, ctxFor(config))
      a.moved = true
    }
    a.dark = a.t < down ? ease(a.t / down) : a.t < down + hold ? 1 : 1 - ease(clamp01((a.t - down - hold) / back))
    const done = a.t >= down + hold + back
    if (done) setUi({ busy: false })
    return done
  }

  // --- Species actions while idle.
  const runPresses = () => {
    for (const name of input.takePresses()) {
      if (!config.actions[name]) continue
      if (name === 'scent' && movement.toggleScent) {
        const wasFollowing = movement.following
        const on = movement.toggleScent(state, ctxFor(config))
        if (on) showHint('Following the scent trail. Move to stop.')
        else if (!wasFollowing) showHint('No scent here. Trails lead out from the ant hill.')
      }
      if (name === 'tunnel') {
        if (nearEntrance >= 0) enterTunnel(nearEntrance)
        else showHint('Find a tunnel entrance on the ant hill.')
      }
    }
  }

  const applyIdlePose = () => {
    camera.position.copy(state.position)
    eyeQuaternion(state, camera.quaternion)
  }

  const embodiment = { id, presence: 0, walk: 0, phase: 0, turn: 0, following: false }
  const frame = {
    anchor,
    viewer: new THREE.Vector3(),
    shadowCenter: new THREE.Vector2(),
    params,
    effects: presetValues('natural'),
    prevMix: 0,
    dark: 0,
    embodiment,
    shadow: null,
  }

  applyIdlePose()

  return {
    input,

    get id() {
      return id
    },
    get busy() {
      return Boolean(action)
    },
    get config() {
      return config
    },

    select,
    viewBody,

    /** Pass on a key; returns true when it was used. */
    key(code, down) {
      if (down && !action) {
        const target = Object.values(VIEWPOINTS).find((v) => v.shortcut === code.replace('Digit', '').replace('Numpad', ''))
        if (target && /^(Digit|Numpad)\d$/.test(code)) {
          select(target.id)
          return true
        }
        if (code === 'KeyV') {
          viewBody()
          return true
        }
      }
      return input.key(code, down, config.actions)
    },

    setSettings(next) {
      Object.assign(settings, next)
    },

    update(dt) {
      time += dt
      const look = input.takeLook(dt, VIEW_SHARED.dragLook, VIEW_SHARED.keyLook)

      if (!action) {
        state.yaw += look.yaw
        state.pitch = clampPitch(config, state.pitch + look.pitch)
        runPresses()
      } else {
        input.takePresses()
      }
      if (!action) {
        info = movement.update(dt, input, state, ctxFor(config))
        applyIdlePose()
      }

      let prevMix = 0
      let dark = 0
      if (action) {
        action.t += dt
        let done = false
        if (action.kind === 'switch') {
          done = stepSwitch(action)
          if (done) {
            finishSwitch(action.next)
            applyIdlePose()
          }
        } else if (action.kind === 'crossfade') {
          prevMix = 1 - ease(clamp01(action.t / action.duration))
          applyIdlePose()
          done = action.t >= action.duration
        } else if (action.kind === 'body') {
          done = stepBody(action)
          if (action.fadeFrom >= 0) prevMix = 1 - ease(clamp01((action.t - action.fadeFrom) / VIEW_SHARED.crossfadeSeconds))
          if (done) applyIdlePose()
        } else if (action.kind === 'tunnel') {
          done = stepTunnel(action)
          dark = action.dark
          applyIdlePose()
        }
        // Never leave the camera somewhere invalid.
        if (!Number.isFinite(camera.position.x + camera.position.y + camera.position.z)) {
          if (action.kind === 'switch') finishSwitch(action.next)
          done = true
          applyIdlePose()
        }
        if (done) {
          action = null
          bodies.hideAll()
          setUi({ busy: false })
        }
        info = { moving: false, turn: 0 }
      }

      // Lens.
      if (camera.fov !== params.fov || camera.near !== params.near || camera.far !== params.far) {
        camera.fov = params.fov
        camera.near = params.near
        camera.far = params.far
        camera.updateProjectionMatrix()
      }
      camera.updateMatrixWorld()

      // Detail streams around the ground you're looking at (up to
      // streamAhead in front of you).
      camera.getWorldDirection(direction)
      const ground = world.heightAt(camera.position.x, camera.position.z)
      const altitude = Math.max(camera.position.y - ground, 0)
      const flat = Math.hypot(direction.x, direction.z)
      let ahead = direction.y < -0.02 ? (altitude * flat) / -direction.y : params.streamAhead
      ahead = Math.min(ahead, params.streamAhead)
      const targetX = camera.position.x + (flat > 1e-4 ? (direction.x / flat) * ahead : 0)
      const targetZ = camera.position.z + (flat > 1e-4 ? (direction.z / flat) * ahead : 0)
      if (!anchorReady) {
        anchor.x = targetX
        anchor.z = targetZ
        anchorReady = true
      } else {
        // Ease toward the target, but no faster than tiles can stream in.
        const k = smooth(4, dt)
        let dx = (targetX - anchor.x) * k
        let dz = (targetZ - anchor.z) * k
        const step = Math.hypot(dx, dz)
        const limit = ANCHOR_SPEED * dt
        if (step > limit) {
          dx *= limit / step
          dz *= limit / step
        }
        anchor.x += dx
        anchor.z += dz
      }
      anchor.y = world.heightAt(anchor.x, anchor.z)
      const viewer = action ? camera.position : state.position
      frame.viewer.copy(viewer)
      frame.shadowCenter.set((viewer.x + anchor.x) / 2, (viewer.z + anchor.z) / 2)

      // Vision: the blended preset, with the compound eye switchable.
      frame.effects.saturation = params.effects.saturation
      frame.effects.contrast = params.effects.contrast
      frame.effects.tint[0] = params.effects.tint[0]
      frame.effects.tint[1] = params.effects.tint[1]
      frame.effects.tint[2] = params.effects.tint[2]
      frame.effects.uv = params.effects.uv
      frame.effects.vignette = params.effects.vignette
      frame.effects.compound = settings.compoundEye ? params.effects.compound : 0
      frame.prevMix = prevMix
      frame.dark = dark

      // Embodiment cues fade in once you're settled in the new body.
      embodiment.id = id
      embodiment.presence += ((action ? 0 : 1) - embodiment.presence) * smooth(action ? 12 : 3, dt)
      embodiment.walk += ((info.moving ? 1 : 0) - embodiment.walk) * smooth(3, dt)
      embodiment.phase = info.phase ?? embodiment.phase
      embodiment.turn += ((info.turn ?? 0) - embodiment.turn) * smooth(5, dt)
      embodiment.following = Boolean(info.following)
      embodiment.motion = settings.motionEffects
      // The walker's own shadow, while standing in the human body.
      frame.shadow = !action && config.embodiment === 'hands' ? state : null

      // Contextual UI (ant): near an entrance, on a trail.
      uiCheck -= dt
      if (uiCheck <= 0) {
        uiCheck = UI_CHECK_SECONDS
        nearEntrance = -1
        let scentNearby = false
        if (!action && config.actions.tunnel) {
          const near = antWorld.nearestEntrance(state.position.x, state.position.z)
          if (near && near.distance < config.movement.tunnelReach) nearEntrance = near.index
        }
        if (!action && config.actions.scent) {
          const near = antWorld.nearestTrail(state.position.x, state.position.z)
          scentNearby = Boolean(near && near.distance < config.movement.scentReach)
        }
        setUi({ nearTunnel: nearEntrance >= 0, following: Boolean(movement.following), scentNearby })
        if (ui.hint && time > hintUntil) setUi({ hint: '' })
      }
      frame.nearEntrance = nearEntrance
      bodies.setShadow(frame.shadow ? state.position : null, state.yaw, config.body.eye)
      bodies.animate(time)

      if (uiDirty) {
        uiDirty = false
        hooks.onUi({ ...ui })
      }
      return frame
    },

    /** For checks in development: stand at (x, z) facing yaw. */
    teleport(x, z, yaw = state.yaw) {
      if (action) return false
      state.yaw = yaw
      movement.place(state, { x, z }, ctxFor(config))
      applyIdlePose()
      return true
    },

    /** For checks in development: the viewer and camera right now. */
    debug() {
      return {
        id,
        busy: Boolean(action),
        action: action?.kind ?? null,
        eye: state.position.toArray(),
        camera: camera.position.toArray(),
        fov: camera.fov,
        near: camera.near,
        ground: world.heightAt(state.position.x, state.position.z),
        surface: world.surfaceAt(state.position.x, state.position.z),
        yaw: state.yaw,
        pitch: state.pitch,
        following: Boolean(movement.following),
      }
    },
  }
}
