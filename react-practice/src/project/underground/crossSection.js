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
 *            ground: leaf litter (a thin solid strip), then dark humus and
 *            the soil's darkness far down,
 *            drawn as background (right after the sky, no depth test) so
 *            the roots draw over it and the sky above the ground line stays
 *            as it is; the roots fade into it with distance (rootRenderer.js)
 *
 * The cut moves with you: each frame it passes through the anchor, facing
 * the camera's horizontal view direction. The edge strip is rebuilt only
 * when the cut has moved or turned noticeably.
 */

const FADE_SECONDS = 0.4
// The edge strip: half its width along the cut (m), sample spacing, and
// the depths of its colour bands below the ground (m).
const EDGE_HALF_WIDTH = 30
const EDGE_STEP = 0.05
const EDGE_BANDS = [
  [0.004, '#6b5238'], // leaf litter just proud of the surface
  [-0.02, '#4a3624'],
  [-0.06, '#2c1f15'], // humus
  [-0.18, '#1a120c'], // into the soil's darkness
  [-40, '#0d0906'],
]
// Bands above this row are the solid strip (just the litter edge); below
// it, the background, so the roots show right up to the surface.
const SOLID_ROWS = 1
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
  const rows = EDGE_BANDS.length
  const positions = new Float32Array(columns * rows * 3)
  const colors = new Float32Array(columns * rows * 3)
  // Indices of the solid strip first, then the background, one group each.
  const indices = []
  for (const [first, last] of [
    [0, SOLID_ROWS],
    [SOLID_ROWS, rows - 1],
  ]) {
    for (let column = 0; column < columns - 1; column += 1) {
      for (let row = first; row < last; row += 1) {
        const a = column * rows + row
        const b = a + 1
        const c = a + rows
        const d = c + 1
        indices.push(a, b, c, b, d, c)
      }
    }
  }
  const solidCount = (columns - 1) * SOLID_ROWS * 6
  const bandColors = EDGE_BANDS.map(([, color]) => new THREE.Color(color))
  for (let column = 0; column < columns; column += 1) {
    bandColors.forEach((color, row) => {
      // A little variation along the cut, so the band isn't a flat stripe.
      const shade = 1 + 0.12 * Math.sin(column * 0.37) * Math.sin(column * 0.11 + row)
      color
        .clone()
        .multiplyScalar(shade)
        .toArray(colors, (column * rows + row) * 3)
    })
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.addGroup(0, solidCount, 0)
  geometry.addGroup(solidCount, indices.length - solidCount, 1)
  const solidMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false })
  const backgroundMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    fog: false,
    depthTest: false,
    depthWrite: false,
  })
  const edge = new THREE.Mesh(geometry, [solidMaterial, backgroundMaterial])
  edge.frustumCulled = false
  // Right after the sky (renderOrder -1), before everything else.
  edge.renderOrder = -0.5
  edge.visible = false
  scene.add(edge)

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
      EDGE_BANDS.forEach(([depth], row) => {
        const index = (column * rows + row) * 3
        positions[index] = x
        positions[index + 1] = ground + depth
        positions[index + 2] = z
      })
    }
    geometry.attributes.position.needsUpdate = true
    geometry.computeBoundingSphere()
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
      edge.visible = clipping
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
      scene.remove(edge)
      geometry.dispose()
      solidMaterial.dispose()
      backgroundMaterial.dispose()
    },
  }
}
