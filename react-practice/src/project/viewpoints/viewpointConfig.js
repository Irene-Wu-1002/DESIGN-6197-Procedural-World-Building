/**
 * Viewpoints: the same forest floor through three bodies. Everything that
 * differs between them lives here as data; the controller
 * (viewController.js) and the movement strategies (movement/) read it, so a
 * new viewpoint is a new entry plus, at most, a new movement type.
 *
 * Units are metres, radians, and seconds. The camera looks along -z at
 * yaw 0; pitch is negative looking down.
 *
 *   camera       fov (deg), near/far planes, start pitch, pitch limits
 *   haze         multiplies the Haze setting's fog density; `min` keeps the
 *                end of the world (12 m) hidden from high eyes
 *   streamAhead  how far ahead along your gaze the detailed ground centres
 *   shadowReach  half-size of the sun's shadow box (m)
 *   movement     type ('walk' | 'flight' | 'crawl') and its parameters
 *   collision    radius and which obstacles block you
 *   effects      post-processing preset (viewEffects.js)
 *   perception   what this body notices: scent trails, ultraviolet,
 *                air currents, spores (0–1, or a size boost for spores)
 *   body         model shown during transitions (bodies.js) and where its
 *                eye sits relative to its feet ([forward, up])
 *   embodiment   first-person cue (Embodiment.jsx)
 *   framing      third-person shot used to reveal the body
 *   actions      species actions: key, label, and mode (hold: while
 *                pressed; toggle; press: once; `when` limits a contextual
 *                action to a UI state flag)
 *   controls     instruction lines (keyboard and mouse)
 */

export const VIEWPOINT_ORDER = ['human', 'butterfly', 'ant']

export const VIEWPOINTS = {
  human: {
    id: 'human',
    label: 'Human',
    shortcut: '1',
    eyeHeight: 1.7,
    eyeHeightLabel: '1.7 m',
    description:
      'Upright, three-colour vision at walking pace. The forest floor is a small patch of ground at your feet: the clearest overview.',
    camera: { fov: 60, near: 0.01, far: 30, startPitch: -0.85, pitchLimits: [-1.4, 0.7] },
    haze: { scale: 0.6, min: 0.19 },
    streamAhead: 1.6,
    shadowReach: 1.2,
    movement: { type: 'walk', speed: 1.1, runFactor: 2, bob: 0.008, stride: 1.7 },
    collision: { radius: 0.25, trunks: true, flyAgaric: false, mushrooms: false },
    effects: 'natural',
    perception: { scent: 0, uv: 0, air: 0, spores: 1 },
    body: { model: 'human', eye: [0.09, 1.7] },
    embodiment: 'hands',
    framing: { distance: 3.2, elevation: 0.32, lookUp: 0.95, orbit: 0.5 },
    actions: {},
    controls: [
      ['Move', 'W A S D'],
      ['Run', 'Shift'],
      ['Look', 'Drag or arrow keys'],
    ],
  },

  butterfly: {
    id: 'butterfly',
    label: 'Butterfly',
    shortcut: '2',
    eyeHeight: 0.6,
    eyeHeightLabel: '≈ 60 cm, flying',
    description:
      'Flies above the plants and sees into the ultraviolet: flowers show their nectar guides, spores and air currents stand out.',
    camera: { fov: 72, near: 0.004, far: 30, startPitch: -0.45, pitchLimits: [-1.2, 0.5] },
    haze: { scale: 0.8, min: 0.19 },
    streamAhead: 1.2,
    shadowReach: 0.9,
    movement: {
      type: 'flight',
      speed: 0.7,
      runFactor: 2,
      turnRate: 1.1,
      climbRate: 0.35,
      minClearance: 0.13,
      maxAltitude: 2.5,
      bank: 0.2,
      flutter: 0.002,
    },
    collision: { radius: 0.06, trunks: true, flyAgaric: true, mushrooms: false },
    effects: 'ultraviolet',
    perception: { scent: 0, uv: 1, air: 1, spores: 2.6 },
    body: { model: 'butterfly', eye: [0.012, 0.0] },
    embodiment: 'wings',
    framing: { distance: 0.2, elevation: 0.4, lookUp: 0, orbit: 0.6 },
    actions: {
      rise: { label: 'Rise', key: 'Space', mode: 'hold' },
      sink: { label: 'Sink', key: 'KeyC', mode: 'hold' },
    },
    controls: [
      ['Fly', 'W / S'],
      ['Turn', 'A / D'],
      ['Rise / sink', 'Space / C'],
      ['Look', 'Drag'],
    ],
  },

  ant: {
    id: 'ant',
    label: 'Ant',
    shortcut: '3',
    eyeHeight: 0.004,
    eyeHeightLabel: '4 mm',
    description:
      'A ground-level view with compound vision. Pebbles are boulders, the fly agaric a tower, and scent trails lead home.',
    camera: { fov: 95, near: 0.0003, far: 30, startPitch: 0.08, pitchLimits: [-0.9, 1.1] },
    haze: { scale: 1, min: 0 },
    streamAhead: 0.12,
    shadowReach: 0.6,
    movement: { type: 'crawl', speed: 0.03, runFactor: 3, tilt: 0.55, scentReach: 0.02, tunnelReach: 0.014 },
    collision: { radius: 0.003, trunks: true, flyAgaric: true, mushrooms: true },
    effects: 'compound',
    perception: { scent: 1, uv: 0, air: 0, spores: 1 },
    body: { model: 'ant', eye: [0.0046, 0.004] },
    embodiment: 'antennae',
    framing: { distance: 0.03, elevation: 0.42, lookUp: 0.002, orbit: 0.7 },
    actions: {
      scent: { label: 'Follow scent', key: 'Space', mode: 'toggle' },
      tunnel: { label: 'Enter tunnel', key: 'KeyE', mode: 'press', when: 'nearTunnel' },
    },
    controls: [
      ['Move', 'W A S D'],
      ['Look', 'Drag'],
      ['Follow scent', 'Space'],
      ['Enter tunnel', 'E'],
    ],
  },
}

/** Shared by every viewpoint. */
export const VIEW_SHARED = {
  // Look sensitivity (rad per pixel dragged) and arrow-key look speed.
  dragLook: 0.0042,
  keyLook: 1.5,
  // Switching: full camera move, or a crossfade with reduced motion.
  transitionSeconds: 1.7,
  crossfadeSeconds: 0.35,
  // "View body": out, hold, back.
  bodyViewSeconds: [0.8, 1.8, 0.8],
  // Tunnel: fade to dark, stay, fade back.
  tunnelSeconds: [0.45, 0.35, 0.55],
}

export const DEFAULT_PERCEPTION_SETTINGS = {
  compoundEye: true,
  motionEffects: true,
}
