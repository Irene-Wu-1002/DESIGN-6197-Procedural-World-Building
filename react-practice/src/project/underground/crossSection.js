import * as THREE from 'three'

/**
 * The underground cross-section: the world sliced by a vertical cut through
 * the point you look at, always facing you, so the surface and the
 * underground are on screen together.
 *
 *   cut      on your side of the cut, the ground and its cover are clipped
 *            away (trunks, crowns and roots stay); beyond it the forest
 *            stands as usual, with its normal sky, haze and light
 *   edge     a curtain hanging in the cut whose top follows the real
 *            ground: a faint brown at the ground line fading quickly into
 *            near-black soil, all drawn as background (right after the sky, no depth test) so
 *            the roots draw over it and the sky above the ground line stays
 *            as it is; the roots fade into it with distance (rootRenderer.js)
 *   veil     a see-through layer of topsoil in the same cut, drawn over
 *            the roots behind it: fading in over the ground line, pale
 *            grey-brown and nearly opaque just under it, clearing over about 10.5 cm, so the roots show
 *            through it more and more as they go down
 *
 * The cut moves with you: each frame it passes through the anchor, facing
 * the camera's horizontal view direction. The edge strip is rebuilt only
 * when the cut has moved or turned noticeably (the veil with it).
 */

const FADE_SECONDS = 0.4
// The edge strip: half its width along the cut (m), sample spacing, and
// the depths of its colour bands below the ground (m).
const EDGE_HALF_WIDTH = 30
const EDGE_STEP = 0.05
const EDGE_BANDS = [
  [0.004, '#2e2216'], // topsoil, just proud of the surface
  [-0.03, '#120d09'],
  [-0.3, '#070505'], // into the soil's darkness
  [-40, '#030303'],
]
// The veil: depth below the ground (m), colour and opacity.
const VEIL_BANDS = [
  [0.015, '#6e5e4c', 0], // fades in over the ground line, so no edge shows
  [0.006, '#6e5e4c', 0.35],
  [-0.004, '#6a5a48', 0.75],
  [-0.0105, '#625342', 0.54],
  [-0.03, '#4f4336', 0.25],
  [-0.061, '#3c332a', 0.08],
  [-0.105, '#2a241e', 0],
]
// The curtain sits this far toward you, in front of the clipped ground edge.
const EDGE_OFFSET = 0.003
// Rebuild the strip once the cut has moved (m) or turned (rad) this much.
const MOVE_EPSILON = 0.02
const TURN_EPSILON = 0.01

/**
 * renderer: to enable local clipping; materials: the ground materials to
 * clip (tiles, far ground); cover: the cover renderer (setClipping).
 */
