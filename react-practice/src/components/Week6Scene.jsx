import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

// Topic 6: Branching System. A plain canvas for now: an empty scene with a
// ground grid and an orbit camera, ready for the branching studies.
export default function Week6Scene() {
  const mountRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0e1014')

    const camera = new THREE.PerspectiveCamera(
      50,
      mount.clientWidth / mount.clientHeight,
      0.1,
      200
    )
    camera.position.set(6, 5, 8)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 2
    controls.maxDistance = 40

    const grid = new THREE.GridHelper(24, 24, '#39424e', '#232a33')
    scene.add(grid)

    let frameId
    const animate = () => {
      controls.update()
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(animate)
    }
    animate()

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
    }
  }, [])

  return <div className="scene" ref={mountRef} aria-label="Branching system canvas" />
}
