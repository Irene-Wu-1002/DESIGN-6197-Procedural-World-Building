import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import BranchingPanel from './BranchingPanel'
import { createBranchObject } from '../utils/branching/branchRenderer'
import {
  DEFAULT_RECURSIVE,
  RECURSIVE_PRESETS,
  growRecursive,
} from '../utils/branching/recursive'

// Seconds to grow one generation when Grow is pressed.
const SECONDS_PER_GENERATION = 0.45

// Topic 6: Branching System. Each method returns the same { segments, tips }
// shape, so one renderer draws them all.
export default function Week6Scene() {
  const mountRef = useRef(null)
  const sceneRef = useRef(null)
  const branchRef = useRef(null)
  const growStartRef = useRef(null)
  // The tree grows by itself on first load and after Reset, Random Seed or a
  // preset; slider drags show the result at once so tweaking stays quick.
  const growNextRef = useRef(true)
  const [method, setMethod] = useState('recursive')
  const [params, setParams] = useState(DEFAULT_RECURSIVE)
  // Generation being grown (1-based) while Grow plays, otherwise null.
  const [growingGeneration, setGrowingGeneration] = useState(null)

  // Tips only toggle visibility, so they don't regrow the tree.
  const { showTips, ...growParams } = params
  const growKey = JSON.stringify(growParams)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tree = useMemo(() => growRecursive(growParams), [growKey])

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

    let frameId
    let shownGeneration = null
    const animate = (now) => {
      const branch = branchRef.current
      if (branch && growStartRef.current !== null) {
        const progress = Math.max(0, now - growStartRef.current) / 1000 / SECONDS_PER_GENERATION
        branch.reveal(progress)
        if (progress >= branch.generations) growStartRef.current = null
        const generation =
          growStartRef.current === null ? null : Math.floor(progress) + 1
        if (generation !== shownGeneration) {
          shownGeneration = generation
          setGrowingGeneration(generation)
        }
      } else if (shownGeneration !== null) {
        shownGeneration = null
        setGrowingGeneration(null)
      }
      controls.update()
      renderer.render(scene, camera)
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
      renderer.dispose()
      sceneRef.current = null
    }
  }, [])

  // Swap in a freshly grown tree whenever its parameters change.
  useEffect(() => {
    const scene = sceneRef.current
    const branch = createBranchObject(tree)
    scene.add(branch.group)
    branchRef.current = branch
    growStartRef.current = null
    if (growNextRef.current) startGrowing()
    return () => {
      scene.remove(branch.group)
      branch.dispose()
      branchRef.current = null
    }
  }, [tree])

  useEffect(() => {
    branchRef.current?.setShowTips(showTips)
  }, [tree, showTips])

  const setParam = (key, value) => {
    growNextRef.current = false
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

  return (
    <div className="voxel-workspace">
      <div className="scene" ref={mountRef} aria-label="Recursive branching tree" />
      <BranchingPanel
        method={method}
        onMethod={setMethod}
        params={params}
        onParam={setParam}
        onPreset={(id) => regrow((current) => ({ ...current, ...RECURSIVE_PRESETS[id].params }))}
        onReset={() => regrow(DEFAULT_RECURSIVE)}
        onRandomSeed={() =>
          regrow((current) => ({ ...current, seed: Math.floor(Math.random() * 1000) }))
        }
        onGrow={startGrowing}
        stats={{
          segments: tree.segments.length,
          tips: tree.tips.length,
          capped: tree.capped,
          generation: growingGeneration,
          generations: tree.maxDepth + 1,
        }}
      />
    </div>
  )
}
