import * as THREE from 'three'

/**
 * Draws a branching structure ({ segments, tips, maxDepth, attractors? }) as
 * one set of coloured lines plus a dot at each tip. Shared by every Topic 6
 * method.
 *
 * Colour runs from bark at the root to leaf green at the last step, so the
 * order of growth reads as bands. A segment's depth is the step it grows in:
 * reveal(progress) grows the structure one step at a time, with every branch
 * of the growing step extending out from its parent together. Attraction
 * points (space colonization) disappear at the step a branch reaches them.
 */

const BARK = new THREE.Color('#8a5a36')
const LEAF = new THREE.Color('#bfe58f')
const ATTRACTOR = new THREE.Color('#6ea8ff')

export function createBranchObject({ segments: unsorted, tips, maxDepth, attractors = [] }) {
  // Grow in step order; a stable sort keeps each method's own order inside a step.
  const segments = [...unsorted].sort((a, b) => a.depth - b.depth)
  const positions = new Float32Array(segments.length * 6)
  const colors = new Float32Array(segments.length * 6)
  const color = new THREE.Color()

  segments.forEach((segment, index) => {
    segment.start.toArray(positions, index * 6)
    segment.end.toArray(positions, index * 6 + 3)
    color.copy(BARK).lerp(LEAF, maxDepth > 0 ? segment.depth / maxDepth : 1)
    color.toArray(colors, index * 6)
    color.toArray(colors, index * 6 + 3)
  })

  // generationStart[d] = index of the first segment at step d or later.
  const generations = maxDepth + 1
  const generationStart = []
  let cursor = 0
  for (let depth = 0; depth <= generations; depth += 1) {
    while (cursor < segments.length && segments[cursor].depth < depth) cursor += 1
    generationStart.push(cursor)
  }

  // The finished end points; reveal() pulls the growing ones back toward
  // their starts and puts them back once that step is done.
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

  // Attraction points, last-removed first, so the ones still standing at any
  // step are always a prefix of the list.
  const sortedAttractors = [...attractors].sort((a, b) => b.removedAt - a.removedAt)
  const attractorPositions = new Float32Array(sortedAttractors.length * 3)
  sortedAttractors.forEach((point, index) => point.position.toArray(attractorPositions, index * 3))
  const attractorGeometry = new THREE.BufferGeometry()
  attractorGeometry.setAttribute('position', new THREE.BufferAttribute(attractorPositions, 3))
  const attractorPoints = new THREE.Points(
    attractorGeometry,
    new THREE.PointsMaterial({
      color: ATTRACTOR,
      size: 0.05,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    })
  )
  const standingAt = (step) => {
    let count = 0
    while (count < sortedAttractors.length && sortedAttractors[count].removedAt >= step) count += 1
    return count
  }
  attractorGeometry.setDrawRange(0, standingAt(Infinity))

  const group = new THREE.Group()
  group.add(lines, tipPoints, attractorPoints)

  let growing = null
  let showTips = true

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

  // Everything drawn, for framing the camera.
  const bounds = new THREE.Box3().setFromBufferAttribute(positionAttribute)
  sortedAttractors.forEach((point) => bounds.expandByPoint(point.position))
  if (bounds.isEmpty()) bounds.setFromCenterAndSize(new THREE.Vector3(0, 2, 0), new THREE.Vector3(4, 4, 4))

  return {
    group,
    generations,
    bounds,
    setShowTips(show) {
      showTips = show
      tipPoints.visible = show && growing === null
    },
    setShowAttractors(show) {
      attractorPoints.visible = show
    },
    // progress runs 0 → generations; the fraction is how far the current
    // step has grown out of its parents.
    reveal(progress) {
      const generation = Math.min(Math.floor(progress), generations)
      if (growing !== null && growing !== generation) {
        extend(generationStart[growing], generationStart[growing + 1], 1)
      }
      if (generation >= generations) {
        growing = null
        lineGeometry.setDrawRange(0, Infinity)
        attractorGeometry.setDrawRange(0, standingAt(Infinity))
        tipPoints.visible = showTips
        return
      }
      growing = generation
      const fraction = progress - generation
      // Ease out, so each step shoots out and then slows as it settles.
      extend(generationStart[generation], generationStart[generation + 1], 1 - (1 - fraction) ** 2)
      lineGeometry.setDrawRange(0, generationStart[generation + 1] * 2)
      attractorGeometry.setDrawRange(0, standingAt(generation + 1))
      tipPoints.visible = false
    },
    dispose() {
      lineGeometry.dispose()
      lines.material.dispose()
      tipGeometry.dispose()
      tipPoints.material.dispose()
      attractorGeometry.dispose()
      attractorPoints.material.dispose()
    },
  }
}
