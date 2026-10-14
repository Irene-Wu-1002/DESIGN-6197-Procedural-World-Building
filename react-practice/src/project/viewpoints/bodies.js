import * as THREE from 'three'

/**
 * The bodies (butterfly, ant), built from simple shapes at real size
 * (metres), each facing -z with its origin on the ground below it (the
 * butterfly's origin is its body centre). They're hidden except while a
 * transition or "View body" reveals them; materials are transparent from
 * the start so fading them never recompiles a shader.
 */

const fadeMaterial = (options) =>
  new THREE.MeshStandardMaterial({ transparent: true, opacity: 1, ...options })

// A thin cylinder from a to b (for legs and antennae).
function limb(geometry, material, a, b, radius) {
  const mesh = new THREE.Mesh(geometry, material)
  const from = new THREE.Vector3(...a)
  const to = new THREE.Vector3(...b)
  const direction = to.clone().sub(from)
  mesh.position.copy(from).addScaledVector(direction, 0.5)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize())
  mesh.scale.set(radius, direction.length(), radius)
  return mesh
}

function blob(geometry, material, position, scale) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  mesh.scale.set(...scale)
  return mesh
}

function wingTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const g = canvas.getContext('2d')
  const shape = () => {
    g.beginPath()
    // Forewing.
    g.moveTo(4, 70)
    g.bezierCurveTo(60, 20, 170, 4, 244, 14)
    g.bezierCurveTo(254, 50, 236, 100, 200, 122)
    g.bezierCurveTo(140, 132, 60, 132, 4, 128)
    g.closePath()
    // Hindwing.
    g.moveTo(4, 118)
    g.bezierCurveTo(90, 120, 190, 140, 196, 182)
    g.bezierCurveTo(196, 230, 120, 252, 60, 246)
    g.bezierCurveTo(24, 240, 6, 200, 4, 150)
    g.closePath()
  }
  const fill = g.createRadialGradient(0, 128, 10, 0, 128, 250)
  fill.addColorStop(0, '#4a2a14')
  fill.addColorStop(0.25, '#c4561c')
  fill.addColorStop(0.7, '#ec8a2e')
  fill.addColorStop(1, '#f2a744')
  shape()
  g.fillStyle = fill
  g.fill()
  // Veins.
  g.strokeStyle = 'rgba(30, 16, 8, 0.75)'
  g.lineWidth = 3
  for (const [x, y] of [[240, 18], [230, 60], [200, 118], [190, 170], [150, 230], [80, 244]]) {
    g.beginPath()
    g.moveTo(6, 124)
    g.quadraticCurveTo(x * 0.45, (y + 124) / 2, x, y)
    g.stroke()
  }
  // Black border with white spots, like a fritillary/monarch.
  shape()
  g.lineWidth = 16
  g.strokeStyle = '#140c08'
  g.stroke()
  g.fillStyle = '#f4efe2'
  for (const [x, y, r] of [[222, 32, 6], [234, 58, 5], [204, 26, 5], [228, 86, 4], [176, 222, 5], [130, 240, 4], [192, 196, 4]]) {
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function createButterfly(material) {
  const group = new THREE.Group()
  const texture = wingTexture()
  const wingMaterial = fadeMaterial({ map: texture, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 })
  const wingSize = 0.032
  const plane = new THREE.PlaneGeometry(wingSize, wingSize)
  // Lie flat, inner edge on the body axis, front edge toward -z.
  plane.rotateX(-Math.PI / 2)
  plane.translate(wingSize / 2, 0, 0)
  const wings = [-1, 1].map((side) => {
    const pivot = new THREE.Group()
    const mesh = new THREE.Mesh(plane, wingMaterial)
    mesh.castShadow = true
    pivot.scale.x = side
    pivot.add(mesh)
    group.add(pivot)
    return { pivot, side }
  })
  const sphere = new THREE.SphereGeometry(1, 16, 10)
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 5)
  group.add(blob(sphere, material, [0, 0, 0.002], [0.0022, 0.0022, 0.011]))
  group.add(blob(sphere, material, [0, 0.0004, -0.0105], [0.0026, 0.0024, 0.0026]))
  for (const side of [-1, 1]) {
    group.add(limb(cylinder, material, [side * 0.001, 0.0015, -0.012], [side * 0.004, 0.006, -0.022], 0.00025))
    group.add(blob(sphere, material, [side * 0.004, 0.006, -0.022], [0.0007, 0.0007, 0.0011]))
  }
  return {
    group,
    geometries: [plane, sphere, cylinder],
    extra: [wingMaterial, texture],
    animate(time) {
      const flap = 0.35 + Math.sin(time * 13) * 0.75
      // The left wing is mirrored, so it turns the other way to rise.
      for (const { pivot, side } of wings) pivot.rotation.z = flap * side
    },
  }
}

