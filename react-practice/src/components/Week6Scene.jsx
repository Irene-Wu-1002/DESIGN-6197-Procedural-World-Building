import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import BranchingPanel from './BranchingPanel'
import { BRANCHING_METHODS } from './branching/methods'
import { createBranchObject } from '../utils/branching/branchRenderer'
import { createLodForest } from '../utils/branching/lodForest'

// A full growth takes about 0.45 s per step, kept between 2 and 6 seconds so
// a 7-generation tree and a 300-iteration one both replay at a watchable pace.
const SECONDS_PER_STEP = 0.45
const MIN_GROW_SECONDS = 2
const MAX_GROW_SECONDS = 6

const DEFAULT_PARAMS = Object.fromEntries(
  BRANCHING_METHODS.map((method) => [method.id, method.defaults])
)

// Settings that only change what is shown, so they don't regrow the tree.
const DISPLAY_KEYS = new Set(['showTips', 'showAttractors'])

const DEFAULT_LOD = {
  mode: 'auto',
  level: 0,
  bias: 1,
  forest: 5,
  twigRadius: 0.012,
  colorByLevel: true,
}

// How often the FPS / draw-call readout refreshes.
const STATS_INTERVAL_MS = 500
const EMPTY_LOD_STATS = { fps: 0, calls: 0, triangles: 0, perLevel: [0, 0, 0, 0], levels: [] }

