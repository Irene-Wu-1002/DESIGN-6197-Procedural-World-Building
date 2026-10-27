import * as THREE from 'three'

/**
 * Draws a branching structure ({ segments, tips, maxDepth }) as one set of
 * coloured lines plus a dot at each tip. Shared by every Topic 6 method.
 *
 * Colour runs from bark at the trunk to leaf green at the tips, so each
 * generation reads as its own band. Segments must be ordered by depth:
 * reveal(progress) then grows the tree one generation at a time, with every
 * branch of the growing generation extending out from its parent together.
 */

const BARK = new THREE.Color('#8a5a36')
const LEAF = new THREE.Color('#bfe58f')

export function createBranchObject({ segments, tips, maxDepth }) {
  const positions = new Float32Array(segments.length * 6)
  const colors = new Float32Array(segments.length * 6)
  const color = new THREE.Color()

  // generationStart[d] = index of the first segment at depth d.
  const generationStart = []

  segments.forEach((segment, index) => {
    if (generationStart[segment.depth] === undefined) generationStart[segment.depth] = index
    segment.start.toArray(positions, index * 6)
    segment.end.toArray(positions, index * 6 + 3)
    color.copy(BARK).lerp(LEAF, maxDepth > 0 ? segment.depth / maxDepth : 1)
    color.toArray(colors, index * 6)
    color.toArray(colors, index * 6 + 3)
  })
  generationStart.push(segments.length)
  const generations = generationStart.length - 1

  // The finished end points; reveal() pulls the growing ones back toward
  // their starts and puts them back once that generation is done.
  const fullPositions = positions.slice()

  const lineGeometry = new THREE.BufferGeometry()
  const positionAttribute = new THREE.BufferAttribute(positions, 3)
  lineGeometry.setAttribute('position', positionAttribute)
  lineGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const lines = new THREE.LineSegments(
    lineGeometry,
    new THREE.LineBasicMaterial({ vertexColors: true })
  )

  const tipPositions = new Float32Array(tips.length * 3)
  tips.forEach((tip, index) => tip.toArray(tipPositions, index * 3))
  const tipGeometry = new THREE.BufferGeometry()
  tipGeometry.setAttribute('position', new THREE.BufferAttribute(tipPositions, 3))
  const tipPoints = new THREE.Points(
    tipGeometry,
    new THREE.PointsMaterial({ color: LEAF, size: 0.07, sizeAttenuation: true })
  )

  const group = new THREE.Group()
  group.add(lines, tipPoints)

  let growing = null

  // Move the ends of segments [from, to) to `amount` of the way along.
  const extend = (from, to, amount) => {
    for (let index = from; index < to; index += 1) {
      const offset = index * 6
      for (let axis = 0; axis < 3; axis += 1) {
        const start = fullPositions[offset + axis]
        positions[offset + 3 + axis] = start + (fullPositions[offset + 3 + axis] - start) * amount
      }
    }
    positionAttribute.needsUpdate = true
  }

  return {
    group,
    generations,
    setShowTips(show) {
      tipPoints.userData.wanted = show
      tipPoints.visible = show && growing === null
    },
    // progress runs 0 → generations; the fraction is how far the current
    // generation has grown out of its parents.
    reveal(progress) {
      const generation = Math.min(Math.floor(progress), generations)
      if (growing !== null && growing !== generation) {
        extend(generationStart[growing], generationStart[growing + 1], 1)
      }
      if (generation >= generations) {
        growing = null
        lineGeometry.setDrawRange(0, Infinity)
        tipPoints.visible = tipPoints.userData.wanted !== false
        return
      }
      growing = generation
      const fraction = progress - generation
      // Ease out, so each generation shoots out and then slows as it settles.
      extend(generationStart[generation], generationStart[generation + 1], 1 - (1 - fraction) ** 2)
      lineGeometry.setDrawRange(0, generationStart[generation + 1] * 2)
      tipPoints.visible = false
    },
    dispose() {
      lineGeometry.dispose()
      lines.material.dispose()
      tipGeometry.dispose()
      tipPoints.material.dispose()
    },
  }
}
