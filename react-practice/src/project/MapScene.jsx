import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import MapPanel from './MapPanel'
import { DEFAULT_COVER } from './cover/coverRules'
import { createCoverRenderer, createTrunkRenderer, trunkGround } from './cover/coverRenderer'
import { DEFAULT_CROWNS, createCrownRenderer } from './cover/crowns'
import { createFlowerField } from './cover/flowerField'
import { agaricSpot, createFlyAgaric } from './cover/flyAgaric'
import { createLeafField } from './cover/leafField'
import { createMossField } from './cover/mossField'
import { scatterTile } from './cover/scatterTile'
import { FOREST_COLORS, createForestSky } from './forest/sky'
import { createDistantForest } from './forest/distantForest'
import { installCanopyLight, setCanopyLight } from './forest/canopyLight'
import { DEFAULT_HABITAT, sunDirectionOf } from './habitat/habitatFields'
import { DEFAULT_PATHS, createAntTrail } from './paths/antTrail'
import { createExclusions } from './paths/exclusionZones'
import SimulationPanel from './simulation/SimulationPanel'
import { createAmbientLife } from './simulation/ambientLife'
import { HeightFog, installHeightFog } from './simulation/heightFog'
import { createRain } from './simulation/rain'
import { DEFAULT_WEATHER } from './simulation/weather'
import { DEFAULT_SEASON } from './simulation/season'
import { DEFAULT_DAY } from './simulation/dayCycle'
import { createSimulation } from './simulation/simulation'
import { createFarGround, morphRange } from './terrain/farGround'
import { DEFAULT_GROUND } from './terrain/heightField'
import { createGroundMaterial } from './terrain/groundMaterial'
import { createTileManager } from './terrain/tiles'
import { createRootRenderer } from './underground/rootRenderer'
import { DEFAULT_UNDERGROUND, ROOT_KEYS, UNDERGROUND_VIEWS, WATER_KEYS } from './underground/settings'
import { createWaterRenderer } from './underground/waterRenderer'
import { createTreeWater } from './underground/treeWater'
import { createSapFlow } from './underground/sapFlow'
import { DEFAULT_WATER } from './underground/water'
import { createCrossSection } from './underground/crossSection'
import { createXray } from './underground/xray'
import Embodiment from './viewpoints/Embodiment'
import ViewAsPanel from './viewpoints/ViewAsPanel'
import { createAirLayer } from './viewpoints/airLayer'
import { createAntWorld } from './viewpoints/antWorld'
import { createAntColony } from './ants/antColony'
import { createBodies } from './viewpoints/bodies'
import { createViewController } from './viewpoints/viewController'
import { createViewEffects } from './viewpoints/viewEffects'
import { DEFAULT_PERCEPTION_SETTINGS, VIEWPOINTS, summaryOf } from './viewpoints/viewpointConfig'
import { createWorldQueries } from './viewpoints/worldQueries'
import './viewpoints/viewpoints.css'

/**
 * Project > Map: the endless forest floor at real scale (metres), in a dim
 * forest, seen with a free camera or through a body (VIEW AS: free,
 * butterfly, ant). The viewpoint controller (viewpoints/) owns the camera
 * and the viewer; detailed tiles stream in around the ground you're looking at, a
 * coarse far ground continues to the horizon, and haze in the sky's horizon
 * colour hides where it ends. Switching bodies never touches the world:
 * the same tiles, cover, and landmarks are seen through a different camera,
 * movement, and vision.
 */

// haze and dapple are 0–100 (%).
// distance: tiles loaded around you (detail fades out toward the edge).
// The canopy's leaf layer (for sun flecks), this far (m) above where crowns start.
const CANOPY_ABOVE_CROWN_START = 1.9
const DEFAULT_VIEW = { distance: 4, preview: 'off', haze: 50, dapple: 80 }
// Exponential fog density (per metre) at 0% and 100% haze. At 50% the haze
// is half-way to the sky colour about 3 m away and complete by ~10 m, well
// before the far ground ends. Each viewpoint scales it (viewpointConfig.js).
const HAZE_DENSITY = [0.12, 0.45]
const hazeDensity = (haze) => HAZE_DENSITY[0] + (HAZE_DENSITY[1] - HAZE_DENSITY[0]) * (haze / 100)
// Start with the free camera looking at the ant hill (at the world origin)
// and the fly agaric from 65 cm away.
const START_VIEW = 'free'
const START = { distance: 0.65, yaw: 0, pitch: -0.7 }
// The sun sits this far (m) from the area you see, toward the habitat's sun
// direction; shadows only cover the area near it (the half-size comes from
// the viewpoint; the sun moves back to match).
const SUN_DISTANCE = 1.5
// Habitat, ground-cover and path changes wait until the controls have been
// still this long (ms).
const SETTLE_MS = 300
// How long Paths > Show exclusion zones paints them (ms).
const ZONE_FLASH_MS = 5000
const SHADOW_BASE = { reach: 0.6, far: 4 }
const BUILD_BUDGET_MS = 6
const STATUS_REFRESH_MS = 250
const MAX_FRAME = 0.1
// Frame pacing, to spare the battery: up to ACTIVE_FPS while the camera
// moves or something is being changed, AMBIENT_FPS once everything has been
// still for IDLE_AFTER_MS (the ants, wind and spores keep moving, just drawn
// less often). On a 120 Hz display the browser offers twice as many frames.
const ACTIVE_FPS = 60
const AMBIENT_FPS = 30
const IDLE_AFTER_MS = 1500
// Frame callbacks arrive a little early or late; take one this much (ms)
// before its slot rather than wait a whole extra frame.
const FRAME_SLACK_MS = 2
// The shadow map is redrawn when the sun or its shadow box moves (more than
// this, m) or the ground changes, and otherwise at SHADOW_FPS for the
// casters that move on their own (ants, swaying cover, growing crowns).
const SHADOW_MOVE = 1e-4
const SHADOW_FPS = 15
// The camera counts as moving above this much (m, and quaternion dot).
const CAMERA_STILL = { move: 1e-6, turn: 1e-9 }
// Small cover shrinks away just as the ground starts to smooth (m, relative
// to the start of the morph band).
const COVER_FADE = [-0.06, 0.1]

// Fog that thins with height (the simulation's ground mist).
installHeightFog()
installCanopyLight()

const isTyping = (event) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const sunScaleFor = (reach) => Math.max(1, (reach / SHADOW_BASE.reach) * 1.5)
// Settings with just these keys put back to their defaults (the panel's
// per-tab and per-element resets).
const withDefaults = (current, defaults, keys) => ({
  ...current,
  ...Object.fromEntries(keys.map((key) => [key, defaults[key]])),
})
const sunOffsetOf = (habitat, out = new THREE.Vector3()) =>
  out.fromArray(sunDirectionOf(habitat)).multiplyScalar(SUN_DISTANCE)