// Topic 6: Branching System. Each method returns the same { segments, tips }
// shape, so one renderer draws them all. The Growth view draws it as lines
// that grow step by step; the LOD view draws it as tubes, repeated as a
// forest whose copies each pick a level of detail.
export default function Week6Scene() {
  const mountRef = useRef(null)
  const sceneRef = useRef(null)
  const frameRef = useRef(null)
  const branchRef = useRef(null)
  const growStartRef = useRef(null)
  // The tree grows by itself on first load and after Reset, Random Seed or a
  // preset; slider drags show the result at once so tweaking stays quick.
  const growNextRef = useRef(true)
  const speedRef = useRef(1)
  const forestRef = useRef(null)
  const lodRef = useRef(DEFAULT_LOD)
  // Re-frame the camera on the next forest build.
  const frameForestRef = useRef(false)
  const [view, setView] = useState('growth')
  const [lod, setLod] = useState(DEFAULT_LOD)
  const [lodStats, setLodStats] = useState(EMPTY_LOD_STATS)
  const [method, setMethod] = useState('recursive')
  // Each tab keeps its own settings, so switching back loses nothing.
  const [paramsByMethod, setParamsByMethod] = useState(DEFAULT_PARAMS)
  const [speed, setSpeed] = useState(1)
  // Step being grown (1-based) while Grow plays, otherwise null.
  const [growingStep, setGrowingStep] = useState(null)

  const params = paramsByMethod[method]
  const { defaults, presets, grow } = BRANCHING_METHODS.find((item) => item.id === method)
  const growParams = Object.fromEntries(
    Object.entries(params).filter(([key]) => !DISPLAY_KEYS.has(key))
  )
  const growKey = method + JSON.stringify(growParams)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tree = useMemo(() => grow(growParams), [growKey])

  useEffect(() => {
    const mount = mountRef.current

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0e1014')
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(
      50,
      mount.clientWidth / mount.clientHeight,
      0.1,
      200
    )
    camera.position.set(7, 6, 10)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 3, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 2
    controls.maxDistance = 40

    const grid = new THREE.GridHelper(24, 24, '#39424e', '#232a33')
    scene.add(grid)

    // Lines ignore lights; the LOD view's tubes need them.
    const hemisphere = new THREE.HemisphereLight('#dfe8ff', '#3a2e22', 1.4)
    const sun = new THREE.DirectionalLight('#ffffff', 1.8)
    sun.position.set(5, 10, 4)
    scene.add(hemisphere, sun)

    // Point the camera at a structure and back off until all of it fits,
    // keeping the current viewing direction.
    frameRef.current = (box) => {
      const center = box.getCenter(new THREE.Vector3())
      const radius = box.getSize(new THREE.Vector3()).length() / 2
      const distance = Math.max(4, radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.05
      const direction = camera.position.clone().sub(controls.target).normalize()
      controls.target.copy(center)
      camera.position.copy(center).addScaledVector(direction, distance)
      controls.maxDistance = Math.max(40, distance * 2)
    }

    let frameId
    let shownStep = null
    let statsSince = performance.now()
    let framesSince = 0
    let perLevel = [0, 0, 0, 0]
    const animate = (now) => {
      const branch = branchRef.current
      if (branch && growStartRef.current !== null) {
        const steps = branch.generations
        const seconds =
          Math.min(MAX_GROW_SECONDS, Math.max(MIN_GROW_SECONDS, steps * SECONDS_PER_STEP)) /
          speedRef.current
        const progress = (Math.max(0, now - growStartRef.current) / 1000 / seconds) * steps
        branch.reveal(progress)
        if (progress >= steps) growStartRef.current = null
        const step = growStartRef.current === null ? null : Math.floor(progress) + 1
        if (step !== shownStep) {
          shownStep = step
          setGrowingStep(step)
        }
      } else if (shownStep !== null) {
        shownStep = null
        setGrowingStep(null)
      }
      controls.update()
      const forest = forestRef.current
      if (forest) perLevel = [...forest.update(camera, mount.clientHeight, lodRef.current)]
      renderer.render(scene, camera)

      // renderer.info holds the frame just drawn (it resets every render).
      framesSince += 1
      if (forest && now - statsSince >= STATS_INTERVAL_MS) {
        setLodStats({
          fps: Math.round((framesSince * 1000) / (now - statsSince)),
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          perLevel,
          levels: forest.levels,
        })
        statsSince = now
        framesSince = 0
      } else if (!forest) {
        statsSince = now
        framesSince = 0
      }
      frameId = requestAnimationFrame(animate)
    }
    frameId = requestAnimationFrame(animate)

    const observer = new ResizeObserver(() => {
      const width = mount.clientWidth
      const height = mount.clientHeight
      if (width === 0 || height === 0) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    })
    observer.observe(mount)

    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
      controls.dispose()
      mount.removeChild(renderer.domElement)
      grid.geometry.dispose()
      grid.material.dispose()
      hemisphere.dispose()
      sun.dispose()
      renderer.dispose()
      sceneRef.current = null
      frameRef.current = null
    }
  }, [])

  // Swap in a freshly grown tree whenever its parameters change.
  useEffect(() => {
    if (view !== 'growth') return undefined
    const scene = sceneRef.current
    const branch = createBranchObject(tree)
    scene.add(branch.group)
    branchRef.current = branch
    growStartRef.current = null
    if (growNextRef.current) {
      frameRef.current?.(branch.bounds)
      startGrowing()
    }
    return () => {
      scene.remove(branch.group)
      branch.dispose()
      branchRef.current = null
    }
  }, [tree, view])

  // LOD view: the same tree as tubes, repeated as a forest.
  useEffect(() => {
    if (view !== 'lod') return undefined
    const scene = sceneRef.current
    const forest = createLodForest(tree, { twigRadius: lod.twigRadius, gridSize: lod.forest })
    scene.add(forest.group)
    forestRef.current = forest
    if (frameForestRef.current || growNextRef.current) {
      frameRef.current?.(forest.bounds)
      frameForestRef.current = false
    }
    return () => {
      scene.remove(forest.group)
      forest.dispose()
      forestRef.current = null
    }
  }, [tree, view, lod.forest, lod.twigRadius])

  useEffect(() => {
    branchRef.current?.setShowTips(params.showTips)
    branchRef.current?.setShowAttractors(params.showAttractors ?? false)
  }, [tree, params.showTips, params.showAttractors])

  // Update the open tab's settings.
  const setParams = (update) =>
    setParamsByMethod((current) => ({
      ...current,
      [method]: typeof update === 'function' ? update(current[method]) : update,
    }))

  const setParam = (key, value) => {
    growNextRef.current = DISPLAY_KEYS.has(key) && growNextRef.current
    setParams((current) => ({ ...current, [key]: value }))
  }

  function startGrowing() {
    branchRef.current?.reveal(0)
    growStartRef.current = performance.now()
  }

  // Apply a change, then grow the new tree from the trunk.
  const regrow = (update) => {
    growNextRef.current = true
    setParams(update)
  }

  const setLodParam = (key, value) => {
    // A new forest size re-frames the camera; other LOD tweaks keep the view.
    if (key === 'forest') frameForestRef.current = true
    else growNextRef.current = false
    lodRef.current = { ...lodRef.current, [key]: value }
    setLod(lodRef.current)
  }

  const changeView = (next) => {
    if (next === view) return
    if (next === 'lod') frameForestRef.current = true
    else growNextRef.current = true
    setView(next)
  }

  // Changing speed mid-growth keeps the current step instead of jumping.
  const changeSpeed = (value) => {
    if (growStartRef.current !== null) {
      const now = performance.now()
      growStartRef.current = now - ((now - growStartRef.current) * speedRef.current) / value
    }
    speedRef.current = value
    setSpeed(value)
  }

  return (
    <div className="voxel-workspace">
      <div className="scene" ref={mountRef} aria-label="Branching structure" />
      <BranchingPanel
        view={view}
        onView={changeView}
        lod={lod}
        onLod={setLodParam}
        lodStats={lodStats}
        method={method}
        onMethod={(id) => {
          growNextRef.current = true
          setMethod(id)
        }}
        params={params}
        onParam={setParam}
        onPreset={(id) => regrow((current) => ({ ...current, ...presets[id].params }))}
        onReset={() => regrow(defaults)}
        onRandomSeed={() =>
          regrow((current) => ({ ...current, seed: Math.floor(Math.random() * 1000) }))
        }
        onGrow={startGrowing}
        speed={speed}
        onSpeed={changeSpeed}
        tree={tree}
        growingStep={growingStep}
      />
    </div>
  )
}
