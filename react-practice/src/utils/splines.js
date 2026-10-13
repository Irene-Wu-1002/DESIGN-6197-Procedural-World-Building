/**
 * Small spline toolkit for paths on the ground (rivers, roads, later ant
 * trails). Points are [x, z] pairs in world units; heights are added by the
 * caller. Plain data only, no Three.js.
 */

/** Keep every `every`-th point (and always the last), to drop grid jaggies. */
export function thin(points, every) {
  if (points.length <= 2) return points.slice()
  const result = []
  for (let index = 0; index < points.length; index += every) result.push(points[index])
  if (result[result.length - 1] !== points[points.length - 1]) {
    result.push(points[points.length - 1])
  }
  return result
}

/**
 * Centripetal Catmull-Rom through the points, `samples` points per segment.
 * Centripetal (alpha 0.5) avoids loops and overshoot on uneven spacing.
 */
export function catmullRom(points, samples = 8) {
  if (points.length < 3) return points.slice()
  const first = points[0]
  const last = points[points.length - 1]
  // Mirror the ends so the curve passes through the first and last point.
  const padded = [
    [2 * first[0] - points[1][0], 2 * first[1] - points[1][1]],
    ...points,
    [2 * last[0] - points[points.length - 2][0], 2 * last[1] - points[points.length - 2][1]],
  ]
  const knot = (a, b) => Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5, 1e-4)
  const result = []

  for (let index = 1; index < padded.length - 2; index += 1) {
    const p0 = padded[index - 1]
    const p1 = padded[index]
    const p2 = padded[index + 1]
    const p3 = padded[index + 2]
    const t1 = knot(p0, p1)
    const t2 = t1 + knot(p1, p2)
    const t3 = t2 + knot(p2, p3)
    for (let sample = 0; sample < samples; sample += 1) {
      const t = t1 + ((t2 - t1) * sample) / samples
      const point = [0, 1].map((axis) => {
        const a1 = ((t1 - t) / t1) * p0[axis] + (t / t1) * p1[axis]
        const a2 = ((t2 - t) / (t2 - t1)) * p1[axis] + ((t - t1) / (t2 - t1)) * p2[axis]
        const a3 = ((t3 - t) / (t3 - t2)) * p2[axis] + ((t - t2) / (t3 - t2)) * p3[axis]
        const b1 = ((t2 - t) / t2) * a1 + (t / t2) * a2
        const b2 = ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3
        return ((t2 - t) / (t2 - t1)) * b1 + ((t - t1) / (t2 - t1)) * b2
      })
      result.push(point)
    }
  }
  result.push(last)
  return result
}

/** Total length of a polyline. */
export function polylineLength(points) {
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1]
    )
  }
  return length
}

/**
 * Evenly spaced points along a polyline. Each result is
 * { x, z, t } with t = 0 at the start and 1 at the end.
 */
export function resample(points, spacing) {
  const total = polylineLength(points)
  if (total === 0) return [{ x: points[0][0], z: points[0][1], t: 0 }]
  const count = Math.max(Math.round(total / spacing), 1)
  const result = []
  let segment = 1
  let segmentStart = 0
  for (let index = 0; index <= count; index += 1) {
    const distance = (index / count) * total
    let segmentLength = Math.hypot(
      points[segment][0] - points[segment - 1][0],
      points[segment][1] - points[segment - 1][1]
    )
    while (segment < points.length - 1 && distance > segmentStart + segmentLength) {
      segmentStart += segmentLength
      segment += 1
      segmentLength = Math.hypot(
        points[segment][0] - points[segment - 1][0],
        points[segment][1] - points[segment - 1][1]
      )
    }
    const amount = segmentLength > 0 ? (distance - segmentStart) / segmentLength : 0
    const a = points[segment - 1]
    const b = points[segment]
    result.push({
      x: a[0] + (b[0] - a[0]) * Math.min(amount, 1),
      z: a[1] + (b[1] - a[1]) * Math.min(amount, 1),
      t: index / count,
    })
  }
  return result
}

/** Unit direction along the path at each sample (in x/z). */
export function tangents(samples) {
  return samples.map((sample, index) => {
    const previous = samples[Math.max(index - 1, 0)]
    const next = samples[Math.min(index + 1, samples.length - 1)]
    const dx = next.x - previous.x
    const dz = next.z - previous.z
    const length = Math.hypot(dx, dz) || 1
    return [dx / length, dz / length]
  })
}

/** Moving-average smoothing of one value per sample (e.g. road height). */
export function smoothValues(values, radius, passes = 1) {
  let current = values.slice()
  for (let pass = 0; pass < passes; pass += 1) {
    const next = current.slice()
    for (let index = 0; index < current.length; index += 1) {
      let sum = 0
      let weight = 0
      for (let offset = -radius; offset <= radius; offset += 1) {
        const other = index + offset
        if (other < 0 || other >= current.length) continue
        sum += current[other]
        weight += 1
      }
      next[index] = sum / weight
    }
    current = next
  }
  return current
}

/**
 * For every grid cell within `radius` of the path, the nearest sample and the
 * distance to it. Returns { nearest, distance } (nearest = -1 where the path
 * is farther than radius).
 */
export function nearestSampleGrid(samples, radius, grid) {
  const { points, step, size } = grid
  const count = points * points
  const nearest = new Int32Array(count).fill(-1)
  const distance = new Float32Array(count).fill(Infinity)
  const reach = Math.ceil(radius / step)
  samples.forEach((sample, sampleIndex) => {
    const column = Math.round((sample.x + size / 2) / step)
    const row = Math.round((sample.z + size / 2) / step)
    for (let r = Math.max(row - reach, 0); r <= Math.min(row + reach, points - 1); r += 1) {
      for (let c = Math.max(column - reach, 0); c <= Math.min(column + reach, points - 1); c += 1) {
        const d = Math.hypot(-size / 2 + c * step - sample.x, -size / 2 + r * step - sample.z)
        const index = r * points + c
        if (d <= radius && d < distance[index]) {
          distance[index] = d
          nearest[index] = sampleIndex
        }
      }
    }
  })
  return { nearest, distance }
}