export function createCrossSection(scene, { renderer, materials, cover }) {
  renderer.localClippingEnabled = true
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)
  const planes = [plane]

  const columns = Math.round((EDGE_HALF_WIDTH * 2) / EDGE_STEP) + 1

  // A strip hanging in the cut, one row per band ([depth, colour, opacity?]).
  const createStrip = (bands, material) => {
    const rows = bands.length
    const alpha = bands[0].length > 2
    const size = alpha ? 4 : 3
    const positions = new Float32Array(columns * rows * 3)
    const colors = new Float32Array(columns * rows * size)
    const indices = []
    for (let column = 0; column < columns - 1; column += 1) {
      for (let row = 0; row < rows - 1; row += 1) {
        const a = column * rows + row
        const b = a + 1
        const c = a + rows
        const d = c + 1
        indices.push(a, b, c, b, d, c)
      }
    }
    const bandColors = bands.map(([, color]) => new THREE.Color(color))
    for (let column = 0; column < columns; column += 1) {
      bandColors.forEach((color, row) => {
        // A little variation along the cut, so the band isn't a flat stripe.
        const shade = 1 + 0.12 * Math.sin(column * 0.37) * Math.sin(column * 0.11 + row)
        const index = (column * rows + row) * size
        color.clone().multiplyScalar(shade).toArray(colors, index)
        if (alpha) colors[index + 3] = bands[row][2]
      })
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, size))
    geometry.setIndex(indices)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.visible = false
    scene.add(mesh)
    return { mesh, bands, positions }
  }

  const backgroundMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    fog: false,
    depthTest: false,
    depthWrite: false,
  })
  const edge = createStrip(EDGE_BANDS, backgroundMaterial)
  // Right after the sky (renderOrder -1), before everything else.
  edge.mesh.renderOrder = -0.5
  // The veil: depth-tested, so it covers only the roots behind the cut;
  // drawn after them.
  const veilMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    fog: false,
    transparent: true,
    depthWrite: false,
  })
  const veil = createStrip(VEIL_BANDS, veilMaterial)
  veil.mesh.renderOrder = 10
  const strips = [edge, veil]

  let target = 0
  let amount = 0
  let clipping = false
  const forward = new THREE.Vector3(0, 0, -1)
  const across = new THREE.Vector3()
  const builtAt = new THREE.Vector3(Infinity, 0, 0)
  const builtFacing = new THREE.Vector3()

  const setClipping = (on) => {
    if (on === clipping) return
    clipping = on
    // Changing the number of planes recompiles these materials once.
    for (const material of materials) {
      material.clippingPlanes = on ? planes : []
      material.needsUpdate = true
    }
    cover.setClipping(on ? planes : [])
    if (!on) builtAt.set(Infinity, 0, 0)
  }

  const buildEdge = (anchor, height) => {
    across.set(-forward.z, 0, forward.x)
    for (let column = 0; column < columns; column += 1) {
      const offset = -EDGE_HALF_WIDTH + column * EDGE_STEP
      const x = anchor.x + across.x * offset - forward.x * EDGE_OFFSET
      const z = anchor.z + across.z * offset - forward.z * EDGE_OFFSET
      const ground = height(x, z)
      for (const { bands, positions } of strips) {
        bands.forEach(([depth], row) => {
          const index = (column * bands.length + row) * 3
          positions[index] = x
          positions[index + 1] = ground + depth
          positions[index + 2] = z
        })
      }
    }
    for (const { mesh } of strips) {
      mesh.geometry.attributes.position.needsUpdate = true
      mesh.geometry.computeBoundingSphere()
    }
    builtAt.copy(anchor)
    builtFacing.copy(forward)
  }

  return {
    /** 0 off – 1 on, after the fade. */
    get amount() {
      return amount
    },
    get active() {
      return clipping
    },
    setOn(on) {
      target = on ? 1 : 0
    },

    /**
     * Once per frame, before rendering. anchor: the point you look at (on
     * the ground); height(x, z): the ground height.
     */
    update(dt, anchor, camera, height) {
      const step = dt / FADE_SECONDS
      amount = target > amount ? Math.min(amount + step, target) : Math.max(amount - step, target)
      // The cut is all or nothing; the roots' glow fades in.
      setClipping(target > 0)
      for (const { mesh } of strips) mesh.visible = clipping
      if (!clipping) return

      // Face the camera's horizontal view (keep the last one when looking
      // straight down).
      camera.getWorldDirection(across)
      across.y = 0
      if (across.lengthSq() > 1e-4) forward.copy(across.normalize())
      plane.setFromNormalAndCoplanarPoint(forward, anchor)
      if (
        Math.hypot(anchor.x - builtAt.x, anchor.z - builtAt.z) > MOVE_EPSILON ||
        Math.abs(anchor.y - builtAt.y) > MOVE_EPSILON ||
        forward.angleTo(builtFacing) > TURN_EPSILON
      ) {
        buildEdge(anchor, height)
      }
    },

    dispose() {
      setClipping(false)
      for (const { mesh } of strips) {
        scene.remove(mesh)
        mesh.geometry.dispose()
      }
      backgroundMaterial.dispose()
      veilMaterial.dispose()
    },
  }
}
