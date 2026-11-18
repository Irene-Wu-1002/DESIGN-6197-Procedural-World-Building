// Run with `npm test` (Node's built-in test runner, no dependencies).
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

// The world modules import each other without extensions (as Vite allows):
// resolve those to .js files.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (error) {
      if (specifier.startsWith('.') && !specifier.endsWith('.js')) return next(`${specifier}.js`, context)
      throw error
    }
  },
})
const { DEFAULT_GROUND, createGroundSampler } = await import('./heightField.js')
const { possibleAntHills } = await import('./antHills.js')
const { createTrunkField } = await import('../cover/trunks.js')
const { DEFAULT_STREAM, createStream } = await import('./stream.js')

const build = (seed = 1, paths = DEFAULT_STREAM) => {
  const ground = { ...DEFAULT_GROUND, seed }
  const trunks = createTrunkField(seed, ground.trunkSpacing, ground.trunks)
  const stream = createStream({ ground, paths, trunks })
  const sampler = createGroundSampler({ ...ground, stream })
  return { ground, trunks, stream, sampler }
}

test('off gives no stream', () => {
  assert.equal(createStream({ ground: DEFAULT_GROUND, paths: { ...DEFAULT_STREAM, showStream: false } }), null)
})

for (const seed of [1, 7, 42]) {
  test(`seed ${seed}: the water never runs uphill`, () => {
    const { stream } = build(seed)
    assert.ok(stream.length > 8, `stream is ${stream.length} m long`)
    for (let i = 1; i < stream.count; i += 1) {
      assert.ok(stream.level[i] <= stream.level[i - 1] + 1e-7, `rises at ${i}`)
    }
  })

  test(`seed ${seed}: the ground holds the water (bed below, banks above)`, () => {
    const { stream, sampler } = build(seed)
    const out = {}
    for (let i = 5; i < stream.count - 5; i += 37) {
      const x = stream.points[i * 2]
      const z = stream.points[i * 2 + 1]
      const ax = stream.points[i * 2 + 2] - x
      const az = stream.points[i * 2 + 3] - z
      const length = Math.hypot(ax, az)
      const [nx, nz] = [-az / length, ax / length]
      const level = stream.level[i]
      sampler.sample(x, z, out)
      assert.ok(out.height < level, `bed above the water at ${i}`)
      assert.ok(out.water > 0.99)
      // Just past the water's edge on both sides, the bank is above it.
      for (const sign of [-1, 1]) {
        const d = stream.halfWidth * 1.3
        sampler.sample(x + nx * d * sign, z + nz * d * sign, out)
        assert.ok(out.height >= level - 1e-4, `bank under the water at ${i} (${(level - out.height) * 1000} mm)`)
      }
    }
  })

  test(`seed ${seed}: keeps clear of nests and trunks`, () => {
    const { stream, trunks } = build(seed)
    const hills = possibleAntHills(seed)
    for (let i = 0; i < stream.count; i += 3) {
      const x = stream.points[i * 2]
      const z = stream.points[i * 2 + 1]
      for (const hill of hills) assert.ok(Math.hypot(x - hill.x, z - hill.z) > hill.radius + stream.halfWidth)
      for (const trunk of trunks.trunksNear(x, z, 0.6)) {
        assert.ok(Math.hypot(x - trunk.x, z - trunk.z) > trunk.radius + stream.halfWidth)
      }
    }
  })
}

test('nearest finds the centre line and its level', () => {
  const { stream } = build(1)
  const i = Math.floor(stream.count / 2)
  const q = stream.nearest(stream.points[i * 2] + 0.01, stream.points[i * 2 + 1])
  assert.ok(q.distance <= 0.0101)
  assert.ok(Math.abs(q.level - stream.level[i]) < 0.002)
  assert.equal(stream.nearest(100, 100).distance, Infinity)
})
