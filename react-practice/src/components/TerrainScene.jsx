import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

/**
 * Renders a height field as a Three.js terrain mesh.
 * Expects heights in -1..1; amplitude scales world Y.
 */
export default function TerrainScene({
  heights,
  resolution,
  amplitude,
  worldSize,
  showWireframe,
}) {
  const mountRef = useRef(null)
  const apiRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0e1014')
    scene.fog = new THREE.Fog('#0e1014', 22, 55)

    const camera = new THREE.PerspectiveCamera(
      50,
      mount.clientWidth / mount.clientHeight,
      0.1,
      200
    )
    camera.position.set(12, 10, 12)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.set(0, 0.5, 0)
    controls.minDistance = 4
    controls.maxDistance = 60

    scene.add(new THREE.HemisphereLight('#dce9ff', '#1b2028', 1.35))
    const keyLight = new THREE.DirectionalLight('#ffffff', 2.2)
    keyLight.position.set(8, 14, 6)
    scene.add(keyLight)

    const surfaceMaterial = new THREE.MeshStandardMaterial({
      color: '#6f8f56',
      roughness: 0.92,
      metalness: 0.02,
      flatShading: true,
      side: THREE.DoubleSide,
    })
    const wireMaterial = new THREE.MeshBasicMaterial({
      color: '#101318',
      wireframe: true,
      transparent: true,
      opacity: 0.28,
    })

    const surface = new THREE.Mesh(
      new THREE.BufferGeometry(),
      surfaceMaterial
    )
    const wireframe = new THREE.Mesh(
      new THREE.BufferGeometry(),
      wireMaterial
    )
    wireframe.position.y = 0.01
    scene.add(surface)
    scene.add(wireframe)

    apiRef.current = { scene, surface, wireframe, surfaceMaterial, wireMaterial }

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
      surface.geometry.dispose()
      wireframe.geometry.dispose()
      surfaceMaterial.dispose()
      wireMaterial.dispose()
      renderer.dispose()
      apiRef.current = null
    }
  }, [])

  useEffect(() => {
    const api = apiRef.current
    if (!api || !heights) return

    const segments = resolution - 1
    const geometry = new THREE.PlaneGeometry(
      worldSize,
      worldSize,
      segments,
      segments
    )
    geometry.rotateX(-Math.PI / 2)

    const positions = geometry.attributes.position
    for (let index = 0; index < positions.count; index += 1) {
      positions.setY(index, heights[index] * amplitude)
    }
    positions.needsUpdate = true
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()

    const previous = api.surface.geometry
    if (api.wireframe.geometry !== previous) {
      api.wireframe.geometry.dispose()
    }
    previous.dispose()
    api.surface.geometry = geometry
    api.wireframe.geometry = geometry
  }, [heights, resolution, amplitude, worldSize])

  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    api.wireframe.visible = showWireframe
  }, [showWireframe])

  return <div className="terrain-scene" ref={mountRef} />
}
