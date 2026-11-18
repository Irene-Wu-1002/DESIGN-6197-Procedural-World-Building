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
const { agaricSpot } = await import('../terrain/antHills.js')
const { DEFAULT_GROUND, createGroundSampler } = await import('../terrain/heightField.js')
const { MOVE, STEP, TUNNEL, UP, createColony } = await import('./colony.js')

const SETTINGS = {
  colonySize: 100,
  halfLife: 40,
  diffusion: 0.7,
  sensorAngle: (40 * Math.PI) / 180,
  sensorDistance: 0.025,
  wander: 0.25,
  slopeAvoidance: 0.5,
  traffic: 0.5,
}

/** Run a colony for `seconds` of simulated time, watching what its ants do. */
function run({ seed = 1, nests = 4, seconds = 120, traffic = 0.5 } = {}) {
  const sampler = createGroundSampler({ ...DEFAULT_GROUND, seed, nests })
  const trunks = createTrunkField(seed, DEFAULT_GROUND.trunkSpacing)
  const colony = createColony()
  colony.place({ sampler, trunks, seed, antHill: true, nests, agaric: agaricSpot(seed) })
  while (!colony.ready) colony.build()
  const seen = { setOut: new Set(), moves: 0, aboveGround: 0, underground: 0 }
  const settings = { ...SETTINGS, traffic }
  for (let t = 0; t < seconds; t += STEP) {
    colony.step(settings, 1)
    for (const ant of colony.ants) {
      if (ant.state !== TUNNEL) continue
      seen.underground += 1
      if (ant.trip === UP) seen.setOut.add(ant.nest)
      if (ant.trip === MOVE) seen.moves += 1
      if (ant.y > sampler.height(ant.x, ant.z) - 0.001) seen.aboveGround += 1
    }
  }
  return { colony, seen, stats: colony.stats() }
}

describe('ant colony in several nests', () => {
  const { colony, seen, stats } = run()

  test('every nest sends ants out', () => {
    assert.equal(stats.nests, 4)
    assert.deepEqual([...seen.setOut].sort(), [0, 1, 2, 3])
  })

  test('ants walk the galleries between nests', () => {
    assert.ok(stats.transfers > 0, 'no ant changed nests')
    assert.ok(seen.moves > 0)
  })

  test('ants underground stay under the ground', () => {
    assert.ok(seen.underground > 0)
    assert.equal(seen.aboveGround, 0)
  })

  test('food comes home and every nest keeps ants', () => {
    assert.ok(stats.delivered > 0, 'nothing delivered')
    assert.ok(stats.inside.every((n) => n > 0), `nests: ${stats.inside}`)
    assert.equal(colony.ants.length, 400)
  })

  test('the same seed tells the same story', () => {
    const again = run()
    assert.deepEqual(again.stats, stats)
    assert.deepEqual(
      again.colony.ants.map((ant) => [ant.state, ant.x, ant.z]),
      colony.ants.map((ant) => [ant.state, ant.x, ant.z])
    )
  })
})

test('with one nest there is no traffic between nests', () => {
  const { seen, stats } = run({ nests: 1, seconds: 60 })
  assert.equal(stats.nests, 1)
  assert.equal(stats.transfers, 0)
  assert.equal(seen.moves, 0)
  assert.deepEqual([...seen.setOut], [0])
})

test('at 0% tunnel traffic no ant changes nests', () => {
  const { stats } = run({ seconds: 60, traffic: 0 })
  assert.equal(stats.transfers, 0)
})