function createAnt(material) {
  const group = new THREE.Group()
  const sphere = new THREE.SphereGeometry(1, 20, 14)
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 6)
  const add = (mesh) => {
    mesh.castShadow = true
    group.add(mesh)
    return mesh
  }
  add(blob(sphere, material, [0, 0.0029, 0.0046], [0.0021, 0.0019, 0.003]))
  add(blob(sphere, material, [0, 0.0026, 0.0013], [0.0007, 0.0009, 0.0007]))
  const thorax = add(blob(sphere, material, [0, 0.003, -0.0009], [0.0011, 0.0011, 0.0023]))
  thorax.rotation.x = 0.25
  add(blob(sphere, material, [0, 0.0037, -0.0039], [0.0017, 0.0015, 0.0016]))
  for (const side of [-1, 1]) {
    // Compound eyes.
    add(blob(sphere, material, [side * 0.0014, 0.0041, -0.0044], [0.0005, 0.0006, 0.0006]))
    // Legs: femur up and out, tibia down to the ground.
    for (const [z, reach] of [[-0.0019, -0.003], [-0.0008, 0], [0.0003, 0.003]]) {
      const knee = [side * 0.0042, 0.0042, z + reach * 0.5]
      add(limb(cylinder, material, [side * 0.0007, 0.0026, z], knee, 0.00022))
      add(limb(cylinder, material, knee, [side * 0.0065, 0, z + reach], 0.00016))
    }
  }
  const antennae = [-1, 1].map((side) => {
    const pivot = new THREE.Group()
    pivot.position.set(side * 0.0006, 0.0045, -0.0051)
    pivot.add(limb(cylinder, material, [0, 0, 0], [side * 0.0019, 0.0018, -0.0012], 0.00013))
    pivot.add(limb(cylinder, material, [side * 0.0019, 0.0018, -0.0012], [side * 0.0026, 0.0004, -0.0046], 0.00011))
    group.add(pivot)
    return { pivot, side }
  })
  return {
    group,
    geometries: [sphere, cylinder],
    animate(time) {
      for (const { pivot, side } of antennae) {
        pivot.rotation.x = Math.sin(time * 5 + side) * 0.18
        pivot.rotation.y = Math.sin(time * 3.3 + side * 2) * 0.15
      }
    },
  }
}

export function createBodies(scene) {
  const butterflyMaterial = fadeMaterial({ color: '#2b2118', roughness: 0.6 })
  const antMaterial = fadeMaterial({ color: '#21140d', roughness: 0.35, metalness: 0.1 })
  const bodies = {
    butterfly: { ...createButterfly(butterflyMaterial), materials: [butterflyMaterial] },
    ant: { ...createAnt(antMaterial), materials: [antMaterial] },
  }
  bodies.butterfly.materials.push(bodies.butterfly.extra[0])
  for (const body of Object.values(bodies)) {
    body.group.visible = false
    scene.add(body.group)
  }

  const origin = new THREE.Vector3()
  const place = (group, eye, yaw, offset) => {
    // offset: [forward, up] of the eye from the body's origin.
    origin.set(eye.x + Math.sin(yaw) * offset[0], eye.y - offset[1], eye.z + Math.cos(yaw) * offset[0])
    group.position.copy(origin)
    group.rotation.set(0, yaw, 0)
  }

  return {
    /** Show `id` with its eye at `eye`, facing yaw, at this opacity. */
    show(id, eye, yaw, offset, opacity) {
      const body = bodies[id]
      if (!body) return
      place(body.group, eye, yaw, offset)
      body.group.visible = opacity > 0.01
      for (const material of body.materials) {
        material.opacity = opacity
        material.depthWrite = opacity > 0.95
      }
    },
    hideAll() {
      for (const body of Object.values(bodies)) body.group.visible = false
    },
    animate(time) {
      for (const body of Object.values(bodies)) if (body.group.visible) body.animate(time)
    },
    /** Every group, for compiling shaders up front. */
    groups: Object.values(bodies).map((body) => body.group),
    dispose() {
      for (const body of Object.values(bodies)) {
        scene.remove(body.group)
        for (const geometry of body.geometries) geometry.dispose()
        for (const material of body.materials) material.dispose()
        body.extra?.[1]?.dispose()
      }
    },
  }
}
