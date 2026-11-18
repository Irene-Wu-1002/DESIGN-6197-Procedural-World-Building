// Run with `npm test` (Node's built-in test runner, no dependencies).
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { describe, test } from 'node:test'

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
const { createTrunkField } = await import('../cover/trunks.js')
const { antHillEntrances } = await import('../paths/antTrail.js')
const { agaricSpot, antHills } = await import('../terrain/antHills.js')
const { DEFAULT_GROUND, createGroundSampler } = await import('../terrain/heightField.js')
const { createTunnelNetwork } = await import('./tunnels.js')

const SEEDS = [1, 2, 3, 7, 42, 1234]

const build = (seed, nests = 4) => {
  const sampler = createGroundSampler({ ...DEFAULT_GROUND, seed, nests })
  const trunks = createTrunkField(seed, DEFAULT_GROUND.trunkSpacing)
  const hills = antHills(seed, nests)
  const entrances = antHillEntrances(seed, nests)
  return { sampler, trunks, hills, entrances, network: createTunnelNetwork({ hills, entrances, sampler, trunks, seed }) }
}

describe('ant hills', () => {
  for (const seed of SEEDS) {
    test(`seed ${seed}: satellites clear of each other, the agaric and trunks`, () => {
      const { hills, trunks } = build(seed)
      assert.equal(hills[0].main, true)
      assert.deepEqual([hills[0].x, hills[0].z], [0, 0])
      assert.ok(hills.length >= 3, `only ${hills.length} nests`)
      const agaric = agaricSpot(seed)
      for (const hill of hills.slice(1)) {
        assert.ok(Math.hypot(hill.x - agaric.x, hill.z - agaric.z) > 0.12)
        assert.ok(trunks.distance(hill.x, hill.z, 1) > hill.radius)
        for (const other of hills) if (other !== hill) assert.ok(Math.hypot(hill.x - other.x, hill.z - other.z) > 0.3)
      }
    })
  }

  test('the main hill keeps its old entrances', () => {
    const one = antHillEntrances(5, 1)
    const all = antHillEntrances(5, 4)
    assert.deepEqual(all.slice(0, one.length), one)
    assert.equal(one.length, 4)
    assert.ok(all.length > one.length)
  })
})

describe('tunnel network', () => {
  for (const seed of SEEDS) test(`seed ${seed}: every entrance reaches every nest, underground`, () => {
    const { network, entrances, sampler } = build(seed)
    // Connected: walk the graph from the first entrance.
    const seen = new Set([network.entranceNode(0).id])
    const stack = [network.entranceNode(0)]
    while (stack.length) {
      const node = stack.pop()
      for (const id of node.edges) {
        const edge = network.edges[id]
        for (const next of [edge.a, edge.b]) {
          if (!seen.has(next)) {
            seen.add(next)
            stack.push(network.nodes[next])
          }
        }
      }
    }
    assert.equal(seen.size, network.nodes.length)
    assert.equal(network.nodes.filter((node) => node.kind === 'entrance').length, entrances.length)
    // Galleries stay under the ground (with room for the tube).
    for (const edge of network.edges.filter((e) => e.kind === 'gallery')) {
      for (let i = 0; i < edge.count; i += 1) {
        const depth = sampler.height(edge.points[i * 3], edge.points[i * 3 + 2]) - edge.points[i * 3 + 1]
        assert.ok(depth > edge.radius * 2, `gallery only ${(depth * 100).toFixed(1)} cm down`)
      }
    }
    // Daylight reaches the chambers through their shafts.
    for (const chamber of network.chambers) assert.ok(chamber.daylight < 0.2)
  })
})