/** `value`, but only once it has stopped changing for `delay` ms. */
function useDebounced(value, delay) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return settled
}

export default function MapScene({ intro }) {
  const mountRef = useRef(null)
  const tilesRef = useRef(null)
  // Ground shader uniforms (grain, wetness).
  const groundUniformsRef = useRef(null)
  const viewRef = useRef(DEFAULT_VIEW)
  // The current viewpoint's id, for the key handler.
  const viewIdRef = useRef(START_VIEW)
  const flyAgaricRef = useRef(null)
  const antWorldRef = useRef(null)
  const antColonyRef = useRef(null)
  const farGroundRef = useRef(null)
  // Where the sun light sits relative to the area you see.
  const sunOffsetRef = useRef(sunOffsetOf(DEFAULT_HABITAT))
  const controllerRef = useRef(null)
  const overlayRef = useRef(null)
  const xrayRef = useRef(null)
  const crossSectionRef = useRef(null)
  const distantForestRef = useRef(null)
  const treeWaterRef = useRef(null)
  // What the roots are grown from (the settled Underground settings).
  const rootSettingsRef = useRef(DEFAULT_UNDERGROUND)
  // The water in the ground: its settings and the Habitat wetness.
  const waterSettingsRef = useRef({ ...DEFAULT_WATER, wetness: DEFAULT_HABITAT.wetness })
  const crownSettingsRef = useRef(DEFAULT_CROWNS)
  // What the tile listener needs to scatter a new tile (moss, flowers: the
  // moss patch and flower colony fields, built from the settled settings
  // below).
  const coverContextRef = useRef({
    cover: DEFAULT_COVER,
    seed: DEFAULT_GROUND.seed,
    moss: null,
    flowers: null,
    leaves: null,
    exclusions: null,
    landmarks: null,
  })
  const [ground, setGround] = useState(DEFAULT_GROUND)
  const [view, setView] = useState(DEFAULT_VIEW)
  // Cover controls update instantly; tiles re-scatter once they settle.
  const [cover, setCover] = useState(DEFAULT_COVER)
  const settledCover = useDebounced(cover, SETTLE_MS)
  // Habitat controls update instantly; the world follows once they settle.
  const [habitat, setHabitat] = useState(DEFAULT_HABITAT)
  const settledHabitat = useDebounced(habitat, SETTLE_MS)
  // Paths: the trail and exclusion zones follow once the controls settle;
  // pheromones change at once.
  const [paths, setPaths] = useState(DEFAULT_PATHS)
  // Tree crowns regrow once their sliders settle.
  const [crowns, setCrowns] = useState(DEFAULT_CROWNS)
  const settledCrowns = useDebounced(crowns, SETTLE_MS)
  const [crownStats, setCrownStats] = useState({ trees: 0, triangles: 0, perLevel: [0, 0, 0, 0] })
  const settledPaths = useDebounced(paths, SETTLE_MS)
  // Show exclusion zones: paints them for a few seconds (a counter, so a
  // second press restarts the timer).
  const [zoneFlash, setZoneFlash] = useState(0)
  // H hides both side panels so the forest can be seen on its own.
  const [panelsHidden, setPanelsHidden] = useState(false)
  // Underground: the X-ray view changes at once; roots regrow once the
  // root controls settle.
  const [underground, setUnderground] = useState(DEFAULT_UNDERGROUND)
  const settledUnderground = useDebounced(underground, SETTLE_MS)
  const [rootStats, setRootStats] = useState({ trees: 0, pending: 0, segments: 0, triangles: 0, fine: 0, surfaceTrees: 0, perLevel: [0, 0, 0, 0] })
  const [waterStats, setWaterStats] = useState({ particles: 0, pockets: 0, tableBelow: null })
  // Simulation: settings here; the clock and its effects run in the frame
  // loop (simulationRef), and simStatus is its snapshot for the panel.
  const simulationRef = useRef(null)
  const [simSettings, setSimSettings] = useState({ day: DEFAULT_DAY, weather: DEFAULT_WEATHER, season: DEFAULT_SEASON })
  const [simStatus, setSimStatus] = useState({
    running: false,
    blend: 0,
    time: DEFAULT_DAY.time,
    sunAzimuth: 0,
    sunElevation: 0,
    air: 0,
    surface: 0,
    butterflies: 0,
    ants: 0,
    cloud: 0,
    rain: 0,
    wetness: 0,
    fog: 0,
    rainEnded: false,
    season: null,
    sunrise: DEFAULT_DAY.sunrise,
    sunset: DEFAULT_DAY.sunset,
  })
  const [status, setStatus] = useState({
    loaded: 0,
    pending: 0,
    focus: [0, 0],
    ground: 0,
  })
  const [viewUi, setViewUi] = useState({
    id: START_VIEW,
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
  })
  const [perception, setPerception] = useState(() => ({
    ...DEFAULT_PERCEPTION_SETTINGS,
    reducedMotion: prefersReducedMotion(),
  }))

  useEffect(() => {
    const mount = mountRef.current
    const scene = new THREE.Scene()
    // Haze in the sky's horizon colour, so the far ground melts into the sky.
    scene.background = new THREE.Color(FOREST_COLORS.horizon)
    scene.fog = new HeightFog(FOREST_COLORS.horizon)
    scene.fog.set(hazeDensity(DEFAULT_VIEW.haze), 0, 0.3)
    const sky = createForestSky(sunOffsetRef.current)
    scene.add(sky.mesh)

    // Millimetres to metres in one view: a logarithmic depth buffer keeps
    // near and far surfaces from flickering.
    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    // Redrawn only when needed (the frame loop decides; see SHADOW_FPS).
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.needsUpdate = true
    mount.appendChild(renderer.domElement)

    const startConfig = VIEWPOINTS[START_VIEW]
    const camera = new THREE.PerspectiveCamera(
      startConfig.camera.fov,
      mount.clientWidth / mount.clientHeight,
      startConfig.camera.near,
      startConfig.camera.far
    )
    // Vision effects (one full-screen pass, skipped when unused).
    const effects = createViewEffects(renderer)
    effects.setSize(mount.clientWidth, mount.clientHeight, renderer.getPixelRatio())

    const { material, depthMaterial, farMaterial, uniforms, morphUniforms, holeUniforms } =
      createGroundMaterial()
    groundUniformsRef.current = uniforms

    // Ground cover follows the tiles: scattered when a tile is built,
    // dropped when it's freed.
    const coverRenderer = createCoverRenderer(scene, morphUniforms)
    const trunkRenderer = createTrunkRenderer(scene)
    const crownRenderer = createCrownRenderer(scene)
    const distantForest = createDistantForest(scene)
    distantForestRef.current = distantForest
    // Underground: the see-through ground and the roots under the trunks.
    const xray = createXray(scene, [material, farMaterial])
    xrayRef.current = xray
    const waterRenderer = createWaterRenderer(scene)
    // What the water does for each tree: its supply, crown growth and leaves.
    const treeWater = createTreeWater()
    treeWaterRef.current = treeWater
    const sapFlow = createSapFlow(scene)
    const crossSection = createCrossSection(scene, {
      renderer,
      materials: [material, farMaterial, ...waterRenderer.materials],
      cover: coverRenderer,
    })
    crossSectionRef.current = crossSection
    // The forest colour grade, eased out when looking underground so roots
    // and water keep their own colours.
    const gradeOf = () => 1 - Math.max(xray.amount, crossSection.amount)
    const rootRenderer = createRootRenderer(scene)
    const flyAgaric = createFlyAgaric(scene)
    flyAgaricRef.current = flyAgaric
    // The cover the scene draws is also what bodies collide with and climb.
    let world = null
    let builds = 0
    const tiles = createTileManager(scene, material, depthMaterial, {
      onTileReady: (key, data) => {
        const { cover, seed, moss, flowers, leaves, exclusions, landmarks } = coverContextRef.current
        const items = scatterTile(data, { cover, seed, moss, flowers, leaves, exclusions, landmarks, trunks: tiles.trunks })
        coverRenderer.setTile(key, items)
        world.setTile(key, items)
        builds += 1
      },
      onTileRemoved: (key) => {
        coverRenderer.removeTile(key)
        world.removeTile(key)
      },
    })
    tilesRef.current = tiles
    tiles.setGround(DEFAULT_GROUND)
    distantForest.setGround(DEFAULT_GROUND)
    world = createWorldQueries(tiles, () => (flyAgaric.group.visible ? flyAgaric.group.position : null))
    const farGround = createFarGround(farMaterial, holeUniforms)
    farGroundRef.current = farGround
    scene.add(farGround.mesh)

    // Shared by every viewpoint and created once: the ants' tunnels and
    // scent trails, the air (spores, currents), and the three bodies.
    const antWorld = createAntWorld(scene, morphUniforms)
    antWorldRef.current = antWorld
    // The ant agents and the pheromones they lay (glowing on the ground).
    const antColony = createAntColony(scene, morphUniforms)
    antColonyRef.current = antColony
    const airLayer = createAirLayer(scene)
    // The simulation's clock and the life it brings (butterflies, ants).
    const simulation = createSimulation()
    simulationRef.current = simulation
    const ambientLife = createAmbientLife(scene)
    const rain = createRain(scene)
    const staticSun = new THREE.Vector3()
    const bodies = createBodies(scene)

    let latestFrame = null
    const spot = flyAgaric.spot(DEFAULT_GROUND.seed)
    const controller = createViewController({
      camera,
      world,
      bodies,
      antWorld,
      start: {
        id: START_VIEW,
        x: spot.x / 2,
        z: spot.z / 2,
        ...START,
      },
      hooks: {
        onUi: setViewUi,
        capture: () => {
          if (latestFrame) effects.capture(scene, camera, latestFrame.effects, { dark: latestFrame.dark, grade: gradeOf() })
        },
      },
    })
    controllerRef.current = controller

    // Forest light: green light from the canopy above (enough that shade
    // keeps its detail), a brown bounce from the soil, and a strong warm sun
    // breaking through the leaves (canopyLight.js).
    const hemisphere = new THREE.HemisphereLight('#62705a', '#3a2c20', 1.2)
    scene.add(hemisphere)
    const sun = new THREE.DirectionalLight('#ffd59a', 3.4)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.00005
    sun.shadow.normalBias = 0.0004
    sun.shadow.camera.near = 0.05
    scene.add(sun, sun.target)
    // The shadow box covers what this body sees; a taller body needs a
    // bigger box and the sun further back.
    let shadowReach = 0
    const setShadowReach = (reach) => {
      if (Math.abs(reach - shadowReach) < 1e-3) return
      shadowReach = reach
      Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach })
      sun.shadow.camera.far = SHADOW_BASE.far * sunScaleFor(reach)
      sun.shadow.camera.updateProjectionMatrix()
    }

    // Activity, for frame pacing: input of any kind (on the scene or the
    // panels) wakes the loop to ACTIVE_FPS, and so does a held key.
    let lastActive = performance.now()
    const wake = () => (lastActive = performance.now())
    const heldKeys = new Set()
    window.addEventListener('input', wake, true)
    window.addEventListener('change', wake, true)

    // Keys: the controller decides what they mean for the current body.
    // Whether focus last moved by Tab (keyboard) rather than a click.
    let tabbed = false
    const onPointerFocus = () => {
      tabbed = false
      wake()
    }
    const onKeyDown = (event) => {
      wake()
      if (isTyping(event)) return
      heldKeys.add(event.code)
      if (event.code === 'Tab') tabbed = true
      if (event.code === 'KeyU' && !event.repeat) {
        // Surface → X-ray → cross-section → surface; the free view only.
        if (viewIdRef.current !== 'free') return
        setUnderground((current) => ({
          ...current,
          view: UNDERGROUND_VIEWS[(UNDERGROUND_VIEWS.indexOf(current.view) + 1) % UNDERGROUND_VIEWS.length],
        }))
        return
      }
      // Space or Enter on a button reached with Tab presses that button. A
      // button that only has focus because it was clicked (e.g. Butterfly)
      // doesn't keep Space from flying.
      const onControl = tabbed && ['BUTTON', 'SUMMARY', 'A'].includes(event.target.tagName)
      if (onControl && (event.code === 'Space' || event.code === 'Enter')) return
      const scrolls = event.code === 'Space' || event.code.startsWith('Arrow')
      if (event.repeat) {
        if (scrolls) event.preventDefault()
        return
      }
      if (controller.key(event.code, true) && scrolls) event.preventDefault()
    }
    const onKeyUp = (event) => {
      heldKeys.delete(event.code)
      wake()
      controller.key(event.code, false)
    }
    const onBlur = () => {
      heldKeys.clear()
      controller.input.clear()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pointerdown', onPointerFocus, true)

    // Drag to look / orbit; right-drag or Shift+drag pans (free view).
    const canvas = renderer.domElement
    let dragPointer = null
    let dragPan = false
    let dragLast = { x: 0, y: 0 }
    const onPointerDown = (event) => {
      if (dragPointer !== null || (event.button !== 0 && event.button !== 2)) return
      dragPointer = event.pointerId
      dragPan = event.button === 2 || event.shiftKey
      dragLast = { x: event.clientX, y: event.clientY }
      canvas.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event) => {
      if (event.pointerId !== dragPointer) return
      wake()
      const dx = event.clientX - dragLast.x
      const dy = event.clientY - dragLast.y
      if (dragPan) controller.input.pan(dx, dy)
      else controller.input.drag(dx, dy)
      dragLast = { x: event.clientX, y: event.clientY }
    }
    const onContextMenu = (event) => event.preventDefault()
    canvas.addEventListener('contextmenu', onContextMenu)
    const onPointerUp = (event) => {
      if (event.pointerId === dragPointer) dragPointer = null
    }
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    // Zoom with the wheel (the free camera); double-click re-centres it.
    const onWheel = (event) => {
      event.preventDefault()
      wake()
      controller.input.zoom(event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY)
    }
    const onDoubleClick = (event) => {
      wake()
      const rect = canvas.getBoundingClientRect()
      controller.focusAt(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      )
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('dblclick', onDoubleClick)

    // Once the first tiles exist, compile every shader for both outputs
    // (screen and the effects pass), with the hidden bodies and layers
    // shown for a moment, so switching viewpoints never stalls on it.
    let warmed = false
    const warmUp = () => {
      const hidden = [...bodies.groups, ...antWorld.meshes, ...antColony.meshes, ...airLayer.meshes, ...ambientLife.meshes, ...rain.meshes].filter(
        (object) => !object.visible
      )
      for (const object of hidden) object.visible = true
      // Draw the shadow map too, so its shaders compile as well.
      renderer.shadowMap.needsUpdate = true
      effects.warmUp(scene, camera)
      for (const object of hidden) object.visible = false
      warmed = true
    }

    // Body cues: CSS variables on the overlay, written only when they change.
    const overlay = { presence: -1, turn: -1 }
    const writeOverlay = (embodiment) => {
      const element = overlayRef.current
      if (!element) return
      const values = {
        presence: embodiment.presence,
        turn: embodiment.turn,
      }
      for (const [key, value] of Object.entries(values)) {
        if (Math.abs(overlay[key] - value) < 0.004) continue
        overlay[key] = value
        element.style.setProperty(`--${key}`, value.toFixed(3))
        if (key === 'turn') element.style.setProperty('--turn-abs', Math.min(Math.abs(value), 1).toFixed(3))
      }
    }

    const agaricTop = new THREE.Vector3()
    let holeRadius = 0
    let lastTime = performance.now()
    let time = 0
    // Last frame's wet weather and autumn share, for the trees (the
    // simulation runs after the crowns).
    let liveWetness = 0
    let liveAutumn = 0
    // Where the camera and the sun were, to tell when they move.
    const lastCamera = { position: camera.position.clone(), quaternion: camera.quaternion.clone() }
    const lastShadow = { sun: new THREE.Vector3(), target: new THREE.Vector3(), version: null, time: -Infinity }
    const easing = (amount) => amount > 0 && amount < 1
    // Frames and shadow maps drawn (for checks during development).
    let renders = 0
    let shadowDraws = 0
    let frameId
    const animate = () => {
      const now = performance.now()
      // Frame pacing (ACTIVE_FPS): a tick that comes too soon is skipped,
      // and the canvas keeps its last picture.
      const fps = heldKeys.size > 0 || now - lastActive < IDLE_AFTER_MS ? ACTIVE_FPS : AMBIENT_FPS
      if (now - lastTime < 1000 / fps - FRAME_SLACK_MS) {
        frameId = requestAnimationFrame(animate)
        return
      }
      const delta = Math.min((now - lastTime) / 1000, MAX_FRAME)
      lastTime = now
      time += delta

      const frame = controller.update(delta)
      latestFrame = frame
      const { anchor, params } = frame
      // Still moving after the input stopped (momentum, springs, a body
      // switch) keeps the loop awake.
      const cameraMoved =
        camera.position.distanceToSquared(lastCamera.position) > CAMERA_STILL.move ** 2 ||
        1 - Math.abs(camera.quaternion.dot(lastCamera.quaternion)) > CAMERA_STILL.turn
      lastCamera.position.copy(camera.position)
      lastCamera.quaternion.copy(camera.quaternion)
      if (cameraMoved || controller.busy) wake()

      // Detail rings: the Detail distance setting plus what this viewpoint
      // adds (the butterfly sees much further than the ant). Near tiles are
      // full detail, middle tiles simplified; the far ground starts after.
      const detail = viewRef.current.distance
      const rings = { near: detail + frame.lod.near, outer: detail + frame.lod.middle }
      const distance = rings.outer
      tiles.update(anchor.x, anchor.z, rings, BUILD_BUDGET_MS)
      const tileStats = tiles.stats()
      // Tiles still building or re-scattering: keep drawing them in briskly.
      if (tileStats.pending > 0 || tileStats.refreshing > 0) wake()
      if (farGround.update(tiles.sampler, tiles.habitat, anchor.x, anchor.z, distance, tiles.habitatKey)) {
        holeRadius = holeUniforms.uHoleRadius.value
      }
      // While tiles are still building (e.g. right after switching body),
      // don't cut the hole: the far ground, sunk below the tiles, fills in.
      holeUniforms.uHoleRadius.value = tileStats.pending > 0 ? 0 : holeRadius
      // At the outer ring's edge tiles fade to the smooth surface (and small
      // cover shrinks away), so they meet the far ground without a seam.
      morphUniforms.uMorphCenter.value.set(anchor.x, anchor.z)
      const [morphStart, morphEnd] = morphRange(distance)
      morphUniforms.uMorphRange.value.set(morphStart, morphEnd)
      coverRenderer.setFadeRange(morphStart + COVER_FADE[0], morphStart + COVER_FADE[1])
      coverRenderer.setUV(params.perception.uv)
      coverRenderer.sync()
      const crownSettings = crownSettingsRef.current
      trunkRenderer.update(tiles.trunks, tiles.sampler, anchor.x, anchor.z, tiles.version, crownSettings.crownStart)
      const trunkSampler = tiles.sampler
      distantForest.update(tiles.trunks, trunkSampler, tiles.version, camera.position, Math.max(xray.amount, crossSection.amount))
      const roots = rootSettingsRef.current
      treeWater.update({
        dt: delta,
        field: waterRenderer.field,
        key: `${waterRenderer.key}|${roots.reach}|${roots.rootDepth}`,
        trunks: tiles.trunks,
        roots,
        anchor,
        wetness: liveWetness,
        autumn: liveAutumn,
        speed: crownSettings.growthSpeed,
      })
      crownRenderer.update({
        trunks: tiles.trunks,
        ground: (trunk) => trunkGround(trunk, trunkSampler),
        focusX: anchor.x,
        focusZ: anchor.z,
        camera,
        viewportHeight: mount.clientHeight,
        settings: crownSettings,
        version: tiles.version,
        trees: treeWater,
        autumn: liveAutumn,
      })
      xray.update(delta, anchor)
      coverRenderer.setHidden(xray.amount)
      waterRenderer.update({
        active: xray.amount > 0 || crossSection.amount > 0,
        dt: delta,
        sampler: tiles.sampler,
        trunks: tiles.trunks,
        trees: treeWater,
        roots: rootSettingsRef.current,
        settings: waterSettingsRef.current,
        anchor,
        camera,
        viewportHeight: mount.clientHeight,
        version: tiles.version,
      })
      crossSection.update(
        delta,
        anchor,
        camera,
        (x, z) => tiles.sampler.height(x, z),
        waterRenderer.field && { field: waterRenderer.field, key: waterRenderer.key }
      )
      trunkRenderer.setCutBuried(crossSection.active)
      // Easing into or out of X-ray or the cross-section.
      if (easing(xray.amount) || easing(crossSection.amount)) wake()
      sapFlow.update({
        dt: delta,
        on: crownSettings.sap && crownSettings.crowns,
        trunks: tiles.trunks,
        trees: treeWater,
        crowns: crownRenderer,
        roots,
        anchor,
        ground: (trunk) => trunkGround(trunk, trunkSampler),
        underground: xray.amount > 0 || crossSection.amount > 0,
        camera,
        viewportHeight: mount.clientHeight,
        version: [tiles.version, crownSettings.crownStart, crownSettings.crownSize, crownSettings.branchDensity].join('|'),
      })
      const groundSampler = tiles.sampler
      rootRenderer.update({
        active: xray.amount > 0 || crossSection.amount > 0,
        rim: Math.max(xray.amount, 0.35 * crossSection.amount),
        soil: crossSection.amount,
        trunks: tiles.trunks,
        height: (x, z) => groundSampler.height(x, z),
        anchor,
        camera,
        viewportHeight: mount.clientHeight,
        settings: rootSettingsRef.current,
        version: tiles.version,
      })
      sky.follow(camera)

      // Each body sees the same haze over a different range (higher eyes
      // see further, so the end of the world stays hidden).
      const haze = Math.max(hazeDensity(viewRef.current.haze) * params.hazeScale, params.hazeMin)
      antWorld.update({
        scent: params.perception.scent,
        time,
        near: frame.nearEntrance ?? -1,
        fadeStart: morphStart + COVER_FADE[0],
        fadeEnd: morphStart + COVER_FADE[1],
      })
      if (flyAgaric.group.visible) agaricTop.copy(flyAgaric.group.position).setY(flyAgaric.group.position.y + 0.12)
      airLayer.update({
        time,
        center: anchor,
        agaric: flyAgaric.group.visible ? agaricTop : null,
        perception: params.perception,
        pixels: canvas.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)),
      })

      // The light: the Habitat tab's sun, or the simulation's sun and moon,
      // sky and fog colours, flowers opening, and the life it brings.
      staticSun.copy(sunOffsetRef.current).normalize()
      const env = simulation.update(delta, staticSun)
      sun.color.copy(env.lightColor)
      sun.intensity = env.lightIntensity
      hemisphere.color.copy(env.hemiSky)
      hemisphere.groundColor.copy(env.hemiGround)
      hemisphere.intensity = env.hemiIntensity
      // Sun through the canopy (off underground, where it would only
      // speckle the roots).
      setCanopyLight(
        (viewRef.current.dapple / 100) * env.dapple * (1 - Math.max(xray.amount, crossSection.amount)),
        crownSettings.crownStart + CANOPY_ABOVE_CROWN_START
      )
      sky.setSunDirection(env.sunDirection)
      sky.setColors(env.sky)
      scene.background.copy(env.sky.horizon)
      scene.fog.color.copy(env.sky.horizon)
      coverRenderer.setFlowerOpen(env.flowerOpen)
      // Weather: haze and ground mist, wet ground and cover, wind, rain.
      scene.fog.set(haze * env.haze, env.mist, env.mistHeight)
      xray.applyAtmosphere(scene, sky)
      uniforms.uWet.value = env.wetness
      liveWetness = env.wetness
      liveAutumn = env.autumn.value * env.autumn.weight
      coverRenderer.setWeather({ wind: env.wind, wet: env.wetness, time })
      // Season: how much of each kind shows, and the leaves' autumn share
      // (the Scatter setting, blended toward the season's).
      const baseAutumn = coverContextRef.current.cover.leaves.autumn / 100
      coverRenderer.setSeason({
        ...env.levels,
        autumn: baseAutumn + (env.autumn.value - baseAutumn) * env.autumn.weight,
      })
      world.setPresence(env.levels)
      const pixels = canvas.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
      rain.update({
        time,
        intensity: env.rain,
        camera,
        ground: tiles.heightAt(camera.position.x, camera.position.z),
        wind: [env.windDirection[0] * env.wind, env.windDirection[1] * env.wind],
        light: Math.min(env.lightIntensity / 1.8 + env.hemiIntensity, 1),
        pixels,
      })
      ambientLife.update({
        dt: delta,
        time,
        activity: { butterflies: env.butterflies, ants: env.ants },
        anchor,
        sampler: tiles.sampler,
        // The agents replace the ants that shuttle along the seeded trails.
        trails: antColony.on ? [] : antWorld.trails,
        flowers: (x, z) =>
          coverContextRef.current.cover.flowers.on ? coverContextRef.current.flowers?.coloniesIn(x - 1, z - 1, x + 1, z + 1) : [],
      })

      // Outside the simulation the whole colony is out; inside it, the
      // day and the weather decide.
      antColony.update({
        dt: delta,
        time,
        activity: 1 - simulation.weight + env.ants,
        sampler: tiles.sampler,
        scent: params.perception.scent,
        fadeStart: morphStart + COVER_FADE[0],
        fadeEnd: morphStart + COVER_FADE[1],
      })

      setShadowReach(params.shadowReach)
      sun.target.position.set(frame.shadowCenter.x, anchor.y, frame.shadowCenter.y)
      sun.position
        .copy(sun.target.position)
        .addScaledVector(env.sunDirection, SUN_DISTANCE * sunScaleFor(params.shadowReach))

      // After the warm-up (which drew the hidden bodies' shadows), redraw.
      if (!warmed && tileStats.loaded > 0) {
        warmUp()
        lastShadow.time = -Infinity
      }
      // Shadows (shadowMap.autoUpdate is off): redrawn when the sun or its
      // shadow box moved or the ground changed, otherwise at SHADOW_FPS.
      if (
        sun.position.distanceToSquared(lastShadow.sun) > SHADOW_MOVE ** 2 ||
        sun.target.position.distanceToSquared(lastShadow.target) > SHADOW_MOVE ** 2 ||
        tiles.version !== lastShadow.version ||
        now - lastShadow.time >= 1000 / SHADOW_FPS - FRAME_SLACK_MS
      ) {
        renderer.shadowMap.needsUpdate = true
        lastShadow.sun.copy(sun.position)
        lastShadow.target.copy(sun.target.position)
        lastShadow.version = tiles.version
        lastShadow.time = now
        shadowDraws += 1
      }

      renders += 1
      effects.render(scene, camera, frame.effects, { prevMix: frame.prevMix, dark: frame.dark, grade: gradeOf() })
      writeOverlay(frame.embodiment)
      frameId = requestAnimationFrame(animate)
    }
    animate()

    // Panel readouts: handed to React only when they changed. Most of the
    // time they haven't, and a new object would re-render both panels.
    const shown = {}
    const show = (key, setter, value) => {
      const text = JSON.stringify(value)
      if (shown[key] === text) return
      shown[key] = text
      setter(value)
    }
    const statusTimer = setInterval(() => {
      const viewer = latestFrame?.viewer ?? camera.position
      show('status', setStatus, {
        ...tiles.stats(),
        focus: [viewer.x, viewer.z],
        ground: tiles.heightAt(viewer.x, viewer.z),
        colony: antColony.stats(),
      })
      show('sim', setSimStatus, simulation.snapshot())
      show('roots', setRootStats, rootRenderer.stats())
      show('water', setWaterStats, waterRenderer.stats())
      show('crowns', setCrownStats, { ...crownRenderer.stats(), tree: treeWater.nearest(viewer.x, viewer.z), sap: sapFlow.alive })
    }, STATUS_REFRESH_MS)

    const onResize = () => {
      wake()
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      effects.setSize(mount.clientWidth, mount.clientHeight, renderer.getPixelRatio())
    }
    window.addEventListener('resize', onResize)

    // For checks during development: the controller and how many tiles
    // have been built (switching viewpoints must not build any).
    if (import.meta.env.DEV) {
      window.__umwelt = { controller, tiles, builds: () => builds, renders: () => ({ frames: renders, shadows: shadowDraws }),coverRenderer, flyAgaric, antWorld, antColony, camera, bodies, uniforms, simulation, ambientLife, sun, hemisphere, xray, crossSection, rootRenderer, waterRenderer, crownRenderer }
    }

    return () => {
      cancelAnimationFrame(frameId)
      clearInterval(statusTimer)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pointerdown', onPointerFocus, true)
      window.removeEventListener('input', wake, true)
      window.removeEventListener('change', wake, true)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContextMenu)
      canvas.removeEventListener('dblclick', onDoubleClick)
      if (import.meta.env.DEV) delete window.__umwelt
      controllerRef.current = null
      antWorld.dispose()
      antColony.dispose()
      antColonyRef.current = null
      airLayer.dispose()
      ambientLife.dispose()
      rain.dispose()
      simulationRef.current = null
      bodies.dispose()
      effects.dispose()
      antWorldRef.current = null
      farGroundRef.current = null
      tiles.dispose()
      coverRenderer.dispose()
      trunkRenderer.dispose()
      crownRenderer.dispose()
      distantForest.dispose()
      distantForestRef.current = null
      xray.dispose()
      xrayRef.current = null
      crossSection.dispose()
      crossSectionRef.current = null
      treeWaterRef.current = null
      rootRenderer.dispose()
      waterRenderer.dispose()
      sapFlow.dispose()
      flyAgaric.dispose()
      flyAgaricRef.current = null
      farGround.dispose()
      sky.dispose()
      material.dispose()
      farMaterial.dispose()
      depthMaterial.dispose()
      mount.removeChild(renderer.domElement)
      renderer.dispose()
      tilesRef.current = null
      groundUniformsRef.current = null
    }
  }, [])

  // Shape settings (and trunks) rebuild the tiles, which re-scatter their
  // cover as they finish; grain is only a shader uniform.
  const { seed, slopes, bumps, warp, pebbles, antHill, trunks, trunkSpacing, grain } = ground
  // The ant trail (part of the ground: it presses the soil down) and the
  // exclusion zones, from the settled Paths settings.
  const agaricShown = cover.flyAgaric && antHill
  const { showTrail, trailWidth, trailCurvature, trailDarkness, compression, clearing, detail } = settledPaths
  const antTrail = useMemo(
    () =>
      createAntTrail({
        seed,
        paths: { showTrail, trailWidth, trailCurvature, trailDarkness, compression, clearing, detail },
        antHill,
        agaric: agaricShown,
      }),
    [seed, antHill, agaricShown, showTrail, trailWidth, trailCurvature, trailDarkness, compression, clearing, detail]
  )
  const { antHillClearance, agaricClearance, spawnClearance, trailClearance, interactionClearance, softEdge } =
    settledPaths
  const exclusions = useMemo(
    () =>
      createExclusions({
        paths: { antHillClearance, agaricClearance, spawnClearance, trailClearance, interactionClearance, softEdge },
        seed,
        antHill,
        agaric: agaricShown,
        trail: antTrail,
      }),
    [antHillClearance, agaricClearance, spawnClearance, trailClearance, interactionClearance, softEdge, seed, antHill, agaricShown, antTrail]
  )
  useEffect(() => {
    tilesRef.current?.setGround({ seed, slopes, bumps, warp, pebbles, antHill, trunks, trunkSpacing, trail: antTrail })
    distantForestRef.current?.setGround({ seed, trunks, trunkSpacing })
  }, [seed, slopes, bumps, warp, pebbles, antHill, trunks, trunkSpacing, antTrail])

  // The fly agaric stands by the ant hill (only while there is one), and
  // the ants' tunnels and trails lead out from the hill to it and to food.
  useEffect(() => {
    const tiles = tilesRef.current
    const flyAgaric = flyAgaricRef.current
    flyAgaric?.place(tiles?.sampler, seed, cover.flyAgaric && antHill)
    antWorldRef.current?.place({
      sampler: tiles?.sampler,
      trunks: tiles?.trunks,
      seed,
      antHill,
      agaric: flyAgaric?.group.visible ? flyAgaric.spot(seed) : null,
      antTrail,
    })
    antColonyRef.current?.place({
      sampler: tiles?.sampler,
      trunks: tiles?.trunks,
      seed,
      antHill,
      agaric: flyAgaric?.group.visible ? flyAgaric.spot(seed) : null,
    })
  }, [seed, slopes, bumps, warp, pebbles, antHill, trunks, trunkSpacing, cover.flyAgaric, antTrail])

  // Pheromone settings change at once (no rebuild of the ground).
  const { showPheromones, pheromoneIntensity, pheromoneWidth } = paths
  useEffect(() => {
    antWorldRef.current?.setPheromones({
      show: showPheromones,
      intensity: pheromoneIntensity / 100,
      width: pheromoneWidth / 100,
    })
    antColonyRef.current?.setPheromones({ show: showPheromones, intensity: pheromoneIntensity / 100 })
  }, [showPheromones, pheromoneIntensity, pheromoneWidth])

  // Ant colony settings change at once; the agents hide the seeded ribbons.
  const { antAgents, colonySize, simSpeed, scentHalfLife, diffusion, sensorAngle, sensorDistance, wander, slopeAvoidance } =
    paths
  useEffect(() => {
    antColonyRef.current?.setSettings({
      antAgents,
      colonySize,
      simSpeed,
      scentHalfLife,
      diffusion,
      sensorAngle,
      sensorDistance,
      wander,
      slopeAvoidance,
    })
    antWorldRef.current?.setRibbons(!antAgents)
  }, [antAgents, colonySize, simSpeed, scentHalfLife, diffusion, sensorAngle, sensorDistance, wander, slopeAvoidance])

  useEffect(() => {
    if (groundUniformsRef.current) groundUniformsRef.current.uGrain.value = grain / 100
  }, [grain])

  // Underground: the X-ray view and the free camera follow at once; roots
  // regrow from the settled root settings (Roots on/off is instant).
  // X-ray and the cross-section belong to the free view: the butterfly and
  // the ant always see the surface (the choice comes back in the free view).
  const freeView = viewUi.id === 'free'
  useEffect(() => {
    viewIdRef.current = viewUi.id
  }, [viewUi.id])
  const undergroundView = freeView ? underground.view : 'surface'
  const { opacity: groundOpacity, depth: undergroundDepth, guides } = underground
  const xrayOn = undergroundView === 'xray'
  useEffect(() => {
    xrayRef.current?.setOn(xrayOn)
    crossSectionRef.current?.setOn(undergroundView === 'section')
    xrayRef.current?.setOpacity(groundOpacity / 100)
    xrayRef.current?.setGuides(guides)
    controllerRef.current?.setSettings({ underground: { active: xrayOn, depth: undergroundDepth / 100 } })
  }, [xrayOn, undergroundView, groundOpacity, guides, undergroundDepth])
  useEffect(() => {
    // Showing branches, leaves and sap and the growth speed change at once.
    crownSettingsRef.current = {
      ...settledCrowns,
      crowns: crowns.crowns,
      leaves: crowns.leaves,
      growthSpeed: crowns.growthSpeed,
      sap: crowns.sap,
    }
  }, [settledCrowns, crowns.crowns, crowns.leaves, crowns.growthSpeed, crowns.sap])
  useEffect(() => {
    rootSettingsRef.current = {
      ...Object.fromEntries(ROOT_KEYS.map((key) => [key, settledUnderground[key]])),
      roots: underground.roots,
      // The cross-section always shows its own glowing orange, and a denser
      // tangle: more deep roots, forking more, with more fine roots.
      ...(undergroundView === 'section'
        ? {
            colors: 'section',
            deep: settledUnderground.deep + 4,
            branching: Math.min(settledUnderground.branching * 1.6, 1),
            fine: settledUnderground.fine * 2.5,
          }
        : {}),
    }
  }, [settledUnderground, underground.roots, undergroundView])
  useEffect(() => {
    waterSettingsRef.current = {
      ...Object.fromEntries(WATER_KEYS.map((key) => [key, settledUnderground[key]])),
      // These change at once; the rest rebuild the water field.
      water: underground.water,
      particles: underground.particles,
      showField: underground.showField,
      wetness: settledHabitat.wetness,
    }
  }, [settledUnderground, underground.water, underground.particles, underground.showField, settledHabitat.wetness])

  // Habitat fields follow the settled controls (loaded tiles refresh over a
  // few frames, nearest first).
  useEffect(() => {
    tilesRef.current?.setHabitat(settledHabitat)
  }, [settledHabitat])

  // Settled cover settings (and any ground, habitat or exclusion-zone
  // change) rebuild the moss patch and flower colony fields, then loaded
  // tiles re-scatter over a few frames (no ground rebuild). Declared after
  // the ground and habitat effects, so it sees their new fields.
  useEffect(() => {
    const tiles = tilesRef.current
    if (!tiles?.habitat) return
    const moss = createMossField(settledCover.moss, { habitat: tiles.habitat, sampler: tiles.sampler, seed })
    const flowers = createFlowerField(settledCover.flowers, { habitat: tiles.habitat, seed })
    const leaves = createLeafField(settledCover.leaves, { seed, windDirection: settledHabitat.windDirection })
    // Landmarks leaves pile against.
    const landmarks = { antHill, agaric: agaricShown ? agaricSpot(seed) : null }
    coverContextRef.current = { cover: settledCover, seed, moss, flowers, leaves, exclusions, landmarks }
    farGroundRef.current?.setCover(settledCover, moss, flowers)
    tiles.setExclusions(exclusions)
    tiles.refreshCover()
  }, [settledCover, settledHabitat, seed, slopes, bumps, warp, pebbles, antHill, agaricShown, trunks, trunkSpacing, exclusions])

  // Show exclusion zones: back to the chosen preview after a few seconds.
  useEffect(() => {
    if (!zoneFlash) return undefined
    const timer = setTimeout(() => setZoneFlash(0), ZONE_FLASH_MS)
    return () => clearTimeout(timer)
  }, [zoneFlash])

  // The Habitat tab's sun is the visible sun whenever the simulation isn't
  // running (the frame loop applies it to the light, sky and dappling).
  const { sunDirection, sunElevation } = habitat
  useEffect(() => {
    sunOffsetOf({ sunDirection, sunElevation }, sunOffsetRef.current)
  }, [sunDirection, sunElevation])

  useEffect(() => {
    simulationRef.current?.setSettings(simSettings)
  }, [simSettings])

  // Haze is applied every frame (each body scales it), from viewRef.
  useEffect(() => {
    viewRef.current = view
    tilesRef.current?.setPreview(zoneFlash ? 'exclusion' : view.preview)
  }, [view, zoneFlash])

  useEffect(() => {
    controllerRef.current?.setSettings(perception)
  }, [perception])

  // Follow the system's reduced-motion setting when it changes.
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setPerception((current) => ({ ...current, reducedMotion: query.matches }))
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const viewpoint = VIEWPOINTS[viewUi.id]

  // H toggles the side panels. Sliders and checkboxes don't swallow it;
  // only fields that take text do.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.code !== 'KeyH' || event.repeat) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      const textField =
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        (target.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(target.type))
      if (textField) return
      setPanelsHidden((hidden) => !hidden)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Don't leave focus on a control that just faded out (Space would press it).
  useEffect(() => {
    if (!panelsHidden) return
    const active = document.activeElement
    if (active?.closest?.('.map-left-column, .voxel-workspace > .noise-panel')) active.blur()
  }, [panelsHidden])

  return (
    <div className={`voxel-workspace${panelsHidden ? ' panels-hidden' : ''}`}>
      <div
        className="scene map-scene"
        ref={mountRef}
        role="img"
        aria-label={
          viewpoint.body
            ? `Forest floor seen as a ${viewpoint.label.toLowerCase()}, ${summaryOf(viewpoint).toLowerCase()}`
            : `Forest floor, free view: drag to orbit, right-drag to pan, scroll to zoom`
        }
      />
      <div className="scene map-overlays" style={{ pointerEvents: 'none' }}>
        <Embodiment ref={overlayRef} id={viewUi.id} motion={perception.motionEffects} />
        {viewUi.label && (
          <div key={viewUi.labelId} className="view-label" aria-hidden="true">
            {viewUi.label}
          </div>
        )}
        {viewUi.hint && (
          <div key={`hint-${viewUi.hintId}`} className="view-hint" aria-hidden="true">
            {viewUi.hint}
          </div>
        )}
      </div>
      <p className="view-sr-only" aria-live="polite">
        {viewUi.label}
        {viewUi.hint ? `. ${viewUi.hint}` : ''}
      </p>
      <p className="view-sr-only" aria-live="polite">
        {panelsHidden ? 'Panels hidden. Press H to show them.' : ''}
      </p>
      {panelsHidden && (
        <div className="panels-hidden-hint" aria-hidden="true">
          <kbd>H</kbd> show panels
        </div>
      )}
      <div className="map-left-column">
        {intro}
        <ViewAsPanel
          ui={viewUi}
          settings={perception}
          onSelect={(id) => controllerRef.current?.select(id)}
          onViewBody={() => controllerRef.current?.viewBody()}
          onSettingChange={(key, value) => setPerception((current) => ({ ...current, [key]: value }))}
        />
        <SimulationPanel
          settings={simSettings}
          status={simStatus}
          onChange={(group, value) => setSimSettings((current) => ({ ...current, [group]: value }))}
          onStart={() => {
            simulationRef.current?.start()
            setSimStatus((current) => ({ ...current, running: true }))
          }}
          onEnd={() => {
            simulationRef.current?.end()
            setSimStatus((current) => ({ ...current, running: false }))
          }}
          onTime={(hours) => {
            simulationRef.current?.setTime(hours)
            setSimStatus((current) => ({ ...current, time: hours }))
          }}
        />
      </div>
      <MapPanel
        ground={ground}
        view={view}
        cover={cover}
        habitat={habitat}
        habitatSettling={habitat !== settledHabitat || status.refreshing > 0}
        coverSettling={cover !== settledCover || status.refreshing > 0}
        paths={paths}
        pathsSettling={paths !== settledPaths || status.refreshing > 0 || status.pending > 0}
        zonesShowing={zoneFlash > 0}
        onPathsChange={(key, value) => setPaths((current) => ({ ...current, [key]: value }))}
        onShowZones={() => setZoneFlash((count) => count + 1)}
        onResetColony={() => antColonyRef.current?.reset()}
        crowns={crowns}
        crownsSettling={['crownStart', 'crownSize', 'branchDensity'].some((key) => crowns[key] !== settledCrowns[key])}
        crownStats={crownStats}
        onCrownsChange={(key, value) => setCrowns((current) => ({ ...current, [key]: value }))}
        onRegrow={() => treeWaterRef.current?.regrow()}
        underground={freeView ? underground : { ...underground, view: 'surface' }}
        undergroundLocked={!freeView}
        undergroundSettling={ROOT_KEYS.some((key) => underground[key] !== settledUnderground[key])}
        rootStats={rootStats}
        waterStats={waterStats}
        onUndergroundChange={(key, value) => setUnderground((current) => ({ ...current, [key]: value }))}
        status={status}
        onGroundChange={(key, value) => setGround((current) => ({ ...current, [key]: value }))}
        onViewChange={(key, value) => setView((current) => ({ ...current, [key]: value }))}
        onCoverChange={(key, value) => setCover((current) => ({ ...current, [key]: value }))}
        onHabitatChange={(key, value) => setHabitat((current) => ({ ...current, [key]: value }))}
        onResetKeys={({
          ground: groundKeys,
          view: viewKeys,
          cover: coverKeys,
          habitat: habitatKeys,
          paths: pathKeys,
          underground: undergroundKeys,
          crowns: crownKeys,
        }) => {
          if (groundKeys) setGround((current) => withDefaults(current, DEFAULT_GROUND, groundKeys))
          if (viewKeys) setView((current) => withDefaults(current, DEFAULT_VIEW, viewKeys))
          if (coverKeys) setCover((current) => withDefaults(current, DEFAULT_COVER, coverKeys))
          if (habitatKeys) setHabitat((current) => withDefaults(current, DEFAULT_HABITAT, habitatKeys))
          if (pathKeys) setPaths((current) => withDefaults(current, DEFAULT_PATHS, pathKeys))
          if (crownKeys) setCrowns((current) => withDefaults(current, DEFAULT_CROWNS, crownKeys))
          if (undergroundKeys) setUnderground((current) => withDefaults(current, DEFAULT_UNDERGROUND, undergroundKeys))
        }}
        onReset={() => {
          setGround(DEFAULT_GROUND)
          setView(DEFAULT_VIEW)
          setCover(DEFAULT_COVER)
          setHabitat(DEFAULT_HABITAT)
          setPaths(DEFAULT_PATHS)
          setUnderground(DEFAULT_UNDERGROUND)
          setCrowns(DEFAULT_CROWNS)
        }}
      />
    </div>
  )
}
