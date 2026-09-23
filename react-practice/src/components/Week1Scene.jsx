import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export default function Week1Scene({ settings }) {
  const mountRef = useRef(null)

  // The animation loop reads settings through a ref so that changing a slider
  // does not tear down and rebuild the whole scene.
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

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
    camera.position.set(3.5, 2.5, 4.5)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 2
    controls.maxDistance = 30

    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshStandardMaterial({
      color: settingsRef.current.color,
      roughness: 0.35,
      metalness: 0.1,
    })
    const cube = new THREE.Mesh(geometry, material)
    scene.add(cube)

    const grid = new THREE.GridHelper(24, 24, '#39424e', '#232a33')
    grid.position.y = -1.5
    scene.add(grid)

    scene.add(new THREE.AmbientLight(0xffffff, 0.55))

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
    keyLight.position.set(5, 6, 4)
    scene.add(keyLight)

    const rimLight = new THREE.DirectionalLight('#6ea8ff', 1.1)
    rimLight.position.set(-5, 2, -4)
    scene.add(rimLight)

    const clock = new THREE.Clock()
    let frameId

    const animate = () => {
      const delta = clock.getDelta()
      const { rotationSpeed, size, color, autoRotate } = settingsRef.current

      if (autoRotate) {
        cube.rotation.y += rotationSpeed * delta
        cube.rotation.x += rotationSpeed * delta * 0.35
      }
      cube.scale.setScalar(size)
      material.color.set(color)

      controls.update()
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(animate)
    }
    animate()

    // Watching the container rather than the window keeps the canvas correct
    // when the side panel appears or the layout reflows.
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
      geometry.dispose()
      material.dispose()
      grid.geometry.dispose()
      grid.material.dispose()
      renderer.dispose()
    }
  }, [])

  return <div className="scene" ref={mountRef} />
}
