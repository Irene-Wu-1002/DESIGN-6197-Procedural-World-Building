import * as THREE from 'three'
import { createChaseCamera } from './chaseCamera'
import { createViewInput } from './input'
import { createCrawlMovement } from './movement/crawl'
import { createFlightMovement } from './movement/flight'
import { createOrbitMovement } from './movement/orbit'
import { lerpPreset, presetValues } from './viewEffects'
import { VIEWPOINTS, VIEW_SHARED, switchLabelOf } from './viewpointConfig'

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
 * - A viewpoint can have camera modes (`views`): the butterfly flies with a
 *   third-person chase camera by default (chaseCamera.js), its body banking
 *   and beating its wings in view, with the eye view as an option (V).
 * - Switching to the free camera (no body) pulls back out to its orbit
 *   while the body you leave fades where it stood.
 * - "View body" (out to third person and back) and the ant's tunnels use
 *   the same machinery.
 * - Each frame returns what the scene needs: where to stream detail, the
 *   blended visual parameters, and embodiment cues for the overlays.
 *
 * It never touches the generated world: the scene reads `anchor` from the
 * frame and streams around it exactly as before.
 */

const MOVEMENTS = { orbit: createOrbitMovement, flight: createFlightMovement, crawl: createCrawlMovement }

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
// How far a double-click looks for the ground (m).
const FOCUS_REACH = 12
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
// A viewpoint's starting camera mode ('eye' unless it has `views`).
const modeOf = (forConfig) => forConfig.views?.default ?? 'eye'
// Eye view ↔ chase view (s).
const MODE_SECONDS = 0.6

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
  // underground: the X-ray view lets the free camera go below the surface
  // (active) and lowers its orbit point by depth (m).
  const settings = {
    compoundEye: true,
    motionEffects: true,
    reducedMotion: false,
    underground: { active: false, depth: 0 },
  }

  let id = start.id
  let config = VIEWPOINTS[id]
  let movement = movementFor(id)
  let state = newState()
  const params = paramsOf(config)
  const ctxFor = (forConfig) => ({
    config: forConfig,
    world,
    motion: settings.motionEffects,
    antWorld,
    underground: settings.underground,
  })

  state.yaw = start.yaw
  state.pitch = start.pitch ?? config.camera.startPitch
  movement.place(state, start, ctxFor(config))

  // Camera mode of the current viewpoint, and the chase camera it may use.
  const chase = createChaseCamera(world)
  let mode = modeOf(config)
  if (mode === 'chase') chase.reset(config.chase)
  // The body as seen in chase view: bank and nose tilt (radians).
  const bodyPose = { roll: 0, pitch: 0 }
  const chaseCenter = new THREE.Vector3()

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
  const raycaster = new THREE.Raycaster()
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
  // The body's centre for a viewer state (the eye sits `body.eye` ahead).
  const centerOf = (s, forConfig, out) => {
    const [forward, height] = forConfig.body.eye
    return out.set(s.position.x + Math.sin(s.yaw) * forward, s.position.y - height, s.position.z + Math.cos(s.yaw) * forward)
  }
  // Underground, the free camera may also look up (at roots from below).
  const UNDERGROUND_PITCH_MAX = 1.2
  const clampPitch = (forConfig, pitch) => {
    const [low, high] = forConfig.camera.pitchLimits
    const up = settings.underground.active && forConfig.movement.type === 'orbit' ? UNDERGROUND_PITCH_MAX : high
    return Math.min(Math.max(pitch, low), up)
  }

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
    cameraMode: config.views ? mode : null,
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
    setUi({ label: text ?? switchLabelOf(forConfig), labelId: ui.labelId + 1 })

  // --- Switching viewpoints.
  const finishSwitch = (next) => {
    id = next.id
    config = VIEWPOINTS[id]
    movement = next.movement
    state = next.state
    Object.assign(params, copyParams(next.params))
    input.clearActions()
    bodies.hideAll()
    mode = modeOf(config)
    if (mode === 'chase') chase.reset(config.chase)
    bodyPose.roll = 0
    bodyPose.pitch = 0
    setUi({
      id,
      target: null,
      nearTunnel: false,
      following: false,
      scentNearby: false,
      cameraMode: config.views ? mode : null,
    })
  }

  // Where you are: the free camera's focus, or your body's eye.
  const here = () => (movement.anchor ? movement.anchor() : state.position)

  const select = (nextId) => {
    if (action || nextId === id || !VIEWPOINTS[nextId]) return false
    const nextConfig = VIEWPOINTS[nextId]
    const nextMovement = movementFor(nextId)
    const nextState = newState()
    nextState.yaw = state.yaw
    nextState.pitch = clampPitch(nextConfig, nextConfig.camera.startPitch)
    const spot = here()
    nextMovement.place(nextState, { x: spot.x, z: spot.z }, ctxFor(nextConfig))
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
    // Pull back along your current gaze, by a step sized to your old body.
    camera.getWorldDirection(direction)
    const pulled = camera.position
      .clone()
      .addScaledVector(direction, -config.framing.distance * 0.15)
      .addScaledVector(up, config.framing.distance * 0.04)
    if (!nextConfig.body) {
      // To the free camera: out to its orbit, around the spot you stood on;
      // the body you leave stays a moment, for scale, and fades.
      action = {
        kind: 'release',
        t: 0,
        duration: VIEW_SHARED.transitionSeconds * 0.8,
        next,
        fromQuaternion: camera.quaternion.clone(),
        fromPosition: camera.position.clone(),
        fromParams: copyParams(params),
        pulled,
        eye,
        eyeQ: eyeQuaternion(nextState, new THREE.Quaternion()),
        focus: nextMovement.anchor().clone(),
        leaving: config.body
          ? { model: config.body.model, eye: state.position.clone(), yaw: state.yaw, offset: config.body.eye, pose: { ...bodyPose } }
          : null,
      }
      return true
    }
    const focus = new THREE.Vector3()
    const shot = new THREE.Vector3()
    framingOf(nextConfig, eye, nextState.yaw, focus, shot)
    const toChase = modeOf(nextConfig) === 'chase'
    const endPosition = eye.clone()
    const endQuaternion = eyeQuaternion(nextState, new THREE.Quaternion())
    if (toChase) {
      chase.reset(nextConfig.chase)
      chase.pose(centerOf(nextState, nextConfig, new THREE.Vector3()), nextState.yaw, nextConfig.chase, endPosition, endQuaternion)
    }
    action = {
      kind: 'switch',
      endPosition,
      endQuaternion,
      keepBody: toChase,
      leaving:
        mode === 'chase'
          ? { model: config.body.model, eye: state.position.clone(), yaw: state.yaw, offset: config.body.eye, pose: { ...bodyPose } }
          : null,
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
      dolly(a.focus, a.held, a.endPosition, k, position)
      lookAtQuaternion(position, a.focus, lookQ)
      camera.quaternion.slerpQuaternions(lookQ, a.endQuaternion, k)
    }
    // A chase-view body stays in view; an eye-view body fades as you enter it.
    const opacity = stage(u, BODY_IN[0], BODY_IN[1]) * (a.keepBody ? 1 : 1 - stage(u, BODY_OUT[0], BODY_OUT[1]))
    bodies.show(a.config.body.model, a.eye, a.next.state.yaw, a.config.body.eye, opacity)
    if (a.leaving) {
      const { model, eye, yaw, offset, pose } = a.leaving
      bodies.show(model, eye, yaw, offset, 1 - stage(u, 0.25, 0.6), pose)
    }
    // Keep clear of the ground, and the near plane inside the body's scale.
    const ground = world.heightAt(position.x, position.z)
    position.y = Math.max(position.y, ground + Math.min(a.config.eyeHeight * 0.5, 0.002))
    params.near = Math.max(Math.min(params.near, position.distanceTo(a.focus) * 0.15), 0.0002)
    return u >= 1
  }

  const stepRelease = (a) => {
    const u = clamp01(a.t / a.duration)
    lerpParams(a.fromParams, a.next.params, smootherstep(u), params)
    const position = camera.position
    const pull = SWITCH.pull * 1.2
    if (u < pull) {
      position.lerpVectors(a.fromPosition, a.pulled, ease(stage(u, 0, pull)))
      camera.quaternion.copy(a.fromQuaternion)
    } else {
      const k = ease(stage(u, pull, 1))
      dolly(a.focus, a.pulled, a.eye, k, position)
      lookAtQuaternion(position, a.focus, lookQ)
      camera.quaternion.slerpQuaternions(a.fromQuaternion, lookQ, k)
      // Settle on the orbit's own angle (it may sit higher over bumps).
      camera.quaternion.slerp(a.eyeQ, stage(u, 0.85, 1))
    }
    if (a.leaving) {
      bodies.show(a.leaving.model, a.leaving.eye, a.leaving.yaw, a.leaving.offset, 1 - stage(u, 0.5, 0.95), a.leaving.pose)
    }
    position.y = Math.max(position.y, world.heightAt(position.x, position.z) + 0.002)
    params.near = Math.max(Math.min(params.near, position.distanceTo(a.focus) * 0.05), 0.0002)
    return u >= 1
  }

  // --- Eye view ↔ chase view (viewpoints with both modes).
  const toggleMode = () => {
    if (action) return false
    const next = mode === 'chase' ? 'eye' : 'chase'
    showLabel(config, `${config.label} · ${next === 'chase' ? 'chase view' : 'eye view'}`)
    setUi({ busy: true })
    if (next === 'chase') chase.recenter(config.chase)
    if (settings.reducedMotion) {
      hooks.capture()
      mode = next
      applyIdlePose()
      action = { kind: 'crossfade', t: 0, duration: VIEW_SHARED.crossfadeSeconds }
      setUi({ cameraMode: mode })
      return true
    }
    const toPosition = new THREE.Vector3()
    const toQuaternion = new THREE.Quaternion()
    if (next === 'chase') {
      chase.pose(centerOf(state, config, chaseCenter), state.yaw, config.chase, toPosition, toQuaternion)
    } else {
      toPosition.copy(state.position)
      eyeQuaternion(state, toQuaternion)
    }
    action = {
      kind: 'mode',
      t: 0,
      to: next,
      fromPosition: camera.position.clone(),
      fromQuaternion: camera.quaternion.clone(),
      toPosition,
      toQuaternion,
    }
    return true
  }

  const stepMode = (a) => {
    const u = clamp01(a.t / MODE_SECONDS)
    const k = ease(u)
    camera.position.lerpVectors(a.fromPosition, a.toPosition, k)
    camera.quaternion.slerpQuaternions(a.fromQuaternion, a.toQuaternion, k)
    // The body leaves view as you enter the eye, and appears as you leave it.
    const opacity = a.to === 'eye' ? 1 - stage(u, 0.6, 0.95) : stage(u, 0.05, 0.4)
    bodies.show(config.body.model, state.position, state.yaw, config.body.eye, opacity, bodyPose)
    if (u >= 1) {
      mode = a.to
      setUi({ cameraMode: mode })
      return true
    }
    return false
  }

  // --- View body: out to third person, hold, back.
  const viewBody = () => {
    if (config.views?.modes?.length > 1) return toggleMode()
    if (action?.kind === 'body') {
      // Pressed again while looking: head back now.
      const [out, hold] = VIEW_SHARED.bodyViewSeconds
      if (action.t < out + hold) action.t = Math.max(action.t, out + hold)
      return true
    }
    if (action || !config.body) return false
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

  // The camera for the current mode: the eye, or the chase camera (which
  // follows on springs unless snapped).
  const applyIdlePose = (dt = 0, snap = true) => {
    if (mode === 'chase') {
      chase.update(dt, {
        center: centerOf(state, config, chaseCenter),
        heading: state.yaw,
        moving: info.moving,
        settings: config.chase,
        camera,
        snap,
      })
      return
    }
    camera.position.copy(state.position)
    eyeQuaternion(state, camera.quaternion)
  }

  const embodiment = { id, presence: 0, turn: 0, following: false }
  const frame = {
    anchor,
    // Detail rings, in tiles added to the Detail distance setting.
    lod: { near: 0, middle: 0 },
    viewer: new THREE.Vector3(),
    shadowCenter: new THREE.Vector2(),
    params,
    effects: presetValues('natural'),
    prevMix: 0,
    dark: 0,
    embodiment,
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
        // In chase view, dragging swings the camera around the body.
        if (mode === 'chase') chase.look(look.yaw, look.pitch, config.chase)
        else {
          state.yaw += look.yaw
          state.pitch = clampPitch(config, state.pitch + look.pitch)
        }
        runPresses()
      } else {
        input.takePresses()
      }
      // Pan drags only move the free camera; drop them anywhere else. The
      // wheel zooms the free camera or the chase camera; elsewhere it's dropped.
      if (action || !movement.setFocus) input.takePan()
      if (!action && mode === 'chase') chase.zoom(input.takeZoom(dt, config.chase.zoomRate), config.chase)
      else if (action || !movement.setFocus) input.takeZoom(dt, 0)
      if (!action) {
        info = movement.update(dt, input, state, ctxFor(config))
        applyIdlePose(dt, false)
      }

      let prevMix = 0
      let dark = 0
      if (action) {
        action.t += dt
        let done = false
        if (action.kind === 'switch' || action.kind === 'release') {
          done = action.kind === 'switch' ? stepSwitch(action) : stepRelease(action)
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
        } else if (action.kind === 'mode') {
          done = stepMode(action)
          if (done) applyIdlePose()
        }
        // Never leave the camera somewhere invalid.
        if (!Number.isFinite(camera.position.x + camera.position.y + camera.position.z)) {
          if (action.kind === 'switch' || action.kind === 'release') finishSwitch(action.next)
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

      // Lens (the free camera's near plane follows its zoom).
      if (!action && movement.near) params.near = movement.near()
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
      // The free camera always looks at its focus: stream right there.
      const focus = !action && movement.anchor ? movement.anchor() : null
      const targetX = focus ? focus.x : camera.position.x + (flat > 1e-4 ? (direction.x / flat) * ahead : 0)
      const targetZ = focus ? focus.z : camera.position.z + (flat > 1e-4 ? (direction.z / flat) * ahead : 0)
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
      // Where you are (status, shadows): the focus, or your eye.
      const viewer = action ? camera.position : focus ?? state.position
      frame.viewer.copy(viewer)
      if (focus) frame.shadowCenter.set(anchor.x, anchor.z)
      else frame.shadowCenter.set((viewer.x + anchor.x) / 2, (viewer.z + anchor.z) / 2)

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
      // (None in chase view: there the real body is on screen.)
      const present = !action && mode !== 'chase'
      embodiment.presence += ((present ? 1 : 0) - embodiment.presence) * smooth(present ? 3 : 12, dt)
      embodiment.turn += ((info.turn ?? 0) - embodiment.turn) * smooth(5, dt)
      embodiment.following = Boolean(info.following)
      embodiment.motion = settings.motionEffects

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
      // Detail rings to stream: the viewpoint you're in, or heading into, so
      // tiles start filling in during a switch.
      const lodConfig = action?.next ? VIEWPOINTS[action.next.id] : config
      const lod = lodConfig.lod ?? { near: 0, middle: 0 }
      let middle = lod.middle
      if (Array.isArray(middle)) {
        const zoom = lodConfig === config && typeof movement.distance === 'number' ? movement.distance : lod.zoom[1]
        const t = clamp01((zoom - lod.zoom[0]) / (lod.zoom[1] - lod.zoom[0]))
        middle = Math.round(middle[0] + (middle[1] - middle[0]) * t)
      }
      frame.lod.near = lod.near
      frame.lod.middle = Math.max(middle, lod.near)
      // The body in chase view: bank into turns, tip with climbs, and beat
      // faster climbing or glide sinking.
      if (!action && mode === 'chase') {
        const k = smooth(4, dt)
        bodyPose.roll += ((info.turn ?? 0) * config.pose.bank - bodyPose.roll) * k
        bodyPose.pitch += ((info.climb ?? 0) * config.pose.climbTilt - bodyPose.pitch) * k
        bodies.show(config.body.model, state.position, state.yaw, config.body.eye, 1, bodyPose)
        const climb = info.climb ?? 0
        bodies.setWingBeat(climb < -0.3 ? 0.35 : 1 + 0.6 * Math.max(climb, 0))
      } else {
        bodies.setWingBeat(1)
      }
      bodies.animate(time)

      if (uiDirty) {
        uiDirty = false
        hooks.onUi({ ...ui })
      }
      return frame
    },

    /**
     * Free camera only: glide the focus to the ground under a screen point
     * (x, y in -1–1). Marches along the view ray until it meets the ground.
     */
    focusAt(x, y) {
      if (action || !movement.setFocus) return false
      raycaster.setFromCamera({ x, y }, camera)
      const { origin, direction: ray } = raycaster.ray
      let t = camera.near
      let step = Math.max((origin.y - world.heightAt(origin.x, origin.z)) * 0.01, 0.0005)
      const point = new THREE.Vector3()
      while (t < FOCUS_REACH) {
        point.copy(origin).addScaledVector(ray, t)
        if (point.y <= world.heightAt(point.x, point.z)) {
          movement.setFocus(point.x, point.z)
          return true
        }
        t += step
        step *= 1.02
      }
      return false
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
        focus: movement.anchor ? movement.anchor().toArray() : null,
        mode,
        bodyPose: { ...bodyPose },
        chaseDistance: mode === 'chase' ? chase.distance : null,
      }
    },
  }
}
