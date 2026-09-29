import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

function makeTexture(draw, size = 256) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  draw(context, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

function fillNoise(context, size, alpha, scale = 1) {
  const smallSize = Math.max(8, Math.floor(size / scale))
  const temp = document.createElement('canvas')
  temp.width = smallSize
  temp.height = smallSize
  const tempContext = temp.getContext('2d')
  const image = tempContext.createImageData(smallSize, smallSize)

  for (let index = 0; index < image.data.length; index += 4) {
    const value = Math.floor(Math.random() * 255)
    image.data[index] = value
    image.data[index + 1] = value
    image.data[index + 2] = value
    image.data[index + 3] = 255
  }

  tempContext.putImageData(image, 0, 0)
  context.imageSmoothingEnabled = true
  context.globalAlpha = alpha / 255
  context.drawImage(temp, 0, 0, size, size)
  context.globalAlpha = 1
}

function makeNormalMap(style) {
  return makeTexture((context, size) => {
    context.fillStyle = '#8080ff'
    context.fillRect(0, 0, size, size)

    if (style === 'smooth') return

    if (style === 'brushed' || style === 'metal') {
      for (let index = 0; index < size * 18; index += 1) {
        const y = Math.random() * size
        const shade = 110 + Math.floor(Math.random() * 50)
        context.strokeStyle = `rgb(${shade}, ${shade}, 255)`
        context.lineWidth = style === 'brushed' ? 1.6 : 1
        context.beginPath()
        context.moveTo(0, y)
        context.lineTo(size, y + (Math.random() - 0.5) * 4)
        context.stroke()
      }
      return
    }

    if (style === 'rubber') {
      for (let index = 0; index < 900; index += 1) {
        const x = Math.random() * size
        const y = Math.random() * size
        const radius = 1 + Math.random() * 3
        context.fillStyle = `rgba(${100 + Math.random() * 60}, ${
          100 + Math.random() * 60
        }, 255, 0.55)`
        context.beginPath()
        context.arc(x, y, radius, 0, Math.PI * 2)
        context.fill()
      }
      return
    }

    // Matte / ceramic grain.
    fillNoise(context, size, style === 'matte' ? 90 : 40, style === 'matte' ? 3 : 6)
  })
}

function makeRoughnessMap(style) {
  return makeTexture((context, size) => {
    if (style === 'chrome') {
      context.fillStyle = '#1a1a1a'
      context.fillRect(0, 0, size, size)
      return
    }
    if (style === 'plastic' || style === 'ceramic') {
      context.fillStyle = style === 'plastic' ? '#777777' : '#444444'
      context.fillRect(0, 0, size, size)
      fillNoise(context, size, 35, 8)
      return
    }
    if (style === 'brushed' || style === 'metal') {
      context.fillStyle = '#666666'
      context.fillRect(0, 0, size, size)
      for (let index = 0; index < size * 12; index += 1) {
        const y = Math.random() * size
        context.strokeStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.15})`
        context.lineWidth = 1
        context.beginPath()
        context.moveTo(0, y)
        context.lineTo(size, y)
        context.stroke()
      }
      return
    }
    if (style === 'rubber') {
      context.fillStyle = '#d0d0d0'
      context.fillRect(0, 0, size, size)
      fillNoise(context, size, 120, 2)
      return
    }
    // Matte
    context.fillStyle = '#efefef'
    context.fillRect(0, 0, size, size)
    fillNoise(context, size, 100, 2)
  })
}

const MATERIAL_PRESETS = {
  matte: {
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.15,
    normalScale: 0.55,
    maps: 'matte',
  },
  plastic: {
    roughness: 0.4,
    metalness: 0,
    envMapIntensity: 0.55,
    normalScale: 0.12,
    maps: 'plastic',
  },
  metal: {
    roughness: 0.28,
    metalness: 1,
    envMapIntensity: 1.35,
    normalScale: 0.35,
    maps: 'metal',
  },
  brushed: {
    roughness: 0.48,
    metalness: 1,
    envMapIntensity: 1.15,
    normalScale: 0.7,
    maps: 'brushed',
  },
  chrome: {
    roughness: 0.04,
    metalness: 1,
    envMapIntensity: 1.8,
    normalScale: 0.02,
    maps: 'chrome',
  },
  rubber: {
    roughness: 0.95,
    metalness: 0,
    envMapIntensity: 0.1,
    normalScale: 1.1,
    maps: 'rubber',
  },
  ceramic: {
    roughness: 0.16,
    metalness: 0.05,
    envMapIntensity: 0.85,
    normalScale: 0.08,
    maps: 'ceramic',
  },
}

function createShapeGeometry(shapeId) {
  switch (shapeId) {
    case 'sphere':
      return new THREE.SphereGeometry(0.65, 48, 32)
    case 'cylinder':
      return new THREE.CylinderGeometry(0.55, 0.55, 1.2, 48)
    case 'cone':
      return new THREE.ConeGeometry(0.65, 1.3, 48)
    case 'torus':
      return new THREE.TorusGeometry(0.55, 0.22, 32, 64)
    case 'octahedron':
      return new THREE.OctahedronGeometry(0.75)
    case 'dodecahedron':
      return new THREE.DodecahedronGeometry(0.7)
    case 'torusKnot':
      return new THREE.TorusKnotGeometry(0.42, 0.14, 128, 24)
    case 'box':
    default:
      return new THREE.BoxGeometry(1, 1, 1)
  }
}

function paintGradient(context, size, colorA, colorB, direction) {
  let gradient

  if (direction === 'horizontal') {
    gradient = context.createLinearGradient(0, 0, size, 0)
  } else if (direction === 'diagonal') {
    gradient = context.createLinearGradient(0, 0, size, size)
  } else if (direction === 'radial') {
    gradient = context.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size * 0.72
    )
  } else {
    gradient = context.createLinearGradient(0, 0, 0, size)
  }

  gradient.addColorStop(0, colorA)
  gradient.addColorStop(1, colorB)
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
}

function createGradientTexture(colorA, colorB, direction) {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  paintGradient(canvas.getContext('2d'), size, colorA, colorB, direction)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

export default function Week1Scene({ settings }) {
  const mountRef = useRef(null)

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
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    mount.appendChild(renderer.domElement)

    // Environment reflections make metalness/roughness readable on the mesh.
    const environment = new RoomEnvironment()
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(environment, 0.04).texture

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 2
    controls.maxDistance = 30

    const mapLibrary = {
      matte: {
        normalMap: makeNormalMap('matte'),
        roughnessMap: makeRoughnessMap('matte'),
      },
      plastic: {
        normalMap: makeNormalMap('smooth'),
        roughnessMap: makeRoughnessMap('plastic'),
      },
      metal: {
        normalMap: makeNormalMap('metal'),
        roughnessMap: makeRoughnessMap('metal'),
      },
      brushed: {
        normalMap: makeNormalMap('brushed'),
        roughnessMap: makeRoughnessMap('brushed'),
      },
      chrome: {
        normalMap: makeNormalMap('smooth'),
        roughnessMap: makeRoughnessMap('chrome'),
      },
      rubber: {
        normalMap: makeNormalMap('rubber'),
        roughnessMap: makeRoughnessMap('rubber'),
      },
      ceramic: {
        normalMap: makeNormalMap('ceramic'),
        roughnessMap: makeRoughnessMap('ceramic'),
      },
    }

    Object.values(mapLibrary).forEach(({ normalMap, roughnessMap }) => {
      normalMap.repeat.set(2, 2)
      roughnessMap.repeat.set(2, 2)
    })

    let activeShapeId = settingsRef.current.shape ?? 'box'
    let geometry = createShapeGeometry(activeShapeId)
    const initialPreset =
      MATERIAL_PRESETS[settingsRef.current.material] ?? MATERIAL_PRESETS.plastic
    const initialMaps = mapLibrary[initialPreset.maps]

    let gradientTexture = createGradientTexture(
      settingsRef.current.color,
      settingsRef.current.colorEnd ?? '#6ea8ff',
      settingsRef.current.gradientDirection ?? 'vertical'
    )
    let activeGradientKey = [
      settingsRef.current.color,
      settingsRef.current.colorEnd,
      settingsRef.current.gradientDirection,
    ].join('|')

    const material = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      map: gradientTexture,
      roughness: initialPreset.roughness,
      metalness: initialPreset.metalness,
      envMapIntensity: initialPreset.envMapIntensity,
      normalMap: initialMaps.normalMap,
      roughnessMap: initialMaps.roughnessMap,
      normalScale: new THREE.Vector2(
        initialPreset.normalScale,
        initialPreset.normalScale
      ),
    })
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    const grid = new THREE.GridHelper(24, 24, '#39424e', '#232a33')
    grid.position.y = -1.5
    scene.add(grid)

    scene.add(new THREE.AmbientLight(0xffffff, 0.25))

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4)
    keyLight.position.set(5, 6, 4)
    scene.add(keyLight)

    const rimLight = new THREE.DirectionalLight('#6ea8ff', 1.4)
    rimLight.position.set(-5, 2, -4)
    scene.add(rimLight)

    const clock = new THREE.Clock()
    let frameId
    let activePresetId = settingsRef.current.material

    const applyPreset = (presetId) => {
      const preset = MATERIAL_PRESETS[presetId] ?? MATERIAL_PRESETS.plastic
      const maps = mapLibrary[preset.maps]
      material.roughness = preset.roughness
      material.metalness = preset.metalness
      material.envMapIntensity = preset.envMapIntensity
      material.normalMap = maps.normalMap
      material.roughnessMap = maps.roughnessMap
      material.normalScale.set(preset.normalScale, preset.normalScale)
      material.needsUpdate = true
      activePresetId = presetId
    }

    const applyShape = (shapeId) => {
      const nextGeometry = createShapeGeometry(shapeId)
      mesh.geometry.dispose()
      mesh.geometry = nextGeometry
      geometry = nextGeometry
      activeShapeId = shapeId
    }

    const applyGradient = (colorA, colorB, direction) => {
      const nextTexture = createGradientTexture(colorA, colorB, direction)
      gradientTexture.dispose()
      gradientTexture = nextTexture
      material.map = gradientTexture
      material.color.set('#ffffff')
      material.needsUpdate = true
      activeGradientKey = [colorA, colorB, direction].join('|')
    }

    const animate = () => {
      const delta = clock.getDelta()
      const {
        rotationSpeed,
        size,
        color,
        colorEnd,
        gradientDirection,
        autoRotate,
        material: presetId,
        shape,
      } = settingsRef.current

      if (autoRotate) {
        mesh.rotation.y += rotationSpeed * delta
        mesh.rotation.x += rotationSpeed * delta * 0.35
      }
      mesh.scale.setScalar(size)

      const gradientKey = [
        color,
        colorEnd ?? '#6ea8ff',
        gradientDirection ?? 'vertical',
      ].join('|')
      if (gradientKey !== activeGradientKey) {
        applyGradient(
          color,
          colorEnd ?? '#6ea8ff',
          gradientDirection ?? 'vertical'
        )
      }

      if (presetId !== activePresetId) {
        applyPreset(presetId)
      }
      if (shape !== activeShapeId) {
        applyShape(shape)
      }

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
      geometry.dispose()
      material.dispose()
      gradientTexture.dispose()
      Object.values(mapLibrary).forEach(({ normalMap, roughnessMap }) => {
        normalMap.dispose()
        roughnessMap.dispose()
      })
      scene.environment?.dispose()
      pmrem.dispose()
      grid.geometry.dispose()
      grid.material.dispose()
      renderer.dispose()
    }
  }, [])

  return <div className="scene" ref={mountRef} />
}
