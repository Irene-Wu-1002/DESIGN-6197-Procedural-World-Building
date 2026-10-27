import * as THREE from 'three'

/**
 * Draws a branching structure ({ segments, tips, maxDepth }) as one set of
 * coloured lines plus a dot at each tip. Shared by every Topic 6 method.
 *
 * Colour runs from bark at the trunk to leaf green at the tips, so each
 * generation reads as its own band. Segments must be ordered by depth:
 * reveal(progress) then grows the tree one generation at a time.
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

  const lineGeometry = new THREE.BufferGeometry()
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
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

  return {
    group,
    generations,
    setShowTips(show) {
      tipPoints.userData.wanted = show
      tipPoints.visible = show && lineGeometry.drawRange.count === Infinity
    },
    // progress runs 0 → generations; the fraction fills the current generation.
    reveal(progress) {
      if (progress >= generations) {
        lineGeometry.setDrawRange(0, Infinity)
        tipPoints.visible = tipPoints.userData.wanted !== false
        return
      }
      const generation = Math.floor(progress)
      const from = generationStart[generation]
      const to = generationStart[generation + 1]
      const count = from + Math.round((to - from) * (progress - generation))
      lineGeometry.setDrawRange(0, count * 2)
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
