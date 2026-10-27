/**
 * Topic 6: how the segments of any branching method connect, and how much
 * each one matters.
 *
 * A segment's parent is the one that ends where it starts. Counting how many
 * tips each segment feeds (from the tips back toward the root) gives:
 *
 *   radius      the pipe model (da Vinci's rule): a branch carries all the
 *               twigs above it, so radius = twig radius × √(tips fed)
 *   importance  segments sorted by tips fed, largest first, ties broken by
 *               step. A parent always feeds at least as many tips as its
 *               child and grows earlier, so any first part of this order is
 *               a connected tree: trunk, then limbs, then twigs. That makes
 *               "keep the first N%" a level of detail.
 */

const keyOf = (point) => `${point.x.toFixed(5)},${point.y.toFixed(5)},${point.z.toFixed(5)}`

export function buildHierarchy(segments) {
  const count = segments.length
  const byStep = [...segments.keys()].sort((a, b) => segments[a].depth - segments[b].depth)

  const parent = new Int32Array(count).fill(-1)
  const endsAt = new Map()
  for (const index of byStep) {
    const found = endsAt.get(keyOf(segments[index].start))
    if (found !== undefined) parent[index] = found
    endsAt.set(keyOf(segments[index].end), index)
  }

  // Children grow after their parents, so walking backwards by step adds up
  // each segment's tips before its parent needs them.
  const tipsFed = new Float32Array(count)
  for (let order = count - 1; order >= 0; order -= 1) {
    const index = byStep[order]
    if (tipsFed[index] === 0) tipsFed[index] = 1
    if (parent[index] >= 0) tipsFed[parent[index]] += tipsFed[index]
  }

  const importance = [...segments.keys()].sort(
    (a, b) => tipsFed[b] - tipsFed[a] || segments[a].depth - segments[b].depth
  )

  return { parent, tipsFed, importance }
}
